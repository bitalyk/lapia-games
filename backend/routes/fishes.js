import express from 'express';
import { randomUUID } from 'crypto';
import User from '../models/user.js';
import EarningsTracker from '../services/earnings-tracker.js';

const router = express.Router();

const FAST_MODE = process.env.FAST_MODE === 'true';
const FEED_COOLDOWN_SEC = FAST_MODE ? 30 : 2 * 60 * 60;
const SHOP_RESTOCK_SEC = FAST_MODE ? 60 : 3 * 60 * 60;
const FREE_FOOD_COOLDOWN_SEC = FAST_MODE ? 60 : 24 * 60 * 60;
const FOOD_COST_COINS = 100;
const MAX_AQUARIUM_SIZE = 20;
const MAX_LEVEL = 6;
const MAX_FEEDS_PER_SESSION = 3; // Maximum food units per session before cooldown
const STARTING_FOOD = 10;

const EXPANSION_START_COST = 5000;
const EXPANSION_GROWTH_RATE = 1.25;

const FISH_TYPES = {
	little: {
		key: 'little',
		name: 'Little Fish',
		tier: 1,
		baseCost: 1000,
		foodIncrement: 1,
		multiplierStep: 0.02,
		restockLimit: 3,
		description: 'Reliable starter fish with a gentle growth curve.'
	},
	golden: {
		key: 'golden',
		name: 'Golden Fish',
		tier: 1,
		baseCost: 2500,
		foodIncrement: 1,
		multiplierStep: 0.02,
		restockLimit: 3,
		description: 'Premium tier-one fish with a higher sale ceiling.'
	},
	middle: {
		key: 'middle',
		name: 'Middle Fish',
		tier: 2,
		baseCost: 10000,
		foodIncrement: 2,
		multiplierStep: 0.03,
		restockLimit: 2,
		description: 'Mid-tier fish that thrives with consistent feeding.'
	},
	rainbow: {
		key: 'rainbow',
		name: 'Rainbow Fish',
		tier: 2,
		baseCost: 25000,
		foodIncrement: 2,
		multiplierStep: 0.03,
		restockLimit: 2,
		description: 'Vibrant tier-two fish with strong economy potential.'
	},
	big: {
		key: 'big',
		name: 'Big Fish',
		tier: 3,
		baseCost: 100000,
		foodIncrement: 3,
		multiplierStep: 0.05,
		restockLimit: 1,
		description: 'Large tier-three fish with significant profit margins.'
	},
	scary: {
		key: 'scary',
		name: 'Scary Fish',
		tier: 3,
		baseCost: 500000,
		foodIncrement: 3,
		multiplierStep: 0.05,
		restockLimit: 1,
		description: 'Legendary apex fish prized for maximum returns.'
	}
};

const FISH_TYPE_KEYS = Object.keys(FISH_TYPES);

const DEFAULT_UPGRADE_FLAGS = Object.freeze({
	noStockTimer: false,
	noFeedingLimit: false,
	noAquariumLimit: false
});

function getFishesUpgradeState(user) {
	const upgrades = user?.fishesUpgrades || {};
	const flags = {
		noStockTimer: Boolean(upgrades.noStockTimer),
		noFeedingLimit: Boolean(upgrades.noFeedingLimit),
		noAquariumLimit: Boolean(upgrades.noAquariumLimit)
	};
	return {
		flags,
		feedLimit: flags.noFeedingLimit ? Infinity : MAX_FEEDS_PER_SESSION,
		aquariumLimit: flags.noAquariumLimit ? Infinity : MAX_AQUARIUM_SIZE,
		shopRestockSeconds: flags.noStockTimer ? 0 : SHOP_RESTOCK_SEC
	};
}

function getFishConfig(type) {
	return FISH_TYPES[type] || null;
}

function createFish(type) {
	const config = getFishConfig(type) || FISH_TYPES.little;
	return {
		id: randomUUID(),
		type: config.key,
		level: 1,
		foodConsumed: 0,
		feedProgress: 0,
		feedsUsed: 0,
		lastFedAt: null,
		cooldownEndsAt: null,
		createdAt: new Date()
	};
}

function toPurchaseMap(source) {
	if (!source) {
		return new Map();
	}
	if (source instanceof Map) {
		return source;
	}
	const map = new Map();
	Object.entries(source).forEach(([key, value]) => {
		if (FISH_TYPES[key]) {
			map.set(key, Number.isFinite(value) ? Number(value) : parseInt(value, 10) || 0);
		}
	});
	return map;
}

function mapToPlainObject(map) {
	if (map instanceof Map) {
		const plain = {};
		for (const [key, value] of map.entries()) {
			plain[key] = Number(value) || 0;
		}
		return plain;
	}
	return { ...map };
}

function getFoodRequired(config, currentLevel) {
	if (!config) return Infinity;
	const level = Math.max(1, Math.min(MAX_LEVEL - 1, currentLevel));
	return config.foodIncrement * level;
}

