// Starfront: Dominion - Geometry helpers (global namespace)

(function(){
    function worldToScreen(worldX, worldY, camera, tileSize, canvasWidth, canvasHeight) {
        const centerX = canvasWidth / 2;
        const centerY = canvasHeight / 2;
        const x = centerX + (worldX - camera.x) * tileSize;
        const y = centerY + (worldY - camera.y) * tileSize;
        return { x, y };
    }

    function screenToWorld(screenX, screenY, camera, tileSize, canvasWidth, canvasHeight) {
        const centerX = canvasWidth / 2;
        const centerY = canvasHeight / 2;
        const x = Math.round(camera.x + (screenX - centerX) / tileSize);
        const y = Math.round(camera.y + (screenY - centerY) / tileSize);
        return { x, y };
    }

    function distance(a, b) {
        const dx = (a.x - b.x);
        const dy = (a.y - b.y);
        return Math.hypot(dx, dy);
    }

    function clamp(n, min, max) {
        return Math.max(min, Math.min(max, n));
    }

    if (typeof window !== 'undefined') {
        window.SFGeometry = window.SFGeometry || { worldToScreen, screenToWorld, distance, clamp };
    }
})();


