    const GOLDEN_MINE_TRANSPORT_VERSION = 1;
const TEN_THOUSAND_COINS_VALUE = 10_000;

export const GOLDEN_MINE_ORE_TYPES = Object.freeze(['coal', 'copper', 'iron', 'nickel', 'silver', 'golden']);

export const ORE_TYPE_CONFIG = Object.freeze({
    coal: { oreToCoinRatio: 100, crateCapacity: 1_000_000 },
    copper: { oreToCoinRatio: 80, crateCapacity: 800_000 },
    iron: { oreToCoinRatio: 50, crateCapacity: 500_000 },
    nickel: { oreToCoinRatio: 40, crateCapacity: 400_000 },
    silver: { oreToCoinRatio: 20, crateCapacity: 200_000 },
    golden: { oreToCoinRatio: 10, crateCapacity: 100_000 }
});

const DEFAULT_TRUCK_TRAVEL_SECONDS = 2 * 60 * 60;
const DEFAULT_HELICOPTER_TRAVEL_SECONDS = 15 * 60;

function getCrateCapacity(oreType, multiplier = 1) {
    const base = ORE_TYPE_CONFIG[oreType]?.crateCapacity || 0;
    return Math.max(0, Math.floor(base * multiplier));
}

export class OreCrate {
    constructor({ type, amount = 0, capacity, unlimited = false } = {}) {
        if (!GOLDEN_MINE_ORE_TYPES.includes(type)) {
            throw new Error(`Unsupported ore type: ${type}`);
        }
        this.type = type;
        this.amount = Math.max(0, Number.isFinite(Number(amount)) ? Number(amount) : 0);
        this.capacity = typeof capacity === 'number' ? capacity : getCrateCapacity(type, 1);
        this.unlimited = Boolean(unlimited);
    }

    getRemainingCapacity({ noCrateLimits = false } = {}) {
        if (this.unlimited || noCrateLimits) {
            return Number.POSITIVE_INFINITY;
        }
        return Math.max(0, this.capacity - this.amount);
    }

    load(amount, options = {}) {
        const numericAmount = Math.max(0, Math.floor(Number(amount) || 0));
        if (numericAmount <= 0) {
            return 0;
        }
        const remaining = this.getRemainingCapacity(options);
        const transferable = Number.isFinite(remaining) ? Math.min(numericAmount, remaining) : numericAmount;
        this.amount += transferable;
        return transferable;
    }

    unload(amount) {
        const numericAmount = Math.max(0, Math.floor(Number(amount) || 0));
        const transferable = Math.min(numericAmount || this.amount, this.amount);
        this.amount -= transferable;
        return transferable;
    }

    empty() {
        const transferable = this.amount;
        this.amount = 0;
        return transferable;
    }

    serialize() {
        return {
            type: this.type,
            amount: this.amount,
            capacity: this.capacity,
            unlimited: this.unlimited
        };
    }

    static from(state = {}) {
        return new OreCrate(state);
    }
}

function buildCrates(existingCrates = [], { multiplier = 1, noCrateLimits = false } = {}) {
    return GOLDEN_MINE_ORE_TYPES.map((oreType) => {
        const stored = existingCrates.find((crate) => crate?.type === oreType) || {};
        const crate = new OreCrate({
            type: oreType,
            amount: stored.amount,
            capacity: getCrateCapacity(oreType, multiplier),
            unlimited: noCrateLimits || Boolean(stored.unlimited)
        });
        return crate.serialize();
    });
}

class TransportVehicle {
    constructor({
        kind,
        location = 'mine',
        departureTime = null,
        travelTimeSeconds,
        crateCapacityMultiplier = 1,
        crates = [],
        noCrateLimits = false
    } = {}) {
        this.kind = kind;
        this.location = location;
        this.departureTime = departureTime ? new Date(departureTime) : null;
        this.travelTimeSeconds = travelTimeSeconds;
        this.crateCapacityMultiplier = crateCapacityMultiplier;
        this.crates = buildCrates(crates, {
            multiplier: crateCapacityMultiplier,
            noCrateLimits
        });
    }

    serialize() {
        return {
            kind: this.kind,
            location: this.location,
            departureTime: this.departureTime,
            travelTimeSeconds: this.travelTimeSeconds,
            crateCapacityMultiplier: this.crateCapacityMultiplier,
            crates: this.crates
        };
    }
}

export class TruckVehicle extends TransportVehicle {
    constructor(options = {}) {
        super({
            kind: 'truck',
            travelTimeSeconds: options.travelTimeSeconds ?? DEFAULT_TRUCK_TRAVEL_SECONDS,
            crateCapacityMultiplier: 1,
            ...options
        });
    }
}

