const { dssToken } = require('../token.js');
const { request } = require('../lib/http.js');

module.exports = {
    description: 'Fetch an operational intent from the DSS, then its details from the managing USS',
    options: {
        id: { type: 'string', desc: 'Operational intent ID (required)' },
    },
    async run(cfg, opts) {
        if (!opts.id) throw new Error('--id is required');

        const token = await dssToken(cfg, 'utm.strategic_coordination');
        console.log('DSS Token obtained\n');

        const refRes = await request('GET', new URL(`/dss/v1/operational_intent_references/${opts.id}`, cfg.DSS_BASE_URL), { token });
        console.log('========== DSS RAW RESPONSE ==========');
        console.log(JSON.stringify(refRes.body, null, 2));

        const ref = refRes.body?.operational_intent_reference;
        if (!ref?.uss_base_url) {
            console.log('\nNo uss_base_url on reference; skipping USS fetch.');
            return;
        }

        const ussToken = await dssToken(cfg, 'utm.strategic_coordination', new URL(ref.uss_base_url).hostname);
        const ussUrl = `${ref.uss_base_url.replace(/\/$/, '')}/uss/v1/operational_intents/${opts.id}`;
        const ussRes = await request('GET', ussUrl, { token: ussToken });

        console.log('\n========== USS RAW RESPONSE ==========');
        console.log(JSON.stringify(ussRes.body, null, 2));
    },
};
