class TurnScheduler {
    constructor({ db, eventBus, resolveTurn }) {
        this.db = db;
        this.eventBus = eventBus;
        this.resolveTurn = resolveTurn;
        this.interval = null;
        this.intervalMs = 60 * 1000;
    }

    start() {
        if (this.interval) return;
        this.interval = setInterval(() => this._tick().catch(()=>{}), this.intervalMs);
    }

    stop() {
        if (!this.interval) return;
        clearInterval(this.interval);
        this.interval = null;
    }

    async _tick() {
        this.eventBus.emit('TurnAutoAdvanceCheck', { at: new Date().toISOString() });
        const games = await new Promise((resolve) => {
            this.db.all('SELECT id, auto_turn_minutes FROM games WHERE status = ? AND auto_turn_minutes IS NOT NULL', ['active'], (e, rows) => resolve(rows || []));
        });
        for (const g of games) {
            try {
                const current = await new Promise((resolve) => this.db.get('SELECT turn_number, status, created_at FROM turns WHERE game_id = ? ORDER BY turn_number DESC LIMIT 1', [g.id], (e, row) => resolve(row || { turn_number: 1, status: 'waiting', created_at: new Date().toISOString() })));
                const createdAt = new Date(current.created_at || new Date());
                const ageMs = Date.now() - createdAt.getTime();
                const thresholdMs = Number(g.auto_turn_minutes) * 60 * 1000;
                if (current.status === 'waiting' && ageMs >= thresholdMs) {
                    await this.resolveTurn(g.id, current.turn_number);
                }
            } catch {}
        }
    }
}

module.exports = { TurnScheduler };


