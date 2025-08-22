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

    function queueAbility(client, abilityKey) {
        if (!client.selectedUnit || client.turnLocked) return;
        const def = (window.AbilityDefs || {})[abilityKey];
        if (!def) return;
        if (def.target === 'self') {
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


