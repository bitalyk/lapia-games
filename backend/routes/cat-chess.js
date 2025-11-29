// backend/routes/cat-chess.js
import express from "express";
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

const GROWTH_TIME_SEC = process.env.FAST_MODE === 'true' ? 30 : 12 * 60 * 60; // 30s testing / 12h normal

const SPECIAL_CATS = {
  types: ['tabby', 'siamese', 'persian', 'maine_coon', 'bengal'],
  rarities: ['common', 'rare', 'epic', 'legendary'],
  forms: ['common', 'gold']
};

const SPECIAL_BASE_VALUES = {
  common: 100,
  rare: 250,
  epic: 750,
  legendary: 2000
};

const SPECIAL_TYPE_MODIFIERS = {
  tabby: 1,
  siamese: 1.1,
  persian: 1.25,
  maine_coon: 1.5,
  bengal: 1.75
};

const RARITY_ORDER = {
  common: 1,
  rare: 2,
  epic: 3,
  legendary: 4
};

// Helper functions
function computeCatGrowth(cat, nowSec) {
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

async function getUser(username) {
  return await User.findByUsername(username);
}

function serializeCat(cat, nowSec) {
  if (!cat) return null;
  const baseCat = typeof cat.toObject === 'function' ? cat.toObject() : { ...cat };
  const growth = computeCatGrowth(baseCat, nowSec);
  const timer = baseCat.timerStart ? new Date(baseCat.timerStart) : null;
  return {
    level: baseCat.level,
    timerStart: timer ? timer.toISOString() : null,
    grown: growth.grown,
    timeLeft: growth.timeLeft
  };
}

function serializeSpecialCat(cat) {
  if (!cat) return null;
  return typeof cat.toObject === 'function' ? cat.toObject() : { ...cat };
}

function buildProgressPayload(progress, { includeSuccess = false } = {}) {
  const nowSec = Math.floor(Date.now() / 1000);
  return {
    ...(includeSuccess ? { success: true } : {}),
    coins: progress.coins,
    specialCurrency: progress.specialCurrency,
    board: progress.board.map(cat => serializeCat(cat, nowSec)),
    unlockedLevels: [...progress.unlockedLevels].sort((a, b) => a - b),
    specialInventory: progress.specialInventory.map(cat => serializeSpecialCat(cat)).filter(cat => cat),
    redeemedCodes: [...progress.redeemedCodes]
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
      starterGranted: false
    };
    user.catChessProgress.board[0] = {
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

  if (!Array.isArray(user.catChessProgress.unlockedLevels) || user.catChessProgress.unlockedLevels.length === 0) {
    user.catChessProgress.unlockedLevels = [1];
    modified = true;
  }

  if (!Array.isArray(user.catChessProgress.specialInventory)) {
    user.catChessProgress.specialInventory = [];
    modified = true;
  }

  if (!Array.isArray(user.catChessProgress.redeemedCodes)) {
    user.catChessProgress.redeemedCodes = [];
    modified = true;
  }

  if (typeof user.catChessProgress.starterGranted !== 'boolean') {
    user.catChessProgress.starterGranted = true;
    modified = true;
  }

  const hasAnyCat = user.catChessProgress.board.some(cell => cell && typeof cell.level !== 'undefined');
  if (!hasAnyCat && !user.catChessProgress.starterGranted) {
    user.catChessProgress.board[0] = {
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
    const { username, level } = req.body;
    const user = await getUser(username);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const progress = await ensureCatChessProgress(user);
    if (level > 46) return res.status(400).json({ error: 'Cannot buy level above 46' });
    if (!progress.unlockedLevels.includes(level)) return res.status(400).json({ error: 'Level not unlocked' });

    const catData = CAT_LEVELS[level];
    if (progress.coins < catData.cost) return res.status(400).json({ error: 'Not enough coins' });

    // Find empty cell
    const emptyIndex = progress.board.findIndex(cell => cell === null);
    if (emptyIndex === -1) return res.status(400).json({ error: 'No empty cells' });

    progress.coins -= catData.cost;
    progress.board[emptyIndex] = {
      level,
      timerStart: level >= 51 ? null : new Date()
    };

    if (!progress.unlockedLevels.includes(level)) {
      progress.unlockedLevels.push(level);
      user.markModified('catChessProgress.unlockedLevels');
    }

    user.markModified('catChessProgress.board');
    await user.save();
    res.json(buildProgressPayload(progress, { includeSuccess: true }));
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

    const nowSec = Math.floor(Date.now() / 1000);
    const growth = computeCatGrowth(cat, nowSec);
    if (!growth.grown) return res.status(400).json({ error: 'Cat not grown yet' });

    const sellPrice = CAT_LEVELS[cat.level].sellPrice;
    progress.coins += sellPrice;
    progress.board[index] = null;

    user.markModified('catChessProgress.board');
    await user.save();
    res.json(buildProgressPayload(progress, { includeSuccess: true }));
  } catch (error) {
    console.error('Cat Chess sell error:', error);
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
    const fromCat = progress.board[fromIndex];
    const toCat = progress.board[toIndex];

    if (!fromCat || !toCat) return res.status(400).json({ error: 'Invalid cells' });
    if (fromCat.level !== toCat.level) return res.status(400).json({ error: 'Cats must be same level' });

    const nextLevel = fromCat.level + 1;
    if (nextLevel > 51) return res.status(400).json({ error: 'Max level reached' });

    // Inherit longest timer
    const timers = [fromCat.timerStart, toCat.timerStart].filter(t => t);
    const longestTimer = timers.length ? new Date(Math.max(...timers.map(t => new Date(t).getTime()))) : null;

    progress.board[toIndex] = {
      level: nextLevel,
      timerStart: nextLevel >= 51 ? null : (longestTimer || new Date()) // Special cats don't grow
    };
    progress.board[fromIndex] = null;

    // Unlock next level
    if (!progress.unlockedLevels.includes(nextLevel)) {
      progress.unlockedLevels.push(nextLevel);
      user.markModified('catChessProgress.unlockedLevels');
    }

    // Chance for special cat if merging level 50
    if (fromCat.level === 50) {
      if (Math.random() < 0.1) { // 10% chance
        const type = SPECIAL_CATS.types[Math.floor(Math.random() * SPECIAL_CATS.types.length)];
        const rarity = SPECIAL_CATS.rarities[Math.floor(Math.random() * SPECIAL_CATS.rarities.length)];
        const form = 'common';
        progress.specialInventory.push({ type, rarity, form });
        if (progress.specialInventory.length > 10) progress.specialInventory.shift(); // Keep only 10
        user.markModified('catChessProgress.specialInventory');
      }
    }

    user.markModified('catChessProgress.board');
    await user.save();
    res.json(buildProgressPayload(progress, { includeSuccess: true }));
  } catch (error) {
    console.error('Cat Chess merge error:', error);
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

    const fromCat = progress.board[from];
    const toCat = progress.board[to];

    if (!fromCat) return res.status(400).json({ error: 'No cat in source cell' });
    if (toCat) return res.status(400).json({ error: 'Destination cell not empty' });

    progress.board[to] = fromCat;
    progress.board[from] = null;

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

    const fromCat = progress.board[from];
    const toCat = progress.board[to];

    if (!fromCat || !toCat) {
      return res.status(400).json({ error: 'Both cells must contain cats' });
    }

    const temp = progress.board[from];
    progress.board[from] = progress.board[to];
    progress.board[to] = temp;

    user.markModified('catChessProgress.board');
    await user.save();
    res.json(buildProgressPayload(progress, { includeSuccess: true }));
  } catch (error) {
    console.error('Cat Chess swap error:', error);
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
    if (progress.redeemedCodes.includes(code)) return res.status(400).json({ error: 'Code already redeemed' });

    // Simple codes for now
    if (code === 'GROWTH') {
      progress.coins += 10000;
      progress.redeemedCodes.push(code);
      await user.save();
      res.json({ success: true, coins: progress.coins });
    } else {
      res.status(400).json({ error: 'Invalid code' });
    }
  } catch (error) {
    console.error('Cat Chess redeem error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/cat-chess/sell_special
router.post('/sell_special', async (req, res) => {
  try {
    const { username, inventoryIndex } = req.body;
    const user = await getUser(username);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const progress = await ensureCatChessProgress(user);
    const index = Number(inventoryIndex);
    if (!Number.isInteger(index) || index < 0 || index >= progress.specialInventory.length) {
      return res.status(400).json({ error: 'Invalid inventory index' });
    }

    const cat = progress.specialInventory[index];
    if (!cat) return res.status(400).json({ error: 'No cat in inventory slot' });

    const value = calculateSpecialValue(cat);

    progress.specialCurrency += value;
    progress.specialInventory[index] = null;

    // Clean up nulls
    progress.specialInventory = progress.specialInventory.filter(cat => cat !== null);

    user.markModified('catChessProgress.specialInventory');
    await user.save();
    res.json(buildProgressPayload(progress, { includeSuccess: true }));
  } catch (error) {
    console.error('Cat Chess sell special error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/cat-chess/sell_collection
router.post('/sell_collection', async (req, res) => {
  try {
    const { username } = req.body;
    const user = await getUser(username);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const progress = await ensureCatChessProgress(user);
    const types = new Set(progress.specialInventory.map(cat => cat.type));
    if (types.size < 5) return res.status(400).json({ error: 'Need 5 different special cat types' });

    let totalValue = 0;
    progress.specialInventory.forEach(cat => {
      totalValue += calculateSpecialValue(cat);
    });

    const bonusValue = totalValue * 2;
    progress.specialCurrency += bonusValue;
    progress.specialInventory = [];

    user.markModified('catChessProgress.specialInventory');
    await user.save();
    res.json(buildProgressPayload(progress, { includeSuccess: true }));
  } catch (error) {
    console.error('Cat Chess sell collection error:', error);
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
    if (!SPECIAL_CATS.types.includes(type)) {
      return res.status(400).json({ error: 'Unknown special cat type' });
    }

    const pool = progress.specialInventory
      .map((cat, index) => ({ cat, index }))
      .filter(entry => entry.cat && entry.cat.type === type && entry.cat.form === 'common');

    if (pool.length < 5) {
      return res.status(400).json({ error: 'Need 5 identical common special cats to upgrade' });
    }

    pool.sort((a, b) => RARITY_ORDER[b.cat.rarity] - RARITY_ORDER[a.cat.rarity]);

    const [upgradeTarget, ...toRemove] = pool;
    progress.specialInventory[upgradeTarget.index] = {
      type,
      rarity: upgradeTarget.cat.rarity,
      form: 'gold'
    };

    toRemove.slice(0, 4).forEach(({ index }) => {
      progress.specialInventory[index] = null;
    });

    progress.specialInventory = progress.specialInventory.filter(cat => cat !== null);

    while (progress.specialInventory.length > 10) {
      progress.specialInventory.shift();
    }

    user.markModified('catChessProgress.specialInventory');
    await user.save();
    res.json(buildProgressPayload(progress, { includeSuccess: true }));
  } catch (error) {
    console.error('Cat Chess upgrade special error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

function calculateSpecialValue(cat) {
  if (!cat) return 0;
  const base = SPECIAL_BASE_VALUES[cat.rarity] || SPECIAL_BASE_VALUES.common;
  const formMultiplier = cat.form === 'gold' ? 5 : 1;
  const typeMultiplier = SPECIAL_TYPE_MODIFIERS[cat.type] || 1;
  return Math.round(base * formMultiplier * typeMultiplier);
}

export default router;