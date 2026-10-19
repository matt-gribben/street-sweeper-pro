// The SSP-054 spawn layers of the level compiler (LEVEL_DESIGN §9.1–§9.2, §10.3; TECHNICAL_DESIGN §10.3,
// §15.2): the route mask on every ground character, the grime cells (OPEN, and GUTTER in the 2-cell band on
// the road side of raised kerbs), the zone grimeDensity, the litter weight field (base weights, hotspots,
// constraints, gutterBias), the LitterSpec/GrimeSpec guards, L005 litter ids, L050 and L051, and the
// byte-determinism of the CLI on the spawns fixture.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  decodeLevel,
  encodeLevel,
  GRIME_CELL,
  GUTTER_CELLS_PER_TILE,
  type Level,
  LITTER_CELL_M,
  LITTER_CELLS_PER_TILE,
  LITTER_PLACE,
  LITTER_WEIGHT_MAX,
} from '../../src/sim/map.ts';
import {
  type CompileResult,
  compileLevel,
  formatDiagnostic,
  readManifestIds,
} from '../../tools/levels/compile-level.ts';
import { KERB_BLOB_PATH, readKerbBlob } from '../../tools/levels/kerbBlob.ts';
import type { LayoutCode } from '../../tools/levels/layoutChecks.ts';
import { GUTTER_BAND_CELLS, LITTER_BASE_WEIGHT } from '../../tools/levels/spawnLayers.ts';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const FIXTURES = 'tests/fixtures/levels';
const MANIFEST = `${FIXTURES}/manifest.json`;
const KNOWN = readManifestIds(join(REPO_ROOT, MANIFEST));
const KERB_BLOB = readKerbBlob(join(REPO_ROOT, KERB_BLOB_PATH));
const LAYOUT_CODES: readonly LayoutCode[] = ['L014', 'L015', 'L020', 'L021', 'L022'];

const BUILDING_A = { storeys: 2, roof: 'roof.slate', wall: 'facade.terrace_brick', use: 'house' };
const BUILDING_B = { storeys: 3, roof: 'roof.felt', wall: 'facade.corner_shop', use: 'shop' };

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function levelJson(rows: readonly string[], extra: Record<string, unknown>): string {
  const w = rows[0]?.length ?? 0;
  const h = rows.length;
  return `${JSON.stringify(
    {
      schema: 1,
      id: 'district.t',
      name: 'Test Lane',
      day: 'mon',
      mode: 'shift',
      map: 't.map.txt',
      size: [w, h],
      timer: 240,
      seed: 7,
      timeOfDay: 'morning',
      weather: 'clear',
      start: { heading: 0 },
      depot: { rect: [0, 0, w, h] },
      buildings: { A: BUILDING_A, B: BUILDING_B },
      ...extra,
    },
    null,
    2,
  )}\n`;
}

function compileInline(rows: readonly string[], extra: Record<string, unknown> = {}): CompileResult {
  return compileLevel({
    name: 't',
    mapText: rows.map((r) => `${r}\n`).join(''),
    levelText: levelJson(rows, extra),
    knownAssetIds: KNOWN,
    kerbBlob: KERB_BLOB,
    skipCodes: [...LAYOUT_CODES, 'L011', 'L012', 'L013'],
  });
}

const messages = (result: CompileResult): string[] => result.diagnostics.map(formatDiagnostic);

function ok(result: CompileResult): Level {
  expect(messages(result)).toEqual([]);
  if (result.output === null) throw new Error('expected a compiled level');
  return result.output.level;
}

/** A minimal valid grime spec. */
const GRIME = { cells: 0, gutterShare: 0, zones: [], speckle: 0 };
/** A minimal valid litter spec with every type allowed anywhere. */
const LITTER = { initial: 1, table: { 'litter.crisp_packet': 1 }, gutterBias: 0.5 };

/** Count of the grime cells of tile (tx, ty) with every bit of `bits` set. */
function cellsWith(level: Level, tx: number, ty: number, bits: number): number {
  const n = GUTTER_CELLS_PER_TILE;
  const gw = level.size[0] * n;
  let count = 0;
  for (let ly = 0; ly < n; ly += 1) {
    for (let lx = 0; lx < n; lx += 1) {
      if (((level.layers.gutter[(ty * n + ly) * gw + tx * n + lx] ?? 0) & bits) === bits) count += 1;
    }
  }
  return count;
}

