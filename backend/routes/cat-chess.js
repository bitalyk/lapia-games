// backend/routes/cat-chess.js
import express from "express";
import { randomUUID } from "crypto";
import User from "../models/user.js";

const router = express.Router();

// Cat level configuration
const CAT_LEVELS = {};
const TIERS = [
  { levels: [1,10], baseCost: 1000, multiplierIncrement: 0.1, startMultiplier: 1.0 },
  { levels: [11,20], baseCost: 1250, multiplierIncrement: 0.33, startMultiplier: 2.0 },
  { levels: [21,30], baseCost: 2000, multiplierIncrement: 0.55, startMultiplier: 5.0 },
  { levels: [31,40], baseCost: 2500, multiplierIncrement: 1.0, startMultiplier: 10.0 },
  { levels: [41,50], baseCost: 5000, multiplierIncrement: 3.33, startMultiplier: 20.0 },
  { levels: [51,51], baseCost: 0, multiplierIncrement: 0, startMultiplier: 50.0 } // Special
];

TIERS.forEach(tier => {
  for (let level = tier.levels[0]; level <= tier.levels[1]; level++) {
    const multiplier = tier.startMultiplier + (level - tier.levels[0]) * tier.multiplierIncrement;
    CAT_LEVELS[level] = {
      cost: Math.round(tier.baseCost * multiplier),
      multiplier: multiplier,
      sellPrice: Math.round(tier.baseCost * multiplier * 2)
    };
  }
});

const FAST_MODE = process.env.FAST_MODE === 'true';
const GROWTH_TIME_SEC = FAST_MODE ? 30 : 12 * 60 * 60; // 30s testing / 12h normal
const MAX_BUY_LEVEL = FAST_MODE ? 50 : 46;
const SPECIAL_INVENTORY_LIMIT = FAST_MODE ? Infinity : 10;

const BOARD_SIZE = 8;
const MAX_UNLOCK_LEVEL = 51;
const SPECIAL_COIN_VALUE = 1000;

const SPECIAL_CAT_TYPES = {
  horizontal: {
    chance: 0.3,
    baseValue: 1000,
    pattern: [
      { row: 0, col: -1 },
      { row: 0, col: 1 }
    ],
    buff: { common: 0.5, golden: 1.0 },
    label: 'Horizontal'
  },
  vertical: {
    chance: 0.3,
    baseValue: 1000,
    pattern: [
      { row: -1, col: 0 },
      { row: 1, col: 0 }
    ],
    buff: { common: 0.5, golden: 1.0 },
    label: 'Vertical'
  },
  side: {
    chance: 0.15,
    baseValue: 2000,
    pattern: [
      { row: -1, col: 0 },
      { row: 1, col: 0 },
      { row: 0, col: -1 },
      { row: 0, col: 1 }
    ],
    buff: { common: 0.25, golden: 0.5 },
    label: 'Side'
  },
  corner: {
    chance: 0.15,
    baseValue: 2000,
    pattern: [
      { row: -1, col: -1 },
      { row: -1, col: 1 },
      { row: 1, col: -1 },
      { row: 1, col: 1 }
    ],
    buff: { common: 0.25, golden: 0.5 },
    label: 'Corner'
  },
  round: {
    chance: 0.1,
    baseValue: 3000,
    pattern: [
      { row: -1, col: -1 },
      { row: -1, col: 0 },
      { row: -1, col: 1 },
      { row: 0, col: -1 },
      { row: 0, col: 1 },
      { row: 1, col: -1 },
      { row: 1, col: 0 },
      { row: 1, col: 1 }
    ],
    buff: { common: 0.25, golden: 0.5 },
    label: 'Round'
  }
};

const SPECIAL_COLLECTION_MULTIPLIERS = {
  common: 1.5,
  golden: 2.0
};

const CAT_CHESS_REDEEM_CODES = {
  CATCHESSCOINS: {
    type: 'coins',
    amount: 50000,
    message: 'Treasure chest opened: +50,000 coins!'
  },
  TIER1CAT: {
    type: 'cat',
    level: 1,
    tierName: 'Tier 1'
  },
  TIER2CAT: {
    type: 'cat',
    level: 11,
    tierName: 'Tier 2'
  },
  TIER3CAT: {
    type: 'cat',
    level: 21,
    tierName: 'Tier 3'
  },
  TIER4CAT: {
    type: 'cat',
    level: 31,
    tierName: 'Tier 4'
  },
  TIER5CAT: {
    type: 'cat',
    level: 41,
    tierName: 'Tier 5'
  },
  TIER6CAT: {
    type: 'cat',
    level: 51,
    tierName: 'Tier 6'
  },
  SPECIALPURR: {
    type: 'specialCurrency',
    amount: 15,
    message: 'Shiny charms found: +15 special coins!'
  }
};

// Helper functions
function isLegacyRegularCat(cell) {
  return cell && typeof cell.level === 'number' && cell.level > 0 && !cell.kind;
}

function normalizeBoardCell(cell) {
  if (!cell) return null;
  if (cell.kind === 'cat') {
    return {
      kind: 'cat',
      level: cell.level,
      timerStart: cell.timerStart ? new Date(cell.timerStart) : null
    };
  }

  if (cell.kind === 'special') {
    const definition = SPECIAL_CAT_TYPES[cell.type] || null;
    return {
      kind: 'special',
      id: cell.id || randomUUID(),
      type: cell.type,
      form: cell.form || 'common',
      baseValue: definition ? definition.baseValue : 0,
      createdAt: cell.createdAt ? new Date(cell.createdAt).toISOString() : new Date().toISOString()
    };
  }

  if (isLegacyRegularCat(cell)) {
    return {
      kind: 'cat',
      level: cell.level,
      timerStart: cell.timerStart ? new Date(cell.timerStart) : null
    };
  }

  return null;
}

function computeCatGrowth(cat, nowSec) {
  if (!cat || cat.kind !== 'cat') {
    return { grown: false, timeLeft: 0 };
  }

  if (cat.level >= 51) {
    return { grown: true, timeLeft: 0 };
  }

  if (!cat.timerStart) {
    return { grown: false, timeLeft: GROWTH_TIME_SEC };
  }
  const startSec = Math.floor(new Date(cat.timerStart).getTime() / 1000);
  const elapsed = nowSec - startSec;
  if (elapsed >= GROWTH_TIME_SEC) {
    return { grown: true, timeLeft: 0 };
  }
  return { grown: false, timeLeft: GROWTH_TIME_SEC - elapsed };
}

function getBuffMultiplier(type, form = 'common') {
  const definition = SPECIAL_CAT_TYPES[type];
  if (!definition) return 0;
  return form === 'golden' ? definition.buff.golden : definition.buff.common;
}

