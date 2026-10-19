// The NPC population controller (SSP-080, LEVEL_DESIGN §9.4): off-screen spawning against world.viewRect, the
// 2-per-second spawn and retirement limit, the 40 m despawn, named arrivals, dogs, cats, flocks and the
// 80-NPC budget, on the hand-built open district of tests/support/npcTown.ts. The behaviours are the no-op
// default, so NPCs stay where they spawn and only Bessie moves: she drives in circles and is moved across the
// map every 10 s, so the view keeps uncovering and leaving people behind.
import { describe, expect, it } from 'vitest';
import { NPC_IDS, type NpcId } from '../../src/sim/entities.ts';
import { createInputFrame, THROTTLE_MAX } from '../../src/sim/inputFrame.ts';
import type { NpcSpawn } from '../../src/sim/map.ts';
import { noopBehaviour } from '../../src/sim/npc/behaviours/noop.ts';
import {
  NPC_DESPAWN_M,
  NPC_MAX_CHANGES,
  NPC_SPAWN_EVERY_TICKS,
  populationTarget,
} from '../../src/sim/npc/spawner.ts';
import { NPC_CAPACITY, NpcOrigin, npcHandle, resolveNpcHandle } from '../../src/sim/npc/store.ts';
import { DEFAULT_TUNING } from '../../src/sim/tuning.ts';
import { circleTouchesViewRect } from '../../src/sim/viewRect.ts';
import { createWorld, type World } from '../../src/sim/world.ts';
import { npcTown } from '../support/npcTown.ts';

const kind = (id: NpcId): number => NPC_IDS.indexOf(id);

/** Places Bessie is moved to, one every 600 ticks, round robin (metres, on a 128 m map). */
const HOPS: readonly [number, number][] = [
  [64, 64],
  [20, 20],
  [108, 26],
  [30, 106],
  [106, 106],
  [64, 22],
  [22, 64],
];

/** Drive Bessie for tick t: circles at about 5 m/s, moved to the next HOPS spot every 600 ticks. */
function drive(world: World, t: number, input = createInputFrame()): void {
  const v = world.vehicle;
  if (t % 600 === 0) {
    const [x, y] = HOPS[(t / 600) % HOPS.length] as [number, number];
    v.xM = x;
    v.yM = y;
    v.vLongMps = 0;
    v.vLatMps = 0;
    v.yawRateRadPerS = 0;
  }
  input.throttle = v.vLongMps < 5 ? THROTTLE_MAX : 0;
  input.steer = 60;
  world.step(input);
}

type Live = Map<number, { x: number; y: number; origin: number; kind: number }>;

function liveNpcs(world: World): Live {
  const out: Live = new Map();
  const npc = world.npc;
  for (let i = 0; i < npc.count; i++) {
    out.set(npcHandle(npc, i), {
      x: npc.x[i] as number,
      y: npc.y[i] as number,
      origin: npc.origin[i] as number,
      kind: npc.kind[i] as number,
    });
  }
  return out;
}

/** Radii arrays for circleTouchesViewRect on one position. */
function touches(world: World, x: number, y: number, r: number): boolean {
  return circleTouchesViewRect(
    world.viewRect,
    new Float64Array([x]),
    new Float64Array([y]),
    0,
    new Float64Array([r]),
    0,
  );
}

