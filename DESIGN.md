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

- Your games, Discover, Create, and Comms share one persistent bottom navigation. Create opens its focused dialog; the other items own distinct lobby views.
- Discover owns search across game titles, participating players, and game mode, plus status filtering. Search never competes with the returning-player view.
- Game collections use an explicit horizontal rail with visible previous/next controls, keyboard scrolling, stable snap points, and a visible scrollbar when more than three campaigns exist.
- Each campaign persists one of five cinematic artwork keys. Creation may choose a key; otherwise the server assigns one and legacy rows receive a deterministic one-time backfill.
- Selecting a row expands that card in place, showing players and the relevant action buttons.
- Empty and no-results states explain the next useful action.
- Lobby Comms is a persistent authenticated channel shared by lobby users and remains separate from game-specific chat.
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

## Minimal command surface

- The top-right command cluster is limited to turn activity, lock turn, and the utility menu. Fleet, Details, Comms, and Command remain the primary navigation tabs.
- Focus remains persistent on desktop and mobile. On narrow screens it is a compact control above the bottom navigation; map utilities stay behind a single Maps control.
- The mini-map is a desktop preference. System and Galaxy views remain available through the map utility surface, while mobile keeps the map unobstructed until a sheet is opened.
- The tactical grid is quiet by default: a world-aligned, radial-fade neighborhood appears around the pointer, selected unit, or active destination. Settings can persistently enable the full grid with `ui.alwaysGrid`.
- Desktop map panning and cursor-anchored zoom remain available. Touch supports tap selection, move previews with explicit confirm/cancel, touch panning, and midpoint-anchored pinch zoom. A preview is tied to the ship that created it and is cleared if selection changes.

## System backgrounds

- Main-map backgrounds use only the public sector archetype. `standard`, `solar`, `binary`, and unknown archetypes use the open-space image; `wormhole`, `graviton`, and `dark-nebula` use the nebula image. Backgrounds never reveal object positions or fogged information.
- Images are loaded once per family, rendered into a size-keyed canvas cache, and cover-fit to the viewport. The renderer uses a dark fill while an image loads or if it is unavailable.
- Current source and runtime assets are documented in [client/assets/backgrounds/README.md](client/assets/backgrounds/README.md). Asteroid-heavy systems currently use the open-space fallback until a dedicated asset is available.

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

### Command shell verification (2026-09-15)

Runtime owners: `client/game.html`, `client/command-shell.css`, `client/ui/controls.js`, `client/ui/topbar.js`, and `client/ui/turn-activity.js`. The native activity dialog uses the browser top layer; the utility menu stays above the map and below legacy modal surfaces. Escape closes the menu and restores its trigger. Activity has loading, empty, retry, paginated history, and explicit read acknowledgement states; server cursors are per player and monotonic.

Chrome checks passed at 1440, 768, 390, and 320 pixels for the four-tab dock, menu layering, keyboard focus, activity dialog, Players tab, persistent mobile Focus, and horizontal overflow. Nine targeted activity/map regression tests passed. Production website build passed. The broader suite retains an unrelated failure in `test/auth.test.cjs` calling the removed `/game/build-basic-explorer` endpoint. The repository-wide strict UI audit still reports legacy controls outside this command-shell scope; it is not a clean global accessibility audit. Real-device touch verification remains advisable.

## Public landing page

- The opening viewport is a cinematic three-scene carousel. Its scenes intentionally represent different play styles: exploration first, one conflict scene only, then diplomacy and trade.
- Scenes advance every eight seconds with a visible progress track, direct scene controls, document-visibility pausing, and reduced-motion behavior. The controls never expose a redundant pause action.
- The Game and Ships navigation targets distinct routes with restrained placeholders until their full guide and fleet archive are built. The landing page does not duplicate those destinations below its hero. Updates uses the existing patch-notes route, and every Play Now action leads to the login screen.
- The established Starfront Dominion mark remains the shared brand anchor; generated scene art contains no embedded copy, logos, or interface elements.
- Game, Ships, Updates, and individual patch notes reuse one cinematic subpage shell: the shared brand/back header, restrained cyan utility type, editorial serif headlines, visible focus, and the same action hierarchy. Updates is presented as a readable dispatch archive rather than a generic blog grid.
- Authentication is a focused command-access surface over the shared deep-space artwork. Login uses the established mark, editorial welcome heading, compact cyan field language, app-owned validation, stable busy feedback, password visibility control, and explicit routes to account creation and the public site.
