import express from 'express';
import User from '../models/user.js';
import PromoCodeHistory from '../models/promo-code-history.js';
import PromoCodeManager from '../services/promo-code-manager.js';

const router = express.Router();
const manager = PromoCodeManager.getInstance();
const PROMO_HISTORY_LIMIT = 10;

router.post('/redeem', async (req, res) => {
  try {
    const { username, code } = req.body || {};
    if (!username || !code) {
      return res.status(400).json({ error: 'Username and code are required.' });
    }

    const user = await User.findByUsername(username);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const { promo, result } = await manager.redeem({ code, user });
    await PromoCodeHistory.create({
      promoCode: promo.code,
      username: user.username,
      game: promo.game,
      action: promo.action,
      parameters: promo.parameters,
      success: true,
      message: result?.message || '',
      redeemedAt: new Date()
    });

    return res.json({
      success: true,
      message: result?.message || 'Promo code applied successfully.',
      payload: result?.payload || {},
      promo: {
        code: promo.code,
        description: promo.description,
        game: promo.game,
        action: promo.action
      }
    });
  } catch (error) {
    const status = error?.statusCode || 400;
    const normalizedCode = typeof req.body?.code === 'string'
      ? req.body.code.trim().toUpperCase()
      : 'UNKNOWN';

    try {
      await PromoCodeHistory.create({
        promoCode: normalizedCode,
        username: req.body?.username || 'unknown',
        game: error?.promo?.game || 'unknown',
        action: error?.promo?.action || 'unknown',
        parameters: error?.promo?.parameters || {},
        success: false,
        message: error?.message || 'Promo redemption failed.',
        redeemedAt: new Date()
      });
    } catch (historyError) {
      console.error('[promo] Failed to store promo history:', historyError.message);
    }

    const responseMessage = error?.message || 'Failed to redeem promo code.';
    return res.status(status).json({ error: responseMessage });
  }
});

router.get('/history/:username', async (req, res) => {
  try {
    const username = req.params.username;
    if (!username) {
      return res.status(400).json({ error: 'Username is required.' });
    }

    const entries = await PromoCodeHistory.find({ username, success: true })
      .sort({ redeemedAt: -1 })
      .limit(PROMO_HISTORY_LIMIT)
      .lean();

    const payload = entries.map(entry => ({
      code: entry.promoCode,
      game: entry.game,
      action: entry.action,
      message: entry.message,
      success: entry.success,
      redeemedAt: entry.redeemedAt,
      parameters: entry.parameters
    }));

    return res.json({ success: true, entries: payload });
  } catch (error) {
    console.error('[promo] Failed to load history:', error.message);
    return res.status(500).json({ error: 'Failed to load promo history.' });
  }
});

export default router;
