// Level compiler core (LEVEL_DESIGN §8, §10; TECHNICAL_DESIGN §15; SSP-033): the CLI on plain Node type
// stripping, the fixture per validation code, ground inheritance, building merge, layers and the audio header.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { AUTOTILE_NONE, decodeLevel, encodeLevel, Ground, Surface } from '../../src/sim/map.ts';
import {
  type CompileResult,
  compileLevel,
  DEFAULT_LEGEND,
  formatDiagnostic,
  inheritGround,
  listLevelPairs,
  locateJsonKey,
  parseArgs,
  readManifestIds,
  runCompileLevel,
} from '../../tools/levels/compile-level.ts';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const FIXTURES = 'tests/fixtures/levels';
const MANIFEST = `${FIXTURES}/manifest.json`;
const KNOWN = readManifestIds(join(REPO_ROOT, MANIFEST));

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ssp-compile-level-'));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function runCli(args: readonly string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, ['tools/levels/compile-level.ts', ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  expect(result.error).toBeUndefined();
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

const BUILDING_A = { storeys: 2, roof: 'roof.slate', wall: 'facade.terrace_brick', use: 'house' };

/** A level.json for an inline map; `depot` defaults to the whole map. */
function levelJson(name: string, rows: readonly string[], extra: Record<string, unknown> = {}): string {
  const w = rows[0]?.length ?? 0;
  const h = rows.length;
  return `${JSON.stringify(
    {
      schema: 1,
      id: `district.${name}`,
      name: 'Test Lane',
      day: 'mon',
      mode: 'shift',
      map: `${name}.map.txt`,
      size: [w, h],
      timer: 240,
      seed: 7,
      timeOfDay: 'morning',
      weather: 'clear',
      start: { heading: 0 },
      depot: { rect: [0, 0, w, h] },
      buildings: { A: BUILDING_A },
      ...extra,
    },
    null,
    2,
  )}\n`;
}

/** Compile an inline map (rows joined with LF plus a final newline unless `mapText` is given). */
function compileInline(
  rows: readonly string[],
  extra: Record<string, unknown> = {},
  mapText: string = rows.map((r) => `${r}\n`).join(''),
): CompileResult {
  return compileLevel({ name: 't', mapText, levelText: levelJson('t', rows, extra), knownAssetIds: KNOWN });
}

function messages(result: CompileResult): string[] {
  return result.diagnostics.map(formatDiagnostic);
}

function ok(result: CompileResult): NonNullable<CompileResult['output']> {
  expect(messages(result)).toEqual([]);
  if (result.output === null) throw new Error('expected a compiled level');
  return result.output;
}

/** One layer as rows of base-36 digits, for readable expectations. */
function layerRows(bytes: Uint8Array, w: number): string[] {
  const rows: string[] = [];
  for (let y = 0; y * w < bytes.length; y += 1) {
    rows.push([...bytes.subarray(y * w, y * w + w)].map((v) => v.toString(36)).join(''));
  }
  return rows;
}

