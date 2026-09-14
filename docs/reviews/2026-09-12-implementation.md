# Movement, warp lanes, and multiplayer sessions

Implemented the requested gameplay/authentication batch without preserving old worlds or deploying.

## Behavior

Ordinary movement now accepts destination intent and computes the actual route server-side. Bounded A* falls back from a checked straight line, prevents diagonal corner cutting, checks intervening tiles and celestial footprints, rejects invalid destinations, and retries blocked routes. Execution recomputes from current database position, so stale/forged client paths cannot teleport ships. The client adopts the acknowledged server route.

Lane routes are planned from authoritative ship position and bound to a short-lived per-socket route identifier. Confirmation consumes the stored server route, not client legs. One service executes physical approach, FIFO tap queues or merge delays, signed forward/reverse transit, subsequent approaches, and final destination movement. Legitimate endpoint zero is preserved. A ship processes at most one leg per tick; leftover distance is deliberately discarded at a leg boundary, rather than awarding another budget. Reconfirmation/cancellation clear conflicting navigation records. The old prepared instantaneous warp UI directs players to the strategic map.

HTTP and sockets use persisted, random, hashed session tokens in HttpOnly SameSite cookies. Actor identity, membership, ownership, game, sector, and current turn are checked server-side. Logout revokes a session and closes its sockets. Login/register are rate-limited; admin clear-all is disabled. New schemas enforce unique memberships and turns. A shared connection lock serializes protected requests and turn resolution; duplicate resolution is rejected and commit failures no longer report success. This is still a single-process design.

## Verification

- 12 automated tests pass, using real SQLite and two independent Socket.IO clients.
- Covered: obstacle/corner/bounds handling; authoritative movement despite a forged stored path; ownership rejection; blocked retry; reverse travel to zero; merge delays; final approach; cancellation; replacing itineraries; disconnected lane approaches; tap queue lifecycle; server-issued route confirmation despite modified client legs; HTTP identity spoofing; anonymous sockets; cross-player commands; logout/relogin; duplicate resolution; injected-failure rollback and retry.
- Production Vite build passes.
- Browser smoke test confirmed login and lobby join. Browser automation stalled at the start-game confirmation, so an end-to-end browser game/travel playthrough is not claimed.

## Limits and follow-up

Lane ETA is still approximate, particularly with obstacles, congestion, and per-leg transitions. Planner cost estimates now use ship impulse speed instead of a fixed 120. Large-map path-search limits can produce an actionable no-route result even when a long detour exists. Further performance tuning needs representative gameplay measurements.

Economy, repair/ability correctness, comprehensive fog-of-war delivery filtering, and full-game playtesting remain separate work. The changes do not certify public-hosting readiness. The old review describes the pre-change state; the old diagnostic entry point now runs the navigation regression tests.

Dependency manifest/lockfile and database-sidecar changes appeared separately during the session and were preserved. The implementation adds only the test script to the current package manifest; it does not claim ownership of the SQLite/sharp dependency upgrades.

## Route ETA/ranking correction

The route planner now charges the physical impulse segment from a lane's destination projection to the requested object. This fixes the case where a route rides a short spur and then travels a long distance off-lane but is reported as only six turns. Dijkstra sink edges from taps are represented as direct impulse destinations instead of being reconstructed as lane rides, and lane hops retain their tap identity for confirmation. The map labels ETAs as turns so the unit is explicit. Routes are sorted after these complete costs are calculated.

## Route breakdowns

Planner responses now include breakdown values for approach, queue, merge, warp, transfer, final approach, off-ramp, direct impulse, and total estimated turns. The strategic map renders the non-zero components on each route card, making route ranking explainable during QA and family playtesting.

## Server-authoritative ordinary movement

The client no longer generates a local Bresenham path before submitting a move or reconstructs one after a refresh. It sends only integer destination intent and uses the server-returned path for visualization. Queued movement remains destination-only as well. Queue insertion now verifies that the authenticated player owns the ship and belongs to the requested game. The server continues to recompute paths from the ship's current position at turn resolution, so stale or edited paths cannot teleport a ship.

## Recoverable blocked movement

Blocked movement orders remain available for automatic retry. Each turn recomputes the route from the ship's current position. If no route exists, the order records the next retry turn and remains blocked; when the obstacle clears, movement resumes and reports that it retried. The queue panel surfaces this as “Blocked; retrying” while preserving the destination.

## Turn transaction boundary

Turn resolution now acquires the SQLite write transaction before checking the turn status, eliminating a read-before-lock race with timer/manual resolution. Required harvesting and region-health phases now propagate failures so the top-level rollback runs instead of silently committing a partial turn. The existing duplicate-resolution and injected-failure tests continue to pass.

## Multiplayer authorization audit

The Socket.IO guard now covers all command handlers with the authenticated session identity, game membership, sector membership, and owned object checks before the handler runs. Queue movement additionally verifies the ship's game association. Existing two-client tests cover anonymous connections, cross-player movement and queue operations, spoofed chat identity, modified travel confirmation, and logout session revocation. HTTP routes continue to derive the actor from the session and reject mismatched path/body user IDs.

## Economy validation ordering

Structure construction now uses server-owned rock prices and ignores client-supplied cost values. Anchored structure deployment validates the required celestial object, adjacency, and duplicate anchor before removing the cargo item. Gate deployment validates sector capacity and duplicate connections before consuming the gate item. Ship and structure insertion failures restore consumed cargo where possible, preventing failed database writes from silently deleting materials.

## Browser integration follow-up

Continued the browser check through game start, player setup, ship selection, strategic-map planning, route confirmation, and successive turn locks. Verified actual approach and lane transit positions in the gameplay UI. Fixed missing ship IDs in strategic-map planner requests, preserved POI object IDs, and resolved occupied planet destinations to exterior tiles on the server. Planner errors now display the server's reason. Reduced wormhole-archetype outer planet and belt radii to keep newly generated bodies inside the sector. Existing generated worlds are not converted.

## Economy and repair consistency — September 13

Construction cards now request `/game/structure-costs` and use the server catalog for both labels and affordability. Existing server prices are preserved: sun 8, planet 6, moon 4, storage 1, beacon 2, and gate 5 rock. Submitted prices cannot change charges; the request no longer requires a client price.

Build and deployment operations use savepoints under the existing request mutation lock. Resource consumption composes with the outer savepoint, so insertion or cargo-initialization failures roll back materials and created objects together. Paired gates and the legacy basic-explorer endpoint have the same protection.

Repair-over-time, energy regeneration, and temporary metadata expiry run independently. Repair stacks positive active percentages, caps at maximum HP, and stops after its expiry turn; ships at full energy or with zero regeneration can heal. Database failures in this phase now reach the turn rollback.

Validation: 42 automated tests pass, including real SQLite failure injection and authenticated construction requests. The production build passes. A disposable in-memory browser fixture verified all six prices, affordability with six rock, a successful six-rock planet-station purchase, and disabled construction at zero rock. This was a construction workflow check, not a full-game playthrough. The broad frontend static audit still flags existing UI-contract issues outside this change.
