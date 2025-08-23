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
            logger.info('http_request', {
                reqId,
                method: req.method,
                path: req.originalUrl || req.url,
                status: res.statusCode,
                durationMs
            });
        });
        next();
    };
};


