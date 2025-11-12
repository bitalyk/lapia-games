// backend/server.js
import express from "express";
import cors from "cors";
import bcrypt from "bcrypt";
import User from "./models/user.js";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

/**
 * Bird configuration: cost / eggsPerSecond / eggsPerCoin (sell rate)
 */
const BIRDS = {
  red:    { cost: 1000,   eps: 1,  eggsPerCoin: 100, label: "Red" },
  orange: { cost: 2500,   eps: 2,  eggsPerCoin: 80,  label: "Orange" },
  yellow: { cost: 10000,  eps: 5,  eggsPerCoin: 50,  label: "Yellow" },
  green:  { cost: 25000,  eps: 10, eggsPerCoin: 40,  label: "Green" },
  blue:   { cost: 100000, eps: 20, eggsPerCoin: 20,  label: "Blue" },
  purple: { cost: 500000, eps: 50, eggsPerCoin: 10,  label: "Purple" },
};

// Redeem codes mapping (case-insensitive)
const CODES = {
  REDBIRD: "red",
  ORANGEBIRD: "orange",
  YELLOWBIRD: "yellow",
  GREENBIRD: "green",
  BLUEBIRD: "blue",
  PURPLEBIRD: "purple",
  SKIPTIMER: "skip_timer"   // new special code
};

const SIX_HOURS_SEC = 6 * 60 * 60;

// ---------------- helper functions ----------------
function computeProducedSince(productionStart, birds) {
  // returns integer produced eggs per color, capping production time to 6 hours
  const now = Date.now();
  const start = new Date(productionStart).getTime();
  let seconds = Math.floor((now - start) / 1000);
  if (seconds < 0) seconds = 0;
  if (seconds > SIX_HOURS_SEC) seconds = SIX_HOURS_SEC;
  const produced = {};
  for (const color of Object.keys(BIRDS)) {
    const count = (birds && birds[color]) ? birds[color] : 0;
    produced[color] = Math.floor(count * BIRDS[color].eps * seconds);
  }
  return { produced, seconds };
}

// get user helper
async function getUser(username) {
  return await User.findOne({ username });
}

// ---------------- auth endpoints ----------------
app.post("/api/users/register", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "username & password required" });

    const existing = await User.findOne({ username });
    if (existing) return res.status(400).json({ error: "username exists" });

    const hash = await bcrypt.hash(password, 10);
    const user = new User({ username, passwordHash: hash });
    await user.save();
    return res.json({ success: true, user: { username: user.username, coins: user.coins } });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "server error" });
  }
});

app.post("/api/users/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "username & password required" });

    const user = await getUser(username);
    if (!user) return res.status(401).json({ error: "User not found" });

    const valid = await bcrypt.compare(password, user.passwordHash || "");
    if (!valid) return res.status(401).json({ error: "Invalid password" });

    return res.json({ success: true, user: { username: user.username } });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "server error" });
  }
});

// ---------------- game endpoints ----------------

/**
 * GET /api/game/status/:username
 * returns: coins, birds, eggs (inventory), productionStart (timestamp), liveProduced (computed)
 */
