// Level compiler round trip (TECHNICAL_DESIGN §18.2; SSP-033): random legal ASCII maps compile without
// diagnostics, the compiled text decodes and re-encodes byte-identically, and compiling twice gives the same
// bytes. Maps are legal by construction (below), so every run exercises the compiler rather than being
// filtered out. Fixed seed so a failure always reproduces. SSP-034: the derived tile layers (collide, kerb
// blob autotile, markings, merged solids) hold their invariants on every map; the layout checks
// (L014–L022), which random rows of props cannot satisfy, are skipped here and covered by fixtures. SSP-054:
// half the maps carry litter and grime specs, and the spawn layers hold their invariants on every map.
// SSP-076: the maps carry a legal road network (a 3-tile road across the map, two-way or one-way, and often a
// 3-tile side road that dead-ends or leaves the map), so the lane checks L011–L013 stay on; the lane and nav
// graphs round-trip with everything else and hold their invariants on every map. SSP-077: the maps with spawn
// specs also carry npcs, traffic, hazards, knockables and events, which round-trip, and the hazard candidate
// tiles keep off the LEVEL_DESIGN §9.3 exclusions on every map.
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { decodeLevel, encodeLevel, HAZARD_RULE_ALL_BITS } from '../../src/sim/map.ts';
import { compileLevel, DEFAULT_LEGEND, formatDiagnostic } from '../../tools/levels/compile-level.ts';
import { KERB_BLOB_PATH, readKerbBlob } from '../../tools/levels/kerbBlob.ts';
import { graphViolations, spawnLayerViolations, tileLayerViolations } from '../support/levelInvariants.ts';

const KERB_BLOB = readKerbBlob(join(fileURLToPath(new URL('../../', import.meta.url)), KERB_BLOB_PATH));

const SEED = 0x55_03_3a;
const RUNS = 300;

const KNOWN = new Set([
  'roof.slate',
  'roof.felt',
  'roof.depot',
  'facade.terrace_brick',
  'facade.corner_shop',
]);
const ROOFS = ['roof.slate', 'roof.felt', 'roof.depot'];
const WALLS = ['facade.terrace_brick', 'facade.corner_shop'];
const LETTERS = ['A', 'B', 'C', 'D', 'E'];

/** Row 0: a building strip with gaps. */
const STRIP = ['A', 'A', 'B', 'C', '.', ','];
/**
 * Rows 1 and 5: pavement with kerbside props, dropped kerbs and anchors, on odd columns only (even columns are
 * plain pavement). A prop then always has two pavement neighbours against one road, so it inherits pavement
 * (LEVEL_DESIGN §8.3): a prop that inherited road would stretch the carriageway into a shape that is not a
 * legal road (a 1–2 tile spur, L011).
 */
const KERB = ['.', '.', '.', 'l', 'h', 'n', 'i', 'q', '!', 'g', 'd', 'f', '1', '2'];
/**
 * Rows 2–4: a 3-tile carriageway from the west edge to the east edge, so every map has a legal lane graph.
 * `#` is replaced by the road's arrow on a one-way map; the road features stay (they take the road's flow).
 * Props beside it may inherit its ground and widen it, which is still legal.
 */
const ROAD = ['#', '#', '#', '#', 'z', 'k', 'b', 'p', '='];
/** The flows a road can have: two-way, or one of the arrows (east–west road, north–south side road). */
const MAIN_FLOWS = ['#', '>', '<'];
const SIDE_FLOWS = ['#', 'v', '^'];
/** Interior: drivable grounds (plus the level's own `*`), props, sites and anchors. */
const INTERIOR = ['.', ':', '%', ',', '+', '*', 'l', 't', 'n', 'm', 'u', 's', '$', '3'];
/**
 * Interior blockers, placed only on (odd x, odd y) cells: no two are 8-adjacent, so they can never cut the
 * 4-connected drivable area apart (L010), and none is plain ground, so every inherited ground is drivable.
 */
const BLOCKERS = ['w', 'e', 'r', 'D', 'E', 'D'];

/**
 * A 3-tile side road on columns x..x+2 from row 5 down to row `end`: two-way, or one-way only when it reaches
 * the south edge (a one-way dead end traps its traffic, L012).
 */
type SideRoad = { x: number; end: number; flow: string };

