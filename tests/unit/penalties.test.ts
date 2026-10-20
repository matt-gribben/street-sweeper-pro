// The table-driven penalty test (SSP-108; ROADMAP M3 exit "Penalties"; GDD §11.2, ENTITY_CATALOG §3.3, §6.1,
// §9.1): every M3 hit and offence is triggered in a minimal World fixture, through the full World.step, and the
// points, complaints, combo chain and side effects (dropped shopping, spilled litter, dent HP) the sim applies are
// asserted against the values READ from entities.json and tuning.json.
//
// Each row has a fixture builder (`build`: a small World on the data it is given, the actor or prop placed by
// hand, Bessie aimed at it) and an expectation (`expect`: what the data says the offence costs). Every row runs
// twice: on the committed data, and on ALTERED, a copy with different numbers (every hit and Lead Tangle pts ×2
// and complaints +1, every hit drop +1; every knockable pts ×2 and spills +1; every parked car dentPts ×2 and
// dentHp +1; tuning.json splash pts ×2 and complaintEvery 3 → 2, dust pts ×2 and everyS 2 → 1, zebra pts ×2 and
// complaints +1). The sim must apply the altered values, so no number can be hard-coded in it. A guard checks
// that ALTERED changes every row's expectation, so the second run is never a repeat of the first.
//
// Before the trigger a 12-pickup chain (×2) with a timer that cannot run out is set going: a row with a penalty
// (pts below 0 or a complaint) must end with the chain at 0; a row without one (the cone and the trolley) must
// leave it at 12. The penalty facts phase 9 consumes are watched too, so each row proves its offence code.
//
// Out of scope here (SSP-108): the police witness's +1 complaint within 15 m and the Inspector (M6). The
// complaint-only rules and SACKED are tests/unit/complaints.rules.test.ts; the docs mirror of these numbers is
// tests/unit/entityCatalog.test.ts.
import { describe, expect, it } from 'vitest';
import entitiesJson from '../../src/data/entities.json' with { type: 'json' };
import tuningJson from '../../src/data/tuning.json' with { type: 'json' };
import { comboMultiplierFor } from '../../src/sim/combo.ts';
import { Offence } from '../../src/sim/complaints.ts';
import {
  type Entities,
  KNOCKABLE_IDS,
  type KnockableId,
  LITTER_IDS,
  NPC_IDS,
  type NpcId,
  VEHICLE_IDS,
} from '../../src/sim/entities.ts';
import { countEvents, EV } from '../../src/sim/eventQueue.ts';
import { addHazard, hazardKindIndex } from '../../src/sim/hazards.ts';
import { createInputFrame, PRESSED } from '../../src/sim/inputFrame.ts';
import { Ground, LANE_FLAG, type Level } from '../../src/sim/map.ts';
import { DOG } from '../../src/sim/npc/behaviours/dogWalker.ts';
import {
  enterPedestrianState,
  PED,
  pedestrianBehaviour,
  stationaryPedestrianBehaviour,
} from '../../src/sim/npc/behaviours/pedestrian.ts';
import { TILE_TARGET } from '../../src/sim/npc/catPerches.ts';
import {
  addNpcAt,
  NpcOrigin,
  npcHandle,
  resolveNpcHandle,
  setNpcState,
  updateNpcCell,
} from '../../src/sim/npc/store.ts';
import { spawnLaneVehicle } from '../../src/sim/traffic.ts';
import { loadEntities, loadTuning, type Tuning } from '../../src/sim/tuning.ts';
import { createWorld, Phase, type World } from '../../src/sim/world.ts';
import { addCat, CAT_STREET, compileCatTown, tileCentre } from '../support/catTown.ts';
import { levelFromCollideGrid } from '../support/collisionWorld.ts';
import { npcTown } from '../support/npcTown.ts';
import { compileTown } from '../support/steeringTown.ts';
import { compileTrafficTown, LONG_STREET, PARKING_STREET, type TownTraffic } from '../support/trafficTown.ts';

// ---------------------------------------------------------------------------------------------------------
// The data: the committed files, and the altered copy
// ---------------------------------------------------------------------------------------------------------

type EntitiesRaw = typeof entitiesJson;
type TuningRaw = typeof tuningJson;