function getLevelMultiplier(config, level) {
	if (!config) return 1;
	const safeLevel = Math.max(1, Math.min(MAX_LEVEL, level));
	return 1 + (safeLevel - 1) * config.multiplierStep;
}

function getRemainingFoodForLevel(fish, config) {
	if (!config || fish.level >= MAX_LEVEL) {
		return 0;
	}
	const progress = Number(fish.feedProgress) || 0;
	const requirement = getFoodRequired(config, fish.level);
	return Math.max(0, requirement - progress);
}

function performFeedAction({ fish, config, progress, amountCap }) {
	if (!config) {
		return { success: false, reason: 'config_missing' };
	}
	if (fish.level >= MAX_LEVEL) {
		return { success: false, reason: 'max_level' };
	}
	const availableFood = Math.floor(Number(progress.food) || 0);
	if (availableFood <= 0) {
		return {
			success: false,
			reason: 'no_food',
			requiredFood: getRemainingFoodForLevel(fish, config) || getFoodRequired(config, fish.level)
		};
	}
	let remaining = getRemainingFoodForLevel(fish, config);
	if (remaining <= 0 && fish.level < MAX_LEVEL) {
		normalizeFishProgress(fish);
		remaining = getRemainingFoodForLevel(fish, config);
	}
	if (fish.level >= MAX_LEVEL) {
		return { success: false, reason: 'max_level' };
	}
	if (remaining <= 0) {
		return { success: false, reason: 'ready_to_level' };
	}
	const cap = Number.isFinite(amountCap) && amountCap > 0 ? Math.floor(amountCap) : remaining;
	const feedAmount = Math.max(0, Math.min(remaining, availableFood, cap));
	if (feedAmount <= 0) {
		return {
			success: false,
			reason: 'no_food',
			requiredFood: remaining
		};
	}
	progress.food -= feedAmount;
	fish.feedProgress = (Number(fish.feedProgress) || 0) + feedAmount;
	fish.foodConsumed = (Number(fish.foodConsumed) || 0) + feedAmount;
	let levelsGained = 0;
	while (fish.level < MAX_LEVEL) {
		const requirement = getFoodRequired(config, fish.level);
		if (fish.feedProgress < requirement) {
			break;
		}
		fish.feedProgress -= requirement;
		fish.level += 1;
		levelsGained += 1;
		if (fish.level >= MAX_LEVEL) {
			fish.feedProgress = 0;
			break;
		}
	}
	const remainingAfter = getRemainingFoodForLevel(fish, config);
	return {
		success: true,
		foodFed: feedAmount,
		levelsGained,
		remainingFood: remainingAfter,
		requiredFood: fish.level >= MAX_LEVEL ? 0 : getFoodRequired(config, fish.level)
	};
}

function normalizeFishProgress(fish) {
	const config = getFishConfig(fish.type);
	if (!config) {
		return false;
	}
	let changed = false;
	let level = Math.max(1, Math.min(MAX_LEVEL, Number(fish.level) || 1));
	let progress = Math.max(0, Number(fish.feedProgress) || 0);

	if (level >= MAX_LEVEL) {
		if (progress !== 0) {
			fish.feedProgress = 0;
			changed = true;
		}
		fish.level = MAX_LEVEL;
		return changed;
	}

	while (level < MAX_LEVEL) {
		const requirement = getFoodRequired(config, level);
		if (progress < requirement) {
			break;
		}
		progress -= requirement;
		level += 1;
		changed = true;
		if (level >= MAX_LEVEL) {
			progress = 0;
			break;
		}
	}

	if (level !== fish.level) {
		fish.level = level;
		changed = true;
	}
	if (progress !== fish.feedProgress) {
		fish.feedProgress = progress;
		changed = true;
	}

	return changed;
}

function calculateSellValue(fish) {
	const config = getFishConfig(fish.type);
	if (!config) return 0;
	const baseCost = config.baseCost;
	const foodValue = (fish.foodConsumed || 0) * FOOD_COST_COINS;
	const multiplier = getLevelMultiplier(config, fish.level);
	return Math.round((baseCost + foodValue) * multiplier);
}

function getExpansionCost(currentSize, { maxSize = MAX_AQUARIUM_SIZE } = {}) {
	if (Number.isFinite(maxSize) && currentSize >= maxSize) {
		return null;
	}
	const steps = Math.max(0, currentSize - 1);
	const rawCost = EXPANSION_START_COST * Math.pow(EXPANSION_GROWTH_RATE, steps);
	return Math.ceil(rawCost / 100) * 100;
}

