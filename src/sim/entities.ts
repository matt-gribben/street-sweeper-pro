// Typed, validated access to src/data/entities.json (SSP-053; shape in ENTITY_CATALOG §15). Since this commit
// the JSON is the source of truth for entity IDs and per-entity numbers, and ENTITY_CATALOG.md mirrors it
// (CLAUDE.md §2, kept in sync by tests/unit/entityCatalog.test.ts).
//
// This file holds the types, the canonical ID lists and the guards. It does not import the JSON: only
// src/sim/tuning.ts may import src/data/ (TECHNICAL_DESIGN §2.1), so tuning.ts loads entities.json through
// loadEntities and re-exports this module. Sim code takes an Entities parameter, like Tuning.
//
// Validation is hand-written (no zod, no `any`, CLAUDE.md §5.1). Every entity must hold exactly the fields of
// its class: a missing required field throws an Error naming the ID and field, never a default (ENTITY_CATALOG
// §15). `sprite` is checked for shape here; that it names a real AssetId of src/gen/assets.ts is proven by a
// unit test, because the sim may import that module for types only.
import type { AssetId } from '../gen/assets.ts';
import { DEG_TO_RAD } from './constants.ts';
import { describeValue, isRecord } from './dataGuards.ts';

// ---------------------------------------------------------------------------------------------------------
// Canonical ID lists (ENTITY_CATALOG §1.2, §1.4, §2). Arrays, not object keys, give every loop a fixed order.
// ---------------------------------------------------------------------------------------------------------

/** The eight districts in week order, Yard last (ENTITY_CATALOG §1.2). */
export const DISTRICT_IDS = [
  'district.puddle_lane',
  'district.high_street',
  'district.gasworks',
  'district.conker_hill',
  'district.promenade',
  'district.kebab_mile',
  'district.civic_quarter',
  'district.depot_yard',
] as const;
export type DistrictId = (typeof DISTRICT_IDS)[number];

/** Milestones an entity's behaviour can be delivered in (ROADMAP; LEVEL_DESIGN §10.3 L007). */
export const MILESTONES = ['M0', 'M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8', 'M9'] as const;
export type Milestone = (typeof MILESTONES)[number];

/**
 * The canonical SFX IDs, without the `sfx.` prefix (ENTITY_CATALOG §1.4, AUDIO_DESIGN). Until the audio
 * sources arrive in M5 this list is what `sfx` values are validated against.
 */
export const SFX_IDS = [
  'pickup_small',
  'pickup_big',
  'pickup_glass',
  'fling',
  'hopper_full',
  'dump',
  'brush_lower',
  'brush_raise',
  'horn',
  'bump_wall',
  'bump_kerb',
  'crash',
  'police_whoop',
  'ice_cream_chime',
  'cone_knock',
  'bin_knock',
  'splash',
  'cat_yowl',
  'dog_bark',
  'pigeon_flap',
  'seagull_squawk',
  'ped_oi',
  'granny_harrumph',
  'kid_waah',
  'complaint_stamp',
  'combo_tier',
  'powerup',
  'coin',
  'timer_warn',
  'ui_move',
  'ui_select',
  'ui_back',
] as const;
export type SfxId = (typeof SFX_IDS)[number];

/** Hazard IDs (ENTITY_CATALOG §2, §10): rules may create them. Their own entries arrive in M3 (SSP-075). */
export const HAZARD_IDS = [
  'haz.oil_slick',
  'haz.puddle',
  'haz.pothole',
  'haz.speed_bump',
  'haz.wet_leaves',
  'haz.broken_glass',
  'haz.open_manhole',
  'haz.wind_gust',
] as const;
export type HazardId = (typeof HAZARD_IDS)[number];

/** Every litter.* ID, in ENTITY_CATALOG §4.1 order. The index is the LitterField `kind`. */
export const LITTER_IDS = [
  'litter.crisp_packet',
  'litter.drink_can',
  'litter.plastic_bottle',
  'litter.glass_bottle',
  'litter.newspaper',
  'litter.cigarette_butts',
  'litter.banana_skin',
  'litter.chip_wrapper',
  'litter.pizza_box',
  'litter.kebab_wrapper',
  'litter.leaf_pile',
  'litter.dog_mess',
  'litter.bin_bag',
  'litter.lolly_stick',
  'litter.spilled_shopping',
] as const;
export type LitterId = (typeof LITTER_IDS)[number];

