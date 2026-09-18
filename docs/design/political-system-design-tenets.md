# Starfront Dominion Political System Design Tenets

## Purpose and status

This document is the current design authority for Starfront Dominion's political, Senate, senator, policy, and political-interaction systems. It records the intended player experience and the principles that future implementation should preserve.

This is a design document, not an implementation specification. The repository may not yet contain the station effects, regional systems, political data model, policy engine, or multiplayer agenda systems described here. When the design conflicts with existing code, the conflict should be made explicit and resolved deliberately rather than allowing the implementation to silently define the rules.

The political system exists to make the player's physical domain feel governed. Stations, ships, regions, logistics, combat, trade, exploration, and missions should generate political pressures. Senators interpret those pressures, policies turn them into capabilities, and broader political agendas allow players to change the shared galaxy.

The political system should not be a disconnected card minigame. Its inputs come from the physical map, and its outputs should change how players build, move, trade, fight, and cooperate.

The primary player-facing purpose is customization and signaling. Politics should let a player commit to a recognizable way of operating—such as moon-based raiding, concentrated industry, trade, exploration, or expansion—and receive meaningful support when their physical actions align with that identity. Other players should be able to infer a broad strategic identity from visible stations, posts, policies, and activity without knowing every implementation detail.

## The central fantasy

The player is not only commanding ships. The player is building a political domain.

A player may become:

- A centralized industrial power built around one sun station.
- A regional federation with many productive planet stations.
- A distributed pirate civilization based on moons and deep-space structures.
- A multi-system trade network connected by couriers and protected lanes.
- A technologically optimized exploration state.
- A militarized frontier authority.

No single political identity should be universally correct. The system should make different station portfolios, fleet compositions, economic choices, and political coalitions reinforce one another. Politics should mostly reinforce the player's chosen behavior rather than force a player into an unrelated activity; map archetypes, resource access, and expansion opportunities may still create reasons to adapt.

The guiding relationship is:

```text
Physical domain
  -> senator preferences and objectives
  -> individual senator happiness
  -> tag mandate and political eligibility
  -> policy cards and active government build
  -> internal domain effects and external political power
  -> changed map conditions and new strategic choices
```

## Core design principles

### 1. Politics must be grounded in the map

Senators should care about things that exist in the game world:

- Station placement and station type.
- System concentration or multi-system expansion.
- Regional health.
- Warp lanes and logistics.
- Pilot generation and ship production.
- Resource extraction and trade.
- Exploration and scanning.
- Patrols, raids, combat, and infrastructure losses.
- Shared missions and contested locations.

Political objectives should be completed through normal play. They should not require a separate political activity disconnected from the map.

### 2. More stations should generally be good

Station expansion is meant to be encouraged. Additional stations should provide real value rather than being punished by aggressive diminishing returns.

The balancing question is not whether a station is worth building. It is what kind of power the station creates, how much it costs to support, and how exposed it becomes to rivals.

More stations should create:

- More influence and political presence.
- More pilots or pilot capacity.
- More production, logistics, and deployment options.
- More regional control.
- More candidates and political choices.

More stations should also create:

- More maintenance obligations.
- More routes and infrastructure to defend.
- More exposed targets.
- More dependency on fuel, pilots, and regional health.
- More opportunities for rivals to disrupt operations without conquering the whole domain.

### 3. Station types create different kinds of power

Station count creates breadth, but station type creates specialization.

#### Sun stations

Sun stations are system-level authority. Most systems have one star and therefore one natural sun-station opportunity. Binary systems may support two, but that should be a meaningful archetype-specific political situation rather than a normal expectation.

Sun stations should generally provide:

- The highest political influence from one structure.
- The strongest pilot capacity and/or pilot generation.
- System-wide logistics and administration.
- The largest fleet deployment radius.
- The strongest access to centralist, diplomatic, administrative, or imperial candidates.
- The strongest policy reach within the system.

Sun stations should be expensive, visible, slow to construct, and strategically important to attack. A sun station should be the strongest individual station without being the only viable strategy.

#### Planet stations

Planet stations are regional power nodes. There are usually more planets than stars, so planet stations provide the main path to broad territorial development.

Planet stations should generally provide:

- Regional production and cargo throughput.
- Local pilot generation or capacity.
- Regional health improvement and project support.
- Biome or planetary specialization where that system is implemented.
- Access to industrialist, trade, humanitarian, ecological, or administrative candidates.

Planet stations should let a player build a strong regional government without requiring control of an entire solar system.

#### Moon stations

Moon stations are tactical outposts and frontier footholds. There are usually more moons than planets, and they should be cheaper and less politically powerful individually.

Moon stations should generally provide:

- Scanning and detection.
- Stealth, raiding, salvage, or forward-deployment support.
- Small pilot capacity or local operational support.
- Access to raider-aligned, covert, security, or exploration candidates.
- Tactical influence around a specific planet or lane.

Many moon stations should enable a legitimate distributed strategy rather than being inferior planet stations.

#### Deep-space structures

Deep-space structures are specialized, risky infrastructure for pirates, traders, explorers, and ambush operators.

They should provide strong local or situational benefits, but usually little conventional political influence. Their value comes from changing what is possible in deep space: hiding, scouting, raiding, resupplying, or controlling an ambush area.

### 4. Pilots connect political power to fleet growth

Pilots are a strategic resource required to create or operate ship units. Stations should therefore matter directly to fleet development.

The implementation should distinguish:

- Pilot capacity: how many pilots a station or domain can house or assign.
- Pilot generation: how quickly the domain produces or recruits available pilots.
- Pilot commitment: pilots assigned to existing ships and unavailable for new construction.
- Pilot loss and recovery: what happens when ships are destroyed or crews are displaced.

Expected station relationship:

- Sun stations provide the largest domain-wide pilot capacity and generation.
- Planet stations provide dependable local pilot generation.
- Moon stations provide limited local support, often with tactical or deployment bonuses.
- Deep-space structures provide little or no ordinary pilot generation.

This ensures that a sun station is strategically valuable without making it mandatory. A player can build a distributed moon network, but that network should not secretly produce the same industrial capacity as a developed sun-and-planet domain.

### 5. Territorial control is layered, not binary

A player should not need to own an entire system to matter there.

Control should have layers:

