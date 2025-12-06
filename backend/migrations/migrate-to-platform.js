// backend/migrations/migrate-to-platform.js
import mongoose from "../db.js";
import User from "../models/user.js";

async function migrateToPlatform() {
  try {
    console.log("🔄 Starting database migration to platform schema...");
    
    // Получаем всех пользователей
    const users = await User.find({});
    console.log(`📊 Found ${users.length} users to migrate`);
    
    let migratedCount = 0;
    
    for (const user of users) {
      // Инициализируем платформенные поля если их нет
      if (!user.platformStats) {
        user.platformStats = {
          totalEarnings: user.coins || 0,
          lastLogin: user.updatedAt,
          achievements: []
        };
      }

      if (typeof user.lpaBalance !== 'number') {
        user.lpaBalance = 0;
      }

      if (!user.currencyByGame) {
        user.currencyByGame = {
          happyBirds: user.coins || 0,
          richGarden: user.richGardenProgress?.coins || 0,
          goldenMine: user.goldenMineProgress?.coins || 0,
          catChess: user.catChessProgress?.coins || 0,
          fishes: user.fishesProgress?.coins || 0
        };
      }

      if (typeof user.totalGameCurrency !== 'number') {
        user.totalGameCurrency = Object.values(user.currencyByGame || {}).reduce((sum, value) => sum + (value || 0), 0);
      }

      if (!user.achievementProgress) {
        user.achievementProgress = {};
      }
      if (!user.achievementProgress.welcome) {
        user.achievementProgress.welcome = true;
      }

      if (!Array.isArray(user.achievementHistory)) {
        user.achievementHistory = [];
      }

      if (!user.activityStreak) {
        user.activityStreak = {
          currentStreak: 0,
          longestStreak: 0,
          lastActivityDate: null
        };
      }

      if (!user.friendInvites) {
        user.friendInvites = {
          invitedCount: 0,
          invitedUsers: []
        };
      }
      
      if (!user.platformCurrencies) {
        user.platformCurrencies = {
          'platform': 100, // Стартовые токены
          'happy-birds': user.coins || 0
        };
      }
      
      if (!user.gamesProgress) {
        user.gamesProgress = new Map([
          ['happy-birds', { 
            unlocked: true, 
            lastPlayed: user.updatedAt,
            highScore: user.coins || 0
          }]
        ]);
      }
      
      if (!user.inventory) {
        user.inventory = {
          boosts: [],
          cosmetics: [],
          specialItems: []
        };
      }
      
      if (!user.settings) {
        user.settings = {
          notifications: true,
          music: true,
          sound: true,
          language: 'en'
        };
      }
      
      await user.save();
      migratedCount++;
      
      if (migratedCount % 10 === 0) {
        console.log(`✅ Migrated ${migratedCount}/${users.length} users...`);
      }
    }
    
    console.log(`🎉 Migration completed! Migrated ${migratedCount} users`);
    process.exit(0);
    
  } catch (error) {
    console.error("❌ Migration failed:", error);
    process.exit(1);
  }
}

// Запускаем миграцию если скрипт вызван напрямую
if (import.meta.url === `file://${process.argv[1]}`) {
  migrateToPlatform();
}