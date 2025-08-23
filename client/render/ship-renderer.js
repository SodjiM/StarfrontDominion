// Starfront: Dominion - Ship/station renderer (global namespace)

(function(){
    function drawShipObject(ctx, obj, x, y, size, colors, visibility, isOwned) {
        const game = window.gameClient;
        if (game && game.drawShipObject) {
            return game.drawShipObject(ctx, obj, x, y, size, colors, visibility, isOwned);
        }
        // Determine orientation: persist last angle; update when moving
        try {
            const path = obj.movementPath;
            if (Array.isArray(path) && path.length >= 2) {
                const next = path[1];
                const dx = (next.x - obj.x);
                const dy = (next.y - obj.y);
                if (dx !== 0 || dy !== 0) {
                    // canvas +X is right, +Y is down; 0 rad is to the right. We want up as 0, so subtract PI/2 when drawing
                    obj._angle = Math.atan2(dy, dx);
                }
            }
        } catch {}

        // Try animated sheet first
        try {
            const sprites = window.SFSprites;
            if (sprites && sprites.getSheetForObject && sprites.drawSheetFrame) {
                obj._animStartMs = obj._animStartMs || performance.now();
                const moving = !!(obj.vx || obj.vy);
                const sheet = sprites.getSheetForObject(obj);
                if (sheet) {
                    // Draw with rotation if angle stored
                    if (typeof obj._angle === 'number') {
                        ctx.save();
                        ctx.translate(x, y);
                        ctx.rotate(obj._angle - Math.PI/2);
                        const ok = sprites.drawSheetFrame(ctx, sheet, moving ? 'moving' : 'idle', obj._animStartMs, 0, 0, size);
                        ctx.restore();
                        if (ok) return;
                    }
                    const ok = sprites.drawSheetFrame(ctx, sheet, moving ? 'moving' : 'idle', obj._animStartMs, x, y, size);
                    if (ok) return;
                }
            }
        } catch (e) {
            // noop, fall back
        }
        // Try static sprite
        try {
            const sprites = window.SFSprites;
            if (sprites && sprites.getSpriteForObject) {
                const img = sprites.getSpriteForObject(obj);
                if (img) {
                    ctx.imageSmoothingEnabled = true;
                    if (typeof obj._angle === 'number') {
                        ctx.save();
                        ctx.translate(x, y);
                        ctx.rotate(obj._angle - Math.PI/2);
                        ctx.drawImage(img, -size/2, -size/2, size, size);
                        ctx.restore();
                    } else {
                        ctx.drawImage(img, x - size/2, y - size/2, size, size);
                    }
                    return;
                }
            }
        } catch (e) {
            // noop
        }
        // Fallback simple square
        ctx.fillStyle = colors.border || (isOwned ? '#4caf50' : '#f44336');
        ctx.fillRect(x - size/2, y - size/2, size, size);
    }

    if (typeof window !== 'undefined') {
        window.SFRenderers = window.SFRenderers || {};
        window.SFRenderers.ship = { drawShipObject };
    }
})();


