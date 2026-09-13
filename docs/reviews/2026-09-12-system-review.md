# Starfront: Dominion — recovery review and ROI plan

Reviewed September 12, 2026. Scope: code review, targeted executable diagnostics, and hosting suitability research. No deployment or production gameplay changes were made.

## Recommendation

Keep the existing Node/Express/Socket.IO/SQLite architecture and recover a small, reliable multiplayer game before expanding content or rewriting the frontend. The biggest problems are inconsistent rules across old and new implementations, incomplete movement transitions, and mutations that are not actually protected by the claimed transaction boundaries. This is a repairable foundation, but the README's “atomic” and “collision-aware” claims are stronger than the implementation supports.

First milestone: a proposed 2–6-player private game in which everyone can join, explore, travel, mine, build, fight, end turns, reconnect, and resume after a server restart without losing items or stranding ships. This player count is a proposed test target, not a measured capacity limit.

## What the game currently is

- Persistent, turn-based space strategy with simultaneous order submission and player turn locks; an optional timer advances games automatically.
- Procedural sectors with celestial objects, resources, regions, interstellar gates, and a lane network. The README describes 5000 × 5000 sectors.
- Ships explore under fog of war, move locally, harvest into cargo, use energy/cooldown-based abilities, and fight. Stations and blueprints support construction; pilots constrain fleets.
- Three overlapping travel concepts: tile movement, older prepared warp jumps, and newer lane itineraries with tap queues or wildcat entry. Gates add immediate inter-sector relocation.
- The actual game is the vanilla JavaScript client under `client/`; React/Vite under `web/` primarily provides the landing experience. Updating the React landing will not fix gameplay.
- `server/index.js` wires the running server to `server/sockets/game.channel.js` and `server/services/game/turn-resolution.service.js`. It also retains substantial older implementation code. There is a large commented duplicate block in the socket module. Fixes must target the active call chain, not merely similar-looking functions.

The active turn order is abilities → ordinary movement → visibility → movement cleanup → harvesting → combat/cleanup/energy → region health → queued orders → lane travel → next turn. Lane movement happens after visibility and combat, unlike ordinary movement. This ordering needs a deliberate rule and end-of-turn visibility recomputation.

## Validation and limitations

- Syntax-checked 146 JavaScript/MJS/CJS files across server, client, and tools: no syntax failures. This does not validate browser imports, SQL, JSX builds, or game behavior.
- Added `tools/review-mechanics.cjs`, a dependency-free characterization harness that executes the real resolver source with mock database callbacks and test-only exposure of private functions. Run `node tools/review-mechanics.cjs`.
- Five checks reproduced existing defects: discarded warp, obstacle tunneling, nonadjacent-path teleportation, repair depending on energy not being full, and an unconsumed queued warp.
- A passing diagnostic means the BUG is still present. These are audit evidence, not a green correctness suite; replace them with expected-behavior regression tests as fixes land.
- No dependency installation, full server launch, browser playthrough, production build, real SQLite integration test, load benchmark, or dependency vulnerability audit was performed. Other findings below are source-confirmed defects or explicitly identified risks.
- The checkout contains tracked `database.sqlite-wal` and `database.sqlite-shm` but no base `database.sqlite`. Do not treat those sidecars as a restorable save. Preserve the original server's database using a consistent SQLite backup before migration work. This review did not modify the sidecars.

## Findings in priority order

### 1. Warp orders are acknowledged, then discarded — high gameplay priority

Evidence: `client/features/warp.js:37`, `server/sockets/game.channel.js:703`, `server/services/game/movement.service.js:78`, `server/services/game/turn-resolution.service.js:400`.

The client offers a prepared jump. The socket handler confirms it and creates `warp_preparing`. The resolver explicitly deletes that order as `skipped_legacy_warp`. The diagnostic reproduces this. Separately, `queue-order` permits `warp`, but queued-order materialization has no warp branch; the earliest warp remains queued and blocks later commands indefinitely.

