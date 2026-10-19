// Knockable-body properties (TECHNICAL_DESIGN §9.3, §9.5; SSP-092): over 10,000 generated impacts at up to
// 17.2 m/s, a prop.traffic_cone (the smallest body, 0.4 m) never passes through a 0.3 m bollard (the
// prop.bollard circle footprint, r = 0.15 m) or a 1-tile (2 m) wall, and never ends a tick inside either.
//
//   1. Bessie → cone → wall (2,500): Bessie coasts east (±34°) at 0–17.2 m/s into a cone that sits ahead of her
//      bumper, anywhere across it and at any heading, with a full-height 1-tile wall up to 4 m beyond.
//   2. Flung cone → wall (2,500): a lone cone slides at 0–20.64 m/s ((1 + bessieRestitution) × 17.2, the
//      fastest Bessie can send one) within ±75° of the wall's normal, spinning at up to ±30 rad/s.
//   3. Bessie → cone → bollard (2,500): Bessie coasts at 0–17.2 m/s into a cone lined up on a bollard up to
//      3 m beyond it, so she pins it against the bollard as she stops on it herself.
//   4. Flung cone → bollard (2,500): a lone cone slides at 0–20.64 m/s, spinning, aimed so that its path hits
//      the bollard.
//
// "Never passes through" is checked at the end of every tick: for the wall, both ends of the cone centre's
// tick segment stay west of the wall face and the cone's OBB overlaps the wall (or the map edge) by at most
// 1 mm; for the bollard, the centre's tick segment never comes within the bollard's radius of its centre and
// the OBB overlaps it by at most 1 mm. The overlap measures are test-side geometry (tests/support/
// solidOverlap.ts and the circle test below), independent of src/sim/collision. Each property checks
// coverage floors (how many scenarios reached the obstacle, and how fast), so a generator that stopped
// colliding fails. Failures print the fast-check seed and path first (tests/support/fcCheck.ts).
//
// Bessie coasts with drag zeroed at a written vLong (topSpeedMult = 17.2 / 11), as in collision.prop.test.ts.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import tuningJson from '../../src/data/tuning.json' with { type: 'json' };
import { addBody, knockableKindIndex } from '../../src/sim/bodies.ts';
import { TILE_M } from '../../src/sim/constants.ts';
import { createInputFrame } from '../../src/sim/inputFrame.ts';
import { COLLIDE, type LevelProp } from '../../src/sim/map.ts';
import { DEFAULT_TUNING, loadTuning, type Tuning } from '../../src/sim/tuning.ts';
import type { World } from '../../src/sim/world.ts';
import { worldFromCollideGrid } from '../support/collisionWorld.ts';
import { assertProperty, reproParams } from '../support/fcCheck.ts';
import { type BodyBox, obbBoundaryPenetrationM, obbRectPenetrationM } from '../support/solidOverlap.ts';

const PENETRATION_TOLERANCE_M = 1e-3;
const MAX_SPEED_MPS = 17.2;
const KN = DEFAULT_TUNING.knockables;
/** The fastest a cone leaves Bessie: (1 + bessieRestitution) × 17.2 m/s. */
const MAX_FLING_MPS = (1 + KN.contact.bessieRestitution) * MAX_SPEED_MPS;
const MAX_SPIN = 30;

const RUNS = { bessieWall: 2500, flingWall: 2500, bessieBollard: 2500, flingBollard: 2500 } as const;
const SEEDS = {
  bessieWall: 0x5092_01,
  flingWall: 0x5092_02,
  bessieBollard: 0x5092_03,
  flingBollard: 0x5092_04,
};

/** Coverage floors, well under what the fixed seeds give (measured values are in the commit message). */
const COVERAGE = { reachedShare: 0.4, knockedShare: 0.4 } as const;

const REPLAYING_ONE_CASE = reproParams(0).path !== undefined;
const TEST_TIMEOUT_MS = 300_000;
const BESSIE_TICKS = 90;
const FLING_TICKS = 60;

