class LaneGraphService {
	constructor(db) {
		this.db = db;
	}

	async loadSectorLaneContext(sectorId) {
		const db = this.db;
		const edges = await new Promise((resolve)=>db.all(
			`SELECT e.id, e.region_id, e.polyline_json, e.lane_speed, e.width_core, e.cap_base, e.headway
			 FROM lane_edges e WHERE e.sector_id = ?`, [sectorId], (e, rows)=>resolve(rows||[])));
		if (!edges || edges.length === 0) return { edges: [], runtimeByEdge: new Map(), healthByRegion: new Map(), tapsByEdge: new Map() };
		const runtimeByEdge = new Map((await new Promise((resolve)=>db.all(
			`SELECT edge_id, load_cu FROM lane_edges_runtime WHERE edge_id IN (${edges.map(()=>'?').join(',')})`,
			edges.map(r=>r.id), (e, rows)=>resolve(rows||[])
		))).map(r=>[Number(r.edge_id), Number(r.load_cu||0)]));
		const regionHealthRows = await new Promise((resolve)=>db.all(
			`SELECT region_id, health FROM regions WHERE sector_id = ?`, [sectorId], (e, rows)=>resolve(rows||[])));
		const healthByRegion = new Map(regionHealthRows.map(r=>[String(r.region_id), Number(r.health||50)]));
		const tapsByEdge = new Map((await new Promise((resolve)=>db.all(
			`SELECT id, edge_id, x, y FROM lane_taps WHERE edge_id IN (${edges.map(()=>'?').join(',')})`,
			edges.map(r=>r.id), (e, rows)=>resolve(rows||[])
		))).reduce((acc,t)=>{ const arr = acc.get(t.edge_id)||[]; arr.push(t); acc.set(t.edge_id, arr); return acc; }, new Map()));
		return { edges, runtimeByEdge, healthByRegion, tapsByEdge };
	}

	static parseJsonArray(text, fallback=[]) { try { return JSON.parse(text||'[]'); } catch { return fallback; } }
	static distance(a,b) { return Math.hypot(a.x-b.x, a.y-b.y); }
	static cumulativeLengths(points) {
		let d=0; const acc=[0];
		for (let i=1;i<points.length;i++) { d+=Math.hypot(points[i].x-points[i-1].x, points[i].y-points[i-1].y); acc.push(d); }
		return { acc, total:d };
	}
	static projectToSegment(p,a,b){ const apx=p.x-a.x, apy=p.y-a.y; const abx=b.x-a.x, aby=b.y-a.y; const ab2=Math.max(1e-6,abx*abx+aby*aby); const t=Math.max(0, Math.min(1, (apx*abx+apy*aby)/ab2)); return { x:a.x+abx*t, y:a.y+aby*t, t }; }
	static projectToPolyline(p, pts){ let best={d:Infinity, i:0, t:0, point:pts[0]}; for(let i=1;i<pts.length;i++){ const pr=LaneGraphService.projectToSegment(p, pts[i-1], pts[i]); const d=Math.hypot(p.x-pr.x, p.y-pr.y); if(d<best.d){ best={ d, i:i-1, t:pr.t, point:{x:pr.x,y:pr.y} }; } } return best; }
	static sAt(proj, acc){ return acc[proj.i] + proj.t * (acc[proj.i+1]-acc[proj.i]); }

	computeCapacity(edge, regionHealth) {
		const health = regionHealth ?? 50;
		const healthMult = health>=80?1.25:(health>=60?1.0:0.7);
		const coreWidth = Number(edge.width_core);
		const cap = Math.max(1, Math.floor(Number(edge.cap_base) * (coreWidth/150) * healthMult));
		return { cap, health, healthMult };
	}

	computeRhoAndSpeed(edge, loadCU, regionHealth) {
		const { cap } = this.computeCapacity(edge, regionHealth);
		const rho = Number(loadCU || 0) / Math.max(1, cap);
		const speedMult = rho<=1?1:rho<=1.5?0.8:rho<=2?0.6:0.4;
		const v = Math.max(0.001, Number(edge.lane_speed) * speedMult);
		return { rho, speedMult, v };
	}

