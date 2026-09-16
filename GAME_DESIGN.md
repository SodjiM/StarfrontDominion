# Starfront Dominion — Game Design Direction

> Working design-state handoff. This document is the current authoritative direction for systems, territory, resources, and strategic space. It is not a final GDD and does not make unresolved numbers or features canonical.

## How to read this document

Each design statement has one of four statuses:

- **Established direction** — preserve unless this document is deliberately revised.
- **Current working model** — preferred implementation direction, subject to balance testing.
- **Prototype candidate** — intentionally narrow scope for early family playtests.
- **Open design question** — do not silently answer in code or documentation.

When this document conflicts with older design notes or existing implementation, this document wins as design intent. The conflict and migration path should be made explicit before behavior is changed.

## 1. Core game fantasy

Starfront Dominion is a 2D top-down, turn-structured multiplayer space strategy/simulation game. Players begin with access to a solar system and gradually learn to live in space rather than merely own territory on a map.

The core play loop is:

> explore → extract → build → connect → observe → defend → trade or raid → establish distant footholds → fight when the strategic conditions justify it

Space should feel large, partially empty, strategically legible, and physically inhabited through infrastructure. Territorial control emerges from what players have built and can defend, not from a formal ownership flag or painted border.

## 2. Design pillars

### Territory is physical

Do not make control primarily a colored-border mechanic. A player functionally controls space when they can see activity, reach locations quickly, refuel and repair, produce replacement ships, exploit local resources, intercept hostile movement, protect traffic, and prevent rivals from establishing themselves.

> Presence + logistics + information + force projection = territorial control.

The UI may display system association, infrastructure, regional health, and other overlays, but those overlays describe the simulation rather than create ownership by fiat.

### Information is a strategic resource

A player invested in a home environment should normally know more about activity there than an intruder. Information superiority should enable detection, classification, identification, tracking, route prediction, interdiction preparation, vulnerable-fleet targeting, and ambushes.

The long-term model may use several information levels:

> detection → classification → identification → tracking → deep intelligence

Sensor arrays, scouting ships, stealth, jamming, decoys, and archetype rules should interact with this layer.

### Expansion creates capability and vulnerability

Growth should be desirable, not punished. A larger civilization naturally creates more infrastructure, traffic, logistics, environmental workload, surveillance obligations, defensive lines, and vulnerable utility ships. A larger empire becomes richer while developing more surface area for opponents to attack.

## 3. Solar systems and strategic space

Each player begins with a solar system. A system may contain stars, planets, moons, asteroid belts, naturally occurring warp lanes, mineral deposits, environmental phenomena, derelicts, anomalies, infrastructure, and stations.

### Macro-region model

The prototype uses a 3×3 macro grid grouped into approximately two or three named regions determined by system archetype. The underlying playfield remains continuous; the grid is a management and environmental abstraction, not nine tactical squares.

Region layouts may eventually become organic boundaries, but that is not required for the prototype.

## 4. System archetypes

At setup, the player chooses a system archetype. An archetype must influence physical geography, environmental behavior, movement, resources, infrastructure incentives, tactical opportunities, and strategic vulnerabilities. It should be possible to infer an archetype from how a system behaves rather than only from its label.

An archetype is what space gave the player. Development is what the player turned it into. Player-built diplomatic institutions, drydocks, foundries, and weapons ranges should not be mistaken for astronomical archetype identity.

### Archetype resource model

**Current working model:** every system contains all universal/core minerals, two guaranteed signature specialty minerals tied to its selected archetype, and five additional specialty minerals selected randomly during generation.

This creates three layers of identity:

1. Archetype determines environmental and geographic identity.
2. Two signature minerals nudge the player toward particular ship doctrines.
3. Five randomized specialty minerals create unexpected local opportunities.

The existing five-core / twenty-five-specialty roster is a design asset, not a locked final roster. Mineral redesign should follow archetype and strategic-role architecture; do not refactor the roster prematurely.

### Ship access through resources

Resources should create asymmetric access to useful ship hulls, not only incremental bonuses. Players should always be able to build a meaningful fleet with local materials, while trade, exploration, foreign bases, expansion, and capture provide lateral options unavailable locally.

Ship identity should primarily come from abilities, cooldowns, and battlefield role. Useful roles include aggression, support, control, utility, mobility, stealth, command, reconnaissance, sustain, interdiction, and drones. Combination-resource hulls are promising but should be selective rather than combinatorially exhaustive.

## 5. No formal space ownership

Players do not own systems or regions through the rules. A starting system is a starting position, not a protected domain. Other players may enter, establish moon or planet stations, colonize, mine, build infrastructure, create sensor coverage, operate routes, and establish military footholds.

