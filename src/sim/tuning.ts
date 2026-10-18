// Typed, validated access to src/data/tuning.json (TECHNICAL_DESIGN §2.1, §3.2 rule 4, §8). This is the
// only src/sim file allowed to import src/data/*.json (tests/unit/simPurity.test.ts enforces it). The JSON is
// the source of truth for every handling number; GDD §7 mirrors it (CLAUDE.md §2).
//
// The sim never reads DEFAULT_TUNING implicitly: the composition root passes a Tuning object into
// createWorld(level, seed, tuning), so the dev panel (SSP-048) can hand the World an edited copy. loadTuning
// builds a fresh object on every call for the same reason.
//
// Validation is hand-written (no zod, no `any`, CLAUDE.md §5.1): every group must hold exactly its listed
// keys, every value must be a finite number in range, and malformed data throws an Error naming the JSON
// path. Angles are stored in degrees in the JSON and converted to radians here, once.
import tuningJson from '../data/tuning.json' with { type: 'json' };
import { DEG_TO_RAD } from './constants.ts';

/** Range rule for one numeric tuning value. */
type Check =
  /** > 0 */
  | 'positive'
  /** >= 0 */
  | 'nonNegative'
  /** < 0 */
  | 'negative'
  /** (0, 1]: multipliers that only ever slow Bessie down, and keep fractions */
  | 'fraction'
  /** [0, 1] */
  | 'unit';

type GroupSpec = Readonly<Record<string, Check>>;

/** A validated group: one readonly number per key of its spec. */
type Group<S extends GroupSpec> = { readonly [K in keyof S]: number };

// ---------------------------------------------------------------------------------------------------------
// vehicle.sweeper groups, as stored in the JSON. Key names carry their unit (CLAUDE.md §5.1).
// ---------------------------------------------------------------------------------------------------------

/**
 * Body and wheel geometry in vehicle-local metres (+y forward from the body centre). Body and wheelbase are
 * GDD §7.1. wheelTrackM and the axle offsets are PROVISIONAL (SSP-029): the docs give neither, but
 * TECHNICAL_DESIGN §8.2 steps 7 and 9 need the four wheel contact points and the axle midpoints. Track
 * 1.75 m puts the wheels at the body corners (ART_BIBLE §8.1); the axles sit symmetrically at ±1.2 m.
 */
const BODY_SPEC = {
  widthM: 'positive',
  lengthM: 'positive',
  wheelbaseM: 'positive',
  wheelTrackM: 'positive',
  /** Signed vehicle-local y of the front axle midpoint. */
  frontAxleOffsetM: 'positive',
  /** Signed vehicle-local y of the rear axle midpoint (negative: behind the body centre). */
  rearAxleOffsetM: 'negative',
} as const satisfies GroupSpec;

/** GDD §7.1: 4,200 kg empty plus up to 1,500 kg at a full hopper, linear with fill. */
const MASS_SPEC = {
  emptyKg: 'positive',
  fullHopperExtraKg: 'nonNegative',
} as const satisfies GroupSpec;

/** GDD §7.1 engine, brake and top speeds (empty hopper). */
const DRIVE_SPEC = {
  accelMps2: 'positive',
  brakeMps2: 'positive',
  topSpeedBrushDownMps: 'positive',
  topSpeedTransitMps: 'positive',
} as const satisfies GroupSpec;

/**
 * GDD §7.1 and §6.2: reverse engages when brake is held with |vLong| < engageBelowMps for engageHoldS
 * (both marked proposed in GDD §6.2).
 */
const REVERSE_SPEC = {
  maxSpeedMps: 'positive',
  accelMps2: 'positive',
  engageBelowMps: 'positive',
  engageHoldS: 'nonNegative',
} as const satisfies GroupSpec;

/** GDD §7.4: multipliers at 100% hopper fill, lerped linearly from 1 by fill fraction. */
const FULL_HOPPER_SPEC = {
  accelMul: 'fraction',
  topSpeedMul: 'fraction',
  steerRateMul: 'fraction',
} as const satisfies GroupSpec;

/** GDD §7.1 steering, in degrees as stored. Target lock is maxSteer / (1 + |v| / steerFalloffMps). */
const STEERING_SPEC = {
  maxSteerDeg: 'positive',
  steerFalloffMps: 'positive',
  steerRateDegPerS: 'positive',
  returnRateDegPerS: 'positive',
} as const satisfies GroupSpec;

