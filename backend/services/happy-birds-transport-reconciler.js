import User from "../models/user.js";
import {
  HAPPY_BIRDS_VEHICLE_TYPES,
  HAPPY_BIRDS_VEHICLE_FIELD_MAP,
  HAPPY_BIRDS_VEHICLE_CONFIG
} from "../routes/happy-birds.js";

const TRAVELING_STATES = new Set(["traveling_to_city", "traveling_to_farm"]);

function parseDeparture(value) {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return value;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function resolveArrival(location) {
  if (location === "traveling_to_city") {
    return "city";
  }
  if (location === "traveling_to_farm") {
    return "farm";
  }
  return location;
}

function shouldCompleteTravel(location, departure, travelTime) {
  if (!TRAVELING_STATES.has(location)) {
    return false;
  }
  const departureDate = parseDeparture(departure);
  if (!departureDate) {
    return false;
  }
  return Date.now() - departureDate.getTime() >= travelTime;
}

export async function reconcileHappyBirdsTransport() {
  const travelingStates = Array.from(TRAVELING_STATES);
  const users = await User.find({
    $or: [
      { truckLocation: { $in: travelingStates } },
      { helicopterLocation: { $in: travelingStates } }
    ]
  }).select(
    "username truckLocation truckDepartureTime helicopterLocation helicopterDepartureTime"
  );

  let updatedUsers = 0;
  let completedTrips = 0;

  for (const user of users) {
    let mutated = false;

    HAPPY_BIRDS_VEHICLE_TYPES.forEach((vehicle) => {
      const fields = HAPPY_BIRDS_VEHICLE_FIELD_MAP[vehicle];
      const config = HAPPY_BIRDS_VEHICLE_CONFIG[vehicle];
      if (!fields || !config) {
        return;
      }

      const location = user[fields.location];
      const departure = user[fields.departure];
      if (!shouldCompleteTravel(location, departure, config.travelTime)) {
        return;
      }

      const arrival = resolveArrival(location);
      user[fields.location] = arrival;
      user[fields.departure] = null;
      user.markModified(fields.location);
      user.markModified(fields.departure);
      mutated = true;
      completedTrips += 1;
    });

    if (mutated) {
      await user.save();
      updatedUsers += 1;
    }
  }

  if (process.env.CONSOLE_MESSAGES === "true" && (updatedUsers > 0 || completedTrips > 0)) {
    console.log(
      `🚚 Happy Birds transport reconcile updated ${updatedUsers} users (${completedTrips} trips completed)`
    );
  }

  return { processed: users.length, updatedUsers, completedTrips };
}
