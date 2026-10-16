const { dssToken } = require('../token.js');
const { request } = require('../lib/http.js');
const { targets } = require('../lib/args.js');

const SCOPE = 'interuss.pool_status.read';

module.exports = {
    description: 'Read the global options from one or more DSS instances',
    options: {
        target: { type: 'string', multiple: true, desc: 'DSS to query as <url>[=<audience>]; repeat for several (default: the env DSS)' },
    },
    async run(cfg, opts) {
        for (const { url, host } of targets(opts.target, cfg)) {
            try {
                const token = await dssToken(cfg, SCOPE, host);
                console.log('DSS Token obtained\n');

                const optionsUrl = new URL('/aux/v1/configuration/global_options', url).toString();
                console.log('Request URL:', optionsUrl, '\n');
                const res = await request('GET', optionsUrl, { token });

                console.log(`========== GLOBAL OPTIONS RESPONSE (${host}) ==========`);
                console.log('Status:', res.status);
                console.log(JSON.stringify(res.body, null, 2));
            } catch (err) {
                console.error(`Error (${host}):`, err.message);
            }
            console.log();
        }
    },
};