/** GDD §7.1 drag: a = rollingMps2·sign(v) + quadraticPerM·v², rolling part ×grassRollingMul on grass. */
const DRAG_SPEC = {
  rollingMps2: 'nonNegative',
  quadraticPerM: 'nonNegative',
  grassRollingMul: 'positive',
} as const satisfies GroupSpec;

/**
 * GDD §7.3: lateral grip decay rate k in 1/s per surface. rainAsphalt replaces asphalt when it rains
 * (Wednesday, district.gasworks; the switch itself is a later hook).
 */
const LATERAL_GRIP_SPEC = {
  asphalt: 'positive',
  pavement: 'positive',
  grass: 'positive',
  wet: 'positive',
  wetLeaves: 'positive',
  oil: 'positive',
  rainAsphalt: 'positive',
} as const satisfies GroupSpec;

/** GDD §7.1 and §7.3: the front axle crossing a kerb keeps this fraction of vLong (a 30% loss). */
const KERB_SPEC = {
  speedKeepMul: 'fraction',
} as const satisfies GroupSpec;

/** GDD §7.1: damage = damageHpPerMps × max(0, normal impact speed − damageThresholdMps). */
const COLLISION_SPEC = {
  restitution: 'unit',
  damageHpPerMps: 'nonNegative',
  damageThresholdMps: 'nonNegative',
} as const satisfies GroupSpec;

/** GDD §7.1 and §7.2: Bessie's Dignity; the dented variant shows below dentedBelowHp. */
const HEALTH_SPEC = {
  maxHp: 'positive',
  dentedBelowHp: 'nonNegative',
} as const satisfies GroupSpec;

/**
 * GDD §7.1 and TECHNICAL_DESIGN §8.3 brush timings (consumed in M2). Collects only at rpm >= collectMinRpm
 * while lowered. Fling probability rises linearly from 0 at cleanPickupMaxMps to 1 at flingCertainMps.
 */
const BRUSH_SPEC = {
  raiseLowerS: 'positive',
  spinUpS: 'positive',
  collectMinRpm: 'unit',
  cleanPickupMaxMps: 'positive',
  flingCertainMps: 'positive',
} as const satisfies GroupSpec;

/** Every numeric group of vehicle.sweeper, in JSON order. `provisional` is the one non-numeric key. */
const SWEEPER_GROUPS = {
  body: BODY_SPEC,
  mass: MASS_SPEC,
  drive: DRIVE_SPEC,
  reverse: REVERSE_SPEC,
  fullHopper: FULL_HOPPER_SPEC,
  steering: STEERING_SPEC,
  drag: DRAG_SPEC,
  lateralGripPerS: LATERAL_GRIP_SPEC,
  kerb: KERB_SPEC,
  collision: COLLISION_SPEC,
  health: HEALTH_SPEC,
  brush: BRUSH_SPEC,
} as const;

type SweeperGroupName = keyof typeof SWEEPER_GROUPS;

// ---------------------------------------------------------------------------------------------------------
// The typed result. Groups keep their JSON shape except steering, whose degrees become radians.
// ---------------------------------------------------------------------------------------------------------

/** Steering in radians (converted from the JSON's degrees at load). */
export type SteeringTuning = {
  /** Full lock at standstill. */
  readonly maxSteerRad: number;
  /** Lock is scaled by 1 / (1 + |vLong| / steerFalloffMps). */
  readonly steerFalloffMps: number;
  /** Rate δ moves toward the target while steering, before the full-hopper multiplier. */
  readonly steerRateRadPerS: number;
  /** Rate δ returns toward 0 when the input is centred. */
  readonly returnRateRadPerS: number;
};