function applyShopRestock(progress, now, upgradeState = null) {
	let modified = false;
	const previous = progress.shopPurchases;
	progress.shopPurchases = toPurchaseMap(progress.shopPurchases);
	if (!(previous instanceof Map)) {
		modified = true;
	}

	const unlimitedStock = Boolean(upgradeState?.flags?.noStockTimer);
	const restockSeconds = upgradeState?.shopRestockSeconds ?? SHOP_RESTOCK_SEC;

	if (unlimitedStock) {
		if (progress.shopPurchases.size > 0) {
			progress.shopPurchases = new Map();
			modified = true;
		}
		if (progress.shopRestockAt !== null) {
			progress.shopRestockAt = null;
			modified = true;
		}
		return modified;
	}

	const currentRestock = progress.shopRestockAt ? new Date(progress.shopRestockAt) : null;
	if (!currentRestock || Number.isNaN(currentRestock.getTime()) || now >= currentRestock) {
		progress.shopPurchases = new Map();
		progress.shopRestockAt = new Date(now.getTime() + restockSeconds * 1000);
		modified = true;
	} else {
		progress.shopRestockAt = currentRestock;
	}

	return modified;
}

function refreshFishCooldowns(progress, now, upgradeState = null) {
	let modified = false;
	const unlimitedFeeding = Boolean(upgradeState?.flags?.noFeedingLimit);
	const feedLimit = upgradeState?.feedLimit ?? MAX_FEEDS_PER_SESSION;
	for (const fish of progress.fishes) {
		if (!fish) continue;
		if (unlimitedFeeding) {
			if (fish.cooldownEndsAt) {
				fish.cooldownEndsAt = null;
				modified = true;
			}
			if (fish.feedsUsed !== 0) {
				fish.feedsUsed = 0;
				modified = true;
			}
		} else if (fish.cooldownEndsAt) {
			const cooldown = new Date(fish.cooldownEndsAt);
			if (Number.isNaN(cooldown.getTime()) || now >= cooldown) {
				fish.cooldownEndsAt = null;
				fish.feedsUsed = 0;
				modified = true;
			} else {
				fish.cooldownEndsAt = cooldown;
			}
		}
		if (!unlimitedFeeding) {
			fish.feedsUsed = Math.max(0, Math.min(feedLimit, Math.floor(Number(fish.feedsUsed) || 0)));
		}
		if (fish.lastFedAt) {
			fish.lastFedAt = new Date(fish.lastFedAt);
		}
		if (fish.createdAt) {
			fish.createdAt = new Date(fish.createdAt);
		}
	}
	return modified;
}

function ensureFishesProgress(user, upgradeState = null) {
	let modified = false;
	const effectiveUpgradeState = upgradeState || getFishesUpgradeState(user);
	const aquariumLimit = effectiveUpgradeState?.aquariumLimit ?? MAX_AQUARIUM_SIZE;
	const restockSeconds = effectiveUpgradeState?.shopRestockSeconds ?? SHOP_RESTOCK_SEC;
	const initialRestockAt = restockSeconds > 0 ? new Date(Date.now() + restockSeconds * 1000) : null;

	if (!user.fishesProgress) {
		user.fishesProgress = {
			coins: 1000,
			food: STARTING_FOOD,
			aquariumSize: 1,
			fishes: [createFish('little')],
			shopPurchases: new Map(),
			shopRestockAt: initialRestockAt,
			lastFreeFoodAt: null
		};
		return true;
	}

	const progress = user.fishesProgress;

	if (!Array.isArray(progress.fishes)) {
		progress.fishes = [];
		modified = true;
	}

	const repaired = [];
	for (const item of progress.fishes) {
		if (!item || !getFishConfig(item.type)) {
			modified = true;
			continue;
		}
		const fixed = {
			id: item.id || randomUUID(),
			type: getFishConfig(item.type).key,
			level: Math.max(1, Math.min(MAX_LEVEL, Number(item.level) || 1)),
			foodConsumed: Math.max(0, Number(item.foodConsumed) || 0),
			feedProgress: Math.max(0, Number(item.feedProgress) || 0),
			feedsUsed: Math.max(0, Math.min(MAX_FEEDS_PER_SESSION, Math.floor(Number(item.feedsUsed) || 0))),
			lastFedAt: item.lastFedAt ? new Date(item.lastFedAt) : null,
			cooldownEndsAt: item.cooldownEndsAt ? new Date(item.cooldownEndsAt) : null,
			createdAt: item.createdAt ? new Date(item.createdAt) : new Date()
		};

		if (normalizeFishProgress(fixed)) {
			modified = true;
		}
		repaired.push(fixed);
	}

	progress.fishes = repaired;

	const normalizedSize = Number(progress.aquariumSize) || 1;
	const upperBound = Number.isFinite(aquariumLimit) ? aquariumLimit : Infinity;
	progress.aquariumSize = Math.max(1, Math.min(upperBound, normalizedSize));
	if (progress.fishes.length > progress.aquariumSize) {
		progress.fishes = progress.fishes.slice(0, progress.aquariumSize);
		modified = true;
	}

	const coins = Number(progress.coins);
	progress.coins = Number.isFinite(coins) && coins >= 0 ? coins : 0;

	const food = Number(progress.food);
	progress.food = Number.isFinite(food) && food >= 0 ? food : STARTING_FOOD;

	const originalPurchases = progress.shopPurchases;
	progress.shopPurchases = toPurchaseMap(progress.shopPurchases);
	if (!(originalPurchases instanceof Map)) {
		modified = true;
	}

	if (!progress.shopRestockAt || Number.isNaN(new Date(progress.shopRestockAt).getTime())) {
		progress.shopRestockAt = restockSeconds > 0 ? new Date(Date.now() + restockSeconds * 1000) : null;
		modified = true;
	} else {
		progress.shopRestockAt = new Date(progress.shopRestockAt);
	}

	if (progress.lastFreeFoodAt) {
		progress.lastFreeFoodAt = new Date(progress.lastFreeFoodAt);
	}


	return modified;
}

