// The hazard store (src/sim/hazards.ts, SSP-093; ENTITY_CATALOG §10, §4.2, TECHNICAL_DESIGN §8.2 steps 7 and
// 10, LEVEL_DESIGN §9.3): grip overrides, pothole and speed-bump jolts with their LU spills, the open-manhole
// hard stop, the leaf-pile brush-up hook, shift-start spawning and the store itself. Levels are hand-built
// with createBlankLevel.
import { describe, expect, it } from 'vitest';
import { HAZARD_ENTITY_IDS, LITTER_IDS, type LitterId } from '../../src/sim/entities.ts';
import { countEvents, createEventQueue, EV, resetEvents } from '../../src/sim/eventQueue.ts';
import {
  addHazard,
  createHazardStore,
  createSpillTable,
  HAZARD_CAPACITY,
  HazardFlag,
  hazardAtTile,
  hazardKindIndex,
  hazardSurfaceAtTile,
  removeHazard,
  SPILL_GAP_M,
  SPILL_HALF_WIDTH_M,
  spawnHazards,
  spillHopperLitter,
  stepBrushUpLeaves,
  stepHazardContacts,
} from '../../src/sim/hazards.ts';
import { addToHopper, createHopper, setHopperCapacity, spillFromHopper } from '../../src/sim/hopper.ts';
import { createInputFrame, type InputFrame, PRESSED } from '../../src/sim/inputFrame.ts';
import { addLitter, createLitterField } from '../../src/sim/litter.ts';
import {
  createBlankLevel,
  Ground,
  HAZARD_RULE,
  type Level,
  type LitterTableEntry,
  type RandomHazard,
  Surface,
  surfaceOfGround,
} from '../../src/sim/map.ts';
import { sfc32 } from '../../src/sim/rng.ts';
import { createStainStore, stainKindIndex } from '../../src/sim/stains.ts';
import { createSurfaceTable, NO_SURFACE, sampleSurface } from '../../src/sim/surface.ts';
import { DEFAULT_ENTITIES, DEFAULT_TUNING } from '../../src/sim/tuning.ts';
import { createVehicleParams, createVehicleState } from '../../src/sim/vehicle.ts';
import { createWorld, stepWorld, type World } from '../../src/sim/world.ts';
import { endlessShiftTuning } from '../support/endlessShift.ts';
import { assertHeapDeltaWithinThresholds, measureHeapDelta } from '../support/heapDelta.ts';

const sweeper = DEFAULT_TUNING.vehicle.sweeper;
const grip = sweeper.lateralGripPerS;
const EAST = Math.PI / 2;
const NORTH = 0;

const OIL = hazardKindIndex('haz.oil_slick');
const PUDDLE = hazardKindIndex('haz.puddle');
const POTHOLE = hazardKindIndex('haz.pothole');
const BUMP = hazardKindIndex('haz.speed_bump');
const LEAVES = hazardKindIndex('haz.wet_leaves');
const MANHOLE = hazardKindIndex('haz.open_manhole');

const litterKind = (id: LitterId): number => LITTER_IDS.indexOf(id);

function frame(throttle: number, brake = 0, steer = 0): InputFrame {
  const input = createInputFrame();
  input.throttle = throttle;
  input.brake = brake;
  input.steer = steer;
  return input;
}
const NEUTRAL = frame(0);

/**
 * A w × h road (asphalt), Bessie at (x, y) facing east. Row 3 (y 6–8 m) is her lane in most tests: her wheel
 * rectangle spans y 6.125–7.875 m there.
 */
function roadLevel(w = 40, h = 7, x = 10, y = 7, heading = EAST): Level {
  const level = createBlankLevel('test.hazard_road', w, h);
  for (let i = 0; i < w * h; i++) {
    level.layers.ground[i] = Ground.Road;
    level.layers.surface[i] = surfaceOfGround(Ground.Road);
  }
  level.player = { x, y, heading };
  return level;
}

/** A level with a `hazards` spec and an empty candidate layer. */
function withHazards(
  level: Level,
  place: { id: string; x: number; y: number }[],
  random: RandomHazard[] = [],
): Level {
  level.hazards = { place, random, candidates: new Uint8Array(level.size[0] * level.size[1]) };
  return level;
}

/** Put `lu` in Bessie's hopper (test setup: the hopper's own add path needs an open event queue). */
function fillHopper(world: World, lu: number): void {
  world.vehicle.hopperLU = lu;
  world.hopper.full = lu >= world.vehicleParams.hopperCapacityLU;
}