Regional health belongs to the region, not to a player. Several hostile players may benefit from maintaining the same space. This shared-interest tension should create diplomacy, free-riding, bargaining, and deliberate neglect without requiring formal diplomatic mechanics.

## 6. Stations and infrastructure

Stations provide anchoring points for persistent presence. Exact costs, production limits, repair/storage limits, upgrades, and destruction rules remain provisional.

| Station | Strategic role | Working capabilities |
| --- | --- | --- |
| Moon station | Cheap foothold / forward operating base | Storage, resupply, limited repair, frigate construction, local infrastructure support |
| Planet station | Serious regional presence | Frigate and battleship production, stronger logistics, larger infrastructure support |
| Sun station | Major industrial commitment | Frigates, battleships, and potentially capital ships |

A moon station should make aggressive expansion feasible without implying ownership. A planet station is a meaningful escalation. A sun station in another player’s starting system should communicate a major commitment rather than a temporary raid.

Potential deployables include passive and active sensor arrays, fuel or resupply depots, jump pads or relays, mining nodes, repair facilities, navigation beacons, interdiction infrastructure, environmental stabilizers, communications relays, hidden listening posts, and defensive structures.

Deployables have physical positions and should be scoutable, attackable, hackable, disableable, repairable, and defendable. Infrastructure creates capability and targets at the same time.

### Regional infrastructure capacity

**Current working model:** every region has a finite, initially standardized infrastructure capacity. Infrastructure consumes different loads: simple buoys and mining installations are low; depots and major sensor arrays are moderate; jump infrastructure and military installations are high.

The cap exists for readability, balance, spam prevention, and composition choices. Regional health must not dynamically decide whether a player is allowed to build; capacity should remain stable and understandable. Archetypes may later alter specific infrastructure costs or efficiencies rather than casually changing raw caps.

Anti-spam and hostile-removal rules are open design questions.

## 7. Regional pressure, health, and events

Regional health represents navigability, predictability, environmental stability, and sustainability. It is public information and should use legible qualitative bands such as Stable, Managed, Strained, Unstable, and Critical.

Health should influence warp-lane throughput, congestion sensitivity, interdiction vulnerability, arrival stability, environmental hazards, operating burden, extraction conditions, and archetype-specific effects. Low health should create friction and exposure rather than simply switching infrastructure off.

### Event-driven degradation

Do not make regional health a recurring chore such as losing one point every few turns. Infrastructure density creates nonlinear operational pressure; conceptually, pressure is proportional to infrastructure load squared. Low utilization should create little pressure, medium utilization occasional incidents, high utilization regular incidents, and near-total utilization meaningful operational demands.

Incidents should be legible problems with time windows. Examples include debris migration or mining-corridor collapse in asteroid regions, gas fronts and stale sensor maps in nebulae, unstable apertures in wormhole regions, and radiation or navigation-array damage in solar regions.

Players may respond immediately, send a minimal mission, heavily escort the mission, delay it, ignore it, or accept health loss because another objective matters more. Maintaining every region at maximum health is neither required nor desirable.

### Utility missions

Incidents should create physical fleet activity through science/survey vessels, engineering vessels, tugs, salvage ships, logistical transports, fuel tankers, calibration vessels, and environmental-control ships. These ships should generally be weaker or more vulnerable than dedicated combat ships.

The strategic purpose is valuable, predictable, vulnerable traffic. Escorting a science ship is a real allocation choice: no escort is efficient but exposed, a small escort is moderate commitment, and a heavy escort is safer while removing military strength from elsewhere.

## 8. Warp lanes, traffic, and interdiction

Naturally occurring warp lanes are central movement infrastructure, not arbitrary player roads. They traverse specific regions, so regional conditions matter.

Healthy lanes should offer high throughput, speed, predictability, coherent fleet emergence, and manageable interdiction risk. Degraded lanes should have more congestion, lower throughput, stronger large-fleet penalties, easier interdiction, less coherent emergence, and temporary disruption when fleets are forcibly dropped. Travel should become riskier and more exploitable, not impossible.

Large formations should create more traffic strain than small raiding groups. Frigate raiders should move lightly; giant battle fleets should be powerful but logistically obvious. This supports maneuver warfare without artificially weakening large fleets in combat.

Interdiction should exploit movement infrastructure. At normal health, an interdicted fleet should emerge unexpectedly but remain broadly combat-ready. At poor health, possible additional penalties include a temporary stun, delayed first activation, dispersion, cooldown disruption, degraded formation, or emergence away from intended coordinates. The objective is to reward prepared ambushes, not automatic victories.

### Player-built jump network

Natural lanes establish initial geography. Players can later construct jump pads, relays, or equivalent infrastructure to create personalized industrial routes, response corridors, reinforcement loops, and hubs. Destroying one node should meaningfully lengthen response time while remaining recoverable.