function buildFishView(fish, now, upgradeState = null) {
	const config = getFishConfig(fish.type);
	const unlimitedFeeding = Boolean(upgradeState?.flags?.noFeedingLimit);
	const feedLimit = upgradeState?.feedLimit ?? MAX_FEEDS_PER_SESSION;
	const cooldownDuration = fish.cooldownEndsAt
		? Math.max(0, Math.floor((new Date(fish.cooldownEndsAt).getTime() - now.getTime()) / 1000))
		: 0;
	const cooldownRemaining = unlimitedFeeding ? 0 : cooldownDuration;
	const feedProgress = Number(fish.feedProgress) || 0;
	const feedsUsed = unlimitedFeeding ? 0 : Number(fish.feedsUsed) || 0;
	const requirement = fish.level >= MAX_LEVEL ? 0 : getFoodRequired(config, fish.level);
	const remainingFood = fish.level >= MAX_LEVEL ? 0 : Math.max(0, requirement - feedProgress);
	const sessionFeedsRemaining = unlimitedFeeding ? null : Math.max(0, feedLimit - feedsUsed);
	const nextLevelCost = fish.level >= MAX_LEVEL
		? null
		: {
			requiredFoodTotal: requirement,
			food: requirement,
			coins: requirement * FOOD_COST_COINS,
			remainingFood,
			coinsRemaining: remainingFood * FOOD_COST_COINS
		};

	return {
		id: fish.id,
		type: fish.type,
		name: config?.name ?? fish.type,
		tier: config?.tier ?? 1,
		level: fish.level,
		maxLevel: MAX_LEVEL,
		foodConsumed: fish.foodConsumed || 0,
		cooldownRemaining,
		canFeed: cooldownRemaining === 0 && fish.level < MAX_LEVEL && remainingFood > 0 && (unlimitedFeeding || sessionFeedsRemaining > 0),
		nextLevelCost,
		potentialSellValue: fish.level > 1 ? calculateSellValue(fish) : null,
		createdAt: fish.createdAt ? new Date(fish.createdAt).toISOString() : null,
		feedProgress,
		remainingFoodForLevel: remainingFood,
		requiredFoodForLevel: requirement,
		sessionFeedsUsed: unlimitedFeeding ? null : feedsUsed,
		sessionFeedsRemaining,
		maxFeedsPerSession: unlimitedFeeding ? null : feedLimit
	};
}

function buildShopPayload(progress, now, upgradeState = null) {
	const unlimitedStock = Boolean(upgradeState?.flags?.noStockTimer);
	const restockAt = unlimitedStock ? null : progress.shopRestockAt ? new Date(progress.shopRestockAt) : null;
	const secondsUntilRestock = unlimitedStock
		? 0
		: restockAt
			? Math.max(0, Math.floor((restockAt.getTime() - now.getTime()) / 1000))
			: 0;

	const purchases = progress.shopPurchases instanceof Map
		? progress.shopPurchases
		: toPurchaseMap(progress.shopPurchases);

	const catalog = {};
	for (const [key, config] of Object.entries(FISH_TYPES)) {
		const bought = Number(purchases.get(key) || 0);
		const restockLimit = unlimitedStock ? null : config.restockLimit;
		const available = unlimitedStock ? null : Math.max(0, config.restockLimit - bought);
		catalog[key] = {
			key,
			name: config.name,
			tier: config.tier,
			baseCost: config.baseCost,
			restockLimit,
			purchased: unlimitedStock ? 0 : bought,
			available,
			description: config.description,
			unlimitedStock
		};
	}

	return {
		restockAt: restockAt ? restockAt.toISOString() : null,
		secondsUntilRestock,
		purchases: mapToPlainObject(purchases),
		catalog
	};
}

function buildFreeFoodPayload(progress, now) {
	const lastClaim = progress.lastFreeFoodAt ? new Date(progress.lastFreeFoodAt) : null;
	if (!lastClaim || Number.isNaN(lastClaim.getTime())) {
		return {
			available: true,
			secondsRemaining: 0,
			amount: 10,
			lastClaimedAt: null
		};
	}

	const elapsed = Math.floor((now.getTime() - lastClaim.getTime()) / 1000);
	const remaining = Math.max(0, FREE_FOOD_COOLDOWN_SEC - elapsed);

	return {
		available: remaining === 0,
		secondsRemaining: remaining,
		amount: 10,
		lastClaimedAt: lastClaim.toISOString()
	};
}

