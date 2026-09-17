# Starfront Dominion Design Direction

## Purpose and authority

This is the current design authority for Starfront Dominion's shared-space, regional-operations, archetype, resource, infrastructure, and information systems. It reconciles older design assets with the present direction; historical documents and older implementation assumptions are references, not competing rules.

Starfront Dominion is a 2D, top-down, turn-structured multiplayer space strategy game. Its core fantasy is not painting a map. Players learn to operate space better than rivals by building an interconnected organism of stations, infrastructure, sensors, mining, logistics, routes, and fleets.

The enduring question for every system is: does it make physical presence, information, logistics, and force projection matter on the same map?

## Design principles

1. **Territory is physical, not painted.** Systems and regions have no formal owner. A player functionally controls space when they can see it, reach it, resupply there, exploit it, defend traffic, and prevent rivals from operating freely.
2. **Information is strategic.** Detection, classification, identification, tracking, and deep intelligence are future levels. The server reveals only what a viewer is authorized to know.
3. **Expansion creates capability and surface area.** Infrastructure and routes create wealth and reach, but also traffic, targets, defensive obligations, and environmental pressure. This is the intended organic check on snowballing.
4. **Infrastructure is physical.** Deployables create capability, targets, and choices. They can be scouted, attacked, disabled, repaired, or removed; they are not abstract upgrades.
5. **Regional stability creates friction, not shutdown.** Poor health should expose routes and operations to risk and inconvenience, not normally make recovery impossible.
6. **Raiding is legitimate strategy.** Smaller forces should be able to attack mining, maintenance, sensors, transport, and route infrastructure to engineer favorable engagements.
7. **The server is authoritative.** Costs, placement, ownership, visibility, routes, turn ordering, persistence, and random outcomes are server rules.
8. **Complexity is staged.** Early playtests should prove a small number of legible choices before broad content, deep diplomacy, or complete economic simulation.

```text
presence + logistics + information + force projection = functional control
```

## Prototype focus

The immediate prototype must establish whether fleets, infrastructure, routes, vulnerable utility traffic, regional pressure, and archetypes create interesting choices. It does not need every archetype, mineral, station tier, intelligence level, or political system.

```text
Scout → identify opportunity → establish or exploit a route
  → mine/build/repair/fight → protect or raid exposed operations
  → improve, neglect, or contest the spaces that matter
```

The political layer is staged rather than absent. Its durable rules are documented separately in [political-system-design-tenets.md](political-system-design-tenets.md), with implementation slices in [../plans/political-system-implementation.md](../plans/political-system-implementation.md). It must consume physical-world events rather than become a disconnected card game, and the broad external-agenda layer remains behind the physical-world foundations.

## Space, regions, and archetypes

Each player begins from a solar system, but that system is only a starting position. Other players may establish stations, mine, build infrastructure, and operate there.

Systems contain combinations of stars, planets, moons, belts, natural warp lanes, deposits, phenomena, derelicts, anomalies, and player infrastructure. The playfield is continuous. The current 3×3 macro grid is a management and environmental abstraction, grouped into roughly two or three named regions by archetype; it is not nine tactical squares. Organic boundaries are future work, not a prototype prerequisite.

At game start, the player chooses a system archetype. An archetype is what space gave the player: geography, environmental behavior, movement, information conditions, resource opportunities, infrastructure incentives, tactical openings, and vulnerabilities. Development is what a player later turns that space into. An archetype should be recognizable from behavior even when its label is hidden.

The first contrasting prototype set is:

| Archetype | Strategic dimension | Prototype focus |
|---|---|---|
| Asteroid System | Economy | dense extraction, industrial pressure, mining traffic, ambush terrain |
| Wormhole Cluster | Topology | changing routes, stabilization, unexpected access |
| Dark Nebula | Information | sensor uncertainty, scouting, stealth, ambushes |

Solar Flare is an alternate early archetype if forecastable timing can be tested sooner than mature stealth. Other promising directions are Graviton Sink, Ion Tempest, Comet System, Supernova Remnant, Ancient Relay, Ghost Network, and Binary Star.

