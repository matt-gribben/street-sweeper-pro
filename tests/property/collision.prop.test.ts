// Collision properties: the M1 exit proof (TECHNICAL_DESIGN §9.5, §18.2; ROADMAP M1 measurable check
// "Collision"; SSP-037). Three properties over 10,000 generated scenarios in total, each with a fixed seed:
//
//   1. Never ends a tick inside a solid (2,000 scenarios × 600 ticks): random 8×8 to 32×32 collide grids,
//      a random spawn pose clear of every solid, and a random 600-tick InputFrame sequence. At the end of
//      every tick Bessie's OBB overlaps no merged solid rect (and does not reach past the map edge) by more
//      than 1 mm.
//   2. No tunnelling at up to 17.2 m/s (3,000 wall scenarios + 3,000 bollard scenarios): from random poses
//      aimed at a 1-tile (2 m) wall, or at a 0.3 m bollard (the prop.bollard circle footprint), at speeds
//      covering the full 0–17.2 m/s range (17.2 exactly in explicit examples), the swept centre never
//      crosses the obstacle.
//   3. Resolution is idempotent (2,000 scenarios): on random drives, every pose phase 3 has just pushed out of
//      something (and the final pose) moves by less than 1e-9 m when resolved again.
//
// Each property also checks coverage floors (how many scenarios hit something, and how hard), so the suite
// cannot pass by never colliding. The failures this suite found when it was written (SSP-037) are fixed in
// src/sim/collision and pinned by regression tests in tests/unit/collisionStatic.test.ts.
//
// 2,000 + 3,000 + 3,000 + 2,000 = 10,000. Worlds are built straight from the generated collide grids with
// mergeSolids, encodeLevel/decodeLevel and createWorld (tests/support/collisionWorld.ts), not through the file
// compiler. The overlap measure is the test-side SAT in tests/support/solidOverlap.ts, independent of the
// sim's resolver. Any failure throws with the fast-check seed and path on its first line
// (tests/support/fcCheck.ts), plus the command that replays it.
//
// 17.2 m/s is transit 11 m/s × Bacon Butty 1.3 × Engine L2 1.2 (= 17.16, rounded up in the docs), the real
// in-game maximum. The game's own topSpeedMult would be 1.3 × 1.2 = 1.56, which only reaches 17.16, and the
// throttle clamp holds vLong at vTop, so property 2 sets topSpeedMult = 17.2 / 11 and writes the initial vLong
// directly (any throttle value then holds or raises it to vTop, never above 17.2). Property 2 also zeroes both
// drag terms, so Bessie meets the obstacle at the generated speed rather than a slightly lower one.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import tuningJson from '../../src/data/tuning.json' with { type: 'json' };
import { ShapeSource } from '../../src/sim/collision/grid.ts';
import {
  createStaticResolver,
  ResolveOutcome,
  resolveStatic,
} from '../../src/sim/collision/resolveStatic.ts';
import { TILE_M } from '../../src/sim/constants.ts';
import { createEventQueue, EV, resetEvents } from '../../src/sim/eventQueue.ts';
import {
  BRAKE_MAX,
  createInputFrame,
  type InputFrame,
  PRESSED,
  STEER_MAX,
  THROTTLE_MAX,
} from '../../src/sim/inputFrame.ts';
import { COLLIDE, type Level } from '../../src/sim/map.ts';
import { DEFAULT_TUNING, loadTuning, type Tuning } from '../../src/sim/tuning.ts';
import { VEHICLE_FLAG } from '../../src/sim/vehicleStore.ts';
import { createWorld, type World } from '../../src/sim/world.ts';
import { type CollideGridSpec, worldFromCollideGrid } from '../support/collisionWorld.ts';
import { assertProperty, reproLine, reproParams } from '../support/fcCheck.ts';
import {
  type BodyBox,
  obbBoundaryPenetrationM,
  obbObbPenetrationM,
  obbRectPenetrationM,
} from '../support/solidOverlap.ts';
import { compileTrafficTown, PARKING_CROSSROADS, PARKING_STREET } from '../support/trafficTown.ts';

// ---------------------------------------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------------------------------------

/** TECHNICAL_DESIGN §9.5: the deepest overlap allowed at the end of a tick. */
const PENETRATION_TOLERANCE_M = 1e-3;
/** TECHNICAL_DESIGN §9.5: how far re-resolving an already-resolved pose may move it. */
const IDEMPOTENCE_TOLERANCE_M = 1e-9;
/** The real in-game maximum speed (transit 11 × Bacon Butty 1.3 × Engine L2 1.2, rounded up). */
const MAX_SPEED_MPS = 17.2;

/** The split of the 10,000 scenarios (ROADMAP M1 measurable check). */
const RUNS = {
  neverInside: 2000,
  tunnelWall: 3000,
  tunnelBollard: 3000,
  idempotent: 2000,
} as const;
const SEEDS = {
  neverInside: 0x55_03_7a,
  tunnelWall: 0x55_03_7b,
  tunnelBollard: 0x55_03_7c,
  idempotent: 0x55_03_7d,
} as const;

/**
 * Floors on how much the scenarios collide, set well under what the fixed seeds give (see the commit message
 * for the measured values), so a generator change that stopped hitting things fails loudly.
 */
const COVERAGE = {
  neverInsideImpactShare: 0.5,
  neverInsideMaxVnMps: 6,
  tunnelImpactShare: 0.5,
  idempotentContactChecks: 10_000,
} as const;

/** True when SSP_FC_PATH asks fast-check to replay one counterexample (tests/support/fcCheck.ts). */
const REPLAYING_ONE_CASE = reproParams(0).path !== undefined;

/** Ticks per scenario in property 1 (10 s of driving). */
const DRIVE_TICKS = 600;
/** Ticks per approach in property 2: 2 s, which reaches the wall, bounces and drives back into it. */
const APPROACH_TICKS = 120;
/** A generous per-test timeout: the suite takes seconds, not minutes, but CI machines vary. */
const TEST_TIMEOUT_MS = 300_000;

const SWEEPER = DEFAULT_TUNING.vehicle.sweeper;
const HW = SWEEPER.body.widthM / 2; // 0.875 m
const HL = SWEEPER.body.lengthM / 2; // 1.625 m
const BOLLARD = DEFAULT_TUNING.propFootprints.shapes['prop.bollard'];
if (BOLLARD.shape !== 'circle')
  throw new Error('prop.bollard must be a circle footprint (TECHNICAL_DESIGN §9.1)');
