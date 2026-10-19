// Typed, validated access to src/data/entities.json (SSP-053, SSP-075; shape in ENTITY_CATALOG §15). The JSON
// is the source of truth for entity IDs and per-entity numbers, and ENTITY_CATALOG.md mirrors it (CLAUDE.md §2,
// kept in sync by tests/unit/entityCatalog.test.ts). SSP-053 seeded litter, stains and Puddle Lane's pickups;
// SSP-075 froze the Mon–Tue (M3) set: people, animals, traffic and parked cars, props, hazards, sites and every
// power-up (ROADMAP M3 entity-scope table).
//
// This file holds the types, the canonical ID lists and the guards. It does not import the JSON: only
// src/sim/tuning.ts may import src/data/ (TECHNICAL_DESIGN §2.1), so tuning.ts loads entities.json through
// loadEntities and re-exports this module. Sim code takes an Entities parameter, like Tuning.
//
// Validation is hand-written (no zod, no `any`, CLAUDE.md §5.1). Every entity must hold exactly the fields of
// its class, and every behaviour number its ID's rule spec lists: a missing required field throws an Error
// naming the ID and field, never a default (ENTITY_CATALOG §15). `sprite` is checked for shape here; that it
// names a real AssetId of src/gen/assets.ts is proven by a unit test, because the sim may import that module
// for types only.
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

/**
 * Every canonical hazard ID (ENTITY_CATALOG §2, §10): litter and stain rules may name any of them. Only the
 * seven Mon–Tue hazards have entries (HAZARD_ENTITY_IDS); haz.wind_gust arrives with weather in M6.
 */
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

/**
 * The Mon–Tue people (ENTITY_CATALOG §6.1 order) and animals (§7.1 order). The walker's dog is a child actor
 * of npc.dog_walker that reuses the npc.dog_loose grid, not an entity of its own (ROADMAP M3).
 */
export const NPC_IDS = [
  'npc.shopper',
  'npc.old_woman',
  'npc.old_man_frame',
  'npc.dog_walker',
  'npc.litterbug',
  'npc.businessman',
  'npc.mum_pushchair',
  'npc.postie',
  'npc.market_trader',
  'npc.cat',
  'npc.pigeon',
] as const;
export type NpcId = (typeof NPC_IDS)[number];

/** The Mon–Tue traffic (ENTITY_CATALOG §8.2 order), then the four parked variants (§8.2 note order). */
export const VEHICLE_IDS = [
  'veh.hatchback',
  'veh.saloon',
  'veh.taxi',
  'veh.van_white',
  'veh.bus',
  'veh.bicycle',
  'veh.mobility_scooter',
  'veh.hatchback_parked',
  'veh.saloon_parked',
  'veh.taxi_parked',
  'veh.van_white_parked',
] as const;
export type VehicleId = (typeof VEHICLE_IDS)[number];

/** The knockable props (ENTITY_CATALOG §9.1): impulse bodies in src/sim/bodies.ts. */
export const KNOCKABLE_IDS = [
  'prop.wheelie_bin',
  'prop.traffic_cone',
  'prop.a_board',
  'prop.shopping_trolley',
  'prop.recycling_box',
] as const;
export type KnockableId = (typeof KNOCKABLE_IDS)[number];

/**
 * The static props that block Bessie (TECHNICAL_DESIGN §9.1, ENTITY_CATALOG §9.2), in catalog order.
 * tuning.json `propFootprints.shapes` must hold exactly these ids.
 */
export const STATIC_PROP_IDS = [
  'prop.lamp_post',
  'prop.bollard',
  'prop.bench',
  'prop.bus_shelter',
  'prop.phone_box',
  'prop.post_box',
  'prop.hydrant',
  'prop.tree',
  'prop.planter',
  'prop.market_stall',
  'prop.litter_bin',
  'prop.roadworks_barrier',
] as const;
export type StaticPropId = (typeof STATIC_PROP_IDS)[number];

/** The hazards with entries: every canonical hazard except haz.wind_gust (M6), in ENTITY_CATALOG §10 order. */
export const HAZARD_ENTITY_IDS = [
  'haz.oil_slick',
  'haz.puddle',
  'haz.pothole',
  'haz.speed_bump',
  'haz.wet_leaves',
  'haz.broken_glass',
  'haz.open_manhole',
] as const;
export type HazardEntityId = (typeof HAZARD_ENTITY_IDS)[number];

/** The Mon–Tue sites (ROADMAP M3), in ENTITY_CATALOG §11 order. */
export const SITE_IDS = ['site.bus_stop', 'site.zebra', 'site.frontage', 'site.pledge_frontage'] as const;
export type SiteId = (typeof SITE_IDS)[number];

/** All six power-ups, in ENTITY_CATALOG §12 order. */
export const POWERUP_IDS = [
  'pwr.flask_of_tea',
  'pwr.bacon_butty',
  'pwr.hi_vis',
  'pwr.super_suction',
  'pwr.wrench',
  'pwr.water_can',
] as const;
export type PowerupId = (typeof POWERUP_IDS)[number];

