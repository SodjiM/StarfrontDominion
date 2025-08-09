// Starfront: Dominion - Game Client Logic

class GameClient {
    constructor() {
        this.gameId = null;
        this.userId = null;
        this.socket = null;
        this.gameState = null;
        this.selectedUnit = null;
        this.selectedObjectId = null; // STAGE B: Track selection by ID across turns
        this.canvas = null;
        this.ctx = null;
        this.miniCanvas = null;
        this.miniCtx = null;
        this.camera = { x: 2500, y: 2500, zoom: 1 };
        this.tileSize = 20;
        this.turnLocked = false;
        this.objects = [];
        this.units = [];
        this.isFirstLoad = true; // Track if this is the initial game load
        this.clientLingeringTrails = []; // FIX 2: Store client-side lingering trails from redirections
        this.previousMovementStatuses = new Map(); // FIX: Track previous movement statuses to detect completions
        this.movementHistoryCache = new Map(); // PHASE 2: Cache movement history by ship ID
        this.warpMode = false; // Track if we're in warp target selection mode
        this.warpTargets = []; // Available warp targets (celestial objects)
        this.fogEnabled = true;
        this.fogOffscreen = null;
        this.lastFleet = null; // Cached fleet for stats strip
        this.senateProgress = 0; // 0-100 senate update meter
    }

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
        
