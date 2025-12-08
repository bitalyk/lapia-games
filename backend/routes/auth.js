// backend/routes/auth.js
import express from "express";
import bcrypt from "bcrypt";
import User from "../models/user.js";
import AchievementManager from "../services/achievement-manager.js";
import authConfig, { isManualMode, isTelegramMode } from "../config/auth-config.js";
import {
  issueSessionToken,
  extractBearerToken,
  verifySessionToken,
  isSessionEligibleForRefresh,
  rotateSessionToken
} from "../services/session-manager.js";
import { validateTelegramInitData, mapTelegramUserToProfile } from "../services/telegram-auth.js";
import {
  logManualAuthAttempt,
  logSecurityEvent,
  logTokenIssued,
  logTokenRefreshed,
  logInvalidToken
} from "../services/security-logger.js";
import { processInvitation } from "../services/friend-invitation-manager.js";
import RegistrationLog from "../models/registration-log.js";

const router = express.Router();

// Helper function to get user
async function getUser(username) {
  return await User.findByUsername(username);
}

function serializeGamesProgress(gamesProgress) {
  if (!gamesProgress) return {};
  if (gamesProgress instanceof Map) {
    return Object.fromEntries(gamesProgress);
  }
  return gamesProgress;
}

function buildUserPayload(user, achievementStatus, options = {}) {
  const payload = {
    username: user.username,
    platformStats: user.platformStats,
    platformCurrencies: user.platformCurrencies,
    gamesProgress: serializeGamesProgress(user.gamesProgress),
    lpaBalance: user.lpaBalance,
    achievementProgress: achievementStatus?.achievementProgress || user.achievementProgress,
    currencyByGame: achievementStatus?.currencyByGame || user.currencyByGame
  };

  if (options.includeInventory) {
    payload.inventory = user.inventory;
  }

  if (options.includeActivity && achievementStatus) {
    payload.activityStreak = achievementStatus.activityStreak;
    payload.achievementsUnlocked = achievementStatus.unlockedCount;
    payload.achievementsTotal = achievementStatus.totalAchievements;
  }

  return payload;
}

function extractClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return forwarded[0];
  }
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0].trim();
  }
  return req.ip;
}

async function generateUniqueUsername(preferredBase, fallbackSeed) {
  const baseSeed = (preferredBase || "")
    .toLowerCase()
    .replace(/[^a-z0-9_]/gi, "")
    .slice(0, 15);

  const fallbackBase = `tg${fallbackSeed || Math.floor(Date.now() / 1000)}`.slice(0, 15);
  const usableBase = (baseSeed.length >= 3 ? baseSeed : fallbackBase) || "player";

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const suffix = attempt === 0 ? "" : String(attempt + 1);
    const candidate = `${usableBase}${suffix}`.slice(0, 20);
    const existing = await User.findByUsername(candidate);
    if (!existing) {
      return candidate;
    }
  }

  throw new Error("Unable to allocate unique username for Telegram user");
}

async function findOrCreateTelegramUser(profile) {
  let user = await User.findByTelegramId(profile.id);
  if (user) {
    const existingProfile = user.telegramProfile
      ? (typeof user.telegramProfile.toObject === "function"
        ? user.telegramProfile.toObject()
        : user.telegramProfile)
      : {};
    user.telegramProfile = { ...existingProfile, ...profile };
    if (!user.telegramLinkedAt) {
      user.telegramLinkedAt = new Date();
    }
    return user;
  }

  const username = await generateUniqueUsername(profile.username, profile.id);
  user = new User({
    username,
    telegramProfile: profile,
    telegramLinkedAt: new Date(),
    passwordHash: null
  });
  return user;
}

