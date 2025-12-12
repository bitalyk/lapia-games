import express from 'express';
import User from '../models/user.js';
import EarningsTracker from '../services/earnings-tracker.js';
import {
    serializeFruitCrateSet,
    FarmPlanner
} from '../services/rich-garden-inventory.js';
import { TransportFleet, VEHICLE_PRESETS } from '../services/rich-garden-transport.js';

const router = express.Router();

// Tree configuration
const TREE_TYPES = {
    banana: { cost: 1000, fps: 1, fruitsPerCoin: 100, level: 1, name: "Banana Tree" },
    apple: { cost: 2500, fps: 2, fruitsPerCoin: 80, level: 2, name: "Apple Tree" },
    orange: { cost: 10000, fps: 5, fruitsPerCoin: 50, level: 3, name: "Orange Tree" },
    pomegranate: { cost: 25000, fps: 10, fruitsPerCoin: 40, level: 4, name: "Pomegranate Tree" },
    mango: { cost: 100000, fps: 20, fruitsPerCoin: 20, level: 5, name: "Mango Tree" },
    durian: { cost: 500000, fps: 50, fruitsPerCoin: 10, level: 6, name: "Durian Tree" }
};

const LEGACY_TREE_KEYS = {
    common: 'banana',
    bronze: 'apple',
    silver: 'orange',
    golden: 'pomegranate',
    platinum: 'mango',
    diamond: 'durian'
};

const GARDEN_SIZE = 10;

const GARDEN_MANAGEMENT_ENABLED = process.env.GARDEN_MANAGEMENT === 'true';

// Production constants
const PRODUCTION_TIME = process.env.FAST_MODE === 'true' ? 30 : 4 * 60 * 60; // 30s testing / 4h normal
const COLLECTION_TIME = 0; // Collection now resolves instantly into farm inventory
const TRUCK_TRAVEL_TIME = process.env.FAST_MODE === 'true' ? 10 : 60 * 60; // legacy constant

function hasGardenAutoCollect(user) {
    return Boolean(user?.richGardenUpgrades?.autoCollect);
}

function hasUnlimitedCrateUpgrade(user) {
    return Boolean(user?.richGardenUpgrades?.unlimitedCrates);
}

function hasHelicopterTransportUpgrade(user) {
    return Boolean(user?.richGardenUpgrades?.helicopterTransport);
}

function buildTransportOverrides(user) {
    const unlimited = hasUnlimitedCrateUpgrade(user);
    const overrides = {
        truck: {
            unlimitedFruit: unlimited,
            unlimitedTree: unlimited
        },
        enableHelicopter: hasHelicopterTransportUpgrade(user)
    };

    if (overrides.enableHelicopter) {
        overrides.helicopter = {
            unlimitedFruit: unlimited,
            unlimitedTree: unlimited
        };
    }

    return overrides;
}

function persistTransportFleet(progress, fleet) {
    if (!progress || !fleet) {
        return;
    }

    progress.transport = fleet.toJSON();

    const truckVehicle = fleet.truck;
    if (truckVehicle) {
        if (!progress.crates) {
            progress.crates = {};
        }
        progress.crates.fruit = serializeFruitCrateSet(truckVehicle.fruitCrates);
        progress.crates.tree = truckVehicle.treeCrate.toJSON();
        progress.truckInventory = summarizeFruitCrates(truckVehicle.fruitCrates);
        progress.truckLocation = truckVehicle.location;
        progress.truckDepartureTime = truckVehicle.departureTime;
    }
}

function ensureTransportState(user, options = {}) {
    const progress = user?.richGardenProgress;
    const overrides = buildTransportOverrides(user);
    if (!progress) {
        return { fleet: new TransportFleet({}, overrides), overrides, mutated: false };
    }

    if (!progress.transport || typeof progress.transport !== 'object') {
        progress.transport = {};
    }

    if (!progress.transport.truck) {
        progress.transport.truck = {};
    }

    let mutated = false;
    const truckState = progress.transport.truck;
    if (!truckState.location) {
        truckState.location = progress.truckLocation || 'farm';
        mutated = true;
    }
    if (!truckState.departureTime && progress.truckDepartureTime) {
        truckState.departureTime = progress.truckDepartureTime;
        mutated = true;
    }
    if (!truckState.fruitCrates && progress.crates?.fruit) {
        truckState.fruitCrates = progress.crates.fruit;
        mutated = true;
    }
    if (!truckState.treeCrate && progress.crates?.tree) {
        truckState.treeCrate = progress.crates.tree;
        mutated = true;
    }

    if (overrides.enableHelicopter && !progress.transport.helicopter) {
        progress.transport.helicopter = {};
        mutated = true;
    }

    if (!progress.transport.activeMode) {
        progress.transport.activeMode = 'truck';
        mutated = true;
    }

    const fleet = new TransportFleet(progress.transport, overrides);
    const now = options.now || new Date();
    const travelMutations = fleet.updateTravel(now);
    if (travelMutations || mutated) {
        persistTransportFleet(progress, fleet);
        return { fleet, overrides, mutated: true };
    }

    return { fleet, overrides, mutated: false };
}