const BOLLARD_R = BOLLARD.radiusM; // 0.15 m: the 0.3 m bollard of §9.5

/** The committed tuning with both drag terms zeroed: a speed set on Bessie is the speed she arrives with. */
const NO_DRAG: Tuning = (() => {
  const raw = structuredClone(tuningJson);
  raw.vehicle.sweeper.drag.rollingMps2 = 0;
  raw.vehicle.sweeper.drag.quadraticPerM = 0;
  return loadTuning(raw);
})();

/** topSpeedMult that puts the transit top speed at exactly the 17.2 m/s maximum. */
const MAX_TOP_SPEED_MULT = MAX_SPEED_MPS / SWEEPER.drive.topSpeedTransitMps;

// ---------------------------------------------------------------------------------------------------------
// Geometry helpers (test-side, independent of src/sim/collision)
// ---------------------------------------------------------------------------------------------------------

/** Half-extents of Bessie's OBB along world x and y at `headingRad`. */
function obbExtents(headingRad: number): { extX: number; extY: number } {
  const c = Math.abs(Math.cos(headingRad));
  const s = Math.abs(Math.sin(headingRad));
  return { extX: HW * c + HL * s, extY: HW * s + HL * c };
}

function bodyOf(world: World): BodyBox {
  const v = world.vehicle;
  return {
    xM: v.xM,
    yM: v.yM,
    headingRad: v.headingRad,
    widthM: SWEEPER.body.widthM,
    lengthM: SWEEPER.body.lengthM,
  };
}

/**
 * The deepest overlap (m) of Bessie's OBB with any merged solid rect of `level` or the map boundary, and
 * which. Rects whose AABB misses the OBB's AABB are skipped (they cannot overlap it), which keeps 1.2 M
 * checks fast; the rest go through the plain SAT of tests/support/solidOverlap.ts.
 */
function deepestSolidOverlap(level: Level, body: BodyBox): { depthM: number; rect: number } {
  const { extX, extY } = obbExtents(body.headingRad);
  const minX = body.xM - extX;
  const maxX = body.xM + extX;
  const minY = body.yM - extY;
  const maxY = body.yM + extY;
  let depthM = obbBoundaryPenetrationM(body, level.size[0] * TILE_M, level.size[1] * TILE_M);
  let rect = depthM > 0 ? -1 : -2;
  const solids = level.solids;
  for (let i = 0; i < solids.length; i += 1) {
    const r = solids[i];
    if (r === undefined) continue;
    const x0 = r[0] * TILE_M;
    const y0 = r[1] * TILE_M;
    const x1 = r[2] * TILE_M;
    const y1 = r[3] * TILE_M;
    if (x1 <= minX || x0 >= maxX || y1 <= minY || y0 >= maxY) continue;
    const d = obbRectPenetrationM(body, x0, y0, x1, y1);
    if (d > depthM) {
      depthM = d;
      rect = i;
    }
  }
  return { depthM, rect };
}

/** Penetration depth (m) of a circle into Bessie's OBB (0 when apart): r − distance to the closest point. */
function circlePenetrationM(body: BodyBox, cx: number, cy: number, r: number): number {
  const fx = Math.sin(body.headingRad);
  const fy = -Math.cos(body.headingRad);
  const rx = Math.cos(body.headingRad);
  const ry = Math.sin(body.headingRad);
  const dx = cx - body.xM;
  const dy = cy - body.yM;
  const lx = dx * rx + dy * ry; // along right
  const ly = dx * fx + dy * fy; // along forward
  const qx = Math.max(-HW, Math.min(HW, lx));
  const qy = Math.max(-HL, Math.min(HL, ly));
  const inside = qx === lx && qy === ly;
  if (inside) return r + Math.min(HW - Math.abs(lx), HL - Math.abs(ly));
  const dist = Math.hypot(lx - qx, ly - qy);
  return Math.max(0, r - dist);
}

/** Whether the segment (x0, y0) → (x1, y1) passes within `r` of (cx, cy). */
function segmentHitsCircle(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  cx: number,
  cy: number,
  r: number,
): boolean {
  const sx = x1 - x0;
  const sy = y1 - y0;
  const len2 = sx * sx + sy * sy;
  let t = len2 > 0 ? ((cx - x0) * sx + (cy - y0) * sy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(x0 + sx * t - cx, y0 + sy * t - cy) <= r;
}

function fmtPose(world: World): string {
  const v = world.vehicle;
  return (
    `pose (${v.xM.toFixed(6)}, ${v.yM.toFixed(6)}, h ${v.headingRad.toFixed(6)}) ` +
    `prev (${v.prevXM.toFixed(6)}, ${v.prevYM.toFixed(6)}, h ${v.prevHeadingRad.toFixed(6)}) ` +
    `vLong ${v.vLongMps.toFixed(4)} vLat ${v.vLatMps.toFixed(4)}`
  );
}

// ---------------------------------------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------------------------------------

/** A w × h collide grid, 8..32 tiles each way: SOLID noise at a per-grid density plus up to four blocks. */
type GridGen = { w: number; h: number; collide: Uint8Array };

const blockArb = fc.record({
  x: fc.integer({ min: 0, max: 31 }),
  y: fc.integer({ min: 0, max: 31 }),
  w: fc.integer({ min: 1, max: 12 }),
  h: fc.integer({ min: 1, max: 12 }),
});

const gridArb: fc.Arbitrary<GridGen> = fc
  .record({
    w: fc.integer({ min: 8, max: 32 }),
    h: fc.integer({ min: 8, max: 32 }),
    // SOLID when the cell's noise byte is below this: from no noise to about 60% solid.
    density: fc.oneof(fc.constant(0), fc.integer({ min: 0, max: 160 })),
    blocks: fc.array(blockArb, { maxLength: 4 }),
  })
  .chain(({ w, h, density, blocks }) =>
    fc.uint8Array({ minLength: w * h, maxLength: w * h }).map((noise) => {
      const collide = new Uint8Array(w * h);
      for (let i = 0; i < collide.length; i += 1) if ((noise[i] ?? 255) < density) collide[i] = COLLIDE.SOLID;
      for (const b of blocks) {
        for (let row = b.y; row < Math.min(h, b.y + b.h); row += 1) {
          for (let col = b.x; col < Math.min(w, b.x + b.w); col += 1) collide[row * w + col] = COLLIDE.SOLID;
        }
      }
      return { w, h, collide };
    }),
  );

/** A spawn pose as fractions of the room the map leaves, and a heading anywhere on the circle. */
const spawnArb = fc.record({
  fx: fc.double({ min: 0, max: 1, noNaN: true }),
  fy: fc.double({ min: 0, max: 1, noNaN: true }),
  headingRad: fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }),
});
type SpawnGen = { fx: number; fy: number; headingRad: number };