/** Bessie's handling (veh.sweeper). */
export type SweeperTuning = {
  readonly body: Group<typeof BODY_SPEC>;
  readonly mass: Group<typeof MASS_SPEC>;
  readonly drive: Group<typeof DRIVE_SPEC>;
  readonly reverse: Group<typeof REVERSE_SPEC>;
  readonly fullHopper: Group<typeof FULL_HOPPER_SPEC>;
  readonly steering: SteeringTuning;
  readonly drag: Group<typeof DRAG_SPEC>;
  readonly lateralGripPerS: Group<typeof LATERAL_GRIP_SPEC>;
  readonly kerb: Group<typeof KERB_SPEC>;
  readonly collision: Group<typeof COLLISION_SPEC>;
  readonly health: Group<typeof HEALTH_SPEC>;
  readonly brush: Group<typeof BRUSH_SPEC>;
  /**
   * JSON key paths (relative to vehicle.sweeper, e.g. 'body.wheelTrackM') whose values are provisional and
   * await lead confirmation. Informational: the sim treats them like any other value.
   */
  readonly provisional: readonly string[];
};

/** Everything in src/data/tuning.json, validated. Pass it into the sim explicitly; never import a singleton. */
export type Tuning = {
  readonly vehicle: {
    readonly sweeper: SweeperTuning;
  };
};

// ---------------------------------------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------------------------------------

/** Tolerance for the cross-field geometry check (the JSON holds short decimals). */
const GEOMETRY_EPS_M = 1e-9;

function fail(path: string, message: string): never {
  throw new Error(`tuning: ${path} ${message}`);
}

function describeValue(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  if (typeof value === 'string') return `string ${JSON.stringify(value)}`;
  return `${typeof value} ${String(value)}`;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Narrow `raw` to an object holding exactly `keys`: none missing, none unknown. */
function readObject(raw: unknown, path: string, keys: readonly string[]): Readonly<Record<string, unknown>> {
  if (!isRecord(raw)) fail(path, `must be an object, got ${describeValue(raw)}`);
  for (const key of keys) {
    if (!Object.hasOwn(raw, key)) fail(`${path}.${key}`, 'is missing');
  }
  for (const key of Object.keys(raw)) {
    if (!keys.includes(key)) fail(path, `has unknown key ${JSON.stringify(key)}`);
  }
  return raw;
}

function readNumber(raw: unknown, path: string, check: Check): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    fail(path, `must be a finite number, got ${describeValue(raw)}`);
  }
  switch (check) {
    case 'positive':
      if (!(raw > 0)) fail(path, `must be > 0, got ${raw}`);
      break;
    case 'nonNegative':
      if (!(raw >= 0)) fail(path, `must be >= 0, got ${raw}`);
      break;
    case 'negative':
      if (!(raw < 0)) fail(path, `must be < 0, got ${raw}`);
      break;
    case 'fraction':
      if (!(raw > 0 && raw <= 1)) fail(path, `must be in (0, 1], got ${raw}`);
      break;
    case 'unit':
      if (!(raw >= 0 && raw <= 1)) fail(path, `must be in [0, 1], got ${raw}`);
      break;
  }
  return raw;
}

function readGroup<S extends GroupSpec>(raw: unknown, path: string, spec: S): Group<S> {
  const obj = readObject(raw, path, Object.keys(spec));
  const out: Record<string, number> = {};
  for (const [key, check] of Object.entries(spec)) {
    out[key] = readNumber(obj[key], `${path}.${key}`, check);
  }
  // Every key of S was written above with a validated number.
  return out as Group<S>;
}

function isSweeperGroupName(name: string): name is SweeperGroupName {
  return Object.hasOwn(SWEEPER_GROUPS, name);
}

/** `provisional` must list distinct 'group.key' paths that name numeric values in vehicle.sweeper. */
function readProvisional(raw: unknown, path: string): string[] {
  if (!Array.isArray(raw)) fail(path, `must be an array of strings, got ${describeValue(raw)}`);
  const seen: string[] = [];
  for (let index = 0; index < raw.length; index += 1) {
    const entry: unknown = raw[index];
    const entryPath = `${path}[${index}]`;
    if (typeof entry !== 'string') fail(entryPath, `must be a string, got ${describeValue(entry)}`);
    const [group = '', key = '', ...rest] = entry.split('.');
    const known = rest.length === 0 && isSweeperGroupName(group) && Object.hasOwn(SWEEPER_GROUPS[group], key);
    if (!known) fail(entryPath, `names no numeric value of vehicle.sweeper: ${JSON.stringify(entry)}`);
    if (seen.includes(entry)) fail(entryPath, `repeats ${JSON.stringify(entry)}`);
    seen.push(entry);
  }
  return seen;
}

