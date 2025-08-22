// Render orchestrator for map objects

import { getObjectColors } from './colors.js';

export function renderObjects(game, ctx, canvas) {
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const tileSize = game.tileSize;
    const camera = game.camera;
    const objects = game.objects || [];

    const celestialObjects = [];
    const resourceNodes = [];
    const shipObjects = [];

    objects.forEach(obj => {
        const screenX = centerX + (obj.x - camera.x) * tileSize;
        const screenY = centerY + (obj.y - camera.y) * tileSize;
        const buffer = (obj.radius || 1) * tileSize + 100;
        if (screenX >= -buffer && screenX <= canvas.width + buffer && screenY >= -buffer && screenY <= canvas.height + buffer) {
            if (obj.type === 'resource_node') resourceNodes.push({ obj, screenX, screenY });
            else if (isCelestialObject(obj)) celestialObjects.push({ obj, screenX, screenY });
            else shipObjects.push({ obj, screenX, screenY });
        }
    });

    celestialObjects.sort((a, b) => (b.obj.radius || 1) - (a.obj.radius || 1));

    celestialObjects.forEach(({ obj, screenX, screenY }) => drawObject(game, ctx, obj, screenX, screenY));
    resourceNodes.forEach(({ obj, screenX, screenY }) => drawObject(game, ctx, obj, screenX, screenY));
    shipObjects.forEach(({ obj, screenX, screenY }) => drawObject(game, ctx, obj, screenX, screenY));
}

function isCelestialObject(obj) {
    const celestialTypes = ['star', 'planet', 'moon', 'belt', 'nebula', 'wormhole', 'jump-gate', 'derelict', 'graviton-sink'];
    return celestialTypes.includes(obj.celestial_type || obj.type);
}

function drawObject(game, ctx, obj, x, y) {
    const isOwned = obj.owner_id === game.userId;
    const visibility = obj.visibilityStatus || { visible: isOwned, dimmed: false };
    const isCelestial = isCelestialObject(obj);
    let objectRadius = obj.radius || 1;
    let renderSize;
    if (isCelestial) {
        renderSize = Math.min(objectRadius * game.tileSize, game.tileSize * 50);
        if (renderSize < game.tileSize * 0.5) renderSize = game.tileSize * 0.5;
    } else {
        renderSize = game.tileSize * 0.8;
    }

    let alpha = 1.0;
    const colors = getObjectColors(game, obj, isOwned, visibility, isCelestial);
    if (visibility.dimmed) alpha = isCelestial ? 0.6 : 0.4; else if (visibility.visible && !isOwned) alpha = 0.9;

    ctx.save();
    ctx.globalAlpha = alpha;

    if (obj.type === 'resource_node') {
        if (window.SFRenderers && SFRenderers.resource) {
            SFRenderers.resource.drawResourceNode(ctx, obj, x, y, renderSize, colors);
        }
    } else if (isCelestial) {
        if (window.SFRenderers && SFRenderers.celestial) {
            SFRenderers.celestial.drawCelestialObject(ctx, obj, x, y, renderSize, colors, visibility, game);
        }
    } else {
        if (window.SFRenderers && SFRenderers.ship) {
            SFRenderers.ship.drawShipObject(ctx, obj, x, y, renderSize, colors, visibility, isOwned);
        }
    }

    ctx.restore();
}


