// Water, spray and stains (SSP-061; GDD §8.2, §8.5, TECHNICAL_DESIGN §10.4, ENTITY_CATALOG §4.2, §5): the tank
// drained by holding SPRAY (exactly 6.0 units in 60 ticks, nothing at 0), the hydrant refill when stopped
// adjacent (empty to 100 in exactly 240 ticks, never above capacity, on Puddle Lane's real hydrants), the spray
// cone's geometry, stain cleaning in the cone (gum after 60 ticks, one EV.StainCleaned, stains outside
// untouched), the stain store, the dog-mess brush-up splat with its −20 penalty hook, and zero allocation.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import tuningJson from '../../src/data/tuning.json' with { type: 'json' };
import { type Brush, BrushState, createBrush } from '../../src/sim/brush.ts';
import { DT_S } from '../../src/sim/constants.ts';
import { LITTER_IDS, type LitterId, STAIN_IDS } from '../../src/sim/entities.ts';
import {
  countEvents,
  createEventQueue,
  EV,
  type EventQueue,
  resetEvents,
  sealEvents,
} from '../../src/sim/eventQueue.ts';
import { BUTTON, createInputFrame, type InputFrame } from '../../src/sim/inputFrame.ts';
import {
  addLitter,
  beginLitterTick,
  createLitterField,
  flingLitter,
  LITTER_CAPACITY,
  type LitterField,
  stepLitter,
} from '../../src/sim/litter.ts';
import { createBlankLevel, decodeLevel, type Level } from '../../src/sim/map.ts';
import { nextFloat, sfc32 } from '../../src/sim/rng.ts';
import {
  addStain,
  cleanStainTick,
  clearStains,
  createStainStore,
  removeStain,
  STAIN_CAPACITY,
  type StainStore,
  stainCleanProgressS,
  stainKindIndex,
  stepBrushUpSplats,
} from '../../src/sim/stains.ts';
import { DEFAULT_ENTITIES, DEFAULT_TUNING, loadTuning, type Tuning } from '../../src/sim/tuning.ts';
import { createVehicleState, type VehicleState } from '../../src/sim/vehicle.ts';
import {
  cleanStainsInCone,
  createWater,
  HYDRANT_PROP_ID,
  isAtHydrant,
  isInSprayCone,
  refillWater,
  setWaterTuning,
  stepWater,
  type Water,
  waterCapacity,
  waterFill,
} from '../../src/sim/water.ts';
import { assertHeapDeltaWithinThresholds, measureHeapDelta } from '../support/heapDelta.ts';

const REPO_ROOT = join(import.meta.dirname, '../..');
const W = DEFAULT_TUNING.water;
const BODY = DEFAULT_TUNING.vehicle.sweeper.body;
const SWEEPER = DEFAULT_TUNING.vehicle.sweeper;
const LEVEL = createBlankLevel('water', 64, 64); // 128 × 128 m
const GUM = stainKindIndex('stain.gum');
const MILKSHAKE = stainKindIndex('stain.milkshake');
const SPLAT = stainKindIndex('stain.splat');
const DOG_MESS = LITTER_IDS.indexOf('litter.dog_mess' satisfies LitterId);
const CRISP = LITTER_IDS.indexOf('litter.crisp_packet' satisfies LitterId);
const HALF_W = BODY.widthM / 2;
const HALF_L = BODY.lengthM / 2;

/** Bessie parked at (64, 64) facing north (local x = world x − 64, local y = 64 − world y), with a water system. */
type Rig = {
  vehicle: VehicleState;
  water: Water;
  stains: StainStore;
  events: EventQueue;
  input: InputFrame;
  tick: number;
  /** StainCleaned events seen, as [tick, entity, a, b, c]. */
  cleaned: number[][];
};

function rig(level: Level = LEVEL, tuning: Tuning = DEFAULT_TUNING, x = 64, y = 64, heading = 0): Rig {
  const vehicle = createVehicleState(tuning.vehicle.sweeper, x, y, heading);
  const water = createWater(vehicle, tuning, level);
  refillWater(water);
  return {
    vehicle,
    water,
    stains: createStainStore(DEFAULT_ENTITIES),
    events: createEventQueue(),
    input: createInputFrame(),
    tick: 0,
    cleaned: [],
  };
}

