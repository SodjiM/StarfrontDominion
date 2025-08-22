// Starfront: Dominion - Movement paths renderer (global namespace)

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

    function drawSingleMovementPath(ctx, centerX, centerY, ship, isLingering, camera, tileSize, userId, selectedUnit, gameState) {
        const hasOldPath = ship.movementPath && ship.movementPath.length > 1;
        const hasNewSegments = ship.movementSegments && ship.movementSegments.length > 0;
        if (!hasOldPath && !hasNewSegments) return;

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

        if (hasNewSegments) {
            ship.movementSegments.forEach(segment => {
                ctx.beginPath();
                const fromScreenX = centerX + (segment.from.x - camera.x) * tileSize;
                const fromScreenY = centerY + (segment.from.y - camera.y) * tileSize;
                const toScreenX = centerX + (segment.to.x - camera.x) * tileSize;
                const toScreenY = centerY + (segment.to.y - camera.y) * tileSize;
                ctx.moveTo(fromScreenX, fromScreenY);
                ctx.lineTo(toScreenX, toScreenY);
                ctx.stroke();
            });
        } else if (hasOldPath) {
            const path = ship.movementPath;
            ctx.beginPath();
            for (let i = 0; i < path.length; i++) {
                const tile = path[i];
                const screenX = centerX + (tile.x - camera.x) * tileSize;
                const screenY = centerY + (tile.y - camera.y) * tileSize;
                if (i === 0) ctx.moveTo(screenX, screenY); else ctx.lineTo(screenX, screenY);
            }
            ctx.stroke();
        }

        const currentScreenX = centerX + (ship.x - camera.x) * tileSize;
        const currentScreenY = centerY + (ship.y - camera.y) * tileSize;
        ctx.setLineDash([]);
        if (!isLingering) {
            ctx.beginPath();
            if (isSelected) ctx.fillStyle = '#4caf50'; else if (isOwned) ctx.fillStyle = '#66bb6a'; else ctx.fillStyle = '#ef5350';
            ctx.arc(currentScreenX, currentScreenY, isSelected ? 7 : 5, 0, Math.PI * 2);
            ctx.fill();
        }

        let destinationPoint = null;
        if (hasNewSegments && ship.movementSegments.length > 0) destinationPoint = ship.movementSegments[ship.movementSegments.length - 1].to;
        else if (hasOldPath) destinationPoint = ship.movementPath[ship.movementPath.length - 1];

        if (destinationPoint) {
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
                    let eta = ship.movementETA;
                    let usingServerETA = ship.movementETA !== undefined;
                    if (eta === undefined && hasOldPath) {
                        eta = calculateETA(ship.movementPath, ship.meta && ship.meta.movementSpeed || 1, selectedUnit && selectedUnit.meta, gameState && gameState.currentTurn);
                        usingServerETA = false;
                    } else if (eta === undefined) {
                        eta = 0; usingServerETA = false;
                    }
                    if (isSelected && (!this._lastETADebug || this._lastETADebug !== `${ship.id}-${eta}`)) {
                        if (window.SF_DEV_MODE) console.log(`📊 ETA Display: Ship ${ship.id} showing ${eta}T (${usingServerETA ? 'server-provided' : 'client-calculated'})`);
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
        const activeShips = objects.filter(obj => obj.type === 'ship' && obj.movementPath && obj.movementPath.length > 1 && obj.movementActive && obj.movementStatus === 'active' && (obj.visibilityStatus && obj.visibilityStatus.visible || obj.owner_id === userId));
        const serverLingeringShips = [];

        const currentTurn = gameState && gameState.currentTurn && gameState.currentTurn.turn_number || 1;
        const minTurn = currentTurn - 9;
        for (let t = minTurn; t <= currentTurn; t++) {
            const segs = (trailBuffer && trailBuffer.byTurn && trailBuffer.byTurn.get) ? (trailBuffer.byTurn.get(t) || []) : [];
            const age = currentTurn - t;
            const alpha = Math.max(0.06, 0.28 - age * 0.02);
            ctx.save();
            ctx.strokeStyle = `rgba(100, 181, 246, ${alpha})`;
            ctx.lineWidth = 2;
            ctx.setLineDash([]);
            segs.forEach(seg => {
                const x1 = centerX + (seg.from.x - camera.x) * tileSize;
                const y1 = centerY + (seg.from.y - camera.y) * tileSize;
                const x2 = centerX + (seg.to.x - camera.x) * tileSize;
                const y2 = centerY + (seg.to.y - camera.y) * tileSize;
                ctx.beginPath();
                ctx.moveTo(x1, y1);
                ctx.lineTo(x2, y2);
                ctx.stroke();
                const vx = x2 - x1, vy = y2 - y1;
                const len = Math.hypot(vx, vy) || 1;
                const ux = vx / len, uy = vy / len;
                const ah = Math.max(2, tileSize * 0.25);
                const px = x2 - ux * ah, py = y2 - uy * ah;
                ctx.beginPath();
                ctx.moveTo(x2, y2);
                ctx.lineTo(px + (-uy) * ah * 0.4, py + (ux) * ah * 0.4);
                ctx.moveTo(x2, y2);
                ctx.lineTo(px + (uy) * ah * 0.4, py + (-ux) * ah * 0.4);
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
    }

    if (typeof window !== 'undefined') {
        window.SFRenderers = window.SFRenderers || {};
        window.SFRenderers.movement = { drawMovementPaths };
    }
})();


