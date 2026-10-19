// SSP-055: frontages and pledges in the level compiler (LEVEL_DESIGN §7.7, §7.10, §9.6, §10.3; TECHNICAL_DESIGN
// §15.2): facade runs split into frontage segments, zones and stable fr_<x>_<y> ids, pledge resolution, the
// street segmentation behind L031, one site per depot bay and skip, the L020 depot rules, and L030, L031,
// L040 and L041. The failing fixture per code (with its exact file:row:col message) is in compileLevel.test.ts.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { decodeLevel, encodeLevel, type Frontage } from '../../src/sim/map.ts';
import {
  type CompileResult,
  compileLevel,
  formatDiagnostic,
  readManifestIds,
} from '../../tools/levels/compile-level.ts';
import {
  computeStreets,
  DEFAULT_FRONTAGE_WIDTH,
  FRONTAGE_ZONE_DEPTH,
  frontageStreet,
  generateFrontages,
  splitRun,
} from '../../tools/levels/frontages.ts';
import { KERB_BLOB_PATH, readKerbBlob } from '../../tools/levels/kerbBlob.ts';
import type { LayoutCode } from '../../tools/levels/layoutChecks.ts';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const FIXTURES = 'tests/fixtures/levels';
const MANIFEST = `${FIXTURES}/manifest.json`;
const KNOWN = readManifestIds(join(REPO_ROOT, MANIFEST));
const BLOB = readKerbBlob(join(REPO_ROOT, KERB_BLOB_PATH));
const LAYOUT_CODES: readonly LayoutCode[] = ['L014', 'L015', 'L020', 'L021', 'L022'];

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ssp-frontages-'));
  tempDirs.push(dir);
  return dir;
}

const BUILDINGS = {
  A: { storeys: 2, roof: 'roof.slate', wall: 'facade.terrace_brick', use: 'house' },
  B: { storeys: 2, roof: 'roof.felt', wall: 'facade.corner_shop', use: 'shop' },
  C: { storeys: 2, roof: 'roof.slate', wall: 'facade.terrace_brick_bay', use: 'house' },
  N: { storeys: 2, roof: 'roof.slate', wall: 'facade.terrace_brick', use: 'none' },
  P: { storeys: 2, roof: 'roof.depot', wall: 'facade.depot_shed', use: 'depot' },
};

/** Compile an inline map with the layout checks off (no bays or hydrants needed); depot = the whole map. */
function compileInline(rows: readonly string[], extra: Record<string, unknown> = {}): CompileResult {
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
    levelText: `${JSON.stringify(level, null, 2)}\n`,
    knownAssetIds: KNOWN,
    kerbBlob: BLOB,
    skipCodes: LAYOUT_CODES,
  });
}

function messages(result: CompileResult): string[] {
  return result.diagnostics.map(formatDiagnostic);
}

function ok(result: CompileResult): NonNullable<CompileResult['output']> {
  expect(messages(result)).toEqual([]);
  if (result.output === null) throw new Error('expected a compiled level');
  return result.output;
}

/** id, face, rect and width-in-cells summary of each frontage. */
function summary(frontages: readonly Frontage[]): [string, string, number[]][] {
  return frontages.map((f) => [f.id, f.face, [...f.rect]]);
}

const fixtureText = (name: string, ext: 'map.txt' | 'level.json'): string =>
  readFileSync(join(REPO_ROOT, FIXTURES, name, `${name}.${ext}`), 'utf8');

/** Compile the frontages fixture (every check on) with level.json fields replaced. */
function compileFixture(extra: Record<string, unknown> = {}, mapRows?: readonly string[]): CompileResult {
  const level = {
    ...(JSON.parse(fixtureText('frontages', 'level.json')) as Record<string, unknown>),
    ...extra,
  };
  return compileLevel({
    name: 'frontages',
    mapText:
      mapRows === undefined ? fixtureText('frontages', 'map.txt') : mapRows.map((r) => `${r}\n`).join(''),
    levelText: `${JSON.stringify(level, null, 2)}\n`,
    knownAssetIds: KNOWN,
    kerbBlob: BLOB,
  });
}