Fix: decide and implement one supported travel contract. My recommendation is ordinary movement plus lane travel for the initial playable version, with old warp UI redirected to the supported flow or clearly unavailable. If beacon jumps remain part of the design, implement them as an explicit separate mode with preparation, cancellation, destination legality, and tests. Existing saves need an explicit conversion/cancellation result rather than silent deletion.

Acceptance: every offered travel action progresses to arrival, an actionable blocked state, or explicit cancellation; no accepted command disappears or silently blocks the queue.

### 2. Local movement is a line drawer, not obstacle-aware routing — high gameplay priority

Evidence: `client/core/Movement.js:3`, `server/utils/path.js:1`, `server/sockets/game.channel.js:650`, `server/services/game/turn-resolution.service.js:400`.

Bresenham generates a straight tile line. The resolver checks only the last tile reached during the turn. A speed-4 ship crosses an obstacle on tile 2 if tile 4 is clear (reproduced). If the landing tile is occupied, the order becomes `blocked`, but subsequent movement selection only includes `active` and `warp_preparing`, so it never retries. Radius/footprint collision is not represented by the exact-center SQL lookup.

The server also trusts the supplied path. A two-point path from (0,0) to (4000,4000) moves in one turn (reproduced). A stale starting position is logged but accepted. This explains both accidental desynchronization and invalid movement.

Fix: accept destination intent; derive the route from authoritative ship position. Bound coordinates and path work, validate each traversed segment and object footprint, and define deterministic rules for friendly blocking, simultaneous arrivals, swaps, and diagonal corners. Add bounded obstacle-aware pathfinding appropriate to sparse large sectors, not a preallocated search over every tile. Retry/replan blocked movement or expose a clear retry/cancel decision. Return the authoritative route and ETA to the client.

Acceptance: intermediate obstacles, occupied destinations, stale requests, out-of-bounds targets, and nonadjacent steps are handled predictably; identical state/orders give identical movement outcomes.

### 3. Lane planning and lane execution disagree — high gameplay priority

Evidence: `server/services/world/lane-graph.service.js:262`, `server/services/game/turn-resolution.service.js:280`, `server/sockets/game.channel.js:315`.

- The planner creates lane edges in both directions, but ticking adds positive progress and uses `Math.min(targetEndP, curP + deltaP)`. For reverse travel, that can jump straight to the lower endpoint; computed distance used becomes negative. This is a source-confirmed arithmetic defect.
- `sEnd || total` treats a legitimate endpoint of zero as the full lane length in several creation/transition paths.
- The tick loops over edges and also advances ships through subsequent legs internally. A ship carried onto a later edge can be selected again when the outer loop reaches that edge, receiving another movement budget. This is a source-level order-dependence risk requiring a multi-edge integration fixture.
- `travel:confirm` selects only owner and sector, then reads `ship.x/y` to determine whether entry is nearby. Those values are missing. Even its `autoStarted` flag does not actually launch travel.
- Only the first submitted edge is checked against the sector; all legs, tap ownership by edge, geometry continuity, and game membership need validation.

Fix: make progress signed, use nullish defaults for zero-valued coordinates, and allocate one movement budget per ship per turn. Execute typed approach, queue, merge, lane, transfer, and final-approach steps in one shared service. Validate the complete route server-side. Test arrival at the actual requested destination, not just the last lane endpoint.

Acceptance: forward/reverse and endpoint-zero routes, multiple legs, congested taps, cancellation/replanning, and reconnects all preserve position and per-turn distance limits. Reordering database edge rows must not change outcomes.

### 4. Multiplayer identity and administrative actions are unprotected — critical before internet access

Evidence: `server/routes/auth.js:26`, `server/sockets/game.channel.js:550`, `server/sockets/game.channel.js:658`, `server/routes/lobby.js:100`.

Login checks a password but returns a user ID without establishing a session. `join-game` trusts the supplied user ID. Movement does not verify ship ownership. Other handlers check ownership against a socket identity the client chose. The clear-all-games route requires only a confirmation string, with no administrator authentication. Turn locking also accepts user and turn identifiers from the client.

Fix: authenticated sessions shared by HTTP and sockets; derive actor identity on the server; centralize membership, ownership, game, sector, and current-turn checks. Protect/remove destructive admin routes. Rate limits are not identity checks.

