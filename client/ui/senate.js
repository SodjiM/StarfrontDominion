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

function readableLabel(value) {
    return String(value ?? '').replace(/[_-]+/g, ' ').replace(/\b\w/g, character => character.toUpperCase());
}

function formatRequirement(value, fallbackLabel = 'Requirement') {
    if (value == null || value === '') return '';
    if (typeof value !== 'object') return `${fallbackLabel}: ${value}`;
    if (Array.isArray(value)) return value.map(item => formatRequirement(item, fallbackLabel)).filter(Boolean).join('; ');
    const label = value.label || value.title || value.name || value.tag || value.key || fallbackLabel;
    const minimum = value.minimum ?? value.required ?? value.min ?? value.value ?? value.happiness;
    if (minimum != null && typeof minimum !== 'object') return `${label}: ${minimum}`;
    return Object.entries(value).map(([key, item]) => formatRequirement(item, readableLabel(key))).filter(Boolean).join('; ');
}

function formatMandateRequirements(policy) {
    const mandate = policy.requiredMandate || policy.requirements?.mandate || policy.requirements?.mandates;
    if (!mandate) return '';
    return formatRequirement(mandate, 'Mandate');
}

function formatEffect(effect) {
    if (!effect) return '';
    if (typeof effect !== 'object') return String(effect);
    const name = effect.title || effect.label || effect.key || effect.name;
    let value = effect.value ?? effect.amount;
    if (typeof value === 'number' && Math.abs(value) < 1) value = `${value < 0 ? '' : '+'}${Math.round(value * 100)}%`;
    const modifiers = Object.entries(effect.modifiers || {}).map(([key, modifier]) => {
        const rendered = typeof modifier === 'number' && Math.abs(modifier) < 1
            ? `${modifier < 0 ? '' : '+'}${Math.round(modifier * 100)}%`
            : modifier;
        return `${readableLabel(key)} ${rendered}`;
    }).join(', ');
    const effectText = [[name && readableLabel(name), value != null && value !== '' ? value : ''].filter(Boolean).join(' '), modifiers].filter(Boolean).join(' · ');
    const tradeoff = effect.tradeoff || effect.downside || effect.cost;
    return `${effectText}${tradeoff ? ` · Tradeoff: ${formatRequirement(tradeoff, '')}` : ''}`;
}

