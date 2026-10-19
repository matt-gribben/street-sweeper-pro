// Frontage generation and the street segmentation behind L031 (LEVEL_DESIGN §7.10, §10.3; TECHNICAL_DESIGN
// §15.2; SSP-055). Pure: no fs. Runs once per compile, so it may allocate.
//
// Definitions (as built, SSP-055; LEVEL_DESIGN §7.10 mirrors them):
// - A **walk** tile is pavement or cobbles (a precinct) that is not solid, not a building and not a depot bay:
//   the ground a frontage faces. Dropped kerbs and prop or skip tiles on pavement are walk tiles (their ground
//   is pavement). Depot bays are excluded because a bay cell with no plain-ground neighbour inherits pavement
//   (LEVEL_DESIGN §8.3) although it stands on the depot apron.
// - A **facade run** is a maximal straight line of one building's cells whose side in one compass direction
//   (the `face`) faces open street, for a building whose `use` is house, shop, pub, takeaway, civic or unit.
//   A side faces open street when the tiles straight out from it start with a walk tile and the walk either
//   runs the full FRONTAGE_ZONE_DEPTH or ends at a drivable tile (road, verge, yard...) or the map edge. A walk
//   shut by a building, wall, hedge, water or footway is a side passage or a gable path, not a frontage (two
//   end-of-terrace walls across a 1-tile gap would otherwise make two frontages of the same single tile).
//   Horizontal runs are split west to east, vertical runs north to south, into segments of the building's
//   frontage width; a leftover under half a width merges into the last segment, otherwise it is its own
//   segment (so a run shorter than half a width is still one frontage).
// - A segment's **zone** is, for each of its cells, the walk tiles straight out from the face (up to
//   FRONTAGE_ZONE_DEPTH) plus the road tile straight after them, when there is one (the gutter). A zone is not
//   always a rectangle, so the compiled frontage carries the zone's `cells` and their bounding `rect`.
// - **ID** `fr_<x>_<y>` is the zone's north-west-most walk tile (the first in row-major order). Two zones can
//   share that tile (facades facing each other across a narrow precinct): frontages are named in the order of
//   their north-west-most walk tile (then face n, e, s, w, then segment start), and a frontage whose tile is
//   already taken uses its next walk tile in row-major order.
// - A **street** (L031) is a connected run of road tiles split at junctions. A road tile whose row run and
//   column run (of road tiles) are both longer than JUNCTION_RUN_TILES is a junction tile; every other road
//   tile runs east–west when its row run is at least its column run, otherwise north–south. Streets are the
//   4-connected groups of same-direction tiles; each 4-connected group of junction tiles that touches three or
//   more of them is a junction (its own street), and one that touches at most two is a bend or a widening, so it
//   joins them into one street. A frontage is on the street that holds most of its gutter tiles (ties to the
//   first street in row-major order); a frontage with no gutter tile is on no street.
import { Ground } from '../../src/sim/map.ts';
import type { BuildingUse } from './schema.ts';
import { isRoadGround } from './tileLayers.ts';

/** The building uses that get frontages (LEVEL_DESIGN §7.10). */
export const FRONTAGE_USES = ['house', 'shop', 'pub', 'takeaway', 'civic', 'unit'] as const;
export type FrontageUse = (typeof FRONTAGE_USES)[number];

export function isFrontageUse(use: BuildingUse | string): use is FrontageUse {
  return FRONTAGE_USES.some((u) => u === use);
}

/**
 * Frontage width in tiles by use (LEVEL_DESIGN §7.10, confirmed in M2: §13 Q4). A level overrides them with
 * level.json → frontageWidth, a building with its own frontageWidth.
 */
export const DEFAULT_FRONTAGE_WIDTH: { readonly [use in FrontageUse]: number } = {
  house: 3,
  shop: 4,
  pub: 5,
  takeaway: 5,
  unit: 6,
  civic: 8,
};

/** Walk tiles a zone reaches out from the facade, before the gutter tile (LEVEL_DESIGN §7.10, §13 Q4). */
export const FRONTAGE_ZONE_DEPTH = 3;

/** A road tile whose row and column runs are both longer than this is a junction tile (widest road: 6). */
export const JUNCTION_RUN_TILES = 6;