/** One data set the rows run on: the raw JSON (for fixtures that edit their own tuning) and its loaded form. */
type Data = {
  readonly label: string;
  readonly tuningRaw: TuningRaw;
  readonly entities: Entities;
  readonly tuning: Tuning;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** The object at `key` of `o` (throws if it is not one: the altered copy must touch real fields). */
function objectAt(o: Record<string, unknown>, key: string): Record<string, unknown> {
  const v = o[key];
  if (!isRecord(v)) throw new Error(`altered data: ${key} is not an object`);
  return v;
}

/** Replace the number at `key` of `o` with f(it) (throws if it is not a number). */
function edit(o: Record<string, unknown>, key: string, f: (n: number) => number): void {
  const v = o[key];
  if (typeof v !== 'number') throw new Error(`altered data: ${key} is not a number`);
  o[key] = f(v);
}

const twice = (n: number): number => n * 2;
const plusOne = (n: number): number => n + 1;

/** entities.json with every M3 penalty number changed (see the header). */
function alteredEntities(): EntitiesRaw {
  const raw = structuredClone(entitiesJson);
  const root: Record<string, unknown> = raw;
  for (const id of [...NPC_IDS, ...VEHICLE_IDS]) {
    const e = objectAt(root, id);
    const hit = e.hit;
    if (hit === null) continue;
    if (!isRecord(hit)) throw new Error(`altered data: ${id}.hit is not an object`);
    edit(hit, 'pts', twice);
    edit(hit, 'complaints', plusOne);
    const drops = objectAt(hit, 'drops');
    for (const litter of Object.keys(drops)) edit(drops, litter, plusOne);
  }
  const tangle = objectAt(objectAt(root, 'npc.dog_walker'), 'rules');
  edit(tangle, 'tanglePts', twice);
  edit(tangle, 'tangleComplaints', plusOne);
  for (const id of KNOCKABLE_IDS) {
    const knock = objectAt(objectAt(root, id), 'knock');
    edit(knock, 'pts', twice);
    edit(knock, 'spills', plusOne);
  }
  for (const id of VEHICLE_IDS) {
    const rules = objectAt(objectAt(root, id), 'rules');
    if (!('dentPts' in rules)) continue;
    edit(rules, 'dentPts', twice);
    edit(rules, 'dentHp', plusOne);
  }
  return raw;
}

/** tuning.json with the splash, dust and zebra penalties changed (see the header). */
function alteredTuning(): TuningRaw {
  const raw = structuredClone(tuningJson);
  raw.streetLife.splash.pts *= 2;
  raw.streetLife.splash.complaintEvery -= 1;
  raw.streetLife.dust.pts *= 2;
  raw.streetLife.dust.everyS /= 2;
  raw.complaints.zebra.pts *= 2;
  raw.complaints.zebra.complaints += 1;
  return raw;
}

function makeData(label: string, entitiesRaw: EntitiesRaw, tuningRaw: TuningRaw): Data {
  return { label, tuningRaw, entities: loadEntities(entitiesRaw), tuning: loadTuning(tuningRaw) };
}

const REAL = makeData(
  'entities.json and tuning.json',
  structuredClone(entitiesJson),
  structuredClone(tuningJson),
);
const ALTERED = makeData('the altered copy', alteredEntities(), alteredTuning());

/** The data set's tuning with `change` applied to a copy of its raw JSON (a fixture's own physics edits). */
function tuningOf(d: Data, change: (raw: TuningRaw) => void): Tuning {
  const raw = structuredClone(d.tuningRaw);
  change(raw);
  return loadTuning(raw);
}

/** Bessie's drag off (a speed set on her is the speed she hits at); the rest as given. */
function noDrag(d: Data): Tuning {
  return tuningOf(d, (raw) => {
    raw.vehicle.sweeper.drag.rollingMps2 = 0;
    raw.vehicle.sweeper.drag.quadraticPerM = 0;
  });
}

// ---------------------------------------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------------------------------------

/** What the data says a row's offence costs. */
type Expected = {
  /** The offence code of every penalty fact the row records. */
  readonly reason: Offence;
  /** How many penalty facts (0 for a free knock). */
  readonly facts: number;
  /** Points off the score in all (0 or below). */
  readonly pts: number;
  readonly complaints: number;
  /** HP Bessie loses (the dent's flat HP); 0 when not given. */
  readonly hpLost?: number;
  /** Litter items the offence adds to the field (hit drops, knock spills); 0 when not given. */
  readonly spawned?: number;
};

/** What the sim did, measured from just before the trigger. */
type Outcome = {
  readonly reasons: readonly number[];
  readonly factPts: number;
  readonly pts: number;
  readonly complaints: number;
  readonly complaintEvents: number;
  readonly chain: number;
  readonly hpLost: number;
  readonly spawned: number;
};

type Fixture = { readonly world: World; readonly trigger: () => void };

type Row = {
  readonly name: string;
  readonly expect: (d: Data) => Expected;
  readonly build: (d: Data) => Fixture;
};

/** The running chain set going before every trigger: 12 pickups (×2), a timer that never runs out. */
const CHAIN = 12;

/** Prime `world` (the chain, the fact watch, the baselines), run `trigger`, and measure what changed. */
function run(fixture: Fixture): Outcome {
  const { world, trigger } = fixture;
  const combo = world.scoring.combo;
  combo.chain = CHAIN;
  combo.bestChain = Math.max(combo.bestChain, CHAIN);
  combo.multiplier = comboMultiplierFor(combo, CHAIN);
  combo.timerTicks = 1_000_000;
  const reasons: number[] = [];
  let factPts = 0;
  let complaintEvents = 0;
  world.phaseTrace = (phase) => {
    if (phase === Phase.Scoring) {
      const p = world.penalties;
      for (let i = 0; i < p.count; i++) {
        reasons.push(p.reason[i] as number);
        factPts += p.pts[i] as number;
      }
    } else if (phase === Phase.ShiftTimer) {
      complaintEvents += countEvents(world.events, EV.Complaint);
    }
  };
  const pts0 = world.scoring.penaltyPts;
  const complaints0 = world.complaints.count;
  const hp0 = world.vehicle.hp;
  const spawned0 = world.litter.litterSpawned;
  trigger();
  world.phaseTrace = null;
  return {
    reasons,
    factPts,
    pts: world.scoring.penaltyPts - pts0,
    complaints: world.complaints.count - complaints0,
    complaintEvents,
    chain: combo.chain,
    hpLost: hp0 - world.vehicle.hp,
    spawned: world.litter.litterSpawned - spawned0,
  };
}

const neutral = createInputFrame();
const NORTH = 0;
const EAST = Math.PI / 2;
const SOUTH = Math.PI;

/** Bessie at (x, y) facing `headingRad`, rolling at `vLongMps`, no yaw, wheel straight (prev pose too). */
function putBessie(w: World, x: number, y: number, headingRad: number, vLongMps = 0): void {
  const v = w.vehicle;
  v.xM = x;
  v.yM = y;
  v.prevXM = x;
  v.prevYM = y;
  v.headingRad = headingRad;
  v.prevHeadingRad = headingRad;
  v.vLongMps = vLongMps;
  v.vLatMps = 0;
  v.yawRateRadPerS = 0;
  v.steerRad = 0;
}

/** Bessie rolling straight on at `speedMps` from wherever she is. */
function holdSpeed(w: World, speedMps: number): void {
  const v = w.vehicle;
  v.vLongMps = speedMps;
  v.vLatMps = 0;
  v.yawRateRadPerS = 0;
  v.steerRad = 0;
}

/** Step `w` `ticks` times with Bessie held at `speedMps`. */
function rollFor(w: World, ticks: number, speedMps: number): void {
  for (let t = 0; t < ticks; t++) {
    holdSpeed(w, speedMps);
    w.step(neutral);
  }
}

const kindOf = (id: NpcId): number => NPC_IDS.indexOf(id);

/** Add an NPC of `id` at (x, y) the way the spawner does: its footprint, speed, first state and onSpawn. */
function addActor(w: World, id: NpcId, x: number, y: number, origin: number = NpcOrigin.Ambient): number {
  const kind = kindOf(id);
  const i = addNpcAt(w.npc, kind, origin, x, y);
  if (i < 0) throw new Error('store full');
  w.npc.radius[i] = w.npcAi.spawner.radiusByKind[kind] as number;
  w.npc.walkMps[i] = w.npcAi.spawner.speedByKind[kind] as number;
  const b = w.npcAi.behaviours[kind];
  setNpcState(w.npc, i, b?.initial ?? 0);
  b?.onSpawn?.(w, i);
  return i;
}

/** Hold NPC `handle` at (x, y) between ticks (a test standing in for its own walk). */
function pin(w: World, handle: number, x: number, y: number): void {
  const i = resolveNpcHandle(w.npc, handle);
  if (i < 0) throw new Error('stale handle');
  w.npc.x[i] = x;
  w.npc.y[i] = y;
  updateNpcCell(w.npc, i);
}

/** Compile-once cache: the fixtures reuse their levels (createWorld never writes the Level). */
const levels = new Map<string, Level>();
function cachedLevel(key: string, make: () => Level): Level {
  let level = levels.get(key);
  if (level === undefined) {
    level = make();
    levels.set(key, level);
  }
  return level;
}

// --- Actor hits: the person kinds (npc/reactions.ts) ------------------------------------------------------

/** The open town (npcTown.ts, 48 × 48 road tiles, no population), Bessie at (48, 48) facing north. */
function openTown(d: Data, tuning: Tuning = d.tuning): World {
  return createWorld(npcTown(48, {}).level, 108, tuning, {}, d.entities);
}

function npcHit(d: Data, id: NpcId): Expected {
  const hit = d.entities.npcs[id].hit;
  if (hit === null) throw new Error(`${id} has no hit`);
  let spawned = 0;
  for (const drop of hit.drops) spawned += drop.count;
  return { reason: Offence.Hit, facts: 1, pts: hit.pts, complaints: hit.complaints, spawned };
}

/** A person of `id` just inside Bessie's front bumper on her centre line; she rolls into them at 2 m/s. */
function personHitRow(id: NpcId): Row {
  return {
    name: `hit ${id}`,
    expect: (d) => npcHit(d, id),
    build: (d) => {
      const world = openTown(d);
      const half = d.tuning.vehicle.sweeper.body.lengthM / 2;
      const r = world.npcAi.spawner.radiusByKind[kindOf(id)] as number;
      addActor(world, id, 48, 48 - half - r + 0.02);
      return {
        world,
        trigger: () => {
          rollFor(world, 1, 2);
          // She stops on the fallen person: still touching, never a second hit.
          rollFor(world, 30, 0);
        },
      };
    },
  };
}

/** A dog walker and its dog, linked both ways, as the spawner adds them; both frozen where they stand. */
function addFrozenPair(
  w: World,
  wx: number,
  wy: number,
  dx: number,
  dy: number,
): { walker: number; dog: number } {
  const npc = w.npc;
  const kind = kindOf('npc.dog_walker');
  const r = w.tuning.streetLife.npcRadius;
  const walker = addNpcAt(npc, kind, NpcOrigin.Named, wx, wy);
  npc.radius[walker] = r.humanM;
  npc.walkMps[walker] = w.npcAi.spawner.speedByKind[kind] as number;
  const dog = addNpcAt(npc, kind, NpcOrigin.Companion, dx, dy);
  npc.radius[dog] = r.dogM;
  npc.walkMps[dog] = w.npcAi.spawner.speedByKind[kind] as number;
  npc.link[walker] = npcHandle(npc, dog);
  npc.link[dog] = npcHandle(npc, walker);
  enterPedestrianState(w, walker, PED.Idle, 60_000);
  setNpcState(npc, dog, DOG.Sit);
  npc.stateLimit[dog] = 60_000;
  return { walker: npcHandle(npc, walker), dog: npcHandle(npc, dog) };
}

const dogWalkerHitRow: Row = {
  name: 'hit npc.dog_walker',
  expect: (d) => npcHit(d, 'npc.dog_walker'),
  build: (d) => {
    const world = openTown(d);
    const half = d.tuning.vehicle.sweeper.body.lengthM / 2;
    const y = 48 - half - d.tuning.streetLife.npcRadius.humanM + 0.02;
    // The walker on her centre line; the dog 3 m further on, so the lead runs away from her.
    addFrozenPair(world, 48, y, 48, y - 3);
    return {
      world,
      trigger: () => {
        rollFor(world, 1, 2);
        rollFor(world, 30, 0);
      },
    };
  },
};

const leadTangleRow: Row = {
  name: 'Lead Tangle (npc.dog_walker)',
  expect: (d) => {
    const rules = d.entities.npcs['npc.dog_walker'].rules;
    return { reason: Offence.Tangle, facts: 1, pts: rules.tanglePts, complaints: rules.tangleComplaints };
  },
  build: (d) => {
    const world = openTown(d);
    // A lead across her way along y = 40 (walker at x 46, dog at 50); she is moved north over it, at rest each
    // tick (so a touch of the walker or the dog would be a free bump, never a hit).
    addFrozenPair(world, 46, 40, 50, 40);
    return {
      world,
      trigger: () => {
        for (let k = 0; k <= 320; k++) {
          putBessie(world, 48, 47 - k * 0.05, NORTH);
          world.step(neutral);
        }
      },
    };
  },
};

const catHitRow: Row = {
  name: 'hit npc.cat',
  expect: (d) => npcHit(d, 'npc.cat'),
  build: (d) => {
    const level = cachedLevel('cat street', () =>
      compileCatTown(CAT_STREET, { perches: { count: 1, on: ['walls'] } }),
    );
    const world = createWorld(level, 22, d.tuning, {}, d.entities);
    world.npcAi.spawner.perchPending = 0;
    // A cat grooming on a mid-road spot (tile (30, 3)); Bessie closing from the west too fast for its bolt.
    const c = world.npcAi.cat;
    const spot = [...c.spotTile].indexOf(3 * c.widthTiles + 30);
    if (spot < 0) throw new Error('no grooming spot on tile (30, 3)');
    const [x, y] = tileCentre(30, 3);
    addCat(world, TILE_TARGET - spot, x, y);
    putBessie(world, x - d.tuning.vehicle.sweeper.body.lengthM / 2 - 0.1, y, EAST, 8);
    return {
      world,
      trigger: () => {
        // She rolls on (no input); the cat lands on her roof and rides it, never hit twice.
        for (let t = 0; t < 30; t++) world.step(neutral);
      },
    };
  },
};

// --- Actor hits: the pavement and lane vehicles (traffic.ts) ---------------------------------------------

function trafficLevel(rows: readonly string[], traffic: TownTraffic): Level {
  return cachedLevel(`${rows.join('/')}|${JSON.stringify(traffic)}`, () => compileTrafficTown(rows, traffic));
}

function vehicleHit(d: Data, id: 'veh.bicycle' | 'veh.mobility_scooter'): Expected {
  const hit = d.entities.vehicles[id].hit;
  if (hit === null) throw new Error(`${id} has no hit`);
  return { reason: Offence.Hit, facts: 1, pts: hit.pts, complaints: hit.complaints };
}

/** Bessie nose-on to vehicle i's road-side flank, 5 cm off it, driving straight at it at 2 m/s. */
function aimAtFlank(w: World, i: number, roadY: number): void {
  const s = w.vehicles;
  const h = s.heading[i] as number;
  const side = (roadY - (s.y[i] as number)) * Math.sin(h) >= 0 ? 1 : -1;
  const off = (s.halfWidth[i] as number) + w.tuning.vehicle.sweeper.body.lengthM / 2 + 0.05;
  putBessie(
    w,
    (s.x[i] as number) + Math.cos(h) * side * off,
    (s.y[i] as number) + Math.sin(h) * side * off,
    h - (side * Math.PI) / 2,
    2,
  );
}

const bicycleHitRow: Row = {
  name: 'hit veh.bicycle',
  expect: (d) => vehicleHit(d, 'veh.bicycle'),
  build: (d) => {
    const world = createWorld(
      trafficLevel(LONG_STREET, { densityPerKm: 0, mix: {} }),
      1,
      d.tuning,
      {},
      d.entities,
    );
    putBessie(world, 150, 9, EAST);
    const lanes = world.level.lanes;
    let portal = -1;
    for (let e = 0; e < lanes.edgeCount && portal < 0; e++) {
      const fromWest = (lanes.nodeX[lanes.edgeFrom[e] as number] as number) === 0;
      if (((lanes.edgeFlags[e] as number) & LANE_FLAG.PORTAL_IN) !== 0 && fromWest) portal = e;
    }
    const kind = VEHICLE_IDS.indexOf('veh.bicycle');
    const i = spawnLaneVehicle(world, kind, portal);
    if (i < 0) throw new Error('no bicycle');
    // Let it ride in off the west portal for 4 s.
    for (let t = 0; t < 240; t++) world.step(neutral);
    if (world.vehicles.kind[i] !== kind) throw new Error('the bicycle moved index');
    aimAtFlank(world, i, 7);
    return { world, trigger: () => rollFor(world, 30, 2) };
  },
};

const scooterHitRow: Row = {
  name: 'hit veh.mobility_scooter',
  expect: (d) => vehicleHit(d, 'veh.mobility_scooter'),
  build: (d) => {
    const traffic: TownTraffic = { densityPerKm: 0, mix: {}, pavement: { 'veh.mobility_scooter': 1 } };
    const world = createWorld(trafficLevel(PARKING_STREET, traffic), 5, d.tuning, {}, d.entities);
    putBessie(world, 61, 9, EAST);
    world.step(neutral);
    if (world.vehicles.kind[0] !== VEHICLE_IDS.indexOf('veh.mobility_scooter')) throw new Error('no scooter');
    aimAtFlank(world, 0, 7);
    return { world, trigger: () => rollFor(world, 30, 2) };
  },
};

// --- Knockables (bodies.ts) -------------------------------------------------------------------------------

function knockRow(id: KnockableId): Row {
  return {
    name: `knock ${id}`,
    expect: (d) => {
      const k = d.entities.knockables[id].knock;
      return {
        reason: Offence.Knock,
        facts: k.pts < 0 ? 1 : 0,
        pts: k.pts,
        complaints: 0,
        spawned: k.spills,
      };
    },
    build: (d) => {
      // A 24 × 12 tile open arena, the prop 6 m ahead of Bessie's centre, Bessie heading east at it.
      const w = 24;
      const h = 12;
      const level = levelFromCollideGrid({
        w,
        h,
        collide: new Uint8Array(w * h),
        player: { x: 6, y: 12, heading: EAST },
        props: [],
        knockables: [{ id, x: 12, y: 12 }],
      });
      const world = createWorld(level, 1, noDrag(d), {}, d.entities);
      return {
        world,
        trigger: () => {
          for (let t = 0; t < 120 && world.bodies.flags[0] === 0; t++) rollFor(world, 1, 6);
          if (world.bodies.flags[0] === 0) throw new Error(`${id} was never knocked`);
          rollFor(world, 1, 0);
        },
      };
    },
  };
}

// --- Parked car dent (parked.ts) --------------------------------------------------------------------------

const dentRow: Row = {
  name: 'dent veh.hatchback_parked',
  expect: (d) => {
    const rules = d.entities.vehicles['veh.hatchback_parked'].rules;
    return { reason: Offence.Dent, facts: 1, pts: rules.dentPts, complaints: 0, hpLost: rules.dentHp };
  },
  build: (d) => {
    // One parked hatchback on the parking street, in the bay centred at x = 26 (found by seed).
    const level = cachedLevel('dent street', () => {
      const l = structuredClone(
        trafficLevel(PARKING_STREET, {
          densityPerKm: 5,
          mix: { 'veh.hatchback': 1 },
          parkedFill: 0.6,
          parkedMix: { 'veh.hatchback_parked': 1 },
        }),
      );
      if (l.traffic === null) throw new Error('no traffic spec');
      l.traffic.parked = 1;
      l.traffic.parkedMix = [{ id: 'veh.hatchback_parked', weight: 1 }];
      l.traffic.moving = 0;
      return l;
    });
    const tuning = noDrag(d);
    for (let seed = 1; seed < 200; seed++) {
      const world = createWorld(level, seed, tuning, {}, d.entities);
      if (world.vehicles.x[0] !== 26) continue;
      const northFaceY = 9 - (world.vehicles.halfWidth[0] as number);
      // Heading south, her nose 5 cm short of the car's north face, at 6 m/s.
      putBessie(world, 26, northFaceY - tuning.vehicle.sweeper.body.lengthM / 2 - 0.05, SOUTH, 6);
      return { world, trigger: () => world.step(neutral) };
    }
    throw new Error('no seed puts the car in the 26 m bay');
  },
};

// --- Puddle splash (npc/splash.ts) ------------------------------------------------------------------------

/** Pedestrians splashed in one crossing: enough to reach complaintEvery on the real data and the altered. */
const SPLASHED = 4;

const splashRow: Row = {
  name: 'puddle splash (4 pedestrians)',
  expect: (d) => {
    const s = d.tuning.streetLife.splash;
    return {
      reason: Offence.Splash,
      facts: SPLASHED,
      pts: SPLASHED * s.pts,
      complaints: Math.floor(SPLASHED / s.complaintEvery),
    };
  },
  build: (d) => {
    const world = openTown(d);
    // A puddle on her lane (tiles 23–24, row 21: y 42–44), four people kept beside her as she crosses it at
    // 4 m/s: 0.8 m off each side, level with her centre and 1.5 m behind it.
    addHazard(world.hazards, hazardKindIndex('haz.puddle'), 23, 21, 25, 22);
    const body = d.tuning.vehicle.sweeper.body;
    const off = body.widthM / 2 + 0.8 + d.tuning.streetLife.npcRadius.humanM;
    const held: [number, number, number][] = [];
    for (const [dx, dy] of [
      [off, 0],
      [-off, 0],
      [off, 1.5],
      [-off, 1.5],
    ] as const) {
      held.push([npcHandle(world.npc, addActor(world, 'npc.shopper', 0, 0)), dx, dy]);
    }
    return {
      world,
      trigger: () => {
        for (let t = 0; t < 600 && world.vehicle.yM > 36; t++) {
          holdSpeed(world, 4);
          for (const [h, dx, dy] of held) pin(world, h, world.vehicle.xM + dx, world.vehicle.yM + dy);
          world.step(neutral);
        }
      },
    };
  },
};

// --- Dust coughing (npc/reactions.ts, dirt.ts) ------------------------------------------------------------

/** How long the pedestrian stands in the dust: 4 s. */
const DUST_TICKS = 240;

const dustRow: Row = {
  name: 'dust cough (a pedestrian in the dust for 4 s)',
  expect: (d) => {
    const dust = d.tuning.streetLife.dust;
    const coughs = Math.floor(DUST_TICKS / Math.round(dust.everyS * 60));
    return { reason: Offence.Dust, facts: coughs, pts: coughs * dust.pts, complaints: 0 };
  },
  build: (d) => {
    const { level } = npcTown(48, {});
    // Dusty `%` yard ground round her start (tiles 21–26), so the lowered brushes raise dust clouds.
    const [w] = level.size;
    for (let ty = 21; ty < 27; ty++)
      for (let tx = 21; tx < 27; tx++) level.layers.ground[ty * w + tx] = Ground.Yard;
    const world = createWorld(level, 95, d.tuning, {}, d.entities);
    world.npcAi.behaviours[kindOf('npc.postie')] = pedestrianBehaviour;
    // Lower the brush and let it spin up and start collecting.
    const lower = createInputFrame();
    lower.pressed = PRESSED.BRUSH;
    world.step(lower);
    for (let t = 0; t < 600 && !world.brush.collecting; t++) world.step(neutral);
    if (!world.brush.collecting) throw new Error('the brush never started collecting');
    for (let t = 0; t < 10; t++) world.step(neutral);
    // A postie 2.5 m to the right of the right gutter brush.
    const brush = d.tuning.sweeping.gutterBrush;
    const px = 48 + brush.centreXM + 2.5;
    const py = 48 - brush.centreYM;
    const h = npcHandle(world.npc, addActor(world, 'npc.postie', px, py));
    return {
      world,
      trigger: () => {
        for (let t = 0; t < DUST_TICKS; t++) {
          pin(world, h, px, py);
          world.step(neutral);
        }
      },
    };
  },
};

// --- Occupied zebra (npc/zebraOffence.ts) -----------------------------------------------------------------

const zebraRow: Row = {
  name: 'running an occupied zebra',
  expect: (d) => {
    const z = d.tuning.complaints.zebra;
    return { reason: Offence.Zebra, facts: 1, pts: z.pts, complaints: z.complaints };
  },
  build: (d) => {
    // The steering town's 1-tile zebra at x 20–22 m; a shopper standing on it, clear of her path along y 7.
    const world = createWorld(cachedLevel('steering town', compileTown), 85, d.tuning, {}, d.entities);
    const kind = kindOf('npc.shopper');
    world.npcAi.behaviours[kind] = stationaryPedestrianBehaviour;
    addActor(world, 'npc.shopper', 21, 5);
    putBessie(world, 14, 7, EAST);
    return { world, trigger: () => rollFor(world, 150, 2) };
  },
};

/** The table: every M3 hit and offence (ROADMAP M3, SSP-108), in the issue's order. */
const ROWS: readonly Row[] = [
  personHitRow('npc.shopper'),
  personHitRow('npc.businessman'),
  personHitRow('npc.litterbug'),
  personHitRow('npc.postie'),
  personHitRow('npc.market_trader'),
  personHitRow('npc.old_woman'),
  personHitRow('npc.old_man_frame'),
  personHitRow('npc.mum_pushchair'),
  dogWalkerHitRow,
  leadTangleRow,
  catHitRow,
  bicycleHitRow,
  scooterHitRow,
  knockRow('prop.wheelie_bin'),
  knockRow('prop.a_board'),
  knockRow('prop.recycling_box'),
  knockRow('prop.traffic_cone'),
  knockRow('prop.shopping_trolley'),
  dentRow,
  splashRow,
  dustRow,
  zebraRow,
];

// ---------------------------------------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------------------------------------

describe('the penalty table covers every M3 offence', () => {
  it('has a hit row for every NPC and actor vehicle with an entities.json hit, and a row for every knockable', () => {
    const names = new Set(ROWS.map((r) => r.name));
    for (const id of NPC_IDS) {
      if (REAL.entities.npcs[id].hit !== null) expect(names, id).toContain(`hit ${id}`);
    }
    for (const id of VEHICLE_IDS) {
      if (REAL.entities.vehicles[id].hit !== null) expect(names, id).toContain(`hit ${id}`);
    }
    for (const id of KNOCKABLE_IDS) expect(names, id).toContain(`knock ${id}`);
    expect(ROWS.length).toBe(names.size);
  });

  it.each(ROWS.map((r) => [r.name, r] as const))('the altered copy changes what %s costs', (_name, row) => {
    expect(row.expect(ALTERED)).not.toEqual(row.expect(REAL));
  });
});

describe.each([REAL, ALTERED])('penalties on $label', (data) => {
  it.each(ROWS.map((r) => [r.name, r] as const))('%s', (_name, row) => {
    const want = row.expect(data);
    const got = run(row.build(data));
    // The penalty facts phase 9 consumed: how many, which offence, their points.
    expect(got.reasons).toEqual(Array.from({ length: want.facts }, () => want.reason));
    expect(got.factPts).toBe(want.pts);
    // Points off the score and complaints on the meter (one EV.Complaint each).
    expect(got.pts).toBe(want.pts);
    expect(got.complaints).toBe(want.complaints);
    expect(got.complaintEvents).toBe(want.complaints);
    // Any penalty resets the chain; a free knock leaves it running.
    const penalty = want.pts < 0 || want.complaints > 0;
    expect(got.chain).toBe(penalty ? 0 : CHAIN);
    // Side effects: the dent's flat HP, the hit drops and the knock spills.
    expect(got.hpLost).toBe(want.hpLost ?? 0);
    expect(got.spawned).toBe(want.spawned ?? 0);
  });

  it("Doris's hit drops are spilled shopping, as many as entities.json says", () => {
    const row = personHitRow('npc.old_woman');
    const fixture = row.build(data);
    const shopping = LITTER_IDS.indexOf('litter.spilled_shopping');
    const before = countKind(fixture.world, shopping);
    run(fixture);
    const drops = data.entities.npcs['npc.old_woman'].hit?.drops ?? [];
    expect(drops.map((x) => x.litter)).toEqual(['litter.spilled_shopping']);
    expect(countKind(fixture.world, shopping) - before).toBe(drops[0]?.count);
  });
});

function countKind(w: World, kind: number): number {
  let n = 0;
  for (let k = 0; k < w.litter.count; k++) if (w.litter.kind[k] === kind) n++;
  return n;
}