type Spec = {
  w: number;
  h: number;
  picks: number[];
  mainFlow: string;
  side: SideRoad | null;
  start: [number, number];
  depot: [number, number, number, number];
  waterEdge: boolean;
  heading: number;
  skipRun: boolean;
  storeys: number[];
  landmark: boolean[];
  audio: boolean;
  spawns: boolean;
  /** 0..100: scales the grime cell count, the gutter share, the litter bias and the hotspot radius. */
  dial: number;
};

const specArb: fc.Arbitrary<Spec> = fc
  .record({ w: fc.integer({ min: 7, max: 24 }), h: fc.integer({ min: 8, max: 20 }) })
  .chain(({ w, h }) =>
    fc
      .record({
        picks: fc.array(fc.nat({ max: 1 << 16 }), { minLength: w * h, maxLength: w * h }),
        sx: fc.integer({ min: 0, max: w - 1 }),
        sy: fc.integer({ min: 6, max: h - 2 }),
        mainFlow: fc.constantFrom(...MAIN_FLOWS),
        side: fc.option(
          fc.record({
            x: fc.integer({ min: 0, max: w - 3 }),
            end: fc.integer({ min: 5, max: h - 1 }),
            flow: fc.constantFrom(...SIDE_FLOWS),
          }),
        ),
        pad: fc.tuple(fc.nat({ max: 3 }), fc.nat({ max: 3 }), fc.nat({ max: 3 }), fc.nat({ max: 3 })),
        waterEdge: fc.boolean(),
        heading: fc.integer({ min: 0, max: 31 }),
        skipRun: fc.boolean(),
        storeys: fc.array(fc.integer({ min: 1, max: 8 }), { minLength: 5, maxLength: 5 }),
        landmark: fc.array(fc.boolean(), { minLength: 5, maxLength: 5 }),
        audio: fc.boolean(),
        spawns: fc.boolean(),
        dial: fc.integer({ min: 0, max: 100 }),
      })
      .map(
        ({
          picks,
          sx,
          sy,
          mainFlow,
          side,
          pad,
          waterEdge,
          heading,
          skipRun,
          storeys,
          landmark,
          audio,
          spawns,
          dial,
        }): Spec => {
          const x0 = Math.max(0, sx - pad[0]);
          const y0 = Math.max(0, sy - pad[1]);
          const x1 = Math.min(w, sx + 1 + pad[2]);
          const y1 = Math.min(h, sy + 1 + pad[3]);
          return {
            w,
            h,
            picks,
            mainFlow,
            side: legalSide(side, sx, sy, h, waterEdge),
            start: [sx, sy],
            depot: [x0, y0, x1 - x0, y1 - y0],
            waterEdge,
            heading,
            skipRun,
            storeys,
            landmark,
            audio,
            spawns,
            dial,
          };
        },
      ),
  );

/**
 * The side road made legal: it stops above the water edge, is two-way unless it reaches the south edge, and is
 * dropped when the start would stand on it.
 */
function legalSide(
  side: SideRoad | null,
  sx: number,
  sy: number,
  h: number,
  waterEdge: boolean,
): SideRoad | null {
  if (side === null) return null;
  const end = waterEdge ? Math.min(side.end, h - 3) : side.end;
  if (end < 5) return null;
  const flow = end === h - 1 ? side.flow : '#';
  if (sx >= side.x && sx <= side.x + 2 && sy >= 5 && sy <= end) return null;
  return { x: side.x, end, flow };
}

function pick(set: readonly string[], n: number): string {
  return set[n % set.length] ?? '.';
}

/** Build the map rows and level.json text for a spec. */
function build(spec: Spec): { rows: string[]; levelText: string } {
  const rows = build0(spec);
  return { rows, levelText: levelTextOf(spec, rows) };
}

