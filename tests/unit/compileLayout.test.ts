// SSP-034: the kerb blob table, the derived tile layers (autotile, collide, markings, merged solids) and the
// layout checks L014, L015 and L020–L022 of the level compiler (LEVEL_DESIGN §7, §10.3; TECHNICAL_DESIGN
// §9.1, §15). The failing fixture per code and its exact message are in compileLevel.test.ts.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { AUTOTILE_COUNT, AUTOTILE_NONE, COLLIDE, MARKING, mergeSolids } from '../../src/sim/map.ts';
import {
  type CompileResult,
  compileLevel,
  formatDiagnostic,
  readManifestIds,
} from '../../tools/levels/compile-level.ts';
import {
  BLOB_DIRS,
  KERB_BLOB_PATH,
  parseKerbBlob,
  readKerbBlob,
  reduceBlobMask,
} from '../../tools/levels/kerbBlob.ts';
import { carriagewayMask, findDeadEnds, squareCover } from '../../tools/levels/layoutChecks.ts';
import { rasterise, tileLayerViolations } from '../support/levelInvariants.ts';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const FIXTURES = 'tests/fixtures/levels';
const MANIFEST = `${FIXTURES}/manifest.json`;
const KNOWN = readManifestIds(join(REPO_ROOT, MANIFEST));
const BLOB = readKerbBlob(join(REPO_ROOT, KERB_BLOB_PATH));
const BLOB_JSON: unknown = JSON.parse(readFileSync(join(REPO_ROOT, KERB_BLOB_PATH), 'utf8'));

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const BUILDINGS = {
  A: { storeys: 2, roof: 'roof.slate', wall: 'facade.terrace_brick', use: 'house' },
  B: { storeys: 2, roof: 'roof.felt', wall: 'facade.corner_shop', use: 'shop' },
};

/** Compile an inline map with every check on; `depot` defaults to the whole map. */
function compile(rows: readonly string[], extra: Record<string, unknown> = {}): CompileResult {
  const w = rows[0]?.length ?? 0;
  const level = {
    schema: 1,
    id: 'district.t',
    name: 'Test',
    day: 'mon',
    mode: 'shift',
    map: 't.map.txt',
    size: [w, rows.length],
    timer: 240,
    seed: 1,
    timeOfDay: 'morning',
    weather: 'clear',
    start: { heading: 0 },
    depot: { rect: [0, 0, w, rows.length] },
    buildings: BUILDINGS,
    ...extra,
  };
  return compileLevel({
    name: 't',
    mapText: rows.map((r) => `${r}\n`).join(''),
    levelText: `${JSON.stringify(level)}\n`,
    knownAssetIds: KNOWN,
    kerbBlob: BLOB,
  });
}

/** Compile with the layout checks off (for maps that only exercise the tile layers). */
function compileLayers(rows: readonly string[]): NonNullable<CompileResult['output']> {
  const w = rows[0]?.length ?? 0;
  const level = {
    schema: 1,
    id: 'district.t',
    name: 'Test',
    day: 'mon',
    mode: 'shift',
    map: 't.map.txt',
    size: [w, rows.length],
    timer: 240,
    seed: 1,
    timeOfDay: 'morning',
    weather: 'clear',
    start: { heading: 0 },
    depot: { rect: [0, 0, w, rows.length] },
    buildings: BUILDINGS,
  };
  const result = compileLevel({
    name: 't',
    mapText: rows.map((r) => `${r}\n`).join(''),
    levelText: `${JSON.stringify(level)}\n`,
    knownAssetIds: KNOWN,
    kerbBlob: BLOB,
    skipCodes: ['L014', 'L015', 'L020', 'L021', 'L022'],
  });
  return ok(result);
}

function messages(result: CompileResult): string[] {
  return result.diagnostics.map(formatDiagnostic);
}

