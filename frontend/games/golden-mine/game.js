const MAX_MINES = 10;

export default class GoldenMineGame {
    constructor() {
        this.isRunning = false;
        this.gameContainer = null;
        this.coins = 1000;
        this.mines = Array(MAX_MINES).fill(null);
        this.inventory = {};
        this.truckCargo = {};
        this.truckLocation = 'mine';
        this.truckDepartureTime = null;
        this.gameManager = null;
        this.gameLoopInterval = null;
        this.statusRefreshInterval = null;
        this.messageTimeout = null;
        this.consoleMessages = true;

        this.MINE_TYPES = {
            coal: { cost: 1000, orePerSecond: 1, orePerCoin: 100, level: 1, name: 'Coal Mine' },
            copper: { cost: 2500, orePerSecond: 2, orePerCoin: 80, level: 2, name: 'Copper Mine' },
            iron: { cost: 10000, orePerSecond: 5, orePerCoin: 50, level: 3, name: 'Iron Mine' },
            nickel: { cost: 25000, orePerSecond: 10, orePerCoin: 40, level: 4, name: 'Nickel Mine' },
            silver: { cost: 100000, orePerSecond: 20, orePerCoin: 20, level: 5, name: 'Silver Mine' },
            golden: { cost: 500000, orePerSecond: 50, orePerCoin: 10, level: 6, name: 'Golden Mine' }
        };

        this.PRODUCTION_TIME = 8 * 60 * 60;
        this.REST_TIME = 4 * 60 * 60;
        this.TRUCK_TRAVEL_TIME = 2 * 60 * 60;
        this.MAX_WORKERS_PER_MINE = 10;
        this.timerConfig = {
            production: this.PRODUCTION_TIME,
            rest: this.REST_TIME,
            truckTravel: this.TRUCK_TRAVEL_TIME
        };
    }

    setGameManager(gameManager) {
        this.gameManager = gameManager;
        if (this.consoleMessages) console.log('⛏️ Golden Mine manager linked');
    }

    async start() {
        if (this.consoleMessages) console.log('⛏️ Starting Golden Mine...');
        this.isRunning = true;

        this.gameContainer = document.getElementById('game-area');
        if (!this.gameContainer) {
            throw new Error('Game area not found');
        }

        await this.loadConfig();
        await this.loadGameTemplate();
        await this.loadGameData();
        this.initGame();
        this.bindGameEvents();
        this.startGameLoop();
        this.startStatusRefresh();
    }

    stop() {
        if (this.consoleMessages) console.log('⛏️ Stopping Golden Mine...');
        this.isRunning = false;

        if (this.gameLoopInterval) {
            clearInterval(this.gameLoopInterval);
            this.gameLoopInterval = null;
        }

        if (this.statusRefreshInterval) {
            clearInterval(this.statusRefreshInterval);
            this.statusRefreshInterval = null;
        }

        if (this.messageTimeout) {
            clearTimeout(this.messageTimeout);
            this.messageTimeout = null;
        }
    }

    async loadConfig() {
        try {
            const response = await fetch('/api/config');
            if (!response.ok) {
                return;
            }

            const config = await response.json();
            this.consoleMessages = Boolean(config.consoleMessages);

            if (config.fastMode) {
                this.PRODUCTION_TIME = 30;
                this.REST_TIME = 15;
                this.TRUCK_TRAVEL_TIME = 10;
            } else {
                this.PRODUCTION_TIME = 8 * 60 * 60;
                this.REST_TIME = 4 * 60 * 60;
                this.TRUCK_TRAVEL_TIME = 2 * 60 * 60;
            }

            this.timerConfig = {
                production: this.PRODUCTION_TIME,
                rest: this.REST_TIME,
                truckTravel: this.TRUCK_TRAVEL_TIME
            };
        } catch (error) {
            console.error('Config load error:', error);
        }
    }