/** Every stain.* ID, in ENTITY_CATALOG §5 order. */
export const STAIN_IDS = [
  'stain.gum',
  'stain.milkshake',
  'stain.oil',
  'stain.chalk_art',
  'stain.splat',
] as const;
export type StainId = (typeof STAIN_IDS)[number];

/** The power-ups entities.json holds so far: Puddle Lane's (the other five arrive with SSP-075). */
export const POWERUP_IDS = ['pwr.flask_of_tea'] as const;
export type PowerupId = (typeof POWERUP_IDS)[number];

/** The collectibles entities.json holds so far: Puddle Lane's (the rest arrive in M4/M6). */
export const COLLECTIBLE_IDS = ['collect.false_teeth', 'collect.golden_crisp'] as const;
export type CollectibleId = (typeof COLLECTIBLE_IDS)[number];

/** Every key of entities.json, in file order. The file must hold exactly these. */
export const ENTITY_IDS = [...LITTER_IDS, ...STAIN_IDS, ...POWERUP_IDS, ...COLLECTIBLE_IDS] as const;
export type EntityId = (typeof ENTITY_IDS)[number];

// ---------------------------------------------------------------------------------------------------------
// The typed result
// ---------------------------------------------------------------------------------------------------------

/** Fields every entity has. */
type EntityBase = {
  readonly id: EntityId;
  /** Display name, British English. */
  readonly name: string;
  /** The asset whose frames draw it (an AssetId of src/gen/assets.ts; proven by tests/unit/entityCatalog). */
  readonly sprite: AssetId;
  /** Membership: the districts it may appear in, in week order (levels hold weights; LEVEL_DESIGN L005). */
  readonly districts: readonly DistrictId[];
  /** The milestone that delivers its behaviour (LEVEL_DESIGN L007). */
  readonly milestone: Milestone;
};

/** What driving over an item with the brush up does (ENTITY_CATALOG §4.2). */
export type BrushUpRule =
  /** Bessie spins by turnRad (banana skin: 180°, stored in degrees in the JSON). */
  | { readonly effect: 'spinOut'; readonly turnRad: number }
  /** The item becomes a hazard where it lay (leaf pile → haz.wet_leaves). */
  | { readonly effect: 'hazard'; readonly hazard: HazardId }
  /** The item becomes a stain and costs pts (dog mess → stain.splat, −20). */
  | { readonly effect: 'stain'; readonly stain: StainId; readonly pts: number };

/** Litter behaviours (ENTITY_CATALOG §4.2). Absent keys mean the item has no such behaviour. */
export type LitterRules = {
  readonly brushUp?: BrushUpRule;
  /** A flung item becomes a hazard where it lands (glass bottle → haz.broken_glass). */
  readonly flung?: { readonly effect: 'hazard'; readonly hazard: HazardId };
  /** Hit above minSpeedMps, the item bursts into `items` small items (bin bag: 4 m/s, 6). */
  readonly burst?: { readonly minSpeedMps: number; readonly items: number };
  /** During a haz.wind_gust the item moves at speedMps for durationS. */
  readonly drift?: { readonly speedMps: number; readonly durationS: number };
};

export type LitterEntity = EntityBase & {
  readonly class: 'litter';
  /** Points before the combo multiplier. */
  readonly pts: number;
  /** Litter units of hopper it fills. */
  readonly lu: number;
  readonly sfx: { readonly pickup: SfxId };
  readonly rules: LitterRules;
};

/** Stain behaviours (ENTITY_CATALOG §5). Absent keys mean the stain has no such behaviour. */
export type StainRules = {
  /** The stain shares its tile with this hazard; spraying the hazard cleans it (oil). */
  readonly pairedHazard?: HazardId;
  /** Cleaning it while its owner is present costs pts and complaints instead (chalk art and its kid). */
  readonly cleanWhileOwnerPresent?: { readonly pts: number; readonly complaints: number };
};

export type StainEntity = EntityBase & {
  readonly class: 'stain';
  /** Points for spraying it clean, before the combo multiplier. */
  readonly pts: number;
  /** Seconds of spray it takes to clean. */
  readonly sprayS: number;
  readonly rules: StainRules;
};

/** A power-up effect (ENTITY_CATALOG §12). Only the flask's exists so far. */
export type PowerupEffect = {
  /** Multiplies the combo chain timer by `mul` for durationS. */
  readonly kind: 'chainTimerMul';
  readonly mul: number;
  readonly durationS: number;
};

export type PowerupEntity = EntityBase & {
  readonly class: 'pwr';
  readonly effect: PowerupEffect;
  readonly sfx: { readonly pickup: SfxId };
};

