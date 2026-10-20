// Puddle Lane, the M1 street (SSP-042; LEVEL_DESIGN §5.1, §8.5, §12): the authored map.txt / level.json pair
// compiles with no diagnostics, keeps the §8.5 excerpt byte for byte, places the depot, skip, hydrants and
// anchors the later milestones rely on, and gives every raised-kerb cell a kerb blob autotile index. Since
// SSP-056 it also carries the M2 sweeping content (litter, grime, uses, pledges, power-up, collectibles), and
// since SSP-076 its lane and nav graphs.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TILE_M } from '../../src/sim/constants.ts';
import {
  AUTOTILE_COUNT,
  AUTOTILE_NONE,
  COLLIDE,
  decodeLevel,
  Ground,
  LANE_FLAG,
  LITTER_PLACE,
  NAV_FLAG,
} from '../../src/sim/map.ts';
import { compileLevel, readManifestIds } from '../../tools/levels/compile-level.ts';
import { computeStreets, frontageStreet } from '../../tools/levels/frontages.ts';
import { KERB_BLOB_PATH, readKerbBlob } from '../../tools/levels/kerbBlob.ts';
import { carriagewayMask, pathSteps, squareCover } from '../../tools/levels/layoutChecks.ts';
import { isRaisedKerbCell, isRoadCell } from '../../tools/levels/tileLayers.ts';
import { graphViolations, tileLayerViolations } from '../support/levelInvariants.ts';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel: string): string => readFileSync(join(REPO_ROOT, rel), 'utf8');

const MAP_TEXT = read('assets-src/levels/puddle_lane.map.txt');
const LEVEL_TEXT = read('assets-src/levels/puddle_lane.level.json');
const KNOWN = readManifestIds(join(REPO_ROOT, 'assets-src/manifest.json'));
const BLOB = readKerbBlob(join(REPO_ROOT, KERB_BLOB_PATH));
const W = 64;
const H = 48;
/** level.json → depot.rect, [x, y, w, h] in tiles (LEVEL_DESIGN §5.1). */
const DEPOT: readonly [number, number, number, number] = [0, 38, 14, 10];

function compile(mapText: string = MAP_TEXT) {
  return compileLevel({
    name: 'puddle_lane',
    mapText,
    levelText: LEVEL_TEXT,
    knownAssetIds: KNOWN,
    kerbBlob: BLOB,
  });
}

const RESULT = compile();
const OUT = (() => {
  if (RESULT.output === null) throw new Error('puddle_lane does not compile');
  return RESULT.output;
})();
const { level, map } = OUT;
const ROWS = MAP_TEXT.slice(0, -1).split('\n');

/** The first fenced block of LEVEL_DESIGN §8.5: the north-west 40×20 tiles of the map. */
function excerpt(): string[] {
  const doc = read('docs/LEVEL_DESIGN.md');
  const section = doc.slice(doc.indexOf('### 8.5 '));
  const block = /```\n([\s\S]*?)```/.exec(section)?.[1];
  if (block === undefined) throw new Error('no code block in LEVEL_DESIGN §8.5');
  return block.slice(0, -1).split('\n');
}

const tile = (x: number, y: number): number => y * W + x;

describe('puddle_lane compiles', () => {
  it('with no diagnostics at all, at 64×48', () => {
    expect(RESULT.diagnostics).toEqual([]);
    expect(level.id).toBe('district.puddle_lane');
    expect(level.size).toEqual([W, H]);
  });

  it('matches the committed public/assets/levels/puddle_lane.json byte for byte', () => {
    const committed = read('public/assets/levels/puddle_lane.json');
    expect(committed).toBe(OUT.text);
    const decoded = decodeLevel(committed);
    expect(decoded.music).toBe('mus.puddle_lane');
    expect(decoded.ambience).toBe('amb.town_morning');
    expect(decoded.weather).toBe('clear');
    expect(decoded.timerS).toBe(240);
  });

  it('is plain ASCII, LF, 48 rows of 64 characters and a final newline (LEVEL_DESIGN §8.2)', () => {
    expect(MAP_TEXT.endsWith('\n')).toBe(true);
    expect(MAP_TEXT).not.toMatch(/[^\x20-\x7e\n]/);
    expect(ROWS).toHaveLength(H);
    for (const row of ROWS) expect(row).toHaveLength(W);
    expect(MAP_TEXT).not.toMatch(/ \n/);
  });
});

