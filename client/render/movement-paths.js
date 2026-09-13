// Starfront: Dominion - Movement paths renderer (global namespace)

import { calculatePlannedETA } from '../utils/planned-movement.js';

(function(){
    function calculateETA(path, movementSpeed, selectedUnitMeta, currentTurn) {
        if (!path || path.length <= 1) return 0;
        const distance = path.length - 1;
        let effectiveSpeed = movementSpeed || 1;
        try {
            const meta = selectedUnitMeta || {};
            if (typeof meta.movementFlatBonus === 'number') {
                effectiveSpeed += Math.max(0, Math.floor(meta.movementFlatBonus));
            }
        } catch {}
        return Math.ceil(distance / Math.max(1, effectiveSpeed));
    }

    // Movement is still resolved on the full tile path. This only removes
    // redundant collinear points for drawing, so long routes do not look like
    // a staircase of tiny line segments or spend needless canvas work on them.
    function simplifyPath(path) {
        if (!Array.isArray(path) || path.length < 3) return path || [];
        const result = [path[0]];
        let previousDx = Math.sign(path[1].x - path[0].x);
        let previousDy = Math.sign(path[1].y - path[0].y);
        for (let i = 1; i < path.length - 1; i++) {
            const dx = Math.sign(path[i + 1].x - path[i].x);
            const dy = Math.sign(path[i + 1].y - path[i].y);
            if (dx !== previousDx || dy !== previousDy) result.push(path[i]);
            previousDx = dx;
            previousDy = dy;
        }
        result.push(path[path.length - 1]);
        return result;
    }

    function drawPolyline(ctx, points, project) {
        if (!Array.isArray(points) || points.length < 2) return;
        ctx.beginPath();
        points.forEach((point, index) => {
            const screen = project(point);
            if (index === 0) ctx.moveTo(screen.x, screen.y);
            else ctx.lineTo(screen.x, screen.y);
        });
        ctx.stroke();
    }

    function drawSingleMovementPath(ctx, centerX, centerY, ship, isLingering, camera, tileSize, userId, selectedUnit, gameState) {
        let hasOldPath = ship.movementPath && ship.movementPath.length > 1;
        const hasNewSegments = ship.movementSegments && ship.movementSegments.length > 0;
        const hasLaneTransit = ship.laneTransit && Array.isArray(ship.laneTransit.polyline) && ship.laneTransit.polyline.length > 1;
        if (!hasOldPath && !hasNewSegments && !hasLaneTransit) return;

        if (isLingering && ship.movementStatus === 'active') return;
        if (!isLingering && ship.movementStatus === 'completed' && !ship.movementActive) return;

        const isSelected = selectedUnit && selectedUnit.id === ship.id;
        const isOwned = ship.owner_id === userId;
        const isAccurate = ship.isAccurate === true;

        ctx.save();

        if (isLingering) {
            if (isAccurate) {
                if (isSelected) { ctx.strokeStyle = '#fff59d'; ctx.lineWidth = 2; ctx.globalAlpha = 0.5; }
                else if (isOwned) { ctx.strokeStyle = '#a5d6a7'; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.4; }
                else { ctx.strokeStyle = '#ef9a9a'; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.35; }
                ctx.setLineDash([2, 4]);
            } else {
                if (isSelected) { ctx.strokeStyle = '#fff9c4'; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.3; }
                else if (isOwned) { ctx.strokeStyle = '#c8e6c9'; ctx.lineWidth = 1; ctx.globalAlpha = 0.25; }
                else { ctx.strokeStyle = '#ffcdd2'; ctx.lineWidth = 1; ctx.globalAlpha = 0.2; }
                ctx.setLineDash([3, 8]);
            }
        } else {
            if (isSelected) { ctx.strokeStyle = '#ffeb3b'; ctx.lineWidth = 3; ctx.globalAlpha = 1.0; }
            else if (isOwned) { ctx.strokeStyle = '#8bc34a'; ctx.lineWidth = 2; ctx.globalAlpha = 0.8; }
            else { ctx.strokeStyle = '#f44336'; ctx.lineWidth = 2; ctx.globalAlpha = 0.7; }
            ctx.setLineDash([5, 5]);
        }

        if (hasLaneTransit && !isLingering) {
            ctx.strokeStyle = isSelected ? '#e1bee7' : '#b388ff';
            ctx.lineWidth = isSelected ? 3.5 : 2.5;
            ctx.globalAlpha = isSelected ? 0.95 : 0.72;
            ctx.setLineDash([8, 6]);
        }

        // If actively moving but path missing, synthesize a temporary path from current -> plannedDestination
        let synthesizedPath = null;
        if (!hasOldPath && ship.movementActive && ship.plannedDestination && typeof ship.plannedDestination.x === 'number') {
            try { if (this && typeof this.calculateMovementPath === 'function') synthesizedPath = this.calculateMovementPath(ship.x, ship.y, ship.plannedDestination.x, ship.plannedDestination.y); } catch {}
            if (Array.isArray(synthesizedPath) && synthesizedPath.length > 1) hasOldPath = true;
        }

        // Draw active path first if present (real or synthesized)
        if (hasOldPath) {
            const path = simplifyPath((synthesizedPath && synthesizedPath.length > 1) ? synthesizedPath : ship.movementPath);
            drawPolyline(ctx, path, tile => ({
                x: centerX + (tile.x - camera.x) * tileSize,
                y: centerY + (tile.y - camera.y) * tileSize
            }));
        }

        if (hasLaneTransit && !isLingering) {
            const lanePath = simplifyPath(ship.laneTransit.polyline);
            drawPolyline(ctx, lanePath, tile => ({
                x: centerX + (tile.x - camera.x) * tileSize,
                y: centerY + (tile.y - camera.y) * tileSize
            }));
        }

        // Then queued future segments (if any), ensuring continuous chain visualization
        if (hasNewSegments) {
            ship.movementSegments.forEach(segment => {
                ctx.beginPath();
                const path = Array.isArray(segment.path) && segment.path.length > 1 ? segment.path : [segment.from, segment.to];
                path.forEach((tile, index) => {
                    const screenX = centerX + (tile.x - camera.x) * tileSize;
                    const screenY = centerY + (tile.y - camera.y) * tileSize;
                    if (index === 0) ctx.moveTo(screenX, screenY); else ctx.lineTo(screenX, screenY);
                });
                ctx.stroke();
            });
        }

        const currentScreenX = centerX + (ship.x - camera.x) * tileSize;
        const currentScreenY = centerY + (ship.y - camera.y) * tileSize;
        ctx.setLineDash([]);
        
        // Warp Streak Effect for ships in lanes
        const isInLane = hasLaneTransit || ship.movementStatus === 'warp' || (this && this.__laneTransitsCache?.rows?.some(r => r.shipId === ship.id));
        if (isInLane && !isLingering) {
            ctx.save();
            const streakLen = 20;
            const grad = ctx.createRadialGradient(currentScreenX, currentScreenY, 0, currentScreenX, currentScreenY, streakLen);
            grad.addColorStop(0, 'rgba(138, 43, 226, 0.8)');
            grad.addColorStop(1, 'rgba(138, 43, 226, 0)');
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(currentScreenX, currentScreenY, streakLen, 0, Math.PI * 2);
            ctx.fill();
            
            // Pulsing core
            const pulse = (Math.sin(Date.now() / 100) + 1) / 2;
            ctx.fillStyle = `rgba(255, 255, 255, ${0.4 + pulse * 0.4})`;
            ctx.beginPath();
            ctx.arc(currentScreenX, currentScreenY, 3 + pulse * 2, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }

        if (!isLingering) {
            ctx.beginPath();
            if (isSelected) ctx.fillStyle = '#4caf50'; else if (isOwned) ctx.fillStyle = '#66bb6a'; else ctx.fillStyle = '#ef5350';
            ctx.arc(currentScreenX, currentScreenY, isSelected ? 7 : 5, 0, Math.PI * 2);
            ctx.fill();
        }

        let destinationPoint = null;
        if (hasNewSegments && ship.movementSegments.length > 0) destinationPoint = ship.movementSegments[ship.movementSegments.length - 1].to;
        else if (hasOldPath) {
            const path = (synthesizedPath && synthesizedPath.length > 1) ? synthesizedPath : ship.movementPath;
            destinationPoint = path[path.length - 1];
        }

        if (destinationPoint && !hasLaneTransit) {
            const destScreenX = centerX + (destinationPoint.x - camera.x) * tileSize;
            const destScreenY = centerY + (destinationPoint.y - camera.y) * tileSize;
            if (isLingering) {
                if (isSelected) ctx.fillStyle = '#fff59d'; else if (isOwned) ctx.fillStyle = '#c8e6c9'; else ctx.fillStyle = '#ffcdd2';
                ctx.globalAlpha = 0.3;
                ctx.beginPath();
                ctx.arc(destScreenX, destScreenY, 4, 0, Math.PI * 2);
                ctx.fill();
            } else {
                if (isSelected) ctx.fillStyle = '#ffeb3b'; else if (isOwned) ctx.fillStyle = '#8bc34a'; else ctx.fillStyle = '#f44336';
                ctx.beginPath();
                ctx.arc(destScreenX, destScreenY, isSelected ? 8 : 6, 0, Math.PI * 2);
                ctx.fill();
                if (isSelected || isOwned) {
                    let eta = ship.plannedETA;
                    let usingPlanETA = ship.plannedETA !== undefined;
                    if (eta === undefined && (hasNewSegments || hasOldPath)) eta = calculatePlannedETA(ship, selectedUnit);
                    let usingServerETA = ship.movementETA !== undefined && !hasNewSegments;
                    if (eta === undefined) eta = ship.movementETA;
                    if (eta === undefined && hasOldPath) {
                        eta = calculateETA(ship.movementPath, ship.meta && ship.meta.movementSpeed || 1, selectedUnit && selectedUnit.meta, gameState && gameState.currentTurn);
                        usingPlanETA = false;
                    } else if (eta === undefined) {
                        eta = 0; usingServerETA = false;
                    }
                    if (isSelected && (!this._lastETADebug || this._lastETADebug !== `${ship.id}-${eta}`)) {
                        if (window.SF_DEV_MODE) console.log(`📊 ETA Display: Ship ${ship.id} showing ${eta}T (${usingPlanETA ? 'full-plan' : (usingServerETA ? 'server-provided' : 'client-calculated')})`);
                        this._lastETADebug = `${ship.id}-${eta}`;
                    }
                    if (eta > 0) {
                        ctx.fillStyle = '#ffffff';
                        ctx.font = '12px Arial';
                        ctx.textAlign = 'center';
                        ctx.fillText(`ETA: ${eta}T`, destScreenX, destScreenY - 15);
                    }
                }
            }
        }

        ctx.restore();
    }

    function drawMovementPaths(ctx, canvas, objects, userId, camera, tileSize, selectedUnit, gameState, trailBuffer) {
        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;
        const activeShips = objects.filter(obj => obj.type === 'ship' && (obj.movementPath && obj.movementPath.length > 1 && obj.movementActive && obj.movementStatus === 'active' || obj.laneTransit) && (obj.visibilityStatus && obj.visibilityStatus.visible || obj.owner_id === userId));
        const serverLingeringShips = [];

        const currentTurn = gameState && gameState.currentTurn && gameState.currentTurn.turn_number || 1;
        const minTurn = currentTurn - 9;
        for (let t = minTurn; t <= currentTurn; t++) {
            const segs = (trailBuffer && trailBuffer.byTurn && trailBuffer.byTurn.get) ? (trailBuffer.byTurn.get(t) || []) : [];
            const age = currentTurn - t;
            const alpha = Math.max(0.06, 0.28 - age * 0.02);
            ctx.save();
            ctx.strokeStyle = `rgba(100, 181, 246, ${alpha})`;
            ctx.lineWidth = age === 0 ? 2.5 : 1.5;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.setLineDash([]);

            // A history row is one turn's displacement, not one visual arrow.
            // Chain contiguous rows per ship/turn and place a single arrow at
            // the newest end so trails read as movement direction instead of
            // a dense row of chevrons.
            const chains = new Map();
            segs.forEach(seg => {
                const key = String(seg.shipId ?? `${seg.from?.x},${seg.from?.y}`);
                if (!chains.has(key)) chains.set(key, []);
                const chain = chains.get(key);
                const last = chain[chain.length - 1];
                if (last && last.x === seg.from.x && last.y === seg.from.y) chain.push({ x: seg.to.x, y: seg.to.y });
                else if (!chain.length) chain.push({ x: seg.from.x, y: seg.from.y }, { x: seg.to.x, y: seg.to.y });
                else chain.push({ x: seg.from.x, y: seg.from.y }, { x: seg.to.x, y: seg.to.y });
            });
            chains.forEach(chain => {
                const points = simplifyPath(chain);
                drawPolyline(ctx, points, point => ({
                    x: centerX + (point.x - camera.x) * tileSize,
                    y: centerY + (point.y - camera.y) * tileSize
                }));
                const end = points[points.length - 1], prev = points[points.length - 2];
                const x2 = centerX + (end.x - camera.x) * tileSize;
                const y2 = centerY + (end.y - camera.y) * tileSize;
                const vx = x2 - (centerX + (prev.x - camera.x) * tileSize);
                const vy = y2 - (centerY + (prev.y - camera.y) * tileSize);
                const len = Math.hypot(vx, vy) || 1, ux = vx / len, uy = vy / len;
                const ah = Math.max(3, Math.min(8, tileSize * 0.22));
                ctx.beginPath();
                ctx.moveTo(x2, y2);
                ctx.lineTo(x2 - ux * ah - uy * ah * 0.55, y2 - uy * ah + ux * ah * 0.55);
                ctx.moveTo(x2, y2);
                ctx.lineTo(x2 - ux * ah + uy * ah * 0.55, y2 - uy * ah - ux * ah * 0.55);
                ctx.stroke();
            });
            ctx.restore();
        }

        const clientLingeringShips = (this && this.clientLingeringTrails ? this.clientLingeringTrails : []).filter(trail => {
            const hasValidPath = (trail.movementPath && trail.movementPath.length > 1) || (trail.movementSegments && trail.movementSegments.length > 0);
            return hasValidPath;
        });

        const allLingeringShips = [...serverLingeringShips, ...clientLingeringShips];
        const activeShipIds = new Set(activeShips.map(s => s.id));
        const filteredLingeringShips = allLingeringShips.filter(ship => !activeShipIds.has(ship.id || ship.shipId));

        filteredLingeringShips.forEach(ship => drawSingleMovementPath.call(this, ctx, centerX, centerY, ship, true, camera, tileSize, userId, selectedUnit, gameState));
        activeShips.forEach(ship => drawSingleMovementPath.call(this, ctx, centerX, centerY, ship, false, camera, tileSize, userId, selectedUnit, gameState));

        // Ensure selected unit shows queued preview even if not actively moving yet
        try {
            if (selectedUnit && selectedUnit.type === 'ship') {
                const alreadyDrawn = activeShips.some(s => s.id === selectedUnit.id);
                const hasPreview = (selectedUnit.movementSegments && selectedUnit.movementSegments.length > 0) || (selectedUnit.movementActive && (!selectedUnit.movementPath || selectedUnit.movementPath.length <= 1));
                if (!alreadyDrawn && hasPreview) {
                    drawSingleMovementPath.call(this, ctx, centerX, centerY, selectedUnit, false, camera, tileSize, userId, selectedUnit, gameState);
                }
            }
        } catch {}
    }

    if (typeof window !== 'undefined') {
        window.SFRenderers = window.SFRenderers || {};
        window.SFRenderers.movement = { drawMovementPaths };
    }
})();