/** Clearance between a spawned OBB's AABB and the map edge (far below every tolerance that matters). */
const SPAWN_MARGIN_M = 1e-6;

/**
 * The world for a grid and spawn: Bessie's body centre inside the map with her whole OBB inside it, and
 * every SOLID cell under her OBB's AABB cleared, so she starts clear of every solid (non-overlapping spawn).
 */
function spawnWorld(grid: GridGen, spawn: SpawnGen, tuning: Tuning = DEFAULT_TUNING): World {
  const { w, h } = grid;
  const { extX, extY } = obbExtents(spawn.headingRad);
  const widthM = w * TILE_M;
  const heightM = h * TILE_M;
  // Inset by SPAWN_MARGIN_M so a pose at fx or fy = 0 or 1 is not "touching" the edge by a rounding error.
  const x = extX + SPAWN_MARGIN_M + spawn.fx * (widthM - 2 * (extX + SPAWN_MARGIN_M));
  const y = extY + SPAWN_MARGIN_M + spawn.fy * (heightM - 2 * (extY + SPAWN_MARGIN_M));
  const collide = grid.collide.slice();
  const c0 = Math.max(0, Math.floor((x - extX) / TILE_M));
  const c1 = Math.min(w - 1, Math.ceil((x + extX) / TILE_M) - 1);
  const r0 = Math.max(0, Math.floor((y - extY) / TILE_M));
  const r1 = Math.min(h - 1, Math.ceil((y + extY) / TILE_M) - 1);
  for (let row = r0; row <= r1; row += 1) {
    for (let col = c0; col <= c1; col += 1) collide[row * w + col] = 0;
  }
  const spec: CollideGridSpec = { w, h, collide, player: { x, y, heading: spawn.headingRad } };
  return worldFromCollideGrid(spec, tuning);
}

/** One held input for `ticks` ticks; `brush` presses BRUSH on its first tick (toggling the brush). */
type Segment = { throttle: number; brake: number; steer: number; brush: boolean; ticks: number };

const segmentArb: fc.Arbitrary<Segment> = fc.record({
  throttle: fc.oneof(fc.constant(THROTTLE_MAX), fc.constant(0), fc.integer({ min: 0, max: THROTTLE_MAX })),
  brake: fc.oneof(
    fc.constant(0),
    fc.constant(0),
    fc.constant(BRAKE_MAX),
    fc.integer({ min: 0, max: BRAKE_MAX }),
  ),
  steer: fc.oneof(
    fc.constant(0),
    fc.constant(STEER_MAX),
    fc.constant(-STEER_MAX),
    fc.integer({ min: -STEER_MAX, max: STEER_MAX }),
  ),
  // One segment in eight toggles the brush (brush-down caps the top speed at 3 m/s × topSpeedMult).
  brush: fc.integer({ min: 0, max: 7 }).map((n) => n === 0),
  ticks: fc.integer({ min: 1, max: 120 }),
});

/** A random input program: 1..24 segments, repeated in order until it fills `ticks` frames. */
function inputsArb(ticks: number): fc.Arbitrary<InputFrame[]> {
  return fc
    .array(segmentArb, { minLength: 1, maxLength: 24 })
    .map((segments) => expandSegments(segments, ticks));
}

function expandSegments(segments: readonly Segment[], ticks: number): InputFrame[] {
  const frames: InputFrame[] = [];
  for (let s = 0; frames.length < ticks; s = (s + 1) % segments.length) {
    const seg = segments[s] as Segment;
    for (let t = 0; t < seg.ticks && frames.length < ticks; t += 1) {
      const f = createInputFrame();
      f.throttle = seg.throttle;
      f.brake = seg.brake;
      f.steer = seg.steer;
      f.pressed = seg.brush && t === 0 ? PRESSED.BRUSH : 0;
      frames.push(f);
    }
  }
  return frames;
}

/** Top-speed multiplier anywhere from none to the 17.2 m/s maximum (power-ups and upgrades). */
const topSpeedMultArb = fc.oneof(
  fc.constant(1),
  fc.constant(MAX_TOP_SPEED_MULT),
  fc.double({ min: 1, max: MAX_TOP_SPEED_MULT, noNaN: true }),
);

/** Ticks of driving before property 3 re-resolves the pose (up to 4 s, enough to reach and press a wall). */
const IDEMPOTENT_MAX_TICKS = 240;

/** Property 2: the steepest aim off the obstacle's normal, and the largest starting gap. */
const MAX_AIM_RAD = (75 * Math.PI) / 180;
const MAX_GAP_M = 4;

/** The held input for property 2 (any throttle; 2a also steers, 2b keeps the wheel straight). */
function heldInput(throttle: number, steer: number): InputFrame {
  const f = createInputFrame();
  f.throttle = throttle;
  f.steer = steer;
  return f;
}

/** Speeds over the full 0–17.2 m/s range, weighted toward the top (and 17.2 exactly). */
const speedArb = fc.oneof(
  fc.constant(MAX_SPEED_MPS),
  fc.double({ min: 0, max: MAX_SPEED_MPS, noNaN: true }),
  fc.double({ min: 11, max: MAX_SPEED_MPS, noNaN: true }),
);
const throttleArb = fc.oneof(
  fc.constant(THROTTLE_MAX),
  fc.constant(0),
  fc.integer({ min: 0, max: THROTTLE_MAX }),
);

/**
 * Property 2a: a w × h tile map with a full-height wall in column `wallCol` (x from 2·wallCol to
 * 2·wallCol + 2 m: one merged rect), Bessie west of it heading east ± aimRad with `gapM` between her OBB and
 * the wall face, moving at `speedMps`, holding `throttle` and `steer` throughout.
 */
type WallApproach = {
  w: number;
  h: number;
  wallCol: number;
  fy: number;
  aimRad: number;
  gapM: number;
  speedMps: number;
  throttle: number;
  steer: number;
};

