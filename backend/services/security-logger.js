import SecurityEvent from "../models/security-event.js";

const DEFAULT_EVENT_OPTIONS = {
  severity: "info",
  username: null,
  telegramId: null,
  sessionTokenId: null,
  ipAddress: null,
  userAgent: null,
  metadata: {}
};

export async function logSecurityEvent(eventType, options = {}) {
  if (!eventType) {
    return null;
  }

  const payload = {
    ...DEFAULT_EVENT_OPTIONS,
    ...options,
    metadata: {
      ...(options.metadata || {})
    }
  };

  try {
    return await SecurityEvent.create({
      eventType,
      severity: payload.severity,
      username: payload.username || null,
      telegramId: payload.telegramId || null,
      sessionTokenId: payload.sessionTokenId || null,
      ipAddress: payload.ipAddress || null,
      userAgent: payload.userAgent || null,
      metadata: payload.metadata
    });
  } catch (error) {
    console.warn("Security event log failed:", error.message);
    return null;
  }
}

export async function logInvalidToken(reason, context = {}) {
  return logSecurityEvent("token_invalid", {
    severity: "warn",
    ...context,
    metadata: {
      ...(context.metadata || {}),
      reason
    }
  });
}

export async function logTokenIssued(context = {}) {
  return logSecurityEvent("token_issued", {
    severity: "info",
    ...context
  });
}

export async function logTokenRefreshed(context = {}) {
  return logSecurityEvent("token_refreshed", {
    severity: "info",
    ...context
  });
}

export async function logManualAuthAttempt(context = {}) {
  return logSecurityEvent("manual_auth_blocked", {
    severity: "warn",
    ...context
  });
}