const SWEEPER = DEFAULT_TUNING.vehicle.sweeper;
const HL = SWEEPER.body.lengthM / 2;
const CONE = KN.bodies['prop.traffic_cone'];
const CONE_KIND = knockableKindIndex('prop.traffic_cone');
const CONE_HALF = CONE.widthM / 2; // 0.2 m (the cone is square)
const CONE_DIAG = Math.SQRT2 * CONE_HALF;
const BOLLARD = DEFAULT_TUNING.propFootprints.shapes['prop.bollard'];
if (BOLLARD.shape !== 'circle') throw new Error('prop.bollard must be a circle footprint');
const BOLLARD_R = BOLLARD.radiusM;

const NO_DRAG: Tuning = (() => {
  const raw = structuredClone(tuningJson);
  raw.vehicle.sweeper.drag.rollingMps2 = 0;
  raw.vehicle.sweeper.drag.quadraticPerM = 0;
  return loadTuning(raw);
})();
const NEUTRAL = createInputFrame();

// ---------------------------------------------------------------------------------------------------------
// Test-side geometry
// ---------------------------------------------------------------------------------------------------------

function coneBox(world: World): BodyBox {
  const b = world.bodies;
  return {
    xM: b.x[0] as number,
    yM: b.y[0] as number,
    headingRad: b.heading[0] as number,
    widthM: CONE.widthM,
    lengthM: CONE.lengthM,
  };
}

/** World-x half extent of the cone's OBB. */
function extentX(box: BodyBox): number {
  const c = Math.abs(Math.cos(box.headingRad));
  const s = Math.abs(Math.sin(box.headingRad));
  return (box.widthM / 2) * c + (box.lengthM / 2) * s;
}

/** Signed distance (m) from the OBB to the circle centre minus r: < 0 is the penetration depth. */
function obbCircleGapM(box: BodyBox, cx: number, cy: number, r: number): number {
  const rx = Math.cos(box.headingRad);
  const ry = Math.sin(box.headingRad);
  const fx = ry;
  const fy = -rx;
  const dx = cx - box.xM;
  const dy = cy - box.yM;
  const lx = dx * rx + dy * ry;
  const ly = dx * fx + dy * fy;
  const hw = box.widthM / 2;
  const hl = box.lengthM / 2;
  const qx = Math.max(-hw, Math.min(hw, lx));
  const qy = Math.max(-hl, Math.min(hl, ly));
  const out = Math.hypot(lx - qx, ly - qy);
  if (out > 0) return out - r;
  return -(Math.min(hw - Math.abs(lx), hl - Math.abs(ly)) + r);
}