describe('the CLI on Node type stripping', () => {
  it('compiles the valid fixture without tsx, and two runs are byte-identical', () => {
    const outA = tempDir();
    const outB = tempDir();
    const args = ['--src', `${FIXTURES}/valid`, '--manifest', MANIFEST];
    const a = runCli([...args, '--out', outA]);
    expect(a.status, a.stderr).toBe(0);
    expect(a.stdout).toContain('compile-level: district.fixture_valid 20x12');
    expect(a.stdout).toContain('1 compiled, 0 failed');
    const b = runCli([...args, `--out=${outB}`]);
    expect(b.status, b.stderr).toBe(0);
    const fileA = join(outA, 'public/assets/levels/valid.json');
    const fileB = join(outB, 'public/assets/levels/valid.json');
    expect(sha256(fileA)).toBe(sha256(fileB));
    const text = readFileSync(fileA, 'utf8');
    expect(encodeLevel(decodeLevel(text))).toBe(text);
  });

  it('imports src/sim/map.ts directly (no build step, no tsx)', () => {
    const source = readFileSync(join(REPO_ROOT, 'tools/levels/compile-level.ts'), 'utf8');
    expect(source).toMatch(/from '\.\.\/\.\.\/src\/sim\/map\.ts'/);
    const imports = source.split('\n').filter((line) => /^import |^} from /.test(line));
    expect(imports.join('\n')).not.toMatch(/'three'|src\/render|tsx/);
  });

  it('logs "0 sources" and exits 0 for an empty source directory', () => {
    const r = runCli(['--src', tempDir(), '--out', tempDir()]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('0 sources; nothing to compile');
  });

  it('agrees with the levels in the repo (npm run levels)', () => {
    const pairs = listLevelPairs(join(REPO_ROOT, 'assets-src/levels'));
    const out = tempDir();
    const r = runCli(['--out', out]);
    expect(r.status, r.stderr).toBe(0);
    if (pairs.names.length === 0) expect(r.stdout).toContain('0 sources; nothing to compile');
    else expect(r.stdout).toContain(`${pairs.names.length} compiled, 0 failed`);
  });

  it('exits 2 on a bad argument', () => {
    const r = runCli(['--bogus']);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('unrecognised argument: --bogus');
  });

  it('reports a map without its level.json (and vice versa) as L000', () => {
    const src = tempDir();
    writeFileSync(join(src, 'lonely.map.txt'), '.\n');
    writeFileSync(join(src, 'other.level.json'), '{}\n');
    const errors: string[] = [];
    const status = runCompileLevel(['--src', src, '--out', tempDir()], REPO_ROOT, REPO_ROOT, {
      log: () => {},
      error: (l) => errors.push(l),
    });
    expect(status).toBe(1);
    expect(errors).toEqual([
      'lonely.map.txt:1:1 L000 no matching lonely.level.json',
      'other.level.json:1:1 L000 no matching other.map.txt',
    ]);
  });
});

describe('one failing fixture per implemented code', () => {
  const cases = [
    ['l000_schema', 'l000_schema.level.json:27:3 L000 colour is not a level.json field (schema.ts)'],
    ['l001_size', 'l001_size.map.txt:2:8 L001 row has 7 columns; level.json size says 8'],
    ['l002_unknown', 'l002_unknown.map.txt:2:4 L002 unknown character "*": not in the legend'],
    ['l003_start', 'l003_start.map.txt:4:3 L003 @ lies outside depot.rect [0, 4, 8, 1]'],
    ['l004_storeys', 'l004_storeys.level.json:21:7 L004 building A storeys 7 is outside 1–6'],
    [
      'l005_music',
      'l005_music.level.json:27:3 L005 music "puddle_lane" is not a canonical id (must match /^mus\\.[a-z0-9_]+$/)',
    ],
    ['l006_timer', 'l006_timer.level.json:9:3 L006 timer is 200; a shift level must use 240'],
    [
      'l010_disconnected',
      'l010_disconnected.map.txt:1:7 L010 drivable area of 4 tile(s) not reachable from @',
    ],
    ['l013_isolated', 'l013_isolated.map.txt:1:7 L013 isolated road tile'],
  ] as const;

  it.each(cases)('%s fails with the exact file:row:col message and a non-zero exit', (fixture, expected) => {
    const out = tempDir();
    const r = runCli(['--src', `${FIXTURES}/${fixture}`, '--manifest', MANIFEST, '--out', out]);
    expect(r.status).toBe(1);
    expect(r.stderr.trimEnd().split('\n')).toEqual([expected]);
    expect(r.stdout).toContain('0 compiled, 1 failed');
    expect(listLevelPairs(join(out, 'public/assets/levels')).names).toEqual([]);
  });

  it('every message has the <file>:<row>:<col> Lnnn shape', () => {
    for (const [, expected] of cases)
      expect(expected).toMatch(/^[a-z0-9_]+\.(map\.txt|level\.json):\d+:\d+ L\d{3} /);
  });
});

