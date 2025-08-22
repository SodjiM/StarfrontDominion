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
        UI.showModal({ title:'🗺️ Strategic Map', content: modalContent, actions:[{ text:'Close', style:'secondary', action:()=>true }], className:'map-modal', width:1280, height:820 });
        // Bind tab switching without globals
        bindTabEvents(modalContent);
        setTimeout(() => { try { initializeFullMap(); loadGalaxyData(); populateSystemFacts(); } catch (e) { console.error('map init error', e); } }, 100);
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
        renderFullMapObjects(ctx, canvas, scaleX, scaleY);
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

function renderFullMapObjects(ctx, canvas, scaleX, scaleY) {
        const client = window.gameClient; if (!client || !client.objects) return;
        client.objects.forEach(obj => {
            const x = obj.x * scaleX, y = obj.y * scaleY; ctx.fillStyle = '#64b5f6';
            if (client.isCelestialObject(obj)) {
                ctx.fillStyle = '#9ecbff'; ctx.beginPath(); ctx.arc(x,y,4,0,Math.PI*2); ctx.fill();
            } else if (obj.type === 'resource_node') {
                ctx.fillStyle = '#ffd54f'; ctx.fillRect(x-2,y-2,4,4);
            } else {
                ctx.fillStyle = (obj.owner_id === client.userId) ? '#4CAF50' : '#FF9800'; ctx.fillRect(x-3,y-3,6,6);
            }
        });
}

async function loadGalaxyData() {
        try {
            const client = window.gameClient; const list = document.getElementById('galaxySystemsList'); if (!client || !list) return;
            const currentSystem = { name: client.gameState?.sector?.name || 'Current System', id: client.gameId, players: 1, status: 'Active', turn: client.gameState?.turn?.number || 1, celestialObjects: client.objects ? client.objects.filter(o=>client.isCelestialObject(o)).length : 0 };
            list.innerHTML = `<div class="galaxy-system-card"><div class="galaxy-system-name">${currentSystem.name}</div><div class="galaxy-system-info"><div>👥 ${currentSystem.players} Player${currentSystem.players!==1?'s':''}</div><div>⏰ Turn ${currentSystem.turn}</div><div>🌌 ${currentSystem.celestialObjects} Celestial Objects</div><div>📊 Status: <span style="color:#4CAF50;">${currentSystem.status}</span></div></div></div>`;
        } catch {}
}

async function populateSystemFacts() {
        try {
            const client = window.gameClient; const wrap = document.getElementById('sysMetaSummary'); if (!wrap || !client?.gameState?.sector) return;
            const sector = client.gameState.sector; const all = client.objects || []; const planets = all.filter(o=>o.celestial_type==='planet'); const belts = all.filter(o=>o.celestial_type==='belt'); const nebulas = all.filter(o=>o.celestial_type==='nebula');
            const rock = Math.max(1, belts.length*3), gas = Math.max(1, nebulas.length*2), energy = Math.max(1, planets.length); const total = rock+gas+energy; const pct = n=>`${Math.round((n/total)*100)}%`;
            wrap.innerHTML = `<div><b>Name:</b> ${sector.name}</div><div><b>Type:</b> ${sector.archetype||'standard'}</div><div style="margin-top:8px;"><b>Core Mineral Bias</b></div><div>• Ferrite Alloy: x1.00<br/>• Crytite: x1.00<br/>• Ardanium: x1.00<br/>• Vornite: x1.00<br/>• Zerothium: x1.00</div><div style="margin-top:8px;"><b>Estimated Ratios</b></div><div>Rock ${pct(rock)}, Gas ${pct(gas)}, Energy ${pct(energy)}</div>`;
        } catch {}
}


