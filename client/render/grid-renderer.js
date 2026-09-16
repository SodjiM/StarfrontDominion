// World coordinates denote cell centers; boundaries sit half a cell away.
(function () {
    function drawGrid(ctx, canvas, camera, tileSize, options = {}) {
        if (!(tileSize > 0)) return;
        let always = options.always;
        if (always == null) { try { always = localStorage.getItem('ui.alwaysGrid') === '1'; } catch { always = false; } }
        const cx = canvas.width / 2, cy = canvas.height / 2;
        const radius = Math.max(4, Math.min(16, options.radiusTiles || 8));
        const points = [options.hoverWorld, options.selectedUnit, options.destination]
            .filter(p => p && Number.isFinite(p.x) && Number.isFinite(p.y));
        function lines(left, top, right, bottom) {
            const x0 = Math.ceil(camera.x + (left - cx) / tileSize - .5) + .5;
            const y0 = Math.ceil(camera.y + (top - cy) / tileSize - .5) + .5;
            ctx.beginPath();
            for (let wx = x0; cx + (wx - camera.x) * tileSize <= right; wx++) {
                const x = cx + (wx - camera.x) * tileSize;
                ctx.moveTo(x, top); ctx.lineTo(x, bottom);
            }
            for (let wy = y0; cy + (wy - camera.y) * tileSize <= bottom; wy++) {
                const y = cy + (wy - camera.y) * tileSize;
                ctx.moveTo(left, y); ctx.lineTo(right, y);
            }
            ctx.stroke();
        }
        ctx.save(); ctx.lineWidth = 1;
        if (always) {
            ctx.strokeStyle = 'rgba(87,179,208,.16)';
            lines(0, 0, canvas.width, canvas.height);
        } else {
            const drawn = [];
            for (const p of points) {
                if (drawn.some(q => Math.hypot(p.x-q.x,p.y-q.y) < 2)) continue;
                drawn.push(p);
                const x = cx + (p.x-camera.x)*tileSize, y = cy + (p.y-camera.y)*tileSize, r = radius*tileSize;
                if (x+r < 0 || y+r < 0 || x-r > canvas.width || y-r > canvas.height) continue;
                const fade = ctx.createRadialGradient(x,y,0,x,y,r);
                fade.addColorStop(0,'rgba(87,190,220,.30)');
                fade.addColorStop(.35,'rgba(87,190,220,.20)');
                fade.addColorStop(1,'rgba(87,190,220,0)');
                ctx.strokeStyle = fade;
                lines(Math.max(0,x-r),Math.max(0,y-r),Math.min(canvas.width,x+r),Math.min(canvas.height,y+r));
            }
        }
        ctx.restore();
    }
    if (typeof window !== 'undefined') {
        window.SFRenderers = window.SFRenderers || {};
        window.SFRenderers.grid = { drawGrid };
    }
})();
