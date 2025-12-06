const EXCHANGE_GAME_CONFIG = [
    { id: 'happy-birds', statusKey: 'happyBirds', label: 'Happy Birds', icon: '🐦' },
    { id: 'rich-garden', statusKey: 'richGarden', label: 'Rich Garden', icon: '🌳' },
    { id: 'golden-mine', statusKey: 'goldenMine', label: 'Golden Mine', icon: '⛏️' },
    { id: 'cat-chess', statusKey: 'catChess', label: 'Cat Chess', icon: '🐱' },
    { id: 'fishes', statusKey: 'fishes', label: 'Fishes', icon: '🐟' }
];

const CONVERSION_REQUIREMENT = 1000;

export class ShopUI {
    constructor() {
        this.isInitialized = false;
        this.isUpdating = false; // ✅ Флаг для предотвращения рекурсии
        this.conversionModal = null;
        this.conversionState = { max: 0, amount: 0 };
        this.onAchievementUpdate = () => this.handleAchievementUpdate();
        this.currencyHandler = null;
        this.conversionElements = null;
        this.exchangeSnapshot = null;
        this.exchangeSnapshotFetchedAt = 0;
        this.exchangeSnapshotPromise = null;
        this.init();
    }

    async init() {
        if (this.isInitialized) {
            return; // ✅ Предотвращаем повторную инициализацию
        }

        try {
            await this.loadHTMLTemplate();
            this.bindEvents();
            this.isInitialized = true;
            
            // ✅ Обновляем display только один раз при инициализации
            await this.safeUpdateDisplay({ forceRefresh: true });
        } catch (error) {
            console.error('ShopUI init failed:', error);
        }
    }

    // Загрузка HTML шаблона магазина
    async loadHTMLTemplate() {
        try {
            const response = await fetch('./shop/shop-template.html');
            if (!response.ok) {
                throw new Error('Failed to load shop template');
            }
            const html = await response.text();
            
            const shopContainer = document.createElement('div');
            shopContainer.id = 'shop-container';
            shopContainer.style.display = 'none';
            shopContainer.innerHTML = html;
            
            document.body.appendChild(shopContainer);
            
            this.loadStyles();
        } catch (error) {
            console.error('Error loading shop template:', error);
            this.showFallbackUI();
        }
    }

    // Загрузка стилей
    loadStyles() {
        // Проверяем, не добавлены ли стили уже
        if (document.querySelector('link[href*="shop/styles.css"]')) {
            return;
        }

        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = './shop/styles.css';
        document.head.appendChild(link);
    }

