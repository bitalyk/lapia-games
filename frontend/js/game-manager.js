class GameManager {
    constructor() {
        this.currentGame = null;
        this.lastRequestedGameId = null;
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
            },
            'cat-chess': {
                name: 'Cat Chess',
                path: '../games/cat-chess/game.js',
                currency: 'cats'
            },
            'fishes': {
                name: 'Fishes',
                path: '../games/fishes/game.js',
                currency: 'fish'
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
        this.lastRequestedGameId = gameId;
        
        try {
            let started = false;
            if (gameId === 'happy-birds') {
                const { default: HappyBirdsGame } = await import('../games/happy-birds/game.js');
                this.currentGame = new HappyBirdsGame();
                
                // ✅ Передаем gameManager в игру
                this.currentGame.setGameManager(this);
                
                await this.currentGame.start();
                started = true;
            } else if (gameId === 'rich-garden') {
                const { default: RichGardenGame } = await import('../games/rich-garden/game.js');
                this.currentGame = new RichGardenGame();
                
                // ✅ Передаем gameManager в игру
                this.currentGame.setGameManager(this);
                
                await this.currentGame.start();
                started = true;
            } else if (gameId === 'golden-mine') {
                const { default: GoldenMineGame } = await import('../games/golden-mine/game.js');
                this.currentGame = new GoldenMineGame();
                
                // ✅ Передаем gameManager в игру
                this.currentGame.setGameManager(this);
                
                await this.currentGame.start();
                started = true;
            } else if (gameId === 'cat-chess') {
                const { default: CatChessGame } = await import('../games/cat-chess/game.js');
                this.currentGame = new CatChessGame();
                
                // ✅ Передаем gameManager в игру
                this.currentGame.setGameManager(this);
                
                await this.currentGame.start();
                started = true;
            } else if (gameId === 'fishes') {
                const { default: FishesGame } = await import('../games/fishes/game.js');
                this.currentGame = new FishesGame();

                this.currentGame.setGameManager(this);

                await this.currentGame.start();
                started = true;
            } else {
                this.showError('Game not available yet');
                return;
            }

            if (started) {
                this.recordGameLaunch(gameId);
            }
        } catch (error) {
            console.error('❌ Game launch failed:', error);
            this.showGameLoadError(error);
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

    // ✅ Общий fallback-экран, если игра не загрузилась
    showGameLoadError(error) {
        const gameArea = document.getElementById('game-area');
        if (!gameArea) return;

        this.currentGame = null;

        const requestedGame = this.lastRequestedGameId && this.availableGames[this.lastRequestedGameId]
            ? this.availableGames[this.lastRequestedGameId].name
            : 'this game';

        gameArea.innerHTML = `
            <div style="min-height: 100%; display: flex; align-items: center; justify-content: center; padding: 48px;">
                <div style="max-width: 520px; width: 100%; background: rgba(0, 0, 0, 0.35); border-radius: 16px; padding: 36px; text-align: center; box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25);">
                    <div style="font-size: 48px; margin-bottom: 16px;">⚠️</div>
                    <h2 style="margin-bottom: 12px;">Game Failed to Load</h2>
                    <p style="margin-bottom: 24px; line-height: 1.5;">
                        We couldn't start <strong>${requestedGame}</strong>. This usually happens when the game files are missing or the connection was interrupted.
                    </p>
                    <div style="display: flex; gap: 12px; justify-content: center; flex-wrap: wrap;">
                        <button data-action="retry-game" style="padding: 12px 24px; border-radius: 999px; border: none; background: #4b8df8; color: #fff; font-size: 16px; cursor: pointer;">
                            🔄 Try Again
                        </button>
                        <button data-action="back-to-menu" style="padding: 12px 24px; border-radius: 999px; border: 1px solid rgba(255,255,255,0.2); background: transparent; color: #fff; font-size: 16px; cursor: pointer;">
                            ← Back to Menu
                        </button>
                    </div>
                </div>
            </div>
        `;

        if (error && this.consoleMessages) {
            console.error('Game load error details:', error);
        }

        const retryButton = gameArea.querySelector('[data-action="retry-game"]');
        if (retryButton) {
            retryButton.addEventListener('click', () => {
                if (this.lastRequestedGameId) {
                    this.launchGame(this.lastRequestedGameId);
                } else {
                    this.showMenu();
                }
            });
        }

        const backButton = gameArea.querySelector('[data-action="back-to-menu"]');
        if (backButton) {
            backButton.addEventListener('click', () => this.returnToMenu());
        }
    }

    // ✅ Показать ошибку
    showError(message) {
        window.toastManager?.show(message, 'error');
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

    recordGameLaunch(gameId) {
        if (!gameId) return;
        if (window.authManager?.updateGameProgress) {
            window.authManager.updateGameProgress(gameId, {});
        }
    }
}

// Создаем глобальный экземпляр
window.gameManager = new GameManager();
console.log('✅ Game Manager initialized');