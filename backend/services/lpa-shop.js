import { randomUUID } from "crypto";
import AchievementManager from "./achievement-manager.js";
import { FarmPlanner } from "./rich-garden-inventory.js";

const GAME_SHOP_METADATA = {
  "happy-birds": { label: "Happy Birds", icon: "🐦" },
  "rich-garden": { label: "Rich Garden", icon: "🌳" },
  "golden-mine": { label: "Golden Mine", icon: "⛏️" },
  "cat-chess": { label: "Cat Chess", icon: "🐱" },
  fishes: { label: "Fishes", icon: "🐟" }
};

class ShopItem {
  constructor(config = {}) {
    this.id = config.id;
    this.game = config.game;
    this.type = config.type || "item";
    this.name = config.name;
    this.description = config.description || "";
    this.lpaCost = Number(config.lpaCost) || 0;
    this.action = config.action;
    this.parameters = config.parameters || {};
    this.requirements = {
      maxPurchase: typeof config.requirements?.maxPurchase === "number" ? config.requirements.maxPurchase : -1,
      prerequisite: config.requirements?.prerequisite || null,
      validation: typeof config.requirements?.validation === "function" ? config.requirements.validation : null
    };
  }
}

class BaseShopController {
  constructor(gameId, items = []) {
    this.gameId = gameId;
    this.metadata = GAME_SHOP_METADATA[gameId] || { label: gameId, icon: "🛒" };
    this.items = items;
  }

  getIdPrefix() {
    return `${this.gameId}:`;
  }

  getItems() {
    return this.items;
  }

  findItem(itemId) {
    return this.items.find((item) => item.id === itemId);
  }

  getPurchaseCount(_user, _item) {
    return 0;
  }

  getLimit(item) {
    return typeof item.requirements?.maxPurchase === "number" ? item.requirements.maxPurchase : -1;
  }

  hasReachedLimit(user, item) {
    const limit = this.getLimit(item);
    if (limit < 0) {
      return false;
    }
    return this.getPurchaseCount(user, item) >= limit;
  }

  describeItem(user, item) {
    const purchaseCount = this.getPurchaseCount(user, item);
    const maxPurchase = this.getLimit(item);
    const soldOut = maxPurchase >= 0 && purchaseCount >= maxPurchase;
    return {
      id: item.id,
      game: this.gameId,
      type: item.type,
      name: item.name,
      description: item.description,
      lpaCost: item.lpaCost,
      action: item.action,
      parameters: item.parameters,
      metadata: this.metadata,
      status: {
        purchased: purchaseCount,
        maxPurchase,
        soldOut,
        disabledReason: soldOut ? "limit" : null
      }
    };
  }

  describeSection(user) {
    return {
      game: this.gameId,
      label: this.metadata.label,
      icon: this.metadata.icon,
      items: this.getItems().map((item) => this.describeItem(user, item))
    };
  }

  validate(user, item, context = {}) {
    if (this.hasReachedLimit(user, item)) {
      return { valid: false, reason: "ALREADY_PURCHASED" };
    }
    if (typeof item.requirements?.validation === "function") {
      return item.requirements.validation(user, item, context);
    }
    return this.validateSpecific(user, item, context);
  }

  // eslint-disable-next-line class-methods-use-this
  validateSpecific() {
    return { valid: true };
  }

  // eslint-disable-next-line class-methods-use-this
  applyPurchase() {
    throw new Error("applyPurchase must be implemented by subclasses");
  }
}

const SHOP_CONTROLLERS = [];
const SHOP_ITEM_INDEX = new Map();

function registerController(controller) {
  SHOP_CONTROLLERS.push(controller);
  controller.getItems().forEach((item) => {
    SHOP_ITEM_INDEX.set(item.id, controller);
  });
}

export default class LpaShopManager {
  static getCatalog(user) {
    return SHOP_CONTROLLERS.map((controller) => controller.describeSection(user));
  }

  static findItem(itemId) {
    const controller = SHOP_ITEM_INDEX.get(itemId);
    if (!controller) {
      return null;
    }
    return { controller, item: controller.findItem(itemId) };
  }

  static recordTransaction(user, item, metadata = {}) {
    if (!Array.isArray(user.lpaPurchaseHistory)) {
      user.lpaPurchaseHistory = [];
    }
    user.lpaPurchaseHistory.push({
      itemId: item.id,
      game: item.game,
      lpaCost: item.lpaCost,
      purchasedAt: new Date(),
      metadata
    });
    if (user.lpaPurchaseHistory.length > 50) {
      user.lpaPurchaseHistory.splice(0, user.lpaPurchaseHistory.length - 50);
    }
  }