/** The collectibles entities.json holds so far: Puddle Lane's (the rest arrive in M4/M6). */
export const COLLECTIBLE_IDS = ['collect.false_teeth', 'collect.golden_crisp'] as const;
export type CollectibleId = (typeof COLLECTIBLE_IDS)[number];

/** Every key of entities.json, in file order (ENTITY_CATALOG section order). The file must hold exactly these. */
export const ENTITY_IDS = [
  ...LITTER_IDS,
  ...STAIN_IDS,
  ...NPC_IDS,
  ...VEHICLE_IDS,
  ...KNOCKABLE_IDS,
  ...STATIC_PROP_IDS,
  ...HAZARD_ENTITY_IDS,
  ...SITE_IDS,
  ...POWERUP_IDS,
  ...COLLECTIBLE_IDS,
] as const;
export type EntityId = (typeof ENTITY_IDS)[number];

// ---------------------------------------------------------------------------------------------------------
// Behaviour numbers. Each ID has a fixed set of numeric `rules`; the JSON must hold exactly those keys. Key
// names carry their unit (CLAUDE.md §5.1). Values are ENTITY_CATALOG §6–§10 numbers, or values chosen in M3
// tuning where the catalog marks them so.
// ---------------------------------------------------------------------------------------------------------

/** Range rule for one numeric entity value. */
type NumberCheck =
  /** > 0 */
  | 'positive'
  /** >= 0 */
  | 'nonNegative'
  /** (0, 1]: probabilities */
  | 'fraction'
  /** an integer >= 1 */
  | 'positiveInteger'
  /** an integer >= 0 */
  | 'nonNegativeInteger'
  /** an integer < 0: penalties */
  | 'negativeInteger'
  /** an integer <= 0: penalties that may be free */
  | 'nonPositiveInteger';

type RuleSpec = Readonly<Record<string, NumberCheck>>;

/** A validated rule set: one readonly number per key of its spec. */
export type Rules<S extends RuleSpec> = { readonly [K in keyof S]: number };

/** Per-NPC behaviour numbers (ENTITY_CATALOG §6.2, §6.3, §7.2, §7.4). */
const NPC_RULES = {
  /** Sidesteps Bessie at sidestepM (inside the 6 m awareness radius). */
  'npc.shopper': { sidestepM: 'positive' },
  /**
   * Doris (§6.3): chases at chaseSpeedMps when sprayed, whacking handbagHitHp every whackEveryS while Bessie's
   * body is within handbagReachM of her centre, and gives up when Bessie is chaseGiveUpM away; she glares when
   * Bessie's body is within glareM ahead on her path, walks on once it has been clear for glareClearS, and a horn
   * during the glare makes her shake her fist for fistShakeS, then walk at hornSlowSpeedMps for hornSlowS.
   * whackEveryS, chaseGiveUpM and hornSlowSpeedMps were chosen in M3 tuning (SSP-075, the §17 Q10 proposed
   * defaults); glareM, glareClearS and fistShakeS are TECHNICAL_DESIGN §11.2's; hornSlowS and handbagReachM were
   * chosen in M3 tuning by SSP-083 (owner to review).
   */
  'npc.old_woman': {
    chaseSpeedMps: 'positive',
    handbagHitHp: 'positiveInteger',
    whackEveryS: 'positive',
    chaseGiveUpM: 'positive',
    hornSlowSpeedMps: 'positive',
    glareM: 'positive',
    glareClearS: 'positive',
    fistShakeS: 'positive',
    hornSlowS: 'positive',
    handbagReachM: 'positive',
  },
  'npc.old_man_frame': {},
  /** The lead reaches leadMaxM; the dog drops litter.dog_mess every messEveryMinS–MaxS; Lead Tangle penalty. */
  'npc.dog_walker': {
    leadMaxM: 'positive',
    messEveryMinS: 'positive',
    messEveryMaxS: 'positive',
    tanglePts: 'negativeInteger',
    tangleComplaints: 'positiveInteger',
  },
  /** Drops an item every dropEveryMinS–MaxS; a honk within caughtRadiusM is "Caught!" for caughtPts. */
  'npc.litterbug': {
    dropEveryMinS: 'positive',
    dropEveryMaxS: 'positive',
    caughtRadiusM: 'positive',
    caughtPts: 'positiveInteger',
  },
  /** Ignores Bessie until noticeM. */
  'npc.businessman': { noticeM: 'positive' },
  /**
   * Her contact and separation footprint (§6.2: the pushchair widens it) is a circle of footprintRadiusM,
   * centred on her cell, in place of the human circle (proposed in SSP-085, owner to review).
   */
  'npc.mum_pushchair': { footprintRadiusM: 'positive' },
  /** Stops at doors for doorStopS. */
  'npc.postie': { doorStopS: 'positive' },
  'npc.market_trader': {},
  /**
   * The cat (§7.2, SSP-087): darts when Bessie is dartMinM–MaxM away with dartChance per approach; a hit rides
   * the roof for rideS, seatForwardM ahead of her body centre. Every run (dart, bolt, the way back to a perch)
   * reaches at most runReachM. Perched, it strolls out at walkSpeedMps to groom mid-road (a spot within
   * groomReachM) every groomIdleMinS–MaxS, grooms for groomS, and bolts at boltSpeedMps on a horn or with Bessie
   * within boltNearM. boltNearM is TECHNICAL_DESIGN §11.3's; the rest past rideS were chosen in M3 tuning by
   * SSP-087 (owner to review).
   */
  'npc.cat': {
    dartMinM: 'positive',
    dartMaxM: 'positive',
    dartChance: 'fraction',
    rideS: 'positive',
    runReachM: 'positive',
    walkSpeedMps: 'positive',
    groomIdleMinS: 'positive',
    groomIdleMaxS: 'positive',
    groomS: 'positive',
    groomReachM: 'positive',
    boltNearM: 'positive',
    boltSpeedMps: 'positive',
    seatForwardM: 'nonNegative',
  },
  /**
   * Flocks of flockMin–Max; scatters at scatterM and lands landM away; driving through scores scatterPts. It
   * flies at flyMps and gathers at a litter.chip_wrapper within gatherM of the flock (both proposed in SSP-088,
   * owner to review).
   */
  'npc.pigeon': {
    flockMin: 'positiveInteger',
    flockMax: 'positiveInteger',
    scatterM: 'positive',
    landM: 'positive',
    scatterPts: 'positiveInteger',
    flyMps: 'positive',
    gatherM: 'positive',
  },
} as const satisfies Record<NpcId, RuleSpec>;