        console.log(`🎮 Game ${gameId} initialized for user ${this.userId}`);
    }

    // Setup canvas elements
    setupCanvas() {
        this.canvas = document.getElementById('gameCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.miniCanvas = document.getElementById('miniCanvas');
        if (this.miniCanvas) {
            this.miniCtx = this.miniCanvas.getContext('2d');
        } else {
            this.miniCtx = null;
        }
        
        // Set canvas size
        this.resizeCanvas();
        window.addEventListener('resize', () => this.resizeCanvas());
    }

    // Resize canvas to fit container
    resizeCanvas() {
        const container = this.canvas.parentElement;
        this.canvas.width = container.clientWidth;
        this.canvas.height = container.clientHeight;
        
        if (this.miniCanvas && this.miniCanvas.parentElement) {
            this.miniCanvas.width = this.miniCanvas.parentElement.clientWidth - 20;
            this.miniCanvas.height = this.miniCanvas.parentElement.clientHeight - 40;
        }
        
        this.render();
    }

    // Connect to Socket.IO
    connectSocket() {
        this.socket = io();
        
        this.socket.on('connect', () => {
            console.log('🔌 Connected to server');
            this.socket.emit('join-game', this.gameId, this.userId);
        });

        this.socket.on('player-locked-turn', (data) => {
            this.addLogEntry(`Player ${data.userId} locked turn ${data.turnNumber}`, 'info');
            
            // If this is the current player who locked the turn, update UI immediately
            if (data.userId === this.userId) {
                // Update the client-side turn locked status
                this.turnLocked = true;
                
                // Update the button UI immediately
                const lockBtn = document.getElementById('lockTurnBtn');
                if (lockBtn) {
                    lockBtn.textContent = '🔒 Turn Locked';
                    lockBtn.classList.add('locked');
                }
                
                // Also update the game state for consistency
                if (this.gameState) {
                    this.gameState.turnLocked = true;
                }
                
                // Refresh the unit details panel to disable action buttons
                this.updateUnitDetails();
            }
        });

        this.socket.on('turn-resolving', (data) => {
            this.addLogEntry(`Turn ${data.turnNumber} is resolving...`, 'warning');
        });

        this.socket.on('turn-resolved', (data) => {
            this.addLogEntry(`Turn ${data.turnNumber} resolved! Starting turn ${data.nextTurn}`, 'success');
            this.loadGameState(); // Refresh game state
            // Tick senate meter +1% per resolved turn
            this.incrementSenateProgress(1);
        });

        this.socket.on('warp-confirmed', (data) => {
            this.addLogEntry(`Warp order confirmed: ${data.message}`, 'success');
            this.loadGameState(); // Refresh to show warp preparation
        });

        this.socket.on('ship-warp-ordered', (data) => {
            if (data.userId !== this.userId) {
                this.addLogEntry(`${data.shipName} is preparing to warp to ${data.targetName}`, 'info');
            }
        });

        this.socket.on('harvesting-started', (data) => {
            this.addLogEntry(data.message, 'success');
            this.loadGameState(); // Refresh to show mining status
        });

        this.socket.on('harvesting-stopped', (data) => {
            this.addLogEntry(data.message, 'info');
            this.loadGameState(); // Refresh to update mining status
        });

        this.socket.on('harvesting-error', (data) => {
            this.addLogEntry(`Mining error: ${data.error}`, 'error');
        });

        // Chat events
        this.socket.on('chat:game', (msg) => { if (window.appendChat) window.appendChat(msg); });
        this.socket.on('chat:channel', (msg) => { if (window.appendChat) window.appendChat(msg); });
        this.socket.on('chat:dm', (msg) => { if (window.appendChat) window.appendChat(msg); });

        // ✅ Atomic Turn Resolution Policy: No real-time movement updates
        // All movement results will be visible after 'turn-resolved' via loadGameState()
        // 
        // Future: We can add post-resolution animations here if desired
        // this.socket.on('turn-resolved', (data) => {
        //     // Optional: Add smooth animations for movement changes
        //     this.animateMovementResults(data.movementSummary);
        // });

        this.socket.on('disconnect', () => {
            console.log('🔌 Disconnected from server');
        });
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
            const response = await fetch(url);
            const data = await response.json();
            
            if (response.ok) {
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
                
                this.gameState = data;
                this.updateUI();
                this.render();
                console.log('🎮 Game state loaded:', data);
            } else {
                this.addLogEntry(`Error: ${data.error}`, 'error');
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
            const response = await fetch(url);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const data = await response.json();
            
            if (!data.success) {
                throw new Error(data.error || 'Failed to fetch movement history');
            }
            
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
    updateUI() {
        if (!this.gameState) return;

        // Check if setup is needed (prevent normal UI until setup complete)
        if (!this.gameState.playerSetup?.setup_completed) {
            this.showSetupModal();
            return; // Don't show game UI until setup complete
        }

        // Update turn counter
        document.getElementById('turnCounter').textContent = `Turn ${this.gameState.currentTurn.turn_number}`;
        
        // Update game title with sector name
        const gameTitle = document.getElementById('gameTitle');
        gameTitle.innerHTML = `🌌 ${this.gameState.sector.name || 'Your System'}`;
        
        // Update player avatar
        this.updatePlayerAvatar();
        // Update player information card (identity, stats, actions)
        this.updatePlayerInformationPanel();
        
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
        this.attachFleetToolbarHandlers();
        this.updateMultiSectorFleet();

        this.objects = this.gameState.objects;

        // After state load, also re-apply senate UI (in case of first load)
        this.applySenateProgressToUI();
        
        // Get player objects for selection logic
        const allPlayerObjects = this.gameState.objects.filter(obj => obj.owner_id === this.userId);
        const playerObjects = allPlayerObjects.filter((obj, index, array) => 
            array.findIndex(duplicate => duplicate.id === obj.id) === index
        );
        
        // FIX: Turn-based cleanup of lingering trails (10 turns max)
        const currentTurn = this.gameState?.currentTurn?.turn_number || 1;
        const initialClientTrailCount = this.clientLingeringTrails.length;
        
        this.clientLingeringTrails = this.clientLingeringTrails.filter(trail => {
            const turnAge = currentTurn - trail.createdOnTurn;
            if (turnAge >= 10) return false; // Remove trails older than 10 turns
            
            // PHASE 3: Remove fallback trails if accurate trail exists for same ship
            if (!trail.isAccurate) {
                const hasAccurateTrial = this.clientLingeringTrails.some(other => 
                    other.shipId === trail.shipId && 
                    other.isAccurate && 
                    Math.abs(other.createdOnTurn - trail.createdOnTurn) <= 1
                );
                if (hasAccurateTrial) {
                    console.log(`🗑️ Removing fallback trail for ship ${trail.shipId} - accurate trail available`);
                    return false;
                }
            }
            return true;
        });
        
        // FIX: Detect ships that just completed movement and create lingering trails BEFORE cleanup
        this.objects.forEach(ship => {
            if (ship.type === 'ship' && ship.movementStatus === 'completed' && ship.movementPath && ship.movementPath.length > 1) {
                const prevStatus = this.previousMovementStatuses.get(ship.id);
                
                // If ship was previously active and is now completed, create lingering trail
                if (prevStatus === 'active') {
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
        
        // Clean up client trails that are now provided by server (but preserve completion trails for this turn)
        const serverCompletedMovements = new Set(
            this.objects
                .filter(obj => obj.movementStatus === 'completed' && obj.movementPath)
                .map(obj => obj.id)
        );
        
        this.clientLingeringTrails = this.clientLingeringTrails.filter(trail => {
            // Keep completion trails from this turn even if server has them
            if (trail.createdOnTurn === currentTurn && trail.id.startsWith('completion-')) {
                return true;
            }
            // Remove older trails that are now provided by server
            return !serverCompletedMovements.has(trail.shipId);
        });
        
        if (initialClientTrailCount !== this.clientLingeringTrails.length) {
            console.log(`🧹 Cleaned up ${initialClientTrailCount - this.clientLingeringTrails.length} expired/duplicate client trails`);
        }
        
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
                    // Update camera to follow moved object
                    this.camera.x = previouslySelected.x;
                    this.camera.y = previouslySelected.y;
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

    // Update player avatar display
    updatePlayerAvatar() {
        const avatarImg = document.getElementById('playerAvatar');
        if (!avatarImg || !this.gameState?.playerSetup) return;
        
        const avatar = this.gameState.playerSetup.avatar;
        if (avatar) {
            avatarImg.src = `assets/avatars/${avatar}.png`;
            avatarImg.alt = `${avatar} avatar`;
        }
    }

    // Update the bottom-left player information card
    updatePlayerInformationPanel() {
        const setup = this.gameState?.playerSetup || {};
        // Commander name from session
        const username = (Session.getUser()?.username) || 'Commander';
        const nameEl = document.getElementById('commanderName');
        if (nameEl) nameEl.textContent = username;

        // System name subtitle
        const sysEl = document.getElementById('systemNameLabel');
        if (sysEl) sysEl.textContent = setup.systemName || '—';

        // Color swatch
        const swatch = document.getElementById('playerColorSwatch');
        if (swatch) {
            swatch.style.background = setup.colorPrimary || '#64b5f6';
            const secondary = setup.colorSecondary || '#9c27b0';
            swatch.style.boxShadow = `0 0 10px 2px ${secondary}`;
        }

        // Avatar image (mini)
        const mini = document.getElementById('playerAvatarMini');
        if (mini && setup.avatar) {
            mini.src = `assets/avatars/${setup.avatar}.png`;
            mini.alt = `${setup.avatar} avatar`;
        }

        // Stats: credits (placeholder), ships, stations, senators (placeholder)
        const creditsEl = document.getElementById('creditsChip');
        if (creditsEl) creditsEl.textContent = '—'; // TODO: hook real credits when available

        const senatorsEl = document.getElementById('senatorsChip');
        if (senatorsEl) senatorsEl.textContent = '—'; // TODO: hook real senators count

        const shipsEl = document.getElementById('shipsChip');
        const stationsEl = document.getElementById('stationsChip');

        if (this.lastFleet && Array.isArray(this.lastFleet)) {
            const ships = this.lastFleet.filter(u => u.type === 'ship').length;
            const stations = this.lastFleet.filter(u => u.type === 'starbase' || u.type === 'station').length;
            if (shipsEl) shipsEl.textContent = String(ships);
            if (stationsEl) stationsEl.textContent = String(stations);
        } else {
            if (shipsEl) shipsEl.textContent = '…';
            if (stationsEl) stationsEl.textContent = '…';
        }

        // Senate ring
        this.applySenateProgressToUI();
    }

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
            'starbase': '🏭',
            
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

    // Update unit details panel
    updateUnitDetails() {
        const detailsContainer = document.getElementById('unitDetails');
        
        if (!this.selectedUnit) {
            detailsContainer.innerHTML = '<div style="text-align: center; color: #666; padding: 20px;">Select a unit to view details</div>';
            return;
        }

        const unit = this.selectedUnit;
        const meta = unit.meta;

        detailsContainer.innerHTML = `
            <div class="unit-info">
                <h3 style="color: #64b5f6; margin-bottom: 15px;">
                    ${this.getUnitIcon(unit.type)} ${meta.name || unit.type}
                </h3>
                
                <div class="stat-item">
                    <span>Position:</span>
                    <span>(${unit.x}, ${unit.y})</span>
                </div>
                
                <div class="stat-item">
                    <span>🌌 System:</span>
                    <span>${this.gameState.sector.name || 'Unnamed System'}</span>
                </div>
                
                <div class="stat-item">
                    <span>⭐ Type:</span>
                    <span>${this.formatArchetype(this.gameState.sector.archetype)}</span>
                </div>
                
                <div class="stat-item">
                    <span>Health:</span>
                    <span>${meta.hp || '?'}/${meta.maxHp || '?'}</span>
                </div>
                
                ${meta.scanRange ? `
                <div class="stat-item">
                    <span>Scan Range:</span>
                    <span>${meta.scanRange}</span>
                </div>
                ` : ''}
                
                ${meta.movementSpeed ? `
                <div class="stat-item">
                    <span>Movement:</span>
                    <span>${meta.movementSpeed} tiles/turn</span>
                </div>
                ` : ''}
                
                ${meta.pilots ? `
                <div class="stat-item">
                    <span>Pilots Available:</span>
                    <span>${meta.pilots}</span>
                </div>
                ` : ''}
                
                ${meta.energy !== undefined ? `
                <div class="stat-item">
                    <span>⚡ Energy:</span>
                    <span>${meta.energy}/${meta.maxEnergy || meta.energy}</span>
                </div>
                ` : ''}
                
                ${meta.canActiveScan ? `
                <div class="stat-item">
                    <span>🔍 Active Scan Range:</span>
                    <span>${meta.activeScanRange || meta.scanRange * 2 || 10} tiles</span>
                </div>
                <div class="stat-item">
                    <span>💡 Scan Cost:</span>
                    <span>${meta.activeScanCost || 1} energy</span>
                </div>
                ` : ''}
                
                ${unit.type === 'ship' && meta.cargoCapacity ? `
                <div class="stat-item">
                    <span>📦 Cargo:</span>
                    <span id="cargoStatus">Loading...</span>
                </div>
                ` : ''}
                
                ${unit.harvestingStatus ? `
                <div class="stat-item">
                    <span>⛏️ Mining:</span>
                    <span style="color: ${unit.harvestingStatus === 'active' ? '#4CAF50' : '#FFA500'}">
                        ${unit.harvestingStatus === 'active' ? 
                          `${unit.harvestingResource} (${unit.harvestRate}/turn)` : 
                          unit.harvestingStatus}
                    </span>
                </div>
                ` : ''}
            </div>
            
            <div style="margin-top: 20px;">
                ${unit.type === 'ship' ? `
                    <button class="sf-btn sf-btn-secondary" onclick="setMoveMode()" ${this.turnLocked ? 'disabled' : ''}>
                        🎯 Set Destination
                    </button>
                    <button class="sf-btn sf-btn-secondary" onclick="setWarpMode()" ${this.turnLocked ? 'disabled' : ''}>
                        🌌 Warp
                    </button>
                    ${this.isAdjacentToInterstellarGate(unit) ? `
                        <button class="sf-btn sf-btn-secondary" onclick="showInterstellarTravelOptions()" ${this.turnLocked ? 'disabled' : ''}>
                            🌀 Interstellar Travel
                        </button>
                    ` : ''}
                    <button class="sf-btn sf-btn-secondary" id="mineBtn" onclick="toggleMining()" ${this.turnLocked || !meta.canMine ? 'disabled' : ''}>
                        ${unit.harvestingStatus === 'active' ? '🛑 Stop Mining' : (meta.canMine ? '⛏️ Mine' : '⛏️ Mine (N/A)')}
                    </button>
                    <button class="sf-btn sf-btn-secondary" onclick="showCargo()" ${this.turnLocked ? 'disabled' : ''}>
                        📦 Cargo
                    </button>
                    <button class="sf-btn sf-btn-secondary" onclick="scanArea()" ${this.turnLocked || !meta.canActiveScan ? 'disabled' : ''}>
                        ${meta.canActiveScan ? '🔍 Active Scan' : '🔍 Scan Area (N/A)'}
                    </button>
                ` : ''}
                
                ${unit.type === 'starbase' ? `
                    <button class="sf-btn sf-btn-secondary" onclick="showCargo()" ${this.turnLocked ? 'disabled' : ''}>
                        📦 Cargo
                    </button>
                    <button class="sf-btn sf-btn-secondary" onclick="showBuildModal()" ${this.turnLocked ? 'disabled' : ''}>
                        🔨 Build
                    </button>
                    <button class="sf-btn sf-btn-secondary" onclick="upgradeBase()" ${this.turnLocked ? 'disabled' : ''}>
                        ⬆️ Upgrade Base
                    </button>
                ` : ''}
                
                ${unit.type === 'storage-structure' ? `
                    <button class="sf-btn sf-btn-secondary" onclick="showCargo()" ${this.turnLocked ? 'disabled' : ''}>
                        📦 Storage
                    </button>
                ` : ''}
                
                ${unit.type === 'warp-beacon' ? `
                    <div class="structure-info">
                        <p>🌌 Warp destination available to all players</p>
                    </div>
                ` : ''}
                
                ${unit.type === 'interstellar-gate' ? `
                    <div class="structure-info">
                        <p>🌀 Gateway to ${unit.meta?.destinationSectorName || 'Unknown Sector'}</p>
                        <p style="color: #888; font-size: 0.9em;">Available to all players</p>
                    </div>
                ` : ''}
            </div>
        `;
        
        // Update cargo status for ships and structures with cargo
        if (unit && unit.meta && unit.meta.cargoCapacity) {
            updateCargoStatus(unit.id);
        }
    }

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
        
        // Draw grid
        this.drawGrid(ctx, centerX, centerY, tilesX, tilesY);
        
        // Draw objects
        this.drawObjects(ctx, centerX, centerY);
        
        // Draw movement paths for all ships with active movement orders
        this.drawMovementPaths(ctx, centerX, centerY);
        
        // Draw selection highlight
        this.drawSelection(ctx, centerX, centerY);
        
        // Draw fog of war overlay last for clarity
        if (this.fogEnabled) {
            this.drawFogOfWar(ctx, centerX, centerY);
        }

        // Render mini-map
        this.renderMiniMap();
    }

    // Draw fog of war: dim everything, then punch radial gradients around owned sensors
    drawFogOfWar(ctx, centerX, centerY) {
        const ownedSensors = (this.objects || []).filter(obj => obj.owner_id === this.userId && (obj.type === 'ship' || obj.type === 'starbase' || obj.type === 'sensor-tower'));
        if (ownedSensors.length === 0) return;
        const canvas = this.canvas;
        // Create offscreen buffer if needed
        if (!this.fogOffscreen || this.fogOffscreen.width !== canvas.width || this.fogOffscreen.height !== canvas.height) {
            this.fogOffscreen = document.createElement('canvas');
            this.fogOffscreen.width = canvas.width;
            this.fogOffscreen.height = canvas.height;
        }
        const fctx = this.fogOffscreen.getContext('2d');
        // Base dark overlay
        fctx.clearRect(0, 0, this.fogOffscreen.width, this.fogOffscreen.height);
        fctx.fillStyle = 'rgba(0,0,0,0.6)';
        fctx.fillRect(0, 0, this.fogOffscreen.width, this.fogOffscreen.height);
        // Punch out gradients for each sensor
        fctx.globalCompositeOperation = 'destination-out';
        ownedSensors.forEach(sensor => {
            const meta = sensor.meta || {};
            const scanRange = meta.scanRange || 5;
            const screenX = Math.round((sensor.x - this.camera.x) * this.tileSize + centerX);
            const screenY = Math.round((sensor.y - this.camera.y) * this.tileSize + centerY);
            const radiusPx = scanRange * this.tileSize;
            const gradient = fctx.createRadialGradient(screenX, screenY, 0, screenX, screenY, Math.max(1, radiusPx));
            // Fully clear near center, fade to no-clear at edge for a hazy boundary
            gradient.addColorStop(0, 'rgba(0,0,0,1)');
            gradient.addColorStop(0.7, 'rgba(0,0,0,0.4)');
            gradient.addColorStop(1, 'rgba(0,0,0,0)');
            fctx.fillStyle = gradient;
            fctx.beginPath();
            fctx.arc(screenX, screenY, Math.max(1, radiusPx), 0, Math.PI * 2);
            fctx.fill();
        });
        fctx.globalCompositeOperation = 'source-over';
        // Draw the fog layer on top
        ctx.drawImage(this.fogOffscreen, 0, 0);
    }

    // Update sector overview title
    updateSectorOverviewTitle() {
        const titleElement = document.getElementById('sectorOverviewTitle');
        if (titleElement && this.gameState?.sector?.name) {
            titleElement.textContent = `🌌 ${this.gameState.sector.name}`;
        } else if (titleElement) {
            titleElement.textContent = 'Sector Overview';
        }
    }

    // Draw grid
    drawGrid(ctx, centerX, centerY, tilesX, tilesY) {
        ctx.strokeStyle = 'rgba(100, 181, 246, 0.1)';
        ctx.lineWidth = 1;
        
        const startX = this.camera.x - Math.floor(tilesX / 2);
        const startY = this.camera.y - Math.floor(tilesY / 2);
        
        // Draw vertical lines
        for (let i = 0; i <= tilesX; i++) {
            const x = centerX + (i - tilesX / 2) * this.tileSize;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, this.canvas.height);
            ctx.stroke();
        }
        
        // Draw horizontal lines
        for (let i = 0; i <= tilesY; i++) {
            const y = centerY + (i - tilesY / 2) * this.tileSize;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(this.canvas.width, y);
            ctx.stroke();
        }
    }

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
        const isShip = obj.type === 'ship' || obj.type === 'starbase';
        
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
            this.drawResourceNode(ctx, obj, x, y, renderSize, colors);
        } else if (isCelestial) {
            this.drawCelestialObject(ctx, obj, x, y, renderSize, colors, visibility);
        } else {
            this.drawShipObject(ctx, obj, x, y, renderSize, colors, visibility, isOwned);
        }
        
        // Restore context
        ctx.restore();
    }
    
    // Check if object is a celestial body
    isCelestialObject(obj) {
        const celestialTypes = ['star', 'planet', 'moon', 'belt', 'nebula', 'wormhole', 'jump-gate', 'derelict', 'graviton-sink'];
        return celestialTypes.includes(obj.celestial_type || obj.type);
    }
    
    // Get colors for different object types
    getObjectColors(obj, isOwned, visibility, isCelestial) {
        if (isOwned && !isCelestial) {
            return {
                border: '#4caf50',
                background: 'rgba(76, 175, 80, 0.3)',
                text: '#ffffff'
            };
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
    drawCelestialObject(ctx, obj, x, y, size, colors, visibility) {
        const type = obj.celestial_type || obj.type;
        
        // Draw glow effect for certain objects
        if (colors.glow && size > this.tileSize) {
            ctx.shadowColor = colors.glow;
            ctx.shadowBlur = Math.min(size * 0.3, 20);
        }
        
        // Draw main body
        if (type === 'star') {
            this.drawStar(ctx, x, y, size, colors);
        } else if (type === 'planet' || type === 'moon') {
            this.drawPlanet(ctx, x, y, size, colors, obj.meta);
        } else if (type === 'belt') {
            this.drawAsteroidBelt(ctx, x, y, size, colors);
        } else if (type === 'nebula') {
            this.drawNebula(ctx, x, y, size, colors);
        } else if (type === 'wormhole' || type === 'jump-gate') {
            this.drawWormhole(ctx, x, y, size, colors);
        } else if (type === 'graviton-sink') {
            this.drawGravitonSink(ctx, x, y, size, colors);
        } else {
            this.drawGenericCelestial(ctx, x, y, size, colors);
        }
        
        // Reset shadow
        ctx.shadowBlur = 0;
        
        // Draw name for large celestial objects or when zoomed in
        if ((size > this.tileSize * 3 || this.tileSize > 20) && obj.meta?.name) {
            ctx.fillStyle = colors.text;
            ctx.font = `bold ${Math.max(12, this.tileSize * 0.4)}px Arial`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText(obj.meta.name, x, y + size/2 + 5);
        }
        
        // Draw fog of war indicator for dimmed objects
        if (visibility.dimmed && size > this.tileSize) {
            ctx.fillStyle = 'rgba(100, 181, 246, 0.7)';
            ctx.font = `${Math.max(16, this.tileSize * 0.5)}px Arial`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('?', x, y);
        }
        

    }
    
    // Draw resource nodes (mineable resources)
    drawResourceNode(ctx, obj, x, y, size, colors) {
        const meta = obj.meta || {};
        const resourceType = meta.resourceType || 'unknown';
        const resourceAmount = meta.resourceAmount || 0;
        const maxResource = meta.maxResource || 100;
        const nodeSize = meta.size || 1;
        const iconEmoji = meta.iconEmoji || '📦';
        const colorHex = meta.colorHex || '#888888';
        
        // Calculate health percentage for visual feedback
        const healthPercent = resourceAmount / maxResource;
        const alpha = 0.3 + (healthPercent * 0.5); // 30% to 80% opacity based on remaining resources
        
        // Draw resource node based on type
        ctx.save();
        ctx.globalAlpha = alpha;
        
        if (resourceType === 'rock') {
            // Draw asteroid rock
            ctx.fillStyle = colorHex;
            ctx.strokeStyle = '#D4AF37'; // Gold outline
            ctx.lineWidth = Math.max(1, size / 15);
            
            // Draw irregular rock shape
            ctx.beginPath();
            const sides = 6 + (nodeSize * 2);
            for (let i = 0; i < sides; i++) {
                const angle = (i / sides) * Math.PI * 2;
                const radius = size * (0.4 + Math.sin(angle * 3) * 0.15);
                const px = x + Math.cos(angle) * radius;
                const py = y + Math.sin(angle) * radius;
                
                if (i === 0) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
            }
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            
        } else if (resourceType === 'gas') {
            // Draw gas cloud
            const gradient = ctx.createRadialGradient(x, y, 0, x, y, size);
            gradient.addColorStop(0, colorHex + '80'); // Semi-transparent center
            gradient.addColorStop(0.7, colorHex + '40'); // More transparent edge
            gradient.addColorStop(1, colorHex + '10'); // Very transparent outer edge
            
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(x, y, size, 0, Math.PI * 2);
            ctx.fill();
            
        } else if (resourceType === 'energy') {
            // Draw energy collection point
            ctx.strokeStyle = colorHex;
            ctx.lineWidth = Math.max(2, size / 8);
            
            // Draw pulsing energy rings
            for (let ring = 0; ring < 3; ring++) {
                ctx.globalAlpha = alpha * (1 - ring * 0.3);
                ctx.beginPath();
                ctx.arc(x, y, size * (0.3 + ring * 0.3), 0, Math.PI * 2);
                ctx.stroke();
            }
            
        } else if (resourceType === 'salvage') {
            // Draw salvage debris
            ctx.fillStyle = colorHex;
            ctx.strokeStyle = '#FF6347'; // Tomato red outline
            ctx.lineWidth = Math.max(1, size / 12);
            
            // Draw angular debris shape
            ctx.beginPath();
            ctx.moveTo(x - size * 0.4, y - size * 0.2);
            ctx.lineTo(x + size * 0.3, y - size * 0.4);
            ctx.lineTo(x + size * 0.4, y + size * 0.1);
            ctx.lineTo(x - size * 0.1, y + size * 0.4);
            ctx.lineTo(x - size * 0.5, y + size * 0.2);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
        } else {
            // Generic mineral crystal (for the 30-mineral system)
            ctx.fillStyle = colorHex;
            ctx.strokeStyle = 'rgba(255,255,255,0.35)';
            ctx.lineWidth = Math.max(1, size / 16);
            
            const r = Math.max(3, size * 0.45);
            ctx.beginPath();
            ctx.moveTo(x, y - r);
            ctx.lineTo(x + r * 0.6, y - r * 0.2);
            ctx.lineTo(x + r * 0.35, y + r);
            ctx.lineTo(x - r * 0.6, y + r * 0.2);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
        }
        
        ctx.restore();
        
        // Draw resource amount indicator for nearby nodes
        if (size > 10) {
            ctx.fillStyle = '#FFFFFF';
            ctx.font = `${Math.max(8, size / 4)}px Arial`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            
            // Draw background for text
            const text = resourceAmount.toString();
            const textWidth = ctx.measureText(text).width;
            ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
            ctx.fillRect(x - textWidth/2 - 2, y + size * 0.6 - 6, textWidth + 4, 12);
            
            // Draw text
            ctx.fillStyle = '#FFFFFF';
            ctx.fillText(text, x, y + size * 0.6);
        }
    }
    
    // Draw ship/station objects
    drawShipObject(ctx, obj, x, y, size, colors, visibility, isOwned) {
        // Draw object background
        ctx.fillStyle = colors.background;
        ctx.fillRect(x - size/2, y - size/2, size, size);
        
        // Draw object border
        ctx.strokeStyle = colors.border;
        ctx.lineWidth = visibility.dimmed ? 1 : 2;
        ctx.strokeRect(x - size/2, y - size/2, size, size);
        
        // Draw object icon/text
        ctx.fillStyle = colors.text;
        ctx.font = `${this.tileSize * 0.6}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        const icon = this.getUnitIcon(obj.type);
        ctx.fillText(icon, x, y);
        
        // Draw object name if zoomed in enough (only for owned or fully visible objects)
        if (this.tileSize > 15 && (isOwned || (visibility.visible && !visibility.dimmed))) {
            ctx.fillStyle = colors.text;
            ctx.font = `${this.tileSize * 0.3}px Arial`;
            ctx.textBaseline = 'top';
            ctx.fillText(obj.meta.name || obj.type, x, y + size/2 + 2);
        }
        
        // Draw warp preparation effect if ship is preparing for warp
        if (obj.warpPhase && (obj.warpPhase === 'preparing' || obj.warpPhase === 'ready')) {
            this.drawWarpPreparationEffect(ctx, obj, x, y, size);
        }
    }
    
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
        const preparationTurns = ship.warpPreparationTurns || 0;
        
        if (phase === 'preparing') {
            // Charging effect - intensifies over time
            const intensity = Math.min(1.0, preparationTurns / 2);
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
            ctx.fillText(`Charging ${preparationTurns}/2`, x, y + size/2 + 5);
            
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

    // Draw selection highlight
    drawSelection(ctx, centerX, centerY) {
        if (!this.selectedUnit) return;
        
        const screenX = centerX + (this.selectedUnit.x - this.camera.x) * this.tileSize;
        const screenY = centerY + (this.selectedUnit.y - this.camera.y) * this.tileSize;
        const size = this.tileSize;
        
        // Animated selection ring
        const time = Date.now() / 1000;
        const alpha = 0.5 + 0.3 * Math.sin(time * 3);
        
        ctx.strokeStyle = `rgba(255, 193, 7, ${alpha})`;
        ctx.lineWidth = 3;
        ctx.setLineDash([5, 5]);
        ctx.strokeRect(screenX - size/2 - 5, screenY - size/2 - 5, size + 10, size + 10);
        ctx.setLineDash([]);
    }

    // Render mini-map
    renderMiniMap() {
        if (!this.miniCanvas || !this.objects) return;
        
        const ctx = this.miniCtx;
        const canvas = this.miniCanvas;
        
        // Clear mini-map
        ctx.fillStyle = '#0a0a1a';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // Draw sector boundary
        ctx.strokeStyle = 'rgba(100, 181, 246, 0.3)';
        ctx.lineWidth = 2;
        ctx.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);
        
        // Scale objects to mini-map
        const scaleX = canvas.width / 5000;
        const scaleY = canvas.height / 5000;
        
        // Separate objects by type for better rendering
        const celestialObjects = this.objects.filter(obj => this.isCelestialObject(obj));
        const resourceNodes = this.objects.filter(obj => obj.type === 'resource_node');
        const shipObjects = this.objects.filter(obj => !this.isCelestialObject(obj) && obj.type !== 'resource_node');
        
        // Draw celestial objects (but skip large field overlays for belts/nebulae)
        celestialObjects.forEach(obj => {
            const x = obj.x * scaleX;
            const y = obj.y * scaleY;
            const radius = obj.radius || 1;
            const meta = obj.meta || {};
            const celestialType = meta.celestialType || obj.celestial_type;
            
            // Skip drawing large circles for belts and nebulae - we'll show resource nodes instead
            if (celestialType === 'belt' || celestialType === 'nebula') {
                return;
            }
            
            // Calculate size based on object type and importance
            let size;
            if (celestialType === 'star') {
                size = Math.max(4, Math.min(radius * scaleX * 0.8, canvas.width * 0.08)); // Stars are prominent
            } else if (celestialType === 'planet') {
                size = Math.max(3, Math.min(radius * scaleX * 1.2, canvas.width * 0.06)); // Planets are visible
            } else if (celestialType === 'moon') {
                size = Math.max(2, Math.min(radius * scaleX * 1.5, canvas.width * 0.04)); // Moons are small but visible
            } else {
                size = Math.max(1, Math.min(radius * scaleX * 2, canvas.width * 0.05)); // Other objects
            }
            
            // Get celestial colors
            const colors = this.getCelestialColors(obj);
            ctx.fillStyle = colors.border;
            
            if (celestialType === 'star' || celestialType === 'planet' || celestialType === 'moon') {
                // Important objects - circles with better visibility
                ctx.beginPath();
                ctx.arc(x, y, size/2, 0, Math.PI * 2);
                ctx.fill();
                
                // Add a subtle glow for stars and planets
                if (celestialType === 'star' || celestialType === 'planet') {
                    ctx.strokeStyle = colors.border;
                    ctx.lineWidth = 1;
                    ctx.stroke();
                }
            } else {
                // Small objects - squares
                ctx.fillRect(x - size/2, y - size/2, size, size);
            }
        });
        
        // Draw resource nodes as small dots clustered by type
        const resourceFieldLabels = new Map(); // Track field centers for labels
        
        resourceNodes.forEach(obj => {
            const x = obj.x * scaleX;
            const y = obj.y * scaleY;
            const meta = obj.meta || {};
            const resourceType = meta.resourceType || 'unknown';
            const parentId = obj.parent_object_id;
            
            // Choose color based on resource type
            let nodeColor;
            switch (resourceType) {
                case 'rock':
                    nodeColor = '#8D6E63'; // Brown for rocks
                    break;
                case 'gas':
                    nodeColor = '#9C27B0'; // Purple for gas
                    break;
                case 'energy':
                    nodeColor = '#FFD54F'; // Yellow for energy
                    break;
                case 'salvage':
                    nodeColor = '#A1887F'; // Gray-brown for salvage
                    break;
                default:
                    nodeColor = '#757575'; // Gray for unknown
            }
            
            ctx.fillStyle = nodeColor;
            ctx.beginPath();
            ctx.arc(x, y, 1, 0, Math.PI * 2); // Small 1px dots
            ctx.fill();
            
            // Track field centers for labeling
            if (parentId && (resourceType === 'rock' || resourceType === 'gas')) {
                if (!resourceFieldLabels.has(parentId)) {
                    resourceFieldLabels.set(parentId, {
                        x: 0, y: 0, count: 0, type: resourceType, parentId: parentId
                    });
                }
                const field = resourceFieldLabels.get(parentId);
                field.x += x;
                field.y += y;
                field.count++;
            }
        });
        
        // Draw field labels for asteroid belts and nebulae
        resourceFieldLabels.forEach((field, parentId) => {
            const centerX = field.x / field.count;
            const centerY = field.y / field.count;
            
            // Find the parent celestial object to get its name
            const parentObject = celestialObjects.find(obj => obj.id === parentId);
            if (parentObject) {
                const parentMeta = parentObject.meta || {};
                const celestialType = parentMeta.celestialType || parentObject.celestial_type;
                
                let fieldName = '';
                if (field.type === 'rock' && celestialType === 'belt') {
                    fieldName = parentMeta.name || 'Asteroid Belt';
                } else if (field.type === 'gas' && celestialType === 'nebula') {
                    fieldName = parentMeta.name || 'Nebula Field';
                }
                
                if (fieldName) {
                    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
                    ctx.font = '8px Arial';
                    ctx.textAlign = 'center';
                    ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
                    ctx.shadowBlur = 1;
                    ctx.fillText(fieldName, centerX, centerY + 15);
                    ctx.shadowBlur = 0;
                }
            }
        });
        
        // Draw ships and stations on top
        shipObjects.forEach(obj => {
            const x = obj.x * scaleX;
            const y = obj.y * scaleY;
            const size = Math.max(2, 4 * scaleX);
            
            ctx.fillStyle = obj.owner_id === this.userId ? '#4caf50' : '#ff5722';
            ctx.fillRect(x - size/2, y - size/2, size, size);
        });
        
        // Fog mask on minimap (mirror of main fog)
        if (this.fogEnabled) {
            const ownedSensors = (this.objects || []).filter(obj => obj.owner_id === this.userId && (obj.type === 'ship' || obj.type === 'starbase' || obj.type === 'sensor-tower'));
            if (ownedSensors.length > 0) {
                // Base dark overlay
                ctx.save();
                ctx.fillStyle = 'rgba(0,0,0,0.6)';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.globalCompositeOperation = 'destination-out';
                ownedSensors.forEach(sensor => {
                    const meta = sensor.meta || {};
                    const scanRange = meta.scanRange || 5;
                    const sx = sensor.x * scaleX;
                    const sy = sensor.y * scaleY;
                    const radius = scanRange * Math.max(scaleX, scaleY);
                    const gradient = ctx.createRadialGradient(sx, sy, 0, sx, sy, Math.max(1, radius));
                    gradient.addColorStop(0, 'rgba(0,0,0,1)');
                    gradient.addColorStop(0.7, 'rgba(0,0,0,0.4)');
                    gradient.addColorStop(1, 'rgba(0,0,0,0)');
                    ctx.fillStyle = gradient;
                    ctx.beginPath();
                    ctx.arc(sx, sy, Math.max(1, radius), 0, Math.PI * 2);
                    ctx.fill();
                });
                ctx.restore();
            }
        }
        
        // Draw camera viewport
        const viewWidth = (this.canvas.width / this.tileSize) * scaleX;
        const viewHeight = (this.canvas.height / this.tileSize) * scaleY;
        const viewX = this.camera.x * scaleX - viewWidth/2;
        const viewY = this.camera.y * scaleY - viewHeight/2;
        
        ctx.strokeStyle = '#ffeb3b';
        ctx.lineWidth = 1;
        ctx.strokeRect(viewX, viewY, viewWidth, viewHeight);
        
        // Add system name at bottom of mini-map
        if (this.gameState && this.gameState.sector.name) {
            ctx.fillStyle = '#64b5f6';
            ctx.font = '11px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.fillText(
                this.gameState.sector.name, 
                canvas.width / 2, 
                canvas.height - 4
            );
        }
    }

    // Setup event listeners
    setupEventListeners() {
        // Canvas click for selection/movement
        this.canvas.addEventListener('click', (e) => this.handleCanvasClick(e));
        
        // Canvas right-click for movement/attack commands
        this.canvas.addEventListener('contextmenu', (e) => {
            e.preventDefault(); // Prevent context menu
            this.handleCanvasRightClick(e);
        });
        
        // Mouse move for cursor feedback and drag-pan
        this.canvas.addEventListener('mousemove', (e) => this.handleCanvasMouseMove(e));
        this.canvas.addEventListener('mousedown', (e) => this.startDragPan(e));
        this.canvas.addEventListener('mouseup', () => this.stopDragPan());
        this.canvas.addEventListener('mouseleave', () => this.stopDragPan());
        this.canvas.addEventListener('mousemove', (e) => this.handleDragPan(e));
        
        // Mouse wheel for zooming
        this.canvas.addEventListener('wheel', (e) => this.handleCanvasWheel(e));
        
        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => this.handleKeyboard(e));
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
        if (!this._floatingMini || !this.objects) return;
        const { canvas, ctx } = this._floatingMini;
        // Background
        ctx.fillStyle = '#0a0a1a';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.strokeStyle = 'rgba(100, 181, 246, 0.3)';
        ctx.lineWidth = 2; ctx.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);
        const scaleX = canvas.width / 5000, scaleY = canvas.height / 5000;
        // Celestials
        this.objects.filter(o=>this.isCelestialObject(o)).forEach(obj=>{
            const x = obj.x * scaleX, y = obj.y * scaleY; const meta = obj.meta||{}; const t = meta.celestialType || obj.celestial_type;
            if (t==='belt'||t==='nebula') return; ctx.fillStyle = this.getCelestialColors(obj).border; ctx.beginPath(); ctx.arc(x,y,2,0,Math.PI*2); ctx.fill();
        });
        // Ships/bases
        this.objects.filter(o=>!this.isCelestialObject(o)&&o.type!=='resource_node').forEach(o=>{
            const x = o.x * scaleX, y = o.y * scaleY; ctx.fillStyle = o.owner_id===this.userId?'#4CAF50':'#FF9800'; ctx.fillRect(x-2,y-2,4,4);
        });
        // Camera viewport box
        const viewW = canvas.width*(this.canvas.width/5000/ this.tileSize);
        const viewH = canvas.height*(this.canvas.height/5000/ this.tileSize);
        const vX = this.camera.x*scaleX - viewW/2; const vY = this.camera.y*scaleY - viewH/2;
        ctx.strokeStyle = '#ffeb3b'; ctx.lineWidth = 1; ctx.strokeRect(vX, vY, viewW, viewH);
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
            cameraY: this.camera.y
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
        this.render();
        this.renderMiniMap();
        this.renderFloatingMini();
    }

    // Handle mouse movement for cursor feedback
    handleCanvasMouseMove(e) {
        if (!this.selectedUnit || this.turnLocked) {
            this.canvas.style.cursor = 'default';
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
        
        // Check what's under the cursor (account for object radius)
        const hoveredObject = this.objects.find(obj => {
            const distance = Math.sqrt(Math.pow(obj.x - worldX, 2) + Math.pow(obj.y - worldY, 2));
            const hitRadius = Math.max(0.5, (obj.radius || 1) * 0.8); // Use object radius for hit detection
            return distance <= hitRadius;
        });
        
        if (hoveredObject) {
            if (hoveredObject.owner_id === this.userId) {
                this.canvas.style.cursor = 'pointer'; // Own unit - select
            } else {
                this.canvas.style.cursor = 'crosshair'; // Enemy - attack
            }
        } else if (this.selectedUnit.type === 'ship') {
            this.canvas.style.cursor = 'move'; // Empty space - move
        } else {
            this.canvas.style.cursor = 'default';
        }
    }

    // Update multi-sector fleet display
    async updateMultiSectorFleet() {
        const unitsList = document.getElementById('unitsList');
        if (!unitsList) {
            return;
        }

        try {
            // Load the full fleet across all sectors
            const response = await fetch(`/game/player-fleet?gameId=${this.gameId}&userId=${this.userId}`);
            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.error || 'Failed to load fleet');
            }

            const fleet = data.fleet;
            
            if (!fleet || fleet.length === 0) {
                unitsList.classList.remove('loading');
                unitsList.innerHTML = '<div class="no-units">No units found</div>';
                this.lastFleet = [];
                this.updatePlayerInformationPanel();
                return;
            }

            // Cache for stats strip and other UI
            this.lastFleet = fleet;
            this.updatePlayerInformationPanel();

            // Group units by sector
            const unitsBySector = {};
            fleet.forEach(unit => {
                const sectorName = unit.sector_name || 'Unknown Sector';
                if (!unitsBySector[sectorName]) {
                    unitsBySector[sectorName] = [];
                }
                unitsBySector[sectorName].push(unit);
            });

            // Build sector filter options
            const sectorFilterEl = document.getElementById('fleetSectorFilter');
            if (sectorFilterEl) {
                const current = sectorFilterEl.value || 'all';
                sectorFilterEl.innerHTML = '<option value="all">All Sectors</option>' +
                    Object.keys(unitsBySector).sort().map(s => `<option value="${s}">${s}</option>`).join('');
                if ([...sectorFilterEl.options].some(o => o.value === current)) sectorFilterEl.value = current;
            }

            // Read filters
            const q = (document.getElementById('fleetSearch')?.value || '').trim().toLowerCase();
            const typeFilter = document.getElementById('fleetTypeFilter')?.value || 'all';
            const statusFilter = document.getElementById('fleetStatusFilter')?.value || 'all';
            const sectorFilter = document.getElementById('fleetSectorFilter')?.value || 'all';
            const sortBy = document.getElementById('fleetSort')?.value || 'name';
            const onlyFav = document.getElementById('fleetFavoritesToggle')?.dataset?.active === '1';

            // Generate HTML for all sectors
            let html = '';
            Object.keys(unitsBySector).sort().forEach(sectorName => {
                const units = unitsBySector[sectorName];
                const isCurrentSector = this.gameState?.sector?.name === sectorName;
                if (sectorFilter !== 'all' && sectorFilter !== sectorName) return;

                html += `
                    <div class="sector-group">
                        <div class="sector-header ${isCurrentSector ? 'current-sector' : ''}" onclick="gameClient.toggleSectorCollapse('${sectorName.replace(/'/g, "\'")}')" data-sector="${sectorName}">
                            <span class="chevron">▶</span>
                            <span class="sector-icon">${isCurrentSector ? '📍' : '🌌'}</span>
                            <span class="sector-name">${sectorName}</span>
                            <span class="unit-count">(${units.length})</span>
                        </div>
                        <div class="sector-units" id="sector-units-${this.safeId(sectorName)}" style="display:grid;width:100%;box-sizing:border-box;">
                `;
                
                const filtered = units.filter(unit => {
                    const meta = unit.meta ? JSON.parse(unit.meta) : {};
                    if (onlyFav && !this.isFavoriteUnit(unit.id)) return false;
                    if (typeFilter !== 'all') {
                        const t = unit.type === 'ship' ? 'ship' : (unit.type === 'starbase' ? 'starbase' : 'structure');
                        if (t !== typeFilter) return false;
                    }
                    const status = this.getUnitStatus(meta, unit);
                    if (statusFilter !== 'all' && status !== statusFilter) return false;
                    const name = (meta.name || unit.type || '').toLowerCase();
                    if (q && !name.includes(q)) return false;
                    return true;
                }).sort((a,b)=>{
                    const ma = a.meta ? JSON.parse(a.meta) : {};
                    const mb = b.meta ? JSON.parse(b.meta) : {};
                    if (sortBy === 'name') return (ma.name||a.type).localeCompare(mb.name||b.type);
                    if (sortBy === 'status') return this.getUnitStatus(ma,a).localeCompare(this.getUnitStatus(mb,b));
                    if (sortBy === 'cargo') return (this.getCargoFill(b)-this.getCargoFill(a));
                    if (sortBy === 'eta') return (this.getEta(a)||999) - (this.getEta(b)||999);
                    return 0;
                });

                filtered.forEach(unit => {
                    const meta = unit.meta ? JSON.parse(unit.meta) : {};
                    const isSelected = this.selectedUnit && this.selectedUnit.id === unit.id;
                    const inCurrentSector = isCurrentSector;
                    const status = this.getUnitStatus(meta, unit);
                    const cargoFill = this.getCargoFill(unit);
                    const eta = this.getEta(unit);
                    
                    html += `
                        <div class="unit-item ${isSelected ? 'selected' : ''} ${!inCurrentSector ? 'remote-unit' : ''}" 
                             onclick="gameClient.selectRemoteUnit(${unit.id}, ${unit.sector_id}, '${sectorName}', ${inCurrentSector})">
                            <div class="unit-header">
                                <span class="unit-icon">${this.getUnitIcon(unit.type)}</span>
                                <span class="unit-name">${meta.name || unit.type}</span>
                                ${!inCurrentSector ? '<span class="remote-indicator">📡</span>' : ''}
                            </div>
                            <div class="unit-meta">
                                <span class="chip">${sectorName}</span>
                                <span class="chip ${status==='moving'?'status-moving':status==='mining'?'status-mining':(status==='docked'?'status-docked':'status-idle')}">${status==='moving'?'➜ Moving':status==='mining'?'⛏️ Mining':status==='docked'?'⚓ Docked':'Idle'}</span>
                                ${unit.type==='ship' && cargoFill!=null ? `<span class="chip">📦 ${cargoFill}</span>` : ''}
                                ${eta ? `<span class="chip">⏱️ ETA ${eta}</span>` : ''}
                                <span class="favorite ${this.isFavoriteUnit(unit.id)?'active':''}" onclick="event.stopPropagation();gameClient.toggleFavoriteUnit(${unit.id});">⭐</span>
                            </div>
                        </div>
                    `;
                });
                
                html += `
                        </div>
                    </div>
                `;
            });

            unitsList.classList.remove('loading');
            unitsList.innerHTML = html;

            // Update cargo status for ships in current sector (only displayed as chip; keep for right panel accuracy)
            if (this.gameState?.objects) {
                const currentSectorShips = this.gameState.objects.filter(obj => 
                    obj.owner_id === this.userId && obj.type === 'ship'
                );
                currentSectorShips.forEach(ship => {
                    updateCargoStatus(ship.id);
                });
            }

        } catch (error) {
            console.error('Error loading player fleet:', error);
            unitsList.classList.remove('loading');
            unitsList.innerHTML = '<div class="no-units">Error loading fleet</div>';
        }
    }

    // Hook up toolbar events (debounced)
    attachFleetToolbarHandlers() {
        const debounce = (fn, wait=200) => { let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn.apply(this,a), wait);} };
        ['fleetSearch','fleetTypeFilter','fleetStatusFilter','fleetSectorFilter','fleetSort'].forEach(id=>{
            const el = document.getElementById(id); if (!el) return;
            el.oninput = el.onchange = debounce(()=> this.updateMultiSectorFleet(), 180);
        });
        const fav = document.getElementById('fleetFavoritesToggle');
        if (fav) {
            fav.onclick = () => {
                const active = fav.dataset.active === '1';
                fav.dataset.active = active ? '0' : '1';
                fav.classList.toggle('sf-btn-primary', !active);
                fav.classList.toggle('sf-btn-secondary', active);
                this.updateMultiSectorFleet();
            };
        }
    }

    // Get appropriate icon for unit type
    getUnitIcon(unitType) {
        switch (unitType) {
            case 'ship': return '🚢';
            case 'starbase': return '🏭';
            case 'station': return '🛰️';
            case 'storage-structure': return '📦';
            case 'warp-beacon': return '🌌';
            case 'interstellar-gate': return '🌀';
            default: return '🏗️';
        }
    }

    // Select a unit (possibly in a remote sector)
    async selectRemoteUnit(unitId, sectorId, sectorName, inCurrentSector) {
        if (inCurrentSector) {
            // Unit is in current sector, select normally
            this.selectUnit(unitId);
        } else {
            // Unit is in remote sector, switch to that sector
            try {
                const response = await fetch('/game/switch-sector', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        gameId: this.gameId,
                        userId: this.userId,
                        sectorId: sectorId
                    })
                });

                const data = await response.json();
                
                if (response.ok) {
                    // Update game state to new sector
                    this.gameState = data.gameState;
                    this.addLogEntry(`Switched to ${sectorName}`, 'info');
                    
                    // Update the UI
                    this.updateUI();
                    this.render();
                    this.renderMiniMap();
                    this.updateSectorOverviewTitle();
                    
                    // Select the unit in the new sector
                    setTimeout(() => {
                        this.selectUnit(unitId);
                    }, 100);
                } else {
                    this.addLogEntry(data.error || 'Failed to switch sectors', 'error');
                }
            } catch (error) {
                console.error('Error switching sectors:', error);
                this.addLogEntry('Failed to switch sectors', 'error');
            }
        }
    }

    // Helpers for left panel chips
    getUnitStatus(meta, unit) {
        // Derive status from known fields
        if (unit.harvestingStatus === 'active' || meta.mining === true) return 'mining';
        if (unit.movement_path || meta.moving === true) return 'moving';
        if (meta.docked) return 'docked';
        return 'idle';
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

    // Check if a ship is adjacent to an interstellar gate
    isAdjacentToInterstellarGate(ship) {
        if (!ship || !this.objects) return false;
        
        const adjacentGates = this.objects.filter(obj => {
            if (obj.type !== 'interstellar-gate') return false;
            
            const dx = Math.abs(obj.x - ship.x);
            const dy = Math.abs(obj.y - ship.y);
            return dx <= 1 && dy <= 1 && !(dx === 0 && dy === 0);
        });
        
        return adjacentGates.length > 0;
    }

    // Get adjacent interstellar gates
    getAdjacentInterstellarGates(ship) {
        if (!ship || !this.objects) return [];
        
        return this.objects.filter(obj => {
            if (obj.type !== 'interstellar-gate') return false;
            
            const dx = Math.abs(obj.x - ship.x);
            const dy = Math.abs(obj.y - ship.y);
            return dx <= 1 && dy <= 1 && !(dx === 0 && dy === 0);
        });
    }

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

    // Handle canvas clicks (left-click for unit selection only)
    handleCanvasClick(e) {
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
        const clickedObject = this.objects.find(obj => {
            const distance = Math.sqrt(Math.pow(obj.x - worldX, 2) + Math.pow(obj.y - worldY, 2));
            const hitRadius = Math.max(0.5, (obj.radius || 1) * 0.8); // Use object radius for hit detection
            return distance <= hitRadius;
        });
        
        if (clickedObject && clickedObject.owner_id === this.userId) {
            // Select owned unit
            this.selectUnit(clickedObject.id);
            console.log(`Selected unit: ${clickedObject.meta.name || clickedObject.type}`);
        } else if (clickedObject) {
            // Clicked on enemy/neutral object - just show info, don't select
            this.addLogEntry(`Detected ${clickedObject.meta.name || clickedObject.type} (${clickedObject.owner_id === this.userId ? 'Friendly' : 'Enemy'})`, 'info');
        } else {
            // Clicked on empty space - deselect current unit
            if (this.selectedUnit) {
                console.log(`Deselected unit: ${this.selectedUnit.meta.name || this.selectedUnit.type}`);
                this.selectedUnit = null;
                this.selectedObjectId = null; // STAGE B: Clear ID tracking
                
                // Update unit details panel to show nothing selected
                this.updateUnitDetails();
                
                // Re-render to remove selection highlight
                this.render(); 
            }
        }
    }

    // Handle canvas right-clicks for movement/attack
    handleCanvasRightClick(e) {
        if (!this.selectedUnit || this.turnLocked) return;
        
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        // Convert screen coordinates to world coordinates
        const centerX = this.canvas.width / 2;
        const centerY = this.canvas.height / 2;
        const worldX = Math.round(this.camera.x + (x - centerX) / this.tileSize);
        const worldY = Math.round(this.camera.y + (y - centerY) / this.tileSize);
        
        console.log(`Right-clicked world position: (${worldX}, ${worldY}) - checking for move/attack command`);
        
        // Check if right-clicking on an object (account for object radius)
        // Exclude large celestial objects from right-click targeting to allow movement within them
        const clickedObject = this.objects.find(obj => {
            // Skip large celestial objects for right-click targeting
            if (this.isCelestialObject(obj) && obj.radius > 50) {
                return false; // Allow movement through/within large celestial objects
            }
            
            const distance = Math.sqrt(Math.pow(obj.x - worldX, 2) + Math.pow(obj.y - worldY, 2));
            const hitRadius = Math.max(0.5, (obj.radius || 1) * 0.8); // Use object radius for hit detection
            return distance <= hitRadius;
        });
        
        if (clickedObject) {
            if (clickedObject.owner_id === this.userId) {
                // Right-clicked on own unit - show context menu or info
                this.addLogEntry(`Selected ${clickedObject.meta.name || clickedObject.type}`, 'info');
            } else {
                // Right-clicked on enemy/neutral object - attack command
                this.handleAttackCommand(clickedObject, worldX, worldY);
            }
        } else {
            // Right-clicked on empty space - movement command
            this.handleMoveCommand(worldX, worldY);
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
        } else {
            this.addLogEntry('Invalid movement destination', 'warning');
        }
    }

    // Handle attack command (right-click on enemy)
    handleAttackCommand(target, worldX, worldY) {
        if (!this.selectedUnit || this.selectedUnit.type !== 'ship') {
            this.addLogEntry('Only ships can attack', 'warning');
            return;
        }
        
        const distance = Math.sqrt(
            Math.pow(this.selectedUnit.x - target.x, 2) + 
            Math.pow(this.selectedUnit.y - target.y, 2)
        );
        
        const attackRange = this.selectedUnit.meta.attackRange || 1;
        
        if (distance > attackRange) {
            // Too far to attack - move into range first
            this.addLogEntry(`Target out of range. Moving to attack ${target.meta.name || target.type}`, 'warning');
            
            // Calculate position just within attack range
            const dx = target.x - this.selectedUnit.x;
            const dy = target.y - this.selectedUnit.y;
            const length = Math.sqrt(dx * dx + dy * dy);
            const moveToX = Math.round(target.x - (dx / length) * (attackRange * 0.9));
            const moveToY = Math.round(target.y - (dy / length) * (attackRange * 0.9));
            
            // Move into range, then attack next turn
            this.handleMoveCommand(moveToX, moveToY);
            
            // Store attack target for next turn
            this.selectedUnit.pendingAttackTarget = target.id;
            
        } else {
            // In range - issue attack command
            this.addLogEntry(`${this.selectedUnit.meta.name} attacking ${target.meta.name || target.type}!`, 'success');
            
            // TODO: Send attack command to server
            this.socket.emit('attack-target', {
                gameId: this.gameId,
                attackerId: this.selectedUnit.id,
                targetId: target.id,
                attackerPosition: { x: this.selectedUnit.x, y: this.selectedUnit.y },
                targetPosition: { x: target.x, y: target.y }
            });
        }
    }

    // Handle keyboard input
    handleKeyboard(e) {
        switch(e.key) {
            case 'Escape':
                this.selectedUnit = null;
                this.selectedObjectId = null; // STAGE B: Clear ID tracking
                this.updateUnitDetails();
                this.render();
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

    // Bresenham line algorithm for tile-based pathfinding
    calculateMovementPath(startX, startY, endX, endY) {
        const path = [];
        let x0 = Math.round(startX);
        let y0 = Math.round(startY);
        const x1 = Math.round(endX);
        const y1 = Math.round(endY);
        
        const dx = Math.abs(x1 - x0);
        const dy = Math.abs(y1 - y0);
        const sx = x0 < x1 ? 1 : -1;
        const sy = y0 < y1 ? 1 : -1;
        let err = dx - dy;
        
        while (true) {
            path.push({ x: x0, y: y0 });
            
            if (x0 === x1 && y0 === y1) break;
            
            const e2 = 2 * err;
            if (e2 > -dy) {
                err -= dy;
                x0 += sx;
            }
            if (e2 < dx) {
                err += dx;
                y0 += sy;
            }
        }
        
        return path;
    }

    // Calculate ETA for movement path
    calculateETA(path, movementSpeed) {
        if (!path || path.length <= 1) return 0;
        const distance = path.length - 1; // Exclude starting position
        return Math.ceil(distance / (movementSpeed || 1));
    }

    // Draw movement paths for all visible ships with movement orders (active and lingering)
    drawMovementPaths(ctx, centerX, centerY) {
        // STAGE 2 & 4: Include both active and completed movements with safety checks
        const activeShips = this.objects.filter(obj => 
            obj.type === 'ship' && 
            obj.movementPath && 
            obj.movementPath.length > 1 && // Safety: ensure valid path
            obj.movementActive &&
            obj.movementStatus === 'active' &&
            (obj.visibilityStatus?.visible || obj.owner_id === this.userId)
        );
        
        const serverLingeringShips = this.objects.filter(obj => 
            obj.type === 'ship' && 
            obj.movementPath && 
            obj.movementPath.length > 1 && // Safety: ensure valid path
            obj.movementStatus === 'completed' &&
            (obj.visibilityStatus?.visible || obj.owner_id === this.userId)
        );
        
        // FIX 4: Debug logging for lingering trails
        if (serverLingeringShips.length > 0) {
            console.log(`🔍 Found ${serverLingeringShips.length} server lingering ships:`, 
                serverLingeringShips.map(s => ({
                    id: s.id, 
                    name: s.meta?.name, 
                    status: s.movementStatus,
                    pathLength: s.movementPath?.length,
                    visible: s.visibilityStatus?.visible,
                    owned: s.owner_id === this.userId
                }))
            );
        }
        
        // PHASE 3: Include client-side lingering trails (both old and new format)
        const clientLingeringShips = this.clientLingeringTrails.filter(trail => {
            const hasValidPath = (trail.movementPath && trail.movementPath.length > 1) || 
                                 (trail.movementSegments && trail.movementSegments.length > 0);
            const isVisible = trail.visibilityStatus?.visible || trail.owner_id === this.userId;
            return hasValidPath && isVisible;
        });
        
        if (clientLingeringShips.length > 0) {
            const currentTurn = this.gameState?.currentTurn?.turn_number || 1;
            console.log(`🔍 Found ${clientLingeringShips.length} client lingering trails:`, 
                clientLingeringShips.map(t => ({
                    shipId: t.shipId, 
                    name: t.meta?.name, 
                    pathLength: t.movementPath?.length,
                    ageInTurns: currentTurn - (t.createdOnTurn || 0),
                    createdOnTurn: t.createdOnTurn
                }))
            );
        }
        
        const allLingeringShips = [...serverLingeringShips, ...clientLingeringShips];
        
        // STAGE 4: Safety check - ensure no ship appears in both lists
        const activeShipIds = new Set(activeShips.map(s => s.id));
        const filteredLingeringShips = allLingeringShips.filter(ship => !activeShipIds.has(ship.id || ship.shipId));
        
        if (allLingeringShips.length !== filteredLingeringShips.length) {
            console.log(`🛡️ Filtered ${allLingeringShips.length - filteredLingeringShips.length} ships with conflicting active/lingering status`);
        }
        
        if (activeShips.length > 0 || filteredLingeringShips.length > 0) {
            console.log(`🎨 Drawing ${activeShips.length} active trails + ${filteredLingeringShips.length} lingering trails`);
        }
        
        // Draw lingering trails first (behind active trails)
        filteredLingeringShips.forEach(ship => {
            this.drawSingleMovementPath(ctx, centerX, centerY, ship, true); // true = lingering
        });
        
        // Draw active trails on top
        activeShips.forEach(ship => {
            this.drawSingleMovementPath(ctx, centerX, centerY, ship, false); // false = active
        });
    }

    // PHASE 3: Draw movement path for a single ship (supports both old paths and new segments)
    drawSingleMovementPath(ctx, centerX, centerY, ship, isLingering = false) {
        // PHASE 3: Support both old movementPath and new movementSegments  
        const hasOldPath = ship.movementPath && ship.movementPath.length > 1;
        const hasNewSegments = ship.movementSegments && ship.movementSegments.length > 0;
        
        if (!hasOldPath && !hasNewSegments) return;
        
        // FIX 4: Additional safety checks for consistent rendering
        if (isLingering && ship.movementStatus === 'active') {
            console.warn(`⚠️ Skipping rendering of active ship ${ship.id} as lingering trail`);
            return;
        }
        
        if (!isLingering && ship.movementStatus === 'completed' && !ship.movementActive) {
            console.warn(`⚠️ Skipping rendering of completed ship ${ship.id} as active trail`);
            return;
        }
        
        const isSelected = this.selectedUnit && this.selectedUnit.id === ship.id;
        const isOwned = ship.owner_id === this.userId;
        const isAccurate = ship.isAccurate === true; // PHASE 3: Check if this is accurate trail
        
        ctx.save();
        
        // PHASE 3: Enhanced visual distinction for different trail types
        if (isLingering) {
            // Lingering trails - different styles for accurate vs fallback
            if (isAccurate) {
                // Accurate trails (from actual movement history) - solid faded lines
                if (isSelected) {
                    ctx.strokeStyle = '#fff59d'; // Faded yellow for selected accurate
                    ctx.lineWidth = 2;
                    ctx.globalAlpha = 0.5;
                } else if (isOwned) {
                    ctx.strokeStyle = '#a5d6a7'; // Slightly brighter green for accurate owned
                    ctx.lineWidth = 1.5;
                    ctx.globalAlpha = 0.4;
                } else {
                    ctx.strokeStyle = '#ef9a9a'; // Slightly brighter red for accurate enemy
                    ctx.lineWidth = 1.5;
                    ctx.globalAlpha = 0.35;
                }
                ctx.setLineDash([2, 4]); // Shorter dashes for accurate trails
            } else {
                // Fallback trails (from planned paths) - more faded, longer dashes
                if (isSelected) {
                    ctx.strokeStyle = '#fff9c4'; // Very faded yellow for selected fallback
                    ctx.lineWidth = 1.5;
                    ctx.globalAlpha = 0.3;
                } else if (isOwned) {
                    ctx.strokeStyle = '#c8e6c9'; // Standard faded green for fallback owned
                    ctx.lineWidth = 1;
                    ctx.globalAlpha = 0.25;
                } else {
                    ctx.strokeStyle = '#ffcdd2'; // Standard faded red for fallback enemy
                    ctx.lineWidth = 1;
                    ctx.globalAlpha = 0.2;
                }
                ctx.setLineDash([3, 8]); // Longer dashes for fallback effect
            }
        } else {
            // Active trails - normal bright styling (unchanged)
            if (isSelected) {
                // Selected unit - bright yellow (regardless of ownership)
                ctx.strokeStyle = '#ffeb3b';
                ctx.lineWidth = 3;
                ctx.globalAlpha = 1.0;
            } else if (isOwned) {
                // Own ship - green/yellow
                ctx.strokeStyle = '#8bc34a';
                ctx.lineWidth = 2;
                ctx.globalAlpha = 0.8;
            } else {
                // Enemy ship - red/orange
                ctx.strokeStyle = '#f44336';
                ctx.lineWidth = 2;
                ctx.globalAlpha = 0.7;
            }
            ctx.setLineDash([5, 5]); // Normal dashes for active trails
        }
        
        // PHASE 3: Draw path - support both old path format and new segments format
        if (hasNewSegments) {
            // Draw segments (accurate movement history)
            ship.movementSegments.forEach(segment => {
                ctx.beginPath();
                const fromScreenX = centerX + (segment.from.x - this.camera.x) * this.tileSize;
                const fromScreenY = centerY + (segment.from.y - this.camera.y) * this.tileSize;
                const toScreenX = centerX + (segment.to.x - this.camera.x) * this.tileSize;
                const toScreenY = centerY + (segment.to.y - this.camera.y) * this.tileSize;
                
                ctx.moveTo(fromScreenX, fromScreenY);
                ctx.lineTo(toScreenX, toScreenY);
                ctx.stroke();
            });
        } else if (hasOldPath) {
            // Draw traditional path (planned route)
            const path = ship.movementPath;
            ctx.beginPath();
            for (let i = 0; i < path.length; i++) {
                const tile = path[i];
                const screenX = centerX + (tile.x - this.camera.x) * this.tileSize;
                const screenY = centerY + (tile.y - this.camera.y) * this.tileSize;
                
                if (i === 0) {
                    ctx.moveTo(screenX, screenY);
                } else {
                    ctx.lineTo(screenX, screenY);
                }
            }
            ctx.stroke();
        }
        
        // Draw current position marker (ship's actual current tile)
        const currentScreenX = centerX + (ship.x - this.camera.x) * this.tileSize;
        const currentScreenY = centerY + (ship.y - this.camera.y) * this.tileSize;
        
        ctx.setLineDash([]);
        
        // STAGE 2: Different markers for lingering vs active trails
        if (!isLingering) {
            // Only draw current position marker for active trails
            if (isSelected) {
                ctx.fillStyle = '#4caf50'; // Green for selected
            } else if (isOwned) {
                ctx.fillStyle = '#66bb6a'; // Light green for owned
            } else {
                ctx.fillStyle = '#ef5350'; // Light red for enemy
            }
            
            ctx.beginPath();
            ctx.arc(currentScreenX, currentScreenY, isSelected ? 7 : 5, 0, Math.PI * 2);
            ctx.fill();
        }
        
        // PHASE 3: Draw destination marker (support both old path and new segments)
        let destinationPoint = null;
        
        if (hasNewSegments && ship.movementSegments.length > 0) {
            // For segments, use the last segment's 'to' position as destination
            const lastSegment = ship.movementSegments[ship.movementSegments.length - 1];
            destinationPoint = lastSegment.to;
        } else if (hasOldPath) {
            // For old paths, use the last point as destination
            const path = ship.movementPath;
            destinationPoint = path[path.length - 1];
        }
        
        if (destinationPoint) {
            const destScreenX = centerX + (destinationPoint.x - this.camera.x) * this.tileSize;
            const destScreenY = centerY + (destinationPoint.y - this.camera.y) * this.tileSize;
            
            if (isLingering) {
                // Faded destination markers for lingering trails
                if (isSelected) {
                    ctx.fillStyle = '#fff59d'; // Faded yellow
                } else if (isOwned) {
                    ctx.fillStyle = '#c8e6c9'; // Faded green  
                } else {
                    ctx.fillStyle = '#ffcdd2'; // Faded red
                }
                ctx.globalAlpha = 0.3; // Extra fading for destination
                ctx.beginPath();
                ctx.arc(destScreenX, destScreenY, 4, 0, Math.PI * 2); // Smaller marker
                ctx.fill();
            } else {
                // Normal bright destination markers for active trails
                if (isSelected) {
                    ctx.fillStyle = '#ffeb3b'; // Yellow for selected
                } else if (isOwned) {
                    ctx.fillStyle = '#8bc34a'; // Green for owned
                } else {
                    ctx.fillStyle = '#f44336'; // Red for enemy
                }
                
                ctx.beginPath();
                ctx.arc(destScreenX, destScreenY, isSelected ? 8 : 6, 0, Math.PI * 2);
                ctx.fill();
                
                // Draw ETA near destination (only for active trails and owned ships)
                if (isSelected || isOwned) {
                    // PHASE 3: Use server-provided ETA, fallback to path calculation if available
                    let eta = ship.movementETA;
                    let usingServerETA = ship.movementETA !== undefined;
                    
                    // If no server ETA and we have old path format, calculate it
                    if (eta === undefined && hasOldPath) {
                        const path = ship.movementPath;
                        eta = this.calculateETA(path, ship.meta.movementSpeed || 1);
                        usingServerETA = false;
                    } else if (eta === undefined) {
                        // For segments format, we don't calculate ETA (should come from server)
                        eta = 0;
                        usingServerETA = false;
                    }
                    
                    // Debug logging for ETA source (only once per render to avoid spam)
                    if (isSelected && !this._lastETADebug || this._lastETADebug !== `${ship.id}-${eta}`) {
                        console.log(`📊 ETA Display: Ship ${ship.id} showing ${eta}T (${usingServerETA ? 'server-provided' : 'client-calculated'})`);
                        this._lastETADebug = `${ship.id}-${eta}`;
                    }
                    
                    if (eta > 0) {
                        ctx.fillStyle = '#ffffff';
                        ctx.font = '12px Arial';
                        ctx.textAlign = 'center';
                        ctx.fillText(`ETA: ${eta}T`, destScreenX, destScreenY - 15);
                    }
                }
            }
        }
        
        ctx.restore();
    }


    
    // Show warp confirmation dialog
    showWarpConfirmation(target) {
        const distance = Math.sqrt(
            Math.pow(this.selectedUnit.x - target.x, 2) + 
            Math.pow(this.selectedUnit.y - target.y, 2)
        );
        
        const modalContent = document.createElement('div');
        modalContent.innerHTML = `
            <div class="warp-confirmation">
                <h3>🌌 Warp Jump Confirmation</h3>
                <div class="warp-info">
                    <p><strong>Ship:</strong> ${this.selectedUnit.meta.name}</p>
                    <p><strong>Destination:</strong> ${target.meta.name || target.type}</p>
                    <p><strong>Distance:</strong> ${Math.round(distance)} tiles</p>
                    <p><strong>Preparation Time:</strong> 2 turns</p>
                    <p><strong>Jump Time:</strong> Instant</p>
                </div>
                <div class="warp-warning">
                    ⚠️ Warp preparation cannot be interrupted once started
                </div>
            </div>
        `;
        
        UI.showModal({
            title: '🌌 Warp Jump',
            content: modalContent,
            actions: [
                {
                    text: 'Cancel',
                    style: 'secondary',
                    action: () => true // Close modal
                },
                {
                    text: 'Engage Warp Drive',
                    style: 'primary',
                    action: () => this.executeWarpOrder(target)
                }
            ]
        });
    }
    
    // Execute warp order
    executeWarpOrder(target) {
        console.log(`🌌 Initiating warp from (${this.selectedUnit.x},${this.selectedUnit.y}) to ${target.meta.name} at (${target.x},${target.y})`);
        
        // Send warp order to server
        this.socket.emit('warp-ship', {
            gameId: this.gameId,
            shipId: this.selectedUnit.id,
            targetId: target.id,
            targetX: target.x,
            targetY: target.y,
            shipName: this.selectedUnit.meta.name,
            targetName: target.meta.name
        });
        
        this.addLogEntry(`${this.selectedUnit.meta.name} engaging warp drive. Target: ${target.meta.name}`, 'success');
        return true; // Close modal
    }
    
    // Enter warp target selection mode - show popup menu
    enterWarpMode() {
        this.showWarpTargetSelection();
    }
    
    // Show warp target selection popup
    showWarpTargetSelection() {
        const ship = this.selectedUnit;
        if (!ship) return;
        
        // Get all possible warp targets
        const warpTargets = this.getWarpTargets(ship);
        
        if (warpTargets.length === 0) {
            this.addLogEntry('No warp targets available in this sector', 'warning');
            return;
        }
        
        // Create target selection content
        const targetList = document.createElement('div');
        targetList.className = 'warp-target-list';
        
        // Add header
        const header = document.createElement('div');
        header.className = 'warp-target-header';
        header.innerHTML = `
            <h3>🌌 Select Warp Destination</h3>
            <p>Choose where ${ship.meta.name} should warp to:</p>
        `;
        targetList.appendChild(header);
        
        // Add target options
        warpTargets.forEach(target => {
            const targetOption = document.createElement('div');
            targetOption.className = 'warp-target-option';
            
            const distance = Math.sqrt(
                Math.pow(ship.x - target.x, 2) + 
                Math.pow(ship.y - target.y, 2)
            );
            
            const targetIcon = this.getWarpTargetIcon(target);
            const targetType = this.getWarpTargetType(target);
            
            targetOption.innerHTML = `
                <div class="warp-target-info">
                    <div class="warp-target-name">
                        ${targetIcon} ${target.meta.name || target.type}
                    </div>
                    <div class="warp-target-details">
                        <span class="warp-target-type">${targetType}</span>
                        <span class="warp-target-distance">${Math.round(distance)} tiles away</span>
                    </div>
                </div>
                <div class="warp-target-action">
                    <button class="warp-select-btn">Select</button>
                </div>
            `;
            
            // Add click handler
            const selectBtn = targetOption.querySelector('.warp-select-btn');
            selectBtn.addEventListener('click', () => {
                this.showWarpConfirmation(target);
            });
            
            targetList.appendChild(targetOption);
        });
        
        // Show modal with target list
        UI.showModal({
            title: '🌌 Warp Target Selection',
            content: targetList,
            actions: [
                {
                    text: 'Cancel',
                    style: 'secondary',
                    action: () => {
                        this.addLogEntry('Warp target selection cancelled', 'info');
                        return true; // Close modal
                    }
                }
            ],
            className: 'warp-target-modal'
        });
    }
    
    // Get all available warp targets for a ship
    getWarpTargets(ship) {
        const targets = [];
        
        // Add celestial objects
        const celestialObjects = this.objects.filter(obj => this.isCelestialObject(obj));
        targets.push(...celestialObjects);
        
        // Add player-owned structures (starbases, stations, etc.)
        const playerStructures = this.objects.filter(obj => 
            obj.owner_id === this.userId && 
            (obj.type === 'starbase' || obj.type === 'station') && 
            obj.id !== ship.id // Don't include the ship itself
        );
        targets.push(...playerStructures);
        
        // Add warp beacons
        const warpBeacons = this.objects.filter(obj => 
            obj.type === 'warp-beacon' && 
            (obj.owner_id === this.userId || obj.meta?.publicAccess === true)
        );
        targets.push(...warpBeacons);
        
        // Add interstellar gates
        const interstellarGates = this.objects.filter(obj => 
            obj.type === 'interstellar-gate' && 
            (obj.owner_id === this.userId || obj.meta?.publicAccess === true)
        );
        targets.push(...interstellarGates);
        
        // Sort by distance
        targets.sort((a, b) => {
            const distA = Math.sqrt(Math.pow(ship.x - a.x, 2) + Math.pow(ship.y - a.y, 2));
            const distB = Math.sqrt(Math.pow(ship.x - b.x, 2) + Math.pow(ship.y - b.y, 2));
            return distA - distB;
        });
        
        return targets;
    }
    
    // Get icon for warp target type
    getWarpTargetIcon(target) {
        if (target.celestial_type) {
            // Celestial objects
            switch (target.celestial_type) {
                case 'star': return '⭐';
                case 'planet': return '🪐';
                case 'moon': return '🌙';
                case 'belt': return '☄️';
                case 'nebula': return '🌌';
                case 'wormhole': return '🕳️';
                case 'derelict': return '🛸';
                default: return '🌟';
            }
        } else {
            // Player structures
            switch (target.type) {
                case 'starbase': return '🏭';
                case 'station': return '🛰️';
                case 'warp-beacon': return '🌌';
                case 'storage-structure': return '📦';
                case 'interstellar-gate': return '🌀';
                default: return '🏗️';
            }
        }
    }
    
    // Get readable type name for warp target
    getWarpTargetType(target) {
        if (target.celestial_type) {
            // Celestial objects
            switch (target.celestial_type) {
                case 'star': return 'Star System';
                case 'planet': return 'Planet';
                case 'moon': return 'Moon';
                case 'belt': return 'Asteroid Belt';
                case 'nebula': return 'Nebula';
                case 'wormhole': return 'Wormhole';
                case 'derelict': return 'Derelict';
                default: return 'Celestial Object';
            }
        } else {
            // Player structures
            if (target.owner_id === this.userId) {
                switch (target.type) {
                    case 'starbase': return 'Your Starbase';
                    case 'station': return 'Your Station';
                    case 'warp-beacon': return 'Your Warp Beacon';
                    case 'storage-structure': return 'Your Storage';
                    case 'interstellar-gate': return 'Your Interstellar Gate';
                    default: return 'Your Structure';
                }
            } else if (target.type === 'warp-beacon' && target.meta?.publicAccess === true) {
                return 'Public Warp Beacon';
            } else if (target.type === 'interstellar-gate' && target.meta?.publicAccess === true) {
                return `Gate to ${target.meta?.destinationSectorName || 'Unknown Sector'}`;
            } else {
                return 'Allied Structure';
            }
        }
    }
    
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

    // Show setup modal for first-time player configuration
    showSetupModal() {
        const setupForm = this.createSetupForm();
        
        UI.showModal({
            title: '🚀 Initialize Your Solar System',
            content: setupForm,
            allowClose: false, // Force completion
            actions: [
                {
                    text: 'Complete Setup',
                    style: 'primary',
                    action: () => this.submitSetup()
                }
            ]
        });
    }

    // Create the setup form HTML
    createSetupForm() {
        const form = document.createElement('div');
        form.className = 'setup-form';
        form.innerHTML = `
            <div class="form-section">
                <h3>👤 Choose Your Avatar</h3>
                <div class="avatar-grid" id="avatarGrid">
                    ${this.createAvatarSelector()}
                </div>
            </div>

            <div class="form-section">
                <h3>🎨 Color Scheme</h3>
                <div class="color-picker-group">
                    <div class="color-picker">
                        <label for="primaryColor">Primary Color:</label>
                        <input type="color" id="primaryColor" value="#64b5f6">
                    </div>
                    <div class="color-picker">
                        <label for="secondaryColor">Secondary Color:</label>
                        <input type="color" id="secondaryColor" value="#42a5f5">
                    </div>
                </div>
            </div>

            <div class="form-section">
                <h3>🌌 Solar System Name</h3>
                <input type="text" id="systemName" class="form-input" placeholder="Enter system name..." maxlength="30" required>
            </div>

            <div class="form-section">
                <h3>⭐ System Archetype</h3>
                <div class="archetype-grid" id="archetypeGrid">
                    ${this.createArchetypeSelector()}
                </div>
            </div>
        `;

        // Add event listeners after creating the form
        setTimeout(() => {
            this.attachSetupEventListeners();
        }, 100);

        return form;
    }

    // Create avatar selector options
    createAvatarSelector() {
        const avatars = [
            { id: 'commander', name: 'Commander' },
            { id: 'explorer', name: 'Explorer' },
            { id: 'merchant', name: 'Merchant' },
            { id: 'scientist', name: 'Scientist' },
            { id: 'warrior', name: 'Warrior' },
            { id: 'diplomat', name: 'Diplomat' }
        ];
        
        return avatars.map(avatar => `
            <div class="avatar-option" data-avatar="${avatar.id}">
                <img src="assets/avatars/${avatar.id}.png" alt="${avatar.name}" onerror="this.src='data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHZpZXdCb3g9IjAgMCA0MCA0MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iMjAiIGN5PSIyMCIgcj0iMjAiIGZpbGw9IiM2NGI1ZjYiLz4KPHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIiB4PSI4IiB5PSI4Ij4KPHBhdGggZD0iTTEyIDJDMTMuMSAyIDE0IDIuOSAxNCA0QzE0IDUuMSAxMy4xIDYgMTIgNkMxMC45IDYgMTAgNS4xIDEwIDRDMTAgMi45IDEwLjkgMiAxMiAyWk0yMSAxOVYyMEgzVjE5TDUgMTcuMjVWMTFIMTBWMTIuNUgxNFYxMUgxOVYxNy4yNUwyMSAxOVoiIGZpbGw9IndoaXRlIi8+Cjwvc3ZnPgo8L3N2Zz4K'; this.onerror=null;">
                <span>${avatar.name}</span>
            </div>
        `).join('');
    }

    // Create archetype selector options
    createArchetypeSelector() {
        const archetypes = {
            'resource-rich': {
                name: 'Resource Rich',
                desc: 'Abundant minerals and energy sources',
                bonus: '+25% resource generation'
            },
            'asteroid-heavy': {
                name: 'Asteroid Belt',
                desc: 'Dense asteroid fields provide cover',
                bonus: '+15% stealth, mining opportunities'
            },
            'nebula': {
                name: 'Nebula Cloud',
                desc: 'Colorful gas clouds affect sensors',
                bonus: '+20% scan range, -10% accuracy'
            },
            'binary-star': {
                name: 'Binary Star',
                desc: 'Dual star system with high energy',
                bonus: '+30% energy output, extreme temperatures'
            }
        };

        return Object.entries(archetypes).map(([key, archetype]) => `
            <div class="archetype-card" data-archetype="${key}">
                <h4>${archetype.name}</h4>
                <p>${archetype.desc}</p>
                <div class="archetype-bonus">${archetype.bonus}</div>
            </div>
        `).join('');
    }

    // Attach event listeners to setup form elements
    attachSetupEventListeners() {
        // Avatar selection
        document.querySelectorAll('.avatar-option').forEach(option => {
            option.addEventListener('click', () => {
                document.querySelectorAll('.avatar-option').forEach(o => o.classList.remove('selected'));
                option.classList.add('selected');
            });
        });

        // Archetype selection
        document.querySelectorAll('.archetype-card').forEach(card => {
            card.addEventListener('click', () => {
                document.querySelectorAll('.archetype-card').forEach(c => c.classList.remove('selected'));
                card.classList.add('selected');
            });
        });

        // Auto-focus system name input
        const systemNameInput = document.getElementById('systemName');
        if (systemNameInput) {
            systemNameInput.focus();
        }
    }

    // Submit setup data to server
    async submitSetup() {
        const selectedAvatar = document.querySelector('.avatar-option.selected')?.dataset.avatar;
        const selectedArchetype = document.querySelector('.archetype-card.selected')?.dataset.archetype;
        const primaryColor = document.getElementById('primaryColor')?.value;
        const secondaryColor = document.getElementById('secondaryColor')?.value;
        const systemName = document.getElementById('systemName')?.value?.trim();

        // Validate form
        if (!selectedAvatar) {
            UI.showAlert('Please select an avatar');
            return false;
        }
        if (!selectedArchetype) {
            UI.showAlert('Please select a system archetype');
            return false;
        }
        if (!systemName) {
            UI.showAlert('Please enter a system name');
            return false;
        }
        if (systemName.length > 30) {
            UI.showAlert('System name too long (max 30 characters)');
            return false;
        }

        try {
            console.log('Submitting setup data:', {
                userId: this.userId,
                avatar: selectedAvatar,
                colorPrimary: primaryColor,
                colorSecondary: secondaryColor,
                systemName: systemName,
                archetype: selectedArchetype
            });

            const response = await fetch(`/game/setup/${this.gameId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    userId: this.userId,
                    avatar: selectedAvatar,
                    colorPrimary: primaryColor,
                    colorSecondary: secondaryColor,
                    systemName: systemName,
                    archetype: selectedArchetype
                })
            });

            console.log('Setup response status:', response.status);

            if (!response.ok) {
                // Try to get error message from response
                let errorMessage = 'Setup failed';
                try {
                    const errorData = await response.text();
                    console.error('Setup error response:', errorData);
                    
                    // Try to parse as JSON
                    try {
                        const jsonError = JSON.parse(errorData);
                        errorMessage = jsonError.error || errorMessage;
                    } catch (e) {
                        // Not JSON, use the text as error
                        errorMessage = errorData || errorMessage;
                    }
                } catch (e) {
                    console.error('Error reading response:', e);
                }
                
                UI.showAlert(`Setup failed: ${errorMessage}`);
                return false;
            }

            const data = await response.json();
            console.log('Setup success response:', data);

            this.addLogEntry('System setup completed successfully!', 'success');
            // Reload game state to reflect setup completion (pins to selected unit sector if any)
            await this.loadGameState();
            return true; // Allow modal to close

        } catch (error) {
            console.error('Setup network error:', error);
            UI.showAlert(`Connection failed: ${error.message}. Please try again.`);
            return false;
        }
    }
}