  static purchase(user, itemId, options = {}) {
    if (!user) {
      throw new Error("User is required for purchase");
    }
    const found = this.findItem(itemId);
    if (!found || !found.item) {
      return { success: false, error: "ITEM_NOT_FOUND" };
    }
    const { controller, item } = found;
    if (user.lpaBalance < item.lpaCost) {
      return { success: false, error: "INSUFFICIENT_LPA" };
    }
    const validation = controller.validate(user, item, options) || { valid: true };
    if (!validation.valid) {
      return { success: false, error: validation.reason || "UNAVAILABLE" };
    }

    controller.applyPurchase(user, item, validation.context || {});
    user.lpaBalance -= item.lpaCost;
    AchievementManager.markLpaPurchase(user);
    this.recordTransaction(user, item, validation.metadata || {});

    return {
      success: true,
      item: controller.describeItem(user, item),
      lpaBalance: user.lpaBalance
    };
  }
}

export { ShopItem, BaseShopController, registerController };

const HAPPY_BIRD_BUNDLES = [
  { color: "red", name: "Red Bird", cost: 10 },
  { color: "orange", name: "Orange Bird", cost: 25 },
  { color: "yellow", name: "Yellow Bird", cost: 100 },
  { color: "green", name: "Green Bird", cost: 250 },
  { color: "blue", name: "Blue Bird", cost: 1000 },
  { color: "purple", name: "Purple Bird", cost: 5000 }
];

const HAPPY_BIRD_UPGRADES = [
  { key: "helicopterTransport", name: "Helicopter Transport", cost: 10000, description: "Unlocks the helicopter with 5× crates and 5-minute flights." },
  { key: "autoCollect", name: "No Collection Timer", cost: 25000, description: "Eggs flow directly into storage with no cap." },
  { key: "noBirdLimit", name: "No Bird Limit in Farm", cost: 50000, description: "Removes all bird population caps on the farm." },
  { key: "noInventoryLimit", name: "Unlimited Crates & Cage", cost: 100000, description: "Removes egg crate and bird cage limits for every vehicle." }
];

class HappyBirdsShopController extends BaseShopController {
  constructor() {
    const items = [
      ...HAPPY_BIRD_BUNDLES.map((bundle) => new ShopItem({
        id: `happy-birds:${bundle.color}`,
        game: "happy-birds",
        type: "item",
        name: bundle.name,
        description: "Adds a premium bird instantly to your coop.",
        lpaCost: bundle.cost,
        action: "grantBird",
        parameters: { color: bundle.color },
        requirements: { maxPurchase: -1 }
      })),
      ...HAPPY_BIRD_UPGRADES.map((upgrade) => new ShopItem({
        id: `happy-birds:upgrade-${upgrade.key}`,
        game: "happy-birds",
        type: "upgrade",
        name: upgrade.name,
        description: upgrade.description,
        lpaCost: upgrade.cost,
        action: "unlockUpgrade",
        parameters: { upgradeKey: upgrade.key },
        requirements: { maxPurchase: 1 }
      }))
    ];
    super("happy-birds", items);
  }

  getUpgradeFlags(user) {
    if (!user.happyBirdsUpgrades) {
      user.happyBirdsUpgrades = {};
    }
    return user.happyBirdsUpgrades;
  }

  getPurchaseCount(user, item) {
    if (item.type !== "upgrade") {
      return 0;
    }
    const flags = this.getUpgradeFlags(user);
    return flags[item.parameters.upgradeKey] ? 1 : 0;
  }

  validateSpecific() {
    return { valid: true };
  }

  applyPurchase(user, item) {
    if (item.action === "grantBird") {
      this.grantBird(user, item.parameters.color);
      return;
    }

    if (item.action === "unlockUpgrade") {
      const flags = this.getUpgradeFlags(user);
      flags[item.parameters.upgradeKey] = true;
      user.markModified("happyBirdsUpgrades");
    }
  }

  grantBird(user, color) {
    if (!user.birds) {
      user.birds = {};
    }
    if (!user.eggs) {
      user.eggs = {};
    }
    user.birds[color] = (user.birds[color] || 0) + 1;
    const now = new Date();
    if (!user.productionStart) {
      user.productionStart = now;
    }
    user.lastSaveTime = now;
    user.markModified("birds");
  }
}

registerController(new HappyBirdsShopController());

