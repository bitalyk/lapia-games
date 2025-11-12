// backend/models/user.js
import mongoose from "../db.js";

const birdSchema = new mongoose.Schema({
  red: { type: Number, default: 0 },
  orange: { type: Number, default: 0 },
  yellow: { type: Number, default: 0 },
  green: { type: Number, default: 0 },
  blue: { type: Number, default: 0 },
  purple: { type: Number, default: 0 },
}, { _id: false });

const eggSchema = new mongoose.Schema({
  red: { type: Number, default: 0 },
  orange: { type: Number, default: 0 },
  yellow: { type: Number, default: 0 },
  green: { type: Number, default: 0 },
  blue: { type: Number, default: 0 },
  purple: { type: Number, default: 0 },
}, { _id: false });

const userSchema = new mongoose.Schema({
  username: { type: String, unique: true },
  passwordHash: { type: String, default: "" },
  coins: { type: Number, default: 1000 },
  birds: { type: birdSchema, default: () => ({}) },
  eggs: { type: eggSchema, default: () => ({}) }, // inventory (collected eggs)
  // productionStart: time when current production window started (after last collect)
  productionStart: { type: Date, default: Date.now },
  redeemedCodes: { type: [String], default: [] }, // codes already used by this user
}, { timestamps: true });

export default mongoose.model("User", userSchema);