/** Per-vehicle behaviour numbers (ENTITY_CATALOG §8.2). */
const VEHICLE_RULES = {
  'veh.hatchback': {},
  'veh.saloon': {},
  /**
   * Fare stops (SSP-091): after a seeded fareStopMinM..fareStopMaxM of driving, an abrupt stop at fareStopDecelMps2
   * (above the 3.0 m/s² car-following braking) and fareStopDwellS standing while the fare gets in.
   */
  'veh.taxi': {
    fareStopMinM: 'positive',
    fareStopMaxM: 'positive',
    fareStopDecelMps2: 'positive',
    fareStopDwellS: 'positive',
  },
  'veh.van_white': {},
  /** Dwells at site.bus_stop for stopDwellS. */
  'veh.bus': { stopDwellS: 'positive' },
  /**
   * Filtering (SSP-091): past traffic slower than filterBelowMps the bicycle rides filterOffsetM right of its lane
   * (between the lanes), moving sideways at filterLateralMps.
   */
  'veh.bicycle': { filterOffsetM: 'positive', filterBelowMps: 'positive', filterLateralMps: 'positive' },
  /** Pavement following (SSP-091): held up for turnRoundS, it turns round on its nav edge. */
  'veh.mobility_scooter': { turnRoundS: 'positive' },
  /** Denting a parked car costs dentPts and a flat dentHp, replacing impact damage (§17 Q4). */
  'veh.hatchback_parked': { dentPts: 'negativeInteger', dentHp: 'positiveInteger' },
  'veh.saloon_parked': { dentPts: 'negativeInteger', dentHp: 'positiveInteger' },
  'veh.taxi_parked': { dentPts: 'negativeInteger', dentHp: 'positiveInteger' },
  'veh.van_white_parked': { dentPts: 'negativeInteger', dentHp: 'positiveInteger' },
} as const satisfies Record<VehicleId, RuleSpec>;

/** Per-hazard numbers (ENTITY_CATALOG §10). Grip hazards name a tuning.json surface instead of a number. */
const HAZARD_RULES = {
  'haz.oil_slick': {},
  'haz.puddle': {},
  /** Jolt: hpLoss and spillLu litter units out of the hopper behind Bessie. */
  'haz.pothole': { hpLoss: 'positiveInteger', spillLu: 'positive' },
  /** Above minSpeedMps the jolt spills spillLu; at or below it, nothing. */
  'haz.speed_bump': { minSpeedMps: 'positive', spillLu: 'positive' },
  'haz.wet_leaves': {},
  /** Drains hpPerS while driven on; sweeping it scores sweepPts. */
  'haz.broken_glass': { hpPerS: 'positive', sweepPts: 'positiveInteger' },
  /** Driving in: hpLoss and a hard stop. */
  'haz.open_manhole': { hpLoss: 'positiveInteger' },
} as const satisfies Record<HazardEntityId, RuleSpec>;

/** Rule pairs whose first value must not exceed the second, as [id, min key, max key]. */
const RULE_RANGES: readonly (readonly [string, string, string])[] = [
  ['npc.dog_walker', 'messEveryMinS', 'messEveryMaxS'],
  ['npc.litterbug', 'dropEveryMinS', 'dropEveryMaxS'],
  ['npc.cat', 'dartMinM', 'dartMaxM'],
  ['npc.cat', 'groomIdleMinS', 'groomIdleMaxS'],
  ['npc.pigeon', 'flockMin', 'flockMax'],
  ['veh.taxi', 'fareStopMinM', 'fareStopMaxM'],
];

