const { dssToken } = require('./token.js');
const https = require('https');
const http = require('http');
const { DSS_HOST, DSS_BASE_URL } = require('./config.js');

(async () => {
    try {
        const token = await dssToken(DSS_HOST, 'utm.availability_arbitration');
        console.log('DSS Token:', token, '\n');

        const url = new URL('/dss/v1/uss_availability/UTMverse', DSS_BASE_URL);
        const transport = url.protocol === 'https:' ? https : http;

        const req = transport.request(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        }, res => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                console.log('Status:', res.statusCode);
                console.log('Response:', data);
            });
        });

        req.on('error', err => console.error('Request error:', err));
        req.end();

    } catch (err) {
        console.error('Error:', err.message);
    }
})();
