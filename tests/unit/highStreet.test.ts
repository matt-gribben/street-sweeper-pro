// Muckleford High Street, Tuesday's grey-box district (SSP-105; LEVEL_DESIGN §5.2, §7, §12): the authored
// map.txt / level.json pair compiles with no diagnostics, matches the committed public/assets/levels/
// high_street.json, and keeps the §5.2 layout the M3 street life relies on (the 4-tile spine with its zebras
// and bus stops, Market Square's 12 pitches, the one-way Station Road loop with its loading bays, yards and
// skips, the ginnels, the north-edge depot, the heights and the lean rule) plus the §5.2 density, NPC and
// traffic numbers. The runtime side is covered by tests/replay/replays/m3_high_street.json.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TILE_M } from '../../src/sim/constants.ts';
import { COLLIDE, decodeLevel, Ground, LANE_FLAG, NAV_FLAG } from '../../src/sim/map.ts';
import { compileLevel, readManifestIds } from '../../tools/levels/compile-level.ts';
import { computeStreets, frontageStreet } from '../../tools/levels/frontages.ts';
import { KERB_BLOB_PATH, readKerbBlob } from '../../tools/levels/kerbBlob.ts';
import { pathSteps } from '../../tools/levels/layoutChecks.ts';
import { isRaisedKerbCell, isRoadCell } from '../../tools/levels/tileLayers.ts';
import { graphViolations, spawnLayerViolations, tileLayerViolations } from '../support/levelInvariants.ts';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel: string): string => readFileSync(join(REPO_ROOT, rel), 'utf8');

const MAP_TEXT = read('assets-src/levels/high_street.map.txt');
const LEVEL_TEXT = read('assets-src/levels/high_street.level.json');
const BLOB = readKerbBlob(join(REPO_ROOT, KERB_BLOB_PATH));
const W = 80;
const H = 60;
/** level.json → depot.rect, [x, y, w, h] in tiles. */
const DEPOT: readonly [number, number, number, number] = [32, 0, 16, 8];
/** The High Street carriageway, rows 26–29, the whole width of the map. */
const SPINE_ROWS = [26, 27, 28, 29] as const;

const RESULT = compileLevel({
  name: 'high_street',
  mapText: MAP_TEXT,
  levelText: LEVEL_TEXT,
  knownAssetIds: readManifestIds(join(REPO_ROOT, 'assets-src/manifest.json')),
  kerbBlob: BLOB,
});
const OUT = (() => {
  if (RESULT.output === null) throw new Error('high_street does not compile');
  return RESULT.output;
})();
const { level, map } = OUT;
const ROWS = MAP_TEXT.slice(0, -1).split('\n');
const tile = (x: number, y: number): number => y * W + x;
const char = (x: number, y: number): string => ROWS[y]?.[x] ?? ' ';
const sites = (id: string) => level.sites.filter((s) => s.id === id).map((s) => s.rect);
const propTiles = (id: string): [number, number][] =>
  level.props.filter((p) => p.id === id).map((p) => [Math.floor(p.x / TILE_M), Math.floor(p.y / TILE_M)]);
/** A cell the lane graph calls a junction: both its row run and its column run of road cells exceed 6 tiles. */
const isJunctionCell = (x: number, y: number): boolean => {
  if (!isRoadCell(map, tile(x, y))) return false;
  const run = (dx: number, dy: number): number => {
    let n = 1;
    for (const s of [1, -1]) {
      let k = 1;
      while (
        isRoadCell(map, tile(x + dx * s * k, y + dy * s * k)) &&
        x + dx * s * k >= 0 &&
        x + dx * s * k < W
      ) {
        n += 1;
        k += 1;
      }
    }
    return n;
  };
  return run(1, 0) > 6 && run(0, 1) > 6;
};