/** The fields of the compiler's ResolvedMap that frontages read (structural, to avoid an import cycle). */
export type FrontageMap = {
  w: number;
  h: number;
  defs: readonly ({ site?: string } | null)[];
  ground: Uint8Array;
  drivable: Uint8Array;
  solid: Uint8Array;
  building: Int16Array;
};

export type Face = 'n' | 'e' | 's' | 'w';

/** Face order for naming ties, and each face's outward step. */
const FACE_STEPS: readonly (readonly [Face, number, number])[] = [
  ['n', 0, -1],
  ['e', 1, 0],
  ['s', 0, 1],
  ['w', -1, 0],
];

/** One generated frontage, before pledges are resolved. Tiles are row-major indices (y·w + x). */
export type GeneratedFrontage = {
  id: string;
  face: Face;
  /** Index of the building instance it belongs to. */
  building: number;
  /** Bounding box of the zone in tiles, x1/y1 exclusive. */
  rect: [number, number, number, number];
  /** Zone tiles, sorted row-major. */
  cells: number[];
  /** The gutter (road) tiles of the zone, sorted. */
  gutter: number[];
};

/**
 * Segment lengths of a facade run of `length` tiles at `width` tiles per frontage: whole widths, with a
 * leftover under half a width merged into the last segment and any other leftover its own segment.
 */
export function splitRun(length: number, width: number): number[] {
  if (length <= 0) return [];
  const whole = Math.floor(length / width);
  const leftover = length - whole * width;
  const out: number[] = new Array<number>(whole).fill(width);
  if (leftover === 0) return out;
  if (whole > 0 && leftover * 2 < width) out[whole - 1] = width + leftover;
  else out.push(leftover);
  return out;
}

/** Whether tile i is a walk tile: pavement or cobbles, not solid, not a building. */
function isWalk(map: FrontageMap, i: number): boolean {
  const g = map.ground[i];
  return (
    (g === Ground.Pavement || g === Ground.Cobbles) &&
    map.solid[i] === 0 &&
    map.building[i] === -1 &&
    map.defs[i]?.site !== 'site.depot_bay'
  );
}

/** Whether tile i is a gutter candidate: road ground (any road feature), not solid, not a building. */
function isRoadTile(map: FrontageMap, i: number): boolean {
  return isRoadGround(map.ground[i] ?? 0) && map.solid[i] === 0 && map.building[i] === -1;
}

/**
 * Every frontage of the map. `widths[b]` is building instance b's frontage width in tiles, or 0 when its use
 * gets none. Sorted by ID tile (row-major).
 */
