export default class HappyBirdsGame {
    constructor() {
        this.isRunning = false;
        this.gameContainer = null;
        this.coins = 0;
        this.birds = { red: 1 };
        this.eggs = { red: 0 };
        this.gameManager = null; // ✅ Добавляем ссылку на gameManager
    }

    // ✅ Установка gameManager
    setGameManager(gameManager) {
        this.gameManager = gameManager;
        console.log('🎮 Game Manager set for Happy Birds');
    }

    // ✅ Запуск игры
    async start() {
        console.log('🐦 Starting Happy Birds...');
        this.isRunning = true;
        
        await this.loadGameTemplate();
        this.initGame();
        this.bindGameEvents();
        this.startGameLoop();
        
        console.log('✅ Happy Birds started successfully');
    }

    // ✅ Остановка игры
    stop() {
        console.log('🐦 Stopping Happy Birds...');
        this.isRunning = false;
        this.cleanup();
        console.log('✅ Happy Birds stopped');
    }

    // ✅ Загрузка HTML шаблона
    async loadGameTemplate() {
        const gameArea = document.getElementById('game-area');
        if (!gameArea) {
            throw new Error('Game area not found');
        }

        gameArea.innerHTML = `
            <div class="happy-birds-game">
                <div class="game-header">
                    <h2>🐦 Happy Birds</h2>
                    <button id="hb-back-btn" class="back-button">← Back to Menu</button>
                </div>

                <div class="game-stats">
                    <div class="stat-card">
                        <h3>Coins</h3>
                        <div id="hb-coins" class="stat-value">${this.coins}</div>
                    </div>
                    <div class="stat-card">
                        <h3>Red Birds</h3>
                        <div id="hb-red-birds" class="stat-value">${this.birds.red}</div>
                    </div>
                    <div class="stat-card">
                        <h3>Red Eggs</h3>
                        <div id="hb-red-eggs" class="stat-value">${this.eggs.red}</div>
                    </div>
                </div>

                <div class="game-controls">
                    <button id="hb-collect-btn" class="control-btn">🥚 Collect Eggs</button>
                    <button id="hb-buy-btn" class="control-btn">🛒 Buy Red Bird (100 coins)</button>
                </div>

                <div class="game-animation">
                    <div id="bird-animation" style="text-align: center; margin: 20px 0;">
                        <div style="font-size: 48px;">🐦</div>
                        <div style="font-size: 24px;">⬇️</div>
                        <div style="font-size: 36px;">🥚</div>
                    </div>
                </div>

                <div class="game-messages" id="hb-messages" style="min-height: 40px;"></div>
            </div>
        `;

        this.gameContainer = gameArea.querySelector('.happy-birds-game');
        this.addGameStyles();
    }

    // ✅ Добавление стилей игры (без изменений)
    addGameStyles() {
        const styles = `
            <style>
                .happy-birds-game {
                    max-width: 800px;
                    margin: 0 auto;
                    background: white;
                    border-radius: 12px;
                    padding: 20px;
                    box-shadow: 0 4px 20px rgba(0,0,0,0.1);
                    font-family: 'Segoe UI', system-ui, sans-serif;
                }

                .game-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 20px;
                    padding-bottom: 15px;
                    border-bottom: 2px solid #e0e0e0;
                }

                .back-button {
                    padding: 8px 16px;
                    background: #6c757d;
                    color: white;
                    border: none;
                    border-radius: 6px;
                    cursor: pointer;
                    font-size: 14px;
                }

                .back-button:hover {
                    background: #5a6268;
                }

                .game-stats {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
                    gap: 15px;
                    margin-bottom: 20px;
                }

                .stat-card {
                    background: #f8f9fa;
                    padding: 15px;
                    border-radius: 8px;
                    text-align: center;
                    border-left: 4px solid #e74c3c;
                }

                .stat-card h3 {
                    margin: 0 0 8px 0;
                    font-size: 14px;
                    color: #666;
                }

                .stat-value {
                    font-size: 24px;
                    font-weight: bold;
                    color: #2c3e50;
                }

                .game-controls {
                    display: flex;
                    gap: 15px;
                    margin-bottom: 25px;
                    justify-content: center;
                }

                .control-btn {
                    padding: 12px 20px;
                    background: #3498db;
                    color: white;
                    border: none;
                    border-radius: 8px;
                    font-size: 16px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: all 0.3s ease;
                }

                .control-btn:hover {
                    background: #2980b9;
                    transform: translateY(-2px);
                }

                .game-animation {
                    background: linear-gradient(180deg, #87CEEB 0%, #98FB98 100%);
                    border-radius: 12px;
                    padding: 20px;
                    margin-bottom: 20px;
                    text-align: center;
                }

                .game-messages {
                    min-height: 40px;
                    padding: 10px;
                    background: #f8f9fa;
                    border-radius: 6px;
                    border-left: 4px solid #3498db;
                }

                @keyframes bounce {
                    0%, 100% { transform: translateY(0); }
                    50% { transform: translateY(-10px); }
                }

                .bounce {
                    animation: bounce 0.5s ease infinite;
                }

                .fade-in {
                    animation: fadeIn 0.3s ease;
                }

                @keyframes fadeIn {
                    from { opacity: 0; transform: translateY(10px); }
                    to { opacity: 1; transform: translateY(0); }
                }
            </style>
        `;
        
        document.head.insertAdjacentHTML('beforeend', styles);
    }

