const crypto = require('crypto');
const fs = require('fs');
const { request } = require('./lib/http.js');

// Every call mints fresh tokens; nothing is cached.

async function googleToken(keyFile, scope) {
    let sa;
    try {
        sa = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
    } catch (err) {
        throw new Error(`Cannot read service account key ${keyFile}: ${err.message}`);
    }

    const now = Math.floor(Date.now() / 1000);
    const encode = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
    const header = encode({ alg: 'RS256', typ: 'JWT' });
    const payload = encode({ iss: sa.client_email, sub: sa.client_email, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600, scope });

    const sign = crypto.createSign('RSA-SHA256');
    sign.update(`${header}.${payload}`);
    const assertion = `${header}.${payload}.${sign.sign(sa.private_key, 'base64url')}`;

    const res = await request('POST', 'https://oauth2.googleapis.com/token', {
        form: { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion },
    });
    if (!res.body?.access_token) {
        throw new Error(`Google token request failed (${res.status}): ${res.body?.error_description || JSON.stringify(res.body)}`);
    }
    return res.body.access_token;
}

// audience is the hostname the token is for (a DSS or a USS); it defaults to the env's DSS.
async function dssToken(cfg, scope, audience = cfg.DSS_HOST, gScope = 'email') {
    const gToken = await googleToken(cfg.KEY_FILE, gScope);
    const oauthUrl = new URL(`/oauth/token?intended_audience=${encodeURIComponent(audience)}`, cfg.OAUTH_BASE_URL);

    const res = await request('POST', oauthUrl, {
        token: gToken,
        form: { grant_type: 'client_credentials', scope },
    });
    if (!res.body?.access_token) {
        throw new Error(`DSS token request failed (${res.status}): ${res.body?.error_description || res.body?.error || JSON.stringify(res.body)}`);
    }
    return res.body.access_token;
}

module.exports = { googleToken, dssToken };