describe('route layer (LEVEL_DESIGN §8.3)', () => {
  it('is 1 exactly on route-area characters and 0 on grass, aprons, water, sand, void and footways', () => {
    const rows = ['#><^v#####', '..::%%;;,+', '@.::%%;;,+', '.~ _..;.,+'];
    const level = ok(compileInline(rows));
    // `;` counts only where the alley is 2 wide (x 6–7, rows 1–2); the lone `;` at (6, 3) is a footway.
    const expected = ['1111111111', '1111111100', '1111111100', '1000110100'];
    const route = rows.map((row, y) =>
      [...row].map((_, x) => String(level.layers.route[y * row.length + x])).join(''),
    );
    expect(route).toEqual(expected);
  });
});

describe('grime cells: OPEN and the gutter band (LEVEL_DESIGN §9.2)', () => {
  // Raised kerbs: pavement above the road (row 0 | row 1) and below it (row 2 | row 3) except the dropped kerb
  // `d`; pavement either side of the north–south road (x 4, rows 3–4). The apron `+` meets the road flush.
  const rows = ['.....+', '#####+', '######', '..d.#.', '@...#.'];

  it('marks GUTTER only in the 2-cell band on the road side of each raised kerb edge', () => {
    const level = ok(compileInline(rows));
    const w = rows[0]?.length ?? 0;
    const n = GUTTER_CELLS_PER_TILE;
    const gw = w * n;
    const char = (x: number, y: number): string => rows[y]?.[x] ?? ' ';
    const raised = (x: number, y: number): boolean => char(x, y) === '.' || char(x, y) === ',';
    expect(GUTTER_BAND_CELLS).toBe(2);
    for (let k = 0; k < level.layers.gutter.length; k += 1) {
      const gx = k % gw;
      const gy = Math.floor(k / gw);
      const tx = Math.floor(gx / n);
      const ty = Math.floor(gy / n);
      const lx = gx % n;
      const ly = gy % n;
      const road = char(tx, ty) === '#';
      const inBand =
        road &&
        ((raised(tx, ty - 1) && ly < 2) ||
          (raised(tx, ty + 1) && ly >= n - 2) ||
          (raised(tx - 1, ty) && lx < 2) ||
          (raised(tx + 1, ty) && lx >= n - 2));
      const v = level.layers.gutter[k] ?? 0;
      expect((v & GRIME_CELL.GUTTER) !== 0, `cell (${gx}, ${gy})`).toBe(inBand);
      expect((v & GRIME_CELL.OPEN) !== 0, `cell (${gx}, ${gy})`).toBe(level.layers.route[ty * w + tx] === 1);
    }
    expect(cellsWith(level, 0, 1, GRIME_CELL.GUTTER)).toBe(16); // north kerb only
    expect(cellsWith(level, 4, 1, GRIME_CELL.GUTTER)).toBe(16); // the apron to the east is flush
    expect(cellsWith(level, 2, 2, GRIME_CELL.GUTTER)).toBe(0); // the dropped kerb has no gutter
    expect(cellsWith(level, 4, 3, GRIME_CELL.GUTTER)).toBe(32); // kerbs west and east
    expect(cellsWith(level, 0, 0, GRIME_CELL.GUTTER)).toBe(0); // never on the pavement side
    expect(cellsWith(level, 5, 0, GRIME_CELL.OPEN)).toBe(0); // aprons never grime
  });

  it('closes the cells under a solid prop footprint (lamp post circle, bench box) and in a skip', () => {
    const level = ok(compileInline(['@.l.n.s#', '########']));
    expect(cellsWith(level, 1, 0, GRIME_CELL.OPEN)).toBe(64);
    // Lamp post r 0.2 m at the tile centre: the 4 cells meeting at the centre.
    expect(cellsWith(level, 2, 0, GRIME_CELL.OPEN)).toBe(60);
    // Bench 1.8 × 0.6 m: all 8 columns of the 4 middle rows (±0.3 m reaches into the second row each side).
    expect(cellsWith(level, 4, 0, GRIME_CELL.OPEN)).toBe(32);
    // A skip tile is never grimy.
    expect(cellsWith(level, 6, 0, GRIME_CELL.OPEN)).toBe(0);
  });
});

