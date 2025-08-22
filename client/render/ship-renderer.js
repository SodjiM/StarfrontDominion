// Starfront: Dominion - Ship/station renderer (global namespace)

(function(){
    function drawShipObject(ctx, obj, x, y, size, colors, visibility, isOwned) {
        const game = window.gameClient;
        if (game && game.drawShipObject) {
            return game.drawShipObject(ctx, obj, x, y, size, colors, visibility, isOwned);
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


