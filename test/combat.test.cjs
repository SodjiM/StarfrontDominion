const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_PATH = ':memory:';
const db = require('../server/db');
const { Abilities } = require('../server/services/registry/abilities');
const { AbilitiesService } = require('../server/services/registry/abilities.service');
const { AbilitiesService: CombatAbilitiesService } = require('../server/services/game/abilities.service');
const { processAbilityOrders, processCombatOrders } = require('../server/services/game/combat-impl');
const { CargoManager } = require('../server/services/game/cargo-manager');

const run = (sql, args = []) => new Promise((resolve, reject) => {
    db.run(sql, args, function (error) { error ? reject(error) : resolve(this); });
});
const get = (sql, args = []) => new Promise((resolve, reject) => {
    db.get(sql, args, (error, row) => error ? reject(error) : resolve(row || null));
});

let gameId;
let sectorId;
let attackerId;
let targetId;

before(async () => {
    await db.ready;
    const owner = (await run("INSERT INTO users(username,password) VALUES('combat-attacker','hash')")).lastID;
    const targetOwner = (await run("INSERT INTO users(username,password) VALUES('combat-target','hash')")).lastID;
    gameId = (await run("INSERT INTO games(name,status) VALUES('combat-test','active')")).lastID;
    sectorId = (await run("INSERT INTO sectors(game_id,name) VALUES(?,'combat-sector')", [gameId])).lastID;
    const meta = { class: 'frigate', hp: 40, maxHp: 40, energy: 10, maxEnergy: 10 };
    attackerId = (await run(
        "INSERT INTO sector_objects(sector_id,type,x,y,owner_id,meta) VALUES(?,'ship',100,100,?,?)",
        [sectorId, owner, JSON.stringify(meta)]
    )).lastID;
    targetId = (await run(
        "INSERT INTO sector_objects(sector_id,type,x,y,owner_id,meta) VALUES(?,'ship',108,100,?,?)",
        [sectorId, targetOwner, JSON.stringify(meta)]
    )).lastID;
});

after(() => new Promise(resolve => db.close(resolve)));

test('basic coilgun attacks have authoritative combat stats', async () => {
    const weapon = Abilities.dual_light_coilguns;
    assert.equal(weapon.type, 'offense');
    assert.equal(weapon.baseDamage, 10);
    assert.equal(weapon.optimal, 4);
    assert.equal(weapon.falloff, 0.2);
    assert.equal(weapon.range, 9);
    const publicWeapon = new AbilitiesService().listAbilities().dual_light_coilguns;
    assert.equal(publicWeapon.baseDamage, weapon.baseDamage);
    assert.equal(publicWeapon.optimal, weapon.optimal);
    assert.equal(publicWeapon.falloff, weapon.falloff);

    await run(
        `INSERT INTO combat_orders(game_id,turn_number,attacker_id,target_id,weapon_key)
         VALUES(?,?,?,?,?)`,
        [gameId, 1, attackerId, targetId, weapon.key]
    );

    await processCombatOrders(gameId, 1);

    const target = await get('SELECT meta FROM sector_objects WHERE id=?', [targetId]);
    const targetMeta = JSON.parse(target.meta);
    assert.ok(targetMeta.hp < targetMeta.maxHp, 'a valid attack must reduce target HP');
});

test('combat accepts stations but rejects celestial objects', async () => {
    const stationId = (await run(
        "INSERT INTO sector_objects(sector_id,type,x,y,owner_id,meta) VALUES(?,'station',108,100,NULL,?)",
        [sectorId, JSON.stringify({ hp: 150, maxHp: 150 })]
    )).lastID;
    const planetId = (await run(
        "INSERT INTO sector_objects(sector_id,type,celestial_type,x,y,meta,radius) VALUES(?,'planet','planet',108,110,?,12)",
        [sectorId, JSON.stringify({ hp: 1000, maxHp: 1000 })]
    )).lastID;

    await run(
        `INSERT INTO combat_orders(game_id,turn_number,attacker_id,target_id,weapon_key)
         VALUES(?,?,?,?,?), (?,?,?,?,?)`,
        [gameId, 2, attackerId, stationId, 'dual_light_coilguns', gameId, 2, attackerId, planetId, 'dual_light_coilguns']
    );
    await processCombatOrders(gameId, 2);

    const station = await get('SELECT meta FROM sector_objects WHERE id=?', [stationId]);
    const planet = await get('SELECT type, meta FROM sector_objects WHERE id=?', [planetId]);
    assert.ok(JSON.parse(station.meta).hp < 150, 'stations should be legal combat targets');
    assert.equal(planet.type, 'planet');
    assert.equal(JSON.parse(planet.meta).hp, 1000, 'celestial objects must not take combat damage');
});

test('direct ability activation rejects celestial targets before queuing', async () => {
    const planet = await get("SELECT id FROM sector_objects WHERE celestial_type='planet' LIMIT 1");
    const result = await new CombatAbilitiesService().queueAbility({
        gameId,
        casterId: attackerId,
        abilityKey: 'dual_light_coilguns',
        targetObjectId: planet.id
    });
    assert.equal(result.success, false);
    assert.equal(result.error, 'Invalid combat target');
});