const FIXTURE_ROWS = fixtureText('frontages', 'map.txt').trimEnd().split('\n');

/** The rows with single characters replaced: [x, y, char]. */
function paint(rows: readonly string[], cells: readonly (readonly [number, number, string])[]): string[] {
  const out = rows.map((r) => r.split(''));
  for (const [x, y, c] of cells) {
    const row = out[y];
    if (row !== undefined) row[x] = c;
  }
  return out.map((r) => r.join(''));
}

describe('splitRun (LEVEL_DESIGN §7.10)', () => {
  it('cuts whole widths, merges a leftover under half a width and keeps any other leftover', () => {
    expect(splitRun(10, 3)).toEqual([3, 3, 4]);
    expect(splitRun(11, 3)).toEqual([3, 3, 3, 2]);
    expect(splitRun(9, 3)).toEqual([3, 3, 3]);
    expect(splitRun(13, 4)).toEqual([4, 4, 5]);
    expect(splitRun(14, 4)).toEqual([4, 4, 4, 2]);
    expect(splitRun(2, 3)).toEqual([2]);
    expect(splitRun(1, 8)).toEqual([1]);
    expect(splitRun(0, 3)).toEqual([]);
  });

  it('keeps the confirmed widths and zone depth (§13 Q4)', () => {
    expect(DEFAULT_FRONTAGE_WIDTH).toEqual({ house: 3, shop: 4, pub: 5, takeaway: 5, unit: 6, civic: 8 });
    expect(FRONTAGE_ZONE_DEPTH).toBe(3);
  });
});