function buildStatusPayload(progress, options = {}) {
	const now = options.now || new Date();
	const upgradeState = options.upgradeState || null;
	const aquariumLimit = upgradeState?.aquariumLimit ?? MAX_AQUARIUM_SIZE;
	const finiteAquariumLimit = Number.isFinite(aquariumLimit) ? aquariumLimit : null;
	const canGrowAquarium = (Number.isFinite(aquariumLimit) ? progress.aquariumSize < aquariumLimit : true)
		&& progress.fishes.length >= progress.aquariumSize;
	const feedLimit = upgradeState?.feedLimit ?? MAX_FEEDS_PER_SESSION;

	return {
		success: true,
		coins: progress.coins,
		food: progress.food,
		aquarium: {
			size: progress.aquariumSize,
			maxSize: finiteAquariumLimit,
			canExpand: canGrowAquarium,
			nextExpansionCost: getExpansionCost(progress.aquariumSize, { maxSize: aquariumLimit })
		},
		fishes: progress.fishes.map((fish) => buildFishView(fish, now, upgradeState)),
		shop: buildShopPayload(progress, now, upgradeState),
		freeFood: buildFreeFoodPayload(progress, now),
		timers: {
			feedCooldown: FEED_COOLDOWN_SEC,
			shopRestock: upgradeState?.shopRestockSeconds ?? SHOP_RESTOCK_SEC,
			freeFood: FREE_FOOD_COOLDOWN_SEC
		},
		limits: {
			feedPerSession: Number.isFinite(feedLimit) ? feedLimit : null,
			aquariumMaxSize: finiteAquariumLimit,
			shopRestockSeconds: upgradeState?.shopRestockSeconds ?? SHOP_RESTOCK_SEC
		},
		upgrades: upgradeState?.flags || { ...DEFAULT_UPGRADE_FLAGS },
		metrics: {
			totalFish: progress.fishes.length,
			occupiedSlots: progress.fishes.length,
			capacity: progress.aquariumSize
		},
		...(options.extra || {})
	};
}

function findFishIndex(progress, fishId) {
	return progress.fishes.findIndex((fish) => fish && fish.id === fishId);
}

async function getUser(username) {
	return await User.findByUsername(username);
}

// Status endpoint
router.get('/status/:username', async (req, res) => {
	try {
		const { username } = req.params;
		const user = await getUser(username);
		if (!user) {
			return res.status(404).json({ error: 'User not found' });
		}

		const now = new Date();
		const upgradeState = getFishesUpgradeState(user);
		let modified = ensureFishesProgress(user, upgradeState);
		modified = applyShopRestock(user.fishesProgress, now, upgradeState) || modified;
		modified = refreshFishCooldowns(user.fishesProgress, now, upgradeState) || modified;

		if (modified) {
			user.markModified('fishesProgress');
			await user.save();
		}

		return res.json(buildStatusPayload(user.fishesProgress, { now, upgradeState }));
	} catch (error) {
		console.error('Fishes status error:', error);
		return res.status(500).json({ error: 'Server error' });
	}
});