describe('the LEVEL_DESIGN §8.5 excerpt', () => {
  it('is rows 0–19 × columns 0–39 of the map, byte for byte', () => {
    const want = excerpt();
    expect(want).toHaveLength(20);
    for (const row of want) expect(row).toHaveLength(40);
    expect(ROWS.slice(0, 20).map((row) => row.slice(0, 40))).toEqual(want);
  });

  it('keeps anchors 1–3 where §8.5 puts them and adds the dog walker loop 4–7 outside it', () => {
    const byName = Object.fromEntries(OUT.anchors.map((a) => [a.char, { name: a.name, tile: a.tile }]));
    expect(byName).toEqual({
      '1': { name: 'doris_home', tile: [4, 3] },
      '2': { name: 'zebra_puddle_s', tile: [17, 7] },
      '3': { name: 'corner_shop_door', tile: [21, 8] },
      '4': { name: 'pump_green_ne', tile: [40, 7] },
      '5': { name: 'pump_green_east_walk', tile: [40, 14] },
      '6': { name: 'pump_green_se', tile: [40, 20] },
      '7': { name: 'pump_green_sw', tile: [25, 20] },
    });
  });
});

describe('sites, props and the start (LEVEL_DESIGN §5.1, §7.7)', () => {
  const sites = (id: string) => level.sites.filter((s) => s.id === id).map((s) => s.rect);
  const props = (id: string) =>
    level.props.filter((p) => p.id === id).map((p) => [p.x / TILE_M - 0.5, p.y / TILE_M - 0.5]);

  it('has at least 2 depot bays of 2×3 tiles inside the depot rect', () => {
    const bays = sites('site.depot_bay');
    expect(bays.length).toBeGreaterThanOrEqual(2);
    const [dx, dy, dw, dh] = DEPOT;
    for (const [x0, y0, x1, y1] of bays) {
      expect([x1 - x0, y1 - y0]).toEqual([2, 3]);
      expect(x0 >= dx && y0 >= dy && x1 <= dx + dw && y1 <= dy + dh).toBe(true);
    }
  });

  it('has exactly 1 skip (2×1) and exactly 2 hydrants, at the §8.5 tiles', () => {
    const skips = sites('site.skip');
    expect(skips).toHaveLength(1);
    const [x0, y0, x1, y1] = skips[0] ?? [0, 0, 0, 0];
    expect([x1 - x0, y1 - y0]).toEqual([2, 1]);
    expect(props('prop.hydrant')).toEqual([
      [38, 3],
      [25, 7],
    ]);
  });

  it('has 3 speed-bump rows, and 2 zebras (Puddle Lane and Gutter Row)', () => {
    expect(sites('haz.speed_bump')).toHaveLength(3);
    expect(sites('site.zebra')).toEqual([
      [17, 4, 19, 7],
      [22, 11, 25, 13],
    ]);
  });

  it('starts Bessie inside depot.rect, facing north up Mangle Street', () => {
    const [dx, dy, dw, dh] = DEPOT;
    const tx = level.player.x / TILE_M;
    const ty = level.player.y / TILE_M;
    expect(tx > dx && tx < dx + dw && ty > dy && ty < dy + dh).toBe(true);
    expect(level.player.heading).toBe(0);
    // Straight ahead (north) of the start: depot apron, then the 3-tile Mangle Street (x 2–4) to row 21.
    const sx = Math.floor(tx);
    for (let y = Math.floor(ty); y >= 21; y -= 1) expect(map.drivable[tile(sx, y)], `(${sx}, ${y})`).toBe(1);
    for (let y = 21; y <= 38; y += 1) {
      for (let x = 2; x <= 4; x += 1) expect(map.ground[tile(x, y)], `(${x}, ${y})`).toBe(Ground.Road);
      expect(isRaisedKerbCell(map, tile(1, y)), `west kerb (1, ${y})`).toBe(true);
    }
  });

  it('has the depot shed as a 2-storey landmark and nothing taller than 3 storeys', () => {
    const depot = OUT.buildings.filter((b) => b.use === 'depot');
    expect(depot.map((b) => [b.letter, b.storeys, b.roof, b.wall])).toEqual([
      ['P', 2, 'roof.depot', 'facade.depot_shed'],
    ]);
    const [dx, dy, dw, dh] = DEPOT;
    const [x0, y0, x1, y1] = depot[0]?.bounds ?? [0, 0, 0, 0];
    expect(x0 >= dx && y0 >= dy && x1 <= dx + dw && y1 <= dy + dh).toBe(true);
    for (const b of OUT.buildings) expect(b.storeys, b.letter).toBeLessThanOrEqual(3);
    expect(OUT.buildings.filter((b) => b.storeys === 3).map((b) => b.letter)).toContain('C');
  });
});

