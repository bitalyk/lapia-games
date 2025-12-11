import { randomUUID } from 'crypto';
import PromoCodeError from './promo-code-error.js';
import EarningsTracker from './earnings-tracker.js';

const FAST_MODE = process.env.FAST_MODE === 'true';
const HAPPY_BIRD_TYPES = ['red', 'orange', 'yellow', 'green', 'blue', 'purple'];
const HAPPY_BIRDS = {
  red: { eps: 1 },
  orange: { eps: 2 },
  yellow: { eps: 5 },
  green: { eps: 10 },
  blue: { eps: 20 },
  purple: { eps: 50 }
};
const HAPPY_BIRD_BUFFER_SEC = FAST_MODE ? 30 : 6 * 60 * 60;

const TREE_TYPES = {
  common: { level: 1 },
  bronze: { level: 2 },
  silver: { level: 3 },
  golden: { level: 4 },
  platinum: { level: 5 },
  diamond: { level: 6 }
};
const RICH_GARDEN_SIZE = 10;
const RICH_GARDEN_PRODUCTION_TIME = FAST_MODE ? 30 : 4 * 60 * 60;
const RICH_GARDEN_COLLECTION_TIME = 0; // Collection resolves instantly in the new logistics flow
const RICH_GARDEN_TRUCK_TRAVEL = FAST_MODE ? 10 : 60 * 60;

const MINE_TYPES = {
  coal: { orePerSecond: 1, level: 1 },
  copper: { orePerSecond: 2, level: 2 },
  iron: { orePerSecond: 5, level: 3 },
  nickel: { orePerSecond: 10, level: 4 },
  silver: { orePerSecond: 20, level: 5 },
  golden: { orePerSecond: 50, level: 6 }
};
const GOLDEN_MINE_PRODUCTION_TIME = FAST_MODE ? 30 : 8 * 60 * 60;
const GOLDEN_MINE_REST_TIME = FAST_MODE ? 15 : 4 * 60 * 60;
const GOLDEN_MINE_TRUCK = FAST_MODE ? 10 : 2 * 60 * 60;
const GOLDEN_MINE_MAX_MINES = 10;
const GOLDEN_MINE_MAX_WORKERS = 10;

const CAT_BOARD_SIZE = 64;
const CAT_GROWTH_TIME = FAST_MODE ? 30 : 12 * 60 * 60;
const MAX_CAT_LEVEL = 51;

const FISH_TYPES = {
  little: { name: 'Little Fish' },
  golden: { name: 'Golden Fish' },
  middle: { name: 'Middle Fish' },
  rainbow: { name: 'Rainbow Fish' },
  big: { name: 'Big Fish' },
  scary: { name: 'Scary Fish' }
};
const FISH_MAX_LEVEL = 6;
const FISH_SHOP_RESTOCK_SEC = FAST_MODE ? 60 : 3 * 60 * 60;

const GAME_KEYS = new Set(['happybirds', 'richgarden', 'goldenmine', 'catchess', 'fishes', 'global']);

function normalizePositiveInteger(value, fallback = 1) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.floor(parsed));
}

function ensureHappyBirdsState(user) {
  if (!user.birds) user.birds = {};
  if (!user.eggs) user.eggs = {};
  if (!user.savedProduced) user.savedProduced = {};
}

function settleHappyBirdsProduction(user) {
  if (!user.lastSaveTime || !user.productionStart) {
    return;
  }
  const last = new Date(user.lastSaveTime).getTime();
  const now = Date.now();
  let seconds = Math.floor((now - last) / 1000);
  if (seconds <= 0) {
    return;
  }
  if (seconds > HAPPY_BIRD_BUFFER_SEC) {
    seconds = HAPPY_BIRD_BUFFER_SEC;
  }
  const produced = {};
  for (const type of HAPPY_BIRD_TYPES) {
    const count = Number(user.birds[type] || 0);
    produced[type] = Math.floor(count * HAPPY_BIRDS[type].eps * seconds);
  }
  user.savedProduced = produced;
  user.lastSaveTime = new Date();
}

