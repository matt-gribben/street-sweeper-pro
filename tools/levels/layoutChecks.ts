// Layout validation of a resolved map (LEVEL_DESIGN §7.3–§7.7 and §10.3; SSP-034): L014 dead ends, L015
// footway mouths, L020 depot bays / skips / dump distance, L021 water distance and L022 stopping tiles.
// Pure: no fs. Runs once per compile, so it may allocate.
//
// Definitions (as built, SSP-034; LEVEL_DESIGN §10.3 mirrors them):
// - Path distances are BFS over drivable tiles (4-connected), 2 m (TILE_M) per step.
// - The **carriageway** is the drivable area that is not pavement or grass, plus dropped kerbs: road, cobbles,
//   yard, apron and drivable alley. Pavements and verges are kerbed, so they neither make a dead end nor a
//   turning head.
// - A **turning head** cell lies in some 5×5 square of carriageway inside the map.
// - **L014:** the carriageway is thinned to its centre line (Zhang–Suen). From each closed end (a centre-line
//   tip that is not in a turning head and not off the map edge) the centre line is walked to the nearest
//   junction, turning head or map edge; more than 6 tiles is an error. A carriageway that runs off the map
//   edge continues (the town goes on), so it is never a dead end.
// - **L015:** a footway (non-drivable `;` alley) cell orthogonally next to a drivable cell is a mouth; it
//   needs `prop.bollard` on the footway cell or on the drivable cell in front of it. A footway end that
//   meets only buildings, walls or the map edge is closed and is not a mouth.
// - **L020:** at least 2 depot bays (4-connected groups of `site.depot_bay` cells); in shift levels every
//   skip at least 40 m from every depot bay (the Skip Run's skips are set dressing, §8.6); every route tile
//   within 200 m of a dump site (depot bay or skip).
// - **L021:** every route tile within 150 m of a hydrant (`prop.hydrant`) or depot bay.
// - **L022:** a hydrant needs a carriageway cell without a prop orthogonally next to it; a skip (each
//   4-connected group of `site.skip` cells) needs a drivable cell without a prop or skip along a long side
//   (any side when square).
import { TILE_M } from '../../src/sim/constants.ts';
import { Ground } from '../../src/sim/map.ts';
import type { Mode } from './schema.ts';

/** The fields of the compiler's ResolvedMap these checks read (structural, to avoid an import cycle). */
export type LayoutMap = {
  w: number;
  h: number;
  defs: readonly ({ prop?: string; site?: string; mark?: string } | null)[];
  ground: Uint8Array;
  drivable: Uint8Array;
  building: Int16Array;
  solid: Uint8Array;
};

export type LayoutCode = 'L014' | 'L015' | 'L020' | 'L021' | 'L022';

/** One finding at tile (x, y), 0-based; the compiler reports it as `<map>:<y+1>:<x+1> <code> <message>`. */
export type LayoutFinding = { x: number; y: number; code: LayoutCode; message: string };

/** LEVEL_DESIGN §7.3/§7.4: longest dead end without a turning head, and the turning head's side, in tiles. */
export const DEAD_END_MAX_TILES = 6;
export const TURNING_HEAD_TILES = 5;
/** LEVEL_DESIGN §7.7. */
export const MIN_DEPOT_BAYS = 2;
export const SKIP_MIN_FROM_BAY_M = 40;
export const DUMP_MAX_M = 200;
export const WATER_MAX_M = 150;

const DEPOT_BAY = 'site.depot_bay';
const SKIP = 'site.skip';
const HYDRANT = 'prop.hydrant';
const BOLLARD = 'prop.bollard';

const ORTHO: readonly [number, number][] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

/** The carriageway mask: drivable, and not pavement or grass unless a dropped kerb. */
export function carriagewayMask(map: LayoutMap): Uint8Array {
  const out = new Uint8Array(map.w * map.h);
  for (let i = 0; i < out.length; i += 1) {
    if (map.drivable[i] !== 1) continue;
    const g = map.ground[i];
    const kerbed = g === Ground.Pavement || g === Ground.Grass;
    if (!kerbed || map.defs[i]?.mark === 'dropped_kerb') out[i] = 1;
  }
  return out;
}