export const COLLECTIBLE_KINDS = ['lostProperty', 'goldenCrisp'] as const;
export type CollectibleKind = (typeof COLLECTIBLE_KINDS)[number];

export type CollectibleEntity = EntityBase & {
  readonly class: 'collect';
  readonly kind: CollectibleKind;
  /** Bonus points (not multiplied by the combo). */
  readonly pts: number;
  readonly sfx: { readonly pickup: SfxId };
};

/** Everything in src/data/entities.json, validated, grouped by class and keyed by ID. */
export type Entities = {
  readonly litter: { readonly [K in LitterId]: LitterEntity };
  readonly stains: { readonly [K in StainId]: StainEntity };
  readonly powerups: { readonly [K in PowerupId]: PowerupEntity };
  readonly collectibles: { readonly [K in CollectibleId]: CollectibleEntity };
};

// ---------------------------------------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------------------------------------

type Obj = Readonly<Record<string, unknown>>;

function fail(path: string, message: string): never {
  throw new Error(`entities: ${path} ${message}`);
}

/** Narrow `raw` to an object holding all of `required`, optionally `optional`, and nothing else. */
function readObject(
  raw: unknown,
  path: string,
  required: readonly string[],
  optional: readonly string[] = [],
): Obj {
  if (!isRecord(raw)) fail(path, `must be an object, got ${describeValue(raw)}`);
  for (const key of required) {
    if (!Object.hasOwn(raw, key)) fail(path === 'root' ? key : `${path}.${key}`, 'is missing');
  }
  for (const key of Object.keys(raw)) {
    if (!required.includes(key) && !optional.includes(key)) {
      fail(path, `has unknown key ${JSON.stringify(key)}`);
    }
  }
  return raw;
}

type NumberCheck = 'positive' | 'positiveInteger' | 'nonNegativeInteger' | 'negativeInteger';

function readNumber(raw: unknown, path: string, check: NumberCheck): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    fail(path, `must be a finite number, got ${describeValue(raw)}`);
  }
  const integer = Number.isInteger(raw);
  switch (check) {
    case 'positive':
      if (!(raw > 0)) fail(path, `must be > 0, got ${raw}`);
      break;
    case 'positiveInteger':
      if (!(integer && raw >= 1)) fail(path, `must be an integer >= 1, got ${raw}`);
      break;
    case 'nonNegativeInteger':
      if (!(integer && raw >= 0)) fail(path, `must be an integer >= 0, got ${raw}`);
      break;
    case 'negativeInteger':
      if (!(integer && raw < 0)) fail(path, `must be a negative integer, got ${raw}`);
      break;
  }
  return raw;
}

function readString(raw: unknown, path: string): string {
  if (typeof raw !== 'string' || raw.length === 0)
    fail(path, `must be a non-empty string, got ${describeValue(raw)}`);
  return raw;
}

/** `raw` must be one of `allowed`; returns it narrowed. */
function readOneOf<T extends string>(raw: unknown, path: string, allowed: readonly T[], what: string): T {
  const found = allowed.find((value) => value === raw);
  if (found === undefined) fail(path, `must be ${what}, got ${describeValue(raw)}`);
  return found;
}

const ASSET_ID_SHAPE = /^[a-z]+\.[a-z0-9_]+$/;

function readSprite(raw: unknown, path: string): AssetId {
  const sprite = readString(raw, path);
  if (!ASSET_ID_SHAPE.test(sprite))
    fail(path, `must look like an asset ID (<class>.<snake_name>), got "${sprite}"`);
  // Shape-checked only: the sim cannot import src/gen/assets.ts at runtime (TECHNICAL_DESIGN §2.1), so
  // tests/unit/entityCatalog.test.ts proves every sprite is a member of AssetId.
  return sprite as AssetId;
}

/** A non-empty list of distinct district IDs in week order (DISTRICT_IDS order). */
function readDistricts(raw: unknown, path: string): DistrictId[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    fail(path, `must be a non-empty array of district IDs, got ${describeValue(raw)}`);
  }
  const out: DistrictId[] = [];
  let lastIndex = -1;
  for (let index = 0; index < raw.length; index += 1) {
    const entryPath = `${path}[${index}]`;
    const district = readOneOf(raw[index], entryPath, DISTRICT_IDS, 'a canonical district ID');
    const order = DISTRICT_IDS.indexOf(district);
    if (order <= lastIndex) fail(entryPath, `"${district}" repeats or is out of week order`);
    lastIndex = order;
    out.push(district);
  }
  return out;
}

