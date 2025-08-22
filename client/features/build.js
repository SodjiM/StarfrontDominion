// Build & Shipyard Feature Module (ESM)
// Exports named functions; no window globals.

import * as SFApi from '../services/api.js';
import * as UI from '../ui/tooltip.js';

function bindUI() {
    const byId = (id) => document.getElementById(id);
    const safe = (el, fn) => { if (el) el.addEventListener('click', fn); };
    safe(byId('playerAssetsBtn'), () => { try { if (window.showPlayerAssets) window.showPlayerAssets(); } catch {} });
}

export async function showBuildModal() {
    const client = window.gameClient;
    if (!client || !client.selectedUnit) { client?.addLogEntry('No station selected', 'warning'); return; }
    const selectedStation = client.selectedUnit;
    if (selectedStation.type !== 'station') { client.addLogEntry('Only stations can build', 'warning'); return; }
    try {
        const response = await fetch(`/game/cargo/${selectedStation.id}?userId=${client.userId}`);
        const data = await response.json();
        if (!response.ok) { client.addLogEntry(data.error || 'Failed to get station cargo', 'error'); return; }
        const cargo = data.cargo;
        const rockQuantity = cargo.items.find(item => item.resource_name === 'rock')?.quantity || 0;
        const buildModal = document.createElement('div');
        buildModal.className = 'build-modal';
        buildModal.innerHTML = `
            <div class="build-tabs">
                <button class="build-tab active" data-tab="ships">🚢 Ships</button>
                <button class="build-tab" data-tab="structures">🏗️ Structures</button>
            </div>
            <div class="build-resources">
                <div class="resource-display">
                    <span class="resource-icon">🪨</span>
                    <span class="resource-name">Rock:</span>
                    <span class="resource-quantity">${rockQuantity}</span>
                </div>
                ${(window.SF_DEV_MODE || (typeof process !== 'undefined' && process.env && (process.env.SF_DEV_MODE==='1' || process.env.NODE_ENV==='development'))) ? `
                <div class="resource-display" style="margin-left: 12px;">
                    <label style="display:flex; align-items:center; gap:6px; cursor:pointer;">
                        <input id="free-build-toggle" type="checkbox" ${window.sfFreeBuild ? 'checked' : ''} />
                        <span>🧪 Free builds (test)</span>
                    </label>
                </div>` : ''}
            </div>
            <div id="ships-tab" class="build-tab-content">
                <div class="build-section">
                    <h3>🚢 Ship Construction</h3>
                    <div class="build-options" id="shipyard-container"></div>
                </div>
            </div>
            <div id="structures-tab" class="build-tab-content hidden">
                <div class="build-section">
                    <h3>🏗️ Structure Manufacturing</h3>
                    <div class="build-options">
                        <div class="build-option ${rockQuantity >= 1 ? '' : 'disabled'}">
                            <div class="build-info">
                                <div class="build-name">☀️ Sun Station</div>
                                <div class="build-description">Anchors in orbit around a star (one per star)</div>
                                <div class="build-stats">• Cargo: 50 units<br>• Must be adjacent to a star<br>• One station per star</div>
                            </div>
                            <div class="build-cost">
                                <div class="cost-item">🪨 1 Rock</div>
                                <button class="build-btn ${rockQuantity >= 1 ? '' : 'disabled'}" data-action="build-structure" data-type="sun-station" data-cost="1" ${rockQuantity >= 1 ? '' : 'disabled'}>Build</button>
                            </div>
                        </div>
                        <div class="build-option ${rockQuantity >= 1 ? '' : 'disabled'}">
                            <div class="build-info">
                                <div class="build-name">🪐 Planet Station</div>
                                <div class="build-description">Anchors in orbit around a planet (one per planet)</div>
                                <div class="build-stats">• Cargo: 50 units<br>• Must be adjacent to a planet<br>• One station per planet</div>
                            </div>
                            <div class="build-cost">
                                <div class="cost-item">🪨 1 Rock</div>
                                <button class="build-btn ${rockQuantity >= 1 ? '' : 'disabled'}" data-action="build-structure" data-type="planet-station" data-cost="1" ${rockQuantity >= 1 ? '' : 'disabled'}>Build</button>
                            </div>
                        </div>
                        <div class="build-option ${rockQuantity >= 1 ? '' : 'disabled'}">
                            <div class="build-info">
                                <div class="build-name">🌘 Moon Station</div>
                                <div class="build-description">Anchors in orbit around a moon (one per moon)</div>
                                <div class="build-stats">• Cargo: 50 units<br>• Must be adjacent to a moon<br>• One station per moon</div>
                            </div>
                            <div class="build-cost">
                                <div class="cost-item">🪨 1 Rock</div>
                                <button class="build-btn ${rockQuantity >= 1 ? '' : 'disabled'}" data-action="build-structure" data-type="moon-station" data-cost="1" ${rockQuantity >= 1 ? '' : 'disabled'}>Build</button>
                            </div>
                        </div>
                        <div class="build-option ${rockQuantity >= 1 ? '' : 'disabled'}">
                            <div class="build-info">
                                <div class="build-name">📦 Storage Box</div>
                                <div class="build-description">Deployable storage structure</div>
                                <div class="build-stats">• Cargo: 25 units<br>• Deployable anywhere<br>• Resource storage</div>
                            </div>
                            <div class="build-cost">
                                <div class="cost-item">🪨 1 Rock</div>
                                <button class="build-btn ${rockQuantity >= 1 ? '' : 'disabled'}" data-action="build-structure" data-type="storage-box" data-cost="1" ${rockQuantity >= 1 ? '' : 'disabled'}>Build</button>
                            </div>
                        </div>
                        <div class="build-option ${rockQuantity >= 5 ? '' : 'disabled'}">
                            <div class="build-info">
                                <div class="build-name">🌌 Warp Beacon</div>
                                <div class="build-description">Deployable warp destination</div>
                                <div class="build-stats">• Allows warp travel<br>• Accessible to all players<br>• Permanent structure</div>
                            </div>
                            <div class="build-cost">
                                <div class="cost-item">🪨 5 Rock</div>
                                <button class="build-btn ${rockQuantity >= 5 ? '' : 'disabled'}" data-action="build-structure" data-type="warp-beacon" data-cost="5" ${rockQuantity >= 5 ? '' : 'disabled'}>Build</button>
                            </div>
                        </div>
                        <div class="build-option ${rockQuantity >= 2 ? '' : 'disabled'}">
                            <div class="build-info">
                                <div class="build-name">🌀 Interstellar Gate</div>
                                <div class="build-description">Gateway between solar systems</div>
                                <div class="build-stats">• Connects to other sectors<br>• Accessible to all players<br>• Creates paired gates</div>
                            </div>
                            <div class="build-cost">
                                <div class="cost-item">🪨 2 Rock</div>
                                <button class="build-btn ${rockQuantity >= 2 ? '' : 'disabled'}" data-action="build-structure" data-type="interstellar-gate" data-cost="2" ${rockQuantity >= 2 ? '' : 'disabled'}>Build</button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
        UI.showModal({ title: '🔨 Construction Bay', content: buildModal, actions: [{ text:'Close', style:'primary', action: ()=>true }], className:'build-modal-container' });
        buildModal.querySelectorAll('.build-tab').forEach(btn => {
            btn.addEventListener('click', () => switchBuildTab(btn.dataset.tab, buildModal));
        });
        buildModal.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-action="build-structure"]');
            if (!btn) return;
            const type = btn.dataset.type;
            const cost = Number(btn.dataset.cost || '0');
            buildStructure(type, cost);
        });
        await renderShipyard(selectedStation, cargo);
    } catch (error) {
        console.error('Error getting station cargo:', error);
        client.addLogEntry('Failed to access construction bay', 'error');
    }
}

export async function renderShipyard(selectedStation, cargo) {
    const client = window.gameClient; const container = document.getElementById('shipyard-container'); if (!container) return;
    const haveMap = new Map(cargo.items.map(i => [i.resource_name, i.quantity]));
    let blueprints = [];
    try { const jd = await SFApi.Build.blueprints(); blueprints = jd.blueprints || []; } catch {}
    const ROLE_TO_REFINED = { 'stealth-scout': 'scout-recon','brawler': 'brawler','sniper': 'sniper-siege','interceptor': 'interceptor','assassin': 'stealth-strike','miner': 'prospector-miner','ecm': 'ecm-disruption','torpedo': 'torpedo-missile','courier': 'logistics','stealth-strike': 'stealth-strike','boarding': 'heavy-assault','miner-raider': 'prospector-miner','ecm-torpedo': 'torpedo-missile','escort': 'escort','siege': 'sniper-siege','fortress': 'fortress','gunline': 'sniper-siege','carrier': 'carrier','beam-destroyer': 'sniper-siege','torpedo-siege': 'torpedo-missile','ecm-fortress': 'ecm-disruption','logistics': 'logistics','repair-tender': 'medical-repair','defensive-carrier': 'carrier','command-artillery': 'command','siege-ecm': 'sniper-siege','logistics-fortress': 'logistics','freighter': 'logistics','colony': 'colony-ship','transport': 'logistics','medical': 'medical-repair','deepcore-miner': 'prospector-miner','gas-harvester': 'gas-harvester','strip-miner': 'prospector-miner','mining-command': 'prospector-miner','salvage': 'salvage','supercarrier': 'carrier','dreadnought': 'heavy-assault','flagship-command': 'flagship','heavy-shield': 'fortress','stealth-battleship': 'stealth-strike','mobile-shipyard': 'logistics','worldship': 'fortress','megafreighter': 'logistics','exploration': 'scout-recon','fleet-anchor': 'fortress','planet-cracker': 'sniper-siege','gas-refinery': 'gas-harvester','prospecting-ark': 'prospector-miner' };
    const REFINED_TO_GROUP = { 'brawler': 'combat','sniper-siege': 'combat','interceptor': 'combat','heavy-assault': 'combat','stealth-strike': 'combat','carrier': 'combat','escort': 'support-utility','command': 'support-utility','medical-repair': 'support-utility','logistics': 'support-utility','scout-recon': 'exploration-expansion','colony-ship': 'exploration-expansion','prospector-miner': 'exploration-expansion','gas-harvester': 'exploration-expansion','salvage': 'exploration-expansion','ecm-disruption': 'specialist','torpedo-missile': 'specialist','fortress': 'specialist','flagship': 'specialist' };
    blueprints = (blueprints || []).map(b => { const refinedRole = b.refinedRole || ROLE_TO_REFINED[b.role] || b.role; const refinedGroup = b.refinedGroup || REFINED_TO_GROUP[refinedRole] || null; return { ...b, refinedRole, refinedGroup }; });
    const tabs = ['frigate'];
    const refinedAll = Array.from(new Set(blueprints.map(b=>b.refinedRole || b.role)));
    const REFINED_ORDER = ['brawler','sniper-siege','interceptor','heavy-assault','stealth-strike','escort','command','medical-repair','logistics','scout-recon','prospector-miner','gas-harvester','salvage','ecm-disruption','torpedo-missile'];
    const LABELS = { 'brawler': 'Brawler','sniper-siege': 'Sniper / Siege','interceptor': 'Interceptor','heavy-assault': 'Heavy Assault','stealth-strike': 'Stealth Strike','carrier': 'Carrier','escort': 'Escort','command': 'Command','medical-repair': 'Medical / Repair','logistics': 'Logistics','scout-recon': 'Scout / Recon','colony-ship': 'Colony Ship','prospector-miner': 'Prospector / Miner','gas-harvester': 'Gas Harvester','salvage': 'Salvage','ecm-disruption': 'ECM / Disruption','torpedo-missile': 'Torpedo / Missile','fortress': 'Fortress','flagship': 'Flagship' };
    const GROUPS = [{ key:'combat', label:'Combat Roles', roles:['brawler','sniper-siege','interceptor','heavy-assault','stealth-strike','carrier'] },{ key:'support-utility', label:'Support & Utility', roles:['escort','command','medical-repair','logistics'] },{ key:'exploration-expansion', label:'Exploration & Expansion', roles:['scout-recon','colony-ship','prospector-miner','gas-harvester','salvage'] },{ key:'specialist', label:'Specialist Roles', roles:['ecm-disruption','torpedo-missile','fortress','flagship'] }];
    const rolesAll = REFINED_ORDER.filter(r => refinedAll.includes(r));
    let activeRole = null; let active = 'frigate';
    const header = document.createElement('div'); header.className = 'build-tabs-shipyard';
    tabs.forEach(t => { const b = document.createElement('button'); b.className = 'sf-btn ' + (active===t ? 'sf-btn-primary' : 'sf-btn-secondary'); b.dataset.class = t; b.textContent = t.charAt(0).toUpperCase() + t.slice(1); b.onclick = () => { active = t; header.querySelectorAll('button').forEach(bb => { const cls = bb.dataset.class; bb.className = 'sf-btn ' + (cls===active ? 'sf-btn-primary' : 'sf-btn-secondary'); }); renderList(); updateChips(); }; header.appendChild(b); });
    const roleBar = document.createElement('div'); roleBar.className = 'role-chips';
    const makeChip = (label, value) => { const c = document.createElement('button'); c.className = 'sf-chip ' + (activeRole===value ? 'active' : ''); c.textContent = label; c.onclick = () => { activeRole = (activeRole===value ? null : value); renderList(); updateChips(); }; return c; };
    const updateChips = () => { roleBar.innerHTML = ''; roleBar.appendChild(makeChip('All Roles', null)); const availableForClass = new Set(blueprints.filter(b => b.class === active).map(b => b.refinedRole || b.role)); GROUPS.forEach(group => { const present = group.roles.filter(r => availableForClass.has(r)); if (present.length === 0) return; const title = document.createElement('div'); title.className = 'role-group-title'; title.textContent = group.label; roleBar.appendChild(title); const wrap = document.createElement('div'); wrap.className = 'role-group'; present.forEach(r => wrap.appendChild(makeChip(LABELS[r] || r, r))); roleBar.appendChild(wrap); }); };
    updateChips();
    const list = document.createElement('div'); list.className = 'shipyard-list'; const containerEl = container; containerEl.appendChild(header); containerEl.appendChild(roleBar); containerEl.appendChild(list);
    const renderList = () => {
        list.innerHTML = '';
        blueprints.filter(b=>b.class===active && (!activeRole || (b.refinedRole||b.role)===activeRole)).forEach(bp => {
            const reqs = bp.requirements ? bp.requirements : { core: {}, specialized: {} };
            const wrap = document.createElement('div'); wrap.className = 'build-option';
            const reqRows = (obj) => Object.entries(obj).map(([k,v])=>{ const have = haveMap.get(k) || 0; const ok = have >= v; return `<div class="req-row"><span>${k}</span><span>${ok?'✅':'❌'} ${have}/${v}</span></div>`; }).join('');
            const canBuild = [...Object.entries(reqs.core), ...Object.entries(reqs.specialized)].every(([k,v]) => (haveMap.get(k)||0) >= v);
            const freeBuild = !!document.getElementById('free-build-toggle')?.checked; window.sfFreeBuild = freeBuild;
            const abilityPreview = (bp.abilitiesMeta||[]).map(a => { const tag = a.type === 'passive' ? '✨' : '🛠️'; const tip = a.shortDescription || ''; return `<span class="chip" title="${tip}">${tag} ${a.name}</span>`; }).join(' ');
            wrap.innerHTML = `
                <div class="build-info">
                    <div class="build-name">${bp.name}</div>
                    <div class="build-description">Class: ${bp.class} • Role: ${(LABELS[bp.refinedRole]||LABELS[bp.role]||bp.refinedRole||bp.role)}</div>
                    ${abilityPreview ? `<div style="margin:6px 0; display:flex; flex-wrap:wrap; gap:6px;">${abilityPreview}</div>` : ''}
                    <div class="build-reqs"><h4>Core</h4>${reqRows(reqs.core)}<h4>Specialized</h4>${reqRows(reqs.specialized)}</div>
                </div>
                <div class="build-cost">
                    <button class="build-btn ${(canBuild||freeBuild)?'':'disabled'}" ${(canBuild||freeBuild)?'':'disabled'}>Build${freeBuild?' (Free)':''}</button>
                </div>`;
            wrap.querySelector('button').onclick = async () => {
                try {
                    const jd = await SFApi.Build.buildShip(selectedStation.id, bp.id, client.userId, freeBuild);
                    client.addLogEntry(`Built ${jd.shipName}`, 'success'); UI.closeModal(); await client.loadGameState();
                } catch (e) { client.addLogEntry(e?.data?.error || e.message || 'Build failed', 'error'); }
            };
            list.appendChild(wrap);
        });
    };
    const freeToggle = document.getElementById('free-build-toggle'); if (freeToggle) { freeToggle.onchange = () => { renderList(); }; }
    renderList();
}

export function switchBuildTab(tabName, root) {
    const scope = root || document;
    scope.querySelectorAll('.build-tab').forEach(tab => { tab.classList.remove('active'); });
    const activeBtn = scope.querySelector(`.build-tab[data-tab="${tabName}"]`);
    if (activeBtn) activeBtn.classList.add('active');
    scope.querySelectorAll('.build-tab-content').forEach(content => { content.classList.add('hidden'); });
    const panel = scope.querySelector(`#${tabName}-tab`);
    if (panel) panel.classList.remove('hidden');
}

export async function buildShip(shipType, cost) {
    const client = window.gameClient; if (!client || !client.selectedUnit) { client?.addLogEntry('No station selected', 'warning'); return; }
    try { const data = await SFApi.postJson('/game/build-ship', { stationId: client.selectedUnit.id, shipType, cost, userId: client.userId }); client.addLogEntry(`${data.shipName} constructed successfully!`, 'success'); UI.closeModal(); client.socket.emit('get-game-state', { gameId: client.gameId, userId: client.userId }); } catch (error) { console.error('Error building ship:', error); client.addLogEntry(error?.data?.error || 'Failed to build ship', 'error'); }
}

export async function buildStructure(structureType, cost) {
    const client = window.gameClient; if (!client || !client.selectedUnit) { client?.addLogEntry('No station selected', 'warning'); return; }
    try { const data = await SFApi.Build.buildStructure(client.selectedUnit.id, structureType, cost, client.userId); client.addLogEntry(`${data.structureName} manufactured successfully!`, 'success'); UI.closeModal(); } catch (error) { console.error('Error building structure:', error); client.addLogEntry(error?.data?.error || 'Failed to build structure', 'error'); }
}

export async function buildBasicExplorer(cost) {
    const client = window.gameClient; if (!client || !client.selectedUnit) { client?.addLogEntry('No station selected', 'warning'); return; }
    try { const data = await SFApi.Build.buildShipBasic(client.selectedUnit.id, client.userId); client.addLogEntry(`${data.shipName} constructed successfully!`, 'success'); UI.closeModal(); await client.loadGameState(); } catch (error) { console.error('Error building basic explorer:', error); client.addLogEntry(error?.data?.error || 'Failed to build Explorer', 'error'); }
}

export async function deployStructure(structureType, shipId) {
    const client = window.gameClient; if (!client || !client.selectedUnit) { client?.addLogEntry('No ship selected', 'warning'); return; }
    if (structureType === 'interstellar-gate') { showSectorSelectionModal(shipId); return; }
    try { const data = await SFApi.Build.deployStructure(shipId, structureType, client.userId); client.addLogEntry(`${data.structureName} deployed successfully!`, 'success'); UI.closeModal(); client.socket.emit('get-game-state', { gameId: client.gameId, userId: client.userId }); } catch (error) { console.error('Error deploying structure:', error); client.addLogEntry(error?.data?.error || 'Failed to deploy structure', 'error'); }
}

export async function showSectorSelectionModal(shipId) {
    const client = window.gameClient;
    try {
        const data = await SFApi.Build.listSectors(client.gameId, client.userId);
        const sectors = data.sectors; const currentSectorId = client.gameState.sector.id;
        const availableSectors = sectors.filter(sector => sector.id !== currentSectorId);
        if (availableSectors.length === 0) { client.addLogEntry('No other sectors available for gate connection', 'warning'); return; }
        const sectorModal = document.createElement('div'); sectorModal.className = 'sector-selection-modal';
        sectorModal.innerHTML = `
            <div class="sector-selection-header"><h3>🌀 Select Destination Sector</h3><p>Choose which solar system to connect to:</p></div>
            <div class="sector-list">
                ${availableSectors.map(sector => `
                    <div class="sector-option" data-action="deploy-gate" data-ship-id="${shipId}" data-destination-id="${sector.id}" data-destination-name="${sector.name}">
                        <div class="sector-info">
                            <div class="sector-name">🌌 ${sector.name}</div>
                            <div class="sector-details">Owner: ${sector.owner_name || 'Unknown'}<br>Type: ${sector.archetype || 'Standard'}</div>
                        </div>
                        <div class="sector-action"><button class="select-sector-btn">Connect</button></div>
                    </div>
                `).join('')}
            </div>`;
        UI.showModal({ title: '🌀 Interstellar Gate Deployment', content: sectorModal, actions: [{ text: 'Cancel', style: 'secondary', action: () => true }], className: 'sector-selection-modal-container' });
        sectorModal.addEventListener('click', (e) => {
            const row = e.target.closest('[data-action="deploy-gate"]');
            if (!row) return;
            const sId = Number(row.dataset.shipId);
            const destId = Number(row.dataset.destinationId);
            const destName = row.dataset.destinationName;
            deployInterstellarGate(sId, destId, destName);
        });
    } catch (error) { console.error('Error showing sector selection:', error); client.addLogEntry('Failed to show sector selection', 'error'); }
}

export async function deployInterstellarGate(shipId, destinationSectorId, destinationSectorName) {
    const client = window.gameClient;
    try { const data = await SFApi.Build.deployInterstellarGate(shipId, destinationSectorId, client.userId); client.addLogEntry(`Interstellar Gate deployed! Connected to ${destinationSectorName}`, 'success'); UI.closeModal(); client.socket.emit('get-game-state', { gameId: client.gameId, userId: client.userId }); } catch (error) { console.error('Error deploying interstellar gate:', error); client.addLogEntry(error?.data?.error || 'Failed to deploy interstellar gate', 'error'); }
}

bindUI();


