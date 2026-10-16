const { dssToken } = require('./token.js');
const https = require('https');
const http = require('http');
const { randomUUID } = require('crypto');
const { DSS_HOST, DSS_BASE_URL, USS_BASE_URL } = require('./config.js');


// --- Flight plan configuration ---
// Each vertex: { lat: number, lng: number }
const vertices = [
    { lat: 37.7679, lng: -122.4193 },  // Point 1
    { lat: 37.7679, lng: -122.4081 },  // Point 2
    { lat: 37.7588, lng: -122.4081 },  // Point 3
    { lat: 37.7588, lng: -122.4193 },  // Point 4
];

const altitudeLowerM = 0;
const altitudeUpperM = 120;

const key = [
];

const timeStart = new Date();
const timeEnd = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2 hours from now
// ---------------------------------

function putOpIntent(token, entityId) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({
            extents: [
                {
                    volume: {
                        outline_polygon: {
                            vertices: vertices,
                        },
                        altitude_lower: {
                            value: altitudeLowerM,
                            reference: 'W84',
                            units: 'M'
                        },
                        altitude_upper: {
                            value: altitudeUpperM,
                            reference: 'W84',
                            units: 'M'
                        }
                    },
                    time_start: {
                        value: timeStart.toISOString(),
                        format: 'RFC3339'
                    },
                    time_end: {
                        value: timeEnd.toISOString(),
                        format: 'RFC3339'
                    }
                }
            ],
            key: key,
            state: 'Accepted',
            uss_base_url: USS_BASE_URL,
            new_subscription: {
                uss_base_url: USS_BASE_URL,
                notify_for_constraints: false
            }
        });

        const url = new URL(`/dss/v1/operational_intent_references/${entityId}`, DSS_BASE_URL);
        const transport = url.protocol === 'https:' ? https : http;

        const req = transport.request(url, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body)
            }
        }, res => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve({ statusCode: res.statusCode, body: JSON.parse(data) });
                } catch (e) {
                    resolve({ statusCode: res.statusCode, body: data });
                }
            });
        });

        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

async function createFlightPlan(token, entityId) {
    const result = await putOpIntent(token, entityId);
    console.log('Status:', result.statusCode);
    console.log(JSON.stringify(result.body, null, 2));
    return result.body;
}

(async () => {
    try {
        const token = await dssToken(DSS_HOST, 'utm.strategic_coordination');
        console.log('DSS Token obtained\n');

        const entityId = randomUUID();
        console.log('Creating flight plan with entity ID:', entityId);

        await createFlightPlan(token, entityId);
    } catch (err) {
        console.error('Error:', err.message);
    }
})();
