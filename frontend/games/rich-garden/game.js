const GARDEN_SIZE = 10;

export default class RichGardenGame {
    constructor() {
        this.isRunning = false;
        this.gameContainer = null;
        this.coins = 1000; // Start with enough coins to buy first tree
        this.garden = Array(GARDEN_SIZE).fill(null); // Each cell is null or a tree object
        this.inventory = {}; // Fruits by tree type
        this.truckInventory = {}; // Fruits currently loaded on truck
        this.gameManager = null;
        this.gameLoopInterval = null;
        this.statusRefreshInterval = null;
        this.messageTimeout = null;
        this.consoleMessages = true;

        // Truck system
        this.truckLocation = 'farm';
        this.truckDepartureTime = null;

        // Tree configuration
        this.TREE_TYPES = {
            common: { cost: 1000, fps: 1, fruitsPerCoin: 100, level: 1, name: "Common Tree" },
            bronze: { cost: 2500, fps: 2, fruitsPerCoin: 80, level: 2, name: "Bronze Tree" },
            silver: { cost: 10000, fps: 5, fruitsPerCoin: 50, level: 3, name: "Silver Tree" },
            golden: { cost: 25000, fps: 10, fruitsPerCoin: 40, level: 4, name: "Golden Tree" },
            platinum: { cost: 100000, fps: 20, fruitsPerCoin: 20, level: 5, name: "Platinum Tree" },
            diamond: { cost: 500000, fps: 50, fruitsPerCoin: 10, level: 6, name: "Diamond Tree" }
        };

        // Production constants (will be set by loadConfig)
        this.PRODUCTION_TIME = 4 * 60 * 60; // Default to normal values
        this.COLLECTION_TIME = 30 * 60;
        this.TRUCK_TRAVEL_TIME = 60 * 60;

        this.truckStatus = null;
        this.timerConfig = {
            production: this.PRODUCTION_TIME,
            collection: this.COLLECTION_TIME,
            truckTravel: this.TRUCK_TRAVEL_TIME
        };
    }

    // Set game manager
    setGameManager(gameManager) {
        this.gameManager = gameManager;
        if (this.consoleMessages) console.log('🌳 Rich Garden Manager set');
    }

    // Start game
    async start() {
        if (this.consoleMessages) console.log('🌳 Starting Rich Garden...');
        this.isRunning = true;

        await this.loadConfig();
        await this.loadGameTemplate();
        await this.loadGameData();
        this.initGame();
        this.bindGameEvents();
        this.startGameLoop();
        this.startStatusRefresh();

        this.showGameMessage('Rich Garden loaded successfully!', 'success');
        if (this.consoleMessages) console.log('✅ Rich Garden started successfully');
    }

    // Stop game
    stop() {
        if (this.consoleMessages) console.log('🌳 Stopping Rich Garden...');
        this.isRunning = false;

        if (this.gameLoopInterval) {
            clearInterval(this.gameLoopInterval);
            this.gameLoopInterval = null;
        }
        if (this.statusRefreshInterval) {
            clearInterval(this.statusRefreshInterval);
            this.statusRefreshInterval = null;
        }

        if (this.consoleMessages) console.log('✅ Rich Garden stopped');
    }

