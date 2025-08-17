-- Game world and sector management
CREATE TABLE IF NOT EXISTS sectors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER,
    owner_id INTEGER,
    name TEXT,
    archetype TEXT DEFAULT NULL,
    width INTEGER DEFAULT 5000,
    height INTEGER DEFAULT 5000,
    gate_slots INTEGER DEFAULT 3,
    gates_used INTEGER DEFAULT 0,
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
    meta TEXT, -- JSON for properties (HP, name, visibility, stealth, alwaysKnown, etc.)
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

-- Deprecated: player_visibility table has been replaced by object_visibility

-- Ship movement orders
CREATE TABLE IF NOT EXISTS movement_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    object_id INTEGER,
    destination_x INTEGER,
    destination_y INTEGER,
    movement_speed INTEGER DEFAULT 4,
    eta_turns INTEGER,
    movement_path TEXT, -- JSON array of path coordinates
    current_step INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active', -- 'active', 'blocked', 'completed', 'cancelled'
    blocked_by TEXT, -- JSON info about what blocked the movement
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (object_id) REFERENCES sector_objects(id)
);

-- STAGE 4 OPTIMIZATION: Spatial indexing for performance
-- Index for spatial queries on sector objects (used in visibility calculations)
CREATE INDEX IF NOT EXISTS idx_sector_objects_spatial ON sector_objects(sector_id, x, y);

-- Index for sector objects by owner (used when finding player units)
CREATE INDEX IF NOT EXISTS idx_sector_objects_owner ON sector_objects(sector_id, owner_id);

-- Removed legacy player_visibility indexes. Visibility is handled via object_visibility and stateless computation.

-- Index for movement orders by object and status
CREATE INDEX IF NOT EXISTS idx_movement_orders_active ON movement_orders(object_id, status);

-- Index for turn management
CREATE INDEX IF NOT EXISTS idx_turns_game_status ON turns(game_id, turn_number, status);

-- Index for turn locks
CREATE INDEX IF NOT EXISTS idx_turn_locks_game_turn ON turn_locks(game_id, turn_number, locked);

-- PHASE 1: Movement history tracking for accurate trail system
-- Track actual movement segments (where ships really traveled each turn)
CREATE TABLE IF NOT EXISTS movement_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    object_id INTEGER,
    game_id INTEGER,
    turn_number INTEGER,
    from_x INTEGER,
    from_y INTEGER,
    to_x INTEGER,
    to_y INTEGER,
    movement_speed INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (object_id) REFERENCES sector_objects(id),
    FOREIGN KEY (game_id) REFERENCES games(id)
);

-- Index for movement history queries (by ship, game, turn)
CREATE INDEX IF NOT EXISTS idx_movement_history_ship ON movement_history(object_id, game_id, turn_number);

-- Index for movement history by game and turn (for cleanup and queries)
CREATE INDEX IF NOT EXISTS idx_movement_history_game_turn ON movement_history(game_id, turn_number); 

-- Pilot system: queue of dead pilots with respawn timers (per game and player)
CREATE TABLE IF NOT EXISTS dead_pilots_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    count INTEGER NOT NULL DEFAULT 1,
    respawn_turn INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (game_id) REFERENCES games(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_dead_pilots_by_turn ON dead_pilots_queue(game_id, user_id, respawn_turn);