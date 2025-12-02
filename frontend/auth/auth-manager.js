export class AuthManager {
    constructor() {
        this.currentUser = null;
        this.isLoggedIn = false;
        this.API_BASE = "http://localhost:3000/api";
        this.init();
    }

    async init() {
        try {
            await this.checkExistingSession();
        } catch (error) {
            console.error('Failed to initialize auth manager:', error);
        } finally {
            this.bindAuthEvents();
            this.registerGlobalFunctions();
            this.updateAuthUI();
            this.revealUI();
        }
    }

    // ✅ ДОБАВЛЯЕМ: Метод проверки аутентификации
    isAuthenticated() {
        return this.isLoggedIn;
    }

    // ✅ ДОБАВЛЯЕМ: Метод успешного логина
    onLoginSuccess(userData) {
        console.log('✅ Login successful for:', userData.username);
        
        // Обновляем UI
        this.updateAuthUI();
        this.revealUI();
        
        // Загружаем валюты пользователя
        this.initializeUserCurrencies(userData.username);
        
        // Загружаем игровое меню
        this.loadGameMenu();
        
        // Отправляем событие
        window.dispatchEvent(new CustomEvent('platformLogin', {
            detail: { user: userData }
        }));
    }

    // ✅ ДОБАВЛЯЕМ: Метод выхода
    onLogout() {
        console.log('✅ Logout completed');
        this.updateAuthUI();
        this.revealUI();
        
        window.dispatchEvent(new CustomEvent('platformLogout'));
    }

    // ✅ ДОБАВЛЯЕМ: Обновление UI аутентификации
    updateAuthUI() {
        const authContainer = document.getElementById('auth-container');
        const gameMenu = document.getElementById('game-menu');
        const gameArea = document.getElementById('game-area');

        if (this.isLoggedIn && this.currentUser) {
            // Показываем игровое меню
            if (authContainer) authContainer.style.display = 'none';
            if (gameMenu) gameMenu.style.display = 'block';
            if (gameArea) gameArea.style.display = 'none';
        } else {
            // Показываем форму авторизации
            if (authContainer) authContainer.style.display = 'block';
            if (gameMenu) gameMenu.style.display = 'none';
            if (gameArea) gameArea.style.display = 'none';
        }
    }

    revealUI() {
        const body = document.body;
        if (body?.classList.contains('app-loading')) {
            body.classList.remove('app-loading');
        }
    }

    cachePlatformProfile(profile) {
        if (!profile?.username) return;
        const normalized = { ...profile };
        normalized.gamesProgress = this.normalizeGamesProgressData(profile.gamesProgress);
        localStorage.setItem(`platform_profile_${profile.username}`, JSON.stringify(normalized));
    }

    // ✅ ДОБАВЛЯЕМ: Создание профиля пользователя
    async createUserProfile(userProfile) {
        if (!userProfile.gamesProgress) {
            userProfile.gamesProgress = {};
        }
        this.cachePlatformProfile(userProfile);
        
        // Инициализируем базовые валюты
        const initialCurrencies = {
            'platform': { name: 'Platform Tokens', symbol: '🪙', balance: 100 },
            'happy-birds': { name: 'Bird Eggs', symbol: '🥚', balance: 0 },
            'fishes': { name: 'Aquarium Coins', symbol: '🐟', balance: 0 }
        };
        
        localStorage.setItem(`currency_balances_${userProfile.username}`, JSON.stringify(initialCurrencies));
        
        return userProfile;
    }

    // ✅ ДОБАВЛЯЕМ: Загрузка профиля пользователя
    getCachedProfile(username) {
        if (!username) return null;
        const saved = localStorage.getItem(`platform_profile_${username}`);
        if (!saved) return null;
        try {
            const parsed = JSON.parse(saved);
            parsed.gamesProgress = this.normalizeGamesProgressData(parsed.gamesProgress);
            return parsed;
        } catch (error) {
            console.warn('Failed to parse cached profile, clearing it...', error);
            localStorage.removeItem(`platform_profile_${username}`);
            return null;
        }
    }

    normalizeGamesProgressData(progress) {
        if (!progress) return {};
        if (progress instanceof Map) {
            return Object.fromEntries(progress);
        }
        if (typeof progress === 'object') {
            return { ...progress };
        }
        return {};
    }

    mergeProgressMaps(remoteProgress = {}, localProgress = {}) {
        const remote = this.normalizeGamesProgressData(remoteProgress);
        const local = this.normalizeGamesProgressData(localProgress);
        const merged = { ...remote };

        Object.entries(local).forEach(([gameId, localEntry]) => {
            const safeLocal = (localEntry && typeof localEntry === 'object') ? localEntry : {};
            const remoteEntry = (remote[gameId] && typeof remote[gameId] === 'object') ? remote[gameId] : {};
            const combined = { ...safeLocal, ...remoteEntry };

            const localDate = safeLocal?.lastPlayed ? new Date(safeLocal.lastPlayed) : null;
            const remoteDate = remoteEntry?.lastPlayed ? new Date(remoteEntry.lastPlayed) : null;

            if (localDate && remoteDate) {
                combined.lastPlayed = remoteDate > localDate ? remoteEntry.lastPlayed : safeLocal.lastPlayed;
            } else {
                combined.lastPlayed = remoteEntry.lastPlayed || safeLocal.lastPlayed;
            }

            merged[gameId] = combined;
        });

        return merged;
    }

    async fetchPlatformProfile(username) {
        if (!username) return null;

        const endpoints = [
            `${this.API_BASE}/users/platform-data/${username}`,
            `${this.API_BASE}/platform/profile/${username}`
        ];

        for (const url of endpoints) {
            try {
                const response = await fetch(url);
                if (!response.ok) {
                    continue;
                }

                const data = await response.json();
                if (!data?.success) {
                    continue;
                }

                const profile = data.platformData || data.profile;
                if (!profile) {
                    continue;
                }

                profile.gamesProgress = this.normalizeGamesProgressData(profile.gamesProgress);
                return profile;
            } catch (error) {
                console.warn(`Failed to fetch platform profile from ${url}:`, error);
            }
        }

        return null;
    }

    async resolveCurrentUserProfile(username) {
        const remoteProfile = await this.fetchPlatformProfile(username);
        if (remoteProfile) {
            const cached = this.getCachedProfile(username) || {};
            const mergedProfile = { ...cached, ...remoteProfile };
            mergedProfile.gamesProgress = this.mergeProgressMaps(remoteProfile.gamesProgress, cached.gamesProgress);
            mergedProfile.username = remoteProfile.username || cached.username || username;
            mergedProfile.gamesProgress = this.normalizeGamesProgressData(mergedProfile.gamesProgress);
            this.cachePlatformProfile(mergedProfile);
            return mergedProfile;
        }

        const localProfile = await this.loadUserProfile(username);
        if (!localProfile.username) {
            localProfile.username = username;
        }
        localProfile.gamesProgress = this.normalizeGamesProgressData(localProfile.gamesProgress);
        this.cachePlatformProfile(localProfile);
        return localProfile;
    }

    async loadUserProfile(username) {
        const cached = this.getCachedProfile(username);
        if (cached) {
            this.cachePlatformProfile(cached);
            return cached;
        }

        // Создаем базовый профиль если не существует
        const basicProfile = {
            username: username,
            registeredAt: new Date().toISOString(),
            games: {
                'happy-birds': { unlocked: true, progress: {} },
                'fishes': { unlocked: true, progress: {} }
            },
            platformStats: {
                achievements: []
            },
            gamesProgress: {}
        };
        return await this.createUserProfile(basicProfile);
    }

    // ✅ ДОБАВЛЯЕМ: Инициализация валют для пользователя
    async initializeUserCurrencies(username) {
        const saved = localStorage.getItem(`currency_balances_${username}`);
        if (!saved) {
            const initialCurrencies = {
                'platform': { name: 'Platform Tokens', symbol: '🪙', balance: 100 },
                'happy-birds': { name: 'Bird Eggs', symbol: '🥚', balance: 0 },
                'fishes': { name: 'Aquarium Coins', symbol: '🐟', balance: 0 }
            };
            localStorage.setItem(`currency_balances_${username}`, JSON.stringify(initialCurrencies));
        }
        
        // Загружаем в менеджер валют
        if (window.currencyManager) {
            const balances = JSON.parse(localStorage.getItem(`currency_balances_${username}`) || '{}');
            window.currencyManager.currencies = balances;
            window.currencyManager.updateUI();
        }
    }

    // ✅ ДОБАВЛЯЕМ: Сохранение сессии
    saveSession(userProfile) {
        localStorage.setItem('platform_user', JSON.stringify({
            username: userProfile.username,
            lastLogin: new Date().toISOString()
        }));
    }

    // ✅ ДОБАВЛЯЕМ: Сохранение прогресса
    saveProgress() {
        if (!this.currentUser) {
            return;
        }

        this.cachePlatformProfile(this.currentUser);

        if (window.currencyManager) {
            // Сохраняем балансы валют
            localStorage.setItem(
                `currency_balances_${this.currentUser.username}`, 
                JSON.stringify(window.currencyManager.currencies)
            );
        }
    }

    // ✅ ДОБАВЛЯЕМ: Привязка глобальных событий аутентификации
    bindAuthEvents() {
        // Глобальные события аутентификации
        window.addEventListener('platformLogin', (event) => {
            console.log('User logged in:', event.detail.user.username);
        });

        window.addEventListener('platformLogout', () => {
            console.log('User logged out');
        });
    }

    // ✅ НОВЫЙ МЕТОД: Регистрация глобальных функций
    registerGlobalFunctions() {
        window.openShop = () => this.openShop();
        window.openExchange = () => this.openExchange();
        window.openAchievements = () => this.openAchievements();
        window.openSettings = () => this.openSettings();
        window.launchGame = (gameId) => this.launchGame(gameId);
        window.logout = () => this.logout();
    }

    // ✅ ОБНОВЛЕННЫЙ: Проверка существующей сессии
    async checkExistingSession() {
        const savedUser = localStorage.getItem('platform_user');
        if (savedUser) {
            try {
                const userData = JSON.parse(savedUser);
                const isValid = await this.validateSession(userData);
                
                if (isValid) {
                    console.log('✅ Session validated successfully');
                } else {
                    console.log('❌ Session invalid, logging out');
                    this.logout();
                }
            } catch (error) {
                console.error('Session validation failed:', error);
                this.logout();
            }
        } else {
            console.log('ℹ️ No existing session found');
        }
    }

    // ✅ ОБНОВЛЕННЫЙ: Валидация сессии на сервере
    async validateSession(userData) {
        try {
            const username = userData?.username;
            if (!username) {
                return false;
            }

            const response = await fetch(`${this.API_BASE}/users/profile/${username}`);
            
            if (response.status === 404) {
                console.log('User not found on server');
                return false;
            }
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            const data = await response.json();
            
            if (data.success) {
                const profile = await this.resolveCurrentUserProfile(username);
                if (!profile) {
                    throw new Error('Failed to resolve user profile');
                }

                this.currentUser = profile;
                this.isLoggedIn = true;
                this.saveSession(profile);
                this.onLoginSuccess(profile);
                return true;
            } else {
                throw new Error('Invalid response format');
            }
        } catch (error) {
            console.error('Session validation failed:', error);
            
            // ✅ Fallback: проверяем через game status если profile endpoint не работает
            try {
                console.log('🔄 Trying fallback validation...');
                const username = userData?.username;
                const fallbackResponse = username ? await fetch(`${this.API_BASE}/game/status/${username}`) : null;
                if (fallbackResponse?.ok) {
                    await fallbackResponse.json();
                    const profile = await this.loadUserProfile(username);
                    this.currentUser = profile;
                    this.isLoggedIn = true;
                    this.saveSession(profile);
                    this.onLoginSuccess(profile);
                    return true;
                }
            } catch (fallbackError) {
                console.error('Fallback validation also failed:', fallbackError);
            }
            
            return false;
        }
    }

    // ✅ ОБНОВЛЕННЫЙ: Регистрация пользователя
    async register(username, password) {
        try {
            const response = await fetch(`${this.API_BASE}/users/register`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username, password })
            });

            // ✅ Обрабатываем разные статусы ответа
            if (response.status === 400) {
                const data = await response.json();
                return { success: false, error: data.error || "Registration failed" };
            }

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();

            if (data.success) {
                // Создаем профиль платформы
                const userProfile = {
                    username: username,
                    registeredAt: new Date().toISOString(),
                    games: {
                        'happy-birds': { unlocked: true, progress: {} }
                    },
                    platformStats: {
                        achievements: []
                    }
                };

                // Сохраняем профиль
                await this.createUserProfile(userProfile);
                
                // Автоматически логиним после регистрации
                const loginResult = await this.login(username, password);
                
                return loginResult;
            } else {
                return { success: false, error: data.error || "Registration failed" };
            }
        } catch (error) {
            console.error("Registration error:", error);
            return { success: false, error: "Registration failed - server unavailable" };
        }
    }

    // ✅ ОБНОВЛЕННЫЙ: Логин пользователя
    async login(username, password) {
        try {
            const response = await fetch(`${this.API_BASE}/users/login`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username, password })
            });

            // ✅ Обрабатываем разные статусы ответа
            if (response.status === 401) {
                const data = await response.json();
                return { success: false, error: data.error || "Invalid credentials" };
            }

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();

            if (data.success) {
                // Загружаем профиль платформы
                const userProfile = await this.resolveCurrentUserProfile(username);
                
                this.currentUser = userProfile;
                this.isLoggedIn = true;
                
                // Сохраняем сессию
                this.saveSession(userProfile);
                
                // Инициализируем валюты для пользователя
                await this.initializeUserCurrencies(username);
                
                this.onLoginSuccess(userProfile);
                
                return { success: true, user: userProfile };
            } else {
                return { success: false, error: data.error || "Login failed" };
            }
        } catch (error) {
            console.error("Login error:", error);
            return { success: false, error: "Login failed - server unavailable" };
        }
    }

    // ✅ НОВЫЕ МЕТОДЫ: Глобальные функции
    openShop() {
        console.log('🏪 Opening shop...');
        if (window.shopUI) {
            window.shopUI.show();
            window.shopUI.switchTab('marketplace');
        } else {
            alert('Shop system is loading... Please wait a moment.');
        }
    }

    openExchange() {
        console.log('💱 Opening exchange...');
        if (window.shopUI) {
            window.shopUI.show();
            window.shopUI.switchTab('exchange');
        } else {
            alert('Exchange system is loading... Please wait a moment.');
        }
    }

    openAchievements() {
        console.log('🏆 Opening achievements...');
        alert('Achievements system is coming soon!');
    }

    openSettings() {
        console.log('⚙️ Opening settings...');
        alert('Settings panel is coming soon!');
    }

    async launchGame(gameId) {
        console.log(`🎮 Launching game: ${gameId}`);
        
        if (gameId === 'happy-birds' || gameId === 'rich-garden' || gameId === 'golden-mine' || gameId === 'cat-chess' || gameId === 'fishes') {
            try {
                if (window.gameManager) {
                    await window.gameManager.launchGame(gameId);
                } else {
                    console.error('Game manager not available');
                    alert('Game system is not ready. Please refresh the page.');
                }
            } catch (error) {
                console.error('Game launch error:', error);
                alert('Failed to launch game. Please try again.');
            }
        } else {
            alert('This game is coming soon! Stay tuned for updates.');
        }
    }

    // ✅ ОБНОВЛЕННЫЙ: Выход
    logout() {
        console.log('🚪 Logging out...');
        
        // Сохраняем прогресс перед выходом
        this.saveProgress();
        
        this.currentUser = null;
        this.isLoggedIn = false;
        
        // Очищаем хранилище
        localStorage.removeItem('platform_user');
        localStorage.removeItem('lapia_games_user');
        
        // Очищаем сессии для всех пользователей
        Object.keys(localStorage).forEach(key => {
            if (key.startsWith('platform_profile_') || key.startsWith('currency_balances_')) {
                localStorage.removeItem(key);
            }
        });
        
        this.onLogout();
        
        // Перезагружаем страницу для чистого состояния
        window.location.reload();
    }

    // ✅ ОБНОВЛЕННЫЙ: Загрузка игрового меню
    async loadGameMenu() {
        try {
            const response = await fetch('./game-menu/index.html');
            if (!response.ok) {
                throw new Error('Failed to load game menu');
            }
            
            const menuHtml = await response.text();
            const menuContainer = document.getElementById('game-menu');
            
            if (menuContainer) {
                menuContainer.innerHTML = menuHtml;
                menuContainer.style.display = 'block';
                
                // ✅ Ждем пока DOM обновится, затем инициализируем
                setTimeout(() => {
                    this.initializeGameMenu();
                }, 100);
            }
        } catch (error) {
            console.error('Failed to load game menu:', error);
            this.showFallbackMenu();
        }
    }

    // ✅ ОБНОВЛЕННЫЙ: Инициализация игрового меню
    initializeGameMenu() {
        // Обновляем информацию пользователя
        this.updateMenuUserInfo();
        
        // ✅ Перепривязываем события с правильным контекстом
        this.bindMenuEvents();
        
        console.log('🎮 Game menu initialized');
    }

    // ✅ ОБНОВЛЕННЫЙ: Привязка событий меню
    bindMenuEvents() {
        // Удаляем старые обработчики
        this.removeMenuEventListeners();
        
        // Кнопка выхода
        const logoutBtns = document.querySelectorAll('.logout-btn, [onclick*="logout"]');
        logoutBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                this.logout();
            });
        });

        // Кнопка магазина
        const shopBtns = document.querySelectorAll('[onclick*="openShop"], .shop-btn');
        shopBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                this.openShop();
            });
        });

        // Кнопка обмена валют
        const exchangeBtns = document.querySelectorAll('[onclick*="openExchange"], .exchange-btn');
        exchangeBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                this.openExchange();
            });
        });

        // Игровые карточки
        const gameCards = document.querySelectorAll('.game-card:not(.disabled)');
        gameCards.forEach(card => {
            // Handle clicks on the entire card
            card.addEventListener('click', (e) => {
                e.preventDefault();
                const gameTitle = card.querySelector('h3').textContent;
                this.launchGameFromMenu(gameTitle);
            });

            // Also handle clicks on the play button specifically
            const playBtn = card.querySelector('.play-btn');
            if (playBtn) {
                playBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const gameTitle = card.querySelector('h3').textContent;
                    this.launchGameFromMenu(gameTitle);
                });
            }
        });

        // Кнопки достижений и настроек
        const achievementBtns = document.querySelectorAll('[onclick*="openAchievements"]');
        achievementBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                this.openAchievements();
            });
        });

        const settingsBtns = document.querySelectorAll('[onclick*="openSettings"]');
        settingsBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                this.openSettings();
            });
        });
    }

    // ✅ ПРОСТОЙ ВАРИАНТ: Удаляем только по классам (рекомендуется)
