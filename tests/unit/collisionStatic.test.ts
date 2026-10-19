// Phase 3, Bessie vs the static world (src/sim/collision/grid.ts, resolveStatic.ts, world.ts phases 3 and 10;
// SSP-036, TECHNICAL_DESIGN §9.1–§9.2, GDD §7.2). Levels are hand-built with createBlankLevel and merged
// with mergeSolids, exactly as the compiler does. Most tests use the committed tuning with drag zeroed, so a
// speed set on Bessie is the speed she hits with.
import { describe, expect, it } from 'vitest';
import tuningJson from '../../src/data/tuning.json' with { type: 'json' };
import {
  BOUNDARY_TILES,
  createStaticGrid,
  isSolidCell,
  queryStatic,
  rectOpenMask,
  ShapeKind,
  ShapeSource,
} from '../../src/sim/collision/grid.ts';
import { createObb, obbAabb, obbCorners, setObb } from '../../src/sim/collision/obb.ts';
import {
  CONTACT_LOG_CAPACITY,
  createStaticResolver,
  impactDamage,
  MAX_RESOLVE_ITERATIONS,
  resolveStatic,
} from '../../src/sim/collision/resolveStatic.ts';
import {
  createCircle,
  createContact,
  obbVsCircle,
  obbVsCircleShape,
  obbVsObb,
  obbVsRect,
  obbVsRectMasked,
  RECT_OPEN,
  RECT_OPEN_ALL,
} from '../../src/sim/collision/sat.ts';
import {
  createPose,
  createSweep,
  subStepCount,
  subStepPose,
  sweepPose,
  sweepStepCount,
} from '../../src/sim/collision/sweep.ts';
import { TILE_M } from '../../src/sim/constants.ts';
import { countEvents, createEventQueue, EV, resetEvents, ShiftEndReason } from '../../src/sim/eventQueue.ts';
import { createInputFrame, type InputFrame, STEER_MAX, THROTTLE_MAX } from '../../src/sim/inputFrame.ts';
import { COLLIDE, createBlankLevel, type Level, type LevelProp, mergeSolids } from '../../src/sim/map.ts';
import { nextInt, sfc32 } from '../../src/sim/rng.ts';
import { DEFAULT_TUNING, loadTuning, type Tuning } from '../../src/sim/tuning.ts';
import { createVehicleParams, createVehicleState } from '../../src/sim/vehicle.ts';
import { createWorld, Phase, stepWorld, type World } from '../../src/sim/world.ts';
import { assertHeapDeltaWithinThresholds, measureHeapDelta } from '../support/heapDelta.ts';

const sweeper = DEFAULT_TUNING.vehicle.sweeper;
const HW = sweeper.body.widthM / 2; // 0.875
const HL = sweeper.body.lengthM / 2; // 1.625
const EAST = Math.PI / 2;
const NORTH = 0;
const EPS = 1e-9;

function frame(throttle: number, brake: number, steer: number): InputFrame {
  const input = createInputFrame();
  input.throttle = throttle;
  input.brake = brake;
  input.steer = steer;
  return input;
}

const NEUTRAL = frame(0, 0, 0);

/** The committed tuning with both drag terms zeroed: Bessie keeps whatever speed a test gives her. */
function noDrag(): Tuning {
  const raw = structuredClone(tuningJson);
  raw.vehicle.sweeper.drag.rollingMps2 = 0;
  raw.vehicle.sweeper.drag.quadraticPerM = 0;
  return loadTuning(raw);
}

/** A w × h tile level whose SOLID cells are where `solid(col, row)` holds, merged like the compiler does. */
function level(
  w: number,
  h: number,
  solid: (col: number, row: number) => boolean,
  player: { x: number; y: number; heading: number },
  props: LevelProp[] = [],
): Level {
  const lvl = createBlankLevel('test.collision', w, h);
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) if (solid(col, row)) lvl.layers.collide[row * w + col] = COLLIDE.SOLID;
  }
  lvl.solids = mergeSolids(lvl.layers.collide, w, h);
  lvl.props = props;
  lvl.player = player;
  return lvl;
}

/** World velocity of Bessie (body frame vLong/vLat → x, y). forward = (sin θ, −cos θ), right = (cos θ, sin θ). */
function worldVelocity(world: World): { x: number; y: number } {
  const v = world.vehicle;
  const s = Math.sin(v.headingRad);
  const c = Math.cos(v.headingRad);
  return { x: s * v.vLongMps + c * v.vLatMps, y: -c * v.vLongMps + s * v.vLatMps };
}

/** Step until a tick emits EV.Impact (asserting earlier ticks emit nothing); returns that tick's events. */
function stepToImpact(world: World, input: InputFrame, maxTicks: number): void {
  for (let i = 0; i < maxTicks; i++) {
    world.step(input);
    if (countEvents(world.events, EV.Impact) > 0) return;
  }
  throw new Error(`no impact within ${maxTicks} ticks`);
}

/** Deepest overlap of Bessie's OBB with any of the level's solid rects (plain SAT), metres; 0 when clear. */
function maxSolidPenetration(world: World): number {
  const v = world.vehicle;
  const obb = setObb(createObb(), v.xM, v.yM, v.headingRad, HW, HL);
  const c = createContact();
  let worst = 0;
  for (const [x0, y0, x1, y1] of world.level.solids) {
    if (obbVsRect(obb, x0 * TILE_M, y0 * TILE_M, x1 * TILE_M, y1 * TILE_M, c))
      worst = Math.max(worst, c.depthM);
  }
  return worst;
}

