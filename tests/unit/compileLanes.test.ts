// The traffic lane graph, the pavement nav graph and L011–L013 (SSP-076; LEVEL_DESIGN §7.1–§7.5, §10.3;
// TECHNICAL_DESIGN §11.1, §11.4, §15.2). The fixtures per code (l011_two_way, l012_stuck, l013_isolated) are
// in compileLevel.test.ts with the other codes; the round trip with lanes and nav is the property test.
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TILE_M } from '../../src/sim/constants.ts';
import {
  decodeLevel,
  LANE_FLAG,
  type LaneGraph,
  NAV_FLAG,
  NAV_FLAG_CROSSING,
  type NavGraph,
} from '../../src/sim/map.ts';
import { DEFAULT_TUNING } from '../../src/sim/tuning.ts';
import {
  type CompileResult,
  compileLevel,
  formatDiagnostic,
  readManifestIds,
} from '../../tools/levels/compile-level.ts';
import { KERB_BLOB_PATH, readKerbBlob } from '../../tools/levels/kerbBlob.ts';
import type { LayoutCode } from '../../tools/levels/layoutChecks.ts';
import { graphViolations } from '../support/levelInvariants.ts';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const KNOWN = readManifestIds(join(REPO_ROOT, 'tests/fixtures/levels/manifest.json'));
const KERB_BLOB = readKerbBlob(join(REPO_ROOT, KERB_BLOB_PATH));
/** The layout codes need depot bays and hydrants these small maps do not have; the lane codes stay on. */
const LAYOUT_CODES: readonly LayoutCode[] = ['L014', 'L015', 'L020', 'L021', 'L022'];
const SPEED = DEFAULT_TUNING.streetLife.laneSpeed;

const BUILDING = { storeys: 2, roof: 'roof.slate', wall: 'facade.terrace_brick', use: 'house' };

function compile(rows: readonly string[], extra: Record<string, unknown> = {}): CompileResult {
  const w = rows[0]?.length ?? 0;
  const level = {
    schema: 1,
    id: 'district.lanes',
    name: 'Lane Test',
    day: 'mon',
    mode: 'shift',
    map: 't.map.txt',
    size: [w, rows.length],
    timer: 240,
    seed: 3,
    timeOfDay: 'morning',
    weather: 'clear',
    start: { heading: 0 },
    depot: { rect: [0, 0, w, rows.length] },
    buildings: { A: BUILDING },
    ...extra,
  };
  return compileLevel({
    name: 't',
    mapText: rows.map((r) => `${r}\n`).join(''),
    levelText: `${JSON.stringify(level, null, 2)}\n`,
    knownAssetIds: KNOWN,
    kerbBlob: KERB_BLOB,
    skipCodes: LAYOUT_CODES,
  });
}

function messages(result: CompileResult): string[] {
  return result.diagnostics.map(formatDiagnostic);
}

function ok(
  rows: readonly string[],
  extra: Record<string, unknown> = {},
): NonNullable<CompileResult['output']> {
  const result = compile(rows, extra);
  expect(messages(result)).toEqual([]);
  if (result.output === null) throw new Error('expected a compiled level');
  expect(graphViolations(decodeLevel(result.output.text), result.output.map)).toEqual([]);
  return result.output;
}

type Edge = {
  from: number;
  to: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  speed: number;
  flags: number;
};

function laneEdges(g: LaneGraph): Edge[] {
  const out: Edge[] = [];
  for (let e = 0; e < g.edgeCount; e += 1) {
    const from = g.edgeFrom[e] ?? 0;
    const to = g.edgeTo[e] ?? 0;
    out.push({
      from,
      to,
      x0: g.nodeX[from] ?? 0,
      y0: g.nodeY[from] ?? 0,
      x1: g.nodeX[to] ?? 0,
      y1: g.nodeY[to] ?? 0,
      speed: g.edgeSpeedMps[e] ?? 0,
      flags: g.edgeFlags[e] ?? 0,
    });
  }
  return out;
}

