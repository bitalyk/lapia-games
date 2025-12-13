const MAX_MINES = 10;

export default class GoldenMineGame {
    constructor() {
        this.isRunning = false;
        this.gameContainer = null;
        this.coins = 1000;
        this.mines = Array(MAX_MINES).fill(null);
        this.inventory = {};
        this.mineInventory = {};
        this.factoryInventory = {};
        this.truckCargo = {};
        this.truckLocation = 'mine';
        this.truckDepartureTime = null;
        this.transport = { vehicles: {} };
        this.productionFlow = { version: 1, stages: [] };
        this.factorySalesHistory = [];
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
        this.oreTypes = Object.keys(this.MINE_TYPES);
        this.vehicleLabels = {
            truck: 'Main Truck',
            helicopter: 'Helicopter'
        };
        this.loadVehiclePreference = 'truck';
        this.factoryVehiclePreference = 'truck';

        this.PRODUCTION_TIME = 8 * 60 * 60;
        this.REST_TIME = 4 * 60 * 60;
        this.TRUCK_TRAVEL_TIME = 2 * 60 * 60;
        this.MAX_WORKERS_PER_MINE = 10;
        this.timerConfig = {
            production: this.PRODUCTION_TIME,
            rest: this.REST_TIME,
            truckTravel: this.TRUCK_TRAVEL_TIME
        };
        this.lastTimerUpdate = null;
        this.timerAccumulator = 0;
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
                    <div class="primary-column">
                        <div class="mines-section">
                            <div class="section-header">
                                <h2>Mine Operations</h2>
                                <button id="gm-collect-all-btn" class="collect-all-btn" disabled>Collect All Ready</button>
                            </div>
                            <div class="mines-grid">
                                ${Array.from({ length: MAX_MINES }, (_, index) => `<div class="mine-slot" data-index="${index}"></div>`).join('')}
                            </div>
                        </div>
                    </div>

                    <div class="sidebar">
                        <div class="panel-card mine-management-panel" id="gm-mine-management-panel">
                            <div class="panel-placeholder">Loading mine inventory...</div>
                        </div>

                        <div class="panel-card transport-panel" id="gm-transport-panel">
                            <h3>Transportation</h3>
                            <div class="panel-placeholder">Vehicles will appear after syncing.</div>
                        </div>

                        <div class="panel-card factory-panel" id="gm-factory-panel">
                            <h3>Factory Interface</h3>
                            <div class="panel-placeholder">No ore staged yet.</div>
                        </div>

                        <div class="panel-card redeem-panel">
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

            const fillBtn = target.closest('[data-fill]');
            if (fillBtn) {
                this.handleFillButton(fillBtn);
                return;
            }

            const transportBtn = target.closest('[data-transport-action]');
            if (transportBtn) {
                this.handleTransportAction(transportBtn);
                return;
            }

            const factoryBtn = target.closest('[data-factory-action]');
            if (factoryBtn) {
                this.handleFactoryAction(factoryBtn);
                return;
            }

            const vehicleOption = target.closest('[data-vehicle-option]');
            if (vehicleOption) {
                this.handleVehicleSwitch(vehicleOption);
            }
        });

        const collectAllBtn = container.querySelector('#gm-collect-all-btn');
        if (collectAllBtn) {
            collectAllBtn.addEventListener('click', () => this.collectAllReady());
        }

        container.addEventListener('submit', (event) => {
            if (event.target && event.target.matches('#gm-load-form')) {
                event.preventDefault();
                this.handleLoadFormSubmit(event.target);
            }
        });

    }

    startGameLoop() {
        this.lastTimerUpdate = Date.now();
        this.timerAccumulator = 0;
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
        const now = Date.now();

        if (this.lastTimerUpdate === null) {
            this.lastTimerUpdate = now;
            this.timerAccumulator = 0;
            return;
        }

        const elapsedMs = now - this.lastTimerUpdate;
        this.lastTimerUpdate = now;
        this.timerAccumulator += elapsedMs / 1000; // smooth out interval drift

        const deltaSeconds = Math.floor(this.timerAccumulator);
        if (deltaSeconds <= 0) {
            return;
        }

        this.timerAccumulator -= deltaSeconds;

        this.mines.forEach((mine) => {
            if (!mine) return;

            if (typeof mine.secondsRemaining !== 'number') {
                const base = mine.state === 'resting' ? this.timerConfig.rest : this.timerConfig.production;
                mine.secondsRemaining = base;
            }

            if ((mine.state === 'producing' || mine.state === 'resting') && mine.secondsRemaining > 0) {
                mine.secondsRemaining = Math.max(0, mine.secondsRemaining - deltaSeconds);
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
        this.renderMineManagementPanel();
        this.renderTransportPanel();
        this.renderFactoryPanel();
    }

    renderMineManagementPanel() {
        const panel = this.gameContainer?.querySelector('#gm-mine-management-panel');
        if (!panel) return;

        const entries = this.oreTypes.map((type) => ({
            type,
            amount: Number(this.mineInventory?.[type] || 0)
        }));
        const totalOre = entries.reduce((sum, entry) => sum + entry.amount, 0);
        const maxValue = Math.max(1, ...entries.map((entry) => entry.amount));

        const content = `
            <div class="panel-header">
                <div>
                    <h3>Mine Inventory</h3>
                    <p class="panel-subtitle">${totalOre > 0 ? `${totalOre.toLocaleString()} ore waiting for shipment` : 'Collect ore to start filling crates.'}</p>
                </div>
                <div class="flow-stage-pill">${this.formatStageLabel('mine_inventory')}</div>
            </div>
            <div class="inventory-list">
                ${entries.map((entry) => `
                    <div class="inventory-row">
                        <div class="ore-label">${this.getMineIcon(entry.type)} ${this.getOreLabel(entry.type)}</div>
                        <div class="inventory-bar">
                            <div class="inventory-fill" style="width:${maxValue ? Math.min(100, (entry.amount / maxValue) * 100) : 0}%"></div>
                        </div>
                        <div class="inventory-amount">${entry.amount.toLocaleString()}</div>
                    </div>
                `).join('')}
            </div>
            ${this.renderLoadForm(entries, totalOre)}
        `;

        this.setPanelContent(panel, content);
    }

    renderLoadForm(entries, totalOre) {
        const transportVehicles = this.transport?.vehicles || { truck: {} };
        const vehicles = Object.keys(transportVehicles);
        if (vehicles.length === 0) {
            return '<div class="panel-placeholder">Transport unlocks soon.</div>';
        }

        const oreOptions = entries.map(({ type, amount }) => `
            <option value="${type}">${this.getOreLabel(type)} (${amount.toLocaleString()} available)</option>
        `).join('');
        const vehiclesAtMine = vehicles.filter((vehicleKey) => transportVehicles?.[vehicleKey]?.location === 'mine');
        const hasVehicleAtMine = vehiclesAtMine.length > 0;
        const disableOreControls = totalOre <= 0;
        const disableAction = disableOreControls || !hasVehicleAtMine;
        const preferencePool = hasVehicleAtMine ? vehiclesAtMine : vehicles;
        const activeVehicle = this.resolveVehiclePreference('load', preferencePool);
        const formHint = !hasVehicleAtMine
            ? 'Vehicles must be at the mine before loading.'
            : disableOreControls
                ? 'Collect ore from mines to begin loading crates.'
                : 'Select an ore type and choose a vehicle to load crates.';

        return `
            <form id="gm-load-form" class="inventory-load-form">
                <div class="form-field">
                    <label for="gm-load-ore">Ore Type</label>
                    <select id="gm-load-ore" name="oreType" ${disableOreControls ? 'disabled' : ''}>
                        ${oreOptions}
                    </select>
                </div>
                <div class="form-field">
                    <label>Vehicle</label>
                    ${this.renderVehicleSwitch({
                        id: 'gm-load-vehicle-input',
                        name: 'vehicle',
                        vehicles: preferencePool,
                        context: 'load',
                        disabled: !hasVehicleAtMine,
                        selected: activeVehicle
                    })}
                </div>
                <div class="form-field form-field-inline">
                    <label for="gm-load-amount">Amount</label>
                    <div class="input-with-action">
                        <input type="number" id="gm-load-amount" name="amount" min="1" placeholder="0" ${disableOreControls ? 'disabled' : ''}>
                        <button type="button" class="ghost-btn" data-fill="inventory" ${disableOreControls ? 'disabled' : ''}>Max</button>
                    </div>
                </div>
                <button type="submit" class="primary-btn" ${disableAction ? 'disabled' : ''}>Load Selected Crate</button>
                <p class="form-hint">${formHint}</p>
            </form>
        `;
    }

    renderTransportPanel() {
        const panel = this.gameContainer?.querySelector('#gm-transport-panel');
        if (!panel) return;

        const vehicles = this.transport?.vehicles || {};
        const vehicleKeys = Object.keys(vehicles);

        if (!vehicleKeys.length) {
            this.setPanelContent(panel, `
                <h3>Transportation</h3>
                <div class="panel-placeholder">Unlock a truck to begin deliveries.</div>
            `);
            return;
        }

        const content = `
            <div class="panel-header">
                <div>
                    <h3>Transportation</h3>
                    <p class="panel-subtitle">Crates target ${Number(this.transport?.expectedCrateCoinValue || 10000).toLocaleString()} coins of ore.</p>
                </div>
                <div class="flow-stage-pill">${this.formatStageLabel('vehicle_crates')}</div>
            </div>
            <div class="vehicle-list">
                ${vehicleKeys.map((vehicleKey) => this.renderVehicleCard(vehicleKey, vehicles[vehicleKey])).join('')}
            </div>
        `;

        this.setPanelContent(panel, content);
    }

    renderVehicleCard(vehicleKey, vehicle = {}) {
        const locationMeta = this.getVehicleLocationMeta(vehicle);
        const travel = this.getVehicleTravelProgress(vehicle);
        const hasCargo = this.vehicleHasCargo(vehicle);
        const sendDisabled = !hasCargo || locationMeta.state !== 'mine';
        const returnDisabled = locationMeta.state !== 'factory';
        const cratesHtml = (vehicle.crates || []).map((crate) => this.renderCrateRow(vehicleKey, vehicle, crate, locationMeta)).join('');

        return `
            <div class="vehicle-card" data-vehicle="${vehicleKey}">
                <div class="vehicle-header">
                    <div>
                        <div class="vehicle-name">${this.vehicleLabels[vehicleKey] || this.getTitleCase(vehicleKey)}</div>
                        <div class="vehicle-meta">Crate x${vehicle.crateCapacityMultiplier || 1} • Travel ${this.formatDuration(vehicle.travelTimeSeconds || this.TRUCK_TRAVEL_TIME)}</div>
                    </div>
                    <div class="vehicle-badge ${locationMeta.state}">${locationMeta.label}</div>
                </div>
                ${travel ? `
                    <div class="travel-progress">
                        <div class="travel-label">${locationMeta.travelLabel}</div>
                        <div class="travel-bar">
                            <div class="travel-fill" style="width:${travel.percent}%"></div>
                        </div>
                        <div class="travel-eta">ETA ${this.formatDuration(travel.remainingSeconds)}</div>
                    </div>
                ` : ''}
                <div class="vehicle-crates">
                    ${cratesHtml}
                </div>
                <div class="vehicle-actions">
                    <button type="button" class="primary-btn" data-transport-action="send" data-vehicle="${vehicleKey}" ${sendDisabled ? 'disabled' : ''}>Send to Factory</button>
                    <button type="button" class="secondary-btn" data-transport-action="return" data-vehicle="${vehicleKey}" ${returnDisabled ? 'disabled' : ''}>Return to Mine</button>
                </div>
            </div>
        `;
    }

    renderCrateRow(vehicleKey, vehicle, crate, locationMeta) {
        const capacity = Number(crate.capacity) || 0;
        const amount = Number(crate.amount) || 0;
        const unlimited = crate.unlimited;
        const percent = unlimited
            ? 100
            : capacity > 0
                ? Math.max(0, Math.min(100, (amount / capacity) * 100))
                : 0;
        const canUnloadToFactory = locationMeta.state === 'factory';
        const canUnloadToMine = locationMeta.state === 'mine';
        let unloadButton = '';

        if ((canUnloadToFactory || canUnloadToMine) && amount > 0) {
            const target = canUnloadToFactory ? 'factoryInventory' : 'mineInventory';
            const label = canUnloadToFactory ? 'Unload to Factory' : 'Unload to Mine';
            unloadButton = `
                <button type="button" class="ghost-btn" data-transport-action="unload" data-vehicle="${vehicleKey}" data-target="${target}" data-ore="${crate.type}">${label}</button>
            `;
        }

        return `
            <div class="crate-row">
                <div class="crate-label">${this.getMineIcon(crate.type)} ${this.getOreLabel(crate.type)}</div>
                <div class="crate-bar">
                    <div class="crate-fill ${unlimited ? 'infinite' : ''}" style="width:${percent}%"></div>
                </div>
                <div class="crate-amount">${amount.toLocaleString()}${capacity && !unlimited ? ` / ${capacity.toLocaleString()}` : ''}</div>
                ${unloadButton}
            </div>
        `;
    }

    renderFactoryPanel() {
        const panel = this.gameContainer?.querySelector('#gm-factory-panel');
        if (!panel) return;

        const entries = this.oreTypes.map((type) => ({
            type,
            amount: Number(this.factoryInventory?.[type] || 0),
            coins: this.calculateFactorySaleEstimate(type, Number(this.factoryInventory?.[type] || 0))
        }));

        const totalOre = entries.reduce((sum, entry) => sum + entry.amount, 0);
        const totalCoins = entries.reduce((sum, entry) => sum + entry.coins, 0);
        const historyItems = this.factorySalesHistory.map((sale) => {
            const timestamp = sale?.timestamp ? new Date(sale.timestamp) : new Date();
            const timeLabel = timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const coins = Number(sale?.coins) || 0;
            return `<li><span>${timeLabel}</span><span>${coins.toLocaleString()} coins</span></li>`;
        }).join('');
        const historyHtml = historyItems
            ? `<ul class="history-list">${historyItems}</ul>`
            : '<div class="empty-history">No sales yet.</div>';

        const factoryVehicles = this.getVehiclesAtFactory();

        const subtitleText = totalOre > 0
            ? `${totalCoins.toLocaleString()} coins ready to claim`
            : 'Unload crates at the factory, then sell.';

        const switchDisabled = factoryVehicles.length === 0;
        const vehicleKeys = factoryVehicles.length > 0 ? factoryVehicles.map(({ key }) => key) : ['truck'];
        const activeFactoryVehicle = this.resolveVehiclePreference('factory', vehicleKeys);
        const content = `
            <div class="panel-header">
                <div>
                    <h3>Factory Interface</h3>
                    <p class="panel-subtitle">${subtitleText}</p>
                </div>
                <div class="flow-stage-pill">${this.formatStageLabel('factory_inventory')}</div>
            </div>
            <div class="inventory-list factory-list">
                ${entries.map((entry) => `
                    <div class="inventory-row">
                        <div class="ore-label">${this.getMineIcon(entry.type)} ${this.getOreLabel(entry.type)}</div>
                        <div class="inventory-amount">${entry.amount.toLocaleString()} ore</div>
                        <div class="inventory-amount coins">${entry.coins.toLocaleString()} coins</div>
                    </div>
                `).join('')}
            </div>
            <div class="factory-actions">
                <div class="form-field factory-switch-field">
                    <label>Sell from vehicle</label>
                    ${this.renderVehicleSwitch({
                        id: 'gm-factory-vehicle-input',
                        name: 'factoryVehicle',
                        vehicles: vehicleKeys,
                        context: 'factory',
                        disabled: switchDisabled,
                        selected: activeFactoryVehicle
                    })}
                </div>
                <button type="button" class="primary-btn" data-factory-action="sell" ${totalOre <= 0 ? 'disabled' : ''}>Sell Staged Ore</button>
            </div>
            <div class="factory-history">
                <h4>Recent Sales</h4>
                ${historyHtml}
            </div>
        `;

        this.setPanelContent(panel, content);
    }

    // Minimizes flicker by avoiding unnecessary DOM replacements.
    setPanelContent(panel, html) {
        if (!panel) {
            return;
        }
        const nextContent = typeof html === 'string' ? html : '';
        if (panel.__lastContent === nextContent) {
            return;
        }
        panel.__lastContent = nextContent;
        panel.innerHTML = nextContent;
    }

    renderVehicleSwitch({ id, name, vehicles = [], context = 'load', disabled = false, selected } = {}) {
        if (!vehicles.length) {
            return '';
        }
        const safeSelection = vehicles.includes(selected) ? selected : vehicles[0];
        const buttons = vehicles.map((vehicleKey) => {
            const label = this.vehicleLabels[vehicleKey] || this.getTitleCase(vehicleKey);
            const isActive = vehicleKey === safeSelection;
            return `
                <button type="button"
                        class="switch-option ${isActive ? 'is-active' : ''}"
                        data-vehicle-option
                        data-switch-context="${context}"
                        data-target-input="${id}"
                        data-vehicle-value="${vehicleKey}"
                        ${disabled ? 'disabled' : ''}
                        aria-pressed="${isActive}">${label}</button>
            `;
        }).join('');

        return `
            <div class="vehicle-switch" data-vehicle-switch data-switch-context="${context}" data-target-input="${id}">
                ${buttons}
                <input type="hidden" id="${id}" name="${name}" value="${safeSelection}">
            </div>
        `;
    }

    calculateFactorySaleEstimate(type, amount) {
        const orePerCoin = this.MINE_TYPES?.[type]?.orePerCoin || 1;
        return Math.floor(Math.max(0, Number(amount) || 0) / orePerCoin);
    }

    getVehicleLocationMeta(vehicle = {}) {
        const location = vehicle.location || 'mine';
        if (location === 'factory') {
            return { state: 'factory', label: 'At Factory', travelLabel: null };
        }
        if (location === 'traveling_to_factory') {
            return { state: 'traveling', label: 'Traveling', travelLabel: 'Heading to Factory' };
        }
        if (location === 'traveling_to_mine') {
            return { state: 'traveling', label: 'Returning', travelLabel: 'Heading to Mine' };
        }
        return { state: 'mine', label: 'At Mine', travelLabel: null };
    }

    getVehicleTravelProgress(vehicle = {}) {
        if (!vehicle.departureTime || !vehicle.travelTimeSeconds) {
            return null;
        }
        const departure = new Date(vehicle.departureTime).getTime();
        if (!departure) {
            return null;
        }
        const total = Number(vehicle.travelTimeSeconds) || 1;
        const elapsed = Math.max(0, (Date.now() - departure) / 1000);
        const remainingSeconds = Math.max(0, Math.ceil(total - elapsed));
        const percent = Math.max(0, Math.min(100, (elapsed / total) * 100));
        return { percent, remainingSeconds };
    }

    vehicleHasCargo(vehicle = {}) {
        return (vehicle.crates || []).some((crate) => Number(crate.amount) > 0);
    }

    getVehiclesAtFactory() {
        const vehicles = this.transport?.vehicles || {};
        return Object.entries(vehicles)
            .filter(([, vehicle]) => vehicle?.location === 'factory')
            .map(([key]) => ({ key, label: this.vehicleLabels[key] || this.getTitleCase(key) }));
    }

    getOreLabel(type) {
        const fallback = type ? type.charAt(0).toUpperCase() + type.slice(1) : 'Unknown';
        return this.MINE_TYPES?.[type]?.name || fallback;
    }

    formatStageLabel(stageKey) {
        const mapping = {
            mine_inventory: 'Stage 1 · Mine Inventory',
            vehicle_crates: 'Stage 2 · Vehicle Crates',
            factory_inventory: 'Stage 3 · Factory Staging'
        };
        return mapping[stageKey] || 'Production Flow';
    }

    getTitleCase(value = '') {
        return value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
    }

    resolveVehiclePreference(context, vehicles = []) {
        if (!vehicles.length) {
            return 'truck';
        }
        const key = context === 'factory' ? 'factoryVehiclePreference' : 'loadVehiclePreference';
        let preferred = this[key];
        if (!vehicles.includes(preferred)) {
            preferred = vehicles[0];
        }
        this[key] = preferred;
        return preferred;
    }

    handleFillButton(button) {
        const form = button.closest('form');
        if (!form) return;
        if (button.dataset.fill === 'inventory') {
            const oreSelect = form.querySelector('select[name="oreType"]');
            const amountInput = form.querySelector('input[name="amount"]');
            if (!oreSelect || !amountInput) return;
            const oreType = oreSelect.value;
            const available = Number(this.mineInventory?.[oreType] || 0);
            amountInput.value = available > 0 ? available : '';
        }
    }

    handleLoadFormSubmit(form) {
        const oreType = form.oreType?.value;
        const amount = Number(form.amount?.value || 0);
        const vehicleInput = form.querySelector('input[name="vehicle"]');
        const vehicle = vehicleInput?.value || this.loadVehiclePreference || 'truck';

        if (!oreType || amount <= 0) {
            this.showMessage('Enter a valid ore amount first.', 'error');
            return;
        }

        const vehicleState = this.transport?.vehicles?.[vehicle];
        if (!vehicleState) {
            this.showMessage('Selected vehicle is unavailable.', 'error');
            return;
        }

        if (vehicleState.location !== 'mine') {
            this.showMessage('Vehicle must be at the mine to load ore.', 'error');
            return;
        }

        this.loadTruck(oreType, amount, vehicle);
    }

    handleTransportAction(button) {
        const action = button.dataset.transportAction;
        const vehicle = button.dataset.vehicle || 'truck';
        if (!action) return;

        if (action === 'send') {
            this.sendTruck(vehicle);
            return;
        }

        if (action === 'return') {
            this.returnTruck(vehicle);
            return;
        }

        if (action === 'unload') {
            const oreType = button.dataset.ore;
            const target = button.dataset.target;
            if (!oreType || !target) return;
            this.unloadVehicleCrate({ vehicleKind: vehicle, oreType, targetInventory: target });
        }
    }

    handleFactoryAction(button) {
        const action = button.dataset.factoryAction;
        if (action !== 'sell') {
            return;
        }
        const input = this.gameContainer?.querySelector('#gm-factory-vehicle-input');
        const vehicle = input?.value || this.factoryVehiclePreference || 'truck';
        this.sellOre(vehicle);
    }

    handleVehicleSwitch(button) {
        if (!button || button.disabled) {
            return;
        }
        const container = button.closest('[data-vehicle-switch]');
        if (!container) {
            return;
        }
        const value = button.dataset.vehicleValue;
        if (!value) {
            return;
        }
        const inputId = container.dataset.targetInput;
        const hiddenInput = inputId ? container.querySelector(`#${inputId}`) : container.querySelector('input[type="hidden"]');
        if (hiddenInput) {
            hiddenInput.value = value;
        }
        container.querySelectorAll('[data-vehicle-option]').forEach((option) => {
            const isActive = option === button;
            option.classList.toggle('is-active', isActive);
            option.setAttribute('aria-pressed', String(isActive));
        });
        const context = container.dataset.switchContext || 'load';
        if (context === 'factory') {
            this.factoryVehiclePreference = value;
        } else {
            this.loadVehiclePreference = value;
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
        this.mineInventory = this.normalizeResourceMap(data.mineInventory || data.inventory || {});
        this.factoryInventory = this.normalizeResourceMap(data.factoryInventory || {});
        this.transport = data.transport || { vehicles: {} };
        if (data.productionFlow) {
            this.productionFlow = data.productionFlow;
        }
        if (Array.isArray(data.factorySalesHistory)) {
            this.factorySalesHistory = data.factorySalesHistory;
        }
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

        this.lastTimerUpdate = Date.now();
        this.timerAccumulator = 0;
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
        this.loadTruck(type, Number(amount) || 0, 'truck');
    }

    async loadTruck(oreType, amount, vehicle = 'truck') {
        try {
            const username = window.authManager?.currentUser?.username;
            if (!username) return;

            const response = await fetch('/api/golden-mine/load_truck', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, oreType, amount, vehicle })
            });

            const result = await response.json();
            if (response.ok && result.success) {
                await this.loadGameData({ silent: true });
                this.showMessage('Ore loaded into vehicle!', 'success');
                return;
            }

            this.showMessage(result.error || 'Failed to load truck', 'error');
        } catch (error) {
            console.error('Load truck error:', error);
            this.showMessage('Failed to load truck', 'error');
        }
    }

    async unloadVehicleCrate({ vehicleKind = 'truck', oreType, targetInventory }) {
        try {
            const username = window.authManager?.currentUser?.username;
            if (!username) return;

            const response = await fetch('/api/golden-mine/unload_vehicle', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, vehicle: vehicleKind, oreType, target: targetInventory })
            });

            const result = await response.json();
            if (response.ok && result.success) {
                await this.loadGameData({ silent: true });
                this.showMessage('Crate unloaded successfully!', 'success');
                return;
            }

            this.showMessage(result.error || 'Failed to unload vehicle', 'error');
        } catch (error) {
            console.error('Unload vehicle error:', error);
            this.showMessage('Failed to unload vehicle', 'error');
        }
    }

    async sendTruck(vehicle = 'truck') {
        try {
            const username = window.authManager?.currentUser?.username;
            if (!username) return;

            const response = await fetch('/api/golden-mine/send_truck', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, vehicle })
            });

            const result = await response.json();
            if (response.ok && result.success) {
                await this.loadGameData({ silent: true });
                this.showMessage('Vehicle sent to factory!', 'success');
                return;
            }

            this.showMessage(result.error || 'Failed to send truck', 'error');
        } catch (error) {
            console.error('Send truck error:', error);
            this.showMessage('Failed to send truck', 'error');
        }
    }

    async sellOre(vehicle = 'truck') {
        try {
            const username = window.authManager?.currentUser?.username;
            if (!username) return;

            const response = await fetch('/api/golden-mine/sell_ore', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, vehicle })
            });

            const result = await response.json();
            if (response.ok && result.success) {
                this.coins = result.newCoins;
                await this.loadGameData({ silent: true });
                this.recordFactorySale(result);
                this.showMessage(`Ore sold for ${result.coinsEarned.toLocaleString()} coins!`, 'success');
                return;
            }

            this.showMessage(result.error || 'Failed to sell ore', 'error');
        } catch (error) {
            console.error('Sell ore error:', error);
            this.showMessage('Failed to sell ore', 'error');
        }
    }

    async returnTruck(vehicle = 'truck') {
        try {
            const username = window.authManager?.currentUser?.username;
            if (!username) return;

            const response = await fetch('/api/golden-mine/return_truck', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, vehicle })
            });

            const result = await response.json();
            if (response.ok && result.success) {
                await this.loadGameData({ silent: true });
                this.showMessage('Vehicle returning to mine!', 'success');
                return;
            }

            this.showMessage(result.error || 'Failed to return truck', 'error');
        } catch (error) {
            console.error('Return truck error:', error);
            this.showMessage('Failed to return truck', 'error');
        }
    }

    recordFactorySale(result = {}) {
        const coinsEarned = Number(result?.coinsEarned) || 0;
        if (coinsEarned <= 0) {
            return;
        }
        const entry = {
            coins: coinsEarned,
            timestamp: Date.now()
        };
        this.factorySalesHistory = [entry, ...this.factorySalesHistory].slice(0, 5);
    }

    showMessage(message, type = 'info') {
        if (window.toastManager) {
            window.toastManager.show(message, type);
            return;
        }

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
