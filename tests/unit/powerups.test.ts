// Power-ups (SSP-096; GDD §12.7, ENTITY_CATALOG §12, LEVEL_DESIGN §9.6, TECHNICAL_DESIGN §7.3): shift-start
// spawning on pavements from the table or the fixed `at` points on the `pickups` stream, collection by Bessie's
// body OBB whatever the brush state (EV.PowerUp), the six effects with their tick-exact durations, restart-not-
// stack, and the instant effects' caps.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BrushState, flingProbability, stepBrushLitter } from '../../src/sim/brush.ts';
import { TILE_M } from '../../src/sim/constants.ts';
import { LITTER_IDS, NPC_IDS, POWERUP_IDS, type PowerupId } from '../../src/sim/entities.ts';
import { countEvents, EV } from '../../src/sim/eventQueue.ts';
import { createInputFrame, THROTTLE_MAX } from '../../src/sim/inputFrame.ts';
import { addLitter } from '../../src/sim/litter.ts';
import {
  COLLIDE,
  createBlankLevel,
  decodeLevel,
  Ground,
  type Level,
  type PickupSpawn,
  surfaceOfGround,
} from '../../src/sim/map.ts';
import { PED } from '../../src/sim/npc/behaviours/pedestrian.ts';
import { isHiVisActive } from '../../src/sim/npc/reactions.ts';
import {
  addNpcAt,
  NPC_FLAG,
  NpcOrigin,
  npcHandle,
  resolveNpcHandle,
  setNpcState,
  updateNpcCell,
} from '../../src/sim/npc/store.ts';
import {
  addPickup,
  applyPowerUp,
  createPickups,
  PICKUP_CAPACITY,
  PICKUP_RADIUS_M,
  powerUpTicksLeft,
  shownPowerUp,
  spawnPickups,
} from '../../src/sim/pickups.ts';
import { absorbTick, createStateHasher } from '../../src/sim/replay.ts';
import { snapshotWorld } from '../../src/sim/snapshot.ts';
import { DEFAULT_ENTITIES, DEFAULT_TUNING, type PropFootprint } from '../../src/sim/tuning.ts';
import { computeHandling, createVehicleHandling } from '../../src/sim/vehicle.ts';
import { createWorld, type World } from '../../src/sim/world.ts';
import { npcTown } from '../support/npcTown.ts';

const PUDDLE_LANE_JSON = readFileSync(
  fileURLToPath(new URL('../../public/assets/levels/puddle_lane.json', import.meta.url)),
  'utf8',
);
const neutral = createInputFrame();
const SWEEPER = DEFAULT_TUNING.vehicle.sweeper;

function kindOf(id: PowerupId): number {
  return POWERUP_IDS.indexOf(id);
}

/** Puddle Lane as compiled, with its power-up spec replaced by `pickups`. */
function puddleLane(pickups: PickupSpawn | null): Level {
  const level = decodeLevel(JSON.parse(PUDDLE_LANE_JSON));
  level.pickups = pickups;
  return level;
}

/** The open NPC test district (48 × 48 tiles of road) with Bessie at its centre (48, 48) facing north. */
function townWorld(seed = 96): World {
  return createWorld(npcTown(48, {}).level, seed, DEFAULT_TUNING);
}

/** A pickup of `id` right under Bessie, collected by the next step. */
function dropUnderBessie(world: World, id: PowerupId): void {
  addPickup(world.pickups, kindOf(id), world.vehicle.xM, world.vehicle.yM);
}

function tileGround(level: Level, xM: number, yM: number): number {
  const t = Math.floor(yM / TILE_M) * level.size[0] + Math.floor(xM / TILE_M);
  return level.layers.ground[t] as number;
}

