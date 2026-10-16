const { dssToken } = require('./token.js');
const https = require('https');
const http = require('http');
const { DSS_HOST, DSS_BASE_URL } = require('./config.js');

const ENTITY_ID = '634de3a2-4cba-44e9-9367-c27d66f98d92';

function httpRequest(url, options, body) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const transport = u.protocol === 'https:' ? https : http;
        const req = transport.request(u, options, res => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                let parsed;
                try { parsed = JSON.parse(data); } catch { parsed = data; }
                resolve({ status: res.statusCode, body: parsed });
            });
        });
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}

(async () => {
    try {
        const token = await dssToken(DSS_HOST, 'utm.strategic_coordination');
        console.log('DSS Token obtained\n');

        const refUrl = new URL(`/dss/v1/operational_intent_references/${ENTITY_ID}`, DSS_BASE_URL).toString();
        const refRes = await httpRequest(refUrl, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        console.log('========== DSS RAW RESPONSE ==========');
        console.log(JSON.stringify(refRes.body, null, 2));

        const ref = refRes.body?.operational_intent_reference;
        if (!ref?.uss_base_url) {
            console.log('\nNo uss_base_url on reference; skipping USS fetch.');
            return;
        }

        const ussHost = new URL(ref.uss_base_url).hostname;
        const ussToken = await dssToken(ussHost, 'utm.strategic_coordination');

        const ussUrl = `${ref.uss_base_url.replace(/\/$/, '')}/uss/v1/operational_intents/${ENTITY_ID}`;
        const ussRes = await httpRequest(ussUrl, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${ussToken}` }
        });

        console.log('\n========== USS RAW RESPONSE ==========');
        console.log(JSON.stringify(ussRes.body, null, 2));
    } catch (err) {
        console.error('Error:', err.message);
    }
})();
