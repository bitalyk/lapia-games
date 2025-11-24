// backend/routes/auth.js
import express from "express";
import bcrypt from "bcrypt";
import User from "../models/user.js";

const router = express.Router();

// Helper function to get user
async function getUser(username) {
  return await User.findByUsername(username);
}

// POST /api/auth/register
router.post("/register", async (req, res) => {
  try {
    const { username, password, email } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: "Username and password required" });
    }

    if (username.length < 3 || username.length > 20) {
      return res.status(400).json({ error: "Username must be 3-20 characters" });
    }

    // Check existing user
    const existing = await getUser(username);
    if (existing) {
      return res.status(400).json({ error: "Username already exists" });
    }

    // Hash password
    const hash = await bcrypt.hash(password, 10);

    // Create user with platform data
    const user = new User({
      username,
      passwordHash: hash,
      email: email || null,
      // Platform data initialized by default in schema
    });

    await user.save();

    // Return full user data
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

// POST /api/auth/login
router.post("/login", async (req, res) => {
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

    // Update last login
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

export default router;