/** The map rows of a spec. */
function build0(spec: Spec): string[] {
  const { w, h } = spec;
  const rows: string[] = [];
  for (let y = 0; y < h; y += 1) {
    let row = '';
    for (let x = 0; x < w; x += 1) {
      const n = spec.picks[y * w + x] ?? 0;
      let c: string;
      const side = spec.side;
      const onSide = side !== null && y >= 5 && y <= side.end && x >= side.x && x <= side.x + 2;
      // Plain pavement beside and below the side road, so no prop inherits its ground and stretches it.
      const besideSide =
        side !== null &&
        ((y >= 5 && y <= side.end + 1 && (x === side.x - 1 || x === side.x + 3)) ||
          (y === side.end + 1 && x >= side.x - 1 && x <= side.x + 3));
      if (x === spec.start[0] && y === spec.start[1]) c = '@';
      else if (onSide) c = side.flow;
      else if (besideSide) c = '.';
      else if (y === 0) c = pick(STRIP, n);
      else if (y === 1 || y === 5) c = x % 2 === 1 ? pick(KERB, n) : '.';
      else if (y <= 4) {
        c = pick(ROAD, n);
        if (c === '#') c = spec.mainFlow;
      } else if (y === h - 1 && spec.waterEdge) c = '~';
      // A pavement row above the water, so no prop, site or start inherits water from it.
      else if (y === h - 2 && spec.waterEdge) c = '.';
      else if (x % 2 === 1 && y % 2 === 1 && n % 3 === 0) c = pick(BLOCKERS, n >> 2);
      else c = pick(INTERIOR, n);
      row += c;
    }
    rows.push(row);
  }
  return rows;
}

/** The level.json text of a spec and its rows. */
function levelTextOf(spec: Spec, rows: readonly string[]): string {
  const { w, h } = spec;
  const used = new Set(rows.join(''));
  const buildings: Record<string, unknown> = {};
  LETTERS.forEach((letter, i) => {
    if (!used.has(letter)) return;
    const landmark = spec.landmark[i] === true;
    const storeys = landmark ? (spec.storeys[i] ?? 1) : Math.min(spec.storeys[i] ?? 1, 6);
    buildings[letter] = {
      storeys,
      roof: ROOFS[i % ROOFS.length],
      wall: WALLS[i % WALLS.length],
      use: 'house',
      ...(landmark ? { landmark: true } : {}),
    };
  });
  const anchors: Record<string, string> = {};
  for (const digit of ['1', '2', '3']) if (used.has(digit)) anchors[digit] = `anchor_${digit}`;
  const level = {
    schema: 1,
    id: 'district.random',
    name: 'Random Row',
    day: 'any',
    mode: spec.skipRun ? 'skip_run' : 'shift',
    map: 'random.map.txt',
    size: [w, h],
    timer: spec.skipRun ? 45 : 240,
    seed: 1,
    timeOfDay: 'morning',
    weather: spec.skipRun ? 'inherit' : 'rain',
    ...(spec.audio ? { music: 'mus.random_row', ambience: 'amb.town_morning' } : {}),
    start: { heading: spec.heading },
    depot: { rect: spec.depot },
    legend: { '*': { ground: 'cobbles' } },
    buildings,
    anchors,
    ...(spec.spawns ? spawnSpecs(spec) : {}),
  };
  return `${JSON.stringify(level, null, 2)}\n`;
}

/**
 * Litter and grime specs that every legal map can satisfy: row 1 always holds at least 3 pavement tiles of
 * OPEN grime cells, so up to 64 cells with no gutter quota never trips L051.
 */
function spawnSpecs(spec: Spec): Record<string, unknown> {
  const d = spec.dial / 100;
  const used = new Set(build0(spec).join(''));
  const t = spec.skipRun ? 45 : 240;
  return {
    // SSP-077: specs every legal map can satisfy. Doris walks from anchor 1 back to it (one nav node); the
    // cats perch on the road (every map has lanes); the knockable stands on row 1's plain pavement at x 0.
    npcs: {
      population: [
        { from: 0, to: t / 2, target: Math.round(d * 20) },
        { from: t / 2, to: t, target: Math.round(d * 30) },
      ],
      mix: { 'npc.shopper': 3, 'npc.dog_walker': 1 },
      caps: { 'npc.dog_walker': 1 },
      ...(used.has('1')
        ? { named: [{ id: 'npc.old_woman', anchor: '1', spawnAt: t / 3, route: ['1'] }] }
        : {}),
      perches: { id: 'npc.cat', count: 1 + Math.round(d * 3), on: ['road'] },
    },
    traffic: {
      densityPerKm: Math.round(d * 100) / 10,
      mix: { 'veh.hatchback': 2, 'veh.saloon': 1 },
      parkedFill: d,
      parkedMix: { 'veh.hatchback_parked': 1 },
      pavement: { 'veh.mobility_scooter': 1 },
    },
    hazards: { place: [], random: [] },
    knockables: [{ id: 'prop.wheelie_bin', at: [0.5, 1.5] }],
    events: [
      { type: 'dawn', at: 0, durationS: 20 },
      { type: 'population_wave', at: t / 4, untilS: t / 2, npc: 'npc.shopper', delta: 2 },
      { type: 'tutorial_beat', trigger: 'shift_start', text: 'Morning, rookie.' },
    ],
    litter: {
      initial: Math.round(d * 50),
      table: { 'litter.crisp_packet': 3, 'litter.dog_mess': 1, 'litter.leaf_pile': 1 },
      gutterBias: d,
      hotspots: [
        { near: 'prop.litter_bin', radius: 0.5 + 3 * d, mult: 2 },
        { near: 'site.skip', radius: 1, mult: 1.5 },
      ],
    },
    grime: {
      cells: Math.round(d * 64),
      gutterShare: 0,
      zones: [
        { rect: [0, 0, spec.w, 2], density: d },
        { near: 'prop.lamp_post', radius: 2, density: 1 - d },
      ],
      speckle: d / 10,
    },
  };
}

