// Starfront: Dominion - Minimap interactions (global namespace)

(function(){
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
        window.SFMinimap.interactions = { bind };
    }
})();