const RICH_GARDEN_TREE_ORDER = [
  { key: "banana", label: "Banana Tree", level: 1, lpaCost: 10 },
  { key: "apple", label: "Apple Tree", level: 2, lpaCost: 25 },
  { key: "orange", label: "Orange Tree", level: 3, lpaCost: 100 },
  { key: "pomegranate", label: "Pomegranate Tree", level: 4, lpaCost: 250 },
  { key: "mango", label: "Mango Tree", level: 5, lpaCost: 1000 },
  { key: "durian", label: "Durian Tree", level: 6, lpaCost: 5000 }
];

const RICH_GARDEN_UPGRADES = [
  { key: "helicopterTransport", name: "Helicopter Transport", cost: 10000, description: "Truck travel takes only 5 minutes." },
  { key: "autoCollect", name: "No Collection Timer", cost: 25000, description: "Fruit teleports to storage instantly." },
  { key: "unlimitedCrates", name: "No Limit for Crates and Tree Crate", cost: 100000, description: "Removes every crate capacity limit." }
];

class RichGardenShopController extends BaseShopController {
  constructor() {
    const items = [
      ...RICH_GARDEN_TREE_ORDER.map((tier) => new ShopItem({
        id: `rich-garden:${tier.key}`,
        game: "rich-garden",
        type: "item",
        name: tier.label,
        description: "Adds a premium tree with smart placement.",
        lpaCost: tier.lpaCost,
        action: "placeTree",
        parameters: { treeType: tier.key, level: tier.level },
        requirements: { maxPurchase: -1 }
      })),
      ...RICH_GARDEN_UPGRADES.map((upgrade) => new ShopItem({
        id: `rich-garden:upgrade-${upgrade.key}`,
        game: "rich-garden",
        type: "upgrade",
        name: upgrade.name,
        description: upgrade.description,
        lpaCost: upgrade.cost,
        action: "unlockUpgrade",
        parameters: { upgradeKey: upgrade.key },
        requirements: { maxPurchase: 1 }
      }))
    ];
    super("rich-garden", items);
  }

  describeSection(user) {
    const snapshot = this.buildGardenSnapshot(user);
    return {
      game: this.gameId,
      label: this.metadata.label,
      icon: this.metadata.icon,
      context: this.serializeGardenContext(snapshot),
      items: this.getItems().map((item) => this.describeItem(user, item, snapshot))
    };
  }

  ensureProgress(user) {
    if (!user.richGardenProgress) {
      user.richGardenProgress = {
        coins: 0,
        garden: Array(10).fill(null),
        inventory: {},
        truckInventory: {},
        truckLocation: "farm",
        truckDepartureTime: null
      };
    }
    if (!Array.isArray(user.richGardenProgress.garden)) {
      user.richGardenProgress.garden = Array(10).fill(null);
    } else if (user.richGardenProgress.garden.length < 10) {
      user.richGardenProgress.garden = [
        ...user.richGardenProgress.garden,
        ...Array(10 - user.richGardenProgress.garden.length).fill(null)
      ];
    }
    return user.richGardenProgress;
  }

  getUpgradeFlags(user) {
    if (!user.richGardenUpgrades) {
      user.richGardenUpgrades = {};
    }
    return user.richGardenUpgrades;
  }

  getPurchaseCount(user, item) {
    if (item.type !== "upgrade") {
      return 0;
    }
    const flags = this.getUpgradeFlags(user);
    return flags[item.parameters.upgradeKey] ? 1 : 0;
  }

  collectQueuedTreeCounts(progress = {}) {
    const counts = {};
    const merge = (queued) => {
      if (!queued) {
        return;
      }
      Object.entries(queued).forEach(([type, amount]) => {
        const value = Math.max(0, Number(amount) || 0);
        if (value > 0) {
          counts[type] = (counts[type] || 0) + value;
        }
      });
    };

    if (progress.transport) {
      merge(progress.transport.truck?.treeCrate?.queued);
      merge(progress.transport.helicopter?.treeCrate?.queued);
    }
    if (progress.crates?.tree?.queued) {
      merge(progress.crates.tree.queued);
    }
    return counts;
  }

  getTreeLevelByType(type) {
    const tier = RICH_GARDEN_TREE_ORDER.find((entry) => entry.key === type);
    return tier?.level || 0;
  }

