// Shared engine for the inject* tests. Records are laid out on a grid, each valid for a short time
// window, and sent in waves with a separate concurrency per kind. Each wave ends with a latency and
// failure report.
const fs = require('fs');
const { randomUUID } = require('crypto');
const { performance } = require('perf_hooks');
const { setTimeout: sleep } = require('timers/promises');
const { dssToken } = require('../token.js');
const { request } = require('./http.js');
const { num, positiveInt, targets } = require('./args.js');

// Options every inject* test accepts; each test adds --kind and its per-kind concurrency.
const INJECT_OPTIONS = {
    count:               { type: 'string', default: '1000', desc: 'Records of each kind to create per wave' },
    'window-sec':        { type: 'string', default: '60', desc: 'Length of each time window, in seconds' },
    'start-offset-sec':  { type: 'string', default: '0', desc: 'Window start relative to send time, in seconds' },
    waves:               { type: 'string', default: '1', desc: 'Number of injection rounds' },
    'wave-interval-sec': { type: 'string', desc: 'Seconds between wave starts (default: --window-sec)' },
    target:              { type: 'string', multiple: true, desc: 'DSS to send to as <url>[=<audience>]; repeat to round-robin across a pool (default: the env DSS_TARGETS, else the env DSS)' },
    lat:                 { type: 'string', default: '37.7633546504290', desc: 'Grid centre latitude' },
    lng:                 { type: 'string', default: '-122.4137267893253', desc: 'Grid centre longitude' },
    'spacing-km':        { type: 'string', default: '3', desc: 'Distance between grid points; keep spacing minus size >= 2.2 km' },
    'size-m':            { type: 'string', default: '200', desc: 'Side of each square area, in metres' },
    'alt-lower':         { type: 'string', default: '0', desc: 'Lower altitude, metres W84' },
    'alt-upper':         { type: 'string', default: '120', desc: 'Upper altitude, metres W84' },
    'timeout-sec':       { type: 'string', default: '30', desc: 'Per-request timeout, in seconds' },
    out:                 { type: 'string', desc: 'Write every request (ID, version, status, latency) to this JSON file' },
    'dry-run':           { type: 'boolean', desc: 'Print one sample request of each kind and exit' },
    'allow-prod':        { type: 'boolean', desc: 'Required to inject into prod' },
};

const M_PER_DEG_LAT = 111320;

// Square areas on a grid centred on (lat, lng). Points sit spacingKm apart so that no two share an
// S2 cell: the DSS rejects a USS's 11th live subscription in any one cell.
function grid(count, { lat, lng, spacingKm, sizeM }) {
    const side = Math.ceil(Math.sqrt(count));
    const mPerDegLng = M_PER_DEG_LAT * Math.cos(lat * Math.PI / 180);
    const stepLat = spacingKm * 1000 / M_PER_DEG_LAT;
    const stepLng = spacingKm * 1000 / mPerDegLng;
    const halfLat = sizeM / 2 / M_PER_DEG_LAT;
    const halfLng = sizeM / 2 / mPerDegLng;
    const middle = (side - 1) / 2;

    return {
        side,
        spanKm: (side - 1) * spacingKm,
        at(i) {
            const cLat = lat + (Math.floor(i / side) - middle) * stepLat;
            const cLng = lng + (i % side - middle) * stepLng;
            return [  // counter-clockwise from the south-west corner
                { lat: cLat - halfLat, lng: cLng - halfLng },
                { lat: cLat - halfLat, lng: cLng + halfLng },
                { lat: cLat + halfLat, lng: cLng + halfLng },
                { lat: cLat + halfLat, lng: cLng - halfLng },
            ];
        },
    };
}

// ASTM Volume4D, as used by RID v2 and SCD.
function volume4d({ vertices, altLower, altUpper, start, end }) {
    return {
        volume: {
            outline_polygon: { vertices },
            altitude_lower: { value: altLower, reference: 'W84', units: 'M' },
            altitude_upper: { value: altUpper, reference: 'W84', units: 'M' },
        },
        time_start: { value: start.toISOString(), format: 'RFC3339' },
        time_end: { value: end.toISOString(), format: 'RFC3339' },
    };
}

