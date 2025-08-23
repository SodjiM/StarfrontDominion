// Starfront: Dominion - Minimap (renderer + interactions, global namespace)

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

	function bind(canvas, getState, onPanTo) {
		if (!canvas || canvas._miniBound) return;
		canvas._miniBound = true;
		let dragging = false;
		const toWorld = (mx, my) => {
			const width = canvas.width; const height = canvas.height;
			return {
				x: Math.round((mx / width) * 5000),
				y: Math.round((my / height) * 5000)
			};
		};
		const handle = (clientX, clientY) => {
			const rect = canvas.getBoundingClientRect();
			const scaleX = canvas.width / rect.width;
			const scaleY = canvas.height / rect.height;
			const mx = Math.max(0, Math.min(canvas.width, (clientX - rect.left) * scaleX));
			const my = Math.max(0, Math.min(canvas.height, (clientY - rect.top) * scaleY));
			const w = toWorld(mx, my);
			onPanTo(w.x, w.y);
		};
		canvas.addEventListener('mousedown', (e) => { dragging = true; handle(e.clientX, e.clientY); });
		window.addEventListener('mouseup', () => { dragging = false; });
		canvas.addEventListener('mousemove', (e) => { if (dragging) handle(e.clientX, e.clientY); });
		canvas.addEventListener('click', (e) => { handle(e.clientX, e.clientY); });
		canvas.addEventListener('dragstart', (e) => e.preventDefault());
	}

	if (typeof window !== 'undefined') {
		window.SFMinimap = window.SFMinimap || {};
		window.SFMinimap.renderer = { renderMiniMap };
		window.SFMinimap.interactions = { bind };
	}
})();

export function toggleFloatingMiniMap(game) {
    if (!game._floatingMini) {
        const parent = game.canvas.parentElement;
        const container = document.createElement('div');
        container.id = 'floatingMiniWrap';
        container.style.position = 'absolute';
        container.style.zIndex = '2000';
        container.style.border = '1px solid rgba(100,181,246,0.3)';
        container.style.borderRadius = '10px';
        container.style.background = '#0a0f1c';
        container.style.boxShadow = '0 10px 30px rgba(0,0,0,0.35)';
        container.style.pointerEvents = 'auto';
        container.style.overflow = 'hidden';
        container.style.display = 'flex';
        container.style.flexDirection = 'column';
        container.style.boxSizing = 'border-box';
        container.style.resize = 'both';
        container.style.minWidth = '200px';
        container.style.minHeight = '140px';
        const initialW = 260, initialH = 180, margin = 12;
        container.style.width = initialW + 'px';
        container.style.height = initialH + 'px';
        container.style.left = margin + 'px';
        const parentH = parent ? parent.clientHeight : 0;
        container.style.top = Math.max(0, parentH - margin - initialH) + 'px';

        const header = document.createElement('div');
        header.style.height = '26px';
        header.style.background = 'rgba(10, 15, 28, 0.9)';
        header.style.borderBottom = '1px solid rgba(100,181,246,0.3)';
        header.style.display = 'flex';
        header.style.alignItems = 'center';
        header.style.justifyContent = 'space-between';
        header.style.padding = '0 8px';
        header.style.cursor = 'move';
        header.style.userSelect = 'none';
        header.innerHTML = '<span style="font-size:12px;color:#cfe4ff;display:flex;align-items:center;gap:6px"><span style="opacity:0.7">⠿</span> Mini-map</span><button title="Close" style="background:none;border:none;color:#cfe4ff;cursor:pointer;font-size:14px;line-height:1">×</button>';

        const closeBtn = header.querySelector('button');
        closeBtn.addEventListener('click', () => { container.style.display = 'none'; });

        const mini = document.createElement('canvas');
        mini.style.display = 'block';
        mini.style.width = '100%';
        mini.style.height = '100%';
        mini.width = initialW; mini.height = initialH - 26;

        container.appendChild(header);
        container.appendChild(mini);
        parent.appendChild(container);

        const clampWithinParent = () => {
            if (!parent) return;
            const maxLeft = Math.max(0, parent.clientWidth - container.offsetWidth);
            const maxTop = Math.max(0, parent.clientHeight - container.offsetHeight);
            const left = Math.min(Math.max(0, container.offsetLeft), maxLeft);
            const top = Math.min(Math.max(0, container.offsetTop), maxTop);
            container.style.left = left + 'px';
            container.style.top = top + 'px';
        };

        game._floatingMini = { container, header, canvas: mini, ctx: mini.getContext('2d'), dragging: false, dragDX:0, dragDY:0 };

        header.addEventListener('mousedown', (e)=>{
            game._floatingMini.dragging = true;
            game._floatingMini.dragDX = e.clientX - container.offsetLeft;
            game._floatingMini.dragDY = e.clientY - container.offsetTop;
            e.preventDefault();
        });
        window.addEventListener('mousemove', (e)=>{
            const f=game._floatingMini; if (!f||!f.dragging) return;
            const newLeft = Math.min(Math.max(0, e.clientX - f.dragDX), parent.clientWidth - container.offsetWidth);
            const newTop = Math.min(Math.max(0, e.clientY - f.dragDY), parent.clientHeight - container.offsetHeight);
            container.style.left = newLeft + 'px';
            container.style.top = newTop + 'px';
        });
        window.addEventListener('mouseup', ()=>{ if (game._floatingMini) game._floatingMini.dragging=false; });

        const ro = new ResizeObserver(()=>{
            const borderComp = 2;
            const contentW = Math.max(1, Math.floor(container.clientWidth - borderComp));
            const contentH = Math.max(1, Math.floor(container.clientHeight - header.offsetHeight - borderComp));
            if (mini.width !== contentW || mini.height !== contentH) {
                mini.width = contentW;
                mini.height = contentH;
                renderFloatingMini(game);
            }
            clampWithinParent();
        });
        ro.observe(container);
        game._floatingMini.ro = ro;
        clampWithinParent();
        renderFloatingMini(game);
    } else {
        const visible = game._floatingMini.container.style.display !== 'none';
        game._floatingMini.container.style.display = visible ? 'none' : 'flex';
        if (!visible) {
            const parent = game.canvas.parentElement;
            const { container } = game._floatingMini;
            const maxLeft = Math.max(0, parent.clientWidth - container.offsetWidth);
            const maxTop = Math.max(0, parent.clientHeight - container.offsetHeight);
            const left = Math.min(Math.max(0, container.offsetLeft), maxLeft);
            const top = Math.min(Math.max(0, container.offsetTop), maxTop);
            container.style.left = left + 'px';
            container.style.top = top + 'px';
            renderFloatingMini(game);
        }
    }
}

export function renderFloatingMini(game) {
    if (!game._floatingMini || !game.objects) return;
    const { canvas, ctx } = game._floatingMini;
    game.miniCanvas = canvas; game.miniCtx = ctx;
    if (game._miniBoundCanvas !== game.miniCanvas) {
        game._miniBound = false;
        if (window.SFMinimap && window.SFMinimap.interactions && typeof window.SFMinimap.interactions.bind === 'function') {
            window.SFMinimap.interactions.bind(
                game.miniCanvas,
                ()=>({ camera: game.camera, tileSize: game.tileSize }),
                (x,y)=>{ game.camera.x=x; game.camera.y=y; game.render(); }
            );
        }
    }
}


