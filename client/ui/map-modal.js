// Map modal helpers
import { filterAndNormalizeRoutes, confirmRoute, normalizeLeg } from '../features/travel-planner.js';
const debug = (...args) => { try { if (window.__DEV_WARP_DEBUG) console.log(...args); } catch {} };

export async function populateSystemFacts(game) {
    try {
        const wrap = document.getElementById('sysMetaSummary');
        if (!wrap || !game?.gameState?.sector) return;
        const sector = game.gameState.sector; const systemId = sector.id;
        // Fetch server-side mineral display buckets and aggregation
        let primaryList = []; let secondaryList = []; let coreList = [];
        try {
            const facts = await SFApi.State.systemFacts(systemId);
            const minerals = Array.isArray(facts?.minerals) ? facts.minerals : [];
            const counts = new Map(minerals.map(m => [String(m.name), Number(m.count||0)]));
            const disp = facts?.mineralDisplay || {};
            const fmt = (name, mult) => `${name} ${mult}${counts.has(name) ? ` - ${counts.get(name)}` : ''}`;
            coreList = (disp.core || []).map(m => fmt(m.name, m.mult));
            primaryList = (disp.primary || []).map(m => fmt(m.name, m.mult));
            secondaryList = (disp.secondary || []).map(m => fmt(m.name, m.mult));
            primaryList.sort((a,b)=>b[1]-a[1]);
            secondaryList.sort((a,b)=>b[1]-a[1]);
        } catch {}

        const chip = (txt) => `<span style="display:inline-block; padding:2px 6px; border:1px solid rgba(100,181,246,0.25); border-radius:10px; margin:2px; font-size:11px; color:#cfe8ff; white-space:nowrap;">${txt}</span>`;
        const chipList = (arr) => arr.length ? `<div style="display:flex; flex-wrap:wrap; align-items:flex-start;">${arr.map(chip).join('')}</div>` : '—';
        wrap.innerHTML = `
            <div class="facts-grid" style="display:grid; grid-template-columns: 1.1fr 1fr 1fr 1fr; column-gap:14px; row-gap:8px; align-items:start;">
                <div>
                    <div style="margin-bottom:6px;"><b>Name:</b> ${sector.name}</div>
                    <div><b>Type:</b> ${sector.archetype || 'standard'}</div>
                </div>
                <div>
                    <div style="margin-bottom:4px;"><b>Core</b></div>
                    ${chipList(coreList)}
                </div>
                <div>
                    <div style="margin-bottom:4px;"><b>Primary</b></div>
                    ${chipList(primaryList)}
                </div>
                <div>
                    <div style="margin-bottom:4px;"><b>Secondary</b></div>
                    ${chipList(secondaryList)}
                </div>
            </div>`;
    } catch (e) {
        const wrap = document.getElementById('sysMetaSummary'); if (wrap) wrap.innerText = 'Failed to load system facts';
    }
}

export async function loadGalaxyData(game) {
    try {
        const galaxyList = document.getElementById('galaxySystemsList'); if (!galaxyList || !game) return;
        const currentSystem = {
            name: game.gameState?.sector?.name || 'Current System',
            id: game.gameState?.sector?.id,
            players: 1,
            status: 'Active',
            turn: game.gameState?.turn?.number || 1,
            celestialObjects: game.objects ? game.objects.filter(obj => isCelestialObject(game, obj)).length : 0
        };
        galaxyList.innerHTML = `
            <div class="galaxy-system-card" data-action="select-system" data-system-id="${currentSystem.id}">
                <div class="galaxy-system-name">${currentSystem.name}</div>
                <div class="galaxy-system-info">
                    <div>👥 ${currentSystem.players} Player${currentSystem.players !== 1 ? 's' : ''}</div>
                    <div>⏰ Turn ${currentSystem.turn}</div>
                    <div>🛰️ ${currentSystem.celestialObjects} Celestial Objects</div>
                    <div>📈 Status: <span style="color: #4CAF50;">${currentSystem.status}</span></div>
                </div>
            </div>
            <div class="galaxy-system-card" style="opacity: 0.5; cursor: not-allowed;">
                <div class="galaxy-system-name">Distant Systems</div>
                <div class="galaxy-system-info">
                    <div style="color: #888;">🧭 Coming Soon</div>
                    <div style="color: #666; font-size: 0.8em;">Multi-system gameplay will be available in future updates</div>
                </div>
            </div>`;
        if (!galaxyList.__systemClickBound) {
            galaxyList.addEventListener('click', (e) => {
                const row = e.target.closest('[data-action="select-system"]');
                if (row) selectGalaxySystem(game, Number(row.dataset.systemId));
            });
            galaxyList.__systemClickBound = true;
        }
    } catch (error) {
        console.error('Error loading galaxy data:', error);
        const galaxyList = document.getElementById('galaxySystemsList');
        if (galaxyList) galaxyList.innerHTML = `<div style="text-align: center; color: #f44336; padding: 40px;">❌ Failed to load galaxy data</div>`;
    }
}

export function selectGalaxySystem(game, systemId) {
    if (Number(systemId) === Number(game.gameState?.sector?.id)) {
        try {
            const root = document.querySelector('.map-modal');
            if (!root) return;
            const firstTab = root.querySelector('.map-tab[data-tab="solar-system"]');
            if (firstTab) firstTab.click();
        } catch {}
    } else {
        game.addLogEntry('Multi-system navigation coming soon!', 'info');
    }
}

function isCelestialObject(game, obj) {
    const celestialTypes = ['star', 'planet', 'moon', 'belt', 'nebula', 'wormhole', 'jump-gate', 'derelict', 'graviton-sink'];
    return celestialTypes.includes(obj.celestial_type || obj.type);
}

// Strategic Map modal (ESM)

