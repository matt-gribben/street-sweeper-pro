// Knockable impulse bodies, phase 4 (src/sim/bodies.ts, world.ts; SSP-092, TECHNICAL_DESIGN §9.3,
// ENTITY_CATALOG §9.1). Levels are hand-built open arenas (tests/support/collisionWorld.ts) whose compiled
// `knockables` list places the props: prop.traffic_cone is not allowed in the Mon–Tue districts (L005), so no
// real level can hold every kind. Most tests use the committed tuning with Bessie's drag zeroed, so a speed set
// on her is the speed she hits with.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import tuningJson from '../../src/data/tuning.json' with { type: 'json' };
import {
  addBody,
  BODY_CAPACITY,
  BodyFlag,
  createBodyStore,
  knockableKindIndex,
  stepBodies,
} from '../../src/sim/bodies.ts';
import { createStaticGrid } from '../../src/sim/collision/grid.ts';
import { Offence } from '../../src/sim/complaints.ts';
import { DT_S, TILE_M } from '../../src/sim/constants.ts';
import { KNOCKABLE_IDS, type KnockableId, LITTER_IDS } from '../../src/sim/entities.ts';
import { countEvents, createEventQueue, EV, resetEvents } from '../../src/sim/eventQueue.ts';
import { createInputFrame } from '../../src/sim/inputFrame.ts';
import { createLitterField } from '../../src/sim/litter.ts';
import { COLLIDE, decodeLevel, type KnockableSpawn, type LevelProp } from '../../src/sim/map.ts';
import { createPenaltyLog } from '../../src/sim/penalties.ts';
import { createStream } from '../../src/sim/rng.ts';
import { DEFAULT_ENTITIES, DEFAULT_TUNING, loadTuning, type Tuning } from '../../src/sim/tuning.ts';
import { createVehicleState } from '../../src/sim/vehicle.ts';
import { createWorld, Phase, type World } from '../../src/sim/world.ts';
import { levelFromCollideGrid, worldFromCollideGrid } from '../support/collisionWorld.ts';

/** The committed tuning with Bessie's drag zeroed: a speed set on her is the speed she arrives with. */
const NO_DRAG: Tuning = (() => {
  const raw = structuredClone(tuningJson);
  raw.vehicle.sweeper.drag.rollingMps2 = 0;
  raw.vehicle.sweeper.drag.quadraticPerM = 0;
  return loadTuning(raw);
})();

const EAST = Math.PI / 2;
const KN = DEFAULT_TUNING.knockables;
const HALF_LEN = DEFAULT_TUNING.vehicle.sweeper.body.lengthM / 2;
const NEUTRAL = createInputFrame();

/** Arena size in tiles: 24 × 12 (48 × 24 m) of open road inside the map boundary. */
const W = 24;
const H = 12;

/** An open arena with `solidCols` full-height solid columns, Bessie at (x, 12) heading east. */
function arena(
  knockables: readonly KnockableSpawn[],
  opts: {
    playerX?: number;
    props?: readonly LevelProp[];
    solidCols?: readonly number[];
    tuning?: Tuning;
  } = {},
): World {
  const collide = new Uint8Array(W * H);
  for (const col of opts.solidCols ?? []) {
    for (let row = 0; row < H; row += 1) collide[row * W + col] = COLLIDE.SOLID;
  }
  return worldFromCollideGrid(
    {
      w: W,
      h: H,
      collide,
      player: { x: opts.playerX ?? 6, y: 12, heading: EAST },
      props: opts.props ?? [],
      ...(knockables.length > 0 ? { knockables } : {}),
    },
    opts.tuning ?? NO_DRAG,
  );
}

/** The world with a running ×2 chain that will not expire during the test, and a known score. */
function chained(world: World): World {
  const combo = world.scoring.combo;
  combo.chain = 12;
  combo.bestChain = 12;
  combo.multiplier = 2;
  combo.timerTicks = 100_000;
  world.scoring.score = 1_000;
  world.scoring.itemPts = 1_000;
  return world;
}

type Tally = { knocks: number; complaintsFiled: number; ticks: number };