function serializeVehicleState(vehicle, now = new Date()) {
    if (!vehicle) {
        return null;
    }
    const travelSummary = vehicle.getTravelSummary(now);
    return {
        mode: vehicle.mode,
        label: vehicle.label,
        ...travelSummary,
        fruitCrates: serializeFruitCrateSet(vehicle.fruitCrates),
        treeCrate: vehicle.treeCrate.toJSON(),
        cargo: summarizeFruitCrates(vehicle.fruitCrates)
    };
}

function resolveVehicleMode(fleet, requestedMode) {
    if (requestedMode === 'helicopter') {
        if (!fleet.helicopter) {
            return null;
        }
        return 'helicopter';
    }
    if (requestedMode === 'truck') {
        return 'truck';
    }
    if (fleet.activeMode === 'helicopter' && fleet.helicopter) {
        return 'helicopter';
    }
    return 'truck';
}

function getVehicleContext(fleet, requestedMode) {
    const mode = resolveVehicleMode(fleet, requestedMode);
    if (!mode) {
        return { error: 'VEHICLE_LOCKED' };
    }
    try {
        fleet.setActiveMode(mode);
    } catch (error) {
        return { error: error.message || 'VEHICLE_LOCKED' };
    }
    return { mode, vehicle: fleet.getActiveVehicle() };
}

function vehicleAtLocation(vehicle, location) {
    if (!vehicle) {
        return false;
    }
    return vehicle.location === location && !vehicle.isTraveling();
}

function getPremiumUnlockLevel(user) {
    return Number(user?.richGardenUpgrades?.premiumUnlockLevel) || 0;
}

function getTimingConfig(activeTravelSeconds = TRUCK_TRAVEL_TIME) {
    return {
        production: PRODUCTION_TIME,
        collection: COLLECTION_TIME,
        truckTravel: activeTravelSeconds
    };
}

function ensureDate(value) {
    return value ? new Date(value) : null;
}

function normalizeTreeType(type) {
    if (!type || typeof type !== 'string') {
        return null;
    }
    if (TREE_TYPES[type]) {
        return type;
    }
    const normalized = LEGACY_TREE_KEYS[type];
    return normalized && TREE_TYPES[normalized] ? normalized : null;
}

function normalizeResourceBuckets(resource = {}) {
    const source = typeof resource.toObject === 'function'
        ? resource.toObject()
        : { ...resource };
    const normalized = {};
    let modified = false;

    Object.entries(source).forEach(([type, amountRaw]) => {
        const amount = Number(amountRaw) || 0;
        if (amount <= 0) {
            if (amountRaw) {
                modified = true;
            }
            return;
        }

        const normalizedType = normalizeTreeType(type);
        if (!normalizedType) {
            modified = true;
            return;
        }

        normalized[normalizedType] = (normalized[normalizedType] || 0) + amount;
        if (normalizedType !== type) {
            modified = true;
        }
    });

    return { normalized, modified };
}

function toPlainResourceMap(resource = {}) {
    if (!resource) {
        return {};
    }
    if (typeof resource.toObject === 'function') {
        return resource.toObject();
    }
    return { ...resource };
}

function sanitizeInventoryPayload(resource = {}) {
    const source = toPlainResourceMap(resource);
    const sanitized = {};
    Object.entries(source).forEach(([type, amountRaw]) => {
        const normalizedType = normalizeTreeType(type);
        if (!normalizedType) {
            return;
        }
        const amount = Math.max(0, Number(amountRaw) || 0);
        if (amount <= 0) {
            return;
        }
        sanitized[normalizedType] = (sanitized[normalizedType] || 0) + amount;
    });
    return sanitized;
}

function getResourceEntries(resource = {}) {
    return Object.entries(toPlainResourceMap(resource));
}

function ensureFarmInventory(progress, options = {}) {
    if (!progress) {
        return options.withMeta ? { buckets: {}, modified: false } : {};
    }

    const source = progress.farmInventory || progress.inventory || {};
    const normalization = normalizeResourceBuckets(source);

    progress.farmInventory = normalization.normalized;
    progress.inventory = progress.farmInventory;

    if (options.withMeta) {
        return {
            buckets: progress.farmInventory,
            modified: Boolean(normalization.modified)
        };
    }

    return progress.farmInventory;
}

function summarizeFruitCrates(crateSet = {}) {
    const summary = {};
    Object.entries(crateSet).forEach(([type, crate]) => {
        const loaded = crate?.loaded ?? 0;
        summary[type] = Math.max(0, Number.isFinite(loaded) ? Math.floor(loaded) : 0);
    });
    return summary;
}