describe('the valid fixture', () => {
  const read = (f: string): string => readFileSync(join(REPO_ROOT, FIXTURES, 'valid', f), 'utf8');
  const out = (): NonNullable<CompileResult['output']> =>
    ok(
      compileLevel({
        name: 'valid',
        mapText: read('valid.map.txt'),
        levelText: read('valid.level.json'),
        knownAssetIds: KNOWN,
      }),
    );

  it('merges same-letter buildings that touch and keeps different letters and separate blobs apart', () => {
    const { buildings } = out();
    expect(buildings.map((b) => [b.letter, b.bounds, b.cells])).toEqual([
      ['A', [0, 0, 4, 2], 8],
      ['B', [4, 0, 8, 2], 8],
      ['C', [10, 0, 16, 2], 12],
      ['A', [16, 0, 20, 2], 8],
    ]);
  });

  it('writes storeys, roof and wall columns against sorted style tables', () => {
    const { level } = out();
    expect(level.roofIds).toEqual(['roof.depot', 'roof.felt', 'roof.slate']);
    expect(level.wallIds).toEqual(['facade.corner_shop', 'facade.terrace_brick', 'facade.terrace_brick_bay']);
    expect(layerRows(level.layers.storeys, 20).slice(0, 3)).toEqual([
      '22223333008888882222',
      '22223333008888882222',
      '00000000000000000000',
    ]);
    expect(layerRows(level.layers.roof, 20)[0]).toBe('33332222001111113333');
    expect(layerRows(level.layers.wall, 20)[0]).toBe('22221111003333332222');
  });

  it('resolves ground, surface and route (alley 2 wide is route; grass, apron and solids are not)', () => {
    const { level } = out();
    expect(layerRows(level.layers.ground, 20)).toEqual([
      '00000000880000000000',
      '00000000880000000000',
      '66666666666666666666',
      '11111111111111111111',
      '11111111111111111111',
      '66666666666666666666',
      '66966666bbbbbbbbbbbb',
      '99999666bbbbbbbbbbbb',
      '99999666bbbbbbbbbbbb',
      '99999666bbbbbbbbbbbb',
      'c9999666bbbbbbbbbbbb',
      'cccccccccccccccccccc',
    ]);
    expect(layerRows(level.layers.route, 20)).toEqual([
      '00000000110000000000',
      '00000000110000000000',
      '11111111111111111111',
      '11111111111111111111',
      '11111111111111111111',
      '11111111111111111111',
      '00000010000000000000',
      '00000010000000000000',
      '00000010000000000000',
      '00000110000000000000',
      '00000010000000000000',
      '00000000000000000000',
    ]);
    expect(layerRows(level.layers.surface, 20)[7]).toBe('22222111000000000000');
  });

  it('leaves autotile 255, collide and the M2 layers zero, and stubs the graphs', () => {
    const { level } = out();
    expect(level.layers.autotile.every((v) => v === AUTOTILE_NONE)).toBe(true);
    for (const name of ['collide', 'grimeDensity', 'gutter'] as const) {
      expect(level.layers[name].every((v) => v === 0)).toBe(true);
    }
    expect(level.solids).toEqual([]);
    expect(level.frontages).toEqual([]);
    expect(level.lanes).toEqual({ nodes: [], edges: [] });
    expect(level.nav).toEqual({ nodes: [], edges: [] });
    expect(level.spawns).toEqual({});
    expect(level.schedules).toEqual([]);
  });

  it('extracts props (tile centres in metres), sites (merged rects), anchors and the start', () => {
    const { level, anchors } = out();
    expect(level.props.slice(0, 2)).toEqual([
      { id: 'prop.lamp_post', x: 5, y: 5, rot: 0 },
      { id: 'prop.litter_bin', x: 13, y: 5, rot: 0 },
    ]);
    expect(level.props.map((p) => p.id)).toEqual([
      'prop.lamp_post',
      'prop.litter_bin',
      'prop.post_box',
      'prop.lamp_post',
      'prop.hydrant',
      'prop.lamp_post',
      'prop.tree',
      'prop.bench',
      'prop.tree',
    ]);
    expect(level.sites).toEqual([
      { id: 'haz.speed_bump', rect: [4, 3, 5, 5] },
      { id: 'site.zebra', rect: [9, 3, 11, 5] },
      { id: 'site.depot_bay', rect: [9, 7, 11, 10] },
      { id: 'site.depot_bay', rect: [12, 7, 14, 10] },
      { id: 'site.skip', rect: [16, 7, 18, 8] },
    ]);
    expect(anchors).toEqual([
      { char: '1', name: 'doris_home', tile: [4, 2] },
      { char: '2', name: 'zebra_s', tile: [14, 5] },
    ]);
    expect(level.player).toEqual({ x: 35, y: 19, heading: Math.PI / 2 });
    expect(level.weather).toBe('clear');
    expect(level.timerS).toBe(240);
  });
});

