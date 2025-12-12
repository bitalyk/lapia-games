const EXCHANGE_GAME_CONFIG = [
    { id: 'happy-birds', statusKey: 'happyBirds', label: 'Happy Birds', icon: '🐦' },
    { id: 'rich-garden', statusKey: 'richGarden', label: 'Rich Garden', icon: '🌳' },
    { id: 'golden-mine', statusKey: 'goldenMine', label: 'Golden Mine', icon: '⛏️' },
    { id: 'cat-chess', statusKey: 'catChess', label: 'Cat Chess', icon: '🐱' },
    { id: 'fishes', statusKey: 'fishes', label: 'Fishes', icon: '🐟' }
];

const CONVERSION_REQUIREMENT = 100;
const SNAPSHOT_TTL = 10000;
const CATALOG_TTL = 12000;

const PURCHASE_ERROR_MESSAGES = {
    ITEM_NOT_FOUND: 'This item is no longer available.',
    INSUFFICIENT_LPA: 'You do not have enough LPA coins for this purchase.',
    ALREADY_PURCHASED: 'You already own this upgrade.',
    UNAVAILABLE: 'This offer is currently unavailable. Please try again later.',
    NO_PLANTING_SLOT: 'All planting slots are already filled with equal or higher-tier trees.'
};

export class ShopUI {
    constructor() {
        this.isInitialized = false;
        this.isUpdating = false; // ✅ Флаг для предотвращения рекурсии
        this.activeTab = 'marketplace';
        this.pendingTab = 'marketplace';
        this.conversionModal = null;
        this.conversionState = { max: 0, amount: 0 };
        this.onAchievementUpdate = () => this.handleAchievementUpdate();
        this.currencyHandler = null;
        this.conversionElements = null;
        this.exchangeSnapshot = null;
        this.exchangeSnapshotFetchedAt = 0;
        this.exchangeSnapshotPromise = null;
        this.catalogSnapshot = null;
        this.catalogSnapshotFetchedAt = 0;
        this.catalogSnapshotPromise = null;
        this.purchaseInFlight = new Set();
        this.marketplacePanel = null;
        this.exchangePanel = null;
        this.tabButtons = [];
        this.boundDocumentClickHandler = null;
        this.init();
    }

    async init() {
        if (this.isInitialized) {
            return; // ✅ Предотвращаем повторную инициализацию
        }

        try {
            await this.loadHTMLTemplate();
            this.cacheDomRefs();
            this.bindEvents();
            this.isInitialized = true;
            this.switchTab(this.pendingTab || this.activeTab);
            
            // ✅ Обновляем display только один раз при инициализации
            await this.safeUpdateDisplay({ forceRefresh: true });
        } catch (error) {
            console.error('ShopUI init failed:', error);
        }
    }

