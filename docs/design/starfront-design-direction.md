# Starfront Dominion Design Direction

## Purpose and current conclusion

This document consolidates the design notes in `/Users/jared/Desktop/SFD Design docs/` with the systems that currently exist in the repository. The external files are treated as historical design references. They contain a mixture of intended mechanics, open questions, pasted implementation transcripts, and claims about earlier code changes; they are not authoritative instructions and are not all evidence that a feature is shipped.

The current direction is a persistent, turn-based space strategy game about turning a procedurally generated solar system into a functioning political and logistical domain. Players explore under fog of war, specialize around uneven mineral access, maintain regional infrastructure, move through a contested lane network, build anchored stations, and use ships with sharply different operational roles. The game should make infrastructure and political choices matter to the same physical map that combat and mining use.

The project is past the prototype-of-an-idea stage but not yet at a stable full-system design. The most important work is to establish one dependable playable core—explore, move, mine, build, fight, and recover across turns—then layer senate, missions, fleet logistics, and richer interdiction on top of that core.

## Design principles

1. **The map is the shared source of strategy.** Regions, celestial bodies, mineral deposits, stations, lanes, and combat positions should reinforce one another rather than behave as separate minigames.
2. **Specialization creates interaction.** Core minerals make every player participate in trade; archetype minerals create reasons to travel, negotiate, raid, and contest territory.
3. **Infrastructure changes the quality of movement.** A healthy region should produce more reliable logistics and safer lanes. A neglected region should become slower, more vulnerable, and strategically unattractive.
4. **Every accepted order has an explicit outcome.** It should resolve, remain visibly blocked with a reason, be cancelled, or fail with a player-readable explanation. It must not disappear silently.
5. **Server authority is part of the design.** The server owns positions, routes, costs, ownership, visibility, turn order, and random outcomes. The client previews and explains those results.
6. **Complexity should be staged.** The game can support deep political and logistics systems, but the first playable loop must be legible without requiring players to understand all 30 minerals, all 13 archetypes, and all lane modifiers at once.

## System maturity at a glance

| System | Design direction | Repository status | Confidence |
|---|---|---|---|
| Turn-based simultaneous orders | Players submit orders, lock, and resolve together | Implemented, with a tested resolver and known legacy paths | High |
| Procedural solar systems | Seeded archetypes create regions, bodies, belts, lanes, and resources | Implemented across generation pipeline and archetype seeders | High |
| Three macro regions | A/B/C regions have health, projects, mineral rules, and histories | Partially implemented; health currently drifts toward 55 | High |
| Mineral economy | Five universal core minerals plus 25 specialized minerals | Implemented in registry and generation data; economic loop is thin | High |
| Ships and role specialization | Frigates use specialized mineral recipes and distinct stats/abilities | Partial; four active blueprints, broader roster remains design material | High |
| Local movement | Authoritative destination-based movement with collision-aware behavior | Partial and still a correctness priority | High |
| Warp lanes | Core/shoulder/taps, congestion, queues, wildcat merge, multi-leg itineraries | Implemented enough for integration tests; advanced safety/interdiction is mostly future work | High |
| Interdiction | Acquire/tackle contest, buoys, snares, drop-outs, countermeasures | Schema and concepts exist; complete gameplay loop is not shipped | Medium |
| Celestial stations | Sun, planet, and moon anchors with distinct pilot capacity | Implemented as deployable station types; strategic effects are mostly absent | High |
| Fleet grouping | Ships should be managed as fleets and convoys | Not implemented as a first-class model | Medium |
| Senate | Senators, tags, terms, influence, happiness, policies | Design proposal only; no server data model or authoritative loop | High |
| Missions | Player-evoked regional/galactic objectives and contributions | Not implemented | High |
| Fuel and rations | Logistics costs that make infrastructure and raiding matter | Open design question; no canonical resource model | High |
| Active scanning | Survey Scanner temporarily expands effective visibility | Partially implemented; needs end-to-end UI and effect verification | High |

## The intended game loop

The durable loop should read as follows:

```text
Scout → identify a valuable opportunity → route a ship or fleet
  → secure local infrastructure → harvest/build/trade/fight
  → bring the result home or push it through a contested lane
  → improve regional health and political influence
  → unlock stronger policies and new operational options
```