function ensureRichGardenProgress(user) {
  if (!user.richGardenProgress) {
    user.richGardenProgress = {
      coins: 1000,
      garden: Array(RICH_GARDEN_SIZE).fill(null),
      inventory: {},
      truckInventory: {},
      truckLocation: 'farm',
      truckDepartureTime: null,
      totalTreesPlanted: 0,
      totalFruitsCollected: 0,
      totalCoinsEarned: 0,
      highestGardenLevel: 1,
      lastPlayed: new Date(),
      playTime: 0
    };
  }
  if (!Array.isArray(user.richGardenProgress.garden)) {
    user.richGardenProgress.garden = Array(RICH_GARDEN_SIZE).fill(null);
  }
  if (!user.richGardenProgress.inventory) {
    user.richGardenProgress.inventory = {};
  }
  if (!user.richGardenProgress.truckInventory) {
    user.richGardenProgress.truckInventory = {};
  }
}

function fastForwardRichGarden(progress, seconds) {
  if (!progress) return;
  const shiftMs = seconds * 1000;
  const now = Date.now();
  progress.garden.forEach(tree => {
    if (!tree) return;
    if (tree.plantedAt) {
      tree.plantedAt = new Date(new Date(tree.plantedAt).getTime() - shiftMs);
    }
    if (tree.collectionStartTime) {
      tree.collectionStartTime = null;
    }
    if (tree.timeLeft && tree.timeLeft > 0) {
      tree.timeLeft = Math.max(0, tree.timeLeft - seconds);
    }
    if (tree.state === 'collecting') {
      tree.state = 'ready';
      tree.timeLeft = 0;
    } else if (tree.state === 'producing') {
      const plantedAt = tree.plantedAt ? new Date(tree.plantedAt).getTime() : now;
      const elapsed = Math.floor((now - plantedAt) / 1000);
      if (elapsed >= RICH_GARDEN_PRODUCTION_TIME) {
        tree.state = 'ready';
        tree.timeLeft = 0;
      }
    }
  });
  if (progress.truckDepartureTime) {
    progress.truckDepartureTime = new Date(new Date(progress.truckDepartureTime).getTime() - shiftMs);
  }
  if (progress.truckLocation?.startsWith('traveling')) {
    const departure = progress.truckDepartureTime ? new Date(progress.truckDepartureTime).getTime() : Date.now() - shiftMs;
    const elapsed = Math.floor((Date.now() - departure) / 1000);
    if (elapsed >= RICH_GARDEN_TRUCK_TRAVEL) {
      progress.truckLocation = progress.truckLocation === 'traveling_to_city' ? 'city' : 'farm';
      progress.truckDepartureTime = null;
    }
  }
}

function ensureGoldenMineProgress(user) {
  if (!user.goldenMineProgress) {
    user.goldenMineProgress = {
      coins: 1000,
      mines: Array(GOLDEN_MINE_MAX_MINES).fill(null),
      inventory: {},
      truckLocation: 'mine',
      truckDepartureTime: null,
      truckCargo: {},
      totalMinesOwned: 0,
      totalOreMined: 0,
      totalCoinsEarned: 0,
      lastPlayed: new Date(),
      playTime: 0
    };
  }
  if (!Array.isArray(user.goldenMineProgress.mines)) {
    user.goldenMineProgress.mines = Array(GOLDEN_MINE_MAX_MINES).fill(null);
  }
  if (!user.goldenMineProgress.inventory) {
    user.goldenMineProgress.inventory = {};
  }
  if (!user.goldenMineProgress.truckCargo) {
    user.goldenMineProgress.truckCargo = {};
  }
}

function completeMineCycle(mine) {
  if (!mine) return;
  if (mine.state === 'producing') {
    mine.state = 'ready';
    mine.timeLeft = 0;
    mine.oreProduced = mine.workers * MINE_TYPES[mine.type].orePerSecond * GOLDEN_MINE_PRODUCTION_TIME;
    mine.lastStateChange = new Date();
  } else if (mine.state === 'resting') {
    mine.state = 'producing';
    mine.timeLeft = GOLDEN_MINE_PRODUCTION_TIME;
    mine.oreProduced = 0;
    mine.lastStateChange = new Date();
  }
}