/** A 20 × 10 tile level with a solid wall in column 15 (x 30–32 m); Bessie faces it from the west at y = 10. */
function eastWall(frontGapM = 0.05): Level {
  return level(20, 10, (col) => col === 15, { x: 30 - HL - frontGapM, y: 10, heading: EAST });
}

describe('impact damage (GDD §7.2, ROADMAP VS-2)', () => {
  const { damageHpPerMps, damageThresholdMps } = sweeper.collision;
  it.each([
    [11, 36],
    [6, 16],
    [4, 8],
    [2, 0],
    [1, 0],
    [0, 0],
  ])('the formula at %d m/s costs %d HP', (vn, hp) => {
    expect(impactDamage(vn, damageHpPerMps, damageThresholdMps, 1)).toBeCloseTo(hp, 12);
  });

  it('with damageMult 0.6 (upg.bumper), 11 m/s costs 21.6 HP', () => {
    expect(impactDamage(11, damageHpPerMps, damageThresholdMps, 0.6)).toBeCloseTo(21.6, 12);
  });

  it.each([
    [11, 36],
    [6, 16],
    [4, 8],
    [2, 0],
  ])('a head-on wall hit in the World at %d m/s costs %d HP and reports vn', (speed, hp) => {
    const world = createWorld(eastWall(), 1, noDrag());
    world.vehicle.vLongMps = speed;
    stepToImpact(world, NEUTRAL, 120);
    expect(countEvents(world.events, EV.Impact)).toBe(1);
    expect(world.events.c[0]).toBeCloseTo(speed, 9);
    expect(sweeper.health.maxHp - world.vehicle.hp).toBeCloseTo(hp, 9);
  });

  it('a 6 m/s hit on a lamp post (circle footprint) costs 16 HP', () => {
    const r = DEFAULT_TUNING.propFootprints.shapes['prop.lamp_post'];
    expect(r.shape).toBe('circle');
    const radius = r.shape === 'circle' ? r.radiusM : 0;
    const lamp: LevelProp = { id: 'prop.lamp_post', x: 30, y: 10, rot: 0 };
    const lvl = level(20, 10, () => false, { x: 30 - radius - HL - 0.05, y: 10, heading: EAST }, [lamp]);
    const world = createWorld(lvl, 1, noDrag());
    world.vehicle.vLongMps = 6;
    stepToImpact(world, NEUTRAL, 120);
    expect(world.events.c[0]).toBeCloseTo(6, 9);
    expect(sweeper.health.maxHp - world.vehicle.hp).toBeCloseTo(16, 9);
    // The contact point is the front of the post.
    expect(world.events.a[0]).toBeCloseTo(30 - radius, 9);
    expect(world.events.b[0]).toBeCloseTo(10, 9);
  });

  it('with params.damageMult 0.6, an 11 m/s head-on hit costs 21.6 HP', () => {
    const world = createWorld(eastWall(), 1, noDrag());
    world.vehicleParams.damageMult = 0.6;
    world.vehicle.vLongMps = 11;
    stepToImpact(world, NEUTRAL, 120);
    expect(sweeper.health.maxHp - world.vehicle.hp).toBeCloseTo(21.6, 9);
  });

  it('a box-footprint prop (bench, OBB vs OBB) blocks and damages like a wall', () => {
    const bench: LevelProp = { id: 'prop.bench', x: 30, y: 10, rot: 0 };
    const fp = DEFAULT_TUNING.propFootprints.shapes['prop.bench'];
    const halfW = fp.shape === 'box' ? fp.widthM / 2 : 0;
    const lvl = level(20, 10, () => false, { x: 30 - halfW - HL - 0.05, y: 10, heading: EAST }, [bench]);
    const world = createWorld(lvl, 1, noDrag());
    world.vehicle.vLongMps = 6;
    stepToImpact(world, NEUTRAL, 120);
    expect(sweeper.health.maxHp - world.vehicle.hp).toBeCloseTo(16, 9);
    const log = world.staticResolver.log;
    expect(log.count).toBe(1);
    expect(log.normalX[0]).toBeCloseTo(-1, 9);
    expect(Math.abs(log.normalY[0] ?? 1)).toBeLessThan(EPS);
    expect(world.vehicle.xM + HL).toBeLessThanOrEqual(30 - halfW + EPS);
  });
});

describe('restitution 0.2 (TECHNICAL_DESIGN §9.2 step 5)', () => {
  it('head-on: vLong reverses to −0.2 × the incoming speed and Bessie ends exactly touching', () => {
    const world = createWorld(eastWall(), 1, noDrag());
    world.vehicle.vLongMps = 11;
    stepToImpact(world, NEUTRAL, 120);
    expect(world.vehicle.vLongMps).toBeCloseTo(-2.2, 9);
    expect(Math.abs(world.vehicle.vLatMps)).toBeLessThan(EPS);
    expect(Math.abs(world.vehicle.xM + HL - 30)).toBeLessThan(EPS);
    // The contact point is on the wall face, in the middle of the bumper.
    expect(world.events.a[0]).toBeCloseTo(30, 9);
    expect(world.events.b[0]).toBeCloseTo(10, 9);
  });

  it.each([
    [EAST - 0.6, 8, 0.7],
    [EAST + 0.9, 5, -1.1],
    [EAST - 0.2, 10.5, 0],
  ])(
    'oblique (heading %f, vLong %f, vLat %f): outgoing vn = 0.2 × incoming ± 1e-9, tangential speed kept',
    (heading, vLong, vLat) => {
      const lvl = level(20, 10, (col) => col === 15, { x: 26, y: 10, heading });
      const world = createWorld(lvl, 1, noDrag());
      world.vehicle.vLongMps = vLong;
      world.vehicle.vLatMps = vLat;
      let before = { x: 0, y: 0 };
      let after = { x: 0, y: 0 };
      world.phaseTrace = (phase) => {
        if (phase === Phase.StaticCollision) before = worldVelocity(world);
        if (phase === Phase.Bodies) after = worldVelocity(world);
      };
      stepToImpact(world, NEUTRAL, 240);
      const log = world.staticResolver.log;
      expect(log.count).toBe(1);
      const nx = log.normalX[0] ?? 0;
      const ny = log.normalY[0] ?? 0;
      expect(nx).toBe(-1); // the wall's outward normal
      expect(ny).toBe(0);
      const vnIn = -(before.x * nx + before.y * ny);
      const vnOut = after.x * nx + after.y * ny;
      expect(vnIn).toBeGreaterThan(0);
      expect(Math.abs(vnOut - 0.2 * vnIn)).toBeLessThanOrEqual(EPS);
      const tBefore = -before.x * ny + before.y * nx;
      const tAfter = -after.x * ny + after.y * nx;
      expect(Math.abs(tAfter - tBefore)).toBeLessThanOrEqual(EPS);
      expect(world.events.c[0]).toBeCloseTo(vnIn, 12);
    },
  );
});

