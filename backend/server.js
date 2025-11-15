// backend/server.js
import path from "path";
import express from "express";
import cors from "cors";
import { fileURLToPath } from "url";
import bcrypt from "bcrypt";
import mongoose from "mongoose";

// Импорты моделей и роутов
import User from "./models/user.js";
import platformRoutes from "./routes/platform.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Serve frontend static files
const frontendRoot = path.join(__dirname, "..", "frontend");
console.log("Serving frontend from", frontendRoot);
app.use(express.static(frontendRoot));

// Fallback to index.html
app.get("/", (req, res) => {
  res.sendFile(path.join(frontendRoot, "index.html"));
});

// Подключаем роуты платформы
app.use("/api/platform", platformRoutes);

// Bird configuration (оставляем для совместимости)
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

// Helper functions (оставляем для совместимости)
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

// ---------------- Auth endpoints (обновленные) ----------------
app.post("/api/users/register", async (req, res) => {
  try {
    const { username, password, email } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: "Username and password required" });
    }

    if (username.length < 3 || username.length > 20) {
      return res.status(400).json({ error: "Username must be 3-20 characters" });
    }

    // Проверяем существующего пользователя
    const existing = await User.findByUsername(username);
    if (existing) {
      return res.status(400).json({ error: "Username already exists" });
    }

    // Хешируем пароль
    const hash = await bcrypt.hash(password, 10);
    
    // Создаем пользователя с платформенными данными
    const user = new User({ 
      username, 
      passwordHash: hash,
      email: email || null,
      // Платформенные данные инициализируются по умолчанию в схеме
    });
    
    await user.save();

    // Возвращаем полные данные пользователя
    return res.json({ 
      success: true, 
      user: { 
        username: user.username,
        platformStats: user.platformStats,
        platformCurrencies: user.platformCurrencies,
        gamesProgress: Object.fromEntries(user.gamesProgress),
        registeredAt: user.createdAt
      } 
    });
  } catch (err) {
    console.error("Registration error:", err);
    return res.status(500).json({ error: "Server error during registration" });
  }
});

app.post("/api/users/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: "Username and password required" });
    }

    const user = await getUser(username);
    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }

    const valid = await bcrypt.compare(password, user.passwordHash || "");
    if (!valid) {
      return res.status(401).json({ error: "Invalid password" });
    }

    // Обновляем время последнего входа
    user.platformStats.lastLogin = new Date();
    user.lastActive = new Date();
    await user.save();

    return res.json({ 
      success: true, 
      user: { 
        username: user.username,
        platformStats: user.platformStats,
        platformCurrencies: user.platformCurrencies,
        gamesProgress: Object.fromEntries(user.gamesProgress),
        inventory: user.inventory
      } 
    });
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({ error: "Server error during login" });
  }
});

// ---------------- Game endpoints (оставляем для совместимости) ----------------
// ... существующие endpoints для Happy Birds остаются без изменений ...
// GET /api/game/status/:username
// POST /api/game/collect  
// POST /api/game/sell
// POST /api/game/buy
// POST /api/game/redeem
// GET /api/game/live/:username

// Новый endpoint для обновления данных платформы из игр
app.post("/api/game/platform-update", async (req, res) => {
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

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({ 
    status: "OK", 
    timestamp: new Date().toISOString(),
    database: mongoose.connection.readyState === 1 ? "Connected" : "Disconnected"
  });
});

// backend/server.js
// ДОБАВЛЯЕМ ПОСЛЕ СУЩЕСТВУЮЩИХ GAME ENDPOINTS:

// ✅ НОВЫЙ: Получение профиля пользователя (для валидации сессии)
app.get("/api/users/profile/:username", async (req, res) => {
  try {
    const username = req.params.username;
    const user = await getUser(username);
    
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Возвращаем базовую информацию для валидации сессии
    res.json({
      success: true,
      user: {
        username: user.username,
        platformStats: user.platformStats,
        platformCurrencies: user.platformCurrencies,
        lastActive: user.lastActive
      }
    });
  } catch (err) {
    console.error("Profile fetch error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ✅ НОВЫЙ: Получение платформенных данных пользователя
app.get("/api/users/platform-data/:username", async (req, res) => {
  try {
    const username = req.params.username;
    const user = await getUser(username);
    
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({
      success: true,
      platformData: {
        username: user.username,
        platformStats: user.platformStats,
        platformCurrencies: user.platformCurrencies,
        gamesProgress: Object.fromEntries(user.gamesProgress || new Map()),
        inventory: user.inventory,
        settings: user.settings,
        registeredAt: user.createdAt
      }
    });
  } catch (err) {
    console.error("Platform data fetch error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// Запуск сервера
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
  console.log(`📊 Platform API available at /api/platform`);
  console.log(`🎮 Game API available at /api/game`);
  console.log(`🔐 Auth API available at /api/users`);
});