export function generateFrontages(map: FrontageMap, widths: readonly number[]): GeneratedFrontage[] {
  const { w, h } = map;
  const inside = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < w && y < h;
  type Draft = Omit<GeneratedFrontage, 'id'> & { walk: number[]; faceOrder: number; start: number };
  const drafts: Draft[] = [];
  FACE_STEPS.forEach(([face, dx, dy], faceOrder) => {
    const horizontal = dy !== 0;
    const lines = horizontal ? h : w;
    const along = horizontal ? w : h;
    for (let line = 0; line < lines; line += 1) {
      let runStart = -1;
      let runBuilding = -1;
      const flush = (end: number): void => {
        if (runStart < 0) return;
        const width = widths[runBuilding] ?? 0;
        let s = runStart;
        for (const len of splitRun(end - runStart, width)) {
          drafts.push(makeDraft(face, faceOrder, dx, dy, horizontal, line, s, len, runBuilding));
          s += len;
        }
        runStart = -1;
        runBuilding = -1;
      };
      for (let a = 0; a <= along; a += 1) {
        let b = -1;
        if (a < along) {
          const x = horizontal ? a : line;
          const y = horizontal ? line : a;
          const i = y * w + x;
          const bi = map.building[i] ?? -1;
          if (bi >= 0 && (widths[bi] ?? 0) > 0 && zoneColumn(x, y, dx, dy).open) b = bi;
        }
        if (b !== runBuilding || b < 0) flush(a);
        if (b >= 0 && runStart < 0) {
          runStart = a;
          runBuilding = b;
        }
      }
    }
  });

  /**
   * The zone column straight out from building cell (x, y) in direction (dx, dy): its walk tiles (up to
   * FRONTAGE_ZONE_DEPTH), the gutter road tile after them (or −1), and whether the facade faces open street:
   * at least one walk tile, then either the full depth of walk, or a drivable tile or the map edge after the
   * walk. A walk run shut by a building, wall, hedge, water or footway is a side passage, not a frontage.
   */
  function zoneColumn(
    x: number,
    y: number,
    dx: number,
    dy: number,
  ): { walk: number[]; gutter: number; open: boolean } {
    const walk: number[] = [];
    let cx = x;
    let cy = y;
    for (let depth = 0; depth <= FRONTAGE_ZONE_DEPTH; depth += 1) {
      cx += dx;
      cy += dy;
      if (!inside(cx, cy)) return { walk, gutter: -1, open: walk.length > 0 };
      const i = cy * w + cx;
      if (depth < FRONTAGE_ZONE_DEPTH && isWalk(map, i)) {
        walk.push(i);
        continue;
      }
      if (walk.length === 0) return { walk, gutter: -1, open: false };
      if (isRoadTile(map, i)) return { walk, gutter: i, open: true };
      return { walk, gutter: -1, open: depth === FRONTAGE_ZONE_DEPTH || map.drivable[i] === 1 };
    }
    return { walk, gutter: -1, open: walk.length > 0 };
  }

  function makeDraft(
    face: Face,
    faceOrder: number,
    dx: number,
    dy: number,
    horizontal: boolean,
    line: number,
    start: number,
    len: number,
    building: number,
  ): Draft {
    const cells: number[] = [];
    const walk: number[] = [];
    const gutter: number[] = [];
    for (let a = start; a < start + len; a += 1) {
      const col = zoneColumn(horizontal ? a : line, horizontal ? line : a, dx, dy);
      walk.push(...col.walk);
      cells.push(...col.walk);
      if (col.gutter >= 0) {
        gutter.push(col.gutter);
        cells.push(col.gutter);
      }
    }
    const byIndex = (p: number, q: number): number => p - q;
    cells.sort(byIndex);
    walk.sort(byIndex);
    gutter.sort(byIndex);
    let [x0, y0, x1, y1] = [w, h, 0, 0];
    for (const i of cells) {
      const x = i % w;
      const y = (i - x) / w;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x + 1);
      y1 = Math.max(y1, y + 1);
    }
    return { face, faceOrder, building, rect: [x0, y0, x1, y1], cells, gutter, walk, start };
  }

  // Name in order of the north-west-most walk tile, then face, then segment start.
  drafts.sort(
    (p, q) => (p.walk[0] ?? 0) - (q.walk[0] ?? 0) || p.faceOrder - q.faceOrder || p.start - q.start,
  );
  const taken = new Set<number>();
  const named: { tile: number; frontage: GeneratedFrontage }[] = [];
  for (const d of drafts) {
    const tile = d.walk.find((i) => !taken.has(i));
    // Every zone has a walk tile per facade cell, so this needs more frontages than walk tiles crowded onto
    // one patch of pavement (only conceivable on a map of 1-tile precincts); treat it as a compiler fault.
    if (tile === undefined) throw new Error('generateFrontages: no free walk tile to name a frontage');
    taken.add(tile);
    const x = tile % w;
    const y = (tile - x) / w;
    named.push({
      tile,
      frontage: {
        id: `fr_${x}_${y}`,
        face: d.face,
        building: d.building,
        rect: d.rect,
        cells: d.cells,
        gutter: d.gutter,
      },
    });
  }
  named.sort((p, q) => p.tile - q.tile);
  return named.map((n) => n.frontage);
}

/**
 * Street id per tile (−1 off road), numbered 0.. in row-major order of each street's first tile, plus each
 * street's first tile. See the header for the definition.
 */
