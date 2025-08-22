// Starfront: Dominion - Object renderer (global namespace)

(function(){
    function drawObjects(ctx, canvas, objects, camera, tileSize, game) {
        if (!ctx || !canvas || !Array.isArray(objects) || !game) return;

        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;

        const celestialObjects = [];
        const resourceNodes = [];
        const shipObjects = [];

        objects.forEach(obj => {
            const screenX = centerX + (obj.x - camera.x) * tileSize;
            const screenY = centerY + (obj.y - camera.y) * tileSize;
            const buffer = (obj.radius || 1) * tileSize + 100;
            if (screenX >= -buffer && screenX <= canvas.width + buffer && screenY >= -buffer && screenY <= canvas.height + buffer) {
                if (obj.type === 'resource_node') {
                    resourceNodes.push({ obj, screenX, screenY });
                } else if (game.isCelestialObject && game.isCelestialObject(obj)) {
                    celestialObjects.push({ obj, screenX, screenY });
                } else {
                    shipObjects.push({ obj, screenX, screenY });
                }
            }
        });

        celestialObjects.sort((a, b) => (b.obj.radius || 1) - (a.obj.radius || 1));

        const callDraw = (entry) => {
            if (game.drawObject) game.drawObject(ctx, entry.obj, entry.screenX, entry.screenY);
        };

        celestialObjects.forEach(callDraw);
        resourceNodes.forEach(callDraw);
        shipObjects.forEach(callDraw);
    }

    if (typeof window !== 'undefined') {
        window.SFRenderers = window.SFRenderers || {};
        window.SFRenderers.objects = { drawObjects };
    }
})();