app.get("/api/game/status/:username", async (req, res) => {
  try {
    const username = req.params.username;
    const user = await getUser(username);
    if (!user) return res.status(404).json({ error: "User not found" });

    const { produced, seconds } = computeProducedSince(user.productionStart, user.birds);
    // live eggs = inventory eggs + produced (produced is capped to 6 hours)
    const live = {};
    for (const c of Object.keys(BIRDS)) {
      live[c] = (user.eggs[c] || 0) + (produced[c] || 0);
    }

    res.json({
      username: user.username,
      coins: user.coins,
      birds: user.birds,
      eggs: user.eggs,
      productionStart: user.productionStart,
      producedSinceStart: produced,
      producedSeconds: seconds,
      liveEggs: live,
      redeemedCodes: user.redeemedCodes || []
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server error" });
  }
});

/**
 * POST /api/game/collect
 * Collects produced eggs only if 6 hours passed since productionStart.
 * Adds produced eggs to inventory (user.eggs), resets productionStart = now.
 */
app.post("/api/game/collect", async (req, res) => {
  try {
    const { username } = req.body;
    const user = await getUser(username);
    if (!user) return res.status(404).json({ error: "User not found" });

    const now = Date.now();
    const start = new Date(user.productionStart).getTime();
    const elapsed = Math.floor((now - start) / 1000);

    if (elapsed < SIX_HOURS_SEC) {
      const remaining = SIX_HOURS_SEC - elapsed;
      return res.status(400).json({ error: "not_ready", message: "You can collect only after 6 hours", remainingSeconds: remaining });
    }

    // compute produced (capped to 6 hours)
    const { produced } = computeProducedSince(user.productionStart, user.birds);
    for (const color of Object.keys(BIRDS)) {
      const add = produced[color] || 0;
      if (add > 0) user.eggs[color] = (user.eggs[color] || 0) + add;
    }

    // reset production start to now (new cycle starts immediately)
    user.productionStart = new Date();
    await user.save();

    return res.json({ success: true, message: "Eggs collected", produced, eggs: user.eggs });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server error" });
  }
});

/**
 * POST /api/game/sell
 * Sells inventory eggs for coins using eggsPerCoin rates. Only inventory eggs are sold.
 */
app.post("/api/game/sell", async (req, res) => {
  try {
    const { username } = req.body;
    const user = await getUser(username);
    if (!user) return res.status(404).json({ error: "User not found" });

    let totalGained = 0;
    for (const color of Object.keys(BIRDS)) {
      const eggs = user.eggs[color] || 0;
      const rate = BIRDS[color].eggsPerCoin;
      if (eggs >= rate) {
        const coinsFrom = Math.floor(eggs / rate);
        totalGained += coinsFrom;
        user.eggs[color] = eggs - coinsFrom * rate;
      }
    }

    user.coins += totalGained;
    await user.save();
    return res.json({ success: true, gained: totalGained, coins: user.coins, eggs: user.eggs });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server error" });
  }
});

/**
 * POST /api/game/buy
 * body: { username, type }
 * Buys 1 bird if user has enough coins
 */
app.post("/api/game/buy", async (req, res) => {
  try {
    const { username, type } = req.body;
    if (!type || !BIRDS[type]) return res.status(400).json({ error: "Invalid bird type" });

    const user = await getUser(username);
    if (!user) return res.status(404).json({ error: "User not found" });

    const cost = BIRDS[type].cost;
    if (user.coins < cost) return res.status(400).json({ error: "Not enough coins" });

    user.coins -= cost;
    user.birds[type] = (user.birds[type] || 0) + 1;
    await user.save();
    return res.json({ success: true, message: `Bought 1 ${type} bird`, user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server error" });
  }
});

/**
 * POST /api/game/redeem
 * body: { username, code }
 * Redeem code to get one bird of mapped color. One-use per player.
 */
app.post("/api/game/redeem", async (req, res) => {
  try {
    const { username, code } = req.body;
    if (!code) return res.status(400).json({ error: "code required" });

    const user = await getUser(username);
    if (!user) return res.status(404).json({ error: "User not found" });

    const key = code.toString().trim().toUpperCase();
    const action = CODES[key];
    if (!action) return res.status(400).json({ error: "Invalid code" });

    if (!user.redeemedCodes) user.redeemedCodes = [];
    if (user.redeemedCodes.includes(key)) return res.status(400).json({ error: "Code already used" });

    // special skip timer code
    if (action === "skip_timer") {
      const { produced } = computeProducedSince(user.productionStart, user.birds);
      // add produced eggs to inventory
      for (const color of Object.keys(BIRDS)) {
        user.eggs[color] = (user.eggs[color] || 0) + (produced[color] || 0);
      }
      // reset productionStart to now (next cycle starts)
      user.productionStart = new Date();
      await user.save();
      return res.json({ success: true, message: "Skip timer applied! Eggs collected.", eggs: user.eggs });
    }

    // regular bird code
    user.birds[action] = (user.birds[action] || 0) + 1;
    user.redeemedCodes.push(key);
    await user.save();

    return res.json({ success: true, message: `Redeemed ${key}: +1 ${action} bird`, birds: user.birds });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server error" });
  }
});

// small helper to compute live produced eggs without saving
app.get("/api/game/live/:username", async (req, res) => {
  try {
    const user = await getUser(req.params.username);
    if (!user) return res.status(404).json({ error: "User not found" });

    const { produced, seconds } = computeProducedSince(user.productionStart, user.birds);
    const live = {};
    for (const color of Object.keys(BIRDS)) {
      live[color] = (user.eggs[color] || 0) + (produced[color] || 0);
    }

    return res.json({ success: true, produced, seconds, live, productionStart: user.productionStart });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server error" });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
