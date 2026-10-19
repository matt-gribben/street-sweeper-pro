// The traffic lane graph (SSP-076; LEVEL_DESIGN §7.1, §7.4, §7.5 and §10.3, TECHNICAL_DESIGN §11.4 and
// §15.2) and its checks L011–L013. Pure: no fs. Runs once per compile, so it may allocate.
//
// Rules (as built, SSP-076; LEVEL_DESIGN §7.1 and §10.3 mirror them):
// - A **road cell** is a drivable cell of road ground (tileLayers.ts isRoadCell): `#`, the one-way arrows
//   `> < ^ v` and the road features `z k b p =`. Cobbles, alleys, yards and aprons carry no lanes.
// - Each road cell has a row run and a column run (maximal straight runs of road cells through it). A run is
//   **long** when it is longer than LONG_RUN_TILES (6, the widest road). A cell with only a long row run is an
//   east–west **carriageway** cell, one with only a long column run a north–south one, one with both a
//   **junction** cell, and one with neither a **lay-by** cell (a widening or stub too short to carry traffic).
// - A **segment** is a 4-connected group of carriageway cells of one direction. Its cross-section at each
//   column (row, for north–south) runs from its first to its last cell there. Its flow comes from its arrows:
//   none is two-way, `>`/`<` (`v`/`^`) one-way. An arrow across the segment, or against the segment's first
//   arrow (row-major), is L011; so is a two-way segment narrower than TWO_WAY_MIN_TILES (3) anywhere.
// - Lanes drive on the left: a two-way segment has two lanes, centred a quarter of the cross-section in from
//   each side (eastbound on the north half, westbound on the south half, southbound on the east half,
//   northbound on the west half); a one-way segment has one lane on its centre line. Each lane has one node
//   per column (row) at the tile centre along it, in metres, and edges between consecutive nodes in the
//   direction of travel. An edge carries ZEBRA, SCHOOL_CROSSING or BUS_STOP when the lane's half of the
//   cross-section at its `to` node holds that site (the middle row of an odd width belongs to both halves).
// - **Parking bays**: the `p` cells on a lane's kerb row (its outer cross-section row, or the lay-by row just
//   outside it) are that lane's bays, grouped into runs along it with the lane's heading.
// - **Segment ends**: an end on the map edge is a **portal** (an entry node on the edge for each lane driving
//   in, PORTAL_IN, and an exit node for each lane driving out, PORTAL_OUT); an end beside junction cells is an
//   **arm** of that junction (the 4-connected group of junction cells); any other end is a dead end, where a
//   two-way segment turns round (U_TURN) and a one-way one traps its traffic (L012). A junction whose cells
//   reach the map edge has an **edge arm** there for each run of its cells on the edge: the road leaves the
//   map straight out of the junction, so its lanes are portal nodes on the edge (flow from that run's arrows,
//   L011 as for a segment), and its connectors carry PORTAL_IN or PORTAL_OUT as well.
// - **Junctions** connect every lane arriving on one arm to every lane leaving on each other arm (JUNCTION), or
//   turn a single arm round (U_TURN). With three or more arms, the arms on the minor sides give way (GIVE_WAY):
//   the stem of a T, and at a crossroads the pair of sides with the narrower total width (east–west wins a
//   tie), unless level.json → junctions names the `major` sides. A junction marked `roundabout` is a
//   **mini-roundabout** instead: a ring of 8 nodes circulating clockwise (ROUNDABOUT), each arm joining it on
//   its own side (entries GIVE_WAY to the ring) and leaving it just before.
// - **L012** treats every exit portal as joined to every entry portal (a car that drives off the map is
//   respawned at an entry), then requires the lane graph to be strongly connected. **L013** is a connected
//   group of road cells with no carriageway cell at all (a lone road tile or a small blob of road).
// - Edge speed limits come from tuning.json → streetLife.laneSpeed by road class (M3 tuning).
import { TILE_M } from '../../src/sim/constants.ts';
import { Ground, LANE_FLAG, type LaneGraphLists, type ParkingBay } from '../../src/sim/map.ts';
import type { Tuning } from '../../src/sim/tuning.ts';
import type { ResolvedMap } from './compile-level.ts';
import { JUNCTION_RUN_TILES } from './frontages.ts';
import { isRoadCell } from './tileLayers.ts';

/** Speed limits by road class (tuning.json → streetLife.laneSpeed). */
export type LaneSpeeds = Tuning['streetLife']['laneSpeed'];

export type LaneCode = 'L011' | 'L012' | 'L013';

/** A lane check failure at tile (x, y), 0-based. */
export type LaneFinding = { x: number; y: number; code: LaneCode; message: string };

export type Side = 'n' | 'e' | 's' | 'w';