/** Power-up effects (ENTITY_CATALOG §12): the numbers each `effect.kind` holds besides `kind`. */
const POWERUP_EFFECTS = {
  /** The combo chain timer ×mul for durationS (flask of tea). */
  chainTimerMul: { mul: 'positive', durationS: 'positive' },
  /** Both top speeds ×mul for durationS; the clean-pickup speed is unchanged (bacon butty). */
  topSpeedMul: { mul: 'positive', durationS: 'positive' },
  /** Every pedestrian yields and parts for durationS, Doris and the businessman included (hi-vis). */
  pedestriansYield: { durationS: 'positive' },
  /** Suction zone ×suctionMul and the fling threshold raised to flingThresholdMps for durationS. */
  superSuction: { suctionMul: 'positive', flingThresholdMps: 'positive', durationS: 'positive' },
  /** Instant repair of hp, capped at max HP (wrench). */
  repairHp: { hp: 'positiveInteger' },
  /** Instant water units, capped at the tank (watering can). */
  addWater: { units: 'positive' },
} as const satisfies Record<string, RuleSpec>;
type PowerupEffectKind = keyof typeof POWERUP_EFFECTS;
const POWERUP_EFFECT_KINDS = Object.keys(POWERUP_EFFECTS) as PowerupEffectKind[];

// ---------------------------------------------------------------------------------------------------------
// Closed vocabularies
// ---------------------------------------------------------------------------------------------------------

/** NPC behaviour module keys (src/sim/npc/behaviours/<camelCase>.ts, TECHNICAL_DESIGN §11.1). */
export const NPC_BEHAVIOURS = [
  'shopper',
  'old_woman',
  'old_man_frame',
  'dog_walker',
  'litterbug',
  'businessman',
  'mum_pushchair',
  'postie',
  'market_trader',
  'cat',
  'pigeon',
] as const;
export type NpcBehaviour = (typeof NPC_BEHAVIOURS)[number];

/** Vehicle behaviour keys: lane traffic, the per-kind hooks of src/sim/traffic.ts, and static parked cars. */
export const VEHICLE_BEHAVIOURS = [
  'traffic',
  'taxi',
  'van_white',
  'bus',
  'bicycle',
  'mobility_scooter',
  'parked',
] as const;
export type VehicleBehaviour = (typeof VEHICLE_BEHAVIOURS)[number];

/** ENTITY_CATALOG §3.2 response types a vehicle uses: solid (OBB, impact damage) or actor (hit penalty). */
export const VEHICLE_COLLISIONS = ['solid', 'actor'] as const;
export type VehicleCollision = (typeof VEHICLE_COLLISIONS)[number];

/** Hazard effect kinds (ENTITY_CATALOG §10). */
export const HAZARD_EFFECTS = ['grip', 'jolt', 'drain', 'hardStop'] as const;
export type HazardEffect = (typeof HAZARD_EFFECTS)[number];

/**
 * The tuning.json `vehicle.sweeper.lateralGripPerS` surfaces a grip hazard switches Bessie to. The grip
 * number itself lives there, once (puddle = wet 4.0, oil 1.2, wet leaves 3.0).
 */
export const HAZARD_GRIP_SURFACES = ['wet', 'oil', 'wetLeaves'] as const;
export type HazardGripSurface = (typeof HAZARD_GRIP_SURFACES)[number];

/** The `sfx` keys each class may use: which event plays the sound. */
const NPC_SFX_KEYS = ['hit', 'horn', 'tangle', 'scatter'] as const;
const VEHICLE_SFX_KEYS = ['horn', 'hit', 'dent'] as const;
const HAZARD_SFX_KEYS = ['splash', 'jolt', 'sweep', 'hardStop'] as const;

// ---------------------------------------------------------------------------------------------------------
// The typed result
// ---------------------------------------------------------------------------------------------------------

/** Fields every entity has (besides `sprite`, whose type depends on the class). */
type EntityBase = {
  readonly id: EntityId;
  /** Display name, British English. */
  readonly name: string;
  /** Membership: the districts it may appear in, in week order (levels hold weights; LEVEL_DESIGN L005). */
  readonly districts: readonly DistrictId[];
  /** The milestone that delivers its behaviour (LEVEL_DESIGN L007). */
  readonly milestone: Milestone;
};

/** The asset whose frames draw it (an AssetId of src/gen/assets.ts; proven by tests/unit/entityCatalog). */
type Sprited = { readonly sprite: AssetId };

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