describe('the Gutter Row alley, skip and Golden Crisp reservation (LEVEL_DESIGN §5.1)', () => {
  const crisp = tile(44, 30);
  const carriageway = carriagewayMask(map);

  it('reserves (44.5, 30.5) on drivable carriageway inside a 5×5 turning head', () => {
    expect(map.drivable[crisp]).toBe(1);
    expect(carriageway[crisp]).toBe(1);
    expect(squareCover(carriageway, W, H, 5)[crisp]).toBe(1);
  });

  it('puts the skip in the 2-tile alley between Gutter Row and the crisp, at least 40 m from the bays', () => {
    const skip = level.sites.find((s) => s.id === 'site.skip')?.rect ?? [0, 0, 0, 0];
    const fromGutterRow = pathSteps(map, [tile(24, 30), tile(24, 31)]);
    const skipSteps = fromGutterRow[tile(skip[0], skip[1])] ?? -1;
    expect(skipSteps).toBeGreaterThan(0);
    expect(fromGutterRow[crisp]).toBeGreaterThan(skipSteps);
    // The alley (rows 30–31) is 2 tiles of drivable setts.
    for (let x = 26; x < skip[0]; x += 1) {
      expect(map.ground[tile(x, 30)]).toBe(Ground.Alley);
      expect(map.drivable[tile(x, 30)]).toBe(1);
      expect(map.drivable[tile(x, 31)]).toBe(1);
    }
    const bays: number[] = [];
    for (let i = 0; i < W * H; i += 1) if (map.defs[i]?.site === 'site.depot_bay') bays.push(i);
    expect((pathSteps(map, bays)[tile(skip[0], skip[1])] ?? 0) * TILE_M).toBeGreaterThanOrEqual(40);
  });

  it('needs its turning head: without it the alley is an L014 dead end', () => {
    const rows = [...ROWS];
    for (const y of [28, 29, 32]) {
      const row = rows[y] ?? '';
      rows[y] = `${row.slice(0, 40)}RRRRR${row.slice(45)}`;
    }
    const broken = compile(`${rows.join('\n')}\n`);
    expect(broken.diagnostics.map((d) => d.code)).toContain('L014');
  });
});

describe('kerbs (LEVEL_DESIGN §7.2, ROADMAP M1 level-compile check)', () => {
  const { autotile, collide } = level.layers;
  const KERB = COLLIDE.KERB_EDGE_N | COLLIDE.KERB_EDGE_E | COLLIDE.KERB_EDGE_S | COLLIDE.KERB_EDGE_W;

  it('gives every raised-kerb boundary cell an autotile index in 0..46', () => {
    let boundary = 0;
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const i = tile(x, y);
        let roadNear = false;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const nx = x + dx;
            const ny = y + dy;
            if ((dx || dy) && nx >= 0 && ny >= 0 && nx < W && ny < H && isRoadCell(map, tile(nx, ny)))
              roadNear = true;
          }
        }
        const raisedEdge = !isRoadCell(map, i) && ((collide[i] ?? 0) & KERB) !== 0;
        if (raisedEdge) expect(isRaisedKerbCell(map, i), `(${x}, ${y})`).toBe(true);
        if (!(isRaisedKerbCell(map, i) && roadNear)) continue;
        boundary += 1;
        const a = autotile[i] ?? AUTOTILE_NONE;
        expect(a, `(${x}, ${y})`).toBeLessThan(AUTOTILE_COUNT);
      }
    }
    // ...and nothing else carries one: the boundary cells are exactly the cells with an index.
    expect(autotile.filter((a) => a !== AUTOTILE_NONE)).toHaveLength(boundary);
    expect(boundary).toBeGreaterThan(400);
    expect(tileLayerViolations(level, map, BLOB)).toEqual([]);
  });

  it('uses these kerb blob indices (the configurations the map contains)', () => {
    const used = [...new Set(autotile)].filter((a) => a !== AUTOTILE_NONE).sort((a, b) => a - b);
    expect(used).toEqual([4, 10, 12, 26, 31, 33, 34, 36, 41, 42, 44, 45]);
  });

  it('has at least three straight kerb runs of 15+ tiles, two of them along Mangle Street', () => {
    /** Longest run of consecutive raised-kerb cells carrying `bit`, along a row (dx) or a column (dy). */
    const run = (x0: number, y0: number, dx: number, dy: number, n: number, bit: number): number => {
      let best = 0;
      let cur = 0;
      for (let k = 0; k < n; k += 1) {
        const i = tile(x0 + dx * k, y0 + dy * k);
        cur = isRaisedKerbCell(map, i) && ((collide[i] ?? 0) & bit) !== 0 ? cur + 1 : 0;
        best = Math.max(best, cur);
      }
      return best;
    };
    const runs: number[] = [];
    for (let y = 0; y < H; y += 1) {
      runs.push(run(0, y, 1, 0, W, COLLIDE.KERB_EDGE_N), run(0, y, 1, 0, W, COLLIDE.KERB_EDGE_S));
    }
    for (let x = 0; x < W; x += 1) {
      runs.push(run(x, 0, 0, 1, H, COLLIDE.KERB_EDGE_E), run(x, 0, 0, 1, H, COLLIDE.KERB_EDGE_W));
    }
    expect(runs.filter((n) => n >= 15).length).toBeGreaterThanOrEqual(3);
    // Mangle Street's first 30 m from the depot gate (row 38) is a straight kerb on both sides.
    expect(run(1, 24, 0, 1, 15, COLLIDE.KERB_EDGE_E)).toBe(15);
    expect(run(5, 24, 0, 1, 15, COLLIDE.KERB_EDGE_W)).toBe(15);
  });
});

