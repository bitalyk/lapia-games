export class CurrencyManager {
    constructor() {
        this.currencies = {
            'platform': { name: 'Platform Tokens', symbol: '🪙', balance: 0 },
            'happy-birds': { name: 'Bird Eggs', symbol: '🥚', balance: 0 },
            'fishes': { name: 'Aquarium Coins', symbol: '🐟', balance: 0 },
        };
        
        this.exchangeRates = {
            'happy-birds': 1000,
            'fishes': 1200,
            'game2': 500,
            'game3': 750
        };
        
        this.isUpdatingUI = false; // ✅ Флаг для предотвращения рекурсии
        
        this.loadBalances();
    }

    // Загрузка балансов
    loadBalances() {
        const saved = localStorage.getItem('currency_balances');
        if (saved) {
            try {
                const balances = JSON.parse(saved);
                Object.assign(this.currencies, balances);
            } catch (error) {
                console.error('Error loading balances:', error);
            }
        }
    }

    // Сохранение балансов
    saveBalances() {
        try {
            localStorage.setItem('currency_balances', JSON.stringify(this.currencies));
        } catch (error) {
            console.error('Error saving balances:', error);
        }
    }

    // Получение баланса
    getBalance(currencyType) {
        return this.currencies[currencyType]?.balance || 0;
    }

    // Обновление баланса
    updateBalance(currencyType, amount) {
        if (this.currencies[currencyType]) {
            this.currencies[currencyType].balance += amount;
            this.saveBalances();
            this.updateUI(); // ✅ Обновляем UI только здесь
            return true;
        }
        return false;
    }

    // Обмен валюты
    async exchangeCurrency(fromCurrency, toCurrency, amount) {
        const fromBalance = this.getBalance(fromCurrency);
        
        if (fromBalance < amount) {
            throw new Error(`Insufficient ${fromCurrency} balance`);
        }

        const rate = this.getExchangeRate(fromCurrency, toCurrency);
        const receivedAmount = Math.floor(amount / rate);

        // Списание и зачисление
        this.updateBalance(fromCurrency, -amount);
        this.updateBalance(toCurrency, receivedAmount);

        return {
            fromAmount: amount,
            toAmount: receivedAmount,
            rate: rate,
            timestamp: Date.now()
        };
    }

    // Получение курса обмена
    getExchangeRate(fromCurrency, toCurrency) {
        if (fromCurrency === 'platform') {
            return this.exchangeRates[toCurrency] || 1;
        } else if (toCurrency === 'platform') {
            return 1 / (this.exchangeRates[fromCurrency] || 1);
        } else {
            const toPlatform = 1 / (this.exchangeRates[fromCurrency] || 1);
            const fromPlatform = this.exchangeRates[toCurrency] || 1;
            return toPlatform * fromPlatform;
        }
    }

    // Покупка токенов
    async buyTokens(gameCurrency, amount) {
        return await this.exchangeCurrency(gameCurrency, 'platform', amount);
    }

    // Продажа токенов
    async sellTokens(toCurrency, tokenAmount) {
        return await this.exchangeCurrency('platform', toCurrency, tokenAmount);
    }

    // ✅ ИСПРАВЛЕННЫЙ МЕТОД: Предотвращаем рекурсию
    updateUI() {
        // Защита от рекурсии
        if (this.isUpdatingUI) {
            return;
        }
        
        this.isUpdatingUI = true;
        
        try {
            // Обновляем отображение балансов в магазине
            const balanceElements = document.querySelectorAll('[data-currency-balance]');
            balanceElements.forEach(element => {
                const currencyType = element.dataset.currencyType;
                const balance = this.getBalance(currencyType);
                const currencyInfo = this.currencies[currencyType];
                
                if (element && currencyInfo) {
                    element.innerHTML = `
                        ${currencyInfo.symbol} ${balance.toLocaleString()} 
                        <small>${currencyInfo.name}</small>
                    `;
                }
            });

            // ✅ Отправляем событие только если есть подписчики
            if (this.hasEventListeners('currencyUpdate')) {
                window.dispatchEvent(new CustomEvent('currencyUpdate', {
                    detail: { currencies: this.currencies }
                }));
            }
        } catch (error) {
            console.error('Error in updateUI:', error);
        } finally {
            this.isUpdatingUI = false;
        }
    }

    // Проверка наличия обработчиков событий
    hasEventListeners(eventName) {
        // Простая проверка - в реальном приложении можно сделать сложнее
        return true; // Временно возвращаем true
    }

    // Получение информации о всех валютах
    getAllCurrencies() {
        return { ...this.currencies }; // Возвращаем копию
    }

    // Инициализация из данных игры
    initFromGameData(gameData) {
        if (gameData.coins !== undefined) {
            this.updateBalance('happy-birds', gameData.coins);
        }
    }

    // Сброс данных (для тестирования)
    reset() {
        this.currencies = {
            'platform': { name: 'Platform Tokens', symbol: '🪙', balance: 100 },
            'happy-birds': { name: 'Bird Eggs', symbol: '🥚', balance: 0 },
            'fishes': { name: 'Aquarium Coins', symbol: '🐟', balance: 0 },
        };
        this.saveBalances();
        this.updateUI();
    }
}

// Глобальный экземпляр
window.currencyManager = new CurrencyManager();