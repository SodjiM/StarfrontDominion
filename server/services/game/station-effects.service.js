const celestialTypes = require('../../../client/render/celestial-types');

const BASE = Object.freeze({
  'sun-station': { scope: 'system', label: 'System command', pilotCapacity: 10, effects: ['+10 pilot capacity', 'System-wide station effects'] },
  'planet-station': { scope: 'region', label: 'Regional production', pilotCapacity: 5, effects: ['+5 pilot capacity', 'Regional station effects'] },
  'moon-station': { scope: 'local', label: 'Local forward base', pilotCapacity: 3, effects: ['+3 pilot capacity', 'Local-radius station effects'] }
});

const HOST_EFFECTS = Object.freeze({
  yellowDwarf: { label: 'Stable administration', pilotRegenMultiplier: 0.10 },
  redDwarf: { label: 'Industrial endurance', repairMultiplier: 0.15, structureHpMultiplier: 0.10 },
  blueStar: { label: 'High-energy military', energyRegenMultiplier: 0.10, abilityCostMultiplier: -0.10, abilityRangeMultiplier: 0.05 },
  ocean: { label: 'Development and politics', pilotRegenMultiplier: 0.10, politicalInfluenceMultiplier: 0.10 },
  rocky: { label: 'Mining and industry', resourceYield: { rock: 0.25, mineral: 0.25 } },
  iceWorld: { label: 'Transport and support', repairMultiplier: 0.15, fuelConsumptionMultiplier: -0.10 },
  gasGiant: { label: 'Fuel and mobility', resourceYield: { gas: 0.25 } },
  cratered: { label: 'Reconnaissance and surveillance', scanRangeMultiplier: 0.25, reconDeployableCostMultiplier: -0.25 },
  volcanic: { label: 'Raiding and interdiction', resourceYield: { salvage: 0.15 }, combatDamageMultiplier: 0.05, interdictionCostMultiplier: -0.25 }
});

function parseMeta(value) { if (!value) return {}; if (typeof value === 'object') return value; try { return JSON.parse(value) || {}; } catch { return {}; } }

function getStationEffects(station, host) {
  const stationMeta = parseMeta(station?.meta);
  const hostMeta = parseMeta(host?.meta);
  const hostType = hostMeta.gameplayType || hostMeta.visualType || celestialTypes.resolve(host || {})?.key || null;
  const hostDefinition = hostType ? celestialTypes.types[hostType] : null;
  const base = BASE[stationMeta.stationClass] || BASE['planet-station'];
  const hostEffects = HOST_EFFECTS[hostType] || {};
  const effects = base.effects.slice();
  if (hostEffects.label) effects.push(hostEffects.label);
  if (hostEffects.resourceYield?.rock) effects.push(`+${Math.round(hostEffects.resourceYield.rock * 100)}% rock and metal yield in region`);
  if (hostEffects.resourceYield?.gas) effects.push(`+${Math.round(hostEffects.resourceYield.gas * 100)}% gas yield in region`);
  if (hostEffects.resourceYield?.salvage) effects.push(`+${Math.round(hostEffects.resourceYield.salvage * 100)}% salvage yield within local radius`);
  if (hostEffects.scanRangeMultiplier) effects.push(`+${Math.round(hostEffects.scanRangeMultiplier * 100)}% scan range within local radius`);
  if (hostEffects.repairMultiplier) effects.push(`+${Math.round(hostEffects.repairMultiplier * 100)}% repair effectiveness`);
  if (hostEffects.energyRegenMultiplier) effects.push(`+${Math.round(hostEffects.energyRegenMultiplier * 100)}% energy regeneration in system`);
  if (hostEffects.abilityCostMultiplier) effects.push(`${Math.round(hostEffects.abilityCostMultiplier * 100)}% ability energy cost in system`);
  if (hostEffects.combatDamageMultiplier) effects.push(`+${Math.round(hostEffects.combatDamageMultiplier * 100)}% damage for up to six nearby ships`);
  return {
    stationId: station?.id ?? null,
    stationClass: stationMeta.stationClass || null,
    scope: base.scope,
    role: base.label,
    hostId: host?.id ?? station?.parent_object_id ?? null,
    hostType,
    hostLabel: hostDefinition?.label || hostType || 'Unknown host',
    hostTags: hostDefinition?.gameplayTags || hostMeta.gameplayTags || [],
    pilotCapacity: base.pilotCapacity,
    effects,
    hostEffectValues: hostEffects
  };
}

