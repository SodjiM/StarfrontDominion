// Abilities Controller - extracts ability logic from GameClient
// Exposes a global namespace: window.SFAbilities

(function(){
    if (window.SFAbilities) return; // idempotent

    function previewAbilityRange(client, abilityKey) {
        client.abilityPreview = abilityKey;
        client.render();
    }

    function clearAbilityPreview(client) {
        // Do not clear the ring if a position-target ability is currently awaiting a click
        if (client.pendingAbility && client.pendingAbility.def?.target === 'position') return;
        client.abilityPreview = null;
        client.abilityHover = null;
        client.render();
    }

    function computePositionAbilityHover(client, abilityKey, worldX, worldY) {
        const unit = client.selectedUnit;
        const def = (window.AbilityDefs || {})[abilityKey];
        if (!unit || !def) return null;
        const dx = worldX - unit.x;
        const dy = worldY - unit.y;
        const dist = Math.hypot(dx, dy);
        // Default rule: within range and destination tile unoccupied
        const inRange = !def.range || dist <= def.range;
        const free = !client.isTileOccupied(worldX, worldY);
        const valid = inRange && free;
        return { x: worldX, y: worldY, valid, inRange, free };
    }

    async function queueAbility(client, abilityKey) {
        if (client._lastQueuedAbilityAt && Date.now() - client._lastQueuedAbilityAt < 200) return; // debounce rapid clicks
        client._lastQueuedAbilityAt = Date.now();
        if (!client.selectedUnit || client.turnLocked) return;
        const def = (window.AbilityDefs || {})[abilityKey];
        if (!def) return;
        if (def.target === 'self') {
            // Mining abilities: open node selection if needed; recast toggles off when already mining
            if (def.mining) {
                const ship = client.selectedUnit;
                const isMining = ship.harvestingStatus === 'active';
                if (isMining) {
                    client.socket.emit('activate-ability', { gameId: client.gameId, casterId: ship.id, abilityKey, params: { stop: true } });
                    client.addLogEntry(`Queued: Stop ${def.name}`, 'info');
                } else {
                    try {
                        const range = def.range || 3;
                        const data = await (window.SFApi ? SFApi.Resources.listNearbyNodes(client.gameId, ship.id, client.userId, range) : Promise.resolve({ resourceNodes: [] }));
                        const nodes = data.resourceNodes || [];
                        if (nodes.length === 0) {
                            client.addLogEntry('No resource nodes in range', 'warning');
                            return;
                        }
                        if (nodes.length === 1) {
                            client.socket.emit('activate-ability', { gameId: client.gameId, casterId: ship.id, abilityKey, targetObjectId: nodes[0].id });
                            client.addLogEntry(`Queued ${def.name} on ${nodes[0].resource_name}`, 'info');
                        } else {
                            // Use existing mining modal for selection
                            if (window.UI && window.SFApi) {
                                const resourceList = document.createElement('div'); resourceList.className = 'resource-selection-list';
                                const header = document.createElement('div'); header.innerHTML = `<h3>⛏️ Select Resource to Mine</h3><p>Choose which resource node to harvest (within range ${range}):</p>`; resourceList.appendChild(header);
                                nodes.forEach(node => {
                                    const option = document.createElement('div'); option.className = 'resource-option';
                                    option.innerHTML = `
                                        <div class="resource-info">
                                            <div class="resource-name">${node.icon_emoji || ''} ${node.resource_name}</div>
                                            <div class="resource-details"><span class="resource-amount">${node.resource_amount} available</span><span class="resource-distance">${node.distance} tile${node.distance !== 1 ? 's' : ''} away</span></div>
                                        </div>
                                        <div class="resource-action"><button class="mine-select-btn">Mine</button></div>`;
                                    option.querySelector('.mine-select-btn').addEventListener('click', () => {
                                        client.socket.emit('activate-ability', { gameId: client.gameId, casterId: ship.id, abilityKey, targetObjectId: node.id });
                                        client.addLogEntry(`Queued ${def.name} on ${node.resource_name}`, 'info');
                                        window.UI.closeModal();
                                    });
                                    resourceList.appendChild(option);
                                });
                                window.UI.showModal({ title: '⛏️ Mining Target Selection', content: resourceList, actions: [{ text: 'Cancel', style: 'secondary', action: () => true }], className: 'resource-selection-modal' });
                            } else {
                                client.addLogEntry('Multiple nodes in range. UI unavailable to select.', 'warning');
                            }
                        }
                    } catch (e) {
                        client.addLogEntry('Failed to list nodes for mining', 'error');
                    }
                }
                // For mining, keep preview off
                client.abilityPreview = null; client.abilityHover = null; client.pendingAbility = null;
                return;
            }

            client.socket.emit('activate-ability', { gameId: client.gameId, casterId: client.selectedUnit.id, abilityKey });
            client.addLogEntry(`Queued ${def.name}`, 'info');
            // Optimistic UI: show Microthruster Shift effect immediately on the current turn
            if (abilityKey === 'microthruster_shift') {
                try {
                    const currentTurn = client.gameState?.currentTurn?.turn_number || 0;
                    client.selectedUnit.meta = client.selectedUnit.meta || {};
                    client.selectedUnit.meta.movementFlatBonus = Math.max(client.selectedUnit.meta.movementFlatBonus || 0, 3);
                    client.selectedUnit.meta.movementFlatExpires = Number(currentTurn) + 1;
                    client.render();
                } catch {}
            }
            // For self-cast, keep preview off
            client.abilityPreview = null; client.abilityHover = null; client.pendingAbility = null;
        } else if (def.target === 'position') {
            // Next click on the map will provide position
            client.pendingAbility = { key: abilityKey, def };
            client.addLogEntry(`Select position for ${def.name}`, 'info');
            // Keep range ring visible until user clicks a position or cancels by clicking outside range
            client.abilityPreview = abilityKey;
        } else {
            // Enemy/ally target
            client.pendingAbility = { key: abilityKey, def };
            client.addLogEntry(`Select target for ${def.name}`, 'info');
        }
    }

    async function refreshAbilityCooldowns(client) {
        const container = document.getElementById('abilityButtons');
        if (!container || !client.selectedUnit) return;
        try {
            const data = await (window.SFApi ? SFApi.Abilities.cooldowns(client.selectedUnit.id) : Promise.resolve({ cooldowns: [] }));
            const cooldowns = new Map((data.cooldowns || []).map(c => [c.ability_key, c.available_turn]));
            const currentTurn = client.gameState?.currentTurn?.turn_number || 1;
            container.querySelectorAll('button[data-ability]').forEach(btn => {
                const key = btn.getAttribute('data-ability');
                const available = cooldowns.get(key);
                if (available && Number(available) > Number(currentTurn)) {
                    btn.disabled = true;
                    btn.classList.add('sf-btn-disabled');
                    btn.title = (btn.title || '') + ` (Cooldown: ready on turn ${available})`;
                } else if (!client.turnLocked) {
                    btn.disabled = false;
                    btn.classList.remove('sf-btn-disabled');
                }
            });
        } catch {}
    }

    window.SFAbilities = {
        previewAbilityRange,
        clearAbilityPreview,
        computePositionAbilityHover,
        queueAbility,
        refreshAbilityCooldowns
    };
})();