/** Step until `done` or `max` ticks, counting the events of `type`. */
function drive(
  world: World,
  input: InputFrame,
  max: number,
  done: (w: World) => boolean = () => false,
): { ticks: number; jolts: number; stops: number } {
  let jolts = 0;
  let stops = 0;
  let ticks = 0;
  while (ticks < max && !done(world)) {
    stepWorld(world, input);
    jolts += countEvents(world.events, EV.HazardJolt);
    stops += countEvents(world.events, EV.HazardStop);
    ticks++;
  }
  return { ticks, jolts, stops };
}

/** The LU of every item in the world's litter field. */
function litterLu(world: World): number {
  let sum = 0;
  for (let i = 0; i < world.litter.count; i++) {
    const id = LITTER_IDS[world.litter.kind[i] as number] as LitterId;
    sum += DEFAULT_ENTITIES.litter[id].lu;
  }
  return sum;
}

describe('grip overrides (TECHNICAL_DESIGN §8.2 step 7)', () => {
  // Bessie at (10, 7) facing east: front wheels at x 11.2 (column 5), rear at x 8.8 (column 4), all in row 3.
  for (const [name, kind, k] of [
    ['haz.oil_slick', OIL, grip.oil],
    ['haz.puddle', PUDDLE, grip.wet],
    ['haz.wet_leaves', LEAVES, grip.wetLeaves],
  ] as const) {
    it(`uses k = ${k} with all four wheels on ${name}`, () => {
      const world = createWorld(roadLevel(), 1, DEFAULT_TUNING);
      addHazard(world.hazards, kind, 4, 3, 5, 4);
      addHazard(world.hazards, kind, 5, 3, 6, 4);
      // Standing still with sideways slip: step 7 decays vLat by exp(−k·DT) and nothing else touches it.
      world.vehicle.vLatMps = 1;
      stepWorld(world, NEUTRAL);
      expect(world.surface.gripPerS).toBe(k);
      expect(world.vehicle.vLatMps).toBeCloseTo(Math.exp(-k / 60), 12);
    });
  }

  it('reads the hazard per wheel: one tile under the front wheels only averages with asphalt', () => {
    const world = createWorld(roadLevel(), 1, DEFAULT_TUNING);
    addHazard(world.hazards, OIL, 5, 3, 6, 4);
    stepWorld(world, NEUTRAL);
    expect(world.surface.gripPerS).toBe((2 * grip.oil + 2 * grip.asphalt) / 4);
  });

  it('jolt and hard-stop hazards leave the grip alone', () => {
    const world = createWorld(roadLevel(), 1, DEFAULT_TUNING);
    addHazard(world.hazards, POTHOLE, 4, 3, 5, 4);
    addHazard(world.hazards, MANHOLE, 5, 3, 6, 4);
    expect(hazardSurfaceAtTile(world.hazards, 4, 3)).toBe(NO_SURFACE);
    const out = { gripPerS: 0, rollMult: 0 };
    sampleSurface(
      world.level,
      createSurfaceTable(sweeper),
      sweeper,
      world.vehicle,
      out,
      world.hazards.surfaceOverride,
    );
    expect(out.gripPerS).toBe(grip.asphalt);
  });

  it('sampleSurface without an override layer reads the tiles only (the M1 call)', () => {
    const world = createWorld(roadLevel(), 1, DEFAULT_TUNING);
    addHazard(world.hazards, OIL, 4, 3, 6, 4);
    const out = { gripPerS: 0, rollMult: 0 };
    const table = createSurfaceTable(sweeper);
    sampleSurface(world.level, table, sweeper, world.vehicle, out);
    expect(out.gripPerS).toBe(grip.asphalt);
    sampleSurface(world.level, table, sweeper, world.vehicle, out, world.hazards.surfaceOverride);
    expect(out.gripPerS).toBe(grip.oil);
  });
});

