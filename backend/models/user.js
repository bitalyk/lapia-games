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

// Rich Garden Schemas
const treeSchema = new mongoose.Schema({
  type: { type: String, required: true, enum: ['common', 'bronze', 'silver', 'golden', 'platinum', 'diamond'] },
  state: { type: String, required: true, enum: ['producing', 'ready', 'collecting'], default: 'producing' },
  timeLeft: { type: Number, required: true, default: 14400 }, // 4 hours in seconds
  plantedAt: { type: Date, default: Date.now },
  collectionStartTime: { type: Date, default: null }, // When collection started
  lastCollected: { type: Date, default: null }
}, { _id: false });

const richGardenInventorySchema = new mongoose.Schema({
  common: { type: Number, default: 0 },
  bronze: { type: Number, default: 0 },
  silver: { type: Number, default: 0 },
  golden: { type: Number, default: 0 },
  platinum: { type: Number, default: 0 },
  diamond: { type: Number, default: 0 }
}, { _id: false });

const richGardenProgressSchema = new mongoose.Schema({
  coins: { type: Number, default: 1000 },
  garden: { type: [treeSchema], default: () => Array(10).fill(null) },
  inventory: { type: richGardenInventorySchema, default: () => ({}) },
  truckInventory: { type: richGardenInventorySchema, default: () => ({}) },
  truckLocation: { type: String, enum: ['farm', 'traveling_to_city', 'city', 'traveling_to_farm'], default: 'farm' },
  truckDepartureTime: { type: Date, default: null },
  totalTreesPlanted: { type: Number, default: 0 },
  totalFruitsCollected: { type: Number, default: 0 },
  totalCoinsEarned: { type: Number, default: 0 },
  highestGardenLevel: { type: Number, default: 1 },
  redeemedCodes: { type: [String], default: [] },
  lastPlayed: { type: Date, default: Date.now },
  playTime: { type: Number, default: 0 }
}, { _id: false });

// Golden Mine Schemas
const mineSchema = new mongoose.Schema({
  type: { type: String, required: true, enum: ['coal', 'copper', 'iron', 'nickel', 'silver', 'golden'] },
  workers: { type: Number, required: true, default: 1, min: 1, max: 10 },
  state: { type: String, required: true, enum: ['producing', 'ready', 'resting'], default: 'producing' },
  timeLeft: { type: Number, required: true, default: 28800 }, // 8 hours in seconds
  lastStateChange: { type: Date, default: Date.now },
  oreProduced: { type: Number, default: 0 }
}, { _id: false });

const goldenMineInventorySchema = new mongoose.Schema({
  coal: { type: Number, default: 0 },
  copper: { type: Number, default: 0 },
  iron: { type: Number, default: 0 },
  nickel: { type: Number, default: 0 },
  silver: { type: Number, default: 0 },
  golden: { type: Number, default: 0 }
}, { _id: false });

const goldenMineProgressSchema = new mongoose.Schema({
  coins: { type: Number, default: 1000 },
  mines: { type: [mineSchema], default: () => Array(10).fill(null) },
  inventory: { type: goldenMineInventorySchema, default: () => ({}) },
  truckLocation: { type: String, enum: ['mine', 'traveling_to_factory', 'factory', 'traveling_to_mine'], default: 'mine' },
  truckDepartureTime: { type: Date, default: null },
  truckCargo: { type: goldenMineInventorySchema, default: () => ({}) },
  totalMinesOwned: { type: Number, default: 0 },
  totalOreMined: { type: Number, default: 0 },
  totalCoinsEarned: { type: Number, default: 0 },
  redeemedCodes: { type: [String], default: [] },
  lastPlayed: { type: Date, default: Date.now },
  playTime: { type: Number, default: 0 }
}, { _id: false });

// Cat Chess Schemas
const catChessBoardCellSchema = new mongoose.Schema({
  kind: { type: String, enum: ['cat', 'special'], default: 'cat' },
  level: { type: Number },
  timerStart: { type: Date, default: null },
  id: { type: String },
  type: { type: String },
  form: { type: String, enum: ['common', 'golden'], default: 'common' },
  baseValue: { type: Number, default: 0 },
  createdAt: { type: Date }
}, { _id: false, strict: false });

const catChessSpecialInventorySchema = new mongoose.Schema({
  id: { type: String, required: true },
  type: { type: String, required: true },
  form: { type: String, enum: ['common', 'golden'], default: 'common' },
  baseValue: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
}, { _id: false, strict: false });

const catChessProgressSchema = new mongoose.Schema({
  coins: { type: Number, default: 1000 },
  specialCurrency: { type: Number, default: 0 },
  board: { type: [catChessBoardCellSchema], default: () => Array(64).fill(null) },
  unlockedLevels: { type: [Number], default: () => [1] },
  specialInventory: { type: [catChessSpecialInventorySchema], default: () => [] },
  redeemedCodes: { type: [String], default: [] },
  lastPlayed: { type: Date, default: Date.now },
  playTime: { type: Number, default: 0 },
  starterGranted: { type: Boolean, default: true },
  sellBonuses: { type: mongoose.Schema.Types.Mixed, default: () => ({}) }
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
  'rich-garden': { type: Number, default: 0 },
  'golden-mine': { type: Number, default: 0 },
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
      ['happy-birds', { unlocked: true, lastPlayed: new Date() }],
      ['rich-garden', { unlocked: true, lastPlayed: new Date() }],
      ['golden-mine', { unlocked: true, lastPlayed: new Date() }],
      ['cat-chess', { unlocked: true, lastPlayed: new Date() }]
    ])
  },
  
  // Rich Garden specific data
  richGardenProgress: {
    type: richGardenProgressSchema,
    default: () => ({
      coins: 1000,
      garden: Array(10).fill(null),
      inventory: {},
      truckInventory: {},
      truckLocation: 'farm',
      truckDepartureTime: null,
      totalTreesPlanted: 0,
      totalFruitsCollected: 0,
      totalCoinsEarned: 0,
      highestGardenLevel: 1,
      redeemedCodes: [],
      lastPlayed: new Date(),
      playTime: 0
    })
  },
  
  // Golden Mine specific data
  goldenMineProgress: {
    type: goldenMineProgressSchema,
    default: () => ({
      coins: 1000,
      mines: Array(10).fill(null),
      inventory: {},
      truckLocation: 'mine',
      truckDepartureTime: null,
      truckCargo: {},
      totalMinesOwned: 0,
      totalOreMined: 0,
      totalCoinsEarned: 0,
      redeemedCodes: [],
      lastPlayed: new Date(),
      playTime: 0
    })
  },
  
  // Cat Chess specific data
  catChessProgress: {
    type: catChessProgressSchema,
    default: () => ({
      coins: 1000,
      specialCurrency: 0,
      board: Array(64).fill(null),
      unlockedLevels: [1],
      specialInventory: [],
      redeemedCodes: [],
      lastPlayed: new Date(),
      playTime: 0
    })
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