// backend/migrations/cleanup-duplicate-indexes.js
import mongoose from '../db.js';
import User from '../models/user.js';

async function cleanupDuplicateIndexes() {
  try {
    console.log('🔄 Cleaning up duplicate indexes...');
    
    // Подключаемся к базе
    await mongoose.connection.asPromise();
    
    // Получаем коллекцию users
    const collection = mongoose.connection.db.collection('users');
    
    // Получаем все индексы
    const indexes = await collection.getIndexes();
    console.log('📊 Current indexes:', Object.keys(indexes));
    
    // Ищем дублирующиеся индексы для username
    const usernameIndexes = Object.keys(indexes).filter(name => 
      name.includes('username')
    );
    
    console.log('🔍 Username indexes found:', usernameIndexes);
    
    if (usernameIndexes.length > 1) {
      console.log('🗑️ Removing duplicate username indexes...');
      
      // Оставляем только один индекс (первый), остальные удаляем
      for (let i = 1; i < usernameIndexes.length; i++) {
        await collection.dropIndex(usernameIndexes[i]);
        console.log(`✅ Removed duplicate index: ${usernameIndexes[i]}`);
      }
    }
    
    // Пересоздаем правильные индексы через модель
    console.log('🔧 Recreating proper indexes...');
    await User.createIndexes();
    
    console.log('🎉 Index cleanup completed!');
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Cleanup failed:', error);
    process.exit(1);
  }
}

// Запускаем очистку если скрипт вызван напрямую
if (import.meta.url === `file://${process.argv[1]}`) {
  cleanupDuplicateIndexes();
}