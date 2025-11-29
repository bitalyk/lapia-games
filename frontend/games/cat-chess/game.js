export default class CatChessGame {
    constructor() {
        this.isRunning = false;
        this.gameContainer = null;
        this.coins = 0;
        this.specialCurrency = 0;
        this.board = Array(64).fill(null);
        this.unlockedLevels = [1];
        this.specialInventory = [];
        this.redeemedCodes = [];
        this.gameManager = null;
        this.gameLoopInterval = null;
        this.statusRefreshInterval = null;
        this.messageTimeout = null;
        this.consoleMessages = true;
        this.GROWTH_TIME_SEC = 12 * 60 * 60; // Will be updated by loadConfig
        this.config = {}; // Will be loaded from server
        this.draggedCat = null;
        this.draggedFromIndex = null;

        // Cat level configuration (same as backend)
        this.CAT_LEVELS = {};
        this.SPECIAL_BASE_VALUES = {
            common: 100,
            rare: 250,
            epic: 750,
            legendary: 2000
        };
        this.SPECIAL_TYPE_MODIFIERS = {
            tabby: 1,
            siamese: 1.1,
            persian: 1.25,
            maine_coon: 1.5,
            bengal: 1.75
        };
        const TIERS = [
            { levels: [1,10], baseCost: 1000, multiplierIncrement: 0.1, startMultiplier: 1.0 },
            { levels: [11,20], baseCost: 1250, multiplierIncrement: 0.33, startMultiplier: 2.0 },
            { levels: [21,30], baseCost: 2000, multiplierIncrement: 0.55, startMultiplier: 5.0 },
            { levels: [31,40], baseCost: 2500, multiplierIncrement: 1.0, startMultiplier: 10.0 },
            { levels: [41,50], baseCost: 5000, multiplierIncrement: 3.33, startMultiplier: 20.0 },
            { levels: [51,51], baseCost: 0, multiplierIncrement: 0, startMultiplier: 50.0 }
        ];

        TIERS.forEach(tier => {
            for (let level = tier.levels[0]; level <= tier.levels[1]; level++) {
                const multiplier = tier.startMultiplier + (level - tier.levels[0]) * tier.multiplierIncrement;
                this.CAT_LEVELS[level] = {
                    cost: Math.round(tier.baseCost * multiplier),
                    multiplier: multiplier,
                    sellPrice: Math.round(tier.baseCost * multiplier * 2)
                };
            }
        });
    }

    // Set game manager
    setGameManager(gameManager) {
        this.gameManager = gameManager;
        if (this.consoleMessages) console.log('🎮 Game Manager set for Cat Chess');
    }

    // Resolve active username from auth systems
    getCurrentUsername() {
        return window.authManager?.currentUser?.username
            || this.gameManager?.currentUser?.username
            || null;
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
                    this.GROWTH_TIME_SEC = 30; // 30 seconds for testing
                } else {
                    this.GROWTH_TIME_SEC = 12 * 60 * 60; // 12 hours normal
                }
            } else {
                this.config = { enableRedeem: true, showRestartButton: true, consoleMessages: true, fastMode: false };
                this.GROWTH_TIME_SEC = 12 * 60 * 60;
                if (this.consoleMessages) console.log('⚠️ Failed to load config, using defaults');
            }
        } catch (error) {
            this.config = { enableRedeem: true, showRestartButton: true, consoleMessages: true, fastMode: false };
            this.GROWTH_TIME_SEC = 12 * 60 * 60;
            if (this.consoleMessages) console.log('⚠️ Error loading config:', error);
        }
    }

    // Start game
    async start() {
        if (this.consoleMessages) console.log('🐱 Starting Cat Chess...');
        this.isRunning = true;

        await this.loadConfig();
        await this.loadGameTemplate();
        await this.loadGameData();
        this.initGame();
        this.bindGameEvents();
        this.startGameLoop();
        this.startStatusRefresh();

        this.showGameMessage('Cat Chess loaded successfully!', 'success');
        if (this.consoleMessages) console.log('✅ Cat Chess started successfully');
    }

    // Stop game
    stop() {
        if (this.consoleMessages) console.log('🐱 Stopping Cat Chess...');
        this.isRunning = false;
        if (this.gameLoopInterval) {
            clearInterval(this.gameLoopInterval);
        }
        if (this.statusRefreshInterval) {
            clearInterval(this.statusRefreshInterval);
        }
        this.unbindGameEvents();
    }

    // Load game template
    async loadGameTemplate() {
        const gameArea = document.getElementById('game-area');
        if (!gameArea) {
            throw new Error('Game area not found');
        }

        gameArea.innerHTML = `
            <link rel="stylesheet" href="./games/cat-chess/style.css">
            <div class="cat-chess-game">
                <div class="game-header">
                    <h2>🐱 Cat Chess</h2>
                    <button id="cc-back-btn" class="back-button">← Menu</button>
                </div>

                <!-- Статистика -->
                <div class="game-stats">
                    <div class="stat-card">
                        <h3>Coins</h3>
                        <div id="cc-coins" class="stat-value">0</div>
                    </div>
                    <div class="stat-card">
                        <h3>Special Currency</h3>
                        <div id="cc-special-currency" class="stat-value">0</div>
                    </div>
                    <div class="stat-card">
                        <h3>Unlocked Levels</h3>
                        <div id="cc-unlocked-levels" class="stat-value">1</div>
                    </div>
                </div>

                <!-- Chessboard -->
                <div class="chessboard-section">
                    <h3>Chessboard</h3>
                    <div id="cc-chessboard" class="chessboard">
                        <!-- 8x8 grid generated dynamically -->
                    </div>
                </div>

                <!-- Buy Controls -->
                <div class="buy-controls">
                    <h3>Buy Cats</h3>
                    <div id="cc-buy-buttons" class="buy-buttons">
                        <!-- Generated dynamically -->
                    </div>
                </div>

                <!-- Special Inventory -->
                <div class="special-inventory">
                    <h3>Special Cats</h3>
                    <div id="cc-special-inventory" class="special-grid">
                        <!-- Up to 10 special cats -->
                    </div>
                    <div id="cc-upgrade-options" class="upgrade-controls">
                        <!-- Upgrade actions injected dynamically -->
                    </div>
                    <div id="cc-collection-summary" class="collection-summary"></div>
                    <div class="collection-controls">
                        <button id="cc-sell-collection" class="control-btn">Sell Collection (×2 bonus)</button>
                    </div>
                </div>

                <!-- Messages -->
                <div id="cc-message" class="game-message"></div>
            </div>
        `;

        // Set game container reference
        this.gameContainer = gameArea.querySelector('.cat-chess-game');

        if (this.consoleMessages) console.log('📄 Cat Chess template loaded');
    }

    // Load game data from server
    async loadGameData() {
        try {
            const username = this.getCurrentUsername();
            if (!username) throw new Error('User not logged in');

            const response = await fetch(`/api/cat-chess/status/${username}`);
            if (response.ok) {
                const data = await response.json();
                this.syncStateFromPayload(data);
                if (this.consoleMessages) console.log('📊 Cat Chess data loaded');
            } else {
                throw new Error('Failed to load game data');
            }
        } catch (error) {
            console.error('❌ Error loading Cat Chess data:', error);
            this.showGameMessage('Failed to load game data', 'error');
        }
    }

    // Initialize game UI
    initGame() {
        this.renderStats();
        this.renderChessboard();
        this.renderBuyButtons();
        this.renderSpecialInventory();
    }

    // Render stats
    renderStats() {
        const coinsEl = this.gameContainer.querySelector('#cc-coins');
        const specialEl = this.gameContainer.querySelector('#cc-special-currency');
        const unlockedEl = this.gameContainer.querySelector('#cc-unlocked-levels');

        if (coinsEl) coinsEl.textContent = this.coins.toLocaleString();
        if (specialEl) specialEl.textContent = this.specialCurrency.toLocaleString();
        if (unlockedEl) {
            const highest = this.unlockedLevels.length ? Math.max(...this.unlockedLevels) : 1;
            unlockedEl.textContent = highest;
        }
    }

    // Render chessboard
    renderChessboard() {
        const boardEl = this.gameContainer.querySelector('#cc-chessboard');
        if (!boardEl) return;

        boardEl.innerHTML = '';
        for (let i = 0; i < 64; i++) {
            const cell = document.createElement('div');
            cell.className = 'cell';
            if ((Math.floor(i / 8) + i % 8) % 2 === 1) {
                cell.classList.add('dark');
            }
            cell.dataset.index = i;

            const cat = this.board[i];
            if (cat) {
                const catEl = document.createElement('div');
                catEl.className = 'cat';
                if (cat.grown) catEl.classList.add('grown');

                const multiplier = this.CAT_LEVELS[cat.level]?.multiplier ?? 1;
                const progressPercent = this.getGrowthPercent(cat);

                catEl.innerHTML = `
                    <div class="cat-level">Lv.${cat.level}</div>
                    <div class="cat-multiplier">×${multiplier.toFixed(2)}</div>
                    <div class="cat-timer">${cat.grown ? 'Ready' : this.formatTime(cat.timeLeft)}</div>
                    <div class="cat-progress">
                        <div class="cat-progress-inner" style="width: ${progressPercent}%;"></div>
                    </div>
                `;
                catEl.draggable = true;
                catEl.dataset.index = i;
                catEl.dataset.grown = String(cat.grown);

                if (cat.grown && cat.level < 51) {
                    const sellBtn = document.createElement('button');
                    sellBtn.className = 'cat-sell-btn';
                    sellBtn.dataset.index = i;
                    sellBtn.textContent = 'Sell';
                    sellBtn.draggable = false;
                    catEl.appendChild(sellBtn);
                }

                cell.appendChild(catEl);
            }

            boardEl.appendChild(cell);
        }
    }

    getGrowthPercent(cat) {
        if (!cat) return 0;
        if (cat.level >= 51) return 100;
        if (cat.grown) return 100;
        if (!Number.isFinite(cat.timeLeft)) return 0;
        const elapsed = this.GROWTH_TIME_SEC - cat.timeLeft;
        const ratio = Math.max(0, Math.min(1, elapsed / this.GROWTH_TIME_SEC));
        return Math.round(ratio * 100);
    }

    capitalize(value) {
        if (typeof value !== 'string' || value.length === 0) return '';
        return value.charAt(0).toUpperCase() + value.slice(1);
    }

    formatSpecialLabel(type) {
        if (!type) return '';
        return type.split('_').map(part => this.capitalize(part)).join(' ');
    }

    calculateSpecialValue(cat) {
        if (!cat) return 0;
        const base = this.SPECIAL_BASE_VALUES[cat.rarity] ?? this.SPECIAL_BASE_VALUES.common;
        const formMultiplier = cat.form === 'gold' ? 5 : 1;
        const typeMultiplier = this.SPECIAL_TYPE_MODIFIERS[cat.type] ?? 1;
        return Math.round(base * formMultiplier * typeMultiplier);
    }

    // Render buy buttons
    renderBuyButtons() {
        const buttonsEl = this.gameContainer.querySelector('#cc-buy-buttons');
        if (!buttonsEl) return;

        buttonsEl.innerHTML = '';
        const maxBuyable = Math.min(46, Math.max(...this.unlockedLevels) + 4);

        for (let level = 1; level <= maxBuyable; level++) {
            if (!this.unlockedLevels.includes(level)) continue;

            const btn = document.createElement('button');
            btn.className = 'buy-btn';
            const catConfig = this.CAT_LEVELS[level];
            btn.textContent = `Buy Lv.${level} • ×${catConfig.multiplier.toFixed(2)} (${catConfig.cost.toLocaleString()})`;
            btn.dataset.level = level;
            btn.disabled = this.coins < this.CAT_LEVELS[level].cost;
            buttonsEl.appendChild(btn);
        }
    }

    // Render special inventory
    renderSpecialInventory() {
        const inventoryEl = this.gameContainer.querySelector('#cc-special-inventory');
        if (!inventoryEl) return;

        inventoryEl.innerHTML = '';
        const typeCounts = {};

        for (let i = 0; i < 10; i++) {
            const slot = document.createElement('div');
            slot.className = 'special-cat';

            const cat = this.specialInventory[i];
            if (cat) {
                slot.classList.add(cat.form);
                const labelType = this.formatSpecialLabel(cat.type);
                const rarityLabel = this.capitalize(cat.rarity);

                slot.innerHTML = `
                    <div class="special-name">${labelType}</div>
                    <div class="special-rarity">${rarityLabel}</div>
                    <div class="special-form">${this.capitalize(cat.form)}</div>
                    <div class="special-value">${this.calculateSpecialValue(cat).toLocaleString()} 💎</div>
                    <button class="sell-special-btn" data-index="${i}" draggable="false">Sell</button>
                `;

                if (cat.form === 'common') {
                    typeCounts[cat.type] = typeCounts[cat.type] ? [...typeCounts[cat.type], i] : [i];
                }
            } else {
                slot.textContent = 'Empty';
            }

            inventoryEl.appendChild(slot);
        }

        const upgradeEl = this.gameContainer.querySelector('#cc-upgrade-options');
        if (upgradeEl) {
            upgradeEl.innerHTML = '';
            const upgradeEntries = Object.entries(typeCounts).filter(([, indexes]) => indexes.length >= 5);

            if (upgradeEntries.length === 0) {
                upgradeEl.textContent = 'Collect 5 identical common special cats to unlock an upgrade.';
            } else {
                upgradeEntries.forEach(([type, indexes]) => {
                    const button = document.createElement('button');
                    button.className = 'upgrade-special-btn';
                    button.dataset.type = type;
                    const label = this.formatSpecialLabel(type);
                    button.textContent = `Upgrade ${label} (${indexes.length}/5)`;
                    upgradeEl.appendChild(button);
                });
            }
        }

        const collectionSummaryEl = this.gameContainer.querySelector('#cc-collection-summary');
        if (collectionSummaryEl) {
            const activeCats = this.specialInventory.filter(Boolean);
            const uniqueTypes = new Set(activeCats.map(cat => cat.type)).size;
            collectionSummaryEl.textContent = `Collection: ${uniqueTypes}/5 unique • Slots ${activeCats.length}/10`;
            collectionSummaryEl.classList.toggle('ready', uniqueTypes >= 5);
            collectionSummaryEl.classList.toggle('full', activeCats.length >= 10);
        }
    }

    // Bind game events
    bindGameEvents() {
        const backBtn = this.gameContainer.querySelector('#cc-back-btn');
        if (backBtn) {
            backBtn.addEventListener('click', () => {
                if (this.gameManager && typeof this.gameManager.returnToMenu === 'function') {
                    this.gameManager.returnToMenu();
                } else if (typeof window.returnToGameMenu === 'function') {
                    window.returnToGameMenu();
                }
            });
        }

        // UI button actions
        this.gameContainer.addEventListener('click', (e) => {
            if (e.target.classList.contains('buy-btn')) {
                const level = parseInt(e.target.dataset.level, 10);
                if (!Number.isNaN(level)) {
                    this.buyCat(level);
                }
            } else if (e.target.classList.contains('sell-special-btn')) {
                const index = parseInt(e.target.dataset.index, 10);
                if (!Number.isNaN(index)) {
                    this.sellSpecialCat(index);
                }
            } else if (e.target.classList.contains('cat-sell-btn')) {
                const index = parseInt(e.target.dataset.index, 10);
                if (!Number.isNaN(index)) {
                    this.sellCat(index);
                }
            } else if (e.target.classList.contains('upgrade-special-btn')) {
                const type = e.target.dataset.type;
                if (type) {
                    this.upgradeSpecialCat(type);
                }
            }
        });

        // Chessboard drag and drop
        const boardEl = this.gameContainer.querySelector('#cc-chessboard');
        if (boardEl) {
            boardEl.addEventListener('dragstart', (e) => {
                const catEl = e.target.closest('.cat');
                if (catEl) {
                    this.draggedCat = catEl;
                    this.draggedFromIndex = parseInt(catEl.dataset.index, 10);
                    e.dataTransfer.effectAllowed = 'move';
                }
            });

            boardEl.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
            });

            boardEl.addEventListener('drop', async (e) => {
                e.preventDefault();
                const cellEl = e.target.closest('.cell');
                if (!cellEl) return;

                const toIndex = parseInt(cellEl.dataset.index);
                if (Number.isNaN(toIndex)) return;

                if (this.draggedFromIndex !== null && this.draggedFromIndex !== toIndex) {
                    const fromCat = this.board[this.draggedFromIndex];
                    const toCat = this.board[toIndex];

                    if (!fromCat) {
                        this.showGameMessage('No cat to move.', 'error');
                    } else if (!toCat) {
                        await this.moveCat(this.draggedFromIndex, toIndex);
                    } else if (fromCat.level === toCat.level) {
                        await this.mergeCats(this.draggedFromIndex, toIndex);
                    } else {
                        await this.swapCats(this.draggedFromIndex, toIndex);
                    }
                }
                this.draggedCat = null;
                this.draggedFromIndex = null;
            });

            boardEl.addEventListener('dragend', () => {
                this.draggedCat = null;
                this.draggedFromIndex = null;
            });
        }

        // Sell collection
        const sellBtn = this.gameContainer.querySelector('#cc-sell-collection');
        if (sellBtn) {
            sellBtn.addEventListener('click', () => this.sellCollection());
        }

    }

    // Unbind game events
    unbindGameEvents() {
        // Events are bound to elements that will be removed, so no need to unbind
    }

    // Buy cat
    async buyCat(level) {
        try {
            const username = this.getCurrentUsername();
            if (!username) return;

            const response = await fetch('/api/cat-chess/buy', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, level })
            });

            if (response.ok) {
                const data = await response.json();
                this.syncStateFromPayload(data);
                this.updateUI();
                this.showGameMessage('Cat purchased!', 'success');
            } else {
                const error = await response.json();
                this.showGameMessage(error.error, 'error');
            }
        } catch (error) {
            console.error('Buy cat error:', error);
            this.showGameMessage('Failed to buy cat', 'error');
        }
    }

    // Move cat to empty cell
    async moveCat(fromIndex, toIndex) {
        try {
            const username = this.getCurrentUsername();
            if (!username) return;

            const response = await fetch('/api/cat-chess/move', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, fromIndex, toIndex })
            });

            if (response.ok) {
                const data = await response.json();
                this.syncStateFromPayload(data);
                this.updateUI();
                this.showGameMessage('Cat moved!', 'success');
            } else {
                const error = await response.json();
                this.showGameMessage(error.error, 'error');
            }
        } catch (error) {
            console.error('Move cat error:', error);
            this.showGameMessage('Failed to move cat', 'error');
        }
    }

    // Swap cats between two occupied cells
    async swapCats(fromIndex, toIndex) {
        if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)) {
            this.showGameMessage('Invalid swap coordinates.', 'error');
            return;
        }

        const fromCat = this.board[fromIndex];
        const toCat = this.board[toIndex];

        if (!fromCat || !toCat) {
            this.showGameMessage('Both cells must have cats to swap.', 'error');
            return;
        }

        try {
            const username = this.getCurrentUsername();
            if (!username) return;

            const response = await fetch('/api/cat-chess/swap', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, fromIndex, toIndex })
            });

            if (response.ok) {
                const data = await response.json();
                this.syncStateFromPayload(data);
                this.updateUI();
                this.showGameMessage('Cats swapped!', 'success');
            } else {
                const error = await response.json();
                this.showGameMessage(error.error || 'Swap failed', 'error');
            }
        } catch (error) {
            console.error('Swap cats error:', error);
            this.showGameMessage('Failed to swap cats', 'error');
        }
    }

    // Merge cats
    async mergeCats(fromIndex, toIndex) {
        try {
            const username = this.getCurrentUsername();
            if (!username) return;

            const response = await fetch('/api/cat-chess/merge', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, fromIndex, toIndex })
            });

            if (response.ok) {
                const data = await response.json();
                this.syncStateFromPayload(data);
                this.updateUI();
                this.showGameMessage('Cats merged!', 'success');
            } else {
                const error = await response.json();
                this.showGameMessage(error.error, 'error');
            }
        } catch (error) {
            console.error('Merge cats error:', error);
            this.showGameMessage('Failed to merge cats', 'error');
        }
    }

    // Sell matured cat
    async sellCat(cellIndex) {
        const index = Number(cellIndex);
        if (!Number.isInteger(index) || index < 0 || index >= this.board.length) {
            this.showGameMessage('Invalid board slot.', 'error');
            return;
        }

        const cat = this.board[index];
        if (!cat) {
            this.showGameMessage('No cat to sell in that cell.', 'error');
            return;
        }

        if (!cat.grown && cat.level < 51) {
            this.showGameMessage('This cat is still growing.', 'error');
            return;
        }

        const salePrice = this.CAT_LEVELS[cat.level]?.sellPrice ?? 0;

        try {
            const username = this.getCurrentUsername();
            if (!username) return;

            const response = await fetch('/api/cat-chess/sell', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, cellIndex: index })
            });

            if (response.ok) {
                const data = await response.json();
                this.syncStateFromPayload(data);
                this.updateUI();
                const message = salePrice > 0
                    ? `Sold Lv.${cat.level} cat for ${salePrice.toLocaleString()} coins!`
                    : 'Cat sold!';
                this.showGameMessage(message, 'success');
            } else {
                const error = await response.json();
                this.showGameMessage(error.error || 'Failed to sell cat', 'error');
            }
        } catch (error) {
            console.error('Sell cat error:', error);
            this.showGameMessage('Failed to sell cat', 'error');
        }
    }

    // Sell collection
    async sellCollection() {
        const activeCats = this.specialInventory.filter(Boolean);
        const uniqueTypes = new Set(activeCats.map(cat => cat.type));
        if (uniqueTypes.size < 5) {
            this.showGameMessage('You need 5 unique special cats to sell a collection.', 'error');
            return;
        }

        const totalValue = activeCats.reduce((sum, cat) => sum + this.calculateSpecialValue(cat), 0);
        const payout = totalValue * 2;

        try {
            const username = this.getCurrentUsername();
            if (!username) return;

            const response = await fetch('/api/cat-chess/sell_collection', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username })
            });

            if (response.ok) {
                const data = await response.json();
                this.syncStateFromPayload(data);
                this.updateUI();
                this.showGameMessage(`Collection sold for ${payout.toLocaleString()} 💎!`, 'success');
            } else {
                const error = await response.json();
                this.showGameMessage(error.error, 'error');
            }
        } catch (error) {
            console.error('Sell collection error:', error);
            this.showGameMessage('Failed to sell collection', 'error');
        }
    }

    // Sell special cat
    async sellSpecialCat(inventoryIndex) {
        const index = Number(inventoryIndex);
        if (!Number.isInteger(index) || index < 0 || index >= this.specialInventory.length) {
            this.showGameMessage('Invalid inventory slot.', 'error');
            return;
        }

        const cat = this.specialInventory[index];
        if (!cat) {
            this.showGameMessage('No special cat in that slot.', 'error');
            return;
        }

        const saleValue = this.calculateSpecialValue(cat);

        try {
            const username = this.getCurrentUsername();
            if (!username) return;

            const response = await fetch('/api/cat-chess/sell_special', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, inventoryIndex: index })
            });

            if (response.ok) {
                const data = await response.json();
                this.syncStateFromPayload(data);
                this.updateUI();
                this.showGameMessage(`Special cat sold for ${saleValue.toLocaleString()} 💎!`, 'success');
            } else {
                const error = await response.json();
                this.showGameMessage(error.error, 'error');
            }
        } catch (error) {
            console.error('Sell special cat error:', error);
            this.showGameMessage('Failed to sell special cat', 'error');
        }
    }

    // Upgrade special cat to gold form
    async upgradeSpecialCat(type) {
        const candidates = this.specialInventory.filter(cat => cat && cat.type === type && cat.form === 'common');
        if (candidates.length < 5) {
            this.showGameMessage('Need 5 common cats of that type to upgrade.', 'error');
            return;
        }

        try {
            const username = this.getCurrentUsername();
            if (!username) return;

            const response = await fetch('/api/cat-chess/upgrade_special', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, type })
            });

            if (response.ok) {
                const data = await response.json();
                this.syncStateFromPayload(data);
                this.updateUI();
                const label = this.formatSpecialLabel(type);
                this.showGameMessage(`${label} upgraded to Gold!`, 'success');
            } else {
                const error = await response.json();
                this.showGameMessage(error.error || 'Upgrade failed', 'error');
            }
        } catch (error) {
            console.error('Upgrade special cat error:', error);
            this.showGameMessage('Failed to upgrade special cat', 'error');
        }
    }

    // Start game loop
    startGameLoop() {
        this.updateTimers();
        this.gameLoopInterval = setInterval(() => {
            this.updateTimers();
        }, 1000);
    }

    // Update timers for local countdown visuals
    updateTimers() {
        if (!this.gameContainer || !this.board || this.board.length === 0) return;

        let hasChanges = false;
        const nowMs = Date.now();

        this.board = this.board.map(cat => {
            if (!cat) return null;
            const updated = { ...cat };

            if (cat.level >= 51) {
                if (!cat.grown || cat.timeLeft !== 0) {
                    updated.grown = true;
                    updated.timeLeft = 0;
                    hasChanges = true;
                }
                return updated;
            }

            if (!cat.timerStart) {
                return updated;
            }

            const timerStartDate = new Date(cat.timerStart);
            if (Number.isNaN(timerStartDate.getTime())) {
                return updated;
            }

            const elapsed = Math.max(0, Math.floor((nowMs - timerStartDate.getTime()) / 1000));
            const timeLeft = Math.max(0, this.GROWTH_TIME_SEC - elapsed);
            const grown = timeLeft === 0;

            if (timeLeft !== cat.timeLeft || grown !== cat.grown) {
                updated.timeLeft = timeLeft;
                updated.grown = grown;
                hasChanges = true;
            }

            return updated;
        });

        if (hasChanges) {
            this.renderChessboard();
        }
    }

    // Refresh game status from server
    async refreshGameStatus() {
        try {
            const username = this.getCurrentUsername();
            if (!username) return;

            const response = await fetch(`/api/cat-chess/status/${username}`);
            if (!response.ok) return;

            const data = await response.json();
            this.syncStateFromPayload(data);
            this.updateUI();
            if (this.consoleMessages) console.log('🔄 Cat Chess status refreshed');
        } catch (error) {
            console.error('Failed to refresh Cat Chess status:', error);
        }
    }

    // Sync state from server payload
    syncStateFromPayload(data) {
        if (!data) return;

        if (typeof data.coins === 'number') {
            this.coins = data.coins;
        }

        if (typeof data.specialCurrency === 'number') {
            this.specialCurrency = data.specialCurrency;
        }

        if (Array.isArray(data.board)) {
            this.board = data.board.map(cat => this.normalizeBoardCell(cat));
            if (this.board.length < 64) {
                this.board = this.board.concat(Array(64 - this.board.length).fill(null));
            } else if (this.board.length > 64) {
                this.board = this.board.slice(0, 64);
            }
        }

        if (Array.isArray(data.unlockedLevels)) {
            this.unlockedLevels = data.unlockedLevels;
        }

        if (Array.isArray(data.specialInventory)) {
            this.specialInventory = data.specialInventory.slice(0, 10);
        }

        if (Array.isArray(data.redeemedCodes)) {
            this.redeemedCodes = data.redeemedCodes;
        }
    }

    // Update UI after state sync
    updateUI() {
        this.renderStats();
        this.renderChessboard();
        this.renderBuyButtons();
        this.renderSpecialInventory();
    }

    normalizeBoardCell(cat) {
        if (!cat) return null;
        if (typeof cat.grown === 'boolean' && typeof cat.timeLeft === 'number') {
            return cat;
        }

        const normalized = { ...cat };
        normalized.level = Number(normalized.level) || 1;
        if (normalized.level >= 51) {
            normalized.grown = true;
            normalized.timeLeft = 0;
            return normalized;
        }

        const timerStart = normalized.timerStart ? new Date(normalized.timerStart) : null;
        if (!timerStart || Number.isNaN(timerStart.getTime())) {
            normalized.grown = false;
            normalized.timeLeft = this.GROWTH_TIME_SEC;
            return normalized;
        }

        const nowSec = Math.floor(Date.now() / 1000);
        const startSec = Math.floor(timerStart.getTime() / 1000);
        const elapsed = Math.max(0, nowSec - startSec);

        if (elapsed >= this.GROWTH_TIME_SEC) {
            normalized.grown = true;
            normalized.timeLeft = 0;
        } else {
            normalized.grown = false;
            normalized.timeLeft = this.GROWTH_TIME_SEC - elapsed;
        }

        return normalized;
    }

    // Start status refresh
    startStatusRefresh() {
        this.statusRefreshInterval = setInterval(() => {
            this.refreshGameStatus();
        }, 30000); // Refresh every 30 seconds
    }

    // Format time
    formatTime(seconds) {
        if (!Number.isFinite(seconds) || seconds <= 0) return 'Ready';
        const hours = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = Math.max(0, Math.floor(seconds % 60));

        if (hours > 0) {
            return `${hours}h ${mins}m`;
        }

        if (mins > 0) {
            return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
        }

        return `${Math.max(1, secs)}s`;
    }

    // Show game message
    showGameMessage(message, type = 'info') {
        const messageEl = this.gameContainer.querySelector('#cc-message');
        if (messageEl) {
            messageEl.textContent = message;
            messageEl.className = `game-message ${type}`;
            if (this.messageTimeout) clearTimeout(this.messageTimeout);
            this.messageTimeout = setTimeout(() => {
                messageEl.textContent = '';
                messageEl.className = 'game-message';
            }, 5000);
        }
    }

    // Get game container
    getContainer() {
        return this.gameContainer;
    }
}