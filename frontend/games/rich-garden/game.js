const GARDEN_SIZE = 10;

export default class RichGardenGame {
    constructor() {
        this.isRunning = false;
        this.gameContainer = null;
        this.coins = 1000; // Start with enough coins to buy first tree
        this.garden = Array(GARDEN_SIZE).fill(null); // Each cell is null or a tree object
        this.inventory = {}; // Fruits by tree type
        this.truckInventory = {}; // Fruits currently loaded on truck
        this.fruitCrates = {}; // Serialized crate data from backend
        this.treeCrate = { capacity: 0, queued: {} };
        this.treeCrateSummary = null;
        this.totalQueuedByType = {};
        this.treeCrateVehicleLimits = { truck: 5, helicopter: 25 };
        this.transportMetrics = null;
        this.plantingSummary = {};
        this.upgrades = {};
        this.transport = { activeMode: 'truck', truck: null, helicopter: null };
        this.activeVehicle = 'truck';
        this.gardenManagementEnabled = true;
        this.modalElements = null;
        this.boundTreeShopHandler = null;
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
            banana: { cost: 1000, fps: 1, fruitsPerCoin: 100, level: 1, name: "Banana Tree" },
            apple: { cost: 2500, fps: 2, fruitsPerCoin: 80, level: 2, name: "Apple Tree" },
            orange: { cost: 10000, fps: 5, fruitsPerCoin: 50, level: 3, name: "Orange Tree" },
            pomegranate: { cost: 25000, fps: 10, fruitsPerCoin: 40, level: 4, name: "Pomegranate Tree" },
            mango: { cost: 100000, fps: 20, fruitsPerCoin: 20, level: 5, name: "Mango Tree" },
            durian: { cost: 500000, fps: 50, fruitsPerCoin: 10, level: 6, name: "Durian Tree" }
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

        this.handleModalKeydown = (event) => {
            if (event.key === 'Escape') {
                this.closeShopModal();
            }
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
                        <h3>Vehicle Status</h3>
                        <div id="rg-truck-status" class="stat-value">At Farm</div>
                        <div id="rg-truck-timer" class="stat-timer"></div>
                    </div>
                </div>

                <!-- Transport Panel -->
                <section class="transport-panel">
                    <div class="transport-panel__header">
                        <div>
                            <p class="panel-kicker">Logistics</p>
                            <h3>Transportation Fleet</h3>
                            <p>Monitor vehicles, crate health, and travel timing from a single board.</p>
                        </div>
                        <div class="vehicle-toggle" id="rg-vehicle-toggle">
                            <button type="button" class="vehicle-btn is-active" data-vehicle="truck">Truck</button>
                            <button type="button" class="vehicle-btn" data-vehicle="helicopter">Helicopter</button>
                        </div>
                    </div>
                    <div class="transport-overview">
                        <div class="vehicle-card">
                            <div class="vehicle-card__meta">
                                <span class="label">Active Vehicle</span>
                                <h4 id="rg-active-vehicle">Truck</h4>
                                <p id="rg-vehicle-location" class="vehicle-location">At Farm</p>
                            </div>
                            <div class="vehicle-progress">
                                <div class="vehicle-progress-bar">
                                    <div id="rg-travel-progress-fill"></div>
                                </div>
                                <div id="rg-travel-progress-label" class="vehicle-progress-label">Idle</div>
                            </div>
                            <div class="vehicle-stats">
                                <div>
                                    <span>Crates Loaded</span>
                                    <strong id="rg-crate-load-chip">0%</strong>
                                </div>
                                <div>
                                    <span>Tree Crate</span>
                                    <strong id="rg-tree-crate-chip">0 / 0</strong>
                                </div>
                                <div>
                                    <span>Travel Status</span>
                                    <strong id="rg-travel-state-chip">Idle</strong>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="transport-grid">
                        <div class="transport-card">
                            <div class="transport-card__title">
                                <h4>Fruit Crate Status</h4>
                                <span id="rg-crate-note" class="transport-note"></span>
                            </div>
                            <div id="rg-crate-status" class="inventory-grid"></div>
                        </div>
                        <div class="transport-card tree-crate-panel">
                            <div class="tree-crate-panel__heading">
                                <div>
                                    <h4>Tree Crate</h4>
                                    <p class="transport-note">Manage staged saplings for each vehicle.</p>
                                </div>
                                <div class="tree-crate-panel__capacity">
                                    <span>Active Slots</span>
                                    <strong id="rg-tree-active-capacity">0 / 0</strong>
                                </div>
                            </div>
                            <div class="tree-crate-meta">
                                <div>
                                    <span>Slots Open</span>
                                    <strong id="rg-tree-open-slots">0</strong>
                                </div>
                                <div>
                                    <span>Truck Capacity</span>
                                    <strong id="rg-tree-limit-truck">5 trees</strong>
                                </div>
                                <div>
                                    <span>Helicopter Capacity</span>
                                    <strong id="rg-tree-limit-helicopter">25 trees</strong>
                                </div>
                            </div>
                            <p id="rg-tree-note" class="transport-note">No trees staged</p>
                            <div id="rg-tree-crate" class="tree-crate-grid"></div>
                        </div>
                    </div>
                </section>

                <!-- Garden Grid -->
                <div class="garden-section">
                    <h3>Your Garden</h3>
                    <div id="rg-garden-grid" class="garden-grid">
                        <!-- 2x5 grid will be generated here -->
                    </div>
                </div>

                <!-- Garden Management -->
                <section id="rg-garden-management" class="garden-management-panel">
                    <div class="panel-header">
                        <div>
                            <p class="panel-kicker">Agronomy</p>
                            <h3>Garden Management</h3>
                            <p>Understand composition, planting windows, and overall production cadence.</p>
                        </div>
                    </div>
                    <div class="garden-management-grid">
                        <div class="gm-card">
                            <div class="gm-card__header">
                                <h4>Tree Composition</h4>
                                <span id="rg-tree-total-chip">0 / 10 plots</span>
                            </div>
                            <div id="rg-garden-composition" class="composition-grid"></div>
                        </div>
                        <div class="gm-card">
                            <div class="gm-card__header">
                                <h4>Planting Availability</h4>
                            </div>
                            <div id="rg-planting-availability" class="inventory-grid"></div>
                        </div>
                        <div class="gm-card">
                            <div class="gm-card__header">
                                <h4>Production Status</h4>
                            </div>
                            <div id="rg-production-status" class="production-grid"></div>
                        </div>
                    </div>
                </section>

                <!-- Inventory -->
                <div class="inventory-section">
                    <h3>Farm Inventory</h3>
                    <div id="rg-inventory" class="inventory-grid">
                        <!-- Fruits inventory -->
                    </div>
                </div>

                <!-- Controls -->
                <div class="game-controls">
                    <button id="rg-collect-all-btn" class="control-btn collect">Collect All Ready</button>
                    <button id="rg-load-truck-btn" class="control-btn truck">Load Vehicle</button>
                    <button id="rg-send-truck-btn" class="control-btn truck">Send Vehicle to City</button>
                    <button id="rg-sell-fruits-btn" class="control-btn sell">Sell Fruits</button>
                    <button id="rg-return-truck-btn" class="control-btn truck">Return Vehicle</button>
                    <button id="rg-open-tree-shop-btn" class="control-btn shop">Buy Trees</button>
                </div>

                <!-- Messages -->
                <div id="rg-messages" class="game-messages"></div>
            </div>
        `;

        this.gameContainer = gameArea.querySelector('.rich-garden-game');
        this.renderGardenGrid();
        this.renderInventory();
        this.renderCrateStatus();
        this.renderTreeCrate();
        this.renderPlantingAvailability();
        this.renderGardenComposition();
        this.renderProductionStatus();
        this.updateTransportPanel();
        this.ensureShopModal();
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

        if (data.upgrades && typeof data.upgrades === 'object') {
            this.upgrades = { ...data.upgrades };
        } else {
            this.upgrades = {};
        }
        const helicopterUnlocked = Boolean(this.upgrades.helicopterTransport);
        if (!helicopterUnlocked && this.activeVehicle === 'helicopter') {
            this.activeVehicle = 'truck';
        }

        if (typeof data.coins === 'number') {
            this.coins = data.coins;
        }

        if (Array.isArray(data.garden)) {
            this.garden = this.normalizeGarden(data.garden);
        }

        const farmInventorySource = data.farmInventory || data.inventory;
        if (farmInventorySource && typeof farmInventorySource === 'object') {
            this.inventory = {};
            Object.entries(farmInventorySource).forEach(([type, amount]) => {
                this.inventory[type] = Number(amount) || 0;
            });
        } else {
            this.inventory = {};
        }

        if (data.treeTypes) {
            this.TREE_TYPES = data.treeTypes;
        }

        if (data.fruitCrates && typeof data.fruitCrates === 'object') {
            this.fruitCrates = {};
            Object.entries(data.fruitCrates).forEach(([type, crate]) => {
                this.fruitCrates[type] = { ...(crate || {}) };
            });
        } else {
            this.fruitCrates = {};
        }

        if (data.treeCrate && typeof data.treeCrate === 'object') {
            this.treeCrate = {
                ...data.treeCrate,
                queued: { ...(data.treeCrate.queued || {}) }
            };
        } else {
            this.treeCrate = { capacity: 0, queued: {} };
        }

        if (data.treeCrateSummary?.vehicleCapacity) {
            this.treeCrateVehicleLimits = {
                truck: data.treeCrateSummary.vehicleCapacity.truck ?? this.treeCrateVehicleLimits.truck,
                helicopter: data.treeCrateSummary.vehicleCapacity.helicopter ?? this.treeCrateVehicleLimits.helicopter
            };
        }
        this.refreshTreeCrateSummary();
        if (data.treeCrateSummary?.globalQueuedByType) {
            this.totalQueuedByType = this.cloneResourceMap(data.treeCrateSummary.globalQueuedByType);
        } else {
            this.totalQueuedByType = this.cloneResourceMap(this.treeCrateSummary?.queuedByType || {});
        }

        if (data.plantingSummary && typeof data.plantingSummary === 'object') {
            this.plantingSummary = {};
            Object.entries(data.plantingSummary).forEach(([type, summary]) => {
                this.plantingSummary[type] = {
                    canPlant: Boolean(summary?.canPlant),
                    targets: Array.isArray(summary?.targets) ? [...summary.targets] : []
                };
            });
        } else {
            this.plantingSummary = {};
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

        if (data.transport) {
            this.transport = this.prepareTransportState(data.transport);
        } else {
            this.transport = this.prepareTransportState({
                activeMode: 'truck',
                truck: {
                    location: this.truckStatus?.rawLocation || this.truckStatus?.location || this.truckLocation || 'farm',
                    isTraveling: Boolean(this.truckStatus?.isTraveling),
                    secondsRemaining: this.truckStatus?.secondsRemaining || 0,
                    travelSeconds: this.timerConfig.truckTravel,
                    departureTime: this.truckStatus?.departureTime || null,
                    fruitCrates: this.fruitCrates,
                    treeCrate: this.treeCrate,
                    cargo: this.truckInventory
                }
            });
        }

        this.transportMetrics = this.cloneTransportMetrics(data.transportMetrics) || null;

        const preferredVehicle = this.resolvePreferredVehicleMode();
        const applied = this.applyVehicleState(preferredVehicle, { preserveMetrics: Boolean(this.transportMetrics) });
        if (!applied && preferredVehicle === 'helicopter') {
            this.activeVehicle = 'truck';
            this.applyVehicleState('truck', { preserveMetrics: Boolean(this.transportMetrics) });
        } else {
            this.activeVehicle = preferredVehicle;
        }

        if (!this.transportMetrics) {
            this.transportMetrics = this.buildLocalTransportMetrics();
        }

        if (this.truckStatus) {
            this.truckLocation = this.truckStatus.location || this.truckLocation || 'farm';
            this.truckDepartureTime = this.truckStatus.departureTime;
        }

        if (typeof data.gardenManagementEnabled === 'boolean') {
            this.gardenManagementEnabled = data.gardenManagementEnabled;
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

        // Delegate events for garden grid
        const gardenGrid = document.getElementById('rg-garden-grid');
        if (gardenGrid) {
            gardenGrid.addEventListener('click', (e) => {
                if (e.target.classList.contains('rg-collect-tree-btn')) {
                    const cellIndex = parseInt(e.target.dataset.cell, 10);
                    this.collectTree(cellIndex);
                } else if (e.target.classList.contains('rg-plant-from-crate-btn')) {
                    const cellIndex = parseInt(e.target.dataset.cell, 10);
                    const treeType = e.target.dataset.type;
                    this.plantTreeFromCrate(cellIndex, treeType);
                }
            });
        }

        const vehicleToggle = document.getElementById('rg-vehicle-toggle');
        if (vehicleToggle) {
            vehicleToggle.addEventListener('click', (event) => {
                const button = event.target.closest('.vehicle-btn');
                if (!button) {
                    return;
                }
                const vehicle = button.dataset.vehicle;
                if (!vehicle) {
                    return;
                }
                this.handleVehicleSelect(vehicle);
            });
        }

        const openTreeShopBtn = document.getElementById('rg-open-tree-shop-btn');
        if (openTreeShopBtn) {
            openTreeShopBtn.addEventListener('click', () => {
                this.openTreePurchaseModal();
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

        const activeVehicleState = this.transport?.[this.activeVehicle];
        if (activeVehicleState && this.truckStatus) {
            activeVehicleState.isTraveling = Boolean(this.truckStatus.isTraveling);
            activeVehicleState.secondsRemaining = this.truckStatus.secondsRemaining || 0;
            activeVehicleState.location = this.truckStatus.isTraveling
                ? (this.truckStatus.rawLocation || activeVehicleState.location)
                : (this.truckStatus.location || activeVehicleState.location);
            activeVehicleState.departureTime = this.truckStatus.departureTime || null;
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
                    </div>
                `;
            } else {
                const unlocked = true;
                cell.innerHTML = `
                    <div class="empty-cell">
                        ${unlocked ? 'Slot available — queue saplings in the city, then plant them from the crate.' : 'Empty plot'}
                    </div>
                `;
            }

            const plantableTypes = this.getPlantableTypesForCell(i);
            if (plantableTypes.length > 0) {
                const nextType = plantableTypes[0];
                const label = this.TREE_TYPES[nextType]?.name || nextType;
                const plantingWrap = document.createElement('div');
                plantingWrap.className = 'planting-actions';
                plantingWrap.innerHTML = `
                    <button class="rg-plant-from-crate-btn" data-cell="${i}" data-type="${nextType}">
                        Plant ${label}
                    </button>
                `;
                cell.appendChild(plantingWrap);
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

    renderCrateStatus() {
        const crateEl = document.getElementById('rg-crate-status');
        if (!crateEl) return;

        const crateEntries = Object.entries(this.fruitCrates || {});
        if (crateEntries.length === 0) {
            crateEl.innerHTML = '<div class="empty-inventory">No crate data available</div>';
            return;
        }

        crateEl.innerHTML = '';

        crateEntries.forEach(([type, crateData]) => {
            const crate = crateData || {};
            const treeConfig = this.TREE_TYPES[type] || {};
            const label = crate.label || `${treeConfig.name || type} Crate`;
            const loaded = Math.max(0, Number(crate.loaded) || 0);
            const baseCapacity = Math.max(0, Number(crate.capacity) || 0);
            const multiplier = Math.max(1, Number(crate.multiplier) || 1);
            const unlimited = Boolean(crate.unlimited);
            const capacity = unlimited ? Infinity : Math.floor(baseCapacity * multiplier);
            const percent = capacity === Infinity || capacity === 0
                ? 0
                : Math.min(100, Math.round((loaded / capacity) * 100));
            const card = document.createElement('div');
            const fullnessClass = unlimited ? 'unlimited' : percent >= 90 ? 'critical' : percent >= 60 ? 'warning' : 'stable';
            card.className = `fruit-card crate-card ${fullnessClass}`;
            const capacityLabel = capacity === Infinity ? '∞' : capacity.toLocaleString();
            const percentLabel = unlimited ? 'Unlimited capacity' : `${percent}% full`;
            const progressBar = unlimited
                ? ''
                : `<div class="rg-capacity-bar"><div class="rg-capacity-fill" style="width: ${percent}%"></div></div>`;

            card.innerHTML = `
                <h4>${label}</h4>
                <div class="fruit-stats">
                    <div>Loaded: ${loaded.toLocaleString()}</div>
                    <div>Capacity: ${capacityLabel}</div>
                </div>
                <div class="crate-note">${percentLabel}</div>
                ${progressBar}
            `;

            crateEl.appendChild(card);
        });
    }

    updateTreeCrateMeta(summary = this.treeCrateSummary) {
        if (!summary) {
            return;
        }
        const activeCap = document.getElementById('rg-tree-active-capacity');
        if (activeCap) {
            if (summary.unlimited) {
                activeCap.textContent = `${summary.queued.toLocaleString()} staged`;
            } else if (typeof summary.capacity === 'number') {
                activeCap.textContent = `${summary.queued} / ${summary.capacity}`;
            } else {
                activeCap.textContent = `${summary.queued} staged`;
            }
        }
        const openSlots = document.getElementById('rg-tree-open-slots');
        if (openSlots) {
            openSlots.textContent = summary.unlimited
                ? '∞'
                : `${Math.max(0, summary.availableSlots || 0)}`;
        }
        const noteEl = document.getElementById('rg-tree-note');
        if (noteEl) {
            noteEl.textContent = summary.unlimited
                ? 'Unlimited tree crate active'
                : `${Math.max(0, summary.availableSlots || 0)} slot(s) open on this vehicle`;
        }
        const truckLimitEl = document.getElementById('rg-tree-limit-truck');
        if (truckLimitEl) {
            const truckCap = summary.vehicleCapacity?.truck ?? this.treeCrateVehicleLimits.truck;
            truckLimitEl.textContent = `${truckCap} trees`;
        }
        const heliLimitEl = document.getElementById('rg-tree-limit-helicopter');
        if (heliLimitEl) {
            const heliCap = summary.vehicleCapacity?.helicopter ?? this.treeCrateVehicleLimits.helicopter;
            heliLimitEl.textContent = `${heliCap} trees`;
        }
    }

    renderTreeCrate() {
        const treeCrateEl = document.getElementById('rg-tree-crate');
        if (!treeCrateEl) return;

        const summary = this.treeCrateSummary || this.refreshTreeCrateSummary();
        this.updateTreeCrateMeta(summary);

        const queuedEntries = Object.entries(summary.queuedByType || {}).filter(([, countRaw]) => (Number(countRaw) || 0) > 0);

        if (queuedEntries.length === 0) {
            treeCrateEl.innerHTML = '<div class="empty-inventory">No trees staged in the crate</div>';
            return;
        }

        treeCrateEl.innerHTML = queuedEntries.map(([type, countRaw]) => {
            const count = Number(countRaw) || 0;
            const treeConfig = this.TREE_TYPES[type] || { name: type };
            const planter = this.plantingSummary?.[type];
            const targetCount = Array.isArray(planter?.targets) ? planter.targets.length : 0;
            const canPlant = Boolean(planter?.canPlant && targetCount > 0);
            const plantStatus = canPlant
                ? `Ready for ${targetCount} plot${targetCount === 1 ? '' : 's'}`
                : 'Waiting for slots';
            const capacityNote = summary.unlimited
                ? 'Unlimited crate capacity'
                : `${Math.max(0, summary.availableSlots || 0)} slot(s) open`;
            return `
                <div class="tree-crate-card ${canPlant ? 'plantable' : 'blocked'}">
                    <h4>${treeConfig.name}</h4>
                    <div class="tree-crate-count">Queued: ${count}</div>
                    <div class="tree-crate-slot">${plantStatus}</div>
                    <div class="tree-crate-capacity">${capacityNote}</div>
                </div>
            `;
        }).join('');
    }

    renderPlantingAvailability() {
        const plantingEl = document.getElementById('rg-planting-availability');
        if (!plantingEl) return;

        const summary = this.plantingSummary || {};
        const treeTypes = Object.keys(this.TREE_TYPES || {});
        if (treeTypes.length === 0) {
            plantingEl.innerHTML = '<div class="empty-inventory">No tree data available</div>';
            return;
        }

        plantingEl.innerHTML = '';
        treeTypes.forEach((type) => {
            const treeConfig = this.TREE_TYPES[type];
            if (!treeConfig) {
                return;
            }
            const info = summary[type] || {};
            const canPlant = Boolean(info.canPlant);
            const targets = Array.isArray(info.targets) ? info.targets : [];
            const previewTargets = targets.slice(0, 3).map(idx => `#${idx + 1}`);
            const additionalTargets = targets.length > 3 ? ` +${targets.length - 3} more` : '';
            const targetLabel = targets.length === 0
                ? 'No planting slots available'
                : `Targets: ${previewTargets.join(', ')}${additionalTargets}`;

            const card = document.createElement('div');
            card.className = `planting-card ${canPlant ? 'available' : 'blocked'}`;
            card.innerHTML = `
                <h4>${treeConfig.name}</h4>
                <div class="planting-status">${canPlant ? 'Plantable now' : 'Blocked'}</div>
                <div class="planting-targets">${targetLabel}</div>
            `;

            plantingEl.appendChild(card);
        });
    }

    renderGardenComposition() {
        const container = document.getElementById('rg-garden-composition');
        if (!container) return;

        const totals = [];
        let plantedTotal = 0;
        Object.entries(this.TREE_TYPES || {}).forEach(([type, config]) => {
            const count = this.garden.filter((tree) => tree && tree.type === type).length;
            plantedTotal += count;
            totals.push({
                type,
                label: config?.name || type,
                level: config?.level || 0,
                count
            });
        });
        totals.sort((a, b) => a.level - b.level);

        const totalChip = document.getElementById('rg-tree-total-chip');
        if (totalChip) {
            totalChip.textContent = `${plantedTotal} / ${GARDEN_SIZE} plots`;
        }

        if (totals.length === 0) {
            container.innerHTML = '<div class="empty-inventory">Tree data not available</div>';
            return;
        }

        if (totals.every((entry) => entry.count === 0)) {
            container.innerHTML = '<div class="empty-inventory">No trees planted yet</div>';
            return;
        }

        container.innerHTML = totals.map((entry) => {
            const percent = plantedTotal > 0 ? Math.round((entry.count / plantedTotal) * 100) : 0;
            return `
                <div class="composition-card" data-count="${entry.count}">
                    <div class="composition-card__header">
                        <span class="composition-label">${entry.label}</span>
                        <span class="composition-level">Lvl ${entry.level}</span>
                    </div>
                    <div class="composition-metric">
                        <strong>${entry.count}</strong>
                        <span>${percent}% of garden</span>
                    </div>
                </div>
            `;
        }).join('');
    }

            renderProductionStatus() {
                const container = document.getElementById('rg-production-status');
                if (!container) return;

                const ready = this.garden.filter((tree) => tree && tree.phase === 'ready').length;
                const producing = this.garden.filter((tree) => tree && tree.phase !== 'ready').length;
                const nextHarvestSeconds = this.garden
                    .filter((tree) => tree && tree.phase === 'producing')
                    .reduce((min, tree) => {
                        const value = typeof tree.secondsRemaining === 'number' ? tree.secondsRemaining : Infinity;
                        return Math.min(min, value);
                    }, Infinity);
                const nextHarvestLabel = Number.isFinite(nextHarvestSeconds)
                    ? this.formatTime(nextHarvestSeconds)
                    : 'N/A';

                const farmInventoryTotal = this.getTotalResources(this.inventory);
                const crateMetrics = this.transportMetrics?.fruit || this.getCrateLoadMetrics();
                const treeSummary = this.treeCrateSummary || this.refreshTreeCrateSummary();
                const crateLabel = crateMetrics.unlimited ? '∞' : `${crateMetrics.percent}%`;
                const crateDetail = crateMetrics.unlimited
                    ? 'Unlimited crate upgrade active'
                    : `${crateMetrics.loaded.toLocaleString()} / ${(crateMetrics.capacity || 0).toLocaleString()} fruits loaded`;
                const treeDetail = treeSummary.unlimited
                    ? 'Unlimited sapling slots'
                    : `${treeSummary.queued} queued, ${Math.max(0, treeSummary.availableSlots || 0)} open`;

                container.innerHTML = `
                    <div class="production-card">
                        <p>Ready Trees</p>
                        <strong>${ready}</strong>
                        <small>Collect whenever you want</small>
                    </div>
                    <div class="production-card">
                        <p>Producing</p>
                        <strong>${producing}</strong>
                        <small>Next harvest in ${nextHarvestLabel}</small>
                    </div>
                    <div class="production-card">
                        <p>Farm Inventory</p>
                        <strong>${farmInventoryTotal.toLocaleString()}</strong>
                        <small>Fruits staged at farm</small>
                    </div>
                    <div class="production-card">
                        <p>Crate Load</p>
                        <strong>${crateLabel}</strong>
                        <small>${crateDetail}</small>
                    </div>
                    <div class="production-card">
                        <p>Tree Crate Slots</p>
                        <strong>${treeSummary.unlimited ? '∞' : `${treeSummary.queued} staged`}</strong>
                        <small>${treeDetail}</small>
                    </div>
                `;
            }

            updateTransportPanel() {
                this.updateVehicleToggle();

                const metrics = this.transportMetrics || this.buildLocalTransportMetrics();
                const crateMetrics = metrics.fruit || { loaded: 0, capacity: 0, percent: 0, unlimited: false };
                const treeSummary = this.treeCrateSummary || this.refreshTreeCrateSummary();
                metrics.canSell = this.computeCanSellFromState();
                this.transportMetrics = metrics;

                const statusText = {
                    farm: 'At Farm',
                    traveling_to_city: 'Traveling to City',
                    city: 'At City',
                    traveling_to_farm: 'Returning to Farm'
                };
                const locationEl = document.getElementById('rg-vehicle-location');
                if (locationEl) {
                    const displayLocation = this.truckStatus
                        ? (this.truckStatus.isTraveling ? this.truckStatus.rawLocation : this.truckStatus.location)
                        : this.truckLocation;
                    locationEl.textContent = statusText[displayLocation] || 'Unknown';
                }

                const activeLabel = document.getElementById('rg-active-vehicle');
                if (activeLabel) {
                    activeLabel.textContent = this.activeVehicle === 'helicopter' ? 'Helicopter' : 'Truck';
                }

                const travelStateChip = document.getElementById('rg-travel-state-chip');
                const progressFill = document.getElementById('rg-travel-progress-fill');
                const progressLabel = document.getElementById('rg-travel-progress-label');
                let travelLabel = 'Idle';
                let progressPercent = 0;
                if (this.truckStatus && this.truckStatus.isTraveling) {
                    const secondsRemaining = Math.max(0, this.truckStatus.secondsRemaining || 0);
                    const total = Math.max(1, this.timerConfig.truckTravel || 1);
                    progressPercent = Math.min(100, Math.round(((total - secondsRemaining) / total) * 100));
                    travelLabel = `Arrives in ${this.formatTime(secondsRemaining)}`;
                    if (travelStateChip) {
                        travelStateChip.textContent = this.truckStatus.rawLocation === 'traveling_to_city'
                            ? 'Heading to city'
                            : 'Returning to farm';
                    }
                } else if (travelStateChip) {
                    travelStateChip.textContent = this.truckLocation === 'city' ? 'Waiting in city' : 'Ready at farm';
                }
                if (progressFill) {
                    progressFill.style.width = `${progressPercent}%`;
                }
                if (progressLabel) {
                    progressLabel.textContent = travelLabel;
                }
                const crateChip = document.getElementById('rg-crate-load-chip');
                if (crateChip) {
                    crateChip.textContent = crateMetrics.unlimited ? '∞' : `${crateMetrics.percent}%`;
                }
                const crateNote = document.getElementById('rg-crate-note');
                if (crateNote) {
                    crateNote.textContent = crateMetrics.unlimited
                        ? 'Unlimited crate upgrade active'
                        : `${crateMetrics.loaded.toLocaleString()} / ${(crateMetrics.capacity || 0).toLocaleString()} fruits loaded`;
                }

                const treeChip = document.getElementById('rg-tree-crate-chip');
                if (treeChip) {
                    treeChip.textContent = treeSummary.unlimited
                        ? `${treeSummary.queued.toLocaleString()} staged`
                        : `${treeSummary.queued} / ${(treeSummary.capacity || 0)}`;
                }

                this.updateTreeCrateMeta(treeSummary);
            }

            updateVehicleToggle() {
                const toggle = document.getElementById('rg-vehicle-toggle');
                if (!toggle) return;
                const unlockedHelicopter = Boolean(this.upgrades?.helicopterTransport);
                toggle.querySelectorAll('.vehicle-btn').forEach((button) => {
                    const vehicle = button.dataset.vehicle;
                    const isActive = this.activeVehicle === vehicle;
                    button.classList.toggle('is-active', isActive);
                    if (vehicle === 'helicopter') {
                        button.disabled = !unlockedHelicopter;
                        button.dataset.state = unlockedHelicopter ? 'unlocked' : 'locked';
                    } else {
                        button.disabled = false;
                        button.dataset.state = 'unlocked';
                    }
                });
            }

            handleVehicleSelect(vehicle) {
                if (!vehicle || this.activeVehicle === vehicle) {
                    return;
                }
                if (vehicle === 'helicopter' && (!this.upgrades?.helicopterTransport || !this.transport?.helicopter)) {
                    this.showGameMessage('Unlock the Helicopter Transport upgrade in the LPA shop to fly crates instantly.', 'info');
                    return;
                }
                const applied = this.applyVehicleState(vehicle);
                if (!applied) {
                    this.showGameMessage('Vehicle data is unavailable. Please refresh and try again.', 'error');
                    return;
                }
                this.activeVehicle = vehicle;
                this.updateUI();
            }

            getCrateLoadMetrics() {
                const crates = this.fruitCrates || {};
                let loaded = 0;
                let capacity = 0;
                let unlimited = false;
                Object.values(crates).forEach((crate) => {
                    const amount = Math.max(0, Number(crate?.loaded) || 0);
                    loaded += amount;
                    if (crate?.unlimited) {
                        unlimited = true;
                        return;
                    }
                    const crateCapacity = Math.max(0, Number(crate?.capacity) || 0);
                    const multiplier = Math.max(1, Number(crate?.multiplier) || 1);
                    capacity += crateCapacity * multiplier;
                });
                const percent = unlimited || capacity === 0
                    ? 0
                    : Math.min(100, Math.round((loaded / capacity) * 100));
                return { loaded, capacity, percent, unlimited };
            }

            getTreeCrateMetrics() {
                const queued = Object.values(this.treeCrate?.queued || {}).reduce((sum, value) => sum + (Number(value) || 0), 0);
                const capacity = Math.max(0, Number(this.treeCrate?.capacity) || 0);
                const unlimited = Boolean(this.treeCrate?.unlimited);
                return { queued, capacity, unlimited };
            }

            ensureShopModal() {
                if (this.modalElements) {
                    return;
                }

                const overlay = document.createElement('div');
                overlay.id = 'rg-modal-overlay';
                overlay.className = 'rg-modal-overlay';
                overlay.setAttribute('aria-hidden', 'true');
                overlay.innerHTML = `
                    <div class="rg-modal" role="dialog" aria-modal="true" aria-labelledby="rg-modal-title">
                        <div class="rg-modal-header">
                            <div>
                                <p class="modal-kicker">Shop Preview</p>
                                <h3 id="rg-modal-title" class="rg-modal-title"></h3>
                            </div>
                            <button type="button" class="rg-modal-close" aria-label="Close">×</button>
                        </div>
                        <div class="rg-modal-body"></div>
                        <div class="rg-modal-actions"></div>
                    </div>
                `;

                document.body.appendChild(overlay);

                const modal = overlay.querySelector('.rg-modal');
                const title = overlay.querySelector('.rg-modal-title');
                const body = overlay.querySelector('.rg-modal-body');
                const actions = overlay.querySelector('.rg-modal-actions');
                const closeButton = overlay.querySelector('.rg-modal-close');

                const closeHandler = (event) => {
                    if (event.target === overlay) {
                        this.closeShopModal();
                    }
                };

                overlay.addEventListener('click', closeHandler);
                if (closeButton) {
                    closeButton.addEventListener('click', () => this.closeShopModal());
                }

                this.modalElements = {
                    overlay,
                    modal,
                    title,
                    body,
                    actions
                };
            }

            openShopModal({ title = 'Shop', body = '', actions = [] } = {}) {
                this.ensureShopModal();
                const modalEls = this.modalElements;
                if (!modalEls) {
                    return;
                }

                modalEls.title.textContent = title;
                modalEls.body.innerHTML = typeof body === 'string' ? body : '';
                modalEls.actions.innerHTML = '';

                actions.forEach((action) => {
                    const button = document.createElement('button');
                    button.type = 'button';
                    button.textContent = action.label;
                    button.className = `rg-modal-btn ${action.variant || 'primary'}`;
                    button.addEventListener('click', () => {
                        if (typeof action.handler === 'function') {
                            action.handler();
                        }
                    });
                    modalEls.actions.appendChild(button);
                });

                modalEls.overlay.classList.add('is-visible');
                modalEls.overlay.setAttribute('aria-hidden', 'false');
                document.body.classList.add('rg-modal-open');
                document.addEventListener('keydown', this.handleModalKeydown);
            }

            bindTreeShopEvents() {
                if (!this.modalElements?.body) {
                    return;
                }

                if (this.boundTreeShopHandler) {
                    this.modalElements.body.removeEventListener('click', this.boundTreeShopHandler);
                }

                this.boundTreeShopHandler = (event) => {
                    const button = event.target.closest('[data-tree-purchase]');
                    if (!button) {
                        return;
                    }
                    if (button.disabled || button.getAttribute('aria-disabled') === 'true') {
                        return;
                    }
                    const treeType = button.dataset.treePurchase;
                    if (!treeType) {
                        return;
                    }
                    event.preventDefault();
                    this.closeShopModal();
                    this.buyTree(treeType);
                };

                this.modalElements.body.addEventListener('click', this.boundTreeShopHandler);
            }

            closeShopModal() {
                if (!this.modalElements) {
                    return;
                }
                const { overlay, body, actions } = this.modalElements;
                overlay.classList.remove('is-visible');
                overlay.setAttribute('aria-hidden', 'true');
                document.body.classList.remove('rg-modal-open');
                document.removeEventListener('keydown', this.handleModalKeydown);
                if (this.boundTreeShopHandler && body) {
                    body.removeEventListener('click', this.boundTreeShopHandler);
                    this.boundTreeShopHandler = null;
                }
                if (body) {
                    body.innerHTML = '';
                }
                if (actions) {
                    actions.innerHTML = '';
                }
            }

            openTreePurchaseModal() {
                const treeEntries = Object.entries(this.TREE_TYPES || {});
                if (treeEntries.length === 0) {
                    this.showGameMessage('Tree configuration missing. Please refresh.', 'error');
                    return;
                }

                const summary = this.treeCrateSummary || this.refreshTreeCrateSummary();
                const generalBlockers = this.getTreeShopBlockers(summary);
                const openSlots = this.getOpenGardenSlots();
                const vehicleLabel = this.getActiveVehicleLabel();
                const capacityLabel = summary?.unlimited
                    ? 'Unlimited tree crate active'
                    : `${Math.max(0, summary?.availableSlots ?? 0)} slot(s) open`;
                const slotLabel = `${openSlots} of ${GARDEN_SIZE} garden plots currently empty`;
                const statusClass = generalBlockers.length ? 'is-blocked' : 'is-ready';
                const statusDetail = generalBlockers.length
                    ? `<ul class="rg-shop-status-list">${generalBlockers.map((reason) => `<li>${reason}</li>`).join('')}</ul>`
                    : `<p>${vehicleLabel} is waiting in the city with room in the tree crate.</p>`;
                const locationNote = this.truckLocation === 'city'
                    ? `${vehicleLabel} is in the city — saplings load into the crate immediately and wait until you return to the farm.`
                    : `Drive the ${vehicleLabel.toLowerCase()} to the city before loading saplings into the crate.`;

                const tierCards = treeEntries
                    .sort(([, a], [, b]) => (a.level || 0) - (b.level || 0))
                    .map(([key, config]) => {
                        const plantedCount = this.garden.filter((tree) => tree && tree.type === key).length;
                        const status = this.getTreePurchaseStatus(key, summary, generalBlockers);
                        const queuedCount = status.queued;
                        const targets = status.targets || [];
                        const targetPreview = targets
                            .slice(0, 3)
                            .map((idx) => {
                                const value = Number(idx);
                                return Number.isFinite(value) ? `#${value + 1}` : null;
                            })
                            .filter(Boolean)
                            .join(', ');
                        const additionalTargets = targets.length > 3 ? ` +${targets.length - 3} more` : '';
                        let plantingDetail = 'Ready to plant';
                        if (status.canPlant) {
                            if (targets.length > 0) {
                                plantingDetail = `Upgrade ${targets.length} plot${targets.length === 1 ? '' : 's'}${targetPreview ? ` (${targetPreview}${additionalTargets})` : ''}`;
                            } else if (openSlots > 0) {
                                plantingDetail = `${openSlots} empty slot${openSlots === 1 ? '' : 's'} available`;
                            }
                        } else {
                            plantingDetail = 'Garden already full of equal or higher-tier trees.';
                        }

                        const hintState = status.canPlant ? 'ready' : 'blocked';
                        const reasonText = status.perTierBlockers[0] || status.generalBlockers[0] || '';
                        const buttonLabel = status.allowed
                            ? `Buy for ${config.cost.toLocaleString()} coins`
                            : reasonText || 'Unavailable';
                        const reasonMarkup = reasonText ? `<small class="rg-tier-reason">${reasonText}</small>` : '';

                        return `
                            <div class="rg-tier-card" data-state="${status.allowed ? 'available' : 'blocked'}" data-type="${key}">
                                <div class="rg-tier-card__header">
                                    <div>
                                        <strong>${config.name}</strong>
                                        <span class="rg-tier-level">Lvl ${config.level}</span>
                                    </div>
                                </div>
                                <p>Cost: ${config.cost.toLocaleString()} coins</p>
                                <p>Yield: ${config.fps} fruits / cycle</p>
                                <p class="rg-tier-availability">In garden: ${plantedCount}</p>
                                <p class="rg-tier-queue">Staged in crate: ${queuedCount}</p>
                                <div class="rg-tier-hint" data-state="${hintState}">
                                    <strong>${status.canPlant ? 'Planting ready' : 'Blocked'}</strong>
                                    <p>${plantingDetail}</p>
                                </div>
                                ${reasonMarkup}
                                <button
                                    type="button"
                                    class="rg-tier-buy-btn"
                                    data-tree-purchase="${key}"
                                    ${status.allowed ? '' : 'disabled aria-disabled="true"'}
                                >
                                    ${buttonLabel}
                                </button>
                            </div>
                        `;
                    })
                    .join('');

                const queuedTotal = summary?.queued ?? 0;
                const statusLabel = generalBlockers.length ? 'Cannot load trees yet' : 'Ready to load trees';

                const body = `
                    <div class="rg-modal-section">
                        <h4>Vehicle Status</h4>
                        <div class="rg-shop-status ${statusClass}">
                            <strong>${statusLabel}</strong>
                            ${statusDetail}
                        </div>
                        <ul>
                            <li>Current coins: ${this.coins.toLocaleString()}</li>
                            <li>${capacityLabel}</li>
                            <li>${slotLabel}</li>
                        </ul>
                    </div>
                    <div class="rg-modal-section">
                        <h4>Tree Availability</h4>
                        <div class="rg-tier-list">
                            ${tierCards}
                        </div>
                    </div>
                    <div class="rg-modal-section">
                        <h4>Logistics</h4>
                        <p>Total saplings queued: <strong>${queuedTotal}</strong></p>
                        <p>${locationNote}</p>
                        <p>Reminder: Trees always enter the crate first and can only be planted from the farm.</p>
                    </div>
                `;

                this.openShopModal({
                    title: 'Tree Market',
                    body,
                    actions: [
                        {
                            label: 'Close',
                            variant: 'ghost',
                            handler: () => this.closeShopModal()
                        }
                    ]
                });

                this.bindTreeShopEvents();
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
        this.renderCrateStatus();
        this.renderTreeCrate();
        this.renderPlantingAvailability();
        this.renderGardenComposition();
        this.renderProductionStatus();
        this.updateTransportPanel();
        this.toggleGardenManagementPanel();

        const loadBtn = document.getElementById('rg-load-truck-btn');
        const sendBtn = document.getElementById('rg-send-truck-btn');
        const sellBtn = document.getElementById('rg-sell-fruits-btn');
        const returnBtn = document.getElementById('rg-return-truck-btn');
        const shopBtn = document.getElementById('rg-open-tree-shop-btn');

        const isTraveling = Boolean(this.truckStatus?.isTraveling);
        const atFarm = !isTraveling && this.truckLocation === 'farm';
        const atCity = !isTraveling && this.truckLocation === 'city';
        const hasFarmFruits = this.getTotalResources(this.inventory) > 0;
        const backendSellFlag = typeof this.transportMetrics?.canSell === 'boolean'
            ? this.transportMetrics.canSell
            : null;
        const canSell = (backendSellFlag === true) || this.computeCanSellFromState();
        const canPurchaseTrees = this.canOpenTreeShop();

        if (loadBtn) loadBtn.disabled = !atFarm || !hasFarmFruits;
        if (sendBtn) sendBtn.disabled = !atFarm;
        if (sellBtn) {
            sellBtn.disabled = !canSell;
            sellBtn.classList.toggle('is-disabled', !canSell);
            sellBtn.setAttribute('aria-disabled', canSell ? 'false' : 'true');
        }
        if (returnBtn) returnBtn.disabled = !atCity;
        if (shopBtn) {
            shopBtn.disabled = false;
            shopBtn.classList.toggle('is-hint', !canPurchaseTrees);
            shopBtn.setAttribute('aria-disabled', canPurchaseTrees ? 'false' : 'true');
        }
    }

    toggleGardenManagementPanel() {
        const panel = document.getElementById('rg-garden-management');
        if (!panel) {
            return;
        }
        panel.classList.toggle('is-hidden', !this.gardenManagementEnabled);
    }

    // Helper methods
    getStateText(tree) {
        const phase = tree?.phase || tree?.state;
        switch (phase) {
            case 'producing': return 'Growing';
            case 'ready': return 'Ready to Collect';
            case 'collecting': return 'Harvesting';
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

    getActiveVehicleLabel() {
        return this.activeVehicle === 'helicopter' ? 'Helicopter' : 'Truck';
    }

    cloneResourceMap(source = {}) {
        const result = {};
        if (!source || typeof source !== 'object') {
            return result;
        }
        Object.entries(source).forEach(([key, value]) => {
            result[key] = Number(value) || 0;
        });
        return result;
    }

    cloneCrateMap(source = {}) {
        const result = {};
        if (!source || typeof source !== 'object') {
            return result;
        }
        Object.entries(source).forEach(([key, crate]) => {
            const normalized = crate || {};
            result[key] = {
                ...normalized,
                loaded: Number(normalized.loaded) || 0,
                capacity: Number(normalized.capacity) || 0,
                multiplier: Number(normalized.multiplier) || 1,
                unlimited: Boolean(normalized.unlimited)
            };
        });
        return result;
    }

    cloneTreeCrate(source = {}) {
        const data = source || {};
        return {
            capacity: Number(data.capacity) || 0,
            unlimited: Boolean(data.unlimited),
            queued: this.cloneResourceMap(data.queued)
        };
    }

    summarizeTreeCrate() {
        const queuedByType = this.cloneResourceMap(this.treeCrate?.queued || {});
        const queued = Object.values(queuedByType).reduce((sum, value) => sum + (Number(value) || 0), 0);
        const unlimited = Boolean(this.treeCrate?.unlimited);
        const capacity = unlimited ? null : Math.max(0, Number(this.treeCrate?.capacity) || 0);
        const availableSlots = unlimited ? null : Math.max(0, (capacity || 0) - queued);
        return {
            queued,
            capacity,
            availableSlots,
            unlimited,
            queuedByType,
            vehicleCapacity: { ...this.treeCrateVehicleLimits }
        };
    }

    refreshTreeCrateSummary() {
        const summary = this.summarizeTreeCrate();
        this.treeCrateSummary = summary;
        return summary;
    }

    cloneTransportMetrics(metrics) {
        if (!metrics || typeof metrics !== 'object') {
            return null;
        }
        return {
            mode: metrics.mode || this.activeVehicle,
            location: metrics.location || this.truckLocation,
            canSell: Boolean(metrics.canSell),
            fruit: {
                loaded: Math.max(0, Number(metrics.fruit?.loaded) || 0),
                capacity: typeof metrics.fruit?.capacity === 'number'
                    ? Math.max(0, metrics.fruit.capacity)
                    : null,
                percent: Math.max(0, Number(metrics.fruit?.percent) || 0),
                unlimited: Boolean(metrics.fruit?.unlimited)
            },
            tree: {
                queued: Math.max(0, Number(metrics.tree?.queued) || 0),
                capacity: typeof metrics.tree?.capacity === 'number'
                    ? Math.max(0, metrics.tree.capacity)
                    : null,
                availableSlots: typeof metrics.tree?.availableSlots === 'number'
                    ? Math.max(0, metrics.tree.availableSlots)
                    : null,
                unlimited: Boolean(metrics.tree?.unlimited)
            }
        };
    }

    buildLocalTransportMetrics() {
        const crateStats = this.getCrateLoadMetrics();
        const treeSummary = this.treeCrateSummary || this.refreshTreeCrateSummary();
        return {
            mode: this.activeVehicle,
            location: this.truckLocation,
            canSell: this.computeCanSellFromState(),
            fruit: {
                loaded: crateStats.loaded,
                capacity: crateStats.unlimited ? null : crateStats.capacity,
                percent: crateStats.unlimited ? 0 : crateStats.percent,
                unlimited: crateStats.unlimited
            },
            tree: {
                queued: treeSummary.queued,
                capacity: treeSummary.unlimited ? null : treeSummary.capacity,
                availableSlots: treeSummary.unlimited ? null : treeSummary.availableSlots,
                unlimited: treeSummary.unlimited
            }
        };
    }

    computeCanSellFromState() {
        if (this.truckStatus?.isTraveling) {
            return false;
        }
        if (this.truckLocation !== 'city') {
            return false;
        }
        return Object.entries(this.truckInventory || {}).some(([type, amountRaw]) => {
            const amount = Number(amountRaw) || 0;
            if (amount <= 0) {
                return false;
            }
            const fruitsPerCoin = this.TREE_TYPES[type]?.fruitsPerCoin || 0;
            return fruitsPerCoin > 0 && amount >= fruitsPerCoin;
        });
    }

    buildEmptyVehicleState(mode = 'truck') {
        return {
            mode,
            label: mode === 'helicopter' ? 'Helicopter' : 'Truck',
            location: 'farm',
            isTraveling: false,
            secondsRemaining: 0,
            travelSeconds: this.timerConfig.truckTravel,
            departureTime: null,
            destination: null,
            fruitCrates: {},
            treeCrate: { capacity: 0, queued: {}, unlimited: false },
            cargo: {}
        };
    }

    normalizeVehiclePayload(raw, mode = 'truck') {
        if (!raw || typeof raw !== 'object') {
            return this.buildEmptyVehicleState(mode);
        }
        const location = raw.location || 'farm';
        return {
            mode: raw.mode || mode,
            label: raw.label || (mode === 'helicopter' ? 'Helicopter' : 'Truck'),
            location,
            isTraveling: Boolean(raw.isTraveling),
            secondsRemaining: typeof raw.secondsRemaining === 'number'
                ? Math.max(0, Math.ceil(raw.secondsRemaining))
                : 0,
            travelSeconds: Number(raw.travelSeconds) > 0 ? Number(raw.travelSeconds) : this.timerConfig.truckTravel,
            departureTime: raw.departureTime ? new Date(raw.departureTime) : null,
            destination: raw.destination || null,
            fruitCrates: this.cloneCrateMap(raw.fruitCrates),
            treeCrate: this.cloneTreeCrate(raw.treeCrate),
            cargo: this.cloneResourceMap(raw.cargo)
        };
    }

    prepareTransportState(rawTransport) {
        const prepared = {
            activeMode: 'truck',
            truck: this.buildEmptyVehicleState('truck'),
            helicopter: null
        };
        if (!rawTransport || typeof rawTransport !== 'object') {
            return prepared;
        }
        if (rawTransport.truck) {
            prepared.truck = this.normalizeVehiclePayload(rawTransport.truck, 'truck');
        }
        if (rawTransport.helicopter) {
            prepared.helicopter = this.normalizeVehiclePayload(rawTransport.helicopter, 'helicopter');
        }
        if (rawTransport.activeMode === 'helicopter' && prepared.helicopter) {
            prepared.activeMode = 'helicopter';
        }
        return prepared;
    }

    applyVehicleState(vehicle, options = {}) {
        if (!this.transport) {
            return false;
        }
        const vehicleState = this.transport[vehicle];
        if (!vehicleState) {
            return false;
        }
        const location = vehicleState.location || 'farm';
        const secondsRemaining = typeof vehicleState.secondsRemaining === 'number'
            ? Math.max(0, Math.ceil(vehicleState.secondsRemaining))
            : 0;
        this.truckStatus = {
            location,
            rawLocation: location,
            isTraveling: Boolean(vehicleState.isTraveling),
            secondsRemaining,
            departureTime: vehicleState.departureTime ? new Date(vehicleState.departureTime) : null
        };
        this.truckLocation = location;
        this.truckInventory = this.cloneResourceMap(vehicleState.cargo);
        this.fruitCrates = this.cloneCrateMap(vehicleState.fruitCrates);
        this.treeCrate = this.cloneTreeCrate(vehicleState.treeCrate);
        if (Number.isFinite(vehicleState.travelSeconds) && vehicleState.travelSeconds > 0) {
            this.timerConfig.truckTravel = vehicleState.travelSeconds;
        }
        this.transport.activeMode = vehicle;
        this.refreshTreeCrateSummary();
        if (!options.preserveMetrics) {
            this.transportMetrics = this.buildLocalTransportMetrics();
        }
        return true;
    }

    applyActiveVehicleState() {
        return this.applyVehicleState(this.activeVehicle);
    }

    resolvePreferredVehicleMode() {
        const unlockedHelicopter = Boolean(this.upgrades?.helicopterTransport);
        const previousSelection = this.activeVehicle;
        if (previousSelection === 'helicopter' && unlockedHelicopter && this.transport?.helicopter) {
            return 'helicopter';
        }
        if (previousSelection === 'truck') {
            return 'truck';
        }
        if (this.transport?.activeMode === 'helicopter' && unlockedHelicopter && this.transport?.helicopter) {
            return 'helicopter';
        }
        return 'truck';
    }

    getCurrentGardenLevel() {
        if (!this.garden.some(tree => tree)) return 1;

        const minLevel = Math.min(...this.garden.filter(tree => tree).map(tree => this.TREE_TYPES[tree.type].level));
        return minLevel;
    }

    getPlantableTypesForCell(cellIndex) {
        const summary = this.plantingSummary || {};
        const crate = (this.treeCrate && this.treeCrate.queued) || {};
        const plantable = [];

        Object.entries(summary).forEach(([type, info]) => {
            const queued = Number(crate[type]) || 0;
            if (queued <= 0) {
                return;
            }
            const targets = Array.isArray(info?.targets) ? info.targets : [];
            if (!targets.includes(cellIndex)) {
                return;
            }
            plantable.push(type);
        });

        plantable.sort((a, b) => {
            const levelA = this.TREE_TYPES[a]?.level || 0;
            const levelB = this.TREE_TYPES[b]?.level || 0;
            return levelA - levelB;
        });

        return plantable;
    }

            getTreeShopBlockers(summaryOverride = null) {
                const summary = summaryOverride || this.treeCrateSummary || this.refreshTreeCrateSummary();
                const blockers = [];
                const vehicleLabel = this.getActiveVehicleLabel();

                if (this.truckStatus?.isTraveling) {
                    blockers.push(`${vehicleLabel} is traveling. Wait until it reaches the city.`);
                }
                if (!this.truckStatus?.isTraveling && this.truckLocation !== 'city') {
                    blockers.push(`${vehicleLabel} must be at the city to buy new trees.`);
                }

                const hasCapacity = summary?.unlimited
                    || (Number(summary?.availableSlots) || 0) > 0;
                if (!hasCapacity) {
                    blockers.push('Tree crate is full. Deliver or plant staged saplings first.');
                }

                return blockers;
            }

            getTreePurchaseStatus(treeType = 'banana', summaryOverride = null, generalOverride = null) {
                const summary = summaryOverride || this.treeCrateSummary || this.refreshTreeCrateSummary();
                const generalBlockers = Array.isArray(generalOverride)
                    ? [...generalOverride]
                    : this.getTreeShopBlockers(summary);
                const config = this.TREE_TYPES?.[treeType] || null;
                const perTierBlockers = [];
                const plantingInfo = this.plantingSummary?.[treeType] || null;
                let canPlant = Boolean(plantingInfo?.canPlant);
                if (!plantingInfo) {
                    canPlant = this.getOpenGardenSlots() > 0;
                }
                const plantingTargets = Array.isArray(plantingInfo?.targets) ? plantingInfo.targets : [];
                const queuedMap = Object.keys(this.totalQueuedByType || {}).length > 0
                    ? this.totalQueuedByType
                    : summary?.globalQueuedByType || summary?.queuedByType || {};
                const queuedCount = Number(queuedMap?.[treeType]) || 0;

                let remainingSlots = plantingTargets.length;
                if (queuedCount > 0) {
                    remainingSlots = Math.max(0, remainingSlots - queuedCount);
                }

                if (!config) {
                    perTierBlockers.push('Tree type unavailable right now.');
                } else {
                    if (this.coins < config.cost) {
                        perTierBlockers.push('Not enough coins for this tree.');
                    }
                    if (!canPlant) {
                        perTierBlockers.push('Garden already full of equal or higher-tier trees.');
                    } else if (remainingSlots <= 0) {
                        canPlant = false;
                        perTierBlockers.push('All matching slots are already reserved by staged saplings. Deliver or plant them first.');
                    }
                }

                return {
                    summary,
                    config,
                    plantingInfo,
                    canPlant,
                    targets: Array.isArray(plantingInfo?.targets) ? plantingInfo.targets : [],
                    queued: queuedCount,
                    generalBlockers,
                    perTierBlockers,
                    allowed: generalBlockers.length === 0 && perTierBlockers.length === 0
                };
            }

            canBuyTree(treeType = 'banana') {
                const status = this.getTreePurchaseStatus(treeType);
                return Boolean(status?.allowed);
            }

    getOpenGardenSlots() {
        return this.garden.filter((tree) => !tree).length;
    }

    hasTreeCrateCapacity() {
        if (!this.treeCrateSummary) {
            this.refreshTreeCrateSummary();
        }
        if (!this.treeCrateSummary) {
            return false;
        }
        return this.treeCrateSummary.unlimited
            || (Number(this.treeCrateSummary.availableSlots) || 0) > 0;
    }

            canOpenTreeShop() {
                const summary = this.treeCrateSummary || this.refreshTreeCrateSummary();
                return this.getTreeShopBlockers(summary).length === 0;
            }

    // Game actions
    async buyTree(treeType = 'banana') {
        const status = this.getTreePurchaseStatus(treeType);
        if (!status.allowed) {
            const reason = status.perTierBlockers?.[0]
                || status.generalBlockers?.[0]
                || 'Tree purchases are unavailable right now.';
            this.showGameMessage(reason, 'info');
            return;
        }

        try {
            const username = window.authManager?.currentUser?.username;
            if (!username) return;

            const response = await fetch('/api/rich-garden/buy_tree', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, queueOnly: true, vehicle: this.activeVehicle, treeType })
            });

            const data = await response.json();
            if (data.success) {
                this.syncStateFromPayload(data);
                this.updateUI();
                const treeName = this.TREE_TYPES?.[treeType]?.name || 'Tree';
                this.showGameMessage(`${treeName} purchased and staged in the crate! Plant it from the farm when ready.`, 'success');
                this.showGameMessage('Trees never auto-plant—use Plant from Crate once you are back at the farm.', 'info');
                setTimeout(() => this.refreshGameStatus(), 1000);
            } else {
                this.showGameMessage(data.error || 'Failed to buy tree', 'error');
            }
        } catch (error) {
            console.error('Buy tree error:', error);
            this.showGameMessage('Failed to buy tree', 'error');
        }
    }

    async plantTreeFromCrate(cellIndex, treeType) {
        if (!Number.isInteger(cellIndex) || cellIndex < 0 || cellIndex >= GARDEN_SIZE) {
            this.showGameMessage('Invalid plot selected for planting', 'error');
            return false;
        }

        const plantableTypes = this.getPlantableTypesForCell(cellIndex);
        if (plantableTypes.length === 0) {
            this.showGameMessage('No staged saplings are ready for this plot yet.', 'info');
            return false;
        }

        const nextType = plantableTypes[0];
        if (treeType !== nextType) {
            treeType = nextType;
        }

        if (!plantableTypes.includes(treeType)) {
            this.showGameMessage('No matching tree staged for this plot', 'error');
            return false;
        }

        try {
            const username = window.authManager?.currentUser?.username;
            if (!username) return;

            const response = await fetch('/api/rich-garden/plant_from_crate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, cellIndex, treeType, vehicle: this.activeVehicle })
            });

            const data = await response.json();
            if (data.success) {
                this.syncStateFromPayload(data);
                this.updateUI();
                this.showGameMessage('Tree planted from crate!', 'success');
                setTimeout(() => this.refreshGameStatus(), 1000);
                return true;
            } else {
                this.showGameMessage(data.error || 'Unable to plant tree', 'error');
                return false;
            }
        } catch (error) {
            console.error('Plant from crate error:', error);
            this.showGameMessage('Unable to plant tree', 'error');
            return false;
        }
    }