removeMenuEventListeners() {
    const selectors = [
        '.logout-btn',
        '.shop-btn', 
        '.exchange-btn',
        '.game-card:not(.disabled)',
        '.achievements-btn',
        '.settings-btn'
    ];
    
    const selectorString = selectors.join(', ');
    const elements = document.querySelectorAll(selectorString);
    
    elements.forEach(element => {
        const newElement = element.cloneNode(true);
        if (element.parentNode) {
            element.parentNode.replaceChild(newElement, element);
        }
    });
}

    // ✅ ОБНОВЛЕННЫЙ: Запуск игры из меню
    launchGameFromMenu(gameTitle) {
        const gameMap = {
            'Happy Birds': 'happy-birds',
            'Rich Garden': 'rich-garden',
            'Golden Mine': 'golden-mine',
            'Cat Chess': 'cat-chess',
            'Fishes': 'fishes',
            'Target Master': 'target-master', 
            'Puzzle Quest': 'puzzle-quest',
            'Speed Runner': 'speed-runner'
        };
        
        const gameId = gameMap[gameTitle];
        
        if (gameId) {
            this.launchGame(gameId);
        }
    }

    // ✅ ДОБАВЛЯЕМ: Обновление информации пользователя в меню
    updateMenuUserInfo() {
        try {
            const usernameDisplay = document.getElementById('username-display');
            const platformTokens = document.getElementById('platform-tokens');
            const hbLastPlayed = document.getElementById('hb-last-played');
            const rgLastPlayed = document.getElementById('rg-last-played');
            const gmLastPlayed = document.getElementById('gm-last-played');
            const ccLastPlayed = document.getElementById('cc-last-played');
            const fgLastPlayed = document.getElementById('fg-last-played');
            
            // Обновляем имя пользователя
            if (usernameDisplay && this.currentUser) {
                usernameDisplay.textContent = this.currentUser.username;
            }
            
            // Обновляем токены платформы
            if (platformTokens && window.currencyManager) {
                const tokens = window.currencyManager.getBalance('platform');
                platformTokens.textContent = `🪙 Platform Tokens: ${tokens}`;
            }
            
            // Обновляем последнюю игру Happy Birds
            if (hbLastPlayed) {
                const lastPlayed = this.getHappyBirdsLastPlayed();
                hbLastPlayed.textContent = lastPlayed;
            }
            
            // Обновляем последнюю игру Rich Garden
            if (rgLastPlayed) {
                const lastPlayed = this.getRichGardenLastPlayed();
                rgLastPlayed.textContent = lastPlayed;
            }
            
            // Обновляем последнюю игру Golden Mine
            if (gmLastPlayed) {
                const lastPlayed = this.getGoldenMineLastPlayed();
                gmLastPlayed.textContent = lastPlayed;
            }
            
            // Обновляем последнюю игру Cat Chess
            if (ccLastPlayed) {
                const lastPlayed = this.getCatChessLastPlayed();
                ccLastPlayed.textContent = lastPlayed;
            }

            if (fgLastPlayed) {
                const lastPlayed = this.getFishesLastPlayed();
                fgLastPlayed.textContent = lastPlayed;
            }
            
            console.log('📊 Menu user info updated');
        } catch (error) {
            console.error('Error updating menu user info:', error);
        }
    }

    // ✅ ДОБАВЛЯЕМ: Получение времени последней игры Happy Birds
    getHappyBirdsLastPlayed() {
        try {
            if (this.currentUser?.gamesProgress?.['happy-birds']?.lastPlayed) {
                const lastPlayed = new Date(this.currentUser.gamesProgress['happy-birds'].lastPlayed);
                return lastPlayed.toLocaleDateString();
            }
            
            // Проверяем localStorage как fallback
            const username = this.currentUser?.username || localStorage.getItem('lapia_games_user');
            if (username) {
                const saved = localStorage.getItem(`happybirds_save_${username}`);
                if (saved) {
                    return 'Recently';
                }
            }
            
            return 'Never';
        } catch (error) {
            console.error('Error getting last played time:', error);
            return 'Unknown';
        }
    }

    // ✅ ДОБАВЛЯЕМ: Получение времени последней игры Rich Garden
    getRichGardenLastPlayed() {
        try {
            if (this.currentUser?.gamesProgress?.['rich-garden']?.lastPlayed) {
                const lastPlayed = new Date(this.currentUser.gamesProgress['rich-garden'].lastPlayed);
                return lastPlayed.toLocaleDateString();
            }
            
            return 'Never';
        } catch (error) {
            console.error('Error getting Rich Garden last played time:', error);
            return 'Unknown';
        }
    }

    // ✅ ДОБАВЛЯЕМ: Получение времени последней игры Golden Mine
    getGoldenMineLastPlayed() {
        try {
            if (this.currentUser?.gamesProgress?.['golden-mine']?.lastPlayed) {
                const lastPlayed = new Date(this.currentUser.gamesProgress['golden-mine'].lastPlayed);
                return lastPlayed.toLocaleDateString();
            }
            
            return 'Never';
        } catch (error) {
            console.error('Error getting Golden Mine last played time:', error);
            return 'Unknown';
        }
    }

    // ✅ ДОБАВЛЯЕМ: Получение времени последней игры Cat Chess
    getCatChessLastPlayed() {
        try {
            if (this.currentUser?.gamesProgress?.['cat-chess']?.lastPlayed) {
                const lastPlayed = new Date(this.currentUser.gamesProgress['cat-chess'].lastPlayed);
                return lastPlayed.toLocaleDateString();
            }
            
            return 'Never';
        } catch (error) {
            console.error('Error getting Cat Chess last played time:', error);
            return 'Unknown';
        }
    }

    getFishesLastPlayed() {
        try {
            if (this.currentUser?.gamesProgress?.['fishes']?.lastPlayed) {
                const lastPlayed = new Date(this.currentUser.gamesProgress['fishes'].lastPlayed);
                return lastPlayed.toLocaleDateString();
            }

            return 'Never';
        } catch (error) {
            console.error('Error getting Fishes last played time:', error);
            return 'Unknown';
        }
    }

    // ✅ ДОБАВЛЯЕМ: Обновление статистики платформы
    updatePlatformStats(statsUpdate) {
        if (this.currentUser) {
            if (!this.currentUser.platformStats) {
                this.currentUser.platformStats = {};
            }
            
            Object.assign(this.currentUser.platformStats, statsUpdate);
            this.saveProgress();
            
            // Обновляем UI если меню активно
            this.updateMenuUserInfo();
        }
    }

    // ✅ ДОБАВЛЯЕМ: Обновление прогресса игры
    updateGameProgress(gameId, progress = {}) {
        if (!this.currentUser) {
            return;
        }

        if (!this.currentUser.gamesProgress) {
            this.currentUser.gamesProgress = {};
        }

        if (!this.currentUser.gamesProgress[gameId]) {
            this.currentUser.gamesProgress[gameId] = {};
        }

        const existing = this.currentUser.gamesProgress[gameId];
        const merged = { ...existing, ...progress };
        const providedLastPlayed = progress.lastPlayed;
        merged.lastPlayed = providedLastPlayed || merged.lastPlayed || new Date().toISOString();

        this.currentUser.gamesProgress[gameId] = merged;
        this.saveProgress();

        this.syncGameProgressWithServer(gameId, merged).catch((error) => {
            console.warn('Failed to sync game progress', error);
        });

        this.updateMenuUserInfo();
    }

    async syncGameProgressWithServer(gameId, progress) {
        if (!this.currentUser?.username) {
            return;
        }

        try {
            const response = await fetch(`${this.API_BASE}/platform/game-progress`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: this.currentUser.username,
                    gameId,
                    progress
                })
            });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
        } catch (error) {
            throw error;
        }
    }

    // ✅ ДОБАВЛЯЕМ: Получение текущего пользователя
    getCurrentUser() {
        return this.currentUser;
    }

    // ✅ ДОБАВЛЯЕМ: Проверка разблокировки игры
    isGameUnlocked(gameId) {
        if (!this.currentUser?.gamesProgress) {
            return gameId === 'happy-birds'; // Happy Birds разблокирована по умолчанию
        }
        
        return this.currentUser.gamesProgress[gameId]?.unlocked !== false;
    }

    // ✅ ДОБАВЛЯЕМ: Разблокировка игры
    unlockGame(gameId) {
        if (this.currentUser) {
            this.updateGameProgress(gameId, { unlocked: true });
            console.log(`🎮 Game unlocked: ${gameId}`);
            return true;
        }
        return false;
    }

    // ✅ ДОБАВЛЯЕМ: Добавление достижения
    addAchievement(achievementId, achievementName) {
        if (this.currentUser) {
            if (!this.currentUser.platformStats) {
                this.currentUser.platformStats = {};
            }
            if (!this.currentUser.platformStats.achievements) {
                this.currentUser.platformStats.achievements = [];
            }
            
            if (!this.currentUser.platformStats.achievements.includes(achievementId)) {
                this.currentUser.platformStats.achievements.push(achievementId);
                this.saveProgress();
                
                // Показываем уведомление
                this.showAchievementNotification(achievementName);
                
                console.log(`🏆 Achievement unlocked: ${achievementName}`);
                return true;
            }
        }
        return false;
    }

    // ✅ ДОБАВЛЯЕМ: Показ уведомления о достижении
    showAchievementNotification(achievementName) {
        if (window.showToast) {
            showToast(`🏆 Achievement Unlocked: ${achievementName}`, 'success');
        } else {
            alert(`🎉 Achievement Unlocked: ${achievementName}`);
        }
    }

    // ✅ ДОБАВЛЯЕМ: Получение баланса валюты
    getCurrencyBalance(currencyType) {
        if (window.currencyManager) {
            return window.currencyManager.getBalance(currencyType);
        }
        return 0;
    }

    // ✅ ДОБАВЛЯЕМ: Обновление баланса валюты
    updateCurrencyBalance(currencyType, amount) {
        if (window.currencyManager) {
            return window.currencyManager.updateBalance(currencyType, amount);
        }
        return false;
    }

    // ✅ ДОБАВЛЯЕМ: Проверка возможности покупки
    canAfford(currencyType, amount) {
        if (window.currencyManager) {
            return window.currencyManager.getBalance(currencyType) >= amount;
        }
        return false;
    }

    // ✅ ДОБАВЛЯЕМ: Сброс данных пользователя (для тестирования)
    resetUserData() {
        if (this.currentUser) {
            const username = this.currentUser.username;
            
            // Очищаем localStorage
            localStorage.removeItem(`platform_profile_${username}`);
            localStorage.removeItem(`currency_balances_${username}`);
            localStorage.removeItem(`happybirds_save_${username}`);
            
            // Создаем новый профиль
            this.createUserProfile({
                username: username,
                registeredAt: new Date().toISOString(),
                games: {
                    'happy-birds': { unlocked: true, progress: {} }
                },
                platformStats: {
                    achievements: []
                }
            });
            
            // Обновляем текущего пользователя
            this.currentUser = this.loadUserProfile(username);
            
            console.log('🔄 User data reset');
            return true;
        }
        return false;
    }

    // ✅ ДОБАВЛЯЕМ: Экспорт данных пользователя
    exportUserData() {
        if (this.currentUser) {
            const data = {
                user: this.currentUser,
                currencies: window.currencyManager?.getAllCurrencies() || {},
                timestamp: new Date().toISOString()
            };
            
            const dataStr = JSON.stringify(data, null, 2);
            const dataBlob = new Blob([dataStr], { type: 'application/json' });
            
            const url = URL.createObjectURL(dataBlob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `lapia-data-${this.currentUser.username}-${Date.now()}.json`;
            link.click();
            
            URL.revokeObjectURL(url);
            
            console.log('📤 User data exported');
            return true;
        }
        return false;
    }

    // ✅ ДОБАВЛЯЕМ: Получение статистики платформы
    getPlatformStats() {
        return this.currentUser?.platformStats || {};
    }

    // ✅ ДОБАВЛЯЕМ: Получение прогресса игр
    getGameProgress(gameId = null) {
        if (gameId) {
            return this.currentUser?.gamesProgress?.[gameId] || {};
        }
        return this.currentUser?.gamesProgress || {};
    }

    // ✅ ДОБАВЛЯЕМ: Проверка наличия достижения
    hasAchievement(achievementId) {
        return this.currentUser?.platformStats?.achievements?.includes(achievementId) || false;
    }

    // ✅ ДОБАВЛЯЕМ: Получение всех достижений
    getAchievements() {
        return this.currentUser?.platformStats?.achievements || [];
    }

    // ✅ ДОБАВЛЯЕМ: Обновление настроек
    updateSettings(newSettings) {
        if (this.currentUser) {
            if (!this.currentUser.settings) {
                this.currentUser.settings = {};
            }
            
            Object.assign(this.currentUser.settings, newSettings);
            this.saveProgress();
            
            console.log('⚙️ Settings updated');
            return true;
        }
        return false;
    }

    // ✅ ДОБАВЛЯЕМ: Получение настроек
    getSettings() {
        return this.currentUser?.settings || {
            notifications: true,
            music: true,
            sound: true,
            language: 'en'
        };
    }
}



// ✅ Создаем глобальный экземпляр
window.authManager = new AuthManager();