function readPickupSfx(raw: unknown, path: string): { readonly pickup: SfxId } {
  const obj = readObject(raw, path, ['pickup']);
  return {
    pickup: readOneOf(obj.pickup, `${path}.pickup`, SFX_IDS, 'a canonical SFX ID (ENTITY_CATALOG §1.4)'),
  };
}

/** The fields every class shares, read from an entity object already checked for its key set. */
function readBase(obj: Obj, id: EntityId): EntityBase {
  return {
    id,
    name: readString(obj.name, `${id}.name`),
    sprite: readSprite(obj.sprite, `${id}.sprite`),
    districts: readDistricts(obj.districts, `${id}.districts`),
    milestone: readOneOf(obj.milestone, `${id}.milestone`, MILESTONES, 'a milestone M0..M9'),
  };
}

const BASE_KEYS = ['class', 'name', 'sprite', 'districts', 'milestone'] as const;

/** `class` must match the ID's prefix. */
function checkClass(obj: Obj, id: EntityId, expected: string): void {
  if (obj.class !== expected) fail(`${id}.class`, `must be "${expected}", got ${describeValue(obj.class)}`);
}

function readBrushUp(raw: unknown, path: string): BrushUpRule {
  if (!isRecord(raw)) fail(path, `must be an object, got ${describeValue(raw)}`);
  const effect = raw.effect;
  if (effect === 'spinOut') {
    const obj = readObject(raw, path, ['effect', 'turnDeg']);
    return { effect, turnRad: readNumber(obj.turnDeg, `${path}.turnDeg`, 'positive') * DEG_TO_RAD };
  }
  if (effect === 'hazard') {
    const obj = readObject(raw, path, ['effect', 'hazard']);
    return { effect, hazard: readOneOf(obj.hazard, `${path}.hazard`, HAZARD_IDS, 'a canonical haz.* ID') };
  }
  if (effect === 'stain') {
    const obj = readObject(raw, path, ['effect', 'stain', 'pts']);
    return {
      effect,
      stain: readOneOf(obj.stain, `${path}.stain`, STAIN_IDS, 'a canonical stain.* ID'),
      pts: readNumber(obj.pts, `${path}.pts`, 'negativeInteger'),
    };
  }
  return fail(`${path}.effect`, `must be "spinOut", "hazard" or "stain", got ${describeValue(effect)}`);
}

function readLitterRules(raw: unknown, path: string): LitterRules {
  const obj = readObject(raw, path, [], ['brushUp', 'flung', 'burst', 'drift']);
  const rules: {
    brushUp?: BrushUpRule;
    flung?: NonNullable<LitterRules['flung']>;
    burst?: NonNullable<LitterRules['burst']>;
    drift?: NonNullable<LitterRules['drift']>;
  } = {};
  if (obj.brushUp !== undefined) rules.brushUp = readBrushUp(obj.brushUp, `${path}.brushUp`);
  if (obj.flung !== undefined) {
    const flung = readObject(obj.flung, `${path}.flung`, ['effect', 'hazard']);
    rules.flung = {
      effect: readOneOf(flung.effect, `${path}.flung.effect`, ['hazard'] as const, '"hazard"'),
      hazard: readOneOf(flung.hazard, `${path}.flung.hazard`, HAZARD_IDS, 'a canonical haz.* ID'),
    };
  }
  if (obj.burst !== undefined) {
    const burst = readObject(obj.burst, `${path}.burst`, ['minSpeedMps', 'items']);
    rules.burst = {
      minSpeedMps: readNumber(burst.minSpeedMps, `${path}.burst.minSpeedMps`, 'positive'),
      items: readNumber(burst.items, `${path}.burst.items`, 'positiveInteger'),
    };
  }
  if (obj.drift !== undefined) {
    const drift = readObject(obj.drift, `${path}.drift`, ['speedMps', 'durationS']);
    rules.drift = {
      speedMps: readNumber(drift.speedMps, `${path}.drift.speedMps`, 'positive'),
      durationS: readNumber(drift.durationS, `${path}.drift.durationS`, 'positive'),
    };
  }
  return rules;
}

function readLitter(raw: unknown, id: LitterId): LitterEntity {
  const obj = readObject(raw, id, [...BASE_KEYS, 'pts', 'lu', 'sfx', 'rules']);
  checkClass(obj, id, 'litter');
  return {
    ...readBase(obj, id),
    class: 'litter',
    pts: readNumber(obj.pts, `${id}.pts`, 'nonNegativeInteger'),
    lu: readNumber(obj.lu, `${id}.lu`, 'positive'),
    sfx: readPickupSfx(obj.sfx, `${id}.sfx`),
    rules: readLitterRules(obj.rules, `${id}.rules`),
  };
}

