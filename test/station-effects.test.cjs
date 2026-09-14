const { test } = require('node:test');
const assert = require('node:assert/strict');
const celestial = require('../client/render/celestial-types');
const { getStationEffects } = require('../server/services/game/station-effects.service');
const db = require('../server/db');
const run = (sql, args=[]) => new Promise((resolve,reject)=>db.run(sql,args,function(e){e?reject(e):resolve(this)}));
const all = (sql,args=[]) => new Promise((resolve,reject)=>db.all(sql,args,(e,r)=>e?reject(e):resolve(r||[])));

test('all current celestial assets expose stable gameplay tags', () => {
    for (const key of ['ocean','rocky','iceWorld','gasGiant','cratered','volcanic','yellowDwarf','redDwarf','blueStar']) {
        assert.ok(celestial.types[key].gameplayTags.length >= 1, key);
    }
});

test('station effects use explicit scope and host gameplay type', () => {
    const effects = getStationEffects(
        { id: 8, parent_object_id: 3, meta: JSON.stringify({ stationClass: 'moon-station' }) },
        { id: 3, celestial_type: 'moon', meta: JSON.stringify({ gameplayType: 'cratered' }) }
    );
    assert.equal(effects.scope, 'local');
    assert.equal(effects.pilotCapacity, 3);
    assert.equal(effects.hostType, 'cratered');
    assert.deepEqual(effects.hostTags, ['reconnaissance', 'surveillance']);
});

test('operational bonuses respect system, region, and local scopes', async () => {
    await db.ready;
    const suffix = `${process.pid}-${Date.now()}`;
    const user=(await run(`INSERT INTO users(username,password) VALUES('effects-test-${suffix}','hash')`)).lastID;
    const game=(await run(`INSERT INTO games(name,status) VALUES('effects-test-${suffix}','active')`)).lastID;
    const sector=(await run("INSERT INTO sectors(game_id,name) VALUES(?,'effects')",[game])).lastID;
    await run("INSERT INTO regions(sector_id,region_id,cells_json,health) VALUES(?, 'A', ?, 50)",[sector,JSON.stringify([{row:0,col:0},{row:0,col:1},{row:0,col:2},{row:1,col:0},{row:1,col:1},{row:1,col:2},{row:2,col:0},{row:2,col:1},{row:2,col:2}])]);
    const star=(await run("INSERT INTO sector_objects(sector_id,type,celestial_type,x,y,meta) VALUES(?,'sun','star',2500,2500,?)",[sector,JSON.stringify({gameplayType:'blueStar'})])).lastID;
    await run("INSERT INTO sector_objects(sector_id,type,celestial_type,x,y,meta,owner_id,parent_object_id) VALUES(?,'station','station',2500,2500,?,?,?)",[sector,JSON.stringify({stationClass:'sun-station'}),user,star]);
    const ship=(await run("INSERT INTO sector_objects(sector_id,type,x,y,owner_id,meta) VALUES(?,'ship',2500,2500,?,?)",[sector,user,JSON.stringify({energyRegen:2})])).lastID;
    const { getOperationalBonuses } = require('../server/services/game/station-effects.service');
    const bonuses=await getOperationalBonuses(db,{id:ship,owner_id:user,sector_id:sector,x:2500,y:2500});
    assert.equal(bonuses.energyRegenMultiplier,0.1);
    assert.equal(bonuses.abilityCostMultiplier,-0.1);
    await new Promise(resolve=>db.close(resolve));
});
