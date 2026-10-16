const { dssToken } = require('../token.js');
const { request } = require('../lib/http.js');
const { num } = require('../lib/args.js');

module.exports = {
    description: 'Query operational intents in a box and list those of one manager',
    options: {
        lat:          { type: 'string', default: '37.7633546504290', desc: 'Box centre latitude' },
        lng:          { type: 'string', default: '-122.4137267893253', desc: 'Box centre longitude' },
        'lat-offset': { type: 'string', default: '0.1', desc: 'Half the box height, in degrees' },
        'lng-offset': { type: 'string', default: '0.1', desc: 'Half the box width, in degrees' },
        'alt-lower':  { type: 'string', default: '0', desc: 'Lower altitude, metres W84' },
        'alt-upper':  { type: 'string', default: '120', desc: 'Upper altitude, metres W84' },
        hours:        { type: 'string', default: '24', desc: 'Time window from now, in hours' },
        manager:      { type: 'string', default: 'utmverse', desc: 'Only list intents whose manager contains this (case-insensitive); "" lists all' },
    },
    async run(cfg, opts) {
        const centerLat = num(opts.lat, 'lat');
        const centerLng = num(opts.lng, 'lng');
        const latOffset = num(opts['lat-offset'], 'lat-offset');
        const lngOffset = num(opts['lng-offset'], 'lng-offset');
        const queryBody = {
            area_of_interest: {
                volume: {
                    outline_polygon: {
                        vertices: [
                            { lng: centerLng - lngOffset, lat: centerLat - latOffset },  // SW
                            { lng: centerLng + lngOffset, lat: centerLat - latOffset },  // SE
                            { lng: centerLng + lngOffset, lat: centerLat + latOffset },  // NE
                            { lng: centerLng - lngOffset, lat: centerLat + latOffset },  // NW
                        ],
                    },
                    altitude_lower: { value: num(opts['alt-lower'], 'alt-lower'), reference: 'W84', units: 'M' },
                    altitude_upper: { value: num(opts['alt-upper'], 'alt-upper'), reference: 'W84', units: 'M' },
                },
                time_start: { value: new Date().toISOString(), format: 'RFC3339' },
                time_end: { value: new Date(Date.now() + num(opts.hours, 'hours') * 60 * 60 * 1000).toISOString(), format: 'RFC3339' },
            },
        };

        const token = await dssToken(cfg, 'utm.strategic_coordination');
        console.log('DSS Token obtained\n');

        const res = await request('POST', new URL('/dss/v1/operational_intent_references/query', cfg.DSS_BASE_URL), { token, json: queryBody });
        console.log('Status:', res.status);

        const refs = res.body?.operational_intent_references;
        if (!refs) {
            console.log('Response:', JSON.stringify(res.body, null, 2));
            return;
        }

        const manager = opts.manager.toLowerCase();
        const flights = refs.filter(ref => ref.manager?.toLowerCase().includes(manager));
        console.log(`\nFound ${refs.length} total operational intents`);
        console.log(`Found ${flights.length} operational intents managed by "${opts.manager}"\n`);

        flights.forEach((flight, index) => {
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
    },
};