function readStainRules(raw: unknown, path: string): StainRules {
  const obj = readObject(raw, path, [], ['pairedHazard', 'cleanWhileOwnerPresent']);
  const rules: {
    pairedHazard?: HazardId;
    cleanWhileOwnerPresent?: NonNullable<StainRules['cleanWhileOwnerPresent']>;
  } = {};
  if (obj.pairedHazard !== undefined) {
    rules.pairedHazard = readOneOf(
      obj.pairedHazard,
      `${path}.pairedHazard`,
      HAZARD_IDS,
      'a canonical haz.* ID',
    );
  }
  if (obj.cleanWhileOwnerPresent !== undefined) {
    const p = `${path}.cleanWhileOwnerPresent`;
    const penalty = readObject(obj.cleanWhileOwnerPresent, p, ['pts', 'complaints']);
    rules.cleanWhileOwnerPresent = {
      pts: readNumber(penalty.pts, `${p}.pts`, 'negativeInteger'),
      complaints: readNumber(penalty.complaints, `${p}.complaints`, 'positiveInteger'),
    };
  }
  return rules;
}

function readStain(raw: unknown, id: StainId): StainEntity {
  const obj = readObject(raw, id, [...BASE_KEYS, 'pts', 'sprayS', 'rules']);
  checkClass(obj, id, 'stain');
  return {
    ...readBase(obj, id),
    class: 'stain',
    pts: readNumber(obj.pts, `${id}.pts`, 'nonNegativeInteger'),
    sprayS: readNumber(obj.sprayS, `${id}.sprayS`, 'positive'),
    rules: readStainRules(obj.rules, `${id}.rules`),
  };
}

function readPowerup(raw: unknown, id: PowerupId): PowerupEntity {
  const obj = readObject(raw, id, [...BASE_KEYS, 'effect', 'sfx']);
  checkClass(obj, id, 'pwr');
  const effect = readObject(obj.effect, `${id}.effect`, ['kind', 'mul', 'durationS']);
  return {
    ...readBase(obj, id),
    class: 'pwr',
    effect: {
      kind: readOneOf(effect.kind, `${id}.effect.kind`, ['chainTimerMul'] as const, '"chainTimerMul"'),
      mul: readNumber(effect.mul, `${id}.effect.mul`, 'positive'),
      durationS: readNumber(effect.durationS, `${id}.effect.durationS`, 'positive'),
    },
    sfx: readPickupSfx(obj.sfx, `${id}.sfx`),
  };
}

function readCollectible(raw: unknown, id: CollectibleId): CollectibleEntity {
  const obj = readObject(raw, id, [...BASE_KEYS, 'kind', 'pts', 'sfx']);
  checkClass(obj, id, 'collect');
  return {
    ...readBase(obj, id),
    class: 'collect',
    kind: readOneOf(obj.kind, `${id}.kind`, COLLECTIBLE_KINDS, '"lostProperty" or "goldenCrisp"'),
    pts: readNumber(obj.pts, `${id}.pts`, 'positiveInteger'),
    sfx: readPickupSfx(obj.sfx, `${id}.sfx`),
  };
}

/**
 * Validate raw entity data (the parsed entities.json, or an edited copy) and return a new typed Entities
 * object. The root must hold exactly ENTITY_IDS. Throws an Error naming the ID and field on any missing,
 * unknown, mistyped or out-of-range value. Load-time code: allocates.
 */
export function loadEntities(raw: unknown): Entities {
  const root = readObject(raw, 'root', ENTITY_IDS);
  const litter: Partial<Record<LitterId, LitterEntity>> = {};
  for (const id of LITTER_IDS) litter[id] = readLitter(root[id], id);
  const stains: Partial<Record<StainId, StainEntity>> = {};
  for (const id of STAIN_IDS) stains[id] = readStain(root[id], id);
  const powerups: Partial<Record<PowerupId, PowerupEntity>> = {};
  for (const id of POWERUP_IDS) powerups[id] = readPowerup(root[id], id);
  const collectibles: Partial<Record<CollectibleId, CollectibleEntity>> = {};
  for (const id of COLLECTIBLE_IDS) collectibles[id] = readCollectible(root[id], id);
  // Every ID of each list was written just above (readObject proved none is missing or unknown).
  return {
    litter: litter as Entities['litter'],
    stains: stains as Entities['stains'],
    powerups: powerups as Entities['powerups'],
    collectibles: collectibles as Entities['collectibles'],
  };
}
