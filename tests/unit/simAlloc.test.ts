// The sim hot path allocates nothing per tick with a full LitterField (ROADMAP M2 Budget row; TECHNICAL_DESIGN
// §17; SSP-065): a stress World holding 2,000 litter items and 256 stains over a grimy open district, swept
// with the brush down and the spray on, runs the §17 heap-delta check (tests/support/heapDelta.ts: 600 warm-up
// ticks, forced GC, 3,600 ticks, forced GC; retained and pre-final-GC growth each ≤ 32,768 B). It also logs the
// sim step time for information (initial target ≤ 2 ms p99 on the dev Mac; the binding number is SSP-106's).
//
// Runs in the Vitest unit project, whose forks pool starts workers with `--expose-gc` (vitest.config.ts
// GC_EXPOSED): `npx vitest run tests/unit/simAlloc.test.ts`. Without the flag the check throws; it never skips.
//
// The stress district is hand-built so that nothing in it changes inside the measured window (a §17 trap: a
// scenario whose pattern changes inside the window measures V8 tiering up the new path, not the sim). It is
// 128 × 128 tiles (256 m) of open road with a quarter of its grime cells laid and four frontages. Bessie
// drives east along 2.6 m lanes at about 3.5 m/s (below the 4.0 m/s fling threshold, so the brush collects
// what it meets), and at the east edge the harness moves her back to the west edge one lane south, so the
// brush always meets fresh grime. Every 20 s she raises the brush for 2 s (dog mess splats and leaf piles turn
// to wet leaves under her), and she sprays 2 s in every 3. Each tick the harness adds at most one item (and
// one stain) to keep the stores full at 2,000 and 256, and moves one item and one stain that has fallen more
// than 12 m behind her lane into a band round it, so the brush and the spray keep meeting them; it refills the
// tank every 900 ticks and empties a full hopper over 3 s as a skip would (the shift's dump FSM needs a site;
// this is the hopper half of it). Complaints are active (SSP-078): she honks four times in the first 80 ticks of
// every 10 s, so every 10 s brings EV.Horn, a Noise fact through the penalty pipeline, a chain reset and an
// EV.Complaint, and the harness empties the meter one short of its cap (at 4), so complaints keep landing and
// SACKED (5, SSP-079) never ends the shift.
import { describe, expect, it } from 'vitest';
import { DT_S, TILE_M } from '../../src/sim/constants.ts';
import { LITTER_IDS, STAIN_IDS } from '../../src/sim/entities.ts';
import { DumpSite, startHopperDrain, stepHopperDrain } from '../../src/sim/hopper.ts';
import { BUTTON, createInputFrame, PRESSED, THROTTLE_MAX } from '../../src/sim/inputFrame.ts';
import { addLitter, LITTER_CAPACITY, updateLitterCell } from '../../src/sim/litter.ts';
import { createBlankLevel, GRIME_CELL, Ground, type Level, surfaceOfGround } from '../../src/sim/map.ts';
import { nextFloat, sfc32 } from '../../src/sim/rng.ts';
import { addStain, STAIN_CAPACITY } from '../../src/sim/stains.ts';
import { refillWater } from '../../src/sim/water.ts';
import { createWorld, stepWorld, type World } from '../../src/sim/world.ts';
import { endlessShiftTuning } from '../support/endlessShift.ts';
import {
  assertHeapDeltaWithinThresholds,
  GC_UNAVAILABLE_MESSAGE,
  HEAP_MEASURED_TICKS,
  HEAP_PRE_GC_THRESHOLD_BYTES,
  HEAP_RETAINED_THRESHOLD_BYTES,
  HEAP_WARMUP_TICKS,
  measureHeapDelta,
  requireGc,
} from '../support/heapDelta.ts';

const TILES = 128;
const SIZE_M = TILES * TILE_M;
const EAST = Math.PI / 2;
const LANE_M = 2.6;
/** Edges of the swept area: Bessie turns back to the west edge at EDGE_E, the lanes wrap at EDGE_S. */
const EDGE_W = 8;
const EDGE_E = SIZE_M - 8;
const EDGE_S = SIZE_M - 8;
/** Grime laid at shift start: a quarter of the 1,048,576 cells. */
const GRIME_CELLS = 262_144;
/**
 * Ticks run before measureHeapDelta (whose own 600-tick warm-up follows): long enough for V8 to have
 * optimised every path the tick takes, including those it takes only every few seconds (the raised brush,
 * a hopper drain, a refill). TECHNICAL_DESIGN §17 has why a short pre-warm reads JIT noise, not the sim.
 */
const PREWARM_TICKS = 150_000;

