// Starfront: Dominion - Game Client Logic

import * as SFMining from './features/mining.js';
import * as SFCargo from './features/cargo.js';
import { normalizeGameState, getEffectiveMovementSpeed as coreGetEffectiveMovementSpeed, getEffectiveScanRange as coreGetEffectiveScanRange, getUnitStatus as coreGetUnitStatus, getUnitStatuses as coreGetUnitStatuses } from './core/GameState.js';
import { calculateMovementPath as coreCalculateMovementPath, calculateETA as coreCalculateETA } from './core/Movement.js';
import { renderUnitDetails as uiRenderUnitDetails } from './ui/UnitDetails.js';
import { connectSocket as netConnectSocket } from './net/socket.js';
import { fetchSectorTrails as trailsFetchSectorTrails, handleLingeringTrailsOnTurn } from './features/Trails.js';
import {
    showWarpConfirmation,
    executeWarpOrder,
    enterWarpMode,
    showWarpTargetSelection,
    getWarpTargets,
    getWarpTargetIcon,
    getWarpTargetType,
    isAdjacentToInterstellarGate,
    getAdjacentInterstellarGates
} from './features/warp.js';
import {
    showBuildModal as build_showBuildModal,
    renderShipyard as build_renderShipyard,
    switchBuildTab as build_switchBuildTab,
    buildShip as build_buildShip,
    buildStructure as build_buildStructure,
    buildBasicExplorer as build_buildBasicExplorer,
    deployStructure as build_deployStructure,
    showSectorSelectionModal as build_showSectorSelectionModal,
    deployInterstellarGate as build_deployInterstellarGate
} from './features/build.js';

export class GameClient {
    constructor() {
        this.gameId = null;
        this.userId = null;
        this.socket = null;
        this.gameState = null;
        this.selectedUnit = null;
        this.selectedObjectId = null; // STAGE B: Track selection by ID across turns
        this.canvas = null;
        this.ctx = null;
        this.playerNameById = new Map();
        this._tooltipEl = null;
        this.miniCanvas = null;
        this.miniCtx = null;
        this.camera = { x: 2500, y: 2500, zoom: 1 };
        this.tileSize = 20;
        this.turnLocked = false;
        this.abilityPreview = null;
        this.abilityHover = null; // { x, y, valid }
        this.pendingAbility = null;
        this.objects = [];
        this.units = [];
        this.isFirstLoad = true; // Track if this is the initial game load
        this.clientLingeringTrails = []; // FIX 2: Store client-side lingering trails from redirections
        this.previousMovementStatuses = new Map(); // FIX: Track previous movement statuses to detect completions
        this.movementHistoryCache = new Map(); // PHASE 2: Cache movement history by ship ID
        this.warpMode = false; // Track if we're in warp target selection mode
        this.warpTargets = []; // Available warp targets (celestial objects)
        this.fogEnabled = true;
        this.trailBuffer = { byTurn: new Map() };
        this.fogOffscreen = null;
        this.lastFleet = null; // Cached fleet for stats strip
        this.senateProgress = 0; // 0-100 senate update meter
        this.turnCountdownTimer = null;
        this.queueMode = false; // If true, right-clicking queues orders
        this._queuedByShipId = new Map(); // Cached queued orders by ship id for UI and map markers
    }

    async fetchSectorTrails() { return trailsFetchSectorTrails(this); }

    // Initialize the game
    async initialize(gameId) {
        this.gameId = gameId;
        const user = Session.getUser();
        if (!user) {
            window.location.href = 'login.html';
            return;
        }
        this.userId = user.userId;

        // Setup canvas
        this.setupCanvas();
        // Apply avatar in PlayerInformation if present
        const avatarMini = document.getElementById('playerAvatarMini');
        if (avatarMini) {
            const stored = localStorage.getItem('avatar');
            if (stored) avatarMini.src = stored;
        }
        // Load senate progress from local storage
        this.loadSenateProgress();
        
        // Connect to Socket.IO
        this.connectSocket();
        
        // Load initial game state
        await this.loadGameState();
        
        // Setup event listeners
        this.setupEventListeners();
        // Bind UI controls migrated from inline HTML
        this.bindUIControls();
        
        console.log(`🎮 Game ${gameId} initialized for user ${this.userId}`);
    }

