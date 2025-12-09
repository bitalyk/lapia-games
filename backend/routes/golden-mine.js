import express from 'express';
import User from '../models/user.js';
import EarningsTracker from '../services/earnings-tracker.js';

const router = express.Router();

// Mine configuration
const MINE_TYPES = {
    coal: { cost: 1000, orePerSecond: 1, orePerCoin: 100, level: 1, name: "Coal Mine" },
    copper: { cost: 2500, orePerSecond: 2, orePerCoin: 80, level: 2, name: "Copper Mine" },
    iron: { cost: 10000, orePerSecond: 5, orePerCoin: 50, level: 3, name: "Iron Mine" },
    nickel: { cost: 25000, orePerSecond: 10, orePerCoin: 40, level: 4, name: "Nickel Mine" },
    silver: { cost: 100000, orePerSecond: 20, orePerCoin: 20, level: 5, name: "Silver Mine" },
    golden: { cost: 500000, orePerSecond: 50, orePerCoin: 10, level: 6, name: "Golden Mine" }
};

// Production constants
const PRODUCTION_TIME = process.env.FAST_MODE === 'true' ? 30 : 8 * 60 * 60; // 30s testing / 8h normal
const REST_TIME = process.env.FAST_MODE === 'true' ? 15 : 4 * 60 * 60; // 15s testing / 4h normal
const TRUCK_TRAVEL_TIME = process.env.FAST_MODE === 'true' ? 10 : 2 * 60 * 60; // 10s testing / 2h normal
const PREMIUM_TRUCK_TRAVEL_TIME = process.env.FAST_MODE === 'true' ? 3 : 5 * 60;
const MAX_MINES = 10;
const MAX_WORKERS_PER_MINE = 10;

// Helper function to calculate worker cost
function calculateWorkerCost(mineType, workerNumber) {
    if (workerNumber === 1) return 0; // First worker is free
    const baseCost = MINE_TYPES[mineType].cost;
    const multiplier = (workerNumber - 1) * 0.1; // 10% per position
    return Math.floor(baseCost * multiplier);
}

function getTruckTravelTime(user) {
    if (user?.goldenMineUpgrades?.helicopterTransport) {
        return PREMIUM_TRUCK_TRAVEL_TIME;
    }
    return TRUCK_TRAVEL_TIME;
}

function hasAutoCollect(user) {
    return Boolean(user?.goldenMineUpgrades?.autoCollect);
}

function advanceMineState(mine, now) {
    if (!mine) return false;

    const lastStateChange = mine.lastStateChange ? new Date(mine.lastStateChange) : now;
    let elapsed = Math.floor((now - lastStateChange) / 1000);
    if (elapsed <= 0) {
        return false;
    }

    let remainder = elapsed;
    let changed = false;

    while (remainder > 0) {
        if (mine.state === 'producing') {
            if (mine.timeLeft <= 0) {
                mine.timeLeft = PRODUCTION_TIME;
            }

            if (remainder >= mine.timeLeft) {
                remainder -= mine.timeLeft;
                mine.state = 'ready';
                mine.timeLeft = 0;
                mine.oreProduced = mine.workers * MINE_TYPES[mine.type].orePerSecond * PRODUCTION_TIME;
                changed = true;
                break; // Ready state waits for player action
            }

            mine.timeLeft -= remainder;
            remainder = 0;
            changed = true;
        } else if (mine.state === 'resting') {
            if (mine.timeLeft <= 0) {
                mine.timeLeft = REST_TIME;
            }

            if (remainder >= mine.timeLeft) {
                remainder -= mine.timeLeft;
                mine.state = 'producing';
                mine.timeLeft = PRODUCTION_TIME;
                mine.oreProduced = 0;
                changed = true;
                continue;
            }

            mine.timeLeft -= remainder;
            remainder = 0;
            changed = true;
        } else {
            break;
        }
    }

    remainder = Math.max(0, remainder);
    mine.lastStateChange = new Date(now.getTime() - remainder * 1000);

    return changed;
}

function collectMineOre(user, mineIndex, options = {}) {
    const progress = user.goldenMineProgress;
    if (!progress || !Array.isArray(progress.mines)) {
        return { success: false, reason: 'NO_PROGRESS' };
    }

    if (mineIndex < 0 || mineIndex >= progress.mines.length) {
        return { success: false, reason: 'MINE_NOT_FOUND' };
    }

    const mine = progress.mines[mineIndex];
    if (!mine) {
        return { success: false, reason: 'MINE_NOT_FOUND' };
    }

    if (mine.state !== 'ready') {
        return { success: false, reason: 'NOT_READY' };
    }

    const oreType = mine.type;
    const collectedAmount = parseInt(mine.oreProduced, 10) || 0;

    if (!progress.inventory) {
        progress.inventory = {};
    }

    const currentValue = parseInt(progress.inventory[oreType], 10) || 0;
    progress.inventory[oreType] = currentValue + collectedAmount;
    progress.totalOreMined = (progress.totalOreMined || 0) + collectedAmount;

    mine.state = 'resting';
    mine.timeLeft = REST_TIME;
    mine.lastStateChange = options.now || new Date();
    mine.oreProduced = 0;

    user.markModified('goldenMineProgress.inventory');
    user.markModified('goldenMineProgress.mines');
    user.markModified('goldenMineProgress.totalOreMined');

    return { success: true, oreType, amount: collectedAmount, mineIndex };
}

