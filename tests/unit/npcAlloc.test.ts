// Phase 7 allocates nothing per tick with the NPC store full (SSP-080; TECHNICAL_DESIGN §17): the §17 heap-delta
// check (tests/support/heapDelta.ts: 600 warm-up ticks, forced GC, 3,600 ticks, forced GC; retained and
// pre-final-GC growth each ≤ 32,768 B) over a World holding 80 NPCs (ambient people, dog walkers with their
// dogs, a pigeon flock and two perched cats) on the open district of tests/support/npcTown.ts, 192 m square.
//
// Everything phase 7 does runs inside the window: the spawner spawns and retires people every second as
// Bessie circles and is moved round four spots of the map every 20 s (and, between those, driven at an NPC
// every 10 s, so actor hits run in the window), the behaviours walk them (a test
// behaviour, below: walk straight, turn back at the map edge, hurry for a second when honked at, moving them
// through the spatial hash), the harness pushes a Horn stimulus every 0.5 s and a Hit at one NPC every 1.5 s,
// and a quarter of the store runs its perception query every tick. With the registry's behaviours (the generic
// pedestrians and, since SSP-086, the dog walkers and their dogs) the harness also puts someone just ahead of
// Bessie's nose every 3 s and a dog walker and its dog either side of her path 1.5 s later, so actor hits and Lead
// Tangles happen inside the window whatever the crowd does (people who see her coming yield, so meeting her by
// chance was a coin flip per window). Runs in the Vitest unit project, whose forks pool has --expose-gc; without
// it the check throws, it never skips.
import { describe, expect, it } from 'vitest';
import { DT_S } from '../../src/sim/constants.ts';
import { NPC_IDS } from '../../src/sim/entities.ts';
import { countEvents, EV } from '../../src/sim/eventQueue.ts';
import { cos, sin } from '../../src/sim/fmath.ts';
import { BUTTON, createInputFrame, THROTTLE_MAX } from '../../src/sim/inputFrame.ts';
import { type Behaviour, Stimulus } from '../../src/sim/npc/behaviour.ts';
import { leadDog } from '../../src/sim/npc/behaviours/dogWalker.ts';
import { pushStimulus } from '../../src/sim/npc/stimuli.ts';
import {
  NO_NPC_HANDLE,
  NPC_CAPACITY,
  NPC_FLAG,
  npcHandle,
  setNpcState,
  updateNpcCell,
} from '../../src/sim/npc/store.ts';
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
import { npcTown } from '../support/npcTown.ts';

const TILES = 96;
const SIZE_M = TILES * 2;
/** See simAlloc.test.ts: long enough for V8 to optimise every path, including the once-a-second ones. */
const PREWARM_TICKS = 150_000;

const WALK = { Start: 0, Walk: 1, Hurry: 2 } as const;

