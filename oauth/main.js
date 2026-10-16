const { createServer } = require('./server');
const config = require('./config');

const server = createServer();

server.listen(config.PORT, () => {
    console.log(`Token endpoint:     POST ${config.HOST}/oauth/token`);
    console.log(`JWKS endpoint:      GET  ${config.HOST}/jwks.json`);
    console.log(`Discovery endpoint: GET  ${config.HOST}/.well-known/oauth-authorization-server`);
});
