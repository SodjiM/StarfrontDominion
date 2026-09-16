# Information and Visibility Contract

## Purpose

Information advantage is a core strategy system and an authorization boundary. This plan records the current visibility contract, hard redaction rules for every delivery path, and remaining work before richer intelligence mechanics are added.

## Settled current direction

- A player normally knows more about space where they have active sensors, scouts, stations, and logistics than an intruder does.
- Visibility is server-authoritative and viewer-aware. Game membership is not permission to enumerate world state.
- Disabled, destroyed, inactive, or zero-HP sensors do not grant coverage.
- Public regional condition differs from private infrastructure intelligence. Exact friendly load may be visible to its owner; visible hostile load is bounded by current visibility; concealed hostile load is never serialized.
- Historical movement is authorized by visibility at its turn, not present coverage or a mutable last-seen record.
- A route planner gets only an opaque route identifier and display-safe fields such as mode, ETA, and risk. Server-side plans retain legs, edges, taps, and execution telemetry.

## Current implementation foundation

| Area | Current contract |
|---|---|
| Sensor coverage | Operational ships, stations, and sensor infrastructure create current visibility; inactive sources are excluded. |
| Facts | Regional load and incident summaries are viewer-aware. Concealed load is internal. General facts omit route capacity/runtime, tap queues, mineral totals, and wormhole internals. |
| Map and resources | Invisible objects are filtered before serialization. Resource nodes require authorized operational coverage rather than global knowledge. |
| Routes | Plan/confirm uses stored server route state; socket responses omit legs, edge/tap IDs, coordinate fractions, speed multipliers, and mishap calculations. |
| Movement history | Per-turn visibility history authorizes historical segments instead of current visibility or last-seen state. |

## Requirements and constraints

### Delivery boundaries

Apply viewer-aware authorization to HTTP, Socket.IO, full-state snapshots, map queries, facts, route previews, resources, movement trails, reconnect payloads, and broadcasts. Filtering after a complete object is serialized is insufficient.

Never serialize to an unauthorized viewer:

- an invisible object's coordinates, type, owner, metadata, or existence;
- undiscovered resource-node coordinates, type, or quantity;
- concealed infrastructure load or hidden contributor totals;
- lane capacity, headway, speed, protection, permits, windows, runtime load, or tap queue state;
- route legs, edge IDs, tap IDs, internal interpolation, speed multipliers, or mishap probability;
- wormhole stability, mass limits, cooldowns, metadata, or external-sector links;
- movement records not visible on the turn they occurred.

Static, intentionally public geometry and public endpoint coordinates may be exposed only when their design value outweighs reconnaissance value. Each new field needs a classification: public, owner-only, currently visible, historical-memory, or server-internal.

### Visibility state model

Keep current visibility and historical memory separate:

- current visibility authorizes present interaction and inspection;
- last-seen memory supports UI knowledge without granting tactical precision; and
- immutable per-turn history authorizes past movement and events.

All sensors use the operational-state predicate shared with infrastructure lifecycle and gameplay effects. A dead or disabled source cannot leak visibility through a divergent implementation.

## Dependencies and interactions

| System | Interaction |
|---|---|
| Infrastructure lifecycle | Operational state controls both capacity/pressure and sensor eligibility. |
| Regional facts | Public qualitative pressure and incidents must not expose hidden infrastructure or responders. |
| Resources and harvesting | Discovery and nearby-resource queries require the same coverage model as the map. |
| Movement and turn resolution | Final positions create current coverage; exact-turn snapshots preserve historical authorization. |
| Archetypes and stealth | Dark Nebula, Ghost Network, jamming, decoys, cloaks, and active scanning build on this contract. |
| Route planning | Plans are stored and confirmed server-side so clients do not need operational lane internals. |

## Implementation-ready follow-up

Take the next security work as small audits, not a wholesale intelligence rewrite:

1. Classify every new map, facts, route, resource, event, or broadcast field before it ships.
2. Add route-level regression coverage for authenticated serialized payloads, reconnect snapshots, and broadcasts—not only service return values.
3. Audit remaining direct world-state queries and legacy endpoints against the operational sensor predicate and historical model.
4. Define a last-seen display contract so remembered contacts do not imply live tracking.

### Definition of done for the baseline

- Every active delivery path is classified and redaction-tested where it carries strategic state.
- Destroying, disabling, or reducing a sensor to zero HP immediately removes current coverage.
- No endpoint permits range enlargement or game membership to enumerate unseen objects or resources.
- Movement history includes only segments authorized at their exact turn.
- Route responses and stored client state contain only display-safe planning fields.

## Future design work

- Detection → classification → identification → tracking → deep-intelligence tiers.
- Active scanning, stealth, jamming, decoys, listening posts, and archetype-specific sensor rules.
- Last-seen contact decay, uncertainty, and UI language that does not overstate knowledge.
- Delayed communications, intercepted traffic, and intelligence derived from infrastructure or raids.

These are not prerequisites for the current regional-operations prototype. They must preserve the baseline authorization model when introduced.

## Non-goals

- Revealing hidden state for debugging convenience in normal player payloads.
- Treating a public regional health/pressure band as permission to inspect its causes.
- Treating client-side fog rendering as an authorization boundary.
