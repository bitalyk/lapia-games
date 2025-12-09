// backend/server.js
import path from "path";
import express from "express";
import cors from "cors";
import { fileURLToPath } from "url";
import mongoose from "mongoose";
import dotenv from 'dotenv';

// Импорты моделей и роутов
import User from "./models/user.js";
import platformRoutes from "./routes/platform.js";
import happyBirdsRoutes from "./routes/happy-birds.js";
import authRoutes from "./routes/auth.js";
import usersRoutes from "./routes/users.js";
import richGardenRoutes from "./routes/rich-garden.js";
import goldenMineRoutes from "./routes/golden-mine.js";
import catChessRoutes from "./routes/cat-chess.js";
import fishesRoutes from "./routes/fishes.js";
import achievementsRoutes from "./routes/achievements.js";
import promoCodeRoutes from "./routes/promo-codes.js";
import friendsRoutes from "./routes/friends.js";
import leaderboardRoutes from "./routes/leaderboards.js";
import { reconcileHappyBirdsTransport } from "./services/happy-birds-transport-reconciler.js";
import authConfig, { getPublicAuthConfig } from "./config/auth-config.js";
import requireAuth from "./middleware/require-auth.js";

if (process.env.NODE_ENV === 'production' && authConfig.mode === 'manual') {
  console.warn('WARNING: Manual auth mode enabled in production! Telegram auth is strongly recommended.');
}

// Mine configuration for progress saving
const MINE_TYPES = {
  coal: { orePerSecond: 1 },
  copper: { orePerSecond: 2 },
  iron: { orePerSecond: 5 },
  nickel: { orePerSecond: 10 },
  silver: { orePerSecond: 20 },
  golden: { orePerSecond: 50 }
};

function getOrePerSecond(mineType) {
  return MINE_TYPES[mineType]?.orePerSecond || 0;
}

// Progress saving function
async function saveProgress() {
  try {
    const SIX_HOURS_SEC = process.env.FAST_MODE === 'true' ? 30 : 6 * 60 * 60; // Use same logic as routes
    const PRODUCTION_TIME = process.env.FAST_MODE === 'true' ? 30 : 4 * 60 * 60; // Rich Garden
    const COLLECTION_TIME = process.env.FAST_MODE === 'true' ? 15 : 30 * 60; // Rich Garden
    const TRUCK_TRAVEL_TIME = process.env.FAST_MODE === 'true' ? 10 : 60 * 60; // 1 hour
    const GM_PRODUCTION_TIME = process.env.FAST_MODE === 'true' ? 30 : 8 * 60 * 60; // Golden Mine
    const GM_REST_TIME = process.env.FAST_MODE === 'true' ? 15 : 4 * 60 * 60; // Golden Mine
    const GM_TRUCK_TRAVEL_TIME = process.env.FAST_MODE === 'true' ? 10 : 2 * 60 * 60; // Golden Mine

    // Helper function for Happy Birds
    function computeProducedSince(productionStart, birds) {
      if (!productionStart) return {};
      const nowSec = Math.floor(Date.now() / 1000);
      const startSec = Math.floor(new Date(productionStart).getTime() / 1000);
      let seconds = nowSec - startSec;
      if (seconds > SIX_HOURS_SEC) seconds = SIX_HOURS_SEC;
      const produced = {};
      const BIRDS = {
        red: { eps: 1 }, orange: { eps: 2 }, yellow: { eps: 5 },
        green: { eps: 10 }, blue: { eps: 20 }, purple: { eps: 50 }
      };
      for (const color of Object.keys(BIRDS)) {
        const count = (birds && birds[color]) ? birds[color] : 0;
        produced[color] = Math.floor(count * BIRDS[color].eps * seconds);
      }
      // Cap produced
      for (const color in produced) {
        produced[color] = Math.min(produced[color], BIRDS[color].eps * SIX_HOURS_SEC);
      }
      return produced;
    }

    const users = await User.find({ productionStart: { $ne: null } });
    for (const user of users) {
      // Skip if data is corrupted
      if (!user.birds || typeof user.birds !== 'object') continue;
      if (!user.savedProduced || typeof user.savedProduced !== 'object') {
        user.savedProduced = {};
      }

      // Happy Birds: Production is now only calculated on collect.
      // The background save no longer needs to update savedProduced.

      // Save Rich Garden progress is now handled by explicit user actions (collect).
      // The background save no longer needs to update Rich Garden state.

      // Save Golden Mine progress
      if (user.goldenMineProgress && user.goldenMineProgress.mines) {
        const gmData = user.goldenMineProgress;
        let updated = false;

        // Update mine timers (1 second per save interval)
        gmData.mines.forEach((mine, index) => {
          if (mine) {
            const timePassed = 1; // 1 second per save

            if (mine.state === 'producing' && timePassed >= mine.timeLeft) {
              // Production finished, move to ready
              mine.state = 'ready';
              mine.oreProduced = mine.workers * getOrePerSecond(mine.type) * GM_PRODUCTION_TIME; // 8 hours (or 30s fast mode)
              mine.timeLeft = 0;
              mine.lastStateChange = new Date();
              updated = true;
            } else if (mine.state === 'producing') {
              mine.timeLeft -= timePassed;
              mine.lastStateChange = new Date();
              updated = true;
            } else if (mine.state === 'resting' && timePassed >= mine.timeLeft) {
              // Rest finished, back to producing
              mine.state = 'producing';
              mine.timeLeft = GM_PRODUCTION_TIME; // 8 hours (or 30s fast mode)
              mine.lastStateChange = new Date();
              updated = true;
            } else if (mine.state === 'resting') {
              mine.timeLeft -= timePassed;
              mine.lastStateChange = new Date();
              updated = true;
            }
          }
        });

        // Update truck location
        if (gmData.truckDepartureTime) {
          const departureTime = new Date(gmData.truckDepartureTime);
          const now = new Date();
          const elapsed = Math.floor((now - departureTime) / 1000);

          if (gmData.truckLocation === 'traveling_to_factory' && elapsed >= GM_TRUCK_TRAVEL_TIME) { // 2 hours (or 10s fast mode)
            gmData.truckLocation = 'factory';
            gmData.truckDepartureTime = null;
            updated = true;
          } else if (gmData.truckLocation === 'traveling_to_mine' && elapsed >= GM_TRUCK_TRAVEL_TIME) { // 2 hours (or 10s fast mode)
            gmData.truckLocation = 'mine';
            gmData.truckDepartureTime = null;
            updated = true;
          }
        }

        if (updated) {
          await user.save();
        }
      }
    }

    await reconcileHappyBirdsTransport();
  } catch (error) {
    console.error('Progress save error:', error);
  }
}