function ensureCatChessProgress(user) {
  if (!user.catChessProgress) {
    user.catChessProgress = {
      coins: 1000,
      specialCurrency: 0,
      board: Array(CAT_BOARD_SIZE).fill(null),
      unlockedLevels: [1],
      specialInventory: [],
      sellBonuses: {}
    };
  }
  if (!Array.isArray(user.catChessProgress.board)) {
    user.catChessProgress.board = Array(CAT_BOARD_SIZE).fill(null);
  }
  if (!Array.isArray(user.catChessProgress.unlockedLevels)) {
    user.catChessProgress.unlockedLevels = [1];
  }
}

function unlockCatLevels(progress, level) {
  const unlockSet = new Set(progress.unlockedLevels || [1]);
  unlockSet.add(1);
  unlockSet.add(Math.min(level, MAX_CAT_LEVEL));
  if (level < MAX_CAT_LEVEL) {
    unlockSet.add(Math.min(level + 4, MAX_CAT_LEVEL));
  }
  progress.unlockedLevels = Array.from(unlockSet).sort((a, b) => a - b);
}

function ensureFishesProgress(user) {
  if (!user.fishesProgress) {
    user.fishesProgress = {
      coins: 1000,
      food: 10,
      aquariumSize: 1,
      fishes: [],
      shopPurchases: new Map(),
      shopRestockAt: null,
      lastFreeFoodAt: null
    };
  }
  if (!Array.isArray(user.fishesProgress.fishes)) {
    user.fishesProgress.fishes = [];
  }
}

function createFishSlot(type, level = 1) {
  const safeLevel = Math.min(FISH_MAX_LEVEL, Math.max(1, Number(level) || 1));
  const fishType = FISH_TYPES[type] ? type : 'little';
  return {
    id: randomUUID(),
    type: fishType,
    level: safeLevel,
    foodConsumed: 0,
    feedProgress: 0,
    feedsUsed: 0,
    lastFedAt: null,
    cooldownEndsAt: null,
    createdAt: new Date()
  };
}

export default class PromoGameExecutor {
  static async execute({ promo, user }) {
    if (!promo || !GAME_KEYS.has(promo.game)) {
      throw new PromoCodeError('Unsupported game target', { statusCode: 400, reason: 'unsupported_game' });
    }

    switch (promo.game) {
      case 'happybirds':
        return this.handleHappyBirds(promo, user);
      case 'richgarden':
        return this.handleRichGarden(promo, user);
      case 'goldenmine':
        return this.handleGoldenMine(promo, user);
      case 'catchess':
        return this.handleCatChess(promo, user);
      case 'fishes':
        return this.handleFishes(promo, user);
      case 'global':
        return this.handleGlobal(promo, user);
      default:
        throw new PromoCodeError('Unknown promo game target', { statusCode: 400, reason: 'unknown_game' });
    }
  }

