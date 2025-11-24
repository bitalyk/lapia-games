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
import gameRoutes from "./routes/game.js";
import authRoutes from "./routes/auth.js";
import usersRoutes from "./routes/users.js";

dotenv.config();

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

// Подключаем роуты игры
app.use("/api/game", gameRoutes);

// Подключаем роуты аутентификации
app.use("/api/users", authRoutes);

// Подключаем роуты пользователей
app.use("/api/users", usersRoutes);

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({ 
    status: "OK", 
    timestamp: new Date().toISOString(),
    database: mongoose.connection.readyState === 1 ? "Connected" : "Disconnected"
  });
});

// Запуск сервера
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
  console.log(`📊 Platform API available at /api/platform`);
  console.log(`🎮 Game API available at /api/game`);
  console.log(`🔐 Auth API available at /api/users`);
});

