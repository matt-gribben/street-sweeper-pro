// npc.litterbug (SSP-084; ENTITY_CATALOG §6.1–§6.2, GDD §10.3, LEVEL_DESIGN §9.1 rule 7): drops one item of the
// district's small-litter table every 180–300 ticks (counted in litter spawned, within the 2,000 cap); a honk within
// 6 m is Caught! (+100 once, a style bonus: unmultiplied, the chain untouched, the honk not counted toward horn
// spam), after which he slinks off the map and drops nothing more; a honk 6.1 m away only startles him.
import { describe, expect, it } from 'vitest';
import { addComboPickup } from '../../../src/sim/combo.ts';
import { LITTER_IDS } from '../../../src/sim/entities.ts';
import { countEvents, EV } from '../../../src/sim/eventQueue.ts';
import { addLitter } from '../../../src/sim/litter.ts';
import { Stimulus } from '../../../src/sim/npc/behaviour.ts';
import { DROP_BEHIND_M, LITTERBUG, litterbugBehaviour } from '../../../src/sim/npc/behaviours/litterbug.ts';
import {
  ANGRY_TICKS,
  FALLEN_TICKS,
  GET_UP_TICKS,
  PED,
  STARTLE_TICKS,
} from '../../../src/sim/npc/behaviours/pedestrian.ts';
import { pushStimulus } from '../../../src/sim/npc/stimuli.ts';
import { NPC_FLAG, npcHandle, resolveNpcHandle } from '../../../src/sim/npc/store.ts';
import { DEFAULT_ENTITIES } from '../../../src/sim/tuning.ts';
import type { World } from '../../../src/sim/world.ts';
import {
  addPerson,
  CENTRE,
  HALF_L,
  HUMAN_R,
  holdBessie,
  honk,
  kindOf,
  neutral,
  pavementWorld,
  place,
  townWorld,
} from '../../support/pedestrianRig.ts';

const RULES = DEFAULT_ENTITIES.npcs['npc.litterbug'].rules;
/** A district table with small litter and the kinds a litterbug must never drop. */
const TABLE = [
  { id: 'litter.crisp_packet', weight: 30 },
  { id: 'litter.drink_can', weight: 15 },
  { id: 'litter.cigarette_butts', weight: 20 },
  { id: 'litter.dog_mess', weight: 8 },
  { id: 'litter.leaf_pile', weight: 8 },
  { id: 'litter.bin_bag', weight: 5 },
];
const SMALL = new Set(['litter.crisp_packet', 'litter.drink_can', 'litter.cigarette_butts']);

/** A town with the table above, Bessie parked at its centre. */
function litterTown(seed = 84): World {
  return townWorld(seed, { litterTable: TABLE });
}

/** Step `world` once with Bessie parked, pinning NPC `h` at (x, y) first when given. */
function stepParked(world: World, h = -1, x = 0, y = 0, input = neutral): void {
  if (h >= 0) place(world, h, x, y);
  holdBessie(world, 0);
  world.step(input);
}

