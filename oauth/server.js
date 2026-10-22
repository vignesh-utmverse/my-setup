const http = require('http');
const https = require('https');
const crypto = require('crypto');
const url = require('url');
const jwt = require('jsonwebtoken');
const config = require('./config');

// Generate RSA key pair on startup
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

// Extract public key components for JWKS
const publicKeyObj = crypto.createPublicKey(publicKey);
const jwk = publicKeyObj.export({ format: 'jwk' });

const JWKS = {
    keys: [{
        kty: 'RSA',
        kid: '1',
        n: jwk.n,
        e: jwk.e,
    }],
};

const VALID_SCOPES = config.SCOPES;

function verifyGoogleToken(accessToken) {
    return new Promise((resolve, reject) => {
        const req = https.request({
            hostname: 'oauth2.googleapis.com',
            path: `/tokeninfo?access_token=${encodeURIComponent(accessToken)}`,
            method: 'GET',
        }, res => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const info = JSON.parse(data);
                    if (info.error) reject(new Error(info.error_description || info.error));
                    else resolve(info);
                } catch (e) {
                    reject(new Error('Failed to parse Google tokeninfo response'));
                }
            });
        });
        req.on('error', reject);
        req.end();
    });
}

function parseBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        let size = 0;
        req.on('data', chunk => {
            size += chunk.length;
            if (size > 1e6) { req.destroy(); reject(new Error('Body too large')); return; }
            body += chunk;
        });
        req.on('end', () => {
            const params = new URLSearchParams(body);
            resolve(Object.fromEntries(params));
        });
        req.on('error', reject);
    });
}

function json(res, statusCode, body) {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
}

// POST /oauth/token?grant_type=client_credentials&intended_audience=...
async function handleToken(req, res) {
    if (req.method !== 'POST') {
        return json(res, 405, { error: 'method_not_allowed', error_description: 'Only POST is allowed on /oauth/token' });
    }

    const parsed = url.parse(req.url, true);
    const query = parsed.query;

    const audience = query.intended_audience || '';

    // --- Validate Authorization header ---
    const authHeader = req.headers['authorization'] || '';
    if (!authHeader) {
        return json(res, 401, {
            error: 'invalid_request',
            error_description: 'Authorization header is missing',
        });
    }
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!match) {
        return json(res, 401, {
            error: 'invalid_request',
            error_description: 'Authorization header must use Bearer scheme',
        });
    }

    // --- Verify Google token ---
    let tokenInfo;
    try {
        tokenInfo = await verifyGoogleToken(match[1]);
    } catch (err) {
        return json(res, 401, {
            error: 'invalid_token',
            error_description: `Google token verification failed: ${err.message}`,
        });
    }

    const email = tokenInfo.email;
    if (!email) {
        return json(res, 401, {
            error: 'invalid_token',
            error_description: 'Google token does not contain an email claim. Ensure the token was requested with the "email" scope',
        });
    }

    // --- Verify service account is authorized ---
    if (!config.AUTHORIZED_ACCOUNTS.includes(email)) {
        return json(res, 403, {
            error: 'unauthorized_client',
            error_description: `Service account "${email}" is not an authorized client`,
        });
    }

    // --- Verify account has scope assignments ---
    const accountScopes = config.ACCOUNT_SCOPES[email];
    if (!accountScopes || accountScopes.length === 0) {
        return json(res, 403, {
            error: 'unauthorized_client',
            error_description: `Service account "${email}" is authorized but has no scopes assigned`,
        });
    }

    // --- Parse and validate requested scopes ---
    const body = await parseBody(req);
    // Also accepted from the query string, where monitoring's ServiceAccount auth adapter sends it.
    const requestedScope = body.scope || query.scope;
    if (!requestedScope) {
        return json(res, 400, {
            error: 'invalid_scope',
            error_description: 'scope is required in the request body or query string',
            available_scopes: VALID_SCOPES,
        });
    }

    const requestedScopes = requestedScope.split(/\s+/).filter(Boolean);
    if (requestedScopes.length === 0) {
        return json(res, 400, {
            error: 'invalid_scope',
            error_description: 'At least one scope must be requested',
            available_scopes: VALID_SCOPES,
        });
    }

    const unknownScopes = requestedScopes.filter(s => !VALID_SCOPES.includes(s));
    if (unknownScopes.length > 0) {
        return json(res, 400, {
            error: 'invalid_scope',
            error_description: `Unknown scope(s): ${unknownScopes.join(', ')}`,
            available_scopes: VALID_SCOPES,
        });
    }

    const deniedScopes = requestedScopes.filter(s => !accountScopes.includes(s));
    if (deniedScopes.length > 0) {
        return json(res, 403, {
            error: 'insufficient_scope',
            error_description: `Account "${email}" is not authorized for scope(s): ${deniedScopes.join(', ')}`,
            account_scopes: accountScopes,
            denied_scopes: deniedScopes,
        });
    }

    // --- All checks passed, sign token ---
    const now = Math.floor(Date.now() / 1000);
    const sub = config.ACCOUNT_SUBJECTS[email] || email;

    const payload = {
        iss: config.JWT_ISSUER,
        sub: sub,
        aud: audience,
        jti: crypto.randomUUID(),
        client_id: email,
        scope: requestedScopes.join(' '),
        nbf: now,
        iat: now,
        exp: now + config.JWT_EXPIRY,
    };

    const accessToken = jwt.sign(payload, privateKey, { algorithm: 'RS256', keyid: '1' });

    console.log(`Token issued to ${email} (sub: ${sub}) | scopes: ${requestedScopes.join(' ')} | audience: ${audience}`);

    return json(res, 200, {
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: config.JWT_EXPIRY,
        scope: requestedScopes.join(' '),
    });
}

// GET /jwks.json
function handleJwks(_, res) {
    return json(res, 200, JWKS);
}

// GET /.well-known/oauth-authorization-server
function handleDiscovery(_, res) {
    return json(res, 200, {
        grant_types_supported: ['client_credentials'],
        id_token_signing_alg_values_supported: ['RS256'],
        issuer: config.JWT_ISSUER,
        jwks_uri: `${config.HOST}/jwks.json`,
        response_types_supported: ['token'],
        token_endpoint: `${config.HOST}/oauth/token`,
        token_endpoint_auth_methods_supported: ['google_bearer_auth'],
    });
}

function createServer() {
    const server = http.createServer(async (req, res) => {
        const parsed = url.parse(req.url, true);
        const pathname = parsed.pathname;

        try {
            if (pathname === '/oauth/token') {
                await handleToken(req, res);
            } else if (pathname === '/jwks.json' && req.method === 'GET') {
                handleJwks(req, res);
            } else if (pathname === '/.well-known/oauth-authorization-server' && req.method === 'GET') {
                handleDiscovery(req, res);
            } else if (pathname === '/health') {
                json(res, 200, { status: 'ok' });
            } else {
                json(res, 404, { error: 'not_found', error_description: `No endpoint at ${pathname}` });
            }
        } catch (err) {
            console.error('Request error:', err);
            json(res, 500, { error: 'server_error', error_description: err.message });
        }
    });

    return server;
}

module.exports = { createServer };
