const GAME_KEY_MAP = {
  'happy-birds': 'happyBirds',
  'rich-garden': 'richGarden',
  'golden-mine': 'goldenMine',
  'cat-chess': 'catChess',
  'fishes': 'fishes'
};

const GAME_IDS = Object.keys(GAME_KEY_MAP);
const CONVERSION_COST_PER_GAME = 100;

const ACHIEVEMENT_DEFINITIONS = {
  welcome: { key: 'welcome', name: 'Welcome', reward: 0, type: 'system' },
  firstThousand: { key: 'firstThousand', name: 'First Thousand', reward: 1, type: 'currency', threshold: 1000 },
  firstTenThousand: { key: 'firstTenThousand', name: 'First Ten Thousand', reward: 5, type: 'currency', threshold: 10000 },
  firstHundredThousand: { key: 'firstHundredThousand', name: 'First Hundred Thousand', reward: 10, type: 'currency', threshold: 100000 },
  firstMillion: { key: 'firstMillion', name: 'First Million', reward: 25, type: 'currency', threshold: 1000000 },
  firstLpaPurchase: { key: 'firstLpaPurchase', name: 'First LPA Purchase', reward: 1, type: 'economy' },
  weeklyDedication: { key: 'weeklyDedication', name: 'Weekly Dedication', reward: 5, type: 'activity', streak: 7 },
  monthlyMaster: { key: 'monthlyMaster', name: 'Monthly Master', reward: 100, type: 'activity', streak: 30 },
  yearlyLegend: { key: 'yearlyLegend', name: 'Yearly Legend', reward: 1500, type: 'activity', streak: 365 },
  friendInviter: { key: 'friendInviter', name: 'Friend Inviter', reward: 1, type: 'social', inviteCount: 5 }
};

const CURRENCY_ACHIEVEMENTS = [
  ACHIEVEMENT_DEFINITIONS.firstThousand,
  ACHIEVEMENT_DEFINITIONS.firstTenThousand,
  ACHIEVEMENT_DEFINITIONS.firstHundredThousand,
  ACHIEVEMENT_DEFINITIONS.firstMillion
];

const ACTIVITY_ACHIEVEMENTS = [
  ACHIEVEMENT_DEFINITIONS.weeklyDedication,
  ACHIEVEMENT_DEFINITIONS.monthlyMaster,
  ACHIEVEMENT_DEFINITIONS.yearlyLegend
];

const SOCIAL_REQUIREMENTS = {
  friendInviter: ACHIEVEMENT_DEFINITIONS.friendInviter
};