describe('spawning (LEVEL_DESIGN §9.6)', () => {
  const table = [
    { id: 'pwr.bacon_butty', weight: 1 },
    { id: 'pwr.flask_of_tea', weight: 2 },
    { id: 'pwr.super_suction', weight: 1 },
    { id: 'pwr.water_can', weight: 1 },
  ];

  it('places exactly powerups.count pickups on open pavement tiles, identically for the same seed', () => {
    const level = puddleLane({ count: 2, table, at: [] });
    const a = createWorld(level, 1001, DEFAULT_TUNING);
    const b = createWorld(puddleLane({ count: 2, table, at: [] }), 1001, DEFAULT_TUNING);
    expect(a.pickups.count).toBe(2);
    expect(a.pickups.spawned).toBe(2);
    const tiles = new Set<number>();
    for (let i = 0; i < a.pickups.count; i++) {
      const x = a.pickups.x[i] as number;
      const y = a.pickups.y[i] as number;
      expect(tileGround(level, x, y)).toBe(Ground.Pavement);
      const t = Math.floor(y / TILE_M) * level.size[0] + Math.floor(x / TILE_M);
      expect((level.layers.collide[t] as number) & COLLIDE.SOLID).toBe(0);
      // On the tile centre.
      expect([x % TILE_M, y % TILE_M]).toEqual([1, 1]);
      tiles.add(t);
      expect(table.map((e) => e.id)).toContain(POWERUP_IDS[a.pickups.kind[i] as number]);
    }
    expect(tiles.size).toBe(2);
    expect(snapshotWorld(b).pickups).toEqual(snapshotWorld(a).pickups);
  });

  it('draws on its own `pickups` stream: other seeds move them, and the litter is untouched', () => {
    const one = createWorld(puddleLane({ count: 3, table, at: [] }), 1001, DEFAULT_TUNING);
    const none = createWorld(puddleLane(null), 1001, DEFAULT_TUNING);
    expect(none.pickups.count).toBe(0);
    expect(Array.from(one.litter.x.subarray(0, one.litter.count))).toEqual(
      Array.from(none.litter.x.subarray(0, none.litter.count)),
    );
    const layouts = new Set<string>();
    for (const seed of [1, 2, 3, 4, 5]) {
      layouts.add(
        JSON.stringify(
          snapshotWorld(createWorld(puddleLane({ count: 3, table, at: [] }), seed, DEFAULT_TUNING)).pickups,
        ),
      );
    }
    expect(layouts.size).toBeGreaterThan(1);
  });

  it('keeps clear of static prop footprints (circles and turned boxes, padded by the pickup radius)', () => {
    const level = puddleLane({ count: 3, table, at: [] });
    const shapes: Record<string, PropFootprint | undefined> = DEFAULT_TUNING.propFootprints.shapes;
    let checked = 0;
    for (let seed = 0; seed < 40; seed++) {
      const w = createWorld(level, seed, DEFAULT_TUNING);
      for (let i = 0; i < w.pickups.count; i++) {
        const px = w.pickups.x[i] as number;
        const py = w.pickups.y[i] as number;
        for (const prop of level.props) {
          const fp = shapes[prop.id];
          if (fp === undefined) continue;
          checked += 1;
          const dx = px - prop.x;
          const dy = py - prop.y;
          if (fp.shape === 'circle') {
            expect(Math.hypot(dx, dy)).toBeGreaterThan(fp.radiusM + PICKUP_RADIUS_M);
          } else {
            const lx = dx * Math.cos(prop.rot) + dy * Math.sin(prop.rot);
            const ly = dx * Math.sin(prop.rot) - dy * Math.cos(prop.rot);
            const inside =
              Math.abs(lx) <= fp.widthM / 2 + PICKUP_RADIUS_M &&
              Math.abs(ly) <= fp.lengthM / 2 + PICKUP_RADIUS_M;
            expect(inside).toBe(false);
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('uses the fixed `at` points first, then random pavement for the rest', () => {
    // Puddle Lane tile (30, 11) is pavement (LEVEL_DESIGN §5.1's planned flask spot): 61, 23 m.
    const level = puddleLane({ count: 2, table: [{ id: 'pwr.wrench', weight: 1 }], at: [[61, 23]] });
    expect(tileGround(level, 61, 23)).toBe(Ground.Pavement);
    const w = createWorld(level, 7, DEFAULT_TUNING);
    expect(w.pickups.count).toBe(2);
    expect([w.pickups.x[0], w.pickups.y[0]]).toEqual([61, 23]);
    expect([w.pickups.x[1], w.pickups.y[1]]).not.toEqual([61, 23]);
    expect(POWERUP_IDS[w.pickups.kind[0] as number]).toBe('pwr.wrench');
    expect(POWERUP_IDS[w.pickups.kind[1] as number]).toBe('pwr.wrench');
    // count below the fixed points: only the first `count` are used.
    const one = createWorld(
      puddleLane({
        count: 1,
        table,
        at: [
          [61, 23],
          [61, 25],
        ],
      }),
      7,
      DEFAULT_TUNING,
    );
    expect(one.pickups.count).toBe(1);
    expect([one.pickups.x[0], one.pickups.y[0]]).toEqual([61, 23]);
  });

  it('rejects authoring errors: a fixed point off the pavement, more than the store holds, too few tiles', () => {
    expect(() => createWorld(puddleLane({ count: 1, table, at: [[7, 89]] }), 1, DEFAULT_TUNING)).toThrow(
      /powerups\.at\[0\] \(7, 89\) m is not on an open pavement tile/,
    );
    const pickups = createPickups(DEFAULT_ENTITIES);
    expect(() =>
      spawnPickups(
        pickups,
        puddleLane({ count: PICKUP_CAPACITY + 1, table, at: [] }),
        1,
        DEFAULT_TUNING.propFootprints,
      ),
    ).toThrow(/the store holds 16/);
    const road = createBlankLevel('test.all_road', 8, 8);
    road.layers.ground.fill(Ground.Road);
    road.layers.surface.fill(surfaceOfGround(Ground.Road));
    road.pickups = { count: 1, table, at: [] };
    expect(() =>
      spawnPickups(createPickups(DEFAULT_ENTITIES), road, 1, DEFAULT_TUNING.propFootprints),
    ).toThrow(/0 free pavement tile\(s\) for 1 power-up/);
  });

  it("spawns Puddle Lane's committed flask of tea (count 1) on a pavement tile", () => {
    const level = decodeLevel(JSON.parse(PUDDLE_LANE_JSON));
    expect(level.pickups?.count).toBe(1);
    const w = createWorld(level, 1001, DEFAULT_TUNING);
    expect(snapshotWorld(w).pickups).toEqual([
      { id: 'pwr.flask_of_tea', x: expect.any(Number), y: expect.any(Number) },
    ]);
    expect(tileGround(level, w.pickups.x[0] as number, w.pickups.y[0] as number)).toBe(Ground.Pavement);
  });
});

describe('collection (body OBB overlap, any brush state)', () => {
  it('collects on overlap with the brush raised, emits EV.PowerUp once and removes the pickup', () => {
    const world = townWorld();
    expect(world.brush.state).toBe(BrushState.Raised);
    const v = world.vehicle;
    // Just outside the front bumper: not collected.
    addPickup(
      world.pickups,
      kindOf('pwr.wrench'),
      v.xM,
      v.yM - SWEEPER.body.lengthM / 2 - PICKUP_RADIUS_M - 0.01,
    );
    // Touching the right flank: collected.
    addPickup(
      world.pickups,
      kindOf('pwr.water_can'),
      v.xM + SWEEPER.body.widthM / 2 + PICKUP_RADIUS_M - 0.01,
      v.yM,
    );
    world.step(neutral);
    expect(countEvents(world.events, EV.PowerUp)).toBe(1);
    expect(world.events.c[0]).toBe(kindOf('pwr.water_can'));
    expect(world.pickups.count).toBe(1);
    expect(world.pickups.collected).toBe(1);
    expect(POWERUP_IDS[world.pickups.kind[0] as number]).toBe('pwr.wrench');
    world.step(neutral);
    expect(countEvents(world.events, EV.PowerUp)).toBe(0);
  });

  it('collects several in one tick in store order, testing the swapped-in pickup too', () => {
    const world = townWorld();
    dropUnderBessie(world, 'pwr.wrench');
    dropUnderBessie(world, 'pwr.water_can');
    dropUnderBessie(world, 'pwr.flask_of_tea');
    world.step(neutral);
    expect(countEvents(world.events, EV.PowerUp)).toBe(3);
    expect([world.events.c[0], world.events.c[1], world.events.c[2]]).toEqual([
      kindOf('pwr.wrench'),
      kindOf('pwr.flask_of_tea'),
      kindOf('pwr.water_can'),
    ]);
    expect(world.pickups.count).toBe(0);
  });

  it('collects with the brush down too', () => {
    const world = townWorld();
    world.brush.state = BrushState.Collecting;
    world.vehicle.brushDown = true;
    dropUnderBessie(world, 'pwr.wrench');
    world.step(neutral);
    expect(countEvents(world.events, EV.PowerUp)).toBe(1);
  });
});

describe('timed effects (ENTITY_CATALOG §12)', () => {
  it('flask of tea: chain timer 240 ticks for 900 ticks, then 120; a second tea at 600 restarts the 900', () => {
    const world = townWorld();
    const combo = world.scoring.combo;
    expect(combo.refreshTicks).toBe(120);
    dropUnderBessie(world, 'pwr.flask_of_tea');
    const t0 = world.tick;
    world.step(neutral);
    let on = 0;
    while (world.tick < t0 + 600) {
      expect(combo.refreshTicks).toBe(240);
      on += 1;
      world.step(neutral);
    }
    expect(on).toBe(599);
    // Tick 600: a second flask while the first runs.
    dropUnderBessie(world, 'pwr.flask_of_tea');
    const t1 = world.tick;
    world.step(neutral);
    expect(combo.refreshTicks).toBe(240);
    expect(world.pickups.untilTick[kindOf('pwr.flask_of_tea')]).toBe(t1 + 900);
    while (world.tick < t1 + 900) {
      // Never 4× (480): the timer restarts, it does not stack.
      expect(combo.refreshTicks).toBe(240);
      world.step(neutral);
    }
    // The effect ran on ticks t1 .. t1 + 899; tick t1 + 900 is back to the 2.0 s timer.
    expect(world.tick).toBe(t1 + 900);
    world.step(neutral);
    expect(combo.refreshTicks).toBe(120);
    expect(world.pickups.untilTick[kindOf('pwr.flask_of_tea')]).toBe(0);
  });

  it('flask of tea lasts exactly 900 ticks on its own', () => {
    const world = townWorld();
    dropUnderBessie(world, 'pwr.flask_of_tea');
    let on = 0;
    for (let t = 0; t < 1000; t++) {
      world.step(neutral);
      if (world.scoring.combo.refreshTicks === 240) on += 1;
    }
    expect(on).toBe(900);
  });

  it('bacon butty: brush-down top speed 7.8 m/s (transit 14.3) for 600 ticks; fling at 5.0 m/s unchanged', () => {
    const world = townWorld();
    const handling = createVehicleHandling();
    const p0 = flingProbability(world.brush, world.tuning, 5.0);
    expect(p0).toBeCloseTo(0.5, 12);
    dropUnderBessie(world, 'pwr.bacon_butty');
    let on = 0;
    for (let t = 0; t < 700; t++) {
      world.step(neutral);
      const down = computeHandling(world.vehicleParams, 0, true, handling).vTopMps;
      if (down > 6.0 + 1e-9) {
        expect(down).toBeCloseTo(7.8, 9);
        expect(computeHandling(world.vehicleParams, 0, false, handling).vTopMps).toBeCloseTo(14.3, 9);
        expect(flingProbability(world.brush, world.tuning, 5.0)).toBe(p0);
        expect(world.brush.flingThresholdMps).toBeNull();
        on += 1;
      } else expect(down).toBe(6.0);
    }
    expect(on).toBe(600);
  });

  it('bacon butty lets Bessie actually pass 6.0 m/s with the brush down', () => {
    const world = townWorld();
    // Bessie faces north: start her near the south edge so the 400 ticks are one long straight.
    world.vehicle.yM = 90;
    world.vehicle.prevYM = 90;
    world.brush.state = BrushState.Collecting;
    world.brush.posTicks = 1_000_000;
    dropUnderBessie(world, 'pwr.bacon_butty');
    const go = createInputFrame();
    go.throttle = THROTTLE_MAX;
    let top = 0;
    for (let t = 0; t < 400; t++) {
      world.step(go);
      top = Math.max(top, world.vehicle.vLongMps);
    }
    expect(world.vehicle.brushDown).toBe(true);
    expect(top).toBeGreaterThan(6.5);
    expect(top).toBeLessThanOrEqual(7.8 + 1e-9);
  });

  it('super suction: fling probability 0 at 6.0 m/s and a 6.0 m/s × RPM pull, for 600 ticks', () => {
    const world = townWorld();
    const tuning = world.tuning;
    expect(flingProbability(world.brush, tuning, 6.0)).toBe(1);
    dropUnderBessie(world, 'pwr.super_suction');
    world.step(neutral);
    expect(flingProbability(world.brush, tuning, 6.0)).toBe(0);
    expect(flingProbability(world.brush, tuning, 5.0)).toBe(0);
    expect(world.brush.suctionMult).toBe(2);

    // The pull: an item in the suction rect straight ahead of the inlet, brush collecting at full RPM.
    const v = world.vehicle;
    world.brush.state = BrushState.Collecting;
    v.brushPos = 1;
    v.brushDown = true;
    v.rpm = 1;
    v.vLongMps = 0;
    const kind = LITTER_IDS.indexOf('litter.crisp_packet');
    const ly = 2.6; // forward of the body centre, inside the suction rect (y 1.6 .. 2.8)
    const i = addLitter(world.litter, kind, v.xM, v.yM - ly, 0);
    stepBrushLitter(world.brush, world.litter, v, world.hopper, world.events);
    const speed = Math.hypot(world.litter.vx[i] as number, world.litter.vy[i] as number);
    expect(speed).toBeCloseTo(DEFAULT_TUNING.sweeping.suction.pullMps * 2 * v.rpm, 9);
    expect(speed).toBeCloseTo(6.0, 9);

    let on = 1;
    for (let t = 0; t < 700; t++) {
      world.step(neutral);
      if (world.brush.suctionMult === 2) on += 1;
    }
    expect(on).toBe(600);
    expect(world.brush.suctionMult).toBe(1);
    expect(world.brush.flingThresholdMps).toBeNull();
    expect(flingProbability(world.brush, tuning, 6.0)).toBe(1);
  });

  it('hi-vis: Doris yields and parts for 720 ticks, then the HiVis marks stop', () => {
    const world = townWorld();
    const doris = npcHandle(world.npc, addDoris(world, 52, 48));
    world.step(neutral);
    expect(world.npc.state[resolveNpcHandle(world.npc, doris)]).not.toBe(PED.Yield);
    dropUnderBessie(world, 'pwr.hi_vis');
    let marked = 0;
    let yielding = 0;
    for (let t = 0; t < 800; t++) {
      placeNpc(world, doris, 52, 48);
      world.step(neutral);
      const j = resolveNpcHandle(world.npc, doris);
      if (((world.npc.flags[j] as number) & NPC_FLAG.HI_VIS) !== 0) {
        marked += 1;
        expect(t).toBeLessThan(720);
      }
      if (t < 720 && world.npc.state[j] === PED.Yield) yielding += 1;
    }
    expect(marked).toBe(720);
    expect(yielding).toBeGreaterThan(0);
    expect(world.npc.state[resolveNpcHandle(world.npc, doris)]).not.toBe(PED.Fallen);
    expect(isHiVisActive(world)).toBe(false);
    expect(world.pickups.untilTick[kindOf('pwr.hi_vis')]).toBe(0);
  });

  it('runs different power-ups side by side; the HUD shows the one started last', () => {
    const world = townWorld();
    dropUnderBessie(world, 'pwr.flask_of_tea');
    world.step(neutral);
    for (let t = 0; t < 100; t++) world.step(neutral);
    dropUnderBessie(world, 'pwr.bacon_butty');
    world.step(neutral);
    expect(world.scoring.combo.refreshTicks).toBe(240);
    expect(world.vehicleParams.topSpeedMult).toBe(1.3);
    expect(shownPowerUp(world.pickups, world.tick)).toBe(kindOf('pwr.bacon_butty'));
    expect(powerUpTicksLeft(world.pickups, kindOf('pwr.bacon_butty'), world.tick)).toBe(599);
    expect(snapshotWorld(world).powerUps).toEqual([
      { id: 'pwr.flask_of_tea', ticksLeft: 798 },
      { id: 'pwr.bacon_butty', ticksLeft: 599 },
    ]);
    // When the butty ends the tea is shown again.
    for (let t = 0; t < 599; t++) world.step(neutral);
    expect(shownPowerUp(world.pickups, world.tick)).toBe(kindOf('pwr.flask_of_tea'));
    for (let t = 0; t < 199; t++) world.step(neutral);
    expect(shownPowerUp(world.pickups, world.tick)).toBe(-1);
  });
});

describe('instant effects', () => {
  it('wrench: 90 HP → 100 (capped), 60 → 85, and it clears the dented threshold from 30', () => {
    const world = townWorld();
    world.vehicle.hp = 90;
    applyPowerUp(world, kindOf('pwr.wrench'));
    expect(world.vehicle.hp).toBe(100);
    world.vehicle.hp = 60;
    applyPowerUp(world, kindOf('pwr.wrench'));
    expect(world.vehicle.hp).toBe(85);
    world.vehicle.hp = 30;
    dropUnderBessie(world, 'pwr.wrench');
    world.step(neutral);
    expect(world.vehicle.hp).toBe(55);
    expect(world.vehicle.hp).toBeGreaterThanOrEqual(SWEEPER.health.dentedBelowHp);
    expect(world.pickups.untilTick[kindOf('pwr.wrench')]).toBe(0);
  });

  it('water can: 80 → 100 with tank capacity 100, 20 → 70', () => {
    const world = townWorld();
    expect(world.water.tuning.tankUnits).toBe(100);
    world.vehicle.water = 80;
    applyPowerUp(world, kindOf('pwr.water_can'));
    expect(world.vehicle.water).toBe(100);
    world.vehicle.water = 20;
    dropUnderBessie(world, 'pwr.water_can');
    world.step(neutral);
    expect(world.vehicle.water).toBe(70);
  });
});

describe('determinism', () => {
  it('hashes the pickups and timers: a collected power-up changes the state hash', () => {
    const hashOf = (drop: boolean): number => {
      const world = townWorld();
      if (drop) dropUnderBessie(world, 'pwr.flask_of_tea');
      const hasher = createStateHasher(world.seed);
      for (let t = 0; t < 10; t++) {
        world.step(neutral);
        absorbTick(hasher, world);
      }
      return hasher.state[0] as number;
    };
    expect(hashOf(true)).toBe(hashOf(true));
    expect(hashOf(true)).not.toBe(hashOf(false));
  });
});

/** Add Doris at (x, y) as the spawner would: radius, walking speed and her behaviour's first state. */
function addDoris(world: World, x: number, y: number): number {
  const k = NPC_IDS.indexOf('npc.old_woman');
  const i = addNpcAt(world.npc, k, NpcOrigin.Ambient, x, y);
  if (i < 0) throw new Error('store full');
  world.npc.radius[i] = DEFAULT_TUNING.streetLife.npcRadius.humanM;
  world.npc.walkMps[i] = world.npcAi.spawner.speedByKind[k] as number;
  setNpcState(world.npc, i, world.npcAi.behaviours[k]?.initial ?? 0);
  return i;
}

/** Put NPC `handle` at (x, y) between ticks. */
function placeNpc(world: World, handle: number, x: number, y: number): void {
  const i = resolveNpcHandle(world.npc, handle);
  world.npc.x[i] = x;
  world.npc.y[i] = y;
  updateNpcCell(world.npc, i);
}
