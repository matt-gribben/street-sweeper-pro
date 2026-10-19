// The pavement nav graph (SSP-076; LEVEL_DESIGN §7.2–§7.6 and §9.4, TECHNICAL_DESIGN §11.1 and §15.2).
// Pure: no fs. Runs once per compile, so it may allocate.
//
// Rules (as built, SSP-076; LEVEL_DESIGN §7.2 mirrors them):
// - A **walkable** tile is pavement `.` (dropped kerbs `d` and prop, anchor or start tiles that inherit it
//   included), cobbles `:` or alley `;` (drivable or footway) that is not solid (a building, wall, hedge or
//   railing) and not a skip or depot bay. Grass, yards, aprons and roads are not walkable: park paths are
//   pavement. Props on a walkable tile do not remove it; steering walks round them.
// - **Nodes** are the walkable tile centres in metres, row-major. **Edges** join orthogonal neighbours, and
//   diagonal neighbours when both tiles between them are walkable too (no corner cutting). Edges are two-way,
//   written once with from < to.
// - **Crossing edges** are the only edges over a road. From each walkable tile, straight east or south across
//   1..MAX_CROSSING_TILES road tiles to the walkable tile beyond: a crossing over only `site.zebra` tiles is
//   ZEBRA, over only `site.school_crossing` tiles SCHOOL_CROSSING, and any other crossing that starts or ends
//   on a dropped kerb `d` is DROPPED_KERB. Every other way across a road has no edge (jaywalking behaviours
//   leave the graph instead).
// - **Portals** are the nodes on the map edge. A frontage's **door** is the walkable tile in front of the
//   middle tile of its facade (or, when that one is not walkable, the nearest walkable tile of its zone). An
//   **anchor** names the node on its tile, or the nearest node (ties to the lower index) when its tile is not
//   walkable; one digit is listed once per node.
import { TILE_M } from '../../src/sim/constants.ts';
import { Ground, NAV_FLAG, type NavAnchor, type NavDoor, type NavGraphLists } from '../../src/sim/map.ts';
import type { AnchorPoint, ResolvedMap } from './compile-level.ts';
import type { GeneratedFrontage } from './frontages.ts';
import { isRoadCell } from './tileLayers.ts';

/** The longest crossing in road tiles: the widest road (LEVEL_DESIGN §7.1). */
export const MAX_CROSSING_TILES = 6;

/** Whether tile i is walkable (the module header has the rule). */
export function isWalkable(map: ResolvedMap, i: number): boolean {
  const g = map.ground[i];
  if (g !== Ground.Pavement && g !== Ground.Cobbles && g !== Ground.Alley) return false;
  if (map.solid[i] !== 0 || map.building[i] !== -1) return false;
  const site = map.defs[i]?.site;
  return site !== 'site.skip' && site !== 'site.depot_bay';
}

const FACE_STEP: { readonly [face: string]: readonly [number, number] } = {
  n: [0, -1],
  e: [1, 0],
  s: [0, 1],
  w: [-1, 0],
};