describe('pothole jolt and LU spill (ENTITY_CATALOG §10)', () => {
  it('crossing a pothole costs exactly 2 HP and moves exactly 2 LU into litter behind Bessie, once', () => {
    const world = createWorld(roadLevel(), 3, DEFAULT_TUNING);
    addHazard(world.hazards, POTHOLE, 10, 3, 11, 4); // x 20–22 m, in her lane
    fillHopper(world, 10);
    const throttle = frame(180);
    let joltTick = -1;
    let jolts = 0;
    for (let t = 0; t < 600 && world.vehicle.xM < 34; t++) {
      stepWorld(world, throttle);
      const n = countEvents(world.events, EV.HazardJolt);
      if (n > 0) {
        joltTick = t;
        jolts += n;
        // Every spilled item lies behind the rear bumper, within the spill strip, at the jolt.
        const v = world.vehicle;
        const s = Math.sin(v.headingRad);
        const c = Math.cos(v.headingRad);
        expect(world.litter.count).toBeGreaterThanOrEqual(2);
        for (let i = 0; i < world.litter.count; i++) {
          const dx = (world.litter.x[i] as number) - v.xM;
          const dy = (world.litter.y[i] as number) - v.yM;
          const forward = dx * s - dy * c;
          const right = dx * c + dy * s;
          expect(forward).toBeLessThanOrEqual(-(sweeper.body.lengthM / 2 + SPILL_GAP_M) + 1e-9);
          expect(Math.abs(right)).toBeLessThanOrEqual(SPILL_HALF_WIDTH_M);
        }
        expect(world.events.c[0]).toBe(2);
      }
    }
    expect(world.vehicle.xM).toBeGreaterThan(30); // she drove right over it and out the far side
    expect(joltTick).toBeGreaterThan(0);
    expect(jolts).toBe(1);
    expect(world.vehicle.hp).toBe(sweeper.health.maxHp - 2);
    expect(world.vehicle.hopperLU).toBe(8);
    expect(litterLu(world)).toBe(2);
    expect(world.litter.litterSpawned).toBe(world.litter.count);
    expect(world.hazards.flags[0]).toBe(0); // the episode ended when she left it
  });

  it('jolts again on a second crossing episode', () => {
    const store = createHazardStore(roadLevel(), DEFAULT_ENTITIES, sfc32(1));
    addHazard(store, POTHOLE, 10, 3, 11, 4);
    const v = createVehicleState(sweeper, 18, 7, EAST);
    const params = createVehicleParams(sweeper, 100);
    const hopper = createHopper(v, params, DEFAULT_TUNING.hopper);
    const litter = createLitterField(roadLevel(), DEFAULT_TUNING, DEFAULT_ENTITIES);
    const events = createEventQueue();
    v.vLongMps = 3;
    const step = (x: number): number => {
      v.xM = x;
      resetEvents(events, 0);
      stepHazardContacts(store, v, sweeper, hopper, litter, events);
      return countEvents(events, EV.HazardJolt);
    };
    // Front wheels reach x 20 when the centre is at 18.8: off, on (jolt), still on, off, on again (jolt).
    expect(step(18.7)).toBe(0);
    expect(step(18.9)).toBe(1);
    expect((store.flags[0] as number) & HazardFlag.Contact).toBe(HazardFlag.Contact);
    expect(step(21)).toBe(0);
    expect(step(23.3)).toBe(0); // rear wheels at 22.1: off
    expect(store.flags[0]).toBe(0);
    expect(step(21)).toBe(1);
    expect(v.hp).toBe(sweeper.health.maxHp - 4);
  });

  it('with an empty hopper the jolt still costs 2 HP, spills nothing and reports 0 LU', () => {
    const world = createWorld(roadLevel(), 3, DEFAULT_TUNING);
    addHazard(world.hazards, POTHOLE, 10, 3, 11, 4);
    const r = drive(world, frame(180), 600, (w) => w.vehicle.xM > 30);
    expect(r.jolts).toBe(1);
    expect(world.vehicle.hp).toBe(sweeper.health.maxHp - 2);
    expect(world.vehicle.hopperLU).toBe(0);
    expect(world.litter.count).toBe(0);
  });

  it('a spill frees a full hopper (EV.HopperFull can fire again) and never takes LU below 0', () => {
    const world = createWorld(roadLevel(), 3, DEFAULT_TUNING);
    setHopperCapacity(world.hopper, 50);
    fillHopper(world, 50);
    expect(world.hopper.full).toBe(true);
    addHazard(world.hazards, POTHOLE, 10, 3, 11, 4);
    drive(world, frame(180), 600, (w) => w.vehicle.xM > 30);
    expect(world.vehicle.hopperLU).toBe(48);
    expect(world.hopper.full).toBe(false);
  });
});

