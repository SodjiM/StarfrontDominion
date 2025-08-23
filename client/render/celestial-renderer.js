// Starfront: Dominion - Celestial object renderer (global namespace)

(function(){
    function tileSizeOf(game) { return (game && game.tileSize) ? game.tileSize : 20; }
    function cameraOf(game) { return (game && game.camera) ? game.camera : { x: 0, y: 0 }; }

    function drawStar(ctx, x, y, size, colors) {
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, size/2);
        gradient.addColorStop(0, 'rgba(255,215,0,0.9)');
        gradient.addColorStop(0.5, 'rgba(255,140,0,0.6)');
        gradient.addColorStop(1, 'rgba(255,69,0,0.3)');
        ctx.fillStyle = gradient;
        ctx.beginPath(); ctx.arc(x, y, size/2, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = colors.border; ctx.lineWidth = Math.max(2, size * 0.02); ctx.stroke();
        if (size > 40) drawStarSparkles(ctx, x, y, size);
    }

    function drawPlanet(ctx, x, y, size, colors, meta) {
        ctx.fillStyle = colors.background; ctx.beginPath(); ctx.arc(x, y, size/2, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = colors.border; ctx.lineWidth = Math.max(1, size * 0.015); ctx.stroke();
        if (size > 30) drawPlanetFeatures(ctx, x, y, size, colors, meta);
    }

    function drawAsteroidBelt(ctx, x, y, size, colors) {
        ctx.strokeStyle = colors.border; ctx.lineWidth = Math.max(1, size * 0.01);
        for (let i = 0; i < 4; i++) {
            ctx.beginPath(); ctx.arc(x, y, (size/2) * (0.6 + i*0.1), 0, Math.PI * 2); ctx.stroke();
        }
    }

    function drawNebula(ctx, x, y, size, colors, game) {
        const camera = cameraOf(game); const ts = tileSizeOf(game);
        const centerDistance = Math.sqrt(Math.pow(camera.x - x, 2) + Math.pow(camera.y - y, 2));
        const isNearby = centerDistance < size * 1.2;
        if (isNearby && ts > 6) drawDetailedNebula(ctx, x, y, size, colors);
        else drawDistantNebula(ctx, x, y, size, colors);
    }

    function drawDetailedNebula(ctx, x, y, size, colors) {
        const baseMatch = (colors.background || '').match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        const baseR = baseMatch ? baseMatch[1] : '138';
        const baseG = baseMatch ? baseMatch[2] : '43';
        const baseB = baseMatch ? baseMatch[3] : '226';
        const layers = [ { radius: size*0.6, alpha: 0.15, particles: 30 }, { radius: size*0.45, alpha: 0.25, particles: 20 }, { radius: size*0.3, alpha: 0.35, particles: 15 } ];
        layers.forEach(layer => {
            const g = ctx.createRadialGradient(x, y, 0, x, y, layer.radius);
            g.addColorStop(0, `rgba(${baseR}, ${baseG}, ${baseB}, ${layer.alpha})`);
            g.addColorStop(0.7, `rgba(${baseR}, ${baseG}, ${baseB}, ${layer.alpha*0.6})`);
            g.addColorStop(1, `rgba(${baseR}, ${baseG}, ${baseB}, 0)`);
            ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, layer.radius, 0, Math.PI*2); ctx.fill();
        });
    }

    function drawDistantNebula(ctx, x, y, size, colors) {
        ctx.fillStyle = colors.background; const numClouds = Math.max(3, Math.floor(size / 20 / 2));
        for (let i = 0; i < numClouds; i++) {
            const angle = (i / numClouds) * Math.PI * 2; const offsetX = Math.cos(angle) * size * 0.25; const offsetY = Math.sin(angle) * size * 0.25; const cloudSize = size * (0.3 + Math.random() * 0.4);
            ctx.beginPath(); ctx.arc(x + offsetX, y + offsetY, cloudSize/2, 0, Math.PI * 2); ctx.fill();
        }
    }

    function drawWormhole(ctx, x, y, size, colors) {
        ctx.strokeStyle = colors.border; ctx.lineWidth = Math.max(2, size * 0.03);
        for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(x, y, size/2 - i * size * 0.1, 0, Math.PI * 2); ctx.stroke(); }
        if (colors.glow) { ctx.fillStyle = colors.glow + '33'; ctx.beginPath(); ctx.arc(x, y, size/4, 0, Math.PI * 2); ctx.fill(); }
    }

    function drawGravitonSink(ctx, x, y, size, colors) {
        ctx.fillStyle = colors.background; ctx.beginPath(); ctx.arc(x, y, size/2, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = colors.glow || '#FF0000'; ctx.lineWidth = Math.max(2, size * 0.02);
        for (let i = 1; i <= 3; i++) { ctx.beginPath(); ctx.arc(x, y, size/2 + i * size * 0.1, 0, Math.PI * 2); ctx.stroke(); }
    }

    function drawGenericCelestial(ctx, x, y, size, colors) {
        ctx.fillStyle = colors.background; ctx.strokeStyle = colors.border; ctx.lineWidth = Math.max(1, size * 0.02);
        ctx.beginPath(); ctx.arc(x, y, size/2, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }

    function drawStarSparkles(ctx, x, y, size) {
        ctx.fillStyle = '#FFFFFF'; const numSparkles = 8;
        for (let i = 0; i < numSparkles; i++) { const angle = (i / numSparkles) * Math.PI * 2; const distance = size * 0.6; const sx = x + Math.cos(angle) * distance; const sy = y + Math.sin(angle) * distance; ctx.beginPath(); ctx.arc(sx, sy, 2, 0, Math.PI * 2); ctx.fill(); }
    }

    function drawPlanetFeatures(ctx, x, y, size, colors, meta) {
        ctx.fillStyle = colors.border + '44'; const numFeatures = 3;
        for (let i = 0; i < numFeatures; i++) { const angle = Math.random() * Math.PI * 2; const distance = Math.random() * size * 0.3; const fx = x + Math.cos(angle) * distance; const fy = y + Math.sin(angle) * distance; const fsize = size * 0.1 * (0.5 + Math.random() * 0.5); ctx.beginPath(); ctx.arc(fx, fy, fsize, 0, Math.PI * 2); ctx.fill(); }
    }

    function drawCelestialObject(ctx, obj, x, y, size, colors, visibility, game) {
        const type = obj.celestial_type || obj.type; const ts = tileSizeOf(game);
        if (colors.glow && size > ts) { ctx.shadowColor = colors.glow; ctx.shadowBlur = Math.min(size * 0.3, 20); }
        if (type === 'star') drawStar(ctx, x, y, size, colors);
        else if (type === 'planet' || type === 'moon') drawPlanet(ctx, x, y, size, colors, obj.meta);
        else if (type === 'belt') drawAsteroidBelt(ctx, x, y, size, colors);
        else if (type === 'nebula') drawNebula(ctx, x, y, size, colors, game);
        else if (type === 'wormhole' || type === 'jump-gate') drawWormhole(ctx, x, y, size, colors);
        else if (type === 'graviton-sink') drawGravitonSink(ctx, x, y, size, colors);
        else drawGenericCelestial(ctx, x, y, size, colors);
        ctx.shadowBlur = 0;

        if ((size > ts * 3 || ts > 20) && obj.meta && obj.meta.name) {
            ctx.fillStyle = colors.text; ctx.font = `bold ${Math.max(12, ts * 0.4)}px Arial`; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillText(obj.meta.name, x, y + size/2 + 5);
        }

        if (visibility && visibility.dimmed && size > ts) {
            ctx.fillStyle = 'rgba(100, 181, 246, 0.7)'; ctx.font = `${Math.max(16, ts * 0.5)}px Arial`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('?', x, y);
        }
    }

    if (typeof window !== 'undefined') {
        window.SFRenderers = window.SFRenderers || {};
        window.SFRenderers.celestial = { drawCelestialObject };
    }
})();


