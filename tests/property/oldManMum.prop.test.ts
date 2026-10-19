// Properties of SSP-085's walkers (TECHNICAL_DESIGN §11.1, §18.2) on random compiled fixture maps: a 3-tile road
// across the map with random zebra columns, dropped kerbs and kerbside props on both pavements, interior props
// and walls, run through the real level compiler (tests/support/steeringTown.ts).
//   1. Zebra-only paths: for random node pairs, the old man's path search (navAvoid = every crossing but the
//      zebra) finds a path exactly when a reference Dijkstra over the graph without the non-zebra crossings
//      does, of the same length (to the millimetre rounding of the edge costs), and every crossing it uses is a
//      ZEBRA edge.
//   2. Motion: old men, mums with pushchairs and shoppers, on their registry behaviours, wander the map while
//      Bessie drives about at random. After every tick the old man is on a road tile only on a zebra edge's
//      corridor, and no NPC's circle (the mum's 0.55 m footprint included) is inside a blocked tile, the map
//      edge or a prop footprint by more than 1 mm.
// Fixed seed; a failure prints the seed and path to replay it (tests/support/fcCheck.ts).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { TILE_M } from '../../src/sim/constants.ts';
import { NPC_IDS } from '../../src/sim/entities.ts';
import { createInputFrame, STEER_MAX, THROTTLE_MAX } from '../../src/sim/inputFrame.ts';
import { COLLIDE, Ground, type Level, NAV_FLAG, NAV_FLAG_CROSSING } from '../../src/sim/map.ts';
import { OLD_MAN_NAV_AVOID } from '../../src/sim/npc/behaviours/oldManFrame.ts';
import { findNavPath, navEdgeBetween } from '../../src/sim/npc/steering.ts';
import { addNpcAt, NpcOrigin, setNpcState } from '../../src/sim/npc/store.ts';
import { DEFAULT_TUNING, type PropFootprint } from '../../src/sim/tuning.ts';
import { createWorld, type World } from '../../src/sim/world.ts';
import { assertProperty } from '../support/fcCheck.ts';
import { compileTown } from '../support/steeringTown.ts';

const SEED = 0x55_08_5a;
const SLOP_M = 1e-3;
const KINDS = ['npc.old_man_frame', 'npc.mum_pushchair', 'npc.shopper'] as const;

const KERB = ['.', '.', '.', '.', 'l', 'h', 'n', 'i', 'q', '!', 'd', 'd', 'f', 't'];
const INTERIOR = ['.', '.', '.', '.', '.', ':', ':', ',', 'l', 't', 'n', 'i', 'g'];
const BLOCKERS = ['w', 'e', 'r', 'w'];

type MapSpec = {
  w: number;
  h: number;
  picks: number[];
  zebraCols: boolean[];
  /** A column that is always a zebra, or −1 for a map with no zebra (its only crossings are dropped kerbs). */
  forcedZebra: number;
  startX: number;
};

const mapArb: fc.Arbitrary<MapSpec> = fc
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
      forcedZebra: fc.integer({ min: -Math.ceil(w / 3), max: w - 1 }).map((x) => (x < 0 ? -1 : x)),
      startX: fc.integer({ min: 0, max: w - 1 }),
    }),
  );

function pick(set: readonly string[], n: number): string {
  return set[n % set.length] ?? '.';
}

/** The map rows of a spec (legal by construction; tests/property/npcSteering.prop.test.ts's generator, whose
 * forced zebra this one may leave out). */