describe('corners and resolution', () => {
  /** Two merged rects meeting at an inside corner at (32, 4) m: a north wall and an east wall. */
  function insideCorner(): Level {
    return level(20, 20, (col, row) => row <= 1 || col >= 16, { x: 20, y: 16, heading: Math.PI / 4 });
  }

  it('the L merges into exactly two rects', () => {
    expect(insideCorner().solids).toEqual([
      [0, 0, 20, 2],
      [16, 2, 20, 20],
    ]);
  });

  it('driving into an inside corner of two merged rects ends every tick with penetration ≤ 1 mm', () => {
    const world = createWorld(insideCorner(), 1, DEFAULT_TUNING);
    const full = frame(THROTTLE_MAX, 0, 0);
    let impacts = 0;
    let twoWallTicks = 0;
    for (let i = 0; i < 600; i++) {
      world.step(full);
      expect(maxSolidPenetration(world), `tick ${i}`).toBeLessThanOrEqual(1e-3);
      impacts += countEvents(world.events, EV.Impact);
      const log = world.staticResolver.log;
      let north = false;
      let west = false;
      for (let k = 0; k < log.count; k++) {
        if (log.normalY[k] === 1) north = true;
        if (log.normalX[k] === -1) west = true;
      }
      if (north && west) twoWallTicks += 1;
    }
    expect(impacts).toBeGreaterThan(0);
    expect(twoWallTicks).toBeGreaterThan(0); // both walls resolved in the same tick at least once
    // Bessie ends wedged in the corner.
    const v = world.vehicle;
    const obb = setObb(createObb(), v.xM, v.yM, v.headingRad, HW, HL);
    const box = obbAabb(obb, { minX: 0, minY: 0, maxX: 0, maxY: 0 });
    expect(box.maxX).toBeGreaterThan(31.9);
    expect(box.minY).toBeLessThan(4.1);
  });

  it('each resolved approaching contact emits exactly one EV.Impact carrying vn, x and y', () => {
    const world = createWorld(insideCorner(), 1, DEFAULT_TUNING);
    const full = frame(THROTTLE_MAX, 0, 0);
    let approaching = 0;
    for (let i = 0; i < 600; i++) {
      world.step(full);
      const log = world.staticResolver.log;
      const q = world.events;
      let e = 0;
      for (let k = 0; k < log.count; k++) {
        if (!((log.vnMps[k] ?? 0) > 0)) continue;
        approaching += 1;
        while (e < q.count && q.type[e] !== EV.Impact) e += 1;
        expect(e, `tick ${i}: impact for contact ${k}`).toBeLessThan(q.count);
        expect(q.entity[e]).toBe(-1);
        expect(q.a[e]).toBe(log.x[k]);
        expect(q.b[e]).toBe(log.y[k]);
        expect(q.c[e]).toBe(log.vnMps[k]);
        e += 1;
      }
      let impacts = 0;
      for (let k = 0; k < log.count; k++) if ((log.vnMps[k] ?? 0) > 0) impacts += 1;
      expect(countEvents(q, EV.Impact)).toBe(impacts);
    }
    expect(approaching).toBeGreaterThan(0);
  });

  it('a separating contact is pushed out with no event, no damage and no velocity change', () => {
    const world = createWorld(eastWall(-0.3), 1, noDrag()); // spawned 0.3 m inside the wall
    world.vehicle.vLongMps = -1; // backing away
    world.step(NEUTRAL);
    expect(countEvents(world.events, EV.Impact)).toBe(0);
    expect(world.vehicle.hp).toBe(sweeper.health.maxHp);
    expect(world.vehicle.vLongMps).toBe(-1);
    expect(world.staticResolver.log.count).toBe(1);
    expect(world.staticResolver.log.vnMps[0]).toBeLessThan(0);
    expect(maxSolidPenetration(world)).toBeLessThanOrEqual(EPS);
  });

  it('resolving an already resolved pose changes nothing', () => {
    const world = createWorld(eastWall(), 1, noDrag());
    world.vehicle.vLongMps = 6;
    stepToImpact(world, NEUTRAL, 120);
    world.vehicle.vLongMps = 0;
    world.vehicle.vLatMps = 0;
    const x = world.vehicle.xM;
    world.step(NEUTRAL);
    expect(Math.abs(world.vehicle.xM - x)).toBeLessThan(1e-9);
    expect(world.events.count).toBe(0);
  });

  it('sub-steps a move longer than 1 m, so a teleport-sized step cannot tunnel through a 1-tile wall', () => {
    const lvl = level(30, 10, (col) => col === 10, { x: 16, y: 10, heading: EAST }); // wall x 20–22 m
    const tuning = noDrag();
    const grid = createStaticGrid(lvl, tuning.propFootprints);
    const resolver = createStaticResolver();
    const v = createVehicleState(tuning.vehicle.sweeper, 16, 10, EAST);
    const params = createVehicleParams(tuning.vehicle.sweeper, 100);
    // The end pose is 8.5 m on, clear of the wall on its far side (rear bumper at 22.875 m).
    v.xM = 24.5;
    v.vLongMps = 8.5 * 60;
    const q = createEventQueue();
    resetEvents(q, 0);
    resolveStatic(grid, resolver, v, params, q);
    expect(Math.abs(v.xM - (20 - HL))).toBeLessThan(EPS);
    expect(countEvents(q, EV.Impact)).toBe(1);
    expect(v.hp).toBe(0);
  });

  it('caps the MTV loop at 4 iterations per sub-step and the log at its capacity', () => {
    expect(MAX_RESOLVE_ITERATIONS).toBe(4);
    expect(CONTACT_LOG_CAPACITY).toBeGreaterThanOrEqual(MAX_RESOLVE_ITERATIONS);
  });
});

