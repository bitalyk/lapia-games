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
function computeProducedSince(productionStart, birds) {
  const nowSec = Math.floor(Date.now() / 1000);
  const startSec = productionStart ? Math.floor(new Date(productionStart).getTime() / 1000) : nowSec;
  let seconds = nowSec - startSec;
  if (seconds <= 0) return { produced: {}, seconds: 0 };
  if (seconds > SIX_HOURS_SEC) seconds = SIX_HOURS_SEC;

  const produced = {};
  for (const color of Object.keys(BIRDS)) {
    const count = (birds && birds[color]) ? birds[color] : 0;
    if (count <= 0) { produced[color] = 0; continue; }
    produced[color] = Math.floor(count * BIRDS[color].eps * seconds);
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

    const { produced } = computeProducedSince(user.productionStart, user.birds);
    res.json({
      coins: user.coins,
      birds: user.birds,
      eggs: user.eggs,
      produced,
      productionStart: user.productionStart
    });
  } catch (err) {
    console.error("Status error:", err);
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

    const { produced } = computeProducedSince(user.productionStart, user.birds);
    for (const color in produced) {
      user.eggs[color] = (user.eggs[color] || 0) + produced[color];
    }
    user.productionStart = new Date();
    await user.save();

    res.json({ success: true, collected: produced, eggs: user.eggs });
  } catch (err) {
    console.error("Collect error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/game/sell
router.post("/sell", async (req, res) => {
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

    const coins = Math.floor(amount / BIRDS[color].eggsPerCoin);
    user.eggs[color] -= amount;
    user.coins += coins;
    await user.save();

    res.json({ success: true, coins: user.coins, eggs: user.eggs });
  } catch (err) {
    console.error("Sell error:", err);
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

    if (!BIRDS[color]) {
      return res.status(400).json({ error: "Invalid color" });
    }

    if (user.coins < BIRDS[color].cost) {
      return res.status(400).json({ error: "Not enough coins" });
    }

    user.coins -= BIRDS[color].cost;
    user.birds[color] = (user.birds[color] || 0) + 1;
    await user.save();

    res.json({ success: true, coins: user.coins, birds: user.birds });
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
      user.productionStart = new Date(Date.now() - SIX_HOURS_SEC * 1000);
    } else {
      user.birds[bird] = (user.birds[bird] || 0) + 1;
    }

    user.redeemedCodes.push(code);
    await user.save();

    res.json({ success: true, birds: user.birds, productionStart: user.productionStart });
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

    const { produced, seconds } = computeProducedSince(user.productionStart, user.birds);
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
