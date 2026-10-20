// The NPC budget's stress fixture (SSP-106; TECHNICAL_DESIGN §17, ROADMAP M3 "NPC budget"): compiled High Street
// with its caps overridden so that every M3 store runs at its §7.1 capacity, plus the director that keeps it there
// and makes every M3 behaviour happen while it does. Test-only: `?test=1&scene=stress` (src/scenes/StressScene.ts)
// runs it in the shipping bundle for tests/e2e/perf.spec.ts, and tests/unit/stressAlloc.test.ts runs the same World
// in Node for the §17 heap-delta check and the Node sim step time. Nothing outside test mode reaches it.
//
// The level (stressLevel, a pure function of the compiled High Street, applied before the World is created):
//   - litter: `initial` = the LitterField's capacity (2,000);
//   - knockables: the 16 authored ones, then wheelie bins, cones, A-boards, trolleys and recycling boxes on pavement
//     tile centres spread over the map up to the body store's capacity (128);
//   - hazards: puddles, oil slicks, potholes and wet leaves on carriageway tile centres spread over the map up to the
//     hazard store's capacity (64; no open manhole, whose hard stop would pin Bessie, and no broken glass, which the
//     brush sweeps away, so the store stays full);
//   - NPCs: one population window of 80 for the whole (endless) shift over a mix of every M3 person (Doris and the
//     dog walkers among them), the 12 market traders, the two pigeon flocks, six cats on the parked car roofs and
//     mid-road grooming spots, and Doris named from the first second;
//   - traffic: every bay full (20 parked cars and vans) and a moving target of the store's room left (10), with the
//     bus on its route, taxis, bicycles and a mobility scooter on the pavement: 30 vehicles.
// The tuning (stressTuning): tuning.json with the shift endless and SACKED out of reach (the director's actor hits
// file complaints), so the World never freezes inside a measurement.
//
// The director (createStressDirector): one call per tick, before world.step, writing that tick's input and poking
// the World the way the per-system heap tests do (tests/unit/npcAlloc.test.ts and its siblings), so the window holds
// the work under test whatever the crowd does:
//   - Bessie drives the High Street spine's gutter lanes with the brush down at sweeping speed, put back at one of
//     four starts every 20 s (so the spawner recycles the crowd round her and traffic queues behind her);
//   - every 6 s she stops and sprays for 1.5 s with a Doris put 2 m ahead of her bumper (glare, chase, handbag
//     whacks); as the spray ends a litterbug is put beside her for the horn to catch;
//   - every 3 s someone is put just ahead of her nose (an actor hit), 0.75 s later a cat is hit (a Hit stimulus: it
//     leaps onto her roof, rides it and hops off) and 1.5 s later a dog walker and its dog are put either side of her
//     path (Lead Tangle); she honks every 0.5 s (PRESSED.HORN: bolting cats, Caught!, the horn rules);
//   - every 0.25 s one item of litter at rest is moved into her path, so the brush keeps collecting; her HP and tank
//     are topped up every tick, a full hopper is emptied as a skip would, and the litter the brush took is put back
//     where the shift started it (one item a tick, round robin), so the LitterField stays at 2,000.
// Everything is a pure function of the tick and the World, so the browser scene and the Node test run the same
// World. The director allocates nothing per tick and passes no double across a call (TECHNICAL_DESIGN §17).
import tuningJson from '../data/tuning.json' with { type: 'json' };
import { BODY_CAPACITY } from '../sim/bodies.ts';
import { BrushState } from '../sim/brush.ts';
import { TILE_M } from '../sim/constants.ts';
import { NPC_IDS } from '../sim/entities.ts';
import { cos, sin } from '../sim/fmath.ts';
import { HAZARD_CAPACITY } from '../sim/hazards.ts';
import { DumpSite, startHopperDrain, stepHopperDrain } from '../sim/hopper.ts';
import { BUTTON, createInputFrame, type InputFrame, PRESSED, THROTTLE_MAX } from '../sim/inputFrame.ts';
import { addLitterAt, LITTER_CAPACITY, updateLitterCell } from '../sim/litter.ts';
import {
  COLLIDE,
  Ground,
  type KnockableSpawn,
  type Level,
  type NpcSpawn,
  type PlacedHazard,
  type TrafficSpawn,
} from '../sim/map.ts';
import { Stimulus } from '../sim/npc/behaviour.ts';
import { leadDog } from '../sim/npc/behaviours/dogWalker.ts';
import { pushStimulus } from '../sim/npc/stimuli.ts';
import { NPC_CAPACITY, NPC_FLAG, NpcOrigin, npcHandle, updateNpcCell } from '../sim/npc/store.ts';
import { DEFAULT_TUNING, loadTuning, type Tuning } from '../sim/tuning.ts';
import { VEHICLE_CAPACITY } from '../sim/vehicleStore.ts';
import { refillWater } from '../sim/water.ts';
import type { World } from '../sim/world.ts';