function ok(result: CompileResult): NonNullable<CompileResult['output']> {
  expect(messages(result)).toEqual([]);
  if (result.output === null) throw new Error('expected a compiled level');
  return result.output;
}

function fixture(name: string): CompileResult {
  const dir = join(REPO_ROOT, FIXTURES, name);
  return compileLevel({
    name,
    mapText: readFileSync(join(dir, `${name}.map.txt`), 'utf8'),
    levelText: readFileSync(join(dir, `${name}.level.json`), 'utf8'),
    knownAssetIds: KNOWN,
    kerbBlob: BLOB,
  });
}

/** The fixtures' base street (24 × 11): road, two pavements, a hydrant and a depot apron with two bays. */
const BASE = [
  'AAAAAAAAAAAAAAAAAAAAAAAA',
  '....h...................',
  '########################',
  '########################',
  '########################',
  '.....dddddd.............',
  'BBBBB++++++BBBBBBBBBBBBB',
  'BBBBB+$$+$$BBBBBBBBBBBBB',
  'BBBBB+$$+$$BBBBBBBBBBBBB',
  'BBBBB++@+++BBBBBBBBBBBBB',
  'BBBBB++++++BBBBBBBBBBBBB',
];
const BASE_DEPOT = { depot: { rect: [5, 6, 6, 5] } };

/** The base map 14 rows tall, with `cells` ([x, y, char]) painted on. */
function tallBase(cells: readonly [number, number, string][] = []): string[] {
  const rows = [...BASE, 'B'.repeat(24), 'B'.repeat(24), 'B'.repeat(24)];
  return paint(rows, cells);
}

function paint(rows: readonly string[], cells: readonly [number, number, string][]): string[] {
  const out = [...rows];
  for (const [x, y, c] of cells) {
    const r = out[y] ?? '';
    out[y] = r.slice(0, x) + c + r.slice(x + 1);
  }
  return out;
}

/** Cells of a rectangle [x0, x1) × [y0, y1) all set to `c`. */
function rect(x0: number, y0: number, x1: number, y1: number, c: string): [number, number, string][] {
  const out: [number, number, string][] = [];
  for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) out.push([x, y, c]);
  return out;
}

