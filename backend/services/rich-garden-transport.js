import { createFruitCrateSet, serializeFruitCrateSet, TreeCrate } from './rich-garden-inventory.js';

const FAST_MODE = process.env.FAST_MODE === 'true';
const ONE_HOUR = 60 * 60;
const FIVE_MINUTES = 5 * 60;

const DEFAULT_TRAVEL_SECONDS = {
    truck: FAST_MODE ? 10 : ONE_HOUR,
    helicopter: FAST_MODE ? 3 : FIVE_MINUTES
};

const VEHICLE_PRESETS = {
    truck: {
        key: 'truck',
        label: 'Farm Truck',
        fruitMultiplier: 1,
        treeCapacity: 5,
        travelSeconds: DEFAULT_TRAVEL_SECONDS.truck
    },
    helicopter: {
        key: 'helicopter',
        label: 'Cargo Helicopter',
        fruitMultiplier: 5,
        treeCapacity: 25,
        travelSeconds: DEFAULT_TRAVEL_SECONDS.helicopter
    }
};

const LOCATION = {
    farm: 'farm',
    city: 'city',
    toCity: 'traveling_to_city',
    toFarm: 'traveling_to_farm'
};

function clampSeconds(value, fallback) {
    if (!Number.isFinite(value) || value <= 0) {
        return fallback;
    }
    return Math.floor(value);
}

function normalizeLocation(value) {
    if (value === LOCATION.city || value === LOCATION.farm) {
        return value;
    }
    if (value === LOCATION.toCity || value === LOCATION.toFarm) {
        return value;
    }
    return LOCATION.farm;
}

function destinationForTravel(location) {
    if (location === LOCATION.toCity) {
        return LOCATION.city;
    }
    if (location === LOCATION.toFarm) {
        return LOCATION.farm;
    }
    return null;
}

function buildVehicleOptions(mode, data = {}, overrides = {}) {
    const preset = VEHICLE_PRESETS[mode];
    if (!preset) {
        throw new Error(`Unknown transport mode: ${mode}`);
    }

    const scopedOverrides = overrides[mode] || {};

    return {
        mode,
        label: preset.label,
        location: normalizeLocation(data.location ?? preset.location ?? LOCATION.farm),
        departureTime: data.departureTime ? new Date(data.departureTime) : null,
        destination: data.destination || destinationForTravel(data.location),
        travelSeconds: clampSeconds(scopedOverrides.travelSeconds ?? data.travelSeconds ?? preset.travelSeconds, preset.travelSeconds),
        fruitMultiplier: scopedOverrides.fruitMultiplier ?? data.fruitMultiplier ?? preset.fruitMultiplier,
        treeCapacity: clampSeconds(scopedOverrides.treeCapacity ?? data.treeCapacity ?? preset.treeCapacity, preset.treeCapacity),
        unlimitedFruit: Boolean(scopedOverrides.unlimitedFruit ?? data.unlimitedFruit ?? false),
        unlimitedTree: Boolean(scopedOverrides.unlimitedTree ?? data.unlimitedTree ?? false),
        fruitCrateData: data.fruitCrates || {},
        treeCrateData: data.treeCrate || {}
    };
}

class TransportVehicle {
    constructor(options = {}) {
        if (!options.mode) {
            throw new Error('TransportVehicle requires a mode');
        }
        this.mode = options.mode;
        this.label = options.label || options.mode;
        this.travelSeconds = clampSeconds(options.travelSeconds, ONE_HOUR);
        this.location = normalizeLocation(options.location || LOCATION.farm);
        this.destination = options.destination || null;
        this.departureTime = options.departureTime ? new Date(options.departureTime) : null;
        this.fruitMultiplier = Number.isFinite(options.fruitMultiplier) ? options.fruitMultiplier : 1;
        this.treeCapacity = clampSeconds(options.treeCapacity, 5);
        this.unlimitedFruit = Boolean(options.unlimitedFruit);
        this.unlimitedTree = Boolean(options.unlimitedTree);

        this.fruitCrates = createFruitCrateSet(options.fruitCrateData, {
            multiplier: this.fruitMultiplier,
            unlimited: this.unlimitedFruit
        });

        this.treeCrate = new TreeCrate({
            capacity: this.treeCapacity,
            queued: options.treeCrateData?.queued,
            unlimited: this.unlimitedTree || options.treeCrateData?.unlimited
        });
    }

    isTraveling() {
        return this.location === LOCATION.toCity || this.location === LOCATION.toFarm;
    }

