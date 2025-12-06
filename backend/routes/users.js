import express from "express";
import User from "../models/user.js";

const router = express.Router();

// Helper function to get user
async function getUser(username) {
  return await User.findByUsername(username);
}

// GET /api/users/profile/:username
router.get("/profile/:username", async (req, res) => {
  try {
    const username = req.params.username;
    const user = await getUser(username);

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Return basic info for session validation
    res.json({
      success: true,
      user: {
        username: user.username,
        platformStats: user.platformStats,
        platformCurrencies: user.platformCurrencies,
        lastActive: user.lastActive,
        lpaBalance: user.lpaBalance,
        achievementProgress: user.achievementProgress,
        currencyByGame: user.currencyByGame,
        activityStreak: user.activityStreak
      }
    });
  } catch (err) {
    console.error("Profile fetch error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// GET /api/users/platform-data/:username
router.get("/platform-data/:username", async (req, res) => {
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
        registeredAt: user.createdAt,
        lpaBalance: user.lpaBalance,
        achievementProgress: user.achievementProgress,
        currencyByGame: user.currencyByGame,
        activityStreak: user.activityStreak
      }
    });
  } catch (err) {
    console.error("Platform data fetch error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