describe('LU spills (spillHopperLitter)', () => {
  function rig(lu: number, table: LitterTableEntry[] | null, seed = 99) {
    const level = roadLevel();
    if (table !== null) {
      const n = level.size[0] * 4 * level.size[1] * 4;
      level.litter = {
        initial: 0,
        minSpacingM: 0.5,
        table,
        weights: new Uint16Array(n),
        places: new Uint8Array(n),
      } as unknown as Level['litter'];
    }
    const store = createHazardStore(level, DEFAULT_ENTITIES, sfc32(seed));
    const v = createVehicleState(sweeper, 20, 7, EAST);
    v.hopperLU = lu;
    const hopper = createHopper(v, createVehicleParams(sweeper, 100), DEFAULT_TUNING.hopper);
    const litter = createLitterField(level, DEFAULT_TUNING, DEFAULT_ENTITIES);
    return { store, v, hopper, litter };
  }
  const entry = (id: LitterId, weight: number): LitterTableEntry =>
    ({ id, weight, requires: 0 }) as LitterTableEntry;

  it('the small-litter table keeps items of at most 1 LU with no brush-up rule', () => {
    const level = roadLevel();
    const table = [
      entry('litter.bin_bag', 5),
      entry('litter.banana_skin', 5),
      entry('litter.cigarette_butts', 3),
      entry('litter.crisp_packet', 4),
      entry('litter.dog_mess', 5),
      entry('litter.newspaper', 5),
    ];
    level.litter = { initial: 0, minSpacingM: 0.5, table } as unknown as Level['litter'];
    const store = createHazardStore(level, DEFAULT_ENTITIES, sfc32(1));
    const spill = createSpillTable(level, store.kinds);
    expect(Array.from(spill.kind.subarray(0, spill.count)).map((k) => LITTER_IDS[k])).toEqual([
      'litter.cigarette_butts',
      'litter.crisp_packet',
    ]);
    expect(spill.total).toBe(7);
    expect(spill.minLu).toBe(0.5);
    // No litter table: crisp packets.
    const bare = createSpillTable(roadLevel(), store.kinds);
    expect(bare.count).toBe(1);
    expect(bare.kind[0]).toBe(litterKind('litter.crisp_packet'));
  });

  it('moves exactly the LU of the items it adds (3 LU of mixed 0.5 / 1 LU items)', () => {
    for (let seed = 0; seed < 50; seed++) {
      const r = rig(10, [entry('litter.cigarette_butts', 1), entry('litter.drink_can', 1)], seed);
      const items = spillHopperLitter(r.store, r.hopper, r.litter, r.v, sweeper, 3);
      let sum = 0;
      for (let i = 0; i < r.litter.count; i++) {
        sum += DEFAULT_ENTITIES.litter[LITTER_IDS[r.litter.kind[i] as number] as LitterId].lu;
      }
      expect(items).toBe(r.litter.count);
      expect(sum).toBe(3);
      expect(r.v.hopperLU).toBe(7);
    }
  });

  it('spills only what the hopper holds, in whole items, and keeps the rest', () => {
    const r = rig(1.5, null); // crisp packets (1 LU) only
    expect(spillHopperLitter(r.store, r.hopper, r.litter, r.v, sweeper, 2)).toBe(1);
    expect(r.store.lastSpillLu).toBe(1);
    expect(r.v.hopperLU).toBe(0.5);
    expect(spillHopperLitter(r.store, r.hopper, r.litter, r.v, sweeper, 2)).toBe(0);
    expect(r.store.lastSpillLu).toBe(0);
    expect(r.v.hopperLU).toBe(0.5);
  });

  it('stops at a full LitterField and leaves the unspilled LU in the hopper', () => {
    const level = roadLevel();
    const store = createHazardStore(level, DEFAULT_ENTITIES, sfc32(5));
    const v = createVehicleState(sweeper, 20, 7, EAST);
    v.hopperLU = 10;
    const hopper = createHopper(v, createVehicleParams(sweeper, 100), DEFAULT_TUNING.hopper);
    const litter = createLitterField(level, DEFAULT_TUNING, DEFAULT_ENTITIES, 1);
    expect(spillHopperLitter(store, hopper, litter, v, sweeper, 3)).toBe(1);
    expect(v.hopperLU).toBe(9);
  });
});