describe('frontage generation', () => {
  it('splits a terrace of 10 house tiles into 3, 3 and 4, named from the north-west-most zone tile', () => {
    const rows = ['AAAAAAAAAA', '..........', '##########', '##########', '@.........'];
    const { level } = ok(compileInline(rows));
    expect(level.frontages).toEqual([
      {
        id: 'fr_0_1',
        pledge: false,
        rect: [0, 1, 3, 3],
        face: 's',
        cells: [
          [0, 1],
          [1, 1],
          [2, 1],
          [0, 2],
          [1, 2],
          [2, 2],
        ],
      },
      {
        id: 'fr_3_1',
        pledge: false,
        rect: [3, 1, 6, 3],
        face: 's',
        cells: [
          [3, 1],
          [4, 1],
          [5, 1],
          [3, 2],
          [4, 2],
          [5, 2],
        ],
      },
      {
        id: 'fr_6_1',
        pledge: false,
        rect: [6, 1, 10, 3],
        face: 's',
        cells: [
          [6, 1],
          [7, 1],
          [8, 1],
          [9, 1],
          [6, 2],
          [7, 2],
          [8, 2],
          [9, 2],
        ],
      },
    ]);
  });

  it('faces n, e, s and w, caps the zone at 3 walk tiles (no gutter beyond deep pavement)', () => {
    const rows = [
      '#########',
      '.........',
      '.........',
      '..AAA....',
      '..AAA....',
      '.........',
      '#########',
      '@........',
    ];
    const { level } = ok(compileInline(rows));
    expect(summary(level.frontages)).toEqual([
      // North: rows 2, 1 walk, row 0 road (gutter); the NW-most walk tile is on row 1.
      ['fr_2_1', 'n', [2, 0, 5, 3]],
      // West: columns 1, 0 walk, then the map edge (open: the town goes on).
      ['fr_0_3', 'w', [0, 3, 2, 5]],
      // East: columns 5, 6, 7 walk (the full depth), column 8 not in the zone.
      ['fr_5_3', 'e', [5, 3, 8, 5]],
      // South: row 5 walk, row 6 road.
      ['fr_2_5', 's', [2, 5, 5, 7]],
    ]);
    const east = level.frontages.find((f) => f.face === 'e');
    expect(east?.cells).toHaveLength(6);
  });

  it('lists the exact zone cells where pavement depth varies (the rect only bounds them)', () => {
    const rows = ['AAAA', '....', '..##', '####', '@...'];
    const { level } = ok(compileInline(rows));
    expect(level.frontages).toHaveLength(1);
    const [f] = level.frontages;
    expect(f?.rect).toEqual([0, 1, 4, 4]);
    expect(f?.cells).toEqual([
      [0, 1],
      [1, 1],
      [2, 1],
      [3, 1],
      [0, 2],
      [1, 2],
      [2, 2],
      [3, 2],
      [0, 3],
      [1, 3],
    ]);
  });

  it('makes no frontage of a side passage shut by a building or hedge, nor of depot or none uses', () => {
    const rows = [
      'AAA.AAA.e.NNNPPP',
      'AAA.AAA.e.NNNPPP',
      '................',
      '################',
      '@...............',
    ];
    const { level } = ok(compileInline(rows));
    // The gap at x 3 is shut by the other house and the path at x 7 by the hedge, so the A gables get no
    // frontage; the none (N) and depot (P) uses never do. Only the two house fronts on row 2 remain.
    expect(summary(level.frontages)).toEqual([
      ['fr_0_2', 's', [0, 2, 3, 4]],
      ['fr_4_2', 's', [4, 2, 7, 4]],
    ]);
  });

  it('applies level and building frontageWidth overrides over the per-use default', () => {
    const rows = [
      'AAAAAAAAAAAACCCCCCCC',
      '....................',
      '####################',
      '@...................',
    ];
    const byLevel = ok(compileInline(rows, { frontageWidth: { house: 4 } })).level;
    expect(byLevel.frontages.map((f) => f.rect[2] - f.rect[0])).toEqual([4, 4, 4, 4, 4]);
    const buildings = { ...BUILDINGS, C: { ...BUILDINGS.C, frontageWidth: 8 } };
    const byBuilding = ok(compileInline(rows, { frontageWidth: { house: 4 }, buildings })).level;
    expect(byBuilding.frontages.map((f) => f.rect[2] - f.rect[0])).toEqual([4, 4, 4, 8]);
    expect(messages(compileInline(rows, { frontageWidth: { depot: 3 } }))).toEqual([
      expect.stringMatching(/L000 frontageWidth "depot" must be a use that gets frontages/),
    ]);
    expect(messages(compileInline(rows, { frontageWidth: { shop: 0 } }))).toEqual([
      expect.stringMatching(/L000 frontageWidth shop must be a positive integer$/),
    ]);
  });

  it('gives facades across a precinct distinct ids (the later takes its next walk tile)', () => {
    // Three rows of cobbles: both zones are the whole precinct (the full depth, so both face open street).
    const rows = ['AAA#', ':::#', ':::#', ':::#', 'CCC#', '@..#'];
    const { level } = ok(compileInline(rows));
    expect(summary(level.frontages)).toEqual([
      // Same north-west-most tile: the north face is named first (face order n, e, s, w).
      ['fr_0_1', 'n', [0, 1, 3, 4]],
      ['fr_1_1', 's', [0, 1, 3, 4]],
      ['fr_0_5', 's', [0, 5, 3, 6]],
    ]);
  });

  it('never treats a depot bay cell as pavement, even when it inherits pavement ground', () => {
    const out = ok(compileFixture());
    const all = out.level.frontages.flatMap((f) => f.cells);
    for (const [x, y] of all) expect(FIXTURE_ROWS[y]?.[x]).not.toBe('$');
  });

  it('is generated straight from the resolved map (generateFrontages) and sorted by id tile', () => {
    const { map, buildings } = ok(compileInline(['AAAAAA', '......', '######', '@.....']));
    const widths = buildings.map(() => 3);
    const frontages = generateFrontages(map, widths);
    expect(frontages.map((f) => [f.id, f.gutter])).toEqual([
      ['fr_0_1', [12, 13, 14]],
      ['fr_3_1', [15, 16, 17]],
    ]);
  });
});

