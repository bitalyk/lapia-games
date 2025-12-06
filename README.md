# Lapia Games Platform

Lapia Games is a browser-based idle/clicker platform that hosts multiple interconnected games, persistent user profiles, a cross-game economy, and a shared achievement + exchange system. This README walks through every layer so new contributors can navigate the project quickly.

## Table of Contents
1. [Quick Start](#quick-start)
2. [Architecture Overview](#architecture-overview)
3. [Platform Experience](#platform-experience)
   - [Authentication](#authentication)
   - [Game Menu](#game-menu)
   - [Achievements](#achievements)
   - [Exchange & Shop](#exchange--shop)
4. [Games](#games)
   - [Happy Birds](#happy-birds)
   - [Rich Garden](#rich-garden)
   - [Golden Mine](#golden-mine)
   - [Cat Chess](#cat-chess)
   - [Fishes](#fishes)
5. [Redeem Codes & Inventory](#redeem-codes--inventory)
6. [API Highlights](#api-highlights)
7. [Development Workflow](#development-workflow)
8. [Project Layout](#project-layout)

## Quick Start
1. Install dependencies
   ```bash
   npm install
   ```
2. Provide a MongoDB instance. By default the server connects to `mongodb://127.0.0.1:27017/lapia-games`. Override with `MONGO_URI`.
3. Run the platform
   ```bash
   npm start
   # runs node backend/server.js
   ```
4. Visit `http://localhost:3000` and register a user.

### Environment Variables
- `MONGO_URI` – Mongo connection string.
- `ENABLE_REDEEM` – Toggle redeem code endpoints (default `true`).
- `CONSOLE_MESSAGES` – Verbose logging flag.

## Architecture Overview
- **Backend (`backend/`)** – Express + ES modules. Routes under `/api/*`, background jobs for autosave, and Mongo models for long-term storage. Key entry: `backend/server.js`.
- **Database** – MongoDB via `backend/db.js`. The `User` schema (`backend/models/user.js`) stores per-game progress, platform stats, trucks, inventory, redeem history, and streaks.
- **Frontend (`frontend/`)** – Static SPA served by Express. `frontend/index.html` bootstraps `AuthManager`, `GameManager`, toast notifications, and the shop overlay. Each game lives in `frontend/games/<game-id>/` with its own HTML, CSS, and logic.
- **Shared Config** – Gameplay constants (`BIRDS`, `TREE_TYPES`, truck timing, redeem codes) are duplicated between backend routes and frontend game bundles. Any change must be applied in both places to keep calculations consistent.

## Platform Experience

### Authentication
- Managed by `frontend/auth/auth-manager.js` and backend routes in `backend/routes/auth.js` + `backend/routes/users.js`.
- Passwords are hashed with `bcrypt` and stored as `passwordHash`.
- On login the server records activity (used for streak achievements) and responds with cross-game balances, inventory, and progress snapshots.
- The UI stays hidden (`body.app-loading`) until AuthManager finishes session validation to avoid flicker.

### Game Menu
- Markup in `frontend/game-menu/index.html`, injected once the user logs in.
- Shows username, LPA balance, unlocked count, daily streak, and per-game “last played” values saved via `GameManager`.
- Cards launch games through `window.gameManager.launchGame(gameId)` which loads the respective HTML/JS bundle into the platform iframe.
- CTA buttons open the achievements modal, settings placeholder, or the exchange tab of the shop overlay.

### Achievements
- Backend logic: `backend/routes/achievements.js` + `backend/services/achievement-manager.js`.
- Tracks currency milestones, long activity streaks, social invites, and special events (e.g., “First LPA Purchase”).
- Client: `AuthManager` renders a modal with live progress bars, best-run stats, and conversion readiness. It also triggers background refreshes every minute and when the modal is open.
- Completing an achievement can reward LPA, update `achievementHistory`, and refresh the exchange conversion capacity.

### Exchange & Shop
- UI in `frontend/shop/` (`shop-ui.js`, `shop-template.html`, `styles.css`).
- Shows a single “Exchange” tab today, summarizing per-game coins, conversion readiness, and the player’s LPA balance.
- The conversion dialog enforces spending 1,000 coins from **every** game to mint 1 LPA; the backend double-checks capacity before mutating balances.
- Toast notifications come from `frontend/js/toast-manager.js` for consistent UX.

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

## Redeem Codes & Inventory
- Codes configured in `REDEEM_CODES.md` and validated in each route (`happy-birds`, `rich-garden`, etc.).
- Environment flag `ENABLE_REDEEM` toggles the feature globally.
- User inventory entries live inside the `inventory` subdocument on the `User` model; shared UI lives in `frontend/shop/` and `frontend/js`.

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