describe('TOWED stub (TECHNICAL_DESIGN §9.2 step 6)', () => {
  it('HP reaching 0 emits a single EV.ShiftEnd (TOWED); further impacts keep HP at 0 and emit no ShiftEnd', () => {
    const world = createWorld(eastWall(), 1, noDrag());
    world.vehicle.hp = 36; // exactly one 11 m/s hit
    world.vehicle.vLongMps = 11;
    stepToImpact(world, NEUTRAL, 120);
    expect(world.vehicle.hp).toBe(0);
    expect(countEvents(world.events, EV.ShiftEnd)).toBe(1);
    for (let i = 0; i < world.events.count; i++) {
      if (world.events.type[i] === EV.ShiftEnd) {
        expect(world.events.a[i]).toBe(ShiftEndReason.Towed);
        expect(world.events.entity[i]).toBe(-1);
      }
    }
    expect(world.shiftEndReason).toBe(ShiftEndReason.Towed);

    // Back off and hit again, twice: impacts still happen, HP stays at 0, no second ShiftEnd.
    let shiftEnds = 0;
    let impacts = 0;
    for (let hit = 0; hit < 2; hit++) {
      world.vehicle.xM = 24;
      world.vehicle.vLongMps = 11;
      for (let i = 0; i < 120; i++) {
        world.step(NEUTRAL);
        shiftEnds += countEvents(world.events, EV.ShiftEnd);
        impacts += countEvents(world.events, EV.Impact);
        expect(world.vehicle.hp).toBe(0);
      }
    }
    expect(impacts).toBeGreaterThanOrEqual(2);
    expect(shiftEnds).toBe(0);
    expect(world.shiftEndReason).toBe(ShiftEndReason.Towed);
  });

  it('a hit bigger than the HP left clamps HP to 0, never below', () => {
    const world = createWorld(eastWall(), 1, noDrag());
    world.vehicle.hp = 5;
    world.vehicle.vLongMps = 11;
    stepToImpact(world, NEUTRAL, 120);
    expect(world.vehicle.hp).toBe(0);
    expect(Object.is(world.vehicle.hp, -0)).toBe(false);
    expect(countEvents(world.events, EV.ShiftEnd)).toBe(1);
  });

  it('a hit that leaves HP above 0 emits no ShiftEnd', () => {
    const world = createWorld(eastWall(), 1, noDrag());
    world.vehicle.vLongMps = 11;
    stepToImpact(world, NEUTRAL, 120);
    expect(world.vehicle.hp).toBeCloseTo(64, 9);
    expect(countEvents(world.events, EV.ShiftEnd)).toBe(0);
    expect(world.shiftEndReason).toBe(0);
  });

  it('over a long random drive in a walled yard, HP stays in [0, 100] and ShiftEnd fires at most once', () => {
    const props: LevelProp[] = [
      { id: 'prop.lamp_post', x: 13, y: 13, rot: 0 },
      { id: 'prop.bollard', x: 27, y: 11, rot: 0 },
      { id: 'prop.bench', x: 19, y: 27, rot: 0.7 },
      { id: 'prop.phone_box', x: 29, y: 29, rot: Math.PI / 2 },
    ];
    const lvl = level(
      20,
      20,
      (col, row) => (col >= 8 && col <= 10 && row >= 8 && row <= 11) || (row === 15 && col < 6),
      { x: 6, y: 6, heading: 0.3 },
      props,
    );
    const world = createWorld(lvl, 1, DEFAULT_TUNING);
    const rng = sfc32(0x7011ed);
    let input = NEUTRAL;
    let hold = 0;
    let shiftEnds = 0;
    let impacts = 0;
    for (let i = 0; i < 7200; i++) {
      if (hold === 0) {
        input = frame(120 + nextInt(rng, THROTTLE_MAX - 119), 0, nextInt(rng, 2 * STEER_MAX + 1) - STEER_MAX);
        hold = 20 + nextInt(rng, 60);
      }
      hold -= 1;
      world.step(input);
      const hp = world.vehicle.hp;
      expect(hp >= 0 && hp <= 100, `tick ${i}: hp ${hp}`).toBe(true);
      expect(maxSolidPenetration(world), `tick ${i}`).toBeLessThanOrEqual(1e-3);
      shiftEnds += countEvents(world.events, EV.ShiftEnd);
      impacts += countEvents(world.events, EV.Impact);
    }
    expect(impacts).toBeGreaterThan(10);
    expect(shiftEnds).toBe(world.vehicle.hp === 0 ? 1 : 0);
  });
});

