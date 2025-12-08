import express from 'express';
import User from '../models/user.js';

const router = express.Router();

// Tree configuration
const TREE_TYPES = {
    common: { cost: 1000, fps: 1, fruitsPerCoin: 100, level: 1, name: "Common Tree" },
    bronze: { cost: 2500, fps: 2, fruitsPerCoin: 80, level: 2, name: "Bronze Tree" },
    silver: { cost: 10000, fps: 5, fruitsPerCoin: 50, level: 3, name: "Silver Tree" },
    golden: { cost: 25000, fps: 10, fruitsPerCoin: 40, level: 4, name: "Golden Tree" },
    platinum: { cost: 100000, fps: 20, fruitsPerCoin: 20, level: 5, name: "Platinum Tree" },
    diamond: { cost: 500000, fps: 50, fruitsPerCoin: 10, level: 6, name: "Diamond Tree" }
};

const GARDEN_SIZE = 10;

// Production constants
const PRODUCTION_TIME = process.env.FAST_MODE === 'true' ? 30 : 4 * 60 * 60; // 30s testing / 4h normal
const COLLECTION_TIME = process.env.FAST_MODE === 'true' ? 15 : 30 * 60; // 15s testing / 30min normal
const TRUCK_TRAVEL_TIME = process.env.FAST_MODE === 'true' ? 10 : 60 * 60; // legacy constant
const PREMIUM_TRUCK_TRAVEL_TIME = process.env.FAST_MODE === 'true' ? 3 : 5 * 60;

function getTruckTravelTime(user) {
    if (user?.richGardenUpgrades?.helicopterTransport) {
        return PREMIUM_TRUCK_TRAVEL_TIME;
    }
    return TRUCK_TRAVEL_TIME;
}

function hasGardenAutoCollect(user) {
    return Boolean(user?.richGardenUpgrades?.autoCollect);
}

function getPremiumUnlockLevel(user) {
    return Number(user?.richGardenUpgrades?.premiumUnlockLevel) || 0;
}

function getTimingConfig() {
    return {
        production: PRODUCTION_TIME,
        collection: COLLECTION_TIME,
        truckTravel: TRUCK_TRAVEL_TIME
    };
}

function ensureDate(value) {
    return value ? new Date(value) : null;
}

function buildTreeView(tree, now = new Date()) {
    if (!tree) return null;

    const plantedAt = ensureDate(tree.plantedAt);
    const collectionStart = ensureDate(tree.collectionStartTime);
    const baseState = tree.state || 'producing';

    let phase = baseState;
    let secondsRemaining = 0;
    let secondsElapsed = 0;

    if (baseState === 'collecting' && collectionStart) {
        secondsElapsed = Math.max(0, Math.floor((now - collectionStart) / 1000));
        const remaining = COLLECTION_TIME - secondsElapsed;
        if (remaining > 0) {
            secondsRemaining = remaining;
            phase = 'collecting';
        } else {
            secondsElapsed = COLLECTION_TIME;
            secondsRemaining = 0;
            phase = 'ready';
        }
    } else {
        secondsElapsed = plantedAt ? Math.max(0, Math.floor((now - plantedAt) / 1000)) : 0;
        const remaining = PRODUCTION_TIME - secondsElapsed;
        if (remaining > 0) {
            secondsRemaining = remaining;
            phase = 'producing';
        } else {
            secondsElapsed = Math.max(secondsElapsed, PRODUCTION_TIME);
            secondsRemaining = 0;
            phase = 'ready';
        }
    }

    return {
        type: tree.type,
        state: baseState,
        phase,
        plantedAt: plantedAt ? plantedAt.toISOString() : null,
        collectionStartTime: collectionStart ? collectionStart.toISOString() : null,
        secondsRemaining,
        secondsElapsed,
        level: TREE_TYPES[tree.type]?.level ?? null
    };
}

