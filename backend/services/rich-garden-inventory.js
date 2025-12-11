const DEFAULT_FRUIT_CRATE_SPECS = {
    banana: { label: 'Banana Crate', capacity: 1_000_000, fruitsPerCoin: 100 },
    apple: { label: 'Apple Crate', capacity: 800_000, fruitsPerCoin: 80 },
    orange: { label: 'Orange Crate', capacity: 500_000, fruitsPerCoin: 50 },
    pomegranate: { label: 'Pomegranate Crate', capacity: 400_000, fruitsPerCoin: 40 },
    mango: { label: 'Mango Crate', capacity: 200_000, fruitsPerCoin: 20 },
    durian: { label: 'Durian Crate', capacity: 100_000, fruitsPerCoin: 10 }
};

const DEFAULT_TREE_DEFINITIONS = {
    banana: { name: 'Banana Tree', level: 1, fruitsPerCoin: 100 },
    apple: { name: 'Apple Tree', level: 2, fruitsPerCoin: 80 },
    orange: { name: 'Orange Tree', level: 3, fruitsPerCoin: 50 },
    pomegranate: { name: 'Pomegranate Tree', level: 4, fruitsPerCoin: 40 },
    mango: { name: 'Mango Tree', level: 5, fruitsPerCoin: 20 },
    durian: { name: 'Durian Tree', level: 6, fruitsPerCoin: 10 }
};

const LEGACY_TREE_KEYS = {
    common: 'banana',
    bronze: 'apple',
    silver: 'orange',
    golden: 'pomegranate',
    platinum: 'mango',
    diamond: 'durian'
};

function normalizeTreeTypeKey(type, treeDefinitions = DEFAULT_TREE_DEFINITIONS) {
    if (!type || typeof type !== 'string') {
        return null;
    }
    if (treeDefinitions[type]) {
        return type;
    }
    const normalized = LEGACY_TREE_KEYS[type];
    return normalized && treeDefinitions[normalized] ? normalized : null;
}

function clampPositiveNumber(value) {
    if (!Number.isFinite(value)) {
        return 0;
    }
    return Math.max(0, Math.floor(value));
}

export class FruitCrate {
    constructor({ type, label, capacity, loaded = 0, reserved = 0, multiplier = 1, unlimited = false } = {}) {
        if (!type) {
            throw new Error('FruitCrate requires a type');
        }
        this.type = type;
        this.label = label || type;
        this.capacity = clampPositiveNumber(capacity);
        this.loaded = clampPositiveNumber(loaded);
        this.reserved = clampPositiveNumber(reserved);
        this.multiplier = Math.max(1, Number.isFinite(multiplier) ? multiplier : 1);
        this.unlimited = Boolean(unlimited);
    }

    get effectiveCapacity() {
        if (this.unlimited) {
            return Number.MAX_SAFE_INTEGER;
        }
        return clampPositiveNumber(this.capacity * this.multiplier);
    }

    get availableSpace() {
        return Math.max(0, this.effectiveCapacity - this.loaded - this.reserved);
    }

    load(amount) {
        const request = clampPositiveNumber(amount);
        if (request === 0) {
            return 0;
        }
        const accepted = Math.min(request, this.availableSpace);
        this.loaded += accepted;
        return accepted;
    }

    unload(amount) {
        const request = clampPositiveNumber(amount);
        if (request === 0) {
            return 0;
        }
        const removed = Math.min(request, this.loaded);
        this.loaded -= removed;
        return removed;
    }

    reserve(amount) {
        const request = clampPositiveNumber(amount);
        if (request === 0) {
            return 0;
        }
        const reserved = Math.min(request, this.availableSpace);
        this.reserved += reserved;
        return reserved;
    }

    release(amount) {
        const request = clampPositiveNumber(amount);
        if (request === 0) {
            return 0;
        }
        const released = Math.min(request, this.reserved);
        this.reserved -= released;
        return released;
    }

    setCapacityMultiplier(multiplier) {
        if (!Number.isFinite(multiplier) || multiplier <= 0) {
            return;
        }
        this.multiplier = multiplier;
    }

    enableUnlimitedMode(flag = true) {
        this.unlimited = Boolean(flag);
    }

    toJSON() {
        return {
            type: this.type,
            label: this.label,
            capacity: this.capacity,
            loaded: this.loaded,
            reserved: this.reserved,
            multiplier: this.multiplier,
            unlimited: this.unlimited
        };
    }

    static fromData(type, data = {}, options = {}) {
        const specSource = options.specs || DEFAULT_FRUIT_CRATE_SPECS;
        const spec = specSource[type] || { label: `${type} Crate`, capacity: 0 };
        const payload = {
            type,
            label: spec.label,
            capacity: spec.capacity,
            loaded: data.loaded,
            reserved: data.reserved,
            multiplier: data.multiplier ?? 1,
            unlimited: Boolean(data.unlimited)
        };
        return new FruitCrate(payload);
    }
}

export class TreeCrate {
    constructor({ capacity = 5, queued = {}, unlimited = false } = {}) {
        this.capacity = clampPositiveNumber(capacity);
        this.queued = {};
        this.unlimited = Boolean(unlimited);
        Object.entries(queued).forEach(([type, count]) => {
            const normalizedCount = clampPositiveNumber(count);
            if (normalizedCount > 0) {
                this.queued[type] = normalizedCount;
            }
        });
    }

