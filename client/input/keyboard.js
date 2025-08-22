// Starfront: Dominion - Keyboard input bindings (global namespace)

(function(){
    function bind(doc, game) {
        if (!doc || !game || doc._kbBound) return;
        doc._kbBound = true;
        doc.addEventListener('keydown', (e) => game.handleKeyboard && game.handleKeyboard(e));
        doc.addEventListener('keyup', (e) => game.handleKeyUp && game.handleKeyUp(e));
    }

    if (typeof window !== 'undefined') {
        window.SFInput = window.SFInput || {};
        window.SFInput.keyboard = { bind };
    }
})();


