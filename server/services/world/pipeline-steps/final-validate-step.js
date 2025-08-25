const db = require('../../../db');
const { BaseStep } = require('./base-step');

class FinalValidateStep extends BaseStep {
    constructor() { super('finalValidate'); }
    async execute(context) {
        const star = await new Promise((resolve)=>db.get('SELECT id FROM sector_objects WHERE sector_id = ? AND celestial_type = "star" LIMIT 1', [context.sectorId], (e,r)=>resolve(r||null)));
        const planets = await new Promise((resolve)=>db.get('SELECT COUNT(1) as c FROM sector_objects WHERE sector_id = ? AND celestial_type = "planet"', [context.sectorId], (e,r)=>resolve(Number(r?.c||0))));
        const nodes = await new Promise((resolve)=>db.get('SELECT COUNT(1) as c FROM resource_nodes WHERE sector_id = ?', [context.sectorId], (e,r)=>resolve(Number(r?.c||0))));
        const station = await new Promise((resolve)=>db.get('SELECT id FROM sector_objects WHERE sector_id = ? AND type = "station" LIMIT 1', [context.sectorId], (e,r)=>resolve(r||null)));
        const failures = [];
        if (!star) failures.push('no star present');
        if (planets <= 0) failures.push('no planets present');
        if (nodes <= 0) failures.push('no resource nodes');
        if (!station) failures.push('no starting station');
        if (failures.length) throw new Error(`Validation failed: ${failures.join(', ')}`);
        await new Promise((resolve)=>db.run('UPDATE sectors SET generation_completed = 1 WHERE id = ?', [context.sectorId], ()=>resolve()));
        this.result = { valid: true, planets, resourceNodes: nodes };
    }
}

module.exports = { FinalValidateStep };