// Players modal: show all players, lock status, and online status
async function showPlayersModal() {
    if (!gameClient || !gameClient.socket) return;

    try {
        const data = await new Promise((resolve) => {
            gameClient.socket.timeout(4000).emit('players:list', { gameId: gameClient.gameId }, (err, response) => {
                if (err) resolve({ success: false, error: 'Timeout' });
                else resolve(response);
            });
        });

        if (!data || !data.success) {
            UI.showAlert(data?.error || 'Failed to load players');
            return;
        }

        const players = data.players || [];
        const currentTurn = data.currentTurn;

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
                                <img src=\"${avatarSrc}\" alt=\"avatar\" style=\"width:36px; height:36px; border-radius:50%; border:2px solid ${borderColor}; object-fit:cover;\" onerror=\"this.src='assets/avatars/explorer.png'\">
                                <div>
                                    <div class=\"asset-name\">${p.username || 'Player ' + p.userId}</div>
                                    <div class=\"asset-position\" style=\"display:flex; gap:10px;\">
                                        <span title=\"Online status\">${p.online ? '🟢 Online' : '⚪ Offline'}${!p.online && p.lastSeenAt ? ` · seen ${timeAgo(p.lastSeenAt)}` : ''}</span>
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
    await gameClient.initialize(gameId);
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
            gameClient.addLogEntry(`Cannot warp while ship is moving. Movement status: ${unit.movementStatus}`, 'warning');
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

async function scanArea() {
    if (!gameClient || !gameClient.selectedUnit) {
        gameClient?.addLogEntry('No unit selected for scanning', 'warning');
        return;
    }
    
    const unit = gameClient.selectedUnit;
    const meta = unit.meta;
    
    // Check if unit can perform active scans
    if (!meta.canActiveScan) {
        gameClient.addLogEntry('Selected unit cannot perform active scans', 'warning');
        UI.showAlert('This unit does not have active scanning capabilities');
        return;
    }
    
    // Check energy requirements
    const energyCost = meta.activeScanCost || 1;
    if (meta.energy !== undefined && meta.energy < energyCost) {
        gameClient.addLogEntry('Insufficient energy for active scan', 'warning');
        UI.showAlert(`Active scan requires ${energyCost} energy. Current: ${meta.energy || 0}`);
        return;
    }
    
    try {
        gameClient.addLogEntry('Performing active scan...', 'info');
        
        const response = await fetch(`/game/scan/${gameClient.gameId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                userId: gameClient.userId,
                unitId: unit.id,
                scanType: 'active'
            })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            gameClient.addLogEntry(`Active scan complete! Revealed ${data.tilesRevealed} new tiles`, 'success');
            
            // Update unit energy display
            if (data.energyRemaining !== undefined) {
                unit.meta.energy = data.energyRemaining;
                gameClient.updateUnitDetails(); // Refresh the unit details panel
            }
            
            // Refresh game state to show newly revealed objects
            await gameClient.loadGameState();
            
        } else {
            gameClient.addLogEntry(`Scan failed: ${data.error}`, 'error');
            UI.showAlert(`Active scan failed: ${data.error}`);
        }
        
    } catch (error) {
        console.error('Active scan error:', error);
        gameClient.addLogEntry('Active scan connection failed', 'error');
        UI.showAlert('Connection failed. Please try again.');
    }
}

// Show build modal with tabbed interface
async function showBuildModal() {
    if (!gameClient || !gameClient.selectedUnit) {
        gameClient?.addLogEntry('No station selected', 'warning');
        return;
    }

    const selectedStation = gameClient.selectedUnit;
    if (selectedStation.type !== 'starbase') {
        gameClient.addLogEntry('Only stations can build', 'warning');
        return;
    }

    // Get station cargo to check available resources
    try {
        const response = await fetch(`/game/cargo/${selectedStation.id}?userId=${gameClient.userId}`);
        const data = await response.json();
        
        if (!response.ok) {
            gameClient.addLogEntry(data.error || 'Failed to get station cargo', 'error');
            return;
        }

        const cargo = data.cargo;
        const rockQuantity = cargo.items.find(item => item.resource_name === 'rock')?.quantity || 0;
        
        // Create build modal content
        const buildModal = document.createElement('div');
        buildModal.className = 'build-modal';
        buildModal.innerHTML = `
            <div class="build-tabs">
                <button class="build-tab active" onclick="switchBuildTab('ships')">
                    🚢 Ships
                </button>
                <button class="build-tab" onclick="switchBuildTab('structures')">
                    🏗️ Structures
                </button>
            </div>
            
            <div class="build-resources">
                <div class="resource-display">
                    <span class="resource-icon">🪨</span>
                    <span class="resource-name">Rock:</span>
                    <span class="resource-quantity">${rockQuantity}</span>
                </div>
            </div>
            
            <div id="ships-tab" class="build-tab-content">
                <div class="build-section">
                    <h3>🚢 Ship Construction</h3>
            <div class="build-options" id="shipyard-container"></div>
                </div>
            </div>
            
            <div id="structures-tab" class="build-tab-content hidden">
                <div class="build-section">
                    <h3>🏗️ Structure Manufacturing</h3>
                    <div class="build-options">
                        <div class="build-option ${rockQuantity >= 1 ? '' : 'disabled'}">
                            <div class="build-info">
                                <div class="build-name">📦 Storage Box</div>
                                <div class="build-description">Deployable storage structure</div>
                                <div class="build-stats">
                                    • Cargo: 25 units<br>
                                    • Deployable anywhere<br>
                                    • Resource storage
                                </div>
                            </div>
                            <div class="build-cost">
                                <div class="cost-item">🪨 1 Rock</div>
                                <button class="build-btn ${rockQuantity >= 1 ? '' : 'disabled'}" 
                                        onclick="buildStructure('storage-box', 1)" 
                                        ${rockQuantity >= 1 ? '' : 'disabled'}>
                                    Build
                                </button>
                            </div>
                        </div>
                        
                        <div class="build-option ${rockQuantity >= 5 ? '' : 'disabled'}">
                            <div class="build-info">
                                <div class="build-name">🌌 Warp Beacon</div>
                                <div class="build-description">Deployable warp destination</div>
                                <div class="build-stats">
                                    • Allows warp travel<br>
                                    • Accessible to all players<br>
                                    • Permanent structure
                                </div>
                            </div>
                            <div class="build-cost">
                                <div class="cost-item">🪨 5 Rock</div>
                                <button class="build-btn ${rockQuantity >= 5 ? '' : 'disabled'}" 
                                        onclick="buildStructure('warp-beacon', 5)" 
                                        ${rockQuantity >= 5 ? '' : 'disabled'}>
                                    Build
                                </button>
                            </div>
                        </div>
                        
                        <div class="build-option ${rockQuantity >= 2 ? '' : 'disabled'}">
                            <div class="build-info">
                                <div class="build-name">🌀 Interstellar Gate</div>
                                <div class="build-description">Gateway between solar systems</div>
                                <div class="build-stats">
                                    • Connects to other sectors<br>
                                    • Accessible to all players<br>
                                    • Creates paired gates
                                </div>
                            </div>
                            <div class="build-cost">
                                <div class="cost-item">🪨 2 Rock</div>
                                <button class="build-btn ${rockQuantity >= 2 ? '' : 'disabled'}" 
                                        onclick="buildStructure('interstellar-gate', 2)" 
                                        ${rockQuantity >= 2 ? '' : 'disabled'}>
                                    Build
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        UI.showModal({
            title: '🔨 Construction Bay',
            content: buildModal,
            actions: [
                {
                    text: 'Close',
                    style: 'primary',
                    action: () => true
                }
            ],
            className: 'build-modal-container'
        });

        // Inject Shipyard (Frigate/Battleship/Capital tabs)
        await renderShipyard(selectedStation, cargo);

    } catch (error) {
        console.error('Error getting station cargo:', error);
        gameClient.addLogEntry('Failed to access construction bay', 'error');
    }
}

// Render the Shipyard UI inside the build modal
async function renderShipyard(selectedStation, cargo) {
    const container = document.getElementById('shipyard-container');
    if (!container) return;
    const haveMap = new Map(cargo.items.map(i => [i.resource_name, i.quantity]));

    // Fetch full blueprint list from server
    let blueprints = [];
    try {
        const resp = await fetch('/game/blueprints');
        const jd = await resp.json();
        if (resp.ok) blueprints = jd.blueprints || [];
    } catch {}
    // Client-side fallback mapping if server doesn't provide refined fields
    const ROLE_TO_REFINED = {
        'stealth-scout': 'scout-recon',
        'brawler': 'brawler',
        'sniper': 'sniper-siege',
        'interceptor': 'interceptor',
        'assassin': 'stealth-strike',
        'miner': 'prospector-miner',
        'ecm': 'ecm-disruption',
        'torpedo': 'torpedo-missile',
        'courier': 'logistics',
        'stealth-strike': 'stealth-strike',
        'boarding': 'heavy-assault',
        'miner-raider': 'prospector-miner',
        'ecm-torpedo': 'torpedo-missile',
        'escort': 'escort',
        'siege': 'sniper-siege',
        'fortress': 'fortress',
        'gunline': 'sniper-siege',
        'carrier': 'carrier',
        'beam-destroyer': 'sniper-siege',
        'torpedo-siege': 'torpedo-missile',
        'ecm-fortress': 'ecm-disruption',
        'logistics': 'logistics',
        'repair-tender': 'medical-repair',
        'defensive-carrier': 'carrier',
        'command-artillery': 'command',
        'siege-ecm': 'sniper-siege',
        'logistics-fortress': 'logistics',
        'freighter': 'logistics',
        'colony': 'colony-ship',
        'transport': 'logistics',
        'medical': 'medical-repair',
        'deepcore-miner': 'prospector-miner',
        'gas-harvester': 'gas-harvester',
        'strip-miner': 'prospector-miner',
        'mining-command': 'prospector-miner',
        'salvage': 'salvage',
        'supercarrier': 'carrier',
        'dreadnought': 'heavy-assault',
        'flagship-command': 'flagship',
        'heavy-shield': 'fortress',
        'stealth-battleship': 'stealth-strike',
        'mobile-shipyard': 'logistics',
        'worldship': 'fortress',
        'megafreighter': 'logistics',
        'exploration': 'scout-recon',
        'fleet-anchor': 'fortress',
        'planet-cracker': 'sniper-siege',
        'gas-refinery': 'gas-harvester',
        'prospecting-ark': 'prospector-miner'
    };
    const REFINED_TO_GROUP = {
        'brawler': 'combat',
        'sniper-siege': 'combat',
        'interceptor': 'combat',
        'heavy-assault': 'combat',
        'stealth-strike': 'combat',
        'carrier': 'combat',
        'escort': 'support-utility',
        'command': 'support-utility',
        'medical-repair': 'support-utility',
        'logistics': 'support-utility',
        'scout-recon': 'exploration-expansion',
        'colony-ship': 'exploration-expansion',
        'prospector-miner': 'exploration-expansion',
        'gas-harvester': 'exploration-expansion',
        'salvage': 'exploration-expansion',
        'ecm-disruption': 'specialist',
        'torpedo-missile': 'specialist',
        'fortress': 'specialist',
        'flagship': 'specialist'
    };
    blueprints = (blueprints || []).map(b => {
        const refinedRole = b.refinedRole || ROLE_TO_REFINED[b.role] || b.role;
        const refinedGroup = b.refinedGroup || REFINED_TO_GROUP[refinedRole] || null;
        return { ...b, refinedRole, refinedGroup };
    });
    const CORE_BASELINES = {
        frigate: { 'Ferrite Alloy': 20, 'Crytite': 12, 'Ardanium': 10, 'Vornite': 8, 'Zerothium': 6 },
        battleship: { 'Ferrite Alloy': 120, 'Crytite': 80, 'Ardanium': 60, 'Vornite': 50, 'Zerothium': 40 },
        capital: { 'Ferrite Alloy': 300, 'Crytite': 200, 'Ardanium': 160, 'Vornite': 140, 'Zerothium': 120 }
    };
    const ROLE_CORE_MODIFIERS = {
        'stealth-scout': { 'Ferrite Alloy': 0.8, 'Vornite': 1.2, 'Zerothium': 1.15, 'Crytite': 1.1, 'Ardanium': 0.9 },
        'brawler': { 'Ferrite Alloy': 1.2, 'Ardanium': 1.15, 'Zerothium': 0.9, 'Vornite': 0.9 },
        'siege': { 'Ferrite Alloy': 1.15, 'Crytite': 1.1 },
        'supercarrier': { 'Ferrite Alloy': 1.2, 'Crytite': 1.2 }
    };
    const SPECIALIZED_TOTAL = { frigate: 20, battleship: 100, capital: 300 };
    const computeReqs = (bp) => {
        const base = CORE_BASELINES[bp.class];
        const mod = ROLE_CORE_MODIFIERS[bp.role] || {};
        const core = Object.fromEntries(Object.entries(base).map(([k,v]) => [k, Math.max(1, Math.round(v * (mod[k]||1)))]));
        const tot = SPECIALIZED_TOTAL[bp.class] || 0;
        const n = Math.max(1, bp.specialized.length);
        const per = Math.max(1, Math.floor(tot / n));
        const spec = {};
        bp.specialized.forEach((s,i)=> spec[s] = per + (i < (tot - per*n) ? 1 : 0));
        return { core, specialized: spec };
    };

    const tabs = ['frigate','battleship','capital'];
    // Build refined role list from server-provided mapping; fallback to original role if missing
    const refinedAll = Array.from(new Set(blueprints.map(b=>b.refinedRole || b.role)));
    // Keep a stable order grouped for UX
    const REFINED_ORDER = [
        // Combat
        'brawler','sniper-siege','interceptor','heavy-assault','stealth-strike','carrier',
        // Support & Utility
        'escort','command','medical-repair','logistics',
        // Exploration & Expansion
        'scout-recon','colony-ship','prospector-miner','gas-harvester','salvage',
        // Specialist
        'ecm-disruption','torpedo-missile','fortress','flagship'
    ];
    const LABELS = {
        'brawler': 'Brawler',
        'sniper-siege': 'Sniper / Siege',
        'interceptor': 'Interceptor',
        'heavy-assault': 'Heavy Assault',
        'stealth-strike': 'Stealth Strike',
        'carrier': 'Carrier',
        'escort': 'Escort',
        'command': 'Command',
        'medical-repair': 'Medical / Repair',
        'logistics': 'Logistics',
        'scout-recon': 'Scout / Recon',
        'colony-ship': 'Colony Ship',
        'prospector-miner': 'Prospector / Miner',
        'gas-harvester': 'Gas Harvester',
        'salvage': 'Salvage',
        'ecm-disruption': 'ECM / Disruption',
        'torpedo-missile': 'Torpedo / Missile',
        'fortress': 'Fortress',
        'flagship': 'Flagship'
    };
    const GROUPS = [
        { key: 'combat', label: 'Combat Roles', roles: ['brawler','sniper-siege','interceptor','heavy-assault','stealth-strike','carrier'] },
        { key: 'support-utility', label: 'Support & Utility', roles: ['escort','command','medical-repair','logistics'] },
        { key: 'exploration-expansion', label: 'Exploration & Expansion', roles: ['scout-recon','colony-ship','prospector-miner','gas-harvester','salvage'] },
        { key: 'specialist', label: 'Specialist Roles', roles: ['ecm-disruption','torpedo-missile','fortress','flagship'] }
    ];
    const rolesAll = REFINED_ORDER.filter(r => refinedAll.includes(r));
    let activeRole = null; // null = all refined roles
    let active = 'frigate';
    const header = document.createElement('div');
    header.className = 'build-tabs-shipyard';
    tabs.forEach(t => {
        const b = document.createElement('button');
        b.className = 'sf-btn ' + (active===t ? 'sf-btn-primary' : 'sf-btn-secondary');
        b.dataset.class = t;
        b.textContent = t.charAt(0).toUpperCase() + t.slice(1);
        b.onclick = () => {
            active = t;
            // Update tab highlighting
            header.querySelectorAll('button').forEach(bb => {
                const cls = bb.dataset.class;
                bb.className = 'sf-btn ' + (cls===active ? 'sf-btn-primary' : 'sf-btn-secondary');
            });
            renderList();
            updateChips();
        };
        header.appendChild(b);
    });
    // Role chips bar
    const roleBar = document.createElement('div');
    roleBar.className = 'role-chips';
    const makeChip = (label, value) => {
        const c = document.createElement('button');
        c.className = 'sf-chip ' + (activeRole===value ? 'active' : '');
        c.textContent = label;
        c.onclick = () => { activeRole = (activeRole===value ? null : value); renderList(); updateChips(); };
        return c;
    };
    const updateChips = () => {
        roleBar.innerHTML = '';
        roleBar.appendChild(makeChip('All Roles', null));
        const availableForClass = new Set(
            blueprints
                .filter(b => b.class === active)
                .map(b => b.refinedRole || b.role)
        );
        GROUPS.forEach(group => {
            const present = group.roles.filter(r => availableForClass.has(r));
            if (present.length === 0) return;
            const title = document.createElement('div');
            title.className = 'role-group-title';
            title.textContent = group.label;
            roleBar.appendChild(title);
            const wrap = document.createElement('div');
            wrap.className = 'role-group';
            present.forEach(r => wrap.appendChild(makeChip(LABELS[r] || r, r)));
            roleBar.appendChild(wrap);
        });
    };
    updateChips();

    const list = document.createElement('div');
    list.className = 'shipyard-list';
    container.appendChild(header);
    container.appendChild(roleBar);
    container.appendChild(list);

    const renderList = () => {
        list.innerHTML = '';
        blueprints.filter(b=>b.class===active && (!activeRole || (b.refinedRole||b.role)===activeRole)).forEach(bp => {
            const reqs = bp.requirements ? bp.requirements : computeReqs(bp);
            const wrap = document.createElement('div');
            wrap.className = 'build-option';
            const specChips = bp.specialized.map(s=>`<span class="chip">${s}</span>`).join(' ');
            const reqRows = (obj) => Object.entries(obj).map(([k,v])=>{
                const have = haveMap.get(k) || 0;
                const ok = have >= v;
                return `<div class="req-row"><span>${k}</span><span>${ok?'✅':'❌'} ${have}/${v}</span></div>`;
            }).join('');
            const canBuild = [...Object.entries(reqs.core), ...Object.entries(reqs.specialized)].every(([k,v]) => (haveMap.get(k)||0) >= v);
            wrap.innerHTML = `
                <div class="build-info">
                    <div class="build-name">${bp.name}</div>
                    <div class="build-description">Class: ${bp.class} • Role: ${(LABELS[bp.refinedRole]||LABELS[bp.role]||bp.refinedRole||bp.role)} • Specialized: ${specChips}</div>
                    <div class="build-reqs"><h4>Core</h4>${reqRows(reqs.core)}<h4>Specialized</h4>${reqRows(reqs.specialized)}</div>
                </div>
                <div class="build-cost">
                    <button class="build-btn ${canBuild?'':'disabled'}" ${canBuild?'':'disabled'}>Build</button>
                </div>`;
            wrap.querySelector('button').onclick = async () => {
                const resp = await fetch('/game/build-ship', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ stationId: selectedStation.id, blueprintId: bp.id, userId: gameClient.userId }) });
                const jd = await resp.json();
                if (!resp.ok) {
                    gameClient.addLogEntry(jd.error || 'Build failed', 'error');
                } else {
                    gameClient.addLogEntry(`Built ${jd.shipName}`, 'success');
                    UI.closeModal();
                    await gameClient.loadGameState();
                }
            };
            list.appendChild(wrap);
        });
    };
    renderList();
}