/** The district the fixture is built on (its compiled level is fetched as for a shift). */
export const STRESS_DISTRICT = 'district.high_street';

/** The fixture's timer: 100,000 s, so no measurement ever reaches the knock-off (tests/support/endlessShift.ts). */
export const STRESS_SHIFT_S = 100_000;

/** The knockables the fixture adds, in turn (KNOCKABLE_IDS). */
const EXTRA_KNOCKABLES = [
  'prop.wheelie_bin',
  'prop.traffic_cone',
  'prop.a_board',
  'prop.shopping_trolley',
  'prop.recycling_box',
] as const;

/** The hazards the fixture places, in turn (no open manhole: its hard stop would pin Bessie). */
const STRESS_HAZARDS = ['haz.puddle', 'haz.oil_slick', 'haz.pothole', 'haz.wet_leaves'] as const;

/** The ambient mix: every M3 person, Doris and the dog walkers among them (entities.json ids, sorted). */
const STRESS_MIX: readonly { id: string; weight: number }[] = [
  { id: 'npc.businessman', weight: 12 },
  { id: 'npc.dog_walker', weight: 18 },
  { id: 'npc.litterbug', weight: 14 },
  { id: 'npc.mum_pushchair', weight: 8 },
  { id: 'npc.old_man_frame', weight: 6 },
  { id: 'npc.old_woman', weight: 12 },
  { id: 'npc.postie', weight: 6 },
  { id: 'npc.shopper', weight: 24 },
];

/** Cats the fixture perches (on the parked cars' roofs and mid-road grooming spots). */
const STRESS_CATS = 6;

/** True when tile `t` is open pavement: ground Pavement, nothing solid, no marking. */
function isOpenPavement(level: Level, t: number): boolean {
  return (
    level.layers.ground[t] === Ground.Pavement &&
    ((level.layers.collide[t] as number) & COLLIDE.SOLID) === 0 &&
    level.layers.markings[t] === 0
  );
}

/** True when tile `t` is plain two-way or one-way carriageway with no marking (no zebra, no bay line). */
function isPlainRoad(level: Level, t: number): boolean {
  const g = level.layers.ground[t] as number;
  return (
    g >= Ground.Road &&
    g <= Ground.RoadOneWayS &&
    ((level.layers.collide[t] as number) & COLLIDE.SOLID) === 0 &&
    level.layers.markings[t] === 0
  );
}

/** Tiles holding a prop (its centre's tile), so a knockable or a hazard is never put on one. */
function propTiles(level: Level): Set<number> {
  const w = level.size[0];
  const out = new Set<number>();
  for (const p of level.props) out.add(Math.floor(p.y / TILE_M) * w + Math.floor(p.x / TILE_M));
  return out;
}

/** `n` of `tiles` (row-major), evenly spread: the k-th is tiles[floor((k + 0.5) × len / n)]. */
function spread(tiles: readonly number[], n: number, what: string): number[] {
  if (tiles.length < n) throw new Error(`stressLevel: only ${tiles.length} tiles for ${n} ${what}`);
  const out: number[] = [];
  for (let k = 0; k < n; k++) out.push(tiles[Math.floor(((k + 0.5) * tiles.length) / n)] as number);
  return out;
}

/**
 * The stress fixture's level: compiled High Street (`level`, decoded) with every store's spawn spec raised to its
 * capacity (see the header). Throws if `level` is not High Street or lacks the spawn specs the fixture overrides.
 */
