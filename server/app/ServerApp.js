const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const { createServer } = require('http');
const { Server } = require('socket.io');
const db = require('../db');
const logger = require('../utils/logger');

class ServerApp {
    constructor(config) {
        this.config = config || {};
        this.app = express();
        this.httpServer = createServer(this.app);
        this.io = new Server(this.httpServer, {
            cors: { origin: '*', methods: ['GET', 'POST'] }
        });
        this.isStarted = false;
    }

    setupCoreMiddleware({ enableCors = true } = {}) {
        if (enableCors) {
            this.app.use(cors());
        }
        this.app.use(bodyParser.json());
        return this;
    }

    serveStatic(webDir, clientDir) {
        if (webDir) this.app.use(express.static(webDir));
        if (clientDir) this.app.use(express.static(clientDir));
        this.app.get('/', (req, res) => {
            if (webDir) return res.sendFile(path.join(webDir, 'index.html'));
            res.status(200).send('OK');
        });
        this.app.get('*', (req, res) => {
            if (webDir) return res.sendFile(path.join(webDir, 'index.html'));
            res.status(404).json({ error: 'not_found' });
        });
        return this;
    }

    registerRouters(routers = []) {
        for (const { basePath, router } of routers) {
            if (basePath && router) this.app.use(basePath, router);
        }
        return this;
    }

    registerSockets(registerFn) {
        if (typeof registerFn === 'function') {
            registerFn({ io: this.io, app: this.app });
        }
        return this;
    }

    registerErrorMiddleware(mw) {
        if (mw) this.app.use(mw);
        return this;
    }

    async start() {
        if (this.isStarted) return;
        const port = Number(this.config.port || process.env.PORT || 3000);
        await db.ready;
        await new Promise((resolve) => {
            this.httpServer.listen(port, () => resolve());
        });
        logger.info('server_started', { port, env: this.config.nodeEnv || process.env.NODE_ENV || 'development' });
        this.isStarted = true;
    }

    async shutdown() {
        if (!this.isStarted) return;
        await new Promise((resolve) => this.io.close(() => resolve()));
        await new Promise((resolve) => this.httpServer.close(() => resolve()));
        this.isStarted = false;
        logger.info('server_stopped');
    }
}

module.exports = { ServerApp };


