// NPC steering properties (SSP-081, TECHNICAL_DESIGN §11.1, §18.2). On random compiled fixture maps (ASCII
// rows through the real level compiler: a 3-tile road across the map with zebras, dropped kerbs on both
// pavements, kerbside and interior props, walls, hedges, railings and buildings), random walkers that do not
// jaywalk wander between random nav nodes with walkNpc (path following, the zebra kerb wait, prop avoidance,
// separation and sidestep) while Bessie drives about at random. After every tick, for every NPC:
//   - its centre is on a road tile only while it traverses a crossing edge: its crossEdge is a crossing of the
//     nav graph, it is not waiting at the kerb, and the tile is in that crossing's straight corridor;
//   - it is not inside a solid: its centre is on the map and off every blocked tile (solid with no nav node),
//     its circle overlaps no blocked tile or the map edge by more than 1 mm, and no prop footprint by more
//     than 1 mm.
// All checks are measured test-side from the compiled level, not through steering's own tables. Coverage floors
// (crossings completed, distance walked, paths planned) fail a generator that stopped exercising the rules.
// Fixed seed; a failure prints the seed and path to replay it (tests/support/fcCheck.ts).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { TILE_M } from '../../src/sim/constants.ts';
import { createInputFrame, STEER_MAX, THROTTLE_MAX } from '../../src/sim/inputFrame.ts';
import { COLLIDE, Ground, type Level, NAV_FLAG_CROSSING } from '../../src/sim/map.ts';
import type { Behaviour } from '../../src/sim/npc/behaviour.ts';
import { NavState, requestNavPath, walkNpc } from '../../src/sim/npc/steering.ts';
import { addNpcAt, NpcOrigin } from '../../src/sim/npc/store.ts';
import { nextInt } from '../../src/sim/rng.ts';
import { DEFAULT_TUNING, type PropFootprint } from '../../src/sim/tuning.ts';
import { createWorld } from '../../src/sim/world.ts';
import { assertProperty } from '../support/fcCheck.ts';
import { compileTown } from '../support/steeringTown.ts';

const SEED = 0x55_08_1a;
const RUNS = 150;
const TICKS = 1200;
const SLOP_M = 1e-3;

/** Kerbside picks (odd columns of the pavement rows): props, dropped kerbs and plain pavement. */
const KERB = ['.', '.', '.', '.', 'l', 'h', 'n', 'i', 'q', '!', 'd', 'd', 'f', 't'];
/** Interior picks. */
const INTERIOR = ['.', '.', '.', '.', '.', ':', ':', ',', 'l', 't', 'n', 'i', 'g'];
/** Interior blockers, only on (odd x, odd y): never 8-adjacent, so they never cut the town apart. */
const BLOCKERS = ['w', 'e', 'r', 'w'];

type Spec = {
  w: number;
  h: number;
  picks: number[];
  zebraCols: boolean[];
  forcedZebra: number;
  startX: number;
  walkers: { node: number; speed: number }[];
  drive: { throttle: number; steer: number }[];
};

const specArb: fc.Arbitrary<Spec> = fc
  .record({ w: fc.integer({ min: 12, max: 30 }), h: fc.integer({ min: 9, max: 14 }) })
  .chain(({ w, h }) =>
    fc.record({
      w: fc.constant(w),
      h: fc.constant(h),
      picks: fc.array(fc.nat({ max: 1 << 16 }), { minLength: w * h, maxLength: w * h }),
      zebraCols: fc.array(
        fc.nat({ max: 6 }).map((n) => n === 0),
        { minLength: w, maxLength: w },
      ),
      forcedZebra: fc.integer({ min: 0, max: w - 1 }),
      startX: fc.integer({ min: 0, max: w - 1 }),
      walkers: fc.array(
        fc.record({
          node: fc.nat({ max: 1 << 16 }),
          speed: fc.constantFrom(0.4, 0.6, 1.1, 1.2, 1.3, 1.4, 2.5),
        }),
        { minLength: 1, maxLength: 10 },
      ),
      drive: fc.array(
        fc.record({
          throttle: fc.integer({ min: 0, max: THROTTLE_MAX }),
          steer: fc.integer({ min: -STEER_MAX, max: STEER_MAX }),
        }),
        { minLength: Math.ceil(TICKS / 60), maxLength: Math.ceil(TICKS / 60) },
      ),
    }),
  );

function pick(set: readonly string[], n: number): string {
  return set[n % set.length] ?? '.';
}

