import crypto from "crypto";
import authConfig from "../config/auth-config.js";

const TELEGRAM_CHECK_STRING_KEY = "WebAppData";
const INIT_DATA_MAX_AGE_SECONDS = 300; // 5 minutes

function getTelegramSecretKey() {
  return crypto
    .createHmac("sha256", TELEGRAM_CHECK_STRING_KEY)
    .update(authConfig.telegram.botToken)
    .digest();
}

function buildDataCheckString(params) {
  return params
    .filter(([key]) => key !== "hash")
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join("\n");
}

function parseInitData(initDataRaw) {
  try {
    return [...new URLSearchParams(initDataRaw || "")];
  } catch (error) {
    return null;
  }
}

function parseUserPayload(rawUser) {
  try {
    return rawUser ? JSON.parse(rawUser) : null;
  } catch (error) {
    return null;
  }
}

export function mapTelegramUserToProfile(userPayload) {
  if (!userPayload) return null;
  return {
    id: String(userPayload.id),
    username: userPayload.username || null,
    firstName: userPayload.first_name || null,
    lastName: userPayload.last_name || null,
    photoUrl: userPayload.photo_url || null,
    languageCode: userPayload.language_code || null,
    addedToAttachmentMenu: Boolean(userPayload.added_to_attachment_menu),
    allowsWriteToPm: Boolean(userPayload.allows_write_to_pm)
  };
}

export function validateTelegramInitData(initDataRaw) {
  if (authConfig.mode !== "telegram") {
    return { ok: false, reason: "mode_disabled" };
  }

  if (!authConfig.telegram.botToken) {
    return { ok: false, reason: "bot_token_missing" };
  }

  const entries = parseInitData(initDataRaw);
  if (!entries || entries.length === 0) {
    return { ok: false, reason: "invalid_init_data" };
  }

  const params = new Map(entries);
  const receivedHash = params.get("hash");
  if (!receivedHash) {
    return { ok: false, reason: "hash_missing" };
  }

  const dataCheckString = buildDataCheckString(entries);
  const secretKey = getTelegramSecretKey();
  const computedHash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  if (computedHash !== receivedHash) {
    return { ok: false, reason: "hash_mismatch" };
  }

  const authDate = Number(params.get("auth_date"));
  if (!Number.isFinite(authDate)) {
    return { ok: false, reason: "auth_date_missing" };
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - authDate) > INIT_DATA_MAX_AGE_SECONDS) {
    return { ok: false, reason: "init_data_stale" };
  }

  const userPayload = parseUserPayload(params.get("user"));
  if (!userPayload) {
    return { ok: false, reason: "user_payload_invalid" };
  }

  return {
    ok: true,
    userPayload,
    authDate: new Date(authDate * 1000),
    initData: initDataRaw,
    dataMap: params
  };
}