describe('the kerb blob table (assets-src/procedural/tiles/kerb_blob.json)', () => {
  it('has 47 distinct, already-reduced masks, ascending', () => {
    expect(BLOB.masks).toHaveLength(AUTOTILE_COUNT);
    expect(new Set(BLOB.masks).size).toBe(47);
    for (const m of BLOB.masks) expect(reduceBlobMask(m, BLOB.bits)).toBe(m);
    expect([...BLOB.masks].sort((a, b) => a - b)).toEqual(BLOB.masks);
    expect(BLOB.masks[0]).toBe(0);
    expect(BLOB.masks[46]).toBe(255);
  });

  it('reduces every one of the 256 raw masks to one of its entries', () => {
    for (let raw = 0; raw < 256; raw += 1) {
      const index = BLOB.indexOfRaw[raw] ?? -1;
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(47);
      expect(BLOB.masks[index]).toBe(reduceBlobMask(raw, BLOB.bits));
    }
    // Every entry is reached by some raw mask (it is its own reduction).
    expect(new Set(BLOB.indexOfRaw).size).toBe(47);
  });

  it('counts a corner bit only when both adjacent edge bits are set', () => {
    const { n, ne, e, se, s, sw, w, nw } = BLOB.bits;
    expect(reduceBlobMask(ne, BLOB.bits)).toBe(0);
    expect(reduceBlobMask(n | ne, BLOB.bits)).toBe(n);
    expect(reduceBlobMask(n | ne | e, BLOB.bits)).toBe(n | ne | e);
    expect(reduceBlobMask(255 & ~s, BLOB.bits)).toBe(n | ne | e | w | nw);
    expect(reduceBlobMask(se | sw | s, BLOB.bits)).toBe(s);
    expect(BLOB_DIRS.map((d) => BLOB.bits[d])).toEqual([1, 2, 4, 8, 16, 32, 64, 128]);
  });

  it('rejects a table with the wrong count, a repeat, an unreduced mask or bad bits', () => {
    const doc = BLOB_JSON as { params: { blob_masks: number[]; mask_bits: Record<string, number> } };
    const withMasks = (masks: number[]): unknown => ({
      ...doc,
      params: { ...doc.params, blob_masks: masks },
    });
    const masks = doc.params.blob_masks;
    expect(() => parseKerbBlob(withMasks(masks.slice(1)))).toThrow(/46 entries; the kerb blob has 47/);
    expect(() => parseKerbBlob(withMasks([...masks.slice(0, 46), 0]))).toThrow(/repeats entry 0/);
    expect(() => parseKerbBlob(withMasks([2, ...masks.slice(1)]))).toThrow(/= 2 is not reduced/);
    const badBits = { ...doc, params: { ...doc.params, mask_bits: { ...doc.params.mask_bits, ne: 1 } } };
    expect(() => parseKerbBlob(badBits)).toThrow(/mask_bits\.(n|ne) repeats bit 1/);
    expect(() => parseKerbBlob({})).toThrow(/expected an object with "params"/);
  });

  it('exists once: no TypeScript or Python source repeats the table', () => {
    const needle = BLOB.masks.slice(0, 12).join(', ');
    const hits: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(join(REPO_ROOT, dir))) {
        const rel = `${dir}/${name}`;
        if (name === 'node_modules' || name === '.venv' || name.startsWith('.')) continue;
        if (statSync(join(REPO_ROOT, rel)).isDirectory()) walk(rel);
        else if (/\.(ts|py)$/.test(name) && readFileSync(join(REPO_ROOT, rel), 'utf8').includes(needle))
          hits.push(rel);
      }
    };
    for (const dir of ['src', 'tools']) walk(dir);
    expect(hits).toEqual([]);
    expect(readFileSync(join(REPO_ROOT, KERB_BLOB_PATH), 'utf8')).toContain(needle);
  });
});

