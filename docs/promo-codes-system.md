# Decentralized Promo Codes System

> **Status:** Design document for the upcoming file-based promotion engine. Use this as the single source of truth when implementing backend services, watchers, and UI.

## 1. System Overview
- **System Name:** Dynamic Promo Code Redemption System
- **Purpose:** Hot-reloadable, file-driven promo codes that can target any game or the entire platform.
- **Key Goal:** Allow non-technical team members to add/update codes by editing a JSON file; the backend reacts instantly without restarts.

## 2. File-Based Configuration
### 2.1 Configuration File
- **Location:** `config/promo-codes.json`
- **Format:** JSON array; each entry is a promo code object (see schema below).
- **Hot Reload:** Backend watches the file for changes; invalid edits roll back to the last good state.

### 2.2 Promo Code Schema
```jsonc
{
  "code": "FREEGREENBIRD",
  "description": "Adds a free Green Bird to Happy Birds game",
  "maxUses": 100,
  "usedCount": 0,
  "usedBy": [],
  "activeFrom": "2024-01-01T00:00:00Z",
  "activeUntil": "2024-12-31T23:59:59Z",
  "game": "happybirds",
  "action": "addBird",
  "parameters": {
    "birdType": "green",
    "quantity": 1
  }
}
```

### 2.3 Field Reference
| Field | Type | Notes |
| --- | --- | --- |
| `code` | `string` | Uppercase, alphanumeric identifier; user input is normalized before matching |
| `description` | `string` | Human-readable explanation shown in UI/logs |
| `maxUses` | `number` | `-1` for unlimited use, positive numbers enforce limits |
| `usedCount` | `number` | Auto-increment on each success |
| `usedBy` | `string[]` | Track usernames/IDs for limited codes to prevent double redemption |
| `activeFrom` | ISO timestamp | Code activates at this moment |
| `activeUntil` | ISO timestamp or `null` | Code expires after this moment |
| `game` | `string` | Target scope: `happybirds`, `richgarden`, `goldenmine`, `catchess`, `fishes`, or `global` |
| `action` | `string` | Resolver that defines what to do |
| `parameters` | `object` | Action-specific payload |

## 3. Promo Code Parameters & Controls
- **Unlimited vs Limited:** `maxUses = -1` skips `usedBy` tracking; any other positive number enforces both `usedCount` and `usedBy` validation.
- **Time Windows:** Both `activeFrom` and `activeUntil` must be valid ISO strings; null `activeUntil` means “never expires.”
- **Case Handling:** Codes are stored uppercase; user input is trimmed + uppercased before lookup.

## 4. Game-Specific Actions
Below are canonical action payloads. Each handler enforces its own parameter validation.

### 4.1 Happy Birds
```jsonc
{
  "game": "happybirds",
  "action": "addBird",
  "parameters": {
    "birdType": "green", // red, orange, yellow, green, blue, purple
    "quantity": 1
  }
}
```
```jsonc
{
  "game": "happybirds",
  "action": "addCoins",
  "parameters": { "amount": 5000 }
}
```
```jsonc
{
  "game": "happybirds",
  "action": "addEggs",
  "parameters": {
    "birdType": "blue",
    "quantity": 100
  }
}
```

### 4.2 Rich Garden
```jsonc
{
  "game": "richgarden",
  "action": "addTree",
  "parameters": {
    "treeType": "golden", // common, bronze, silver, golden, platinum, diamond
    "quantity": 1
  }
}
```
```jsonc
{
  "game": "richgarden",
  "action": "skipTime",
  "parameters": { "hours": 24 }
}
```

### 4.3 Golden Mine
```jsonc
{
  "game": "goldenmine",
  "action": "addMine",
  "parameters": {
    "mineType": "silver", // coal, copper, iron, nickel, silver, golden
    "quantity": 1
  }
}
```
```jsonc
{
  "game": "goldenmine",
  "action": "addWorkers",
  "parameters": {
    "mineId": "auto", // or specific mine ID
    "quantity": 5
  }
}
```

### 4.4 Cat Chess
```jsonc
{
  "game": "catchess",
  "action": "addCat",
  "parameters": {
    "level": 10,
    "grown": true
  }
}
```
```jsonc
{
  "game": "catchess",
  "action": "skipGrowth",
  "parameters": {
    "catIds": ["all"] // or an array of IDs
  }
}
```

