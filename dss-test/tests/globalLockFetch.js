const { dssToken } = require('../token.js');
const { request } = require('../lib/http.js');
const { targets } = require('../lib/args.js');

const SCOPE = 'interuss.pool_status.read';

module.exports = {
    description: 'Read the SCD lock mode from one or more DSS instances',
    deprecated: 'the DSS has no /aux/v1/configuration/scd_lock_mode endpoint (not in v0.23.0, so it answers 404); use globalOptions, which reports scd_global_lock and scd_hash_lock',
    options: {
        target: { type: 'string', multiple: true, desc: 'DSS to query as <url>[=<audience>]; repeat for several (default: the env DSS_TARGETS, else the env DSS)' },
    },
    async run(cfg, opts) {
        for (const { url, host } of targets(opts.target, cfg)) {
            try {
                const token = await dssToken(cfg, SCOPE, host);
                console.log('DSS Token obtained\n');

                const lockUrl = new URL('/aux/v1/configuration/scd_lock_mode', url).toString();
                console.log('Request URL:', lockUrl, '\n');
                const res = await request('GET', lockUrl, { token });

                console.log(`========== SCD LOCK MODE RESPONSE (${host}) ==========`);
                console.log('Status:', res.status);
                console.log(JSON.stringify(res.body, null, 2));
            } catch (err) {
                console.error(`Error (${host}):`, err.message);
            }
            console.log();
        }
    },
};