describe('ghost edges (TECHNICAL_DESIGN §9.1)', () => {
  /**
   * A 20-tile terrace (columns 7–26) of ten 2-tile houses whose fronts are flush on row 5 (the street face is
   * y = 12 m) and whose depths differ, so the greedy merge yields several rects with internal edges meeting
   * the front. Uniform depths give a single merged rect.
   */
  function terrace(depths: readonly number[]): Level {
    return level(
      34,
      12,
      (col, row) => {
        if (col < 7 || col > 26 || row > 5) return false;
        const depth = depths[Math.floor((col - 7) / 2)] ?? 0;
        return row >= 6 - depth;
      },
      { x: 16, y: 12 + HW + 0.2, heading: EAST - 0.04 }, // nosing 0.04 rad into the wall
    );
  }

  const JAGGED = [3, 4, 2, 4, 3, 2, 4, 3, 4, 2];
  const UNIFORM = [3, 3, 3, 3, 3, 3, 3, 3, 3, 3];

  it('the jagged terrace merges into several rects, all flush with the street face', () => {
    const solids = terrace(JAGGED).solids;
    expect(solids.length).toBeGreaterThan(1);
    expect(solids.filter((r) => r[3] === 6).length).toBeGreaterThan(1);
    expect(terrace(UNIFORM).solids).toEqual([[7, 3, 27, 6]]);
  });

  it.each([
    ['several merged rects', JAGGED],
    ['one merged rect', UNIFORM],
  ])(
    'sliding pressed against a 20-tile terrace (%s): only the wall normal, no tangential loss from contacts',
    (_name, depths) => {
      const world = createWorld(terrace(depths), 1, DEFAULT_TUNING);
      const drive = frame(160, 0, 0);
      let before = { x: 0, y: 0 };
      let after = { x: 0, y: 0 };
      world.phaseTrace = (phase) => {
        if (phase === Phase.StaticCollision) before = worldVelocity(world);
        if (phase === Phase.Bodies) after = worldVelocity(world);
      };
      let contacts = 0;
      let ticks = 0;
      while (world.vehicle.xM < 50 && ticks < 2000) {
        world.step(drive);
        ticks += 1;
        const log = world.staticResolver.log;
        for (let k = 0; k < log.count; k++) {
          contacts += 1;
          expect(Math.abs(log.normalX[k] ?? 1), `tick ${ticks} normal x`).toBeLessThanOrEqual(EPS);
          expect(Math.abs((log.normalY[k] ?? 0) - 1), `tick ${ticks} normal y`).toBeLessThanOrEqual(EPS);
        }
        // The tangent of the wall is world x: contacts never change it.
        expect(Math.abs(after.x - before.x), `tick ${ticks} tangential speed`).toBeLessThanOrEqual(EPS);
        expect(maxSolidPenetration(world)).toBeLessThanOrEqual(1e-3);
      }
      expect(world.vehicle.xM).toBeGreaterThanOrEqual(50); // slid the length of the terrace
      expect(contacts).toBeGreaterThan(100); // and was pressed against it the whole way
    },
  );

  it('the mask is what removes the ghost: plain SAT on the seam picks the internal side face', () => {
    // A = tiles [0, 0, 2, 3], B = [2, 1, 4, 3]: flush south faces at y = 6 m. Bessie, facing east, presses
    // 0.05 m into the front with her bumper 0.01 m past the seam at x = 4 m.
    const lvl = level(
      8,
      6,
      (col, row) => (col < 2 && row < 3) || (col >= 2 && col < 4 && row >= 1 && row < 3),
      {
        x: 0,
        y: 0,
        heading: 0,
      },
    );
    expect(lvl.solids).toEqual([
      [0, 0, 2, 3],
      [2, 1, 4, 3],
    ]);
    const grid = createStaticGrid(lvl, DEFAULT_TUNING.propFootprints);
    const obb = setObb(createObb(), 4.01 - HL, 6 + HW - 0.05, EAST, HW, HL);
    const aabb = obbAabb(obb, { minX: 0, minY: 0, maxX: 0, maxY: 0 });
    const plain = createContact();
    obbVsRect(obb, 4, 2, 8, 6, plain);
    expect(plain.normalX).toBe(-1); // the ghost: B's west face, which is internal
    expect(plain.depthM).toBeCloseTo(0.01, 9);
    const mask = rectOpenMask(grid, 1, aabb);
    expect(mask & RECT_OPEN.FACE_W).toBe(0); // closed: A's cells sit beyond it on the overlapped row
    expect(mask & RECT_OPEN.FACE_S).not.toBe(0);
    expect(mask & RECT_OPEN.CORNER_SW).toBe(0); // not a convex corner of the union
    expect(mask & RECT_OPEN.CORNER_SE).not.toBe(0);
    const masked = createContact();
    obbVsRectMasked(obb, { minX: 4, minY: 2, maxX: 8, maxY: 6 }, mask, masked);
    expect([masked.normalX, masked.normalY]).toEqual([0, 1]);
    expect(masked.depthM).toBeCloseTo(0.05, 9);
  });

  it('a deep, steep hit straddling the seam is pushed out of the front, never sideways along it', () => {
    // A = tiles [0, 0, 4, 4], B = [4, 1, 8, 4]: flush fronts at y = 8 m, seam at x = 8 m. Bessie starts 0.39 m
    // into the front with her nose just across the seam, turned 28° anticlockwise and moving at 15 m/s.
    // Plain SAT resolves B through its internal west face (a ghost normal pointing west along the street);
    // the masked SAT never does.
    const lvl = level(
      12,
      8,
      (col, row) => (col < 4 && row < 4) || (col >= 4 && col < 8 && row >= 1 && row < 4),
      {
        x: 8.47,
        y: 9.45,
        heading: -0.49,
      },
    );
    expect(lvl.solids).toEqual([
      [0, 0, 4, 4],
      [4, 1, 8, 4],
    ]);
    const world = createWorld(lvl, 1, DEFAULT_TUNING);
    world.vehicle.vLongMps = 15;
    world.step(NEUTRAL);
    const log = world.staticResolver.log;
    expect(log.count).toBeGreaterThan(0);
    for (let k = 0; k < log.count; k++) {
      expect(log.normalX[k], `contact ${k}`).toBe(0);
      expect(log.normalY[k], `contact ${k}`).toBe(1);
    }
    expect(maxSolidPenetration(world)).toBeLessThanOrEqual(EPS);
  });

  it('obbVsRectMasked with every feature open is obbVsRect, and an all-closed mask still pushes out', () => {
    const rng = sfc32(0x9a57);
    const a = createContact();
    const b = createContact();
    const rect = { minX: 3, minY: 4, maxX: 7, maxY: 6 };
    for (let i = 0; i < 2000; i++) {
      const obb = setObb(
        createObb(),
        nextInt(rng, 1000) / 100,
        nextInt(rng, 1000) / 100,
        (nextInt(rng, 6284) / 1000) * (nextInt(rng, 2) === 0 ? 1 : -1),
        HW,
        HL,
      );
      const hitA = obbVsRect(obb, 3, 4, 7, 6, a);
      const hitB = obbVsRectMasked(obb, rect, RECT_OPEN_ALL, b);
      expect(hitB).toBe(hitA);
      expect(b).toEqual(a);
      const hitC = obbVsRectMasked(obb, rect, 0, b);
      expect(hitC).toBe(hitA);
      if (hitA) expect(b).toEqual(a);
    }
  });
});

