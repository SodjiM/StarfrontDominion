-- Server-authoritative political system state.
-- Catalog definitions and policy definitions are seeded by the political service.

CREATE TABLE IF NOT EXISTS senate_senators (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    definition_key TEXT NOT NULL,
    name TEXT NOT NULL,
    tags_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    happiness INTEGER NOT NULL DEFAULT 50,
    term_number INTEGER NOT NULL DEFAULT 1,
    appointed_turn INTEGER NOT NULL DEFAULT 1,
    retired_turn INTEGER,
    station_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (game_id) REFERENCES games(id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (station_id) REFERENCES sector_objects(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_senate_active_station
    ON senate_senators(game_id, station_id)
    WHERE status = 'active' AND station_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_senate_player
    ON senate_senators(game_id, user_id, status);

CREATE TABLE IF NOT EXISTS senate_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    opened_turn INTEGER NOT NULL,
    expires_turn INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    closed_turn INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(game_id, user_id, opened_turn)
);

CREATE INDEX IF NOT EXISTS idx_senate_sessions_player
    ON senate_sessions(game_id, user_id, status, opened_turn);

CREATE TABLE IF NOT EXISTS senate_candidates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    definition_key TEXT NOT NULL,
    name TEXT NOT NULL,
    tags_json TEXT NOT NULL,
    station_class TEXT NOT NULL,
    rarity TEXT NOT NULL DEFAULT 'common',
    selected INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES senate_sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS senator_objectives (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    senator_id INTEGER NOT NULL,
    session_id INTEGER NOT NULL,
    objective_key TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    target_json TEXT NOT NULL,
    progress_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    happiness_reward INTEGER NOT NULL DEFAULT 10,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_turn INTEGER,
    FOREIGN KEY (senator_id) REFERENCES senate_senators(id) ON DELETE CASCADE,
    FOREIGN KEY (session_id) REFERENCES senate_sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_senator_objectives_active
    ON senator_objectives(senator_id, status);

CREATE TABLE IF NOT EXISTS player_tag_mandate (
    game_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    tag TEXT NOT NULL,
    value REAL NOT NULL DEFAULT 0,
    updated_turn INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (game_id, user_id, tag)
);

CREATE TABLE IF NOT EXISTS player_political_state (
    game_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    institutional_influence REAL NOT NULL DEFAULT 0,
    policy_slots INTEGER NOT NULL DEFAULT 5,
    political_capital REAL NOT NULL DEFAULT 0,
    updated_turn INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (game_id, user_id)
);

CREATE TABLE IF NOT EXISTS player_active_policies (
    game_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    policy_key TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    activated_turn INTEGER NOT NULL,
    PRIMARY KEY (game_id, user_id, policy_key)
);
