// npc.shopper (SSP-084; ENTITY_CATALOG §6.1–§6.2, §3.4; GDD §20 Q11): the baseline yielder. Aware and slowing
// inside the 6 m awareness radius, a hop aside when Bessie's predicted path comes within rules.sidestepM (4 m),
// once per approach; frontage door to frontage door; an outfit swap 0–7 drawn from the npc stream at spawn; the
// shared hit (−250, 1 complaint).
import { describe, expect, it } from 'vitest';
import { countEvents, EV } from '../../../src/sim/eventQueue.ts';
import { PED } from '../../../src/sim/npc/behaviours/pedestrian.ts';
import { SHOPPER_SWAPS, shopperBehaviour } from '../../../src/sim/npc/behaviours/shopper.ts';
import { NPC_FLAG, npcHandle, resolveNpcHandle } from '../../../src/sim/npc/store.ts';
import { DEFAULT_ENTITIES } from '../../../src/sim/tuning.ts';
import type { World } from '../../../src/sim/world.ts';
import {
  addPerson,
  CENTRE,
  HALF_L,
  HALF_W,
  HUMAN_R,
  holdBessie,
  kindOf,
  neutral,
  pavementWorld,
  place,
  townWorld,
} from '../../support/pedestrianRig.ts';

const SIDESTEP_M = DEFAULT_ENTITIES.npcs['npc.shopper'].rules.sidestepM;

