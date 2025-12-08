const MAX_GRID_COLUMNS = 4;
const SESSION_FOOD_LIMIT = 3;
const FOOD_COST_COINS = 100; // Keep in sync with backend/routes/fishes.js

const DEFAULT_UPGRADES = Object.freeze({
    noStockTimer: false,
    noFeedingLimit: false,
    noAquariumLimit: false
});

const DEFAULT_LIMITS = Object.freeze({
    feedPerSession: SESSION_FOOD_LIMIT,
    aquariumMaxSize: 20,
    shopRestockSeconds: 0
});

export default class FishesGame {
    constructor() {
        this.gameManager = null;
        this.gameContainer = null;
        this.isRunning = false;
        this.statusInterval = null;
        this.gameLoopInterval = null;
        this.messageTimeout = null;
        this.consoleMessages = true;
        this.username = null;

        this.state = {
            coins: 0,
            food: 0,
            aquarium: { size: 1, maxSize: 20, canExpand: false, nextExpansionCost: null },
            fishes: [],
            shop: { secondsUntilRestock: 0, catalog: {}, purchases: {} },
            freeFood: { available: true, secondsRemaining: 0, amount: 10 },
            timers: { feedCooldown: 0, shopRestock: 0, freeFood: 0 },
            metrics: { totalFish: 0, occupiedSlots: 0, capacity: 1 },
            upgrades: { ...DEFAULT_UPGRADES },
            limits: { ...DEFAULT_LIMITS }
        };

        this.lastSync = Date.now();
        this.feedModal = null;
        this.feedSlider = null;
        this.feedValueLabel = null;
        this.feedProgressLabel = null;
        this.feedSessionLabel = null;
        this.feedHint = null;
        this.feedConfirmButton = null;
        this.feedCancelButton = null;
        this.feedMaxButton = null;
        this.feedModalName = null;
        this.currentFeedFishId = null;
        this.currentFeedFish = null;
        this.feedConfirmDefaultLabel = 'Feed';
        this.isFeedRequestInFlight = false;
        this.handleKeydown = null;
        this.feedModalClickHandler = null;
        this.feedConfirmHandler = null;
        this.feedCancelHandler = null;
        this.feedSliderHandler = null;
        this.feedMaxHandler = null;

        this.buyFoodModal = null;
        this.buyFoodSlider = null;
        this.buyFoodValueLabel = null;
        this.buyFoodBalanceLabel = null;
        this.buyFoodCostLabel = null;
        this.buyFoodHint = null;
        this.buyFoodConfirmButton = null;
        this.buyFoodCancelButton = null;
        this.buyFoodMaxButton = null;
        this.buyFoodConfirmDefaultLabel = 'Buy';
        this.isBuyFoodRequestInFlight = false;
        this.buyFoodModalClickHandler = null;
        this.buyFoodConfirmHandler = null;
        this.buyFoodCancelHandler = null;
        this.buyFoodSliderHandler = null;
        this.buyFoodMaxHandler = null;
    }

    cacheModalElements() {
        this.cacheFeedModalElements();
        this.cacheBuyFoodModalElements();
    }

    cacheFeedModalElements() {
        if (!this.gameContainer) return;
        this.feedModal = this.gameContainer.querySelector('[data-role="feed-modal"]');
        if (!this.feedModal) return;

        if (this.feedModal.parentElement !== document.body) {
            document.body.appendChild(this.feedModal);
        }

        this.feedModalName = this.feedModal.querySelector('[data-role="feed-modal-name"]');
        this.feedSlider = this.feedModal.querySelector('[data-role="feed-modal-slider"]');
        this.feedValueLabel = this.feedModal.querySelector('[data-role="feed-modal-value"]');
        this.feedProgressLabel = this.feedModal.querySelector('[data-role="feed-modal-progress"]');
        this.feedSessionLabel = this.feedModal.querySelector('[data-role="feed-modal-session"]');
        this.feedHint = this.feedModal.querySelector('[data-role="feed-modal-hint"]');
        this.feedConfirmButton = this.feedModal.querySelector('[data-action="feed-confirm"]');
        this.feedCancelButton = this.feedModal.querySelector('[data-action="feed-cancel"]');
        this.feedMaxButton = this.feedModal.querySelector('[data-action="feed-max"]');
        if (this.feedConfirmButton && this.feedConfirmButton.textContent) {
            this.feedConfirmDefaultLabel = this.feedConfirmButton.textContent;
        }
        if (this.feedModal) {
            this.feedModal.hidden = true;
            this.feedModal.setAttribute('hidden', 'hidden');
            this.feedModal.classList.remove('visible');
        }
        if (this.feedSlider) {
            this.feedSlider.value = '1';
        }

        if (!this.feedModalClickHandler) {
            this.feedModalClickHandler = (event) => {
                const target = event.target;
                if (!(target instanceof HTMLElement)) return;
                if (target === this.feedModal) {
                    event.preventDefault();
                    this.closeFeedModal();
                }
            };
            this.feedModal.addEventListener('click', this.feedModalClickHandler);
        }

        if (this.feedConfirmButton && !this.feedConfirmHandler) {
            this.feedConfirmHandler = async (event) => {
                event.preventDefault();
                await this.confirmFeedModal();
            };
            this.feedConfirmButton.addEventListener('click', this.feedConfirmHandler);
        }

        if (this.feedCancelButton && !this.feedCancelHandler) {
            this.feedCancelHandler = (event) => {
                event.preventDefault();
                this.closeFeedModal();
            };
            this.feedCancelButton.addEventListener('click', this.feedCancelHandler);
        }

        if (this.feedSlider && !this.feedSliderHandler) {
            this.feedSliderHandler = (event) => {
                if (!(event.target instanceof HTMLInputElement)) return;
                const value = Math.max(1, Number.parseInt(event.target.value, 10) || 1);
                this.updateFeedModalPreview(value);
            };
            this.feedSlider.addEventListener('input', this.feedSliderHandler);
        }

        if (this.feedMaxButton && !this.feedMaxHandler) {
            this.feedMaxHandler = (event) => {
                event.preventDefault();
                this.applyFeedMax();
            };
            this.feedMaxButton.addEventListener('click', this.feedMaxHandler);
        }
    }