describe('kerb blob autotile and kerb edges (the kerbs fixture)', () => {
  // kerbs.map.txt (16 × 10):
  //   0  AAAAAAAAAAAAAAAA
  //   1  .....d..........   north pavement, a dropped kerb at x = 5
  //   2  ################   a 2-wide road off both map edges
  //   3  ################
  //   4  ...##.....++++++   a 2-wide road end going south at x = 3–4; an apron flush with the road
  //   5  ...##.....+$$+$$
  //   6  ...##.....+$$+$$
  //   7  ..........++@+++   the pavement round the road end
  //   8  BBBBBBBBBB++++++
  //   9  BBBBBBBBBB++++++
  const out = (): NonNullable<CompileResult['output']> => ok(fixture('kerbs'));
  const W = 16;
  const tile = (x: number, y: number): number => out().level.layers.autotile[y * W + x] ?? -1;
  const collide = (x: number, y: number): number => out().level.layers.collide[y * W + x] ?? -1;
  /** The blob index of a hand-written mask: listed bits are the neighbours that are NOT road. */
  const idx = (...notRoad: (keyof typeof BLOB.bits)[]): number =>
    BLOB.masks.indexOf(notRoad.reduce((m, d) => m | BLOB.bits[d], 0));
  const { KERB_EDGE_N: N, KERB_EDGE_E: E, KERB_EDGE_S: S, KERB_EDGE_W: Wb } = COLLIDE;

  it('matches hand-computed indices for straight kerbs, outer and inner corners and a road end', () => {
    // Straight kerbs: road to the south (north pavement), north (row 4) and east/west (beside the road end).
    expect(tile(1, 1)).toBe(idx('n', 'ne', 'e', 'w', 'nw'));
    expect(tile(1, 1)).toBe(36);
    expect(tile(0, 4)).toBe(idx('e', 'se', 's', 'sw', 'w'));
    expect(tile(0, 4)).toBe(31);
    expect(tile(2, 5)).toBe(idx('n', 's', 'sw', 'w', 'nw'));
    expect(tile(2, 5)).toBe(42);
    expect(tile(5, 5)).toBe(idx('n', 'ne', 'e', 'se', 's'));
    expect(tile(5, 5)).toBe(12);
    // Outer corners (the pavement's convex corner where the road end leaves the main road).
    expect(tile(2, 4)).toBe(idx('s', 'sw', 'w'));
    expect(tile(2, 4)).toBe(26);
    expect(tile(5, 4)).toBe(idx('e', 'se', 's'));
    expect(tile(5, 4)).toBe(10);
    // The road end: a straight kerb across it and inner corners (road only diagonally) either side.
    expect(tile(3, 7)).toBe(31);
    expect(tile(4, 7)).toBe(31);
    expect(tile(2, 7)).toBe(idx('n', 'e', 'se', 's', 'sw', 'w', 'nw'));
    expect(tile(2, 7)).toBe(45);
    expect(tile(5, 7)).toBe(idx('n', 'ne', 'e', 'se', 's', 'sw', 'w'));
    expect(tile(5, 7)).toBe(33);
    // A road cell, an apron cell, a building cell and a pavement cell with no road neighbour: none.
    for (const [x, y] of [
      [3, 2],
      [10, 4],
      [0, 8],
      [0, 0],
    ] as const) {
      expect(tile(x, y)).toBe(AUTOTILE_NONE);
    }
  });

  it('gives a dropped kerb no kerb edge or tile, and its neighbours a plain straight kerb', () => {
    expect(tile(5, 1)).toBe(AUTOTILE_NONE);
    expect(collide(5, 1)).toBe(0);
    expect(collide(5, 2) & N).toBe(0);
    expect(tile(4, 1)).toBe(36);
    expect(tile(6, 1)).toBe(36);
  });

  it('puts the matching bit on both sides of a raised kerb edge', () => {
    expect(collide(1, 1)).toBe(S);
    expect(collide(1, 2)).toBe(N);
    expect(collide(2, 4)).toBe(N | E);
    expect(collide(3, 4)).toBe(Wb);
    expect(collide(3, 6)).toBe(S | Wb);
    expect(collide(4, 6)).toBe(S | E);
    expect(collide(3, 7)).toBe(N);
    // The apron meets the road flush: no kerb either side.
    expect(collide(10, 4)).toBe(0);
    expect(collide(10, 3)).toBe(0);
  });

  it('holds every tile-layer invariant, and the solids are exactly the SOLID cells', () => {
    const { level, map } = out();
    expect(tileLayerViolations(level, map, BLOB)).toEqual([]);
    expect(level.solids).toEqual([
      [0, 0, 16, 1],
      [0, 8, 10, 10],
    ]);
  });

  it('compiles byte-identically twice through the CLI', () => {
    const hashes: string[] = [];
    for (let run = 0; run < 2; run += 1) {
      const dir = mkdtempSync(join(tmpdir(), 'ssp-compile-layout-'));
      tempDirs.push(dir);
      const r = spawnSync(
        process.execPath,
        ['tools/levels/compile-level.ts', '--src', `${FIXTURES}/kerbs`, '--manifest', MANIFEST, '--out', dir],
        { cwd: REPO_ROOT, encoding: 'utf8' },
      );
      expect(r.status, r.stderr).toBe(0);
      const file = readFileSync(join(dir, 'public/assets/levels/kerbs.json'));
      hashes.push(createHash('sha256').update(file).digest('hex'));
    }
    expect(hashes[0]).toBe(hashes[1]);
  });
});