describe('grimeDensity (zone component)', () => {
  it('takes the highest covering zone per route tile and is 0 off route', () => {
    const rows = ['BBBB......', '....1.....', '##########', '##########', '@...i.....'];
    const level = ok(
      compileInline(rows, {
        anchors: { '1': 'doris_home' },
        grime: {
          ...GRIME,
          zones: [
            { rect: [6, 2, 2, 2], density: 0.5 },
            { near: 'use:shop', radius: 1, density: 0.25 },
            { near: 'doris_home', radius: 1, density: 0.75 },
            { near: 'prop.litter_bin', radius: 1.5, density: 1 },
          ],
        },
      }),
    );
    const w = 10;
    const d = (x: number, y: number): number => level.layers.grimeDensity[y * w + x] ?? -1;
    expect([d(6, 2), d(7, 3), d(8, 2), d(9, 3)]).toEqual([128, 128, 0, 0]);
    expect([d(0, 1), d(2, 1), d(4, 0), d(0, 0)]).toEqual([64, 64, 191, 0]); // (0, 0) is a building cell
    expect([d(3, 1), d(4, 1), d(5, 1), d(4, 2), d(6, 1)]).toEqual([191, 191, 191, 191, 0]);
    expect([d(4, 4), d(3, 3), d(5, 3), d(4, 2), d(2, 4)]).toEqual([255, 255, 255, 191, 0]);
    expect(level.grime).toEqual({ cells: 0, gutterCells: 0, speckle: 0 });
  });
});

