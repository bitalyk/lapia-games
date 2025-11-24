export class CryptoShop {
    constructor() {
        this.availableItems = [
            {
                id: 'special_bird',
                name: '🌟 Golden Bird',
                description: 'Exclusive golden bird with 2x production',
                price: 50,
                currency: 'platform',
                type: 'game-item',
                game: 'happy-birds'
            },
            {
                id: 'boost_1h',
                name: '⚡ 1-Hour Boost',
                description: 'Double production for 1 hour',
                price: 10,
                currency: 'platform',
                type: 'boost'
            },
            {
                id: 'rainbow_egg',
                name: '🌈 Rainbow Egg',
                description: 'Special egg that hatches random rare birds',
                price: 25,
                currency: 'platform',
                type: 'game-item',
                game: 'happy-birds'
            },
            {
                id: 'profile_badge',
                name: '🏆 Veteran Badge',
                description: 'Exclusive profile badge',
                price: 100,
                currency: 'platform',
                type: 'cosmetic'
            }
        ];

        this.purchaseHistory = [];
        this.loadPurchaseHistory();
    }

    // Покупка предмета
    async purchaseItem(itemId, quantity = 1) {
        const item = this.availableItems.find(i => i.id === itemId);
        if (!item) {
            throw new Error('Item not found');
        }

        const totalPrice = item.price * quantity;
        const userBalance = window.currencyManager.getBalance(item.currency);

        if (userBalance < totalPrice) {
            throw new Error(`Insufficient ${item.currency} balance`);
        }

        // Списание средств
        window.currencyManager.updateBalance(item.currency, -totalPrice);

        // Обработка предмета в зависимости от типа
        await this.processPurchase(item, quantity);

        // Сохранение в историю
        this.saveToHistory(item, quantity, totalPrice);

        return {
            success: true,
            item: item,
            quantity: quantity,
            totalPrice: totalPrice,
            remainingBalance: window.currencyManager.getBalance(item.currency)
        };
    }

    // Обработка покупки в зависимости от типа предмета
    async processPurchase(item, quantity) {
        switch (item.type) {
            case 'game-item':
                await this.deliverGameItem(item, quantity);
                break;
            case 'boost':
                await this.activateBoost(item, quantity);
                break;
            case 'cosmetic':
                await this.unlockCosmetic(item, quantity);
                break;
        }
    }

    // Доставка игрового предмета
    async deliverGameItem(item, quantity) {
        const username = localStorage.getItem('lapia_games_user');
        
        try {
            // Отправляем на бэкенд информацию о покупке
            const response = await fetch('http://localhost:3000/api/game/purchase', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: username,
                    itemId: item.id,
                    itemType: item.type,
                    game: item.game,
                    quantity: quantity
                })
            });

            const result = await response.json();
            
            if (!result.success) {
                throw new Error(result.error || 'Delivery failed');
            }

            console.log(`✅ Delivered ${quantity}x ${item.name} to ${item.game}`);
        } catch (error) {
            console.error('Delivery error:', error);
            // Возвращаем средства при ошибке доставки
            window.currencyManager.updateBalance(item.currency, item.price * quantity);
            throw new Error('Failed to deliver item: ' + error.message);
        }
    }

    // Активация буста
    async activateBoost(item, quantity) {
        // Логика активации буста
        console.log(`⚡ Activated ${quantity}x ${item.name}`);
        
        // Можно добавить таймеры и эффекты
        this.showBoostActivation(item, quantity);
    }

    // Разблокировка косметики
    async unlockCosmetic(item, quantity) {
        const cosmetics = JSON.parse(localStorage.getItem('user_cosmetics') || '[]');
        cosmetics.push({
            id: item.id,
            name: item.name,
            unlockedAt: new Date().toISOString()
        });
        
        localStorage.setItem('user_cosmetics', JSON.stringify(cosmetics));
        console.log(`🎨 Unlocked cosmetic: ${item.name}`);
    }

    // Сохранение в историю покупок
    saveToHistory(item, quantity, totalPrice) {
        const purchase = {
            id: Date.now().toString(),
            item: item,
            quantity: quantity,
            totalPrice: totalPrice,
            timestamp: new Date().toISOString()
        };

        this.purchaseHistory.unshift(purchase);
        
        // Сохраняем только последние 50 покупок
        if (this.purchaseHistory.length > 50) {
            this.purchaseHistory = this.purchaseHistory.slice(0, 50);
        }

        localStorage.setItem('purchase_history', JSON.stringify(this.purchaseHistory));
    }

    // Загрузка истории покупок
    loadPurchaseHistory() {
        const saved = localStorage.getItem('purchase_history');
        if (saved) {
            this.purchaseHistory = JSON.parse(saved);
        }
    }

    // Получение доступных предметов
    getAvailableItems() {
        return this.availableItems;
    }

    // Получение истории покупок
    getPurchaseHistory() {
        return this.purchaseHistory;
    }

    // Показ активации буста
    showBoostActivation(item, quantity) {
        if (window.showToast) {
            showToast(`⚡ ${quantity}x ${item.name} activated!`, 'success');
        }
        
        // Можно добавить визуальные эффекты
        this.createBoostParticles();
    }

    // Создание частиц для визуального эффекта
    createBoostParticles() {
        const particles = document.createElement('div');
        particles.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            z-index: 10000;
        `;
        document.body.appendChild(particles);

        for (let i = 0; i < 20; i++) {
            this.createParticle(particles);
        }

        setTimeout(() => {
            particles.remove();
        }, 2000);
    }

    createParticle(container) {
        const particle = document.createElement('div');
        particle.style.cssText = `
            position: absolute;
            width: 8px;
            height: 8px;
            background: gold;
            border-radius: 50%;
            top: 50%;
            left: 50%;
            pointer-events: none;
        `;

        const angle = Math.random() * Math.PI * 2;
        const distance = 50 + Math.random() * 100;
        const duration = 1000 + Math.random() * 1000;

        particle.animate([
            { 
                transform: 'translate(-50%, -50%) scale(1)',
                opacity: 1
            },
            { 
                transform: `translate(
                    ${Math.cos(angle) * distance}px, 
                    ${Math.sin(angle) * distance}px
                ) scale(0)`,
                opacity: 0
            }
        ], {
            duration: duration,
            easing: 'cubic-bezier(0.2, 0, 0.8, 1)'
        });

        container.appendChild(particle);
    }
}

window.cryptoShop = new CryptoShop();