/** The stress district (see the file comment). */
function stressLevel(): Level {
  const level = createBlankLevel('test.sim_alloc', TILES, TILES);
  level.layers.ground.fill(Ground.Road);
  level.layers.surface.fill(surfaceOfGround(Ground.Road));
  level.layers.route.fill(1);
  level.layers.grimeDensity.fill(160);
  level.layers.gutter.fill(GRIME_CELL.OPEN);
  level.grime = { cells: GRIME_CELLS, gutterCells: 0, speckle: 0.05 };
  const half = TILES / 2;
  level.frontages = [0, 1, 2, 3].map((q) => {
    const x0 = (q % 2) * half;
    const y0 = Math.floor(q / 2) * half;
    const cells: [number, number][] = [];
    for (let y = y0; y < y0 + half; y++) for (let x = x0; x < x0 + half; x++) cells.push([x, y]);
    return {
      id: `frontage.stress_${q}`,
      pledge: q === 0,
      rect: [x0, y0, x0 + half, y0 + half],
      face: 'n',
      cells,
    };
  });
  level.player = { x: EDGE_W, y: EDGE_W, heading: EAST };
  return level;
}

/** Half the height of the band round Bessie's lane that the harness keeps litter and stains in, metres. */
const BAND_M = 12;
/** Bessie's cruising speed: below the brush's clean-pickup limit (4.0 m/s), so items are collected, not flung. */
const CRUISE_MPS = 3.5;

/** A stress World and its harness step (see the file comment). `step(t)` runs one tick for absolute tick t. */
function stressRig(): { world: World; step: (t: number) => void } {
  const world = createWorld(stressLevel(), 0x5eed, endlessShiftTuning());
  const v = world.vehicle;
  const litter = world.litter;
  const stains = world.stains;
  // Random fractions drawn up front: the harness's per-tick reads are typed-array loads, not calls that
  // return doubles (a call V8 does not inline boxes its result, and that would be the harness allocating).
  const scatter = sfc32(65);
  const POOL = 4096;
  const fx = new Float64Array(POOL);
  const fy = new Float64Array(POOL);
  for (let i = 0; i < POOL; i++) {
    fx[i] = nextFloat(scatter);
    fy[i] = nextFloat(scatter);
  }
  let draw = 0;
  // The harness runs every tick and does a little each time, so V8 optimises it with the tick: a cold top-up
  // every few seconds would run interpreted inside the window and box every double it touched.
  const tend = (t: number): void => {
    const y0 = v.yM - BAND_M < 4 ? 4 : v.yM - BAND_M;
    const span = (v.yM + BAND_M > SIZE_M - 4 ? SIZE_M - 4 : v.yM + BAND_M) - y0;
    // Keep the store full: at most one new item a tick, in the band round Bessie's lane.
    if (litter.count < LITTER_CAPACITY) {
      draw = (draw + 1) & (POOL - 1);
      const x = EDGE_W + (fx[draw] as number) * (EDGE_E - EDGE_W);
      const y = y0 + (fy[draw] as number) * span;
      addLitter(litter, (litter.litterSpawned * 7) % LITTER_IDS.length, x, y, 0);
    }
    // Move one item a tick, round robin, back into the band if it has fallen behind.
    const i = t % litter.count;
    const dy = (litter.y[i] as number) - v.yM;
    if ((dy < -BAND_M || dy > BAND_M) && (litter.flags[i] as number) === 0) {
      draw = (draw + 1) & (POOL - 1);
      litter.x[i] = EDGE_W + (fx[draw] as number) * (EDGE_E - EDGE_W);
      litter.y[i] = y0 + (fy[draw] as number) * span;
      updateLitterCell(litter, i);
    }
    if (stains.count < STAIN_CAPACITY) {
      draw = (draw + 1) & (POOL - 1);
      const x = EDGE_W + (fx[draw] as number) * (EDGE_E - EDGE_W);
      const y = y0 + (fy[draw] as number) * span;
      addStain(stains, stains.stainsSpawned % STAIN_IDS.length, x, y);
    }
    const k = t % stains.count;
    const sy = (stains.y[k] as number) - v.yM;
    if (sy < -BAND_M || sy > BAND_M) {
      draw = (draw + 1) & (POOL - 1);
      stains.x[k] = EDGE_W + (fx[draw] as number) * (EDGE_E - EDGE_W);
      stains.y[k] = y0 + (fy[draw] as number) * span;
    }
  };
  for (let t = 0; litter.count < LITTER_CAPACITY || stains.count < STAIN_CAPACITY; t++) tend(t);
  const input = createInputFrame();
  const step = (t: number): void => {
    const phase = t % 1200;
    const honk = t % 600 < 80 && t % 20 === 10 ? PRESSED.HORN : 0;
    input.pressed = (phase === 0 || phase === 1080 ? PRESSED.BRUSH : 0) | honk;
    input.buttons = t % 180 < 120 ? BUTTON.SPRAY : 0;
    input.throttle = v.vLongMps < CRUISE_MPS ? THROTTLE_MAX : 0;
    stepWorld(world, input);
    if (v.xM > EDGE_E) {
      v.xM = EDGE_W;
      v.yM = v.yM + LANE_M > EDGE_S ? EDGE_W : v.yM + LANE_M;
      v.headingRad = EAST;
      v.vLatMps = 0;
      v.yawRateRadPerS = 0;
    }
    if (world.hopper.full && world.hopper.drainSite === 0) startHopperDrain(world.hopper, DumpSite.Skip, 180);
    if (world.hopper.drainSite !== 0) stepHopperDrain(world.hopper);
    if (t % 900 === 0) refillWater(world.water);
    if (world.complaints.count >= world.complaints.max - 1) world.complaints.count = 0;
    tend(t);
  };
  return { world, step };
}