    cacheDomRefs() {
        const root = document.getElementById('shop-container');
        if (!root) {
            this.marketplacePanel = null;
            this.exchangePanel = null;
            this.tabButtons = [];
            return;
        }
        this.marketplacePanel = root.querySelector('[data-tab-panel="marketplace"]');
        this.exchangePanel = root.querySelector('[data-tab-panel="exchange"]');
        this.tabButtons = Array.from(root.querySelectorAll('[data-tab-target]'));
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
            const shouldForceExchange = forceRefresh && !refreshed;
            await Promise.allSettled([
                this.renderMarketplace({ forceRefresh }),
                this.renderExchange({ forceRefresh: shouldForceExchange })
            ]);
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
        if (this.boundDocumentClickHandler) {
            document.removeEventListener('click', this.boundDocumentClickHandler);
        }

        this.boundDocumentClickHandler = (e) => {
            const target = e.target;
            if (!target) {
                return;
            }

            const shopRoot = document.getElementById('shop-container');
            if (!shopRoot) {
                return;
            }

            const conversionTrigger = target.closest('.open-conversion-dialog');
            if (conversionTrigger && conversionTrigger.closest('[data-tab-panel="exchange"]')) {
                e.preventDefault();
                this.openConversionDialog().catch(() => {
                    /* noop */
                });
                return;
            }

            const closeBtn = target.closest('#close-shop-btn');
            if (closeBtn && shopRoot.contains(closeBtn)) {
                e.preventDefault();
                this.hide();
                return;
            }

            const tabButton = target.closest('[data-tab-target]');
            if (tabButton && shopRoot.contains(tabButton)) {
                e.preventDefault();
                const tabId = tabButton.dataset.tabTarget;
                if (tabId) {
                    this.switchTab(tabId);
                }
                return;
            }

            const refreshBtn = target.closest('[data-action="refresh-catalog"]');
            if (refreshBtn && shopRoot.contains(refreshBtn)) {
                e.preventDefault();
                this.invalidateCatalogSnapshot();
                this.renderMarketplace({ forceRefresh: true }).catch(() => {
                    /* noop */
                });
                return;
            }

            const purchaseBtn = target.closest('[data-action="purchase-item"]');
            if (purchaseBtn && shopRoot.contains(purchaseBtn)) {
                e.preventDefault();
                this.handlePurchaseClick(purchaseBtn);
            }
        };

        // ✅ Используем делегирование событий вместо множественных обработчиков
        document.addEventListener('click', this.boundDocumentClickHandler, { once: false });

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

    switchTab(tabId = 'marketplace') {
        if (!tabId) {
            return;
        }
        this.activeTab = tabId;
        this.pendingTab = tabId;
        if (!this.isInitialized) {
            return;
        }
        this.updateTabState();
        if (tabId === 'exchange') {
            this.renderExchange({ forceRefresh: false }).catch(() => {
                /* noop */
            });
        } else {
            this.renderMarketplace({ forceRefresh: false }).catch(() => {
                /* noop */
            });
        }
    }

    updateTabState() {
        this.cacheDomRefs();
        this.tabButtons.forEach((button) => {
            const isActive = button.dataset.tabTarget === this.activeTab;
            button.classList.toggle('is-active', isActive);
            button.setAttribute('aria-selected', String(isActive));
        });

        const panels = [
            { panel: this.marketplacePanel, id: 'marketplace' },
            { panel: this.exchangePanel, id: 'exchange' }
        ];

        panels.forEach(({ panel, id }) => {
            if (!panel) {
                return;
            }
            const isVisible = this.activeTab === id;
            panel.hidden = !isVisible;
            panel.setAttribute('aria-hidden', String(!isVisible));
        });
    }

    handlePurchaseClick(button) {
        if (!button || button.disabled) {
            return;
        }
        const itemId = button.dataset.itemId;
        if (!itemId) {
            return;
        }
        this.purchaseItem(itemId, button).catch(() => {
            /* noop */
        });
    }

    async purchaseItem(itemId, button) {
        if (!itemId) {
            return;
        }
        const username = this.getUsername();
        if (!username) {
            this.showNotification('Please sign in to purchase upgrades.', 'error');
            return;
        }
        if (this.purchaseInFlight.has(itemId)) {
            return;
        }

        this.purchaseInFlight.add(itemId);
        const originalLabel = button ? button.textContent : '';
        if (button) {
            button.disabled = true;
            button.dataset.loading = 'true';
            button.dataset.defaultLabel = originalLabel;
            button.textContent = 'Processing...';
        }

        try {
            const response = await fetch(`${this.getApiBase()}/platform/shop/purchase`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, itemId })
            });

            let data = {};
            try {
                data = await response.json();
            } catch (_error) {
                data = {};
            }

            if (!response.ok || !data.success) {
                const errorCode = data?.error || `HTTP_${response.status}`;
                throw new Error(errorCode);
            }

            this.invalidateCatalogSnapshot();
            await this.renderMarketplace({ forceRefresh: true });
            await this.renderExchange({ forceRefresh: true });

            if (window.authManager?.refreshAchievementStatus) {
                try {
                    await window.authManager.refreshAchievementStatus({ silent: true });
                } catch (refreshError) {
                    console.warn('Failed to refresh achievements after purchase:', refreshError);
                }
            }