    // ✅ Инициализация игры
    initGame() {
        console.log('🎮 Initializing Happy Birds game...');
        this.loadProgress(); // Загружаем сохраненный прогресс
        this.updateUI();
    }

    // ✅ Привязка событий игры
    bindGameEvents() {
        // Кнопка возврата в меню
        const backBtn = document.getElementById('hb-back-btn');
        if (backBtn) {
            backBtn.addEventListener('click', () => {
                this.returnToMenu();
            });
        }

        // Кнопка сбора яиц
        const collectBtn = document.getElementById('hb-collect-btn');
        if (collectBtn) {
            collectBtn.addEventListener('click', () => {
                this.collectEggs();
            });
        }

        // Кнопка покупки птицы
        const buyBtn = document.getElementById('hb-buy-btn');
        if (buyBtn) {
            buyBtn.addEventListener('click', () => {
                this.buyBird();
            });
        }
    }

    // ✅ Возврат в меню
    returnToMenu() {
        console.log('🏠 Returning to menu from game...');
        
        // Используем gameManager если доступен, иначе глобальную функцию
        if (this.gameManager) {
            this.gameManager.returnToMenu();
        } else if (window.returnToGameMenu) {
            window.returnToGameMenu();
        } else if (window.gameManager) {
            window.gameManager.returnToMenu();
        } else {
            console.error('No way to return to menu!');
            // Fallback: перезагружаем страницу
            window.location.reload();
        }
    }

    // ✅ Сбор яиц
    collectEggs() {
        const eggsCollected = this.birds.red * 5;
        this.eggs.red += eggsCollected;
        
        this.animateCollection();
        this.showGameMessage(`+${eggsCollected} red eggs collected!`, 'success');
        this.updateUI();
    }

    // ✅ Покупка птицы
    buyBird() {
        const birdCost = 100;
        
        if (this.coins >= birdCost) {
            this.coins -= birdCost;
            this.birds.red += 1;
            
            this.showGameMessage('🎉 Purchased 1 Red Bird!', 'success');
            this.updateUI();
        } else {
            this.showGameMessage('❌ Not enough coins!', 'error');
        }
    }

    // ✅ Анимация сбора
    animateCollection() {
        const animationArea = document.getElementById('bird-animation');
        if (animationArea) {
            animationArea.classList.add('bounce');
            setTimeout(() => {
                animationArea.classList.remove('bounce');
            }, 500);
        }
    }

    // ✅ Обновление UI
    updateUI() {
        const coinsEl = document.getElementById('hb-coins');
        const birdsEl = document.getElementById('hb-red-birds');
        const eggsEl = document.getElementById('hb-red-eggs');
        
        if (coinsEl) coinsEl.textContent = this.coins;
        if (birdsEl) birdsEl.textContent = this.birds.red;
        if (eggsEl) eggsEl.textContent = this.eggs.red;
        
        // Обновляем валюты в менеджере
        if (window.currencyManager) {
            window.currencyManager.updateBalance('happy-birds', this.coins);
        }
    }

    // ✅ Показать сообщение в игре
    showGameMessage(message, type = 'info') {
        const messagesContainer = document.getElementById('hb-messages');
        if (!messagesContainer) return;

        const messageDiv = document.createElement('div');
        messageDiv.className = 'fade-in';
        messageDiv.style.cssText = `
            padding: 8px 12px;
            margin: 5px 0;
            border-radius: 4px;
            background: ${type === 'success' ? '#d4edda' : type === 'error' ? '#f8d7da' : '#d1ecf1'};
            color: ${type === 'success' ? '#155724' : type === 'error' ? '#721c24' : '#0c5460'};
            border: 1px solid ${type === 'success' ? '#c3e6cb' : type === 'error' ? '#f5c6cb' : '#bee5eb'};
        `;
        messageDiv.textContent = message;
        
        messagesContainer.appendChild(messageDiv);
        
        setTimeout(() => {
            if (messageDiv.parentNode) {
                messageDiv.parentNode.removeChild(messageDiv);
            }
        }, 3000);
    }

    // ✅ Игровой цикл
    startGameLoop() {
        this.gameLoop = setInterval(() => {
            if (!this.isRunning) {
                clearInterval(this.gameLoop);
                return;
            }
            
            // Автоматическое производство яиц
            if (this.birds.red > 0) {
                this.eggs.red += this.birds.red;
                this.updateUI();
            }
        }, 5000);
    }

    // ✅ Очистка
    cleanup() {
        if (this.gameLoop) {
            clearInterval(this.gameLoop);
        }
        this.saveProgress();
    }

    // ✅ Сохранить прогресс игры
    async saveProgress() {
        const gameState = {
            coins: this.coins,
            birds: this.birds,
            eggs: this.eggs
        };
        
        const username = localStorage.getItem('lapia_games_user');
        if (username) {
            localStorage.setItem(`happybirds_save_${username}`, JSON.stringify(gameState));
        }
        
        console.log('💾 Game progress saved');
    }

    // ✅ Загрузить прогресс игры
    async loadProgress() {
        const username = localStorage.getItem('lapia_games_user');
        if (username) {
            const saved = localStorage.getItem(`happybirds_save_${username}`);
            if (saved) {
                const gameState = JSON.parse(saved);
                this.coins = gameState.coins || 0;
                this.birds = gameState.birds || { red: 1 };
                this.eggs = gameState.eggs || { red: 0 };
                console.log('📂 Game progress loaded');
            }
        }
    }
}