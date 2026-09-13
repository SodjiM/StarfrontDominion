# Starfront: Dominion UI direction

## Lobby surface

The lobby is a compact command surface for players returning to an ongoing game or scanning for an open one. It keeps the existing deep-space visual identity, but makes the list the primary object and uses progressive disclosure for details.

### Tokens

- Canvas: `--bg-deep` and the existing blue-black nebula background.
- Surfaces: the existing `--bg-panel`, `--glass`, and `--border` tokens.
- Accent: `--primary` blue for focus, selection, and primary actions.
- Semantic status: green for recruiting, amber for active. Status always includes text.
- Shape: 9px controls, 10px game rows, 14px page panels.
- Density: compact app rhythm. Lists should fit in the first viewport when the dataset is small.

### Behavior contract

- Your games and available games remain distinct and visible together on desktop.
- Available games can be searched by title or owner and filtered by status.
- The initial list shows six available games; `Show more games` is explicit when more exist.
- Selecting a row expands that card in place, showing players and the relevant action buttons.
- Empty and no-results states explain the next useful action.
- The lobby seed is empty. Prototype fixture games must never be inserted during startup.

### Accessibility

Use native buttons and form controls, preserve visible focus, label icon-only controls, and support reduced motion. Never rely on color alone for game status.

## In-game reference tools

- Encyclopedia uses a two-pane reference layout: compact category navigation on the left and a readable entry column on the right.
- Category and entry navigation use native buttons with visible active state and entry counts.
- Strategic Map is a near-full-viewport chart. Travel planning lives in a collapsible right rail on desktop and a bottom sheet on narrow screens, leaving the map as the dominant surface.
- Strategic-map labels are opt-in, collision-aware, and deduplicated by name. Selection and destination markers remain visible even when labels are off.
- The map supports cursor-anchored zoom, constrained panning, and a resettable numeric zoom control. Inspecting and panning are the default; custom destination placement is an explicit, cancelable mode.
- Route cards own their queue action and show ETA, travel mode, and load once. A missing selected ship is presented as a red, human-readable prerequisite instead of a route error.
- Both tools use bounded modal geometry and internal scroll ownership so short content does not create oversized empty frames. The travel rail owns POI scrolling so destination selection remains usable on mobile.

### Orbital geometry

- Strategic-map and minimap orbital tracks render persisted world geometry supplied by the server; neither surface invents decorative orbit rings.
- Every generated planet occupies its assigned track, and both maps use the same generated center and radius as the authoritative planet coordinates.
- Tracks remain quiet cartographic context: fine blue dashes behind objects, resources, regions, routes, and selection markers.
- Systems without persisted orbital geometry show no fallback rings. This keeps older worlds honest instead of implying structure they do not possess.

## Celestial artwork and tactical unit scale

- `client/render/celestial-types.js` owns the shared cosmetic taxonomy. Generated worlds persist `meta.visualType`; older objects resolve deterministically from existing metadata and identity.
- `client/assets/celestial/atlas.png` supplies nine textured, transparent bodies. `celestial-renderer.js` caches atlas cells and feathers stellar corona edges. Ambient light and restrained axial motion use the single 30 fps clock in `ambient-loop.js`, pause in hidden tabs, and respect reduced motion.
- `client/render/object-scale.js` owns main-map display sizes and picking. Celestial diameter is twice stored radius. Ships use class-based sizes with 42–84 px tactical minimums; stations use 72–104 px minimums, with smaller symbols at system zoom. Selection follows that same display geometry. Physical unit occupancy remains a separate server concern.
- Unit details show a 150 px portrait using the existing sprite registry so players can inspect a silhouette without changing map zoom.