export function stressLevel(level: Level): Level {
  if (level.id !== STRESS_DISTRICT) throw new Error(`stressLevel: needs ${STRESS_DISTRICT}, got ${level.id}`);
  const { litter, npc, traffic, knockables } = level;
  if (litter === null || npc === null || traffic === null || knockables === null) {
    throw new Error('stressLevel: High Street must carry litter, npc, traffic and knockables specs');
  }
  const [w, h] = level.size;
  const taken = propTiles(level);
  for (const k of knockables) taken.add(Math.floor(k.y / TILE_M) * w + Math.floor(k.x / TILE_M));
  const player = Math.floor(level.player.y / TILE_M) * w + Math.floor(level.player.x / TILE_M);
  const pavement: number[] = [];
  const road: number[] = [];
  for (let t = 0; t < w * h; t++) {
    if (taken.has(t)) continue;
    const col = t % w;
    const row = (t - col) / w;
    // Keep clear of the depot start, so the shift begins as it does on High Street.
    const pc = player % w;
    const pr = (player - pc) / w;
    if (Math.abs(col - pc) <= 3 && Math.abs(row - pr) <= 3) continue;
    if (isOpenPavement(level, t)) pavement.push(t);
    else if (isPlainRoad(level, t)) road.push(t);
  }
  const centre = (t: number): [number, number] => {
    const col = t % w;
    return [(col + 0.5) * TILE_M, ((t - col) / w + 0.5) * TILE_M];
  };

  const extraKnockables: KnockableSpawn[] = spread(
    pavement,
    BODY_CAPACITY - knockables.length,
    'knockables',
  ).map((t, k) => {
    const [x, y] = centre(t);
    return { id: EXTRA_KNOCKABLES[k % EXTRA_KNOCKABLES.length] as string, x, y };
  });
  let bumps = 0;
  for (const site of level.sites) if (site.id === 'haz.speed_bump') bumps++;
  const placed = level.hazards?.place.length ?? 0;
  const hazards: PlacedHazard[] = spread(road, HAZARD_CAPACITY - bumps - placed, 'hazards').map((t, k) => {
    const [x, y] = centre(t);
    return { id: STRESS_HAZARDS[k % STRESS_HAZARDS.length] as string, x, y };
  });

  const npcSpec: NpcSpawn = {
    population: [{ fromS: 0, toS: STRESS_SHIFT_S, target: NPC_CAPACITY }],
    mix: STRESS_MIX.map((m) => ({ id: m.id, weight: m.weight })),
    caps: [],
    named: npc.named.map((n) => ({ ...n, spawnAtS: 0, route: [...n.route] })),
    perches: {
      id: 'npc.cat',
      count: STRESS_CATS,
      on: ['carRoofs', 'road'],
      walls: [],
    },
    flocks: npc.flocks.map((f) => ({
      ...f,
      size: [f.size[0], f.size[1]],
      points: f.points.map((p) => [p[0], p[1]]),
    })),
  };
  const trafficSpec: TrafficSpawn = {
    ...traffic,
    parkedFill: 1,
    parked: traffic.parkedBays,
    moving: VEHICLE_CAPACITY - traffic.parkedBays,
    pavement: [{ id: 'veh.mobility_scooter', count: 1 }],
    taxiRank: traffic.taxiRank.map((p) => [p[0], p[1]]),
    busRoute: [...traffic.busRoute],
  };
  return {
    ...level,
    timerS: STRESS_SHIFT_S,
    litter: { ...litter, initial: LITTER_CAPACITY },
    knockables: [...knockables, ...extraKnockables],
    hazards: {
      place: [...(level.hazards?.place ?? []), ...hazards],
      random: [],
      candidates: level.hazards?.candidates ?? new Uint8Array(w * h),
    },
    npc: npcSpec,
    traffic: trafficSpec,
  };
}

/** The fixture's tuning: tuning.json with the shift endless and SACKED out of reach (see the header). */
export function stressTuning(): Tuning {
  const raw = structuredClone(tuningJson);
  raw.shift.durationS = STRESS_SHIFT_S;
  raw.complaints.meter.sackedAt = 1_000_000_000;
  return loadTuning(raw);
}

// ---------------------------------------------------------------------------------------------------------
// The director (per tick: no allocation, no double across a call)
// ---------------------------------------------------------------------------------------------------------
//
// V8 (TECHNICAL_DESIGN §17): code that runs only every few seconds stays in V8's lower tiers, which box every
// double they compute or pass. So the director's work is one function whose straight-line part runs every tick
// (the trig, the placement points, the litter and hopper upkeep) and whose rare branches only pick indices; the
// placements are then written by a loop that runs every tick (usually over nothing).

/** Bessie's sweeping speed: under the brush's clean pickup limit (4.0 m/s), so the brush collects. */
const SWEEP_MPS = 3.5;
/** Ticks between Bessie's hops to the next start. */
const HOP_TICKS = 1200;
/**
 * Her four starts on the spine (x, y metres; heading rad), in the gutter lanes so the brush meets the kerbside
 * litter: two eastbound, two westbound, each with 40 m of road ahead.
 */