  buildPlacementSummaryForTier(planner, tier) {
    const summary = {
      canPlant: false,
      targets: [],
      emptyTargets: [],
      upgradeTargets: [],
      placement: null,
      note: null
    };

    if (!planner) {
      return summary;
    }

    const garden = Array.isArray(planner.garden) ? planner.garden : [];
    garden.forEach((plot, index) => {
      const isEmpty = !plot;
      const currentLevel = isEmpty ? 0 : this.getTreeLevelByType(plot.type);
      if (currentLevel < (tier.level || 1)) {
        summary.targets.push(index);
        if (isEmpty) {
          summary.emptyTargets.push(index);
        } else {
          summary.upgradeTargets.push(index);
        }
      }
    });

    summary.canPlant = summary.targets.length > 0;
    if (!summary.canPlant) {
      return summary;
    }

    if (summary.emptyTargets.length > 0) {
      summary.placement = "empty-slot";
      const count = summary.emptyTargets.length;
      summary.note = `${count} empty slot${count === 1 ? "" : "s"} available`;
    } else if (summary.upgradeTargets.length > 0) {
      summary.placement = "upgrade";
      const count = summary.upgradeTargets.length;
      const tierLabel = tier.label || `Tier ${tier.level}`;
      summary.note = `Upgrades ${count} lower-tier tree${count === 1 ? "" : "s"} into ${tierLabel}`;
    }

    return summary;
  }

  buildGardenSnapshot(user) {
    const progress = this.ensureProgress(user);
    const planner = new FarmPlanner({ garden: progress.garden });
    const composition = RICH_GARDEN_TREE_ORDER.reduce((acc, tier) => {
      acc[tier.key] = 0;
      return acc;
    }, {});
    planner.garden.forEach((plot) => {
      if (!plot?.type) {
        return;
      }
      composition[plot.type] = (composition[plot.type] || 0) + 1;
    });
    const emptySlots = planner.getEmptySlots();
    const queueCounts = this.collectQueuedTreeCounts(progress);
    const plantingSummary = RICH_GARDEN_TREE_ORDER.reduce((acc, tier) => {
      acc[tier.key] = this.buildPlacementSummaryForTier(planner, tier);
      return acc;
    }, {});
    return {
      progress,
      planner,
      composition,
      emptySlots,
      totalSlots: planner.size,
      plantingSummary,
      queueCounts
    };
  }

  serializeGardenContext(snapshot) {
    const tiers = RICH_GARDEN_TREE_ORDER.map((tier) => {
      const summary = snapshot.plantingSummary[tier.key] || {};
      return {
        key: tier.key,
        label: tier.label,
        level: tier.level,
        count: snapshot.composition[tier.key] || 0,
        queued: snapshot.queueCounts?.[tier.key] || 0,
        canPlant: Boolean(summary.canPlant),
        targets: Array.isArray(summary.targets) ? summary.targets : [],
        placement: summary.placement || null,
        note: summary.note || null
      };
    });
    return {
      garden: {
        totalSlots: snapshot.totalSlots,
        emptySlots: snapshot.emptySlots.length,
        filledSlots: snapshot.totalSlots - snapshot.emptySlots.length,
        composition: tiers.map(({ key, label, level, count }) => ({ key, label, level, count }))
      },
      plantingSummary: snapshot.plantingSummary,
      tiers
    };
  }

  buildItemContext(item, snapshot) {
    const treeType = item.parameters?.treeType;
    const planting = snapshot.plantingSummary[treeType] || { canPlant: false, targets: [] };
    const targets = Array.isArray(planting.targets) ? planting.targets : [];
    const emptyTargets = Array.isArray(planting.emptyTargets) ? planting.emptyTargets : [];
    const upgradeTargets = Array.isArray(planting.upgradeTargets) ? planting.upgradeTargets : [];
    return {
      treeType,
      level: item.parameters?.level || 0,
      canPlant: Boolean(planting.canPlant),
      targets,
      emptyTargets,
      upgradeTargets,
      placement: planting.placement || null,
      queued: snapshot.queueCounts?.[treeType] || 0,
      garden: {
        totalSlots: snapshot.totalSlots,
        emptySlots: snapshot.emptySlots.length,
        composition: snapshot.composition
      }
    };
  }

  getTierAvailability(snapshot, treeType) {
    const tier = RICH_GARDEN_TREE_ORDER.find((entry) => entry.key === treeType);
    if (!tier) {
      return { canPlant: false, reason: "Tier unavailable" };
    }

    const planting = snapshot.plantingSummary[treeType];
    if (!planting || !planting.canPlant) {
      return {
        canPlant: false,
        reason: "Garden already full of equal or higher-tier trees."
      };
    }

    return {
      canPlant: true,
      placement: planting.placement,
      targets: Array.isArray(planting.targets) ? planting.targets : [],
      emptyTargets: Array.isArray(planting.emptyTargets) ? planting.emptyTargets : [],
      upgradeTargets: Array.isArray(planting.upgradeTargets) ? planting.upgradeTargets : [],
      note: planting.note
    };
  }