/** Cells covered by some side×side square whose cells are all set in `mask` (inside the map). */
export function squareCover(mask: Uint8Array, w: number, h: number, side: number): Uint8Array {
  const out = new Uint8Array(w * h);
  if (w < side || h < side) return out;
  // Summed-area table, (w+1)×(h+1).
  const sat = new Int32Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      sat[(y + 1) * (w + 1) + x + 1] =
        (mask[y * w + x] ?? 0) +
        (sat[y * (w + 1) + x + 1] ?? 0) +
        (sat[(y + 1) * (w + 1) + x] ?? 0) -
        (sat[y * (w + 1) + x] ?? 0);
    }
  }
  const at = (x: number, y: number): number => sat[y * (w + 1) + x] ?? 0;
  for (let y = 0; y + side <= h; y += 1) {
    for (let x = 0; x + side <= w; x += 1) {
      if (at(x + side, y + side) - at(x, y + side) - at(x + side, y) + at(x, y) !== side * side) continue;
      for (let cy = y; cy < y + side; cy += 1) out.fill(1, cy * w + x, cy * w + x + side);
    }
  }
  return out;
}

/** The 8 ring neighbours of (x, y) in Zhang–Suen order P2..P9 (N, NE, E, SE, S, SW, W, NW); outside = 0. */
function ring(img: Uint8Array, W: number, H: number, x: number, y: number, out: number[]): void {
  const get = (cx: number, cy: number): number =>
    cx < 0 || cy < 0 || cx >= W || cy >= H ? 0 : (img[cy * W + cx] ?? 0);
  out[0] = get(x, y - 1);
  out[1] = get(x + 1, y - 1);
  out[2] = get(x + 1, y);
  out[3] = get(x + 1, y + 1);
  out[4] = get(x, y + 1);
  out[5] = get(x - 1, y + 1);
  out[6] = get(x - 1, y);
  out[7] = get(x - 1, y - 1);
}

/** Number of 0 → 1 transitions around a ring (the crossing number). */
function transitions(p: readonly number[]): number {
  let a = 0;
  for (let k = 0; k < 8; k += 1) if (p[k] === 0 && p[(k + 1) % 8] === 1) a += 1;
  return a;
}

/** Zhang–Suen thinning of a binary image, in place, to an 8-connected one-pixel skeleton. Deterministic. */
export function thin(img: Uint8Array, W: number, H: number): void {
  const p: number[] = [0, 0, 0, 0, 0, 0, 0, 0];
  const del: number[] = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (let step = 0; step < 2; step += 1) {
      del.length = 0;
      for (let y = 0; y < H; y += 1) {
        for (let x = 0; x < W; x += 1) {
          if (img[y * W + x] !== 1) continue;
          ring(img, W, H, x, y, p);
          const [p2, , p4, , p6, , p8] = p;
          const b = p.reduce((s, v) => s + v, 0);
          if (b < 2 || b > 6 || transitions(p) !== 1) continue;
          if (step === 0 ? p2 && p4 && p6 : p2 && p4 && p8) continue;
          if (step === 0 ? p4 && p6 && p8 : p2 && p6 && p8) continue;
          del.push(y * W + x);
        }
      }
      for (const i of del) img[i] = 0;
      if (del.length > 0) changed = true;
    }
  }
}

/**
 * L014 dead ends of the carriageway mask: for each closed end deeper than DEAD_END_MAX_TILES, its deepest
 * tile (the first found at the closed end) and its depth in tiles. Exported for tests.
 *
 * The mask is thinned to its centre line (Zhang–Suen); a tip that is not in a turning head is walked along
 * the centre line to the nearest junction, turning head or map edge. That stretch of centre line owns a
 * pocket of the carriageway (the cells nearer to it than to any other centre-line cell). The pocket's mouth
 * is squared up to the cul-de-sac's straight sides (squareMouth), so it starts at the edge of the road it
 * leaves even where an even-width road's centre line sits half a tile off-centre, and the depth is the
 * farthest pocket cell's path distance from the rest of the carriageway: the tiles of the cul-de-sac itself,
 * whatever the widths of the two roads. A corridor closed at both ends (reached only over
 * pavement) is measured end to end and reported once.
 */