/** A level.json → junctions entry after the guards: `at` in tiles. */
export type JunctionSpec = {
  at: readonly [number, number];
  major: readonly Side[] | null;
  roundabout: boolean;
};

/** A junctions entry that does not name a junction, by its index in level.json → junctions. */
export type JunctionProblem = { index: number; message: string };

export type LaneGraphResult = {
  lists: LaneGraphLists;
  findings: LaneFinding[];
  junctionProblems: JunctionProblem[];
};

/** A run longer than this is long (the widest road is 6 tiles; LEVEL_DESIGN §7.1). */
export const LONG_RUN_TILES = JUNCTION_RUN_TILES;
/** Narrowest two-way road (LEVEL_DESIGN §7.1, L011). */
export const TWO_WAY_MIN_TILES = 3;
/** Narrowest two-way road that is a main road (LEVEL_DESIGN §7.1) everywhere along its length. */
export const MAIN_ROAD_MIN_TILES = 4;

/** Headings in radians (0 = north, clockwise; TECHNICAL_DESIGN §4). */
const HEADING: { readonly [side in Side]: number } = {
  n: 0,
  e: Math.PI / 2,
  s: Math.PI,
  w: (3 * Math.PI) / 2,
};

const KIND_H = 1;
const KIND_V = 2;
const KIND_J = 3;
const KIND_LAYBY = 4;

const ARROW_CHAR: { readonly [g: number]: string } = {
  [Ground.RoadOneWayE]: '>',
  [Ground.RoadOneWayW]: '<',
  [Ground.RoadOneWayN]: '^',
  [Ground.RoadOneWayS]: 'v',
};

type LaneSide = 'low' | 'high' | 'all';

type Lane = {
  /** Creation order, for sorting. */
  id: number;
  /** +1: along increasing x (east) or y (south); −1 the other way. */
  dir: 1 | -1;
  side: LaneSide;
  /** Node per column (row) of the segment, indexed by along offset k = a − a0. */
  nodeAt: number[];
};

type Segment = {
  axis: 'h' | 'v';
  /** Its cells, row-major. */
  cells: number[];
  /** First cell (row-major). */
  first: number;
  a0: number;
  a1: number;
  /** Cross-section per along offset: first and last across index. */
  lo: number[];
  hi: number[];
  flow: -1 | 0 | 1;
  speedMps: number;
  lanes: Lane[];
};

type Arm = { side: Side; width: number; arriving: number[]; departing: number[] };

type Junction = {
  first: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  arms: Arm[];
  spec: JunctionSpec | null;
};

/**
 * Build the lane graph of a resolved map and run L011–L013 (the module header has the rules). Findings are in
 * row-major order of their tile within each code; the compiler sorts them with the other diagnostics.
 */
