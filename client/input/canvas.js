import { pickMapObject } from '../render/object-scale.js';
// Canvas input handlers and binding
import * as MoveCtl from '../features/movement-controller.js';

export function bindCanvasInputs(game) {
    const canvas = game.canvas;
    if (!canvas || canvas._canvasBound) return;
    canvas._canvasBound = true;

    canvas.addEventListener('mousemove', (e) => handleMouseMove(game, e));
    canvas.addEventListener('mousedown', (e) => startDragPan(game, e));
    canvas.addEventListener('mouseup', () => stopDragPan(game));
    canvas.addEventListener('mouseleave', () => { stopDragPan(game); hideMapTooltip(game); });
    canvas.addEventListener('mousemove', (e) => handleDragPan(game, e));
    canvas.addEventListener('wheel', (e) => handleWheel(game, e));
    canvas.addEventListener('click', (e) => handleLeftClick(game, e));
    canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); handleRightClick(game, e); });
}

export function handleMouseMove(game, e) {
    const rect = game.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const centerX = game.canvas.width / 2;
    const centerY = game.canvas.height / 2;
    const worldX = Math.round(game.camera.x + (x - centerX) / game.tileSize);
    const worldY = Math.round(game.camera.y + (y - centerY) / game.tileSize);

    const hoveredObject = pickMapObject(game, x, y);

    game.updateMapTooltip && game.updateMapTooltip(hoveredObject, x, y);

    if (game.pendingAbility && game.selectedUnit) {
        const { key, def } = game.pendingAbility;
        if (def.target === 'position') {
            game.abilityHover = game.computePositionAbilityHover(key, worldX, worldY);
        } else {
            game.abilityHover = null;
        }
    } else {
        game.abilityHover = null;
    }
    game.render && game.render();

    if (!game.selectedUnit || game.turnLocked) {
        game.canvas.style.cursor = hoveredObject ? 'pointer' : 'default';
        return;
    }
    if (hoveredObject) {
        game.canvas.style.cursor = hoveredObject.owner_id === game.userId ? 'pointer' : 'crosshair';
    } else if (game.selectedUnit.type === 'ship') {
        game.canvas.style.cursor = 'move';
    } else {
        game.canvas.style.cursor = 'default';
    }
}

export function startDragPan(game, e) {
    if (e.button !== 0) return;
    const rect = game.canvas.getBoundingClientRect();
    game._dragPan = {
        active: true,
        startX: e.clientX - rect.left,
        startY: e.clientY - rect.top,
        cameraX: game.camera.x,
        cameraY: game.camera.y,
        movedEnough: false
    };
    game.canvas.style.cursor = 'grabbing';
}

export function stopDragPan(game) {
    if (game._dragPan) game._dragPan.active = false;
    game.canvas.style.cursor = 'default';
}

export function handleDragPan(game, e) {
    if (!game._dragPan || !game._dragPan.active) return;
    const rect = game.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const dx = x - game._dragPan.startX;
    const dy = y - game._dragPan.startY;
    const tilesDX = dx / game.tileSize;
    const tilesDY = dy / game.tileSize;
    game.camera.x = Math.max(0, Math.min(5000, game._dragPan.cameraX - tilesDX));
    game.camera.y = Math.max(0, Math.min(5000, game._dragPan.cameraY - tilesDY));
    if (!game._dragPan.movedEnough && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) {
        game._dragPan.movedEnough = true;
    }
    game.render && game.render();
}

export function hideMapTooltip(game) {
    game.hideMapTooltip && game.hideMapTooltip();
}

export function handleWheel(game, e) {
    e.preventDefault();
    const rect = game.canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const centerX = game.canvas.width / 2;
    const centerY = game.canvas.height / 2;
    const worldX = game.camera.x + (mouseX - centerX) / game.tileSize;
    const worldY = game.camera.y + (mouseY - centerY) / game.tileSize;
    const zoomIn = e.deltaY < 0;
    const oldTileSize = game.tileSize;
    if (zoomIn && game.tileSize < 40) game.tileSize += 2;
    else if (!zoomIn && game.tileSize > 8) game.tileSize -= 2;
    if (game.tileSize !== oldTileSize) {
        const newWorldX = game.camera.x + (mouseX - centerX) / game.tileSize;
        const newWorldY = game.camera.y + (mouseY - centerY) / game.tileSize;
        game.camera.x += worldX - newWorldX;
        game.camera.y += worldY - newWorldY;
        game.render && game.render();
    }
}

