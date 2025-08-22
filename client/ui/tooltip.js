// Starfront: Dominion - Map Tooltip UI (global namespace)

(function(){
    function create(parentCanvas) {
        if (!parentCanvas || !parentCanvas.parentElement) return null;
        const parent = parentCanvas.parentElement;
        const tip = document.createElement('div');
        tip.id = 'mapTooltip';
        tip.style.position = 'absolute';
        tip.style.zIndex = '2500';
        tip.style.pointerEvents = 'none';
        tip.style.background = 'rgba(10, 15, 28, 0.95)';
        tip.style.border = '1px solid rgba(100,181,246,0.35)';
        tip.style.borderRadius = '8px';
        tip.style.padding = '6px 8px';
        tip.style.color = '#e0f2ff';
        tip.style.fontSize = '12px';
        tip.style.display = 'none';
        tip.style.boxShadow = '0 6px 18px rgba(0,0,0,0.35)';
        parent.appendChild(tip);
        return tip;
    }

    function update(tipEl, canvas, obj, mouseX, mouseY, getOwnerName) {
        if (!tipEl) return;
        if (!obj) {
            tipEl.style.display = 'none';
            return;
        }
        const meta = obj.meta || {};
        const name = meta.name || obj.type || 'Unknown';
        const shipType = obj.type === 'resource_node' ? (meta.resourceType || 'resource_node') : (meta.shipType || meta.class || obj.subtype || obj.type);
        const ownerName = getOwnerName ? getOwnerName(obj.owner_id) : (obj.owner_id || '—');
        const hp = (meta.hp != null && meta.maxHp != null) ? `${meta.hp}/${meta.maxHp}` : (meta.hp != null ? String(meta.hp) : '—');
        const lines = [ `${name}`, `Type: ${shipType || '—'}` ];
        if (obj.type === 'resource_node') {
            const amt = (meta.resourceAmount != null) ? meta.resourceAmount : (meta.amount != null ? meta.amount : undefined);
            if (meta.resourceType) lines.push(`Resource: ${meta.resourceType}`);
            if (amt != null) lines.push(`Amount: ${amt}`);
        } else {
            lines.push(`Owner: ${ownerName || obj.owner_id || '—'}`);
            lines.push(`HP: ${hp}`);
        }
        tipEl.innerHTML = lines.map(l => `<div>${l}</div>`).join('');
        const parentRect = canvas.getBoundingClientRect();
        const left = Math.min(parentRect.width - 180, mouseX + 12);
        const top = Math.min(parentRect.height - 80, mouseY + 12);
        tipEl.style.left = `${left}px`;
        tipEl.style.top = `${top}px`;
        tipEl.style.display = 'block';
    }

    function hide(tipEl) {
        if (tipEl) tipEl.style.display = 'none';
    }

    if (typeof window !== 'undefined') {
        window.SFTooltip = window.SFTooltip || { create, update, hide };
    }
})();


