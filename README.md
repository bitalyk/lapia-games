# Lapia Games Platform

Lapia Games is a browser-based idle/clicker hub that stitches multiple games into a single account, shared economy, and global achievement system. This README captures the current architecture (Dec 2025) so contributors can hit the ground running.

## Table of Contents
1. [Quick Start](#quick-start)
2. [Architecture Overview](#architecture-overview)
3. [Platform Features](#platform-features)
  - [Authentication Flow](#authentication-flow)
  - [Game Menu](#game-menu)
  - [Achievements](#achievements)
  - [Exchange & Promo Center](#exchange--promo-center)
4. [Games](#games)
  - [Happy Birds](#happy-birds)
  - [Rich Garden](#rich-garden)
  - [Golden Mine](#golden-mine)
  - [Cat Chess](#cat-chess)
  - [Fishes](#fishes)
5. [Redeem Codes & Promo History](#redeem-codes--promo-history)
6. [API Highlights](#api-highlights)
7. [Development Workflow](#development-workflow)
8. [Project Layout](#project-layout)

## Quick Start
1. Install dependencies:
  ```bash
  npm install
  ```
2. Ensure MongoDB is running (default URI `mongodb://127.0.0.1:27017/lapia-games`). Override via `MONGO_URI`.
3. Start the backend + static frontend:
  ```bash
  npm start
  # executes node backend/server.js
  ```
4. Open `http://localhost:3000`, register a user, and explore the platform menu.

### Environment Variables
- `MONGO_URI` – Mongo connection string.
- `PORT` – Express port (defaults to `3000`).
- `ENABLE_REDEEM` – Toggle promo endpoints + UI (default `true`).
- `CONSOLE_MESSAGES` – Enable verbose logs in certain games.
- `AUTH_MODE` – `manual` (default) to show username/password, or `telegram` to enable the Telegram-only overlay + WebApp login.
- `TELEGRAM_BOT_TOKEN` / `TELEGRAM_BOT_USERNAME` – Required when `AUTH_MODE=telegram` so the backend can verify signed `initData` payloads.
- `SESSION_TIMEOUT` – Seconds before Telegram sessions expire (default `86400`).
- `TOKEN_REFRESH_ENABLED`, `ALLOW_MULTIPLE_SESSIONS` – Fine-tune session refresh cadence and whether multiple devices can stay logged in simultaneously.

## Architecture Overview
- **Backend (`backend/`)** – Express + ES modules. Routes under `/api/*`, background jobs for autosave, and Mongo models for long-term storage. Key entry: `backend/server.js`.
- **Database** – MongoDB via `backend/db.js`. The `User` schema (`backend/models/user.js`) stores per-game progress, platform stats, trucks, inventory, redeem history, and streaks.
- **Frontend (`frontend/`)** – Static SPA served by Express. `frontend/index.html` bootstraps `AuthManager`, `GameManager`, toast notifications, and the shop overlay. Each game lives in `frontend/games/<game-id>/` with its own HTML, CSS, and logic.
- **Shared Config** – Gameplay constants (`BIRDS`, `TREE_TYPES`, truck timing, redeem codes) are duplicated between backend routes and frontend game bundles. Any change must be applied in both places to keep calculations consistent.

## Platform Features

### Authentication Flow
- Frontend logic lives in `frontend/auth/auth-manager.js`; backend endpoints are defined in `backend/routes/auth.js` and `backend/routes/users.js`.
- Passwords are stored as `passwordHash` (bcrypt). Sessions rely on client-local storage plus periodic refreshes triggered by `authConfig.session.tokenRefreshEnabled`.
- `AuthManager` now loads the Telegram WebApp SDK, drives a dedicated overlay, and builds API URLs from `window.location.origin` so ngrok URLs work transparently.
- Set `AUTH_MODE=telegram` to force Telegram-only login. The overlay hides the manual form, shows a connecting/waiting state, and only reveals the rest of the UI when Telegram auto-login succeeds.
- After login the server records the user’s daily activity for streak achievements and returns currency snapshots, LPA balance, and per-game progress.
- The DOM starts with `body.app-loading`; AuthManager removes it once session validation completes, ensuring the login UI fades in smoothly.

### Game Menu
- Template: `frontend/game-menu/index.html`; injected once a session is active.
- Displays username, LPA balance, unlocked achievements, streak, conversion capacity, and quick actions.
- Launch buttons call `window.gameManager.launchGame(gameId)` which swaps the active iframe/view to a specific game bundle under `frontend/games/*`.
- Promo center + history modal share `PromoRedeemWidget` (`frontend/js/promo-manager.js`) and loads only the most recent successful codes.

### Achievements
- Backend service: `backend/services/achievement-manager.js` with routes under `backend/routes/achievements.js`.
- Tracks currency thresholds (shared across all games), streak milestones (1/7/30/365 days), the first LPA purchase, and invite-based goals.
- Client modal is rendered by `AuthManager.renderAchievementModal()`: it shows cards per catalog entry, live streak progress, and conversion readiness. Counts stay in sync via `/api/achievements/status/:username` and `record-activity`.
- Autosave + background refresh keep the modal up to date even when the user idles in games.

### Exchange & Promo Center
- Exchange UI lives in `frontend/shop/` (reused modal). Conversion requires 100 coins from each game per LPA token. Backend double-checks capacity in `AchievementManager.performConversion`.
- Global promo input/history sits inside the game menu and uses `/api/promo/redeem` and `/api/promo/history/:username`. Only the ten most recent successful entries are displayed client-side for clarity.

## Games

### Happy Birds
- **Theme**: Idle coop management. Buy birds, accumulate eggs, load trucks, and sell in the city.
- **Loop**:
  1. Buy starter birds with coins.
  2. Eggs accumulate for up to six hours offline.
  3. Collect eggs, load them into the truck, send truck to the city (1 hour travel each way).
  4. Sell in the city for coins, repeat, upgrade flock.
- **Key Files**: `backend/routes/happy-birds.js`, `frontend/games/happy-birds/game.js`.
- **Tips**: Production only begins after purchasing the first bird; keep truck location in mind (city for selling, farm for loading). Redeem code `SKIPTIMER` shortens waits when enabled.

### Rich Garden
- **Theme**: Hex-style orchard management with tree upgrades and a produce truck.
- **Loop**:
  1. Purchase trees for grid cells while the truck is at the city.
  2. Trees produce fruit for four hours; collecting takes an additional 30-minute window.
  3. Load fruit at the farm, send the truck to the city to sell, then wait for the truck to return.
- **Key Files**: `backend/routes/rich-garden.js`, `frontend/games/rich-garden/game.js`.
- **Tips**: Keep `TREE_TYPES` synchronized front/back when tweaking yields; watch timers so you do not lose ripe fruit.

### Golden Mine
- **Theme**: Mine shafts alternate between work and rest cycles; a refinery truck ferries ore to the city.
- **Loop**:
  1. Hire miners, upgrade shafts, and manage rest periods.
  2. Ore auto-converts to coins; offline progress is advanced server-side (`backend/routes/golden-mine.js`).
  3. Use the truck system similar to the farming games for selling in the city.
- **Key Files**: `backend/routes/golden-mine.js`, `frontend/games/golden-mine/game.js`.
- **Tips**: Background job `advanceMineState` ensures timers continue even when offline, so always sync before making big moves.

### Cat Chess
- **Theme**: Merge-based idle game set on a chessboard; collect cats, combine them for higher tiers, and earn coins.
- **Loop**:
  1. Place cats on the board.
  2. Merge identical cats to unlock stronger income sources.
  3. Spend coins on boosters or cosmetic inventory via platform currencies.
- **Key Files**: `backend/routes/cat-chess.js`, `frontend/games/cat-chess/`.

### Fishes
- **Theme**: Aquarium tycoon with tiered fish, feeding schedules, and expanding tanks.
- **Loop**:
  1. Buy fish eggs, hatch them, and maintain feeding timers.
  2. Combine tiers or sell mature fish for coins.
  3. Use boosts from the inventory to accelerate growth.
- **Key Files**: `backend/routes/fishes.js`, `frontend/games/fishes/`.

## Redeem Codes & Promo History
- Codes live in `REDEEM_CODES.md` and are consumed through `PromoCodeManager` (`backend/services/promo-code-manager.js`).
- `ENABLE_REDEEM=true` exposes `/api/promo/redeem` + `/api/promo/history/:username` endpoints. Failed attempts are still stored, but the frontend only shows successful redemptions (max 10).
- Promo effects vary per game (skip timers, boosts, etc.) and are executed via `promo-game-executor.js`.
- Inventory items granted from codes or shop purchases sit inside the `User.inventory` tree and surface in the shop overlay when relevant.

## API Highlights
- **Auth & Users** (`backend/routes/auth.js`, `backend/routes/users.js`): register, login, fetch platform profile, platform stats.
- **Achievements** (`backend/routes/achievements.js`): `GET /achievements/status/:username`, `POST /achievements/convert`, `POST /achievements/record-activity`, `POST /achievements/record-invite`.
- **Games**: each game has its own router under `backend/routes/` (`happy-birds.js`, `rich-garden.js`, `golden-mine.js`, `cat-chess.js`, `fishes.js`). They all expect `{ username }` payloads and return validated progress objects.
- **Platform** (`backend/routes/platform.js`): shared stats, onboarding helpers, cross-game dashboards.

## Development Workflow
- **Install & Run** – see [Quick Start](#quick-start).
- **Autosave** – the backend saves user progress every 30 seconds. Never bypass the validations in routes; they guard against corrupted nested objects.
- **Sync Constants** – When changing `BIRDS`, `TREE_TYPES`, truck timing, or conversion requirements, update both backend routes and the mirroring frontend modules.
- **Testing Loop**
  1. Register a throwaway account.
  2. Launch each game via the menu and ensure production starts.
  3. Send trucks in both directions to verify travel timers.
  4. Redeem a code, then confirm it cannot be reused.
  5. Open achievements and exchange to confirm currency snapshots refresh.

## Project Layout
```
backend/
├── server.js            # Express bootstrap & background jobs
├── db.js                # Mongo connection helper
├── models/
│   └── user.js          # User schema + instance helpers
├── routes/
│   ├── auth.js          # Register/login
│   ├── users.js         # Profile + platform data
│   ├── achievements.js  # Achievements + conversions
│   ├── happy-birds.js   # Happy Birds API
│   ├── rich-garden.js   # Rich Garden API
│   ├── golden-mine.js   # Golden Mine API
│   ├── cat-chess.js     # Cat Chess API
│   └── fishes.js        # Fishes API
└── services/
    └── achievement-manager.js # Shared achievement logic

frontend/
├── index.html           # Entry point
├── script.js            # Global UI helpers
├── style.css            # Platform styles
├── auth/                # AuthManager + session flow
├── game-menu/           # Menu HTML template
├── games/               # Game bundles (one folder per game)
├── js/
│   ├── game-manager.js  # Game loader & iframe control
│   └── toast-manager.js # Toast notifications
└── shop/                # Exchange modal UI
```

Use this document as the single source of truth when onboarding contributors: every subsystem (auth, menu, each game, achievements, exchange) is referenced here along with the files to inspect when making changes.