1. Presence: a player has a station, fleet, or active infrastructure nearby.
2. Influence: the player has enough station weight to affect local politics or operations.
3. Operational control: the player can produce, repair, mine, deploy, or move reliably in the area.
4. Dominance: the player controls enough of the local network to receive its strongest benefits.

A rival may control a planet and several moons while another player controls the sun and most of the surrounding system. The rival does not own the whole system, but can still:

- Disrupt local production.
- Threaten logistics.
- Contest regional health.
- Scan or raid traffic.
- Establish forward bases.
- Force escorts and defensive commitments.

This is a core multiplayer pattern: local footholds should create meaningful pressure without requiring total conquest.

## Political vocabulary

The system should keep these concepts distinct.

### Senator happiness

Happiness is an individual senator's current satisfaction with the player's actions and government. It is relatively fluid and changes from session to session.

Happiness is affected by:

- Completing the senator's personal objective.
- Performing normal actions aligned with the senator's tags.
- Maintaining the stations, regions, or activities the senator values.
- Compatible active senators and policies.
- Ignoring objectives.
- Choosing policies the senator opposes.
- Losing important assets or allowing the domain to deteriorate.

Players should be able to keep a senator mildly happy through aligned ordinary play. Personal objectives should be a stronger opportunity to improve happiness, not a mandatory checklist.

### Tag mandate

Tag mandate is the strength of a political movement inside the player's Senate. It is aggregated across senators with that tag.

Mandate answers:

> How strongly is Centralism, Technocracy, Trade, Raiding, or another political direction represented in this government?

Mandate should be derived from:

- The number of senators carrying the tag.
- Their current happiness.
- Their completed terms and experience.
- Completed tag-aligned objectives.
- Senator and tag synergies.
- Relevant domain achievements.

Mandate determines policy eligibility and tag tiers. It should not be confused with a senator's personal happiness.

### Political capital

Political capital is a spendable resource for external political action. It may be generated by a strong and stable government, but it is not identical to tag mandate.

Political capital can be spent on:

- Proposing broader measures.
- Lobbying or negotiating with other players.
- Increasing vote weight within defined limits.
- Funding regional projects.
- Creating diplomatic pressure.
- Amending or defending an agenda item.
- Establishing shared infrastructure or obligations.

Mandate represents political alignment. Political capital represents usable leverage.

Political capital should also support low-stakes civic actions, not only competitive optimization. Domain naming rights are one intended use.

### Initial political-capital rule

At the end of a Senate session, each senator contributes political capital from their happiness band. The current provisional bands are:

| Happiness | Capital from that senator |
|---:|---:|
| 20 | 1 |
| 40 | 2 |
| 60 | 3 |
| 80 | 4 |
| 100 | 5 |

The player's award is the sum across active senators. Unspent capital rolls over. This is an implementation-ready accumulation rule with provisional numbers; it makes senator happiness useful beyond mandate generation and gives players a reason to maintain a stable cabinet.

## Civic naming rights

Political control should allow players to leave a visible cultural mark on the shared map.

A player may spend political capital to name or rename:

- Solar systems.
- Planets.
- Moons.
- Asteroid belts.
- Major stations.
- Important warp lanes or corridors.

The first naming rule is intentionally permissive: a player who has previously seen an object through authorized visibility may propose a name. Discovery is therefore the minimum eligibility to put a naming item on the docket, not proof of ownership. A deployed station or local infrastructure may later determine stakeholder weight, but there is no settled binary ownership requirement for naming.

Naming proposals should consume a small amount of political capital to enter the docket. The current provisional fee is two political capital for any supported target. The proposal then becomes a vote or bid at the object's appropriate scope. The proposer does not automatically win, and other players may spend capital to support or oppose the name.

```text
Moon, asteroid belt, planet, sun, or solar system: 2 political capital
Differentiated fees by target significance: possible later balance tool
Major lane or political region: deferred
```

Names should persist as historical identity even if the proposer loses their stations or leaves the system. A later proposal may rename the object, but the previous name remains discoverable in history. Naming has no direct combat, production, or ownership effect in the current direction.

Renaming should create a visible historical record rather than erase the past. The UI may show the current official name, previous names, naming player or authority, and the turn and reason for each change.

Naming rights are primarily expressive and historical, not a direct combat advantage. They are still politically meaningful because they communicate legitimacy, ownership, legacy, and cultural influence.

The Senate interface should make this political rhythm legible between meetings. It is a major command surface and may use nearly the full viewport, comparable to the strategic map, rather than compressing cabinet, policy, agenda, and session decisions into a small modal. Four senator seats remain visible with identity, happiness, tags, and local post; active policy slots read as the government's current loadout; and the upcoming agenda previews proposals before voting opens. Candidate appointment controls belong to an open Senate session, while the policy catalog may remain available through a secondary disclosure.

The agenda and proposal creation are separate interactions. The agenda shows docketed items and, when implemented, their voting state. A distinct **Add a proposal** action opens a proposal-family chooser. Civic naming is the first available family; choosing it opens a focused editor with target, proposed name, exact capital cost, and submission confirmation. Future regional measures and galactic laws may occupy the same chooser only after their rules exist. Submission places an item on the agenda and must never look like an immediate name change or completed vote.

The first version needs a visible cost and confirmation step, historical names remaining discoverable, and a server-authoritative vote record. Cooldowns, name-safety filtering, and higher costs to overwrite established names are future safeguards; moderation is not a current prototype prerequisite.

## Senators

### Senator identity

Senators with the same tags must not be interchangeable copies.

Each senator should have:

- Two or three tags.
- A personality or governing philosophy.
- Preferred activities or domain arrangements.
- Disliked activities or outcomes.
- A personal objective pool.
- A happiness baseline and sensitivity.
- A signature ability or policy affinity.
- A term count and maximum term limit.
- A retirement or legacy effect.

Each active senator is also assigned to one owned station. A senator is not only a political identity in an abstract cabinet; they are a political official posted somewhere in the physical domain. Their post affects their political reach, objective pool, influence profile, vulnerability, and local responsibilities.

For example, two Centralist senators might differ substantially:

#### Centralist industrial senator

- Prefers most stations to be concentrated in one system.
- Wants high pilot generation and production.
- Offers industrial or sun-station policy affinities.
- Dislikes scattered frontier holdings.

#### Centralist technocratic senator

