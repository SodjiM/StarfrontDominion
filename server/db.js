const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

const db = new sqlite3.Database('./database.sqlite');

// Initialize tables sequentially to avoid issues
let dbReadyResolve;
const dbReady = new Promise((resolve) => { dbReadyResolve = resolve; });

const initializeDatabase = async () => {
    try {
        // Apply core PRAGMAs for performance and durability
        db.serialize(() => {
            db.run('PRAGMA foreign_keys = ON');
            db.run('PRAGMA journal_mode = WAL');
            db.run('PRAGMA synchronous = NORMAL');
        });
        const usersSchema = fs.readFileSync(path.join(__dirname, 'models/users.sql'), 'utf8');
        const gamesSchema = fs.readFileSync(path.join(__dirname, 'models/games.sql'), 'utf8');
        const gameworldSchema = fs.readFileSync(path.join(__dirname, 'models/gameworld.sql'), 'utf8');
        const celestialSchema = fs.readFileSync(path.join(__dirname, 'models/celestial_objects.sql'), 'utf8');
        const resourceSchema = fs.readFileSync(path.join(__dirname, 'models/resource_system.sql'), 'utf8');
        const combatSchema = fs.readFileSync(path.join(__dirname, 'models/combat.sql'), 'utf8');
        
        // Execute schemas sequentially using promises
        await new Promise((resolve, reject) => {
            db.exec(usersSchema, (err) => {
                if (err) {
                    console.error('Error creating users table:', err);
                    reject(err);
                } else {
                    console.log('✅ Users table ready');
                    resolve();
                }
            });
        });
        // Backfill/migrate last_seen_at column if needed
        await new Promise((resolve) => {
            db.run(`ALTER TABLE users ADD COLUMN last_seen_at DATETIME`, (err) => {
                // ignore if exists
                resolve();
            });
        });
        
        await new Promise((resolve, reject) => {
            db.exec(gamesSchema, (err) => {
                if (err) {
                    console.error('Error creating games tables:', err);
                    reject(err);
                } else {
                    console.log('✅ Games tables ready');
                    resolve();
                }
            });
        });
        
        await new Promise((resolve, reject) => {
            db.exec(gameworldSchema, (err) => {
                if (err) {
                    console.error('Error creating gameworld tables:', err);
                    console.error('Schema content:', gameworldSchema.substring(0, 200) + '...');
                    reject(err);
                } else {
                    console.log('✅ Gameworld tables ready');
                    resolve();
                }
            });
        });

        // Apply celestial objects schema extensions with proper migration handling
        await new Promise((resolve, reject) => {
            console.log('🔧 Applying celestial objects schema migrations...');
            
            // Add columns individually with error handling
            const addColumn = (tableName, columnDef, callback) => {
                db.run(`ALTER TABLE ${tableName} ADD COLUMN ${columnDef}`, (err) => {
                    if (err && !err.message.includes('duplicate column')) {
                        console.error(`Error adding column ${columnDef}:`, err);
                        return callback(err);
                    }
                    if (err && err.message.includes('duplicate column')) {
                        console.log(`👍 Column ${columnDef.split(' ')[0]} already exists, skipping`);
                    } else {
                        console.log(`✅ Added column ${columnDef.split(' ')[0]}`);
                    }
                    callback(null);
                });
            };
            
            // Add celestial object columns sequentially
            addColumn('sector_objects', 'radius INTEGER DEFAULT 1', (err1) => {
                if (err1) return reject(err1);
                
                addColumn('sector_objects', 'celestial_type TEXT DEFAULT NULL', (err2) => {
                    if (err2) return reject(err2);
                    
                    addColumn('sector_objects', 'parent_object_id INTEGER DEFAULT NULL', (err3) => {
                        if (err3) return reject(err3);
                        
                        addColumn('sectors', 'generation_seed INTEGER DEFAULT NULL', (err4) => {
                            if (err4) return reject(err4);
                            
                            addColumn('sectors', 'generation_completed BOOLEAN DEFAULT FALSE', (err5) => {
                                if (err5) return reject(err5);
                                
                                addColumn('sectors', 'celestial_objects_count INTEGER DEFAULT 0', (err6) => {
                                    if (err6) return reject(err6);
                                    
                                    // Now apply the rest of the schema
                                    db.exec(celestialSchema, (err) => {
                                        if (err) {
                                            console.error('Error applying celestial objects schema:', err);
                                            reject(err);
                                        } else {
                                            console.log('✅ Celestial objects schema applied');
                                            
                                            // Apply resource system then combat schema (protect against FK issues on upsert)
                                            db.exec(resourceSchema, (err) => {
                                                if (err) {
                                                    console.error('Error applying resource system schema:', err);
                                                    reject(err);
                                                } else {
                                                    console.log('✅ Resource system schema applied');
                                                    db.exec(combatSchema, (cerr) => {
                                                        if (cerr) {
                                                            console.error('Error applying combat system schema:', cerr);
                                                            reject(cerr);
                                                        } else {
                                                            console.log('✅ Combat system schema applied');
                                                            resolve();
                                                        }
                                                    });
                                                }
                                            });
                                        }
                                    });
                                });
                            });
                        });
                    });
                });
            });
        });

        // Create or migrate object visibility memory table (per-object memory, not per-tile)
        await new Promise((resolve, reject) => {
            console.log('🔧 Ensuring object_visibility table exists...');
            db.run(
                `CREATE TABLE IF NOT EXISTS object_visibility (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    game_id INTEGER NOT NULL,
                    user_id INTEGER NOT NULL,
                    sector_id INTEGER NOT NULL,
                    object_id INTEGER NOT NULL,
                    last_seen_turn INTEGER,
                    last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    best_visibility_level INTEGER DEFAULT 1,
                    UNIQUE(game_id, user_id, sector_id, object_id)
                )`,
                (err) => {
                    if (err) {
                        console.error('Error creating object_visibility table:', err);
                        return reject(err);
                    }
                    // Helpful indexes
                    db.run(
                        'CREATE INDEX IF NOT EXISTS idx_objvis_lookup ON object_visibility(game_id, user_id, sector_id)',
                        (idxErr) => {
                            if (idxErr) {
                                console.error('Error creating index idx_objvis_lookup:', idxErr);
                                return reject(idxErr);
                            }
                            db.run(
                                'CREATE INDEX IF NOT EXISTS idx_objvis_object ON object_visibility(object_id)',
                                (idxErr2) => {
                                    if (idxErr2) {
                                        console.error('Error creating index idx_objvis_object:', idxErr2);
                                        return reject(idxErr2);
                                    }
                                    console.log('✅ object_visibility table ready');
                                    resolve();
                                }
                            );
                        }
                    );
                }
            );
        });

        // Additional helpful indexes and column migrations
        await new Promise((resolve) => {
            // Composite index for turn locks
            db.run('CREATE INDEX IF NOT EXISTS idx_turn_locks_composite ON turn_locks(game_id, turn_number, user_id)', () => {});
            // Resource nodes fast lookup per sector
            db.run('CREATE INDEX IF NOT EXISTS idx_resource_nodes_sector ON resource_nodes(sector_id)', () => {});
            // Movement history lookup
            db.run('CREATE INDEX IF NOT EXISTS idx_movement_history_game_turn ON movement_history(game_id, turn_number)', () => {});
            db.run('CREATE INDEX IF NOT EXISTS idx_movement_history_object ON movement_history(object_id)', () => {});
            // Hot fields on sector_objects to reduce JSON parsing (best-effort, ignore if exist)
            const addHotColumn = (def) => db.run(`ALTER TABLE sector_objects ADD COLUMN ${def}`, (err) => {
                if (err && !String(err.message).includes('duplicate column')) {
                    console.warn('Hot column migration warning:', err.message);
                }
            });
            addHotColumn('scan_range INTEGER');
            addHotColumn('movement_speed INTEGER');
            addHotColumn('can_active_scan INTEGER');
            resolve();
        });

        // Insert sample games
        await new Promise((resolve, reject) => {
            db.run(`INSERT OR IGNORE INTO games (id, name, mode, status) VALUES 
                (1, 'Galaxy Alpha', 'campaign', 'recruiting'),
                (2, 'Sector War Beta', 'persistent', 'active'),
                (3, 'Exploration Gamma', 'campaign', 'recruiting')`, 
                (err) => {
                    if (err) {
                        console.error('Error inserting sample games:', err);
                        reject(err);
                    } else {
                        console.log('✅ Sample games inserted');
                        resolve();
                    }
                }
            );
        });
        
        // Apply database migrations for new columns
        await new Promise((resolve, reject) => {
            // Add new columns to game_players if they don't exist
            db.run(`ALTER TABLE game_players ADD COLUMN avatar TEXT DEFAULT NULL`, (err) => {
                // Ignore error if column already exists
                if (err && !err.message.includes('duplicate column')) {
                    console.error('Migration error (avatar):', err);
                }
            });
            
            db.run(`ALTER TABLE game_players ADD COLUMN color_primary TEXT DEFAULT NULL`, (err) => {
                if (err && !err.message.includes('duplicate column')) {
                    console.error('Migration error (color_primary):', err);
                }
            });
            
            db.run(`ALTER TABLE game_players ADD COLUMN color_secondary TEXT DEFAULT NULL`, (err) => {
                if (err && !err.message.includes('duplicate column')) {
                    console.error('Migration error (color_secondary):', err);
                }
            });
            
            db.run(`ALTER TABLE game_players ADD COLUMN setup_completed BOOLEAN DEFAULT FALSE`, (err) => {
                if (err && !err.message.includes('duplicate column')) {
                    console.error('Migration error (setup_completed):', err);
                }
            });
            
            // Add archetype column to sectors if it doesn't exist
            db.run(`ALTER TABLE sectors ADD COLUMN archetype TEXT DEFAULT NULL`, (err) => {
                if (err && !err.message.includes('duplicate column')) {
                    console.error('Migration error (archetype):', err);
                }
            });
            
            // Add new movement order columns
            db.run(`ALTER TABLE movement_orders ADD COLUMN movement_path TEXT`, (err) => {
                if (err && !err.message.includes('duplicate column')) {
                    console.error('Migration error (movement_path):', err);
                }
            });
            
            db.run(`ALTER TABLE movement_orders ADD COLUMN current_step INTEGER DEFAULT 0`, (err) => {
                if (err && !err.message.includes('duplicate column')) {
                    console.error('Migration error (current_step):', err);
                }
            });
            
            db.run(`ALTER TABLE movement_orders ADD COLUMN status TEXT DEFAULT 'active'`, (err) => {
                if (err && !err.message.includes('duplicate column')) {
                    console.error('Migration error (status):', err);
                }
            });
            
            db.run(`ALTER TABLE movement_orders ADD COLUMN blocked_by TEXT`, (err) => {
                if (err && !err.message.includes('duplicate column')) {
                    console.error('Migration error (blocked_by):', err);
                }
                
                // Add warp-specific columns
                db.run(`ALTER TABLE movement_orders ADD COLUMN warp_target_id INTEGER`, (err) => {
                    if (err && !err.message.includes('duplicate column')) {
                        console.error('Migration error (warp_target_id):', err);
                    }
                });
                
                db.run(`ALTER TABLE movement_orders ADD COLUMN warp_phase TEXT`, (err) => {
                    if (err && !err.message.includes('duplicate column')) {
                        console.error('Migration error (warp_phase):', err);
                    }
                });
                
                db.run(`ALTER TABLE movement_orders ADD COLUMN warp_preparation_turns INTEGER DEFAULT 0`, (err) => {
                    if (err && !err.message.includes('duplicate column')) {
                        console.error('Migration error (warp_preparation_turns):', err);
                    }
                });
                
                db.run(`ALTER TABLE movement_orders ADD COLUMN warp_destination_x INTEGER`, (err) => {
                    if (err && !err.message.includes('duplicate column')) {
                        console.error('Migration error (warp_destination_x):', err);
                    }
                });
                
                db.run(`ALTER TABLE movement_orders ADD COLUMN warp_destination_y INTEGER`, (err) => {
                    if (err && !err.message.includes('duplicate column')) {
                        console.error('Migration error (warp_destination_y):', err);
                    }
                    resolve();
                });
            });
        });
        
        console.log('🎮 Database initialization and migrations complete!');
        dbReadyResolve();
        
    } catch (error) {
        console.error('❌ Database initialization failed:', error);
        dbReadyResolve(); // Resolve anyway to avoid hanging; server should still handle errors gracefully
    }
};

initializeDatabase();

db.ready = dbReady;

module.exports = db; 