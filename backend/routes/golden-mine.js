import express from 'express';
import User from '../models/user.js';
import EarningsTracker from '../services/earnings-tracker.js';
import {
    GOLDEN_MINE_ORE_TYPES,
    ensureGoldenMineStructures,
    loadOreIntoVehicleCrate,
    unloadOreFromVehicleCrate,
    summarizeGoldenMineTransport,
    summarizeGoldenMineInventories,
    calculateOreSaleValue,
    beginVehicleTravel,
    settleAllVehicleTravel
} from '../services/golden-mine-transportation.js';

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
const HELICOPTER_TRAVEL_TIME = process.env.FAST_MODE === 'true' ? 5 : 15 * 60;
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

function ensureGoldenMineInventoryObjects(progress) {
    if (!progress.inventory) {
        progress.inventory = {};
    }
    if (!progress.mineInventory) {
        progress.mineInventory = {};
    }
    if (!progress.factoryInventory) {
        progress.factoryInventory = {};
    }
}

function syncMineInventoryLegacy(progress) {
    ensureGoldenMineInventoryObjects(progress);
    let mineUpdated = false;
    let legacyUpdated = false;

    GOLDEN_MINE_ORE_TYPES.forEach((oreType) => {
        const mineValue = Number(progress.mineInventory?.[oreType] || 0);
        const legacyValue = Number(progress.inventory?.[oreType] || 0);

        if (mineValue === 0 && legacyValue > 0) {
            progress.mineInventory[oreType] = legacyValue;
            mineUpdated = true;
        } else if (mineValue !== legacyValue) {
            progress.inventory[oreType] = mineValue;
            legacyUpdated = true;
        }
    });

    return { mineUpdated, legacyUpdated };
}

function hydrateCratesFromLegacyCargo(progress) {
    const truck = progress?.transport?.vehicles?.truck;
    if (!truck || !Array.isArray(truck.crates)) {
        return false;
    }

    const legacyCargo = progress.truckCargo?.toObject ? progress.truckCargo.toObject() : progress.truckCargo;
    if (!legacyCargo || typeof legacyCargo !== 'object') {
        return false;
    }

    let updated = false;
    truck.crates = truck.crates.map((crate) => {
        const legacyAmount = Number(legacyCargo[crate.type] || 0);
        if (legacyAmount > 0 && Number(crate.amount || 0) === 0) {
            updated = true;
            return { ...crate, amount: legacyAmount };
        }
        return crate;
    });

    if (updated) {
        progress.transport.vehicles.truck = {
            ...truck,
            crates: truck.crates
        };
    }

    return updated;
}

function syncTruckCargoLegacy(progress) {
    const truck = progress?.transport?.vehicles?.truck;
    if (!truck || !Array.isArray(truck.crates)) {
        return false;
    }

    if (!progress.truckCargo) {
        progress.truckCargo = {};
    }

    let changed = false;
    GOLDEN_MINE_ORE_TYPES.forEach((oreType) => {
        const crate = truck.crates.find((entry) => entry.type === oreType);
        const crateAmount = Number(crate?.amount || 0);
        if (Number(progress.truckCargo[oreType] || 0) !== crateAmount) {
            progress.truckCargo[oreType] = crateAmount;
            changed = true;
        }
    });

    return changed;
}

function sumInventoryValues(inventory = {}) {
    return GOLDEN_MINE_ORE_TYPES.reduce((total, oreType) => {
        return total + (parseInt(inventory?.[oreType], 10) || 0);
    }, 0);
}

function flushVehicleToInventory(user, vehicleKind, targetInventoryKey) {
    if (!user?.goldenMineProgress) {
        return { transferred: 0, perOre: {} };
    }

    const perOre = {};
    let totalTransferred = 0;

    GOLDEN_MINE_ORE_TYPES.forEach((oreType) => {
        const result = unloadOreFromVehicleCrate({
            progress: user.goldenMineProgress,
            vehicleKind,
            oreType,
            targetInventoryKey
        });

        if (result.transferred > 0) {
            perOre[oreType] = result.transferred;
            totalTransferred += result.transferred;
            if (targetInventoryKey === 'mineInventory') {
                user.goldenMineProgress.inventory[oreType] = user.goldenMineProgress.mineInventory[oreType];
            }
        }
    });

    return { transferred: totalTransferred, perOre };
}