- Prefers connected infrastructure and efficient logistics.
- Wants healthy lanes and completed long-distance routes.
- Offers administrative or logistics policy affinities.
- Dislikes idle stations and inefficient travel.

Both strengthen Centralist mandate, but they ask the player to govern differently.

### Senators represent an ideology and a place

An assigned senator has four overlapping constituencies:

1. The empire as a whole.
2. Their political tags.
3. Their assigned station.
4. The region and solar system surrounding that station.

This should shape what the senator wants and how their influence is applied. A Centralist at a sun station may want the player to concentrate stations within one solar system and connect them to a central administrative network. A Centralist at a moon station may instead want nearby moons brought under a coherent frontier command.

Senator objectives should therefore be generated from both tags and location. A senator's objective is not just "perform a Centralist action"; it may be "perform a Centralist action here."

### Station posts

Station type changes the senator's office. No post should be universally superior; each should exchange empire-wide reach for local specialization.

#### Sun station post

A sun-station senator is a central authority figure.

Expected characteristics:

- Highest empire-wide political contribution.
- Strongest reach across the solar system.
- Better contribution to centralist, administrative, diplomatic, and imperial policies.
- Objectives involving system concentration, administration, pilot networks, and major infrastructure.
- Greater political-capital generation.
- High visibility and high vulnerability if the sun station is attacked.

#### Planet station post

A planet-station senator is a regional administrator.

Expected characteristics:

- Strong local and regional contribution.
- Objectives involving mining, production, construction, trade, and regional health.
- Better influence over nearby planets, moons, and regional projects.
- Moderate empire-wide political contribution.
- Strong interaction with industrialist, trade, humanitarian, ecological, and administrative policies.

#### Moon station post

A moon-station senator is a frontier or tactical authority.

Expected characteristics:

- Lower empire-wide contribution.
- Very strong local contribution around the assigned moon, planet, and nearby lanes.
- Objectives involving scanning, raiding, salvage, stealth, patrols, and frontier control.
- Better interaction with raider-aligned, covert, security, and exploration policies.
- Greater exposure to isolation, interdiction, and station loss.

#### Senator-hosting station types

Only sun, planet, and moon stations host senators in the current design. Deep-space structures may provide political, intelligence, piracy, or exploration effects, but they do not create Senate seats unless a later design explicitly changes this rule.

### Local and global influence

Senator influence may have both empire-wide and local components, but station type is not a universal ranking. The primary current rule is that the post changes which local station/region effects and objectives are available; any global-versus-local weighting remains a balance choice.

```text
Senator contribution =
  global political contribution
  + station-post contribution
  + local region and system contribution
```

| Post | Typical local identity |
|---|---|
| Sun | Capital administration, broad production, and capital-class ship operations. |
| Planet | Industry, regional health, and frigate/battleship operations. |
| Moon | Reconnaissance or raiding footholds, forward logistics, and contested frontier operations. |

These are strategic profiles, not a simple ranking. A senator's tags, happiness, objective, and specific station context determine the useful combination. A moon post is not inherently weaker than a sun post; it is valuable when the player's chosen identity depends on forward operations, reconnaissance, or raiding.

### Station loss and political vacancies

If a station hosting a senator is destroyed, the senator is killed. The senator is permanently removed from the active cabinet, their station assignment ends, and the seat becomes vacant. The game must explain the death and its political consequences; the senator must not silently disappear.

There is no emergency reassignment after station loss. A replacement may be appointed during the next Senate session. An active senator's station post is otherwise fixed until the senator's term ends or the senator dies; changing the post requires removing/replacing that senator during a session rather than freely moving them mid-term.

When a senator dies, the system should:

- Remove their happiness and tag contribution.
- Recalculate affected policy eligibility.
- Identify policies that have lost a requirement.
- Preserve a readable historical record.
- Mark the Senate seat vacant until the next session.
- Offer replacement candidates at the next session.

Policies should not be silently deleted in the middle of turn resolution. They should be marked at risk and reevaluated at the next session boundary, with a clearly communicated grace rule if the final implementation uses one.

### Senator seat progression

The current implementation target is four active senators. The player should begin with a small cabinet and grow into a more complex government through pilot access and deployed station development.

A possible progression is:

- Start with one senator assigned to the starting station.
- Add additional senators as the player establishes additional qualifying stations.
- Reach two or three senators through early station development.
- Reach four senators through meaningful pilot capacity and station expansion.

Once the player has four seats, new candidates are primarily replacement and succession choices rather than simple additions.

The default relationship should be direct and legible: one active senator requires one deployed qualifying station. A player with four active senators therefore needs at least four viable stations. Senate breadth is also tied to available pilots: station types and station development provide pilot capacity/access, which represents the population and operational base that the Senate serves. The exact thresholds remain balance variables.

Station count should be encouraged, not made trivially exploitable. Qualifying stations may need to be supplied, maintained, connected, or operational before they can host a senator. A disposable station should not create a permanent political seat at no meaningful cost.

### Terms and retirement

Senators may serve up to four terms. Each term is one Senate cycle of approximately 100 turns, so a senator can serve for approximately 400 turns before mandatory retirement. They must retire after their fourth completed term.

Terms should increase a senator's effectiveness:

- Term 1: normal contribution.
- Term 2: experienced contribution.
- Term 3: highly established contribution.
- Term 4: very strong contribution, but final term.

The player should always be able to see the senator's current term, remaining term count, and expected retirement session.

The four-term limit creates political succession as a strategic system. A player may enjoy a period where all four senators are experienced and powerful, but should anticipate that several may retire around the same time. Station loss can create an earlier succession problem by removing a senator's post before their term is complete.

Players should be able to retire or replace a senator only during a Senate session. Early retirement has no separate political-capital cost in the current direction; its cost is losing the senator's accumulated term strength and replacing them with a first-term senator. It may also create temporary mandate weakness.

- A player may change a senator's post by removing that senator and appointing a replacement at a later session. There is no direct mid-term reassignment action in the current direction.

### Legacy effects

A strong retiring senator should leave something behind so retirement feels like succession rather than deletion.

Possible legacy effects include:

- One related policy remains active for one additional session.
- A permanent minor bonus associated with the senator's primary tag.
- A successor candidate from the same political family.
- A one-time political capital grant.
- A reduced requirement for one related policy.

Legacy effects should be modest. The purpose is to reward long service without making old senators permanently superior to all future candidates.

