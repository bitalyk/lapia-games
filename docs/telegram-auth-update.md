# Telegram Login & Security Update

## Overview
- **Goal:** Introduce a dual authentication system that keeps manual logins for developers while enabling secure Telegram OAuth in production.
- **Scope:** Backend auth flow, bearer token management, frontend session handling, configuration, security logging, and migration plan.
- **Guarantee:** Manual username/password login remains available for testing and is never removed.

## Configuration Matrix
| Variable | Description | Default |
| --- | --- | --- |
| `AUTH_MODE` | `manual` for legacy login, `telegram` for OAuth | `manual` |
| `TELEGRAM_BOT_TOKEN` | Bot API token, required in Telegram mode | – |
| `TELEGRAM_BOT_USERNAME` | Bot username for verifying initData payloads | – |
| `SESSION_TIMEOUT` | Token lifetime in seconds | `86400` |
| `TOKEN_REFRESH_ENABLED` | Enables `/api/auth/refresh` | `true` |
| `ALLOW_MULTIPLE_SESSIONS` | Allow >1 active token | `false` |

## Authentication Modes
- **Manual Mode:** Hardcoded `admin/admin`, skips token checks, reserved for dev/test.
- **Telegram Mode:** Validates `initData`, issues bearer tokens, enforces middleware on every `/api` route.

## Telegram Flow Snapshot
1. Frontend invokes Telegram WebApp SDK and posts `initData` to `/api/auth/telegram`.
2. Backend validates signature (sorted params + HMAC using `WebAppData` + bot token).
3. User record retrieved/created by `telegram_id`.
4. Session token generated, stored hashed, and returned to client.

## Bearer Token Rules
- `user_sessions` collection/table stores `tokenId`, `tokenHash`, `expiresAt`, `lastUsed`, IP, UA, and `isActive` flag.
- New login invalidates old sessions when `ALLOW_MULTIPLE_SESSIONS=false`.
- Middleware inspects `Authorization: Bearer <token>` header unless `AUTH_MODE=manual`.
- Refresh endpoint rotates tokens 5 minutes before expiry when enabled.

## API Protection Targets
`/api/auth/*`, `/api/games/*`, `/api/shop`, `/api/achievements`, and any new routes must pass through the token middleware in Telegram mode.

## Frontend Responsibilities
- Store token in `localStorage` and decorate `fetch` requests with `Authorization` header.
- Auto-refresh tokens based on `SESSION_TIMEOUT`.
- Render either manual login form or Telegram login button depending on `AUTH_MODE` exposed via `/api/config` (or build-time env).

## Monitoring & Logging
Track: invalid tokens, rapid token generation, refresh failures, manual mode usage in production, and suspicious IP churn. Persist security events for audit purposes.

## Migration Phases
1. ENV plumbing (`AUTH_MODE`, Telegram bot settings, session knobs).
2. Manual mode fallback verification.
3. Telegram OAuth endpoint & validation helpers.
4. Bearer token model + storage.
5. Middleware coverage for API routes.
6. Frontend token lifecycle management.
7. Session invalidation + refresh endpoint.
8. Security logging + monitoring hooks.

Each phase should release behind feature flags so we can test incrementally without breaking existing manual login flows.

## Progress Tracker
- [x] Phase 1 – `backend/config/auth-config.js` added with env parsing and `/api/config` exposure.
- [x] Phase 2 – Manual `/api/users/register|login` now guarded by `AUTH_MODE` switches.
- [x] Phase 3 – `/api/users/telegram` accepts WebApp `initData`, validates it, and provisions Telegram-first accounts.
- [x] Phase 4 – `UserSession` model and `session-manager` service mint, hash, and verify bearer tokens with TTL + single-session enforcement.
- [x] Phase 5 – `backend/middleware/require-auth.js` protects every `/api/*` route (except login/register endpoints) and rewrites the effective username to match the authenticated account in Telegram mode.
- [x] Phase 6 – Frontend `AuthManager` now pulls `/api/config`, stores bearer tokens, wraps `fetch` with `Authorization` headers, disables manual login when Telegram mode is active, and auto-logs in via `window.Telegram.WebApp` when available.
- [x] Phase 7 – `/api/auth/refresh` issues rotated tokens once they enter the five-minute eligibility window, and the frontend scheduler auto-calls it before expiry.
- [x] Phase 8 – `SecurityEvent` collection + `security-logger` capture invalid tokens, blocked manual attempts, refresh outcomes, and username mismatches for later monitoring.

> Telegram WebApp sessions can be invalidated client-side by dropping the bearer token, so a dedicated `/api/auth/logout` endpoint remains optional.