// Switch between build tabs
function switchBuildTab(tabName) {
    // Update tab buttons
    document.querySelectorAll('.build-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    document.querySelector(`[onclick="switchBuildTab('${tabName}')"]`).classList.add('active');
    
    // Show/hide tab content
    document.querySelectorAll('.build-tab-content').forEach(content => {
        content.classList.add('hidden');
    });
    document.getElementById(`${tabName}-tab`).classList.remove('hidden');
}

// Build a ship
async function buildShip(shipType, cost) {
    if (!gameClient || !gameClient.selectedUnit) {
        gameClient?.addLogEntry('No station selected', 'warning');
        return;
    }

    try {
        const response = await fetch('/game/build-ship', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                stationId: gameClient.selectedUnit.id,
                shipType: shipType,
                cost: cost,
                userId: gameClient.userId
            })
        });

        const data = await response.json();
        
        if (response.ok) {
            gameClient.addLogEntry(`${data.shipName} constructed successfully!`, 'success');
            UI.closeModal();
            // Refresh game state to show new ship
            gameClient.socket.emit('get-game-state', { gameId: gameClient.gameId, userId: gameClient.userId });
        } else {
            gameClient.addLogEntry(data.error || 'Failed to build ship', 'error');
        }

    } catch (error) {
        console.error('Error building ship:', error);
        gameClient.addLogEntry('Failed to build ship', 'error');
    }
}

