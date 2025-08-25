const db = require('../../../db');
const { BaseStep } = require('./base-step');

class ValidateSectorStep extends BaseStep {
    constructor() { super('validateSector'); }
    async execute(context) {
        const sector = await new Promise((resolve)=>db.get('SELECT id FROM sectors WHERE id = ?', [context.sectorId], (e,r)=>resolve(r||null)));
        if (!sector) throw new Error(`Sector ${context.sectorId} not found`);
        this.result = { ok: true };
    }
}

module.exports = { ValidateSectorStep };


