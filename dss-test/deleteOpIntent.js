const { dssToken } = require('./token.js');
const https = require('https');
const http = require('http');
const { DSS_HOST, DSS_BASE_URL } = require('./config.js');

// Add operational intent IDs to delete here
// Format: { id: 'op-intent-id', ovn: 'version-number' }
// Get the OVN from getFlightPlans.js output
const opIntentIds = [
    { id: '634de3a2-4cba-44e9-9367-c27d66f98d92', ovn: 'iFTckGgLskU7L2fbVYTzsDOMQEXFSwca3BOVp9tsnOs_' },
//    { id: '', ovn: '' },
//    { id: '', ovn: '' },
//    { id: '', ovn: '' },
//    { id: '', ovn: '' },
//    { id: '', ovn: '' },
//    { id: '', ovn: '' },
//    { id: '', ovn: '' },
];

if (opIntentIds.length === 0) {
    console.error('No operational intent IDs specified. Add IDs to the opIntentIds array.');
    process.exit(1);
}

async function deleteOpIntent(token, id, ovn = '') {
    return new Promise((resolve, reject) => {
        const path = ovn
            ? `/dss/v1/operational_intent_references/${id}/${ovn}`
            : `/dss/v1/operational_intent_references/${id}`;

        const url = new URL(path, DSS_BASE_URL);
        const transport = url.protocol === 'https:' ? https : http;

        const req = transport.request(url, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        }, res => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                console.log(`\n--- Deleting: ${id} ---`);
                console.log('Status:', res.statusCode);
                try {
                    const response = JSON.parse(data);
                    console.log('Response:', JSON.stringify(response, null, 2));
                } catch {
                    console.log('Response:', data || '(empty)');
                }
                resolve();
            });
        });

        req.on('error', reject);
        req.end();
    });
}

(async () => {
    try {
        const token = await dssToken(DSS_HOST, 'utm.strategic_coordination');
        console.log('DSS Token obtained');
        console.log(`Deleting ${opIntentIds.length} operational intent(s)...`);

        for (const { id, ovn } of opIntentIds) {
            await deleteOpIntent(token, id, ovn);
        }

        console.log('\nDone.');
    } catch (err) {
        console.error('Error:', err.message);
    }
})();