    // Load HTML template
    async loadGameTemplate() {
        const gameArea = document.getElementById('game-area');
        if (!gameArea) {
            throw new Error('Game area not found');
        }

        gameArea.innerHTML = `
            <link rel="stylesheet" href="./games/rich-garden/style.css">
            <div class="rich-garden-game">
                <div class="game-header">
                    <h2>🌳 Rich Garden</h2>
                    <button id="rg-back-btn" class="back-button">← Menu</button>
                </div>

                <!-- Stats -->
                <div class="game-stats">
                    <div class="stat-card">
                        <h3>Coins</h3>
                        <div id="rg-coins" class="stat-value">0</div>
                    </div>
                    <div class="stat-card">
                        <h3>Garden Level</h3>
                        <div id="rg-garden-level" class="stat-value">1</div>
                    </div>
                    <div class="stat-card">
                        <h3>Truck Status</h3>
                        <div id="rg-truck-status" class="stat-value">At Farm</div>
                        <div id="rg-truck-timer" class="stat-timer"></div>
                    </div>
                </div>

                <!-- Garden Grid -->
                <div class="garden-section">
                    <h3>Your Garden</h3>
                    <div id="rg-garden-grid" class="garden-grid">
                        <!-- 2x5 grid will be generated here -->
                    </div>
                </div>

                <!-- Inventory -->
                <div class="inventory-section">
                    <h3>Farm Inventory</h3>
                    <div id="rg-inventory" class="inventory-grid">
                        <!-- Fruits inventory -->
                    </div>
                </div>

                <!-- Truck Cargo -->
                <div class="inventory-section">
                    <h3>Truck Cargo</h3>
                    <div id="rg-truck-inventory" class="inventory-grid">
                        <!-- Loaded fruits -->
                    </div>
                </div>

                <!-- Controls -->
                <div class="game-controls">
                    <button id="rg-collect-all-btn" class="control-btn collect">Collect All Ready</button>
                    <button id="rg-load-truck-btn" class="control-btn truck">Load Truck</button>
                    <button id="rg-send-truck-btn" class="control-btn truck">Send Truck to City</button>
                    <button id="rg-sell-fruits-btn" class="control-btn sell">Sell Fruits</button>
                    <button id="rg-return-truck-btn" class="control-btn truck">Return Truck</button>
                </div>

                <!-- Redeem Bar -->
                ${this.config?.enableRedeem ? `
                <div class="redeem-section">
                    <h3>Redeem Code</h3>
                    <div class="redeem-input-group">
                        <input type="text" id="rg-redeem-code" placeholder="Enter code" class="redeem-input">
                        <button id="rg-redeem-btn" class="redeem-btn">Redeem</button>
                    </div>
                </div>
                ` : ''}

                <!-- Messages -->
                <div id="rg-messages" class="game-messages"></div>
            </div>
        `;

        this.gameContainer = gameArea.querySelector('.rich-garden-game');
        this.renderGardenGrid();
        this.renderInventory();
        this.renderTruckInventory();
    }

    // Load config from server
    async loadConfig() {
        try {
            const response = await fetch('/api/config');
            if (response.ok) {
                this.config = await response.json();
                if (this.consoleMessages) console.log('⚙️ Config loaded:', this.config);
            } else {
                this.config = { enableRedeem: true, showRestartButton: true, consoleMessages: true, fastMode: false };
                if (this.consoleMessages) console.log('⚠️ Failed to load config, using defaults');
            }
        } catch (error) {
            this.config = { enableRedeem: true, showRestartButton: true, consoleMessages: true, fastMode: false };
            if (this.consoleMessages) console.log('⚠️ Error loading config:', error);
        }
        // Set timer constants based on fast mode - do this ONCE here
        if (this.config.fastMode) {
            this.PRODUCTION_TIME = 30; // 30 seconds for testing
            this.COLLECTION_TIME = 15; // 15 seconds for testing
            this.TRUCK_TRAVEL_TIME = 10; // 10 seconds for testing
            if (this.consoleMessages) console.log('⏱️ FAST_MODE timers set:', { PRODUCTION_TIME: this.PRODUCTION_TIME, COLLECTION_TIME: this.COLLECTION_TIME, TRUCK_TRAVEL_TIME: this.TRUCK_TRAVEL_TIME });
        } else {
            this.PRODUCTION_TIME = 4 * 60 * 60; // 4 hours normal
            this.COLLECTION_TIME = 30 * 60; // 30 minutes normal
            this.TRUCK_TRAVEL_TIME = 60 * 60; // 1 hour normal
        }

        this.timerConfig = {
            production: this.PRODUCTION_TIME,
            collection: this.COLLECTION_TIME,
            truckTravel: this.TRUCK_TRAVEL_TIME
        };
    }

    // Load game data from server
    async loadGameData() {
        try {
            const username = window.authManager?.currentUser?.username;
            if (!username) return;
            const response = await fetch(`/api/rich-garden/status/${username}`);
            if (!response.ok) return;

            const data = await response.json();
            if (data.success) {
                this.syncStateFromPayload(data);
                this.updateUI();
                if (this.consoleMessages) console.log('🔄 Rich Garden data loaded');
            }
        } catch (error) {
            console.error('Failed to load Rich Garden data:', error);
        }
    }

    normalizeGarden(gardenData = []) {
        const normalized = [];
        for (let i = 0; i < GARDEN_SIZE; i += 1) {
            const tree = gardenData[i] || null;
            if (!tree) {
                normalized.push(null);
                continue;
            }

            normalized.push({
                ...tree,
                phase: tree.phase || tree.state || 'producing',
                secondsRemaining: typeof tree.secondsRemaining === 'number' ? Math.max(0, Math.ceil(tree.secondsRemaining)) : 0,
                plantedAt: tree.plantedAt ? new Date(tree.plantedAt) : null,
                collectionStartTime: tree.collectionStartTime ? new Date(tree.collectionStartTime) : null
            });
        }
        return normalized;
    }

