// Keyboard input binding and handlers

export function bind(doc, game) {
    if (!doc || !game || doc._kbBound) return;
    doc._kbBound = true;
    doc.addEventListener('keydown', (e) => handleKeyDown(game, e));
    doc.addEventListener('keyup', (e) => handleKeyUp(game, e));
}

export function handleKeyDown(game, e) {
    switch(e.key) {
        case 'Escape':
            break;
        case 'Shift':
            game.queueMode = true; break;
        case '1': case '2': case '3': case '4': case '5': {
            const unitIndex = parseInt(e.key) - 1;
            if (game.units[unitIndex]) game.selectUnit(game.units[unitIndex].id);
            break;
        }
    }
}

export function handleKeyUp(game, e) {
    if (e.key === 'Shift') game.queueMode = false;
}