describe('streets (L031)', () => {
  it('splits roads at junctions: the fixture has 3 arms on each of two T-junctions', () => {
    const { map } = ok(compileFixture());
    const { street, first } = computeStreets(map);
    const at = (x: number, y: number): number => street[y * map.w + x] ?? -1;
    // Top road: west arm, junction, east arm; the north–south link; bottom road: west arm, junction, east arm.
    expect(first).toHaveLength(7);
    expect(new Set([at(0, 2), at(10, 3), at(17, 4)]).size).toBe(1);
    expect(new Set([at(0, 2), at(19, 3), at(30, 2), at(19, 8), at(5, 14), at(19, 14), at(30, 14)]).size).toBe(
      7,
    );
    expect(at(17, 5)).toBe(-1);
  });

  it('joins the two arms of a bend into one street', () => {
    // A north arm 8 tiles long turning east: the corner square is a junction group with only two arms.
    const rows = [
      ...Array.from({ length: 8 }, () => '###.........'),
      '############',
      '############',
      '############',
      '@...........',
    ];
    const { map } = ok(compileInline(rows));
    const { first } = computeStreets(map);
    expect(first).toHaveLength(1);
  });

  it('puts a frontage on the street holding most of its gutter tiles, or none without a gutter', () => {
    const street = new Int32Array([0, 0, 1, 1, 1, -1]);
    expect(frontageStreet(street, [0, 1, 2])).toBe(0);
    expect(frontageStreet(street, [1, 2, 3])).toBe(1);
    expect(frontageStreet(street, [1, 2])).toBe(0);
    expect(frontageStreet(street, [5])).toBe(-1);
    expect(frontageStreet(street, [])).toBe(-1);
  });
});

describe('pledges (L030, L031)', () => {
  it('marks the listed frontages as pledged in the compiled level', () => {
    const { level } = ok(compileFixture());
    expect(level.frontages.filter((f) => f.pledge).map((f) => f.id)).toEqual([
      'fr_0_1',
      'fr_6_1',
      'fr_24_1',
      'fr_32_1',
      'fr_17_6',
      'fr_21_6',
      'fr_3_12',
      'fr_26_16',
    ]);
  });

  it('fails 7 or 21 pledges, and unknown or repeated ids, with L030', () => {
    const { level } = ok(compileFixture());
    const ids = level.frontages.map((f) => f.id);
    expect(messages(compileFixture({ pledges: ids.slice(0, 7) }))).toEqual([
      expect.stringMatching(
        /^frontages\.level\.json:\d+:3 L030 pledges lists 7 frontage\(s\); a shift level needs 8–20$/,
      ),
    ]);
    expect(messages(compileFixture({ pledges: ids.slice(0, 21) }))).toEqual([
      expect.stringMatching(/L030 pledges lists 21 frontage\(s\); a shift level needs 8–20$/),
    ]);
    // Exactly at the bounds there is no L030 (only L031 spread warnings, if any).
    const l030 = (pledges: string[]): string[] =>
      messages(compileFixture({ pledges })).filter((m) => m.includes('L030'));
    expect(l030(ids.slice(0, 8))).toEqual([]);
    expect(l030(ids.slice(0, 20))).toEqual([]);
    const pledges = [
      'fr_0_1',
      'fr_6_1',
      'fr_24_1',
      'fr_32_1',
      'fr_17_6',
      'fr_21_6',
      'fr_3_12',
      'fr_99_99',
      'fr_0_1',
    ];
    // Each points at its own entry (one per line here): the unknown id, then the repeat at its second listing.
    const result = compileFixture({ pledges });
    expect(messages(result)).toEqual([
      expect.stringMatching(/:\d+:5 L030 pledge fr_99_99 is not a generated frontage \(fr_<x>_<y>\)$/),
      expect.stringMatching(/:\d+:5 L030 pledge fr_0_1 is listed more than once$/),
    ]);
    const [unknown, repeat] = result.diagnostics.map((d) => d.row);
    expect(repeat).toBe((unknown ?? 0) + 1);
  });

  it('checks only the ids, not the count, in the Skip Run', () => {
    const rows = ['AAAAAA', '......', '######', '@.....'];
    expect(messages(compileInline(rows, { mode: 'skip_run', timer: 45, pledges: ['fr_0_1'] }))).toEqual([]);
    expect(messages(compileInline(rows, { mode: 'skip_run', timer: 45, pledges: ['fr_1_1'] }))).toEqual([
      expect.stringMatching(/L030 pledge fr_1_1 is not a generated frontage/),
    ]);
  });

  it('warns (L031) when more than a third of the pledges are on one street, but still compiles', () => {
    const pledges = [
      'fr_0_1',
      'fr_3_1',
      'fr_6_1',
      'fr_12_5',
      'fr_24_1',
      'fr_17_6',
      'fr_21_6',
      'fr_3_12',
      'fr_26_16',
    ];
    const result = compileFixture({ pledges });
    expect(result.output).not.toBeNull();
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'L031', severity: 'warning' })]);
    expect(result.diagnostics[0]?.message).toBe(
      '4 of 9 pledges (fr_0_1, fr_3_1, fr_6_1, fr_12_5) are on the street that starts at map row 3, column 1; no street should hold more than a third',
    );
    // Exactly a third (3 of 9) is fine.
    const third = [...pledges.slice(0, 3), 'fr_32_1', ...pledges.slice(4)];
    expect(messages(compileFixture({ pledges: third }))).toEqual([]);
  });
});