describe('music and ambience', () => {
  it('copies music and ambience into the compiled header with their exact values', () => {
    const text = readFileSync(join(REPO_ROOT, FIXTURES, 'valid/valid.map.txt'), 'utf8');
    const levelText = readFileSync(join(REPO_ROOT, FIXTURES, 'valid/valid.level.json'), 'utf8');
    const { text: json } = ok(
      compileLevel({ name: 'valid', mapText: text, levelText, knownAssetIds: KNOWN }),
    );
    const root = JSON.parse(json) as Record<string, unknown>;
    expect(root.music).toBe('mus.puddle_lane');
    expect(root.ambience).toBe('amb.town_morning');
    expect(Object.keys(root).slice(-5)).toEqual(['weather', 'timerS', 'music', 'ambience', 'player']);
  });

  it('omits both keys when level.json names neither', () => {
    const read = (f: string): string => readFileSync(join(REPO_ROOT, FIXTURES, 'no_audio', f), 'utf8');
    const { text, level } = ok(
      compileLevel({
        name: 'no_audio',
        mapText: read('no_audio.map.txt'),
        levelText: read('no_audio.level.json'),
        knownAssetIds: KNOWN,
      }),
    );
    const root = JSON.parse(text) as Record<string, unknown>;
    expect('music' in root).toBe(false);
    expect('ambience' in root).toBe(false);
    expect('music' in level).toBe(false);
  });

  it('fails a malformed id with an L005-format message', () => {
    const rows = ['@.'];
    expect(messages(compileInline(rows, { music: 'puddle_lane' }))).toEqual([
      expect.stringMatching(/^t\.level\.json:\d+:3 L005 music "puddle_lane" is not a canonical id/),
    ]);
    expect(messages(compileInline(rows, { ambience: 'mus.town_morning' }))).toEqual([
      expect.stringMatching(/^t\.level\.json:\d+:3 L005 ambience "mus\.town_morning"/),
    ]);
    expect(ok(compileInline(rows, { ambience: 'amb.town_morning' })).level.ambience).toBe('amb.town_morning');
  });
});

describe('ground inheritance (LEVEL_DESIGN §8.3)', () => {
  it('takes the most common plain-ground neighbour, ties going to pavement', () => {
    expect(inheritGround([Ground.Road, Ground.Pavement])).toBe(Ground.Pavement);
    expect(inheritGround([Ground.Grass, Ground.Grass, Ground.Pavement, Ground.Pavement])).toBe(
      Ground.Pavement,
    );
    expect(inheritGround([Ground.Road, Ground.Road, Ground.Pavement])).toBe(Ground.Road);
    expect(inheritGround([Ground.Grass, Ground.Road])).toBe(Ground.Road);
    expect(inheritGround([])).toBe(Ground.Pavement);
  });

  it('gives prop and site chars a tied ground of pavement on a real map', () => {
    // The lamp post at (1, 1) sees road to the north, pavement to the south and walls east and west (not
    // plain ground): one road, one pavement, a tie → pavement. The hydrant at (1, 3) sees two pavement
    // tiles and one road → pavement; the bin at (3, 1) sees road on three sides → road.
    const rows = ['#####', 'wlwi#', '.....', '.h@..', '#####'];
    const { level } = ok(compileInline(rows));
    expect(level.layers.ground[1 * 5 + 1]).toBe(Ground.Pavement);
    expect(level.layers.ground[3 * 5 + 1]).toBe(Ground.Pavement);
    expect(level.layers.ground[1 * 5 + 3]).toBe(Ground.Road);
    expect(level.layers.surface[1 * 5 + 3]).toBe(Surface.Asphalt);
  });

  it('counts only plain ground characters (not props, sites or road features)', () => {
    // The skip at (1, 1) has a zebra north, bins east and west and pavement south: only the pavement counts.
    const rows = ['#z#', 'isi', '.@.'];
    expect(ok(compileInline(rows)).level.layers.ground[4]).toBe(Ground.Pavement);
    const grass = ['iti', ',@,'];
    // The start at (1, 1) sees grass east and west and a tree north: grass.
    expect(ok(compileInline(grass)).level.layers.ground[4]).toBe(Ground.Grass);
  });
});