The loop has three scales:

- **Tactical:** ship positioning, abilities, combat range, scanning, mining safety, and lane entry/exit.
- **Operational:** cargo, pilots, stations, fleets, routes, regional health, and trade corridors.
- **Political:** senators, policies, missions, reputation, and the way a player’s domain changes the shared galaxy.

The tactical and basic operational scales are the current implementation target. The political scale should be designed to consume information and outputs from the operational scale, not become a disconnected card game.

## Turn resolution contract

The current active pipeline is approximately:

1. Resolve queued abilities and pre-combat utility actions.
2. Resolve ordinary movement.
3. Update visibility.
4. Clean up movement state.
5. Resolve harvesting.
6. Resolve combat, status effects, energy, and wreck cleanup.
7. Update regional health.
8. Materialize queued actions.
9. Advance lane travel.
10. Commit the next turn and notify clients.

This order needs to become an explicit game rule. In particular, lane movement currently occurs after visibility and combat, so end-of-turn visibility must be recomputed or lane movement must move earlier. The recommended contract is:

- Abilities that reposition or modify combat state resolve before attacks.
- Combat uses the authoritative positions at the combat phase.
- All movement, including lane progress, is committed before the final visibility snapshot.
- Harvesting is cancelled or paused when a ship leaves its valid operating position.
- Region and political updates consume the committed turn results.
- The next-turn state and all player-facing deltas are emitted only after the transaction commits.

The resolver should give each ship one movement budget per turn, regardless of how many lane edges or approaches its itinerary contains. This prevents route outcomes from depending on database row order.

## World generation and regions

### Canonical world model

Each sector is a 5000 by 5000 strategic space containing:

- One or two stars.
- Five to eight planets with zero to four moons, with gas giants tending to have more moons.
- At least one asteroid belt, sectorized into angular wedges.
- Optional nebulae, wormholes, derelicts, and archetype-specific features.
- A 3 by 3 macro layout whose cells are labeled A, B, or C.
- A lane graph connecting useful points of interest.
- Resource nodes associated with belts, bodies, derelicts, and other future extraction sites.

The 13 authored archetypes are Binary, Wormhole, Graviton, Asteroid-Heavy, Solar, Dark Nebula, Ion Tempest, Relay, Cryo Comet, Supernova, Diplomatic, Forgeyard, and Ghost Net. The repository also has a Standard fallback archetype. Each authored archetype supplies a theme, region pattern, primary minerals, secondary minerals, and generation modifiers.

### Region health

Region health is the strongest unifying idea in the notes. It should modify:

- Secondary mineral availability.
- Lane speed, capacity, and protection.
- Wildcat merge duration and risk.
- Project availability and station output.
- Archetype-specific features such as windows, customs, slingshots, or safe corridors.

The intended thresholds are:

| Health | Meaning | Default effects |
|---|---|---|
| 80–100 | Prosperous | More lane capacity, stronger core protection, higher mass limit, extra infrastructure options |
| 60–79 | Healthy | Baseline lane behavior and secondary mineral unlocks |
| 41–59 | Stable but fragile | Normal operation with little margin for disruption |
| 0–40 | Stressed | Reduced speed/capacity, weaker protection, possible closures, fewer safe merges |

The current implementation records regions, projects, mineral rules, and health history, but the tick only drifts health toward 55. The next design step is to replace passive drift with explicit sources and sinks: upkeep projects, local construction, patrols, combat damage, hazards, harvesting pressure, and neglect. Health changes should be explainable in the turn log.

### Archetype design rule

An archetype should create a different strategic question, not just a different color palette. For example:

- **Wormhole:** do I invest in hub stability and timed throughput?
- **Asteroid-Heavy:** do I defend rich belt lanes or trade the minerals to specialists?
- **Dark Nebula:** do I exploit concealment and sensor asymmetry?
- **Diplomatic:** do I maintain a lawful high-value corridor and profit from permits?
- **Forgeyard:** do I turn industrial control into capital-ship power?

Every archetype should therefore specify four things before it is considered complete: its resource advantage, its movement rule, its infrastructure pressure, and its counterplay.

## Resource economy

### Canonical mineral set

The design notes define 30 minerals:

- **Core:** Ferrite Alloy, Crytite, Ardanium, Vornite, Zerothium.
- **Specialized:** Spectrathene, Auralite, Gravium, Fluxium, Corvexite, Voidglass, Heliox Ore, Neurogel, Phasegold, Kryon Dust, Riftstone, Solarite, Mythrion, Drakonium, Aetherium, Tachytrium, Oblivium, Luminite, Cryphos, Pyronex, Nebryllium, Magnetrine, Quarzon, Starforged Carbon, Aurivex.

Core minerals are the trade glue. Specialized minerals should make ships, modules, stations, and policies materially different, not merely increase an undifferentiated score. Archetypes emphasize two primary minerals and a small set of secondaries; secondary access is gated by region health.

The repository already contains the full resource registry, visual assets, archetype mineral rules, resource-node tables, cargo storage, and harvesting tasks. It also has an important mismatch to resolve: the design notes describe size and purity, while the active node generator currently uses amount, size, and difficulty with randomized placement. Purity should become a deliberate field only when it affects a visible decision such as extraction speed, yield, or price.

### Ship construction

The active blueprint registry currently supports Explorer, Needler Gunship, Drill Skiff, and Swift Courier. These establish the intended role families:

- Scout and survey.
- Combat/interception.
- Mining and industrial extraction.
- Courier and logistics.

The larger ship roster in the notes—stealth scouts, ECM ships, torpedo boats, patrol frigates, boarders, raider miners, and similar craft—should be treated as a content backlog. Add a blueprint only when its mineral recipe, operational role, counter, and UI explanation are defined together.

### Fuel and rations decision

The notes ask whether fuel and food/rations should both exist. The recommended decision is:

- **Fuel** is the first logistics resource. It powers long-distance impulse movement, lane entry, gates, and heavy operations. Fuel depots and destroyed hubs create meaningful PvP targets.
- **Rations** are deferred. They should only be added if the game needs a second, slower pressure on expedition duration, crew safety, or colonization. They should not duplicate fuel as another generic “travel cost.”

Solarite can be the mineral input to fuel production, but it should not automatically be the same thing as the consumable fuel counter. Keep the mineral economy and operational counters conceptually separate.

## Warp lanes and travel

Warp lanes are the most developed major design system and should become the canonical long-distance travel contract.

### Lane anatomy

- **Core:** fastest, safest, and most protected portion of a lane.
- **Shoulder:** staging and lower-protection area with slower movement.
- **Taps:** explicit on-ramps and off-ramps with queues and predictable entry.
- **Windows:** archetype-specific throughput periods.
- **Permits:** optional reserved capacity for commercial, military, or political traffic.
- **Deep space:** free positioning and impulse movement, but slower and more exposed.

The current lane schema already stores geometry, widths, speed, capacity, headway, mass limits, windows, permits, protection, transit progress, tap queues, runtime load, and interdiction buoys. The current service also supports server-validated multi-leg itineraries, approach movement, FIFO tap queues, wildcat shoulder entry, congestion scaling, reverse direction, and visible position updates.

### Travel entry choice

The two entry modes should have a clean, stable tradeoff:

| Entry | Strength | Cost/risk |
|---|---|---|
| Tap | Predictable, low risk, protected core entry, good for planned logistics | Requires reaching a known point and may queue |
| Wildcat | Can enter near the desired point from deep space, good for urgent movement | Merge delay, mishap risk, exposure, and restrictions under congestion |

The notes correctly identify a balance danger: if wildcat is usually faster and taps have no meaningful benefit, taps become decorative. Do not add “tap mastery” or a tap-only ability first. First instrument route fixtures and make tap value legible through reliable core access, lower risk, capacity reservation, and strong ETA display. Tune density and bonuses only after playtesting.

### Canonical travel state machine

```text
planned → approaching → queued or shoulder merge → core transit
  → transfer/next leg → final approach → arrived
```

Every state needs a cancellation path and a visible error path. A lane itinerary should never silently compete with an ordinary movement order. The old prepared instant-warp flow should either be removed from the UI or implemented as a separately specified gate/beacon mode; it must not be offered while the resolver discards it.

### Congestion and capacity

Use convoy units as the common capacity measure. The notes propose 0.5 CU for interceptors, 1 for frigates, 1.5 for haulers, and 3 for capitals. The repository has CU and piecewise congestion scaling already. Keep the first version simple:

