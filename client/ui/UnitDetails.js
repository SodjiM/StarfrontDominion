// Unit Details panel: pure view builder. Emits callbacks for actions.

import * as SFCargo from '../features/cargo.js';

export function renderUnitDetails(game, unit, options = {}) {
    const detailsContainer = document.getElementById('unitDetails');
    if (!detailsContainer) return;

    if (!unit) {
        detailsContainer.innerHTML = '<div style="text-align: center; color: #666; padding: 20px;">Select a unit to view details</div>';
        return;
    }

    const meta = unit.meta || {};
    const { turnLocked, gameState } = game;
    const canMine = (unit.type === 'ship') && ((meta && meta.canMine === true) || (meta && meta.canMine === undefined && (Number(meta.harvestRate) > 0)));

    const abilityButtons = [];
    const passiveChips = [];
    const abilities = Array.isArray(meta.abilities) ? meta.abilities : [];
    const abilityDefs = window.AbilityDefs || {};
    abilities.forEach(key => {
        const def = abilityDefs[key];
        if (!def) return;
        const cdText = def.cooldown ? `, CD ${def.cooldown}` : '';
        const energyText = def.energyCost ? `, ⚡${def.energyCost}` : '';
        if (def.type === 'passive') {
            passiveChips.push(`<span class="chip" title="${def.description || ''}">${def.name}</span>`);
        } else {
            const disabled = turnLocked ? 'disabled' : '';
            abilityButtons.push(`<button class="sf-btn sf-btn-secondary" data-ability="${key}" ${disabled} title="${def.description || ''}">${def.name}${energyText}${cdText}</button>`);
        }
    });

    detailsContainer.innerHTML = `
        <div class="unit-info">
            <h3 style="color: #64b5f6; margin-bottom: 15px;">
                ${game.getUnitIcon(unit.type)} ${meta.name || unit.type}
            </h3>
            <div class="stat-item"><span>Position:</span><span>(${unit.x}, ${unit.y})</span></div>
            ${meta.movementSpeed ? `<div class="stat-item"><span>Movement:</span><span>${game.getEffectiveMovementSpeed(unit)} tiles/turn</span></div>` : ''}
            ${meta.scanRange ? `<div class="stat-item"><span>Scan Range:</span><span>${game.getEffectiveScanRange(unit)}</span></div>` : ''}
            ${meta.energy !== undefined ? `<div class="stat-item"><span>⚡ Energy:</span><span>${meta.energy}/${meta.maxEnergy || meta.energy} (+${meta.energyRegen || 0}/turn)</span></div>` : ''}
            ${meta.cargoCapacity ? `<div class="stat-item"><span>📦 Cargo:</span><span id="cargoStatus">Loading...</span></div>` : ''}
        </div>
        <div style="margin-top: 20px;">
            ${unit.type === 'ship' ? `
                <button class="sf-btn sf-btn-secondary" data-action="set-move-mode" ${turnLocked ? 'disabled' : ''}>🎯 Set Destination</button>
                <button class="sf-btn sf-btn-secondary" data-action="set-warp-mode" ${turnLocked ? 'disabled' : ''}>🌌 Warp</button>
                <button class="sf-btn sf-btn-secondary" id="mineBtn" data-action="toggle-mining" ${turnLocked || !canMine ? 'disabled' : ''}>${unit.harvestingStatus === 'active' ? '🛑 Stop Mining' : (canMine ? '⛏️ Mine' : '⛏️ Mine (N/A)')}</button>
                <button class="sf-btn sf-btn-secondary" data-action="show-cargo" ${turnLocked ? 'disabled' : ''}>📦 Cargo</button>
            ` : ''}
            ${(unit.type === 'station') ? `
                <button class="sf-btn sf-btn-secondary" data-action="show-build" ${turnLocked ? 'disabled' : ''}>🏗️ Build</button>
                <button class="sf-btn sf-btn-secondary" data-action="show-cargo">📦 Cargo</button>
            ` : ''}
            ${unit.type === 'ship' ? `
                <div class="panel-title" style="margin:16px 0 0 0;">🛠️ Abilities</div>
                <div id="abilityButtons" style="display:flex; flex-wrap:wrap; gap:8px;">${abilityButtons.join('') || '<span style="color:#888">No abilities</span>'}</div>
                <div class="panel-title" style="margin:16px 0 0 0; display:flex; align-items:center; gap:6px;">🧭 Queue</div>
                <div id="queueLog" class="activity-log" style="max-height:120px; min-height:60px;"></div>
            ` : ''}
        </div>
    `;

    const unitPanel = detailsContainer;
    if (unitPanel) {
        unitPanel.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-action]');
            if (!btn) return;
            const action = btn.dataset.action;
            options.onAction && options.onAction(action);
        });
    }

    if (unit && unit.meta && unit.meta.cargoCapacity) {
        try { SFCargo.updateCargoStatus(unit.id); } catch {}
    }
}