### 4.5 Fishes
```jsonc
{
  "game": "fishes",
  "action": "addFish",
  "parameters": {
    "fishType": "rainbow", // little, golden, middle, rainbow, big, scary
    "level": 3
  }
}
```
```jsonc
{
  "game": "fishes",
  "action": "addFood",
  "parameters": { "quantity": 50 }
}
```

### 4.6 Global Actions
```jsonc
{
  "game": "global",
  "action": "addLPA",
  "parameters": { "amount": 5 }
}
```
```jsonc
{
  "game": "global",
  "action": "addCoinsAllGames",
  "parameters": { "amount": 10000 }
}
```

## 5. Data Storage & History
### 5.1 Tracking Limited Codes
- `usedCount` increments on success.
- `usedBy` stores usernames/user IDs.
- Validation ensures limited codes cannot be redeemed twice by the same account.

### 5.2 Unlimited Codes
- `maxUses = -1`: skip `usedBy`; still track `usedCount` for analytics.

### 5.3 Redemption History Collection
Mongo schema suggestion:
```ts
PromoCodeHistory {
  promoCode: string,
  userId: string,
  redeemedAt: Date,
  game: string,
  action: string,
  parameters: object,
  success: boolean
}
```
Use for audits, analytics, and abuse detection.

## 6. Workflow
1. **Input:** User enters a code in the platform UI.
2. **Validation:**
   - Code exists + active window
   - Usage limit not exceeded
   - User not in `usedBy` when limited
3. **Execution:** Dispatch to the appropriate game handler.
4. **Feedback:** Return success or detailed error message to the UI.
5. **Persistence:** Update `usedCount`, `usedBy`, and append a `PromoCodeHistory` entry.

## 7. File Monitoring
- Use `fs.watch`/`chokidar` to monitor `config/promo-codes.json`.
- On change: parse + validate. If valid, replace in-memory cache; otherwise log error and keep previous cache.
- Optionally expose a `/api/admin/promo-codes/reload` endpoint for manual refreshes.

## 8. Security & Validation
- Normalize incoming codes (`trim`, `toUpperCase`).
- Validate timestamps and ensure `activeFrom <= activeUntil` when both present.
- Each action validator sanitizes the `parameters` block (types, ranges, allowed values).
- Require authenticated sessions; rate-limit the redeem endpoint.
- Log every attempt (success or failure) for audit and anomaly detection.

## 9. UI / UX Requirements
- **Player UI:** text input + “Redeem” button, toast feedback, and a history list showing previous redemptions.
- **Admin UI (future):** manage code list, view usage counters, import/export JSON, inspect history.

## 10. Technical Implementation
### 10.1 PromoCodeManager
```js
class PromoCodeManager {
  constructor(configPath) {
    this.configPath = configPath;
    this.codes = new Map();
    this.loadCodes();
    this.startWatcher();
  }

  loadCodes() {/* read file, validate, populate this.codes */}
  startWatcher() {/* monitor file changes */}
  validateCode(code, userId) {/* structural + business rules */}
  redeemCode(code, userId) {/* orchestrate validation + execution */}
  executeGameAction(game, action, params, userId) {/* delegate */}
}
```

### 10.2 Action Dispatchers
```js
class GameActionHandler {
  static happybirds(action, params, userId) { /* switch on action */ }
  static richgarden(action, params, userId) { /* ... */ }
  static goldenmine(action, params, userId) { /* ... */ }
  static catchess(action, params, userId) { /* ... */ }
  static fishes(action, params, userId) { /* ... */ }
  static global(action, params, userId) { /* ... */ }
}
```
Each handler calls the corresponding service/controller to modify the user’s progress safely.

## 11. Monitoring & Analytics
- **Dashboards:** Track usage volume, per-game distribution, time-of-day spikes, success/failure ratios.
- **Alerts:**
  - Imminent expiration (within 48 hours)
  - Usage limits > 80%
  - Elevated error rate
  - Repeated failures per user (possible abuse)

---
Use this document to guide the implementation of the decentralized promo code system and keep it updated as new actions or games are added.
