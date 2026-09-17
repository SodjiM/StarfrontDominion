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
    structureCosts: () => getJson('/game/structure-costs'),
    blueprints: () => getJson('/game/blueprints'),
    buildShipPreview: (stationId, blueprintId, userId) => postJson('/game/build-ship-preview', { stationId, blueprintId, userId }),
    buildShip: (stationId, blueprintId, userId, freeBuild, clientOrderId) => postJson('/game/build-ship', { stationId, blueprintId, userId, freeBuild, clientOrderId }),
    listShipBuilds: (stationId, userId, history=false) => getJson(`/game/ship-builds/${stationId}?history=${history ? '1' : '0'}&userId=${userId}`),
    cancelShipBuild: (buildId, userId) => postJson('/game/cancel-ship-build', { buildId, userId }),
    buildStructure: (stationId, structureType, userId) => postJson('/game/build-structure', { stationId, structureType, userId }),
    deployStructure: (shipId, structureType, userId, anchorObjectId) => postJson('/game/deploy-structure', { shipId, structureType, userId, ...(anchorObjectId ? { anchorObjectId } : {}) }),
    listSectors: (gameId, userId) => getJson(`/game/sectors?gameId=${gameId}&userId=${userId}`),
    deployInterstellarGate: (shipId, destinationSectorId, userId) => postJson('/game/deploy-interstellar-gate', { shipId, destinationSectorId, userId })
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
    turnReport: (gameId, turnNumber) => getJson(`/game/turn-report/${gameId}/${turnNumber}`),
    activity: (gameId, limit=50, afterId=null, snapshotBoundary=null) => getJson(`/game/${gameId}/activity?limit=${encodeURIComponent(limit)}${afterId != null ? `&afterId=${encodeURIComponent(afterId)}` : ''}${snapshotBoundary != null ? `&snapshotBoundary=${encodeURIComponent(snapshotBoundary)}` : ''}`),
    ackActivity: (gameId, boundary) => postJson(`/game/${gameId}/activity/ack`, { boundary }),
    stationEffects: (stationId) => getJson(`/game/station-effects/${stationId}`),
    switchSector: (gameId, userId, sectorId) => postJson('/game/switch-sector', { gameId, userId, sectorId }),
    itineraries: (gameId, userId, sectorId) => {
      const qs = sectorId ? `?sectorId=${sectorId}` : '';
      return getJson(`/game/${gameId}/itineraries/${userId}${qs}`);
    }
  };

  const Senate = {
    state: (gameId) => getJson(`/game/senate/${gameId}/state`),
    select: (gameId, candidateId, stationId, replaceSenatorId) => postJson(`/game/senate/${gameId}/select`, { candidateId, stationId, ...(replaceSenatorId ? { replaceSenatorId } : {}) }),
    close: (gameId) => postJson(`/game/senate/${gameId}/close`, {}),
    setPolicy: (gameId, policyKey, active) => postJson(`/game/senate/${gameId}/policy`, { policyKey, active })
  };

  window.SFApi = { getJson, postJson, Cargo, Resources, Abilities, Players, Build, State, Senate };
})();
