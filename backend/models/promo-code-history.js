import mongoose from '../db.js';

const promoCodeHistorySchema = new mongoose.Schema({
  promoCode: { type: String, required: true, uppercase: true, trim: true },
  username: { type: String, required: true, trim: true },
  game: { type: String, required: true, trim: true },
  action: { type: String, required: true, trim: true },
  parameters: { type: mongoose.Schema.Types.Mixed, default: {} },
  success: { type: Boolean, default: false },
  message: { type: String, default: '' },
  redeemedAt: { type: Date, default: Date.now }
}, {
  timestamps: false
});

promoCodeHistorySchema.index({ username: 1, redeemedAt: -1 });
promoCodeHistorySchema.index({ promoCode: 1 });

export default mongoose.model('PromoCodeHistory', promoCodeHistorySchema);
