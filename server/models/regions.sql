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

-- Mineral weighting rules per region (for gated secondaries)
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