/** The map rows of a spec (legal by construction). */
function rowsOf(spec: Spec): string[] {
  const { w, h } = spec;
  const zebra = (x: number): boolean =>
    (x === spec.forcedZebra || spec.zebraCols[x] === true) && x !== spec.startX;
  const rows: string[] = [];
  for (let y = 0; y < h; y++) {
    let row = '';
    for (let x = 0; x < w; x++) {
      const n = spec.picks[y * w + x] ?? 0;
      let c: string;
      if (y === 0) c = n % 5 === 0 ? '.' : 'A';
      // Gaps in the south terrace only on even columns, which never sit under a blocker.
      else if (y === h - 1) c = x % 2 === 0 && n % 4 === 0 ? '.' : 'B';
      else if (y === 1 || y === 5) c = x % 2 === 1 ? pick(KERB, n) : '.';
      else if (y <= 4) c = y === 3 && x === spec.startX ? '@' : zebra(x) ? 'z' : '#';
      else if (x % 2 === 1 && y % 2 === 1 && n % 3 === 0) c = pick(BLOCKERS, n >> 2);
      else c = pick(INTERIOR, n);
      row += c;
    }
    rows.push(row);
  }
  return rows;
}

/** Test-side tables of a compiled level. */
type Tables = {
  w: number;
  h: number;
  node: Int32Array;
  road: Uint8Array;
  blocked: Uint8Array;
};

function tablesOf(level: Level): Tables {
  const [w, h] = level.size;
  const node = new Int32Array(w * h).fill(-1);
  for (let n = 0; n < level.nav.nodeCount; n++) {
    const tx = Math.floor((level.nav.nodeX[n] as number) / TILE_M);
    const ty = Math.floor((level.nav.nodeY[n] as number) / TILE_M);
    node[ty * w + tx] = n;
  }
  const road = new Uint8Array(w * h);
  const blocked = new Uint8Array(w * h);
  for (let t = 0; t < w * h; t++) {
    const g = level.layers.ground[t] as number;
    road[t] = g >= Ground.Road && g <= Ground.RoadOneWayS ? 1 : 0;
    blocked[t] =
      ((level.layers.collide[t] as number) & COLLIDE.SOLID) !== 0 && (node[t] as number) < 0 ? 1 : 0;
  }
  return { w, h, node, road, blocked };
}

function isBlocked(t: Tables, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= t.w || ty >= t.h) return true;
  return t.blocked[ty * t.w + tx] === 1;
}

/** How deep a circle overlaps a prop footprint (0 when clear). */
function propDepth(
  fp: PropFootprint,
  px: number,
  py: number,
  rot: number,
  x: number,
  y: number,
  r: number,
): number {
  if (fp.shape === 'circle') return Math.max(0, r + fp.radiusM - Math.hypot(x - px, y - py));
  // Box: local +x right (cos θ, sin θ), local +y forward (sin θ, −cos θ); half extents width/2, length/2.
  const dx = x - px;
  const dy = y - py;
  const lx = dx * Math.cos(rot) + dy * Math.sin(rot);
  const ly = dx * Math.sin(rot) - dy * Math.cos(rot);
  const hw = fp.widthM / 2;
  const hl = fp.lengthM / 2;
  const qx = Math.min(hw, Math.max(-hw, lx));
  const qy = Math.min(hl, Math.max(-hl, ly));
  if (qx === lx && qy === ly) return r + Math.min(hw - Math.abs(lx), hl - Math.abs(ly));
  return Math.max(0, r - Math.hypot(lx - qx, ly - qy));
}

function deepestProp(level: Level, x: number, y: number, r: number): number {
  let worst = 0;
  const shapes: Readonly<Record<string, PropFootprint | undefined>> = DEFAULT_TUNING.propFootprints.shapes;
  for (const p of level.props) {
    if (Math.abs(p.x - x) > 3 || Math.abs(p.y - y) > 3) continue;
    const fp = shapes[p.id];
    if (fp === undefined) throw new Error(`no footprint for ${p.id}`);
    worst = Math.max(worst, propDepth(fp, p.x, p.y, p.rot, x, y, r));
  }
  return worst;
}

/** How deep a circle overlaps a blocked tile or the map edge (0 when clear). */
function deepestBlocked(t: Tables, x: number, y: number, r: number): number {
  const tx = Math.floor(x / TILE_M);
  const ty = Math.floor(y / TILE_M);
  let worst = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!isBlocked(t, tx + dx, ty + dy)) continue;
      const x0 = (tx + dx) * TILE_M;
      const y0 = (ty + dy) * TILE_M;
      const qx = Math.min(x0 + TILE_M, Math.max(x0, x));
      const qy = Math.min(y0 + TILE_M, Math.max(y0, y));
      worst = Math.max(worst, r - Math.hypot(x - qx, y - qy));
    }
  }
  return worst;
}

/** A walker that wanders between random nav nodes, sidestepping Bessie. Never jaywalks. */
const wanderer: Behaviour = {
  initial: 0,
  jaywalks: false,
  tick(w, i) {
    const s = w.npc.navState[i] as number;
    if (s === NavState.Idle || s === NavState.Arrived || s === NavState.NoPath) {
      requestNavPath(w, i, nextInt(w.npcAi.rng, w.level.nav.nodeCount));
    }
    walkNpc(w, i, true);
  },
  onStimulus() {},
};

const totals = { crossings: 0, roadTicks: 0, walkedM: 0, searches: 0, maps: 0, npcTicks: 0 };

