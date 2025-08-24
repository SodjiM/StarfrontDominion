// SFApi - centralized REST helpers
// Exposes window.SFApi with small typed helpers and domain-specific methods

(function(){
  if (window.SFApi) return;

  async function getJson(url) {
    const res = await fetch(url);
    const data = await res.json().catch(()=>({}));
    if (!res.ok) throw Object.assign(new Error(data?.error || res.statusText), { status: res.status, data });
    return data;
  }

  async function postJson(url, body) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(()=>({}));
    if (!res.ok) throw Object.assign(new Error(data?.error || res.statusText), { status: res.status, data });
    return data;
  }

  // Domain: cargo/resources/build/sector/etc.
  const Cargo = {
    getCargo: (objectId, userId) => getJson(`/game/cargo/${objectId}?userId=${userId}`),
    transfer: (fromObjectId, toObjectId, resourceName, quantity, userId) => postJson('/game/transfer', { fromObjectId, toObjectId, resourceName, quantity, userId }),
  };

  const Resources = {
    listNearbyNodes: (gameId, shipId, userId, range) => getJson(`/game/resource-nodes/${gameId}/${shipId}?userId=${userId}${(range!=null)?`&range=${range}`:''}`),
  };

  const Abilities = {
    list: () => getJson('/game/abilities'),
    cooldowns: (objectId) => getJson(`/game/ability-cooldowns/${objectId}`),
  };

  const Players = {
    playerFleet: (gameId, userId) => getJson(`/game/player-fleet?gameId=${gameId}&userId=${userId}`),
  };

  const Build = {
    blueprints: () => getJson('/game/blueprints'),
    buildShip: (stationId, blueprintId, userId, freeBuild) => postJson('/game/build-ship', { stationId, blueprintId, userId, freeBuild }),
    buildShipLegacy: (stationId, shipType, cost, userId) => postJson('/game/build-ship', { stationId, shipType, cost, userId }),
    // buildShipBasic removed in favor of blueprint-driven flow
    buildStructure: (stationId, structureType, cost, userId) => postJson('/game/build-structure', { stationId, structureType, cost, userId }),
    deployStructure: (shipId, structureType, userId) => postJson('/game/deploy-structure', { shipId, structureType, userId }),
    listSectors: (gameId, userId) => getJson(`/game/sectors?gameId=${gameId}&userId=${userId}`),
    deployInterstellarGate: (shipId, destinationSectorId, userId) => postJson('/game/deploy-interstellar-gate', { shipId, destinationSectorId, userId })
  };

  const Travel = {
    // Deprecated HTTP; keep stub that throws to surface migration fast
    interstellarTravel: () => { throw { data: { error: 'deprecated', hint: 'Use socket event interstellar:travel' } }; }
  };

  const State = {
    systemFacts: (systemId) => getJson(`/game/system/${systemId}/facts`).catch(()=>null),
    galaxyGraph: (gameId) => getJson(`/game/${gameId}/galaxy-graph`),
    gameState: (gameId, userId, sectorId) => {
      const url = sectorId ? `/game/${gameId}/state/${userId}/sector/${sectorId}` : `/game/${gameId}/state/${userId}`;
      return getJson(url);
    },
    movementHistory: (gameId, userId, shipId, turns) => {
      const qs = shipId ? `?shipId=${shipId}&turns=${turns}` : `?turns=${turns}`;
      return getJson(`/game/${gameId}/movement-history/${userId}${qs}`);
    },
    sectorTrails: (sectorId, currentTurn, maxAge=10) => getJson(`/game/sector/${sectorId}/trails?sinceTurn=${currentTurn}&maxAge=${maxAge}`),
    combatLogs: (gameId, turnNumber) => getJson(`/combat/logs/${gameId}/${turnNumber}`),
    switchSector: (gameId, userId, sectorId) => postJson('/game/switch-sector', { gameId, userId, sectorId })
  };

  window.SFApi = { getJson, postJson, Cargo, Resources, Abilities, Players, Build, Travel, State };
})();