    get effectiveCapacity() {
        if (this.unlimited) {
            return Number.MAX_SAFE_INTEGER;
        }
        return this.capacity;
    }

    get totalTrees() {
        return Object.values(this.queued).reduce((sum, count) => sum + count, 0);
    }

    get availableSlots() {
        return Math.max(0, this.effectiveCapacity - this.totalTrees);
    }

    queueTrees(type, count = 1) {
        const normalizedType = type;
        const request = clampPositiveNumber(count);
        if (!normalizedType || request === 0) {
            return 0;
        }
        const accepted = this.unlimited ? request : Math.min(request, this.availableSlots);
        if (accepted === 0) {
            return 0;
        }
        this.queued[normalizedType] = (this.queued[normalizedType] || 0) + accepted;
        return accepted;
    }

    dequeueTrees(type, count = 1) {
        if (!this.queued[type]) {
            return 0;
        }
        const request = clampPositiveNumber(count);
        const removed = Math.min(request, this.queued[type]);
        this.queued[type] -= removed;
        if (this.queued[type] <= 0) {
            delete this.queued[type];
        }
        return removed;
    }

    clearType(type) {
        const existing = this.queued[type] || 0;
        delete this.queued[type];
        return existing;
    }

    toJSON() {
        return {
            capacity: this.capacity,
            queued: { ...this.queued },
            unlimited: this.unlimited
        };
    }

    static fromData(data = {}) {
        return new TreeCrate({
            capacity: data.capacity ?? 5,
            queued: data.queued,
            unlimited: data.unlimited
        });
    }
}

export class FarmPlanner {
    constructor({ garden = [], treeDefinitions = DEFAULT_TREE_DEFINITIONS, legacyMap = LEGACY_TREE_KEYS, size = 10 } = {}) {
        this.size = size;
        this.treeDefinitions = treeDefinitions;
        this.legacyMap = legacyMap;
        this.garden = Array.from({ length: size }, (_, index) => {
            const plot = garden[index] || null;
            if (!plot) {
                return null;
            }
            const normalizedType = normalizeTreeTypeKey(plot.type, treeDefinitions, legacyMap);
            if (!normalizedType) {
                return null;
            }
            return { ...plot, type: normalizedType };
        });
    }

    normalizeType(type) {
        return normalizeTreeTypeKey(type, this.treeDefinitions, this.legacyMap);
    }

    hasEmptySlot() {
        return this.garden.some(plot => !plot);
    }

    getEmptySlots() {
        const slots = [];
        for (let i = 0; i < this.size; i += 1) {
            if (!this.garden[i]) {
                slots.push(i);
            }
        }
        return slots;
    }

    getUpgradeSlots(targetLevel) {
        const slots = [];
        for (let i = 0; i < this.size; i += 1) {
            const plot = this.garden[i];
            if (!plot) {
                continue;
            }
            const currentLevel = this.treeDefinitions[plot.type]?.level ?? 0;
            if (currentLevel < targetLevel) {
                slots.push(i);
            }
        }
        return slots;
    }

    canPlant(treeType) {
        const normalizedType = this.normalizeType(treeType);
        if (!normalizedType) {
            return false;
        }
        const targetLevel = this.treeDefinitions[normalizedType]?.level;
        if (!targetLevel) {
            return false;
        }
        if (this.hasEmptySlot()) {
            return true;
        }
        return this.getUpgradeSlots(targetLevel).length > 0;
    }

    getPlantingTargets(treeType) {
        const normalizedType = this.normalizeType(treeType);
        if (!normalizedType) {
            return [];
        }
        const targetLevel = this.treeDefinitions[normalizedType]?.level;
        if (!targetLevel) {
            return [];
        }
        const emptySlots = this.getEmptySlots();
        if (emptySlots.length > 0) {
            return emptySlots;
        }
        return this.getUpgradeSlots(targetLevel);
    }

    getPlantingSummary() {
        const summary = {};
        Object.keys(this.treeDefinitions).forEach(type => {
            summary[type] = {
                canPlant: this.canPlant(type),
                targets: this.getPlantingTargets(type)
            };
        });
        return summary;
    }
}

export function createFruitCrateSet(data = {}, options = {}) {
    const specs = options.specs || DEFAULT_FRUIT_CRATE_SPECS;
    return Object.keys(specs).reduce((acc, type) => {
        const crate = FruitCrate.fromData(type, data[type] || {}, { specs });
        if (options.multiplier && Number.isFinite(options.multiplier)) {
            crate.setCapacityMultiplier(options.multiplier);
        }
        if (options.unlimited) {
            crate.enableUnlimitedMode(true);
        }
        acc[type] = crate;
        return acc;
    }, {});
}

export function serializeFruitCrateSet(crateSet = {}) {
    const serialized = {};
    Object.entries(crateSet).forEach(([type, crate]) => {
        serialized[type] = typeof crate.toJSON === 'function' ? crate.toJSON() : { ...crate };
    });
    return serialized;
}

export {
    DEFAULT_FRUIT_CRATE_SPECS,
    DEFAULT_TREE_DEFINITIONS,
    LEGACY_TREE_KEYS,
    normalizeTreeTypeKey
};
