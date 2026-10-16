// Load injection: thousands of SCD operational intents (flights) and SCD subscriptions, each valid for
// a short window (60 s by default) so they expire on their own.
const { positiveInt, oneOf } = require('../lib/args.js');
const { INJECT_OPTIONS, volume4d, inject } = require('../lib/inject.js');

const SCOPE = 'utm.strategic_coordination';

module.exports = {
    description: 'Create thousands of short-lived SCD operational intents and subscriptions (load injection)',
    options: {
        kind:              { type: 'string', default: 'both', choices: ['oi', 'sub', 'both'], desc: 'What to create: oi (operational intents), sub or both' },
        state:             { type: 'string', default: 'Accepted', choices: ['Accepted', 'Activated'], desc: 'Operational intent state' },
        'no-implicit-sub': { type: 'boolean', desc: 'Create operational intents without their own (implicit) subscription' },
        'oi-concurrency':  { type: 'string', default: '50', desc: 'Operational intent requests in flight at once' },
        // Unlike RID, SCD subscriptions have no per-area limit and scale with concurrency.
        'sub-concurrency': { type: 'string', default: '50', desc: 'Subscription requests in flight at once' },
        ...INJECT_OPTIONS,
    },
    async run(cfg, opts) {
        const ussUrl = cfg.USS_BASE_URL.replace(/\/+$/, '');
        // OVNs to put in the key at each grid point. A new intent must list the OVNs of the live intents
        // it overlaps: the previous wave's when windows overlap, or a previous run's at the same spot.
        const keyAt = new Map();

        const all = {
            oi: {
                scope: SCOPE,
                concurrency: positiveInt(opts['oi-concurrency'], 'oi-concurrency'),
                path: id => `/dss/v1/operational_intent_references/${id}`,
                body: (extent, i) => ({
                    extents: [volume4d(extent)],
                    key: keyAt.get(i) ?? [],
                    state: opts.state,
                    uss_base_url: ussUrl,
                    ...(!opts['no-implicit-sub'] && { new_subscription: { uss_base_url: ussUrl, notify_for_constraints: false } }),
                }),
                version: body => body?.operational_intent_reference?.ovn,
                onCreated: (i, ovn) => keyAt.set(i, [ovn]),
                // The 409 lists the overlapping intents with their OVNs (visible because they are ours).
                onConflict: (i, body) => {
                    const missing = (body?.missing_operational_intents ?? []).map(oi => oi.ovn).filter(Boolean);
                    if (!missing.length) return false;
                    keyAt.set(i, [...new Set([...(keyAt.get(i) ?? []), ...missing])]);
                    return true;
                },
            },
            sub: {
                scope: SCOPE,
                concurrency: positiveInt(opts['sub-concurrency'], 'sub-concurrency'),
                path: id => `/dss/v1/subscriptions/${id}`,
                body: extent => ({
                    extents: volume4d(extent),
                    uss_base_url: ussUrl,
                    notify_for_operational_intents: true,
                    notify_for_constraints: false,
                }),
                version: body => body?.subscription?.version,
            },
        };

        const selected = { oi: ['oi'], sub: ['sub'], both: ['sub', 'oi'] }[oneOf(opts.kind, 'kind', ['oi', 'sub', 'both'])];
        await inject(cfg, opts, 'SCD', Object.fromEntries(selected.map(k => [k, all[k]])));
    },
};
