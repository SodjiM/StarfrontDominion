// Starfront: Dominion - Client constants (global namespace)

(function(){
    const SFConstants = {
        WORLD: {
            WIDTH: 5000,
            HEIGHT: 5000
        },
        TILE: {
            MIN: 8,
            MAX: 40,
            STEP: 2
        }
    };

    if (typeof window !== 'undefined') {
        window.SFConstants = window.SFConstants || SFConstants;
    }
})();


