// Map modal helpers

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

        wrap.innerHTML = `
            <div><b>Name:</b> ${sector.name}</div>
            <div><b>Type:</b> ${sector.archetype || 'standard'}</div>
            <div style="margin-top:8px;"><b>Core minerals</b></div>
            <div>${coreList.length ? coreList.join(', ') : '—'}</div>
            <div style="margin-top:8px;"><b>Primary minerals present</b></div>
            <div>${primaryList.length ? primaryList.join(', ') : '—'}</div>
            <div style="margin-top:8px;"><b>Secondary minerals present</b></div>
            <div>${secondaryList.length ? secondaryList.join(', ') : '—'}</div>`;
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
        modalContent.innerHTML = `
            <div class="map-tabs" style="display:flex; gap:8px; align-items:center; padding: 12px 16px 8px 16px;">
                <button class="map-tab active sf-btn sf-btn-secondary" data-tab="solar-system">🌌 Solar System</button>
                <button class="map-tab sf-btn sf-btn-secondary" data-tab="galaxy">🌌 Galaxy</button>
            </div>
            <div id="solar-system-tab" class="map-tab-content" style="height: calc(100% - 56px); overflow: hidden; padding: 8px 14px 12px;">
                <div style="display:flex; flex-direction:column; height:100%; min-width:0;">
                    <div style="margin: 0 0 6px 0; flex: 0 0 auto;">
                        <h3 style="color: #64b5f6; margin: 0 0 6px 0;">🌌 ${client.gameState?.sector?.name || 'Current Solar System'}</h3>
                        <p style="color: #ccc; margin: 0; font-size: 0.9em;">Full tactical overview of your sector</p>
                    </div>
                    <div style="flex:1 1 auto; min-height:0; display:grid; grid-template-columns: 3fr 1fr; gap:14px; align-items:stretch;">
                        <div style="display:flex; flex-direction:column; min-width:0;">
                            <div style="flex:0 0 auto; margin: 0 0 8px 2px; color:#9ecbff; font-size:12px; display:flex; gap:12px; align-items:center; flex-wrap:wrap;">
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
                                <label style="display:flex; align-items:center; gap:6px; cursor:not-allowed; opacity:0.6;">
                                    <input type="checkbox" id="toggleLanes" disabled>
                                    <span>Show Warp Lanes (coming soon)</span>
                                </label>
                            </div>
                            <div style="flex:1; min-height:0;">
                                <canvas id="fullMapCanvas" class="full-map-canvas" style="width:100%; height:100%; display:block;"></canvas>
                            </div>
                        </div>
                        <div id="systemFacts" style="background:#0b1220; border:1px solid rgba(100,181,246,0.25); border-radius:8px; padding:12px; color:#e3f2fd; overflow:hidden;">
                            <h4 style="margin:0 0 8px 0; color:#9ecbff;">System Facts</h4>
                            <div id="sysMetaSummary" style="font-size:13px; line-height:1.6;">Loading...</div>
                        </div>
                    </div>
                </div>
            </div>
            <div id="galaxy-tab" class="map-tab-content hidden" style="height: calc(100% - 56px); overflow:hidden; padding: 12px 16px 16px;">
                <div style="margin-bottom: 10px;">
                    <h3 style="color: #64b5f6; margin: 0 0 10px 0;">🌌 Galaxy Overview</h3>
                    <p style="color: #ccc; margin: 0; font-size: 0.9em;">All known solar systems in the galaxy</p>
                </div>
                <div style="height: calc(100% - 52px); min-height: 280px;">
                    <canvas id="galaxyCanvas" class="full-map-canvas" style="height:100%; width:100%; display:block;"></canvas>
                </div>
                <div id="galaxyLegend" style="margin-top: 8px; font-size: 0.85em; color: #9ecbff;">● Size/brightness highlights strategic hubs (choke points). Lines show warp-gate connectivity.</div>
            </div>`;
        window.UI.showModal({ title:'🗺️ Strategic Map', content: modalContent, actions:[{ text:'Close', style:'secondary', action:()=>true }], className:'map-modal', width:1280, height:820 });
        // Bind tab switching without globals
        bindTabEvents(modalContent);
        setTimeout(() => { try { initializeFullMap(); loadGalaxyDataInternal(); populateSystemFactsInternal(); } catch (e) { console.error('map init error', e); } }, 100);
}

function bindTabEvents(root) {
        const tabs = root.querySelectorAll('.map-tab');
        tabs.forEach(btn => {
            btn.addEventListener('click', () => switchMapTab(root, btn.dataset.tab, btn));
        });
}

function switchMapTab(root, tabName, clickedEl) {
        root.querySelectorAll('.map-tab').forEach(tab => tab.classList.remove('active'));
        if (clickedEl) clickedEl.classList.add('active');
        root.querySelectorAll('.map-tab-content').forEach(content => content.classList.add('hidden'));
        const tab = root.querySelector('#' + tabName + '-tab'); if (tab) tab.classList.remove('hidden');
        if (tabName === 'solar-system') setTimeout(() => initializeFullMap(), 50); else if (tabName === 'galaxy') setTimeout(() => initializeGalaxyMap(), 50);
}