function getSpecialSaleMultiplier(form = 'common') {
  return form === 'golden' ? 5.0 : 1.0;
}

function rollSpecialCatType() {
  const roll = Math.random();
  let cumulative = 0;
  for (const [type, meta] of Object.entries(SPECIAL_CAT_TYPES)) {
    cumulative += meta.chance;
    if (roll <= cumulative) {
      return type;
    }
  }
  return 'horizontal';
}

function boardIndexToCoords(index) {
  const row = Math.floor(index / BOARD_SIZE);
  const col = index % BOARD_SIZE;
  return { row, col };
}

function coordsToBoardIndex(row, col) {
  if (row < 0 || col < 0 || row >= BOARD_SIZE || col >= BOARD_SIZE) return null;
  return row * BOARD_SIZE + col;
}

function getPatternIndices(type, originIndex) {
  const definition = SPECIAL_CAT_TYPES[type];
  if (!definition) return [];
  const { row, col } = boardIndexToCoords(originIndex);
  return definition.pattern
    .map(offset => coordsToBoardIndex(row + offset.row, col + offset.col))
    .filter(index => index !== null);
}

function hasInventoryCapacity(progress, { add = 0, remove = 0 } = {}) {
  if (!Number.isFinite(SPECIAL_INVENTORY_LIMIT)) return true;
  const resultingLength = progress.specialInventory.length - remove + add;
  return resultingLength <= SPECIAL_INVENTORY_LIMIT;
}

function canPurchaseLevel(level, unlockedLevels) {
  if (!Array.isArray(unlockedLevels)) return false;
  if (level < 1 || level > MAX_BUY_LEVEL) return false;
  if (level === 1) {
    return unlockedLevels.includes(1);
  }

  if (!unlockedLevels.includes(level)) return false;

  const requirementLevel = Math.min(level + 4, MAX_UNLOCK_LEVEL);
  return unlockedLevels.includes(requirementLevel);
}

function unlockLevels(progress, { levels = [], upTo = null } = {}) {
  if (!progress || !Array.isArray(progress.unlockedLevels)) {
    return false;
  }

  const normalized = progress.unlockedLevels
    .map(level => Number(level))
    .filter(level => Number.isInteger(level) && level >= 1 && level <= MAX_UNLOCK_LEVEL);
  const set = new Set(normalized);
  let changed = set.size !== progress.unlockedLevels.length;

  levels.forEach(level => {
    const value = Number(level);
    if (Number.isInteger(value) && value >= 1 && value <= MAX_UNLOCK_LEVEL && !set.has(value)) {
      set.add(value);
      changed = true;
    }
  });

  if (upTo !== null && Number.isFinite(upTo)) {
    const cap = Math.min(Math.max(Math.floor(upTo), 1), MAX_UNLOCK_LEVEL);
    for (let level = 1; level <= cap; level += 1) {
      if (!set.has(level)) {
        set.add(level);
        changed = true;
      }
    }
  }

  if (set.size === 0) {
    set.add(1);
    changed = true;
  }

  if (changed) {
    progress.unlockedLevels = Array.from(set).sort((a, b) => a - b);
  }

  return changed;
}

async function getUser(username) {
  return await User.findByUsername(username);
}

function serializeBoardCell(cell, nowSec) {
  if (!cell) return null;
  if (cell.kind === 'cat' || isLegacyRegularCat(cell)) {
    const normalizedCat = cell.kind === 'cat' ? cell : {
      kind: 'cat',
      level: cell.level,
      timerStart: cell.timerStart ? new Date(cell.timerStart) : null
    };
    const growth = computeCatGrowth(normalizedCat, nowSec);
    return {
      kind: 'cat',
      level: normalizedCat.level,
      timerStart: normalizedCat.timerStart ? new Date(normalizedCat.timerStart).toISOString() : null,
      grown: growth.grown,
      timeLeft: growth.timeLeft
    };
  }

  if (cell.kind === 'special') {
    const definition = SPECIAL_CAT_TYPES[cell.type] || null;
    const buffMultiplier = getBuffMultiplier(cell.type, cell.form);
    return {
      kind: 'special',
      id: cell.id,
      type: cell.type,
      form: cell.form,
      label: definition?.label ?? cell.type,
      buffMultiplier,
      baseValue: cell.baseValue || definition?.baseValue || 0,
      saleMultiplier: getSpecialSaleMultiplier(cell.form),
      createdAt: cell.createdAt
    };
  }

  return null;
}

function serializeSpecialCat(cat) {
  if (!cat) return null;
  return {
    id: cat.id,
    type: cat.type,
    form: cat.form,
    baseValue: cat.baseValue,
    createdAt: cat.createdAt,
    label: SPECIAL_CAT_TYPES[cat.type]?.label ?? cat.type,
    buffMultiplier: getBuffMultiplier(cat.type, cat.form),
    saleMultiplier: getSpecialSaleMultiplier(cat.form)
  };
}

function normalizeSpecialInventoryCat(cat) {
  if (!cat) return null;
  const type = SPECIAL_CAT_TYPES[cat.type] ? cat.type : null;
  if (!type) return null;
  const legacyForm = typeof cat.form === 'string' ? cat.form.toLowerCase() : 'common';
  const form = legacyForm === 'golden' || legacyForm === 'gold' ? 'golden' : 'common';
  const baseValue = SPECIAL_CAT_TYPES[type]?.baseValue ?? 0;
  return {
    id: cat.id || randomUUID(),
    type,
    form,
    baseValue,
    createdAt: cat.createdAt ? new Date(cat.createdAt).toISOString() : new Date().toISOString()
  };
}

function buildProgressPayload(progress, { includeSuccess = false, extra = null } = {}) {
  const nowSec = Math.floor(Date.now() / 1000);
  return {
    ...(includeSuccess ? { success: true } : {}),
    ...(extra && typeof extra === 'object' ? extra : {}),
    coins: progress.coins,
    specialCurrency: progress.specialCurrency,
    board: progress.board.map(cell => serializeBoardCell(cell, nowSec)),
    unlockedLevels: [...progress.unlockedLevels].sort((a, b) => a - b),
    specialInventory: progress.specialInventory.map(cat => serializeSpecialCat(cat)).filter(cat => cat),
    redeemedCodes: [...progress.redeemedCodes],
    sellBonuses: progress.sellBonuses ? { ...progress.sellBonuses } : {},
    inventoryLimit: Number.isFinite(SPECIAL_INVENTORY_LIMIT) ? SPECIAL_INVENTORY_LIMIT : null
  };
}