function navEdges(g: NavGraph): Edge[] {
  const out: Edge[] = [];
  for (let e = 0; e < g.edgeCount; e += 1) {
    const from = g.edgeFrom[e] ?? 0;
    const to = g.edgeTo[e] ?? 0;
    out.push({
      from,
      to,
      x0: g.nodeX[from] ?? 0,
      y0: g.nodeY[from] ?? 0,
      x1: g.nodeX[to] ?? 0,
      y1: g.nodeY[to] ?? 0,
      speed: 0,
      flags: g.edgeFlags[e] ?? 0,
    });
  }
  return out;
}

/** Plain lane edges (no junction, portal or turn flags) heading in a compass direction. */
function along(edges: readonly Edge[], dir: 'e' | 'w' | 'n' | 's'): Edge[] {
  const special = LANE_FLAG.JUNCTION | LANE_FLAG.PORTAL_IN | LANE_FLAG.PORTAL_OUT | LANE_FLAG.U_TURN;
  return edges.filter((e) => {
    if ((e.flags & special) !== 0) return false;
    if (dir === 'e') return e.x1 > e.x0 && e.y1 === e.y0;
    if (dir === 'w') return e.x1 < e.x0 && e.y1 === e.y0;
    if (dir === 's') return e.y1 > e.y0 && e.x1 === e.x0;
    return e.y1 < e.y0 && e.x1 === e.x0;
  });
}

/** A 3-tile east–west road from the west edge to the east edge (rows 2–4), pavements either side. */
const EW_ROAD = [
  'AAAAAAAAAAAA',
  '............',
  '############',
  '############',
  '############',
  '...@........',
];