    syncStateFromPayload(data) {
        if (!data) return;

        if (typeof data.coins === 'number') {
            this.coins = data.coins;
        }

        if (Array.isArray(data.garden)) {
            this.garden = this.normalizeGarden(data.garden);
        }

        if (data.inventory) {
            this.inventory = {};
            Object.entries(data.inventory).forEach(([type, amount]) => {
                this.inventory[type] = Number(amount) || 0;
            });
        } else {
            this.inventory = {};
        }

        if (data.treeTypes) {
            this.TREE_TYPES = data.treeTypes;
        }

        if (data.timers) {
            this.PRODUCTION_TIME = data.timers.production ?? this.PRODUCTION_TIME;
            this.COLLECTION_TIME = data.timers.collection ?? this.COLLECTION_TIME;
            this.TRUCK_TRAVEL_TIME = data.timers.truckTravel ?? this.TRUCK_TRAVEL_TIME;
            this.timerConfig = {
                production: this.PRODUCTION_TIME,
                collection: this.COLLECTION_TIME,
                truckTravel: this.TRUCK_TRAVEL_TIME
            };
        }

        if (data.truck) {
            this.truckStatus = {
                location: data.truck.location,
                rawLocation: data.truck.rawLocation,
                isTraveling: Boolean(data.truck.isTraveling),
                secondsRemaining: typeof data.truck.secondsRemaining === 'number' ? Math.max(0, Math.ceil(data.truck.secondsRemaining)) : 0,
                departureTime: data.truck.departureTime ? new Date(data.truck.departureTime) : null
            };
            if (data.truck.cargo) {
                this.truckInventory = {};
                Object.entries(data.truck.cargo).forEach(([type, amount]) => {
                    this.truckInventory[type] = Number(amount) || 0;
                });
            }
        } else {
            const fallbackLocation = data.truckLocation || this.truckLocation || 'farm';
            const fallbackDeparture = data.truckDepartureTime ? new Date(data.truckDepartureTime) : null;
            const isTraveling = fallbackLocation === 'traveling_to_city' || fallbackLocation === 'traveling_to_farm';
            let secondsRemaining = 0;
            if (isTraveling && fallbackDeparture) {
                const elapsed = (Date.now() - fallbackDeparture.getTime()) / 1000;
                secondsRemaining = Math.max(0, Math.ceil(this.TRUCK_TRAVEL_TIME - elapsed));
            }
            this.truckStatus = {
                location: fallbackLocation,
                rawLocation: fallbackLocation,
                isTraveling: isTraveling && secondsRemaining > 0,
                secondsRemaining,
                departureTime: fallbackDeparture
            };
        }

        if (!data.truck && data.truckInventory) {
            this.truckInventory = {};
            Object.entries(data.truckInventory).forEach(([type, amount]) => {
                this.truckInventory[type] = Number(amount) || 0;
            });
        }

        if (!this.truckInventory) {
            this.truckInventory = {};
        }

        if (this.truckStatus) {
            this.truckLocation = this.truckStatus.location || this.truckLocation || 'farm';
            this.truckDepartureTime = this.truckStatus.departureTime;
        }
    }

    // Refresh game status from server
    async refreshGameStatus() {
        try {
            const username = window.authManager?.currentUser?.username;
            if (!username) return;

            const response = await fetch(`/api/rich-garden/status/${username}`);
            if (!response.ok) return;

            const data = await response.json();
            if (data.success) {
                this.syncStateFromPayload(data);
                this.updateUI();
                if (this.consoleMessages) console.log('🔄 Rich Garden status refreshed');
            }
        } catch (error) {
            console.error('Failed to refresh Rich Garden status:', error);
        }
    }

    // Initialize game
    initGame() {
        // Game initialization
    }