function hydrateVehicleLocationFromLegacy(progress) {
    const truck = progress?.transport?.vehicles?.truck;
    if (!truck) {
        return false;
    }

    let updated = false;
    if (progress.truckLocation && truck.location !== progress.truckLocation) {
        truck.location = progress.truckLocation;
        updated = true;
    }

    if (progress.truckDepartureTime) {
        const legacyDeparture = new Date(progress.truckDepartureTime);
        const vehicleDeparture = truck.departureTime ? new Date(truck.departureTime) : null;
        if (!vehicleDeparture || vehicleDeparture.getTime() !== legacyDeparture.getTime()) {
            truck.departureTime = legacyDeparture;
            updated = true;
        }
    }

    if (updated) {
        progress.transport.vehicles.truck = { ...truck };
    }

    return updated;
}

function syncLegacyTruckFromTransport(progress) {
    const truck = progress?.transport?.vehicles?.truck;
    if (!truck) {
        return false;
    }

    let changed = false;
    if (progress.truckLocation !== truck.location) {
        progress.truckLocation = truck.location;
        changed = true;
    }

    const vehicleDeparture = truck.departureTime ? new Date(truck.departureTime) : null;
    const legacyDeparture = progress.truckDepartureTime ? new Date(progress.truckDepartureTime) : null;
    const vehicleMs = vehicleDeparture ? vehicleDeparture.getTime() : null;
    const legacyMs = legacyDeparture ? legacyDeparture.getTime() : null;

    if (vehicleMs !== legacyMs) {
        progress.truckDepartureTime = vehicleDeparture;
        changed = true;
    }

    return changed;
}

function propagateTransportToLegacy(user) {
    if (!user?.goldenMineProgress) {
        return false;
    }
    const changed = syncLegacyTruckFromTransport(user.goldenMineProgress);
    if (changed) {
        user.markModified('goldenMineProgress.truckLocation');
        user.markModified('goldenMineProgress.truckDepartureTime');
    }
    return changed;
}

function getGoldenMineTransportOptions(user) {
    return {
        hasHelicopter: Boolean(user?.goldenMineUpgrades?.helicopterTransport),
        noCrateLimits: Boolean(user?.goldenMineUpgrades?.noCrateLimits),
        truckTravelTimeSeconds: getTruckTravelTime(user),
        helicopterTravelTimeSeconds: HELICOPTER_TRAVEL_TIME
    };
}

function ensureGoldenMineCompatibility(user) {
    if (!user?.goldenMineProgress) {
        return {};
    }

    const progress = user.goldenMineProgress;
    const structureResult = ensureGoldenMineStructures(progress, getGoldenMineTransportOptions(user));
    let productionFlowUpdated = false;
    if (!progress.productionFlowVersion || progress.productionFlowVersion < 1) {
        progress.productionFlowVersion = 1;
        productionFlowUpdated = true;
    }
    const locationHydrated = hydrateVehicleLocationFromLegacy(progress);
    const cratesHydrated = hydrateCratesFromLegacyCargo(progress);
    const inventorySync = syncMineInventoryLegacy(progress);
    const cargoSynced = syncTruckCargoLegacy(progress);

    if (structureResult.transportUpdated || cratesHydrated || locationHydrated) {
        user.markModified('goldenMineProgress.transport');
    }
    if (structureResult.mineInventoryUpdated || inventorySync.mineUpdated) {
        user.markModified('goldenMineProgress.mineInventory');
    }
    if (structureResult.factoryInventoryUpdated) {
        user.markModified('goldenMineProgress.factoryInventory');
    }
    if (inventorySync.legacyUpdated) {
        user.markModified('goldenMineProgress.inventory');
    }
    if (cargoSynced) {
        user.markModified('goldenMineProgress.truckCargo');
    }
    if (productionFlowUpdated) {
        user.markModified('goldenMineProgress.productionFlowVersion');
    }

    const legacyLocationSynced = propagateTransportToLegacy(user);

    return {
        transportUpdated: structureResult.transportUpdated || cratesHydrated || locationHydrated,
        inventoryUpdated: inventorySync.legacyUpdated,
        mineInventoryUpdated: inventorySync.mineUpdated,
        factoryInventoryUpdated: structureResult.factoryInventoryUpdated,
        cargoSynced,
        legacyLocationSynced,
        productionFlowUpdated
    };
}

