# Regional Operations, Pressure, and Incidents

## Purpose

This plan turns the regional-operations design into bounded implementation slices. It covers shared infrastructure capacity, operational lifecycle, pressure snapshots, incident creation, and incident response. It deliberately does not yet apply regional-health consequences.

The durable context is [../design/starfront-design-direction.md](../design/starfront-design-direction.md).

## Settled current direction

- Regions have fixed, shared infrastructure capacity. Capacity is readable and is not dynamically reduced by health.
- Operational infrastructure contributes regional load. Disabled or destroyed infrastructure does not consume capacity or create operational pressure.
- Pressure is nonlinear and evaluated once from committed turn state. It drives incident frequency and severity rather than directly subtracting health.
- Pressure history is immutable by turn. Player-facing pressure is qualitative; exact contributors remain viewer-scoped.
- Incidents are persistent, time-bounded regional conditions. They are public at a safe summary level and are not owned by a player.
- Multiple players may begin a response to the same incident. A response is a commitment, not a claim of regional ownership.
- An incident is resolved atomically by a valid completed response; competing active responses are cancelled consistently.
- Current incident work has no health change, automatic expiration effect, cost/reward economy, or physical utility-mission completion rule.

## Current implementation foundation

| Foundation | Current contract |
|---|---|
| Infrastructure catalog and lifecycle | Shared definitions and centralized operational/disabled/destroyed/repaired/removed state handling. |
| Capacity deployment | Build paths reserve capacity atomically. Failed deployment restores state and resources. |
| Paired gates | Endpoints are validated in one game, cannot be self-links or reverse duplicates, and reserve/release slots as one lifecycle unit. |
| Pressure snapshots | One immutable regional snapshot is created per resolved sector-region-turn after combat/destruction and before health history. |
| Incident generation | Deterministic, idempotent generation derives at most one active incident per region from its snapshot. |
| Response state | A player may begin, cancel, or restart one response per incident; completion is an internal atomic transition. |
| Player-facing facts | Facts expose safe incident state and qualitative pressure without exact source load, rolls, responder identities, or hidden infrastructure. |

These foundations are prerequisites, not proof that the player-facing maintenance loop is complete.

## Requirements and constraints

### Infrastructure and capacity

- Never use check-then-update slot accounting. Reserve capacity with conditional database updates in the same transaction as deployment.
- Lifecycle transitions must be centralized so all paths agree on whether a deployable is operational and consumes load.
- A paired gate releases both endpoint slots if either endpoint becomes non-operational; it cannot become a one-sided usable route.
- Failure paths preserve cargo, object rows, metadata, counters, and paired records exactly.
- Future anti-spam rules must prevent useless low-load infrastructure from denying shared capacity or generating burden without operational value.

### Pressure and facts

- Snapshot pressure after actions that can destroy or disable infrastructure; do not mutate health in this phase.
- Persist enough to explain a player-facing band without exposing hidden contributors.
- Treat public regional state, friendly exact load, visible hostile load, and concealed hostile information as separate authorization classes.
- Facts and broadcasts must not disclose source pressure, hidden aggregate load, incident-selection rolls, or responder identity.

### Incident and response state

- Generation must be idempotent across retries and duplicate turn-resolution attempts.
- Only one active incident may occupy a region at a time unless a later design explicitly supports coexistence.
- Begin/cancel/restart validates game membership, sector/region scope, turn state, and response ownership.
- Completion is callable only by an authoritative mission or resolution path, not a client claim.
- Retention of resolved incidents must be bounded and display-safe.

## Dependencies and interactions

| System | Interaction |
|---|---|
| Turn resolution | Defines ordering, transaction ownership, deterministic generation, and snapshot timing. |
| Build, cargo, and gates | Capacity reservation and paired rollback must be atomic with these mutations. |
| Infrastructure lifecycle | Determines capacity, pressure, sensor coverage, and operational effects. |
| Facts and visibility | Publishes safe regional status while protecting exact hostile operations. |
| Utility ships and movement | Supplies the later physical mission that completes a response. |
| Regional health and lanes | Consume successful/failed/expired outcomes in a later slice; intentionally unchanged now. |
| Archetypes | Select incident flavor and future regional rules; semantics must not depend only on cosmetic labels. |

## Next implementation slice: utility-backed response completion

The next bounded feature is a minimal utility mission that makes response completion physical. It should:

1. require an eligible utility-role ship and valid location/region;
2. create or associate a server-owned mission/order with the existing response;
3. remain visible as vulnerable traffic and be interruptible by movement, destruction, disablement, or cancellation;
4. verify completion during authoritative turn resolution; and
5. call the existing internal completion transition only after verification.

Keep the first version narrow: one utility role, one traversal/arrival rule, one completion condition, and no reward economy. Do not infer broad PvE, escort, fleet, or health mechanics into this slice.

### Definition of done

- A response cannot resolve through an API call or client state alone.
- A valid utility ship can begin and complete a response through a visible server-authoritative mission/order.
- Invalid location, destroyed/disabled ship, cancellation, competing completion, and transaction failure leave coherent response and incident state.
- Completion atomically resolves the incident and cancels competing responses.
- Focused persistence, route/service, and serialized-facts tests cover the contract.

## Later slices, in dependency order

1. **Expiration and outcome policy:** define unresolved-deadline outcomes; record them before adding health changes.
2. **Health consequences:** add small, recoverable effects for expiry, failure, and success, with public explanation in turn history.
3. **Archetype and regional semantics:** replace label-only mappings with structured definitions and a small prototype event library.
4. **Operational consequences:** add lane friction, hazards, extraction, and infrastructure burden one at a time with counterplay.
5. **Shared response economy:** add costs, rewards, bargaining, and contribution accounting only after missions are reliable.

## Unresolved questions

- What capacity and load values create meaningful composition without blocking experimentation?
- Does health recover naturally, only through incidents, or both?
- Can players intentionally damage health, and with what safeguards?
- Which outcomes belong to health bands versus the active incident?
- What qualifies a utility vessel: hull role, module, fitted capability, or order type?
- How are hostile structures disabled, repaired, captured, or removed?
- Which anti-spam protections preserve shared-capacity conflict without enabling griefing?
- Which incident windows, costs, and severity bands are fun in family playtests?

## Non-goals

- Passive health decay or a maintenance chore loop.
- Health-gated construction or mineral access.
- A complete environmental-event library.
- Fleet formations, escort AI, diplomacy, rewards, or economy balancing.
- Automatic lane/interdiction penalties before their counterplay is specified.
