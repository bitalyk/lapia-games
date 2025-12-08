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
- When running inside Telegram, compare `initData`'s user id with the cached session; clear stored tokens if they refer to a different account so the WebApp always opens the profile that launched it.

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

## Friend Invitation & Referral System
- **Goal:** Allow verified players to invite friends through Telegram deep links while preventing spam, self-referrals, and bot farms.
- **Scope:** Database schemas (invitations, friendships, friend activity, fraud alerts), auth registration flow, `/api/friends/*` routes, anti-abuse services, achievements, frontend invite UI, and analytics dashboards.

### Link Generation & Registration
1. `/api/friends/invite` mints a 16-byte hex code, stores it in `invitations` with `inviterUserId`, `status=pending`, and seven-day TTL, then returns `https://t.me/${TELEGRAM_BOT_USERNAME}?startapp=${inviteCode}&start=${inviteCode}` so Telegram opens the WebApp immediately with a chat fallback.
2. Telegram WebApp exposes the code through `tgWebAppStartParam`/`start_param`; we forward it to `/api/auth/telegram` (or registration helper) as `inviteCode`.
3. Registration records `registrationType` (`organic` or `invited`) and defers `invitedBy` assignment until `processInvitation` succeeds.

### Validation & Fraud Controls
- Reject expired or missing invitation rows and mark them `expired` when TTL lapses.
- Block self-invites, duplicate friendships, and inviters over the 100 friend cap.
- Require inviter to be `active` and new user to pass `isLegitimateUser`, which checks Telegram account age (if available), repeated IP registrations, low playtime, and missing gameplay interaction.
- `FraudDetection.detectInvitationFraud` watches for rapid-fire invites, repeated invitees, and batches of freshly created accounts; alerts feed a review queue for the last 24h.
- Rate-limit invite link creation and organic friend additions per user.

### Data Structures
- `Invitation`: `inviteCode`, `inviterUserId`, `invitedUserId`, `status`, `expiresAt`, timestamps, metadata, plus audit trail.
- `Friendship`: directional row with `userId`, `friendId`, `status`, `invitedAt`, `inviteCodeUsed`, `mutual`, `lastInteraction` (unique composite on `userId+friendId`).
- `FriendActivity`: records shared gameplay events for feed rendering.
- `FraudAlert` / `SuspiciousInvitation`: stores detected patterns and reviewer outcomes.
- `User` gains `invitedBy`, `registrationType`, `invitationStats`, and aggregates for achievements.

### Backend Endpoints
- `POST /api/friends/invite` – issue invite link.
- `GET /api/friends` – list active friendships with online status, mutual games, and last interaction (requires `Friendship` + `User` join).
- `POST /api/friends/add` – organic friend connection with 30-minute minimum playtime per user.
- `GET /api/friends/stats` – invitation totals, conversion rate, fraud alerts, and LPA rewards earned.
- Registration/auth flows now accept optional `inviteCode` and call `processInvitation` once the Telegram user is persisted.

### Achievement & Economy Hooks
- `checkInvitationAchievements` recomputes accepted invites, toggles `friend_inviter` progress, and awards 1 LPA at five successful referrals.
- `Friendship.countActiveFriends` supports achievement + analytics queries.
- `InvitationAnalytics` exposes total invites, conversions, pending counts, active friends, LPA earned, conversion rate, and recent fraud alerts.

### Frontend Responsibilities
- Auth flow forwards `inviteCode` query param (from Telegram start payload) during Telegram login.
- New `FriendInvitationUI` handles link generation (copy/share), friend list rendering, invite status chips, and share helpers (Telegram share URL + copy button).
- Add screens for invitation stats, fraud warnings, and friend activity feed; integrate toasts for success/error states.

### Phase Checklist (additional)
1. **DB & Models:** Create `Invitation`, `Friendship`, `FriendActivity`, fraud alert storage, and extend `User` with invite metadata.
2. **Backend APIs:** Wire `/api/friends/*`, update registration to honor invite codes, and expose analytics helpers.
3. **Validation Layer:** Implement `processInvitation`, legitimacy checks, fraud detection heuristics, and global rate limiting.
4. **Achievements:** Update `AchievementManager` to pull invite stats, mint rewards, and surface conversion progress.
5. **Frontend:** Build invite generator UI, friend list, share buttons, and invite status panels for Telegram WebApp.
6. **Monitoring:** Surface analytics dashboards plus fraud alerts for ops review.
