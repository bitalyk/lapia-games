import express from "express";
import User from "../models/user.js";

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

const SIX_HOURS_SEC = process.env.FAST_MODE === 'true' ? 30 : 6 * 60 * 60; // 30s testing / 6h normal
const TRUCK_TRAVEL_TIME = process.env.FAST_MODE === 'true' ? 10 * 1000 : 60 * 60 * 1000; // 10s testing / 1h normal

// Helper functions
function computeProducedSince(productionStart, birds) {
  if (!productionStart) return {};

  const nowSec = Math.floor(Date.now() / 1000);
  const startSec = Math.floor(new Date(productionStart).getTime() / 1000);
  let seconds = nowSec - startSec;
  if (seconds > SIX_HOURS_SEC) seconds = SIX_HOURS_SEC;

  const produced = {};
  for (const color of Object.keys(BIRDS)) {
    const count = (birds && birds[color]) ? birds[color] : 0;
    produced[color] = Math.floor(count * BIRDS[color].eps * seconds);
  }
  return produced;
}

async function getUser(username) {
  return await User.findByUsername(username);
}

// GET /api/game/status/:username
router.get("/status/:username", async (req, res) => {
  try {
    const user = await getUser(req.params.username);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Reset corrupted data
    if (!user.eggs || typeof user.eggs !== 'object') {
      user.eggs = {};
      await user.save();
    }
    if (!user.savedProduced || typeof user.savedProduced !== 'object') {
      user.savedProduced = {};
      await user.save();
    }

    // Handle truck travel completion
    if (user.truckLocation === 'traveling_to_city' && user.truckDepartureTime) {
      const travelTime = Date.now() - user.truckDepartureTime.getTime();
      if (travelTime >= TRUCK_TRAVEL_TIME) { // 1 hour (or 10s in fast mode)
        user.truckLocation = 'city';
        user.truckDepartureTime = null;
        await user.save();
      }
    } else if (user.truckLocation === 'traveling_to_farm' && user.truckDepartureTime) {
      const travelTime = Date.now() - user.truckDepartureTime.getTime();
      if (travelTime >= TRUCK_TRAVEL_TIME) { // 1 hour (or 10s in fast mode)
        user.truckLocation = 'farm';
        user.truckDepartureTime = null;
        await user.save();
      }
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
      truckInventory: user.truckInventory || {}
    });
  } catch (err) {
    if (process.env.CONSOLE_MESSAGES === 'true') console.error("Status error:", err);
    res.status(500).json({ error: "Server error" });
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

    const lastCollectTime = user.lastSaveTime || user.productionStart;
    const nowSec = Math.floor(Date.now() / 1000);
    const lastCollectSec = Math.floor(new Date(lastCollectTime).getTime() / 1000);
    let seconds = nowSec - lastCollectSec;

    if (seconds <= 0) {
      return res.json({ success: true, collected: {}, eggs: user.eggs });
    }
    if (seconds > SIX_HOURS_SEC) {
      seconds = SIX_HOURS_SEC;
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

// POST /api/game/load_truck (formerly sell)
router.post("/load_truck", async (req, res) => {
  try {
    const { username, color, amount } = req.body;
    const user = await getUser(username);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (!BIRDS[color]) {
      return res.status(400).json({ error: "Invalid color" });
    }

    if ((user.eggs[color] || 0) < amount) {
      return res.status(400).json({ error: "Not enough eggs" });
    }

    if (user.truckLocation !== 'farm') {
      return res.status(400).json({ error: "Truck must be at farm to load eggs" });
    }

    // Move eggs from farm inventory to truck
    user.eggs[color] = (user.eggs[color] || 0) - amount;
    user.truckInventory[color] = (user.truckInventory[color] || 0) + amount;
    await user.save();

    res.json({ success: true, eggs: user.eggs, truckInventory: user.truckInventory });
  } catch (err) {
    console.error("Load truck error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/game/truck_go_to_city
router.post("/truck_go_to_city", async (req, res) => {
  try {
    const { username } = req.body;
    const user = await getUser(username);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (user.truckLocation !== 'farm') {
      return res.status(400).json({ error: "Truck must be at farm to depart" });
    }

    // Allow sending truck even if empty
    user.truckLocation = 'traveling_to_city';
    user.truckDepartureTime = new Date();
    // Production continues during travel
    await user.save();

    res.json({ success: true, truckLocation: user.truckLocation, truckDepartureTime: user.truckDepartureTime });
  } catch (err) {
    console.error("Truck go to city error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/game/truck_go_to_farm
router.post("/truck_go_to_farm", async (req, res) => {
  try {
    const { username } = req.body;
    const user = await getUser(username);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (user.truckLocation !== 'city') {
      return res.status(400).json({ error: "Truck must be at city to return to farm" });
    }

    user.truckLocation = 'traveling_to_farm';
    user.truckDepartureTime = new Date();
    await user.save();

    res.json({ success: true, truckLocation: user.truckLocation, truckDepartureTime: user.truckDepartureTime });
  } catch (err) {
    console.error("Truck go to farm error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/game/sell_truck_eggs
router.post("/sell_truck_eggs", async (req, res) => {
  try {
    const { username } = req.body;
    const user = await getUser(username);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (user.truckLocation !== 'city') {
      return res.status(400).json({ error: "Truck must be at city to sell eggs" });
    }

    let totalCoins = 0;
    const inventorySource = (user.truckInventory && typeof user.truckInventory.toObject === 'function')
      ? user.truckInventory.toObject()
      : (user.truckInventory || {});
    const entries = Object.entries(inventorySource);
    for (const [color, amountRaw] of entries) {
      const config = BIRDS[color];
      const amount = Number(amountRaw) || 0;
      if (!config || amount <= 0) {
        continue;
      }

      const coins = Math.floor(amount / config.eggsPerCoin);
      totalCoins += coins;
      user.truckInventory[color] = 0;
    }

    user.coins += totalCoins;
    await user.save();

    res.json({ success: true, coins: user.coins, truckInventory: user.truckInventory, soldFor: totalCoins });
  } catch (err) {
    console.error("Sell truck eggs error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/game/buy
router.post("/buy", async (req, res) => {
  try {
    const { username, color } = req.body;
    const user = await getUser(username);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Allow buying first bird at farm, otherwise require truck at city
    const totalBirds = Object.values(user.birds).reduce((sum, count) => sum + count, 0);
    if (totalBirds > 0 && user.truckLocation !== 'city') {
      return res.status(400).json({ error: "Truck must be at city to buy birds" });
    }

    if (!BIRDS[color]) {
      return res.status(400).json({ error: "Invalid color" });
    }

    if (user.coins < BIRDS[color].cost) {
      return res.status(400).json({ error: "Not enough coins" });
    }

    user.coins -= BIRDS[color].cost;

    // Save current progress before buying to minimize free eggs for new bird
    if (user.lastSaveTime) {
      const { produced } = computeProducedSince(user.lastSaveTime, user.savedProduced, user.birds);
      user.savedProduced = produced;
      user.lastSaveTime = new Date();
    }

    user.birds[color] = (user.birds[color] || 0) + 1;

    // Start production when first bird is bought
    if (!user.productionStart) {
      user.productionStart = new Date();
      // Don't set lastSaveTime for first bird - let timer start from productionStart
      user.savedProduced = {};
    }

    await user.save();

    res.json({
      success: true,
      coins: user.coins,
      birds: user.birds,
      savedProduced: user.savedProduced,
      lastSaveTime: user.lastSaveTime,
      productionStart: user.productionStart
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

    const { produced, seconds } = computeProducedSince(user.lastSaveTime, user.savedProduced, user.birds);
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
