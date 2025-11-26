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

// Production constants
const PRODUCTION_TIME = 4 * 60 * 60; // 4 hours in seconds
const COLLECTION_TIME = 30 * 60; // 30 minutes in seconds
const TRUCK_TRAVEL_TIME = 60 * 60; // 1 hour in seconds

// Get Rich Garden status
router.get('/status/:username', async (req, res) => {
    try {
        const { username } = req.params;

        const user = await User.findOne({ username });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Initialize Rich Garden data if not exists
        if (!user.richGardenProgress) {
            user.richGardenProgress = {
                coins: 1000,
                garden: Array(10).fill(null),
                inventory: {},
                truckLocation: 'farm',
                truckDepartureTime: null,
                totalTreesPlanted: 0,
                totalFruitsCollected: 0,
                totalCoinsEarned: 0,
                highestGardenLevel: 1,
                redeemedCodes: [],
                lastPlayed: new Date(),
                playTime: 0
            };
            await user.save();
        }

        // Update truck location based on travel time
        const rgData = user.richGardenProgress;
        if (rgData.truckDepartureTime) {
            const departureTime = new Date(rgData.truckDepartureTime);
            const now = new Date();
            const elapsed = Math.floor((now - departureTime) / 1000);

            if (rgData.truckLocation === 'traveling_to_city' && elapsed >= TRUCK_TRAVEL_TIME) {
                rgData.truckLocation = 'city';
                rgData.truckDepartureTime = null;
            } else if (rgData.truckLocation === 'traveling_to_farm' && elapsed >= TRUCK_TRAVEL_TIME) {
                rgData.truckLocation = 'farm';
                rgData.truckDepartureTime = null;
            }
        }

        // Update tree timers based on plantedAt timestamp
        const now = new Date();
        rgData.garden.forEach((tree, index) => {
            if (tree) {
                const plantedAt = new Date(tree.plantedAt);
                const elapsed = Math.floor((now - plantedAt) / 1000); // elapsed time in seconds
                const cyclePosition = elapsed % (PRODUCTION_TIME + COLLECTION_TIME);

                if (cyclePosition < PRODUCTION_TIME) {
                    // Tree is in producing phase
                    tree.state = 'producing';
                    tree.timeLeft = PRODUCTION_TIME - cyclePosition;
                } else {
                    // Tree is in ready/collecting phase
                    tree.state = tree.state === 'collecting' ? 'collecting' : 'ready';
                    tree.timeLeft = COLLECTION_TIME - (cyclePosition - PRODUCTION_TIME);
                }
            }
        });

        await user.save();

        res.json({
            success: true,
            coins: rgData.coins,
            garden: rgData.garden,
            inventory: rgData.inventory,
            truckLocation: rgData.truckLocation,
            truckDepartureTime: rgData.truckDepartureTime
        });

    } catch (error) {
        console.error('Rich Garden status error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Buy tree
router.post('/buy_tree', async (req, res) => {
    try {
        const { username, cellIndex } = req.body;

        if (cellIndex < 0 || cellIndex >= 10) {
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
            timeLeft: PRODUCTION_TIME,
            plantedAt: new Date()
        };
        rgData.coins -= TREE_TYPES.common.cost;

        await user.save();

        res.json({
            success: true,
            coins: rgData.coins,
            garden: rgData.garden
        });

    } catch (error) {
        console.error('Buy tree error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Upgrade tree
router.post('/upgrade_tree', async (req, res) => {
    try {
        const { username, cellIndex } = req.body;

        if (cellIndex < 0 || cellIndex >= 10) {
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

        // New upgrade logic:
        // Find the highest level tree currently owned
        const maxOwnedLevel = Math.max(...rgData.garden.filter(t => t).map(t => TREE_TYPES[t.type].level));

        // Check if trying to upgrade to a level higher than currently owned
        if (nextLevel > maxOwnedLevel) {
            // To unlock a new level, need 10 trees at the previous level
            const prevLevelTrees = rgData.garden.filter(t => t && TREE_TYPES[t.type].level === currentLevel).length;
            if (prevLevelTrees < 10) {
                return res.status(400).json({
                    error: `To unlock ${Object.values(TREE_TYPES).find(t => t.level === nextLevel)?.name || 'next level'}, you need 10 trees at ${TREE_TYPES[tree.type].name} level first.`
                });
            }
        }
        // If upgrading to a level you already own, or unlocking a new level with 10 prev level trees, allow it

        const nextType = Object.values(TREE_TYPES).find(t => t.level === currentLevel + 1);
        if (rgData.coins < nextType.cost) {
            return res.status(400).json({ error: 'Not enough coins' });
        }

        // Upgrade tree - use the key from TREE_TYPES, not the name
        const nextTypeKey = Object.keys(TREE_TYPES).find(key => TREE_TYPES[key] === nextType);
        tree.type = nextTypeKey;
        rgData.coins -= nextType.cost;

        await user.save();

        res.json({
            success: true,
            coins: rgData.coins,
            garden: rgData.garden
        });

    } catch (error) {
        console.error('Upgrade tree error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Collect tree
router.post('/collect_tree', async (req, res) => {
    try {
        const { username, cellIndex } = req.body;

        if (cellIndex < 0 || cellIndex >= 10) {
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

        const tree = rgData.garden[cellIndex];
        if (!tree) {
            return res.status(400).json({ error: 'No tree in this cell' });
        }

        if (tree.state !== 'ready') {
            return res.status(400).json({ error: 'Tree is not ready for collection' });
        }

        const treeType = TREE_TYPES[tree.type];
        const fruitsProduced = treeType.fps;

        // Add to inventory
        if (!rgData.inventory[tree.type]) {
            rgData.inventory[tree.type] = 0;
        }
        rgData.inventory[tree.type] += fruitsProduced;

        // Start collection timer
        tree.state = 'collecting';
        tree.timeLeft = COLLECTION_TIME;

        await user.save();

        res.json({
            success: true,
            garden: rgData.garden,
            inventory: rgData.inventory,
            collected: fruitsProduced
        });

    } catch (error) {
        console.error('Collect tree error:', error);
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

        if (rgData.truckLocation !== 'farm') {
            return res.status(400).json({ error: 'Truck is not at farm' });
        }

        rgData.truckLocation = 'traveling_to_city';
        rgData.truckDepartureTime = new Date();

        await user.save();

        res.json({
            success: true,
            truckLocation: rgData.truckLocation,
            truckDepartureTime: rgData.truckDepartureTime
        });

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

        if (rgData.truckLocation !== 'city') {
            return res.status(400).json({ error: 'Truck must be at city to sell fruits' });
        }

        let totalEarned = 0;
        Object.entries(rgData.inventory).forEach(([type, amount]) => {
            if (amount > 0) {
                const treeType = TREE_TYPES[type];
                const coins = Math.floor(amount / treeType.fruitsPerCoin);
                totalEarned += coins;
            }
        });

        if (totalEarned === 0) {
            return res.status(400).json({ error: 'No fruits to sell' });
        }

        rgData.coins += totalEarned;
        rgData.inventory = {}; // Clear inventory

        await user.save();

        res.json({
            success: true,
            coins: rgData.coins,
            inventory: rgData.inventory,
            earned: totalEarned
        });

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

        if (rgData.truckLocation !== 'city') {
            return res.status(400).json({ error: 'Truck must be at city to return' });
        }

        rgData.truckLocation = 'traveling_to_farm';
        rgData.truckDepartureTime = new Date();

        await user.save();

        res.json({
            success: true,
            truckLocation: rgData.truckLocation,
            truckDepartureTime: rgData.truckDepartureTime
        });

    } catch (error) {
        console.error('Return truck error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Redeem code
router.post('/redeem', async (req, res) => {
    try {
        const { username, code } = req.body;

        const user = await User.findOne({ username });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const rgData = user.richGardenProgress;
        if (!rgData) {
            return res.status(400).json({ error: 'Rich Garden data not initialized' });
        }

        const upperCode = code.toUpperCase();

        // Initialize redeemed codes if not exists
        if (!rgData.redeemedCodes) rgData.redeemedCodes = [];

        if (rgData.redeemedCodes.includes(upperCode)) {
            return res.status(400).json({ error: 'Code already redeemed' });
        }

        let message = '';
        let coinsAdded = 0;

        switch (upperCode) {
            case 'GROWTH':
                coinsAdded = 5000;
                message = 'Growth bonus: +5000 coins!';
                break;
            case 'HARVEST':
                coinsAdded = 10000;
                message = 'Harvest bonus: +10000 coins!';
                break;
            case 'PLANTING':
                coinsAdded = 25000;
                message = 'Planting bonus: +25000 coins!';
                break;
            case 'TREES':
                // Add some fruits to inventory
                if (!rgData.inventory.common) rgData.inventory.common = 0;
                rgData.inventory.common += 100;
                message = 'Tree bonus: +100 Common fruits!';
                break;
            case 'SKIPTRUCK':
                // Skip truck travel time
                if (rgData.truckLocation === 'traveling_to_city') {
                    rgData.truckLocation = 'city';
                    rgData.truckDepartureTime = null;
                    message = 'Truck travel skipped! Arrived at city instantly!';
                } else if (rgData.truckLocation === 'traveling_to_farm') {
                    rgData.truckLocation = 'farm';
                    rgData.truckDepartureTime = null;
                    message = 'Truck travel skipped! Arrived at farm instantly!';
                } else {
                    message = 'Truck is not traveling - no travel to skip!';
                }
                break;
            default:
                return res.status(400).json({ error: 'Invalid code' });
        }

        rgData.coins += coinsAdded;
        rgData.redeemedCodes.push(upperCode);

        await user.save();

        res.json({
            success: true,
            coins: rgData.coins,
            garden: rgData.garden,
            inventory: rgData.inventory,
            message
        });

    } catch (error) {
        console.error('Redeem error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

export default router;