- At or below capacity, full speed.
- Above capacity, progressively slower movement rather than a hard stop.
- Tap queues release a visible, bounded budget per turn.
- Region health modifies capacity.
- Heavy ships consume more capacity and should create strategic convoy decisions.

Windows, permits, and archetype-specific exceptions should be enabled one archetype at a time after the base behavior is stable.

### Interdiction

Interdiction is a strong future layer because it gives lanes PvP texture without requiring a full real-time simulation. The proposed two-gate model is sound:

1. **Acquire:** scanner/EWAR versus stealth, cover, and lane protection.
2. **Tackle:** disrupt power and position versus stability, escorts, and lane protection.

The default outcome should be a soft failure more often than a hard catch: a snare, delay, or forced shoulder drop creates counterplay without deleting a valuable ship. Buoys should be deployable at taps and in deep space, with explicit upkeep, expiry, detection risk, and archetype legality. Healthy diplomatic cores should provide strong protection and legal consequences for violations rather than making combat impossible everywhere.

Do not implement networked smart buoys, dynamic time-of-day rules, or complex learning behavior in the first interdiction pass.

## Structures and territorial control

### Station hierarchy

The notes give the station types a useful strategic identity:

- **Sun stations:** system-control hubs. They should increase domain-wide logistics, political reach, and fleet deployment radius.
- **Planet stations:** regional power nodes. They should improve local production, cargo throughput, mining, and possibly biome-specific output.
- **Moon stations:** tactical outposts. They should support scanning, stealth, raiding, salvage, and forward deployment.
- **Deep-space structures:** low-upkeep, high-risk tools for pirates, traders, explorers, and ambush control.

The repository already supports anchored sun, planet, and moon stations, parent-object linkage, deployment validation, station cargo, and pilot capacity contributions. The next step is to make those classes affect the same systems that the notes promise. Avoid giving every station a generic “+5 capacity” role.

### Zoning and planetary identity

Planet biomes are a good future extension, but they need a clear resource/output contract. Start with a small set of tags—such as jungle, volcanic, ice, industrial, and barren—and give each one one primary bonus and one vulnerability. Do not create a large biome taxonomy before the station and region loops can use it.

### Territorial control

Ownership should be layered rather than binary:

- A station gives local presence.
- A set of stations gives regional control and health leverage.
- Sun control gives system-level influence and logistics.
- Lane and fuel infrastructure create contestable routes.

This makes destroying or capturing an enemy fuel hub meaningful without requiring every fight to decide ownership of the whole system.

## Senate and political systems

The senate notes are explicitly exploratory—the source document even calls itself a draft to redo—but they contain the best high-level plan for the political layer. The senate should be a domain-management system that turns the player’s physical holdings and actions into choices with asymmetric benefits.

### Recommended senate model

- Each player has a small active senate, initially two or three senators.
- Senate sessions occur on a long cadence, initially every 100 turns, with a session remaining open for a defined number of turns rather than forcing an immediate modal decision.
- Candidates are generated from owned station anchors and domain conditions.
- Senators have a small number of tags, a preference profile, a term count, happiness, and one signature ability or policy affinity.
- The player chooses whether to appoint, retain, or replace candidates.
- Retired senators leave a small legacy effect rather than disappearing without consequence.

Suggested initial tags are Centralist, Decentralist, Humanist, Ecologist, Warmonger, Raider-Aligned, Technocrat, Expansionist, Trade Magnate, and Industrialist. Start with fewer tags if the UI becomes unreadable.

### Influence, happiness, and policies

Influence should be earned from actions that match a senator’s interests: building or maintaining relevant stations, exploring, trading, winning fights, supporting missions, or improving a region. Happiness is the short-term relationship state; influence is the accumulated political capital. Matching tags may create synergy, while hard conflicts reduce happiness.

Policies should be concrete modifiers on existing systems. Early examples:

- Logistics policy: lower fuel cost or larger tap throughput.
- Industrial policy: lower build cost or faster ship completion.
- Ecological policy: slower health decay and stronger recovery.
- Security policy: stronger lane protection or patrol actions.
- Raider policy: improved salvage or reduced deep-space upkeep.

