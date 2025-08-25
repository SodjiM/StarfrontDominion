class BaseStep {
    constructor(name) { this.name = name; this.result = null; }
    async execute(context, options) { throw new Error('execute() must be implemented by subclass'); }
    async rollback(context, error) { /* no-op by default */ }
}

module.exports = { BaseStep };