function check(spec: Spec): void {
  const level = compileTown(rowsOf(spec));
  const t = tablesOf(level);
  const nav = level.nav;
  const world = createWorld(level, spec.picks[0] ?? 1, DEFAULT_TUNING);
  world.npcAi.behaviours.fill(wanderer);
  const r = DEFAULT_TUNING.streetLife.npcRadius.humanM;
  for (const walker of spec.walkers) {
    const n = walker.node % nav.nodeCount;
    const x = nav.nodeX[n] as number;
    const y = nav.nodeY[n] as number;
    if (deepestProp(level, x, y, r) > 0) continue; // start clear of props, as the property is inductive
    const i = addNpcAt(world.npc, 0, NpcOrigin.Ambient, x, y);
    world.npc.radius[i] = r;
    world.npc.walkMps[i] = walker.speed;
  }
  const input = createInputFrame();
  const crossingOf = new Int32Array(world.npc.capacity).fill(-1);
  for (let tick = 0; tick < TICKS; tick++) {
    const seg = spec.drive[Math.floor(tick / 60)] ?? { throttle: 0, steer: 0 };
    input.throttle = seg.throttle;
    input.steer = seg.steer;
    world.step(input);
    const npc = world.npc;
    for (let i = 0; i < npc.count; i++) {
      const x = npc.x[i] as number;
      const y = npc.y[i] as number;
      const tx = Math.floor(x / TILE_M);
      const ty = Math.floor(y / TILE_M);
      const where = `tick ${tick} npc ${i} at (${x.toFixed(3)}, ${y.toFixed(3)})`;
      expect(tx >= 0 && ty >= 0 && tx < t.w && ty < t.h, `${where}: off the map`).toBe(true);
      expect(isBlocked(t, tx, ty), `${where}: centre in a solid`).toBe(false);
      expect(deepestBlocked(t, x, y, r), `${where}: circle in a solid`).toBeLessThanOrEqual(SLOP_M);
      expect(deepestProp(level, x, y, r), `${where}: circle in a prop`).toBeLessThanOrEqual(SLOP_M);
      if (t.road[ty * t.w + tx] === 1) {
        const e = npc.crossEdge[i] as number;
        expect(e, `${where}: on the road with no crossing edge`).toBeGreaterThanOrEqual(0);
        expect(
          (nav.edgeFlags[e] as number) & NAV_FLAG_CROSSING,
          `${where}: edge ${e} is no crossing`,
        ).not.toBe(0);
        expect(npc.navState[i], `${where}: on the road while waiting at the kerb`).not.toBe(
          NavState.KerbWait,
        );
        const a = nav.edgeFrom[e] as number;
        const b = nav.edgeTo[e] as number;
        const ax = Math.floor((nav.nodeX[a] as number) / TILE_M);
        const ay = Math.floor((nav.nodeY[a] as number) / TILE_M);
        const bx = Math.floor((nav.nodeX[b] as number) / TILE_M);
        const by = Math.floor((nav.nodeY[b] as number) / TILE_M);
        const inCorridor =
          tx >= Math.min(ax, bx) &&
          tx <= Math.max(ax, bx) &&
          ty >= Math.min(ay, by) &&
          ty <= Math.max(ay, by);
        expect(inCorridor, `${where}: on the road outside crossing ${e}'s corridor`).toBe(true);
        totals.roadTicks++;
      }
      const cross = npc.crossEdge[i] as number;
      const state = npc.navState[i] as number;
      const onCrossing = state === NavState.Crossing ? cross : -1;
      if ((crossingOf[i] as number) >= 0 && onCrossing < 0) totals.crossings++;
      crossingOf[i] = onCrossing;
      totals.walkedM += Math.hypot(x - (npc.prevX[i] as number), y - (npc.prevY[i] as number));
      totals.npcTicks++;
    }
  }
  totals.searches += world.npcAi.steering.searches;
  totals.maps++;
}

describe('NPC steering on random compiled maps (TECHNICAL_DESIGN §11.1, SSP-081)', () => {
  it('a non-jaywalking NPC is on a road tile only while traversing a crossing edge, and never ends a tick inside a solid', {
    timeout: 120_000,
  }, () => {
    assertProperty(
      fc.property(specArb, (spec) => {
        check(spec);
      }),
      { seed: SEED, numRuns: RUNS },
    );
    console.log(
      `npcSteering: ${totals.maps} maps, ${totals.npcTicks} NPC-ticks, ${totals.walkedM.toFixed(0)} m walked, ` +
        `${totals.crossings} crossings completed, ${totals.roadTicks} NPC-ticks on a crossing's road, ` +
        `${totals.searches} path searches`,
    );
    // Coverage: the walkers really walked, planned, and crossed the road.
    expect(totals.maps).toBe(RUNS);
    expect(totals.walkedM).toBeGreaterThan(RUNS * 50);
    expect(totals.crossings).toBeGreaterThan(RUNS / 2);
    expect(totals.roadTicks).toBeGreaterThan(RUNS * 60);
    expect(totals.searches).toBeGreaterThan(RUNS * 3);
  });
});