Acceptance: player A cannot act as player B, move B's ships, enter unrelated game rooms, lock B's turn, or invoke administrative deletion. Test with two independent authenticated clients and anonymous requests.

### 5. Turn atomicity is unreliable — high reliability priority

Evidence: `server/services/game/turn-resolution.service.js:10`, `:31`, `:88`; `server/services/game/cargo-manager.js:225`; `server/db.js:5`.

The resolver starts a transaction on the shared connection, but locks only a game/turn pair. Two games can enter resolution concurrently on that same connection. A failed second BEGIN reaches a ROLLBACK that can affect the first transaction. Other request handlers also write through the shared connection. Cargo code independently begins/commits/rolls back transactions. Finally, resolution suppresses “no transaction is active” on commit and can announce success without a successful commit. Several phases swallow errors entirely.

These are source-confirmed unsafe boundaries; exact interleavings still need real SQLite reproduction. A transaction around the top-level function is insufficient if other operations can join, commit, or roll it back.

Fix: serialize database mutations under a clear transaction owner, pass transaction context into services, use savepoints only deliberately, and make resolution idempotent with a database-enforced unique game/turn. Reject or queue commands arriving during resolution according to a defined cutoff. Roll back on required-phase failures and emit success only after commit. Retry deterministically where randomness matters.

Acceptance: simultaneous games, timer/manual races, duplicate resolve requests, injected failures, and restart recovery never double-apply orders or partially consume a turn.

### 6. Economy operations can lose items and accept client prices — high gameplay priority

Evidence: `server/services/game/build.service.js:60`, `server/routes/build.routes.js:8`, `:27`.

Deployment removes a structure item before checking for the required celestial anchor, adjacency, or an existing anchored station. Invalid deployment therefore loses the item. Structure construction accepts a client-provided cost, including zero; ship construction exposes a `freeBuild` parameter. Build resource consumption and object creation are not consistently one transaction.

Fix: calculate prices from server registries; restrict any developer free-build feature explicitly; validate placement first; atomically consume resources and create the object/cargo. Use the same rule for transfers, gate pairs, salvage, and harvesting capacity limits.

Acceptance: invalid placement and failed insertion change nothing; concurrent purchases cannot overspend or bypass pilot limits; client requests cannot change prices.

### 7. Repair and effect cleanup depend on energy regeneration — medium/high gameplay priority

Evidence: `server/services/game/turn-resolution.service.js:741`.

Repair-over-time and expiry of UI boost hints sit inside the branch that writes a changed energy value. A damaged ship at full energy does not heal; the same fixture at one energy below capacity heals. Ships with no positive regeneration also skip that work.

Fix: process healing, energy regeneration, and effect expiry independently, then persist changed state once. Test full energy, zero regeneration, expiry boundaries, and overlapping effects.

### 8. Visibility, save hygiene, and duplicate code increase recovery cost

Evidence: `server/index.js:76`, `server/services/game/movement.service.js:116`, `server/services/game/turn-resolution.service.js:43`, `server/index.js:182`, `server/sockets/game.channel.js:1015`.

The trails endpoint exposes movement segments without authentication or visibility filtering, undermining fog of war. Its history query uses the object's current sector, so a gate transfer can associate historical movement with the wrong sector. Visibility is updated before late-turn lane movement and combat destruction. Tracked database sidecars and extensive old/commented implementations make testing and maintenance harder.

Fix: define visibility per player at the final committed state; filter private data at every delivery path, including broadcasts; record historical sector explicitly. Add configurable test/save DB paths and versioned migrations. Remove dead code only after establishing active-path tests. Add SQLite sidecar ignore rules and remove them from version control in a deliberate cleanup after preserving data.

## ROI roadmap

Effort below means focused engineering days, including tests, not a delivery promise. Integration and historical-save issues may expand the ranges. Dependencies overlap; do not simply add every row into a fixed quote.

