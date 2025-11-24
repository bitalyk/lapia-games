# AI Coding Agent Instructions for `lapia-games`

Welcome to the `lapia-games` repository! This document provides essential guidance for AI coding agents to be productive in this codebase. Follow these instructions to understand the architecture, workflows, and conventions.

## Big Picture Overview
- **Backend**: Located in `backend/`, the server (`server.js`) is an Express app that:
  - Serves a REST API under `/api`.
  - Serves static files from `frontend/`.
- **Database**: MongoDB is used for persistence, configured in `backend/db.js`. Default URI: `mongodb://127.0.0.1:27017/lapia-games`.
- **Frontend**: A static single-page application in `frontend/` communicates with the backend API.
- **Game Logic**: Core game mechanics (e.g., bird production, egg collection) are implemented in both `backend/server.js` and `frontend/script.js`.

## Key Conventions & Patterns
- **Bird/Egg Configuration**: The `BIRDS` object defines bird types and production rules. It is duplicated in `backend/server.js` and `frontend/script.js`. Keep these in sync.
- **Time Window**: Production is capped at 6 hours (`SIX_HOURS_SEC`). This logic is central to endpoints like `/api/game/collect`.
- **User Identification**: The `username` field is the primary identifier. Most endpoints expect `{ username }` in the request body or path.
- **Password Security**: Passwords are hashed with `bcrypt` and stored as `passwordHash`.
- **Data Shapes**: `birds` and `eggs` are objects keyed by color (e.g., `red`, `blue`). Ensure these keys exist to avoid errors.

## Developer Workflows
- **Run Locally**:
  1. Install dependencies: `npm install`
  2. Start the server: `npm start` (runs `node backend/server.js`)
  3. Ensure MongoDB is running at the default URI or set `MONGO_URI`.
- **Logging**: Server logs provide critical information (e.g., MongoDB connection, errors). Look for messages like:
  - `✅ Connected to MongoDB`
  - `✅ Server running on http://localhost:3000`

## API Examples
- **User Management**:
  - `POST /api/users/register`: Register a new user.
  - `POST /api/users/login`: Log in an existing user.
- **Game Endpoints**:
  - `GET /api/game/status/:username`: Retrieve game status.
  - `POST /api/game/collect`: Collect eggs (fails if 6 hours not passed).
  - `POST /api/game/sell`: Sell eggs for coins.
  - `POST /api/game/buy`: Buy a bird.
  - `POST /api/game/redeem`: Redeem a code (e.g., `SKIPTIMER`).

## Project-Specific Notes
- **Router Files**: While `backend/routes/` contains some routes, main game logic resides in `backend/server.js`. Avoid duplicating endpoints.
- **ESM**: The project uses ES modules (`"type": "module"` in `package.json`). Use `import/export` syntax.
- **Static Frontend**: The frontend is a static SPA. Modify `frontend/script.js` for client-side logic.

## Integration Points
- **MongoDB**: Ensure the database is running and accessible. Use the `MONGO_URI` environment variable to override the default URI.
- **Frontend-Backend Communication**: The frontend communicates with the backend at `http://localhost:3000/api`.

## Common Gotchas
- **Syncing `BIRDS`**: Always update both `server.js` and `script.js` when modifying bird configurations.
- **Data Shape Assumptions**: Ensure `birds` and `eggs` objects include all expected keys (e.g., `red`, `blue`). Missing keys default to zero.
- **Time Logic**: The 6-hour production cap is hardcoded. Be cautious when modifying related logic.

By following these instructions, AI agents can contribute effectively to the `lapia-games` project. If any section is unclear or incomplete, please request clarification or additional details.