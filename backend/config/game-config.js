// backend/config/game-config.js
export const BIRDS = {
  red:    { cost: 1000,   eps: 1,  eggsPerCoin: 100, label: "Red" },
  orange: { cost: 2500,   eps: 2,  eggsPerCoin: 80,  label: "Orange" },
  yellow: { cost: 10000,  eps: 5,  eggsPerCoin: 50,  label: "Yellow" },
  green:  { cost: 25000,  eps: 10, eggsPerCoin: 40,  label: "Green" },
  blue:   { cost: 100000, eps: 20, eggsPerCoin: 20,  label: "Blue" },
  purple: { cost: 500000, eps: 50, eggsPerCoin: 10,  label: "Purple" },
};

export const CODES = {
  REDBIRD: "red",
  ORANGEBIRD: "orange",
  YELLOWBIRD: "yellow",
  GREENBIRD: "green",
  BLUEBIRD: "blue",
  PURPLEBIRD: "purple",
  SKIPTIMER: "skip_timer"
};

export const SIX_HOURS_SEC = 6 * 60 * 60;

// Helper functions
export function computeProducedSince(productionStart, birds) {
  const nowSec = Math.floor(Date.now() / 1000);
  const startSec = productionStart ? Math.floor(new Date(productionStart).getTime() / 1000) : nowSec;
  let seconds = nowSec - startSec;
  if (seconds <= 0) return { produced: {}, seconds: 0 };
  if (seconds > SIX_HOURS_SEC) seconds = SIX_HOURS_SEC;

  const produced = {};
  for (const color of Object.keys(BIRDS)) {
    const count = (birds && birds[color]) ? birds[color] : 0;
    if (count <= 0) { produced[color] = 0; continue; }
    produced[color] = Math.floor(count * BIRDS[color].eps * seconds);
  }
  return { produced, seconds };
}