/** Step `world` `ticks` times with Bessie held at `speedMps` (no input), counting EV.Knock. */
function drive(world: World, speedMps: number, ticks: number): Tally {
  const tally: Tally = { knocks: 0, complaintsFiled: 0, ticks: 0 };
  for (let t = 0; t < ticks; t += 1) {
    if (speedMps >= 0) world.vehicle.vLongMps = speedMps;
    world.step(NEUTRAL);
    tally.knocks += countEvents(world.events, EV.Knock);
    tally.complaintsFiled += countEvents(world.events, EV.Complaint);
    tally.ticks += 1;
  }
  return tally;
}

/** A knockable `id` 6 m ahead of Bessie's centre (her bumper is at 7.625 m; the body's face about 11.7 m). */
function ahead(id: KnockableId, x = 12, y = 12): KnockableSpawn {
  return { id, x, y };
}

describe('spawning from the compiled level (spawnKnockables)', () => {
  it('spawns level.knockables in file order, at rest, unknocked, heading 0', () => {
    const world = arena([ahead('prop.wheelie_bin', 20, 6), ahead('prop.traffic_cone', 30, 18)]);
    const b = world.bodies;
    expect(b.count).toBe(2);
    expect(Array.from(b.kind.subarray(0, 2))).toEqual([
      knockableKindIndex('prop.wheelie_bin'),
      knockableKindIndex('prop.traffic_cone'),
    ]);
    expect([b.x[0], b.y[0], b.heading[0], b.x[1], b.y[1]]).toEqual([20, 6, 0, 30, 18]);
    expect(b.flags[0]).toBe(0);
    expect(b.vx[0]).toBe(0);
    expect(world.level.knockables).toEqual([
      { id: 'prop.wheelie_bin', x: 20, y: 6 },
      { id: 'prop.traffic_cone', x: 30, y: 18 },
    ]);
  });

  it('a level without knockables has an empty store, and phase 4 does nothing', () => {
    const world = arena([]);
    expect(world.level.knockables).toBeNull();
    drive(world, 6, 10);
    expect(world.bodies.count).toBe(0);
  });

  it('pushes a body placed against a static prop clear of its footprint', () => {
    // A lamp post (circle r = 0.2 m) at (20, 6); the bin (0.6 × 0.75 m) centred 0.3 m east of it overlaps it.
    const world = arena([ahead('prop.wheelie_bin', 20.3, 6)], {
      props: [{ id: 'prop.lamp_post', x: 20, y: 6, rot: 0 }],
    });
    const b = world.bodies;
    // Pushed east until its west face (x − 0.3) clears the post (x = 20.2).
    expect(b.x[0] as number).toBeGreaterThanOrEqual(20.5 - 1e-9);
    expect(b.x[0] as number).toBeLessThan(20.51);
    expect(b.y[0]).toBe(6);
  });

  it('rejects a non-knockable id and more than the 128-body capacity', () => {
    const level = levelFromCollideGrid({
      w: W,
      h: H,
      collide: new Uint8Array(W * H),
      player: { x: 6, y: 12, heading: EAST },
    });
    level.knockables = [{ id: 'prop.bollard', x: 10, y: 10 }];
    expect(() => createWorld(level, 1, DEFAULT_TUNING)).toThrow(/prop\.bollard is not a knockable prop/);
    level.knockables = [];
    for (let i = 0; i <= BODY_CAPACITY; i += 1) {
      level.knockables.push({ id: 'prop.traffic_cone', x: 2 + (i % 20) * 2, y: 2 + Math.floor(i / 20) * 3 });
    }
    expect(() => createWorld(level, 1, DEFAULT_TUNING)).toThrow(/knockable 129 exceeds .* capacity of 128/);
  });
});