    // Setup canvas elements
    setupCanvas() {
        this.canvas = document.getElementById('gameCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.ensureMiniCanvasRef();
        
        // Set canvas size
        this.resizeCanvas();
        window.addEventListener('resize', () => this.resizeCanvas());

        // Create tooltip overlay for hover info (once)
        this.createMapTooltip();
        
        // Bind minimap interactions (click and drag to pan main camera)
        this.bindMiniMapInteractions();
    }

    // Resize canvas to fit container
    resizeCanvas() {
        const container = this.canvas.parentElement;
        this.canvas.width = container.clientWidth;
        this.canvas.height = container.clientHeight;
        this.ensureMiniCanvasRef();
        if (this.miniCanvas && this.miniCanvas.parentElement) {
            this.miniCanvas.width = this.miniCanvas.parentElement.clientWidth - 20;
            this.miniCanvas.height = this.miniCanvas.parentElement.clientHeight - 40;
        }
        
        this.render();
    }

    // Robustly find the minimap canvas whether it's inline or floating
    ensureMiniCanvasRef() {
        // Prefer an element with id="miniCanvas" if present
        const byId = document.getElementById('miniCanvas');
        if (byId && byId instanceof HTMLCanvasElement) {
            if (this.miniCanvas !== byId) {
                this.miniCanvas = byId;
                this.miniCtx = this.miniCanvas.getContext('2d');
                this._miniBound = false; // rebind interactions
                this.bindMiniMapInteractions();
            }
            return;
        }
        // Fallback: floating wrapper structure as provided in user HTML
        const wrap = document.getElementById('floatingMiniWrap');
        if (wrap) {
            const canv = wrap.querySelector('canvas');
            if (canv && canv instanceof HTMLCanvasElement) {
                if (this.miniCanvas !== canv) {
                    this.miniCanvas = canv;
                    this.miniCtx = this.miniCanvas.getContext('2d');
                    this._miniBound = false; // rebind interactions
                    this.bindMiniMapInteractions();
                }
                return;
            }
        }
        // As last resort, pick the first canvas inside any element with title "Mini-map"
        const guess = Array.from(document.querySelectorAll('div')).find(d => /Mini-map/i.test(d.textContent || ''));
        if (guess) {
            const canv2 = guess.querySelector('canvas');
            if (canv2 && canv2 instanceof HTMLCanvasElement) {
                if (this.miniCanvas !== canv2) {
                    this.miniCanvas = canv2;
                    this.miniCtx = this.miniCanvas.getContext('2d');
                    this._miniBound = false;
                    this.bindMiniMapInteractions();
                }
                return;
            }
        }
        // If none found, clear refs
        if (!byId) {
            this.miniCanvas = null;
            this.miniCtx = null;
        }
    }

    // Connect to Socket.IO
    connectSocket() {
        netConnectSocket(this);
    }

    // ✅ Atomic Turn Resolution Policy: Removed real-time movement updates
    // All movement changes now happen atomically after turn resolution via loadGameState()
    // 
    // This function is preserved for potential future use (animations, etc.)
    // but is no longer called during normal gameplay
    handleMovementUpdate(data) {
        console.log('⚠️ handleMovementUpdate called - this should not happen with atomic turn resolution');
        console.log('Movement update data:', data);
        
        // Future: Could be used for post-resolution animations
        // const { objectId, status, newPosition } = data;
        // this.animateMovementChange(objectId, status, newPosition);
    }

    // Load game state from server
    async loadGameState() {
        try {
            // If a unit is selected, pin state to its sector to avoid snapping to home sector
            let url = `/game/${this.gameId}/state/${this.userId}`;
            if (this.selectedUnit && this.selectedUnit.sectorInfo?.id) {
                url = `/game/${this.gameId}/state/${this.userId}/sector/${this.selectedUnit.sectorInfo.id}`;
            }
            const data = await SFApi.State.gameState(this.gameId, this.userId, (this.selectedUnit && this.selectedUnit.sectorInfo?.id) ? this.selectedUnit.sectorInfo.id : undefined);
            
            if (data) {
                // Parse all meta fields from JSON strings to objects
                if (data.objects) {
                    data.objects.forEach(obj => {
                        if (obj.meta && typeof obj.meta === 'string') {
                            try {
                                obj.meta = JSON.parse(obj.meta);
                            } catch (e) {
                                console.warn('Failed to parse meta for object:', obj.id, obj.meta);
                                obj.meta = {};
                            }
                        }
                    });
                }
                
                // Preserve current camera and selection while updating state
                const preserveCamera = { x: this.camera.x, y: this.camera.y };
                // Normalize state via core/GameState
                this.gameState = normalizeGameState(data);
                this.updateUI();
                this.camera.x = preserveCamera.x;
                this.camera.y = preserveCamera.y;
                this.render();
                console.log('🎮 Game state loaded:', data);
            }
        } catch (error) {
            console.error('Failed to load game state:', error);
            this.addLogEntry('Failed to connect to game server', 'error');
        }
    }

    // PHASE 2: Fetch movement history from server for accurate trail rendering
    async fetchMovementHistory(shipId = null, turns = 10) {
        try {
            const url = `/game/${this.gameId}/movement-history/${this.userId}${shipId ? `?shipId=${shipId}&turns=${turns}` : `?turns=${turns}`}`;
            const data = await SFApi.State.movementHistory(this.gameId, this.userId, shipId, turns);
            if (!data.success) throw new Error(data.error || 'Failed to fetch movement history');
            
            console.log(`📜 Fetched ${data.movementHistory.length} movement history segments (${data.turnsRequested} turns)`);
            
            // Update cache
            data.movementHistory.forEach(movement => {
                if (!this.movementHistoryCache.has(movement.shipId)) {
                    this.movementHistoryCache.set(movement.shipId, []);
                }
                
                const shipHistory = this.movementHistoryCache.get(movement.shipId);
                // Only add if not already cached (avoid duplicates)
                if (!shipHistory.some(h => h.turnNumber === movement.turnNumber && 
                    h.segment.from.x === movement.segment.from.x && h.segment.from.y === movement.segment.from.y)) {
                    shipHistory.push(movement);
                }
            });
            
            return data.movementHistory;
            
        } catch (error) {
            console.error('❌ Failed to fetch movement history:', error);
            return [];
        }
    }

    // Update UI elements with game state
    async updateUI() {
        if (!this.gameState) return;

        // Check if setup is needed (prevent normal UI until setup complete)
        if (!this.gameState.playerSetup?.setup_completed) {
            try { const mod = await import('./ui/setup-modal.js'); mod.showSetupModal(this); } catch {}
            return; // Don't show game UI until setup complete
        }

        // Update turn counter
        document.getElementById('turnCounter').textContent = `Turn ${this.gameState.currentTurn.turn_number}`;
        this.updateTurnCountdown();
        
        // Update game title with sector name
        const gameTitle = document.getElementById('gameTitle');
        gameTitle.innerHTML = `🌌 ${this.gameState.sector.name || 'Your System'}`;
        
        // Update player panel
        try { const mod = await import('./ui/player-panel.js'); mod.updatePlayerPanel(this); } catch {}
        
        // Update sector overview title
        this.updateSectorOverviewTitle();
        
        // Update turn lock status
        const lockBtn = document.getElementById('lockTurnBtn');
        if (this.gameState.turnLocked) {
            lockBtn.textContent = '🔒 Turn Locked';
            lockBtn.classList.add('locked');
            this.turnLocked = true;
        } else {
            lockBtn.textContent = '🔓 Lock Turn';
            lockBtn.classList.remove('locked');
            this.turnLocked = false;
        }

        // Update units list - load from all sectors
        try { const mod = await import('./ui/fleet-list.js'); mod.updateFleetList(this); } catch {}

        this.objects = this.gameState.objects;

        // After state load, also re-apply senate UI (in case of first load)
        this.applySenateProgressToUI();
        
        // Get player objects for selection logic
        const allPlayerObjects = this.gameState.objects.filter(obj => obj.owner_id === this.userId);
        const playerObjects = allPlayerObjects.filter((obj, index, array) => 
            array.findIndex(duplicate => duplicate.id === obj.id) === index
        );
        
        // FIX: Detect ships that just completed movement and create lingering trails BEFORE cleanup
        this.objects.forEach(ship => {
            if (ship.type === 'ship' && ship.movementStatus === 'completed' && ship.movementPath && ship.movementPath.length > 1) {
                const prevStatus = this.previousMovementStatuses.get(ship.id);
                
                // If ship was previously active and is now completed, create lingering trail
                if (prevStatus === 'active') {
                    const currentTurn = this.gameState?.currentTurn?.turn_number || 1;
                    const lingeringTrail = {
                        id: `completion-${ship.id}-${currentTurn}`,
                        shipId: ship.id,
                        movementPath: [...ship.movementPath],
                        owner_id: ship.owner_id,
                        meta: { ...ship.meta },
                        x: ship.x,
                        y: ship.y,
                        movementStatus: 'completed',
                        type: 'ship',
                        visibilityStatus: ship.visibilityStatus,
                        createdAt: Date.now(),
                        createdOnTurn: currentTurn
                    };
                    
                    // Check if we don't already have this trail
                    const existingTrail = this.clientLingeringTrails.find(t => 
                        t.shipId === ship.id && t.createdOnTurn === currentTurn
                    );
                    
                    if (!existingTrail) {
                        this.clientLingeringTrails.push(lingeringTrail);
                        console.log(`🏁 Created lingering trail for completed ship ${ship.id} (${ship.meta?.name})`);
                    }
                }
            }
        });
        
        // Clean up client trails
        handleLingeringTrailsOnTurn(this);
        
        // Update previous movement statuses for next comparison
        this.previousMovementStatuses.clear();
        this.objects.forEach(ship => {
            if (ship.type === 'ship' && ship.movementStatus) {
                this.previousMovementStatuses.set(ship.id, ship.movementStatus);
            }
        });
        
        // Debug: Log ships with movement data
        const movingShips = this.objects.filter(obj => obj.movementPath && obj.movementActive);
        if (movingShips.length > 0) {
            console.log(`🚢 Found ${movingShips.length} ships with active movement paths:`, movingShips.map(s => ({
                id: s.id,
                name: s.meta.name,
                pathLength: s.movementPath?.length,
                destination: s.plannedDestination,
                active: s.movementActive,
                status: s.movementStatus
            })));
        }

        // STAGE B & C: Selection persistence and conditional auto-selection
        if (this.selectedObjectId) {
            // STAGE 4 SAFETY: Select from deduplicated player objects to avoid phantom selections
            const previouslySelected = playerObjects.find(obj => obj.id === this.selectedObjectId);
            if (previouslySelected) {
                const oldPosition = this.selectedUnit ? { x: this.selectedUnit.x, y: this.selectedUnit.y } : null;
                this.selectedUnit = previouslySelected;
                
                // Check if object moved and log it
                if (oldPosition && (oldPosition.x !== previouslySelected.x || oldPosition.y !== previouslySelected.y)) {
                    console.log(`📍 Selected object moved from (${oldPosition.x},${oldPosition.y}) to (${previouslySelected.x},${previouslySelected.y})`);
                    // Do NOT recenter camera automatically; respect user's current view
                }
                
                // Ensure UI selection highlight is applied
                document.querySelectorAll('.unit-item').forEach(item => item.classList.remove('selected'));
                const unitElement = document.getElementById(`unit-${this.selectedObjectId}`);
                if (unitElement) {
                    unitElement.classList.add('selected');
                }
                
                this.updateUnitDetails();
            } else {
                // Previously selected object no longer exists (destroyed?)
                console.log(`⚠️ Previously selected object ${this.selectedObjectId} no longer exists`);
                this.selectedUnit = null;
                this.selectedObjectId = null;
            }
        } else if (!this.selectedUnit && this.units.length > 0 && this.isFirstLoad) {
            // STAGE C FIX: Only auto-select on first load, not every turn
            this.selectUnit(this.units[0].id);
            this.isFirstLoad = false;
        }
    }

    updateTurnCountdown() {
        try {
            const countdownEl = document.getElementById('turnCountdown');
            if (!countdownEl) return;
            const autoMin = this.gameState?.autoTurnMinutes;
            const createdAt = this.gameState?.currentTurn?.created_at;
            if (typeof autoMin !== 'number' || !createdAt) {
                countdownEl.style.display = 'none';
                if (this.turnCountdownTimer) { clearInterval(this.turnCountdownTimer); this.turnCountdownTimer = null; }
                return;
            }
            const dueMs = autoMin * 60 * 1000;
            // Normalize SQLite timestamp (UTC without timezone) to ISO UTC
            const createdStr = String(createdAt);
            const normalized = createdStr.includes('T') ? createdStr : (createdStr.replace(' ', 'T') + 'Z');
            const createdMs = Date.parse(normalized);
            if (!Number.isFinite(createdMs) || dueMs <= 0) {
                countdownEl.style.display = 'none';
                if (this.turnCountdownTimer) { clearInterval(this.turnCountdownTimer); this.turnCountdownTimer = null; }
                return;
            }
            const tick = () => {
                const remaining = (createdMs + dueMs) - Date.now();
                if (remaining <= 0) {
                    countdownEl.textContent = 'Next in 00:00';
                } else {
                    const totalSec = Math.floor(remaining / 1000);
                    const m = Math.floor(totalSec / 60);
                    const s = totalSec % 60;
                    const h = Math.floor(m / 60);
                    const mm = (h > 0) ? String(m % 60).padStart(2,'0') : String(m).padStart(2,'0');
                    const ss = String(s).padStart(2,'0');
                    countdownEl.textContent = h > 0 ? `Next in ${h}:${mm}:${ss}` : `Next in ${mm}:${ss}`;
                }
            };
            countdownEl.style.display = '';
            if (this.turnCountdownTimer) clearInterval(this.turnCountdownTimer);
            tick();
            this.turnCountdownTimer = setInterval(tick, 1000);
        } catch {}
    }

    // player panel handled in SFUI.playerPanel

    // player panel handled in SFUI.playerPanel

    // Senate progress persistence helpers
    senateStorageKey() {
        return `senateProgress:${this.gameId}:${this.userId}`;
    }
    loadSenateProgress() {
        try {
            const val = localStorage.getItem(this.senateStorageKey());
            this.senateProgress = Math.min(100, Math.max(0, parseInt(val || '0', 10)));
        } catch { this.senateProgress = 0; }
        this.applySenateProgressToUI();
    }
    saveSenateProgress() {
        try { localStorage.setItem(this.senateStorageKey(), String(this.senateProgress)); } catch {}
    }
    setSenateProgress(pct) {
        this.senateProgress = Math.min(100, Math.max(0, Math.floor(pct)));
        this.saveSenateProgress();
        this.applySenateProgressToUI();
    }
    incrementSenateProgress(delta) {
        const prev = this.senateProgress;
        this.setSenateProgress(prev + delta);
        if (this.senateProgress >= 100) {
            // Trigger Senate modal and reset
            if (typeof showSenateModal === 'function') {
                showSenateModal();
            } else {
                UI.showAlert('Senate session begins. (Feature coming soon)', '🏛️ Senate');
            }
            this.setSenateProgress(0);
        }
    }
    applySenateProgressToUI() {
        const arc = document.getElementById('senateArc');
        const label = document.getElementById('senateProgressLabel');
        const pct = Math.min(100, Math.max(0, this.senateProgress));
        if (arc) {
            // Path length is 100 via pathLength attr; 100 -> 0 offset (full), 0 -> 100 offset (empty)
            const offset = 100 - pct;
            arc.setAttribute('stroke-dashoffset', String(offset));
        }
        if (label) label.textContent = `${pct}%`;
    }

    // Get icon for unit type (including celestial objects)
    getUnitIcon(type) {
        const celestialType = type.celestial_type || type;
        
        const icons = {
            // Ships and stations
            'ship': '🚢',
            'station': '🏭',
            'starbase': '🛰️',
            'storage-structure': '📦',
            'warp-beacon': '🌌',
            'interstellar-gate': '🌀',
            
            // Celestial objects
            'star': '⭐',
            'planet': '🪐',
            'moon': '🌙',
            'belt': '🪨',
            'nebula': '☁️',
            'wormhole': '🌀',
            'jump-gate': '🚪',
            'derelict': '🛸',
            'graviton-sink': '🕳️',
            
            // Legacy/fallback
            'asteroid': '🪨',
            'anomaly': '❓'
        };
        return icons[celestialType] || icons[type] || '⚪';
    }

    // Format archetype for display
    formatArchetype(archetype) {
        const archetypes = {
            'resource-rich': 'Resource Rich ⛏️',
            'asteroid-heavy': 'Asteroid Belt 🪨',
            'nebula': 'Nebula Cloud ☁️',
            'binary-star': 'Binary Star ⭐⭐'
        };
        return archetypes[archetype] || (archetype || 'Unknown');
    }
    // Select a unit
    selectUnit(unitId) {
        // Remove previous selection
        document.querySelectorAll('.unit-item').forEach(item => {
            item.classList.remove('selected');
        });

        // Add selection to new unit
        const unitElement = document.getElementById(`unit-${unitId}`);
        if (unitElement) {
            unitElement.classList.add('selected');
        }

        // Find the unit object
        this.selectedUnit = this.objects.find(obj => obj.id === unitId);
        this.selectedObjectId = unitId; // STAGE B: Track selection by ID
        
        if (this.selectedUnit) {
            // Center camera on selected unit
            this.camera.x = this.selectedUnit.x;
            this.camera.y = this.selectedUnit.y;
            
            // Restore movement path if ship has active movement orders
            this.restoreMovementPath(this.selectedUnit);
            
            // Update unit details panel
            this.updateUnitDetails();
            
            // Re-render map
            this.render();
            
            console.log(`🎯 Selected unit ${this.selectedUnit.meta.name || this.selectedUnit.type} (ID: ${unitId}) at (${this.selectedUnit.x}, ${this.selectedUnit.y})`);
        }
    }

    // Restore movement path data for a selected unit
    restoreMovementPath(unit) {
        if (unit.type !== 'ship') return;
        
        // FIX 3: Handle different movement statuses properly
        if (unit.movementStatus === 'completed') {
            // Ship has reached destination - ensure movementActive is false for completed movements
            if (unit.movementActive) {
                unit.movementActive = false;
                console.log(`✅ Ship ${unit.id} marked movement as inactive (completed)`);
            }
            return; // Don't try to restore completed movements
        }
        
        // Check if the ship has an active movement order that needs path restoration
        if (unit.plannedDestination && unit.movementETA && !unit.movementPath && unit.movementStatus === 'active') {
            // Recalculate path from current position to planned destination
            const currentPath = this.calculateMovementPath(
                unit.x,
                unit.y,
                unit.plannedDestination.x,
                unit.plannedDestination.y
            );
            
            // Only restore if there's still a valid path to the destination
            if (currentPath.length > 1) {
                unit.movementPath = currentPath;
                unit.movementActive = true;
                
                // Preserve server-provided ETA if available, otherwise recalculate
                if (unit.movementETA === undefined) {
                    unit.movementETA = this.calculateETA(currentPath, unit.meta.movementSpeed || 1);
                }
                
                this.addLogEntry(`${unit.meta.name} movement path restored (${currentPath.length - 1} tiles, ETA: ${unit.movementETA}T)`, 'info');
            } else if (unit.plannedDestination) {
                // FIX 3: Ship has reached destination, clear planned destination but keep completed status
                console.log(`🎯 Ship ${unit.id} has reached destination, clearing planned destination`);
                unit.plannedDestination = null;
                unit.movementETA = null;
                unit.movementActive = false;
            }
        }
    }
    async updateUnitDetails() {
        const unit = this.selectedUnit;
        if (!unit) {
            const detailsContainer = document.getElementById('unitDetails');
            if (detailsContainer) detailsContainer.innerHTML = '<div style="text-align: center; color: #666; padding: 20px;">Select a unit to view details</div>';
            return;
        }
        if (!window.AbilityDefs) {
            try { const data = await SFApi.Abilities.list(); window.AbilityDefs = (data && data.abilities) ? data.abilities : {}; } catch { window.AbilityDefs = {}; }
        }
        uiRenderUnitDetails(this, unit, {
            onAction: (action) => {
                if (action === 'set-move-mode') { this.setMoveMode && this.setMoveMode(); return; }
                if (action === 'set-warp-mode') { try { showWarpTargetSelection(this); } catch {} return; }
                if (action === 'show-travel-options') { this.showInterstellarTravelOptions && this.showInterstellarTravelOptions(); return; }
                if (action === 'toggle-mining') { try { SFMining.toggleMining(); } catch {} return; }
                if (action === 'show-cargo') { try { SFCargo.showCargo(); } catch {} return; }
                if (action === 'show-build') { build_showBuildModal(); return; }
            }
        });
        if (unit && unit.meta && unit.meta.cargoCapacity) { try { SFCargo.updateCargoStatus(unit.id); } catch {} }
        const container = document.getElementById('abilityButtons');
        if (container && this.selectedUnit) {
            SFApi.Abilities.cooldowns(this.selectedUnit.id)
                .then(data => {
                    const cooldowns = new Map((data.cooldowns || []).map(c => [c.ability_key, c.available_turn]));
                    const currentTurn = this.gameState?.currentTurn?.turn_number || 1;
                    container.querySelectorAll('button[data-ability]').forEach(btn => {
                        const key = btn.getAttribute('data-ability');
                        const available = cooldowns.get(key);
                        if (available && Number(available) > Number(currentTurn)) {
                            btn.disabled = true;
                            btn.classList.add('sf-btn-disabled');
                            btn.title = (btn.title || '') + ` (Cooldown: ready on turn ${available})`;
                        }
                    });
                }).catch(()=>{});
        }
        if (unit.type === 'ship') {
            this.loadQueueLog(unit.id);
            const clearBtn = document.getElementById('queueClearBtn');
            const refreshBtn = document.getElementById('queueRefreshBtn');
            if (clearBtn) clearBtn.onclick = () => this.clearQueue(unit.id);
            if (refreshBtn) refreshBtn.onclick = () => this.loadQueueLog(unit.id, true);
        }
    }

    // Ability preview ring + hover (delegated)
    previewAbilityRange(abilityKey) { if (window.SFAbilities) return SFAbilities.previewAbilityRange(this, abilityKey); this.abilityPreview = abilityKey; this.render(); }
    clearAbilityPreview() { if (window.SFAbilities) return SFAbilities.clearAbilityPreview(this); }

    // Utility: check if a tile is occupied by any object
    isTileOccupied(x, y) {
        return this.objects?.some?.(o => o.x === x && o.y === y) || false;
    }

    // Generic position-ability hover computation (delegated)
    computePositionAbilityHover(abilityKey, worldX, worldY) { if (window.SFAbilities) return SFAbilities.computePositionAbilityHover(this, abilityKey, worldX, worldY); return null; }

    // Refresh ability cooldowns on-demand (delegated)
    async refreshAbilityCooldowns() { if (window.SFAbilities) return SFAbilities.refreshAbilityCooldowns(this); }

    // Compute effective movement speed client-side for UI only
    getEffectiveMovementSpeed(unit) { return coreGetEffectiveMovementSpeed(unit); }

    // Compute effective scan range for display (includes temporary multiplier hints)
    getEffectiveScanRange(unit) { return coreGetEffectiveScanRange(unit); }

    // Render the game map
    render() {
        if (!this.canvas || !this.objects) return;

        const ctx = this.ctx;
        const canvas = this.canvas;
        
        // Clear canvas
        ctx.fillStyle = '#0a0a1a';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // Calculate visible area
        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;
        const tilesX = Math.ceil(canvas.width / this.tileSize);
        const tilesY = Math.ceil(canvas.height / this.tileSize);
        
        // Draw grid (delegated)
        SFRenderers.grid.drawGrid(ctx, canvas, this.camera, this.tileSize);
        
        // Draw objects
        SFRenderers.objects.drawObjects(ctx, canvas, this.objects, this.camera, this.tileSize, this);
        
        // Draw movement paths for all ships with active movement orders
        SFRenderers.movement.drawMovementPaths.call(
            this,
            ctx,
            canvas,
            this.objects,
            this.userId,
            this.camera,
            this.tileSize,
            this.selectedUnit,
            this.gameState,
            this.trailBuffer
        );
        
        // Draw selection highlight
        this.drawSelection(ctx, centerX, centerY);
        
        // Draw fog of war overlay last for clarity
        if (this.fogEnabled) {
            this.fogOffscreen = SFRenderers.fog.drawFogOfWar(ctx, canvas, this.objects, this.userId, this.camera, this.tileSize, this.fogOffscreen);
        }

        // Render mini-map
        if (this.miniCanvas) {
            // Share main canvas size so viewport calculation is accurate
            this.miniCanvas._mainWidth = canvas.width;
            this.miniCanvas._mainHeight = canvas.height;
            SFMinimap.renderer.renderMiniMap(this.miniCtx, this.miniCanvas, this.objects, this.userId, this.camera, this.tileSize, this.gameState);
        }
    }

    // Queue ability activation (delegated)
    queueAbility(abilityKey) { if (window.SFAbilities) return SFAbilities.queueAbility(this, abilityKey); }

    // Delegates to SFUI.queuePanel when available
    async loadQueueLog(shipId, force) {
        try { const mod = await import('./ui/queue-panel.js'); return mod.loadQueueLog(this, shipId, force); } catch {}
    }
    clearQueue(shipId) { try { const modp = import('./ui/queue-panel.js'); modp.then(mod => mod.clearQueue(this, shipId)); } catch {} }

    // fog-of-war handled in SFRenderers.fog

    // Update sector overview title
    updateSectorOverviewTitle() {
        const titleElement = document.getElementById('sectorOverviewTitle');
        if (titleElement && this.gameState?.sector?.name) {
            titleElement.textContent = `🌌 ${this.gameState.sector.name}`;
        } else if (titleElement) {
            titleElement.textContent = 'Sector Overview';
        }
    }

    // grid handled in SFRenderers.grid

    // Draw objects on the map with proper layering
    drawObjects(ctx, centerX, centerY) {
        // Separate objects by type for proper layering
        const celestialObjects = [];
        const resourceNodes = [];
        const shipObjects = [];
        
        this.objects.forEach(obj => {
            const screenX = centerX + (obj.x - this.camera.x) * this.tileSize;
            const screenY = centerY + (obj.y - this.camera.y) * this.tileSize;
            
            // Only process if on screen (with larger buffer for big celestial objects)
            const buffer = (obj.radius || 1) * this.tileSize + 100; // Extra buffer for large objects
            if (screenX >= -buffer && screenX <= this.canvas.width + buffer &&
                screenY >= -buffer && screenY <= this.canvas.height + buffer) {
                
                if (obj.type === 'resource_node') {
                    resourceNodes.push({ obj, screenX, screenY });
                } else if (this.isCelestialObject(obj)) {
                    celestialObjects.push({ obj, screenX, screenY });
                } else {
                    shipObjects.push({ obj, screenX, screenY });
                }
            }
        });
        
        // Sort celestial objects by size (largest first, so they render behind smaller ones)
        celestialObjects.sort((a, b) => (b.obj.radius || 1) - (a.obj.radius || 1));
        
        // Draw celestial objects first (background layer)
        celestialObjects.forEach(({ obj, screenX, screenY }) => {
            this.drawObject(ctx, obj, screenX, screenY);
        });
        
        // Draw resource nodes (middle layer)
        resourceNodes.forEach(({ obj, screenX, screenY }) => {
            this.drawObject(ctx, obj, screenX, screenY);
        });
        
        // Draw ship objects on top (foreground layer)
        shipObjects.forEach(({ obj, screenX, screenY }) => {
            this.drawObject(ctx, obj, screenX, screenY);
        });
    }

    // Draw a single object with proper celestial scaling
    drawObject(ctx, obj, x, y) {
        const isOwned = obj.owner_id === this.userId;
        const visibility = obj.visibilityStatus || { visible: isOwned, dimmed: false };
        const isCelestial = this.isCelestialObject(obj);
        const isShip = obj.type === 'ship' || obj.type === 'station';
        
        // Calculate actual size based on object radius or default
        let objectRadius = obj.radius || 1;
        let renderSize;
        
        if (isCelestial) {
            // Celestial objects: scale with their actual radius but cap at reasonable screen size
            renderSize = Math.min(objectRadius * this.tileSize, this.tileSize * 50); // Cap at 50 tiles screen size
            
            // Minimum size for visibility
            if (renderSize < this.tileSize * 0.5) {
                renderSize = this.tileSize * 0.5;
            }
        } else {
            // Ships and stations: use standard sizing
            renderSize = this.tileSize * 0.8;
        }
        
        // Determine visual state based on visibility
        let alpha = 1.0;
        let colors = this.getObjectColors(obj, isOwned, visibility, isCelestial);
        
        if (visibility.dimmed) {
            alpha = isCelestial ? 0.6 : 0.4; // Celestials slightly more visible when dimmed
        } else if (visibility.visible && !isOwned) {
            alpha = 0.9;
        }
        
        // Save context for alpha
        ctx.save();
        ctx.globalAlpha = alpha;
        
        // Draw different object types
        if (obj.type === 'resource_node') {
            if (window.SFRenderers && SFRenderers.resource) {
                SFRenderers.resource.drawResourceNode(ctx, obj, x, y, renderSize, colors);
            }
        } else if (isCelestial) {
            if (window.SFRenderers && SFRenderers.celestial) {
                SFRenderers.celestial.drawCelestialObject(ctx, obj, x, y, renderSize, colors, visibility, this);
            }
        } else {
            if (window.SFRenderers && SFRenderers.ship) {
                SFRenderers.ship.drawShipObject(ctx, obj, x, y, renderSize, colors, visibility, isOwned);
            }
        }
        
        // Restore context
        ctx.restore();
    }
    
    // Check if object is a celestial body
    isCelestialObject(obj) {
        const celestialTypes = ['star', 'planet', 'moon', 'belt', 'nebula', 'wormhole', 'jump-gate', 'derelict', 'graviton-sink'];
        return celestialTypes.includes(obj.celestial_type || obj.type);
    }
    
    // Resolve a player's color palette
    getPlayerColors(ownerId) {
        try {
            const players = this.gameState?.players || [];
            const p = players.find(pl => pl.userId === ownerId);
            return {
                primary: p?.colorPrimary || '#4caf50',
                secondary: p?.colorSecondary || 'rgba(76, 175, 80, 1)'
            };
        } catch { return { primary: '#4caf50', secondary: 'rgba(76,175,80,1)' }; }
    }

    // Get colors for different object types
    getObjectColors(obj, isOwned, visibility, isCelestial) {
        if (!isCelestial) {
            const palette = this.getPlayerColors(obj.owner_id);
            if (obj.owner_id) {
                // Use player palette for any owned non-celestial object
                return {
                    border: palette.primary,
                    background: (palette.secondary.startsWith('#') ? this.hexToRgba(palette.secondary, 0.25) : palette.secondary.replace(/\)$|$/, ', 0.25)').replace('rgba(', 'rgba(')),
                    text: '#ffffff'
                };
            }
        }
        
        if (isCelestial) {
            return this.getCelestialColors(obj);
        }
        
        if (visibility.dimmed) {
            return {
                border: '#64b5f6',
                background: 'rgba(100, 181, 246, 0.1)',
                text: '#64b5f6'
            };
        }
        
        if (visibility.visible) {
            return {
                border: '#ff9800',
                background: 'rgba(255, 152, 0, 0.1)',
                text: '#ffffff'
            };
        }
        
        return {
            border: '#666',
            background: 'rgba(255, 255, 255, 0.1)',
            text: '#ffffff'
        };
    }

