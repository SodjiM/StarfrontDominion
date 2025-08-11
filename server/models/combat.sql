-- Combat System Schema (Phase 1)
-- Idempotent table creation for combat orders, ability orders, status effects, cooldowns, and logs

-- Orders to attack during turn resolution
CREATE TABLE IF NOT EXISTS combat_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER NOT NULL,
    turn_number INTEGER NOT NULL,
    attacker_id INTEGER NOT NULL, -- sector_objects.id
    target_id INTEGER NOT NULL,   -- sector_objects.id
    weapon_key TEXT,              -- optional: specific weapon/ability key
    desired_range INTEGER,        -- optional hint for AI/movement (band center or tiles)
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (game_id) REFERENCES games(id),
    FOREIGN KEY (attacker_id) REFERENCES sector_objects(id),
    FOREIGN KEY (target_id) REFERENCES sector_objects(id)
);

CREATE INDEX IF NOT EXISTS idx_combat_orders_turn ON combat_orders(game_id, turn_number);
CREATE INDEX IF NOT EXISTS idx_combat_orders_attacker ON combat_orders(attacker_id);
CREATE INDEX IF NOT EXISTS idx_combat_orders_target ON combat_orders(target_id);

-- Ability activations queued for the current turn
CREATE TABLE IF NOT EXISTS ability_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER NOT NULL,
    turn_number INTEGER NOT NULL,
    caster_id INTEGER NOT NULL,   -- sector_objects.id
    ability_key TEXT NOT NULL,
    target_object_id INTEGER,     -- optional object target
    target_x INTEGER,             -- optional position target
    target_y INTEGER,
    params TEXT,                  -- JSON payload for extra args
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (game_id) REFERENCES games(id),
    FOREIGN KEY (caster_id) REFERENCES sector_objects(id),
    FOREIGN KEY (target_object_id) REFERENCES sector_objects(id)
);

CREATE INDEX IF NOT EXISTS idx_ability_orders_turn ON ability_orders(game_id, turn_number);
CREATE INDEX IF NOT EXISTS idx_ability_orders_caster ON ability_orders(caster_id);

-- Persistent status effects on ships (buffs/debuffs)
CREATE TABLE IF NOT EXISTS ship_status_effects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ship_id INTEGER NOT NULL,     -- sector_objects.id
    effect_key TEXT NOT NULL,
    magnitude REAL,               -- generic numeric magnitude (optional)
    effect_data TEXT,             -- JSON blob for arbitrary effect data
    source_object_id INTEGER,     -- who applied it
    applied_turn INTEGER,
    expires_turn INTEGER,         -- inclusive expiry turn; NULL for instant effects already applied
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (ship_id) REFERENCES sector_objects(id),
    FOREIGN KEY (source_object_id) REFERENCES sector_objects(id)
);

CREATE INDEX IF NOT EXISTS idx_status_effects_ship ON ship_status_effects(ship_id);
CREATE INDEX IF NOT EXISTS idx_status_effects_expiry ON ship_status_effects(expires_turn);

-- Cooldowns per ship and ability
CREATE TABLE IF NOT EXISTS ability_cooldowns (
    ship_id INTEGER NOT NULL,     -- sector_objects.id
    ability_key TEXT NOT NULL,
    available_turn INTEGER NOT NULL,
    PRIMARY KEY (ship_id, ability_key),
    FOREIGN KEY (ship_id) REFERENCES sector_objects(id)
);

CREATE INDEX IF NOT EXISTS idx_ability_cd_available ON ability_cooldowns(available_turn);

-- Combat logs for UI and debugging
CREATE TABLE IF NOT EXISTS combat_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER NOT NULL,
    turn_number INTEGER NOT NULL,
    attacker_id INTEGER,
    target_id INTEGER,
    event_type TEXT NOT NULL,     -- 'attack', 'kill', 'ability', 'effect', etc.
    summary TEXT,                 -- short human-readable line
    data TEXT,                    -- JSON payload
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (game_id) REFERENCES games(id),
    FOREIGN KEY (attacker_id) REFERENCES sector_objects(id),
    FOREIGN KEY (target_id) REFERENCES sector_objects(id)
);

CREATE INDEX IF NOT EXISTS idx_combat_logs_turn ON combat_logs(game_id, turn_number);
CREATE INDEX IF NOT EXISTS idx_combat_logs_target ON combat_logs(target_id);


