// Starfront: Dominion - Unified Mouse & Keyboard input (global namespace)

(function(){
	function bindMouse(canvas, game) {
		if (!canvas || !game || canvas._mouseBound) return;
		canvas._mouseBound = true;

		canvas.addEventListener('click', (e) => game.handleCanvasClick && game.handleCanvasClick(e));
		canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); if (game.handleCanvasRightClick) game.handleCanvasRightClick(e); });
		canvas.addEventListener('mousemove', (e) => { if (game.handleCanvasMouseMove) game.handleCanvasMouseMove(e); });
		canvas.addEventListener('mousedown', (e) => game.startDragPan && game.startDragPan(e));
		canvas.addEventListener('mouseup', () => game.stopDragPan && game.stopDragPan());
		canvas.addEventListener('mouseleave', () => game.stopDragPan && game.stopDragPan());
		canvas.addEventListener('mousemove', (e) => game.handleDragPan && game.handleDragPan(e));
		canvas.addEventListener('mouseleave', () => game.hideMapTooltip && game.hideMapTooltip());
		canvas.addEventListener('wheel', (e) => game.handleCanvasWheel && game.handleCanvasWheel(e));
	}

	function bindKeyboard(doc, game) {
		if (!doc || !game || doc._kbBound) return;
		doc._kbBound = true;
		doc.addEventListener('keydown', (e) => game.handleKeyboard && game.handleKeyboard(e));
		doc.addEventListener('keyup', (e) => game.handleKeyUp && game.handleKeyUp(e));
	}

	if (typeof window !== 'undefined') {
		window.SFInput = window.SFInput || {};
		window.SFInput.mouse = { bind: bindMouse };
		window.SFInput.keyboard = { bind: bindKeyboard };
	}
})();