## Senator objectives

Each active senator provides one personal objective during a Senate session. With four senators, the player may receive up to four objectives. Objectives are generated from the senator's tags, personality, term history, assigned station, region, and solar system.

Players should not be expected to complete every objective. Completing two or three should be meaningful, while completing more should reward highly aligned or highly active players.

Objective families include:

- Build a station in a particular system or region.
- Maintain a region above a health threshold.
- Generate or deploy a quantity of pilots.
- Mine a quantity of a particular mineral.
- Complete a trade route or convoy.
- Explore or scan a number of points of interest.
- Win or survive a combat objective.
- Escort another player or shared mission.
- Establish moon or deep-space presence.
- Control multiple planets in one system.
- Improve, repair, or defend infrastructure.
- Contribute resources to a regional project.

Station context should make otherwise similar objectives distinct:

- A Centralist at a sun station may request system concentration or administrative connectivity.
- An Industrialist at a planet station may request mineral production, construction, or pilot generation.
- A Technocrat at a moon station may request scanning, anomaly research, or sensor coverage.
- A Raider-Aligned senator at a moon station may request salvage, ambushes, or disruption of nearby logistics.
- A Humanist at a planet station may request recovery of the local region or support for nearby civilian infrastructure.

Objectives must be evaluated from authoritative server events, not client claims.

Objective completion should generally provide:

- A meaningful happiness increase.
- A mandate contribution for relevant tags.
- An immediate contextual reward where appropriate.
- Progress toward a related policy or synergy in some cases.

Failure should not catastrophically punish the player. The player should be able to remain moderately aligned through normal actions.

## Happiness and mandate rules

### Happiness should be continuous

Happiness should not be a binary “objective completed or failed” state. A senator may be:

- Very unhappy.
- Dissatisfied.
- Neutral.
- Content.
- Happy.
- Highly satisfied.

Ordinary aligned actions should move happiness gradually. Personal objectives should provide stronger changes. Conflicting policies and domain outcomes should reduce it.

### Happiness should modify, not fully determine, mandate

A neglected senator should still contribute something. Otherwise one missed objective or station setback can completely invalidate a political build.

A conceptual contribution model is:

```text
Senator tag contribution =
  base contribution
  x happiness multiplier
  x term experience multiplier
  x objective and synergy modifiers
```

Happiness multipliers should have a floor and a ceiling. A very unhappy senator contributes less, but does not erase the political movement entirely.

### Tag duplication is valuable

Two senators with the same tag should reinforce one another. This is intentional.

For example:

```text
Centralist senator + Centralist senator
  -> stronger Centralist mandate
  -> access to higher Centralist policy tiers
  -> more powerful concentration and administration effects
```

The cost is opportunity cost: two Centralists occupy seats that could have supported other political directions.

### Cross-tag synergies are secondary

Different tags may combine into hybrid policy paths:

- Centralist + Technocrat: optimized centralized administration.
- Centralist + Industrialist: centralized industrial state.
- Decentralist + Humanist: resilient regional federation.
- Technocrat + Trade Magnate: logistics network.
- Raider-Aligned + Technocrat: covert intelligence state.
- Security + Expansionist: militarized frontier.
- Ecologist + Humanist: restorative regional government.

Cross-tag synergies should be smaller and more situational than primary tag effects. They should expand the strategy space without creating one mathematically mandatory senator combination.

## Policy cards

Policy cards are the concrete powers unlocked by the player's Senate.

A policy card should define:

- Title.
- Description.
- Aggregate tag-mandate thresholds. Happiness, senator count, individual tags, terms, and station posts may change how much mandate the Senate produces, but they are not separate policy-card activation requirements.
- Policy category.
- Direct effects.
- Structural or external effects.
- Costs or tradeoffs.
- Whether it is temporary, persistent, or session-bound.

Example requirement:

```text
Requires:
- Centralist mandate of at least the card's declared threshold.
- Technocrat mandate of at least the card's declared threshold, if applicable.
```

The player does not necessarily spend mandate to unlock a card. Each senator's tags, happiness, and term strength produce an aggregate mandate, and the card becomes eligible when its declared thresholds are met. The player then chooses whether to activate it using an available policy slot.

Station posts, terms, objectives, and future synergies may alter mandate contribution or policy effects, but they should not introduce hidden secondary activation gates. A spatial policy still unlocks from its declared aggregate mandate thresholds; its station context determines where or how its effect applies.

### Policy categories

#### Operational policies

These provide direct effectiveness:

- Mining yield.
- Ship construction speed.
- Pilot generation.
- Fuel efficiency.
- Scanning.
- Repair.
- Salvage.
- Route planning.

These are useful for making a political path immediately tangible.

#### Structural policies

These change how the domain functions:

- Stations in one system share administrative bonuses.
- Distant systems operate more efficiently.
- Moon stations extend raiding range.
- Planet stations restore regional health more effectively.
- Controlled lanes gain stronger protection.
- Frontier infrastructure becomes cheaper but more exposed.

These should be the primary source of political identity.

#### External policies

These influence shared space:

- Trade corridors.
- Customs rules.
- Interdiction legality.
- Shared infrastructure.
- Regional protections.
- Sanctions or access rights.

These connect the player's internal government to multiplayer politics.

### Policy slots

Players should not activate every eligible policy simultaneously. Active policy slots create a government loadout.

Current implementation target: four total active policy slots, with only one slot initially unlocked. The remaining slots should unlock through additional pilot access/capacity and may later incorporate institutional influence. A five-slot government remains a possible later expansion, not the current baseline.

Possible expansion:

- One slot at the start of the political system.
- Additional slots as the player's pilot base and political institution grow.
- A fourth slot as the current first-implementation cap, with a fifth slot reserved for later balance exploration.

The player may have six eligible cards but only three active slots. This creates the important decision between political possibility and current commitment.

Policy slots may be unlocked through the combined institutional-influence value described above, rather than through station count alone. Station count, station type, development, regional health, and political milestones may all contribute to that value.

Policy effects should be centralized in a modifier layer so movement, construction, harvesting, pilots, stations, and missions can read them consistently.

### Policy capacity and institutional influence

The player begins with one active policy slot and a current target of four total slots. Policy capacity is government capacity, not senator count. The first expansion rule should use pilot access/capacity because pilots represent the population and operational base being represented by the Senate.