// SSP-056: Puddle Lane's M2 sweeping content (LEVEL_DESIGN §5.1): litter, grime, building uses, pledges,
// power-up and collectibles. The level must still compile with no diagnostics at all (above), so L030, L031,
// L040, L041, L050 and L051 pass.
describe('the M2 sweeping content (SSP-056, LEVEL_DESIGN §5.1)', () => {
  const doc = JSON.parse(LEVEL_TEXT) as {
    powerups?: { count: number; table: Record<string, number>; at?: unknown };
    collectibles?: {
      lostProperty: { id: string; at: [number, number] };
      goldenCrisp: { at: [number, number] };
    };
  };

  it('places 130 litter items from the documented table, 60% of the weight in the road gutter', () => {
    const litter = level.litter;
    if (litter === null) throw new Error('no litter field');
    expect(litter.initial).toBe(130);
    expect(litter.minSpacingM).toBe(0.5);
    expect(Object.fromEntries(litter.table.map((t) => [t.id, t.weight]))).toEqual({
      'litter.crisp_packet': 30,
      'litter.cigarette_butts': 20,
      'litter.drink_can': 15,
      'litter.plastic_bottle': 15,
      'litter.newspaper': 12,
      'litter.dog_mess': 8,
    });
    let total = 0;
    let gutter = 0;
    for (let i = 0; i < litter.weights.length; i += 1) {
      const wt = litter.weights[i] ?? 0;
      total += wt;
      if (((litter.places[i] ?? 0) & LITTER_PLACE.GUTTER) !== 0) gutter += wt;
    }
    // gutterBias 0.6, up to the Uint16 quantisation.
    expect(gutter / total).toBeCloseTo(0.6, 3);
  });

  it('selects exactly 9,000 grime cells, 15% (1,350) of them gutter grime', () => {
    expect(level.grime).toEqual({ cells: 9000, gutterCells: 1350, speckle: 0.03 });
  });

  it('makes the first 30 m of Mangle Street the densest grime, kerb to kerb', () => {
    const density = level.layers.grimeDensity;
    const dense = Math.round(0.85 * 255);
    for (let y = 24; y <= 38; y += 1) {
      for (let x = 1; x <= 5; x += 1) expect(density[tile(x, y)], `(${x}, ${y})`).toBe(dense);
    }
    for (const d of density) expect(d).toBeLessThanOrEqual(dense);
  });

  it('pledges exactly 8 generated frontages, at most 2 (a third) on any one street', () => {
    const pledged = level.frontages.filter((f) => f.pledge);
    expect(pledged).toHaveLength(8);
    // The generated count with the 1.0 widths (house 3, shop 4, corner shop 5, flats 4): see §5.1.
    expect(level.frontages).toHaveLength(122);
    const { street } = computeStreets(map);
    const perStreet = new Map<number, number>();
    for (const f of pledged) {
      const gutter = f.cells.map(([x, y]) => tile(x, y)).filter((i) => isRoadCell(map, i));
      const s = frontageStreet(street, gutter);
      expect(s, f.id).toBeGreaterThanOrEqual(0);
      perStreet.set(s, (perStreet.get(s) ?? 0) + 1);
    }
    for (const n of perStreet.values()) expect(n * 3).toBeLessThanOrEqual(pledged.length);
    expect(perStreet.size).toBeGreaterThanOrEqual(6);
  });

  it('gives the parade and the corner shop shop frontages, and every other street building houses', () => {
    const uses = Object.fromEntries(OUT.buildings.map((b) => [b.letter, b.use]));
    expect(uses.C).toBe('shop');
    expect(uses.D).toBe('shop');
    expect(uses.P).toBe('depot');
    const others = Object.entries(uses).filter(([letter]) => !['C', 'D', 'P'].includes(letter));
    for (const [letter, use] of others) expect(use, letter).toBe('house');
  });

  it('puts the skip within 150 m (path) of almost every route tile, so the first hopper warning is near it', () => {
    const skip = level.sites.filter((s) => s.id === 'site.skip').map((s) => tile(s.rect[0], s.rect[1]));
    const dist = pathSteps(map, [skip[0] ?? 0, (skip[0] ?? 0) + 1]);
    let route = 0;
    const over: number[] = [];
    for (let i = 0; i < W * H; i += 1) {
      if (level.layers.route[i] !== 1) continue;
      route += 1;
      if ((dist[i] ?? 0) * TILE_M > 150) over.push(i);
    }
    expect(over.length / route).toBeLessThan(0.01);
    // Only the north-east tip of Puddle Lane, the far end of the map from the skip, is over, by under 10 m.
    for (const i of over) {
      expect(i % W, `(${i % W}, ${Math.floor(i / W)})`).toBeGreaterThanOrEqual(58);
      expect(Math.floor(i / W)).toBeLessThanOrEqual(7);
      expect((dist[i] ?? 0) * TILE_M).toBeLessThan(160);
    }
  });

  it('has one flask of tea and places Lost Property and the Golden Crisp where §5.1 says', () => {
    // SSP-104 fixes the flask on the Pump Green path cross (pavement), off the kerb-hugging par route.
    expect(doc.powerups).toEqual({ count: 1, table: { 'pwr.flask_of_tea': 1 }, at: [[30.5, 11.5]] });
    expect(map.ground[tile(30, 11)]).toBe(Ground.Pavement);
    const lost = doc.collectibles?.lostProperty;
    expect(lost?.id).toBe('collect.false_teeth');
    const [lx, ly] = lost?.at ?? [0, 0];
    // On the Pump Green path (pavement), beside the bench.
    expect(map.ground[tile(Math.floor(lx), Math.floor(ly))]).toBe(Ground.Pavement);
    const bench = level.props.find((p) => p.id === 'prop.bench' && Math.abs(p.x / TILE_M - lx) <= 1.01);
    expect(bench, 'a bench within 1 tile').toBeDefined();
    expect(Math.abs((bench?.y ?? 0) / TILE_M - ly)).toBeLessThanOrEqual(1.01);
    expect(doc.collectibles?.goldenCrisp.at).toEqual([44.5, 30.5]);
  });
});