function buildVehicleTransportMetrics(vehicle) {
    const defaultMetrics = {
        mode: vehicle?.mode || null,
        location: vehicle?.location || null,
        fruit: { loaded: 0, capacity: 0, percent: 0, unlimited: false },
        tree: { queued: 0, capacity: 0, availableSlots: 0, unlimited: false },
        canSell: false
    };

    if (!vehicle) {
        return defaultMetrics;
    }

    const fruitSummary = {
        loaded: 0,
        capacity: 0,
        percent: 0,
        unlimited: Boolean(vehicle.unlimitedFruit)
    };
    let hasSellableCargo = false;

    Object.entries(vehicle.fruitCrates || {}).forEach(([type, crate]) => {
        if (!crate) {
            return;
        }
        const loaded = Math.max(0, Number(crate.loaded) || 0);
        fruitSummary.loaded += loaded;

        if (crate.unlimited) {
            fruitSummary.unlimited = true;
        }

        if (!fruitSummary.unlimited) {
            const effectiveCapacity = typeof crate.effectiveCapacity === 'number'
                ? crate.effectiveCapacity
                : Math.max(0, Number(crate.capacity) || 0) * Math.max(1, Number(crate.multiplier) || 1);
            fruitSummary.capacity += effectiveCapacity;
        }

        if (!hasSellableCargo) {
            const treeType = TREE_TYPES[type];
            const fruitsPerCoin = treeType?.fruitsPerCoin || 0;
            if (fruitsPerCoin > 0 && loaded >= fruitsPerCoin) {
                hasSellableCargo = true;
            }
        }
    });

    if (fruitSummary.unlimited) {
        fruitSummary.capacity = null;
        fruitSummary.percent = 0;
    } else {
        fruitSummary.capacity = Math.max(0, fruitSummary.capacity);
        fruitSummary.percent = fruitSummary.capacity > 0
            ? Math.min(100, Math.round((fruitSummary.loaded / fruitSummary.capacity) * 100))
            : 0;
    }

    const treeCrate = vehicle.treeCrate;
    const treeSummary = treeCrate ? {
        queued: treeCrate.totalTrees,
        capacity: treeCrate.unlimited ? null : treeCrate.effectiveCapacity,
        availableSlots: treeCrate.unlimited ? null : treeCrate.availableSlots,
        unlimited: treeCrate.unlimited
    } : { queued: 0, capacity: 0, availableSlots: 0, unlimited: false };

    return {
        mode: vehicle.mode,
        location: vehicle.location,
        fruit: fruitSummary,
        tree: treeSummary,
        canSell: !vehicle.isTraveling() && vehicle.location === 'city' && hasSellableCargo
    };
}

function cleanupResourceMap(map = {}) {
    Object.keys(map).forEach((key) => {
        if (!map[key] || map[key] <= 0) {
            delete map[key];
        }
    });
}

function harvestTreeToFarmInventory({
    progress,
    tree,
    typeKey,
    treeConfig,
    farmInventory,
    collectedSummary,
    now = new Date()
} = {}) {
    if (!progress || !tree || !typeKey || !treeConfig || !farmInventory) {
        return 0;
    }

    const fruitsPerCycle = Math.max(0, Number(treeConfig.fps) || 0) * PRODUCTION_TIME;
    if (fruitsPerCycle <= 0) {
        return 0;
    }

    farmInventory[typeKey] = (farmInventory[typeKey] || 0) + fruitsPerCycle;
    if (collectedSummary) {
        collectedSummary[typeKey] = (collectedSummary[typeKey] || 0) + fruitsPerCycle;
    }

    const currentTotal = Number(progress.totalFruitsCollected) || 0;
    progress.totalFruitsCollected = currentTotal + fruitsPerCycle;

    tree.state = 'producing';
    tree.collectionStartTime = null;
    tree.plantedAt = now;
    tree.timeLeft = PRODUCTION_TIME;
    tree.lastCollected = now;

    return fruitsPerCycle;
}

function buildPlantingSummary(progress = {}) {
    const planner = new FarmPlanner({
        garden: progress.garden || [],
        treeDefinitions: TREE_TYPES,
        size: GARDEN_SIZE
    });
    return planner.getPlantingSummary();
}

function collectQueuedTreeCounts(progress = {}) {
    const counts = {};
    const merge = (queued) => {
        if (!queued) {
            return;
        }
        Object.entries(queued).forEach(([type, amount]) => {
            const normalizedType = normalizeTreeType(type);
            const value = Math.max(0, Number(amount) || 0);
            if (!normalizedType || value <= 0) {
                return;
            }
            counts[normalizedType] = (counts[normalizedType] || 0) + value;
        });
    };

    merge(progress.transport?.truck?.treeCrate?.queued);
    merge(progress.transport?.helicopter?.treeCrate?.queued);
    merge(progress.crates?.tree?.queued);
    merge(progress.treeCrate?.queued);

    return counts;
}

function getQueuedTreeCount(progress = {}, treeType) {
    const normalized = normalizeTreeType(treeType);
    if (!normalized) {
        return 0;
    }
    const counts = collectQueuedTreeCounts(progress);
    return counts[normalized] || 0;
}

