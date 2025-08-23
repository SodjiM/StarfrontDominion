// Procedural system generator
const db = require('../../db');
const { getArchetype } = require('../registry/archetypes');

const SystemGenerator = {
    async generateSystem(sectorId, archetypeKey) {
        const arch = getArchetype(archetypeKey || 'standard');
        const seed = sectorId * 7919 + (archetypeKey ? archetypeKey.length : 0) * 104729;
        // Place a star at center-ish
        const sunX = 2500 + Math.floor(Math.random() * 101) - 50;
        const sunY = 2500 + Math.floor(Math.random() * 101) - 50;
        const sunMeta = JSON.stringify({ name: 'Primary Star', celestial: true, alwaysKnown: 1 });
        const sunId = await new Promise((resolve, reject) => db.run(
            `INSERT INTO sector_objects (sector_id, type, celestial_type, x, y, owner_id, meta, radius)
             VALUES (?, 'sun', 'star', ?, ?, NULL, ?, 30)`,
            [sectorId, sunX, sunY, sunMeta], function(err){ if (err) return reject(err); resolve(this.lastID); }
        ));

        // Planets: 3-5 based on archetype
        const planetCount = 3 + Math.floor(Math.random() * 3);
        for (let i = 0; i < planetCount; i++) {
            const distance = 300 + i * 250 + Math.floor(Math.random() * 120) - 60;
            const angle = Math.random() * 2 * Math.PI;
            const px = Math.max(1, Math.min(4999, Math.round(sunX + Math.cos(angle) * distance)));
            const py = Math.max(1, Math.min(4999, Math.round(sunY + Math.sin(angle) * distance)));
            const radius = 8 + Math.floor(Math.random() * 10);
            const pMeta = JSON.stringify({ name: `Planet ${i+1}`, celestial: true, scannable: true });
            await new Promise((resolve, reject) => db.run(
                `INSERT INTO sector_objects (sector_id, type, celestial_type, x, y, owner_id, meta, radius, parent_object_id)
                 VALUES (?, 'planet', 'planet', ?, ?, NULL, ?, ?, ?)`,
                [sectorId, px, py, pMeta, radius, sunId],
                (err) => err ? reject(err) : resolve()
            ));
        }

        // Asteroid/resource nodes biased by archetype
        const beltNodes = 20 + Math.floor(Math.random() * 20) + (arch.weights.asteroid_belt || 0) * 5;
        // Ensure resource types exist for references
        const getTypeId = (name) => new Promise((resolve) => db.get('SELECT id FROM resource_types WHERE resource_name = ?', [name], (e, r) => resolve(r?.id || null)));
        const rockId = await getTypeId('rock');
        for (let i = 0; i < beltNodes; i++) {
            const ring = 600 + Math.floor(Math.random() * 1800);
            const angle = Math.random() * 2 * Math.PI;
            const ax = Math.max(1, Math.min(4999, Math.round(sunX + Math.cos(angle) * ring)));
            const ay = Math.max(1, Math.min(4999, Math.round(sunY + Math.sin(angle) * ring)));
            const size = 1;
            const amount = 50 + Math.floor(Math.random() * 150);
            await new Promise((resolve, reject) => db.run(
                `INSERT INTO resource_nodes (sector_id, parent_object_id, resource_type_id, x, y, size, resource_amount, max_resource, harvest_difficulty, is_depleted, meta)
                 VALUES (?, NULL, ?, ?, ?, ?, ?, ?, 1.0, 0, NULL)`,
                [sectorId, rockId, ax, ay, size, amount, amount],
                (err) => err ? reject(err) : resolve()
            ));
        }

        return { success: true, sectorId, seed };
    }
};

module.exports = { SystemGenerator };

