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

const SENATOR_PORTRAITS = [
    'administrator-veyra.png',
    'director-oran.png',
    'factor-ilyan.png',
    'warden-kest.png'
];

const SENATOR_PORTRAIT_BY_DEFINITION = {
    centralist_administrator: 'administrator-veyra.png',
    centralist_technocrat: 'director-oran.png',
    trade_magnate: 'factor-ilyan.png',
    frontier_raider: 'warden-kest.png',
    regional_humanist: 'administrator-veyra.png',
    frontier_technocrat: 'director-oran.png'
};

function senatorPortrait(definitionKey) {
    if (SENATOR_PORTRAIT_BY_DEFINITION[definitionKey]) return SENATOR_PORTRAIT_BY_DEFINITION[definitionKey];
    const key = String(definitionKey || 'unknown');
    let hash = 0;
    for (let index = 0; index < key.length; index += 1) hash = (hash * 31 + key.charCodeAt(index)) >>> 0;
    return SENATOR_PORTRAITS[hash % SENATOR_PORTRAITS.length];
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
    const replaceOptions = active.map(senator => `<option value="${senator.id}">${esc(senator.name)} · ${esc((senator.tags || []).join(', '))}</option>`).join('');
    const seatCards = Array.from({ length: 4 }, (_, index) => {
        const senator = active[index];
        const locked = index >= Number(state.seatCapacity || 0);
        if (!senator) return `<article class="senate-seat-card senate-seat-card--${locked ? 'locked' : 'vacant'}" aria-label="${locked ? 'Locked' : 'Vacant'} Senate seat ${index + 1}">
            <div class="senate-seat-placeholder"><span class="senate-seat-index">Seat ${index + 1}</span><strong>${locked ? 'Seat locked' : 'Vacant seat'}</strong><p>${locked ? 'Increase pilot capacity to unlock this cabinet seat.' : 'A future appointment can fill this seat during an open session.'}</p></div>
        </article>`;
        const happiness = Math.max(0, Math.min(100, Number(senator.happiness || 0)));
        const objective = objectiveBySenator.get(Number(senator.id));
        const events = objective?.events || [];
        const latest = events[events.length - 1];
        const portrait = senatorPortrait(senator.definitionKey);
        return `<article class="senate-seat-card" aria-label="${esc(senator.name)} Senate seat">
            <div class="senate-seat-head"><span class="senate-seat-index">Seat ${index + 1}</span><span class="senate-term">Term ${senator.termNumber || 1}/${senator.maxTerms || 4}</span></div>
            <div class="senate-portrait-wrap"><img class="senate-portrait" src="/assets/senators/${portrait}" alt="Portrait of ${esc(senator.name)}" loading="lazy"><div><h4>${esc(senator.name)}</h4><p class="senate-post">${esc(stationLabel(senator.station))}</p></div></div>
            <label class="senate-meter-label" for="senate-happiness-${senator.id}">Happiness <span>${happiness}/100</span></label><progress id="senate-happiness-${senator.id}" max="100" value="${happiness}">${happiness}%</progress>
            <div class="senate-tags">${(senator.tags || []).map(tag => `<span>${esc(tag)}</span>`).join('')}</div>
            ${objective ? `<div class="senate-objective"><strong>${esc(objective.title)}</strong><p>${esc(objective.description)}</p><small>${esc(objective.status)} · ${Number(objective.progress?.current || 0)}/${Number(objective.progress?.target || 1)} progress${latest ? ` · Turn ${latest.turnNumber}: ${esc(latest.summary)}` : ''}</small></div>` : '<p class="senate-muted">No active objective.</p>'}
        </article>`;
    }).join('');
    const sessionText = session ? `Open session · began turn ${session.openedTurn}. Appointments are available until you close this session.` : `No session is open. The next Senate session follows the shared 100-turn cadence; current turn ${state.currentTurn}.`;
    const naming = state.naming || {};
    const targets = naming.eligibleTargets || naming.eligibleNamingTargets || [];
    const proposals = naming.pendingProposals || [];
    const ledger = state.politicalCapitalLedger || [];
    const targetOptions = targets.map(target => `<option value="${esc(target.targetType)}:${esc(target.targetId)}">${esc(target.name || `${readableLabel(target.targetType)} ${target.targetId}`)}${target.sectorId ? ` · Sector ${esc(target.sectorId)}` : ''}</option>`).join('');
    const policyMarkup = Array.from({ length: 4 }, (_, index) => {
        const policy = (policies.active || [])[index];
        const unlocked = index < Number(state.policySlots || 1);
        if (!unlocked) return `<div class="senate-policy-slot senate-policy-slot--locked"><span>Slot ${index + 1}</span><strong>Locked</strong><small>Increase pilot capacity to unlock.</small></div>`;
        if (!policy) return `<div class="senate-policy-slot senate-policy-slot--empty"><span>Slot ${index + 1}</span><strong>Empty policy slot</strong><small>Activate an eligible policy below.</small></div>`;
        const atRisk = policy.status === 'at_risk';
        return `<div class="senate-policy-slot senate-policy-slot--${atRisk ? 'risk' : 'active'}"><span>Slot ${index + 1} · ${atRisk ? 'At risk' : 'Active'}</span><strong>${esc(policy.title || readableLabel(policy.key))}</strong><small>${atRisk ? 'Requirements are no longer met; effects are suspended.' : esc(policy.description || 'Policy effects are active.')}</small></div>`;
    }).join('');
    const allPolicies = (policies.available || []).map(policy => {
        const validStatuses = new Set(['active', 'eligible', 'locked', 'at_risk']);
        const legacyEligible = Object.entries(policy.requiredMandate || {}).every(([tag, value]) => Number(state.mandate?.[tag] || 0) >= Number(value));
        const status = validStatuses.has(policy.status) ? policy.status : policy.active === true || activePolicyKeys.has(policy.key) ? 'active' : policy.eligible === true || (policy.eligible == null && legacyEligible) ? 'eligible' : 'locked';
        const isActive = policy.active === true || activePolicyKeys.has(policy.key) || status === 'active';
        const canDeactivate = isActive || status === 'at_risk';
        const eligible = policy.eligible === true || (policy.eligible == null && status === 'eligible');
        const statusText = status === 'at_risk' ? 'At risk — effects suspended' : status === 'active' ? 'Active' : status === 'eligible' ? 'Eligible' : 'Locked';
        const requirements = formatMandateRequirements(policy);
        const unmet = formatUnmetRequirements(policy.unmetRequirements);
        const effect = formatEffect(policy.effect);
        const detailsId = `senate-policy-${String(policy.key || 'policy').replace(/[^a-zA-Z0-9_-]/g, '-')}`;
        return `<article class="senate-policy-card"><div class="senate-policy-card-head"><strong>${esc(policy.title || readableLabel(policy.key))}</strong><span role="status">${esc(statusText)}</span></div><p>${esc(policy.description || '')}</p><div id="${esc(detailsId)}" class="senate-policy-details"><small>Requirements: ${esc(requirements || 'None')}${unmet ? ` · Outstanding: ${esc(unmet)}` : ''}${effect ? ` · Effect: ${esc(effect)}` : ''}</small></div><button class="sf-btn ${canDeactivate ? 'sf-btn-secondary' : 'sf-btn-primary'}" data-policy-key="${esc(policy.key)}" data-policy-active="${canDeactivate ? '0' : '1'}" aria-describedby="${esc(detailsId)}" ${!canDeactivate && !eligible ? 'disabled' : ''}>${canDeactivate ? 'Deactivate' : 'Activate'}</button></article>`;
    }).join('') || '<p class="senate-muted">No policy cards are available.</p>';
    const content = document.createElement('div');
    content.className = 'senate-modal-content';
    content.innerHTML = `
        <section class="senate-command-hero" aria-labelledby="senate-command-title"><div><p class="eyebrow">Political command · turn ${esc(state.currentTurn || 1)}</p><h3 id="senate-command-title">The Senate</h3><p>${esc(sessionText)}</p></div><div class="senate-status-grid"><div><span>Influence</span><strong>${Math.round(state.institutionalInfluence || 0)}</strong></div><div><span>Capital</span><strong>${Math.round(state.politicalCapital || 0)}</strong></div><div><span>Seats</span><strong>${active.length}/4</strong></div></div></section>
        <section class="senate-section" aria-labelledby="senate-cabinet-title"><div class="senate-section-heading"><div><p class="eyebrow">Cabinet</p><h3 id="senate-cabinet-title">Four seats, one government</h3></div><span class="senate-capacity-note">${state.seatCapacity ?? 0} unlocked · ${state.pilotCapacity ?? 0} pilot capacity</span></div><div class="senate-seat-grid">${seatCards}</div>${former.length ? `<details class="senate-former"><summary>Former senators (${former.length})</summary>${former.map(senator => `<p><strong>${esc(senator.name)}</strong> · ${esc(senator.status)} · served ${senator.termNumber} term${senator.termNumber === 1 ? '' : 's'}</p>`).join('')}</details>` : ''}</section>
        ${session ? `<section class="senate-section senate-session-section" aria-labelledby="senate-session-title"><div class="senate-section-heading"><div><p class="eyebrow">100-turn cadence</p><h3 id="senate-session-title">Candidate appointments</h3></div><span class="senate-live-badge">Session active</span></div><p>Appointments and replacements are available only during this open session. Each senator needs a qualifying sun, planet, or moon station.</p><div class="senate-candidate-list">${candidates.map(candidate => `<article class="senate-candidate-card"><div class="senate-candidate-identity"><img src="/assets/senators/${senatorPortrait(candidate.definitionKey)}" alt="" loading="lazy"><div><strong>${esc(candidate.name)}</strong><span>${esc((candidate.tags || []).join(' · '))}</span><small>Preferred post: ${esc(candidate.stationClass)}</small></div></div><label>Hosting station<select aria-label="Hosting station for ${esc(candidate.name)}" data-candidate-station="${candidate.id}">${stationOptions(state)}</select></label><label>Appointment type<select aria-label="Senator to replace with ${esc(candidate.name)}" data-candidate-replace="${candidate.id}"><option value="">Fill vacant seat</option>${replaceOptions}</select></label><button class="sf-btn sf-btn-primary" data-select-candidate="${candidate.id}" ${candidate.selected ? 'disabled' : ''}>${candidate.selected ? 'Appointed' : 'Appoint'}</button></article>`).join('') || '<p class="senate-muted">No candidates available.</p>'}</div><button class="sf-btn sf-btn-danger" data-close-senate>Close Senate session</button></section>` : ''}
        <section class="senate-section" aria-labelledby="senate-policy-title"><div class="senate-section-heading"><div><p class="eyebrow">Mandate and loadout</p><h3 id="senate-policy-title">Active policy slots</h3></div><span class="senate-capacity-note">${(policies.active || []).length}/${state.policySlots || 1} active</span></div><div class="senate-policy-slots">${policyMarkup}</div><details class="senate-policy-disclosure"><summary>View all policy cards</summary><div class="senate-policy-catalog">${allPolicies}</div></details><div class="senate-mandate-row">${Object.entries(state.mandate || {}).map(([tag, value]) => `<span>${esc(tag)} <strong>${Math.round(value)}</strong></span>`).join('') || '<span>No mandate recorded yet.</span>'}</div></section>
        <section class="senate-section senate-agenda" aria-labelledby="senate-agenda-title">
            <div class="senate-section-heading"><div><p class="eyebrow">Agenda / voting</p><h3 id="senate-agenda-title">Upcoming agenda</h3></div><button class="sf-btn sf-btn-primary" type="button" data-open-proposal-menu>Add a proposal</button></div>
            <p>Docketed items appear here before their voting window. Voting rules are still being defined, so this view previews the agenda without offering placeholder votes.</p>
            <div class="senate-proposals">${proposals.map(proposal => `<article class="senate-proposal"><strong>${esc(proposal.proposedName)}</strong><span>${esc(proposal.target?.previousName || proposal.currentName || 'Unnamed target')} · ${esc(proposal.status || 'pending')}</span><small>Naming proposal · submitted turn ${esc(proposal.submittedTurn ?? '—')} · cost ${esc(proposal.capitalCost ?? naming.proposalCost ?? 2)} capital</small></article>`).join('') || '<p class="senate-muted">No items are currently docketed for a future vote.</p>'}</div>
            ${ledger.length ? `<details class="senate-ledger"><summary>Recent capital ledger</summary>${ledger.slice(0, 6).map(entry => `<p><strong>${Number(entry.amount) >= 0 ? '+' : ''}${Number(entry.amount)}</strong> ${esc(entry.sourceType || entry.entryType || 'capital event')} · turn ${esc(entry.turnNumber ?? '—')}</p>`).join('')}</details>` : ''}
            <dialog class="senate-proposal-dialog" data-proposal-dialog aria-labelledby="senate-proposal-dialog-title">
                <div class="senate-proposal-dialog-head"><div><p class="eyebrow">Political action</p><h3 id="senate-proposal-dialog-title">Add a proposal</h3></div><button class="senate-dialog-close" type="button" data-close-proposal-menu aria-label="Close proposal menu">×</button></div>
                <div class="senate-proposal-types" data-proposal-types>
                    <button class="senate-proposal-type" type="button" data-proposal-type="naming"><strong>Civic naming</strong><span>Name a discovered sun, planet, moon, asteroid belt, or solar system.</span><small>${Number(naming.proposalCost ?? 2)} political capital</small></button>
                    <button class="senate-proposal-type" type="button" disabled><strong>Regional measure</strong><span>Shape a shared local rule or compact.</span><small>Future proposal family</small></button>
                    <button class="senate-proposal-type" type="button" disabled><strong>Galactic law</strong><span>Bring a universal rule to the wider electorate.</span><small>Future proposal family</small></button>
                </div>
                <div class="senate-proposal-editor" data-proposal-editor hidden>
                    <button class="senate-text-button" type="button" data-back-proposal-types>← Proposal types</button>
                    <div><p class="eyebrow">Civic naming</p><h4>Propose an official name</h4><p>Select a target you have previously discovered. Submission places the name on the future agenda; it does not enact the name.</p></div>
                    <form class="senate-naming-form" data-naming-form><label for="senate-naming-target">Target<select id="senate-naming-target" name="target" required>${targetOptions || '<option value="">No eligible targets</option>'}</select></label><label for="senate-proposed-name">Proposed name<input id="senate-proposed-name" name="proposedName" maxlength="80" required placeholder="Enter a civic name"></label><button class="sf-btn sf-btn-primary" type="submit" ${targetOptions ? '' : 'disabled'}>Submit proposal</button></form>
                    <p class="senate-form-note" role="status">Cost: exactly ${Number(naming.proposalCost ?? 2)} political capital · Current balance: ${Math.round(state.politicalCapital || 0)}</p>
                </div>
            </dialog>
        </section>
    `;
    content.querySelector('[data-close-senate]')?.addEventListener('click', async () => {
        try { await SFApi.Senate.close(game.gameId); await game.loadGameState(); await showSenate(game); game.addLogEntry('Senate session closed.', 'success'); }
        catch (error) { UI.showAlert(error?.data?.error || error.message || 'Unable to close Senate session'); }
    });
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
    const proposalDialog = content.querySelector('[data-proposal-dialog]');
    const proposalTypes = content.querySelector('[data-proposal-types]');
    const proposalEditor = content.querySelector('[data-proposal-editor]');
    const resetProposalDialog = () => {
        if (proposalTypes) proposalTypes.hidden = false;
        if (proposalEditor) proposalEditor.hidden = true;
    };
    content.querySelector('[data-open-proposal-menu]')?.addEventListener('click', () => {
        resetProposalDialog();
        if (typeof proposalDialog?.showModal === 'function') proposalDialog.showModal();
        else proposalDialog?.setAttribute('open', '');
        proposalDialog?.querySelector('[data-proposal-type="naming"]')?.focus();
    });
    content.querySelector('[data-close-proposal-menu]')?.addEventListener('click', () => {
        if (typeof proposalDialog?.close === 'function') proposalDialog.close();
        else proposalDialog?.removeAttribute('open');
    });
    content.querySelector('[data-proposal-type="naming"]')?.addEventListener('click', () => {
        if (proposalTypes) proposalTypes.hidden = true;
        if (proposalEditor) proposalEditor.hidden = false;
        proposalEditor?.querySelector('select, input, button')?.focus();
    });
    content.querySelector('[data-back-proposal-types]')?.addEventListener('click', () => {
        resetProposalDialog();
        proposalDialog?.querySelector('[data-proposal-type="naming"]')?.focus();
    });
    proposalDialog?.addEventListener('close', resetProposalDialog);
    proposalDialog?.addEventListener('click', event => {
        if (event.target !== proposalDialog) return;
        if (typeof proposalDialog.close === 'function') proposalDialog.close();
        else proposalDialog.removeAttribute('open');
    });
    content.querySelector('[data-naming-form]')?.addEventListener('submit', async event => {
        event.preventDefault();
        const form = event.currentTarget;
        const [targetType, targetId] = String(new FormData(form).get('target') || '').split(':');
        const proposedName = String(new FormData(form).get('proposedName') || '').trim();
        const cost = Number(naming.proposalCost ?? 2);
        if (!targetType || !targetId || !proposedName) return;
        if (cost !== 2) { UI.showAlert('Senate naming proposals must cost exactly 2 political capital.'); return; }
        if (!window.confirm(`Submit “${proposedName}” for a future Senate vote? This costs exactly 2 political capital.`)) return;
        const requestId = globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `senate-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const submit = form.querySelector('button[type="submit"]');
        submit.disabled = true;
        try { await SFApi.Senate.proposeName(game.gameId, targetType, Number(targetId), proposedName, requestId); await game.loadGameState(); await showSenate(game); game.addLogEntry('Naming proposal submitted for a future Senate vote.', 'success'); }
        catch (error) { submit.disabled = false; UI.showAlert(error?.data?.error || error.message || 'Unable to submit naming proposal'); }
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