describe('npc.litterbug drops (ENTITY_CATALOG §6.2, LEVEL_DESIGN §9.1 rule 7)', () => {
  it('reads its rules from entities.json and is in the registry', () => {
    expect(RULES).toEqual({ dropEveryMinS: 3, dropEveryMaxS: 5, caughtRadiusM: 6, caughtPts: 100 });
    expect(litterTown().npcAi.behaviours[kindOf('npc.litterbug')]).toBe(litterbugBehaviour);
  });

  it('drops one item every 180–300 ticks, from the small-litter table, counted in litter spawned', () => {
    const world = litterTown();
    // Bessie in a far corner, out of everyone's way.
    world.vehicle.xM = 6;
    world.vehicle.yM = 6;
    const h = npcHandle(world.npc, addPerson(world, 'npc.litterbug', 30, 30));
    const armed = world.npc.timerA[resolveNpcHandle(world.npc, h)] as number;
    expect(armed).toBeGreaterThanOrEqual(180);
    expect(armed).toBeLessThanOrEqual(300);
    const dropTicks: number[] = [];
    const kinds = new Set<string>();
    for (let t = 0; t < 6000; t++) {
      const before = world.litter.litterSpawned;
      holdBessie(world, 0);
      world.step(neutral);
      const added = world.litter.litterSpawned - before;
      expect(added).toBeLessThanOrEqual(1);
      if (added === 1) {
        dropTicks.push(world.tick);
        const k = world.litter.count - 1;
        kinds.add(LITTER_IDS[world.litter.kind[k] as number] as string);
        // At his heels: DROP_BEHIND_M behind his centre (he has moved at most one tick's walk since).
        const i = resolveNpcHandle(world.npc, h);
        const d = Math.hypot(
          (world.litter.x[k] as number) - (world.npc.x[i] as number),
          (world.litter.y[k] as number) - (world.npc.y[i] as number),
        );
        expect(d).toBeLessThanOrEqual(DROP_BEHIND_M + 0.1);
      }
    }
    // The first drop within 300 ticks, then every 180–300 ticks.
    expect(dropTicks[0] as number).toBeLessThanOrEqual(300);
    const gaps = dropTicks.slice(1).map((t, k) => t - (dropTicks[k] as number));
    expect(gaps.length).toBeGreaterThanOrEqual(18);
    for (const g of gaps) {
      expect(g).toBeGreaterThanOrEqual(180);
      expect(g).toBeLessThanOrEqual(300);
    }
    // The intervals are drawn, not fixed.
    expect(new Set(gaps).size).toBeGreaterThan(5);
    // Every drop is one item of litter spawned (Tidy %'s denominator), of the small-litter kinds only.
    expect(world.litter.litterSpawned).toBe(dropTicks.length);
    expect(world.litter.count).toBe(dropTicks.length);
    for (const k of kinds) expect(SMALL.has(k), k).toBe(true);
    expect(kinds.size).toBeGreaterThan(1);
  });

  it('respects the live-litter cap: with the field full a drop adds nothing', () => {
    const world = litterTown();
    world.vehicle.xM = 6;
    world.vehicle.yM = 6;
    const h = npcHandle(world.npc, addPerson(world, 'npc.litterbug', 30, 30));
    const lf = world.litter;
    for (let k = 0; lf.count < lf.capacity; k++)
      addLitter(lf, 0, 60 + (k % 40) * 0.5, 60 + Math.floor(k / 40) * 0.5, 0);
    const spawned = lf.litterSpawned;
    expect(lf.count).toBe(lf.capacity);
    for (let t = 0; t < 400; t++) {
      holdBessie(world, 0);
      world.step(neutral);
    }
    // He had his drop (the timer re-armed), but the full field took nothing.
    expect(resolveNpcHandle(world.npc, h)).toBeGreaterThanOrEqual(0);
    expect(lf.count).toBe(lf.capacity);
    expect(lf.litterSpawned).toBe(spawned);
  });
});

