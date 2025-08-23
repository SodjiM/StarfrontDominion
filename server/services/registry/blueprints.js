// Ship blueprints registry and requirements calculator

const SHIP_BLUEPRINTS = [
    {
        id: 'explorer',
        name: 'Explorer',
        class: 'frigate',
        role: 'scout',
        scanRange: 50,
        movementSpeed: 4,
        cargoCapacity: 10,
        pilotCost: 1,
        canActiveScan: false,
        harvestRate: 1.0,
        abilities: ['dual_light_coilguns','boost_engines','jury_rig_repair','survey_scanner','duct_tape_resilience'],
        requirements: {
            core: { 'Ferrite Alloy': 30, 'Crytite': 20, 'Vornite': 10 },
            specialized: { Fluxium: 10, Auralite: 6 }
        }
    },
    {
        id: 'needle-gunship',
        name: 'Needler Gunship',
        class: 'frigate',
        role: 'brawler',
        scanRange: 40,
        movementSpeed: 3,
        cargoCapacity: 6,
        pilotCost: 1,
        canActiveScan: false,
        harvestRate: 0,
        abilities: ['dual_light_coilguns', 'strike_vector'],
        requirements: {
            core: { 'Ferrite Alloy': 36, 'Crytite': 18, 'Vornite': 12 },
            specialized: { Corvexite: 12, Magnetrine: 8 }
        }
    },
    {
        id: 'drill-skiff',
        name: 'Drill Skiff',
        class: 'frigate',
        role: 'miner',
        scanRange: 35,
        movementSpeed: 3,
        cargoCapacity: 20,
        pilotCost: 1,
        canActiveScan: false,
        harvestRate: 2.0,
        abilities: ['survey_scanner','duct_tape_resilience'],
        requirements: {
            core: { 'Ferrite Alloy': 28, 'Crytite': 16, 'Vornite': 8 },
            specialized: { Gravium: 10, Solarite: 6 }
        }
    },
    {
        id: 'swift-courier',
        name: 'Swift Courier',
        class: 'frigate',
        role: 'courier',
        scanRange: 45,
        movementSpeed: 6,
        cargoCapacity: 8,
        pilotCost: 1,
        canActiveScan: false,
        harvestRate: 0,
        abilities: ['boost_engines','microthruster_shift'],
        requirements: {
            core: { 'Ferrite Alloy': 24, 'Crytite': 20, 'Vornite': 8 },
            specialized: { Fluxium: 12, Auralite: 4 }
        }
    }
];

function computeAllRequirements(blueprint) {
    return blueprint && blueprint.requirements ? blueprint.requirements : { core: {}, specialized: {} };
}

module.exports = { SHIP_BLUEPRINTS, computeAllRequirements };

