# AI Coding Agent Instructions for `lapia-games`

Welcome to the `lapia-games` repository! This document provides essential guidance for AI coding agents to be productive in this codebase. Follow these instructions to understand the architecture, workflows, and conventions.

## Big Picture Overview
- **Backend**: `backend/server.js` boots an Express API, serves the static frontend, and schedules autosave jobs every 30 seconds. Routes live under `backend/routes/*.js` (auth, achievements, platform, plus one file per game). Services in `backend/services/` (e.g., `achievement-manager.js`, `promo-code-manager.js`) encapsulate shared logic.
- **Database**: MongoDB via `backend/db.js`. `User` schema (`backend/models/user.js`) stores everything: per-game progress, trucks, inventories, promo history, streaks, and achievements.
- **Frontend**: Static SPA in `frontend/`. `index.html` loads `AuthManager`, `GameManager`, promo widget, toast manager, and the shop overlay. Each game ships its own HTML/CSS/JS bundle in `frontend/games/<game-id>/`.
- **Game Logic Split**: Each mechanic (birds, trees, mines, etc.) has mirrored config on the backend route and in the corresponding frontend module. Update both copies (e.g., `BIRDS`, `TREE_TYPES`, truck travel constants) to keep offline calculations in sync.
- **Leaderboards & Lifetime Earnings**: `services/earnings-tracker.js` records every coin/LPA transaction, while `services/leaderboard-service.js` exposes `/api/leaderboards/*` endpoints and maintains cached top-10 boards plus `/user/:username` summaries for the dashboard.
- **Friend Center**: Invites are handled via `backend/routes/friends.js` + `services/friend-invitation-manager.js` and the frontend module `frontend/js/friends/friend-center.js`. All friend/invite state lives under `user.friendInvites`; mark it modified when mutating nested arrays.

## Key Conventions & Patterns
- **Duplicated Config**: Keep `BIRDS`, `TREE_TYPES`, truck timings, and similar constants aligned between backend routes and the mirrored frontend files. Never change one side without the other.
- **Promo Widget**: All promo UIs use `PromoRedeemWidget` (`frontend/js/promo-manager.js`). It expects `/api/promo/redeem` + `/api/promo/history/:username` to exist and only renders the most recent 10 successful codes.
- **Auth & Identification**: Every gameplay endpoint accepts `{ username }`. `AuthManager` caches the session locally; backend routes always revalidate state.
- **Achievements**: Call `AchievementManager.recordActivity(user)` whenever a login occurs (already wired in `auth.js`). Client pulls `/api/achievements/status/:username` for the modal and exchange tabs.
- **Toast Notifications**: Use `window.toastManager.show(message, type)` or `window.showToast` fallback. Avoid bespoke notification code per game.
- **Truck System**: Happy Birds and Rich Garden enforce a truck-at-farm requirement for loading and a one-hour travel per leg. Timers continue server-side; frontend merely visualizes them.
- **Batch Egg Loading**: Happy Birds' `POST /api/game/transport/load-eggs` now expects a `loads` array (one entry per color). Always aggregate multiple colors into one call and surface `loadResults` in the UI—do not fire sequential per-color requests anymore.
- **App Reveal**: `body` starts with `app-loading`. Do not remove the class until AuthManager completes session checks.
- **Telegram Mode**: When `AUTH_MODE=telegram`, the frontend must run inside Telegram WebApp. `frontend/index.html` now loads `https://telegram.org/js/telegram-web-app.js`, AuthManager toggles the dedicated overlay, and all API calls derive their base URL from `window.location.origin` (so ngrok/tunnels just work). Always drive the overlay state via `setTelegramOverlayState()` when touching the auth flow.
- **Lifetime Tracking & Leaderboards**: Any code that mints coins or LPA must call `EarningsTracker.recordTransaction(user, payload)`. That helper now invalidates cached leaderboards, so new earnings appear without restarting the server. On the client, `frontend/js/leaderboard-dashboard.js` listens for `platformLogin`/`platformLogout` events—keep those dispatches intact when adjusting AuthManager.
- **Invites & Social Achievements**: Use `FriendInvitationManager` to create/share codes. After a successful referral, call `AchievementManager.recordFriendInvite(user, invitedUsername)` so the `friendInviter` badge and invite counters stay in sync.