    cacheBuyFoodModalElements() {
        if (!this.gameContainer) return;
        this.buyFoodModal = this.gameContainer.querySelector('[data-role="buy-food-modal"]');
        if (!this.buyFoodModal) return;

        if (this.buyFoodModal.parentElement !== document.body) {
            document.body.appendChild(this.buyFoodModal);
        }

        this.buyFoodSlider = this.buyFoodModal.querySelector('[data-role="buy-food-slider"]');
        this.buyFoodValueLabel = this.buyFoodModal.querySelector('[data-role="buy-food-value"]');
        this.buyFoodBalanceLabel = this.buyFoodModal.querySelector('[data-role="buy-food-balance"]');
        this.buyFoodCostLabel = this.buyFoodModal.querySelector('[data-role="buy-food-cost"]');
        this.buyFoodHint = this.buyFoodModal.querySelector('[data-role="buy-food-hint"]');
        this.buyFoodConfirmButton = this.buyFoodModal.querySelector('[data-action="buy-food-confirm"]');
        this.buyFoodCancelButton = this.buyFoodModal.querySelector('[data-action="buy-food-cancel"]');
        this.buyFoodMaxButton = this.buyFoodModal.querySelector('[data-action="buy-food-max"]');
        if (this.buyFoodConfirmButton && this.buyFoodConfirmButton.textContent) {
            this.buyFoodConfirmDefaultLabel = this.buyFoodConfirmButton.textContent;
        }

        this.buyFoodModal.hidden = true;
        this.buyFoodModal.setAttribute('hidden', 'hidden');
        this.buyFoodModal.classList.remove('visible');
        if (this.buyFoodSlider) {
            this.buyFoodSlider.value = '1';
        }

        if (!this.buyFoodModalClickHandler) {
            this.buyFoodModalClickHandler = (event) => {
                const target = event.target;
                if (!(target instanceof HTMLElement)) return;
                if (target === this.buyFoodModal) {
                    event.preventDefault();
                    this.closeBuyFoodModal();
                }
            };
            this.buyFoodModal.addEventListener('click', this.buyFoodModalClickHandler);
        }

        if (this.buyFoodConfirmButton && !this.buyFoodConfirmHandler) {
            this.buyFoodConfirmHandler = async (event) => {
                event.preventDefault();
                await this.confirmBuyFoodModal();
            };
            this.buyFoodConfirmButton.addEventListener('click', this.buyFoodConfirmHandler);
        }

        if (this.buyFoodCancelButton && !this.buyFoodCancelHandler) {
            this.buyFoodCancelHandler = (event) => {
                event.preventDefault();
                this.closeBuyFoodModal();
            };
            this.buyFoodCancelButton.addEventListener('click', this.buyFoodCancelHandler);
        }

        if (this.buyFoodMaxButton && !this.buyFoodMaxHandler) {
            this.buyFoodMaxHandler = (event) => {
                event.preventDefault();
                this.applyBuyFoodMax();
            };
            this.buyFoodMaxButton.addEventListener('click', this.buyFoodMaxHandler);
        }
    }

    registerKeyHandlers() {
        if (this.handleKeydown) {
            window.removeEventListener('keydown', this.handleKeydown);
        }
        this.handleKeydown = (event) => {
            const feedOpen = this.feedModal && !this.feedModal.hidden;
            const buyOpen = this.buyFoodModal && !this.buyFoodModal.hidden;
            if (!feedOpen && !buyOpen) {
                return;
            }
            if (event.key === 'Escape') {
                if (feedOpen) {
                    this.closeFeedModal();
                }
                if (buyOpen) {
                    this.closeBuyFoodModal();
                }
                return;
            }
            if (event.key === 'Enter') {
                if (feedOpen && this.feedConfirmButton && !this.feedConfirmButton.disabled) {
                    event.preventDefault();
                    this.confirmFeedModal();
                    return;
                }
                if (buyOpen && this.buyFoodConfirmButton && !this.buyFoodConfirmButton.disabled) {
                    event.preventDefault();
                    this.confirmBuyFoodModal();
                }
            }
        };
        window.addEventListener('keydown', this.handleKeydown);
    }

    setGameManager(gameManager) {
        this.gameManager = gameManager;
    }

    async start() {
        if (this.consoleMessages) console.log('🐟 Starting Fishes game...');
        this.username = this.getUsername();
        if (!this.username) {
            throw new Error('User must be logged in to play Fishes');
        }

        this.isRunning = true;
        this.gameContainer = document.getElementById('game-area');
        if (!this.gameContainer) {
            throw new Error('Game area element not found');
        }

        await this.loadConfig();
        await this.loadGameTemplate();
        this.cacheModalElements();
        this.bindEvents();
        this.registerKeyHandlers();
        await this.loadGameData();
        this.startStatusRefresh();
        this.startGameLoop();
    }

    stop() {
        if (this.consoleMessages) console.log('🐟 Stopping Fishes game...');
        this.isRunning = false;

        if (this.statusInterval) {
            clearInterval(this.statusInterval);
            this.statusInterval = null;
        }

        if (this.gameLoopInterval) {
            clearInterval(this.gameLoopInterval);
            this.gameLoopInterval = null;
        }

        if (this.messageTimeout) {
            clearTimeout(this.messageTimeout);
            this.messageTimeout = null;
        }

        if (this.handleKeydown) {
            window.removeEventListener('keydown', this.handleKeydown);
            this.handleKeydown = null;
        }

        this.closeFeedModal();

        if (this.feedModal && this.feedModal.parentElement === document.body) {
            document.body.removeChild(this.feedModal);
        }

        this.feedModal = null;
        this.feedModalName = null;
        this.feedSlider = null;
        this.feedValueLabel = null;
        this.feedProgressLabel = null;
        this.feedSessionLabel = null;
        this.feedHint = null;
        this.feedConfirmButton = null;
        this.feedCancelButton = null;
        this.feedModalClickHandler = null;
        this.feedConfirmHandler = null;
        this.feedCancelHandler = null;
        this.feedSliderHandler = null;
    }

    async loadConfig() {
        try {
            const response = await fetch('/api/config');
            if (!response.ok) {
                return;
            }
            const config = await response.json();
            this.consoleMessages = Boolean(config.consoleMessages);
        } catch (error) {
            console.error('Fishes config load error:', error);
        }
    }