  static handleHappyBirds(promo, user) {
    ensureHappyBirdsState(user);
    const params = promo.parameters || {};

    switch (promo.action) {
      case 'addBird': {
        const birdType = params.birdType;
        if (!HAPPY_BIRD_TYPES.includes(birdType)) {
          throw new PromoCodeError('Unknown bird type', { reason: 'invalid_bird' });
        }
        const quantity = normalizePositiveInteger(params.quantity, 1);
        if (user.lastSaveTime) {
          settleHappyBirdsProduction(user);
        }
        user.birds[birdType] = (user.birds[birdType] || 0) + quantity;
        if (!user.productionStart) {
          user.productionStart = new Date();
          user.savedProduced = {};
          user.lastSaveTime = null;
        }
        user.markModified?.('birds');
        return {
          message: `${quantity} ${birdType} bird${quantity > 1 ? 's' : ''} added!`,
          payload: {
            coins: user.coins,
            birds: user.birds,
            productionStart: user.productionStart,
            savedProduced: user.savedProduced,
            lastSaveTime: user.lastSaveTime
          }
        };
      }
      case 'addCoins': {
        const amount = Number(params.amount) || 0;
        if (amount <= 0) {
          throw new PromoCodeError('Amount must be greater than zero');
        }
        user.coins += amount;
        return {
          message: `+${amount.toLocaleString()} coins added to Happy Birds!`,
          payload: { coins: user.coins }
        };
      }
      case 'addEggs': {
        const birdType = params.birdType;
        if (!HAPPY_BIRD_TYPES.includes(birdType)) {
          throw new PromoCodeError('Unknown bird type for eggs');
        }
        const quantity = normalizePositiveInteger(params.quantity, 1);
        user.eggs[birdType] = (user.eggs[birdType] || 0) + quantity;
        user.markModified?.('eggs');
        return {
          message: `Added ${quantity.toLocaleString()} ${birdType} eggs!`,
          payload: { eggs: user.eggs }
        };
      }
      case 'skipTimer': {
        const offset = HAPPY_BIRD_BUFFER_SEC * 1000;
        const anchor = new Date(Date.now() - offset);
        user.productionStart = anchor;
        user.lastSaveTime = anchor;
        user.savedProduced = {};
        for (const type of HAPPY_BIRD_TYPES) {
          const count = Number(user.birds[type] || 0);
          user.savedProduced[type] = Math.floor(count * HAPPY_BIRDS[type].eps * HAPPY_BIRD_BUFFER_SEC);
        }
        return {
          message: 'Production timer skipped. Birds are fully charged!',
          payload: {
            productionStart: user.productionStart,
            lastSaveTime: user.lastSaveTime,
            savedProduced: user.savedProduced
          }
        };
      }
      default:
        throw new PromoCodeError('Unsupported Happy Birds action', { reason: 'unsupported_action' });
    }
  }

  static handleRichGarden(promo, user) {
    ensureRichGardenProgress(user);
    const progress = user.richGardenProgress;
    const params = promo.parameters || {};

    switch (promo.action) {
      case 'addTree': {
        const treeType = TREE_TYPES[params.treeType] ? params.treeType : 'common';
        const quantity = normalizePositiveInteger(params.quantity, 1);
        let placed = 0;
        for (let i = 0; i < quantity; i += 1) {
          const slot = progress.garden.findIndex(cell => cell === null);
          if (slot === -1) {
            if (placed === 0) {
              throw new PromoCodeError('No empty garden slots available', { reason: 'no_slots' });
            }
            break;
          }
          progress.garden[slot] = {
            type: treeType,
            state: 'producing',
            timeLeft: RICH_GARDEN_PRODUCTION_TIME,
            plantedAt: new Date(),
            collectionStartTime: null,
            lastCollected: null
          };
          placed += 1;
        }
        if (placed === 0) {
          throw new PromoCodeError('Unable to place tree reward', { reason: 'placement_failed' });
        }
        progress.totalTreesPlanted = (progress.totalTreesPlanted || 0) + placed;
        progress.highestGardenLevel = Math.max(progress.highestGardenLevel || 1, TREE_TYPES[treeType].level);
        user.markModified('richGardenProgress');
        return {
          message: `${placed} ${treeType} tree${placed > 1 ? 's' : ''} planted!`,
          payload: { garden: progress.garden }
        };
      }
      case 'addCoins': {
        const amount = Number(params.amount) || 0;
        if (amount <= 0) {
          throw new PromoCodeError('Amount must be greater than zero');
        }
        progress.coins += amount;
        user.markModified('richGardenProgress');
        return {
          message: `+${amount.toLocaleString()} Rich Garden coins added!`,
          payload: { coins: progress.coins }
        };
      }
      case 'addInventory': {
        const treeType = TREE_TYPES[params.treeType] ? params.treeType : 'common';
        const quantity = normalizePositiveInteger(params.quantity, 1);
        progress.inventory[treeType] = (progress.inventory[treeType] || 0) + quantity;
        user.markModified('richGardenProgress');
        return {
          message: `Added ${quantity.toLocaleString()} ${treeType} fruits to inventory!`,
          payload: { inventory: progress.inventory }
        };
      }
      case 'skipTruck': {
        const destination = params.destination === 'farm' ? 'farm' : 'city';
        progress.truckLocation = destination;
        progress.truckDepartureTime = null;
        user.markModified('richGardenProgress');
        return {
          message: `Truck arrived at the ${destination}!`,
          payload: {
            truckLocation: progress.truckLocation,
            truckDepartureTime: progress.truckDepartureTime
          }
        };
      }
      case 'skipTime': {
        const hours = Number(params.hours) || 0;
        if (hours <= 0) {
          throw new PromoCodeError('Skip hours must be greater than zero');
        }
        fastForwardRichGarden(progress, hours * 3600);
        user.markModified('richGardenProgress');
        return {
          message: `Fast-forwarded Rich Garden by ${hours} hour${hours !== 1 ? 's' : ''}.`,
          payload: {
            garden: progress.garden,
            truckLocation: progress.truckLocation,
            truckDepartureTime: progress.truckDepartureTime
          }
        };
      }
      default:
        throw new PromoCodeError('Unsupported Rich Garden action', { reason: 'unsupported_action' });
    }
  }

