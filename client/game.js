// Starfront: Dominion - Game Client Logic

class GameClient {
    constructor() {
        this.gameId = null;
        this.userId = null;
        this.socket = null;
        this.gameState = null;
        this.selectedUnit = null;
        this.canvas = null;
        this.ctx = null;
        this.miniCanvas = null;
        this.miniCtx = null;
        this.camera = { x: 2500, y: 2500, zoom: 1 };
        this.tileSize = 20;
        this.turnLocked = false;
        this.objects = [];
        this.units = [];
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
        this.miniCtx = this.miniCanvas.getContext('2d');
        
        // Set canvas size
        this.resizeCanvas();
        window.addEventListener('resize', () => this.resizeCanvas());
    }

    // Resize canvas to fit container
    resizeCanvas() {
        const container = this.canvas.parentElement;
        this.canvas.width = container.clientWidth;
        this.canvas.height = container.clientHeight;
        
        this.miniCanvas.width = this.miniCanvas.parentElement.clientWidth - 20;
        this.miniCanvas.height = this.miniCanvas.parentElement.clientHeight - 40;
        
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
        });

        this.socket.on('turn-resolving', (data) => {
            this.addLogEntry(`Turn ${data.turnNumber} is resolving...`, 'warning');
        });

        this.socket.on('turn-resolved', (data) => {
            this.addLogEntry(`Turn ${data.turnNumber} resolved! Starting turn ${data.nextTurn}`, 'success');
            this.loadGameState(); // Refresh game state
        });

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
            const response = await fetch(`/game/${this.gameId}/state/${this.userId}`);
            const data = await response.json();
            
            if (response.ok) {
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

        // Update units list
        const unitsList = document.getElementById('unitsList');
        const playerObjects = this.gameState.objects.filter(obj => obj.owner_id === this.userId);
        
        if (playerObjects.length === 0) {
            unitsList.innerHTML = '<div class="error">No units found</div>';
            return;
        }

        unitsList.innerHTML = playerObjects.map(obj => `
            <div class="unit-item" onclick="selectUnit(${obj.id})" id="unit-${obj.id}">
                <div class="unit-name">${this.getUnitIcon(obj.type)} ${obj.meta.name || obj.type}</div>
                <div class="unit-details">
                    Position: (${obj.x}, ${obj.y})<br>
                    HP: ${obj.meta.hp || '?'}/${obj.meta.maxHp || '?'}
                </div>
            </div>
        `).join('');

        this.objects = this.gameState.objects;
        this.units = playerObjects;
        
        // Debug: Log ships with movement data
        const movingShips = this.objects.filter(obj => obj.movementPath && obj.movementActive);
        if (movingShips.length > 0) {
            console.log(`🚢 Found ${movingShips.length} ships with active movement paths:`, movingShips.map(s => ({
                id: s.id,
                name: s.meta.name,
                pathLength: s.movementPath?.length,
                destination: s.plannedDestination,
                active: s.movementActive
            })));
        }

        // Auto-select first unit if none selected
        if (!this.selectedUnit && this.units.length > 0) {
            this.selectUnit(this.units[0].id);
        }
    }

    // Get icon for unit type
    getUnitIcon(type) {
        const icons = {
            'ship': '🚢',
            'starbase': '🏭',
            'asteroid': '🪨',
            'anomaly': '❓'
        };
        return icons[type] || '⚪';
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
        }
    }

    // Restore movement path data for a selected unit
    restoreMovementPath(unit) {
        if (unit.type !== 'ship') return;
        
        // Check if the ship has an active movement order
        if (unit.plannedDestination && unit.movementETA && !unit.movementPath) {
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
                
                // Recalculate ETA based on current position
                const updatedETA = this.calculateETA(currentPath, unit.meta.movementSpeed || 1);
                unit.movementETA = updatedETA;
                
                this.addLogEntry(`${unit.meta.name} movement path restored (${currentPath.length - 1} tiles, ETA: ${updatedETA}T)`, 'info');
            } else {
                // Clear invalid movement data if destination is unreachable
                unit.movementPath = null;
                unit.movementActive = false;
                unit.plannedDestination = null;
                unit.movementETA = null;
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
            </div>
            
            <div style="margin-top: 20px;">
                ${unit.type === 'ship' ? `
                    <button class="action-btn" onclick="setMoveMode()" ${this.turnLocked ? 'disabled' : ''}>
                        🎯 Set Destination
                    </button>
                    <button class="action-btn" onclick="scanArea()" ${this.turnLocked || !meta.canActiveScan ? 'disabled' : ''}>
                        ${meta.canActiveScan ? '🔍 Active Scan' : '🔍 Scan Area (N/A)'}
                    </button>
                ` : ''}
                
                ${unit.type === 'starbase' ? `
                    <button class="action-btn" onclick="buildShip()" ${this.turnLocked ? 'disabled' : ''}>
                        🚢 Build Ship
                    </button>
                    <button class="action-btn" onclick="upgradeBase()" ${this.turnLocked ? 'disabled' : ''}>
                        ⬆️ Upgrade Base
                    </button>
                ` : ''}
            </div>
        `;
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
        
        // Render mini-map
        this.renderMiniMap();
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

    // Draw objects on the map
    drawObjects(ctx, centerX, centerY) {
        this.objects.forEach(obj => {
            const screenX = centerX + (obj.x - this.camera.x) * this.tileSize;
            const screenY = centerY + (obj.y - this.camera.y) * this.tileSize;
            
            // Only draw if on screen
            if (screenX >= -this.tileSize && screenX <= this.canvas.width + this.tileSize &&
                screenY >= -this.tileSize && screenY <= this.canvas.height + this.tileSize) {
                
                this.drawObject(ctx, obj, screenX, screenY);
            }
        });
    }

    // Draw a single object
    drawObject(ctx, obj, x, y) {
        const size = this.tileSize * 0.8;
        const isOwned = obj.owner_id === this.userId;
        const visibility = obj.visibilityStatus || { visible: isOwned, dimmed: false };
        
        // Determine visual state based on visibility
        let alpha = 1.0;
        let borderColor = '#666';
        let backgroundColor = 'rgba(255, 255, 255, 0.1)';
        
        if (isOwned) {
            borderColor = '#4caf50';
            backgroundColor = 'rgba(76, 175, 80, 0.3)';
        } else if (visibility.dimmed) {
            // AlwaysKnown celestial objects that haven't been scanned
            alpha = 0.4;
            borderColor = '#64b5f6';
            backgroundColor = 'rgba(100, 181, 246, 0.1)';
        } else if (visibility.visible) {
            // Scanned objects
            alpha = 0.8;
            borderColor = '#ff9800';
            backgroundColor = 'rgba(255, 152, 0, 0.1)';
        }
        
        // Save context for alpha
        ctx.save();
        ctx.globalAlpha = alpha;
        
        // Draw object background
        ctx.fillStyle = backgroundColor;
        ctx.fillRect(x - size/2, y - size/2, size, size);
        
        // Draw object border
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = visibility.dimmed ? 1 : 2;
        ctx.strokeRect(x - size/2, y - size/2, size, size);
        
        // Draw object icon/text
        ctx.fillStyle = visibility.dimmed ? '#64b5f6' : '#ffffff';
        ctx.font = `${this.tileSize * 0.6}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        const icon = this.getUnitIcon(obj.type);
        ctx.fillText(icon, x, y);
        
        // Draw object name if zoomed in enough (only for owned or fully visible objects)
        if (this.tileSize > 15 && (isOwned || (visibility.visible && !visibility.dimmed))) {
            ctx.font = `${this.tileSize * 0.3}px Arial`;
            ctx.fillText(obj.meta.name || obj.type, x, y + size/2 + 10);
        }
        
        // Draw fog of war indicator for dimmed objects
        if (visibility.dimmed && this.tileSize > 12) {
            ctx.fillStyle = 'rgba(100, 181, 246, 0.6)';
            ctx.font = `${this.tileSize * 0.2}px Arial`;
            ctx.fillText('?', x + size/4, y - size/4);
        }
        
        // Restore context
        ctx.restore();
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
        
        this.objects.forEach(obj => {
            const x = obj.x * scaleX;
            const y = obj.y * scaleY;
            const size = Math.max(2, 4 * scaleX);
            
            ctx.fillStyle = obj.owner_id === this.userId ? '#4caf50' : '#666';
            ctx.fillRect(x - size/2, y - size/2, size, size);
        });
        
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
        
        // Mouse move for cursor feedback
        this.canvas.addEventListener('mousemove', (e) => this.handleCanvasMouseMove(e));
        
        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => this.handleKeyboard(e));
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
        
        // Check what's under the cursor
        const hoveredObject = this.objects.find(obj => 
            Math.abs(obj.x - worldX) <= 0.5 && Math.abs(obj.y - worldY) <= 0.5
        );
        
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
        
        // Check if clicking on an object
        const clickedObject = this.objects.find(obj => 
            Math.abs(obj.x - worldX) <= 0.5 && Math.abs(obj.y - worldY) <= 0.5
        );
        
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
        
        // Check if right-clicking on an object
        const clickedObject = this.objects.find(obj => 
            Math.abs(obj.x - worldX) <= 0.5 && Math.abs(obj.y - worldY) <= 0.5
        );
        
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
        
        // Get ship's current position (might have moved from original position)
        const currentX = this.selectedUnit.x;
        const currentY = this.selectedUnit.y;
        
        console.log(`🚢 handleMoveCommand: Ship ${this.selectedUnit.id} at (${currentX}, ${currentY}) moving to (${worldX}, ${worldY})`);
        
        // Calculate movement path from current position using Bresenham algorithm
        const movementPath = this.calculateMovementPath(
            currentX, 
            currentY, 
            worldX, 
            worldY
        );
        
        if (movementPath.length > 1) {
            const eta = this.calculateETA(movementPath, this.selectedUnit.meta.movementSpeed || 1);
            
            // Clear ALL movement data for this ship completely
            const wasMoving = this.selectedUnit.movementPath !== null;
            this.selectedUnit.movementPath = null;
            this.selectedUnit.movementActive = false;
            this.selectedUnit.plannedDestination = null;
            this.selectedUnit.movementETA = null;
            
            if (wasMoving) {
                this.addLogEntry(`${this.selectedUnit.meta.name} new route: canceling previous destination`, 'info');
            }
            
            // Set new movement data
            this.selectedUnit.movementPath = movementPath;
            this.selectedUnit.plannedDestination = { x: worldX, y: worldY };
            this.selectedUnit.movementETA = eta;
            this.selectedUnit.movementActive = true; // Flag for persistent rendering
            
            // Re-render to show the path
            this.render();
            
            console.log(`📍 Movement path calculated: ${movementPath.length - 1} tiles from (${currentX},${currentY}) to (${worldX},${worldY})`);
            this.addLogEntry(`${this.selectedUnit.meta.name} ordered to move: ${movementPath.length - 1} tiles, ETA: ${eta} turns`, 'info');
            
            // Send move command to server with explicit current position
            this.socket.emit('move-ship', {
                gameId: this.gameId,
                shipId: this.selectedUnit.id,
                currentX: currentX,
                currentY: currentY,
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

    // Draw movement paths for all visible ships with active movement orders
    drawMovementPaths(ctx, centerX, centerY) {
        // Find all ships with active movement paths (visible to this player)
        const movingShips = this.objects.filter(obj => 
            obj.type === 'ship' && 
            obj.movementPath && 
            obj.movementActive &&
            (obj.visibilityStatus?.visible || obj.owner_id === this.userId)
        );
        
        // ✅ With atomic turn resolution, phantom paths should no longer occur
        if (movingShips.length > 0) {
            console.log(`🎨 Drawing ${movingShips.length} movement paths (post-resolution state)`);
        }
        
        movingShips.forEach(ship => {
            this.drawSingleMovementPath(ctx, centerX, centerY, ship);
        });
    }

    // Draw movement path for a single ship
    drawSingleMovementPath(ctx, centerX, centerY, ship) {
        if (!ship.movementPath || ship.movementPath.length <= 1) return;
        
        const path = ship.movementPath;
        const isSelected = this.selectedUnit && this.selectedUnit.id === ship.id;
        const isOwned = ship.owner_id === this.userId;
        
        ctx.save();
        
        // Different styling for owned vs enemy, and selected vs background
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
        
        ctx.setLineDash([5, 5]);
        
        // Draw dotted line path
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
        
        // Draw current position marker (ship's actual current tile)
        const currentScreenX = centerX + (ship.x - this.camera.x) * this.tileSize;
        const currentScreenY = centerY + (ship.y - this.camera.y) * this.tileSize;
        
        ctx.setLineDash([]);
        
        // Current position marker color based on ownership and selection
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
        
        // Draw destination marker
        if (path.length > 1) {
            const dest = path[path.length - 1];
            const destScreenX = centerX + (dest.x - this.camera.x) * this.tileSize;
            const destScreenY = centerY + (dest.y - this.camera.y) * this.tileSize;
            
            // Destination marker color matching the path
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
            
            // Draw ETA near destination (only for owned ships to avoid revealing enemy info)
            if (isSelected || isOwned) {
                const eta = this.calculateETA(path, ship.meta.movementSpeed || 1);
                if (eta > 0) {
                    ctx.fillStyle = '#ffffff';
                    ctx.font = '12px Arial';
                    ctx.textAlign = 'center';
                    ctx.fillText(`ETA: ${eta}T`, destScreenX, destScreenY - 15);
                }
            }
        }
        
        ctx.restore();
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
            // Reload game state to reflect setup completion
            await this.loadGameState();
            return true; // Allow modal to close

        } catch (error) {
            console.error('Setup network error:', error);
            UI.showAlert(`Connection failed: ${error.message}. Please try again.`);
            return false;
        }
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

function buildShip() {
    if (gameClient) {
        gameClient.addLogEntry('Ship construction not yet implemented', 'warning');
        // TODO: Implement ship building
    }
}

function upgradeBase() {
    if (gameClient) {
        gameClient.addLogEntry('Base upgrades not yet implemented', 'warning');
        // TODO: Implement base upgrades
    }
} 