export type LitterEntity = EntityBase &
  Sprited & {
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

export type StainEntity = EntityBase &
  Sprited & {
    readonly class: 'stain';
    /** Points for spraying it clean, before the combo multiplier. */
    readonly pts: number;
    /** Seconds of spray it takes to clean. */
    readonly sprayS: number;
    readonly rules: StainRules;
  };

/** One item kind an actor drops when knocked over (litter.spilled_shopping ×6 for Doris). */
export type Drop = { readonly litter: LitterId; readonly count: number };

/**
 * The penalty for Bessie hitting an actor (ENTITY_CATALOG §3.2): pts (negative) and complaints, plus the items
 * it drops. Only Doris drops anything (§17 Q7: 0 for everyone else).
 */
export type Hit = {
  readonly pts: number;
  readonly complaints: number;
  /** In JSON order. */
  readonly drops: readonly Drop[];
};

type SfxMap<K extends string> = { readonly [P in K]?: SfxId };

export type NpcEntity<K extends NpcId = NpcId> = EntityBase &
  Sprited & {
    readonly id: K;
    readonly class: 'npc';
    /** Walking speed (the cat: dart speed; the pigeon and market trader: 0, they never walk). */
    readonly speedMps: number;
    /** The behaviour module that drives it. */
    readonly behaviour: NpcBehaviour;
    /** True when the type yields to Bessie inside the awareness radius (ENTITY_CATALOG §3.4, §6.2). */
    readonly yields: boolean;
    /** The hit penalty; null for actors that cannot be hit (pigeons). */
    readonly hit: Hit | null;
    readonly sfx: SfxMap<(typeof NPC_SFX_KEYS)[number]>;
    readonly rules: Rules<(typeof NPC_RULES)[K]>;
  };

/** A vehicle body: width (across, local x) and length (along, local y), metres. */
export type VehicleBody = { readonly widthM: number; readonly lengthM: number };

export type VehicleEntity<K extends VehicleId = VehicleId> = EntityBase &
  Sprited & {
    readonly id: K;
    readonly class: 'veh';
    readonly behaviour: VehicleBehaviour;
    readonly collision: VehicleCollision;
    /**
     * The visible body in metres (ENTITY_CATALOG §8.1): the collision OBB traffic.ts and SSP-090 use, centred
     * on the body centre. A parked variant has its parent's body.
     */
    readonly body: VehicleBody;
    /** A fixed cruising speed, or null where the lane graph's speed limit sets it (and for parked cars). */
    readonly speedMps: number | null;
    /** The actor-hit penalty; null for solid vehicles (moving traffic costs HP only, §17 Q3). */
    readonly hit: Hit | null;
    readonly sfx: SfxMap<(typeof VEHICLE_SFX_KEYS)[number]>;
    readonly rules: Rules<(typeof VEHICLE_RULES)[K]>;
  };

export type KnockableEntity = EntityBase &
  Sprited & {
    readonly class: 'prop';
    readonly collision: 'knockable';
    /** Impulse-body mass (ENTITY_CATALOG §9.1; A-board, trolley and recycling box chosen in M3 tuning). */
    readonly massKg: number;
    /** On the first knock: pts (0 = free) and how many small-litter items spill. */
    readonly knock: { readonly pts: number; readonly spills: number };
    readonly sfx: { readonly knock: SfxId };
  };

/** A static prop: solid, standard impact damage and `bump_wall`/`crash`, so it has no sfx of its own. */
export type StaticPropEntity = EntityBase &
  Sprited & {
    readonly class: 'prop';
    readonly collision: 'solid';
  };

export type HazardEntity<K extends HazardEntityId = HazardEntityId> = EntityBase &
  Sprited & {
    readonly id: K;
    readonly class: 'haz';
    readonly effect: HazardEffect;
    /** The lateral-grip surface Bessie switches to on it (effect 'grip'), else null. */
    readonly surface: HazardGripSurface | null;
    readonly sfx: SfxMap<(typeof HAZARD_SFX_KEYS)[number]>;
    readonly rules: Rules<(typeof HAZARD_RULES)[K]>;
  };

/**
 * A level-authored region (ENTITY_CATALOG §11). These four have no sprite of their own: ground tiles, facades
 * and props draw them, so `sprite` is null.
 */
export type SiteEntity = EntityBase & {
  readonly class: 'site';
  readonly sprite: null;
};

/** A power-up effect (ENTITY_CATALOG §12), discriminated by kind. */
export type PowerupEffect = {
  [K in PowerupEffectKind]: { readonly kind: K } & Rules<(typeof POWERUP_EFFECTS)[K]>;
}[PowerupEffectKind];

export type PowerupEntity = EntityBase &
  Sprited & {
    readonly class: 'pwr';
    readonly effect: PowerupEffect;
    readonly sfx: { readonly pickup: SfxId };
  };

export const COLLECTIBLE_KINDS = ['lostProperty', 'goldenCrisp'] as const;
export type CollectibleKind = (typeof COLLECTIBLE_KINDS)[number];

export type CollectibleEntity = EntityBase &
  Sprited & {
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
  readonly npcs: { readonly [K in NpcId]: NpcEntity<K> };
  readonly vehicles: { readonly [K in VehicleId]: VehicleEntity<K> };
  readonly knockables: { readonly [K in KnockableId]: KnockableEntity };
  readonly staticProps: { readonly [K in StaticPropId]: StaticPropEntity };
  readonly hazards: { readonly [K in HazardEntityId]: HazardEntity<K> };
  readonly sites: { readonly [K in SiteId]: SiteEntity };
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

function readNumber(raw: unknown, path: string, check: NumberCheck): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    fail(path, `must be a finite number, got ${describeValue(raw)}`);
  }
  const integer = Number.isInteger(raw);
  switch (check) {
    case 'positive':
      if (!(raw > 0)) fail(path, `must be > 0, got ${raw}`);
      break;
    case 'nonNegative':
      if (!(raw >= 0)) fail(path, `must be >= 0, got ${raw}`);
      break;
    case 'fraction':
      if (!(raw > 0 && raw <= 1)) fail(path, `must be in (0, 1], got ${raw}`);
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
    case 'nonPositiveInteger':
      if (!(integer && raw <= 0)) fail(path, `must be an integer <= 0, got ${raw}`);
      break;
  }
  return raw;
}

