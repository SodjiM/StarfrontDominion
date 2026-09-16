// Starfront: Dominion - Ship/station renderer (global namespace)

(function(){
    function updateHeading(obj) {
        const path = obj?.movementPath;
        if (!Array.isArray(path) || path.length < 2) return obj?._heading;
        const origin = { x: Number(obj.x), y: Number(obj.y) };
        const next = path.slice(1).find(point => {
            const dx = Number(point?.x) - origin.x;
            const dy = Number(point?.y) - origin.y;
            return Number.isFinite(dx) && Number.isFinite(dy) && (dx !== 0 || dy !== 0);
        });
        if (!next) return obj._heading;
        obj._heading = Math.atan2(Number(next.y) - origin.y, Number(next.x) - origin.x);
        return obj._heading;
    }

    function isMoving(obj) {
        // Mining/harvesting can have an active status, but it must not show propulsion.
        return obj?.type === 'ship'
            && (obj.movementActive === true || obj.laneTransit === true)
            && obj.movementStatus !== 'blocked'
            && obj.movementStatus !== 'completed';
    }

    function drawThrusterFire(ctx, obj, x, y, size, heading) {
        if (!isMoving(obj) || typeof heading !== 'number') return;
        const time = (window.gameClient?.animationTime ?? performance.now() / 1000);
        const flicker = 0.88 + Math.sin(time * 24 + Number(obj.id || 0)) * 0.1;
        const flameLength = size * (0.28 + flicker * 0.1);
        const flameWidth = size * 0.13;

        ctx.save();
        ctx.translate(x, y);
        // The source art points upward, so its rear is local +Y. Rotate the flame
        // with the same corrected heading as the ship, placing it behind the hull.
        ctx.rotate(heading + Math.PI / 2);
        ctx.globalCompositeOperation = 'lighter';
        const glow = ctx.createRadialGradient(0, size * 0.42, 0, 0, size * 0.42, flameLength * 1.35);
        glow.addColorStop(0, 'rgba(255, 245, 180, .9)');
        glow.addColorStop(.35, 'rgba(79, 190, 255, .65)');
        glow.addColorStop(1, 'rgba(40, 120, 255, 0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.ellipse(0, size * 0.42, flameWidth * 1.7, flameLength * .8, 0, 0, Math.PI * 2);
        ctx.fill();

        const flame = ctx.createLinearGradient(0, size * .25, 0, size * .25 + flameLength);
        flame.addColorStop(0, 'rgba(255, 255, 235, .98)');
        flame.addColorStop(.3, 'rgba(100, 215, 255, .95)');
        flame.addColorStop(1, 'rgba(36, 110, 255, 0)');
        ctx.fillStyle = flame;
        ctx.beginPath();
        ctx.moveTo(-flameWidth, size * .25);
        ctx.quadraticCurveTo(0, size * .22 + flameLength * .15, flameWidth, size * .25);
        ctx.lineTo(0, size * .25 + flameLength);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }

    function drawShipObject(ctx, obj, x, y, size, colors, visibility, isOwned) {
        const game = window.gameClient;
        if (game && game.drawShipObject) {
            return game.drawShipObject(ctx, obj, x, y, size, colors, visibility, isOwned);
        }
        // The source art points up. Store travel direction in world/canvas radians;
        // the +PI/2 correction below makes the ship nose follow that direction.
        let heading;
        try { heading = updateHeading(obj); } catch {}
        drawThrusterFire(ctx, obj, x, y, size, heading);

        // Try animated sheet first
        try {
            const sprites = window.SFSprites;
            if (sprites && sprites.getSheetForObject && sprites.drawSheetFrame) {
                obj._animStartMs = obj._animStartMs || performance.now();
                const moving = isMoving(obj);
                const sheet = sprites.getSheetForObject(obj);
                if (sheet) {
                    // Draw with rotation if angle stored
                    if (typeof heading === 'number') {
                        ctx.save();
                        ctx.translate(x, y);
                        ctx.rotate(heading + Math.PI / 2);
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
                    if (typeof heading === 'number') {
                        ctx.save();
                        ctx.translate(x, y);
                        ctx.rotate(heading + Math.PI / 2);
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