describe('speed bump (ENTITY_CATALOG §10)', () => {
  function bumpRig(speedMps: number) {
    const level = roadLevel();
    const store = createHazardStore(level, DEFAULT_ENTITIES, sfc32(1));
    addHazard(store, BUMP, 10, 2, 11, 5);
    const v = createVehicleState(sweeper, 18.9, 7, EAST); // front wheels just over x 20
    v.vLongMps = speedMps;
    v.hopperLU = 10;
    const hopper = createHopper(v, createVehicleParams(sweeper, 100), DEFAULT_TUNING.hopper);
    const litter = createLitterField(level, DEFAULT_TUNING, DEFAULT_ENTITIES);
    const events = createEventQueue();
    resetEvents(events, 0);
    stepHazardContacts(store, v, sweeper, hopper, litter, events);
    return { v, events, litter };
  }

  it('at 6.5 m/s spills 3 LU; at 6.0 m/s spills nothing and emits nothing', () => {
    const fast = bumpRig(6.5);
    expect(10 - fast.v.hopperLU).toBe(3);
    expect(countEvents(fast.events, EV.HazardJolt)).toBe(1);
    expect(fast.events.c[0]).toBe(3);
    expect(fast.v.hp).toBe(sweeper.health.maxHp); // a speed bump costs no HP
    const slow = bumpRig(6.0);
    expect(slow.v.hopperLU).toBe(10);
    expect(slow.litter.count).toBe(0);
    expect(countEvents(slow.events, EV.HazardJolt)).toBe(0);
    // Reversing over it counts |vLong|.
    expect(10 - bumpRig(-6.5).v.hopperLU).toBe(3);
  });

  it('a map-placed `=` site becomes one bump; driven over at 6.5 / 6.0 m/s it spills 3 / 0 LU', () => {
    for (const [speed, spilled] of [
      [6.5, 3],
      [6.0, 0],
    ] as const) {
      const level = roadLevel();
      level.sites.push({ id: 'haz.speed_bump', rect: [10, 2, 11, 5] });
      const world = createWorld(level, 4, DEFAULT_TUNING);
      expect(world.hazards.count).toBe(1);
      expect(world.hazards.kind[0]).toBe(BUMP);
      fillHopper(world, 10);
      world.vehicle.xM = 17; // front wheels 1.8 m short of the bump
      world.vehicle.vLongMps = speed;
      const r = drive(world, NEUTRAL, 120, (w) => w.vehicle.xM > 25);
      expect(10 - world.vehicle.hopperLU).toBe(spilled);
      expect(r.jolts).toBe(spilled > 0 ? 1 : 0);
      expect(litterLu(world)).toBe(spilled);
    }
  });

  it('the brush-down top speed (6.0 m/s cap) never spills', () => {
    const level = roadLevel(60);
    level.sites.push({ id: 'haz.speed_bump', rect: [40, 2, 41, 5] });
    const world = createWorld(level, 4, DEFAULT_TUNING);
    fillHopper(world, 10);
    const lower = frame(255);
    lower.pressed = PRESSED.BRUSH;
    stepWorld(world, lower);
    const r = drive(world, frame(255), 1200, (w) => w.vehicle.xM > 90);
    expect(world.vehicle.brushDown).toBe(true);
    expect(world.vehicle.xM).toBeGreaterThan(84);
    expect(r.jolts).toBe(0);
    expect(world.vehicle.hopperLU).toBe(10);
  });
});

describe('open manhole hard stop (ENTITY_CATALOG §10)', () => {
  it('entering an open manhole sets vLong to 0 and costs 10 HP, once per episode', () => {
    const level = withHazards(roadLevel(), [{ id: 'haz.open_manhole', x: 21, y: 7 }]);
    const world = createWorld(level, 5, DEFAULT_TUNING);
    expect(world.hazards.count).toBe(1);
    expect(world.hazards.col0[0]).toBe(10);
    expect(world.hazards.row0[0]).toBe(3);
    const throttle = frame(200);
    let stopTick = -1;
    for (let t = 0; t < 600 && stopTick < 0; t++) {
      const before = Math.abs(world.vehicle.vLongMps);
      stepWorld(world, throttle);
      if (countEvents(world.events, EV.HazardStop) > 0) {
        stopTick = t;
        expect(world.vehicle.vLongMps).toBe(0);
        expect(world.vehicle.vLatMps).toBe(0);
        expect(world.vehicle.hp).toBe(sweeper.health.maxHp - 10);
        expect(world.events.c[0]).toBeGreaterThan(before - 0.2);
      }
    }
    expect(stopTick).toBeGreaterThan(0);
    // Driving on through it is the same episode: no second stop, no more HP.
    const r = drive(world, throttle, 600, (w) => w.vehicle.xM > 30);
    expect(world.vehicle.xM).toBeGreaterThan(30);
    expect(r.stops).toBe(0);
    expect(world.vehicle.hp).toBe(sweeper.health.maxHp - 10);
  });

  it('never takes HP below 0, and an HP-0 stop ends the shift TOWED', () => {
    const level = withHazards(roadLevel(), [{ id: 'haz.open_manhole', x: 21, y: 7 }]);
    const world = createWorld(level, 5, DEFAULT_TUNING);
    world.vehicle.hp = 4;
    const r = drive(world, frame(200), 600, (w) => w.vehicle.hp === 0);
    expect(world.vehicle.hp).toBe(0);
    expect(r.stops).toBe(1);
    expect(countEvents(world.events, EV.ShiftEnd)).toBe(1);
  });
});