  describeItem(user, item, snapshotOverride = null) {
    const base = super.describeItem(user, item);
    if (item.action !== "placeTree") {
      return base;
    }
    const snapshot = snapshotOverride || this.buildGardenSnapshot(user);
    const availability = this.getTierAvailability(snapshot, item.parameters.treeType);
    base.status.canPlant = availability.canPlant;
    if (!availability.canPlant && availability.reason) {
      base.status.disabledReason = availability.reason;
    }
    base.context = {
      ...this.buildItemContext(item, snapshot),
      availability
    };
    return base;
  }

  validateSpecific(user, item) {
    if (item.action !== "placeTree") {
      return { valid: true };
    }
    const snapshot = this.buildGardenSnapshot(user);
    const availability = this.getTierAvailability(snapshot, item.parameters.treeType);
    if (!availability.canPlant) {
      return { valid: false, reason: "NO_PLANTING_SLOT" };
    }
    const planting = snapshot.plantingSummary[item.parameters.treeType] || { targets: [] };
    const targets = Array.isArray(planting.targets) ? planting.targets : [];
    return {
      valid: true,
      context: {
        plantingTargets: targets,
        placement: planting.placement || null
      },
      metadata: {
        treeType: item.parameters.treeType,
        placement: planting.placement || (targets.length ? "upgrade" : "empty-slot")
      }
    };
  }

  applyPurchase(user, item) {
    if (item.action === "placeTree") {
      this.placeTree(user, item.parameters.treeType, item.parameters.level);
      return;
    }
    if (item.action === "unlockUpgrade") {
      const flags = this.getUpgradeFlags(user);
      flags[item.parameters.upgradeKey] = true;
      user.markModified("richGardenUpgrades");
    }
  }

  createTree(type) {
    return {
      type,
      state: "producing",
      timeLeft: 0,
      plantedAt: new Date(),
      collectionStartTime: null,
      lastCollected: null
    };
  }

  findLowestLevelSlotIndex(garden) {
    let lowestIndex = 0;
    let lowestLevel = Infinity;
    garden.forEach((tree, index) => {
      if (tree === null && lowestLevel !== -1) {
        lowestLevel = -1;
        lowestIndex = index;
        return;
      }
      const tier = tree ? RICH_GARDEN_TREE_ORDER.find((entry) => entry.key === tree.type) : null;
      const level = tier?.level ?? Infinity;
      if (level < lowestLevel) {
        lowestLevel = level;
        lowestIndex = index;
      }
    });
    return lowestIndex;
  }

  findUpgradeTargetIndex(garden, targetLevel) {
    if (targetLevel <= 1) {
      return -1;
    }
    const predecessor = RICH_GARDEN_TREE_ORDER[targetLevel - 2];
    if (!predecessor) {
      return -1;
    }
    return garden.findIndex((tree) => tree?.type === predecessor.key);
  }

  placeTree(user, treeType, level) {
    const progress = this.ensureProgress(user);
    const garden = progress.garden;
    const newTree = this.createTree(treeType);

    const tier = RICH_GARDEN_TREE_ORDER.find((entry) => entry.key === treeType);
    if (!tier) {
      return;
    }

    if (tier.level === 1) {
      const emptyIndex = garden.findIndex((cell) => cell === null);
      if (emptyIndex >= 0) {
        garden[emptyIndex] = newTree;
      } else {
        const fallbackIndex = this.findLowestLevelSlotIndex(garden);
        garden[fallbackIndex] = newTree;
      }
    } else {
      let targetIndex = this.findUpgradeTargetIndex(garden, tier.level);
      if (targetIndex === -1) {
        targetIndex = this.findLowestLevelSlotIndex(garden);
      }
      garden[targetIndex] = newTree;
      const flags = this.getUpgradeFlags(user);
      flags.premiumUnlockLevel = Math.max(flags.premiumUnlockLevel || 0, level || 0);
      user.markModified("richGardenUpgrades");
    }

    progress.highestGardenLevel = Math.max(progress.highestGardenLevel || 1, level || 1);
    user.markModified("richGardenProgress.garden");
    user.markModified("richGardenProgress.highestGardenLevel");
  }
}

registerController(new RichGardenShopController());