// Start progress saving interval
setInterval(saveProgress, 30000); // Save every 30 seconds

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Serve frontend static files
const frontendRoot = path.join(__dirname, "..", "frontend");
if (process.env.CONSOLE_MESSAGES === 'true') console.log("Serving frontend from", frontendRoot);
app.use(express.static(frontendRoot));

// Fallback to index.html
app.get("/", (req, res) => {
  res.sendFile(path.join(frontendRoot, "index.html"));
});

// Подключаем роуты платформы
app.use("/api/platform", requireAuth, platformRoutes);

// Подключаем систему достижений
app.use("/api/achievements", requireAuth, achievementsRoutes);

// Подключаем роуты игры
app.use("/api/game", requireAuth, happyBirdsRoutes);

// Подключаем роуты аутентификации
app.use("/api/users", authRoutes);
app.use("/api/auth", authRoutes);

// Подключаем роуты пользователей
app.use("/api/users", requireAuth, usersRoutes);

// Подключаем роуты Rich Garden
app.use("/api/rich-garden", requireAuth, richGardenRoutes);

// Подключаем роуты Golden Mine
app.use("/api/golden-mine", requireAuth, goldenMineRoutes);
console.log('⛏️ Golden Mine API available at /api/golden-mine');

// Подключаем роуты Cat Chess
app.use("/api/cat-chess", requireAuth, catChessRoutes);
console.log('🐱 Cat Chess API available at /api/cat-chess');

// Подключаем роуты Fishes
app.use("/api/fishes", requireAuth, fishesRoutes);
console.log('🐟 Fishes API available at /api/fishes');

// Promo codes system
app.use("/api/promo", requireAuth, promoCodeRoutes);
console.log('🎁 Promo API available at /api/promo');

// Friends & invitations
app.use("/api/friends", requireAuth, friendsRoutes);
console.log('🤝 Friends API available at /api/friends');

// Leaderboards
app.use("/api/leaderboards", requireAuth, leaderboardRoutes);
console.log('🏆 Leaderboards API available at /api/leaderboards');

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({ 
    status: "OK", 
    timestamp: new Date().toISOString(),
    database: mongoose.connection.readyState === 1 ? "Connected" : "Disconnected"
  });
});

// Config endpoint for frontend
app.get("/api/config", (req, res) => {
  res.json({
    enableRedeem: process.env.ENABLE_REDEEM === 'true',
    showRestartButton: process.env.SHOW_RESTART_BUTTON === 'true',
    consoleMessages: process.env.CONSOLE_MESSAGES === 'true',
    fastMode: process.env.FAST_MODE === 'true',
    auth: getPublicAuthConfig()
  });
});

// Запуск сервера
app.listen(PORT, () => {
  if (process.env.CONSOLE_MESSAGES === 'true') console.log(`✅ Server running on http://localhost:${PORT}`);
  if (process.env.CONSOLE_MESSAGES === 'true') console.log(`📊 Platform API available at /api/platform`);
  if (process.env.CONSOLE_MESSAGES === 'true') console.log(`🎮 Game API available at /api/game`);
  if (process.env.CONSOLE_MESSAGES === 'true') console.log(`🌳 Rich Garden API available at /api/rich-garden`);
  if (process.env.CONSOLE_MESSAGES === 'true') console.log(`🐱 Cat Chess API available at /api/cat-chess`);
  if (process.env.CONSOLE_MESSAGES === 'true') console.log(`🔐 Auth API available at /api/users`);
});

