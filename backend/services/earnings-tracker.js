import crypto from "crypto";
import AchievementManager from "./achievement-manager.js";
import LeaderboardService from "./leaderboard-service.js";

const GAME_SLUGS = ["happy-birds", "rich-garden", "golden-mine", "cat-chess", "fishes"];
const TOTAL_KEYS = {
  "happy-birds": "happyBirds",
  "rich-garden": "richGarden",
  "golden-mine": "goldenMine",
  "cat-chess": "catChess",
  fishes: "fishes"
};
const MAX_TRANSACTIONS_STORED = 200;
const COIN_CURRENCY = "game_coin";
const LPA_CURRENCY = "lpa";

function clampNumber(value) {
  if (typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value)) {
    return 0;
  }
  return value;
}

function now() {
  return new Date();
}

class EarningsTracker {
  static ensureTracker(user) {
    if (!user.earningsTracker) {
      user.earningsTracker = {
        totalsByGame: {},
        totalAllCoins: 0,
        totalLpaEarned: 0,
        lastUpdated: now()
      };
    }
    if (!user.earningsTracker.totalsByGame) {
      user.earningsTracker.totalsByGame = {};
    }

    GAME_SLUGS.forEach((slug) => {
      const key = TOTAL_KEYS[slug];
      if (typeof user.earningsTracker.totalsByGame[key] !== "number") {
        user.earningsTracker.totalsByGame[key] = 0;
      }
    });
  }

  static normalizeTransaction(transaction = {}) {
    const { game, type, amount, currency = COIN_CURRENCY, details = {} } = transaction;
    if (!type) {
      throw new Error("Transaction type is required");
    }
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
      throw new Error("Transaction amount must be a positive number");
    }

    const normalizedCurrency = currency === LPA_CURRENCY ? LPA_CURRENCY : COIN_CURRENCY;
    const normalizedGame = GAME_SLUGS.includes(game) ? game : "global";

    return {
      id: crypto.randomUUID(),
      game: normalizedGame,
      type,
      amount: Math.floor(amount),
      currency: normalizedCurrency,
      details,
      createdAt: now()
    };
  }

  static pushTransaction(user, entry) {
    if (!Array.isArray(user.earningsTransactions)) {
      user.earningsTransactions = [];
    }
    user.earningsTransactions.push(entry);
    if (user.earningsTransactions.length > MAX_TRANSACTIONS_STORED) {
      user.earningsTransactions.splice(0, user.earningsTransactions.length - MAX_TRANSACTIONS_STORED);
    }
    user.markModified("earningsTransactions");
  }

  // Updates lifetime totals, keeping camelCase keys aligned with the schema.
  static incrementTotals(user, entry) {
    this.ensureTracker(user);
    if (entry.currency === COIN_CURRENCY && entry.game !== "global") {
      const totalKey = TOTAL_KEYS[entry.game];
      user.earningsTracker.totalsByGame[totalKey] = clampNumber(
        user.earningsTracker.totalsByGame[totalKey]
      ) + entry.amount;
      user.earningsTracker.totalAllCoins = clampNumber(user.earningsTracker.totalAllCoins) + entry.amount;
    }

    if (entry.currency === LPA_CURRENCY && entry.type !== "purchase") {
      user.earningsTracker.totalLpaEarned = clampNumber(user.earningsTracker.totalLpaEarned) + entry.amount;
    }

    user.earningsTracker.lastUpdated = entry.createdAt;
    user.markModified("earningsTracker");
  }

  static getSummary(user) {
    this.ensureTracker(user);
    return {
      totalsByGame: { ...user.earningsTracker.totalsByGame },
      totalAllCoins: clampNumber(user.earningsTracker.totalAllCoins),
      totalLpaEarned: clampNumber(user.earningsTracker.totalLpaEarned),
      lastUpdated: user.earningsTracker.lastUpdated
    };
  }

  static recordTransaction(user, transaction) {
    if (!user) {
      throw new Error("User document is required");
    }
    const entry = this.normalizeTransaction(transaction);
    this.pushTransaction(user, entry);
    this.incrementTotals(user, entry);
    LeaderboardService.invalidateForTransaction(entry);

    const coinAchievements = AchievementManager.checkCoinAchievements(user, {
      totalCoins: user?.earningsTracker?.totalAllCoins
    });

    return {
      transaction: entry,
      earnings: this.getSummary(user),
      unlockedAchievements: coinAchievements.unlockedAchievements,
      totalCoins: coinAchievements.totalCoins
    };
  }
}

export default EarningsTracker;