describe('merged solids', () => {
  it('cover exactly the SOLID cells of every compiling fixture, with no overlap and no gaps', () => {
    for (const name of ['valid', 'no_audio', 'kerbs']) {
      const { level } = ok(fixture(name));
      const [w, h] = level.size;
      const cover = rasterise(level.solids, w, h);
      for (let i = 0; i < w * h; i += 1) {
        expect(cover[i], `${name} tile ${i}`).toBe(
          ((level.layers.collide[i] ?? 0) & COLLIDE.SOLID) !== 0 ? 1 : 0,
        );
      }
      expect(level.solids).toEqual(mergeSolids(level.layers.collide, w, h));
    }
  });

  it('marks buildings, walls, hedges, railings, water, sand, void and footways SOLID, but not props', () => {
    // Row 0: building, wall, hedge, railing, water, sand, void, then a footway; row 1: props on pavement.
    const rows = ['Awer~_ ;.', '@lhnt!iqg', '.........'];
    const { level } = compileLayers(rows);
    const solid = (x: number, y: number): boolean =>
      ((level.layers.collide[y * 9 + x] ?? 0) & COLLIDE.SOLID) !== 0;
    for (let x = 0; x < 8; x += 1) expect(solid(x, 0), `x ${x}`).toBe(true);
    expect(solid(8, 0)).toBe(false);
    for (let x = 0; x < 9; x += 1) expect(solid(x, 1), `x ${x}`).toBe(false);
    expect(level.solids).toEqual([[0, 0, 8, 1]]);
  });
});

describe('road markings (MARKING, TECHNICAL_DESIGN §15.2)', () => {
  const rows = [
    '......................',
    '##########p######z####',
    '#################z####',
    '#################z####',
    '......####............',
    '......####............',
    '......####............',
    '......####............',
    '......####............',
    '@.....####............',
  ];
  const { level, map } = compileLayers(rows);
  const m = (x: number, y: number): number => level.layers.markings[y * 22 + x] ?? -1;
  const { PARKING_BAY, DOUBLE_YELLOW, CENTRE_EW, CENTRE_E_EDGE } = MARKING;

  it('puts a centre line through the middle of an odd-width two-way road and none in the junction box', () => {
    for (const x of [0, 5, 10, 16, 18, 21]) expect(m(x, 2), `x ${x}`).toBe(CENTRE_EW);
    for (const x of [6, 7, 8, 9]) expect(m(x, 2), `x ${x}`).toBe(0);
  });

  it('puts an even-width road centre line on the east edge of the cell west of it', () => {
    for (let y = 4; y < 10; y += 1) {
      expect(m(6, y)).toBe(DOUBLE_YELLOW);
      expect(m(7, y)).toBe(CENTRE_E_EDGE);
      expect(m(8, y)).toBe(0);
      expect(m(9, y)).toBe(DOUBLE_YELLOW);
    }
  });

  it('paints double yellows along raised kerbs, but not on bays, zebras or open junction mouths', () => {
    expect(m(0, 1)).toBe(DOUBLE_YELLOW);
    expect(m(10, 1)).toBe(PARKING_BAY);
    for (let y = 1; y < 4; y += 1) expect(m(17, y)).toBe(0);
    expect(m(0, 3)).toBe(DOUBLE_YELLOW);
    expect(m(7, 3)).toBe(0);
    expect(m(7, 1)).toBe(DOUBLE_YELLOW);
    expect(tileLayerViolations(level, map, BLOB)).toEqual([]);
  });

  it('gives one-way roads no centre line', () => {
    const oneWay = compileLayers(['......', '>>>>>>', '>>>>>>', '>>>>>>', '@.....']);
    expect([...oneWay.level.layers.markings.subarray(12, 18)]).toEqual([0, 0, 0, 0, 0, 0]);
    expect([...oneWay.level.layers.markings.subarray(6, 12)]).toEqual(Array(6).fill(DOUBLE_YELLOW));
  });
});

