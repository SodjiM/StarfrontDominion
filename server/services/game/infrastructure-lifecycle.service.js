const defaultDb = require('../../db');
const { parseMeta, isObjectOperational } = require('../../domain/infrastructure');
const { RegionInfrastructureService } = require('../world/region-infrastructure.service');
const { withSavepoint } = require('./savepoint');

class InfrastructureLifecycleService {
    constructor(database = defaultDb) { this.db = database; }

    get(sql, params = []) {
        return new Promise((resolve, reject) => this.db.get(sql, params, (error, row) => error ? reject(error) : resolve(row || null)));
    }

    all(sql, params = []) {
        return new Promise((resolve, reject) => this.db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows || [])));
    }

    run(sql, params = []) {
        return new Promise((resolve, reject) => this.db.run(sql, params, function(error) {
            if (error) reject(error);
            else resolve({ changes: this.changes, lastID: this.lastID });
        }));
    }

    canonicalSectors(firstSectorId, secondSectorId) {
        const first = Number(firstSectorId);
        const second = Number(secondSectorId);
        return first < second ? [first, second] : [second, first];
    }

    async createGateReservation({ pairId, gameId, originSectorId, destinationSectorId }) {
        const [sectorAId, sectorBId] = this.canonicalSectors(originSectorId, destinationSectorId);
        try {
            await this.run(
                `INSERT INTO interstellar_gate_pairs
                 (pair_id,game_id,sector_a_id,sector_b_id,status,slots_reserved)
                 VALUES(?,?,?,?,'reserving',0)`,
                [pairId, gameId, sectorAId, sectorBId]
            );
            return { ok: true, sectorAId, sectorBId };
        } catch (error) {
            if (error?.code === 'SQLITE_CONSTRAINT') return { ok: false, error: 'connection_already_exists' };
            throw error;
        }
    }

    async reserveGateSlot(sectorId) {
        const result = await this.run(
            `UPDATE sectors
             SET gates_used = COALESCE(gates_used,0) + 1
             WHERE id = ?
               AND COALESCE(gates_used,0) < COALESCE(gate_slots,3)`,
            [sectorId]
        );
        return result.changes === 1;
    }

    async reserveGatePairSlots(pairId, sectorAId, sectorBId) {
        if (!await this.reserveGateSlot(sectorAId)) return { ok: false, error: 'origin_gate_slots_full', sectorId: sectorAId };
        if (!await this.reserveGateSlot(sectorBId)) return { ok: false, error: 'dest_gate_slots_full', sectorId: sectorBId };
        const marked = await this.run(
            `UPDATE interstellar_gate_pairs
             SET slots_reserved=1,updated_at=CURRENT_TIMESTAMP
             WHERE pair_id=? AND slots_reserved=0 AND status IN ('reserving','disabled')`,
            [pairId]
        );
        if (marked.changes !== 1) return { ok: false, error: 'gate_pair_reservation_conflict' };
        return { ok: true };
    }

    async finalizeGatePair(pairId, { sectorAId, gateAObjectId, gateBObjectId }) {
        const pair = await this.get('SELECT sector_a_id FROM interstellar_gate_pairs WHERE pair_id=?', [pairId]);
        if (!pair) throw new Error('gate_pair_reservation_missing');
        const firstIsA = Number(sectorAId) === Number(pair.sector_a_id);
        await this.run(
            `UPDATE interstellar_gate_pairs
             SET gate_a_object_id=?,gate_b_object_id=?,status='operational',updated_at=CURRENT_TIMESTAMP
             WHERE pair_id=? AND slots_reserved=1`,
            firstIsA ? [gateAObjectId, gateBObjectId, pairId] : [gateBObjectId, gateAObjectId, pairId]
        );
    }

    async releaseGateSlot(sectorId) {
        await this.run(
            `UPDATE sectors SET gates_used=MAX(COALESCE(gates_used,0)-1,0)
             WHERE id=?`,
            [sectorId]
        );
    }

    async _setObjectState(object, state, reason = null) {
        const meta = parseMeta(object.meta);
        if (state === 'operational') {
            delete meta.disabled;
            delete meta.destroyed;
            delete meta.disabledReason;
            meta.operational = true;
            meta.status = 'operational';
        } else {
            meta.operational = false;
            meta.status = state;
            if (state === 'disabled') meta.disabled = true;
            if (state === 'destroyed') meta.destroyed = true;
            if (reason) meta.disabledReason = reason;
        }
        await this.run('UPDATE sector_objects SET meta=?,updated_at=CURRENT_TIMESTAMP WHERE id=?', [JSON.stringify(meta), object.id]);
    }

    async deactivateGatePairForObject(objectId, reason = 'paired_endpoint_non_operational') {
        const object = await this.get('SELECT id,sector_id,type,meta FROM sector_objects WHERE id=?', [objectId]);
        if (!object) return { ok: false, error: 'object_not_found' };
        const meta = parseMeta(object.meta);
        if (object.type !== 'interstellar-gate' && meta.structureType !== 'interstellar-gate') return { ok: true, affected: [] };
        const pairId = meta.gatePairId;
        if (!pairId) return { ok: true, affected: [object.id], legacyUnpaired: true };

        const pair = await this.get('SELECT * FROM interstellar_gate_pairs WHERE pair_id=?', [pairId]);
        let endpoints;
        if (pair) {
            const claimed = await this.run(
                `UPDATE interstellar_gate_pairs
                 SET status='disabled',slots_reserved=0,disabled_reason=?,updated_at=CURRENT_TIMESTAMP
                 WHERE pair_id=? AND slots_reserved=1`,
                [reason, pairId]
            );
            if (claimed.changes === 1) {
                await this.releaseGateSlot(pair.sector_a_id);
                await this.releaseGateSlot(pair.sector_b_id);
            }
            endpoints = await this.all(
                `SELECT id,sector_id,type,meta FROM sector_objects
                 WHERE id IN (?,?)`,
                [pair.gate_a_object_id, pair.gate_b_object_id]
            );
        } else {
            endpoints = await this.all(
                `SELECT id,sector_id,type,meta FROM sector_objects
                 WHERE type='interstellar-gate' AND json_extract(meta,'$.gatePairId')=?`,
                [pairId]
            );
            const activeSectors = [...new Set(endpoints.filter(isObjectOperational).map((endpoint) => Number(endpoint.sector_id)))];
            for (const sectorId of activeSectors) await this.releaseGateSlot(sectorId);
        }

        for (const endpoint of endpoints) {
            if (Number(endpoint.id) !== Number(objectId) && isObjectOperational(endpoint)) await this._setObjectState(endpoint, 'disabled', reason);
        }
        return { ok: true, affected: endpoints.map((endpoint) => endpoint.id), pairId };
    }

    markDestroyed(objectId, reason = 'destroyed') { return withSavepoint(this.db, () => this._markDestroyed(objectId, reason)); }
    async _markDestroyed(objectId, reason = 'destroyed') {
        const object = await this.get('SELECT id,sector_id,type,meta FROM sector_objects WHERE id=?', [objectId]);
        if (!object) return { ok: false, error: 'object_not_found' };
        await this.deactivateGatePairForObject(objectId, reason);
        await this._setObjectState(object, 'destroyed', reason);
        return { ok: true };
    }

    disableObject(objectId, reason = 'disabled') { return withSavepoint(this.db, () => this._disableObject(objectId, reason)); }
    async _disableObject(objectId, reason = 'disabled') {
        const object = await this.get('SELECT id,sector_id,type,meta FROM sector_objects WHERE id=?', [objectId]);
        if (!object) return { ok: false, error: 'object_not_found' };
        await this.deactivateGatePairForObject(objectId, reason);
        await this._setObjectState(object, 'disabled', reason);
        return { ok: true };
    }

    repairObject(objectId) { return withSavepoint(this.db, () => this._repairObject(objectId)); }
    async _repairObject(objectId) {
        const object = await this.get('SELECT id,sector_id,type,x,y,meta FROM sector_objects WHERE id=?', [objectId]);
        if (!object) return { ok: false, error: 'object_not_found' };
        const meta = parseMeta(object.meta);
        if (object.type === 'wreck' || meta.destroyed === true || Number(meta.hp) <= 0) return { ok: false, error: 'destroyed_object_requires_reconstruction' };
        if (object.type !== 'interstellar-gate' && meta.structureType !== 'interstellar-gate') {
            await this._setObjectState(object, 'operational');
            return { ok: true };
        }
        const pair = await this.get('SELECT * FROM interstellar_gate_pairs WHERE pair_id=?', [meta.gatePairId]);
        if (!pair || pair.slots_reserved) return { ok: false, error: pair ? 'gate_pair_already_operational' : 'gate_pair_not_registered' };
        const endpoints = await this.all('SELECT id,sector_id,type,x,y,meta FROM sector_objects WHERE id IN (?,?)', [pair.gate_a_object_id, pair.gate_b_object_id]);
        if (endpoints.length !== 2 || endpoints.some((endpoint) => endpoint.type !== 'interstellar-gate' || Number(parseMeta(endpoint.meta).hp) <= 0)) {
            return { ok: false, error: 'gate_pair_requires_reconstruction' };
        }
        const capacity = await new RegionInfrastructureService(this.db).checkPlacements(endpoints.map((endpoint) => ({
            sectorId: endpoint.sector_id, x: endpoint.x, y: endpoint.y, infrastructureKey: 'interstellar-gate'
        })));
        if (!capacity.ok) return capacity;
        const slots = await this.reserveGatePairSlots(pair.pair_id, pair.sector_a_id, pair.sector_b_id);
        if (!slots.ok) return slots;
        for (const endpoint of endpoints) await this._setObjectState(endpoint, 'operational');
        await this.run("UPDATE interstellar_gate_pairs SET status='operational',disabled_reason=NULL WHERE pair_id=?", [pair.pair_id]);
        return { ok: true };
    }

    removeObject(objectId, reason = 'removed') { return withSavepoint(this.db, () => this._removeObject(objectId, reason)); }
    async _removeObject(objectId, reason = 'removed') {
        const object = await this.get('SELECT id,type,meta FROM sector_objects WHERE id=?', [objectId]);
        if (!object) return { ok: false, error: 'object_not_found' };
        await this.deactivateGatePairForObject(objectId, reason);
        const meta = parseMeta(object.meta);
        const pair = meta.gatePairId ? await this.get('SELECT * FROM interstellar_gate_pairs WHERE pair_id=?', [meta.gatePairId]) : null;
        const objectIds = pair ? [pair.gate_a_object_id, pair.gate_b_object_id].filter(Boolean) : [objectId];
        for (const id of objectIds) {
            await this.run('DELETE FROM object_cargo WHERE object_id=?', [id]);
            await this.run('DELETE FROM sector_objects WHERE id=?', [id]);
        }
        if (pair) await this.run('DELETE FROM interstellar_gate_pairs WHERE pair_id=?', [pair.pair_id]);
        return { ok: true };
    }
}

module.exports = { InfrastructureLifecycleService };