            const itemName = button?.dataset?.itemName || itemId;
            this.showNotification(`Purchased ${itemName}!`, 'success');
        } catch (error) {
            console.error('Purchase failed:', error);
            const message = this.resolvePurchaseError(error?.message);
            this.showNotification(message, 'error');
        } finally {
            this.purchaseInFlight.delete(itemId);
            if (button) {
                button.disabled = false;
                button.dataset.loading = 'false';
                const restore = button.dataset.defaultLabel || 'Purchase';
                button.textContent = restore;
            }
        }
    }
    // Рендер магазина
    async renderMarketplace({ forceRefresh = false } = {}) {
        const container = this.marketplacePanel || document.getElementById('marketplace-tab');
        if (!container) {
            return;
        }

        const username = this.getUsername();
        if (!username) {
            container.innerHTML = `
                <div class="shop-empty">
                    <p>Sign in to browse the cross-game LPA marketplace.</p>
                </div>
            `;
            return;
        }

        if (forceRefresh) {
            this.invalidateCatalogSnapshot();
        }

        container.innerHTML = `
            <div class="shop-loading">
                <p>Loading marketplace...</p>
            </div>
        `;

        try {
            const snapshot = await this.fetchCatalog({ force: forceRefresh });
            container.innerHTML = this.buildMarketplaceMarkup(snapshot);
        } catch (error) {
            console.error('Error rendering marketplace:', error);
            const message = this.escapeHtml(error.message || 'Server unavailable');
            container.innerHTML = `
                <div class="shop-error">
                    <h4>Unable to load the marketplace</h4>
                    <p>${message}</p>
                    <button class="shop-try-again" data-action="refresh-catalog" type="button">Try again</button>
                </div>
            `;
        }
    }

    buildMarketplaceMarkup(snapshot = {}) {
        const catalog = Array.isArray(snapshot?.catalog) ? snapshot.catalog : [];
        const sections = catalog.length
            ? catalog.map((section) => this.renderCatalogSection(section)).join('')
            : '<div class="shop-empty"><p>No LPA marketplace entries are available right now.</p></div>';

        const historyMarkup = this.buildPurchaseHistory(snapshot?.purchaseHistory);
        const lpaBalance = Math.max(
            0,
            snapshot?.lpaBalance
            ?? window.authManager?.achievementStatus?.lpaBalance
            ?? window.authManager?.currentUser?.lpaBalance
            ?? 0
        );

        return `
            <div class="marketplace-header">
                <div>
                    <p class="shop-eyebrow">Cross-game catalog</p>
                    <h3>Upgrade every world instantly</h3>
                    <p>Purchases sync with the backend and unlock upgrades the moment you load each game.</p>
                </div>
                <div class="header-meta">
                    <div class="balance-chip">
                        <span>LPA Balance</span>
                        <strong>${this.formatNumber(lpaBalance)}</strong>
                    </div>
                    <button class="refresh-catalog" type="button" data-action="refresh-catalog">Refresh</button>
                </div>
            </div>
            <div class="marketplace-grid">
                ${sections}
            </div>
            ${historyMarkup}
        `;
    }

    renderCatalogSection(section = {}) {
        const items = Array.isArray(section.items) ? section.items : [];
        const icon = this.escapeHtml(section.icon || '🛒');
        const title = this.escapeHtml(section.label || section.game || 'Game');
        const subtitle = `${items.length || 0} offer${items.length === 1 ? '' : 's'}`;
        const contextMarkup = this.renderSectionContext(section);
        const itemMarkup = items.length
            ? items.map((item) => this.renderShopItem(item)).join('')
            : '<div class="shop-empty"><p>No offers available for this game.</p></div>';

        return `
            <section class="game-shop-card">
                <header class="game-shop-header">
                    <div class="game-shop-icon">${icon}</div>
                    <div>
                        <h4>${title}</h4>
                        <p>${this.escapeHtml(subtitle)}</p>
                    </div>
                </header>
                ${contextMarkup}
                <div class="shop-item-grid">
                    ${itemMarkup}
                </div>
            </section>
        `;
    }

    renderSectionContext(section = {}) {
        if (!section?.context) {
            return '';
        }
        if (section.game === 'rich-garden') {
            return this.renderRichGardenContext(section.context);
        }
        return '';
    }

    renderRichGardenContext(context = {}) {
        const garden = context.garden || {};
        const totalSlots = Math.max(0, garden.totalSlots ?? 0);
        const filledSlots = Math.max(0, garden.filledSlots ?? 0);
        const emptySlots = Math.max(0, garden.emptySlots ?? 0);
        const tiers = Array.isArray(context.tiers) ? context.tiers : [];
        const tierMarkup = tiers.map((tier) => {
            const state = tier.canPlant ? 'open' : 'blocked';
            const planted = Math.max(0, tier.count || 0);
            const targets = Array.isArray(tier.targets) ? tier.targets.length : 0;
            const placement = tier.placement || null;
            let statusLabel = 'Ready to plant';
            if (!tier.canPlant) {
                statusLabel = 'Maxed';
            } else if (tier.note) {
                statusLabel = tier.note;
            } else if (placement === 'empty-slot') {
                statusLabel = targets > 0
                    ? `${targets} empty slot${targets === 1 ? '' : 's'} available`
                    : 'Empty slots available';
            } else if (targets > 0) {
                statusLabel = `${targets} upgrade slot${targets === 1 ? '' : 's'} ready`;
            }
            return `
                <div class="garden-tier" data-state="${state}">
                    <div class="garden-tier__label">
                        <span>${this.escapeHtml(tier.label || tier.key)}</span>
                        <small>Lvl ${this.escapeHtml(String(tier.level || ''))}</small>
                    </div>
                    <div class="garden-tier__meta">
                        <span>${planted} planted</span>
                        <span class="garden-tier__status">${this.escapeHtml(statusLabel)}</span>
                    </div>
                </div>
            `;
        }).join('');

        return `
            <div class="rich-garden-context">
                <div class="garden-stats">
                    <div>
                        <span>Planted</span>
                        <strong>${filledSlots} / ${totalSlots}</strong>
                    </div>
                    <div>
                        <span>Empty slots</span>
                        <strong>${emptySlots}</strong>
                    </div>
                </div>
                <div class="garden-tier-grid">
                    ${tierMarkup}
                </div>
            </div>
        `;
    }

    renderShopItem(item = {}) {
        const status = item.status || {};
        const maxPurchase = typeof status.maxPurchase === 'number' ? status.maxPurchase : -1;
        const purchased = typeof status.purchased === 'number' ? status.purchased : 0;
        const soldOut = Boolean(status.soldOut);
        const isTreeItem = item.game === 'rich-garden' && item.action === 'placeTree';
        const plantingBlocked = isTreeItem && status.canPlant === false;
        const type = (item.type || 'item').toLowerCase();
        const chipLabel = type === 'upgrade' ? 'Upgrade' : 'Bundle';
        const chipClass = type === 'upgrade' ? 'item-chip item-chip--upgrade' : 'item-chip';
        const ownedLabel = maxPurchase >= 0
            ? `${Math.min(purchased, maxPurchase)} / ${maxPurchase} owned`
            : purchased > 0
                ? `${purchased} owned`
                : 'Unlimited purchases';
        const isLoading = this.purchaseInFlight.has(item.id);
        const buttonDisabled = soldOut || plantingBlocked || isLoading;
        const buttonLabel = soldOut
            ? 'Owned'
            : plantingBlocked
                ? 'Not plantable'
                : isLoading
                    ? 'Processing...'
                    : `Buy for ${this.formatNumber(item.lpaCost || 0)} LPA`;

        const description = item.description || 'Instantly applied to your save.';
        let disabledReasonText = status.disabledReason || '';
        if (disabledReasonText === 'limit') {
            disabledReasonText = 'Limit reached for this upgrade.';
        }
        if (soldOut && !disabledReasonText) {
            disabledReasonText = 'Already owned.';
        }
        if (plantingBlocked) {
            disabledReasonText = 'Garden already full of equal or higher-tier trees.';
        }
        const disabledReason = disabledReasonText ? `<small>${this.escapeHtml(disabledReasonText)}</small>` : '';
        const plantingHint = this.renderPlantingHint(item);
        const stateAttr = soldOut ? 'sold-out' : plantingBlocked ? 'blocked' : 'available';

        return `
            <article class="shop-item-card" data-state="${stateAttr}">
                <span class="${chipClass}">${this.escapeHtml(chipLabel)}</span>
                <h5>${this.escapeHtml(item.name || item.id || 'Mystery item')}</h5>
                <p>${this.escapeHtml(description)}</p>
                ${plantingHint}
                <div class="item-meta">
                    <div><span>Price</span> <strong>${this.formatNumber(item.lpaCost || 0)} LPA</strong></div>
                    <div>${this.escapeHtml(ownedLabel)}</div>
                </div>
                ${disabledReason}
                <button
                    class="shop-action-btn"
                    type="button"
                    data-action="purchase-item"
                    data-item-id="${this.escapeHtml(item.id || '')}"
                    data-item-name="${this.escapeHtml(item.name || item.id || '')}"
                    data-default-label="${this.escapeHtml(buttonLabel)}"
                    data-loading="${String(isLoading)}"
                    ${buttonDisabled ? 'disabled' : ''}
                >
                    ${this.escapeHtml(buttonLabel)}
                </button>
            </article>
        `;
    }

    renderPlantingHint(item = {}) {
        if (item.game !== 'rich-garden' || item.action !== 'placeTree') {
            return '';
        }
        const context = item.context || {};
        const canPlant = context.canPlant !== false;
        const targets = Array.isArray(context.targets) ? context.targets : [];
        const emptySlots = Math.max(0, context.garden?.emptySlots ?? 0);
        const availabilityNote = context.availability?.note;
        const emptyTargets = Array.isArray(context.emptyTargets)
            ? context.emptyTargets
            : Array.isArray(context.availability?.emptyTargets)
                ? context.availability.emptyTargets
                : [];
        const upgradeTargets = Array.isArray(context.upgradeTargets)
            ? context.upgradeTargets
            : Array.isArray(context.availability?.upgradeTargets)
                ? context.availability.upgradeTargets
                : [];
        const placement = context.placement || context.availability?.placement || null;
        let detail = 'Ready to plant';
        if (canPlant) {
            if (availabilityNote) {
                detail = availabilityNote;
            } else if (placement === 'empty-slot' || emptyTargets.length > 0) {
                const count = emptyTargets.length || emptySlots;
                detail = count > 0
                    ? `${count} empty slot${count === 1 ? '' : 's'} available`
                    : 'Empty slots available';
            } else if (upgradeTargets.length > 0 || targets.length > 0) {
                const previewSource = upgradeTargets.length > 0 ? upgradeTargets : targets;
                const preview = previewSource
                    .slice(0, 3)
                    .map((slot) => {
                        const index = Number(slot);
                        return Number.isFinite(index) ? `#${index + 1}` : null;
                    })
                    .filter(Boolean)
                    .join(', ');
                const total = previewSource.length;
                detail = `Upgrade ${total} slot${total === 1 ? '' : 's'}${preview ? ` (${preview})` : ''}`;
            }
        } else {
            detail = 'All planted trees are already equal or higher tier.';
        }
        const state = canPlant ? 'ready' : 'blocked';
        return `
            <div class="planting-hint" data-state="${state}">
                <span class="planting-dot"></span>
                <div>
                    <strong>${canPlant ? 'Planting ready' : 'No planting slots'}</strong>
                    <p>${this.escapeHtml(detail)}</p>
                </div>
            </div>
        `;
    }

    buildPurchaseHistory(history = []) {
        if (!Array.isArray(history) || history.length === 0) {
            return '';
        }

        const recent = history.slice(-5).reverse();
        const items = recent.map((entry) => {
            const date = entry?.purchasedAt ? new Date(entry.purchasedAt) : null;
            const formattedDate = date && !Number.isNaN(date.getTime())
                ? date.toLocaleString()
                : 'Just now';
            const icon = this.resolveGameIcon(entry?.game);
            const label = this.escapeHtml(entry?.itemId || 'Unknown purchase');
            const cost = this.formatNumber(entry?.lpaCost || 0);
            return `
                <li class="purchase-history__item">
                    <span class="purchase-history__icon">${icon}</span>
                    <div>
                        <strong>${label}</strong>
                        <div>${cost} LPA • ${this.escapeHtml(formattedDate)}</div>
                    </div>
                </li>
            `;
        }).join('');

        return `
            <div class="purchase-history">
                <div class="purchase-history__header">
                    <div>
                        <p class="shop-eyebrow">Latest purchases</p>
                        <h4>History</h4>
                    </div>
                    <button class="refresh-catalog" type="button" data-action="refresh-catalog">Sync</button>
                </div>
                <ul class="purchase-history__list">${items}</ul>
            </div>
        `;
    }

    resolveGameIcon(gameId) {
        if (!gameId) {
            return '🛒';
        }
        const entry = EXCHANGE_GAME_CONFIG.find((game) => game.id === gameId);
        return entry?.icon || '🛒';
    }

    resolvePurchaseError(code) {
        if (!code) {
            return 'Purchase failed. Please try again later.';
        }
        const normalized = String(code || '').trim();
        if (/failed to fetch/i.test(normalized)) {
            return 'Network error. Please check your connection and try again.';
        }
        if (PURCHASE_ERROR_MESSAGES[normalized]) {
            return PURCHASE_ERROR_MESSAGES[normalized];
        }
        if (normalized.startsWith('HTTP_')) {
            return 'Purchase failed. Please try again later.';
        }
        return 'Purchase failed. Please try again later.';
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
                        <p class="exchange-hint">${isStatusLoaded ? 'You need 100 coins in every game for each conversion.' : 'Achievement data is loading...'}</p>
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

    invalidateCatalogSnapshot() {
        this.catalogSnapshot = null;
        this.catalogSnapshotFetchedAt = 0;
        this.catalogSnapshotPromise = null;
    }

    async fetchExchangeSnapshot({ force = false } = {}) {
        const now = Date.now();
        const maxAge = SNAPSHOT_TTL;

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

    async fetchCatalog({ force = false } = {}) {
        const username = this.getUsername();
        if (!username) {
            throw new Error('Login required');
        }

        const now = Date.now();
        if (!force && this.catalogSnapshot && (now - this.catalogSnapshotFetchedAt) < CATALOG_TTL) {
            return this.catalogSnapshot;
        }

        if (this.catalogSnapshotPromise) {
            return this.catalogSnapshotPromise;
        }

        const url = `${this.getApiBase()}/platform/shop/catalog/${encodeURIComponent(username)}`;

        const fetchPromise = (async () => {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Failed to load catalog (${response.status})`);
            }
            const data = await response.json();
            if (!data.success) {
                throw new Error(data.error || 'Unable to load catalog');
            }
            this.catalogSnapshot = data;
            this.catalogSnapshotFetchedAt = Date.now();
            this.catalogSnapshotPromise = null;
            return data;
        })().catch((error) => {
            this.catalogSnapshotPromise = null;
            throw error;
        });

        this.catalogSnapshotPromise = fetchPromise;
        return fetchPromise;
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
        this.renderMarketplace({ forceRefresh: false }).catch(() => {
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
        const shopContainer = document.getElementById('shop-container');
        const shopOpen = shopContainer && shopContainer.style.display !== 'none';
        if (!achievementOpen && !shopOpen) {
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
            document.body.classList.add('modal-open');
            this.switchTab(this.activeTab);
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
        const conversionOverlay = document.querySelector('.conversion-overlay');
        const conversionOpen = conversionOverlay && !conversionOverlay.classList.contains('hidden');
        const achievementsOverlay = document.querySelector('.achievement-overlay');
        const achievementOpen = achievementsOverlay && !achievementsOverlay.classList.contains('hidden');
        if (!conversionOpen && !achievementOpen) {
            document.body.classList.remove('modal-open');
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
        if (this.boundDocumentClickHandler) {
            document.removeEventListener('click', this.boundDocumentClickHandler);
            this.boundDocumentClickHandler = null;
        }
        
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

    getApiBase() {
        return window.authManager?.API_BASE || 'http://localhost:3000/api';
    }

    getUsername() {
        return window.authManager?.currentUser?.username || null;
    }

    formatNumber(value) {
        const numeric = Number(value);
        if (Number.isNaN(numeric) || !Number.isFinite(numeric)) {
            return '0';
        }
        return Math.max(0, Math.floor(numeric)).toLocaleString();
    }

    escapeHtml(value) {
        if (value === null || value === undefined) {
            return '';
        }
        return String(value).replace(/[&<>"']/g, (char) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        }[char] || char));
    }
}

// ✅ Создаем экземпляр только один раз
if (!window.shopUI) {
    window.shopUI = new ShopUI();
}