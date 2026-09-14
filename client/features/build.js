// Build & Shipyard Feature Module (ESM)
// Exports named functions; no window globals.

import '../services/api.js';
import { physicalScale } from '../utils/physical-geometry.js';

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
        const { costs } = await window.SFApi.Build.structureCosts();
        const cargo = data.cargo;
        const rockQuantity = cargo.items.find(item => item.resource_name === 'rock')?.quantity || 0;
        const freeBuildEnabled = window.SF_DEV_MODE || (typeof process !== 'undefined' && process.env && (process.env.SF_DEV_MODE === '1' || process.env.NODE_ENV === 'development'));
        const freeBuildMarkup = freeBuildEnabled ? `
                <div class="resource-display" style="margin-left: 12px;">
                    <label style="display:flex; align-items:center; gap:6px; cursor:pointer;">
                        <input id="free-build-toggle" type="checkbox" ${window.sfFreeBuild ? 'checked' : ''} />
                        <span>🧪 Free builds (test)</span>
                    </label>
                </div>` : '';
        const stationSprite = (key, fallback) => window.SFSprites?.getSpriteUrlForKey
            ? `<img src="${window.SFSprites.getSpriteUrlForKey(key) || ''}" style="width:56px;height:56px;object-fit:contain;"/>`
            : fallback;
        const sunStationSprite = stationSprite('sun-station', '🏗️');
        const planetStationSprite = stationSprite('planet-station', '🪐');
        const moonStationSprite = stationSprite('moon-station', '🌘');
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
                ${freeBuildMarkup}
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
                        <div class="build-option ${rockQuantity >= costs['sun-station'] ? '' : 'disabled'}">
                            <div class="build-info" style="display:flex; gap:12px; align-items:flex-start;">
                                <div class="build-thumb" style="width:56px; height:56px; display:flex; align-items:center; justify-content:center; border-radius:4px; background: rgba(255,255,255,0.05);">
                                    ${sunStationSprite}
                                </div>
                                <div class="build-meta" style="flex:1;">
                                    <div class="build-name">☀️ Sun Station</div>
                                    <div class="build-description">Anchors in orbit around a star (one per star)</div>
                                    <div class="build-stats">• Cargo: 50 units<br>• Must be adjacent to a star<br>• One station per star</div>
                                </div>
                            </div>
                            <div class="build-cost">
                                <div class="cost-item">🪨 ${costs['sun-station']} Rock</div>
                                <button class="build-btn ${rockQuantity >= costs['sun-station'] ? '' : 'disabled'}" data-action="build-structure" data-type="sun-station" data-cost="${costs['sun-station']}" ${rockQuantity >= costs['sun-station'] ? '' : 'disabled'}>Build</button>
                            </div>
                        </div>
                        <div class="build-option ${rockQuantity >= costs['planet-station'] ? '' : 'disabled'}">
                            <div class="build-info" style="display:flex; gap:12px; align-items:flex-start;">
                                <div class="build-thumb" style="width:56px; height:56px; display:flex; align-items:center; justify-content:center; border-radius:4px; background: rgba(255,255,255,0.05);">
                                    ${planetStationSprite}
                                </div>
                                <div class="build-meta" style="flex:1;">
                                    <div class="build-name">🪐 Planet Station</div>
                                    <div class="build-description">Anchors in orbit around a planet (one per planet)</div>
                                    <div class="build-stats">• Cargo: 50 units<br>• Must be adjacent to a planet<br>• One station per planet</div>
                                </div>
                            </div>
                            <div class="build-cost">
                                <div class="cost-item">🪨 ${costs['planet-station']} Rock</div>
                                <button class="build-btn ${rockQuantity >= costs['planet-station'] ? '' : 'disabled'}" data-action="build-structure" data-type="planet-station" data-cost="${costs['planet-station']}" ${rockQuantity >= costs['planet-station'] ? '' : 'disabled'}>Build</button>
                            </div>
                        </div>
                        <div class="build-option ${rockQuantity >= costs['moon-station'] ? '' : 'disabled'}">
                            <div class="build-info" style="display:flex; gap:12px; align-items:flex-start;">
                                <div class="build-thumb" style="width:56px; height:56px; display:flex; align-items:center; justify-content:center; border-radius:4px; background: rgba(255,255,255,0.05);">
                                    ${moonStationSprite}
                                </div>
                                <div class="build-meta" style="flex:1;">
                                    <div class="build-name">🌘 Moon Station</div>
                                    <div class="build-description">Anchors in orbit around a moon (one per moon)</div>
                                    <div class="build-stats">• Cargo: 50 units<br>• Must be adjacent to a moon<br>• One station per moon</div>
                                </div>
                            </div>
                            <div class="build-cost">
                                <div class="cost-item">🪨 ${costs['moon-station']} Rock</div>
                                <button class="build-btn ${rockQuantity >= costs['moon-station'] ? '' : 'disabled'}" data-action="build-structure" data-type="moon-station" data-cost="${costs['moon-station']}" ${rockQuantity >= costs['moon-station'] ? '' : 'disabled'}>Build</button>
                            </div>
                        </div>
                        <div class="build-option ${rockQuantity >= costs['storage-box'] ? '' : 'disabled'}">
                            <div class="build-info">
                                <div class="build-name">📦 Storage Box</div>
                                <div class="build-description">Deployable storage structure</div>
                                <div class="build-stats">• Cargo: 25 units<br>• Deployable anywhere<br>• Resource storage</div>
                            </div>
                            <div class="build-cost">
                                <div class="cost-item">🪨 ${costs['storage-box']} Rock</div>
                                <button class="build-btn ${rockQuantity >= costs['storage-box'] ? '' : 'disabled'}" data-action="build-structure" data-type="storage-box" data-cost="${costs['storage-box']}" ${rockQuantity >= costs['storage-box'] ? '' : 'disabled'}>Build</button>
                            </div>
                        </div>
                        <div class="build-option ${rockQuantity >= costs['warp-beacon'] ? '' : 'disabled'}">
                            <div class="build-info">
                                <div class="build-name">🌌 Warp Beacon</div>
                                <div class="build-description">Deployable warp destination</div>
                                <div class="build-stats">• Allows warp travel<br>• Accessible to all players<br>• Permanent structure</div>
                            </div>
                            <div class="build-cost">
                                <div class="cost-item">🪨 ${costs['warp-beacon']} Rock</div>
                                <button class="build-btn ${rockQuantity >= costs['warp-beacon'] ? '' : 'disabled'}" data-action="build-structure" data-type="warp-beacon" data-cost="${costs['warp-beacon']}" ${rockQuantity >= costs['warp-beacon'] ? '' : 'disabled'}>Build</button>
                            </div>
                        </div>
                        <div class="build-option ${rockQuantity >= costs['interstellar-gate'] ? '' : 'disabled'}">
                            <div class="build-info">
                                <div class="build-name">🌀 Interstellar Gate</div>
                                <div class="build-description">Gateway between solar systems</div>
                                <div class="build-stats">• Connects to other sectors<br>• Accessible to all players<br>• Creates paired gates</div>
                            </div>
                            <div class="build-cost">
                                <div class="cost-item">🪨 ${costs['interstellar-gate']} Rock</div>
                                <button class="build-btn ${rockQuantity >= costs['interstellar-gate'] ? '' : 'disabled'}" data-action="build-structure" data-type="interstellar-gate" data-cost="${costs['interstellar-gate']}" ${rockQuantity >= costs['interstellar-gate'] ? '' : 'disabled'}>Build</button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
        window.UI.showModal({ title: '🔨 Construction Bay', content: buildModal, actions: [{ text:'Close', style:'primary', action: ()=>true }], className:'build-modal-container' });
        buildModal.querySelectorAll('.build-tab').forEach(btn => {
            btn.addEventListener('click', () => switchBuildTab(btn.dataset.tab, buildModal));
        });
        buildModal.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-action="build-structure"]');
            if (!btn) return;
            const type = btn.dataset.type;
            buildStructure(type);
        });
        await renderShipyard(selectedStation, cargo);
    } catch (error) {
        console.error('Error getting station cargo:', error);
        client.addLogEntry('Failed to access construction bay', 'error');
    }
}

