import mongoose from "../db.js";

const friendshipSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true
  },
  friendId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true
  },
  status: {
    type: String,
    enum: ["pending", "active", "blocked", "removed"],
    default: "active"
  },
  invitedAt: {
    type: Date,
    default: () => new Date()
  },
  inviteCodeUsed: {
    type: String,
    default: null
  },
  mutual: {
    type: Boolean,
    default: false
  },
  lastInteraction: {
    type: Date,
    default: () => new Date()
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: () => ({})
  }
}, {
  timestamps: true
});

friendshipSchema.index({ userId: 1, friendId: 1 }, { unique: true });
friendshipSchema.index({ friendId: 1, status: 1 });
friendshipSchema.index({ status: 1, lastInteraction: -1 });

friendshipSchema.statics.countFriends = function countFriends(userId) {
  if (!userId) return Promise.resolve(0);
  return this.countDocuments({ userId, status: "active" });
};

export default mongoose.model("Friendship", friendshipSchema);