// Feed fish
router.post('/feed', async (req, res) => {
	try {
		const { username, fishId, feedCount = 1 } = req.body;

		if (!username || !fishId) {
			return res.status(400).json({ error: 'Missing username or fishId' });
		}

		const user = await getUser(username);
		if (!user) {
			return res.status(404).json({ error: 'User not found' });
		}

		const now = new Date();
		const upgradeState = getFishesUpgradeState(user);
		const unlimitedFeeding = Boolean(upgradeState.flags.noFeedingLimit);
		const feedLimit = upgradeState.feedLimit;
		ensureFishesProgress(user, upgradeState);
		applyShopRestock(user.fishesProgress, now, upgradeState);
		refreshFishCooldowns(user.fishesProgress, now, upgradeState);

		const progress = user.fishesProgress;
		const index = findFishIndex(progress, fishId);
		if (index === -1) {
			return res.status(404).json({ error: 'Fish not found' });
		}

		const fish = progress.fishes[index];
		const config = getFishConfig(fish.type);
		if (!config) {
			progress.fishes.splice(index, 1);
			user.markModified('fishesProgress');
			await user.save();
			return res.status(404).json({ error: 'Fish configuration missing' });
		}

		if (fish.level >= MAX_LEVEL) {
			return res.status(400).json({ error: 'Fish is already at max level' });
		}

		if (fish.cooldownEndsAt) {
			const cooldown = new Date(fish.cooldownEndsAt);
			const remaining = Math.max(0, Math.floor((cooldown.getTime() - now.getTime()) / 1000));
			if (remaining > 0) {
				return res.status(400).json({ error: 'Fish is cooling down', cooldownRemaining: remaining });
			}
		}

		const normalized = normalizeFishProgress(fish);
		if (fish.level >= MAX_LEVEL) {
			if (normalized) {
				user.markModified('fishesProgress');
				await user.save();
			}
			return res.status(400).json({ error: 'Fish is already at max level' });
		}

		let feedsUsed = unlimitedFeeding ? 0 : Math.max(0, Number(fish.feedsUsed) || 0);
		let sessionRemaining = unlimitedFeeding ? Infinity : Math.max(0, feedLimit - feedsUsed);
		if (!unlimitedFeeding && sessionRemaining <= 0) {
			return res.status(400).json({ error: 'Fish needs to rest before feeding again.' });
		}

		const hasFoodAmount = req.body.foodAmount !== undefined && req.body.foodAmount !== null;
		let totalFoodFed = 0;
		let totalLevelsGained = 0;
		let feedsPerformed = 0;
		let cooldownStarted = false;
		let stateChanged = normalized;
		let finalError = null;

		if (hasFoodAmount) {
			const requestedAmountRaw = Number(req.body.foodAmount);
			const requestedAmount = Math.max(1, Math.floor(Number.isFinite(requestedAmountRaw) ? requestedAmountRaw : 1));
			if (requestedAmount <= 0) {
				return res.status(400).json({ error: 'Specify a positive amount of food to feed.' });
			}
			const allowedAmount = unlimitedFeeding ? requestedAmount : Math.min(requestedAmount, sessionRemaining);
			if (allowedAmount <= 0) {
				return res.status(400).json({ error: 'Feed limit reached. Wait for cooldown.' });
			}
			const actionResult = performFeedAction({ fish, config, progress, amountCap: unlimitedFeeding ? undefined : allowedAmount });
			if (!actionResult.success) {
				finalError = actionResult;
			} else {
				const fedUnits = Math.max(0, Math.floor(actionResult.foodFed || 0));
				totalFoodFed += fedUnits;
				totalLevelsGained += actionResult.levelsGained;
				feedsPerformed += 1;
				if (!unlimitedFeeding) {
					feedsUsed = Math.min(feedLimit, feedsUsed + fedUnits);
					fish.feedsUsed = feedsUsed;
					sessionRemaining = Math.max(0, feedLimit - feedsUsed);
				}
				stateChanged = true;
			}
		} else {
			const sanitizedFeedCount = Math.max(1, Math.min(MAX_FEEDS_PER_SESSION, Math.floor(feedCount)));
			let actionsRemaining = sanitizedFeedCount;
			while (actionsRemaining > 0 && (unlimitedFeeding || sessionRemaining > 0)) {
				const actionResult = performFeedAction({ fish, config, progress, amountCap: unlimitedFeeding ? undefined : sessionRemaining });
				if (!actionResult.success) {
					finalError = actionResult;
					break;
				}
				const fedUnits = Math.max(0, Math.floor(actionResult.foodFed || 0));
				totalFoodFed += fedUnits;
				totalLevelsGained += actionResult.levelsGained;
				feedsPerformed += 1;
				if (!unlimitedFeeding) {
					feedsUsed = Math.min(feedLimit, feedsUsed + fedUnits);
					fish.feedsUsed = feedsUsed;
				}
				stateChanged = true;
				sessionRemaining = unlimitedFeeding ? Infinity : Math.max(0, feedLimit - feedsUsed);
				actionsRemaining -= 1;
				if (fish.level >= MAX_LEVEL || (!unlimitedFeeding && feedsUsed >= feedLimit)) {
					break;
				}
			}
		}

		if (feedsPerformed === 0) {
			if (finalError?.reason === 'max_level') {
				if (stateChanged) {
					user.markModified('fishesProgress');
					await user.save();
				}
				return res.status(400).json({ error: 'Fish is already at max level' });
			}
			if (finalError?.reason === 'ready_to_level') {
				if (stateChanged) {
					user.markModified('fishesProgress');
					await user.save();
				}
				return res.status(400).json({ error: 'Fish is already ready to level up. Try again in a moment.' });
			}
			if (finalError?.reason === 'no_food') {
				if (stateChanged) {
					user.markModified('fishesProgress');
					await user.save();
				}
				return res.status(400).json({ error: 'Not enough food to feed', requiredFood: finalError.requiredFood });
			}
			if (finalError?.reason === 'config_missing') {
				return res.status(500).json({ error: 'Fish configuration missing' });
			}
			if (stateChanged) {
				user.markModified('fishesProgress');
				await user.save();
			}
			return res.status(400).json({ error: 'Unable to feed fish right now.' });
		}

		fish.lastFedAt = now;
		if (fish.level >= MAX_LEVEL) {
			fish.cooldownEndsAt = null;
			fish.feedProgress = 0;
			fish.feedsUsed = 0;
			feedsUsed = 0;
		} else if (!unlimitedFeeding && feedsUsed >= feedLimit) {
			fish.cooldownEndsAt = new Date(now.getTime() + FEED_COOLDOWN_SEC * 1000);
			cooldownStarted = true;
		} else {
			fish.cooldownEndsAt = null;
		}

		sessionRemaining = unlimitedFeeding ? Infinity : Math.max(0, feedLimit - feedsUsed);
		stateChanged = true;

		user.markModified('fishesProgress');
		await user.save();

		const responseSessionRemaining = unlimitedFeeding ? null : sessionRemaining;
		return res.json(buildStatusPayload(progress, {
			now,
			upgradeState,
			extra: {
				feedResult: {
					foodFed: totalFoodFed,
					levelsGained: totalLevelsGained,
					feedsPerformed,
					newLevel: fish.level,
					feedProgress: fish.feedProgress,
					sessionFeedsUsed: unlimitedFeeding ? null : feedsUsed,
					sessionFeedsRemaining: responseSessionRemaining,
					cooldownStarted,
					cooldownEndsAt: fish.cooldownEndsAt ? fish.cooldownEndsAt.toISOString() : null
				},
				message: `Fed ${config.name} with ${totalFoodFed} food${totalLevelsGained > 0 ? ' and it leveled up!' : '.'}`
			}
		}));
	} catch (error) {
		console.error('Fishes feed error:', error);
		return res.status(500).json({ error: 'Server error' });
	}
});

