const { randomUUID } = require('crypto');
const { dssToken } = require('../token.js');
const { request } = require('../lib/http.js');
const { num, vertices } = require('../lib/args.js');

module.exports = {
    description: 'Create an operational intent (flight plan) with its own subscription',
    options: {
        id:                 { type: 'string', desc: 'Entity ID (default: a random UUID)' },
        vertices:           { type: 'string', default: '37.7679,-122.4193;37.7679,-122.4081;37.7588,-122.4081;37.7588,-122.4193', desc: 'Polygon as "lat,lng;lat,lng;..."' },
        'alt-lower':        { type: 'string', default: '0', desc: 'Lower altitude, metres W84' },
        'alt-upper':        { type: 'string', default: '120', desc: 'Upper altitude, metres W84' },
        'start-offset-min': { type: 'string', default: '0', desc: 'Start time relative to now, in minutes' },
        'duration-min':     { type: 'string', default: '120', desc: 'Duration, in minutes' },
        state:              { type: 'string', default: 'Accepted', choices: ['Accepted', 'Activated', 'Nonconforming', 'Contingent'], desc: 'Operational intent state' },
        key:                { type: 'string', multiple: true, desc: 'OVN to include in the key; repeat for several' },
    },
    async run(cfg, opts) {
        const timeStart = new Date(Date.now() + num(opts['start-offset-min'], 'start-offset-min') * 60 * 1000);
        const timeEnd = new Date(timeStart.getTime() + num(opts['duration-min'], 'duration-min') * 60 * 1000);
        const body = {
            extents: [
                {
                    volume: {
                        outline_polygon: { vertices: vertices(opts.vertices, 'vertices') },
                        altitude_lower: { value: num(opts['alt-lower'], 'alt-lower'), reference: 'W84', units: 'M' },
                        altitude_upper: { value: num(opts['alt-upper'], 'alt-upper'), reference: 'W84', units: 'M' },
                    },
                    time_start: { value: timeStart.toISOString(), format: 'RFC3339' },
                    time_end: { value: timeEnd.toISOString(), format: 'RFC3339' },
                },
            ],
            key: opts.key ?? [],
            state: opts.state,
            uss_base_url: cfg.USS_BASE_URL,
            new_subscription: {
                uss_base_url: cfg.USS_BASE_URL,
                notify_for_constraints: false,
            },
        };

        const token = await dssToken(cfg, 'utm.strategic_coordination');
        console.log('DSS Token obtained\n');

        const entityId = opts.id || randomUUID();
        console.log('Creating flight plan with entity ID:', entityId);

        const res = await request('PUT', new URL(`/dss/v1/operational_intent_references/${entityId}`, cfg.DSS_BASE_URL), { token, json: body });
        console.log('Status:', res.status);
        console.log(JSON.stringify(res.body, null, 2));
    },
};