describe('power-ups (L040)', () => {
  it('fails a shift level outside 1–3 and checks the shape and ids', () => {
    const table = { 'pwr.flask_of_tea': 1 };
    expect(messages(compileFixture({ powerups: { count: 3, table, at: [[1.5, 1.5]] } }))).toEqual([]);
    for (const count of [0, 4]) {
      expect(messages(compileFixture({ powerups: { count, table } }))).toEqual([
        expect.stringMatching(new RegExp(`L040 powerups\\.count ${count} is outside 1–3$`)),
      ]);
    }
    expect(messages(compileFixture({ powerups: { count: 1.5, table } }))).toEqual([
      expect.stringMatching(/L000 powerups\.count must be an integer$/),
    ]);
    expect(messages(compileFixture({ powerups: { count: 1, table: {} } }))).toEqual([
      expect.stringMatching(
        /L000 powerups\.table must be an object of pwr\.\* id → weight with at least one entry$/,
      ),
    ]);
    expect(messages(compileFixture({ powerups: { count: 1, table: { 'pwr.jetpack': 1 } } }))).toEqual([
      expect.stringMatching(
        /L005 powerups\.table "pwr\.jetpack" is not a pwr id in src\/data\/entities\.json$/,
      ),
    ]);
    expect(messages(compileFixture({ powerups: { count: 1, table, at: [[40, 1]] } }))).toEqual([
      expect.stringMatching(/L000 powerups\.at must be an array of \[x, y\] tile positions inside the map$/),
    ]);
  });
});

