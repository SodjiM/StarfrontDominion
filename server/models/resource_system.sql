-- Resource Gathering System - Comprehensive Database Schema
-- Universal system for harvesting rocks, gas, energy, salvage, and future resources

-- Resource Types Registry - Defines all harvestable resources
CREATE TABLE IF NOT EXISTS resource_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    resource_key TEXT UNIQUE,
    resource_name TEXT UNIQUE NOT NULL, -- 'rock', 'gas', 'energy', 'salvage'
    category TEXT NOT NULL, -- 'solid', 'gas', 'energy', 'technology'
    base_size INTEGER DEFAULT 1, -- How much cargo space 1 unit takes
    base_value INTEGER DEFAULT 1, -- Economic value
    stackable BOOLEAN DEFAULT TRUE,
    description TEXT,
    icon_emoji TEXT DEFAULT '📦', -- Visual representation
    color_hex TEXT DEFAULT '#888888', -- UI color
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Harvestable Resource Nodes - Individual resource deposits in the world
CREATE TABLE IF NOT EXISTS resource_nodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sector_id INTEGER NOT NULL,
    parent_object_id INTEGER, -- Belt, nebula, star, derelict etc. (can be NULL for standalone)
    resource_type_id INTEGER NOT NULL,
    x INTEGER NOT NULL,
    y INTEGER NOT NULL,
    size INTEGER DEFAULT 1, -- 1x1, 2x2, 3x3 footprint for collision
    resource_amount INTEGER NOT NULL, -- Current harvestable amount
    max_resource INTEGER NOT NULL, -- Original amount (for regeneration)
    harvest_difficulty REAL DEFAULT 1.0, -- Mining speed modifier (0.5 = slower, 2.0 = faster)
    is_depleted BOOLEAN DEFAULT FALSE,
    respawn_turns INTEGER DEFAULT NULL, -- NULL = permanent, >0 = respawns after N turns
    meta TEXT, -- JSON for additional properties
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (sector_id) REFERENCES sectors(id),
    FOREIGN KEY (parent_object_id) REFERENCES sector_objects(id),
    FOREIGN KEY (resource_type_id) REFERENCES resource_types(id)
);

-- Ship Cargo System - What each ship is carrying
CREATE TABLE IF NOT EXISTS ship_cargo (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ship_id INTEGER NOT NULL,
    resource_type_id INTEGER NOT NULL,
    quantity INTEGER DEFAULT 0,
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (ship_id) REFERENCES sector_objects(id),
    FOREIGN KEY (resource_type_id) REFERENCES resource_types(id),
    UNIQUE(ship_id, resource_type_id)
);

-- Object Cargo System - Universal cargo system for ships, structures, etc.
-- This extends the ship_cargo table to support all object types
CREATE TABLE IF NOT EXISTS object_cargo (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    object_id INTEGER NOT NULL,
    resource_type_id INTEGER NOT NULL,
    quantity INTEGER DEFAULT 0,
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (object_id) REFERENCES sector_objects(id),
    FOREIGN KEY (resource_type_id) REFERENCES resource_types(id),
    UNIQUE(object_id, resource_type_id)
);

-- Active Harvesting Tasks - Ships currently harvesting resources
CREATE TABLE IF NOT EXISTS harvesting_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ship_id INTEGER NOT NULL,
    resource_node_id INTEGER NOT NULL,
    started_turn INTEGER NOT NULL,
    harvest_rate REAL DEFAULT 1.0, -- Resources per turn (base rate * modifiers)
    status TEXT DEFAULT 'active', -- 'active', 'cancelled', 'paused', 'completed'
    total_harvested INTEGER DEFAULT 0, -- Track total gathered
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (ship_id) REFERENCES sector_objects(id),
    FOREIGN KEY (resource_node_id) REFERENCES resource_nodes(id),
    UNIQUE(ship_id) -- One ship can only have one active harvesting task
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_resource_nodes_sector ON resource_nodes(sector_id, x, y);
CREATE INDEX IF NOT EXISTS idx_resource_nodes_parent ON resource_nodes(parent_object_id);
CREATE INDEX IF NOT EXISTS idx_resource_nodes_type ON resource_nodes(resource_type_id);
CREATE INDEX IF NOT EXISTS idx_ship_cargo_ship ON ship_cargo(ship_id);
CREATE INDEX IF NOT EXISTS idx_object_cargo_object ON object_cargo(object_id);
CREATE INDEX IF NOT EXISTS idx_harvesting_tasks_ship ON harvesting_tasks(ship_id, status);
CREATE INDEX IF NOT EXISTS idx_harvesting_tasks_node ON harvesting_tasks(resource_node_id);

