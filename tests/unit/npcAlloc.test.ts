// Phase 7 allocates nothing per tick with the NPC store full (SSP-080; TECHNICAL_DESIGN §17): the §17 heap-delta
// check (tests/support/heapDelta.ts: 600 warm-up ticks, forced GC, 3,600 ticks, forced GC; retained and
// pre-final-GC growth each ≤ 32,768 B) over a World holding 80 NPCs (ambient people, dog walkers with their
// dogs, a pigeon flock and two perched cats) on the open district of tests/support/npcTown.ts, 192 m square.
//
// Everything phase 7 does runs inside the window: the spawner spawns and retires people every second as
// Bessie circles and is moved round four spots of the map every 20 s, the behaviours walk them (a test
// behaviour, below: walk straight, turn back at the map edge, hurry for a second when honked at, moving them
// through the spatial hash), the harness pushes a Horn stimulus every 0.5 s and a Hit at one NPC every 1.5 s,
// and a quarter of the store runs its perception query every tick. Runs in the Vitest unit project, whose
// forks pool has --expose-gc; without it the check throws, it never skips.
import { describe, expect, it } from 'vitest';
import { DT_S } from '../../src/sim/constants.ts';
import { cos, sin } from '../../src/sim/fmath.ts';
import { createInputFrame, THROTTLE_MAX } from '../../src/sim/inputFrame.ts';
import { type Behaviour, Stimulus } from '../../src/sim/npc/behaviour.ts';
import { pushStimulus } from '../../src/sim/npc/stimuli.ts';
import {
  NO_NPC_HANDLE,
  NPC_CAPACITY,
  npcHandle,
  setNpcState,
  updateNpcCell,
} from '../../src/sim/npc/store.ts';
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
import { npcTown } from '../support/npcTown.ts';

const TILES = 96;
const SIZE_M = TILES * 2;
/** See simAlloc.test.ts: long enough for V8 to optimise every path, including the once-a-second ones. */
const PREWARM_TICKS = 150_000;

const WALK = { Start: 0, Walk: 1, Hurry: 2 } as const;

/** Walk straight at 1.2 m/s (2.5 m/s for a second after a Horn), turning back at the map edge. */
const walker: Behaviour = {
  initial: WALK.Start,
  tick(w: World, i: number): void {
    const npc = w.npc;
    if (npc.state[i] === WALK.Start) {
      npc.heading[i] = ((npc.handleSlot[i] as number) * 2.399963) % (2 * Math.PI);
      setNpcState(npc, i, WALK.Walk);
    } else if (npc.state[i] === WALK.Hurry && (npc.stateTicks[i] as number) >= 60) {
      setNpcState(npc, i, WALK.Walk);
    }
    const speed = npc.state[i] === WALK.Hurry ? 2.5 : 1.2;
    npc.speed[i] = speed;
    const h = npc.heading[i] as number;
    const x = (npc.x[i] as number) + sin(h) * speed * DT_S;
    const y = (npc.y[i] as number) - cos(h) * speed * DT_S;
    if (x < 1 || y < 1 || x > SIZE_M - 1 || y > SIZE_M - 1) {
      npc.heading[i] = h + Math.PI;
    } else {
      npc.x[i] = x;
      npc.y[i] = y;
      updateNpcCell(npc, i);
    }
  },
  onStimulus(w: World, i: number, s: Stimulus): void {
    if (s === Stimulus.Horn) setNpcState(w.npc, i, WALK.Hurry);
    else if (s === Stimulus.Hit) w.npc.heading[i] = (w.npc.heading[i] as number) + 1;
  },
};

const HOPS = new Float64Array([48, 48, 144, 48, 144, 144, 48, 144]);