    async loadGameTemplate() {
        const gameArea = this.gameContainer;
        gameArea.innerHTML = `
            <link rel="stylesheet" href="./games/golden-mine/style.css">
            <div class="golden-mine-game">
                <div class="game-header">
                    <h1>⛏️ Golden Mine</h1>
                    <div class="coins-display">
                        <span class="coin-icon">💰</span>
                        <span class="coin-amount">0</span>
                    </div>
                    <button id="gm-back-btn" class="back-button">← Menu</button>
                </div>

                <div class="game-content">
                    <div class="mines-section">
                        <div class="section-header">
                            <h2>Mine Operations</h2>
                            <button id="gm-collect-all-btn" class="collect-all-btn" disabled>Collect All Ready</button>
                        </div>
                        <div class="mines-grid">
                            ${Array.from({ length: MAX_MINES }, (_, index) => `<div class="mine-slot" data-index="${index}"></div>`).join('')}
                        </div>
                    </div>

                    <div class="sidebar">
                        <div class="inventory">
                            <h3>Ore Inventory</h3>
                            <div class="empty-inventory">No ore stored</div>
                        </div>

                        <div class="truck-section">
                            <h3>🚛 Transport Truck</h3>
                            <div class="truck-status">At Mine</div>
                            <div class="truck-cargo">
                                <div class="empty-truck">Truck is empty</div>
                            </div>
                            <div class="truck-actions"></div>
                        </div>

                        <div class="redeem-section">
                            <h3>Redeem Code</h3>
                            <input type="text" class="redeem-input" placeholder="Enter code">
                            <button class="redeem-btn">Redeem</button>
                        </div>
                    </div>
                </div>

                <div class="game-message" style="display:none;"></div>
            </div>
        `;

        const backBtn = gameArea.querySelector('#gm-back-btn');
        if (backBtn) {
            backBtn.addEventListener('click', () => {
                if (this.gameManager) {
                    this.gameManager.returnToMenu();
                }
            });
        }
    }

    async loadGameData(options = {}) {
        try {
            const username = window.authManager?.currentUser?.username;
            if (!username) {
                return;
            }

            const response = await fetch(`/api/golden-mine/status/${username}`);
            if (!response.ok) {
                return;
            }

            const data = await response.json();
            this.syncStateFromPayload(data);
            this.updateUI();

            if (this.consoleMessages && !options.silent) {
                console.log('⛏️ Golden Mine data synced');
            }
        } catch (error) {
            if (!options.silent) {
                console.error('Failed to load Golden Mine data:', error);
            }
        }
    }

    initGame() {
        this.updateUI();
    }

    bindGameEvents() {
        const container = this.gameContainer;
        if (!container) return;

        container.addEventListener('click', (event) => {
            const target = event.target;

            if (target.classList.contains('buy-mine-btn')) {
                const mineType = target.dataset.mineType;
                this.buyMine(mineType);
                return;
            }

            if (target.classList.contains('hire-worker-btn')) {
                const index = Number(target.dataset.mineIndex);
                this.hireWorker(index);
                return;
            }

            if (target.classList.contains('upgrade-mine-btn')) {
                const index = Number(target.dataset.mineIndex);
                this.upgradeMine(index);
                return;
            }

            if (target.classList.contains('collect-ore-btn')) {
                const index = Number(target.dataset.mineIndex);
                this.collectOre(index);
                return;
            }

            if (target.classList.contains('truck-btn')) {
                const action = target.dataset.action;
                if (action === 'load') this.showLoadTruckDialog();
                if (action === 'send') this.sendTruck();
                if (action === 'sell') this.sellOre();
                if (action === 'return') this.returnTruck();
            }
        });

        const collectAllBtn = container.querySelector('#gm-collect-all-btn');
        if (collectAllBtn) {
            collectAllBtn.addEventListener('click', () => this.collectAllReady());
        }

        const redeemBtn = container.querySelector('.redeem-btn');
        if (redeemBtn) {
            redeemBtn.addEventListener('click', () => {
                const input = container.querySelector('.redeem-input');
                const code = input?.value.trim();
                if (code) {
                    this.redeemCode(code);
                    input.value = '';
                }
            });
        }
    }

    startGameLoop() {
        this.gameLoopInterval = setInterval(() => {
            if (!this.isRunning) return;
            this.updateTimers();
            this.updateUI();
        }, 1000);
    }

    startStatusRefresh() {
        this.statusRefreshInterval = setInterval(() => {
            if (!this.isRunning) return;
            this.loadGameData({ silent: true });
        }, 5000);
    }

