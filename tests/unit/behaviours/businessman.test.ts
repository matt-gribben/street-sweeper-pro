// npc.businessman (SSP-084; ENTITY_CATALOG §6.1–§6.2, §3.4): on his phone, he ignores the awareness radius and the
// LED beacon, notices Bessie only when her body is within rules.noticeM (2 m) and startles, reacts to the horn,
// yields under hi-vis, jaywalks, and a hit costs the shared −250 and 1 complaint.
import { describe, expect, it } from 'vitest';
import { countEvents, EV } from '../../../src/sim/eventQueue.ts';
import { businessmanBehaviour, gapToBessieM } from '../../../src/sim/npc/behaviours/businessman.ts';
import { PED, STARTLE_TICKS } from '../../../src/sim/npc/behaviours/pedestrian.ts';
import { setLedBeacon, startHiVis } from '../../../src/sim/npc/reactions.ts';
import { NPC_FLAG, npcHandle, resolveNpcHandle } from '../../../src/sim/npc/store.ts';
import { DEFAULT_ENTITIES } from '../../../src/sim/tuning.ts';
import {
  addPerson,
  CENTRE,
  HALF_L,
  HALF_W,
  HUMAN_R,
  holdBessie,
  honk,
  kindOf,
  neutral,
  place,
  townWorld,
} from '../../support/pedestrianRig.ts';

const NOTICE_M = DEFAULT_ENTITIES.npcs['npc.businessman'].rules.noticeM;