## 9. Mining, logistics, and raiding

Early extraction may rely on mining fleets. Later, automated or semi-automated mining nodes can be placed near deposits. Nodes consume infrastructure capacity, accumulate material, require collection, and create physical transport traffic back to stations.

Economic routes should be observable, optimizable, escortable, and raidable. Asteroid regions may make mining infrastructure cheaper or lower-load, creating a strong reason to industrialize them.

Raiding is a strategic identity, not an inferior fleet battle. A weaker player who cannot defeat a 25-versus-80 main fleet should still be able to raid miners, transports, science ships, tankers, sensor arrays, jump infrastructure, depots, mining installations, and stabilization equipment.

The intended underdog pattern is:

> raid economic traffic → disrupt maintenance → damage sensors → lower regional health → expose a route → read the enemy response → prepare interdiction → attack a force under favorable local conditions

Underdogs do not receive magical combat bonuses. They engineer favorable engagements.

## 10. Archetype catalog and prototype scope

The existing catalog contains Standard, Binary Star, Wormhole Cluster, Graviton Sink, Asteroid-Heavy Belt, Solar Flare, Dark Nebula, Ion Tempest, Starlight Relay, Cryo Comet Rain, Supernova Remnant, Diplomatic Expanse, Capital Forgeyard, and Ghost Net/Ghost Network. Not all should survive unchanged.

The strongest current system concepts are:

| Archetype | Identity | Prototype test |
| --- | --- | --- |
| Asteroid system | Wealth, clutter, and logistical exposure | Extraction, capacity, mining nodes, traffic, piracy, terrain |
| Wormhole cluster | Dynamic topology | Routes, topology events, mobility, stabilization, invasion paths |
| Dark nebula | Information uncertainty | Sensors, scouting, stealth, ambushes, imperfect information |
| Graviton sink | Movement vectors | Gravity wells, slingshot routes, predictable trajectories |
| Solar flare | Predictable timing windows | Forecast-based offensive and defensive timing |
| Ion tempest | Localized moving weather | Spatially mobile environmental disruption |
| Comet system | Moving resource opportunities | Interception, mining, contest, redirection |
| Supernova remnant | Salvage economy | Derelicts, wrecks, debris, rare salvage |
| Ancient/Starlight relay | Fixed controllable movement network | Capture, repair, disable, reroute |
| Ghost network | Autonomous drones and uncertain contacts | Hackable nodes, neutral actors, false contacts |

Binary Star remains visually strong but needs a mechanical identity beyond two stars, such as shifting radiation or gravity geography. Diplomatic Expanse and Capital Forgeyard should be reconsidered as environmental archetypes; embassy, treaty, drydock, and foundry mechanics fit player development better.

**Prototype candidate:** start with Asteroid, Wormhole, and Dark Nebula. They test three distinct questions: what is valuable here, where can I go, and what can I know. Solar Flare is an alternate prototype candidate if forecast-based environmental timing is easier to validate than mature sensor/stealth play.

An archetype may contain two or three predetermined region types. Instances can vary in rotation, layout, celestial placement, secondary minerals, infrastructure placement, development, health, and active events. Region rules should generally have one or two memorable effects, not ten micro-modifiers.

## 11. Prototype loop

The first regional-health prototype should be intentionally small:

1. A region begins Stable or Managed.
2. The region has finite deployable capacity.
3. Player infrastructure increases development pressure.
4. Pressure affects incident probability or severity.
5. An incident appears with a timer.
6. A utility fleet can resolve it.
7. The player may intentionally ignore it.
8. Failure lowers regional health.
9. Lower health changes lane behavior and environmental risk.
10. Enemies may attack the mission or infrastructure.
11. Successful stabilization restores or improves the region.

Use a few highly legible incident types before building a large event library.

## 12. Balance principles

- Poor health creates vulnerabilities, not automatic defeat or cascading shutdown.
- Strategic neglect must often be rational.
- Dense development is powerful but costs workload, logistics, and exposed targets rather than arbitrary economic penalties.
- Frigates, scouts, raiders, utility ships, escorts, and transports remain strategically relevant after battleships and capitals exist.
- Infrastructure destruction is meaningful but recoverable.
- Small players inconvenience larger players through information, routes, logistics, and timing rather than hidden combat multipliers.

## 13. Explicit open questions

### Regional health

Exact bands, recovery, stabilization gains, natural recovery, effect assignment, and whether players can intentionally damage health.

### Infrastructure

Capacity and load values, archetype variation, hostile removal, anti-grief protections, and recurring material or fuel upkeep.

### Warp lanes

Traffic formula, fleet-size effects, interdiction mechanics, low-health emergence penalties, and jump-pad interaction.

### Stations

Construction costs, production limits, repair/storage limits, upgrades, vulnerability, and destruction rules.

