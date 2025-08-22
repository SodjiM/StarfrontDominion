// Starfront: Dominion - Fleet list UI (ESM)

export function attachToolbarHandlers(game) {
    const debounce = (fn, wait=200) => { let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn.apply(game,a), wait);} };
    ['fleetSearch','fleetTypeFilter','fleetStatusFilter','fleetSectorFilter','fleetSort'].forEach(id=>{
        const el = document.getElementById(id); if (!el) return;
        el.oninput = el.onchange = debounce(()=> updateFleetList(game), 180);
    });
    const fav = document.getElementById('fleetFavoritesToggle');
    if (fav) {
        fav.onclick = () => {
            const active = fav.dataset.active === '1';
            fav.dataset.active = active ? '0' : '1';
            fav.classList.toggle('sf-btn-primary', !active);
            fav.classList.toggle('sf-btn-secondary', active);
            updateFleetList(game);
        };
    }
}

export async function updateFleetList(game) {
    if (!game || !game.gameState) return;
    const unitsList = document.getElementById('unitsList');
    if (!unitsList) return;

    try {
        const data = await SFApi.Players.playerFleet(game.gameId, game.userId);
        const fleet = data.fleet;
        if (!fleet || fleet.length === 0) {
            unitsList.classList.remove('loading');
            unitsList.innerHTML = '<div class="no-units">No units found</div>';
            game.lastFleet = [];
            try { const mod = await import('./player-panel.js'); mod.updatePlayerPanel(game); } catch {}
            return;
        }

        game.lastFleet = fleet;
        try { const mod = await import('./player-panel.js'); mod.updatePlayerPanel(game); } catch {}

        const unitsBySector = {};
        fleet.forEach(unit => {
            const sectorName = unit.sector_name || 'Unknown Sector';
            if (!unitsBySector[sectorName]) unitsBySector[sectorName] = [];
            unitsBySector[sectorName].push(unit);
        });

        const sectorFilterEl = document.getElementById('fleetSectorFilter');
        if (sectorFilterEl) {
            const current = sectorFilterEl.value || 'all';
            sectorFilterEl.innerHTML = '<option value="all">All Sectors</option>' +
                Object.keys(unitsBySector).sort().map(s => `<option value="${s}">${s}</option>`).join('');
            if ([...sectorFilterEl.options].some(o => o.value === current)) sectorFilterEl.value = current;
        }

        const q = (document.getElementById('fleetSearch')?.value || '').trim().toLowerCase();
        const typeFilter = document.getElementById('fleetTypeFilter')?.value || 'all';
        const statusFilter = document.getElementById('fleetStatusFilter')?.value || 'all';
        const sectorFilter = document.getElementById('fleetSectorFilter')?.value || 'all';
        const sortBy = document.getElementById('fleetSort')?.value || 'name';
        const onlyFav = document.getElementById('fleetFavoritesToggle')?.dataset?.active === '1';

        let html = '';
        Object.keys(unitsBySector).sort().forEach(sectorName => {
            const units = unitsBySector[sectorName];
            const isCurrentSector = game.gameState?.sector?.name === sectorName;
            if (sectorFilter !== 'all' && sectorFilter !== sectorName) return;

            html += `
                <div class="sector-group">
                    <div class="sector-header ${isCurrentSector ? 'current-sector' : ''}" data-action="toggle-sector" data-sector="${sectorName}">
                        <span class="chevron">▶</span>
                        <span class="sector-icon">${isCurrentSector ? '📍' : '🌌'}</span>
                        <span class="sector-name">${sectorName}</span>
                        <span class="unit-count">(${units.length})</span>
                    </div>
                    <div class="sector-units" id="sector-units-${game.safeId(sectorName)}" style="display:grid;width:100%;box-sizing:border-box;">
            `;

            const filtered = units.filter(unit => {
                const meta = unit.meta ? JSON.parse(unit.meta) : {};
                if (onlyFav && !game.isFavoriteUnit(unit.id)) return false;
                if (typeFilter !== 'all') {
                    const t = unit.type === 'ship' ? 'ship' : (unit.type === 'station' ? 'station' : 'structure');
                    if (t !== typeFilter) return false;
                }
                const status = game.getUnitStatus(meta, unit);
                if (statusFilter !== 'all' && status !== statusFilter) return false;
                const name = (meta.name || unit.type || '').toLowerCase();
                if (q && !name.includes(q)) return false;
                return true;
            }).sort((a,b)=>{
                const ma = a.meta ? JSON.parse(a.meta) : {};
                const mb = b.meta ? JSON.parse(b.meta) : {};
                if (sortBy === 'name') return (ma.name||a.type).localeCompare(mb.name||b.type);
                if (sortBy === 'status') return game.getUnitStatus(ma,a).localeCompare(game.getUnitStatus(mb,b));
                if (sortBy === 'cargo') return (game.getCargoFill(b)-game.getCargoFill(a));
                if (sortBy === 'eta') return (game.getEta(a)||999) - (game.getEta(b)||999);
                return 0;
            });

            filtered.forEach(unit => {
                const meta = unit.meta ? JSON.parse(unit.meta) : {};
                const isSelected = game.selectedUnit && game.selectedUnit.id === unit.id;
                const inCurrentSector = isCurrentSector;
                const status = game.getUnitStatus(meta, unit);
                const cargoFill = game.getCargoFill(unit);
                const eta = game.getEta(unit);
                html += `
                    <div class="unit-item ${isSelected ? 'selected' : ''} ${!inCurrentSector ? 'remote-unit' : ''}"
                         data-action="select-remote-unit" data-unit-id="${unit.id}" data-sector-id="${unit.sector_id}" data-sector-name="${sectorName}" data-in-current="${inCurrentSector}">
                        <div class="unit-header">
                            <span class="unit-icon">${game.getUnitIcon(unit.type)}</span>
                            <span class="unit-name">${meta.name || unit.type}</span>
                            ${!inCurrentSector ? '<span class="remote-indicator">📡</span>' : ''}
                        </div>
                        <div class="unit-meta">
                            <span class="chip">${sectorName}</span>
                            <span class="chip ${game.getStatusClass(status)}">${game.getStatusLabel(status)}</span>
                            ${unit.type==='ship' && cargoFill!=null ? `<span class="chip">📦 ${cargoFill}</span>` : ''}
                            ${eta ? `<span class="chip">⏱️ ETA ${eta}</span>` : ''}
                            <span class="favorite ${game.isFavoriteUnit(unit.id)?'active':''}" data-action="toggle-favorite" data-unit-id="${unit.id}">⭐</span>
                        </div>
                    </div>
                `;
            });

            html += `
                    </div>
                </div>
            `;
        });

        unitsList.classList.remove('loading');
        unitsList.innerHTML = html;
        unitsList.addEventListener('click', (e) => {
            const fav = e.target.closest('[data-action="toggle-favorite"]');
            if (fav) { e.stopPropagation(); const id = Number(fav.dataset.unitId); game.toggleFavoriteUnit(id); updateFleetList(game); return; }
            const header = e.target.closest('[data-action="toggle-sector"]');
            if (header) { const sectorName = header.dataset.sector; game.toggleSectorCollapse(sectorName); return; }
            const row = e.target.closest('[data-action="select-remote-unit"]');
            if (row) {
                const unitId = Number(row.dataset.unitId);
                const sectorId = Number(row.dataset.sectorId);
                const sectorName = row.dataset.sectorName;
                const inCurrent = String(row.dataset.inCurrent) === 'true';
                game.selectRemoteUnit(unitId, sectorId, sectorName, inCurrent);
                return;
            }
        });

        if (game.gameState?.objects) {
            const currentSectorShips = game.gameState.objects.filter(obj => obj.owner_id === game.userId && obj.type === 'ship');
            currentSectorShips.forEach(ship => {
                if (game.selectedUnit && ship.id === game.selectedUnit.id) {
                    try { SFCargo.updateCargoStatus(ship.id); } catch {}
                }
            });
        }
    } catch (error) {
        console.error('Error loading player fleet:', error);
        unitsList.classList.remove('loading');
        unitsList.innerHTML = '<div class="no-units">Error loading fleet</div>';
    }
}


