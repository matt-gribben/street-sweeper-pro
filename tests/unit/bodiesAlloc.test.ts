// Phase 4 allocates nothing per tick with a full knockable store (TECHNICAL_DESIGN §17, §9.3; SSP-092): a World
// holding 128 knockables (the §7.1 capacity, all five kinds) runs the §17 heap-delta check (tests/support/
// heapDelta.ts: 600 warm-up ticks, forced GC, 3,600 ticks, forced GC; retained and pre-final-GC growth each
// ≤ 32,768 B) while Bessie ploughs through them.
//
// The district is 96 × 24 tiles (192 × 48 m) of open road with rows of bollards between three east-west
// lanes, so knocked bodies slide into static props and the map edge as well as into each other. Bessie cruises
// east at about 9 m/s along a lane; at the east edge the harness moves her back to the west edge on the next
// lane. Each tick the harness looks at one body (round robin): one that has come to rest behind her, or out of
// her lane, is put back on her lane 15–55 m ahead, at a fresh heading and unknocked, so every minute brings
// first knocks (penalty facts through the penalty log, chain resets, litter spills through addLitter on the
// events stream) as well as second hits, body-body impacts and static bounces. The harness removes one litter
// item a tick while the LitterField holds more than 300, so spills always have room. Nothing in the scenario
// changes inside the measured window (the §17 trap: a new code path inside the window measures V8 tiering
// up, not the sim).
//
// Runs in the Vitest unit project, whose forks pool starts workers with `--expose-gc`.
import { describe, expect, it } from 'vitest';
import { BODY_CAPACITY, BodyFlag, updateBodyBounds } from '../../src/sim/bodies.ts';
import { TILE_M } from '../../src/sim/constants.ts';
import { KNOCKABLE_IDS } from '../../src/sim/entities.ts';
import { createInputFrame, THROTTLE_MAX } from '../../src/sim/inputFrame.ts';
import { removeLitter } from '../../src/sim/litter.ts';
import { createBlankLevel, Ground, type Level, type LevelProp, surfaceOfGround } from '../../src/sim/map.ts';
import { nextFloat, sfc32 } from '../../src/sim/rng.ts';
import { createWorld, stepWorld, type World } from '../../src/sim/world.ts';
import { endlessShiftTuning } from '../support/endlessShift.ts';
import {
  assertHeapDeltaWithinThresholds,
  HEAP_MEASURED_TICKS,
  HEAP_PRE_GC_THRESHOLD_BYTES,
  HEAP_RETAINED_THRESHOLD_BYTES,
  HEAP_WARMUP_TICKS,
  measureHeapDelta,
  requireGc,
} from '../support/heapDelta.ts';

const W = 96;
const H = 24;
const EAST = Math.PI / 2;
const EDGE_W = 6;
const EDGE_E = W * TILE_M - 6;
const LANES = [12, 24, 36] as const;
const CRUISE_MPS = 9;
const LITTER_KEEP = 300;
/** Ticks before measureHeapDelta (whose own 600-tick warm-up follows): see simAlloc.test.ts. */
const PREWARM_TICKS = 100_000;

function stressLevel(): Level {
  const level = createBlankLevel('test.bodies_alloc', W, H);
  level.layers.ground.fill(Ground.Road);
  level.layers.surface.fill(surfaceOfGround(Ground.Road));
  // Bollards 4 m either side of each lane, every 12 m.
  const props: LevelProp[] = [];
  for (const lane of LANES) {
    for (let x = 10; x < W * TILE_M - 10; x += 12) {
      props.push({ id: 'prop.bollard', x, y: lane - 4.5, rot: 0 });
      props.push({ id: 'prop.bollard', x: x + 6, y: lane + 4.5, rot: 0 });
    }
  }
  level.props = props;
  // 128 knockables, the five kinds in turn, in loose clumps along the lanes.
  level.knockables = [];
  for (let i = 0; i < BODY_CAPACITY; i += 1) {
    const lane = LANES[i % LANES.length] as number;
    const id = KNOCKABLE_IDS[i % KNOCKABLE_IDS.length] as string;
    level.knockables.push({ id, x: 20 + Math.floor(i / 3) * 3.9, y: lane + ((i * 7) % 5) * 0.3 - 0.6 });
  }
  level.player = { x: EDGE_W, y: LANES[0], heading: EAST };
  return level;
}