function buildGardenView(garden = [], now = new Date()) {
    const view = [];
    for (let i = 0; i < GARDEN_SIZE; i += 1) {
        const tree = garden[i] ?? null;
        view.push(tree ? buildTreeView(tree, now) : null);
    }
    return view;
}

function buildTruckView(progress = {}, now = new Date(), options = {}) {
    const rawLocation = progress.truckLocation || 'farm';
    const departureTime = ensureDate(progress.truckDepartureTime);
    const traveling = rawLocation === 'traveling_to_city' || rawLocation === 'traveling_to_farm';
    const travelTarget = typeof options.travelTime === 'number' ? options.travelTime : TRUCK_TRAVEL_TIME;

    let secondsRemaining = 0;
    if (traveling && departureTime) {
        const elapsed = Math.floor((now - departureTime) / 1000);
        secondsRemaining = Math.max(0, travelTarget - elapsed);
    }

    let location = rawLocation;
    if (traveling && secondsRemaining === 0) {
        location = rawLocation === 'traveling_to_city' ? 'city' : 'farm';
    }

    return {
        location,
        rawLocation,
        isTraveling: traveling && secondsRemaining > 0,
        secondsRemaining,
        departureTime: departureTime ? departureTime.toISOString() : null
    };
}

function buildGamePayload(progress = {}, options = {}) {
    const now = options.now || new Date();
    const autoCollect = Boolean(options.autoCollect);
    const travelTime = typeof options.travelTime === 'number' ? options.travelTime : TRUCK_TRAVEL_TIME;
    const gardenView = buildGardenView(progress.garden || [], now);
    const truckView = buildTruckView(progress, now, { travelTime });
    const inventorySource = progress.inventory || {};
    const inventory = typeof inventorySource.toObject === 'function'
        ? inventorySource.toObject()
        : { ...inventorySource };

    const truckInventorySource = progress.truckInventory || {};
    const truckInventory = typeof truckInventorySource.toObject === 'function'
        ? truckInventorySource.toObject()
        : { ...truckInventorySource };

    const truck = {
        ...truckView,
        cargo: truckInventory
    };

    return {
        success: true,
        coins: progress.coins ?? 0,
        garden: gardenView,
        inventory,
        truckInventory,
        truck,
        truckLocation: truck.location,
        truckDepartureTime: truck.departureTime,
        timers: {
            ...getTimingConfig(),
            truckTravel: travelTime
        },
        treeTypes: TREE_TYPES,
        upgrades: {
            autoCollect
        },
        ...options.extras
    };
}

function buildUserGardenResponse(user, options = {}) {
    const now = options.now || new Date();
    const autoCollect = hasGardenAutoCollect(user);
    const travelTime = getTruckTravelTime(user);
    const extras = options.extras || {};
    return buildGamePayload(user.richGardenProgress, { now, extras, autoCollect, travelTime });
}

