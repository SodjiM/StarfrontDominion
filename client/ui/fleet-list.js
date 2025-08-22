// Starfront: Dominion - Fleet list UI (ESM)

export function attachToolbarHandlers(game) {
        const debounce = (fn, wait=200) => { let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn.apply(game,a), wait);} };
        ['fleetSearch','fleetTypeFilter','fleetStatusFilter','fleetSectorFilter','fleetSort'].forEach(id=>{
            const el = document.getElementById(id); if (!el) return;
            el.oninput = el.onchange = debounce(()=> game.updateMultiSectorFleet(), 180);
        });
        const fav = document.getElementById('fleetFavoritesToggle');
        if (fav) {
            fav.onclick = () => {
                const active = fav.dataset.active === '1';
                fav.dataset.active = active ? '0' : '1';
                fav.classList.toggle('sf-btn-primary', !active);
                fav.classList.toggle('sf-btn-secondary', active);
                game.updateMultiSectorFleet();
            };
        }
}

export function updateFleetList(game) {
        if (!game || !game.gameState) return;
        attachToolbarHandlers(game);
        return game.updateMultiSectorFleet();
}