describe('L014 dead ends', () => {
  it('measures a cul-de-sac in tiles from the road it leaves, whatever the road widths', () => {
    for (const roadW of [2, 3, 4, 5]) {
      for (const stubW of [2, 3]) {
        for (const depth of [5, 9]) {
          const w = 30;
          const h = 1 + roadW + depth + 1;
          const mask = new Uint8Array(w * h);
          for (let y = 1; y < 1 + roadW; y += 1) mask.fill(1, y * w, y * w + w);
          for (let y = 1 + roadW; y < 1 + roadW + depth; y += 1) mask.fill(1, y * w + 10, y * w + 10 + stubW);
          const found = findDeadEnds(mask, w, h);
          if (depth === 5) expect(found, `road ${roadW} stub ${stubW}`).toEqual([]);
          else {
            expect(found, `road ${roadW} stub ${stubW}`).toHaveLength(1);
            // Within a tile of the true depth (Zhang–Suen puts even-width centre lines off-centre).
            expect(Math.abs((found[0]?.tiles ?? 0) - depth)).toBeLessThanOrEqual(1);
          }
        }
      }
    }
  });

  it('passes a cul-de-sac with a 5×5 turning head, a short one, and roads that run off the map', () => {
    const headed = tallBase([...rect(15, 5, 18, 8, '#'), ...rect(14, 8, 19, 13, '#')]);
    expect(messages(compile(headed, BASE_DEPOT))).toEqual([]);
    const short = tallBase(rect(15, 5, 18, 11, '#'));
    expect(messages(compile(short, BASE_DEPOT))).toEqual([]);
    const throughRoad = tallBase(rect(15, 5, 18, 14, '#'));
    expect(messages(compile(throughRoad, BASE_DEPOT))).toEqual([]);
  });

  it('fails the same cul-de-sac without its head', () => {
    const rows = tallBase(rect(15, 5, 18, 13, '#'));
    expect(messages(compile(rows, BASE_DEPOT))).toEqual([
      't.map.txt:13:17 L014 dead end of 8 tiles without a 5×5 turning head (max 6)',
    ]);
  });

  it('treats pavement and grass as kerbed (not carriageway), and dropped kerbs and aprons as carriageway', () => {
    const rows = ['.#d+,', '.###.'];
    const { map } = compileLayers([...rows, '@....']);
    expect([...carriagewayMask(map).subarray(0, 10)]).toEqual([0, 1, 1, 1, 0, 0, 1, 1, 1, 0]);
    const square = new Uint8Array(36).fill(1);
    expect([...squareCover(square, 6, 6, 5)].every((v) => v === 1)).toBe(true);
    square[0] = 0;
    expect(squareCover(square, 6, 6, 5)[0]).toBe(0);
    expect(squareCover(square, 6, 6, 5)[35]).toBe(1);
  });
});

describe('L015 footway mouths', () => {
  const footway = rect(15, 6, 16, 13, ';');

  it('passes a footway with a bollard in front of its mouth, or one closed by buildings', () => {
    expect(messages(compile(tallBase([...footway, [15, 5, '!']]), BASE_DEPOT))).toEqual([]);
    expect(messages(compile(tallBase([...footway, [15, 6, 'B']]), BASE_DEPOT))).toEqual([]);
  });

  it('fails an open mouth, and a footway running beside a pavement is open all along', () => {
    expect(messages(compile(tallBase(footway), BASE_DEPOT))).toEqual([
      't.map.txt:7:16 L015 1-tile alley mouth Bessie can enter: put a bollard (!) in it or close it with buildings',
    ]);
    // A footway along the north pavement (row 0 becomes alley): every cell touches the pavement.
    const rows = paint(BASE, rect(0, 0, 3, 1, ';'));
    expect(messages(compile(rows, BASE_DEPOT)).filter((l) => l.includes('L015'))).toHaveLength(3);
  });
});