// Helper function to ensure catChessProgress exists
async function ensureCatChessProgress(user) {
  if (!user.catChessProgress) {
    user.catChessProgress = {
      coins: 1000,
      specialCurrency: 0,
      board: Array(64).fill(null),
      unlockedLevels: [1],
      specialInventory: [],
      redeemedCodes: [],
      lastPlayed: new Date(),
      playTime: 0,
      starterGranted: false,
      sellBonuses: {}
    };
    user.catChessProgress.board[0] = {
      kind: 'cat',
      level: 1,
      timerStart: new Date()
    };
    user.catChessProgress.starterGranted = true;
    await user.save();
  }

  let modified = false;

  if (!Array.isArray(user.catChessProgress.board) || user.catChessProgress.board.length !== 64) {
    user.catChessProgress.board = Array(64).fill(null);
    modified = true;
  }

  const boardSnapshot = JSON.stringify(user.catChessProgress.board);
  const normalizedBoard = user.catChessProgress.board.map(cell => normalizeBoardCell(cell));
  if (JSON.stringify(normalizedBoard) !== boardSnapshot) {
    modified = true;
  }
  user.catChessProgress.board = normalizedBoard;

  if (!Array.isArray(user.catChessProgress.unlockedLevels) || user.catChessProgress.unlockedLevels.length === 0) {
    user.catChessProgress.unlockedLevels = [1];
    modified = true;
  }

  const currentMaxUnlocked = user.catChessProgress.unlockedLevels.length
    ? Math.max(...user.catChessProgress.unlockedLevels)
    : 1;
  if (unlockLevels(user.catChessProgress, { upTo: currentMaxUnlocked })) {
    modified = true;
  }

  if (!Array.isArray(user.catChessProgress.specialInventory)) {
    user.catChessProgress.specialInventory = [];
    modified = true;
  }

  const originalInventoryJSON = JSON.stringify(user.catChessProgress.specialInventory);
  const normalizedInventory = user.catChessProgress.specialInventory
    .map(normalizeSpecialInventoryCat)
    .filter(Boolean);

  let inventoryAdjusted = normalizedInventory;
  if (Number.isFinite(SPECIAL_INVENTORY_LIMIT) && normalizedInventory.length > SPECIAL_INVENTORY_LIMIT) {
    inventoryAdjusted = normalizedInventory.slice(0, SPECIAL_INVENTORY_LIMIT);
  }

  const adjustedInventoryJSON = JSON.stringify(inventoryAdjusted);
  if (
    inventoryAdjusted.length !== user.catChessProgress.specialInventory.length ||
    originalInventoryJSON !== adjustedInventoryJSON
  ) {
    modified = true;
  }

  user.catChessProgress.specialInventory = inventoryAdjusted;

  if (!Array.isArray(user.catChessProgress.redeemedCodes)) {
    user.catChessProgress.redeemedCodes = [];
    modified = true;
  }

  if (typeof user.catChessProgress.sellBonuses !== 'object' || user.catChessProgress.sellBonuses === null) {
    user.catChessProgress.sellBonuses = {};
    modified = true;
  }

  user.catChessProgress.sellBonuses = Object.fromEntries(
    Object.entries(user.catChessProgress.sellBonuses || {})
      .filter(([index, value]) => Number.isInteger(Number(index)) && typeof value === 'number')
  );

  if (typeof user.catChessProgress.starterGranted !== 'boolean') {
    user.catChessProgress.starterGranted = true;
    modified = true;
  }

  const hasAnyCat = user.catChessProgress.board.some(cell => cell && cell.kind === 'cat');
  if (!hasAnyCat && !user.catChessProgress.starterGranted) {
    user.catChessProgress.board[0] = {
      kind: 'cat',
      level: 1,
      timerStart: new Date()
    };
    user.catChessProgress.starterGranted = true;
    modified = true;
  }

  if (modified) {
    user.markModified('catChessProgress.board');
    user.markModified('catChessProgress.unlockedLevels');
    user.markModified('catChessProgress.specialInventory');
    user.markModified('catChessProgress.redeemedCodes');
    user.markModified('catChessProgress.starterGranted');
    user.markModified('catChessProgress.sellBonuses');
    await user.save();
  }

  return user.catChessProgress;
}