	async planSingleLegRoutes(sectorId, from, to) {
		const { edges, runtimeByEdge, healthByRegion, tapsByEdge } = await this.loadSectorLaneContext(sectorId);
		if (!edges.length) return [];
		const fromP = { x:Number(from.x), y:Number(from.y) }, toP = { x:Number(to.x), y:Number(to.y) };
		const defaultCu = 1; const slotCapacityCU = 2;
		const routes = [];
		for (const e of edges) {
			const pts = LaneGraphService.parseJsonArray(e.polyline_json);
			if (pts.length < 2) continue;
			const { acc } = LaneGraphService.cumulativeLengths(pts);
			const { rho, speedMult, v } = this.computeRhoAndSpeed(e, runtimeByEdge.get(e.id), healthByRegion.get(String(e.region_id)) ?? 50);
			// Destination projection along the lane
			const destProj = LaneGraphService.projectToPolyline(toP, pts);
			const sDest = LaneGraphService.sAt(destProj, acc);
			const taps = tapsByEdge.get(e.id) || [];
			// Tap entry candidate
			if (taps.length > 0) {
				const nearest = taps.reduce((best, t) => { const d=LaneGraphService.distance(fromP,{x:t.x,y:t.y}); return (!best||d<best.d)?{t,d}:best; }, null);
				if (nearest) {
					const tapProj = LaneGraphService.projectToPolyline({x:nearest.t.x,y:nearest.t.y}, pts);
					const sTap = LaneGraphService.sAt(tapProj, acc);
					const laneDist = Math.abs(sDest - sTap);
					const laneTime = laneDist / Math.max(1, v*200);
					const approachTime = nearest.d / 120;
					const slotsPerTurn = Math.max(0, Math.floor(Number(e.lane_speed) / Math.max(1, Number(e.headway||40))));
					const aheadRow = await new Promise((resolve)=>this.db.get(`SELECT COALESCE(SUM(cu), 0) as cu FROM lane_tap_queue WHERE tap_id = ? AND status = 'queued'`, [nearest.t.id], (er, row)=>resolve(row||{cu:0})));
					const tapQueueEta = slotsPerTurn>0 ? Math.ceil((Number(aheadRow.cu||0) + defaultCu) / (slotsPerTurn * slotCapacityCU)) : 1;
					const eta = Math.ceil(approachTime + tapQueueEta + laneTime + 1);
					routes.push({ edgeId: e.id, entry: 'tap', nearestTapId: nearest.t.id, tapQueueEta, eta, rho, speedMult, risk: (rho>1.5?3:(rho>1?2:1)), sStart: sTap, sEnd: sDest, legs: [{ edgeId: e.id, entry: 'tap', sStart: sTap, sEnd: sDest, tapId: nearest.t.id }] });
				}
			}
			// Wildcat candidate (under light load)
			if (rho < 1.2) {
				const fromProj = LaneGraphService.projectToPolyline(fromP, pts);
				const sFrom = LaneGraphService.sAt(fromProj, acc);
				const laneDist = Math.abs(sDest - sFrom);
				const laneTime = laneDist / Math.max(1, v*200);
				const dMin = fromProj.d; const dMax = 300;
				const base = 1; const k_d = 0.01;
				let mergeTurns = base + k_d * Math.max(0, dMin - Number(e.width_core||0));
				const health = healthByRegion.get(String(e.region_id)) ?? 50;
				if (health>=60) mergeTurns *= 0.8; else if (health<=40) mergeTurns *= 1.25;
				if (rho>1) mergeTurns += Math.max(0.5, (rho-1));
				const mishap = Math.max(0, Math.min(0.4, 0.05 + 0.10*(dMin/dMax) + (rho>1?0.10:0)));
				const approachTime = dMin / 120;
				const eta = Math.ceil(approachTime + mergeTurns + laneTime + 1);
				routes.push({ edgeId: e.id, entry: 'wildcat', mergeTurns: Math.round(Math.max(1, mergeTurns)), mishapChance: mishap, eta, rho, speedMult, risk: (rho>1.5?3:(rho>1?2:2)), sStart: sFrom, sEnd: sDest, legs: [{ edgeId: e.id, entry: 'wildcat', sStart: sFrom, sEnd: sDest, mergeTurns: Math.round(Math.max(1, mergeTurns)) }] });
			}
		}
		return routes.sort((a,b)=>a.eta-b.eta).slice(0,3);
	}

