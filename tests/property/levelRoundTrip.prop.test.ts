// Level compiler round trip (TECHNICAL_DESIGN §18.2; SSP-033): random legal ASCII maps compile without
// diagnostics, the compiled text decodes and re-encodes byte-identically, and compiling twice gives the same
// bytes. Maps are legal by construction (below), so every run exercises the compiler rather than being
// filtered out. Fixed seed so a failure always reproduces. SSP-034: the derived tile layers (collide, kerb
// blob autotile, markings, merged solids) hold their invariants on every map; the layout checks
// (L014–L022), which random rows of props cannot satisfy, are skipped here and covered by fixtures.
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { decodeLevel, encodeLevel } from '../../src/sim/map.ts';
import { compileLevel, DEFAULT_LEGEND, formatDiagnostic } from '../../tools/levels/compile-level.ts';
import { KERB_BLOB_PATH, readKerbBlob } from '../../tools/levels/kerbBlob.ts';
import { tileLayerViolations } from '../support/levelInvariants.ts';

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
/** Row 1: pavement with kerbside props, dropped kerbs and anchors. */
const KERB = ['.', '.', '.', 'l', 'h', 'n', 'i', 'q', '!', 'g', 'd', 'f', '1', '2'];
/** Rows 2–3: a two-row carriageway (every road tile has a road neighbour, so L013 never fires). */
const ROAD = ['#', '#', '#', '>', '<', '^', 'v', 'z', 'k', 'b', 'p', '='];
/** Interior: drivable grounds (plus the level's own `*`), props, sites and anchors. */
const INTERIOR = ['.', ':', '%', ',', '+', '*', 'l', 't', 'n', 'm', 'u', 's', '$', '3'];
/**
 * Interior blockers, placed only on (odd x, odd y) cells: no two are 8-adjacent, so they can never cut the
 * 4-connected drivable area apart (L010), and none is plain ground, so every inherited ground is drivable.
 */
const BLOCKERS = ['w', 'e', 'r', 'D', 'E', 'D'];

type Spec = {
  w: number;
  h: number;
  picks: number[];
  start: [number, number];
  depot: [number, number, number, number];
  waterEdge: boolean;
  heading: number;
  skipRun: boolean;
  storeys: number[];
  landmark: boolean[];
  audio: boolean;
};

const specArb: fc.Arbitrary<Spec> = fc
  .record({ w: fc.integer({ min: 3, max: 24 }), h: fc.integer({ min: 6, max: 20 }) })
  .chain(({ w, h }) =>
    fc
      .record({
        picks: fc.array(fc.nat({ max: 1 << 16 }), { minLength: w * h, maxLength: w * h }),
        sx: fc.integer({ min: 0, max: w - 1 }),
        sy: fc.integer({ min: 4, max: h - 2 }),
        pad: fc.tuple(fc.nat({ max: 3 }), fc.nat({ max: 3 }), fc.nat({ max: 3 }), fc.nat({ max: 3 })),
        waterEdge: fc.boolean(),
        heading: fc.integer({ min: 0, max: 31 }),
        skipRun: fc.boolean(),
        storeys: fc.array(fc.integer({ min: 1, max: 8 }), { minLength: 5, maxLength: 5 }),
        landmark: fc.array(fc.boolean(), { minLength: 5, maxLength: 5 }),
        audio: fc.boolean(),
      })
      .map(({ picks, sx, sy, pad, waterEdge, heading, skipRun, storeys, landmark, audio }): Spec => {
        const x0 = Math.max(0, sx - pad[0]);
        const y0 = Math.max(0, sy - pad[1]);
        const x1 = Math.min(w, sx + 1 + pad[2]);
        const y1 = Math.min(h, sy + 1 + pad[3]);
        return {
          w,
          h,
          picks,
          start: [sx, sy],
          depot: [x0, y0, x1 - x0, y1 - y0],
          waterEdge,
          heading,
          skipRun,
          storeys,
          landmark,
          audio,
        };
      }),
  );

function pick(set: readonly string[], n: number): string {
  return set[n % set.length] ?? '.';
}

/** Build the map rows and level.json text for a spec. */
function build(spec: Spec): { rows: string[]; levelText: string } {
  const { w, h } = spec;
  const rows: string[] = [];
  for (let y = 0; y < h; y += 1) {
    let row = '';
    for (let x = 0; x < w; x += 1) {
      const n = spec.picks[y * w + x] ?? 0;
      let c: string;
      if (x === spec.start[0] && y === spec.start[1]) c = '@';
      else if (y === 0) c = pick(STRIP, n);
      else if (y === 1) c = pick(KERB, n);
      else if (y <= 3) c = pick(ROAD, n);
      else if (y === h - 1 && spec.waterEdge) c = '~';
      // A pavement row above the water, so no prop, site or start inherits water from it.
      else if (y === h - 2 && spec.waterEdge) c = '.';
      else if (x % 2 === 1 && y % 2 === 1 && n % 3 === 0) c = pick(BLOCKERS, n >> 2);
      else c = pick(INTERIOR, n);
      row += c;
    }
    rows.push(row);
  }
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
  };
  return { rows, levelText: `${JSON.stringify(level, null, 2)}\n` };
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
        expect(decoded.music === undefined).toBe(!spec.audio);
      }),
      { seed: SEED, numRuns: RUNS },
    );
  });
});