    updateTimers() {
        this.mines.forEach((mine) => {
            if (!mine) return;

            if (typeof mine.secondsRemaining !== 'number') {
                const base = mine.state === 'resting' ? this.timerConfig.rest : this.timerConfig.production;
                mine.secondsRemaining = base;
            }

            if ((mine.state === 'producing' || mine.state === 'resting') && mine.secondsRemaining > 0) {
                mine.secondsRemaining = Math.max(0, mine.secondsRemaining - 1);
            }
        });

        if (this.truckDepartureTime) {
            const elapsed = Math.floor((Date.now() - this.truckDepartureTime.getTime()) / 1000);
            if (this.truckLocation === 'traveling_to_factory' && elapsed >= this.timerConfig.truckTravel) {
                this.truckLocation = 'factory';
                this.truckDepartureTime = null;
            } else if (this.truckLocation === 'traveling_to_mine' && elapsed >= this.timerConfig.truckTravel) {
                this.truckLocation = 'mine';
                this.truckDepartureTime = null;
            }
        }
    }

    updateUI() {
        const container = this.gameContainer;
        if (!container) return;

        const coinsEl = container.querySelector('.coin-amount');
        if (coinsEl) {
            coinsEl.textContent = this.coins.toLocaleString();
        }

        const collectAllBtn = container.querySelector('#gm-collect-all-btn');
        if (collectAllBtn) {
            collectAllBtn.disabled = !this.mines.some((mine) => mine && mine.state === 'ready');
        }

        this.mines.forEach((mine, index) => {
            const slot = container.querySelector(`.mine-slot[data-index="${index}"]`);
            if (!slot) return;

            if (!mine) {
                const affordable = Object.entries(this.MINE_TYPES)
                    .filter(([, config]) => this.coins >= config.cost)
                    .sort((a, b) => a[1].cost - b[1].cost);

                const next = affordable.length > 0 ? affordable[0] : Object.entries(this.MINE_TYPES)[0];
                const [typeKey, typeConfig] = next;

                slot.innerHTML = `
                    <div class="empty-mine">
                        <div class="mine-icon">⛏️</div>
                        <div class="mine-name">Empty Slot</div>
                        <button class="buy-mine-btn" data-mine-type="${typeKey}">
                            Buy ${typeConfig.name} ($${typeConfig.cost.toLocaleString()})
                        </button>
                    </div>
                `;
                return;
            }

            const config = this.MINE_TYPES[mine.type];
            const baseDuration = mine.state === 'resting' ? this.timerConfig.rest : this.timerConfig.production;
            const remaining = Math.max(0, typeof mine.secondsRemaining === 'number' ? Math.ceil(mine.secondsRemaining) : baseDuration);
            const progress = mine.state === 'ready'
                ? 100
                : baseDuration > 0
                    ? Math.max(0, Math.min(100, ((baseDuration - remaining) / baseDuration) * 100))
                    : 0;

            slot.innerHTML = `
                <div class="mine-card ${mine.state}">
                    <div class="mine-header">
                        <div class="mine-icon">${this.getMineIcon(mine.type)}</div>
                        <div class="mine-info">
                            <div class="mine-name">${config.name}</div>
                            <div class="mine-level">Level ${config.level}</div>
                        </div>
                    </div>
                    <div class="mine-stats">
                        <div class="workers">👷 ${mine.workers}/${this.MAX_WORKERS_PER_MINE}</div>
                        <div class="production">${config.orePerSecond * mine.workers}/sec</div>
                    </div>
                    <div class="progress-bar">
                        <div class="progress-fill" style="width:${progress}%"></div>
                    </div>
                    <div class="mine-status">${this.getMineStatusText(mine, remaining)}</div>
                    <div class="mine-actions">
                        ${mine.workers < this.MAX_WORKERS_PER_MINE ? `<button class="hire-worker-btn" data-mine-index="${index}">Hire Worker</button>` : ''}
                        ${mine.workers === this.MAX_WORKERS_PER_MINE && this.getNextMineType(mine.type) ? `<button class="upgrade-mine-btn" data-mine-index="${index}">Upgrade</button>` : ''}
                        ${mine.state === 'ready' ? `<button class="collect-ore-btn" data-mine-index="${index}">Collect ${Number(mine.oreProduced || 0).toLocaleString()} ore</button>` : ''}
                    </div>
                </div>
            `;
        });

        const inventoryEl = container.querySelector('.inventory');
        if (inventoryEl) {
            const entries = Object.entries(this.inventory).filter(([, amount]) => (Number(amount) || 0) > 0);
            inventoryEl.innerHTML = '<h3>Ore Inventory</h3>';
            if (entries.length === 0) {
                inventoryEl.innerHTML += '<div class="empty-inventory">No ore stored</div>';
            } else {
                entries.forEach(([type, amount]) => {
                    inventoryEl.innerHTML += `<div class="inventory-item">${this.getMineIcon(type)} ${type}: ${(Number(amount) || 0).toLocaleString()}</div>`;
                });
            }
        }

        const truckSection = container.querySelector('.truck-section .truck-actions');
        const truckStatusEl = container.querySelector('.truck-section .truck-status');
        const truckCargoEl = container.querySelector('.truck-section .truck-cargo');

        if (truckStatusEl) {
            truckStatusEl.textContent = this.getTruckStatusText();
        }

        if (truckCargoEl) {
            const cargoEntries = Object.entries(this.truckCargo).filter(([, amount]) => (Number(amount) || 0) > 0);
            truckCargoEl.innerHTML = cargoEntries.length === 0
                ? '<div class="empty-truck">Truck is empty</div>'
                : cargoEntries.map(([type, amount]) => `<div>${this.getMineIcon(type)} ${type}: ${(Number(amount) || 0).toLocaleString()}</div>`).join('');

            if (truckSection) {
                const canSend = this.truckLocation === 'mine' && cargoEntries.length > 0;
                const atFactory = this.truckLocation === 'factory';

                truckSection.innerHTML = `
                    ${this.truckLocation === 'mine' ? '<button class="truck-btn" data-action="load">Load Ore</button>' : ''}
                    ${canSend ? '<button class="truck-btn" data-action="send">Send to Factory</button>' : ''}
                    ${atFactory ? '<button class="truck-btn" data-action="sell">Sell Ore</button>' : ''}
                    ${atFactory ? '<button class="truck-btn" data-action="return">Return to Mine</button>' : ''}
                `;
            }
        }
    }

