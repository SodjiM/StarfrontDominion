// ES Module entry point for Starfront: Dominion client
// Gradual migration: import side-effect modules to attach their features while we still delegate via window.*

import './main.js';
import './utils/constants.js';
import './utils/geometry.js';
import './utils/colors.js';
import './render/grid-renderer.js';
import './render/fog-of-war.js';
import './render/movement-paths.js';
import './render/object-renderer.js';
import './render/celestial-renderer.js';
import './render/resource-renderer.js';
import './render/ship-renderer.js';
import './features/abilities/ability-controller.js';
import './services/api.js';
import './features/warp.js';
import './features/mining.js';
// cargo feature removed; UI flows live in ui/cargo-modal.js
import './features/build.js';
// UI modules now ESM; imported on-demand inside game.js
import './ui/minimap.js';
import './input/mouseKeyboard.js';
import './ui/fleet-list.js';
import './ui/queue-panel.js';
import './ui/setup-modal.js';
import './ui/tooltip.js';
import './encyclopedia.js';

// Kickoff: replicate previous DOMContentLoaded initializer using the global initializeGame (until class export is split)
import { GameClient } from './game.js';

document.addEventListener('DOMContentLoaded', async () => {
    if (window.Session && Session.requireAuth()) {
        const gameId = new URLSearchParams(window.location.search).get('id');
        if (!gameId) { window.location.href = 'lobby.html'; return; }
        try {
            if (GameClient) {
                const client = new GameClient();
                window.gameClient = client;
                await client.initialize(gameId);
            } else if (typeof window.initializeGame === 'function') {
                window.initializeGame(gameId);
            }
        } catch (e) {
            console.error('ESM init failed, falling back:', e);
            if (typeof window.initializeGame === 'function') window.initializeGame(gameId);
        }
    }
});