describe('NPC spawner (LEVEL_DESIGN §9.4)', () => {
  it('over 3,600 ticks at population target 22: never spawns into the view rect, ≤ 2 changes per 60 ticks', () => {
    const { level } = npcTown(64, {
      population: [{ fromS: 0, toS: 240, target: 22 }],
      mix: [
        { id: 'npc.dog_walker', weight: 10 },
        { id: 'npc.mum_pushchair', weight: 20 },
        { id: 'npc.shopper', weight: 70 },
      ],
      caps: [{ id: 'npc.dog_walker', cap: 2 }],
    });
    const world = createWorld(level, 1001, DEFAULT_TUNING);
    const sp = world.npcAi.spawner;
    const input = createInputFrame();
    const changesPerTick: number[] = [];
    let spawnsChecked = 0;
    let retiresChecked = 0;
    let reachedTarget = false;
    let maxDogWalkers = 0;
    for (let t = 0; t < 3600; t++) {
      const before = liveNpcs(world);
      const changesBefore = sp.ambientSpawned + sp.ambientRetired;
      drive(world, t, input);
      changesPerTick.push(sp.ambientSpawned + sp.ambientRetired - changesBefore);
      const after = liveNpcs(world);
      const npc = world.npc;
      for (const [h, n] of after) {
        if (before.has(h)) continue;
        // A new NPC: its whole circle lies outside the view rect the spawner used (updated this tick).
        const i = resolveNpcHandle(npc, h);
        expect(touches(world, n.x, n.y, npc.radius[i] as number), `spawn at tick ${t}`).toBe(false);
        expect(npc.radius[i]).toBeGreaterThan(0);
        expect(t % NPC_SPAWN_EVERY_TICKS).toBe(0);
        spawnsChecked++;
      }
      for (const [h, n] of before) {
        if (after.has(h)) continue;
        // A retirement: beyond 40 m of Bessie (walkers) and off the view rect (walkers and dogs).
        expect(n.origin === NpcOrigin.Ambient || n.origin === NpcOrigin.Companion).toBe(true);
        expect(touches(world, n.x, n.y, 0.3), `retire at tick ${t}`).toBe(false);
        if (n.origin === NpcOrigin.Ambient) {
          const d = Math.hypot(n.x - world.vehicle.xM, n.y - world.vehicle.yM);
          expect(d).toBeGreaterThan(NPC_DESPAWN_M);
        }
        retiresChecked++;
      }
      if (sp.ambientCount === 22) reachedTarget = true;
      let walkers = 0;
      for (let i = 0; i < npc.count; i++) {
        if (npc.origin[i] === NpcOrigin.Ambient && npc.kind[i] === kind('npc.dog_walker')) walkers++;
      }
      maxDogWalkers = Math.max(maxDogWalkers, walkers);
    }
    // At most 2 ambient spawns or retirements in every 60-tick window (sliding).
    for (let t = 0; t + 60 <= changesPerTick.length; t++) {
      let sum = 0;
      for (let k = t; k < t + 60; k++) sum += changesPerTick[k] as number;
      expect(sum, `window ${t}..${t + 59}`).toBeLessThanOrEqual(NPC_MAX_CHANGES);
    }
    // The scenario did real work: the population filled, people were left behind and recycled, the cap held.
    expect(reachedTarget).toBe(true);
    expect(sp.ambientSpawned).toBeGreaterThan(40);
    expect(sp.ambientRetired).toBeGreaterThan(20);
    expect(spawnsChecked).toBeGreaterThan(40);
    expect(retiresChecked).toBeGreaterThan(20);
    expect(maxDogWalkers).toBeLessThanOrEqual(2);
    expect(maxDogWalkers).toBeGreaterThan(0);
  });

  it('a named NPC with spawnAt 70 appears on tick 4,200 at its anchor and is never despawned by distance', () => {
    const town = npcTown(64, {
      population: [{ fromS: 0, toS: 240, target: 6 }],
      mix: [{ id: 'npc.shopper', weight: 1 }],
      named: [{ id: 'npc.old_woman', count: 1, spawnAtS: 70, anchor: 0, route: [], loop: false }],
    });
    const anchor = town.node(1, 1);
    (town.level.npc as NpcSpawn).named[0] = {
      id: 'npc.old_woman',
      count: 1,
      spawnAtS: 70,
      anchor,
      route: [anchor],
      loop: false,
    };
    const world = createWorld(town.level, 7, DEFAULT_TUNING);
    // Inert people (SSP-082 gave them the generic pedestrian, which walks off on its first tick): this checks
    // where the spawner puts Doris.
    world.npcAi.behaviours.fill(noopBehaviour);
    const npc = world.npc;
    const named = (): number[] => {
      const out: number[] = [];
      for (let i = 0; i < npc.count; i++) if (npc.origin[i] === NpcOrigin.Named) out.push(i);
      return out;
    };
    const input = createInputFrame();
    for (let t = 0; t < 4200; t++) drive(world, t, input);
    expect(world.tick).toBe(4200);
    expect(named()).toEqual([]);
    drive(world, 4200, input); // the tick with index 4,200
    const [i] = named();
    expect(i).toBeDefined();
    const h = npcHandle(npc, i as number);
    expect(npc.kind[i as number]).toBe(kind('npc.old_woman'));
    expect(npc.x[i as number]).toBe(world.level.nav.nodeX[anchor]);
    expect(npc.y[i as number]).toBe(world.level.nav.nodeY[anchor]);
    expect(npc.targetNode[i as number]).toBe(anchor);
    expect(npc.group[i as number]).toBe(0);
    // Bessie goes to the far corner and circles there for a minute: Doris stays, ambient people churn.
    const retiredBefore = world.npcAi.spawner.ambientRetired;
    let farTicks = 0;
    const v = world.vehicle;
    for (let t = 4201; t < 8400; t++) {
      if (t % 600 === 0) {
        v.xM = 110;
        v.yM = 110;
        v.vLongMps = 0;
      }
      input.throttle = v.vLongMps < 5 ? THROTTLE_MAX : 0;
      input.steer = 60;
      world.step(input);
      const j = resolveNpcHandle(npc, h);
      expect(j, `tick ${t}`).toBeGreaterThanOrEqual(0);
      const d = Math.hypot((npc.x[j] as number) - v.xM, (npc.y[j] as number) - v.yM);
      if (d > NPC_DESPAWN_M) farTicks++;
    }
    expect(farTicks).toBeGreaterThan(3000);
    expect(world.npcAi.spawner.ambientRetired).toBeGreaterThan(retiredBefore);
    expect(named()).toHaveLength(1);
  });

  it('never holds more than 80 NPCs, flock birds and dogs included, and still fits every authored NPC', () => {
    const town = npcTown(64, {
      population: [{ fromS: 0, toS: 240, target: 80 }],
      mix: [
        { id: 'npc.dog_walker', weight: 30 },
        { id: 'npc.shopper', weight: 70 },
      ],
      perches: {
        id: 'npc.cat',
        count: 4,
        on: ['walls'],
        walls: [
          [3, 3],
          [125, 3],
          [3, 125],
          [125, 125],
          [64, 3],
        ],
      },
      flocks: [
        {
          id: 'npc.pigeon',
          count: 3,
          size: [6, 10],
          points: [
            [10, 60],
            [118, 60],
            [60, 118],
          ],
        },
      ],
    });
    const anchor = town.home;
    (town.level.npc as NpcSpawn).named = [
      { id: 'npc.dog_walker', count: 2, spawnAtS: 40, anchor, route: [anchor], loop: true },
      { id: 'npc.old_woman', count: 1, spawnAtS: 50, anchor, route: [anchor], loop: false },
    ];
    const world = createWorld(town.level, 99, DEFAULT_TUNING);
    const npc = world.npc;
    const sp = world.npcAi.spawner;
    const input = createInputFrame();
    let maxCount = 0;
    for (let t = 0; t < 4800; t++) {
      drive(world, t, input);
      expect(npc.count, `tick ${t}`).toBeLessThanOrEqual(NPC_CAPACITY);
      maxCount = Math.max(maxCount, npc.count);
    }
    expect(maxCount).toBe(NPC_CAPACITY);
    // Every cat and flock was placed and every named NPC (with its dog) arrived, the store full or not.
    expect(sp.perchPending).toBe(0);
    expect([...sp.flockRemaining]).toEqual([0]);
    expect([...sp.namedRemaining]).toEqual([0, 0]);
    const by = (origin: number): number => {
      let n = 0;
      for (let i = 0; i < npc.count; i++) if (npc.origin[i] === origin) n++;
      return n;
    };
    expect(by(NpcOrigin.Perch)).toBe(4);
    expect(by(NpcOrigin.Named)).toBe(3);
    const birds = by(NpcOrigin.Flock);
    expect(birds).toBeGreaterThanOrEqual(18);
    expect(birds).toBeLessThanOrEqual(30);
    // Cats sit on distinct wall perches; birds within 1.5 m of a flock point, one flock number per flock.
    const perches = new Set<number>();
    const flockIds = new Set<number>();
    for (let i = 0; i < npc.count; i++) {
      if (npc.origin[i] === NpcOrigin.Perch) {
        expect(npc.kind[i]).toBe(kind('npc.cat'));
        perches.add(npc.group[i] as number);
      }
      if (npc.origin[i] === NpcOrigin.Flock) {
        expect(npc.kind[i]).toBe(kind('npc.pigeon'));
        flockIds.add(npc.group[i] as number);
        const near = [
          [10, 60],
          [118, 60],
          [60, 118],
        ].some(
          ([x, y]) =>
            Math.abs((npc.x[i] as number) - (x as number)) <= 1.5 &&
            Math.abs((npc.y[i] as number) - (y as number)) <= 1.5,
        );
        expect(near).toBe(true);
      }
    }
    expect(perches.size).toBe(4);
    expect([...flockIds].sort()).toEqual([0, 1, 2]);
  });

  it('gives every dog walker a dog, linked both ways, and retires them together', () => {
    const { level } = npcTown(64, {
      population: [{ fromS: 0, toS: 240, target: 10 }],
      mix: [{ id: 'npc.dog_walker', weight: 1 }],
    });
    const world = createWorld(level, 3, DEFAULT_TUNING);
    const npc = world.npc;
    const input = createInputFrame();
    let sawRetire = false;
    for (let t = 0; t < 3000; t++) {
      const retired = world.npcAi.spawner.ambientRetired;
      drive(world, t, input);
      if (world.npcAi.spawner.ambientRetired > retired) sawRetire = true;
      let walkers = 0;
      let dogs = 0;
      for (let i = 0; i < npc.count; i++) {
        const other = resolveNpcHandle(npc, npc.link[i] as number);
        expect(other, `tick ${t} npc ${i}`).toBeGreaterThanOrEqual(0);
        expect(resolveNpcHandle(npc, npc.link[other] as number)).toBe(i);
        if (npc.origin[i] === NpcOrigin.Ambient) {
          walkers++;
          expect(npc.origin[other]).toBe(NpcOrigin.Companion);
          expect(npc.radius[other]).toBe(DEFAULT_TUNING.streetLife.npcRadius.dogM);
          expect(npc.radius[i]).toBe(DEFAULT_TUNING.streetLife.npcRadius.humanM);
        } else {
          dogs++;
        }
      }
      expect(dogs).toBe(walkers);
    }
    expect(sawRetire).toBe(true);
  });

  it('spawns nothing on a level without spawns.npc, and takes the target of the window holding the tick', () => {
    const { level } = npcTown(32, {
      population: [
        { fromS: 0, toS: 10, target: 3 },
        { fromS: 20, toS: 30, target: 5 },
      ],
      mix: [{ id: 'npc.shopper', weight: 1 }],
    });
    const sp = createWorld(level, 1, DEFAULT_TUNING).npcAi.spawner;
    expect(populationTarget(sp, 0)).toBe(3);
    expect(populationTarget(sp, 599)).toBe(3);
    expect(populationTarget(sp, 600)).toBe(0);
    expect(populationTarget(sp, 1200)).toBe(5);
    expect(populationTarget(sp, 1800)).toBe(0);
    level.npc = null;
    const world = createWorld(level, 1, DEFAULT_TUNING);
    expect(world.npcAi.spawner.active).toBe(false);
    const input = createInputFrame();
    for (let t = 0; t < 600; t++) drive(world, t, input);
    expect(world.npc.count).toBe(0);
  });

  it('is a pure function of the seed: same seed, same NPCs every tick; another seed, another street', () => {
    const run = (seed: number): string[] => {
      const { level } = npcTown(64, {
        population: [{ fromS: 0, toS: 240, target: 22 }],
        mix: [
          { id: 'npc.postie', weight: 1 },
          { id: 'npc.shopper', weight: 3 },
        ],
      });
      const world = createWorld(level, seed, DEFAULT_TUNING);
      const input = createInputFrame();
      const out: string[] = [];
      for (let t = 0; t < 1800; t++) {
        drive(world, t, input);
        if (t % 60 === 0) {
          const npc = world.npc;
          const row: string[] = [];
          for (let i = 0; i < npc.count; i++) row.push(`${npc.kind[i]}@${npc.x[i]},${npc.y[i]}`);
          out.push(row.join(' '));
        }
      }
      return out;
    };
    const a = run(5);
    expect(run(5)).toEqual(a);
    expect(run(6)).not.toEqual(a);
  });

  it('refuses a spec naming an NPC kind entities.json does not have', () => {
    const { level } = npcTown(32, { mix: [{ id: 'npc.jogger', weight: 1 }] });
    expect(() => createWorld(level, 1, DEFAULT_TUNING)).toThrow(/npc\.jogger is not an NPC kind/);
  });
});