describe('map boundary', () => {
  it('driving north into the map edge at 11 m/s resolves against the boundary', () => {
    const lvl = level(10, 10, () => false, { x: 10, y: HL + 0.3, heading: NORTH });
    const world = createWorld(lvl, 1, noDrag());
    world.vehicle.vLongMps = 11;
    stepToImpact(world, NEUTRAL, 60);
    const log = world.staticResolver.log;
    expect(log.count).toBe(1);
    expect(world.staticGrid.source[log.shape[0] ?? 0]).toBe(ShapeSource.Boundary);
    expect([log.normalX[0], log.normalY[0]]).toEqual([0, 1]);
    expect(Math.abs(world.vehicle.yM - HL)).toBeLessThan(EPS);
    expect(world.vehicle.vLongMps).toBeCloseTo(-2.2, 9);
  });

  it('Bessie cannot leave the map: a long full-throttle random drive in an empty map stays inside', () => {
    const lvl = level(12, 10, () => false, { x: 12, y: 10, heading: 1 });
    const world = createWorld(lvl, 1, DEFAULT_TUNING);
    const rng = sfc32(0xed6e);
    const corners = new Float64Array(8);
    const obb = createObb();
    let input = NEUTRAL;
    let hold = 0;
    let boundaryHits = 0;
    for (let i = 0; i < 7200; i++) {
      if (hold === 0) {
        input = frame(THROTTLE_MAX, 0, nextInt(rng, 2 * STEER_MAX + 1) - STEER_MAX);
        hold = 30 + nextInt(rng, 90);
      }
      hold -= 1;
      world.step(input);
      const v = world.vehicle;
      obbCorners(setObb(obb, v.xM, v.yM, v.headingRad, HW, HL), corners);
      for (let k = 0; k < 8; k += 2) {
        expect(corners[k] ?? -1).toBeGreaterThanOrEqual(-1e-3);
        expect(corners[k] ?? 99).toBeLessThanOrEqual(24 + 1e-3);
        expect(corners[k + 1] ?? -1).toBeGreaterThanOrEqual(-1e-3);
        expect(corners[k + 1] ?? 99).toBeLessThanOrEqual(20 + 1e-3);
      }
      boundaryHits += countEvents(world.events, EV.Impact);
    }
    expect(boundaryHits).toBeGreaterThan(5);
  });
});