describe('lane graph (LEVEL_DESIGN §7.1: drive on the left)', () => {
  it('puts eastbound lane nodes north of the centreline and westbound nodes south of it', () => {
    const { level } = ok(EW_ROAD);
    const edges = laneEdges(level.lanes);
    const centreY = (2 + 3 / 2) * TILE_M;
    const east = along(edges, 'e');
    const west = along(edges, 'w');
    expect(east).toHaveLength(11);
    expect(west).toHaveLength(11);
    for (const e of east) expect(e.y0).toBeLessThan(centreY);
    for (const e of west) expect(e.y0).toBeGreaterThan(centreY);
    // A quarter of the 6 m carriageway in from each kerb: 1.5 m off the centreline.
    expect(new Set(east.map((e) => e.y0))).toEqual(new Set([centreY - 1.5]));
    expect(new Set(west.map((e) => e.y0))).toEqual(new Set([centreY + 1.5]));
    // One node per tile along the lane, at the tile centre.
    expect(east.map((e) => e.x0)).toEqual(Array.from({ length: 11 }, (_, x) => (x + 0.5) * TILE_M));
    // A 3-tile two-way road is residential.
    for (const e of [...east, ...west]) expect(e.speed).toBe(SPEED.residentialMps);
  });

  it('drives southbound on the east half and northbound on the west half of a north–south road', () => {
    const rows = ['A.###.@', 'A.###..', 'A.###..', 'A.###..', 'A.###..', 'A.###..', 'A.###..', 'A.###..'];
    const edges = laneEdges(ok(rows).level.lanes);
    const centreX = (2 + 1.5) * TILE_M;
    expect(along(edges, 's').length).toBe(7);
    for (const e of along(edges, 's')) expect(e.x0).toBe(centreX + 1.5);
    for (const e of along(edges, 'n')) expect(e.x0).toBe(centreX - 1.5);
  });

  it('gives a 4-tile road main-road lanes 2 m either side of the centre line, and a one-way road one centre lane', () => {
    const main = [
      'AAAAAAAAAA',
      '..........',
      '##########',
      '##########',
      '##########',
      '##########',
      '..@.......',
    ];
    const mainEdges = laneEdges(ok(main).level.lanes);
    expect(new Set(along(mainEdges, 'e').map((e) => e.y0))).toEqual(new Set([3 * TILE_M]));
    expect(new Set(along(mainEdges, 'w').map((e) => e.y0))).toEqual(new Set([5 * TILE_M]));
    for (const e of along(mainEdges, 'e')) expect(e.speed).toBe(SPEED.mainRoadMps);

    const oneWay = ['AAAAAAAAAA', '..........', '<<<<<<<<<<', '<<<<<<<<<<', '..@.......'];
    const edges = laneEdges(ok(oneWay).level.lanes);
    expect(along(edges, 'e')).toEqual([]);
    expect(along(edges, 'w')).toHaveLength(9);
    for (const e of along(edges, 'w')) {
      expect(e.y0).toBe(3 * TILE_M);
      expect(e.speed).toBe(SPEED.oneWayMps);
    }
  });

  it('puts portal nodes on the map edge: lanes driving in start there, lanes driving out end there', () => {
    const edges = laneEdges(ok(EW_ROAD).level.lanes);
    const portalIn = edges.filter((e) => (e.flags & LANE_FLAG.PORTAL_IN) !== 0);
    const portalOut = edges.filter((e) => (e.flags & LANE_FLAG.PORTAL_OUT) !== 0);
    expect(portalIn.map((e) => [e.x0, e.y0, e.x1])).toEqual([
      [0, 5.5, 1],
      [24, 8.5, 23],
    ]);
    expect(portalOut.map((e) => [e.x0, e.x1, e.y1])).toEqual([
      [23, 24, 5.5],
      [1, 0, 8.5],
    ]);
  });

  it('turns a two-way dead end round, and records parking bays with the heading of the lane beside them', () => {
    const rows = ['AAAAAAAAAA', '..........', '#########.', '#########.', 'ppp######.', '...@......'];
    const { level } = ok(rows);
    const turns = laneEdges(level.lanes).filter((e) => (e.flags & LANE_FLAG.U_TURN) !== 0);
    expect(turns.map((e) => [e.x0, e.y0, e.x1, e.y1])).toEqual([[17, 5.5, 17, 8.5]]);
    // The bays are on the south kerb, beside the westbound lane: cars park facing west.
    expect(level.lanes.bays).toEqual([{ rect: [0, 4, 3, 5], heading: (3 * Math.PI) / 2 }]);
  });

  it('flags the edges onto a zebra or school crossing in both lanes, and a bus stop only in the lane beside it', () => {
    const rows = [
      'AAAAAAAAAAAA',
      '............',
      '##zz##bbb###',
      '##zz###k####',
      '##zz###k####',
      '...@........',
    ];
    const edges = laneEdges(ok(rows).level.lanes);
    const flagged = (flag: number, dir: 'e' | 'w'): number[] =>
      along(edges, dir)
        .filter((e) => (e.flags & flag) !== 0)
        .map((e) => Math.floor(e.x1 / TILE_M));
    // The `to` node of the flagged edge is on the site: the stop line is at its `from` node.
    expect(flagged(LANE_FLAG.ZEBRA, 'e')).toEqual([2, 3]);
    expect(flagged(LANE_FLAG.ZEBRA, 'w')).toEqual([3, 2]);
    // The school crossing covers only rows 3–4: the eastbound lane's half (rows 2–3) reaches row 3.
    expect(flagged(LANE_FLAG.SCHOOL_CROSSING, 'e')).toEqual([7]);
    expect(flagged(LANE_FLAG.SCHOOL_CROSSING, 'w')).toEqual([7]);
    // The bus stop on the north kerb row serves the eastbound lane only.
    expect(flagged(LANE_FLAG.BUS_STOP, 'e')).toEqual([6, 7, 8]);
    expect(flagged(LANE_FLAG.BUS_STOP, 'w')).toEqual([]);
  });
});