describe('high_street compiles', () => {
  it('with no diagnostics at all, at 80×60', () => {
    expect(RESULT.diagnostics).toEqual([]);
    expect(level.id).toBe('district.high_street');
    expect(level.size).toEqual([W, H]);
  });

  it('matches the committed public/assets/levels/high_street.json byte for byte, with its theme IDs', () => {
    const committed = read('public/assets/levels/high_street.json');
    expect(committed).toBe(OUT.text);
    const decoded = decodeLevel(committed);
    expect(decoded.music).toBe('mus.high_street');
    expect(decoded.ambience).toBe('amb.town_morning');
    expect(decoded.weather).toBe('clear');
    expect(decoded.timerS).toBe(240);
    expect(JSON.parse(LEVEL_TEXT).timeOfDay).toBe('late_morning');
  });

  it('is plain ASCII, LF, 60 rows of 80 characters and a final newline (LEVEL_DESIGN §8.2)', () => {
    expect(MAP_TEXT.endsWith('\n')).toBe(true);
    expect(MAP_TEXT).not.toMatch(/[^\x20-\x7e\n]/);
    expect(ROWS).toHaveLength(H);
    for (const row of ROWS) expect(row).toHaveLength(W);
  });

  it('holds the tile layer, spawn layer and graph invariants', () => {
    expect(tileLayerViolations(level, map, BLOB)).toEqual([]);
    expect(spawnLayerViolations(level, map)).toEqual([]);
    expect(graphViolations(level, map)).toEqual([]);
  });

  it('reports the §5.2 budgets: peak NPCs and vehicles within 80 and 30, 2 skips and 4 hydrants', () => {
    const r = OUT.report;
    expect(r.peakNpc).toBeLessThanOrEqual(80);
    expect(r.peakVehicles).toBeLessThanOrEqual(30);
    expect([r.depotBays, r.skips, r.hydrants]).toEqual([2, 2, 4]);
    expect(r.maxDumpM).toBeLessThanOrEqual(200);
    expect(r.maxWaterM).toBeLessThanOrEqual(150);
    expect(r.warnings).toEqual([]);
  });
});

describe('the High Street spine (LEVEL_DESIGN §5.2, §7.1, §7.5)', () => {
  it('is a 4-tile two-way main road across the whole map, between 2-tile pavements, 8 tiles facade to facade', () => {
    for (let x = 0; x < W; x += 1) {
      for (const y of SPINE_ROWS) expect(isRoadCell(map, tile(x, y)), `(${x}, ${y})`).toBe(true);
      for (const y of [24, 25, 30, 31]) {
        if (x >= 10 && x <= 12) continue; // the west leg crosses
        if (x >= 67 && x <= 69) continue; // the east leg crosses
        expect(map.building[tile(x, y)], `(${x}, ${y})`).toBe(-1);
      }
    }
    // Shopfront facing shopfront across the spine (rows 23 and 32): 8 tiles apart wherever both stand.
    let facing = 0;
    for (let x = 0; x < W; x += 1) {
      if (map.building[tile(x, 23)] !== -1 && map.building[tile(x, 32)] !== -1) facing += 1;
    }
    expect(facing).toBeGreaterThanOrEqual(40);
  });

  it('enters and leaves traffic only at its two ends', () => {
    const { lanes } = level;
    const ends: string[] = [];
    for (let e = 0; e < lanes.edgeCount; e += 1) {
      const flags = lanes.edgeFlags[e] ?? 0;
      if ((flags & (LANE_FLAG.PORTAL_IN | LANE_FLAG.PORTAL_OUT)) === 0) continue;
      const entry = (flags & LANE_FLAG.PORTAL_IN) !== 0;
      const node = (entry ? lanes.edgeFrom[e] : lanes.edgeTo[e]) ?? 0;
      ends.push(`${entry ? 'in' : 'out'} ${lanes.nodeX[node]},${lanes.nodeY[node]}`);
    }
    // Eastbound on the north half (y = 54 m) enters at the west edge; westbound on the south half leaves there.
    expect(ends.sort()).toEqual(['in 0,54', 'in 160,58', 'out 0,58', 'out 160,54']);
  });

  it('has two zebras across the full carriageway, at least 3 tiles from any junction', () => {
    const zebras = sites('site.zebra');
    expect(zebras).toEqual([
      [24, 26, 26, 30],
      [54, 26, 56, 30],
    ]);
    for (const [x0, , x1] of zebras) {
      for (let x = x0 - 3; x < x1 + 3; x += 1) {
        for (const y of SPINE_ROWS) expect(isJunctionCell(x, y), `(${x}, ${y})`).toBe(false);
      }
    }
  });

  it('has two 4-tile bus stops on the eastbound kerb, each with a shelter on the pavement behind it', () => {
    const stops = sites('site.bus_stop');
    expect(stops).toEqual([
      [18, 26, 22, 27],
      [58, 26, 62, 27],
    ]);
    const shelters = propTiles('prop.bus_shelter');
    for (const [x0, y0, x1] of stops) {
      expect(
        shelters.some(([sx, sy]) => sx >= x0 && sx < x1 && sy >= y0 - 2 && sy < y0),
        `shelter behind ${x0}`,
      ).toBe(true);
    }
  });

  it('runs the bus route along the High Street eastbound, past both stops', () => {
    const traffic = level.traffic;
    if (traffic === null) throw new Error('no traffic spec');
    expect(traffic.busEveryS).toBe(45);
    const ys = traffic.busRoute.map((n) => level.lanes.nodeY[n]);
    expect(ys).toEqual([54, 54]);
    const xs = traffic.busRoute.map((n) => level.lanes.nodeX[n] ?? 0);
    expect(xs[0]).toBeLessThan(44);
    expect(xs[1]).toBeGreaterThan(116);
  });
});