describe('npc.shopper sidestep (ENTITY_CATALOG §6.2, GDD §20 Q11)', () => {
  it('reads its 4 m from entities.json and is in the registry', () => {
    expect(SIDESTEP_M).toBe(4);
    const world = townWorld(84);
    expect(world.npcAi.behaviours[kindOf('npc.shopper')]).toBe(shopperBehaviour);
    expect(shopperBehaviour.jaywalks).toBe(false);
  });

  it('hops aside (Startle) on the tick his perception finds her predicted path within 4 m, and not before', () => {
    // Bessie drives north up the centre line at 4 m/s (her predicted path is 6 m long); the shopper stands on
    // that line 20 m ahead, held there until he reacts.
    const world = townWorld(84);
    const h = npcHandle(world.npc, addPerson(world, 'npc.shopper', CENTRE, CENTRE - 20));
    let reacted = -1;
    for (let t = 0; t < 300 && reacted < 0; t++) {
      place(world, h, CENTRE, CENTRE - 20);
      holdBessie(world, 4);
      world.step(neutral);
      const i = resolveNpcHandle(world.npc, h);
      const gap = world.npc.pathGapM[i] as number;
      const perceivedNow = world.npc.perceivedTick[i] === world.tick - 1;
      if (world.npc.state[i] === PED.Startle) {
        reacted = t;
        // The tick his query first saw the path within 4 m, coming his way, while she is still outside the 6 m
        // awareness radius: the predicted path, not her centre, sets it off.
        expect(perceivedNow).toBe(true);
        expect(gap).toBeLessThanOrEqual(SIDESTEP_M);
        expect(world.npc.pathEtaS[i] as number).toBeGreaterThan(0);
        expect(world.npc.seenDistM[i] as number).toBeGreaterThan(6);
        expect((world.npc.flags[i] as number) & NPC_FLAG.DODGED).toBe(NPC_FLAG.DODGED);
      } else {
        // Before then: no reaction at all while every query found the path farther than 4 m.
        if (gap >= 0) expect(gap).toBeGreaterThan(SIDESTEP_M);
        expect(world.npc.state[i]).not.toBe(PED.Yield);
      }
    }
    expect(reacted).toBeGreaterThan(0);
  });

  it('then gets out of her way: on a wide pavement she drives through where he stood and never touches him', () => {
    // The steering town's wide pavement (rows 5–9): Bessie drives east along row 7 (y 15) at 4 m/s from x 10;
    // the shopper stands on her line at x 45, pinned until he reacts, then free.
    const world = pavementWorld(84);
    const v = world.vehicle;
    v.xM = 10;
    v.yM = 15;
    v.headingRad = Math.PI / 2;
    v.prevXM = v.xM;
    v.prevYM = v.yM;
    v.prevHeadingRad = v.headingRad;
    const h = npcHandle(world.npc, addPerson(world, 'npc.shopper', 45, 15));
    let minClear = Number.POSITIVE_INFINITY;
    let reacted = false;
    for (let t = 0; t < 720 && v.xM < 60; t++) {
      if (!reacted) place(world, h, 45, 15);
      holdBessie(world, 4);
      world.step(neutral);
      const j = resolveNpcHandle(world.npc, h);
      if (world.npc.state[j] !== PED.Walk) reacted = true;
      const lateral = Math.abs((world.npc.y[j] as number) - v.yM);
      const along = Math.abs((world.npc.x[j] as number) - v.xM);
      if (along < HALF_L + HUMAN_R) minClear = Math.min(minClear, lateral - HALF_W - HUMAN_R);
    }
    expect(reacted).toBe(true);
    expect(world.staticResolver.log.count).toBe(0);
    expect(world.npcAi.reactions.hits).toBe(0);
    expect(world.npcAi.reactions.bumps).toBe(0);
    // She passed him (he is behind her now) with daylight between her side and him.
    const j = resolveNpcHandle(world.npc, h);
    expect(world.npc.x[j] as number).toBeLessThan(v.xM);
    expect(minClear).toBeGreaterThan(0);
  });

  it('within 4 m of her path he hops aside; at 4.5 m, still inside the 6 m awareness radius, he only yields', () => {
    function reaction(lateralM: number): number {
      const world = townWorld(84);
      // 2 m ahead of her centre and `lateralM` to her right of her path while she rolls north at 2 m/s.
      const h = npcHandle(world.npc, addPerson(world, 'npc.shopper', CENTRE + lateralM, CENTRE - 2));
      for (let t = 0; t < 4; t++) {
        place(world, h, CENTRE + lateralM, CENTRE - 2);
        // Keep her where she is (she only needs the velocity for the prediction).
        world.vehicle.xM = CENTRE;
        world.vehicle.yM = CENTRE;
        holdBessie(world, 2);
        world.step(neutral);
      }
      return world.npc.state[resolveNpcHandle(world.npc, h)] as number;
    }
    expect(reaction(3.5)).toBe(PED.Startle);
    expect(Math.hypot(4.5, 2)).toBeLessThan(6);
    expect(reaction(4.5)).toBe(PED.Yield);
  });

  it('hops aside once per approach: the latch clears only once her path is farther than 4 m again', () => {
    const world = townWorld(84);
    const h = npcHandle(world.npc, addPerson(world, 'npc.shopper', CENTRE + 3, CENTRE - 2));
    let startles = 0;
    let prev = -1;
    const run = (ticks: number, lateral: number): void => {
      for (let t = 0; t < ticks; t++) {
        place(world, h, CENTRE + lateral, CENTRE - 2);
        world.vehicle.xM = CENTRE;
        world.vehicle.yM = CENTRE;
        holdBessie(world, 2);
        world.step(neutral);
        const s = world.npc.state[resolveNpcHandle(world.npc, h)] as number;
        if (s === PED.Startle && prev !== PED.Startle) startles += 1;
        prev = s;
      }
    };
    run(120, 3);
    expect(startles).toBe(1);
    // Out to 5 m off her path (her path now misses him by more than 4 m: the latch clears), then back in.
    run(30, 5);
    expect((world.npc.flags[resolveNpcHandle(world.npc, h)] as number) & NPC_FLAG.DODGED).toBe(0);
    run(60, 3);
    expect(startles).toBe(2);
  });
});

