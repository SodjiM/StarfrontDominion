-- Resource Gathering System - Comprehensive Database Schema
-- Universal system for harvesting rocks, gas, energy, salvage, and future resources

-- Resource Types Registry - Defines all harvestable resources
CREATE TABLE IF NOT EXISTS resource_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
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
CREATE INDEX IF NOT EXISTS idx_harvesting_tasks_ship ON harvesting_tasks(ship_id, status);
CREATE INDEX IF NOT EXISTS idx_harvesting_tasks_node ON harvesting_tasks(resource_node_id);

-- Insert initial resource types using UPSERT (avoid REPLACE which deletes parent rows)
INSERT INTO resource_types (resource_name, category, base_size, base_value, description, icon_emoji, color_hex) VALUES
('rock', 'solid', 1, 1, 'Common asteroid material used for construction', '🪨', '#8B4513'),
('gas', 'gas', 2, 2, 'Nebula gas used for fuel and advanced manufacturing', '💨', '#9370DB'),
('energy', 'energy', 1, 3, 'Concentrated energy harvested from stellar sources', '⚡', '#FFD700'),
('salvage', 'technology', 3, 5, 'Recovered technology and components from derelicts', '🔧', '#FF6347')
ON CONFLICT(resource_name) DO UPDATE SET
  category = excluded.category,
  base_size = excluded.base_size,
  base_value = excluded.base_value,
  description = excluded.description,
  icon_emoji = excluded.icon_emoji,
  color_hex = excluded.color_hex;