// Runs fn over items with at most `concurrency` in flight. fn must not throw.
async function runPool(items, concurrency, fn) {
    let next = 0;
    const worker = async () => {
        while (next < items.length) {
            const n = next++;
            await fn(items[n], n);
        }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
}

// Fresh tokens for each wave: per target, one token per distinct scope.
function fetchTokens(cfg, kinds, dssTargets) {
    return Promise.all(dssTargets.map(async target => {
        const byScope = {};
        for (const { scope } of Object.values(kinds)) byScope[scope] ??= await dssToken(cfg, scope, target.host);
        return byScope;
    }));
}

function errorText(body) {
    const text = typeof body === 'string' ? body : body?.message || body?.error_description || JSON.stringify(body);
    return String(text).slice(0, 300);
}

// Strips per-request IDs so identical failures group together.
function errorGroup(message) {
    return message
        .replace(/\s*\(E:[^)]*\)/g, '')
        .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>');
}

function percentile(sorted, q) {
    return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : 0;
}

function report(title, kindNames, records, elapsedMs) {
    const rate = elapsedMs ? ` in ${(elapsedMs / 1000).toFixed(1)} s (${(records.length / (elapsedMs / 1000)).toFixed(0)} req/s)` : '';
    console.log(`\n${title}: ${records.length} requests${rate}`);

    for (const kind of kindNames) {
        const rs = records.filter(r => r.kind === kind);
        if (!rs.length) continue;
        const ok = rs.filter(r => r.ok).length;
        const retried = rs.filter(r => r.retried).length;
        const ms = rs.map(r => r.ms).sort((a, b) => a - b);
        console.log(`  ${kind.padEnd(3)}  ok ${String(ok).padStart(6)}  failed ${String(rs.length - ok).padStart(6)}${retried ? `  retried ${retried}` : ''}  |  latency ms  p50 ${percentile(ms, 0.5)}  p95 ${percentile(ms, 0.95)}  p99 ${percentile(ms, 0.99)}  max ${ms[ms.length - 1]}`);
    }

    const failures = new Map();
    for (const r of records) {
        if (r.ok) continue;
        const key = `${r.kind} ${r.status || 'network error'}: ${errorGroup(r.error)}`;
        failures.set(key, (failures.get(key) || 0) + 1);
    }
    for (const [key, n] of failures) console.log(`  ${n} x ${key}`);
}