/** One tick of phase 5 (stepWater) and phase 6 (cleanStainsInCone), with SPRAY held or not. */
function tick(r: Rig, spray: boolean): void {
  resetEvents(r.events, r.tick);
  r.input.buttons = spray ? BUTTON.SPRAY : 0;
  stepWater(r.water, r.input);
  cleanStainsInCone(r.water, r.stains, r.events);
  sealEvents(r.events);
  for (let e = 0; e < r.events.count; e++) {
    if (r.events.type[e] !== EV.StainCleaned) continue;
    r.cleaned.push([
      r.tick,
      r.events.entity[e] as number,
      r.events.a[e] as number,
      r.events.b[e] as number,
      r.events.c[e] as number,
    ]);
  }
  r.tick += 1;
}

/** World position of vehicle-local (lx, ly) for `v`'s pose. */
function toWorld(v: VehicleState, lx: number, ly: number): [number, number] {
  const c = Math.cos(v.headingRad);
  const s = Math.sin(v.headingRad);
  return [v.xM + c * lx + s * ly, v.yM + s * lx - c * ly];
}

function addStainLocal(r: Rig, kind: number, lx: number, ly: number): number {
  const [x, y] = toWorld(r.vehicle, lx, ly);
  return addStain(r.stains, kind, x, y);
}

/** A blank level with hydrants at the given world positions. */
function levelWithHydrants(points: readonly (readonly [number, number])[]): Level {
  const level = createBlankLevel('hydrants', 64, 64);
  for (const [x, y] of points) level.props.push({ id: HYDRANT_PROP_ID, x, y, rot: 0 });
  return level;
}

const PUDDLE_LANE: Level = decodeLevel(
  readFileSync(join(REPO_ROOT, 'public/assets/levels/puddle_lane.json'), 'utf8'),
);

describe('tuning (decided in SSP-061, GDD §8.5)', () => {
  it('holds the tank, rates, cone and hydrant adjacency', () => {
    expect(tuningJson.water).toEqual({
      tankUnits: 100,
      sprayUnitsPerS: 6,
      sprayConeLengthM: 2.6,
      sprayConeApexYM: 1.625,
      sprayConeEndWidthM: 2.6,
      hydrantRefillUnitsPerS: 25,
      hydrantMaxSpeedMps: 0.5,
      hydrantReachM: 1.5,
    });
    // The apex is the front bumper; the end width is the swept brush band (GDD §8.1).
    expect(W.sprayConeApexYM).toBe(BODY.lengthM / 2);
    expect(W.sprayConeEndWidthM).toBeCloseTo(
      DEFAULT_TUNING.sweeping.suction.maxXM - DEFAULT_TUNING.sweeping.suction.minXM,
      12,
    );
    // The hydrant's "stopped" is the depot bay's.
    expect(W.hydrantMaxSpeedMps).toBe(DEFAULT_TUNING.dumping.depotBay.maxSpeedMps);
  });

  it('states the cone, adjacency and splat choices in GDD §8.2 and §8.5', () => {
    const gdd = readFileSync(join(REPO_ROOT, 'docs/GDD.md'), 'utf8');
    const s85 = gdd.slice(gdd.indexOf('### 8.5 Water'), gdd.indexOf('### 8.6'));
    expect(s85).toContain('1.625');
    expect(s85).toContain('1.5 m');
    expect(s85).toContain('0.5 m/s');
    const s82 = gdd.slice(gdd.indexOf('### 8.2 Brush states'), gdd.indexOf('### 8.3'));
    expect(s82).toContain('1.75 × 3.25 m');
  });

  it('marks ENTITY_CATALOG §17 Q8 resolved', () => {
    const catalog = readFileSync(join(REPO_ROOT, 'docs/ENTITY_CATALOG.md'), 'utf8');
    const q8 = catalog.split('\n').find((line) => line.startsWith('| 8 |'));
    expect(q8).toMatch(/Resolved \(M2, SSP-061\)/);
    expect(q8).toMatch(/M2 ✓/);
  });
});

