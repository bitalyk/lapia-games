import mongoose from "../db.js";

const userSessionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true
  },
  tokenId: {
    type: String,
    required: true,
    unique: true
  },
  tokenHash: {
    type: String,
    required: true
  },
  expiresAt: {
    type: Date,
    required: true
  },
  issuedAt: {
    type: Date,
    default: () => new Date()
  },
  lastUsedAt: {
    type: Date,
    default: () => new Date()
  },
  ipAddress: {
    type: String,
    default: null
  },
  userAgent: {
    type: String,
    default: null
  },
  isActive: {
    type: Boolean,
    default: true
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: () => ({})
  }
}, {
  timestamps: true
});

userSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

userSessionSchema.statics.deactivateOtherSessions = async function(userId, exceptTokenId) {
  if (!userId) return;
  const filter = { userId, isActive: true };
  if (exceptTokenId) {
    filter.tokenId = { $ne: exceptTokenId };
  }
  await this.updateMany(filter, { $set: { isActive: false } });
};

userSessionSchema.statics.invalidateToken = function(tokenId) {
  if (!tokenId) return Promise.resolve(null);
  return this.updateOne({ tokenId }, { $set: { isActive: false } });
};

userSessionSchema.methods.markUsed = function markUsed() {
  this.lastUsedAt = new Date();
  return this.save();
};

export default mongoose.model("UserSession", userSessionSchema);