// Build a structure (as cargo item)
async function buildStructure(structureType, cost) {
    if (!gameClient || !gameClient.selectedUnit) {
        gameClient?.addLogEntry('No station selected', 'warning');
        return;
    }

    try {
        const response = await fetch('/game/build-structure', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                stationId: gameClient.selectedUnit.id,
                structureType: structureType,
                cost: cost,
                userId: gameClient.userId
            })
        });

        const data = await response.json();
        
        if (response.ok) {
            gameClient.addLogEntry(`${data.structureName} manufactured successfully!`, 'success');
            UI.closeModal();
        } else {
            gameClient.addLogEntry(data.error || 'Failed to build structure', 'error');
        }

    } catch (error) {
        console.error('Error building structure:', error);
        gameClient.addLogEntry('Failed to build structure', 'error');
    }
}

// Deploy a structure from ship cargo
async function deployStructure(structureType, shipId) {
    if (!gameClient || !gameClient.selectedUnit) {
        gameClient?.addLogEntry('No ship selected', 'warning');
        return;
    }

    // Special handling for interstellar gates - require sector selection
    if (structureType === 'interstellar-gate') {
        showSectorSelectionModal(shipId);
        return;
    }

    try {
        const response = await fetch('/game/deploy-structure', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                shipId: shipId,
                structureType: structureType,
                userId: gameClient.userId
            })
        });

        const data = await response.json();
        
        if (response.ok) {
            gameClient.addLogEntry(`${data.structureName} deployed successfully!`, 'success');
            UI.closeModal();
            // Refresh game state to show new structure
            gameClient.socket.emit('get-game-state', { gameId: gameClient.gameId, userId: gameClient.userId });
        } else {
            gameClient.addLogEntry(data.error || 'Failed to deploy structure', 'error');
        }

    } catch (error) {
        console.error('Error deploying structure:', error);
        gameClient.addLogEntry('Failed to deploy structure', 'error');
    }
}