describe('tank and spray', () => {
  it('starts full after refillWater and reports capacity and fill', () => {
    const r = rig();
    expect(r.vehicle.water).toBe(100);
    expect(waterCapacity(r.water)).toBe(100);
    expect(waterFill(r.water)).toBe(1);
  });

  it('holding Spray for 60 ticks uses exactly 6.0 units', () => {
    const r = rig();
    for (let t = 0; t < 60; t++) {
      tick(r, true);
      expect(r.water.spraying).toBe(true);
    }
    expect(r.vehicle.water).toBe(94);
    expect(100 - r.vehicle.water).toBe(6);
    // A full base tank is 1,000 ticks (16.7 s) of spray.
    for (let t = 60; t < 1000; t++) tick(r, true);
    expect(r.vehicle.water).toBe(0);
    tick(r, true);
    expect(r.water.spraying).toBe(false);
  });

  it('uses nothing when Spray is not held', () => {
    const r = rig();
    for (let t = 0; t < 30; t++) tick(r, false);
    expect(r.vehicle.water).toBe(100);
    expect(r.water.spraying).toBe(false);
    expect(r.water.sprayHeld).toBe(false);
  });

  it('spraying has no effect at 0 units, and the tank never goes negative', () => {
    const r = rig();
    r.vehicle.water = 0.25;
    const gum = addStainLocal(r, GUM, 0, 2.5);
    tick(r, true);
    tick(r, true);
    expect(r.vehicle.water).toBeCloseTo(0.05, 12);
    tick(r, true); // the last 0.05 units: still a spraying tick, clamped at 0
    expect(r.water.spraying).toBe(true);
    expect(r.vehicle.water).toBe(0);
    expect(r.stains.cleanTicks[gum]).toBe(3);
    for (let t = 0; t < 120; t++) {
      tick(r, true);
      expect(r.water.spraying).toBe(false);
      expect(r.water.sprayHeld).toBe(true); // the dry pump (SSP-182)
      expect(r.vehicle.water).toBe(0);
    }
    expect(r.stains.cleanTicks[gum]).toBe(3);
    expect(r.stains.count).toBe(1);
    expect(r.cleaned).toEqual([]);
  });

  it('refillWater fills to capacity; setWaterTuning clamps to a smaller tank', () => {
    const r = rig();
    for (let t = 0; t < 100; t++) tick(r, true);
    refillWater(r.water);
    expect(r.vehicle.water).toBe(100);
    const raw = structuredClone(tuningJson);
    raw.water.tankUnits = 150;
    setWaterTuning(r.water, loadTuning(raw));
    expect(r.vehicle.water).toBe(100);
    refillWater(r.water);
    expect(r.vehicle.water).toBe(150);
    raw.water.tankUnits = 80;
    setWaterTuning(r.water, loadTuning(raw));
    expect(r.vehicle.water).toBe(80);
  });
});

