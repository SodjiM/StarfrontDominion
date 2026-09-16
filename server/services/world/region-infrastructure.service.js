const defaultDb = require('../../db');
const { INFRASTRUCTURE_CATALOG_VERSION, infrastructureDefinitionForObject, infrastructureDefinitionForKey } = require('../../domain/infrastructure');
const { regionAt, parseCells } = require('./region-geometry');

const STATUS_VERSION = 2;
const DEFAULT_REGION_CAPACITY = 30;

function pressureFor(load, capacity) {
    const safeLoad = Math.max(0, Number(load) || 0);
    const safeCapacity = Math.max(1, Number(capacity) || DEFAULT_REGION_CAPACITY);
    const utilization = safeLoad / safeCapacity;
    const pressureScore = Math.round(utilization * utilization * 1000) / 10;
    let pressureBand = 'idle';
    if (utilization > 1) pressureBand = 'overloaded';
    else if (utilization === 1) pressureBand = 'saturated';
    else if (utilization > 0.7) pressureBand = 'high';
    else if (utilization > 0.4) pressureBand = 'moderate';
    else if (utilization > 0) pressureBand = 'low';
    return {
        capacity: safeCapacity,
        load: safeLoad,
        remaining: Math.max(0, safeCapacity - safeLoad),
        overage: Math.max(0, safeLoad - safeCapacity),
        utilization: Math.round(utilization * 1000) / 1000,
        pressureScore,
        pressureBand,
        atCapacity: safeLoad >= safeCapacity,
        overCapacity: safeLoad > safeCapacity
    };
}

class RegionInfrastructureService {
    constructor(database = defaultDb) { this.db = database; }

    all(sql, params = []) {
        return new Promise((resolve, reject) => this.db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows || [])));
    }

    async getSectorStatus(sectorId, { includeContributors = false, viewerUserId = null, visibilityMap = null } = {}) {
        const sectorRows = await this.all('SELECT width, height FROM sectors WHERE id = ?', [sectorId]);
        const dimensions = {
            width: Number(sectorRows[0]?.width) || 5000,
            height: Number(sectorRows[0]?.height) || 5000
        };
        const regions = await this.all(
            'SELECT region_id, cells_json, health FROM regions WHERE sector_id = ? ORDER BY region_id',
            [sectorId]
        );
        const overrides = await this.all(
            'SELECT region_id, capacity FROM region_capacity_overrides WHERE sector_id = ?',
            [sectorId]
        );
        const objects = await this.all(
            'SELECT id, type, x, y, owner_id, meta FROM sector_objects WHERE sector_id = ?',
            [sectorId]
        );
        const capacityByRegion = new Map(overrides.map((row) => [String(row.region_id), Number(row.capacity)]));
        const contributorsByRegion = new Map(regions.map((region) => [String(region.region_id), []]));
        const unassignedContributors = [];

        for (const object of objects) {
            const definition = infrastructureDefinitionForObject(object);
            if (!definition) continue;
            const contributor = {
                objectId: object.id,
                ownerId: object.owner_id ?? null,
                type: object.type,
                infrastructureKey: definition.key,
                infrastructureClass: definition.class,
                label: definition.label,
                load: definition.load,
                x: Number(object.x),
                y: Number(object.y)
            };
            const regionId = regionAt(object.x, object.y, regions, dimensions);
            if (regionId && contributorsByRegion.has(regionId)) contributorsByRegion.get(regionId).push(contributor);
            else unassignedContributors.push(contributor);
        }

        const statuses = regions.map((region) => {
            const regionId = String(region.region_id);
            const contributors = contributorsByRegion.get(regionId) || [];
            const load = contributors.reduce((sum, item) => sum + item.load, 0);
            const pressure = pressureFor(load, capacityByRegion.get(regionId) || DEFAULT_REGION_CAPACITY);
            const status = {
                id: regionId,
                health: Number(region.health),
                cells: parseCells(region.cells_json),
                ...pressure,
                objectCount: contributors.length,
                ...(includeContributors ? { contributors } : {})
            };
            if (viewerUserId != null) {
                const viewerId = Number(viewerUserId);
                let ownLoad = 0;
                let visibleHostileLoad = 0;
                for (const contributor of contributors) {
                    if (Number(contributor.ownerId) === viewerId) ownLoad += contributor.load;
                    else if (visibilityMap?.get(contributor.objectId)?.level > 0) visibleHostileLoad += contributor.load;
                }
                // Concealed infrastructure is deliberately undisclosed. A
                // constant null does not reveal whether hidden contributors
                // exist or allow their exact load to be inferred here.
                status.viewer = { ownLoad, visibleHostileLoad };
            }
            return status;
        });

        return {
            version: STATUS_VERSION,
            catalogVersion: INFRASTRUCTURE_CATALOG_VERSION,
            sectorId: Number(sectorId),
            dimensions,
            defaultCapacity: DEFAULT_REGION_CAPACITY,
            regions: statuses,
            unassigned: {
                load: unassignedContributors.reduce((sum, item) => sum + item.load, 0),
                objectCount: unassignedContributors.length,
                ...(includeContributors ? { contributors: unassignedContributors } : {})
            }
        };
    }

    async checkPlacements(placements) {
        const statusBySector = new Map();
        const projectedByRegion = new Map();
        const evaluated = [];

        for (const placement of placements || []) {
            const definition = infrastructureDefinitionForKey(placement.infrastructureKey);
            if (!definition) {
                return { ok: false, error: 'unknown_infrastructure_type', infrastructureKey: placement.infrastructureKey };
            }
            const sectorId = Number(placement.sectorId);
            if (!statusBySector.has(sectorId)) statusBySector.set(sectorId, await this.getSectorStatus(sectorId));
            const status = statusBySector.get(sectorId);
            // Older saves and lightweight test sectors may predate regional
            // generation. Keep them operational until they receive a region
            // migration; any sector with region rows is enforced strictly.
            if (status.regions.length === 0) {
                evaluated.push({ sectorId, infrastructureKey: definition.key, requiredLoad: definition.load, unmanagedLegacySector: true });
                continue;
            }
            const regionId = regionAt(placement.x, placement.y, status.regions, status.dimensions);
            if (!regionId) {
                return { ok: false, error: 'deployment_region_not_found', sectorId, x: placement.x, y: placement.y };
            }
            const region = status.regions.find((candidate) => candidate.id === regionId);
            if (!region) return { ok: false, error: 'deployment_region_not_found', sectorId, regionId };
            const projectionKey = `${sectorId}:${regionId}`;
            const alreadyProjected = projectedByRegion.get(projectionKey) || 0;
            const requiredLoad = definition.load;
            const projectedLoad = region.load + alreadyProjected + requiredLoad;
            const check = {
                sectorId,
                regionId,
                infrastructureKey: definition.key,
                capacity: region.capacity,
                currentLoad: region.load,
                previouslyProjectedLoad: alreadyProjected,
                requiredLoad,
                projectedLoad
            };
            if (projectedLoad > region.capacity) {
                return { ok: false, error: 'regional_capacity_exceeded', ...check };
            }
            projectedByRegion.set(projectionKey, alreadyProjected + requiredLoad);
            evaluated.push(check);
        }
        return { ok: true, placements: evaluated };
    }
}

module.exports = { RegionInfrastructureService, STATUS_VERSION, DEFAULT_REGION_CAPACITY, pressureFor };