    // Helper: convert hex color to rgba string with given alpha
    hexToRgba(hex, alpha) {
        try {
            const m = hex.replace('#', '');
            const r = parseInt(m.substring(0, 2), 16);
            const g = parseInt(m.substring(2, 4), 16);
            const b = parseInt(m.substring(4, 6), 16);
            return `rgba(${r}, ${g}, ${b}, ${alpha})`;
        } catch { return hex; }
    }
    
    // Get celestial-specific colors
    getCelestialColors(obj) {
        const type = obj.celestial_type || obj.type;
        
        switch (type) {
            case 'star':
                return {
                    border: '#FFD700',
                    background: 'radial-gradient(circle, rgba(255,215,0,0.8) 0%, rgba(255,140,0,0.4) 50%, rgba(255,69,0,0.2) 100%)',
                    text: '#FFD700',
                    glow: '#FFD700'
                };
            case 'planet':
                const planetType = obj.meta?.type || 'terrestrial';
                if (planetType === 'resource-rich') {
                    return { border: '#8BC34A', background: 'rgba(139, 195, 74, 0.6)', text: '#8BC34A' };
                } else if (planetType === 'gas-giant') {
                    return { border: '#9C27B0', background: 'rgba(156, 39, 176, 0.6)', text: '#9C27B0' };
                }
                return { border: '#795548', background: 'rgba(121, 85, 72, 0.6)', text: '#795548' };
            case 'moon':
                return { border: '#BDBDBD', background: 'rgba(189, 189, 189, 0.5)', text: '#BDBDBD' };
            case 'belt':
                // Use more neutral colors; belts are visualized by their resource nodes, not a bold ring
                return { border: 'rgba(255,255,255,0.08)', background: 'rgba(255, 255, 255, 0.05)', text: '#CCCCCC' };
            case 'nebula':
                return { border: '#E91E63', background: 'rgba(233, 30, 99, 0.4)', text: '#E91E63' };
            case 'wormhole':
            case 'jump-gate':
                return { border: '#9C27B0', background: 'rgba(156, 39, 176, 0.7)', text: '#9C27B0', glow: '#9C27B0' };
            case 'derelict':
                return { border: '#607D8B', background: 'rgba(96, 125, 139, 0.5)', text: '#607D8B' };
            case 'graviton-sink':
                return { border: '#000000', background: 'rgba(0, 0, 0, 0.9)', text: '#FF0000', glow: '#FF0000' };
            default:
                return { border: '#64b5f6', background: 'rgba(100, 181, 246, 0.3)', text: '#64b5f6' };
        }
    }
    
    // Draw celestial objects with special effects
    // Fallback ship/resource/celestial drawing removed; rely on SFRenderers modules only
    // Specialized drawing functions for different celestial types
    drawStar(ctx, x, y, size, colors) {
        // Create radial gradient for star
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, size/2);
        gradient.addColorStop(0, 'rgba(255,215,0,0.9)');
        gradient.addColorStop(0.5, 'rgba(255,140,0,0.6)');
        gradient.addColorStop(1, 'rgba(255,69,0,0.3)');
        
        // Main star body
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(x, y, size/2, 0, Math.PI * 2);
        ctx.fill();
        
        // Star border
        ctx.strokeStyle = colors.border;
        ctx.lineWidth = Math.max(2, size * 0.02);
        ctx.stroke();
        
