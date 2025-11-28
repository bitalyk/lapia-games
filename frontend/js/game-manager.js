class GameManager {
    constructor() {
        this.currentGame = null;
        this.availableGames = {
            'happy-birds': {
                name: 'Happy Birds',
                path: '../games/happy-birds/game.js',
                currency: 'eggs'
            },
            'rich-garden': {
                name: 'Rich Garden',
                path: '../games/rich-garden/game.js',
                currency: 'fruits'
            },
            'golden-mine': {
                name: 'Golden Mine',
                path: '../games/golden-mine/game.js',
                currency: 'ore'
            }
        };
        
        // ✅ Регистрируем глобальные функции
        this.registerGlobalFunctions();
    }

    // ✅ Регистрация глобальных функций
    registerGlobalFunctions() {
        window.returnToGameMenu = () => this.returnToMenu();
        window.showGameError = (message) => this.showError(message);
    }

    // ✅ Запуск игры
    async launchGame(gameId) {
        console.log(`🔄 Launching game: ${gameId}`);
        
        this.showGameArea();
        
        try {
            if (gameId === 'happy-birds') {
                const { default: HappyBirdsGame } = await import('../games/happy-birds/game.js');
                this.currentGame = new HappyBirdsGame();
                
                // ✅ Передаем gameManager в игру
                this.currentGame.setGameManager(this);
                
                await this.currentGame.start();
            } else if (gameId === 'rich-garden') {
                const { default: RichGardenGame } = await import('../games/rich-garden/game.js');
                this.currentGame = new RichGardenGame();
                
                // ✅ Передаем gameManager в игру
                this.currentGame.setGameManager(this);
                
                await this.currentGame.start();
            } else if (gameId === 'golden-mine') {
                const { default: GoldenMineGame } = await import('../games/golden-mine/game.js');
                this.currentGame = new GoldenMineGame();
                
                // ✅ Передаем gameManager в игру
                this.currentGame.setGameManager(this);
                
                await this.currentGame.start();
            } else {
                this.showError('Game not available yet');
            }
        } catch (error) {
            console.error('❌ Game launch failed:', error);
            await this.launchHappyBirdsFallback();
        }
    }

    // ✅ Передача gameManager в игру
    setGameManagerForCurrentGame() {
        if (this.currentGame && this.currentGame.setGameManager) {
            this.currentGame.setGameManager(this);
        }
    }

    // ✅ Возврат в меню
    returnToMenu() {
        console.log('🏠 Returning to menu...');
        
        if (this.currentGame && this.currentGame.stop) {
            this.currentGame.stop();
        }
        this.currentGame = null;
        
        this.showMenu();
        this.updateMenuAfterGame();
    }

    // ✅ Показать игровую область
    showGameArea() {
        const gameArea = document.getElementById('game-area');
        const gameMenu = document.getElementById('game-menu');
        
        if (gameArea) {
            gameArea.style.display = 'block';
            gameArea.innerHTML = '<div style="padding: 20px; text-align: center;"><h2>🎮 Loading Game...</h2><p>Please wait while the game loads</p></div>';
        }
        if (gameMenu) gameMenu.style.display = 'none';
        
        console.log('🎮 Game area shown');
    }

    // ✅ Показать меню
    showMenu() {
        const gameArea = document.getElementById('game-area');
        const gameMenu = document.getElementById('game-menu');
        
        if (gameArea) {
            gameArea.style.display = 'none';
            gameArea.innerHTML = '';
        }
        if (gameMenu) gameMenu.style.display = 'block';
        
        console.log('🏠 Menu shown');
    }

    // ✅ Обновление меню после игры
    updateMenuAfterGame() {
        if (window.authManager && window.authManager.currentUser) {
            window.authManager.updateMenuUserInfo();
        }
        
        if (window.currencyManager) {
            window.currencyManager.updateUI();
        }
        
        console.log('🔄 Menu updated after game session');
    }

    // ✅ Fallback для Happy Birds
    async launchHappyBirdsFallback() {
        const gameArea = document.getElementById('game-area');
        if (!gameArea) return;

        gameArea.innerHTML = `
            <div style="padding: 20px;">
                <h2>🐦 Happy Birds (Simple Version)</h2>
                <button onclick="window.returnToGameMenu()" style="margin-bottom: 20px; padding: 10px 20px;">
                    ← Back to Menu
                </button>
                <div style="text-align: center; padding: 40px;">
                    <h3>Simple Happy Birds Game</h3>
                    <p>This is a fallback version of the game.</p>
                    <button onclick="this.simpleCollect()" style="padding: 15px 30px; font-size: 18px; margin: 10px;">
                        🥚 Collect Eggs
                    </button>
                    <div id="simple-stats" style="margin: 20px 0;">
                        <p>Coins: <span id="simple-coins">0</span></p>
                        <p>Eggs: <span id="simple-eggs">0</span></p>
                    </div>
                </div>
            </div>
        `;

        // Простая логика для fallback версии
        window.simpleCollect = () => {
            const coinsEl = document.getElementById('simple-coins');
            const eggsEl = document.getElementById('simple-eggs');
            if (coinsEl && eggsEl) {
                let coins = parseInt(coinsEl.textContent) || 0;
                let eggs = parseInt(eggsEl.textContent) || 0;
                
                eggs += 5;
                if (eggs >= 10) {
                    coins += 1;
                    eggs = 0;
                }
                
                coinsEl.textContent = coins;
                eggsEl.textContent = eggs;
                
                if (window.currencyManager) {
                    window.currencyManager.updateBalance('happy-birds', coins);
                }
            }
        };
    }

    // ✅ Показать ошибку
    showError(message) {
        const gameArea = document.getElementById('game-area');
        if (gameArea) {
            gameArea.innerHTML = `
                <div style="padding: 40px; text-align: center;">
                    <h2>❌ Game Error</h2>
                    <p>${message}</p>
                    <button onclick="window.returnToGameMenu()" style="margin-top: 20px; padding: 10px 20px;">
                        ← Back to Menu
                    </button>
                </div>
            `;
        } else {
            alert(`Game Error: ${message}`);
        }
    }

    // ✅ Получить текущую игру
    getCurrentGame() {
        return this.currentGame;
    }

    // ✅ Проверить, запущена ли игра
    isGameRunning() {
        return this.currentGame !== null;
    }

    // ✅ Остановить текущую игру
    stopCurrentGame() {
        if (this.currentGame && this.currentGame.stop) {
            this.currentGame.stop();
            this.currentGame = null;
            return true;
        }
        return false;
    }

    // ✅ Получить список доступных игр
    getAvailableGames() {
        return this.availableGames;
    }
}

// Создаем глобальный экземпляр
window.gameManager = new GameManager();
console.log('✅ Game Manager initialized');