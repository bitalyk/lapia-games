const ACHIEVEMENT_CATALOG = [
    { key: 'welcome', name: 'Welcome Aboard', description: 'Log in to Lapia Games for the first time.', reward: 0, type: 'system' },
    { key: 'firstThousand', name: 'First Thousand', description: 'Reach 1,000 coins in any game.', reward: 1, type: 'currency', threshold: 1000 },
    { key: 'firstTenThousand', name: 'Ten Thousand Club', description: 'Stack up 10,000 coins in a single game.', reward: 5, type: 'currency', threshold: 10000 },
    { key: 'firstHundredThousand', name: 'Six Figures', description: 'Earn 100,000 coins in any game.', reward: 10, type: 'currency', threshold: 100000 },
    { key: 'firstMillion', name: 'Millionaire', description: 'Reach 1,000,000 coins in any game.', reward: 25, type: 'currency', threshold: 1000000 },
    { key: 'firstLpaPurchase', name: 'First LPA Purchase', description: 'Spend LPA coins in the platform shop.', reward: 1, type: 'economy' },
    { key: 'weeklyDedication', name: 'Weekly Dedication', description: 'Play on 7 consecutive days.', reward: 5, type: 'activity', streak: 7 },
    { key: 'monthlyMaster', name: 'Monthly Master', description: 'Maintain a 30 day activity streak.', reward: 100, type: 'activity', streak: 30 },
    { key: 'yearlyLegend', name: 'Yearly Legend', description: 'Stay active for 365 days in a row.', reward: 1500, type: 'activity', streak: 365 },
    { key: 'friendInviter', name: 'Friend Inviter', description: 'Invite 5 friends to the platform.', reward: 1, type: 'social', inviteCount: 5 }
];

const ACHIEVEMENT_KEY_SET = new Set(ACHIEVEMENT_CATALOG.map((definition) => definition.key));

const GAME_PROGRESS_CONFIG = [
    { id: 'happy-birds', statusKey: 'happyBirds', label: 'Happy Birds', icon: '🐦' },
    { id: 'rich-garden', statusKey: 'richGarden', label: 'Rich Garden', icon: '🌳' },
    { id: 'golden-mine', statusKey: 'goldenMine', label: 'Golden Mine', icon: '⛏️' },
    { id: 'cat-chess', statusKey: 'catChess', label: 'Cat Chess', icon: '🐱' },
    { id: 'fishes', statusKey: 'fishes', label: 'Fishes', icon: '🐟' }
];

const CONVERSION_REQUIREMENT = 1000;

export class AuthManager {
    constructor() {
        this.currentUser = null;
        this.isLoggedIn = false;
        this.achievementStatus = null;
        this.achievementModal = null;
        this.achievementModalContent = null;
        this.isAchievementModalOpen = false;
        this.onAchievementKeyDown = (event) => this.handleAchievementKey(event);
        this.achievementAutoRefreshTimer = null;
        this.achievementModalRefreshTimer = null;
        this.liveAchievementUpdateInFlight = false;
        this.coinProgress = null;
        this.coinProgressPromise = null;
        const origin = (typeof window !== 'undefined' && window.location?.origin)
            ? window.location.origin.replace(/\/$/, '')
            : 'http://localhost:3000';
        this.API_BASE = `${origin}/api`;
        this.promoWidget = null;
        this.authConfig = {
            mode: 'manual',
            sessionTimeout: 86400,
            tokenRefreshEnabled: true,
            allowMultipleSessions: false
        };
        this.sessionToken = null;
        this.sessionExpiresAt = null;
        this.sessionTokenStorageKey = 'platform_session_token';
        this.fetchInterceptorInstalled = false;
        this.cachedSessionUsername = null;
        this.telegramLoginInFlight = false;
        this.deferAuthModeUi = false;
        this.tokenRefreshTimer = null;
        this.tokenRefreshInFlight = false;
        this.telegramOverlayState = 'idle';
        this.telegramRetryHandlerBound = false;
        this.telegramAccountStorageKey = 'platform_telegram_user_id';
        this.telegramAppUserId = null;
        this.init();
    }

