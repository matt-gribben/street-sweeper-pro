// Structural invariants of a compiled level's derived tile layers (SSP-034): collide SOLID / KERB_EDGE bits,
// the kerb blob autotile, the markings and the merged solids; the spawn layers (SSP-054); the lane and nav
// graphs (SSP-076). Shared by the unit and property tests; each
// returns human-readable violations (empty = all hold).
import { TILE_M } from '../../src/sim/constants.ts';
import {
  AUTOTILE_NONE,
  COLLIDE,
  GRIME_CELL,
  GUTTER_CELLS_PER_TILE,
  LANE_FLAG,
  type Level,
  LITTER_CELLS_PER_TILE,
  LITTER_PLACE,
  MARKING,
  NAV_FLAG,
  NAV_FLAG_CROSSING,
  type TileRect,
} from '../../src/sim/map.ts';
import type { ResolvedMap } from '../../tools/levels/compile-level.ts';
import type { KerbBlob } from '../../tools/levels/kerbBlob.ts';
import { isWalkable } from '../../tools/levels/navGraph.ts';
import { isRaisedKerbCell, isRoadCell } from '../../tools/levels/tileLayers.ts';

const SIDES = [
  { dx: 0, dy: -1, own: COLLIDE.KERB_EDGE_N, facing: COLLIDE.KERB_EDGE_S, dir: 'n' },
  { dx: 1, dy: 0, own: COLLIDE.KERB_EDGE_E, facing: COLLIDE.KERB_EDGE_W, dir: 'e' },
  { dx: 0, dy: 1, own: COLLIDE.KERB_EDGE_S, facing: COLLIDE.KERB_EDGE_N, dir: 's' },
  { dx: -1, dy: 0, own: COLLIDE.KERB_EDGE_W, facing: COLLIDE.KERB_EDGE_E, dir: 'w' },
] as const;

/** Rasterise rects; returns per-cell cover counts. */
export function rasterise(rects: readonly TileRect[], w: number, h: number): Uint8Array {
  const cover = new Uint8Array(w * h);
  for (const [x0, y0, x1, y1] of rects) {
    for (let y = y0; y < y1; y += 1)
      for (let x = x0; x < x1; x += 1) cover[y * w + x] = (cover[y * w + x] ?? 0) + 1;
  }
  return cover;
}

