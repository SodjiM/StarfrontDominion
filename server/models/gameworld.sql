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
    FOREIGN KEY (game_id) REFERENCES games(id),
    UNIQUE(game_id, turn_number)
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

-- One authoritative row per bidirectional gate connection. Canonical sector
-- ordering prevents A→B and B→A from being represented as separate links.
CREATE TABLE IF NOT EXISTS interstellar_gate_pairs (
    pair_id TEXT PRIMARY KEY,
    game_id INTEGER NOT NULL,
    sector_a_id INTEGER NOT NULL,
    sector_b_id INTEGER NOT NULL,
    gate_a_object_id INTEGER,
    gate_b_object_id INTEGER,
    status TEXT NOT NULL DEFAULT 'reserving' CHECK (status IN ('reserving','operational','disabled','removed')),
    slots_reserved INTEGER NOT NULL DEFAULT 0 CHECK (slots_reserved IN (0,1)),
    disabled_reason TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    CHECK (sector_a_id < sector_b_id),
    UNIQUE (game_id, sector_a_id, sector_b_id),
    FOREIGN KEY (game_id) REFERENCES games(id),
    FOREIGN KEY (sector_a_id) REFERENCES sectors(id),
    FOREIGN KEY (sector_b_id) REFERENCES sectors(id)
);

CREATE INDEX IF NOT EXISTS idx_gate_pairs_objects ON interstellar_gate_pairs(gate_a_object_id, gate_b_object_id);

-- Backfill valid legacy pairs. Existing disabled/partial pairs remain legacy
-- objects and are handled conservatively by the lifecycle fallback.
INSERT OR IGNORE INTO interstellar_gate_pairs
    (pair_id,game_id,sector_a_id,sector_b_id,gate_a_object_id,gate_b_object_id,status,slots_reserved)
SELECT json_extract(first_gate.meta,'$.gatePairId'), first_sector.game_id,
       MIN(first_gate.sector_id,second_gate.sector_id), MAX(first_gate.sector_id,second_gate.sector_id),
       CASE WHEN first_gate.sector_id < second_gate.sector_id THEN first_gate.id ELSE second_gate.id END,
       CASE WHEN first_gate.sector_id < second_gate.sector_id THEN second_gate.id ELSE first_gate.id END,
       'operational', 1
FROM sector_objects first_gate
JOIN sector_objects second_gate
  ON first_gate.id < second_gate.id
 AND json_extract(first_gate.meta,'$.gatePairId') = json_extract(second_gate.meta,'$.gatePairId')
JOIN sectors first_sector ON first_sector.id=first_gate.sector_id
JOIN sectors second_sector ON second_sector.id=second_gate.sector_id AND second_sector.game_id=first_sector.game_id
WHERE first_gate.type='interstellar-gate' AND second_gate.type='interstellar-gate'
  AND first_gate.sector_id <> second_gate.sector_id
  AND json_extract(first_gate.meta,'$.gatePairId') IS NOT NULL
  AND COALESCE(json_extract(first_gate.meta,'$.disabled'),0)=0
  AND COALESCE(json_extract(second_gate.meta,'$.disabled'),0)=0
  AND COALESCE(json_extract(first_gate.meta,'$.destroyed'),0)=0
  AND COALESCE(json_extract(second_gate.meta,'$.destroyed'),0)=0
  AND COALESCE(json_extract(first_gate.meta,'$.operational'),1)<>0
  AND COALESCE(json_extract(second_gate.meta,'$.operational'),1)<>0;

-- Reconcile the cached slot counter from live operational endpoints at startup.
UPDATE sectors
SET gates_used=(
    SELECT COUNT(*) FROM sector_objects gate_object
    WHERE gate_object.sector_id=sectors.id
      AND gate_object.type='interstellar-gate'
      AND COALESCE(json_extract(gate_object.meta,'$.disabled'),0)=0
      AND COALESCE(json_extract(gate_object.meta,'$.destroyed'),0)=0
      AND COALESCE(json_extract(gate_object.meta,'$.operational'),1)<>0
      AND COALESCE(json_extract(gate_object.meta,'$.hp'),1)>0
);

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
    sector_id INTEGER,
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

-- Immutable evidence that a viewer could see an object on a specific turn.
-- This is intentionally separate from object_visibility, which is mutable
-- discovery memory and therefore cannot safely authorize historical data.
CREATE TABLE IF NOT EXISTS object_visibility_history (
    game_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    sector_id INTEGER NOT NULL,
    object_id INTEGER NOT NULL,
    turn_number INTEGER NOT NULL,
    visibility_level INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (game_id, user_id, sector_id, object_id, turn_number),
    FOREIGN KEY (game_id) REFERENCES games(id),
    FOREIGN KEY (object_id) REFERENCES sector_objects(id)
);

CREATE INDEX IF NOT EXISTS idx_objvis_history_lookup
    ON object_visibility_history(game_id, user_id, sector_id, turn_number);

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

-- Authoritative pilot pool. Available pilots are unassigned living pilots;
-- deployed is derived from live ships and recovering from the death queue.
CREATE TABLE IF NOT EXISTS pilot_ledgers (
    game_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    capacity INTEGER NOT NULL DEFAULT 5,
    available INTEGER NOT NULL DEFAULT 5,
    regen_rate REAL NOT NULL DEFAULT 1,
    regen_progress REAL NOT NULL DEFAULT 0,
    last_regenerated_turn INTEGER NOT NULL DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (game_id, user_id),
    FOREIGN KEY (game_id) REFERENCES games(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS turn_pilot_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER NOT NULL,
    turn_number INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    recovered INTEGER NOT NULL DEFAULT 0,
    recruited INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (game_id) REFERENCES games(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_turn_pilot_events_player ON turn_pilot_events(game_id,user_id,turn_number);
