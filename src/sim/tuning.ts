// Typed, validated access to src/data/tuning.json (TECHNICAL_DESIGN §2.1, §3.2 rule 4, §8). This is the
// only src/sim file allowed to import src/data/*.json (tests/unit/simPurity.test.ts enforces it). The JSON is
// the source of truth for every handling number; GDD §7 mirrors it (CLAUDE.md §2). It also holds the
// provisional static-prop collision footprints (`propFootprints`, SSP-036) until M4 measures the real slices,
// the knockable bodies' physics and provisional OBBs (`knockables`, SSP-092; mirrored by TECHNICAL_DESIGN §9.3),
// and since SSP-053 the M2 sweeping, hopper, water, dumping, combo, scoring, shift, star and Tidy % values
// (mirrored by GDD §8, §9, §10 and §12.1). Since SSP-075 it also holds the M3 street-life rules every
// pedestrian, animal and traffic issue shares (`streetLife`, `complaints`, `endStates`; mirrored by
// ENTITY_CATALOG §3, GDD §10.3 and §11, and TECHNICAL_DESIGN §9.4 and §11).
//
// It is also the gateway for src/data/entities.json: the guards and types live in ./entities.ts (re-exported
// below) and DEFAULT_ENTITIES is loaded here, because only this file may import src/data/.
//
// The sim never reads DEFAULT_TUNING implicitly: the composition root passes a Tuning object into
// createWorld(level, seed, tuning), so the dev panel (SSP-048) can hand the World an edited copy. loadTuning
// builds a fresh object on every call for the same reason.
//
// Validation is hand-written (no zod, no `any`, CLAUDE.md §5.1): every group must hold exactly its listed
// keys, every value must be a finite number in range, and malformed data throws an Error naming the JSON
// path. Angles are stored in degrees in the JSON and converted to radians here, once.
import entitiesJson from '../data/entities.json' with { type: 'json' };
import tuningJson from '../data/tuning.json' with { type: 'json' };
import { DEG_TO_RAD, SIM_HZ } from './constants.ts';
import { describeValue, isRecord } from './dataGuards.ts';
import {
  type Entities,
  KNOCKABLE_IDS,
  type KnockableId,
  loadEntities,
  STATIC_PROP_IDS,
  type StaticPropId,
} from './entities.ts';

export * from './entities.ts';

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
  | 'unit'
  /** any finite number: signed vehicle-local coordinates */
  | 'finite'
  /** an integer >= 1: counts and points per event */
  | 'positiveInteger'
  /** an integer < 0: penalties */
  | 'negativeInteger';

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
 * GDD §7.1, §8.2 and TECHNICAL_DESIGN §8.3 brush timings (brush.ts, SSP-059). Collects only at
 * rpm >= collectMinRpm while lowered. Fling probability rises linearly from 0 at cleanPickupMaxMps to 1 at
 * flingCertainMps. RPM spins up only while the brush is fully lowered and otherwise spins down from full
 * over spinDownS (0: it drops to 0 the moment Raising starts; SSP-059).
 */