describe('hydrant refill', () => {
  it('reads the hydrants from the level props (Puddle Lane has 2)', () => {
    const r = rig(PUDDLE_LANE);
    expect(Array.from(r.water.hydrantX)).toEqual([77, 51]);
    expect(Array.from(r.water.hydrantY)).toEqual([7, 15]);
  });

  it('stopped next to a Puddle Lane hydrant, an empty tank reaches 100 in exactly 240 ticks and never exceeds it', () => {
    // The hydrant at tile (38, 3) is on the north pavement; Bessie stops in the road below it, facing east,
    // her near side 1.125 m from the hydrant's centre.
    const r = rig(PUDDLE_LANE, DEFAULT_TUNING, 77, 9, Math.PI / 2);
    r.vehicle.water = 0;
    expect(isAtHydrant(r.water)).toBe(true);
    for (let t = 1; t <= 240; t++) {
      tick(r, false);
      expect(r.water.refilling).toBe(true);
      if (t === 239) expect(r.vehicle.water).toBeLessThan(100);
      if (t === 120) expect(r.vehicle.water).toBe(50);
    }
    expect(r.vehicle.water).toBe(100);
    for (let t = 0; t < 120; t++) {
      tick(r, false);
      expect(r.vehicle.water).toBe(100);
      expect(r.water.refilling).toBe(false);
    }
  });

  it('refills beside the other Puddle Lane hydrant too', () => {
    // Hydrant at tile (25, 7), on the pavement south of the road; Bessie faces west in the near lane.
    const r = rig(PUDDLE_LANE, DEFAULT_TUNING, 51, 13, -Math.PI / 2);
    r.vehicle.water = 0;
    tick(r, false);
    expect(r.vehicle.water).toBeCloseTo(25 / 60, 12);
  });

  it('needs Bessie below 0.5 m/s (|v| over both axes)', () => {
    const level = levelWithHydrants([[64, 66.625]]); // 1.0 m behind the rear bumper
    const r = rig(level);
    r.vehicle.water = 0;
    r.vehicle.vLongMps = 0.5;
    tick(r, false);
    expect(r.vehicle.water).toBe(0);
    r.vehicle.vLongMps = 0.3;
    r.vehicle.vLatMps = 0.4; // |v| = 0.5
    tick(r, false);
    expect(r.vehicle.water).toBe(0);
    r.vehicle.vLongMps = -0.49;
    r.vehicle.vLatMps = 0;
    tick(r, false);
    expect(r.vehicle.water).toBeCloseTo(25 / 60, 12);
  });

  it('needs the hydrant within 1.5 m of the body OBB (edges inclusive), at any heading', () => {
    for (const heading of [0, 0.7, Math.PI / 2, 2.9, -1.3]) {
      const v = createVehicleState(SWEEPER, 64, 64, heading);
      // Beside the right flank, off the front corner (diagonal), and behind. Edge cases sit 1e-9 m inside, so
      // the rotation's rounding cannot push them out.
      const at = (lx: number, ly: number): boolean => {
        const water = createWater(v, DEFAULT_TUNING, levelWithHydrants([toWorld(v, lx, ly)]));
        return isAtHydrant(water);
      };
      expect(at(HALF_W + 1.5 - 1e-9, 0)).toBe(true);
      expect(at(HALF_W + 1.51, 0)).toBe(false);
      expect(at(-(HALF_W + 1.49), 1)).toBe(true);
      expect(at(0, -(HALF_L + 1.5 - 1e-9))).toBe(true);
      expect(at(0, -(HALF_L + 1.51))).toBe(false);
      const d = 1.5 / Math.SQRT2;
      expect(at(HALF_W + d - 1e-9, HALF_L + d - 1e-9)).toBe(true);
      expect(at(HALF_W + d + 0.01, HALF_L + d + 0.01)).toBe(false);
    }
  });

  it('a level without hydrants never refills', () => {
    const r = rig();
    r.vehicle.water = 10;
    for (let t = 0; t < 60; t++) tick(r, false);
    expect(r.vehicle.water).toBe(10);
  });

  it('refills before spraying when both happen in one tick', () => {
    const r = rig(levelWithHydrants([[64, 67]]));
    r.vehicle.water = 0;
    tick(r, true);
    expect(r.water.spraying).toBe(true);
    expect(r.vehicle.water).toBeCloseTo(25 / 60 - 0.1, 12);
  });
});

describe('spray cone', () => {
  it('is a triangle from the front bumper, 2.6 m long, widening to the 2.6 m brush band', () => {
    for (const heading of [0, 1.1, Math.PI, -2.4]) {
      const r = rig(LEVEL, DEFAULT_TUNING, 40, 70, heading);
      tick(r, true);
      const inCone = (lx: number, ly: number): boolean => {
        const [x, y] = toWorld(r.vehicle, lx, ly);
        return isInSprayCone(r.water, x, y);
      };
      const apex = W.sprayConeApexYM;
      const end = apex + W.sprayConeLengthM;
      expect(inCone(0, apex)).toBe(true);
      expect(inCone(0, apex - 0.01)).toBe(false);
      expect(inCone(0, end - 1e-9)).toBe(true);
      expect(inCone(0, end + 0.01)).toBe(false);
      expect(inCone(1.3 - 1e-9, end - 1e-9)).toBe(true);
      expect(inCone(-1.3 + 1e-9, end - 1e-9)).toBe(true);
      expect(inCone(1.35, end - 0.01)).toBe(false);
      // Half way along, the cone is 1.3 m wide.
      expect(inCone(0.64, apex + 1.3)).toBe(true);
      expect(inCone(-0.66, apex + 1.3)).toBe(false);
      // Behind Bessie and beside her body: never.
      expect(inCone(0, 0)).toBe(false);
      expect(inCone(0, -3)).toBe(false);
    }
  });

  it('is empty when not spraying', () => {
    const r = rig();
    tick(r, false);
    const [x, y] = toWorld(r.vehicle, 0, 2.5);
    expect(isInSprayCone(r.water, x, y)).toBe(false);
  });
});

