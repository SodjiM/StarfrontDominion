// Starfront: Dominion - Game state normalizers (global namespace)

(function(){
    function parseMetaIfString(obj) {
        if (!obj) return obj;
        if (obj.meta && typeof obj.meta === 'string') {
            try { obj.meta = JSON.parse(obj.meta); } catch { obj.meta = {}; }
        }
        return obj;
    }

    function normalizeObjects(objects) {
        if (!Array.isArray(objects)) return [];
        return objects.map(o => parseMetaIfString(o));
    }

    function normalizeGameState(state) {
        if (!state || typeof state !== 'object') return state;
        if (Array.isArray(state.objects)) {
            state.objects = normalizeObjects(state.objects);
        }
        return state;
    }

    if (typeof window !== 'undefined') {
        window.SFNormalizers = window.SFNormalizers || { normalizeGameState, normalizeObjects, parseMetaIfString };
    }
})();