const GOLDEN_MINE_ORDER = [
  { key: "coal", label: "Coal Mine", level: 1, lpaCost: 10 },
  { key: "copper", label: "Copper Mine", level: 2, lpaCost: 25 },
  { key: "iron", label: "Iron Mine", level: 3, lpaCost: 100 },
  { key: "nickel", label: "Nickel Mine", level: 4, lpaCost: 250 },
  { key: "silver", label: "Silver Mine", level: 5, lpaCost: 1000 },
  { key: "golden", label: "Golden Mine", level: 6, lpaCost: 5000 }
];

const GOLDEN_MINE_UPGRADES = [
  { key: "helicopterTransport", name: "Helicopter Transport", cost: 10000, description: "Truck flight takes 5 minutes." },
  { key: "autoCollect", name: "No Collection Timer", cost: 25000, description: "Ore transfers directly to inventory." }
];

class GoldenMineShopController extends BaseShopController {
  constructor() {
    const items = [
      ...GOLDEN_MINE_ORDER.map((tier) => new ShopItem({
        id: `golden-mine:${tier.key}`,
        game: "golden-mine",
        type: "item",
        name: tier.label,
        description: "Adds a premium mine shaft.",
        lpaCost: tier.lpaCost,
        action: "placeMine",
        parameters: { mineType: tier.key, level: tier.level },
        requirements: { maxPurchase: -1 }
      })),
      ...GOLDEN_MINE_UPGRADES.map((upgrade) => new ShopItem({
        id: `golden-mine:upgrade-${upgrade.key}`,
        game: "golden-mine",
        type: "upgrade",
        name: upgrade.name,
        description: upgrade.description,
        lpaCost: upgrade.cost,
        action: "unlockUpgrade",
        parameters: { upgradeKey: upgrade.key },
        requirements: { maxPurchase: 1 }
      }))
    ];
    super("golden-mine", items);
  }

  ensureProgress(user) {
    if (!user.goldenMineProgress) {
      user.goldenMineProgress = {
        coins: 0,
        mines: Array(10).fill(null),
        inventory: {},
        truckLocation: "mine",
        truckDepartureTime: null,
        truckCargo: {},
        totalMinesOwned: 0
      };
    }
    if (!Array.isArray(user.goldenMineProgress.mines)) {
      user.goldenMineProgress.mines = Array(10).fill(null);
    } else if (user.goldenMineProgress.mines.length < 10) {
      user.goldenMineProgress.mines = [
        ...user.goldenMineProgress.mines,
        ...Array(10 - user.goldenMineProgress.mines.length).fill(null)
      ];
    }
    return user.goldenMineProgress;
  }

  getUpgradeFlags(user) {
    if (!user.goldenMineUpgrades) {
      user.goldenMineUpgrades = {};
    }
    return user.goldenMineUpgrades;
  }

  getPurchaseCount(user, item) {
    if (item.type !== "upgrade") {
      return 0;
    }
    const flags = this.getUpgradeFlags(user);
    return flags[item.parameters.upgradeKey] ? 1 : 0;
  }

  getHighestMineLevel(progress) {
    const levels = progress.mines
      .filter((mine) => mine && mine.type)
      .map((mine) => GOLDEN_MINE_ORDER.find((tier) => tier.key === mine.type)?.level || 0);
    if (levels.length === 0) {
      return 0;
    }
    return Math.max(...levels);
  }

  validateSpecific(user, item) {
    if (item.action !== "placeMine") {
      return { valid: true };
    }
    const progress = this.ensureProgress(user);
    const currentHighest = this.getHighestMineLevel(progress);
    const desiredLevel = item.parameters.level || 1;
    if (currentHighest >= desiredLevel) {
      return { valid: false, reason: "TIER_NOT_IMPROVEMENT" };
    }
    return { valid: true };
  }

  applyPurchase(user, item) {
    if (item.action === "placeMine") {
      this.placeMine(user, item.parameters.mineType, item.parameters.level);
      return;
    }
    if (item.action === "unlockUpgrade") {
      const flags = this.getUpgradeFlags(user);
      flags[item.parameters.upgradeKey] = true;
      user.markModified("goldenMineUpgrades");
    }
  }

  createMine(type) {
    return {
      type,
      workers: 1,
      state: "producing",
      timeLeft: 0,
      lastStateChange: new Date(),
      oreProduced: 0
    };
  }

