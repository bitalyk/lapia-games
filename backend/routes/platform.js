// backend/routes/platform.js
import express from "express";
import User from "../models/user.js";

const router = express.Router();

// Получение профиля платформы
router.get("/profile/:username", async (req, res) => {
  try {
    const user = await User.findByUsername(req.params.username);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Возвращаем данные платформы (без чувствительной информации)
    res.json({
      success: true,
      profile: {
        username: user.username,
        platformStats: user.platformStats,
        platformCurrencies: user.platformCurrencies,
        gamesProgress: Object.fromEntries(user.gamesProgress || new Map()),
        inventory: user.inventory,
        settings: user.settings,
        registeredAt: user.createdAt
      }
    });
  } catch (error) {
    console.error("Platform profile error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// Обновление настроек
router.put("/settings/:username", async (req, res) => {
  try {
    const { settings } = req.body;
    const user = await User.findByUsername(req.params.username);
    
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    user.settings = { ...user.settings, ...settings };
    await user.save();

    res.json({ success: true, settings: user.settings });
  } catch (error) {
    console.error("Settings update error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// Получение балансов валют
router.get("/currencies/:username", async (req, res) => {
  try {
    const user = await User.findByUsername(req.params.username);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({
      success: true,
      currencies: user.platformCurrencies || {}
    });
  } catch (error) {
    console.error("Currencies fetch error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// Обновление валют
router.post("/currencies/update", async (req, res) => {
  try {
    const { username, currencyType, amount, operation = 'add' } = req.body;
    
    if (!username || !currencyType || amount === undefined) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const user = await User.findByUsername(username);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const currentBalance = user.platformCurrencies?.[currencyType] || 0;
    let newBalance;

    if (operation === 'add') {
      newBalance = currentBalance + amount;
    } else if (operation === 'subtract') {
      if (currentBalance < amount) {
        return res.status(400).json({ error: "Insufficient balance" });
      }
      newBalance = currentBalance - amount;
    } else if (operation === 'set') {
      newBalance = amount;
    } else {
      return res.status(400).json({ error: "Invalid operation" });
    }

    user.platformCurrencies = user.platformCurrencies || {};
    user.platformCurrencies[currencyType] = newBalance;

    await user.save();

    res.json({
      success: true,
      currencyType,
      newBalance,
      operation
    });
  } catch (error) {
    console.error("Currency update error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// Обмен валют
router.post("/currencies/exchange", async (req, res) => {
  try {
    const { username, fromCurrency, toCurrency, amount } = req.body;
    
    if (!username || !fromCurrency || !toCurrency || !amount) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    if (amount <= 0) {
      return res.status(400).json({ error: "Amount must be positive" });
    }

    const user = await User.findByUsername(username);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Курсы обмена (можно вынести в конфиг)
    const exchangeRates = {
      'happy-birds': 1000, // 1 platform token = 1000 bird eggs
      'platform': 1
    };

    const fromBalance = user.platformCurrencies?.[fromCurrency] || 0;
    if (fromBalance < amount) {
      return res.status(400).json({ error: "Insufficient balance" });
    }

    const rate = exchangeRates[toCurrency] / exchangeRates[fromCurrency];
    const receivedAmount = Math.floor(amount * rate);

    // Обновляем балансы
    user.platformCurrencies[fromCurrency] = fromBalance - amount;
    user.platformCurrencies[toCurrency] = 
      (user.platformCurrencies[toCurrency] || 0) + receivedAmount;

    await user.save();

    res.json({
      success: true,
      fromAmount: amount,
      toAmount: receivedAmount,
      rate: rate,
      newBalances: user.platformCurrencies
    });
  } catch (error) {
    console.error("Currency exchange error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// Обновление прогресса игры
router.post("/game-progress", async (req, res) => {
  try {
    const { username, gameId, progress } = req.body;
    
    const user = await User.findByUsername(username);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    await user.updateGameProgress(gameId, progress);

    res.json({
      success: true,
      gameId,
      progress: user.gamesProgress.get(gameId)
    });
  } catch (error) {
    console.error("Game progress update error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// Покупка в магазине
router.post("/shop/purchase", async (req, res) => {
  try {
    const { username, itemId, itemType, game, quantity = 1 } = req.body;
    
    const user = await User.findByUsername(username);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Здесь будет логика обработки покупки
    // Пока просто логируем
    console.log(`Purchase: ${username} bought ${quantity}x ${itemId} for ${game}`);

    // В будущем здесь будет списание валют и выдача предметов

    res.json({
      success: true,
      message: "Purchase completed",
      itemId,
      quantity
    });
  } catch (error) {
    console.error("Shop purchase error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// Получение инвентаря
router.get("/inventory/:username", async (req, res) => {
  try {
    const user = await User.findByUsername(req.params.username);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({
      success: true,
      inventory: user.inventory || {}
    });
  } catch (error) {
    console.error("Inventory fetch error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// Обновление времени игры
router.post("/playtime", async (req, res) => {
  try {
    const { username, gameId, minutes } = req.body;
    
    const user = await User.findByUsername(username);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Обновляем общее время и время конкретной игры
    user.platformStats.totalPlayTime = (user.platformStats.totalPlayTime || 0) + minutes;
    
    const gameProgress = user.gamesProgress.get(gameId) || {};
    gameProgress.totalPlayTime = (gameProgress.totalPlayTime || 0) + minutes;
    user.gamesProgress.set(gameId, gameProgress);

    user.platformStats.lastLogin = new Date();
    user.lastActive = new Date();

    await user.save();

    res.json({
      success: true,
      totalPlayTime: user.platformStats.totalPlayTime,
      gamePlayTime: gameProgress.totalPlayTime
    });
  } catch (error) {
    console.error("Playtime update error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;