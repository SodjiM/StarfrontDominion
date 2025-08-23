// Starfront: Dominion - Game Client Logic

import * as SFMining from './features/mining.js';
import * as UICargo from './ui/cargo-modal.js';
import { normalizeGameState, getEffectiveMovementSpeed as coreGetEffectiveMovementSpeed, getEffectiveScanRange as coreGetEffectiveScanRange, getUnitStatus as coreGetUnitStatus, getUnitStatuses as coreGetUnitStatuses } from './core/GameState.js';
import { calculateMovementPath as coreCalculateMovementPath, calculateETA as coreCalculateETA, getAdjacentTileNear as coreGetAdjacentTileNear } from './core/Movement.js';
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
import * as PlayersSvc from './services/players.js';
import * as TurnsSvc from './services/turns.js';
import { getCargoFill as units_getCargoFill, getEta as units_getEta } from './utils/units.js';
import { getUnitIcon as uiGetUnitIcon, formatArchetype as uiFormatArchetype } from './ui/icons.js';
import { addLogEntry as uiAddLogEntry } from './ui/log.js';
import { isCelestialObject as utilIsCelestialObject } from './utils/objects.js';
import {
    showWarpConfirmation,
    executeWarpOrder,
    enterWarpMode,
    exitWarpMode as warp_exitWarpMode,
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
        this.selectedObjectId = null; // selection persistence
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
        this.isFirstLoad = true;
        this.clientLingeringTrails = [];
        this.previousMovementStatuses = new Map();
        this.movementHistoryCache = new Map();
        this.warpMode = false;
        this.warpTargets = [];
        this.fogEnabled = true;
        this.trailBuffer = { byTurn: new Map() };
        this.fogOffscreen = null;
        this.lastFleet = null;
        this.senateProgress = 0;
        this.turnCountdownTimer = null;
        this.queueMode = false; // Shift to queue orders
        this._queuedByShipId = new Map();
        this._els = {}; // simple DOM cache
    }

    // Safely run when state exists
    withState(fn) {
        const state = this.gameState;
        if (!state) return;
        return fn(state);
    }

    async fetchSectorTrails() { return trailsFetchSectorTrails(this); }

    // Lifecycle: init, socket, state, UI bindings
    async initialize(gameId) {
        this.gameId = gameId;
        const user = Session.getUser();
        if (!user) { window.location.href = 'login.html'; return; }
        this.userId = user.userId;

        this.setupCanvas();
        const avatarMini = document.getElementById('playerAvatarMini');
        if (avatarMini) {
            const stored = localStorage.getItem('avatar');
            if (stored) avatarMini.src = stored;
        }
        SenateUI.loadSenateProgress(this);
        this.connectSocket();
        await this.loadGameState();
        this.setupEventListeners();
        this.bindUIControls();
        console.log(`🎮 Game ${gameId} initialized for user ${this.userId}`);
    }

    // Canvas & minimap
    setupCanvas() {
        this.canvas = document.getElementById('gameCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.ensureMiniCanvasRef();
        this.resizeCanvas();
        window.addEventListener('resize', () => this.resizeCanvas());
        this.createMapTooltip();
        this.bindMiniMapInteractions();
    }

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

    // Robustly find minimap canvas (inline or floating)
    ensureMiniCanvasRef() {
        const byId = document.getElementById('miniCanvas');
        if (byId && byId instanceof HTMLCanvasElement) {
            if (this.miniCanvas !== byId) {
                this.miniCanvas = byId;
                this.miniCtx = this.miniCanvas.getContext('2d');
                this._miniBound = false;
                this.bindMiniMapInteractions();
            }
            return;
        }
        const wrap = document.getElementById('floatingMiniWrap');
        if (wrap) {
            const canv = wrap.querySelector('canvas');
            if (canv && canv instanceof HTMLCanvasElement) {
                if (this.miniCanvas !== canv) {
                    this.miniCanvas = canv;
                    this.miniCtx = this.miniCanvas.getContext('2d');
                    this._miniBound = false;
                    this.bindMiniMapInteractions();
                }
                return;
            }
        }
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
        if (!byId) {
            this.miniCanvas = null;
            this.miniCtx = null;
        }
    }

    connectSocket() { netConnectSocket(this); }
    async loadGameState() { return stateLoadGameState(this); }
    async fetchMovementHistory(shipId = null, turns = 10) { const mod = await import('./services/history.js'); return mod.fetchMovementHistory(this, shipId, turns); }

    // Render & UI update
    async updateUI() {
        return this.withState(async () => {
        if (!this.gameState.playerSetup?.setup_completed) {
            try { const mod = await import('./ui/setup-modal.js'); mod.showSetupModal(this); } catch {}
            return;
        }
        uiUpdateTopbar(this);
        try { const mod = await import('./ui/player-panel.js'); mod.updatePlayerPanel(this); } catch {}
        uiUpdateSectorOverviewTitle(this);
        const lockBtn = (this._els.lockTurnBtn || (this._els.lockTurnBtn = document.getElementById('lockTurnBtn')));
        if (this.gameState.turnLocked) { lockBtn.textContent = '🔒 Turn Locked'; lockBtn.classList.add('locked'); this.turnLocked = true; }
        else { lockBtn.textContent = '🔓 Lock Turn'; lockBtn.classList.remove('locked'); this.turnLocked = false; }
        try { const mod = await import('./ui/fleet-list.js'); mod.updateFleetList(this); } catch {}
        this.objects = this.gameState.objects;
        SenateUI.applySenateProgressToUI(this);
        const allPlayerObjects = this.gameState.objects.filter(obj => obj.owner_id === this.userId);
        const playerObjects = allPlayerObjects.filter((obj, index, array) => array.findIndex(duplicate => duplicate.id === obj.id) === index);
        applyTurnTrails(this);
        SelectionSvc.updatePreviousMovementStatuses(this);
        const movingShips = this.objects.filter(obj => obj.movementPath && obj.movementActive);
        if (movingShips.length > 0) {
            console.log(`🚢 Found ${movingShips.length} ships with active movement paths:`, movingShips.map(s => ({ id: s.id, name: s.meta.name, pathLength: s.movementPath?.length, destination: s.plannedDestination, active: s.movementActive, status: s.movementStatus })));
        }
        SelectionSvc.applySelectionPersistence(this, playerObjects);
    });
    }

    getUnitIcon(type) { return uiGetUnitIcon(type); }
    formatArchetype(archetype) { return uiFormatArchetype(archetype); }

    // Selection orchestration only (drawing handled by render/selection.js)
    selectUnit(unitId) {
        this.selectedUnit = this.objects.find(obj => obj.id === unitId);
        this.selectedObjectId = unitId;
        if (this.selectedUnit) {
            this.camera.x = this.selectedUnit.x;
            this.camera.y = this.selectedUnit.y;
            this.restoreMovementPath(this.selectedUnit);
            this.updateUnitDetails();
            this.render();
        }
    }

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
    }

    previewAbilityRange(abilityKey) { if (window.SFAbilities) return SFAbilities.previewAbilityRange(this, abilityKey); this.abilityPreview = abilityKey; this.render(); }
    clearAbilityPreview() { if (window.SFAbilities) return SFAbilities.clearAbilityPreview(this); }
    computePositionAbilityHover(abilityKey, worldX, worldY) { if (window.SFAbilities) return SFAbilities.computePositionAbilityHover(this, abilityKey, worldX, worldY); return null; }
    async refreshAbilityCooldowns() { if (window.SFAbilities) return SFAbilities.refreshAbilityCooldowns(this); }
    getEffectiveMovementSpeed(unit) { return coreGetEffectiveMovementSpeed(unit); }
    getEffectiveScanRange(unit) { return coreGetEffectiveScanRange(unit); }

    render() {
        if (!this.canvas || !this.objects) return;
        const ctx = this.ctx; const canvas = this.canvas;
        // Background
        ctx.fillStyle = '#0a0a1a'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        // Grid
        SFRenderers.grid.drawGrid(ctx, canvas, this.camera, this.tileSize);
        // Objects, paths, selection, fog
        renderMapObjects(this, ctx, canvas);
        SFRenderers.movement.drawMovementPaths.call(this, ctx, canvas, this.objects, this.userId, this.camera, this.tileSize, this.selectedUnit, this.gameState, this.trailBuffer);
        renderSelectionOverlay(this, ctx, canvas.width/2, canvas.height/2);
        if (this.fogEnabled) this.fogOffscreen = SFRenderers.fog.drawFogOfWar(ctx, canvas, this.objects, this.userId, this.camera, this.tileSize, this.fogOffscreen);
        // Minimap
        if (this.miniCanvas) {
            this.miniCanvas._mainWidth = canvas.width;
            this.miniCanvas._mainHeight = canvas.height;
            SFMinimap.renderer.renderMiniMap(this.miniCtx, this.miniCanvas, this.objects, this.userId, this.camera, this.tileSize, this.gameState);
        }
    }

    queueAbility(abilityKey) { if (window.SFAbilities) return SFAbilities.queueAbility(this, abilityKey); }
    async loadQueueLog(shipId, force) { try { const mod = await import('./ui/queue-panel.js'); return mod.loadQueueLog(this, shipId, force); } catch {} }
    clearQueue(shipId) { try { const modp = import('./ui/queue-panel.js'); modp.then(mod => mod.clearQueue(this, shipId)); } catch {} }

    bindMiniMapInteractions() {
        if (!this.miniCanvas || this._miniBound) return;
        this._miniBound = true; this._miniBoundCanvas = this.miniCanvas;
        SFMinimap.interactions.bind(this.miniCanvas, () => ({ camera: this.camera, tileSize: this.tileSize }), (x, y) => { this.camera.x = x; this.camera.y = y; this.render(); });
    }

    // Input bindings
    setupEventListeners() {
        try { const mod = require('./input/canvas.js'); if (mod && typeof mod.bindCanvasInputs === 'function') mod.bindCanvasInputs(this); }
        catch { import('./input/canvas.js').then(mod => mod.bindCanvasInputs(this)); }
        // Keyboard: unified in input/mouseKeyboard.js
    }

    // Toolbar & global controls
    bindUIControls() {
        try { const mod = require('./ui/controls.js'); if (mod && typeof mod.bindControls === 'function') mod.bindControls(this); }
        catch { import('./ui/controls.js').then(mod => mod.bindControls(this)); }
    }

    // Turn locking via service
    lockCurrentTurn() { return TurnsSvc.toggle(this); }

    // Tooltip helpers
    createMapTooltip() { if (this._tooltipEl || !this.canvas) return; this._tooltipEl = SFTooltip.create(this.canvas); }
    updateMapTooltip(obj, mouseX, mouseY) { if (!this._tooltipEl || !this.canvas) return; SFTooltip.update(this._tooltipEl, this.canvas, obj, mouseX, mouseY, this.getOwnerName.bind(this)); }
    hideMapTooltip() { SFTooltip.hide(this._tooltipEl); }

    // Owner name resolution via service
    getOwnerName(ownerId) { return PlayersSvc.getName(this, ownerId); }
    async primePlayerNameCache() { return PlayersSvc.primeCache(this); }

    toggleFloatingMiniMap() { try { const mod = require('./ui/minimap.js'); mod.toggleFloatingMiniMap(this); } catch { import('./ui/minimap.js').then(mod => mod.toggleFloatingMiniMap(this)); } }
    renderFloatingMini() { import('./ui/minimap.js').then(mod => mod.renderFloatingMini(this)); }

    // Fleet/favorites helpers
    async updateMultiSectorFleet() { const mod = await import('./ui/fleet-list.js'); return mod.updateFleetList(this); }
    attachFleetToolbarHandlers() { const modp = import('./ui/fleet-list.js'); modp.then(mod => mod.attachToolbarHandlers(this)); }

    // Cross-sector selection
    async selectRemoteUnit(unitId, sectorId, sectorName, inCurrentSector) {
        if (inCurrentSector) { this.selectUnit(unitId); }
        else {
            try {
                const data = await SFApi.State.switchSector(this.gameId, this.userId, sectorId);
                if (data) {
                    const preserveCamera = { x: this.camera.x, y: this.camera.y };
                    this.gameState = data.gameState;
                    this.addLogEntry(`Switched to ${sectorName}`, 'info');
                    this.updateUI();
                    this.camera.x = preserveCamera.x; this.camera.y = preserveCamera.y; this.render();
                    this.updateSectorOverviewTitle();
                    setTimeout(() => { this.selectUnit(unitId); }, 100);
                }
            } catch (error) {
                console.error('Error switching sectors:', error);
                this.addLogEntry('Failed to switch sectors', 'error');
            }
        }
    }

    getUnitStatus(meta, unit) { return coreGetUnitStatus(meta, unit); }
    getUnitStatuses(meta, unit) { return coreGetUnitStatuses(meta, unit); }

    // Simple helpers used in UI
    computeRemainingTurns(expiresTurn, currentTurn) { return utilComputeRemainingTurns(expiresTurn, currentTurn); }
    escapeAttr(text) { return utilEscapeAttr(text); }
    getCargoFill(unit) { return units_getCargoFill(unit); }
    getEta(unit) { return units_getEta(unit); }

    toggleSectorCollapse(sectorName) {
        const el = document.querySelector(`.sector-header[data-sector="${sectorName}"]`);
        const body = document.getElementById(`sector-units-${this.safeId(sectorName)}`);
        if (!el || !body) return;
        const collapsed = el.classList.toggle('collapsed');
        if (collapsed) { body.style.display = 'none'; } else { body.style.display = 'grid'; }
    }

    safeId(text) { return (text || '').replace(/[^a-z0-9]+/gi, '-'); }

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
            this.updateMultiSectorFleet();
        } catch {}
    }

    isAdjacentToInterstellarGate(ship) { return isAdjacentToInterstellarGate(this, ship); }
    getAdjacentInterstellarGates(ship) { return getAdjacentInterstellarGates(this, ship); }

    // Right-click routing delegated to feature module
    handleCanvasRightClick(e) {
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left; const y = e.clientY - rect.top;
        const centerX = this.canvas.width / 2; const centerY = this.canvas.height / 2;
        const worldX = Math.round(this.camera.x + (x - centerX) / this.tileSize);
        const worldY = Math.round(this.camera.y + (y - centerY) / this.tileSize);
        try { const mod = require('./features/context-actions.js'); mod.onRightClick(this, worldX, worldY); }
        catch { import('./features/context-actions.js').then(mod => mod.onRightClick(this, worldX, worldY)); }
    }

    // Movement helpers
    calculateMovementPath(startX, startY, endX, endY) { return coreCalculateMovementPath(startX, startY, endX, endY); }
    calculateETA(path, movementSpeed) { return coreCalculateETA(path, movementSpeed, this.selectedUnit, this.gameState); }

    // Helpers used by input/context handlers and warp/minimap
    isCelestialObject(obj) { return utilIsCelestialObject(obj); }
    getAdjacentTileNear(targetX, targetY, fromX, fromY) { return coreGetAdjacentTileNear(targetX, targetY, fromX, fromY); }
    handleMoveCommand(x, y) { return MoveCtl.handleMoveCommand(this, x, y); }

    // Warp
    enterWarpMode() { return enterWarpMode(this); }
    exitWarpMode() { return warp_exitWarpMode(this); }

    // Log helper
    addLogEntry(message, type = 'info') { return uiAddLogEntry(this, message, type); }
}

async function showPlayersModal() { const mod = await import('./ui/players-modal.js'); return mod.showPlayersModal(gameClient); }
let gameClient = null;
async function initializeGame(gameId) {
    gameClient = new GameClient();
    if (typeof window !== 'undefined') { window.gameClient = gameClient; }
    await gameClient.initialize(gameId);
    try { const presence = require('./services/presence.js'); presence.startHeartbeat && presence.startHeartbeat(gameClient); }
    catch { import('./services/presence.js').then(p => p.startHeartbeat && p.startHeartbeat(gameClient)); }
}
function selectUnit(unitId) { if (gameClient) gameClient.selectUnit(unitId); }
function upgradeBase() { if (gameClient) { gameClient.addLogEntry('Base upgrades not yet implemented', 'warning'); } }
// Cargo flows handled in ui/cargo-modal.js