describe('litter weight field (LEVEL_DESIGN §9.1)', () => {
  // Pavement rows 0–1 (a litter bin at (2, 1)), a 3-tile road (rows 2–4: kerbs on both sides, so rows 2 and 4
  // are road gutter and row 3 road centre), pavement row 5.
  const rows = ['@.....', '..i...', '######', '######', '######', '......'];
  const W = rows[0]?.length ?? 0;
  const SW = W * LITTER_CELLS_PER_TILE;
  const compile = (gutterBias: number) =>
    ok(
      compileInline(rows, {
        litter: {
          initial: 20,
          table: { 'litter.crisp_packet': 3, 'litter.drink_can': 1 },
          gutterBias,
          hotspots: [{ near: 'prop.litter_bin', radius: 1, mult: 2 }],
        },
      }),
    );
  /** Sub-cell weight at sub-cell (sx, sy). */
  const weightAt = (level: Level, sx: number, sy: number): number =>
    level.litter?.weights[sy * SW + sx] ?? -1;
  /** Is sub-cell (sx, sy) within the bin hotspot (2 m of the bin at (5 m, 3 m))? */
  const nearBin = (sx: number, sy: number): boolean =>
    Math.hypot((sx + 0.5) * LITTER_CELL_M - 5, (sy + 0.5) * LITTER_CELL_M - 3) <= 2;

  it('follows the base weights and multiplies the hotspot sub-cells by the bin mult', () => {
    const level = compile(0.5);
    const litter = level.litter;
    if (litter === null) throw new Error('no litter field');
    expect(litter.initial).toBe(20);
    expect(litter.minSpacingM).toBe(0.5);
    expect(litter.table).toEqual([
      { id: 'litter.crisp_packet', weight: 3, requires: 0 },
      { id: 'litter.drink_can', weight: 1, requires: 0 },
    ]);
    // Pavement far from the bin vs road centre (both non-gutter, so the same scale): 1.5 : 0.4.
    const pavement = weightAt(level, 22, 1);
    const centre = weightAt(level, 3, 13);
    expect(pavement / centre).toBeCloseTo(LITTER_BASE_WEIGHT.pavement / LITTER_BASE_WEIGHT.roadCentre, 3);
    // Every pavement sub-cell has the pavement weight, doubled inside the hotspot (bin footprint excepted).
    for (const sy of [0, 1, 2, 3, 4, 5, 6, 7, 20, 21, 22, 23]) {
      for (let sx = 0; sx < SW; sx += 1) {
        const underBin = (sx === 9 || sx === 10) && (sy === 5 || sy === 6);
        const expected = underBin ? 0 : nearBin(sx, sy) ? 2 * pavement : pavement;
        expect(Math.abs(weightAt(level, sx, sy) - expected), `sub-cell (${sx}, ${sy})`).toBeLessThanOrEqual(
          1,
        );
      }
    }
    // Gutter rows: one weight outside the hotspot, double it inside.
    const gutter = weightAt(level, 22, 9);
    for (const sy of [8, 9, 10, 11, 16, 17, 18, 19]) {
      for (let sx = 0; sx < SW; sx += 1) {
        const expected = nearBin(sx, sy) ? 2 * gutter : gutter;
        expect(Math.abs(weightAt(level, sx, sy) - expected), `sub-cell (${sx}, ${sy})`).toBeLessThanOrEqual(
          1,
        );
      }
    }
    expect(Math.max(...litter.weights)).toBe(LITTER_WEIGHT_MAX);
  });

  it('rescales the road gutter to hold exactly gutterBias of the total weight', () => {
    for (const bias of [0, 0.25, 0.6, 1]) {
      const litter = compile(bias).litter;
      if (litter === null) throw new Error('no litter field');
      let gutter = 0;
      let total = 0;
      litter.weights.forEach((v, k) => {
        total += v;
        if (((litter.places[k] ?? 0) & LITTER_PLACE.GUTTER) !== 0) gutter += v;
      });
      expect(gutter / total).toBeCloseTo(bias, 3);
    }
  });

  it('marks the places: GUTTER on road within 1 tile of a kerb, PAVEMENT on slabs', () => {
    const litter = compile(0.5).litter;
    if (litter === null) throw new Error('no litter field');
    for (let sy = 0; sy < rows.length * LITTER_CELLS_PER_TILE; sy += 1) {
      const row = Math.floor(sy / LITTER_CELLS_PER_TILE);
      for (let sx = 0; sx < SW; sx += 1) {
        const p = litter.places[sy * SW + sx] ?? 0;
        expect((p & LITTER_PLACE.GUTTER) !== 0).toBe(row === 2 || row === 4);
        expect((p & LITTER_PLACE.PAVEMENT) !== 0).toBe(row <= 1 || row === 5);
      }
    }
  });

  describe('type constraints (rule 5)', () => {
    // A tree at (4, 3) → (9 m, 7 m); kerbs along y = 8 m and y = 12 m.
    const treeRows = [
      '@...........',
      '............',
      '............',
      '....t.......',
      '############',
      '############',
      '............',
    ];
    const TW = 12 * LITTER_CELLS_PER_TILE;
    const field = (table: Record<string, number>) => {
      const level = ok(compileInline(treeRows, { litter: { initial: 1, table, gutterBias: 0.5 } }));
      if (level.litter === null) throw new Error('no litter field');
      return level.litter;
    };
    const centre = (k: number): [number, number] => [
      ((k % TW) + 0.5) * LITTER_CELL_M,
      (Math.floor(k / TW) + 0.5) * LITTER_CELL_M,
    ];

    it('puts leaf piles only within 4 m of a tree', () => {
      const litter = field({ 'litter.leaf_pile': 1 });
      expect(litter.table).toEqual([{ id: 'litter.leaf_pile', weight: 1, requires: LITTER_PLACE.NEAR_TREE }]);
      litter.weights.forEach((v, k) => {
        const [x, y] = centre(k);
        const near = Math.hypot(x - 9, y - 7) <= 4;
        expect((litter.places[k] ?? 0) & LITTER_PLACE.NEAR_TREE ? 1 : 0).toBe(near ? 1 : 0);
        if (!near) expect(v).toBe(0);
        else if (Math.abs(x - 9) > 0.5 || Math.abs(y - 7) > 0.5) expect(v).toBeGreaterThan(0);
      });
    });

    it('puts bin bags only within 2 tiles of a kerb and dog mess only on pavement', () => {
      const bags = field({ 'litter.bin_bag': 1 });
      bags.weights.forEach((v, k) => {
        const [, y] = centre(k);
        const near = y >= 4 && y <= 16; // kerbs at 8 m and 12 m
        expect(v > 0).toBe(near && !(Math.abs(centre(k)[0] - 9) < 0.5 && Math.abs(y - 7) < 0.5));
      });
      const mess = field({ 'litter.dog_mess': 1 });
      mess.weights.forEach((v, k) => {
        const [x, y] = centre(k);
        const underTree = Math.abs(x - 9) < 0.5 && Math.abs(y - 7) < 0.5;
        expect(v > 0).toBe(((mess.places[k] ?? 0) & LITTER_PLACE.PAVEMENT) !== 0 && !underTree);
      });
    });

    it('lets a sub-cell take litter when any table type is allowed there', () => {
      const mixed = field({ 'litter.dog_mess': 1, 'litter.crisp_packet': 1 });
      const anywhere = field({ 'litter.crisp_packet': 1 });
      expect([...mixed.weights].map((v) => v > 0)).toEqual([...anywhere.weights].map((v) => v > 0));
    });
  });
});