	// Dijkstra over taps graph with transfers; returns up to 3 best routes
	async planDijkstraRoutes(sectorId, from, to) {
		const ctx = await this.loadSectorLaneContext(sectorId);
		const { edges, runtimeByEdge, healthByRegion, tapsByEdge } = ctx;
		if (!edges.length) return [];
		const fromP = { x:Number(from.x), y:Number(from.y) };
		const toP = { x:Number(to.x), y:Number(to.y) };
		// Precompute per-edge geometry and dest s
		const edgeGeom = new Map();
		for (const e of edges) {
			const pts = LaneGraphService.parseJsonArray(e.polyline_json);
			if (pts.length < 2) continue;
			const { acc, total } = LaneGraphService.cumulativeLengths(pts);
			const destProj = LaneGraphService.projectToPolyline(toP, pts);
			const sDest = LaneGraphService.sAt(destProj, acc);
			const taps = (tapsByEdge.get(e.id) || []).map(t => {
				const pr = LaneGraphService.projectToPolyline({x:t.x,y:t.y}, pts);
				return { id: t.id, x: t.x, y: t.y, s: LaneGraphService.sAt(pr, acc) };
			}).sort((a,b)=>a.s-b.s);
			edgeGeom.set(e.id, { pts, acc, total, sDest, taps });
		}
		// Tap queue CU map
		const allTaps = Array.from(tapsByEdge.values()).flat().map(t=>t.id);
		const queueRows = allTaps.length ? await new Promise((resolve)=>this.db.all(
			`SELECT tap_id, SUM(CASE WHEN status='queued' THEN cu ELSE 0 END) as cu FROM lane_tap_queue WHERE tap_id IN (${allTaps.map(()=>'?').join(',')}) GROUP BY tap_id`,
			allTaps, (e, rows)=>resolve(rows||[]))) : [];
		const queuedByTap = new Map(queueRows.map(r => [Number(r.tap_id), Number(r.cu||0)]));
		// Helper cost functions
		const impulseSpeed = 120;
		const slotCapacityCU = 2;
		const slotsPerTurn = (edge)=> Math.max(0, Math.floor(Number(edge.lane_speed) / Math.max(1, Number(edge.headway||40))));
		const tapQueueTurns = (edge, tapId) => {
			const q = Number(queuedByTap.get(Number(tapId)) || 0);
			const spt = slotsPerTurn(edge);
			return spt>0 ? Math.ceil((q + 1) / (spt * slotCapacityCU)) : 1;
		};
		const laneTimeTurns = (edge, s0, s1) => {
			const { rho, v } = this.computeRhoAndSpeed(edge, runtimeByEdge.get(edge.id), healthByRegion.get(String(edge.region_id)) ?? 50);
			const dist = Math.abs(Number(s1)-Number(s0));
			const t = dist / Math.max(1, v*200);
			return { turns: t, rho };
		};
		const edgesById = new Map(edges.map(e=>[e.id, e]));
		// Build graph
		const nodes = new Set();
		const adj = new Map(); // node -> array of {to, cost, meta}
		function addEdge(a,b,cost,meta){ nodes.add(a); nodes.add(b); const arr = adj.get(a)||[]; arr.push({ to: b, cost, meta }); adj.set(a, arr); }
		const SRC = 'SRC', DST = 'DST';
		// Origin -> taps
		for (const e of edges) {
			const geom = edgeGeom.get(e.id); if (!geom) continue;
			const taps = geom.taps || [];
			if (!taps.length) continue;
			let nearest = null;
			for (const t of taps) {
				const d = Math.hypot(fromP.x - t.x, fromP.y - t.y);
				if (!nearest || d < nearest.d) nearest = { t, d };
			}
			if (nearest) {
				const key = `E${e.id}:T${nearest.t.id}`;
				const approach = nearest.d / impulseSpeed;
				const queue = tapQueueTurns(e, nearest.t.id);
				addEdge(SRC, key, approach + queue, { type: 'origin_to_tap', edgeId: e.id, tapId: nearest.t.id });
			}
		}
		// Intra-edge between adjacent taps both directions
		for (const e of edges) {
			const geom = edgeGeom.get(e.id); if (!geom) continue;
			const taps = geom.taps || [];
			for (let i=0;i<taps.length-1;i++) {
				const a = taps[i], b = taps[i+1];
				const { turns: tAB, rho: rhoAB } = laneTimeTurns(e, a.s, b.s);
				const { turns: tBA, rho: rhoBA } = laneTimeTurns(e, b.s, a.s);
				addEdge(`E${e.id}:T${a.id}`, `E${e.id}:T${b.id}`, tAB, { type:'lane', edgeId:e.id, sStart:a.s, sEnd:b.s, rho: rhoAB });
				addEdge(`E${e.id}:T${b.id}`, `E${e.id}:T${a.id}`, tBA, { type:'lane', edgeId:e.id, sStart:b.s, sEnd:a.s, rho: rhoBA });
			}
		}
		// Transfers between different edges if taps are near
		const transferThreshold = 20;
		for (const e1 of edges) {
			const geom1 = edgeGeom.get(e1.id); if (!geom1) continue;
			for (const t1 of (geom1.taps||[])) {
				for (const e2 of edges) {
					if (e2.id === e1.id) continue;
					const geom2 = edgeGeom.get(e2.id); if (!geom2) continue;
					for (const t2 of (geom2.taps||[])) {
						const d = Math.hypot(t1.x - t2.x, t1.y - t2.y);
						if (d <= transferThreshold) {
							const transCost = 1 + tapQueueTurns(e2, t2.id); // off-ramp + queue at target tap
							addEdge(`E${e1.id}:T${t1.id}`, `E${e2.id}:T${t2.id}`, transCost, { type:'transfer', fromEdgeId:e1.id, toEdgeId:e2.id, fromTapId:t1.id, toTapId:t2.id });
						}
					}
				}
			}
		}
		// Taps -> DST via their edge's sDest
		for (const e of edges) {
			const geom = edgeGeom.get(e.id); if (!geom) continue;
			const taps = geom.taps || [];
			for (const t of taps) {
				const { turns, rho } = laneTimeTurns(e, t.s, geom.sDest);
				addEdge(`E${e.id}:T${t.id}`, DST, Math.ceil(turns + 1), { type:'to_dest', edgeId: e.id, sStart: t.s, sEnd: geom.sDest, rho });
			}
		}
		// Dijkstra
		const dist = new Map([[SRC, 0]]);
		const prev = new Map();
		const prevMeta = new Map();
		const pq = [{ node:SRC, d:0 }];
		function popMin(){ let bi=-1, bd=Infinity; for(let i=0;i<pq.length;i++){ if(pq[i].d < bd){ bd=pq[i].d; bi=i; } } if (bi===-1) return null; const it=pq[bi]; pq.splice(bi,1); return it; }
		while (pq.length) {
			const cur = popMin(); if (!cur) break;
			if (cur.node === DST) break;
			const nbrs = adj.get(cur.node)||[];
			for (const e of nbrs) {
				const nd = cur.d + e.cost;
				if (nd < (dist.get(e.to) ?? Infinity)) {
					dist.set(e.to, nd); prev.set(e.to, cur.node); prevMeta.set(e.to, e.meta || {}); pq.push({ node:e.to, d: nd });
				}
			}
		}
		if (!dist.has(DST)) return [];
		// Reconstruct
		const hops = [];
		let cur = DST; while (prev.has(cur)) { const p = prev.get(cur); const meta = prevMeta.get(cur)||{}; hops.push({ from:p, to:cur, meta }); cur = p; }
		hops.reverse();
		// Convert to legs
		const legs = [];
		let rhoMax = 0;
		for (const h of hops) {
			if (h.meta.type === 'lane' || h.meta.type === 'to_dest') {
				legs.push({ edgeId: h.meta.edgeId, entry: 'tap', sStart: h.meta.sStart, sEnd: h.meta.sEnd, tapId: (typeof h.meta.tapId==='number'?h.meta.tapId:undefined) });
				if (typeof h.meta.rho === 'number') rhoMax = Math.max(rhoMax, h.meta.rho);
			}
			// transfers and origin_to_tap are accounted in cost but do not produce separate legs
		}
		// Merge contiguous legs on same edge consecutively
		const merged = [];
		for (const L of legs) {
			const last = merged[merged.length-1];
			if (last && Number(last.edgeId)===Number(L.edgeId) && String(last.entry)===String(L.entry) && (last.tapId || L.tapId)) {
				last.sEnd = L.sEnd;
			} else {
				merged.push({ ...L });
			}
		}
		const eta = Math.ceil(dist.get(DST));
		return [{ eta, rho: rhoMax, risk: (rhoMax>1.5?3:(rhoMax>1?2:1)), legs: merged }];
	}
	// Simple 2-leg planning via tap junctions (taps within threshold are considered connected)
	async planTwoLegRoutes(sectorId, from, to) {
		const { edges, runtimeByEdge, healthByRegion, tapsByEdge } = await this.loadSectorLaneContext(sectorId);
		if (!edges.length) return [];
		const fromP = { x:Number(from.x), y:Number(from.y) }, toP = { x:Number(to.x), y:Number(to.y) };
		const transferThreshold = 20; // distance units to consider taps connected
		const results = [];
		for (const e1 of edges) {
			const pts1 = LaneGraphService.parseJsonArray(e1.polyline_json); if (pts1.length<2) continue;
			const { acc:acc1 } = LaneGraphService.cumulativeLengths(pts1);
			const taps1 = tapsByEdge.get(e1.id) || [];
			if (!taps1.length) continue;
			// nearest tap from origin on e1
			const nearest1 = taps1.reduce((best,t)=>{ const d=LaneGraphService.distance(fromP,{x:t.x,y:t.y}); return !best||d<best.d?{t,d}:best; }, null);
			if (!nearest1) continue;
			const tap1Proj = LaneGraphService.projectToPolyline({x:nearest1.t.x,y:nearest1.t.y}, pts1);
			const s1Start = LaneGraphService.sAt(tap1Proj, acc1);
			// Find neighboring taps on other edges within threshold
			for (const [edgeId2, taps2] of tapsByEdge.entries()) {
				if (Number(edgeId2) === Number(e1.id)) continue;
				const neighbor = taps2.find(t2 => LaneGraphService.distance({x:nearest1.t.x,y:nearest1.t.y}, {x:t2.x,y:t2.y}) <= transferThreshold);
				if (!neighbor) continue;
				const e2 = edges.find(ed => Number(ed.id) === Number(edgeId2)); if (!e2) continue;
				const pts2 = LaneGraphService.parseJsonArray(e2.polyline_json); if (pts2.length<2) continue;
				const { acc:acc2 } = LaneGraphService.cumulativeLengths(pts2);
				// s for neighbor tap on e2 and destination on e2
				const tap2Proj = LaneGraphService.projectToPolyline({x:neighbor.x,y:neighbor.y}, pts2);
				const s2Start = LaneGraphService.sAt(tap2Proj, acc2);
				const destProj2 = LaneGraphService.projectToPolyline(toP, pts2);
				const s2End = LaneGraphService.sAt(destProj2, acc2);
				// Estimate costs
				const { rho: rho1, v: v1 } = this.computeRhoAndSpeed(e1, runtimeByEdge.get(e1.id), healthByRegion.get(String(e1.region_id)) || 50);
				const { rho: rho2, v: v2 } = this.computeRhoAndSpeed(e2, runtimeByEdge.get(e2.id), healthByRegion.get(String(e2.region_id)) || 50);
				const approachTime = nearest1.d / 120;
				const laneTime1 = Math.abs(s1Start - s1Start) / Math.max(1, v1*200); // 0, starting at tap
				const transferPenalty = 1; // turns to transfer between edges
				const laneTime2 = Math.abs(s2End - s2Start) / Math.max(1, v2*200);
				const eta = Math.ceil(approachTime + laneTime1 + transferPenalty + laneTime2 + 1);
				results.push({
					eta,
					rho: Math.max(rho1, rho2),
					risk: (Math.max(rho1, rho2)>1.5?3:(Math.max(rho1, rho2)>1?2:1)),
					legs: [
						{ edgeId: e1.id, entry: 'tap', sStart: s1Start, sEnd: s1Start, tapId: nearest1.t.id },
						{ edgeId: e2.id, entry: 'tap', sStart: s2Start, sEnd: s2End, tapId: neighbor.id }
					]
				});
			}
		}
		return results.sort((a,b)=>a.eta-b.eta).slice(0,3);
	}
}

module.exports = { LaneGraphService };


