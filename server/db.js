const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

const db = new sqlite3.Database('./database.sqlite');

// Initialize tables sequentially to avoid issues
const initializeDatabase = async () => {
    try {
        const usersSchema = fs.readFileSync(path.join(__dirname, 'models/users.sql'), 'utf8');
        const gamesSchema = fs.readFileSync(path.join(__dirname, 'models/games.sql'), 'utf8');
        const gameworldSchema = fs.readFileSync(path.join(__dirname, 'models/gameworld.sql'), 'utf8');
        const celestialSchema = fs.readFileSync(path.join(__dirname, 'models/celestial_objects.sql'), 'utf8');
        
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

        // Apply celestial objects schema extensions
        await new Promise((resolve, reject) => {
            db.exec(celestialSchema, (err) => {
                if (err) {
                    console.error('Error applying celestial objects schema:', err);
                    console.error('Schema content:', celestialSchema.substring(0, 200) + '...');
                    reject(err);
                } else {
                    console.log('✅ Celestial objects schema applied');
                    resolve();
                }
            });
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
                resolve();
            });
        });
        
        console.log('🎮 Database initialization and migrations complete!');
        
    } catch (error) {
        console.error('❌ Database initialization failed:', error);
    }
};

initializeDatabase();

module.exports = db; 