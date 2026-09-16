import { pickMapObject } from '../render/object-scale.js';
// Canvas input handlers and binding
import * as MoveCtl from '../features/movement-controller.js';

export function bindCanvasInputs(game) {
    const canvas = game.canvas;
    if (!canvas || canvas._canvasBound) return;
    canvas._canvasBound = true;

    canvas.tabIndex = 0;
    canvas.setAttribute('aria-label', 'Tactical map. Arrow keys pan, plus and minus zoom. Select a ship from Fleet to issue orders.');
    canvas.style.touchAction = 'none';
    const pointers = new Map(); let pinch = null;
    canvas.addEventListener('pointerdown', e => {
        if (e.button !== 0) return;
        canvas.setPointerCapture(e.pointerId); pointers.set(e.pointerId, {x:e.clientX,y:e.clientY});
        if (pointers.size === 2) {
            const [a,b] = [...pointers.values()];
            const rect = canvas.getBoundingClientRect();
            const mx = ((a.x+b.x)/2 - rect.left) * (canvas.width / Math.max(1, rect.width));
            const my = ((a.y+b.y)/2 - rect.top) * (canvas.height / Math.max(1, rect.height));
            pinch = {
                distance: Math.hypot(a.x-b.x,a.y-b.y), size:game.tileSize,
                worldX: game.camera.x + (mx - canvas.width/2) / game.tileSize,
                worldY: game.camera.y + (my - canvas.height/2) / game.tileSize
            };
            stopDragPan(game); if (game._dragPan) game._dragPan.movedEnough = true;
        } else startDragPan(game,e);
    });
    canvas.addEventListener('pointermove', e => {
        if (pointers.has(e.pointerId)) pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
        if (pinch && pointers.size >= 2) {
            const [a,b] = [...pointers.values()];
            const nextSize = Math.max(8,Math.min(40,pinch.size*Math.hypot(a.x-b.x,a.y-b.y)/Math.max(1,pinch.distance)));
            const rect = canvas.getBoundingClientRect();
            const mx = ((a.x+b.x)/2 - rect.left) * (canvas.width / Math.max(1, rect.width));
            const my = ((a.y+b.y)/2 - rect.top) * (canvas.height / Math.max(1, rect.height));
            game.tileSize = nextSize;
            game.camera.x = Math.max(0, Math.min(5000, pinch.worldX - (mx - canvas.width/2) / nextSize));
            game.camera.y = Math.max(0, Math.min(5000, pinch.worldY - (my - canvas.height/2) / nextSize));
            game.render(); return;
        }
        handleDragPan(game,e); handleMouseMove(game,e);
    });
    canvas.addEventListener('pointerup', e => {
        const wasPinch = !!pinch;
        pointers.delete(e.pointerId); stopDragPan(game);
        if (!pointers.size) pinch = null;
        if (e.pointerType !== 'mouse' && !wasPinch) {
            game._suppressTouchClick = true;
            setTimeout(() => { game._suppressTouchClick = false; }, 450);
            if (game._dragPan?.movedEnough) { game._dragPan.movedEnough=false; return; }
            handleMouseMove(game,e);
            const rect=canvas.getBoundingClientRect();
            const hit=pickMapObject(game,e.clientX-rect.left,e.clientY-rect.top);
            if (!hit && game.selectedUnit?.type==='ship' && !game.pendingAbility && !game.turnLocked) {
                game.touchDestination={...game.hoverWorld};
                game.touchShipId = Number(game.selectedUnit.id);
                game._suppressTouchClick = true;
                document.getElementById('touchOrderActions').hidden=false;
                document.getElementById('touchOrderLabel').textContent=`Move to ${game.touchDestination.x}, ${game.touchDestination.y}`;
                game.render();
            } else { cancelTouchOrder(); handleLeftClick(game,e); }
        }
    });
    canvas.addEventListener('pointercancel', e => { pointers.delete(e.pointerId); pinch=null; stopDragPan(game); });
    canvas.addEventListener('pointerleave', () => { if (!pointers.size) { game.hoverWorld=null; hideMapTooltip(game); game.render(); } });
    canvas.addEventListener('wheel', (e) => handleWheel(game, e), {passive:false});
    canvas.addEventListener('click', e => {
        if (game._suppressTouchClick) { game._suppressTouchClick = false; return; }
        if (!e.pointerType || e.pointerType==='mouse') handleLeftClick(game,e);
    });
    function cancelTouchOrder() { game.touchDestination=null; game.touchShipId=null; const el=document.getElementById('touchOrderActions'); if(el)el.hidden=true; game.render(); }
    document.getElementById('cancelTouchOrder')?.addEventListener('click',cancelTouchOrder);
    document.getElementById('confirmTouchOrder')?.addEventListener('click',async e => {
        if (!game.touchDestination || !game.selectedUnit || game.turnLocked) return;
        if (Number(game.selectedUnit.id) !== Number(game.touchShipId)) { cancelTouchOrder(); game.addLogEntry?.('Order preview cleared because the selected ship changed.', 'info'); return; }
        const button=e.currentTarget; button.disabled=true;
        try {
            const queue=await import('../features/queue-controller.js');
            const shipId = Number(game.touchShipId), destination = { ...game.touchDestination };
            const response = await new Promise(resolve => queue.addMove(game, shipId, destination.x, destination.y, resolve));
            if (response?.success) {
                game.addLogEntry?.(`Queued: Move to (${destination.x}, ${destination.y})`, 'success');
                cancelTouchOrder();
            } else {
                game.addLogEntry?.(response?.error || 'Could not queue movement. Try again.', 'error');
            }
        } catch (error) { game.addLogEntry?.('Could not queue movement. Try again.', 'error'); }
        finally { button.disabled=false; }
    });
    window.addEventListener('sf:always-grid-change',()=>game.render());
    canvas.addEventListener('keydown',e => {
        const pan={ArrowLeft:[-5,0],ArrowRight:[5,0],ArrowUp:[0,-5],ArrowDown:[0,5]}[e.key];
        if(pan){e.preventDefault();game.camera.x=Math.max(0,Math.min(5000,game.camera.x+pan[0]));game.camera.y=Math.max(0,Math.min(5000,game.camera.y+pan[1]));game.render();}
        if(['+','=','-'].includes(e.key)){e.preventDefault();game.tileSize=Math.max(8,Math.min(40,game.tileSize+(e.key==='-'?-2:2)));game.render();}
        if(e.key==='Escape'){game.pendingAbility=null;game.abilityHover=null;cancelTouchOrder();}
    });
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
    game.hoverWorld = { x: worldX, y: worldY };

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