export class HelicopterVehicle extends TransportVehicle {
    constructor(options = {}) {
        super({
            kind: 'helicopter',
            travelTimeSeconds: options.travelTimeSeconds ?? DEFAULT_HELICOPTER_TRAVEL_SECONDS,
            crateCapacityMultiplier: 5,
            ...options
        });
    }
}

function isDifferent(a, b) {
    return JSON.stringify(a ?? {}) !== JSON.stringify(b ?? {});
}

function normalizeVehicle(kind, existing = {}, { travelTimeSeconds, multiplier, noCrateLimits }) {
    const baseOptions = {
        location: existing.location || 'mine',
        departureTime: existing.departureTime || null,
        travelTimeSeconds,
        crateCapacityMultiplier: multiplier,
        crates: existing.crates || [],
        noCrateLimits
    };

    const vehicle = kind === 'helicopter'
        ? new HelicopterVehicle(baseOptions)
        : new TruckVehicle(baseOptions);

    return vehicle.serialize();
}

export function ensureTransportState(currentState, options = {}) {
    const {
        hasHelicopter = false,
        noCrateLimits = false,
        truckTravelTimeSeconds = DEFAULT_TRUCK_TRAVEL_SECONDS,
        helicopterTravelTimeSeconds = DEFAULT_HELICOPTER_TRAVEL_SECONDS
    } = options;

    const nextState = {
        version: GOLDEN_MINE_TRANSPORT_VERSION,
        expectedCrateCoinValue: TEN_THOUSAND_COINS_VALUE,
        vehicles: {}
    };

    const normalizedTruck = normalizeVehicle('truck', currentState?.vehicles?.truck, {
        travelTimeSeconds: truckTravelTimeSeconds,
        multiplier: 1,
        noCrateLimits
    });
    nextState.vehicles.truck = normalizedTruck;

    if (hasHelicopter) {
        const normalizedHelicopter = normalizeVehicle('helicopter', currentState?.vehicles?.helicopter, {
            travelTimeSeconds: helicopterTravelTimeSeconds,
            multiplier: 5,
            noCrateLimits
        });
        nextState.vehicles.helicopter = normalizedHelicopter;
    }

    const currentVehicles = currentState?.vehicles || {};
    Object.keys(currentVehicles).forEach((key) => {
        if (!nextState.vehicles[key] && currentVehicles[key]) {
            nextState.vehicles[key] = currentVehicles[key];
        }
    });

    return {
        state: nextState,
        updated: isDifferent(currentState, nextState)
    };
}

export function createDefaultTransportState(options = {}) {
    const { state } = ensureTransportState(null, options);
    return state;
}

export function summarizeTransportState(state = {}) {
    if (!state || !state.vehicles) {
        return { version: GOLDEN_MINE_TRANSPORT_VERSION, vehicles: {} };
    }

    const summary = {
        version: state.version ?? GOLDEN_MINE_TRANSPORT_VERSION,
        expectedCrateCoinValue: state.expectedCrateCoinValue ?? TEN_THOUSAND_COINS_VALUE,
        vehicles: {}
    };

    Object.entries(state.vehicles).forEach(([key, vehicle]) => {
        if (!vehicle) {
            return;
        }
        summary.vehicles[key] = {
            kind: vehicle.kind,
            location: vehicle.location,
            departureTime: vehicle.departureTime,
            travelTimeSeconds: vehicle.travelTimeSeconds,
            crateCapacityMultiplier: vehicle.crateCapacityMultiplier,
            crates: (vehicle.crates || []).map((crate) => ({
                type: crate.type,
                amount: crate.amount,
                capacity: crate.capacity,
                unlimited: Boolean(crate.unlimited)
            }))
        };
    });

    return summary;
}

export function getOreCrateCapacities(multiplier = 1) {
    const capacities = {};
    GOLDEN_MINE_ORE_TYPES.forEach((oreType) => {
        capacities[oreType] = getCrateCapacity(oreType, multiplier);
    });
    return capacities;
}

function normalizeInteger(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return 0;
    }
    return Math.max(0, Math.floor(numeric));
}

export function createEmptyOreInventory(seed = {}) {
    const inventory = {};
    GOLDEN_MINE_ORE_TYPES.forEach((oreType) => {
        inventory[oreType] = normalizeInteger(seed?.[oreType]);
    });
    return inventory;
}

export function normalizeOreInventory(inventory = {}) {
    return createEmptyOreInventory(inventory);
}

function ensureInventory(progress = {}, key) {
    if (!progress[key] || typeof progress[key] !== 'object') {
        progress[key] = createEmptyOreInventory();
        return { updated: true, inventory: progress[key] };
    }

    const normalized = normalizeOreInventory(progress[key]);
    if (isDifferent(progress[key], normalized)) {
        progress[key] = normalized;
        return { updated: true, inventory: normalized };
    }

    return { updated: false, inventory: normalized };
}

