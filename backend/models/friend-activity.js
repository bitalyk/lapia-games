import mongoose from "../db.js";

const friendActivitySchema = new mongoose.Schema({
  friendshipId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Friendship",
    required: true,
    index: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true
  },
  activityType: {
    type: String,
    required: true,
    trim: true
  },
  activityData: {
    type: mongoose.Schema.Types.Mixed,
    default: () => ({})
  },
  createdAt: {
    type: Date,
    default: () => new Date()
  }
}, {
  timestamps: false
});

friendActivitySchema.index({ userId: 1, createdAt: -1 });
friendActivitySchema.index({ friendshipId: 1, createdAt: -1 });

export default mongoose.model("FriendActivity", friendActivitySchema);