Additional policy slots may later incorporate a combined institutional-influence value derived from the player's physical political domain. Pilot access is the first implementation input; institutional influence should consider:

- The number of developed sun, planet, and moon stations.
- The base political value of each station type.
- Station development and upgrades.
- Regional health and infrastructure support.
- Connected logistics and administrative reach.
- System concentration or multi-system governance.

The intended station weighting is:

```text
Sun station: high institutional influence
Planet station: medium institutional influence
Moon station: low institutional influence
```

This does not mean that sun stations are always the best strategic choice. It means that they are more valuable for broad institutional capacity, while planet and moon networks can provide stronger regional or tactical advantages.

Conceptually:

```text
Policy capacity =
  one initially unlocked slot
  + slots unlocked by pilot access and later institutional thresholds
```

Exact thresholds and any hard cap are balance variables. The first implementation should use four total slots so policies feel meaningful without making the interface unreadable.

Institutional influence, tag mandate, and political capital are separate:

- Institutional influence determines how many policies the government can operate.
- Aggregate tag mandate determines which policy cards are eligible. Senator happiness matters indirectly by changing each senator's mandate contribution.
- Political capital is spent on external agendas, diplomacy, and civic naming rights.

This gives the player three distinct political questions:

```text
How much government can I operate?
What kind of government can I operate?
How much leverage do I have outside my own government?
```

### Policy tradeoffs

Policies should not all be unconditional improvements. Strong effects should create meaningful costs or exposure.

Examples:

- Faster ship construction but higher pilot consumption.
- Stronger lane security but higher maintenance.
- Better mining yield but greater regional health pressure.
- Stronger moon-station stealth but weaker conventional production.
- Higher system concentration bonuses but weaker multi-system administration.

This prevents every player from selecting the same universally optimal cards.

## Representative policy concepts

### Centralized Administration

Requires a high Centralist mandate and a supporting Technocrat mandate.

Possible effects:

- Stations in the same solar system share administrative efficiency.
- Reduced logistics cost inside the capital system.
- Increased pilot generation from connected stations.
- Reduced benefit from distant, disconnected holdings.

### Frontier Autonomy

Requires a high Decentralist mandate and a supporting Expansionist mandate.

Possible effects:

- Reduced penalties for stations outside the capital system.
- More resilient operations when the main system is blockaded.
- Stronger regional control without sun-station ownership.
- Lower system-wide coordination efficiency.

### Industrial Mobilization

Requires a high Industrialist mandate and a supporting Centralist mandate.

Possible effects:

- Faster ship and station construction.
- Increased pilot consumption.
- Increased regional health decay while active.
- Greater value from planet stations.

### Shadow Corridor Network

Requires a high Raider-Aligned mandate and a supporting Technocrat mandate.

Possible effects:

- Moon stations improve stealth and scouting.
- Deep-space structures have lower upkeep.
- Better salvage and disruption.
- Weaker protection for ordinary civilian traffic.

### Civilian Recovery Authority

Requires a high Humanist mandate and a supporting Ecologist mandate.

Possible effects:

- Regional recovery projects are stronger.
- Shared missions provide greater rewards.
- Station losses in protected regions have larger political consequences.
- Direct exploitation of stressed regions becomes less efficient.

## Political externalities

The political system should produce two kinds of effects.

### Internal specialization

Some policies simply make the player's chosen role more effective:

- Better mining.
- Better ship production.
- Better scouting.
- Better raiding.
- Better logistics.

These effects make the player's empire feel responsive and rewarding.

### Shared-world change

Other policies should alter the environment in which everyone plays:

- A lane becomes protected or restricted.
- A region becomes more productive or more expensive to exploit.
- Interdiction rules change.
- Fuel or trade access changes.
- A shared mission creates a temporary strategic center.
- A system becomes a recognized trade hub or contested corridor.

The strongest political fantasy comes from combining both. A player's Senate should make their own domain effective while also changing the opportunities and threats facing nearby players.

Station posts help localize these externalities. A sun-station policy may affect a whole system, a planet-station policy may affect one region, and a moon-station policy may affect a lane, orbital group, or frontier pocket. This gives players reasons to contest specific stations instead of treating every political conflict as an attempt to conquer an entire system.

## External political agendas

In addition to cabinet management and internal policy cards, Senate sessions may introduce a broader agenda item.

The agenda should be a separate layer from ordinary policy-card activation.

### Galactic laws

Galactic laws apply broadly to all players and should be temporary, expensive, or difficult to pass.

Examples:

- Universal ship-production rules.
- Fuel or logistics standards.
- Interdiction restrictions.
- Neutral-station protections.
- Salvage rights.
- Emergency war or recovery measures.

### Regional compacts

Regional compacts apply to a system or region.

Examples:

- Protected trade corridor.
- Open-access mineral reserve.
- Demilitarized lane.
- Customs regime.
- Shared recovery project.
- Regional emergency authority.

Regional voting should favor players with legitimate stakes there: station presence, controlled infrastructure, trade activity, active missions, or recognized influence.

### Diplomatic resolutions

Diplomatic resolutions affect relationships between players:

- Trade rights.
- Inspection rights.
- Shared defense.
- Sanctions.
- Access agreements.
- Recognition of a player as a pirate or hostile power.

These resolutions should create reasons to negotiate, cooperate, threaten, and form temporary coalitions.

### Voting fairness

External political power should be influential without becoming an automatic victory condition.

Suggested jurisdiction rules:

- Galactic laws: every player has a baseline vote; political capital can add bounded weight.
- Regional laws: players with stations, routes, missions, or infrastructure in the region receive additional weight.
- Domain laws: the controlling player has primary authority over private administration.
- Permanent changes: require higher thresholds or stronger consent.
- Emergency measures: pass more easily but expire after a fixed duration.

Outsiders should not casually vote away a player's private home system. They may influence contested regions and shared infrastructure where they have a legitimate stake.

### Agenda lifecycle

An external agenda item should move through visible phases:

```text
Proposal
  -> projected effects shown
  -> negotiation and lobbying period
  -> amendments or coalition formation
  -> political capital spending
  -> vote
  -> resolution
  -> timed world-state effect
```

The initial implementation does not need formal contracts. Player-visible proposals, chat, shared objectives, and explicit vote history can support negotiation before a full diplomacy system exists.