    getMineIcon(type) {
        const icons = {
            coal: '⚫',
            copper: '🟫',
            iron: '⚙️',
            nickel: '🔧',
            silver: '🥈',
            golden: '🥇'
        };
        return icons[type] || '⛏️';
    }

    getMineStatusText(mine, remainingSeconds) {
        switch (mine.state) {
            case 'producing':
                return remainingSeconds > 0 ? `Producing... ${this.formatDuration(remainingSeconds)}` : 'Production finishing...';
            case 'ready':
                return 'Ready to collect!';
            case 'resting':
                return remainingSeconds > 0 ? `Resting... ${this.formatDuration(remainingSeconds)}` : 'Rest complete soon...';
            default:
                return 'Unknown';
        }
    }

    getTruckStatusText() {
        switch (this.truckLocation) {
            case 'mine':
                return 'At Mine';
            case 'traveling_to_factory':
                return 'Traveling to Factory...';
            case 'factory':
                return 'At Factory';
            case 'traveling_to_mine':
                return 'Returning to Mine...';
            default:
                return 'Unknown';
        }
    }

    getNextMineType(currentType) {
        const types = Object.keys(this.MINE_TYPES);
        const index = types.indexOf(currentType);
        return index >= 0 && index < types.length - 1 ? types[index + 1] : null;
    }

    formatDuration(seconds) {
        const total = Math.max(0, Math.floor(Number(seconds) || 0));
        const hours = Math.floor(total / 3600);
        const minutes = Math.floor((total % 3600) / 60);
        const secs = total % 60;

        if (hours > 0) return `${hours}h ${minutes}m`;
        if (minutes > 0) return `${minutes}m ${secs}s`;
        return `${secs}s`;
    }

    normalizeMines(mineData = []) {
        return Array.from({ length: MAX_MINES }, (_, index) => {
            const mine = mineData[index] || null;
            if (!mine) return null;

            const state = mine.state || 'producing';
            const baseDuration = state === 'resting' ? this.timerConfig.rest : this.timerConfig.production;
            return {
                ...mine,
                state,
                workers: Number(mine.workers) || 0,
                oreProduced: Number(mine.oreProduced) || 0,
                lastStateChange: mine.lastStateChange ? new Date(mine.lastStateChange) : new Date(),
                secondsRemaining: typeof mine.secondsRemaining === 'number'
                    ? Math.max(0, Math.ceil(mine.secondsRemaining))
                    : Math.max(0, Math.ceil(typeof mine.timeLeft === 'number' ? mine.timeLeft : baseDuration))
            };
        });
    }

    normalizeResourceMap(source = {}) {
        const result = {};
        Object.entries(source).forEach(([key, value]) => {
            result[key] = Number(value) || 0;
        });
        return result;
    }