export function computeLaneGraph(
  map: ResolvedMap,
  speeds: LaneSpeeds,
  junctionSpecs: readonly JunctionSpec[],
): LaneGraphResult {
  const { w, h } = map;
  const n = w * h;
  const findings: LaneFinding[] = [];
  const junctionProblems: JunctionProblem[] = [];
  const road = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) road[i] = isRoadCell(map, i) ? 1 : 0;

  // Row and column runs, and the cell kinds.
  const rowLen = new Int32Array(n);
  const colLen = new Int32Array(n);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; ) {
      if (road[y * w + x] !== 1) {
        x += 1;
        continue;
      }
      let end = x;
      while (end + 1 < w && road[y * w + end + 1] === 1) end += 1;
      for (let cx = x; cx <= end; cx += 1) rowLen[y * w + cx] = end - x + 1;
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
      for (let cy = y; cy <= end; cy += 1) colLen[cy * w + x] = end - y + 1;
      y = end + 1;
    }
  }
  const kind = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) {
    if (road[i] !== 1) continue;
    const longH = (rowLen[i] ?? 0) > LONG_RUN_TILES;
    const longV = (colLen[i] ?? 0) > LONG_RUN_TILES;
    kind[i] = longH && longV ? KIND_J : longH ? KIND_H : longV ? KIND_V : KIND_LAYBY;
  }

  // Segments (carriageway groups) and junctions (junction groups), in row-major order of their first cell.
  const segOf = new Int32Array(n).fill(-1);
  const junctionOf = new Int32Array(n).fill(-1);
  const segments: Segment[] = [];
  const junctions: Junction[] = [];
  const queue: number[] = [];
  const flood = (seed: number, mark: Int32Array, id: number): number[] => {
    const cells: number[] = [];
    queue.length = 0;
    queue.push(seed);
    mark[seed] = id;
    for (let q = 0; q < queue.length; q += 1) {
      const c = queue[q] ?? 0;
      cells.push(c);
      const cx = c % w;
      const cy = (c - cx) / w;
      for (const [dx, dy] of NEIGHBOURS) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (mark[j] !== -1 || kind[j] !== kind[seed]) continue;
        mark[j] = id;
        queue.push(j);
      }
    }
    return cells.sort((a, b) => a - b);
  };
  for (let i = 0; i < n; i += 1) {
    const k = kind[i];
    if ((k === KIND_H || k === KIND_V) && segOf[i] === -1) {
      const cells = flood(i, segOf, segments.length);
      segments.push(newSegment(k === KIND_H ? 'h' : 'v', cells, w));
    } else if (k === KIND_J && junctionOf[i] === -1) {
      const cells = flood(i, junctionOf, junctions.length);
      let [x0, y0, x1, y1] = [w, h, 0, 0];
      for (const c of cells) {
        const cx = c % w;
        const cy = (c - cx) / w;
        x0 = Math.min(x0, cx);
        y0 = Math.min(y0, cy);
        x1 = Math.max(x1, cx + 1);
        y1 = Math.max(y1, cy + 1);
      }
      junctions.push({ first: i, x0, y0, x1, y1, arms: [], spec: null });
    }
  }

  // level.json → junctions: each entry must name a junction (its `at` tile is a junction cell).
  junctionSpecs.forEach((spec, index) => {
    const x = Math.floor(spec.at[0]);
    const y = Math.floor(spec.at[1]);
    const j = x >= 0 && y >= 0 && x < w && y < h ? (junctionOf[y * w + x] ?? -1) : -1;
    const junction = junctions[j];
    if (junction === undefined) {
      junctionProblems.push({
        index,
        message: `junctions[${index}].at [${spec.at[0]}, ${spec.at[1]}] is not on a junction (road tiles where two roads meet)`,
      });
    } else if (junction.spec !== null) {
      junctionProblems.push({
        index,
        message: `junctions[${index}] names a junction an earlier entry already names`,
      });
    } else junction.spec = spec;
  });

  // Flow and L011.
  const cellAt = (seg: Segment, along: number, across: number): number =>
    seg.axis === 'h' ? across * w + along : along * w + across;
  let laneErrors = false;
  segments.forEach((seg) => {
    const flow = flowOf(map, seg.cells, seg.axis);
    for (const f of flow.findings) findings.push(f);
    if (flow.findings.length > 0) laneErrors = true;
    seg.flow = flow.flow;
    let minWidth = Number.MAX_SAFE_INTEGER;
    let narrowAt = -1;
    for (let k = 0; k <= seg.a1 - seg.a0; k += 1) {
      const width = (seg.hi[k] ?? 0) - (seg.lo[k] ?? 0) + 1;
      if (width < minWidth) minWidth = width;
      if (seg.flow === 0 && width < TWO_WAY_MIN_TILES && narrowAt < 0) narrowAt = k;
    }
    if (narrowAt >= 0) {
      const i = cellAt(seg, seg.a0 + narrowAt, seg.lo[narrowAt] ?? 0);
      findings.push(narrowFinding(i, w, (seg.hi[narrowAt] ?? 0) - (seg.lo[narrowAt] ?? 0) + 1));
      laneErrors = true;
    }
    seg.speedMps =
      seg.flow !== 0
        ? speeds.oneWayMps
        : minWidth >= MAIN_ROAD_MIN_TILES
          ? speeds.mainRoadMps
          : speeds.residentialMps;
  });

  // Lanes, their nodes and edges, and the parking bays beside them.
  const nodes: [number, number][] = [];
  const owner: number[] = [];
  const edges = new Map<number, [number, number, number, number]>();
  const addNode = (x: number, y: number, own: number): number => {
    nodes.push([x, y]);
    owner.push(own);
    return nodes.length - 1;
  };
  const addEdge = (from: number, to: number, speed: number, flags: number): void => {
    const key = from * 0x200000 + to;
    const old = edges.get(key);
    if (old === undefined) edges.set(key, [from, to, speed, flags]);
    else old[3] |= flags;
  };
  const bayCells: { lane: Lane; seg: Segment; across: number; along: number }[] = [];
  const claimed = new Uint8Array(n);
  let laneCount = 0;
  segments.forEach((seg, s) => {
    const sides: [1 | -1, LaneSide][] =
      seg.flow !== 0
        ? [[seg.flow, 'all']]
        : seg.axis === 'h'
          ? [
              [1, 'low'],
              [-1, 'high'],
            ]
          : [
              [1, 'high'],
              [-1, 'low'],
            ];
    const len = seg.a1 - seg.a0 + 1;
    for (const [dir, side] of sides) {
      const lane: Lane = { id: laneCount, dir, side, nodeAt: new Array<number>(len).fill(-1) };
      laneCount += 1;
      seg.lanes.push(lane);
      for (let step = 0; step < len; step += 1) {
        const k = dir === 1 ? step : len - 1 - step;
        const a = seg.a0 + k;
        const lo = seg.lo[k] ?? 0;
        const width = (seg.hi[k] ?? 0) - lo + 1;
        const across =
          side === 'low' ? lo + width / 4 : side === 'high' ? lo + (3 * width) / 4 : lo + width / 2;
        const along = (a + 0.5) * TILE_M;
        const node =
          seg.axis === 'h' ? addNode(along, across * TILE_M, s) : addNode(across * TILE_M, along, s);
        lane.nodeAt[k] = node;
        if (step > 0) {
          const prev = lane.nodeAt[k - dir] ?? 0;
          addEdge(
            prev,
            node,
            seg.speedMps,
            siteFlags(map, laneTiles(seg, k, side), (c) => cellAt(seg, a, c)),
          );
        }
        // Bays on the kerb row(s) of this lane, and the lay-by row just outside.
        const hi = seg.hi[k] ?? 0;
        const kerbRows =
          side === 'low' ? [lo, lo - 1] : side === 'high' ? [hi, hi + 1] : [lo, lo - 1, hi, hi + 1];
        const acrossMax = seg.axis === 'h' ? h : w;
        for (const c of kerbRows) {
          if (c < 0 || c >= acrossMax) continue;
          const i = cellAt(seg, a, c);
          if (road[i] !== 1 || claimed[i] === 1 || map.defs[i]?.mark !== 'parking_bay') continue;
          claimed[i] = 1;
          bayCells.push({ lane, seg, across: c, along: a });
        }
      }
    }
  });
  const bays = bayRuns(bayCells);

  // Segment ends: portals, junction arms and dead ends.
  const exits: number[] = [];
  const entries: number[] = [];
  segments.forEach((seg, s) => {
    const alongMax = seg.axis === 'h' ? w : h;
    for (const outward of [-1, 1] as const) {
      const k = outward === 1 ? seg.a1 - seg.a0 : 0;
      const a = seg.a0 + k;
      const next = a + outward;
      const arriving = seg.lanes.filter((l) => l.dir === outward).map((l) => l.nodeAt[k] ?? 0);
      const departing = seg.lanes.filter((l) => l.dir === -outward).map((l) => l.nodeAt[k] ?? 0);
      if (next < 0 || next >= alongMax) {
        const edge = (outward === 1 ? alongMax : 0) * TILE_M;
        const boundary = (node: number): number => {
          const [x, y] = nodes[node] ?? [0, 0];
          return seg.axis === 'h' ? addNode(edge, y, s) : addNode(x, edge, s);
        };
        for (const node of arriving) {
          const exit = boundary(node);
          addEdge(node, exit, seg.speedMps, LANE_FLAG.PORTAL_OUT);
          exits.push(exit);
        }
        for (const node of departing) {
          const entry = boundary(node);
          addEdge(entry, node, seg.speedMps, LANE_FLAG.PORTAL_IN);
          entries.push(entry);
        }
        continue;
      }
      let j = -1;
      for (let c = seg.lo[k] ?? 0; c <= (seg.hi[k] ?? -1) && j < 0; c += 1) {
        if (segOf[cellAt(seg, a, c)] !== s) continue;
        const beyond = cellAt(seg, next, c);
        if (kind[beyond] === KIND_J) j = junctionOf[beyond] ?? -1;
      }
      const junction = junctions[j];
      if (junction !== undefined) {
        const side: Side = seg.axis === 'h' ? (outward === 1 ? 'w' : 'e') : outward === 1 ? 'n' : 's';
        const width = (seg.hi[k] ?? 0) - (seg.lo[k] ?? 0) + 1;
        junction.arms.push({ side, width, arriving, departing });
      } else {
        for (const from of arriving)
          for (const to of departing) addEdge(from, to, speeds.junctionMps, LANE_FLAG.U_TURN);
      }
    }
  });

  // Junction boxes on the map edge: the road leaving the map there is an arm of portal lanes (no segment).
  junctions.forEach((junction, jIndex) => {
    const own = segments.length + jIndex;
    const edgeSides: [Side, boolean][] = [
      ['n', junction.y0 === 0],
      ['e', junction.x1 === w],
      ['s', junction.y1 === h],
      ['w', junction.x0 === 0],
    ];
    for (const [side, touches] of edgeSides) {
      if (!touches) continue;
      const axis = side === 'e' || side === 'w' ? 'h' : 'v';
      const line = side === 'n' ? 0 : side === 's' ? h - 1 : side === 'w' ? 0 : w - 1;
      const [from, to] = axis === 'h' ? [junction.y0, junction.y1] : [junction.x0, junction.x1];
      const cellOn = (c: number): number => (axis === 'h' ? c * w + line : line * w + c);
      for (let c = from; c < to; c += 1) {
        if (junctionOf[cellOn(c)] !== jIndex || (c > from && junctionOf[cellOn(c - 1)] === jIndex)) continue;
        let hi = c;
        while (hi + 1 < to && junctionOf[cellOn(hi + 1)] === jIndex) hi += 1;
        const runCells: number[] = [];
        for (let k = c; k <= hi; k += 1) runCells.push(cellOn(k));
        const flow = flowOf(
          map,
          [...runCells].sort((p, q) => p - q),
          axis,
        );
        for (const f of flow.findings) findings.push(f);
        if (flow.findings.length > 0) laneErrors = true;
        const width = hi - c + 1;
        if (flow.flow === 0 && width < TWO_WAY_MIN_TILES) {
          findings.push(narrowFinding(runCells[0] ?? 0, w, width));
          laneErrors = true;
        }
        // Travel into the junction: east from the west edge, west from the east edge, south from the north
        // edge, north from the south edge. Lanes sit on the left of their travel, as on a segment.
        const inward: 1 | -1 = side === 'w' || side === 'n' ? 1 : -1;
        const lanes: [1 | -1, LaneSide][] =
          flow.flow !== 0
            ? [[flow.flow, 'all']]
            : axis === 'h'
              ? [
                  [1, 'low'],
                  [-1, 'high'],
                ]
              : [
                  [1, 'high'],
                  [-1, 'low'],
                ];
        const boundary = (side === 'e' ? w : side === 's' ? h : 0) * TILE_M;
        const arm: Arm = { side, width, arriving: [], departing: [] };
        for (const [dir, laneSide] of lanes) {
          const across =
            laneSide === 'low' ? c + width / 4 : laneSide === 'high' ? c + (3 * width) / 4 : c + width / 2;
          const node =
            axis === 'h' ? addNode(boundary, across * TILE_M, own) : addNode(across * TILE_M, boundary, own);
          if (dir === inward) {
            arm.arriving.push(node);
            entries.push(node);
          } else {
            arm.departing.push(node);
            exits.push(node);
          }
        }
        junction.arms.push(arm);
        c = hi;
      }
    }
  });

  // Junction connectors and mini-roundabout rings. A connector from an entry portal (an edge arm) is also
  // PORTAL_IN, and one to an exit portal PORTAL_OUT.
  const entrySet = new Set(entries);
  const exitSet = new Set(exits);
  const portalFlags = (from: number, to: number): number =>
    (entrySet.has(from) ? LANE_FLAG.PORTAL_IN : 0) | (exitSet.has(to) ? LANE_FLAG.PORTAL_OUT : 0);
  const connect = (from: number, to: number, speed: number, flags: number): void =>
    addEdge(from, to, speed, flags | portalFlags(from, to));
  junctions.forEach((junction, jIndex) => {
    const own = segments.length + jIndex;
    const { arms } = junction;
    if (arms.length === 0) return;
    if (junction.spec?.roundabout === true) {
      buildRoundabout(junction, own, speeds.roundaboutMps, addNode, connect);
      return;
    }
    if (arms.length === 1) {
      const arm = arms[0];
      if (arm === undefined) return;
      for (const from of arm.arriving)
        for (const to of arm.departing)
          connect(from, to, speeds.junctionMps, LANE_FLAG.JUNCTION | LANE_FLAG.U_TURN);
      return;
    }
    const major = majorSides(junction);
    for (const a of arms) {
      const flags = LANE_FLAG.JUNCTION | (major === null || major.includes(a.side) ? 0 : LANE_FLAG.GIVE_WAY);
      for (const b of arms) {
        if (b === a) continue;
        for (const from of a.arriving)
          for (const to of b.departing) connect(from, to, speeds.junctionMps, flags);
      }
    }
  });

  const edgeList = [...edges.values()].sort((p, q) => p[0] - q[0] || p[1] - q[1]);

  // L013: a connected group of road cells with no carriageway cell carries no lane at all.
  const component = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i += 1) {
    if (road[i] !== 1 || component[i] !== -1) continue;
    let laned = false;
    queue.length = 0;
    queue.push(i);
    component[i] = i;
    for (let q = 0; q < queue.length; q += 1) {
      const c = queue[q] ?? 0;
      if (kind[c] === KIND_H || kind[c] === KIND_V) laned = true;
      const cx = c % w;
      const cy = (c - cx) / w;
      for (const [dx, dy] of NEIGHBOURS) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (road[j] !== 1 || component[j] !== -1) continue;
        component[j] = i;
        queue.push(j);
      }
    }
    if (!laned)
      findings.push({
        x: i % w,
        y: Math.floor(i / w),
        code: 'L013',
        message: 'road tile not connected to the lane graph',
      });
  }

  // L012: strongly connected, with every exit portal joined to every entry portal.
  if (!laneErrors && nodes.length > 0) {
    const firstCell = (own: number): number =>
      own < segments.length ? (segments[own]?.first ?? 0) : (junctions[own - segments.length]?.first ?? 0);
    for (const f of strongConnectivity(nodes.length, edgeList, exits, entries, owner, firstCell)) {
      findings.push({ x: f.cell % w, y: Math.floor(f.cell / w), code: 'L012', message: f.message });
    }
  }

  return { lists: { nodes, edges: edgeList, bays }, findings, junctionProblems };
}