function initializeFullMap() {
        const client = window.gameClient; const canvas = document.getElementById('fullMapCanvas');
        if (!client || !canvas) return;
        const rect = canvas.getBoundingClientRect(); canvas.width = rect.width; canvas.height = rect.height;
        const ctx = canvas.getContext('2d'); ctx.fillStyle = '#0a0a1a'; ctx.fillRect(0,0,canvas.width,canvas.height);
        ctx.strokeStyle = 'rgba(100,181,246,0.3)'; ctx.lineWidth = 2; ctx.strokeRect(2,2,canvas.width-4,canvas.height-4);
        if (!client.objects) return;
        const scaleX = canvas.width / 5000, scaleY = canvas.height / 5000;
        const toggles = {
            regions: document.getElementById('toggleRegions')?.checked !== false,
            belts: document.getElementById('toggleBelts')?.checked !== false,
            wormholes: document.getElementById('toggleWormholes')?.checked !== false,
            lanes: document.getElementById('toggleLanes')?.checked === true
        };
        renderFullMap(ctx, canvas, scaleX, scaleY, toggles);
        ['toggleRegions','toggleBelts','toggleWormholes','toggleLanes'].forEach(id => {
            const el = document.getElementById(id); if (!el) return;
            el.onchange = () => initializeFullMap();
        });
}

async function initializeGalaxyMap() {
        const client = window.gameClient; const canvas = document.getElementById('galaxyCanvas'); if (!client || !canvas) return;
        const rect = canvas.getBoundingClientRect(); canvas.width = rect.width; canvas.height = Math.max(360, rect.height);
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
        // Enable lanes toggle dynamically if data exists
        try {
            const facts = client.gameState?.sector?.id ? await SFApi.State.systemFacts(client.gameState.sector.id) : null;
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
                const facts = await SFApi.State.systemFacts(client.gameState.sector.id);
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
                const facts = await SFApi.State.systemFacts(client.gameState.sector.id);
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
                const facts = await SFApi.State.systemFacts(client.gameState.sector.id);
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
                const facts = await SFApi.State.systemFacts(client.gameState.sector.id);
                const lanes = facts?.lanes || [];
                const tapsByEdge = facts?.laneTapsByEdge || {};
                // Simple planner click: show small overlay with ETA/risk/fuel (stub) and tap/wildcat buttons
                canvas.onclick = async (ev) => {
                    const rect = canvas.getBoundingClientRect();
                    const click = { x: (ev.clientX-rect.left)/scaleX, y: (ev.clientY-rect.top)/scaleY };
                    try {
                        const routes = await new Promise((resolve)=>{
                            SFApi.Socket.emit('travel:plan', { gameId: client.gameId, sectorId: client.gameState.sector.id, from: { x: client.selectedUnit?.x, y: client.selectedUnit?.y }, to: click }, (resp)=>resolve(resp));
                        });
                        if (routes?.success && Array.isArray(routes.routes)) {
                            const r = routes.routes[0];
                            const box = document.createElement('div'); box.style.position='absolute'; box.style.left=ev.clientX+'px'; box.style.top=ev.clientY+'px'; box.style.background='#0b1220'; box.style.border='1px solid rgba(100,181,246,0.35)'; box.style.padding='8px'; box.style.borderRadius='6px'; box.style.color='#cfe8ff'; box.style.zIndex=10000;
                            box.innerHTML = `<div style="font-size:12px; margin-bottom:4px;">ETA ${r.eta} turns • Risk ${'★'.repeat(r.risk)}</div>
                                <div style="display:flex; gap:6px;">
                                    <button class="sf-btn sf-btn-primary" id="btnTapEnter">Enter via Tap</button>
                                    <button class="sf-btn sf-btn-secondary" id="btnWildcat">Wildcat Merge</button>
                                </div>`;
                            document.body.appendChild(box);
                            box.querySelector('#btnTapEnter').onclick = async () => {
                                SFApi.Socket.emit('travel:enter', { sectorId: client.gameState.sector.id, edgeId: r.edgeId, mode: 'tap', shipId: client.selectedUnit?.id }, (resp)=>{});
                                document.body.removeChild(box);
                            };
                            box.querySelector('#btnWildcat').onclick = async () => {
                                SFApi.Socket.emit('travel:enter', { sectorId: client.gameState.sector.id, edgeId: r.edgeId, mode: 'wildcat', shipId: client.selectedUnit?.id }, (resp)=>{});
                                document.body.removeChild(box);
                            };
                        }
                    } catch {}
                };
                // Draw lanes
                lanes.forEach(l => {
                    const pts = Array.isArray(l.polyline) ? l.polyline : [];
                    if (pts.length < 2) return;
                    // Shoulder halo
                    ctx.strokeStyle = 'rgba(100,181,246,0.2)';
                    ctx.lineWidth = Math.max(1, (l.width_shoulder || 220) * 0.5 * ((scaleX+scaleY)/2));
                    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
                    ctx.beginPath();
                    ctx.moveTo(pts[0].x*scaleX, pts[0].y*scaleY);
                    for (let i=1;i<pts.length;i++) ctx.lineTo(pts[i].x*scaleX, pts[i].y*scaleY);
                    ctx.stroke();
                    // Core ribbon
                    ctx.strokeStyle = 'rgba(158,203,255,0.85)';
                    ctx.lineWidth = Math.max(2, (l.width_core || 180) * 0.35 * ((scaleX+scaleY)/2));
                    ctx.beginPath();
                    ctx.moveTo(pts[0].x*scaleX, pts[0].y*scaleY);
                    for (let i=1;i<pts.length;i++) ctx.lineTo(pts[i].x*scaleX, pts[i].y*scaleY);
                    ctx.stroke();
                    // Taps (diamonds)
                    const taps = tapsByEdge[l.id] || [];
                    ctx.fillStyle = 'rgba(200,230,255,0.95)';
                    taps.forEach(t => {
                        const x = t.x*scaleX, y = t.y*scaleY;
                        ctx.beginPath();
                        ctx.moveTo(x, y-4);
                        ctx.lineTo(x+4, y);
                        ctx.lineTo(x, y+4);
                        ctx.lineTo(x-4, y);
                        ctx.closePath();
                        ctx.fill();
                    });
                });
            } catch {}
        }
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