describe('leaf piles driven through brush-up (ENTITY_CATALOG §4.2)', () => {
  it('driving brush-up through a leaf pile creates one haz.wet_leaves on its tile', () => {
    const world = createWorld(roadLevel(), 6, DEFAULT_TUNING);
    addLitter(world.litter, litterKind('litter.leaf_pile'), 21, 7.3, 0);
    addLitter(world.litter, litterKind('litter.crisp_packet'), 25, 7, 0);
    const r = drive(world, frame(160), 600, (w) => w.vehicle.xM > 30);
    expect(r.jolts).toBe(0);
    expect(world.hazards.count).toBe(1);
    expect(world.hazards.kind[0]).toBe(LEAVES);
    expect([world.hazards.col0[0], world.hazards.row0[0]]).toEqual([10, 3]);
    expect(hazardSurfaceAtTile(world.hazards, 10, 3)).toBe(Surface.WetLeaves);
    // The pile is gone (still counted as spawned); the crisp packet is untouched.
    expect(world.litter.count).toBe(1);
    expect(world.litter.kind[0]).toBe(litterKind('litter.crisp_packet'));
    expect(world.litter.litterSpawned).toBe(2);
  });

  it('with the brush lowered the pile is not driven through', () => {
    const world = createWorld(roadLevel(), 6, DEFAULT_TUNING);
    addLitter(world.litter, litterKind('litter.leaf_pile'), 21, 7, 0);
    const lower = frame(160);
    lower.pressed = PRESSED.BRUSH;
    stepWorld(world, lower);
    drive(world, frame(160), 600, (w) => w.vehicle.xM > 30);
    expect(world.hazards.count).toBe(0);
    expect(world.litter.count).toBe(1);
  });

  it('a pile on a tile that already holds a hazard is removed without adding another', () => {
    const level = roadLevel();
    const store = createHazardStore(level, DEFAULT_ENTITIES, sfc32(1));
    addHazard(store, PUDDLE, 10, 3, 11, 4);
    const litter = createLitterField(level, DEFAULT_TUNING, DEFAULT_ENTITIES);
    addLitter(litter, litterKind('litter.leaf_pile'), 21, 7, 0);
    addLitter(litter, litterKind('litter.leaf_pile'), 19.5, 7, 0);
    const v = createVehicleState(sweeper, 20.5, 7, EAST);
    const brush = createWorld(level, 1, DEFAULT_TUNING).brush;
    expect(stepBrushUpLeaves(store, litter, brush, v, sweeper)).toBe(1);
    expect(store.count).toBe(2);
    expect(store.kind[1]).toBe(LEAVES);
    expect([store.col0[1], store.row0[1]]).toEqual([9, 3]);
    expect(litter.count).toBe(0);
  });
});

describe('the store', () => {
  it('keeps the tile layers as "first hazard covering the tile" through adds and swap-removes', () => {
    const store = createHazardStore(roadLevel(), DEFAULT_ENTITIES, sfc32(1));
    expect(addHazard(store, PUDDLE, 2, 2, 3, 3)).toBe(0);
    expect(addHazard(store, BUMP, 1, 1, 4, 4)).toBe(1); // covers the puddle's tile too
    expect(addHazard(store, OIL, 8, 2, 9, 3)).toBe(2);
    expect(hazardAtTile(store, 2, 2)).toBe(0);
    expect(hazardSurfaceAtTile(store, 2, 2)).toBe(Surface.Puddle);
    expect(hazardAtTile(store, 1, 1)).toBe(1);
    expect(hazardSurfaceAtTile(store, 1, 1)).toBe(NO_SURFACE);
    expect(store.x[1]).toBe(5);
    expect(store.y[1]).toBe(5);
    removeHazard(store, 0); // the oil moves into slot 0; the bump now owns the puddle's tile
    expect(store.count).toBe(2);
    expect(store.kind[0]).toBe(OIL);
    expect(hazardAtTile(store, 8, 2)).toBe(0);
    expect(hazardSurfaceAtTile(store, 8, 2)).toBe(Surface.Oil);
    expect(hazardAtTile(store, 2, 2)).toBe(1);
    expect(hazardSurfaceAtTile(store, 2, 2)).toBe(NO_SURFACE);
    expect(hazardAtTile(store, -1, 0)).toBe(-1);
    expect(store.hazardsSpawned).toBe(3);
  });

  it('clips footprints to the map, refuses empty ones and a full store, and checks its inputs', () => {
    const store = createHazardStore(roadLevel(4, 4), DEFAULT_ENTITIES, sfc32(1), 2);
    expect(addHazard(store, PUDDLE, -2, -2, 1, 1)).toBe(0);
    expect([store.col0[0], store.row0[0], store.col1[0], store.row1[0]]).toEqual([0, 0, 1, 1]);
    expect(addHazard(store, PUDDLE, 5, 5, 6, 6)).toBe(-1);
    expect(addHazard(store, PUDDLE, 1, 1, 2, 2)).toBe(1);
    expect(addHazard(store, PUDDLE, 2, 2, 3, 3)).toBe(-1);
    expect(() => addHazard(store, 99, 0, 0, 1, 1)).toThrow(/kind/);
    expect(() => addHazard(store, PUDDLE, 0.5, 0, 1, 1)).toThrow(/whole tiles/);
    expect(HAZARD_CAPACITY).toBe(64);
    expect(HAZARD_ENTITY_IDS[OIL]).toBe('haz.oil_slick');
  });
});