describe('junctions (LEVEL_DESIGN §7.4)', () => {
  /** A T-junction: the east–west road on rows 2–4 and a stem running south on columns 4–6 to the map edge. */
  const T = [
    'AAAAAAAAAAAAA',
    '.............',
    '#############',
    '#############',
    '#############',
    '....###....@.',
    '....###......',
    '....###......',
    '....###......',
    '....###......',
  ];

  it('joins every arriving lane to every leaving lane of the other arms, and the stem gives way', () => {
    const edges = laneEdges(ok(T).level.lanes);
    const junction = edges.filter((e) => (e.flags & LANE_FLAG.JUNCTION) !== 0);
    // Three arms with one lane in and one lane out each: 3 × 2 connectors, no U-turns.
    expect(junction).toHaveLength(6);
    const giveWay = junction.filter((e) => (e.flags & LANE_FLAG.GIVE_WAY) !== 0);
    // The stem's arriving lane is northbound on its west half (x = 4.75 tiles = 9.5 m), leaving row 5's centre.
    expect(giveWay.map((e) => [e.x0, e.y0])).toEqual([
      [9.5, 11],
      [9.5, 11],
    ]);
    for (const e of junction) expect(e.speed).toBe(SPEED.junctionMps);
  });

  it('lets level.json → junctions name the major sides', () => {
    const edges = laneEdges(ok(T, { junctions: [{ at: [6, 3], major: ['s', 'e'] }] }).level.lanes);
    const giveWay = edges.filter((e) => (e.flags & LANE_FLAG.GIVE_WAY) !== 0);
    // Now only the west arm gives way: its arriving lane is eastbound (y = 5.5 m) and ends in column 3 (7 m).
    expect(new Set(giveWay.map((e) => `${e.x0},${e.y0}`))).toEqual(new Set(['7,5.5']));
  });

  it('builds a clockwise ring for a mini-roundabout, entries giving way', () => {
    const rows = [
      'AAAA.###.AAAA',
      'AAAA.###.AAAA',
      'AAAA.###.AAAA',
      '.....###.....',
      '#############',
      '#############',
      '#############',
      '.....###...@.',
      'AAAA.###.AAAA',
      'AAAA.###.AAAA',
      'AAAA.###.AAAA',
    ];
    const plain = laneEdges(ok(rows).level.lanes);
    expect(plain.filter((e) => (e.flags & LANE_FLAG.ROUNDABOUT) !== 0)).toEqual([]);
    const { level } = ok(rows, { junctions: [{ at: [6, 5], roundabout: true }] });
    const edges = laneEdges(level.lanes);
    const ring = edges.filter((e) => e.flags === LANE_FLAG.ROUNDABOUT && (e.x0 !== e.x1 || e.y0 !== e.y1));
    const centre = [6.5 * TILE_M, 5.5 * TILE_M];
    // Clockwise on screen (y down): the cross product of the radius and the ring edge is positive.
    const ringOnly = ring.filter((e) => {
      const r0 = Math.hypot(e.x0 - (centre[0] ?? 0), e.y0 - (centre[1] ?? 0));
      const r1 = Math.hypot(e.x1 - (centre[0] ?? 0), e.y1 - (centre[1] ?? 0));
      return Math.abs(r0 - r1) < 1e-9 && r0 < 3;
    });
    expect(ringOnly).toHaveLength(8);
    for (const e of ringOnly) {
      const cross = (e.x0 - (centre[0] ?? 0)) * (e.y1 - e.y0) - (e.y0 - (centre[1] ?? 0)) * (e.x1 - e.x0);
      expect(cross).toBeGreaterThan(0);
    }
    const entries = edges.filter((e) => e.flags === (LANE_FLAG.ROUNDABOUT | LANE_FLAG.GIVE_WAY));
    expect(entries).toHaveLength(4);
    expect(edges.filter((e) => (e.flags & LANE_FLAG.JUNCTION) !== 0)).toEqual([]);
    for (const e of edges.filter((x) => (x.flags & LANE_FLAG.ROUNDABOUT) !== 0))
      expect(e.speed).toBe(SPEED.roundaboutMps);
  });

  it('gives a junction box on the map edge an arm of portal lanes for the road leaving the map', () => {
    // The side road (columns 5–7) crosses the main road, which runs along the south edge: the junction box
    // reaches the edge, so the side road leaves the map there as a south arm of portal lanes, northbound on
    // its west half (x = 5.75 tiles) and southbound on its east half (x = 7.25 tiles).
    const rows = [
      'AAAA.###.AAAA',
      'AAAA.###.AAAA',
      'AAAA.###.AAAA',
      '...@.###.....',
      '#############',
      '#############',
      '#############',
    ];
    const edges = laneEdges(ok(rows).level.lanes);
    const fromEdge = edges.filter((e) => (e.flags & LANE_FLAG.PORTAL_IN) !== 0 && e.y0 === 7 * TILE_M);
    const toEdge = edges.filter((e) => (e.flags & LANE_FLAG.PORTAL_OUT) !== 0 && e.y1 === 7 * TILE_M);
    expect(new Set(fromEdge.map((e) => e.x0))).toEqual(new Set([5.75 * TILE_M]));
    expect(new Set(toEdge.map((e) => e.x1))).toEqual(new Set([7.25 * TILE_M]));
    // Into the other three arms (west, north, east) and out of them.
    expect(fromEdge).toHaveLength(3);
    expect(toEdge).toHaveLength(3);
    for (const e of [...fromEdge, ...toEdge]) expect(e.flags & LANE_FLAG.JUNCTION).toBe(LANE_FLAG.JUNCTION);
  });

  it('rejects a junctions entry that is not on a junction or names nothing to do (L000)', () => {
    expect(messages(compile(T, { junctions: [{ at: [0, 3], major: ['e', 'w'] }] }))).toEqual([
      expect.stringMatching(/^t\.level\.json:\d+:3 L000 junctions\[0\]\.at \[0, 3\] is not on a junction/),
    ]);
    expect(messages(compile(T, { junctions: [{ at: [6, 3] }] }))).toEqual([
      expect.stringMatching(/L000 junctions\[0\] must set major or roundabout: true$/),
    ]);
    expect(messages(compile(T, { junctions: [{ at: [6, 3], major: ['n', 'n'] }] }))).toEqual([
      expect.stringMatching(/L000 junctions\[0\]\.major must list distinct sides from n, e, s, w$/),
    ]);
    expect(messages(compile(T, { junctions: [{ at: [6, 3], roundabout: true, colour: 'red' }] }))).toEqual([
      expect.stringMatching(/L000 junctions\[0\]\.colour is not a field \(at, major, roundabout\)$/),
    ]);
  });
});