export function openMapModal() {
        const client = window.gameClient; if (!client) return;
        const sectorName = client.gameState?.sector?.name || 'Current System';
        const modalContent = document.createElement('div');
        modalContent.className = 'map-root';
        modalContent.innerHTML = `
            <!-- Tabs Row -->
            <div class="map-tabs">
                <button class="map-tab active" data-tab="solar-system">${sectorName}</button>
                <button class="map-tab" data-tab="galaxy">Galaxy</button>
            </div>

            <!-- Solar System Tab -->
            <div id="solar-system-tab" class="map-tab-content">
                <div class="map-main">
                    <!-- Left: Map Pane -->
                    <div class="map-pane">
                        <div class="map-container">
                            <canvas id="fullMapCanvas" class="full-map-canvas"></canvas>
                            
                            <!-- Overlay Controls -->
                            <div class="map-overlay-controls">
                                <button class="map-overlay-btn active" data-map-mode="plan" title="Plot a route to any map location">Plan</button>
                                <button class="map-overlay-btn active" id="toggleLanes" aria-pressed="true" title="Show warp lanes">Lanes</button>
                                <button class="map-overlay-btn" id="toggleRegions" aria-pressed="false" title="Show system regions">Regions</button>
                                <button class="map-overlay-btn" id="toggleLabels" aria-pressed="false" title="Show object labels">Labels</button>
                            </div>
                            <div id="mapModeHint" class="map-mode-hint">Inspect mode · choose Plan to plot a route</div>
                        </div>
                    </div>

                    <!-- Right: Sidebar with 3 Zones -->
                    <div class="map-sidebar">
                        <!-- Zone A: Destination (sticky) -->
                        <div class="sidebar-zone-dest" id="zoneDestination">
                            <div class="dest-label">Destination</div>
                            <div class="dest-empty" id="destEmpty">Click map or select POI</div>
                            <div id="destInfo" style="display:none;">
                                <div class="dest-name" id="destName">--</div>
                                <div class="dest-coords" id="destCoords">--</div>
                            </div>
                        </div>

                        <!-- Zone B: Route Options -->
                        <div class="sidebar-zone-routes" id="zoneRoutes">
                            <div class="routes-header">Route Options</div>
                            <div id="routesList">
                                <div class="routes-empty">Select a destination to see routes</div>
                            </div>
                        </div>

                        <!-- Zone C: Tabbed Browser -->
                        <div class="sidebar-zone-browser">
                            <div class="browser-tabs">
                                <button class="browser-tab active" data-browser-tab="pois">POIs</button>
                                <button class="browser-tab" data-browser-tab="system">System</button>
                            </div>
                            <div class="browser-content" id="browserContent">
                                <!-- POIs Tab Content (default) -->
                                <div id="poisTabContent">
                                    <input type="text" class="poi-search" id="poiSearch" placeholder="Search POIs...">
                                    <div class="poi-filters" id="poiFilters">
                                        <button class="poi-filter active" data-filter="planets">Planets</button>
                                        <button class="poi-filter active" data-filter="belts">Belts</button>
                                        <button class="poi-filter active" data-filter="wormholes">Wormholes</button>
                                        <button class="poi-filter" data-filter="taps">Taps</button>
                                    </div>
                                    <div id="poiGroups"></div>
                                </div>
                                <!-- System Tab Content (hidden) -->
                                <div id="systemTabContent" style="display:none;">
                                    <div class="system-summary">
                                        <div class="system-stat">
                                            <div class="system-stat-label">Sector</div>
                                            <div class="system-stat-value" id="sysId">${client.gameState?.sector?.id || '--'}</div>
                                        </div>
                                        <div class="system-stat">
                                            <div class="system-stat-label">Archetype</div>
                                            <div class="system-stat-value" id="sysArchetype">${client.gameState?.sector?.archetype || 'Standard'}</div>
                                        </div>
                                    </div>
                                    <div class="system-section">
                                        <div class="system-section-header">Core Minerals <span id="coreChevron">▾</span></div>
                                        <div class="system-chips" id="coreMinerals">Loading...</div>
                                    </div>
                                    <div class="system-section">
                                        <div class="system-section-header">Primary Abundance <span id="primaryChevron">▾</span></div>
                                        <div class="system-chips" id="primaryMinerals">Loading...</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Galaxy Tab -->
            <div id="galaxy-tab" class="map-tab-content hidden">
                <div class="map-main">
                    <div class="map-pane">
                        <div class="map-container">
                            <canvas id="galaxyCanvas" class="full-map-canvas"></canvas>
                            <div class="map-overlay-controls">
                                <button class="map-overlay-btn" id="galaxyRecenter" title="Recenter galaxy">⌖</button>
                            </div>
                        </div>
                    </div>
                    <div class="map-sidebar">
                        <div class="sidebar-zone-browser" style="grid-row: 1 / -1;">
                            <div class="browser-tabs">
                                <button class="browser-tab active">Known Systems</button>
                            </div>
                            <div class="browser-content" id="galaxySystemsList"></div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Footer Action Shelf -->
            <div class="map-footer" id="mapFooter">
                <div class="footer-route-info">
                    <span id="footerOrigin">--</span>
                    <span class="arrow">→</span>
                    <span id="footerDest">Select destination</span>
                </div>
                <div class="footer-route-summary" id="footerSummary">
                    <div class="footer-stat">ETA: <span id="footerEta">--</span></div>
                    <div class="footer-stat">Legs: <span id="footerLegs">--</span></div>
                    <div class="footer-stat">Status: <span id="footerRouteStatus">No route</span></div>
                </div>
                <div class="footer-actions">
                    <div class="warp-preflight" id="warpPreflight">Select a route to review</div>
                    <button class="footer-btn-primary" id="btnExecuteWarp" disabled>Execute Warp</button>
                    <button class="footer-btn-secondary" id="btnCloseMap">Close</button>
                </div>
            </div>
        `;
        window.UI.showModal({ title:'Strategic Map', content: modalContent, className:'map-modal' });
        
        // === EVENT BINDINGS ===
        
        // Map tab switching
        bindTabEvents(modalContent);
        
        // Browser tab switching (POIs / System)
        modalContent.querySelectorAll('.browser-tab').forEach(btn => {
            btn.onclick = () => {
                modalContent.querySelectorAll('.browser-tab').forEach(t => t.classList.remove('active'));
                btn.classList.add('active');
                const tab = btn.dataset.browserTab;
                const poisContent = modalContent.querySelector('#poisTabContent');
                const sysContent = modalContent.querySelector('#systemTabContent');
                if (poisContent) poisContent.style.display = tab === 'pois' ? 'block' : 'none';
                if (sysContent) sysContent.style.display = tab === 'system' ? 'block' : 'none';
            };
        });
        
        // Map overlay control toggles
        // POI filter chips
        modalContent.querySelectorAll('.poi-filter').forEach(chip => {
            chip.onclick = () => {
                chip.classList.toggle('active');
                populatePOIBrowser(modalContent);
            };
        });
        
        // POI search
        const poiSearch = modalContent.querySelector('#poiSearch');
        if (poiSearch) {
            poiSearch.oninput = () => populatePOIBrowser(modalContent);
        }
        
        // Footer close button
        const closeBtn = modalContent.querySelector('#btnCloseMap');
        if (closeBtn) closeBtn.onclick = () => window.UI.closeModal();
        
        // Footer execute warp button
        const executeBtn = modalContent.querySelector('#btnExecuteWarp');
        if (executeBtn) {
            executeBtn.onclick = () => {
                if (executeBtn.dataset.busy === '1') return;
                if (isRouteStale(client)) { markRouteStale(); return; }
                const selectedRoute = client.__selectedRoute;
                if (!selectedRoute || !client.selectedUnit?.id) return;
                executeBtn.dataset.busy = '1'; executeBtn.disabled = true; executeBtn.textContent = 'Confirming…';
                const status = document.querySelector('#footerRouteStatus'); if (status) status.textContent = 'Confirming';
                const legs = selectedRoute.legs;
                const dest = client.__plannerTarget;
                client.socket && client.socket.emit('travel:confirm', { 
                    routeId: selectedRoute.routeId,
                    queue: true,
                    clientOrderId: `warp-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                    gameId: client.gameId, 
                    sectorId: client.gameState.sector.id, 
                    shipId: client.selectedUnit.id, 
                    legs, 
                    destX: dest?.x, 
                    destY: dest?.y 
                }, (resp) => {
                    if (!resp?.success) { client.addLogEntry(resp?.error || 'Confirm failed', 'error'); executeBtn.dataset.busy = '0'; executeBtn.disabled = false; executeBtn.textContent = 'Execute Warp'; if (status) status.textContent = 'Rejected'; return; }
                    if (status) status.textContent = 'Queued'; executeBtn.textContent = 'Queued — next turn';
                    client.__laneHighlight = { until: Number.MAX_SAFE_INTEGER, legs };
                    client.addLogEntry('Warp queued', 'success');
                    if (status) status.textContent = 'Queued';
                    initializeFullMap();
                    executeBtn.dataset.busy = '0';
                    executeBtn.disabled = false;
                });
            };
        }
        
        // Update footer origin based on selected unit
        const updateFooterOrigin = () => {
            const origin = modalContent.querySelector('#footerOrigin');
            if (origin && client.selectedUnit) {
                origin.textContent = client.selectedUnit.name || `Ship ${client.selectedUnit.id}`;
            }
        };
        updateFooterOrigin();
        
        // Periodic state check
        const interval = setInterval(() => {
            if (!document.body.contains(modalContent)) { clearInterval(interval); return; }
            updateFooterOrigin();
            const executeBtn = modalContent.querySelector('#btnExecuteWarp');
            if (client.__routeMeta && client.__selectedRoute && isRouteStale(client) && executeBtn?.dataset.busy !== '1') {
                const now = Date.now();
                if (client.__routeReplanAt && now - client.__routeReplanAt < 5000) return;
                client.__routeReplanAt = now;
                const target = client.__plannerTarget;
                markRouteStale();
                if (target) {
                    const status = modalContent.querySelector('#footerRouteStatus'); if (status) status.textContent = 'Replanning';
                    planToDestination(target);
                }
            }
        }, 1000);
        
        // Initialize
        setTimeout(() => { 
            try { 
                initializeFullMap(); 
                loadGalaxyDataInternal(); 
                populatePOIBrowser(modalContent);
                populateSystemDashboard(modalContent);
            } catch (e) { console.error('map init error', e); } 
        }, 100);
}

function isRouteStale(client) {
    const m = client?.__routeMeta, s = client?.selectedUnit;
    return !m || !s || Number(client.gameState?.turn?.number || 0) !== m.turn || s.id !== m.shipId || Math.hypot(Number(s.x) - m.x, Number(s.y) - m.y) > 0.5;
}

function markRouteStale() {
    const client = window.gameClient; client.__selectedRoute = null; client.__routeMeta = null;
    const list = document.getElementById('routesList'); if (list) list.innerHTML = '<div class="routes-empty">Route expired — recalculate to continue</div>';
    const btn = document.getElementById('btnExecuteWarp'); if (btn) { btn.disabled = true; btn.dataset.busy = '0'; btn.textContent = 'Execute Warp'; }
    const status = document.getElementById('footerRouteStatus'); if (status) status.textContent = 'Stale';
}

function bindTabEvents(root) {
        const tabs = root.querySelectorAll('.map-tab');
        tabs.forEach(btn => {
            btn.addEventListener('click', () => switchMapTab(root, btn.dataset.tab, btn));
        });
}

function updatePlannerState(root) {
        try {
            const client = window.gameClient; const panel = root.querySelector('#plannerPanel'); const routes = root.querySelector('#plannerRoutes'); const help = root.querySelector('#plannerHelp');
            const controls = root.querySelector('#poiSelector'); const inputsX = root.querySelector('#coordX'); const inputsY = root.querySelector('#coordY');
            const selected = client?.selectedUnit;
            if (!panel) return;
            if (!selected) {
                if (help) help.textContent = 'Warp planning requires a warpable unit be selected';
                if (routes) routes.innerHTML = '';
                if (controls) controls.style.opacity = '0.4';
                if (inputsX) inputsX.disabled = true; if (inputsY) inputsY.disabled = true;
            } else {
                if (help) help.textContent = 'Click on the map or pick a POI to plan a route.';
                if (controls) controls.style.opacity = '1';
                if (inputsX) inputsX.disabled = false; if (inputsY) inputsY.disabled = false;
            }
        } catch {}
}

function switchMapTab(root, tabName, clickedEl) {
        root.querySelectorAll('.map-tab').forEach(tab => tab.classList.remove('active'));
        if (clickedEl) clickedEl.classList.add('active');
        root.querySelectorAll('.map-tab-content').forEach(content => content.classList.add('hidden'));
        const tab = root.querySelector('#' + tabName + '-tab'); if (tab) tab.classList.remove('hidden');
        if (tabName === 'solar-system') setTimeout(() => initializeFullMap(), 50); else if (tabName === 'galaxy') setTimeout(() => initializeGalaxyMap(), 50);
}

async function populatePOIBrowser(root) {
    const client = window.gameClient; 
    if (!client || !client.gameState?.sector?.id) return;
    const wrap = root.querySelector('#poiGroups'); 
    if (!wrap) return;
    
    const facts = await SFApi.State.systemFacts(client.gameState.sector.id);
    const searchQuery = (root.querySelector('#poiSearch')?.value || '').toLowerCase();
    
    // Get active filters
    const activeFilters = new Set();
    root.querySelectorAll('.poi-filter.active').forEach(f => activeFilters.add(f.dataset.filter));
    
    // Collect all POIs by type
    const poiGroups = {
        planets: { icon: '🪐', label: 'Planets', items: [] },
        belts: { icon: '⛓️', label: 'Belts', items: [] },
        wormholes: { icon: '🌀', label: 'Wormholes', items: [] },
        taps: { icon: '🛰️', label: 'Lane Taps', items: [] }
    };
    
    // Planets
    if (activeFilters.has('planets')) {
        client.objects.filter(o => o.celestial_type === 'planet').forEach(p => {
            const name = p.meta?.name || `Planet ${p.id}`;
            if (!searchQuery || name.toLowerCase().includes(searchQuery)) {
                poiGroups.planets.items.push({ name, x: p.x, y: p.y, id: p.id });
            }
        });
    }
    
    // Belts
    if (activeFilters.has('belts')) {
        (facts?.belts || []).forEach(b => {
            const name = `Belt ${b.belt_key}-${b.sector_index}`;
            if (!searchQuery || name.toLowerCase().includes(searchQuery)) {
                const cx = 2500, cy = 2500;
                const rMid = Number(b.inner_radius) + Number(b.width) / 2;
                const aMid = (Number(b.arc_start) + Number(b.arc_end)) / 2;
                poiGroups.belts.items.push({ 
                    name, 
                    x: Math.round(cx + Math.cos(aMid) * rMid), 
                    y: Math.round(cy + Math.sin(aMid) * rMid),
                    id: `belt-${b.belt_key}-${b.sector_index}`
                });
            }
        });
    }
    
    // Wormholes
    if (activeFilters.has('wormholes')) {
        (facts?.wormholeEndpoints || []).forEach(w => {
            const name = safeName(w.meta?.name) || `Wormhole ${w.id}`;
            if (!searchQuery || name.toLowerCase().includes(searchQuery)) {
                poiGroups.wormholes.items.push({ name, x: w.x, y: w.y, id: w.id });
            }
        });
    }
    
    // Taps
    if (activeFilters.has('taps')) {
        const tapsByEdge = facts?.laneTapsByEdge || {};
        Object.keys(tapsByEdge).forEach(eid => {
            (tapsByEdge[eid] || []).forEach((t, i) => {
                const name = `Tap E${eid}-${i + 1}`;
                if (!searchQuery || name.toLowerCase().includes(searchQuery)) {
                    poiGroups.taps.items.push({ name, x: t.x, y: t.y, id: `tap-${eid}-${i}` });
                }
            });
        });
    }
    
    // Build HTML
    let html = '';
    for (const [type, group] of Object.entries(poiGroups)) {
        if (group.items.length === 0) continue;
        const isOpen = false; // POI groups start collapsed; open only the category you need.
        html += `
            <div class="poi-group ${isOpen ? '' : 'collapsed'}" data-group="${type}">
                <div class="poi-group-header">
                    <span class="poi-group-chevron">▾</span>
                    ${group.icon} ${group.label} (${group.items.length})
                </div>
                <div class="poi-group-items">
                    ${group.items.map(it => `
                        <div class="poi-item" title="${it.name} · ID ${it.id ?? 'map'} · ${Math.round(it.x)}, ${Math.round(it.y)}" data-poi-id="${it.id ?? ''}" data-object-id="${typeof it.id === 'number' ? it.id : ''}" data-x="${it.x}" data-y="${it.y}" data-name="${it.name}">
                            <span>${group.icon} ${it.name}</span><span class="poi-item-id">ID ${it.id ?? 'MAP'} · ${Math.round(it.x)}, ${Math.round(it.y)}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }
    
    wrap.innerHTML = html || '<div style="color:var(--muted); text-align:center; padding:20px;">No POIs match filters</div>';
    
    // Bind group collapse
    wrap.querySelectorAll('.poi-group-header').forEach(header => {
        header.onclick = () => header.parentElement.classList.toggle('collapsed');
    });
    
    // Bind POI click
    wrap.querySelectorAll('.poi-item').forEach(item => {
        item.onclick = () => {
            wrap.querySelectorAll('.poi-item').forEach(el => el.classList.remove('active'));
            item.classList.add('active');
            const x = Number(item.dataset.x);
            const y = Number(item.dataset.y);
            const name = item.dataset.name;
            selectDestination(root, { x, y, name, id: item.dataset.objectId ? Number(item.dataset.objectId) : undefined });
        };
    });
}

async function populateSystemDashboard(root) {
    const client = window.gameClient;
    if (!client?.gameState?.sector) return;
    
    const facts = await SFApi.State.systemFacts(client.gameState.sector.id);
    const disp = facts?.mineralDisplay || {};
    
    const chip = (name, mult, color = 'var(--primary)') => 
        `<span class="system-chip" style="border-color:${color}40; background:${color}10;">${name} x${mult}</span>`;
    
    const coreEl = root.querySelector('#coreMinerals');
    const primaryEl = root.querySelector('#primaryMinerals');
    
    if (coreEl) {
        const core = (disp.core || []).slice(0, 5);
        coreEl.innerHTML = core.length ? core.map(m => chip(m.name, m.mult, '#81c784')).join('') : '—';
    }
    
    if (primaryEl) {
        const primary = (disp.primary || []).slice(0, 5);
        primaryEl.innerHTML = primary.length ? primary.map(m => chip(m.name, m.mult)).join('') : '—';
    }
}

function selectDestination(root, dest) {
    const client = window.gameClient;
    if (!client) return;
    
    client.__plannerTarget = { x: dest.x, y: dest.y };
    client.__selectedDestName = dest.name || null;
    
    // Update destination zone
    const destEmpty = root.querySelector('#destEmpty');
    const destInfo = root.querySelector('#destInfo');
    const destName = root.querySelector('#destName');
    const destCoords = root.querySelector('#destCoords');
    const footerDest = document.querySelector('#footerDest');
    
    if (destEmpty) destEmpty.style.display = 'none';
    if (destInfo) destInfo.style.display = 'block';
    if (destName) destName.textContent = dest.name || 'Custom Location';
    if (destCoords) destCoords.textContent = `${Math.round(dest.x)}, ${Math.round(dest.y)}`;
    if (footerDest) footerDest.textContent = dest.name || `${Math.round(dest.x)}, ${Math.round(dest.y)}`;
    
    // Plan routes
    planToDestination(dest);
}

function showPlannerRoutes(routes) {
    try {
        const client = window.gameClient; 
        const container = document.getElementById('routesList'); 
        if (!container) return;
        
        const rawList = Array.isArray(routes) ? routes.slice(0, 3) : [];
        const list = rawList.filter(r => {
            const legs = Array.isArray(r.legs) ? r.legs.map(normalizeLeg) : [];
            const nonZero = legs.filter(L => Math.abs(Number(L.sEnd||0) - Number(L.sStart||0)) > 1e-3);
            if (!legs.length || !nonZero.length) return false;
            r.legs = legs;
            return true;
        });
        window.__lastPlannedRoutes = list;
        client.__selectedRoute = list[0] || null;
        client.__routeReplanAt = 0;
        client.__routeMeta = list.length ? { turn: Number(client.gameState?.turn?.number || 0), shipId: client.selectedUnit?.id, x: Number(client.selectedUnit?.x), y: Number(client.selectedUnit?.y), plannedAt: Date.now() } : null;
        
        // Update footer
        const footerEta = document.querySelector('#footerEta');
        const footerLegs = document.querySelector('#footerLegs');
        const footerStatus = document.querySelector('#footerRouteStatus');
        const preflight = document.querySelector('#warpPreflight');
        const executeBtn = document.querySelector('#btnExecuteWarp');
        
        if (list.length === 0) {
            container.innerHTML = '<div class="routes-empty">No routes available</div>';
            if (footerEta) footerEta.textContent = '--';
            if (footerLegs) footerLegs.textContent = '--';
            if (executeBtn) executeBtn.disabled = true;
            if (footerStatus) footerStatus.textContent = 'No route';
            if (preflight) preflight.textContent = 'Select a route to review';
            return;
        }
        
        // Enable execute button
        if (executeBtn) executeBtn.disabled = false;
        if (footerStatus) footerStatus.textContent = 'Planned';
        const summarize = r => { const b = r.breakdown || {}; const impulse = Number(b.impulse || 0); return `ETA ${r.eta ?? '--'} turns · ${r.legs.length} legs · ${r.legs.map(L => L.entry === 'tap' ? 'tap' : 'wild').join(' → ')} · ρ ${Number(r.rho || 0).toFixed(2)}${impulse > 0 ? ` · impulse ${impulse.toFixed(1)}` : ''}`; };
        if (preflight) preflight.textContent = summarize(list[0]);
        if (footerEta) footerEta.textContent = list[0].eta ? `${list[0].eta} turns` : '--';
        if (footerLegs) footerLegs.textContent = String(list[0].legs.length);
        
        container.innerHTML = '';
        
        const formatBreakdown = (b) => {
            if (!b) return '';
            const labels = [['approach','approach'],['queue','queue'],['merge','merge'],['warp','warp'],['transfer','transfer'],['finalApproach','final'],['offRamp','off-ramp'],['impulse','impulse']];
            return labels.filter(([key]) => Number(b[key] || 0) > 0.01)
                .map(([key, label]) => `${label} ${Number(b[key]).toFixed(1)}`).join(' · ');
        };

        list.forEach((r, idx) => {
            const rho = Number(r.rho || 0);
            const rhoBadgeClass = rho <= 1.0 ? 'rho-good' : (rho <= 1.5 ? 'rho-warn' : 'rho-bad');
            
            const card = document.createElement('div');
            card.className = 'route-card' + (idx === 0 ? ' selected' : '');
            card.dataset.routeIndex = idx;
            
            card.innerHTML = `
                <div class="route-info">
                    <div class="route-name">Option ${idx + 1}${idx === 0 ? ' <span class="route-recommended">Recommended</span>' : ''}</div>
                    <div class="route-meta">${r.legs.map(L => L.entry === 'tap' ? 'tap' : 'wild').join(' → ')}</div>
                    ${formatBreakdown(r.breakdown) ? `<div class="route-breakdown">${formatBreakdown(r.breakdown)}</div>` : ''}
                </div>
                <div class="route-stats">
                    <span class="route-badge eta">ETA ${r.eta} turns</span>
                    <span class="route-badge ${rhoBadgeClass}">ρ ${rho.toFixed(2)}</span>
                </div>
            `;
            
            // Click to select
            card.onclick = () => {
                container.querySelectorAll('.route-card').forEach(c => c.classList.remove('selected'));
                card.classList.add('selected');
                client.__selectedRoute = r;
                if (footerEta) footerEta.textContent = r.eta ? `${r.eta} turns` : '--';
                if (footerLegs) footerLegs.textContent = String(r.legs.length);
                if (preflight) preflight.textContent = summarize(r);
                const footerDest = document.querySelector('#footerDest');
                if (footerDest && client.__plannerTarget) footerDest.textContent = `${Math.round(client.__plannerTarget.x)}, ${Math.round(client.__plannerTarget.y)}`;
            };
            
            // Hover to preview - use lightweight redraw
            card.onmouseenter = () => {
                client.__laneHighlight = { until: Date.now() + 30000, legs: r.legs };
                redrawMap();
            };
            
            container.appendChild(card);
        });
        
        // Highlight first route - use lightweight redraw
        if (list[0]) {
            client.__laneHighlight = { until: Date.now() + 30000, legs: list[0].legs };
            redrawMap();
        }
    } catch (e) { console.error('showPlannerRoutes error', e); }
}

function planToDestination(dest) {
    try {
        const client = window.gameClient; 
        if (!client || !client.gameState?.sector?.id) return;
        const x = Number(dest?.x), y = Number(dest?.y); 
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        
        client.__plannerTarget = { x, y };
        
        const routesList = document.getElementById('routesList'); 
        if (routesList) routesList.innerHTML = '<div class="routes-empty">Planning route...</div>';
        
        client.socket && client.socket.emit('travel:plan', { 
            gameId: client.gameId, 
            sectorId: client.gameState.sector.id,
            shipId: client.selectedUnit?.id,
            targetObjectId: typeof dest.id === 'number' ? dest.id : undefined,
            from: { x: client.selectedUnit?.x, y: client.selectedUnit?.y }, 
            to: { x, y } 
        }, (resp) => {
            if (resp?.success && Array.isArray(resp.routes)) {
                showPlannerRoutes(resp.routes);
            } else {
                const routesList = document.getElementById('routesList'); 
                const code = String(resp?.error || '');
                const message = code.includes('fuel') ? 'Insufficient fuel for this route' : code.includes('warp') ? 'This ship cannot use warp travel' : code.includes('lane') ? 'No usable warp lane reaches that destination' : (code || 'No safe routes found');
                if (routesList) routesList.textContent = message;
            }
        });
    } catch (e) { console.error('planToDestination error', e); }
}

function safeName(n){ try { if (!n) return null; return String(n); } catch { return null; } }

// normalizeLeg now provided by features/travel-planner.js

// confirmRoute now provided by features/travel-planner.js

function buildLaneCache(canvas, facts) {
	try {
		if (!facts || !canvas) {
			canvas.__laneCache = { edges: [], taps: [] };
			return;
		}

		const edges = [];
		const taps = [];

		// Build health by region map (same logic as renderFullMap)
		const healthByRegion = new Map((facts.regions || []).map(r => [String(r.id), Number(r.health || 50)]));

		// Process lanes to build edge cache
		const lanes = facts.lanes || [];
		lanes.forEach(l => {
			const pts = Array.isArray(l.polyline) ? l.polyline : [];
			if (pts.length < 2) return;

			// Calculate rho and capacity (same logic as renderFullMap)
			const health = healthByRegion.get(String(l.region_id)) ?? 50;
			const healthMult = health >= 80 ? 1.25 : (health >= 60 ? 1.0 : 0.7);
			const cap = Math.max(1, Math.floor(Number(l.cap_base || 0) * (Number(l.width_core || 150) / 150) * healthMult));
			const load = Number(l.runtime?.load_cu || 0);
			const rho = load / Math.max(1, cap);

			edges.push({
				pts: pts,
				rho: rho,
				cap: cap,
				headway: l.headway || 0
			});
		});

		// Process taps to build tap cache
		const tapsByEdge = facts.laneTapsByEdge || {};
		Object.keys(tapsByEdge).forEach(edgeId => {
			(tapsByEdge[edgeId] || []).forEach(t => {
				taps.push({
					id: t.id,
					x: Number(t.x || 0),
					y: Number(t.y || 0),
					queued: Number(t.queued_cu || 0)
				});
			});
		});

		// Store the cache on the canvas
		canvas.__laneCache = { edges, taps };
	} catch (error) {
		console.error('Error building lane cache:', error);
		canvas.__laneCache = { edges: [], taps: [] };
	}
}

function getMapToggles() {
    return {
        regions: document.getElementById('toggleRegions')?.classList.contains('active') ?? true,
        lanes: document.getElementById('toggleLanes')?.classList.contains('active') ?? true,
        labels: document.getElementById('toggleLabels')?.classList.contains('active') ?? false,
        wormholes: true,
        belts: false // Belt polygons removed - only POI markers shown
    };
}

function observeCanvas(canvas) {
    if (canvas.__ro) return;
    const ro = new ResizeObserver(() => {
        // Measure the layout box, not the transformed canvas. Otherwise a
        // zoomed map gets a larger backing store every time a toggle redraws.
        const rect = (canvas.parentElement || canvas).getBoundingClientRect();
        const w = Math.max(200, Math.floor(rect.width));
        const h = Math.max(200, Math.floor(rect.height));
        if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            const scaleX = canvas.width / 5000, scaleY = canvas.height / 5000;
            renderFullMap(ctx, canvas, scaleX, scaleY, getMapToggles(), null);
        }
    });
    ro.observe(canvas.parentElement || canvas);
    canvas.__ro = ro;
}

// Lightweight redraw - uses cached data, no re-initialization
function redrawMap() {
    const client = window.gameClient;
    const canvas = document.getElementById('fullMapCanvas');
    if (!client || !canvas || !client.objects) return;
    
    const ctx = canvas.getContext('2d');
    const scaleX = canvas.width / 5000, scaleY = canvas.height / 5000;
    const toggles = getMapToggles();
    renderFullMap(ctx, canvas, scaleX, scaleY, toggles, null);
}

async function handleFullMapClick(canvas, ev) {
    const client = window.gameClient;
    if (!client?.gameState?.sector?.id) return;
    const mode = 'plan';
    const point = mapEventToWorld(canvas, ev);
    if (!point) return;
    const { wx, wy } = point;
    const hit = nearestMapObject(client.objects, wx, wy, canvas);
    // Plan mode intentionally accepts empty space. If an object is under the
    // cursor, snap to its actual world coordinate so the marker and POI agree.
    const click = hit ? { x: Number(hit.x), y: Number(hit.y) } : { x: wx, y: wy };
    client.__mapClickMarker = { x: click.x, y: click.y, time: Date.now() };

    const destEmpty = document.querySelector('#destEmpty');
    const destInfo = document.querySelector('#destInfo');
    const destName = document.querySelector('#destName');
    const destCoords = document.querySelector('#destCoords');
    const footerDest = document.querySelector('#footerDest');
    if (destEmpty) destEmpty.style.display = 'none';
    if (destInfo) destInfo.style.display = 'block';
    if (destName) destName.textContent = 'Map Location';
    if (destCoords) destCoords.textContent = `${Math.round(click.x)}, ${Math.round(click.y)}`;
    if (footerDest) footerDest.textContent = `${Math.round(click.x)}, ${Math.round(click.y)}`;
    client.__plannerTarget = click;

    const routesList = document.getElementById('routesList');
    if (routesList) routesList.innerHTML = '<div class="routes-empty">Planning...</div>';
    try {
        const routes = await new Promise(resolve => client.socket?.emit('travel:plan', {
            gameId: client.gameId,
            sectorId: client.gameState.sector.id,
            shipId: client.selectedUnit?.id,
            from: { x: client.selectedUnit?.x, y: client.selectedUnit?.y },
            to: click
        }, resolve));
        if (routes?.success && Array.isArray(routes.routes)) showPlannerRoutes(routes.routes);
        else if (routesList) routesList.textContent = routes?.error || 'No routes found';
    } catch (error) {
        console.error('strategic map planning error', error);
        if (routesList) routesList.textContent = 'Unable to plan route — try selecting a ship first';
    } finally {
        redrawMap();
    }
}

function mapEventToWorld(canvas, ev) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
        wx: ((ev.clientX - rect.left) / rect.width) * 5000,
        wy: ((ev.clientY - rect.top) / rect.height) * 5000
    };
}

function nearestMapObject(objects, wx, wy, canvas) {
    const candidates = (objects || []).filter(o => o && Number.isFinite(Number(o.x)) && Number.isFinite(Number(o.y)));
    let nearest = null; let best = Infinity;
    for (const obj of candidates) {
        const d = Math.hypot(wx - Number(obj.x), wy - Number(obj.y));
        if (d < best) { best = d; nearest = obj; }
    }
    const rect = canvas.getBoundingClientRect();
    const worldPerPixel = 5000 / Math.max(1, Math.min(rect.width, rect.height));
    return nearest && best <= 24 * worldPerPixel ? nearest : null;
}

function setMapHint(text) {
    const hint = document.getElementById('mapModeHint');
    if (hint) hint.textContent = text;
}

function showMapTip(canvas, text, ev) {
    const tip = canvas.__tipEl;
    if (!tip) return;
    tip.textContent = text;
    tip.style.display = 'block';
    tip.style.left = `${ev.clientX + 12}px`;
    tip.style.top = `${ev.clientY - 10}px`;
}

function handleFullMapHover(canvas, ev) {
    const tip = canvas.__tipEl;
    if (!tip) return;
    const point = mapEventToWorld(canvas, ev);
    if (!point) return;
    const { wx, wy } = point;
    const scaleX = canvas.width / 5000, scaleY = canvas.height / 5000;
    const pxScale = (scaleX + scaleY) / 2;
    const cache = canvas.__laneCache || { edges: [], taps: [] };
    let tipText = '';
    for (const t of cache.taps) {
        if (Math.hypot(wx - t.x, wy - t.y) * pxScale < 12) { tipText = `T${t.id ?? 'MAP'}  ·  Tap queue: ${t.queued} CU`; break; }
    }
    if (!tipText) {
        const projectToSegment = (p, a, b) => {
            const apx = p.x - a.x, apy = p.y - a.y, abx = b.x - a.x, aby = b.y - a.y;
            const ab2 = Math.max(1e-6, abx * abx + aby * aby);
            const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / ab2));
            return { x: a.x + abx * t, y: a.y + aby * t };
        };
        let best = { dpx: Infinity, edge: null };
        for (const edge of cache.edges) for (let i = 1; i < edge.pts.length; i++) {
            const point = projectToSegment({ x: wx, y: wy }, edge.pts[i - 1], edge.pts[i]);
            const dpx = Math.hypot(wx - point.x, wy - point.y) * pxScale;
            if (dpx < best.dpx) best = { dpx, edge };
        }
        if (best.edge && best.dpx < 14) tipText = `ρ ${best.edge.rho.toFixed(2)}  • cap ${best.edge.cap}  • headway ${best.edge.headway}`;
    }
    if (!tipText) {
        const facts = canvas.__facts || window.gameClient.__factsCache?.facts;
        const regions = Array.isArray(facts?.regions) ? facts.regions : [];
        const cellW = 5000 / 3, cellH = 5000 / 3;
        let nearest = { dpx: Infinity, id: null, health: 0 };
        regions.forEach(region => {
            let cx = 0, cy = 0, n = 0;
            (region.cells || []).forEach(c => { cx += c.col * cellW + cellW / 2; cy += c.row * cellH + cellH / 2; n++; });
            if (n) { cx /= n; cy /= n; const dpx = Math.hypot(wx - cx, wy - cy) * pxScale; if (dpx < nearest.dpx) nearest = { dpx, id: String(region.id || '').toUpperCase(), health: Number(region.health || 0) }; }
        });
        if (nearest.id && nearest.dpx < 40) tipText = `Region ${nearest.id} (${nearest.health}%)`;
    }
    tip.style.display = tipText ? 'block' : 'none';
    if (tipText) { tip.textContent = tipText; tip.style.left = `${ev.clientX + 12}px`; tip.style.top = `${ev.clientY - 10}px`; }
}

function initializeFullMap() {
        const client = window.gameClient; const canvas = document.getElementById('fullMapCanvas');
        if (!client || !canvas) return;

        // Initial size
        const rect = (canvas.parentElement || canvas).getBoundingClientRect();
        canvas.width  = Math.max(200, Math.floor(rect.width));
        canvas.height = Math.max(200, Math.floor(rect.height));

        observeCanvas(canvas);
        const ctx = canvas.getContext('2d'); ctx.fillStyle = '#060a14'; ctx.fillRect(0,0,canvas.width,canvas.height);
        if (!client.objects) return;
        const scaleX = canvas.width / 5000, scaleY = canvas.height / 5000;
        const toggles = getMapToggles();
        // Prepare a DOM tooltip and build lane cache
        let tip = document.getElementById('mapHoverTip');
        if (!tip) {
            tip = document.createElement('div'); tip.id = 'mapHoverTip';
            tip.style.position = 'fixed'; tip.style.pointerEvents = 'none'; tip.style.zIndex = '99999';
            tip.style.background = 'rgba(15,25,45,0.92)'; tip.style.border = '1px solid rgba(158,203,255,0.6)';
            tip.style.borderRadius = '4px'; tip.style.padding = '3px 6px'; tip.style.color = '#cfe8ff'; tip.style.font = '13px Arial'; tip.style.display = 'none';
            document.body.appendChild(tip);
        }
        canvas.__tipEl = tip;
        if (!canvas.__mapInputBound) {
            canvas.addEventListener('click', ev => handleFullMapClick(canvas, ev));
            canvas.addEventListener('mousemove', ev => handleFullMapHover(canvas, ev));
            canvas.addEventListener('mouseleave', () => { if (canvas.__tipEl) canvas.__tipEl.style.display = 'none'; });
            let savedView = null; try { savedView = JSON.parse(localStorage.getItem('ui.mapView') || 'null'); } catch {}
            canvas.__view = savedView && Number.isFinite(savedView.zoom) ? savedView : { zoom: 1, panX: 0, panY: 0 };
            const applyView = () => { const v = canvas.__view; canvas.style.transformOrigin = '0 0'; canvas.style.transform = `translate(${v.panX}px, ${v.panY}px) scale(${v.zoom})`; };
            canvas.addEventListener('wheel', ev => { ev.preventDefault(); const v = canvas.__view; v.zoom = Math.max(1, Math.min(2.5, v.zoom * (ev.deltaY < 0 ? 1.1 : 0.9))); applyView(); try { localStorage.setItem('ui.mapView', JSON.stringify(v)); } catch {} redrawMap(); }, { passive: false });
            let drag = null;
            canvas.addEventListener('pointerdown', ev => { if (ev.button === 1 || ev.shiftKey) { drag = { x: ev.clientX, y: ev.clientY, panX: canvas.__view.panX, panY: canvas.__view.panY }; canvas.setPointerCapture(ev.pointerId); } });
            canvas.addEventListener('pointermove', ev => { if (drag) { canvas.__view.panX = drag.panX + ev.clientX - drag.x; canvas.__view.panY = drag.panY + ev.clientY - drag.y; applyView(); } });
            canvas.addEventListener('pointerup', () => { drag = null; try { localStorage.setItem('ui.mapView', JSON.stringify(canvas.__view)); } catch {} redrawMap(); });
            canvas.__mapInputBound = true;
        }
        (async ()=>{ try { const sid = client.gameState?.sector?.id; if (sid) { const now=Date.now(); if (!client.__factsCache||client.__factsCache.until<=now){ const facts=await SFApi.State.systemFacts(sid); client.__factsCache={facts,until:now+5000}; } buildLaneCache(canvas, client.__factsCache.facts); } } catch {} renderFullMap(ctx, canvas, scaleX, scaleY, toggles, null); })();
        renderFullMap(ctx, canvas, scaleX, scaleY, toggles, null);
        ['toggleRegions','toggleLabels','toggleBelts','toggleWormholes','toggleLanes'].forEach(id => {
            const el = document.getElementById(id); if (!el) return;
            if (el.__mapToggleBound) return;
            el.addEventListener('click', () => {
                el.classList.toggle('active');
                el.setAttribute('aria-pressed', el.classList.contains('active') ? 'true' : 'false');
                if (id === 'toggleLanes') { try { localStorage.setItem('ui.showLanes', el.classList.contains('active') ? '1' : '0'); } catch {} }
                redrawMap();
            });
            el.__mapToggleBound = true;
        });
        setMapHint('Click any point in the system to calculate warp routes. Empty space is valid.');
}

async function initializeGalaxyMap() {
        const client = window.gameClient; const canvas = document.getElementById('galaxyCanvas'); if (!client || !canvas) return;
        // Set initial size based on container
        const rect = canvas.getBoundingClientRect();
        canvas.width = Math.max(200, Math.floor(rect.width));
        canvas.height = Math.max(200, Math.floor(rect.height));
            const ctx = canvas.getContext('2d');
            canvas.__galaxyView = canvas.__galaxyView || { zoom: 1, panX: 0, panY: 0 };
            const applyView = () => { const v = canvas.__galaxyView; canvas.style.transformOrigin = '0 0'; canvas.style.transform = `translate(${v.panX}px, ${v.panY}px) scale(${v.zoom})`; };
            if (!canvas.__galaxyInputBound) {
                canvas.addEventListener('wheel', ev => { ev.preventDefault(); const v = canvas.__galaxyView; v.zoom = Math.max(1, Math.min(3, v.zoom * (ev.deltaY < 0 ? 1.1 : 0.9))); applyView(); initializeGalaxyMap(); }, { passive: false });
                let drag = null;
                canvas.addEventListener('pointerdown', ev => { if (ev.button === 1 || ev.shiftKey) { drag = { x: ev.clientX, y: ev.clientY, panX: canvas.__galaxyView.panX, panY: canvas.__galaxyView.panY }; canvas.setPointerCapture(ev.pointerId); } });
                canvas.addEventListener('pointermove', ev => { if (drag) { canvas.__galaxyView.panX = drag.panX + ev.clientX - drag.x; canvas.__galaxyView.panY = drag.panY + ev.clientY - drag.y; applyView(); } });
                canvas.addEventListener('pointerup', () => { drag = null; });
                canvas.__galaxyInputBound = true;
            }
            applyView();
            const recenter = document.getElementById('galaxyRecenter');
            if (recenter && !recenter.__bound) { recenter.addEventListener('click', () => { canvas.__galaxyView = { zoom: 1, panX: 0, panY: 0 }; canvas.style.transform = ''; initializeGalaxyMap(); }); recenter.__bound = true; }
        try {
            const graph = await SFApi.State.galaxyGraph(client.gameId); if (!graph || !Array.isArray(graph.systems)) return;
            const systems = graph.systems; const gates = graph.gates || [];
            // Use a deterministic grid layout so IDs do not create clustered or overlapping nodes.
            const columns = Math.max(1, Math.ceil(Math.sqrt(systems.length)));
            const margin = 36;
            const position = (id) => {
                const index = Math.max(0, systems.findIndex(s => s.id === id));
                const col = index % columns, row = Math.floor(index / columns);
                const rows = Math.max(1, Math.ceil(systems.length / columns));
                return {
                    x: margin + (canvas.width - margin * 2) * (columns === 1 ? 0.5 : col / (columns - 1)),
                    y: margin + (canvas.height - margin * 2) * (rows === 1 ? 0.5 : row / (rows - 1))
                };
            };
            canvas.__galaxyPositions = new Map(systems.map(s => [s.id, position(s.id)]));
            if (!canvas.__galaxyInputBound) {
                canvas.addEventListener('click', ev => {
                    const rect = (canvas.parentElement || canvas).getBoundingClientRect();
                    const view = canvas.__galaxyView || { zoom: 1, panX: 0, panY: 0 };
                    const x = (ev.clientX - rect.left - view.panX) / view.zoom, y = (ev.clientY - rect.top - view.panY) / view.zoom;
                    let nearest = null, distance = Infinity;
                    for (const [id, p] of canvas.__galaxyPositions || []) {
                        const d = Math.hypot(x - p.x, y - p.y);
                        if (d < distance) { distance = d; nearest = id; }
                    }
                    if (nearest != null && distance <= 18) {
                        canvas.__galaxySelectedId = nearest;
                        selectGalaxySystem(client, nearest);
                        initializeGalaxyMap();
                    }
                });
                canvas.__galaxyInputBound = true;
            }
            ctx.clearRect(0,0,canvas.width,canvas.height); ctx.fillStyle = '#0b0f1a'; ctx.fillRect(0,0,canvas.width,canvas.height);
            ctx.strokeStyle = 'rgba(100,181,246,0.35)'; ctx.lineWidth = 1.25;
            gates.forEach(e => {
                const s = systems.find(x=>x.id===e.source), t = systems.find(x=>x.id===e.target); if (!s||!t) return;
                const sp = canvas.__galaxyPositions.get(s.id), tp = canvas.__galaxyPositions.get(t.id);
                if (!sp || !tp) return;
                ctx.beginPath(); ctx.moveTo(sp.x, sp.y); ctx.lineTo(tp.x, tp.y); ctx.stroke();
            });
            systems.forEach(n => {
                const p = canvas.__galaxyPositions.get(n.id); if (!p) return;
                ctx.fillStyle = Number(canvas.__galaxySelectedId) === Number(n.id) ? '#ffffff' : '#9ecbff'; ctx.beginPath(); ctx.arc(p.x,p.y,6,0,Math.PI*2); ctx.fill(); ctx.fillStyle='#e3f2fd'; ctx.font='11px Arial'; ctx.textAlign='center'; ctx.fillText(n.name || String(n.id), p.x, p.y-10);
            });
        } catch (e) { console.error('initializeGalaxyMap error:', e); const el=document.getElementById('galaxyLegend'); if (el) el.innerText='Failed to render galaxy map'; }
}

async function renderFullMap(ctx, canvas, scaleX, scaleY, toggles, mouse) {
        const client = window.gameClient; if (!client || !client.objects) return;
        // Always clear and redraw the base frame to avoid visual stacking on repeated calls
        try { ctx.clearRect(0,0,canvas.width,canvas.height); } catch {}
        // Reset label occupancy grid for this draw
        try { delete ctx.__labelGrid; } catch {}
        // Cached gradient background + optional subtle grid
        if (!canvas.__bgCache || canvas.__bgCache.w !== canvas.width || canvas.__bgCache.h !== canvas.height) {
            const bg = document.createElement('canvas'); bg.width = canvas.width; bg.height = canvas.height;
            const bctx = bg.getContext('2d');
            const grad = bctx.createRadialGradient(bg.width/2, bg.height/2, 0, bg.width/2, bg.height/2, Math.max(bg.width, bg.height)/2);
            grad.addColorStop(0, '#0a0a1a'); grad.addColorStop(1, '#050510');
            bctx.fillStyle = grad; bctx.fillRect(0,0,bg.width,bg.height);
            canvas.__bgCache = { w: canvas.width, h: canvas.height, img: bg };
        }
        ctx.drawImage(canvas.__bgCache.img, 0, 0);
        ctx.strokeStyle = 'rgba(100,181,246,0.25)'; ctx.lineWidth = 2; ctx.strokeRect(2,2,canvas.width-4,canvas.height-4);
        // Fetch and cache system facts once per short interval to avoid repeated API calls during hover
        let facts = null;
        try {
            const sectorId = client.gameState?.sector?.id;
            if (sectorId) {
                const now = Date.now();
                const cache = client.__factsCache;
                if (!cache || cache.until <= now) {
                    const fetched = await SFApi.State.systemFacts(sectorId);
                    client.__factsCache = { facts: fetched, until: now + 5000 };
                }
                facts = client.__factsCache?.facts || null;
            }
        } catch {}
        // Enable lanes toggle dynamically if data exists
        try {
            const hasLanes = !!(facts && Array.isArray(facts.lanes) && facts.lanes.length > 0);
            const lanesToggle = document.getElementById('toggleLanes');
            const lanesLabel = lanesToggle?.closest('label');
            if (lanesToggle) {
                lanesToggle.disabled = !hasLanes;
                if (lanesLabel) lanesLabel.style.opacity = hasLanes ? '1' : '0.6';
                if (!hasLanes) toggles.lanes = false;
            }
        } catch {}
        // Orbital tracks are authoritative world geometry. Old systems without
        // persisted tracks intentionally render none instead of a generic grid.
        const orbitalRings = Array.isArray(facts?.orbitalRings) ? facts.orbitalRings : [];
        if (orbitalRings.length) {
            ctx.save();
            orbitalRings.forEach((ring) => {
                const radius = Number(ring.radius || 0);
                if (!(radius > 0)) return;
                ctx.setLineDash([2, 7]);
                ctx.strokeStyle = 'rgba(158, 203, 255, 0.17)';
                ctx.lineWidth = Math.max(0.75, Math.min(1.5, Number(ring.width || 32) / 32));
                ctx.beginPath();
                ctx.ellipse(
                    Number(ring.centerX || 2500) * scaleX,
                    Number(ring.centerY || 2500) * scaleY,
                    radius * scaleX,
                    radius * scaleY,
                    0,
                    0,
                    Math.PI * 2,
                );
                ctx.stroke();
            });
            ctx.setLineDash([]);
            ctx.restore();
        }

        // Regions are lightly tinted territories with a clear boundary, not bright tiles.
        if (toggles.regions && client.gameState?.sector?.id) {
            try {
                if (facts && Array.isArray(facts.regions) && facts.regions.length > 0) {
                    const cellW = 5000 / 3, cellH = 5000 / 3;
                    facts.regions.forEach(r => {
                        let baseColor = '100, 149, 237';
                        const id = String(r.id || '').toUpperCase();
                        if (id === 'A') baseColor = '80, 130, 255';
                        else if (id === 'B') baseColor = '255, 99, 99';
                        else if (id === 'C') baseColor = '255, 200, 80';
                        
                        // Check if mouse is in this region
                        let isHovered = false;
                        if (mouse && typeof mouse.x === 'number') {
                            const col = Math.floor(mouse.x / cellW), row = Math.floor(mouse.y / cellH);
                            isHovered = (r.cells || []).some(c => c.col === col && c.row === row);
                        }

                        const fillOpacity = isHovered ? 0.11 : 0.035;
                        const outlineOpacity = isHovered ? 0.55 : 0.26;
                        ctx.fillStyle = `rgba(${baseColor}, ${fillOpacity})`;
                        ctx.strokeStyle = `rgba(${baseColor}, ${outlineOpacity})`;
                        ctx.lineWidth = isHovered ? 2 : 1;
                        
                        (r.cells || []).forEach(c => {
                            ctx.fillRect(c.col*cellW*scaleX + 1, c.row*cellH*scaleY + 1, cellW*scaleX - 2, cellH*scaleY - 2);
                            ctx.strokeRect(c.col*cellW*scaleX + 1, c.row*cellH*scaleY + 1, cellW*scaleX - 2, cellH*scaleY - 2);
                        });

                        // Region Label - only show on hover
                        if (isHovered) {
                            const first = (r.cells||[])[0];
                            if (first) {
                                const health = Number(r.health || 50);
                                const cx = (first.col*cellW + 15)*scaleX, cy = (first.row*cellH + 15)*scaleY;
                                
                                // Label background
                                ctx.fillStyle = 'rgba(7, 11, 22, 0.85)';
                                ctx.fillRect(cx - 4, cy - 2, 90, 32);
                                ctx.strokeStyle = `rgba(${baseColor}, 0.4)`;
                                ctx.strokeRect(cx - 4, cy - 2, 90, 32);
                                
                                ctx.fillStyle = `rgba(${baseColor}, 0.95)`;
                                ctx.font = 'bold 12px Arial';
                                ctx.textAlign='left'; ctx.textBaseline='top';
                                ctx.fillText(`Region ${r.id}`, cx, cy);
                                ctx.font = '10px Arial';
                                ctx.fillStyle = 'rgba(255,255,255,0.7)';
                                ctx.fillText(`Health: ${health}%`, cx, cy + 14);
                            }
                        }
                    });
                }
            } catch {}
        }
        // Belt polygon rendering removed - only belt POI markers are shown now
        // Wormholes (from facts)
        if (toggles.wormholes && client.gameState?.sector?.id) {
            try {
                const endpoints = facts?.wormholeEndpoints || [];
                ctx.fillStyle = '#b388ff'; ctx.strokeStyle = '#b388ff';
                endpoints.forEach(w => {
                    const x = w.x * scaleX, y = w.y * scaleY;
                    ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI*2); ctx.fill();
                });
            } catch {}
        }
        // Warp Lanes & Taps (read-only overlay)
        if (toggles.lanes && client.gameState?.sector?.id) {
            try {
                const lanes = facts?.lanes || [];
                const tapsByEdge = facts?.laneTapsByEdge || {};
                const healthByRegion = new Map((facts?.regions||[]).map(r=>[String(r.id), Number(r.health||50)]));
                // Draw lanes
                const highlight = client.__laneHighlight && client.__laneHighlight.until > Date.now() ? (client.__laneHighlight.legs||[]) : [];
                const highlightEdges = new Set(highlight.map(L=>Number(L.edgeId)));
                // Fetch active transits (cached) once per render
                let activeTransitsByEdge = new Map();
                try {
                    if (!client.__laneTransitsCache || client.__laneTransitsCache.until < Date.now()) {
                        const resp = await new Promise((resolve)=>{
                            SFApi.Socket.emit('lanes:active', { sectorId: client.gameState.sector.id }, (r)=>resolve(r));
                        });
                        if (resp?.success) client.__laneTransitsCache = { until: Date.now()+1500, rows: resp.transits||[] };
                    }
                    const rows = client.__laneTransitsCache?.rows || [];
                    const m = new Map();
                    rows.forEach(tr => {
                        const k = Number(tr.edgeId);
                        const arr = m.get(k) || [];
                        arr.push(tr);
                        m.set(k, arr);
                    });
                    activeTransitsByEdge = m;
                } catch {}
                lanes.forEach(l => {
                    const pts = Array.isArray(l.polyline) ? l.polyline : [];
                    if (pts.length < 2) return;
                    
                    const health = healthByRegion.get(String(l.region_id)) ?? 50;
                    const healthMult = health>=80?1.25:(health>=60?1.0:0.7);
                    const cap = Math.max(1, Math.floor(Number(l.cap_base||0) * (Number(l.width_core||150)/150) * healthMult));
                    const load = Number(l.runtime?.load_cu || 0);
                    const rho = load / Math.max(1, cap);
                    
                    // Check if this lane is part of highlighted route
                    const isHighlighted = highlightEdges.has(Number(l.id));
                    
                    // SUBTLE by default - only prominent when highlighted
                    const baseOpacity = isHighlighted ? 0.85 : 0.15;
                    const lineWidth = isHighlighted ? 3 : 2;
                    
                    // Muted teal color by default
                    let coreColor = `rgba(100, 180, 180, ${baseOpacity})`;
                    if (isHighlighted) {
                        // Bright colors for highlighted routes
                        if (rho > 2.0) coreColor = `rgba(211,47,47,${baseOpacity})`;
                        else if (rho > 1.5) coreColor = `rgba(239,83,80,${baseOpacity})`;
                        else if (rho > 1.0) coreColor = `rgba(255,202,40,${baseOpacity})`;
                        else coreColor = `rgba(102,220,150,${baseOpacity})`;
                    }
                    
                    if (health < 40) coreColor = `rgba(120,120,120,${baseOpacity * 0.8})`;

                    ctx.strokeStyle = coreColor;
                    ctx.lineWidth = lineWidth;
                    ctx.lineCap = 'round'; 
                    ctx.lineJoin = 'round';
                    
                    ctx.beginPath();
                    ctx.moveTo(pts[0].x*scaleX, pts[0].y*scaleY);
                    for (let i=1;i<pts.length;i++) ctx.lineTo(pts[i].x*scaleX, pts[i].y*scaleY);
                    ctx.stroke();
                    // Per-edge highlight removed; a global pass draws all confirmed legs across edges
                    // Hover badges for lane stats
                    if (mouse && typeof mouse.x==='number' && typeof mouse.y==='number') {
                        const projectToSegment = (p,a,b)=>{ const apx=p.x-a.x, apy=p.y-a.y; const abx=b.x-a.x, aby=b.y-a.y; const ab2=Math.max(1e-6,abx*abx+aby*aby); const t=Math.max(0, Math.min(1, (apx*abx+apy*aby)/ab2)); return { x:a.x+abx*t, y:a.y+aby*t, t }; };
                        let best={d:Infinity, i:0, point:pts[0]};
                        for (let i=1;i<pts.length;i++){ const pr=projectToSegment(mouse, pts[i-1], pts[i]); const d=Math.hypot(mouse.x-pr.x, mouse.y-pr.y); if (d<best.d){ best={d, i:i-1, point:{x:pr.x,y:pr.y}}; } }
                        if (best.d * ((scaleX+scaleY)/2) < 12) {
                            const tip = `ρ ${rho.toFixed(2)}  • cap ${cap}  • headway ${l.headway}`;
                            const tx = best.point.x*scaleX + 10, ty = best.point.y*scaleY - 8;
                            ctx.save(); ctx.font='13px Arial';
                            const tw = ctx.measureText(tip).width + 10; const th = 18;
                            ctx.fillStyle='rgba(15,25,45,0.92)'; ctx.fillRect(tx, ty, tw, th);
                            ctx.strokeStyle='rgba(158,203,255,0.6)'; ctx.strokeRect(tx, ty, tw, th);
                            ctx.fillStyle='#cfe8ff'; ctx.textAlign='left'; ctx.textBaseline='top';
                            ctx.fillText(tip, tx+5, ty+2); ctx.restore();
                        }
                    }
                    // Taps (diamonds)
                    const taps = tapsByEdge[l.id] || [];
                    ctx.fillStyle = 'rgba(185, 8, 177, 0.95)';
                    taps.forEach((t, tapIndex) => {
                        const x = t.x*scaleX, y = t.y*scaleY;
                        const tapLabel = t.id != null ? `T${t.id}` : `T${String(l.id)}-${tapIndex + 1}`;
                        ctx.beginPath();
                        ctx.moveTo(x, y-6);
                        ctx.lineTo(x+6, y);
                        ctx.lineTo(x, y+6);
                        ctx.lineTo(x-6, y);
                        ctx.closePath();
                        ctx.fill();
                        // queued CU label
                        const q = Number(t.queued_cu || 0);
                        if (q > 0) {
                            ctx.fillStyle = '#cfe8ff'; ctx.font='12px Arial'; ctx.textAlign='left'; ctx.textBaseline='middle';
                            ctx.fillText(String(q), x+6, y);
                            ctx.fillStyle = 'rgba(185, 8, 177, 0.95)';
                        }
                        // hover tooltip for tap queue
                        if (mouse && Math.hypot(mouse.x - t.x, mouse.y - t.y) * ((scaleX+scaleY)/2) < 10) {
                            ctx.save(); ctx.font='12px Arial'; const tip = `${tapLabel}  ·  Tap queue: ${q} CU`;
                            const tw = ctx.measureText(tip).width + 8; const th = 16;
                            const tx = x + 10; const ty = y - 6;
                            ctx.fillStyle = 'rgba(15,25,45,0.9)'; ctx.fillRect(tx, ty, tw, th);
                            ctx.strokeStyle = 'rgba(158,203,255,0.6)'; ctx.strokeRect(tx, ty, tw, th);
                            ctx.fillStyle = '#cfe8ff'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
                            ctx.fillText(tip, tx + 4, ty + 2); ctx.restore();
                        }
                    });

                    // Active transits overlays
                    try {
                        const active = activeTransitsByEdge.get(Number(l.id)) || [];
                        if (active.length) {
                            const pts = Array.isArray(l.polyline) ? l.polyline : [];
                            const acc=[0]; for (let i=1;i<pts.length;i++){ acc[i]=acc[i-1]+Math.hypot(pts[i].x-pts[i-1].x, pts[i].y-pts[i-1].y); }
                            const total = acc[acc.length-1]||1;
                            const lerpAt = (p)=>{
                                const s = Math.max(0, Math.min(total, p*total));
                                let idx=0; while (idx<acc.length-1 && acc[idx+1] < s) idx++;
                                const t = (s-acc[idx]) / Math.max(1e-6, (acc[idx+1]-acc[idx]));
                                return { x: pts[idx].x + (pts[idx+1].x-pts[idx].x)*t, y: pts[idx].y + (pts[idx+1].y-pts[idx].y)*t };
                            };
                            active.forEach(tr => {
                                const p = Math.max(0, Math.min(1, Number(tr.progress||0)));
                                const pt = lerpAt(p);
                                ctx.fillStyle = tr.mode==='shoulder' ? '#ffca28' : '#66bb6a';
                                ctx.beginPath(); ctx.arc(pt.x*scaleX, pt.y*scaleY, 3, 0, Math.PI*2); ctx.fill();
                            });
                        }
                    } catch {}
                });
            } catch {}
        }
        // Global highlight pass so multi-edge routes are fully visible
        try {
            // Ensure facts are available for highlighting
            let highlightFacts = facts;
            if (!highlightFacts && client.gameState?.sector?.id) {
                const cache = client.__factsCache;
                if (cache && cache.until > Date.now()) highlightFacts = cache.facts;
                else highlightFacts = cache?.facts || null;
            }
            const rawLegs = (client.__laneHighlight && client.__laneHighlight.until > Date.now()) ? (client.__laneHighlight.legs||[]) : [];
            const legs = rawLegs.map(normalizeLeg).filter(L => Number.isFinite(L.edgeId));
            if (legs.length && highlightFacts) {
                try { console.log('[client] highlight legs', legs.map(L=>({ edgeId:L.edgeId, sStart:Math.round(L.sStart), sEnd:Math.round(L.sEnd) }))); } catch {}
                const laneById = new Map(); (highlightFacts.lanes||[]).forEach(L => laneById.set(Number(L.id ?? L.edgeId ?? L.edge_id), L));
                const tapsByEdge = new Map(Object.entries(highlightFacts.laneTapsByEdge || {}).map(([k,v])=>[Number(k), v||[]]));
                legs.forEach(L => {
                    const lane = laneById.get(Number(L.edgeId));
                    const pts = Array.isArray(lane?.polyline) ? lane.polyline : [];
                    if (pts.length < 2) return;
                    const acc=[0]; for (let i=1;i<pts.length;i++){ acc[i]=acc[i-1]+Math.hypot(pts[i].x-pts[i-1].x, pts[i].y-pts[i-1].y); }
                    const total = acc[acc.length-1]||1;
                    const sA = Math.max(0, Math.min(total, Number(L.sStart||0)));
                    const sB = Math.max(0, Math.min(total, Number(L.sEnd||total)));
                    const a = Math.min(sA, sB), b = Math.max(sA, sB);
                    if (Math.abs(b - a) < 1e-3) return; // skip zero-length
                    let aIdx=0; while (aIdx<acc.length-1 && acc[aIdx+1] < a) aIdx++;
                    let bIdx=aIdx; while (bIdx<acc.length-1 && acc[bIdx+1] < b) bIdx++;
                    const lerpPoint = (idx, s) => { const t = (s-acc[idx]) / Math.max(1e-6, (acc[idx+1]-acc[idx])); return { x: pts[idx].x + (pts[idx+1].x-pts[idx].x)*t, y: pts[idx].y + (pts[idx+1].y-pts[idx].y)*t }; };
                    const start = lerpPoint(aIdx, a), end = lerpPoint(bIdx, b);
                    const laneWidth = Number(lane?.width_core || 180);
                    // Planned lane leg highlight: solid dark purple overlay (easier to see)
                    ctx.save();
                    ctx.setLineDash([]);
                    ctx.strokeStyle = 'rgba(90, 0, 160, 0.95)';
                    ctx.lineWidth = Math.max(2.5, laneWidth * 0.35 * ((scaleX+scaleY)/2));
                    ctx.beginPath();
                    ctx.moveTo(start.x*scaleX, start.y*scaleY);
                    for (let i=aIdx+1;i<=bIdx;i++) ctx.lineTo(pts[i].x*scaleX, pts[i].y*scaleY);
                    ctx.lineTo(end.x*scaleX, end.y*scaleY);
                    ctx.stroke();
                    ctx.setLineDash([]);
                    ctx.restore();
                    // endpoints markers for debugging visualization
                    ctx.fillStyle = '#ffffff';
                    ctx.beginPath(); ctx.arc(start.x*scaleX, start.y*scaleY, 2.5, 0, Math.PI*2); ctx.fill();
                    ctx.beginPath(); ctx.arc(end.x*scaleX, end.y*scaleY, 2.5, 0, Math.PI*2); ctx.fill();
                });
                // Post-impulse preview: draw dashed path from lane exit to planner target (yellow)
                try {
                    const lastLeg = legs[legs.length - 1];
                    if (lastLeg && client.__plannerTarget) {
                        const lane = laneById.get(Number(lastLeg.edgeId));
                        const pts = Array.isArray(lane?.polyline) ? lane.polyline : [];
                        if (pts.length >= 2) {
                            const acc=[0]; for (let i=1;i<pts.length;i++){ acc[i]=acc[i-1]+Math.hypot(pts[i].x-pts[i-1].x, pts[i].y-pts[i-1].y); }
                            const total = acc[acc.length-1]||1;
                            const sExit = Math.max(0, Math.min(total, Number(lastLeg.sEnd||total)));
                            let j=0; while (j<acc.length-1 && acc[j+1] < sExit) j++;
                            const t=(sExit-acc[j])/Math.max(1e-6,(acc[j+1]-acc[j]));
                            const exitPt = { x: pts[j].x + (pts[j+1].x-pts[j].x)*t, y: pts[j].y + (pts[j+1].y-pts[j].y)*t };
                            const to = client.__plannerTarget;
                            // Only draw if post-impulse has real distance
                            if (Math.hypot((to.x-exitPt.x),(to.y-exitPt.y)) >= 1) {
                            ctx.save();
                            ctx.setLineDash([6,4]);
                            ctx.strokeStyle = 'rgba(255,255,0,0.85)';
                            ctx.lineWidth = 1.5;
                            ctx.beginPath();
                            ctx.moveTo(exitPt.x*scaleX, exitPt.y*scaleY);
                            ctx.lineTo(to.x*scaleX, to.y*scaleY);
                            ctx.stroke();
                            ctx.setLineDash([]);
                            ctx.restore();
                            }
                        }
                    }
                } catch {}
                // Draw approach to first entry tap (dashed), so zero-length lane legs still visualize
                try {
                    const first = legs[0];
                    const entryTapId = Number(first?.tapId);
                    if (Number.isFinite(entryTapId)) {
                        const tapEdge = Number(first.edgeId);
                        const tapsArr = tapsByEdge.get(tapEdge) || [];
                        const tap = tapsArr.find(t=>Number(t.id)===entryTapId);
                        const ship = client.selectedUnit;
                        if (tap && ship) {
                            ctx.save();
                            ctx.setLineDash([6,4]);
                            ctx.strokeStyle = 'rgba(158,203,255,0.85)';
                            ctx.lineWidth = 1.75;
                            ctx.beginPath();
                            ctx.moveTo(ship.x*scaleX, ship.y*scaleY);
                            ctx.lineTo(tap.x*scaleX, tap.y*scaleY);
                            ctx.stroke();
                            ctx.setLineDash([]);
                            ctx.restore();
                        }
                    }
                } catch {}
            }
        } catch {}
        // Helper: smart label drawing with simple collision grid
        function drawSmartLabel(ctx2, lx, ly, text, maxChars=18, fontSize=11) {
            try {
                if (!ctx2.__labelGrid) ctx2.__labelGrid = new Set();
                const positions = [
                    { x: lx, y: ly + 10, align:'center', base:'top' },
                    { x: lx + 12, y: ly, align:'left', base:'middle' },
                    { x: lx - 12, y: ly, align:'right', base:'middle' },
                    { x: lx, y: ly - 10, align:'center', base:'bottom' }
                ];
                const label = String(text||'').slice(0, maxChars);
                ctx2.font = `600 ${fontSize}px "Inter", "Segoe UI", Arial`;
                const m = ctx2.measureText(label);
                const w = m.width + 10;
                const h = fontSize + 6;
                const cell = 12;
                for (const pos of positions) {
                    const left = pos.align === 'center' ? pos.x - w/2 : (pos.align === 'left' ? pos.x : pos.x - w);
                    const top = pos.base === 'middle' ? pos.y - h/2 : (pos.base === 'top' ? pos.y : pos.y - h);
                    
                    // Occupancy cells covered
                    const x0 = Math.floor(left / cell), y0 = Math.floor(top / cell);
                    const x1 = Math.floor((left + w) / cell), y1 = Math.floor((top + h) / cell);
                    let collides = false;
                    for (let gx=x0; gx<=x1 && !collides; gx++) for (let gy=y0; gy<=y1 && !collides; gy++) {
                        if (ctx2.__labelGrid.has(`${gx},${gy}`)) collides = true;
                    }
                    if (collides) continue;
                    
                    // Draw background pill
                    ctx2.save();
                    ctx2.beginPath();
                    const radius = 4;
                    ctx2.roundRect(left, top, w, h, radius);
                    ctx2.fillStyle = 'rgba(7, 11, 22, 0.9)';
                    ctx2.fill();
                    ctx2.strokeStyle = 'rgba(100, 181, 246, 0.3)';
                    ctx2.lineWidth = 1;
                    ctx2.stroke();
                    
                    // Text
                    ctx2.fillStyle = '#e3f2fd';
                    ctx2.textAlign = pos.align; 
                    ctx2.textBaseline = pos.base;
                    // Adjust text position slightly if not centered
                    const tx = pos.align === 'center' ? pos.x : (pos.align === 'left' ? pos.x + 5 : pos.x - 5);
                    const ty = pos.y;
                    ctx2.fillText(label, tx, ty);
                    ctx2.restore();
                    
                    // Mark occupied
                    for (let gx=x0; gx<=x1; gx++) for (let gy=y0; gy<=y1; gy++) ctx2.__labelGrid.add(`${gx},${gy}`);
                    return true;
                }
            } catch {}
            return false;
        }
        // Click Marker & Ripple
        if (client.__mapClickMarker && (Date.now() - client.__mapClickMarker.time) < 1500) {
            const m = client.__mapClickMarker;
            const age = Date.now() - m.time;
            const radius = 5 + (age / 1500) * 30;
            const alpha = 1 - (age / 1500);
            ctx.save();
            ctx.strokeStyle = `rgba(100, 181, 246, ${alpha})`;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(m.x * scaleX, m.y * scaleY, radius, 0, Math.PI * 2);
            ctx.stroke();
            
            ctx.fillStyle = `rgba(100, 181, 246, ${alpha * 0.5})`;
            ctx.beginPath();
            ctx.arc(m.x * scaleX, m.y * scaleY, 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
            // Clear marker after animation completes (no more infinite loop)
            if (age >= 1500) {
                client.__mapClickMarker = null;
            }
        }

        // Persistent navigation markers remain visible after the click ripple fades.
        const drawNavMarker = (point, color, label, dashed = false) => {
            if (!point || !Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.y))) return;
            const x = Number(point.x) * scaleX, y = Number(point.y) * scaleY;
            ctx.save();
            ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 2;
            if (dashed) ctx.setLineDash([4, 3]);
            ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(x - 13, y); ctx.lineTo(x + 13, y); ctx.moveTo(x, y - 13); ctx.lineTo(x, y + 13); ctx.stroke();
            ctx.setLineDash([]);
            ctx.font = '600 11px "Inter", "Segoe UI", Arial'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
            ctx.fillText(label, x + 12, y - 8);
            ctx.restore();
        };
        drawNavMarker(client.selectedUnit, '#64b5f6', client.selectedUnit?.name || 'Ship');
        drawNavMarker(client.__plannerTarget, '#ffca28', 'Destination', true);

        // Base objects. Labels are opt-in and deduplicated because some
        // generated systems expose the same belt anchor more than once.
        const drawnLabelKeys = new Set();
        const drawUniqueLabel = (x, y, name, maxChars = 18, fontSize = 11) => {
            if (!toggles.labels || !name) return;
            const key = String(name).trim().toLowerCase();
            if (drawnLabelKeys.has(key)) return;
            if (drawSmartLabel(ctx, x, y, name, maxChars, fontSize)) drawnLabelKeys.add(key);
        };
        client.objects.forEach(obj => {
            const x = obj.x * scaleX, y = obj.y * scaleY; 
            const isSelected = client.selectedUnit?.id === obj.id;
            const isPlannerTarget = client.__plannerTarget && Math.hypot(client.__plannerTarget.x - obj.x, client.__plannerTarget.y - obj.y) < 10;
            
            // Selection Glow
            if (isSelected || isPlannerTarget) {
                ctx.save();
                ctx.beginPath();
                ctx.arc(x, y, 12, 0, Math.PI * 2);
                const grad = ctx.createRadialGradient(x, y, 0, x, y, 12);
                grad.addColorStop(0, isSelected ? 'rgba(100, 181, 246, 0.4)' : 'rgba(255, 202, 40, 0.4)');
                grad.addColorStop(1, 'rgba(100, 181, 246, 0)');
                ctx.fillStyle = grad;
                ctx.fill();
                ctx.restore();
            }

            if (obj.type === 'interstellar-gate') {
                ctx.save();
                ctx.font = '20px Arial';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.shadowBlur = 8;
                ctx.shadowColor = '#b388ff';
                ctx.fillText('🌀', x, y);
                ctx.restore();
                
                const name = obj.meta?.name || 'Gate';
                drawUniqueLabel(x, y, name, 18, 12);
            } else if (client.isCelestialObject(obj)) {
                const t = obj.celestial_type || obj.type;
                let color = '#9ecbff';
                let icon = '';
                let size = 5;
                
                if (t === 'sun' || t === 'star') { icon = '☀️'; color = '#ffca28'; size = 8; }
                else if (t === 'planet') { icon = '🪐'; color = '#64b5f6'; size = 7; }
                else if (t === 'wormhole') { icon = '🌀'; color = '#b388ff'; size = 6; }
                else if (t === 'moon') { icon = '🌑'; color = '#cfd8dc'; size = 4; }
                
                if (icon) {
                    ctx.save();
                    ctx.font = `${size * 2}px Arial`;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(icon, x, y);
                    ctx.restore();
                } else {
                    ctx.fillStyle = color;
                    ctx.beginPath(); ctx.arc(x,y,size,0,Math.PI*2); ctx.fill();
                }

                const name = obj.meta?.name || (t.charAt(0).toUpperCase() + t.slice(1));
                drawUniqueLabel(x, y, name, 18, 11);
            } else if (obj.type === 'resource_node') {
                ctx.fillStyle = 'rgba(255, 213, 79, 0.62)';
                ctx.shadowBlur = 2;
                ctx.shadowColor = 'rgba(255, 213, 79, 0.45)';
                ctx.fillRect(x-1.5,y-1.5,3,3);
                ctx.shadowBlur = 0;
            } else if (obj.type === 'station' || obj.type === 'structure' || obj.meta?.structureType || obj.meta?.category === 'station') {
                // Stations are strategic anchors, so give them a distinct
                // readable silhouette instead of rendering them like ships.
                ctx.save();
                ctx.fillStyle = '#b7d8ff'; ctx.strokeStyle = '#64b5f6'; ctx.lineWidth = 1.5;
                ctx.beginPath(); ctx.rect(x - 6, y - 6, 12, 12); ctx.fill(); ctx.stroke();
                ctx.fillStyle = '#102642'; ctx.fillRect(x - 2, y - 2, 4, 4);
                ctx.restore();
                drawUniqueLabel(x, y, obj.meta?.name || 'Station', 18, 11);
            } else {
                // Ships
                const isPlayer = obj.owner_id === client.userId;
                ctx.fillStyle = isPlayer ? '#66bb6a' : '#ef5350';
                ctx.beginPath();
                ctx.moveTo(x, y - 5);
                ctx.lineTo(x + 4, y + 4);
                ctx.lineTo(x - 4, y + 4);
                ctx.closePath();
                ctx.fill();
                
                if (isSelected) {
                    ctx.strokeStyle = '#ffffff';
                    ctx.lineWidth = 1;
                    ctx.stroke();
                }
            }
        });
}

async function loadGalaxyDataInternal() {
        try {
            const client = window.gameClient; const list = document.getElementById('galaxySystemsList'); if (!client || !list) return;
            const currentSystem = { name: client.gameState?.sector?.name || 'Current System', id: client.gameState?.sector?.id, players: 1, status: 'Active', turn: client.gameState?.turn?.number || 1, celestialObjects: client.objects ? client.objects.filter(o=>client.isCelestialObject(o)).length : 0 };
            list.innerHTML = `<div class="galaxy-system-card"><div class="galaxy-system-name">${currentSystem.name}</div><div class="galaxy-system-info"><div>👥 ${currentSystem.players} Player${currentSystem.players!==1?'s':''}</div><div>⏰ Turn ${currentSystem.turn}</div><div>🛰️ ${currentSystem.celestialObjects} Celestial Objects</div><div>📈 Status: <span style="color:#4CAF50;">${currentSystem.status}</span></div></div></div>`;
        } catch {}
}

async function populateSystemFactsInternal() {
        try {
            const client = window.gameClient; const wrap = document.getElementById('sysMetaSummary'); if (!wrap || !client?.gameState?.sector) return;
            const sector = client.gameState.sector;
            const facts = await SFApi.State.systemFacts(sector.id);
            const minerals = Array.isArray(facts?.minerals) ? facts.minerals : [];
            const counts = new Map(minerals.map(m => [String(m.name), Number(m.count||0)]));
            const disp = facts?.mineralDisplay || {};
            
            const chip = (txt, color='var(--primary)') => `<span style="display:inline-block; padding:2px 8px; border:1px solid ${color}40; background:${color}10; border-radius:12px; margin:2px; font-size:11px; color:var(--text); white-space:nowrap;">${txt}</span>`;
            
            const fmt = (name, mult) => `${name} x${mult}`;
            const coreList = (disp.core || []).map(m => chip(fmt(m.name, m.mult), '#81c784'));
            const primaryList = (disp.primary || []).map(m => chip(fmt(m.name, m.mult), 'var(--primary)'));
            const secondaryList = (disp.secondary || []).map(m => chip(fmt(m.name, m.mult), 'var(--muted)'));
            
            wrap.innerHTML = `
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px; margin-bottom:12px;">
                    <div><span style="color:var(--muted)">Sector ID:</span> ${sector.id}</div>
                    <div><span style="color:var(--muted)">Archetype:</span> ${sector.archetype||'Standard'}</div>
                </div>
                <div style="margin-bottom:8px;">
                    <div style="font-size:11px; color:var(--muted); text-transform:uppercase; margin-bottom:4px;">Core Minerals</div>
                    <div style="display:flex; flex-wrap:wrap;">${coreList.length?coreList.join(''):'—'}</div>
                </div>
                <div style="margin-bottom:8px;">
                    <div style="font-size:11px; color:var(--muted); text-transform:uppercase; margin-bottom:4px;">Primary Abundance</div>
                    <div style="display:flex; flex-wrap:wrap;">${primaryList.length?primaryList.join(''):'—'}</div>
                </div>
                <div>
                    <div style="font-size:11px; color:var(--muted); text-transform:uppercase; margin-bottom:4px;">Trace Elements</div>
                    <div style="display:flex; flex-wrap:wrap;">${secondaryList.length?secondaryList.join(''):'—'}</div>
                </div>
            `;
        } catch {}
}