describe('knocks: penalties, spills and the combo chain (ENTITY_CATALOG §9.1)', () => {
  it('a wheelie bin costs −50, resets the chain and spills exactly 4 items; a second hit spills and costs nothing', () => {
    const world = chained(arena([ahead('prop.wheelie_bin')]));
    const spawned0 = world.litter.litterSpawned;
    // Watch phase 9 for the knock's penalty fact.
    const facts: { reason: number; pts: number; complaints: number }[] = [];
    world.phaseTrace = (phase) => {
      if (phase !== Phase.Scoring) return;
      const p = world.penalties;
      for (let i = 0; i < p.count; i += 1) {
        facts.push({
          reason: p.reason[i] as number,
          pts: p.pts[i] as number,
          complaints: p.complaints[i] as number,
        });
      }
    };
    let tally = { knocks: 0, complaintsFiled: 0, ticks: 0 };
    while (world.bodies.flags[0] === 0) {
      tally = drive(world, 6, 1);
      expect(world.tick).toBeLessThan(120);
    }
    expect(tally.knocks).toBe(1);
    expect(facts).toEqual([{ reason: Offence.Knock, pts: -50, complaints: 0 }]);
    expect(world.scoring.penaltyPts).toBe(-50);
    expect(world.scoring.score).toBe(950);
    expect(world.scoring.combo.chain).toBe(0);
    expect(world.litter.litterSpawned - spawned0).toBe(4);
    expect(world.bodies.itemsSpilled).toBe(4);
    expect(world.bodies.bodiesKnocked).toBe(1);
    expect(world.complaints.count).toBe(0); // points only: no complaint
    expect(tally.complaintsFiled).toBe(0);

    // Bessie stops; the bin slides away and comes to rest. Rebuild a chain, then drive into it again.
    world.vehicle.vLongMps = 0;
    for (let t = 0; t < 180; t += 1) world.step(NEUTRAL);
    expect(world.bodies.vx[0]).toBe(0);
    expect(world.bodies.flags[0]).toBe(BodyFlag.Knocked); // the episode has ended (re-armed)
    chained(world);
    const knocksBefore = world.bodies.knocks;
    let second = 0;
    for (let t = 0; t < 240 && second === 0; t += 1) second += drive(world, 6, 1).knocks;
    expect(second).toBe(1);
    expect(world.bodies.knocks).toBe(knocksBefore + 1);
    expect(world.litter.litterSpawned - spawned0).toBe(4);
    expect(world.scoring.penaltyPts).toBe(-50);
    expect(world.scoring.combo.chain).toBe(12);
    expect(facts.length).toBe(1);
  });

  const cases: readonly { id: KnockableId; pts: number; spills: number; resets: boolean }[] = [
    { id: 'prop.recycling_box', pts: -25, spills: 2, resets: true },
    { id: 'prop.a_board', pts: -25, spills: 0, resets: true },
    { id: 'prop.traffic_cone', pts: 0, spills: 0, resets: false },
    { id: 'prop.shopping_trolley', pts: 0, spills: 0, resets: false },
  ];
  it.each(cases)(
    '$id costs $pts, spills $spills and resets the chain: $resets',
    ({ id, pts, spills, resets }) => {
      const world = chained(arena([ahead(id)]));
      const spawned0 = world.litter.litterSpawned;
      let knocks = 0;
      for (let t = 0; t < 120 && knocks === 0; t += 1) knocks += drive(world, 6, 1).knocks;
      expect(knocks).toBe(1);
      // One more tick for anything that lands later (it must not).
      drive(world, 6, 1);
      expect(world.scoring.penaltyPts).toBe(pts);
      expect(world.bodies.penaltyPts).toBe(pts);
      expect(world.litter.litterSpawned - spawned0).toBe(spills);
      expect(world.scoring.combo.chain).toBe(resets ? 0 : 12);
      expect(world.complaints.count).toBe(0);
    },
  );

  it('EV.Knock carries the body index, the contact point on Bessie’s bumper and the kind', () => {
    const world = arena([ahead('prop.traffic_cone', 30, 6), ahead('prop.shopping_trolley')]);
    for (let t = 0; t < 120; t += 1) {
      world.vehicle.vLongMps = 6;
      world.step(NEUTRAL);
      const ev = world.events;
      for (let e = 0; e < ev.count; e += 1) {
        if (ev.type[e] !== EV.Knock) continue;
        expect(ev.entity[e]).toBe(1);
        expect(ev.c[e]).toBe(KNOCKABLE_IDS.indexOf('prop.shopping_trolley'));
        // The trolley's west face meets her front face: the point lies on both, across the trolley's width.
        expect(ev.a[e] as number).toBeGreaterThan(world.vehicle.xM + HALF_LEN - 0.3);
        expect(ev.a[e] as number).toBeLessThan(world.vehicle.xM + HALF_LEN + 0.01);
        expect(Math.abs((ev.b[e] as number) - 12)).toBeLessThanOrEqual(0.55 / 2 + 1e-9);
        return;
      }
    }
    throw new Error('no EV.Knock in 120 ticks');
  });

  it('spills the district small-litter table (Puddle Lane), worth normal points, counted in litter spawned', () => {
    const level = decodeLevel(
      readFileSync(
        fileURLToPath(new URL('../../public/assets/levels/puddle_lane.json', import.meta.url)),
        'utf8',
      ),
    );
    // A bin in the road 5 m ahead of Bessie's depot start, on her heading.
    const { x, y, heading } = level.player;
    const fx = Math.sin(heading);
    const fy = -Math.cos(heading);
    level.knockables = [{ id: 'prop.wheelie_bin', x: x + fx * 5, y: y + fy * 5 }];
    const allowed = new Set([
      'litter.cigarette_butts',
      'litter.crisp_packet',
      'litter.drink_can',
      'litter.newspaper',
      'litter.plastic_bottle',
    ]);
    const kinds: string[] = [];
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const world = createWorld(level, seed, NO_DRAG);
      const before = world.litter.count;
      const spawned = world.litter.litterSpawned;
      for (let t = 0; t < 120 && world.bodies.bodiesKnocked === 0; t += 1) {
        world.vehicle.vLongMps = 4;
        world.step(NEUTRAL);
      }
      expect(world.bodies.bodiesKnocked).toBe(1);
      expect(world.litter.litterSpawned - spawned).toBe(4);
      for (let i = before; i < before + 4; i += 1)
        kinds.push(LITTER_IDS[world.litter.kind[i] as number] as string);
    }
    // Only small table kinds (≤ 1 LU, no brush-up rule): never the dog mess, which the table also holds.
    for (const k of kinds) expect(allowed.has(k), k).toBe(true);
    expect(new Set(kinds).size).toBeGreaterThan(2);
  });

  it('lands spilled items in a fan away from Bessie, or at the body centre where that point is solid', () => {
    const world = arena([ahead('prop.wheelie_bin')]);
    const n0 = world.litter.count;
    let tick = 0;
    for (; tick < 120 && world.bodies.bodiesKnocked === 0; tick += 1) drive(world, 6, 1);
    const prevX = world.bodies.prevX[0] as number;
    for (let i = n0; i < n0 + 4; i += 1) {
      const dx = (world.litter.x[i] as number) - prevX;
      const dy = (world.litter.y[i] as number) - 12;
      // Head-on: the normal is +x (away from Bessie). nearM + [0, depthM) along it, ±halfWidthM across.
      expect(dx).toBeGreaterThanOrEqual(KN.spill.nearM - 1e-9);
      expect(dx).toBeLessThan(KN.spill.nearM + KN.spill.depthM);
      expect(Math.abs(dy)).toBeLessThanOrEqual(KN.spill.halfWidthM);
    }
    // A bin hard against a solid column: the fan points into it, so every item lands at the bin's centre.
    const walled = arena([ahead('prop.wheelie_bin', 11.7, 12)], { solidCols: [6] });
    const m0 = walled.litter.count;
    for (let t = 0; t < 120 && walled.bodies.bodiesKnocked === 0; t += 1) drive(walled, 6, 1);
    expect(walled.litter.count - m0).toBe(4);
    for (let i = m0; i < m0 + 4; i += 1) {
      const lx = walled.litter.x[i] as number;
      expect(Math.floor(lx / TILE_M)).toBeLessThan(6);
    }
  });
});

