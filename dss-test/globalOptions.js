const { dssToken } = require('./token.js');
const https = require('https');
const http = require('http');
const { DSS_HOST, DSS_BASE_URL } = require('./config.js');

// Optional overrides: list one or more DSS base URLs to query each of them in turn.
// Leave empty ([]) to fall back to the config defaults (DSS_BASE_URL / DSS_HOST).
const DSS_URL_OVERRIDES = [
//    'https://sim-dss.utmverse.com',
//    '',
];

const overrides = DSS_URL_OVERRIDES.filter(Boolean);
const TARGETS = overrides.length
    ? overrides.map(url => ({ url, host: new URL(url).hostname }))
    : [{ url: DSS_BASE_URL, host: DSS_HOST }];

const SCOPE = 'interuss.pool_status.read';

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

async function fetchGlobalOptions({ url, host }) {
    const token = await dssToken(host, SCOPE);
    console.log('DSS Token obtained\n');

    const optionsUrl = new URL('/aux/v1/configuration/global_options', url).toString();
    console.log('Request URL:', optionsUrl, '\n');
    const res = await httpRequest(optionsUrl, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}` }
    });

    console.log(`========== GLOBAL OPTIONS RESPONSE (${host}) ==========`);
    console.log('Status:', res.status);
    console.log(JSON.stringify(res.body, null, 2));
}

(async () => {
    // Sequential on purpose: token.js caches a single DSS token at a time.
    for (const target of TARGETS) {
        try {
            await fetchGlobalOptions(target);
        } catch (err) {
            console.error(`Error (${target.host}):`, err.message);
        }
        console.log();
    }
})();
