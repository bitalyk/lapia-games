import mongoose from "../db.js";

const registrationLogSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    default: null
  },
  telegramId: {
    type: String,
    default: null
  },
  inviteCode: {
    type: String,
    default: null
  },
  ipAddress: {
    type: String,
    default: null
  },
  userAgent: {
    type: String,
    default: null
  },
  createdAt: {
    type: Date,
    default: () => new Date()
  }
}, {
  timestamps: false
});

registrationLogSchema.index({ ipAddress: 1, createdAt: -1 });
registrationLogSchema.index({ telegramId: 1, createdAt: -1 });

export default mongoose.model("RegistrationLog", registrationLogSchema);
