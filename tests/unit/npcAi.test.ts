// Phase 7's machinery (SSP-080, TECHNICAL_DESIGN §11.1): the behaviour registry and its no-op default, the
// behaviour pass and state clock, staggered perception, and stimulus delivery by handle, by radius and to
// everyone.
import { describe, expect, it } from 'vitest';
import { NPC_BEHAVIOURS, NPC_IDS } from '../../src/sim/entities.ts';
import { createInputFrame } from '../../src/sim/inputFrame.ts';
import { createBlankLevel } from '../../src/sim/map.ts';
import { type Behaviour, Stimulus } from '../../src/sim/npc/behaviour.ts';
import { businessmanBehaviour } from '../../src/sim/npc/behaviours/businessman.ts';
import { litterbugBehaviour } from '../../src/sim/npc/behaviours/litterbug.ts';
import { NOOP, noopBehaviour, noopJaywalkBehaviour } from '../../src/sim/npc/behaviours/noop.ts';
import { oldWomanBehaviour } from '../../src/sim/npc/behaviours/oldWoman.ts';
import {
  pedestrianBehaviour,
  stationaryPedestrianBehaviour,
} from '../../src/sim/npc/behaviours/pedestrian.ts';
import { shopperBehaviour } from '../../src/sim/npc/behaviours/shopper.ts';
import { PERCEPTION_EVERY_TICKS, PERCEPTION_PATH_S } from '../../src/sim/npc/perception.ts';
import { BEHAVIOUR_REGISTRY, behavioursByKind } from '../../src/sim/npc/registry.ts';
import { pushStimulus, STIMULUS_CAPACITY, STIMULUS_EVERYONE } from '../../src/sim/npc/stimuli.ts';
import {
  addNpcAt,
  NO_NPC_HANDLE,
  NpcOrigin,
  npcHandle,
  removeNpc,
  setNpcState,
} from '../../src/sim/npc/store.ts';
import { DEFAULT_ENTITIES, DEFAULT_TUNING } from '../../src/sim/tuning.ts';
import { createWorld, type World } from '../../src/sim/world.ts';

/** An open 100 × 100 m World with no NPC spec (the spawner is idle), Bessie at (50, 50) facing north. */
function openWorld(): World {
  const level = createBlankLevel('test.npc_ai', 50, 50);
  level.player = { x: 50, y: 50, heading: 0 };
  return createWorld(level, 4, DEFAULT_TUNING);
}

const neutral = createInputFrame();

describe('behaviour registry', () => {
  it('maps every entities.json behaviour key to a module: its own, or the generic pedestrian or the no-op until it lands', () => {
    expect(Object.keys(BEHAVIOUR_REGISTRY).sort()).toEqual([...NPC_BEHAVIOURS].sort());
    // SSP-083: Doris has her own module; SSP-084: so do the shopper, the businessman (an M3 jaywalker) and the
    // litterbug. SSP-082: every other person kind gets the generic pedestrian (the market trader the stationary
    // one); the animals keep the no-op (SSP-081: the cat jaywalks).
    const expected: { readonly [K in (typeof NPC_BEHAVIOURS)[number]]: Behaviour } = {
      shopper: shopperBehaviour,
      old_woman: oldWomanBehaviour,
      old_man_frame: pedestrianBehaviour,
      dog_walker: pedestrianBehaviour,
      litterbug: litterbugBehaviour,
      businessman: businessmanBehaviour,
      mum_pushchair: pedestrianBehaviour,
      postie: pedestrianBehaviour,
      market_trader: stationaryPedestrianBehaviour,
      cat: noopJaywalkBehaviour,
      pigeon: noopBehaviour,
    };
    const jaywalkers: readonly string[] = ['cat', 'businessman'];
    for (const key of NPC_BEHAVIOURS) {
      expect(BEHAVIOUR_REGISTRY[key], key).toBe(expected[key]);
      expect(BEHAVIOUR_REGISTRY[key].jaywalks, key).toBe(jaywalkers.includes(key));
    }
    const byKind = behavioursByKind(DEFAULT_ENTITIES);
    expect(byKind).toHaveLength(NPC_IDS.length);
    const custom = { ...BEHAVIOUR_REGISTRY, cat: { ...noopBehaviour, initial: 3 } };
    const withCat = behavioursByKind(DEFAULT_ENTITIES, custom);
    expect(withCat[NPC_IDS.indexOf('npc.cat')]?.initial).toBe(3);
    expect(withCat[NPC_IDS.indexOf('npc.shopper')]).toBe(shopperBehaviour);
  });

  it('the no-op behaviour leaves an NPC where it is, in Idle, whatever it is told', () => {
    const world = openWorld();
    world.npcAi.behaviours.fill(noopBehaviour);
    const i = addNpcAt(world.npc, 0, NpcOrigin.Ambient, 40, 40);
    const k = pushStimulus(world.npcAi.stimuli, Stimulus.Horn, NO_NPC_HANDLE);
    world.npcAi.stimuli.radiusM[k] = STIMULUS_EVERYONE;
    for (let t = 0; t < 10; t++) world.step(neutral);
    expect([world.npc.x[i], world.npc.y[i], world.npc.state[i]]).toEqual([40, 40, NOOP.Idle]);
    expect(world.npc.stateTicks[i]).toBe(10);
  });
});