describe('npc.businessman (ENTITY_CATALOG §6.2)', () => {
  it('reads its 2 m from entities.json, never yields by type, jaywalks and is in the registry', () => {
    expect(NOTICE_M).toBe(2);
    expect(DEFAULT_ENTITIES.npcs['npc.businessman'].yields).toBe(false);
    expect(businessmanBehaviour.jaywalks).toBe(true);
    expect(townWorld(84).npcAi.behaviours[kindOf('npc.businessman')]).toBe(businessmanBehaviour);
  });

  it('measures the gap to her body outline', () => {
    const world = townWorld(84);
    const i = addPerson(world, 'npc.businessman', CENTRE + HALF_W + 2, CENTRE);
    expect(gapToBessieM(world, i)).toBeCloseTo(2, 12);
    world.npc.x[i] = CENTRE;
    world.npc.y[i] = CENTRE - HALF_L - 1.5;
    expect(gapToBessieM(world, i)).toBeCloseTo(1.5, 12);
    world.npc.x[i] = CENTRE + HALF_W + 3;
    world.npc.y[i] = CENTRE - HALF_L - 4;
    expect(gapToBessieM(world, i)).toBeCloseTo(5, 12);
    world.npc.x[i] = CENTRE + 0.2;
    world.npc.y[i] = CENTRE + 0.5;
    expect(gapToBessieM(world, i)).toBe(0);
  });

  it('shows no Aware or Yield reaction 5 m away, even with the 10 m LED beacon (a shopper there yields)', () => {
    const world = townWorld(84);
    setLedBeacon(world.npcAi.reactions, world.tuning, true);
    expect(world.npcAi.reactions.awarenessRadiusM).toBe(10);
    const biz = npcHandle(world.npc, addPerson(world, 'npc.businessman', CENTRE + 5, CENTRE));
    const shopper = npcHandle(world.npc, addPerson(world, 'npc.shopper', CENTRE - 5, CENTRE));
    for (let t = 0; t < 120; t++) {
      place(world, biz, CENTRE + 5, CENTRE);
      place(world, shopper, CENTRE - 5, CENTRE);
      holdBessie(world, 0);
      world.step(neutral);
      const j = resolveNpcHandle(world.npc, biz);
      const f = world.npc.flags[j] as number;
      expect(f & NPC_FLAG.AWARE).toBe(0);
      expect(f & NPC_FLAG.YIELDING).toBe(0);
      expect(world.npc.state[j]).toBe(PED.Walk);
    }
    expect(world.npc.state[resolveNpcHandle(world.npc, shopper)]).toBe(PED.Yield);
  });

  it('startles once her body is within 2 m (2.0 m startles, 2.05 m does not), once per approach', () => {
    function stateAt(gapM: number, ticks: number): { state: number; startles: number } {
      const world = townWorld(84);
      const h = npcHandle(world.npc, addPerson(world, 'npc.businessman', CENTRE + HALF_W + gapM, CENTRE));
      let startles = 0;
      let prev = -1;
      for (let t = 0; t < ticks; t++) {
        place(world, h, CENTRE + HALF_W + gapM, CENTRE);
        holdBessie(world, 0);
        world.step(neutral);
        const s = world.npc.state[resolveNpcHandle(world.npc, h)] as number;
        if (s === PED.Startle && prev !== PED.Startle) startles += 1;
        prev = s;
      }
      return { state: prev, startles };
    }
    expect(stateAt(2, 1)).toEqual({ state: PED.Startle, startles: 1 });
    expect(stateAt(1.2, 1)).toEqual({ state: PED.Startle, startles: 1 });
    expect(stateAt(2.05, 60).startles).toBe(0);
    // Held at 1.5 m for three startles' worth of ticks: one startle, not one after another.
    expect(stateAt(1.5, STARTLE_TICKS * 3).startles).toBe(1);
  });

  it('startles again on a new approach: the latch clears once she is farther than 2 m', () => {
    const world = townWorld(84);
    const h = npcHandle(world.npc, addPerson(world, 'npc.businessman', CENTRE + HALF_W + 1, CENTRE));
    let startles = 0;
    let prev = -1;
    const run = (ticks: number, gap: number): void => {
      for (let t = 0; t < ticks; t++) {
        place(world, h, CENTRE + HALF_W + gap, CENTRE);
        holdBessie(world, 0);
        world.step(neutral);
        const s = world.npc.state[resolveNpcHandle(world.npc, h)] as number;
        if (s === PED.Startle && prev !== PED.Startle) startles += 1;
        prev = s;
      }
    };
    run(40, 1);
    run(5, 3);
    expect((world.npc.flags[resolveNpcHandle(world.npc, h)] as number) & NPC_FLAG.DODGED).toBe(0);
    run(40, 1);
    expect(startles).toBe(2);
  });

  it('startles on a horn 7 m away (he reacts to the horn, not to the awareness radius)', () => {
    const world = townWorld(84);
    const h = npcHandle(world.npc, addPerson(world, 'npc.businessman', CENTRE + 7, CENTRE));
    for (let t = 0; t < 10; t++) {
      place(world, h, CENTRE + 7, CENTRE);
      world.step(neutral);
    }
    expect(world.npc.state[resolveNpcHandle(world.npc, h)]).toBe(PED.Walk);
    place(world, h, CENTRE + 7, CENTRE);
    world.step(honk());
    expect(countEvents(world.events, EV.Horn)).toBe(1);
    expect(world.npc.state[resolveNpcHandle(world.npc, h)]).toBe(PED.Startle);
  });

  it('yields and parts under hi-vis', () => {
    const world = townWorld(84);
    const h = npcHandle(world.npc, addPerson(world, 'npc.businessman', CENTRE + 5, CENTRE));
    startHiVis(world);
    place(world, h, CENTRE + 5, CENTRE);
    world.step(neutral);
    const j = resolveNpcHandle(world.npc, h);
    expect(world.npc.state[j]).toBe(PED.Yield);
    expect((world.npc.flags[j] as number) & NPC_FLAG.HI_VIS).toBe(NPC_FLAG.HI_VIS);
    expect((world.npc.flags[j] as number) & NPC_FLAG.YIELDING).toBe(NPC_FLAG.YIELDING);
    expect((world.npc.flags[j] as number) & NPC_FLAG.AWARE).toBe(0);
  });

  it('a hit costs −250 and 1 complaint, through the penalty pipeline', () => {
    const world = townWorld(84);
    const hit = DEFAULT_ENTITIES.npcs['npc.businessman'].hit;
    expect(hit?.pts).toBe(-250);
    expect(hit?.complaints).toBe(1);
    const i = addPerson(world, 'npc.businessman', CENTRE, CENTRE - HALF_L - HUMAN_R + 0.02);
    holdBessie(world, 2);
    world.step(neutral);
    expect(countEvents(world.events, EV.NpcHit)).toBe(1);
    expect(world.scoring.penaltyPts).toBe(-250);
    expect(world.complaints.count).toBe(1);
    expect(world.npc.state[i]).toBe(PED.Fallen);
  });
});