describe('stain cleaning (phase 6)', () => {
  it('cleans a gum stain inside the cone after 60 ticks with exactly one event; one outside is untouched', () => {
    const r = rig();
    const [gx, gy] = toWorld(r.vehicle, 0.2, 2.5);
    addStain(r.stains, GUM, gx, gy);
    addStainLocal(r, GUM, 2.0, 2.5); // beside the cone
    addStainLocal(r, GUM, 0, 5.0); // beyond its end
    addStainLocal(r, GUM, 0, -1.0); // under Bessie
    for (let t = 1; t <= 59; t++) {
      tick(r, true);
      expect(r.cleaned).toEqual([]);
    }
    expect(stainCleanProgressS(r.stains, 0)).toBeCloseTo(59 * DT_S, 12);
    tick(r, true);
    expect(r.cleaned).toEqual([[59, GUM, gx, gy, 10]]);
    expect(r.stains.count).toBe(3);
    expect(r.stains.stainsCleaned).toBe(1);
    for (let i = 0; i < r.stains.count; i++) {
      expect(r.stains.kind[i]).toBe(GUM);
      expect(r.stains.cleanTicks[i]).toBe(0);
    }
    for (let t = 0; t < 120; t++) tick(r, true);
    expect(r.cleaned).toHaveLength(1);
    expect(r.stains.count).toBe(3);
  });

  it('needs each kind’s spray time from entities.json and keeps progress between passes', () => {
    const r = rig();
    const m = addStainLocal(r, MILKSHAKE, 0, 3);
    for (let t = 0; t < 45; t++) tick(r, true);
    for (let t = 0; t < 30; t++) tick(r, false);
    expect(r.stains.cleanTicks[m]).toBe(45);
    expect(stainCleanProgressS(r.stains, m)).toBeCloseTo(0.75, 12);
    for (let t = 0; t < 44; t++) tick(r, true);
    expect(r.cleaned).toEqual([]);
    tick(r, true);
    expect(r.cleaned).toHaveLength(1);
    expect(r.cleaned[0]?.[1]).toBe(MILKSHAKE);
    expect(r.cleaned[0]?.[4]).toBe(20);
    expect(r.stains.kinds.sprayTicks[stainKindIndex('stain.oil')]).toBe(120);
    expect(r.stains.kinds.sprayTicks[stainKindIndex('stain.chalk_art')]).toBe(120);
  });

  it('cleans a splat like gum (60 ticks) for 0 points: no refund (ENTITY_CATALOG §17 Q8)', () => {
    const r = rig();
    addStainLocal(r, SPLAT, -0.3, 3.4);
    for (let t = 0; t < 60; t++) tick(r, true);
    expect(r.cleaned).toHaveLength(1);
    expect(r.cleaned[0]?.[1]).toBe(SPLAT);
    expect(r.cleaned[0]?.[4]).toBe(0);
  });

  it('cleans several stains on one tick, testing the stain swapped into a freed slot', () => {
    const r = rig();
    const far = addStainLocal(r, GUM, 0, 20); // stays
    addStainLocal(r, GUM, 0, 2.0);
    addStainLocal(r, GUM, 0.3, 3.0);
    addStainLocal(r, GUM, -0.5, 3.6);
    for (let t = 0; t < 60; t++) tick(r, true);
    expect(r.cleaned).toHaveLength(3);
    expect(r.cleaned.every((e) => e[0] === 59)).toBe(true);
    expect(r.stains.count).toBe(1);
    expect(r.stains.y[far]).toBe(64 - 20);
  });

  it('does nothing while not spraying, or with an empty tank', () => {
    const r = rig();
    addStainLocal(r, GUM, 0, 2.5);
    for (let t = 0; t < 120; t++) tick(r, false);
    r.vehicle.water = 0;
    for (let t = 0; t < 120; t++) tick(r, true);
    expect(r.stains.cleanTicks[0]).toBe(0);
    expect(countEvents(r.events, EV.StainCleaned)).toBe(0);
  });
});