// Show sector selection modal for interstellar gate deployment
async function showSectorSelectionModal(shipId) {
    try {
        // Fetch all available sectors
        const response = await fetch(`/game/sectors?gameId=${gameClient.gameId}&userId=${gameClient.userId}`);
        const data = await response.json();
        
        if (!response.ok) {
            gameClient.addLogEntry(data.error || 'Failed to get sector list', 'error');
            return;
        }

        const sectors = data.sectors;
        const currentSectorId = gameClient.gameState.sector.id;
        
        // Filter out current sector
        const availableSectors = sectors.filter(sector => sector.id !== currentSectorId);
        
        if (availableSectors.length === 0) {
            gameClient.addLogEntry('No other sectors available for gate connection', 'warning');
            return;
        }

        // Create sector selection modal
        const sectorModal = document.createElement('div');
        sectorModal.className = 'sector-selection-modal';
        sectorModal.innerHTML = `
            <div class="sector-selection-header">
                <h3>🌀 Select Destination Sector</h3>
                <p>Choose which solar system to connect to:</p>
            </div>
            
            <div class="sector-list">
                ${availableSectors.map(sector => `
                    <div class="sector-option" onclick="deployInterstellarGate(${shipId}, ${sector.id}, '${sector.name}')">
                        <div class="sector-info">
                            <div class="sector-name">🌌 ${sector.name}</div>
                            <div class="sector-details">
                                Owner: ${sector.owner_name || 'Unknown'}<br>
                                Type: ${sector.archetype || 'Standard'}
                            </div>
                        </div>
                        <div class="sector-action">
                            <button class="select-sector-btn">Connect</button>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;

        UI.showModal({
            title: '🌀 Interstellar Gate Deployment',
            content: sectorModal,
            actions: [
                {
                    text: 'Cancel',
                    style: 'secondary',
                    action: () => true
                }
            ],
            className: 'sector-selection-modal-container'
        });

    } catch (error) {
        console.error('Error showing sector selection:', error);
        gameClient.addLogEntry('Failed to show sector selection', 'error');
    }
}