describe('L020 depot bays, skips and dump distance', () => {
  it('fails a skip within 40 m (path) of a depot bay, except in the Skip Run', () => {
    const rows = paint(BASE, [
      [6, 10, 's'],
      [7, 10, 's'],
    ]);
    expect(messages(compile(rows, BASE_DEPOT))).toEqual([
      't.map.txt:11:7 L020 skip is 4 m (path) from the nearest depot bay; skips must be at least 40 m away',
    ]);
    expect(messages(compile(rows, { ...BASE_DEPOT, mode: 'skip_run', timer: 45 }))).toEqual([]);
  });

  it('passes a skip far enough away, beside the road', () => {
    const w = 60;
    const rows = [
      'A'.repeat(w),
      `....h${'.'.repeat(35)}ss${'.'.repeat(w - 42)}`,
      '#'.repeat(w),
      '#'.repeat(w),
      '#'.repeat(w),
      `.....dddddd${'.'.repeat(w - 11)}`,
      ...BASE.slice(6).map((r) => r.slice(0, 11) + 'B'.repeat(w - 11)),
    ];
    const rowsWithWater = paint(rows, [[50, 1, 'h']]);
    expect(messages(compile(rowsWithWater, BASE_DEPOT))).toEqual([]);
  });

  it('fails a route tile more than 200 m from every dump site, naming the farthest', () => {
    const w = 120;
    const pavement = Array.from({ length: w }, (_, x) => (x % 30 === 4 ? 'h' : '.')).join('');
    const rows = [
      'A'.repeat(w),
      pavement,
      '#'.repeat(w),
      '#'.repeat(w),
      '#'.repeat(w),
      `.....dddddd${'.'.repeat(w - 11)}`,
      ...BASE.slice(6).map((r) => r.slice(0, 11) + 'B'.repeat(w - 11)),
    ];
    expect(messages(compile(rows, BASE_DEPOT))).toEqual([
      expect.stringMatching(
        /^t\.map\.txt:2:120 L020 route tile is 2\d\d m \(path\) from the nearest dump site \(depot bay or skip\); the limit is 200 m \(\d+ route tile\(s\) over\)$/,
      ),
    ]);
  });

  it('fails a map with no depot bay at 1:1', () => {
    const rows = paint(BASE, [...rect(6, 7, 8, 9, '+'), ...rect(9, 7, 11, 9, '+')]);
    expect(messages(compile(rows, BASE_DEPOT))).toEqual([
      't.map.txt:1:1 L020 0 depot bay(s) ($); a level needs at least 2',
    ]);
  });
});

describe('L021 water distance', () => {
  it('passes the l021 fixture street once a hydrant stands at its far end', () => {
    const dir = join(REPO_ROOT, FIXTURES, 'l021_water');
    const rows = readFileSync(join(dir, 'l021_water.map.txt'), 'utf8').trimEnd().split('\n');
    expect(messages(compile(paint(rows, [[85, 1, 'h']]), BASE_DEPOT))).toEqual([]);
  });
});

describe('L022 stopping tiles', () => {
  it('passes a hydrant beside the road and a skip beside a free drivable tile', () => {
    const rows = paint(BASE, [
      [12, 1, 's'],
      [13, 1, 's'],
    ]);
    expect(messages(compile(rows, { ...BASE_DEPOT, mode: 'skip_run', timer: 45 }))).toEqual([]);
  });

  it('fails a skip whose long sides are blocked by props and buildings', () => {
    // A skip set into the building line, with lamp posts on the pavement in front of it.
    const rows = paint(BASE, [
      [14, 6, 's'],
      [15, 6, 's'],
      [14, 5, 'l'],
      [15, 5, 'l'],
    ]);
    expect(messages(compile(rows, { ...BASE_DEPOT, mode: 'skip_run', timer: 45 }))).toEqual([
      't.map.txt:7:15 L022 skip has no stopping tile beside it (a drivable tile with no prop along a long side)',
    ]);
  });

  it('fails a hydrant with only pavement beside it (the l022 fixture), and passes it once a road is next to it', () => {
    const rows = paint(BASE, [
      [4, 0, '.'],
      [5, 0, 'h'],
    ]);
    expect(messages(compile(rows, BASE_DEPOT))).toEqual([
      't.map.txt:1:6 L022 hydrant has no stopping tile beside it (a road, apron, cobble, yard, alley or dropped-kerb tile with no prop)',
    ]);
    expect(messages(compile(paint(rows, [[5, 1, 'd']]), BASE_DEPOT))).toEqual([]);
  });
});