describe('Bessie is the infinite-mass mover', () => {
  it('loses under 5% of her speed hitting a 30 kg bin at 6 m/s, and keeps her HP', () => {
    const world = arena([ahead('prop.wheelie_bin')]);
    const hp0 = world.vehicle.hp;
    world.vehicle.vLongMps = 6;
    let hit = -1;
    for (let t = 0; t < 120; t += 1) {
      world.step(NEUTRAL); // no input: with drag zeroed she coasts at 6 m/s unless something slows her
      if (hit < 0 && world.bodies.bodiesKnocked === 1) hit = t;
      if (hit >= 0 && t > hit + 30) break;
    }
    expect(hit).toBeGreaterThan(0);
    const loss = (6 - world.vehicle.vLongMps) / 6;
    expect(loss).toBeLessThan(0.05);
    expect(loss).toBe(0);
    expect(world.vehicle.hp).toBe(hp0);
    expect(countEvents(world.events, EV.Impact)).toBe(0);
    // The bin left at (1 + bessieRestitution) × her speed, then friction slowed it.
    expect(world.bodies.vx[0] as number).toBeGreaterThan(0);
  });

  it('a head-on hit sends the body off at (1 + bessieRestitution) × her speed, without spin', () => {
    const world = arena([ahead('prop.wheelie_bin')]);
    let v = 0;
    for (let t = 0; t < 120 && v === 0; t += 1) {
      world.vehicle.vLongMps = 6;
      world.step(NEUTRAL);
      v = world.bodies.vx[0] as number;
    }
    // After the hit tick's friction step.
    const expected =
      (1 + KN.contact.bessieRestitution) * 6 - KN.bodies['prop.wheelie_bin'].frictionMps2 * DT_S;
    expect(v).toBeCloseTo(expected, 9);
    // Her heading is π/2, whose cosine is 6e-17, not 0: her velocity has a sub-femtometre y part.
    expect(world.bodies.vy[0] as number).toBeCloseTo(0, 12);
    expect(world.bodies.omega[0] as number).toBeCloseTo(0, 12);
  });

  it('an off-centre hit spins the body; phase 4 never writes Bessie', () => {
    // The cone sits under her left front corner (y 12 − 0.875).
    const world = arena([ahead('prop.traffic_cone', 12, 12 - 0.8)]);
    let spun = false;
    for (let t = 0; t < 120 && !spun; t += 1) {
      world.vehicle.vLongMps = 6;
      let during = '';
      world.phaseTrace = (phase) => {
        if (phase === Phase.Bodies) during = JSON.stringify(world.vehicle);
        if (phase === Phase.BrushLitter) expect(JSON.stringify(world.vehicle)).toBe(during);
      };
      world.step(NEUTRAL);
      spun = (world.bodies.omega[0] as number) !== 0;
    }
    expect(spun).toBe(true);
  });
});

