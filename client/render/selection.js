// Selection overlay rendering

export function drawSelection(game, ctx, centerX, centerY) {
    try {
        const unit = game.selectedUnit;
        if (!unit) return;
        const screenX = centerX + (unit.x - game.camera.x) * game.tileSize;
        const screenY = centerY + (unit.y - game.camera.y) * game.tileSize;
        const size = game.tileSize;

        // Animated selection ring
        const time = Date.now() / 1000;
        const alpha = 0.5 + 0.3 * Math.sin(time * 3);
        ctx.strokeStyle = `rgba(255, 193, 7, ${alpha})`;
        ctx.lineWidth = 3;
        ctx.setLineDash([5, 5]);
        ctx.strokeRect(screenX - size/2 - 5, screenY - size/2 - 5, size + 10, size + 10);
        ctx.setLineDash([]);

        // Ability preview ring
        if (game.abilityPreview && unit?.meta?.abilities?.includes(game.abilityPreview)) {
            const def = (window.AbilityDefs || {})[game.abilityPreview];
            if (def && def.range) {
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
                ctx.lineWidth = 1.5;
                const radiusPx = def.range * game.tileSize;
                ctx.beginPath();
                ctx.arc(screenX, screenY, radiusPx, 0, Math.PI * 2);
                ctx.stroke();

                // Yellow hover dot for any position-target ability while selecting
                if (game.pendingAbility && game.pendingAbility.def?.target === 'position' && game.abilityHover) {
                    const hx = centerX + (Math.round(game.abilityHover.x) - game.camera.x) * game.tileSize;
                    const hy = centerY + (Math.round(game.abilityHover.y) - game.camera.y) * game.tileSize;
                    ctx.beginPath();
                    ctx.fillStyle = game.abilityHover.valid ? 'rgba(255, 235, 59, 0.95)' : 'rgba(255, 82, 82, 0.7)';
                    ctx.arc(hx, hy, Math.max(3, game.tileSize * 0.18), 0, Math.PI * 2);
                    ctx.fill();
                }
            }
        }
    } catch {}
}


