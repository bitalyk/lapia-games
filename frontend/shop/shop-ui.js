export class ShopUI {
    constructor() {
        this.currentTab = 'marketplace';
        this.isInitialized = false;
        this.isUpdating = false; // ✅ Флаг для предотвращения рекурсии
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
            this.safeUpdateDisplay();
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
                <h2>Platform Shop</h2>
                <p>Shop interface loading failed. Please refresh the page.</p>
                <button onclick="window.shopUI.hide()">Close</button>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', fallbackHTML);
    }

    // ✅ ИСПРАВЛЕННЫЙ МЕТОД: Безопасное обновление
    safeUpdateDisplay() {
        if (this.isUpdating) {
            return;
        }

        this.isUpdating = true;
        
        try {
            this.updateBalances();
            this.updateTabContent();
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
            if (e.target.dataset.shopTab) {
                this.switchTab(e.target.dataset.shopTab);
                return;
            }
            
            if (e.target.classList.contains('buy-item-btn')) {
                this.purchaseItem(e.target.dataset.itemId);
                return;
            }
            
            if (e.target.classList.contains('exchange-currency-btn')) {
                this.showExchangeModal();
                return;
            }
            
            if (e.target.id === 'close-shop-btn') {
                this.hide();
                return;
            }
        });

        // ✅ ОДИН обработчик для currencyUpdate
        const currencyHandler = () => {
            this.safeUpdateDisplay();
        };
        
        window.removeEventListener('currencyUpdate', currencyHandler); // Сначала удаляем
        window.addEventListener('currencyUpdate', currencyHandler, { once: false });
    }

    // Переключение вкладок
    switchTab(tabName) {
        if (this.currentTab === tabName) {
            return; // ✅ Не делаем ничего если вкладка уже активна
        }

        this.currentTab = tabName;
        
        // Обновляем активные кнопки вкладок
        document.querySelectorAll('[data-shop-tab]').forEach(tab => {
            if (tab.dataset.shopTab === tabName) {
                tab.classList.add('active');
            } else {
                tab.classList.remove('active');
            }
        });
        
        // Показываем соответствующий контент
        document.querySelectorAll('.shop-tab-content').forEach(content => {
            content.style.display = content.id === `${tabName}-tab` ? 'block' : 'none';
        });
        
        this.updateTabContent();
    }

    // Обновление контента вкладки
    updateTabContent() {
        if (!this.isInitialized) return;

        try {
            switch (this.currentTab) {
                case 'marketplace':
                    this.renderMarketplace();
                    break;
                case 'exchange':
                    this.renderExchange();
                    break;
                case 'history':
                    this.renderHistory();
                    break;
                case 'inventory':
                    this.renderInventory();
                    break;
            }
        } catch (error) {
            console.error('Error updating tab content:', error);
        }
    }

    // Рендер маркетплейса
    renderMarketplace() {
        const container = document.getElementById('marketplace-tab');
        if (!container) return;

        try {
            const items = window.cryptoShop?.getAvailableItems() || [];
            
            container.innerHTML = `
                <div class="items-grid">
                    ${items.map(item => this.renderShopItem(item)).join('')}
                </div>
            `;
        } catch (error) {
            console.error('Error rendering marketplace:', error);
            container.innerHTML = '<p>Error loading marketplace</p>';
        }
    }

    // Рендер элемента магазина
    renderShopItem(item) {
        if (!item || !window.currencyManager) {
            return '<div class="shop-item error">Error loading item</div>';
        }

        try {
            const userBalance = window.currencyManager.getBalance(item.currency);
            const canAfford = userBalance >= item.price;
            
            return `
                <div class="shop-item ${canAfford ? '' : 'disabled'}">
                    <div class="item-header">
                        <h4>${item.name || 'Unknown Item'}</h4>
                        <span class="item-price">${item.price || 0} ${item.currency === 'platform' ? '🪙' : '🥚'}</span>
                    </div>
                    <p class="item-description">${item.description || 'No description'}</p>
                    <div class="item-meta">
                        <span class="item-type">${item.type || 'unknown'}</span>
                        <span class="item-game">${item.game || 'Platform'}</span>
                    </div>
                    <button class="buy-item-btn ${canAfford ? '' : 'disabled'}" 
                            data-item-id="${item.id}"
                            ${canAfford ? '' : 'disabled'}>
                        ${canAfford ? 'Purchase' : 'Insufficient Funds'}
                    </button>
                </div>
            `;
        } catch (error) {
            console.error('Error rendering shop item:', error);
            return '<div class="shop-item error">Error loading item</div>';
        }
    }

    // Рендер обмена валют
    renderExchange() {
        const container = document.getElementById('exchange-tab');
        if (!container) return;

        try {
            const currencies = window.currencyManager?.getAllCurrencies() || {};
            
            container.innerHTML = `
                <div class="exchange-container">
                    <div class="balance-display">
                        <h4>Your Balances</h4>
                        ${Object.entries(currencies).map(([type, info]) => `
                            <div class="balance-item" data-currency-type="${type}">
                                <span class="currency-symbol">${info?.symbol || ''}</span>
                                <span class="currency-amount">${(info?.balance || 0).toLocaleString()}</span>
                                <span class="currency-name">${info?.name || type}</span>
                            </div>
                        `).join('')}
                    </div>
                    
                    <div class="exchange-interface">
                        <h4>Currency Exchange</h4>
                        <div class="exchange-form">
                            <!-- Форма обмена -->
                        </div>
                    </div>
                </div>
            `;
        } catch (error) {
            console.error('Error rendering exchange:', error);
            container.innerHTML = '<p>Error loading exchange</p>';
        }
    }

    // Покупка предмета
    async purchaseItem(itemId) {
        if (!window.cryptoShop) {
            this.showNotification('Shop system not available', 'error');
            return;
        }

        try {
            const result = await window.cryptoShop.purchaseItem(itemId);
            
            if (result.success) {
                this.showNotification(`✅ Purchased ${result.item.name}!`, 'success');
                this.safeUpdateDisplay();
            }
        } catch (error) {
            this.showNotification(`❌ ${error.message}`, 'error');
        }
    }

    // Обновление балансов
    updateBalances() {
        if (window.currencyManager) {
            window.currencyManager.updateUI();
        }
    }

    // Показать магазин
    show() {
        const shopContainer = document.getElementById('shop-container');
        if (shopContainer) {
            shopContainer.style.display = 'block';
            this.safeUpdateDisplay();
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
        window.removeEventListener('currencyUpdate', this.safeUpdateDisplay);
        
        const shopContainer = document.getElementById('shop-container');
        if (shopContainer) {
            shopContainer.remove();
        }
    }
}

// ✅ Создаем экземпляр только один раз
if (!window.shopUI) {
    window.shopUI = new ShopUI();
}