export function findDeadEnds(
  area: Uint8Array,
  W: number,
  H: number,
): { x: number; y: number; tiles: number }[] {
  const head = squareCover(area, W, H, TURNING_HEAD_TILES);
  const line = area.slice();
  thin(line, W, H);

  const cross = new Int8Array(W * H);
  const p: number[] = [0, 0, 0, 0, 0, 0, 0, 0];
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      if (line[y * W + x] !== 1) continue;
      ring(line, W, H, x, y, p);
      cross[y * W + x] = transitions(p);
    }
  }

  // Owner of every carriageway cell: the centre-line cell nearest to it (4-connected path distance inside
  // the carriageway; ties go to the earlier cell in row-major order, so the split is deterministic).
  const owner = new Int32Array(W * H).fill(-1);
  const flood: number[] = [];
  for (let i = 0; i < W * H; i += 1) {
    if (line[i] === 1) {
      owner[i] = i;
      flood.push(i);
    }
  }
  for (let q = 0; q < flood.length; q += 1) {
    const c = flood[q] ?? 0;
    for (const j of near4(c, W, H)) {
      if (area[j] !== 1 || owner[j] !== -1) continue;
      owner[j] = owner[c] ?? -1;
      flood.push(j);
    }
  }
  // A centre-line cell is open when it owns a carriageway cell on the map edge: the road runs off the map
  // there and the town goes on, so it is never a closed end.
  const open = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i += 1) {
    const x = i % W;
    const y = (i - x) / W;
    const border = x === 0 || y === 0 || x === W - 1 || y === H - 1;
    if (border && area[i] === 1 && (owner[i] ?? -1) >= 0) open[owner[i] ?? 0] = 1;
  }

  const found: { x: number; y: number; tiles: number }[] = [];
  const seen = new Int32Array(W * H).fill(-1);
  const steps = new Int32Array(W * H);
  const branch = new Int32Array(W * H).fill(-1);
  const pocket = new Int32Array(W * H).fill(-1);
  const depth = new Int32Array(W * H);
  const closed = new Uint8Array(W * H);
  const cut = new Int32Array(W * H).fill(-1);
  const runs = carriagewayRuns(area, W, H);
  const walk: number[] = [];
  const cells: number[] = [];
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const tip = y * W + x;
      if (line[tip] !== 1 || cross[tip] !== 1 || head[tip] === 1 || open[tip] === 1 || closed[tip] === 1)
        continue;
      // Walk the centre line from the tip to the nearest stop (junction, turning head, map edge).
      walk.length = 0;
      walk.push(tip);
      seen[tip] = tip;
      steps[tip] = 0;
      let stop = -1;
      let stopCell = tip;
      for (let q = 0; q < walk.length; q += 1) {
        const c = walk[q] ?? 0;
        const cx = c % W;
        const cy = (c - cx) / W;
        const d = steps[c] ?? 0;
        if (c !== tip && ((cross[c] ?? 0) >= 3 || head[c] === 1 || open[c] === 1)) {
          stop = d;
          stopCell = c;
          break;
        }
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const nx = cx + dx;
            const ny = cy + dy;
            if ((dx === 0 && dy === 0) || nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
            const j = ny * W + nx;
            if (line[j] !== 1 || seen[j] === tip) continue;
            seen[j] = tip;
            steps[j] = d + 1;
            walk.push(j);
          }
        }
      }
      // The branch is the walked centre line short of the stop, less the stretch inside the stop's own
      // inscribed square (its chessboard clearance), which belongs to the road the dead end leaves. A turning
      // head is a stop at its own edge, so nothing is taken off.
      const inner = stop >= 0 && head[stopCell] !== 1 ? clearance(area, W, H, stopCell) - 1 : 0;
      for (const c of walk) if (stop < 0 || (steps[c] ?? 0) < stop - inner) branch[c] = tip;
      if (stop < 0) for (const c of walk) closed[c] = 1;
      // The pocket: carriageway cells owned by the branch, flooded from the tip.
      cells.length = 0;
      cells.push(tip);
      pocket[tip] = tip;
      for (let q = 0; q < cells.length; q += 1) {
        for (const j of near4(cells[q] ?? 0, W, H)) {
          if (area[j] !== 1 || pocket[j] === tip || branch[owner[j] ?? -1] !== tip) continue;
          pocket[j] = tip;
          cells.push(j);
        }
      }
      // The centre line of an even-width road sits half a tile off-centre, so the trim above can leave one
      // row of the road in the pocket or take one row of the cul-de-sac out of it. Square the mouth up to the
      // cul-de-sac's straight sides: a pocket cell on the mouth whose cross-section (its run of carriageway
      // across the direction of the mouth) opens out wider than the next cell in belongs to the road it
      // leaves; then a carriageway cell just past the mouth whose cross-section fits within the pocket cell next
      // to it, and past which the walls open out, belongs to the cul-de-sac.
      squareMouth(tip, cells, pocket, cut, area, runs, W, H);
      // Depth: path distance into the pocket from the rest of the carriageway (1 at the mouth). A closed
      // corridor has no mouth: measure it from its far end (the pocket cell farthest from the tip).
      const front: number[] = [];
      for (const c of cells) {
        const atMouth = near4(c, W, H).some((j) => area[j] === 1 && pocket[j] !== tip);
        depth[c] = atMouth ? 1 : 0;
        if (atMouth) front.push(c);
      }
      if (front.length === 0) {
        const order = regionOrder(tip, W, H, (j) => pocket[j] === tip);
        const far = order[order.length - 1] ?? tip;
        depth[far] = 1;
        front.push(far);
      }
      let deepest = 0;
      let end = tip;
      for (let q = 0; q < front.length; q += 1) {
        const c = front[q] ?? 0;
        const d = depth[c] ?? 0;
        if (d > deepest) {
          deepest = d;
          end = c;
        }
        for (const j of near4(c, W, H)) {
          if (pocket[j] !== tip || (depth[j] ?? 0) !== 0) continue;
          depth[j] = d + 1;
          front.push(j);
        }
      }
      if (deepest > DEAD_END_MAX_TILES) found.push({ x: end % W, y: Math.floor(end / W), tiles: deepest });
    }
  }
  return found;
}