describe('Market Square (LEVEL_DESIGN §5.2, §7.6)', () => {
  const stalls = propTiles('prop.market_stall');

  it('is 20×14 tiles of cobbles hanging off the middle of the High Street', () => {
    for (let y = 32; y <= 45; y += 1) {
      for (let x = 30; x <= 49; x += 1) {
        const g = map.ground[tile(x, y)];
        expect([Ground.Cobbles, Ground.Pavement], `(${x}, ${y})`).toContain(g);
        expect(map.drivable[tile(x, y)], `(${x}, ${y})`).toBe(1);
      }
    }
  });

  it('has 12 stall pitches in two rows of 6 on cobbles, with drivable aisles of at least 3 tiles', () => {
    expect(stalls).toHaveLength(12);
    const rows = [...new Set(stalls.map(([, y]) => y))].sort((a, b) => a - b);
    expect(rows).toEqual([36, 41]);
    for (const r of rows) expect(stalls.filter(([, y]) => y === r)).toHaveLength(6);
    for (const [x, y] of stalls) expect(map.ground[tile(x, y)], `(${x}, ${y})`).toBe(Ground.Cobbles);
    // Between the rows (traders on row 37) and south of the second (traders on row 42): 3 clear rows each.
    for (const aisle of [
      [38, 39, 40],
      [43, 44, 45],
    ]) {
      for (const y of aisle) {
        for (let x = 30; x <= 49; x += 1) {
          if (char(x, y) === 'l' || char(x, y) === 'i' || /\d/.test(char(x, y))) continue;
          expect(
            stalls.some(([sx, sy]) => sx === x && sy === y),
            `(${x}, ${y})`,
          ).toBe(false);
        }
      }
    }
  });

  it('runs the market all shift and the market close at 180 s, 3 items per pitch over 20 s', () => {
    expect(level.schedules.map((e) => [e.type, e.atS])).toEqual([
      ['market', [0]],
      ['market_close', [180]],
    ]);
    const close = level.schedules[1];
    expect(close?.params.itemsPerPitch).toBe(3);
    expect(close?.params.buildS).toBe(20);
  });

  it('hides the lost wallet between two stalls and the Golden Crisp in the far bus box', () => {
    const doc = JSON.parse(LEVEL_TEXT) as {
      collectibles: {
        lostProperty: { id: string; at: [number, number] };
        goldenCrisp: { at: [number, number] };
      };
    };
    const { lostProperty, goldenCrisp } = doc.collectibles;
    expect(lostProperty.id).toBe('collect.lost_wallet');
    const [lx, ly] = lostProperty.at.map(Math.floor) as [number, number];
    const row = stalls.filter(([, y]) => y === ly).map(([x]) => x);
    expect(row.some((x) => x < lx) && row.some((x) => x > lx)).toBe(true);
    // The far stop is the second on the bus route (the eastbound buses reach it last).
    const [gx, gy] = goldenCrisp.at.map(Math.floor) as [number, number];
    const far = sites('site.bus_stop')[1] ?? [0, 0, 0, 0];
    expect(gx >= far[0] && gx < far[2] && gy >= far[1] && gy < far[3]).toBe(true);
  });
});