describe('npc.shopper wandering and outfits (ENTITY_CATALOG §6.1–§6.2, ART_BIBLE §5.6)', () => {
  /**
   * A pavement street (the compiled steering town) of up to 20 ambient shoppers from the spawner, run `ticks`
   * ticks with Bessie parked on the road: each shopper's swap by handle, every goal node held, and the NPC-ticks
   * spent idling within 1 m of the goal.
   */
  function street(
    seed: number,
    ticks: number,
  ): {
    world: World;
    swaps: Map<number, number>;
    goals: number[];
    idleAtGoal: number;
    doorsIdledAt: Map<number, Set<number>>;
  } {
    const world = pavementWorld(seed, {
      population: [{ fromS: 0, toS: 1000, target: 20 }],
      mix: [{ id: 'npc.shopper', weight: 1 }],
    });
    const swaps = new Map<number, number>();
    const goals: number[] = [];
    let idleAtGoal = 0;
    const doorsIdledAt = new Map<number, Set<number>>();
    const nav = world.level.nav;
    for (let t = 0; t < ticks; t++) {
      holdBessie(world, 0);
      world.step(neutral);
      const npc = world.npc;
      for (let i = 0; i < npc.count; i++) {
        swaps.set(npcHandle(npc, i), npc.swap[i] as number);
        const g = npc.goalNode[i] as number;
        if (g < 0) continue;
        goals.push(g);
        const d = Math.hypot(
          (npc.x[i] as number) - (nav.nodeX[g] as number),
          (npc.y[i] as number) - (nav.nodeY[g] as number),
        );
        if (npc.state[i] === PED.Idle && d < 1) {
          idleAtGoal += 1;
          const seen = doorsIdledAt.get(npcHandle(npc, i)) ?? new Set<number>();
          seen.add(g);
          doorsIdledAt.set(npcHandle(npc, i), seen);
        }
      }
    }
    return { world, swaps, goals, idleAtGoal, doorsIdledAt };
  }

  it('draws an outfit swap index 0–7 per shopper from the npc stream, identical across reruns of a seed', () => {
    const a = street(31, 1800);
    expect(a.swaps.size).toBeGreaterThanOrEqual(15);
    const values = [...a.swaps.values()];
    for (const v of values) {
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(SHOPPER_SWAPS);
    }
    expect(SHOPPER_SWAPS).toBe(8);
    // Not all one outfit.
    expect(new Set(values).size).toBeGreaterThan(3);
    // A swap never changes after spawn, and the same seed gives every shopper the same outfit.
    const b = street(31, 1800);
    expect([...b.swaps.entries()]).toEqual([...a.swaps.entries()]);
    expect(Array.from(b.world.npc.swap)).toEqual(Array.from(a.world.npc.swap));
  });

  it('wanders from frontage door to frontage door (the shop windows), idling at each', () => {
    const { world, goals, idleAtGoal, doorsIdledAt } = street(32, 3600);
    const doors = new Set(world.level.nav.doors.map((d) => d.node));
    expect(doors.size).toBeGreaterThan(0);
    expect(goals.length).toBeGreaterThan(0);
    for (const g of goals) expect(doors.has(g), `goal node ${g}`).toBe(true);
    // They reach their doors and idle there, then walk on to another: someone idled at two or more doors.
    expect(idleAtGoal).toBeGreaterThan(0);
    expect(Math.max(...[...doorsIdledAt.values()].map((d) => d.size))).toBeGreaterThanOrEqual(2);
  });
});

describe('npc.shopper hit (ENTITY_CATALOG §6.1)', () => {
  it('a hit costs −250 and 1 complaint, through the penalty pipeline', () => {
    const world = townWorld(84);
    const hit = DEFAULT_ENTITIES.npcs['npc.shopper'].hit;
    expect(hit?.pts).toBe(-250);
    expect(hit?.complaints).toBe(1);
    const i = addPerson(world, 'npc.shopper', CENTRE, CENTRE - HALF_L - HUMAN_R + 0.02);
    holdBessie(world, 2);
    world.step(neutral);
    expect(countEvents(world.events, EV.NpcHit)).toBe(1);
    expect(world.scoring.penaltyPts).toBe(-250);
    expect(world.complaints.count).toBe(1);
    expect(countEvents(world.events, EV.Complaint)).toBe(1);
    expect(world.npc.state[i]).toBe(PED.Fallen);
  });
});
