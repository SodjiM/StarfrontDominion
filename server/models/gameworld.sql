-- Game world and sector management
CREATE TABLE IF NOT EXISTS sectors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER,
    owner_id INTEGER,
    name TEXT,
    width INTEGER DEFAULT 5000,
    height INTEGER DEFAULT 5000,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (game_id) REFERENCES games(id),
    FOREIGN KEY (owner_id) REFERENCES users(id)
);

-- Sparse storage for sector objects (ships, stations, POIs)
CREATE TABLE IF NOT EXISTS sector_objects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sector_id INTEGER,
    type TEXT, -- 'ship', 'starbase', 'asteroid', 'anomaly', etc.
    x INTEGER,
    y INTEGER,
    owner_id INTEGER,
    meta TEXT, -- JSON for properties (HP, name, visibility, stealth, etc.)
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (sector_id) REFERENCES sectors(id),
    FOREIGN KEY (owner_id) REFERENCES users(id)
);

-- Turn management system
CREATE TABLE IF NOT EXISTS turns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER,
    turn_number INTEGER DEFAULT 1,
    status TEXT DEFAULT 'waiting', -- 'waiting', 'resolving', 'completed'
    resolved_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (game_id) REFERENCES games(id)
);

-- Track which players have locked their turn
CREATE TABLE IF NOT EXISTS turn_locks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER,
    user_id INTEGER,
    turn_number INTEGER,
    locked BOOLEAN DEFAULT FALSE,
    locked_at DATETIME,
    FOREIGN KEY (game_id) REFERENCES games(id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(game_id, user_id, turn_number)
);

-- Player visibility/fog of war data
CREATE TABLE IF NOT EXISTS player_visibility (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER,
    user_id INTEGER,
    sector_id INTEGER,
    x INTEGER,
    y INTEGER,
    last_seen_turn INTEGER,
    visibility_level INTEGER DEFAULT 1, -- 1=seen, 2=scanned, 3=detailed
    FOREIGN KEY (game_id) REFERENCES games(id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (sector_id) REFERENCES sectors(id),
    UNIQUE(game_id, user_id, sector_id, x, y)
);

-- Ship movement orders
CREATE TABLE IF NOT EXISTS movement_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    object_id INTEGER,
    destination_x INTEGER,
    destination_y INTEGER,
    movement_speed INTEGER DEFAULT 4,
    eta_turns INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (object_id) REFERENCES sector_objects(id)
); 