describe('stain store', () => {
  it('adds, swap-removes and counts; refuses beyond capacity', () => {
    const store = createStainStore(DEFAULT_ENTITIES);
    expect(store.capacity).toBe(STAIN_CAPACITY);
    for (let i = 0; i < STAIN_CAPACITY; i++) expect(addStain(store, i % STAIN_IDS.length, i, -i)).toBe(i);
    expect(addStain(store, GUM, 1, 1)).toBe(-1);
    expect(store.stainsSpawned).toBe(STAIN_CAPACITY);
    store.cleanTicks[STAIN_CAPACITY - 1] = 7;
    removeStain(store, 3);
    expect(store.count).toBe(STAIN_CAPACITY - 1);
    expect(store.x[3]).toBe(STAIN_CAPACITY - 1);
    expect(store.y[3]).toBe(-(STAIN_CAPACITY - 1));
    expect(store.kind[3]).toBe((STAIN_CAPACITY - 1) % STAIN_IDS.length);
    expect(store.cleanTicks[3]).toBe(7);
    expect(() => removeStain(store, STAIN_CAPACITY - 1)).toThrow(/not a live stain/);
    clearStains(store);
    expect([store.count, store.stainsSpawned, store.stainsCleaned]).toEqual([0, 0, 0]);
  });

  it('validates kind and position', () => {
    const store = createStainStore(DEFAULT_ENTITIES);
    expect(() => addStain(store, STAIN_IDS.length, 0, 0)).toThrow(/STAIN_IDS index/);
    expect(() => addStain(store, 0.5, 0, 0)).toThrow(/STAIN_IDS index/);
    expect(() => addStain(store, GUM, Number.NaN, 0)).toThrow(/finite/);
    expect(() => createStainStore(DEFAULT_ENTITIES, 0)).toThrow(/positive integer/);
  });

  it('cleanStainTick reports the tick a stain becomes clean', () => {
    const store = createStainStore(DEFAULT_ENTITIES);
    addStain(store, GUM, 0, 0);
    for (let t = 1; t < 60; t++) expect(cleanStainTick(store, 0)).toBe(false);
    expect(cleanStainTick(store, 0)).toBe(true);
  });

  it('builds the brush-up table from entities.json: only dog mess makes a stain (splat, −20)', () => {
    const kinds = createStainStore(DEFAULT_ENTITIES).kinds;
    for (let k = 0; k < LITTER_IDS.length; k++) {
      expect(kinds.brushUpStain[k]).toBe(k === DOG_MESS ? SPLAT : -1);
      expect(kinds.brushUpPts[k]).toBe(k === DOG_MESS ? -20 : 0);
    }
    expect(Array.from(kinds.pts)).toEqual(STAIN_IDS.map((id) => DEFAULT_ENTITIES.stains[id].pts));
  });
});

