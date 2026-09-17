# Regional Operations, Pressure, and Incidents

## Purpose

This plan turns the regional-operations design into bounded implementation slices. It covers shared infrastructure capacity, operational lifecycle, pressure snapshots, incident creation, shared physical objectives, expiration, and one-time regional-health consequences.

The durable context is [../design/starfront-design-direction.md](../design/starfront-design-direction.md).

## Settled current direction

- Regions have fixed, shared infrastructure capacity. Capacity is readable and is not dynamically reduced by health.
- Operational infrastructure contributes regional load. Disabled or destroyed infrastructure does not consume capacity or create operational pressure.
- Pressure is nonlinear and evaluated once from committed turn state. It drives incident frequency and severity rather than directly subtracting health.
- Pressure history is immutable by turn. Player-facing pressure is qualitative; exact contributors remain viewer-scoped.
- Incidents are persistent, time-bounded regional conditions. They are public at a safe summary level and are not owned by a player.
- Players do not enroll in, own, accept, or cancel an incident. Every eligible object in the game may satisfy its public resolution rule.
- An incident is resolved atomically when authoritative turn resolution finds a qualifying world state. Simultaneous qualifying objects are reduced to one deterministic result.
- Incidents do not wait for player readiness. If the public resolution rule is not satisfied by the deadline, the incident expires and applies its stated health loss once.
- The first physical prototype stores a public target point and resolves when any player's live, operational courier reaches it. Ordinary movement and lane travel are how a courier gets there; losing one courier does not change the incident or prevent another attempt.
- Resolution rules are data-driven and dispatched by rule type. Eligibility can constrain ship roles, blueprint subsets, or specific objects; an empty selector can admit any operational ship. Later rule handlers may evaluate deployed structures or other world conditions.
- Incident creation, resolution, and expiration are public strategic events. They appear on system maps and in turn activity for players whose current strategic knowledge includes the system.
- Current incident work has no cost/reward economy, partial contribution accounting, or recurring health damage.

## Current implementation foundation

| Foundation | Current contract |
|---|---|
| Infrastructure catalog and lifecycle | Shared definitions and centralized operational/disabled/destroyed/repaired/removed state handling. |
| Capacity deployment | Build paths reserve capacity atomically. Failed deployment restores state and resources. |
| Paired gates | Endpoints are validated in one game, cannot be self-links or reverse duplicates, and reserve/release slots as one lifecycle unit. |
| Pressure snapshots | One immutable regional snapshot is created per resolved sector-region-turn after combat/destruction and before health history. |
| Incident generation | Deterministic, idempotent generation derives at most one active incident per region from its snapshot. |
| Resolution rules | Each incident persists a rule type, public target, and typed eligibility requirements. No player-specific enrollment is required. |
| Courier arrival | After ordinary and lane movement, the authoritative resolver checks all game-member ships and resolves when an operational eligible courier occupies the target. |
| Expiration and health | Severity sets a fixed public deadline and deterministic health loss. Unresolved incidents expire once and update the region atomically. |
| Player-facing facts | Facts expose safe incident state and qualitative pressure without exact source load, rolls, responder identities, or hidden infrastructure. |
| Activity | Creation, successful resolution, and expiration produce public turn-activity summaries without responder or route disclosure. |

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

### Incident and resolution state

- Generation must be idempotent across retries and duplicate turn-resolution attempts.
- Only one active incident may occupy a region at a time unless a later design explicitly supports coexistence.
- Resolution is derived from authoritative world state, never a client completion claim or an accepted-mission record.
- Rule handlers own their completion evidence and eligibility checks. Shared incident lifecycle and expiration do not contain rule-specific branches.
- Stored target and requirement data are immutable for the lifetime of an incident so retries evaluate the same objective.
- Retention of resolved incidents must be bounded and display-safe.
- A satisfied resolution rule on the due turn resolves before expiration is evaluated. Otherwise expiration applies the incident's stated loss exactly once.

## Dependencies and interactions

| System | Interaction |
|---|---|
| Turn resolution | Defines ordering, transaction ownership, deterministic generation, and snapshot timing. |
| Build, cargo, and gates | Capacity reservation and paired rollback must be atomic with these mutations. |
| Infrastructure lifecycle | Determines capacity, pressure, sensor coverage, and operational effects. |
| Facts and visibility | Publishes safe regional status while protecting exact hostile operations. |
| Utility ships and movement | Ordinary travel moves candidate ships; arrival rules inspect their authoritative final positions. |
| Regional health and lanes | Consume successful/failed/expired outcomes in a later slice; intentionally unchanged now. |
| Archetypes | Select incident flavor and future regional rules; semantics must not depend only on cosmetic labels. |

## Implemented playable incident loop

The bounded prototype makes resolution physical and gives ignored incidents a real consequence. It:

1. generates a deterministic, navigable target point inside the affected region;
2. publishes a `ship_arrival` resolution rule whose first requirement is an operational courier;
3. lets every player use ordinary movement and lane travel toward the same objective without accepting or owning it;
4. evaluates all eligible ships during authoritative turn resolution after movement and before the deadline check;
5. resolves the incident once when any qualifying courier reaches the target; and
6. expires an unresolved incident on its due turn, applies its public one-time health loss, and records the outcome for facts and activity.

The first version remains narrow: one rule handler, one eligible ship role, an exact target point, a deterministic one-time health loss, and no reward economy. The rule registry and persisted requirements deliberately allow later incidents to accept other roles, blueprint subsets, any operational ship, or a different handler such as structure deployment.

### Definition of done

- An incident cannot resolve through an API call or client state alone.
- An operational courier reaching the target through ordinary movement resolves the shared incident without enrollment.
- A courier elsewhere in the region, an ineligible ship, an outsider-owned ship, or a destroyed/disabled ship does not satisfy the rule.
- Losing or redirecting one ship leaves the incident active and available to every other eligible ship.
- Completion atomically resolves the incident and records internal evidence without publishing player or ship identity.
- An ignored incident expires once at its deadline and applies the displayed regional-health loss even when no player has a utility ship or infrastructure present.
- Strategic facts and turn activity show deadlines, expected consequences, and outcomes without revealing responder identity or hidden operations.
- Focused persistence, movement/service, and serialized-facts tests cover the contract.

## Later slices, in dependency order

1. **Outcome tuning and recovery:** playtest deadline and health-loss values, then define recovery sources without turning health into passive upkeep.
2. **Archetype and regional semantics:** replace label-only mappings with structured definitions and a small prototype event library.
3. **Operational consequences:** add lane friction, hazards, extraction, and infrastructure burden one at a time with counterplay.
4. **Shared objective economy:** add costs, rewards, bargaining, and contribution accounting only after resolution rules are reliable.

## Unresolved questions

- What capacity and load values create meaningful composition without blocking experimentation?
- Does health recover naturally, only through incidents, or both?
- Can players intentionally damage health, and with what safeguards?
- Which outcomes belong to health bands versus the active incident?
- What qualifies a utility vessel: hull role, module, fitted capability, or order type?
- How are hostile structures disabled, repaired, captured, or removed?
- Which anti-spam protections preserve shared-capacity conflict without enabling griefing?
- Which incident windows, health losses, costs, and severity bands are fun in family playtests?

## Non-goals

- Passive health decay or a maintenance chore loop.
- Health-gated construction or mineral access.
- A complete environmental-event library.
- Fleet formations, escort AI, diplomacy, rewards, or economy balancing.
- Automatic lane/interdiction penalties before their counterplay is specified.
