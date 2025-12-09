import User from "../models/user.js";

const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_LIMIT = 100;

const GAME_METRIC_FIELDS = {
  happybirds: "earningsTracker.totalsByGame.happyBirds",
  richgarden: "earningsTracker.totalsByGame.richGarden",
  goldenmine: "earningsTracker.totalsByGame.goldenMine",
  catchess: "earningsTracker.totalsByGame.catChess",
  fishes: "earningsTracker.totalsByGame.fishes"
};

const GAME_SLUG_TO_METRIC = {
  "happy-birds": "happybirds",
  "rich-garden": "richgarden",
  "golden-mine": "goldenmine",
  "cat-chess": "catchess",
  fishes: "fishes"
};

const METRIC_CONFIG = {
  "total-coins": {
    field: "earningsTracker.totalAllCoins",
    label: "Total Coins",
    slug: "total-coins"
  },
  lpa: {
    field: "earningsTracker.totalLpaEarned",
    label: "Total LPA",
    slug: "lpa"
  }
};

Object.entries(GAME_METRIC_FIELDS).forEach(([slug, field]) => {
  METRIC_CONFIG[slug] = {
    field,
    label: slug,
    slug,
    isGame: true
  };
});

function clampNumber(value) {
  if (typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value)) {
    return 0;
  }
  return value;
}

class LeaderboardService {
  static cache = new Map();

  static invalidateMetric(metric) {
    if (!metric) {
      return;
    }
    const config = this.getMetricConfig(metric);
    const slug = config ? config.slug : metric.toLowerCase();
    if (!slug) {
      return;
    }
    const prefix = `${slug}:`;
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
  }

  static invalidateMetrics(metrics = []) {
    metrics.forEach((metric) => this.invalidateMetric(metric));
  }

  static invalidateForTransaction(entry) {
    if (!entry) {
      return;
    }

    const affected = new Set();
    if (entry.currency === "game_coin") {
      affected.add("total-coins");
      const gameMetric = GAME_SLUG_TO_METRIC[entry.game];
      if (gameMetric) {
        affected.add(gameMetric);
      }
    }

    if (entry.currency === "lpa") {
      affected.add("lpa");
    }

    if (affected.size === 0) {
      return;
    }

    this.invalidateMetrics([...affected]);
  }

  static getMetricConfig(metric) {
    if (!metric) {
      return null;
    }
    const key = metric.toLowerCase();
    return METRIC_CONFIG[key] || null;
  }

  static normalizePagination({ limit = 10, offset = 0 } = {}) {
    let normalizedLimit = Number.parseInt(limit, 10);
    if (!Number.isFinite(normalizedLimit) || normalizedLimit <= 0) {
      normalizedLimit = 10;
    }
    normalizedLimit = Math.min(normalizedLimit, MAX_LIMIT);

    let normalizedOffset = Number.parseInt(offset, 10);
    if (!Number.isFinite(normalizedOffset) || normalizedOffset < 0) {
      normalizedOffset = 0;
    }

    return { limit: normalizedLimit, offset: normalizedOffset };
  }

  static buildCacheKey(metric, pagination) {
    return `${metric}:${pagination.limit}`;
  }

  static getCached(metric, pagination) {
    const cacheKey = this.buildCacheKey(metric, pagination);
    const entry = this.cache.get(cacheKey);
    if (entry && entry.expiresAt > Date.now()) {
      return entry.payload;
    }
    if (entry) {
      this.cache.delete(cacheKey);
    }
    return null;
  }

  static setCache(metric, pagination, payload) {
    const cacheKey = this.buildCacheKey(metric, pagination);
    this.cache.set(cacheKey, { payload, expiresAt: Date.now() + CACHE_TTL_MS });
  }

  static async getLeaderboard(metric, options = {}) {
    const config = this.getMetricConfig(metric);
    if (!config) {
      const error = new Error("INVALID_METRIC");
      error.code = "INVALID_METRIC";
      throw error;
    }

    const pagination = this.normalizePagination(options);
    const includeUsername = options.username;
    const useCache = pagination.offset === 0;

    let payload = null;
    if (useCache) {
      payload = this.getCached(config.slug, pagination);
    }
    if (!payload) {
      payload = await this.queryLeaderboard(config, pagination);
      if (useCache) {
        this.setCache(config.slug, pagination, payload);
      }
    }

    let userRank = null;
    if (includeUsername) {
      userRank = await this.getUserRank(includeUsername, config.slug);
    }

    return {
      ...payload,
      metric: config.slug,
      userRank
    };
  }