export function ensureGoldenMineInventories(progress = {}) {
    const mineResult = ensureInventory(progress, 'mineInventory');
    const factoryResult = ensureInventory(progress, 'factoryInventory');
    return {
        updated: mineResult.updated || factoryResult.updated,
        mineUpdated: mineResult.updated,
        factoryUpdated: factoryResult.updated,
        mineInventory: progress.mineInventory,
        factoryInventory: progress.factoryInventory
    };
}

export function ensureGoldenMineTransport(progress = {}, options = {}) {
    const currentTransport = progress.transport || {};
    const { state, updated } = ensureTransportState(currentTransport, options);
    progress.transport = state;
    return {
        updated,
        transport: progress.transport
    };
}

export function ensureGoldenMineStructures(progress = {}, options = {}) {
    const inventoryResult = ensureGoldenMineInventories(progress);
    const transportResult = ensureGoldenMineTransport(progress, options);
    return {
        updated: inventoryResult.updated || transportResult.updated,
        transportUpdated: transportResult.updated,
        mineInventoryUpdated: inventoryResult.mineUpdated,
        factoryInventoryUpdated: inventoryResult.factoryUpdated,
        mineInventory: inventoryResult.mineInventory,
        factoryInventory: inventoryResult.factoryInventory,
        transport: transportResult.transport
    };
}

export function calculateOreSaleValue(oreType, amount = 0) {
    const config = ORE_TYPE_CONFIG[oreType];
    if (!config) {
        return 0;
    }
    const coins = Math.floor(normalizeInteger(amount) / config.oreToCoinRatio);
    return Math.max(0, coins);
}

function validateOreType(oreType) {
    if (!GOLDEN_MINE_ORE_TYPES.includes(oreType)) {
        throw new Error(`Unsupported ore type: ${oreType}`);
    }
}

function getVehicle(progress, vehicleKind) {
    const vehicle = progress?.transport?.vehicles?.[vehicleKind];
    if (!vehicle) {
        throw new Error(`Vehicle ${vehicleKind} is not available`);
    }
    return vehicle;
}

function materializeVehicleCrates(vehicle) {
    return (vehicle?.crates || []).map((crate) => OreCrate.from(crate));
}

function serializeVehicle(vehicle = {}) {
    return {
        ...vehicle,
        departureTime: vehicle.departureTime ? new Date(vehicle.departureTime) : null,
        crates: (vehicle.crates || []).map((crate) => ({
            type: crate.type,
            amount: crate.amount,
            capacity: crate.capacity,
            unlimited: Boolean(crate.unlimited)
        }))
    };
}

function persistVehicleState(progress, vehicleKind, vehicle) {
    if (!progress.transport?.vehicles) {
        return;
    }
    progress.transport.vehicles[vehicleKind] = serializeVehicle(vehicle);
}

function persistVehicleCrates(progress, vehicleKind, crates) {
    if (!progress.transport?.vehicles?.[vehicleKind]) {
        return;
    }
    const nextState = {
        ...progress.transport.vehicles[vehicleKind],
        crates: crates.map((crate) => crate.serialize())
    };
    persistVehicleState(progress, vehicleKind, nextState);
}

export function loadOreIntoVehicleCrate({
    progress,
    vehicleKind = 'truck',
    oreType,
    amount,
    sourceInventoryKey = 'mineInventory',
    transportOptions = {}
} = {}) {
    if (!progress) {
        throw new Error('Golden Mine progress is required');
    }
    validateOreType(oreType);
    const transferableRequest = normalizeInteger(amount);
    if (transferableRequest <= 0) {
        return { transferred: 0, reason: 'INVALID_AMOUNT' };
    }

    ensureGoldenMineStructures(progress, transportOptions);

    const inventoryResult = ensureInventory(progress, sourceInventoryKey);
    const available = inventoryResult.inventory[oreType];
    if (available <= 0) {
        return { transferred: 0, reason: 'NO_SOURCE_ORE' };
    }

    const vehicle = getVehicle(progress, vehicleKind);
    const crates = materializeVehicleCrates(vehicle);
    const targetCrate = crates.find((crate) => crate.type === oreType);
    if (!targetCrate) {
        return { transferred: 0, reason: 'CRATE_NOT_FOUND' };
    }

    const plannedTransfer = Math.min(transferableRequest, available);
    const loaded = targetCrate.load(plannedTransfer, {
        noCrateLimits: Boolean(transportOptions?.noCrateLimits)
    });

    if (loaded <= 0) {
        return { transferred: 0, reason: 'CRATE_FULL' };
    }

    inventoryResult.inventory[oreType] = Math.max(0, available - loaded);
    persistVehicleCrates(progress, vehicleKind, crates);

    return {
        transferred: loaded,
        remainingInventory: inventoryResult.inventory[oreType],
        crate: targetCrate.serialize()
    };
}