  static handleGoldenMine(promo, user) {
    ensureGoldenMineProgress(user);
    const progress = user.goldenMineProgress;
    const params = promo.parameters || {};

    switch (promo.action) {
      case 'addCoins': {
        const amount = Number(params.amount) || 0;
        if (amount <= 0) {
          throw new PromoCodeError('Amount must be greater than zero');
        }
        progress.coins += amount;
        user.markModified('goldenMineProgress');
        return {
          message: `+${amount.toLocaleString()} Golden Mine coins added!`,
          payload: { coins: progress.coins }
        };
      }
      case 'addMine': {
        const mineType = MINE_TYPES[params.mineType] ? params.mineType : 'coal';
        const quantity = normalizePositiveInteger(params.quantity, 1);
        let placed = 0;
        for (let i = 0; i < quantity; i += 1) {
          const slot = progress.mines.findIndex(mine => mine === null);
          if (slot === -1) {
            if (placed === 0) {
              throw new PromoCodeError('No empty mine slots available', { reason: 'no_slots' });
            }
            break;
          }
          progress.mines[slot] = {
            type: mineType,
            workers: 1,
            state: 'producing',
            timeLeft: GOLDEN_MINE_PRODUCTION_TIME,
            lastStateChange: new Date(),
            oreProduced: 0
          };
          placed += 1;
        }
        if (placed === 0) {
          throw new PromoCodeError('Unable to place mine reward', { reason: 'placement_failed' });
        }
        progress.totalMinesOwned = (progress.totalMinesOwned || 0) + placed;
        user.markModified('goldenMineProgress');
        return {
          message: `${placed} ${mineType} mine${placed > 1 ? 's' : ''} deployed!`,
          payload: { mines: progress.mines }
        };
      }
      case 'addWorkers': {
        const quantity = normalizePositiveInteger(params.quantity, 1);
        const mineIndex = Number.isInteger(params.mineIndex)
          ? params.mineIndex
          : progress.mines.findIndex(Boolean);
        if (mineIndex < 0 || mineIndex >= progress.mines.length || !progress.mines[mineIndex]) {
          throw new PromoCodeError('Target mine not found', { reason: 'invalid_mine' });
        }
        const mine = progress.mines[mineIndex];
        const newWorkers = Math.min(GOLDEN_MINE_MAX_WORKERS, mine.workers + quantity);
        if (newWorkers === mine.workers) {
          throw new PromoCodeError('Mine already has maximum workers', { reason: 'max_workers' });
        }
        mine.workers = newWorkers;
        user.markModified('goldenMineProgress');
        return {
          message: `Mine upgraded to ${newWorkers} worker${newWorkers > 1 ? 's' : ''}.`,
          payload: { mines: progress.mines }
        };
      }
      case 'skipMines': {
        progress.mines.forEach(completeMineCycle);
        user.markModified('goldenMineProgress');
        return {
          message: 'All mine cycles completed instantly!',
          payload: { mines: progress.mines }
        };
      }
      case 'skipTruck': {
        progress.truckLocation = progress.truckLocation === 'traveling_to_factory' ? 'factory' : 'mine';
        progress.truckDepartureTime = null;
        user.markModified('goldenMineProgress');
        return {
          message: 'Truck travel finished instantly!',
          payload: {
            truckLocation: progress.truckLocation,
            truckDepartureTime: progress.truckDepartureTime
          }
        };
      }
      default:
        throw new PromoCodeError('Unsupported Golden Mine action', { reason: 'unsupported_action' });
    }
  }