// Buy fish
router.post('/buy', async (req, res) => {
	try {
		const { username, fishType } = req.body;

		if (!username || !fishType) {
			return res.status(400).json({ error: 'Missing username or fishType' });
		}

		const user = await getUser(username);
		if (!user) {
			return res.status(404).json({ error: 'User not found' });
		}

		const now = new Date();
		const upgradeState = getFishesUpgradeState(user);
		ensureFishesProgress(user, upgradeState);
		applyShopRestock(user.fishesProgress, now, upgradeState);
		refreshFishCooldowns(user.fishesProgress, now, upgradeState);

		const progress = user.fishesProgress;
		const config = getFishConfig(fishType);
		if (!config) {
			return res.status(400).json({ error: 'Unknown fish type' });
		}

		if (progress.fishes.length >= progress.aquariumSize) {
			return res.status(400).json({ error: 'Aquarium is full. Expand to add more fish.' });
		}

		const purchases = progress.shopPurchases instanceof Map
			? progress.shopPurchases
			: toPurchaseMap(progress.shopPurchases);

		const unlimitedStock = Boolean(upgradeState.flags.noStockTimer);
		const bought = Number(purchases.get(config.key) || 0);
		if (!unlimitedStock && bought >= config.restockLimit) {
			return res.status(400).json({ error: 'Purchase limit reached for this fish type until restock.' });
		}

		if (progress.coins < config.baseCost) {
			return res.status(400).json({ error: 'Not enough coins to buy this fish.' });
		}

		progress.coins -= config.baseCost;
		progress.fishes.push(createFish(config.key));
		purchases.set(config.key, bought + 1);
		progress.shopPurchases = purchases;

		user.markModified('fishesProgress');
		await user.save();

		return res.json(buildStatusPayload(progress, {
			now,
			upgradeState,
			extra: {
				message: `${config.name} added to the aquarium.`
			}
		}));
	} catch (error) {
		console.error('Fishes buy error:', error);
		return res.status(500).json({ error: 'Server error' });
	}
});

// Sell fish
router.post('/sell', async (req, res) => {
	try {
		const { username, fishId } = req.body;
		if (!username || !fishId) {
			return res.status(400).json({ error: 'Missing username or fishId' });
		}

		const user = await getUser(username);
		if (!user) {
			return res.status(404).json({ error: 'User not found' });
		}

		const now = new Date();
		const upgradeState = getFishesUpgradeState(user);
		ensureFishesProgress(user, upgradeState);
		applyShopRestock(user.fishesProgress, now, upgradeState);
		refreshFishCooldowns(user.fishesProgress, now, upgradeState);

		const progress = user.fishesProgress;
		const index = findFishIndex(progress, fishId);
		if (index === -1) {
			return res.status(404).json({ error: 'Fish not found' });
		}

		const fish = progress.fishes[index];
		const config = getFishConfig(fish.type);
		if (!config) {
			progress.fishes.splice(index, 1);
			user.markModified('fishesProgress');
			await user.save();
			return res.status(404).json({ error: 'Fish configuration missing' });
		}

		if (fish.level <= 1) {
			return res.status(400).json({ error: 'Fish must reach level 2 before it can be sold.' });
		}

		const sellValue = calculateSellValue(fish);
		progress.coins += sellValue;
		progress.fishes.splice(index, 1);

		const trackerResult = EarningsTracker.recordTransaction(user, {
			game: 'fishes',
			type: 'sell',
			amount: sellValue,
			currency: 'game_coin',
			details: {
				fishType: config.key,
				level: fish.level,
				foodConsumed: fish.foodConsumed
			}
		});

		user.markModified('fishesProgress');
		await user.save();

		const payload = buildStatusPayload(progress, {
			now,
			upgradeState,
			extra: {
				sale: {
					fishType: config.key,
					coinsEarned: sellValue
				},
				message: `${config.name} sold for ${sellValue.toLocaleString()} coins.`
			}
		});

		if (trackerResult) {
			payload.earningsTracker = trackerResult.earnings;
			payload.unlockedAchievements = trackerResult.unlockedAchievements;
		}

		return res.json(payload);
	} catch (error) {
		console.error('Fishes sell error:', error);
		return res.status(500).json({ error: 'Server error' });
	}
});

