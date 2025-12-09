import express from "express";
import User from "../models/user.js";
import EarningsTracker from "../services/earnings-tracker.js";

const router = express.Router();

// Bird configuration
const BIRDS = {
  red:    { cost: 1000,   eps: 1,  eggsPerCoin: 100, label: "Red" },
  orange: { cost: 2500,   eps: 2,  eggsPerCoin: 80,  label: "Orange" },
  yellow: { cost: 10000,  eps: 5,  eggsPerCoin: 50,  label: "Yellow" },
  green:  { cost: 25000,  eps: 10, eggsPerCoin: 40,  label: "Green" },
  blue:   { cost: 100000, eps: 20, eggsPerCoin: 20,  label: "Blue" },
  purple: { cost: 500000, eps: 50, eggsPerCoin: 10,  label: "Purple" },
};

const FAST_MODE = process.env.FAST_MODE === 'true';
const BASE_COLLECTION_CAP_SEC = FAST_MODE ? 30 : 6 * 60 * 60; // 30s testing / 6h normal
const BASE_TRUCK_TRAVEL_TIME = FAST_MODE ? 10 * 1000 : 60 * 60 * 1000; // 10s testing / 1h normal
const HELICOPTER_TRAVEL_TIME = FAST_MODE ? 5 * 1000 : 5 * 60 * 1000;

const VEHICLE_TYPES = ["truck", "helicopter"];
const COIN_VALUE_PER_CRATE = 10000;
const HELICOPTER_CAPACITY_MULTIPLIER = 5;

const TRUCK_CRATE_CAPACITY = Object.fromEntries(
  Object.entries(BIRDS).map(([color, config]) => [color, config.eggsPerCoin * COIN_VALUE_PER_CRATE])
);
const HELICOPTER_CRATE_CAPACITY = Object.fromEntries(
  Object.entries(TRUCK_CRATE_CAPACITY).map(([color, cap]) => [color, cap * HELICOPTER_CAPACITY_MULTIPLIER])
);

const BIRD_CAGE_CAPACITY = {
  truck: 20,
  helicopter: 100
};

const FARM_LIMITS = {
  red: 500,
  orange: 200,
  yellow: 50,
  green: 20,
  blue: 5,
  purple: 1
};

const VEHICLE_FIELD_MAP = {
  truck: {
    inventory: 'truckInventory',
    cage: 'truckBirdCage',
    location: 'truckLocation',
    departure: 'truckDepartureTime'
  },
  helicopter: {
    inventory: 'helicopterInventory',
    cage: 'helicopterBirdCage',
    location: 'helicopterLocation',
    departure: 'helicopterDepartureTime'
  }
};

const VEHICLE_CONFIG = {
  truck: {
    travelTime: BASE_TRUCK_TRAVEL_TIME,
    crateCapacity: TRUCK_CRATE_CAPACITY,
    birdCageCapacity: BIRD_CAGE_CAPACITY.truck,
    requiresUpgrade: null
  },
  helicopter: {
    travelTime: HELICOPTER_TRAVEL_TIME,
    crateCapacity: HELICOPTER_CRATE_CAPACITY,
    birdCageCapacity: BIRD_CAGE_CAPACITY.helicopter,
    requiresUpgrade: 'helicopterTransport'
  }
};

export const HAPPY_BIRDS_VEHICLE_TYPES = VEHICLE_TYPES;
export const HAPPY_BIRDS_VEHICLE_FIELD_MAP = VEHICLE_FIELD_MAP;
export const HAPPY_BIRDS_VEHICLE_CONFIG = VEHICLE_CONFIG;

// Helper functions
function getCollectionCapSeconds(user) {
  if (user?.happyBirdsUpgrades?.autoCollect) {
    return null;
  }
  return BASE_COLLECTION_CAP_SEC;
}

function getTruckTravelTime(user) {
  if (user?.happyBirdsUpgrades?.helicopterTransport) {
    return PREMIUM_TRUCK_TRAVEL_TIME;
  }
  return BASE_TRUCK_TRAVEL_TIME;
}