describe('dog-mess brush-up splat (GDD §8.2, ENTITY_CATALOG §4.2)', () => {
  type SplatRig = {
    vehicle: VehicleState;
    brush: Brush;
    field: LitterField;
    stains: StainStore;
    penalty: ReturnType<typeof vi.fn>;
  };

  function splatRig(heading = 0): SplatRig {
    const stains = createStainStore(DEFAULT_ENTITIES);
    const penalty = vi.fn();
    stains.onPenalty = penalty;
    return {
      vehicle: createVehicleState(SWEEPER, 64, 64, heading),
      brush: createBrush(DEFAULT_TUNING, 1),
      field: createLitterField(LEVEL, DEFAULT_TUNING, DEFAULT_ENTITIES),
      stains,
      penalty,
    };
  }

  function step(s: SplatRig, speedMps = 0): number {
    const v = s.vehicle;
    v.vLongMps = speedMps;
    v.xM += Math.sin(v.headingRad) * speedMps * DT_S;
    v.yM -= Math.cos(v.headingRad) * speedMps * DT_S;
    beginLitterTick(s.field);
    const n = stepBrushUpSplats(s.stains, s.field, s.brush, v, SWEEPER);
    stepLitter(s.field);
    return n;
  }

  it('driving brush-up over a dog mess removes it, makes a splat there and calls the penalty hook with −20', () => {
    const s = splatRig();
    const [mx, my] = toWorld(s.vehicle, 0.3, 6); // 6 m ahead
    addLitter(s.field, DOG_MESS, mx, my, 0);
    addLitter(s.field, CRISP, mx + 0.2, my, 0);
    expect(s.brush.state).toBe(BrushState.Raised);
    let splatTick = -1;
    for (let t = 0; t < 120 && splatTick < 0; t++) {
      if (step(s, 5) > 0) splatTick = t;
    }
    // It splats on the tick the front bumper reaches it: 6 − 1.625 m at 5 m/s.
    expect(splatTick).toBe(Math.ceil((6 - HALF_L) / (5 * DT_S)) - 1);
    expect(s.field.count).toBe(1);
    expect(s.field.kind[0]).toBe(CRISP); // no rule: driven over and left
    expect(s.field.litterCollected).toBe(0);
    expect(s.field.litterSpawned).toBe(2);
    expect(s.stains.count).toBe(1);
    expect([s.stains.kind[0], s.stains.x[0], s.stains.y[0], s.stains.cleanTicks[0]]).toEqual([
      SPLAT,
      mx,
      my,
      0,
    ]);
    expect(s.penalty).toHaveBeenCalledTimes(1);
    expect(s.penalty).toHaveBeenCalledWith(-20, mx, my);
    for (let t = 0; t < 60; t++) step(s, 5);
    expect(s.penalty).toHaveBeenCalledTimes(1);
    expect(s.stains.count).toBe(1);
  });

  it('“driven over” is the item centre inside the 1.75 × 3.25 m body OBB, edges inclusive, at any heading', () => {
    for (const heading of [0, 0.4, 2.2, -1.9]) {
      const s = splatRig(heading);
      const inside = [
        [HALF_W, HALF_L],
        [-HALF_W, -HALF_L],
        [0, 0],
        [HALF_W - 0.01, -HALF_L + 0.01],
      ];
      const outside = [
        [HALF_W + 0.01, 0],
        [0, HALF_L + 0.01],
        [-HALF_W - 0.01, -HALF_L],
        [0, -HALF_L - 0.01],
      ];
      // Nudge the exact-edge cases inward by 1e-9 so rotation rounding cannot push them out.
      for (const [lx, ly] of inside) {
        const [x, y] = toWorld(s.vehicle, (lx as number) * (1 - 1e-9), (ly as number) * (1 - 1e-9));
        addLitter(s.field, DOG_MESS, x, y, 0);
      }
      for (const [lx, ly] of outside) {
        const [x, y] = toWorld(s.vehicle, lx as number, ly as number);
        addLitter(s.field, DOG_MESS, x, y, 0);
      }
      expect(step(s)).toBe(inside.length);
      expect(s.field.count).toBe(outside.length);
      expect(s.stains.count).toBe(inside.length);
      expect(s.penalty).toHaveBeenCalledTimes(inside.length);
    }
  });

  it('only while the brush is Raised: not while lowering, collecting or raising', () => {
    for (const state of [
      BrushState.Lowering,
      BrushState.SpinningUp,
      BrushState.Collecting,
      BrushState.Raising,
    ]) {
      const s = splatRig();
      s.brush.state = state;
      addLitter(s.field, DOG_MESS, 64, 64, 0);
      expect(step(s)).toBe(0);
      expect(s.field.count).toBe(1);
      expect(s.penalty).not.toHaveBeenCalled();
    }
  });

  it('never splats an item in the air', () => {
    const s = splatRig();
    const i = addLitter(s.field, DOG_MESS, 64, 64, 0);
    flingLitter(s.field, i, { xM: 64, yM: 70, headingRad: 0 }, sfc32(1));
    expect(step(s)).toBe(0);
    expect(s.field.count).toBe(1);
  });

  it('still splats with no penalty hook attached, and with a full stain store (the penalty still applies)', () => {
    const s = splatRig();
    s.stains.onPenalty = null;
    addLitter(s.field, DOG_MESS, 64, 64, 0);
    expect(step(s)).toBe(1);
    expect(s.stains.count).toBe(1);

    const full = splatRig();
    for (let i = 0; i < STAIN_CAPACITY; i++) addStain(full.stains, GUM, 0, 0);
    addLitter(full.field, DOG_MESS, 64, 64, 0);
    expect(step(full)).toBe(1);
    expect(full.field.count).toBe(0);
    expect(full.stains.count).toBe(STAIN_CAPACITY);
    expect(full.penalty).toHaveBeenCalledWith(-20, 64, 64);
  });

  it('splats every dog mess under Bessie in one tick, following swap-removes', () => {
    const s = splatRig();
    for (let k = 0; k < 5; k++) addLitter(s.field, DOG_MESS, 63.5 + k * 0.25, 63 + k * 0.5, 0);
    for (let k = 0; k < 3; k++) addLitter(s.field, CRISP, 64, 63 + k, 0);
    expect(step(s)).toBe(5);
    expect(s.field.count).toBe(3);
    expect(s.stains.count).toBe(5);
    for (let i = 0; i < s.field.count; i++) expect(s.field.kind[i]).toBe(CRISP);
  });
});