const HOPS = Float64Array.from([
  16,
  53.4,
  Math.PI / 2,
  90,
  53.4,
  Math.PI / 2,
  144,
  58.6,
  -Math.PI / 2,
  70,
  58.6,
  -Math.PI / 2,
]);
/** One spray cycle, ticks: she sprays for the first SPRAY_TICKS of it, stopped, with a Doris ahead. */
const SPRAY_CYCLE_TICKS = 360;
const SPRAY_TICKS = 90;
/** The street beat: someone in her path, a hit cat (a quarter on), a dog walker's lead (half on), ticks. */
const BEAT_TICKS = 180;
/** Ticks between two honks (PRESSED.HORN: Horn stimuli, bolting cats, Caught!). */
const HORN_TICKS = 30;

const DORIS_KIND = (NPC_IDS as readonly string[]).indexOf('npc.old_woman');
const LITTERBUG_KIND = (NPC_IDS as readonly string[]).indexOf('npc.litterbug');
const CAT_KIND = (NPC_IDS as readonly string[]).indexOf('npc.cat');
const PIGEON_KIND = (NPC_IDS as readonly string[]).indexOf('npc.pigeon');
const TRADER_KIND = (NPC_IDS as readonly string[]).indexOf('npc.market_trader');
const DOG_WALKER_KIND = (NPC_IDS as readonly string[]).indexOf('npc.dog_walker');

/** Bessie's half length plus a little: where someone is put in her way, metres ahead of her centre. */
const NOSE_M = DEFAULT_TUNING.vehicle.sweeper.body.lengthM / 2 + 0.6;

/**
 * The placement points (StressDirector.spot), each `ahead` metres ahead of Bessie's centre and `right` to her
 * right: Doris 2 m off her front bumper, a litterbug 3 m to her right (inside the 6 m Caught! radius), someone at
 * her nose, and a dog walker and its dog either side of her path 1 m further on.
 */
const SPOT = { Doris: 0, Litterbug: 1, Nose: 2, Walker: 3, Dog: 4 } as const;
const SPOT_AHEAD = Float64Array.from([1.625 + 2, 0, NOSE_M, NOSE_M + 1, NOSE_M + 1]);
const SPOT_RIGHT = Float64Array.from([0, 3, 0, -2, 2]);
const SPOTS = SPOT_AHEAD.length;
/** Placements a tick can make (a litterbug, a dog walker and its dog). */
const MAX_PLACEMENTS = 3;
/**
 * The litter feed: every LITTER_FEED_TICKS one item at rest (round robin over the field) is moved into Bessie's
 * path, LITTER_FEED_AHEAD_M + 0..7 m ahead of her centre and up to 0.4 m either side, so the brush keeps collecting
 * once her four runs are swept clean (litterbugs, dogs, spills and hits keep the field full whatever she collects).
 */
const LITTER_FEED_TICKS = 15;
const LITTER_FEED_AHEAD_M = 6;

/** What the director keeps between ticks (createStressDirector). */
export type StressDirector = {
  /** The input it hands world.step each tick. */
  readonly input: InputFrame;
  /** The shift-start litter (positions and kinds), put back one item a tick while the field is short. */
  readonly litterCount: number;
  readonly litterX: Float64Array;
  readonly litterY: Float64Array;
  readonly litterKind: Uint8Array;
  /** The next shift-start item to put back. */
  litterNext: number;
  /** This tick's placement points (SPOT, then the litter feed's), x and y interleaved, metres. */
  readonly spot: Float64Array;
  /** The next litter item the feed looks at. */
  feedNext: number;
  /** This tick's placements: NPC index and SPOT, `placements` of them. */
  readonly placeNpc: Int32Array;
  readonly placeSpot: Int32Array;
  placements: number;
  /** An addLitterAt position. */
  readonly at: Float64Array;
  /** Round-robin cursors over the NPC store: the next cat to hit, person to put in her path, dog walker. */
  nextCat: number;
  nextPerson: number;
  nextWalker: number;
  /** Counters for the tests (all since creation). */
  catsHit: number;
  peoplePlaced: number;
  leadsPlaced: number;
  dorisPlaced: number;
  litterbugsPlaced: number;
  litterPutBack: number;
  litterFed: number;
};

