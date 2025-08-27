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
            const fmt = (name, mult) => `${name} ${mult}${counts.has(name) ? ` — ×${counts.get(name)}` : ''}`;
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
                    <div>🌌 ${currentSystem.celestialObjects} Celestial Objects</div>
                    <div>📊 Status: <span style="color: #4CAF50;">${currentSystem.status}</span></div>
                </div>
            </div>
            <div class="galaxy-system-card" style="opacity: 0.5; cursor: not-allowed;">
                <div class="galaxy-system-name">Distant Systems</div>
                <div class="galaxy-system-info">
                    <div style="color: #888;">🚧 Coming Soon</div>
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
                <button class="map-tab active sf-btn sf-btn-secondary" data-tab="solar-system">🌌 Solar System</button>
                <button class="map-tab sf-btn sf-btn-secondary" data-tab="galaxy">🌌 Galaxy</button>
            </div>
            <div id="solar-system-tab" class="map-tab-content">
                <div class="map-row">
                    <div class="map-left">
                        <div style="flex:0 0 auto;">
                            <h3 style="color: #64b5f6; margin: 0 0 4px 0; font-size:1.1em;">🌌 ${client.gameState?.sector?.name || 'Current Solar System'}</h3>
                            <p style="color: #ccc; margin: 0; font-size: 0.85em;">Strategic sector overview</p>
                        </div>
                        <div style="flex:0 0 auto; margin: 0 0 4px 2px; color:#9ecbff; font-size:12px; display:flex; gap:12px; align-items:center; flex-wrap:wrap;">
                            <label style="display:flex; align-items:center; gap:6px; cursor:pointer;">
                                <input type="checkbox" id="toggleRegions" checked>
                                <span>Show Regions/Health</span>
                            </label>
                            <label style="display:flex; align-items:center; gap:6px; cursor:pointer;">
                                <input type="checkbox" id="toggleBelts" checked>
                                <span>Show Belts</span>
                            </label>
                            <label style="display:flex; align-items:center; gap:6px; cursor:pointer;">
                                <input type="checkbox" id="toggleWormholes" checked>
                                <span>Show Wormholes</span>
                            </label>
                            <label style="display:flex; align-items:center; gap:6px; cursor:pointer;">
                                <input type="checkbox" id="toggleLanes">
                                <span>Show Warp Lanes</span>
                            </label>
                        </div>
                        <div id="miniLegend" style="flex:0 0 auto; margin: 0 2px 6px 2px; background:rgba(100,181,246,0.08); border-radius:6px; padding:6px; display:flex; gap:10px; align-items:center; color:#9ecbff; font-size:11px;">
                            <div style="display:flex; align-items:center; gap:4px;"><span style="width:8px; height:8px; border-radius:50%; background:#4CAF50; display:inline-block;"></span><span>Yours</span></div>
                            <div style="display:flex; align-items:center; gap:4px;"><span style="width:8px; height:8px; border-radius:50%; background:#FF9800; display:inline-block;"></span><span>Others</span></div>
                        </div>
                        <div class="map-canvas-wrap">
                            <canvas id="fullMapCanvas" class="full-map-canvas"></canvas>
                        </div>
                    </div>
                    <div class="map-rail">
                        <div id="plannerPanel" class="section">
                            <h4 style="margin:0; color:#9ecbff;">Warp Planner</h4>
                            <div id="plannerHelp" style="font-size:12px; color:#9ecbff;">Click on the map or pick a POI to plan a route.</div>
                            <div style="display:flex; gap:6px; align-items:center; margin-bottom:8px;">
                                <input id="coordX" type="number" placeholder="X" style="width:60px; background:#0b1220; color:#cfe8ff; border:1px solid rgba(100,181,246,0.35); border-radius:4px; padding:2px 6px;"/>
                                <input id="coordY" type="number" placeholder="Y" style="width:60px; background:#0b1220; color:#cfe8ff; border:1px solid rgba(100,181,246,0.35); border-radius:4px; padding:2px 6px;"/>
                                <button class="sf-btn sf-btn-primary small" id="btnPlanCoords">Plan</button>
                            </div>
                            <div id="poiSelector" style="display:flex; flex-direction:column; gap:6px;">
                                <div style="display:flex; gap:6px;">
                                    <button class="sf-btn sf-btn-secondary small" data-poi-tab="planets">Planets</button>
                                    <button class="sf-btn sf-btn-secondary small" data-poi-tab="wormholes">Wormholes</button>
                                    <button class="sf-btn sf-btn-secondary small" data-poi-tab="taps">Taps</button>
                                    <button class="sf-btn sf-btn-secondary small" data-poi-tab="belts">Belts</button>
                                </div>
                                <div id="poiList" style="max-height:200px; overflow:auto; border:1px solid rgba(100,181,246,0.15); border-radius:6px; padding:4px;"></div>
                            </div>
                            <div id="plannerRoutes" style="display:flex; flex-direction:column; gap:8px;"></div>
                        </div>
                        <div id="systemFacts" class="section scroll">
                            <h4 style="margin:0 0 8px 0; color:#9ecbff; font-size:0.9em;">System Facts</h4>
                            <div id="sysMetaSummary" style="font-size:13px; line-height:1.6;">Loading...</div>
                        </div>
                    </div>
                </div>
            </div>
            <div id="galaxy-tab" class="map-tab-content hidden">
                <div class="map-row">
                    <div class="map-left">
                        <div style="margin-bottom: 10px;">
                            <h3 style="color: #64b5f6; margin: 0 0 10px 0;">🌌 Galaxy Overview</h3>
                            <p style="color: #ccc; margin: 0; font-size: 0.9em;">All known solar systems in the galaxy</p>
                        </div>
                        <div class="map-canvas-wrap">
                            <canvas id="galaxyCanvas" class="full-map-canvas"></canvas>
                        </div>
                        <div id="galaxyLegend" style="margin-top: 8px; font-size: 0.85em; color: #9ecbff;">● Size/brightness highlights strategic hubs (choke points). Lines show warp-gate connectivity.</div>
                    </div>
                    <div class="map-rail">
                        <div id="galaxySystemsList" class="section scroll" style="flex:1;">
                            <!-- Galaxy systems list will be populated here -->
                        </div>
                    </div>
                </div>
            </div>`;
        window.UI.showModal({ title:'🗺️ Strategic Map', content: modalContent, actions:[{ text:'Close', style:'secondary', action:()=>true }], className:'map-modal', width:1280, height:940 });
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
        // Ensure planner availability based on selection
        try { updatePlannerState(modalContent); } catch {}
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
        if (tab === 'planets') {
            const planets = client.objects.filter(o => (o.celestial_type === 'planet'));
            planets.forEach(p => items.push({ label: p.meta?.name || `Planet ${p.id}`, x: p.x, y: p.y }));
        } else if (tab === 'wormholes') {
            (facts?.wormholeEndpoints||[]).forEach(w => items.push({ label: (safeName(w.meta?.name) || `Wormhole ${w.id}`), x: w.x, y: w.y }));
        } else if (tab === 'taps') {
            const tapsByEdge = facts?.laneTapsByEdge || {}; Object.keys(tapsByEdge).forEach(eid => {
                (tapsByEdge[eid]||[]).forEach((t, i) => items.push({ label: `Tap ${eid}-${i+1}`, x: t.x, y: t.y }));
            });
        } else if (tab === 'belts') {
            (facts?.belts||[]).forEach(b => {
                const cx = 2500, cy = 2500; const rMid = Number(b.inner_radius) + Number(b.width)/2; const aMid = (Number(b.arc_start)+Number(b.arc_end))/2; items.push({ label: `Belt ${b.belt_key}-${b.sector_index}`, x: Math.round(cx+Math.cos(aMid)*rMid), y: Math.round(cy+Math.sin(aMid)*rMid) });
            });
        }
        wrap.innerHTML = items.map((it, idx)=>`<div class="poi-item" data-idx="${idx}" style="padding:4px 6px; cursor:pointer; border-radius:4px;">${it.label}</div>`).join('');
        wrap.querySelectorAll('.poi-item').forEach(el => el.onmouseenter = ()=>{ el.style.background = 'rgba(100,181,246,0.08)'; });
        wrap.querySelectorAll('.poi-item').forEach(el => el.onmouseleave = ()=>{ el.style.background = 'transparent'; });
        wrap.onclick = (e)=>{ const row = e.target.closest('.poi-item'); if (!row) return; const it = items[Number(row.dataset.idx||0)]; const xEl = root.querySelector('#coordX'); const yEl = root.querySelector('#coordY'); if (xEl && yEl) { xEl.value = it.x; yEl.value = it.y; } planToDestination({ x: it.x, y: it.y }); };
}

function showPlannerRoutes(routes) {
        try {
            const client = window.gameClient; const container = document.getElementById('plannerRoutes'); if (!container) return;
            const rawList = Array.isArray(routes) ? routes.slice(0,3) : [];
            // Normalize and drop degenerate (all zero-length) routes
            const list = rawList.filter(r => {
                const legs = Array.isArray(r.legs) ? r.legs.map(normalizeLeg) : [];
                const nonZero = legs.filter(L => Math.abs(Number(L.sEnd||0) - Number(L.sStart||0)) > 1e-3);
                if (!legs.length || !nonZero.length) { debug('[client] Skipping degenerate route', { route:r, legs }); return false; }
                // replace with normalized legs for downstream use
                r.legs = legs;
                return true;
            });
            window.__lastPlannedRoutes = list;
            debug('[client] showPlannerRoutes received routes:', list.map(r => ({ legsCount: Array.isArray(r.legs)?r.legs.length:'not-array', hasEdgeId: !!r.edgeId, keys:Object.keys(r||{}) })));
            container.innerHTML = '';
            list.forEach((r, idx) => {
                const rho = Number(r.rho || 0); const color = rho<=1?'#66bb6a':(rho<=1.5?'#ffca28':'#ef5350');
                const row = document.createElement('div'); row.style.display='grid'; row.style.gridTemplateColumns='1fr auto'; row.style.gap='6px'; row.style.alignItems='center'; row.style.border='1px solid rgba(100,181,246,0.25)'; row.style.padding='6px'; row.style.borderRadius='6px';
                const legs = Array.isArray(r.legs) ? r.legs : null;
                if (!legs) { console.error(`[client] Route ${idx} missing legs array`, r); return; }
                const legsText = legs.map((L)=>`E${L.edgeId} ${L.entry==='tap'?'tap':'wild'} [${Math.round(L.sStart)}→${Math.round(L.sEnd)}]`).join(' → ');
                row.innerHTML = `<div><div style=\"font-size:12px; color:${color}\">● ρ ${rho.toFixed(2)} • ETA ${r.eta} • Risk ${'★'.repeat(r.risk||2)}</div><div style=\"font-size:11px; color:#9ecbff;\">${legsText}</div></div>
                    <div style=\"display:flex; gap:6px;\">
                        <button class=\"sf-btn sf-btn-primary\" data-route-index=\"${idx}\" data-action=\"confirm\">Confirm</button>
                    </div>`;
                container.appendChild(row);
            });
            container.onclick = (e) => {
                const btn = e.target.closest('button'); if (!btn) return;
                const idx = Number(btn.getAttribute('data-route-index')||0) || 0; const r = list[idx];
                const action = btn.getAttribute('data-action');
                if (action === 'confirm') {
                    confirmRoute(client, r);
                }
            };
        } catch {}
}

function planToDestination(dest) {
        try {
            const client = window.gameClient; if (!client || !client.gameState?.sector?.id) return;
            const x = Number(dest?.x), y = Number(dest?.y); if (!Number.isFinite(x) || !Number.isFinite(y)) return;
            const panel = document.getElementById('plannerRoutes'); if (panel) panel.innerHTML = '<div style="color:#9ecbff;">Planning route...</div>';
            client.socket && client.socket.emit('travel:plan', { gameId: client.gameId, sectorId: client.gameState.sector.id, from: { x: client.selectedUnit?.x, y: client.selectedUnit?.y }, to: { x, y } }, (resp)=>{
                if (resp?.success && Array.isArray(resp.routes)) showPlannerRoutes(resp.routes);
                else { const panel = document.getElementById('plannerRoutes'); if (panel) panel.innerHTML = '<div style="color:#ff8a80;">No route found</div>'; }
            });
        } catch (e) { try { console.error('planToDestination error', e); } catch {} }
}

function safeName(n){ try { if (!n) return null; return String(n); } catch { return null; } }

// Normalize leg objects from various server payload shapes (camelCase or snake_case)
function normalizeLeg(L) {
        try {
            const edgeId = Number(L?.edgeId ?? L?.edge_id);
            const entryRaw = (L?.entry ?? L?.entry_type ?? 'wildcat');
            const sStart = Number(L?.sStart ?? L?.s_start ?? 0);
            const sEnd = Number(L?.sEnd ?? L?.s_end ?? sStart);
            const mergeTurns = (L?.mergeTurns ?? L?.merge_turns);
            const tapId = (L?.tapId ?? L?.tap_id ?? L?.nearestTapId ?? L?.nearest_tap_id);
            return {
                edgeId,
                entry: (String(entryRaw) === 'tap') ? 'tap' : 'wildcat',
                sStart: Number.isFinite(sStart) ? sStart : 0,
                sEnd: Number.isFinite(sEnd) ? sEnd : (Number.isFinite(sStart)?sStart:0),
                mergeTurns: (mergeTurns != null ? Number(mergeTurns) : undefined),
                tapId: (tapId != null ? Number(tapId) : undefined)
            };
        } catch { return { edgeId: NaN, entry: 'wildcat', sStart: 0, sEnd: 0 }; }
}

// Shared confirm with strict validation, normalization and logging
function confirmRoute(client, route) {
        try {
            if (!client?.selectedUnit?.id) { client.addLogEntry('Select a ship first to confirm a route', 'warning'); return; }
            // Extract raw legs
            let rawLegs = [];
            if (Array.isArray(route?.legs) && route.legs.length > 0) rawLegs = route.legs;
            else if (route && (route.edgeId != null)) {
                if (window.__DEV_WARP_FALLBACK) {
                    console.warn('[client] DEV fallback: route missing legs; synthesizing one from route keys');
                    rawLegs = [{ edgeId: route.edgeId ?? route.edge_id, entry: route.entry, sStart: route.sStart ?? route.s_start ?? 0, sEnd: route.sEnd ?? route.s_end ?? route.sStart ?? route.s_start ?? 0, tapId: route.tapId ?? route.tap_id ?? route.nearestTapId ?? route.nearest_tap_id, mergeTurns: route.mergeTurns ?? route.merge_turns }];
                } else {
                    console.error('[client] Route missing legs array; aborting confirm. Route keys:', Object.keys(route||{}));
                    client.addLogEntry('Route data missing legs; cannot confirm', 'error');
                    return;
                }
            } else {
                console.error('[client] Route has no legs/edgeId; aborting.', route);
                client.addLogEntry('Route data corrupted; cannot confirm', 'error');
                return;
            }

            const legs = rawLegs.map(normalizeLeg).filter(L => Number.isFinite(L.edgeId));
            const nonZero = legs.filter(L => Math.abs(Number(L.sEnd||0) - Number(L.sStart||0)) > 1e-3);
            if (!nonZero.length) {
                console.error('[client] All legs are zero-length after normalization; aborting.', legs);
                client.addLogEntry('Route is empty; cannot confirm', 'error');
                return;
            }
            console.log(`[client] Confirming route with ${legs.length} legs`, legs);
            // Pre-confirm highlight
            try { client.__laneHighlight = { until: Date.now()+6000, legs }; debug('[client] set highlight legs (pre-confirm)', legs); initializeFullMap(); } catch {}
            // Send
            client.socket && client.socket.emit('travel:confirm', { gameId: client.gameId, sectorId: client.gameState.sector.id, shipId: client.selectedUnit.id, freshnessTurns: 3, legs }, (resp)=>{
                try { debug('[client] confirm resp', resp); } catch {}
                if (!resp || !resp.success) { client.addLogEntry(resp?.error || 'Confirm failed', 'error'); return; }
                const serverLegs = Array.isArray(resp?.itinerary) ? resp.itinerary : (Array.isArray(resp?.legs) ? resp.legs : null);
                const confirmedLegs = serverLegs ? serverLegs.map(normalizeLeg).filter(L=>Number.isFinite(L.edgeId)) : legs;
                const confirmedNonZero = confirmedLegs.filter(L => Math.abs(Number(L.sEnd||0) - Number(L.sStart||0)) > 1e-3);
                if (!confirmedNonZero.length) {
                    console.warn('[client] Server returned zero-length-only itinerary; keeping pre-confirm legs for highlight.', confirmedLegs);
                }
                client.addLogEntry(`Itinerary stored (${confirmedLegs.length} leg${confirmedLegs.length!==1?'s':''})`, 'success');
                try { client.__laneHighlight = { until: Date.now()+6000, legs: confirmedNonZero.length ? confirmedLegs : legs }; debug('[client] set highlight legs', confirmedLegs); initializeFullMap(); setTimeout(()=>initializeFullMap(), 100); setTimeout(()=>initializeFullMap(), 2000); } catch {}
            });
        } catch (e) { console.error('confirmRoute error', e); }
}

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
                        // Fixed colors per region id: A=blue, B=red, C=gold
                        let fill = 'rgba(100,149,237,0.10)'; // A default (cornflower blue)
                        const id = String(r.id || '').toUpperCase();
                        if (id === 'A') fill = 'rgba(80,130,255,0.10)';
                        else if (id === 'B') fill = 'rgba(255,99,99,0.10)';
                        else if (id === 'C') fill = 'rgba(255,200,80,0.10)';
                        ctx.fillStyle = fill;
                        (r.cells || []).forEach(c => {
                            ctx.fillRect(c.col*cellW*scaleX, c.row*cellH*scaleY, cellW*scaleX, cellH*scaleY);
                        });
                        // label
                        const first = (r.cells||[])[0];
                        if (first) {
                            const health = Number(r.health || 50);
                            const cx = (first.col*cellW + cellW*0.1)*scaleX, cy = (first.row*cellH + 16)*scaleY;
                            ctx.fillStyle = '#9ecbff'; ctx.font = '12px Arial'; ctx.textAlign='left'; ctx.textBaseline='top';
                            ctx.fillText(`Region ${r.id} — Health ${health}`, cx, cy);
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
                    try {
                        const routes = await new Promise((resolve)=>{
                            SFApi.Socket.emit('travel:plan', { gameId: client.gameId, sectorId: client.gameState.sector.id, from: { x: client.selectedUnit?.x, y: client.selectedUnit?.y }, to: click }, (resp)=>resolve(resp));
                        });
                        if (routes?.success && Array.isArray(routes.routes)) {
                            const list = routes.routes.slice(0,3);
                            const container = document.getElementById('plannerRoutes');
                            if (container) {
                                container.innerHTML = '';
                                list.forEach((r, idx) => {
                                    const rho = Number(r.rho || 0); const color = rho<=1?'#66bb6a':(rho<=1.5?'#ffca28':'#ef5350');
                                    const row = document.createElement('div'); row.style.display='grid'; row.style.gridTemplateColumns='1fr auto'; row.style.gap='6px'; row.style.alignItems='center'; row.style.border='1px solid rgba(100,181,246,0.25)'; row.style.padding='6px'; row.style.borderRadius='6px';
                                    const legs = Array.isArray(r.legs) ? r.legs : [{ edgeId: r.edgeId, entry: r.entry, sStart: r.sStart, sEnd: r.sEnd, tapId: r.nearestTapId, mergeTurns: r.mergeTurns }];
                                    const legsText = legs.map((L,i)=>`E${L.edgeId} ${L.entry==='tap'?'tap':'wild'} [${Math.round(L.sStart)}→${Math.round(L.sEnd)}]`).join(' → ');
                                    row.innerHTML = `<div><div style=\"font-size:12px; color:${color}\">● ρ ${rho.toFixed(2)} • ETA ${r.eta} • Risk ${'★'.repeat(r.risk||2)}</div><div style=\"font-size:11px; color:#9ecbff;\">${legsText}</div></div>
                                        <div style=\"display:flex; gap:6px;\">
                                            <button class=\"sf-btn sf-btn-primary\" data-route-index=\"${idx}\" data-action=\"confirm\">Confirm</button>
                                        </div>`;
                                    container.appendChild(row);
                                });
                                // Ensure planner panel is visible (no tabs now)
                                // Bind actions (delegated)
                                container.onclick = (e) => {
                                    const btn = e.target.closest('button'); if (!btn) return;
                                    const idx = Number(btn.getAttribute('data-route-index')||0) || 0; const r = list[idx];
                                    const action = btn.getAttribute('data-action');
                                    if (action === 'confirm') {
                                        const rawLegs = Array.isArray(r.legs)
                                            ? r.legs
                                            : [{ edgeId: r.edgeId ?? r.edge_id, entry: r.entry, sStart: r.sStart ?? r.s_start, sEnd: r.sEnd ?? r.s_end, tapId: r.tapId ?? r.tap_id ?? r.nearestTapId ?? r.nearest_tap_id, mergeTurns: r.mergeTurns ?? r.merge_turns }];
                                        const legs = rawLegs.map(normalizeLeg).filter(L => Number.isFinite(L.edgeId));
                                        client.socket && client.socket.emit('travel:confirm', { gameId: client.gameId, sectorId: client.gameState.sector.id, shipId: client.selectedUnit?.id, legs }, (resp)=>{
                                            if (!resp || !resp.success) { client.addLogEntry(resp?.error || 'Confirm failed', 'error'); return; }
                                            const serverLegs = Array.isArray(resp?.itinerary) ? resp.itinerary : (Array.isArray(resp?.legs) ? resp.legs : null);
                                            const confirmedLegs = serverLegs ? serverLegs.map(normalizeLeg).filter(L=>Number.isFinite(L.edgeId)) : legs;
                                            client.addLogEntry(`Itinerary stored (${confirmedLegs.length} leg${(confirmedLegs.length!==1)?'s':''})`, 'success');
                                            // Highlight legs on map for a few seconds
                                            try { client.__laneHighlight = { until: Date.now()+6000, legs: confirmedLegs }; console.log('[client] set highlight legs', confirmedLegs); initializeFullMap(); setTimeout(()=>initializeFullMap(), 100); setTimeout(()=>initializeFullMap(), 2000); } catch {}
                                        });
                                    }
                                };
                            }
                        }
                    } catch {}
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
                    const coreColor = rho<=1?'rgba(102,187,106,0.95)':(rho<=1.5?'rgba(255,202,40,0.95)':'rgba(239,83,80,0.95)');
                    // Shoulder halo
                    ctx.strokeStyle = 'rgba(100,181,246,0.2)';
                    ctx.lineWidth = Math.max(1, (l.width_shoulder || 220) * 0.5 * ((scaleX+scaleY)/2));
                    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
                    ctx.beginPath();
                    ctx.moveTo(pts[0].x*scaleX, pts[0].y*scaleY);
                    for (let i=1;i<pts.length;i++) ctx.lineTo(pts[i].x*scaleX, pts[i].y*scaleY);
                    ctx.stroke();
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
                    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
                    ctx.lineWidth = Math.max(2.5, laneWidth * 0.45 * ((scaleX+scaleY)/2));
                    ctx.beginPath();
                    ctx.moveTo(start.x*scaleX, start.y*scaleY);
                    for (let i=aIdx+1;i<=bIdx;i++) ctx.lineTo(pts[i].x*scaleX, pts[i].y*scaleY);
                    ctx.lineTo(end.x*scaleX, end.y*scaleY);
                    ctx.stroke();
                    // endpoints markers for debugging visualization
                    ctx.fillStyle = '#ffffff';
                    ctx.beginPath(); ctx.arc(start.x*scaleX, start.y*scaleY, 2.5, 0, Math.PI*2); ctx.fill();
                    ctx.beginPath(); ctx.arc(end.x*scaleX, end.y*scaleY, 2.5, 0, Math.PI*2); ctx.fill();
                });
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
        // Base objects with labels
        client.objects.forEach(obj => {
            const x = obj.x * scaleX, y = obj.y * scaleY; ctx.fillStyle = '#64b5f6';
            if (client.isCelestialObject(obj)) {
                ctx.fillStyle = '#9ecbff'; ctx.beginPath(); ctx.arc(x,y,4,0,Math.PI*2); ctx.fill();
                const meta = obj.meta || {}; const t = obj.celestial_type || obj.type;
                if (t === 'sun' || t === 'planet' || t === 'wormhole' || t === 'belt') {
                    ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.font='11px Arial'; ctx.textAlign='center'; ctx.textBaseline='top';
                    const name = meta.name || (t==='sun'?'Sun': t==='planet'?'Planet':'Wormhole');
                    ctx.fillText(String(name).slice(0,18), x, y + 6);
                }
            } else if (obj.type === 'resource_node') {
                ctx.fillStyle = '#ffd54f'; ctx.fillRect(x-2,y-2,4,4);
            } else {
                ctx.fillStyle = (obj.owner_id === client.userId) ? '#4CAF50' : '#FF9800'; ctx.fillRect(x-3,y-3,6,6);
            }
        });
}

async function loadGalaxyDataInternal() {
        try {
            const client = window.gameClient; const list = document.getElementById('galaxySystemsList'); if (!client || !list) return;
            const currentSystem = { name: client.gameState?.sector?.name || 'Current System', id: client.gameId, players: 1, status: 'Active', turn: client.gameState?.turn?.number || 1, celestialObjects: client.objects ? client.objects.filter(o=>client.isCelestialObject(o)).length : 0 };
            list.innerHTML = `<div class="galaxy-system-card"><div class="galaxy-system-name">${currentSystem.name}</div><div class="galaxy-system-info"><div>👥 ${currentSystem.players} Player${currentSystem.players!==1?'s':''}</div><div>⏰ Turn ${currentSystem.turn}</div><div>🌌 ${currentSystem.celestialObjects} Celestial Objects</div><div>📊 Status: <span style="color:#4CAF50;">${currentSystem.status}</span></div></div></div>`;
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
            const fmt = (name, mult) => `${name} ${mult}${counts.has(name) ? ` — ×${counts.get(name)}` : ''}`;
            const coreList = (disp.core || []).map(m => fmt(m.name, m.mult));
            const primaryList = (disp.primary || []).map(m => fmt(m.name, m.mult));
            const secondaryList = (disp.secondary || []).map(m => fmt(m.name, m.mult));
            wrap.innerHTML = `<div><b>Name:</b> ${sector.name}</div><div><b>Type:</b> ${sector.archetype||'standard'}</div><div style="margin-top:8px;"><b>Core minerals</b></div><div>${coreList.length?coreList.join(', '):'—'}</div><div style="margin-top:8px;"><b>Primary minerals present</b></div><div>${primaryList.length?primaryList.join(', '):'—'}</div><div style="margin-top:8px;"><b>Secondary minerals present</b></div><div>${secondaryList.length?secondaryList.join(', '):'—'}</div>`;
        } catch {}
}


