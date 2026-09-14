// Server-authoritative Senate UI. Political state is loaded from the game API;
// localStorage is deliberately not used for Senate decisions.

function esc(value) {
    return String(value ?? '').replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
}

function stationLabel(station) {
    if (!station) return 'Unassigned';
    return `${station.name || `Station ${station.id}`} · ${station.stationClass} · ${station.sectorName || 'System'}`;
}

function stationOptions(state, selectedId) {
    return (state.stations || []).map(station => `<option value="${station.id}" ${Number(selectedId) === Number(station.id) ? 'selected' : ''}>${esc(stationLabel(station))}</option>`).join('');
}

function renderState(game, state) {
    const session = state.session;
    const senators = state.senators || [];
    const objectives = state.objectives || [];
    const candidates = state.candidates || [];
    const policies = state.policies || { available: [], active: [] };
    const activePolicyKeys = new Set((policies.active || []).map(policy => policy.key));
    const objectiveBySenator = new Map(objectives.map(objective => [Number(objective.senatorId), objective]));
    const active = senators.filter(senator => senator.status === 'active');
    const replaceOptions = active.map(senator => `<option value="${senator.id}">${esc(senator.name)} · ${esc(senator.tags.join(', '))}</option>`).join('');
    const sessionText = session ? `Session opened on turn ${session.openedTurn}; decisions close after turn ${session.expiresTurn}.` : `Next Senate session opens every 100 turns. Current turn: ${state.currentTurn}.`;
    const content = document.createElement('div');
    content.className = 'senate-modal-content';
    content.innerHTML = `
        <div class="form-section">
            <p>${esc(sessionText)}</p>
            <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:10px 0;">
                <div class="asset-item"><strong>Institutional influence</strong><br>${Math.round(state.institutionalInfluence || 0)}</div>
                <div class="asset-item"><strong>Policy slots</strong><br>${state.policySlots || 5}</div>
                <div class="asset-item"><strong>Political capital</strong><br>${Math.round(state.politicalCapital || 0)}</div>
            </div>
        </div>
        <div class="form-section">
            <h3>Active senators (${active.length}/5)</h3>
            <div style="display:grid;gap:10px;">
                ${senators.map(senator => {
                    const objective = objectiveBySenator.get(Number(senator.id));
                    return `<div class="asset-item" style="display:grid;gap:6px;">
                        <div style="display:flex;justify-content:space-between;gap:10px;"><strong>${esc(senator.name)}</strong><span>Term ${senator.termNumber}/4 · Happiness ${senator.happiness}</span></div>
                        <div style="color:#aaa;">${esc(senator.tags.join(' · '))}</div>
                        <div style="color:#bbb;">Post: ${esc(stationLabel(senator.station))}</div>
                        ${objective ? `<div style="color:#d7c5ff;"><strong>${esc(objective.title)}</strong> — ${esc(objective.description)}<br><small>${esc(objective.status)} · ${Number(objective.progress?.current || 0)}/${Number(objective.progress?.target || 1)}</small></div>` : ''}
                        ${session && senator.status === 'active' ? `<div style="display:flex;gap:6px;align-items:center;"><select data-assign-station="${senator.id}">${stationOptions(state, senator.station?.id)}</select><button class="sf-btn sf-btn-secondary" data-assign-senator="${senator.id}">Reassign</button></div>` : ''}
                    </div>`;
                }).join('') || '<p>No senator is currently assigned. Establish a qualifying station to begin.</p>'}
            </div>
        </div>
        ${session ? `<div class="form-section"><h3>Candidate appointments</h3><p>Each active senator requires one sun, planet, or moon station. Reassignment is only available during this session.</p><div style="display:grid;gap:10px;">
            ${candidates.map(candidate => `<div class="asset-item" style="display:grid;gap:6px;"><div><strong>${esc(candidate.name)}</strong> <span style="color:#aaa;">${esc(candidate.tags.join(' · '))}</span></div><div style="color:#bbb;">Preferred post: ${esc(candidate.stationClass)}</div><div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;"><select data-candidate-station="${candidate.id}">${stationOptions(state)}</select>${active.length >= (state.stations || []).length ? `<select data-candidate-replace="${candidate.id}">${replaceOptions}</select>` : ''}<button class="sf-btn sf-btn-primary" data-select-candidate="${candidate.id}">Appoint</button></div></div>`).join('') || '<p>No candidates available.</p>'}
        </div></div>` : ''}
        <div class="form-section"><h3>Tag mandate</h3><div style="display:flex;gap:8px;flex-wrap:wrap;">${Object.entries(state.mandate || {}).map(([tag, value]) => `<span class="asset-item">${esc(tag)}: ${Math.round(value)}</span>`).join('') || '<span>No mandate recorded yet.</span>'}</div></div>
        <div class="form-section"><h3>Active policies (${(policies.active || []).length}/${state.policySlots || 5})</h3><div style="display:grid;gap:10px;">
            ${(policies.available || []).map(policy => {
                const requirements = Object.entries(policy.requiredMandate || {}).map(([tag, value]) => `${tag} ${value}`).join(', ');
                const eligible = Object.entries(policy.requiredMandate || {}).every(([tag, value]) => Number(state.mandate?.[tag] || 0) >= Number(value));
                const isActive = activePolicyKeys.has(policy.key);
                return `<div class="asset-item" style="display:grid;gap:5px;"><div style="display:flex;justify-content:space-between;gap:8px;"><strong>${esc(policy.title)}</strong><span>${isActive ? 'Active' : eligible ? 'Eligible' : 'Locked'}</span></div><div style="color:#bbb;">${esc(policy.description)}</div><small>Requires: ${esc(requirements || 'None')} · Effect: ${esc(policy.effect?.key || 'government')}</small><button class="sf-btn ${isActive ? 'sf-btn-secondary' : 'sf-btn-primary'}" data-policy-key="${esc(policy.key)}" data-policy-active="${isActive ? '0' : '1'}" ${!eligible && !isActive ? 'disabled' : ''}>${isActive ? 'Deactivate' : 'Activate'}</button></div>`;
            }).join('') || '<p>No policy cards available.</p>'}
        </div></div>
    `;
    if (session) {
        const close = document.createElement('button');
        close.className = 'sf-btn sf-btn-danger';
        close.textContent = 'Close Senate Session';
        close.onclick = async () => {
            try { await SFApi.Senate.close(game.gameId); await game.loadGameState(); await showSenate(game); game.addLogEntry('Senate session closed.', 'success'); }
            catch (error) { UI.showAlert(error?.data?.error || error.message || 'Unable to close Senate session'); }
        };
        content.appendChild(close);
    }
    content.querySelectorAll('[data-assign-senator]').forEach(button => {
        button.onclick = async () => {
            const senatorId = Number(button.dataset.assignSenator);
            const stationId = Number(content.querySelector(`[data-assign-station="${senatorId}"]`)?.value);
            try { await SFApi.Senate.assign(game.gameId, senatorId, stationId); await game.loadGameState(); await showSenate(game); }
            catch (error) { UI.showAlert(error?.data?.error || error.message || 'Unable to reassign senator'); }
        };
    });
    content.querySelectorAll('[data-select-candidate]').forEach(button => {
        button.onclick = async () => {
            const candidateId = Number(button.dataset.selectCandidate);
            const stationId = Number(content.querySelector(`[data-candidate-station="${candidateId}"]`)?.value);
            const replace = content.querySelector(`[data-candidate-replace="${candidateId}"]`);
            try { await SFApi.Senate.select(game.gameId, candidateId, stationId, replace ? Number(replace.value) : null); await game.loadGameState(); await showSenate(game); }
            catch (error) { UI.showAlert(error?.data?.error || error.message || 'Unable to appoint senator'); }
        };
    });
    content.querySelectorAll('[data-policy-key]').forEach(button => {
        button.onclick = async () => {
            try { await SFApi.Senate.setPolicy(game.gameId, button.dataset.policyKey, button.dataset.policyActive === '1'); await game.loadGameState(); await showSenate(game); }
            catch (error) { UI.showAlert(error?.data?.error || error.message || 'Unable to update policy'); }
        };
    });
    return content;
}

export async function showSenate(game = window.gameClient) {
    if (!game?.gameId || !window.SFApi?.Senate) return;
    try {
        const state = await SFApi.Senate.state(game.gameId);
        UI.showModal({ title: '🏛️ Senate', content: renderState(game, state), actions: [{ text: 'Close', style: 'secondary', action: () => true }], className: 'senate-modal' });
    } catch (error) { UI.showAlert(error?.data?.error || error.message || 'Unable to load Senate state'); }
}

export function showSenateModal(game = window.gameClient) { return showSenate(game); }
export function loadSenateProgress() {}
export function saveSenateProgress() {}
export function setSenateProgress() {}
export function incrementSenateProgress() {}
export function applySenateProgressToUI() {}
