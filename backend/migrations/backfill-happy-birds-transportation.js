// backend/migrations/backfill-happy-birds-transportation.js
import mongoose from "../db.js";
import User from "../models/user.js";

const COLORS = ["red", "orange", "yellow", "green", "blue", "purple"];

function ensureEggObject(target) {
  const source = target && typeof target === "object" ? target : {};
  let changed = !(target && typeof target === "object");
  const next = {};
  COLORS.forEach((color) => {
    const numeric = Number(source[color]) || 0;
    next[color] = numeric;
    if (source[color] !== numeric) {
      changed = true;
    }
  });
  return { value: next, changed };
}

function ensureBirdCage(cage) {
  const initialObject = cage && typeof cage === "object" ? cage : {};
  let changed = !(cage && typeof cage === "object");
  const { value: birds, changed: birdsChanged } = ensureEggObject(initialObject.birds);
  const desiredTotal = Object.values(birds).reduce((sum, value) => sum + (Number(value) || 0), 0);
  const total = desiredTotal;
  if (initialObject.total !== total) changed = true;
  const next = { birds, total };
  return { value: next, changed: changed || birdsChanged };
}

function ensureLocation(value) {
  const allowed = ["farm", "traveling_to_city", "city", "traveling_to_farm"];
  return allowed.includes(value)
    ? { value, changed: false }
    : { value: "farm", changed: true };
}

function ensureDeparture(value) {
  if (value === null || value === undefined) {
    return { value: null, changed: value !== null }; // undefined -> true, null -> false
  }
  if (value instanceof Date) {
    return { value, changed: false };
  }
  return { value: new Date(value), changed: true };
}

async function backfillTransportation() {
  try {
    console.log("🚚 Starting Happy Birds transportation backfill...");
    const users = await User.find({});
    console.log(`📊 Found ${users.length} users to process`);

    let updatedCount = 0;
    for (const user of users) {
      let mutated = false;

      const eggs = ensureEggObject(user.eggs);
      user.eggs = eggs.value;
      mutated = mutated || eggs.changed;

      const truckInventory = ensureEggObject(user.truckInventory);
      user.truckInventory = truckInventory.value;
      mutated = mutated || truckInventory.changed;

      const helicopterInventory = ensureEggObject(user.helicopterInventory);
      user.helicopterInventory = helicopterInventory.value;
      mutated = mutated || helicopterInventory.changed;

      const truckCage = ensureBirdCage(user.truckBirdCage);
      user.truckBirdCage = truckCage.value;
      mutated = mutated || truckCage.changed;

      const heliCage = ensureBirdCage(user.helicopterBirdCage);
      user.helicopterBirdCage = heliCage.value;
      mutated = mutated || heliCage.changed;

      const truckLocation = ensureLocation(user.truckLocation);
      user.truckLocation = truckLocation.value;
      mutated = mutated || truckLocation.changed;

      const helicopterLocation = ensureLocation(user.helicopterLocation);
      user.helicopterLocation = helicopterLocation.value;
      mutated = mutated || helicopterLocation.changed;

      const truckDeparture = ensureDeparture(user.truckDepartureTime);
      user.truckDepartureTime = truckDeparture.value;
      mutated = mutated || truckDeparture.changed;

      const heliDeparture = ensureDeparture(user.helicopterDepartureTime);
      user.helicopterDepartureTime = heliDeparture.value;
      mutated = mutated || heliDeparture.changed;

      if (!user.happyBirdsUpgrades || typeof user.happyBirdsUpgrades !== "object") {
        user.happyBirdsUpgrades = {};
        mutated = true;
      }

      ["helicopterTransport", "autoCollect", "noBirdLimit", "noInventoryLimit"].forEach((key) => {
        if (typeof user.happyBirdsUpgrades[key] !== "boolean") {
          user.happyBirdsUpgrades[key] = false;
          mutated = true;
        }
      });

      if (mutated) {
        await user.save();
        updatedCount += 1;
        if (updatedCount % 25 === 0) {
          console.log(`✅ Updated ${updatedCount}/${users.length} users...`);
        }
      }
    }

    console.log(`🎉 Backfill complete! Updated ${updatedCount} users.`);
    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error("❌ Backfill failed", error);
    await mongoose.connection.close();
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  backfillTransportation();
}