  placeMine(user, mineType, level) {
    const progress = this.ensureProgress(user);
    const mines = progress.mines;
    const emptyIndex = mines.findIndex((slot) => slot === null);
    const newMine = this.createMine(mineType);

    if (emptyIndex >= 0) {
      mines[emptyIndex] = newMine;
    } else {
      let lowestIndex = 0;
      let lowestLevel = Infinity;
      mines.forEach((mine, index) => {
        const mineLevel = GOLDEN_MINE_ORDER.find((tier) => tier.key === mine?.type)?.level || Infinity;
        if (mineLevel < lowestLevel) {
          lowestLevel = mineLevel;
          lowestIndex = index;
        }
      });
      mines[lowestIndex] = newMine;
    }

    progress.totalMinesOwned = (progress.totalMinesOwned || 0) + 1;
    user.markModified("goldenMineProgress.mines");
    user.markModified("goldenMineProgress.totalMinesOwned");
  }
}

registerController(new GoldenMineShopController());

const CAT_CHESS_PACKS = [
  { tier: 1, level: 1, name: "Tier 1 Cat", lpaCost: 10 },
  { tier: 2, level: 11, name: "Tier 2 Cat", lpaCost: 25 },
  { tier: 3, level: 21, name: "Tier 3 Cat", lpaCost: 100 },
  { tier: 4, level: 31, name: "Tier 4 Cat", lpaCost: 250 },
  { tier: 5, level: 41, name: "Tier 5 Cat", lpaCost: 1000 },
  { tier: 6, level: 51, name: "Tier 6 Cat", lpaCost: 5000 }
];

class CatChessShopController extends BaseShopController {
  constructor() {
    const items = [
      ...CAT_CHESS_PACKS.map((pack) => new ShopItem({
        id: `cat-chess:tier-${pack.tier}`,
        game: "cat-chess",
        type: "item",
        name: pack.name,
        description: `Deploys a level ${pack.level} cat instantly`,
        lpaCost: pack.lpaCost,
        action: "placeCat",
        parameters: { level: pack.level },
        requirements: { maxPurchase: -1 }
      })),
      new ShopItem({
        id: "cat-chess:upgrade-accelerated-growth",
        game: "cat-chess",
        type: "upgrade",
        name: "Accelerated Growth",
        description: "Reduces growth timers to five minutes",
        lpaCost: 25000,
        action: "unlockUpgrade",
        parameters: { upgradeKey: "acceleratedGrowth" },
        requirements: { maxPurchase: 1 }
      })
    ];
    super("cat-chess", items);
  }

  ensureProgress(user) {
    if (!user.catChessProgress) {
      user.catChessProgress = {
        coins: 0,
        specialCurrency: 0,
        board: Array(64).fill(null),
        unlockedLevels: [1],
        specialInventory: []
      };
    }
    if (!Array.isArray(user.catChessProgress.board) || user.catChessProgress.board.length !== 64) {
      user.catChessProgress.board = Array(64).fill(null);
    }
    if (!Array.isArray(user.catChessProgress.unlockedLevels)) {
      user.catChessProgress.unlockedLevels = [1];
    }
    return user.catChessProgress;
  }

  getUpgradeFlags(user) {
    if (!user.catChessUpgrades) {
      user.catChessUpgrades = {};
    }
    return user.catChessUpgrades;
  }

  getPurchaseCount(user, item) {
    if (item.type !== "upgrade") {
      return 0;
    }
    const flags = this.getUpgradeFlags(user);
    return flags[item.parameters.upgradeKey] ? 1 : 0;
  }

  validateSpecific(user, item) {
    if (item.action !== "placeCat") {
      return { valid: true };
    }
    const progress = this.ensureProgress(user);
    const emptyIndex = progress.board.findIndex((cell) => cell === null);
    if (emptyIndex === -1) {
      return { valid: false, reason: "BOARD_FULL" };
    }
    return { valid: true };
  }

  applyPurchase(user, item) {
    if (item.action === "placeCat") {
      this.placeCat(user, item.parameters.level);
      return;
    }
    if (item.action === "unlockUpgrade") {
      const flags = this.getUpgradeFlags(user);
      flags[item.parameters.upgradeKey] = true;
      user.markModified("catChessUpgrades");
    }
  }

  placeCat(user, level) {
    const progress = this.ensureProgress(user);
    const index = progress.board.findIndex((cell) => cell === null);
    if (index === -1) {
      throw new Error("No empty cell available");
    }
    const timerStart = level >= 51 ? null : new Date();
    progress.board[index] = {
      kind: "cat",
      level,
      timerStart
    };
    if (!progress.unlockedLevels.includes(level)) {
      progress.unlockedLevels.push(level);
      progress.unlockedLevels.sort((a, b) => a - b);
      user.markModified("catChessProgress.unlockedLevels");
    }
    user.markModified("catChessProgress.board");
  }
}

registerController(new CatChessShopController());