export async function renderShipyard(selectedStation, cargo) {
    const client = window.gameClient; const container = document.getElementById('shipyard-container'); if (!container) return;
    const haveMap = new Map(cargo.items.map(i => [i.resource_key || i.resource_name, i.quantity]));
    let blueprints = [];
    try { const jd = await window.SFApi.Build.blueprints(); blueprints = jd.blueprints || []; } catch {}
    const ROLE_TO_REFINED = { 'stealth-scout': 'scout-recon','brawler': 'brawler','sniper': 'sniper-siege','interceptor': 'interceptor','assassin': 'stealth-strike','miner': 'prospector-miner','ecm': 'ecm-disruption','torpedo': 'torpedo-missile','courier': 'logistics','stealth-strike': 'stealth-strike','boarding': 'heavy-assault','miner-raider': 'prospector-miner','ecm-torpedo': 'torpedo-missile','escort': 'escort','siege': 'sniper-siege','fortress': 'fortress','gunline': 'sniper-siege','carrier': 'carrier','beam-destroyer': 'sniper-siege','torpedo-siege': 'torpedo-missile','ecm-fortress': 'ecm-disruption','logistics': 'logistics','repair-tender': 'medical-repair','defensive-carrier': 'carrier','command-artillery': 'command','siege-ecm': 'sniper-siege','logistics-fortress': 'logistics','freighter': 'logistics','colony': 'colony-ship','transport': 'logistics','medical': 'medical-repair','deepcore-miner': 'prospector-miner','gas-harvester': 'gas-harvester','strip-miner': 'prospector-miner','mining-command': 'prospector-miner','salvage': 'salvage','supercarrier': 'carrier','dreadnought': 'heavy-assault','flagship-command': 'flagship','heavy-shield': 'fortress','stealth-battleship': 'stealth-strike','mobile-shipyard': 'logistics','worldship': 'fortress','megafreighter': 'logistics','exploration': 'scout-recon','fleet-anchor': 'fortress','planet-cracker': 'sniper-siege','gas-refinery': 'gas-harvester','prospecting-ark': 'prospector-miner' };
    const REFINED_TO_GROUP = { 'brawler': 'combat','sniper-siege': 'combat','interceptor': 'combat','heavy-assault': 'combat','stealth-strike': 'combat','carrier': 'combat','escort': 'support-utility','command': 'support-utility','medical-repair': 'support-utility','logistics': 'support-utility','scout-recon': 'exploration-expansion','colony-ship': 'exploration-expansion','prospector-miner': 'exploration-expansion','gas-harvester': 'exploration-expansion','salvage': 'exploration-expansion','ecm-disruption': 'specialist','torpedo-missile': 'specialist','fortress': 'specialist','flagship': 'specialist' };
    const previews = await Promise.all((blueprints || []).map(async bp => {
        try { return [bp.id, await window.SFApi.Build.buildShipPreview(selectedStation.id, bp.id, client.userId)]; }
        catch { return [bp.id, { ok: false, reasons: [{ code: 'preview_unavailable' }] }]; }
    }));
    const previewMap = new Map(previews);
    blueprints = (blueprints || []).map(b => { const refinedRole = b.refinedRole || ROLE_TO_REFINED[b.role] || b.role; const refinedGroup = b.refinedGroup || REFINED_TO_GROUP[refinedRole] || null; return { ...b, refinedRole, refinedGroup, buildPreview: previewMap.get(b.id) }; });
    const classOrder = ['frigate', 'battleship', 'capital'];
    const tabs = classOrder.filter(cls => blueprints.some(bp => bp.class === cls));
    const stationMeta = typeof selectedStation.meta === 'string' ? (() => { try { return JSON.parse(selectedStation.meta) || {}; } catch { return {}; } })() : (selectedStation.meta || {});
    const stationClass = stationMeta.stationClass || 'planet-station';
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
    const list = document.createElement('div'); list.className = 'shipyard-list'; const containerEl = container;
    const queuePanel = document.createElement('div'); queuePanel.className = 'ship-build-queue'; queuePanel.setAttribute('aria-live', 'polite');
    containerEl.appendChild(queuePanel); containerEl.appendChild(header); containerEl.appendChild(roleBar); containerEl.appendChild(list);
    const buildStatusLabel = (build) => build.status === 'blocked' ? `Blocked: ${build.statusReason === 'no_launch_space' ? 'no clear launch space' : build.statusReason || 'needs attention'}` : `Completes on turn ${build.completionTurn}`;
    const renderBuildQueue = async () => {
        try {
            const data = await window.SFApi.Build.listShipBuilds(selectedStation.id, client.userId);
            const builds = data.builds || [];
            queuePanel.innerHTML = builds.length ? `<div class="ship-build-queue-title">Active construction</div>${builds.map(build => `<div class="ship-build-row"><div><strong>${escapeHtml(build.shipName)}</strong><span>${escapeHtml(buildStatusLabel(build))}</span></div><button class="sf-btn sf-btn-secondary ship-build-cancel" data-build-id="${build.id}" ${build.status === 'blocked' ? '' : ''}>Cancel</button></div>`).join('')` : '';
            queuePanel.querySelectorAll('.ship-build-cancel').forEach(button => button.addEventListener('click', async () => {
                button.disabled = true;
                try { await window.SFApi.Build.cancelShipBuild(button.dataset.buildId, client.userId); client.addLogEntry('Ship build cancelled and resources refunded.', 'success'); await renderBuildQueue(); }
                catch (e) { button.disabled = false; client.addLogEntry(e?.data?.error || e.message || 'Unable to cancel ship build', 'error'); }
            }));
        } catch { queuePanel.innerHTML = ''; }
    };
    await renderBuildQueue();
    const renderList = () => {
        list.innerHTML = '';
        const visible = blueprints.filter(b=>b.class===active && (!activeRole || (b.refinedRole||b.role)===activeRole));
        if (!visible.length) {
            list.innerHTML = `<div class="build-empty" role="status"><strong>No ${active} blueprints available.</strong><span>New hulls will appear here when this class is added to the registry.</span></div>`;
            return;
        }
        visible.forEach(bp => {
            const reqs = bp.requirements ? bp.requirements : { core: {}, specialized: {} };
            const wrap = document.createElement('div'); wrap.className = 'build-option';
            const reqRows = (group) => (bp.requirementDetails?.[group] || []).map(({ key, label, quantity }) => { const have = haveMap.get(key) || 0; const ok = have >= quantity; return `<div class="req-row"><span>${label}</span><span>${ok?'✅':'❌'} ${have}/${quantity}</span></div>`; }).join('');
            const canBuild = bp.buildPreview?.ok === true;
            const stationAllowed = Array.isArray(bp.stationClasses) && bp.stationClasses.includes(stationClass);
            const freeBuild = !!document.getElementById('free-build-toggle')?.checked; window.sfFreeBuild = freeBuild;
            const abilityPreview = (bp.abilitiesMeta||[]).map(a => { const tag = a.type === 'passive' ? '✨' : '🛠️'; const tip = a.shortDescription || ''; return `<span class="chip" title="${tip}">${tag} ${a.name}</span>`; }).join(' ');
            const spriteUrl = (window.SFSprites && window.SFSprites.getSpriteUrlForKey) ? window.SFSprites.getSpriteUrlForKey(bp.id) : null;
            wrap.innerHTML = `
                <div class="build-info" style="display:flex; gap:12px; align-items:flex-start;">
                    <div class="build-thumb" style="width:56px; height:56px; display:flex; align-items:center; justify-content:center; border-radius:4px; background: rgba(255,255,255,0.05);">
                        ${spriteUrl ? `<img src="${spriteUrl}" alt="${bp.name}" style="width:56px;height:56px;object-fit:contain;image-rendering:auto;"/>` : '🚢'}
                    </div>
                    <div class="build-meta" style="flex:1;">
                        <div class="build-name">${bp.name}</div>
                        <div class="build-description">Class: ${bp.class} • Role: ${(LABELS[bp.refinedRole]||LABELS[bp.role]||bp.refinedRole||bp.role)}</div>
                        <div class="build-description">Build time: ${bp.buildTimeTurns} turn${bp.buildTimeTurns === 1 ? '' : 's'} • ${stationAllowed ? 'Available at this station' : 'Not buildable at this station'}</div>
                        ${abilityPreview ? `<div style="margin:6px 0; display:flex; flex-wrap:wrap; gap:6px;">${abilityPreview}</div>` : ''}
                        <div class="build-reqs"><h4>Core</h4>${reqRows('core')}<h4>Specialized</h4>${reqRows('specialized')}</div>
                    </div>
                </div>
                <div class="build-cost">
                    <button class="build-btn ${(canBuild||freeBuild)&&stationAllowed?'':'disabled'}" ${(canBuild||freeBuild)&&stationAllowed?'':'disabled'}>${stationAllowed ? `Build${freeBuild?' (Free)':''}` : 'Unavailable'}</button>
                </div>`;
            wrap.querySelector('button').onclick = async () => {
                const button = wrap.querySelector('button'); button.disabled = true;
                try {
                    const clientOrderId = globalThis.crypto?.randomUUID?.() || `ship-build-${Date.now()}-${Math.random().toString(36).slice(2)}`;
                    const jd = await window.SFApi.Build.buildShip(selectedStation.id, bp.id, client.userId, freeBuild, clientOrderId);
                    client.addLogEntry(`${jd.shipName} queued for completion on turn ${jd.completionTurn}`, 'success'); window.UI.closeModal(); await client.loadGameState();
                } catch (e) { button.disabled = false; client.addLogEntry(e?.data?.error || e.message || 'Build failed', 'error'); }
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

export async function buildStructure(structureType) {
    const client = window.gameClient; if (!client || !client.selectedUnit) { client?.addLogEntry('No station selected', 'warning'); return; }
    try { const data = await window.SFApi.Build.buildStructure(client.selectedUnit.id, structureType, client.userId); client.addLogEntry(`${data.structureName} manufactured successfully!`, 'success'); window.UI.closeModal(); } catch (error) { console.error('Error building structure:', error); client.addLogEntry(error?.data?.error || 'Failed to build structure', 'error'); }
}

// Deprecated: buildBasicExplorer replaced by blueprint-driven buildShip above

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
}

function anchorLabel(object, structureType) {
    const meta = object.meta || {};
    const kind = structureType === 'sun-station' ? 'Star' : structureType === 'planet-station' ? 'Planet' : 'Moon';
    return `${meta.name || `${kind} ${object.id}`} · (${object.x}, ${object.y})`;
}

async function deployStructureAtAnchor(structureType, shipId, anchorObjectId) {
    const client = window.gameClient; if (!client || !client.selectedUnit) { client?.addLogEntry('No ship selected', 'warning'); return; }
    if (structureType === 'interstellar-gate') { showSectorSelectionModal(shipId); return; }
    try { const data = await window.SFApi.Build.deployStructure(shipId, structureType, client.userId, anchorObjectId); client.addLogEntry(`${data.structureName} deployed successfully!`, 'success'); window.UI.closeModal(); client.socket.emit('get-game-state', { gameId: client.gameId, userId: client.userId }); } catch (error) { console.error('Error deploying structure:', error); client.addLogEntry(error?.data?.error || 'Failed to deploy structure', 'error'); }
}

export async function deployStructure(structureType, shipId, anchorObjectId) {
    const client = window.gameClient;
    if (!client || !client.selectedUnit) { client?.addLogEntry('No ship selected', 'warning'); return; }
    if (structureType === 'interstellar-gate') { showSectorSelectionModal(shipId); return; }

    const anchorTypes = { 'sun-station': 'star', 'planet-station': 'planet', 'moon-station': 'moon' };
    const requiredType = anchorTypes[structureType];
    if (!requiredType || anchorObjectId) return deployStructureAtAnchor(structureType, shipId, anchorObjectId);

    const ship = client.gameState?.objects?.find(o => Number(o.id) === Number(shipId));
    const candidates = (client.gameState?.objects || [])
        .filter(o => (o.celestial_type || o.type) === requiredType && ship && physicalScale.gap(ship, o) <= 30)
        .sort((a, b) => physicalScale.gap(ship, a) - physicalScale.gap(ship, b) || Number(a.id) - Number(b.id));
    if (!candidates.length) {
        client.addLogEntry(`No eligible ${requiredType} is within deployment range`, 'warning');
        return;
    }

    window.UI.closeModal();
    const content = document.createElement('div');
    content.className = 'anchor-selection-modal';
    content.innerHTML = `
        <div class="sector-selection-header">
            <h3>📍 Select Celestial Anchor</h3>
            <p>Choose the body where this station will be attached. Only bodies within 30 tiles of the deploying ship are shown.</p>
        </div>
        <div class="sector-list anchor-list">
            ${candidates.map(object => `
                <button type="button" class="sector-option anchor-option" data-anchor-id="${Number(object.id)}">
                    <span class="sector-info">
                        <span class="sector-name">${escapeHtml(anchorLabel(object, structureType))}</span>
                        <span class="sector-details">${Math.round(physicalScale.gap(ship, object))} tiles from ship</span>
                    </span>
                    <span class="sector-action">Attach</span>
                </button>
            `).join('')}
        </div>`;
    content.addEventListener('click', event => {
        const option = event.target.closest('[data-anchor-id]');
        if (!option) return;
        const selectedId = Number(option.dataset.anchorId);
        window.UI.closeModal();
        deployStructureAtAnchor(structureType, shipId, selectedId);
    });
    window.UI.showModal({
        title: '🛰️ Station Deployment',
        content,
        actions: [{ text: 'Cancel', style: 'secondary', action: () => true }],
        className: 'anchor-selection-modal-container'
    });
}

export async function showSectorSelectionModal(shipId) {
    const client = window.gameClient;
    try {
        const data = await window.SFApi.Build.listSectors(client.gameId, client.userId);
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
        window.UI.showModal({ title: '🌀 Interstellar Gate Deployment', content: sectorModal, actions: [{ text: 'Cancel', style: 'secondary', action: () => true }], className: 'sector-selection-modal-container' });
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
    try { const data = await window.SFApi.Build.deployInterstellarGate(shipId, destinationSectorId, client.userId); client.addLogEntry(`Interstellar Gate deployed! Connected to ${destinationSectorName}`, 'success'); window.UI.closeModal(); client.socket.emit('get-game-state', { gameId: client.gameId, userId: client.userId }); } catch (error) { console.error('Error deploying interstellar gate:', error); client.addLogEntry(error?.data?.error || 'Failed to deploy interstellar gate', 'error'); }
}

bindUI();
