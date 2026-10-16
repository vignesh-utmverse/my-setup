const path = require('path');

// KEY_FILE paths are relative to this folder.
const ENVS = {
    prequal: {
        DSS_HOST: 'prequal-dss.utmverse.com',
        DSS_BASE_URL: 'https://prequal-dss.utmverse.com',
        OAUTH_BASE_URL: 'https://oauth.us-pre-qual.rpasplatform.net',
        KEY_FILE: 'saKey.json',
        USS_BASE_URL: 'https://prequal.utmverse.com',
    },
    qual: {
        DSS_HOST: 'qual-dss.utmverse.com',
        DSS_BASE_URL: 'https://qual-dss.utmverse.com',
        OAUTH_BASE_URL: 'https://oauth.us-qual-partners.rpasplatform.net',
        KEY_FILE: 'saKey.json',
        USS_BASE_URL: 'https://qual.utmverse.com',
    },
    sim: {
        DSS_HOST: 'sim-dss.utmverse.com',
        DSS_BASE_URL: 'https://sim-dss.utmverse.com',
        OAUTH_BASE_URL: 'https://oauth.us-simulation.rpasplatform.net',
        KEY_FILE: 'saKey.json',
        USS_BASE_URL: 'https://sim.utmverse.com',
    },
    prod: {
        DSS_HOST: 'us-dss.utmverse.com',
        DSS_BASE_URL: 'https://us-dss.utmverse.com',
        OAUTH_BASE_URL: 'https://oauth.us.rpasplatform.net',
        KEY_FILE: 'saKeyProd.json',
        USS_BASE_URL: 'https://uss.us.utmverse.com',
    },
    // Local pool from ../dss-dev: dss-0.test on 18000, dss-1.test on 18010,
    // dss-2.test on 18020 (all 127.0.0.1 in /etc/hosts), mock-oauth on 18100.
    staging: {
        DSS_HOST: 'dss-0.test',
        DSS_BASE_URL: 'http://dss-0.test:18000',
        OAUTH_BASE_URL: 'http://localhost:18100',
        KEY_FILE: 'saKeyStaging.json',
        USS_BASE_URL: 'https://test.utmverse.com',
    },
};

// The env's settings with any CLI overrides applied on top (undefined overrides are ignored).
function getConfig(env, overrides = {}) {
    const base = ENVS[env];
    if (!base) throw new Error(`Unknown environment: ${env} (expected one of: ${Object.keys(ENVS).join(', ')})`);

    const cfg = { ENV: env, ...base, KEY_FILE: path.join(__dirname, base.KEY_FILE) };
    for (const [key, value] of Object.entries(overrides)) {
        if (value !== undefined) cfg[key] = key === 'KEY_FILE' ? path.resolve(value) : value;
    }
    return cfg;
}

module.exports = { ENVS, getConfig };