/** A director for `world` (a stressLevel World, just created: it records the shift-start litter). Setup only. */
export function createStressDirector(world: World): StressDirector {
  const field = world.litter;
  const n = field.count;
  return {
    input: createInputFrame(),
    litterCount: n,
    litterX: Float64Array.from(field.x.subarray(0, n)),
    litterY: Float64Array.from(field.y.subarray(0, n)),
    litterKind: Uint8Array.from(field.kind.subarray(0, n)),
    litterNext: 0,
    spot: new Float64Array(SPOTS * 2 + 2),
    feedNext: 0,
    placeNpc: new Int32Array(MAX_PLACEMENTS),
    placeSpot: new Int32Array(MAX_PLACEMENTS),
    placements: 0,
    at: new Float64Array(2),
    nextCat: 0,
    nextPerson: 0,
    nextWalker: 0,
    catsHit: 0,
    peoplePlaced: 0,
    leadsPlaced: 0,
    dorisPlaced: 0,
    litterbugsPlaced: 0,
    litterPutBack: 0,
    litterFed: 0,
  };
}

/** Queue NPC i for spot `spot` this tick. Integers only. */
function queuePlacement(d: StressDirector, i: number, spot: number): void {
  const n = d.placements;
  d.placeNpc[n] = i;
  d.placeSpot[n] = spot;
  d.placements = n + 1;
}

/** The first live NPC of `kind` from index `from` (wrapping) that is not leaving or on a roof, or −1. Integers only. */
function findNpc(world: World, kind: number, from: number): number {
  const npc = world.npc;
  const n = npc.count;
  for (let k = 0; k < n; k++) {
    const i = (from + k) % n;
    if (npc.kind[i] !== kind) continue;
    if (((npc.flags[i] as number) & (NPC_FLAG.LEAVING | NPC_FLAG.ON_ROOF)) !== 0) continue;
    if (kind === DOG_WALKER_KIND && leadDog(npc, i) < 0) continue;
    return i;
  }
  return -1;
}

/**
 * The first person from `from` (wrapping) to put in Bessie's path: not a cat, bird, trader, litterbug (the horn
 * would catch him), dog or leaver; or −1. Integers only.
 */
function findPerson(world: World, from: number): number {
  const npc = world.npc;
  const n = npc.count;
  for (let k = 0; k < n; k++) {
    const i = (from + k) % n;
    const kind = npc.kind[i] as number;
    if (kind === CAT_KIND || kind === PIGEON_KIND || kind === TRADER_KIND || kind === LITTERBUG_KIND)
      continue;
    if (npc.origin[i] === NpcOrigin.Companion) continue;
    if (((npc.flags[i] as number) & (NPC_FLAG.LEAVING | NPC_FLAG.ON_ROOF)) !== 0) continue;
    return i;
  }
  return -1;
}

/**
 * The director's tick (see the header): pokes `world` for World tick `world.tick` and returns the input to step it
 * with (d.input). Call it once a tick, just before world.step.
 */