/** Per cell of `area`, the first and last column of its row run and the first and last row of its column run. */
interface Runs {
  rowLo: Int32Array;
  rowHi: Int32Array;
  colLo: Int32Array;
  colHi: Int32Array;
}

function carriagewayRuns(area: Uint8Array, W: number, H: number): Runs {
  const runs: Runs = {
    rowLo: new Int32Array(W * H),
    rowHi: new Int32Array(W * H),
    colLo: new Int32Array(W * H),
    colHi: new Int32Array(W * H),
  };
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; ) {
      if (area[y * W + x] !== 1) {
        x += 1;
        continue;
      }
      let end = x;
      while (end + 1 < W && area[y * W + end + 1] === 1) end += 1;
      for (let cx = x; cx <= end; cx += 1) {
        runs.rowLo[y * W + cx] = x;
        runs.rowHi[y * W + cx] = end;
      }
      x = end + 1;
    }
  }
  for (let x = 0; x < W; x += 1) {
    for (let y = 0; y < H; ) {
      if (area[y * W + x] !== 1) {
        y += 1;
        continue;
      }
      let end = y;
      while (end + 1 < H && area[(end + 1) * W + x] === 1) end += 1;
      for (let cy = y; cy <= end; cy += 1) {
        runs.colLo[cy * W + x] = y;
        runs.colHi[cy * W + x] = end;
      }
      y = end + 1;
    }
  }
  return runs;
}

/**
 * Squares a dead end's pocket (cells marked `tip` in `pocket`, listed in `cells`) up to the cul-de-sac's
 * straight sides, in place. Shrink, to a fixed point: drop a pocket cell that has a carriageway neighbour
 * outside the pocket on one side and a pocket cell on the other when its cross-section (the run of carriageway
 * through it at right angles to that neighbour) is not contained in that inner cell's: the walls open out
 * there, so it is the road the dead end leaves. Grow: add a carriageway cell next to the pocket that was not
 * dropped, whose cross-section lies within the neighbouring pocket cell's and past which the walls open out:
 * the same two walls carry on to the edge of the road it leaves, so the cul-de-sac does too. (Requiring the
 * opening keeps a pocket that is only a slice of a straight road from growing along it.) Dropped cells are
 * removed from `cells`; added ones are appended.
 */
