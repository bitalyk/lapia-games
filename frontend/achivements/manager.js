class AchievementManager {
  constructor() {
    this.achievements = {
      'first-purchase': { name: 'First Purchase', reward: 100 },
      'bird-collector': { name: 'Bird Collector', reward: 500 },
      // ... кросс-игровые достижения
    };
  }

  unlockAchievement(userId, achievementId) {
    // Разблокировка достижения во всех играх
    this.grantReward(userId, achievementId);
    this.showAchievementPopup(achievementId);
  }
}