## Developer Workflow
1. `npm install`
2. `npm start` (runs `node backend/server.js`)
3. Ensure MongoDB is available at `MONGO_URI` (defaults to local).

While running, watch the console for:
- `✅ Connected to MongoDB`
- `✅ Server running on http://localhost:3000`
- Autosave logs every 30 seconds

## Core Endpoints
- **Auth** (`backend/routes/auth.js`): `POST /api/auth/register`, `POST /api/auth/login`.
- **Achievements** (`backend/routes/achievements.js`): `GET /api/achievements/status/:username`, `POST /api/achievements/record-activity`, `POST /api/achievements/convert`, `POST /api/achievements/record-invite`.
- **Coin Progress** (`backend/routes/achievements.js`): `GET /api/achievements/coin-progress/:username` powers the achievements modal and shows next milestones based on lifetime totals.
- **Promo Codes** (`backend/routes/promo-codes.js`): `POST /api/promo/redeem`, `GET /api/promo/history/:username` (returns latest 10 successes).
- **Friends** (`backend/routes/friends.js`): invite management, referral history, and reward triggers (shared with the frontend Friend Center).
- **Game Routers**: `happy-birds.js`, `rich-garden.js`, `golden-mine.js`, `cat-chess.js`, `fishes.js` each expose status + action endpoints specific to their gameplay loop.
- **Platform** (`backend/routes/platform.js`): shared stats + profile helpers.
- **Leaderboards** (`backend/routes/leaderboards.js`): `GET /api/leaderboards/total-coins`, `/game/:slug`, `/lpa`, and `/user/:username` for the dashboard sidebar. These endpoints include cached top-10 rows plus the caller’s current rank.

## Project Notes
- Express app runs as an ES module. Stick to `import` / `export` syntax.
- `User` schema is large—when mutating nested docs (e.g., `richGardenProgress`, `inventory`, `activityStreak`), always `markModified` if needed.
- `AuthManager` controls most global UI state (login page, achievements modal, promo widget, exchange). Sync any new UI component with its event system.
- Background autosave + `progressSanityCheck` prevent corrupted state; never bypass the helpers when editing backend routes.
- When editing CSS/HTML, keep the new login-only layout (single centered card) in mind.

## Integration Checklist
- MongoDB reachable at `MONGO_URI`.
- Frontend API base is `window.location.origin + /api`; expose the app through HTTPS (e.g., ngrok) when testing Telegram WebApp mode so Telegram can talk to the backend.
- `/api/config` exposes feature flags (fast mode, redeem toggle, etc.).
- Autosave job in `server.js` runs every 30s—watch logs to ensure it stays alive.
- Set `AUTH_MODE=telegram` (plus `TELEGRAM_BOT_TOKEN`/`TELEGRAM_BOT_USERNAME`) before deploying the Telegram-only UX. Leave it on `manual` for username/password testing.
- Leaderboard cache resets automatically after each `EarningsTracker` transaction, but you should still smoke-test `/api/leaderboards/*` and the dashboard section after touching any coin/LPA flow.

- Keep per-game config mirrored front/back (birds, trees, mines).
- Promo history in UI only shows successes—don’t rely on it for debugging failed attempts; check Mongo.
- Trucks can only be loaded at the farm. Buttons should reflect the truck’s current location/states to avoid confusing players.
- Achievements modal expects `achievementHistory`, `activityStreak`, `currencyByGame`, and `conversionCapacity` in status payloads. Missing fields will crash UI panels.
- Always call `syncAllCurrency` or `AchievementManager.getStatus` after mutating currency to keep derived totals accurate.

By following these instructions, AI agents can contribute effectively to the `lapia-games` project. If any section is unclear or incomplete, please request clarification or additional details.