// Get Golden Mine status
router.get('/status/:username', async (req, res) => {
    try {
        const { username } = req.params;

        const user = await User.findOne({ username });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Initialize Golden Mine data if not exists
        if (!user.goldenMineProgress) {
            user.goldenMineProgress = {
                coins: 1000,
                mines: Array(MAX_MINES).fill(null),
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
            // Add initial coal mine with 1 worker
            user.goldenMineProgress.mines[0] = {
                type: 'coal',
                workers: 1,
                state: 'producing',
                timeLeft: PRODUCTION_TIME,
                lastStateChange: new Date(),
                oreProduced: 0
            };
            user.goldenMineProgress.totalMinesOwned = 1;
            await user.save();
        }

        // Update mine states based on time
        const now = new Date();
        const travelTime = getTruckTravelTime(user);
        const autoCollect = hasAutoCollect(user);
        const autoCollected = {};
        let needsSave = false;

        user.goldenMineProgress.mines.forEach((mine, index) => {
            if (!mine) return;

            if (mine.state === 'producing' && mine.timeLeft > PRODUCTION_TIME) {
                mine.timeLeft = PRODUCTION_TIME;
                needsSave = true;
            }

            if (mine.state === 'resting' && mine.timeLeft > REST_TIME) {
                mine.timeLeft = REST_TIME;
                needsSave = true;
            }

            if (advanceMineState(mine, now)) {
                needsSave = true;
            }

            if (autoCollect && mine.state === 'ready') {
                const result = collectMineOre(user, index, { now, autoTrigger: true });
                if (result.success && result.amount > 0) {
                    autoCollected[result.oreType] = (autoCollected[result.oreType] || 0) + result.amount;
                }
                needsSave = needsSave || result.success;
            }
        });

        // Update truck location
        if (user.goldenMineProgress.truckDepartureTime) {
            const travelTimePassed = Math.floor((now - user.goldenMineProgress.truckDepartureTime) / 1000);

            if (user.goldenMineProgress.truckLocation === 'traveling_to_factory' && travelTimePassed >= travelTime) {
                user.goldenMineProgress.truckLocation = 'factory';
                user.goldenMineProgress.truckDepartureTime = null;
                needsSave = true;
            } else if (user.goldenMineProgress.truckLocation === 'traveling_to_mine' && travelTimePassed >= travelTime) {
                user.goldenMineProgress.truckLocation = 'mine';
                user.goldenMineProgress.truckDepartureTime = null;
                needsSave = true;
            }
        }

        if (needsSave) {
            await user.save();
        }

        const payload = {
            coins: user.goldenMineProgress.coins,
            mines: user.goldenMineProgress.mines,
            inventory: Object.fromEntries(
                Object.entries(user.goldenMineProgress.inventory.toObject ? user.goldenMineProgress.inventory.toObject() : user.goldenMineProgress.inventory).map(([k, v]) => [k, parseInt(v)])
            ),
            truckLocation: user.goldenMineProgress.truckLocation,
            truckCargo: Object.fromEntries(
                Object.entries(user.goldenMineProgress.truckCargo.toObject ? user.goldenMineProgress.truckCargo.toObject() : user.goldenMineProgress.truckCargo).map(([k, v]) => [k, parseInt(v)])
            ),
            totalMinesOwned: user.goldenMineProgress.totalMinesOwned,
            totalOreMined: user.goldenMineProgress.totalOreMined,
            totalCoinsEarned: user.goldenMineProgress.totalCoinsEarned,
            truckTravelTime: travelTime,
            upgrades: {
                helicopterTransport: Boolean(user?.goldenMineUpgrades?.helicopterTransport),
                autoCollect
            }
        };

        if (Object.keys(autoCollected).length > 0) {
            payload.autoCollected = autoCollected;
        }

        res.json(payload);

    } catch (error) {
        console.error('Error getting Golden Mine status:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Buy new mine
router.post('/buy_mine', async (req, res) => {
    try {
        const { username, mineType } = req.body;

        if (!MINE_TYPES[mineType]) {
            return res.status(400).json({ error: 'Invalid mine type' });
        }

        const user = await User.findOne({ username });
        if (!user || !user.goldenMineProgress) {
            return res.status(404).json({ error: 'User not found' });
        }

        const cost = MINE_TYPES[mineType].cost;
        if (user.goldenMineProgress.coins < cost) {
            return res.status(400).json({ error: 'Not enough coins' });
        }

        // Find empty mine slot
        const emptySlot = user.goldenMineProgress.mines.findIndex(mine => mine === null);
        if (emptySlot === -1) {
            return res.status(400).json({ error: 'No available mine slots' });
        }

        // Deduct coins
        user.goldenMineProgress.coins -= cost;

        // Add mine with 1 free worker
        user.goldenMineProgress.mines[emptySlot] = {
            type: mineType,
            workers: 1,
            state: 'producing',
            timeLeft: PRODUCTION_TIME,
            lastStateChange: new Date(),
            oreProduced: 0
        };

        user.goldenMineProgress.totalMinesOwned++;

        await user.save();

        res.json({
            success: true,
            mineIndex: emptySlot,
            newCoins: user.goldenMineProgress.coins
        });

    } catch (error) {
        console.error('Error buying mine:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Hire worker
router.post('/hire_worker', async (req, res) => {
    try {
        const { username, mineIndex } = req.body;

        const user = await User.findOne({ username });
        if (!user || !user.goldenMineProgress) {
            return res.status(404).json({ error: 'User not found' });
        }

        const mine = user.goldenMineProgress.mines[mineIndex];
        if (!mine) {
            return res.status(400).json({ error: 'Mine not found' });
        }

        if (mine.workers >= MAX_WORKERS_PER_MINE) {
            return res.status(400).json({ error: 'Mine is at maximum worker capacity' });
        }

        const workerCost = calculateWorkerCost(mine.type, mine.workers + 1);
        if (user.goldenMineProgress.coins < workerCost) {
            return res.status(400).json({ error: 'Not enough coins' });
        }

        // Deduct coins and add worker
        user.goldenMineProgress.coins -= workerCost;
        mine.workers++;

        await user.save();

        res.json({
            success: true,
            newWorkers: mine.workers,
            newCoins: user.goldenMineProgress.coins
        });

    } catch (error) {
        console.error('Error hiring worker:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Upgrade mine
router.post('/upgrade_mine', async (req, res) => {
    try {
        const { username, mineIndex } = req.body;

        const user = await User.findOne({ username });
        if (!user || !user.goldenMineProgress) {
            return res.status(404).json({ error: 'User not found' });
        }

        const mine = user.goldenMineProgress.mines[mineIndex];
        if (!mine) {
            return res.status(400).json({ error: 'Mine not found' });
        }

        if (mine.workers < MAX_WORKERS_PER_MINE) {
            return res.status(400).json({ error: 'Mine must have maximum workers to upgrade' });
        }

        const currentLevel = MINE_TYPES[mine.type].level;
        const nextType = Object.keys(MINE_TYPES).find(type => MINE_TYPES[type].level === currentLevel + 1);

        if (!nextType) {
            return res.status(400).json({ error: 'Mine is already at maximum level' });
        }

        const upgradeCost = MINE_TYPES[nextType].cost;
        if (user.goldenMineProgress.coins < upgradeCost) {
            return res.status(400).json({ error: 'Not enough coins' });
        }

        // Upgrade mine
        user.goldenMineProgress.coins -= upgradeCost;
        mine.type = nextType;
        mine.workers = 1; // Reset to base worker count
        mine.state = 'producing';
        mine.timeLeft = PRODUCTION_TIME;
        mine.lastStateChange = new Date();
        mine.oreProduced = 0;

        await user.save();

        res.json({
            success: true,
            newType: nextType,
            newCoins: user.goldenMineProgress.coins
        });

    } catch (error) {
        console.error('Error upgrading mine:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Collect ore
router.post('/collect_ore', async (req, res) => {
    try {
        const { username, mineIndex } = req.body;

        const user = await User.findOne({ username });
        if (!user || !user.goldenMineProgress) {
            return res.status(404).json({ error: 'User not found' });
        }

        const mine = user.goldenMineProgress.mines[mineIndex];
        if (!mine) {
            return res.status(400).json({ error: 'Mine not found' });
        }

        const result = collectMineOre(user, mineIndex, { now: new Date() });
        if (!result.success) {
            return res.status(400).json({ error: 'Mine is not ready for collection' });
        }

        await user.save();

        res.json({
            success: true,
            collected: result.amount,
            oreType: mine.type,
            newInventory: user.goldenMineProgress.inventory
        });

    } catch (error) {
        console.error('Error collecting ore:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Load truck
router.post('/load_truck', async (req, res) => {
    try {
        const { username, oreType, amount } = req.body;

        const user = await User.findOne({ username });
        if (!user || !user.goldenMineProgress) {
            return res.status(404).json({ error: 'User not found' });
        }

        if (user.goldenMineProgress.truckLocation !== 'mine') {
            return res.status(400).json({ error: 'Truck is not at the mine' });
        }

        const available = user.goldenMineProgress.inventory[oreType] || 0;
        if (available < amount) {
            return res.status(400).json({ error: 'Not enough ore in inventory' });
        }

        // Load truck
        user.goldenMineProgress.inventory[oreType] -= amount;
        user.goldenMineProgress.truckCargo[oreType] = (parseInt(user.goldenMineProgress.truckCargo[oreType] || 0)) + parseInt(amount);

        await user.save();

        res.json({
            success: true,
            newInventory: user.goldenMineProgress.inventory.toObject ? user.goldenMineProgress.inventory.toObject() : user.goldenMineProgress.inventory,
            newCargo: user.goldenMineProgress.truckCargo.toObject ? user.goldenMineProgress.truckCargo.toObject() : user.goldenMineProgress.truckCargo
        });

    } catch (error) {
        console.error('Error loading truck:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Send truck to factory
router.post('/send_truck', async (req, res) => {
    try {
        const { username } = req.body;

        const user = await User.findOne({ username });
        if (!user || !user.goldenMineProgress) {
            return res.status(404).json({ error: 'User not found' });
        }

        if (user.goldenMineProgress.truckLocation !== 'mine') {
            return res.status(400).json({ error: 'Truck is not at the mine' });
        }

        const cargoObj = user.goldenMineProgress.truckCargo.toObject ? user.goldenMineProgress.truckCargo.toObject() : user.goldenMineProgress.truckCargo;
        const hasCargo = Object.values(cargoObj).some(amount => parseInt(amount) > 0);
        if (!hasCargo) {
            return res.status(400).json({ error: 'Truck has no cargo to deliver' });
        }

        // Send truck
        user.goldenMineProgress.truckLocation = 'traveling_to_factory';
        user.goldenMineProgress.truckDepartureTime = new Date();

        await user.save();

        res.json({ success: true });

    } catch (error) {
        console.error('Error sending truck:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Sell ore at factory
router.post('/sell_ore', async (req, res) => {
    try {
        const { username } = req.body;

        const user = await User.findOne({ username });
        if (!user || !user.goldenMineProgress) {
            return res.status(404).json({ error: 'User not found' });
        }

        if (user.goldenMineProgress.truckLocation !== 'factory') {
            return res.status(400).json({ error: 'Truck is not at the factory' });
        }

        let totalCoins = 0;
        const cargoObj = user.goldenMineProgress.truckCargo.toObject ? user.goldenMineProgress.truckCargo.toObject() : user.goldenMineProgress.truckCargo;
        const saleDetails = [];
        for (const [oreType, amount] of Object.entries(cargoObj)) {
            const numericAmount = parseInt(amount, 10) || 0;
            if (numericAmount <= 0) {
                continue;
            }
            const oreConfig = MINE_TYPES[oreType];
            if (!oreConfig) {
                continue;
            }
            const orePerCoin = oreConfig.orePerCoin;
            const coins = Math.floor(numericAmount / orePerCoin);
            if (coins <= 0) {
                continue;
            }
            totalCoins += coins;
            saleDetails.push({
                type: oreType,
                ore: numericAmount,
                coins,
                orePerCoin
            });
        }

        // Add coins and clear cargo
        user.goldenMineProgress.coins += totalCoins;
        user.goldenMineProgress.totalCoinsEarned += totalCoins;
        user.goldenMineProgress.truckCargo = {};

        let trackerResult = null;
        if (totalCoins > 0) {
            trackerResult = EarningsTracker.recordTransaction(user, {
                game: 'golden-mine',
                type: 'sell',
                amount: totalCoins,
                currency: 'game_coin',
                details: {
                    source: 'ore-truck',
                    sales: saleDetails
                }
            });
        }

        await user.save();

        res.json({
            success: true,
            coinsEarned: totalCoins,
            newCoins: user.goldenMineProgress.coins,
            earningsTracker: trackerResult?.earnings,
            unlockedAchievements: trackerResult?.unlockedAchievements
        });

    } catch (error) {
        console.error('Error selling ore:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Return truck to mine
router.post('/return_truck', async (req, res) => {
    try {
        const { username } = req.body;

        const user = await User.findOne({ username });
        if (!user || !user.goldenMineProgress) {
            return res.status(404).json({ error: 'User not found' });
        }

        if (user.goldenMineProgress.truckLocation !== 'factory') {
            return res.status(400).json({ error: 'Truck is not at the factory' });
        }

        // Send truck back
        user.goldenMineProgress.truckLocation = 'traveling_to_mine';
        user.goldenMineProgress.truckDepartureTime = new Date();

        await user.save();

        res.json({ success: true });

    } catch (error) {
        console.error('Error returning truck:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;