function squareMouth(
  tip: number,
  cells: number[],
  pocket: Int32Array,
  cut: Int32Array,
  area: Uint8Array,
  runs: Runs,
  W: number,
  H: number,
): void {
  // Cross-section of cell c at right angles to an orthogonal step (dx, dy).
  const lo = (c: number, dy: number): number => (dy !== 0 ? runs.rowLo[c] : runs.colLo[c]) ?? 0;
  const hi = (c: number, dy: number): number => (dy !== 0 ? runs.rowHi[c] : runs.colHi[c]) ?? 0;
  const step = (c: number, dx: number, dy: number): number => {
    const x = (c % W) + dx;
    const y = Math.floor(c / W) + dy;
    return x < 0 || y < 0 || x >= W || y >= H ? -1 : y * W + x;
  };
  let changed = true;
  while (changed) {
    changed = false;
    for (const c of cells) {
      if (pocket[c] !== tip) continue;
      for (const [dx, dy] of ORTHO) {
        const out = step(c, dx, dy);
        const inner = step(c, -dx, -dy);
        if (out < 0 || inner < 0 || area[out] !== 1 || pocket[out] === tip || pocket[inner] !== tip) continue;
        if (lo(c, dy) >= lo(inner, dy) && hi(c, dy) <= hi(inner, dy)) continue;
        pocket[c] = -1;
        cut[c] = tip;
        changed = true;
        break;
      }
    }
  }
  let kept = 0;
  for (const c of cells) if (pocket[c] === tip) cells[kept++] = c;
  cells.length = kept;
  for (let q = 0; q < cells.length; q += 1) {
    const c = cells[q] ?? 0;
    for (const [dx, dy] of ORTHO) {
      const out = step(c, dx, dy);
      if (out < 0 || area[out] !== 1 || pocket[out] === tip || cut[out] === tip) continue;
      if (lo(out, dy) < lo(c, dy) || hi(out, dy) > hi(c, dy)) continue;
      const beyond = step(out, dx, dy);
      if (beyond < 0 || area[beyond] !== 1) continue;
      if (lo(beyond, dy) >= lo(out, dy) && hi(beyond, dy) <= hi(out, dy)) continue;
      pocket[out] = tip;
      cells.push(out);
    }
  }
}

/**
 * Chessboard distance from cell c to the nearest non-`area` cell inside the grid (the map edge does not
 * bound it, because a carriageway runs on beyond the edge); W + H when there is none.
 */
function clearance(area: Uint8Array, W: number, H: number, c: number): number {
  const x = c % W;
  const y = (c - x) / W;
  for (let r = 1; r < W + H; r += 1) {
    for (let cy = y - r; cy <= y + r; cy += 1) {
      for (let cx = x - r; cx <= x + r; cx += 1) {
        if (Math.max(Math.abs(cx - x), Math.abs(cy - y)) !== r) continue;
        if (cx >= 0 && cy >= 0 && cx < W && cy < H && area[cy * W + cx] !== 1) return r;
      }
    }
  }
  return W + H;
}

/** The in-bounds orthogonal neighbours of cell c in a W×H grid. */
function near4(c: number, W: number, H: number): number[] {
  const x = c % W;
  const y = (c - x) / W;
  const out: number[] = [];
  for (const [dx, dy] of ORTHO) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx >= 0 && ny >= 0 && nx < W && ny < H) out.push(ny * W + nx);
  }
  return out;
}

/** Cells of a 4-connected region in BFS order from `from`. */
function regionOrder(from: number, W: number, H: number, inRegion: (j: number) => boolean): number[] {
  const order = [from];
  const mark = new Set<number>([from]);
  for (let q = 0; q < order.length; q += 1) {
    for (const j of near4(order[q] ?? 0, W, H)) {
      if (mark.has(j) || !inRegion(j)) continue;
      mark.add(j);
      order.push(j);
    }
  }
  return order;
}

