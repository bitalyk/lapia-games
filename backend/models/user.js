// backend/models/user.js
import mongoose from "../db.js";

const birdSchema = new mongoose.Schema({
  red: { type: Number, default: 0 },
  orange: { type: Number, default: 0 },
  yellow: { type: Number, default: 0 },
  green: { type: Number, default: 0 },
  blue: { type: Number, default: 0 },
  purple: { type: Number, default: 0 },
}, { _id: false });

const eggSchema = new mongoose.Schema({
  red: { type: Number, default: 0 },
  orange: { type: Number, default: 0 },
  yellow: { type: Number, default: 0 },
  green: { type: Number, default: 0 },
  blue: { type: Number, default: 0 },
  purple: { type: Number, default: 0 },
}, { _id: false });

const platformStatsSchema = new mongoose.Schema({
  totalPlayTime: { type: Number, default: 0 },
  gamesPlayed: { type: Number, default: 1 },
  totalEarnings: { type: Number, default: 0 },
  lastLogin: { type: Date, default: Date.now },
  achievements: { type: [String], default: [] }
}, { _id: false });

const gameProgressSchema = new mongoose.Schema({
  unlocked: { type: Boolean, default: false },
  lastPlayed: { type: Date, default: Date.now },
  totalPlayTime: { type: Number, default: 0 },
  highScore: { type: Number, default: 0 },
  completed: { type: Boolean, default: false }
}, { _id: false });

const platformCurrencySchema = new mongoose.Schema({
  platform: { type: Number, default: 100 },
  'happy-birds': { type: Number, default: 0 },
}, { _id: false });

const userSchema = new mongoose.Schema({
  username: { 
    type: String, 
    unique: true, // ✅ ТОЛЬКО ЗДЕСЬ объявляем unique
    required: true,
    trim: true,
    minlength: 3,
    maxlength: 20
    // ❌ УБИРАЕМ index: true отсюда
  },
  passwordHash: { 
    type: String, 
    required: true 
  },
  email: { 
    type: String, 
    sparse: true,
    trim: true,
    lowercase: true
  },
  
  // Игровые данные Happy Birds
  coins: { type: Number, default: 1000 },
  birds: { type: birdSchema, default: () => ({}) },
  eggs: { type: eggSchema, default: () => ({}) },
  productionStart: { type: Date, default: null },
  lastSaveTime: { type: Date, default: null },
  savedProduced: { type: eggSchema, default: () => ({}) },
  redeemedCodes: { type: [String], default: [] },
  
  // Truck system
  truckLocation: { type: String, enum: ['farm', 'traveling_to_city', 'city', 'traveling_to_farm'], default: 'farm' },
  truckDepartureTime: { type: Date, default: null },
  truckInventory: { type: eggSchema, default: () => ({}) },
  
  // Новые поля для платформы
  platformStats: { 
    type: platformStatsSchema, 
    default: () => ({}) 
  },
  
  platformCurrencies: { 
    type: platformCurrencySchema, 
    default: () => ({}) 
  },
  
  gamesProgress: {
    type: Map,
    of: gameProgressSchema,
    default: () => new Map([
      ['happy-birds', { unlocked: true, lastPlayed: new Date() }]
    ])
  },
  
  inventory: {
    boosts: { type: [String], default: [] },
    cosmetics: { type: [String], default: [] },
    specialItems: { type: [String], default: [] }
  },
  
  settings: {
    notifications: { type: Boolean, default: true },
    music: { type: Boolean, default: true },
    sound: { type: Boolean, default: true },
    language: { type: String, default: 'en' }
  },
  
  isActive: { type: Boolean, default: true },
  lastActive: { type: Date, default: Date.now }

}, { 
  timestamps: true,
  toJSON: { 
    transform: function(doc, ret) {
      if (ret.gamesProgress instanceof Map) {
        ret.gamesProgress = Object.fromEntries(ret.gamesProgress);
      }
      return ret;
    }
  }
});

// ✅ ОБЪЯВЛЯЕМ ИНДЕКСЫ ТОЛЬКО ЗДЕСЬ (в одном месте)
userSchema.index({ 'platformStats.lastLogin': -1 });
userSchema.index({ 'platformStats.totalEarnings': -1 });
userSchema.index({ 'lastActive': -1 }); // Для активных пользователей
userSchema.index({ 'gamesProgress.lastPlayed': -1 }); // Для сортировки по играм

// Методы для платформы
userSchema.methods.updatePlatformStats = function(updates) {
  if (!this.platformStats) {
    this.platformStats = {};
  }
  Object.assign(this.platformStats, updates);
  this.lastActive = new Date();
  return this.save();
};

userSchema.methods.addPlatformCurrency = function(currencyType, amount) {
  if (!this.platformCurrencies) {
    this.platformCurrencies = {};
  }
  
  this.platformCurrencies[currencyType] = 
    (this.platformCurrencies[currencyType] || 0) + amount;
  
  if (currencyType === 'platform' && amount > 0) {
    this.platformStats.totalEarnings = 
      (this.platformStats.totalEarnings || 0) + amount;
  }
  
  return this.save();
};

userSchema.methods.unlockAchievement = function(achievementId) {
  if (!this.platformStats.achievements.includes(achievementId)) {
    this.platformStats.achievements.push(achievementId);
    return this.save();
  }
  return Promise.resolve(this);
};

userSchema.methods.updateGameProgress = function(gameId, progress) {
  if (!this.gamesProgress) {
    this.gamesProgress = new Map();
  }
  
  const currentProgress = this.gamesProgress.get(gameId) || {};
  this.gamesProgress.set(gameId, { ...currentProgress, ...progress, lastPlayed: new Date() });
  
  return this.save();
};

// Статический метод для поиска по username
userSchema.statics.findByUsername = function(username) {
  return this.findOne({ username: new RegExp(`^${username}$`, 'i') });
};

// Удаляем дублирующиеся индексы перед созданием модели
userSchema.pre('save', function(next) {
  // Эта функция гарантирует, что индексы не дублируются
  next();
});

export default mongoose.model("User", userSchema);