function regionAt(x, y, regions) {
  const col = Math.max(0, Math.min(2, Math.floor(Number(x || 0) / 5000 * 3)));
  const row = Math.max(0, Math.min(2, Math.floor(Number(y || 0) / 5000 * 3)));
  for (const region of regions || []) {
    try { if ((JSON.parse(region.cells_json || '[]') || []).some(cell => Number(cell.row) === row && Number(cell.col) === col)) return String(region.region_id); } catch {}
  }
  return null;
}

async function getOperationalBonuses(db, actor, { resourceName = null } = {}) {
  if (!actor?.owner_id || !actor?.sector_id) return {};
  const all = (sql, args) => new Promise((resolve, reject) => db.all(sql, args, (e, rows) => e ? reject(e) : resolve(rows || [])));
  const stations = await all(`SELECT so.*, parent.meta AS host_meta, parent.celestial_type AS host_celestial_type
    FROM sector_objects so LEFT JOIN sector_objects parent ON parent.id=so.parent_object_id
    WHERE so.owner_id=? AND so.type='station'`, [actor.owner_id]);
  const regions = await all('SELECT region_id,cells_json FROM regions WHERE sector_id=?', [actor.sector_id]);
  const actorRegion = regionAt(actor.x, actor.y, regions);
  const out = { resourceYield: 0, repairMultiplier: 0, energyRegenMultiplier: 0, abilityCostMultiplier: 0, abilityRangeMultiplier: 0, combatDamageMultiplier: 0, scanRangeMultiplier: 0 };
  for (const station of stations) {
    const stationMeta = parseMeta(station.meta), hostMeta = parseMeta(station.host_meta);
    const hostType = hostMeta.gameplayType || hostMeta.visualType || celestialTypes.resolve({ ...station, meta: hostMeta, celestial_type: station.host_celestial_type })?.key;
    const host = HOST_EFFECTS[hostType]; if (!host) continue;
    const scope = BASE[stationMeta.stationClass]?.scope || 'region';
    let applies = false;
    if (scope === 'system') applies = Number(station.sector_id) === Number(actor.sector_id);
    else if (scope === 'region') applies = Number(station.sector_id) === Number(actor.sector_id) && regionAt(station.x, station.y, regions) === actorRegion;
    else applies = Number(station.sector_id) === Number(actor.sector_id) && Math.hypot(Number(station.x) - Number(actor.x), Number(station.y) - Number(actor.y)) <= 200;
    if (!applies) continue;
    out.repairMultiplier += Number(host.repairMultiplier || 0);
    out.energyRegenMultiplier += Number(host.energyRegenMultiplier || 0);
    out.abilityCostMultiplier += Number(host.abilityCostMultiplier || 0);
    out.abilityRangeMultiplier += Number(host.abilityRangeMultiplier || 0);
    out.scanRangeMultiplier += Number(host.scanRangeMultiplier || 0);
    if (resourceName) {
      const category = resourceName === 'gas' ? 'gas' : resourceName === 'salvage' ? 'salvage' : /alloy|ium|ite|dust|ore|carbon|gold|glass/i.test(resourceName) ? 'mineral' : 'rock';
      out.resourceYield += Number(host.resourceYield?.[resourceName] || host.resourceYield?.[category] || 0);
    }
    if (host.combatDamageMultiplier && scope === 'local') {
      const nearby = await new Promise((resolve) => db.get(`SELECT COUNT(*) AS count FROM sector_objects WHERE owner_id=? AND type='ship' AND sector_id=? AND ((x-?)*(x-?)+(y-?)*(y-?)) <= 40000`, [actor.owner_id,actor.sector_id,station.x,station.x,station.y,station.y], (e,r)=>resolve(Number(r?.count||0))));
      if (nearby <= 6) out.combatDamageMultiplier = Math.max(out.combatDamageMultiplier, Number(host.combatDamageMultiplier));
    }
  }
  return out;
}

module.exports = { BASE, HOST_EFFECTS, getStationEffects, getOperationalBonuses, parseMeta, regionAt };