function autoCollectEggs(user) {
  if (!user?.happyBirdsUpgrades?.autoCollect || !user.productionStart) {
    return null;
  }

  if (!user.eggs || typeof user.eggs !== 'object') {
    user.eggs = {};
  }

  const referenceTime = user.lastSaveTime || user.productionStart;
  const { produced } = computeProducedSince(referenceTime, user.birds, null);
  if (!produced || Object.keys(produced).length === 0) {
    return null;
  }
  const total = Object.values(produced).reduce((sum, value) => sum + (Number(value) || 0), 0);
  if (total <= 0) {
    return null;
  }

  Object.entries(produced).forEach(([color, amount]) => {
    if (amount > 0) {
      user.eggs[color] = (user.eggs[color] || 0) + amount;
    }
  });
  user.lastSaveTime = new Date();
  user.markModified('eggs');
  return produced;
}

function computeProducedSince(productionStart, birds, capSeconds = BASE_COLLECTION_CAP_SEC) {
  if (!productionStart) return { produced: {}, seconds: 0 };

  const nowSec = Math.floor(Date.now() / 1000);
  const startSec = Math.floor(new Date(productionStart).getTime() / 1000);
  let seconds = nowSec - startSec;
  if (typeof capSeconds === 'number' && capSeconds > 0 && seconds > capSeconds) {
    seconds = capSeconds;
  }

  const produced = {};
  for (const color of Object.keys(BIRDS)) {
    const count = (birds && birds[color]) ? birds[color] : 0;
    produced[color] = Math.floor(count * BIRDS[color].eps * seconds);
  }
  return { produced, seconds };
}

function getVehicleConfig(vehicle) {
  const config = VEHICLE_CONFIG[vehicle];
  if (!config) {
    throw new Error(`Unknown vehicle: ${vehicle}`);
  }
  return config;
}

function hasUpgrade(user, key) {
  return Boolean(user?.happyBirdsUpgrades?.[key]);
}

function hasHelicopter(user) {
  return hasUpgrade(user, 'helicopterTransport');
}

function hasNoBirdLimit(user) {
  return hasUpgrade(user, 'noBirdLimit');
}

function hasNoInventoryLimit(user) {
  return hasUpgrade(user, 'noInventoryLimit');
}

function ensureVehicleState(user, vehicle) {
  const fields = VEHICLE_FIELD_MAP[vehicle];
  if (!fields) {
    throw new Error(`Unknown vehicle state requested: ${vehicle}`);
  }

  if (!user[fields.inventory] || typeof user[fields.inventory] !== 'object') {
    user[fields.inventory] = {};
    user.markModified(fields.inventory);
  }
  if (!user[fields.cage] || typeof user[fields.cage] !== 'object') {
    user[fields.cage] = { birds: {}, total: 0 };
    user.markModified(fields.cage);
  }
  if (!user[fields.cage].birds || typeof user[fields.cage].birds !== 'object') {
    user[fields.cage].birds = {};
    user.markModified(fields.cage);
  }
  if (typeof user[fields.cage].total !== 'number') {
    user[fields.cage].total = Object.values(user[fields.cage].birds)
      .reduce((sum, amt) => sum + (Number(amt) || 0), 0);
    user.markModified(fields.cage);
  }
  if (!user[fields.location]) {
    user[fields.location] = 'farm';
    user.markModified(fields.location);
  }
  if (user[fields.departure] && !(user[fields.departure] instanceof Date)) {
    user[fields.departure] = new Date(user[fields.departure]);
    user.markModified(fields.departure);
  }
  return fields;
}

function ensureTransportDefaults(user) {
  let mutated = false;
  if (!user.eggs || typeof user.eggs !== 'object') {
    user.eggs = {};
    user.markModified('eggs');
    mutated = true;
  }

  VEHICLE_TYPES.forEach((vehicle) => {
    const fields = VEHICLE_FIELD_MAP[vehicle];
    const missingInventory = !user[fields.inventory] || typeof user[fields.inventory] !== 'object';
    const missingCage = !user[fields.cage] || typeof user[fields.cage] !== 'object';
    const missingCageBirds = !missingCage && (!user[fields.cage].birds || typeof user[fields.cage].birds !== 'object');
    const missingLocation = !user[fields.location];
    const nonDateDeparture = user[fields.departure] && !(user[fields.departure] instanceof Date);

    ensureVehicleState(user, vehicle);

    if (missingInventory) {
      user.markModified(fields.inventory);
      mutated = true;
    }
    if (missingCage || missingCageBirds) {
      user.markModified(fields.cage);
      mutated = true;
    }
    if (missingLocation) {
      mutated = true;
    }
    if (nonDateDeparture) {
      user.markModified(fields.departure);
      mutated = true;
    }
  });

  return mutated;
}