describe('building merge (LEVEL_DESIGN §8.2 rule 4)', () => {
  const B = { storeys: 3, roof: 'roof.felt', wall: 'facade.corner_shop', use: 'shop' };

  it('merges orthogonally touching same letters, not diagonal ones, and never different letters', () => {
    // A(2, 2) touches the first A blob only diagonally; B(1..2, 3) touches A(2, 2) but is another letter;
    // the two A columns on the east edge are split by the start.
    const rows = ['AA..B.A', 'AA..B.A', '..A...@', '.BB...A', '.......'];
    const { buildings, map } = ok(compileInline(rows, { buildings: { A: BUILDING_A, B } }));
    expect(buildings.map((b) => [b.letter, b.bounds, b.cells])).toEqual([
      ['A', [0, 0, 2, 2], 4],
      ['B', [4, 0, 5, 2], 2],
      ['A', [6, 0, 7, 2], 2],
      ['A', [2, 2, 3, 3], 1],
      ['B', [1, 3, 3, 4], 2],
      ['A', [6, 3, 7, 4], 1],
    ]);
    expect(map.building[0]).toBe(0);
    expect(map.building[1 * 7 + 1]).toBe(0);
    expect(map.building[2 * 7 + 2]).toBe(3);
    expect(map.building[3 * 7 + 2]).toBe(4);
    expect(map.building[2 * 7 + 3]).toBe(-1);
  });
});

describe('L001 map format', () => {
  const rows = ['....', '..@.'];
  const lines = (text: string): string[] => messages(compileInline(rows, {}, text));

  it('rejects tabs, CR, non-ASCII, trailing whitespace and a missing final newline', () => {
    expect(lines('..\t.\n..@.\n')).toContain(
      't.map.txt:1:3 L001 tab character (maps use one ASCII character per tile)',
    );
    expect(lines('....\r\n..@.\n')).toContain('t.map.txt:1:5 L001 CR character (use LF line endings)');
    expect(lines('..é.\n..@.\n')).toEqual(['t.map.txt:1:3 L001 non-ASCII character U+00E9']);
    expect(lines('... \n..@.\n')).toEqual(['t.map.txt:1:4 L001 trailing whitespace']);
    expect(lines('....\n..@.')).toEqual(['t.map.txt:2:5 L001 missing final newline']);
  });

  it('rejects the wrong row count, blank lines and short or long rows', () => {
    expect(lines('....\n..@.\n....\n')).toEqual([
      't.map.txt:3:1 L001 map has 3 rows; level.json size says 2',
    ]);
    expect(lines('....\n')).toEqual(['t.map.txt:2:1 L001 map has 1 rows; level.json size says 2']);
    expect(lines('....\n\n')).toEqual(['t.map.txt:2:1 L001 row has 0 columns; level.json size says 4']);
    expect(lines('.....\n..@.\n')).toEqual(['t.map.txt:1:5 L001 row has 5 columns; level.json size says 4']);
  });
});

describe('L002 characters and the legend', () => {
  it('rejects building letters and anchor digits that level.json does not define', () => {
    expect(messages(compileInline(['@.Z']))).toEqual([
      't.map.txt:1:3 L002 unknown character "Z": not in level.json buildings',
    ]);
    expect(messages(compileInline(['@.7']))).toEqual([
      't.map.txt:1:3 L002 unknown character "7": not in level.json anchors',
    ]);
    expect(ok(compileInline(['@.7'], { anchors: { '7': 'lamp_corner' } })).anchors).toEqual([
      { char: '7', name: 'lamp_corner', tile: [2, 0] },
    ]);
  });

  it('lets a level add and override entries', () => {
    const rows = ['@*.', '###'];
    const out = ok(
      compileInline(rows, {
        legend: { '*': { ground: 'cobbles', prop: 'prop.planter' }, '.': { ground: 'yard' } },
      }),
    );
    expect(out.level.layers.ground[1]).toBe(Ground.Cobbles);
    expect(out.level.layers.ground[2]).toBe(Ground.Yard);
    expect(out.level.props).toEqual([{ id: 'prop.planter', x: 3, y: 1, rot: 0 }]);
  });

  it('refuses to redefine A–Z, 0–9 or @, and checks entry shapes', () => {
    const result = compileInline(['@.'], {
      legend: {
        A: { ground: 'road' },
        '3': { ground: 'road' },
        '@': { ground: 'road' },
        '*': { ground: 'lava' },
      },
    });
    expect(messages(result).map((m) => m.replace(/^t\.level\.json:\d+:\d+ /, ''))).toEqual([
      // JSON.stringify writes the integer-like key "3" first, and messages are sorted by location.
      'L002 legend may not redefine "3" (A–Z, 0–9 and @ are reserved)',
      'L002 legend may not redefine "A" (A–Z, 0–9 and @ are reserved)',
      'L002 legend may not redefine "@" (A–Z, 0–9 and @ are reserved)',
      expect.stringMatching(/^L000 legend "\*" ground must be one of void, road/),
    ]);
  });

  it('keeps every default legend character non-reserved and single', () => {
    for (const char of Object.keys(DEFAULT_LEGEND)) {
      expect(char).toHaveLength(1);
      expect(char).not.toMatch(/[A-Z0-9@]/);
    }
  });
});

