CREATE TABLE IF NOT EXISTS games (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    mode TEXT,
    status TEXT, -- 'recruiting', 'active', 'finished'
    auto_turn_minutes INTEGER DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS game_players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    game_id INTEGER,
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    avatar TEXT DEFAULT NULL,
    color_primary TEXT DEFAULT NULL,
    color_secondary TEXT DEFAULT NULL,
    setup_completed BOOLEAN DEFAULT FALSE,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (game_id) REFERENCES games(id)
); 