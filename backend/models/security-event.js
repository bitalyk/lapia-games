import mongoose from "../db.js";

const securityEventSchema = new mongoose.Schema({
  eventType: { type: String, required: true, index: true },
  severity: { type: String, enum: ["info", "warn", "error"], default: "info" },
  username: { type: String, default: null },
  telegramId: { type: String, default: null },
  sessionTokenId: { type: String, default: null },
  ipAddress: { type: String, default: null },
  userAgent: { type: String, default: null },
  metadata: { type: mongoose.Schema.Types.Mixed, default: () => ({}) }
}, {
  timestamps: { createdAt: true, updatedAt: false }
});

securityEventSchema.index({ createdAt: -1 });
securityEventSchema.index({ username: 1, createdAt: -1 });

export default mongoose.model("SecurityEvent", securityEventSchema);