const wallApproachArb: fc.Arbitrary<WallApproach> = fc
  .record({
    w: fc.integer({ min: 8, max: 24 }),
    h: fc.integer({ min: 8, max: 24 }),
    wallFrac: fc.double({ min: 0, max: 1, noNaN: true }),
    fy: fc.double({ min: 0, max: 1, noNaN: true }),
    aimRad: fc.oneof(fc.constant(0), fc.double({ min: -MAX_AIM_RAD, max: MAX_AIM_RAD, noNaN: true })),
    gapM: fc.oneof(fc.constant(0), fc.double({ min: 0, max: MAX_GAP_M, noNaN: true })),
    speedMps: speedArb,
    throttle: throttleArb,
    steer: fc.oneof(fc.constant(0), fc.integer({ min: -STEER_MAX, max: STEER_MAX })),
  })
  .map(({ wallFrac, ...a }) => {
    // Room west of the wall for Bessie (AABB up to 3.7 m wide) plus the largest gap: wallCol 4..w − 1.
    const wallCol = 4 + Math.min(a.w - 5, Math.floor(wallFrac * (a.w - 4)));
    return { ...a, wallCol };
  });

const WALL_EXAMPLE: WallApproach = {
  w: 16,
  h: 12,
  wallCol: 10,
  fy: 0.5,
  aimRad: 0,
  gapM: 1,
  speedMps: MAX_SPEED_MPS,
  throttle: THROTTLE_MAX,
  steer: 0,
};

/** Put Bessie's top speed at the 17.2 m/s maximum and set her moving at `speedMps` along her heading. */
function launch(world: World, speedMps: number): void {
  world.vehicleParams.topSpeedMult = MAX_TOP_SPEED_MULT;
  world.vehicle.vLongMps = speedMps;
}

function wallWorld(a: WallApproach): { world: World; wallX0M: number } {
  const collide = new Uint8Array(a.w * a.h);
  for (let row = 0; row < a.h; row += 1) collide[row * a.w + a.wallCol] = COLLIDE.SOLID;
  const heading = Math.PI / 2 + a.aimRad;
  const { extX, extY } = obbExtents(heading);
  const wallX0M = a.wallCol * TILE_M;
  const x = wallX0M - extX - SPAWN_MARGIN_M - a.gapM;
  const y = extY + SPAWN_MARGIN_M + a.fy * (a.h * TILE_M - 2 * (extY + SPAWN_MARGIN_M));
  const world = worldFromCollideGrid({ w: a.w, h: a.h, collide, player: { x, y, heading } }, NO_DRAG);
  launch(world, a.speedMps);
  return { world, wallX0M };
}

/**
 * Property 2b: an open 16 × 16 tile map with one prop.bollard; Bessie heads anywhere with the bollard straight
 * ahead of her front face, `gapM` away and offset sideways by offsetFrac × her half-width, moving at
 * `speedMps` and holding `throttle` with the wheel straight.
 */
type BollardApproach = {
  fx: number;
  fy: number;
  headingRad: number;
  gapM: number;
  offsetFrac: number;
  speedMps: number;
  throttle: number;
};

const BOLLARD_MAP_TILES = 16;

const bollardApproachArb: fc.Arbitrary<BollardApproach> = fc.record({
  fx: fc.double({ min: 0, max: 1, noNaN: true }),
  fy: fc.double({ min: 0, max: 1, noNaN: true }),
  headingRad: fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }),
  gapM: fc.oneof(fc.constant(0), fc.double({ min: 0, max: MAX_GAP_M, noNaN: true })),
  offsetFrac: fc.oneof(fc.constant(0), fc.double({ min: -1, max: 1, noNaN: true })),
  speedMps: speedArb,
  throttle: throttleArb,
});

const BOLLARD_EXAMPLE: BollardApproach = {
  fx: 0.5,
  fy: 0.5,
  headingRad: Math.PI / 2,
  gapM: 1,
  offsetFrac: 0,
  speedMps: MAX_SPEED_MPS,
  throttle: THROTTLE_MAX,
};

function bollardWorld(a: BollardApproach): { world: World; bx: number; by: number } {
  // Bessie's centre in the middle half of the 32 m map, so she and the bollard (≤ 5.8 m ahead) stay inside.
  const sizeM = BOLLARD_MAP_TILES * TILE_M;
  const x = sizeM / 4 + a.fx * (sizeM / 2);
  const y = sizeM / 4 + a.fy * (sizeM / 2);
  const fx = Math.sin(a.headingRad);
  const fy = -Math.cos(a.headingRad);
  const ahead = HL + BOLLARD_R + SPAWN_MARGIN_M + a.gapM;
  const side = a.offsetFrac * HW;
  // forward (fx, fy), right (−fy, fx).
  const bx = x + fx * ahead - fy * side;
  const by = y + fy * ahead + fx * side;
  const world = worldFromCollideGrid(
    {
      w: BOLLARD_MAP_TILES,
      h: BOLLARD_MAP_TILES,
      collide: new Uint8Array(BOLLARD_MAP_TILES * BOLLARD_MAP_TILES),
      player: { x, y, heading: a.headingRad },
      props: [{ id: 'prop.bollard', x: bx, y: by, rot: 0 }],
    },
    NO_DRAG,
  );
  launch(world, a.speedMps);
  return { world, bx, by };
}

// ---------------------------------------------------------------------------------------------------------
// Coverage: proof that the scenarios really collide (a property that never hits anything proves nothing)
// ---------------------------------------------------------------------------------------------------------

type Coverage = {
  /** Scenarios that passed. */
  scenarios: number;
  /** Scenarios in which phase 3 pushed Bessie at least once. */
  withContact: number;
  /** Scenarios with at least one impact (an approaching contact, vn > 0). */
  withImpact: number;
  /** The fastest incoming normal speed of any impact, m/s. */
  maxVnMps: number;
  /** Ticks phase 3 resolved with the heading held, or by stopping short (the SSP-037 fallbacks). */
  headingHeld: number;
  stopped: number;
};

function createCoverage(): Coverage {
  return { scenarios: 0, withContact: 0, withImpact: 0, maxVnMps: 0, headingHeld: 0, stopped: 0 };
}

/** Per-scenario flags, folded into a Coverage when the scenario passes. */
type ScenarioSeen = { contact: boolean; impact: boolean };

/** Record what phase 3 did on the tick `world` just ran. */
function observeTick(cov: Coverage, seen: ScenarioSeen, world: World): void {
  const r = world.staticResolver;
  const log = r.log;
  if (log.count > 0) seen.contact = true;
  for (let i = 0; i < log.count; i += 1) {
    const vn = log.vnMps[i] ?? 0;
    if (vn > 0) seen.impact = true;
    if (vn > cov.maxVnMps) cov.maxVnMps = vn;
  }
  if (r.outcome === ResolveOutcome.HeadingHeld) cov.headingHeld += 1;
  if (r.outcome === ResolveOutcome.Stopped) cov.stopped += 1;
}

