const { dssToken } = require('./token.js');
const https = require('https');
const http = require('http');
const { DSS_HOST, DSS_BASE_URL } = require('./config.js');

(async () => {
    try {
        // Use the strategic coordination scope for querying operational intents
        const token = await dssToken(DSS_HOST, 'utm.strategic_coordination');
        console.log('DSS Token obtained\n');

        // Query operational intent references in an area of interest
        // 500m bounding box around 36.0516°N, 94.2774°W
        // 500m ≈ 0.0045° latitude, ≈ 0.0056° longitude at this latitude
        const centerLat = 37.7633546504290;
        const centerLng = -122.4137267893253;
        const latOffset = 0.1;
        const lngOffset = 0.1;
        const queryBody = JSON.stringify({
            area_of_interest: {
                volume: {
                    outline_polygon: {
                        vertices: [
                            { lng: centerLng - lngOffset, lat: centerLat - latOffset },  // SW
                            { lng: centerLng + lngOffset, lat: centerLat - latOffset },  // SE
                            { lng: centerLng + lngOffset, lat: centerLat + latOffset },  // NE
                            { lng: centerLng - lngOffset, lat: centerLat + latOffset }   // NW
                        ]
                    },
                    altitude_lower: {
                        value: 0,
                        reference: "W84",
                        units: "M"
                    },
                    altitude_upper: {
                        value: 120,
                        reference: "W84",
                        units: "M"
                    }
                },
                time_start: {
                    value: new Date().toISOString(),
                    format: "RFC3339"
                },
                time_end: {
                    value: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // Next 24 hours
                    format: "RFC3339"
                }
            }
        });

        const url = new URL('/dss/v1/operational_intent_references/query', DSS_BASE_URL);
        const transport = url.protocol === 'https:' ? https : http;

        const req = transport.request(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(queryBody)
            }
        }, res => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                console.log('Status:', res.statusCode);

                try {
                    const response = JSON.parse(data);

                    if (response.operational_intent_references) {
                        // Filter for UTMverse organization
                        const utmverseFlights = response.operational_intent_references.filter(ref =>
                            ref.manager && ref.manager.toLowerCase().includes('utmverse')
                        );

                        console.log(`\nFound ${response.operational_intent_references.length} total operational intents`);
                        console.log(`Found ${utmverseFlights.length} UTMverse operational intents\n`);

                        utmverseFlights.forEach((flight, index) => {
                            console.log(`--- Flight ${index + 1} ---`);
                            console.log('ID:', flight.id);
                            console.log('Manager:', flight.manager);
                            console.log('USS Base URL:', flight.uss_base_url);
                            console.log('State:', flight.state);
                            console.log('OVN:', flight.ovn);
                            console.log('Time Start:', flight.time_start?.value);
                            console.log('Time End:', flight.time_end?.value);
                            console.log('');
                        });
                    } else {
                        console.log('Response:', JSON.stringify(response, null, 2));
                    }
                } catch (e) {
                    console.log('Raw Response:', data);
                }
            });
        });

        req.on('error', err => console.error('Request error:', err));
        req.write(queryBody);
        req.end();

    } catch (err) {
        console.error('Error:', err.message);
    }
})();
