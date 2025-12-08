import express from "express";
import {
  generateInviteLink,
  getFriendsForUser,
  getInvitationStats,
  addOrganicFriend
} from "../services/friend-invitation-manager.js";

const router = express.Router();

function requireAuthUser(req, res) {
  if (!req.authUser) {
    res.status(403).json({ error: "Authentication required" });
    return null;
  }
  return req.authUser;
}

router.post("/invite", async (req, res) => {
  try {
    const user = requireAuthUser(req, res);
    if (!user) return;

    const result = await generateInviteLink(user._id);
    return res.json({ success: true, ...result });
  } catch (error) {
    console.error("Invite generation error:", error);
    return res.status(400).json({ error: error.message || "Unable to generate invite" });
  }
});

router.get("/", async (req, res) => {
  try {
    const user = requireAuthUser(req, res);
    if (!user) return;

    const friends = await getFriendsForUser(user._id);
    return res.json(friends);
  } catch (error) {
    console.error("Friend list error:", error);
    return res.status(500).json({ error: "Failed to load friends" });
  }
});

router.get("/stats", async (req, res) => {
  try {
    const user = requireAuthUser(req, res);
    if (!user) return;

    const stats = await getInvitationStats(user._id);
    return res.json(stats);
  } catch (error) {
    console.error("Friend stats error:", error);
    return res.status(500).json({ error: "Failed to load invitation stats" });
  }
});

router.post("/add", async (req, res) => {
  try {
    const user = requireAuthUser(req, res);
    if (!user) return;

    const { friendUsername, friendId } = req.body || {};
    if (!friendUsername && !friendId) {
      return res.status(400).json({ error: "Friend username or id required" });
    }

    const identifier = friendId || friendUsername;
    await addOrganicFriend(user._id, identifier);
    return res.json({ success: true });
  } catch (error) {
    console.error("Add friend error:", error);
    return res.status(400).json({ error: error.message || "Unable to add friend" });
  }
});

export default router;
