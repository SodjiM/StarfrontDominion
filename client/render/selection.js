import { physicalScale } from '../utils/physical-geometry.js';
import { objectDisplaySize } from './object-scale.js';
// Selection overlay rendering

export function drawSelection(game, ctx, centerX, centerY) {
    try {
        const unit = game.selectedUnit;
        if (!unit) return;
        const center = physicalScale.shape(unit);
        const screenX = centerX + (center.x - game.camera.x) * game.tileSize;
        const screenY = centerY + (center.y - game.camera.y) * game.tileSize;
        const size = objectDisplaySize(unit, game.tileSize);

        // Exact occupied footprint, separate from the readability-sized sprite.
        if (!physicalScale.isDisk(unit)) {
            const width=physicalScale.width(unit)*game.tileSize;
            ctx.save(); ctx.strokeStyle='rgba(255,193,7,0.35)'; ctx.lineWidth=1;
            ctx.strokeRect(screenX-width/2,screenY-width/2,width,width); ctx.restore();
        }
        // Animated selection ring
        const time = game.reducedMotion ? 0 : (game.animationTime || 0);
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