/** Every violation of the solids / collide / autotile / markings invariants. */
export function tileLayerViolations(level: Level, map: ResolvedMap, blob: KerbBlob): string[] {
  const [w, h] = level.size;
  const { collide, autotile, markings } = level.layers;
  const out: string[] = [];
  const cover = rasterise(level.solids, w, h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      const c = collide[i] ?? 0;
      const at = `(${x}, ${y})`;
      const solid = (c & COLLIDE.SOLID) !== 0;
      if (solid !== (map.drivable[i] === 0))
        out.push(`${at}: SOLID ${solid} but drivable ${map.drivable[i]}`);
      if ((cover[i] ?? 0) !== (solid ? 1 : 0)) out.push(`${at}: covered ${cover[i]} time(s) by solids`);
      for (const s of SIDES) {
        if ((c & s.own) === 0) continue;
        const nx = x + s.dx;
        const ny = y + s.dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) {
          out.push(`${at}: kerb edge ${s.dir} off the map`);
          continue;
        }
        const j = ny * w + nx;
        if (((collide[j] ?? 0) & s.facing) === 0) out.push(`${at}: kerb edge ${s.dir} not mirrored`);
        const pair =
          (isRoadCell(map, i) && isRaisedKerbCell(map, j)) ||
          (isRaisedKerbCell(map, i) && isRoadCell(map, j));
        if (!pair) out.push(`${at}: kerb edge ${s.dir} is not between a road and a raised kerb`);
      }
      // Every road ↔ raised-kerb edge has its bit.
      if (isRoadCell(map, i)) {
        for (const s of SIDES) {
          const nx = x + s.dx;
          const ny = y + s.dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          if (isRaisedKerbCell(map, ny * w + nx) && (c & s.own) === 0)
            out.push(`${at}: missing kerb edge ${s.dir}`);
        }
      }
      const a = autotile[i] ?? AUTOTILE_NONE;
      let roadNear = false;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (
            (dx !== 0 || dy !== 0) &&
            nx >= 0 &&
            ny >= 0 &&
            nx < w &&
            ny < h &&
            isRoadCell(map, ny * w + nx)
          )
            roadNear = true;
        }
      }
      const wantTile = isRaisedKerbCell(map, i) && roadNear;
      if ((a !== AUTOTILE_NONE) !== wantTile)
        out.push(`${at}: autotile ${a}, expected ${wantTile ? 'a tile' : 'none'}`);
      if (a !== AUTOTILE_NONE) {
        const mask = blob.masks[a] ?? 255;
        for (const s of SIDES) {
          const kerb = (mask & blob.bits[s.dir]) === 0;
          if (kerb !== ((c & s.own) !== 0))
            out.push(`${at}: autotile ${a} ${s.dir} edge disagrees with collide`);
        }
      }
      const m = markings[i] ?? 0;
      if (m !== 0 && !isRoadCell(map, i)) out.push(`${at}: markings ${m} off the road`);
      if ((m & MARKING.DOUBLE_YELLOW) !== 0 && (c & ~COLLIDE.SOLID) === 0)
        out.push(`${at}: double yellow without a kerb edge`);
      if (((m & MARKING.PARKING_BAY) !== 0) !== (map.defs[i]?.mark === 'parking_bay'))
        out.push(`${at}: PARKING_BAY ${m & MARKING.PARKING_BAY} disagrees with the map`);
    }
  }
  return out;
}

/**
 * Every violation of the SSP-054 spawn-layer invariants: GUTTER implies OPEN, OPEN lies on route tiles only,
 * GUTTER lies on road cells in the 2-cell band of one of the cell's KERB_EDGE sides, zone density and litter
 * weight are 0 off route, and the litter GUTTER place is only on road ground.
 */
export function spawnLayerViolations(level: Level, map: ResolvedMap): string[] {
  const [w, h] = level.size;
  const { gutter, route, grimeDensity, collide } = level.layers;
  const out: string[] = [];
  const n = GUTTER_CELLS_PER_TILE;
  const gw = w * n;
  for (let k = 0; k < gutter.length; k += 1) {
    const v = gutter[k] ?? 0;
    if (v === 0) continue;
    const gx = k % gw;
    const gy = Math.floor(k / gw);
    const t = Math.floor(gy / n) * w + Math.floor(gx / n);
    const at = `grime cell (${gx}, ${gy})`;
    if ((v & GRIME_CELL.OPEN) === 0) out.push(`${at}: ${v} without OPEN`);
    if (route[t] !== 1) out.push(`${at}: OPEN off the route`);
    if ((v & GRIME_CELL.GUTTER) !== 0) {
      const c = collide[t] ?? 0;
      const lx = gx % n;
      const ly = gy % n;
      const band =
        ((c & COLLIDE.KERB_EDGE_N) !== 0 && ly < 2) ||
        ((c & COLLIDE.KERB_EDGE_S) !== 0 && ly >= n - 2) ||
        ((c & COLLIDE.KERB_EDGE_W) !== 0 && lx < 2) ||
        ((c & COLLIDE.KERB_EDGE_E) !== 0 && lx >= n - 2);
      if (!isRoadCell(map, t) || !band) out.push(`${at}: GUTTER outside the band of a road kerb edge`);
    }
  }
  for (let t = 0; t < w * h; t += 1) {
    if ((grimeDensity[t] ?? 0) !== 0 && route[t] !== 1) out.push(`tile ${t}: grimeDensity off the route`);
  }
  const litter = level.litter;
  if (litter !== null) {
    const sn = LITTER_CELLS_PER_TILE;
    const sw = w * sn;
    litter.weights.forEach((v, k) => {
      const t = Math.floor(Math.floor(k / sw) / sn) * w + Math.floor((k % sw) / sn);
      if (v !== 0 && route[t] !== 1) out.push(`litter sub-cell ${k}: weight ${v} off the route`);
      if (((litter.places[k] ?? 0) & LITTER_PLACE.GUTTER) !== 0 && !isRoadCell(map, t))
        out.push(`litter sub-cell ${k}: GUTTER place off the road`);
    });
  }
  return out;
}