/** Multi-source BFS over drivable tiles: steps from the nearest source, or −1. Sources are seeded as-is. */
export function pathSteps(map: LayoutMap, sources: readonly number[]): Int32Array {
  const { w, h } = map;
  const dist = new Int32Array(w * h).fill(-1);
  const queue: number[] = [];
  for (const s of sources) {
    if (dist[s] === 0) continue;
    dist[s] = 0;
    queue.push(s);
  }
  for (let q = 0; q < queue.length; q += 1) {
    const i = queue[q] ?? 0;
    const x = i % w;
    const y = (i - x) / w;
    for (const [dx, dy] of ORTHO) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (dist[j] !== -1 || map.drivable[j] !== 1) continue;
      dist[j] = (dist[i] ?? 0) + 1;
      queue.push(j);
    }
  }
  return dist;
}

/** 4-connected groups of cells matching `pick`, each as its cell indices in row-major discovery order. */
function groups(map: LayoutMap, pick: (i: number) => boolean): number[][] {
  const { w, h } = map;
  const mark = new Uint8Array(w * h);
  const out: number[][] = [];
  for (let i = 0; i < w * h; i += 1) {
    if (mark[i] === 1 || !pick(i)) continue;
    const cells = [i];
    mark[i] = 1;
    for (let q = 0; q < cells.length; q += 1) {
      const c = cells[q] ?? 0;
      const x = c % w;
      const y = (c - x) / w;
      for (const [dx, dy] of ORTHO) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (mark[j] === 0 && pick(j)) {
          mark[j] = 1;
          cells.push(j);
        }
      }
    }
    out.push(cells.sort((a, b) => a - b));
  }
  return out;
}