  static handleCatChess(promo, user) {
    ensureCatChessProgress(user);
    const progress = user.catChessProgress;
    const params = promo.parameters || {};

    switch (promo.action) {
      case 'addCoins': {
        const amount = Number(params.amount) || 0;
        if (amount <= 0) {
          throw new PromoCodeError('Amount must be greater than zero');
        }
        progress.coins += amount;
        user.markModified('catChessProgress');
        return {
          message: `+${amount.toLocaleString()} Cat Chess coins added!`,
          payload: { coins: progress.coins }
        };
      }
      case 'addCat': {
        const level = Math.min(MAX_CAT_LEVEL, Math.max(1, Number(params.level) || 1));
        const slot = progress.board.findIndex(cell => cell === null);
        if (slot === -1) {
          throw new PromoCodeError('No empty board cells available', { reason: 'no_slots' });
        }
        const grown = params.grown === true;
        progress.board[slot] = {
          kind: 'cat',
          level,
          timerStart: grown ? null : new Date()
        };
        unlockCatLevels(progress, level);
        user.markModified('catChessProgress');
        return {
          message: `Level ${level} cat added to the board!`,
          payload: {
            board: progress.board,
            unlockedLevels: progress.unlockedLevels
          }
        };
      }
      case 'skipGrowth': {
        const targets = Array.isArray(params.catIds) ? params.catIds : ['all'];
        const ids = new Set(targets.map(value => String(value).toLowerCase()));
        let affected = 0;
        progress.board.forEach(cat => {
          if (!cat || cat.kind !== 'cat') return;
          if (ids.has('all') || (cat.id && ids.has(String(cat.id).toLowerCase()))) {
            cat.timerStart = null;
            affected += 1;
          }
        });
        if (affected === 0) {
          throw new PromoCodeError('No matching cats to grow', { reason: 'no_targets' });
        }
        user.markModified('catChessProgress');
        return {
          message: `Growth skipped for ${affected} cat${affected > 1 ? 's' : ''}.`,
          payload: { board: progress.board }
        };
      }
      case 'addSpecialCurrency': {
        const amount = Number(params.amount) || 0;
        if (amount <= 0) {
          throw new PromoCodeError('Amount must be greater than zero');
        }
        progress.specialCurrency = (progress.specialCurrency || 0) + amount;
        user.markModified('catChessProgress');
        return {
          message: `+${amount} special coin${amount === 1 ? '' : 's'} added!`,
          payload: { specialCurrency: progress.specialCurrency }
        };
      }
      default:
        throw new PromoCodeError('Unsupported Cat Chess action', { reason: 'unsupported_action' });
    }
  }