function startOfDay(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function clampNumber(value) {
  if (typeof value !== 'number' || Number.isNaN(value) || !Number.isFinite(value)) {
    return 0;
  }
  return value;
}

class AchievementManager {
  static prepareUser(user) {
    if (!user) {
      return null;
    }

    if (typeof user.lpaBalance !== 'number' || Number.isNaN(user.lpaBalance)) {
      user.lpaBalance = 0;
    }

    if (!user.currencyByGame) {
      user.currencyByGame = {};
    }

    GAME_IDS.forEach((gameId) => {
      const key = GAME_KEY_MAP[gameId];
      const currentValue = clampNumber(user.currencyByGame[key]);
      user.currencyByGame[key] = currentValue;
    });

    if (typeof user.totalGameCurrency !== 'number' || Number.isNaN(user.totalGameCurrency)) {
      user.totalGameCurrency = 0;
    }

    if (!user.achievementProgress) {
      user.achievementProgress = {};
    }

    Object.keys(ACHIEVEMENT_DEFINITIONS).forEach((achievementKey) => {
      if (typeof user.achievementProgress[achievementKey] !== 'boolean') {
        user.achievementProgress[achievementKey] = false;
      }
    });

    if (!Array.isArray(user.achievementHistory)) {
      user.achievementHistory = [];
    }

    if (!user.activityStreak) {
      user.activityStreak = {
        currentStreak: 0,
        longestStreak: 0,
        lastActivityDate: null
      };
    } else {
      user.activityStreak.currentStreak = clampNumber(user.activityStreak.currentStreak);
      user.activityStreak.longestStreak = clampNumber(user.activityStreak.longestStreak);
    }

    if (!user.friendInvites) {
      user.friendInvites = {
        invitedCount: 0,
        invitedUsers: []
      };
    }
    if (!Array.isArray(user.friendInvites.invitedUsers)) {
      user.friendInvites.invitedUsers = [];
    }
    user.friendInvites.invitedCount = clampNumber(user.friendInvites.invitedCount || user.friendInvites.invitedUsers.length);

    return user;
  }

  static ensureWelcomeAchievement(user) {
    if (!user) return null;
    if (!user.achievementProgress?.welcome) {
      return this.unlockAchievement(user, 'welcome', {}, { skipPrepare: true });
    }
    return null;
  }

  static unlockAchievement(user, key, meta = {}, options = {}) {
    if (!options?.skipPrepare) {
      this.prepareUser(user);
    }
    const definition = ACHIEVEMENT_DEFINITIONS[key];
    if (!definition) {
      return null;
    }
    if (user.achievementProgress[key]) {
      return null;
    }

    user.achievementProgress[key] = true;

    if (typeof definition.reward === 'number' && definition.reward > 0) {
      user.lpaBalance = clampNumber(user.lpaBalance) + definition.reward;
    }

    const unlockedAt = new Date();
    const historyEntry = {
      key,
      reward: definition.reward || 0,
      unlockedAt
    };

    if (meta && typeof meta === 'object' && Object.keys(meta).length > 0) {
      historyEntry.meta = meta;
    }

    user.achievementHistory.push(historyEntry);
    if (user.achievementHistory.length > 100) {
      user.achievementHistory.splice(0, user.achievementHistory.length - 100);
    }

    return {
      key,
      name: definition.name,
      reward: definition.reward || 0,
      unlockedAt,
      lpaBalance: user.lpaBalance,
      type: definition.type || 'general'
    };
  }

  static getGameAccessors(user) {
    return {
      'happy-birds': {
        get: () => clampNumber(user?.coins),
        set: (value) => {
          user.coins = Math.max(0, clampNumber(value));
        }
      },
      'rich-garden': {
        get: () => clampNumber(user?.richGardenProgress?.coins),
        set: (value) => {
          if (!user.richGardenProgress) {
            user.richGardenProgress = { coins: 0 };
          }
          user.richGardenProgress.coins = Math.max(0, clampNumber(value));
        }
      },
      'golden-mine': {
        get: () => clampNumber(user?.goldenMineProgress?.coins),
        set: (value) => {
          if (!user.goldenMineProgress) {
            user.goldenMineProgress = { coins: 0 };
          }
          user.goldenMineProgress.coins = Math.max(0, clampNumber(value));
        }
      },
      'cat-chess': {
        get: () => clampNumber(user?.catChessProgress?.coins),
        set: (value) => {
          if (!user.catChessProgress) {
            user.catChessProgress = { coins: 0 };
          }
          user.catChessProgress.coins = Math.max(0, clampNumber(value));
        }
      },
      fishes: {
        get: () => clampNumber(user?.fishesProgress?.coins),
        set: (value) => {
          if (!user.fishesProgress) {
            user.fishesProgress = { coins: 0 };
          }
          user.fishesProgress.coins = Math.max(0, clampNumber(value));
        }
      }
    };
  }

  static syncAllCurrency(user) {
    this.prepareUser(user);

    const accessors = this.getGameAccessors(user);
    const perGameCurrencyDetails = {};
    GAME_IDS.forEach((gameId) => {
      const key = GAME_KEY_MAP[gameId];
      const amount = clampNumber(accessors[gameId].get());
      user.currencyByGame[key] = amount;
      perGameCurrencyDetails[key] = {
        coins: amount
      };
    });

    user.totalGameCurrency = Object.values(user.currencyByGame).reduce((sum, value) => sum + clampNumber(value), 0);

    const unlocked = this.evaluateCurrencyAchievements(user);

    return {
      currencyByGame: { ...user.currencyByGame },
      totalGameCurrency: user.totalGameCurrency,
      unlockedAchievements: unlocked,
      lpaBalance: user.lpaBalance,
      conversionCapacity: this.getConversionCapacity(user),
      perGameCurrencyDetails
    };
  }

  static evaluateCurrencyAchievements(user) {
    this.prepareUser(user);
    this.ensureWelcomeAchievement(user);

    const maxCurrency = Math.max(
      ...GAME_IDS.map((gameId) => {
        const key = GAME_KEY_MAP[gameId];
        return clampNumber(user.currencyByGame[key]);
      }),
      0
    );

    const unlocked = [];
    CURRENCY_ACHIEVEMENTS.forEach((achievement) => {
      if (!user.achievementProgress[achievement.key] && maxCurrency >= achievement.threshold) {
        const unlockedAchievement = this.unlockAchievement(user, achievement.key, { maxCurrency });
        if (unlockedAchievement) {
          unlocked.push(unlockedAchievement);
        }
      }
    });

    return unlocked;
  }

  static recordActivity(user, activityDate = new Date()) {
    this.prepareUser(user);
    this.ensureWelcomeAchievement(user);
    const streak = user.activityStreak;
    const today = startOfDay(activityDate);
    const lastActivity = streak.lastActivityDate ? startOfDay(streak.lastActivityDate) : null;

    let updated = false;

    if (!lastActivity) {
      streak.currentStreak = 1;
      updated = true;
    } else {
      const diffDays = Math.round((today.getTime() - lastActivity.getTime()) / (24 * 60 * 60 * 1000));
      if (diffDays === 0) {
        // Same day, no update needed
      } else if (diffDays === 1) {
        streak.currentStreak += 1;
        updated = true;
      } else if (diffDays > 1) {
        streak.currentStreak = 1;
        updated = true;
      }
    }

    if (!lastActivity || updated) {
      streak.lastActivityDate = today;
      if (streak.currentStreak > streak.longestStreak) {
        streak.longestStreak = streak.currentStreak;
      }
    }

    const unlocked = this.evaluateActivityAchievements(user);

    return {
      currentStreak: streak.currentStreak,
      longestStreak: streak.longestStreak,
      unlockedAchievements: unlocked
    };
  }

  static evaluateActivityAchievements(user) {
    this.prepareUser(user);
    const unlocked = [];
    const streak = user.activityStreak?.currentStreak || 0;

    ACTIVITY_ACHIEVEMENTS.forEach((achievement) => {
      if (!user.achievementProgress[achievement.key] && streak >= achievement.streak) {
        const unlockedAchievement = this.unlockAchievement(user, achievement.key, { streak });
        if (unlockedAchievement) {
          unlocked.push(unlockedAchievement);
        }
      }
    });

    return unlocked;
  }

  static recordFriendInvite(user, invitedUsername) {
    this.prepareUser(user);
    this.ensureWelcomeAchievement(user);
    const invites = user.friendInvites;

    if (invitedUsername && typeof invitedUsername === 'string') {
      const normalized = invitedUsername.trim().toLowerCase();
      if (normalized && !invites.invitedUsers.includes(normalized)) {
        invites.invitedUsers.push(normalized);
        invites.invitedCount += 1;
      }
    }

    invites.invitedCount = invites.invitedUsers.length;

    const requirement = SOCIAL_REQUIREMENTS.friendInviter;
    const unlocked = [];
    if (requirement && invites.invitedCount >= requirement.inviteCount) {
      const unlockedAchievement = this.unlockAchievement(user, requirement.key, { invitedCount: invites.invitedCount });
      if (unlockedAchievement) {
        unlocked.push(unlockedAchievement);
      }
    }

    return {
      invitedCount: invites.invitedCount,
      unlockedAchievements: unlocked
    };
  }

  static getConversionCapacity(user) {
    this.prepareUser(user);
    this.ensureWelcomeAchievement(user);
    const accessors = this.getGameAccessors(user);
    let capacity = Infinity;

    GAME_IDS.forEach((gameId) => {
      const amount = clampNumber(accessors[gameId].get());
      const available = Math.floor(amount / CONVERSION_COST_PER_GAME);
      if (available < capacity) {
        capacity = available;
      }
    });

    if (!Number.isFinite(capacity) || capacity < 0) {
      return 0;
    }

    return capacity;
  }

  static performConversion(user, requestedCount = 1) {
    this.prepareUser(user);
    this.ensureWelcomeAchievement(user);
    const capacity = this.getConversionCapacity(user);
    const conversions = Math.max(0, Math.min(Math.floor(requestedCount || 1), capacity));

    if (conversions <= 0) {
      return {
        converted: 0,
        lpaBalance: user.lpaBalance,
        currencyByGame: { ...user.currencyByGame },
        totalGameCurrency: user.totalGameCurrency,
        conversionCapacity: capacity,
        unlockedAchievements: []
      };
    }

    const accessors = this.getGameAccessors(user);

    for (let i = 0; i < conversions; i += 1) {
      GAME_IDS.forEach((gameId) => {
        const accessor = accessors[gameId];
        const current = clampNumber(accessor.get());
        accessor.set(current - CONVERSION_COST_PER_GAME);
      });
      user.lpaBalance += 1;
    }

    const syncResult = this.syncAllCurrency(user);

    return {
      converted: conversions,
      lpaBalance: user.lpaBalance,
      currencyByGame: syncResult.currencyByGame,
      totalGameCurrency: syncResult.totalGameCurrency,
      conversionCapacity: this.getConversionCapacity(user),
      unlockedAchievements: syncResult.unlockedAchievements
    };
  }

  static markLpaPurchase(user) {
    this.prepareUser(user);
    this.ensureWelcomeAchievement(user);
    return this.unlockAchievement(user, 'firstLpaPurchase', {}, { skipPrepare: true });
  }

  static getStatus(user) {
    this.prepareUser(user);
    this.ensureWelcomeAchievement(user);
    const syncResult = this.syncAllCurrency(user);
    const unlockedCount = Object.values(user.achievementProgress || {}).filter(Boolean).length;
    const totalAchievements = Object.keys(ACHIEVEMENT_DEFINITIONS).length;

    const progressSnapshots = {};
    Object.entries(syncResult.perGameCurrencyDetails || {}).forEach(([statusKey, details]) => {
      const progressKey = `${statusKey}Progress`;
      progressSnapshots[progressKey] = { ...details };
    });

    return {
      lpaBalance: user.lpaBalance,
      totalGameCurrency: user.totalGameCurrency,
      currencyByGame: syncResult.currencyByGame,
      achievementProgress: { ...user.achievementProgress },
      unlockedCount,
      totalAchievements,
      activityStreak: { ...user.activityStreak },
      friendInvites: {
        invitedCount: user.friendInvites?.invitedCount || 0,
        invitedUsers: [...(user.friendInvites?.invitedUsers || [])]
      },
      achievementHistory: [...(user.achievementHistory || [])].slice(-50),
      conversionCapacity: syncResult.conversionCapacity,
      canConvert: syncResult.conversionCapacity > 0,
      ...progressSnapshots
    };
  }
}

export default AchievementManager;
