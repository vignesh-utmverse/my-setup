// Load injection: thousands of RID Identification Service Areas (ISAs) and RID subscriptions, each
// valid for a short window (60 s by default) so they expire on their own.
const { positiveInt, oneOf } = require('../lib/args.js');
const { INJECT_OPTIONS, volume4d, inject } = require('../lib/inject.js');

// Endpoints, scopes and bodies for each RID API version.
function ridKinds(version, ussUrl) {
    if (version === '2') {  // ASTM F3411-22a
        return {
            isa: {
                scope: 'rid.service_provider',
                path: id => `/rid/v2/dss/identification_service_areas/${id}`,
                body: extent => ({ extents: volume4d(extent), uss_base_url: ussUrl }),
                version: body => body?.service_area?.version,
            },
            sub: {
                scope: 'rid.display_provider',
                path: id => `/rid/v2/dss/subscriptions/${id}`,
                body: extent => ({ extents: volume4d(extent), uss_base_url: ussUrl }),
                version: body => body?.subscription?.version,
            },
        };
    }

    // ASTM F3411-19
    const extentsV1 = ({ vertices, altLower, altUpper, start, end }) => ({
        spatial_volume: { footprint: { vertices }, altitude_lo: altLower, altitude_hi: altUpper },
        time_start: start.toISOString(),
        time_end: end.toISOString(),
    });
    return {
        isa: {
            scope: 'dss.write.identification_service_areas',
            path: id => `/v1/dss/identification_service_areas/${id}`,
            body: extent => ({ extents: extentsV1(extent), flights_url: `${ussUrl}/v1/uss/flights` }),
            version: body => body?.service_area?.version,
        },
        sub: {
            scope: 'dss.read.identification_service_areas',
            path: id => `/v1/dss/subscriptions/${id}`,
            body: extent => ({ extents: extentsV1(extent), callbacks: { identification_service_area_url: `${ussUrl}/v1/uss/identification_service_areas` } }),
            version: body => body?.subscription?.version,
        },
    };
}

module.exports = {
    description: 'Create thousands of short-lived RID ISAs and subscriptions (load injection)',
    options: {
        kind:              { type: 'string', default: 'both', choices: ['isa', 'sub', 'both'], desc: 'What to create: isa, sub or both' },
        'rid-version':     { type: 'string', default: '2', choices: ['2', '1'], desc: 'RID API: 2 (F3411-22a, /rid/v2) or 1 (F3411-19, /v1)' },
        'isa-concurrency': { type: 'string', default: '50', desc: 'ISA requests in flight at once' },
        // Each subscription write scans all of the USS's subscriptions (for the 10-per-cell limit), so
        // parallel writes contend in CockroachDB; on the local pool 1 runs ~50/s and 20 times out.
        'sub-concurrency': { type: 'string', default: '1', desc: 'Subscription requests in flight at once (they contend with each other)' },
        ...INJECT_OPTIONS,
    },
    async run(cfg, opts) {
        const version = oneOf(opts['rid-version'], 'rid-version', ['1', '2']);
        const all = ridKinds(version, cfg.USS_BASE_URL.replace(/\/+$/, ''));
        all.isa.concurrency = positiveInt(opts['isa-concurrency'], 'isa-concurrency');
        all.sub.concurrency = positiveInt(opts['sub-concurrency'], 'sub-concurrency');
        all.sub.limitedPerCell = true;

        const selected = { isa: ['isa'], sub: ['sub'], both: ['sub', 'isa'] }[oneOf(opts.kind, 'kind', ['isa', 'sub', 'both'])];
        await inject(cfg, opts, `RID v${version}`, Object.fromEntries(selected.map(k => [k, all[k]])));
    },
};
