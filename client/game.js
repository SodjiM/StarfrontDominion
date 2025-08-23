// Starfront: Dominion - Game Client Logic

import * as SFMining from './features/mining.js';
import * as UICargo from './ui/cargo-modal.js';
import { normalizeGameState, getEffectiveMovementSpeed as coreGetEffectiveMovementSpeed, getEffectiveScanRange as coreGetEffectiveScanRange, getUnitStatus as coreGetUnitStatus, getUnitStatuses as coreGetUnitStatuses } from './core/GameState.js';
import { calculateMovementPath as coreCalculateMovementPath, calculateETA as coreCalculateETA } from './core/Movement.js';
import * as MoveCtl from './features/movement-controller.js';
import * as QueueCtl from './features/queue-controller.js';
import { loadGameState as stateLoadGameState } from './services/state.js';
import * as SenateUI from './ui/senate.js';
import * as SelectionSvc from './services/selection.js';
import * as TravelUI from './ui/travel-modal.js';
import { renderUnitDetails as uiRenderUnitDetails } from './ui/UnitDetails.js';
import { connectSocket as netConnectSocket } from './net/socket.js';
import { fetchSectorTrails as trailsFetchSectorTrails, handleLingeringTrailsOnTurn, applyTurnTrails } from './features/Trails.js';
import { renderObjects as renderMapObjects } from './render/objects.js';
import { drawSelection as renderSelectionOverlay } from './render/selection.js';
import { updateTopbar as uiUpdateTopbar, updateSectorOverviewTitle as uiUpdateSectorOverviewTitle } from './ui/topbar.js';
import { computeRemainingTurns as utilComputeRemainingTurns } from './utils/turns.js';
import { escapeAttr as utilEscapeAttr } from './utils/dom.js';
import { getUnitIcon as uiGetUnitIcon, formatArchetype as uiFormatArchetype } from './ui/icons.js';
import { addLogEntry as uiAddLogEntry } from './ui/log.js';
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
import { showBuildModal as build_showBuildModal } from './features/build.js';

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
        this._els = {}; // Simple DOM cache for common elements
    }

    // Helper to run logic only when gameState is available
    withState(fn) {
        const state = this.gameState;
        if (!state) return;
        return fn(state);
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
        SenateUI.loadSenateProgress(this);
        
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

    // (Removed) handleMovementUpdate was unused with atomic turn resolution

    // Load game state from server (delegated)
    async loadGameState() { return stateLoadGameState(this); }

    // PHASE 2: Fetch movement history from server for accurate trail rendering (delegated)
    async fetchMovementHistory(shipId = null, turns = 10) { const mod = await import('./services/history.js'); return mod.fetchMovementHistory(this, shipId, turns); }

    // Update UI elements with game state
    async updateUI() {
        return this.withState(async () => {

        // Check if setup is needed (prevent normal UI until setup complete)
        if (!this.gameState.playerSetup?.setup_completed) {
            try { const mod = await import('./ui/setup-modal.js'); mod.showSetupModal(this); } catch {}
            return; // Don't show game UI until setup complete
        }

        // Topbar (turn, title, lock, countdown)
        uiUpdateTopbar(this);
        
        // Update player panel
        try { const mod = await import('./ui/player-panel.js'); mod.updatePlayerPanel(this); } catch {}
        
        // Update sector overview title
        uiUpdateSectorOverviewTitle(this);
        
        // Update turn lock status
        const lockBtn = (this._els.lockTurnBtn || (this._els.lockTurnBtn = document.getElementById('lockTurnBtn')));
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
        SenateUI.applySenateProgressToUI(this);
        
        // Get player objects for selection logic
        const allPlayerObjects = this.gameState.objects.filter(obj => obj.owner_id === this.userId);
        const playerObjects = allPlayerObjects.filter((obj, index, array) => 
            array.findIndex(duplicate => duplicate.id === obj.id) === index
        );
        
        // Apply lingering trails for this turn and cleanup
        applyTurnTrails(this);
        
        // Update previous movement statuses for next comparison
        SelectionSvc.updatePreviousMovementStatuses(this);
        
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
        SelectionSvc.applySelectionPersistence(this, playerObjects);
    });
    }

    // Countdown moved to ui/topbar.js

    // player panel handled in SFUI.playerPanel

    // player panel handled in SFUI.playerPanel

    // Senate progress persistence helpers
    // Senate helpers moved to ui/senate.js

    // Get icon for unit type (delegated)
    getUnitIcon(type) { return uiGetUnitIcon(type); }

    // Format archetype for display (delegated)
    formatArchetype(archetype) { return uiFormatArchetype(archetype); }
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

    // Restore movement path data for a selected unit (delegated)
    restoreMovementPath(unit) { return MoveCtl.restoreMovementPath(this, unit); }
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
                if (action === 'show-cargo') { try { UICargo.showCargo(this); } catch {} return; }
                if (action === 'show-build') { build_showBuildModal(); return; }
                if (action === 'queue-refresh' && unit?.type === 'ship') { this.loadQueueLog && this.loadQueueLog(unit.id, true); return; }
                if (action === 'queue-clear' && unit?.type === 'ship') { this.clearQueue && this.clearQueue(unit.id); return; }
            }
        });
        if (unit && unit.meta && unit.meta.cargoCapacity) { try { UICargo.updateCargoStatus(this, unit.id); } catch {} }
        // ability cooldown UI handled in ui/UnitDetails.js
        // Queue buttons moved to UnitDetails view with data-action handlers
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
        
        // Draw objects via renderer orchestrator
        renderMapObjects(this, ctx, canvas);
        
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
        renderSelectionOverlay(this, ctx, centerX, centerY);
        
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

    // Sector overview title moved to ui/topbar.js

    // grid handled in SFRenderers.grid

    // Draw objects moved to render/objects.js

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
    
    // Color helpers moved to render/colors.js
    
    // Draw celestial objects with special effects
    // Fallback ship/resource/celestial drawing removed; rely on SFRenderers modules only
    // Specialized drawing functions for different celestial types
    // Celestial draw helpers moved to render/celestial-renderer.js
    
    // Warp visuals moved to features/warp.js
    

    // Selection overlay moved to render/selection.js
    // Render mini-map
    // (delegated to SFMinimap.renderer)

    // One-time binding for minimap click + drag to pan camera
    bindMiniMapInteractions() {
        if (!this.miniCanvas || this._miniBound) return;
        this._miniBound = true; this._miniBoundCanvas = this.miniCanvas;
        SFMinimap.interactions.bind(this.miniCanvas, () => ({ camera: this.camera, tileSize: this.tileSize }), (x, y) => { this.camera.x = x; this.camera.y = y; this.render(); });
    }

    // Setup event listeners
    setupEventListeners() {
        try {
            const mod = require('./input/canvas.js');
            if (mod && typeof mod.bindCanvasInputs === 'function') mod.bindCanvasInputs(this);
        } catch {
            import('./input/canvas.js').then(mod => mod.bindCanvasInputs(this));
        }
        try {
            const kb = require('./input/keyboard.js');
            if (kb && typeof kb.bind === 'function') kb.bind(document, this);
        } catch {
            import('./input/keyboard.js').then(kb => kb.bind(document, this));
        }
    }

    // Bind DOM controls (migrated from inline onclicks in game.html)
    bindUIControls() {
        try { const mod = require('./ui/controls.js'); if (mod && typeof mod.bindControls === 'function') mod.bindControls(this); }
        catch { import('./ui/controls.js').then(mod => mod.bindControls(this)); }
    }

    // Lock or unlock the current turn (toggle)
    lockCurrentTurn() {
        if (!this.gameState?.playerSetup?.setup_completed) {
            this.addLogEntry('Complete system setup before locking turn', 'warning');
            UI.showAlert('Please complete your system setup first!');
            return;
        }
        const currentTurn = this.gameState?.currentTurn?.turn_number || 1;
        if (this.socket) {
            if (this.turnLocked) {
                this.socket.emit('unlock-turn', this.gameId, this.userId, currentTurn);
                this.addLogEntry(`Turn ${currentTurn} unlocked`, 'info');
            } else {
                this.socket.emit('lock-turn', this.gameId, this.userId, currentTurn);
                this.addLogEntry(`Turn ${currentTurn} locked`, 'success');
            }
        }
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
    toggleFloatingMiniMap() { try { const mod = require('./ui/minimap.js'); mod.toggleFloatingMiniMap(this); } catch { import('./ui/minimap.js').then(mod => mod.toggleFloatingMiniMap(this)); } }

    renderFloatingMini() { import('./ui/minimap.js').then(mod => mod.renderFloatingMini(this)); }

    // Drag-to-pan state moved to input/canvas.js

    // Canvas handlers moved to input/canvas.js

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

    // Status helpers moved to ui/UnitDetails.js

    // Helper to compute inclusive remaining turns with strong guards
    computeRemainingTurns(expiresTurn, currentTurn) { return utilComputeRemainingTurns(expiresTurn, currentTurn); }

    // Escape text for safe use inside HTML attribute values
    escapeAttr(text) { return utilEscapeAttr(text); }

    // Effects chip moved to ui/UnitDetails.js

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

    // Canvas handlers moved to input/canvas.js

    // Canvas handlers moved to input/canvas.js
    
    // Pick an adjacent tile near a target that is closest to current ship position
    // Adjacent tile helper moved to core/Movement.js
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
                    QueueCtl.addMove(this, this.selectedUnit.id, adj.x, adj.y, () => {});
                    QueueCtl.addHarvestStart(this, this.selectedUnit.id, target.id, () => {});
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
    handleMoveCommand(worldX, worldY) { return MoveCtl.handleMoveCommand(this, worldX, worldY); }

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


    
    // Enter warp target selection mode - delegated
    enterWarpMode() { return enterWarpMode(this); }
    
    // Exit warp target selection mode
    exitWarpMode() {
        this.warpMode = false;
        this.warpTargets = [];
        this.canvas.style.cursor = 'default';
        
        // Re-render to remove warp highlights
        this.render();
    }

    // Add entry to activity log (delegated)
    addLogEntry(message, type = 'info') { return uiAddLogEntry(this, message, type); }

    // setup modal handled in SFUI.setupModal
}

