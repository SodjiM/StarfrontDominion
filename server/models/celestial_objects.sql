-- Celestial Objects System - Phase 1 Extensions
-- Extends the existing gameworld schema to support procedural generation

-- Add celestial object support columns to existing sector_objects table
ALTER TABLE sector_objects ADD COLUMN radius INTEGER DEFAULT 1;
ALTER TABLE sector_objects ADD COLUMN celestial_type TEXT DEFAULT NULL; -- 'star', 'planet', 'moon', 'belt', 'nebula', 'wormhole', 'derelict'
ALTER TABLE sector_objects ADD COLUMN parent_object_id INTEGER DEFAULT NULL; -- For moons orbiting planets, stations in orbit, etc.

-- Add procedural generation tracking to sectors
ALTER TABLE sectors ADD COLUMN generation_seed INTEGER DEFAULT NULL;
ALTER TABLE sectors ADD COLUMN generation_completed BOOLEAN DEFAULT FALSE;
ALTER TABLE sectors ADD COLUMN celestial_objects_count INTEGER DEFAULT 0; -- Cache for performance

-- Create index for celestial object queries (parent-child relationships)
CREATE INDEX IF NOT EXISTS idx_sector_objects_parent ON sector_objects(parent_object_id);

-- Create index for celestial object type queries
CREATE INDEX IF NOT EXISTS idx_sector_objects_celestial ON sector_objects(sector_id, celestial_type);

-- Create index for radius-based spatial queries (for collision detection)
CREATE INDEX IF NOT EXISTS idx_sector_objects_radius ON sector_objects(sector_id, x, y, radius);

-- Add foreign key constraint for parent objects
-- Note: SQLite doesn't support adding foreign key constraints to existing tables,
-- so we'll handle this constraint in application logic

-- Create celestial object templates table for generation rules
CREATE TABLE IF NOT EXISTS celestial_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    celestial_type TEXT NOT NULL,
    archetype TEXT, -- 'resource-rich', 'asteroid-heavy', 'nebula', 'binary-star', or NULL for all
    min_radius INTEGER NOT NULL,
    max_radius INTEGER NOT NULL,
    min_count INTEGER DEFAULT 0,
    max_count INTEGER DEFAULT 1,
    placement_zone TEXT DEFAULT 'any', -- 'center', 'inner', 'mid', 'outer', 'any'
    placement_priority INTEGER DEFAULT 50, -- Higher = placed first
    buffer_distance INTEGER DEFAULT 150, -- Minimum distance from other major objects
    meta_template TEXT, -- JSON template for object properties
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Insert default celestial object templates
INSERT OR REPLACE INTO celestial_templates (celestial_type, archetype, min_radius, max_radius, min_count, max_count, placement_zone, placement_priority, buffer_distance, meta_template) VALUES
-- Stars (highest priority, placed first)
('star', NULL, 20, 40, 1, 1, 'center', 100, 500, '{"name": "Primary Star", "temperature": 5778, "luminosity": 1.0, "alwaysKnown": true, "scannable": true}'),
('star', 'binary-star', 15, 30, 2, 2, 'center', 100, 300, '{"name": "Binary Star", "temperature": 5500, "luminosity": 0.8, "alwaysKnown": true, "scannable": true}'),

-- Planets (high priority, orbital placement)
('planet', NULL, 10, 25, 4, 8, 'mid', 90, 150, '{"name": "Planet", "type": "terrestrial", "atmosphere": "standard", "habitability": 0.5, "alwaysKnown": true, "scannable": true, "landable": true}'),
('planet', 'resource-rich', 12, 25, 5, 8, 'mid', 90, 150, '{"name": "Rich Planet", "type": "resource-rich", "atmosphere": "standard", "habitability": 0.7, "resources": 1.5, "alwaysKnown": true, "scannable": true, "landable": true}'),

-- Moons (medium priority, attached to planets)
('moon', NULL, 3, 8, 0, 3, 'any', 70, 50, '{"name": "Moon", "type": "rocky", "atmosphere": "none", "habitability": 0.1, "alwaysKnown": true, "scannable": true, "landable": true}'),

-- Asteroid Belts (medium priority, between orbits)
('belt', NULL, 300, 800, 1, 3, 'mid', 60, 200, '{"name": "Asteroid Belt", "density": "medium", "mineral_content": 1.2, "navigable": true, "alwaysKnown": true, "scannable": true}'),
('belt', 'asteroid-heavy', 400, 1000, 2, 4, 'mid', 60, 200, '{"name": "Dense Asteroid Field", "density": "high", "mineral_content": 1.8, "navigable": true, "alwaysKnown": true, "scannable": true}'),

-- Nebulae (medium priority, outer zones)
('nebula', NULL, 500, 1200, 1, 2, 'outer', 50, 300, '{"name": "Nebula Cloud", "type": "emission", "density": "medium", "scan_interference": 0.3, "stealth_bonus": 0.2, "alwaysKnown": true, "scannable": true}'),
('nebula', 'nebula', 600, 1500, 2, 3, 'outer', 50, 300, '{"name": "Dense Nebula", "type": "dark", "density": "high", "scan_interference": 0.5, "stealth_bonus": 0.4, "alwaysKnown": true, "scannable": true}'),

-- Wormholes (low priority, edge placement)
('wormhole', NULL, 5, 10, 1, 2, 'outer', 30, 100, '{"name": "Wormhole", "type": "stable", "destination": null, "energy_cost": 10, "alwaysKnown": false, "scannable": true, "usable": true}'),

-- Derelict Objects (lowest priority, scattered placement)
('derelict', NULL, 5, 15, 2, 8, 'any', 10, 50, '{"name": "Derelict Structure", "type": "unknown", "condition": "damaged", "scannable": true, "explorable": true, "loot_potential": 0.3}');

-- Create generation history table to track what was generated when
CREATE TABLE IF NOT EXISTS generation_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sector_id INTEGER NOT NULL,
    generation_seed INTEGER NOT NULL,
    celestial_type TEXT NOT NULL,
    object_count INTEGER NOT NULL,
    generation_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    archetype TEXT,
    FOREIGN KEY (sector_id) REFERENCES sectors(id)
);

-- Create index for generation history queries
CREATE INDEX IF NOT EXISTS idx_generation_history_sector ON generation_history(sector_id, generation_time);