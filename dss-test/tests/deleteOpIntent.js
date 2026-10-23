const { dssToken } = require('../token.js');
const { request } = require('../lib/http.js');

module.exports = {
    description: 'Delete operational intents by ID and OVN',
    allEnvs: true,
    options: {
        intent: { type: 'string', multiple: true, desc: 'Intent to delete as <id>[:<ovn>]; repeat for several (getFlightPlans prints OVNs)' },
    },
    async run(cfg, opts) {
        if (!opts.intent?.length) throw new Error('Give at least one --intent <id>[:<ovn>]');

        const token = await dssToken(cfg, 'utm.strategic_coordination');
        console.log('DSS Token obtained');
        console.log(`Deleting ${opts.intent.length} operational intent(s)...`);

        for (const entry of opts.intent) {
            const [id, ovn] = entry.split(':');
            const path = ovn
                ? `/dss/v1/operational_intent_references/${id}/${ovn}`
                : `/dss/v1/operational_intent_references/${id}`;

            const res = await request('DELETE', new URL(path, cfg.DSS_BASE_URL), { token });
            console.log(`\n--- Deleting: ${id} ---`);
            console.log('Status:', res.status);
            console.log('Response:', res.body ? JSON.stringify(res.body, null, 2) : '(empty)');
        }

        console.log('\nDone.');
    },
};
