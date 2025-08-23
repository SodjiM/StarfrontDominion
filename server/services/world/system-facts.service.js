const db = require('../../db');

class SystemFactsService {
    static async getSectorSummary(sectorId) {
        const sector = await new Promise((resolve) => db.get('SELECT id, archetype FROM sectors WHERE id = ?', [sectorId], (e, r) => resolve(r || null)));
        if (!sector) return null;
        const { getArchetype } = require('../registry/archetypes');
        const arch = sector.archetype ? getArchetype(sector.archetype) : null;
        return {
            id: sector.id,
            archetype: sector.archetype || null,
            name: arch ? arch.name : 'Unknown'
        };
    }
}

module.exports = { SystemFactsService };