| Order | Work package | Rough effort | Return |
|---|---|---:|---|
| 1 | Disposable seeded test world, configurable DB path, install/build/start smoke test, save backup procedure | 1–2 days | Makes every subsequent fix reproducible and protects old games |
| 2 | Movement authority, collision traversal, blocked recovery; retire or implement old warp and queued warp | 3–5 days | Directly fixes the most visible frustration |
| 3 | Transaction ownership, idempotent turns, session identity and authorization | 3–6 days | Prevents corrupted progress and invalid multiplayer actions; start alongside movement design |
| 4 | Lane direction/zero endpoints, one ship budget, full route lifecycle and cancellation | 3–6 days | Makes long-distance travel dependable |
| 5 | Atomic economy, authoritative prices, independent healing/effect expiry | 2–4 days | Protects resources and makes combat rules consistent |
| 6 | Two-browser full-game test, reconnect/restart, fog filtering, useful error/status UI | 2–4 days | Converts individually fixed systems into a playable family session |
| 7 | Profile real fixtures, remove query repetition and dead code | 1–3 days initially | Improves responsiveness and maintainability after correctness |
| Later | Hosting setup, onboarding, scenario goals and balance | Scope after playtest | Avoids optimizing or polishing mechanics that still change |

The first implementation batch should establish fixtures and convert the five diagnostic cases into correctness tests, repair the unsupported warp/queue flow, and make ordinary movement authoritative. Transaction and identity work should follow immediately before broader multiplayer testing. No frontend rewrite is needed to deliver this batch.

## Optimization priorities

Measure turn duration by phase, query counts, snapshot sizes, browser render time, and memory on seeded small/medium/large worlds. The current code performs many queries inside ship, edge, tap, and effect loops; batch-load per-turn data and cache lane geometry/occupancy before changing infrastructure. Existing spatial and owner indexes are already present, so inspect query plans before adding more.

Use sparse spatial buckets for collision/visibility and viewport culling for drawing. Share authoritative paths/ETAs rather than independently reconstructing them in the client. Move toward state deltas only when measurements show full refreshes are costly. Keep SQLite and one server process initially; distributed services and database migration have lower ROI for a small family game than eliminating repeated work and transaction ambiguity.

## Playability improvements after correctness

- One clear travel interaction: destination, route, ETA, current stage, cancel/retry, and arrival.
- Explain blocked orders and failed abilities in player terms instead of silently skipping them.
- Show submitted/locked status, who's still planning, connection status, and a reconnect-safe pending order list.
- Offer a small seeded family scenario with accessible resources and explicit goals. Validate map scale and travel times during playtests before rebalancing ships.
- Add a short first-session guide: explore → approach resource → harvest → unload → build → encounter combat.
- Keep advanced congestion/region mechanics out of the critical onboarding path until their behavior is understandable.

## Proposed release gate

Run a two-browser session through lobby/setup, movement around obstacles, reverse and multi-leg travel, harvesting/full cargo/unloading, valid and invalid construction, abilities/repair/combat, turn locking, and reconnect. Then repeat across a restart and with two games resolving concurrently. Reject cross-player actions. Inject a database error and demonstrate complete rollback. Compare visibility and authoritative ship positions across clients. Finally run an extended session with the intended family group. A quiet error log alone does not qualify: assert resource conservation, one committed next turn, and no stranded travel orders.

## Hosting context only

The supplied link is **here.now**, distinct from Heroku. Its documentation describes file/site publishing, SPA routing, and built-in Site Data storage. I did not find a documented persistent Node process or Socket.IO/WebSocket server deployment model in the reviewed docs. Therefore it is not established as a drop-in host for this repository's Express server, scheduler, and SQLite file. It could serve a frontend with a separately hosted backend, but that adds configuration and does not solve game reliability. Source: [here.now documentation](https://here.now/docs), reviewed September 12, 2026.

For the first stable version, keeping the existing server box is the lowest architectural-change option, provided it can run the Node process reliably with durable database storage, backups, restart management, and suitable private/network access. The box's condition, connectivity, and security have not been assessed. Revisit hosting once the release gate passes; do not migrate the game into a static-site storage model just to use a particular host. Nothing was deployed.
