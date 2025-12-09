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
        
        this.transportation = null;
        this.activeVehicle = 'truck';
        this.vehicleOrder = ['truck', 'helicopter'];
        this.vehicleMeta = {
            truck: { icon: '🚚', label: 'Truck' },
            helicopter: { icon: '🚁', label: 'Helicopter' }
        };

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

    normalizeTransportationPayload(payload) {
        if (!payload || !payload.vehicles) {
            return null;
        }
        const normalized = {
            ...payload,
            vehicles: {}
        };
        Object.entries(payload.vehicles).forEach(([vehicle, data]) => {
            normalized.vehicles[vehicle] = {
                ...data,
                departureTime: data?.departureTime ? new Date(data.departureTime) : null,
                eggCrates: { ...(data?.eggCrates || {}) },
                birdCage: {
                    total: data?.birdCage?.total || 0,
                    birds: { ...(data?.birdCage?.birds || {}) }
                }
            };
        });
        return normalized;
    }

    updateTransportationState(payload) {
        if (!payload) {
            return;
        }
        this.transportation = this.normalizeTransportationPayload(payload);
        this.ensureActiveVehicleAvailable();
        const truck = this.transportation?.vehicles?.truck;
        if (truck) {
            this.truckLocation = truck.location || this.truckLocation;
            this.truckDepartureTime = truck.departureTime || null;
            this.truckInventory = { ...(truck.eggCrates || {}) };
        }
    }

    ensureActiveVehicleAvailable() {
        if (this.transportation?.vehicles?.[this.activeVehicle]?.available) {
            return;
        }
        const fallback = this.vehicleOrder.find((vehicle) => this.transportation?.vehicles?.[vehicle]?.available);
        if (fallback) {
            this.activeVehicle = fallback;
        }
    }

    getVehicleData(vehicle = this.activeVehicle) {
        return this.transportation?.vehicles?.[vehicle] || null;
    }

    getActiveVehicle() {
        return this.activeVehicle;
    }

    setActiveVehicle(vehicle) {
        if (!this.transportation?.vehicles?.[vehicle]?.available) {
            this.showGameMessage('Vehicle is locked. Unlock it in the LPA shop first.', 'info');
            return;
        }
        this.activeVehicle = vehicle;
        this.renderTransportationPanel();
    }

    formatVehicleLocation(location) {
        const map = {
            farm: 'Farm',
            city: 'City',
            traveling_to_city: 'Traveling → City',
            traveling_to_farm: 'Traveling → Farm'
        };
        return map[location] || 'Unknown';
    }

    formatNumber(value) {
        return new Intl.NumberFormat().format(Math.floor(value || 0));
    }

    formatPercent(value) {
        if (!Number.isFinite(value)) return '—';
        return `${Math.round(value)}%`;
    }

    formatBirdLabel(color) {
        return this.BIRDS[color]?.label || color;
    }

    getTotalFarmBirds() {
        return Object.values(this.birds || {}).reduce((sum, count) => sum + (Number(count) || 0), 0);
    }

    getTotalCagedBirds() {
        if (!this.transportation?.vehicles) return 0;
        return this.vehicleOrder.reduce((sum, vehicle) => {
            const cage = this.transportation.vehicles[vehicle]?.birdCage;
            return sum + (cage?.total || 0);
        }, 0);
    }

    getVehicleTimerLabel(vehicleData) {
        if (!vehicleData) return 'Unknown';
        if (vehicleData.location === 'farm' || vehicleData.location === 'city') {
            return 'Idle';
        }
        if (!vehicleData.departureTime || !vehicleData.travelTimeMs) {
            return 'Traveling…';
        }
        const elapsed = Date.now() - vehicleData.departureTime.getTime();
        const remaining = Math.max(0, vehicleData.travelTimeMs - elapsed);
        if (remaining <= 0) {
            return 'Arriving…';
        }
        const mins = Math.floor(remaining / 60000);
        const secs = Math.max(0, Math.floor((remaining % 60000) / 1000));
        const minPart = mins > 0 ? `${mins}m ` : '';
        return `${minPart}${secs}s left`;
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
                if (data.transportation) {
                    this.updateTransportationState(data.transportation);
                }
                if (this.transportation?.vehicles?.truck) {
                    const truck = this.transportation.vehicles.truck;
                    this.truckLocation = truck.location || this.truckLocation;
                    this.truckDepartureTime = truck.departureTime || null;
                    this.truckInventory = { ...(truck.eggCrates || {}) };
                } else {
                    this.truckLocation = data.truckLocation || this.truckLocation;
                    this.truckDepartureTime = data.truckDepartureTime ? new Date(data.truckDepartureTime) : null;
                    this.truckInventory = data.truckInventory || {};
                }

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
                if (data.transportation) {
                    this.updateTransportationState(data.transportation);
                }

                const truck = this.transportation?.vehicles?.truck;
                this.truckLocation = truck?.location || data.truckLocation || 'farm';
                this.truckDepartureTime = truck?.departureTime || (data.truckDepartureTime ? new Date(data.truckDepartureTime) : null);
                this.truckInventory = { ...(truck?.eggCrates || data.truckInventory || {}) };
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
        const totalBirds = this.getTotalFarmBirds() + this.getTotalCagedBirds();
        const activeVehicleData = this.getVehicleData();
        if (totalBirds > 0 && activeVehicleData && activeVehicleData.location !== 'city') {
            this.showGameMessage(`${this.vehicleMeta[this.activeVehicle]?.label || 'Vehicle'} must be at city to buy birds!`, 'error');
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
                body: JSON.stringify({ username, color, vehicle: this.getActiveVehicle() })
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
    async loadVehicle() {
        const totalEggs = Object.values(this.eggs).reduce((sum, amount) => sum + amount, 0);
        if (totalEggs === 0) {
            this.showGameMessage('No eggs to load into the vehicle!', 'info');
            return;
        }

        const loads = Object.entries(this.eggs)
            .map(([color, amount]) => ({ color, amount }))
            .filter((entry) => entry.amount > 0);

        if (loads.length === 0) {
            this.showGameMessage('No eggs to load into the vehicle!', 'info');
            return;
        }

        try {
            const summary = await this.loadVehicleBatch(loads, { silent: true });
            const loadedTotal = (summary || [])
                .filter((item) => item?.success)
                .reduce((sum, item) => sum + (item.loaded || 0), 0);

            if (loadedTotal > 0) {
                this.showGameMessage(`Loaded ${this.formatNumber(loadedTotal)} eggs into ${this.vehicleMeta[this.activeVehicle]?.label || 'vehicle'}!`, 'success');
                setTimeout(() => this.refreshGameStatus(), 1000);
            } else {
                const firstError = (summary || []).find((item) => item?.error)?.error;
                this.showGameMessage(firstError || 'No eggs were loaded', 'info');
            }
        } catch (error) {
            console.error('Load vehicle error:', error);
            this.showGameMessage('Failed to load eggs into vehicle', 'error');
        }
    }

    // Load specific color eggs into truck
    async loadVehicleEggs(color, amount, options = {}) {
        return this.loadVehicleBatch([{ color, amount }], options);
    }

    async loadVehicleBatch(loads, options = {}) {
        const { silent = false } = options;
        try {
            const username = window.authManager?.currentUser?.username;
            if (!username) {
                this.showGameMessage('Please log in to load eggs', 'error');
                return false;
            }

            const payloadLoads = (loads || [])
                .map(({ color, amount }) => ({ color, amount }))
                .filter((entry) => entry.color && Number(entry.amount) > 0);

            if (payloadLoads.length === 0) {
                this.showGameMessage('Select eggs to load', 'info');
                return false;
            }

            const response = await fetch('/api/game/transport/load-eggs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, vehicle: this.getActiveVehicle(), loads: payloadLoads })
            });

            const data = await response.json();
            if (data.success) {
                this.eggs = data.eggs;
                this.truckInventory = data.truckInventory || {};
                if (data.transportation) {
                    this.updateTransportationState(data.transportation);
                }
                this.updateUI();
                if (!silent) {
                    const loadedTotal = (data.loadResults || [])
                        .filter((item) => item.success)
                        .reduce((sum, item) => sum + (item.loaded || 0), 0);
                    if (loadedTotal > 0) {
                        this.showGameMessage(`Loaded ${this.formatNumber(loadedTotal)} eggs into ${this.vehicleMeta[this.activeVehicle]?.label || 'vehicle'}!`, 'success');
                    } else {
                        const firstError = (data.loadResults || []).find((item) => item?.error)?.error;
                        this.showGameMessage(firstError || 'No eggs were loaded', 'info');
                    }
                }
                return data.loadResults || true;
            }

            this.showGameMessage(data.error || 'Failed to load eggs into vehicle', 'error');
            return false;
        } catch (error) {
            console.error('Load vehicle eggs error:', error);
            this.showGameMessage('Failed to load eggs into vehicle', 'error');
            return false;
        }
    }

    // Truck actions
    async truckGoToCity() {
        return this.sendVehicle('to_city');
    }

    async sellTruckEggs() {
        return this.sellVehicleEggs();
    }

    async releaseBirdsFromVehicle() {
        const vehicle = this.getActiveVehicle();
        const vehicleData = this.getVehicleData(vehicle);
        if (!vehicleData) {
            this.showGameMessage('Transportation data missing. Try refreshing.', 'error');
            return;
        }
        if (vehicleData.location !== 'farm') {
            this.showGameMessage('Vehicle must be at farm to release birds!', 'error');
            return;
        }
        if ((vehicleData.birdCage?.total || 0) === 0) {
            this.showGameMessage('No birds waiting in the cage.', 'info');
            return;
        }

        try {
            const username = window.authManager?.currentUser?.username;
            if (!username) return;

            const response = await fetch('/api/game/transport/unload-birds', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, vehicle })
            });

            const data = await response.json();
            if (data.success) {
                this.birds = data.birds;
                if (data.transportation) {
                    this.updateTransportationState(data.transportation);
                }
                this.updateUI();
                this.showGameMessage('Birds released to the farm!', 'success');
                setTimeout(() => this.refreshGameStatus(), 1000);
            } else {
                this.showGameMessage(data.error || 'Failed to release birds', 'error');
            }
        } catch (error) {
            console.error('Release birds error:', error);
            this.showGameMessage('Failed to release birds', 'error');
        }
    }

    async sendVehicle(direction) {
        const vehicle = this.getActiveVehicle();
        const vehicleLabel = this.vehicleMeta[vehicle]?.label || 'Vehicle';
        const vehicleData = this.getVehicleData(vehicle);
        if (!vehicleData) {
            this.showGameMessage('Transportation data missing. Try refreshing.', 'error');
            return;
        }

        if (direction === 'to_city' && vehicleData.location !== 'farm') {
            this.showGameMessage(`${vehicleLabel} must be at farm to depart.`, 'error');
            return;
        }

        if (direction === 'to_farm' && vehicleData.location !== 'city') {
            this.showGameMessage(`${vehicleLabel} must be at city to return.`, 'error');
            return;
        }

        try {
            const username = window.authManager?.currentUser?.username;
            if (!username) return;

            const response = await fetch('/api/game/transport/travel', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, vehicle, direction })
            });

            const data = await response.json();
            if (data.success) {
                if (data.transportation) {
                    this.updateTransportationState(data.transportation);
                }
                this.updateUI();
                const message = direction === 'to_city' ? `${vehicleLabel} departed for the city!` : `${vehicleLabel} is heading back to the farm!`;
                this.showGameMessage(message, 'info');
                setTimeout(() => this.refreshGameStatus(), 1000);
            } else {
                this.showGameMessage(data.error || 'Failed to start travel', 'error');
            }
        } catch (error) {
            console.error('Vehicle travel error:', error);
            this.showGameMessage('Failed to start travel', 'error');
        }
    }

    async sellVehicleEggs() {
        const vehicle = this.getActiveVehicle();
        const vehicleLabel = this.vehicleMeta[vehicle]?.label || 'Vehicle';
        const vehicleData = this.getVehicleData(vehicle);
        if (!vehicleData) {
            this.showGameMessage('Transportation data missing. Try refreshing.', 'error');
            return;
        }
        if (vehicleData.location !== 'city') {
            this.showGameMessage(`${vehicleLabel} must be at city to sell eggs!`, 'error');
            return;
        }

        const totalEggs = Object.values(vehicleData.eggCrates || {}).reduce((sum, amount) => sum + amount, 0);
        if (totalEggs === 0) {
            this.showGameMessage('No eggs loaded in this vehicle.', 'info');
            return;
        }

        try {
            const username = window.authManager?.currentUser?.username;
            if (!username) return;

            const response = await fetch('/api/game/sell_truck_eggs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, vehicle })
            });

            const data = await response.json();
            if (data.success) {
                this.coins = data.coins;
                this.truckInventory = data.truckInventory || {};
                if (data.transportation) {
                    this.updateTransportationState(data.transportation);
                }
                this.updateUI();
                this.showGameMessage(`Sold for ${this.formatNumber(data.soldFor || 0)} coins!`, 'success');
                setTimeout(() => this.refreshGameStatus(), 1000);
            } else {
                this.showGameMessage(data.error || 'Failed to sell eggs', 'error');
            }
        } catch (error) {
            console.error('Sell vehicle eggs error:', error);
            this.showGameMessage('Failed to sell eggs', 'error');
        }
    }

    async truckGoToFarm() {
        return this.sendVehicle('to_farm');
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

                <!-- Управление -->
                <div class="game-controls">
                    <button id="hb-collect-btn" class="control-btn collect">Collect Eggs</button>
                    <button id="hb-load-vehicle-btn" class="control-btn sell">Load Vehicle</button>
                </div>

                <!-- Logistics Panel -->
                <div class="logistics-section">
                    <div class="section-header">
                        <h3>🚚 Transportation & Storage</h3>
                        <p class="section-subtitle">Manage egg crates, bird cages, and travel for each vehicle.</p>
                    </div>
                    <div id="hb-transportation-panel" class="transportation-panel">
                        <div class="transportation-empty">Loading transportation data…</div>
                    </div>
                </div>

                <div class="farm-limits-section">
                    <h3>🏡 Farm Population</h3>
                    <div id="hb-farm-limits-panel" class="farm-limits-panel">
                        <div class="farm-limits-empty">Farm limits will appear once transportation data loads.</div>
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
        const loadLabel = this.vehicleMeta[this.activeVehicle]?.label || 'Vehicle';

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
                    <button class="hb-load-vehicle-btn" data-color="${color}">
                        Load ${loadLabel}
                    </button>
                `;

                eggsGrid.appendChild(eggCard);
            }
        }
    }

    renderTransportationPanel() {
        const panel = document.getElementById('hb-transportation-panel');
        if (!panel) return;

        if (!this.transportation) {
            panel.innerHTML = '<div class="transportation-empty">Transportation data will appear after the first status sync.</div>';
            return;
        }

        const buttons = this.vehicleOrder.map((vehicle) => {
            const meta = this.vehicleMeta[vehicle];
            const vehicleData = this.transportation.vehicles[vehicle];
            const locked = !vehicleData?.available;
            const activeClass = vehicle === this.activeVehicle ? 'active' : '';
            const lockedClass = locked ? 'locked' : '';
            return `
                <button class="vehicle-button ${activeClass} ${lockedClass}" data-vehicle-select="${vehicle}" ${locked ? 'disabled' : ''}>
                    <span class="vehicle-icon">${meta.icon}</span>
                    <span class="vehicle-label">${meta.label}</span>
                    ${locked ? '<span class="vehicle-locked">Locked</span>' : ''}
                </button>
            `;
        }).join('');

        const activeVehicleData = this.getVehicleData(this.activeVehicle);
        if (!activeVehicleData) {
            panel.innerHTML = `<div class="transportation-empty">Select an available vehicle to manage logistics.</div><div class="vehicle-selector">${buttons}</div>`;
            return;
        }

        const locationLabel = this.formatVehicleLocation(activeVehicleData.location);
        const timerLabel = this.getVehicleTimerLabel(activeVehicleData);
        const cageCapacity = activeVehicleData.birdCageCapacity;
        const cageTotal = activeVehicleData.birdCage?.total || 0;
        const cagePercent = Number.isFinite(cageCapacity) && cageCapacity > 0 ? Math.min(100, (cageTotal / cageCapacity) * 100) : 0;
        const cageCapacityLabel = Number.isFinite(cageCapacity) ? `${this.formatNumber(cageTotal)} / ${this.formatNumber(cageCapacity)}` : `${this.formatNumber(cageTotal)} / ∞`;
        const cageRows = Object.keys(this.BIRDS).map((color) => {
            const count = activeVehicleData.birdCage?.birds?.[color] || 0;
            if (!count) return '';
            return `<li><span>${this.formatBirdLabel(color)}</span><span>${count}</span></li>`;
        }).filter(Boolean).join('') || '<li class="muted">No birds waiting in cage.</li>';

        const crateCards = Object.keys(this.BIRDS).map((color) => {
            const bird = this.BIRDS[color];
            const amount = activeVehicleData.eggCrates?.[color] || 0;
            const max = activeVehicleData.crateCapacity?.[color];
            const percent = Number.isFinite(max) && max > 0 ? Math.min(100, (amount / max) * 100) : 0;
            const valueCoins = Math.floor(amount / bird.eggsPerCoin);
            return `
                <div class="crate-card" data-color="${color}">
                    <div class="crate-header">
                        <span>${bird.label} Eggs</span>
                        <span>${this.formatNumber(amount)} / ${Number.isFinite(max) ? this.formatNumber(max) : '∞'}</span>
                    </div>
                    <div class="progress-bar">
                        <div class="progress-fill" style="width: ${percent}%;"></div>
                    </div>
                    <div class="crate-value">Value: ${this.formatNumber(valueCoins)} coins</div>
                </div>
            `;
        }).join('');

        const helicopterLockedBanner = !this.transportation.vehicles?.helicopter?.available
            ? '<div class="helicopter-locked-banner">Unlock the helicopter in the LPA Shop (10,000 LPA) to gain 5× capacity and 5-minute flights.</div>'
            : '';

        const atFarm = activeVehicleData.location === 'farm';
        const atCity = activeVehicleData.location === 'city';
        const traveling = activeVehicleData.location?.startsWith('traveling');
        const cageHasBirds = cageTotal > 0;
        const cratesHaveEggs = Object.values(activeVehicleData.eggCrates || {}).some((value) => value > 0);

        panel.innerHTML = `
            ${helicopterLockedBanner}
            <div class="vehicle-selector">${buttons}</div>
            <div class="vehicle-status-card">
                <div>
                    <p class="vehicle-status-title">${this.vehicleMeta[this.activeVehicle].icon} ${this.vehicleMeta[this.activeVehicle].label}</p>
                    <p class="vehicle-location">${locationLabel}</p>
                </div>
                <div class="vehicle-timer">${timerLabel}</div>
            </div>
            <div class="transport-grid">
                <div class="transport-card">
                    <div class="transport-card-header">
                        <h4>Egg Crates</h4>
                        <span>${cratesHaveEggs ? 'Loaded' : 'Empty'}</span>
                    </div>
                    <div class="crate-grid">
                        ${crateCards}
                    </div>
                </div>
                <div class="transport-card">
                    <div class="transport-card-header">
                        <h4>Bird Cage</h4>
                        <span>${cageCapacityLabel}${Number.isFinite(cageCapacity) ? '' : ''}</span>
                    </div>
                    <div class="progress-bar">
                        <div class="progress-fill" style="width: ${cagePercent}%;"></div>
                    </div>
                    <ul class="cage-list">${cageRows}</ul>
                </div>
            </div>
            <div class="transport-actions">
                <button class="transport-action" data-transport-action="release" ${(!atFarm || !cageHasBirds || traveling) ? 'disabled' : ''}>Release Birds</button>
                <button class="transport-action" data-transport-action="to_city" ${(atFarm && !traveling) ? '' : 'disabled'}>Send to City</button>
                <button class="transport-action" data-transport-action="sell" ${(!atCity || !cratesHaveEggs || traveling) ? 'disabled' : ''}>Sell at City</button>
                <button class="transport-action" data-transport-action="to_farm" ${(atCity && !traveling) ? '' : 'disabled'}>Return to Farm</button>
            </div>
        `;
    }

    renderFarmLimitsPanel() {
        const panel = document.getElementById('hb-farm-limits-panel');
        if (!panel) return;

        if (!this.transportation?.farmLimits) {
            panel.innerHTML = '<div class="farm-limits-empty">Farm population will appear here once data syncs.</div>';
            return;
        }

        if (this.transportation?.upgrades?.noBirdLimit) {
            panel.innerHTML = '<div class="farm-limits-unlimited">🎉 Unlimited Birds unlocked! No population caps apply.</div>';
            return;
        }

        const cards = Object.entries(this.transportation.farmLimits).map(([color, info]) => {
            const current = info.current || 0;
            const limit = info.limit || 0;
            const percent = limit > 0 ? Math.min(100, (current / limit) * 100) : 0;
            const warning = percent >= 90;
            return `
                <div class="farm-limit-card" data-color="${color}">
                    <div class="farm-limit-header">
                        <span>${this.formatBirdLabel(color)}</span>
                        <span>${current}/${limit || '∞'}</span>
                    </div>
                    <div class="progress-bar">
                        <div class="progress-fill ${warning ? 'warning' : ''}" style="width: ${percent}%;"></div>
                    </div>
                    ${warning ? '<div class="limit-warning">⚠️ Near limit</div>' : ''}
                </div>
            `;
        }).join('');

        panel.innerHTML = `<div class="farm-limit-grid">${cards}</div>`;
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

        const loadVehicleBtn = document.getElementById('hb-load-vehicle-btn');
        if (loadVehicleBtn) {
            const label = this.vehicleMeta[this.activeVehicle]?.label || 'Vehicle';
            loadVehicleBtn.textContent = `Load ${label}`;
            loadVehicleBtn.disabled = !this.transportation?.vehicles?.[this.activeVehicle]?.available;
        }

        this.renderBirdsGrid();
        this.renderEggsGrid();
        this.renderTransportationPanel();
        this.renderFarmLimitsPanel();
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

        const loadVehicleBtn = document.getElementById('hb-load-vehicle-btn');
        if (loadVehicleBtn) {
            loadVehicleBtn.addEventListener('click', () => {
                this.loadVehicle();
            });
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
                if (e.target.classList.contains('hb-load-vehicle-btn')) {
                    const color = e.target.dataset.color;
                    const amount = this.eggs[color] || 0;
                    if (amount > 0) {
                        if (this.consoleMessages) console.log(`🚚 Load vehicle button clicked for ${color}, amount: ${amount}`);
                        this.loadVehicleEggs(color, amount);
                    } else {
                        this.showGameMessage(`No ${color} eggs to load!`, 'error');
                    }
                }
            });
        }

        this.bindTransportationEvents();
    }

    bindTransportationEvents() {
        const panel = document.getElementById('hb-transportation-panel');
        if (!panel) return;
        panel.addEventListener('click', (event) => {
            const vehicleButton = event.target.closest('[data-vehicle-select]');
            if (vehicleButton) {
                const vehicle = vehicleButton.dataset.vehicleSelect;
                this.setActiveVehicle(vehicle);
                this.updateUI();
                return;
            }

            const actionButton = event.target.closest('[data-transport-action]');
            if (actionButton) {
                const action = actionButton.dataset.transportAction;
                this.handleTransportAction(action);
            }
        });
    }

    handleTransportAction(action) {
        switch (action) {
            case 'release':
                this.releaseBirdsFromVehicle();
                break;
            case 'to_city':
                this.sendVehicle('to_city');
                break;
            case 'sell':
                this.sellVehicleEggs();
                break;
            case 'to_farm':
                this.sendVehicle('to_farm');
                break;
            default:
                break;
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