        // Add sparkle effects for larger stars
        if (size > this.tileSize * 2) {
            this.drawStarSparkles(ctx, x, y, size);
        }
    }
    
    drawPlanet(ctx, x, y, size, colors, meta) {
        // Main planet body
        ctx.fillStyle = colors.background;
        ctx.beginPath();
        ctx.arc(x, y, size/2, 0, Math.PI * 2);
        ctx.fill();
        
        // Planet border
        ctx.strokeStyle = colors.border;
        ctx.lineWidth = Math.max(1, size * 0.015);
        ctx.stroke();
        
        // Add surface features for larger planets
        if (size > this.tileSize * 1.5) {
            this.drawPlanetFeatures(ctx, x, y, size, colors, meta);
        }
    }
    
    drawAsteroidBelt(ctx, x, y, size, colors) {
        // Create a realistic asteroid field with varying densities and sizes
        const centerDistance = Math.sqrt(Math.pow(this.camera.x - x, 2) + Math.pow(this.camera.y - y, 2));
        const isNearby = centerDistance < size * 1.5; // Only show details when close
        
        if (isNearby && this.tileSize > 8) {
            // Detailed view - show individual asteroids
            this.drawDetailedAsteroidField(ctx, x, y, size, colors);
        } else {
            // Distant view - instead of a simple outline, render sparse asteroid hints
            if (size > this.tileSize) {
                this.drawDistantAsteroids(ctx, x, y, size, colors);
            }
            // Optionally, draw a very subtle faint ring just for orientation
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(x, y, size/2, 0, Math.PI * 2);
            ctx.stroke();
        }
    }
    
    drawNebula(ctx, x, y, size, colors) {
        const centerDistance = Math.sqrt(Math.pow(this.camera.x - x, 2) + Math.pow(this.camera.y - y, 2));
        const isNearby = centerDistance < size * 1.2;
        
        if (isNearby && this.tileSize > 6) {
            // Detailed nebula with particle-like effects
            this.drawDetailedNebula(ctx, x, y, size, colors);
        } else {
            // Distant nebula - simple cloud shapes
            this.drawDistantNebula(ctx, x, y, size, colors);
        }
    }
    
    drawDetailedNebula(ctx, x, y, size, colors) {
        // Use object ID for consistent nebula structure
        const objId = this.objects.find(obj => obj.x === x && obj.y === y)?.id || 0;
        const seed = objId * 54321;
        // Resolve base RGB from provided background color once
        const colorMatch = (colors.background || '').match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        const baseR = colorMatch ? colorMatch[1] : '138';
        const baseG = colorMatch ? colorMatch[2] : '43';
        const baseB = colorMatch ? colorMatch[3] : '226';
        
        // Multiple layers of nebula gas
        const layers = [
            { radius: size * 0.6, alpha: 0.15, particles: 30 },
            { radius: size * 0.45, alpha: 0.25, particles: 20 },
            { radius: size * 0.3, alpha: 0.35, particles: 15 },
        ];
        
        layers.forEach((layer, layerIndex) => {
            // Create gradient for this layer
            const gradient = ctx.createRadialGradient(x, y, 0, x, y, layer.radius);
            gradient.addColorStop(0, `rgba(${baseR}, ${baseG}, ${baseB}, ${layer.alpha})`);
            gradient.addColorStop(0.7, `rgba(${baseR}, ${baseG}, ${baseB}, ${layer.alpha * 0.6})`);
            gradient.addColorStop(1, `rgba(${baseR}, ${baseG}, ${baseB}, 0)`);
            
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(x, y, layer.radius, 0, Math.PI * 2);
            ctx.fill();
            
            // Add particle-like details
            if (this.tileSize > 10) {
                ctx.fillStyle = `rgba(${baseR}, ${baseG}, ${baseB}, ${layer.alpha * 1.5})`;
                for (let i = 0; i < layer.particles; i++) {
                    const particleSeed = seed + layerIndex * 100 + i;
                    const angle = ((particleSeed % 628) / 100);
                    const distance = ((particleSeed * 7) % 1000) / 1000 * layer.radius;
                    const particleX = x + Math.cos(angle) * distance;
                    const particleY = y + Math.sin(angle) * distance;
                    const particleSize = 0.5 + ((particleSeed % 20) / 20) * 2;
                    
                    ctx.beginPath();
                    ctx.arc(particleX, particleY, particleSize, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
        });
        
        // Add some brighter "star formation" regions
        if (this.tileSize > 12) {
            const brightSpots = 3 + (seed % 4);
            for (let i = 0; i < brightSpots; i++) {
                const spotSeed = seed + i * 777;
                const angle = ((spotSeed % 628) / 100);
                const distance = ((spotSeed * 3) % 1000) / 1000 * size * 0.4;
                const spotX = x + Math.cos(angle) * distance;
                const spotY = y + Math.sin(angle) * distance;
                const spotSize = 3 + ((spotSeed % 50) / 50) * 8;
                
                const brightGradient = ctx.createRadialGradient(spotX, spotY, 0, spotX, spotY, spotSize);
                brightGradient.addColorStop(0, `rgba(255, 255, 255, 0.3)`);
                brightGradient.addColorStop(0.5, `rgba(${baseR}, ${baseG}, ${baseB}, 0.4)`);
                brightGradient.addColorStop(1, `rgba(${baseR}, ${baseG}, ${baseB}, 0)`);
                
                ctx.fillStyle = brightGradient;
                ctx.beginPath();
                ctx.arc(spotX, spotY, spotSize, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }
    
    drawDistantNebula(ctx, x, y, size, colors) {
        // Simple overlapping circles for distant view
        ctx.fillStyle = colors.background;
        
        const numClouds = Math.max(3, Math.floor(size / this.tileSize / 2));
        for (let i = 0; i < numClouds; i++) {
            const angle = (i / numClouds) * Math.PI * 2;
            const offsetX = Math.cos(angle) * size * 0.25;
            const offsetY = Math.sin(angle) * size * 0.25;
            const cloudSize = size * (0.3 + Math.random() * 0.4);
            
            ctx.beginPath();
            ctx.arc(x + offsetX, y + offsetY, cloudSize/2, 0, Math.PI * 2);
            ctx.fill();
        }
    }
    
    drawWormhole(ctx, x, y, size, colors) {
        // Swirling portal effect
        ctx.strokeStyle = colors.border;
        ctx.lineWidth = Math.max(2, size * 0.03);
        
        // Multiple rings
        for (let i = 0; i < 3; i++) {
            ctx.beginPath();
            ctx.arc(x, y, size/2 - i * size * 0.1, 0, Math.PI * 2);
            ctx.stroke();
        }
        
        // Inner glow
        if (colors.glow) {
            ctx.fillStyle = colors.glow + '33'; // Add transparency
            ctx.beginPath();
            ctx.arc(x, y, size/4, 0, Math.PI * 2);
            ctx.fill();
        }
    }
    
    drawGravitonSink(ctx, x, y, size, colors) {
        // Black hole with accretion disk
        ctx.fillStyle = colors.background;
        ctx.beginPath();
        ctx.arc(x, y, size/2, 0, Math.PI * 2);
        ctx.fill();
        
        // Accretion disk
        ctx.strokeStyle = colors.glow || '#FF0000';
        ctx.lineWidth = Math.max(2, size * 0.02);
        
        for (let i = 1; i <= 3; i++) {
            ctx.beginPath();
            ctx.arc(x, y, size/2 + i * size * 0.1, 0, Math.PI * 2);
            ctx.stroke();
        }
    }
    
    drawGenericCelestial(ctx, x, y, size, colors) {
        // Generic celestial object
        ctx.fillStyle = colors.background;
        ctx.strokeStyle = colors.border;
        ctx.lineWidth = Math.max(1, size * 0.02);
        
        ctx.beginPath();
        ctx.arc(x, y, size/2, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
    }
    
    // Helper functions for visual effects
    drawStarSparkles(ctx, x, y, size) {
        ctx.fillStyle = '#FFFFFF';
        const numSparkles = 8;
        for (let i = 0; i < numSparkles; i++) {
            const angle = (i / numSparkles) * Math.PI * 2;
            const distance = size * 0.6;
            const sparkleX = x + Math.cos(angle) * distance;
            const sparkleY = y + Math.sin(angle) * distance;
            
            ctx.beginPath();
            ctx.arc(sparkleX, sparkleY, 2, 0, Math.PI * 2);
            ctx.fill();
        }
    }
    
    drawPlanetFeatures(ctx, x, y, size, colors, meta) {
        // Simple surface patterns
        ctx.fillStyle = colors.border + '44'; // Semi-transparent
        
        // Add some surface spots/continents
        const numFeatures = 3;
        for (let i = 0; i < numFeatures; i++) {
            const angle = Math.random() * Math.PI * 2;
            const distance = Math.random() * size * 0.3;
            const featureX = x + Math.cos(angle) * distance;
            const featureY = y + Math.sin(angle) * distance;
            const featureSize = size * 0.1 * (0.5 + Math.random() * 0.5);
            
            ctx.beginPath();
            ctx.arc(featureX, featureY, featureSize, 0, Math.PI * 2);
            ctx.fill();
        }
    }
    
    // Draw warp target highlight
    drawWarpTargetHighlight(ctx, x, y, size) {
        const time = Date.now() / 1000;
        const pulse = 0.5 + 0.5 * Math.sin(time * 4); // Faster pulse for warp mode
        
        // Outer glow ring
        ctx.strokeStyle = `rgba(138, 43, 226, ${pulse * 0.8})`; // Purple glow
        ctx.lineWidth = Math.max(3, size * 0.02);
        ctx.setLineDash([10, 5]);
        
        ctx.beginPath();
        ctx.arc(x, y, size/2 + 15, 0, Math.PI * 2);
        ctx.stroke();
        
        // Inner target ring
        ctx.strokeStyle = `rgba(255, 255, 255, ${pulse})`;
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 3]);
        
        ctx.beginPath();
        ctx.arc(x, y, size/2 + 8, 0, Math.PI * 2);
        ctx.stroke();
        
        ctx.setLineDash([]); // Reset line dash
        
        // Warp icon
        if (size > this.tileSize) {
            ctx.fillStyle = `rgba(255, 255, 255, ${pulse})`;
            ctx.font = `${Math.max(12, this.tileSize * 0.3)}px Arial`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('🌌', x, y - size/2 - 20);
        }
    }
    
    // Draw warp preparation effect on ship
    drawWarpPreparationEffect(ctx, ship, x, y, size) {
        const time = Date.now() / 1000;
        const phase = ship.warpPhase;
        const preparationTurns = ship.warpPreparationTurns || 0; // current accumulated turns from server
        const maxPrepTurns = (ship.meta && Number(ship.meta.warpPreparationTurns)) || 2; // blueprint-defined, default 2
        
        if (phase === 'preparing') {
            // Charging effect - intensifies over time
            const intensity = Math.min(1.0, maxPrepTurns ? (preparationTurns / maxPrepTurns) : 1);
            const pulse = 0.3 + 0.7 * Math.sin(time * 6) * intensity;
            
            // Blue energy rings
            ctx.strokeStyle = `rgba(0, 191, 255, ${pulse})`;
            ctx.lineWidth = 3;
            
            for (let i = 0; i < 3; i++) {
                const ringSize = size/2 + 10 + (i * 8) + (Math.sin(time * 3 + i) * 5);
                ctx.beginPath();
                ctx.arc(x, y, ringSize, 0, Math.PI * 2);
                ctx.stroke();
            }
            
            // Central glow
            ctx.shadowColor = '#00BFFF';
            ctx.shadowBlur = 20 * intensity;
            ctx.fillStyle = `rgba(0, 191, 255, ${pulse * 0.3})`;
            ctx.beginPath();
            ctx.arc(x, y, size/2, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;
            
            // Progress indicator
            ctx.fillStyle = '#FFFFFF';
            ctx.font = '12px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText(`Charging ${preparationTurns}/${maxPrepTurns}`, x, y + size/2 + 5);
            
        } else if (phase === 'ready') {
            // Ready to warp - steady bright glow
            ctx.shadowColor = '#FFFFFF';
            ctx.shadowBlur = 25;
            ctx.strokeStyle = '#FFFFFF';
            ctx.lineWidth = 4;
            
            ctx.beginPath();
            ctx.arc(x, y, size/2 + 12, 0, Math.PI * 2);
            ctx.stroke();
            ctx.shadowBlur = 0;
            
            // Ready indicator
            ctx.fillStyle = '#FFFFFF';
            ctx.font = 'bold 12px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText('WARP READY', x, y + size/2 + 5);
        }
    }
    
    // Draw detailed asteroid field when zoomed in
    drawDetailedAsteroidField(ctx, x, y, size, colors) {
        // Use object ID as seed for consistent asteroid positions
        const objId = this.objects.find(obj => obj.x === x && obj.y === y)?.id || 0;
        const seed = objId * 12345; // Simple seed
        
        // Calculate how many asteroids to show based on zoom and size
        const baseCount = Math.floor(size / 30); // Base density
        const zoomFactor = Math.min(2, this.tileSize / 20); // More detail when zoomed in
        const numAsteroids = Math.max(20, Math.floor(baseCount * zoomFactor));
        
        // Create multiple density zones within the belt
        const zones = [
            { radius: size * 0.3, density: 0.8, minSize: 2, maxSize: 8 }, // Inner dense zone
            { radius: size * 0.5, density: 1.0, minSize: 3, maxSize: 12 }, // Main belt
            { radius: size * 0.7, density: 0.6, minSize: 1, maxSize: 6 }, // Outer sparse zone
        ];
        
        zones.forEach((zone, zoneIndex) => {
            const zoneAsteroids = Math.floor(numAsteroids * zone.density / zones.length);
            
            for (let i = 0; i < zoneAsteroids; i++) {
                // Use seeded random for consistent positions
                const randSeed = (seed + zoneIndex * 1000 + i) % 9999;
                const angle = (randSeed % 628) / 100; // 0 to 2π
                const distanceRand = ((randSeed * 7) % 1000) / 1000; // 0 to 1
                
                // Distance within the zone
                const minRadius = zoneIndex === 0 ? 0 : zones[zoneIndex - 1].radius;
                const distance = minRadius + distanceRand * (zone.radius - minRadius);
                
                const asteroidX = x + Math.cos(angle) * distance;
                const asteroidY = y + Math.sin(angle) * distance;
                
                // Varying asteroid sizes
                const sizeRand = ((randSeed * 13) % 1000) / 1000;
                const asteroidSize = zone.minSize + sizeRand * (zone.maxSize - zone.minSize);
                
                // Different asteroid types based on size
                if (asteroidSize > 8) {
                    this.drawLargeAsteroid(ctx, asteroidX, asteroidY, asteroidSize, colors, randSeed);
                } else if (asteroidSize > 4) {
                    this.drawMediumAsteroid(ctx, asteroidX, asteroidY, asteroidSize, colors, randSeed);
                } else {
                    this.drawSmallAsteroid(ctx, asteroidX, asteroidY, asteroidSize, colors);
                }
            }
        });
    }
    
    // Draw different asteroid types
    drawLargeAsteroid(ctx, x, y, size, colors, seed) {
        ctx.fillStyle = colors.border;
        ctx.strokeStyle = colors.text;
        ctx.lineWidth = 1;
        
        // Irregular shape
        const sides = 6 + (seed % 4);
        ctx.beginPath();
        for (let i = 0; i < sides; i++) {
            const angle = (i / sides) * Math.PI * 2;
            const radiusVariation = 0.7 + ((seed * (i + 1)) % 100) / 300; // 0.7 to 1.0
            const radius = size * radiusVariation;
            const px = x + Math.cos(angle) * radius;
            const py = y + Math.sin(angle) * radius;
            
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        
        // Add some surface details
        if (this.tileSize > 15) {
            ctx.fillStyle = colors.text;
            const craters = 2 + (seed % 3);
            for (let i = 0; i < craters; i++) {
                const angle = ((seed * (i + 5)) % 628) / 100;
                const distance = size * 0.3;
                const craterX = x + Math.cos(angle) * distance;
                const craterY = y + Math.sin(angle) * distance;
                const craterSize = size * 0.15;
                
                ctx.beginPath();
                ctx.arc(craterX, craterY, craterSize, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }
    
    drawMediumAsteroid(ctx, x, y, size, colors, seed) {
        ctx.fillStyle = colors.border;
        
        // Slightly irregular circle
        const sides = 5 + (seed % 3);
        ctx.beginPath();
        for (let i = 0; i < sides; i++) {
            const angle = (i / sides) * Math.PI * 2;
            const radiusVariation = 0.8 + ((seed * (i + 2)) % 100) / 500; // 0.8 to 1.0
            const radius = size * radiusVariation;
            const px = x + Math.cos(angle) * radius;
            const py = y + Math.sin(angle) * radius;
            
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
    }
    
    drawSmallAsteroid(ctx, x, y, size, colors) {
        ctx.fillStyle = colors.border;
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fill();
    }
    
    // Draw distant view of asteroids (when zoomed out)
    drawDistantAsteroids(ctx, x, y, size, colors) {
        ctx.fillStyle = colors.border;
        
        const numPoints = Math.max(8, Math.floor(size / this.tileSize / 3));
        for (let i = 0; i < numPoints; i++) {
            const angle = (i / numPoints) * Math.PI * 2 + Math.random() * 0.5;
            const distance = size * 0.35 + Math.random() * size * 0.3;
            const pointX = x + Math.cos(angle) * distance;
            const pointY = y + Math.sin(angle) * distance;
            const pointSize = 0.5 + Math.random() * 1.5;
            
            ctx.beginPath();
            ctx.arc(pointX, pointY, pointSize, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    // Draw selection highlight with ability preview ring if present
    drawSelection(ctx, centerX, centerY) {
        if (!this.selectedUnit) return;
        const unit = this.selectedUnit;
        const screenX = centerX + (unit.x - this.camera.x) * this.tileSize;
        const screenY = centerY + (unit.y - this.camera.y) * this.tileSize;
        const size = this.tileSize;
        
        // Animated selection ring
        const time = Date.now() / 1000;
        const alpha = 0.5 + 0.3 * Math.sin(time * 3);
        ctx.strokeStyle = `rgba(255, 193, 7, ${alpha})`;
        ctx.lineWidth = 3;
        ctx.setLineDash([5, 5]);
        ctx.strokeRect(screenX - size/2 - 5, screenY - size/2 - 5, size + 10, size + 10);
        ctx.setLineDash([]);

        // Ability preview ring
        if (this.abilityPreview && unit?.meta?.abilities?.includes(this.abilityPreview)) {
            const def = (window.AbilityDefs || {})[this.abilityPreview];
            if (def && def.range) {
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
                ctx.lineWidth = 1.5;
                const radiusPx = def.range * this.tileSize;
                ctx.beginPath();
                ctx.arc(screenX, screenY, radiusPx, 0, Math.PI * 2);
                ctx.stroke();

                // Yellow hover dot for any position-target ability while selecting
                if (this.pendingAbility && this.pendingAbility.def?.target === 'position' && this.abilityHover) {
                    const hx = centerX + (Math.round(this.abilityHover.x) - this.camera.x) * this.tileSize;
                    const hy = centerY + (Math.round(this.abilityHover.y) - this.camera.y) * this.tileSize;
                    ctx.beginPath();
                    ctx.fillStyle = this.abilityHover.valid ? 'rgba(255, 235, 59, 0.95)' : 'rgba(255, 82, 82, 0.7)';
                    ctx.arc(hx, hy, Math.max(3, this.tileSize * 0.18), 0, Math.PI * 2);
                    ctx.fill();
                }
            }
        }
    }
    // Render mini-map
    // (delegated to SFMinimap.renderer)

    // One-time binding for minimap click + drag to pan camera
    bindMiniMapInteractions() {
        if (!this.miniCanvas) return;
        if (this._miniBound) return;
        this._miniBound = true;
        this._miniBoundCanvas = this.miniCanvas;
        SFMinimap.interactions.bind(
            this.miniCanvas,
            () => ({ camera: this.camera, tileSize: this.tileSize }),
            (x, y) => { this.camera.x = x; this.camera.y = y; this.render(); }
        );
    }

    // Setup event listeners
    setupEventListeners() {
        SFInput.mouse.bind(this.canvas, this);
        SFInput.keyboard.bind(document, this);
    }

    // Bind DOM controls (migrated from inline onclicks in game.html)
    bindUIControls() {
        try {
            const byId = (id) => document.getElementById(id);
            const safe = (el, fn) => { if (el) el.addEventListener('click', fn); };
            // Top bar
            safe(byId('lockTurnBtn'), () => { try { this.lockCurrentTurn(); } catch {} });
            safe(byId('playersStatusBtn'), async () => { try { const mod = await import('./ui/players-modal.js'); mod.showPlayers(); } catch {} });
            safe(byId('openEncyclopediaBtn'), () => { try { if (typeof openEncyclopedia === 'function') openEncyclopedia(); else UI.showAlert('Encyclopedia coming soon'); } catch {} });
            safe(byId('settingsBtn'), () => { try { if (typeof showSettings === 'function') showSettings(); else UI.showAlert('Settings coming soon'); } catch {} });
            safe(byId('exitGameBtn'), () => { try { if (typeof exitGame === 'function') exitGame(); else window.location.href = '/play'; } catch {} });
            // Map controls
            safe(byId('zoomInBtn'), () => { try { if (typeof zoomIn === 'function') zoomIn(); else { if (this.tileSize < 40) { this.tileSize += 2; this.render(); } } } catch {} });
            safe(byId('zoomOutBtn'), () => { try { if (typeof zoomOut === 'function') zoomOut(); else { if (this.tileSize > 8) { this.tileSize -= 2; this.render(); } } } catch {} });
            safe(byId('floatingMiniBtn'), () => { this.toggleFloatingMiniMap(); });
            safe(byId('openMapBtn'), async () => { try { const mod = await import('./ui/map-ui.js'); mod.openMap(); } catch {} });
            // Player panel actions via modules
            safe(byId('playerAssetsBtn'), async () => { try { const mod = await import('./ui/assets-modal.js'); mod.showAssets(); } catch {} });
            safe(byId('senateBtn'), async () => { try { const mod = await import('./ui/senate.js'); mod.showSenate(); } catch {} });
            // Chat remains in game.html script; button bound there too via SFCargo fallback if needed
        } catch {}
    }

    // Lock the current turn (instance method; replaces global helper)
    lockCurrentTurn() {
        if (!this.gameState?.playerSetup?.setup_completed) {
            this.addLogEntry('Complete system setup before locking turn', 'warning');
            UI.showAlert('Please complete your system setup first!');
            return;
        }
        const currentTurn = this.gameState?.currentTurn?.turn_number || 1;
        if (this.turnLocked) {
            this.addLogEntry('Cannot unlock turn once locked', 'warning');
            return;
        }
        if (this.socket) {
            this.socket.emit('lock-turn', this.gameId, this.userId, currentTurn);
        }
        this.addLogEntry(`Turn ${currentTurn} locked`, 'success');
        const lockBtn = document.getElementById('lockTurnBtn');
        if (lockBtn) {
            lockBtn.textContent = '🔒 Turn Locked';
            lockBtn.classList.add('locked');
        }
        this.turnLocked = true;
    }

    // Tooltips delegated to ui/tooltip.js
    createMapTooltip() { if (this._tooltipEl || !this.canvas) return; this._tooltipEl = SFTooltip.create(this.canvas); }
    updateMapTooltip(obj, mouseX, mouseY) { if (!this._tooltipEl || !this.canvas) return; SFTooltip.update(this._tooltipEl, this.canvas, obj, mouseX, mouseY, this.getOwnerName.bind(this)); }
    hideMapTooltip() { SFTooltip.hide(this._tooltipEl); }

    // Resolve owner name from cache or fallback
    getOwnerName(ownerId) {
        if (!ownerId) return '';
        if (this.playerNameById.has(ownerId)) return this.playerNameById.get(ownerId);
        // Fallback to session user
        if (ownerId === this.userId) return (Session.getUser()?.username) || 'You';
        return `Player ${ownerId}`;
    }

    // Prime player name cache from server if available
    async primePlayerNameCache() {
        try {
            if (!this.socket) return;
            const data = await new Promise((resolve) => {
                this.socket.timeout(4000).emit('players:list', { gameId: this.gameId }, (err, response) => {
                    if (err) resolve({ success: false }); else resolve(response);
                });
            });
            if (data && data.success && Array.isArray(data.players)) {
                data.players.forEach(p => {
                    if (p?.userId) this.playerNameById.set(p.userId, p.username || `Player ${p.userId}`);
                });
            }
        } catch {}
    }

    // Toggle floating minimap within main map area
    toggleFloatingMiniMap() {
        if (!this._floatingMini) {
            const parent = this.canvas.parentElement;
            const container = document.createElement('div');
            container.id = 'floatingMiniWrap';
            container.style.position = 'absolute';
            container.style.zIndex = '2000';
            container.style.border = '1px solid rgba(100,181,246,0.3)';
            container.style.borderRadius = '10px';
            container.style.background = '#0a0f1c';
            container.style.boxShadow = '0 10px 30px rgba(0,0,0,0.35)';
            container.style.pointerEvents = 'auto';
            container.style.overflow = 'hidden';
            container.style.display = 'flex';
            container.style.flexDirection = 'column';
            container.style.boxSizing = 'border-box';
            container.style.resize = 'both';
            container.style.minWidth = '200px';
            container.style.minHeight = '140px';
            // Initial size and position (top/left anchored)
            const initialW = 260, initialH = 180, margin = 12;
            container.style.width = initialW + 'px';
            container.style.height = initialH + 'px';
            container.style.left = margin + 'px';
            const parentH = parent ? parent.clientHeight : 0;
            container.style.top = Math.max(0, parentH - margin - initialH) + 'px';

            // Header used for dragging
            const header = document.createElement('div');
            header.style.height = '26px';
            header.style.background = 'rgba(10, 15, 28, 0.9)';
            header.style.borderBottom = '1px solid rgba(100,181,246,0.3)';
            header.style.display = 'flex';
            header.style.alignItems = 'center';
            header.style.justifyContent = 'space-between';
            header.style.padding = '0 8px';
            header.style.cursor = 'move';
            header.style.userSelect = 'none';
            header.innerHTML = '<span style="font-size:12px;color:#cfe4ff;display:flex;align-items:center;gap:6px"><span style="opacity:0.7">⠿</span> Mini-map</span><button title="Close" style="background:none;border:none;color:#cfe4ff;cursor:pointer;font-size:14px;line-height:1">×</button>';

            const closeBtn = header.querySelector('button');
            closeBtn.addEventListener('click', () => {
                container.style.display = 'none';
            });

            const mini = document.createElement('canvas');
            mini.style.display = 'block';
            mini.style.width = '100%';
            mini.style.height = '100%';
            // Set initial internal size (content area below header)
            mini.width = initialW;
            mini.height = initialH - 26;

            container.appendChild(header);
            container.appendChild(mini);
            parent.appendChild(container);

            const clampWithinParent = () => {
                if (!parent) return;
                const maxLeft = Math.max(0, parent.clientWidth - container.offsetWidth);
                const maxTop = Math.max(0, parent.clientHeight - container.offsetHeight);
                const left = Math.min(Math.max(0, container.offsetLeft), maxLeft);
                const top = Math.min(Math.max(0, container.offsetTop), maxTop);
                container.style.left = left + 'px';
                container.style.top = top + 'px';
            };

            this._floatingMini = { container, header, canvas: mini, ctx: mini.getContext('2d'), dragging: false, dragDX:0, dragDY:0 };

            // Dragging via header
            header.addEventListener('mousedown', (e)=>{
                this._floatingMini.dragging = true;
                this._floatingMini.dragDX = e.clientX - container.offsetLeft;
                this._floatingMini.dragDY = e.clientY - container.offsetTop;
                e.preventDefault();
            });
            window.addEventListener('mousemove', (e)=>{
                const f=this._floatingMini; if (!f||!f.dragging) return;
                const parentRect = parent.getBoundingClientRect();
                let newLeft = e.clientX - f.dragDX;
                let newTop = e.clientY - f.dragDY;
                // Clamp to parent bounds
                newLeft = Math.min(Math.max(0, newLeft), parent.clientWidth - container.offsetWidth);
                newTop = Math.min(Math.max(0, newTop), parent.clientHeight - container.offsetHeight);
                container.style.left = newLeft + 'px';
                container.style.top = newTop + 'px';
            });
            window.addEventListener('mouseup', ()=>{ if (this._floatingMini) this._floatingMini.dragging=false; });

            // Resize observer to keep canvas in sync and keep window in bounds
            const ro = new ResizeObserver(()=>{
                // account for borders (2px total) and header height
                const borderComp = 2; // 1px left + 1px right
                const contentW = Math.max(1, Math.floor(container.clientWidth - borderComp));
                const contentH = Math.max(1, Math.floor(container.clientHeight - header.offsetHeight - borderComp));
                if (mini.width !== contentW || mini.height !== contentH) {
                    mini.width = contentW;
                    mini.height = contentH;
                    this.renderFloatingMini();
                }
                clampWithinParent();
            });
            ro.observe(container);
            this._floatingMini.ro = ro;

            // Ensure initial clamp
            clampWithinParent();
            this.renderFloatingMini();
        } else {
            // Toggle visibility
            const visible = this._floatingMini.container.style.display !== 'none';
            this._floatingMini.container.style.display = visible ? 'none' : 'flex';
            if (!visible) {
                // Re-clamp on reopen
                const parent = this.canvas.parentElement;
                const { container } = this._floatingMini;
                const maxLeft = Math.max(0, parent.clientWidth - container.offsetWidth);
                const maxTop = Math.max(0, parent.clientHeight - container.offsetHeight);
                const left = Math.min(Math.max(0, container.offsetLeft), maxLeft);
                const top = Math.min(Math.max(0, container.offsetTop), maxTop);
                container.style.left = left + 'px';
                container.style.top = top + 'px';
                this.renderFloatingMini();
            }
        }
    }

    renderFloatingMini() {
        // Delegate all floating minimap rendering to the unified minimap renderer
        if (!this._floatingMini || !this.objects) return;
        // Temporarily point miniCanvas to floating canvas for a consistent look
        const { canvas, ctx } = this._floatingMini;
        this.miniCanvas = canvas;
        this.miniCtx = ctx;
        // Ensure interactions are bound to the floating canvas (avoid rebinding if already bound)
        if (this._miniBoundCanvas !== this.miniCanvas) {
            this._miniBound = false;
            this.bindMiniMapInteractions();
        }
        // minimap rendered via SFMinimap.renderer in render()
    }

    // Drag-to-pan state
    startDragPan(e) {
        if (e.button !== 0) return; // left button only
        const rect = this.canvas.getBoundingClientRect();
        this._dragPan = {
            active: true,
            startX: e.clientX - rect.left,
            startY: e.clientY - rect.top,
            cameraX: this.camera.x,
            cameraY: this.camera.y,
            movedEnough: false
        };
        this.canvas.style.cursor = 'grabbing';
    }

    stopDragPan() {
        if (this._dragPan) this._dragPan.active = false;
        this.canvas.style.cursor = 'default';
    }

    handleDragPan(e) {
        if (!this._dragPan || !this._dragPan.active) return;
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const dx = x - this._dragPan.startX;
        const dy = y - this._dragPan.startY;
        // Move camera opposite of mouse movement; scale by tileSize
        const tilesDX = dx / this.tileSize;
        const tilesDY = dy / this.tileSize;
        this.camera.x = Math.max(0, Math.min(5000, this._dragPan.cameraX - tilesDX));
        this.camera.y = Math.max(0, Math.min(5000, this._dragPan.cameraY - tilesDY));
        // mark as moved if drag exceeded a small threshold in pixels
        if (!this._dragPan.movedEnough && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) {
            this._dragPan.movedEnough = true;
        }
        this.render();
        // minimap rendered via SFMinimap.renderer in render()
    }

    // Handle mouse movement for cursor feedback
    handleCanvasMouseMove(e) {
        // Tooltip + cursor feedback works regardless of selection; movement cursor still respects selection
        
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        // Convert screen coordinates to world coordinates
        const centerX = this.canvas.width / 2;
        const centerY = this.canvas.height / 2;
        const worldX = Math.round(this.camera.x + (x - centerX) / this.tileSize);
        const worldY = Math.round(this.camera.y + (y - centerY) / this.tileSize);
        
        // Check what's under the cursor (account for object radius)
        const hoveredObject = this.objects.find(obj => {
            const distance = Math.sqrt(Math.pow(obj.x - worldX, 2) + Math.pow(obj.y - worldY, 2));
            const hitRadius = Math.max(0.5, (obj.radius || 1) * 0.8); // Use object radius for hit detection
            return distance <= hitRadius;
        });
        
        this.updateMapTooltip(hoveredObject, x, y);

        // Ability hover preview for any position-target ability (generic system)
        if (this.pendingAbility && this.selectedUnit) {
            const { key, def } = this.pendingAbility;
            if (def.target === 'position') {
                this.abilityHover = this.computePositionAbilityHover(key, worldX, worldY);
            } else {
                this.abilityHover = null;
            }
        } else {
            this.abilityHover = null;
        }
        // Re-render so the hover dot updates in real time
        this.render();

        if (!this.selectedUnit || this.turnLocked) {
            this.canvas.style.cursor = hoveredObject ? 'pointer' : 'default';
            return;
        }

        if (hoveredObject) {
            this.canvas.style.cursor = hoveredObject.owner_id === this.userId ? 'pointer' : 'crosshair';
        } else if (this.selectedUnit.type === 'ship') {
            this.canvas.style.cursor = 'move';
        } else {
            this.canvas.style.cursor = 'default';
        }
    }

    // Update multi-sector fleet display
    async updateMultiSectorFleet() { const mod = await import('./ui/fleet-list.js'); return mod.updateFleetList(this); }

    // Hook up toolbar events (debounced)
    attachFleetToolbarHandlers() { const modp = import('./ui/fleet-list.js'); modp.then(mod => mod.attachToolbarHandlers(this)); }

    

    // Select a unit (possibly in a remote sector)
    async selectRemoteUnit(unitId, sectorId, sectorName, inCurrentSector) {
        if (inCurrentSector) {
            // Unit is in current sector, select normally
            this.selectUnit(unitId);
        } else {
            // Unit is in remote sector, switch to that sector
            try {
                const data = await SFApi.State.switchSector(this.gameId, this.userId, sectorId);
                if (data) {
                    // Update game state to new sector
                    const preserveCamera = { x: this.camera.x, y: this.camera.y };
                    this.gameState = data.gameState;
                    this.addLogEntry(`Switched to ${sectorName}`, 'info');
                    
                    // Update the UI
                    this.updateUI();
                    this.camera.x = preserveCamera.x;
                    this.camera.y = preserveCamera.y;
                    this.render();
                    // minimap rendered via SFMinimap.renderer in render()
                    this.updateSectorOverviewTitle();
                    
                    // Select the unit in the new sector
                    setTimeout(() => {
                        this.selectUnit(unitId);
                    }, 100);
                }
            } catch (error) {
                console.error('Error switching sectors:', error);
                this.addLogEntry('Failed to switch sectors', 'error');
            }
        }
    }
    // Helpers for left panel chips
    getUnitStatus(meta, unit) { return coreGetUnitStatus(meta, unit); }

    // New: return all active statuses in priority order
    getUnitStatuses(meta, unit) { return coreGetUnitStatuses(meta, unit); }

    getStatusLabel(statusKey) {
        switch (statusKey) {
            case 'attacking': return '⚔️ Attacking';
            case 'stealthed': return '🕶️ Stealthed';
            case 'scanning': return '🔍 Scanning';
            case 'lowFuel': return '⛽ Low Fuel';
            case 'constructing': return '🛠️ Constructing';
            case 'moving': return '➜ Moving';
            case 'mining': return '⛏️ Mining';
            case 'docked': return '⚓ Docked';
            default: return 'Idle';
        }
    }

    getStatusClass(statusKey) {
        switch (statusKey) {
            case 'attacking': return 'status-attacking';
            case 'stealthed': return 'status-stealthed';
            case 'scanning': return 'status-scanning';
            case 'lowFuel': return 'status-lowFuel';
            case 'constructing': return 'status-constructing';
            case 'moving': return 'status-moving';
            case 'mining': return 'status-mining';
            case 'docked': return 'status-docked';
            default: return 'status-idle';
        }
    }

    // Helper to compute inclusive remaining turns with strong guards
    computeRemainingTurns(expiresTurn, currentTurn) {
        const e = Number(expiresTurn);
        const c = Number(currentTurn);
        if (Number.isFinite(e) && Number.isFinite(c)) {
            return Math.max(1, Math.floor(e - c + 1));
        }
        return 1;
    }

    // Escape text for safe use inside HTML attribute values
    escapeAttr(text) {
        try {
            return String(text)
                .replace(/&/g, '&amp;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/\n/g, '&#10;');
        } catch { return ''; }
    }

    // Build an effects chip using authoritative server statusEffects, with meta mirrors as fallback
    renderActiveEffectsChip(unit) {
        try {
            const meta = unit.meta || {};
            const currentTurn = this.gameState?.currentTurn?.turn_number || 0;
            const list = [];
            // 1) Use server-provided statusEffects if present
            if (Array.isArray(unit.statusEffects) && unit.statusEffects.length > 0) {
                for (const eff of unit.statusEffects) {
                    const data = eff.effectData || {};
                    // expiresTurn is inclusive; ensure at least 1 turn remains on the expiry turn
                    const until = this.computeRemainingTurns(eff.expiresTurn, currentTurn);
                    if (eff.effectKey === 'microthruster_speed' || typeof data.movementFlatBonus === 'number') {
                        const amt = data.movementFlatBonus ?? 3;
                        list.push({ name: '+Move', desc: `+${amt} tiles`, turns: until, source: 'Microthruster Shift' });
                    }
                    if (eff.effectKey === 'emergency_discharge_buff' || typeof data.evasionBonus === 'number') {
                        const pct = Math.round((data.evasionBonus ?? 0.5) * 100);
                        list.push({ name: 'Evasion', desc: `+${pct}%`, turns: until, source: 'Emergency Discharge Vent' });
                    }
                    if (eff.effectKey === 'engine_boost' || typeof data.movementBonus === 'number') {
                        const pct = Math.round((data.movementBonus ?? 1.0) * 100);
                        list.push({ name: 'Speed', desc: `+${pct}%`, turns: until, source: 'Engine Boost' });
                    }
                    if (eff.effectKey === 'repair_over_time' || typeof data.healPercentPerTurn === 'number') {
                        const pct = Math.round((data.healPercentPerTurn ?? 0.05) * 100);
                        list.push({ name: 'Regen', desc: `${pct}%/turn`, turns: until, source: 'Jury-Rig Repair' });
                    }
                    if (eff.effectKey === 'survey_scanner' || typeof data.scanRangeMultiplier === 'number') {
                        const mult = data.scanRangeMultiplier ?? 2;
                        list.push({ name: 'Scan', desc: `x${mult}`, turns: until, source: 'Survey Scanner' });
                    }
                    if (eff.effectKey === 'evasion_boost') {
                        const pct = Math.round((data.evasionBonus ?? 0.8) * 100);
                        list.push({ name: 'Evasion', desc: `+${pct}%`, turns: until, source: 'Phantom Burn' });
                    }
                    if (eff.effectKey === 'accuracy_debuff') {
                        const pct = Math.round((data.magnitude ?? eff.magnitude ?? 0.2) * 100);
                        list.push({ name: 'Accuracy', desc: `-${pct}%`, turns: until, source: 'Quarzon Micro-Missiles' });
                    }
                }
            }
            // 2) Passive hint for Solo Miner's Instinct
            if (Array.isArray(meta.abilities) && meta.abilities.includes('solo_miners_instinct')) {
                list.push({ name: '+Move', desc: "+1 tile (Solo Miner's Instinct)", turns: 1, source: 'Passive' });
            }
            // 3) Meta mirrors fallback for immediate client feedback
            if (typeof meta.movementBoostMultiplier === 'number' && meta.movementBoostMultiplier > 1) {
                const pct = Math.round((meta.movementBoostMultiplier - 1) * 100);
                const remain = this.computeRemainingTurns(meta.movementBoostExpires, currentTurn);
                list.push({ name: 'Speed', desc: `+${pct}%`, turns: remain, source: 'Engine Boost' });
            }
            if (typeof meta.scanRangeMultiplier === 'number' && meta.scanRangeMultiplier > 1) {
                const remain = this.computeRemainingTurns(meta.scanBoostExpires, currentTurn);
                list.push({ name: 'Scan', desc: `x${meta.scanRangeMultiplier}`, turns: remain, source: 'Survey Scanner' });
            }
            if (typeof meta.movementFlatBonus === 'number' && meta.movementFlatBonus > 0) {
                const remain = this.computeRemainingTurns(meta.movementFlatExpires, currentTurn);
                list.push({ name: '+Move', desc: `+${meta.movementFlatBonus} tiles`, turns: remain, source: 'Microthruster Shift' });
            }
            if (typeof meta.evasionBonus === 'number' && meta.evasionBonus > 0) {
                const remain = this.computeRemainingTurns(meta.evasionExpires, currentTurn);
                list.push({ name: 'Evasion', desc: `+${Math.round(meta.evasionBonus*100)}%`, turns: remain, source: 'Emergency Discharge Vent' });
            }

            const active = list.filter(e => e.turns > 0);
            if (active.length === 0) return '';
            const tip = active.map(e => `${e.name} ${e.desc} (${e.turns}T) – ${e.source}`).join('\n');
            const safeTip = this.escapeAttr(tip);
            return `<span class=\"chip\" title=\"${safeTip}\">✨ Effects</span>`;
        } catch { return ''; }
    }

    getCargoFill(unit) {
        try {
            const meta = unit.meta ? JSON.parse(unit.meta) : {};
            if (meta.cargoCapacity == null) return null;
            const used = (meta.cargoUsed != null) ? meta.cargoUsed : (meta.cargo?.reduce?.((s,c)=>s + (c.quantity||0), 0) || 0);
            return `${used}/${meta.cargoCapacity}`;
        } catch { return null; }
    }

    getEta(unit) {
        // If movement has eta_turns or can be derived from path length
        if (unit.eta_turns != null) return unit.eta_turns;
        if (unit.movement_path) {
            try { const p = JSON.parse(unit.movement_path); return Array.isArray(p) ? Math.max(1, Math.ceil(p.length / (unit.movement_speed||4))) : null; } catch { return null; }
        }
        return null;
    }

    toggleSectorCollapse(sectorName) {
        const el = document.querySelector(`.sector-header[data-sector="${sectorName}"]`);
        const body = document.getElementById(`sector-units-${this.safeId(sectorName)}`);
        if (!el || !body) return;
        const collapsed = el.classList.toggle('collapsed');
        if (collapsed) { body.style.display = 'none'; } else { body.style.display = 'grid'; }
    }

    safeId(text) {
        return (text || '').replace(/[^a-z0-9]+/gi, '-');
    }

    isFavoriteUnit(unitId) {
        try { const s = localStorage.getItem('favoriteUnits'); if (!s) return false; const set = new Set(JSON.parse(s)); return set.has(unitId); } catch { return false; }
    }

    toggleFavoriteUnit(unitId) {
        try {
            const s = localStorage.getItem('favoriteUnits');
            const arr = s ? JSON.parse(s) : [];
            const set = new Set(arr);
            if (set.has(unitId)) set.delete(unitId); else set.add(unitId);
            localStorage.setItem('favoriteUnits', JSON.stringify([...set]));
            // Refresh list without a full network fetch; reuse last fetched fleet if desired.
            this.updateMultiSectorFleet();
        } catch {
            // no-op
        }
    }

    // Check if a ship is adjacent to an interstellar gate (delegated)
    isAdjacentToInterstellarGate(ship) { return isAdjacentToInterstellarGate(this, ship); }

    // Get adjacent interstellar gates (delegated)
    getAdjacentInterstellarGates(ship) { return getAdjacentInterstellarGates(this, ship); }

    // Handle mouse wheel for zooming
    handleCanvasWheel(e) {
        e.preventDefault(); // Prevent page scroll
        
        const rect = this.canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        
        // Calculate world coordinates before zoom
        const centerX = this.canvas.width / 2;
        const centerY = this.canvas.height / 2;
        const worldX = this.camera.x + (mouseX - centerX) / this.tileSize;
        const worldY = this.camera.y + (mouseY - centerY) / this.tileSize;
        
        // Determine zoom direction
        const zoomIn = e.deltaY < 0;
        const oldTileSize = this.tileSize;
        
        // Apply zoom with limits
        if (zoomIn && this.tileSize < 40) {
            this.tileSize += 2;
        } else if (!zoomIn && this.tileSize > 8) {
            this.tileSize -= 2;
        }
        
        // Adjust camera to keep mouse position centered
        if (this.tileSize !== oldTileSize) {
            const newWorldX = this.camera.x + (mouseX - centerX) / this.tileSize;
            const newWorldY = this.camera.y + (mouseY - centerY) / this.tileSize;
            
            this.camera.x += worldX - newWorldX;
            this.camera.y += worldY - newWorldY;
            
            this.render();
        }
    }

    // Handle canvas clicks (left-click)
    handleCanvasClick(e) {
        // If a drag-pan just occurred, suppress click selection (prevents accidental selects while panning)
        if (this._dragPan && this._dragPan.active === false && this._dragPan.movedEnough) {
            this._dragPan.movedEnough = false; // reset once
            return;
        }
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        // Convert screen coordinates to world coordinates
        const centerX = this.canvas.width / 2;
        const centerY = this.canvas.height / 2;
        const worldX = Math.round(this.camera.x + (x - centerX) / this.tileSize);
        const worldY = Math.round(this.camera.y + (y - centerY) / this.tileSize);
        
        console.log(`Left-clicked world position: (${worldX}, ${worldY})`);
        
        // Check if clicking on an object (account for object radius)
        // For large celestial fields (e.g., belts, nebulae), use a much smaller picking radius unless their exact tile is clicked.
        const clickedObject = this.objects.find(obj => {
            const dx = obj.x - worldX;
            const dy = obj.y - worldY;
            const distance = Math.sqrt(dx*dx + dy*dy);
            const baseRadius = Math.max(0.5, (obj.radius || 1) * 0.8);
            const isLargeField = (obj.celestial_type === 'belt' || obj.celestial_type === 'nebula');
            const pickRadius = isLargeField ? Math.min(baseRadius, 3) : baseRadius;
            return distance <= pickRadius;
        });
        
        // Ability targeting flow first
        if (this.pendingAbility) {
            const { key, def } = this.pendingAbility;
            if (def.target === 'position') {
                // For position-target abilities, allow clicks even if a large-radius object is under the cursor.
                // Only block if the exact tile is occupied or out of range.
                const hover = this.computePositionAbilityHover(key, worldX, worldY);
                if (!hover || !hover.valid) {
                    this.addLogEntry('Invalid destination for ability', 'warning');
                    return;
                }
                this.socket.emit('activate-ability', { gameId: this.gameId, casterId: this.selectedUnit?.id, abilityKey: key, targetX: worldX, targetY: worldY });
                this.addLogEntry(`Queued ${def.name} at (${worldX},${worldY})`, 'info');
                this.pendingAbility = null; this.abilityPreview = null; this.abilityHover = null; this.updateUnitDetails();
                return;
            }
            if ((def.target === 'enemy' || def.target === 'ally') && clickedObject) {
                // Allow queueing even if currently out of range; server will validate after utility phase.
                if (def.range && this.selectedUnit) {
                    const dx = clickedObject.x - this.selectedUnit.x;
                    const dy = clickedObject.y - this.selectedUnit.y;
                    const d = Math.hypot(dx, dy);
                    if (d > def.range) {
                        this.addLogEntry('Target currently out of range; will fire if in range after utility phase.', 'warning');
                    }
                }
                this.socket.emit('activate-ability', { gameId: this.gameId, casterId: this.selectedUnit?.id, abilityKey: key, targetObjectId: clickedObject.id });
                this.addLogEntry(`Queued ${def.name} on ${clickedObject.meta?.name || clickedObject.type}`, 'info');
                this.pendingAbility = null; this.abilityPreview = null; this.abilityHover = null; this.updateUnitDetails();
                return;
            }
            // If target type mismatched, keep waiting
        }
        
        if (clickedObject && this.queueMode && clickedObject.type === 'resource_node' && this.selectedUnit && this.selectedUnit.type === 'ship') {
            // Queue mining: enqueue move to adjacent tile, then harvest_start
            const target = clickedObject;
            const adj = this.getAdjacentTileNear(target.x, target.y, this.selectedUnit.x, this.selectedUnit.y);
            if (adj) {
                this.socket.emit('queue-order', { gameId: this.gameId, shipId: this.selectedUnit.id, orderType: 'move', payload: { destination: { x: adj.x, y: adj.y } } }, () => {});
            }
            this.socket.emit('queue-order', { gameId: this.gameId, shipId: this.selectedUnit.id, orderType: 'harvest_start', payload: { nodeId: target.id } }, (resp) => {
                if (resp && resp.success) this.addLogEntry(`Queued: Mine ${target.meta?.resourceType || 'resource'}`, 'info');
                else this.addLogEntry('Failed to queue mining', 'error');
            });
            return;
        }

        if (clickedObject && clickedObject.owner_id === this.userId) {
            // Select owned unit
            this.selectUnit(clickedObject.id);
            console.log(`Selected unit: ${clickedObject.meta.name || clickedObject.type}`);
        } else if (clickedObject) {
            // Clicked on enemy/neutral object - just show info, don't select
            this.addLogEntry(`Detected ${clickedObject.meta.name || clickedObject.type} (${clickedObject.owner_id === this.userId ? 'Friendly' : 'Enemy'})`, 'info');
        } else {
            // Clicked on empty space - do NOT deselect; selection should persist unless selecting another unit
        }
    }
    
    // Pick an adjacent tile near a target that is closest to current ship position
    getAdjacentTileNear(targetX, targetY, fromX, fromY) {
        const candidates = [
            { x: targetX + 1, y: targetY },
            { x: targetX - 1, y: targetY },
            { x: targetX, y: targetY + 1 },
            { x: targetX, y: targetY - 1 },
        ];
        candidates.sort((a, b) => {
            const da = Math.hypot(a.x - fromX, a.y - fromY);
            const db = Math.hypot(b.x - fromX, b.y - fromY);
            return da - db;
        });
        return candidates[0] || null;
    }
    // Handle canvas right-clicks for movement only (attack removed)
    handleCanvasRightClick(e) {
        if (!this.selectedUnit || this.turnLocked) return;
        if (this.selectedUnit.type !== 'ship') return;
        
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        // Convert screen coordinates to world coordinates
        const centerX = this.canvas.width / 2;
        const centerY = this.canvas.height / 2;
        const worldX = Math.round(this.camera.x + (x - centerX) / this.tileSize);
        const worldY = Math.round(this.camera.y + (y - centerY) / this.tileSize);
        
        // Check if right-clicking on an object (account for object radius)
        const clickedObject = this.objects.find(obj => {
            // Skip large celestial objects for right-click targeting
            if (this.isCelestialObject(obj) && obj.radius > 50) return false;
            const distance = Math.hypot(obj.x - worldX, obj.y - worldY);
            const baseRadius = (obj.radius || 1);
            // Resource nodes get a smaller click hitbox so adjacent tiles remain easy to target
            const hitRadius = obj.type === 'resource_node'
                ? Math.max(0.4, baseRadius * 0.5)
                : Math.max(0.5, baseRadius * 0.8);
            return distance <= hitRadius;
        });
        
        // Special handling: right-clicking a resource node should move adjacent (or queue in queueMode)
        if (clickedObject && clickedObject.type === 'resource_node') {
            const target = clickedObject;
            const adj = this.getAdjacentTileNear(target.x, target.y, this.selectedUnit.x, this.selectedUnit.y);
            if (adj) {
                if (this.queueMode) {
                    this.socket.emit('queue-order', { 
                        gameId: this.gameId, 
                        shipId: this.selectedUnit.id, 
                        orderType: 'move', 
                        payload: { destination: { x: adj.x, y: adj.y } } 
                    }, () => {});
                    // Also queue mining when in queue mode
                    this.socket.emit('queue-order', { 
                        gameId: this.gameId, 
                        shipId: this.selectedUnit.id, 
                        orderType: 'harvest_start', 
                        payload: { nodeId: target.id } 
                    }, () => {});
                    this.addLogEntry(`Queued: Move next to and mine ${target.meta?.resourceType || 'resource'}`, 'info');
                } else {
                    this.handleMoveCommand(adj.x, adj.y);
                }
            } else {
                // Fallback: if we couldn't find an adjacent tile, just move toward the click point
                this.handleMoveCommand(worldX, worldY);
            }
            return;
        }

        if (!clickedObject) {
            // Empty space: move command with path + ETA
            this.handleMoveCommand(worldX, worldY);
            return;
        }

        // Clicking on own unit: select it; on others: ignore (no attack via right-click)
            if (clickedObject.owner_id === this.userId) {
            this.selectUnit(clickedObject.id);
            this.addLogEntry(`Selected ${clickedObject.meta?.name || clickedObject.type}`, 'info');
            } else {
            this.addLogEntry('Use an ability to target enemies', 'info');
        }
    }

    // Handle move command (right-click on empty space)
    handleMoveCommand(worldX, worldY) {
        if (!this.selectedUnit || this.selectedUnit.type !== 'ship') {
            this.addLogEntry('Only ships can be moved', 'warning');
            return;
        }
        
        console.log(`🚢 handleMoveCommand: Ship ${this.selectedUnit.id} at (${this.selectedUnit.x}, ${this.selectedUnit.y}) moving to (${worldX}, ${worldY})`);
        
        // PHASE 3: Always calculate movement path from ship's CURRENT position (not original)
        const movementPath = this.calculateMovementPath(
            this.selectedUnit.x, // Use actual current position from server
            this.selectedUnit.y, 
            worldX, 
            worldY
        );
        
        console.log(`📍 PHASE 3: Movement path calculated from CURRENT position (${this.selectedUnit.x},${this.selectedUnit.y}) to (${worldX},${worldY})`);
        
        if (movementPath.length > 1) {
            // If queue mode, enqueue instead of immediate move
            if (this.queueMode) {
                this.socket.emit('queue-order', {
                    gameId: this.gameId,
                    shipId: this.selectedUnit.id,
                    orderType: 'move',
                    payload: { destination: { x: worldX, y: worldY } }
                }, (resp) => {
                    if (resp && resp.success) {
                        this.addLogEntry(`Queued: Move to (${worldX}, ${worldY})`, 'info');
                    } else {
                        this.addLogEntry(`Failed to queue move: ${resp?.error || 'error'}`, 'error');
                    }
                });
                return;
            }
            const eta = this.calculateETA(movementPath, this.selectedUnit.meta.movementSpeed || 1);
            
            // PHASE 2: Create accurate lingering trail from actual movement history
            const wasMoving = this.selectedUnit.movementPath !== null;
            if (wasMoving && this.selectedUnit.movementPath && this.selectedUnit.movementPath.length > 1) {
                const currentTurn = this.gameState?.currentTurn?.turn_number || 1;
                
                // Fetch actual movement history for this ship (async, but don't wait)
                this.fetchMovementHistory(this.selectedUnit.id, 10).then(history => {
                    if (history.length > 0) {
                        // Create accurate lingering trail from actual movement segments
                        const actualSegments = history
                            .filter(h => h.shipId === this.selectedUnit.id)
                            .sort((a, b) => a.turnNumber - b.turnNumber)
                            .map(h => h.segment);
                        
                        if (actualSegments.length > 0) {
                            const accurateLingeringTrail = {
                                id: `accurate-lingering-${this.selectedUnit.id}-${currentTurn}`,
                                shipId: this.selectedUnit.id,
                                movementSegments: actualSegments, // PHASE 2: Use actual segments instead of planned path
                                owner_id: this.selectedUnit.owner_id,
                                meta: { ...this.selectedUnit.meta },
                                x: this.selectedUnit.x,
                                y: this.selectedUnit.y,
                                movementStatus: 'completed',
                                type: 'ship',
                                visibilityStatus: this.selectedUnit.visibilityStatus,
                                createdAt: Date.now(),
                                createdOnTurn: currentTurn,
                                isAccurate: true // Flag to distinguish from fallback trails
                            };
                            
                            this.clientLingeringTrails.push(accurateLingeringTrail);
                            console.log(`📍 Created ACCURATE lingering trail for redirected ship ${this.selectedUnit.id} with ${actualSegments.length} real segments`);
                        }
                    }
                });
                
                // Create immediate fallback trail for instant feedback (will be replaced by accurate one)
                const fallbackTrail = {
                    id: `fallback-lingering-${this.selectedUnit.id}-${Date.now()}`,
                    shipId: this.selectedUnit.id,
                    movementPath: [...this.selectedUnit.movementPath], // Fallback: use planned path
                    owner_id: this.selectedUnit.owner_id,
                    meta: { ...this.selectedUnit.meta },
                    x: this.selectedUnit.x,
                    y: this.selectedUnit.y,
                    movementStatus: 'completed',
                    type: 'ship',
                    visibilityStatus: this.selectedUnit.visibilityStatus,
                    createdAt: Date.now(),
                    createdOnTurn: currentTurn,
                    isAccurate: false // Fallback trail
                };
                
                this.clientLingeringTrails.push(fallbackTrail);
                console.log(`👻 Created fallback lingering trail for redirected ship ${this.selectedUnit.id} (will be replaced by accurate trail)`);
                this.addLogEntry(`${this.selectedUnit.meta.name} new route: previous path will fade as lingering trail`, 'info');
                
                // Cleanup old trails  
                this.clientLingeringTrails = this.clientLingeringTrails
                    .filter(trail => currentTurn - trail.createdOnTurn < 10) // 10 turns max
                    .slice(-20); // Keep max 20 total trails
            }
            
            // Clear movement data for new path
            this.selectedUnit.movementPath = null;
            this.selectedUnit.movementActive = false;
            this.selectedUnit.plannedDestination = null;
            this.selectedUnit.movementETA = null;
            
            // Set new movement data
            this.selectedUnit.movementPath = movementPath;
            this.selectedUnit.plannedDestination = { x: worldX, y: worldY };
            this.selectedUnit.movementETA = eta;
            this.selectedUnit.movementActive = true; // Flag for persistent rendering
            this.selectedUnit.movementStatus = 'active'; // FIX 1: Set status for immediate rendering
            
            // Re-render to show the path
            this.render();
            
            console.log(`📍 Movement path calculated: ${movementPath.length - 1} tiles from (${this.selectedUnit.x},${this.selectedUnit.y}) to (${worldX},${worldY})`);
            this.addLogEntry(`${this.selectedUnit.meta.name} ordered to move: ${movementPath.length - 1} tiles, ETA: ${eta} turns`, 'info');
            
            // Send move command to server with explicit current position
            this.socket.emit('move-ship', {
                gameId: this.gameId,
                shipId: this.selectedUnit.id,
                currentX: this.selectedUnit.x,
                currentY: this.selectedUnit.y,
                destinationX: worldX,
                destinationY: worldY,
                movementPath: movementPath,
                estimatedTurns: eta
            });

            // Immediately refresh fleet list so the status chip updates
            this.updateMultiSectorFleet();
        } else {
            this.addLogEntry('Invalid movement destination', 'warning');
        }
    }

    // Attack flow removed; use ability selection instead

    // Handle keyboard input
    handleKeyboard(e) {
        switch(e.key) {
            case 'Escape':
                // Do not clear selection with Escape anymore to keep selection persistent
                break;
            case 'Shift':
                this.queueMode = true;
                break;
                
            case '1':
            case '2':
            case '3':
            case '4':
            case '5':
                const unitIndex = parseInt(e.key) - 1;
                if (this.units[unitIndex]) {
                    this.selectUnit(this.units[unitIndex].id);
                }
                break;
        }
    }

    handleKeyUp(e) {
        if (e.key === 'Shift') {
            this.queueMode = false;
        }
    }

    // Movement helpers
    calculateMovementPath(startX, startY, endX, endY) { return coreCalculateMovementPath(startX, startY, endX, endY); }

    calculateETA(path, movementSpeed) { return coreCalculateETA(path, movementSpeed, this.selectedUnit, this.gameState); }

    // (delegated to SFRenderers.movement)
    // (delegated to SFRenderers.movement)


    
    // Show warp confirmation dialog (delegated)
    showWarpConfirmation(target) { return showWarpConfirmation(this, target); }
    
    // Execute warp order (delegated)
    executeWarpOrder(target) { return executeWarpOrder(this, target); }
    
    // Enter warp target selection mode - delegated
    enterWarpMode() { return enterWarpMode(this); }
    
    // Show warp target selection popup (delegated)
    showWarpTargetSelection() { return showWarpTargetSelection(this); }
    
    // Get all available warp targets for a ship (delegated)
    getWarpTargets(ship) { return getWarpTargets(this, ship); }
    // Get icon for warp target type (delegated)
    getWarpTargetIcon(target) { return getWarpTargetIcon(target); }
    
    // Get readable type name for warp target (delegated)
    getWarpTargetType(target) { return getWarpTargetType(this, target); }
    
    // Exit warp target selection mode
    exitWarpMode() {
        this.warpMode = false;
        this.warpTargets = [];
        this.canvas.style.cursor = 'default';
        
        // Re-render to remove warp highlights
        this.render();
    }

    // Add entry to activity log
    addLogEntry(message, type = 'info') {
        const logContainer = document.getElementById('activityLog');
        const entry = document.createElement('div');
        entry.className = `log-entry ${type}`;
        entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
        
        logContainer.appendChild(entry);
        logContainer.scrollTop = logContainer.scrollHeight;
        
        // Keep only last 50 entries
        const entries = logContainer.querySelectorAll('.log-entry');
        if (entries.length > 50) {
            entries[0].remove();
        }
    }

    // setup modal handled in SFUI.setupModal
}

// Players modal: show all players, lock status, and online status
async function showPlayersModal() {
    if (!gameClient || !gameClient.socket) {
        console.warn('[PlayersModal] Aborting: gameClient or socket not ready', {
            hasGameClient: !!gameClient,
            hasSocket: !!(gameClient && gameClient.socket)
        });
        return;
    }

    try {
        console.debug('[PlayersModal] Requesting players list...', {
            gameId: gameClient.gameId,
            socketConnected: !!(gameClient.socket && gameClient.socket.connected)
        });
        const data = await new Promise((resolve) => {
            gameClient.socket.timeout(4000).emit('players:list', { gameId: gameClient.gameId }, (err, response) => {
                if (err) {
                    console.error('[PlayersModal] Socket ack error:', err);
                    resolve({ success: false, error: 'Timeout' });
                } else {
                    resolve(response);
                }
            });
        });

        console.debug('[PlayersModal] Response:', data);
        if (!data || !data.success) {
            UI.showAlert(data?.error || 'Failed to load players');
            return;
        }

        const players = data.players || [];
        const currentTurn = data.currentTurn;
        console.debug(`[PlayersModal] Players received: count=${players.length}`, players.map(p => ({ userId: p.userId, username: p.username, avatar: p.avatar, colorPrimary: p.colorPrimary, colorSecondary: p.colorSecondary, locked: p.locked, online: p.online })));
        if (players.length === 0) {
            console.warn('[PlayersModal] No players returned for game', gameClient.gameId);
        }

        const container = document.createElement('div');
        container.innerHTML = `
            <div class="form-section">
                <h3>Players (Turn ${currentTurn})</h3>
                <div style="display:grid; gap:10px;">
                    ${players.map(p => {
                        const avatarSrc = p.avatar ? `assets/avatars/${p.avatar}.png` : 'assets/avatars/explorer.png';
                        const borderColor = p.colorPrimary || '#64b5f6';
                        return `
                        <div class=\"asset-item\" style=\"display:flex; align-items:center; justify-content:space-between;\">
                            <div style=\"display:flex; align-items:center; gap:10px;\">
                                <img src=\"${avatarSrc}\" alt=\"avatar\" data-avatar=\"1\" style=\"width:36px; height:36px; border-radius:50%; border:2px solid ${borderColor}; object-fit:cover;\">
                                <div>
                                    <div class=\"asset-name\">${p.username || 'Player ' + p.userId}</div>
                                    <div class=\"asset-position\" style=\"display:flex; gap:10px;\">
                                        <span title=\"Online status\">${renderPresence(p)}</span>
                                        <span title=\"Turn lock status\">${p.locked ? '🔒 Locked' : '🔓 Unlocked'}</span>
                                    </div>
                                </div>
                            </div>
                            <div style=\"text-align:right; color:#888; font-size:0.85em;\">
                                <!-- Future: government, relations, etc. -->
                                <div>Gov: —</div>
                                <div>Relation: —</div>
                            </div>
                        </div>`;
                    }).join('')}
                </div>
            </div>
        `;

        UI.showModal({
            title: '👥 Players',
            content: container,
            actions: [
                { text: 'Close', style: 'primary', action: () => true }
            ]
        });
        container.querySelectorAll('img[data-avatar]')?.forEach(img => {
            img.addEventListener('error', () => { img.src = 'assets/avatars/explorer.png'; });
        });
    } catch (e) {
        console.error('Error showing players modal:', e);
        UI.showAlert('Failed to load players');
    }
}

// Global game instance
let gameClient = null;

// Initialize game
async function initializeGame(gameId) {
    gameClient = new GameClient();
    // Expose to feature modules (IIFE) that access window.gameClient
    if (typeof window !== 'undefined') { window.gameClient = gameClient; }
    await gameClient.initialize(gameId);
    // Start idle heartbeat to report activity for presence
    try {
        if (gameClient?.socket) {
            let lastEvent = Date.now();
            ['mousemove','keydown','mousedown','touchstart','wheel'].forEach(evt => {
                window.addEventListener(evt, () => { lastEvent = Date.now(); });
            });
            setInterval(() => {
                // Only send if we had user input in the last 10s to reduce noise
                if (Date.now() - lastEvent < 10000) {
                    gameClient.socket.emit('client:activity');
                }
            }, 15000);
        }
    } catch {}
}

// Global functions for HTML event handlers
function selectUnit(unitId) {
    if (gameClient) gameClient.selectUnit(unitId);
}
function toggleTurnLock() {
    if (!gameClient) return;
    
    // Check if setup is completed
    if (!gameClient.gameState?.playerSetup?.setup_completed) {
        gameClient.addLogEntry('Complete system setup before locking turn', 'warning');
        UI.showAlert('Please complete your system setup first!');
        return;
    }
    
    const currentTurn = gameClient.gameState?.currentTurn?.turn_number || 1;
    
    if (gameClient.turnLocked) {
        // TODO: Unlock turn
        gameClient.addLogEntry('Cannot unlock turn once locked', 'warning');
    } else {
        gameClient.socket.emit('lock-turn', gameClient.gameId, gameClient.userId, currentTurn);
        gameClient.addLogEntry(`Turn ${currentTurn} locked`, 'success');
    }
}

function zoomIn() {
    if (gameClient && gameClient.tileSize < 40) {
        gameClient.tileSize += 2;
        gameClient.render();
    }
}

function zoomOut() {
    if (gameClient && gameClient.tileSize > 8) {
        gameClient.tileSize -= 2;
        gameClient.render();
    }
}

function centerOnSelected() {
    if (gameClient && gameClient.selectedUnit) {
        gameClient.camera.x = gameClient.selectedUnit.x;
        gameClient.camera.y = gameClient.selectedUnit.y;
        gameClient.render();
    }
}

// Relative time formatter used in Players modal
function timeAgo(isoString) {
    try {
        const then = new Date(isoString).getTime();
        const now = Date.now();
        const seconds = Math.max(0, Math.floor((now - then) / 1000));
        const units = [
            ['year', 31536000],
            ['month', 2592000],
            ['week', 604800],
            ['day', 86400],
            ['hour', 3600],
            ['minute', 60],
            ['second', 1],
        ];
        for (const [name, secs] of units) {
            if (seconds >= secs) {
                const value = Math.floor(seconds / secs);
                return `${value} ${name}${value !== 1 ? 's' : ''} ago`;
            }
        }
        return 'just now';
    } catch (e) {
        return '';
    }
}

function renderPresence(p){
    const now = Date.now();
    const lastSeen = p.lastSeenAt ? new Date(p.lastSeenAt).getTime() : 0;
    const lastActivity = p.lastActivityAt ? new Date(p.lastActivityAt).getTime() : lastSeen;
    const idleMs = now - lastActivity;
    if (p.online) {
        if (idleMs >= 180000) { // 3 minutes
            return `🟠 Idle · ${timeAgo(new Date(now - idleMs).toISOString())}`;
        }
        return '🟢 Online';
    }
    return `⚪ Offline${p.lastSeenAt ? ' · seen ' + timeAgo(p.lastSeenAt) : ''}`;
}

function setMoveMode() {
    if (gameClient && gameClient.selectedUnit && gameClient.selectedUnit.type === 'ship') {
        gameClient.addLogEntry('Click on map to set destination', 'info');
        // Enable visual feedback that we're in movement mode
        gameClient.canvas.style.cursor = 'crosshair';
        
        // Temporarily highlight the selected ship
        gameClient.render();
    } else if (gameClient) {
        gameClient.addLogEntry('Select a ship first', 'warning');
    }
}

function setWarpMode() {
    if (gameClient && gameClient.selectedUnit && gameClient.selectedUnit.type === 'ship') {
        // Check if ship is already warping
        if (gameClient.selectedUnit.warpPhase) {
            gameClient.addLogEntry(`${gameClient.selectedUnit.meta.name} is already preparing for warp`, 'warning');
            return;
        }
        
        // Check if ship is moving (more robust validation)
        const unit = gameClient.selectedUnit;
        
        // Only consider ship as moving if movement status is explicitly 'active'
        // Ignore stale movementActive flags if status is not active
        const hasActiveMovement = unit.movementStatus === 'active';
        
        // Debug logging to help diagnose the issue
        console.log('🌌 Warp validation check:', {
            shipName: unit.meta.name,
            movementStatus: unit.movementStatus,
            movementActive: unit.movementActive,
            hasActiveMovement: hasActiveMovement,
            hasMovementPath: unit.movementPath && unit.movementPath.length > 0
        });
        
        if (hasActiveMovement) {
            gameClient.addLogEntry(`Cannot warp while ship is moving.`, 'warning');
            return;
        }
        
        // Clear any stale movementActive flag if status is not active
        if (unit.movementActive && unit.movementStatus !== 'active') {
            console.log('🧹 Clearing stale movementActive flag');
            unit.movementActive = false;
        }
        
        gameClient.enterWarpMode();
    } else if (gameClient) {
        gameClient.addLogEntry('Select a ship first', 'warning');
    }
}

// Active scan removed; abilities now drive scanning via buffs like 'survey_scanner'.

// Show build modal with tabbed interface
async function showBuildModal() { return build_showBuildModal(); }

// Render the Shipyard UI inside the build modal
async function renderShipyard(selectedStation, cargo) { return build_renderShipyard(selectedStation, cargo); }

// Switch between build tabs
function switchBuildTab(tabName) { return build_switchBuildTab(tabName); }

// Build a ship
async function buildShip(shipType, cost) { return build_buildShip(shipType, cost); }

// Build a structure (as cargo item)
async function buildStructure(structureType, cost) { return build_buildStructure(structureType, cost); }

// Build a test Explorer for 1 rock
async function buildBasicExplorer(cost) { return build_buildBasicExplorer(cost); }

// Deploy a structure from ship cargo
async function deployStructure(structureType, shipId) { return build_deployStructure(structureType, shipId); }

// Show sector selection modal for interstellar gate deployment
async function showSectorSelectionModal(shipId) { return build_showSectorSelectionModal(shipId); }

// Deploy interstellar gate with selected destination sector
async function deployInterstellarGate(shipId, destinationSectorId, destinationSectorName) { return build_deployInterstellarGate(shipId, destinationSectorId, destinationSectorName); }

// Show interstellar travel options
function showInterstellarTravelOptions() {
    if (!gameClient || !gameClient.selectedUnit) {
        gameClient?.addLogEntry('No ship selected', 'warning');
        return;
    }

    const ship = gameClient.selectedUnit;
    const adjacentGates = gameClient.getAdjacentInterstellarGates(ship);
    
    if (adjacentGates.length === 0) {
        gameClient.addLogEntry('No interstellar gates adjacent to ship', 'warning');
        return;
    }

    // Create travel options modal
    const travelModal = document.createElement('div');
    travelModal.className = 'interstellar-travel-modal';
    travelModal.innerHTML = `
        <div class="travel-header">
            <h3>🌀 Interstellar Travel</h3>
            <p>Select a gate to travel through:</p>
        </div>
        
        <div class="gate-list">
            ${adjacentGates.map(gate => {
                const gateMeta = gate.meta || {};
                return `
                    <div class="gate-option" data-action="travel-gate" data-gate-id="${gate.id}" data-destination-name="${gateMeta.destinationSectorName || 'Unknown Sector'}">
                        <div class="gate-info">
                            <div class="gate-name">🌀 ${gateMeta.name || 'Interstellar Gate'}</div>
                            <div class="gate-destination">
                                Destination: ${gateMeta.destinationSectorName || 'Unknown Sector'}
                            </div>
                        </div>
                        <div class="gate-action">
                            <button class="travel-btn">Travel</button>
                        </div>
                    </div>
                `;
            }).join('')}
        </div>
    `;

    UI.showModal({
        title: '🌀 Interstellar Travel',
        content: travelModal,
        actions: [
            {
                text: 'Cancel',
                style: 'secondary',
                action: () => true
            }
        ],
        className: 'interstellar-travel-modal-container'
    });
    // Delegate travel clicks
    travelModal.addEventListener('click', (e) => {
        const row = e.target.closest('[data-action="travel-gate"]');
        if (row) {
            const gateId = Number(row.dataset.gateId);
            const destName = row.dataset.destinationName || 'Unknown Sector';
            travelThroughGate(gateId, destName);
        }
    });
}

// Travel through an interstellar gate
async function travelThroughGate(gateId, destinationName) {
    if (!gameClient || !gameClient.selectedUnit) {
        gameClient?.addLogEntry('No ship selected', 'warning');
        return;
    }

    try {
        const data = await SFApi.Travel.interstellarTravel(gameClient.selectedUnit.id, gateId, gameClient.userId);
        if (data) {
            gameClient.addLogEntry(`${gameClient.selectedUnit.meta.name} traveled to ${destinationName}!`, 'success');
            UI.closeModal();
            
            // The ship has moved to a different sector, so we need to refresh the entire game state
            gameClient.socket.emit('get-game-state', { gameId: gameClient.gameId, userId: gameClient.userId });
        }

    } catch (error) {
        console.error('Error traveling through gate:', error);
        gameClient.addLogEntry(error?.data?.error || 'Failed to travel through gate', 'error');
    }
}

function upgradeBase() {
    if (gameClient) {
        gameClient.addLogEntry('Base upgrades not yet implemented', 'warning');
        // TODO: Implement base upgrades
    }
}

// Mining and cargo management functions
async function toggleMining() {
    if (!gameClient || !gameClient.selectedUnit) {
        gameClient?.addLogEntry('No ship selected', 'warning');
        return;
    }
    
    const ship = gameClient.selectedUnit;
    
    if (ship.harvestingStatus === 'active') {
        // Stop mining
        gameClient.socket.emit('stop-harvesting', {
            gameId: gameClient.gameId,
            shipId: ship.id
        });
    } else {
        // Start mining - delegate to module if available
        try { SFMining.showResourceSelection(ship.id); } catch {}
    }
}

async function showResourceSelection(shipId) {
    try {
        const data = await SFApi.Resources.listNearbyNodes(gameClient.gameId, shipId, gameClient.userId);
        
        if (data.resourceNodes.length === 0) {
            gameClient.addLogEntry('No mineable resources nearby. Move closer to asteroid rocks, gas clouds, or other resources.', 'warning');
            return;
        }
        
        // Create resource selection modal
        const resourceList = document.createElement('div');
        resourceList.className = 'resource-selection-list';
        
        const header = document.createElement('div');
        header.innerHTML = `
            <h3>⛏️ Select Resource to Mine</h3>
            <p>Choose which resource node to harvest:</p>
        `;
        resourceList.appendChild(header);
        
        data.resourceNodes.forEach(node => {
            const resourceOption = document.createElement('div');
            resourceOption.className = 'resource-option';
            
            resourceOption.innerHTML = `
                <div class="resource-info">
                    <div class="resource-name">
                        ${node.icon_emoji} ${node.resource_name}
                    </div>
                    <div class="resource-details">
                        <span class="resource-amount">${node.resource_amount} available</span>
                        <span class="resource-distance">${node.distance} tile${node.distance !== 1 ? 's' : ''} away</span>
                    </div>
                </div>
                <div class="resource-action">
                    <button class="mine-select-btn">Mine</button>
                </div>
            `;
            
            const mineBtn = resourceOption.querySelector('.mine-select-btn');
            mineBtn.addEventListener('click', () => {
                try { SFMining.startMining(shipId, node.id, node.resource_name); } catch {}
                UI.closeModal();
            });
            
            resourceList.appendChild(resourceOption);
        });
        
        UI.showModal({
            title: '⛏️ Mining Target Selection',
            content: resourceList,
            actions: [
                {
                    text: 'Cancel',
                    style: 'secondary',
                    action: () => true
                }
            ],
            className: 'resource-selection-modal'
        });
        
    } catch (error) {
        console.error('Error getting resource nodes:', error);
        gameClient.addLogEntry('Failed to get nearby resources', 'error');
    }
}

function startMining(shipId, resourceNodeId, resourceName) {
    if (gameClient.queueMode) {
        gameClient.socket.emit('queue-order', {
            gameId: gameClient.gameId,
            shipId: shipId,
            orderType: 'harvest_start',
            payload: { nodeId: resourceNodeId }
        }, (resp) => {
            if (resp && resp.success) {
                gameClient.addLogEntry(`Queued: Start mining ${resourceName}`, 'info');
            } else {
                gameClient.addLogEntry(`Failed to queue mining: ${resp?.error || 'error'}`, 'error');
            }
        });
    } else {
        gameClient.socket.emit('start-harvesting', {
            gameId: gameClient.gameId,
            shipId: shipId,
            resourceNodeId: resourceNodeId
        });
        gameClient.addLogEntry(`Starting to mine ${resourceName}...`, 'info');
    }
}
async function showCargo() {
    if (!gameClient || !gameClient.selectedUnit) {
        gameClient?.addLogEntry('No unit selected', 'warning');
        return;
    }
    
    const selectedUnit = gameClient.selectedUnit;
    const unitType = selectedUnit.type === 'ship' ? 'Ship' : 'Structure';
    
    try {
        const data = await SFApi.Cargo.getCargo(selectedUnit.id, gameClient.userId);
        const cargo = data.cargo;
        
        // Find adjacent objects for transfer options (allow public cargo cans not owned by you)
        const adjacentObjects = gameClient.gameState.objects.filter(obj => {
            if (obj.id === selectedUnit.id) return false;
            
            const dx = Math.abs(obj.x - selectedUnit.x);
            const dy = Math.abs(obj.y - selectedUnit.y);
            if (!(dx <= 1 && dy <= 1 && !(dx === 0 && dy === 0))) return false;
            // Show own objects or public-access objects (e.g., jettisoned cargo cans)
            if (obj.owner_id === gameClient.userId) return true;
            try { const m = obj.meta || {}; return !!m.publicAccess; } catch { return false; }
        });
        
        // Create cargo display modal
        const cargoDisplay = document.createElement('div');
        cargoDisplay.className = 'cargo-display';
        
        const header = document.createElement('div');
        header.innerHTML = `
            <h3>📦 ${unitType} Cargo</h3>
            <div class="cargo-summary">
                <div class="capacity-bar">
                    <div class="capacity-fill" style="width: ${(cargo.spaceUsed / cargo.capacity) * 100}%"></div>
                    <span class="capacity-text">${cargo.spaceUsed}/${cargo.capacity} units</span>
                </div>
            </div>
        `;
        cargoDisplay.appendChild(header);
        
        // Show transfer options if adjacent objects exist
        if (adjacentObjects.length > 0) {
            const transferSection = document.createElement('div');
            transferSection.className = 'transfer-section';
            transferSection.innerHTML = `
                <h4>🔄 Transfer Options</h4>
                <p>Adjacent units available for resource transfer:</p>
            `;
            
            adjacentObjects.forEach(obj => {
                const transferBtn = document.createElement('button');
                transferBtn.className = 'transfer-target-btn';
                transferBtn.innerHTML = `${gameClient.getUnitIcon(obj.type)} ${obj.meta.name || obj.type} (${obj.x}, ${obj.y})`;
                transferBtn.onclick = () => { try { SFCargo.showTransferModal(selectedUnit.id, obj.id, obj.meta.name || obj.type); } catch {} };
                transferSection.appendChild(transferBtn);
            });
            
            cargoDisplay.appendChild(transferSection);
        }
        
        if (cargo.items.length === 0) {
            const emptyMessage = document.createElement('div');
            emptyMessage.className = 'cargo-empty';
            emptyMessage.innerHTML = '<p>🚫 Cargo hold is empty</p>';
            cargoDisplay.appendChild(emptyMessage);
        } else {
            cargo.items.forEach(item => {
                const cargoItem = document.createElement('div');
                cargoItem.className = 'cargo-item';
                
                // Check if item is deployable structure
                const isDeployable = item.category === 'structure' && selectedUnit.type === 'ship';
                
                cargoItem.innerHTML = `
                    <div class="cargo-item-info">
                        <span class="cargo-icon" style="color: ${item.color_hex}">${item.icon_emoji}</span>
                        <div class="cargo-details">
                            <div class="cargo-name">${item.resource_name}</div>
                            <div class="cargo-stats">
                                ${item.quantity} units (${item.quantity * item.base_size} space)
                            </div>
                        </div>
                    </div>
                    <div class="cargo-actions">
                        <div class="cargo-value">
                            Value: ${item.quantity * (item.base_value || 1)}
                        </div>
                        ${isDeployable ? `
                            <button class="deploy-btn" data-action="deploy-structure" data-resource="${item.resource_name}" data-ship-id="${selectedUnit.id}">🚀 Deploy</button>
                        ` : ''}
                    </div>
                `;
                
                cargoDisplay.appendChild(cargoItem);
            });
        }
        
        UI.showModal({
            title: `📦 ${unitType} Cargo`,
            content: cargoDisplay,
            actions: [
                {
                    text: 'Close',
                    style: 'primary',
                    action: () => true
                }
            ],
            className: 'cargo-modal'
        });
        cargoDisplay.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-action="deploy-structure"]');
            if (btn) {
                const res = btn.dataset.resource; const sId = Number(btn.dataset.shipId);
                return build_deployStructure(res, sId);
            }
        });
        
    } catch (error) {
        console.error('Error getting cargo:', error);
        gameClient.addLogEntry('Failed to get cargo information', 'error');
    }
}

// Show transfer modal for resource transfers between objects
async function showTransferModal(fromObjectId, toObjectId, toObjectName) {
    try {
        // Get cargo from source and destination
        const [fromData, toData] = await Promise.all([
            SFApi.Cargo.getCargo(fromObjectId, gameClient.userId),
            SFApi.Cargo.getCargo(toObjectId, gameClient.userId)
        ]);

        const fromCargo = fromData.cargo;
        const toCargo = toData.cargo;
        
        // Create transfer modal
        const transferDisplay = document.createElement('div');
        transferDisplay.className = 'transfer-display';
        
        const header = document.createElement('div');
        header.innerHTML = `
            <h3>🔄 Transfer Resources</h3>
            <p>Between selected object and: <strong>${toObjectName}</strong></p>
        `;
        transferDisplay.appendChild(header);
        
        // Section: From selected -> to target
        const toSectionTitle = document.createElement('h4'); toSectionTitle.textContent = `Send to ${toObjectName}`; transferDisplay.appendChild(toSectionTitle);
        fromCargo.items.forEach(item => {
            const transferItem = document.createElement('div');
            transferItem.className = 'transfer-item';
            
            transferItem.innerHTML = `
                <div class="transfer-item-info">
                    <span class="cargo-icon" style="color: ${item.color_hex}">${item.icon_emoji}</span>
                    <div class="transfer-details">
                        <div class="transfer-name">${item.resource_name}</div>
                        <div class="transfer-available">Available: ${item.quantity} units</div>
                    </div>
                </div>
                <div class="transfer-controls">
                    <input type="number" class="transfer-quantity" min="1" max="${item.quantity}" value="1" id="transfer-${item.resource_name}">
                    <button class="transfer-btn" data-action="transfer" data-from-id="${fromObjectId}" data-to-id="${toObjectId}" data-resource="${item.resource_name}" data-input-id="transfer-${item.resource_name}" data-to-name="${toObjectName}">
                        Transfer
                    </button>
                </div>
            `;
            
            transferDisplay.appendChild(transferItem);
        });
        
        // Section: From target -> to selected (for public cans etc.)
        if (toCargo.items && toCargo.items.length > 0) {
            const fromSectionTitle = document.createElement('h4'); fromSectionTitle.textContent = `Take from ${toObjectName}`; transferDisplay.appendChild(fromSectionTitle);
            toCargo.items.forEach(item => {
                const transferItem = document.createElement('div');
                transferItem.className = 'transfer-item';
                transferItem.innerHTML = `
                    <div class="transfer-item-info">
                        <span class="cargo-icon" style="color: ${item.color_hex}">${item.icon_emoji}</span>
                        <div class="transfer-details">
                            <div class="transfer-name">${item.resource_name}</div>
                            <div class="transfer-available">Available: ${item.quantity} units</div>
                        </div>
                    </div>
                    <div class="transfer-controls">
                        <input type="number" class="transfer-quantity" min="1" max="${item.quantity}" value="1" id="transfer-from-${item.resource_name}">
                        <button class="transfer-btn" data-action="transfer" data-from-id="${toObjectId}" data-to-id="${fromObjectId}" data-resource="${item.resource_name}" data-input-id="transfer-from-${item.resource_name}" data-to-name="Selected">
                            Transfer
                        </button>
                    </div>
                `;
                transferDisplay.appendChild(transferItem);
            });
        }
        
        UI.showModal({
            title: '🔄 Transfer Resources',
            content: transferDisplay,
            actions: [
                {
                    text: 'Cancel',
                    style: 'secondary',
                    action: () => true
                }
            ],
            className: 'transfer-modal'
        });
        transferDisplay.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-action="transfer"]');
            if (!btn) return;
            const fromId = Number(btn.dataset.fromId);
            const toId = Number(btn.dataset.toId);
            const res = btn.dataset.resource; const inputId = btn.dataset.inputId; const toName = btn.dataset.toName || 'Target';
            const qty = document.getElementById(inputId)?.value;
            try { SFCargo.performTransfer(fromId, toId, res, qty, toName); } catch {}
        });
        
    } catch (error) {
        console.error('Error showing transfer modal:', error);
        gameClient.addLogEntry('Failed to show transfer options', 'error');
    }
}

// Perform resource transfer
async function performTransfer(fromObjectId, toObjectId, resourceName, quantity, toObjectName) {
    const transferQuantity = parseInt(quantity);
    
    if (!transferQuantity || transferQuantity <= 0) {
        gameClient.addLogEntry('Invalid transfer quantity', 'warning');
        return;
    }
    
    try {
        const result = await SFApi.Cargo.transfer(parseInt(fromObjectId), parseInt(toObjectId), resourceName, transferQuantity, gameClient.userId);
        if (result && result.success) {
            gameClient.addLogEntry(`Successfully transferred ${transferQuantity} ${resourceName} to ${toObjectName}`, 'success');
            UI.closeModal();
            if (gameClient.selectedUnit && gameClient.selectedUnit.id === fromObjectId) {
                setTimeout(() => showCargo(), 100);
            }
        } else {
            gameClient.addLogEntry((result && result.error) || 'Transfer failed', 'error');
        }
    } catch (error) {
        console.error('Error performing transfer:', error);
        gameClient.addLogEntry((error && error.data && error.data.error) || 'Failed to transfer resources', 'error');
    }
}

// Update cargo status in unit panel
async function updateCargoStatus(shipId) {
    try {
        const data = await SFApi.Cargo.getCargo(shipId, gameClient.userId);
        const cargoElement = document.getElementById('cargoStatus');
        if (cargoElement) {
            const cargo = data.cargo;
            const percentFull = Math.round((cargo.spaceUsed / cargo.capacity) * 100);
            cargoElement.innerHTML = `${cargo.spaceUsed}/${cargo.capacity} (${percentFull}%)`;
            cargoElement.style.color = percentFull >= 90 ? '#FF5722' : percentFull >= 70 ? '#FF9800' : '#4CAF50';
        }
    } catch (error) {
        console.error('Error updating cargo status:', error);
    }
}

// Map modal functions
 

// Populate the System Facts panel (type, mineral ratios, unique, wildcards, gate slots)
async function populateSystemFacts() {
    try {
        const wrap = document.getElementById('sysMetaSummary');
        if (!wrap || !gameClient?.gameState?.sector) return;
        const sector = gameClient.gameState.sector;
        const systemId = sector.id;
        // Fetch server-side computed facts (we can implement the endpoint later; for now, build from client data if present)
        let facts = null;
        try { facts = await SFApi.State.systemFacts(systemId); } catch {}
        if (!facts) {
            // Fallback: compute basic surface facts from objects we have
            const all = gameClient.objects || [];
            const planets = all.filter(o => (o.celestial_type === 'planet'));
            const belts = all.filter(o => o.celestial_type === 'belt');
            const nebulas = all.filter(o => o.celestial_type === 'nebula');
            // Dummy mineral model: ratios for rock/gas/energy based on counts
            const rock = Math.max(1, belts.length * 3);
            const gas = Math.max(1, nebulas.length * 2);
            const energy = Math.max(1, planets.length);
            const total = rock + gas + energy;
            const pct = (n) => `${Math.round((n / total) * 100)}%`;
            const systemType = sector.archetype || 'standard';
            const unique = (systemType === 'aurora-veil') ? ['aurorium','veil-crystal'] : (systemType === 'iron-forge') ? ['ferrox','slagite'] : ['cryo-ice','dust-opal'];
            const wildcards = ['platinum','titanium','silicates'];
            const gateSlots = typeof sector.gateSlots === 'number' ? sector.gateSlots : 3;
            const usedGates = typeof sector.gatesUsed === 'number' ? sector.gatesUsed : 0;
            facts = {
                name: sector.name,
                type: systemType,
                ratios: { rock: pct(rock), gas: pct(gas), energy: pct(energy) },
                unique,
                wildcards,
                gateSlots,
                gatesUsed: usedGates
            };
        }
        wrap.innerHTML = `
            <div><b>Name:</b> ${facts.name || sector.name}</div>
            <div><b>Type:</b> ${facts.type || sector.archetype || 'standard'}</div>
            <div style="margin-top:8px;"><b>Core Mineral Bias</b></div>
            <div>
                • Ferrite Alloy: x${(facts.coreBias?.Ferrite || facts.coreBias?.FerriteAlloy || '1.00')}<br/>
                • Crytite: x${(facts.coreBias?.Crytite || '1.00')}<br/>
                • Ardanium: x${(facts.coreBias?.Ardanium || '1.00')}<br/>
                • Vornite: x${(facts.coreBias?.Vornite || '1.00')}<br/>
                • Zerothium: x${(facts.coreBias?.Zerothium || '1.00')}
            </div>
            <div style="margin-top:8px;"><b>Themed Minerals</b></div>
            <div>${(facts.themed || facts.unique || []).join(', ') || '—'}</div>
            <div style="margin-top:8px;"><b>Minor Minerals</b></div>
            <div>${(facts.minor || facts.wildcards || []).join(', ') || '—'}</div>
            <div style="margin-top:8px;"><b>Gate Slots</b></div>
            <div>${facts.gatesUsed || 0} / ${facts.gateSlots || 3}</div>
        `;
    } catch (e) {
        const wrap = document.getElementById('sysMetaSummary');
        if (wrap) wrap.innerText = 'Failed to load system facts';
    }
}

 

 

/* moved to ui/map-modal.js */
async function loadGalaxyData() {
    try {
        // For now, just show the current game's systems
        // In the future, this could fetch data from multiple games/sectors
        const galaxyList = document.getElementById('galaxySystemsList');
        if (!galaxyList || !gameClient) return;
        
        // Mock galaxy data - in the future this would come from server
        const currentSystem = {
            name: gameClient.gameState?.sector?.name || 'Current System',
            id: gameClient.gameId,
            players: 1,
            status: 'Active',
            turn: gameClient.gameState?.turn?.number || 1,
            celestialObjects: gameClient.objects ? gameClient.objects.filter(obj => gameClient.isCelestialObject(obj)).length : 0
        };
        
        galaxyList.innerHTML = `
            <div class="galaxy-system-card" onclick="selectGalaxySystem(${currentSystem.id})">
                <div class="galaxy-system-name">${currentSystem.name}</div>
                <div class="galaxy-system-info">
                    <div>👥 ${currentSystem.players} Player${currentSystem.players !== 1 ? 's' : ''}</div>
                    <div>⏰ Turn ${currentSystem.turn}</div>
                    <div>🌌 ${currentSystem.celestialObjects} Celestial Objects</div>
                    <div>📊 Status: <span style="color: #4CAF50;">${currentSystem.status}</span></div>
                </div>
            </div>
            <div class="galaxy-system-card" style="opacity: 0.5; cursor: not-allowed;">
                <div class="galaxy-system-name">Distant Systems</div>
                <div class="galaxy-system-info">
                    <div style="color: #888;">🚧 Coming Soon</div>
                    <div style="color: #666; font-size: 0.8em;">Multi-system gameplay will be available in future updates</div>
                </div>
            </div>
        `;
        
    } catch (error) {
        console.error('Error loading galaxy data:', error);
        const galaxyList = document.getElementById('galaxySystemsList');
        if (galaxyList) {
            galaxyList.innerHTML = `
                <div style="text-align: center; color: #f44336; padding: 40px;">
                    ❌ Failed to load galaxy data
                </div>
            `;
        }
    }
}

/* moved to ui/map-modal.js */
function selectGalaxySystem(systemId) {
    if (systemId === gameClient.gameId) {
        // Switch to solar system tab for current system
        switchMapTab('solar-system');
        document.querySelector('.map-tab[onclick="switchMapTab(\'solar-system\')"]').click();
    } else {
        // Future: Navigate to different system
        gameClient.addLogEntry('Multi-system navigation coming soon!', 'info');
    }
}
// Show comprehensive player assets modal
/* moved to ui/assets-modal.js */
async function showPlayerAssets() {
    if (!gameClient || !gameClient.gameState) {
        gameClient?.addLogEntry('Game state not available', 'warning');
        return;
    }
    
    try {
        // Get all player-owned objects (ships and structures)
        const playerObjects = gameClient.gameState.objects.filter(obj => obj.owner_id === gameClient.userId);
        
        if (playerObjects.length === 0) {
            UI.showAlert('No assets found');
            return;
        }
        
        // Create assets display
        const assetsDisplay = document.createElement('div');
        assetsDisplay.className = 'player-assets-display';
        
        // Group objects by system (for now we only have one system, but structure for future)
        const systemName = gameClient.gameState.sector.name || 'Your System';
        
        const systemSection = document.createElement('div');
        systemSection.className = 'assets-system-section';
        systemSection.innerHTML = `<h3>🌌 ${systemName}</h3>`;
        
        // Get cargo data for each object
        const assetPromises = playerObjects.map(async (obj) => {
            let cargoData = null;
            
            // Try to get cargo data (works for ships, will be extended for structures)
            try {
                const data = await SFApi.Cargo.getCargo(obj.id, gameClient.userId);
                if (data) {
                    cargoData = data.cargo;
                }
            } catch (error) {
                // Cargo not available for this object type yet
            }
            
            return { obj, cargoData };
        });
        
        const assetsWithCargo = await Promise.all(assetPromises);
        
        // Display each asset
        assetsWithCargo.forEach(({ obj, cargoData }) => {
            const assetItem = document.createElement('div');
            assetItem.className = 'asset-item';
            
            const icon = gameClient.getUnitIcon(obj.type);
            const name = obj.meta.name || obj.type;
            const position = `(${obj.x}, ${obj.y})`;
            
            let cargoInfo = '';
            if (cargoData && cargoData.items.length > 0) {
                const cargoSummary = cargoData.items.map(item => 
                    `${item.icon_emoji} ${item.quantity} ${item.resource_name}`
                ).join(', ');
                cargoInfo = `<div class="asset-cargo">📦 ${cargoSummary}</div>`;
            } else if (cargoData) {
                cargoInfo = '<div class="asset-cargo">📦 Empty cargo hold</div>';
            }
            
            assetItem.innerHTML = `
                <div class="asset-header">
                    <span class="asset-name">${icon} ${name}</span>
                    <span class="asset-position">${position}</span>
                </div>
                ${cargoInfo}
            `;
            
            systemSection.appendChild(assetItem);
        });
        
        assetsDisplay.appendChild(systemSection);
        
        // Calculate total resources
        const totalResources = new Map();
        assetsWithCargo.forEach(({ cargoData }) => {
            if (cargoData && cargoData.items) {
                cargoData.items.forEach(item => {
                    const existing = totalResources.get(item.resource_name) || 0;
                    totalResources.set(item.resource_name, existing + item.quantity);
                });
            }
        });
        
        // Add resource summary
        if (totalResources.size > 0) {
            const summarySection = document.createElement('div');
            summarySection.className = 'assets-summary-section';
            summarySection.innerHTML = '<h3>📊 Total Resources</h3>';
            
            const summaryGrid = document.createElement('div');
            summaryGrid.className = 'resource-summary-grid';
            
            totalResources.forEach((quantity, resourceName) => {
                const resourceItem = document.createElement('div');
                resourceItem.className = 'resource-summary-item';
                resourceItem.innerHTML = `
                    <span class="resource-name">${resourceName}</span>
                    <span class="resource-quantity">${quantity}</span>
                `;
                summaryGrid.appendChild(resourceItem);
            });
            
            summarySection.appendChild(summaryGrid);
            assetsDisplay.appendChild(summarySection);
        }
        
        // Show modal
        UI.showModal({
            title: '📊 Player Assets',
            content: assetsDisplay,
            actions: [
                {
                    text: 'Close',
                    style: 'primary',
                    action: () => true
                }
            ],
            className: 'player-assets-modal'
        });
        
    } catch (error) {
        console.error('Error showing player assets:', error);
        gameClient.addLogEntry('Failed to load player assets', 'error');
    }
} 

// Basic Senate modal stub (to be expanded later)
/* moved to ui/senate.js */
function showSenateModal() {
    const content = document.createElement('div');
    content.innerHTML = `
        <div style="display:grid; gap:12px;">
            <p>Government management is coming soon.</p>
            <ul style="margin-left:16px; color:#ccc; line-height:1.6;">
                <li>Propose and vote on laws</li>
                <li>Manage senators and political factions</li>
                <li>Diplomacy and interstellar policies</li>
            </ul>
        </div>
    `;
    UI.showModal({
        title: '🏛️ Senate',
        content,
        actions: [ { text: 'Close', style: 'secondary', action: () => true } ]
    });
}