const NEIGHBOURS: readonly (readonly [number, number])[] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

function newSegment(axis: 'h' | 'v', cells: readonly number[], w: number): Segment {
  let a0 = Number.MAX_SAFE_INTEGER;
  let a1 = -1;
  for (const c of cells) {
    const along = axis === 'h' ? c % w : Math.floor(c / w);
    a0 = Math.min(a0, along);
    a1 = Math.max(a1, along);
  }
  const lo = new Array<number>(a1 - a0 + 1).fill(Number.MAX_SAFE_INTEGER);
  const hi = new Array<number>(a1 - a0 + 1).fill(-1);
  for (const c of cells) {
    const x = c % w;
    const y = (c - x) / w;
    const [along, across] = axis === 'h' ? [x, y] : [y, x];
    const k = along - a0;
    lo[k] = Math.min(lo[k] ?? across, across);
    hi[k] = Math.max(hi[k] ?? across, across);
  }
  return { axis, cells: [...cells], first: cells[0] ?? 0, a0, a1, lo, hi, flow: 0, speedMps: 0, lanes: [] };
}

/**
 * The flow of a group of road cells (row-major) along an axis: +1 (east or south), −1 (west or north) or 0
 * (two-way, no arrows), with the L011 findings for an arrow across the axis and for the first arrow against
 * the group's first arrow. A cross arrow does not count toward the flow.
 */