describe('static grid (collision/grid.ts)', () => {
  const props: LevelProp[] = [
    { id: 'prop.bollard', x: 5, y: 5, rot: 0 },
    { id: 'prop.bench', x: 9, y: 3, rot: Math.PI / 2 },
  ];
  const lvl = level(8, 6, (col, row) => row === 4 && col >= 1 && col <= 6, { x: 0, y: 0, heading: 0 }, props);
  const grid = createStaticGrid(lvl, DEFAULT_TUNING.propFootprints);

  it('holds the merged solids, then the four boundary strips, then the props, in that order', () => {
    expect(grid.shapeCount).toBe(1 + 4 + 2);
    expect(Array.from(grid.source)).toEqual([0, 1, 1, 1, 1, 2, 2]);
    expect(Array.from(grid.kind)).toEqual([0, 0, 0, 0, 0, ShapeKind.Circle, ShapeKind.Box]);
    const box = (i: number): number[] => {
      const r = grid.bounds[i];
      return r === undefined ? [] : [r.minX, r.minY, r.maxX, r.maxY];
    };
    expect(box(0)).toEqual([2, 8, 14, 10]);
    const b = BOUNDARY_TILES * TILE_M;
    expect(box(1)).toEqual([-b, -b, 16 + b, 0]); // N
    expect(box(2)).toEqual([-b, 12, 16 + b, 12 + b]); // S
    expect(box(3)).toEqual([-b, 0, 0, 12]); // W
    expect(box(4)).toEqual([16, 0, 16 + b, 12]); // E
    expect(Array.from(grid.propIndex)).toEqual([-1, -1, -1, -1, -1, 0, 1]);
  });

  it('uses the provisional footprints: a 0.3 m-diameter bollard and a bench box turned by its rot', () => {
    expect(grid.circles[5]).toEqual({ x: 5, y: 5, radiusM: 0.15 });
    // The bench is 1.8 × 0.6 m; turned 90° its long side runs north–south.
    const bench = grid.bounds[6] ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    expect(bench.maxX - bench.minX).toBeCloseTo(0.6, 9);
    expect(bench.maxY - bench.minY).toBeCloseTo(1.8, 9);
    expect([grid.boxes[6]?.cx, grid.boxes[6]?.cy]).toEqual([9, 3]);
  });

  it('builds every circle with createCircle: a zero circle unless the shape is a circle prop (SSP-049)', () => {
    // createCircle starts from fractional values so V8 keeps the fields double (TECHNICAL_DESIGN §17,
    // "Deprecated hidden classes"); what callers see is still an all-zero circle.
    expect(createCircle()).toEqual({ x: 0, y: 0, radiusM: 0 });
    expect(Object.keys(createCircle())).toEqual(['x', 'y', 'radiusM']);
    for (let s = 0; s < grid.shapeCount; s++) {
      if (grid.kind[s] === ShapeKind.Circle) continue;
      expect(grid.circles[s]).toEqual({ x: 0, y: 0, radiusM: 0 });
    }
  });

  it('rasterises solids, and treats cells outside the map as solid', () => {
    expect(isSolidCell(grid, 1, 4)).toBe(true);
    expect(isSolidCell(grid, 0, 4)).toBe(false);
    expect(isSolidCell(grid, -1, 0)).toBe(true);
    expect(isSolidCell(grid, 8, 0)).toBe(true);
    expect(isSolidCell(grid, 3, 6)).toBe(true);
  });

  it('queryStatic gathers each overlapping shape once, in cell order, and nothing for a non-finite box', () => {
    // A box over the whole wall: the 6-cell rect is registered in 6 buckets but gathered once.
    let n = queryStatic(grid, { minX: 1, minY: 7, maxX: 15, maxY: 9 });
    const got = Array.from(grid.candidates.subarray(0, n));
    expect(got.filter((s) => s === 0).length).toBe(1);
    expect(new Set(got).size).toBe(n);
    expect(grid.candidateCount).toBe(n);
    // Near the north-west corner: the N and W strips.
    n = queryStatic(grid, { minX: 0.5, minY: 0.5, maxX: 1, maxY: 1 });
    expect(Array.from(grid.candidates.subarray(0, n)).sort()).toEqual([1, 3]);
    // The bollard's cell.
    n = queryStatic(grid, { minX: 4.6, minY: 4.6, maxX: 5.4, maxY: 5.4 });
    expect(Array.from(grid.candidates.subarray(0, n))).toEqual([5]);
    expect(queryStatic(grid, { minX: Number.NaN, minY: 0, maxX: 1, maxY: 1 })).toBe(0);
    expect(queryStatic(grid, { minX: 0, minY: 0, maxX: Number.POSITIVE_INFINITY, maxY: 1 })).toBe(0);
    // Far outside the map, the query clamps to the ring and still finds the boundary.
    n = queryStatic(grid, { minX: -50, minY: 4, maxX: -49, maxY: 5 });
    expect(Array.from(grid.candidates.subarray(0, n))).toEqual([3]);
  });

  it('rejects a level prop with no footprint, naming it', () => {
    const bad = level(4, 4, () => false, { x: 4, y: 4, heading: 0 }, [
      { id: 'prop.wheelie_bin', x: 3, y: 3, rot: 0 },
    ]);
    expect(() => createStaticGrid(bad, DEFAULT_TUNING.propFootprints)).toThrow(
      /level prop 0 \(prop\.wheelie_bin\) has no footprint/,
    );
    const nan = level(4, 4, () => false, { x: 4, y: 4, heading: 0 }, [
      { id: 'prop.bollard', x: Number.NaN, y: 3, rot: 0 },
    ]);
    expect(() => createStaticGrid(nan, DEFAULT_TUNING.propFootprints)).toThrow(/non-finite/);
  });

  it('World builds its grid from the level and the tuning it is given', () => {
    const world = createWorld(lvl, 1, DEFAULT_TUNING);
    expect(world.staticGrid.shapeCount).toBe(7);
    expect(world.shiftEndReason).toBe(0);
  });
});