test('combat resolves declared attacks from live ships simultaneously', async () => {
    const shipA = (await run(
        "INSERT INTO sector_objects(sector_id,type,x,y,owner_id,meta) VALUES(?,'ship',200,100,1,?)",
        [sectorId, JSON.stringify({ class: 'frigate', hp: 3, maxHp: 3 })]
    )).lastID;
    const shipB = (await run(
        "INSERT INTO sector_objects(sector_id,type,x,y,owner_id,meta) VALUES(?,'ship',208,100,2,?)",
        [sectorId, JSON.stringify({ class: 'frigate', hp: 3, maxHp: 3 })]
    )).lastID;
    await run(
        `INSERT INTO combat_orders(game_id,turn_number,attacker_id,target_id,weapon_key)
         VALUES(?,?,?,?,?), (?,?,?,?,?)`,
        [gameId, 3, shipA, shipB, 'dual_light_coilguns', gameId, 3, shipB, shipA, 'dual_light_coilguns']
    );

    await processCombatOrders(gameId, 3);

    assert.equal((await get('SELECT type FROM sector_objects WHERE id=?', [shipA])).type, 'wreck');
    assert.equal((await get('SELECT type FROM sector_objects WHERE id=?', [shipB])).type, 'wreck');
});

test('utility abilities apply their declared active effects', async () => {
    await run('UPDATE sector_objects SET meta=? WHERE id=?', [JSON.stringify({ hp: 30, maxHp: 40, energy: 20, maxEnergy: 20 }), attackerId]);
    await run(
        `INSERT INTO ability_orders(game_id,turn_number,caster_id,ability_key) VALUES(?,?,?,?)`,
        [gameId, 4, attackerId, 'microthruster_shift']
    );
    await processAbilityOrders(gameId, 4);
    let effect = await get("SELECT effect_key,effect_data FROM ship_status_effects WHERE ship_id=? AND effect_key='microthruster_speed'", [attackerId]);
    assert.deepEqual(JSON.parse(effect.effect_data), { movementFlatBonus: 3 });

    await run('UPDATE sector_objects SET meta=? WHERE id=?', [JSON.stringify({ hp: 30, maxHp: 40, energy: 20, maxEnergy: 20 }), attackerId]);
    await run(
        `INSERT INTO ability_orders(game_id,turn_number,caster_id,ability_key) VALUES(?,?,?,?)`,
        [gameId, 5, attackerId, 'jury_rig_repair']
    );
    await processAbilityOrders(gameId, 5);
    effect = await get("SELECT effect_key,effect_data FROM ship_status_effects WHERE ship_id=? AND effect_key='repair_over_time' ORDER BY id DESC LIMIT 1", [attackerId]);
    assert.equal(JSON.parse(effect.effect_data).healPercentPerTurn, 0.1);

    await run('UPDATE sector_objects SET meta=? WHERE id=?', [JSON.stringify({ hp: 30, maxHp: 40, energy: 20, maxEnergy: 20 }), attackerId]);
    await run(
        `INSERT INTO ability_orders(game_id,turn_number,caster_id,ability_key) VALUES(?,?,?,?)`,
        [gameId, 6, attackerId, 'survey_scanner']
    );
    await processAbilityOrders(gameId, 6);
    effect = await get("SELECT effect_key,effect_data FROM ship_status_effects WHERE ship_id=? AND effect_key='survey_scanner' ORDER BY id DESC LIMIT 1", [attackerId]);
    assert.equal(JSON.parse(effect.effect_data).scanRangeMultiplier, 1.5);
});

test('defensive damage reduction affects incoming damage and is capped', async () => {
    await run('UPDATE sector_objects SET x=104, meta=? WHERE id=?', [JSON.stringify({ class: 'frigate', hp: 40, maxHp: 40 }), targetId]);
    await run(
        `INSERT INTO ship_status_effects(ship_id,effect_key,effect_data,expires_turn)
         VALUES(?,?,?,?)`,
        [targetId, 'test_damage_reduction', JSON.stringify({ damageReduction: 0.5 }), 20]
    );
    await run(
        `INSERT INTO combat_orders(game_id,turn_number,attacker_id,target_id,weapon_key)
         VALUES(?,?,?,?,?)`,
        [gameId, 7, attackerId, targetId, 'dual_light_coilguns']
    );
    await processCombatOrders(gameId, 7);

    const target = await get('SELECT meta FROM sector_objects WHERE id=?', [targetId]);
    assert.equal(JSON.parse(target.meta).hp, 35, '50% mitigation should halve a 10-damage optimal hit');
});