describe('body physics', () => {
  /** A bare store over a 12 × 12 open grid (with an optional solid column), for driving bodies directly. */
  function bareStore(opts: { solidCol?: number; props?: readonly LevelProp[] } = {}) {
    const collide = new Uint8Array(12 * 12);
    if (opts.solidCol !== undefined)
      for (let r = 0; r < 12; r += 1) collide[r * 12 + opts.solidCol] = COLLIDE.SOLID;
    const level = levelFromCollideGrid({
      w: 12,
      h: 12,
      collide,
      player: { x: 2, y: 2, heading: 0 },
      props: opts.props ?? [],
    });
    const grid = createStaticGrid(level, DEFAULT_TUNING.propFootprints);
    const litter = createLitterField(level, DEFAULT_TUNING, DEFAULT_ENTITIES);
    const hazardsSpill = {
      count: 1,
      kind: new Uint8Array([0]),
      weight: new Float64Array([1]),
      lu: new Float64Array([1]),
      total: 1,
      minLu: 1,
    };
    const store = createBodyStore(
      DEFAULT_ENTITIES,
      DEFAULT_TUNING,
      grid,
      hazardsSpill,
      createStream(1, 'events'),
    );
    // Bessie parked far away, in a corner.
    const vehicle = createVehicleState(DEFAULT_TUNING.vehicle.sweeper, 2, 2, 0);
    const events = createEventQueue();
    const penalties = createPenaltyLog();
    const step = (): void => {
      resetEvents(events, 0);
      stepBodies(store, grid, vehicle, DEFAULT_TUNING.vehicle.sweeper, litter, penalties, events);
    };
    return { store, grid, step, events, level };
  }

  it('friction brings a sliding body to rest exactly, after about v² / 2a', () => {
    const { store, step } = bareStore();
    const i = addBody(store, knockableKindIndex('prop.shopping_trolley'), 6, 12, 0);
    store.vx[i] = 4;
    let ticks = 0;
    while ((store.vx[i] as number) !== 0) {
      step();
      ticks += 1;
      expect(ticks).toBeLessThan(600);
    }
    const a = KN.bodies['prop.shopping_trolley'].frictionMps2;
    // 4 / (a · dt) = 96 ticks, give or take the float rounding of the last step.
    expect(Math.abs(ticks - 4 / (a * DT_S))).toBeLessThanOrEqual(1);
    expect((store.x[i] as number) - 6).toBeCloseTo((4 * 4) / (2 * a), 1);
    step();
    expect(store.x[i]).toBe(store.prevX[i]); // asleep
  });

  it('bounces off a wall with staticRestitution and never ends inside it', () => {
    const { store, step } = bareStore({ solidCol: 8 }); // wall face x = 16 m
    const i = addBody(store, knockableKindIndex('prop.traffic_cone'), 14, 12, 0);
    store.vx[i] = 10;
    let bounced = false;
    for (let t = 0; t < 60; t += 1) {
      const before = store.vx[i] as number;
      step();
      expect((store.x[i] as number) + 0.2).toBeLessThanOrEqual(16 + 1e-6);
      if (!bounced && (store.vx[i] as number) < 0) {
        bounced = true;
        // Head-on, no spin: the normal speed reflects to e × the incoming one, less this tick's friction.
        const fr = KN.bodies['prop.traffic_cone'].frictionMps2 * DT_S;
        expect(store.vx[i] as number).toBeCloseTo(-KN.contact.staticRestitution * before + fr, 9);
      }
    }
    expect(bounced).toBe(true);
  });

  it('a cone sliding into a resting bin passes it momentum by mass: the bin moves, slower than the cone was', () => {
    const { store, step } = bareStore();
    const cone = addBody(store, knockableKindIndex('prop.traffic_cone'), 8, 12, 0);
    const bin = addBody(store, knockableKindIndex('prop.wheelie_bin'), 10, 12, 0);
    store.vx[cone] = 8;
    let touched = false;
    for (let t = 0; t < 60 && !touched; t += 1) {
      const pCone = 2 * (store.vx[cone] as number);
      step();
      if ((store.vx[bin] as number) > 0) {
        touched = true;
        // Momentum along x is conserved by the impulse (friction aside, this tick's step).
        const p = 2 * (store.vx[cone] as number) + 30 * (store.vx[bin] as number);
        const frictionLoss =
          2 * KN.bodies['prop.traffic_cone'].frictionMps2 * DT_S +
          30 * KN.bodies['prop.wheelie_bin'].frictionMps2 * DT_S;
        expect(p).toBeLessThanOrEqual(pCone + 1e-9);
        expect(p).toBeGreaterThan(pCone - frictionLoss - 1e-9);
        expect(store.vx[bin] as number).toBeLessThan(1);
      }
    }
    expect(touched).toBe(true);
    expect(store.bodiesKnocked).toBe(0); // only Bessie knocks a body
  });

  it('sub-steps at half the smallest extent, capped by the thin-prop step', () => {
    const open = bareStore().store;
    expect(open.kinds.stepM[knockableKindIndex('prop.traffic_cone')]).toBe(0.2);
    expect(open.kinds.stepM[knockableKindIndex('prop.wheelie_bin')]).toBe(0.3);
    const withBollard = bareStore({ props: [{ id: 'prop.bollard', x: 20, y: 20, rot: 0 }] }).store;
    expect(withBollard.kinds.stepM[knockableKindIndex('prop.traffic_cone')]).toBe(0.15);
  });

  it('a fast cone thrown straight at a bollard bounces off it', () => {
    const { store, step } = bareStore({ props: [{ id: 'prop.bollard', x: 16, y: 12, rot: 0 }] });
    const i = addBody(store, knockableKindIndex('prop.traffic_cone'), 13, 12, 0);
    store.vx[i] = 20.64; // (1 + 0.2) × 17.2 m/s
    for (let t = 0; t < 30; t += 1) {
      step();
      expect(store.x[i] as number).toBeLessThan(16 - 0.15 - 0.2 + 1e-6);
    }
    expect(store.vx[i] as number).toBeLessThan(0);
  });
});

describe('determinism', () => {
  it('two runs of the same seed and inputs give identical bodies and spills', () => {
    const run = (): number[] => {
      const world = arena([
        ahead('prop.wheelie_bin'),
        ahead('prop.recycling_box', 14, 13),
        ahead('prop.traffic_cone', 13, 10.8),
      ]);
      drive(world, 7, 150);
      const b = world.bodies;
      const out: number[] = [];
      for (let i = 0; i < b.count; i += 1)
        out.push(b.x[i] as number, b.y[i] as number, b.heading[i] as number, b.flags[i] as number);
      for (let i = 0; i < world.litter.count; i += 1)
        out.push(world.litter.x[i] as number, world.litter.y[i] as number, world.litter.kind[i] as number);
      return out;
    };
    const a = run();
    expect(run()).toEqual(a);
    expect(a.length).toBeGreaterThan(12);
  });
});