function getVehicleInventory(user, vehicle) {
  const fields = ensureVehicleState(user, vehicle);
  return user[fields.inventory];
}

function getVehicleCage(user, vehicle) {
  const fields = ensureVehicleState(user, vehicle);
  return user[fields.cage];
}

function getVehicleLocation(user, vehicle) {
  const fields = ensureVehicleState(user, vehicle);
  return user[fields.location];
}

function setVehicleLocation(user, vehicle, value) {
  const fields = ensureVehicleState(user, vehicle);
  user[fields.location] = value;
  user.markModified(fields.location);
}

function getVehicleDeparture(user, vehicle) {
  const fields = ensureVehicleState(user, vehicle);
  return user[fields.departure];
}

function setVehicleDeparture(user, vehicle, value) {
  const fields = ensureVehicleState(user, vehicle);
  user[fields.departure] = value;
  user.markModified(fields.departure);
}

function canUseVehicle(user, vehicle) {
  const config = getVehicleConfig(vehicle);
  if (!config.requiresUpgrade) {
    return true;
  }
  return hasUpgrade(user, config.requiresUpgrade);
}

function requireVehicleAccess(user, vehicle) {
  if (!canUseVehicle(user, vehicle)) {
    throw new Error(`Vehicle ${vehicle} not unlocked`);
  }
}

function getCrateCapacity(user, vehicle, color) {
  if (hasNoInventoryLimit(user)) {
    return Infinity;
  }
  const config = getVehicleConfig(vehicle);
  return config.crateCapacity[color] || 0;
}

function getCageCapacity(user, vehicle) {
  if (hasNoInventoryLimit(user)) {
    return Infinity;
  }
  const config = getVehicleConfig(vehicle);
  return config.birdCageCapacity;
}

function getFarmLimit(user, color) {
  if (hasNoBirdLimit(user)) {
    return Infinity;
  }
  return FARM_LIMITS[color] ?? Infinity;
}

function completeVehicleTravel(user, vehicle) {
  const location = getVehicleLocation(user, vehicle);
  const departure = getVehicleDeparture(user, vehicle);
  if (!departure) {
    return false;
  }

  if (location !== 'traveling_to_city' && location !== 'traveling_to_farm') {
    return false;
  }

  const travelTime = getVehicleConfig(vehicle).travelTime;
  const elapsed = Date.now() - departure.getTime();
  if (elapsed < travelTime) {
    return false;
  }

  const nextLocation = location === 'traveling_to_city' ? 'city' : 'farm';
  setVehicleLocation(user, vehicle, nextLocation);
  setVehicleDeparture(user, vehicle, null);
  return true;
}

function sanitizeEggMap(map = {}) {
  const safe = {};
  Object.keys(BIRDS).forEach((color) => {
    safe[color] = Number(map[color]) || 0;
  });
  return safe;
}

function sanitizeBirdMap(map = {}) {
  const safe = {};
  Object.keys(BIRDS).forEach((color) => {
    safe[color] = Number(map[color]) || 0;
  });
  return safe;
}

