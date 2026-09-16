-- Regions, health, projects, and mineral rules

CREATE TABLE IF NOT EXISTS regions (
    sector_id INTEGER NOT NULL,
    region_id TEXT NOT NULL CHECK (region_id IN ('A','B','C')),
    cells_json TEXT NOT NULL,
    health INTEGER NOT NULL DEFAULT 50,
    projects_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (sector_id, region_id),
    FOREIGN KEY (sector_id) REFERENCES sectors(id)
);

CREATE INDEX IF NOT EXISTS idx_regions_sector ON regions(sector_id);

-- Capacity is standardized by default. Rows exist only when a scenario or a
-- future archetype deliberately overrides one region's prototype capacity.
CREATE TABLE IF NOT EXISTS region_capacity_overrides (
    sector_id INTEGER NOT NULL,
    region_id TEXT NOT NULL,
    capacity INTEGER NOT NULL CHECK (capacity > 0),
    reason TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (sector_id, region_id),
    FOREIGN KEY (sector_id, region_id) REFERENCES regions(sector_id, region_id)
);

CREATE INDEX IF NOT EXISTS idx_region_capacity_sector ON region_capacity_overrides(sector_id, region_id);

CREATE TABLE IF NOT EXISTS region_health_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sector_id INTEGER NOT NULL,
    region_id TEXT NOT NULL,
    turn_number INTEGER NOT NULL,
    health INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (sector_id) REFERENCES sectors(id)
);

CREATE INDEX IF NOT EXISTS idx_region_health_hist ON region_health_history(sector_id, region_id, turn_number);

-- Immutable per-turn operational pressure. These rows are observations, not
-- regional health mutations and are safe to replay with INSERT OR IGNORE.
CREATE TABLE IF NOT EXISTS region_pressure_history (
    sector_id INTEGER NOT NULL,
    region_id TEXT NOT NULL,
    turn_number INTEGER NOT NULL,
    capacity INTEGER NOT NULL,
    infrastructure_load INTEGER NOT NULL,
    utilization REAL NOT NULL,
    pressure_score REAL NOT NULL,
    pressure_band TEXT NOT NULL,
    status_version INTEGER NOT NULL,
    catalog_version INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (sector_id, region_id, turn_number),
    FOREIGN KEY (sector_id, region_id) REFERENCES regions(sector_id, region_id)
);

CREATE INDEX IF NOT EXISTS idx_region_pressure_latest ON region_pressure_history(sector_id, region_id, turn_number DESC);

-- Shared regional incidents generated from immutable pressure observations.
-- This first slice records actionable timers only; incident expiration and
-- resolution deliberately do not mutate regional health yet.
CREATE TABLE IF NOT EXISTS region_incidents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER NOT NULL,
    sector_id INTEGER NOT NULL,
    region_id TEXT NOT NULL,
    incident_key TEXT NOT NULL,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    utility_role TEXT NOT NULL,
    severity TEXT NOT NULL CHECK (severity IN ('minor','significant','severe','critical')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','resolved','expired','cancelled')),
    created_turn INTEGER NOT NULL,
    due_turn INTEGER NOT NULL,
    pressure_turn INTEGER NOT NULL,
    pressure_band TEXT NOT NULL,
    pressure_score REAL NOT NULL,
    generation_roll REAL NOT NULL,
    generation_version INTEGER NOT NULL,
    resolved_turn INTEGER,
    outcome TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (sector_id, region_id, created_turn),
    FOREIGN KEY (game_id) REFERENCES games(id),
    FOREIGN KEY (sector_id, region_id) REFERENCES regions(sector_id, region_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_region_incidents_one_active
    ON region_incidents(sector_id, region_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_region_incidents_game_turn
    ON region_incidents(game_id, created_turn);
CREATE INDEX IF NOT EXISTS idx_region_incidents_sector_status
    ON region_incidents(sector_id, status, due_turn);

-- A response records intent to address a shared incident. Multiple players
-- may respond concurrently; later utility missions will provide completion
-- evidence. Response state alone has no regional-health effect.
CREATE TABLE IF NOT EXISTS region_incident_responses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    incident_id INTEGER NOT NULL,
    game_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','cancelled')),
    started_turn INTEGER NOT NULL,
    completed_turn INTEGER,
    outcome TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (incident_id, user_id),
    FOREIGN KEY (incident_id) REFERENCES region_incidents(id),
    FOREIGN KEY (game_id) REFERENCES games(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_incident_responses_incident_status
    ON region_incident_responses(incident_id, status);
CREATE INDEX IF NOT EXISTS idx_incident_responses_player
    ON region_incident_responses(game_id, user_id, status);

CREATE TABLE IF NOT EXISTS region_projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sector_id INTEGER NOT NULL,
    region_id TEXT NOT NULL,
    key TEXT NOT NULL,
    status TEXT NOT NULL,
    progress INTEGER DEFAULT 0,
    poi_object_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (sector_id) REFERENCES sectors(id),
    FOREIGN KEY (poi_object_id) REFERENCES sector_objects(id)
);

CREATE INDEX IF NOT EXISTS idx_region_projects_sector ON region_projects(sector_id, region_id, key);

-- Legacy-compatible mineral weighting rules per region. The gated and
-- unlock_threshold columns are retained for old saves, but resource-profile-v2
-- treats these rows as abundance biases rather than health-based unlocks.
CREATE TABLE IF NOT EXISTS mineral_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sector_id INTEGER NOT NULL,
    region_id TEXT NOT NULL,
    mineral_name TEXT NOT NULL,
    weight REAL NOT NULL,
    gated INTEGER NOT NULL DEFAULT 0,
    unlock_threshold INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (sector_id) REFERENCES sectors(id)
);

CREATE INDEX IF NOT EXISTS idx_mineral_rules_sector_region ON mineral_rules(sector_id, region_id, mineral_name);