function readString(raw: unknown, path: string): string {
  if (typeof raw !== 'string' || raw.length === 0)
    fail(path, `must be a non-empty string, got ${describeValue(raw)}`);
  return raw;
}

function readBoolean(raw: unknown, path: string): boolean {
  if (typeof raw !== 'boolean') fail(path, `must be a boolean, got ${describeValue(raw)}`);
  return raw;
}

/** `raw` must be one of `allowed`; returns it narrowed. */
function readOneOf<T extends string>(raw: unknown, path: string, allowed: readonly T[], what: string): T {
  const found = allowed.find((value) => value === raw);
  if (found === undefined) fail(path, `must be ${what}, got ${describeValue(raw)}`);
  return found;
}

const quoted = (values: readonly string[]): string => values.map((v) => `"${v}"`).join(', ');

/** An object holding exactly the numeric keys of `spec`, each validated by its check. */
function readRules<S extends RuleSpec>(raw: unknown, path: string, spec: S): Rules<S> {
  const obj = readObject(raw, path, Object.keys(spec));
  const out: Record<string, number> = {};
  for (const [key, check] of Object.entries(spec)) out[key] = readNumber(obj[key], `${path}.${key}`, check);
  // Every key of S was written just above with a validated number.
  return out as Rules<S>;
}

/** The RULE_RANGES pairs of `id` must not be inverted. */
function checkRanges(id: string, rules: Readonly<Record<string, number>>): void {
  for (const [rangeId, minKey, maxKey] of RULE_RANGES) {
    if (rangeId !== id) continue;
    const min = rules[minKey] ?? 0;
    const max = rules[maxKey] ?? 0;
    if (min > max) fail(`${id}.rules`, `${minKey} (${min}) must not exceed ${maxKey} (${max})`);
  }
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

const CANONICAL_SFX = 'a canonical SFX ID (ENTITY_CATALOG §1.4)';

function readPickupSfx(raw: unknown, path: string): { readonly pickup: SfxId } {
  const obj = readObject(raw, path, ['pickup']);
  return { pickup: readOneOf(obj.pickup, `${path}.pickup`, SFX_IDS, CANONICAL_SFX) };
}

/** An sfx map whose keys are a subset of `keys` (in that order) and whose values are canonical SFX IDs. */
function readSfxMap<K extends string>(raw: unknown, path: string, keys: readonly K[]): SfxMap<K> {
  const obj = readObject(raw, path, [], keys);
  const out: Partial<Record<K, SfxId>> = {};
  for (const key of keys) {
    if (obj[key] !== undefined) out[key] = readOneOf(obj[key], `${path}.${key}`, SFX_IDS, CANONICAL_SFX);
  }
  return out;
}

/** The fields every class shares, read from an entity object already checked for its key set. */
function readBase(obj: Obj, id: EntityId): EntityBase {
  return {
    id,
    name: readString(obj.name, `${id}.name`),
    districts: readDistricts(obj.districts, `${id}.districts`),
    milestone: readOneOf(obj.milestone, `${id}.milestone`, MILESTONES, 'a milestone M0..M9'),
  };
}

const BASE_KEYS = ['class', 'name', 'sprite', 'districts', 'milestone'] as const;

/** `class` must match the ID's prefix. */
function checkClass(obj: Obj, id: EntityId, expected: string): void {
  if (obj.class !== expected) fail(`${id}.class`, `must be "${expected}", got ${describeValue(obj.class)}`);
}

/** `hit`: null, or {pts < 0, complaints >= 1, drops: {litter id: count >= 1}}. */
function readHit(raw: unknown, path: string): Hit | null {
  if (raw === null) return null;
  const obj = readObject(raw, path, ['pts', 'complaints', 'drops']);
  const dropsRaw = readObject(obj.drops, `${path}.drops`, [], LITTER_IDS);
  const drops: Drop[] = [];
  for (const [key, count] of Object.entries(dropsRaw)) {
    const litter = readOneOf(key, `${path}.drops`, LITTER_IDS, 'keyed by litter.* IDs');
    drops.push({ litter, count: readNumber(count, `${path}.drops.${key}`, 'positiveInteger') });
  }
  return {
    pts: readNumber(obj.pts, `${path}.pts`, 'negativeInteger'),
    complaints: readNumber(obj.complaints, `${path}.complaints`, 'positiveInteger'),
    drops,
  };
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
    sprite: readSprite(obj.sprite, `${id}.sprite`),
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
    sprite: readSprite(obj.sprite, `${id}.sprite`),
    class: 'stain',
    pts: readNumber(obj.pts, `${id}.pts`, 'nonNegativeInteger'),
    sprayS: readNumber(obj.sprayS, `${id}.sprayS`, 'positive'),
    rules: readStainRules(obj.rules, `${id}.rules`),
  };
}

