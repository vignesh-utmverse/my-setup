const { dssToken } = require('../token.js');
const { request } = require('../lib/http.js');

module.exports = {
    description: 'Read a USS availability status',
    options: {
        uss: { type: 'string', default: 'UTMverse', desc: 'USS ID' },
    },
    async run(cfg, opts) {
        const token = await dssToken(cfg, 'utm.availability_arbitration');
        console.log('DSS Token:', token, '\n');

        const res = await request('GET', new URL(`/dss/v1/uss_availability/${opts.uss}`, cfg.DSS_BASE_URL), { token });
        console.log('Status:', res.status);
        console.log('Response:', typeof res.body === 'string' ? res.body : JSON.stringify(res.body));
    },
};