describe('the LEVEL_DESIGN §8.6 Depot Yard', () => {
  it('compiles with every layout check on (its skip is set dressing in the Skip Run)', () => {
    const rows = [
      'wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww',
      'wPPPPPPPPPPPPPPPPPPQQQQQQQQ++++w',
      'wPPPPPPPPPPPPPPPPPPQQQQQQQQ++++w',
      'wPPPPPPPPPPPPPPPPPPQQQQQQQQ++++w',
      'wPPPPPPPPPPPPPPPPPPQQQQQQQQ++ssw',
      'w++++++++++++++++++++++++++++++w',
      'w+$$+$$+$$+$$+$$+$$++++++++h+++w',
      'w+$$+$$+$$+$$+$$+$$++++++++++++w',
      'w+$$+$$+$$+$$+$$+$$++++++++++++w',
      'w++++++++++++++++++++++++++++++w',
      'w++++++++++++++++++++++++++++++w',
      'wl++++++++++++++++++++++++++++lw',
      'w++++++++++++++++++++++++++++++w',
      'w++++++++++++++++++++++++++++++w',
      'w++++++++++++++++++++++++++++++w',
      'w++++++++++++++++++++++++++++++w',
      'wl++++++++++++++++++++++++++++lw',
      'w++++++++++++++++++++++++++++++w',
      'w++++++++++++++++++++++++++++++w',
      'w+++++++++++++@++++++++++++++++w',
      'w++++++++++++++++++++++++++++++w',
      'wwwwwwwwwwwww++++++wwwwwwwwwwwww',
      'l............dddddd............l',
      '################################',
    ];
    const known = new Set([...KNOWN, 'roof.corrugated', 'facade.workshop']);
    const level = {
      schema: 1,
      id: 'district.depot_yard',
      name: 'The Depot Yard',
      day: 'any',
      mode: 'skip_run',
      map: 'depot_yard.map.txt',
      size: [32, 24],
      timer: 45,
      seed: 7001,
      timeOfDay: 'inherit',
      weather: 'inherit',
      start: { heading: 0 },
      depot: { rect: [0, 0, 32, 22] },
      buildings: {
        P: { storeys: 2, roof: 'roof.depot', wall: 'facade.depot_shed', use: 'depot', landmark: true },
        Q: { storeys: 1, roof: 'roof.corrugated', wall: 'facade.workshop', use: 'depot', roofkit: ['vent'] },
      },
    };
    const result = compileLevel({
      name: 'depot_yard',
      mapText: rows.map((r) => `${r}\n`).join(''),
      levelText: `${JSON.stringify(level)}\n`,
      knownAssetIds: known,
      kerbBlob: BLOB,
    });
    const { level: compiled, map } = ok(result);
    expect(compiled.sites.filter((s) => s.id === 'site.depot_bay')).toHaveLength(6);
    expect(tileLayerViolations(compiled, map, BLOB)).toEqual([]);
    // The gate's dropped kerbs carry no kerb; the pavement either side has a straight kerb to the road.
    expect(compiled.layers.autotile[22 * 32 + 13]).toBe(AUTOTILE_NONE);
    expect(compiled.layers.autotile[22 * 32 + 12]).toBe(36);
  });
});