describe('L011–L013', () => {
  it('L011: two-way traffic narrower than 3 tiles, an arrow across the road, an arrow against its neighbours', () => {
    expect(messages(compile(['AAAAAAAAAA', '##########', '##########', '.@........']))).toEqual([
      't.map.txt:2:1 L011 two-way traffic on a road 2 tile(s) wide; a two-way road needs at least 3 (use > < ^ v for a one-way street)',
    ]);
    expect(messages(compile(['AAAAAAAAAA', '>>>>^>>>>>', '>>>>>>>>>>', '.@........']))).toEqual([
      't.map.txt:2:5 L011 one-way arrow ^ points across this east–west road',
    ]);
    expect(messages(compile(['AAAAAAAAAA', '>>>>>>>>>>', '>>>>>><>>>', '.@........']))).toEqual([
      't.map.txt:3:7 L011 one-way arrow < points against its neighbours (>)',
    ]);
    // A road with no traffic (traffic: { none: true }, the Depot Yard) may be any width.
    expect(
      messages(compile(['AAAAAAAAAA', '##########', '.@........'], { traffic: { none: true } })),
    ).toEqual([]);
  });

  it('L012: a one-way dead end, head-on one-way streets, and a road network cut off from the portals', () => {
    expect(messages(compile(['AAAAAAAAAA', '>>>>>>>>>.', '.@........']))).toEqual([
      't.map.txt:2:1 L012 lane graph not strongly connected: a car here can never rejoin the rest of the road network (a one-way dead end, or arrows that trap it)',
    ]);
    // Two one-way streets that meet head-on at a bend: nothing leaves the junction.
    const headOn = [
      'AAAAAAAAAAAAAAAA',
      '>>>>>>>>>>>>###.',
      '>>>>>>>>>>>>###.',
      '............^^^.',
      '.@..........^^^.',
      '............^^^.',
      '............^^^.',
      '............^^^.',
      '............^^^.',
    ];
    expect(messages(compile(headOn))).toEqual([
      't.map.txt:2:1 L012 lane graph not strongly connected: a car here can never rejoin the rest of the road network (a one-way dead end, or arrows that trap it)',
      't.map.txt:4:13 L012 lane graph not strongly connected: a car here can never rejoin the rest of the road network (a one-way dead end, or arrows that trap it)',
    ]);
    // A two-way road inside the map (no portal) beside one that crosses it: the inner one is unreachable.
    const island = [
      'AAAAAAAAAAAA',
      '############',
      '############',
      '############',
      '.@..........',
      '.#########..',
      '.#########..',
      '.#########..',
    ];
    expect(messages(compile(island))).toEqual([
      't.map.txt:6:2 L012 lane graph not strongly connected: this road is cut off from the rest of the road network',
    ]);
  });

  it('L013: road tiles that carry no lane at all; a short stub beside a laned road is a lay-by, not an error', () => {
    expect(messages(compile(['AAAAAAAAAA', '>>>>>>>>>>', '.@........', '......#...']))).toEqual([
      't.map.txt:4:7 L013 road tile not connected to the lane graph',
    ]);
    // One report per group of road tiles, at its first tile: a 2×2 blob (runs of 2) carries no lane either.
    expect(messages(compile(['AAAAAAAAAA', '>>>>>>>>>>', '.@........', '........##', '........##']))).toEqual(
      ['t.map.txt:4:9 L013 road tile not connected to the lane graph'],
    );
    // A 2×3 stub on the side of the road (rows 3–4) is too short to carry traffic, and joins the road.
    const { level } = ok([
      'AAAAAAAAAA',
      '##########',
      '##########',
      '##########',
      '.@..###...',
      '....###...',
    ]);
    expect(level.lanes.nodeCount).toBe(2 * 10 + 4);
  });
});

