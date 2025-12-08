import mongoose from "../db.js";

const fraudAlertSchema = new mongoose.Schema({
  inviterUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true
  },
  patternTypes: {
    type: [String],
    default: () => []
  },
  inviteCodes: {
    type: [String],
    default: () => []
  },
  severity: {
    type: String,
    enum: ["info", "warn", "block"],
    default: "warn"
  },
  status: {
    type: String,
    enum: ["pending", "under_review", "actioned", "dismissed"],
    default: "pending"
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: () => ({})
  },
  flaggedAt: {
    type: Date,
    default: () => new Date()
  },
  resolvedAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

fraudAlertSchema.index({ flaggedAt: -1 });
fraudAlertSchema.index({ status: 1, flaggedAt: -1 });

export default mongoose.model("FraudAlert", fraudAlertSchema);
