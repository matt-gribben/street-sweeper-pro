// npc.pigeon flocks and Pigeon Scatter (SSP-088; ENTITY_CATALOG §7.1, §7.4, §3.2; GDD §10.3; LEVEL_DESIGN §9.4):
// Bessie's body within 4 m of a bird scatters its whole flock, which lands 10 m away; birds are ghosts (no hit, no
// bump, no penalty); driving through a scattering flock (her body OBB over the circle it took off from, the
// reading proposed by SSP-088) awards +25 once per scatter, unmultiplied, the chain untouched; flocks gather at
// chip wrappers; a flock of 12 is 12 of the 80.
import { describe, expect, it } from 'vitest';
import { addComboPickup } from '../../../src/sim/combo.ts';
import { LITTER_IDS } from '../../../src/sim/entities.ts';
import { countEvents, EV } from '../../../src/sim/eventQueue.ts';
import { addLitter } from '../../../src/sim/litter.ts';
import type { NpcFlock, NpcSpawn } from '../../../src/sim/map.ts';
import { gapToBessieM } from '../../../src/sim/npc/behaviours/businessman.ts';
import { stand } from '../../../src/sim/npc/behaviours/pedestrian.ts';
import {
  FLOCK_MODE,
  GATHER_REST_TICKS,
  PIGEON,
  pigeonBehaviour,
} from '../../../src/sim/npc/behaviours/pigeon.ts';
import { STEER_TILE } from '../../../src/sim/npc/steering.ts';
import { addNpcAt, NPC_CAPACITY, NPC_FLAG, NpcOrigin, updateNpcCell } from '../../../src/sim/npc/store.ts';
import { DEFAULT_ENTITIES, DEFAULT_TUNING } from '../../../src/sim/tuning.ts';
import { createWorld, type World } from '../../../src/sim/world.ts';
import { npcTown } from '../../support/npcTown.ts';
import {
  addPerson,
  CENTRE,
  holdBessie,
  honk,
  kindOf,
  neutral,
  pavementWorld,
  TOWN_TILES,
} from '../../support/pedestrianRig.ts';

const RULES = DEFAULT_ENTITIES.npcs['npc.pigeon'].rules;
/** The flock point: 18 m north of Bessie's start, off the view rect (±14.2 m north–south), so it is placed at once. */
const FLOCK_X = CENTRE;
const FLOCK_Y = CENTRE - 18;

function flockWorld(seed: number, flocks: NpcFlock[] = [flockSpec(12)], npc: Partial<NpcSpawn> = {}): World {
  const { level } = npcTown(TOWN_TILES, { flocks, ...npc });
  return createWorld(level, seed, DEFAULT_TUNING);
}

function flockSpec(size: number, x = FLOCK_X, y = FLOCK_Y): NpcFlock {
  return { id: 'npc.pigeon', count: 1, size: [size, size], points: [[x, y]] };
}

/** The live birds of flock `f`, by index. */
function birds(world: World, f = 0): number[] {
  const out: number[] = [];
  for (let i = 0; i < world.npc.count; i++)
    if (world.npc.origin[i] === NpcOrigin.Flock && world.npc.group[i] === f) out.push(i);
  return out;
}

function minGap(world: World, f = 0): number {
  return Math.min(...birds(world, f).map((i) => gapToBessieM(world, i)));
}

function step(world: World, speedMps = 0, input = neutral): void {
  holdBessie(world, speedMps);
  world.step(input);
}

/**
 * Put Bessie due south of the flock, heading north, with her body outline exactly `gap` from the nearest bird
 * (each move shortens every gap by at most the move, so the iteration never overshoots).
 */