function flowOf(
  map: ResolvedMap,
  cells: readonly number[],
  axis: 'h' | 'v',
): { flow: -1 | 0 | 1; findings: LaneFinding[] } {
  const plus = axis === 'h' ? Ground.RoadOneWayE : Ground.RoadOneWayS;
  const minus = axis === 'h' ? Ground.RoadOneWayW : Ground.RoadOneWayN;
  const [across0, across1] =
    axis === 'h' ? [Ground.RoadOneWayN, Ground.RoadOneWayS] : [Ground.RoadOneWayE, Ground.RoadOneWayW];
  const roadName = axis === 'h' ? 'east–west' : 'north–south';
  const findings: LaneFinding[] = [];
  let ref = 0;
  let refGround = 0;
  let conflict = false;
  for (const i of cells) {
    const g = map.ground[i] ?? 0;
    const x = i % map.w;
    const y = (i - x) / map.w;
    if (g === across0 || g === across1) {
      findings.push({
        x,
        y,
        code: 'L011',
        message: `one-way arrow ${ARROW_CHAR[g]} points across this ${roadName} road`,
      });
      continue;
    }
    const d = g === plus ? 1 : g === minus ? -1 : 0;
    if (d === 0) continue;
    if (ref === 0) {
      ref = d;
      refGround = g;
    } else if (d !== ref && !conflict) {
      conflict = true;
      findings.push({
        x,
        y,
        code: 'L011',
        message: `one-way arrow ${ARROW_CHAR[g]} points against its neighbours (${ARROW_CHAR[refGround]})`,
      });
    }
  }
  return { flow: ref === 1 ? 1 : ref === -1 ? -1 : 0, findings };
}

