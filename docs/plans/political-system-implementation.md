# Political System Implementation Plan

## Purpose and relationship to design authority

This plan converts the durable rules in [../design/political-system-design-tenets.md](../design/political-system-design-tenets.md) into bounded implementation slices. The design document defines the intended player experience and rules; this file defines sequencing, integration boundaries, and implementation readiness.

The political system is not a separate minigame. It reads committed events from stations, pilots, construction, mining, trade, movement, combat, regional operations, and diplomacy, then changes the player's available capabilities and the shared political environment.

## Current direction

- A player may have up to four active senators in the current implementation target. The four-seat cap is intentionally separate from the four-term lifetime of a senator; it is a provisional cabinet-size choice, not a rule that must remain permanent.
- Every active senator occupies exactly one owned sun, planet, or moon station.
- A station hosts at most one active senator. Deep-space structures do not host senators in the current design.
- A new or replacement senator is assigned to a specific station during a Senate session and remains posted there until the term ends or the senator dies. Active senators are not freely reassigned mid-term; changing a post requires removing/replacing the senator during a later session.
- Destroying an occupied station kills its senator and leaves the seat vacant until a later session.
- All players receive a Senate-session trigger on the same cadence, currently every 100 turns. A player's unresolved session remains available until they act; missed sessions do not stack, and ignoring a session leaves the cabinet unchanged.
- Senate sessions provide one objective per active senator and present up to four replacement candidates.
- Senators serve up to four sessions/terms, approximately 400 turns, before mandatory retirement.
- Happiness is senator-specific; tag mandate is aggregated political strength; institutional influence controls policy capacity; political capital is spendable external leverage.
- The government has four policy slots in the first balance target, with one slot initially unlocked. Additional slots are provisionally unlocked by pilot access/capacity and may later incorporate institutional influence from the station network.
- Policies require visible tag and happiness conditions and may produce direct, structural, or external effects.
- Station type is a strategic tradeoff: sun stations favor broad institutional reach, planet stations favor regional development, and moon stations favor tactical/frontier specialization.
- More stations should generally be valuable, while maintenance, exposure, logistics, and regional pressure create the balancing surface.

## Immediate implementation scope

The first playable slice should establish the complete internal loop without requiring the final station economy or multiplayer diplomacy:

1. Persist senators, station assignments, sessions, candidates, objectives, happiness, terms, mandate, institutional influence, policy slots, political capital, active policies, and naming proposals/history.
2. Generate four deterministic replacement candidates during each session.
3. Allow station-backed appointment and session-bound replacement with authoritative ownership and occupancy checks; do not expose free mid-term reassignment.
4. Reconcile station destruction into a visible senator death and vacant seat.
5. Resolve terms and retirement at session boundaries.
6. Evaluate objectives from authoritative committed events and apply continuous happiness changes.
7. Recalculate tag mandate with happiness, term, objective, and station-post modifiers.
8. Expose a small policy catalog with visible requirements, activation/deactivation, slot limits, and centralized effect metadata.
9. Generate political capital from senator happiness at session resolution, carry it forward when unspent, and emit session availability and political consequences after turn commit.
10. Establish civic naming proposals as the first small external political action, while leaving the broader law catalog deferred.

This slice may use provisional station influence values and a small tag/card catalog. Those values are tuning variables, not durable balance commitments.

## Requirements and constraints

### Authority and persistence

- The server is authoritative for candidate generation, assignments, objective progress, happiness, mandate, policy eligibility, policy activation, terms, retirement, station loss, and political history.
- Client requests may select among valid options but may not claim completion, invent progress, bypass session windows, or supply costs/effects.
- Senator-to-station assignment is a first-class relationship with uniqueness enforced in the database and validated in service code.
- Station loss must be handled during reconciliation and must not silently leave an active senator pointing at a missing or foreign object.
- Political mutations must participate in the same turn/request transaction boundaries as the event that caused them where practical.

### Session behavior

- A session opens for every player on the shared cadence, currently turns 100, 200, 300, and so on.
- A pending session remains available when a player is offline or continues ordinary play. It is not a modal lock and does not block turn progression.
- There is at most one pending session per player. If another cadence arrives before the player resolves the earlier one, the system must not stack multiple cabinet edits; the exact supersession/preservation rule is an implementation detail to settle before automation.
- Ignoring or closing a session without saving leaves senators, policies, and vacancies unchanged. Empty seats are not automatically filled.
- A player may inspect their domain, test eligibility, and revise pending choices before committing. The intended UX includes a revert-to-session-start action and locks the final changes at a turn boundary or explicit session commit; the exact commit timing remains provisional.
- At most four senators may be active, and every active senator must have a deployed qualifying station.

### Objectives and happiness