describe('behaviour pass', () => {
  it('ticks every live NPC once per tick in index order and counts its state clock from the change', () => {
    const world = openWorld();
    const order: number[] = [];
    const recorder: Behaviour = {
      initial: 0,
      jaywalks: false,
      tick(w, i) {
        order.push(i);
        if (w.tick === 5 && i === 1) setNpcState(w.npc, i, 2);
      },
      onStimulus() {},
    };
    world.npcAi.behaviours.fill(recorder);
    for (let k = 0; k < 3; k++) addNpcAt(world.npc, k, NpcOrigin.Ambient, 10 + k, 10);
    for (let t = 0; t < 8; t++) world.step(neutral);
    expect(order).toEqual(Array.from({ length: 24 }, (_, n) => n % 3));
    expect([...world.npc.stateTicks.subarray(0, 3)]).toEqual([8, 3, 8]); // NPC 1 changed state on tick 5
    expect(world.npc.state[1]).toBe(2);
  });
});

describe('perception', () => {
  it('runs for NPC i only on ticks where tick mod 4 == i mod 4', () => {
    const world = openWorld();
    for (let k = 0; k < 11; k++) addNpcAt(world.npc, 0, NpcOrigin.Ambient, 5 + k * 3, 20);
    const npc = world.npc;
    for (let t = 0; t < 40; t++) {
      const before = Int32Array.from(npc.perceivedTick.subarray(0, npc.count));
      world.step(neutral);
      for (let i = 0; i < npc.count; i++) {
        if (i % PERCEPTION_EVERY_TICKS === t % PERCEPTION_EVERY_TICKS) expect(npc.perceivedTick[i]).toBe(t);
        else expect(npc.perceivedTick[i], `npc ${i} tick ${t}`).toBe(before[i]);
      }
    }
    expect(PERCEPTION_EVERY_TICKS).toBe(4);
  });

  it('measures the distance to Bessie and to her path predicted 1.5 s ahead', () => {
    const world = openWorld();
    const v = world.vehicle;
    v.vLongMps = 4; // north at 4 m/s: the path runs from (50, 50) to (50, 44) over 1.5 s
    const npc = world.npc;
    addNpcAt(npc, 0, NpcOrigin.Ambient, 53, 46); // beside the path, 4 m ahead → closest at (50, 46), 1.0 s
    addNpcAt(npc, 0, NpcOrigin.Ambient, 50, 40); // beyond its end → closest at the end, 1.5 s
    addNpcAt(npc, 0, NpcOrigin.Ambient, 46, 53); // behind her → closest at her centre, 0 s
    addNpcAt(npc, 0, NpcOrigin.Ambient, 50, 47); // on the path, 3 m ahead
    // Each tick restarts her from that pose; phase 2 moves her a few centimetres before phase 7 looks.
    for (let t = 0; t < 4; t++) {
      v.xM = 50;
      v.yM = 50;
      v.headingRad = 0;
      v.vLongMps = 4;
      v.vLatMps = 0;
      world.npc.perceivedTick.fill(-1);
      world.step(neutral);
      // Phase 2 moved her: re-run the expected maths on the pose phase 7 saw.
      const bx = v.xM;
      const by = v.yM;
      const dx = Math.sin(v.headingRad) * v.vLongMps * PERCEPTION_PATH_S;
      const dy = -Math.cos(v.headingRad) * v.vLongMps * PERCEPTION_PATH_S;
      for (let i = t; i < npc.count; i += 4) {
        const px = (npc.x[i] as number) - bx;
        const py = (npc.y[i] as number) - by;
        const s = Math.min(1, Math.max(0, (px * dx + py * dy) / (dx * dx + dy * dy)));
        expect(npc.seenDistM[i]).toBeCloseTo(Math.hypot(px, py), 9);
        expect(npc.pathGapM[i]).toBeCloseTo(Math.hypot(px - s * dx, py - s * dy), 9);
        expect(npc.pathEtaS[i]).toBeCloseTo(s * PERCEPTION_PATH_S, 9);
      }
    }
    // Rounded to the scenario's geometry (Bessie moved only centimetres in phase 2).
    expect(npc.pathGapM[0]).toBeCloseTo(3, 1);
    expect(npc.pathEtaS[0]).toBeCloseTo(1.0, 1);
    expect(npc.pathEtaS[1]).toBe(PERCEPTION_PATH_S);
    expect(npc.pathGapM[1]).toBeCloseTo(4, 0);
    expect(npc.pathEtaS[2]).toBe(0);
    expect(npc.pathGapM[2]).toBeCloseTo(5, 1);
    expect(npc.pathGapM[3]).toBeCloseTo(0, 6);
  });

  it('with Bessie at rest, the path is her centre: gap = distance, ETA 0', () => {
    const world = openWorld();
    const i = addNpcAt(world.npc, 0, NpcOrigin.Ambient, 56, 58);
    world.step(neutral);
    expect(world.npc.seenDistM[i]).toBe(10);
    expect(world.npc.pathGapM[i]).toBe(10);
    expect(world.npc.pathEtaS[i]).toBe(0);
  });
});

