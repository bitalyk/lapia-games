import mongoose from "../db.js";

const invitationSchema = new mongoose.Schema({
  inviteCode: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    uppercase: false
  },
  inviterUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true
  },
  invitedUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    default: null,
    index: true
  },
  status: {
    type: String,
    enum: ["pending", "accepted", "expired", "revoked"],
    default: "pending"
  },
  expiresAt: {
    type: Date,
    required: true
  },
  acceptedAt: {
    type: Date,
    default: null
  },
  invitedAt: {
    type: Date,
    default: () => new Date()
  },
  inviteCodeUsedAt: {
    type: Date,
    default: null
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: () => ({})
  },
  fraudFlags: {
    type: [String],
    default: () => []
  }
}, {
  timestamps: true
});

invitationSchema.index({ inviterUserId: 1, status: 1 });
invitationSchema.index({ expiresAt: 1 });

export default mongoose.model("Invitation", invitationSchema);