/** A 3-tile road with a zebra (x = 3), a school crossing (x = 6), a dropped kerb (x = 9) and plain kerbs. */
const CROSSINGS = [
  'AAAAAAAAAAAA',
  '.........d..',
  '###z##k#####',
  '###z##k#####',
  '###z##k#####',
  '.@..........',
  'eeeeeeeeeeee',
];

describe('nav graph (TECHNICAL_DESIGN §11.1)', () => {
  it('crosses a road only at a zebra, a school crossing or a dropped kerb, with the matching flag', () => {
    const { level } = ok(CROSSINGS);
    const edges = navEdges(level.nav);
    const overRoad = edges.filter((e) => Math.abs(e.y1 - e.y0) > TILE_M || Math.abs(e.x1 - e.x0) > TILE_M);
    expect(overRoad.map((e) => [Math.floor(e.x0 / TILE_M), e.flags])).toEqual([
      [3, NAV_FLAG.ZEBRA],
      [6, NAV_FLAG.SCHOOL_CROSSING],
      [9, NAV_FLAG.DROPPED_KERB],
    ]);
    for (const e of overRoad) {
      expect(e.y0).toBe(1.5 * TILE_M);
      expect(e.y1).toBe(5.5 * TILE_M);
    }
    // Every other edge joins neighbouring walkable tiles and carries no crossing flag.
    for (const e of edges.filter((x) => !overRoad.includes(x))) expect(e.flags & NAV_FLAG_CROSSING).toBe(0);
  });

  it('has a node per walkable tile (pavement, cobbles, alley; not solid, skip or depot bay) and no corner cutting', () => {
    const rows = ['AA;;::..', 'AA;;::.s', 'e.....$.', '.@.%%,..'];
    const { level } = ok(rows);
    const tiles = new Set<string>();
    for (let n = 0; n < level.nav.nodeCount; n += 1)
      tiles.add(`${(level.nav.nodeX[n] ?? 0) / TILE_M - 0.5},${(level.nav.nodeY[n] ?? 0) / TILE_M - 0.5}`);
    expect(tiles.has('2,0')).toBe(true); // alley
    expect(tiles.has('4,1')).toBe(true); // cobbles
    expect(tiles.has('7,1')).toBe(false); // skip
    expect(tiles.has('6,2')).toBe(false); // depot bay
    expect(tiles.has('0,2')).toBe(false); // hedge
    expect(tiles.has('3,3')).toBe(false); // yard
    expect(tiles.has('5,3')).toBe(false); // grass
    expect(tiles.has('1,3')).toBe(true); // the start inherits pavement
    // The hedge at (0, 2) blocks the diagonal from (1, 2) to (0, 3); the open alley has its diagonals.
    const edges = navEdges(level.nav).map(
      (e) => `${e.x0 / TILE_M - 0.5},${e.y0 / TILE_M - 0.5}>${e.x1 / TILE_M - 0.5},${e.y1 / TILE_M - 0.5}`,
    );
    expect(edges).toContain('1,2>1,3');
    expect(edges).not.toContain('1,2>0,3');
    expect(edges).toContain('2,0>3,1');
    expect(edges).toContain('3,0>2,1');
  });

  it('tags map-edge portals, a door per frontage at the facade centre, and anchors on (or nearest to) their tile', () => {
    const rows = ['AAAAAAA...', '..1.....2.', '##########', '##########', '##########', '.@........'];
    const { level } = ok(rows, { anchors: { '1': 'doris_home', '2': 'shop_door' } });
    const tile = (n: number): string =>
      `${(level.nav.nodeX[n] ?? 0) / TILE_M - 0.5},${(level.nav.nodeY[n] ?? 0) / TILE_M - 0.5}`;
    // Every node of row 1 and row 5 is on the map edge at x = 0 or 9, or on row 0 (x = 7..9).
    expect([...level.nav.portals].map(tile)).toEqual([
      '7,0',
      '8,0',
      '9,0',
      '0,1',
      '9,1',
      '0,5',
      '1,5',
      '2,5',
      '3,5',
      '4,5',
      '5,5',
      '6,5',
      '7,5',
      '8,5',
      '9,5',
    ]);
    // Terrace A's south face (7 tiles, house width 3) splits 3 + 4: doors in front of x = 1 and x = 4. Its
    // east face looks onto the pavement at (7, 0).
    expect(level.frontages.map((f) => f.id)).toEqual(['fr_7_0', 'fr_0_1', 'fr_3_1']);
    expect(level.nav.doors.map((d) => [d.frontage, tile(d.node)])).toEqual([
      ['fr_7_0', '7,0'],
      ['fr_0_1', '1,1'],
      ['fr_3_1', '4,1'],
    ]);
    expect(level.nav.anchors.map((a) => [a.char, a.name, tile(a.node)])).toEqual([
      ['1', 'doris_home', '2,1'],
      ['2', 'shop_door', '8,1'],
    ]);
  });
});