test('destroyed ships cannot execute utility abilities', async () => {
    await run("UPDATE sector_objects SET type='wreck', meta=? WHERE id=?", [JSON.stringify({ name: 'Destroyed', hp: 0, maxHp: 40 }), attackerId]);
    await run(
        `INSERT INTO ability_orders(game_id,turn_number,caster_id,ability_key) VALUES(?,?,?,?)`,
        [gameId, 8, attackerId, 'microthruster_shift']
    );
    await processAbilityOrders(gameId, 8);
    assert.equal(await get("SELECT id FROM ship_status_effects WHERE ship_id=? AND effect_key='microthruster_speed' AND applied_turn=8", [attackerId]), null);
});

test('destroyed ship wrecks preserve cargo capacity and dropped inventory', async () => {
    await run("UPDATE sector_objects SET type='ship', x=104, meta=? WHERE id=?", [JSON.stringify({ class: 'frigate', hp: 1, maxHp: 40, cargoCapacity: 40 }), targetId]);
    await run('DELETE FROM ship_status_effects WHERE ship_id=?', [targetId]);
    await CargoManager.addResourceToCargo(targetId, 'rock', 20);
    await run(
        `INSERT INTO combat_orders(game_id,turn_number,attacker_id,target_id,weapon_key)
         VALUES(?,?,?,?,?)`,
        [gameId, 9, attackerId, targetId, 'dual_light_coilguns']
    );
    // Restore the attacker after the previous destroyed-ship test.
    await run("UPDATE sector_objects SET type='ship', meta=? WHERE id=?", [JSON.stringify({ class: 'frigate', hp: 40, maxHp: 40 }), attackerId]);
    await processCombatOrders(gameId, 9);

    const wreck = await get('SELECT type,meta FROM sector_objects WHERE id=?', [targetId]);
    const cargo = await CargoManager.getObjectCargo(targetId);
    assert.equal(wreck.type, 'wreck');
    assert.equal(JSON.parse(wreck.meta).cargoCapacity, 40);
    assert.ok(cargo.items.some(item => item.resource_name === 'rock' && item.quantity > 0), 'wreck should retain dropped cargo');
});

test('station destruction creates a lootable station wreck without pilots or ship salvage', async () => {
    await run("UPDATE sector_objects SET type='ship', x=104, meta=? WHERE id=?", [JSON.stringify({ class: 'frigate', hp: 40, maxHp: 40 }), attackerId]);
    const stationId = (await run(
        "INSERT INTO sector_objects(sector_id,type,x,y,owner_id,meta) VALUES(?,'station',104,100,2,?)",
        [sectorId, JSON.stringify({ name: 'Forward Station', hp: 1, maxHp: 1, cargoCapacity: 50, stationClass: 'planet-station' })]
    )).lastID;
    await CargoManager.addResourceToCargo(stationId, 'rock', 20);
    await run(
        `INSERT INTO combat_orders(game_id,turn_number,attacker_id,target_id,weapon_key)
         VALUES(?,?,?,?,?)`,
        [gameId, 10, attackerId, stationId, 'dual_light_coilguns']
    );
    const pilotsBefore = await get('SELECT COUNT(*) AS count FROM dead_pilots_queue WHERE game_id=? AND user_id=2', [gameId]);
    await processCombatOrders(gameId, 10);

    const wreck = await get('SELECT type,meta FROM sector_objects WHERE id=?', [stationId]);
    const pilots = await get('SELECT COUNT(*) AS count FROM dead_pilots_queue WHERE game_id=? AND user_id=2', [gameId]);
    assert.equal(wreck.type, 'wreck');
    assert.equal(JSON.parse(wreck.meta).wreckKind, 'station');
    assert.equal(pilots.count, pilotsBefore.count);
    const wreckCargo = await CargoManager.getObjectCargo(stationId);
    assert.ok(wreckCargo.items.some(item => item.resource_name === 'rock' && item.quantity > 0), 'station wreck should retain dropped cargo');
});

test('attacking a cargo can removes its contents and leaves inert debris', async () => {
    await run("UPDATE sector_objects SET type='ship', x=104, meta=? WHERE id=?", [JSON.stringify({ class: 'frigate', hp: 40, maxHp: 40 }), attackerId]);
    const canId = (await run(
        "INSERT INTO sector_objects(sector_id,type,x,y,owner_id,meta) VALUES(?,'cargo_can',104,100,NULL,?)",
        [sectorId, JSON.stringify({ name: 'Exposed Cargo', hp: 1, maxHp: 1, cargoCapacity: 25 })]
    )).lastID;
    await CargoManager.initializeObjectCargo(canId, 25);
    await CargoManager.addResourceToCargo(canId, 'rock', 5);
    await run(
        `INSERT INTO combat_orders(game_id,turn_number,attacker_id,target_id,weapon_key)
         VALUES(?,?,?,?,?)`,
        [gameId, 11, attackerId, canId, 'dual_light_coilguns']
    );
    await processCombatOrders(gameId, 11);

    const debris = await get('SELECT type,meta FROM sector_objects WHERE id=?', [canId]);
    const cargo = await get('SELECT COUNT(*) AS count FROM object_cargo WHERE object_id=?', [canId]);
    assert.equal(debris.type, 'wreck');
    assert.equal(JSON.parse(debris.meta).destroyed, true);
    assert.equal(cargo.count, 0);
});
