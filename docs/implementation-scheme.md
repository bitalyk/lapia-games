    # LPA Economy Implementation Scheme

## Overview
- Goal: unify all mini-games under the shared LPA shop so upgrades, trucks, and currency conversions behave consistently front to back.
- Backend routes (Express + Mongo) mirror each game mechanic; frontend bundles in `frontend/games/<game>` must stay in sync with their backend equivalents.
- Achievement + exchange flows live in `backend/services/achievement-manager.js` and `frontend/shop/*.js`; promo, auth, and toast systems remain the global coordination points.

## Completed Work
- **Rich Garden**: Truck gating, shop integration, and upgrade metadata wired into both backend route and frontend module.
- **Golden Mine**: Mining loops and upgrade timers aligned with shop catalog; payloads now expose upgrade + cooldown data for the UI.
- **Cat Chess**: Shop hooks now unlock move/earn bonuses; frontend reflects purchase states through shared helpers.
- **Fishes**:
  - Backend (`backend/routes/fishes.js`) now honours `noStockTimer`, `noFeedingLimit`, and `noAquariumLimit` upgrades in every handler and echoes upgrade state in responses.
  - Frontend (`frontend/games/fishes/game.js`) consumes the new metadata to remove shop limits, lift feeding caps, and show unlimited expansion states when upgrades are owned.
- **Exchange UI**: `frontend/shop/shop-ui.js` shows per-game readiness, enforces the global requirement, and opens the conversion dialog from any shop surface.
- **Platform Shop UI**: The new tabbed overlay in `frontend/shop/shop-ui.js` now renders the catalog from `/api/platform/shop/catalog`, supports per-game purchases, and mirrors LPA balances alongside the exchange tab.
- **Conversion Logic**: `backend/services/achievement-manager.js` and `frontend/shop/shop-ui.js` are aligned on the 100-coins-per-game requirement (`CONVERSION_COST_PER_GAME`/`CONVERSION_REQUIREMENT`).

## Pending / Next Steps
1. **Economy Balancing**: Monitor the new 100-coin conversion floor against live telemetry; adjust payout tables or cooldowns if conversion capacity spikes.
2. **Upgrade Catalog Polish**: Double-check LPA shop entries (costs, unlock flags, descriptive copy) so cat chess + fishes perks surface with the same naming front/back.
3. **QA / Regression**: Run through each game flow (load, action, purchase, convert) with and without relevant upgrades to ensure mirrored configs never drift.
4. **Telemetry & Logging**: Consider lightweight server logs or analytics tags around conversion attempts and upgrade purchases to detect anomalies early.

## Risks & Mitigations
- **Config Drift**: Keep duplicated constants (birds, trees, mines, fish timers) synchronized by editing backend+frontend pairs in the same change set.
- **Achievement Payload Completeness**: Missing fields (e.g., `conversionCapacity`, `achievementHistory`) will break the achievements modal; use `AchievementManager.getStatus` after any currency mutation.
- **Promo / Auth Coupling**: All new UI entry points must wait for `AuthManager` to finish session checks before lifting `app-loading`, otherwise the promo widget or exchange can race with auth state.

## Reference Checklist
- MongoDB running at `MONGO_URI` with autosave logs every 30s.
- Frontend fetches through `http://localhost:3000/api/*`.
- `/api/config` exposes feature flags for shop/promos.
- Promo widget limited to 10 successful codes; rely on Mongo for full history when debugging.
- Trucks restricted to farm loading with one-hour travel legs (Happy Birds, Rich Garden) – UI buttons must reflect server-derived states.