describe('npc.litterbug Caught! (GDD §10.3, ENTITY_CATALOG §3.3, §6.2)', () => {
  it('a honk 5.9 m away awards exactly +100 once, he slinks off, stops dropping, and the honk is not horn spam', () => {
    const world = litterTown();
    const i0 = addPerson(world, 'npc.litterbug', CENTRE + 5.9, CENTRE);
    const h = npcHandle(world.npc, i0);
    stepParked(world, h, CENTRE + 5.9, CENTRE, honk());
    const i = resolveNpcHandle(world.npc, h);
    // EV.Caught in phase 7, the bonus in phase 9 of the same tick.
    expect(countEvents(world.events, EV.Caught)).toBe(1);
    const e = world.events;
    let ev = -1;
    for (let k = 0; k < e.count; k++) if (e.type[k] === EV.Caught) ev = k;
    expect(e.entity[ev]).toBe(i);
    expect(e.c[ev]).toBe(100);
    expect([e.a[ev], e.b[ev]]).toEqual([CENTRE + 5.9, CENTRE]);
    expect(world.scoring.bonusPts).toBe(100);
    expect(world.scoring.score).toBe(100);
    expect((world.npc.flags[i] as number) & NPC_FLAG.LEAVING).toBe(NPC_FLAG.LEAVING);
    // The honk startles him; it is flagged Caught! and kept out of the horn-spam window.
    expect(world.npc.state[i]).toBe(PED.Startle);
    expect(world.complaints.honks).toBe(1);
    expect(world.complaints.honksCaught).toBe(1);
    expect(world.complaints.honkCount).toBe(0);
    // The startle runs its 30 ticks, then he slinks.
    for (let t = 1; t < STARTLE_TICKS; t++) {
      stepParked(world);
      expect(world.npc.state[resolveNpcHandle(world.npc, h)]).toBe(PED.Startle);
    }
    stepParked(world);
    expect(world.npc.state[resolveNpcHandle(world.npc, h)]).toBe(LITTERBUG.Slink);
    // More honks at him: no second Caught!. And he never drops again.
    const spawned = world.litter.litterSpawned;
    let caught = 0;
    for (let t = 0; t < 600 && resolveNpcHandle(world.npc, h) >= 0; t++) {
      stepParked(world, -1, 0, 0, t % 100 === 0 ? honk() : neutral);
      caught += countEvents(world.events, EV.Caught);
      const j = resolveNpcHandle(world.npc, h);
      if (j >= 0) expect(world.npc.state[j]).toBe(LITTERBUG.Slink);
    }
    expect(caught).toBe(0);
    expect(world.scoring.bonusPts).toBe(100);
    expect(world.litter.litterSpawned).toBe(spawned);
    expect(world.complaints.honksCaught).toBe(1);
  });

  it('the Caught! honk does not count toward horn spam: 4 honks in 5 s with one catching him are no Noise complaint', () => {
    function honkFour(withLitterbug: boolean): { complaints: number; honkCount: number } {
      const world = litterTown();
      const h = withLitterbug
        ? npcHandle(world.npc, addPerson(world, 'npc.litterbug', CENTRE + 4, CENTRE))
        : -1;
      for (let t = 0; t < 40; t++) {
        stepParked(world, t === 0 ? h : -1, CENTRE + 4, CENTRE, t % 10 === 0 ? honk() : neutral);
      }
      expect(world.complaints.honks).toBe(4);
      return { complaints: world.complaints.count, honkCount: world.complaints.honkCount };
    }
    expect(honkFour(false)).toEqual({ complaints: 1, honkCount: 0 });
    expect(honkFour(true)).toEqual({ complaints: 0, honkCount: 3 });
  });

  it('a honk 6.1 m away awards no Caught!: he startles (inside the 8 m horn) and keeps dropping', () => {
    const world = litterTown();
    const h = npcHandle(world.npc, addPerson(world, 'npc.litterbug', CENTRE + 6.1, CENTRE));
    stepParked(world, h, CENTRE + 6.1, CENTRE, honk());
    const i = resolveNpcHandle(world.npc, h);
    expect(countEvents(world.events, EV.Caught)).toBe(0);
    expect(world.scoring.bonusPts).toBe(0);
    expect(world.npc.state[i]).toBe(PED.Startle);
    expect((world.npc.flags[i] as number) & NPC_FLAG.LEAVING).toBe(0);
    expect(world.complaints.honksCaught).toBe(0);
    expect(world.complaints.honkCount).toBe(1);
    // He keeps dropping: two more items within the next 600 ticks.
    const spawned = world.litter.litterSpawned;
    for (let t = 0; t < 600; t++) stepParked(world);
    expect(world.litter.litterSpawned - spawned).toBeGreaterThanOrEqual(2);
    expect(world.npc.state[resolveNpcHandle(world.npc, h)]).not.toBe(LITTERBUG.Slink);
  });

  it('the edge counts: a honk exactly 6 m away catches him', () => {
    const world = litterTown();
    const h = npcHandle(world.npc, addPerson(world, 'npc.litterbug', CENTRE + 6, CENTRE));
    stepParked(world, h, CENTRE + 6, CENTRE, honk());
    expect(countEvents(world.events, EV.Caught)).toBe(1);
  });

  it('Caught! points are not multiplied by the combo and do not change the chain', () => {
    const world = litterTown();
    const combo = world.scoring.combo;
    world.events.sealed = false;
    for (let k = 0; k < 12; k++) addComboPickup(combo, world.events);
    expect(combo.chain).toBe(12);
    expect(combo.multiplier).toBe(2);
    expect(combo.timerTicks).toBe(combo.refreshTicks);
    const scoreBefore = world.scoring.score;
    const h = npcHandle(world.npc, addPerson(world, 'npc.litterbug', CENTRE - 3, CENTRE + 2));
    stepParked(world, h, CENTRE - 3, CENTRE + 2, honk());
    expect(countEvents(world.events, EV.Caught)).toBe(1);
    // +100, not 100 × 2; the chain still 12 at ×2, its timer only counted down (not refreshed).
    expect(world.scoring.score - scoreBefore).toBe(100);
    expect(world.scoring.bonusPts).toBe(100);
    expect(world.scoring.itemPts).toBe(0);
    expect(combo.chain).toBe(12);
    expect(combo.multiplier).toBe(2);
    expect(combo.timerTicks).toBe(combo.refreshTicks - 1);
    expect(countEvents(world.events, EV.ComboTier)).toBe(0);
  });

  it('slinks to the nearest map-edge portal and the spawner retires him once he is out of view', () => {
    // The compiled steering town (a pavement node per tile): Bessie parked on the road at (50, 9), so the view
    // (±28 m) ends at x 78, just short of the east-edge portals at x 79; he is caught on the pavement 5.4 m away.
    const world = pavementWorld(84);
    world.vehicle.xM = 50;
    world.vehicle.yM = 9;
    const h = npcHandle(world.npc, addPerson(world, 'npc.litterbug', 55, 11));
    stepParked(world, h, 55, 11, honk());
    expect(countEvents(world.events, EV.Caught)).toBe(1);
    const nav = world.level.nav;
    let gone = -1;
    let lastX = world.npc.x[resolveNpcHandle(world.npc, h)] as number;
    let slinkTicks = 0;
    for (let t = 0; t < 2400 && gone < 0; t++) {
      stepParked(world);
      const j = resolveNpcHandle(world.npc, h);
      if (j < 0) {
        gone = world.tick;
        break;
      }
      const x = world.npc.x[j] as number;
      if (world.npc.state[j] === LITTERBUG.Slink) {
        slinkTicks += 1;
        // Off east, to the nearest portal in a straight line: (79, 11).
        expect(x).toBeGreaterThanOrEqual(lastX - 0.05);
        const goal = world.npc.goalNode[j] as number;
        expect(Array.from(nav.portals)).toContain(goal);
        expect([nav.nodeX[goal], nav.nodeY[goal]]).toEqual([79, 11]);
      }
      lastX = x;
    }
    expect(slinkTicks).toBeGreaterThan(600);
    expect(gone).toBeGreaterThan(0);
    // The spawner retired him on a once-a-second run, out of view (Bessie still parked, so the view stayed put).
    expect(gone % 60).toBe(1);
    expect(lastX + 0.3).toBeGreaterThan(world.viewRect.maxX);
    expect(world.npc.count).toBe(0);
    expect(world.npc.npcsRemoved).toBe(1);
  });

  it('knocked over while slinking: −250 and 1 complaint, then he gets up, shakes his fist and slinks on', () => {
    const world = litterTown();
    const h = npcHandle(world.npc, addPerson(world, 'npc.litterbug', CENTRE + 5, CENTRE));
    stepParked(world, h, CENTRE + 5, CENTRE, honk());
    for (let t = 0; t < STARTLE_TICKS + 1; t++) stepParked(world);
    expect(world.npc.state[resolveNpcHandle(world.npc, h)]).toBe(LITTERBUG.Slink);
    // A Hit (as the shared contact rule would push it).
    pushStimulus(world.npcAi.stimuli, Stimulus.Hit, h);
    stepParked(world);
    expect(world.npc.state[resolveNpcHandle(world.npc, h)]).toBe(PED.Fallen);
    for (let t = 1; t < FALLEN_TICKS + GET_UP_TICKS + ANGRY_TICKS; t++) stepParked(world);
    expect(world.npc.state[resolveNpcHandle(world.npc, h)]).toBe(PED.Angry);
    stepParked(world);
    expect(world.npc.state[resolveNpcHandle(world.npc, h)]).toBe(LITTERBUG.Slink);
    // Other stimuli no longer reach him.
    pushStimulus(world.npcAi.stimuli, Stimulus.Bump, h);
    stepParked(world);
    expect(world.npc.state[resolveNpcHandle(world.npc, h)]).toBe(LITTERBUG.Slink);
  });

  it('a hit costs −250 and 1 complaint, through the penalty pipeline', () => {
    const world = litterTown();
    const hit = DEFAULT_ENTITIES.npcs['npc.litterbug'].hit;
    expect(hit?.pts).toBe(-250);
    expect(hit?.complaints).toBe(1);
    const i = addPerson(world, 'npc.litterbug', CENTRE, CENTRE - HALF_L - HUMAN_R + 0.02);
    holdBessie(world, 2);
    world.step(neutral);
    expect(countEvents(world.events, EV.NpcHit)).toBe(1);
    expect(world.scoring.penaltyPts).toBe(-250);
    expect(world.complaints.count).toBe(1);
    expect(world.npc.state[i]).toBe(PED.Fallen);
  });
});
