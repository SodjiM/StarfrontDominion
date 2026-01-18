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
            id: game.gameId,
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
        galaxyList.addEventListener('click', (e) => {
            const row = e.target.closest('[data-action="select-system"]');
            if (row) selectGalaxySystem(game, Number(row.dataset.systemId));
        });
    } catch (error) {
        console.error('Error loading galaxy data:', error);
        const galaxyList = document.getElementById('galaxySystemsList');
        if (galaxyList) galaxyList.innerHTML = `<div style="text-align: center; color: #f44336; padding: 40px;">❌ Failed to load galaxy data</div>`;
    }
}

export function selectGalaxySystem(game, systemId) {
    if (systemId === game.gameId) {
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
        const modalContent = document.createElement('div');
        modalContent.className = 'map-root';
        modalContent.innerHTML = `
            <div class="map-tabs">
                <button class="map-tab active sf-btn sf-btn-secondary" data-tab="solar-system">🪐 Solar System</button>
                <button class="map-tab sf-btn sf-btn-secondary" data-tab="galaxy">🌌 Galaxy</button>
            </div>
            <div id="solar-system-tab" class="map-tab-content">
                <div class="map-row">
                    <div class="map-left">
                        <div class="map-header">
                            <h3>🪐 ${client.gameState?.sector?.name || 'Current Solar System'}</h3>
                            <p>Strategic sector overview & navigation</p>
                        </div>
                        
                        <div class="map-controls-row">
                            <label id="layersChip" class="layer-chip">
                                <input type="checkbox" id="toggleLayers" checked style="display:none;">
                                <span>🗺️ Map Layers</span>
                            </label>
                            <label class="layer-chip">
                                <input type="checkbox" id="toggleLanes" style="display:none;">
                                <span>🛰️ Warp Lanes</span>
                            </label>
                            
                            <div id="layerPanel" style="display:none; position:absolute; top:110px; left:30px; background:rgba(10,18,32,0.95); border:1px solid rgba(100,181,246,0.3); border-radius:12px; padding:12px; min-width:200px; z-index:1000; box-shadow:0 8px 32px rgba(0,0,0,0.5);">
                                <div style="margin-bottom:10px; font-weight:bold; color:#64b5f6; border-bottom:1px solid rgba(100,181,246,0.2); padding-bottom:6px;">Display Filters</div>
                                <label style="display:flex; align-items:center; gap:8px; margin:8px 0; cursor:pointer;">
                                    <input type="checkbox" id="toggleRegions" checked> 🧭 Control Regions
                                </label>
                                <label style="display:flex; align-items:center; gap:8px; margin:8px 0; cursor:pointer;">
                                    <input type="checkbox" id="toggleBelts" checked> ⛓️ Asteroid Belts
                                </label>
                                <label style="display:flex; align-items:center; gap:8px; margin:8px 0; cursor:pointer;">
                                    <input type="checkbox" id="toggleWormholes" checked> 🌀 Wormholes
                                </label>
                            </div>
                        </div>

                        <div class="map-canvas-wrap" style="border-radius:12px; overflow:hidden; border:1px solid var(--border);">
                            <canvas id="fullMapCanvas" class="full-map-canvas"></canvas>
                        </div>
                    </div>

                    <div class="map-sidebar">
                        <!-- Warp Planner Section -->
                        <div id="plannerPanel" class="sidebar-section">
                            <div class="sidebar-header">
                                <h4 class="sidebar-title">Warp Planner</h4>
                                <button id="factsToggle" class="sf-btn sf-btn-secondary small" title="System Dashboard" style="padding:4px 8px;">
                                    <span>Stats</span><span id="factsChevron">▸</span>
                                </button>
                            </div>
                            <div id="plannerHelp" style="font-size:12px; color:var(--muted); line-height:1.4;">Select a warp-capable ship and destination to plot a route.</div>
                            
                            <div style="display:flex; gap:8px; align-items:center; margin:4px 0;">
                                <div style="display:flex; gap:4px;">
                                    <input id="coordX" type="number" placeholder="X" class="sf-input" style="width:70px;"/>
                                    <input id="coordY" type="number" placeholder="Y" class="sf-input" style="width:70px;"/>
                                </div>
                                <button class="sf-btn sf-btn-primary small" id="btnPlanCoords" style="flex:1;">Plot Route</button>
                            </div>

                            <div id="poiSelector" style="display:grid; grid-template-columns: 1fr 1fr; gap:6px;">
                                <button class="sf-btn sf-btn-secondary small" data-poi-tab="planets" style="font-size:11px; padding:6px;">Planets</button>
                                <button class="sf-btn sf-btn-secondary small" data-poi-tab="wormholes" style="font-size:11px; padding:6px;">Wormholes</button>
                                <button class="sf-btn sf-btn-secondary small" data-poi-tab="taps" style="font-size:11px; padding:6px;">Lane Taps</button>
                                <button class="sf-btn sf-btn-secondary small" data-poi-tab="belts" style="font-size:11px; padding:6px;">Belts</button>
                            </div>
                        </div>

                        <!-- Scrollable Content: POI List & Routes -->
                        <div class="sidebar-section scroll" id="railScroll">
                            <div id="poiList" style="margin-bottom:12px;"></div>
                            <div id="plannerRoutes" style="display:flex; flex-direction:column; gap:10px;"></div>
                            
                            <!-- System Facts (Dashboard) -->
                            <div class="sidebar-section" style="margin-top:auto; padding:0; background:transparent; border:none;">
                                <div style="display:flex; align-items:center; justify-content:space-between; padding:8px 0; cursor:pointer; border-top:1px solid var(--border);" id="factsBar">
                                    <div style="color:var(--primary); font-size:0.85rem; font-weight:600;">System Dashboard</div>
                                    <div id="factsChevron2" style="color:var(--primary);">▸</div>
                                </div>
                                <div id="sysMetaSummaryWrap" style="display:none;">
                                    <div id="sysMetaSummary" style="font-size:12px; line-height:1.6; padding:8px 0;">Loading system telemetry...</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <div id="galaxy-tab" class="map-tab-content hidden">
                <div class="map-row">
                    <div class="map-left">
                        <div class="map-header">
                            <h3>🌌 Galaxy Cartography</h3>
                            <p>Interstellar gate network and known systems</p>
                        </div>
                        <div class="map-canvas-wrap" style="border-radius:12px; overflow:hidden; border:1px solid var(--border);">
                            <canvas id="galaxyCanvas" class="full-map-canvas"></canvas>
                        </div>
                    </div>
                    <div class="map-sidebar">
                        <div class="sidebar-section scroll">
                            <div class="sidebar-header">
                                <h4 class="sidebar-title">Known Systems</h4>
                            </div>
                            <div id="galaxySystemsList">
                                <!-- Galaxy systems list will be populated here -->
                            </div>
                        </div>
                    </div>
                </div>
            </div>`;
        window.UI.showModal({ title:'🗺️ Strategic Map', content: modalContent, actions:[{ text:'Close', style:'secondary', action:()=>true }], className:'map-modal', width:1280, height:1020 });
        // Bind tab switching without globals
        bindTabEvents(modalContent);
        // Planner coordinate inputs
        try {
            const btn = modalContent.querySelector('#btnPlanCoords');
            const xEl = modalContent.querySelector('#coordX');
            const yEl = modalContent.querySelector('#coordY');
            const doPlan = () => { if (!xEl || !yEl) return; const x = Number(xEl.value||0); const y = Number(yEl.value||0); if (!Number.isFinite(x) || !Number.isFinite(y)) return; planToDestination({ x, y }); };
            if (btn) btn.onclick = doPlan;
            if (xEl) xEl.onkeydown = (e)=>{ if (e.key==='Enter') doPlan(); };
            if (yEl) yEl.onkeydown = (e)=>{ if (e.key==='Enter') doPlan(); };
            // POI selector tabs
            modalContent.querySelectorAll('[data-poi-tab]').forEach(btn => btn.addEventListener('click', ()=>populatePoiList(modalContent, btn.dataset.poiTab)));
            setTimeout(()=>populatePoiList(modalContent, 'planets'), 150);
        } catch {}
        // Layers chip toggle
        try {
            const chip = modalContent.querySelector('#layersChip');
            const panel = modalContent.querySelector('#layerPanel');
            if (chip && panel) {
                const hidePanel = (ev)=>{ if (!panel.contains(ev.target) && !chip.contains(ev.target)) { panel.style.display='none'; document.removeEventListener('click', hidePanel); } };
                chip.onclick = (e)=>{
                    e.stopPropagation();
                    const vis = panel.style.display === 'block';
                    panel.style.display = vis ? 'none' : 'block';
                    if (!vis) setTimeout(()=>document.addEventListener('click', hidePanel), 0);
                };
            }
        } catch {}
        // Ensure planner availability based on selection
        try { updatePlannerState(modalContent); } catch {}
        
        // Collapsible facts: closed by default
        try {
            const toggle = modalContent.querySelector('#factsToggle');
            const factsBar = modalContent.querySelector('#factsBar');
            const wrap = modalContent.querySelector('#sysMetaSummaryWrap');
            const chev = modalContent.querySelector('#factsChevron');
            const chev2 = modalContent.querySelector('#factsChevron2');
            const setFacts = (open) => {
                if (!wrap) return; wrap.style.display = open ? 'block' : 'none';
                if (chev)  chev.textContent  = open ? '▾' : '▸';
                if (chev2) chev2.textContent = open ? '▾' : '▸';
            };
            setFacts(false);
            if (toggle)  toggle.onclick  = () => setFacts(wrap && wrap.style.display === 'none');
            if (factsBar) factsBar.onclick = () => setFacts(wrap && wrap.style.display === 'none');
        } catch {}
        
        // Load any active itineraries to show Start/Abort CTA on reopen
        try {
            (async () => {
                const client = window.gameClient;
                if (client?.gameId && client?.userId) {
                    const resp = await SFApi.State.itineraries(client.gameId, client.userId, client.gameState?.sector?.id);
                    const items = Array.isArray(resp?.itineraries) ? resp.itineraries.filter(it => it.status === 'active') : [];
                    if (items.length) {
                        const container = modalContent.querySelector('#plannerRoutes');
                        if (container) {
                            const rows = items.slice(0, 3).map((it, idx) => {
                                const legs = (it.legs||[]).map(normalizeLeg).filter(L=>Number.isFinite(L.edgeId));
                                const legsText = legs.map(L=>`E${L.edgeId} ${L.entry==='tap'?'tap':'wild'} [${Math.round(L.sStart)}-${Math.round(L.sEnd)}]`).join(' | ');
                                return `<div style=\"display:grid; grid-template-columns:1fr auto; gap:6px; align-items:center; border:1px solid rgba(100,181,246,0.25); padding:6px; border-radius:6px;\">\n                                    <div><div style=\\\"font-size:12px; color:#9ecbff\\\">Active itinerary • Ship ${it.shipId}</div>\n                                    <div style=\\\"font-size:11px; color:#9ecbff;\\\">${legsText}</div></div>\n                                    <div style=\\\"display:flex; gap:6px;\\\">\n                                        <button class=\\\"sf-btn sf-btn-secondary\\\" data-itin-index=\\\"${idx}\\\" data-action=\\\"startItin\\\">Start</button>\n                                    </div>\n                                </div>`;
                            }).join('');
                            container.innerHTML = `<div style=\"color:#9ecbff; font-size:12px;\">Confirmed routes</div>${rows}`;
                            container.onclick = (e) => {
                                const btn = e.target.closest('button'); if (!btn) return;
                                const action = btn.getAttribute('data-action');
                                if (action === 'startItin') {
                                    const idx = Number(btn.getAttribute('data-itin-index')||0);
                                    const it = items[idx];
                                    const shipId = Number(it?.shipId);
                                    if (!shipId) return;
                                    client.socket && client.socket.emit('travel:start', { gameId: client.gameId, sectorId: client.gameState?.sector?.id, shipId }, (resp)=>{
                                        if (!resp || !resp.success) { client.addLogEntry(resp?.error || 'Start failed', 'error'); return; }
                                        client.addLogEntry('Travel started', 'success');
                                    });
                                }
                            };
                            // Highlight the selected unit's itinerary on the map for persistence
                            try {
                                if (client.selectedUnit) {
                                    const sel = items.find(it => Number(it.shipId) === Number(client.selectedUnit.id));
                                    if (sel) {
                                        const legs = (sel.legs||[]).map(normalizeLeg).filter(L=>Number.isFinite(L.edgeId));
                                        client.__laneHighlight = { until: Number.MAX_SAFE_INTEGER, legs };
                                        initializeFullMap();
                                    }
                                }
                            } catch {}
                        }
                    }
                }
            })();
        } catch {}
        try {
            const interval = setInterval(()=>{
                if (!document.body.contains(modalContent)) { clearInterval(interval); return; }
                updatePlannerState(modalContent);
            }, 800);
        } catch {}
        setTimeout(() => { try { initializeFullMap(); loadGalaxyDataInternal(); populateSystemFactsInternal(); } catch (e) { console.error('map init error', e); } }, 100);
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

async function populatePoiList(root, tab) {
        const client = window.gameClient; if (!client || !client.gameState?.sector?.id) return;
        const wrap = root.querySelector('#poiList'); if (!wrap) return;
        const facts = await SFApi.State.systemFacts(client.gameState.sector.id);
        const items = [];
        let icon = '📍';
        if (tab === 'planets') {
            icon = '🪐';
            const planets = client.objects.filter(o => (o.celestial_type === 'planet'));
            planets.forEach(p => items.push({ label: p.meta?.name || `Planet ${p.id}`, x: p.x, y: p.y }));
        } else if (tab === 'wormholes') {
            icon = '🌀';
            (facts?.wormholeEndpoints||[]).forEach(w => items.push({ label: (safeName(w.meta?.name) || `Wormhole ${w.id}`), x: w.x, y: w.y }));
        } else if (tab === 'taps') {
            icon = '🛰️';
            const tapsByEdge = facts?.laneTapsByEdge || {}; Object.keys(tapsByEdge).forEach(eid => {
                (tapsByEdge[eid]||[]).forEach((t, i) => items.push({ label: `Tap ${eid}-${i+1}`, x: t.x, y: t.y }));
            });
        } else if (tab === 'belts') {
            icon = '⛓️';
            (facts?.belts||[]).forEach(b => {
                const cx = 2500, cy = 2500; const rMid = Number(b.inner_radius) + Number(b.width)/2; const aMid = (Number(b.arc_start)+Number(b.arc_end))/2; items.push({ label: `Belt ${b.belt_key}-${b.sector_index}`, x: Math.round(cx+Math.cos(aMid)*rMid), y: Math.round(cy+Math.sin(aMid)*rMid) });
            });
        }
        
        wrap.innerHTML = items.length ? `
            <div style="margin-bottom:8px; font-size:12px; color:var(--primary); font-weight:600; text-transform:uppercase; letter-spacing:0.05em;">${tab}</div>
            <div style="display:flex; flex-direction:column; gap:2px;">
                ${items.map((it, idx)=>`<div class="poi-item" data-idx="${idx}">${icon} ${it.label}</div>`).join('')}
            </div>
        ` : '';
        
        wrap.onclick = (e)=>{ 
            const row = e.target.closest('.poi-item'); 
            if (!row) return; 
            wrap.querySelectorAll('.poi-item').forEach(el => el.classList.remove('active'));
            row.classList.add('active');
            const it = items[Number(row.dataset.idx||0)]; 
            const xEl = root.querySelector('#coordX'); 
            const yEl = root.querySelector('#coordY'); 
            if (xEl && yEl) { xEl.value = it.x; yEl.value = it.y; } 
            planToDestination({ x: it.x, y: it.y }); 
        };
}

function showPlannerRoutes(routes) {
        try {
            const client = window.gameClient; const container = document.getElementById('plannerRoutes'); if (!container) return;
            const rawList = Array.isArray(routes) ? routes.slice(0,3) : [];
            // Normalize and drop degenerate (all zero-length) routes
            const list = rawList.filter(r => {
                const legs = Array.isArray(r.legs) ? r.legs.map(normalizeLeg) : [];
                const nonZero = legs.filter(L => Math.abs(Number(L.sEnd||0) - Number(L.sStart||0)) > 1e-3);
                if (!legs.length || !nonZero.length) return false;
                r.legs = legs;
                return true;
            });
            window.__lastPlannedRoutes = list;
            container.innerHTML = '';
            
            if (list.length === 0) {
                container.innerHTML = `<div style="padding:20px; text-align:center; color:var(--muted); font-size:13px; border:1px dashed var(--border); border-radius:10px;">No viable warp routes found for this destination.</div>`;
                return;
            }

            // Destination summary header
            if (client.__plannerTarget) {
                const t = client.__plannerTarget;
                const destHeader = document.createElement('div');
                destHeader.style.cssText = 'font-size:12px; color:var(--primary); font-weight:600; text-transform:uppercase; margin-bottom:4px;';
                destHeader.textContent = `Dest: ${Math.round(t.x)}, ${Math.round(t.y)}`;
                container.appendChild(destHeader);
            }

            list.forEach((r, idx) => {
                const rho = Number(r.rho || 0); 
                const color = rho <= 1.0 ? '#66bb6a' : (rho <= 1.5 ? '#ffca28' : '#ef5350');
                const riskColor = r.risk > 3 ? '#ef5350' : (r.risk > 1 ? '#ffca28' : '#66bb6a');
                
                const card = document.createElement('div');
                card.className = 'route-card';
                card.style.borderColor = `${color}40`;
                
                const legs = r.legs;
                const legsText = legs.map((L)=>`E${L.edgeId} ${L.entry==='tap'?'tap':'wild'}`).join(' → ');
                
                card.innerHTML = `
                    <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px;">
                        <div>
                            <div style="font-weight:600; font-size:14px; color:${color}">Option ${idx + 1}</div>
                            <div style="font-size:11px; color:var(--muted);">${legsText}</div>
                        </div>
                        <div style="text-align:right;">
                            <div style="font-size:14px; font-weight:bold; color:var(--text);">ETA ${r.eta}</div>
                            <div style="font-size:10px; color:${riskColor};">Risk: ${'!'.repeat(Math.max(1, r.risk || 1))}</div>
                        </div>
                    </div>
                    <div style="display:flex; gap:8px; align-items:center; margin-bottom:10px;">
                        <span style="font-size:10px; padding:2px 6px; border-radius:4px; background:${color}20; color:${color}; border:1px solid ${color}40;">ρ ${rho.toFixed(2)}</span>
                        <span style="font-size:10px; padding:2px 6px; border-radius:4px; background:rgba(255,255,255,0.05); color:var(--muted); border:1px solid var(--border);">${legs.length} Leg${legs.length!==1?'s':''}</span>
                    </div>
                    <button class="sf-btn sf-btn-primary small" data-route-index="${idx}" data-action="start" style="width:100%; justify-content:center; padding:8px;">Execute Warp</button>
                `;
                
                // Mouse interactive preview
                card.onmouseenter = () => { 
                    card.style.boxShadow = `0 4px 12px ${color}20`;
                    try { 
                        client.__laneHighlight = { until: Date.now() + 30000, legs: r.legs };
                        const canvas = document.getElementById('fullMapCanvas');
                        if (canvas) {
                            const ctx = canvas.getContext('2d');
                            const scaleX = canvas.width / 5000, scaleY = canvas.height / 5000;
                            const toggles = {
                                regions: document.getElementById('toggleRegions')?.checked !== false,
                                belts: document.getElementById('toggleBelts')?.checked !== false,
                                wormholes: document.getElementById('toggleWormholes')?.checked !== false,
                                lanes: document.getElementById('toggleLanes')?.checked === true
                            };
                            renderFullMap(ctx, canvas, scaleX, scaleY, toggles, null);
                        }
                    } catch {}
                };
                card.onmouseleave = () => { 
                    card.style.boxShadow = 'none';
                    // We don't clear it immediately to allow seeing it, but renderFullMap will eventually clear it if not active
                };
                
                container.appendChild(card);
            });
            
            container.onclick = (e) => {
                const btn = e.target.closest('button'); if (!btn) return;
                const idx = Number(btn.getAttribute('data-route-index')||0); const r = list[idx];
                const action = btn.getAttribute('data-action');
                if (action === 'start') {
                    const shipId = client.selectedUnit?.id;
                    if (!shipId) { client.addLogEntry('Select a unit first', 'error'); return; }
                    const legs = r.legs;
                    const dest = client.__plannerTarget || null;
                    client.socket && client.socket.emit('travel:confirm', { gameId: client.gameId, sectorId: client.gameState.sector.id, shipId, legs, destX: (dest&&typeof dest.x==='number')?dest.x:undefined, destY: (dest&&typeof dest.y==='number')?dest.y:undefined }, (resp)=>{
                        if (!resp || !resp.success) { client.addLogEntry(resp?.error || 'Confirm failed', 'error'); return; }
                        client.__laneHighlight = { until: Number.MAX_SAFE_INTEGER, legs };
                        client.socket && client.socket.emit('travel:start', { gameId: client.gameId, sectorId: client.gameState.sector?.id, shipId }, (resp2)=>{
                            if (!resp2 || !resp2.success) { client.addLogEntry(resp2?.error || 'Start failed', 'error'); return; }
                            if (resp2.approachRequired && resp2.approachTarget) {
                                client.addLogEntry('Approach plotted; lane start queued', 'info');
                            } else {
                                client.addLogEntry('Travel started', 'success');
                            }
                            initializeFullMap();
                        });
                    });
                }
            };
        } catch (e) { console.error('showPlannerRoutes error', e); }
}

function planToDestination(dest) {
        try {
            const client = window.gameClient; if (!client || !client.gameState?.sector?.id) return;
            const x = Number(dest?.x), y = Number(dest?.y); if (!Number.isFinite(x) || !Number.isFinite(y)) return;
            try { client.__plannerTarget = { x, y }; } catch {}
            const panel = document.getElementById('plannerRoutes'); if (panel) panel.innerHTML = '<div style="color:#9ecbff;">Planning route...</div>';
            client.socket && client.socket.emit('travel:plan', { gameId: client.gameId, sectorId: client.gameState.sector.id, from: { x: client.selectedUnit?.x, y: client.selectedUnit?.y }, to: { x, y } }, (resp)=>{
                if (resp?.success && Array.isArray(resp.routes)) showPlannerRoutes(resp.routes);
                else { const panel = document.getElementById('plannerRoutes'); if (panel) panel.innerHTML = '<div style="color:#ff8a80;">No route found</div>'; }
            });
        } catch (e) { try { console.error('planToDestination error', e); } catch {} }
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

function observeCanvas(canvas) {
    if (canvas.__ro) return;
    const ro = new ResizeObserver(() => {
        const rect = canvas.getBoundingClientRect();
        const w = Math.max(200, Math.floor(rect.width));
        const h = Math.max(200, Math.floor(rect.height));
        if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            const scaleX = canvas.width / 5000, scaleY = canvas.height / 5000;
            // Read toggles again for resize
            const toggles = {
                regions: document.getElementById('toggleRegions')?.checked !== false,
                belts: document.getElementById('toggleBelts')?.checked !== false,
                wormholes: document.getElementById('toggleWormholes')?.checked !== false,
                lanes: (function(){ try { const pref = localStorage.getItem('ui.showLanes'); const el = document.getElementById('toggleLanes'); if (el && pref!=null) el.checked = (pref==='1'); return el?.checked === true; } catch { return document.getElementById('toggleLanes')?.checked === true; } })()
            };
            renderFullMap(ctx, canvas, scaleX, scaleY, toggles, null);
        }
    });
    ro.observe(canvas.parentElement || canvas);
    canvas.__ro = ro;
}

function initializeFullMap() {
        const client = window.gameClient; const canvas = document.getElementById('fullMapCanvas');
        if (!client || !canvas) return;

        // Initial size
        const rect = canvas.getBoundingClientRect();
        canvas.width  = Math.max(200, Math.floor(rect.width));
        canvas.height = Math.max(200, Math.floor(rect.height));

        observeCanvas(canvas);
        const ctx = canvas.getContext('2d'); ctx.fillStyle = '#0a0a1a'; ctx.fillRect(0,0,canvas.width,canvas.height);
        ctx.strokeStyle = 'rgba(100,181,246,0.3)'; ctx.lineWidth = 2; ctx.strokeRect(2,2,canvas.width-4,canvas.height-4);
        if (!client.objects) return;
        const scaleX = canvas.width / 5000, scaleY = canvas.height / 5000;
        const toggles = {
            regions: document.getElementById('toggleRegions')?.checked !== false,
            belts: document.getElementById('toggleBelts')?.checked !== false,
            wormholes: document.getElementById('toggleWormholes')?.checked !== false,
            lanes: (function(){ try { const pref = localStorage.getItem('ui.showLanes'); const el = document.getElementById('toggleLanes'); if (el && pref!=null) el.checked = (pref==='1'); return el?.checked === true; } catch { return document.getElementById('toggleLanes')?.checked === true; } })()
        };
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
        (async ()=>{ try { const sid = client.gameState?.sector?.id; if (sid) { const now=Date.now(); if (!client.__factsCache||client.__factsCache.until<=now){ const facts=await SFApi.State.systemFacts(sid); client.__factsCache={facts,until:now+5000}; } buildLaneCache(canvas, client.__factsCache.facts); } } catch {} renderFullMap(ctx, canvas, scaleX, scaleY, toggles, null); })();
        canvas.onmousemove = (ev)=>{
            const r = canvas.getBoundingClientRect();
            const wx = (ev.clientX - r.left) / scaleX, wy = (ev.clientY - r.top) / scaleY;
            const pxScale = (scaleX + scaleY) / 2;
            const cache = canvas.__laneCache || { edges: [], taps: [] };
            let tipText = '';
            for (const t of cache.taps) { const dpx = Math.hypot(wx - t.x, wy - t.y) * pxScale; if (dpx < 12) { tipText = `Tap queue: ${t.queued} CU`; break; } }
            if (!tipText) {
                let best = { dpx: Infinity, edge: null };
                const projectToSegment = (p,a,b)=>{ const apx=p.x-a.x, apy=p.y-a.y; const abx=b.x-a.x, aby=b.y-a.y; const ab2=Math.max(1e-6,abx*abx+aby*aby); const t=Math.max(0, Math.min(1, (apx*abx+apy*aby)/ab2)); return { x:a.x+abx*t, y:a.y+aby*t, t }; };
                for (const e of cache.edges) { const pts=e.pts; if (pts.length<2) continue; for (let i=1;i<pts.length;i++){ const pr=projectToSegment({x:wx,y:wy}, pts[i-1], pts[i]); const dpx=Math.hypot(wx-pr.x, wy-pr.y)*pxScale; if (dpx<best.dpx) best={dpx, edge:e}; } }
                if (best.edge && best.dpx < 14) tipText = `ρ ${best.edge.rho.toFixed(2)}  • cap ${best.edge.cap}  • headway ${best.edge.headway}`;
            }
            // Region hover label near centroid when no lane/tap tip
            if (!tipText) {
                try {
                    const factsCache = client.__factsCache;
                    const facts = (factsCache && factsCache.until > Date.now()) ? factsCache.facts : factsCache?.facts;
                    const regions = Array.isArray(facts?.regions) ? facts.regions : [];
                    if (regions.length) {
                        const cellW = 5000/3, cellH = 5000/3;
                        let nearest = { dpx: Infinity, id: null, health: 0 };
                        regions.forEach(rg => {
                            let cx=0, cy=0, n=0; (rg.cells||[]).forEach(c=>{ cx += (c.col*cellW + cellW/2); cy += (c.row*cellH + cellH/2); n++; });
                            if (n>0) {
                                cx/=n; cy/=n;
                                const dpx = Math.hypot(wx - cx, wy - cy) * pxScale;
                                if (dpx < nearest.dpx) nearest = { dpx, id: String(rg.id||'').toUpperCase(), health: Number(rg.health||0) };
                            }
                        });
                        if (nearest.id && nearest.dpx < 40) tipText = `Region ${nearest.id} (${nearest.health}%)`;
                    }
                } catch {}
            }
            if (tipText) { tip.style.display='block'; tip.textContent = tipText; tip.style.left = `${ev.clientX + 12}px`; tip.style.top = `${ev.clientY - 10}px`; }
            else tip.style.display='none';
        };
        canvas.onmouseleave = ()=>{ if (canvas.__tipEl) canvas.__tipEl.style.display='none'; };
        renderFullMap(ctx, canvas, scaleX, scaleY, toggles, null);
        ['toggleRegions','toggleBelts','toggleWormholes','toggleLanes'].forEach(id => {
            const el = document.getElementById(id); if (!el) return;
            el.onchange = () => { if (id==='toggleLanes') { try { localStorage.setItem('ui.showLanes', el.checked ? '1' : '0'); } catch {} } initializeFullMap(); };
        });
}

async function initializeGalaxyMap() {
        const client = window.gameClient; const canvas = document.getElementById('galaxyCanvas'); if (!client || !canvas) return;
        // Set initial size based on container
        const rect = canvas.getBoundingClientRect();
        canvas.width = Math.max(200, Math.floor(rect.width));
        canvas.height = Math.max(200, Math.floor(rect.height));
        const ctx = canvas.getContext('2d');
        try {
            const graph = await SFApi.State.galaxyGraph(client.gameId); if (!graph || !Array.isArray(graph.systems)) return;
            const systems = graph.systems; const gates = graph.gates || [];
            ctx.clearRect(0,0,canvas.width,canvas.height); ctx.fillStyle = '#0b0f1a'; ctx.fillRect(0,0,canvas.width,canvas.height);
            ctx.strokeStyle = 'rgba(100,181,246,0.35)'; ctx.lineWidth = 1.25;
            gates.forEach(e => {
                const s = systems.find(x=>x.id===e.source), t = systems.find(x=>x.id===e.target); if (!s||!t) return;
                ctx.beginPath(); ctx.moveTo((s.id%1000)/1000*canvas.width, (s.id%997)/997*canvas.height);
                ctx.lineTo((t.id%1000)/1000*canvas.width, (t.id%997)/997*canvas.height); ctx.stroke();
            });
            systems.forEach(n => {
                const x = (n.id%1000)/1000*canvas.width, y = (n.id%997)/997*canvas.height; ctx.fillStyle = '#9ecbff'; ctx.beginPath(); ctx.arc(x,y,6,0,Math.PI*2); ctx.fill(); ctx.fillStyle='#e3f2fd'; ctx.font='11px Arial'; ctx.textAlign='center'; ctx.fillText(n.name || String(n.id), x, y-10);
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
            // Subtle grid pattern
            bctx.strokeStyle = 'rgba(100,181,246,0.06)'; bctx.lineWidth = 1;
            const gridSize = 50; for (let x=0; x<bg.width; x+=gridSize){ bctx.beginPath(); bctx.moveTo(x,0); bctx.lineTo(x,bg.height); bctx.stroke(); }
            for (let y=0; y<bg.height; y+=gridSize){ bctx.beginPath(); bctx.moveTo(0,y); bctx.lineTo(bg.width,y); bctx.stroke(); }
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
        // Regions overlay
        if (toggles.regions && client.gameState?.sector?.id) {
            try {
                if (facts && Array.isArray(facts.regions) && facts.regions.length > 0) {
                    const cellW = 5000 / 3, cellH = 5000 / 3;
                    facts.regions.forEach(r => {
                        let baseColor = '100, 149, 237'; // A default (cornflower blue)
                        const id = String(r.id || '').toUpperCase();
                        if (id === 'A') baseColor = '80, 130, 255';
                        else if (id === 'B') baseColor = '255, 99, 99';
                        else if (id === 'C') baseColor = '255, 200, 80';
                        
                        // Check if mouse is in this region for hover highlight
                        let isHovered = false;
                        if (mouse && typeof mouse.x === 'number') {
                            const col = Math.floor(mouse.x / cellW), row = Math.floor(mouse.y / cellH);
                            isHovered = (r.cells || []).some(c => c.col === col && c.row === row);
                        }

                        ctx.fillStyle = `rgba(${baseColor}, ${isHovered ? '0.15' : '0.08'})`;
                        (r.cells || []).forEach(c => {
                            ctx.fillRect(c.col*cellW*scaleX, c.row*cellH*scaleY, cellW*scaleX, cellH*scaleY);
                            // Draw subtle inner border
                            ctx.strokeStyle = `rgba(${baseColor}, ${isHovered ? '0.4' : '0.2'})`;
                            ctx.lineWidth = 1;
                            ctx.strokeRect(c.col*cellW*scaleX + 2, c.row*cellH*scaleY + 2, cellW*scaleX - 4, cellH*scaleY - 4);
                        });

                        // Region Label
                        const first = (r.cells||[])[0];
                        if (first) {
                            const health = Number(r.health || 50);
                            const cx = (first.col*cellW + 20)*scaleX, cy = (first.row*cellH + 20)*scaleY;
                            ctx.fillStyle = `rgba(${baseColor}, 0.9)`;
                            ctx.font = 'bold 13px Arial';
                            ctx.textAlign='left'; ctx.textBaseline='top';
                            ctx.fillText(`REGION ${r.id}`, cx, cy);
                            ctx.font = '11px Arial';
                            ctx.fillStyle = `rgba(${baseColor}, 0.7)`;
                            ctx.fillText(`Health: ${health}%`, cx, cy + 16);
                        }
                    });
                }
            } catch {}
        }
        // Belts (from belt_sectors facts)
        if (toggles.belts && client.gameState?.sector?.id) {
            try {
                const sectors = facts?.belts || [];
                const cx = 2500*scaleX, cy = 2500*scaleY;
                sectors.forEach(s => {
                    const rInner = Number(s.inner_radius), rOuter = Number(s.inner_radius) + Number(s.width);
                    const a0 = Number(s.arc_start), a1 = Number(s.arc_end);
                    const rMid = (rInner + rOuter) / 2;
                    const aMid = (a0 + a1) / 2;
                    // Build thin wedge polygon
                    const p0x = cx + Math.cos(a0)*rInner*scaleX, p0y = cy + Math.sin(a0)*rInner*scaleY;
                    const p1x = cx + Math.cos(a1)*rInner*scaleX, p1y = cy + Math.sin(a1)*rInner*scaleY;
                    const p2x = cx + Math.cos(a1)*rOuter*scaleX, p2y = cy + Math.sin(a1)*rOuter*scaleY;
                    const p3x = cx + Math.cos(a0)*rOuter*scaleX, p3y = cy + Math.sin(a0)*rOuter*scaleY;
                    // Fill and stroke
                    ctx.beginPath();
                    ctx.moveTo(p0x, p0y);
                    ctx.lineTo(p1x, p1y);
                    ctx.lineTo(p2x, p2y);
                    ctx.lineTo(p3x, p3y);
                    ctx.closePath();
                    ctx.fillStyle = 'rgba(158,203,255,0.08)';
                    ctx.fill();
                    ctx.strokeStyle = 'rgba(158,203,255,0.35)';
                    ctx.lineWidth = 1;
                    ctx.stroke();

                    // Centroid label
                    const lx = cx + Math.cos(aMid)*rMid*scaleX;
                    const ly = cy + Math.sin(aMid)*rMid*scaleY;
                    ctx.fillStyle = 'rgba(200,230,255,0.9)'; ctx.font='10px Arial'; ctx.textAlign='center'; ctx.textBaseline='top';
                    ctx.fillText(`Belt ${s.belt_key}-${s.sector_index}`, lx, ly + 2);

                    // Hover details near centroid
                    if (mouse && typeof mouse.x === 'number' && typeof mouse.y === 'number') {
                        const dx = mouse.x - lx; const dy = mouse.y - ly; const d = Math.sqrt(dx*dx + dy*dy);
                        if (d <= 10) {
                            const tip = `Region ${s.region_id} • ${String(s.density || 'med').toUpperCase()}`;
                            const tw = ctx.measureText(tip).width + 8; const th = 14;
                            const tx = lx + 12; const ty = ly - 4;
                            ctx.fillStyle = 'rgba(15,25,45,0.9)'; ctx.fillRect(tx, ty, tw, th);
                            ctx.strokeStyle = 'rgba(158,203,255,0.6)'; ctx.strokeRect(tx, ty, tw, th);
                            ctx.fillStyle = '#cfe8ff'; ctx.font='10px Arial'; ctx.textAlign='left'; ctx.textBaseline='top';
                            ctx.fillText(tip, tx + 4, ty + 2);
                        }
                    }
                });
            } catch {}
        }
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
                // Planner click: show list of up to 3 routes with tap queue ETA and wildcat option
                canvas.onclick = async (ev) => {
                    const rect = canvas.getBoundingClientRect();
                    const click = { x: (ev.clientX-rect.left)/scaleX, y: (ev.clientY-rect.top)/scaleY };
                    
                    // Visual feedback for click
                    client.__mapClickMarker = { x: click.x, y: click.y, time: Date.now() };
                    
                    try {
                        client.__plannerTarget = click;
                        const routes = await new Promise((resolve)=>{
                            SFApi.Socket.emit('travel:plan', { gameId: client.gameId, sectorId: client.gameState.sector.id, from: { x: client.selectedUnit?.x, y: client.selectedUnit?.y }, to: click }, (resp)=>resolve(resp));
                        });
                        if (routes?.success && Array.isArray(routes.routes)) {
                            showPlannerRoutes(routes.routes);
                        }
                    } catch {}
                    initializeFullMap(); // Redraw to show the click marker
                };
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
                    // Compute rho for coloring
                    const health = healthByRegion.get(String(l.region_id)) ?? 50;
                    const healthMult = health>=80?1.25:(health>=60?1.0:0.7);
                    const cap = Math.max(1, Math.floor(Number(l.cap_base||0) * (Number(l.width_core||150)/150) * healthMult));
                    const load = Number(l.runtime?.load_cu || 0);
                    const rho = load / Math.max(1, cap);
                    
                    // Enhanced Congestion Coloring
                    let coreColor = 'rgba(102,187,106,0.95)'; // Healthy Green
                    if (rho > 2.0) coreColor = 'rgba(211,47,47,0.95)'; // Critical Red
                    else if (rho > 1.5) coreColor = 'rgba(239,83,80,0.95)'; // Heavy Orange-Red
                    else if (rho > 1.0) coreColor = 'rgba(255,202,40,0.95)'; // Warning Yellow
                    
                    if (health < 40) coreColor = 'rgba(120,120,120,0.8)'; // Damaged/Grey

                    // Shoulder halo (wider for healthy lanes)
                    ctx.strokeStyle = health >= 80 ? 'rgba(100,255,246,0.15)' : 'rgba(100,181,246,0.1)';
                    ctx.lineWidth = Math.max(1, (l.width_shoulder || 220) * 0.5 * ((scaleX+scaleY)/2));
                    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
                    
                    // Unhealthy lanes get a dashed shoulder
                    if (health < 60) ctx.setLineDash([10, 10]);
                    
                    ctx.beginPath();
                    ctx.moveTo(pts[0].x*scaleX, pts[0].y*scaleY);
                    for (let i=1;i<pts.length;i++) ctx.lineTo(pts[i].x*scaleX, pts[i].y*scaleY);
                    ctx.stroke();
                    ctx.setLineDash([]);

                    // Core ribbon
                    ctx.strokeStyle = coreColor;
                    ctx.lineWidth = Math.max(2, (l.width_core || 180) * 0.35 * ((scaleX+scaleY)/2));
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
                    taps.forEach(t => {
                        const x = t.x*scaleX, y = t.y*scaleY;
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
                            ctx.save(); ctx.font='12px Arial'; const tip = `Tap queue: ${q} CU`;
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
            // Trigger another frame if ripple is active
            requestAnimationFrame(() => initializeFullMap());
        }

        // Base objects with labels
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
                drawSmartLabel(ctx, x, y, name, 18, 12);
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
                drawSmartLabel(ctx, x, y, name, 18, 11);
            } else if (obj.type === 'resource_node') {
                ctx.fillStyle = '#ffd54f';
                ctx.shadowBlur = 4;
                ctx.shadowColor = '#ffd54f';
                ctx.fillRect(x-2,y-2,4,4);
                ctx.shadowBlur = 0;
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
            const currentSystem = { name: client.gameState?.sector?.name || 'Current System', id: client.gameId, players: 1, status: 'Active', turn: client.gameState?.turn?.number || 1, celestialObjects: client.objects ? client.objects.filter(o=>client.isCelestialObject(o)).length : 0 };
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