function readSteering(raw: unknown, path: string): SteeringTuning {
  const deg = readGroup(raw, path, STEERING_SPEC);
  return {
    maxSteerRad: deg.maxSteerDeg * DEG_TO_RAD,
    steerFalloffMps: deg.steerFalloffMps,
    steerRateRadPerS: deg.steerRateDegPerS * DEG_TO_RAD,
    returnRateRadPerS: deg.returnRateDegPerS * DEG_TO_RAD,
  };
}

/** Relations between fields that single-value range checks cannot see. */
function checkSweeperConsistency(t: SweeperTuning, path: string): void {
  const { body, drive, brush, health } = t;
  const axleSpanM = body.frontAxleOffsetM - body.rearAxleOffsetM;
  if (Math.abs(axleSpanM - body.wheelbaseM) > GEOMETRY_EPS_M) {
    fail(
      `${path}.body`,
      `axle offsets span ${axleSpanM} m but wheelbaseM is ${body.wheelbaseM} m (frontAxleOffsetM − rearAxleOffsetM must equal wheelbaseM)`,
    );
  }
  if (body.frontAxleOffsetM > body.lengthM / 2 || -body.rearAxleOffsetM > body.lengthM / 2) {
    fail(`${path}.body`, 'axle offsets must lie within the body length');
  }
  if (drive.topSpeedBrushDownMps > drive.topSpeedTransitMps) {
    fail(`${path}.drive`, 'topSpeedBrushDownMps must not exceed topSpeedTransitMps');
  }
  if (brush.cleanPickupMaxMps >= brush.flingCertainMps) {
    fail(`${path}.brush`, 'cleanPickupMaxMps must be below flingCertainMps (the fling ramp needs a width)');
  }
  if (health.dentedBelowHp > health.maxHp) {
    fail(`${path}.health`, 'dentedBelowHp must not exceed maxHp');
  }
}

function readSweeper(raw: unknown, path: string): SweeperTuning {
  const obj = readObject(raw, path, [...Object.keys(SWEEPER_GROUPS), 'provisional']);
  const g = SWEEPER_GROUPS;
  const sweeper: SweeperTuning = {
    body: readGroup(obj.body, `${path}.body`, g.body),
    mass: readGroup(obj.mass, `${path}.mass`, g.mass),
    drive: readGroup(obj.drive, `${path}.drive`, g.drive),
    reverse: readGroup(obj.reverse, `${path}.reverse`, g.reverse),
    fullHopper: readGroup(obj.fullHopper, `${path}.fullHopper`, g.fullHopper),
    steering: readSteering(obj.steering, `${path}.steering`),
    drag: readGroup(obj.drag, `${path}.drag`, g.drag),
    lateralGripPerS: readGroup(obj.lateralGripPerS, `${path}.lateralGripPerS`, g.lateralGripPerS),
    kerb: readGroup(obj.kerb, `${path}.kerb`, g.kerb),
    collision: readGroup(obj.collision, `${path}.collision`, g.collision),
    health: readGroup(obj.health, `${path}.health`, g.health),
    brush: readGroup(obj.brush, `${path}.brush`, g.brush),
    provisional: readProvisional(obj.provisional, `${path}.provisional`),
  };
  checkSweeperConsistency(sweeper, path);
  return sweeper;
}

/**
 * Validate raw tuning data (the parsed JSON, or an edited copy of it) and return a new typed Tuning object.
 * Throws an Error naming the JSON path on any missing, unknown, mistyped or out-of-range value. Every call
 * builds a fresh object, so callers may hold or hand on their own copy.
 */
export function loadTuning(raw: unknown): Tuning {
  const root = readObject(raw, 'root', ['vehicle']);
  const vehicle = readObject(root.vehicle, 'vehicle', ['sweeper']);
  return { vehicle: { sweeper: readSweeper(vehicle.sweeper, 'vehicle.sweeper') } };
}

/**
 * The committed src/data/tuning.json, validated at module load. The composition root (and tests) pass this
 * into the sim explicitly; sim code must take a Tuning parameter instead of importing this.
 */
export const DEFAULT_TUNING: Tuning = loadTuning(tuningJson);