describe('the M3 lane and nav graphs (SSP-076)', () => {
  const decoded = decodeLevel(read('public/assets/levels/puddle_lane.json'));
  const tileOf = (x: number, y: number): string => `${Math.floor(x / TILE_M)},${Math.floor(y / TILE_M)}`;

  it('compiles non-empty graphs that pass L011–L013 and hold their invariants', () => {
    expect(RESULT.diagnostics).toEqual([]);
    expect(decoded.lanes.nodeCount).toBeGreaterThan(0);
    expect(decoded.lanes.edgeCount).toBeGreaterThan(0);
    expect(decoded.nav.nodeCount).toBeGreaterThan(0);
    expect(graphViolations(decoded, map)).toEqual([]);
  });

  it('lets traffic in and out only at the west end of Puddle Lane (its one map-edge road)', () => {
    const { lanes } = decoded;
    const ends: string[] = [];
    for (let e = 0; e < lanes.edgeCount; e += 1) {
      const flags = lanes.edgeFlags[e] ?? 0;
      if ((flags & (LANE_FLAG.PORTAL_IN | LANE_FLAG.PORTAL_OUT)) === 0) continue;
      const entry = (flags & LANE_FLAG.PORTAL_IN) !== 0;
      const node = (entry ? lanes.edgeFrom[e] : lanes.edgeTo[e]) ?? 0;
      ends.push(`${entry ? 'in' : 'out'} ${lanes.nodeX[node]},${lanes.nodeY[node]}`);
    }
    // Eastbound enters on the north half of rows 4–6 (y = 9.5 m), westbound leaves on the south half.
    expect(ends.sort()).toEqual(['in 0,9.5', 'out 0,12.5']);
  });

  it('stops both lanes at both zebras, and has the depot road turn round at the apron', () => {
    const { lanes } = decoded;
    const zebraTiles = new Set<string>();
    let turns = 0;
    for (let e = 0; e < lanes.edgeCount; e += 1) {
      const flags = lanes.edgeFlags[e] ?? 0;
      const to = lanes.edgeTo[e] ?? 0;
      if ((flags & LANE_FLAG.ZEBRA) !== 0) zebraTiles.add(tileOf(lanes.nodeX[to] ?? 0, lanes.nodeY[to] ?? 0));
      if ((flags & LANE_FLAG.U_TURN) !== 0) turns += 1;
    }
    // Puddle Lane's zebra (x = 17–18; the lane nodes are in rows 4 and 6) and Gutter Row's (rows 11–12).
    expect([...zebraTiles].sort()).toEqual([
      '17,4',
      '17,6',
      '18,4',
      '18,6',
      '22,11',
      '22,12',
      '24,11',
      '24,12',
    ]);
    expect(turns).toBe(1);
  });

  it('records the four bay runs with the heading of the lane beside them', () => {
    // SSP-104 shortened the first run to x 28–31, so no parked car stands in front of the Pump Green
    // entrance (x 32–33), the only way onto the Green, where the flask of tea and the Lost Property are.
    expect(decoded.lanes.bays).toEqual([
      { rect: [28, 6, 32, 7], heading: (3 * Math.PI) / 2 },
      { rect: [41, 6, 47, 7], heading: (3 * Math.PI) / 2 },
      { rect: [50, 11, 51, 17], heading: 0 },
      { rect: [52, 30, 53, 36], heading: Math.PI },
    ]);
  });

  it('crosses roads on foot at the two zebras and the two pairs of dropped kerbs only', () => {
    const { nav } = decoded;
    const crossings: string[] = [];
    for (let e = 0; e < nav.edgeCount; e += 1) {
      const flags = nav.edgeFlags[e] ?? 0;
      if (flags === 0) continue;
      const a = nav.edgeFrom[e] ?? 0;
      const b = nav.edgeTo[e] ?? 0;
      const ends = `${tileOf(nav.nodeX[a] ?? 0, nav.nodeY[a] ?? 0)}>${tileOf(nav.nodeX[b] ?? 0, nav.nodeY[b] ?? 0)}`;
      crossings.push(`${ends}:${flags}`);
    }
    const z = NAV_FLAG.ZEBRA;
    const d = NAV_FLAG.DROPPED_KERB;
    expect(crossings.sort()).toEqual(
      [
        `12,3>12,7:${d}`,
        `13,3>13,7:${d}`,
        `17,3>17,7:${z}`,
        `18,3>18,7:${z}`,
        `21,11>25,11:${z}`,
        `21,12>25,12:${z}`,
        `21,30>25,30:${d}`,
        `21,31>25,31:${d}`,
      ].sort(),
    );
  });

  it('tags anchors 1–7 on their own tiles and gives every frontage a door', () => {
    const { nav } = decoded;
    const at = (node: number): string => tileOf(nav.nodeX[node] ?? 0, nav.nodeY[node] ?? 0);
    expect(nav.anchors.map((a) => `${a.char} ${a.name} ${at(a.node)}`)).toEqual([
      '1 doris_home 4,3',
      '2 zebra_puddle_s 17,7',
      '3 corner_shop_door 21,8',
      '4 pump_green_ne 40,7',
      '5 pump_green_east_walk 40,14',
      '6 pump_green_se 40,20',
      '7 pump_green_sw 25,20',
    ]);
    expect(nav.doors.map((d) => d.frontage)).toEqual(decoded.frontages.map((f) => f.id));
  });
});