describe('shift-start spawn (LEVEL_DESIGN §9.3)', () => {
  /** A 30 × 10 road; rows 0 and 9 are kerbside candidates, column 15 carriageway candidates. */
  function spawnLevel(): Level {
    const level = roadLevel(30, 10, 5, 7);
    const c = new Uint8Array(30 * 10);
    for (let x = 0; x < 30; x++) {
      c[x] = HAZARD_RULE.KERBSIDE_LOW_POINTS;
      c[9 * 30 + x] = HAZARD_RULE.KERBSIDE_LOW_POINTS;
    }
    for (let y = 0; y < 10; y++) c[y * 30 + 15] = (c[y * 30 + 15] as number) | HAZARD_RULE.CARRIAGEWAY;
    level.hazards = {
      place: [{ id: 'haz.open_manhole', x: 51, y: 9 }],
      random: [
        { id: 'haz.puddle', count: 5, rule: 'kerbside_low_points' },
        { id: 'haz.pothole', count: 4, rule: 'carriageway' },
      ],
      candidates: c,
    };
    level.sites.push({ id: 'haz.speed_bump', rect: [20, 3, 21, 7] });
    return level;
  }

  it('places bumps, then fixed hazards, then random ones on distinct candidate tiles', () => {
    const level = spawnLevel();
    const store = createHazardStore(level, DEFAULT_ENTITIES, sfc32(1));
    expect(spawnHazards(store, level, 1234)).toBe(1 + 1 + 5 + 4);
    expect(store.kind[0]).toBe(BUMP);
    expect([store.col0[0], store.row0[0], store.col1[0], store.row1[0]]).toEqual([20, 3, 21, 7]);
    expect(store.kind[1]).toBe(MANHOLE);
    expect([store.col0[1], store.row0[1]]).toEqual([25, 4]);
    const tiles = new Set<number>();
    for (let i = 2; i < store.count; i++) {
      const t = (store.row0[i] as number) * 30 + (store.col0[i] as number);
      expect(tiles.has(t)).toBe(false);
      tiles.add(t);
      const bits = level.hazards?.candidates[t] as number;
      if (store.kind[i] === PUDDLE) expect(bits & HAZARD_RULE.KERBSIDE_LOW_POINTS).not.toBe(0);
      else expect(bits & HAZARD_RULE.CARRIAGEWAY).not.toBe(0);
    }
  });

  it('is f(seed): the same seed gives the same layout, another seed another', () => {
    const level = spawnLevel();
    const layout = (seed: number): number[] => {
      const store = createHazardStore(level, DEFAULT_ENTITIES, sfc32(1));
      spawnHazards(store, level, seed);
      return Array.from(store.col0.subarray(0, store.count)).concat(
        Array.from(store.row0.subarray(0, store.count)),
      );
    };
    expect(layout(77)).toEqual(layout(77));
    expect(layout(77)).not.toEqual(layout(78));
  });

  it('a request larger than its free candidates places what it can', () => {
    const level = spawnLevel();
    const spec = level.hazards;
    if (spec === null) throw new Error('no spec');
    spec.random = [{ id: 'haz.pothole', count: 50, rule: 'carriageway' }];
    const store = createHazardStore(level, DEFAULT_ENTITIES, sfc32(1));
    // Column 15 has 10 candidate tiles.
    expect(spawnHazards(store, level, 1)).toBe(2 + 10);
  });

  it('throws when a level needs more hazards than the store holds', () => {
    const level = spawnLevel();
    const store = createHazardStore(level, DEFAULT_ENTITIES, sfc32(1), 4);
    expect(() => spawnHazards(store, level, 1)).toThrow(/more than 4 hazards/);
  });

  it('pairs every oil slick with a stain.oil on its tile centre', () => {
    const level = withHazards(roadLevel(), [
      { id: 'haz.oil_slick', x: 31, y: 3 },
      { id: 'haz.puddle', x: 41, y: 3 },
    ]);
    const store = createHazardStore(level, DEFAULT_ENTITIES, sfc32(1));
    const stains = createStainStore(DEFAULT_ENTITIES);
    spawnHazards(store, level, 1, stains);
    expect(stains.count).toBe(1);
    expect(stains.kind[0]).toBe(stainKindIndex('stain.oil'));
    expect([stains.x[0], stains.y[0]]).toEqual([31, 3]);
    expect(hazardSurfaceAtTile(store, 15, 1)).toBe(Surface.Oil);
  });

  it('createWorld spawns the level’s hazards', () => {
    const level = withHazards(roadLevel(), [{ id: 'haz.pothole', x: 61, y: 7 }]);
    const world = createWorld(level, 9, DEFAULT_TUNING);
    expect(world.hazards.count).toBe(1);
    expect(world.hazards.x[0]).toBe(61);
    expect(world.hazards.y[0]).toBe(7);
  });
});

