const { randomUUID } = require('crypto');
const logger = require('../utils/logger');

module.exports = function requestContext() {
    return function(req, res, next) {
        const reqId = (req.headers['x-request-id'] && String(req.headers['x-request-id']).trim()) || randomUUID();
        req.id = reqId;
        res.setHeader('x-request-id', reqId);

        const start = Date.now();
        res.on('finish', () => {
            const durationMs = Date.now() - start;
            const path = req.originalUrl || req.url;
            const mode = process.env.LOG_HTTP;
            if (mode !== '0') {
                const isNoisy = (/\/game\/(ability-cooldowns|cargo)/.test(String(path||'')) || /\/game\/sector\/.+\/trails/.test(String(path||'')));
                if (!(mode === 'quiet' && isNoisy)) {
                    // Route http_request logs to debug channel (console.debug) so they are hidden by default
                    logger.debug('http_request', {
                        reqId,
                        method: req.method,
                        path,
                        status: res.statusCode,
                        durationMs
                    });
                }
            }
        });
        next();
    };
};


