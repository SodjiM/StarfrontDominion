const util = require('util');

function serialize(obj) {
    try {
        return JSON.stringify(obj);
    } catch (e) {
        return util.inspect(obj, { depth: 3, breakLength: 120 });
    }
}

function baseLog(level, message, context) {
    const ts = new Date().toISOString();
    const entry = {
        level,
        time: ts,
        msg: String(message || ''),
        ...(context && typeof context === 'object' ? context : {})
    };
    if (level === 'error') {
        console.error(serialize(entry));
    } else if (level === 'warn') {
        console.warn(serialize(entry));
    } else {
        console.log(serialize(entry));
    }
}

module.exports = {
    info(message, context) {
        baseLog('info', message, context);
    },
    warn(message, context) {
        baseLog('warn', message, context);
    },
    error(message, context) {
        // If message is an Error, include stack
        if (message instanceof Error) {
            const err = message;
            baseLog('error', err.message, { stack: err.stack, ...(context || {}) });
        } else {
            baseLog('error', message, context);
        }
    }
};