/** L011 for a two-way road `width` tiles wide at cell i. */
function narrowFinding(i: number, w: number, width: number): LaneFinding {
  return {
    x: i % w,
    y: Math.floor(i / w),
    code: 'L011',
    message: `two-way traffic on a road ${width} tile(s) wide; a two-way road needs at least ${TWO_WAY_MIN_TILES} (use > < ^ v for a one-way street)`,
  };
}

/** The across indices of a lane's half of the cross-section at along offset k. */
function laneTiles(seg: Segment, k: number, side: LaneSide): number[] {
  const lo = seg.lo[k] ?? 0;
  const hi = seg.hi[k] ?? 0;
  const width = hi - lo + 1;
  const [from, to] =
    side === 'low'
      ? [lo, lo + Math.ceil(width / 2) - 1]
      : side === 'high'
        ? [lo + Math.floor(width / 2), hi]
        : [lo, hi];
  const out: number[] = [];
  for (let c = from; c <= to; c += 1) out.push(c);
  return out;
}

/** ZEBRA / SCHOOL_CROSSING / BUS_STOP for the sites among the given across tiles. */
function siteFlags(map: ResolvedMap, across: readonly number[], cell: (c: number) => number): number {
  let flags = 0;
  for (const c of across) {
    const site = map.defs[cell(c)]?.site;
    if (site === 'site.zebra') flags |= LANE_FLAG.ZEBRA;
    else if (site === 'site.school_crossing') flags |= LANE_FLAG.SCHOOL_CROSSING;
    else if (site === 'site.bus_stop') flags |= LANE_FLAG.BUS_STOP;
  }
  return flags;
}