function parkSouthOf(world: World, gap: number, f = 0): void {
  const v = world.vehicle;
  const bs = birds(world, f);
  v.xM = bs.reduce((s, i) => s + (world.npc.x[i] as number), 0) / bs.length;
  v.yM = Math.max(...bs.map((i) => world.npc.y[i] as number)) + 30;
  v.headingRad = 0;
  for (let k = 0; k < 200; k++) {
    const d = minGap(world, f) - gap;
    if (Math.abs(d) < 1e-9) break;
    v.yM -= d;
  }
  expect(minGap(world, f)).toBeCloseTo(gap, 9);
}

describe('npc.pigeon flocks (ENTITY_CATALOG §7.4, LEVEL_DESIGN §9.4)', () => {
  it('reads its numbers from entities.json and is in the registry', () => {
    expect(RULES).toEqual({
      flockMin: 6,
      flockMax: 12,
      scatterM: 4,
      landM: 10,
      scatterPts: 25,
      flyMps: 8,
      gatherM: 10,
    });
    expect(DEFAULT_ENTITIES.npcs['npc.pigeon'].hit).toBeNull();
    const world = flockWorld(1);
    expect(world.npcAi.behaviours[kindOf('npc.pigeon')]).toBe(pigeonBehaviour);
  });

  it('a flock of 12 is placed as 12 ghost birds sharing one flock number, pecking', () => {
    const world = flockWorld(2);
    step(world);
    const bs = birds(world);
    expect(bs).toHaveLength(12);
    for (const i of bs) {
      expect(world.npc.kind[i]).toBe(kindOf('npc.pigeon'));
      expect(world.npc.state[i]).toBe(PIGEON.Peck);
      expect((world.npc.flags[i] as number) & NPC_FLAG.GHOST).toBe(NPC_FLAG.GHOST);
      expect(Math.abs((world.npc.x[i] as number) - FLOCK_X)).toBeLessThanOrEqual(1.5);
      expect(Math.abs((world.npc.y[i] as number) - FLOCK_Y)).toBeLessThanOrEqual(1.5);
    }
    expect(world.npcAi.flocks.count).toBe(1);
    expect(world.npcAi.flocks.mode[0]).toBe(FLOCK_MODE.Ground);
  });

  it('a flock of 12 counts as 12 toward the 80-NPC cap', () => {
    const world = flockWorld(3, [flockSpec(12)], {
      population: [{ fromS: 0, toS: 1000, target: 200 }],
      mix: [{ id: 'npc.shopper', weight: 1 }],
    });
    let full = 0;
    for (let t = 0; t < 3600; t++) {
      step(world);
      expect(world.npc.count).toBeLessThanOrEqual(NPC_CAPACITY);
      if (world.npc.count === NPC_CAPACITY) full++;
    }
    expect(full).toBeGreaterThan(0);
    let ambient = 0;
    for (let i = 0; i < world.npc.count; i++) if (world.npc.origin[i] === NpcOrigin.Ambient) ambient++;
    expect(birds(world)).toHaveLength(12);
    expect(ambient).toBe(NPC_CAPACITY - 12);
  });

  it('Bessie at 3.9 m scatters the whole flock, which lands 10 ± 1 m away; at 4.1 m it stays', () => {
    const near = flockWorld(4);
    step(near);
    parkSouthOf(near, 4.1);
    for (let t = 0; t < 120; t++) {
      step(near);
      for (const i of birds(near)) expect(near.npc.state[i]).toBe(PIGEON.Peck);
    }
    expect(near.npcAi.flocks.scatters[0]).toBe(0);

    const world = flockWorld(4);
    step(world);
    parkSouthOf(world, 3.9);
    const bs = birds(world);
    const from = bs.map((i) => [world.npc.x[i] as number, world.npc.y[i] as number]);
    step(world);
    expect(world.npcAi.flocks.mode[0]).toBe(FLOCK_MODE.Scatter);
    for (const i of bs) expect(world.npc.state[i]).toBe(PIGEON.Fly);
    let landedAt = -1;
    for (let t = 0; t < 600 && landedAt < 0; t++) {
      step(world);
      if (bs.every((i) => world.npc.state[i] === PIGEON.Peck)) landedAt = t;
    }
    // 10 m at 8 m/s: 75 ticks in the air.
    expect(landedAt).toBeGreaterThan(70);
    expect(landedAt).toBeLessThan(80);
    bs.forEach((i, k) => {
      const [x0, y0] = from[k] as number[];
      const d = Math.hypot(
        (world.npc.x[i] as number) - (x0 as number),
        (world.npc.y[i] as number) - (y0 as number),
      );
      expect(d).toBeGreaterThanOrEqual(RULES.landM - 1);
      expect(d).toBeLessThanOrEqual(RULES.landM + 1);
      // Away from Bessie: she is south of them, so they went north.
      expect(world.npc.y[i] as number).toBeLessThan(y0 as number);
    });
    // Landed out of scatter range: the flock is back on the ground and does not take off again.
    for (let t = 0; t < 120; t++) step(world);
    expect(world.npcAi.flocks.mode[0]).toBe(FLOCK_MODE.Ground);
    expect(world.npcAi.flocks.scatters[0]).toBe(1);
    // Standing still 3.9 m off, Bessie never touched the circle they left: no bonus.
    expect(world.scoring.bonusPts).toBe(0);
  });

  it('contact is never a hit or a penalty: Bessie can drive straight through and park on the birds', () => {
    const world = flockWorld(5);
    step(world);
    // Parked on top of the flock (scatters it), then driven through a fresh flock at 6 m/s.
    world.vehicle.xM = FLOCK_X;
    world.vehicle.yM = FLOCK_Y;
    for (let t = 0; t < 30; t++) step(world);
    const other = flockWorld(5);
    step(other);
    parkSouthOf(other, 8);
    for (let t = 0; t < 240; t++) step(other, 6);
    for (const w of [world, other]) {
      expect(w.npcAi.reactions.hits).toBe(0);
      expect(w.npcAi.reactions.bumps).toBe(0);
      expect(w.scoring.penaltyPts).toBe(0);
      expect(w.complaints.count).toBe(0);
      expect(w.penalties.applied).toBe(0);
      expect(countEvents(w.events, EV.NpcHit)).toBe(0);
    }
  });

  it('driving through a scattering flock awards +25 exactly once per scatter, unmultiplied, the chain unchanged', () => {
    const world = flockWorld(6);
    step(world);
    parkSouthOf(world, 4.5);
    const combo = world.scoring.combo;
    world.events.sealed = false;
    for (let k = 0; k < 12; k++) addComboPickup(combo, world.events);
    expect(combo.chain).toBe(12);
    expect(combo.multiplier).toBe(2);
    const scoreBefore = world.scoring.score;
    let bonusTick = -1;
    let chainBefore = -1;
    let multBefore = -1;
    // Drive north through the flock at 6 m/s until the bonus, then stop on the spot it left.
    for (let t = 0; t < 120 && bonusTick < 0; t++) {
      chainBefore = combo.chain;
      multBefore = combo.multiplier;
      step(world, 6);
      if (countEvents(world.events, EV.PigeonScatter) > 0) bonusTick = t;
    }
    expect(bonusTick).toBeGreaterThan(0);
    expect(world.npcAi.flocks.mode[0]).toBe(FLOCK_MODE.Scatter);
    const e = world.events;
    let k = -1;
    for (let j = 0; j < e.count; j++) if (e.type[j] === EV.PigeonScatter) k = j;
    expect(e.entity[k]).toBe(0);
    expect(e.c[k]).toBe(25);
    // +25, not 25 × 2; the chain and multiplier as they were (its timer only counts down), no tier change.
    expect(world.scoring.score - scoreBefore).toBe(25);
    expect(world.scoring.bonusPts).toBe(25);
    expect(combo.chain).toBe(chainBefore);
    expect(combo.multiplier).toBe(multBefore);
    expect(combo.chain).toBe(12);
    expect(countEvents(world.events, EV.ComboTier)).toBe(0);
    // Parked on the spot the flock left for the rest of its flight: the same scatter pays nothing more.
    let more = 0;
    for (let t = 0; t < 200; t++) {
      step(world, 0);
      more += countEvents(world.events, EV.PigeonScatter);
    }
    expect(more).toBe(0);
    expect(world.npcAi.flocks.mode[0]).toBe(FLOCK_MODE.Ground);
    expect(world.npcAi.flocks.scatters[0]).toBe(1);
    expect(world.scoring.bonusPts).toBe(25);
    // A second run at the flock is a second scatter: +25 again.
    parkSouthOf(world, 4.5);
    let second = 0;
    for (let t = 0; t < 120 && second === 0; t++) {
      step(world, 6);
      second += countEvents(world.events, EV.PigeonScatter);
    }
    expect(second).toBe(1);
    expect(world.npcAi.flocks.scatters[0]).toBe(2);
    expect(world.scoring.bonusPts).toBe(50);
    expect(world.npcAi.flocks.bonuses).toBe(2);
  });

  it('a slow approach scatters the flock but earns nothing: the birds are gone before she gets there', () => {
    const world = flockWorld(7);
    step(world);
    parkSouthOf(world, 4.5);
    for (let t = 0; t < 400; t++) step(world, 1);
    expect(world.npcAi.flocks.scatters[0]).toBeGreaterThan(0);
    expect(world.scoring.bonusPts).toBe(0);
  });

  it('the horn, hi-vis and a spray mean nothing to a pigeon', () => {
    const world = flockWorld(8);
    step(world);
    parkSouthOf(world, 6);
    for (let t = 0; t < 60; t++) step(world, 0, t % 20 === 0 ? honk() : neutral);
    for (const i of birds(world)) expect(world.npc.state[i]).toBe(PIGEON.Peck);
    expect(world.npcAi.flocks.scatters[0]).toBe(0);
  });

  it('gathers at a chip wrapper within 10 m, pecking round it, and ignores one by Bessie', () => {
    const world = flockWorld(9);
    step(world);
    const bs = birds(world);
    const cx = bs.reduce((s, i) => s + (world.npc.x[i] as number), 0) / bs.length;
    const cy = bs.reduce((s, i) => s + (world.npc.y[i] as number), 0) / bs.length;
    // A crisp packet nearer than the wrapper does nothing; the wrapper 7 m west draws the flock.
    addLitter(world.litter, LITTER_IDS.indexOf('litter.crisp_packet'), cx + 3, cy, 0);
    addLitter(world.litter, LITTER_IDS.indexOf('litter.chip_wrapper'), cx - 7, cy, 0);
    let gathered = -1;
    for (let t = 0; t < GATHER_REST_TICKS + 240 && gathered < 0; t++) {
      step(world);
      if (world.npcAi.flocks.mode[0] === FLOCK_MODE.Gather) gathered = world.tick;
    }
    expect(gathered).toBeGreaterThan(0);
    for (let t = 0; t < 120; t++) step(world);
    expect(world.npcAi.flocks.mode[0]).toBe(FLOCK_MODE.Ground);
    const mx = bs.reduce((s, i) => s + (world.npc.x[i] as number), 0) / bs.length;
    const my = bs.reduce((s, i) => s + (world.npc.y[i] as number), 0) / bs.length;
    expect(Math.hypot(mx - (cx - 7), my - cy)).toBeLessThan(1e-3);
    expect(world.npcAi.flocks.gathers[0]).toBe(1);
    expect(world.scoring.bonusPts).toBe(0);

    // A wrapper 6 m from a flock but within scatterM + 2 m of Bessie's body: they stay put.
    const shy = flockWorld(9);
    step(shy);
    parkSouthOf(shy, 7);
    const sx = shy.vehicle.xM;
    addLitter(shy.litter, LITTER_IDS.indexOf('litter.chip_wrapper'), sx, shy.vehicle.yM - 1.625 - 3, 0);
    for (let t = 0; t < GATHER_REST_TICKS + 240; t++) step(shy);
    expect(shy.npcAi.flocks.gathers[0]).toBe(0);
  });

  it('pigeons are ghosts to people: a bird on a zebra does not hold it, and walkers pass through birds', () => {
    const world = pavementWorld(10);
    const z = world.zebras;
    expect(z.count).toBeGreaterThan(0);
    const zx = ((z.minX[0] as number) + (z.maxX[0] as number)) / 2;
    const zy = ((z.minY[0] as number) + (z.maxY[0] as number)) / 2;
    const kind = kindOf('npc.pigeon');
    const i = addNpcAt(world.npc, kind, NpcOrigin.Flock, zx, zy);
    world.npc.radius[i] = DEFAULT_TUNING.streetLife.npcRadius.catM;
    pigeonBehaviour.onSpawn?.(world, i);
    world.vehicle.xM = 6;
    world.vehicle.yM = 6;
    for (let t = 0; t < 10; t++) step(world);
    expect(z.occupancy[0]).toBe(0);
    // A person standing (separation and the steering constraints run) where a bird is is not pushed off it,
    // where another person there would push him.
    const standing = (withGhost: boolean): number[] => {
      const w = pavementWorld(10);
      w.vehicle.xM = 6;
      w.vehicle.yM = 6;
      w.npcAi.behaviours[kindOf('npc.old_man_frame')] = {
        initial: 0,
        jaywalks: false,
        tick: stand,
        onStimulus: () => undefined,
      };
      const p = addPerson(w, 'npc.old_man_frame', 30, 11);
      const other = addNpcAt(w.npc, kind, NpcOrigin.Flock, 30.1, 11);
      w.npc.radius[other] = DEFAULT_TUNING.streetLife.npcRadius.catM;
      if (withGhost) pigeonBehaviour.onSpawn?.(w, other);
      else
        w.npcAi.behaviours[kind] = {
          initial: 0,
          jaywalks: false,
          tick: () => undefined,
          onStimulus: () => undefined,
        };
      updateNpcCell(w.npc, other);
      step(w);
      return [w.npc.x[p] as number, w.npc.y[p] as number];
    };
    expect(standing(true)).toEqual([30, 11]);
    expect(standing(false)).not.toEqual([30, 11]);
  });

  it('never lands on a blocked tile: scattered against a terrace it turns off the facade', () => {
    // The compiled steering town: terraces north and south of a road. Birds on the north pavement, Bessie south
    // of them: straight away is into the north terrace, so they land along the street instead.
    const world = pavementWorld(11, {
      flocks: [{ id: 'npc.pigeon', count: 1, size: [8, 8], points: [[60, 3.2]] }],
    });
    world.vehicle.xM = 20;
    world.vehicle.yM = 15;
    for (let t = 0; t < 61; t++) step(world);
    expect(birds(world)).toHaveLength(8);
    parkSouthOf(world, 3);
    const st = world.npcAi.steering;
    step(world);
    expect(world.npcAi.flocks.mode[0]).toBe(FLOCK_MODE.Scatter);
    for (let t = 0; t < 200; t++) step(world);
    for (const i of birds(world)) {
      expect(world.npc.state[i]).toBe(PIGEON.Peck);
      const tx = Math.floor((world.npc.x[i] as number) / 2);
      const ty = Math.floor((world.npc.y[i] as number) / 2);
      expect(tx >= 0 && ty >= 0 && tx < st.widthTiles && ty < st.heightTiles, `bird ${i} on the map`).toBe(
        true,
      );
      expect((st.tileFlags[ty * st.widthTiles + tx] as number) & STEER_TILE.BLOCKED, `bird ${i}`).toBe(0);
    }
  });
});
