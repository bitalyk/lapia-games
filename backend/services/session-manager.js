import crypto from "crypto";
import authConfig from "../config/auth-config.js";
import UserSession from "../models/user-session.js";

const TOKEN_SEPARATOR = ".";
const DEFAULT_REFRESH_WINDOW_SECONDS = 300; // 5 minutes

function generateTokenParts() {
  const tokenId = typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : crypto.randomBytes(16).toString("hex");
  return {
    tokenId,
    secret: crypto.randomBytes(32).toString("hex")
  };
}

function serializeToken(parts) {
  return `${parts.tokenId}${TOKEN_SEPARATOR}${parts.secret}`;
}

function hashRawToken(rawToken) {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

function parseRawToken(rawToken) {
  if (typeof rawToken !== "string") return null;
  const [tokenId, secret] = rawToken.split(TOKEN_SEPARATOR);
  if (!tokenId || !secret) return null;
  return { tokenId, secret };
}

export async function issueSessionToken(user, context = {}) {
  if (!user) throw new Error("User is required to issue a session token");

  const tokenParts = generateTokenParts();
  const rawToken = serializeToken(tokenParts);
  const tokenHash = hashRawToken(rawToken);
  const expiresAt = new Date(Date.now() + (authConfig.session.timeoutSeconds * 1000));

  const sessionDoc = await UserSession.create({
    userId: user._id,
    tokenId: tokenParts.tokenId,
    tokenHash,
    expiresAt,
    ipAddress: context.ipAddress || null,
    userAgent: context.userAgent || null,
    metadata: context.metadata || {}
  });

  if (!authConfig.session.allowMultipleSessions) {
    await UserSession.deactivateOtherSessions(user._id, tokenParts.tokenId);
  }

  return { rawToken, expiresAt, session: sessionDoc };
}

function getRefreshWindowSeconds() {
  const ttl = authConfig.session.timeoutSeconds || DEFAULT_REFRESH_WINDOW_SECONDS;
  if (ttl <= DEFAULT_REFRESH_WINDOW_SECONDS) {
    return Math.max(60, Math.floor(ttl / 2));
  }
  return DEFAULT_REFRESH_WINDOW_SECONDS;
}

export function getRefreshWindowMs() {
  return getRefreshWindowSeconds() * 1000;
}

export function isSessionEligibleForRefresh(session) {
  if (!session || !session.expiresAt) {
    return false;
  }
  const remainingMs = new Date(session.expiresAt).getTime() - Date.now();
  if (remainingMs <= 0) {
    return false;
  }
  return remainingMs <= getRefreshWindowMs();
}

export async function rotateSessionToken(session, user, context = {}) {
  if (!session || !user) {
    throw new Error("Session and user are required to rotate tokens");
  }

  const rotationContext = {
    ...context,
    metadata: {
      ...(context.metadata || {}),
      rotatedFrom: session.tokenId
    }
  };

  const newSession = await issueSessionToken(user, rotationContext);

  try {
    session.isActive = false;
    session.metadata = {
      ...(session.metadata || {}),
      rotatedAt: new Date(),
      rotatedTo: newSession.session.tokenId
    };
    await session.save();
  } catch (error) {
    console.warn("Unable to persist session rotation metadata", error);
  }

  return newSession;
}

export async function verifySessionToken(rawToken) {
  const parsed = parseRawToken(rawToken);
  if (!parsed) {
    return { valid: false, reason: "malformed" };
  }

  const session = await UserSession.findOne({
    tokenId: parsed.tokenId,
    isActive: true
  });

  if (!session) {
    return { valid: false, reason: "unknown" };
  }

  if (session.expiresAt <= new Date()) {
    session.isActive = false;
    await session.save();
    return { valid: false, reason: "expired" };
  }

  const expectedHash = hashRawToken(rawToken);
  if (session.tokenHash !== expectedHash) {
    session.isActive = false;
    await session.save();
    return { valid: false, reason: "hash_mismatch" };
  }

  session.lastUsedAt = new Date();
  await session.save();

  return { valid: true, session };
}

export async function revokeToken(rawToken) {
  const parsed = parseRawToken(rawToken);
  if (!parsed) return null;
  return UserSession.invalidateToken(parsed.tokenId);
}

export function extractBearerToken(authorizationHeader) {
  if (!authorizationHeader) return null;
  const [scheme, value] = authorizationHeader.split(" ");
  if (!scheme || !value) return null;
  if (scheme.toLowerCase() !== "bearer") return null;
  return value.trim();
}

export function getSessionTTLSeconds() {
  return authConfig.session.timeoutSeconds;
}