- Each active senator receives at most one active objective per session.
- Objective progress must come from committed server events, not client-submitted counters.
- Ordinary aligned actions should provide gradual happiness support; objectives are stronger opportunities, not mandatory chores.
- Missing an objective should reduce happiness or forgo a reward without invalidating the entire political build.
- Objective definitions must include the relevant tags, post, system/region context, target, progress source, reward, and failure behavior.
- A station-based objective may deliberately make the assigned post a visible strategic signal: placing a senator at a raiding or reconnaissance moon communicates likely activity there and may attract contesting attention.

### Policies and capacity

- Policy cards must declare title, description, tag requirements, happiness requirements, optional post/term requirements, category, effect, cost/tradeoff, duration, and invalidation behavior.
- Activation is limited by policy slots. Eligibility and capacity are separate checks.
- The first implementation target has four total policy slots and one unlocked slot. Additional slots are provisionally tied to available pilot capacity/access, with institutional influence retained as a likely later or combined input.
- Institutional influence, tag mandate, and political capital remain separate resources even if they share station and happiness inputs.
- Policy effects must be read through a centralized modifier layer so construction, pilots, mining, movement, stations, regional operations, and missions do not implement divergent policy rules.
- If an active policy loses its requirements, the system must use an explicit grace/invalidation rule and explain the consequence to the player.

## Current implementation-ready work

### Slice A: Senate backbone

Ready now:

- Schema and migration for senator instances, station assignments, sessions, candidates, objectives, mandate, political state, and active policies.
- Server routes/services for state reads, appointment, replacement, session closure, and station-loss reconciliation. Mid-term reassignment is intentionally excluded from this slice.
- Turn-resolution hook for session creation at the configured cadence.
- Client Senate view showing senators, posts, terms, happiness, objectives, mandate, influence, and policy capacity.
- Focused tests for station eligibility, one-senator-per-station, session-bound replacement, station destruction, term/session behavior, and persistence.

Definition of done:

- A new player with a qualifying station receives one assigned senator.
- A Senate session presents candidates and one objective per active senator.
- Appointment and replacement reject foreign, invalid, occupied, or non-session targets; an active senator's station remains fixed through the term.
- A destroyed hosting station produces a killed senator and a vacancy.
- Four completed terms retire a senator predictably.
- State survives reload and reconnect without relying on client storage.

### Slice B: Objective event integration

Ready now as a bounded extension:

- Introduce a single objective-progress service accepting typed server events such as `production`, `ship_build`, `combat`, `raid`, `trade`, `mining`, `scan`, `regional_response`, and `pilot_generation`.
- Hook only events that already have authoritative completion records first.
- Store progress against the session objective and make completion idempotent.
- Apply happiness during session closure or an explicitly defined event-resolution point, but never twice for the same objective.

Definition of done:

- Replaying a turn or event does not double-count progress.
- A player can see why an objective advanced.
- At least one economic, one exploration/operations, and one conflict objective are tested from server events.
- Objective progress is scoped to the senator's assigned station/system/region when the definition requires location.

### Slice C: Policy-card foundation

Ready now as a rules/persistence slice:

- Maintain a small data-driven catalog covering central administration, industry, technology, frontier/security, trade, and regional cooperation.
- Enforce tag-mandate and happiness requirements server-side.
- Enforce one initially unlocked slot, four total target slots, and provisional pilot-capacity thresholds.
- Persist activation/deactivation and expose active, eligible, locked, and at-risk states in the UI.
- Keep effect metadata declarative until each effect has an authoritative consumer.

Definition of done:

- A policy cannot activate without its requirements or an available slot.
- Activating the same policy twice is idempotent.
- Deactivation frees a slot without deleting historical activation information.
- A senator loss or happiness change reevaluates policy status and presents the result clearly.
- At least two policies modify real gameplay behavior, not only a displayed number, before this slice is considered complete.

### Slice D: Political capital and civic naming

Implementation-ready foundation:

- At the end of a Senate session, each senator contributes political capital according to happiness bands: 20/40/60/80/100 happiness currently map to 1/2/3/4/5 points.
- The player's total is the sum of all active senators' contributions. Unspent political capital persists across sessions.
- The happiness-to-capital mapping is a provisional balance table, but the accumulation, rollover, and server authority are current direction.
- A player who has seen an object through authorized visibility may submit a low-cost naming proposal for a sun, planet, moon, asteroid belt, or solar system.
- Naming proposals are political agenda items rather than direct ownership. Names persist until a later successful naming vote changes them, and naming has no mechanical combat or production effect in the current direction.
- Naming proposals should be cheap enough to act as an approachable first political action; an initial proposal fee around five political capital is a provisional starting point.

Definition of done:

- Session resolution awards capital once per senator and cannot double-award on retry.
- Political capital rolls over and is visible in the command/Senate interface.
- An unseen object cannot be named through client claims.
- A valid naming proposal enters the appropriate docket and preserves current and historical names.
- The proposal, vote, result, and name change appear in activity/history without revealing unauthorized world state.
- The command/Senate UI shows upcoming proposals relevant to the player, while public proposal inspection remains available without interruptive notifications for unrelated local agendas.

