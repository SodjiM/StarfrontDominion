const db = require('../../db');

class SystemFactsService {
    static async getSectorSummary(sectorId) {
        const sector = await new Promise((resolve) => db.get('SELECT id, archetype FROM sectors WHERE id = ?', [sectorId], (e, r) => resolve(r || null)));
        if (!sector) return null;
        const { getArchetype } = require('../registry/archetypes');
        const arch = sector.archetype ? getArchetype(sector.archetype) : null;
        // Regions
        const regions = await new Promise((resolve) => db.all('SELECT region_id as id, health, cells_json as cells FROM regions WHERE sector_id = ?', [sectorId], (e, rows) => resolve(rows || [])));
        // Belts (sector metadata only)
        const beltSectors = await new Promise((resolve) => db.all('SELECT belt_key, sector_index, region_id, inner_radius, width, arc_start, arc_end, density, hazard FROM belt_sectors WHERE sector_id = ?', [sectorId], (e, rows) => resolve(rows || [])));
        // Wormholes (links summary)
        const wormholes = await new Promise((resolve) => db.all('SELECT id, a_object_id, b_object_id, external_sector_id, stability, mass_limit, cooldown FROM wormhole_links WHERE sector_id = ?', [sectorId], (e, rows) => resolve(rows || [])));
        // Wormhole endpoints (objects)
        const wormholeEndpoints = await new Promise((resolve) => db.all('SELECT id, x, y, meta FROM sector_objects WHERE sector_id = ? AND type = ?', [sectorId, 'wormhole'], (e, rows) => resolve(rows || [])));
        return {
            id: sector.id,
            archetype: sector.archetype || null,
            name: arch ? arch.name : 'Unknown',
            regions: regions.map(r => ({ id: r.id, health: r.health, cells: safeJson(r.cells) })),
            belts: beltSectors,
            wormholes,
            wormholeEndpoints: (wormholeEndpoints || []).map(w => ({ id: w.id, x: w.x, y: w.y, meta: safeJson(w.meta) }))
        };
    }

    static async getFacts(sectorId) {
        return this.getSectorSummary(sectorId);
    }
}

module.exports = { SystemFactsService };
function safeJson(s) { try { return JSON.parse(s || '[]'); } catch { return []; } }