describe('L003 start', () => {
  it('requires exactly one @', () => {
    expect(messages(compileInline(['..', '..']))).toEqual([
      't.map.txt:1:1 L003 no @ start in the map (exactly one is required)',
    ]);
    expect(messages(compileInline(['@.', '.@']))).toEqual(['t.map.txt:2:2 L003 more than one @ (2 found)']);
  });
});

describe('L004 buildings', () => {
  const rows = ['AA@'];
  const withA = (a: Record<string, unknown>): string[] =>
    messages(compileInline(rows, { buildings: { A: a } }));

  it('allows 1–6 storeys, up to 8 for a landmark', () => {
    expect(withA({ ...BUILDING_A, storeys: 6 })).toEqual([]);
    expect(withA({ ...BUILDING_A, storeys: 8, landmark: true })).toEqual([]);
    expect(withA({ ...BUILDING_A, storeys: 0 })).toEqual([
      expect.stringMatching(/L004 building A storeys 0 is outside 1–6$/),
    ]);
    expect(withA({ ...BUILDING_A, storeys: 9, landmark: true })).toEqual([
      expect.stringMatching(/L004 building A storeys 9 is outside 1–8 for a landmark$/),
    ]);
    expect(withA({ ...BUILDING_A, storeys: 2.5 })).toEqual([
      expect.stringMatching(/L004 building A storeys 2.5/),
    ]);
  });

  it('requires roof.* and facade.* ids that exist in the manifest', () => {
    expect(withA({ ...BUILDING_A, roof: 'roof.thatch' })).toEqual([
      expect.stringMatching(
        /^t\.level\.json:\d+:\d+ L004 building A roof roof\.thatch is not in assets-src\/manifest\.json$/,
      ),
    ]);
    expect(withA({ ...BUILDING_A, wall: 'facade.glass_tower' })).toEqual([
      expect.stringMatching(/L004 building A wall facade\.glass_tower is not in assets-src\/manifest\.json$/),
    ]);
    expect(withA({ ...BUILDING_A, roof: 'facade.terrace_brick' })).toEqual([
      expect.stringMatching(/L000 building A roof must be a roof\.\* id$/),
    ]);
  });
});

describe('L006 timer', () => {
  it('requires 240 s for a shift and 45 s for the Skip Run', () => {
    const rows = ['@.'];
    expect(messages(compileInline(rows, { mode: 'skip_run', timer: 45 }))).toEqual([]);
    expect(messages(compileInline(rows, { mode: 'skip_run', timer: 240 }))).toEqual([
      expect.stringMatching(/L006 timer is 240; a skip_run level must use 45$/),
    ]);
    expect(messages(compileInline(rows, { timer: 45 }))).toEqual([
      expect.stringMatching(/L006 timer is 45; a shift level must use 240$/),
    ]);
  });
});

describe('L010 drivable connectivity and alleys', () => {
  it('treats a 1-wide alley as a footway (not drivable, not route) and a 2-wide alley as drivable', () => {
    const rows = ['.;;.', '.;;.', '....', '.;..', '@...'];
    const { level, map } = ok(compileInline(rows));
    expect(layerRows(map.drivable, 4)).toEqual(['1111', '1111', '1111', '1011', '1111']);
    expect(layerRows(level.layers.route, 4)[3]).toBe('1011');
  });

  it('fails a region cut off by a 1-wide footway, and a start on a non-drivable tile', () => {
    expect(messages(compileInline(['@.;..']))).toEqual([
      't.map.txt:1:4 L010 drivable area of 2 tile(s) not reachable from @',
    ]);
    expect(messages(compileInline(['~@~', '~~~', '...']))).toEqual([
      't.map.txt:1:2 L010 @ is not on a drivable tile',
      't.map.txt:3:1 L010 drivable area of 3 tile(s) not reachable from @',
    ]);
  });

  it('does not count buildings, walls, water, sand or void as drivable', () => {
    const rows = ['@Awe~_ r.', '.........'];
    const { map } = ok(compileInline(rows));
    expect(layerRows(map.drivable, 9)).toEqual(['100000001', '111111111']);
  });
});