The first agenda-board shape should be intentionally small:

- One optional galaxy-wide agenda slot.
- One optional system-wide agenda slot per solar system.
- One optional regional agenda slot per region.
- Any eligible player may submit a proposal by paying its docket cost; simultaneous submissions require a deterministic first-commit rule.
- Galaxy-wide items are visible and votable by all players. System and regional items prioritize stakeholders with relevant infrastructure or operational presence.
- Non-stakeholders may be able to inspect the public proposal, but should not receive interruptive notifications for unrelated local votes.

This is a proposed first agenda shape, not a final voting formula. The stakeholder definition, vote weighting, agenda capacity, and law duration remain open.

## Multiplayer interaction

The political system should support several kinds of interaction beyond direct combat.

### Cooperation

Players may:

- Fund shared infrastructure.
- Coordinate votes.
- Protect trade corridors.
- Contribute to regional recovery.
- Share access to specialized minerals.
- Form temporary defense agreements.

### Competition

Players may:

- Compete for a scarce sun station.
- Establish footholds around an opponent's planets.
- Contest regional influence.
- Disrupt pilot generation.
- Raid fuel and station infrastructure.
- Compete for votes or policy outcomes.

### Political pressure

Players may:

- Use sanctions or access restrictions.
- Lobby neutral or smaller players.
- Create a law that makes a rival's operating style less effective.
- Offer votes in exchange for trade, access, or protection.
- Exploit a rival's succession crisis when several veteran senators retire.

Political pressure should create conflict without requiring every disagreement to become a spaceship battle.

## Alliances, wars, and diplomatic status

The political system needs a diplomatic layer between private Senate management and direct spaceship combat. The first version should recognize relationships and provide clear consequences without attempting to simulate every treaty detail.

### Diplomatic relationship states

Players should have an explicit relationship state with other players. Initial states may include:

- Unknown or unrecognized.
- Neutral.
- Open trade.
- Non-aggression pact.
- Defensive alliance.
- Full alliance.
- Rivalry or sanctioned.
- War.

Each state should have a readable definition of what it permits, prohibits, or encourages. The game should never require players to infer whether a shot, blockade, station seizure, or lane denial counts as an act of war.

### Alliances as operating agreements

An alliance should provide practical coordination rather than only a label.

Possible alliance benefits include shared vision or authorized sensor sharing, mutual access to stations or lanes, coordinated convoy objectives, shared regional missions, defensive response rights, limited use of allied infrastructure, and shared voting blocs in external agendas.

Alliance costs should include political-capital or upkeep requirements, obligations to respond to attacks, shared exposure when one ally is sanctioned or defeated, reduced freedom to pursue conflicting policies, and diplomatic penalties for betrayal or abandonment.

The first alliance implementation can use a small number of explicit permissions rather than a general-purpose contract language.

The first useful permissions should be attached to individual stations and deployables rather than inferred only from an alliance label. An owner may eventually control who can dock, refuel, repair, use local services, buy from a trade hub, or access a route. Permissions may distinguish free access from paid access and may be revoked without requiring a war declaration. This gives alliances practical value while preserving the possibility of betrayal or hostile action.

Trade hubs and similar large deployables are a future social-risk surface: they may be legitimate markets, access-controlled infrastructure, or dangerous bait. Their reputation and combat consequences should be designed separately from the initial Senate backbone.

### War as a political condition

War should be an explicit state with consequences beyond permission to attack. War may change lane legality and interdiction rules, station destruction and replacement rules, trade and access rights, regional health pressure, pilot recruitment or replacement, political objectives and senator happiness, external agenda priorities, and the value of security, expansionist, industrial, or humanitarian policies. Station capture is not part of the current station model: a destroyed station's site must be rebuilt or replaced rather than changing owner through capture.

War should also create political opportunities. A Security senator may become happier during a successful defensive war, while a Humanist senator may become unhappy with civilian losses. A Trade Magnate may support a short war that protects a corridor but oppose a prolonged blockade.

### War should not require total conquest

A player should be able to wage limited war over a planet and its moons, a station network, a fuel or logistics corridor, a contested resource region, a political resolution, or a specific blockade or access right. The system should support local conflict without forcing the winner to occupy an entire solar system.

### Diplomatic escalation

An initial escalation ladder may be:

```text
Neutral
  -> dispute or sanction
  -> limited hostilities
  -> declared war
  -> ceasefire or armistice
  -> peace settlement
```

The exact labels may change, but the game should distinguish accidental combat, local retaliation, declared war, and settled peace. Those states can feed political objectives and external votes.

### Political tools in alliance and war

Political capital may be used to propose an alliance or defensive pact, guarantee another player's station or route, create a trade or access agreement, sanction a player, request recognition of a blockade or war, fund a shared defense project, or push a ceasefire or peace resolution.

These actions should create leverage, not automatic control. A player with political capital can make a rival's life more difficult, but still needs fleets, logistics, and credible allies to enforce a position.

### Diplomatic history

Important agreements and violations should be recorded in a visible history: alliance formed, alliance broken, station guaranteed, treaty violated, war declared, ceasefire signed, sanction enacted, and peace settlement reached.

This history can affect senator happiness, candidate generation, reputation, and future negotiations.

This section is intentionally a placeholder for a later diplomacy design. The first political implementation should not depend on a complete alliance and war engine, but the data model should leave room for explicit relationship states, permissions, obligations, and diplomatic history.

## Senate session structure

The current target cadence is one shared Senate trigger for every player every 100 turns. The cadence should be configurable for testing and balance work.

The session is a persistent, non-blocking editing window rather than a turn-ending deadline:

1. The session becomes available at the cadence turn, even if the player is offline.
2. The player may continue ordinary gameplay while the session is pending.
3. The player may inspect the current domain, change cabinet/policy choices, and revert pending edits before committing.
4. When the session is resolved, changes lock at the next authoritative boundary defined by the implementation.
5. If the player never acts, the cabinet and policy loadout remain unchanged.
6. A later cadence does not stack multiple pending sessions. The exact supersession rule for a player who stays offline across multiple cadences is an implementation question.

Each session may contain:

1. Cabinet management: keep, replace, add, or retire senators. A replacement is assigned to a station; an active senator is not freely moved during a term.
2. Candidate presentation: show fixed, server-generated candidates and eligibility.
3. Personal objectives: one objective per active senator.
4. Happiness resolution: apply objective, action, synergy, and conflict changes.
5. Mandate update: recalculate tag strength and policy eligibility.
6. Policy loadout: select or replace active policies within available slots, beginning with one unlocked slot and a current target of four total slots.
7. External agenda: propose, negotiate, and vote on a broader measure.
8. Political capital: award the session's happiness-based capital and carry unspent capital forward.
9. Publication: show resulting policies, world effects, political-capital changes, and political history.

The player should be allowed to defer cabinet decisions indefinitely until they next engage with the pending session, without stacking additional sessions or blocking ordinary play. The UI should make unresolved vacancies, inactive policies, and missed opportunities visible without forcing a modal decision.

### Senate and command UI

Outside a pending session, the default Senate/command view should prioritize current state over the full policy catalog:

- Active senators, their terms, happiness, tags, posts, and local objectives.
- The four policy slots, showing locked, empty, active, and at-risk states.
- Current tag mandate, pilot-based policy capacity, and political-capital balance.
- A secondary view for all eligible and locked policy cards with visible requirements.
- Upcoming agenda items and votes that are relevant to the player's stakeholder interests.

Galaxy-wide agendas may be discoverable to everyone, but system and regional proposals should be emphasized through activity and notifications for players with relevant infrastructure or operational presence. Political state should also be readable through the activity log rather than only through a modal.

## Data and implementation boundaries

The future implementation should preserve the following conceptual records, whether or not the exact table names are used:

- Senator definitions.
- Player-owned senator instances.
- Senator station assignments and assignment history.
- Senator post type and local region/system context.
- Senator terms and history.
- Senate sessions.
- Session candidates.
- Senator objectives and progress.
- Tag mandate by player and game.
- Active policy cards.
- Policy-slot capacity.
- Institutional influence and policy-capacity thresholds.
- Political capital.
- External agenda items and votes.
- Timed regional or galactic effects.
- Diplomatic relationships, alliance permissions, war states, and treaty history.
- Civic names and naming history for major world objects.

The station assignment should be a first-class relationship rather than a presentation-only field. At minimum, authoritative state must be able to answer:

- Which station hosts each active senator?
- Which senator, if any, is assigned to each station?
- What happens when that station is destroyed or transferred?
- Which region and solar system define the senator's local constituency?
- Which post-specific effects are active?

The authoritative model must enforce:

- Only sun, planet, and moon stations can host senators.
- Every active senator has exactly one hosting station.
- Every senator-hosting station has at most one active senator.
- New appointments and replacements are only legal during an open Senate session. An active senator's station post is fixed until term end or death.
- Destruction of a senator-hosting station kills the assigned senator.
- A killed senator's seat remains vacant until a later Senate session.

Candidate generation, objective progress, happiness changes, mandate updates, policy eligibility, and voting outcomes must be server-authoritative and deterministic from committed game events.

The client should present previews, requirements, projections, and explanations. It must not be able to claim that an objective was completed, a vote was cast, a policy was unlocked, or a regional effect was applied.

## Implementation sequence

### Phase 0: Stabilize required foundations

Before Senate implementation, the following systems must be trustworthy:

- Station ownership and anchoring.
- Station type effects.
- Pilot capacity and generation.
- Region health changes.
- Turn resolution and transaction boundaries.
- Authenticated ownership checks.
- Movement and lane travel.
- Authoritative construction and resource consumption.

### Phase 1: Minimal Senate

Implement:

- One to four senators.
- One station assignment per active senator.
- Sessions and persistence.
- Candidate selection and replacement.
- Terms and retirement.
- Basic happiness.
- One personal objective per senator.
- A small number of tags.

For this phase, every active senator must be assigned to a deployed sun, planet, or moon station. Replacement is only available inside the Senate-session flow; an active senator cannot be moved between stations mid-term. Destroying an occupied station kills its senator and leaves the seat vacant until the next session.

The first station-assignment test should include a sun post, a planet post, and a moon post so the player can see that the same tag behaves differently by location.

Do not begin with the full quest engine or global agenda system.

### Phase 2: Mandate and policy cards

Implement:

- Tag mandate calculations.
- Happiness thresholds.
- Policy-card requirements.
- Active policy slots.
- One initially unlocked policy slot and a current target of four total slots, with pilot access/capacity as the first expansion input.
- Centralized policy modifiers.
- Policy invalidation and grace periods after retirement.

Start with a small card catalog covering trade, industry, security, technology, and raiding.

### Phase 3: Succession and synergies

Implement:

- Four-term retirement.
- Early replacement.
- Legacy effects.
- Same-tag reinforcement.
- A small set of cross-tag synergies.
- Clear warnings about future retirements and policy risk.
- Station-loss death, vacancies, and session-bound replacement.
- Post-specific influence and objective generation.

### Phase 4: External agendas

Implement:

- Political capital.
- Proposal and voting windows.
- One regional compact.
- One temporary galactic law.
- Stake-weighted regional voting.
- Vote history and player-readable explanations.
- A minimal diplomatic relationship state and one alliance permission set.
- Civic naming rights for stations, planets, moons, or systems.

### Phase 5: Broader political ecosystem

Later additions may include:

- Full diplomacy.
- Formal alliance permissions and obligations.
- Declared wars, ceasefires, peace settlements, and sanctions.
- Sanctions and access rights.
- Regional and galactic mission chains.
- Political events.
- Advanced coalition mechanics.
- Archetype-specific laws.
- Formal agreements and obligations.

## Design safeguards

### Do not make every card a passive percentage

Direct bonuses are useful, but the political system should also modify territory, logistics, legality, and strategic behavior.

### Do not make objectives mandatory chores

Senators should remain somewhat satisfied through aligned play. Objectives should offer acceleration, specialization, and difficult choices.

### Do not make retirement randomly delete a build

Use grace periods, successor candidates, and legacy effects. Retirement should create adaptation and succession planning, not arbitrary frustration.

### Do not let one station type dominate every strategy

Sun stations should be strongest individually in global reach, but planet and moon networks must produce viable alternative identities through regional strength, tactical specialization, and distributed resilience.

### Do not make station posts a hidden ranking

Sun, planet, and moon posts should not be treated as simple levels where every senator is always best at the sun. A post should exchange global reach for local specialization, and the correct assignment should depend on the player's current domain and strategy.

