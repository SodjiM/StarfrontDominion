// Starfront: Dominion - Minimap renderer (global namespace)

(function(){
    function renderMiniMap(ctx, canvas, objects, userId, camera, tileSize, gameState) {
        if (!ctx || !canvas || !objects) return;
        ctx.fillStyle = '#0a0a1a';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.strokeStyle = 'rgba(100, 181, 246, 0.3)';
        ctx.lineWidth = 2;
        ctx.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);

        const scaleX = canvas.width / 5000;
        const scaleY = canvas.height / 5000;

        const isCelestialObject = (obj) => {
            const t = obj.celestial_type || obj.type;
            return ['star','planet','moon','belt','nebula','wormhole','jump-gate','derelict','graviton-sink'].includes(t);
        };

        const celestialObjects = objects.filter(obj => isCelestialObject(obj));
        const resourceNodes = objects.filter(obj => obj.type === 'resource_node');
        const shipObjects = objects.filter(obj => !isCelestialObject(obj) && obj.type !== 'resource_node');

        celestialObjects.forEach(obj => {
            const x = obj.x * scaleX;
            const y = obj.y * scaleY;
            const radius = obj.radius || 1;
            const meta = obj.meta || {};
            const celestialType = meta.celestialType || obj.celestial_type;
            if (celestialType === 'belt' || celestialType === 'nebula') return;
            let size;
            if (celestialType === 'star') size = Math.max(4, Math.min(radius * scaleX * 0.8, canvas.width * 0.08));
            else if (celestialType === 'planet') size = Math.max(3, Math.min(radius * scaleX * 1.2, canvas.width * 0.06));
            else if (celestialType === 'moon') size = Math.max(2, Math.min(radius * scaleX * 1.5, canvas.width * 0.04));
            else size = Math.max(1, Math.min(radius * scaleX * 2, canvas.width * 0.05));

            ctx.fillStyle = '#64b5f6';
            if (celestialType === 'star' || celestialType === 'planet' || celestialType === 'moon') {
                ctx.beginPath();
                ctx.arc(x, y, size/2, 0, Math.PI * 2);
                ctx.fill();
                if (celestialType === 'star' || celestialType === 'planet') {
                    ctx.strokeStyle = '#64b5f6';
                    ctx.lineWidth = 1;
                    ctx.stroke();
                }
            } else {
                ctx.fillRect(x - size/2, y - size/2, size, size);
            }
        });

        const resourceFieldLabels = new Map();
        resourceNodes.forEach(obj => {
            const x = obj.x * scaleX;
            const y = obj.y * scaleY;
            const meta = obj.meta || {};
            const resourceType = meta.resourceType || 'unknown';
            const parentId = obj.parent_object_id;
            let nodeColor = '#757575';
            if (resourceType === 'rock') nodeColor = '#8D6E63';
            else if (resourceType === 'gas') nodeColor = '#9C27B0';
            else if (resourceType === 'energy') nodeColor = '#FFD54F';
            else if (resourceType === 'salvage') nodeColor = '#A1887F';
            ctx.fillStyle = nodeColor;
            ctx.beginPath();
            ctx.arc(x, y, 1, 0, Math.PI * 2);
            ctx.fill();
            if (parentId && (resourceType === 'rock' || resourceType === 'gas')) {
                if (!resourceFieldLabels.has(parentId)) resourceFieldLabels.set(parentId, { x:0, y:0, count:0, type:resourceType });
                const field = resourceFieldLabels.get(parentId);
                field.x += x; field.y += y; field.count++;
            }
        });

        resourceFieldLabels.forEach((field) => {
            const cx = field.x / field.count;
            const cy = field.y / field.count;
            ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
            ctx.font = '8px Arial';
            ctx.textAlign = 'center';
            ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
            ctx.shadowBlur = 1;
            const label = field.type === 'rock' ? 'Asteroid Belt' : 'Nebula Field';
            ctx.fillText(label, cx, cy + 15);
            ctx.shadowBlur = 0;
        });

        shipObjects.forEach(obj => {
            const x = obj.x * scaleX;
            const y = obj.y * scaleY;
            const size = Math.max(2, 4 * scaleX);
            ctx.fillStyle = obj.owner_id === userId ? '#4caf50' : '#ff5722';
            ctx.fillRect(x - size/2, y - size/2, size, size);
        });

        const viewWidth = (canvas._mainWidth || canvas.width) / tileSize * scaleX;
        const viewHeight = (canvas._mainHeight || canvas.height) / tileSize * scaleY;
        const viewX = camera.x * scaleX - viewWidth/2;
        const viewY = camera.y * scaleY - viewHeight/2;
        ctx.strokeStyle = '#ffeb3b';
        ctx.lineWidth = 1;
        ctx.strokeRect(viewX, viewY, viewWidth, viewHeight);

        if (gameState && gameState.sector && gameState.sector.name) {
            ctx.fillStyle = '#64b5f6';
            ctx.font = '11px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.fillText(gameState.sector.name, canvas.width / 2, canvas.height - 4);
        }
    }

    if (typeof window !== 'undefined') {
        window.SFMinimap = window.SFMinimap || {};
        window.SFMinimap.renderer = { renderMiniMap };
    }
})();


