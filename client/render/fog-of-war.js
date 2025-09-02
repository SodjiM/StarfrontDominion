// Starfront: Dominion - Fog of War renderer (global namespace)

(function(){
    function drawFogOfWar(ctx, canvas, objects, userId, camera, tileSize, fogOffscreenRef) {
        // Guard against zero-sized canvases which cause drawImage to throw
        if (!canvas || canvas.width === 0 || canvas.height === 0) {
            return fogOffscreenRef;
        }
        const ownedSensors = (objects || []).filter(obj => obj.owner_id === userId && (obj.type === 'ship' || obj.type === 'station' || obj.type === 'sensor-tower'));
        if (ownedSensors.length === 0) return fogOffscreenRef;

        let fogOffscreen = fogOffscreenRef;
        if (!fogOffscreen || fogOffscreen.width !== canvas.width || fogOffscreen.height !== canvas.height) {
            fogOffscreen = document.createElement('canvas');
            fogOffscreen.width = canvas.width;
            fogOffscreen.height = canvas.height;
        }
        const fctx = fogOffscreen.getContext('2d');
        if (!fogOffscreen.width || !fogOffscreen.height) {
            return fogOffscreenRef;
        }
        fctx.clearRect(0, 0, fogOffscreen.width, fogOffscreen.height);
        fctx.fillStyle = 'rgba(0,0,0,0.6)';
        fctx.fillRect(0, 0, fogOffscreen.width, fogOffscreen.height);
        fctx.globalCompositeOperation = 'destination-out';

        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;

        ownedSensors.forEach(sensor => {
            const meta = sensor.meta || {};
            let scanRange = meta.scanRange || 5;
            if (typeof meta.scanRangeMultiplier === 'number' && meta.scanRangeMultiplier > 1) {
                scanRange = Math.ceil(scanRange * meta.scanRangeMultiplier);
            }
            const screenX = Math.round((sensor.x - camera.x) * tileSize + centerX);
            const screenY = Math.round((sensor.y - camera.y) * tileSize + centerY);
            const radiusPx = scanRange * tileSize;
            const gradient = fctx.createRadialGradient(screenX, screenY, 0, screenX, screenY, Math.max(1, radiusPx));
            gradient.addColorStop(0, 'rgba(0,0,0,1)');
            gradient.addColorStop(0.7, 'rgba(0,0,0,0.4)');
            gradient.addColorStop(1, 'rgba(0,0,0,0)');
            fctx.fillStyle = gradient;
            fctx.beginPath();
            fctx.arc(screenX, screenY, Math.max(1, radiusPx), 0, Math.PI * 2);
            fctx.fill();
        });
        fctx.globalCompositeOperation = 'source-over';
        ctx.drawImage(fogOffscreen, 0, 0);
        return fogOffscreen;
    }

    if (typeof window !== 'undefined') {
        window.SFRenderers = window.SFRenderers || {};
        window.SFRenderers.fog = { drawFogOfWar };
    }
})();


