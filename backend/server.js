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

// Progress saving function
async function saveProgress() {
  try {
    const users = await User.find({ productionStart: { $ne: null } });
    for (const user of users) {
      // Skip if data is corrupted
      if (!user.birds || typeof user.birds !== 'object') continue;
      if (!user.savedProduced || typeof user.savedProduced !== 'object') {
        user.savedProduced = {};
      }

      if (user.lastSaveTime) {
        const nowSec = Math.floor(Date.now() / 1000);
        const saveSec = Math.floor(new Date(user.lastSaveTime).getTime() / 1000);
        const seconds = Math.min(nowSec - saveSec, 6 * 60 * 60); // Cap at 6 hours

        if (seconds > 0) {
          const newProduced = {};
          const BIRDS = {
            red: { eps: 1 }, orange: { eps: 2 }, yellow: { eps: 5 },
            green: { eps: 10 }, blue: { eps: 20 }, purple: { eps: 50 }
          };

          for (const color of Object.keys(BIRDS)) {
            const count = user.birds[color] || 0;
            if (count > 0) {
              newProduced[color] = Math.floor(count * BIRDS[color].eps * seconds);
            }
          }

          // Update saved produced
          for (const color in newProduced) {
            user.savedProduced[color] = (user.savedProduced[color] || 0) + newProduced[color];
          }

          user.lastSaveTime = new Date();
          await user.save();
        }
      }

      // Save Rich Garden progress
      if (user.richGardenProgress && user.richGardenProgress.garden) {
        const rgData = user.richGardenProgress;
        let updated = false;

        // Update tree timers (1 second per save interval)
        rgData.garden.forEach((tree, index) => {
          if (tree) {
            if (tree.state === 'producing') {
              tree.timeLeft = Math.max(0, tree.timeLeft - 1);
              if (tree.timeLeft <= 0) {
                tree.state = 'ready';
                tree.timeLeft = 30 * 60; // 30 minutes in seconds
                updated = true;
              }
            } else if (tree.state === 'collecting') {
              tree.timeLeft = Math.max(0, tree.timeLeft - 1);
              if (tree.timeLeft <= 0) {
                tree.state = 'producing';
                tree.timeLeft = 4 * 60 * 60; // 4 hours in seconds
                updated = true;
              }
            }
          }
        });

        // Update truck location
        if (rgData.truckDepartureTime) {
          const departureTime = new Date(rgData.truckDepartureTime);
          const now = new Date();
          const elapsed = Math.floor((now - departureTime) / 1000);

          if (rgData.truckLocation === 'traveling_to_city' && elapsed >= 60 * 60) { // 1 hour
            rgData.truckLocation = 'city';
            rgData.truckDepartureTime = null;
            updated = true;
          } else if (rgData.truckLocation === 'traveling_to_farm' && elapsed >= 60 * 60) { // 1 hour
            rgData.truckLocation = 'farm';
            rgData.truckDepartureTime = null;
            updated = true;
          }
        }

        if (updated) {
          await user.save();
        }
      }
    }
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
app.use("/api/platform", platformRoutes);

// Подключаем роуты игры
app.use("/api/game", happyBirdsRoutes);

// Подключаем роуты аутентификации
app.use("/api/users", authRoutes);

// Подключаем роуты пользователей
app.use("/api/users", usersRoutes);

// Подключаем роуты Rich Garden
app.use("/api/rich-garden", richGardenRoutes);

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
    consoleMessages: process.env.CONSOLE_MESSAGES === 'true'
  });
});

// Запуск сервера
app.listen(PORT, () => {
  if (process.env.CONSOLE_MESSAGES === 'true') console.log(`✅ Server running on http://localhost:${PORT}`);
  if (process.env.CONSOLE_MESSAGES === 'true') console.log(`📊 Platform API available at /api/platform`);
  if (process.env.CONSOLE_MESSAGES === 'true') console.log(`🎮 Game API available at /api/game`);
  if (process.env.CONSOLE_MESSAGES === 'true') console.log(`🌳 Rich Garden API available at /api/rich-garden`);
  if (process.env.CONSOLE_MESSAGES === 'true') console.log(`🔐 Auth API available at /api/users`);
});