describe('stimuli', () => {
  /** A World whose behaviours log every delivery as "npc:type:slot". */
  function logging(): { world: World; log: string[] } {
    const world = openWorld();
    const log: string[] = [];
    world.npcAi.behaviours.fill({
      initial: 0,
      jaywalks: false,
      tick() {},
      onStimulus(w, i, s, slot) {
        log.push(`${w.npc.x[i]}:${s}:${slot}`);
      },
    });
    return { world, log };
  }

  it('delivers by handle, by radius and to everyone, in push order, in phase 7, then empties the queue', () => {
    const { world, log } = logging();
    const npc = world.npc;
    for (const x of [10, 20, 30, 40]) addNpcAt(npc, 0, NpcOrigin.Ambient, x, 50);
    const q = world.npcAi.stimuli;
    pushStimulus(q, Stimulus.Hit, npcHandle(npc, 2));
    const horn = pushStimulus(q, Stimulus.Horn, NO_NPC_HANDLE);
    q.x[horn] = 15;
    q.y[horn] = 50;
    q.radiusM[horn] = 5; // reaches x = 10 and 20, edges included
    pushStimulus(q, Stimulus.HiVis, NO_NPC_HANDLE); // radius STIMULUS_EVERYONE by default
    expect(log).toEqual([]); // pushed, not yet delivered
    world.step(neutral);
    expect(log).toEqual(['30:3:0', '10:1:1', '20:1:1', '10:5:2', '20:5:2', '30:5:2', '40:5:2']);
    expect(q.count).toBe(0);
    expect(q.delivered).toBe(7);
    world.step(neutral);
    expect(log).toHaveLength(7);
  });

  it('drops a stimulus aimed at an NPC that has since been removed', () => {
    const { world, log } = logging();
    const npc = world.npc;
    addNpcAt(npc, 0, NpcOrigin.Ambient, 10, 50);
    addNpcAt(npc, 0, NpcOrigin.Ambient, 20, 50);
    const h = npcHandle(npc, 0);
    pushStimulus(world.npcAi.stimuli, Stimulus.Spray, h);
    removeNpc(npc, 0); // NPC 1 moves into index 0
    world.step(neutral);
    expect(log).toEqual([]);
  });

  it('throws when a tick pushes more than the queue holds', () => {
    const world = openWorld();
    const q = world.npcAi.stimuli;
    for (let k = 0; k < STIMULUS_CAPACITY; k++) pushStimulus(q, Stimulus.NearMiss, NO_NPC_HANDLE);
    expect(() => pushStimulus(q, Stimulus.NearMiss, NO_NPC_HANDLE)).toThrow(/holds 256 stimuli/);
  });
});
