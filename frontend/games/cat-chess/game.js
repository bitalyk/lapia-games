export default class CatChessGame {
    constructor() {
        this.isRunning = false;
        this.gameContainer = null;
        this.coins = 0;
        this.specialCurrency = 0;
        this.board = Array(64).fill(null);
        this.BOARD_WIDTH = 8;
        this.unlockedLevels = [1];
        this.specialInventory = [];
        this.redeemedCodes = [];
        this.sellBonuses = {};
        this.selectedCatIndex = null;
        this.dragSource = null;
        this.gameManager = null;
        this.gameLoopInterval = null;
        this.statusRefreshInterval = null;
        this.consoleMessages = true;
        this.draggedCat = null;
        this.draggedFromIndex = null;
        this.sellAllPending = false;
        this.toastContainer = null;

        this.CAT_LEVELS = this.buildCatLevels();
        this.SPECIAL_CAT_TYPES = this.buildSpecialDefinitions();
        this.buffHighlightMap = new Map();
        this.inventoryLimit = 10;
        this.mergeCandidates = {};
        this.SPECIAL_COIN_VALUE = 1000;
        this.specialConfirmModal = null;
        this.specialConfirmResolve = null;
        this.specialConfirmAcceptBtn = null;
        this.specialConfirmCancelBtn = null;
        this.specialConfirmCloseBtn = null;
        this.specialConfirmMessageEl = null;
        this.specialConfirmDeficitEl = null;
        this.specialConfirmSpecialEl = null;
        this.specialConfirmEventsBound = false;
        this.onSpecialConfirmKeydown = this.handleSpecialConfirmKeydown.bind(this);

        this.GROWTH_TIME_SEC = 12 * 60 * 60; // Updated by loadConfig when FAST_MODE is enabled
        this.config = {}; // Populated by loadConfig
    }

    buildCatLevels() {
        const levels = {};
        const tiers = [
            { range: [1, 10], baseCost: 1000, multiplierIncrement: 0.1, startMultiplier: 1.0 },
            { range: [11, 20], baseCost: 1250, multiplierIncrement: 0.33, startMultiplier: 2.0 },
            { range: [21, 30], baseCost: 2000, multiplierIncrement: 0.55, startMultiplier: 5.0 },
            { range: [31, 40], baseCost: 2500, multiplierIncrement: 1.0, startMultiplier: 10.0 },
            { range: [41, 50], baseCost: 5000, multiplierIncrement: 3.33, startMultiplier: 20.0 },
            { range: [51, 51], baseCost: 0, multiplierIncrement: 0, startMultiplier: 50.0 }
        ];

        tiers.forEach(({ range, baseCost, multiplierIncrement, startMultiplier }) => {
            const [startLevel, endLevel] = range;
            for (let level = startLevel; level <= endLevel; level++) {
                const multiplier = startMultiplier + (level - startLevel) * multiplierIncrement;
                levels[level] = {
                    cost: Math.round(baseCost * multiplier),
                    multiplier,
                    sellPrice: Math.round(baseCost * multiplier * 2)
                };
            }
        });

        return levels;
    }

    buildSpecialDefinitions() {
        return {
            horizontal: {
                chance: 0.3,
                baseValue: 1000,
                pattern: [
                    { row: 0, col: -1 },
                    { row: 0, col: 1 }
                ],
                buff: { common: 0.5, golden: 1.0 },
                label: 'Horizontal'
            },
            vertical: {
                chance: 0.3,
                baseValue: 1000,
                pattern: [
                    { row: -1, col: 0 },
                    { row: 1, col: 0 }
                ],
                buff: { common: 0.5, golden: 1.0 },
                label: 'Vertical'
            },
            side: {
                chance: 0.15,
                baseValue: 2000,
                pattern: [
                    { row: -1, col: 0 },
                    { row: 1, col: 0 },
                    { row: 0, col: -1 },
                    { row: 0, col: 1 }
                ],
                buff: { common: 0.25, golden: 0.5 },
                label: 'Side'
            },
            corner: {
                chance: 0.15,
                baseValue: 2000,
                pattern: [
                    { row: -1, col: -1 },
                    { row: -1, col: 1 },
                    { row: 1, col: -1 },
                    { row: 1, col: 1 }
                ],
                buff: { common: 0.25, golden: 0.5 },
                label: 'Corner'
            },
            round: {
                chance: 0.1,
                baseValue: 3000,
                pattern: [
                    { row: -1, col: -1 },
                    { row: -1, col: 0 },
                    { row: -1, col: 1 },
                    { row: 0, col: -1 },
                    { row: 0, col: 1 },
                    { row: 1, col: -1 },
                    { row: 1, col: 0 },
                    { row: 1, col: 1 }
                ],
                buff: { common: 0.25, golden: 0.5 },
                label: 'Round'
            }
        };
    }

    // Set game manager
    setGameManager(gameManager) {
        this.gameManager = gameManager;
        if (this.consoleMessages) console.log('🎮 Game Manager set for Cat Chess');
    }

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
            } else {
                this.config = { enableRedeem: true, showRestartButton: true, consoleMessages: true, fastMode: false };
                if (this.consoleMessages) console.log('⚠️ Failed to load config, using defaults');
            }
        } catch (error) {
            this.config = { enableRedeem: true, showRestartButton: true, consoleMessages: true, fastMode: false };
            if (this.consoleMessages) console.log('⚠️ Error loading config:', error);
        }

        const fastMode = Boolean(this.config?.fastMode);
        this.GROWTH_TIME_SEC = fastMode ? 30 : 12 * 60 * 60;
        if (typeof this.config?.consoleMessages === 'boolean') {
            this.consoleMessages = this.config.consoleMessages;
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
        if (typeof this.specialConfirmResolve === 'function') {
            this.specialConfirmResolve(false);
        }
        if (this.specialConfirmModal) {
            this.specialConfirmModal.classList.remove('open');
            this.specialConfirmModal.setAttribute('aria-hidden', 'true');
        }
        window.removeEventListener('keydown', this.onSpecialConfirmKeydown);
        this.specialConfirmResolve = null;
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

                ${this.config?.enableRedeem ? `
                <div class="redeem-section">
                    <h3>Redeem Code</h3>
                    <div class="redeem-input-group">
                        <input type="text" id="cc-redeem-code" class="redeem-input" placeholder="Enter code">
                        <button id="cc-redeem-btn" class="redeem-btn">Redeem</button>
                    </div>
                </div>
                ` : ''}

                <!-- Chessboard -->
                <div class="chessboard-section">
                    <h3>Chessboard</h3>
                    <div id="cc-chessboard" class="chessboard">
                        <!-- 8x8 grid generated dynamically -->
                    </div>
                    <div class="board-tools">
                        <div id="cc-sell-dropzone" class="sell-dropzone" draggable="false">
                            <div class="sell-title">Quick Sell</div>
                            <div class="sell-desc">Drag a ready cat here to sell instantly.</div>
                        </div>
                        <div id="cc-cat-detail" class="cat-detail hidden">
                            <div class="detail-header">
                                <span id="cc-cat-detail-title">Select a cat</span>
                                <button id="cc-cat-detail-close" class="detail-close" aria-label="Close details">&times;</button>
                            </div>
                            <div class="detail-body">
                                <div class="detail-row"><span>Status</span><span id="cc-cat-detail-status">None</span></div>
                                <div class="detail-row"><span>Sell Price</span><span id="cc-cat-detail-sell">0</span></div>
                                <div class="detail-row"><span>Buff</span><span id="cc-cat-detail-buff">×1.00</span></div>
                                <div class="detail-row"><span>Sell Bonus</span><span id="cc-cat-detail-bonus">×1.00</span></div>
                                <div class="detail-row"><span>Time Left</span><span id="cc-cat-detail-time">0s</span></div>
                            </div>
                            <div class="detail-hint">Drag this cat to the quick sell slot or special inventory.</div>
                        </div>
                    </div>
                    <div class="board-actions">
                        <button id="cc-sell-all" class="action-btn action-primary">Sell All Cats</button>
                        <button id="cc-open-shop" class="action-btn">Open Shop</button>
                    </div>
                </div>

                <!-- Shop Modal -->
                <div id="cc-shop-modal" class="shop-modal" aria-hidden="true">
                    <div class="shop-dialog" role="dialog" aria-modal="true" aria-labelledby="cc-shop-title">
                        <div class="shop-header">
                            <h3 id="cc-shop-title">Cat Shop</h3>
                            <button id="cc-shop-close" class="shop-close" aria-label="Close shop">&times;</button>
                        </div>
                        <div id="cc-buy-buttons" class="shop-list">
                            <!-- Generated dynamically -->
                        </div>
                    </div>
                </div>

                <!-- Special Inventory -->
                <div class="special-inventory">
                    <div class="inventory-header">
                        <h3>Special Cats</h3>
                        <div id="cc-inventory-status" class="inventory-status">0/10 slots</div>
                    </div>
                    <div class="inventory-controls">
                        <select id="cc-merge-type" class="inventory-select" aria-label="Select special type to merge">
                            <option value="" disabled selected>Merge unavailable</option>
                        </select>
                        <button id="cc-merge-gold" type="button" class="inventory-merge-btn action-btn" disabled>Merge Gold</button>
                    </div>
                    <div id="cc-special-inventory" class="inventory-slots">
                        <!-- Special cats rendered here -->
                    </div>
                    <div id="cc-inventory-helper" class="inventory-helper">Drag level 51 cats or special pieces here to store them.</div>
                    <div class="collection-panel">
                        <div class="collection-row" data-form="common">
                            <div class="collection-row-header">
                                <div class="collection-title">
                                    <span class="collection-name">Common Collection</span>
                                    <span id="cc-common-progress" class="collection-progress">0/5 types</span>
                                </div>
                                <button id="cc-sell-common" class="collection-sell-btn" disabled>Sell Common Set</button>
                            </div>
                            <div id="cc-common-track" class="collection-track"></div>
                        </div>
                        <div class="collection-row" data-form="golden">
                            <div class="collection-row-header">
                                <div class="collection-title">
                                    <span class="collection-name">Golden Collection</span>
                                    <span id="cc-golden-progress" class="collection-progress">0/5 types</span>
                                </div>
                                <button id="cc-sell-golden" class="collection-sell-btn" disabled>Sell Golden Set</button>
                            </div>
                            <div id="cc-golden-track" class="collection-track"></div>
                        </div>
                    </div>
                </div>

                <!-- Toasts -->
                <div id="cc-toast-container" class="toast-container" aria-live="polite" aria-atomic="true"></div>

                <div id="cc-special-confirm" class="confirm-modal" aria-hidden="true" tabindex="-1">
                    <div class="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="cc-confirm-title">
                        <div class="confirm-header">
                            <h3 id="cc-confirm-title">Use Special Coins?</h3>
                            <button type="button" id="cc-confirm-close" class="confirm-close" aria-label="Close">&times;</button>
                        </div>
                        <div class="confirm-body">
                            <p id="cc-confirm-message">Spend special coins to complete this purchase?</p>
                            <div class="confirm-summary">
                                <div class="confirm-row">
                                    <span class="label">Coin shortfall</span>
                                    <span id="cc-confirm-deficit" class="value">0</span>
                                </div>
                                <div class="confirm-row">
                                    <span class="label">Special coins needed</span>
                                    <span id="cc-confirm-special" class="value">0</span>
                                </div>
                            </div>
                        </div>
                        <div class="confirm-actions">
                            <button type="button" id="cc-confirm-accept" class="confirm-btn primary">Use 0 💎</button>
                            <button type="button" id="cc-confirm-cancel" class="confirm-btn">Cancel</button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Set game container reference
        this.gameContainer = gameArea.querySelector('.cat-chess-game');

        this.cacheSpecialConfirmElements();

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
            const highest = this.getHighestPurchasableLevel();
            unlockedEl.textContent = highest;
        }
    }

    // Render chessboard
    renderChessboard() {
        const boardEl = this.gameContainer.querySelector('#cc-chessboard');
        if (!boardEl) return;

        const highlightMap = new Map();

        this.board.forEach((piece, index) => {
            if (!piece || piece.kind !== 'special') return;
            const targets = this.getSpecialPatternIndices(piece.type, index);
            const buffStrength = Number(piece.buffMultiplier) || this.getSpecialBuff(piece.type, piece.form);
            targets.forEach(targetIndex => {
                if (targetIndex === null) return;
                const occupant = this.board[targetIndex];
                if (occupant && occupant.kind === 'special') return;
                if (occupant && occupant.kind === 'cat' && typeof occupant.level === 'number' && occupant.level >= 51) return;
                const entry = highlightMap.get(targetIndex) || { total: 0, forms: new Set() };
                entry.total += buffStrength;
                entry.forms.add(piece.form === 'golden' ? 'golden' : 'common');
                highlightMap.set(targetIndex, entry);
            });
        });

        boardEl.innerHTML = '';

        for (let i = 0; i < 64; i++) {
            const cell = document.createElement('div');
            cell.className = 'cell';
            if ((Math.floor(i / 8) + i % 8) % 2 === 1) {
                cell.classList.add('dark');
            }
            cell.dataset.index = i;

            const piece = this.board[i];
            const buffMeta = highlightMap.get(i) || null;
            const buffTotal = buffMeta ? buffMeta.total : 0;
            const cellEligibleForBuff = !piece || (piece.kind === 'cat' && typeof piece.level === 'number' && piece.level <= 50);
            const buffMultiplier = cellEligibleForBuff && buffTotal > 0 ? (1 + buffTotal) : null;
            const buffColor = buffMultiplier ? (buffMeta && buffMeta.forms.has('golden') ? '#f59e0b' : '#38bdf8') : null;

            if (piece) {
                if (piece.kind === 'special') {
                    const specialEl = document.createElement('div');
                    specialEl.className = 'special-piece';
                    if (piece.form === 'golden') specialEl.classList.add('golden');
                    if (this.selectedCatIndex === i) specialEl.classList.add('selected');
                    if (buffMultiplier) {
                        specialEl.classList.add('buff-active');
                        specialEl.classList.add(buffMeta.forms.has('golden') ? 'buff-golden' : 'buff-common');
                        specialEl.style.setProperty('--buff-color', buffColor);
                    }

                    specialEl.innerHTML = `
                        <div class="special-type">${piece.label || this.formatSpecialLabel(piece.type)}</div>
                        <div class="special-form">${this.capitalize(piece.form)}</div>
                        <div class="special-buff">Buff ×${(1 + (Number(piece.buffMultiplier) || this.getSpecialBuff(piece.type, piece.form))).toFixed(2)}</div>
                    `;

                    specialEl.draggable = true;
                    specialEl.dataset.index = i;
                    specialEl.dataset.kind = 'special';
                    specialEl.dataset.type = piece.type;

                    cell.appendChild(specialEl);
                } else {
                    const cat = { ...piece, kind: 'cat' };
                    const catEl = document.createElement('div');
                    catEl.className = 'cat';
                    if (cat.grown) catEl.classList.add('grown');
                    if (cat.level >= 51) catEl.classList.add('max-level');
                    if (this.selectedCatIndex === i) catEl.classList.add('selected');

                    if (buffMultiplier) {
                        catEl.classList.add('buffed');
                        catEl.classList.add(buffMeta.forms.has('golden') ? 'buff-golden' : 'buff-common');
                        catEl.style.setProperty('--buff-color', buffColor);
                    }

                    const multiplier = this.CAT_LEVELS[cat.level]?.multiplier ?? 1;
                    const progressPercent = this.getGrowthPercent(cat);
                    const buffLine = buffMultiplier ? `<div class="cat-buff-line">Buff ×${buffMultiplier.toFixed(2)}</div>` : '';

                    catEl.innerHTML = `
                        <div class="cat-level">Lv.${cat.level}</div>
                        <div class="cat-multiplier">×${multiplier.toFixed(2)}</div>
                        <div class="cat-timer">${cat.grown ? 'Ready' : this.formatTime(cat.timeLeft)}</div>
                        ${buffLine}
                        <div class="cat-progress">
                            <div class="cat-progress-inner" style="width: ${progressPercent}%;"></div>
                        </div>
                    `;
                    catEl.draggable = true;
                    catEl.dataset.index = i;
                    catEl.dataset.grown = String(cat.grown);
                    catEl.dataset.level = String(cat.level);
                    catEl.dataset.kind = 'cat';

                    cell.appendChild(catEl);
                }
            } else if (buffMultiplier) {
                cell.classList.add('buff-zone');
                cell.classList.add(buffMeta.forms.has('golden') ? 'buff-golden' : 'buff-common');
                cell.style.setProperty('--buff-color', buffColor);
                const badge = document.createElement('div');
                badge.className = 'buff-zone-badge';
                badge.textContent = `Buff ×${buffMultiplier.toFixed(2)}`;
                cell.appendChild(badge);
            }

            boardEl.appendChild(cell);
        }

        this.buffHighlightMap = highlightMap;
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

    getSpecialDefinition(type) {
        return this.SPECIAL_CAT_TYPES[type] || null;
    }

    getSpecialBuff(type, form = 'common') {
        const definition = this.getSpecialDefinition(type);
        if (!definition) return 0;
        const key = form === 'golden' ? 'golden' : 'common';
        return Number(definition.buff[key]) || 0;
    }

    boardIndexToCoords(index) {
        return {
            row: Math.floor(index / this.BOARD_WIDTH),
            col: index % this.BOARD_WIDTH
        };
    }

    coordsToBoardIndex(row, col) {
        if (row < 0 || col < 0 || row >= this.BOARD_WIDTH || col >= this.BOARD_WIDTH) {
            return null;
        }
        return row * this.BOARD_WIDTH + col;
    }

    getSpecialPatternIndices(type, originIndex) {
        const definition = this.getSpecialDefinition(type);
        if (!definition) return [];
        const { row, col } = this.boardIndexToCoords(originIndex);
        return definition.pattern
            .map(offset => this.coordsToBoardIndex(row + offset.row, col + offset.col))
            .filter(index => index !== null);
    }

    calculateSpecialValue(cat) {
        if (!cat) return 0;
        const base = Number(cat.baseValue) || 0;
        const saleMultiplier = Number(cat.saleMultiplier) || (cat.form === 'golden' ? 5 : 1);
        return Math.round(base * saleMultiplier);
    }

    getSpecialPurchaseFallback(cost) {
        const price = Number(cost) || 0;
        if (price <= 0) {
            return {
                canAfford: true,
                requiresSpecialFallback: false,
                specialCoinsNeeded: 0,
                deficitCoins: 0
            };
        }

        const coinBalance = Number(this.coins) || 0;
        if (coinBalance >= price) {
            return {
                canAfford: true,
                requiresSpecialFallback: false,
                specialCoinsNeeded: 0,
                deficitCoins: 0
            };
        }

        const deficitCoins = price - coinBalance;
        const specialCoinsNeeded = Math.ceil(deficitCoins / this.SPECIAL_COIN_VALUE);

        return {
            canAfford: (Number(this.specialCurrency) || 0) >= specialCoinsNeeded,
            requiresSpecialFallback: true,
            specialCoinsNeeded,
            deficitCoins
        };
    }

    getMaxBuyLevel() {
        return this.config?.fastMode ? 50 : 46;
    }

    getHighestUnlockedLevel() {
        return this.unlockedLevels.length ? Math.max(...this.unlockedLevels) : 1;
    }

    getHighestPurchasableLevel() {
        const purchasable = this.unlockedLevels.filter(level => this.canPurchaseLevel(level));
        if (purchasable.length > 0) {
            return Math.max(...purchasable);
        }
        return this.unlockedLevels.length ? Math.max(...this.unlockedLevels) : 1;
    }

    getPurchaseRequirement(level) {
        if (level <= 1) return null;
        return Math.min(level + 4, 51);
    }

    canPurchaseLevel(level) {
        if (!Number.isInteger(level) || level < 1) return false;
        if (level === 1) {
            return this.unlockedLevels.includes(1);
        }

        if (level > this.getMaxBuyLevel()) return false;
        if (!this.unlockedLevels.includes(level)) return false;

        const requirement = this.getPurchaseRequirement(level);
        if (requirement === null) return true;
        return this.unlockedLevels.includes(requirement);
    }

    hasInventoryCapacity({ add = 0, remove = 0 } = {}) {
        if (!Number.isFinite(this.inventoryLimit)) return true;
        const resulting = this.specialInventory.length - remove + add;
        return resulting <= this.inventoryLimit;
    }

    collectSpecialEntries() {
        const inventory = this.specialInventory
            .map((cat, index) => {
                if (!cat || !cat.type) return null;
                const form = cat.form === 'golden' ? 'golden' : 'common';
                return { source: 'inventory', index, form, type: cat.type, cat };
            })
            .filter(Boolean);

        const board = this.board
            .map((cell, index) => {
                if (!cell || cell.kind !== 'special' || !cell.type) return null;
                const form = cell.form === 'golden' ? 'golden' : 'common';
                return { source: 'board', index, form, type: cell.type, cat: cell };
            })
            .filter(Boolean);

        return { inventory, board };
    }

    getMergeCandidates() {
        const candidates = {};
        const ensure = (type) => {
            if (!candidates[type]) {
                candidates[type] = { inventory: 0, board: 0, total: 0 };
            }
            return candidates[type];
        };

        const { inventory, board } = this.collectSpecialEntries();
        inventory.forEach(entry => {
            if (entry.form !== 'common') return;
            const meta = ensure(entry.type);
            meta.inventory += 1;
            meta.total += 1;
        });

        board.forEach(entry => {
            if (entry.form !== 'common') return;
            const meta = ensure(entry.type);
            meta.board += 1;
            meta.total += 1;
        });

        return candidates;
    }

    getSpecialCounts() {
        const counts = { common: {}, golden: {} };
        const types = Object.keys(this.SPECIAL_CAT_TYPES);
        types.forEach(type => {
            counts.common[type] = 0;
            counts.golden[type] = 0;
        });

        const { inventory, board } = this.collectSpecialEntries();
        [...inventory, ...board].forEach(entry => {
            if (!counts[entry.form]) counts[entry.form] = {};
            if (typeof counts[entry.form][entry.type] !== 'number') {
                counts[entry.form][entry.type] = 0;
            }
            counts[entry.form][entry.type] += 1;
        });

        return counts;
    }

    updateCollectionPanel(counts) {
        const types = Object.keys(this.SPECIAL_CAT_TYPES);
        const updateRow = (form, trackSelector, progressSelector, buttonSelector) => {
            const trackEl = this.gameContainer.querySelector(trackSelector);
            if (trackEl) {
                trackEl.innerHTML = '';
                types.forEach(type => {
                    const slot = document.createElement('div');
                    slot.className = 'collection-slot';
                    slot.classList.add(`collection-${form}`);
                    const amount = counts?.[form]?.[type] ?? 0;
                    if (amount > 0) slot.classList.add('filled');
                    slot.innerHTML = `
                        <span class="collection-type">${this.formatSpecialLabel(type)}</span>
                        <span class="collection-count">${amount}/1</span>
                    `;
                    trackEl.appendChild(slot);
                });
            }

            const progressEl = this.gameContainer.querySelector(progressSelector);
            if (progressEl) {
                const filled = types.reduce((total, type) => total + ((counts?.[form]?.[type] ?? 0) > 0 ? 1 : 0), 0);
                progressEl.textContent = `${filled}/${types.length} types`;
            }

            const buttonEl = this.gameContainer.querySelector(buttonSelector);
            if (buttonEl) {
                const ready = types.every(type => (counts?.[form]?.[type] ?? 0) > 0);
                buttonEl.disabled = !ready;
            }
        };

        updateRow('common', '#cc-common-track', '#cc-common-progress', '#cc-sell-common');
        updateRow('golden', '#cc-golden-track', '#cc-golden-progress', '#cc-sell-golden');
    }

    ensureToastContainer() {
        if (this.toastContainer && document.body.contains(this.toastContainer)) {
            return this.toastContainer;
        }
        let container = this.gameContainer?.querySelector('#cc-toast-container');
        if (!container && this.gameContainer) {
            container = document.createElement('div');
            container.id = 'cc-toast-container';
            container.className = 'toast-container';
            container.setAttribute('aria-live', 'polite');
            container.setAttribute('aria-atomic', 'true');
            this.gameContainer.appendChild(container);
        }
        if (container) {
            this.toastContainer = container;
        }
        return this.toastContainer;
    }

    cacheSpecialConfirmElements() {
        if (!this.gameContainer) return;
        this.specialConfirmModal = this.gameContainer.querySelector('#cc-special-confirm');
        this.specialConfirmAcceptBtn = this.gameContainer.querySelector('#cc-confirm-accept');
        this.specialConfirmCancelBtn = this.gameContainer.querySelector('#cc-confirm-cancel');
        this.specialConfirmMessageEl = this.gameContainer.querySelector('#cc-confirm-message');
        this.specialConfirmDeficitEl = this.gameContainer.querySelector('#cc-confirm-deficit');
        this.specialConfirmSpecialEl = this.gameContainer.querySelector('#cc-confirm-special');
        const closeButton = this.gameContainer.querySelector('#cc-confirm-close');
        this.specialConfirmCloseBtn = closeButton;
        this.specialConfirmEventsBound = false;
        this.specialConfirmResolve = null;
    }

    bindSpecialConfirmEvents() {
        if (this.specialConfirmEventsBound) return;
        if (!this.specialConfirmModal) return;

        this.specialConfirmModal.addEventListener('click', (event) => {
            if (event.target === this.specialConfirmModal) {
                event.preventDefault();
                event.stopPropagation();
                this.handleSpecialCoinConfirm(false);
            }
        });

        if (this.specialConfirmAcceptBtn) {
            this.specialConfirmAcceptBtn.addEventListener('click', (event) => {
                event.preventDefault();
                this.handleSpecialCoinConfirm(true);
            });
        }

        if (this.specialConfirmCancelBtn) {
            this.specialConfirmCancelBtn.addEventListener('click', (event) => {
                event.preventDefault();
                this.handleSpecialCoinConfirm(false);
            });
        }

        if (this.specialConfirmCloseBtn) {
            this.specialConfirmCloseBtn.addEventListener('click', (event) => {
                event.preventDefault();
                this.handleSpecialCoinConfirm(false);
            });
        }

        this.specialConfirmEventsBound = true;
    }

    handleSpecialCoinConfirm(choice) {
        if (this.specialConfirmModal) {
            this.specialConfirmModal.classList.remove('open');
            this.specialConfirmModal.setAttribute('aria-hidden', 'true');
        }
        window.removeEventListener('keydown', this.onSpecialConfirmKeydown);

        const resolver = this.specialConfirmResolve;
        this.specialConfirmResolve = null;
        if (typeof resolver === 'function') {
            resolver(Boolean(choice));
        }
    }

    handleSpecialConfirmKeydown(event) {
        if (!this.specialConfirmModal || !this.specialConfirmModal.classList.contains('open')) {
            return;
        }

        if (event.key === 'Escape') {
            event.preventDefault();
            this.handleSpecialCoinConfirm(false);
        }
    }

    // Render buy buttons
    renderBuyButtons() {
        const buttonsEl = this.gameContainer.querySelector('#cc-buy-buttons');
        if (!buttonsEl) return;

        buttonsEl.innerHTML = '';
        const highestUnlocked = this.getHighestUnlockedLevel();
        const maxBuyLevel = this.getMaxBuyLevel();
        const dynamicCap = Math.min(maxBuyLevel, highestUnlocked + 4);

        const availableLevels = [];
        for (let level = 1; level <= dynamicCap; level++) {
            if (!this.CAT_LEVELS[level]) continue;
            if (!this.canPurchaseLevel(level)) continue;
            availableLevels.push(level);
        }

        if (availableLevels.length === 0) {
            const emptyState = document.createElement('div');
            emptyState.className = 'shop-empty';
            emptyState.textContent = 'No cats available for purchase yet.';
            buttonsEl.appendChild(emptyState);
            return;
        }

        availableLevels.forEach(level => {
            const catConfig = this.CAT_LEVELS[level];
            const btn = document.createElement('button');
            btn.className = 'buy-btn';
            btn.dataset.level = level;

            const affordability = this.getSpecialPurchaseFallback(catConfig.cost);
            const needsSpecial = affordability.requiresSpecialFallback && affordability.canAfford;
            btn.disabled = !affordability.canAfford;

            if (needsSpecial) {
                btn.classList.add('needs-special');
                btn.title = `Short by ${this.formatCoins(affordability.deficitCoins)} coins. Will use ${this.formatSpecialCoins(affordability.specialCoinsNeeded)} special coins.`;
            } else if (!affordability.canAfford) {
                btn.title = 'Not enough coins or special coins.';
            }

            const requirement = this.getPurchaseRequirement(level);
            const requirementLabel = requirement ? `Req: Lv.${requirement}` : 'Starter';
            const specialNote = needsSpecial
                ? `<span class="buy-note">Uses ${this.formatSpecialCoins(affordability.specialCoinsNeeded)} special coins</span>`
                : '';
            btn.innerHTML = `
                <span class="buy-level">Lv.${level}</span>
                <span class="buy-detail">×${catConfig.multiplier.toFixed(2)} • ${catConfig.cost.toLocaleString()}</span>
                <span class="buy-req">${requirementLabel}</span>
                ${specialNote}
            `;
            buttonsEl.appendChild(btn);
        });
    }

    openShop() {
        const modal = this.gameContainer?.querySelector('#cc-shop-modal');
        if (!modal) return;
        this.renderBuyButtons();
        modal.classList.add('open');
        modal.setAttribute('aria-hidden', 'false');
    }

    closeShop() {
        const modal = this.gameContainer?.querySelector('#cc-shop-modal');
        if (!modal) return;
        modal.classList.remove('open');
        modal.setAttribute('aria-hidden', 'true');
    }

    // Render special inventory
    renderSpecialInventory() {
        const inventoryEl = this.gameContainer.querySelector('#cc-special-inventory');
        if (!inventoryEl) return;

        const limit = Number.isFinite(this.inventoryLimit) ? this.inventoryLimit : null;
        const occupied = this.specialInventory.length;

        const statusEl = this.gameContainer.querySelector('#cc-inventory-status');
        if (statusEl) {
            statusEl.textContent = limit === null
                ? `${occupied} stored (Unlimited)`
                : `${occupied}/${limit} slots`;
        }

        const helperEl = this.gameContainer.querySelector('#cc-inventory-helper');
        if (helperEl) {
            if (limit === null) {
                helperEl.textContent = occupied === 0
                    ? 'Fast mode: special inventory is unlimited. Drag specials here anytime.'
                    : 'Fast mode: special inventory is unlimited.';
            } else {
                const remaining = Math.max(0, limit - occupied);
                helperEl.textContent = remaining > 0
                    ? `Slots remaining: ${remaining}. Drag level 51 cats or special pieces here to store them.`
                    : 'Inventory is full. Sell, place, or merge specials to free space.';
            }
        }

        inventoryEl.innerHTML = '';

        const showEmptySlots = Number.isFinite(this.inventoryLimit);
        const slotCount = showEmptySlots ? this.inventoryLimit : occupied;

        if (occupied === 0 && !showEmptySlots) {
            const emptyMessage = document.createElement('div');
            emptyMessage.className = 'inventory-empty';
            emptyMessage.textContent = 'No special cats stored yet.';
            inventoryEl.appendChild(emptyMessage);
        }

        this.specialInventory.forEach((cat, index) => {
            if (!cat) return;
            const slot = document.createElement('div');
            slot.className = 'inventory-slot special-cat filled';
            slot.dataset.index = index;
            slot.dataset.specialId = cat.id;
            const form = cat.form === 'golden' ? 'golden' : 'common';
            slot.classList.add(form);
            const labelType = cat.label || this.formatSpecialLabel(cat.type);
            const formLabel = this.capitalize(form);
            const saleValue = this.calculateSpecialValue(cat);
            const buffMultiplier = Number(cat.buffMultiplier) || this.getSpecialBuff(cat.type, form);
            const buffLabel = `Buff ×${(1 + buffMultiplier).toFixed(2)}`;

            slot.innerHTML = `
                <div class="special-name">${labelType}</div>
                <div class="special-meta">
                    <span class="special-rarity">${formLabel}</span>
                    <span class="special-buff">${buffLabel}</span>
                </div>
                <div class="special-value">${this.formatSpecialCoins(saleValue)} special coins</div>
                <button type="button" class="sell-special-btn" data-index="${index}" draggable="false">Sell</button>
            `;

            slot.draggable = true;
            inventoryEl.appendChild(slot);
        });

        if (showEmptySlots) {
            for (let i = occupied; i < slotCount; i++) {
                const emptySlot = document.createElement('div');
                emptySlot.className = 'inventory-slot empty';
                emptySlot.innerHTML = '<span class="inventory-empty-label">Empty</span>';
                inventoryEl.appendChild(emptySlot);
            }
        }

        const mergeCandidates = this.getMergeCandidates();
        this.mergeCandidates = mergeCandidates;

        const mergeSelect = this.gameContainer.querySelector('#cc-merge-type');
        if (mergeSelect) {
            const previousValue = mergeSelect.value;
            mergeSelect.innerHTML = '';
            const eligible = Object.entries(mergeCandidates)
                .filter(([, meta]) => meta.total >= 5)
                .sort((a, b) => this.formatSpecialLabel(a[0]).localeCompare(this.formatSpecialLabel(b[0])));

            if (eligible.length === 0) {
                mergeSelect.disabled = true;
                const option = document.createElement('option');
                option.value = '';
                option.textContent = 'Merge unavailable';
                option.disabled = true;
                option.selected = true;
                mergeSelect.appendChild(option);
            } else {
                mergeSelect.disabled = false;
                const previousStillValid = eligible.some(([type]) => type === previousValue);
                if (eligible.length > 1 && !previousStillValid) {
                    const placeholder = document.createElement('option');
                    placeholder.value = '';
                    placeholder.textContent = 'Select type';
                    placeholder.disabled = true;
                    placeholder.selected = true;
                    mergeSelect.appendChild(placeholder);
                }

                eligible.forEach(([type, meta]) => {
                    const option = document.createElement('option');
                    option.value = type;
                    const labelParts = [this.formatSpecialLabel(type), `${meta.total} ready`];
                    if (meta.inventory > 0 && meta.board > 0) {
                        labelParts.push(`inv ${meta.inventory} • board ${meta.board}`);
                    } else if (meta.inventory > 0) {
                        labelParts.push(`inventory ${meta.inventory}`);
                    } else if (meta.board > 0) {
                        labelParts.push(`board ${meta.board}`);
                    }
                    option.textContent = labelParts.join(' · ');
                    mergeSelect.appendChild(option);
                });

                if (previousStillValid) {
                    mergeSelect.value = previousValue;
                } else if (eligible.length === 1) {
                    mergeSelect.value = eligible[0][0];
                } else {
                    mergeSelect.value = '';
                }
            }
        }

        this.updateMergeControlsState();

        const counts = this.getSpecialCounts();
        this.updateCollectionPanel(counts);
    }

    updateMergeControlsState() {
        const mergeSelect = this.gameContainer?.querySelector('#cc-merge-type');
        const mergeButton = this.gameContainer?.querySelector('#cc-merge-gold');
        if (!mergeSelect || !mergeButton) return;

        const candidates = this.mergeCandidates || {};
        const selectedType = mergeSelect.value;
        const info = candidates[selectedType];
        const hasEnough = Boolean(info && info.total >= 5);
        let capacityOk = true;
        if (hasEnough) {
            const inventoryConsumed = Math.min(info.inventory, 5);
            capacityOk = this.hasInventoryCapacity({ add: 1, remove: inventoryConsumed });
        }

        mergeButton.disabled = !(hasEnough && capacityOk);
        mergeButton.dataset.type = hasEnough ? selectedType : '';
        if (!hasEnough) {
            mergeButton.title = (!selectedType && !mergeSelect.disabled)
                ? 'Select a special type to merge.'
                : 'Need 5 matching common specials to merge.';
        } else if (!capacityOk) {
            mergeButton.title = 'Inventory is full. Sell or place a special cat first.';
        } else {
            mergeButton.title = '';
        }
    }

    setSellDropzoneActive(active) {
        const zone = this.gameContainer?.querySelector('#cc-sell-dropzone');
        if (zone) {
            zone.classList.toggle('drag-active', Boolean(active));
        }
    }

    setInventoryDropActive(active) {
        const inventory = this.gameContainer?.querySelector('#cc-special-inventory');
        if (inventory) {
            inventory.classList.toggle('drag-accept', Boolean(active));
        }
    }

    resetDragContext() {
        this.dragSource = null;
        this.draggedCat = null;
        this.draggedFromIndex = null;
    }

    showCatDetail(index) {
        if (!Number.isInteger(index) || index < 0 || index >= this.board.length) {
            return;
        }

        const cat = this.board[index];
        if (!cat) {
            this.hideCatDetail();
            return;
        }

        this.selectedCatIndex = index;
        this.renderChessboard();
        this.updateCatDetail();
    }

    hideCatDetail() {
        this.selectedCatIndex = null;
        const detail = this.gameContainer?.querySelector('#cc-cat-detail');
        if (detail) {
            detail.classList.add('hidden');
        }
        this.renderChessboard();
    }

    updateCatDetail() {
        const detail = this.gameContainer?.querySelector('#cc-cat-detail');
        if (!detail) return;

        const titleEl = detail.querySelector('#cc-cat-detail-title');
        const statusEl = detail.querySelector('#cc-cat-detail-status');
        const sellEl = detail.querySelector('#cc-cat-detail-sell');
        const buffEl = detail.querySelector('#cc-cat-detail-buff');
        const bonusEl = detail.querySelector('#cc-cat-detail-bonus');
        const timeEl = detail.querySelector('#cc-cat-detail-time');

        if (this.selectedCatIndex === null) {
            detail.classList.add('hidden');
            if (titleEl) titleEl.textContent = 'Select a cat';
            if (statusEl) statusEl.textContent = 'None';
            if (sellEl) sellEl.textContent = '0';
            if (buffEl) buffEl.textContent = '×1.00';
            if (bonusEl) bonusEl.textContent = '×1.00';
            if (timeEl) timeEl.textContent = '0s';
            return;
        }

        const index = this.selectedCatIndex;
        const cat = this.board[index];
        if (!cat) {
            this.hideCatDetail();
            return;
        }

        const sellInfo = this.getSellInfo(index);
        const multiplier = this.CAT_LEVELS[cat.level]?.multiplier ?? 1;
        const isReady = cat.grown || cat.level >= 51;
        const buffMeta = this.buffHighlightMap?.get(index) || null;
        const buffApplies = cat.level <= 50;
        const buffMultiplier = buffApplies && buffMeta && buffMeta.total > 0 ? (1 + buffMeta.total) : 1;

        if (titleEl) {
            titleEl.textContent = `Lv.${cat.level} • ×${multiplier.toFixed(2)}`;
        }

        if (statusEl) {
            statusEl.textContent = isReady ? 'Ready' : 'Growing';
        }

        if (sellEl) {
            sellEl.textContent = isReady && sellInfo ? this.formatCoins(sellInfo.finalPrice) : '—';
        }

        if (buffEl) {
            buffEl.textContent = `×${buffMultiplier.toFixed(2)}`;
        }

        if (bonusEl) {
            const bonus = sellInfo ? sellInfo.bonusMultiplier : 1;
            bonusEl.textContent = `×${bonus.toFixed(2)}`;
        }

        if (timeEl) {
            timeEl.textContent = isReady ? 'Ready' : this.formatTime(cat.timeLeft);
        }

        detail.classList.remove('hidden');
    }

    getSellInfo(index) {
        if (!Number.isInteger(index) || index < 0 || index >= this.board.length) {
            return null;
        }
        const cat = this.board[index];
        if (!cat) return null;

        const basePrice = this.CAT_LEVELS[cat.level]?.sellPrice ?? 0;
        const bonusMultiplier = Number(this.sellBonuses?.[index]) || 1;
        return {
            basePrice,
            bonusMultiplier,
            finalPrice: Math.round(basePrice * bonusMultiplier)
        };
    }

    formatCoins(value) {
        if (!Number.isFinite(value)) return '0';
        return value.toLocaleString();
    }

    formatSpecialCoins(value) {
        if (!Number.isFinite(value)) return '0';
        return value.toLocaleString();
    }

    confirmSpecialCoinSpend(deficitCoins, specialCoinsNeeded) {
        const shortfall = Math.max(0, Number(deficitCoins) || 0);
        const special = Math.max(0, Number(specialCoinsNeeded) || 0);
        const deficitLabel = this.formatCoins(shortfall);
        const specialLabel = this.formatSpecialCoins(special);
        const ratioLabel = this.SPECIAL_COIN_VALUE.toLocaleString();
        const message = `You are short by ${deficitLabel} coins. Spend ${specialLabel} special coins to complete this purchase?`;

        if (!this.specialConfirmModal) {
            return Promise.resolve(window.confirm(`${message} (1 special coin = ${ratioLabel} coins)`));
        }

        if (typeof this.specialConfirmResolve === 'function') {
            this.specialConfirmResolve(false);
            this.specialConfirmResolve = null;
        }

        if (this.specialConfirmMessageEl) {
            this.specialConfirmMessageEl.textContent = `${message} (1 special coin = ${ratioLabel} coins)`;
        }
        if (this.specialConfirmDeficitEl) {
            this.specialConfirmDeficitEl.textContent = `${deficitLabel} coins`;
        }
        if (this.specialConfirmSpecialEl) {
            this.specialConfirmSpecialEl.textContent = `${specialLabel} special coins`;
        }
        if (this.specialConfirmAcceptBtn) {
            this.specialConfirmAcceptBtn.textContent = `Use ${specialLabel} 💎`;
        }

        this.specialConfirmModal.classList.add('open');
        this.specialConfirmModal.setAttribute('aria-hidden', 'false');
        requestAnimationFrame(() => {
            if (this.specialConfirmAcceptBtn) {
                this.specialConfirmAcceptBtn.focus();
            } else if (this.specialConfirmModal) {
                this.specialConfirmModal.focus();
            }
        });
        window.addEventListener('keydown', this.onSpecialConfirmKeydown);

        return new Promise(resolve => {
            this.specialConfirmResolve = resolve;
        });
    }

    async convertCatToSpecial(fromIndex) {
        if (!Number.isInteger(fromIndex) || fromIndex < 0 || fromIndex >= this.board.length) {
            this.showGameMessage('Invalid board slot.', 'error');
            return;
        }

        const cat = this.board[fromIndex];
        if (!cat) {
            this.showGameMessage('No cat in that cell.', 'error');
            return;
        }

        if (cat.level < 51) {
            this.showGameMessage('Only level 51 cats can become special.', 'error');
            return;
        }

        if (!this.hasInventoryCapacity({ add: 1 })) {
            this.showGameMessage('Special inventory is full.', 'error');
            return;
        }

        try {
            const username = this.getCurrentUsername();
            if (!username) return;

            const knownIds = new Set(this.specialInventory.filter(Boolean).map(item => item.id));

            const response = await fetch('/api/cat-chess/convert_to_special', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, fromIndex })
            });

            if (response.ok) {
                const data = await response.json();
                const created = (data.specialInventory || []).find(cat => cat && !knownIds.has(cat.id));
                this.syncStateFromPayload(data);
                this.updateUI();
                this.hideCatDetail();
                if (created) {
                    const label = created.label || this.formatSpecialLabel(created.type);
                    const formLabel = this.capitalize(created.form || 'common');
                    this.showGameMessage(`Converted to ${formLabel} ${label}!`, 'success');
                } else {
                    this.showGameMessage('Cat moved to special inventory!', 'success');
                }
            } else {
                const error = await response.json();
                this.showGameMessage(error.error || 'Failed to convert cat', 'error');
            }
        } catch (error) {
            console.error('Convert cat to special error:', error);
            this.showGameMessage('Failed to convert cat', 'error');
        }
    }

    async placeSpecialFromInventory(inventoryIndex, cellIndex) {
        const invIndex = Number(inventoryIndex);
        const boardIndex = Number(cellIndex);
        if (!Number.isInteger(invIndex) || invIndex < 0 || invIndex >= this.specialInventory.length) {
            this.showGameMessage('Invalid inventory slot.', 'error');
            return;
        }

        if (!Number.isInteger(boardIndex) || boardIndex < 0 || boardIndex >= this.board.length) {
            this.showGameMessage('Invalid board slot.', 'error');
            return;
        }

        if (this.board[boardIndex]) {
            this.showGameMessage('Cell already occupied.', 'error');
            return;
        }

        const specialCat = this.specialInventory[invIndex];
        if (!specialCat) {
            this.showGameMessage('No special cat in that slot.', 'error');
            return;
        }

        try {
            const username = this.getCurrentUsername();
            if (!username) return;

            const response = await fetch('/api/cat-chess/place_special', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, specialId: specialCat.id, cellIndex: boardIndex })
            });

            if (response.ok) {
                const data = await response.json();
                this.syncStateFromPayload(data);
                this.updateUI();
                this.hideCatDetail();
                const label = specialCat.label || this.formatSpecialLabel(specialCat.type);
                this.showGameMessage(`Placed ${this.capitalize(specialCat.form)} ${label} on the board!`, 'success');
            } else {
                const error = await response.json();
                this.showGameMessage(error.error || 'Failed to place special cat', 'error');
            }
        } catch (error) {
            console.error('Place special cat error:', error);
            this.showGameMessage('Failed to place special cat', 'error');
        }
    }

    async pickupSpecial(cellIndex) {
        const index = Number(cellIndex);
        if (!Number.isInteger(index) || index < 0 || index >= this.board.length) {
            this.showGameMessage('Invalid board slot.', 'error');
            return;
        }

        const cell = this.board[index];
        if (!cell || cell.kind !== 'special') {
            this.showGameMessage('No special cat in that cell.', 'error');
            return;
        }

        if (!this.hasInventoryCapacity({ add: 1 })) {
            this.showGameMessage('Special inventory is full.', 'error');
            return;
        }

        try {
            const username = this.getCurrentUsername();
            if (!username) return;

            const response = await fetch('/api/cat-chess/pickup_special', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, cellIndex: index })
            });

            if (response.ok) {
                const data = await response.json();
                this.syncStateFromPayload(data);
                this.updateUI();
                this.hideCatDetail();
                const label = cell.label || this.formatSpecialLabel(cell.type);
                this.showGameMessage(`Stored ${this.capitalize(cell.form)} ${label} in inventory.`, 'success');
            } else {
                const error = await response.json();
                this.showGameMessage(error.error || 'Failed to store special cat', 'error');
            }
        } catch (error) {
            console.error('Pickup special cat error:', error);
            this.showGameMessage('Failed to store special cat', 'error');
        }
    }

    // Bind game events
    bindGameEvents() {
        this.bindSpecialConfirmEvents();

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
            const buyBtn = e.target.closest('.buy-btn');
            if (buyBtn) {
                const level = parseInt(buyBtn.dataset.level, 10);
                if (!Number.isNaN(level)) {
                    this.buyCat(level);
                }
                return;
            }

            const sellSpecialBtn = e.target.closest('.sell-special-btn');
            if (sellSpecialBtn) {
                const index = parseInt(sellSpecialBtn.dataset.index, 10);
                if (!Number.isNaN(index)) {
                    this.sellSpecialCat(index);
                }
                return;
            }

            const mergeGoldBtn = e.target.closest('#cc-merge-gold');
            if (mergeGoldBtn) {
                const mergeSelect = this.gameContainer.querySelector('#cc-merge-type');
                const selectedType = mergeSelect?.value || mergeGoldBtn.dataset.type || null;
                this.mergeSpecialToGold(selectedType);
                return;
            }

            const upgradeBtn = e.target.closest('.upgrade-special-btn');
            if (upgradeBtn) {
                const type = upgradeBtn.dataset.type;
                if (type) {
                    this.upgradeSpecialCat(type);
                }
                return;
            }

            if (e.target.closest('#cc-open-shop')) {
                this.openShop();
                return;
            }

            if (e.target.closest('#cc-shop-close')) {
                this.closeShop();
                return;
            }

            if (e.target.closest('#cc-sell-all')) {
                this.sellAllCats();
                return;
            }

            if (e.target.closest('#cc-redeem-btn')) {
                this.redeemCode();
                return;
            }
        });

        this.gameContainer.addEventListener('change', (e) => {
            if (e.target.id === 'cc-merge-type') {
                this.updateMergeControlsState();
            }
        });

        const redeemInput = this.gameContainer.querySelector('#cc-redeem-code');
        if (redeemInput) {
            redeemInput.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    this.redeemCode();
                }
            });
        }

        // Chessboard drag and drop
        const boardEl = this.gameContainer.querySelector('#cc-chessboard');
        if (boardEl) {
            boardEl.addEventListener('click', (e) => {
                const pieceEl = e.target.closest('.cat, .special-piece');
                if (!pieceEl) return;
                const index = parseInt(pieceEl.dataset.index, 10);
                if (Number.isNaN(index)) return;
                this.showCatDetail(index);
            });

            boardEl.addEventListener('dragstart', (e) => {
                const pieceEl = e.target.closest('.cat, .special-piece');
                if (pieceEl) {
                    this.draggedCat = pieceEl;
                    this.draggedFromIndex = parseInt(pieceEl.dataset.index, 10);
                    if (!Number.isInteger(this.draggedFromIndex)) return;
                    const kind = pieceEl.dataset.kind || 'cat';
                    this.dragSource = { source: 'board', index: this.draggedFromIndex, kind };
                    e.dataTransfer.setData('text/plain', String(this.draggedFromIndex));
                    e.dataTransfer.effectAllowed = 'move';
                }
            });

            boardEl.addEventListener('dragover', (e) => {
                if (!this.dragSource) return;

                const cellEl = e.target.closest('.cell');
                if (!cellEl) return;

                if (this.dragSource.source === 'inventory') {
                    const toIndex = Number(cellEl.dataset.index);
                    if (!Number.isInteger(toIndex)) return;
                    if (this.board[toIndex]) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    return;
                }

                if (this.dragSource.source === 'board') {
                    const fromIndex = this.dragSource.index;
                    const toIndex = Number(cellEl.dataset.index);
                    if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex) || fromIndex === toIndex) return;
                    const fromPiece = this.board[fromIndex];
                    if (!fromPiece) return;

                    if (fromPiece.kind === 'special') {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                        return;
                    }

                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                }
            });

            boardEl.addEventListener('drop', async (e) => {
                e.preventDefault();
                const cellEl = e.target.closest('.cell');
                if (!cellEl) return;

                const toIndex = Number(cellEl.dataset.index);
                if (!Number.isInteger(toIndex)) {
                    this.resetDragContext();
                    return;
                }

                if (this.dragSource && this.dragSource.source === 'inventory') {
                    await this.placeSpecialFromInventory(this.dragSource.index, toIndex);
                } else if (this.dragSource && this.dragSource.source === 'board') {
                    const fromIndex = this.dragSource.index;
                    if (!Number.isInteger(fromIndex) || fromIndex === toIndex) {
                        this.resetDragContext();
                        return;
                    }

                    const fromPiece = this.board[fromIndex];
                    if (!fromPiece) {
                        this.showGameMessage('No cat to move.', 'error');
                    } else if (fromPiece.kind === 'special') {
                        const toPiece = this.board[toIndex] || null;
                        const action = !toPiece ? 'move'
                            : (toPiece.kind === 'special' ? 'swap-special' : 'swap-cat');
                        await this.moveSpecialOnBoard(fromIndex, toIndex, { action });
                    } else {
                        const toPiece = this.board[toIndex];
                        if (!toPiece) {
                            await this.moveCat(fromIndex, toIndex);
                        } else if (toPiece.kind === 'special') {
                            this.showGameMessage('Cannot merge with a special cat.', 'error');
                        } else if (fromPiece.level === toPiece.level) {
                            await this.mergeCats(fromIndex, toIndex);
                        } else {
                            await this.swapCats(fromIndex, toIndex);
                        }
                    }
                }

                this.resetDragContext();
                this.setSellDropzoneActive(false);
                this.setInventoryDropActive(false);
            });

            boardEl.addEventListener('dragend', () => {
                this.resetDragContext();
                this.setSellDropzoneActive(false);
                this.setInventoryDropActive(false);
            });
        }

        const sellZone = this.gameContainer.querySelector('#cc-sell-dropzone');
        if (sellZone) {
            sellZone.addEventListener('dragover', (e) => {
                const dragSource = this.dragSource;
                if (!dragSource || dragSource.source !== 'board') return;
                const fromPiece = this.board[dragSource.index];
                if (!fromPiece) return;
                const sellable = fromPiece.kind === 'special' || fromPiece.level >= 51 || fromPiece.grown;
                if (!sellable) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                this.setSellDropzoneActive(true);
            });

            sellZone.addEventListener('dragleave', () => {
                this.setSellDropzoneActive(false);
            });

            sellZone.addEventListener('drop', async (e) => {
                e.preventDefault();
                this.setSellDropzoneActive(false);
                if (this.dragSource && this.dragSource.source === 'board') {
                    await this.sellCat(this.dragSource.index);
                }
                this.resetDragContext();
            });
        }

        const inventoryEl = this.gameContainer.querySelector('#cc-special-inventory');
        if (inventoryEl) {
            inventoryEl.addEventListener('dragstart', (e) => {
                const slot = e.target.closest('.special-cat');
                if (!slot || e.target.closest('.sell-special-btn')) return;
                const index = Number(slot.dataset.index);
                if (!Number.isInteger(index)) return;
                const cat = this.specialInventory[index];
                if (!cat) return;
                this.dragSource = { source: 'inventory', index };
                e.dataTransfer.setData('text/plain', `inventory:${index}`);
                e.dataTransfer.effectAllowed = 'move';
            });

            ['dragenter', 'dragover'].forEach(evt => {
                inventoryEl.addEventListener(evt, (e) => {
                    const dragSource = this.dragSource;
                    if (!dragSource || dragSource.source !== 'board') return;
                    const fromPiece = this.board[dragSource.index];
                    if (!fromPiece) return;
                    const eligible = fromPiece.kind === 'special' || fromPiece.level >= 51;
                    if (!eligible) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    this.setInventoryDropActive(true);
                });
            });

            ['dragleave', 'dragend'].forEach(evt => {
                inventoryEl.addEventListener(evt, () => {
                    this.setInventoryDropActive(false);
                });
            });

            inventoryEl.addEventListener('drop', async (e) => {
                e.preventDefault();
                this.setInventoryDropActive(false);
                if (this.dragSource && this.dragSource.source === 'board') {
                    const fromPiece = this.board[this.dragSource.index];
                    if (fromPiece?.kind === 'special') {
                        await this.pickupSpecial(this.dragSource.index);
                    } else if (fromPiece?.level >= 51) {
                        await this.convertCatToSpecial(this.dragSource.index);
                    } else {
                        this.showGameMessage('Only level 51 cats can be stored with specials.', 'error');
                    }
                }
                this.resetDragContext();
            });

            inventoryEl.addEventListener('dragend', () => {
                this.resetDragContext();
                this.setInventoryDropActive(false);
            });
        }

        const detailClose = this.gameContainer.querySelector('#cc-cat-detail-close');
        if (detailClose) {
            detailClose.addEventListener('click', () => this.hideCatDetail());
        }

        // Sell collection
        const sellCommonBtn = this.gameContainer.querySelector('#cc-sell-common');
        if (sellCommonBtn) {
            sellCommonBtn.addEventListener('click', () => this.sellCollection('common'));
        }

        const sellGoldenBtn = this.gameContainer.querySelector('#cc-sell-golden');
        if (sellGoldenBtn) {
            sellGoldenBtn.addEventListener('click', () => this.sellCollection('golden'));
        }

        const shopModal = this.gameContainer.querySelector('#cc-shop-modal');
        if (shopModal) {
            shopModal.addEventListener('click', (event) => {
                if (event.target === shopModal) {
                    this.closeShop();
                }
            });
        }
    }

    // Unbind game events
    unbindGameEvents() {
        // Events are bound to elements that will be removed, so no need to unbind
    }

    async redeemCode() {
        if (!this.config?.enableRedeem) return;

        const input = this.gameContainer?.querySelector('#cc-redeem-code');
        if (!input) return;

        const code = input.value.trim().toUpperCase();
        if (!code) {
            this.showGameMessage('Please enter a code.', 'error');
            return;
        }

        try {
            const username = this.getCurrentUsername();
            if (!username) return;

            const response = await fetch('/api/cat-chess/redeem', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, code })
            });

            const data = await response.json();
            if (response.ok && data.success) {
                this.syncStateFromPayload(data);
                this.updateUI();
                input.value = '';
                const message = typeof data.message === 'string' && data.message.trim().length > 0
                    ? data.message
                    : 'Code redeemed successfully!';
                this.showGameMessage(message, 'success');
            } else {
                this.showGameMessage(data.error || 'Invalid code.', 'error');
            }
        } catch (error) {
            console.error('Redeem code error:', error);
            this.showGameMessage('Failed to redeem code.', 'error');
        }
    }

    // Buy cat
    async buyCat(level, options = {}) {
        const { allowSpecialFallback = false } = options;

        try {
            const username = this.getCurrentUsername();
            if (!username) return;

            const targetLevel = Number(level);
            if (!Number.isInteger(targetLevel) || targetLevel < 1) {
                this.showGameMessage('Invalid level selected.', 'error');
                return;
            }

            const catConfig = this.CAT_LEVELS[targetLevel];
            if (!catConfig) {
                this.showGameMessage('Unknown cat level.', 'error');
                return;
            }

            const affordability = this.getSpecialPurchaseFallback(catConfig.cost);
            if (!affordability.canAfford) {
                const message = affordability.requiresSpecialFallback
                    ? 'Not enough special coins to cover the cost.'
                    : 'Not enough coins.';
                this.showGameMessage(message, 'error');
                return;
            }

            let useSpecialFallback = false;
            if (affordability.requiresSpecialFallback) {
                if (!allowSpecialFallback) {
                    const confirmed = await this.confirmSpecialCoinSpend(affordability.deficitCoins, affordability.specialCoinsNeeded);
                    if (!confirmed) {
                        this.showGameMessage('Purchase cancelled.', 'info');
                        return;
                    }
                }
                useSpecialFallback = true;
            }

            const payload = { username, level: targetLevel };
            if (useSpecialFallback) {
                payload.useSpecialFallback = true;
            }

            const response = await fetch('/api/cat-chess/buy', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (response.ok) {
                const data = await response.json();
                this.syncStateFromPayload(data);
                this.updateUI();
                const spent = Number(data.specialCoinsSpent) || 0;
                if (spent > 0) {
                    const coinsEquivalent = spent * this.SPECIAL_COIN_VALUE;
                    this.showGameMessage(`Cat purchased! Spent ${this.formatSpecialCoins(spent)} special coins (${this.formatCoins(coinsEquivalent)} coins).`, 'success');
                } else {
                    this.showGameMessage('Cat purchased!', 'success');
                }
            } else {
                const error = await response.json();
                if (response.status === 409 && error.requiresSpecialFallback && !allowSpecialFallback) {
                    const confirmed = await this.confirmSpecialCoinSpend(error.deficitCoins ?? 0, error.specialCoinsRequired ?? 0);
                    if (confirmed) {
                        await this.buyCat(level, { allowSpecialFallback: true });
                    } else {
                        this.showGameMessage('Purchase cancelled.', 'info');
                    }
                    return;
                }
                this.showGameMessage(error.error || 'Failed to buy cat', 'error');
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

    async moveSpecialOnBoard(fromIndex, toIndex, { action = 'move' } = {}) {
        const from = Number(fromIndex);
        const to = Number(toIndex);

        if (!Number.isInteger(from) || !Number.isInteger(to)) {
            this.showGameMessage('Invalid board indices.', 'error');
            return;
        }

        const origin = this.board[from];
        if (!origin || origin.kind !== 'special') {
            this.showGameMessage('No special cat in that cell.', 'error');
            return;
        }

        try {
            const username = this.getCurrentUsername();
            if (!username) return;

            const response = await fetch('/api/cat-chess/move_special', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, fromIndex: from, toIndex: to })
            });

            if (response.ok) {
                const data = await response.json();
                this.syncStateFromPayload(data);
                this.updateUI();
                this.hideCatDetail();

                const messages = {
                    move: 'Special cat moved to the new cell!',
                    'swap-cat': 'Swapped special cat with the neighbor!',
                    'swap-special': 'Special cats swapped successfully!'
                };

                this.showGameMessage(messages[action] || 'Special cat repositioned!', 'success');
            } else {
                const error = await response.json();
                this.showGameMessage(error.error || 'Failed to move special cat', 'error');
            }
        } catch (error) {
            console.error('Move special cat error:', error);
            this.showGameMessage('Failed to move special cat', 'error');
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

    async sellAllCats() {
        if (this.sellAllPending) {
            return;
        }

        const username = this.getCurrentUsername();
        if (!username) return;

        const sellAllBtn = this.gameContainer.querySelector('#cc-sell-all');
        if (sellAllBtn) sellAllBtn.disabled = true;
        this.sellAllPending = true;

        try {
            const previousCoins = this.coins;
            const response = await fetch('/api/cat-chess/sell_all', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username })
            });

            if (response.ok) {
                const data = await response.json();
                const coinsEarned = Number.isFinite(data.coinsEarned)
                    ? data.coinsEarned
                    : (typeof data.coins === 'number' ? Math.max(0, data.coins - previousCoins) : 0);

                this.syncStateFromPayload(data);
                this.updateUI();
                this.hideCatDetail();

                const sold = data.soldCount ?? 0;
                const notReady = data.notReadyCount ?? 0;
                const ineligible = data.ineligibleCount ?? 0;

                if (sold === 0) {
                    if (notReady > 0) {
                        this.showGameMessage(`${notReady} cat${notReady === 1 ? '' : 's'} are still growing.`, 'info');
                    } else {
                        this.showGameMessage('No cats were sold.', 'info');
                    }
                    return;
                }

                const parts = [`Sold ${sold} cat${sold === 1 ? '' : 's'} for ${this.formatCoins(coinsEarned)} coins.`];
                if (notReady > 0) {
                    parts.push(`${notReady} cat${notReady === 1 ? '' : 's'} still growing.`);
                }
                if (ineligible > 0) {
                    parts.push(`${ineligible} slot${ineligible === 1 ? '' : 's'} skipped.`);
                }

                this.showGameMessage(parts.join(' '), 'success');
            } else {
                const error = await response.json();
                this.showGameMessage(error.error || 'Failed to sell cats', 'error');
            }
        } catch (error) {
            console.error('Sell all cats error:', error);
            this.showGameMessage('Failed to sell cats', 'error');
        } finally {
            this.sellAllPending = false;
            if (sellAllBtn) sellAllBtn.disabled = false;
        }
    }

    // Sell matured cat
    async sellCat(cellIndex) {
        const index = Number(cellIndex);
        if (!Number.isInteger(index) || index < 0 || index >= this.board.length) {
            this.showGameMessage('Invalid board slot.', 'error');
            return;
        }

        const piece = this.board[index];
        if (!piece) {
            this.showGameMessage('No cat to sell in that cell.', 'error');
            return;
        }

        if (piece.kind === 'special') {
            await this.sellSpecialFromBoard(index);
            return;
        }

        const cat = piece;

        if (!cat.grown && cat.level < 51) {
            this.showGameMessage('This cat is still growing.', 'error');
            return;
        }

        const sellInfo = this.getSellInfo(index);
        const salePrice = sellInfo ? sellInfo.finalPrice : (this.CAT_LEVELS[cat.level]?.sellPrice ?? 0);

        try {
            const username = this.getCurrentUsername();
            if (!username) return;
            const previousCoins = this.coins;

            const response = await fetch('/api/cat-chess/sell', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, cellIndex: index })
            });

            if (response.ok) {
                const data = await response.json();
                const coinsEarned = typeof data.coins === 'number' ? data.coins - previousCoins : salePrice;
                this.syncStateFromPayload(data);
                this.updateUI();
                this.hideCatDetail();
                const earned = Number.isFinite(coinsEarned) ? coinsEarned : salePrice;
                const message = earned > 0
                    ? `Sold Lv.${cat.level} cat for ${this.formatCoins(earned)} coins!`
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
    async sellCollection(form = 'common') {
        const targetForm = form === 'golden' ? 'golden' : 'common';
        const counts = this.getSpecialCounts();
        const requiredTypes = Object.keys(this.SPECIAL_CAT_TYPES);
        const ready = requiredTypes.every(type => (counts?.[targetForm]?.[type] ?? 0) > 0);

        if (!ready) {
            this.showGameMessage(`Need all 5 ${targetForm} special types to sell that collection.`, 'info');
            return;
        }

        try {
            const username = this.getCurrentUsername();
            if (!username) return;
            const previousSpecial = this.specialCurrency;

            const response = await fetch('/api/cat-chess/sell_collection', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, form: targetForm })
            });

            if (response.ok) {
                const data = await response.json();
                const payout = Number.isFinite(data.payout) ? data.payout : 0;
                const specialEarned = Number.isFinite(data.specialCurrency)
                    ? Math.max(0, data.specialCurrency - previousSpecial)
                    : payout;

                this.syncStateFromPayload(data);
                this.updateUI();

                const earned = specialEarned > 0 ? specialEarned : payout;
                const soldLabel = (data.soldCollectionForm || targetForm) === 'golden' ? 'Golden' : 'Common';
                if (earned > 0) {
                    this.showGameMessage(`${soldLabel} collection sold for ${this.formatSpecialCoins(earned)} special coins!`, 'success');
                } else {
                    this.showGameMessage(`${soldLabel} collection sold!`, 'success');
                }
            } else {
                const error = await response.json();
                this.showGameMessage(error.error || 'Failed to sell collection', 'error');
            }
        } catch (error) {
            console.error('Sell collection error:', error);
            this.showGameMessage('Failed to sell collection', 'error');
        }
    }

    async sellSpecialFromBoard(cellIndex) {
        const index = Number(cellIndex);
        if (!Number.isInteger(index) || index < 0 || index >= this.board.length) {
            this.showGameMessage('Invalid board slot.', 'error');
            return;
        }

        const cell = this.board[index];
        if (!cell || cell.kind !== 'special') {
            this.showGameMessage('No special cat in that cell.', 'error');
            return;
        }

        const saleValue = this.calculateSpecialValue(cell);

        try {
            const username = this.getCurrentUsername();
            if (!username) return;
            const previousSpecial = this.specialCurrency;

            const response = await fetch('/api/cat-chess/sell_special', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, cellIndex: index })
            });

            if (response.ok) {
                const data = await response.json();
                const specialEarned = typeof data.specialCurrency === 'number' ? data.specialCurrency - previousSpecial : saleValue;
                this.syncStateFromPayload(data);
                this.updateUI();
                this.hideCatDetail();
                const earned = Number.isFinite(specialEarned) ? specialEarned : saleValue;
                this.showGameMessage(`Special cat sold for ${this.formatSpecialCoins(earned)} special coins!`, 'success');
            } else {
                const error = await response.json();
                this.showGameMessage(error.error || 'Failed to sell special cat', 'error');
            }
        } catch (error) {
            console.error('Sell special cat error:', error);
            this.showGameMessage('Failed to sell special cat', 'error');
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
            const previousSpecial = this.specialCurrency;

            const response = await fetch('/api/cat-chess/sell_special', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, inventoryIndex: index })
            });

            if (response.ok) {
                const data = await response.json();
                const specialEarned = typeof data.specialCurrency === 'number' ? data.specialCurrency - previousSpecial : saleValue;
                this.syncStateFromPayload(data);
                this.updateUI();
                const earned = Number.isFinite(specialEarned) ? specialEarned : saleValue;
                this.showGameMessage(`Special cat sold for ${this.formatSpecialCoins(earned)} special coins!`, 'success');
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

    async mergeSpecialToGold(type) {
        const mergeType = type && this.SPECIAL_CAT_TYPES[type] ? type : null;
        if (!mergeType) {
            this.showGameMessage('Select a special type to merge.', 'info');
            return;
        }

        const candidates = this.mergeCandidates && Object.keys(this.mergeCandidates).length > 0
            ? this.mergeCandidates
            : this.getMergeCandidates();
        const info = candidates[mergeType];
        if (!info || info.total < 5) {
            this.showGameMessage('Need 5 matching common specials to merge.', 'info');
            return;
        }

        const inventoryConsumed = Math.min(info.inventory, 5);
        if (!this.hasInventoryCapacity({ add: 1, remove: inventoryConsumed })) {
            this.showGameMessage('Inventory is full. Sell or place a special cat first.', 'error');
            return;
        }

        try {
            const username = this.getCurrentUsername();
            if (!username) return;

            const response = await fetch('/api/cat-chess/merge_gold', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, type: mergeType })
            });

            if (response.ok) {
                const data = await response.json();
                this.syncStateFromPayload(data);
                this.updateUI();
                const mergedType = data.mergedType || mergeType;
                const label = this.formatSpecialLabel(mergedType);
                this.showGameMessage(`${label} merged into a Golden special!`, 'success');
            } else {
                const error = await response.json();
                this.showGameMessage(error.error || 'Failed to merge to gold', 'error');
            }
        } catch (error) {
            console.error('Merge gold error:', error);
            this.showGameMessage('Failed to merge to gold', 'error');
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

        const shouldRefreshDetail = this.selectedCatIndex !== null;

        if (hasChanges) {
            this.renderChessboard();
        }

        if (shouldRefreshDetail) {
            this.updateCatDetail();
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

        if (Object.prototype.hasOwnProperty.call(data, 'inventoryLimit')) {
            const limit = data.inventoryLimit;
            if (typeof limit === 'number' && Number.isFinite(limit)) {
                this.inventoryLimit = limit;
            } else {
                this.inventoryLimit = null;
            }
        }

        if (Array.isArray(data.board)) {
            this.board = data.board.map(cat => this.normalizeBoardCell(cat));
            if (this.board.length < 64) {
                this.board = this.board.concat(Array(64 - this.board.length).fill(null));
            } else if (this.board.length > 64) {
                this.board = this.board.slice(0, 64);
            }
        }

        if (data && typeof data.sellBonuses === 'object' && data.sellBonuses !== null) {
            this.sellBonuses = { ...data.sellBonuses };
        } else {
            this.sellBonuses = {};
        }

        if (Array.isArray(data.unlockedLevels)) {
            this.unlockedLevels = data.unlockedLevels;
        }

        if (Array.isArray(data.specialInventory)) {
            if (Number.isFinite(this.inventoryLimit)) {
                this.specialInventory = data.specialInventory.slice(0, this.inventoryLimit);
            } else {
                this.specialInventory = data.specialInventory.slice();
            }
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
        this.updateCatDetail();
    }

    normalizeBoardCell(cat) {
        if (!cat) return null;
        if (cat.kind === 'special') {
            const type = cat.type;
            const form = cat.form === 'golden' ? 'golden' : 'common';
            const definition = this.getSpecialDefinition(type);
            const baseValue = Number(cat.baseValue) || Number(definition?.baseValue) || 0;
            const saleMultiplier = Number(cat.saleMultiplier) || (form === 'golden' ? 5 : 1);
            const buffMultiplier = Number(cat.buffMultiplier);
            return {
                kind: 'special',
                id: cat.id,
                type,
                form,
                label: cat.label || definition?.label || this.formatSpecialLabel(type),
                baseValue,
                saleMultiplier,
                buffMultiplier: Number.isFinite(buffMultiplier) ? buffMultiplier : this.getSpecialBuff(type, form),
                createdAt: cat.createdAt || new Date().toISOString()
            };
        }

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
        if (window.toastManager) {
            window.toastManager.show(message, type);
            return;
        }

        const container = this.ensureToastContainer();
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = `toast toast--${type}`;
        toast.textContent = message;
        container.appendChild(toast);

        requestAnimationFrame(() => {
            toast.classList.add('visible');
        });

        const removeToast = () => {
            toast.classList.remove('visible');
            setTimeout(() => {
                if (toast.parentElement === container) {
                    container.removeChild(toast);
                }
            }, 250);
        };

        const timeoutId = setTimeout(removeToast, 4500);
        toast.addEventListener('click', () => {
            clearTimeout(timeoutId);
            removeToast();
        });

        while (container.childElementCount > 4) {
            container.removeChild(container.firstElementChild);
        }
    }

    // Get game container
    getContainer() {
        return this.gameContainer;
    }
}