The older Diplomatic Expanse and Capital Forgeyard concepts are not current system archetypes. Their useful ideas belong to player development, political systems, or buildable infrastructure.

Archetypes and deployables should be data-driven content over shared rules, not one expanding conditional block. An archetype definition ultimately needs identity, signature minerals, regional layout, celestial-generation rules, a special environmental mechanic, regional rules, incidents, and generation parameters. Deployables need load, requirements, capabilities, visibility, operational state, repair/removal behavior, and regional modifiers.

## Resources and ship access

Every system should contain all universal/core minerals, two archetype signature specialty minerals, and five additional specialty minerals selected during deterministic system generation. Two systems of the same archetype share a doctrine nudge while retaining different secondary economies.

Resources grant asymmetric lateral access to ship hulls and roles, not the ability to participate at all. A player must be able to field a useful local fleet, while trade, exploration, foreign bases, and raids make different hulls and combinations attractive. Combination-resource hulls remain promising but must be selective rather than exhaustive.

The existing five-core/twenty-five-specialty roster is a design asset, not final mineral count or taxonomy. Do not refactor it until ship-role and archetype architecture are clearer. Secondary minerals are not health-gated.

## Stations, deployables, and regional capacity

Stations anchor persistent presence; they do not confer territorial ownership.

| Station | Current intended role |
|---|---|
| Moon station | Cheap foothold: storage, resupply, limited repair, frigate construction, and infrastructure support. |
| Planet station | Serious regional commitment with stronger logistics and production, including frigates and battleships. |
| Sun station | Extremely expensive industrial commitment that may produce capitals as well as lesser hulls. A foreign sun station signals durable escalation. |

Costs, upgrades, destruction, capture, and exact production limits remain open. Planet biomes, pilot balance, and special station effects remain future work. Political influence, senator hosting, and station-based institutional capacity now have a focused specification, but their final balance still depends on the station and pilot implementations.

Deployables may include sensors, resupply, jump infrastructure, mining, repair, navigation, interdiction, environmental stabilization, communications, listening posts, and defenses. Each has a physical position and meaningful lifecycle.

Each region has finite, stable infrastructure capacity. Infrastructure consumes readable load; capacity is shared by all operators and does not change merely because health changes. This enables soft territorial competition without formal ownership. Anti-spam protections are required before cheap, useless infrastructure can deny capacity or impose burden.

Operational infrastructure creates nonlinear environmental pressure: low load produces little pressure, medium load occasional incidents, and high load frequent or severe incidents. Pressure drives incidents rather than a fixed health tax.

## Regional stability, pressure, and incidents

Regional health represents public environmental and navigational stability, not ownership or a player-development level. Its future public bands are Stable, Managed, Strained, Unstable, and Critical. It may later influence lane throughput, congestion sensitivity, interdiction transitions, hazards, operating burden, extraction, and archetype-specific behavior.

Health is event-driven. Infrastructure pressure raises incident likelihood and severity; ignored or failed incidents may later degrade health. Health does not passively decay every turn, health-gate construction or minerals, or normally shut infrastructure off.

Incidents operate independently of player readiness. Each incident publicly states a deadline, target, resolution rule, and deterministic one-time health loss. The prototype resolves when any player's live, operational courier reaches the target through ordinary travel; no player accepts or owns the incident. If no qualifying courier arrives, authoritative turn resolution expires the incident on its due turn and applies the consequence once. Later incident rules may admit other ship subsets, any operational ship, or different world-state requirements such as deploying a structure.

Incidents create a time-windowed choice: respond efficiently, escort vulnerable utility work, delay, ignore, or accept degradation because another objective matters more. Examples include debris migration in asteroid space, aperture instability in wormhole space, sensor-map drift in nebulae, and radiation damage in solar regions.

This common-resource dynamic is intentional. Multiple hostile players may benefit from resolving an incident, free-ride, bargain, or allow conditions to worsen if that hurts a rival more.

Implementation sequencing and resolution-rule contracts are in [../plans/regional-operations-and-incidents.md](../plans/regional-operations-and-incidents.md).

## Information, visibility, and reconnaissance