/** Group bay cells into runs of consecutive cells along one lane's row, sorted north-west first. */
function bayRuns(
  cells: readonly { lane: Lane; seg: Segment; across: number; along: number }[],
): ParkingBay[] {
  const runs: { lane: Lane; seg: Segment; across: number; a0: number; a1: number }[] = [];
  const sorted = [...cells].sort((p, q) => p.lane.id - q.lane.id || p.across - q.across || p.along - q.along);
  for (const cell of sorted) {
    const last = runs[runs.length - 1];
    if (
      last !== undefined &&
      last.lane === cell.lane &&
      last.across === cell.across &&
      last.a1 + 1 === cell.along
    )
      last.a1 = cell.along;
    else runs.push({ lane: cell.lane, seg: cell.seg, across: cell.across, a0: cell.along, a1: cell.along });
  }
  const bays = runs.map((r): ParkingBay => {
    const heading =
      r.seg.axis === 'h'
        ? r.lane.dir === 1
          ? HEADING.e
          : HEADING.w
        : r.lane.dir === 1
          ? HEADING.s
          : HEADING.n;
    const rect: [number, number, number, number] =
      r.seg.axis === 'h'
        ? [r.a0, r.across, r.a1 + 1, r.across + 1]
        : [r.across, r.a0, r.across + 1, r.a1 + 1];
    return { rect, heading };
  });
  return bays.sort((p, q) => p.rect[1] - q.rect[1] || p.rect[0] - q.rect[0] || p.rect[3] - q.rect[3]);
}

/**
 * The major sides of a junction with two or more arms, or null when every arm is major (two arms, or three or
 * more with no opposite pair). level.json → junctions `major` overrides the default.
 */
function majorSides(junction: Junction): readonly Side[] | null {
  const override = junction.spec?.major;
  if (override !== undefined && override !== null) return override;
  if (junction.arms.length < 3) return null;
  const width = (side: Side): number =>
    junction.arms.filter((a) => a.side === side).reduce((sum, a) => sum + a.width, 0);
  const has = (side: Side): boolean => junction.arms.some((a) => a.side === side);
  const ns = has('n') && has('s');
  const ew = has('e') && has('w');
  if (ns && ew) return width('n') + width('s') > width('e') + width('w') ? ['n', 's'] : ['e', 'w'];
  if (ns) return ['n', 's'];
  if (ew) return ['e', 'w'];
  return null;
}

/**
 * A mini-roundabout (LEVEL_DESIGN §7.4): 8 ring nodes around the junction box's centre, two per side, joined
 * clockwise (north side west to east, east side north to south, ...). An arm's departing lanes leave from the
 * first node of its side and its arriving lanes join at the second, so on every side traffic leaves before it
 * joins, as it does driving on the left.
 */
function buildRoundabout(
  junction: Junction,
  own: number,
  speed: number,
  addNode: (x: number, y: number, own: number) => number,
  addEdge: (from: number, to: number, speed: number, flags: number) => void,
): void {
  const cx = (junction.x0 + junction.x1) / 2;
  const cy = (junction.y0 + junction.y1) / 2;
  const half = Math.min(junction.x1 - junction.x0, junction.y1 - junction.y0) / 2;
  const r = Math.max(half - 0.5, 0.5);
  const d = r / 2;
  const ring: { [side in Side]: [exit: number, entry: number] } = {
    n: [
      addNode((cx - d) * TILE_M, (cy - r) * TILE_M, own),
      addNode((cx + d) * TILE_M, (cy - r) * TILE_M, own),
    ],
    e: [
      addNode((cx + r) * TILE_M, (cy - d) * TILE_M, own),
      addNode((cx + r) * TILE_M, (cy + d) * TILE_M, own),
    ],
    s: [
      addNode((cx + d) * TILE_M, (cy + r) * TILE_M, own),
      addNode((cx - d) * TILE_M, (cy + r) * TILE_M, own),
    ],
    w: [
      addNode((cx - r) * TILE_M, (cy + d) * TILE_M, own),
      addNode((cx - r) * TILE_M, (cy - d) * TILE_M, own),
    ],
  };
  const order = [...ring.n, ...ring.e, ...ring.s, ...ring.w];
  for (let i = 0; i < order.length; i += 1)
    addEdge(order[i] ?? 0, order[(i + 1) % order.length] ?? 0, speed, LANE_FLAG.ROUNDABOUT);
  for (const arm of junction.arms) {
    const [exit, entry] = ring[arm.side];
    for (const from of arm.arriving) addEdge(from, entry, speed, LANE_FLAG.ROUNDABOUT | LANE_FLAG.GIVE_WAY);
    for (const to of arm.departing) addEdge(exit, to, speed, LANE_FLAG.ROUNDABOUT);
  }
}