describe('zero allocation per tick (TECHNICAL_DESIGN §17)', () => {
  it('runs stepWater, cleanStainsInCone and stepBrushUpSplats over 2,000 litter and 256 stains', () => {
    // Bessie stops for 1 s in every 10 with the tank below full, so the hydrant reach test runs too.
    const level = levelWithHydrants([
      [30, 30],
      [90, 90],
      [64, 20],
    ]);
    const r = rig(level);
    const brush = createBrush(DEFAULT_TUNING, 2);
    const field = createLitterField(level, DEFAULT_TUNING, DEFAULT_ENTITIES);
    r.stains.onPenalty = () => {};
    const scatter = sfc32(9);
    const refill = (): void => {
      while (field.count < LITTER_CAPACITY) {
        const kind = field.count % 3 === 0 ? DOG_MESS : field.count % LITTER_IDS.length;
        addLitter(field, kind, 2 + nextFloat(scatter) * 124, 2 + nextFloat(scatter) * 124, 0);
      }
      while (r.stains.count < STAIN_CAPACITY) {
        addStain(
          r.stains,
          r.stains.count % STAIN_IDS.length,
          2 + nextFloat(scatter) * 124,
          2 + nextFloat(scatter) * 124,
        );
      }
    };
    refill();
    const v = r.vehicle;
    const step = (t: number): void => {
      // A lap of a 30 m circle at 0–5 m/s, spraying 2 s in every 3, stopping now and then.
      v.headingRad = (t % 1885) / 300;
      const speed = t % 600 < 60 ? 0 : 1 + (t % 5);
      v.vLongMps = speed;
      v.xM += Math.sin(v.headingRad) * speed * DT_S;
      v.yM -= Math.cos(v.headingRad) * speed * DT_S;
      resetEvents(r.events, t);
      r.input.buttons = t % 180 < 120 ? BUTTON.SPRAY : 0;
      beginLitterTick(field);
      stepBrushUpSplats(r.stains, field, brush, v, SWEEPER);
      stepLitter(field);
      stepWater(r.water, r.input);
      cleanStainsInCone(r.water, r.stains, r.events);
      sealEvents(r.events);
      if (t % 900 === 0) refillWater(r.water);
      if (t % 600 === 0) refill();
      if (v.xM < 10 || v.xM > 118 || v.yM < 10 || v.yM > 118) {
        v.xM = 64;
        v.yM = 64;
      }
    };
    for (let t = 0; t < 20_000; t++) step(t);
    const delta = measureHeapDelta((t) => step(20_000 + t));
    assertHeapDeltaWithinThresholds(delta);
  });
});