// Expand aquarium
router.post('/expand', async (req, res) => {
	try {
		const { username } = req.body;
		if (!username) {
			return res.status(400).json({ error: 'Missing username' });
		}

		const user = await getUser(username);
		if (!user) {
			return res.status(404).json({ error: 'User not found' });
		}

		const now = new Date();
		const upgradeState = getFishesUpgradeState(user);
		ensureFishesProgress(user, upgradeState);
		applyShopRestock(user.fishesProgress, now, upgradeState);
		refreshFishCooldowns(user.fishesProgress, now, upgradeState);

		const progress = user.fishesProgress;
 		const aquariumLimit = upgradeState.aquariumLimit ?? MAX_AQUARIUM_SIZE;

		if (Number.isFinite(aquariumLimit) && progress.aquariumSize >= aquariumLimit) {
			return res.status(400).json({ error: 'Aquarium is already at maximum capacity.' });
		}

		if (progress.fishes.length < progress.aquariumSize) {
			return res.status(400).json({ error: 'Fill all current slots before expanding the aquarium.' });
		}

		const cost = getExpansionCost(progress.aquariumSize, { maxSize: aquariumLimit });
		if (cost === null) {
			return res.status(400).json({ error: 'Aquarium cannot be expanded further.' });
		}

		if (progress.coins < cost) {
			return res.status(400).json({ error: 'Not enough coins to expand the aquarium.', requiredCoins: cost });
		}

		progress.coins -= cost;
		progress.aquariumSize += 1;

		user.markModified('fishesProgress');
		await user.save();

		return res.json(buildStatusPayload(progress, {
			now,
			upgradeState,
			extra: {
				message: `Aquarium expanded to ${progress.aquariumSize} slots.`
			}
		}));
	} catch (error) {
		console.error('Fishes expand error:', error);
		return res.status(500).json({ error: 'Server error' });
	}
});

// Buy food
router.post('/buy_food', async (req, res) => {
	try {
		const { username, amount } = req.body;
		if (!username || amount === undefined) {
			return res.status(400).json({ error: 'Missing username or amount' });
		}

		const quantity = Math.max(1, Math.floor(Number(amount)));

		const user = await getUser(username);
		if (!user) {
			return res.status(404).json({ error: 'User not found' });
		}

		const now = new Date();
		const upgradeState = getFishesUpgradeState(user);
		ensureFishesProgress(user, upgradeState);
		applyShopRestock(user.fishesProgress, now, upgradeState);
		refreshFishCooldowns(user.fishesProgress, now, upgradeState);

		const progress = user.fishesProgress;
		const cost = quantity * FOOD_COST_COINS;

		if (progress.coins < cost) {
			return res.status(400).json({ error: 'Not enough coins to buy food.', requiredCoins: cost });
		}

		progress.coins -= cost;
		progress.food += quantity;

		user.markModified('fishesProgress');
		await user.save();

		return res.json(buildStatusPayload(progress, {
			now,
			upgradeState,
			extra: {
				message: `Purchased ${quantity} food for ${cost.toLocaleString()} coins.`
			}
		}));
	} catch (error) {
		console.error('Fishes buy food error:', error);
		return res.status(500).json({ error: 'Server error' });
	}
});

// Collect free food
router.post('/collect_free_food', async (req, res) => {
	try {
		const { username } = req.body;
		if (!username) {
			return res.status(400).json({ error: 'Missing username' });
		}

		const user = await getUser(username);
		if (!user) {
			return res.status(404).json({ error: 'User not found' });
		}

		const now = new Date();
		const upgradeState = getFishesUpgradeState(user);
		ensureFishesProgress(user, upgradeState);
		applyShopRestock(user.fishesProgress, now, upgradeState);
		refreshFishCooldowns(user.fishesProgress, now, upgradeState);

		const progress = user.fishesProgress;
		const freeFoodInfo = buildFreeFoodPayload(progress, now);

		if (!freeFoodInfo.available) {
			return res.status(400).json({ error: 'Free food not ready yet.', secondsRemaining: freeFoodInfo.secondsRemaining });
		}

		progress.food += freeFoodInfo.amount;
		progress.lastFreeFoodAt = now;

		user.markModified('fishesProgress');
		await user.save();

		return res.json(buildStatusPayload(progress, {
			now,
			upgradeState,
			extra: {
				message: `Collected ${freeFoodInfo.amount} free food.`
			}
		}));
	} catch (error) {
		console.error('Fishes free food error:', error);
		return res.status(500).json({ error: 'Server error' });
	}
});

export default router;