const BRUSH_SPEC = {
  raiseLowerS: 'positive',
  spinUpS: 'positive',
  collectMinRpm: 'unit',
  cleanPickupMaxMps: 'positive',
  flingCertainMps: 'positive',
  spinDownS: 'nonNegative',
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
// M2 sweeping-core sections (SSP-053): GDD §8, §9, §10, §12.1 and TECHNICAL_DESIGN §10, mirrored there. The
// brush timings, the fling ramp (brush.cleanPickupMaxMps → brush.flingCertainMps, a 2.0 m/s width) and the
// full-hopper mass and handling multipliers already live in vehicle.sweeper (M1) and are not repeated here.
// Geometry is vehicle-local metres: origin at the body centre, +y forward.
// ---------------------------------------------------------------------------------------------------------

/**
 * GDD §8.1: the two gutter brush circles, centred at (±centreXM, centreYM). While collecting, an item inside
 * a circle is pushed toward x = 0 at sweepInMps and backward at sweepBackMps (SSP-059).
 */
const GUTTER_BRUSH_SPEC = {
  radiusM: 'positive',
  centreXM: 'positive',
  centreYM: 'finite',
  sweepInMps: 'positive',
  sweepBackMps: 'nonNegative',
} as const satisfies GroupSpec;

/**
 * TECHNICAL_DESIGN §10.1: the suction rect. Items inside are pulled to the inlet at
 * pullMps × rpm × suction multiplier (upg.suction, pwr.super_suction).
 */
const SUCTION_SPEC = {
  minXM: 'finite',
  maxXM: 'finite',
  minYM: 'finite',
  maxYM: 'finite',
  pullMps: 'positive',
} as const satisfies GroupSpec;

/** GDD §8.1: the inlet rect, widthM across (x) by depthM along (y). An item whose centre enters is collected. */
const INLET_SPEC = {
  centreXM: 'finite',
  centreYM: 'finite',
  widthM: 'positive',
  depthM: 'positive',
} as const satisfies GroupSpec;

/** TECHNICAL_DESIGN §10.1: the rect that erases grime cells while collecting. */
const GRIME_FOOTPRINT_SPEC = {
  minXM: 'finite',
  maxXM: 'finite',
  minYM: 'finite',
  maxYM: 'finite',
} as const satisfies GroupSpec;

/** GDD §8.1 and §9.1: a gutter brush centre within this distance of a kerb edge collects gutter grime. */
const KERB_HUGGER_SPEC = {
  maxKerbDistanceM: 'positive',
} as const satisfies GroupSpec;

/**
 * GDD §8.1: a flung item lands this far sideways on its kinematic arc, and the arc lasts arcDurationS (the
 * item is uncollectable until it lands; litter.ts rounds it to whole ticks, at least 1; SSP-057).
 */
const FLING_SPEC = {
  minDistanceM: 'positive',
  maxDistanceM: 'positive',
  arcDurationS: 'positive',
} as const satisfies GroupSpec;

/**
 * TECHNICAL_DESIGN §10.2: at a full hopper, items reaching the inlet are pinned pinAheadM ahead of the front
 * bumper (body.lengthM / 2) and pushed along (SSP-059).
 */
const BULLDOZER_SPEC = {
  pinAheadM: 'nonNegative',
} as const satisfies GroupSpec;

const SWEEPING_GROUPS = {
  gutterBrush: GUTTER_BRUSH_SPEC,
  suction: SUCTION_SPEC,
  inlet: INLET_SPEC,
  grimeFootprint: GRIME_FOOTPRINT_SPEC,
  kerbHugger: KERB_HUGGER_SPEC,
  fling: FLING_SPEC,
  bulldozer: BULLDOZER_SPEC,
} as const;

/** GDD §8.4: base capacity in litter units (upg.hopper raises it later) and the HUD warning fill fraction. */
const HOPPER_SPEC = {
  capacityLu: 'positive',
  warnFraction: 'fraction',
} as const satisfies GroupSpec;

/**
 * GDD §8.5: tank size, spray use over a cone ahead of Bessie, and the hydrant refill rate (water units). The
 * cone geometry and the hydrant 'stopped adjacent' test were decided in SSP-061 (src/sim/water.ts): the cone's
 * apex sits on the centre line sprayConeApexYM ahead of the body centre (the front bumper) and it widens to
 * sprayConeEndWidthM over sprayConeLengthM; a hydrant refills when Bessie is below hydrantMaxSpeedMps with the
 * hydrant's centre within hydrantReachM of her body OBB.
 */
const WATER_SPEC = {
  tankUnits: 'positive',
  sprayUnitsPerS: 'positive',
  sprayConeLengthM: 'positive',
  sprayConeApexYM: 'finite',
  sprayConeEndWidthM: 'positive',
  hydrantRefillUnitsPerS: 'positive',
  hydrantMaxSpeedMps: 'positive',
  hydrantReachM: 'positive',
} as const satisfies GroupSpec;

/** GDD §8.7: the depot bay needs Bessie below maxSpeedMps; hold Dump for holdS, then drain for drainS. */
const DEPOT_BAY_SPEC = {
  holdS: 'positive',
  drainS: 'positive',
  maxSpeedMps: 'positive',
} as const satisfies GroupSpec;

/**
 * GDD §8.7: a skip on the route. Bessie is "stopped adjacent" below maxSpeedMps with her body OBB within reachM
 * of the skip's rectangle (one tile; decided in SSP-062, shift.ts).
 */
const SKIP_SPEC = {
  holdS: 'positive',
  drainS: 'positive',
  maxSpeedMps: 'positive',
  reachM: 'nonNegative',
} as const satisfies GroupSpec;

/** One combo tier (GDD §10.2): a chain of at least minChain pickups scores ×multiplier. */
const COMBO_TIER_SPEC = {
  minChain: 'positiveInteger',
  multiplier: 'positiveInteger',
} as const satisfies GroupSpec;

/** GDD §9.1 and §10.3: grime points per cell and the style bonuses M2 scores. */
const SCORING_SPEC = {
  grimeCellPts: 'positiveInteger',
  gutterGrimeCellPts: 'positiveInteger',
  kerbHuggerPts: 'positiveInteger',
  kerbHuggerEveryS: 'positive',
  cleanSweepPts: 'positiveInteger',
} as const satisfies GroupSpec;

/**
 * LEVEL_DESIGN §4.1: a 240 s campaign shift; the timer starts on first throttle or after rolloutS. Once the
 * shift is over, knockOffBrake (a fraction of full brake) rolls Bessie to a stop (GDD §5.3, decided in SSP-062).
 */
const SHIFT_SPEC = {
  durationS: 'positive',
  rolloutS: 'nonNegative',
  knockOffBrake: 'fraction',
} as const satisfies GroupSpec;

/** GDD §12.1: the minimum Tidy % (as a fraction) for each star. */
const STARS_SPEC = {
  star1MinTidy: 'fraction',
  star2MinTidy: 'fraction',
  star3MinTidy: 'fraction',
} as const satisfies GroupSpec;

/**
 * GDD §9.2: Tidy % = grimeWeight × grime cleaned share + litterWeight × litter collected share. GDD §9.3: a
 * frontage at frontageGoodMinClean (90%) or above is good: a pledge pays its tip, the Mercury map shows it
 * green and the Inspector passes it (SSP-064).
 */
const TIDY_SPEC = {
  grimeWeight: 'unit',
  litterWeight: 'unit',
  frontageGoodMinClean: 'fraction',
} as const satisfies GroupSpec;

// ---------------------------------------------------------------------------------------------------------
// M3 street-life sections (SSP-075): the rules every pedestrian, animal and traffic issue shares
// (ENTITY_CATALOG §3, GDD §10.3 and §11, TECHNICAL_DESIGN §9.4 and §11). Per-entity numbers (speeds, hit
// penalties, behaviour timings) live in entities.json instead. The upgrade-dependent values (LED beacon,
// two-tone horn) are stored beside their base values until upgrades.json and the tuning modifiers arrive (M6).
// ---------------------------------------------------------------------------------------------------------

/** ENTITY_CATALOG §3.4: yielding pedestrians react inside radiusM (ledBeaconRadiusM with upg.led_beacon). */
const AWARENESS_SPEC = {
  radiusM: 'positive',
  ledBeaconRadiusM: 'positive',
} as const satisfies GroupSpec;

/** ENTITY_CATALOG §3.4, TECHNICAL_DESIGN §11.1: the Horn stimulus radius (twoToneRadiusM with upg.two_tone_horn). */
const HORN_SPEC = {
  radiusM: 'positive',
  twoToneRadiusM: 'positive',
} as const satisfies GroupSpec;

/**
 * GDD §10.3: passing within maxGapM of a pedestrian above minSpeedMps without contact scores pts. One award per
 * pedestrian per pass: the pass re-arms once the gap exceeds rearmGapM (proposed in SSP-095, owner to review).
 */
const NEAR_MISS_SPEC = {
  maxGapM: 'positive',
  minSpeedMps: 'positive',
  pts: 'positiveInteger',
  rearmGapM: 'positive',
} as const satisfies GroupSpec;

/**
 * ENTITY_CATALOG §3.4: a pedestrian within radiusM of a dust cloud costs pts every everyS. No complaint. Each
 * gutter brush puffs one cloud every cloudEveryTicks (ART_BIBLE §11 fx.dust_puff) and a cloud lives for
 * cloudLifeTicks (the puff's 6 frames × 5 ticks; proposed in SSP-095, owner to review).
 */
const DUST_SPEC = {
  radiusM: 'positive',
  pts: 'negativeInteger',
  everyS: 'positive',
  cloudEveryTicks: 'positiveInteger',
  cloudLifeTicks: 'positiveInteger',
} as const satisfies GroupSpec;

/**
 * ENTITY_CATALOG §3.4, §10: driving through haz.puddle above minSpeedMps splashes each pedestrian within
 * radiusM for pts; every complaintEvery-th splash is also 1 complaint.
 */
const SPLASH_SPEC = {
  minSpeedMps: 'positive',
  radiusM: 'positive',
  pts: 'negativeInteger',
  complaintEvery: 'positiveInteger',
} as const satisfies GroupSpec;

/**
 * ENTITY_CATALOG §3.2, TECHNICAL_DESIGN §9.4: a contact is a hit only at a closing speed of at least
 * minClosingSpeedMps (§17 Q2); after a hit, contact with that actor is ignored for ignoreContactS.
 */
const ACTOR_HIT_SPEC = {
  minClosingSpeedMps: 'positive',
  ignoreContactS: 'positive',
} as const satisfies GroupSpec;

/** TECHNICAL_DESIGN §9.4: actor collision circles. */
const NPC_RADIUS_SPEC = {
  humanM: 'positive',
  catM: 'positive',
  dogM: 'positive',
} as const satisfies GroupSpec;

/**
 * ENTITY_CATALOG §8.3, TECHNICAL_DESIGN §11.4 (traffic.ts, SSP-089). A car blocked by Bessie honks after
 * honkAfterBlockedS. Car following caps the speed at sqrt(2 · followDecelMps2 · (gap − followGapM)). The rest
 * are M3 tuning (SSP-089: the docs gave no numbers, so they are starting values for owner review): accelMps2
 * how fast traffic picks up speed towards the lane's speed limit; a vehicle counts as blocked while what is
 * ahead holds it below blockedBelowMps, and a block is over once it has been clear for clearAfterS; a
 * pedestrian at a kerb waits while a vehicle would reach the crossing within crossingGapS (plus followGapM);
 * the first scheduled bus of a bus route is due at firstBusS (LEVEL_DESIGN §4.5, Tuesday: from 20 s), then one
 * every busEveryS (the compiled level). SSP-090 (parked.ts): a parked car's dent contact episode ends once Bessie
 * has not touched it for dentRearmS (0.5 s, the knockables' re-arm), so it dents once per episode.
 */
const TRAFFIC_SPEC = {
  honkAfterBlockedS: 'positive',
  accelMps2: 'positive',
  followDecelMps2: 'positive',
  followGapM: 'positive',
  blockedBelowMps: 'positive',
  clearAfterS: 'nonNegative',
  crossingGapS: 'positive',
  firstBusS: 'nonNegative',
  dentRearmS: 'positive',
} as const satisfies GroupSpec;

/**
 * TECHNICAL_DESIGN §11.4, LEVEL_DESIGN §7.1 (SSP-076, M3 tuning): the speed limit the level compiler bakes
 * into each lane edge by road class. Residential: a two-way road 3 tiles wide; main road: two-way and at least
 * 4 tiles wide everywhere; one-way: any `> < ^ v` road; junction: connectors through a junction box and
 * dead-end turn-arounds; roundabout: a mini-roundabout's ring and its connectors.
 */
const LANE_SPEED_SPEC = {
  residentialMps: 'positive',
  mainRoadMps: 'positive',
  oneWayMps: 'positive',
  junctionMps: 'positive',
  roundaboutMps: 'positive',
} as const satisfies GroupSpec;

/**
 * TECHNICAL_DESIGN §11.1 (SSP-081, M3 tuning: the docs gave no numbers): the shared NPC steering core
 * (npc/steering.ts). accelMps2 and turnRateDegPerS limit how fast an NPC changes speed and heading (degrees as
 * stored; steering converts); arriveRadiusM is how close a path node counts as reached (more round a prop that
 * stands on the node) and slowRadiusM where an arrival starts slowing; separationGapM is the extra gap beyond
 * two NPCs' touching circles inside which they steer apart; sidestepClearM the margin beyond Bessie's half
 * width and the NPC's radius inside which her predicted path makes an NPC sidestep; kerbLookS how long an NPC
 * waits at the kerb before it steps onto a crossing.
 */
const NPC_STEERING_SPEC = {
  accelMps2: 'positive',
  turnRateDegPerS: 'positive',
  arriveRadiusM: 'positive',
  slowRadiusM: 'positive',
  separationGapM: 'nonNegative',
  sidestepClearM: 'nonNegative',
  kerbLookS: 'nonNegative',
} as const satisfies GroupSpec;

const STREET_LIFE_GROUPS = {
  awareness: AWARENESS_SPEC,
  horn: HORN_SPEC,
  nearMiss: NEAR_MISS_SPEC,
  dust: DUST_SPEC,
  splash: SPLASH_SPEC,
  actorHit: ACTOR_HIT_SPEC,
  npcRadius: NPC_RADIUS_SPEC,
  traffic: TRAFFIC_SPEC,
  laneSpeed: LANE_SPEED_SPEC,
  npcSteering: NPC_STEERING_SPEC,
} as const;

/** GDD §11.1: the meter reaching sackedAt complaints is SACKED!. */
const COMPLAINT_METER_SPEC = {
  sackedAt: 'positiveInteger',
} as const satisfies GroupSpec;

/**
 * ENTITY_CATALOG §3.3: more than maxHonks honks within windowS is `complaints` ("Noise"); the threshold is
 * twoToneMaxHonks with upg.two_tone_horn.
 */
const HORN_SPAM_SPEC = {
  maxHonks: 'positiveInteger',
  twoToneMaxHonks: 'positiveInteger',
  windowS: 'positive',
  complaints: 'positiveInteger',
} as const satisfies GroupSpec;

/** ENTITY_CATALOG §3.3, §8.3: blocking one queue for more than afterBlockedS is `complaints` ("Road Rage"). */
const ROAD_RAGE_SPEC = {
  afterBlockedS: 'positive',
  complaints: 'positiveInteger',
} as const satisfies GroupSpec;

/** ENTITY_CATALOG §3.3, §11: running an occupied site.zebra costs pts and complaints. */
const ZEBRA_SPEC = {
  pts: 'negativeInteger',
  complaints: 'positiveInteger',
} as const satisfies GroupSpec;

/** ENTITY_CATALOG §3.3: a penalty within radiusM of a veh.police adds extraComplaints (stored now; M6). */
const POLICE_WITNESS_SPEC = {
  radiusM: 'positive',
  extraComplaints: 'positiveInteger',
} as const satisfies GroupSpec;

const COMPLAINT_GROUPS = {
  meter: COMPLAINT_METER_SPEC,
  hornSpam: HORN_SPAM_SPEC,
  roadRage: ROAD_RAGE_SPEC,
  zebra: ZEBRA_SPEC,
  policeWitness: POLICE_WITNESS_SPEC,
} as const;

/**
 * TECHNICAL_DESIGN §9.3 (SSP-092): how knockable bodies meet Bessie, the static world and each other. A body's
 * outgoing normal speed off Bessie is (1 + bessieRestitution) × hers (she is the infinite-mass mover), off a
 * wall or a static prop staticRestitution × its own, and bodyRestitution between two bodies. A body that has
 * left Bessie for rearmS starts a new contact episode (a new EV.Knock) when she touches it again.
 */
const KNOCKABLE_CONTACT_SPEC = {
  bessieRestitution: 'unit',
  staticRestitution: 'unit',
  bodyRestitution: 'unit',
  rearmS: 'positive',
} as const satisfies GroupSpec;

/** TECHNICAL_DESIGN §9.3: a spinning body's angular speed falls by frictionRadPerS2 every second. */
const KNOCKABLE_SPIN_SPEC = {
  frictionRadPerS2: 'positive',
} as const satisfies GroupSpec;

/**
 * ENTITY_CATALOG §9.1 (SSP-092): where a first hit's spilled items land, in the frame of the hit (+n pointing
 * away from Bessie): nearM + [0, depthM) along n from the body centre, ±halfWidthM across.
 */
const KNOCKABLE_SPILL_SPEC = {
  nearM: 'nonNegative',
  depthM: 'positive',
  halfWidthM: 'nonNegative',
} as const satisfies GroupSpec;

/**
 * One knockable body (SSP-092, PROVISIONAL until M4 measures the lowest slice): its OBB, widthM along the
 * body's local +x and lengthM along its local +y (north at heading 0), and the ground friction that slows its
 * slide, m/s² (a trolley on castors rolls on; a bin scrapes to a stop).
 */
const KNOCKABLE_BODY_SPEC = {
  widthM: 'positive',
  lengthM: 'positive',
  frictionMps2: 'positive',
} as const satisfies GroupSpec;

/** GDD §11.3: TOWED! keeps towedScoreKeep of the score (and awards no stars). */
const END_STATES_SPEC = {
  towedScoreKeep: 'fraction',
} as const satisfies GroupSpec;

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

/** A circle footprint centred on the prop's position (metres). */
export type CirclePropFootprint = { readonly shape: 'circle'; readonly radiusM: number };

/**
 * A box footprint centred on the prop's position: widthM along the prop's local +x (east at rot 0) and
 * lengthM along its local +y (north at rot 0), turned by the prop's `rot` like any heading (§4).
 */
export type BoxPropFootprint = { readonly shape: 'box'; readonly widthM: number; readonly lengthM: number };

export type PropFootprint = CirclePropFootprint | BoxPropFootprint;

/**
 * Collision footprints of the static props (SSP-036). PROVISIONAL until the M4 art pass: ENTITY_CATALOG §9
 * defines a prop's shape as the opaque bounding box of its lowest slice, which does not exist yet for most
 * props, so tuning.json holds one hand-picked table (sizes from STYLE.md §8's nominal widths) and
 * `provisional` stays true until M4 measures the real slices. SSP-075 (M3) added the prop entries to
 * entities.json but left this table here: it is provisional collision data that M4 replaces with measured
 * slices, and it moves into the prop entries then.
 */
export type PropFootprints = {
  readonly provisional: boolean;
  readonly shapes: { readonly [K in StaticPropId]: PropFootprint };
};

/** One knockable's provisional OBB and ground friction (tuning.json → knockables.bodies). */
export type KnockableBodyTuning = Group<typeof KNOCKABLE_BODY_SPEC>;

/**
 * The knockable bodies (TECHNICAL_DESIGN §9.3, SSP-092). Masses, penalties and spill counts are entities.json;
 * this is the physics: contact restitutions and the re-arm time, spin friction, where spills land, and one
 * provisional OBB and friction per KNOCKABLE_IDS entry. `provisional` stays true until the M4 art pass measures
 * the lowest slices (ENTITY_CATALOG §9: "the opaque bounding box of the lowest slice, as an OBB").
 */
export type KnockablesTuning = {
  readonly provisional: boolean;
  readonly contact: Group<typeof KNOCKABLE_CONTACT_SPEC>;
  readonly spin: Group<typeof KNOCKABLE_SPIN_SPEC>;
  readonly spill: Group<typeof KNOCKABLE_SPILL_SPEC>;
  readonly bodies: { readonly [K in KnockableId]: KnockableBodyTuning };
};

/** Brush, suction, inlet, grime and fling geometry (GDD §8.1, TECHNICAL_DESIGN §10.1). */
export type SweepingTuning = {
  readonly gutterBrush: Group<typeof GUTTER_BRUSH_SPEC>;
  readonly suction: Group<typeof SUCTION_SPEC>;
  readonly inlet: Group<typeof INLET_SPEC>;
  readonly grimeFootprint: Group<typeof GRIME_FOOTPRINT_SPEC>;
  readonly kerbHugger: Group<typeof KERB_HUGGER_SPEC>;
  readonly fling: Group<typeof FLING_SPEC>;
  readonly bulldozer: Group<typeof BULLDOZER_SPEC>;
};

/** Hopper capacity and HUD warning fraction (GDD §8.4); hopper.ts reads it. */
export type HopperTuning = Group<typeof HOPPER_SPEC>;

/** tuning.json → water (GDD §8.5; the cone and hydrant adjacency decided in SSP-061). */
export type WaterTuning = Group<typeof WATER_SPEC>;

/** Depot bay and skip dumping (GDD §8.7, TECHNICAL_DESIGN §10.5). */
export type DumpingTuning = {
  readonly depotBay: Group<typeof DEPOT_BAY_SPEC>;
  readonly skip: Group<typeof SKIP_SPEC>;
};

export type ComboTier = Group<typeof COMBO_TIER_SPEC>;

/** The combo chain (GDD §10.2). Below the first tier the multiplier is ×1. */
export type ComboTuning = {
  /** Seconds a pickup keeps the chain alive (doubled by pwr.flask_of_tea). */
  readonly chainS: number;
  /** Ascending in both minChain and multiplier. */
  readonly tiers: readonly ComboTier[];
};

/** The shared pedestrian, animal and traffic rules (M3, SSP-075). */
export type StreetLifeTuning = {
  readonly [G in keyof typeof STREET_LIFE_GROUPS]: Group<(typeof STREET_LIFE_GROUPS)[G]>;
};

/** The Council Complaints rules (M3, SSP-075). */
export type ComplaintsTuning = {
  readonly [G in keyof typeof COMPLAINT_GROUPS]: Group<(typeof COMPLAINT_GROUPS)[G]>;
};

/** Everything in src/data/tuning.json, validated. Pass it into the sim explicitly; never import a singleton. */
export type Tuning = {
  readonly vehicle: {
    readonly sweeper: SweeperTuning;
  };
  readonly propFootprints: PropFootprints;
  readonly knockables: KnockablesTuning;
  readonly sweeping: SweepingTuning;
  readonly hopper: HopperTuning;
  readonly water: WaterTuning;
  readonly dumping: DumpingTuning;
  readonly combo: ComboTuning;
  readonly scoring: Group<typeof SCORING_SPEC>;
  readonly shift: Group<typeof SHIFT_SPEC>;
  readonly stars: Group<typeof STARS_SPEC>;
  readonly tidy: Group<typeof TIDY_SPEC>;
  readonly streetLife: StreetLifeTuning;
  readonly complaints: ComplaintsTuning;
  readonly endStates: Group<typeof END_STATES_SPEC>;
};

/** The top-level keys of tuning.json, in file order. */
const ROOT_KEYS = [
  'vehicle',
  'propFootprints',
  'knockables',
  'sweeping',
  'hopper',
  'water',
  'dumping',
  'combo',
  'scoring',
  'shift',
  'stars',
  'tidy',
  'streetLife',
  'complaints',
  'endStates',
] as const;

// ---------------------------------------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------------------------------------

/** Tolerance for the cross-field geometry check (the JSON holds short decimals). */
const GEOMETRY_EPS_M = 1e-9;

function fail(path: string, message: string): never {
  throw new Error(`tuning: ${path} ${message}`);
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
    case 'finite':
      break;
    case 'positiveInteger':
      if (!(Number.isInteger(raw) && raw >= 1)) fail(path, `must be an integer >= 1, got ${raw}`);
      break;
    case 'negativeInteger':
      if (!(Number.isInteger(raw) && raw < 0)) fail(path, `must be a negative integer, got ${raw}`);
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

function readPropFootprint(raw: unknown, path: string): PropFootprint {
  if (!isRecord(raw)) fail(path, `must be an object, got ${describeValue(raw)}`);
  const shape = raw.shape;
  if (shape === 'circle') {
    const obj = readObject(raw, path, ['shape', 'radiusM']);
    return { shape, radiusM: readNumber(obj.radiusM, `${path}.radiusM`, 'positive') };
  }
  if (shape === 'box') {
    const obj = readObject(raw, path, ['shape', 'widthM', 'lengthM']);
    return {
      shape,
      widthM: readNumber(obj.widthM, `${path}.widthM`, 'positive'),
      lengthM: readNumber(obj.lengthM, `${path}.lengthM`, 'positive'),
    };
  }
  return fail(`${path}.shape`, `must be "circle" or "box", got ${describeValue(shape)}`);
}

/** `propFootprints`: a provisional flag and exactly one footprint per STATIC_PROP_IDS entry. */
function readPropFootprints(raw: unknown, path: string): PropFootprints {
  const obj = readObject(raw, path, ['provisional', 'shapes']);
  const provisional = obj.provisional;
  if (typeof provisional !== 'boolean') {
    fail(`${path}.provisional`, `must be a boolean, got ${describeValue(provisional)}`);
  }
  const shapesRaw = readObject(obj.shapes, `${path}.shapes`, STATIC_PROP_IDS);
  const shapes: Partial<Record<StaticPropId, PropFootprint>> = {};
  for (const id of STATIC_PROP_IDS) {
    shapes[id] = readPropFootprint(shapesRaw[id], `${path}.shapes.${id}`);
  }
  // Every STATIC_PROP_IDS key was written just above (readObject proved none is missing or unknown).
  return { provisional, shapes: shapes as PropFootprints['shapes'] };
}

/** `knockables`: a provisional flag, the contact, spin and spill groups and one body per KNOCKABLE_IDS entry. */
function readKnockables(raw: unknown, path: string): KnockablesTuning {
  const obj = readObject(raw, path, ['provisional', 'contact', 'spin', 'spill', 'bodies']);
  const provisional = obj.provisional;
  if (typeof provisional !== 'boolean') {
    fail(`${path}.provisional`, `must be a boolean, got ${describeValue(provisional)}`);
  }
  const bodiesRaw = readObject(obj.bodies, `${path}.bodies`, KNOCKABLE_IDS);
  const bodies: Partial<Record<KnockableId, KnockableBodyTuning>> = {};
  for (const id of KNOCKABLE_IDS) {
    bodies[id] = readGroup(bodiesRaw[id], `${path}.bodies.${id}`, KNOCKABLE_BODY_SPEC);
  }
  return {
    provisional,
    contact: readGroup(obj.contact, `${path}.contact`, KNOCKABLE_CONTACT_SPEC),
    spin: readGroup(obj.spin, `${path}.spin`, KNOCKABLE_SPIN_SPEC),
    spill: readGroup(obj.spill, `${path}.spill`, KNOCKABLE_SPILL_SPEC),
    // Every KNOCKABLE_IDS key was written just above (readObject proved none is missing or unknown).
    bodies: bodies as KnockablesTuning['bodies'],
  };
}

/** Tolerance for sums of short JSON decimals (0.6 + 0.4). */
const SUM_EPS = 1e-9;

/** A min/max rect must have positive extent on both axes. */
function checkRect(r: { minXM: number; maxXM: number; minYM: number; maxYM: number }, path: string): void {
  if (!(r.minXM < r.maxXM)) fail(path, `minXM (${r.minXM}) must be below maxXM (${r.maxXM})`);
  if (!(r.minYM < r.maxYM)) fail(path, `minYM (${r.minYM}) must be below maxYM (${r.maxYM})`);
}

function readSweeping(raw: unknown, path: string): SweepingTuning {
  const obj = readObject(raw, path, Object.keys(SWEEPING_GROUPS));
  const g = SWEEPING_GROUPS;
  const sweeping: SweepingTuning = {
    gutterBrush: readGroup(obj.gutterBrush, `${path}.gutterBrush`, g.gutterBrush),
    suction: readGroup(obj.suction, `${path}.suction`, g.suction),
    inlet: readGroup(obj.inlet, `${path}.inlet`, g.inlet),
    grimeFootprint: readGroup(obj.grimeFootprint, `${path}.grimeFootprint`, g.grimeFootprint),
    kerbHugger: readGroup(obj.kerbHugger, `${path}.kerbHugger`, g.kerbHugger),
    fling: readGroup(obj.fling, `${path}.fling`, g.fling),
    bulldozer: readGroup(obj.bulldozer, `${path}.bulldozer`, g.bulldozer),
  };
  checkRect(sweeping.suction, `${path}.suction`);
  checkRect(sweeping.grimeFootprint, `${path}.grimeFootprint`);
  if (sweeping.fling.minDistanceM > sweeping.fling.maxDistanceM) {
    fail(`${path}.fling`, 'minDistanceM must not exceed maxDistanceM');
  }
  return sweeping;
}

/** The dump FSM counts integer ticks (shift.ts, SSP-062), so every hold and drain must be whole ticks. */
function readDumping(raw: unknown, path: string): DumpingTuning {
  const obj = readObject(raw, path, ['depotBay', 'skip']);
  const dumping = {
    depotBay: readGroup(obj.depotBay, `${path}.depotBay`, DEPOT_BAY_SPEC),
    skip: readGroup(obj.skip, `${path}.skip`, SKIP_SPEC),
  };
  for (const site of ['depotBay', 'skip'] as const) {
    for (const key of ['holdS', 'drainS'] as const) {
      const s = dumping[site][key];
      if (!Number.isInteger(s * SIM_HZ)) {
        fail(`${path}.${site}.${key}`, `must be a whole number of ${SIM_HZ} Hz ticks, got ${s}`);
      }
    }
  }
  return dumping;
}

/** `combo`: the chain timer and a non-empty tier list, strictly ascending in minChain and multiplier (> 1). */
function readCombo(raw: unknown, path: string): ComboTuning {
  const obj = readObject(raw, path, ['chainS', 'tiers']);
  const chainS = readNumber(obj.chainS, `${path}.chainS`, 'positive');
  const tiersRaw = obj.tiers;
  if (!Array.isArray(tiersRaw) || tiersRaw.length === 0) {
    fail(`${path}.tiers`, `must be a non-empty array, got ${describeValue(tiersRaw)}`);
  }
  const tiers: ComboTier[] = [];
  for (let index = 0; index < tiersRaw.length; index += 1) {
    const tierPath = `${path}.tiers[${index}]`;
    const tier = readGroup(tiersRaw[index], tierPath, COMBO_TIER_SPEC);
    const previous = tiers[index - 1];
    const floor = previous ?? { minChain: 0, multiplier: 1 };
    if (!(tier.minChain > floor.minChain)) {
      fail(tierPath, `minChain must be above ${floor.minChain} (tiers ascend), got ${tier.minChain}`);
    }
    if (!(tier.multiplier > floor.multiplier)) {
      fail(tierPath, `multiplier must be above ${floor.multiplier} (tiers ascend), got ${tier.multiplier}`);
    }
    tiers.push(tier);
  }
  return { chainS, tiers };
}

function readScoring(raw: unknown, path: string): Group<typeof SCORING_SPEC> {
  const scoring = readGroup(raw, path, SCORING_SPEC);
  if (scoring.gutterGrimeCellPts < scoring.grimeCellPts) {
    fail(path, 'gutterGrimeCellPts must not be below grimeCellPts');
  }
  return scoring;
}

/** The shift timer is an integer tick counter (TECHNICAL_DESIGN §5.1), so both times must be whole ticks. */
function readShift(raw: unknown, path: string): Group<typeof SHIFT_SPEC> {
  const shift = readGroup(raw, path, SHIFT_SPEC);
  for (const key of ['durationS', 'rolloutS'] as const) {
    if (!Number.isInteger(shift[key] * SIM_HZ)) {
      fail(`${path}.${key}`, `must be a whole number of ${SIM_HZ} Hz ticks, got ${shift[key]}`);
    }
  }
  if (shift.rolloutS >= shift.durationS) fail(path, 'rolloutS must be below durationS');
  return shift;
}

function readStars(raw: unknown, path: string): Group<typeof STARS_SPEC> {
  const stars = readGroup(raw, path, STARS_SPEC);
  if (!(stars.star1MinTidy < stars.star2MinTidy && stars.star2MinTidy < stars.star3MinTidy)) {
    fail(path, 'thresholds must ascend: star1MinTidy < star2MinTidy < star3MinTidy');
  }
  return stars;
}

function readTidy(raw: unknown, path: string): Group<typeof TIDY_SPEC> {
  const tidy = readGroup(raw, path, TIDY_SPEC);
  const sum = tidy.grimeWeight + tidy.litterWeight;
  if (Math.abs(sum - 1) > SUM_EPS) fail(path, `grimeWeight + litterWeight must be 1, got ${sum}`);
  return tidy;
}

/** Read every group of `groups` from the object at `path`, which must hold exactly those groups. */
function readGroups<G extends Readonly<Record<string, GroupSpec>>>(
  raw: unknown,
  path: string,
  groups: G,
): { readonly [K in keyof G]: Group<G[K]> } {
  const obj = readObject(raw, path, Object.keys(groups));
  const out: Record<string, Group<GroupSpec>> = {};
  for (const [name, spec] of Object.entries(groups))
    out[name] = readGroup(obj[name], `${path}.${name}`, spec);
  // Every group of G was written just above.
  return out as { readonly [K in keyof G]: Group<G[K]> };
}

/** An upgraded value must not be below its base value. */
function checkNotBelow(value: number, base: number, path: string, what: string): void {
  if (value < base) fail(path, `${what} (${value}) must not be below the base value (${base})`);
}

function readStreetLife(raw: unknown, path: string): StreetLifeTuning {
  const streetLife = readGroups(raw, path, STREET_LIFE_GROUPS);
  const { awareness, horn } = streetLife;
  checkNotBelow(awareness.ledBeaconRadiusM, awareness.radiusM, `${path}.awareness`, 'ledBeaconRadiusM');
  checkNotBelow(horn.twoToneRadiusM, horn.radiusM, `${path}.horn`, 'twoToneRadiusM');
  return streetLife;
}

function readComplaints(raw: unknown, path: string): ComplaintsTuning {
  const complaints = readGroups(raw, path, COMPLAINT_GROUPS);
  const { hornSpam } = complaints;
  checkNotBelow(hornSpam.twoToneMaxHonks, hornSpam.maxHonks, `${path}.hornSpam`, 'twoToneMaxHonks');
  return complaints;
}

/**
 * Validate raw tuning data (the parsed JSON, or an edited copy of it) and return a new typed Tuning object.
 * Throws an Error naming the JSON path on any missing, unknown, mistyped or out-of-range value. Every call
 * builds a fresh object, so callers may hold or hand on their own copy.
 */
export function loadTuning(raw: unknown): Tuning {
  const root = readObject(raw, 'root', ROOT_KEYS);
  const vehicle = readObject(root.vehicle, 'vehicle', ['sweeper']);
  return {
    vehicle: { sweeper: readSweeper(vehicle.sweeper, 'vehicle.sweeper') },
    propFootprints: readPropFootprints(root.propFootprints, 'propFootprints'),
    knockables: readKnockables(root.knockables, 'knockables'),
    sweeping: readSweeping(root.sweeping, 'sweeping'),
    hopper: readGroup(root.hopper, 'hopper', HOPPER_SPEC),
    water: readGroup(root.water, 'water', WATER_SPEC),
    dumping: readDumping(root.dumping, 'dumping'),
    combo: readCombo(root.combo, 'combo'),
    scoring: readScoring(root.scoring, 'scoring'),
    shift: readShift(root.shift, 'shift'),
    stars: readStars(root.stars, 'stars'),
    tidy: readTidy(root.tidy, 'tidy'),
    streetLife: readStreetLife(root.streetLife, 'streetLife'),
    complaints: readComplaints(root.complaints, 'complaints'),
    endStates: readGroup(root.endStates, 'endStates', END_STATES_SPEC),
  };
}

/**
 * The committed src/data/tuning.json, validated at module load. The composition root (and tests) pass this
 * into the sim explicitly; sim code must take a Tuning parameter instead of importing this.
 */
export const DEFAULT_TUNING: Tuning = loadTuning(tuningJson);

/**
 * The committed src/data/entities.json, validated at module load (SSP-053). Like DEFAULT_TUNING, the
 * composition root passes it into the sim; sim code takes an Entities parameter instead of importing this.
 */
export const DEFAULT_ENTITIES: Entities = loadEntities(entitiesJson);

/**
 * A deep copy of the committed src/data/tuning.json as parsed JSON (degrees, not radians). The dev panel
 * (SSP-048) edits such a copy, validates it with loadTuning and hands the result to the World; comparing the
 * copy with a fresh one tells it which values differ from the committed file. Load-time code: allocates.
 */
export function tuningSourceCopy(): unknown {
  return JSON.parse(JSON.stringify(tuningJson));
}

/**
 * True when two values of plain JSON-like data (numbers, strings, booleans, null, arrays, and objects with the
 * same own keys) are equal all the way down. Numbers compare with Object.is, so −0 differs from 0 (a Tuning
 * holds no −0 or NaN). Tells whether a Tuning is the committed one (DEFAULT_TUNING). Not for the tick path.
 */
export function tuningsEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!isPlainData(a) || !isPlainData(b)) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keysA = Object.keys(a);
  if (keysA.length !== Object.keys(b).length) return false;
  for (const key of keysA) {
    if (!Object.hasOwn(b, key) || !tuningsEqual(Reflect.get(a, key), Reflect.get(b, key))) return false;
  }
  return true;
}

function isPlainData(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}
