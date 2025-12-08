import dotenv from 'dotenv';

dotenv.config();

const parseBoolean = (value, defaultValue = false) => {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes'].includes(normalized)) {
      return true;
    }
    if (['false', '0', 'no'].includes(normalized)) {
      return false;
    }
  }
  return defaultValue;
};

const parseNumber = (value, defaultValue) => {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return defaultValue;
};

const resolvedAuthMode = (process.env.AUTH_MODE || 'manual').trim().toLowerCase() === 'telegram'
  ? 'telegram'
  : 'manual';

const sessionTimeout = parseNumber(process.env.SESSION_TIMEOUT, 86400);

const authConfig = {
  mode: resolvedAuthMode,
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    botUsername: process.env.TELEGRAM_BOT_USERNAME || ''
  },
  session: {
    timeoutSeconds: sessionTimeout,
    tokenRefreshEnabled: parseBoolean(process.env.TOKEN_REFRESH_ENABLED, true),
    allowMultipleSessions: parseBoolean(process.env.ALLOW_MULTIPLE_SESSIONS, false)
  }
};

export const isTelegramMode = authConfig.mode === 'telegram';
export const isManualMode = !isTelegramMode;

export const getPublicAuthConfig = () => ({
  mode: authConfig.mode,
  sessionTimeout: authConfig.session.timeoutSeconds,
  tokenRefreshEnabled: authConfig.session.tokenRefreshEnabled,
  allowMultipleSessions: authConfig.session.allowMultipleSessions
});

export default authConfig;
