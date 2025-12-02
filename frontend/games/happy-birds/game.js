export default class HappyBirdsGame {
    constructor() {
        this.isRunning = false;
        this.gameContainer = null;
        this.coins = 0;
        this.birds = {};
        this.eggs = {};
        this.produced = {};
        this.productionStart = null;
        this.lastSaveTime = null;
        this.gameManager = null;
        this.gameLoopInterval = null;
        this.statusRefreshInterval = null;
        this.messageTimeout = null;
        this.consoleMessages = true;
        this.SIX_HOURS_SEC = 6 * 60 * 60; // Will be updated by loadConfig
        this.ONE_HOUR_SEC = 60 * 60; // Will be updated by loadConfig
        this.config = {}; // Will be loaded from server
        
        // Truck system
        this.truckLocation = 'farm';
        this.truckDepartureTime = null;
        this.truckInventory = {};
        // Production always active
        
        this.BIRDS = {
            red: { cost: 1000, eps: 1, eggsPerCoin: 100, label: "Red" },
            orange: { cost: 2500, eps: 2, eggsPerCoin: 80, label: "Orange" },
            yellow: { cost: 10000, eps: 5, eggsPerCoin: 50, label: "Yellow" },
            green: { cost: 25000, eps: 10, eggsPerCoin: 40, label: "Green" },
            blue: { cost: 100000, eps: 20, eggsPerCoin: 20, label: "Blue" },
            purple: { cost: 500000, eps: 50, eggsPerCoin: 10, label: "Purple" },
        };
    }

    // Set game manager
    setGameManager(gameManager) {
        this.gameManager = gameManager;
        if (this.consoleMessages) console.log('🎮 Game Manager set for Happy Birds');
    }

    // Load config from server
    async loadConfig() {
        try {
            const response = await fetch('/api/config');
            if (response.ok) {
                this.config = await response.json();
                if (this.consoleMessages) console.log('⚙️ Config loaded:', this.config);
                
                // Set timer constants based on fast mode
                if (this.config.fastMode) {
                    this.SIX_HOURS_SEC = 30; // 30 seconds for testing
                    this.ONE_HOUR_SEC = 10; // 10 seconds for testing
                } else {
                    this.SIX_HOURS_SEC = 6 * 60 * 60; // 6 hours normal
                    this.ONE_HOUR_SEC = 60 * 60; // 1 hour normal
                }
            } else {
                // Default config if endpoint fails
                this.config = { enableRedeem: true, showRestartButton: true, consoleMessages: true, fastMode: false };
                this.SIX_HOURS_SEC = 6 * 60 * 60; // Default to normal
                this.ONE_HOUR_SEC = 60 * 60; // Default to normal
                if (this.consoleMessages) console.log('⚠️ Failed to load config, using defaults');
            }
        } catch (error) {
            // Default config if fetch fails
            this.config = { enableRedeem: true, showRestartButton: true, consoleMessages: true, fastMode: false };
            this.SIX_HOURS_SEC = 6 * 60 * 60; // Default to normal
            this.ONE_HOUR_SEC = 60 * 60; // Default to normal
            if (this.consoleMessages) console.log('⚠️ Error loading config:', error);
        }
    }

    // Start game
    async start() {
        if (this.consoleMessages) console.log('🐦 Starting Happy Birds...');
        this.isRunning = true;

        await this.loadConfig();
        await this.loadGameTemplate();
        await this.loadGameData();
        this.initGame();
        this.bindGameEvents();
        this.startGameLoop();
        this.startStatusRefresh();

        this.showGameMessage('Happy Birds loaded successfully!', 'success');
        if (this.consoleMessages) console.log('✅ Happy Birds started successfully');
    }

    // Stop game
    stop() {
        if (this.consoleMessages) console.log('🐦 Stopping Happy Birds...');
        this.isRunning = false;
        if (this.gameLoopInterval) {
            clearInterval(this.gameLoopInterval);
        }
        if (this.statusRefreshInterval) {
            clearInterval(this.statusRefreshInterval);
        }
        this.cleanup();
        if (this.consoleMessages) console.log('✅ Happy Birds stopped');
    }

    // Load game data from server
    async loadGameData() {
        try {
            const username = window.authManager?.currentUser?.username;
            if (!username) {
                throw new Error('User not logged in');
            }

            const response = await fetch(`/api/game/status/${username}`);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            const data = await response.json();

            if (data.success) {
                this.coins = data.coins || 0;
                this.birds = data.birds || {};
                this.eggs = data.eggs || {};
                this.savedProduced = data.savedProduced || {};
                this.lastSaveTime = data.lastSaveTime ? new Date(data.lastSaveTime) : null;
                this.productionStart = data.productionStart ? new Date(data.productionStart) : null;

                // Calculate current produced
                this.updateProduced();

                // Check for offline earnings
                const totalProduced = Object.values(this.produced).reduce((sum, eggs) => sum + eggs, 0);
                if (totalProduced > 0) {
                    this.showGameMessage(`Welcome back! You earned ${Math.floor(totalProduced)} eggs while away!`, 'success');
                }

                this.updateUI();
                if (this.consoleMessages) console.log('✅ Game data loaded successfully');
            } else {
                throw new Error(data.error || 'Failed to load game data');
            }
        } catch (error) {
            console.error('Failed to load game data:', error);
            this.showGameMessage('Failed to load game data', 'error');
            throw error; // Re-throw to stop the game start
        }
    }

    // Update produced calculation
    updateProduced() {
        if (!this.productionStart) {
            this.produced = {};
            return;
        }

        const referenceTime = this.lastSaveTime || this.productionStart;
        const nowSec = Math.floor(Date.now() / 1000);
        const refSec = Math.floor(referenceTime.getTime() / 1000);
        let seconds = nowSec - refSec;
        if (seconds <= 0) {
            this.produced = { ...this.savedProduced };
            return;
        }
        if (seconds > this.SIX_HOURS_SEC) seconds = this.SIX_HOURS_SEC;

        this.produced = { ...this.savedProduced };
        for (const color of Object.keys(this.BIRDS)) {
            const count = this.birds[color] || 0;
            if (count > 0) {
                this.produced[color] = (this.produced[color] || 0) + Math.floor(count * this.BIRDS[color].eps * seconds);
            }
        }
    }

    // Refresh game status from server
    async refreshGameStatus() {
        try {
            const username = window.authManager?.currentUser?.username;
            if (!username) return;

            const response = await fetch(`/api/game/status/${username}`);
            if (!response.ok) return;

            const data = await response.json();
            if (data.success) {
                this.coins = data.coins || 0;
                this.birds = data.birds || {};
                this.eggs = data.eggs || {};
                this.savedProduced = data.savedProduced || {};
                this.lastSaveTime = data.lastSaveTime ? new Date(data.lastSaveTime) : null;
                this.productionStart = data.productionStart ? new Date(data.productionStart) : null;
                
                // Truck system data
                this.truckLocation = data.truckLocation || 'farm';
                this.truckDepartureTime = data.truckDepartureTime ? new Date(data.truckDepartureTime) : null;
                this.truckInventory = data.truckInventory || {};
                // Production always active

                // Calculate current produced
                this.updateProduced();
                this.updateUI();
                if (this.consoleMessages) console.log('🔄 Game status refreshed');
            }
        } catch (error) {
            console.error('Failed to refresh game status:', error);
        }
    }

    // Collect eggs
    async collectEggs() {
        if (this.consoleMessages) console.log('🥚 Collect button clicked');

        // Frontend check to prevent unnecessary requests
        const timeSinceLast = (Date.now() - (this.lastSaveTime?.getTime() || 0)) / 1000;
        if (timeSinceLast < this.SIX_HOURS_SEC) {
            const remaining = this.SIX_HOURS_SEC - timeSinceLast;
            const hoursLeft = Math.floor(remaining / 3600);
            const minsLeft = Math.floor((remaining % 3600) / 60);
            const secsLeft = Math.floor(remaining % 60);
            this.showGameMessage(`Collection not ready! ${hoursLeft}h ${minsLeft}m ${secsLeft}s left.`, 'info');
            return;
        }

        try {
            const username = window.authManager?.currentUser?.username;
            if (!username) {
                this.showGameMessage('Please log in to collect eggs', 'error');
                return;
            }

            console.log(`📡 Sending collect request`);

            const response = await fetch('/api/game/collect', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username })
            });

            const data = await response.json();
            console.log('📡 Collect response:', data);

            if (data.success) {
                // The backend is the source of truth. Update frontend state from response.
                this.eggs = data.eggs;
                this.savedProduced = data.collected; // The backend sends what was collected
                this.lastSaveTime = new Date(); // Sync with backend's reset

                this.updateUI();
                this.animateCollection();

                const totalCollected = Object.values(data.collected).reduce((sum, amount) => sum + amount, 0);
                
                if (totalCollected > 0) {
                    this.showGameMessage(`Eggs collected! Got ${totalCollected} eggs.`, 'success');
                } else {
                    this.showGameMessage(`No new eggs to collect.`, 'info');
                }
                
                // Refresh status to ensure full sync
                setTimeout(() => this.refreshGameStatus(), 500);
            } else {
                this.showGameMessage(data.error || 'Failed to collect eggs', 'error');
            }
        } catch (error) {
            console.error('Collect error:', error);
            this.showGameMessage('Failed to collect eggs', 'error');
        }
    }

    // Animate collection
    animateCollection() {
        const collectBtn = document.getElementById('hb-collect-btn');
        if (collectBtn) {
            collectBtn.style.transform = 'scale(1.1)';
            collectBtn.style.background = '#28a745';
            setTimeout(() => {
                collectBtn.style.transform = 'scale(1)';
                collectBtn.style.background = '';
            }, 300);
        }

        // Also animate the game area briefly
        const gameArea = document.getElementById('game-area');
        if (gameArea) {
            gameArea.style.transform = 'scale(1.01)';
            setTimeout(() => {
                gameArea.style.transform = 'scale(1)';
            }, 150);
        }
    }

    // Buy bird
    async buyBird(color) {
        // Allow buying first bird at farm, otherwise require truck at city
        const totalBirds = Object.values(this.birds).reduce((sum, count) => sum + count, 0);
        if (totalBirds > 0 && this.truckLocation !== 'city') {
            this.showGameMessage('Truck must be at city to buy birds!', 'error');
            return;
        }

        this.showGameMessage(`Attempting to buy ${this.BIRDS[color]?.label} bird...`, 'info');

        if (!this.BIRDS[color]) {
            this.showGameMessage('Invalid bird type!', 'error');
            return;
        }

        if (this.coins < this.BIRDS[color].cost) {
            this.showGameMessage(`Not enough coins! Need ${this.BIRDS[color].cost}, have ${this.coins}`, 'error');
            return;
        }

        try {
            const username = window.authManager?.currentUser?.username;
            if (!username) {
                this.showGameMessage('Please log in to buy birds', 'error');
                return;
            }

            const response = await fetch('/api/game/buy', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, color })
            });

            const data = await response.json();

            if (data.success) {
                this.coins = data.coins;
                this.birds = data.birds;
                if (data.productionStart) this.productionStart = new Date(data.productionStart);
                this.lastSaveTime = data.lastSaveTime ? new Date(data.lastSaveTime) : null;
                if (data.savedProduced) this.savedProduced = data.savedProduced;
                this.updateUI();
                this.showGameMessage(`${this.BIRDS[color].label} bird purchased!`, 'success');
                // Refresh status to ensure sync
                setTimeout(() => this.refreshGameStatus(), 1000);
            } else {
                this.showGameMessage(data.error || 'Failed to buy bird', 'error');
            }
        } catch (error) {
            console.error('Buy error:', error);
            this.showGameMessage('Failed to buy bird', 'error');
        }
    }

    // Sell eggs
    async sellEggs(color, amount) {
        try {
            const username = window.authManager?.currentUser?.username;
            if (!username) return;

            const response = await fetch('/api/game/sell', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, color, amount })
            });

            const data = await response.json();
            if (data.success) {
                this.coins = data.coins;
                this.eggs = data.eggs;
                this.updateUI();
                this.showGameMessage(`Sold ${amount} ${color} eggs!`, 'success');
                // Refresh status to ensure sync
                setTimeout(() => this.refreshGameStatus(), 1000);
            } else {
                this.showGameMessage(data.error || 'Failed to sell eggs', 'error');
            }
        } catch (error) {
            console.error('Sell error:', error);
            this.showGameMessage('Failed to sell eggs', 'error');
        }
    }

    // Sell all eggs
    async loadTruck() {
        const totalEggs = Object.values(this.eggs).reduce((sum, amount) => sum + amount, 0);
        if (totalEggs === 0) {
            this.showGameMessage('No eggs to load into truck!', 'info');
            return;
        }

        try {
            const username = window.authManager?.currentUser?.username;
            if (!username) return;

            for (const color in this.eggs) {
                const amount = this.eggs[color] || 0;
                if (amount > 0) {
                    const response = await fetch('/api/game/load_truck', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ username, color, amount })
                    });

                    const data = await response.json();
                    if (data.success) {
                        this.eggs[color] = 0;
                        this.truckInventory = data.truckInventory;
                    } else {
                        this.showGameMessage(data.error || 'Failed to load eggs into truck', 'error');
                        return;
                    }
                }
            }

            this.updateUI();
            this.showGameMessage(`Loaded all eggs into truck!`, 'success');
            // Refresh status to ensure sync
            setTimeout(() => this.refreshGameStatus(), 1000);
        } catch (error) {
            console.error('Load truck error:', error);
            this.showGameMessage('Failed to load eggs into truck', 'error');
        }
    }

    // Load specific color eggs into truck
    async loadTruckEggs(color, amount) {
        try {
            const username = window.authManager?.currentUser?.username;
            if (!username) return;

            const response = await fetch('/api/game/load_truck', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, color, amount })
            });

            const data = await response.json();
            if (data.success) {
                this.eggs[color] -= amount;
                this.truckInventory = data.truckInventory;
                this.updateUI();
                this.showGameMessage(`Loaded ${amount} ${color} eggs into truck!`, 'success');
                // Refresh status to ensure sync
                setTimeout(() => this.refreshGameStatus(), 1000);
            } else {
                this.showGameMessage(data.error || 'Failed to load eggs into truck', 'error');
            }
        } catch (error) {
            console.error('Load truck eggs error:', error);
            this.showGameMessage('Failed to load eggs into truck', 'error');
        }
    }

    // Truck actions
    async truckGoToCity() {
        if (this.truckLocation !== 'farm') {
            this.showGameMessage('Truck is not at farm!', 'error');
            return;
        }

        try {
            const username = window.authManager?.currentUser?.username;
            if (!username) return;

            const response = await fetch('/api/game/truck_go_to_city', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username })
            });

            const data = await response.json();
            if (data.success) {
                this.truckLocation = data.truckLocation;
                this.truckDepartureTime = new Date(data.truckDepartureTime);
                // Production continues during travel
                this.updateUI();
                this.showGameMessage('Truck departed to city!', 'info');
                // Refresh status to ensure sync
                setTimeout(() => this.refreshGameStatus(), 1000);
            } else {
                this.showGameMessage(data.error || 'Failed to send truck to city', 'error');
            }
        } catch (error) {
            console.error('Truck go to city error:', error);
            this.showGameMessage('Failed to send truck to city', 'error');
        }
    }

    async sellTruckEggs() {
        if (this.truckLocation !== 'city') {
            this.showGameMessage('Truck must be at city to sell eggs!', 'error');
            return;
        }

        const totalTruckEggs = Object.values(this.truckInventory).reduce((sum, amount) => sum + amount, 0);
        if (totalTruckEggs === 0) {
            this.showGameMessage('No eggs in truck to sell!', 'error');
            return;
        }

        try {
            const username = window.authManager?.currentUser?.username;
            if (!username) return;

            const response = await fetch('/api/game/sell_truck_eggs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username })
            });

            const data = await response.json();
            if (data.success) {
                this.coins = data.coins;
                this.truckInventory = data.truckInventory;
                this.updateUI();
                this.showGameMessage(`Sold truck eggs for ${data.soldFor} coins!`, 'success');
                // Refresh status to ensure sync
                setTimeout(() => this.refreshGameStatus(), 1000);
            } else {
                this.showGameMessage(data.error || 'Failed to sell truck eggs', 'error');
            }
        } catch (error) {
            console.error('Sell truck eggs error:', error);
            this.showGameMessage('Failed to sell truck eggs', 'error');
        }
    }

    async truckGoToFarm() {
        if (this.truckLocation !== 'city') {
            this.showGameMessage('Truck must be at city to return!', 'error');
            return;
        }

        try {
            const username = window.authManager?.currentUser?.username;
            if (!username) return;

            const response = await fetch('/api/game/truck_go_to_farm', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username })
            });

            const data = await response.json();
            if (data.success) {
                this.truckLocation = data.truckLocation;
                this.truckDepartureTime = new Date(data.truckDepartureTime);
                this.updateUI();
                this.showGameMessage('Truck returning to farm!', 'info');
                // Refresh status to ensure sync
                setTimeout(() => this.refreshGameStatus(), 1000);
            } else {
                this.showGameMessage(data.error || 'Failed to send truck back to farm', 'error');
            }
        } catch (error) {
            console.error('Truck go to farm error:', error);
            this.showGameMessage('Failed to send truck back to farm', 'error');
        }
    }

    // Game loop for idle production
    startGameLoop() {
        this.gameLoopInterval = setInterval(() => {
            if (!this.isRunning) return;

            if (!this.productionStart) return;

            // Update produced eggs display
            this.updateProduced();
            this.updateUI();
        }, 1000); // Update every 1 second
    }

    // Start status refresh interval
    startStatusRefresh() {
        this.statusRefreshInterval = setInterval(() => {
            if (!this.isRunning) return;
            this.refreshGameStatus();
        }, 10000); // Refresh every 10 seconds
    }

    // Load HTML template
    async loadGameTemplate() {
        const gameArea = document.getElementById('game-area');
        if (!gameArea) {
            throw new Error('Game area not found');
        }

        gameArea.innerHTML = `
            <link rel="stylesheet" href="games/happy-birds/style.css">
            <div class="happy-birds-game">
                <div class="game-header">
                    <h2>🐦 Happy Birds</h2>
                    <button id="hb-back-btn" class="back-button">← Menu</button>
                </div>

                <!-- Canvas для анимаций -->
                <div class="animation-area">
                    <canvas id="birds-canvas"></canvas>
                </div>

                <!-- Статистика -->
                <div class="game-stats">
                    <div class="stat-card">
                        <h3>Coins</h3>
                        <div id="hb-coins" class="stat-value">0</div>
                    </div>
                    <div class="stat-card">
                        <h3>Total Birds</h3>
                        <div id="hb-total-birds" class="stat-value">0</div>
                    </div>
                    <div class="stat-card">
                        <h3>Eggs Rate</h3>
                        <div id="hb-egg-rate" class="stat-value">0/sec</div>
                    </div>
                    <div class="stat-card">
                        <h3>Collection Timer</h3>
                        <div id="hb-collection-timer" class="stat-value">Ready</div>
                    </div>
                </div>

                ${this.config.enableRedeem ? `
                <!-- Redeem Bar -->
                <div class="redeem-section">
                    <h3>Redeem Code</h3>
                    <div class="redeem-input-group">
                        <input type="text" id="hb-redeem-code" placeholder="Enter code (e.g., SKIPTIMER)" class="redeem-input">
                        <button id="hb-redeem-btn" class="redeem-btn">Redeem</button>
                    </div>
                </div>
                ` : ''}

                <!-- Управление -->
                <div class="game-controls">
                    <button id="hb-collect-btn" class="control-btn collect">Collect Eggs</button>
                    <button id="hb-load-truck-btn" class="control-btn sell">Put in Truck</button>
                </div>

                <!-- Truck System -->
                <div class="truck-section">
                    <h3>🚛 Delivery Truck</h3>
                    <div class="truck-status">
                        <div id="hb-truck-location" class="truck-location">Location: Farm</div>
                        <div id="hb-truck-timer" class="truck-timer"></div>
                    </div>
                    <div class="truck-inventory">
                        <h4>Truck Inventory</h4>
                        <div id="hb-truck-inventory" class="truck-inventory-grid">
                            <!-- Динамически генерируется -->
                        </div>
                    </div>
                    <div class="truck-controls">
                        <button id="hb-go-to-city-btn" class="truck-btn go-to-city">Go to City</button>
                        <button id="hb-sell-truck-eggs-btn" class="truck-btn sell-truck">Sell Truck Eggs</button>
                        <button id="hb-go-to-farm-btn" class="truck-btn go-to-farm">Return to Farm</button>
                    </div>
                </div>

                <!-- Таймер -->
                <div id="hb-timer-text" class="timer-text">Collection ready in: Ready</div>

                <!-- Птицы -->
                <div class="birds-section">
                    <h3>Your Birds</h3>
                    <div id="hb-birds-grid" class="birds-grid">
                        <!-- Динамически генерируется -->
                    </div>
                </div>

                <!-- Яйца -->
                <div class="eggs-section">
                    <h3>Egg Inventory</h3>
                    <div id="hb-total-eggs" class="total-eggs">Total: 0</div>
                    <div id="hb-eggs-grid" class="eggs-grid">
                        <!-- Динамически генерируется -->
                    </div>
                </div>
            </div>
        `;

        this.gameContainer = gameArea.querySelector('.happy-birds-game');
        this.renderBirdsGrid();
        this.renderEggsGrid();
    }

    // Render birds grid
    renderBirdsGrid() {
        const birdsGrid = document.getElementById('hb-birds-grid');
        if (!birdsGrid) return;

        birdsGrid.innerHTML = '';

        for (const color in this.BIRDS) {
            const bird = this.BIRDS[color];
            const count = this.birds[color] || 0;
            const produced = Math.floor(this.produced[color] || 0);

            const birdCard = document.createElement('div');
            birdCard.className = 'bird-card';
            birdCard.setAttribute('data-color', color);
            birdCard.innerHTML = `
                <h4>${bird.label} Bird</h4>
                <div class="bird-stats">
                    <div>Count: ${count}</div>
                    <div>EPS: ${count * bird.eps}</div>
                    <div>Produced: ${produced}</div>
                </div>
                <button class="hb-buy-btn" data-color="${color}" ${this.coins < bird.cost ? 'disabled' : ''}>
                    Buy (${bird.cost})
                </button>
            `;

            birdsGrid.appendChild(birdCard);
        }
    }

    // Render eggs grid
    renderEggsGrid() {
        const eggsGrid = document.getElementById('hb-eggs-grid');
        if (!eggsGrid) return;

        eggsGrid.innerHTML = '';

        for (const color in this.BIRDS) {
            const amount = this.eggs[color] || 0;
            if (amount > 0) {
                const bird = this.BIRDS[color];
                const eggCard = document.createElement('div');
                eggCard.className = 'egg-card';
                eggCard.setAttribute('data-color', color);
                eggCard.innerHTML = `
                    <h4>${bird.label} Eggs</h4>
                    <div class="egg-stats">
                        <div>Amount: ${amount}</div>
                        <div>Value: ${Math.floor(amount / bird.eggsPerCoin)} coins</div>
                    </div>
                    <button class="hb-load-truck-btn" data-color="${color}">
                        Load Truck
                    </button>
                `;

                eggsGrid.appendChild(eggCard);
            }
        }
    }

    // Render truck inventory
    renderTruckInventory() {
        const truckInventoryEl = document.getElementById('hb-truck-inventory');
        if (!truckInventoryEl) return;

        truckInventoryEl.innerHTML = '';

        let hasEggs = false;
        for (const color in this.BIRDS) {
            const amount = this.truckInventory[color] || 0;
            if (amount > 0) {
                hasEggs = true;
                const bird = this.BIRDS[color];
                const eggCard = document.createElement('div');
                eggCard.className = 'truck-egg-card';
                eggCard.setAttribute('data-color', color);
                eggCard.innerHTML = `
                    <h4>${bird.label} Eggs</h4>
                    <div class="egg-stats">
                        <div>Amount: ${amount}</div>
                        <div>Value: ${Math.floor(amount / bird.eggsPerCoin)} coins</div>
                    </div>
                `;

                truckInventoryEl.appendChild(eggCard);
            }
        }

        if (!hasEggs) {
            truckInventoryEl.innerHTML = '<div class="empty-truck">Truck is empty</div>';
        }
    }

    // Update UI
    updateUI() {
        const coinsEl = document.getElementById('hb-coins');
        if (coinsEl) coinsEl.textContent = Math.floor(this.coins);

        const totalBirdsEl = document.getElementById('hb-total-birds');
        if (totalBirdsEl) {
            const totalBirds = Object.values(this.birds).reduce((sum, count) => sum + count, 0);
            totalBirdsEl.textContent = totalBirds;
        }

        const eggRateEl = document.getElementById('hb-egg-rate');
        if (eggRateEl) {
            const totalEps = Object.entries(this.birds).reduce((sum, [color, count]) => sum + (count * this.BIRDS[color].eps), 0);
            eggRateEl.textContent = `${totalEps.toFixed(1)}/sec`;
        }

        const timerEl = document.getElementById('hb-collection-timer');
        if (timerEl) {
            if (!this.productionStart) {
                timerEl.textContent = 'Not started';
            } else {
                const lastSaveTime = this.lastSaveTime || this.productionStart;
                const timeSinceLast = (Date.now() - lastSaveTime.getTime()) / 1000;
                if (timeSinceLast >= this.SIX_HOURS_SEC) {
                    timerEl.textContent = 'Ready';
                } else {
                    const hoursLeft = Math.floor((this.SIX_HOURS_SEC - timeSinceLast) / 3600);
                    const minsLeft = Math.floor(((this.SIX_HOURS_SEC - timeSinceLast) % 3600) / 60);
                    timerEl.textContent = `${hoursLeft}h ${minsLeft}m`;
                }
            }
        }

        const timerTextEl = document.getElementById('hb-timer-text');
        if (timerTextEl) {
            if (!this.productionStart) {
                timerTextEl.textContent = 'Collection ready in: Not started';
            } else {
                const lastSaveTime = this.lastSaveTime || this.productionStart;
                const timeSinceLast = (Date.now() - lastSaveTime.getTime()) / 1000;
                if (timeSinceLast >= this.SIX_HOURS_SEC) {
                    timerTextEl.textContent = 'Collection ready in: Ready';
                } else {
                    const remaining = this.SIX_HOURS_SEC - timeSinceLast;
                    const hoursLeft = Math.floor(remaining / 3600);
                    const minsLeft = Math.floor((remaining % 3600) / 60);
                    const secsLeft = Math.floor(remaining % 60);
                    timerTextEl.textContent = `Collection ready in: ${hoursLeft}h ${minsLeft}m ${secsLeft}s`;
                }
            }
        }

        const totalEggsEl = document.getElementById('hb-total-eggs');
        if (totalEggsEl) {
            const totalEggs = Object.values(this.eggs).reduce((sum, amount) => sum + amount, 0);
            totalEggsEl.textContent = `Total: ${totalEggs}`;
        }

        // Update truck UI
        const truckLocationEl = document.getElementById('hb-truck-location');
        if (truckLocationEl) {
            const locationText = {
                'farm': 'At Farm',
                'traveling_to_city': 'Traveling to City',
                'city': 'At City',
                'traveling_to_farm': 'Returning to Farm'
            };
            truckLocationEl.textContent = `Location: ${locationText[this.truckLocation] || 'Unknown'}`;
        }

        const truckTimerEl = document.getElementById('hb-truck-timer');
        if (truckTimerEl && this.truckDepartureTime && (this.truckLocation === 'traveling_to_city' || this.truckLocation === 'traveling_to_farm')) {
            const timeSinceDeparture = (Date.now() - this.truckDepartureTime.getTime()) / 1000;
            const timeLeft = this.ONE_HOUR_SEC - timeSinceDeparture;
            if (timeLeft <= 0) {
                truckTimerEl.textContent = 'Arriving soon...';
            } else {
                const minsLeft = Math.floor(timeLeft / 60);
                const secsLeft = Math.floor(timeLeft % 60);
                truckTimerEl.textContent = `Arrival in: ${minsLeft}m ${secsLeft}s`;
            }
        } else {
            truckTimerEl.textContent = '';
        }

        this.renderBirdsGrid();
        this.renderEggsGrid();
        this.renderTruckInventory();
    }

    // Initialize game
    initGame() {
        // Game initialization
    }

    // Bind events
    bindGameEvents() {
        const backBtn = document.getElementById('hb-back-btn');
        if (backBtn) {
            backBtn.addEventListener('click', () => {
                this.showGameMessage('Returning to game menu...', 'info');
                if (this.gameManager && this.gameManager.returnToMenu) {
                    this.gameManager.returnToMenu();
                } else {
                    // Fallback: try to show menu directly
                    const gameArea = document.getElementById('game-area');
                    const gameMenu = document.getElementById('game-menu');
                    if (gameArea) gameArea.style.display = 'none';
                    if (gameMenu) gameMenu.style.display = 'block';
                }
            });
        }

        const collectBtn = document.getElementById('hb-collect-btn');
        if (collectBtn) {
            collectBtn.addEventListener('click', () => {
                this.collectEggs();
            });
        }

        const loadTruckBtn = document.getElementById('hb-load-truck-btn');
        if (loadTruckBtn) {
            loadTruckBtn.addEventListener('click', () => {
                this.loadTruck();
            });
        }

        // Truck control buttons
        const goToCityBtn = document.getElementById('hb-go-to-city-btn');
        if (goToCityBtn) {
            goToCityBtn.addEventListener('click', () => {
                this.truckGoToCity();
            });
        }

        const sellTruckEggsBtn = document.getElementById('hb-sell-truck-eggs-btn');
        if (sellTruckEggsBtn) {
            sellTruckEggsBtn.addEventListener('click', () => {
                this.sellTruckEggs();
            });
        }

        const goToFarmBtn = document.getElementById('hb-go-to-farm-btn');
        if (goToFarmBtn) {
            goToFarmBtn.addEventListener('click', () => {
                this.truckGoToFarm();
            });
        }

        // Only bind redeem events if feature is enabled
        if (this.config.enableRedeem) {
            const redeemBtn = document.getElementById('hb-redeem-btn');
            if (redeemBtn) {
                redeemBtn.addEventListener('click', () => {
                    this.redeemCode();
                });
            }
        }

        // Delegate events for dynamic buttons
        const birdsGrid = document.getElementById('hb-birds-grid');
        if (birdsGrid) {
            birdsGrid.addEventListener('click', (e) => {
                if (e.target.classList.contains('hb-buy-btn')) {
                    const color = e.target.dataset.color;
                    if (this.consoleMessages) console.log(`🛒 Buy button clicked for ${color}`);
                    this.buyBird(color);
                }
            });
        }

        const eggsGrid = document.getElementById('hb-eggs-grid');
        if (eggsGrid) {
            eggsGrid.addEventListener('click', (e) => {
                if (e.target.classList.contains('hb-load-truck-btn')) {
                    const color = e.target.dataset.color;
                    const amount = this.eggs[color] || 0;
                    if (amount > 0) {
                        if (this.consoleMessages) console.log(`🚛 Load truck button clicked for ${color}, amount: ${amount}`);
                        this.loadTruckEggs(color, amount);
                    } else {
                        this.showGameMessage(`No ${color} eggs to load!`, 'error');
                    }
                }
            });
        }
    }

    // Redeem code
    async redeemCode() {
        const codeInput = document.getElementById('hb-redeem-code');
        if (!codeInput) return;

        const code = codeInput.value.trim().toUpperCase();
        if (!code) {
            this.showGameMessage('Please enter a code!', 'error');
            return;
        }

        try {
            const username = window.authManager?.currentUser?.username;
            if (!username) {
                this.showGameMessage('Please log in to redeem codes', 'error');
                return;
            }

            const response = await fetch('/api/game/redeem', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, code })
            });

            const data = await response.json();

            if (data.success) {
                // Update game state based on what was redeemed
                if (data.coins !== undefined) this.coins = data.coins;
                if (data.birds) this.birds = data.birds;
                if (data.eggs) this.eggs = data.eggs;
                if (data.savedProduced) this.savedProduced = data.savedProduced;
                if (data.lastSaveTime) this.lastSaveTime = new Date(data.lastSaveTime);
                if (data.productionStart) this.productionStart = new Date(data.productionStart);

                // Recalculate produced
                this.updateProduced();
                this.updateUI();
                this.showGameMessage(`Code redeemed successfully! ${data.message || ''}`, 'success');
                codeInput.value = ''; // Clear input
            } else {
                this.showGameMessage(data.error || 'Failed to redeem code', 'error');
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
        } else {
            window.showToast?.(message, type, 4000);
        }

        if (this.consoleMessages) console.log(`📢 Game message: ${message} (${type})`);
    }

    // Cleanup
    cleanup() {
        if (this.gameLoopInterval) {
            clearInterval(this.gameLoopInterval);
        }
        if (this.statusRefreshInterval) {
            clearInterval(this.statusRefreshInterval);
        }
        // Remove styles if needed
    }
}