    syncStateFromPayload(data = {}) {
        if (typeof data.coins === 'number') {
            this.coins = data.coins;
        }

        this.mines = Array.isArray(data.mines) ? this.normalizeMines(data.mines) : Array(MAX_MINES).fill(null);
        this.inventory = this.normalizeResourceMap(data.inventory || {});
        this.truckCargo = this.normalizeResourceMap(data.truckCargo || {});
        this.truckLocation = data.truckLocation || this.truckLocation || 'mine';
        this.truckDepartureTime = data.truckDepartureTime ? new Date(data.truckDepartureTime) : null;

        if (data.timers) {
            if (typeof data.timers.production === 'number') this.PRODUCTION_TIME = data.timers.production;
            if (typeof data.timers.rest === 'number') this.REST_TIME = data.timers.rest;
            if (typeof data.timers.truckTravel === 'number') this.TRUCK_TRAVEL_TIME = data.timers.truckTravel;
            this.timerConfig = {
                production: this.PRODUCTION_TIME,
                rest: this.REST_TIME,
                truckTravel: this.TRUCK_TRAVEL_TIME
            };
        }
    }

    async buyMine(mineType) {
        try {
            const username = window.authManager?.currentUser?.username;
            if (!username) return;

            const response = await fetch('/api/golden-mine/buy_mine', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, mineType })
            });

            const result = await response.json();
            if (response.ok && result.success) {
                this.coins = result.newCoins;
                await this.loadGameData({ silent: true });
                this.showMessage('Mine purchased successfully!', 'success');
                return;
            }

            this.showMessage(result.error || 'Failed to buy mine', 'error');
        } catch (error) {
            console.error('Buy mine error:', error);
            this.showMessage('Failed to buy mine', 'error');
        }
    }

    async hireWorker(mineIndex) {
        try {
            const username = window.authManager?.currentUser?.username;
            if (!username) return;

            const response = await fetch('/api/golden-mine/hire_worker', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, mineIndex })
            });

            const result = await response.json();
            if (response.ok && result.success) {
                this.coins = result.newCoins;
                await this.loadGameData({ silent: true });
                this.showMessage('Worker hired successfully!', 'success');
                return;
            }

            this.showMessage(result.error || 'Failed to hire worker', 'error');
        } catch (error) {
            console.error('Hire worker error:', error);
            this.showMessage('Failed to hire worker', 'error');
        }
    }

    async upgradeMine(mineIndex) {
        try {
            const username = window.authManager?.currentUser?.username;
            if (!username) return;

            const response = await fetch('/api/golden-mine/upgrade_mine', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, mineIndex })
            });

            const result = await response.json();
            if (response.ok && result.success) {
                this.coins = result.newCoins;
                await this.loadGameData({ silent: true });
                this.showMessage('Mine upgraded successfully!', 'success');
                return;
            }

            this.showMessage(result.error || 'Failed to upgrade mine', 'error');
        } catch (error) {
            console.error('Upgrade mine error:', error);
            this.showMessage('Failed to upgrade mine', 'error');
        }
    }

    async collectOre(mineIndex, options = {}) {
        const { silent = false, refresh = true } = options;

        try {
            const username = window.authManager?.currentUser?.username;
            if (!username) return false;

            const response = await fetch('/api/golden-mine/collect_ore', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, mineIndex })
            });

            const result = await response.json();
            if (response.ok && result.success) {
                if (refresh) {
                    await this.loadGameData({ silent: true });
                }
                if (!silent) {
                    this.showMessage('Ore collected successfully!', 'success');
                }
                return true;
            }

            if (!silent) {
                this.showMessage(result.error || 'Failed to collect ore', 'error');
            }
            return false;
        } catch (error) {
            console.error('Collect ore error:', error);
            if (!silent) {
                this.showMessage('Failed to collect ore', 'error');
            }
            return false;
        }
    }

    async collectAllReady() {
        const readyIndices = this.mines
            .map((mine, index) => (mine && mine.state === 'ready') ? index : null)
            .filter((index) => index !== null);

        if (readyIndices.length === 0) {
            this.showMessage('No mines ready to collect!', 'info');
            return;
        }

        let collected = 0;
        for (const index of readyIndices) {
            const success = await this.collectOre(index, { silent: true, refresh: false });
            if (success) {
                collected += 1;
                const mine = this.mines[index];
                if (mine) {
                    mine.state = 'resting';
                    mine.secondsRemaining = this.timerConfig.rest;
                }
            }
        }

        await this.loadGameData({ silent: true });

        if (collected > 0) {
            const message = collected === 1
                ? 'Collected ore from 1 mine!'
                : `Collected ore from ${collected} mines!`;
            this.showMessage(message, 'success');
        } else {
            this.showMessage('Nothing to collect right now.', 'info');
        }
    }

    showLoadTruckDialog() {
        const loadable = Object.entries(this.inventory)
            .filter(([, amount]) => (Number(amount) || 0) > 0);

        if (loadable.length === 0) {
            this.showMessage('No ore available to load', 'error');
            return;
        }

        const [type, amount] = loadable[0];
        this.loadTruck(type, Number(amount) || 0);
    }

    async loadTruck(oreType, amount) {
        try {
            const username = window.authManager?.currentUser?.username;
            if (!username) return;

            const response = await fetch('/api/golden-mine/load_truck', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, oreType, amount })
            });

            const result = await response.json();
            if (response.ok && result.success) {
                await this.loadGameData({ silent: true });
                this.showMessage('Ore loaded onto truck!', 'success');
                return;
            }

            this.showMessage(result.error || 'Failed to load truck', 'error');
        } catch (error) {
            console.error('Load truck error:', error);
            this.showMessage('Failed to load truck', 'error');
        }
    }

    async sendTruck() {
        try {
            const username = window.authManager?.currentUser?.username;
            if (!username) return;

            const response = await fetch('/api/golden-mine/send_truck', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username })
            });

            const result = await response.json();
            if (response.ok && result.success) {
                await this.loadGameData({ silent: true });
                this.showMessage('Truck sent to factory!', 'success');
                return;
            }

            this.showMessage(result.error || 'Failed to send truck', 'error');
        } catch (error) {
            console.error('Send truck error:', error);
            this.showMessage('Failed to send truck', 'error');
        }
    }

    async sellOre() {
        try {
            const username = window.authManager?.currentUser?.username;
            if (!username) return;

            const response = await fetch('/api/golden-mine/sell_ore', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username })
            });

            const result = await response.json();
            if (response.ok && result.success) {
                this.coins = result.newCoins;
                await this.loadGameData({ silent: true });
                this.showMessage(`Ore sold for ${result.coinsEarned.toLocaleString()} coins!`, 'success');
                return;
            }

            this.showMessage(result.error || 'Failed to sell ore', 'error');
        } catch (error) {
            console.error('Sell ore error:', error);
            this.showMessage('Failed to sell ore', 'error');
        }
    }

    async returnTruck() {
        try {
            const username = window.authManager?.currentUser?.username;
            if (!username) return;

            const response = await fetch('/api/golden-mine/return_truck', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username })
            });

            const result = await response.json();
            if (response.ok && result.success) {
                await this.loadGameData({ silent: true });
                this.showMessage('Truck returning to mine!', 'success');
                return;
            }

            this.showMessage(result.error || 'Failed to return truck', 'error');
        } catch (error) {
            console.error('Return truck error:', error);
            this.showMessage('Failed to return truck', 'error');
        }
    }

    async redeemCode(code) {
        try {
            const username = window.authManager?.currentUser?.username;
            if (!username) return;

            const response = await fetch('/api/golden-mine/redeem', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, code })
            });

            const result = await response.json();
            if (response.ok && result.success) {
                this.coins = result.newCoins;
                await this.loadGameData({ silent: true });
                const reward = Number(result.reward || 0);
                const message = result.message
                    ? `Code redeemed: ${result.message}`
                    : `Code redeemed! Received ${reward.toLocaleString()} coins!`;
                this.showMessage(message, 'success');
                return;
            }

            this.showMessage(result.error || 'Failed to redeem code', 'error');
        } catch (error) {
            console.error('Redeem code error:', error);
            this.showMessage('Failed to redeem code', 'error');
        }
    }

    showMessage(message, type = 'info') {
        const container = this.gameContainer;
        if (!container) return;

        let msgEl = container.querySelector('.game-message');
        if (!msgEl) {
            msgEl = document.createElement('div');
            msgEl.className = 'game-message';
            container.appendChild(msgEl);
        }

        msgEl.className = `game-message ${type}`;
        msgEl.textContent = message;
        msgEl.style.display = 'block';

        if (this.messageTimeout) {
            clearTimeout(this.messageTimeout);
        }

        this.messageTimeout = setTimeout(() => {
            msgEl.style.display = 'none';
        }, 3000);
    }
}