Policies should not be an independent currency treadmill. A policy is successful when a player can name the operational behavior it changes.

### Senate implementation sequence

1. Add server-authoritative senate session, active senator, term, and candidate records.
2. Build a minimal selection flow with no policies or quests.
3. Add tags, happiness, and influence deltas based on already-logged actions.
4. Add a small policy catalog whose effects are read by centralized modifier functions.
5. Add missions that are created or amplified by senators.

Do not start by building the full quest schema, event deck, and ten-tag conflict matrix. Prove that one session, one replacement decision, and one policy can change a player’s next few turns in a satisfying way.

## Missions and shared objectives

The proposed humanitarian deposit mission is a strong example because it creates positive-sum interaction without removing PvP. A mission should have:

- An issuer or trigger.
- A location or system scope.
- A time limit.
- A contribution type and target.
- Individual contribution rewards.
- A completion reward or world-state change.
- Political effects for relevant senators.

Start with three objective families: harvest a quantity, build or maintain infrastructure, and win or survive a combat objective. Add trade-value, exploration, and escort objectives after the event accounting is reliable. Mission progress should update from authoritative turn events, not from client claims.

## Fleets, logistics, and raiding

### Fleet model

Fleets should be a coordination layer over ships, not a replacement for ship identity. A fleet needs:

- Membership and formation order.
- A leader or command ship.
- Shared route and travel mode.
- Aggregate CU, fuel demand, speed, and detection profile.
- Rules for slow ships, damaged ships, and pilot limits.

The first implementation can store a fleet ID and use existing per-ship orders, while the UI and planner treat the group as one route request. Do not add full fleet combat resolution until formation and movement semantics are stable for individual ships.

### Logistics

Fuel depots, storage stations, courier ships, and lane capacity should produce meaningful choices:

- Do I build a safe depot or keep a mobile courier chain?
- Do I escort a high-value convoy or move smaller loads through a risky shoulder?
- Do I raid a fuel hub to slow an opponent, or capture it for my own use?

This is the strategic reason to add fuel. If fuel only subtracts a number on every move, it will add accounting without creating decisions.

## Exploration, scanning, and fog of war

The repository already has object visibility and a Survey Scanner ability. The design direction is:

- Default visibility is local, directional enough to make scouts valuable, and updated from authoritative final positions.
- Active scan temporarily doubles effective scan range, with an obvious UI indicator and a server-provided expiry.
- Nebulae, Ghost Net systems, ECM ships, cloaks, and decoys modify detection rather than simply hiding objects forever.
- Scanning can reveal resource nodes, derelicts, buoys, and enemy movement evidence.

The active scan implementation needs an end-to-end check: server effect, visibility calculation, client range display, expiry, and reconnect behavior. Visibility must also be filtered on every endpoint and broadcast, including movement history and lane events.

## What is already real versus still conceptual

### Reliable foundations already present

- Seeded generation pipeline with archetype resolution and fallback.
- Region, health-history, project, and mineral-rule tables.
- 30-mineral registry and visual resource assets.
- Resource nodes, cargo, harvesting tasks, and mining abilities.
- Anchored station types and station-based pilot capacity.
- Four active ship blueprints with server-side requirements and stats.
- Turn locks, turn resolution, combat orders, status effects, and ability cooldowns.
- Lane graph data, taps, itineraries, transit progress, congestion, queues, reverse travel, and route tests.
- Client map/planner and visual travel state work sufficient to explain the current lane flow.

### Partially real and needs consolidation

- Ordinary movement and collision semantics.
- Legacy prepared warp and queued warp behavior.
- Exact turn ordering and final visibility timing.
- Region health effects beyond passive drift.
- Station gameplay effects beyond anchoring, cargo, and pilot capacity.
- Survey Scanner UI and effect lifecycle.
- Full ship roster and specialized ship equipment.
- Interdiction schema and concepts versus a complete player-facing loop.
- Security and transaction guarantees across all active paths.

### Conceptual backlog

- Senate sessions, candidates, terms, tags, influence, happiness, and policies.
- Senate-driven missions and regional/galactic objectives.
- First-class fleets and convoys.
- Fuel depots, fuel consumption, and logistics interdiction.
- Rations/food as a separate system.
- Planet biome zoning and production bonuses.
- Pirate havens, cloakable structures, stealth beacons, and deep-space structure upkeep.
- Active scanning/search missions and hideout discovery.
- Networked buoys, advanced counter-buoys, and dynamic interdiction decks.