describe('Station Road, the yards and the ginnels (LEVEL_DESIGN §5.2, §7.3)', () => {
  it('is a one-way clockwise loop of 3-tile roads behind both rows of shops', () => {
    for (let x = 13; x <= 66; x += 1) {
      for (const y of [9, 10]) expect(char(x, y), `(${x}, ${y})`).toBe('>');
      for (const y of [47, 48]) expect(char(x, y), `(${x}, ${y})`).toBe('<');
    }
    for (let y = 12; y <= 45; y += 1) {
      if (y >= 26 && y <= 29) continue; // the High Street crossings
      for (let x = 10; x <= 12; x += 1) expect(char(x, y), `(${x}, ${y})`).toBe('^');
      for (let x = 67; x <= 69; x += 1) expect(char(x, y), `(${x}, ${y})`).toBe('v');
    }
  });

  it('has 40 loading-bay tiles (20 bays, 14 parked at 0.7) beside 2-tile pavements, 3+ tiles from junctions', () => {
    const traffic = level.traffic;
    if (traffic === null) throw new Error('no traffic spec');
    expect([traffic.parkedBays, traffic.parked]).toEqual([20, 14]);
    let bayTiles = 0;
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        if (char(x, y) !== 'p') continue;
        bayTiles += 1;
        expect(y === 11 || y === 46, `(${x}, ${y}) is on Station Road`).toBe(true);
        const behind = y === 11 ? [12, 13] : [45, 44];
        for (const by of behind) expect(map.ground[tile(x, by)], `(${x}, ${by})`).toBe(Ground.Pavement);
        for (let dx = -3; dx <= 3; dx += 1)
          expect(isJunctionCell(x + dx, y), `(${x + dx}, ${y})`).toBe(false);
      }
    }
    expect(bayTiles).toBe(40);
  });

  it('puts both skips in the service yards, at least 40 m by road from the depot bays', () => {
    const skips = sites('site.skip');
    expect(skips).toHaveLength(2);
    const bays: number[] = [];
    for (let i = 0; i < W * H; i += 1) if (map.defs[i]?.site === 'site.depot_bay') bays.push(i);
    const steps = pathSteps(map, bays);
    for (const [x0, y0, x1, y1] of skips) {
      expect([x1 - x0, y1 - y0]).toEqual([2, 1]);
      const near = [tile(x0, y0 - 1), tile(x0, y0 + 1)].filter((i) => map.ground[i] === Ground.Alley);
      expect(near.length, `yard beside the skip at ${x0}`).toBeGreaterThan(0);
      expect(Math.min(...near.map((i) => steps[i] ?? 0)) * TILE_M).toBeGreaterThanOrEqual(40);
    }
  });

  it('links the High Street to the yards through 2-tile drivable ginnels 25–35 m apart on the north side', () => {
    const ginnels: number[] = [];
    for (let x = 15; x <= 64; x += 1) {
      let open = true;
      for (let y = 17; y <= 23; y += 1) if (map.ground[tile(x, y)] !== Ground.Alley) open = false;
      if (open) ginnels.push(x);
    }
    expect(ginnels).toEqual([26, 27, 39, 40, 52, 53]);
    for (const x of ginnels) {
      for (let y = 17; y <= 23; y += 1) expect(map.drivable[tile(x, y)]).toBe(1);
      // Dropped kerbs carry the ginnel across both pavement rows, so the alley meets the road kerb-free.
      for (const y of [24, 25]) expect(char(x, y), `(${x}, ${y})`).toBe('d');
    }
    const starts = [12, 26.5, 39.5, 52.5, 67];
    for (let i = 1; i < starts.length; i += 1) {
      const gapM = ((starts[i] as number) - (starts[i - 1] as number)) * TILE_M;
      expect(gapM).toBeGreaterThanOrEqual(25);
      expect(gapM).toBeLessThanOrEqual(35);
    }
  });

  it('has at least three straight kerb runs of 15+ tiles', () => {
    const { collide } = level.layers;
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
    for (let y = 0; y < H; y += 1)
      runs.push(run(0, y, 1, 0, W, COLLIDE.KERB_EDGE_N), run(0, y, 1, 0, W, COLLIDE.KERB_EDGE_S));
    for (let x = 0; x < W; x += 1)
      runs.push(run(x, 0, 0, 1, H, COLLIDE.KERB_EDGE_E), run(x, 0, 0, 1, H, COLLIDE.KERB_EDGE_W));
    expect(runs.filter((n) => n >= 15).length).toBeGreaterThanOrEqual(3);
  });

  it('crosses the High Street on foot only at the two zebras and the dropped kerbs', () => {
    const { nav } = level;
    let zebra = 0;
    for (let e = 0; e < nav.edgeCount; e += 1) {
      const flags = nav.edgeFlags[e] ?? 0;
      if ((flags & NAV_FLAG.ZEBRA) !== 0) zebra += 1;
      else if (flags !== 0) expect(flags & NAV_FLAG.DROPPED_KERB).not.toBe(0);
    }
    // One crossing edge per tile of each 2-tile zebra.
    expect(zebra).toBe(4);
  });
});