  static buildMatchStage() {
    return { isActive: { $ne: false } };
  }

  static async queryLeaderboard(config, pagination) {
    const matchStage = this.buildMatchStage();
    const fieldExpression = `$${config.field}`;

    const pipeline = [
      { $match: matchStage },
      {
        $project: {
          username: "$username",
          firstName: "$telegramProfile.firstName",
          value: { $ifNull: [fieldExpression, 0] },
          lastUpdated: "$earningsTracker.lastUpdated"
        }
      },
      { $sort: { value: -1, username: 1 } },
      { $skip: pagination.offset },
      { $limit: pagination.limit }
    ];

    const [rawLeaderboard, totalPlayers] = await Promise.all([
      User.aggregate(pipeline).exec(),
      User.countDocuments(matchStage)
    ]);

    const leaderboard = rawLeaderboard.map((entry, index) => ({
      username: entry.username,
      firstName: entry.firstName || null,
      value: clampNumber(entry.value),
      lastUpdated: entry.lastUpdated || null,
      rank: pagination.offset + index + 1
    }));

    return {
      leaderboard,
      totalPlayers,
      generatedAt: new Date()
    };
  }

  static async getUserRank(targetUser, metric) {
    const config = this.getMetricConfig(metric);
    if (!config) {
      const error = new Error("INVALID_METRIC");
      error.code = "INVALID_METRIC";
      throw error;
    }

    const user = await this.resolveUser(targetUser);
    if (!user) {
      return null;
    }

    const value = clampNumber(this.extractFieldValue(user, config.field));
    const match = {
      isActive: { $ne: false },
      [config.field]: { $gt: value }
    };
    const betterCount = await User.countDocuments(match);

    return {
      username: user.username,
      value,
      rank: betterCount + 1
    };
  }

  static extractFieldValue(doc, path) {
    if (!doc || !path) {
      return 0;
    }
    return path.split(".").reduce((current, key) => {
      if (current && typeof current === "object" && key in current) {
        return current[key];
      }
      return 0;
    }, doc) || 0;
  }

  static async resolveUser(target) {
    if (!target) {
      return null;
    }
    if (typeof target === "string") {
      const user = await User.findByUsername(target);
      if (!user || user.isActive === false) {
        return null;
      }
      return user;
    }
    if (target.username && target.isActive !== false) {
      return target;
    }
    return null;
  }

  static buildUserSummary(user) {
    const tracker = user.earningsTracker || {};
    const totalsByGame = tracker.totalsByGame || {};
    return {
      username: user.username,
      totalCoins: clampNumber(tracker.totalAllCoins),
      totalLpa: clampNumber(tracker.totalLpaEarned),
      games: {
        happybirds: clampNumber(totalsByGame.happyBirds),
        richgarden: clampNumber(totalsByGame.richGarden),
        goldenmine: clampNumber(totalsByGame.goldenMine),
        catchess: clampNumber(totalsByGame.catChess),
        fishes: clampNumber(totalsByGame.fishes)
      },
      lastUpdated: tracker.lastUpdated || null
    };
  }

  static async getUserDashboard(username) {
    const user = await this.resolveUser(username);
    if (!user) {
      return null;
    }

    const summary = this.buildUserSummary(user);
    const metricPromises = [
      this.getUserRank(user, "total-coins"),
      this.getUserRank(user, "lpa")
    ];
    const gameSlugs = Object.keys(GAME_METRIC_FIELDS);
    const perGamePromises = gameSlugs.map((slug) => this.getUserRank(user, slug));
    const [totalRank, lpaRank, ...gameRanks] = await Promise.all([
      ...metricPromises,
      ...perGamePromises
    ]);

    const perGame = {};
    gameSlugs.forEach((slug, index) => {
      perGame[slug] = gameRanks[index] || null;
    });

    return {
      summary,
      ranks: {
        totalCoins: totalRank,
        lpa: lpaRank,
        perGame
      }
    };
  }
}

export default LeaderboardService;