function rig(): { world: World; step: (t: number) => void } {
  const world = createWorld(stressLevel(), 0x5092, endlessShiftTuning());
  const v = world.vehicle;
  const b = world.bodies;
  const litter = world.litter;
  // Random fractions drawn up front, so the harness's per-tick reads are typed-array loads (see simAlloc).
  const scatter = sfc32(92);
  const POOL = 4096;
  const f = new Float64Array(POOL);
  for (let i = 0; i < POOL; i++) f[i] = nextFloat(scatter);
  let draw = 0;
  let lane = 0;
  const laneY = Float64Array.from(LANES);
  // Per-tick doubles the harness compares against: [lane y, lane y − 2, lane y + 2, Bessie's x − 4]. Typed
  // arrays, not locals or object fields: the harness must not allocate either (measured: a double local in its
  // re-placement test boxed once a tick).
  const g = new Float64Array(4);
  const input = createInputFrame();
  const step = (t: number): void => {
    input.throttle = v.vLongMps < CRUISE_MPS ? THROTTLE_MAX : 0;
    stepWorld(world, input);
    if (v.xM > EDGE_E) {
      lane = (lane + 1) % LANES.length;
      v.xM = EDGE_W;
      v.yM = laneY[lane] as number;
      v.headingRad = EAST;
      v.vLatMps = 0;
      v.yawRateRadPerS = 0;
      v.steerRad = 0;
    }
    g[0] = laneY[lane] as number;
    g[1] = (g[0] as number) - 2;
    g[2] = (g[0] as number) + 2;
    g[3] = v.xM - 4;
    // One body a tick: at rest behind her or out of her lane → back on her lane ahead, unknocked.
    const i = t % b.count;
    if (
      b.vx[i] === 0 &&
      b.vy[i] === 0 &&
      b.omega[i] === 0 &&
      ((b.x[i] as number) < (g[3] as number) ||
        (b.y[i] as number) > (g[2] as number) ||
        (b.y[i] as number) < (g[1] as number))
    ) {
      draw = (draw + 3) & (POOL - 1);
      b.x[i] = v.xM + 15 + (f[draw] as number) * 40;
      if ((b.x[i] as number) > EDGE_E - 2) b.x[i] = EDGE_W + 20 + (f[draw] as number) * 20;
      b.y[i] = (g[0] as number) + ((f[(draw + 1) & (POOL - 1)] as number) - 0.5) * 1.6;
      b.heading[i] = (f[(draw + 2) & (POOL - 1)] as number) * 3;
      b.flags[i] = 0;
      b.rearmTicks[i] = 0;
      updateBodyBounds(b, i);
    }
    if (litter.count > LITTER_KEEP) removeLitter(litter, 0);
  };
  return { world, step };
}

describe('phase 4 heap-delta check with 128 knockables (TECHNICAL_DESIGN §17, SSP-092)', () => {
  it('World.step allocates nothing per tick with 128 bodies being knocked, spilling and colliding', {
    timeout: 180_000,
  }, () => {
    requireGc();
    const { world, step } = rig();
    expect(world.bodies.count).toBe(BODY_CAPACITY);
    for (let t = 0; t < PREWARM_TICKS; t++) step(t);
    const b = world.bodies;
    const before = {
      knocks: b.knocks,
      knocked: b.bodiesKnocked,
      spilled: b.itemsSpilled,
      penalties: world.penalties.applied,
    };
    let moving = 0;
    for (let i = 0; i < b.count; i++) if (b.vx[i] !== 0 || b.vy[i] !== 0) moving += 1;
    const delta = measureHeapDelta((t) => step(PREWARM_TICKS + t));
    let knockedFlags = 0;
    for (let i = 0; i < b.count; i++)
      if (((b.flags[i] as number) & BodyFlag.Knocked) !== 0) knockedFlags += 1;
    console.log(
      `bodiesAlloc: ${HEAP_MEASURED_TICKS} ticks after ${PREWARM_TICKS} + ${HEAP_WARMUP_TICKS} warm-up: retained ` +
        `${delta.retainedBytes} B (≤ ${HEAP_RETAINED_THRESHOLD_BYTES}), pre-final-GC ${delta.preGcBytes} B ` +
        `(≤ ${HEAP_PRE_GC_THRESHOLD_BYTES}); knocks +${b.knocks - before.knocks}, first knocks ` +
        `+${b.bodiesKnocked - before.knocked}, items spilled +${b.itemsSpilled - before.spilled}, penalty facts ` +
        `+${world.penalties.applied - before.penalties}; moving at the window's start ${moving}, knocked now ` +
        `${knockedFlags}`,
    );
    // The window did the work under test: knocks, first knocks with their penalties and spills.
    expect(b.knocks - before.knocks).toBeGreaterThan(50);
    expect(b.bodiesKnocked - before.knocked).toBeGreaterThan(20);
    expect(b.itemsSpilled - before.spilled).toBeGreaterThan(20);
    expect(world.penalties.applied - before.penalties).toBeGreaterThan(10);
    assertHeapDeltaWithinThresholds(delta);
  });
});