/** Run every layout check. `route` is the compiled route mask (1 = route area). */
export function checkLayout(map: LayoutMap, route: Uint8Array, mode: Mode): LayoutFinding[] {
  const { w, h } = map;
  const findings: LayoutFinding[] = [];
  const at = (i: number, code: LayoutCode, message: string): void => {
    const x = i % w;
    findings.push({ x, y: (i - x) / w, code, message });
  };
  const inside = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < w && y < h;
  const prop = (i: number): string | undefined => map.defs[i]?.prop;
  const site = (i: number): string | undefined => map.defs[i]?.site;
  const metres = (steps: number): number => steps * TILE_M;
  const carriageway = carriagewayMask(map);

  // L014: dead ends without a turning head.
  for (const d of findDeadEnds(carriageway, w, h)) {
    findings.push({
      x: d.x,
      y: d.y,
      code: 'L014',
      message: `dead end of ${d.tiles} tiles without a ${TURNING_HEAD_TILES}×${TURNING_HEAD_TILES} turning head (max ${DEAD_END_MAX_TILES})`,
    });
  }

  // L015: footway mouths Bessie can enter.
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      const footway =
        map.ground[i] === Ground.Alley &&
        map.drivable[i] === 0 &&
        map.solid[i] === 0 &&
        map.building[i] === -1;
      if (!footway) continue;
      const open = ORTHO.some(([dx, dy]) => {
        const nx = x + dx;
        const ny = y + dy;
        if (!inside(nx, ny)) return false;
        const j = ny * w + nx;
        return map.drivable[j] === 1 && prop(i) !== BOLLARD && prop(j) !== BOLLARD;
      });
      if (open)
        at(
          i,
          'L015',
          '1-tile alley mouth Bessie can enter: put a bollard (!) in it or close it with buildings',
        );
    }
  }

  // L020: depot bays, skips and dump distance.
  const bays = groups(map, (i) => site(i) === DEPOT_BAY);
  const skips = groups(map, (i) => site(i) === SKIP);
  const bayCells = bays.flat();
  if (bays.length < MIN_DEPOT_BAYS) {
    at(
      bays[0]?.[0] ?? 0,
      'L020',
      `${bays.length} depot bay(s) ($); a level needs at least ${MIN_DEPOT_BAYS}`,
    );
  }
  const nearest = (dist: Int32Array, i: number): number => {
    const d = dist[i] ?? -1;
    if (d >= 0) return d;
    // A non-drivable source or target cell: measure from its nearest reachable neighbour.
    let best = -1;
    const x = i % w;
    const y = (i - x) / w;
    for (const [dx, dy] of ORTHO) {
      if (!inside(x + dx, y + dy)) continue;
      const n = dist[(y + dy) * w + x + dx] ?? -1;
      if (n >= 0 && (best < 0 || n + 1 < best)) best = n + 1;
    }
    return best;
  };
  if (mode === 'shift' && bayCells.length > 0) {
    const fromBay = pathSteps(map, bayCells);
    for (const skip of skips) {
      let best = -1;
      for (const c of skip) {
        const d = nearest(fromBay, c);
        if (d >= 0 && (best < 0 || d < best)) best = d;
      }
      if (best >= 0 && metres(best) < SKIP_MIN_FROM_BAY_M)
        at(
          skip[0] ?? 0,
          'L020',
          `skip is ${metres(best)} m (path) from the nearest depot bay; skips must be at least ${SKIP_MIN_FROM_BAY_M} m away`,
        );
    }
  }
  /** Report the route tile farthest from `sources` when it is over `maxM`, with the count of tiles over. */
  const reach = (sources: readonly number[], maxM: number, code: LayoutCode, what: string): void => {
    const dist = pathSteps(map, sources);
    let worst = -1;
    let worstSteps = -1;
    let over = 0;
    for (let i = 0; i < w * h; i += 1) {
      if (route[i] !== 1) continue;
      const d = dist[i] ?? -1;
      if (d >= 0 && metres(d) <= maxM) continue;
      over += 1;
      const rank = d < 0 ? Number.MAX_SAFE_INTEGER : d;
      if (rank > worstSteps) {
        worst = i;
        worstSteps = rank;
      }
    }
    if (worst < 0) return;
    const far = worstSteps === Number.MAX_SAFE_INTEGER ? 'unreachable' : `${metres(worstSteps)} m (path)`;
    at(
      worst,
      code,
      `route tile is ${far} from the nearest ${what}; the limit is ${maxM} m (${over} route tile(s) over)`,
    );
  };
  const dumpSources = [...bayCells, ...skips.flat()];
  if (dumpSources.length > 0) reach(dumpSources, DUMP_MAX_M, 'L020', 'dump site (depot bay or skip)');

  // L021: water distance.
  const hydrants: number[] = [];
  for (let i = 0; i < w * h; i += 1) if (prop(i) === HYDRANT) hydrants.push(i);
  reach([...hydrants, ...bayCells], WATER_MAX_M, 'L021', 'hydrant or depot bay');

  // L022: stopping tiles beside hydrants and skips.
  const free = (j: number): boolean => prop(j) === undefined;
  for (const i of hydrants) {
    const x = i % w;
    const y = (i - x) / w;
    const ok = ORTHO.some(([dx, dy]) => {
      if (!inside(x + dx, y + dy)) return false;
      const j = (y + dy) * w + x + dx;
      return carriageway[j] === 1 && free(j);
    });
    if (!ok)
      at(
        i,
        'L022',
        'hydrant has no stopping tile beside it (a road, apron, cobble, yard, alley or dropped-kerb tile with no prop)',
      );
  }
  for (const skip of skips) {
    const xs = skip.map((c) => c % w);
    const ys = skip.map((c) => Math.floor(c / w));
    const spanX = Math.max(...xs) - Math.min(...xs) + 1;
    const spanY = Math.max(...ys) - Math.min(...ys) + 1;
    const sides = ORTHO.filter(([dx]) => (spanX > spanY ? dx === 0 : spanY > spanX ? dx !== 0 : true));
    const ok = skip.some((c) => {
      const x = c % w;
      const y = (c - x) / w;
      return sides.some(([dx, dy]) => {
        if (!inside(x + dx, y + dy)) return false;
        const j = (y + dy) * w + x + dx;
        return map.drivable[j] === 1 && free(j) && site(j) !== SKIP;
      });
    });
    if (!ok)
      at(
        skip[0] ?? 0,
        'L022',
        'skip has no stopping tile beside it (a drivable tile with no prop along a long side)',
      );
  }
  return findings;
}
