const crypto = require('crypto');
const https = require('https');
const http = require('http');
const fs = require('fs');
const { OAUTH_BASE_URL, KEY_FILE, CACHE_FILE } = require('./config.js');

function loadCache() {
    try {
        return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    } catch {
        return { google: { token: null, expiresAt: 0, scope: null }, dss: { token: null, expiresAt: 0, audience: null, scope: null } };
    }
}

function saveCache(cache) {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}

let cache = loadCache();

async function googleToken(scope) {
    const now = Math.floor(Date.now() / 1000);

    if (cache.google.token && now < cache.google.expiresAt && cache.google.scope === scope) {
        return cache.google.token;
    }

    const sa = JSON.parse(fs.readFileSync(KEY_FILE, 'utf8'));

    const encode = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
    const header = encode({ alg: 'RS256', typ: 'JWT' });
    const payload = encode({ iss: sa.client_email, sub: sa.client_email, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600, scope });

    const sign = crypto.createSign('RSA-SHA256');
    sign.update(`${header}.${payload}`);
    const jwt = `${header}.${payload}.${sign.sign(sa.private_key, 'base64url')}`;

    return new Promise((resolve, reject) => {
        const body = `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`;
        const req = https.request({ hostname: 'oauth2.googleapis.com', path: '/token', method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': body.length }}, res => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                const r = JSON.parse(data);
                if (r.error) reject(new Error(r.error_description));
                else {
                    cache.google = { token: r.access_token, expiresAt: now + (r.expires_in || 3600) - 60, scope };
                    saveCache(cache);
                    resolve(r.access_token);
                }
            });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

async function dssToken(dssBaseUrl, scope, gScope = 'email') {
    const now = Math.floor(Date.now() / 1000);

    if (cache.dss.token && now < cache.dss.expiresAt && cache.dss.audience === dssBaseUrl && cache.dss.scope === scope && cache.google.scope === gScope) {
        return cache.dss.token;
    }

    const gToken = await googleToken(gScope);
    const oauthUrl = new URL(`/oauth/token?intended_audience=${encodeURIComponent(dssBaseUrl)}`, OAUTH_BASE_URL);
    const transport = oauthUrl.protocol === 'https:' ? https : http;

    return new Promise((resolve, reject) => {
        const body = `grant_type=client_credentials&scope=${encodeURIComponent(scope)}`;
        const req = transport.request(oauthUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${gToken}`,
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': body.length
            }
        }, res => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                const r = JSON.parse(data);
                if (r.error) reject(new Error(r.error_description || r.error));
                else {
                    cache.dss = { token: r.access_token, expiresAt: now + (r.expires_in || 3600) - 60, audience: dssBaseUrl, scope };
                    saveCache(cache);
                    resolve(r.access_token);
                }
            });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

module.exports = { googleToken, dssToken };