### Do not make senator loss silent or arbitrary

Station destruction must produce a clear political event, explain the senator's outcome, and show the resulting vacancy, policy risk, and replacement path.

### Do not let political power become a direct victory condition

Political power should alter the battlefield and create leverage, but players must still operate fleets, maintain infrastructure, and survive the physical game.

### Do not make diplomacy invisible

Alliance rights, war status, access restrictions, guarantees, sanctions, and treaty violations must be explicit and player-readable. Political consequences should never depend on an unstated social rule.

### Do not erase territorial history

When control changes, the map should retain meaningful evidence of previous powers through names, station history, treaties, and political records where appropriate.

### Do not permit hidden effects

Every policy, happiness change, mandate shift, vote, and externality should be visible in a log or explanation panel.

## Current design decisions

The current direction is:

- Up to four active senators in the current implementation target.
- Start with one senator assigned to the starting station and add seats through deployed station presence plus pilot access/capacity.
- Every active senator occupies one owned station.
- Only sun, planet, and moon stations can host senators.
- A new or replacement senator is assigned during a Senate session; an active senator remains at that post until term end or death.
- Destruction of a senator-hosting station kills the assigned senator and creates a vacancy.
- Station context changes the senator's local effects and objective pool. No station post is universally superior.
- Senator objectives care about both tags and assigned place.
- Senators serve up to four 100-turn terms, for approximately 400 turns total.
- Senators can retire early or be replaced at a Senate session; early removal costs the player the senator's accumulated term strength, not a separate political-capital fee.
- Each active senator supplies one session objective.
- Happiness is senator-specific.
- Tag mandate is aggregated across relevant senators.
- Political capital is a separate spendable external resource.
- Policy cards require aggregate tag-mandate thresholds; happiness influences eligibility only through mandate contribution.
- The government begins with one unlocked policy slot and a current target of four total slots.
- Additional policy slots initially depend on pilot access/capacity; institutional influence may become a combined later input.
- Senator posts, terms, and happiness may modify mandate generation or the scope of a policy's effect, but are not separate activation gates.
- Policies include direct bonuses and structural world effects.
- Same-tag senators reinforce a political movement.
- Cross-tag combinations create hybrid policy paths.
- Sun, planet, moon, and deep-space stations support different political identities.
- Senate sessions also provide a path toward regional and galactic agendas, with one optional galaxy slot, one per-system slot, and one per-region slot as the first agenda-board concept.
- Regional voting should favor players with legitimate local stakes.
- The physical map remains the source of political meaning.
- At session resolution, senator happiness bands provisionally generate political capital; unspent capital rolls over.
- A player who has seen an object may propose a low-cost civic name vote. Names persist historically and have no direct mechanical effect in the current direction.
- Alliance and war states are explicit diplomatic relationships, not implied combat permissions.
- Diplomatic history can influence senator happiness, objectives, reputation, and future negotiations.

## Open design questions

These questions should remain explicit until playtesting resolves them:

1. What exact pilot-capacity thresholds unlock seats two through four?
2. What supply, deployment, or operational threshold is required before a station can host a senator?
3. How much pilot capacity and generation should each station type provide?
4. Which concrete local effects should each station post provide without making one post universally superior?
5. How much happiness does an objective provide compared with ordinary aligned actions?
6. How quickly should tag mandate accumulate?
7. Should mandate ever decay, or only change through active Senate composition?
8. What pilot and later institutional thresholds unlock policy slots two through four?
9. Should the first implementation eventually expose a fifth policy slot?
10. How long should policies remain active after a senator retirement or station death invalidates their requirements?
11. How many policy cards should be visible at each stage?
12. Which tags are essential for the first playable political build?
13. Should the provisional 20/40/60/80/100 happiness-to-capital bands be linear, and should empty seats contribute nothing?
14. Should galactic votes be every Senate session or less frequent?
15. How should a binary system's second sun station affect political legitimacy and senator seats?
16. Which regional effects are safe for outsiders to vote on?
17. How much vote weight can political capital add before large empires become politically dominant?
18. Which policies should change shared world rules rather than only the owner's domain?
19. Which alliance permissions belong in the first diplomatic implementation?
20. What actions escalate a dispute into limited hostilities or declared war?
21. Which war effects should be automatic, and which require a political resolution?
22. What bidding/voting rule should resolve naming actions after the provisional two-capital submission fee is paid?
23. How should stakeholder voting work when visibility is sufficient to propose but infrastructure is not ownership?
24. How many local naming proposals may be active at once, and how are current and historical names displayed?
25. How should station destruction/replacement interact with names when station capture is not a supported mechanic?

## First proof of fun

The first end-to-end political test should be small:

1. A player has two senators with different tags.
2. Each senator is assigned to a different station type.
3. Each senator offers a different location-aware objective.
4. The player completes one objective and ignores the other.
5. One senator becomes happier and contributes more to a tag.
6. The happiness change alters aggregate tag mandate, causing a policy card to become eligible when its declared mandate threshold is met.
7. The player activates it in a limited policy slot.
8. The policy changes an existing behavior such as pilot generation, lane operation, mining, or scouting.
9. The station hosting one senator is damaged or destroyed and the political consequence is shown.
10. A later session introduces a replacement decision, with the new senator assigned to a different station if desired.
11. The player earns political capital from happiness and can submit a civic naming proposal.
12. The player must decide whether to preserve the current political build or change direction.

If this loop is satisfying, the larger systems—four-seat succession cycles, cross-tag synergies, political-capital spending, and external agendas—can be added with confidence.

## Final design statement

Starfront Dominion's political system should make players feel that their domain has a government with competing interests, institutional memory, and strategic consequences.

Senators are not passive bonus sources. They are temporary political leaders with agendas, constituencies, and physical posts.

Tags are not merely labels. They are political movements whose strength determines what the government can support.

Policy cards are not just rewards. They are the player's active governing philosophy.

Policy slots force commitment.

Term limits create succession and instability.

Stations and regional development give politics a physical foundation. A station is not only an economic asset; it may be a senator's office, constituency, and source of political reach.

Political capital gives players leverage beyond direct combat.

The desired result is a system where a player can say:

> My stations, fleets, policies, political cabinet, and senator postings all express the same strategy—and another player can challenge that strategy through territory, logistics, diplomacy, or force.
