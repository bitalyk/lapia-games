import { extractBearerToken, verifySessionToken } from "../services/session-manager.js";
import { isManualMode } from "../config/auth-config.js";
import User from "../models/user.js";
import { logInvalidToken, logSecurityEvent } from "../services/security-logger.js";

const normalizeUsername = (value) => (value || "").trim().toLowerCase();

const getClientIp = (req) => {
  const forwarded = req.headers["x-forwarded-for"];
  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return forwarded[0];
  }
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0].trim();
  }
  return req.ip;
};

function enforceParamsUsername(req, actualUsername) {
  if (!req.params || typeof req.params.username !== "string") {
    return true;
  }
  if (normalizeUsername(req.params.username) === normalizeUsername(actualUsername)) {
    req.params.username = actualUsername;
    return true;
  }
  return false;
}

function injectUsernames(req, username) {
  if (req.body && typeof req.body === "object") {
    req.body.username = username;
  }
  if (req.query && typeof req.query === "object") {
    req.query.username = username;
  }
}

export default async function requireAuth(req, res, next) {
  if (isManualMode) {
    return next();
  }

  try {
    const rawToken = extractBearerToken(req.headers.authorization || req.get("authorization"));
    if (!rawToken) {
      await logInvalidToken("missing", {
        ipAddress: getClientIp(req),
        userAgent: req.get("user-agent") || null,
        metadata: { path: req.originalUrl }
      });
      return res.status(401).json({ error: "Authorization token required" });
    }

    const verification = await verifySessionToken(rawToken);
    if (!verification.valid) {
      await logInvalidToken(verification.reason, {
        ipAddress: getClientIp(req),
        userAgent: req.get("user-agent") || null,
        metadata: { path: req.originalUrl }
      });
      return res.status(401).json({ error: "Invalid session token", reason: verification.reason });
    }

    const session = verification.session;
    const user = await User.findById(session.userId);
    if (!user) {
      await logInvalidToken("user_not_found", {
        ipAddress: getClientIp(req),
        userAgent: req.get("user-agent") || null,
        metadata: { sessionTokenId: session.tokenId }
      });
      return res.status(401).json({ error: "User not found for session" });
    }

    if (!enforceParamsUsername(req, user.username)) {
      await logSecurityEvent("username_mismatch", {
        severity: "warn",
        username: user.username,
        sessionTokenId: session.tokenId,
        ipAddress: getClientIp(req),
        userAgent: req.get("user-agent") || null,
        metadata: { path: req.originalUrl, providedUsername: req.params?.username }
      });
      return res.status(403).json({ error: "Username mismatch with authenticated session" });
    }

    injectUsernames(req, user.username);

    req.authUser = user;
    req.authSession = session;
    req.authToken = rawToken;
    res.locals.authUser = user;

    return next();
  } catch (error) {
    console.error("Auth middleware error:", error);
    return res.status(500).json({ error: "Authentication middleware failure" });
  }
}