// POST /api/auth/register
router.post("/register", async (req, res) => {
  try {
    const { username, password, email } = req.body || {};
    const clientIp = extractClientIp(req);
    const userAgent = req.get("user-agent") || null;

    if (!isManualMode) {
      await logManualAuthAttempt({
        username,
        ipAddress: clientIp,
        userAgent,
        metadata: { endpoint: "register" }
      });
      return res.status(403).json({ error: "Manual registration is disabled in Telegram auth mode." });
    }

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
      registrationType: "manual",
      registrationIp: clientIp,
      invitationMetadata: { source: "manual" },
      // Initialize Cat Chess with starting coins
      catChessProgress: {
        coins: 1000,
        specialCurrency: 0,
        board: Array(64).fill(null),
        unlockedLevels: [1],
        specialInventory: [],
        lastPlayed: new Date(),
        playTime: 0
      }
      // Platform data initialized by default in schema
    });

    await user.save();

    await RegistrationLog.create({
      userId: user._id,
      telegramId: null,
      inviteCode: null,
      ipAddress: clientIp,
      userAgent
    });

    const achievementStatus = AchievementManager.getStatus(user);
    if (user.isModified()) {
      await user.save();
    }

    return res.json({
      success: true,
      user: {
        ...buildUserPayload(user, achievementStatus, { includeInventory: false, includeActivity: false }),
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
    if (!isManualMode) {
      await logManualAuthAttempt({
        username,
        ipAddress: extractClientIp(req),
        userAgent: req.get("user-agent") || null,
        metadata: { endpoint: "login" }
      });
      return res.status(403).json({ error: "Manual login is disabled in Telegram auth mode." });
    }

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

    // Update last login and record activity streak
    user.platformStats.lastLogin = new Date();
    user.lastActive = new Date();

    AchievementManager.recordActivity(user, new Date());
    const achievementStatus = AchievementManager.getStatus(user);
    await user.save();

    return res.json({
      success: true,
      user: buildUserPayload(user, achievementStatus, { includeInventory: true, includeActivity: true })
    });
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({ error: "Server error during login" });
  }
});

// POST /api/auth/telegram
router.post("/telegram", async (req, res) => {
  try {
    if (!isTelegramMode) {
      return res.status(403).json({ error: "Telegram login is disabled in manual auth mode." });
    }

    const { initData, inviteCode: inviteCodeParam } = req.body || {};
    if (!initData || typeof initData !== "string") {
      return res.status(400).json({ error: "initData is required" });
    }

    const clientIp = extractClientIp(req);
    const userAgent = req.get("user-agent") || null;

    const validation = validateTelegramInitData(initData);
    if (!validation.ok) {
      await logSecurityEvent("telegram_payload_invalid", {
        severity: "warn",
        ipAddress: clientIp,
        userAgent,
        metadata: { reason: validation.reason }
      });
      return res.status(401).json({
        error: "Invalid Telegram payload",
        reason: validation.reason
      });
    }

    const profile = mapTelegramUserToProfile(validation.userPayload);
    if (!profile || !profile.id) {
      return res.status(400).json({ error: "Telegram user information is missing" });
    }

    let inviteCode = inviteCodeParam || null;
    if (!inviteCode && validation.dataMap instanceof Map) {
      inviteCode =
        validation.dataMap.get("tgWebAppStartParam") ||
        validation.dataMap.get("start_param") ||
        validation.dataMap.get("startapp") ||
        null;
    }

    let user = await findOrCreateTelegramUser(profile);
    user.telegramProfile = profile;
    if (!user.telegramLinkedAt) {
      user.telegramLinkedAt = new Date();
    }
    const isNewUser = user.isNew;
    if (isNewUser) {
      user.registrationType = inviteCode ? "invited" : "organic";
      user.registrationIp = clientIp;
      if (inviteCode) {
        user.invitationMetadata = { inviteCodeAttempted: inviteCode };
      }
    }

    const now = new Date();
    user.platformStats.lastLogin = now;
    user.lastActive = now;

    AchievementManager.recordActivity(user, now);
    const achievementStatus = AchievementManager.getStatus(user);
    await user.save();

    if (inviteCode && isNewUser) {
      try {
        await processInvitation(inviteCode, user._id);
      } catch (error) {
        console.error("Invitation validation error:", error);
        await User.findByIdAndDelete(user._id);
        return res.status(400).json({ error: error.message || "Invitation validation failed" });
      }
    }

    if (isNewUser) {
      await RegistrationLog.create({
        userId: user._id,
        telegramId: profile.id,
        inviteCode: inviteCode || null,
        ipAddress: clientIp,
        userAgent
      });
    }

    const sessionResult = await issueSessionToken(user, {
      ipAddress: clientIp,
      userAgent,
      metadata: {
        telegramId: profile.id,
        telegramUsername: profile.username || null,
        authMode: authConfig.mode
      }
    });

    await logTokenIssued({
      username: user.username,
      telegramId: profile.id,
      sessionTokenId: sessionResult.session.tokenId,
      ipAddress: clientIp,
      userAgent
    });

    return res.json({
      success: true,
      token: sessionResult.rawToken,
      expiresAt: sessionResult.expiresAt.toISOString(),
      user: buildUserPayload(user, achievementStatus, { includeInventory: true, includeActivity: true })
    });
  } catch (err) {
    console.error("Telegram login error:", err);
    return res.status(500).json({ error: "Server error during Telegram login" });
  }
});

// POST /api/auth/refresh
router.post("/refresh", async (req, res) => {
  try {
    if (!authConfig.session.tokenRefreshEnabled) {
      await logSecurityEvent("refresh_attempt_disabled", {
        severity: "warn",
        ipAddress: extractClientIp(req),
        userAgent: req.get("user-agent") || null
      });
      return res.status(403).json({ error: "Token refresh is disabled" });
    }

    if (!isTelegramMode) {
      await logSecurityEvent("refresh_attempt_manual_mode", {
        severity: "warn",
        ipAddress: extractClientIp(req),
        userAgent: req.get("user-agent") || null
      });
      return res.status(400).json({ error: "Token refresh is only available in Telegram auth mode" });
    }

    const rawToken = extractBearerToken(req.headers.authorization || req.get("authorization"));
    if (!rawToken) {
      await logInvalidToken("missing", {
        ipAddress: extractClientIp(req),
        userAgent: req.get("user-agent") || null
      });
      return res.status(401).json({ error: "Authorization token required" });
    }

    const verification = await verifySessionToken(rawToken);
    if (!verification.valid) {
      await logInvalidToken(verification.reason, {
        ipAddress: extractClientIp(req),
        userAgent: req.get("user-agent") || null
      });
      return res.status(401).json({ error: "Invalid session token", reason: verification.reason });
    }

    const session = verification.session;
    if (!isSessionEligibleForRefresh(session)) {
      await logSecurityEvent("refresh_not_ready", {
        severity: "info",
        sessionTokenId: session.tokenId,
        ipAddress: extractClientIp(req),
        userAgent: req.get("user-agent") || null,
        metadata: { expiresAt: session.expiresAt }
      });
      return res.status(400).json({
        error: "Token not yet eligible for refresh",
        expiresAt: session.expiresAt
      });
    }

    const user = await User.findById(session.userId);
    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }

    const rotation = await rotateSessionToken(session, user, {
      ipAddress: extractClientIp(req),
      userAgent: req.get("user-agent") || null,
      metadata: { reason: "refresh" }
    });

    await logTokenRefreshed({
      username: user.username,
      telegramId: user.telegramProfile?.id || null,
      sessionTokenId: rotation.session.tokenId,
      ipAddress: extractClientIp(req),
      userAgent: req.get("user-agent") || null
    });

    return res.json({
      success: true,
      token: rotation.rawToken,
      expiresAt: rotation.expiresAt.toISOString()
    });
  } catch (error) {
    console.error("Token refresh error:", error);
    return res.status(500).json({ error: "Server error during token refresh" });
  }
});

export default router;