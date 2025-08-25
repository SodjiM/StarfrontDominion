-- Belt sectors, wormhole links, lanes and runtime

CREATE TABLE IF NOT EXISTS belt_sectors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sector_id INTEGER NOT NULL,
    belt_key TEXT NOT NULL,
    sector_index INTEGER NOT NULL,
    region_id TEXT NOT NULL,
    inner_radius INTEGER NOT NULL,
    width INTEGER NOT NULL,
    arc_start REAL NOT NULL,
    arc_end REAL NOT NULL,
    density TEXT NOT NULL,
    hazard TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (sector_id) REFERENCES sectors(id)
);

CREATE INDEX IF NOT EXISTS idx_belt_sectors_sector ON belt_sectors(sector_id);
CREATE INDEX IF NOT EXISTS idx_belt_sectors_region ON belt_sectors(sector_id, region_id);

CREATE TABLE IF NOT EXISTS wormhole_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sector_id INTEGER NOT NULL,
    a_object_id INTEGER NOT NULL,
    b_object_id INTEGER,
    external_sector_id INTEGER,
    stability INTEGER NOT NULL,
    mass_limit TEXT NOT NULL,
    cooldown INTEGER NOT NULL,
    window_json TEXT,
    direction_bias REAL DEFAULT 0.0,
    flags_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (sector_id) REFERENCES sectors(id),
    FOREIGN KEY (a_object_id) REFERENCES sector_objects(id),
    FOREIGN KEY (b_object_id) REFERENCES sector_objects(id),
    FOREIGN KEY (external_sector_id) REFERENCES sectors(id)
);

CREATE INDEX IF NOT EXISTS idx_wormhole_links_sector ON wormhole_links(sector_id);

CREATE TABLE IF NOT EXISTS lane_edges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sector_id INTEGER NOT NULL,
    cls TEXT NOT NULL,
    region_id TEXT NOT NULL,
    polyline_json TEXT NOT NULL,
    width_core INTEGER NOT NULL,
    width_shoulder INTEGER NOT NULL,
    lane_speed REAL NOT NULL,
    cap_base INTEGER NOT NULL,
    headway INTEGER NOT NULL,
    mass_limit TEXT NOT NULL,
    window_json TEXT,
    permits_json TEXT,
    protection_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (sector_id) REFERENCES sectors(id)
);

CREATE INDEX IF NOT EXISTS idx_lane_edges_sector ON lane_edges(sector_id);

CREATE TABLE IF NOT EXISTS lane_taps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    edge_id INTEGER NOT NULL,
    x INTEGER NOT NULL,
    y INTEGER NOT NULL,
    poi_object_id INTEGER,
    side TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (edge_id) REFERENCES lane_edges(id),
    FOREIGN KEY (poi_object_id) REFERENCES sector_objects(id)
);

CREATE INDEX IF NOT EXISTS idx_lane_taps_edge ON lane_taps(edge_id);

CREATE TABLE IF NOT EXISTS lane_transits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    edge_id INTEGER NOT NULL,
    ship_id INTEGER NOT NULL,
    direction INTEGER NOT NULL,
    progress REAL NOT NULL,
    cu REAL NOT NULL,
    mode TEXT NOT NULL,
    entered_turn INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (edge_id) REFERENCES lane_edges(id),
    FOREIGN KEY (ship_id) REFERENCES sector_objects(id)
);

CREATE INDEX IF NOT EXISTS idx_lane_transits_edge ON lane_transits(edge_id);
CREATE INDEX IF NOT EXISTS idx_lane_transits_ship ON lane_transits(ship_id);

CREATE TABLE IF NOT EXISTS lane_edges_runtime (
    edge_id INTEGER PRIMARY KEY,
    load_cu REAL NOT NULL DEFAULT 0,
    closed_until_turn INTEGER,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (edge_id) REFERENCES lane_edges(id)
);

CREATE TABLE IF NOT EXISTS interdiction_buoys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sector_id INTEGER NOT NULL,
    edge_id INTEGER,
    x INTEGER,
    y INTEGER,
    owner_id INTEGER,
    radius INTEGER NOT NULL DEFAULT 180,
    expires_turn INTEGER,
    meta TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (sector_id) REFERENCES sectors(id),
    FOREIGN KEY (edge_id) REFERENCES lane_edges(id),
    FOREIGN KEY (owner_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_buoys_sector ON interdiction_buoys(sector_id);