  static handleFishes(promo, user) {
    ensureFishesProgress(user);
    const progress = user.fishesProgress;
    const params = promo.parameters || {};

    switch (promo.action) {
      case 'addFood': {
        const quantity = normalizePositiveInteger(params.quantity, 1);
        progress.food += quantity;
        user.markModified('fishesProgress');
        return {
          message: `Added ${quantity} fish food!`,
          payload: { food: progress.food }
        };
      }
      case 'addCoins': {
        const amount = Number(params.amount) || 0;
        if (amount <= 0) {
          throw new PromoCodeError('Amount must be greater than zero');
        }
        progress.coins += amount;
        user.markModified('fishesProgress');
        return {
          message: `+${amount.toLocaleString()} aquarium coins added!`,
          payload: { coins: progress.coins }
        };
      }
      case 'addFish': {
        const fishType = FISH_TYPES[params.fishType] ? params.fishType : 'little';
        const quantity = normalizePositiveInteger(params.quantity || 1, 1);
        const fishSlots = progress.fishes;
        let added = 0;
        for (let i = 0; i < quantity; i += 1) {
          if (fishSlots.length >= progress.aquariumSize) {
            break;
          }
          const slot = createFishSlot(fishType, params.level || 1);
          fishSlots.push(slot);
          added += 1;
        }
        if (added === 0) {
          throw new PromoCodeError('Aquarium is full', { reason: 'no_slots' });
        }
        user.markModified('fishesProgress');
        return {
          message: `${added} ${fishType} fish added!`,
          payload: { fishes: progress.fishes }
        };
      }
      case 'clearCooldowns': {
        let affected = 0;
        progress.fishes.forEach(fish => {
          if (fish) {
            fish.cooldownEndsAt = null;
            fish.feedsUsed = 0;
            affected += 1;
          }
        });
        user.markModified('fishesProgress');
        return {
          message: `Cleared cooldowns for ${affected} fish.`,
          payload: { fishes: progress.fishes }
        };
      }
      case 'restockShop': {
        const purchases = typeof progress.shopPurchases?.clear === 'function'
          ? progress.shopPurchases
          : new Map(Object.entries(progress.shopPurchases || {}));
        purchases.clear();
        progress.shopPurchases = purchases;
        const nextRestock = new Date(Date.now() + FISH_SHOP_RESTOCK_SEC * 1000);
        progress.shopRestockAt = nextRestock;
        user.markModified('fishesProgress');
        return {
          message: 'Fish shop restocked and purchase limits reset!',
          payload: {
            shopPurchases: Object.fromEntries(progress.shopPurchases),
            shopRestockAt: progress.shopRestockAt
          }
        };
      }
      default:
        throw new PromoCodeError('Unsupported Fishes action', { reason: 'unsupported_action' });
    }
  }

  static handleGlobal(promo, user) {
    const params = promo.parameters || {};

    switch (promo.action) {
      case 'addLPA': {
        const amount = Number(params.amount) || 0;
        if (amount <= 0) {
          throw new PromoCodeError('Amount must be greater than zero');
        }
        user.lpaBalance = (user.lpaBalance || 0) + amount;
        const trackerResult = EarningsTracker.recordTransaction(user, {
          game: 'global',
          type: 'promo_reward',
          amount,
          currency: 'lpa',
          details: {
            promoId: promo?.id || promo?._id || promo?.name || null,
            action: promo.action
          }
        });
        return {
          message: `+${amount} LPA added to your account!`,
          payload: {
            lpaBalance: user.lpaBalance,
            earningsTracker: trackerResult?.earnings
          }
        };
      }
      case 'addCoinsAllGames': {
        const amount = Number(params.amount) || 0;
        if (amount <= 0) {
          throw new PromoCodeError('Amount must be greater than zero');
        }
        user.coins += amount;
        ensureRichGardenProgress(user);
        ensureGoldenMineProgress(user);
        ensureCatChessProgress(user);
        ensureFishesProgress(user);
        user.richGardenProgress.coins += amount;
        user.goldenMineProgress.coins += amount;
        user.catChessProgress.coins += amount;
        user.fishesProgress.coins += amount;
        user.markModified('richGardenProgress');
        user.markModified('goldenMineProgress');
        user.markModified('catChessProgress');
        user.markModified('fishesProgress');
        return {
          message: `+${amount.toLocaleString()} coins added to every game!`,
          payload: {
            coins: user.coins,
            richGarden: user.richGardenProgress.coins,
            goldenMine: user.goldenMineProgress.coins,
            catChess: user.catChessProgress.coins,
            fishes: user.fishesProgress.coins
          }
        };
      }
      default:
        throw new PromoCodeError('Unsupported global promo action', { reason: 'unsupported_action' });
    }
  }
}