-- Insert initial resource types using UPSERT (avoid REPLACE which deletes parent rows)
INSERT INTO resource_types (resource_key, resource_name, category, base_size, base_value, description, icon_emoji, color_hex) VALUES
('rock', 'rock', 'solid', 1, 1, 'Common asteroid material used for construction', '🪨', '#8B4513'),
('gas', 'gas', 'gas', 2, 2, 'Nebula gas used for fuel and advanced manufacturing', '💨', '#9370DB'),
('energy', 'energy', 'energy', 1, 3, 'Concentrated energy harvested from stellar sources', '⚡', '#FFD700'),
('salvage', 'salvage', 'technology', 3, 5, 'Recovered technology and components from derelicts', '🔧', '#FF6347'),
-- Core minerals (universally required)
('ferrite-alloy', 'Ferrite Alloy', 'mineral', 1, 5, 'Primary hull metal for frames, armor, and ship plating. Universal bottleneck for shipbuilding.', '🔩', '#6E6E6E'),
('crytite', 'Crytite', 'mineral', 1, 6, 'Energy storage crystal for reactors and weapon capacitors. Vital to all ships.', '🔷', '#7FD4FF'),
('ardanium', 'Ardanium', 'mineral', 1, 6, 'Structural reinforcement alloy to prevent FTL hull stress.', '🟢', '#2E8B57'),
('vornite', 'Vornite', 'mineral', 1, 5, 'Electronic-grade conductor for navigation and targeting systems.', '🔌', '#CD7F32'),
('zerothium', 'Zerothium', 'mineral', 1, 7, 'Warp stabilizer material for long-range drives.', '⚫', '#000000'),
-- Specialized minerals (role-specific)
('spectrathene', 'Spectrathene', 'mineral', 1, 9, 'Core stealth material for cloaks and sensor dampening.', '🔮', '#6A5ACD'),
('auralite', 'Auralite', 'mineral', 1, 8, 'Precision sensor and targeting enhancement crystal.', '🔆', '#FFF4B1'),
('gravium', 'Gravium', 'mineral', 2, 8, 'Heavy element for gravity-based weapons and tractor systems.', '🕳️', '#2E2E2E'),
('fluxium', 'Fluxium', 'mineral', 1, 8, 'Agile FTL tuning crystal, used for speed boosts and interceptors.', '🌀', '#4FD1C4'),
('corvexite', 'Corvexite', 'mineral', 1, 9, 'Plasma and hull-piercing munitions core.', '💥', '#DC143C'),
('voidglass', 'Voidglass', 'mineral', 1, 10, 'Elite stealth hull coating material.', '🌑', '#0B0B0B'),
('heliox-ore', 'Heliox Ore', 'mineral', 1, 6, 'Life support and colony atmosphere material.', '💨', '#A0C4FF'),
('neurogel', 'Neurogel', 'mineral', 1, 10, 'Neural interface substrate for AI cores and drone control.', '🧠', '#4FC3F7'),
('phasegold', 'Phasegold', 'mineral', 1, 10, 'Teleportation and phase-cloak resonator metal.', '🟡', '#FFD700'),
('kryon-dust', 'Kryon Dust', 'mineral', 1, 7, 'Cryogenic stasis and missile cooling agent.', '❄️', '#E0FFFF'),
('riftstone', 'Riftstone', 'mineral', 1, 9, 'Wormhole and dimensional stability crystal.', '🟣', '#6A0DAD'),
('solarite', 'Solarite', 'mineral', 1, 9, 'High-energy fuel for lasers and energy stations.', '☀️', '#FF8C00'),
('mythrion', 'Mythrion', 'mineral', 1, 8, 'Ultra-light structural alloy for high-speed ships.', '⚪', '#CFD8DC'),
('drakonium', 'Drakonium', 'mineral', 1, 9, 'Plasma weapon core and heavy artillery material.', '🐉', '#8B0000'),
('aetherium', 'Aetherium', 'mineral', 1, 10, 'Long-range communication and command relay crystal.', '📡', '#FFFFFF'),
('tachytrium', 'Tachytrium', 'mineral', 1, 10, 'FTL overdrive mineral for extreme speed.', '⚡', '#A0A0FF'),
('oblivium', 'Oblivium', 'mineral', 1, 9, 'Energy-absorption armor plating material.', '⬛', '#111111'),
('luminite', 'Luminite', 'mineral', 1, 10, 'High-efficiency shield generator crystal.', '💎', '#FFFFFF'),
('cryphos', 'Cryphos', 'mineral', 1, 8, 'Electromagnetic weapon capacitor mineral.', '⚡', '#87CEEB'),
('pyronex', 'Pyronex', 'mineral', 1, 9, 'Thermal lance and heat-based weapon core.', '🔥', '#FF4500'),
('nebryllium', 'Nebryllium', 'mineral', 1, 8, 'Sensor jamming and false signal generation mineral.', '🌫️', '#B0C4DE'),
('magnetrine', 'Magnetrine', 'mineral', 2, 7, 'Magnetic railgun and tractor system component.', '🧲', '#808080'),
('quarzon', 'Quarzon', 'mineral', 1, 8, 'Multi-spectrum targeting and optics material.', '🔷', '#B19CD9'),
('starforged-carbon', 'Starforged Carbon', 'mineral', 2, 9, 'Dense armor plating material for capitals.', '🛡️', '#1C1C1C'),
('aurivex', 'Aurivex', 'mineral', 1, 11, 'Prestige alloy for elite diplomatic ships.', '🏅', '#FFD700')
ON CONFLICT(resource_name) DO UPDATE SET
  resource_key = excluded.resource_key,
  category = excluded.category,
  base_size = excluded.base_size,
  base_value = excluded.base_value,
  description = excluded.description,
  icon_emoji = excluded.icon_emoji,
  color_hex = excluded.color_hex;