export function handleLeftClick(game, e) {
    if (game._dragPan && game._dragPan.active === false && game._dragPan.movedEnough) {
        game._dragPan.movedEnough = false;
        return;
    }
    const rect = game.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const centerX = game.canvas.width / 2;
    const centerY = game.canvas.height / 2;
    const worldX = Math.round(game.camera.x + (x - centerX) / game.tileSize);
    const worldY = Math.round(game.camera.y + (y - centerY) / game.tileSize);

    const clickedObject = pickMapObject(game, x, y);

    if (game.pendingAbility) {
        const { key, def } = game.pendingAbility;
        if (def.target === 'position') {
            const hover = game.computePositionAbilityHover(key, worldX, worldY);
            if (!hover || !hover.valid) { game.addLogEntry('Invalid destination for ability', 'warning'); return; }
            import('../features/queue-controller.js').then(Queue => Queue.addAbility(game, game.selectedUnit?.id, key, { target: { x: worldX, y: worldY } }));
            game.addLogEntry(`Queued ${def.name} at (${worldX},${worldY})`, 'info');
            game.pendingAbility = null; game.abilityPreview = null; game.abilityHover = null; game.updateUnitDetails && game.updateUnitDetails();
            return;
        }
        if ((def.target === 'enemy' || def.target === 'ally') && clickedObject) {
            if (def.range && game.selectedUnit) {
                const dx = clickedObject.x - game.selectedUnit.x; const dy = clickedObject.y - game.selectedUnit.y; const d = Math.hypot(dx, dy);
                if (d > def.range) game.addLogEntry('Target currently out of range; will fire if in range after utility phase.', 'warning');
            }
            import('../features/queue-controller.js').then(Queue => Queue.addAbility(game, game.selectedUnit?.id, key, { targetObjectId: clickedObject.id }));
            game.addLogEntry(`Queued ${def.name} on ${clickedObject.meta?.name || clickedObject.type}`, 'info');
            game.pendingAbility = null; game.abilityPreview = null; game.abilityHover = null; game.updateUnitDetails && game.updateUnitDetails();
            return;
        }
    }

    if (clickedObject && clickedObject.owner_id === game.userId) {
        game.selectUnit(clickedObject.id);
        return;
    }
}

export function handleRightClick(game, e) {
    if (!game.selectedUnit || game.turnLocked) return;
    if (game.selectedUnit.type !== 'ship') return;
    const rect = game.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const centerX = game.canvas.width / 2;
    const centerY = game.canvas.height / 2;
    const worldX = Math.round(game.camera.x + (x - centerX) / game.tileSize);
    const worldY = Math.round(game.camera.y + (y - centerY) / game.tileSize);

    const clickedObject = pickMapObject(game, x, y);

    if (clickedObject && clickedObject.type === 'resource_node') {
        const target = clickedObject;
        const adj = game.getAdjacentTileNear(target.x, target.y, game.selectedUnit.x, game.selectedUnit.y);
        if (adj) {
            import('../features/queue-controller.js').then(mod => {
                mod.addMove(game, game.selectedUnit.id, adj.x, adj.y, () => {});
                mod.addHarvestStart(game, game.selectedUnit.id, target.id, () => {});
            });
            game.addLogEntry(`Queued: Move next to and mine ${target.meta?.resourceType || 'resource'}`, 'info');
        } else {
            import('../features/queue-controller.js').then(mod => mod.addMove(game, game.selectedUnit.id, worldX, worldY, () => {}));
            game.addLogEntry(`Queued: Move to (${worldX}, ${worldY})`, 'info');
        }
        return;
    }

    if (!clickedObject) {
        import('../features/queue-controller.js').then(mod => mod.addMove(game, game.selectedUnit.id, worldX, worldY, () => {}));
        game.addLogEntry(`Queued: Move to (${worldX}, ${worldY})`, 'info');
        return;
    }
    if (clickedObject.owner_id === game.userId) {
        game.selectUnit(clickedObject.id);
        game.addLogEntry(`Selected ${clickedObject.meta?.name || clickedObject.type}`, 'info');
    } else {
        game.addLogEntry('Use an ability to target enemies', 'info');
    }
}