/** Walk straight at 1.2 m/s (2.5 m/s for a second after a Horn), turning back at the map edge. */
const walker: Behaviour = {
  initial: WALK.Start,
  jaywalks: false,
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
const DORIS_KIND = NPC_IDS.indexOf('npc.old_woman');
const LITTERBUG_KIND = NPC_IDS.indexOf('npc.litterbug');
/** Where the Doris rig puts her: 2 m ahead of Bessie's front bumper, from her body centre, metres. */
const AHEAD_M = 1.625 + 2;
/** Bessie is only aimed at NPCs at least this far inside the map, metres. */
const AIM_MARGIN_M = 24;
/**
 * Where the Doris rig puts a litterbug as each spray ends: this far to Bessie's right of her centre, metres, inside
 * the litterbug's 6 m Caught! radius, so the horn pushed on the same tick catches him (SSP-085 review).
 */
const CAUGHT_SIDE_M = 3;
/** Bessie's half length, plus a little: where the harness puts an NPC in her way, metres ahead of her centre. */
const NOSE_M = DEFAULT_TUNING.vehicle.sweeper.body.lengthM / 2 + 0.6;

/** Put NPC `i` `aheadM` ahead of Bessie's centre and `rightM` to her right (a test standing in for its walk). */
function putInPath(world: World, i: number, aheadM: number, rightM: number): void {
  const v = world.vehicle;
  const s = sin(v.headingRad);
  const c = cos(v.headingRad);
  world.npc.x[i] = v.xM + s * aheadM + c * rightM;
  world.npc.y[i] = v.yM - c * aheadM + s * rightM;
  updateNpcCell(world.npc, i);
}

/**
 * The rig: `generic` keeps the registry's behaviours (the SSP-082 generic pedestrian for the people, the SSP-084
 * shopper, businessman and litterbug, the SSP-085 old man, mum and postie, the SSP-086 dog walker and its dog, the
 * SSP-088 pigeons, the no-op for the cats) instead of the test walker, so the reaction model's states run in the
 * window, with the shoppers' sidesteps, the businessmen's 2 m startles, the litterbugs' drops and, under the
 * harness's horn, their Caught! (EV.Caught, the bonus in phase 9) and slinking off, and the dog walkers' Lead
 * Tangles and dog mess. `doris`
 * adds Doris (SSP-083) to the mix and sprays for 2 s of every 4 (the tank topped up), so her glare, fist shake,
 * chase and handbag whacks run too; Bessie's HP is restored every tick so the whacks never get her TOWED. As each
 * spray ends it also puts a litterbug not yet caught 3 m to her right, so the harness's horn catches him there and
 * the Doris window holds Caught! bonuses by construction (the every-10 s aim skips litterbugs, so without this
 * whether the crowd brought one within 6 m of her in the window was chance: none did at the SSP-085 merge).
 */
function npcRig(
  generic = false,
  doris = false,
): { world: World; step: (t: number) => void; tangles: Int32Array } {
  const { level } = npcTown(TILES, {
    population: [{ fromS: 0, toS: 100_000, target: 80 }],
    mix: [
      { id: 'npc.businessman', weight: 15 },
      { id: 'npc.dog_walker', weight: 20 },
      ...(doris ? [{ id: 'npc.old_woman' as const, weight: 40 }] : []),
      { id: 'npc.litterbug', weight: 20 },
      { id: 'npc.mum_pushchair', weight: 10 },
      { id: 'npc.old_man_frame', weight: 10 },
      { id: 'npc.postie', weight: 20 },
      { id: 'npc.shopper', weight: 15 },
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
  // Bessie knocks people over as she circles (SSP-082's actor hits run inside the window too), so the meter
  // must never reach SACKED, which would freeze the World.
  const world = createWorld(
    level,
    0x80,
    endlessShiftTuning((raw) => {
      raw.complaints.meter.sackedAt = 1_000_000_000;
    }),
  );
  if (!generic) world.npcAi.behaviours.fill(walker);
  const v = world.vehicle;
  const input = createInputFrame();
  input.steer = 50;
  const q = world.npcAi.stimuli;
  const tangles = new Int32Array(1);
  const step = (t: number): void => {
    if (t % 1200 === 0) {
      const k = ((t / 1200) & 3) * 2;
      v.xM = HOPS[k] as number;
      v.yM = HOPS[k + 1] as number;
    } else if (t % 600 === 0 && world.npc.count > 0) {
      // Every 10 s (between the hops), aim her at an NPC from 3 m south of it, heading north at 5 m/s, so the
      // window always holds actor hits (SSP-085: before, they depended on where the crowd happened to stand).
      // Only at one well inside the map, so she never runs into its edge (the crash damage would tow her).
      const npc = world.npc;
      for (let k = 0; k < npc.count; k++) {
        const j = (t / 600 + k) % npc.count;
        // Not at a litterbug: the horn would catch him (SSP-084), and the rig needs them dropping.
        if (npc.kind[j] === LITTERBUG_KIND) continue;
        const x = npc.x[j] as number;
        const y = npc.y[j] as number;
        if (x < AIM_MARGIN_M || y < AIM_MARGIN_M || x > SIZE_M - AIM_MARGIN_M || y > SIZE_M - AIM_MARGIN_M)
          continue;
        v.xM = x;
        v.yM = y + 3;
        v.headingRad = 0;
        v.vLongMps = 5;
        v.vLatMps = 0;
        v.yawRateRadPerS = 0;
        break;
      }
    }
    input.throttle = v.vLongMps < 5 ? THROTTLE_MAX : 0;
    if (doris) {
      // Stop and spray for 2 s of every 4, with a Doris put 2 m ahead of the bumper as it starts, so she is
      // sprayed, catches Bessie and whacks.
      const spraying = t % 240 < 120;
      input.buttons = spraying ? BUTTON.SPRAY : 0;
      if (spraying) input.throttle = 0;
      if (t % 240 === 0) {
        v.vLongMps = 0;
        v.vLatMps = 0;
        v.yawRateRadPerS = 0;
        const npc = world.npc;
        for (let i = 0; i < npc.count; i++) {
          if (npc.kind[i] !== DORIS_KIND) continue;
          npc.x[i] = v.xM + sin(v.headingRad) * AHEAD_M;
          npc.y[i] = v.yM - cos(v.headingRad) * AHEAD_M;
          updateNpcCell(npc, i);
          break;
        }
      }
      if (t % 240 === 120) {
        // The spray has ended: put a litterbug beside her for the horn below (t % 30 === 0) to catch.
        const npc = world.npc;
        for (let i = 0; i < npc.count; i++) {
          if (npc.kind[i] !== LITTERBUG_KIND || ((npc.flags[i] as number) & NPC_FLAG.LEAVING) !== 0) continue;
          putInPath(world, i, 0, CAUGHT_SIDE_M);
          break;
        }
      }
      v.water = 100;
      v.hp = 100;
    }
    if (t % 30 === 0) {
      const s = pushStimulus(q, Stimulus.Horn, NO_NPC_HANDLE);
      q.x[s] = v.xM;
      q.y[s] = v.yM;
      q.radiusM[s] = 30;
    }
    if (t % 90 === 0 && world.npc.count > 0)
      pushStimulus(q, Stimulus.Hit, npcHandle(world.npc, t % world.npc.count));
    const npc = world.npc;
    if (generic && t % 180 === 0 && npc.count > 0) putInPath(world, (t / 180) % npc.count, NOSE_M, 0);
    if (generic && t % 180 === 90) {
      for (let i = 0; i < npc.count; i++) {
        const dog = leadDog(npc, i);
        if (dog < 0) continue;
        putInPath(world, i, NOSE_M + 1, -2);
        putInPath(world, dog, NOSE_M + 1, 2);
        break;
      }
    }
    stepWorld(world, input);
    tangles[0] = (tangles[0] as number) + countEvents(world.events, EV.LeadTangle);
  };
  return { world, step, tangles };
}

/** The §17 heap check over the rig; logs the window's work and asserts that it ran. */
function checkPhase7Heap(label: string, generic: boolean, doris = false): void {
  requireGc();
  const { world, step, tangles } = npcRig(generic, doris);
  const sp = world.npcAi.spawner;
  const reactions = world.npcAi.reactions;
  for (let t = 0; t < PREWARM_TICKS; t++) step(t);
  const before = {
    spawned: sp.ambientSpawned,
    retired: sp.ambientRetired,
    delivered: world.npcAi.stimuli.delivered,
    hits: reactions.hits,
    bumps: reactions.bumps,
    bonusPts: world.scoring.bonusPts,
    litterSpawned: world.litter.litterSpawned,
    tangles: tangles[0] as number,
  };
  let minCount = NPC_CAPACITY;
  let fullTicks = 0;
  const counts = new Int32Array(HEAP_WARMUP_TICKS + HEAP_MEASURED_TICKS);
  let whacks = 0;
  const delta = measureHeapDelta((t) => {
    step(PREWARM_TICKS + t);
    counts[t] = world.npc.count;
    if (t >= HEAP_WARMUP_TICKS) whacks += countEvents(world.events, EV.HandbagWhack);
  });
  for (let t = HEAP_WARMUP_TICKS; t < counts.length; t++) {
    const n = counts[t] as number;
    if (n < minCount) minCount = n;
    if (n === NPC_CAPACITY) fullTicks++;
  }
  console.log(
    `${label}: ${HEAP_MEASURED_TICKS} ticks after ${PREWARM_TICKS} + ${HEAP_WARMUP_TICKS} warm-up: retained ` +
      `${delta.retainedBytes} B (≤ ${HEAP_RETAINED_THRESHOLD_BYTES}), pre-final-GC ${delta.preGcBytes} B ` +
      `(≤ ${HEAP_PRE_GC_THRESHOLD_BYTES}); NPCs min ${minCount}, full on ${fullTicks} ticks; spawned ` +
      `+${sp.ambientSpawned - before.spawned}, retired +${sp.ambientRetired - before.retired}, stimuli ` +
      `delivered +${world.npcAi.stimuli.delivered - before.delivered}, actor hits ` +
      `+${reactions.hits - before.hits}, bumps +${reactions.bumps - before.bumps}, handbag whacks ${whacks}, ` +
      `Caught! bonus ` +
      `+${world.scoring.bonusPts - before.bonusPts}, litter dropped +${world.litter.litterSpawned - before.litterSpawned}, ` +
      `lead tangles +${(tangles[0] as number) - before.tangles}`,
  );
  // The window ran the work under test: a full store, spawns and retirements, stimuli delivered.
  expect(fullTicks).toBeGreaterThan(HEAP_MEASURED_TICKS / 2);
  expect(minCount).toBeGreaterThanOrEqual(NPC_CAPACITY - 8);
  expect(sp.ambientSpawned - before.spawned).toBeGreaterThan(10);
  expect(sp.ambientRetired - before.retired).toBeGreaterThan(10);
  expect(world.npcAi.stimuli.delivered - before.delivered).toBeGreaterThan(100);
  // With the registry's behaviours the harness puts people and leads in her path (and aims her at someone every
  // 10 s); the test walkers seldom meet her inside one window.
  if (generic) {
    // SSP-084: the litterbugs' drops (the town has no litter of its own, and the brush is up) have filled the
    // LitterField to its 2,000 cap during the pre-warm and no further (the window's drops are refused).
    expect(world.litter.count).toBe(world.litter.capacity);
    expect(world.litter.litterSpawned).toBe(world.litter.capacity);
  }
  if (generic) {
    expect(reactions.hits - before.hits).toBeGreaterThan(0);
    // SSP-084: the harness's horn caught some litterbugs (the town has no kerbs, so the only style bonus is
    // Caught!). In the Doris rig, the litterbug it puts beside Bessie as each spray ends.
    expect(world.scoring.bonusPts - before.bonusPts).toBeGreaterThan(0);
  }
  if (generic && !doris) {
    // SSP-086: the harness's dog walkers either side of her path tangle her in their leads.
    expect((tangles[0] as number) - before.tangles).toBeGreaterThan(0);
  }
  if (doris) expect(whacks).toBeGreaterThan(0);
  assertHeapDeltaWithinThresholds(delta);
}

describe('phase 7 heap-delta check with 80 NPCs (TECHNICAL_DESIGN §17, SSP-080)', () => {
  it('World.step allocates nothing per tick with the NPC store full and churning', {
    timeout: 120_000,
  }, () => {
    checkPhase7Heap('npcAlloc', false);
  });

  it('allocates nothing with the generic pedestrians walking, yielding, startling and falling (SSP-082) and the dog walkers roaming, tangling and dropping mess (SSP-086)', {
    timeout: 120_000,
  }, () => {
    checkPhase7Heap('npcAlloc (generic pedestrian)', true);
  });

  it('allocates nothing with Doris glaring, shaking her fist, chasing and whacking among them (SSP-083)', {
    timeout: 120_000,
  }, () => {
    checkPhase7Heap('npcAlloc (with Doris)', true, true);
  });
});