export function unloadOreFromVehicleCrate({
    progress,
    vehicleKind = 'truck',
    oreType,
    amount,
    targetInventoryKey = 'factoryInventory'
} = {}) {
    if (!progress) {
        throw new Error('Golden Mine progress is required');
    }
    validateOreType(oreType);
    const requestedAmount = normalizeInteger(amount);

    ensureGoldenMineInventories(progress);
    const inventoryResult = ensureInventory(progress, targetInventoryKey);
    const vehicle = getVehicle(progress, vehicleKind);
    const crates = materializeVehicleCrates(vehicle);
    const targetCrate = crates.find((crate) => crate.type === oreType);
    if (!targetCrate) {
        return { transferred: 0, reason: 'CRATE_NOT_FOUND' };
    }

    const transferable = targetCrate.unload(requestedAmount || targetCrate.amount);
    if (transferable <= 0) {
        return { transferred: 0, reason: 'CRATE_EMPTY' };
    }

    inventoryResult.inventory[oreType] = normalizeInteger(
        (inventoryResult.inventory[oreType] || 0) + transferable
    );
    persistVehicleCrates(progress, vehicleKind, crates);

    return {
        transferred: transferable,
        targetInventory: inventoryResult.inventory,
        crate: targetCrate.serialize()
    };
}

export function summarizeVehicleSaleValue(vehicle) {
    if (!vehicle) {
        return { totalCoins: 0, perOre: {} };
    }
    const summary = { totalCoins: 0, perOre: {} };
    (vehicle.crates || []).forEach((crate) => {
        const amount = normalizeInteger(crate.amount);
        if (amount <= 0) {
            return;
        }
        const coins = calculateOreSaleValue(crate.type, amount);
        if (coins <= 0) {
            return;
        }
        summary.perOre[crate.type] = (summary.perOre[crate.type] || 0) + coins;
        summary.totalCoins += coins;
    });
    return summary;
}

export function summarizeGoldenMineTransport(progress = {}) {
    return summarizeTransportState(progress.transport);
}

export function summarizeGoldenMineInventories(progress = {}) {
    return {
        mineInventory: createEmptyOreInventory(progress?.mineInventory),
        factoryInventory: createEmptyOreInventory(progress?.factoryInventory)
    };
}

function resolveTravelingLocation(destination) {
    if (destination === 'factory') {
        return 'traveling_to_factory';
    }
    if (destination === 'mine') {
        return 'traveling_to_mine';
    }
    throw new Error(`Unsupported travel destination: ${destination}`);
}

function resolveArrivalLocation(location) {
    if (location === 'traveling_to_factory') {
        return 'factory';
    }
    if (location === 'traveling_to_mine') {
        return 'mine';
    }
    return null;
}

export function beginVehicleTravel(progress, vehicleKind, destination, { now = new Date() } = {}) {
    if (!progress) {
        throw new Error('Golden Mine progress is required');
    }
    const vehicle = getVehicle(progress, vehicleKind);
    const travelingLocation = resolveTravelingLocation(destination);
    const requiredOrigin = destination === 'factory' ? 'mine' : 'factory';
    if (vehicle.location !== requiredOrigin) {
        throw new Error(`Vehicle ${vehicleKind} must be at ${requiredOrigin} before traveling`);
    }

    vehicle.location = travelingLocation;
    vehicle.departureTime = new Date(now);
    persistVehicleState(progress, vehicleKind, vehicle);

    return {
        location: vehicle.location,
        departureTime: vehicle.departureTime,
        vehicle
    };
}

export function settleVehicleTravel(progress, vehicleKind, now = new Date()) {
    if (!progress) {
        throw new Error('Golden Mine progress is required');
    }
    const vehicle = getVehicle(progress, vehicleKind);
    const arrival = resolveArrivalLocation(vehicle.location);
    if (!arrival || !vehicle.departureTime) {
        return { updated: false, vehicle, secondsRemaining: 0 };
    }

    const elapsedSeconds = Math.floor((new Date(now) - new Date(vehicle.departureTime)) / 1000);
    const remaining = Math.max(0, (vehicle.travelTimeSeconds || 0) - elapsedSeconds);
    if (remaining > 0) {
        return { updated: false, secondsRemaining: remaining, vehicle };
    }

    vehicle.location = arrival;
    vehicle.departureTime = null;
    persistVehicleState(progress, vehicleKind, vehicle);

    return { updated: true, vehicle, secondsRemaining: 0 };
}

export function settleAllVehicleTravel(progress = {}, now = new Date()) {
    const vehicles = Object.keys(progress?.transport?.vehicles || {});
    let updated = false;
    vehicles.forEach((vehicleKind) => {
        const result = settleVehicleTravel(progress, vehicleKind, now);
        updated = updated || result.updated;
    });
    return { updated };
}