/**
 * L012 (LEVEL_DESIGN §10.3): the strongly connected components of the lane graph, with a virtual node joined
 * from every exit portal and to every entry portal. The main component is the one holding the portals, or
 * the largest (ties to the lowest node) when there are none. Every road (segment or junction) with a node
 * outside it is reported once, at its first tile.
 */
function strongConnectivity(
  nodeCount: number,
  edges: readonly (readonly [number, number, number, number])[],
  exits: readonly number[],
  entries: readonly number[],
  owner: readonly number[],
  firstCell: (own: number) => number,
): { cell: number; message: string }[] {
  const portals = exits.length > 0 || entries.length > 0;
  const total = nodeCount + (portals ? 1 : 0);
  const out: number[][] = Array.from({ length: total }, () => []);
  const back: number[][] = Array.from({ length: total }, () => []);
  const link = (a: number, b: number): void => {
    out[a]?.push(b);
    back[b]?.push(a);
  };
  for (const [from, to] of edges) link(from, to);
  if (portals) {
    for (const e of exits) link(e, nodeCount);
    for (const e of entries) link(nodeCount, e);
  }
  const comp = sccs(total, out, back);
  let main: number;
  if (portals) main = comp[nodeCount] ?? 0;
  else {
    const size = new Map<number, number>();
    for (let v = 0; v < nodeCount; v += 1) size.set(comp[v] ?? 0, (size.get(comp[v] ?? 0) ?? 0) + 1);
    main = comp[0] ?? 0;
    let best = 0;
    for (let v = 0; v < nodeCount; v += 1) {
      const s = size.get(comp[v] ?? 0) ?? 0;
      if (s > best) {
        best = s;
        main = comp[v] ?? 0;
      }
    }
  }
  const root = portals ? nodeCount : comp.indexOf(main);
  const reach = (adj: number[][]): Uint8Array => {
    const seen = new Uint8Array(total);
    const stack = [root];
    seen[root] = 1;
    while (stack.length > 0) {
      const v = stack.pop() ?? 0;
      for (const u of adj[v] ?? []) {
        if (seen[u] === 1) continue;
        seen[u] = 1;
        stack.push(u);
      }
    }
    return seen;
  };
  const fromMain = reach(out);
  const toMain = reach(back);
  const reported = new Set<number>();
  const result: { cell: number; message: string }[] = [];
  for (let v = 0; v < nodeCount; v += 1) {
    if (comp[v] === main) continue;
    const own = owner[v] ?? 0;
    if (reported.has(own)) continue;
    reported.add(own);
    const why =
      fromMain[v] === 1
        ? 'a car here can never rejoin the rest of the road network (a one-way dead end, or arrows that trap it)'
        : toMain[v] === 1
          ? 'no car can reach this road from the rest of the road network'
          : 'this road is cut off from the rest of the road network';
    result.push({ cell: firstCell(own), message: `lane graph not strongly connected: ${why}` });
  }
  return result;
}

/** Strongly connected component id per node (Kosaraju, iterative). */
function sccs(total: number, out: readonly number[][], back: readonly number[][]): Int32Array {
  const order: number[] = [];
  const seen = new Uint8Array(total);
  for (let s = 0; s < total; s += 1) {
    if (seen[s] === 1) continue;
    seen[s] = 1;
    const stack: [number, number][] = [[s, 0]];
    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      if (top === undefined) break;
      const [v, i] = top;
      const next = out[v]?.[i];
      if (next === undefined) {
        order.push(v);
        stack.pop();
        continue;
      }
      top[1] = i + 1;
      if (seen[next] === 0) {
        seen[next] = 1;
        stack.push([next, 0]);
      }
    }
  }
  const comp = new Int32Array(total).fill(-1);
  let id = 0;
  for (let k = order.length - 1; k >= 0; k -= 1) {
    const s = order[k] ?? 0;
    if (comp[s] !== -1) continue;
    const stack = [s];
    comp[s] = id;
    while (stack.length > 0) {
      const v = stack.pop() ?? 0;
      for (const u of back[v] ?? []) {
        if (comp[u] !== -1) continue;
        comp[u] = id;
        stack.push(u);
      }
    }
    id += 1;
  }
  return comp;
}