function attemptEggLoad(user, vehicle, color, requestedQty, options = {}) {
  const { strict = true } = options;
  if (!BIRDS[color]) {
    return { success: false, error: "Invalid color", color, abort: true };
  }

  const qty = Math.floor(Number(requestedQty));
  if (!Number.isFinite(qty) || qty <= 0) {
    return { success: false, error: "Amount must be positive", color, abort: true };
  }

  const eggsPerCoin = BIRDS[color].eggsPerCoin;
  const availableEggs = Number(user.eggs[color]) || 0;
  if (availableEggs < eggsPerCoin) {
    return {
      success: false,
      error: `Collect at least ${eggsPerCoin} ${color} eggs before loading`,
      color,
      abort: strict
    };
  }

  const maxRequested = Math.min(qty, availableEggs);
  let convertible = Math.floor(maxRequested / eggsPerCoin) * eggsPerCoin;
  if (convertible < eggsPerCoin) {
    return {
      success: false,
      error: `Need at least ${eggsPerCoin} ${color} eggs per load`,
      color,
      abort: strict
    };
  }

  const inventory = getVehicleInventory(user, vehicle);
  const crateCapacity = getCrateCapacity(user, vehicle, color);
  const current = Number(inventory[color]) || 0;

  if (Number.isFinite(crateCapacity)) {
    const remainingCapacity = Math.max(crateCapacity - current, 0);
    const capacityFriendly = Math.floor(remainingCapacity / eggsPerCoin) * eggsPerCoin;
    convertible = Math.min(convertible, capacityFriendly);
    if (convertible < eggsPerCoin) {
      return {
        success: false,
        error: `${vehicle} crate is full for ${BIRDS[color].label} eggs`,
        color,
        abort: strict
      };
    }
  }

  user.eggs[color] = availableEggs - convertible;
  inventory[color] = current + convertible;
  user.markModified('eggs');
  markVehicleInventoryModified(user, vehicle);

  return { success: true, color, loaded: convertible };
}

function buildTransportationPayload(user) {
  ensureTransportDefaults(user);
  const noBirdLimit = hasNoBirdLimit(user);
  const noInventoryLimit = hasNoInventoryLimit(user);

  const vehicles = {};
  VEHICLE_TYPES.forEach((vehicle) => {
    const fields = ensureVehicleState(user, vehicle);
    const config = getVehicleConfig(vehicle);
    const available = canUseVehicle(user, vehicle);
    const rawInventory = user[fields.inventory] || {};
    const cage = user[fields.cage] || { birds: {}, total: 0 };

    vehicles[vehicle] = {
      available,
      location: user[fields.location],
      departureTime: user[fields.departure],
      eggCrates: sanitizeEggMap(rawInventory),
      birdCage: {
        total: Number(cage.total) || 0,
        birds: sanitizeBirdMap(cage.birds)
      },
      crateCapacity: noInventoryLimit ? null : { ...config.crateCapacity },
      birdCageCapacity: noInventoryLimit ? null : config.birdCageCapacity,
      travelTimeMs: config.travelTime
    };
  });

  const farmLimits = {};
  Object.keys(BIRDS).forEach((color) => {
    const limit = getFarmLimit(user, color);
    farmLimits[color] = {
      limit: Number.isFinite(limit) ? limit : null,
      current: Number(user?.birds?.[color]) || 0
    };
  });

  return {
    vehicles,
    farmLimits,
    upgrades: {
      helicopterTransport: hasHelicopter(user),
      noBirdLimit,
      noInventoryLimit
    }
  };
}

function buildTransportProgressPayload(user) {
  ensureTransportDefaults(user);
  const vehicles = {};
  VEHICLE_TYPES.forEach((vehicle) => {
    const fields = ensureVehicleState(user, vehicle);
    const config = getVehicleConfig(vehicle);
    const location = user[fields.location];
    const departureTime = user[fields.departure];
    const isTraveling = location === "traveling_to_city" || location === "traveling_to_farm";
    let remainingMs = null;
    let progress = null;
    let direction = null;

    if (isTraveling && departureTime instanceof Date) {
      const elapsed = Date.now() - departureTime.getTime();
      const clampedElapsed = Math.min(Math.max(elapsed, 0), config.travelTime);
      remainingMs = Math.max(config.travelTime - elapsed, 0);
      progress = config.travelTime === 0 ? 1 : Number((clampedElapsed / config.travelTime).toFixed(4));
      direction = location === "traveling_to_city" ? "to_city" : "to_farm";
    }

    vehicles[vehicle] = {
      available: canUseVehicle(user, vehicle),
      location,
      direction,
      departureTime,
      travelTimeMs: config.travelTime,
      remainingMs,
      progress
    };
  });

  return { vehicles };
}

function markVehicleInventoryModified(user, vehicle) {
  const fields = ensureVehicleState(user, vehicle);
  user.markModified(fields.inventory);
}

function markVehicleCageModified(user, vehicle) {
  const fields = ensureVehicleState(user, vehicle);
  user.markModified(fields.cage);
}

function normalizeVehicle(vehicle) {
  if (!vehicle) {
    return 'truck';
  }
  return VEHICLE_TYPES.includes(vehicle) ? vehicle : 'truck';
}