    async loadGameTemplate() {
        const container = this.gameContainer;
        container.innerHTML = `
            <link rel="stylesheet" href="./games/fishes/style.css">
            <div class="fishes-game">
                <div class="game-header">
                    <h1>🐟 Fishes</h1>
                    <div class="header-controls">
                        <div class="resource coins">
                            <span class="icon">💰</span>
                            <span class="value" data-role="coins">0</span>
                        </div>
                        <div class="resource food">
                            <span class="icon">🍤</span>
                            <span class="value" data-role="food">0</span>
                        </div>
                        <button class="back-button" data-action="back">← Menu</button>
                    </div>
                </div>

                <div class="game-content">
                    <div class="aquarium-panel">
                        <div class="panel-header">
                            <h2>Central Aquarium</h2>
                            <div class="capacity" data-role="capacity"></div>
                        </div>
                        <div class="aquarium-grid" data-role="aquarium-grid"></div>
                        <button class="expand-button" data-action="expand">Expand Aquarium</button>
                        <div class="expand-hint" data-role="expand-hint"></div>
                    </div>

                    <div class="sidebar">
                        <div class="shop-panel">
                            <div class="panel-header">
                                <h3>Fish Shop</h3>
                                <span class="restock" data-role="restock-timer"></span>
                            </div>
                            <div class="shop-items" data-role="shop-items"></div>
                        </div>

                        <div class="food-panel">
                            <h3>Food Supplies</h3>
                            <div class="food-balance" data-role="food-balance">Food: 0</div>
                            <div class="food-actions">
                                <button data-action="buy-food">Buy Food</button>
                                <button data-action="collect-free-food">Collect Free Food</button>
                            </div>
                            <div class="free-food-status" data-role="free-food-status"></div>
                        </div>
                    </div>
                </div>

                <div class="message-banner" data-role="message" style="display:none;"></div>
                <div class="modal-backdrop feed-modal-backdrop" data-role="feed-modal" hidden>
                    <div class="feed-modal-dialog" data-role="feed-modal-dialog">
                        <div class="modal-header">
                            <h3 data-role="feed-modal-name">Feed Fish</h3>
                            <button class="modal-close" data-action="feed-cancel" aria-label="Close feed modal">&times;</button>
                        </div>
                        <div class="modal-body">
                            <div class="modal-section" data-role="feed-modal-progress">Progress: 0/0 food</div>
                            <div class="modal-section" data-role="feed-modal-session">Food used this session: 0/${SESSION_FOOD_LIMIT}</div>
                            <div class="modal-slider">
                                <div class="slider-row">
                                    <input type="range" min="1" max="1" value="1" step="1" data-role="feed-modal-slider">
                                    <button type="button" class="max-button" data-action="feed-max">Max</button>
                                </div>
                                <div class="slider-value"><span data-role="feed-modal-value">1</span> food</div>
                            </div>
                            <div class="modal-hint" data-role="feed-modal-hint">Select how much food to feed.</div>
                        </div>
                        <div class="modal-actions">
                            <button class="confirm-button" data-action="feed-confirm">Feed</button>
                            <button class="cancel-button" data-action="feed-cancel">Cancel</button>
                        </div>
                    </div>
                </div>
                <div class="modal-backdrop feed-modal-backdrop buy-food-modal" data-role="buy-food-modal" hidden>
                    <div class="feed-modal-dialog" data-role="buy-food-modal-dialog">
                        <div class="modal-header">
                            <h3>Buy Food</h3>
                            <button class="modal-close" data-action="buy-food-cancel" aria-label="Close buy food modal">&times;</button>
                        </div>
                        <div class="modal-body">
                            <div class="modal-section" data-role="buy-food-balance">Coins available: 0</div>
                            <div class="modal-section" data-role="buy-food-cost">Cost per unit: ${FOOD_COST_COINS.toLocaleString()} coins</div>
                            <div class="modal-slider">
                                <div class="slider-row">
                                    <input type="range" min="1" max="1" value="1" step="1" data-role="buy-food-slider">
                                    <button type="button" class="max-button" data-action="buy-food-max">Max</button>
                                </div>
                                <div class="slider-value"><span data-role="buy-food-value">1</span> food</div>
                            </div>
                            <div class="modal-hint" data-role="buy-food-hint">Select how much food to buy.</div>
                        </div>
                        <div class="modal-actions">
                            <button class="confirm-button" data-action="buy-food-confirm">Buy</button>
                            <button class="cancel-button" data-action="buy-food-cancel">Cancel</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    bindEvents() {
        const container = this.gameContainer;
        if (!container) return;

        container.addEventListener('click', async (event) => {
            const target = event.target;
            if (!(target instanceof HTMLElement)) return;

            const action = target.dataset.action;

            if (action === 'back') {
                event.preventDefault();
                if (this.gameManager) {
                    this.gameManager.returnToMenu();
                }
                return;
            }

            if (action === 'expand') {
                event.preventDefault();
                await this.expandAquarium();
                return;
            }

            if (action === 'buy-food') {
                event.preventDefault();
                await this.buyFood();
                return;
            }

            if (action === 'collect-free-food') {
                event.preventDefault();
                await this.collectFreeFood();
                return;
            }

            if (target.classList.contains('feed-button')) {
                const fishId = target.dataset.fishId;
                if (fishId) {
                    await this.feedFish(fishId);
                }
                return;
            }

            if (target.classList.contains('sell-button')) {
                const fishId = target.dataset.fishId;
                if (fishId) {
                    await this.sellFish(fishId);
                }
                return;
            }

            if (target.classList.contains('buy-fish-button')) {
                const type = target.dataset.fishType;
                if (type) {
                    await this.buyFish(type);
                }
                return;
            }

            if (target.classList.contains('open-shop')) {
                const shopPanel = container.querySelector('.shop-panel');
                if (shopPanel) {
                    shopPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
                return;
            }
        });
    }

    async loadGameData(options = {}) {
        try {
            const response = await fetch(`/api/fishes/status/${this.username}`);
            if (!response.ok) {
                if (!options.silent) {
                    const error = await response.json().catch(() => ({}));
                    this.showMessage(error.error || 'Failed to load Fishes data', 'error');
                }
                return;
            }

            const data = await response.json();
            this.syncStateFromPayload(data);
            this.updateUI();

            if (data.message) {
                this.showMessage(data.message, 'success');
            }
        } catch (error) {
            if (!options.silent) {
                console.error('Fishes status load error:', error);
                this.showMessage('Unable to reach aquarium server.', 'error');
            }
        }
    }

    syncStateFromPayload(payload) {
        this.state.coins = payload.coins ?? this.state.coins;
        this.state.food = payload.food ?? this.state.food;
        this.state.aquarium = { ...payload.aquarium };
        this.state.fishes = Array.isArray(payload.fishes) ? payload.fishes.map((fish) => ({ ...fish })) : [];
        this.state.shop = payload.shop ? {
            restockAt: payload.shop.restockAt,
            secondsUntilRestock: payload.shop.secondsUntilRestock ?? 0,
            purchases: { ...(payload.shop.purchases || {}) },
            catalog: Object.keys(payload.shop.catalog || {}).reduce((acc, key) => {
                acc[key] = { ...payload.shop.catalog[key] };
                return acc;
            }, {})
        } : { secondsUntilRestock: 0, catalog: {}, purchases: {} };
        this.state.freeFood = payload.freeFood ? { ...payload.freeFood } : { available: true, secondsRemaining: 0, amount: 10 };
        this.state.timers = payload.timers ? { ...payload.timers } : { feedCooldown: 0, shopRestock: 0, freeFood: 0 };
        this.state.metrics = payload.metrics ? { ...payload.metrics } : { totalFish: this.state.fishes.length, occupiedSlots: this.state.fishes.length, capacity: this.state.aquarium?.size || 0 };
        const previousLimits = this.state.limits || DEFAULT_LIMITS;
        this.state.upgrades = { ...DEFAULT_UPGRADES, ...(payload.upgrades || {}) };
        this.state.limits = {
            feedPerSession: payload.limits?.feedPerSession ?? previousLimits.feedPerSession ?? DEFAULT_LIMITS.feedPerSession,
            aquariumMaxSize: payload.limits?.aquariumMaxSize ?? previousLimits.aquariumMaxSize ?? DEFAULT_LIMITS.aquariumMaxSize,
            shopRestockSeconds: payload.limits?.shopRestockSeconds ?? previousLimits.shopRestockSeconds ?? DEFAULT_LIMITS.shopRestockSeconds
        };

        this.lastSync = Date.now();
        this.syncCurrency();
    }

    updateUI() {
        this.updateResourceBar();
        this.renderAquarium();
        this.renderShop();
        this.renderFoodPanel();
        this.updateExpandState();
        this.refreshFeedModalState();
        this.refreshBuyFoodModalState();
    }

    updateResourceBar() {
        const coinsEl = this.gameContainer.querySelector('[data-role="coins"]');
        const foodEl = this.gameContainer.querySelector('[data-role="food"]');
        if (coinsEl) {
            coinsEl.textContent = this.state.coins.toLocaleString();
        }
        if (foodEl) {
            foodEl.textContent = this.state.food.toLocaleString();
        }
    }

    renderAquarium() {
        const grid = this.gameContainer.querySelector('[data-role="aquarium-grid"]');
        if (!grid) return;

        const size = this.state.aquarium?.size || 1;
        const fishes = this.state.fishes;
        grid.style.setProperty('--columns', Math.min(MAX_GRID_COLUMNS, size));

        grid.innerHTML = '';

        for (let index = 0; index < size; index += 1) {
            const fish = fishes[index] || null;
            const slot = document.createElement('div');
            slot.className = fish ? 'fish-card' : 'fish-slot empty';

            if (fish) {
                slot.innerHTML = this.getFishCardMarkup(fish);
            } else {
                slot.innerHTML = `
                    <div class="empty-body">
                        <div class="empty-title">Empty Slot</div>
                        <div class="empty-text">Purchase a new fish to occupy this slot.</div>
                        <button class="open-shop">Open Shop</button>
                    </div>
                `;
            }

            grid.appendChild(slot);
        }

        const capacityEl = this.gameContainer.querySelector('[data-role="capacity"]');
        if (capacityEl) {
            const occupied = this.state.fishes.length;
            capacityEl.textContent = `Capacity: ${occupied}/${size}`;
        }
    }

    getFishCardMarkup(fish) {
        const tierLabel = `Tier ${fish.tier ?? 1}`;
        const maxLevel = fish.maxLevel ?? 1;
        const levelLabel = `Level ${fish.level}/${maxLevel}`;
        const sellLabel = fish.potentialSellValue ? `Sell Price: ${fish.potentialSellValue.toLocaleString()} coins` : 'Reach level 2 to sell';
        const cooldown = fish.cooldownRemaining ?? 0;
        const remainingFood = Math.max(0, fish.remainingFoodForLevel ?? fish.nextLevelCost?.remainingFood ?? 0);
        const requiredFood = Math.max(0, fish.requiredFoodForLevel ?? fish.nextLevelCost?.requiredFoodTotal ?? fish.nextLevelCost?.food ?? 0);
        const fedSoFar = requiredFood > 0 ? requiredFood - remainingFood : 0;
        const progressPercent = requiredFood > 0 ? Math.min(100, Math.round((fedSoFar / requiredFood) * 100)) : 100;
        const nextLevelText = fish.level >= maxLevel ? 'Max level reached' : `${remainingFood} food to next level`;
        const progressLabel = fish.level >= maxLevel ? 'Max level reached' : `${fedSoFar}/${requiredFood} food (${progressPercent}%)`;
        const hasFeedLimit = Number.isFinite(fish.maxFeedsPerSession);
        const sessionTotal = hasFeedLimit ? Math.max(0, fish.maxFeedsPerSession) : null;
        const feedsUsedRaw = hasFeedLimit ? Math.max(0, fish.sessionFeedsUsed ?? 0) : null;
        const sessionRemainingRaw = hasFeedLimit ? Math.max(0, fish.sessionFeedsRemaining ?? 0) : null;
        const feedsUsed = hasFeedLimit ? Math.min(sessionTotal, feedsUsedRaw ?? 0) : null;
        const sessionRemaining = hasFeedLimit ? Math.max(0, sessionTotal - (feedsUsed ?? 0)) : null;
        const feedSessionLabel = hasFeedLimit
            ? `${feedsUsed}/${sessionTotal} food used${sessionRemaining > 0 ? ` | ${sessionRemaining} left` : ' | resting'}`
            : 'No feeding limit active';
        const canFeed = fish.canFeed && remainingFood > 0 && (!hasFeedLimit || (sessionRemaining ?? 0) > 0);
        const statusText = cooldown > 0
            ? `Cooling down: ${this.formatTime(cooldown)}`
            : canFeed
                ? 'Ready to feed'
                : hasFeedLimit && (sessionRemaining ?? 0) <= 0
                    ? 'Resting (limit reached)'
                    : remainingFood <= 0
                        ? 'Ready to level up'
                        : 'Awaiting resources';
        const statusClass = canFeed && cooldown === 0 ? 'ready' : 'paused';

        const feedDisabled = !canFeed;
        const sellDisabled = fish.potentialSellValue == null;

        return `
            <div class="fish-head">
                <div>
                    <div class="fish-name">${fish.name}</div>
                    <div class="fish-tier">${tierLabel}</div>
                </div>
                <div class="fish-level">${levelLabel}</div>
            </div>
            <div class="fish-info">
                <div class="info-row">
                    <span>Next Level:</span>
                    <span>${nextLevelText}</span>
                </div>
                <div class="feed-progress">
                    <div class="progress-bar">
                        <div class="progress-fill" style="width:${progressPercent}%;"></div>
                    </div>
                    <div class="progress-label">${progressLabel}</div>
                </div>
                <div class="info-row">
                    <span>Session Limit:</span>
                    <span>${feedSessionLabel}</span>
                </div>
                <div class="info-row">
                    <span>Status:</span>
                    <span class="cooldown ${statusClass}">${statusText}</span>
                </div>
                <div class="info-row">
                    <span>Total Food:</span>
                    <span>${fish.foodConsumed.toLocaleString()} units</span>
                </div>
                <div class="info-row">
                    <span>${sellDisabled ? 'Sell:' : 'Sell ready:'}</span>
                    <span>${sellLabel}</span>
                </div>
            </div>
            <div class="fish-actions">
                <button class="feed-button" data-fish-id="${fish.id}" ${feedDisabled ? 'disabled' : ''}>Feed</button>
                <button class="sell-button" data-fish-id="${fish.id}" ${sellDisabled ? 'disabled' : ''}>Sell</button>
            </div>
        `;
    }

        renderShop() {
        const shopContainer = this.gameContainer.querySelector('[data-role="shop-items"]');
        const restockTimer = this.gameContainer.querySelector('[data-role="restock-timer"]');
        if (!shopContainer) return;

            const { catalog = {}, purchases = {}, secondsUntilRestock = 0 } = this.state.shop;
            const globalUnlimitedStock = Boolean(this.state.upgrades?.noStockTimer);
        shopContainer.innerHTML = '';

        if (restockTimer) {
                restockTimer.textContent = globalUnlimitedStock
                    ? 'Premium shop unlocked'
                    : secondsUntilRestock > 0
                        ? `Restock in ${this.formatTime(secondsUntilRestock)}`
                        : 'Shop restocked';
        }

        Object.keys(catalog).forEach((key) => {
            const item = catalog[key];
            const bought = purchases[key] || 0;
                const itemUnlimited = Boolean(item.unlimitedStock || globalUnlimitedStock);
                const fallbackAvailability = item.restockLimit != null ? item.restockLimit - bought : Number.POSITIVE_INFINITY;
                const rawAvailability = typeof item.available === 'number' ? item.available : fallbackAvailability;
                const available = itemUnlimited ? Number.POSITIVE_INFINITY : Math.max(0, rawAvailability);
            const affordable = this.state.coins >= item.baseCost;
            const capacityReached = this.state.fishes.length >= this.state.aquarium.size;
                const disabled = (!itemUnlimited && available <= 0) || !affordable || capacityReached;
                const limitLabel = itemUnlimited
                    ? 'Unlimited'
                    : `${bought}/${item.restockLimit ?? '—'}`;
                const statusLabel = itemUnlimited
                    ? 'Always available'
                    : available > 0
                        ? 'Available'
                        : 'Waiting for restock';

            const card = document.createElement('div');
            card.className = 'shop-card';
            card.innerHTML = `
                <div class="shop-head">
                    <div class="shop-name">${item.name}</div>
                    <div class="shop-tier">Tier ${item.tier}</div>
                </div>
                <div class="shop-details">
                    <div class="detail-row"><span>Cost:</span><span>${item.baseCost.toLocaleString()} coins</span></div>
                        <div class="detail-row"><span>Limit:</span><span>${limitLabel}</span></div>
                        <div class="detail-row"><span>Status:</span><span>${statusLabel}</span></div>
                    <p class="shop-desc">${item.description || ''}</p>
                </div>
                <button class="buy-fish-button" data-fish-type="${key}" ${disabled ? 'disabled' : ''}>Buy Fish</button>
            `;

            shopContainer.appendChild(card);
        });
    }

    renderFoodPanel() {
        const balanceEl = this.gameContainer.querySelector('[data-role="food-balance"]');
        const freeFoodStatus = this.gameContainer.querySelector('[data-role="free-food-status"]');
        const freeFoodBtn = this.gameContainer.querySelector('[data-action="collect-free-food"]');

        if (balanceEl) {
            balanceEl.textContent = `Food: ${this.state.food.toLocaleString()} units`;
        }

        if (freeFoodStatus) {
            const { available, secondsRemaining } = this.state.freeFood;
            freeFoodStatus.textContent = available
                ? 'Daily free food is ready!'
                : `Next free food in ${this.formatTime(secondsRemaining)}`;
        }

        if (freeFoodBtn) {
            freeFoodBtn.disabled = !this.state.freeFood.available;
        }
    }

    updateExpandState() {
        const expandBtn = this.gameContainer.querySelector('[data-action="expand"]');
        const hintEl = this.gameContainer.querySelector('[data-role="expand-hint"]');

        if (!expandBtn || !hintEl) return;

        const { aquarium } = this.state;
        const hasCap = Number.isFinite(aquarium.maxSize);
        const atMax = hasCap ? aquarium.size >= aquarium.maxSize : false;
        const canExpand = aquarium.canExpand && !atMax;
        const nextCost = aquarium.nextExpansionCost;

        expandBtn.disabled = !canExpand;
        if (atMax) {
            hintEl.textContent = 'Maximum aquarium size reached.';
        } else if (!aquarium.canExpand) {
            hintEl.textContent = 'Fill every slot before expanding again.';
        } else if (!hasCap) {
            hintEl.textContent = nextCost != null
                ? `Next expansion cost: ${nextCost.toLocaleString()} coins (no limit).`
                : 'Unlimited expansions unlocked.';
        } else if (nextCost != null) {
            hintEl.textContent = `Next expansion cost: ${nextCost.toLocaleString()} coins.`;
        } else {
            hintEl.textContent = '';
        }
    }

    startStatusRefresh() {
        this.statusInterval = setInterval(() => {
            if (!this.isRunning) return;
            this.loadGameData({ silent: true });
        }, 7000);
    }

    startGameLoop() {
        this.gameLoopInterval = setInterval(() => {
            if (!this.isRunning) return;
            this.tickCountdowns();
        }, 1000);
    }

    tickCountdowns() {
        const now = Date.now();
        const deltaSeconds = Math.floor((now - this.lastSync) / 1000);
        this.lastSync = now;

        if (Number.isFinite(deltaSeconds) && deltaSeconds > 0) {
            this.state.fishes = this.state.fishes.map((fish) => {
                if (!fish) return fish;
                const previousCooldown = Math.max(0, fish.cooldownRemaining ?? 0);
                const cooldownRemaining = Math.max(0, previousCooldown - deltaSeconds);
                const hasFeedLimit = Number.isFinite(fish.maxFeedsPerSession);
                const maxFeeds = hasFeedLimit ? Math.max(0, fish.maxFeedsPerSession ?? 0) : null;
                let sessionRemaining = hasFeedLimit ? Math.max(0, fish.sessionFeedsRemaining ?? (maxFeeds ?? 0)) : null;
                let sessionUsed = hasFeedLimit ? Math.max(0, fish.sessionFeedsUsed ?? 0) : null;
                if (hasFeedLimit && previousCooldown > 0 && cooldownRemaining === 0) {
                    sessionRemaining = maxFeeds;
                    sessionUsed = 0;
                }
                if (hasFeedLimit && maxFeeds > 0) {
                    sessionUsed = Math.min(maxFeeds, sessionUsed ?? 0);
                    const remainingAfterUse = Math.max(0, maxFeeds - (sessionUsed ?? 0));
                    sessionRemaining = Math.max(0, Math.min(maxFeeds, sessionRemaining ?? maxFeeds, remainingAfterUse));
                }
                const remainingFoodForLevel = Math.max(0, fish.remainingFoodForLevel ?? 0);
                const canFeed = cooldownRemaining === 0
                    && fish.level < (fish.maxLevel ?? 0)
                    && (!hasFeedLimit || (sessionRemaining ?? 0) > 0)
                    && remainingFoodForLevel > 0;
                return {
                    ...fish,
                    cooldownRemaining,
                    sessionFeedsRemaining: hasFeedLimit ? sessionRemaining : null,
                    sessionFeedsUsed: hasFeedLimit ? sessionUsed : null,
                    canFeed
                };
            });

            if (this.state.shop.secondsUntilRestock > 0) {
                this.state.shop.secondsUntilRestock = Math.max(0, this.state.shop.secondsUntilRestock - deltaSeconds);
            }

            if (this.state.freeFood.secondsRemaining > 0) {
                this.state.freeFood.secondsRemaining = Math.max(0, this.state.freeFood.secondsRemaining - deltaSeconds);
                if (this.state.freeFood.secondsRemaining === 0) {
                    this.state.freeFood.available = true;
                }
            }

            this.updateUI();
        }
    }

    async feedFish(fishId) {
        const fish = this.getFishById(fishId);
        if (!fish) {
            this.showMessage('Fish not found.', 'error');
            return;
        }
        this.openFeedModal(fish);
    }

    getFishById(fishId) {
        if (!fishId) return null;
        return this.state.fishes.find((fish) => fish && fish.id === fishId) || null;
    }

    getFeedConstraints(fish, requestedAmount = 1) {
        const fallbackFood = Math.max(0, Math.floor(this.state.food));
        if (!fish) {
            return {
                canFeed: false,
                remaining: 0,
                required: 0,
                sessionRemaining: 0,
                sessionTotal: 0,
                availableFood: fallbackFood,
                maxFeed: 0,
                amount: 0,
                afterRemaining: 0
            };
        }

        const remaining = Math.max(0, Math.floor(fish.remainingFoodForLevel ?? 0));
        const required = Math.max(0, Math.floor(fish.requiredFoodForLevel ?? 0));
        const hasFeedLimit = Number.isFinite(fish.maxFeedsPerSession);
        const sessionTotal = hasFeedLimit ? Math.max(0, Math.floor(fish.maxFeedsPerSession)) : null;
        const sessionUnlimited = !hasFeedLimit;
        const sessionUsed = hasFeedLimit ? Math.min(sessionTotal, Math.max(0, Math.floor(fish.sessionFeedsUsed ?? 0))) : 0;
        const rawRemaining = hasFeedLimit
            ? Math.max(0, Math.floor(fish.sessionFeedsRemaining ?? 0))
            : remaining;
        const sessionRemaining = hasFeedLimit
            ? Math.max(0, Math.min(sessionTotal, sessionTotal - sessionUsed, rawRemaining))
            : rawRemaining;
        const availableFood = Math.max(0, Math.floor(this.state.food));
        const sessionLimit = sessionUnlimited ? remaining : sessionRemaining;
        const maxFeed = remaining > 0 ? Math.min(remaining, availableFood, sessionLimit) : 0;
        const amountRequested = Math.max(1, Math.floor(requestedAmount || 1));
        const amount = maxFeed > 0 ? Math.min(amountRequested, maxFeed) : 0;
        const afterRemaining = Math.max(0, remaining - amount);
        const canFeed = Boolean(
            fish.canFeed &&
            (sessionUnlimited || sessionRemaining > 0) &&
            remaining > 0 &&
            availableFood > 0 &&
            maxFeed > 0
        );

        return {
            canFeed,
            remaining,
            required,
            sessionRemaining,
            sessionTotal,
            sessionUsed,
            sessionUnlimited,
            availableFood,
            maxFeed,
            amount,
            afterRemaining
        };
    }

    openFeedModal(fish) {
        if (!fish || !this.feedModal) return;
        this.setFeedModalContent(fish);
        this.feedModal.hidden = false;
        this.feedModal.removeAttribute('hidden');
        this.feedModal.classList.add('visible');
        this.updateBodyModalState();
    }

    setFeedModalContent(fish) {
        if (!fish) return;
        this.currentFeedFishId = fish.id;
        this.currentFeedFish = { ...fish };

        if (this.feedModalName) {
            this.feedModalName.textContent = `${fish.name} - Level ${fish.level}/${fish.maxLevel}`;
        }

        const sliderCurrent = this.feedSlider ? Math.max(1, Number.parseInt(this.feedSlider.value, 10) || 1) : 1;
        let constraints = this.getFeedConstraints(fish, sliderCurrent);

        const fedSoFar = constraints.required > 0 ? constraints.required - constraints.remaining : 0;
        const progressPercent = constraints.required > 0
            ? Math.min(100, Math.round((fedSoFar / constraints.required) * 100))
            : 100;

        if (this.feedProgressLabel) {
            if (fish.level >= fish.maxLevel || constraints.required === 0) {
                this.feedProgressLabel.textContent = 'Max level reached.';
            } else {
                this.feedProgressLabel.textContent = `Progress: ${fedSoFar}/${constraints.required} food (${progressPercent}%)`;
            }
        }

        if (this.feedSessionLabel) {
            if (constraints.sessionUnlimited) {
                this.feedSessionLabel.textContent = 'No feeding limit active.';
            } else if (constraints.sessionTotal > 0) {
                const feedsUsed = Math.max(0, constraints.sessionUsed ?? (constraints.sessionTotal - constraints.sessionRemaining));
                const status = constraints.sessionRemaining > 0
                    ? `${constraints.sessionRemaining} food left before rest`
                    : 'Limit reached (resting)';
                this.feedSessionLabel.textContent = `Food used this session: ${feedsUsed}/${constraints.sessionTotal} | ${status}`;
            } else {
                this.feedSessionLabel.textContent = `Food remaining this session: ${constraints.sessionRemaining}`;
            }
        }

        if (this.feedSlider) {
            this.feedSlider.step = '1';
            this.feedSlider.min = '1';
            const sliderMax = constraints.maxFeed >= 1 ? constraints.maxFeed : 1;
            this.feedSlider.max = String(sliderMax);
            const sliderValue = constraints.maxFeed >= 1
                ? Math.min(Math.max(1, Number.parseInt(this.feedSlider.value, 10) || 1), constraints.maxFeed)
                : 1;
            this.feedSlider.value = String(sliderValue);
            this.feedSlider.disabled = !constraints.canFeed || constraints.maxFeed < 1 || this.isFeedRequestInFlight;
            constraints = this.getFeedConstraints(fish, sliderValue);
            this.updateFeedModalPreview(sliderValue, constraints);
        } else {
            this.updateFeedModalPreview(constraints.amount, constraints);
        }
    }

    updateFeedModalPreview(value, constraintsOverride = null) {
        if (!this.currentFeedFish) return;
        const constraints = constraintsOverride ?? this.getFeedConstraints(this.currentFeedFish, value);
        const amount = Math.max(0, constraints.amount);

        if (this.feedValueLabel) {
            this.feedValueLabel.textContent = amount.toLocaleString();
        }

        if (this.feedHint) {
            let hintMessage = 'Select how many food units to feed.';
            if (this.currentFeedFish.level >= this.currentFeedFish.maxLevel) {
                hintMessage = 'This fish already reached max level.';
            } else if (!constraints.sessionUnlimited && constraints.sessionRemaining <= 0) {
                hintMessage = 'Food limit reached. Wait for cooldown.';
            } else if (constraints.availableFood <= 0) {
                hintMessage = 'You need more food to feed this fish.';
            } else if (constraints.remaining <= 0) {
                hintMessage = 'This fish is ready to level up. Try again soon.';
            } else if (!constraints.canFeed) {
                hintMessage = 'Cannot feed this fish right now.';
            } else if (constraints.afterRemaining === 0) {
                hintMessage = 'This feed will level up the fish.';
            } else {
                hintMessage = `This feed leaves ${constraints.afterRemaining} food remaining to level up.`;
            }
            const sessionSummary = constraints.sessionUnlimited
                ? 'Session remaining: Unlimited'
                : (() => {
                    const sessionTotalForDisplay = constraints.sessionTotal
                        || (constraints.sessionRemaining + (constraints.sessionUsed ?? 0))
                        || constraints.sessionRemaining
                        || (constraints.sessionUsed ?? 0)
                        || SESSION_FOOD_LIMIT;
                    return `Session remaining: ${constraints.sessionRemaining}/${sessionTotalForDisplay} food`;
                })();
            hintMessage = `${hintMessage} (Food available: ${constraints.availableFood.toLocaleString()} | ${sessionSummary})`;
            this.feedHint.textContent = hintMessage;
        }

        if (this.feedSlider) {
            const sliderShouldDisable = !constraints.canFeed || constraints.maxFeed < 1 || this.isFeedRequestInFlight;
            this.feedSlider.disabled = sliderShouldDisable;
        }

        if (this.feedMaxButton) {
            this.feedMaxButton.disabled = !constraints.canFeed || constraints.maxFeed < 1 || this.isFeedRequestInFlight;
        }

        if (this.feedConfirmButton) {
            const confirmEnabled = constraints.canFeed && amount > 0 && !this.isFeedRequestInFlight;
            this.feedConfirmButton.disabled = !confirmEnabled;
            this.feedConfirmButton.textContent = confirmEnabled
                ? `${this.feedConfirmDefaultLabel} ${amount} food`
                : this.feedConfirmDefaultLabel;
        }
    }

    refreshFeedModalState() {
        if (!this.feedModal || this.feedModal.hidden || !this.currentFeedFishId) {
            return;
        }
        const fish = this.getFishById(this.currentFeedFishId);
        if (!fish) {
            this.closeFeedModal();
            return;
        }
        this.setFeedModalContent(fish);
    }

    closeFeedModal() {
        if (!this.feedModal) return;
        this.feedModal.hidden = true;
        this.feedModal.setAttribute('hidden', 'hidden');
        this.feedModal.classList.remove('visible');
        this.currentFeedFishId = null;
        this.currentFeedFish = null;
        if (this.feedSlider) {
            this.feedSlider.disabled = false;
            this.feedSlider.value = '1';
        }
        if (this.feedConfirmButton) {
            this.feedConfirmButton.disabled = false;
            this.feedConfirmButton.textContent = this.feedConfirmDefaultLabel;
        }
        if (this.feedMaxButton) {
            this.feedMaxButton.disabled = false;
        }
        this.updateBodyModalState();
    }

    async confirmFeedModal() {
        if (!this.feedModal || this.feedModal.hidden) return;
        if (!this.currentFeedFishId || !this.feedSlider) return;

        const sliderValue = Math.max(1, Number.parseInt(this.feedSlider.value, 10) || 1);
        const fish = this.getFishById(this.currentFeedFishId) || this.currentFeedFish;
        if (!fish) {
            this.showMessage('Fish not found.', 'error');
            this.closeFeedModal();
            return;
        }

        const constraints = this.getFeedConstraints(fish, sliderValue);
        if (!constraints.canFeed || constraints.amount <= 0) {
            this.updateFeedModalPreview(sliderValue, constraints);
            this.showMessage('This fish cannot be fed right now.', 'error');
            return;
        }

        if (this.isFeedRequestInFlight) {
            return;
        }

        this.isFeedRequestInFlight = true;
        if (this.feedSlider) {
            this.feedSlider.disabled = true;
        }
        if (this.feedConfirmButton) {
            this.feedConfirmButton.disabled = true;
            this.feedConfirmButton.textContent = 'Feeding...';
        }

        try {
            const response = await fetch('/api/fishes/feed', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: this.username,
                    fishId: this.currentFeedFishId,
                    foodAmount: constraints.amount
                })
            });

            const data = await response.json().catch(() => null);

            if (!response.ok || !data) {
                const errorMessage = data?.error || 'Feeding failed';
                this.showMessage(errorMessage, 'error');
                await this.loadGameData({ silent: true });
                return;
            }

            this.syncStateFromPayload(data);
            this.updateUI();
            if (data.message) {
                this.showMessage(data.message, 'success');
            } else {
                this.showMessage('Fish fed successfully!', 'success');
            }

            const updatedFish = this.getFishById(this.currentFeedFishId);
            if (updatedFish && updatedFish.canFeed) {
                this.setFeedModalContent(updatedFish);
            } else {
                this.closeFeedModal();
            }
        } catch (error) {
            console.error('Feed fish error:', error);
            this.showMessage('Feeding failed due to a network error', 'error');
            await this.loadGameData({ silent: true });
        } finally {
            this.isFeedRequestInFlight = false;
            if (this.feedConfirmButton) {
                this.feedConfirmButton.textContent = this.feedConfirmDefaultLabel;
            }
            if (this.feedModal && !this.feedModal.hidden) {
                const currentValue = this.feedSlider
                    ? Math.max(1, Number.parseInt(this.feedSlider.value, 10) || 1)
                    : 1;
                this.updateFeedModalPreview(currentValue);
            }
        }
    }

    applyFeedMax() {
        if (!this.feedSlider) {
            return;
        }
        const fish = (this.currentFeedFishId && this.getFishById(this.currentFeedFishId)) || this.currentFeedFish;
        if (!fish) {
            this.updateFeedModalPreview(0);
            return;
        }
        const constraints = this.getFeedConstraints(fish);
        if (constraints.maxFeed >= 1) {
            this.feedSlider.value = String(constraints.maxFeed);
            this.updateFeedModalPreview(constraints.maxFeed, constraints);
        } else {
            this.updateFeedModalPreview(constraints.amount ?? 0, constraints);
        }
    }

    getBuyFoodConstraints(requestedAmount = 1) {
        const coins = Math.max(0, Math.floor(this.state.coins ?? 0));
        const maxAffordable = Math.max(0, Math.floor(coins / FOOD_COST_COINS));
        const amountRequested = Math.max(1, Math.floor(requestedAmount || 1));
        const amount = maxAffordable > 0 ? Math.min(amountRequested, maxAffordable) : 0;
        const cost = amount * FOOD_COST_COINS;
        const maxCost = maxAffordable * FOOD_COST_COINS;
        return {
            coins,
            maxAffordable,
            amount,
            cost,
            maxCost,
            canBuy: maxAffordable > 0 && amount > 0
        };
    }

    openBuyFoodModal() {
        if (!this.buyFoodModal) return;
        this.setBuyFoodModalContent();
        this.buyFoodModal.hidden = false;
        this.buyFoodModal.removeAttribute('hidden');
        this.buyFoodModal.classList.add('visible');
        this.updateBodyModalState();
    }

    setBuyFoodModalContent() {
        if (!this.buyFoodModal) return;
        const sliderCurrent = this.buyFoodSlider ? Math.max(1, Number.parseInt(this.buyFoodSlider.value, 10) || 1) : 1;
        let constraints = this.getBuyFoodConstraints(sliderCurrent);

        if (this.buyFoodBalanceLabel) {
            this.buyFoodBalanceLabel.textContent = `Coins available: ${constraints.coins.toLocaleString()}`;
        }
        if (this.buyFoodCostLabel) {
            this.buyFoodCostLabel.textContent = `Cost per unit: ${FOOD_COST_COINS.toLocaleString()} coins`;
        }

        if (this.buyFoodSlider) {
            this.buyFoodSlider.step = '1';
            this.buyFoodSlider.min = '1';
            const sliderMax = constraints.maxAffordable >= 1 ? constraints.maxAffordable : 1;
            this.buyFoodSlider.max = String(sliderMax);
            const sliderValue = constraints.maxAffordable >= 1
                ? Math.min(Math.max(1, Number.parseInt(this.buyFoodSlider.value, 10) || 1), constraints.maxAffordable)
                : 1;
            this.buyFoodSlider.value = String(sliderValue);
            const sliderDisabled = this.isBuyFoodRequestInFlight || constraints.maxAffordable < 1;
            this.buyFoodSlider.disabled = sliderDisabled;
            constraints = this.getBuyFoodConstraints(sliderValue);
        }

        this.updateBuyFoodModalPreview(constraints.amount || 0, constraints);
    }

    updateBuyFoodModalPreview(value, constraintsOverride = null) {
        if (!this.buyFoodModal) return;
        const constraints = constraintsOverride ?? this.getBuyFoodConstraints(value);
        const amount = Math.max(0, constraints.amount);
        const cost = constraints.cost;

        if (this.buyFoodValueLabel) {
            this.buyFoodValueLabel.textContent = amount.toLocaleString();
        }

        if (this.buyFoodHint) {
            let hint = 'Select how much food to buy.';
            if (!constraints.canBuy) {
                hint = 'Not enough coins to buy food right now.';
            } else if (constraints.maxAffordable === amount) {
                hint = `Max purchase selected. This costs ${cost.toLocaleString()} coins.`;
            } else {
                hint = `This costs ${cost.toLocaleString()} coins. Max available: ${constraints.maxAffordable.toLocaleString()} food (${constraints.maxCost.toLocaleString()} coins).`;
            }
            this.buyFoodHint.textContent = hint;
        }

        if (this.buyFoodSlider) {
            const disableSlider = this.isBuyFoodRequestInFlight || constraints.maxAffordable < 1;
            this.buyFoodSlider.disabled = disableSlider;
        }

        if (this.buyFoodMaxButton) {
            this.buyFoodMaxButton.disabled = this.isBuyFoodRequestInFlight || constraints.maxAffordable < 1;
        }

        if (this.buyFoodConfirmButton) {
            const confirmEnabled = constraints.canBuy && !this.isBuyFoodRequestInFlight;
            this.buyFoodConfirmButton.disabled = !confirmEnabled;
            this.buyFoodConfirmButton.textContent = confirmEnabled && amount > 0
                ? `${this.buyFoodConfirmDefaultLabel} ${amount} food • ${cost.toLocaleString()} coins`
                : this.buyFoodConfirmDefaultLabel;
        }
    }

    applyBuyFoodMax() {
        if (!this.buyFoodSlider) {
            return;
        }
        const constraints = this.getBuyFoodConstraints();
        if (constraints.maxAffordable >= 1) {
            this.buyFoodSlider.value = String(constraints.maxAffordable);
            this.updateBuyFoodModalPreview(constraints.maxAffordable, constraints);
        } else {
            this.updateBuyFoodModalPreview(constraints.amount ?? 0, constraints);
        }
    }

    closeBuyFoodModal() {
        if (!this.buyFoodModal) return;
        this.buyFoodModal.hidden = true;
        this.buyFoodModal.setAttribute('hidden', 'hidden');
        this.buyFoodModal.classList.remove('visible');
        if (this.buyFoodSlider) {
            this.buyFoodSlider.disabled = false;
            this.buyFoodSlider.value = '1';
        }
        if (this.buyFoodConfirmButton) {
            this.buyFoodConfirmButton.disabled = false;
            this.buyFoodConfirmButton.textContent = this.buyFoodConfirmDefaultLabel;
        }
        if (this.buyFoodMaxButton) {
            this.buyFoodMaxButton.disabled = false;
        }
        this.updateBodyModalState();
    }

    async confirmBuyFoodModal() {
        if (!this.buyFoodModal || this.buyFoodModal.hidden) return;
        if (!this.buyFoodSlider) return;

        const sliderValue = Math.max(1, Number.parseInt(this.buyFoodSlider.value, 10) || 1);
        const constraints = this.getBuyFoodConstraints(sliderValue);

        if (!constraints.canBuy || constraints.amount <= 0) {
            this.updateBuyFoodModalPreview(sliderValue, constraints);
            this.showMessage('Not enough coins to buy that much food.', 'error');
            return;
        }

        if (this.isBuyFoodRequestInFlight) {
            return;
        }

        this.isBuyFoodRequestInFlight = true;
        if (this.buyFoodSlider) {
            this.buyFoodSlider.disabled = true;
        }
        if (this.buyFoodMaxButton) {
            this.buyFoodMaxButton.disabled = true;
        }
        if (this.buyFoodConfirmButton) {
            this.buyFoodConfirmButton.disabled = true;
            this.buyFoodConfirmButton.textContent = 'Buying...';
        }

        try {
            const response = await fetch('/api/fishes/buy_food', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: this.username, amount: constraints.amount })
            });

            const data = await response.json().catch(() => null);

            if (!response.ok || !data) {
                const errorMessage = data?.error || 'Could not buy food';
                this.showMessage(errorMessage, 'error');
                await this.loadGameData({ silent: true });
                return;
            }

            this.syncStateFromPayload(data);
            this.updateUI();
            if (data.message) {
                this.showMessage(data.message, 'success');
            } else {
                this.showMessage(`Purchased ${constraints.amount} food.`, 'success');
            }

            this.closeBuyFoodModal();
        } catch (error) {
            console.error('Buy food error:', error);
            this.showMessage('Purchase failed due to a network error', 'error');
            await this.loadGameData({ silent: true });
        } finally {
            this.isBuyFoodRequestInFlight = false;
            if (this.buyFoodConfirmButton) {
                this.buyFoodConfirmButton.textContent = this.buyFoodConfirmDefaultLabel;
            }
            if (this.buyFoodModal && !this.buyFoodModal.hidden) {
                const currentValue = this.buyFoodSlider
                    ? Math.max(1, Number.parseInt(this.buyFoodSlider.value, 10) || 1)
                    : 1;
                this.updateBuyFoodModalPreview(currentValue);
            }
        }

        return;
    }

    refreshBuyFoodModalState() {
        if (!this.buyFoodModal || this.buyFoodModal.hidden) {
            return;
        }
        this.setBuyFoodModalContent();
    }

    updateBodyModalState() {
        if (typeof document === 'undefined') return;
        const feedOpen = this.feedModal && !this.feedModal.hidden;
        const buyOpen = this.buyFoodModal && !this.buyFoodModal.hidden;
        if (feedOpen || buyOpen) {
            document.body.classList.add('modal-open');
        } else {
            document.body.classList.remove('modal-open');
        }
    }

    async buyFish(fishType) {
        try {
            const response = await fetch('/api/fishes/buy', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: this.username, fishType })
            });

            if (!response.ok) {
                const error = await response.json().catch(() => ({}));
                this.showMessage(error.error || 'Unable to buy fish', 'error');
                return;
            }

            const data = await response.json();
            this.syncStateFromPayload(data);
            this.updateUI();
            this.showMessage(data.message || 'New fish added to the aquarium!', 'success');
        } catch (error) {
            console.error('Buy fish error:', error);
            this.showMessage('Purchase failed due to a network error', 'error');
        }
    }

    async sellFish(fishId) {
        try {
            const response = await fetch('/api/fishes/sell', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: this.username, fishId })
            });

            if (!response.ok) {
                const error = await response.json().catch(() => ({}));
                this.showMessage(error.error || 'Unable to sell fish', 'error');
                return;
            }

            const data = await response.json();
            this.syncStateFromPayload(data);
            this.updateUI();
            const coinsEarned = data.sale?.coinsEarned;
            this.showMessage(data.message || `Fish sold for ${coinsEarned ? coinsEarned.toLocaleString() : 'some'} coins.`, 'success');
        } catch (error) {
            console.error('Sell fish error:', error);
            this.showMessage('Selling failed due to a network error', 'error');
        }
    }

    async expandAquarium() {
        try {
            const response = await fetch('/api/fishes/expand', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: this.username })
            });

            if (!response.ok) {
                const error = await response.json().catch(() => ({}));
                this.showMessage(error.error || 'Aquarium expansion failed', 'error');
                return;
            }

            const data = await response.json();
            this.syncStateFromPayload(data);
            this.updateUI();
            this.showMessage(data.message || 'Aquarium expanded!', 'success');
        } catch (error) {
            console.error('Expand aquarium error:', error);
            this.showMessage('Expansion failed due to a network error', 'error');
        }
    }

    async buyFood() {
        this.openBuyFoodModal();
    }

    async collectFreeFood() {
        try {
            const response = await fetch('/api/fishes/collect_free_food', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: this.username })
            });

            if (!response.ok) {
                const error = await response.json().catch(() => ({}));
                this.showMessage(error.error || 'Free food not ready', 'error');
                return;
            }

            const data = await response.json();
            this.syncStateFromPayload(data);
            this.updateUI();
            this.showMessage(data.message || 'Collected free food!', 'success');
        } catch (error) {
            console.error('Free food error:', error);
            this.showMessage('Unable to collect free food due to a network error', 'error');
        }
    }

    showMessage(message, type = 'info', duration = 3500) {
        if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
            window.showToast(String(message), type, duration);
            return;
        }

        const banner = this.gameContainer?.querySelector('[data-role="message"]');
        if (!banner) return;

        banner.textContent = String(message);
        banner.className = `message-banner ${type}`;
        banner.style.display = 'block';

        if (this.messageTimeout) {
            clearTimeout(this.messageTimeout);
            this.messageTimeout = null;
        }

        this.messageTimeout = setTimeout(() => {
            banner.style.display = 'none';
        }, duration);
    }

    syncCurrency() {
        if (!window.currencyManager) return;
        const cm = window.currencyManager;
        if (!cm.currencies['fishes']) {
            cm.currencies['fishes'] = { name: 'Aquarium Coins', symbol: '🐟', balance: this.state.coins };
        } else {
            cm.currencies['fishes'].balance = this.state.coins;
        }
        cm.updateUI();
    }

    formatTime(totalSeconds) {
        const seconds = Math.max(0, Math.floor(totalSeconds));
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        if (h > 0) {
            return `${h}h ${m}m ${s}s`;
        }
        if (m > 0) {
            return `${m}m ${s}s`;
        }
        return `${s}s`;
    }

    getUsername() {
        return window.authManager?.currentUser?.username || null;
    }
}