describe('litter and grime guards (L000, L005)', () => {
  const rows = ['@..', '###'];

  it('reports unknown litter ids and ids excluded from a known district as L005', () => {
    expect(messages(compileInline(rows, { litter: { ...LITTER, table: { 'litter.unicorn': 1 } } }))).toEqual([
      expect.stringMatching(
        /^t\.level\.json:\d+:\d+ L005 litter\.table "litter\.unicorn" is not a litter id in src\/data\/entities\.json$/,
      ),
    ]);
    const leaves = { litter: { ...LITTER, table: { 'litter.leaf_pile': 1 } } };
    expect(messages(compileInline(rows, { ...leaves, id: 'district.puddle_lane' }))).toEqual([
      expect.stringMatching(
        /L005 litter\.table litter\.leaf_pile is not allowed in district\.puddle_lane \(entities\.json districts\)$/,
      ),
    ]);
    expect(messages(compileInline(rows, { ...leaves, id: 'district.conker_hill' }))).toEqual([]);
  });

  it('checks near references, radii, zone shapes and unknown fields', () => {
    const bad = (extra: Record<string, unknown>): string[] => messages(compileInline(rows, extra));
    expect(bad({ litter: { ...LITTER, hotspots: [{ near: 'nowhere', radius: 2, mult: 2 }] } })).toEqual([
      expect.stringMatching(
        /L000 litter\.hotspots\[0\]\.near "nowhere" must be prop\.<id>, site\.<id>, use:<building use> or an anchor name from anchors$/,
      ),
    ]);
    expect(
      bad({ litter: { ...LITTER, hotspots: [{ near: 'use:castle', radius: 2, mult: 2 }] } }),
    ).toHaveLength(1);
    expect(bad({ litter: { ...LITTER, hotspots: [{ near: 'prop.bench', radius: 0, mult: 2 }] } })).toEqual([
      expect.stringMatching(/L000 litter\.hotspots\[0\]\.radius must be a positive number of tiles$/),
    ]);
    expect(bad({ litter: { ...LITTER, colour: 'red' } })).toEqual([
      expect.stringMatching(/L000 litter\.colour is not a field/),
    ]);
    expect(bad({ litter: { ...LITTER, minSpacingM: 0 } })).toEqual([
      expect.stringMatching(/L000 litter\.minSpacingM must be a positive number of metres$/),
    ]);
    expect(bad({ litter: { ...LITTER, initial: 3, table: {} } })).toEqual([
      expect.stringMatching(
        /L000 litter\.table must name at least one litter type when litter\.initial > 0$/,
      ),
    ]);
    const zone = (z: Record<string, unknown>): string[] => bad({ grime: { ...GRIME, zones: [z] } });
    expect(zone({ rect: [0, 0, 1, 1], near: 'prop.bench', density: 1 })).toEqual([
      expect.stringMatching(/L000 grime\.zones\[0\] must have exactly one of rect or near$/),
    ]);
    expect(zone({ rect: [2, 0, 2, 1], density: 1 })).toEqual([
      expect.stringMatching(
        /L000 grime\.zones\[0\]\.rect must be \[x, y, w, h\] in tiles with w, h ≥ 1, inside the map$/,
      ),
    ]);
    expect(zone({ near: 'prop.bench', density: 1 })).toEqual([
      expect.stringMatching(/L000 grime\.zones\[0\]\.radius must be a positive number of tiles$/),
    ]);
    expect(zone({ rect: [0, 0, 1, 1], density: 1.5 })).toEqual([
      expect.stringMatching(/L000 grime\.zones\[0\]\.density must be a number 0\.\.1$/),
    ]);
    expect(bad({ grime: { ...GRIME, speckle: 0.2 } })).toEqual([
      expect.stringMatching(/L000 grime\.speckle must be a number 0\.\.0\.1$/),
    ]);
    // minSpacingM defaults to 0.5 m.
    expect(ok(compileInline(rows, { litter: LITTER })).litter?.minSpacingM).toBe(0.5);
  });
});

