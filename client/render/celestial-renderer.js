// Starfront: Dominion - Celestial object renderer (global namespace)

(function(){
    function drawCelestialObject(ctx, obj, x, y, size, colors, visibility, game) {
        const type = obj.celestial_type || obj.type;
        if (colors.glow && size > (game ? game.tileSize : 20)) {
            ctx.shadowColor = colors.glow;
            ctx.shadowBlur = Math.min(size * 0.3, 20);
        }
        if (type === 'star' && game && game.drawStar) game.drawStar(ctx, x, y, size, colors);
        else if ((type === 'planet' || type === 'moon') && game && game.drawPlanet) game.drawPlanet(ctx, x, y, size, colors, obj.meta);
        else if (type === 'belt' && game && game.drawAsteroidBelt) game.drawAsteroidBelt(ctx, x, y, size, colors);
        else if (type === 'nebula' && game && game.drawNebula) game.drawNebula(ctx, x, y, size, colors);
        else if ((type === 'wormhole' || type === 'jump-gate') && game && game.drawWormhole) game.drawWormhole(ctx, x, y, size, colors);
        else if (type === 'graviton-sink' && game && game.drawGravitonSink) game.drawGravitonSink(ctx, x, y, size, colors);
        else if (game && game.drawGenericCelestial) game.drawGenericCelestial(ctx, x, y, size, colors);
        ctx.shadowBlur = 0;

        if ((size > (game ? game.tileSize : 20) * 3 || (game ? game.tileSize : 20) > 20) && obj.meta && obj.meta.name) {
            ctx.fillStyle = colors.text;
            ctx.font = `bold ${Math.max(12, (game ? game.tileSize : 20) * 0.4)}px Arial`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText(obj.meta.name, x, y + size/2 + 5);
        }

        if (visibility && visibility.dimmed && size > (game ? game.tileSize : 20)) {
            ctx.fillStyle = 'rgba(100, 181, 246, 0.7)';
            ctx.font = `${Math.max(16, (game ? game.tileSize : 20) * 0.5)}px Arial`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('?', x, y);
        }
    }

    if (typeof window !== 'undefined') {
        window.SFRenderers = window.SFRenderers || {};
        window.SFRenderers.celestial = { drawCelestialObject };
    }
})();