The first agenda board may reserve one optional galaxy-wide slot, one optional system-wide slot per solar system, and one optional regional slot per region. This is ready as a persistence/UI foundation; final vote weighting and law effects remain later work.

## Dependencies and interactions

| System | Required interaction |
|---|---|
| Stations | Station class, ownership, operational state, destruction/replacement semantics, development, upkeep, and placement determine seats and institutional influence. Station capture is not a current mechanic. |
| Pilots | Station pilot capacity/generation connects political development to fleet growth and supports industrial, technocratic, and frontier objectives. |
| Turn resolution | Session cadence, event ordering, term changes, objective evaluation, and post-commit broadcasts must be deterministic and atomic. |
| Construction and economy | Build completion, station construction, resource use, maintenance, and ship production provide objective inputs and policy consumers. |
| Mining and trade | Authoritative harvest and trade completion events provide economic objectives and future policy effects. |
| Combat and movement | Combat outcomes, raids, scouting, interdiction, and route completion provide conflict/frontier objectives and external pressure. |
| Regional operations | Health, incidents, response missions, capacity, and local control provide senator constituencies and future regional policies. |
| Information/visibility | Political facts and external effects must obey the viewer-aware contract; membership must not reveal hidden political or operational state. |
| Alliances and wars | Diplomatic status, permissions, treaties, sanctions, and escalation eventually supply political objectives and external agenda effects. |
| Civic naming | Naming proposals require authorized prior visibility and political capital. Local stakeholder voting, proposal limits, and name-history behavior are staged rules described below. |

## Staged future work

These are meaningful workstreams from the discussion, but they are not prerequisites for the first Senate backbone:

1. **Post-specific effects:** make station-specific assignments alter local station/region behavior in ways that affect actual gameplay without treating sun as universally superior.
2. **Succession depth:** early-retirement costs, legacy effects, replacement families, retirement warnings, and policy grace periods.
3. **Tag and cross-tag depth:** duplicate-tag tiers, centralist/technocrat and other hybrid synergies, personality preferences, and opposing policies.
4. **External political agendas:** negotiation, vote weight, regional compacts, and temporary galactic laws. Political-capital generation and the first naming proposal are now part of the immediate foundation.
5. **Diplomatic state:** explicit alliance permissions, access rights, guarantees, sanctions, war declarations, ceasefires, peace settlements, and treaty history.
6. **Civic naming rights beyond the first proposal:** stakeholder weighting, docket limits, system/region scope, renaming history, and eventual name-safety handling.
7. **Full policy effect library:** structural externalities that change logistics, regional health, legality, trade, mobility, or shared-space behavior rather than only personal percentages.

## Unresolved design questions

- What pilot-capacity thresholds unlock seats two through four, and how do sun/planet/moon stations contribute pilots?
- How do station costs, maintenance, pilot capacity, and destruction balance the desire to build more stations?
- Which local station effects should each post provide without making one post universally better?
- How should the shared-session state behave when a player remains offline across more than one cadence?
- How much vote weight can political capital buy without making large empires dominant?
- Which policies receive a grace period after losing a senator, station, or happiness requirement?
- Which policy effects may change shared regional rules, and which remain owner-only?
- Which alliance permissions belong in the first diplomatic slice, and what escalates a dispute into war?
- How should stakeholder voting work for naming proposals when visibility is enough to propose but infrastructure is not yet a formal ownership system?
- How many naming proposals may occupy a system, region, and galaxy docket at once?
- Which objective families are fun at the 100-turn cadence, and how many should be offered before they feel like chores?

## Explicitly not current direction

- Seat count proportional to raw station count without operational/development constraints; this would reward disposable stations.
- Treating political influence, senator happiness, tag mandate, institutional influence, and political capital as one resource.
- Allowing every station type, including deep-space structures, to host senators.
- Moving an active senator between stations during a term; post changes require session-bound replacement or later succession.
- Making players complete every senator objective to remain politically viable.
- Making every policy a permanent personal percentage bonus.
- Letting political power replace physical fleet, logistics, or infrastructure play as a victory condition.
- Treating regional or solar-system ownership as binary map ownership.
- Treating alliances or wars as implicit social conventions rather than explicit, readable state.

## Cross-system proof of fun

The first meaningful playtest should show a player choosing between at least two station portfolios—such as a concentrated sun/planet government and a distributed moon network—then:

1. appointing senators to different posts;
2. receiving location-aware objectives;
3. completing some objectives through ordinary construction, operations, or conflict;
4. seeing happiness and tag mandate change;
5. activating a limited policy loadout;
6. feeling at least one real gameplay effect;
7. responding to a station loss or political vacancy; and
8. earning and spending political capital on a civic naming proposal; and
9. deciding whether to preserve or replace the resulting political build at the next session.

The external galactic-law and alliance/war loop is not required for this proof, but the data model and event boundaries must leave room for it.
