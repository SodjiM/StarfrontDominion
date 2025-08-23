// Starfront: Dominion - Resource node renderer (global namespace)

(function(){
    function drawResourceNode(ctx, obj, x, y, size, colors) {
        const game = window.gameClient; // fallback for helpers if needed
        if (game && game.drawResourceNode) {
            return game.drawResourceNode(ctx, obj, x, y, size, colors);
        }
        // Try static sprite first (resources seldom animated)
        try {
            const sprites = window.SFSprites;
            if (sprites && sprites.getSpriteForObject) {
                const img = sprites.getSpriteForObject(obj);
                if (img) {
                    ctx.imageSmoothingEnabled = true;
                    ctx.drawImage(img, x - size/2, y - size/2, size, size);
                    return;
                }
            }
        } catch (e) {
            // noop
        }
        // Fallback simple dot
        ctx.fillStyle = colors.border || '#ccc';
        ctx.beginPath();
        ctx.arc(x, y, Math.max(2, size*0.1), 0, Math.PI*2);
        ctx.fill();
    }

    if (typeof window !== 'undefined') {
        window.SFRenderers = window.SFRenderers || {};
        window.SFRenderers.resource = { drawResourceNode };
    }
})();


