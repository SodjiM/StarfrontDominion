const EventEmitter = require('events');

class EventBus {
    constructor() {
        this.emitter = new EventEmitter();
        this.emitter.setMaxListeners(50);
    }

    on(eventName, listener) {
        this.emitter.on(eventName, listener);
        return () => this.emitter.off(eventName, listener);
    }

    once(eventName, listener) {
        this.emitter.once(eventName, listener);
    }

    emit(eventName, payload) {
        this.emitter.emit(eventName, payload);
    }
}

// Shared event names used across the server
const EVENTS = {
    TurnAutoAdvanceCheck: 'TurnAutoAdvanceCheck',
    TurnStarted: 'TurnStarted',
    TurnResolved: 'TurnResolved',
    MovementArrived: 'MovementArrived',
    CombatResolved: 'CombatResolved',
    HarvestingTick: 'HarvestingTick'
};

module.exports = { EventBus, EVENTS };