describe('hot path', () => {
  it('stepWorld over grip, jolt and bump hazards allocates nothing per tick (§17 heap-delta check)', () => {
    // A circle (radius about 13 m) over puddles, oil, potholes and a speed bump, with an empty hopper (so no
    // spills, which add litter) and a few crisp packets for the brush-up query to find. The run outlasts the
    // 240 s shift, so it uses the endless-shift tuning (SSP-062 knocks off and gates the input after time-up).
    const level = roadLevel(40, 30, 40, 30, NORTH);
    const world = createWorld(level, 7, endlessShiftTuning());
    const kinds = [PUDDLE, OIL, POTHOLE] as const;
    for (let row = 4; row < 28; row += 4) {
      for (let col = 16; col < 40; col += 4) {
        addHazard(world.hazards, kinds[((row + col) / 4) % 3] as number, col, row, col + 1, row + 1);
      }
    }
    addHazard(world.hazards, BUMP, 22, 14, 23, 18);
    for (let i = 0; i < 20; i++) addLitter(world.litter, 0, 30 + i, 30, 0);
    world.vehicle.hp = 1e9; // potholes would otherwise wear her down to 0 within the run
    const circle = frame(150, 0, 70);
    for (let tick = 0; tick < 30_000; tick++) stepWorld(world, circle);
    let jolts = 0;
    for (let tick = 0; tick < 3600; tick++) {
      stepWorld(world, circle);
      jolts += countEvents(world.events, EV.HazardJolt);
    }
    expect(jolts).toBeGreaterThan(5);
    const delta = measureHeapDelta(() => {
      stepWorld(world, circle);
    });
    assertHeapDeltaWithinThresholds(delta);
  });
});

describe('spillFromHopper (hopper.ts)', () => {
  it('takes LU out, never below 0, keeps the dump counters, and re-arms EV.HopperFull', () => {
    const v = createVehicleState(sweeper, 0, 0, 0);
    const hopper = createHopper(v, createVehicleParams(sweeper, 10), DEFAULT_TUNING.hopper);
    const events = createEventQueue();
    resetEvents(events, 0);
    addToHopper(hopper, 10, events);
    expect(hopper.full).toBe(true);
    expect(countEvents(events, EV.HopperFull)).toBe(1);
    spillFromHopper(hopper, 3);
    expect(v.hopperLU).toBe(7);
    expect(hopper.full).toBe(false);
    expect(hopper.luDumpedTotal).toBe(0);
    addToHopper(hopper, 5, events);
    expect(countEvents(events, EV.HopperFull)).toBe(2);
    spillFromHopper(hopper, 50);
    expect(v.hopperLU).toBe(0);
    expect(() => spillFromHopper(hopper, 0)).toThrow(/LU/);
    expect(() => spillFromHopper(hopper, Number.NaN)).toThrow(/LU/);
  });
});