function rowsOf(spec: MapSpec): string[] {
  const { w, h } = spec;
  const zebra = (x: number): boolean =>
    spec.forcedZebra >= 0 && (x === spec.forcedZebra || spec.zebraCols[x] === true) && x !== spec.startX;
  const rows: string[] = [];
  for (let y = 0; y < h; y++) {
    let row = '';
    for (let x = 0; x < w; x++) {
      const n = spec.picks[y * w + x] ?? 0;
      let c: string;
      if (y === 0) c = n % 5 === 0 ? '.' : 'A';
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

/** Reference shortest path length in mm (rounded edge costs, as steering's) avoiding `avoid` edges; −1 if none. */
function referenceMm(level: Level, from: number, to: number, avoid: number): number {
  const nav = level.nav;
  const dist = new Float64Array(nav.nodeCount).fill(Number.POSITIVE_INFINITY);
  const done = new Uint8Array(nav.nodeCount);
  dist[from] = 0;
  for (;;) {
    let u = -1;
    for (let n = 0; n < nav.nodeCount; n++) {
      if (
        done[n] === 0 &&
        Number.isFinite(dist[n] as number) &&
        (u < 0 || (dist[n] as number) < (dist[u] as number))
      )
        u = n;
    }
    if (u < 0) return -1;
    if (u === to) return dist[u] as number;
    done[u] = 1;
    for (let k = nav.adjStart[u] as number; k < (nav.adjStart[u + 1] as number); k++) {
      const e = nav.adjEdge[k] as number;
      if (((nav.edgeFlags[e] as number) & avoid) !== 0) continue;
      const m = nav.adjNode[k] as number;
      const dx = (nav.nodeX[m] as number) - (nav.nodeX[u] as number);
      const dy = (nav.nodeY[m] as number) - (nav.nodeY[u] as number);
      const d = (dist[u] as number) + Math.max(1, Math.round(Math.hypot(dx, dy) * 1000));
      if (d < (dist[m] as number)) dist[m] = d;
    }
  }
}

const pathTotals = { pairs: 0, found: 0, viaZebra: 0, refused: 0 };

function checkPaths(spec: MapSpec, pairs: readonly [number, number][]): void {
  const level = compileTown(rowsOf(spec));
  const world = createWorld(level, 1, DEFAULT_TUNING);
  const nav = level.nav;
  const out = new Int32Array(nav.nodeCount);
  for (const [pa, pb] of pairs) {
    const a = pa % nav.nodeCount;
    const b = pb % nav.nodeCount;
    const len = findNavPath(world.npcAi.steering, nav, a, b, out, 0, out.length, OLD_MAN_NAV_AVOID);
    const ref = referenceMm(level, a, b, OLD_MAN_NAV_AVOID);
    pathTotals.pairs++;
    if (ref < 0) {
      expect(len, `${a} → ${b}: the reference finds no zebra-only path`).toBe(-1);
      if (referenceMm(level, a, b, 0) >= 0) pathTotals.refused++;
      continue;
    }
    expect(len, `${a} → ${b}`).toBeGreaterThan(0);
    pathTotals.found++;
    let mm = 0;
    let zebra = false;
    for (let k = 1; k < len; k++) {
      const e = navEdgeBetween(nav, out[k - 1] as number, out[k] as number);
      expect(e, `${a} → ${b} step ${k}`).toBeGreaterThanOrEqual(0);
      const f = (nav.edgeFlags[e] as number) & NAV_FLAG_CROSSING;
      if (f !== 0) {
        expect(f, `${a} → ${b} step ${k}: crossing ${e}`).toBe(NAV_FLAG.ZEBRA);
        zebra = true;
      }
      mm += world.npcAi.steering.edgeCostMm[e] as number;
    }
    expect(mm, `${a} → ${b}: not the shortest zebra-only path`).toBe(ref);
    if (zebra) pathTotals.viaZebra++;
  }
}

type MotionSpec = {
  map: MapSpec;
  walkers: { node: number; kind: number }[];
  drive: { throttle: number; steer: number }[];
};

const TICKS = 900;

const motionArb: fc.Arbitrary<MotionSpec> = fc.record({
  map: mapArb,
  walkers: fc.array(fc.record({ node: fc.nat({ max: 1 << 16 }), kind: fc.nat({ max: KINDS.length - 1 }) }), {
    minLength: 2,
    maxLength: 10,
  }),
  drive: fc.array(
    fc.record({
      throttle: fc.integer({ min: 0, max: THROTTLE_MAX }),
      steer: fc.integer({ min: -STEER_MAX, max: STEER_MAX }),
    }),
    { minLength: TICKS / 60, maxLength: TICKS / 60 },
  ),
});

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

/** How deep a circle overlaps a blocked tile (solid with no nav node) or the map edge. */
function deepestBlocked(level: Level, nodeTile: Int32Array, x: number, y: number, r: number): number {
  const [w, h] = level.size;
  const tx = Math.floor(x / TILE_M);
  const ty = Math.floor(y / TILE_M);
  let worst = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = tx + dx;
      const cy = ty + dy;
      const off = cx < 0 || cy < 0 || cx >= w || cy >= h;
      const t = cy * w + cx;
      if (
        !off &&
        !(((level.layers.collide[t] as number) & COLLIDE.SOLID) !== 0 && (nodeTile[t] as number) < 0)
      )
        continue;
      const qx = Math.min((cx + 1) * TILE_M, Math.max(cx * TILE_M, x));
      const qy = Math.min((cy + 1) * TILE_M, Math.max(cy * TILE_M, y));
      worst = Math.max(worst, r - Math.hypot(x - qx, y - qy));
    }
  }
  return worst;
}

const motionTotals = { maps: 0, npcTicks: 0, oldManRoadTicks: 0, mumTicks: 0, walkedM: 0 };

function checkMotion(spec: MotionSpec): void {
  const level = compileTown(rowsOf(spec.map));
  const [w] = level.size;
  const nav = level.nav;
  const nodeTile = new Int32Array(level.size[0] * level.size[1]).fill(-1);
  for (let n = 0; n < nav.nodeCount; n++) {
    nodeTile[
      Math.floor((nav.nodeY[n] as number) / TILE_M) * w + Math.floor((nav.nodeX[n] as number) / TILE_M)
    ] = n;
  }
  const world: World = createWorld(level, spec.map.picks[0] ?? 1, DEFAULT_TUNING);
  const oldMan = NPC_IDS.indexOf('npc.old_man_frame');
  const mum = NPC_IDS.indexOf('npc.mum_pushchair');
  for (const walker of spec.walkers) {
    const kind = NPC_IDS.indexOf(KINDS[walker.kind] ?? 'npc.shopper');
    const r = world.npcAi.spawner.radiusByKind[kind] as number;
    const n = walker.node % nav.nodeCount;
    const x = nav.nodeX[n] as number;
    const y = nav.nodeY[n] as number;
    // Start clear of props and walls with its own footprint (the property is inductive).
    if (deepestProp(level, x, y, r) > 0 || deepestBlocked(level, nodeTile, x, y, r) > 0) continue;
    const i = addNpcAt(world.npc, kind, NpcOrigin.Ambient, x, y);
    world.npc.radius[i] = r;
    world.npc.walkMps[i] = world.npcAi.spawner.speedByKind[kind] as number;
    setNpcState(world.npc, i, world.npcAi.behaviours[kind]?.initial ?? 0);
  }
  const input = createInputFrame();
  for (let tick = 0; tick < TICKS; tick++) {
    const seg = spec.drive[Math.floor(tick / 60)] ?? { throttle: 0, steer: 0 };
    input.throttle = seg.throttle;
    input.steer = seg.steer;
    world.step(input);
    const npc = world.npc;
    for (let i = 0; i < npc.count; i++) {
      const x = npc.x[i] as number;
      const y = npc.y[i] as number;
      const r = npc.radius[i] as number;
      const where = `tick ${tick} npc ${i} (kind ${npc.kind[i]}, r ${r}) at (${x.toFixed(3)}, ${y.toFixed(3)})`;
      expect(deepestBlocked(level, nodeTile, x, y, r), `${where}: circle in a solid`).toBeLessThanOrEqual(
        SLOP_M,
      );
      expect(deepestProp(level, x, y, r), `${where}: circle in a prop`).toBeLessThanOrEqual(SLOP_M);
      const t = Math.floor(y / TILE_M) * w + Math.floor(x / TILE_M);
      const g = level.layers.ground[t] as number;
      if (npc.kind[i] === oldMan && g >= Ground.Road && g <= Ground.RoadOneWayS) {
        const e = npc.crossEdge[i] as number;
        expect(e, `${where}: the old man on the road off a crossing`).toBeGreaterThanOrEqual(0);
        expect((nav.edgeFlags[e] as number) & NAV_FLAG_CROSSING, `${where}: crossing ${e}`).toBe(
          NAV_FLAG.ZEBRA,
        );
        motionTotals.oldManRoadTicks++;
      }
      if (npc.kind[i] === mum) motionTotals.mumTicks++;
      motionTotals.walkedM += Math.hypot(x - (npc.prevX[i] as number), y - (npc.prevY[i] as number));
      motionTotals.npcTicks++;
    }
  }
  motionTotals.maps++;
}

describe('SSP-085 walkers on random compiled maps (TECHNICAL_DESIGN §11.1)', () => {
  it("the old man's path search finds exactly the shortest zebra-only path, or none when there is none", {
    timeout: 120_000,
  }, () => {
    assertProperty(
      fc.property(
        mapArb,
        fc.array(fc.tuple(fc.nat(), fc.nat()), { minLength: 20, maxLength: 20 }),
        checkPaths,
      ),
      { seed: SEED, numRuns: 60 },
    );
    console.log(
      `oldManMum paths: ${pathTotals.pairs} pairs, ${pathTotals.found} found (${pathTotals.viaZebra} crossing a ` +
        `zebra), ${pathTotals.refused} reachable only by a dropped kerb`,
    );
    expect(pathTotals.viaZebra).toBeGreaterThan(pathTotals.pairs / 5);
    expect(pathTotals.refused).toBeGreaterThan(0);
  });

  it('the old man is on the road only on a zebra, and no walker (mum included) ends a tick inside a solid', {
    timeout: 120_000,
  }, () => {
    assertProperty(
      fc.property(motionArb, (spec) => {
        checkMotion(spec);
      }),
      { seed: SEED, numRuns: 60 },
    );
    console.log(
      `oldManMum motion: ${motionTotals.maps} maps, ${motionTotals.npcTicks} NPC-ticks ` +
        `(${motionTotals.mumTicks} mum), ${motionTotals.walkedM.toFixed(0)} m walked, ` +
        `${motionTotals.oldManRoadTicks} old-man ticks on a zebra`,
    );
    expect(motionTotals.maps).toBe(60);
    expect(motionTotals.mumTicks).toBeGreaterThan(10_000);
    expect(motionTotals.walkedM).toBeGreaterThan(2_000);
    expect(motionTotals.oldManRoadTicks).toBeGreaterThan(0);
  });
});