    // Bind events
    bindGameEvents() {
        const backBtn = document.getElementById('rg-back-btn');
        if (backBtn) {
            backBtn.addEventListener('click', () => {
                this.showGameMessage('Returning to game menu...', 'info');
                if (this.gameManager && this.gameManager.returnToMenu) {
                    this.gameManager.returnToMenu();
                }
            });
        }

        const collectAllBtn = document.getElementById('rg-collect-all-btn');
        if (collectAllBtn) {
            collectAllBtn.addEventListener('click', () => {
                this.collectAllReady();
            });
        }

        const sendTruckBtn = document.getElementById('rg-send-truck-btn');
        if (sendTruckBtn) {
            sendTruckBtn.addEventListener('click', () => {
                this.sendTruckToCity();
            });
        }

        const loadTruckBtn = document.getElementById('rg-load-truck-btn');
        if (loadTruckBtn) {
            loadTruckBtn.addEventListener('click', () => {
                this.loadTruck();
            });
        }

        const sellFruitsBtn = document.getElementById('rg-sell-fruits-btn');
        if (sellFruitsBtn) {
            sellFruitsBtn.addEventListener('click', () => {
                this.sellFruits();
            });
        }

        const returnTruckBtn = document.getElementById('rg-return-truck-btn');
        if (returnTruckBtn) {
            returnTruckBtn.addEventListener('click', () => {
                this.returnTruckToFarm();
            });
        }

        // Only bind redeem events if feature is enabled
        if (this.config?.enableRedeem) {
            const redeemBtn = document.getElementById('rg-redeem-btn');
            if (redeemBtn) {
                redeemBtn.addEventListener('click', () => {
                    this.redeemCode();
                });
            }
        }

        // Delegate events for garden grid
        const gardenGrid = document.getElementById('rg-garden-grid');
        if (gardenGrid) {
            gardenGrid.addEventListener('click', (e) => {
                if (e.target.classList.contains('rg-buy-tree-btn')) {
                    const cellIndex = parseInt(e.target.dataset.cell);
                    this.buyTree(cellIndex);
                } else if (e.target.classList.contains('rg-upgrade-tree-btn')) {
                    const cellIndex = parseInt(e.target.dataset.cell);
                    this.upgradeTree(cellIndex);
                } else if (e.target.classList.contains('rg-collect-tree-btn')) {
                    const cellIndex = parseInt(e.target.dataset.cell);
                    this.collectTree(cellIndex);
                }
            });
        }
    }

    // Game loop for updating timers
    startGameLoop() {
        this.gameLoopInterval = setInterval(() => {
            if (!this.isRunning) return;
            this.updateTimers();
            this.updateUI();
        }, 1000);
    }

    // Start status refresh interval
    startStatusRefresh() {
        this.statusRefreshInterval = setInterval(() => {
            if (!this.isRunning) return;
            this.refreshGameStatus();
        }, 10000); // Refresh every 10 seconds
    }

    // Update all timers
    updateTimers() {
        this.garden.forEach((tree) => {
            if (!tree) return;

            if (tree.phase === 'producing') {
                if (tree.secondsRemaining > 0) {
                    tree.secondsRemaining = Math.max(0, tree.secondsRemaining - 1);
                }
                if (tree.secondsRemaining === 0) {
                    tree.phase = 'ready';
                }
            } else if (tree.phase === 'collecting') {
                if (tree.secondsRemaining > 0) {
                    tree.secondsRemaining = Math.max(0, tree.secondsRemaining - 1);
                }
                if (tree.secondsRemaining === 0) {
                    tree.phase = 'producing';
                    tree.secondsRemaining = this.timerConfig.production;
                }
            }
        });

        if (this.truckStatus && this.truckStatus.isTraveling) {
            this.truckStatus.secondsRemaining = Math.max(0, this.truckStatus.secondsRemaining - 1);
            if (this.truckStatus.secondsRemaining === 0) {
                this.truckStatus.isTraveling = false;
                this.truckStatus.location = this.truckStatus.rawLocation === 'traveling_to_city' ? 'city' : 'farm';
                this.truckStatus.rawLocation = this.truckStatus.location;
                this.truckLocation = this.truckStatus.location;
                this.truckDepartureTime = null;
            }
        }
    }

    // Render garden grid
    renderGardenGrid() {
        const gardenGrid = document.getElementById('rg-garden-grid');
        if (!gardenGrid) return;

        gardenGrid.innerHTML = '';

        for (let i = 0; i < GARDEN_SIZE; i++) {
            const cell = document.createElement('div');
            cell.className = 'garden-cell';
            cell.dataset.cell = i;

            const tree = this.garden[i];
            if (tree) {
                const treeType = this.TREE_TYPES[tree.type] || { name: tree.type };
                const stateClass = tree.phase || tree.state;
                const timerDisplay = tree.phase === 'ready' ? 'Ready!' : this.formatTime(tree.secondsRemaining);
                cell.innerHTML = `
                    <div class="tree-info">
                        <div class="tree-name">${treeType.name}</div>
                        <div class="tree-state ${stateClass}">${this.getStateText(tree)}</div>
                        <div class="tree-timer">${timerDisplay}</div>
                    </div>
                    <div class="tree-actions">
                        ${tree.phase === 'ready' ? `<button class="rg-collect-tree-btn" data-cell="${i}">Collect</button>` : ''}
                        ${this.canUpgradeTree(i) ? `<button class="rg-upgrade-tree-btn" data-cell="${i}">Upgrade</button>` : ''}
                    </div>
                `;
            } else {
                const canBuy = this.canBuyTree(i);
                cell.innerHTML = `
                    <div class="empty-cell">
                        ${canBuy ? `<button class="rg-buy-tree-btn" data-cell="${i}">Buy Tree</button>` : 'Empty'}
                    </div>
                `;
            }

            gardenGrid.appendChild(cell);
        }
    }