Players who invest in their environment should normally know more about activity there than intruders. Sensors, scouts, stealth, jamming, decoys, and archetypes will interact with that advantage.

Public regional condition is distinct from private operational intelligence. A viewer may learn that a region is strained without learning exact hidden infrastructure. Route planning and system facts must expose only display-safe, authorized information. Invisible objects, resource nodes, exact hidden load, movement history, and route internals are not public merely because a player belongs to the game.

The current authorization contract and its next work are in [../plans/information-and-visibility-contract.md](../plans/information-and-visibility-contract.md).

## Movement, logistics, and conflict

Natural warp lanes establish basic movement geography. Healthy lanes are fast, predictable, and coherent; degraded lanes should later have greater congestion, disproportionate large-fleet costs, and more exploitable interdiction outcomes. Degradation makes travel risky, not impossible.

Traffic and fleet-size pressure, lane-health effects, interdiction consequences, and player-built jump networks are future layers. Introduce them only after lane travel and regional operations have playtest evidence. Destroying a jump node should matter, but rebuilding must remain realistic.

Mining can evolve from fleet extraction into mining nodes that accumulate materials for transport ships, producing routes worth observing, optimizing, escorting, and raiding. Science ships, engineers, tugs, salvage ships, tankers, calibration vessels, and transports should be valuable precisely because they are vulnerable.

The intended underdog pattern is operational warfare: raid miners or maintenance, reduce information and mobility, identify a route, prepare interdiction, and choose a favorable local engagement. The weaker player engineers an opportunity rather than receiving a blanket combat advantage.

## Turn-resolution and persistence constraints

Turn ordering is an explicit game rule. Regional operations require pressure snapshots after combat/destruction and before health-history recording; incident generation follows those snapshots. Player-facing state is emitted only after transaction commit.

The wider resolver must preserve these invariants:

- every accepted order has an explicit result, visible blocked state, cancellation, or player-readable failure;
- random turn outcomes are persisted or deterministically reproducible;
- lifecycle changes, capacity reservations, paired infrastructure, and resource consumption are atomic;
- final visibility is calculated from operational objects after movement and relevant cleanup;
- history authorization uses the visibility applicable to that historical turn, not current sensor coverage.

## Settled, deferred, and superseded direction

### Settled

- No formal region or system ownership.
- Chosen archetype; two signature specialty minerals plus five generated specialties.
- Continuous space with a temporary 3×3 regional abstraction.
- Fixed regional capacity, infrastructure load, nonlinear pressure, public qualitative status, and event-driven regional degradation.
- Vulnerable utility and logistical activity as valuable strategic traffic.
- Viewer-aware information authorization as both game design and security requirement.

### Deferred or exploratory

- Final health thresholds, recovery, expiration effects, and deliberate health sabotage.
- Exact capacity/load values, anti-grief rules, upkeep, and hostile-removal rules.
- Final mineral roster, recipes, combination hulls, fuel, and rations.
- Station costs, upgrades, production limits, and destruction/capture rules.
- Lane traffic formula, low-health effects, interdiction, and jump-network behavior.
- Remaining archetypes, regional layouts, signature assignments, and event libraries.
- Broad external politics, formal diplomacy, organic region boundaries, and full economic simulation. The initial station-grounded Senate slice is a current implementation workstream; galactic laws, alliances, wars, and shared political externalities remain staged behind it.

### Superseded

- Random starting-archetype selection.
- Treating the existing 5+25 mineral roster as final canon.
- Predetermined secondary economies with health-gated access.
- Passive regional-health drift as the maintenance loop.
- Formal or colored-border ownership as the primary territorial system.
- Treating every original thirteen archetypes as committed prototype content.

## Prototype success criteria

Early family playtests should establish whether moving fleets is interesting; infrastructure makes space inhabited and creates valuable routes; players can choose extracting, defending, maintaining, neglecting, and raiding; utility activity is worth escorting and attacking; pressure creates decisions rather than chores; smaller players can use informed operational play; and Asteroid, Wormhole, and Dark Nebula systems change player thinking differently.

Do not broaden content until these questions have evidence-backed answers.