describe('level compiler round trip (TECHNICAL_DESIGN §18.2)', () => {
  it('random legal maps compile, decode and re-encode byte-identically', () => {
    fc.assert(
      fc.property(specArb, (spec) => {
        const { rows, levelText } = build(spec);
        const input = {
          name: 'random',
          mapText: rows.map((r) => `${r}\n`).join(''),
          levelText,
          knownAssetIds: KNOWN,
          kerbBlob: KERB_BLOB,
          skipCodes: ['L014', 'L015', 'L020', 'L021', 'L022'] as const,
        };
        const result = compileLevel(input);
        expect(result.diagnostics.map(formatDiagnostic)).toEqual([]);
        const output = result.output;
        if (output === null) throw new Error('no output');
        const decoded = decodeLevel(output.text);
        expect(encodeLevel(decoded)).toBe(output.text);
        expect(compileLevel(input).output?.text).toBe(output.text);

        // Light structural checks on the decoded level.
        const { layers } = decoded;
        expect(decoded.size).toEqual([spec.w, spec.h]);
        let props = 0;
        for (let i = 0; i < spec.w * spec.h; i += 1) {
          const c = rows[Math.floor(i / spec.w)]?.[i % spec.w] ?? ' ';
          if (DEFAULT_LEGEND[c]?.prop !== undefined) props += 1;
          expect((layers.storeys[i] ?? 0) > 0).toBe(c >= 'A' && c <= 'Z');
          if (layers.route[i] === 1) expect(output.map.drivable[i]).toBe(1);
        }
        expect(decoded.props).toHaveLength(props);
        expect(tileLayerViolations(decoded, output.map, KERB_BLOB)).toEqual([]);
        expect(spawnLayerViolations(decoded, output.map)).toEqual([]);
        expect(graphViolations(decoded, output.map)).toEqual([]);
        expect(decoded.lanes.nodeCount).toBeGreaterThan(0);
        expect(decoded.nav.nodeCount).toBeGreaterThan(0);
        expect(decoded.litter === null).toBe(!spec.spawns);
        expect(decoded.grime === null).toBe(!spec.spawns);
        expect(decoded.music === undefined).toBe(!spec.audio);
        // SSP-077: the M3 specs compile on every map that carries them, and the hazard candidates keep off
        // the §9.3 exclusions (3 tiles round @, zebras, school crossings, depot bays, skips, hydrants, bays).
        for (const kind of [decoded.npc, decoded.traffic, decoded.hazards, decoded.knockables])
          expect(kind === null).toBe(!spec.spawns);
        expect(decoded.schedules).toHaveLength(spec.spawns ? 3 : 0);
        const candidates = decoded.hazards?.candidates;
        if (candidates !== undefined) {
          const [sx, sy] = spec.start;
          for (let i = 0; i < spec.w * spec.h; i += 1) {
            const b = candidates[i] ?? 0;
            expect(b & ~HAZARD_RULE_ALL_BITS).toBe(0);
            if (b === 0) continue;
            const x = i % spec.w;
            const y = Math.floor(i / spec.w);
            expect(Math.max(Math.abs(x - sx), Math.abs(y - sy))).toBeGreaterThan(3);
            expect('zkp$sh='.includes(rows[y]?.[x] ?? ' ')).toBe(false);
            expect(output.map.drivable[i]).toBe(1);
            for (let dy = -1; dy <= 1; dy += 1)
              for (let dx = -1; dx <= 1; dx += 1) expect(rows[y + dy]?.[x + dx] === 'h').toBe(false);
          }
        }
      }),
      { seed: SEED, numRuns: RUNS },
    );
  });
});