// Deploy interstellar gate with selected destination sector
async function deployInterstellarGate(shipId, destinationSectorId, destinationSectorName) {
    try {
        const response = await fetch('/game/deploy-interstellar-gate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                shipId: shipId,
                destinationSectorId: destinationSectorId,
                userId: gameClient.userId
            })
        });

        const data = await response.json();
        
        if (response.ok) {
            gameClient.addLogEntry(`Interstellar Gate deployed! Connected to ${destinationSectorName}`, 'success');
            UI.closeModal();
            // Refresh game state to show new structure
            gameClient.socket.emit('get-game-state', { gameId: gameClient.gameId, userId: gameClient.userId });
        } else {
            gameClient.addLogEntry(data.error || 'Failed to deploy interstellar gate', 'error');
        }

    } catch (error) {
        console.error('Error deploying interstellar gate:', error);
        gameClient.addLogEntry('Failed to deploy interstellar gate', 'error');
    }
}

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
                    <div class="gate-option" onclick="travelThroughGate(${gate.id}, '${gateMeta.destinationSectorName || 'Unknown Sector'}')">
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
}

// Travel through an interstellar gate
async function travelThroughGate(gateId, destinationName) {
    if (!gameClient || !gameClient.selectedUnit) {
        gameClient?.addLogEntry('No ship selected', 'warning');
        return;
    }

    try {
        const response = await fetch('/game/interstellar-travel', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                shipId: gameClient.selectedUnit.id,
                gateId: gateId,
                userId: gameClient.userId
            })
        });

        const data = await response.json();
        
        if (response.ok) {
            gameClient.addLogEntry(`${gameClient.selectedUnit.meta.name} traveled to ${destinationName}!`, 'success');
            UI.closeModal();
            
            // The ship has moved to a different sector, so we need to refresh the entire game state
            gameClient.socket.emit('get-game-state', { gameId: gameClient.gameId, userId: gameClient.userId });
        } else {
            gameClient.addLogEntry(data.error || 'Failed to travel through gate', 'error');
        }

    } catch (error) {
        console.error('Error traveling through gate:', error);
        gameClient.addLogEntry('Failed to travel through gate', 'error');
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
        // Start mining - show resource selection
        await showResourceSelection(ship.id);
    }
}

