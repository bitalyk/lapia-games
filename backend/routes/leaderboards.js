import express from "express";
import LeaderboardService from "../services/leaderboard-service.js";

const router = express.Router();

function getPagination(query = {}) {
  return {
    limit: query.limit,
    offset: query.offset
  };
}

async function handleMetricRequest(metric, req, res) {
  try {
    const pagination = getPagination(req.query);
    const username = req.authUser?.username || req.query.username;
    const result = await LeaderboardService.getLeaderboard(metric, {
      ...pagination,
      username
    });

    return res.json({
      success: true,
      ...result
    });
  } catch (error) {
    if (error.code === "INVALID_METRIC") {
      return res.status(400).json({ error: "invalid_metric" });
    }
    console.error("Leaderboard metric error:", error);
    return res.status(500).json({ error: "server_error" });
  }
}

router.get("/total-coins", async (req, res) => {
  await handleMetricRequest("total-coins", req, res);
});

router.get("/lpa", async (req, res) => {
  await handleMetricRequest("lpa", req, res);
});

router.get("/game/:gameId", async (req, res) => {
  const gameId = (req.params.gameId || "").toLowerCase();
  await handleMetricRequest(gameId, req, res);
});

router.get("/user/:username", async (req, res) => {
  try {
    const dashboard = await LeaderboardService.getUserDashboard(req.params.username);
    if (!dashboard) {
      return res.status(404).json({ error: "user_not_found" });
    }

    return res.json({
      success: true,
      ...dashboard
    });
  } catch (error) {
    console.error("Leaderboard user summary error:", error);
    return res.status(500).json({ error: "server_error" });
  }
});

export default router;
