import express from "express";
import bcrypt from "bcrypt";
import User from "../models/user.js";

const router = express.Router();

router.post("/register", async (req, res) => {
  const { username, password } = req.body;
  const hash = await bcrypt.hash(password, 10);
  const existing = await User.findOne({ username });
  if (existing) return res.status(400).json({ error: "Username already exists" });

  const user = new User({ username, passwordHash: hash });
  await user.save();
  res.json({ success: true });
});

router.post("/login", async (req, res) => {
  const { username, password } = req.body;
  const user = await User.findOne({ username });
  if (!user) return res.status(401).json({ error: "User not found" });

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return res.status(401).json({ error: "Invalid password" });

  res.json({ success: true, user });
});

export default router;