function buildTreeView(tree, now = new Date()) {
    if (!tree) return null;

    const normalizedType = normalizeTreeType(tree.type);
    if (!normalizedType) {
        return null;
    }

    const plantedAt = ensureDate(tree.plantedAt);
    const collectionStart = ensureDate(tree.collectionStartTime);
    const baseState = tree.state || 'producing';

    let phase = baseState;
    let secondsRemaining = 0;
    let secondsElapsed = 0;

    if (baseState === 'collecting') {
        // Legacy collecting states are considered immediately ready
        phase = 'ready';
        secondsElapsed = 0;
        secondsRemaining = 0;
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
        type: normalizedType,
        state: baseState,
        phase,
        plantedAt: plantedAt ? plantedAt.toISOString() : null,
        collectionStartTime: collectionStart ? collectionStart.toISOString() : null,
        secondsRemaining,
        secondsElapsed,
        level: TREE_TYPES[normalizedType]?.level ?? null
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
    const gardenView = buildGardenView(progress.garden || [], now);
    const farmInventoryMeta = ensureFarmInventory(progress, { withMeta: true });
    const farmInventory = farmInventoryMeta.buckets;
    if (farmInventoryMeta.modified) {
        modified = true;
    }
    const farmInventoryPayload = sanitizeInventoryPayload(farmInventory);

    const fleet = options.transportFleet
        || new TransportFleet(progress.transport || {}, options.transportOverrides || {});
    const transportPayload = {
        activeMode: fleet.activeMode,
        truck: serializeVehicleState(fleet.truck, now),
        helicopter: fleet.helicopter ? serializeVehicleState(fleet.helicopter, now) : null
    };

    const activeVehicle = fleet.getActiveVehicle();
    const activeVehicleState = serializeVehicleState(activeVehicle, now) || {};
    const transportMetrics = buildVehicleTransportMetrics(activeVehicle);
    const truckInventory = sanitizeInventoryPayload(activeVehicleState.cargo || {});
    const fruitCrates = activeVehicleState.fruitCrates || {};
    const treeCrate = activeVehicleState.treeCrate || { capacity: 0, queued: {} };
    const plantingSummary = buildPlantingSummary(progress);
    const aggregatedQueuedByType = collectQueuedTreeCounts(progress);
    const treeCrateSummary = {
        queued: transportMetrics.tree.queued,
        availableSlots: transportMetrics.tree.availableSlots,
        capacity: transportMetrics.tree.capacity,
        unlimited: transportMetrics.tree.unlimited,
        queuedByType: { ...(treeCrate.queued || {}) },
        globalQueuedByType: aggregatedQueuedByType,
        vehicleCapacity: {
            truck: VEHICLE_PRESETS.truck?.treeCapacity ?? 5,
            helicopter: VEHICLE_PRESETS.helicopter?.treeCapacity ?? 0
        }
    };

    const truck = {
        location: activeVehicleState.location || 'farm',
        rawLocation: activeVehicleState.location || 'farm',
        isTraveling: Boolean(activeVehicleState.isTraveling),
        secondsRemaining: activeVehicleState.secondsRemaining || 0,
        departureTime: activeVehicleState.departureTime || null,
        cargo: truckInventory
    };

    const activeTravelSeconds = activeVehicle?.travelSeconds || TRUCK_TRAVEL_TIME;

    return {
        success: true,
        coins: progress.coins ?? 0,
        garden: gardenView,
        inventory: farmInventoryPayload,
        farmInventory: farmInventoryPayload,
        truckInventory,
        truck,
        truckLocation: truck.location,
        truckDepartureTime: truck.departureTime,
        fruitCrates,
        treeCrate,
        treeCrateSummary,
        plantingSummary,
        transport: transportPayload,
        transportMetrics,
        canSellFruits: transportMetrics.canSell,
        gardenManagementEnabled: GARDEN_MANAGEMENT_ENABLED,
        timers: getTimingConfig(activeTravelSeconds),
        treeTypes: TREE_TYPES,
        upgrades: {
            autoCollect,
            helicopterTransport: hasHelicopterTransportUpgrade(options.user)
        },
        ...options.extras
    };
}

function buildUserGardenResponse(user, options = {}) {
    const now = options.now || new Date();
    const autoCollect = hasGardenAutoCollect(user);
    const extras = options.extras || {};
    const transportContext = options.transportContext || ensureTransportState(user, { now });
    return buildGamePayload(user.richGardenProgress, {
        now,
        extras,
        autoCollect,
        transportFleet: transportContext.fleet,
        transportOverrides: transportContext.overrides,
        user
    });
}

function synchronizeGardenState(progress = {}, now = new Date(), options = {}) {
    const collected = {};
    let modified = false;
    const autoCollect = Boolean(options.autoCollect);

    if (!progress) {
        return { modified, collected };
    }

    const farmInventoryMeta = ensureFarmInventory(progress, { withMeta: true });
    const farmInventory = farmInventoryMeta.buckets;
    if (farmInventoryMeta.modified) {
        modified = true;
    }

    if (!progress.truckInventory) {
        progress.truckInventory = {};
        modified = true;
    }

    if (!Number.isFinite(progress.totalFruitsCollected)) {
        progress.totalFruitsCollected = 0;
        modified = true;
    }

    if (!Number.isFinite(progress.totalCoinsEarned)) {
        progress.totalCoinsEarned = Number(progress.totalCoinsEarned) || 0;
    }

    // Farm inventory already normalized via ensureFarmInventory

    const truckInventoryNormalization = normalizeResourceBuckets(progress.truckInventory || {});
    progress.truckInventory = truckInventoryNormalization.normalized;
    if (truckInventoryNormalization.modified) {
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

        const normalizedType = normalizeTreeType(tree.type);
        if (!normalizedType) {
            progress.garden[i] = null;
            modified = true;
            continue;
        }

        if (tree.type !== normalizedType) {
            tree.type = normalizedType;
            modified = true;
        }

        const treeType = TREE_TYPES[normalizedType];
        if (!treeType) {
            progress.garden[i] = null;
            modified = true;
            continue;
        }

        if (tree.state === 'collecting') {
            const harvested = harvestTreeToFarmInventory({
                progress,
                tree,
                typeKey: normalizedType,
                treeConfig: treeType,
                farmInventory: progress.farmInventory,
                collectedSummary: collected,
                now
            });
            if (harvested > 0) {
                modified = true;
            }
        }

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

        if (autoCollect && tree.state === 'ready') {
            const harvested = harvestTreeToFarmInventory({
                progress,
                tree,
                typeKey: normalizedType,
                treeConfig: treeType,
                farmInventory: progress.farmInventory,
                collectedSummary: collected,
                now
            });
            if (harvested > 0) {
                modified = true;
            }
        }
    }

    return { modified, collected };
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

        const transportContext = ensureTransportState(user, { now });

        const autoCollect = hasGardenAutoCollect(user);
        const syncResult = synchronizeGardenState(user.richGardenProgress, now, { autoCollect });
        if (syncResult.modified || transportContext.mutated) {
            user.markModified('richGardenProgress');
            await user.save();
        }

        const extras = {};
        if (Object.keys(syncResult.collected).length > 0) {
            extras.collected = syncResult.collected;
        }

        return res.json(buildUserGardenResponse(user, { now, extras, transportContext }));

    } catch (error) {
        console.error('Rich Garden status error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Buy tree
router.post('/buy_tree', async (req, res) => {
    try {
        const { username, cellIndex, queueOnly, vehicle: requestedVehicle, treeType } = req.body;
        const queueOnlyMode = Boolean(queueOnly);
        const targetCell = Number(cellIndex);
        const requestedType = typeof treeType === 'string' ? treeType : 'banana';
        const normalizedType = normalizeTreeType(requestedType) || 'banana';

        if (!TREE_TYPES[normalizedType]) {
            return res.status(400).json({ error: 'Tree type unavailable.' });
        }

        const treeConfig = TREE_TYPES[normalizedType];

        if (!queueOnlyMode) {
            if (!Number.isInteger(targetCell) || targetCell < 0 || targetCell >= GARDEN_SIZE) {
                return res.status(400).json({ error: 'Invalid cell index' });
            }
        }

        const user = await User.findOne({ username });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const rgData = user.richGardenProgress;
        if (!rgData) {
            return res.status(400).json({ error: 'Rich Garden data not initialized' });
        }

        const plantingSummary = buildPlantingSummary(rgData);
        if (!plantingSummary?.[normalizedType]?.canPlant) {
            return res.status(400).json({ error: 'Garden already full of equal or higher-tier trees.' });
        }

        const availableTargets = Array.isArray(plantingSummary?.[normalizedType]?.targets)
            ? plantingSummary[normalizedType].targets.length
            : 0;
        const queuedCounts = collectQueuedTreeCounts(rgData);
        const queuedForType = queuedCounts[normalizedType] || 0;
        if (availableTargets - queuedForType <= 0) {
            return res.status(400).json({ error: 'All matching slots are already reserved by staged saplings. Plant or upgrade existing trees first.' });
        }

        const now = new Date();
        const transportContext = ensureTransportState(user, { now });
        const selection = getVehicleContext(transportContext.fleet, requestedVehicle);
        if (selection.error) {
            return res.status(400).json({ error: 'Selected vehicle is locked' });
        }

        const { vehicle, mode } = selection;

        if (vehicle.isTraveling()) {
            return res.status(400).json({ error: 'Selected vehicle is currently traveling' });
        }

        if (!vehicleAtLocation(vehicle, 'city')) {
            return res.status(400).json({ error: 'Vehicle must be at the city to buy trees' });
        }

        if (!queueOnlyMode) {
            for (let i = 0; i < targetCell; i += 1) {
                if (!rgData.garden[i]) {
                    return res.status(400).json({ error: 'Must buy trees sequentially' });
                }
            }

            if (rgData.garden[targetCell]) {
                return res.status(400).json({ error: 'Cell already has a tree' });
            }
        }

        const treeCrate = vehicle.treeCrate;
        if (!treeCrate) {
            return res.status(400).json({ error: 'Tree crate is unavailable on this vehicle' });
        }

        if (!treeCrate.unlimited && treeCrate.availableSlots <= 0) {
            return res.status(400).json({ error: 'Tree crate is full. Deliver trees before buying more.' });
        }

        if (rgData.coins < treeConfig.cost) {
            return res.status(400).json({ error: 'Not enough coins' });
        }

        const queued = treeCrate.queueTrees(normalizedType, 1);
        if (queued <= 0) {
            return res.status(400).json({ error: 'Tree crate is full. Deliver trees before buying more.' });
        }
        rgData.coins -= treeConfig.cost;

        persistTransportFleet(rgData, transportContext.fleet);

        user.markModified('richGardenProgress');
        await user.save();

        return res.json(buildUserGardenResponse(user, {
            now,
            extras: { treeCrateQueued: true, vehicle: mode, treeType: normalizedType },
            transportContext
        }));

    } catch (error) {
        console.error('Buy tree error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Upgrade tree
router.post('/upgrade_tree', async (req, res) => {
    try {
        const { username, cellIndex, vehicle: requestedVehicle } = req.body;

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
        const transportContext = ensureTransportState(user, { now });
        const selection = getVehicleContext(transportContext.fleet, requestedVehicle);
        if (selection.error) {
            return res.status(400).json({ error: 'Selected vehicle is locked' });
        }

        const { vehicle } = selection;
        if (vehicle.isTraveling()) {
            return res.status(400).json({ error: 'Selected vehicle is currently traveling' });
        }

        if (vehicle.location !== 'city') {
            return res.status(400).json({ error: 'Vehicle must be at the city to upgrade trees' });
        }

        const tree = rgData.garden[cellIndex];
        if (!tree) {
            return res.status(400).json({ error: 'No tree in this cell' });
        }

        const normalizedType = normalizeTreeType(tree.type);
        if (!normalizedType) {
            return res.status(400).json({ error: 'Tree data is invalid, please refresh and try again' });
        }

        if (tree.type !== normalizedType) {
            tree.type = normalizedType;
        }

        const treeConfig = TREE_TYPES[normalizedType];
        const currentLevel = treeConfig.level;
        if (currentLevel >= 6) {
            return res.status(400).json({ error: 'Tree is already at maximum level' });
        }

        const nextLevel = currentLevel + 1;

        const ownedLevels = rgData.garden
            .filter(t => t)
            .map(t => {
                const type = normalizeTreeType(t.type);
                return type ? TREE_TYPES[type]?.level || 0 : 0;
            });
        const maxOwnedLevel = ownedLevels.length > 0
            ? Math.max(...ownedLevels)
            : currentLevel;
        const premiumUnlockLevel = getPremiumUnlockLevel(user);
        const bypassRequirement = premiumUnlockLevel >= nextLevel;

        if (nextLevel > maxOwnedLevel && !bypassRequirement) {
            const prevLevelTrees = rgData.garden.filter(t => {
                if (!t) {
                    return false;
                }
                const type = normalizeTreeType(t.type);
                return type ? TREE_TYPES[type]?.level === currentLevel : false;
            }).length;
            if (prevLevelTrees < 10) {
                return res.status(400).json({
                    error: `To unlock ${Object.values(TREE_TYPES).find(t => t.level === nextLevel)?.name || 'next level'}, you need 10 trees at ${treeConfig.name} level first.`
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

        persistTransportFleet(rgData, transportContext.fleet);

        user.markModified('richGardenProgress');
        await user.save();

        return res.json(buildUserGardenResponse(user, { now, transportContext }));

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
        const farmInventory = ensureFarmInventory(rgData);

        const treeToCollect = rgData.garden[cellIndex];
        if (!treeToCollect) {
            return res.status(400).json({ error: 'No tree in this cell' });
        }

        if (treeToCollect.state !== 'ready') {
            return res.status(400).json({ error: 'Tree is not ready for collection' });
        }
        const normalizedType = normalizeTreeType(treeToCollect.type);
        if (!normalizedType) {
            return res.status(400).json({ error: 'Unknown tree type, please refresh and try again' });
        }

        const treeConfig = TREE_TYPES[normalizedType];
        const harvested = harvestTreeToFarmInventory({
            progress: rgData,
            tree: treeToCollect,
            typeKey: normalizedType,
            treeConfig,
            farmInventory,
            collectedSummary: fruitsAdded,
            now
        });

        if (harvested <= 0) {
            return res.status(400).json({ error: 'Unable to collect fruits from this tree' });
        }

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

// Collect all ready trees (optionally limited to provided cells)
router.post('/collect_ready', async (req, res) => {
    try {
        const { username, cells } = req.body || {};

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
        const farmInventory = ensureFarmInventory(rgData);
        const fruitsAdded = { ...syncResult.collected };

        const requestedCells = Array.isArray(cells)
            ? cells
                .map(index => Number(index))
                .filter(index => Number.isInteger(index) && index >= 0 && index < GARDEN_SIZE)
            : null;

        const targetIndices = requestedCells && requestedCells.length > 0
            ? Array.from(new Set(requestedCells))
            : rgData.garden.reduce((acc, tree, index) => {
                if (tree && tree.state === 'ready') {
                    acc.push(index);
                }
                return acc;
            }, []);

        if (targetIndices.length === 0) {
            return res.status(400).json({ error: 'No trees ready for collection' });
        }

        let harvestedAny = false;

        targetIndices.forEach((cellIndex) => {
            const tree = rgData.garden[cellIndex];
            if (!tree || tree.state !== 'ready') {
                return;
            }

            const normalizedType = normalizeTreeType(tree.type);
            if (!normalizedType) {
                return;
            }

            const treeConfig = TREE_TYPES[normalizedType];
            if (!treeConfig) {
                return;
            }

            const harvested = harvestTreeToFarmInventory({
                progress: rgData,
                tree,
                typeKey: normalizedType,
                treeConfig,
                farmInventory,
                collectedSummary: fruitsAdded,
                now
            });

            if (harvested > 0) {
                harvestedAny = true;
            }
        });

        if (!harvestedAny) {
            return res.status(400).json({ error: 'No trees ready for collection' });
        }

        user.markModified('richGardenProgress');
        await user.save();

        const extras = {};
        if (Object.keys(fruitsAdded).length > 0) {
            extras.collected = fruitsAdded;
        }

        return res.json(buildUserGardenResponse(user, { now, extras }));

    } catch (error) {
        console.error('Collect ready trees error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Plant tree from crate into a specific cell
router.post('/plant_from_crate', async (req, res) => {
    try {
        const { username, cellIndex, treeType, vehicle: requestedVehicle } = req.body;

        if (!Number.isInteger(cellIndex) || cellIndex < 0 || cellIndex >= GARDEN_SIZE) {
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
        const transportContext = ensureTransportState(user, { now });
        const selection = getVehicleContext(transportContext.fleet, requestedVehicle);
        if (selection.error) {
            return res.status(400).json({ error: 'Selected vehicle is locked' });
        }

        const { vehicle, mode } = selection;
        if (vehicle.isTraveling() || vehicle.location !== 'farm') {
            return res.status(400).json({ error: 'Vehicle must be at the farm to plant trees from crates' });
        }

        const treeCrate = vehicle.treeCrate;
        let normalizedType = normalizeTreeType(treeType);
        if (!normalizedType) {
            const queuedTypes = Object.keys(treeCrate.queued || {});
            normalizedType = queuedTypes.length > 0 ? normalizeTreeType(queuedTypes[0]) : null;
        }

        if (!normalizedType || !treeCrate.queued?.[normalizedType]) {
            return res.status(400).json({ error: 'No matching tree available in crate' });
        }

        const newTreeConfig = TREE_TYPES[normalizedType];
        if (!newTreeConfig) {
            return res.status(400).json({ error: 'Unknown tree type selected' });
        }

        const existingTree = rgData.garden[cellIndex];
        if (existingTree) {
            const existingType = normalizeTreeType(existingTree.type);
            const existingLevel = existingType ? TREE_TYPES[existingType]?.level || 0 : 0;
            if (existingLevel >= newTreeConfig.level) {
                return res.status(400).json({ error: 'Target cell already has an equal or higher tier tree' });
            }
        }

        const removed = treeCrate.dequeueTrees(normalizedType, 1);
        if (removed <= 0) {
            return res.status(400).json({ error: 'Unable to plant tree from crate' });
        }

        rgData.garden[cellIndex] = {
            type: normalizedType,
            state: 'producing',
            plantedAt: now,
            collectionStartTime: null,
            timeLeft: PRODUCTION_TIME,
            lastCollected: null
        };

        persistTransportFleet(rgData, transportContext.fleet);

        user.markModified('richGardenProgress');
        await user.save();

        return res.json(buildUserGardenResponse(user, { now, extras: { plantedFrom: mode }, transportContext }));

    } catch (error) {
        console.error('Plant from crate error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Load truck with fruits from farm inventory
router.post('/load_truck', async (req, res) => {
    try {
        const { username, vehicle: requestedVehicle } = req.body;

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
        const transportContext = ensureTransportState(user, { now });
        const selection = getVehicleContext(transportContext.fleet, requestedVehicle);
        if (selection.error) {
            return res.status(400).json({ error: 'Selected vehicle is locked' });
        }

        const { vehicle, mode } = selection;
        if (!vehicleAtLocation(vehicle, 'farm')) {
            return res.status(400).json({ error: 'Vehicle must be at the farm to load fruits' });
        }

        const farmInventoryBuckets = ensureFarmInventory(rgData);
        const farmInventoryEntries = getResourceEntries(farmInventoryBuckets);
        const loaded = {};

        farmInventoryEntries.forEach(([type, amountRaw]) => {
            const crate = vehicle.fruitCrates[type];
            if (!crate) {
                return;
            }
            const amount = Math.max(0, Number(amountRaw) || 0);
            if (amount <= 0) {
                return;
            }
            const accepted = crate.load(amount);
            if (accepted > 0) {
                farmInventoryBuckets[type] = amount - accepted;
                loaded[type] = (loaded[type] || 0) + accepted;
            }
        });

        cleanupResourceMap(farmInventoryBuckets);

        if (Object.keys(loaded).length === 0) {
            return res.status(400).json({ error: 'No fruits available to load' });
        }

        persistTransportFleet(rgData, transportContext.fleet);

        user.markModified('richGardenProgress');
        await user.save();

        const extras = { loaded, vehicle: mode };
        if (Object.keys(syncResult.collected).length > 0) {
            extras.collected = syncResult.collected;
        }

        return res.json(buildUserGardenResponse(user, { now, extras, transportContext }));

    } catch (error) {
        console.error('Load truck error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Unload truck back to farm inventory
router.post('/unload_truck', async (req, res) => {
    try {
        const { username, vehicle: requestedVehicle } = req.body;

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
        const transportContext = ensureTransportState(user, { now });
        const selection = getVehicleContext(transportContext.fleet, requestedVehicle);
        if (selection.error) {
            return res.status(400).json({ error: 'Selected vehicle is locked' });
        }

        const { vehicle, mode } = selection;
        if (!vehicleAtLocation(vehicle, 'farm')) {
            return res.status(400).json({ error: 'Vehicle must be at the farm to unload fruits' });
        }

        const farmInventory = ensureFarmInventory(rgData);
        const unloaded = {};

        Object.entries(vehicle.fruitCrates).forEach(([type, crate]) => {
            const amount = Math.max(0, Number(crate.loaded) || 0);
            if (amount <= 0) {
                return;
            }
            const removed = crate.unload(amount);
            if (removed > 0) {
                farmInventory[type] = (farmInventory[type] || 0) + removed;
                unloaded[type] = (unloaded[type] || 0) + removed;
            }
        });

        if (Object.keys(unloaded).length === 0) {
            return res.status(400).json({ error: 'No fruits loaded on this vehicle' });
        }

        cleanupResourceMap(farmInventory);
        persistTransportFleet(rgData, transportContext.fleet);

        user.markModified('richGardenProgress');
        await user.save();

        const extras = { unloaded, vehicle: mode };
        if (Object.keys(syncResult.collected).length > 0) {
            extras.collected = syncResult.collected;
        }

        return res.json(buildUserGardenResponse(user, { now, extras, transportContext }));

    } catch (error) {
        console.error('Unload truck error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Send truck to city
router.post('/send_truck', async (req, res) => {
    try {
        const { username, vehicle: requestedVehicle } = req.body;

        const user = await User.findOne({ username });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const rgData = user.richGardenProgress;
        if (!rgData) {
            return res.status(400).json({ error: 'Rich Garden data not initialized' });
        }

        const now = new Date();
        const transportContext = ensureTransportState(user, { now });
        const selection = getVehicleContext(transportContext.fleet, requestedVehicle);
        if (selection.error) {
            return res.status(400).json({ error: 'Selected vehicle is locked' });
        }

        const { vehicle, mode } = selection;
        if (!vehicleAtLocation(vehicle, 'farm')) {
            return res.status(400).json({ error: 'Vehicle must be at the farm to travel to the city' });
        }

        const started = vehicle.beginTravel('city', now);
        if (!started) {
            return res.status(400).json({ error: 'Vehicle is already traveling or at the destination' });
        }

        persistTransportFleet(rgData, transportContext.fleet);

        user.markModified('richGardenProgress');
        await user.save();

        return res.json(buildUserGardenResponse(user, { now, transportContext, extras: { vehicle: mode, travelingTo: 'city' } }));

    } catch (error) {
        console.error('Send truck error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Sell fruits
router.post('/sell_fruits', async (req, res) => {
    try {
        const { username, vehicle: requestedVehicle } = req.body;

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
        const transportContext = ensureTransportState(user, { now });
        const selection = getVehicleContext(transportContext.fleet, requestedVehicle);
        if (selection.error) {
            return res.status(400).json({ error: 'Selected vehicle is locked' });
        }

        const { vehicle, mode } = selection;
        if (!vehicleAtLocation(vehicle, 'city')) {
            return res.status(400).json({ error: 'Vehicle must be at the city to sell fruits' });
        }

        let totalEarned = 0;
        const sold = {};
        const saleDetails = [];

        Object.entries(vehicle.fruitCrates).forEach(([type, crate]) => {
            const amount = Math.max(0, Number(crate.loaded) || 0);
            if (amount <= 0) {
                return;
            }

            const treeType = TREE_TYPES[type];
            if (!treeType) {
                return;
            }

            const sellableSets = Math.floor(amount / treeType.fruitsPerCoin);
            if (sellableSets <= 0) {
                return;
            }

            const fruitsToSell = sellableSets * treeType.fruitsPerCoin;
            const removed = crate.unload(fruitsToSell);
            if (removed <= 0) {
                return;
            }

            totalEarned += sellableSets;
            sold[type] = (sold[type] || 0) + removed;
            saleDetails.push({
                type,
                fruits: removed,
                coins: sellableSets,
                fruitsPerCoin: treeType.fruitsPerCoin
            });
        });

        if (totalEarned === 0) {
            return res.status(400).json({ error: 'No fruits to sell from this vehicle' });
        }

        rgData.coins += totalEarned;
        rgData.totalCoinsEarned = (Number(rgData.totalCoinsEarned) || 0) + totalEarned;

        let trackerResult = null;
        trackerResult = EarningsTracker.recordTransaction(user, {
            game: 'rich-garden',
            type: 'sell',
            amount: totalEarned,
            currency: 'game_coin',
            details: {
                source: 'fruits',
                sales: saleDetails,
                vehicle: mode
            }
        });

        persistTransportFleet(rgData, transportContext.fleet);

        user.markModified('richGardenProgress');
        await user.save();

        const extras = {
            earned: totalEarned,
            sold,
            vehicle: mode
        };

        if (Object.keys(syncResult.collected).length > 0) {
            extras.collected = syncResult.collected;
        }

        if (trackerResult) {
            extras.earningsTracker = trackerResult.earnings;
            extras.unlockedAchievements = trackerResult.unlockedAchievements;
        }

        return res.json(buildUserGardenResponse(user, { now, extras, transportContext }));

    } catch (error) {
        console.error('Sell fruits error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Return truck to farm
router.post('/return_truck', async (req, res) => {
    try {
        const { username, vehicle: requestedVehicle } = req.body;

        const user = await User.findOne({ username });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const rgData = user.richGardenProgress;
        if (!rgData) {
            return res.status(400).json({ error: 'Rich Garden data not initialized' });
        }

        const now = new Date();
        const transportContext = ensureTransportState(user, { now });
        const selection = getVehicleContext(transportContext.fleet, requestedVehicle);
        if (selection.error) {
            return res.status(400).json({ error: 'Selected vehicle is locked' });
        }

        const { vehicle, mode } = selection;
        if (!vehicleAtLocation(vehicle, 'city')) {
            return res.status(400).json({ error: 'Vehicle must be at the city to return to the farm' });
        }

        const started = vehicle.beginTravel('farm', now);
        if (!started) {
            return res.status(400).json({ error: 'Vehicle is already traveling or at the destination' });
        }

        persistTransportFleet(rgData, transportContext.fleet);

        user.markModified('richGardenProgress');
        await user.save();

        return res.json(buildUserGardenResponse(user, { now, transportContext, extras: { vehicle: mode, travelingTo: 'farm' } }));

    } catch (error) {
        console.error('Return truck error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

export default router;