function segmentHitsCircle(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  cx: number,
  cy: number,
  r: number,
) {
  const sx = x1 - x0;
  const sy = y1 - y0;
  const len2 = sx * sx + sy * sy;
  let t = len2 > 0 ? ((cx - x0) * sx + (cy - y0) * sy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(x0 + sx * t - cx, y0 + sy * t - cy) <= r;
}

/**
 * True when this tick's step turned the cone's velocity (an impulse: friction only ever scales it) and the
 * cone started the tick within `reachM` of the obstacle, so the obstacle was what it hit. A fast cone hits
 * and rebounds inside one tick, ending it clear of the obstacle, so touching at the end of a tick alone
 * undercounts the hits.
 */
function turned(vx0: number, vy0: number, vx1: number, vy1: number): boolean {
  const s0 = Math.hypot(vx0, vy0);
  const s1 = Math.hypot(vx1, vy1);
  if (s0 === 0 || s1 === 0) return false;
  return Math.abs(vx0 * vy1 - vy0 * vx1) > 1e-9 * s0 * s1 || vx0 * vx1 + vy0 * vy1 < 0;
}

function fmtCone(world: World): string {
  const b = world.bodies;
  return (
    `cone (${(b.x[0] as number).toFixed(6)}, ${(b.y[0] as number).toFixed(6)}, h ${(b.heading[0] as number).toFixed(4)}) ` +
    `prev (${(b.prevX[0] as number).toFixed(6)}, ${(b.prevY[0] as number).toFixed(6)}) ` +
    `v (${(b.vx[0] as number).toFixed(4)}, ${(b.vy[0] as number).toFixed(4)}) w ${(b.omega[0] as number).toFixed(4)}`
  );
}

type Coverage = { scenarios: number; reached: number; knocked: number; maxReachSpeed: number };
const createCoverage = (): Coverage => ({ scenarios: 0, reached: 0, knocked: 0, maxReachSpeed: 0 });
const fmtCoverage = (c: Coverage): string =>
  `coverage: ${c.scenarios} scenarios, ${c.reached} reached the obstacle, ${c.knocked} knocked by Bessie, ` +
  `fastest arrival ${c.maxReachSpeed.toFixed(3)} m/s`;

/** Put Bessie at the 17.2 m/s maximum and coasting at `speedMps`. */
function launchBessie(world: World, speedMps: number): void {
  world.vehicleParams.topSpeedMult = MAX_SPEED_MPS / SWEEPER.drive.topSpeedTransitMps;
  world.vehicle.vLongMps = speedMps;
}

// ---------------------------------------------------------------------------------------------------------
// Scenario generators
// ---------------------------------------------------------------------------------------------------------

const speedArb = (max: number) => fc.oneof(fc.constant(max), fc.double({ min: 0, max, noNaN: true }));
const unit = fc.double({ min: 0, max: 1, noNaN: true });
const signed = (m: number) => fc.oneof(fc.constant(0), fc.double({ min: -m, max: m, noNaN: true }));
const headingArb = fc.double({ min: -Math.PI, max: Math.PI, noNaN: true });

/** Map height for the wall scenarios: 10 tiles (20 m). */
const WALL_H = 10;

type WallScenario = {
  w: number;
  wallFrac: number;
  coneGapM: number;
  coneY: number;
  coneHeading: number;
  // Via Bessie:
  aimRad: number;
  aheadM: number;
  latM: number;
  speedMps: number;
  // Flung:
  spin: number;
};

const wallArb = (maxAim: number, maxSpeed: number): fc.Arbitrary<WallScenario> =>
  fc.record({
    w: fc.integer({ min: 12, max: 20 }),
    wallFrac: unit,
    coneGapM: fc.oneof(fc.constant(0), fc.double({ min: 0, max: 4, noNaN: true })),
    coneY: fc.double({ min: 8, max: WALL_H * TILE_M - 4, noNaN: true }),
    coneHeading: headingArb,
    aimRad: signed(maxAim),
    aheadM: fc.oneof(fc.constant(0), fc.double({ min: 0, max: 2, noNaN: true })),
    latM: signed(0.8),
    speedMps: speedArb(maxSpeed),
    spin: signed(MAX_SPIN),
  });

/** A world with a full-height wall in column wallCol, the cone 0.3 m + coneGapM west of its face. */
function wallWorld(s: WallScenario, bessie: boolean): { world: World; wallX0M: number } | null {
  const wallCol = 7 + Math.min(s.w - 9, Math.floor(s.wallFrac * (s.w - 8)));
  const wallX0M = wallCol * TILE_M;
  const collide = new Uint8Array(s.w * WALL_H);
  for (let row = 0; row < WALL_H; row += 1) collide[row * s.w + wallCol] = COLLIDE.SOLID;
  const coneX = wallX0M - 0.3 - s.coneGapM;
  const heading = Math.PI / 2 + s.aimRad;
  const fx = Math.sin(heading);
  const fy = -Math.cos(heading);
  // Bessie behind the cone along her heading (via Bessie), or parked in the far south-west corner (flung).
  let px = 3;
  let py = 3;
  if (bessie) {
    const back = HL + 0.3 + s.aheadM;
    px = coneX - fx * back - Math.cos(heading) * s.latM;
    py = s.coneY - fy * back - Math.sin(heading) * s.latM;
    const c = Math.abs(Math.cos(heading));
    const sn = Math.abs(Math.sin(heading));
    const extX = (SWEEPER.body.widthM / 2) * c + HL * sn;
    const extY = (SWEEPER.body.widthM / 2) * sn + HL * c;
    if (px - extX < 0.05 || px + extX > wallX0M - 0.05) return null;
    if (py - extY < 0.05 || py + extY > WALL_H * TILE_M - 0.05) return null;
  }
  const world = worldFromCollideGrid(
    { w: s.w, h: WALL_H, collide, player: { x: px, y: py, heading } },
    NO_DRAG,
  );
  addBody(world.bodies, CONE_KIND, coneX, s.coneY, s.coneHeading);
  return { world, wallX0M };
}

type BollardScenario = {
  bxFrac: number;
  byFrac: number;
  dirRad: number;
  gapM: number;
  offM: number;
  coneHeading: number;
  aheadM: number;
  latM: number;
  speedMps: number;
  spin: number;
};

const BOLLARD_MAP = 16;

const bollardArb = (maxDir: number, maxSpeed: number): fc.Arbitrary<BollardScenario> =>
  fc.record({
    bxFrac: unit,
    byFrac: unit,
    dirRad: signed(maxDir),
    gapM: fc.oneof(fc.constant(0), fc.double({ min: 0, max: 3, noNaN: true })),
    // Off the line by less than the cone's half width plus the bollard's radius, so the path hits it.
    offM: signed(CONE_HALF + BOLLARD_R - 0.01),
    coneHeading: headingArb,
    aheadM: fc.oneof(fc.constant(0), fc.double({ min: 0, max: 2, noNaN: true })),
    latM: signed(0.6),
    speedMps: speedArb(maxSpeed),
    spin: signed(MAX_SPIN),
  });

/** An open 16 × 16 tile map with one bollard; the cone lined up on it along dir, gapM short of touching. */
function bollardWorld(s: BollardScenario, bessie: boolean): { world: World; bx: number; by: number } {
  // Bollard in [14, 26] × [10, 22]; Bessie parks at (3, 3) for the flung scenarios, well clear.
  const bx = 14 + s.bxFrac * 12;
  const by = 10 + s.byFrac * 12;
  const props: LevelProp[] = [{ id: 'prop.bollard', x: bx, y: by, rot: 0 }];
  // Bessie's scenarios head east ± dir; the flung ones head anywhere (dir is then the full angle).
  const heading = bessie ? Math.PI / 2 + s.dirRad : s.dirRad;
  const fx = Math.sin(heading);
  const fy = -Math.cos(heading);
  const rx = Math.cos(heading);
  const ry = Math.sin(heading);
  // The cone's centre: back along the heading from the bollard by r + the cone's half diagonal + gap.
  const back = BOLLARD_R + Math.SQRT2 * CONE_HALF + 0.001 + s.gapM;
  const cx = bx - fx * back + rx * s.offM;
  const cy = by - fy * back + ry * s.offM;
  let px = 3;
  let py = 3;
  if (bessie) {
    const b2 = HL + 0.3 + s.aheadM;
    px = cx - fx * b2 - rx * s.latM;
    py = cy - fy * b2 - ry * s.latM;
  }
  const world = worldFromCollideGrid(
    {
      w: BOLLARD_MAP,
      h: BOLLARD_MAP,
      collide: new Uint8Array(BOLLARD_MAP * BOLLARD_MAP),
      player: { x: px, y: py, heading },
      props,
    },
    NO_DRAG,
  );
  addBody(world.bodies, CONE_KIND, cx, cy, s.coneHeading);
  return { world, bx, by };
}

// ---------------------------------------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------------------------------------

/** Run `ticks`, checking the wall property every tick; returns whether the cone reached the wall, and how fast. */
function runWall(world: World, wallX0M: number, ticks: number, cov: Coverage, bessieSpeed: number): void {
  const b = world.bodies;
  const mapW = world.level.size[0] * TILE_M;
  const mapH = world.level.size[1] * TILE_M;
  let reached = false;
  for (let tick = 0; tick < ticks; tick += 1) {
    if (bessieSpeed >= 0 && tick === 0) launchBessie(world, bessieSpeed);
    const vx0 = b.vx[0] as number;
    const vy0 = b.vy[0] as number;
    const speed = Math.hypot(vx0, vy0);
    world.step(NEUTRAL);
    const x0 = b.prevX[0] as number;
    const x1 = b.x[0] as number;
    const hitThisTick =
      turned(vx0, vy0, b.vx[0] as number, b.vy[0] as number) && x0 + CONE_DIAG + speed / 60 >= wallX0M;
    if (!(x0 < wallX0M && x1 < wallX0M)) {
      throw new Error(
        `tick ${tick}: the cone's centre crossed the wall face x = ${wallX0M}; ${fmtCone(world)}`,
      );
    }
    const box = coneBox(world);
    const depth = Math.max(
      obbRectPenetrationM(box, wallX0M, 0, wallX0M + TILE_M, mapH),
      obbBoundaryPenetrationM(box, mapW, mapH),
    );
    if (!(depth <= PENETRATION_TOLERANCE_M)) {
      throw new Error(
        `tick ${tick}: the cone overlaps the wall or the map edge by ${depth} m; ${fmtCone(world)}`,
      );
    }
    if (!reached && (hitThisTick || x1 + extentX(box) >= wallX0M - 1e-3)) {
      reached = true;
      if (speed > cov.maxReachSpeed) cov.maxReachSpeed = speed;
    }
  }
  cov.scenarios += 1;
  if (reached) cov.reached += 1;
  if (b.bodiesKnocked > 0) cov.knocked += 1;
}

function runBollard(
  world: World,
  bx: number,
  by: number,
  ticks: number,
  cov: Coverage,
  bessieSpeed: number,
): void {
  const b = world.bodies;
  let reached = false;
  for (let tick = 0; tick < ticks; tick += 1) {
    if (bessieSpeed >= 0 && tick === 0) launchBessie(world, bessieSpeed);
    const vx0 = b.vx[0] as number;
    const vy0 = b.vy[0] as number;
    const speed = Math.hypot(vx0, vy0);
    world.step(NEUTRAL);
    const x0 = b.prevX[0] as number;
    const y0 = b.prevY[0] as number;
    const hitThisTick =
      turned(vx0, vy0, b.vx[0] as number, b.vy[0] as number) &&
      Math.hypot(x0 - bx, y0 - by) <= BOLLARD_R + CONE_DIAG + speed / 60 + 0.01;
    const x1 = b.x[0] as number;
    const y1 = b.y[0] as number;
    if (segmentHitsCircle(x0, y0, x1, y1, bx, by, BOLLARD_R)) {
      throw new Error(
        `tick ${tick}: the cone's centre swept through the bollard at (${bx}, ${by}); ${fmtCone(world)}`,
      );
    }
    const gap = obbCircleGapM(coneBox(world), bx, by, BOLLARD_R);
    if (!(gap >= -PENETRATION_TOLERANCE_M)) {
      throw new Error(`tick ${tick}: the cone overlaps the bollard by ${-gap} m; ${fmtCone(world)}`);
    }
    if (!reached && (hitThisTick || gap <= 1e-3)) {
      reached = true;
      if (speed > cov.maxReachSpeed) cov.maxReachSpeed = speed;
    }
  }
  cov.scenarios += 1;
  if (reached) cov.reached += 1;
  if (b.bodiesKnocked > 0) cov.knocked += 1;
}

const WALL_EXAMPLE: WallScenario = {
  w: 16,
  wallFrac: 0.5,
  coneGapM: 1,
  coneY: 10,
  coneHeading: 0,
  aimRad: 0,
  aheadM: 0.5,
  latM: 0,
  speedMps: MAX_SPEED_MPS,
  spin: 0,
};

const BOLLARD_EXAMPLE: BollardScenario = {
  bxFrac: 0.5,
  byFrac: 0.5,
  dirRad: 0,
  gapM: 0.5,
  offM: 0,
  coneHeading: 0,
  aheadM: 0.5,
  latM: 0,
  speedMps: MAX_SPEED_MPS,
  spin: 0,
};

describe('knockable bodies never tunnel (TECHNICAL_DESIGN §9.3, §9.5; SSP-092)', () => {
  it(
    `1. Bessie → cone → 1-tile wall at 0–17.2 m/s: ${RUNS.bessieWall} impacts`,
    () => {
      const cov = createCoverage();
      assertProperty(
        fc.property(wallArb(0.6, MAX_SPEED_MPS), (s) => {
          const made = wallWorld(s, true);
          fc.pre(made !== null);
          if (made === null) return;
          runWall(made.world, made.wallX0M, BESSIE_TICKS, cov, s.speedMps);
        }),
        {
          seed: SEEDS.bessieWall,
          numRuns: RUNS.bessieWall,
          examples: [
            [{ ...WALL_EXAMPLE }],
            [{ ...WALL_EXAMPLE, coneGapM: 0, aheadM: 0 }],
            [{ ...WALL_EXAMPLE, latM: 0.8, coneHeading: 0.7 }],
            [{ ...WALL_EXAMPLE, aimRad: 0.6, latM: -0.8 }],
          ],
        },
      );
      if (REPLAYING_ONE_CASE) return;
      console.log(`1. ${fmtCoverage(cov)}`);
      expect(cov.scenarios, fmtCoverage(cov)).toBe(RUNS.bessieWall);
      expect(cov.knocked, fmtCoverage(cov)).toBeGreaterThan(RUNS.bessieWall * COVERAGE.knockedShare);
      expect(cov.reached, fmtCoverage(cov)).toBeGreaterThan(RUNS.bessieWall * COVERAGE.reachedShare);
      expect(cov.maxReachSpeed, fmtCoverage(cov)).toBeGreaterThan(MAX_SPEED_MPS);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    `2. flung cone → 1-tile wall at 0–${MAX_FLING_MPS.toFixed(2)} m/s, spinning: ${RUNS.flingWall} impacts`,
    () => {
      const cov = createCoverage();
      assertProperty(
        fc.property(wallArb(1.3, MAX_FLING_MPS), (s) => {
          const made = wallWorld(s, false);
          if (made === null) throw new Error('the flung wall scenario always builds');
          const b = made.world.bodies;
          b.vx[0] = Math.cos(s.aimRad) * s.speedMps;
          b.vy[0] = Math.sin(s.aimRad) * s.speedMps;
          b.omega[0] = s.spin;
          runWall(made.world, made.wallX0M, FLING_TICKS, cov, -1);
        }),
        {
          seed: SEEDS.flingWall,
          numRuns: RUNS.flingWall,
          examples: [
            [{ ...WALL_EXAMPLE, speedMps: MAX_FLING_MPS }],
            [{ ...WALL_EXAMPLE, speedMps: MAX_FLING_MPS, coneGapM: 0, spin: MAX_SPIN }],
            [{ ...WALL_EXAMPLE, speedMps: MAX_FLING_MPS, aimRad: 1.3, coneHeading: 0.785 }],
          ],
        },
      );
      if (REPLAYING_ONE_CASE) return;
      console.log(`2. ${fmtCoverage(cov)}`);
      expect(cov.scenarios, fmtCoverage(cov)).toBe(RUNS.flingWall);
      expect(cov.reached, fmtCoverage(cov)).toBeGreaterThan(RUNS.flingWall * COVERAGE.reachedShare);
      expect(cov.maxReachSpeed, fmtCoverage(cov)).toBeGreaterThan(MAX_FLING_MPS - 0.2);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    `3. Bessie → cone → 0.3 m bollard at 0–17.2 m/s: ${RUNS.bessieBollard} impacts`,
    () => {
      const cov = createCoverage();
      assertProperty(
        fc.property(bollardArb(0.3, MAX_SPEED_MPS), (s) => {
          const { world, bx, by } = bollardWorld(s, true);
          runBollard(world, bx, by, BESSIE_TICKS, cov, s.speedMps);
        }),
        {
          seed: SEEDS.bessieBollard,
          numRuns: RUNS.bessieBollard,
          examples: [
            [{ ...BOLLARD_EXAMPLE }],
            [{ ...BOLLARD_EXAMPLE, gapM: 0, aheadM: 0 }],
            [{ ...BOLLARD_EXAMPLE, offM: CONE_HALF + BOLLARD_R - 0.01, coneHeading: 0.785 }],
            [{ ...BOLLARD_EXAMPLE, latM: 0.6, dirRad: 0.3 }],
          ],
        },
      );
      if (REPLAYING_ONE_CASE) return;
      console.log(`3. ${fmtCoverage(cov)}`);
      expect(cov.scenarios, fmtCoverage(cov)).toBe(RUNS.bessieBollard);
      expect(cov.knocked, fmtCoverage(cov)).toBeGreaterThan(RUNS.bessieBollard * COVERAGE.knockedShare);
      expect(cov.reached, fmtCoverage(cov)).toBeGreaterThan(RUNS.bessieBollard * COVERAGE.reachedShare);
      expect(cov.maxReachSpeed, fmtCoverage(cov)).toBeGreaterThan(MAX_SPEED_MPS);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    `4. flung cone → 0.3 m bollard at 0–${MAX_FLING_MPS.toFixed(2)} m/s, spinning: ${RUNS.flingBollard} impacts`,
    () => {
      const cov = createCoverage();
      assertProperty(
        fc.property(bollardArb(Math.PI, MAX_FLING_MPS), (s) => {
          const { world, bx, by } = bollardWorld(s, false);
          const b = world.bodies;
          const fx = Math.sin(s.dirRad);
          const fy = -Math.cos(s.dirRad);
          b.vx[0] = fx * s.speedMps;
          b.vy[0] = fy * s.speedMps;
          b.omega[0] = s.spin;
          runBollard(world, bx, by, FLING_TICKS, cov, -1);
        }),
        {
          seed: SEEDS.flingBollard,
          numRuns: RUNS.flingBollard,
          examples: [
            [{ ...BOLLARD_EXAMPLE, speedMps: MAX_FLING_MPS }],
            [{ ...BOLLARD_EXAMPLE, speedMps: MAX_FLING_MPS, gapM: 0, spin: MAX_SPIN }],
            [{ ...BOLLARD_EXAMPLE, speedMps: MAX_FLING_MPS, offM: CONE_HALF + BOLLARD_R - 0.01, dirRad: 2 }],
          ],
        },
      );
      if (REPLAYING_ONE_CASE) return;
      console.log(`4. ${fmtCoverage(cov)}`);
      expect(cov.scenarios, fmtCoverage(cov)).toBe(RUNS.flingBollard);
      expect(cov.reached, fmtCoverage(cov)).toBeGreaterThan(RUNS.flingBollard * COVERAGE.reachedShare);
      expect(cov.maxReachSpeed, fmtCoverage(cov)).toBeGreaterThan(MAX_FLING_MPS - 0.2);
    },
    TEST_TIMEOUT_MS,
  );
});
