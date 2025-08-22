// Starfront: Dominion - Grid renderer (global namespace)

(function(){
    function drawGrid(ctx, canvas, camera, tileSize) {
        ctx.strokeStyle = 'rgba(100, 181, 246, 0.1)';
        ctx.lineWidth = 1;

        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;
        const tilesX = Math.ceil(canvas.width / tileSize);
        const tilesY = Math.ceil(canvas.height / tileSize);

        const startX = camera.x - Math.floor(tilesX / 2);
        const startY = camera.y - Math.floor(tilesY / 2);

        for (let i = 0; i <= tilesX; i++) {
            const x = centerX + (i - tilesX / 2) * tileSize;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, canvas.height);
            ctx.stroke();
        }

        for (let i = 0; i <= tilesY; i++) {
            const y = centerY + (i - tilesY / 2) * tileSize;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(canvas.width, y);
            ctx.stroke();
        }
    }

    if (typeof window !== 'undefined') {
        window.SFRenderers = window.SFRenderers || {};
        window.SFRenderers.grid = { drawGrid };
    }
})();