/**
 * Every violation of the SSP-076 graph invariants. Lanes: every node lies on a road cell (portal nodes on the
 * map edge, beside one); every node has an edge in and an edge out, except entry portals (no edge in) and exit
 * portals (no edge out); PORTAL_IN leaves and PORTAL_OUT reaches the map edge; every bay cell is a `p` cell.
 * Nav: one node per walkable tile, at its centre; an edge without a crossing flag joins two tiles that touch
 * (orthogonally or diagonally) and a crossing edge runs straight over road cells only, all zebra cells for
 * ZEBRA and all school-crossing cells for SCHOOL_CROSSING, and starts or ends on a dropped kerb for
 * DROPPED_KERB; the portals are exactly the nodes on the map edge; doors name frontages.
 */
export function graphViolations(level: Level, map: ResolvedMap): string[] {
  const [w, h] = level.size;
  const out: string[] = [];
  const tileOf = (x: number, y: number): [number, number] => [
    Math.min(Math.floor(x / TILE_M), w - 1),
    Math.min(Math.floor(y / TILE_M), h - 1),
  ];
  const onEdge = (x: number, y: number): boolean =>
    x === 0 || y === 0 || x === w * TILE_M || y === h * TILE_M;

  const lanes = level.lanes;
  const ins = new Uint32Array(lanes.nodeCount);
  for (let e = 0; e < lanes.edgeCount; e += 1) {
    const from = lanes.edgeFrom[e] ?? 0;
    const to = lanes.edgeTo[e] ?? 0;
    const flags = lanes.edgeFlags[e] ?? 0;
    ins[to] = (ins[to] ?? 0) + 1;
    if ((flags & LANE_FLAG.PORTAL_IN) !== 0 && !onEdge(lanes.nodeX[from] ?? 0, lanes.nodeY[from] ?? 0))
      out.push(`lane edge ${e}: PORTAL_IN from a node inside the map`);
    if ((flags & LANE_FLAG.PORTAL_OUT) !== 0 && !onEdge(lanes.nodeX[to] ?? 0, lanes.nodeY[to] ?? 0))
      out.push(`lane edge ${e}: PORTAL_OUT to a node inside the map`);
  }
  for (let v = 0; v < lanes.nodeCount; v += 1) {
    const x = lanes.nodeX[v] ?? 0;
    const y = lanes.nodeY[v] ?? 0;
    const [tx, ty] = tileOf(x, y);
    if (!isRoadCell(map, ty * w + tx)) out.push(`lane node ${v} (${x}, ${y}): not on a road cell`);
    const outs = (lanes.outStart[v + 1] ?? 0) - (lanes.outStart[v] ?? 0);
    if (outs === 0 && !onEdge(x, y)) out.push(`lane node ${v} (${x}, ${y}): no edge out`);
    if (ins[v] === 0 && !onEdge(x, y)) out.push(`lane node ${v} (${x}, ${y}): no edge in`);
  }
  for (const [i, bay] of lanes.bays.entries()) {
    const [x0, y0, x1, y1] = bay.rect;
    for (let y = y0; y < y1; y += 1)
      for (let x = x0; x < x1; x += 1)
        if (((level.layers.markings[y * w + x] ?? 0) & MARKING.PARKING_BAY) === 0)
          out.push(`bay ${i}: tile (${x}, ${y}) is not a parking bay`);
  }

  const nav = level.nav;
  const nodeAt = new Int32Array(w * h).fill(-1);
  for (let v = 0; v < nav.nodeCount; v += 1) {
    const x = nav.nodeX[v] ?? 0;
    const y = nav.nodeY[v] ?? 0;
    const tx = x / TILE_M - 0.5;
    const ty = y / TILE_M - 0.5;
    if (!Number.isInteger(tx) || !Number.isInteger(ty))
      out.push(`nav node ${v} (${x}, ${y}): not a tile centre`);
    else nodeAt[ty * w + tx] = v;
  }
  for (let i = 0; i < w * h; i += 1) {
    if (isWalkable(map, i) !== (nodeAt[i] !== -1)) out.push(`tile ${i}: walkable and nav node disagree`);
  }
  for (let e = 0; e < nav.edgeCount; e += 1) {
    const a = nav.edgeFrom[e] ?? 0;
    const b = nav.edgeTo[e] ?? 0;
    const flags = nav.edgeFlags[e] ?? 0;
    const ax = (nav.nodeX[a] ?? 0) / TILE_M - 0.5;
    const ay = (nav.nodeY[a] ?? 0) / TILE_M - 0.5;
    const bx = (nav.nodeX[b] ?? 0) / TILE_M - 0.5;
    const by = (nav.nodeY[b] ?? 0) / TILE_M - 0.5;
    const span = Math.max(Math.abs(bx - ax), Math.abs(by - ay));
    if ((flags & NAV_FLAG_CROSSING) === 0) {
      if (span !== 1) out.push(`nav edge ${e}: joins tiles ${span} apart without a crossing flag`);
      continue;
    }
    if (ax !== bx && ay !== by) {
      out.push(`nav edge ${e}: a crossing that is not straight`);
      continue;
    }
    const dx = Math.sign(bx - ax);
    const dy = Math.sign(by - ay);
    let zebra = true;
    let school = true;
    for (let k = 1; k < span; k += 1) {
      const t = (ay + dy * k) * w + (ax + dx * k);
      if (!isRoadCell(map, t)) out.push(`nav edge ${e}: a crossing over a tile that is not road`);
      zebra &&= map.defs[t]?.site === 'site.zebra';
      school &&= map.defs[t]?.site === 'site.school_crossing';
    }
    const dropped = (x: number, y: number): boolean => map.defs[y * w + x]?.mark === 'dropped_kerb';
    if (flags === NAV_FLAG.ZEBRA && !zebra) out.push(`nav edge ${e}: ZEBRA over a tile that is not a zebra`);
    if (flags === NAV_FLAG.SCHOOL_CROSSING && !school)
      out.push(`nav edge ${e}: SCHOOL_CROSSING over a tile that is not a school crossing`);
    if (flags === NAV_FLAG.DROPPED_KERB && !dropped(ax, ay) && !dropped(bx, by))
      out.push(`nav edge ${e}: DROPPED_KERB with no dropped kerb at either end`);
  }
  const portals = new Set(nav.portals);
  for (let v = 0; v < nav.nodeCount; v += 1) {
    const tx = (nav.nodeX[v] ?? 0) / TILE_M - 0.5;
    const ty = (nav.nodeY[v] ?? 0) / TILE_M - 0.5;
    const edge = tx === 0 || ty === 0 || tx === w - 1 || ty === h - 1;
    if (edge !== portals.has(v))
      out.push(`nav node ${v}: portal tag ${portals.has(v)} but on the map edge ${edge}`);
  }
  const frontageIds = new Set(level.frontages.map((f) => f.id));
  for (const door of nav.doors)
    if (!frontageIds.has(door.frontage)) out.push(`door ${door.frontage}: no such frontage`);
  return out;
}