export function directStress(d: StressDirector, world: World): Readonly<InputFrame> {
  const t = world.tick;
  const v = world.vehicle;
  const npc = world.npc;
  if (t % HOP_TICKS === 0) {
    // Back to one of the four starts, at rest, her previous pose with her (a jump left in her axle segment would
    // read as a kerb crossing).
    const k = ((t / HOP_TICKS) & 3) * 3;
    v.xM = HOPS[k] as number;
    v.yM = HOPS[k + 1] as number;
    v.headingRad = HOPS[k + 2] as number;
    v.prevXM = v.xM;
    v.prevYM = v.yM;
    v.prevHeadingRad = v.headingRad;
    v.vLongMps = 0;
    v.vLatMps = 0;
    v.yawRateRadPerS = 0;
  }
  const cycle = t % SPRAY_CYCLE_TICKS;
  const spraying = cycle < SPRAY_TICKS;
  if (cycle === 0) {
    v.vLongMps = 0;
    v.vLatMps = 0;
    v.yawRateRadPerS = 0;
  }
  // The placement points round her pose, every tick.
  const s = sin(v.headingRad);
  const c = cos(v.headingRad);
  const spot = d.spot;
  for (let p = 0; p < SPOTS; p++) {
    const ahead = SPOT_AHEAD[p] as number;
    const right = SPOT_RIGHT[p] as number;
    spot[p * 2] = v.xM + s * ahead + c * right;
    spot[p * 2 + 1] = v.yM - c * ahead + s * right;
  }
  const feed = (t >> 4) & 7;
  const feedAhead = LITTER_FEED_AHEAD_M + feed;
  const feedRight = ((feed % 3) - 1) * 0.4;
  spot[SPOTS * 2] = v.xM + s * feedAhead + c * feedRight;
  spot[SPOTS * 2 + 1] = v.yM - c * feedAhead + s * feedRight;
  d.placements = 0;
  if (cycle === 0) {
    // The spray starts: a Doris 2 m off her bumper.
    const i = findNpc(world, DORIS_KIND, 0);
    if (i >= 0) {
      queuePlacement(d, i, SPOT.Doris);
      d.dorisPlaced++;
    }
  } else if (cycle === SPRAY_TICKS) {
    // The spray has ended: a litterbug beside her for the next honk to catch.
    const i = findNpc(world, LITTERBUG_KIND, 0);
    if (i >= 0) {
      queuePlacement(d, i, SPOT.Litterbug);
      d.litterbugsPlaced++;
    }
  }
  const beat = t % BEAT_TICKS;
  if (beat === 0 && npc.count > 0) {
    // Someone just ahead of her nose: an actor hit, unless they see her coming and yield.
    const i = findPerson(world, d.nextPerson % npc.count);
    if (i >= 0) {
      queuePlacement(d, i, SPOT.Nose);
      d.nextPerson = i + 1;
      d.peoplePlaced++;
    }
  } else if (beat === BEAT_TICKS / 4 && npc.count > 0) {
    // A cat hit: it leaps onto her roof, rides it and hops off.
    const i = findNpc(world, CAT_KIND, d.nextCat % npc.count);
    if (i >= 0) {
      pushStimulus(world.npcAi.stimuli, Stimulus.Hit, npcHandle(npc, i));
      d.nextCat = i + 1;
      d.catsHit++;
    }
  } else if (beat === BEAT_TICKS / 2 && npc.count > 0) {
    // A dog walker and its dog either side of her path: the lead across it (Lead Tangle).
    const i = findNpc(world, DOG_WALKER_KIND, d.nextWalker % npc.count);
    if (i >= 0) {
      queuePlacement(d, i, SPOT.Walker);
      queuePlacement(d, leadDog(npc, i), SPOT.Dog);
      d.nextWalker = i + 1;
      d.leadsPlaced++;
    }
  }
  for (let p = 0; p < d.placements; p++) {
    const i = d.placeNpc[p] as number;
    const k = (d.placeSpot[p] as number) * 2;
    npc.x[i] = spot[k] as number;
    npc.y[i] = spot[k + 1] as number;
    updateNpcCell(npc, i);
  }
  // The litter feed: one item at rest into her path.
  const field = world.litter;
  if (t % LITTER_FEED_TICKS === 0 && field.count > 0) {
    const i = d.feedNext % field.count;
    if ((field.flags[i] as number) === 0) {
      field.x[i] = spot[SPOTS * 2] as number;
      field.y[i] = spot[SPOTS * 2 + 1] as number;
      field.prevX[i] = field.x[i] as number;
      field.prevY[i] = field.y[i] as number;
      updateLitterCell(field, i);
      d.litterFed++;
    }
    d.feedNext = i + 1;
  }
  // The litter the brush took goes back where the shift started it, one item a tick.
  const k = d.litterNext;
  d.at[0] = d.litterX[k] as number;
  d.at[1] = d.litterY[k] as number;
  if (field.count < field.capacity && d.litterCount > 0) {
    addLitterAt(field, d.litterKind[k] as number, d.at, 0);
    d.litterNext = k + 1 === d.litterCount ? 0 : k + 1;
    d.litterPutBack++;
  }
  // A full hopper is emptied over 3 s, as a skip would; HP and the tank are topped up.
  const hopper = world.hopper;
  if (hopper.full && hopper.drainSite === 0) startHopperDrain(hopper, DumpSite.Skip, 180);
  if (hopper.drainSite !== 0) stepHopperDrain(hopper);
  v.hp = 100;
  if (t % 60 === 0) refillWater(world.water);
  // The input: brush down, sweeping speed between sprays, a honk every half second.
  const input = d.input;
  input.steer = 0;
  input.brake = 0;
  input.buttons = spraying ? BUTTON.SPRAY : 0;
  input.throttle = !spraying && v.vLongMps < SWEEP_MPS ? THROTTLE_MAX : 0;
  input.pressed =
    (world.brush.state === BrushState.Raised ? PRESSED.BRUSH : 0) | (t % HORN_TICKS === 0 ? PRESSED.HORN : 0);
  return input;
}
