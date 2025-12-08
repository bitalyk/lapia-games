import mongoose from "../db.js";

const userGameplayStatsSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    unique: true
  },
  totalPlayTime: {
    type: Number,
    default: 0
  },
  sessionsCount: {
    type: Number,
    default: 0
  },
  lastSessionAt: {
    type: Date,
    default: null
  },
  lastGameId: {
    type: String,
    default: null
  },
  interactionFlags: {
    type: [String],
    default: () => []
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: () => ({})
  }
}, {
  timestamps: true
});

userGameplayStatsSchema.index({ totalPlayTime: -1 });
userGameplayStatsSchema.index({ lastSessionAt: -1 });

export default mongoose.model("UserGameplayStats", userGameplayStatsSchema);