describe('budgets (LEVEL_DESIGN §10.3)', () => {
  const rows = ['@.....', '######', '......'];
  const counts = (() => {
    const level = ok(compileInline(rows, { grime: GRIME }));
    let open = 0;
    let gutter = 0;
    for (const v of level.layers.gutter) {
      if ((v & GRIME_CELL.OPEN) !== 0) open += 1;
      if ((v & GRIME_CELL.GUTTER) !== 0) gutter += 1;
    }
    return { open, gutter };
  })();

  it('L050: litter.initial plus expected dynamic litter over 1,000', () => {
    expect(messages(compileInline(rows, { litter: { ...LITTER, initial: 1000 } }))).toEqual([]);
    expect(messages(compileInline(rows, { litter: { ...LITTER, initial: 1001 } }))).toEqual([
      expect.stringMatching(
        /^t\.level\.json:\d+:\d+ L050 litter\.initial 1001 \+ expected dynamic litter 0 = 1001 is over the budget of 1000$/,
      ),
    ]);
  });

  it('L051: grime.cells over the OPEN cells, the gutter quota over the band, or the rest over the others', () => {
    const { open, gutter } = counts;
    expect(open).toBe(3 * 6 * 64);
    expect(gutter).toBe(6 * 2 * 16);
    const run = (cells: number, gutterShare: number): string[] =>
      messages(compileInline(rows, { grime: { ...GRIME, cells, gutterShare } }));
    expect(run(open, gutter / open)).toEqual([]);
    expect(run(open + 1, 0)).toEqual([
      `t.level.json:${lineOf('"cells"')}:5 L051 grime.cells ${open + 1} exceeds the ${open} route-area grime cells available`,
    ]);
    expect(run(gutter + 1, 1)).toEqual([
      `t.level.json:${lineOf('"gutterShare"')}:5 L051 grime.gutterShare 1 asks for ${gutter + 1} gutter cells; the gutter band has ${gutter}`,
    ]);
    expect(run(open, 0)).toEqual([
      `t.level.json:${lineOf('"cells"')}:5 L051 grime.cells ${open} leaves ${open} non-gutter cells; only ${open - gutter} are available`,
    ]);
    const level = ok(compileInline(rows, { grime: { ...GRIME, cells: 100, gutterShare: 0.155 } }));
    expect(level.grime).toEqual({ cells: 100, gutterCells: 16, speckle: 0 });
  });

  /** 1-based line of a key in the inline level.json (the grime block's own keys come after "grime"). */
  function lineOf(key: string): number {
    const text = levelJson(rows, { grime: GRIME });
    const lines = text.split('\n');
    const grimeLine = lines.findIndex((l) => l.includes('"grime"'));
    return lines.findIndex((l, i) => i > grimeLine && l.includes(key)) + 1;
  }
});

describe('the spawns fixture on the CLI', () => {
  function runCli(out: string): { status: number | null; stderr: string } {
    const result = spawnSync(
      process.execPath,
      ['tools/levels/compile-level.ts', '--src', `${FIXTURES}/spawns`, '--manifest', MANIFEST, '--out', out],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    );
    return { status: result.status, stderr: result.stderr };
  }
  const tempDir = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'ssp-compile-spawns-'));
    tempDirs.push(dir);
    return dir;
  };
  const sha = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex');

  it('compiles twice to byte-identical files that decode and re-encode exactly', () => {
    const a = tempDir();
    const b = tempDir();
    expect(runCli(a).status).toBe(0);
    expect(runCli(b).status).toBe(0);
    const fileA = join(a, 'public/assets/levels/spawns.json');
    expect(sha(fileA)).toBe(sha(join(b, 'public/assets/levels/spawns.json')));
    const text = readFileSync(fileA, 'utf8');
    const level = decodeLevel(text);
    expect(encodeLevel(level)).toBe(text);
    expect(level.grime).toEqual({ cells: 2000, gutterCells: 300, speckle: 0.05 });
    expect(level.litter?.table.map((e) => [e.id, e.requires])).toEqual([
      ['litter.crisp_packet', 0],
      ['litter.dog_mess', LITTER_PLACE.PAVEMENT],
      ['litter.drink_can', 0],
      ['litter.leaf_pile', LITTER_PLACE.NEAR_TREE],
    ]);
    expect(level.layers.grimeDensity.some((v) => v === Math.round(0.8 * 255))).toBe(true);
  });
});