describe('primitives added for phase 3', () => {
  it('obbVsObb against an axis-aligned box agrees with obbVsRect (overlap, depth and normal)', () => {
    const rng = sfc32(0x0bb0bb);
    const a = createContact();
    const b = createContact();
    const other = setObb(createObb(), 5, 5, 0, 1.2, 0.4); // the rect [3.8, 6.2] × [4.6, 5.4]
    let hits = 0;
    for (let i = 0; i < 5000; i++) {
      const obb = setObb(
        createObb(),
        2 + nextInt(rng, 6000) / 1000,
        2 + nextInt(rng, 6000) / 1000,
        nextInt(rng, 6283) / 1000,
        HW,
        HL,
      );
      if (Math.abs(obb.cx - 5) < 1e-9 || Math.abs(obb.cy - 5) < 1e-9) continue; // zero-offset ties differ by design
      const hitRect = obbVsRect(obb, 3.8, 4.6, 6.2, 5.4, a);
      const hitObb = obbVsObb(obb, other, b);
      expect(hitObb).toBe(hitRect);
      if (!hitRect) continue;
      hits += 1;
      expect(b.depthM).toBeCloseTo(a.depthM, 12);
      expect(b.normalX).toBeCloseTo(a.normalX, 12);
      expect(b.normalY).toBeCloseTo(a.normalY, 12);
    }
    expect(hits).toBeGreaterThan(500);
  });

  it('obbVsObb pushes out of a turned box: moving by normal × depth leaves the boxes touching', () => {
    const rng = sfc32(0x7e57);
    const c = createContact();
    const other = setObb(createObb(), 0, 0, 0.7, 0.9, 0.3);
    for (let i = 0; i < 2000; i++) {
      const obb = setObb(
        createObb(),
        nextInt(rng, 4000) / 1000 - 2,
        nextInt(rng, 4000) / 1000 - 2,
        nextInt(rng, 6283) / 1000,
        HW,
        HL,
      );
      if (!obbVsObb(obb, other, c)) continue;
      expect(c.depthM).toBeGreaterThan(0);
      expect(Math.hypot(c.normalX, c.normalY)).toBeCloseTo(1, 12);
      obb.cx += c.normalX * (c.depthM + 1e-9);
      obb.cy += c.normalY * (c.depthM + 1e-9);
      expect(obbVsObb(obb, other, createContact())).toBe(false);
    }
  });

  it('obbVsCircleShape is obbVsCircle', () => {
    const a = createContact();
    const b = createContact();
    const obb = setObb(createObb(), 0, 0, 0.3, HW, HL);
    obbVsCircle(obb, 0.9, -1.2, 0.3, a);
    obbVsCircleShape(obb, { x: 0.9, y: -1.2, radiusM: 0.3 }, b);
    expect(b).toEqual(a);
    expect(a.overlap).toBe(true);
  });

  it('sweepStepCount and sweepPose follow subStepCount and subStepPose exactly', () => {
    const sweep = createSweep();
    const p = createPose();
    const q = createPose();
    const rng = sfc32(0x5eeb);
    for (let i = 0; i < 500; i++) {
      sweep.x0 = nextInt(rng, 10000) / 1000;
      sweep.y0 = nextInt(rng, 10000) / 1000;
      sweep.heading0Rad = nextInt(rng, 20000) / 1000 - 10;
      sweep.x1 = sweep.x0 + nextInt(rng, 6000) / 1000 - 3;
      sweep.y1 = sweep.y0 + nextInt(rng, 6000) / 1000 - 3;
      sweep.heading1Rad = sweep.heading0Rad + nextInt(rng, 8000) / 1000 - 4;
      const n = sweepStepCount(sweep);
      expect(n).toBe(subStepCount(Math.sqrt((sweep.x1 - sweep.x0) ** 2 + (sweep.y1 - sweep.y0) ** 2)));
      for (let s = 1; s <= n; s++) {
        sweepPose(sweep, s, n, p);
        subStepPose(sweep.x0, sweep.y0, sweep.heading0Rad, sweep.x1, sweep.y1, sweep.heading1Rad, s, n, q);
        expect(p).toEqual(q);
      }
    }
  });
});

describe('allocation', () => {
  it('stepWorld allocates nothing per tick with Bessie pressed into walls and props (§17 heap-delta check)', () => {
    // Three Worlds stepped together, each in a steady state that resolves contacts on every tick: wedged at
    // full throttle into an inside corner (two merged rects, two MTV iterations and two impacts a tick), and
    // pressed nose-first into a lamp post (circle) and a bench (OBB vs OBB). Stepping them together keeps
    // every shape kind live in the same optimised code, the way a real level mixes them. A steady state
    // matters: a scenario whose contact pattern changes inside the window measures V8 tiering up the new
    // path, not the sim.
    const corner = createWorld(
      level(12, 12, (col, row) => row <= 1 || col >= 10, { x: 14, y: 10, heading: Math.PI / 4 }),
      7,
      DEFAULT_TUNING,
    );
    const lamp = createWorld(
      level(12, 12, () => false, { x: 12, y: 12, heading: NORTH }, [
        { id: 'prop.lamp_post', x: 12, y: 6, rot: 0 },
      ]),
      7,
      DEFAULT_TUNING,
    );
    const bench = createWorld(
      level(12, 12, () => false, { x: 12, y: 12, heading: NORTH }, [
        { id: 'prop.bench', x: 12, y: 6, rot: 0 },
      ]),
      7,
      DEFAULT_TUNING,
    );
    const full = frame(THROTTLE_MAX, 0, 0);
    const step = (): void => {
      stepWorld(corner, full);
      stepWorld(lamp, full);
      stepWorld(bench, full);
    };
    // Pre-warm until V8 has optimised the whole tick (see the note in tests/unit/world.test.ts).
    for (let tick = 0; tick < 30_000; tick++) step();
    const contacts = [0, 0, 0];
    let impacts = 0;
    for (let tick = 0; tick < 600; tick++) {
      step();
      contacts[0] = (contacts[0] ?? 0) + corner.staticResolver.log.count;
      contacts[1] = (contacts[1] ?? 0) + lamp.staticResolver.log.count;
      contacts[2] = (contacts[2] ?? 0) + bench.staticResolver.log.count;
      impacts += countEvents(corner.events, EV.Impact);
    }
    expect(contacts).toEqual([1200, 600, 600]);
    expect(impacts).toBe(1200);
    const delta = measureHeapDelta(step);
    assertHeapDeltaWithinThresholds(delta);
  });
});
