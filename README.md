# lapia-games

A multi-game idle/clicker platform featuring Happy Birds (egg production) and Rich Garden (tree farming) games.

Keep guidance short and actionable so an AI agent can be productive quickly.

## Big Picture Overview
- **Backend**: `backend/server.js` (ESM). Express serves a REST API under `/api` and static files from `frontend/`.
- **Database**: MongoDB via `backend/db.js`. Default URI: `mongodb://127.0.0.1:27017/lapia-games` or set `MONGO_URI`.
- **Models**: `backend/models/user.js` contains the User schema with game-specific data structures.
- **Frontend**: Static single-page UI in `frontend/` with modular game architecture in `frontend/games/`.
- **Games**: Two idle games with truck delivery systems, redeem codes, and persistent progress.

## Key Conventions & Patterns
- **Bird/Egg Configuration**: The `BIRDS` object defines bird types and production rules. Duplicated in `backend/routes/game.js` and `frontend/games/happy-birds/game.js`.
- **Tree/Fruit Configuration**: The `TREE_TYPES` object defines tree types and production rules. Duplicated in `backend/routes/rich-garden.js` and `frontend/games/rich-garden/game.js`.
- **Time Windows**: Happy Birds caps at 6 hours, Rich Garden trees at 4 hours production + 30 minutes collection.
- **User Identification**: Username is primary identifier. Most endpoints accept `{ username }` in request body or path.
- **Password Security**: Passwords hashed with `bcrypt`; DB stores `passwordHash`.
- **Truck System**: Both games use 1-hour travel between farm and city. Production continues during travel.
- **Progress Saving**: Server auto-saves progress every 30 seconds with data validation.
- **Game Features**: Redeem codes (configurable via `ENABLE_REDEEM`), truck logistics, timer UI, inventory system.

## API Surface (Examples)

### User Management
- `POST /api/users/register` - Register new user
- `POST /api/users/login` - Log in existing user

### Happy Birds (Idle Egg Production)
- `GET /api/game/status/:username` - Get game status with validation
- `POST /api/game/collect` - Collect eggs (fails if <6h passed)
- `POST /api/game/sell` - Sell eggs for coins
- `POST /api/game/buy` - Buy bird (sets production start if first)
- `POST /api/game/redeem` - Redeem code (e.g., `SKIPTIMER`)

### Rich Garden (Strategic Tree Farming)
- `GET /api/rich-garden/status/:username` - Get garden status
- `POST /api/rich-garden/buy_tree` - Buy tree in cell (sequential, truck at city)
- `POST /api/rich-garden/upgrade_tree` - Upgrade tree to next level
- `POST /api/rich-garden/collect_tree` - Collect fruits from ready tree
- `POST /api/rich-garden/send_truck` - Send truck to city
- `POST /api/rich-garden/sell_fruits` - Sell fruits for coins
- `POST /api/rich-garden/return_truck` - Return truck to farm
- `POST /api/rich-garden/redeem` - Redeem code (e.g., `GROWTH`)

### Platform Features
- `GET /api/config` - Get platform configuration
- `GET /api/platform/stats/:username` - Get cross-game statistics

## Developer Workflows & Quick Commands
- **Run Locally**:
  1. Install dependencies: `npm install`
  2. Start server: `npm start` (runs `node backend/server.js`)
  3. MongoDB must be reachable at default URI or set `MONGO_URI` in env
- **Database Management**:
  - `npm run migrate`: Run platform migration script
  - `npm run cleanup-indexes`: Clean up duplicate database indexes
- **Environment Variables**:
  - `MONGO_URI`: Override default MongoDB connection
  - `ENABLE_REDEEM`: Enable/disable redeem codes (default: true)
  - `CONSOLE_MESSAGES`: Enable verbose logging (default: false)
- **Logging**: Server logs to console. Key messages:
  - `✅ Connected to MongoDB`
  - `✅ Server running on http://localhost:3000`
  - `🎮 Game API available at /api/game`
  - `🌳 Rich Garden API available at /api/rich-garden`

## Project Structure
```
backend/
├── server.js              # Main Express server
├── db.js                  # MongoDB connection
├── models/
│   └── user.js           # User schema with game data
├── routes/
│   ├── auth.js           # Authentication endpoints
│   ├── users.js          # User management
│   ├── happy-birds.js    # Happy Birds game API
│   ├── rich-garden.js    # Rich Garden game API
│   └── platform.js       # Cross-game features
└── migrations/           # Database migration scripts

frontend/
├── index.html            # Main platform page
├── script.js             # Platform navigation
├── style.css             # Global styles
├── games/
│   ├── happy-birds/      # Happy Birds game
│   │   ├── game.js       # Game logic
│   │   ├── index.html    # Game page
│   │   └── style.css     # Game styles
│   └── rich-garden/      # Rich Garden game
│       ├── game.js       # Game logic
│       ├── index.html    # Game page
│       └── style.css     # Game styles
├── auth/                 # Authentication UI
├── game-menu/            # Game selection menu
├── shop/                 # Shop system
└── js/                   # Shared utilities
```
- **Router Architecture**: Game logic separated into `backend/routes/` files (`game.js`, `rich-garden.js`, `users.js`, `platform.js`)
- **ESM**: Uses ES modules (`"type": "module"` in `package.json`) — use `import/export` syntax
- **Modular Frontend**: Games in `frontend/games/[game-name]/` with separate `game.js`, `index.html`, `style.css`
- **Database Schema**: Extended User model with game-specific schemas (`richGardenProgress`, `gamesProgress`)
- **Data Validation**: Routes include corruption checks; auto-reset invalid data to prevent Mongoose errors
- **Sync Requirements**: Keep `BIRDS`/`TREE_TYPES` configs synced between backend routes and frontend game modules
- **Truck Logic**: Both games require truck at city for purchases, farm for loading goods
- **Production Continuity**: Background saves every 30 seconds; production continues during truck travel

## Where to Look for Examples
- `backend/routes/game.js` — Happy Birds API logic and constants
- `backend/routes/rich-garden.js` — Rich Garden API logic and tree configurations
- `backend/models/user.js` — Database schemas and data structures
- `frontend/games/happy-birds/game.js` — Client-side Happy Birds mechanics
- `frontend/games/rich-garden/game.js` — Client-side Rich Garden mechanics

## When Changing Core Mechanics
- Update configurations in both backend routes and frontend game modules
- Test data persistence and background saving
- Verify truck system integration
- Check redeem code functionality

## Testing Game Features
- Register user → Buy first item → Wait/advance timers → Collect/sell goods → Verify persistence
- Test truck travel cycles and location-based restrictions
- Redeem codes and verify one-time use
- Check cross-game data isolation
