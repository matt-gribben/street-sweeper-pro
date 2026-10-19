// Steering allocates nothing per tick (SSP-081; TECHNICAL_DESIGN §17): the §17 heap-delta check
// (tests/support/heapDelta.ts: 600 warm-up ticks, forced GC, 3,600 ticks, forced GC; retained and pre-final-GC
// growth each ≤ 32,768 B) over a World of 60 walkers on a compiled town twice the width of the steering town
// (two zebras, two dropped-kerb crossings, kerbside and pavement props). Every walker runs walkNpc with
// sidestep each tick and, whenever it arrives (or finds no path), asks for a path to a random nav node, so the
// window holds A* searches, segment re-plans, kerb waits through a gap check that says no half of the time,
// zebra crossings and occupancy counts, prop avoidance, separation in crowds and sidesteps of Bessie, who
// drives circles on the road. Runs in the Vitest unit project (--expose-gc); without it the check throws.
import { describe, expect, it } from 'vitest';
import { createInputFrame, THROTTLE_MAX } from '../../src/sim/inputFrame.ts';
import type { Behaviour } from '../../src/sim/npc/behaviour.ts';
import { NavState, requestNavPath, walkNpc } from '../../src/sim/npc/steering.ts';
import { addNpcAt, NpcOrigin } from '../../src/sim/npc/store.ts';
import { nextInt } from '../../src/sim/rng.ts';
import { DEFAULT_TUNING } from '../../src/sim/tuning.ts';
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
import { compileTown, STEERING_TOWN } from '../support/steeringTown.ts';

const WALKERS = 60;
/** Long enough for V8 to optimise every steering path, the rare ones (re-plans, kerb waits) included. */
const PREWARM_TICKS = 100_000;

/** The steering town twice over, side by side (one player start). */
const WIDE_TOWN = STEERING_TOWN.map((row) => row + row.replace('@', '#'));

const wanderer: Behaviour = {
  initial: 0,
  jaywalks: false,
  tick(w: World, i: number): void {
    const s = w.npc.navState[i] as number;
    if (s === NavState.Idle || s === NavState.Arrived || s === NavState.NoPath) {
      requestNavPath(w, i, nextInt(w.npcAi.rng, w.level.nav.nodeCount));
    }
    walkNpc(w, i, true);
  },
  onStimulus(): void {},
};

function steeringRig(): { world: World; step: (t: number) => void; arrivals: () => number } {
  const level = compileTown(WIDE_TOWN);
  const world = createWorld(level, 0x81, endlessShiftTuning());
  world.npcAi.behaviours.fill(wanderer);
  // Say no to every other gap check, so walkers queue at the kerbs.
  world.npcAi.steering.crossingClear = (w) => (w.tick & 64) === 0;
  const nav = level.nav;
  for (let k = 0; k < WALKERS; k++) {
    const n = (k * 37) % nav.nodeCount;
    const i = addNpcAt(world.npc, 0, NpcOrigin.Ambient, nav.nodeX[n] as number, nav.nodeY[n] as number);
    world.npc.radius[i] = DEFAULT_TUNING.streetLife.npcRadius.humanM;
    world.npc.walkMps[i] = k % 5 === 0 ? 0.4 : 1.3;
  }
  const input = createInputFrame();
  input.steer = 20;
  let arrived = 0;
  const step = (t: number): void => {
    input.throttle = world.vehicle.vLongMps < 4 ? THROTTLE_MAX : 0;
    if (t % 600 === 0) input.steer = -input.steer;
    stepWorld(world, input);
    for (let i = 0; i < world.npc.count; i++) {
      if (world.npc.navState[i] === NavState.Arrived && world.npc.navTicks[i] === 0) arrived++;
    }
  };
  return { world, step, arrivals: () => arrived };
}

describe('steering heap-delta check (TECHNICAL_DESIGN §17, SSP-081)', () => {
  it('World.step allocates nothing per tick with 60 walkers pathing, crossing and sidestepping', {
    timeout: 180_000,
  }, () => {
    requireGc();
    const { world, step, arrivals } = steeringRig();
    for (let t = 0; t < PREWARM_TICKS; t++) step(t);
    const before = { searches: world.npcAi.steering.searches, arrivals: arrivals() };
    let occupiedTicks = 0;
    let waitingTicks = 0;
    const delta = measureHeapDelta((t) => {
      step(PREWARM_TICKS + t);
      if ((world.zebras.occupancy[0] as number) + (world.zebras.occupancy[1] as number) > 0) occupiedTicks++;
      for (let i = 0; i < world.npc.count; i++)
        if (world.npc.navState[i] === NavState.KerbWait) waitingTicks++;
    });
    const searches = world.npcAi.steering.searches - before.searches;
    console.log(
      `npcSteeringAlloc: ${HEAP_MEASURED_TICKS} ticks after ${PREWARM_TICKS} + ${HEAP_WARMUP_TICKS} warm-up: ` +
        `retained ${delta.retainedBytes} B (≤ ${HEAP_RETAINED_THRESHOLD_BYTES}), pre-final-GC ${delta.preGcBytes} B ` +
        `(≤ ${HEAP_PRE_GC_THRESHOLD_BYTES}); ${searches} searches, ${arrivals() - before.arrivals} arrivals, ` +
        `zebras occupied on ${occupiedTicks} ticks, ${waitingTicks} NPC-ticks waiting at kerbs`,
    );
    // The window ran the work under test.
    expect(world.npc.count).toBe(WALKERS);
    expect(searches).toBeGreaterThan(20);
    expect(arrivals() - before.arrivals).toBeGreaterThan(10);
    expect(occupiedTicks).toBeGreaterThan(100);
    expect(waitingTicks).toBeGreaterThan(100);
    assertHeapDeltaWithinThresholds(delta);
  });
});