    // Render inventory
    renderInventory() {
        const inventoryEl = document.getElementById('rg-inventory');
        if (!inventoryEl) return;

        inventoryEl.innerHTML = '';

        let hasFruits = false;
        Object.entries(this.inventory).forEach(([type, amountRaw]) => {
            const amount = Number(amountRaw) || 0;
            if (amount > 0) {
                hasFruits = true;
                const treeType = this.TREE_TYPES[type] || { name: type, fruitsPerCoin: 1 };
                const value = Math.floor(amount / (treeType.fruitsPerCoin || 1));

                const fruitCard = document.createElement('div');
                fruitCard.className = 'fruit-card';
                fruitCard.innerHTML = `
                    <h4>${treeType.name} Fruits</h4>
                    <div class="fruit-stats">
                        <div>Amount: ${amount}</div>
                        <div>Value: ${value} coins</div>
                    </div>
                `;

                inventoryEl.appendChild(fruitCard);
            }
        });

        if (!hasFruits) {
            inventoryEl.innerHTML = '<div class="empty-inventory">No fruits in inventory</div>';
        }
    }

    // Render truck inventory
    renderTruckInventory() {
        const inventoryEl = document.getElementById('rg-truck-inventory');
        if (!inventoryEl) return;

        inventoryEl.innerHTML = '';

        let hasCargo = false;
        Object.entries(this.truckInventory || {}).forEach(([type, amountRaw]) => {
            const amount = Number(amountRaw) || 0;
            if (amount > 0) {
                hasCargo = true;
                const treeType = this.TREE_TYPES[type] || { name: type, fruitsPerCoin: 1 };
                const value = Math.floor(amount / (treeType.fruitsPerCoin || 1));

                const cargoCard = document.createElement('div');
                cargoCard.className = 'fruit-card';
                cargoCard.innerHTML = `
                    <h4>${treeType.name} Fruits</h4>
                    <div class="fruit-stats">
                        <div>Loaded: ${amount}</div>
                        <div>Value: ${value} coins</div>
                    </div>
                `;

                inventoryEl.appendChild(cargoCard);
            }
        });

        if (!hasCargo) {
            inventoryEl.innerHTML = '<div class="empty-inventory">Truck is empty</div>';
        }
    }

    // Update UI
    updateUI() {
        const coinsEl = document.getElementById('rg-coins');
        if (coinsEl) coinsEl.textContent = this.coins.toLocaleString();

        const gardenLevelEl = document.getElementById('rg-garden-level');
        if (gardenLevelEl) {
            const currentLevel = this.getCurrentGardenLevel();
            gardenLevelEl.textContent = currentLevel;
        }

        const truckStatusEl = document.getElementById('rg-truck-status');
        if (truckStatusEl) {
            const statusText = {
                'farm': 'At Farm',
                'traveling_to_city': 'Traveling to City',
                'city': 'At City',
                'traveling_to_farm': 'Returning to Farm'
            };
            const displayLocation = this.truckStatus
                ? (this.truckStatus.isTraveling ? this.truckStatus.rawLocation : this.truckStatus.location)
                : this.truckLocation;
            truckStatusEl.textContent = statusText[displayLocation] || 'Unknown';
        }

        const truckTimerEl = document.getElementById('rg-truck-timer');
        if (truckTimerEl) {
            if (this.truckStatus && this.truckStatus.isTraveling) {
                const timeLeft = this.truckStatus.secondsRemaining;
                truckTimerEl.textContent = timeLeft <= 0
                    ? 'Arriving soon...'
                    : `Arrival in: ${this.formatTime(timeLeft)}`;
            } else {
                truckTimerEl.textContent = '';
            }
        }

        this.renderGardenGrid();
        this.renderInventory();
        this.renderTruckInventory();

        const loadBtn = document.getElementById('rg-load-truck-btn');
        const sendBtn = document.getElementById('rg-send-truck-btn');
        const sellBtn = document.getElementById('rg-sell-fruits-btn');
        const returnBtn = document.getElementById('rg-return-truck-btn');

        const isTraveling = Boolean(this.truckStatus?.isTraveling);
        const atFarm = !isTraveling && this.truckLocation === 'farm';
        const atCity = !isTraveling && this.truckLocation === 'city';
        const hasFarmFruits = this.getTotalResources(this.inventory) > 0;
        const hasCargo = this.getTotalResources(this.truckInventory) > 0;

        if (loadBtn) loadBtn.disabled = !atFarm || !hasFarmFruits;
        if (sendBtn) sendBtn.disabled = !atFarm;
        if (sellBtn) sellBtn.disabled = !atCity || !hasCargo;
        if (returnBtn) returnBtn.disabled = !atCity;
    }

