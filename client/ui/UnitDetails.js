// Unit Details panel: pure view builder. Emits callbacks for actions.

import * as UICargo from './cargo-modal.js';
import { isAdjacentToInterstellarGate, travelThroughInterstellarGate } from '../features/warp.js';
import { computeRemainingTurns } from '../utils/turns.js';
import { escapeAttr } from '../utils/dom.js';

export function renderUnitDetails(game, unit, options = {}) {
    const detailsContainer = document.getElementById('unitDetails');
    if (!detailsContainer) return;

    if (!unit) {
        detailsContainer.innerHTML = '<div style="text-align: center; color: #666; padding: 20px;">Select a unit to view details</div>';
        return;
    }

    const meta = unit.meta || {};
    const { turnLocked, gameState } = game;
    // Mining is now ability-driven

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

    const iconHtml = game.getUnitIcon(unit);
    const adjacentGate = (unit.type === 'ship') && isAdjacentToInterstellarGate(game, unit);
    detailsContainer.innerHTML = `
        <div class="unit-info">
            <h3 style="color: #64b5f6; margin-bottom: 15px;">
                ${iconHtml} ${meta.name || unit.type}
            </h3>
            <div class="stat-item"><span>Position:</span><span>(${unit.x}, ${unit.y})</span></div>
            ${meta.movementSpeed ? `<div class=\"stat-item\"><span>Movement:</span><span id=\"movementStat\">${(()=>{ try { if (unit?.meta?.travelMode) { const v = unit?.meta?.warpTPT; return v?`${v} tiles/turn (warp)`: `${game.getEffectiveMovementSpeed({ ...unit, statusEffects: unit.statusEffects || [] })} tiles/turn`; } } catch {} return `${game.getEffectiveMovementSpeed({ ...unit, statusEffects: unit.statusEffects || [] })} tiles/turn`; })()}</span></div>` : ''}
            ${meta.scanRange ? `<div class=\"stat-item\"><span>Scan Range:</span><span>${game.getEffectiveScanRange(unit)}</span></div>` : ''}
            ${(typeof meta.hp === 'number' || typeof meta.maxHp === 'number') ? `<div class=\"stat-item\"><span>HP:</span><span>${(typeof meta.hp === 'number' ? meta.hp : (typeof meta.maxHp === 'number' ? meta.maxHp : '?'))}${(typeof meta.maxHp === 'number' ? ` / ${meta.maxHp}` : '')}</span></div>` : ''}
            ${(typeof meta.energy === 'number' || typeof meta.maxEnergy === 'number') ? `<div class=\"stat-item\"><span>⚡ Energy:</span><span>${(typeof meta.energy === 'number' ? meta.energy : (typeof meta.maxEnergy === 'number' ? meta.maxEnergy : 0))}${(typeof meta.maxEnergy === 'number' ? ` / ${meta.maxEnergy}` : '')} ${meta.energyRegen ? `( +${meta.energyRegen}/turn )` : ''}</span></div>` : ''}
            ${meta.cargoCapacity ? `<div class=\"stat-item\"><span>📦 Cargo:</span><span id=\"cargoStatus\">Loading...</span></div>` : ''}
            ${renderActiveEffectsChip(game, unit)}
        </div>
        <div style="margin-top: 20px;">
            ${unit.type === 'ship' ? `
                <button class="sf-btn sf-btn-secondary" data-action="set-warp-mode" ${turnLocked ? 'disabled' : ''}>🌌 Warp</button>
                <button class="sf-btn sf-btn-secondary" data-action="interstellar-travel" ${turnLocked || !adjacentGate ? 'disabled' : ''} title="Use adjacent interstellar gate">🌀 Gate</button>
                
                <button class="sf-btn sf-btn-secondary" data-action="show-cargo" ${turnLocked ? 'disabled' : ''}>📦 Cargo</button>
            ` : ''}
            ${(unit.type === 'station') ? `
                <button class="sf-btn sf-btn-secondary" data-action="show-build" ${turnLocked ? 'disabled' : ''}>🏗️ Build</button>
                <button class="sf-btn sf-btn-secondary" data-action="show-cargo">📦 Cargo</button>
            ` : ''}
            ${unit.type === 'ship' ? `
                <div class="panel-title" style="margin:16px 0 0 0; display:flex; align-items:center; gap:6px;">
                    🛠️ Abilities
                </div>
                <div id="abilityButtons" style="display:flex; flex-wrap:wrap; gap:8px;">${abilityButtons.join('') || '<span style="color:#888">No abilities</span>'}</div>
                <div class="panel-title" style="margin:16px 0 0 0; display:flex; align-items:center; gap:6px;">
                    🧭 Queue
                    <span style="flex:1"></span>
                    <button class="sf-btn sf-btn-xs" data-action="queue-refresh" title="Refresh queue">↻</button>
                    <button class="sf-btn sf-btn-xs" data-action="queue-clear" title="Clear queue">Clear</button>
                </div>
                <div id="queueLog" class="activity-log" style="max-height:120px; min-height:60px;"></div>
            ` : ''}
        </div>
    `;

    const unitPanel = detailsContainer;
    if (unitPanel) {
        // Avoid stacking multiple listeners across re-renders
        try { if (unitPanel.__unitDetailsClickHandler) unitPanel.removeEventListener('click', unitPanel.__unitDetailsClickHandler); } catch {}
        unitPanel.__unitDetailsClickHandler = (e) => {
            const abBtn = e.target.closest('button[data-ability]');
            if (abBtn) {
                const key = abBtn.getAttribute('data-ability');
                try {
                    game.queueAbility && game.queueAbility(key);
                    // Refresh movement stat generically from computed selector
                    setTimeout(() => {
                        try {
                            const el = document.getElementById('movementStat');
                            if (el) el.textContent = `${game.getEffectiveMovementSpeed(game.selectedUnit)} tiles/turn`;
                        } catch {}
                    }, 0);
                } catch {}
                return;
            }
            const btn = e.target.closest('[data-action]');
            if (!btn) return;
            const action = btn.dataset.action;
            if (action === 'interstellar-travel') {
                try { travelThroughInterstellarGate(game); } catch {}
                return; // handled directly
            }
            options.onAction && options.onAction(action);
        };
        unitPanel.addEventListener('click', unitPanel.__unitDetailsClickHandler);
    }

    if (unit && unit.meta && unit.meta.cargoCapacity) {
        try { UICargo.updateCargoStatus(game, unit.id); } catch {}
    }

    // Populate queue and apply cooldowns
    if (unit && unit.type === 'ship') {
        try { game.loadQueueLog && game.loadQueueLog(unit.id); } catch {}
        try {
            if (window.SFApi && game.selectedUnit) {
                SFApi.Abilities.cooldowns(game.selectedUnit.id)
                    .then(data => {
                        const cooldowns = new Map((data.cooldowns || []).map(c => [c.ability_key, c.available_turn]));
                        const currentTurn = game.gameState?.currentTurn?.turn_number || 1;
                        const container = document.getElementById('abilityButtons');
                        if (!container) return;
                        container.querySelectorAll('button[data-ability]').forEach(btn => {
                            const key = btn.getAttribute('data-ability');
                            const available = cooldowns.get(key);
                            if (available && Number(available) > Number(currentTurn)) {
                                btn.disabled = true;
                                btn.classList.add('sf-btn-disabled');
                                btn.title = (btn.title || '') + ` (Cooldown: ready on turn ${available})`;
                            }
                        });
                        // Bind ability click handlers once
                        container.querySelectorAll('button[data-ability]').forEach(btn => {
                            if (!btn._sfBound) {
                                btn._sfBound = true;
                                btn.addEventListener('click', (ev) => {
                                    const key = ev.currentTarget.getAttribute('data-ability');
                                    try {
                                        game.queueAbility && game.queueAbility(key);
                                        // Optimistic UI: if Boost Engines or Microthruster, reflect movement now
                                        if (key === 'boost_engines' || key === 'microthruster_shift') {
                                            setTimeout(() => {
                                                try {
                                                    const el = document.getElementById('movementStat');
                                                    if (el) el.textContent = `${game.getEffectiveMovementSpeed(game.selectedUnit)} tiles/turn`;
                                                } catch {}
                                            }, 0);
                                        }
                                    } catch {}
                                });
                            }
                        });
                    })
                    .catch(()=>{});
            }
        } catch {}
    }
}

export function getStatusLabel(statusKey) {
    switch (statusKey) {
        case 'attacking': return '⚔️ Attacking';
        case 'stealthed': return '🕶️ Stealthed';
        case 'scanning': return '🔍 Scanning';
        case 'lowFuel': return '⛽ Low Fuel';
        case 'constructing': return '🛠️ Constructing';
        case 'moving': return '➜ Moving';
        case 'mining': return '⛏️ Mining';
        case 'docked': return '⚓ Docked';
        default: return 'Idle';
    }
}

export function getStatusClass(statusKey) {
    switch (statusKey) {
        case 'attacking': return 'status-attacking';
        case 'stealthed': return 'status-stealthed';
        case 'scanning': return 'status-scanning';
        case 'lowFuel': return 'status-lowFuel';
        case 'constructing': return 'status-constructing';
        case 'moving': return 'status-moving';
        case 'mining': return 'status-mining';
        case 'docked': return 'status-docked';
        default: return 'status-idle';
    }
}

export function renderActiveEffectsChip(game, unit) {
    try {
        const meta = unit.meta || {};
        const currentTurn = game.gameState?.currentTurn?.turn_number || 0;
        const list = [];
        if (Array.isArray(unit.statusEffects) && unit.statusEffects.length > 0) {
            for (const eff of unit.statusEffects) {
                const data = eff.effectData || {};
                const until = computeRemainingTurns(eff.expiresTurn, currentTurn);
                if (eff.effectKey === 'microthruster_speed' || typeof data.movementFlatBonus === 'number') {
                    const amt = data.movementFlatBonus ?? 3; list.push({ name: '+Move', desc: `+${amt} tiles`, turns: until, source: 'Microthruster Shift' });
                }
                if (eff.effectKey === 'emergency_discharge_buff' || typeof data.evasionBonus === 'number') {
                    const pct = Math.round((data.evasionBonus ?? 0.5) * 100); list.push({ name: 'Evasion', desc: `+${pct}%`, turns: until, source: 'Emergency Discharge Vent' });
                }
                if (eff.effectKey === 'engine_boost' || typeof data.movementBonus === 'number') {
                    const pct = Math.round((data.movementBonus ?? 1.0) * 100); list.push({ name: 'Speed', desc: `+${pct}%`, turns: until, source: 'Engine Boost' });
                }
                if (eff.effectKey === 'repair_over_time' || typeof data.healPercentPerTurn === 'number') {
                    const pct = Math.round((data.healPercentPerTurn ?? 0.05) * 100); list.push({ name: 'Regen', desc: `${pct}%/turn`, turns: until, source: 'Jury-Rig Repair' });
                }
                if (eff.effectKey === 'survey_scanner' || typeof data.scanRangeMultiplier === 'number') {
                    const mult = data.scanRangeMultiplier ?? 2; list.push({ name: 'Scan', desc: `x${mult}`, turns: until, source: 'Survey Scanner' });
                }
                if (eff.effectKey === 'evasion_boost') {
                    const pct = Math.round((data.evasionBonus ?? 0.8) * 100); list.push({ name: 'Evasion', desc: `+${pct}%`, turns: until, source: 'Phantom Burn' });
                }
                if (eff.effectKey === 'accuracy_debuff') {
                    const pct = Math.round((data.magnitude ?? eff.magnitude ?? 0.2) * 100); list.push({ name: 'Accuracy', desc: `-${pct}%`, turns: until, source: 'Quarzon Micro-Missiles' });
                }
            }
        }
        if (Array.isArray(meta.abilities) && meta.abilities.includes('solo_miners_instinct')) {
            list.push({ name: '+Move', desc: "+1 tile (Solo Miner's Instinct)", turns: 1, source: 'Passive' });
        }
        if (typeof meta.movementBoostMultiplier === 'number' && meta.movementBoostMultiplier > 1) {
            const pct = Math.round((meta.movementBoostMultiplier - 1) * 100);
            const remain = computeRemainingTurns(meta.movementBoostExpires, currentTurn);
            list.push({ name: 'Speed', desc: `+${pct}%`, turns: remain, source: 'Engine Boost' });
        }
        if (typeof meta.scanRangeMultiplier === 'number' && meta.scanRangeMultiplier > 1) {
            const remain = computeRemainingTurns(meta.scanBoostExpires, currentTurn);
            list.push({ name: 'Scan', desc: `x${meta.scanRangeMultiplier}`, turns: remain, source: 'Survey Scanner' });
        }
        if (typeof meta.movementFlatBonus === 'number' && meta.movementFlatBonus > 0) {
            const remain = computeRemainingTurns(meta.movementFlatExpires, currentTurn);
            list.push({ name: '+Move', desc: `+${meta.movementFlatBonus} tiles`, turns: remain, source: 'Microthruster Shift' });
        }
        if (typeof meta.evasionBonus === 'number' && meta.evasionBonus > 0) {
            const remain = computeRemainingTurns(meta.evasionExpires, currentTurn);
            list.push({ name: 'Evasion', desc: `+${Math.round(meta.evasionBonus*100)}%`, turns: remain, source: 'Emergency Discharge Vent' });
        }
        const active = list.filter(e => e.turns > 0);
        if (active.length === 0) return '';
        const tip = active.map(e => {
            const isBuff = !/^[-]/.test(e.desc);
            const color = isBuff ? '#7CFC00' : '#FF6B6B';
            return `<span style=\"color:${color}\">${e.name} ${e.desc} (${e.turns}T) – ${e.source}</span>`;
        }).join('<br/>');
        const safeTip = escapeAttr(tip);
        return `<span class=\"chip\" title=\"${safeTip}\">✨ Effects</span>`;
    } catch { return ''; }
}