function npcRig(): { world: World; step: (t: number) => void } {
  const { level } = npcTown(TILES, {
    population: [{ fromS: 0, toS: 100_000, target: 80 }],
    mix: [
      { id: 'npc.dog_walker', weight: 20 },
      { id: 'npc.postie', weight: 20 },
      { id: 'npc.shopper', weight: 60 },
    ],
    caps: [{ id: 'npc.dog_walker', cap: 8 }],
    perches: {
      id: 'npc.cat',
      count: 2,
      on: ['walls'],
      walls: [
        [5, 5],
        [187, 187],
      ],
    },
    flocks: [{ id: 'npc.pigeon', count: 1, size: [6, 10], points: [[96, 180]] }],
  });
  const world = createWorld(level, 0x80, endlessShiftTuning());
  world.npcAi.behaviours.fill(walker);
  const v = world.vehicle;
  const input = createInputFrame();
  input.steer = 50;
  const q = world.npcAi.stimuli;
  const step = (t: number): void => {
    if (t % 1200 === 0) {
      const k = ((t / 1200) & 3) * 2;
      v.xM = HOPS[k] as number;
      v.yM = HOPS[k + 1] as number;
    }
    input.throttle = v.vLongMps < 5 ? THROTTLE_MAX : 0;
    if (t % 30 === 0) {
      const s = pushStimulus(q, Stimulus.Horn, NO_NPC_HANDLE);
      q.x[s] = v.xM;
      q.y[s] = v.yM;
      q.radiusM[s] = 30;
    }
    if (t % 90 === 0 && world.npc.count > 0)
      pushStimulus(q, Stimulus.Hit, npcHandle(world.npc, t % world.npc.count));
    stepWorld(world, input);
  };
  return { world, step };
}

describe('phase 7 heap-delta check with 80 NPCs (TECHNICAL_DESIGN §17, SSP-080)', () => {
  it('World.step allocates nothing per tick with the NPC store full and churning', {
    timeout: 120_000,
  }, () => {
    requireGc();
    const { world, step } = npcRig();
    const sp = world.npcAi.spawner;
    for (let t = 0; t < PREWARM_TICKS; t++) step(t);
    const before = {
      spawned: sp.ambientSpawned,
      retired: sp.ambientRetired,
      delivered: world.npcAi.stimuli.delivered,
    };
    let minCount = NPC_CAPACITY;
    let fullTicks = 0;
    const counts = new Int32Array(HEAP_WARMUP_TICKS + HEAP_MEASURED_TICKS);
    const delta = measureHeapDelta((t) => {
      step(PREWARM_TICKS + t);
      counts[t] = world.npc.count;
    });
    for (let t = HEAP_WARMUP_TICKS; t < counts.length; t++) {
      const n = counts[t] as number;
      if (n < minCount) minCount = n;
      if (n === NPC_CAPACITY) fullTicks++;
    }
    console.log(
      `npcAlloc: ${HEAP_MEASURED_TICKS} ticks after ${PREWARM_TICKS} + ${HEAP_WARMUP_TICKS} warm-up: retained ` +
        `${delta.retainedBytes} B (≤ ${HEAP_RETAINED_THRESHOLD_BYTES}), pre-final-GC ${delta.preGcBytes} B ` +
        `(≤ ${HEAP_PRE_GC_THRESHOLD_BYTES}); NPCs min ${minCount}, full on ${fullTicks} ticks; spawned ` +
        `+${sp.ambientSpawned - before.spawned}, retired +${sp.ambientRetired - before.retired}, stimuli ` +
        `delivered +${world.npcAi.stimuli.delivered - before.delivered}`,
    );
    // The window ran the work under test: a full store, spawns and retirements, stimuli delivered.
    expect(fullTicks).toBeGreaterThan(HEAP_MEASURED_TICKS / 2);
    expect(minCount).toBeGreaterThanOrEqual(NPC_CAPACITY - 8);
    expect(sp.ambientSpawned - before.spawned).toBeGreaterThan(10);
    expect(sp.ambientRetired - before.retired).toBeGreaterThan(10);
    expect(world.npcAi.stimuli.delivered - before.delivered).toBeGreaterThan(100);
    assertHeapDeltaWithinThresholds(delta);
  });
});