    // Helper methods
    getStateText(tree) {
        const phase = tree?.phase || tree?.state;
        switch (phase) {
            case 'producing': return 'Growing';
            case 'ready': return 'Ready to Collect';
            case 'collecting': return 'Collecting';
            default: return 'Unknown';
        }
    }

    formatTime(seconds) {
        let totalSeconds = typeof seconds === 'number' ? seconds : 0;
        if (totalSeconds < 0) totalSeconds = 0;
        const rounded = Math.ceil(totalSeconds);
        const hours = Math.floor(rounded / 3600);
        const minutes = Math.floor((rounded % 3600) / 60);
        const secs = Math.floor(rounded % 60);

        if (hours > 0) {
            return `${hours}h ${minutes}m ${secs}s`;
        }
        if (minutes > 0) {
            return `${minutes}m ${secs}s`;
        }
        return `${secs}s`;
    }

    getTotalResources(resourceMap = {}) {
        return Object.values(resourceMap).reduce((sum, rawAmount) => {
            const amount = Number(rawAmount) || 0;
            return sum + amount;
        }, 0);
    }

    getCurrentGardenLevel() {
        if (!this.garden.some(tree => tree)) return 1;

        const minLevel = Math.min(...this.garden.filter(tree => tree).map(tree => this.TREE_TYPES[tree.type].level));
        return minLevel;
    }

    canBuyTree(cellIndex) {
        // Must buy sequentially from left to right
        for (let i = 0; i < cellIndex; i++) {
            if (!this.garden[i]) return false;
        }
        // Allow buying first tree at farm, others require city
        const isFirstTree = cellIndex === 0 && this.garden.every(tree => tree === null);
        const canAfford = this.coins >= this.TREE_TYPES.common.cost;
        return canAfford && ((isFirstTree && this.truckLocation === 'farm') || this.truckLocation === 'city');
    }

    canUpgradeTree(cellIndex) {
        const tree = this.garden[cellIndex];
        if (!tree) return false;

        const currentLevel = this.TREE_TYPES[tree.type].level;
        if (currentLevel >= 6) return false; // Max level

        const nextLevel = currentLevel + 1;

        // Find the highest level tree currently owned
        const maxOwnedLevel = Math.max(...this.garden.filter(t => t).map(t => this.TREE_TYPES[t.type].level));

        // Check if trying to upgrade to a level higher than currently owned
        if (nextLevel > maxOwnedLevel) {
            // To unlock a new level, need 10 trees at the previous level
            const prevLevelTrees = this.garden.filter(t => t && this.TREE_TYPES[t.type].level === currentLevel).length;
            if (prevLevelTrees < 10) return false;
        }
        // If upgrading to a level you already own, or unlocking a new level with 10 prev level trees, allow it

        const nextType = Object.values(this.TREE_TYPES).find(t => t.level === currentLevel + 1);
        return this.truckLocation === 'city' && this.coins >= nextType.cost;
    }

