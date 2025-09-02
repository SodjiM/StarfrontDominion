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
            const modeRaw = String(process.env.LOG_HTTP || '').toLowerCase();
            // Only log if explicitly enabled: '1'|'on'|'true'|'debug'|'quiet'
            const enabled = (modeRaw === '1' || modeRaw === 'on' || modeRaw === 'true' || modeRaw === 'debug' || modeRaw === 'quiet');
            if (enabled) {
                const isNoisy = (/\/game\/(ability-cooldowns|cargo)/.test(String(path||'')) || /\/game\/sector\/.+\/trails/.test(String(path||'')));
                if (!(modeRaw === 'quiet' && isNoisy)) {
                    // Route http_request logs to debug channel (console.debug)
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


