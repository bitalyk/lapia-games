import express from "express";
import User from "../models/user.js";
import AchievementManager from "../services/achievement-manager.js";

const router = express.Router();

async function findUser(username) {
  if (!username) {
    return null;
  }
  return User.findByUsername(username);
}

router.get("/status/:username", async (req, res) => {
  try {
    const user = await findUser(req.params.username);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const status = AchievementManager.getStatus(user);
    if (user.isModified()) {
      await user.save();
    }

    return res.json({ success: true, status });
  } catch (error) {
    console.error("Achievement status error:", error);
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/record-activity", async (req, res) => {
  try {
    const { username, activityDate } = req.body || {};
    const user = await findUser(username);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const result = AchievementManager.recordActivity(user, activityDate ? new Date(activityDate) : new Date());
    const status = AchievementManager.getStatus(user);
    await user.save();

    return res.json({ success: true, result, status });
  } catch (error) {
    console.error("Achievement activity error:", error);
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/convert", async (req, res) => {
  try {
    const { username, count } = req.body || {};
    const user = await findUser(username);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const conversion = AchievementManager.performConversion(user, count || 1);
    const status = AchievementManager.getStatus(user);
    await user.save();

    return res.json({ success: true, conversion, status });
  } catch (error) {
    console.error("Achievement conversion error:", error);
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/record-invite", async (req, res) => {
  try {
    const { username, invitedUsername } = req.body || {};
    const user = await findUser(username);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const result = AchievementManager.recordFriendInvite(user, invitedUsername);
    const status = AchievementManager.getStatus(user);
    await user.save();

    return res.json({ success: true, result, status });
  } catch (error) {
    console.error("Achievement invite error:", error);
    return res.status(500).json({ error: "Server error" });
  }
});

export default router;