function synchronizeGardenState(progress = {}, now = new Date(), options = {}) {
    const collected = {};
    let modified = false;
    const autoCollect = Boolean(options.autoCollect);

    if (!progress) {
        return { modified, collected };
    }

    if (!progress.inventory) {
        progress.inventory = {};
        modified = true;
    }

    if (!progress.truckInventory) {
        progress.truckInventory = {};
        modified = true;
    }

    if (!Array.isArray(progress.garden)) {
        progress.garden = Array(GARDEN_SIZE).fill(null);
        modified = true;
    } else if (progress.garden.length < GARDEN_SIZE) {
        progress.garden = [...progress.garden, ...Array(GARDEN_SIZE - progress.garden.length).fill(null)];
        modified = true;
    }

    for (let i = 0; i < GARDEN_SIZE; i += 1) {
        const tree = progress.garden[i];
        if (!tree) {
            continue;
        }

        if (!TREE_TYPES[tree.type]) {
            progress.garden[i] = null;
            modified = true;
            continue;
        }

        if (tree.state === 'collecting') {
            const collectionStart = ensureDate(tree.collectionStartTime);
            if (collectionStart) {
                const elapsed = Math.floor((now - collectionStart) / 1000);
                if (elapsed >= COLLECTION_TIME) {
                    const finishedAt = new Date(collectionStart.getTime() + (COLLECTION_TIME * 1000));

                    const treeType = TREE_TYPES[tree.type];
                    if (treeType) {
                        const fruitsProduced = treeType.fps * PRODUCTION_TIME;
                        progress.inventory[tree.type] = (progress.inventory[tree.type] || 0) + fruitsProduced;
                        collected[tree.type] = (collected[tree.type] || 0) + fruitsProduced;
                    }

                    tree.state = 'producing';
                    tree.collectionStartTime = null;
                    tree.plantedAt = finishedAt;
                    tree.timeLeft = PRODUCTION_TIME;
                    tree.lastCollected = finishedAt;
                    modified = true;
                } else {
                    tree.timeLeft = COLLECTION_TIME - elapsed;
                }
            } else {
                tree.collectionStartTime = now;
                tree.timeLeft = COLLECTION_TIME;
                modified = true;
            }
        }

        if (tree.state !== 'collecting') {
            const plantedAt = ensureDate(tree.plantedAt) || now;
            if (!tree.plantedAt) {
                tree.plantedAt = plantedAt;
                modified = true;
            }

            const elapsed = Math.max(0, Math.floor((now - plantedAt) / 1000));
            if (elapsed >= PRODUCTION_TIME) {
                tree.state = 'ready';
                tree.timeLeft = 0;
            } else {
                tree.state = 'producing';
                tree.timeLeft = PRODUCTION_TIME - elapsed;
            }
        }

        if (autoCollect && tree.state === 'ready') {
            const treeType = TREE_TYPES[tree.type];
            if (treeType) {
                const fruitsProduced = treeType.fps * PRODUCTION_TIME;
                progress.inventory[tree.type] = (progress.inventory[tree.type] || 0) + fruitsProduced;
                collected[tree.type] = (collected[tree.type] || 0) + fruitsProduced;
                tree.state = 'producing';
                tree.collectionStartTime = null;
                tree.plantedAt = now;
                tree.timeLeft = PRODUCTION_TIME;
                tree.lastCollected = now;
                modified = true;
            }
        }
    }

    return { modified, collected };
}

// Helper function to update truck status
async function updateTruckStatus(user) {
    const rgData = user.richGardenProgress;
    if (!rgData || !rgData.truckDepartureTime) {
        return; // No truck travel in progress
    }

    const departureTime = new Date(rgData.truckDepartureTime);
    const now = new Date();
    const elapsed = Math.floor((now - departureTime) / 1000);
    const travelTime = getTruckTravelTime(user);
    let truckArrived = false;

    if (rgData.truckLocation === 'traveling_to_city' && elapsed >= travelTime) {
        rgData.truckLocation = 'city';
        rgData.truckDepartureTime = null;
        truckArrived = true;
    } else if (rgData.truckLocation === 'traveling_to_farm' && elapsed >= travelTime) {
        rgData.truckLocation = 'farm';
        rgData.truckDepartureTime = null;
        truckArrived = true;
    }

    if (truckArrived) {
        user.markModified('richGardenProgress');
        await user.save();
    }
}