const FISH_PACKS = [
  { key: "little", name: "Little Fish", lpaCost: 10 },
  { key: "golden", name: "Golden Fish", lpaCost: 25 },
  { key: "middle", name: "Middle Fish", lpaCost: 100 },
  { key: "rainbow", name: "Rainbow Fish", lpaCost: 250 },
  { key: "big", name: "Big Fish", lpaCost: 1000 },
  { key: "scary", name: "Scary Fish", lpaCost: 5000 }
];

const FISH_UPGRADES = [
  { key: "noStockTimer", name: "No Stock Timer", cost: 10000, description: "Premium shop never locks." },
  { key: "noFeedingLimit", name: "No Feeding Limit", cost: 15000, description: "Feeds ignore per-session cap." },
  { key: "noAquariumLimit", name: "No Aquarium Limit", cost: 25000, description: "Removes 20-slot cap." }
];

class FishesShopController extends BaseShopController {
  constructor() {
    const items = [
      ...FISH_PACKS.map((fish) => new ShopItem({
        id: `fishes:${fish.key}`,
        game: "fishes",
        type: "item",
        name: fish.name,
        description: "Adds a level 1 fish instantly",
        lpaCost: fish.lpaCost,
        action: "addFish",
        parameters: { fishType: fish.key },
        requirements: { maxPurchase: -1 }
      })),
      ...FISH_UPGRADES.map((upgrade) => new ShopItem({
        id: `fishes:upgrade-${upgrade.key}`,
        game: "fishes",
        type: "upgrade",
        name: upgrade.name,
        description: upgrade.description,
        lpaCost: upgrade.cost,
        action: "unlockUpgrade",
        parameters: { upgradeKey: upgrade.key },
        requirements: { maxPurchase: 1 }
      }))
    ];
    super("fishes", items);
  }

  ensureProgress(user) {
    if (!user.fishesProgress) {
      user.fishesProgress = {
        coins: 0,
        food: 0,
        aquariumSize: 1,
        fishes: [],
        shopPurchases: new Map(),
        shopRestockAt: null,
        lastFreeFoodAt: null
      };
    }
    if (!Array.isArray(user.fishesProgress.fishes)) {
      user.fishesProgress.fishes = [];
    }
    if (typeof user.fishesProgress.aquariumSize !== "number" || user.fishesProgress.aquariumSize < 1) {
      user.fishesProgress.aquariumSize = Math.max(1, user.fishesProgress.fishes.length);
    }
    return user.fishesProgress;
  }

  getUpgradeFlags(user) {
    if (!user.fishesUpgrades) {
      user.fishesUpgrades = {};
    }
    return user.fishesUpgrades;
  }

  getPurchaseCount(user, item) {
    if (item.type !== "upgrade") {
      return 0;
    }
    const flags = this.getUpgradeFlags(user);
    return flags[item.parameters.upgradeKey] ? 1 : 0;
  }

  hasAquariumSpace(progress, flags) {
    if (progress.fishes.length < progress.aquariumSize) {
      return true;
    }
    return Boolean(flags.noAquariumLimit);
  }

  validateSpecific(user, item) {
    if (item.action !== "addFish") {
      return { valid: true };
    }
    const progress = this.ensureProgress(user);
    const flags = this.getUpgradeFlags(user);
    if (!this.hasAquariumSpace(progress, flags)) {
      return { valid: false, reason: "AQUARIUM_FULL" };
    }
    return { valid: true };
  }

  applyPurchase(user, item) {
    if (item.action === "addFish") {
      this.addFish(user, item.parameters.fishType);
      return;
    }
    if (item.action === "unlockUpgrade") {
      const flags = this.getUpgradeFlags(user);
      flags[item.parameters.upgradeKey] = true;
      user.markModified("fishesUpgrades");
    }
  }

  addFish(user, fishType) {
    const progress = this.ensureProgress(user);
    const flags = this.getUpgradeFlags(user);
    if (!this.hasAquariumSpace(progress, flags)) {
      throw new Error("Aquarium lacks space");
    }
    const fish = {
      id: randomUUID(),
      type: fishType,
      level: 1,
      foodConsumed: 0,
      feedProgress: 0,
      feedsUsed: 0,
      lastFedAt: null,
      cooldownEndsAt: null,
      createdAt: new Date()
    };
    progress.fishes.push(fish);
    if (progress.fishes.length > progress.aquariumSize) {
      progress.aquariumSize = progress.fishes.length;
      user.markModified("fishesProgress.aquariumSize");
    }
    user.markModified("fishesProgress.fishes");
  }
}

registerController(new FishesShopController());