function formatUnmetRequirements(requirements) {
    if (!Array.isArray(requirements) || !requirements.length) return '';
    return requirements.map(requirement => {
        if (typeof requirement !== 'object') return String(requirement);
        if (requirement.type === 'mandate') return `${requirement.tag || 'Tag'} mandate: ${requirement.actual || 0}/${requirement.required || 0}`;
        if (requirement.type === 'capacity') return `Policy capacity: ${requirement.actual || 0}/${requirement.required || 0} selected slots supported`;
        const label = requirement.label || requirement.title || requirement.name || requirement.key || requirement.type || 'Requirement';
        const current = requirement.current ?? requirement.actual;
        const required = requirement.required ?? requirement.minimum ?? requirement.min;
        if (current != null && required != null) return `${label}: ${current}/${required}`;
        return formatRequirement(requirement, readableLabel(label));
    }).filter(Boolean).join('; ');
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
    const former = senators.filter(senator => senator.status !== 'active');
    const replaceOptions = active.map(senator => `<option value="${senator.id}">${esc(senator.name)} · ${esc(senator.tags.join(', '))}</option>`).join('');
    const sessionText = session
        ? `Session opened on turn ${session.openedTurn}. It remains available until concluded; missed sessions do not stack.`
        : `Next Senate session opens on the shared 100-turn cadence. Current turn: ${state.currentTurn}.`;
    const content = document.createElement('div');
    content.className = 'senate-modal-content';
    content.innerHTML = `
        <div class="form-section">
            <p>${esc(sessionText)}</p>
            <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:10px 0;">
                <div class="asset-item"><strong>Institutional influence</strong><br>${Math.round(state.institutionalInfluence || 0)}</div>
                <div class="asset-item"><strong>Policy slots</strong><br>${state.policySlots || 1}/4</div>
                <div class="asset-item"><strong>Political capital</strong><br>${Math.round(state.politicalCapital || 0)}</div>
            </div>
        </div>
        <div class="form-section">
            <h3>Active senators (${active.length}/${state.seatCapacity ?? 1})</h3>
            <p>Senate capacity is supported by ${state.pilotCapacity ?? 0} pilot capacity and ${state.stations?.length || 0} qualifying station${state.stations?.length === 1 ? '' : 's'}; the current cabinet limit is ${state.maxSenators || 4}.</p>
            <div style="display:grid;gap:10px;">
                ${active.map(senator => {
                    const objective = objectiveBySenator.get(Number(senator.id));
                    const objectiveEvents = objective?.events || [];
                    const latestObjectiveEvent = objectiveEvents[objectiveEvents.length - 1];
                    return `<div class="asset-item" style="display:grid;gap:6px;">
                        <div style="display:flex;justify-content:space-between;gap:10px;"><strong>${esc(senator.name)}</strong><span>Term ${senator.termNumber}/4 · Happiness ${senator.happiness}</span></div>
                        <div style="color:#aaa;">${esc(senator.tags.join(' · '))}</div>
                        <div style="color:#bbb;">Post: ${esc(stationLabel(senator.station))}</div>
                        ${objective ? `<div style="color:#d7c5ff;"><strong>${esc(objective.title)}</strong> — ${esc(objective.description)}<br><small>Status: ${esc(objective.status)} · Progress: ${Number(objective.progress?.current || 0)}/${Number(objective.progress?.target || 1)}</small>${latestObjectiveEvent ? `<div role="status" style="color:#bbb;margin-top:4px;"><small>Latest progress, turn ${latestObjectiveEvent.turnNumber}: ${esc(latestObjectiveEvent.summary)}</small></div>` : ''}</div>` : ''}
                    </div>`;
                }).join('') || '<p>No senator is currently assigned. Establish a qualifying station to begin.</p>'}
            </div>
            ${former.length ? `<details style="margin-top:10px;"><summary>Former senators (${former.length})</summary><div style="display:grid;gap:8px;margin-top:8px;">${former.map(senator => `<div class="asset-item"><strong>${esc(senator.name)}</strong> · ${esc(senator.status)} · served ${senator.termNumber} term${senator.termNumber === 1 ? '' : 's'}</div>`).join('')}</div></details>` : ''}
        </div>
        ${session ? `<div class="form-section"><h3>Candidate appointments</h3><p>Each senator requires a sun, planet, or moon station. A new appointment fills an unlocked vacancy; replacing a senator ends their service and transfers the selected post to the newcomer.</p><div style="display:grid;gap:10px;">
            ${candidates.map(candidate => `<div class="asset-item" style="display:grid;gap:6px;"><div><strong>${esc(candidate.name)}</strong> <span style="color:#aaa;">${esc(candidate.tags.join(' · '))}</span></div><div style="color:#bbb;">Preferred post: ${esc(candidate.stationClass)}</div><div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;"><label>Hosting station <select aria-label="Hosting station for ${esc(candidate.name)}" data-candidate-station="${candidate.id}">${stationOptions(state)}</select></label><label>Appointment type <select aria-label="Senator to replace with ${esc(candidate.name)}" data-candidate-replace="${candidate.id}"><option value="">Fill vacant seat</option>${replaceOptions}</select></label><button class="sf-btn sf-btn-primary" data-select-candidate="${candidate.id}" ${candidate.selected ? 'disabled' : ''}>${candidate.selected ? 'Appointed' : 'Appoint'}</button></div></div>`).join('') || '<p>No candidates available.</p>'}
        </div></div>` : ''}
        <div class="form-section"><h3>Tag mandate</h3><p>Senator happiness changes how much mandate each senator contributes. Policy eligibility uses these combined mandate totals; happiness is not a separate policy requirement.</p><div style="display:flex;gap:8px;flex-wrap:wrap;">${Object.entries(state.mandate || {}).map(([tag, value]) => `<span class="asset-item">${esc(tag)}: ${Math.round(value)}</span>`).join('') || '<span>No mandate recorded yet.</span>'}</div></div>
        <div class="form-section"><h3>Policies (${(policies.active || []).length}/${state.policySlots || 1})</h3><div style="display:grid;gap:10px;">
            ${(policies.available || []).map(policy => {
                const validStatuses = new Set(['active', 'eligible', 'locked', 'at_risk']);
                const legacyEligible = Object.entries(policy.requiredMandate || {}).every(([tag, value]) => Number(state.mandate?.[tag] || 0) >= Number(value));
                const status = validStatuses.has(policy.status)
                    ? policy.status
                    : policy.active === true || activePolicyKeys.has(policy.key)
                        ? 'active'
                        : policy.eligible === true || (policy.eligible == null && legacyEligible) ? 'eligible' : 'locked';
                const isActive = policy.active === true || activePolicyKeys.has(policy.key) || status === 'active';
                const atRisk = status === 'at_risk';
                const canDeactivate = isActive || atRisk;
                const eligible = policy.eligible === true || (policy.eligible == null && status === 'eligible');
                const statusText = atRisk ? 'At risk — effects suspended' : status === 'active' ? 'Active' : status === 'eligible' ? 'Eligible' : 'Locked';
                const requirements = formatMandateRequirements(policy);
                const unmet = formatUnmetRequirements(policy.unmetRequirements);
                const effect = formatEffect(policy.effect);
                const tradeoff = policy.tradeoff && !policy.effect?.tradeoff ? `Tradeoff: ${formatRequirement(policy.tradeoff, '')}` : '';
                const detailsId = `senate-policy-${String(policy.key || 'policy').replace(/[^a-zA-Z0-9_-]/g, '-')}`;
                return `<div class="asset-item" style="display:grid;gap:5px;"><div style="display:flex;justify-content:space-between;gap:8px;"><strong>${esc(policy.title || readableLabel(policy.key))}</strong><span role="status" aria-label="Policy status: ${esc(statusText)}">${esc(statusText)}</span></div><div style="color:#bbb;">${esc(policy.description || '')}</div>${policy.category ? `<small>Category: ${esc(readableLabel(policy.category))}</small>` : ''}<div id="${esc(detailsId)}"><small>Requirements: ${esc(requirements || 'None')}</small>${unmet ? `<small style="display:block;color:#f0c674;">Outstanding: ${esc(unmet)}</small>` : ''}${effect || tradeoff ? `<small style="display:block;">Effect: ${esc(effect || 'None')}${tradeoff ? ` · ${esc(tradeoff)}` : ''}</small>` : ''}${policy.activatedTurn != null ? `<small style="display:block;">Activated on turn ${esc(policy.activatedTurn)}</small>` : ''}</div><button class="sf-btn ${canDeactivate ? 'sf-btn-secondary' : 'sf-btn-primary'}" data-policy-key="${esc(policy.key)}" data-policy-active="${canDeactivate ? '0' : '1'}" aria-describedby="${esc(detailsId)}" ${!canDeactivate && !eligible ? 'disabled' : ''}>${canDeactivate ? 'Deactivate' : 'Activate'}</button></div>`;
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
    content.querySelectorAll('[data-select-candidate]').forEach(button => {
        button.onclick = async () => {
            const candidateId = Number(button.dataset.selectCandidate);
            const stationId = Number(content.querySelector(`[data-candidate-station="${candidateId}"]`)?.value);
            const replace = content.querySelector(`[data-candidate-replace="${candidateId}"]`);
            try { await SFApi.Senate.select(game.gameId, candidateId, stationId, replace?.value ? Number(replace.value) : null); await game.loadGameState(); await showSenate(game); }
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
