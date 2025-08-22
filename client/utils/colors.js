// Starfront: Dominion - Color utilities (global namespace)

(function(){
    function hexToRgba(hex, alpha) {
        try {
            const m = String(hex).replace('#', '');
            const r = parseInt(m.substring(0, 2), 16);
            const g = parseInt(m.substring(2, 4), 16);
            const b = parseInt(m.substring(4, 6), 16);
            return `rgba(${r}, ${g}, ${b}, ${alpha})`;
        } catch { return hex; }
    }

    if (typeof window !== 'undefined') {
        window.SFColors = window.SFColors || { hexToRgba };
    }
})();