### Resources

Final core count, specialty roster, role mapping, ship recipes, and combination-resource hull rules.

### Archetypes

Final names, two signature minerals per archetype, layouts, incidents, and prototype versus later-release membership.

## 14. Architecture direction

Systems should remain data-driven. Conceptually, an archetype should be describable as:

```text
Archetype
├── identity
├── signature minerals
├── region layout
├── celestial-generation rules
├── special environmental mechanic
├── region definitions
│   ├── infrastructure modifiers
│   ├── environmental incidents
│   └── local environmental rules
└── generation parameters
```

Infrastructure should use shared definitions containing load, build requirements, capabilities, sensor visibility, maintenance, hackability, destruction/repair behavior, and archetype or region modifiers. New archetypes and deployables should primarily be content additions on stable systems, not new branches in one massive conditional.

## 15. Current implementation reconciliation

The current repository partially supports this direction but still contains older assumptions:

| Area | Current repository state | Design direction | Migration path |
| --- | --- | --- | --- |
| Archetype selection | Setup accepts a player-provided `archetypeKey`; sectors are created unseeded and seeded during setup. A legacy `pickRandomArchetype()` helper still returns `standard`. | Player-selected archetype is authoritative. | Keep setup selection; remove or quarantine random-selection paths once compatibility checks are complete. |
| Archetype registry | Unified registry exposes `standard` plus the older catalog and loads data-driven seeder modules. | Prototype around three contrasting archetypes; later catalog remains experimental. | Add status/availability metadata and avoid presenting every legacy archetype as equally final. |
| Regions | `regions` stores a sector/region, cell layout, health, projects, and history. Layouts use the 3×3 grid. | Keep macro grid as prototype abstraction; ownership-free public health. | Preserve schema where useful; add incident/load concepts without making health an ownership field. |
| Minerals | Schema contains five core minerals and the larger specialty roster. Archetype seeders expose fixed `primary` and `secondary` arrays. | All cores + two guaranteed signatures + five randomized specialties. | Introduce generated specialty selection separately from the legacy arrays; retain roster until role review. |
| Mineral spawning | Resource generation weights cores and fixed archetype minerals; `mineral_rules` can gate minerals by health. Node count is also health-modulated. | Do not gate resource access on health; health should create friction and exposure. | Stop using health as an unlock gate in the new generation path; decide separately whether extraction yield or incidents respond to health. |
| Lanes | Lane tables/runtime and archetype-specific lane generation already exist in some seeders, including health-sensitive behavior in older logic. | Natural lanes are movement infrastructure affected by health, traffic, and interdiction. | Define one shared lane model and migrate archetype-specific sketches into data-driven modifiers. |
| Stations | Moon, planet, and sun station classes exist with anchoring and basic cargo/build behavior. | Stations are persistent presence tiers, not ownership proof. | Preserve anchoring and production foundations; defer final costs, tiers, and destruction rules. |
| Deployables | Storage boxes, warp beacons, interstellar gates, and station structures exist as build/deployable concepts. | Expand toward capacity-aware, physical infrastructure. | Add shared deployable definitions and region load incrementally; do not retrofit every structure in the first prototype. |
| Incidents and utility missions | No complete event-driven regional-maintenance loop is currently authoritative. | Incidents create timed, attackable utility traffic. | Prototype a small incident set and one or two utility ship types before broad content expansion. |
| Ownership | Stations and objects may have `owner_id`, but regional design must not infer formal region ownership from it. | Presence and logistics create functional control. | Keep object ownership for permissions and attribution; do not add painted region ownership. |

The current implementation also includes political-system documentation and code. Those systems may build on physical presence, stations, regions, and health, but they must not redefine regional health as player ownership or silently turn archetypes into civilization-development packages.

## 16. Do not overbuild yet

Do not attempt to finish all archetypes, all minerals, every station tier, deep diplomacy, a large incident library, organic region boundaries, a full economy, complex hidden infrastructure, or every intelligence tier before the prototype questions are answered.

The first prototype must establish whether fleet movement is interesting, infrastructure makes space feel inhabited, players create valuable routes, utility fleets are worth attacking, health produces decisions rather than chores, smaller players can inconvenience larger ones cleverly, and archetypes change how players think.

## Core thesis

Players do not conquer abstract territory. They learn to operate space better than their rivals.

A powerful civilization is powerful because it has built an interconnected organism:

> stations → infrastructure → sensors → mining → logistics → warp routes → fleets

Regional health pressures that organism. Environmental events keep it active. Utility fleets maintain it. Raiders attack its exposed parts. Scouts reveal those parts. Infrastructure lets defenders react. Poorly maintained space creates tactical openings. Because no region formally belongs to anyone, the strategic map remains fluid even when the graphical map does not change color.