function updateVehicleTravelStates(user, now = new Date()) {
    if (!user?.goldenMineProgress) {
        return false;
    }
    const travelResult = settleAllVehicleTravel(user.goldenMineProgress, now);
    let changed = false;
    if (travelResult.updated) {
        user.markModified('goldenMineProgress.transport');
        changed = true;
    }
    if (propagateTransportToLegacy(user)) {
        changed = true;
    }
    return changed;
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

    ensureGoldenMineInventoryObjects(progress);

    const currentValue = parseInt(progress.mineInventory[oreType], 10) || 0;
    progress.mineInventory[oreType] = currentValue + collectedAmount;
    progress.inventory[oreType] = progress.mineInventory[oreType];
    progress.totalOreMined = (progress.totalOreMined || 0) + collectedAmount;

    mine.state = 'resting';
    mine.timeLeft = REST_TIME;
    mine.lastStateChange = options.now || new Date();
    mine.oreProduced = 0;

    user.markModified('goldenMineProgress.mineInventory');
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
                mineInventory: {},
                factoryInventory: {},
                transport: {},
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

        const compatibilityFlags = ensureGoldenMineCompatibility(user);

        // Update mine states based on time
        const now = new Date();
        const travelTime = getTruckTravelTime(user);
        const autoCollect = hasAutoCollect(user);
        const autoCollected = {};
        let needsSave = Boolean(
            compatibilityFlags.transportUpdated ||
            compatibilityFlags.inventoryUpdated ||
            compatibilityFlags.mineInventoryUpdated ||
            compatibilityFlags.factoryInventoryUpdated ||
            compatibilityFlags.cargoSynced ||
            compatibilityFlags.legacyLocationSynced ||
            compatibilityFlags.productionFlowUpdated
        );

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

        if (updateVehicleTravelStates(user, now)) {
            needsSave = true;
        }

        if (needsSave) {
            await user.save();
        }

        const inventories = summarizeGoldenMineInventories(user.goldenMineProgress);

        const payload = {
            coins: user.goldenMineProgress.coins,
            mines: user.goldenMineProgress.mines,
            inventory: Object.fromEntries(
                Object.entries(user.goldenMineProgress.inventory.toObject ? user.goldenMineProgress.inventory.toObject() : user.goldenMineProgress.inventory).map(([k, v]) => [k, parseInt(v)])
            ),
            mineInventory: inventories.mineInventory,
            factoryInventory: inventories.factoryInventory,
            truckLocation: user.goldenMineProgress.truckLocation,
            truckCargo: Object.fromEntries(
                Object.entries(user.goldenMineProgress.truckCargo.toObject ? user.goldenMineProgress.truckCargo.toObject() : user.goldenMineProgress.truckCargo).map(([k, v]) => [k, parseInt(v)])
            ),
            totalMinesOwned: user.goldenMineProgress.totalMinesOwned,
            totalOreMined: user.goldenMineProgress.totalOreMined,
            totalCoinsEarned: user.goldenMineProgress.totalCoinsEarned,
            truckTravelTime: travelTime,
            transport: summarizeGoldenMineTransport(user.goldenMineProgress),
            productionFlow: {
                version: user.goldenMineProgress.productionFlowVersion || 1,
                stages: ['mine_inventory', 'vehicle_crates', 'factory_inventory']
            },
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

        const inventoryPayload = user.goldenMineProgress.inventory.toObject ? user.goldenMineProgress.inventory.toObject() : user.goldenMineProgress.inventory;
        const mineInventoryPayload = user.goldenMineProgress.mineInventory.toObject ? user.goldenMineProgress.mineInventory.toObject() : user.goldenMineProgress.mineInventory;

        res.json({
            success: true,
            collected: result.amount,
            oreType: mine.type,
            newInventory: inventoryPayload,
            mineInventory: mineInventoryPayload
        });

    } catch (error) {
        console.error('Error collecting ore:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Load truck
router.post('/load_truck', async (req, res) => {
    try {
        const { username, oreType, amount, vehicle = 'truck' } = req.body;

        if (!GOLDEN_MINE_ORE_TYPES.includes(oreType)) {
            return res.status(400).json({ error: 'Invalid ore type' });
        }

        const numericAmount = Math.max(0, parseInt(amount, 10) || 0);
        if (numericAmount <= 0) {
            return res.status(400).json({ error: 'Amount must be greater than zero' });
        }

        const user = await User.findOne({ username });
        if (!user || !user.goldenMineProgress) {
            return res.status(404).json({ error: 'User not found' });
        }

        ensureGoldenMineCompatibility(user);

        const vehicleState = user.goldenMineProgress.transport?.vehicles?.[vehicle];
        if (!vehicleState) {
            return res.status(400).json({ error: 'Vehicle is not available' });
        }

        if (vehicleState.location !== 'mine') {
            return res.status(400).json({ error: 'Vehicle is not at the mine' });
        }

        const loadResult = loadOreIntoVehicleCrate({
            progress: user.goldenMineProgress,
            vehicleKind: vehicle,
            oreType,
            amount: numericAmount,
            sourceInventoryKey: 'mineInventory',
            transportOptions: getGoldenMineTransportOptions(user)
        });

        if (!loadResult.transferred || loadResult.transferred <= 0) {
            const reason = loadResult.reason || 'UNKNOWN';
            const reasonMessage = {
                INVALID_AMOUNT: 'Amount must be greater than zero',
                NO_SOURCE_ORE: 'Not enough ore in mine inventory',
                CRATE_NOT_FOUND: 'Crate is not available',
                CRATE_FULL: 'Crate capacity reached'
            }[reason] || 'Unable to load ore into vehicle';
            return res.status(400).json({ error: reasonMessage });
        }

        user.goldenMineProgress.inventory[oreType] = user.goldenMineProgress.mineInventory[oreType];
        if (syncTruckCargoLegacy(user.goldenMineProgress)) {
            user.markModified('goldenMineProgress.truckCargo');
        }

        user.markModified('goldenMineProgress.mineInventory');
        user.markModified('goldenMineProgress.inventory');
        user.markModified('goldenMineProgress.transport');

        await user.save();

        res.json({
            success: true,
            transferred: loadResult.transferred,
            newInventory: user.goldenMineProgress.inventory.toObject ? user.goldenMineProgress.inventory.toObject() : user.goldenMineProgress.inventory,
            newCargo: user.goldenMineProgress.truckCargo.toObject ? user.goldenMineProgress.truckCargo.toObject() : user.goldenMineProgress.truckCargo,
            crate: loadResult.crate,
            transport: summarizeGoldenMineTransport(user.goldenMineProgress)
        });

    } catch (error) {
        console.error('Error loading truck:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.post('/unload_vehicle', async (req, res) => {
    try {
        const { username, oreType, amount, vehicle = 'truck', target } = req.body;

        if (!GOLDEN_MINE_ORE_TYPES.includes(oreType)) {
            return res.status(400).json({ error: 'Invalid ore type' });
        }

        const user = await User.findOne({ username });
        if (!user || !user.goldenMineProgress) {
            return res.status(404).json({ error: 'User not found' });
        }

        ensureGoldenMineCompatibility(user);

        const vehicleState = user.goldenMineProgress.transport?.vehicles?.[vehicle];
        if (!vehicleState) {
            return res.status(400).json({ error: 'Vehicle is not available' });
        }

        const location = vehicleState.location;
        const inferredTarget = target || (location === 'factory' ? 'factoryInventory' : 'mineInventory');
        if (!['factoryInventory', 'mineInventory'].includes(inferredTarget)) {
            return res.status(400).json({ error: 'Invalid unload target' });
        }
        if (inferredTarget === 'factoryInventory' && location !== 'factory') {
            return res.status(400).json({ error: 'Vehicle must be at the factory to unload into factory inventory' });
        }
        if (inferredTarget === 'mineInventory' && location !== 'mine') {
            return res.status(400).json({ error: 'Vehicle must be at the mine to unload into mine inventory' });
        }

        const unloadResult = unloadOreFromVehicleCrate({
            progress: user.goldenMineProgress,
            vehicleKind: vehicle,
            oreType,
            amount,
            targetInventoryKey: inferredTarget
        });

        if (!unloadResult.transferred || unloadResult.transferred <= 0) {
            const reason = unloadResult.reason || 'CRATE_EMPTY';
            const reasonMessage = {
                CRATE_EMPTY: 'Crate has no ore to unload',
                CRATE_NOT_FOUND: 'Crate is not available',
                INVALID_AMOUNT: 'Invalid unload amount'
            }[reason] || 'Unable to unload vehicle';
            return res.status(400).json({ error: reasonMessage });
        }

        if (inferredTarget === 'mineInventory') {
            user.goldenMineProgress.inventory[oreType] = user.goldenMineProgress.mineInventory[oreType];
            user.markModified('goldenMineProgress.mineInventory');
            user.markModified('goldenMineProgress.inventory');
        } else {
            user.markModified('goldenMineProgress.factoryInventory');
        }

        user.markModified('goldenMineProgress.transport');
        if (syncTruckCargoLegacy(user.goldenMineProgress)) {
            user.markModified('goldenMineProgress.truckCargo');
        }

        await user.save();

        const mineInventory = user.goldenMineProgress.mineInventory.toObject ? user.goldenMineProgress.mineInventory.toObject() : user.goldenMineProgress.mineInventory;
        const factoryInventory = user.goldenMineProgress.factoryInventory.toObject ? user.goldenMineProgress.factoryInventory.toObject() : user.goldenMineProgress.factoryInventory;

        res.json({
            success: true,
            transferred: unloadResult.transferred,
            crate: unloadResult.crate,
            targetInventoryKey: inferredTarget,
            mineInventory,
            factoryInventory,
            transport: summarizeGoldenMineTransport(user.goldenMineProgress)
        });

    } catch (error) {
        console.error('Error unloading vehicle:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Send truck to factory
router.post('/send_truck', async (req, res) => {
    try {
        const { username, vehicle = 'truck' } = req.body;

        const user = await User.findOne({ username });
        if (!user || !user.goldenMineProgress) {
            return res.status(404).json({ error: 'User not found' });
        }

        ensureGoldenMineCompatibility(user);

        const vehicleState = user.goldenMineProgress.transport?.vehicles?.[vehicle];
        if (!vehicleState) {
            return res.status(400).json({ error: 'Vehicle is not available' });
        }

        if (vehicleState.location !== 'mine') {
            return res.status(400).json({ error: 'Vehicle is not at the mine' });
        }

        const hasCargo = (vehicleState.crates || []).some(crate => parseInt(crate.amount, 10) > 0);
        if (!hasCargo) {
            return res.status(400).json({ error: 'Vehicle has no cargo to deliver' });
        }

        beginVehicleTravel(user.goldenMineProgress, vehicle, 'factory', { now: new Date() });
        user.markModified('goldenMineProgress.transport');
        propagateTransportToLegacy(user);

        await user.save();

        res.json({
            success: true,
            transport: summarizeGoldenMineTransport(user.goldenMineProgress)
        });

    } catch (error) {
        console.error('Error sending truck:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Sell ore at factory
router.post('/sell_ore', async (req, res) => {
    try {
        const { username, vehicle = 'truck' } = req.body;

        const user = await User.findOne({ username });
        if (!user || !user.goldenMineProgress) {
            return res.status(404).json({ error: 'User not found' });
        }

        ensureGoldenMineCompatibility(user);

        const vehicleState = user.goldenMineProgress.transport?.vehicles?.[vehicle];
        if (!vehicleState) {
            return res.status(400).json({ error: 'Vehicle is not available' });
        }

        if (vehicleState.location !== 'factory') {
            return res.status(400).json({ error: 'Vehicle is not at the factory' });
        }

        let factoryInventory = user.goldenMineProgress.factoryInventory || {};
        let stagedOre = sumInventoryValues(factoryInventory);

        if (stagedOre <= 0) {
            const flushResult = flushVehicleToInventory(user, vehicle, 'factoryInventory');
            if (flushResult.transferred > 0) {
                user.markModified('goldenMineProgress.factoryInventory');
                user.markModified('goldenMineProgress.transport');
                if (syncTruckCargoLegacy(user.goldenMineProgress)) {
                    user.markModified('goldenMineProgress.truckCargo');
                }
                factoryInventory = user.goldenMineProgress.factoryInventory;
                stagedOre = sumInventoryValues(factoryInventory);
            }
        }

        if (stagedOre <= 0) {
            return res.status(400).json({ error: 'No ore staged at the factory. Unload crates first.' });
        }

        let totalCoins = 0;
        const saleDetails = [];

        GOLDEN_MINE_ORE_TYPES.forEach((oreType) => {
            const stagedAmount = parseInt(factoryInventory?.[oreType], 10) || 0;
            if (stagedAmount <= 0) {
                return;
            }

            const coins = calculateOreSaleValue(oreType, stagedAmount);
            const orePerCoin = MINE_TYPES[oreType]?.orePerCoin || 1;

            if (coins > 0) {
                totalCoins += coins;
                saleDetails.push({
                    type: oreType,
                    ore: stagedAmount,
                    coins,
                    orePerCoin
                });
            }

            user.goldenMineProgress.factoryInventory[oreType] = 0;
        });

        user.markModified('goldenMineProgress.factoryInventory');

        if (totalCoins <= 0) {
            return res.status(400).json({ error: 'No sellable ore available' });
        }

        user.goldenMineProgress.coins += totalCoins;
        user.goldenMineProgress.totalCoinsEarned += totalCoins;
        user.markModified('goldenMineProgress.coins');
        user.markModified('goldenMineProgress.totalCoinsEarned');

        const trackerResult = EarningsTracker.recordTransaction(user, {
            game: 'golden-mine',
            type: 'sell',
            amount: totalCoins,
            currency: 'game_coin',
            details: {
                source: 'ore-factory',
                sales: saleDetails
            }
        });

        await user.save();

        const factoryInventoryPayload = user.goldenMineProgress.factoryInventory.toObject
            ? user.goldenMineProgress.factoryInventory.toObject()
            : user.goldenMineProgress.factoryInventory;

        res.json({
            success: true,
            coinsEarned: totalCoins,
            newCoins: user.goldenMineProgress.coins,
            earningsTracker: trackerResult?.earnings,
            unlockedAchievements: trackerResult?.unlockedAchievements,
            transport: summarizeGoldenMineTransport(user.goldenMineProgress),
            factoryInventory: factoryInventoryPayload
        });

    } catch (error) {
        console.error('Error selling ore:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Return truck to mine
router.post('/return_truck', async (req, res) => {
    try {
        const { username, vehicle = 'truck' } = req.body;

        const user = await User.findOne({ username });
        if (!user || !user.goldenMineProgress) {
            return res.status(404).json({ error: 'User not found' });
        }

        ensureGoldenMineCompatibility(user);

        const vehicleState = user.goldenMineProgress.transport?.vehicles?.[vehicle];
        if (!vehicleState) {
            return res.status(400).json({ error: 'Vehicle is not available' });
        }

        if (vehicleState.location !== 'factory') {
            return res.status(400).json({ error: 'Vehicle is not at the factory' });
        }

        beginVehicleTravel(user.goldenMineProgress, vehicle, 'mine', { now: new Date() });
        user.markModified('goldenMineProgress.transport');
        propagateTransportToLegacy(user);

        await user.save();

        res.json({
            success: true,
            transport: summarizeGoldenMineTransport(user.goldenMineProgress)
        });

    } catch (error) {
        console.error('Error returning truck:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;