// GET /api/cat-chess/status/:username
router.get('/status/:username', async (req, res) => {
  try {
    const { username } = req.params;
    const user = await getUser(username);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const progress = await ensureCatChessProgress(user);
    res.json(buildProgressPayload(progress));
  } catch (error) {
    console.error('Cat Chess status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/cat-chess/buy
router.post('/buy', async (req, res) => {
  try {
    const { username, level, useSpecialFallback = false } = req.body;
    const user = await getUser(username);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const progress = await ensureCatChessProgress(user);
    const purchaseLevel = Number(level);
    if (!Number.isInteger(purchaseLevel) || purchaseLevel < 1) {
      return res.status(400).json({ error: 'Invalid level selected' });
    }

    const highestUnlocked = progress.unlockedLevels.length
      ? Math.max(...progress.unlockedLevels)
      : 1;
    const dynamicCap = Math.min(MAX_BUY_LEVEL, highestUnlocked + 4);

    if (purchaseLevel > dynamicCap) {
      return res.status(400).json({ error: 'Level not unlocked for purchase yet' });
    }

    if (!canPurchaseLevel(purchaseLevel, progress.unlockedLevels)) {
      return res.status(400).json({ error: 'Level not unlocked for purchase yet' });
    }

    const catData = CAT_LEVELS[purchaseLevel];
    if (!catData) {
      return res.status(400).json({ error: 'Unknown cat level' });
    }

    const allowSpecialFallback = Boolean(useSpecialFallback);
    let specialCoinsNeeded = 0;
    let deficitCoins = 0;

    if (progress.coins < catData.cost) {
      deficitCoins = catData.cost - progress.coins;
      specialCoinsNeeded = Math.ceil(deficitCoins / SPECIAL_COIN_VALUE);

      if (progress.specialCurrency < specialCoinsNeeded) {
        return res.status(400).json({ error: 'Not enough coins or special coins' });
      }

      if (!allowSpecialFallback) {
        return res.status(409).json({
          error: 'Not enough coins',
          requiresSpecialFallback: true,
          specialCoinsRequired: specialCoinsNeeded,
          deficitCoins
        });
      }
    }

    // Find empty cell
    const emptyIndex = progress.board.findIndex(cell => cell === null);
    if (emptyIndex === -1) return res.status(400).json({ error: 'No empty cells' });

    let specialCoinsSpent = 0;
    let workingCoins = progress.coins;

    if (specialCoinsNeeded > 0) {
      progress.specialCurrency -= specialCoinsNeeded;
      specialCoinsSpent = specialCoinsNeeded;
      workingCoins += specialCoinsNeeded * SPECIAL_COIN_VALUE;
      progress.coins = workingCoins;
      user.markModified('catChessProgress.specialCurrency');
    }

    workingCoins -= catData.cost;
    progress.coins = workingCoins;
    progress.board[emptyIndex] = {
      kind: 'cat',
      level: purchaseLevel,
      timerStart: purchaseLevel >= 51 ? null : new Date()
    };

    delete progress.sellBonuses[emptyIndex];

    if (unlockLevels(progress, { levels: [purchaseLevel], upTo: purchaseLevel })) {
      user.markModified('catChessProgress.unlockedLevels');
    }

    user.markModified('catChessProgress.board');
    user.markModified('catChessProgress.coins');
    await user.save();
    const extra = specialCoinsSpent > 0 ? { specialCoinsSpent } : null;
    res.json(buildProgressPayload(progress, { includeSuccess: true, extra }));
  } catch (error) {
    console.error('Cat Chess buy error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/cat-chess/sell
router.post('/sell', async (req, res) => {
  try {
    const { username, cellIndex } = req.body;
    const user = await getUser(username);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const progress = await ensureCatChessProgress(user);
    const index = Number(cellIndex);
    if (!Number.isInteger(index) || index < 0 || index >= progress.board.length) {
      return res.status(400).json({ error: 'Invalid cell index' });
    }

    const cat = progress.board[index];
    if (!cat) return res.status(400).json({ error: 'No cat in cell' });

    const normalizedCat =
      cat.kind === 'cat' ? cat : isLegacyRegularCat(cat) ? {
        kind: 'cat',
        level: cat.level,
        timerStart: cat.timerStart ? new Date(cat.timerStart) : null
      } : null;

    if (!normalizedCat) {
      return res.status(400).json({ error: 'No cat in cell' });
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const growth = computeCatGrowth(normalizedCat, nowSec);
    if (!growth.grown) return res.status(400).json({ error: 'Cat not grown yet' });

    const sellPrice = CAT_LEVELS[normalizedCat.level].sellPrice;
    const bonusMultiplier = progress.sellBonuses?.[index] ?? 1;
    const finalSellPrice = Math.round(sellPrice * bonusMultiplier);

    progress.coins += finalSellPrice;
    progress.board[index] = null;
    if (progress.sellBonuses[index]) {
      delete progress.sellBonuses[index];
      user.markModified('catChessProgress.sellBonuses');
    }

    user.markModified('catChessProgress.board');
    user.markModified('catChessProgress.coins');
    await user.save();
    res.json(buildProgressPayload(progress, { includeSuccess: true }));
  } catch (error) {
    console.error('Cat Chess sell error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/cat-chess/sell_all
router.post('/sell_all', async (req, res) => {
  try {
    const { username } = req.body;
    const user = await getUser(username);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const progress = await ensureCatChessProgress(user);
    const nowSec = Math.floor(Date.now() / 1000);

    let totalCoinsEarned = 0;
    let soldCount = 0;
    let notReadyCount = 0;
    let ineligibleCount = 0;
    let sellBonusesChanged = false;
    const soldIndices = [];

    progress.board.forEach((cell, index) => {
      if (!cell) return;
      if (cell.kind === 'special') {
        return;
      }

      const normalizedCat = cell.kind === 'cat' ? cell : isLegacyRegularCat(cell) ? {
        kind: 'cat',
        level: cell.level,
        timerStart: cell.timerStart ? new Date(cell.timerStart) : null
      } : null;

      if (!normalizedCat) return;
      if (normalizedCat.level >= 51) {
        ineligibleCount += 1;
        return;
      }

      const growth = computeCatGrowth(normalizedCat, nowSec);
      if (!growth.grown) {
        notReadyCount += 1;
        return;
      }

      const levelData = CAT_LEVELS[normalizedCat.level];
      if (!levelData) {
        ineligibleCount += 1;
        return;
      }

      const basePrice = levelData.sellPrice;
      const bonusMultiplier = Number(progress.sellBonuses?.[index]) || 1;
      const finalPrice = Math.round(basePrice * bonusMultiplier);

      totalCoinsEarned += finalPrice;
      soldCount += 1;
      soldIndices.push(index);
      progress.board[index] = null;

      if (progress.sellBonuses && progress.sellBonuses[index]) {
        delete progress.sellBonuses[index];
        sellBonusesChanged = true;
      }
    });

    if (soldCount > 0) {
      progress.coins += totalCoinsEarned;
      user.markModified('catChessProgress.coins');
      user.markModified('catChessProgress.board');
    }

    if (sellBonusesChanged) {
      user.markModified('catChessProgress.sellBonuses');
    }

    if (soldCount > 0 || sellBonusesChanged) {
      await user.save();
    }
    res.json({
      ...buildProgressPayload(progress, { includeSuccess: true }),
      soldCount,
      soldIndices,
      coinsEarned: totalCoinsEarned,
      notReadyCount,
      ineligibleCount
    });
  } catch (error) {
    console.error('Cat Chess sell all error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/cat-chess/merge
router.post('/merge', async (req, res) => {
  try {
    const { username, fromIndex, toIndex } = req.body;
    const user = await getUser(username);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const progress = await ensureCatChessProgress(user);

    const from = Number(fromIndex);
    const to = Number(toIndex);

    if (!Number.isInteger(from) || !Number.isInteger(to)) {
      return res.status(400).json({ error: 'Invalid merge indices' });
    }

    if (from < 0 || from >= progress.board.length || to < 0 || to >= progress.board.length) {
      return res.status(400).json({ error: 'Merge out of bounds' });
    }

    if (from === to) {
      return res.status(400).json({ error: 'Cannot merge same cell' });
    }

    const fromCell = progress.board[from];
    const toCell = progress.board[to];

    if (!fromCell || !toCell || fromCell.kind !== 'cat' || toCell.kind !== 'cat') {
      return res.status(400).json({ error: 'Both cells must contain cats' });
    }

    if (fromCell.level !== toCell.level) {
      return res.status(400).json({ error: 'Cats must be same level to merge' });
    }

    if (fromCell.level >= 51) {
      return res.status(400).json({ error: 'Cat already at max level' });
    }

    const nextLevel = Math.min(fromCell.level + 1, 51);
    if (nextLevel >= 51) {
      const type = rollSpecialCatType();
      const definition = SPECIAL_CAT_TYPES[type];
      if (!definition) {
        return res.status(500).json({ error: 'Unable to determine special cat type' });
      }

      progress.board[to] = {
        kind: 'special',
        id: randomUUID(),
        type,
        form: 'common',
        baseValue: definition.baseValue,
        createdAt: new Date().toISOString()
      };
    } else {
      const nowMs = Date.now();
      const nowSec = Math.floor(nowMs / 1000);
      const fromGrowth = computeCatGrowth({ kind: 'cat', level: fromCell.level, timerStart: fromCell.timerStart }, nowSec);
      const toGrowth = computeCatGrowth({ kind: 'cat', level: toCell.level, timerStart: toCell.timerStart }, nowSec);
      const maxTimeLeft = Math.max(fromGrowth.timeLeft, toGrowth.timeLeft);

      let timerStart;
      if (maxTimeLeft <= 0) {
        timerStart = new Date(nowMs - GROWTH_TIME_SEC * 1000);
      } else if (maxTimeLeft >= GROWTH_TIME_SEC) {
        timerStart = new Date(nowMs);
      } else {
        const elapsed = GROWTH_TIME_SEC - maxTimeLeft;
        timerStart = new Date(nowMs - elapsed * 1000);
      }

      progress.board[to] = {
        kind: 'cat',
        level: nextLevel,
        timerStart
      };
    }
    progress.board[from] = null;

    let sellBonusesChanged = false;
    if (progress.sellBonuses[from]) {
      delete progress.sellBonuses[from];
      sellBonusesChanged = true;
    }
    if (progress.sellBonuses[to]) {
      delete progress.sellBonuses[to];
      sellBonusesChanged = true;
    }

    const requirementLevel = Math.min(nextLevel + 4, MAX_UNLOCK_LEVEL);
    const unlockedChanged = unlockLevels(progress, {
      levels: [nextLevel, requirementLevel],
      upTo: Math.max(nextLevel, requirementLevel)
    });
    if (unlockedChanged) {
      user.markModified('catChessProgress.unlockedLevels');
    }

    if (sellBonusesChanged) {
      user.markModified('catChessProgress.sellBonuses');
    }

    user.markModified('catChessProgress.board');
    await user.save();
    res.json(buildProgressPayload(progress, { includeSuccess: true }));
  } catch (error) {
    console.error('Cat Chess merge error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/cat-chess/sell_special
router.post('/sell_special', async (req, res) => {
  try {
    const { username, cellIndex, inventoryIndex } = req.body;
    const user = await getUser(username);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const progress = await ensureCatChessProgress(user);
    const hasCellIndex = cellIndex !== undefined && cellIndex !== null;
    const hasInventoryIndex = inventoryIndex !== undefined && inventoryIndex !== null;

    if (!hasCellIndex && !hasInventoryIndex) {
      return res.status(400).json({ error: 'Missing cell or inventory index' });
    }

    if (hasInventoryIndex) {
      const index = Number(inventoryIndex);
      if (!Number.isInteger(index) || index < 0 || index >= progress.specialInventory.length) {
        return res.status(400).json({ error: 'Invalid inventory index' });
      }

      const cat = progress.specialInventory[index];
      if (!cat) {
        return res.status(400).json({ error: 'No special cat in inventory slot' });
      }

      const definition = SPECIAL_CAT_TYPES[cat.type];
      const baseValue = cat.baseValue || definition?.baseValue || 0;
      const saleMultiplier = getSpecialSaleMultiplier(cat.form);
      const saleValue = Math.round(baseValue * saleMultiplier);

      progress.specialCurrency += saleValue;
      progress.specialInventory.splice(index, 1);

      user.markModified('catChessProgress.specialInventory');
      user.markModified('catChessProgress.specialCurrency');
      await user.save();
      return res.json(buildProgressPayload(progress, { includeSuccess: true }));
    }

    const index = Number(cellIndex);
    if (!Number.isInteger(index) || index < 0 || index >= progress.board.length) {
      return res.status(400).json({ error: 'Invalid cell index' });
    }

    const cell = progress.board[index];
    if (!cell || cell.kind !== 'special') {
      return res.status(400).json({ error: 'No special cat on selected cell' });
    }

    const definition = SPECIAL_CAT_TYPES[cell.type];
    if (!definition) {
      return res.status(400).json({ error: 'Unknown special cat type' });
    }

    const saleMultiplier = getSpecialSaleMultiplier(cell.form);
    const saleValue = Math.round((cell.baseValue || definition.baseValue) * saleMultiplier);
    progress.specialCurrency += saleValue;

    const buffBonus = getBuffMultiplier(cell.type, cell.form);
    const targets = getPatternIndices(cell.type, index);

    let sellBonusesChanged = false;
    targets.forEach(targetIndex => {
      const targetCell = progress.board[targetIndex];
      if (targetCell && targetCell.kind === 'cat' && typeof targetCell.level === 'number' && targetCell.level <= 50) {
        const currentBonus = progress.sellBonuses[targetIndex] ?? 1;
        progress.sellBonuses[targetIndex] = parseFloat((currentBonus * (1 + buffBonus)).toFixed(4));
        sellBonusesChanged = true;
      }
    });

    if (progress.sellBonuses[index]) {
      delete progress.sellBonuses[index];
      sellBonusesChanged = true;
    }

    progress.board[index] = null;

    user.markModified('catChessProgress.board');
    user.markModified('catChessProgress.specialCurrency');
    if (sellBonusesChanged) {
      user.markModified('catChessProgress.sellBonuses');
    }
    await user.save();
    res.json(buildProgressPayload(progress, { includeSuccess: true }));
  } catch (error) {
    console.error('Cat Chess sell special error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/cat-chess/move
router.post('/move', async (req, res) => {
  try {
    const { username, fromIndex, toIndex } = req.body;
    const user = await getUser(username);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const progress = await ensureCatChessProgress(user);

    const from = Number(fromIndex);
    const to = Number(toIndex);

    if (!Number.isInteger(from) || !Number.isInteger(to)) {
      return res.status(400).json({ error: 'Invalid move indices' });
    }

    if (from < 0 || from >= progress.board.length || to < 0 || to >= progress.board.length) {
      return res.status(400).json({ error: 'Move out of bounds' });
    }

    const fromCell = progress.board[from];
    const toCell = progress.board[to];

    if (!fromCell) return res.status(400).json({ error: 'No piece in source cell' });
    if (toCell) return res.status(400).json({ error: 'Destination cell not empty' });

    progress.board[to] = fromCell;
    progress.board[from] = null;

    if (progress.sellBonuses[from]) {
      progress.sellBonuses[to] = progress.sellBonuses[from];
      delete progress.sellBonuses[from];
      user.markModified('catChessProgress.sellBonuses');
    }

    user.markModified('catChessProgress.board');
    await user.save();
    res.json(buildProgressPayload(progress, { includeSuccess: true }));
  } catch (error) {
    console.error('Cat Chess move error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/cat-chess/swap
router.post('/swap', async (req, res) => {
  try {
    const { username, fromIndex, toIndex } = req.body;
    const user = await getUser(username);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const progress = await ensureCatChessProgress(user);

    const from = Number(fromIndex);
    const to = Number(toIndex);

    if (!Number.isInteger(from) || !Number.isInteger(to)) {
      return res.status(400).json({ error: 'Invalid swap indices' });
    }

    if (from < 0 || from >= progress.board.length || to < 0 || to >= progress.board.length) {
      return res.status(400).json({ error: 'Swap out of bounds' });
    }

    const fromCell = progress.board[from];
    const toCell = progress.board[to];

    if (!fromCell || !toCell) {
      return res.status(400).json({ error: 'Both cells must contain pieces' });
    }

    const temp = progress.board[from];
    progress.board[from] = progress.board[to];
    progress.board[to] = temp;

    const fromBonus = progress.sellBonuses[from];
    const toBonus = progress.sellBonuses[to];
    if (typeof fromBonus !== 'undefined' || typeof toBonus !== 'undefined') {
      if (typeof toBonus !== 'undefined') {
        progress.sellBonuses[from] = toBonus;
      } else {
        delete progress.sellBonuses[from];
      }

      if (typeof fromBonus !== 'undefined') {
        progress.sellBonuses[to] = fromBonus;
      } else {
        delete progress.sellBonuses[to];
      }

      user.markModified('catChessProgress.sellBonuses');
    }

    user.markModified('catChessProgress.board');
    await user.save();
    res.json(buildProgressPayload(progress, { includeSuccess: true }));
  } catch (error) {
    console.error('Cat Chess swap error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/cat-chess/convert_to_special
router.post('/convert_to_special', async (req, res) => {
  try {
    const { username, fromIndex } = req.body;
    const user = await getUser(username);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const progress = await ensureCatChessProgress(user);
    if (!hasInventoryCapacity(progress, { add: 1 })) {
      return res.status(400).json({ error: 'Special inventory full' });
    }

    const index = Number(fromIndex);
    if (!Number.isInteger(index) || index < 0 || index >= progress.board.length) {
      return res.status(400).json({ error: 'Invalid cell index' });
    }

    const cell = progress.board[index];
    const normalizedCat =
      cell && cell.kind === 'cat' ? cell : isLegacyRegularCat(cell) ? {
        kind: 'cat',
        level: cell.level,
        timerStart: cell.timerStart ? new Date(cell.timerStart) : null
      } : null;

    if (!normalizedCat) {
      return res.status(400).json({ error: 'No cat in selected cell' });
    }

    if (normalizedCat.level < 51) {
      return res.status(400).json({ error: 'Cat must be level 51 to convert' });
    }

    const type = rollSpecialCatType();
    const definition = SPECIAL_CAT_TYPES[type];
    if (!definition) {
      return res.status(500).json({ error: 'Unable to determine special cat type' });
    }

    const specialCat = {
      id: randomUUID(),
      type,
      form: 'common',
      baseValue: definition.baseValue,
      createdAt: new Date().toISOString()
    };

    progress.specialInventory.push(specialCat);
    progress.board[index] = null;

    if (progress.sellBonuses[index]) {
      delete progress.sellBonuses[index];
      user.markModified('catChessProgress.sellBonuses');
    }

    user.markModified('catChessProgress.board');
    user.markModified('catChessProgress.specialInventory');
    await user.save();
    res.json(buildProgressPayload(progress, { includeSuccess: true }));
  } catch (error) {
    console.error('Cat Chess convert to special error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/cat-chess/redeem
router.post('/redeem', async (req, res) => {
  try {
    const { username, code } = req.body;
    const user = await getUser(username);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const progress = await ensureCatChessProgress(user);
    if (!Array.isArray(progress.redeemedCodes)) {
      progress.redeemedCodes = [];
    }

    const normalizedCode = typeof code === 'string' ? code.trim().toUpperCase() : '';
    if (!normalizedCode) {
      return res.status(400).json({ error: 'Code is required' });
    }

    const alreadyRedeemed = progress.redeemedCodes.some(existing => {
      if (typeof existing !== 'string') return false;
      return existing.toUpperCase() === normalizedCode;
    });

    if (alreadyRedeemed) {
      return res.status(400).json({ error: 'Code already redeemed' });
    }

    const reward = CAT_CHESS_REDEEM_CODES[normalizedCode];
    if (!reward) {
      return res.status(400).json({ error: 'Invalid code' });
    }

    let message = reward.message || '';

    switch (reward.type) {
      case 'coins': {
        const amount = Number(reward.amount) || 0;
        progress.coins += amount;
        user.markModified('catChessProgress.coins');
        if (!message) {
          message = `Bonus received: +${amount.toLocaleString()} coins.`;
        }
        break;
      }
      case 'specialCurrency': {
        const amount = Number(reward.amount) || 0;
        progress.specialCurrency += amount;
        user.markModified('catChessProgress.specialCurrency');
        if (!message) {
          message = `Bonus received: +${amount} special coins.`;
        }
        break;
      }
      case 'cat': {
        const level = Number(reward.level) || 1;
        const emptyIndex = progress.board.findIndex(cell => cell === null);
        if (emptyIndex === -1) {
          return res.status(400).json({ error: 'No empty cells available to place the cat' });
        }

        progress.board[emptyIndex] = {
          kind: 'cat',
          level,
          timerStart: level >= 51 ? null : new Date()
        };

        if (progress.sellBonuses && progress.sellBonuses[emptyIndex]) {
          delete progress.sellBonuses[emptyIndex];
          user.markModified('catChessProgress.sellBonuses');
        }

        const requirementLevel = Math.min(level + 4, MAX_UNLOCK_LEVEL);
        const unlockChanged = unlockLevels(progress, {
          levels: [level, requirementLevel],
          upTo: Math.max(level, requirementLevel)
        });
        if (unlockChanged) {
          user.markModified('catChessProgress.unlockedLevels');
        }

        user.markModified('catChessProgress.board');

        const tierName = reward.tierName ? `${reward.tierName}` : `Level ${level}`;
        if (!message) {
          message = `${tierName} cat added to your board!`;
        }
        break;
      }
      default:
        return res.status(400).json({ error: 'Invalid code' });
    }

    progress.redeemedCodes.push(normalizedCode);
    user.markModified('catChessProgress.redeemedCodes');

    await user.save();
    res.json(buildProgressPayload(progress, { includeSuccess: true, extra: { message } }));
  } catch (error) {
    console.error('Cat Chess redeem error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/cat-chess/sell_collection
router.post('/sell_collection', async (req, res) => {
  try {
    const { username, form } = req.body;
    const user = await getUser(username);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const progress = await ensureCatChessProgress(user);
    const requiredTypes = Object.keys(SPECIAL_CAT_TYPES);

    const inventoryEntries = progress.specialInventory
      .map((cat, index) => ({ source: 'inventory', cat, index }))
      .filter(entry => entry.cat && SPECIAL_CAT_TYPES[entry.cat.type]);

    const boardEntries = progress.board
      .map((cell, index) => (cell && cell.kind === 'special'
        ? { source: 'board', cat: cell, index }
        : null))
      .filter(Boolean);

    const aggregateHasSet = targetForm => requiredTypes.every(type =>
      inventoryEntries.some(entry => entry.cat.type === type && entry.cat.form === targetForm) ||
      boardEntries.some(entry => entry.cat.type === type && entry.cat.form === targetForm)
    );

    const hasCommonSet = aggregateHasSet('common');
    const hasGoldenSet = aggregateHasSet('golden');

    let targetForm;
    if (form === 'common' || form === 'golden') {
      targetForm = form;
      if ((targetForm === 'common' && !hasCommonSet) || (targetForm === 'golden' && !hasGoldenSet)) {
        return res.status(400).json({ error: `Need complete ${targetForm} set` });
      }
    } else {
      targetForm = hasGoldenSet ? 'golden' : hasCommonSet ? 'common' : null;
      if (!targetForm) {
        return res.status(400).json({ error: 'Need complete common or golden set' });
      }
    }

    const inventoryPool = inventoryEntries.filter(entry => entry.cat.form === targetForm);
    const boardPool = boardEntries.filter(entry => entry.cat.form === targetForm);
    const collectionEntries = [];

    for (const type of requiredTypes) {
      let idx = inventoryPool.findIndex(entry => entry.cat.type === type);
      if (idx !== -1) {
        collectionEntries.push(inventoryPool[idx]);
        inventoryPool.splice(idx, 1);
        continue;
      }

      idx = boardPool.findIndex(entry => entry.cat.type === type);
      if (idx !== -1) {
        collectionEntries.push(boardPool[idx]);
        boardPool.splice(idx, 1);
        continue;
      }

      return res.status(400).json({ error: `Need complete ${targetForm} set` });
    }

    const collectionSaleTotal = collectionEntries.reduce((sum, entry) =>
      sum + calculateSpecialValue(entry.cat)
    , 0);

    const payoutMultiplier = SPECIAL_COLLECTION_MULTIPLIERS[targetForm];
    const payout = Math.round(collectionSaleTotal * payoutMultiplier);

    progress.specialCurrency += payout;

    const inventoryRemoval = collectionEntries
      .filter(entry => entry.source === 'inventory')
      .map(entry => entry.index)
      .sort((a, b) => b - a);

    inventoryRemoval.forEach(idx => {
      progress.specialInventory.splice(idx, 1);
    });

    let boardChanged = false;
    let sellBonusesChanged = false;
    collectionEntries
      .filter(entry => entry.source === 'board')
      .forEach(entry => {
        if (progress.board[entry.index]?.kind === 'special') {
          progress.board[entry.index] = null;
          boardChanged = true;
          if (progress.sellBonuses && progress.sellBonuses[entry.index]) {
            delete progress.sellBonuses[entry.index];
            sellBonusesChanged = true;
          }
        }
      });

    user.markModified('catChessProgress.specialInventory');
    user.markModified('catChessProgress.specialCurrency');
    if (boardChanged) {
      user.markModified('catChessProgress.board');
    }

    if (sellBonusesChanged) {
      user.markModified('catChessProgress.sellBonuses');
    }

    await user.save();
    res.json({
      ...buildProgressPayload(progress, { includeSuccess: true }),
      soldCollectionForm: targetForm,
      payout
    });
  } catch (error) {
    console.error('Cat Chess sell collection error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/cat-chess/merge_gold
router.post('/merge_gold', async (req, res) => {
  try {
    const { username, type } = req.body;
    const user = await getUser(username);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (!SPECIAL_CAT_TYPES[type]) {
      return res.status(400).json({ error: 'Unknown special cat type' });
    }

    const progress = await ensureCatChessProgress(user);
    const inventoryMatches = progress.specialInventory
      .map((cat, index) => (cat && cat.type === type && cat.form === 'common')
        ? { index, cat }
        : null)
      .filter(Boolean);

    const boardMatches = progress.board
      .map((cell, index) => (cell && cell.kind === 'special' && cell.type === type && cell.form === 'common')
        ? { index, cell }
        : null)
      .filter(Boolean);

    const totalAvailable = inventoryMatches.length + boardMatches.length;
    if (totalAvailable < 5) {
      return res.status(400).json({ error: 'Need 5 matching common specials to merge' });
    }

    let remaining = 5;
    const selectedInventory = [];
    const selectedBoard = [];

    for (const entry of inventoryMatches) {
      if (remaining === 0) break;
      selectedInventory.push(entry);
      remaining -= 1;
    }

    for (const entry of boardMatches) {
      if (remaining === 0) break;
      selectedBoard.push(entry);
      remaining -= 1;
    }

    if (remaining > 0) {
      return res.status(400).json({ error: 'Need 5 matching common specials to merge' });
    }

    if (!hasInventoryCapacity(progress, { add: 1, remove: selectedInventory.length })) {
      return res.status(400).json({ error: 'Special inventory full' });
    }

    const removalIndices = selectedInventory
      .map(entry => entry.index)
      .sort((a, b) => b - a);

    removalIndices.forEach(idx => {
      progress.specialInventory.splice(idx, 1);
    });

    let boardChanged = false;
    let sellBonusesChanged = false;
    selectedBoard.forEach(entry => {
      if (progress.board[entry.index]?.kind === 'special') {
        progress.board[entry.index] = null;
        boardChanged = true;
        if (progress.sellBonuses?.[entry.index]) {
          delete progress.sellBonuses[entry.index];
          sellBonusesChanged = true;
        }
      }
    });

    const definition = SPECIAL_CAT_TYPES[type];
    progress.specialInventory.push({
      id: randomUUID(),
      type,
      form: 'golden',
      baseValue: definition.baseValue,
      createdAt: new Date().toISOString()
    });

    user.markModified('catChessProgress.specialInventory');
    if (boardChanged) {
      user.markModified('catChessProgress.board');
    }

    if (sellBonusesChanged) {
      user.markModified('catChessProgress.sellBonuses');
    }

    await user.save();
    res.json({
      ...buildProgressPayload(progress, { includeSuccess: true }),
      mergedType: type,
      inventoryConsumed: removalIndices.length,
      boardConsumed: selectedBoard.length
    });
  } catch (error) {
    console.error('Cat Chess merge gold error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/cat-chess/upgrade_special
router.post('/upgrade_special', async (req, res) => {
  try {
    const { username, type } = req.body;
    const user = await getUser(username);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const progress = await ensureCatChessProgress(user);
    if (!SPECIAL_CAT_TYPES[type]) {
      return res.status(400).json({ error: 'Unknown special cat type' });
    }

    const pool = progress.specialInventory
      .map((cat, index) => ({ cat, index }))
      .filter(entry => entry.cat && entry.cat.type === type && entry.cat.form === 'common');

    if (pool.length < 5) {
      return res.status(400).json({ error: 'Need 5 identical common special cats to upgrade' });
    }

    const [upgradeTarget, ...remainder] = pool;
    progress.specialInventory[upgradeTarget.index] = {
      ...upgradeTarget.cat,
      form: 'golden'
    };

    const removalIndices = remainder.slice(0, 4).map(entry => entry.index).sort((a, b) => b - a);
    removalIndices.forEach(idx => {
      progress.specialInventory.splice(idx, 1);
    });

    user.markModified('catChessProgress.specialInventory');
    await user.save();
    res.json(buildProgressPayload(progress, { includeSuccess: true }));
  } catch (error) {
    console.error('Cat Chess upgrade special error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/cat-chess/move_special
router.post('/move_special', async (req, res) => {
  try {
    const { username, fromIndex, toIndex } = req.body;
    const user = await getUser(username);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const progress = await ensureCatChessProgress(user);
    const from = Number(fromIndex);
    const to = Number(toIndex);

    if (!Number.isInteger(from) || !Number.isInteger(to)) {
      return res.status(400).json({ error: 'Invalid move indices' });
    }

    if (from < 0 || from >= progress.board.length || to < 0 || to >= progress.board.length) {
      return res.status(400).json({ error: 'Move out of bounds' });
    }

    if (from === to) {
      return res.status(400).json({ error: 'Cannot move to same cell' });
    }

    const fromCell = progress.board[from];
    if (!fromCell || fromCell.kind !== 'special') {
      return res.status(400).json({ error: 'Origin cell does not contain a special cat' });
    }

    const targetCell = progress.board[to];
    const sellBonuses = progress.sellBonuses || {};
    const fromBonus = sellBonuses[from];
    const toBonus = sellBonuses[to];
    let sellBonusesChanged = false;

    if (!targetCell) {
      progress.board[to] = fromCell;
      progress.board[from] = null;
    } else if (targetCell.kind === 'cat' || targetCell.kind === 'special') {
      progress.board[to] = fromCell;
      progress.board[from] = targetCell;
    } else {
      return res.status(400).json({ error: 'Destination cell is not available' });
    }

    if (typeof fromBonus !== 'undefined' || typeof toBonus !== 'undefined') {
      if (typeof toBonus !== 'undefined') {
        sellBonuses[from] = toBonus;
      } else {
        delete sellBonuses[from];
      }

      if (typeof fromBonus !== 'undefined') {
        sellBonuses[to] = fromBonus;
      } else {
        delete sellBonuses[to];
      }

      sellBonusesChanged = true;
    }

    if (sellBonusesChanged) {
      progress.sellBonuses = sellBonuses;
      user.markModified('catChessProgress.sellBonuses');
    }

    user.markModified('catChessProgress.board');
    await user.save();
    res.json(buildProgressPayload(progress, { includeSuccess: true }));
  } catch (error) {
    console.error('Cat Chess move special error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/cat-chess/place_special
router.post('/place_special', async (req, res) => {
  try {
    const { username, specialId, cellIndex } = req.body;
    const user = await getUser(username);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const progress = await ensureCatChessProgress(user);
    const index = Number(cellIndex);
    if (!Number.isInteger(index) || index < 0 || index >= progress.board.length) {
      return res.status(400).json({ error: 'Invalid cell index' });
    }

    if (progress.board[index]) {
      return res.status(400).json({ error: 'Cell already occupied' });
    }

    const inventoryIndex = progress.specialInventory.findIndex(cat => cat.id === specialId);
    if (inventoryIndex === -1) {
      return res.status(400).json({ error: 'Special cat not found in inventory' });
    }

    const cat = progress.specialInventory[inventoryIndex];
    progress.specialInventory.splice(inventoryIndex, 1);

    progress.board[index] = {
      kind: 'special',
      id: cat.id,
      type: cat.type,
      form: cat.form,
      baseValue: cat.baseValue,
      createdAt: cat.createdAt
    };

    if (progress.sellBonuses[index]) {
      delete progress.sellBonuses[index];
    }

    user.markModified('catChessProgress.board');
    user.markModified('catChessProgress.specialInventory');
    user.markModified('catChessProgress.sellBonuses');
    await user.save();
    res.json(buildProgressPayload(progress, { includeSuccess: true }));
  } catch (error) {
    console.error('Cat Chess place special error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/cat-chess/pickup_special
router.post('/pickup_special', async (req, res) => {
  try {
    const { username, cellIndex } = req.body;
    const user = await getUser(username);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const progress = await ensureCatChessProgress(user);
    const index = Number(cellIndex);
    if (!Number.isInteger(index) || index < 0 || index >= progress.board.length) {
      return res.status(400).json({ error: 'Invalid cell index' });
    }

    if (!hasInventoryCapacity(progress, { add: 1 })) {
      return res.status(400).json({ error: 'Special inventory full' });
    }

    const cell = progress.board[index];
    if (!cell || cell.kind !== 'special') {
      return res.status(400).json({ error: 'No special cat on selected cell' });
    }

    progress.specialInventory.push({
      id: cell.id,
      type: cell.type,
      form: cell.form,
      baseValue: cell.baseValue || SPECIAL_CAT_TYPES[cell.type]?.baseValue || 0,
      createdAt: cell.createdAt || new Date().toISOString()
    });

    progress.board[index] = null;

    if (progress.sellBonuses[index]) {
      delete progress.sellBonuses[index];
    }

    user.markModified('catChessProgress.board');
    user.markModified('catChessProgress.specialInventory');
    user.markModified('catChessProgress.sellBonuses');
    await user.save();
    res.json(buildProgressPayload(progress, { includeSuccess: true }));
  } catch (error) {
    console.error('Cat Chess pickup special error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

function calculateSpecialValue(cat, { includeSaleMultiplier = true } = {}) {
  if (!cat) return 0;
  const definition = SPECIAL_CAT_TYPES[cat.type];
  if (!definition) return 0;
  const base = cat.baseValue || definition.baseValue;
  if (includeSaleMultiplier === false) {
    return base;
  }
  const multiplier = getSpecialSaleMultiplier(cat.form);
  return Math.round(base * multiplier);
}

export default router;