    async init() {
        try {
            await this.loadAuthConfig();
            this.installFetchInterceptor();
            this.restoreSessionToken();
            this.resetSessionIfTelegramAccountChanged();
            await this.checkExistingSession();

            if (!this.isLoggedIn && this.authConfig.mode === 'telegram') {
                await this.tryTelegramAutoLogin();
            }
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

        if (this.authConfig.mode === 'telegram') {
            this.setTelegramOverlayState('success');
        }

        this.coinProgress = null;
        this.coinProgressPromise = null;
        
        // Обновляем UI
        this.updateAuthUI();
        this.revealUI();
        
        // Загружаем валюты пользователя
        this.initializeUserCurrencies(userData.username);
        
        // Загружаем игровое меню
        this.loadGameMenu();

        // Обновляем достижения и LPA баланс
        this.achievementStatus = null;
        this.refreshAchievementStatus({ silent: true }).catch((error) => {
            console.warn('Failed to refresh achievement status', error);
        });
        this.recordDailyActivity({ silent: true }).catch((error) => {
            console.warn('Failed to record daily activity', error);
        });
        this.startAchievementAutoRefresh();
        this.refreshCoinProgress({ silent: true }).catch((error) => {
            console.warn('Failed to refresh coin progress', error);
        });
        
        // Отправляем событие
        window.dispatchEvent(new CustomEvent('platformLogin', {
            detail: { user: userData }
        }));
    }

    // ✅ ДОБАВЛЯЕМ: Метод выхода
    onLogout() {
        console.log('✅ Logout completed');
        if (this.authConfig.mode === 'telegram') {
            this.setTelegramOverlayState('waiting');
        }
        this.updateAuthUI();
        this.revealUI();
        this.stopAchievementAutoRefresh();
        this.stopAchievementModalRefresh();
        this.coinProgress = null;
        this.coinProgressPromise = null;
        
        window.dispatchEvent(new CustomEvent('platformLogout'));
    }

    // ✅ ДОБАВЛЯЕМ: Обновление UI аутентификации
    updateAuthUI() {
        const authContainer = document.getElementById('auth-container');
        const gameMenu = document.getElementById('game-menu');
        const gameArea = document.getElementById('game-area');
        const leaderboardDashboard = document.getElementById('leaderboard-dashboard');

        if (this.isLoggedIn && this.currentUser) {
            // Показываем игровое меню
            if (authContainer) authContainer.style.display = 'none';
            if (gameMenu) gameMenu.style.display = 'block';
            if (gameArea) gameArea.style.display = 'none';
            if (leaderboardDashboard) leaderboardDashboard.style.display = 'block';
        } else {
            // Показываем форму авторизации
            if (authContainer) authContainer.style.display = 'block';
            if (gameMenu) gameMenu.style.display = 'none';
            if (gameArea) gameArea.style.display = 'none';
            if (leaderboardDashboard) leaderboardDashboard.style.display = 'none';
        }

        this.syncTelegramBodyClasses();
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

    mergeServerUserData(serverData = {}) {
        if (!serverData) {
            return;
        }

        if (!this.currentUser) {
            this.currentUser = { username: serverData.username };
        }

        if (serverData.username) {
            this.currentUser.username = serverData.username;
        }

        if (serverData.platformStats) {
            this.currentUser.platformStats = {
                ...(this.currentUser.platformStats || {}),
                ...serverData.platformStats
            };
        }

        if (serverData.platformCurrencies) {
            this.currentUser.platformCurrencies = {
                ...(this.currentUser.platformCurrencies || {}),
                ...serverData.platformCurrencies
            };
        }

        if (serverData.gamesProgress) {
            this.currentUser.gamesProgress = this.mergeProgressMaps(
                serverData.gamesProgress,
                this.currentUser.gamesProgress
            );
        }

        if (typeof serverData.lpaBalance === 'number') {
            this.currentUser.lpaBalance = serverData.lpaBalance;
        }

        if (serverData.achievementProgress) {
            this.currentUser.achievementProgress = {
                ...(this.currentUser.achievementProgress || {}),
                ...serverData.achievementProgress
            };
        }

        if (serverData.currencyByGame) {
            this.currentUser.currencyByGame = {
                ...(this.currentUser.currencyByGame || {}),
                ...serverData.currencyByGame
            };
            this.syncCurrencyManagerBalances(serverData.currencyByGame);
        }

        if (serverData.activityStreak) {
            this.currentUser.activityStreak = {
                ...(this.currentUser.activityStreak || {}),
                ...serverData.activityStreak
            };
        }

        this.cachePlatformProfile(this.currentUser);
    }

    applyAchievementStatusToProfile(status) {
        if (!status || !this.currentUser) {
            return;
        }

        if (typeof status.lpaBalance === 'number') {
            this.currentUser.lpaBalance = status.lpaBalance;
        }
        this.currentUser.achievementProgress = {
            ...(this.currentUser.achievementProgress || {}),
            ...(status.achievementProgress || {})
        };
        this.currentUser.currencyByGame = {
            ...(this.currentUser.currencyByGame || {}),
            ...(status.currencyByGame || {})
        };
        this.currentUser.activityStreak = {
            ...(this.currentUser.activityStreak || {}),
            ...(status.activityStreak || {})
        };
        if (typeof status.totalGameCurrency === 'number') {
            this.currentUser.totalGameCurrency = status.totalGameCurrency;
        }
        if (Array.isArray(status.achievementHistory)) {
            this.currentUser.achievementHistory = [...status.achievementHistory];
        }
        if (status.friendInvites) {
            this.currentUser.friendInvites = {
                ...(this.currentUser.friendInvites || {}),
                ...status.friendInvites
            };
        }

        GAME_PROGRESS_CONFIG.forEach((game) => {
            const progressKey = `${game.statusKey}Progress`;
            if (status[progressKey]) {
                this.currentUser[progressKey] = {
                    ...(this.currentUser[progressKey] || {}),
                    ...status[progressKey]
                };
            }
        });

        this.cachePlatformProfile(this.currentUser);
        this.syncCurrencyManagerBalances(status.currencyByGame);
    }

    dispatchAchievementStatusUpdate() {
        try {
            if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('achievementStatusUpdated', {
                    detail: { status: this.achievementStatus }
                }));
            }
        } catch (error) {
            console.warn('Failed to dispatch achievement update', error);
        }
    }