describe('the depot, heights and lean (LEVEL_DESIGN §5.2, §7.7, §7.9)', () => {
  it('puts the depot on the north edge with 2 bays of 2×3 and Bessie facing the gate', () => {
    const [dx, dy, dw, dh] = DEPOT;
    expect(dy).toBe(0);
    const bays = sites('site.depot_bay');
    expect(bays).toHaveLength(2);
    for (const [x0, y0, x1, y1] of bays) {
      expect([x1 - x0, y1 - y0]).toEqual([2, 3]);
      expect(x0 >= dx && y0 >= dy && x1 <= dx + dw && y1 <= dy + dh).toBe(true);
    }
    expect(level.player.heading).toBeCloseTo(Math.PI, 10);
    const [px, py] = [Math.floor(level.player.x / TILE_M), Math.floor(level.player.y / TILE_M)];
    expect(px >= dx && px < dx + dw && py >= dy && py < dy + dh).toBe(true);
    // Straight south of the start: apron, the gate's dropped kerb on row 8, then Station Road.
    expect(char(px, 8)).toBe('d');
    expect(isRoadCell(map, tile(px, 9))).toBe(true);
    const depot = OUT.buildings.filter((b) => b.use === 'depot');
    expect(depot.map((b) => [b.letter, b.storeys, b.roof])).toEqual([['P', 2, 'roof.depot']]);
  });

  it('builds 4–5 storeys along the High Street and 3 on the side streets', () => {
    const spine = OUT.buildings.filter((b) => b.bounds[1] === 32 || b.bounds[3] === 24);
    for (const b of OUT.buildings) {
      if (b.use === 'depot') continue;
      // Inside Station Road's loop (x 13–66, rows 12–45): the High Street's shops.
      const inner = b.bounds[0] >= 13 && b.bounds[2] <= 67 && b.bounds[1] >= 12 && b.bounds[3] <= 46;
      if (inner) expect([4, 5], b.letter).toContain(b.storeys);
      else expect(b.storeys, b.letter).toBe(3);
    }
    expect(spine.filter((b) => b.storeys >= 4).length).toBeGreaterThanOrEqual(8);
  });

  it('keeps every frontage of a 4+ storey building at least 6 tiles from the facade opposite (the lean rule)', () => {
    const storeysAt = (i: number): number => {
      const b = map.building[i] ?? -1;
      return b < 0 ? 0 : (OUT.buildings[b]?.storeys ?? 0);
    };
    const step = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] } as const;
    for (const f of level.frontages) {
      const [dx, dy] = step[f.face];
      // The facade cell behind the zone's first walk tile.
      const [cx, cy] = f.cells[0] as [number, number];
      let x = cx - dx;
      let y = cy - dy;
      while (map.building[tile(x, y)] === -1) {
        x -= dx;
        y -= dy;
      }
      const own = storeysAt(tile(x, y));
      let gap = 0;
      let ox = x + dx;
      let oy = y + dy;
      while (ox >= 0 && oy >= 0 && ox < W && oy < H && map.building[tile(ox, oy)] === -1) {
        gap += 1;
        ox += dx;
        oy += dy;
      }
      const opposite = ox >= 0 && oy >= 0 && ox < W && oy < H ? storeysAt(tile(ox, oy)) : 0;
      if (Math.max(own, opposite) >= 4) expect(gap, `${f.id} (${f.face})`).toBeGreaterThanOrEqual(6);
    }
  });
});