## Recommended implementation roadmap

### Phase 0 Stabilize the playable core

1. Preserve and isolate the current database before migration work; the repository has tracked SQLite sidecars but no clear base database save.
2. Make destination intent authoritative for ordinary movement, validate every traversed step, and define blocked-order retry/cancel behavior.
3. Remove or clearly disable the legacy instant-warp UI until it has a complete state machine.
4. Make turn resolution transaction ownership explicit and emit success only after commit.
5. Finish session identity and authorization checks across HTTP and sockets before wider multiplayer play.

### Phase 1 Make travel dependable

1. Keep lane travel as the only canonical long-distance warp mode for the initial release.
2. Finish signed progress, endpoint-zero handling, multi-leg validation, and one-budget-per-ship execution.
3. Make route cards show approach, queue, merge, lane, transfer, final approach, and total ETA components.
4. Add fixtures for forward/reverse routes, tap queues, wildcat merges, cancellation, disconnected edges, congestion, and reconnect.
5. Tune tap density and safety after playtesting rather than adding speculative mastery systems.

### Phase 2 Connect the economy to the map

1. Replace health drift with explicit upkeep and damage sources.
2. Give each station class one local effect and one strategic effect.
3. Add authoritative fuel production and consumption only after a route/fleet test can show a real decision.
4. Add two or three more ship blueprints that use different archetype minerals and operational roles.
5. Complete Survey Scanner feedback and visibility filtering.

### Phase 3 Add the first political layer

1. Implement senate sessions, candidate generation, appointment, replacement, terms, and persistence.
2. Start with three tags and one policy per tag family if the UI needs a smaller initial vocabulary.
3. Feed influence/happiness from existing events: build, harvest, patrol, combat, exploration, and health improvement.
4. Add one mission type, preferably a time-limited shared deposit or infrastructure project.
5. Verify that policy effects change existing services through centralized modifiers.

### Phase 4 Add strategic depth

1. Implement fleet grouping and convoy planning.
2. Add fuel depots and raid/capture interactions.
3. Add a minimal interdiction loop: buoy, acquire, snare, countermeasure, expiry, and player-readable combat log.
4. Add planet biome zoning and moon/deep-space tactical structures.
5. Expand missions, policy conflicts, archetype events, and the ship roster based on playtest evidence.

## Acceptance criteria for the next milestone

A 2–6 player private game should be able to run through multiple turns in which players can:

- Join and reconnect without identity or ownership confusion.
- Explore under fog of war and use Survey Scanner visibly.
- Move locally without tunneling through obstacles or silently losing orders.
- Plan, confirm, cancel, and complete forward and reverse lane routes.
- Mine, transfer, build ships, deploy stations, and retain resources on failed actions.
- Fight with abilities and have effects, healing, and cooldowns resolve independently.
- See region health changes and understand their effect on travel and resources.
- End turns repeatedly with no duplicate resolution, partial commit, or stranded queue.

Senate and missions do not need to be in this milestone. They should be added once the outputs they consume—construction, travel, combat, harvesting, exploration, and region health—are trustworthy.

## Source reconciliation notes

- `Resource_Node.docx` is treated as the canonical mineral naming and role reference.
- `System Archtypes.docx` and `warp archtype overview.docx` define the intended generation model and archetype flavor; the repository’s seeder modules are the current implementation authority.
- `Warp.docx` contains the most complete lane design, including core/shoulder/tap behavior, capacity, congestion, and interdiction proposals.
- `warp system.txt` contains mixed historical implementation transcripts and recommendations. Its statements about completed fixes are accepted only where the current repository and tests support them.
- `senate.docx` is explicitly an early strategy draft. Its phased data model and integration points are useful, but no senate feature should be considered implemented until it has server-authoritative persistence and turn integration.
- `ships.docx` is a role-and-material backlog, while the active blueprint registry is the current playable roster.
- `Starfront domain todo.docx` is the open-question backlog. Its “TEST” section and notes about Strike Vector and Survey Scanner identify useful verification work, not a completed feature specification.