/** Nearest-rank percentile of `samples` (sorted ascending). */
function percentile(sorted: Float64Array, p: number): number {
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[i] as number;
}

describe('sim hot path heap-delta check with 2,000 litter items (TECHNICAL_DESIGN §17, SSP-065, SSP-078)', () => {
  it('needs --expose-gc and fails loudly without it (it never skips)', () => {
    expect(typeof globalThis.gc, 'run this file in the Vitest unit project (forks, --expose-gc)').toBe(
      'function',
    );
    expect(() => requireGc()).not.toThrow();
    const gc = globalThis.gc;
    try {
      // Without the flag Node leaves globalThis.gc undefined: the helper throws instead of measuring nothing.
      (globalThis as { gc?: unknown }).gc = undefined;
      expect(() => requireGc()).toThrow(GC_UNAVAILABLE_MESSAGE);
      expect(() => measureHeapDelta(() => {})).toThrow(GC_UNAVAILABLE_MESSAGE);
    } finally {
      (globalThis as { gc?: unknown }).gc = gc;
    }
  });

  it('World.step allocates nothing per tick with the store full, sweeping, spraying and honking', {
    timeout: 120_000,
  }, () => {
    requireGc();
    const { world, step } = stressRig();
    expect(world.litter.count).toBe(LITTER_CAPACITY);
    expect(world.stains.count).toBe(STAIN_CAPACITY);
    expect(world.dirt.initialCells).toBe(GRIME_CELLS);
    for (let t = 0; t < PREWARM_TICKS; t++) step(t);

    // The scenario is doing the work under test as the window opens: a full store, collection, grime erase,
    // spraying, scoring and the frontage tally all moving.
    const before = {
      collected: world.litter.litterCollected,
      grime: world.dirt.cleanedCells,
      stains: world.stains.stainsCleaned,
      score: world.scoring.score,
      noise: world.complaints.noiseOffences,
      honks: world.complaints.honks,
      penalties: world.penalties.applied,
    };
    const delta = measureHeapDelta((t) => step(PREWARM_TICKS + t));
    console.log(
      `simAlloc: ${HEAP_MEASURED_TICKS} ticks after ${PREWARM_TICKS} + ${HEAP_WARMUP_TICKS} warm-up: retained ` +
        `${delta.retainedBytes} B (≤ ${HEAP_RETAINED_THRESHOLD_BYTES}), pre-final-GC ${delta.preGcBytes} B ` +
        `(≤ ${HEAP_PRE_GC_THRESHOLD_BYTES}); litter ${world.litter.count}, collected ` +
        `+${world.litter.litterCollected - before.collected}, grime +${world.dirt.cleanedCells - before.grime}, ` +
        `stains +${world.stains.stainsCleaned - before.stains}, score +${world.scoring.score - before.score}, ` +
        `honks +${world.complaints.honks - before.honks}, Noise +${world.complaints.noiseOffences - before.noise}, ` +
        `penalty facts +${world.penalties.applied - before.penalties}`,
    );
    expect(world.litter.count).toBeGreaterThan(LITTER_CAPACITY - 100);
    expect(world.litter.litterCollected - before.collected).toBeGreaterThan(100);
    expect(world.dirt.cleanedCells - before.grime).toBeGreaterThan(1000);
    expect(world.stains.stainsCleaned - before.stains).toBeGreaterThan(0);
    expect(world.scoring.score).toBeGreaterThan(before.score);
    // Complaints active through the warm-up and the window (4,200 ticks): seven 10 s cycles of four honks and a
    // Noise complaint.
    expect(world.complaints.honks - before.honks).toBe(28);
    expect(world.complaints.noiseOffences - before.noise).toBe(7);
    expect(world.penalties.applied - before.penalties).toBeGreaterThanOrEqual(7);
    assertHeapDeltaWithinThresholds(delta);

    // For information: sim step time over one more minute (TECHNICAL_DESIGN §17; not asserted until SSP-106).
    const start = PREWARM_TICKS + HEAP_WARMUP_TICKS + HEAP_MEASURED_TICKS;
    const ms = new Float64Array(HEAP_MEASURED_TICKS);
    for (let i = 0; i < ms.length; i++) {
      const t0 = performance.now();
      step(start + i);
      ms[i] = performance.now() - t0;
    }
    ms.sort();
    console.log(
      `simAlloc: sim step time over ${ms.length} ticks (${(ms.length * DT_S).toFixed(0)} s of sim): p50 ` +
        `${percentile(ms, 0.5).toFixed(3)} ms, p99 ${percentile(ms, 0.99).toFixed(3)} ms, max ` +
        `${percentile(ms, 1).toFixed(3)} ms (initial target ≤ 2 ms p99 on the dev Mac)`,
    );
  });
});