describe('the M3 content (LEVEL_DESIGN §5.2)', () => {
  it('places 200 litter items from the §5.2 table and exactly 11,000 grime cells, 16% in the gutter', () => {
    const litter = level.litter;
    if (litter === null) throw new Error('no litter field');
    expect(litter.initial).toBe(200);
    expect(Object.fromEntries(litter.table.map((t) => [t.id, t.weight]))).toEqual({
      'litter.banana_skin': 8,
      'litter.bin_bag': 4,
      'litter.chip_wrapper': 10,
      'litter.cigarette_butts': 18,
      'litter.crisp_packet': 20,
      'litter.drink_can': 12,
      'litter.glass_bottle': 6,
      'litter.newspaper': 8,
      'litter.pizza_box': 4,
      'litter.plastic_bottle': 10,
    });
    expect(level.grime).toEqual({ cells: 11000, gutterCells: 1760, speckle: 0.03 });
  });

  it('pledges 12 of its 70 frontages, at most 4 (a third) on any one street', () => {
    expect(level.frontages).toHaveLength(70);
    const pledged = level.frontages.filter((f) => f.pledge);
    expect(pledged).toHaveLength(12);
    const { street } = computeStreets(map);
    const perStreet = new Map<number, number>();
    for (const f of pledged) {
      const gutter = f.cells.map(([x, y]) => tile(x, y)).filter((i) => isRoadCell(map, i));
      const s = frontageStreet(street, gutter);
      if (s >= 0) perStreet.set(s, (perStreet.get(s) ?? 0) + 1);
    }
    for (const n of perStreet.values()) expect(n).toBeLessThanOrEqual(4);
  });

  it('spawns the §5.2 cast: shoppers, businessmen, litterbugs, the old man, Doris and two pigeon flocks', () => {
    const npc = level.npc;
    if (npc === null) throw new Error('no npc spec');
    expect(Object.fromEntries(npc.caps.map((c) => [c.id, c.cap]))).toEqual({
      'npc.businessman': 5,
      'npc.litterbug': 5,
      'npc.old_man_frame': 1,
      'npc.shopper': 26,
    });
    expect(npc.population.map((p) => p.target)).toEqual([27, 29, 37, 29]);
    expect(npc.named.map((n) => n.id)).toEqual(['npc.old_woman']);
    expect(npc.flocks.map((f) => [f.id, f.count, f.size])).toEqual([
      ['npc.pigeon', 1, [6, 10]],
      ['npc.pigeon', 1, [6, 10]],
    ]);
  });

  it('runs 9 ambient vehicles (taxis, bicycles and cars) plus the scheduled buses', () => {
    const traffic = level.traffic;
    if (traffic === null) throw new Error('no traffic spec');
    expect(traffic.moving).toBe(9);
    expect(traffic.mix.map((m) => m.id)).toEqual([
      'veh.bicycle',
      'veh.hatchback',
      'veh.saloon',
      'veh.taxi',
      'veh.van_white',
    ]);
  });
});