    async collectReadyTrees(cellIndices = null) {
        try {
            const username = window.authManager?.currentUser?.username;
            if (!username) return false;

            const payload = { username };
            if (Array.isArray(cellIndices) && cellIndices.length > 0) {
                payload.cells = cellIndices;
            }

            const response = await fetch('/api/rich-garden/collect_ready', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const data = await response.json();
            if (data.success) {
                this.syncStateFromPayload(data);
                this.updateUI();

                const collectedTotal = this.getTotalResources(data.collected || {});
                if (collectedTotal > 0) {
                    this.showGameMessage(`Collected ${collectedTotal.toLocaleString()} fruits from the garden.`, 'success');
                } else {
                    this.showGameMessage('Garden synchronized with the latest harvest state.', 'info');
                }

                setTimeout(() => this.refreshGameStatus(), 1000);
                return true;
            }

            this.showGameMessage(data.error || 'Failed to collect trees', 'error');
            return false;
        } catch (error) {
            console.error('Collect ready trees error:', error);
            this.showGameMessage('Failed to collect trees', 'error');
            return false;
        }
    }

    async collectAllReady() {
        const readyCells = this.garden
            .map((tree, index) => (tree && tree.phase === 'ready' ? index : null))
            .filter((index) => index !== null);

        if (readyCells.length === 0) {
            this.showGameMessage('No trees are ready to collect yet.', 'info');
            return;
        }

        await this.collectReadyTrees(readyCells);
    }

    async collectTree(cellIndex) {
        if (!Number.isInteger(cellIndex) || cellIndex < 0 || cellIndex >= GARDEN_SIZE) {
            this.showGameMessage('Invalid plot selected for collection', 'error');
            return;
        }
        const tree = this.garden[cellIndex];
        if (!tree || tree.phase !== 'ready') {
            this.showGameMessage('This tree is not ready to harvest yet.', 'info');
            return;
        }
        await this.collectReadyTrees([cellIndex]);
    }

    async loadTruck() {
        const vehicleLabel = this.getActiveVehicleLabel();
        if (this.truckStatus?.isTraveling) {
            this.showGameMessage(`${vehicleLabel} is traveling and cannot be loaded.`, 'error');
            return;
        }
        if (this.truckLocation !== 'farm') {
            this.showGameMessage(`${vehicleLabel} must be at the farm to load crates.`, 'error');
            return;
        }

        try {
            const username = window.authManager?.currentUser?.username;
            if (!username) return;

            const response = await fetch('/api/rich-garden/load_truck', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, vehicle: this.activeVehicle })
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
                    this.showGameMessage(`Loaded ${loadedTotal.toLocaleString()} fruits onto the ${vehicleLabel.toLowerCase()}${detail}.`, 'success');
                } else {
                    this.showGameMessage(`${vehicleLabel} loaded.`, 'success');
                }

                if (data.collected) {
                    const collectedTotal = this.getTotalResources(data.collected);
                    if (collectedTotal > 0) {
                        this.showGameMessage(`Auto-collected ${collectedTotal.toLocaleString()} fruits while loading.`, 'info');
                    }
                }

                setTimeout(() => this.refreshGameStatus(), 1000);
            } else {
                this.showGameMessage(data.error || 'Failed to load vehicle', 'error');
            }
        } catch (error) {
            console.error('Load vehicle error:', error);
            this.showGameMessage('Failed to load vehicle', 'error');
        }
    }

    async sendTruckToCity() {
        const vehicleLabel = this.getActiveVehicleLabel();
        if (this.truckStatus?.isTraveling) {
            this.showGameMessage(`${vehicleLabel} is already traveling!`, 'error');
            return;
        }

        if (this.truckLocation !== 'farm') {
            this.showGameMessage(`${vehicleLabel} is not at the farm!`, 'error');
            return;
        }

        try {
            const username = window.authManager?.currentUser?.username;
            if (!username) return;

            const response = await fetch('/api/rich-garden/send_truck', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, vehicle: this.activeVehicle })
            });

            const data = await response.json();
            if (data.success) {
                this.syncStateFromPayload(data);
                this.updateUI();
                this.showGameMessage(`${vehicleLabel} sent to the city!`, 'info');
                setTimeout(() => this.refreshGameStatus(), 1000);
            } else {
                this.showGameMessage(data.error || 'Failed to send vehicle', 'error');
            }
        } catch (error) {
            console.error('Send vehicle error:', error);
            this.showGameMessage('Failed to send vehicle', 'error');
        }
    }

    async sellFruits() {
        const vehicleLabel = this.getActiveVehicleLabel();
        if (this.truckStatus?.isTraveling) {
            this.showGameMessage(`${vehicleLabel} is traveling and cannot sell right now!`, 'error');
            return;
        }

        if (this.truckLocation !== 'city') {
            this.showGameMessage(`${vehicleLabel} must be at the city to sell fruits!`, 'error');
            return;
        }

        const backendSellFlag = typeof this.transportMetrics?.canSell === 'boolean'
            ? this.transportMetrics.canSell
            : null;
        const canSell = (backendSellFlag === true) || this.computeCanSellFromState();
        if (!canSell) {
            this.showGameMessage('No sellable crates loaded on the vehicle yet!', 'error');
            return;
        }

        try {
            const username = window.authManager?.currentUser?.username;
            if (!username) return;

            const response = await fetch('/api/rich-garden/sell_fruits', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, vehicle: this.activeVehicle })
            });

            const data = await response.json();
            if (data.success) {
                this.syncStateFromPayload(data);
                this.updateUI();
                const soldTotal = this.getTotalResources(data.sold || {});
                this.showGameMessage(`Sold ${soldTotal.toLocaleString()} fruits for ${data.earned} coins using the ${vehicleLabel.toLowerCase()}!`, 'success');
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
        const vehicleLabel = this.getActiveVehicleLabel();
        if (this.truckStatus?.isTraveling) {
            this.showGameMessage(`${vehicleLabel} is already en route!`, 'error');
            return;
        }

        if (this.truckLocation !== 'city') {
            this.showGameMessage(`${vehicleLabel} must be at the city to start the return trip!`, 'error');
            return;
        }

        try {
            const username = window.authManager?.currentUser?.username;
            if (!username) return;

            const response = await fetch('/api/rich-garden/return_truck', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, vehicle: this.activeVehicle })
            });

            const data = await response.json();
            if (data.success) {
                this.syncStateFromPayload(data);
                this.updateUI();
                this.showGameMessage(`${vehicleLabel} returning to the farm!`, 'info');
                setTimeout(() => this.refreshGameStatus(), 1000);
            } else {
                this.showGameMessage(data.error || 'Failed to return vehicle', 'error');
            }
        } catch (error) {
            console.error('Return vehicle error:', error);
            this.showGameMessage('Failed to return vehicle', 'error');
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