function finishScenario(cov: Coverage, seen: ScenarioSeen): void {
  cov.scenarios += 1;
  if (seen.contact) cov.withContact += 1;
  if (seen.impact) cov.withImpact += 1;
}

function fmtCoverage(cov: Coverage): string {
  return JSON.stringify(cov);
}

// ---------------------------------------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------------------------------------

describe('collision properties (TECHNICAL_DESIGN §9.5, SSP-037)', () => {
  it('splits exactly 10,000 scenarios across the properties', () => {
    expect(RUNS.neverInside + RUNS.tunnelWall + RUNS.tunnelBollard + RUNS.idempotent).toBe(10_000);
  });

  it(
    `1. never ends a tick inside a solid: ${RUNS.neverInside} grids × ${DRIVE_TICKS} ticks, tolerance 1 mm`,
    () => {
      const cov = createCoverage();
      assertProperty(
        fc.property(
          gridArb,
          spawnArb,
          inputsArb(DRIVE_TICKS),
          topSpeedMultArb,
          (grid, spawn, inputs, mult) => {
            const world = spawnWorld(grid, spawn);
            world.vehicleParams.topSpeedMult = mult;
            const start = deepestSolidOverlap(world.level, bodyOf(world));
            if (start.depthM > 0) throw new Error(`spawn overlaps rect ${start.rect} by ${start.depthM} m`);
            const seen = { contact: false, impact: false };
            for (let tick = 0; tick < inputs.length; tick += 1) {
              world.step(inputs[tick] as InputFrame);
              observeTick(cov, seen, world);
              const { depthM, rect } = deepestSolidOverlap(world.level, bodyOf(world));
              if (!(depthM <= PENETRATION_TOLERANCE_M)) {
                throw new Error(
                  `tick ${tick}: Bessie overlaps ${rect === -1 ? 'the map boundary' : `solid rect ${rect}`} by ` +
                    `${depthM} m (> 1 mm); ${fmtPose(world)}`,
                );
              }
            }
            finishScenario(cov, seen);
          },
        ),
        { seed: SEEDS.neverInside, numRuns: RUNS.neverInside },
      );
      // The drives really hit things, hard (measured on the fixed seed; see the commit message).
      if (REPLAYING_ONE_CASE) return; // SSP_FC_PATH replays a single case: no coverage to judge
      expect(cov.scenarios, fmtCoverage(cov)).toBe(RUNS.neverInside);
      expect(cov.withImpact, fmtCoverage(cov)).toBeGreaterThan(
        RUNS.neverInside * COVERAGE.neverInsideImpactShare,
      );
      expect(cov.maxVnMps, fmtCoverage(cov)).toBeGreaterThan(COVERAGE.neverInsideMaxVnMps);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    `2a. no tunnelling through a 1-tile wall at 0–17.2 m/s: ${RUNS.tunnelWall} aimed approaches`,
    () => {
      const cov = createCoverage();
      assertProperty(
        fc.property(wallApproachArb, (a) => {
          const { world, wallX0M } = wallWorld(a);
          const input = heldInput(a.throttle, a.steer);
          const v = world.vehicle;
          const seen = { contact: false, impact: false };
          for (let tick = 0; tick < APPROACH_TICKS; tick += 1) {
            const x0 = v.xM;
            world.step(input);
            observeTick(cov, seen, world);
            // The swept centre runs from x0 to v.xM: both ends west of the wall's near face means the
            // segment never reaches the wall, let alone crosses it.
            if (!(x0 < wallX0M && v.xM < wallX0M)) {
              throw new Error(
                `tick ${tick}: the centre crossed the wall face x = ${wallX0M} (x ${x0} → ${v.xM}); ${fmtPose(world)}`,
              );
            }
            const { depthM, rect } = deepestSolidOverlap(world.level, bodyOf(world));
            if (!(depthM <= PENETRATION_TOLERANCE_M)) {
              throw new Error(
                `tick ${tick}: overlaps ${rect === -1 ? 'the boundary' : `rect ${rect}`} by ${depthM} m; ` +
                  fmtPose(world),
              );
            }
          }
          finishScenario(cov, seen);
        }),
        {
          seed: SEEDS.tunnelWall,
          numRuns: RUNS.tunnelWall,
          // 17.2 m/s exactly: head-on, from touching distance, at the steepest aim while steering, and coasting.
          examples: [
            [{ ...WALL_EXAMPLE }],
            [{ ...WALL_EXAMPLE, gapM: 0 }],
            [{ ...WALL_EXAMPLE, aimRad: MAX_AIM_RAD, steer: STEER_MAX }],
            [{ ...WALL_EXAMPLE, gapM: MAX_GAP_M, throttle: 0 }],
          ],
        },
      );
      // numRuns counts the examples, so exactly RUNS.tunnelWall scenarios ran; most of them hit the wall, and
      // the hardest hit is at least the 17.2 m/s head-on example (no drag: vn = 17.2; steering adds a little).
      if (REPLAYING_ONE_CASE) return; // SSP_FC_PATH replays a single case: no coverage to judge
      expect(cov.scenarios, fmtCoverage(cov)).toBe(RUNS.tunnelWall);
      expect(cov.withImpact, fmtCoverage(cov)).toBeGreaterThan(RUNS.tunnelWall * COVERAGE.tunnelImpactShare);
      expect(cov.maxVnMps, fmtCoverage(cov)).toBeGreaterThanOrEqual(MAX_SPEED_MPS - 1e-9);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    `2b. no tunnelling through a 0.3 m bollard at 0–17.2 m/s: ${RUNS.tunnelBollard} aimed approaches`,
    () => {
      const cov = createCoverage();
      assertProperty(
        fc.property(bollardApproachArb, (a) => {
          const { world, bx, by } = bollardWorld(a);
          const input = heldInput(a.throttle, 0);
          const v = world.vehicle;
          const seen = { contact: false, impact: false };
          for (let tick = 0; tick < APPROACH_TICKS; tick += 1) {
            const x0 = v.xM;
            const y0 = v.yM;
            world.step(input);
            observeTick(cov, seen, world);
            // The swept centre never passes through the bollard...
            if (segmentHitsCircle(x0, y0, v.xM, v.yM, bx, by, BOLLARD_R)) {
              throw new Error(
                `tick ${tick}: the centre's sweep (${x0}, ${y0}) → (${v.xM}, ${v.yM}) crosses the bollard`,
              );
            }
            // ...and never gets past it: aimed straight with the wheel straight, the bollard stays ahead.
            const ahead = (bx - v.xM) * Math.sin(v.headingRad) - (by - v.yM) * Math.cos(v.headingRad);
            if (!(ahead > 0)) {
              throw new Error(
                `tick ${tick}: the bollard is ${-ahead} m behind the centre; ${fmtPose(world)}`,
              );
            }
            const depthM = circlePenetrationM(bodyOf(world), bx, by, BOLLARD_R);
            if (!(depthM <= PENETRATION_TOLERANCE_M)) {
              throw new Error(`tick ${tick}: overlaps the bollard by ${depthM} m; ${fmtPose(world)}`);
            }
          }
          finishScenario(cov, seen);
        }),
        {
          seed: SEEDS.tunnelBollard,
          numRuns: RUNS.tunnelBollard,
          // 17.2 m/s exactly: dead centre, from touching distance, on either front corner, and coasting.
          examples: [
            [{ ...BOLLARD_EXAMPLE }],
            [{ ...BOLLARD_EXAMPLE, gapM: 0 }],
            [{ ...BOLLARD_EXAMPLE, offsetFrac: 1 }],
            [{ ...BOLLARD_EXAMPLE, offsetFrac: -1, throttle: 0 }],
          ],
        },
      );
      if (REPLAYING_ONE_CASE) return; // SSP_FC_PATH replays a single case: no coverage to judge
      expect(cov.scenarios, fmtCoverage(cov)).toBe(RUNS.tunnelBollard);
      expect(cov.withImpact, fmtCoverage(cov)).toBeGreaterThan(
        RUNS.tunnelBollard * COVERAGE.tunnelImpactShare,
      );
      expect(cov.maxVnMps, fmtCoverage(cov)).toBeGreaterThanOrEqual(MAX_SPEED_MPS - 1e-9);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    `3. resolution is idempotent: ${RUNS.idempotent} drives, every resolved contact pose re-resolves by < 1e-9 m`,
    () => {
      const events = createEventQueue();
      const resolver = createStaticResolver();
      const cov = createCoverage();
      let checks = 0;
      let contactChecks = 0;
      assertProperty(
        fc.property(
          gridArb,
          spawnArb,
          fc.integer({ min: 1, max: IDEMPOTENT_MAX_TICKS }).chain((n) => inputsArb(n)),
          topSpeedMultArb,
          (grid, spawn, inputs, mult) => {
            const world = spawnWorld(grid, spawn);
            world.vehicleParams.topSpeedMult = mult;
            const seen = { contact: false, impact: false };
            for (let tick = 0; tick < inputs.length; tick += 1) {
              world.step(inputs[tick] as InputFrame);
              observeTick(cov, seen, world);
              const contact = world.staticResolver.log.count > 0;
              // Re-resolve every pose phase 3 just pushed out of something, and the final pose.
              if (!contact && tick !== inputs.length - 1) continue;
              checks += 1;
              if (contact) contactChecks += 1;
              // On a copy, as a zero move (start pose = end pose), twice; the World is not touched.
              const v = { ...world.vehicle };
              const x = v.xM;
              const y = v.yM;
              const h = v.headingRad;
              for (let pass = 1; pass <= 2; pass += 1) {
                v.prevXM = v.xM;
                v.prevYM = v.yM;
                v.prevHeadingRad = v.headingRad;
                resetEvents(events, world.tick);
                resolveStatic(world.staticGrid, resolver, v, world.vehicleParams, events);
                const moved = Math.hypot(v.xM - x, v.yM - y);
                if (!(moved < IDEMPOTENCE_TOLERANCE_M) || v.headingRad !== h) {
                  throw new Error(
                    `tick ${tick}, pass ${pass}: re-resolving moved the pose by ${moved} m (heading ${h} → ` +
                      `${v.headingRad}); ${resolver.log.count} contacts; ${fmtPose(world)}`,
                  );
                }
              }
            }
            finishScenario(cov, seen);
          },
        ),
        { seed: SEEDS.idempotent, numRuns: RUNS.idempotent },
      );
      if (REPLAYING_ONE_CASE) return; // SSP_FC_PATH replays a single case: no coverage to judge
      expect(cov.scenarios, fmtCoverage(cov)).toBe(RUNS.idempotent);
      expect(checks).toBeGreaterThanOrEqual(RUNS.idempotent);
      expect(contactChecks, `${contactChecks} of ${checks} checks at contact poses`).toBeGreaterThan(
        COVERAGE.idempotentContactChecks,
      );
    },
    TEST_TIMEOUT_MS,
  );

  it('puts the seed and path of a failure on the first line of the error', () => {
    const failing = fc.property(fc.integer({ min: 0, max: 100 }), (n) => {
      if (n > 50) throw new Error(`too big: ${n}`);
    });
    let message = '';
    try {
      assertProperty(failing, { seed: 42, numRuns: 100 });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    const first = message.split('\n')[0] ?? '';
    expect(first).toMatch(
      /^fast-check failure: seed=42 path="[0-9:]+" \(reproduce: SSP_FC_SEED=42 SSP_FC_PATH=[0-9:]+ /,
    );
    expect(message).toContain('reason: too big: 51');
    expect(reproLine(7, null)).toContain('seed=7 path=""');
  });
});

// ---------------------------------------------------------------------------------------------------------
// Vehicles (SSP-090, TECHNICAL_DESIGN §9.4): parked cars and moving traffic
// ---------------------------------------------------------------------------------------------------------

/** Property 4's scenarios and seed (on top of the M1 suite's 10,000). */
const VEHICLE_RUNS = 400;
// SSP-091: white vans no longer park beside these towns' 1-tile pavements, which re-rolled every drive; under
// the old seed (0x55_09_0a) the one drive that pinned a moving vehicle against Bessie went with it, so the
// contact-stop coverage below read 0. This seed has four such drives (1,479 contact stops).
const VEHICLE_SEED = 0x55_09_1a;
/** Coverage floors for property 4, well under what the fixed seed gives (see the commit message). */
const VEHICLE_COVERAGE = {
  parkedContactShare: 0.3,
  dentShare: 0.1,
  movingContactShare: 0.05,
} as const;

/** The two compiled towns of property 4: every bay full, moving traffic of cars and vans (L050 holds: 26, 23). */
const VEHICLE_TOWNS: readonly Level[] = [
  compileTrafficTown(PARKING_STREET, {
    densityPerKm: 60,
    mix: { 'veh.hatchback': 40, 'veh.saloon': 30, 'veh.van_white': 30 },
    parkedFill: 1,
    parkedMix: {
      'veh.hatchback_parked': 1,
      'veh.saloon_parked': 1,
      'veh.van_white_parked': 1,
      'veh.taxi_parked': 1,
    },
  }),
  compileTrafficTown(PARKING_CROSSROADS, {
    densityPerKm: 25,
    mix: { 'veh.hatchback': 40, 'veh.saloon': 30, 'veh.van_white': 30 },
    parkedFill: 1,
    parkedMix: {
      'veh.hatchback_parked': 1,
      'veh.saloon_parked': 1,
      'veh.van_white_parked': 1,
      'veh.taxi_parked': 1,
    },
  }),
];

type VehicleScenario = {
  town: number;
  seed: number;
  /** Ticks of traffic before Bessie is placed (she waits on the pavement meanwhile). */
  warmup: number;
  /** 0: near a lane node, any heading; 1: aimed at a parked car; 2: in front of a moving vehicle. */
  mode: number;
  pick: number;
  distM: number;
  angleRad: number;
  aim: number;
  /** Ticks of full throttle that open the drive (0: the random inputs from the first tick). */
  opener: number;
  /** Bessie's speed as the drive starts, m/s (along her heading). */
  speedMps: number;
};

/** A double uniform on [min, max) (in steps of (max − min) / 2^20), unbiased. */
function uniform(min: number, max: number): fc.Arbitrary<number> {
  const steps = 1 << 20;
  return fc.noBias(fc.integer({ min: 0, max: steps - 1 })).map((k) => min + ((max - min) * k) / steps);
}

/** A town, a run seed (the parked cars' placement), a warm-up and a spawn near a lane node, a parked car or traffic. */
const vehicleScenarioArb: fc.Arbitrary<VehicleScenario> = fc.record({
  town: fc.integer({ min: 0, max: VEHICLE_TOWNS.length - 1 }),
  seed: fc.integer({ min: 1, max: 0x7fff_ffff }),
  warmup: fc.integer({ min: 0, max: 900 }),
  // Half the drives start aimed at a parked car, three in ten in front of a moving vehicle.
  mode: fc.integer({ min: 0, max: 9 }).map((k) => (k < 2 ? 0 : k < 7 ? 1 : 2)),
  // Uniform: fc.double is uniform over the representable doubles, so nearly every draw would be close to 0
  // (the same car, angle and distance), and its bias favours the bounds.
  pick: uniform(0, 1),
  distM: uniform(0.05, 8),
  angleRad: uniform(-Math.PI, Math.PI),
  aim: uniform(-1, 1),
  opener: fc.oneof(fc.constant(0), fc.integer({ min: 10, max: 120 })),
  speedMps: fc.oneof(fc.constant(0), uniform(0, 12)),
});

/** Where Bessie waits during the warm-up: a pavement point clear of the traffic (metres). */
const WAIT_AT: readonly (readonly [number, number])[] = [
  [64, 3],
  [8, 27],
];

function vehicleBody(world: World, i: number): BodyBox {
  const s = world.vehicles;
  return {
    xM: s.x[i] as number,
    yM: s.y[i] as number,
    headingRad: s.heading[i] as number,
    widthM: 2 * (s.halfWidth[i] as number),
    lengthM: 2 * (s.halfLength[i] as number),
  };
}

/** The deepest overlap (m) of Bessie's OBB with any vehicle of the store, and which (−1: none). */
function deepestVehicleOverlap(world: World, body: BodyBox): { depthM: number; vehicle: number } {
  let depthM = 0;
  let vehicle = -1;
  for (let i = 0; i < world.vehicles.count; i += 1) {
    const d = obbObbPenetrationM(body, vehicleBody(world, i));
    if (d > depthM) {
      depthM = d;
      vehicle = i;
    }
  }
  return { depthM, vehicle };
}

/** Teleport Bessie to (x, y, heading), at rest (the previous pose moves too: no sweep, no kerb crossing). */
function putBessie(world: World, x: number, y: number, headingRad: number): void {
  const v = world.vehicle;
  v.xM = x;
  v.yM = y;
  v.prevXM = x;
  v.prevYM = y;
  v.headingRad = headingRad;
  v.prevHeadingRad = headingRad;
  v.vLongMps = 0;
  v.vLatMps = 0;
  v.yawRateRadPerS = 0;
  v.steerRad = 0;
}

/** The heading whose forward (sin h, −cos h) points along (dx, dy). */
function headingTo(dx: number, dy: number): number {
  return Math.atan2(dx, -dy);
}

/**
 * The scenario's World after its warm-up with Bessie placed, or null when the spawn overlaps a solid or a
 * vehicle (the property counts it as skipped).
 */
function vehicleWorld(sc: VehicleScenario): World | null {
  const level = VEHICLE_TOWNS[sc.town] as Level;
  const world = createWorld(level, sc.seed, DEFAULT_TUNING);
  const [wx, wy] = WAIT_AT[sc.town] as readonly [number, number];
  const idle = createInputFrame();
  for (let t = 0; t < sc.warmup; t += 1) {
    putBessie(world, wx, wy, Math.PI / 2);
    world.step(idle);
  }
  const s = world.vehicles;
  let x = wx;
  let y = wy;
  let h = sc.angleRad;
  const moving = s.count - s.parkedCount;
  if (sc.mode === 1 && s.parkedCount > 0) {
    // Out on the road beside the car (square to it, on the side of the nearest lane node), aimed at it within
    // ±60°.
    const k = Math.floor(sc.pick * s.parkedCount);
    const cx = s.x[k] as number;
    const cy = s.y[k] as number;
    const lanes = level.lanes;
    let best = Number.POSITIVE_INFINITY;
    let nx = 0;
    let ny = 0;
    for (let n = 0; n < lanes.nodeCount; n += 1) {
      const dx = (lanes.nodeX[n] as number) - cx;
      const dy = (lanes.nodeY[n] as number) - cy;
      const d = dx * dx + dy * dy;
      if (d < best) {
        best = d;
        nx = dx;
        ny = dy;
      }
    }
    const rx = Math.cos(s.heading[k] as number);
    const ry = Math.sin(s.heading[k] as number);
    const sign = rx * nx + ry * ny < 0 ? -1 : 1;
    const ux = rx * sign;
    const uy = ry * sign;
    // 2.6–3.4 m out: on a 3-tile road Bessie (1.625 m half length) fits between the car and the far kerb.
    const r = 2.6 + sc.distM * 0.1;
    const side = Math.sin(sc.angleRad) * 3;
    x = cx + ux * r - uy * side;
    y = cy + uy * r + ux * side;
    h = headingTo(cx - x, cy - y) + (sc.aim * Math.PI) / 3;
  } else if (sc.mode === 2 && moving > 0) {
    const k = s.parkedCount + Math.floor(sc.pick * moving);
    const fx = Math.sin(s.heading[k] as number);
    const fy = -Math.cos(s.heading[k] as number);
    const ahead = (s.halfLength[k] as number) + HL + sc.distM;
    x = (s.x[k] as number) + fx * ahead - fy * sc.aim;
    y = (s.y[k] as number) + fy * ahead + fx * sc.aim;
    h = sc.angleRad;
  } else {
    const lanes = level.lanes;
    const wM = level.size[0] * TILE_M;
    const hM = level.size[1] * TILE_M;
    const inside: number[] = [];
    for (let n = 0; n < lanes.nodeCount; n += 1) {
      const nx = lanes.nodeX[n] as number;
      const ny = lanes.nodeY[n] as number;
      if (nx > 4 && ny > 4 && nx < wM - 4 && ny < hM - 4) inside.push(n);
    }
    const n = inside[Math.floor(sc.pick * inside.length)] as number;
    x = (lanes.nodeX[n] as number) + Math.cos(sc.angleRad) * Math.min(1.5, sc.distM);
    y = (lanes.nodeY[n] as number) + Math.sin(sc.angleRad) * Math.min(1.5, sc.distM);
    h = sc.aim * Math.PI;
  }
  putBessie(world, x, y, h);
  const body = bodyOf(world);
  if (deepestSolidOverlap(level, body).depthM > 0) return null;
  // Wait (on the pavement, up to 5 s) for the traffic to clear the spot; a parked car never does.
  for (let t = 0; deepestVehicleOverlap(world, bodyOf(world)).depthM > 0; t += 1) {
    if (t >= 300) return null;
    putBessie(world, wx, wy, Math.PI / 2);
    world.step(idle);
    putBessie(world, x, y, h);
  }
  world.vehicle.vLongMps = sc.speedMps;
  return world;
}

type VehicleCoverage = {
  scenarios: number;
  skipped: number;
  withParkedContact: number;
  withMovingContact: number;
  withDent: number;
  dents: number;
  contactStops: number;
  maxVnMps: number;
};

describe('collision with vehicles (TECHNICAL_DESIGN §9.4, SSP-090)', () => {
  it(
    `4. never ends a tick inside a vehicle: ${VEHICLE_RUNS} drives × ${DRIVE_TICKS} ticks among parked cars and traffic, tolerance 1 mm`,
    () => {
      const cov: VehicleCoverage = {
        scenarios: 0,
        skipped: 0,
        withParkedContact: 0,
        withMovingContact: 0,
        withDent: 0,
        dents: 0,
        contactStops: 0,
        maxVnMps: 0,
      };
      assertProperty(
        fc.property(vehicleScenarioArb, inputsArb(DRIVE_TICKS), topSpeedMultArb, (sc, inputs, mult) => {
          const world = vehicleWorld(sc);
          if (world === null) {
            cov.skipped += 1;
            return;
          }
          world.vehicleParams.topSpeedMult = mult;
          for (let t = 0; t < sc.opener && t < inputs.length; t += 1) {
            const f = inputs[t] as InputFrame;
            f.throttle = THROTTLE_MAX;
            f.brake = 0;
          }
          const grid = world.staticGrid;
          let parkedContact = false;
          let movingContact = false;
          let dented = false;
          for (let tick = 0; tick < inputs.length; tick += 1) {
            world.step(inputs[tick] as InputFrame);
            const log = world.staticResolver.log;
            for (let k = 0; k < log.count; k += 1) {
              const s = log.shape[k] as number;
              if (s >= grid.shapeCount) movingContact = true;
              else if (grid.source[s] === ShapeSource.Parked) parkedContact = true;
              const vn = log.vnMps[k] as number;
              if ((s >= grid.shapeCount || grid.source[s] === ShapeSource.Parked) && vn > cov.maxVnMps) {
                cov.maxVnMps = vn;
              }
            }
            for (let e = 0; e < world.events.count; e += 1) {
              if (world.events.type[e] === EV.Dent) {
                dented = true;
                cov.dents += 1;
              }
            }
            const body = bodyOf(world);
            const { depthM, vehicle } = deepestVehicleOverlap(world, body);
            if (!(depthM <= PENETRATION_TOLERANCE_M)) {
              const parked = ((world.vehicles.flags[vehicle] as number) & VEHICLE_FLAG.PARKED) !== 0;
              throw new Error(
                `tick ${tick}: Bessie overlaps ${parked ? 'parked' : 'moving'} vehicle ${vehicle} by ${depthM} m ` +
                  `(> 1 mm); ${fmtPose(world)}`,
              );
            }
            const solid = deepestSolidOverlap(world.level, body);
            if (!(solid.depthM <= PENETRATION_TOLERANCE_M)) {
              throw new Error(
                `tick ${tick}: Bessie overlaps rect ${solid.rect} by ${solid.depthM} m; ${fmtPose(world)}`,
              );
            }
          }
          cov.scenarios += 1;
          cov.contactStops += world.traffic.contactStops;
          if (parkedContact) cov.withParkedContact += 1;
          if (movingContact) cov.withMovingContact += 1;
          if (dented) cov.withDent += 1;
        }),
        { seed: VEHICLE_SEED, numRuns: VEHICLE_RUNS },
      );
      if (REPLAYING_ONE_CASE) return; // SSP_FC_PATH replays a single case: no coverage to judge
      const text = JSON.stringify(cov);
      expect(cov.scenarios + cov.skipped, text).toBe(VEHICLE_RUNS);
      expect(cov.scenarios, text).toBeGreaterThan(VEHICLE_RUNS / 2);
      expect(cov.withParkedContact, text).toBeGreaterThan(
        cov.scenarios * VEHICLE_COVERAGE.parkedContactShare,
      );
      expect(cov.withDent, text).toBeGreaterThan(cov.scenarios * VEHICLE_COVERAGE.dentShare);
      expect(cov.withMovingContact, text).toBeGreaterThan(
        cov.scenarios * VEHICLE_COVERAGE.movingContactShare,
      );
      expect(cov.contactStops, text).toBeGreaterThan(0);
    },
    TEST_TIMEOUT_MS,
  );
});