    // Fallback UI если загрузка не удалась
    showFallbackUI() {
        const fallbackHTML = `
            <div id="shop-container" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:white; z-index:10000; padding:20px;">
                <h2>Platform Exchange</h2>
                <p>Exchange interface loading failed. Please refresh the page.</p>
                <button onclick="window.shopUI.hide()">Close</button>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', fallbackHTML);
    }

    // ✅ ИСПРАВЛЕННЫЙ МЕТОД: Безопасное обновление
    async safeUpdateDisplay(options = {}) {
        if (this.isUpdating) {
            return;
        }

        this.isUpdating = true;
        
        try {
            const { forceRefresh = false } = options;
            const refreshed = await this.updateBalances({ forceServerRefresh: forceRefresh });
            const shouldForce = forceRefresh && !refreshed;
            await this.renderExchange({ forceRefresh: shouldForce });
        } catch (error) {
            console.error('Error in safeUpdateDisplay:', error);
        } finally {
            // Используем setTimeout чтобы избежать накопления вызовов
            setTimeout(() => {
                this.isUpdating = false;
            }, 0);
        }
    }

    // Привязка событий
    bindEvents() {
        // ✅ Используем делегирование событий вместо множественных обработчиков
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('open-conversion-dialog')) {
                e.preventDefault();
                this.openConversionDialog().catch(() => {
                    /* noop */
                });
                return;
            }
            
            if (e.target.id === 'close-shop-btn') {
                this.hide();
                return;
            }
        });

        // ✅ ОДИН обработчик для currencyUpdate
        if (!this.currencyHandler) {
            this.currencyHandler = () => {
                this.invalidateExchangeSnapshot();
                this.safeUpdateDisplay({ forceRefresh: false }).catch(() => {
                    /* noop */
                });
            };
        }

        window.removeEventListener('currencyUpdate', this.currencyHandler);
        window.addEventListener('currencyUpdate', this.currencyHandler, { once: false });

        window.removeEventListener('achievementStatusUpdated', this.onAchievementUpdate);
        window.addEventListener('achievementStatusUpdated', this.onAchievementUpdate, { once: false });
    }
    // Рендер обмена валют
    async renderExchange({ forceRefresh = false } = {}) {
        const container = document.getElementById('exchange-tab');
        if (!container) return;

        container.innerHTML = `
            <div class="exchange-loading">
                <p>Loading exchange data...</p>
            </div>
        `;

        try {
            const snapshot = await this.fetchExchangeSnapshot({ force: forceRefresh });
            const status = snapshot?.status || window.authManager?.achievementStatus || null;
            const currencies = window.currencyManager?.getAllCurrencies?.() || {};
            const lpaBalanceValue = snapshot?.lpaBalance
                ?? status?.lpaBalance
                ?? window.authManager?.currentUser?.lpaBalance
                ?? 0;

            const conversionCapacity = Math.max(
                0,
                snapshot?.conversionCapacity ?? status?.conversionCapacity ?? 0
            );

            this.conversionState.max = conversionCapacity;
            if (this.conversionState.amount > this.conversionState.max) {
                this.conversionState.amount = this.conversionState.max;
            }

            const canConvert = conversionCapacity > 0;
            const conversionLabel = canConvert ? `Convert (${conversionCapacity} ready)` : 'Convert Coins';
            const isStatusLoaded = Boolean(status);

            const progressMarkup = EXCHANGE_GAME_CONFIG.map((game) => {
                const balance = this.resolveGameBalance(game, { snapshot, status, currencies });
                const ratio = Math.max(0, Math.min(1, balance / CONVERSION_REQUIREMENT));
                const percent = Math.round(ratio * 100);
                const conversionsReady = Math.floor(balance / CONVERSION_REQUIREMENT);
                const remainder = balance % CONVERSION_REQUIREMENT;
                const remainderDisplay = conversionsReady > 0 && remainder === 0
                    ? CONVERSION_REQUIREMENT
                    : Math.max(0, remainder);
                const progressPercent = conversionsReady > 0 && remainder === 0 ? 100 : percent;
                const currencyInfo = currencies?.[game.id];

                const name = currencyInfo?.name || game.label;
                const symbol = currencyInfo?.symbol || game.icon;

                return `
                    <div class="exchange-game-card">
                        <div class="exchange-game-header">
                            <span class="exchange-game-icon">${symbol}</span>
                            <div class="exchange-game-titles">
                                <span class="exchange-game-name">${name}</span>
                                <span class="exchange-game-balance">${balance.toLocaleString()} coins</span>
                            </div>
                            <span class="exchange-game-ready">${conversionsReady} ready</span>
                        </div>
                        <div class="exchange-progress-bar">
                            <div class="exchange-progress-fill" style="width: ${progressPercent}%;"></div>
                        </div>
                        <div class="exchange-progress-meta">
                            <span>${remainderDisplay.toLocaleString()} / ${CONVERSION_REQUIREMENT.toLocaleString()} towards next conversion</span>
                            <span>${progressPercent}%</span>
                        </div>
                    </div>
                `;
            }).join('');

            container.innerHTML = `
                <div class="exchange-container">
                    <div class="exchange-panel exchange-panel--balances">
                        <h4>Game Coin Overview</h4>
                        <div class="exchange-game-grid">
                            ${progressMarkup}
                        </div>
                    </div>
                    <div class="exchange-panel exchange-panel--actions">
                        <h4>Convert to LPA</h4>
                        <p class="exchange-description">Spend ${CONVERSION_REQUIREMENT.toLocaleString()} coins from every game to mint 1 LPA coin.</p>
                        <div class="exchange-stats">
                            <div class="exchange-stat">
                                <span class="exchange-stat-label">LPA Balance</span>
                                <span class="exchange-stat-value">${Math.max(0, lpaBalanceValue).toLocaleString()}</span>
                            </div>
                            <div class="exchange-stat">
                                <span class="exchange-stat-label">Conversions Ready</span>
                                <span class="exchange-stat-value">${conversionCapacity}</span>
                            </div>
                        </div>
                        <button class="open-conversion-dialog" ${canConvert ? '' : 'disabled'}>
                            ${conversionLabel}
                        </button>
                        <p class="exchange-hint">${isStatusLoaded ? 'You need 1,000 coins in every game for each conversion.' : 'Achievement data is loading...'}</p>
                    </div>
                </div>
            `;
        } catch (error) {
            console.error('Error rendering exchange:', error);
            container.innerHTML = '<p>Error loading exchange</p>';
        }
    }

    invalidateExchangeSnapshot() {
        this.exchangeSnapshot = null;
        this.exchangeSnapshotFetchedAt = 0;
    }

    async fetchExchangeSnapshot({ force = false } = {}) {
        const now = Date.now();
        const maxAge = 10000;

        if (!force && this.exchangeSnapshot && (now - this.exchangeSnapshotFetchedAt) < maxAge) {
            return this.exchangeSnapshot;
        }

        if (!window.authManager) {
            return this.exchangeSnapshot;
        }

        if (this.exchangeSnapshotPromise) {
            return this.exchangeSnapshotPromise;
        }

        const shouldRefresh = force || !this.exchangeSnapshot || (now - this.exchangeSnapshotFetchedAt) >= maxAge;

        const fetchPromise = (async () => {
            if (shouldRefresh && window.authManager?.refreshAchievementStatus) {
                try {
                    await window.authManager.refreshAchievementStatus({ silent: true });
                } catch (error) {
                    console.warn('Failed to refresh achievement status for exchange view:', error);
                }
            }

            let snapshot = null;
            if (window.authManager?.getAchievementSnapshot) {
                snapshot = window.authManager.getAchievementSnapshot();
            }

            if (!snapshot) {
                snapshot = this.exchangeSnapshot;
            }

            this.exchangeSnapshot = snapshot;
            this.exchangeSnapshotFetchedAt = Date.now();
            this.exchangeSnapshotPromise = null;
            return snapshot;
        })();

        this.exchangeSnapshotPromise = fetchPromise;

        try {
            return await fetchPromise;
        } catch (error) {
            this.exchangeSnapshotPromise = null;
            throw error;
        }
    }

    resolveGameBalance(game, context = {}) {
        const { snapshot, status, currencies } = context;
        const statusKey = game.statusKey;
        const normalize = (value) => (typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : null);

        const candidates = [
            normalize(snapshot?.currency?.[statusKey]),
            normalize(status?.currencyByGame?.[statusKey]),
            normalize(window.authManager?.currentUser?.currencyByGame?.[statusKey])
        ];

        const progressKey = `${statusKey}Progress`;
        const statusProgressCoins = normalize(status?.[progressKey]?.coins);
        const snapshotStatusCoins = normalize(snapshot?.status?.[progressKey]?.coins);
        const userProgressCoins = normalize(window.authManager?.currentUser?.[progressKey]?.coins);
        if (snapshotStatusCoins !== null) {
            candidates.push(snapshotStatusCoins);
        }
        if (statusProgressCoins !== null) {
            candidates.push(statusProgressCoins);
        }
        if (userProgressCoins !== null) {
            candidates.push(userProgressCoins);
        }

        const currencyInfo = currencies?.[game.id];
        candidates.push(normalize(currencyInfo?.balance));

        for (const candidate of candidates) {
            if (candidate !== null) {
                return candidate;
            }
        }

        return 0;
    }

    // Обновление данных обмена
    async updateBalances({ forceServerRefresh = false } = {}) {
        if (!window.authManager) {
            return false;
        }

        let refreshed = false;

        if (forceServerRefresh && window.authManager.refreshAchievementStatus) {
            try {
                await window.authManager.refreshAchievementStatus({ silent: true });
                refreshed = true;
            } catch (error) {
                console.warn('Failed to refresh achievements before exchange render:', error);
            }
        }

        if (window.authManager.getAchievementSnapshot) {
            this.exchangeSnapshot = window.authManager.getAchievementSnapshot();
            this.exchangeSnapshotFetchedAt = Date.now();
        }

        return refreshed;
    }

    handleAchievementUpdate() {
        if (!this.isInitialized) {
            return;
        }

        if (window.authManager?.getAchievementSnapshot) {
            this.exchangeSnapshot = window.authManager.getAchievementSnapshot();
            this.exchangeSnapshotFetchedAt = Date.now();
        }
        this.renderExchange({ forceRefresh: false }).catch(() => {
            /* noop */
        });
    }

    ensureConversionModal() {
        if (this.conversionModal && this.conversionElements) {
            return this.conversionModal;
        }

        const overlay = document.createElement('div');
        overlay.className = 'conversion-overlay hidden';
        overlay.innerHTML = `
            <div class="conversion-dialog" role="dialog" aria-modal="true" aria-labelledby="conversion-dialog-title">
                <div class="conversion-dialog__header">
                    <h3 id="conversion-dialog-title">Convert Game Coins</h3>
                    <button type="button" class="conversion-dialog__close" aria-label="Close conversion dialog">×</button>
                </div>
                <div class="conversion-dialog__body">
                    <p>Each conversion consumes ${CONVERSION_REQUIREMENT.toLocaleString()} coins from every game and rewards 1 LPA coin.</p>
                    <div class="conversion-slider">
                        <div class="conversion-slider__label">
                            <span>Conversions:</span>
                            <span class="conversion-count">0</span>
                        </div>
                        <input type="range" class="conversion-range" min="0" max="0" value="0">
                        <div class="conversion-slider__actions">
                            <button type="button" class="conversion-max">Max</button>
                        </div>
                    </div>
                    <div class="conversion-summary">
                        <div>
                            <span class="conversion-summary-label">Total cost</span>
                            <span class="conversion-cost">0 coins per game</span>
                        </div>
                        <div>
                            <span class="conversion-summary-label">Reward</span>
                            <span class="conversion-reward">0 LPA</span>
                        </div>
                    </div>
                </div>
                <div class="conversion-dialog__footer">
                    <button type="button" class="conversion-cancel">Cancel</button>
                    <button type="button" class="conversion-confirm" disabled>Convert</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        const elements = {
            slider: overlay.querySelector('.conversion-range'),
            count: overlay.querySelector('.conversion-count'),
            cost: overlay.querySelector('.conversion-cost'),
            reward: overlay.querySelector('.conversion-reward'),
            confirm: overlay.querySelector('.conversion-confirm'),
            max: overlay.querySelector('.conversion-max'),
            cancel: overlay.querySelector('.conversion-cancel'),
            close: overlay.querySelector('.conversion-dialog__close')
        };

        elements.slider.addEventListener('input', (event) => {
            this.setConversionAmount(Number(event.target.value));
        });

        elements.max.addEventListener('click', () => {
            this.setConversionAmount(this.conversionState.max);
        });

        elements.cancel.addEventListener('click', () => this.closeConversionDialog());
        elements.close.addEventListener('click', () => this.closeConversionDialog());

        elements.confirm.addEventListener('click', () => {
            this.confirmConversion();
        });

        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) {
                this.closeConversionDialog();
            }
        });

        this.conversionModal = overlay;
        this.conversionElements = elements;
        return overlay;
    }

    async openConversionDialog() {
        this.ensureConversionModal();

        if (!window.authManager) {
            this.showNotification('Authentication system not ready', 'error');
            return;
        }

        await this.fetchExchangeSnapshot({ force: true }).catch(() => {
            /* noop */
        });

        const snapshot = window.authManager.getAchievementSnapshot ? window.authManager.getAchievementSnapshot() : null;
        const capacity = Math.max(0, snapshot?.conversionCapacity || window.authManager?.achievementStatus?.conversionCapacity || 0);

        this.conversionState.max = Math.max(0, capacity);
        this.conversionState.amount = this.conversionState.max > 0 ? 1 : 0;

        this.updateConversionModal();

        if (this.conversionModal) {
            this.conversionModal.classList.remove('hidden');
        }
        document.body.classList.add('modal-open');
    }

    closeConversionDialog() {
        if (!this.conversionModal) {
            return;
        }
        this.conversionModal.classList.add('hidden');

        const achievementsOverlay = document.querySelector('.achievement-overlay');
        const achievementOpen = achievementsOverlay && !achievementsOverlay.classList.contains('hidden');
        if (!achievementOpen) {
            document.body.classList.remove('modal-open');
        }
    }

    setConversionAmount(amount) {
        const clamped = Math.max(0, Math.min(this.conversionState.max, Math.floor(Number(amount) || 0)));
        this.conversionState.amount = clamped;
        this.updateConversionModal();
    }

    updateConversionModal() {
        if (!this.conversionElements) {
            return;
        }

        const { slider, count, cost, reward, confirm } = this.conversionElements;
        const amount = this.conversionState.amount;
        const max = this.conversionState.max;

        slider.max = String(max);
        slider.value = String(amount);
        count.textContent = amount.toLocaleString();

        const totalCost = amount * CONVERSION_REQUIREMENT;
        cost.textContent = `${totalCost.toLocaleString()} coins per game`;
        reward.textContent = `${amount.toLocaleString()} LPA`;

        if (amount > 0) {
            confirm.disabled = false;
            confirm.textContent = amount === 1 ? 'Convert 1 LPA' : `Convert ${amount} LPA`;
        } else {
            confirm.disabled = true;
            confirm.textContent = 'Convert';
        }
    }

    async confirmConversion() {
        if (!window.authManager) {
            this.showNotification('Authentication system not ready', 'error');
            return;
        }

        const amount = this.conversionState.amount;
        if (amount <= 0) {
            this.showNotification('Select at least one conversion.', 'info');
            return;
        }

        const confirmButton = this.conversionElements?.confirm;
        if (confirmButton) {
            confirmButton.disabled = true;
            confirmButton.textContent = 'Converting...';
        }

        try {
            await window.authManager.convertCoinsToLpa(amount, { skipMenuButton: true });
            await window.authManager.refreshAchievementStatus({ silent: true });
            this.invalidateExchangeSnapshot();
            this.closeConversionDialog();
            await this.safeUpdateDisplay({ forceRefresh: true });
        } catch (error) {
            console.error('Conversion failed:', error);
            this.showNotification('Conversion failed. Please try again later.', 'error');
        } finally {
            if (confirmButton) {
                confirmButton.disabled = this.conversionState.amount <= 0;
                confirmButton.textContent = 'Convert';
            }
        }
    }

    // Показать магазин
    async show() {
        const shopContainer = document.getElementById('shop-container');
        if (shopContainer) {
            shopContainer.style.display = 'block';
            try {
                await this.safeUpdateDisplay({ forceRefresh: true });
            } catch (_error) {
                // UI errors already logged inside safeUpdateDisplay
            }
        }
    }

    // Скрыть магазин
    hide() {
        const shopContainer = document.getElementById('shop-container');
        if (shopContainer) {
            shopContainer.style.display = 'none';
        }
    }

    // Показать уведомление
    showNotification(message, type = 'info') {
        if (window.showToast) {
            showToast(message, type);
        } else {
            console.log(`${type}: ${message}`);
        }
    }

    // Очистка (для предотвращения утечек памяти)
    destroy() {
        this.isInitialized = false;
        if (this.currencyHandler) {
            window.removeEventListener('currencyUpdate', this.currencyHandler);
        }
        window.removeEventListener('achievementStatusUpdated', this.onAchievementUpdate);
        
        const shopContainer = document.getElementById('shop-container');
        if (shopContainer) {
            shopContainer.remove();
        }

        if (this.conversionModal) {
            this.conversionModal.remove();
            this.conversionModal = null;
            this.conversionElements = null;
        }
    }
}

// ✅ Создаем экземпляр только один раз
if (!window.shopUI) {
    window.shopUI = new ShopUI();
}