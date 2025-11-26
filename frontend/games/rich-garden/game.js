export default class RichGardenGame {
    constructor() {
        this.isRunning = false;
        this.gameContainer = null;
        this.coins = 1000; // Start with enough coins to buy first tree
        this.garden = Array(10).fill(null); // 10 cells: null = empty, or tree object
        this.inventory = {}; // Fruits by tree type
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

        // Production constants
        this.PRODUCTION_TIME = 4 * 60 * 60; // 4 hours in seconds
        this.COLLECTION_TIME = 30 * 60; // 30 minutes in seconds
        this.TRUCK_TRAVEL_TIME = 60 * 60; // 1 hour in seconds
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

                <!-- Controls -->
                <div class="game-controls">
                    <button id="rg-collect-all-btn" class="control-btn collect">Collect All Ready</button>
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
    }

    // Load config from server
    async loadConfig() {
        try {
            const response = await fetch('/api/config');
            if (response.ok) {
                this.config = await response.json();
                if (this.consoleMessages) console.log('⚙️ Config loaded:', this.config);
            } else {
                this.config = { enableRedeem: true, showRestartButton: true, consoleMessages: true };
                if (this.consoleMessages) console.log('⚠️ Failed to load config, using defaults');
            }
        } catch (error) {
            this.config = { enableRedeem: true, showRestartButton: true, consoleMessages: true };
            if (this.consoleMessages) console.log('⚠️ Error loading config:', error);
        }
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
                this.coins = data.coins || 0;
                this.garden = data.garden || Array(10).fill(null);
                this.inventory = data.inventory || {};
                this.truckLocation = data.truckLocation || 'farm';
                this.truckDepartureTime = data.truckDepartureTime ? new Date(data.truckDepartureTime) : null;

                this.updateUI();
                if (this.consoleMessages) console.log('🔄 Rich Garden data loaded');
            }
        } catch (error) {
            console.error('Failed to load Rich Garden data:', error);
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
                this.coins = data.coins || 0;
                this.garden = data.garden || Array(10).fill(null);
                this.inventory = data.inventory || {};
                this.truckLocation = data.truckLocation || 'farm';
                this.truckDepartureTime = data.truckDepartureTime ? new Date(data.truckDepartureTime) : null;

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
        }, 10000);
    }

    // Update all timers
    updateTimers() {
        // Update tree timers based on plantedAt timestamp
        const now = new Date();
        this.garden.forEach((tree, index) => {
            if (tree && tree.plantedAt) {
                const plantedAt = new Date(tree.plantedAt);
                const elapsed = Math.floor((now - plantedAt) / 1000); // elapsed time in seconds
                const cyclePosition = elapsed % (this.PRODUCTION_TIME + this.COLLECTION_TIME);

                if (cyclePosition < this.PRODUCTION_TIME) {
                    // Tree is in producing phase
                    tree.state = 'producing';
                    tree.timeLeft = this.PRODUCTION_TIME - cyclePosition;
                } else {
                    // Tree is in ready/collecting phase
                    tree.state = tree.state === 'collecting' ? 'collecting' : 'ready';
                    tree.timeLeft = this.COLLECTION_TIME - (cyclePosition - this.PRODUCTION_TIME);
                }
            }
        });
    }

    // Render garden grid
    renderGardenGrid() {
        const gardenGrid = document.getElementById('rg-garden-grid');
        if (!gardenGrid) return;

        gardenGrid.innerHTML = '';

        for (let i = 0; i < 10; i++) {
            const cell = document.createElement('div');
            cell.className = 'garden-cell';
            cell.dataset.cell = i;

            const tree = this.garden[i];
            if (tree) {
                const treeType = this.TREE_TYPES[tree.type];
                cell.innerHTML = `
                    <div class="tree-info">
                        <div class="tree-name">${treeType.name}</div>
                        <div class="tree-state ${tree.state}">${this.getStateText(tree)}</div>
                        <div class="tree-timer">${this.formatTime(tree.timeLeft)}</div>
                    </div>
                    <div class="tree-actions">
                        ${tree.state === 'ready' ? `<button class="rg-collect-tree-btn" data-cell="${i}">Collect</button>` : ''}
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
        Object.entries(this.inventory).forEach(([type, amount]) => {
            if (amount > 0) {
                hasFruits = true;
                const treeType = this.TREE_TYPES[type];
                const value = Math.floor(amount / treeType.fruitsPerCoin);

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
            truckStatusEl.textContent = statusText[this.truckLocation] || 'Unknown';
        }

        const truckTimerEl = document.getElementById('rg-truck-timer');
        if (truckTimerEl && this.truckDepartureTime && (this.truckLocation === 'traveling_to_city' || this.truckLocation === 'traveling_to_farm')) {
            const timeSinceDeparture = (Date.now() - this.truckDepartureTime.getTime()) / 1000;
            const timeLeft = (60 * 60) - timeSinceDeparture; // 1 hour in seconds
            if (timeLeft <= 0) {
                truckTimerEl.textContent = 'Arriving soon...';
            } else {
                const minsLeft = Math.floor(timeLeft / 60);
                const secsLeft = Math.floor(timeLeft % 60);
                truckTimerEl.textContent = `Arrival in: ${minsLeft}m ${secsLeft}s`;
            }
        } else if (truckTimerEl) {
            truckTimerEl.textContent = '';
        }

        this.renderGardenGrid();
        this.renderInventory();
    }

    // Helper methods
    getStateText(tree) {
        switch (tree.state) {
            case 'producing': return 'Growing';
            case 'ready': return 'Ready to Collect';
            case 'collecting': return 'Collecting';
            default: return 'Unknown';
        }
    }

    formatTime(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        if (hours > 0) {
            return `${hours}h ${minutes}m`;
        }
        return `${minutes}m`;
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
                this.coins = data.coins;
                this.garden = data.garden;
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
                this.coins = data.coins;
                this.garden = data.garden;
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
        if (!tree || tree.state !== 'ready') {
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
                this.garden = data.garden;
                this.inventory = data.inventory;
                this.updateUI();
                this.showGameMessage(`Collected ${data.collected} fruits!`, 'success');
                setTimeout(() => this.refreshGameStatus(), 1000);
            } else {
                this.showGameMessage(data.error || 'Failed to collect tree', 'error');
            }
        } catch (error) {
            console.error('Collect tree error:', error);
            this.showGameMessage('Failed to collect tree', 'error');
        }
    }

    async collectAllReady() {
        const readyTrees = this.garden
            .map((tree, index) => ({ tree, index }))
            .filter(({ tree }) => tree && tree.state === 'ready');

        if (readyTrees.length === 0) {
            this.showGameMessage('No trees ready for collection!', 'info');
            return;
        }

        for (const { index } of readyTrees) {
            await this.collectTree(index);
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
                this.truckLocation = data.truckLocation;
                this.truckDepartureTime = new Date(data.truckDepartureTime);
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

        const totalFruits = Object.values(this.inventory).reduce((sum, amount) => sum + amount, 0);
        if (totalFruits === 0) {
            this.showGameMessage('No fruits to sell!', 'error');
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
                this.coins = data.coins;
                this.inventory = data.inventory;
                this.updateUI();
                this.showGameMessage(`Sold fruits for ${data.earned} coins!`, 'success');
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
                this.truckLocation = data.truckLocation;
                this.truckDepartureTime = new Date(data.truckDepartureTime);
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
                this.coins = data.coins;
                this.garden = data.garden;
                this.inventory = data.inventory;
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
        const messagesEl = document.getElementById('rg-messages');
        if (!messagesEl) return;

        const messageEl = document.createElement('div');
        messageEl.className = `game-message ${type}`;
        messageEl.textContent = message;

        messagesEl.appendChild(messageEl);

        // Auto remove after 5 seconds
        setTimeout(() => {
            if (messageEl.parentNode) {
                messageEl.remove();
            }
        }, 5000);
    }
}