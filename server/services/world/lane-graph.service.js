class LaneGraphService {
	constructor(db) {
		this.db = db;
	}

	async loadSectorLaneContext(sectorId, visited = new Set()) {
		if (visited.has(sectorId)) return null;
		visited.add(sectorId);

		const db = this.db;
		const edges = await new Promise((resolve)=>db.all(
			`SELECT e.id, e.region_id, e.sector_id, e.polyline_json, e.lane_speed, e.width_core, e.cap_base, e.headway
			 FROM lane_edges e WHERE e.sector_id = ?`, [sectorId], (e, rows)=>resolve(rows||[])));
		
		const runtimeByEdge = new Map();
		if (edges.length > 0) {
			const runtimeRows = await new Promise((resolve)=>db.all(
				`SELECT edge_id, load_cu FROM lane_edges_runtime WHERE edge_id IN (${edges.map(()=>'?').join(',')})`,
				edges.map(r=>r.id), (e, rows)=>resolve(rows||[])
			));
			runtimeRows.forEach(r => runtimeByEdge.set(Number(r.edge_id), Number(r.load_cu||0)));
		}

		const regionHealthRows = await new Promise((resolve)=>db.all(
			`SELECT region_id, health FROM regions WHERE sector_id = ?`, [sectorId], (e, rows)=>resolve(rows||[])));
		const healthByRegion = new Map(regionHealthRows.map(r=>[String(r.region_id), Number(r.health||50)]));
		
		const tapsByEdge = new Map();
		if (edges.length > 0) {
			const tapRows = await new Promise((resolve)=>db.all(
				`SELECT id, edge_id, x, y FROM lane_taps WHERE edge_id IN (${edges.map(()=>'?').join(',')})`,
				edges.map(r=>r.id), (e, rows)=>resolve(rows||[])
			));
			tapRows.forEach(t => {
				const arr = tapsByEdge.get(t.edge_id) || [];
				arr.push(t);
				tapsByEdge.set(t.edge_id, arr);
			});
		}

		// Load gates for multi-sector travel
		const gates = await new Promise((resolve)=>db.all(
			`SELECT id, x, y, meta, sector_id FROM sector_objects WHERE sector_id = ? AND type = 'interstellar-gate'`,
			[sectorId], (e, rows)=>resolve(rows||[])));

		let context = { edges, runtimeByEdge, healthByRegion, tapsByEdge, gates, sectorId };

		// Recursively load adjacent sectors if depth permits (e.g., depth 1 for now)
		if (visited.size < 3) { // limit to 2-3 sectors for performance
			for (const g of gates) {
				try {
					const meta = JSON.parse(g.meta || '{}');
					const destSectorId = meta.destinationSectorId;
					if (destSectorId) {
						const subCtx = await this.loadSectorLaneContext(destSectorId, visited);
						if (subCtx) {
							// Merge subCtx into context (prefix IDs or handle globally unique IDs)
							context.edges = [...context.edges, ...subCtx.edges];
							subCtx.runtimeByEdge.forEach((v, k) => context.runtimeByEdge.set(k, v));
							subCtx.healthByRegion.forEach((v, k) => context.healthByRegion.set(k, v));
							subCtx.tapsByEdge.forEach((v, k) => context.tapsByEdge.set(k, v));
							context.gates = [...context.gates, ...subCtx.gates];
						}
					}
				} catch {}
			}
		}

		return context;
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

	computeRhoAndSpeed(edge, loadCU, regionHealth, opts={}) {
		const { cap } = this.computeCapacity(edge, regionHealth);
		const rho = Number(loadCU || 0) / Math.max(1, cap);
		const speedMult = rho<=1?1:rho<=1.5?0.8:rho<=2?0.6:0.4;
		// Planner uses the same flat warp speed model as runtime for ETA parity
		const WARP_BASE_TILES_PER_TURN = 100; // keep in sync with runtime
		const warpMult = Math.max(0.001, Number(opts?.warpMult || 1));
		const v = Math.max(0.001, (WARP_BASE_TILES_PER_TURN * speedMult * warpMult));
		return { rho, speedMult, v };
	}

	async planSingleLegRoutes(sectorId, from, to, opts={}) {
		const { edges, runtimeByEdge, healthByRegion, tapsByEdge } = await this.loadSectorLaneContext(sectorId);
		if (!edges.length) return [];
		const fromP = { x:Number(from.x), y:Number(from.y) }, toP = { x:Number(to.x), y:Number(to.y) };
		const defaultCu = 1; const slotCapacityCU = 2;
		const routes = [];
		for (const e of edges) {
			const pts = LaneGraphService.parseJsonArray(e.polyline_json);
			if (pts.length < 2) continue;
			const { acc } = LaneGraphService.cumulativeLengths(pts);
			const { rho, speedMult, v } = this.computeRhoAndSpeed(e, runtimeByEdge.get(e.id), healthByRegion.get(String(e.region_id)) ?? 50, opts);
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
					const laneTime = laneDist / Math.max(1, v);
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
				const laneTime = laneDist / Math.max(1, v);
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
	async planDijkstraRoutes(sectorId, from, to, opts={}) {
		const ctx = await this.loadSectorLaneContext(sectorId);
		const { edges, runtimeByEdge, healthByRegion, tapsByEdge, gates } = ctx;
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
			const { rho, v } = this.computeRhoAndSpeed(edge, runtimeByEdge.get(edge.id), healthByRegion.get(String(edge.region_id)) ?? 50, opts);
			const dist = Math.abs(Number(s1)-Number(s0));
			const t = dist / Math.max(1, v);
			return { turns: t, rho };
		};

		// Build graph
		const nodes = new Set();
		const adj = new Map(); // node -> array of {to, cost, meta}
		function addEdge(a,b,cost,meta){ nodes.add(a); nodes.add(b); const arr = adj.get(a)||[]; arr.push({ to: b, cost, meta }); adj.set(a, arr); }
		const SRC = 'SRC', DST = 'DST';

		// 1. Direct Impulse baseline
		const directDist = Math.hypot(fromP.x - toP.x, fromP.y - toP.y);
		addEdge(SRC, DST, directDist / impulseSpeed, { type: 'direct_impulse' });

		// 2. Origin -> Taps (Normal Entry)
		const allTapEntries = [];
		for (const e of edges) {
			const geom = edgeGeom.get(e.id); if (!geom) continue;
			for (const t of (geom.taps||[])) {
				const d = Math.hypot(fromP.x - t.x, fromP.y - t.y);
				allTapEntries.push({ edge: e, tap: t, d });
			}
		}
		allTapEntries.sort((a,b)=>a.d-b.d);
		const K_TAPS = Math.min(6, allTapEntries.length);
		for (let i=0;i<K_TAPS;i++) {
			const { edge: e, tap: t, d } = allTapEntries[i];
			const key = `E${e.id}:T${t.id}`;
			const approach = d / impulseSpeed;
			const queue = tapQueueTurns(e, t.id);
			addEdge(SRC, key, approach + queue, { type: 'origin_to_tap', edgeId: e.id, tapId: t.id });
		}

		// 3. Origin -> Lanes (Wildcat Merge)
		for (const e of edges) {
			const geom = edgeGeom.get(e.id); if (!geom) continue;
			const { rho } = this.computeRhoAndSpeed(e, runtimeByEdge.get(e.id), healthByRegion.get(String(e.region_id)) || 50);
			if (rho > 1.5) continue; // Lane too busy for wildcat

			const fromProj = LaneGraphService.projectToPolyline(fromP, geom.pts);
			const sFrom = LaneGraphService.sAt(fromProj, geom.acc);
			const approach = fromProj.d / impulseSpeed;
			
			// Wildcat merge cost calculation (simplified from planSingleLegRoutes)
			let mergeTurns = 1 + 0.01 * Math.max(0, fromProj.d - Number(e.width_core||0));
			const health = healthByRegion.get(String(e.region_id)) ?? 50;
			if (health>=60) mergeTurns *= 0.8; else if (health<=40) mergeTurns *= 1.25;
			if (rho>1) mergeTurns += Math.max(0.5, (rho-1));
			
			const key = `E${e.id}:W_IN`;
			addEdge(SRC, key, approach + mergeTurns, { type: 'origin_to_wildcat', edgeId: e.id, sStart: sFrom, mergeTurns: Math.round(Math.max(1, mergeTurns)) });
			
			// Add nodes within the edge for wildcat
			const edgeNodes = [{ key, s: sFrom, type: 'wildcat_in' }];
			for (const t of (geom.taps || [])) edgeNodes.push({ key: `E${e.id}:T${t.id}`, s: t.s, type: 'tap' });
			
			// Destination projection as a node
			const sDest = geom.sDest;
			const destKey = `E${e.id}:W_OUT`;
			edgeNodes.push({ key: destKey, s: sDest, type: 'wildcat_out' });
			
			edgeNodes.sort((a,b)=>a.s-b.s);
			for (let i=0; i<edgeNodes.length-1; i++) {
				const a = edgeNodes[i], b = edgeNodes[i+1];
				const { turns: tAB, rho: rhoAB } = laneTimeTurns(e, a.s, b.s);
				const { turns: tBA, rho: rhoBA } = laneTimeTurns(e, b.s, a.s);
				addEdge(a.key, b.key, tAB, { type: 'lane', edgeId: e.id, sStart: a.s, sEnd: b.s, rho: rhoAB });
				addEdge(b.key, a.key, tBA, { type: 'lane', edgeId: e.id, sStart: b.s, sEnd: a.s, rho: rhoBA });
			}
		}

		// 4. Transfers between edges
		const transferThreshold = 100;
		const allEntryNodes = Array.from(nodes).filter(n => n.includes(':T') || n.includes(':W_IN'));
		for (let i=0; i<allEntryNodes.length; i++) {
			for (let j=0; j<allEntryNodes.length; j++) {
				if (i === j) continue;
				const n1 = allEntryNodes[i], n2 = allEntryNodes[j];
				// Extract coordinates for nodes (simplified: for wildcat, use projection; for taps, use tap x,y)
				// For this refined logic, we'll stick to tap-to-tap transfers mostly
				if (!n1.includes(':T') || !n2.includes(':T')) continue;
				
				const tap1Id = Number(n1.split(':T')[1]);
				const tap2Id = Number(n2.split(':T')[1]);
				const tap1 = Array.from(tapsByEdge.values()).flat().find(t => t.id === tap1Id);
				const tap2 = Array.from(tapsByEdge.values()).flat().find(t => t.id === tap2Id);
				if (!tap1 || !tap2) continue;

				const d = Math.hypot(tap1.x - tap2.x, tap1.y - tap2.y);
				if (d <= transferThreshold) {
					const e2Id = Number(n2.split(':')[0].substring(1));
					const e2 = edges.find(e => e.id === e2Id);
					const transCost = 2 + (d / impulseSpeed) + (e2 ? tapQueueTurns(e2, tap2Id) : 1);
					addEdge(n1, n2, transCost, { type: 'transfer', fromTapId: tap1Id, toTapId: tap2Id });
				}
			}
		}

		// 5. Gates (Multi-Sector transitions)
		for (const g of (gates || [])) {
			const gateKey = `GATE:${g.id}`;
			const d = Math.hypot(fromP.x - g.x, fromP.y - g.y);
			
			// Only allow SRC -> GATE if in same sector
			if (g.sector_id === sectorId) {
				addEdge(SRC, gateKey, d / impulseSpeed + 1, { type: 'to_gate', gateId: g.id });
			}
			
			// From taps to gates (same sector)
			for (const e of edges) {
				if (e.sector_id !== g.sector_id) continue;
				const geom = edgeGeom.get(e.id); if (!geom) continue;
				for (const t of (geom.taps || [])) {
					const dGT = Math.hypot(g.x - t.x, g.y - t.y);
					if (dGT < transferThreshold) {
						addEdge(`E${e.id}:T${t.id}`, gateKey, dGT / impulseSpeed + 1, { type: 'tap_to_gate', gateId: g.id });
						addEdge(gateKey, `E${e.id}:T${t.id}`, dGT / impulseSpeed + tapQueueTurns(e, t.id), { type: 'gate_to_tap', tapId: t.id });
					}
				}
			}
			
			// Connect Gate Pairs across sectors
			try {
				const meta = JSON.parse(g.meta || '{}');
				const gatePairId = meta.gatePairId;
				if (gatePairId) {
					const pairedGate = gates.find(g2 => {
						if (g2.id === g.id) return false;
						try { return JSON.parse(g2.meta || '{}').gatePairId === gatePairId; } catch { return false; }
					});
					if (pairedGate) {
						// Teleportation cost (1 turn)
						addEdge(gateKey, `GATE:${pairedGate.id}`, 1, { type: 'gate_teleport', fromGateId: g.id, toGateId: pairedGate.id });
					}
				}
			} catch {}

			// Gates to DST (if in same sector)
			if (g.sector_id === Number(to.sector_id || sectorId)) {
				const dGD = Math.hypot(g.x - toP.x, g.y - toP.y);
				addEdge(gateKey, DST, dGD / impulseSpeed, { type: 'gate_to_dest' });
			}
		}

		// 6. Sinks -> DST
		const offRampPenalty = 1;
		for (const n of Array.from(nodes)) {
			if (n === SRC || n === DST) continue;
			if (n.includes(':W_OUT') || n.includes(':T') || n.includes(':W_IN')) {
				const parts = n.split(':');
				const edgeId = Number(parts[0].substring(1));
				const e = edges.find(ed => ed.id === edgeId);
				const geom = edgeGeom.get(edgeId);
				if (!e || !geom) continue;

				let nodePos;
				let sStart;
				if (n.includes(':T')) {
					const tid = Number(n.split(':T')[1]);
					const t = geom.taps.find(tap => tap.id === tid);
					nodePos = { x: t.x, y: t.y };
					sStart = t.s;
				} else {
					const s = n.includes('W_IN') ? LaneGraphService.sAt(LaneGraphService.projectToPolyline(fromP, geom.pts), geom.acc) : geom.sDest;
					nodePos = this.pointAtS(geom.pts, geom.acc, s, toP);
					sStart = s;
				}

				const d = Math.hypot(nodePos.x - toP.x, nodePos.y - toP.y);
				addEdge(n, DST, (d / impulseSpeed) + offRampPenalty, { type: 'to_dest', edgeId: e.id, sStart, sEnd: geom.sDest });
			}
		}

		// Dijkstra algorithm
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

		// Reconstruct and Merge Legs
		const hops = [];
		let cur = DST; while (prev.has(cur)) { const p = prev.get(cur); const meta = prevMeta.get(cur)||{}; hops.push({ from:p, to:cur, meta }); cur = p; }
		hops.reverse();

		const legs = [];
		let currentLeg = null;
		let rhoMax = 0;

		for (const h of hops) {
			const m = h.meta;
			if (m.type === 'lane' || m.type === 'to_dest' || m.type === 'origin_to_wildcat') {
				const edgeId = m.edgeId;
				const entry = m.type === 'origin_to_wildcat' ? 'wildcat' : (m.type === 'lane' || m.type === 'to_dest' ? (h.from.includes(':T') ? 'tap' : 'wildcat') : 'wildcat');
				const sStart = m.sStart;
				const sEnd = m.sEnd ?? m.sStart; // for wildcat entry points, sEnd is sStart
				const tapId = m.tapId;

				if (currentLeg && currentLeg.edgeId === edgeId) {
					// Merge with existing leg on same edge
					currentLeg.sEnd = sEnd;
				} else {
					if (currentLeg) legs.push(currentLeg);
					currentLeg = { edgeId, entry, sStart, sEnd, tapId, mergeTurns: m.mergeTurns };
				}
				if (typeof m.rho === 'number') rhoMax = Math.max(rhoMax, m.rho);
			} else {
				if (currentLeg) { legs.push(currentLeg); currentLeg = null; }
			}
		}
		if (currentLeg) legs.push(currentLeg);

		// Drop zero-length legs
		const filtered = legs.filter(L => Math.abs(Number(L.sEnd||0) - Number(L.sStart||0)) > 1e-6 || L.entry === 'wildcat');
		const eta = Math.ceil(dist.get(DST));
		
		return [{ eta, rho: rhoMax, risk: (rhoMax>1.5?3:(rhoMax>1?2:1)), legs: filtered }];
	}

	// Helper to interpolate world point at arclength s on polyline
	pointAtS(pts, acc, s, fallback){
		if (!pts || pts.length<2) return fallback;
		s = Math.max(0, Math.min(acc[acc.length-1]||0, s));
		let idx=0; while (idx<acc.length-1 && acc[idx+1] < s) idx++;
		const denom = Math.max(1e-6, (acc[idx+1]-acc[idx]));
		const t = (s-acc[idx]) / denom;
		return { x: pts[idx].x + (pts[idx+1].x-pts[idx].x)*t, y: pts[idx].y + (pts[idx+1].y-pts[idx].y)*t };
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
				const laneTime1 = 0; // starting at tap
				const transferPenalty = 1; // turns to transfer between edges
				const laneTime2 = Math.abs(s2End - s2Start) / Math.max(1, v2);
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

