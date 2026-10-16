const CACHE_FILE = './tokenCache.json';

const ENV = 'prequal';


function getConfig(env) {
    switch (env) {
        case 'prequal':
            return {
                DSS_HOST: 'prequal-dss.utmverse.com',
                DSS_BASE_URL: 'https://prequal-dss.utmverse.com',
                OAUTH_BASE_URL: 'https://oauth.us-pre-qual.rpasplatform.net',
                KEY_FILE: './saKey.json',
                USS_BASE_URL: 'https://prequal.utmverse.com',
            };
        case 'qual':
            return {
                DSS_HOST: 'qual-dss.utmverse.com',
                DSS_BASE_URL: 'https://qual-dss.utmverse.com',
                OAUTH_BASE_URL: 'https://oauth.us-qual-partners.rpasplatform.net',
                KEY_FILE: './saKey.json',
                USS_BASE_URL: 'https://qual.utmverse.com',
            };
        case 'sim':
            return {
                DSS_HOST: 'sim-dss.utmverse.com',
                DSS_BASE_URL: 'https://sim-dss.utmverse.com',
                OAUTH_BASE_URL: 'https://oauth.us-simulation.rpasplatform.net',
                KEY_FILE: './saKey.json',
                USS_BASE_URL: 'https://sim.utmverse.com',
            };
        case 'prod':
            return {
                DSS_HOST: 'us-dss.utmverse.com',
                DSS_BASE_URL: 'https://us-dss.utmverse.com',
                OAUTH_BASE_URL: 'https://oauth.us.rpasplatform.net',
                KEY_FILE: './saKeyProd.json',
                USS_BASE_URL: 'https://uss.us.utmverse.com',
            };
        case 'staging':
            return {
                DSS_HOST: 'dss-0',
                DSS_BASE_URL: 'http://laddu.local:8082',
                OAUTH_BASE_URL: 'http://laddu.local:8084',
                KEY_FILE: './saKeyStaging.json',
                USS_BASE_URL: 'https://laddu.local:8086',
            };
        default:
            throw new Error(`Unknown environment: ${env}`);
    }
}

const { DSS_HOST, DSS_BASE_URL, OAUTH_BASE_URL, KEY_FILE, USS_BASE_URL } = getConfig(ENV);

module.exports = { DSS_HOST, DSS_BASE_URL, OAUTH_BASE_URL, KEY_FILE, USS_BASE_URL, CACHE_FILE };