/** Build the nav graph of a resolved map (the module header has the rules). */
export function computeNavGraph(
  map: ResolvedMap,
  frontages: readonly GeneratedFrontage[],
  anchorPoints: readonly AnchorPoint[],
): NavGraphLists {
  const { w, h } = map;
  const n = w * h;
  const nodeOf = new Int32Array(n).fill(-1);
  const nodes: [number, number][] = [];
  for (let i = 0; i < n; i += 1) {
    if (!isWalkable(map, i)) continue;
    const x = i % w;
    const y = (i - x) / w;
    nodeOf[i] = nodes.length;
    nodes.push([(x + 0.5) * TILE_M, (y + 0.5) * TILE_M]);
  }
  const at = (x: number, y: number): number =>
    x >= 0 && y >= 0 && x < w && y < h ? (nodeOf[y * w + x] ?? -1) : -1;

  const edges: [number, number, number][] = [];
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const a = at(x, y);
      if (a < 0) continue;
      const east = at(x + 1, y);
      const south = at(x, y + 1);
      if (east >= 0) edges.push([a, east, 0]);
      if (south >= 0) edges.push([a, south, 0]);
      if (south >= 0 && east >= 0 && at(x + 1, y + 1) >= 0) edges.push([a, at(x + 1, y + 1), 0]);
      if (south >= 0 && at(x - 1, y) >= 0 && at(x - 1, y + 1) >= 0) edges.push([a, at(x - 1, y + 1), 0]);
      for (const [dx, dy] of [
        [1, 0],
        [0, 1],
      ] as const) {
        const flags = crossing(map, x, y, dx, dy);
        if (flags === null) continue;
        edges.push([a, at(x + dx * (flags.steps + 1), y + dy * (flags.steps + 1)), flags.flags]);
      }
    }
  }
  edges.sort((p, q) => p[0] - q[0] || p[1] - q[1]);

  const portals: number[] = [];
  for (let i = 0; i < nodes.length; i += 1) {
    const [mx, my] = nodes[i] ?? [0, 0];
    const x = Math.floor(mx / TILE_M);
    const y = Math.floor(my / TILE_M);
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1) portals.push(i);
  }

  const nearest = (x: number, y: number, among: readonly number[]): number => {
    let best = -1;
    let bestD = Number.MAX_SAFE_INTEGER;
    for (const i of among) {
      const node = nodeOf[i] ?? -1;
      if (node < 0) continue;
      const cx = i % w;
      const cy = (i - cx) / w;
      const d = (cx - x) ** 2 + (cy - y) ** 2;
      if (d < bestD || (d === bestD && node < best)) {
        best = node;
        bestD = d;
      }
    }
    return best;
  };
  const allTiles = Array.from({ length: n }, (_, i) => i);

  const doors: NavDoor[] = [];
  for (const f of frontages) {
    const [dx, dy] = FACE_STEP[f.face] ?? [0, 0];
    const front = f.cells.filter((i) => {
      const x = i % w;
      const y = (i - x) / w;
      const bx = x - dx;
      const by = y - dy;
      return bx >= 0 && by >= 0 && bx < w && by < h && map.building[by * w + bx] === f.building;
    });
    const middle = front[Math.floor((front.length - 1) / 2)];
    if (middle === undefined) continue;
    const mx = middle % w;
    const node = nearest(mx, (middle - mx) / w, nodeOf[middle] !== -1 ? [middle] : f.cells);
    if (node >= 0) doors.push({ frontage: f.id, node });
  }

  const anchors: NavAnchor[] = [];
  for (const a of anchorPoints) {
    const [x, y] = a.tile;
    const own = at(x, y);
    const node = own >= 0 ? own : nearest(x, y, allTiles);
    if (node >= 0) anchors.push({ char: a.char, name: a.name, node });
  }
  anchors.sort((p, q) => (p.char < q.char ? -1 : p.char > q.char ? 1 : p.node - q.node));
  // Two tiles of one digit can share a node (both off the walkable area, nearest to the same tile): keep one.
  const unique = anchors.filter((a, i) => {
    const prev = anchors[i - 1];
    return prev === undefined || prev.char !== a.char || prev.node !== a.node;
  });

  return { nodes, edges, portals, doors, anchors: unique };
}

/**
 * The crossing that starts at walkable tile (x, y) and runs straight along (dx, dy) over road tiles to the
 * walkable tile beyond, with its NAV_FLAG, or null when there is none.
 */
function crossing(
  map: ResolvedMap,
  x: number,
  y: number,
  dx: number,
  dy: number,
): { steps: number; flags: number } | null {
  const { w, h } = map;
  let zebra = true;
  let school = true;
  let steps = 0;
  let cx = x + dx;
  let cy = y + dy;
  while (cx >= 0 && cy >= 0 && cx < w && cy < h && isRoadCell(map, cy * w + cx)) {
    const site = map.defs[cy * w + cx]?.site;
    zebra &&= site === 'site.zebra';
    school &&= site === 'site.school_crossing';
    steps += 1;
    if (steps > MAX_CROSSING_TILES) return null;
    cx += dx;
    cy += dy;
  }
  if (steps === 0 || cx < 0 || cy < 0 || cx >= w || cy >= h || !isWalkable(map, cy * w + cx)) return null;
  if (zebra) return { steps, flags: NAV_FLAG.ZEBRA };
  if (school) return { steps, flags: NAV_FLAG.SCHOOL_CROSSING };
  const dropped = (i: number): boolean => map.defs[i]?.mark === 'dropped_kerb';
  if (dropped(y * w + x) || dropped(cy * w + cx)) return { steps, flags: NAV_FLAG.DROPPED_KERB };
  return null;
}