export function computeStreets(map: FrontageMap): { street: Int32Array; first: number[] } {
  const { w, h } = map;
  const n = w * h;
  const road = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) road[i] = isRoadTile(map, i) ? 1 : 0;
  const rowRun = new Int32Array(n);
  const colRun = new Int32Array(n);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; ) {
      if (road[y * w + x] !== 1) {
        x += 1;
        continue;
      }
      let end = x;
      while (end + 1 < w && road[y * w + end + 1] === 1) end += 1;
      for (let cx = x; cx <= end; cx += 1) rowRun[y * w + cx] = end - x + 1;
      x = end + 1;
    }
  }
  for (let x = 0; x < w; x += 1) {
    for (let y = 0; y < h; ) {
      if (road[y * w + x] !== 1) {
        y += 1;
        continue;
      }
      let end = y;
      while (end + 1 < h && road[(end + 1) * w + x] === 1) end += 1;
      for (let cy = y; cy <= end; cy += 1) colRun[cy * w + x] = end - y + 1;
      y = end + 1;
    }
  }
  // Kind per road tile: 1 east–west, 2 north–south, 3 junction; 0 off road.
  const kind = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) {
    if (road[i] !== 1) continue;
    const r = rowRun[i] ?? 0;
    const c = colRun[i] ?? 0;
    kind[i] = r > JUNCTION_RUN_TILES && c > JUNCTION_RUN_TILES ? 3 : r >= c ? 1 : 2;
  }
  // 4-connected groups of the same kind.
  const group = new Int32Array(n).fill(-1);
  const groupKind: number[] = [];
  const queue: number[] = [];
  for (let i = 0; i < n; i += 1) {
    if (kind[i] === 0 || group[i] !== -1) continue;
    const g = groupKind.length;
    groupKind.push(kind[i] ?? 0);
    group[i] = g;
    queue.length = 0;
    queue.push(i);
    for (let q = 0; q < queue.length; q += 1) {
      const c = queue[q] ?? 0;
      for (const j of near4(c, w, h)) {
        if (group[j] !== -1 || kind[j] !== kind[c]) continue;
        group[j] = g;
        queue.push(j);
      }
    }
  }
  // Union-find: a junction group touching at most two street groups joins them.
  const parent = groupKind.map((_, g) => g);
  const find = (g: number): number => {
    let r = g;
    while ((parent[r] ?? r) !== r) r = parent[r] ?? r;
    let c = g;
    while ((parent[c] ?? c) !== r) {
      const next = parent[c] ?? r;
      parent[c] = r;
      c = next;
    }
    return r;
  };
  const arms: Set<number>[] = groupKind.map(() => new Set<number>());
  for (let i = 0; i < n; i += 1) {
    const g = group[i] ?? -1;
    if (g < 0 || groupKind[g] !== 3) continue;
    for (const j of near4(i, w, h)) {
      const o = group[j] ?? -1;
      if (o >= 0 && groupKind[o] !== 3) arms[g]?.add(o);
    }
  }
  groupKind.forEach((k, g) => {
    const touching = arms[g];
    if (k !== 3 || touching === undefined || touching.size > 2) return;
    for (const o of [...touching].sort((p, q) => p - q)) {
      const a = find(g);
      const b = find(o);
      if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
    }
  });
  // Number streets by first tile in row-major order.
  const street = new Int32Array(n).fill(-1);
  const ids = new Map<number, number>();
  const first: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const g = group[i] ?? -1;
    if (g < 0) continue;
    const root = find(g);
    let id = ids.get(root);
    if (id === undefined) {
      id = first.length;
      ids.set(root, id);
      first.push(i);
    }
    street[i] = id;
  }
  return { street, first };
}

/** The street a frontage is on: the one holding most of its gutter tiles (ties to the lower id), or −1. */
export function frontageStreet(street: Int32Array, gutter: readonly number[]): number {
  const counts = new Map<number, number>();
  for (const i of gutter) {
    const s = street[i] ?? -1;
    if (s >= 0) counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  let best = -1;
  let bestCount = 0;
  for (const [s, c] of [...counts.entries()].sort((p, q) => p[0] - q[0])) {
    if (c > bestCount) {
      best = s;
      bestCount = c;
    }
  }
  return best;
}

/** The in-bounds orthogonal neighbours of cell c in a w×h grid. */
function near4(c: number, w: number, h: number): number[] {
  const x = c % w;
  const y = (c - x) / w;
  const out: number[] = [];
  for (const [, dx, dy] of FACE_STEPS) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx >= 0 && ny >= 0 && nx < w && ny < h) out.push(ny * w + nx);
  }
  return out;
}