    // Game actions
    async buyTree(cellIndex) {
        if (!this.canBuyTree(cellIndex)) {
            this.showGameMessage('Cannot buy tree here!', 'error');
            return;
        }

        try {
            const username = window.authManager?.currentUser?.username;
            if (!username) return;

            const response = await fetch('/api/rich-garden/buy_tree', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, cellIndex })
            });

            const data = await response.json();
            if (data.success) {
                this.syncStateFromPayload(data);
                this.updateUI();
                this.showGameMessage('Tree purchased!', 'success');
                setTimeout(() => this.refreshGameStatus(), 1000);
            } else {
                this.showGameMessage(data.error || 'Failed to buy tree', 'error');
            }
        } catch (error) {
            console.error('Buy tree error:', error);
            this.showGameMessage('Failed to buy tree', 'error');
        }
    }

    async upgradeTree(cellIndex) {
        if (!this.canUpgradeTree(cellIndex)) {
            this.showGameMessage('Cannot upgrade tree yet!', 'error');
            return;
        }

        try {
            const username = window.authManager?.currentUser?.username;
            if (!username) return;

            const response = await fetch('/api/rich-garden/upgrade_tree', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, cellIndex })
            });

            const data = await response.json();
            if (data.success) {
                this.syncStateFromPayload(data);
                this.updateUI();
                this.showGameMessage('Tree upgraded!', 'success');
                setTimeout(() => this.refreshGameStatus(), 1000);
            } else {
                this.showGameMessage(data.error || 'Failed to upgrade tree', 'error');
            }
        } catch (error) {
            console.error('Upgrade tree error:', error);
            this.showGameMessage('Failed to upgrade tree', 'error');
        }
    }

    async collectTree(cellIndex) {
        const tree = this.garden[cellIndex];
        if (!tree) {
            this.showGameMessage('No tree in this cell!', 'error');
            return;
        }

        if (tree.phase !== 'ready') {
            this.showGameMessage('Tree not ready for collection!', 'error');
            return;
        }

        try {
            const username = window.authManager?.currentUser?.username;
            if (!username) return;

            const response = await fetch('/api/rich-garden/collect_tree', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, cellIndex })
            });

            const data = await response.json();
            if (data.success) {
                this.syncStateFromPayload(data);
                this.updateUI();
                const collectedTotals = data.collected || {};
                const totalFruits = Object.values(collectedTotals).reduce((sum, amount) => sum + amount, 0);
                if (totalFruits > 0) {
                    this.showGameMessage(`Collected ${totalFruits.toLocaleString()} fruits! Collection in progress...`, 'success');
                } else {
                    this.showGameMessage('Collection started! Tree will be harvested soon.', 'success');
                }
                // Don't refresh status here - let the collection timer handle it
            } else {
                this.showGameMessage(data.error || 'Failed to start collection', 'error');
            }
        } catch (error) {
            console.error('Collect tree error:', error);
            this.showGameMessage('Failed to collect tree', 'error');
        }
    }

    async collectAllReady() {
        const readyTrees = this.garden
            .map((tree, index) => ({ tree, index }))
            .filter(({ tree }) => tree && tree.phase === 'ready');

        if (readyTrees.length === 0) {
            this.showGameMessage('No trees ready for collection!', 'info');
            return;
        }

        for (const { index } of readyTrees) {
            await this.collectTree(index);
        }
    }

    async loadTruck() {
        if (this.truckLocation !== 'farm') {
            this.showGameMessage('Truck must be at farm to load!', 'error');
            return;
        }

        if (this.getTotalResources(this.inventory) === 0) {
            this.showGameMessage('No fruits available to load!', 'info');
            return;
        }

        try {
            const username = window.authManager?.currentUser?.username;
            if (!username) return;

            const response = await fetch('/api/rich-garden/load_truck', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username })
            });

            const data = await response.json();
            if (data.success) {
                this.syncStateFromPayload(data);
                this.updateUI();

                const loadedTotal = this.getTotalResources(data.loaded || {});
                if (loadedTotal > 0) {
                    const types = Object.keys(data.loaded || {}).map((type) => {
                        const amount = Number(data.loaded?.[type]) || 0;
                        const label = this.TREE_TYPES[type]?.name || type;
                        return `${amount.toLocaleString()} ${label}`;
                    });
                    const detail = types.length > 0 ? ` (${types.join(', ')})` : '';
                    this.showGameMessage(`Loaded ${loadedTotal.toLocaleString()} fruits onto the truck${detail}.`, 'success');
                } else {
                    this.showGameMessage('Truck loaded.', 'success');
                }

                if (data.collected) {
                    const collectedTotal = this.getTotalResources(data.collected);
                    if (collectedTotal > 0) {
                        this.showGameMessage(`Auto-collected ${collectedTotal.toLocaleString()} fruits while loading.`, 'info');
                    }
                }

                setTimeout(() => this.refreshGameStatus(), 1000);
            } else {
                this.showGameMessage(data.error || 'Failed to load truck', 'error');
            }
        } catch (error) {
            console.error('Load truck error:', error);
            this.showGameMessage('Failed to load truck', 'error');
        }
    }

    async sendTruckToCity() {
        if (this.truckLocation !== 'farm') {
            this.showGameMessage('Truck is not at farm!', 'error');
            return;
        }

        try {
            const username = window.authManager?.currentUser?.username;
            if (!username) return;

            const response = await fetch('/api/rich-garden/send_truck', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username })
            });

            const data = await response.json();
            if (data.success) {
                this.syncStateFromPayload(data);
                this.updateUI();
                this.showGameMessage('Truck sent to city!', 'info');
                setTimeout(() => this.refreshGameStatus(), 1000);
            } else {
                this.showGameMessage(data.error || 'Failed to send truck', 'error');
            }
        } catch (error) {
            console.error('Send truck error:', error);
            this.showGameMessage('Failed to send truck', 'error');
        }
    }

    async sellFruits() {
        if (this.truckLocation !== 'city') {
            this.showGameMessage('Truck must be at city to sell fruits!', 'error');
            return;
        }

        const totalCargo = this.getTotalResources(this.truckInventory);
        if (totalCargo === 0) {
            this.showGameMessage('No fruits loaded on the truck!', 'error');
            return;
        }

        try {
            const username = window.authManager?.currentUser?.username;
            if (!username) return;

            const response = await fetch('/api/rich-garden/sell_fruits', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username })
            });

            const data = await response.json();
            if (data.success) {
                this.syncStateFromPayload(data);
                this.updateUI();
                const soldTotal = this.getTotalResources(data.sold || {});
                this.showGameMessage(`Sold ${soldTotal.toLocaleString()} fruits for ${data.earned} coins!`, 'success');
                if (data.collected) {
                    const collectedTotal = this.getTotalResources(data.collected);
                    if (collectedTotal > 0) {
                        this.showGameMessage(`Auto-collected ${collectedTotal.toLocaleString()} fruits while selling.`, 'info');
                    }
                }
                setTimeout(() => this.refreshGameStatus(), 1000);
            } else {
                this.showGameMessage(data.error || 'Failed to sell fruits', 'error');
            }
        } catch (error) {
            console.error('Sell fruits error:', error);
            this.showGameMessage('Failed to sell fruits', 'error');
        }
    }

    async returnTruckToFarm() {
        if (this.truckLocation !== 'city') {
            this.showGameMessage('Truck must be at city to return!', 'error');
            return;
        }

        try {
            const username = window.authManager?.currentUser?.username;
            if (!username) return;

            const response = await fetch('/api/rich-garden/return_truck', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username })
            });

            const data = await response.json();
            if (data.success) {
                this.syncStateFromPayload(data);
                this.updateUI();
                this.showGameMessage('Truck returning to farm!', 'info');
                setTimeout(() => this.refreshGameStatus(), 1000);
            } else {
                this.showGameMessage(data.error || 'Failed to return truck', 'error');
            }
        } catch (error) {
            console.error('Return truck error:', error);
            this.showGameMessage('Failed to return truck', 'error');
        }
    }

    async redeemCode() {
        const codeInput = document.getElementById('rg-redeem-code');
        if (!codeInput) return;

        const code = codeInput.value.trim().toUpperCase();
        if (!code) {
            this.showGameMessage('Please enter a code!', 'error');
            return;
        }

        try {
            const username = window.authManager?.currentUser?.username;
            if (!username) return;

            const response = await fetch('/api/rich-garden/redeem', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, code })
            });

            const data = await response.json();
            if (data.success) {
                this.syncStateFromPayload(data);
                this.updateUI();
                this.showGameMessage(`Code redeemed: ${data.message}`, 'success');
                codeInput.value = '';
                setTimeout(() => this.refreshGameStatus(), 1000);
            } else {
                this.showGameMessage(data.error || 'Invalid code', 'error');
            }
        } catch (error) {
            console.error('Redeem error:', error);
            this.showGameMessage('Failed to redeem code', 'error');
        }
    }

    // Show game message
    showGameMessage(message, type = 'info') {
        if (window.toastManager) {
            window.toastManager.show(message, type);
            return;
        }

        const messagesEl = document.getElementById('rg-messages');
        if (!messagesEl) return;

        const messageEl = document.createElement('div');
        messageEl.className = `game-message ${type}`;
        messageEl.textContent = message;

        messagesEl.appendChild(messageEl);

        setTimeout(() => {
            if (messageEl.parentNode) {
                messageEl.remove();
            }
        }, 5000);
    }
}