describe('collectibles (L041)', () => {
  const lostProperty = { id: 'collect.false_teeth', at: [17.5, 8.5] };
  const crisp = (at: [number, number]): Record<string, unknown> => ({
    collectibles: { lostProperty, goldenCrisp: { at } },
  });

  it('passes both on drivable tiles Bessie can reach', () => {
    expect(messages(compileFixture(crisp([38.5, 12.5])))).toEqual([]);
  });

  it('fails a missing one, one on a building, outside the map or inside a prop footprint', () => {
    expect(messages(compileFixture({ collectibles: { lostProperty } }))).toEqual([
      expect.stringMatching(
        /L041 collectibles\.goldenCrisp is missing: a shift level places the Golden Crisp$/,
      ),
    ]);
    expect(messages(compileFixture(crisp([10.5, 8.5])))).toEqual([
      expect.stringMatching(
        /L041 Golden Crisp at \[10\.5, 8\.5\] is not on a drivable tile, so Bessie cannot reach it$/,
      ),
    ]);
    expect(messages(compileFixture(crisp([40.5, 1])))).toEqual([
      expect.stringMatching(/L041 Golden Crisp at \[40\.5, 1\] is outside the map$/),
    ]);
    // The hydrant at (4, 1) has a 0.2 m circle at the tile centre: the centre is inside it, a corner is not.
    expect(messages(compileFixture(crisp([4.5, 1.5])))).toEqual([
      expect.stringMatching(
        /L041 Golden Crisp at \[4\.5, 1\.5\] is inside the footprint of the prop\.hydrant/,
      ),
    ]);
    expect(messages(compileFixture(crisp([4.1, 1.1])))).toEqual([]);
  });

  it('fails one in a footway', () => {
    // A 1-tile alley through C (rows 6–11 at x 8), shut by C on both sides and bollarded at both mouths
    // (L015), with the crisp inside it.
    const rows = paint(FIXTURE_ROWS, [
      ...[6, 7, 8, 9, 10, 11].map((y): [number, number, string] => [8, y, ';']),
      [8, 5, '!'],
      [8, 12, '!'],
    ]);
    expect(messages(compileFixture(crisp([8.5, 8.5]), rows))).toEqual([
      expect.stringMatching(
        /L041 Golden Crisp at \[8\.5, 8\.5\] is in a footway \(a 1-tile alley Bessie cannot enter\)$/,
      ),
    ]);
  });

  it('checks the Lost Property id (L005) and skips L041 in the Skip Run', () => {
    expect(
      messages(
        compileFixture({ collectibles: { lostProperty: { id: 'collect.golden_crisp', at: [17.5, 8.5] } } }),
      ),
    ).toEqual([
      expect.stringMatching(
        /L005 collectibles\.lostProperty\.id collect\.golden_crisp is not a lostProperty collectible in src\/data\/entities\.json$/,
      ),
    ]);
    const rows = ['AAAAAA', '......', '######', '@.....'];
    expect(messages(compileInline(rows, { mode: 'skip_run', timer: 45, collectibles: {} }))).toEqual([]);
  });
});

describe('sites and the depot (L020)', () => {
  it('lists one site per depot bay and skip, with their tile rects', () => {
    const { level } = ok(compileFixture());
    expect(level.sites).toEqual([
      { id: 'site.skip', rect: [30, 16, 32, 17] },
      { id: 'site.depot_bay', rect: [6, 18, 8, 21] },
      { id: 'site.depot_bay', rect: [9, 18, 11, 21] },
    ]);
  });

  it('fails a bay outside depot.rect and a bay or skip that is not one filled rectangle', () => {
    expect(messages(compileFixture({ depot: { rect: [5, 17, 4, 6] } }))).toEqual([
      'frontages.map.txt:19:10 L020 depot bay ($) lies outside depot.rect [5, 17, 4, 6]; bays belong in the depot',
    ]);
    const lShaped = paint(FIXTURE_ROWS, [[6, 21, '$']]);
    expect(messages(compileFixture({}, lShaped))).toEqual([
      'frontages.map.txt:19:7 L020 depot bay ($) cells must form one filled rectangle (7 cells, not a rectangle)',
    ]);
    // Two touching bays are one 4-connected group: one bay, so too few.
    const joined = paint(FIXTURE_ROWS, [
      [8, 18, '$'],
      [8, 19, '$'],
      [8, 20, '$'],
    ]);
    expect(messages(compileFixture({}, joined))).toEqual([
      'frontages.map.txt:19:7 L020 1 depot bay(s) ($); a level needs at least 2',
    ]);
    const skip = paint(FIXTURE_ROWS, [[30, 17, 's']]);
    expect(messages(compileFixture({}, skip))).toEqual([
      'frontages.map.txt:17:31 L020 skip (s) cells must form one filled rectangle (3 cells, not a rectangle)',
    ]);
  });
});