describe('L013 isolated road', () => {
  it('flags a road tile with no orthogonal road neighbour (road features and one-ways count as road)', () => {
    expect(messages(compileInline(['@.#.', '....']))).toEqual(['t.map.txt:1:3 L013 isolated road tile']);
    expect(messages(compileInline(['@.#.', '..z.']))).toEqual([]);
    expect(messages(compileInline(['@.>.', '..#.']))).toEqual([]);
    expect(messages(compileInline(['@#..', '..#.']))).toEqual([
      't.map.txt:1:2 L013 isolated road tile',
      't.map.txt:2:3 L013 isolated road tile',
    ]);
  });
});

describe('level.json guards (L000)', () => {
  it('reports invalid JSON with a location', () => {
    const r = compileLevel({
      name: 't',
      mapText: '@\n',
      levelText: '{\n  "schema": 1,\n}\n',
      knownAssetIds: KNOWN,
    });
    expect(messages(r)).toEqual([expect.stringMatching(/^t\.level\.json:\d+:\d+ L000 not valid JSON/)]);
  });

  it('requires the pair map name, a district id and a depot inside the map', () => {
    const rows = ['@.'];
    expect(messages(compileInline(rows, { map: 'other.map.txt' }))).toEqual([
      expect.stringMatching(/L000 map must be "t\.map\.txt"/),
    ]);
    expect(messages(compileInline(rows, { id: 'puddle_lane' }))).toEqual([
      expect.stringMatching(/L000 id must be a district\.<snake_name> id$/),
    ]);
    expect(messages(compileInline(rows, { depot: { rect: [1, 0, 2, 1] } }))).toEqual([
      expect.stringMatching(/L000 depot rect \[1, 0, 2, 1\] must have w, h ≥ 1 and lie inside the map$/),
    ]);
  });

  it('keeps pledges, litter and grime optional until M2 but checks their shape when present', () => {
    const rows = ['@.'];
    expect(
      messages(compileInline(rows, { pledges: ['fr_1_1'], litter: { initial: 0 }, grime: { cells: 0 } })),
    ).toEqual([]);
    expect(messages(compileInline(rows, { pledges: 'fr_1_1' }))).toEqual([
      expect.stringMatching(/L000 pledges must be an array of frontage ids$/),
    ]);
  });

  it('converts start.heading 0..31 to radians and rejects others', () => {
    expect(ok(compileInline(['@.'], { start: { heading: 16 } })).level.player.heading).toBe(Math.PI);
    expect(messages(compileInline(['@.'], { start: { heading: 32 } }))).toEqual([
      expect.stringMatching(/L000 start must be \{ heading: 0\.\.31 \}$/),
    ]);
  });
});

describe('helpers', () => {
  it('locates nested JSON keys by 1-based row and column', () => {
    const text = '{\n  "a": 1,\n  "buildings": {\n    "A": { "storeys": 9 }\n  }\n}\n';
    expect(locateJsonKey(text, ['buildings', 'A', 'storeys'])).toEqual({ row: 4, col: 12 });
    expect(locateJsonKey(text, ['missing'])).toEqual({ row: 1, col: 1 });
  });

  it('parses --out, --src and --manifest in both spellings', () => {
    expect(parseArgs(['--out', 'a', '--src=b', '--manifest', 'c'])).toEqual({
      outDir: 'a',
      srcDir: 'b',
      manifest: 'c',
    });
    expect(parseArgs(['--out'])).toEqual({ error: '--out requires a path argument' });
    expect(parseArgs(['x'])).toEqual({ error: 'unrecognised argument: x' });
  });

  it('compiles deterministically: the same input gives the same text', () => {
    const rows = ['AAAA', '....', '####', '..@.'];
    expect(ok(compileInline(rows)).text).toBe(ok(compileInline(rows)).text);
  });
});
