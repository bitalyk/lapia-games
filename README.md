# lapia-games

This repository is a small Express + MongoDB lapia-games (Happy Birds).
Keep guidance short and actionable so an AI agent can be productive quickly.

Key points (big picture)
- Backend: `backend/server.js` (ESM). Express serves a REST API under `/api` and static files from `frontend/`.
- Database: MongoDB via `backend/db.js`. Default URI: `mongodb://127.0.0.1:27017/lapia-games` or set `MONGO_URI`.
- Models: `backend/models/user.js` contains the User schema (birds, eggs, coins, productionStart, redeemedCodes).
- Frontend: static single-page UI in `frontend/` (`index.html`, `script.js`, `style.css`) — it talks to the API at `http://localhost:3000/api`.

Important conventions & patterns
- Single canonical bird/egg configuration is defined in both `backend/server.js` and `frontend/script.js` as `BIRDS`.
  If you add/remove bird colors or change production rules, update both files.
- Time window: production is capped to 6 hours (`SIX_HOURS_SEC`) and many endpoints depend on this logic. See `computeProducedSince` in `server.js`.
- Username is the primary identifier (no JWT/session). Most game endpoints accept `{ username }` in the request body or path (e.g. `/api/game/status/:username`).
- Passwords are hashed with `bcrypt`; the DB stores `passwordHash` (not `password`).

API surface (examples)
- POST /api/users/register
  body: { username, password }
  returns: { success: true, user: { username, coins } } or { error }
- POST /api/users/login
  body: { username, password }
  returns: { success: true, user: { username } }
- GET /api/game/status/:username
  returns: { username, coins, birds, eggs, productionStart, producedSinceStart, producedSeconds, liveEggs, redeemedCodes }
- POST /api/game/collect
  body: { username }
  behavior: fails with { error: 'not_ready', remainingSeconds } if 6h not passed; otherwise adds produced eggs to inventory and resets productionStart
- POST /api/game/sell
  body: { username }
  behavior: sells inventory eggs using `eggsPerCoin` rates in `BIRDS`
- POST /api/game/buy
  body: { username, type } where `type` is a bird key (e.g. 'red')
- POST /api/game/redeem
  body: { username, code }
  behavior: maps codes in `CODES` inside `server.js`. Special `SKIPTIMER` awards full 6h production for user's birds.

Developer workflows & quick commands
- Run locally:
  1) Install deps: `npm install`
  2) Start server: `npm start` (runs `node backend/server.js`)
  MongoDB must be reachable at the default URI or set `MONGO_URI` in env.
- Logging: server logs to console (startup, Mongo connection, and errors). Use these messages to debug (e.g. "✅ Connected to MongoDB", "✅ Server running ...").

Project-specific notes and gotchas
- There are router files in `backend/routes/` (`users.js`, `game.js`) but the main game endpoints are implemented directly in `backend/server.js`. Be careful to avoid duplicating endpoints or diverging behavior.
- The app uses ESM (`"type": "module"` in `package.json`) — import/export syntax applies.
- Data shapes: `birds` and `eggs` are objects keyed by color (red, orange, yellow, green, blue, purple). Code expects these keys to exist; missing keys will be treated as zero.
- Production/time logic is sensitive to `productionStart` being a Date. Tests or patches that change that field should keep the same semantics.

Where to look for examples
- `backend/server.js` — main game logic, constants, and API responses (source of truth for behavior).
- `backend/models/user.js` — persisted schema and defaults (coins default 1000).
- `frontend/script.js` — client-side usage patterns and fetch calls (how the UI expects API responses).

If you change core mechanics
- Update `BIRDS` in both `backend/server.js` and `frontend/script.js`.
- Update `computeProducedSince` or any production math in `server.js` and add matching UI logic in `script.js`.

When creating PRs for behavior changes
- Include unit-style checks (manual steps) describing how to reproduce: register user, buy a bird, wait/advance `productionStart`, call `/api/game/collect` and inspect `eggs` and `coins`.

Questions for the author
- Should the app prefer the router files in `backend/routes/` instead of inlining endpoints in `server.js`? I can refactor routes if you want.

If anything above is unclear or you want the instructions expanded (examples of curl requests, tests, or a short refactor plan), tell me which parts to expand.