describe('the CLI on the frontages fixture', () => {
  it('compiles byte-identically twice, round-trips, and lists every $ and s site', () => {
    const run = (out: string): void => {
      const r = spawnSync(
        process.execPath,
        [
          'tools/levels/compile-level.ts',
          '--src',
          `${FIXTURES}/frontages`,
          '--manifest',
          MANIFEST,
          '--out',
          out,
        ],
        { cwd: REPO_ROOT, encoding: 'utf8' },
      );
      expect(r.status, r.stderr).toBe(0);
      expect(r.stderr).toBe('');
    };
    const a = tempDir();
    const b = tempDir();
    run(a);
    run(b);
    const file = (root: string): string => join(root, 'public/assets/levels/frontages.json');
    const hash = (p: string): string => createHash('sha256').update(readFileSync(p)).digest('hex');
    expect(hash(file(a))).toBe(hash(file(b)));
    const text = readFileSync(file(a), 'utf8');
    const level = decodeLevel(text);
    expect(encodeLevel(level)).toBe(text);
    const siteCells = (id: string): number =>
      level.sites
        .filter((s) => s.id === id)
        .reduce((n, s) => n + (s.rect[2] - s.rect[0]) * (s.rect[3] - s.rect[1]), 0);
    const count = (c: string): number => FIXTURE_ROWS.join('').split(c).length - 1;
    expect(siteCells('site.depot_bay')).toBe(count('$'));
    expect(siteCells('site.skip')).toBe(count('s'));
    expect(level.frontages).toHaveLength(45);
  });

  it('prints an L031 warning and exits 0 on the l031_spread fixture', () => {
    const r = spawnSync(
      process.execPath,
      [
        'tools/levels/compile-level.ts',
        '--src',
        `${FIXTURES}/l031_spread`,
        '--manifest',
        MANIFEST,
        '--out',
        tempDir(),
      ],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    );
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).toBe('');
    expect(r.stdout).toContain(
      'l031_spread.level.json:27:3 L031 4 of 9 pledges (fr_0_1, fr_3_1, fr_6_1, fr_12_5) are on the street that starts at map row 3, column 1; no street should hold more than a third',
    );
    expect(r.stdout).toContain('1 compiled, 0 failed');
  });
});

describe('frontage invariants on Puddle Lane (committed output)', () => {
  const level = decodeLevel(readFileSync(join(REPO_ROOT, 'public/assets/levels/puddle_lane.json'), 'utf8'));
  const [w] = level.size;

  it('has unique ids, each named from a tile of its own zone, inside the bounding rect', () => {
    expect(level.frontages.length).toBeGreaterThan(0);
    const ids = level.frontages.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const f of level.frontages) {
      const m = /^fr_(\d+)_(\d+)$/.exec(f.id);
      expect(m).not.toBeNull();
      expect(f.cells).toContainEqual([Number(m?.[1]), Number(m?.[2])]);
      const xs = f.cells.map(([x]) => x);
      const ys = f.cells.map(([, y]) => y);
      expect(f.rect).toEqual([Math.min(...xs), Math.min(...ys), Math.max(...xs) + 1, Math.max(...ys) + 1]);
    }
  });

  it('keeps every zone tile on the route and pledges exactly the level.json pledges (SSP-056)', () => {
    const source = JSON.parse(
      readFileSync(join(REPO_ROOT, 'assets-src/levels/puddle_lane.level.json'), 'utf8'),
    ) as { pledges: string[] };
    for (const f of level.frontages) {
      for (const [x, y] of f.cells) expect(level.layers.route[y * w + x]).toBe(1);
    }
    const pledged = level.frontages.filter((f) => f.pledge).map((f) => f.id);
    expect(pledged.sort()).toEqual([...source.pledges].sort());
  });
});

describe('id stability', () => {
  it('keeps every other id when one building changes', () => {
    const before = ok(compileFixture()).level.frontages.map((f) => f.id);
    // Turn the pub (D, x 22–39, rows 6–11) into a house: its own frontages change, every other id stays.
    const source = JSON.parse(fixtureText('frontages', 'level.json')) as {
      buildings: Record<string, Record<string, unknown>>;
    };
    const buildings = { ...source.buildings, D: { ...source.buildings.D, use: 'house' } };
    const after = ok(compileFixture({ buildings })).level.frontages.map((f) => f.id);
    const ofD = (id: string): boolean => /^fr_(2[2-9]|3\d)_(5|12)$/.test(id) || /^fr_21_\d+$/.test(id);
    expect(after.filter((id) => !ofD(id))).toEqual(before.filter((id) => !ofD(id)));
    expect(after.filter(ofD).length).toBeGreaterThan(before.filter(ofD).length);
  });
});