async function showResourceSelection(shipId) {
    try {
        const response = await fetch(`/game/resource-nodes/${gameClient.gameId}/${shipId}?userId=${gameClient.userId}`);
        const data = await response.json();
        
        if (!response.ok) {
            gameClient.addLogEntry(data.error || 'Failed to get resource nodes', 'error');
            return;
        }
        
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
                startMining(shipId, node.id, node.resource_name);
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
    gameClient.socket.emit('start-harvesting', {
        gameId: gameClient.gameId,
        shipId: shipId,
        resourceNodeId: resourceNodeId
    });
    
    gameClient.addLogEntry(`Starting to mine ${resourceName}...`, 'info');
}

async function showCargo() {
    if (!gameClient || !gameClient.selectedUnit) {
        gameClient?.addLogEntry('No unit selected', 'warning');
        return;
    }
    
    const selectedUnit = gameClient.selectedUnit;
    const unitType = selectedUnit.type === 'ship' ? 'Ship' : 'Structure';
    
    try {
        const response = await fetch(`/game/cargo/${selectedUnit.id}?userId=${gameClient.userId}`);
        const data = await response.json();
        
        if (!response.ok) {
            gameClient.addLogEntry(data.error || 'Failed to get cargo data', 'error');
            return;
        }
        
        const cargo = data.cargo;
        
        // Find adjacent objects for transfer options
        const adjacentObjects = gameClient.gameState.objects.filter(obj => {
            if (obj.id === selectedUnit.id || obj.owner_id !== gameClient.userId) return false;
            
            const dx = Math.abs(obj.x - selectedUnit.x);
            const dy = Math.abs(obj.y - selectedUnit.y);
            return dx <= 1 && dy <= 1 && !(dx === 0 && dy === 0);
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
                transferBtn.onclick = () => showTransferModal(selectedUnit.id, obj.id, obj.meta.name || obj.type);
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
                            <button class="deploy-btn" onclick="deployStructure('${item.resource_name}', ${selectedUnit.id})">
                                🚀 Deploy
                            </button>
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
        
    } catch (error) {
        console.error('Error getting cargo:', error);
        gameClient.addLogEntry('Failed to get cargo information', 'error');
    }
}

// Show transfer modal for resource transfers between objects
async function showTransferModal(fromObjectId, toObjectId, toObjectName) {
    try {
        // Get cargo from source object
        const response = await fetch(`/game/cargo/${fromObjectId}?userId=${gameClient.userId}`);
        const data = await response.json();
        
        if (!response.ok) {
            gameClient.addLogEntry(data.error || 'Failed to get cargo data', 'error');
            return;
        }
        
        const cargo = data.cargo;
        
        if (cargo.items.length === 0) {
            gameClient.addLogEntry('No resources to transfer', 'warning');
            return;
        }
        
        // Create transfer modal
        const transferDisplay = document.createElement('div');
        transferDisplay.className = 'transfer-display';
        
        const header = document.createElement('div');
        header.innerHTML = `
            <h3>🔄 Transfer Resources</h3>
            <p>Transfer resources to: <strong>${toObjectName}</strong></p>
        `;
        transferDisplay.appendChild(header);
        
        // Create list of transferable resources
        cargo.items.forEach(item => {
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
                    <button class="transfer-btn" onclick="performTransfer('${fromObjectId}', '${toObjectId}', '${item.resource_name}', document.getElementById('transfer-${item.resource_name}').value, '${toObjectName}')">
                        Transfer
                    </button>
                </div>
            `;
            
            transferDisplay.appendChild(transferItem);
        });
        
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
        const response = await fetch('/game/transfer', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                fromObjectId: parseInt(fromObjectId),
                toObjectId: parseInt(toObjectId),
                resourceName: resourceName,
                quantity: transferQuantity,
                userId: gameClient.userId
            })
        });
        
        const result = await response.json();
        
        if (response.ok && result.success) {
            gameClient.addLogEntry(`Successfully transferred ${transferQuantity} ${resourceName} to ${toObjectName}`, 'success');
            UI.closeModal(); // Close transfer modal
            
            // Refresh cargo display if still open
            if (gameClient.selectedUnit && gameClient.selectedUnit.id === fromObjectId) {
                setTimeout(() => showCargo(), 100); // Small delay to ensure modal closes first
            }
        } else {
            gameClient.addLogEntry(result.error || 'Transfer failed', 'error');
        }
        
    } catch (error) {
        console.error('Error performing transfer:', error);
        gameClient.addLogEntry('Failed to transfer resources', 'error');
    }
}

// Update cargo status in unit panel
async function updateCargoStatus(shipId) {
    try {
        const response = await fetch(`/game/cargo/${shipId}?userId=${gameClient.userId}`);
        const data = await response.json();
        
        if (response.ok) {
            const cargoElement = document.getElementById('cargoStatus');
            if (cargoElement) {
                const cargo = data.cargo;
                const percentFull = Math.round((cargo.spaceUsed / cargo.capacity) * 100);
                cargoElement.innerHTML = `${cargo.spaceUsed}/${cargo.capacity} (${percentFull}%)`;
                cargoElement.style.color = percentFull >= 90 ? '#FF5722' : percentFull >= 70 ? '#FF9800' : '#4CAF50';
            }
        }
    } catch (error) {
        console.error('Error updating cargo status:', error);
    }
}

// Map modal functions
function openMapModal() {
    if (!gameClient) return;
    
    const modalContent = document.createElement('div');
    modalContent.innerHTML = `
        <div class="map-tabs">
            <button class="map-tab active sf-btn sf-btn-secondary" onclick="switchMapTab('solar-system')">
                🌌 Solar System
            </button>
            <button class="map-tab sf-btn sf-btn-secondary" onclick="switchMapTab('galaxy')">
                🌌 Galaxy
            </button>
        </div>
        
        <div id="solar-system-tab" class="map-tab-content">
            <div style="margin-bottom: 15px;">
                <h3 style="color: #64b5f6; margin: 0 0 10px 0;">🌌 ${gameClient.gameState?.sector?.name || 'Current Solar System'}</h3>
                <p style="color: #ccc; margin: 0; font-size: 0.9em;">Full tactical overview of your sector</p>
            </div>
            <canvas id="fullMapCanvas" class="full-map-canvas"></canvas>
        </div>
        
        <div id="galaxy-tab" class="map-tab-content hidden">
            <div style="margin-bottom: 15px;">
                <h3 style="color: #64b5f6; margin: 0 0 10px 0;">🌌 Galaxy Overview</h3>
                <p style="color: #ccc; margin: 0; font-size: 0.9em;">All known solar systems in the galaxy</p>
            </div>
            <canvas id="galaxyCanvas" class="full-map-canvas" style="height: 400px;"></canvas>
            <div id="galaxyLegend" style="margin-top: 8px; font-size: 0.85em; color: #9ecbff;">
                ● Size/brightness highlights strategic hubs (choke points). Lines show warp-gate connectivity.
            </div>
        </div>
    `;
    
    UI.showModal({
        title: '🗺️ Strategic Map',
        content: modalContent,
        actions: [
            {
                text: 'Close',
                style: 'secondary',
                action: () => true
            }
        ],
        className: 'map-modal'
    });
    
    // Initialize the solar system map after modal is shown
    setTimeout(() => {
        initializeFullMap();
        loadGalaxyData();
    }, 100);
}

function switchMapTab(tabName) {
    // Update tab buttons
    document.querySelectorAll('.map-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    event.target.classList.add('active');
    
    // Update tab content
    document.querySelectorAll('.map-tab-content').forEach(content => {
        content.classList.add('hidden');
    });
    document.getElementById(tabName + '-tab').classList.remove('hidden');
    
    // Refresh map if switching to solar system tab
    if (tabName === 'solar-system') {
        setTimeout(() => initializeFullMap(), 50);
    } else if (tabName === 'galaxy') {
        setTimeout(() => initializeGalaxyMap(), 50);
    }
}

function initializeFullMap() {
    const canvas = document.getElementById('fullMapCanvas');
    if (!canvas || !gameClient || !gameClient.objects) return;
    
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    
    // Set canvas size to match display size
    canvas.width = rect.width;
    canvas.height = rect.height;
    
    // Clear canvas
    ctx.fillStyle = '#0a0a1a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Draw sector boundary (legend removed)
    ctx.strokeStyle = 'rgba(100, 181, 246, 0.3)';
    ctx.lineWidth = 2;
    ctx.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);
    
    // Scale objects to full map
    const scaleX = canvas.width / 5000;
    const scaleY = canvas.height / 5000;
    
    // Use the same rendering logic as the minimap but larger
    renderFullMapObjects(ctx, canvas, scaleX, scaleY);
}

// Deterministic galaxy map rendering
async function initializeGalaxyMap() {
    try {
        const canvas = document.getElementById('galaxyCanvas');
        if (!canvas || !gameClient) return;
        // Fit canvas to container
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width;
        canvas.height = Math.max(360, rect.height);
        const w = canvas.width, h = canvas.height;

        // Fetch graph from server
        const res = await fetch(`/game/${gameClient.gameId}/galaxy-graph`);
        const graph = await res.json();
        if (!graph || !Array.isArray(graph.systems)) return;

        // Build nodes/links
        const systems = graph.systems;
        const gates = graph.gates || [];

        // Degree centrality for quick choke highlighting
        const deg = new Map(systems.map(s => [s.id, 0]));
        gates.forEach(g => {
            if (deg.has(g.source)) deg.set(g.source, deg.get(g.source) + 1);
            if (deg.has(g.target)) deg.set(g.target, deg.get(g.target) + 1);
        });
        let maxDeg = 1; deg.forEach(v => { if (v > maxDeg) maxDeg = v; });
        const centrality = new Map();
        deg.forEach((v, k) => centrality.set(k, v / maxDeg));

        // Seeded RNG based on gameId+graph
        function hashString(s) {
            let h = 2166136261 >>> 0;
            for (let i=0; i<s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
            return (h >>> 0);
        }
        function graphKey(systems, gates, gameId) {
            const nodesStr = systems.map(s => s.id).sort().join('|');
            const edgesStr = gates.map(e => `${e.source}>${e.target}`).sort().join('|');
            return `${gameId}::${nodesStr}::${edgesStr}`;
        }
        const seed = hashString(graphKey(systems, gates, gameClient.gameId));
        let s = seed >>> 0;
        const rand = () => (s = Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9) >>> 0, rand01 = () => (rand() / 0xffffffff);

        // Simple deterministic force-like relaxation
        const nodes = systems.map(sys => ({ id: sys.id, name: sys.name, x: rand01()*w, y: rand01()*h, vx: 0, vy: 0 }));
        const id2 = new Map(nodes.map(n => [n.id, n]));
        const links = gates.filter(e => id2.has(e.source) && id2.has(e.target)).map(e => ({ s: id2.get(e.source), t: id2.get(e.target) }));

        const linkDist = Math.min(w, h) / 10;
        for (let iter=0; iter<300; iter++) {
            // Link springs
            links.forEach(L => {
                const dx = L.t.x - L.s.x, dy = L.t.y - L.s.y;
                const d = Math.hypot(dx, dy) || 0.0001;
                const k = 0.05; // spring strength
                const f = k * (d - linkDist);
                const fx = f * (dx/d), fy = f * (dy/d);
                L.t.vx -= fx; L.t.vy -= fy;
                L.s.vx += fx; L.s.vy += fy;
            });
            // Node repulsion
            for (let i=0; i<nodes.length; i++) {
                for (let j=i+1; j<nodes.length; j++) {
                    const A = nodes[i], B = nodes[j];
                    const dx = B.x - A.x, dy = B.y - A.y;
                    const d2 = dx*dx + dy*dy + 0.01;
                    const rep = 2000 / d2; // tweak repulsion
                    const invd = 1/Math.sqrt(d2);
                    const fx = rep * dx * invd, fy = rep * dy * invd;
                    A.vx -= fx; A.vy -= fy; B.vx += fx; B.vy += fy;
                }
            }
            // Damping + bounds
            nodes.forEach(N => {
                N.vx *= 0.85; N.vy *= 0.85;
                N.x += N.vx; N.y += N.vy;
                N.x = Math.max(30, Math.min(w-30, N.x));
                N.y = Math.max(30, Math.min(h-30, N.y));
            });
        }

        // Render
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0,0,w,h);
        ctx.fillStyle = '#0b0f1a'; ctx.fillRect(0,0,w,h);
        // Links
        ctx.strokeStyle = 'rgba(100,181,246,0.35)'; ctx.lineWidth = 1.25;
        links.forEach(L => { ctx.beginPath(); ctx.moveTo(L.s.x, L.s.y); ctx.lineTo(L.t.x, L.t.y); ctx.stroke(); });
        // Nodes + always-on labels
        nodes.forEach(N => {
            const c = centrality.get(N.id) || 0;
            const r = 6 + 10*c;
            const grad = ctx.createRadialGradient(N.x, N.y, 0, N.x, N.y, r);
            grad.addColorStop(0, `rgba(255,255,255,${0.85 - 0.5*c})`);
            grad.addColorStop(1, `rgba(100,181,246,0.9)`);
            ctx.fillStyle = grad;
            ctx.beginPath(); ctx.arc(N.x, N.y, r, 0, Math.PI*2); ctx.fill();
            ctx.strokeStyle = c > 0.6 ? '#ffca28' : '#64b5f6';
            ctx.lineWidth = c > 0.6 ? 2 : 1; ctx.stroke();

            // Label every node (clamped to view)
            const name = N.name || String(N.id);
            ctx.font = '11px Arial';
            ctx.textAlign = 'center';
            ctx.fillStyle = '#e3f2fd';
            ctx.shadowColor = 'rgba(0,0,0,0.9)';
            ctx.shadowBlur = 3;
            let labelX = N.x;
            let labelY = N.y - (r + 6);
            if (labelY < 12) labelY = N.y + r + 12; // if too close to top, render below
            // Clamp to canvas bounds horizontally
            const metrics = ctx.measureText(name);
            const half = metrics.width / 2;
            if (labelX - half < 6) labelX = 6 + half;
            if (labelX + half > w - 6) labelX = w - 6 - half;
            ctx.fillText(name, labelX, labelY);
            ctx.shadowBlur = 0;
        });
    } catch (e) {
        console.error('initializeGalaxyMap error:', e);
        const list = document.getElementById('galaxyLegend');
        if (list) list.innerText = 'Failed to render galaxy map';
    }
}

function renderFullMapObjects(ctx, canvas, scaleX, scaleY) {
    if (!gameClient || !gameClient.objects) return;
    
    // Separate objects by type
    const celestialObjects = gameClient.objects.filter(obj => gameClient.isCelestialObject(obj));
    const resourceNodes = gameClient.objects.filter(obj => obj.type === 'resource_node');
    const shipObjects = gameClient.objects.filter(obj => !gameClient.isCelestialObject(obj) && obj.type !== 'resource_node');
    
    // Draw celestial objects (skip large field overlays for belts/nebulae)
    celestialObjects.forEach(obj => {
        const x = obj.x * scaleX;
        const y = obj.y * scaleY;
        const radius = obj.radius || 1;
        const meta = obj.meta || {};
        const celestialType = meta.celestialType || obj.celestial_type;
        
        // Skip drawing large circles for belts and nebulae
        if (celestialType === 'belt' || celestialType === 'nebula') {
            return;
        }
        
        // Calculate size for full map (larger than minimap)
        let size;
        if (celestialType === 'star') {
            size = Math.max(8, Math.min(radius * scaleX * 0.6, canvas.width * 0.06));
        } else if (celestialType === 'planet') {
            size = Math.max(6, Math.min(radius * scaleX * 1.0, canvas.width * 0.04));
        } else if (celestialType === 'moon') {
            size = Math.max(4, Math.min(radius * scaleX * 1.2, canvas.width * 0.03));
        } else {
            size = Math.max(3, Math.min(radius * scaleX * 1.5, canvas.width * 0.04));
        }
        
        // Get celestial colors
        const colors = gameClient.getCelestialColors(obj);
        ctx.fillStyle = colors.border;
        
        if (celestialType === 'star' || celestialType === 'planet' || celestialType === 'moon') {
            // Important objects - circles with better visibility
            ctx.beginPath();
            ctx.arc(x, y, size/2, 0, Math.PI * 2);
            ctx.fill();
            
            // Add glow effect for stars and planets
            if (celestialType === 'star' || celestialType === 'planet') {
                ctx.strokeStyle = colors.border;
                ctx.lineWidth = 1;
                ctx.stroke();
            }
            
            // Add labels for important objects (always show for planets, stars if big enough)
            if (celestialType === 'planet' || size > 8) {
                ctx.fillStyle = '#ffffff';
                ctx.font = celestialType === 'planet' ? '11px Arial' : '10px Arial';
                ctx.textAlign = 'center';
                ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
                ctx.shadowBlur = 2;
                ctx.fillText(meta.name || celestialType, x, y + size/2 + 14);
                ctx.shadowBlur = 0; // Reset shadow
            }
        } else {
            // Small objects - squares
            ctx.fillRect(x - size/2, y - size/2, size, size);
        }
    });
    
    // Draw resource nodes as larger dots than minimap
    const resourceFieldLabelsStrategic = new Map(); // Track field centers for labels
    
    resourceNodes.forEach(obj => {
        const x = obj.x * scaleX;
        const y = obj.y * scaleY;
        const meta = obj.meta || {};
        const resourceType = meta.resourceType || 'unknown';
        const parentId = obj.parent_object_id;
        
        // Choose color based on resource type
        let nodeColor;
        switch (resourceType) {
            case 'rock':
                nodeColor = '#8D6E63';
                break;
            case 'gas':
                nodeColor = '#9C27B0'; // Purple for gas
                break;
            case 'energy':
                nodeColor = '#FFD54F';
                break;
            case 'salvage':
                nodeColor = '#A1887F';
                break;
            default:
                nodeColor = '#757575';
        }
        
        ctx.fillStyle = nodeColor;
        ctx.beginPath();
        ctx.arc(x, y, 2, 0, Math.PI * 2); // Larger 2px dots for full map
        ctx.fill();
        
        // Track field centers for labeling
        if (parentId && (resourceType === 'rock' || resourceType === 'gas')) {
            if (!resourceFieldLabelsStrategic.has(parentId)) {
                resourceFieldLabelsStrategic.set(parentId, {
                    x: 0, y: 0, count: 0, type: resourceType, parentId: parentId
                });
            }
            const field = resourceFieldLabelsStrategic.get(parentId);
            field.x += x;
            field.y += y;
            field.count++;
        }
    });
    
    // Draw field labels for asteroid belts and nebulae on strategic map
    resourceFieldLabelsStrategic.forEach((field, parentId) => {
        const centerX = field.x / field.count;
        const centerY = field.y / field.count;
        
        // Find the parent celestial object to get its name
        const parentObject = celestialObjects.find(obj => obj.id === parentId);
        if (parentObject) {
            const parentMeta = parentObject.meta || {};
            const celestialType = parentMeta.celestialType || parentObject.celestial_type;
            
            let fieldName = '';
            if (field.type === 'rock' && celestialType === 'belt') {
                fieldName = parentMeta.name || 'Asteroid Belt';
            } else if (field.type === 'gas' && celestialType === 'nebula') {
                fieldName = parentMeta.name || 'Nebula Field';
            }
            
            if (fieldName) {
                ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
                ctx.font = '12px Arial';
                ctx.textAlign = 'center';
                ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
                ctx.shadowBlur = 2;
                ctx.fillText(fieldName, centerX, centerY + 25);
                ctx.shadowBlur = 0;
            }
        }
    });
    
    // Draw ships and stations on top
    shipObjects.forEach(obj => {
        const x = obj.x * scaleX;
        const y = obj.y * scaleY;
        const isOwned = obj.owner_id === gameClient.userId;
        
        // Ship/station size for full map
        const size = obj.type === 'starbase' ? 8 : 6;
        
        if (obj.type === 'starbase') {
            // Starbase - square
            ctx.fillStyle = isOwned ? '#4CAF50' : '#F44336';
            ctx.fillRect(x - size/2, y - size/2, size, size);
        } else {
            // Ship - triangle
            ctx.fillStyle = isOwned ? '#2196F3' : '#FF9800';
            ctx.beginPath();
            ctx.moveTo(x, y - size/2);
            ctx.lineTo(x - size/2, y + size/2);
            ctx.lineTo(x + size/2, y + size/2);
            ctx.closePath();
            ctx.fill();
        }
        
        // Add ship labels
        if (isOwned && obj.meta && obj.meta.name) {
            ctx.fillStyle = '#ffffff';
            ctx.font = '10px Arial';
            ctx.textAlign = 'center';
            ctx.fillText(obj.meta.name, x, y + size/2 + 12);
        }
    });
}

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
                const response = await fetch(`/game/cargo/${obj.id}?userId=${gameClient.userId}`);
                if (response.ok) {
                    const data = await response.json();
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