// Get Rich Garden status
router.get('/status/:username', async (req, res) => {
    try {
        const { username } = req.params;
        const user = await User.findOne({ username });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        const now = new Date();

        if (!user.richGardenProgress) {
            user.richGardenProgress = {
                coins: 1000,
                garden: Array(GARDEN_SIZE).fill(null),
                inventory: {},
                truckLocation: 'farm',
                truckDepartureTime: null,
                totalTreesPlanted: 0,
                totalFruitsCollected: 0,
                totalCoinsEarned: 0,
                highestGardenLevel: 1,
                lastPlayed: now,
                playTime: 0
            };
            user.markModified('richGardenProgress');
            await user.save();
        }

        await updateTruckStatus(user);

        const autoCollect = hasGardenAutoCollect(user);
        const travelTime = getTruckTravelTime(user);
        const syncResult = synchronizeGardenState(user.richGardenProgress, now, { autoCollect });
        if (syncResult.modified) {
            user.markModified('richGardenProgress');
            await user.save();
        }

        const extras = {};
        if (Object.keys(syncResult.collected).length > 0) {
            extras.collected = syncResult.collected;
        }

        return res.json(buildUserGardenResponse(user, { now, extras }));

    } catch (error) {
        console.error('Rich Garden status error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Buy tree
router.post('/buy_tree', async (req, res) => {
    try {
        const { username, cellIndex } = req.body;

        if (cellIndex < 0 || cellIndex >= GARDEN_SIZE) {
            return res.status(400).json({ error: 'Invalid cell index' });
        }

        const user = await User.findOne({ username });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const rgData = user.richGardenProgress;
        if (!rgData) {
            return res.status(400).json({ error: 'Rich Garden data not initialized' });
        }

        await updateTruckStatus(user); // Ensure truck status is up-to-date before checks

        // Allow buying first tree at farm, otherwise require truck at city
        const plantedTrees = rgData.garden.filter(tree => tree !== null).length;
        if (plantedTrees > 0 && rgData.truckLocation !== 'city') {
            return res.status(400).json({ error: 'Truck must be at city to buy trees' });
        }

        // Check sequential purchase
        for (let i = 0; i < cellIndex; i++) {
            if (!rgData.garden[i]) {
                return res.status(400).json({ error: 'Must buy trees sequentially' });
            }
        }

        // Check if cell is empty
        if (rgData.garden[cellIndex]) {
            return res.status(400).json({ error: 'Cell already has a tree' });
        }

        // Check coins
        if (rgData.coins < TREE_TYPES.common.cost) {
            return res.status(400).json({ error: 'Not enough coins' });
        }

        // Buy tree
        rgData.garden[cellIndex] = {
            type: 'common',
            state: 'producing',
            plantedAt: new Date(),
            collectionStartTime: null,
            timeLeft: PRODUCTION_TIME,
            lastCollected: null
        };
        rgData.coins -= TREE_TYPES.common.cost;

        user.markModified('richGardenProgress');
        await user.save();

        return res.json(buildUserGardenResponse(user, { now: new Date() }));

    } catch (error) {
        console.error('Buy tree error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Upgrade tree
router.post('/upgrade_tree', async (req, res) => {
    try {
        const { username, cellIndex } = req.body;

        if (cellIndex < 0 || cellIndex >= GARDEN_SIZE) {
            return res.status(400).json({ error: 'Invalid cell index' });
        }

        const user = await User.findOne({ username });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const rgData = user.richGardenProgress;
        if (!rgData) {
            return res.status(400).json({ error: 'Rich Garden data not initialized' });
        }

        await updateTruckStatus(user); // Ensure truck status is updated

        // Check if truck is at city
        if (rgData.truckLocation !== 'city') {
            return res.status(400).json({ error: 'Truck must be at city to upgrade trees' });
        }

        const tree = rgData.garden[cellIndex];
        if (!tree) {
            return res.status(400).json({ error: 'No tree in this cell' });
        }

        const currentLevel = TREE_TYPES[tree.type].level;
        if (currentLevel >= 6) {
            return res.status(400).json({ error: 'Tree is already at maximum level' });
        }

        const nextLevel = currentLevel + 1;

        const ownedLevels = rgData.garden
            .filter(t => t)
            .map(t => TREE_TYPES[t.type]?.level || 0);
        const maxOwnedLevel = ownedLevels.length > 0
            ? Math.max(...ownedLevels)
            : currentLevel;
        const premiumUnlockLevel = getPremiumUnlockLevel(user);
        const bypassRequirement = premiumUnlockLevel >= nextLevel;

        if (nextLevel > maxOwnedLevel && !bypassRequirement) {
            const prevLevelTrees = rgData.garden.filter(t => t && TREE_TYPES[t.type]?.level === currentLevel).length;
            if (prevLevelTrees < 10) {
                return res.status(400).json({
                    error: `To unlock ${Object.values(TREE_TYPES).find(t => t.level === nextLevel)?.name || 'next level'}, you need 10 trees at ${TREE_TYPES[tree.type].name} level first.`
                });
            }
        }

        const nextType = Object.values(TREE_TYPES).find(t => t.level === currentLevel + 1);
        if (rgData.coins < nextType.cost) {
            return res.status(400).json({ error: 'Not enough coins' });
        }

        // Upgrade tree - use the key from TREE_TYPES, not the name
        const nextTypeKey = Object.keys(TREE_TYPES).find(key => TREE_TYPES[key] === nextType);
        tree.type = nextTypeKey;
        rgData.coins -= nextType.cost;

        user.markModified('richGardenProgress');
        await user.save();

        return res.json(buildUserGardenResponse(user, { now: new Date() }));

    } catch (error) {
        console.error('Upgrade tree error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Collect tree
router.post('/collect_tree', async (req, res) => {
    try {
        const { username, cellIndex } = req.body;

        if (cellIndex < 0 || cellIndex >= GARDEN_SIZE) {
            return res.status(400).json({ error: 'Invalid cell index' });
        }

        const user = await User.findOne({ username });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const rgData = user.richGardenProgress;
        if (!rgData) {
            return res.status(400).json({ error: 'Rich Garden data not initialized' });
        }

        const now = new Date();
        const autoCollect = hasGardenAutoCollect(user);
        const syncResult = synchronizeGardenState(rgData, now, { autoCollect });
        const fruitsAdded = { ...syncResult.collected };

        const treeToCollect = rgData.garden[cellIndex];
        if (!treeToCollect) {
            return res.status(400).json({ error: 'No tree in this cell' });
        }

        if (treeToCollect.state !== 'ready') {
            return res.status(400).json({ error: 'Tree is not ready for collection' });
        }

        // Start the collection timer
        treeToCollect.state = 'collecting';
        treeToCollect.collectionStartTime = now;
        treeToCollect.timeLeft = COLLECTION_TIME;
        treeToCollect.lastCollected = now;

        user.markModified('richGardenProgress');
        await user.save();

        const extras = {};
        if (Object.keys(fruitsAdded).length > 0) {
            extras.collected = fruitsAdded;
        }

        return res.json(buildUserGardenResponse(user, { now, extras }));

    } catch (error) {
        console.error('Collect tree error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Load truck with fruits from farm inventory
router.post('/load_truck', async (req, res) => {
    try {
        const { username } = req.body;

        const user = await User.findOne({ username });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const rgData = user.richGardenProgress;
        if (!rgData) {
            return res.status(400).json({ error: 'Rich Garden data not initialized' });
        }

        const now = new Date();
        const autoCollect = hasGardenAutoCollect(user);
        const syncResult = synchronizeGardenState(rgData, now, { autoCollect });
        await updateTruckStatus(user);

        if (rgData.truckLocation !== 'farm') {
            return res.status(400).json({ error: 'Truck must be at farm to load fruits' });
        }

        if (!rgData.truckInventory) {
            rgData.truckInventory = {};
        }

        const inventorySource = rgData.inventory && typeof rgData.inventory.toObject === 'function'
            ? rgData.inventory.toObject()
            : { ...rgData.inventory };

        const loaded = {};
        for (const [type, amountRaw] of Object.entries(inventorySource)) {
            const amount = Number(amountRaw) || 0;
            if (amount <= 0) {
                continue;
            }

            rgData.truckInventory[type] = (Number(rgData.truckInventory[type]) || 0) + amount;
            rgData.inventory[type] = 0;
            loaded[type] = (loaded[type] || 0) + amount;
        }

        if (Object.keys(loaded).length === 0) {
            return res.status(400).json({ error: 'No fruits available to load' });
        }

        user.markModified('richGardenProgress');
        await user.save();

        const extras = {};
        if (Object.keys(syncResult.collected).length > 0) {
            extras.collected = syncResult.collected;
        }
        extras.loaded = loaded;

        return res.json(buildUserGardenResponse(user, { now, extras }));

    } catch (error) {
        console.error('Load truck error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Send truck to city
router.post('/send_truck', async (req, res) => {
    try {
        const { username } = req.body;

        const user = await User.findOne({ username });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const rgData = user.richGardenProgress;
        if (!rgData) {
            return res.status(400).json({ error: 'Rich Garden data not initialized' });
        }

        await updateTruckStatus(user); // Ensure truck status is updated

        if (rgData.truckLocation !== 'farm') {
            return res.status(400).json({ error: 'Truck is not at farm' });
        }

        const now = new Date();
        rgData.truckLocation = 'traveling_to_city';
        rgData.truckDepartureTime = now;

        user.markModified('richGardenProgress');
        await user.save();

        return res.json(buildUserGardenResponse(user, { now }));

    } catch (error) {
        console.error('Send truck error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Sell fruits
router.post('/sell_fruits', async (req, res) => {
    try {
        const { username } = req.body;

        const user = await User.findOne({ username });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const rgData = user.richGardenProgress;
        if (!rgData) {
            return res.status(400).json({ error: 'Rich Garden data not initialized' });
        }

        const now = new Date();
        const autoCollect = hasGardenAutoCollect(user);
        const syncResult = synchronizeGardenState(rgData, now, { autoCollect });
        await updateTruckStatus(user); // Ensure truck status is updated

        if (rgData.truckLocation !== 'city') {
            return res.status(400).json({ error: 'Truck must be at city to sell fruits' });
        }

        if (!rgData.truckInventory) {
            rgData.truckInventory = {};
        }

        const truckInventorySource = typeof rgData.truckInventory.toObject === 'function'
            ? rgData.truckInventory.toObject()
            : { ...rgData.truckInventory };

        let totalEarned = 0;
        const sold = {};
        const sales = [];
        for (const [type, amountRaw] of Object.entries(truckInventorySource)) {
            const amount = Number(amountRaw) || 0;
            if (amount <= 0) {
                continue;
            }

            const treeType = TREE_TYPES[type];
            if (!treeType) {
                continue;
            }

            const coins = Math.floor(amount / treeType.fruitsPerCoin);
            if (coins <= 0) {
                continue;
            }

            totalEarned += coins;
            sales.push({ type, amount });
        }

        if (totalEarned === 0) {
            return res.status(400).json({ error: 'No fruits to sell from truck' });
        }

        for (const { type, amount } of sales) {
            rgData.truckInventory[type] = 0;
            sold[type] = amount;
        }

        rgData.coins += totalEarned;

        user.markModified('richGardenProgress');
        await user.save();

        const extras = {
            earned: totalEarned,
            sold
        };

        if (Object.keys(syncResult.collected).length > 0) {
            extras.collected = syncResult.collected;
        }

        return res.json(buildUserGardenResponse(user, { now, extras }));

    } catch (error) {
        console.error('Sell fruits error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Return truck to farm
router.post('/return_truck', async (req, res) => {
    try {
        const { username } = req.body;

        const user = await User.findOne({ username });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const rgData = user.richGardenProgress;
        if (!rgData) {
            return res.status(400).json({ error: 'Rich Garden data not initialized' });
        }

        await updateTruckStatus(user); // Ensure truck status is updated

        if (rgData.truckLocation !== 'city') {
            return res.status(400).json({ error: 'Truck must be at city to return' });
        }

        const now = new Date();
        rgData.truckLocation = 'traveling_to_farm';
        rgData.truckDepartureTime = now;

        user.markModified('richGardenProgress');
        await user.save();

        return res.json(buildUserGardenResponse(user, { now }));

    } catch (error) {
        console.error('Return truck error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

export default router;