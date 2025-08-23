const path = require('path');

function readBool(value, fallback=false) {
    if (value == null) return fallback;
    const s = String(value).toLowerCase();
    return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

function loadConfig() {
    return {
        port: Number(process.env.PORT || 3000),
        nodeEnv: process.env.NODE_ENV || 'development',
        adminSecret: process.env.ADMIN_SECRET || null,
        enableCors: readBool(process.env.ENABLE_CORS, true),
        staticWebDir: path.join(__dirname, '../../web/dist'),
        staticClientDir: path.join(__dirname, '../../client'),
    };
}

module.exports = { loadConfig };