function getTotalFarmBirds(user) {
  return Object.values(user?.birds || {}).reduce((sum, count) => sum + (Number(count) || 0), 0);
}

function getTotalCagedBirds(user) {
  return VEHICLE_TYPES.reduce((acc, vehicle) => {
    const cage = user[VEHICLE_FIELD_MAP[vehicle].cage];
    return acc + (cage?.total || 0);
  }, 0);
}

function snapshotProductionWindow(user) {
  const reference = user.lastSaveTime || user.productionStart;
  if (!reference) {
    return;
  }
  const { produced } = computeProducedSince(reference, user.birds, getCollectionCapSeconds(user));
  user.savedProduced = produced;
  user.lastSaveTime = new Date();
}

async function getUser(username) {
  return await User.findByUsername(username);
}

async function handleLoadEggRequest(req, res) {
  try {
    const { username } = req.body;
    const vehicle = normalizeVehicle(req.body.vehicle);

    const user = await getUser(username);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    ensureTransportDefaults(user);

    try {
      requireVehicleAccess(user, vehicle);
    } catch (error) {
      return res.status(400).json({ error: `Vehicle ${vehicle} is not unlocked` });
    }

    if (getVehicleLocation(user, vehicle) !== 'farm') {
      return res.status(400).json({ error: "Vehicle must be at farm to load eggs" });
    }

    const loadsInput = Array.isArray(req.body.loads)
      ? req.body.loads
      : (req.body.color ? [{ color: req.body.color, amount: req.body.amount }] : []);

    const normalizedLoads = loadsInput
      .map((entry) => ({
        color: typeof entry?.color === 'string' ? entry.color.trim().toLowerCase() : null,
        amount: entry?.amount
      }))
      .filter((entry) => entry.color && BIRDS[entry.color]);

    if (normalizedLoads.length === 0) {
      return res.status(400).json({ error: "Specify at least one valid egg color to load" });
    }

    const isBatch = normalizedLoads.length > 1;
    const summary = [];
    let anyLoaded = false;

    for (const entry of normalizedLoads) {
      const result = attemptEggLoad(user, vehicle, entry.color, entry.amount, { strict: !isBatch });
      summary.push(result);
      if (result.success && result.loaded > 0) {
        anyLoaded = true;
      } else if (!result.success && result.abort) {
        return res.status(400).json({ error: result.error || "Failed to load eggs", loadResults: summary });
      }
    }

    if (!anyLoaded) {
      const firstError = summary.find((item) => item.error)?.error || "No eggs loaded";
      return res.status(400).json({ error: firstError, loadResults: summary });
    }

    await user.save();

    return res.json({
      success: true,
      eggs: user.eggs,
      truckInventory: user.truckInventory || {},
      helicopterInventory: user.helicopterInventory || {},
      loadResults: summary,
      transportation: buildTransportationPayload(user)
    });
  } catch (err) {
    console.error("Load eggs error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}

async function handleReleaseBirdsRequest(req, res) {
  try {
    const { username } = req.body;
    const vehicle = normalizeVehicle(req.body.vehicle);

    const user = await getUser(username);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    ensureTransportDefaults(user);

    try {
      requireVehicleAccess(user, vehicle);
    } catch (error) {
      return res.status(400).json({ error: `Vehicle ${vehicle} is not unlocked` });
    }

    if (getVehicleLocation(user, vehicle) !== 'farm') {
      return res.status(400).json({ error: "Vehicle must be at farm to release birds" });
    }

    const cage = getVehicleCage(user, vehicle);
    const birds = sanitizeBirdMap(cage.birds);
    const totalToRelease = Object.values(birds).reduce((sum, count) => sum + count, 0);
    if (totalToRelease <= 0) {
      return res.status(400).json({ error: "No birds to release" });
    }

    for (const [color, count] of Object.entries(birds)) {
      if (count <= 0) continue;
      const limit = getFarmLimit(user, color);
      const current = Number(user?.birds?.[color]) || 0;
      if (Number.isFinite(limit) && current + count > limit) {
        return res.status(400).json({ error: `Cannot release ${BIRDS[color].label} birds - farm limit reached` });
      }
    }

    const hadFarmBirds = getTotalFarmBirds(user) > 0;
    if (hadFarmBirds) {
      snapshotProductionWindow(user);
    }

    Object.entries(birds).forEach(([color, count]) => {
      if (count <= 0) return;
      user.birds[color] = (user.birds[color] || 0) + count;
      cage.birds[color] = 0;
    });
    cage.total = 0;

    if (!hadFarmBirds && totalToRelease > 0) {
      user.productionStart = new Date();
      user.lastSaveTime = null;
      user.savedProduced = {};
    }

    user.markModified('birds');
    user.markModified('savedProduced');
    markVehicleCageModified(user, vehicle);

    await user.save();

    return res.json({
      success: true,
      birds: user.birds,
      transportation: buildTransportationPayload(user)
    });
  } catch (err) {
    console.error("Release birds error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}

async function handleTravelRequest(req, res, forcedDirection = null) {
  try {
    const { username } = req.body;
    const vehicle = normalizeVehicle(req.body.vehicle);
    const direction = forcedDirection || req.body.direction;

    if (!['to_city', 'to_farm'].includes(direction)) {
      return res.status(400).json({ error: "Invalid travel direction" });
    }

    const user = await getUser(username);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    ensureTransportDefaults(user);

    try {
      requireVehicleAccess(user, vehicle);
    } catch (error) {
      return res.status(400).json({ error: `Vehicle ${vehicle} is not unlocked` });
    }

    const currentLocation = getVehicleLocation(user, vehicle);
    if (direction === 'to_city' && currentLocation !== 'farm') {
      return res.status(400).json({ error: "Vehicle must be at farm to depart" });
    }
    if (direction === 'to_farm' && currentLocation !== 'city') {
      return res.status(400).json({ error: "Vehicle must be at city to return" });
    }

    setVehicleLocation(user, vehicle, direction === 'to_city' ? 'traveling_to_city' : 'traveling_to_farm');
    setVehicleDeparture(user, vehicle, new Date());

    await user.save();

    return res.json({
      success: true,
      truckLocation: user.truckLocation,
      truckDepartureTime: user.truckDepartureTime,
      transportation: buildTransportationPayload(user)
    });
  } catch (err) {
    console.error("Travel error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}

// GET /api/game/status/:username
router.get("/status/:username", async (req, res) => {
  try {
    const user = await getUser(req.params.username);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    let mutated = ensureTransportDefaults(user);

    if (!user.savedProduced || typeof user.savedProduced !== 'object') {
      user.savedProduced = {};
      mutated = true;
    }

    VEHICLE_TYPES.forEach((vehicle) => {
      if (completeVehicleTravel(user, vehicle)) {
        mutated = true;
      }
    });

    const autoCollected = autoCollectEggs(user);
    if (autoCollected) {
      mutated = true;
    }

    if (mutated) {
      await user.save();
    }

    res.json({
      success: true,
      coins: user.coins,
      birds: user.birds,
      eggs: user.eggs,
      savedProduced: user.savedProduced || {},
      lastSaveTime: user.lastSaveTime,
      productionStart: user.productionStart,
      truckLocation: user.truckLocation,
      truckDepartureTime: user.truckDepartureTime,
      truckInventory: user.truckInventory || {},
      transportation: buildTransportationPayload(user)
    });
  } catch (err) {
    if (process.env.CONSOLE_MESSAGES === 'true') console.error("Status error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/transportation/:username", async (req, res) => {
  try {
    const user = await getUser(req.params.username);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    let mutated = ensureTransportDefaults(user);
    VEHICLE_TYPES.forEach((vehicle) => {
      if (completeVehicleTravel(user, vehicle)) {
        mutated = true;
      }
    });
    if (mutated) {
      await user.save();
    }

    return res.json({ success: true, transportation: buildTransportationPayload(user) });
  } catch (error) {
    console.error("Transportation status error:", error);
    return res.status(500).json({ error: "Server error" });
  }
});

router.get("/transport/progress/:username", async (req, res) => {
  try {
    const user = await getUser(req.params.username);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    let mutated = ensureTransportDefaults(user);
    VEHICLE_TYPES.forEach((vehicle) => {
      if (completeVehicleTravel(user, vehicle)) {
        mutated = true;
      }
    });

    if (mutated) {
      await user.save();
    }

    return res.json({ success: true, progress: buildTransportProgressPayload(user) });
  } catch (error) {
    console.error("Transport progress error:", error);
    return res.status(500).json({ error: "Server error" });
  }
});

// POST /api/game/collect
router.post("/collect", async (req, res) => {
  try {
    const { username } = req.body;
    const user = await getUser(username);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Ensure production has started
    if (!user.productionStart) {
      return res.status(400).json({ error: "Buy a bird to start production." });
    }

    if (user.happyBirdsUpgrades?.autoCollect) {
      const autoCollected = autoCollectEggs(user) || {};
      await user.save();
      return res.json({ success: true, collected: autoCollected, eggs: user.eggs, autoCollect: true });
    }

    const lastCollectTime = user.lastSaveTime || user.productionStart;
    const nowSec = Math.floor(Date.now() / 1000);
    const lastCollectSec = Math.floor(new Date(lastCollectTime).getTime() / 1000);
    let seconds = nowSec - lastCollectSec;

    if (seconds <= 0) {
      return res.json({ success: true, collected: {}, eggs: user.eggs });
    }
    const capSeconds = getCollectionCapSeconds(user);
    if (typeof capSeconds === 'number' && capSeconds > 0 && seconds > capSeconds) {
      seconds = capSeconds;
    }

    const collected = {};
    for (const color of Object.keys(BIRDS)) {
      const count = (user.birds && user.birds[color]) ? user.birds[color] : 0;
      if (count > 0) {
        const amount = Math.floor(count * BIRDS[color].eps * seconds);
        if (amount > 0) {
          collected[color] = amount;
          user.eggs[color] = (user.eggs[color] || 0) + amount;
        }
      }
    }

    // Reset collection timer
    user.lastSaveTime = new Date();
    user.markModified('eggs');
    await user.save();

    res.json({ success: true, collected, eggs: user.eggs });
  } catch (err) {
    console.error("Collect error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/game/load_truck (legacy) and /transport/load-eggs (new)
router.post("/load_truck", handleLoadEggRequest);
router.post("/transport/load-eggs", handleLoadEggRequest);
router.post("/release_birds", handleReleaseBirdsRequest);
router.post("/transport/unload-birds", handleReleaseBirdsRequest);

// POST /api/game/truck_go_to_city
router.post("/truck_go_to_city", async (req, res) => {
  return handleTravelRequest(req, res, 'to_city');
});

// POST /api/game/truck_go_to_farm
router.post("/truck_go_to_farm", async (req, res) => {
  return handleTravelRequest(req, res, 'to_farm');
});

router.post("/transport/travel", async (req, res) => handleTravelRequest(req, res));

// POST /api/game/sell_truck_eggs
router.post("/sell_truck_eggs", async (req, res) => {
  try {
    const { username } = req.body;
    const vehicle = normalizeVehicle(req.body.vehicle);
    const user = await getUser(username);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    ensureTransportDefaults(user);

    try {
      requireVehicleAccess(user, vehicle);
    } catch (error) {
      return res.status(400).json({ error: `Vehicle ${vehicle} is not unlocked` });
    }

    if (getVehicleLocation(user, vehicle) !== 'city') {
      return res.status(400).json({ error: "Vehicle must be at city to sell eggs" });
    }

    let totalCoins = 0;
    const soldBreakdown = {};
    const inventory = getVehicleInventory(user, vehicle);
    Object.keys(BIRDS).forEach((color) => {
      const config = BIRDS[color];
      const amount = Number(inventory?.[color]) || 0;
      if (amount <= 0) {
        return;
      }

      const coins = Math.floor(amount / config.eggsPerCoin);
      if (coins <= 0) {
        return;
      }

      const eggsSold = coins * config.eggsPerCoin;
      totalCoins += coins;
      inventory[color] = amount - eggsSold;
      soldBreakdown[color] = {
        eggs: eggsSold,
        leftover: inventory[color],
        coins
      };
    });

    user.coins += totalCoins;
    let earningsSummary = null;
    let unlockedAchievements = [];
    if (totalCoins > 0) {
      const trackerResult = EarningsTracker.recordTransaction(user, {
        game: 'happy-birds',
        type: 'sell',
        amount: totalCoins,
        currency: 'game_coin',
        details: {
          source: vehicle,
          soldBreakdown
        }
      });
      earningsSummary = trackerResult.earnings;
      unlockedAchievements = trackerResult.unlockedAchievements || [];
    }

    markVehicleInventoryModified(user, vehicle);
    await user.save();

    const sanitizedInventory = sanitizeEggMap(inventory);

    const responsePayload = {
      success: true,
      coins: user.coins,
      soldFor: totalCoins,
      soldBreakdown,
      earningsTracker: earningsSummary,
      unlockedAchievements,
      inventory: {
        vehicle,
        eggCrates: sanitizedInventory
      },
      transportation: buildTransportationPayload(user)
    };

    if (vehicle === 'truck') {
      responsePayload.truckInventory = sanitizedInventory;
    } else if (vehicle === 'helicopter') {
      responsePayload.helicopterInventory = sanitizedInventory;
    }

    res.json(responsePayload);
  } catch (err) {
    console.error("Sell truck eggs error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/game/buy
router.post("/buy", async (req, res) => {
  try {
    const { username, color } = req.body;
    const vehicle = normalizeVehicle(req.body.vehicle);
    const user = await getUser(username);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    ensureTransportDefaults(user);

    // Allow buying first bird at farm, otherwise require selected vehicle at city
    const totalBirds = getTotalFarmBirds(user) + getTotalCagedBirds(user);
    if (totalBirds > 0 && getVehicleLocation(user, vehicle) !== 'city') {
      return res.status(400).json({ error: "Selected vehicle must be at city to buy birds" });
    }

    try {
      requireVehicleAccess(user, vehicle);
    } catch (error) {
      return res.status(400).json({ error: `Vehicle ${vehicle} is not unlocked` });
    }

    if (!BIRDS[color]) {
      return res.status(400).json({ error: "Invalid color" });
    }

    if (user.coins < BIRDS[color].cost) {
      return res.status(400).json({ error: "Not enough coins" });
    }

    user.coins -= BIRDS[color].cost;

    const cage = getVehicleCage(user, vehicle);
    const cageCapacity = getCageCapacity(user, vehicle);
    if (Number.isFinite(cageCapacity) && (cage.total + 1) > cageCapacity) {
      return res.status(400).json({ error: `Cannot buy more birds - ${vehicle} cage full` });
    }

    const farmLimit = getFarmLimit(user, color);
    if (Number.isFinite(farmLimit)) {
      const farmCount = Number(user?.birds?.[color]) || 0;
      const cagedCount = Number(cage.birds[color]) || 0;
      if (farmCount + cagedCount >= farmLimit) {
        return res.status(400).json({ error: `Farm limit reached for ${BIRDS[color].label} birds` });
      }
    }

    cage.birds[color] = (cage.birds[color] || 0) + 1;
    cage.total = (cage.total || 0) + 1;

    markVehicleCageModified(user, vehicle);

    await user.save();

    res.json({
      success: true,
      coins: user.coins,
      birds: user.birds,
      savedProduced: user.savedProduced,
      lastSaveTime: user.lastSaveTime,
      productionStart: user.productionStart,
      transportation: buildTransportationPayload(user)
    });
  } catch (err) {
    console.error("Buy error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// GET /api/game/live/:username
router.get("/live/:username", async (req, res) => {
  try {
    const user = await getUser(req.params.username);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const { produced, seconds } = computeProducedSince(user.lastSaveTime, user.birds, getCollectionCapSeconds(user));
    res.json({ produced, seconds });
  } catch (err) {
    console.error("Live error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// Keep the platform-update here or in server.js
router.post("/platform-update", async (req, res) => {
  try {
    const { username, gameId, currencyUpdates, progressUpdates } = req.body;
    
    const user = await getUser(username);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Обновляем валюты
    if (currencyUpdates) {
      for (const [currencyType, amount] of Object.entries(currencyUpdates)) {
        await user.addPlatformCurrency(currencyType, amount);
      }
    }

    // Обновляем прогресс
    if (progressUpdates && gameId) {
      await user.updateGameProgress(gameId, progressUpdates);
    }

    res.json({
      success: true,
      currencies: user.platformCurrencies,
      progress: user.gamesProgress.get(gameId)
    });
  } catch (error) {
    console.error("Platform update error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