// Players modal: show all players, lock status, and online status
async function showPlayersModal() {
    const mod = await import('./ui/players-modal.js');
    return mod.showPlayersModal(gameClient);
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
    try { const presence = require('./services/presence.js'); presence.startHeartbeat && presence.startHeartbeat(gameClient); }
    catch { import('./services/presence.js').then(p => p.startHeartbeat && p.startHeartbeat(gameClient)); }
}

// Global functions for HTML event handlers
function selectUnit(unitId) {
    if (gameClient) gameClient.selectUnit(unitId);
}
// topbar/global handler shims moved to ui/controls.js

// Relative time formatter used in Players modal
// time/presence helpers moved to utils/time.js

// deprecated: moved to instance method via UnitDetails onAction

// deprecated global: warp mode now handled via features/warp.js and instance method

// Active scan removed; abilities now drive scanning via buffs like 'survey_scanner'.

// Show build modal with tabbed interface
// deprecated global: use features/build.js directly

// Render the Shipyard UI inside the build modal
// deprecated globals: handled in features/build.js

// Show interstellar travel options
// deprecated global: travel options handled in ui/travel-modal.js via instance method

// Travel through an interstellar gate
// Travel actions moved to ui/travel-modal.js

function upgradeBase() {
    if (gameClient) {
        gameClient.addLogEntry('Base upgrades not yet implemented', 'warning');
        // TODO: Implement base upgrades
    }
}

// Mining and cargo management functions
// deprecated global: mining handled in features/mining.js

// deprecated global: mining selection handled in features/mining.js

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
/* cargo modal moved to ui/cargo-modal.js */
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
                transferBtn.onclick = () => { try { UICargo.showTransferModal(this, selectedUnit.id, obj.id, obj.meta.name || obj.type); } catch {} };
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
/* cargo modal moved to ui/cargo-modal.js */
// deprecated global: transfer modal handled in ui/cargo-modal.js
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
            try { UICargo.performTransfer(this, fromId, toId, res, qty, toName); } catch {}
        });
        
    } catch (error) {
        console.error('Error showing transfer modal:', error);
        gameClient.addLogEntry('Failed to show transfer options', 'error');
    }
}

// Perform resource transfer
/* cargo modal moved to ui/cargo-modal.js */
// deprecated global: transfer action handled in ui/cargo-modal.js
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
/* cargo modal moved to ui/cargo-modal.js */
// deprecated global: cargo status handled in ui/cargo-modal.js
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