function readNpc<K extends NpcId>(raw: unknown, id: K): NpcEntity<K> {
  const obj = readObject(raw, id, [...BASE_KEYS, 'speed', 'behaviour', 'yields', 'hit', 'sfx', 'rules']);
  checkClass(obj, id, 'npc');
  const spec: (typeof NPC_RULES)[K] = NPC_RULES[id];
  const rules = readRules(obj.rules, `${id}.rules`, spec);
  checkRanges(id, rules);
  return {
    ...readBase(obj, id),
    id,
    sprite: readSprite(obj.sprite, `${id}.sprite`),
    class: 'npc',
    speedMps: readNumber(obj.speed, `${id}.speed`, 'nonNegative'),
    behaviour: readOneOf(
      obj.behaviour,
      `${id}.behaviour`,
      NPC_BEHAVIOURS,
      `one of ${quoted(NPC_BEHAVIOURS)}`,
    ),
    yields: readBoolean(obj.yields, `${id}.yields`),
    hit: readHit(obj.hit, `${id}.hit`),
    sfx: readSfxMap(obj.sfx, `${id}.sfx`, NPC_SFX_KEYS),
    rules,
  };
}

function readVehicleBody(raw: unknown, path: string): VehicleBody {
  const obj = readObject(raw, path, ['widthM', 'lengthM']);
  return {
    widthM: readNumber(obj.widthM, `${path}.widthM`, 'positive'),
    lengthM: readNumber(obj.lengthM, `${path}.lengthM`, 'positive'),
  };
}

function readVehicle<K extends VehicleId>(raw: unknown, id: K): VehicleEntity<K> {
  const keys = [...BASE_KEYS, 'behaviour', 'collision', 'body', 'speed', 'hit', 'sfx', 'rules'];
  const obj = readObject(raw, id, keys);
  checkClass(obj, id, 'veh');
  const spec: (typeof VEHICLE_RULES)[K] = VEHICLE_RULES[id];
  const collision = readOneOf(obj.collision, `${id}.collision`, VEHICLE_COLLISIONS, '"solid" or "actor"');
  const hit = readHit(obj.hit, `${id}.hit`);
  const rules = readRules(obj.rules, `${id}.rules`, spec);
  checkRanges(id, rules);
  // An actor (bicycle, mobility scooter) is hit like a pedestrian; a solid vehicle costs HP only (§17 Q3).
  if ((collision === 'actor') !== (hit !== null)) {
    fail(
      `${id}.hit`,
      `must be ${collision === 'actor' ? 'a penalty for an actor' : 'null for a solid vehicle'}`,
    );
  }
  return {
    ...readBase(obj, id),
    id,
    sprite: readSprite(obj.sprite, `${id}.sprite`),
    class: 'veh',
    behaviour: readOneOf(
      obj.behaviour,
      `${id}.behaviour`,
      VEHICLE_BEHAVIOURS,
      `one of ${quoted(VEHICLE_BEHAVIOURS)}`,
    ),
    collision,
    body: readVehicleBody(obj.body, `${id}.body`),
    speedMps: obj.speed === null ? null : readNumber(obj.speed, `${id}.speed`, 'positive'),
    hit,
    sfx: readSfxMap(obj.sfx, `${id}.sfx`, VEHICLE_SFX_KEYS),
    rules,
  };
}

function readKnockable(raw: unknown, id: KnockableId): KnockableEntity {
  const obj = readObject(raw, id, [...BASE_KEYS, 'collision', 'massKg', 'knock', 'sfx']);
  checkClass(obj, id, 'prop');
  const knock = readObject(obj.knock, `${id}.knock`, ['pts', 'spills']);
  const sfx = readObject(obj.sfx, `${id}.sfx`, ['knock']);
  return {
    ...readBase(obj, id),
    sprite: readSprite(obj.sprite, `${id}.sprite`),
    class: 'prop',
    collision: readOneOf(obj.collision, `${id}.collision`, ['knockable'] as const, '"knockable"'),
    massKg: readNumber(obj.massKg, `${id}.massKg`, 'positive'),
    knock: {
      pts: readNumber(knock.pts, `${id}.knock.pts`, 'nonPositiveInteger'),
      spills: readNumber(knock.spills, `${id}.knock.spills`, 'nonNegativeInteger'),
    },
    sfx: { knock: readOneOf(sfx.knock, `${id}.sfx.knock`, SFX_IDS, CANONICAL_SFX) },
  };
}

function readStaticProp(raw: unknown, id: StaticPropId): StaticPropEntity {
  const obj = readObject(raw, id, [...BASE_KEYS, 'collision']);
  checkClass(obj, id, 'prop');
  return {
    ...readBase(obj, id),
    sprite: readSprite(obj.sprite, `${id}.sprite`),
    class: 'prop',
    collision: readOneOf(obj.collision, `${id}.collision`, ['solid'] as const, '"solid"'),
  };
}

