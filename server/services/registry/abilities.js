// Abilities registry (authoritative source)

const Abilities = {
    strike_vector: {
        key: 'strike_vector',
        name: 'Strike Vector',
        type: 'utility',
        target: 'position',
        range: 5,
        cooldown: 3,
        energyCost: 10,
        description: 'Micro-warp to a nearby position.',
        shortDescription: 'Short-hop reposition',
        longDescription: 'Instant micro-warp reposition up to range tiles, landing on a free tile.'
    },

    microthruster_shift: {
        key: 'microthruster_shift',
        name: 'Microthruster Shift',
        type: 'utility',
        target: 'self',
        range: null,
        cooldown: 1,
        energyCost: 5,
        description: 'Brief burst of additional movement.',
        shortDescription: '+Speed this turn'
    },

    emergency_discharge_vent: {
        key: 'emergency_discharge_vent',
        name: 'Emergency Discharge Vent',
        type: 'utility',
        target: 'self',
        range: null,
        cooldown: 3,
        energyCost: 0,
        description: 'Vent cargo to space, creating a cargo can at your location.'
    },

    dual_light_coilguns: {
        key: 'dual_light_coilguns',
        name: 'Dual Light Coilguns',
        type: 'offense',
        target: 'enemy',
        range: null,
        cooldown: 1,
        energyCost: 0
    },

    boost_engines: {
        key: 'boost_engines',
        name: 'Boost Engines',
        type: 'utility',
        target: 'self',
        range: null,
        cooldown: 2,
        energyCost: 5,
        description: 'Engine boost: +100% movement for 5 turns',
        effectKey: 'engine_boost',
        duration: 5,
        movementBonus: 1.0
    },
    jury_rig_repair: {
        key: 'jury_rig_repair',
        name: 'Jury-Rig Repair',
        type: 'utility',
        target: 'self',
        range: null,
        cooldown: 3,
        energyCost: 8
    },
    survey_scanner: {
        key: 'survey_scanner',
        name: 'Survey Scanner',
        type: 'utility',
        target: 'self',
        range: null,
        cooldown: 1,
        energyCost: 2
    },
    duct_tape_resilience: {
        key: 'duct_tape_resilience',
        name: 'Duct Tape Resilience',
        type: 'passive',
        target: 'self',
        range: null,
        cooldown: 0,
        energyCost: 0
    },

    // Mining abilities (toggle via recast). Server uses `mining` block for ramp/drain config.
    rotary_mining_lasers: {
        key: 'rotary_mining_lasers',
        name: 'Rotary Mining Lasers',
        type: 'utility',
        target: 'self',
        range: 2,
        cooldown: 1,
        energyCost: 0,
        description: 'Begin mining a node within range; ramps output and drains energy per turn. Recast to stop.',
        shortDescription: 'Start/stop mining (ramping)',
        mining: {
            baseRate: 2,
            incrementPerTurn: 1,
            maxBonus: 5,
            energyPerTurn: 2
        }
    },

    prospector_microlasers: {
        key: 'prospector_microlasers',
        name: 'Prospector Microlasers',
        type: 'utility',
        target: 'self',
        range: 2,
        cooldown: 1,
        energyCost: 0,
        description: 'Light mining within range; drains minimal energy. Recast to stop.',
        shortDescription: 'Prospect (light mining)',
        mining: {
            baseRate: 1,
            incrementPerTurn: 0,
            maxBonus: 1,
            energyPerTurn: 1
        }
    },

    solo_miners_instinct: {
        key: 'solo_miners_instinct',
        name: "Solo Miner's Instinct",
        type: 'passive',
        target: 'self',
        range: null,
        cooldown: 0,
        energyCost: 0
    }
};

module.exports = { Abilities };

