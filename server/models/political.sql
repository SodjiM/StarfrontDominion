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
    expires_turn INTEGER NOT NULL, -- legacy compatibility; player sessions do not expire
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

-- Immutable evidence that an authoritative game event advanced an objective.
-- The uniqueness key makes turn retries and repeated ingestion idempotent.
CREATE TABLE IF NOT EXISTS senator_objective_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    objective_id INTEGER NOT NULL,
    game_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    source_type TEXT NOT NULL,
    source_id TEXT NOT NULL,
    turn_number INTEGER NOT NULL,
    amount REAL NOT NULL DEFAULT 1,
    summary TEXT NOT NULL,
    context_json TEXT NOT NULL DEFAULT '{}',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (objective_id) REFERENCES senator_objectives(id) ON DELETE CASCADE,
    FOREIGN KEY (game_id) REFERENCES games(id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(objective_id, event_type, source_type, source_id)
);

CREATE INDEX IF NOT EXISTS idx_senator_objective_events_session
    ON senator_objective_events(objective_id, turn_number, id);

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
    policy_slots INTEGER NOT NULL DEFAULT 1,
    political_capital REAL NOT NULL DEFAULT 0,
    updated_turn INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (game_id, user_id)
);

-- Append-only political capital journal. player_political_state remains the
-- authoritative cached balance; writers update it with each journal entry so
-- unspent capital rolls over between sessions.
CREATE TABLE IF NOT EXISTS political_capital_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    amount REAL NOT NULL,
    entry_type TEXT NOT NULL CHECK (entry_type IN ('award', 'spend', 'adjustment')),
    source_key TEXT NOT NULL,
    source_type TEXT NOT NULL,
    source_id TEXT,
    session_id INTEGER,
    turn_number INTEGER,
    happiness INTEGER,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (game_id) REFERENCES games(id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(game_id, user_id, source_key)
);

CREATE INDEX IF NOT EXISTS idx_political_capital_ledger_balance
    ON political_capital_ledger(game_id, user_id, id);

-- Naming is intentionally proposal-only in this slice. The target and name
-- snapshots are immutable, while decision/enactment fields leave room for a
-- later civic-history transition without rewriting proposal records.
CREATE TABLE IF NOT EXISTS civic_naming_proposals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    client_request_key TEXT NOT NULL,
    target_type TEXT NOT NULL CHECK (target_type IN ('sun', 'planet', 'moon', 'asteroid_belt', 'solar_system')),
    target_id INTEGER NOT NULL,
    target_snapshot_json TEXT NOT NULL,
    proposed_name TEXT NOT NULL,
    previous_name TEXT,
    current_name TEXT,
    capital_cost REAL NOT NULL DEFAULT 2,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'enacted')),
    submitted_turn INTEGER NOT NULL DEFAULT 0,
    decided_turn INTEGER,
    enacted_turn INTEGER,
    history_entry_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (game_id) REFERENCES games(id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(game_id, user_id, client_request_key)
);

CREATE INDEX IF NOT EXISTS idx_civic_naming_proposals_target
    ON civic_naming_proposals(game_id, target_type, target_id, status);

CREATE TABLE IF NOT EXISTS player_active_policies (
    game_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    policy_key TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    activated_turn INTEGER NOT NULL,
    PRIMARY KEY (game_id, user_id, policy_key)
);

-- Append-only record of genuine policy selection transitions. The current
-- selection lives in player_active_policies; this table is never updated or
-- deleted when a policy is deactivated.
CREATE TABLE IF NOT EXISTS player_policy_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    policy_key TEXT NOT NULL,
    event_type TEXT NOT NULL CHECK (event_type IN ('activation', 'deactivation')),
    turn_number INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (game_id) REFERENCES games(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_player_policy_history
    ON player_policy_history(game_id, user_id, policy_key, turn_number, id);