function readHazard<K extends HazardEntityId>(raw: unknown, id: K): HazardEntity<K> {
  const obj = readObject(raw, id, [...BASE_KEYS, 'effect', 'surface', 'sfx', 'rules']);
  checkClass(obj, id, 'haz');
  const spec: (typeof HAZARD_RULES)[K] = HAZARD_RULES[id];
  const effect = readOneOf(obj.effect, `${id}.effect`, HAZARD_EFFECTS, `one of ${quoted(HAZARD_EFFECTS)}`);
  // A grip hazard names its tuning.json surface; every other effect has none.
  const surface =
    effect === 'grip'
      ? readOneOf(
          obj.surface,
          `${id}.surface`,
          HAZARD_GRIP_SURFACES,
          `one of ${quoted(HAZARD_GRIP_SURFACES)}`,
        )
      : obj.surface === null
        ? null
        : fail(`${id}.surface`, `must be null for effect "${effect}", got ${describeValue(obj.surface)}`);
  return {
    ...readBase(obj, id),
    id,
    sprite: readSprite(obj.sprite, `${id}.sprite`),
    class: 'haz',
    effect,
    surface,
    sfx: readSfxMap(obj.sfx, `${id}.sfx`, HAZARD_SFX_KEYS),
    rules: readRules(obj.rules, `${id}.rules`, spec),
  };
}

function readSite(raw: unknown, id: SiteId): SiteEntity {
  const obj = readObject(raw, id, BASE_KEYS);
  checkClass(obj, id, 'site');
  if (obj.sprite !== null) {
    fail(
      `${id}.sprite`,
      `must be null (tiles, facades and props draw sites), got ${describeValue(obj.sprite)}`,
    );
  }
  return { ...readBase(obj, id), class: 'site', sprite: null };
}

function readPowerupEffect(raw: unknown, path: string): PowerupEffect {
  if (!isRecord(raw)) fail(path, `must be an object, got ${describeValue(raw)}`);
  const kind = readOneOf(
    raw.kind,
    `${path}.kind`,
    POWERUP_EFFECT_KINDS,
    `one of ${quoted(POWERUP_EFFECT_KINDS)}`,
  );
  const spec: RuleSpec = POWERUP_EFFECTS[kind];
  const { kind: _kind, ...numbers } = raw;
  const values = readRules(numbers, path, spec);
  // `values` holds exactly the keys of POWERUP_EFFECTS[kind], so this is that kind's effect.
  return { kind, ...values } as PowerupEffect;
}

function readPowerup(raw: unknown, id: PowerupId): PowerupEntity {
  const obj = readObject(raw, id, [...BASE_KEYS, 'effect', 'sfx']);
  checkClass(obj, id, 'pwr');
  return {
    ...readBase(obj, id),
    sprite: readSprite(obj.sprite, `${id}.sprite`),
    class: 'pwr',
    effect: readPowerupEffect(obj.effect, `${id}.effect`),
    sfx: readPickupSfx(obj.sfx, `${id}.sfx`),
  };
}

function readCollectible(raw: unknown, id: CollectibleId): CollectibleEntity {
  const obj = readObject(raw, id, [...BASE_KEYS, 'kind', 'pts', 'sfx']);
  checkClass(obj, id, 'collect');
  return {
    ...readBase(obj, id),
    sprite: readSprite(obj.sprite, `${id}.sprite`),
    class: 'collect',
    kind: readOneOf(obj.kind, `${id}.kind`, COLLECTIBLE_KINDS, '"lostProperty" or "goldenCrisp"'),
    pts: readNumber(obj.pts, `${id}.pts`, 'positiveInteger'),
    sfx: readPickupSfx(obj.sfx, `${id}.sfx`),
  };
}

/** Read every ID of `ids` from `root` with `read`, into a record keyed by ID (in list order). */
function readAll<I extends string, E>(
  root: Obj,
  ids: readonly I[],
  read: (raw: unknown, id: I) => E,
): Record<I, E> {
  const out: Partial<Record<I, E>> = {};
  for (const id of ids) out[id] = read(root[id], id);
  // Every ID of `ids` was written just above (readObject proved none is missing from root).
  return out as Record<I, E>;
}

/**
 * Validate raw entity data (the parsed entities.json, or an edited copy) and return a new typed Entities
 * object. The root must hold exactly ENTITY_IDS. Throws an Error naming the ID and field on any missing,
 * unknown, mistyped or out-of-range value. Load-time code: allocates.
 */
export function loadEntities(raw: unknown): Entities {
  const root = readObject(raw, 'root', ENTITY_IDS);
  return {
    litter: readAll(root, LITTER_IDS, readLitter),
    stains: readAll(root, STAIN_IDS, readStain),
    // The per-ID generic readers return NpcEntity<K> etc. for each K; readAll's record widens to the union.
    npcs: readAll(root, NPC_IDS, readNpc) as Entities['npcs'],
    vehicles: readAll(root, VEHICLE_IDS, readVehicle) as Entities['vehicles'],
    knockables: readAll(root, KNOCKABLE_IDS, readKnockable),
    staticProps: readAll(root, STATIC_PROP_IDS, readStaticProp),
    hazards: readAll(root, HAZARD_ENTITY_IDS, readHazard) as Entities['hazards'],
    sites: readAll(root, SITE_IDS, readSite),
    powerups: readAll(root, POWERUP_IDS, readPowerup),
    collectibles: readAll(root, COLLECTIBLE_IDS, readCollectible),
  };
}