// kinds: { <name>: { scope, concurrency, path(id), body(extent, i), version(responseBody),
//                    onCreated?(i, version), onConflict?(i, responseBody) -> retry?, limitedPerCell? } },
// in the order to report them. Records are created with PUT and succeed on any 2xx.
async function inject(cfg, opts, title, kinds) {
    const kindNames = Object.keys(kinds);
    const count = positiveInt(opts.count, 'count');
    const windowSec = num(opts['window-sec'], 'window-sec');
    const startOffsetSec = num(opts['start-offset-sec'], 'start-offset-sec');
    const waves = positiveInt(opts.waves, 'waves');
    const intervalSec = num(opts['wave-interval-sec'] ?? opts['window-sec'], 'wave-interval-sec');
    const dssTargets = targets(opts.target, cfg);
    const lat = num(opts.lat, 'lat');
    const lng = num(opts.lng, 'lng');
    const spacingKm = num(opts['spacing-km'], 'spacing-km');
    const sizeM = num(opts['size-m'], 'size-m');
    const altLower = num(opts['alt-lower'], 'alt-lower');
    const altUpper = num(opts['alt-upper'], 'alt-upper');
    const timeoutMs = num(opts['timeout-sec'], 'timeout-sec') * 1000;

    if (windowSec <= 0) throw new Error('--window-sec must be > 0');
    if (intervalSec < 0) throw new Error('--wave-interval-sec must be >= 0');
    if (sizeM <= 0 || spacingKm < 0) throw new Error('--size-m must be > 0 and --spacing-km >= 0');
    if (cfg.ENV === 'prod' && !opts['allow-prod']) throw new Error('Refusing to inject into prod without --allow-prod');

    const layout = grid(count, { lat, lng, spacingKm, sizeM });
    // Times are taken when each request is sent, so queued requests still get a full window.
    const extentAt = i => {
        const start = new Date(Date.now() + startOffsetSec * 1000);
        return { vertices: layout.at(i), altLower, altUpper, start, end: new Date(start.getTime() + windowSec * 1000) };
    };

    console.log(`${title}: ${count} x ${kindNames.join(' + ')} per wave, ${waves} wave(s) ${intervalSec} s apart, ${windowSec} s windows`);
    console.log(`Grid: ${layout.side} x ${layout.side} points ${spacingKm} km apart (~${layout.spanKm.toFixed(0)} km across) around ${lat}, ${lng}`);
    console.log(`Targets: ${dssTargets.map(t => `${t.url} (aud ${t.host})`).join(', ')} | concurrency ${kindNames.map(k => `${k} ${kinds[k].concurrency}`).join(', ')}`);
    if (kindNames.some(k => kinds[k].limitedPerCell) && spacingKm * 1000 - sizeM < 2200) {
        console.log('Warning: areas are close enough to share S2 cells; expect 429s once a cell holds 10 live subscriptions');
    }

    if (opts['dry-run']) {
        for (const kind of kindNames) {
            console.log(`\nPUT ${new URL(kinds[kind].path(randomUUID()), dssTargets[0].url)}  [scope ${kinds[kind].scope}]`);
            console.log(JSON.stringify(kinds[kind].body(extentAt(0), 0), null, 2));
        }
        return;
    }

    const all = [];
    const t0 = Date.now();
    for (let w = 0; w < waves; w++) {
        const delay = t0 + w * intervalSec * 1000 - Date.now();
        if (delay > 0) await sleep(delay);
        else if (w > 0) console.log(`\nWave ${w + 1} starts ${(-delay / 1000).toFixed(1)} s late: wave ${w} ran past --wave-interval-sec`);

        const tokens = await fetchTokens(cfg, kinds, dssTargets);
        const items = Array.from({ length: count }, (_, i) => i);
        const total = count * kindNames.length;

        const records = [];
        const waveStart = performance.now();
        const progress = setInterval(() => {
            console.log(`  wave ${w + 1}/${waves}: ${records.length}/${total} done, ${records.filter(r => !r.ok).length} failed`);
        }, 5000);

        // Each kind runs as its own pool, in parallel, with its own concurrency.
        await Promise.all(kindNames.map(kind => runPool(items, kinds[kind].concurrency, async (i, n) => {
            const spec = kinds[kind];
            const t = n % dssTargets.length;
            const id = randomUUID();
            const extent = extentAt(i);
            const record = { wave: w + 1, kind, id, target: dssTargets[t].url, start: extent.start.toISOString(), end: extent.end.toISOString() };
            const sent = performance.now();
            try {
                const send = () => request('PUT', new URL(spec.path(id), dssTargets[t].url), {
                    token: tokens[t][spec.scope],
                    json: spec.body(extent, i),
                    timeoutMs,
                });
                let res = await send();
                // A kind may resolve a 409 (e.g. by adding the OVNs it was missing) and retry once.
                if (res.status === 409 && spec.onConflict?.(i, res.body)) {
                    record.retried = true;
                    res = await send();
                }
                record.status = res.status;
                record.ok = res.status >= 200 && res.status < 300;
                if (record.ok) {
                    record.version = spec.version(res.body);
                    spec.onCreated?.(i, record.version);
                } else {
                    record.error = errorText(res.body);
                }
            } catch (err) {
                record.status = 0;
                record.ok = false;
                record.error = err.message;
            }
            record.ms = Math.round(performance.now() - sent);
            records.push(record);
        })));

        clearInterval(progress);
        report(`Wave ${w + 1}/${waves}`, kindNames, records, performance.now() - waveStart);
        all.push(...records);
    }

    if (waves > 1) report('All waves', kindNames, all);
    if (opts.out) {
        fs.writeFileSync(opts.out, JSON.stringify(all, null, 2));
        console.log(`\nWrote ${all.length} records to ${opts.out}`);
    }
    if (all.some(r => !r.ok)) process.exitCode = 1;
}

module.exports = { INJECT_OPTIONS, volume4d, inject };