    beginTravel(targetLocation, now = new Date()) {
        if (targetLocation !== LOCATION.city && targetLocation !== LOCATION.farm) {
            throw new Error('Target location must be farm or city');
        }
        if (this.isTraveling()) {
            return false;
        }
        if (targetLocation === this.location) {
            return false;
        }
        this.destination = targetLocation;
        this.location = targetLocation === LOCATION.city ? LOCATION.toCity : LOCATION.toFarm;
        this.departureTime = new Date(now);
        return true;
    }

    getSecondsRemaining(now = new Date()) {
        if (!this.isTraveling() || !this.departureTime) {
            return 0;
        }
        const elapsed = Math.floor((now - this.departureTime) / 1000);
        return Math.max(0, this.travelSeconds - elapsed);
    }

    updateTravel(now = new Date()) {
        if (!this.isTraveling()) {
            return false;
        }
        if (this.getSecondsRemaining(now) > 0) {
            return false;
        }
        const target = this.destination || destinationForTravel(this.location) || LOCATION.farm;
        this.location = target;
        this.destination = null;
        this.departureTime = null;
        return true;
    }

    getTravelSummary(now = new Date()) {
        return {
            location: this.location,
            isTraveling: this.isTraveling(),
            secondsRemaining: this.getSecondsRemaining(now),
            travelSeconds: this.travelSeconds,
            departureTime: this.departureTime ? this.departureTime.toISOString() : null,
            destination: this.destination
        };
    }

    toJSON() {
        return {
            mode: this.mode,
            label: this.label,
            location: this.location,
            destination: this.destination,
            departureTime: this.departureTime ? this.departureTime.toISOString() : null,
            travelSeconds: this.travelSeconds,
            fruitMultiplier: this.fruitMultiplier,
            treeCapacity: this.treeCapacity,
            unlimitedFruit: this.unlimitedFruit,
            unlimitedTree: this.unlimitedTree,
            fruitCrates: serializeFruitCrateSet(this.fruitCrates),
            treeCrate: this.treeCrate.toJSON()
        };
    }
}

class TruckVehicle extends TransportVehicle {
    constructor(data = {}, overrides = {}) {
        super(buildVehicleOptions('truck', data, overrides));
    }
}

class HelicopterVehicle extends TransportVehicle {
    constructor(data = {}, overrides = {}) {
        super(buildVehicleOptions('helicopter', data, overrides));
    }
}

export function createTransportVehicle(mode = 'truck', data = {}, overrides = {}) {
    if (mode === 'helicopter') {
        return new HelicopterVehicle(data, overrides);
    }
    return new TruckVehicle(data, overrides);
}

export class TransportFleet {
    constructor(state = {}, overrides = {}) {
        this.truck = createTransportVehicle('truck', state.truck || {}, overrides);
        const enableHelicopter = Boolean(state.helicopter || overrides.enableHelicopter);
        this.helicopter = enableHelicopter
            ? createTransportVehicle('helicopter', state.helicopter || {}, overrides)
            : null;
        this.activeMode = this.helicopter && state.activeMode === 'helicopter' ? 'helicopter' : 'truck';
    }

    hasHelicopter() {
        return Boolean(this.helicopter);
    }

    setActiveMode(mode) {
        if (mode === 'helicopter' && !this.helicopter) {
            throw new Error('Helicopter not unlocked');
        }
        if (mode !== 'truck' && mode !== 'helicopter') {
            throw new Error('Unknown transport mode');
        }
        this.activeMode = mode === 'helicopter' && this.helicopter ? 'helicopter' : 'truck';
    }

    getActiveVehicle() {
        if (this.activeMode === 'helicopter' && this.helicopter) {
            return this.helicopter;
        }
        return this.truck;
    }

    updateTravel(now = new Date()) {
        let modified = false;
        modified = this.truck.updateTravel(now) || modified;
        if (this.helicopter) {
            modified = this.helicopter.updateTravel(now) || modified;
        }
        return modified;
    }

    beginTravel(targetLocation, now = new Date()) {
        return this.getActiveVehicle().beginTravel(targetLocation, now);
    }

    getTravelSummary(now = new Date()) {
        return {
            activeMode: this.activeMode,
            truck: this.truck.getTravelSummary(now),
            helicopter: this.helicopter ? this.helicopter.getTravelSummary(now) : null
        };
    }

    toJSON() {
        return {
            activeMode: this.activeMode,
            truck: this.truck.toJSON(),
            helicopter: this.helicopter ? this.helicopter.toJSON() : null
        };
    }
}

export {
    LOCATION,
    VEHICLE_PRESETS,
    DEFAULT_TRAVEL_SECONDS
};
