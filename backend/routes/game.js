import express from "express";
import User from "../models/user.js";

const router = express.Router();

// Save progress
router.post("/save", async (req, res) => {
  const { username, cookies, cookiesPerClick, upgrades } = req.body;
  const user = await User.findOneAndUpdate(
    { username },
    { cookies, cookiesPerClick, upgrades },
    { new: true }
  );
  res.json({ success: true, user });
});

// Load progress
router.get("/load/:username", async (req, res) => {
  const user = await User.findOne({ username: req.params.username });
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json(user);
});

export default router;
