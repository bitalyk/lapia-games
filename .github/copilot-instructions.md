# AI Coding Agent Instructions for `lapia-games`

Welcome to the `lapia-games` repository! This document provides essential guidance for AI coding agents to be productive in this codebase. Follow these instructions to understand the architecture, workflows, and conventions.

## Big Picture Overview
- **Backend**: Located in `backend/`, the server (`server.js`) is an Express app that:
  - Serves a REST API under `/api`.
  - Serves static files from `frontend/`.
  - Runs background jobs for progress saving every 30 seconds.
- **Database**: MongoDB is used for persistence, configured in `backend/db.js`. Default URI: `mongodb://127.0.0.1:27017/lapia-games`.
- **Frontend**: A static single-page application in `frontend/` communicates with the backend API. Individual games are in `frontend/games/` (e.g., `happy-birds/`, `rich-garden/`).
- **Game Logic**: Core game mechanics (e.g., bird production, egg collection, tree farming) are implemented in backend routes (`backend/routes/happy-birds.js`, `backend/routes/rich-garden.js`) and frontend game modules (`frontend/games/happy-birds/game.js`, `frontend/games/rich-garden/game.js`).

## Key Conventions & Patterns
- **Bird/Egg Configuration**: The `BIRDS` object defines bird types and production rules. It is duplicated in `backend/routes/happy-birds.js` and `frontend/games/happy-birds/game.js`. Keep these in sync.
- **Tree/Fruit Configuration**: The `TREE_TYPES` object defines tree types and production rules. It is duplicated in `backend/routes/rich-garden.js` and `frontend/games/rich-garden/game.js`. Keep these in sync.
- **Time Window**: Production is capped at 6 hours (`SIX_HOURS_SEC`) for Happy Birds, 4 hours for Rich Garden trees.
- **User Identification**: The `username` field is the primary identifier. Most endpoints expect `{ username }` in the request body or path.
- **Password Security**: Passwords are hashed with `bcrypt` and stored as `passwordHash`.
- **Truck System**: For both games, goods must be loaded into truck at farm, truck travels to city (1 hour), goods sold at city for coins, purchases made only at city, truck returns to farm (1 hour). Production continues during travel.
- **Progress Saving**: Server automatically saves user progress every 30 seconds. Client calculates real-time production, server handles persistence.
- **Game Features**: Includes redeem bar for codes (e.g., `SKIPTIMER`, `GROWTH`) when `ENABLE_REDEEM=true`, truck delivery system (1-hour travel between farm and city), timer UI for production and truck travel, inventory for boosts/cosmetics.

## Developer Workflows
- **Run Locally**:
  1. Install dependencies: `npm install`
  2. Start the server: `npm start` (runs `node backend/server.js`)
  3. Ensure MongoDB is running at the default URI or set `MONGO_URI`.
- **Logging**: Server logs provide critical information (e.g., MongoDB connection, errors). Look for messages like:
  - `✅ Connected to MongoDB`
  - `✅ Server running on http://localhost:3000`
  - Progress save logs every 30 seconds.

## API Examples
- **User Management**:
  - `POST /api/users/register`: Register a new user.
  - `POST /api/users/login`: Log in an existing user.
- **Happy Birds Endpoints** (in `backend/routes/happy-birds.js`):
  - `GET /api/game/status/:username`: Retrieve game status (includes data validation).
  - `POST /api/game/collect`: Collect eggs (fails if 6 hours not passed, with corruption checks).
  - `POST /api/game/sell`: Sell eggs for coins.
  - `POST /api/game/buy`: Buy a bird (sets production start if first bird).
  - `POST /api/game/redeem`: Redeem a code (e.g., `SKIPTIMER`).
- **Rich Garden Endpoints** (in `backend/routes/rich-garden.js`):
  - `GET /api/rich-garden/status/:username`: Retrieve garden status.
  - `POST /api/rich-garden/buy_tree`: Buy a tree in specified cell.
  - `POST /api/rich-garden/upgrade_tree`: Upgrade tree to next level.
  - `POST /api/rich-garden/collect_tree`: Collect fruits from ready tree.
  - `POST /api/rich-garden/send_truck`: Send truck to city.
  - `POST /api/rich-garden/sell_fruits`: Sell fruits for coins.
  - `POST /api/rich-garden/return_truck`: Return truck to farm.
  - `POST /api/rich-garden/redeem`: Redeem a code (e.g., `GROWTH`).
- **Platform Endpoints** (in `backend/routes/platform.js`):
  - For multi-game platform features.

## Project-Specific Notes
- **Router Files**: Game logic is in `backend/routes/happy-birds.js`, auth in `auth.js`, users in `users.js`, platform in `platform.js`, rich garden in `rich-garden.js`. Main server setup in `backend/server.js`.
- **Database Schemas**: User model includes sub-schemas for Rich Garden (`treeSchema`, `richGardenInventorySchema`, `richGardenProgressSchema`) and Happy Birds data structures.
- **ESM**: The project uses ES modules (`"type": "module"` in `package.json`). Use `import/export` syntax.
- **Static Frontend**: The frontend is a static SPA. Game-specific logic in `frontend/games/[game-name]/game.js`, styles in `style.css`, HTML in `index.html`.
- **User Model**: Extended with `productionStart`, `lastSaveTime`, `savedProduced`, `redeemedCodes`, `platformStats`, `platformCurrencies`, `gamesProgress`, `richGardenProgress`, `inventory`, `settings`.

## Integration Points
- **MongoDB**: Ensure the database is running and accessible. Use the `MONGO_URI` environment variable to override the default URI.
- **Frontend-Backend Communication**: The frontend communicates with the backend at `http://localhost:3000/api`. Configuration is loaded from `/api/config` endpoint.
- **Background Jobs**: Progress saving runs every 30 seconds in `server.js`, with data validation to handle corruption.

## Common Gotchas
- **Syncing `BIRDS`**: Always update both `backend/routes/happy-birds.js` and `frontend/games/happy-birds/game.js` when modifying bird configurations.
- **Syncing `TREE_TYPES`**: Always update both `backend/routes/rich-garden.js` and `frontend/games/rich-garden/game.js` when modifying tree configurations.
- **Data Shape Assumptions**: Ensure `birds`, `eggs`, and `savedProduced` objects include all expected keys (e.g., `red`, `blue`). Validation resets corrupted data to empty objects.
- **Time Logic**: Production starts on first bird purchase. Background saves prevent data loss but may cause UI jumps; client-side calculation handles real-time updates.
- **Data Corruption**: Routes and background saver include checks for corrupted objects; auto-reset to prevent Mongoose errors.
- **Game Separation**: Each game (e.g., happy-birds, rich-garden) has its own directory with game.js, index.html, style.css for modularity.

By following these instructions, AI agents can contribute effectively to the `lapia-games` project. If any section is unclear or incomplete, please request clarification or additional details.