import fs from 'fs';
import path from 'path';
import EventEmitter from 'events';
import PromoCodeError from './promo-code-error.js';
import PromoGameExecutor from './promo-game-executor.js';

const DEFAULT_CONFIG_PATH = path.join(process.cwd(), 'backend', 'config', 'promo-codes.json');
const RELOAD_DELAY_MS = 200;

class PromoCodeManager extends EventEmitter {
  constructor(configPath = DEFAULT_CONFIG_PATH) {
    super();
    this.configPath = configPath;
    this.codes = new Map();
    this.entries = [];
    this.watcher = null;
    this.reloadTimer = null;
    this.isSaving = false;
    this.pendingSave = false;
    this.loadFromDisk();
    this.startWatcher();
  }

  static getInstance() {
    if (!this.instance) {
      this.instance = new PromoCodeManager();
    }
    return this.instance;
  }

  normalizeCode(code) {
    return typeof code === 'string' ? code.trim().toUpperCase() : '';
  }

  sanitizeEntry(entry) {
    const normalizedCode = this.normalizeCode(entry.code);
    if (!normalizedCode) {
      throw new Error('Promo code entry missing code');
    }
    return {
      code: normalizedCode,
      description: entry.description || '',
      maxUses: Number.isFinite(entry.maxUses) ? entry.maxUses : -1,
      usedCount: Number.isFinite(entry.usedCount) ? entry.usedCount : 0,
      usedBy: Array.isArray(entry.usedBy) ? entry.usedBy : [],
      activeFrom: entry.activeFrom || null,
      activeUntil: entry.activeUntil || null,
      game: entry.game || 'global',
      action: entry.action || '',
      parameters: entry.parameters || {}
    };
  }

  loadFromDisk() {
    try {
      if (!fs.existsSync(this.configPath)) {
        fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
        fs.writeFileSync(this.configPath, '[]', 'utf-8');
      }
      const raw = fs.readFileSync(this.configPath, 'utf-8') || '[]';
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        throw new Error('Promo config must be an array');
      }
      const nextEntries = parsed.map(item => this.sanitizeEntry(item));
      this.entries = nextEntries;
      this.codes.clear();
      for (const entry of this.entries) {
        this.codes.set(entry.code, entry);
      }
      this.emit('reload', this.entries);
      console.info(`[promo] Loaded ${this.entries.length} promo codes.`);
    } catch (error) {
      console.error('[promo] Failed to load promo codes:', error.message);
    }
  }

  startWatcher() {
    if (this.watcher || !fs.existsSync(this.configPath)) {
      return;
    }
    this.watcher = fs.watch(this.configPath, () => {
      if (this.isSaving) {
        return;
      }
      clearTimeout(this.reloadTimer);
      this.reloadTimer = setTimeout(() => this.loadFromDisk(), RELOAD_DELAY_MS);
    });
  }

  ensureActiveWindow(promo) {
    const now = new Date();
    if (promo.activeFrom) {
      const start = new Date(promo.activeFrom);
      if (Number.isNaN(start.getTime()) || now < start) {
        throw new PromoCodeError('Code is not active yet.', { reason: 'inactive' });
      }
    }
    if (promo.activeUntil) {
      const end = new Date(promo.activeUntil);
      if (Number.isNaN(end.getTime())) {
        throw new PromoCodeError('Code expiration is invalid.', { reason: 'invalid_window' });
      }
      if (now > end) {
        throw new PromoCodeError('Code has expired.', { reason: 'expired' });
      }
    }
  }

  ensureUsageAvailable(promo, username) {
    if (promo.maxUses >= 0 && promo.usedCount >= promo.maxUses) {
      throw new PromoCodeError('Code usage limit reached.', { reason: 'limit_reached' });
    }
    const normalizedUser = String(username || '').toLowerCase();
    if (!normalizedUser) {
      throw new PromoCodeError('Username is required for promo redemption.');
    }
    const hasHistory = Array.isArray(promo.usedBy) && promo.usedBy.some(entry => String(entry).toLowerCase() === normalizedUser);
    if (hasHistory) {
      throw new PromoCodeError('You already redeemed this code.', { reason: 'already_used' });
    }
  }

  async persistEntries() {
    if (this.isSaving) {
      this.pendingSave = true;
      return;
    }
    this.isSaving = true;
    const payload = JSON.stringify(this.entries, null, 2);
    try {
      await fs.promises.writeFile(this.configPath, payload, 'utf-8');
    } catch (error) {
      console.error('[promo] Failed to persist promo codes:', error.message);
    } finally {
      this.isSaving = false;
      if (this.pendingSave) {
        this.pendingSave = false;
        setTimeout(() => this.persistEntries(), RELOAD_DELAY_MS);
      }
    }
  }

  async recordUsage(promo, username) {
    promo.usedCount = (promo.usedCount || 0) + 1;
    if (!Array.isArray(promo.usedBy)) {
      promo.usedBy = [];
    }
    promo.usedBy.push(username);
    await this.persistEntries();
  }

  async redeem({ code, user }) {
    const normalizedCode = this.normalizeCode(code);
    if (!normalizedCode) {
      throw new PromoCodeError('Please enter a promo code.');
    }
    const promo = this.codes.get(normalizedCode);
    if (!promo) {
      throw new PromoCodeError('Promo code not found.', { statusCode: 404, reason: 'not_found' });
    }
    this.ensureActiveWindow(promo);
    this.ensureUsageAvailable(promo, user?.username);
    if (!promo.action) {
      throw new PromoCodeError('Promo code action is not configured.', { reason: 'invalid_config' });
    }

    const result = await PromoGameExecutor.execute({ promo, user });
    await user.save();
    await this.recordUsage(promo, user.username);

    return { promo, result };
  }
}

export default PromoCodeManager;
