const db = require('../../../db');
const { BaseStep } = require('./base-step');
const { SHIP_BLUEPRINTS } = require('../../registry/blueprints');
const { Abilities } = require('../../registry/abilities');
const { CargoManager } = require('../../../cargo-manager');

class CreateStartingObjectsStep extends BaseStep {
    constructor() { super('createStartingObjects'); }
    async execute(context, options) {
        if (!options.createStartingObjects || !options.player) { this.result = { skipped: true }; return; }

        const sectorId = context.sectorId;
        const userId = options.player.user_id;

        // Determine an anchor position and ensure a station exists for this sector
        let stationRow = await new Promise((resolve) => db.get(
            'SELECT id, x, y FROM sector_objects WHERE sector_id = ? AND type = "station" AND owner_id = ? LIMIT 1',
            [sectorId, userId],
            (e, r) => resolve(r || null)
        ));

        if (!stationRow) {
            // Pick a planet; if none, place near sun
            const planet = await new Promise((resolve)=>db.get('SELECT id, x, y FROM sector_objects WHERE sector_id = ? AND celestial_type = "planet" LIMIT 1', [sectorId], (e,r)=>resolve(r||null)));
            let x = 2500, y = 2500, parentId = null;
            if (planet) {
                const angle = Math.random() * Math.PI * 2; const dist = 22;
                x = Math.max(1, Math.min(4999, Math.round(planet.x + Math.cos(angle) * dist)));
                y = Math.max(1, Math.min(4999, Math.round(planet.y + Math.sin(angle) * dist)));
                parentId = planet.id;
            } else {
                const sun = await new Promise((resolve)=>db.get('SELECT id, x, y FROM sector_objects WHERE sector_id = ? AND celestial_type = "star" LIMIT 1', [sectorId], (e,r)=>resolve(r||{id:null,x:2500,y:2500})));
                const angle = Math.random() * Math.PI * 2; const dist = 28;
                x = Math.max(1, Math.min(4999, Math.round(sun.x + Math.cos(angle) * dist)));
                y = Math.max(1, Math.min(4999, Math.round(sun.y + Math.sin(angle) * dist)));
                parentId = sun.id || null;
            }

            const stationMeta = JSON.stringify({ 
                name: `${options.player.username || 'Player'} Station`, 
                hp: 100, maxHp: 100, scanRange: 200, cargoCapacity: 50, stationClass: 'planet-station' 
            });

            const stationId = await new Promise((resolve, reject) => db.run(
                `INSERT INTO sector_objects (sector_id, type, x, y, owner_id, meta, parent_object_id) VALUES (?, 'station', ?, ?, ?, ?, ?)`,
                [sectorId, x, y, userId, stationMeta, parentId],
                function(err){ return err ? reject(err) : resolve(this.lastID); }
            ));

            // Initialize station cargo (best-effort)
            try {
                await CargoManager.initializeObjectCargo(stationId, 50);
                await CargoManager.addResourceToCargo(stationId, 'rock', 25, false);
            } catch (error) {
                console.warn('Failed to initialize station cargo:', error);
            }

            stationRow = { id: stationId, x, y };
            console.log(`Created starting station for user ${userId} at (${x},${y}) in sector ${sectorId}`);
        }

        // Ensure at least one starter ship exists for this player in this sector
        const hasShip = await new Promise((resolve) => db.get(
            'SELECT id FROM sector_objects WHERE sector_id = ? AND owner_id = ? AND type = "ship" LIMIT 1',
            [sectorId, userId],
            (e, r) => resolve(!!r)
        ));

        if (!hasShip) {
            try {
                const blueprint = (SHIP_BLUEPRINTS || []).find(b => b.id === 'explorer');
                const bp = blueprint || { name: 'Explorer', class: 'frigate', scanRange: 50, movementSpeed: 4, cargoCapacity: 10, abilities: ['dual_light_coilguns','boost_engines','jury_rig_repair','survey_scanner','duct_tape_resilience','prospector_microlasers'] };
                const shipMetaObj = {
                    name: `${bp.name}`,
                    ...bp,
                    shipType: bp.class,
                    blueprintId: bp.id || 'explorer'
                };
                if (!Array.isArray(shipMetaObj.abilities)) shipMetaObj.abilities = [];
                shipMetaObj.abilities = shipMetaObj.abilities.filter(k => !!Abilities[k]);

                const shipMeta = JSON.stringify(shipMetaObj);
                const sx = (stationRow?.x ?? 2500) + (Math.random() < 0.5 ? -1 : 1);
                const sy = (stationRow?.y ?? 2500) + (Math.random() < 0.5 ? -1 : 1);

                const shipId = await new Promise((resolve, reject) => db.run(
                    `INSERT INTO sector_objects (sector_id, type, x, y, owner_id, meta, scan_range, movement_speed, can_active_scan) VALUES (?, 'ship', ?, ?, ?, ?, ?, ?, ?)`,
                    [sectorId, sx, sy, userId, shipMeta, shipMetaObj.scanRange, shipMetaObj.movementSpeed, shipMetaObj.canActiveScan ? 1 : 0],
                    function(err){ return err ? reject(err) : resolve(this.lastID); }
                ));

                try {
                    await CargoManager.initializeShipCargo(shipId, shipMetaObj.cargoCapacity || 0);
                } catch (error) {
                    console.warn('Ship created but cargo initialization failed:', error);
                }

                console.log(`Created starting ship for user ${userId} at (${sx},${sy}) in sector ${sectorId}`);
            } catch (error) {
                console.warn('Failed to create starting ship:', error);
            }
        }

        this.result = { startingObjectsCreated: true };
    }
}

module.exports = { CreateStartingObjectsStep };


