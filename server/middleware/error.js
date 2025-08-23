const logger = require('../utils/logger');

class HttpError extends Error {
    constructor(status, message, details) {
        super(message);
        this.status = status;
        if (details) this.details = details;
    }
}

function errorMiddleware(err, req, res, next) {
    const status = err.status && Number.isInteger(err.status) ? err.status : 500;
    const reqId = req.id || null;
    logger.error(err, { reqId, path: req.originalUrl || req.url, status });
    res.status(status).json({ error: err.message || 'server_error', reqId, ...(err.details ? { details: err.details } : {}) });
}

module.exports = { errorMiddleware, HttpError };


