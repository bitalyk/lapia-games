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

const CODES = {
  REDBIRD: "red",
  ORANGEBIRD: "orange", 
  YELLOWBIRD: "yellow",
  GREENBIRD: "green",
  BLUEBIRD: "blue",
  PURPLEBIRD: "purple",
  SKIPTIMER: "skip_timer"
};

const SIX_HOURS_SEC = 6 * 60 * 60;

// Helper functions
function computeProducedSince(lastSaveTime, savedProduced, birds) {
  if (!lastSaveTime) return { produced: {}, seconds: 0 };

  const nowSec = Math.floor(Date.now() / 1000);
  const saveSec = Math.floor(new Date(lastSaveTime).getTime() / 1000);
  let seconds = nowSec - saveSec;
  if (seconds <= 0) return { produced: savedProduced || {}, seconds: 0 };
  if (seconds > SIX_HOURS_SEC) seconds = SIX_HOURS_SEC;

  const produced = { ...(savedProduced || {}) };
  for (const color of Object.keys(BIRDS)) {
    const count = (birds && birds[color]) ? birds[color] : 0;
    if (count <= 0) { produced[color] = produced[color] || 0; continue; }
    produced[color] = (produced[color] || 0) + Math.floor(count * BIRDS[color].eps * seconds);
  }
  return { produced, seconds };
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
      if (travelTime >= 60 * 60 * 1000) { // 1 hour
        user.truckLocation = 'city';
        user.truckDepartureTime = null;
        await user.save();
      }
    } else if (user.truckLocation === 'traveling_to_farm' && user.truckDepartureTime) {
      const travelTime = Date.now() - user.truckDepartureTime.getTime();
      if (travelTime >= 60 * 60 * 1000) { // 1 hour
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

    // Reset corrupted data
    if (!user.eggs || typeof user.eggs !== 'object') {
      user.eggs = {};
    }
    if (!user.savedProduced || typeof user.savedProduced !== 'object') {
      user.savedProduced = {};
    }

    const { produced } = computeProducedSince(user.lastSaveTime, user.savedProduced, user.birds);
    
    // Ensure produced values are numbers
    for (const color in produced) {
      const amount = produced[color];
      if (typeof amount === 'number' && amount > 0) {
        user.eggs[color] = (user.eggs[color] || 0) + amount;
      }
    }

    // Reset progress tracking
    user.lastSaveTime = new Date();
    user.savedProduced = {};
    await user.save();

    res.json({ success: true, collected: produced, eggs: user.eggs });
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
    for (const color in user.truckInventory) {
      const amount = user.truckInventory[color] || 0;
      if (amount > 0) {
        const coins = Math.floor(amount / BIRDS[color].eggsPerCoin);
        totalCoins += coins;
        user.truckInventory[color] = 0;
      }
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

// POST /api/game/redeem
router.post("/redeem", async (req, res) => {
  try {
    const { username, code } = req.body;
    const user = await getUser(username);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (user.redeemedCodes.includes(code)) {
      return res.status(400).json({ error: "Code already redeemed" });
    }

    const bird = CODES[code.toUpperCase()];
    if (!bird) {
      return res.status(400).json({ error: "Invalid code" });
    }

    if (bird === "skip_timer") {
      // Set production as if it started 6 hours ago
      user.productionStart = new Date(Date.now() - SIX_HOURS_SEC * 1000);
      user.lastSaveTime = new Date(Date.now() - SIX_HOURS_SEC * 1000);
      user.savedProduced = {};

      // Calculate what would have been produced in 6 hours
      for (const color of Object.keys(BIRDS)) {
        const count = user.birds[color] || 0;
        if (count > 0) {
          user.savedProduced[color] = Math.floor(count * BIRDS[color].eps * SIX_HOURS_SEC);
        }
      }
    } else {
      // Save current progress before redeeming bird to minimize free eggs
      if (user.lastSaveTime) {
        const { produced } = computeProducedSince(user.lastSaveTime, user.savedProduced, user.birds);
        user.savedProduced = produced;
        user.lastSaveTime = new Date();
      }

      user.birds[bird] = (user.birds[bird] || 0) + 1;
    }

    user.redeemedCodes.push(code);
    await user.save();

    res.json({ 
      success: true, 
      birds: user.birds, 
      productionStart: user.productionStart,
      savedProduced: user.savedProduced,
      lastSaveTime: user.lastSaveTime
    });
  } catch (err) {
    console.error("Redeem error:", err);
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
