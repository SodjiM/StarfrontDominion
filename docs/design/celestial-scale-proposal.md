# System scale proposal

Status: implemented as `physical-scale-v1` on September 13, 2026. Shared physical footprints now govern navigation, construction, deployment, warp exits, adjacency, harvesting, combat range, and selection outlines. New systems use larger celestial bodies and validated satellite envelopes. Existing saves are backed up and transactionally relocated on server startup; affected travel orders are cancelled with an explanation.

## Findings

The 5,000 × 5,000 system is ample. Standard generation currently uses sun radius 30, planet radius 12, and moon radius 6. Main-map rendering previously treated these as diameters, while server navigation blocks full-radius disks. Ships and stations previously rendered at 0.8 tiles and block one grid tile. Orbital scaffold spaces planetary tracks roughly 250–560 tiles apart, but moon centers are only 24–62 tiles from planets. Increasing celestial radii without regenerating those moon distances would cause overlap. Main-map diameter now agrees with the stored radius; unit display sizes are class-dependent and have a screen-size floor.

## Physical dimensions

All values below are full widths/diameters in tiles, not radii. They are gameplay proportions for playtesting, not astronomical scale.

| Class | Physical size |
|---|---:|
| Scout / courier | 1 × 1 |
| Frigate / mining ship | 2 × 2 |
| Cruiser | 3 × 3 |
| Capital ship / carrier | 5 × 5 |
| Buoy / mine / small deployable | 1 × 1 |
| Platform / turret | 2 × 2 to 3 × 3 |
| Outpost / moon station | 5 × 5 |
| Planet station | 9 × 9 |
| Major shipyard / sun station | 13 × 13 |
| Moon | 12–24 diameter |
| Rocky / ocean / ice planet | 40–80 diameter |
| Gas giant | 90–140 diameter |
| Primary sun | 240–360 diameter |

A useful first reference system uses a 280-tile sun, 60-tile rocky planets, 120-tile gas giants, and 18-tile moons. At a 1,000-pixel full-system view these are 56, 12, 24, and 3.6 pixels across. Ships must therefore retain minimum-size map symbols and detailed portraits even after physical scaling.

## Spacing rules

- Place the first planet center 550–750 tiles from the system center. Keep later orbit centers approximately 350–500 tiles apart; choose the count that actually fits.
- Allocate each planet a satellite envelope: max(planet radius, moon orbit distance + moon radius, station distance + station half-diagonal). Adjacent orbital radii must differ by at least both envelopes plus 60 tiles. Do not independently choose orbit count, spacing, and maximum radius.
- Moon-center distance must be at least planet radius + moon radius + 30 tiles. Start at 65–100 tiles for rocky worlds and 110–150 for giants. Separate moons from each other by their summed radii plus 20 tiles, using bounded rejection sampling with a deterministic fallback.
- Put stations outside their host: center distance >= host radius + station half-diagonal + 12 tiles. Reserve an arrival/build area outside the footprint. A sun station also needs the configured stellar hazard clearance.
- Require every satellite envelope to fit inside the grid with a 100-tile outer margin. For binary systems, validate against both suns and both hazard zones.
- Use compressed physical proportions and separate visual floors. Larger footprints alone do not make ships readable at full-system zoom.

## Implementation sequence

1. Centralize physical footprint definitions in a server/client shared catalog. Define whether even-sized footprints anchor at a tile center or tile boundary. Keep display extent and interaction hit area distinct from collision geometry.
2. Update navigation to sweep the entire moving footprint. Inflate obstacles by the moving unit extent, prevent corner clipping, and reserve destinations for simultaneous moves. A center-only occupancy check is insufficient.
3. Update build placement, adjacency, docking, harvesting, range measurement, warp exits, starting units, and turn processing to use the same footprint geometry. Preserve deliberate center-based scan rules explicitly.
4. Generate larger bodies and satellite envelopes together, validate non-overlap and reachability, then derive lanes/resources/arrival areas from the validated geometry. Use versioned generation for new worlds.
5. Migrate existing worlds only through an explicit relocation pass that checks ships, stations, resources, queued paths, and lane endpoints. Revalidate or cancel affected orders with an explanation.
6. Playtest travel time: local trips should take a few turns, neighboring planets a manageable number with warp, and full-system crossings should favor lanes. Tune speeds after measuring actual paths; do not multiply every speed by the visual scale.

## Acceptance checks

- Every sprite can be identified at tactical zoom and selected at its displayed extent.
- Different ship/station classes have visible silhouette and size differences.
- No planet/moon/station overlap; all arrival/build points are reachable.
- A 5 × 5 ship cannot pass a 3-tile corridor or clip diagonal corners.
- Simultaneous movement cannot reserve overlapping footprints.
- Existing saves retain valid destinations or receive an explicit migration outcome.

## Implementation and validation

The initial sun diameter is 280 tiles. New systems select an orbit count that fits within the grid (up to five planets; binary configurations may fit fewer). Migration preserves existing planet counts, including six- and seven-planet systems, using compact satellite envelopes where necessary. Unit speeds remain unchanged pending travel-time playtesting.

The shared catalog is `client/utils/physical-scale.js`. Odd widths use a central tile; even widths use the northwest central tile as their anchor. Navigation checks every occupied tile through movement and diagonal transitions. Lanes are rerouted for capital-ship clearance; resources and station launches are placed outside solid footprints.

Verification: full suite passed (33 tests), followed by an additional passing rollback test. Physical-scale tests exercise all 14 archetypes across 1,400 deterministic spacing samples, full generated systems, destination conflicts, narrow corridors, legacy migration, idempotence, and rollback after injected failure. Production build and syntax checks passed. Browser verification confirmed the migrated Explorer reports a 2 × 2 footprint and displays beside the enlarged station and celestial bodies.

Startup stores SQLite backups in `.data/backups/before-physical-scale-<timestamp>.sqlite`, with each exact backup path recorded in `scale_migrations.report_json`. Restore only with the server stopped, preserving the current database and its WAL/SHM files together before replacing the database from backup. The migration is versioned and does not reposition already migrated systems on subsequent starts.