    dispatchCoinProgressUpdate() {
        try {
            if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('coinProgressUpdated', {
                    detail: { progress: this.coinProgress }
                }));
            }
        } catch (error) {
            console.warn('Failed to dispatch coin progress update', error);
        }
    }

    async refreshCoinProgress(options = {}) {
        if (!this.currentUser?.username) {
            return null;
        }

        if (this.coinProgressPromise && !options.force) {
            return this.coinProgressPromise;
        }

        const username = this.currentUser.username;
        const fetchPromise = (async () => {
            try {
                const response = await fetch(`${this.API_BASE}/achievements/coin-progress/${encodeURIComponent(username)}`);
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }
                const data = await response.json();
                if (!data?.success) {
                    throw new Error(data?.error || 'Failed to load coin progress');
                }
                this.coinProgress = data.progress;
                this.dispatchCoinProgressUpdate();
                return this.coinProgress;
            } catch (error) {
                if (!options.silent) {
                    console.error('Failed to refresh coin progress:', error);
                    window.toastManager?.show?.('Unable to load lifetime progress', 'error');
                }
                throw error;
            } finally {
                this.coinProgressPromise = null;
            }
        })();

        this.coinProgressPromise = fetchPromise;
        return fetchPromise;
    }

    getTodayStamp() {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    getActivityStorageKey(username) {
        if (!username) {
            return null;
        }
        return `platform_activity_${username}`;
    }

    async recordDailyActivity(options = {}) {
        const username = this.currentUser?.username;
        if (!username) {
            return null;
        }

        const storageKey = this.getActivityStorageKey(username);
        const todayStamp = this.getTodayStamp();

        if (!options.force && storageKey) {
            try {
                const lastRecorded = localStorage.getItem(storageKey);
                if (lastRecorded === todayStamp) {
                    await this.refreshAchievementStatus({ silent: true });
                    return null;
                }
            } catch (error) {
                console.warn('Unable to read activity cache:', error);
            }
        }

        try {
            const response = await fetch(`${this.API_BASE}/achievements/record-activity`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username })
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            if (!data.success) {
                throw new Error(data.error || 'Failed to record activity');
            }

            if (storageKey) {
                try {
                    localStorage.setItem(storageKey, todayStamp);
                } catch (error) {
                    console.warn('Unable to persist activity cache:', error);
                }
            }

            this.achievementStatus = data.status;
            this.applyAchievementStatusToProfile(this.achievementStatus);
            this.updateAchievementUI();
            this.saveProgress();
            this.dispatchAchievementStatusUpdate();

            return data.result || { recorded: true };
        } catch (error) {
            if (!options.silent) {
                console.error('Failed to record daily activity:', error);
            }
            return null;
        }
    }

    async runLiveAchievementUpdate() {
        if (this.liveAchievementUpdateInFlight || !this.isLoggedIn) {
            return;
        }

        this.liveAchievementUpdateInFlight = true;
        try {
            const recorded = await this.recordDailyActivity({ silent: true });
            if (!recorded) {
                await this.refreshAchievementStatus({ silent: true });
            }
        } catch (error) {
            console.warn('Live achievement update failed:', error);
        } finally {
            this.liveAchievementUpdateInFlight = false;
        }
    }

    startAchievementAutoRefresh() {
        this.stopAchievementAutoRefresh();
        if (!this.isLoggedIn) {
            return;
        }

        this.runLiveAchievementUpdate().catch(() => {
            /* noop */
        });

        this.achievementAutoRefreshTimer = setInterval(() => {
            this.runLiveAchievementUpdate().catch(() => {
                /* noop */
            });
        }, 60000);
    }

    stopAchievementAutoRefresh() {
        if (this.achievementAutoRefreshTimer) {
            clearInterval(this.achievementAutoRefreshTimer);
            this.achievementAutoRefreshTimer = null;
        }
    }

    startAchievementModalRefresh() {
        this.stopAchievementModalRefresh();
        if (!this.isAchievementModalOpen) {
            return;
        }

        this.achievementModalRefreshTimer = setInterval(() => {
            this.runLiveAchievementUpdate().catch(() => {
                /* noop */
            });
        }, 15000);
    }

    stopAchievementModalRefresh() {
        if (this.achievementModalRefreshTimer) {
            clearInterval(this.achievementModalRefreshTimer);
            this.achievementModalRefreshTimer = null;
        }
    }

    formatNumber(value) {
        if (typeof value !== 'number' || Number.isNaN(value)) {
            return '0';
        }
        return value.toLocaleString();
    }

    syncCurrencyManagerBalances(currencyByGame = {}) {
        if (!window.currencyManager || !currencyByGame || typeof currencyByGame !== 'object') {
            return;
        }

        const keyMap = {
            happyBirds: { key: 'happy-birds', name: 'Bird Eggs', symbol: '🥚' },
            richGarden: { key: 'rich-garden', name: 'Garden Goods', symbol: '🍎' },
            goldenMine: { key: 'golden-mine', name: 'Mine Gold', symbol: '⛏️' },
            catChess: { key: 'cat-chess', name: 'Chess Tokens', symbol: '♞' },
            fishes: { key: 'fishes', name: 'Aquarium Coins', symbol: '🐟' }
        };

        let updated = false;

        Object.entries(keyMap).forEach(([statusKey, meta]) => {
            const amount = currencyByGame[statusKey];
            if (typeof amount === 'number') {
                const { key, name, symbol } = meta;
                if (!window.currencyManager.currencies[key]) {
                    window.currencyManager.currencies[key] = {
                        name,
                        symbol,
                        balance: 0
                    };
                }
                window.currencyManager.currencies[key].balance = amount;
                updated = true;
            }
        });

        if (updated) {
            window.currencyManager.updateUI();
        }
    }

    async refreshAchievementStatus(options = {}) {
        if (!this.currentUser?.username) {
            return null;
        }

        try {
            const response = await fetch(`${this.API_BASE}/achievements/status/${this.currentUser.username}`);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            if (!data.success) {
                throw new Error(data.error || 'Failed to load achievement status');
            }

            this.achievementStatus = data.status;
            this.applyAchievementStatusToProfile(this.achievementStatus);
            this.updateAchievementUI();
            this.saveProgress();
            this.dispatchAchievementStatusUpdate();
            if (!options.skipCoinProgressSync) {
                this.refreshCoinProgress({ silent: true }).catch((error) => {
                    console.debug('Coin progress sync skipped:', error?.message || error);
                });
            }
            return this.achievementStatus;
        } catch (error) {
            if (!options.silent) {
                console.error('Failed to refresh achievements:', error);
            }
            return null;
        }
    }

    updateAchievementUI() {
        const snapshot = this.getAchievementSnapshot();
        const status = this.achievementStatus;

        const lpaDisplay = document.getElementById('lpa-balance');
        if (lpaDisplay) {
            const balance = typeof snapshot?.lpaBalance === 'number'
                ? snapshot.lpaBalance
                : (status ? status.lpaBalance || 0 : (this.currentUser?.lpaBalance || 0));
            lpaDisplay.textContent = `💎 LPA Coins: ${balance}`;
        }

        const achievementCountEl = document.getElementById('achievement-count');
        if (achievementCountEl) {
            const unlocked = typeof snapshot?.unlockedCount === 'number'
                ? snapshot.unlockedCount
                : Object.values(this.currentUser?.achievementProgress || {}).filter(Boolean).length;
            const total = typeof snapshot?.totalAchievements === 'number'
                ? snapshot.totalAchievements
                : Object.keys(this.currentUser?.achievementProgress || {}).length;
            achievementCountEl.textContent = `🏆 Achievements: ${unlocked}/${total || 0}`;
        }

        const streakEl = document.getElementById('activity-streak');
        if (streakEl) {
            const rawStreak = snapshot?.streak?.currentStreak || 0;
            const normalizedStreak = this.isLoggedIn ? Math.max(1, rawStreak) : rawStreak;
            streakEl.textContent = `🔥 Streak: ${normalizedStreak} ${normalizedStreak === 1 ? 'day' : 'days'}`;
        }

        if (this.isAchievementModalOpen) {
            this.renderAchievementModal();
        }
    }

    async convertCoinsToLpa(count = 1, options = {}) {
        if (!this.currentUser?.username) {
            return;
        }

        const normalizedCount = Math.max(0, Math.floor(Number(count) || 0));
        if (normalizedCount <= 0) {
            if (window.showToast) {
                window.showToast('Choose at least one conversion.', 'info');
            }
            return null;
        }

        try {
            const response = await fetch(`${this.API_BASE}/achievements/convert`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: this.currentUser.username, count: normalizedCount })
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            if (!data.success) {
                throw new Error(data.error || 'Conversion failed');
            }

            this.achievementStatus = data.status;
            this.applyAchievementStatusToProfile(this.achievementStatus);
            this.updateAchievementUI();
            this.saveProgress();
            this.dispatchAchievementStatusUpdate();

            if (window.showToast) {
                if (data.conversion?.converted > 0) {
                    window.showToast(`💎 Converted ${data.conversion.converted} LPA!`, 'success');
                } else {
                    window.showToast('Conversion not available yet.', 'info');
                }
            }

            return data;
        } catch (error) {
            console.error('Conversion error:', error);
            if (window.showToast) {
                window.showToast('Conversion failed. Please try again later.', 'error');
            }
            return null;
        }
    }

    getAchievementSnapshot() {
        const profile = this.currentUser || {};
        const status = this.achievementStatus || null;
        const baseProgress = (status && status.achievementProgress) || profile.achievementProgress || {};
        const currency = { ...((status && status.currencyByGame) || profile.currencyByGame || {}) };
        const streak = (status && status.activityStreak) || profile.activityStreak || {};
        const friendInvites = (status && status.friendInvites) || profile.friendInvites || {};
        const historyKeys = new Set((status?.achievementHistory || []).map((entry) => entry?.key).filter(Boolean));
        const progress = {};
        ACHIEVEMENT_KEY_SET.forEach((key) => {
            progress[key] = Boolean(baseProgress[key]);
        });
        historyKeys.forEach((key) => {
            if (ACHIEVEMENT_KEY_SET.has(key)) {
                progress[key] = true;
            }
        });
        const totalAchievements = ACHIEVEMENT_KEY_SET.size;
        const unlockedCount = ACHIEVEMENT_CATALOG.reduce((count, definition) => (
            progress[definition.key] ? count + 1 : count
        ), 0);
        const lpaBalance = typeof status?.lpaBalance === 'number' ? status.lpaBalance : (profile.lpaBalance || 0);
        const conversionCapacity = typeof status?.conversionCapacity === 'number' ? status.conversionCapacity : 0;
        const rawStreak = Number(streak?.currentStreak) || 0;
        const normalizedStreak = this.isLoggedIn ? Math.max(1, rawStreak) : rawStreak;
        const normalizedStreakData = {
            ...streak,
            currentStreak: normalizedStreak
        };
        const currencyValues = GAME_PROGRESS_CONFIG.map((game) => {
            const statusKey = game.statusKey;
            const progressKey = `${statusKey}Progress`;
            const baseAmount = Number(currency[statusKey] || 0);
            const statusProgress = Number(status?.[progressKey]?.coins || 0);
            const userProgress = Number(this.currentUser?.[progressKey]?.coins || profile?.[progressKey]?.coins || 0);
            const bestValue = Math.max(0, baseAmount, statusProgress, userProgress);
            if (bestValue > baseAmount) {
                currency[statusKey] = bestValue;
            }
            return bestValue;
        });
        const achievedCurrencyThresholds = ACHIEVEMENT_CATALOG
            .filter((definition) => definition.type === 'currency' && typeof definition.threshold === 'number')
            .map((definition) => (progress[definition.key] ? definition.threshold : 0));
        const currencyHighScore = Math.max(0, ...currencyValues, ...achievedCurrencyThresholds);
        const lifetimeCoins = Math.max(0, typeof this.coinProgress?.totalCoins === 'number'
            ? this.coinProgress.totalCoins
            : currencyHighScore);

        return {
            status,
            progress,
            currency,
            streak: normalizedStreakData,
            friendInvites,
            totalAchievements,
            unlockedCount,
            lpaBalance,
            conversionCapacity,
            currencyHighScore: lifetimeCoins,
            coinProgress: this.coinProgress
        };
    }

    ensureAchievementModal() {
        if (this.achievementModal && this.achievementModalContent) {
            return this.achievementModal;
        }

        const overlay = document.createElement('div');
        overlay.id = 'achievement-overlay';
        overlay.className = 'achievement-overlay hidden';
        overlay.innerHTML = `
            <div class="achievement-modal" role="dialog" aria-modal="true" aria-labelledby="achievement-modal-title">
                <div class="achievement-modal__header">
                    <h2 id="achievement-modal-title">🏆 Achievements</h2>
                    <button type="button" class="achievement-modal__close" aria-label="Close achievements">×</button>
                </div>
                <div class="achievement-modal__body">
                    <div class="achievement-modal-content">
                        <div class="achievement-loading">Loading achievement data...</div>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);
        this.achievementModal = overlay;
        this.achievementModalContent = overlay.querySelector('.achievement-modal-content');

        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) {
                this.closeAchievements();
            }
        });

        const closeBtn = overlay.querySelector('.achievement-modal__close');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.closeAchievements());
        }

        return overlay;
    }

    getAchievementProgressHint(definition, snapshot) {
        if (!definition || !snapshot) {
            return '';
        }

        if (snapshot.progress?.[definition.key]) {
            return 'Completed';
        }

        if (definition.type === 'currency' && definition.threshold) {
            const lifetimeCoins = Math.max(0, snapshot.currencyHighScore || 0);
            const displayValue = Math.min(lifetimeCoins, definition.threshold);
            const remaining = Math.max(0, definition.threshold - lifetimeCoins);
            const remainingLabel = remaining > 0 ? ` · ${this.formatNumber(remaining)} coins to go` : '';
            return `Lifetime coins: ${this.formatNumber(displayValue)} / ${this.formatNumber(definition.threshold)}${remainingLabel}`;
        }

        if (definition.type === 'activity' && definition.streak) {
            const currentStreak = snapshot.streak?.currentStreak || 0;
            return `Current streak: ${currentStreak} / ${definition.streak} days`;
        }

        if (definition.type === 'social' && definition.inviteCount) {
            const count = snapshot.friendInvites?.invitedCount || 0;
            return `Invites sent: ${count} / ${definition.inviteCount}`;
        }

        if (definition.key === 'firstLpaPurchase') {
            return 'Make any purchase using LPA coins.';
        }

        if (definition.key === 'welcome') {
            return 'Log in to unlock this achievement.';
        }

        return '';
    }

    getAchievementProgressMetrics(definition, snapshot) {
        const unlocked = !!snapshot?.progress?.[definition.key];
        if (unlocked) {
            return { percent: 100, label: 'Completed' };
        }

        if (!definition || !snapshot) {
            return { percent: 0, label: 'Progress unavailable' };
        }

        const clampPercent = (value) => Math.max(0, Math.min(100, Math.round(value)));

        if (definition.type === 'currency' && definition.threshold) {
            const milestone = snapshot.coinProgress?.milestones?.find((item) => item.key === definition.key);
            const totalCoins = Math.max(0, snapshot.currencyHighScore || 0);
            const current = Math.max(0, Math.min(definition.threshold, totalCoins));
            const computedPercent = definition.threshold > 0 ? clampPercent((current / definition.threshold) * 100) : 0;
            const percent = typeof milestone?.percentComplete === 'number'
                ? clampPercent(milestone.percentComplete)
                : computedPercent;
            const remainingLabel = milestone && milestone.remaining > 0
                ? ` · ${this.formatNumber(milestone.remaining)} to go`
                : '';
            return {
                percent,
                label: `${this.formatNumber(current)} / ${this.formatNumber(definition.threshold)} coins${remainingLabel}`
            };
        }

        if (definition.type === 'activity' && definition.streak) {
            const current = Math.max(0, snapshot.streak?.currentStreak || 0);
            const percent = definition.streak > 0 ? clampPercent((current / definition.streak) * 100) : 0;
            return {
                percent,
                label: `${current} / ${definition.streak} days`
            };
        }

        if (definition.type === 'social' && definition.inviteCount) {
            const current = Math.max(0, snapshot.friendInvites?.invitedCount || 0);
            const percent = definition.inviteCount > 0 ? clampPercent((current / definition.inviteCount) * 100) : 0;
            return {
                percent,
                label: `${current} / ${definition.inviteCount} invites`
            };
        }

        if (definition.key === 'firstLpaPurchase') {
            return { percent: 0, label: 'Spend LPA coins in the shop.' };
        }

        if (definition.key === 'welcome') {
            return { percent: 0, label: 'Log in once to unlock.' };
        }

        return { percent: 0, label: 'Try playing more to discover progress.' };
    }

    renderAchievementModal() {
        if (!this.achievementModalContent) {
            return;
        }

        const snapshot = this.getAchievementSnapshot();

        if (!snapshot.status) {
            this.achievementModalContent.innerHTML = '<div class="achievement-loading">Loading achievement data...</div>';
            return;
        }

        const achievementCards = ACHIEVEMENT_CATALOG.map((definition) => {
            const unlocked = !!snapshot.progress?.[definition.key];
            const rewardLabel = typeof definition.reward === 'number' && definition.reward > 0
                ? `+${this.formatNumber(definition.reward)} LPA`
                : 'No LPA reward';
            const hint = this.getAchievementProgressHint(definition, snapshot);
            const progressInfo = this.getAchievementProgressMetrics(definition, snapshot);
            return `
                <div class="achievement-card ${unlocked ? 'achievement-card--unlocked' : 'achievement-card--locked'}">
                    <div class="achievement-card__header">
                        <h4>${definition.name}</h4>
                        <span class="achievement-card__reward">${rewardLabel}</span>
                    </div>
                    <p class="achievement-card__description">${definition.description}</p>
                    ${hint ? `<p class="achievement-card__hint">${hint}</p>` : ''}
                    <div class="achievement-card__progress">
                        <div class="achievement-progress-bar">
                            <div class="achievement-progress-fill" style="width: ${progressInfo.percent}%;"></div>
                        </div>
                        <div class="achievement-progress-label">${progressInfo.label}</div>
                    </div>
                    <div class="achievement-card__status">${unlocked ? 'Unlocked' : 'Locked'}</div>
                </div>
            `;
        }).join('');

        const lifetimeCoinsValue = this.formatNumber(Math.max(0, snapshot.coinProgress?.totalCoins || snapshot.currencyHighScore || 0));
        const nextMilestone = snapshot.coinProgress?.nextMilestone;
        const nextMilestoneCopy = nextMilestone
            ? `Next at ${this.formatNumber(nextMilestone.threshold)} (${this.formatNumber(nextMilestone.remaining)} left)`
            : 'All milestones unlocked';

        this.achievementModalContent.innerHTML = `
            <div class="achievements-summary">
                <div class="achievements-summary-card">
                    <span class="achievements-summary-label">Lifetime Coins</span>
                    <span class="achievements-summary-value">💰 ${lifetimeCoinsValue}</span>
                    <span class="achievements-summary-subtitle">${nextMilestoneCopy}</span>
                </div>
                <div class="achievements-summary-card">
                    <span class="achievements-summary-label">LPA Balance</span>
                    <span class="achievements-summary-value">💎 ${this.formatNumber(snapshot.lpaBalance)}</span>
                </div>
                <div class="achievements-summary-card">
                    <span class="achievements-summary-label">Achievements</span>
                    <span class="achievements-summary-value">🏆 ${snapshot.unlockedCount}/${snapshot.totalAchievements}</span>
                </div>
                <div class="achievements-summary-card">
                    <span class="achievements-summary-label">Daily Streak</span>
                    <span class="achievements-summary-value">🔥 ${snapshot.streak?.currentStreak || 0} days</span>
                </div>
                <div class="achievements-summary-card">
                    <span class="achievements-summary-label">Conversions Ready</span>
                    <span class="achievements-summary-value">🔄 ${this.formatNumber(snapshot.conversionCapacity)}</span>
                </div>
            </div>
            <section class="achievements-section">
                <h3>Achievement List</h3>
                <div class="achievements-grid">
                    ${achievementCards}
                </div>
            </section>
        `;
    }

    async openAchievements() {
        console.log('🏆 Opening achievements...');
        this.ensureAchievementModal();
        this.isAchievementModalOpen = true;
        this.startAchievementModalRefresh();

        if (this.achievementModal) {
            this.achievementModal.classList.remove('hidden');
        }

        document.body.classList.add('modal-open');
        window.addEventListener('keydown', this.onAchievementKeyDown);

        this.renderAchievementModal();
        const coinProgressPromise = this.refreshCoinProgress({ silent: true }).catch(() => null);
        await Promise.all([
            this.runLiveAchievementUpdate().catch(() => null),
            coinProgressPromise
        ]);
        if (!this.achievementStatus && window.showToast) {
            window.showToast('Unable to load achievements right now.', 'error');
        }
        this.renderAchievementModal();
    }

    closeAchievements() {
        if (!this.achievementModal) {
            return;
        }

        this.isAchievementModalOpen = false;
        this.stopAchievementModalRefresh();
        this.achievementModal.classList.add('hidden');
        const conversionOverlay = document.querySelector('.conversion-overlay');
        const conversionOpen = conversionOverlay && !conversionOverlay.classList.contains('hidden');
        if (!conversionOpen) {
            document.body.classList.remove('modal-open');
        }
        window.removeEventListener('keydown', this.onAchievementKeyDown);
    }

    handleAchievementKey(event) {
        if (event.key === 'Escape' && this.isAchievementModalOpen) {
            this.closeAchievements();
        }
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
            'rich-garden': { name: 'Garden Goods', symbol: '🍎', balance: 0 },
            'golden-mine': { name: 'Mine Gold', symbol: '⛏️', balance: 0 },
            'cat-chess': { name: 'Chess Tokens', symbol: '♞', balance: 0 },
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
                'rich-garden': { name: 'Garden Goods', symbol: '🍎', balance: 0 },
                'golden-mine': { name: 'Mine Gold', symbol: '⛏️', balance: 0 },
                'cat-chess': { name: 'Chess Tokens', symbol: '♞', balance: 0 },
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
        this.cachedSessionUsername = userProfile.username;
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
        window.refreshAchievements = (options) => this.refreshAchievementStatus(options || {});
    }

    attachTelegramRetryHandler() {
        if (this.telegramRetryHandlerBound) {
            return;
        }
        const retryBtn = document.getElementById('telegram-retry-btn');
        if (!retryBtn) {
            return;
        }
        retryBtn.addEventListener('click', (event) => {
            event.preventDefault();
            this.setTelegramOverlayState('connecting', { disableRetry: true });
            this.tryTelegramAutoLogin({ reason: 'manual-retry' });
        });
        this.telegramRetryHandlerBound = true;
    }

    syncTelegramBodyClasses() {
        if (typeof document === 'undefined') {
            return;
        }
        const body = document.body;
        if (!body) {
            return;
        }
        const telegramActive = this.authConfig.mode === 'telegram';
        body.classList.toggle('telegram-auth-mode', telegramActive);
        const waiting = telegramActive && !this.isLoggedIn;
        body.classList.toggle('telegram-auth-wait', waiting);
    }

    toggleTelegramViews(manualEnabled) {
        const loginContainer = document.getElementById('login-container');
        const overlay = document.getElementById('telegram-auth-overlay');

        if (!loginContainer || !overlay) {
            return;
        }

        if (manualEnabled) {
            overlay.hidden = true;
            overlay.setAttribute('aria-hidden', 'true');
            loginContainer.hidden = false;
        } else {
            this.attachTelegramRetryHandler();
            loginContainer.hidden = true;
            overlay.hidden = false;
            overlay.setAttribute('aria-hidden', 'false');
            if (this.telegramOverlayState === 'idle') {
                this.setTelegramOverlayState('waiting');
            } else {
                this.setTelegramOverlayState(this.telegramOverlayState);
            }
        }
    }

    setTelegramOverlayState(state, options = {}) {
        this.telegramOverlayState = state;
        const overlay = document.getElementById('telegram-auth-overlay');
        const titleEl = document.getElementById('telegram-status-title');
        const messageEl = document.getElementById('telegram-status-message');
        const retryBtn = document.getElementById('telegram-retry-btn');

        if (!overlay || !titleEl || !messageEl || !retryBtn) {
            return;
        }

        const presets = {
            waiting: {
                title: 'Waiting for Telegram…',
                message: 'Open the bot inside Telegram to continue.',
                showRetry: false
            },
            connecting: {
                title: 'Connecting to Telegram…',
                message: 'Please wait while we verify your session.',
                showRetry: false
            },
            error: {
                title: 'Unable to authenticate',
                message: 'Tap Retry or reopen the bot from Telegram.',
                showRetry: true
            },
            success: {
                title: 'Authenticated',
                message: 'Loading your account…',
                showRetry: false
            }
        };

        const preset = presets[state] || {};
        const title = options.title ?? preset.title ?? 'Telegram Login';
        const message = options.message ?? preset.message ?? '';
        const showRetry = options.showRetry ?? preset.showRetry ?? false;
        const disableRetry = options.disableRetry ?? false;

        titleEl.textContent = title;
        messageEl.textContent = message;
        retryBtn.style.display = showRetry ? 'block' : 'none';
        retryBtn.disabled = disableRetry;

        overlay.hidden = false;
        overlay.setAttribute('aria-hidden', 'false');
    }

    async loadAuthConfig() {
        try {
            const response = await fetch('/api/config');
            if (response?.ok) {
                const data = await response.json();
                if (data?.auth) {
                    this.authConfig = {
                        ...this.authConfig,
                        ...data.auth
                    };
                }
            }
        } catch (error) {
            console.warn('Failed to load auth config:', error);
        } finally {
            this.applyAuthModeUI();
        }
    }

    installFetchInterceptor() {
        if (this.fetchInterceptorInstalled || typeof window === 'undefined' || typeof window.fetch !== 'function') {
            return;
        }

        const manager = this;
        const nativeFetch = window.fetch.bind(window);

        window.fetch = function interceptedFetch(input, init) {
            if (manager.shouldAttachAuthHeader(input)) {
                if (input instanceof Request) {
                    const headers = manager.cloneHeaders(input.headers);
                    if (!headers.has('Authorization')) {
                        headers.set('Authorization', `Bearer ${manager.sessionToken}`);
                    }
                    const patchedRequest = new Request(input, { headers });
                    return nativeFetch(patchedRequest);
                }

                const finalInit = { ...(init || {}) };
                const headers = manager.cloneHeaders(finalInit.headers);
                if (!headers.has('Authorization')) {
                    headers.set('Authorization', `Bearer ${manager.sessionToken}`);
                }
                finalInit.headers = headers;
                return nativeFetch(input, finalInit);
            }

            return nativeFetch(input, init);
        };

        this.fetchInterceptorInstalled = true;
    }

    applyAuthModeUI() {
        if (typeof document === 'undefined') {
            return;
        }

        if (document.readyState === 'loading') {
            if (this.deferAuthModeUi) {
                return;
            }
            this.deferAuthModeUi = true;
            document.addEventListener('DOMContentLoaded', () => {
                this.deferAuthModeUi = false;
                this.applyAuthModeUI();
            }, { once: true });
            return;
        }

        const manualEnabled = this.authConfig.mode !== 'telegram';
        const usernameInput = document.getElementById('username');
        const passwordInput = document.getElementById('password');
        const registerBtn = document.getElementById('registerBtn');
        const loginBtn = document.getElementById('loginBtn');
        const authMsg = document.getElementById('authMsg');

        this.syncTelegramBodyClasses();
        this.toggleTelegramViews(manualEnabled);

        [usernameInput, passwordInput].forEach((input) => {
            if (input) {
                input.disabled = !manualEnabled;
            }
        });

        [registerBtn, loginBtn].forEach((btn) => {
            if (btn) {
                btn.disabled = !manualEnabled;
                btn.dataset.authMode = manualEnabled ? 'manual' : 'telegram-disabled';
            }
        });

        if (!manualEnabled && authMsg) {
            authMsg.textContent = 'Use the Telegram WebApp to log in. Manual credentials are disabled.';
            authMsg.dataset.status = 'telegram-only';
        } else if (manualEnabled && authMsg && authMsg.dataset.status === 'telegram-only') {
            authMsg.textContent = '';
            delete authMsg.dataset.status;
        }
    }

    shouldAttachAuthHeader(request) {
        if (!this.sessionToken) {
            return false;
        }

        let url = null;
        if (request instanceof Request) {
            url = request.url;
        } else if (typeof request === 'string') {
            url = request;
        }

        if (!url) {
            return false;
        }

        if (url.startsWith(this.API_BASE)) {
            return true;
        }

        const normalized = this.buildAbsoluteUrl(url);
        return normalized.startsWith(this.API_BASE);
    }

    buildAbsoluteUrl(url) {
        if (!url || typeof url !== 'string') {
            return '';
        }

        if (url.startsWith('http://') || url.startsWith('https://')) {
            return url;
        }

        if (url.startsWith('/')) {
            return `${window.location.origin}${url}`;
        }

        return `${window.location.origin}/${url.replace(/^\.\/?/, '')}`;
    }

    cloneHeaders(source) {
        if (source instanceof Headers) {
            return new Headers(source);
        }

        if (Array.isArray(source)) {
            return new Headers(source);
        }

        return new Headers(source || {});
    }

    restoreSessionToken() {
        try {
            const raw = localStorage.getItem(this.sessionTokenStorageKey);
            if (!raw) {
                return;
            }

            const data = JSON.parse(raw);
            if (!data?.token) {
                this.clearSessionToken();
                return;
            }

            if (data.expiresAt && new Date(data.expiresAt) <= new Date()) {
                this.clearSessionToken();
                return;
            }

            this.sessionToken = data.token;
            this.sessionExpiresAt = data.expiresAt ? new Date(data.expiresAt) : null;
            this.cachedSessionUsername = data.username || null;
            this.scheduleTokenRefresh();
        } catch (error) {
            console.warn('Failed to restore session token:', error);
            this.clearSessionToken();
        }
    }

    persistSessionToken(token, expiresAt, username) {
        if (!token) {
            localStorage.removeItem(this.sessionTokenStorageKey);
            this.sessionToken = null;
            this.sessionExpiresAt = null;
            return;
        }

        const normalizedExpiresAt = expiresAt ? new Date(expiresAt).toISOString() : null;
        const payload = {
            token,
            expiresAt: normalizedExpiresAt,
            username: username || this.currentUser?.username || this.cachedSessionUsername || null
        };

        localStorage.setItem(this.sessionTokenStorageKey, JSON.stringify(payload));
        this.sessionToken = token;
        this.sessionExpiresAt = normalizedExpiresAt ? new Date(normalizedExpiresAt) : null;
        this.cachedSessionUsername = payload.username;
    }

    setSessionToken(token, expiresAt, username) {
        if (!token) {
            this.clearSessionToken();
            return;
        }

        this.persistSessionToken(token, expiresAt, username);
        this.scheduleTokenRefresh();
    }

    clearSessionToken() {
        localStorage.removeItem(this.sessionTokenStorageKey);
        this.sessionToken = null;
        this.sessionExpiresAt = null;
        this.cachedSessionUsername = null;
        this.clearTokenRefreshTimer();
    }

    clearTokenRefreshTimer() {
        if (this.tokenRefreshTimer) {
            clearTimeout(this.tokenRefreshTimer);
            this.tokenRefreshTimer = null;
        }
    }

    getStoredTelegramAccountId() {
        try {
            return localStorage.getItem(this.telegramAccountStorageKey) || null;
        } catch (error) {
            console.warn('Unable to read cached Telegram account id:', error);
            return null;
        }
    }

    persistTelegramAccountId(telegramId) {
        try {
            if (telegramId) {
                localStorage.setItem(this.telegramAccountStorageKey, String(telegramId));
            } else {
                localStorage.removeItem(this.telegramAccountStorageKey);
            }
        } catch (error) {
            console.warn('Unable to persist Telegram account id:', error);
        }
    }

    getTelegramWebAppUserId() {
        try {
            if (typeof window === 'undefined') {
                return null;
            }

            const telegram = window.Telegram?.WebApp;
            if (!telegram) {
                return null;
            }

            const unsafeId = telegram.initDataUnsafe?.user?.id;
            if (unsafeId) {
                return String(unsafeId);
            }

            const initData = telegram.initData || '';
            if (!initData) {
                return null;
            }

            const params = new URLSearchParams(initData);
            const rawUser = params.get('user');
            if (!rawUser) {
                return null;
            }

            const parsed = JSON.parse(rawUser);
            return parsed?.id ? String(parsed.id) : null;
        } catch (error) {
            console.warn('Unable to resolve Telegram WebApp user id:', error);
            return null;
        }
    }

    resetSessionState() {
        this.clearSessionToken();
        this.clearTokenRefreshTimer();
        this.currentUser = null;
        this.isLoggedIn = false;
        this.achievementStatus = null;

        try {
            localStorage.removeItem('platform_user');
            localStorage.removeItem('lapia_games_user');
        } catch (error) {
            console.warn('Failed to clear cached session payloads:', error);
        }

        this.persistTelegramAccountId(null);

        try {
            Object.keys(localStorage).forEach((key) => {
                if (key.startsWith('platform_profile_') || key.startsWith('currency_balances_')) {
                    localStorage.removeItem(key);
                }
            });
        } catch (error) {
            console.warn('Failed to clear cached platform data:', error);
        }
    }

    resetSessionIfTelegramAccountChanged() {
        if (this.authConfig.mode !== 'telegram') {
            return;
        }

        const activeTelegramId = this.getTelegramWebAppUserId();
        const storedTelegramId = this.getStoredTelegramAccountId();
        let cachedProfile = null;

        try {
            cachedProfile = localStorage.getItem('platform_user');
        } catch (error) {
            cachedProfile = null;
        }

        const hasCachedSession = Boolean(this.sessionToken || this.cachedSessionUsername || cachedProfile);

        if (activeTelegramId && hasCachedSession) {
            if (!storedTelegramId || storedTelegramId !== activeTelegramId) {
                console.warn('Telegram account switch detected. Clearing cached session.');
                this.resetSessionState();
            }
        }

        if (activeTelegramId) {
            this.telegramAppUserId = activeTelegramId;
        }
    }

    getRefreshWindowMs() {
        const sessionTimeoutSeconds = Number(this.authConfig?.sessionTimeout) || 86400;
        const sessionTimeoutMs = sessionTimeoutSeconds * 1000;
        if (sessionTimeoutMs <= 300000) {
            return Math.max(60000, Math.floor(sessionTimeoutMs / 2));
        }
        return 300000;
    }

    scheduleTokenRefresh() {
        this.clearTokenRefreshTimer();

        if (
            !this.sessionToken ||
            !this.sessionExpiresAt ||
            this.authConfig.mode !== 'telegram' ||
            !this.authConfig.tokenRefreshEnabled
        ) {
            return;
        }

        const refreshWindowMs = this.getRefreshWindowMs();
        const expiresAtMs = new Date(this.sessionExpiresAt).getTime();
        const now = Date.now();
        const triggerAt = expiresAtMs - refreshWindowMs + 5000; // small buffer
        const delay = Math.max(0, triggerAt - now);

        if (delay === 0) {
            this.refreshTokenIfNeeded().catch((error) => {
                console.warn('Token refresh attempt failed:', error);
            });
            return;
        }

        this.tokenRefreshTimer = setTimeout(() => {
            this.refreshTokenIfNeeded().catch((error) => {
                console.warn('Token refresh attempt failed:', error);
            });
        }, delay);
    }

    async refreshTokenIfNeeded(force = false) {
        if (
            !this.sessionToken ||
            !this.sessionExpiresAt ||
            this.authConfig.mode !== 'telegram' ||
            !this.authConfig.tokenRefreshEnabled
        ) {
            return false;
        }

        const remainingMs = new Date(this.sessionExpiresAt).getTime() - Date.now();
        const refreshWindowMs = this.getRefreshWindowMs();

        if (!force && remainingMs > refreshWindowMs) {
            this.scheduleTokenRefresh();
            return false;
        }

        if (this.tokenRefreshInFlight) {
            return false;
        }

        this.tokenRefreshInFlight = true;

        try {
            const refreshUrl = `${this.API_BASE.replace(/\/$/, '')}/auth/refresh`;
            const response = await fetch(refreshUrl, { method: 'POST' });

            if (response.status === 400) {
                // Not yet eligible; try again closer to expiry
                this.scheduleTokenRefresh();
                return false;
            }

            if (response.status === 401) {
                this.clearSessionToken();
                console.warn('Refresh rejected due to invalid token.');
                if (this.authConfig.mode === 'telegram') {
                    this.tryTelegramAutoLogin().catch((error) => {
                        console.warn('Auto-login after refresh failure failed:', error);
                    });
                }
                return false;
            }

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            if (!data?.success || !data.token) {
                throw new Error(data?.error || 'Refresh failed');
            }

            this.setSessionToken(data.token, data.expiresAt, this.currentUser?.username || this.cachedSessionUsername);
            return true;
        } catch (error) {
            console.error('Token refresh error:', error);
            this.scheduleTokenRefresh();
            return false;
        } finally {
            this.tokenRefreshInFlight = false;
        }
    }

    async tryTelegramAutoLogin(options = {}) {
        if (this.telegramLoginInFlight || this.isLoggedIn || this.authConfig.mode !== 'telegram') {
            return false;
        }

        const setOverlayState = (state, extra = {}) => {
            if (this.authConfig.mode === 'telegram') {
                this.setTelegramOverlayState(state, extra);
            }
        };

        const telegram = window?.Telegram?.WebApp;
        if (!telegram) {
            console.warn('Telegram WebApp SDK not detected.');
            setOverlayState('error', {
                message: 'This login works only inside Telegram. Open the bot from Telegram to continue.'
            });
            return false;
        }

        const initData = telegram.initData || '';
        if (!initData) {
            console.warn('Telegram initData payload missing.');
            setOverlayState('error', {
                message: 'Waiting for Telegram session data. Please reopen the bot from Telegram.'
            });
            return false;
        }

        this.telegramLoginInFlight = true;
        setOverlayState('connecting', { disableRetry: true });

        try {
            telegram.ready?.();

            const response = await fetch(`${this.API_BASE}/users/telegram`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ initData })
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            if (!data?.success) {
                throw new Error(data?.error || 'Telegram login failed');
            }

            const username = data.user?.username;
            let profile = null;
            if (username) {
                profile = await this.resolveCurrentUserProfile(username);
            }

            if (!profile && data.user) {
                profile = data.user;
            }

            if (!profile) {
                throw new Error('Unable to resolve Telegram profile');
            }

            setOverlayState('success');
            this.currentUser = profile;
            if (data.user) {
                this.mergeServerUserData(data.user);
            }

            this.isLoggedIn = true;
            this.setSessionToken(data.token, data.expiresAt, profile.username);
            const resolvedTelegramId = this.getTelegramWebAppUserId()
                || (profile?.telegramProfile?.id ? String(profile.telegramProfile.id) : null)
                || (data.user?.telegramProfile?.id ? String(data.user.telegramProfile.id) : null);
            this.persistTelegramAccountId(resolvedTelegramId);
            this.saveSession(profile);
            await this.initializeUserCurrencies(profile.username);
            this.onLoginSuccess(profile);

            return true;
        } catch (error) {
            console.error('Telegram login error:', error);
            setOverlayState('error', {
                message: options.reason === 'manual-retry'
                    ? 'Still unable to verify your Telegram session. Please reopen the bot and try again.'
                    : 'Telegram login failed. Tap Retry or reopen the bot inside Telegram.'
            });
            window.toastManager?.show('Telegram login failed. Please reopen via Telegram.', 'error');
            return false;
        } finally {
            this.telegramLoginInFlight = false;
        }
    }

    // ✅ ОБНОВЛЕННЫЙ: Проверка существующей сессии
    async checkExistingSession() {
        const savedUserRaw = localStorage.getItem('platform_user');
        let userData = null;

        if (savedUserRaw) {
            try {
                userData = JSON.parse(savedUserRaw);
            } catch (error) {
                console.warn('Unable to parse stored platform user:', error);
            }
        }

        if (!userData && this.cachedSessionUsername) {
            userData = { username: this.cachedSessionUsername };
        }

        if (userData) {
            try {
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
        if (this.authConfig.mode === 'telegram') {
            return { success: false, error: 'Manual registration is disabled when Telegram auth is active.' };
        }

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
        if (this.authConfig.mode === 'telegram') {
            return { success: false, error: 'Manual login is disabled when Telegram auth is active.' };
        }

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
                this.mergeServerUserData(data.user);
                this.isLoggedIn = true;

                this.setSessionToken(data.token, data.expiresAt, userProfile.username);

                // Сохраняем сессию
                this.saveSession(this.currentUser);

                // Инициализируем валюты для пользователя
                await this.initializeUserCurrencies(username);

                this.onLoginSuccess(this.currentUser);

                return { success: true, user: this.currentUser };
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
            if (typeof window.shopUI.switchTab === 'function') {
                window.shopUI.switchTab('marketplace');
            }
        } else {
            alert('Shop system is loading... Please wait a moment.');
        }
    }

    openExchange() {
        console.log('💱 Opening exchange...');
        if (window.shopUI) {
            window.shopUI.show();
            if (typeof window.shopUI.switchTab === 'function') {
                window.shopUI.switchTab('exchange');
            }
        } else {
            alert('Exchange system is loading... Please wait a moment.');
        }
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
        this.closeAchievements();
        this.resetSessionState();
        
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
        this.setupPromoCenter();
        this.setupFriendCenter();
        
        console.log('🎮 Game menu initialized');
    }

    setupFriendCenter() {
        if (window.friendCenter && typeof window.friendCenter.attachToMenu === 'function') {
            window.friendCenter.attachToMenu();
        }
    }

    setupPromoCenter() {
        const inputSelector = '#platform-promo-code';
        const buttonSelector = '#platform-promo-redeem-btn';
        const historySelector = '#platform-promo-history-list';
        const hasElements = document.querySelector(inputSelector)
            && document.querySelector(buttonSelector)
            && document.querySelector(historySelector);

        if (!hasElements || typeof window.PromoRedeemWidget !== 'function') {
            return;
        }

        this.promoWidget = new window.PromoRedeemWidget({
            gameId: '',
            inputSelector,
            buttonSelector,
            historySelector,
            historyLimit: 10,
            onResult: (data) => {
                const message = data?.message || 'Promo applied!';
                window.toastManager?.show(message, 'success');
            },
            onError: (message) => {
                window.toastManager?.show(message, 'error');
            }
        });

        this.promoWidget.init();

        const historyModal = document.getElementById('platform-promo-history-modal');
        const historyToggle = document.getElementById('platform-promo-history-btn');
        const historyDialog = historyModal?.querySelector('.promo-history-dialog');
        const closeButtons = historyModal ? Array.from(historyModal.querySelectorAll('[data-action="close-promo-history"]')) : [];

        const removeHistoryKeyHandler = () => {
            if (this.promoHistoryKeyHandler) {
                document.removeEventListener('keydown', this.promoHistoryKeyHandler);
                this.promoHistoryKeyHandler = null;
            }
        };

        const closeHistoryModal = () => {
            if (!historyModal) return;
            historyModal.classList.remove('open');
            historyModal.setAttribute('aria-hidden', 'true');
            document.body.classList.remove('modal-open');
            historyToggle?.setAttribute('aria-expanded', 'false');
            removeHistoryKeyHandler();
            historyToggle?.focus();
        };

        const openHistoryModal = () => {
            if (!historyModal) return;
            historyModal.classList.add('open');
            historyModal.setAttribute('aria-hidden', 'false');
            document.body.classList.add('modal-open');
            historyToggle?.setAttribute('aria-expanded', 'true');
            this.promoWidget?.loadHistory();

            requestAnimationFrame(() => {
                historyDialog?.focus();
            });

            removeHistoryKeyHandler();
            this.promoHistoryKeyHandler = (event) => {
                if (event.key === 'Escape') {
                    closeHistoryModal();
                }
            };
            document.addEventListener('keydown', this.promoHistoryKeyHandler);
        };

        if (historyToggle && historyModal) {
            historyToggle.setAttribute('aria-expanded', 'false');
            historyToggle.addEventListener('click', (event) => {
                event.preventDefault();
                openHistoryModal();
            });

            closeButtons.forEach((btn) => {
                btn.addEventListener('click', (event) => {
                    event.preventDefault();
                    closeHistoryModal();
                });
            });

            historyModal.addEventListener('click', (event) => {
                if (event.target === historyModal) {
                    closeHistoryModal();
                }
            });
        }
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
        const achievementBtns = document.querySelectorAll('.achievements-btn, [onclick*="openAchievements"]');
        achievementBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                this.openAchievements();
            });
        });

        const settingsBtns = document.querySelectorAll('.settings-btn, [onclick*="openSettings"]');
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
            const hbLastPlayed = document.getElementById('hb-last-played');
            const rgLastPlayed = document.getElementById('rg-last-played');
            const gmLastPlayed = document.getElementById('gm-last-played');
            const ccLastPlayed = document.getElementById('cc-last-played');
            const fgLastPlayed = document.getElementById('fg-last-played');
            
            // Обновляем имя пользователя
            if (usernameDisplay && this.currentUser) {
                usernameDisplay.textContent = this.currentUser.username;
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

            this.updateAchievementUI();
            
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