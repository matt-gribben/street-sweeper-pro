// Compiled-level codec, id tables and solid merge (TECHNICAL_DESIGN §9.1, §15.2; SSP-032).
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { decodeBase64, encodeBase64 } from '../../src/sim/base64.ts';
import {
  AUTOTILE_NONE,
  COLLIDE,
  COLLIDE_ALL_BITS,
  createBlankLevel,
  decodeLevel,
  encodeLevel,
  GROUND_COUNT,
  GROUND_SURFACE,
  Ground,
  GUTTER_CELLS_PER_TILE,
  LAYER_NAMES,
  LEVEL_FORMAT,
  LEVEL_VERSION,
  type Level,
  layerLength,
  MAX_STYLES,
  mergeSolids,
  resolveStyle,
  SURFACE_COUNT,
  Surface,
  surfaceOfGround,
} from '../../src/sim/map.ts';
import { nextU32, sfc32 } from '../../src/sim/rng.ts';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** The canonical top-level key order (TECHNICAL_DESIGN §15.2, with SSP-032's roofIds/wallIds). */
const TOP_LEVEL_KEYS = [
  'format',
  'version',
  'id',
  'size',
  'roofIds',
  'wallIds',
  'layers',
  'solids',
  'props',
  'sites',
  'frontages',
  'lanes',
  'nav',
  'spawns',
  'schedules',
  'weather',
  'timerS',
  'player',
];

/**
 * A hand-built 6 × 4 level with every layer and list populated:
 *
 *   row 0  A A B B . .     A = 2-storey slate/brick terrace, B = 3-storey felt/render
 *   row 1  . . . . . .     pavement, kerb edges on the south side
 *   row 2  # # # # # >     road, then a one-way east tile
 *   row 3  ~ ~ , , % +     water (solid), grass, yard, apron
 */
function handBuiltLevel(): Level {
  const w = 6;
  const h = 4;
  const level = createBlankLevel('district.test_lane', w, h);
  const G = Ground;
  // biome-ignore format: one map row per line
  level.layers.ground.set([
    G.Pavement, G.Pavement, G.Pavement, G.Pavement, G.Pavement, G.Pavement,
    G.Pavement, G.Pavement, G.Pavement, G.Pavement, G.Pavement, G.Pavement,
    G.Road, G.Road, G.Road, G.Road, G.Road, G.RoadOneWayE,
    G.Water, G.Water, G.Grass, G.Grass, G.Yard, G.Apron,
  ]);
  level.layers.ground.forEach((g, i) => {
    level.layers.surface[i] = surfaceOfGround(g);
  });
  level.roofIds = ['roof.slate', 'roof.felt'];
  level.wallIds = ['facade.brick_terrace', 'facade.render_terrace'];
  for (let x = 0; x < 4; x += 1) {
    const b = x < 2 ? 1 : 2;
    level.layers.storeys[x] = b === 1 ? 2 : 3;
    level.layers.roof[x] = b;
    level.layers.wall[x] = b;
    level.layers.collide[x] = COLLIDE.SOLID;
  }
  for (let x = 0; x < w; x += 1) {
    level.layers.collide[1 * w + x] = COLLIDE.KERB_EDGE_S;
    level.layers.collide[2 * w + x] = COLLIDE.KERB_EDGE_N;
    level.layers.autotile[1 * w + x] = x % 47;
    level.layers.route[1 * w + x] = 1;
    level.layers.route[2 * w + x] = 1;
    level.layers.grimeDensity[2 * w + x] = 40 + x;
  }
  level.layers.collide[3 * w] = COLLIDE.SOLID;
  level.layers.collide[3 * w + 1] = COLLIDE.SOLID;
  for (let i = 0; i < level.layers.gutter.length; i += 7) level.layers.gutter[i] = (i * 13) & 255;
  level.solids = mergeSolids(level.layers.collide, w, h);
  level.props = [
    { id: 'prop.hydrant', x: 9, y: 3, rot: 0 },
    { id: 'prop.lamp_post', x: 1.5, y: 2.25, rot: Math.PI / 2 },
  ];
  level.sites = [{ id: 'site.depot_bay', rect: [4, 3, 6, 4] }];
  level.frontages = [{ id: 'fr_0_0', pledge: true, rect: [0, 0, 2, 1], face: 's' }];
  level.lanes = {
    nodes: [
      [1, 5],
      [11, 5],
    ],
    edges: [[0, 1, 13.4, 0]],
  };
  level.nav = {
    nodes: [
      [1, 3],
      [11, 3],
    ],
    edges: [
      [0, 1, 0],
      [1, 0, 0],
    ],
  };
  level.spawns = {
    npc: [{ id: 'npc.old_woman', anchor: 'doris_home' }],
    litter: [{ table: { 'litter.crisp_packet': 3 } }],
  };
  level.schedules = [{ npc: 'npc.old_woman', at: 12, route: ['doris_home', 'shop'] }];
  level.weather = 'rain';
  level.timerS = 240;
  level.player = { x: 10, y: 3, heading: (3 * Math.PI) / 2 };
  return level;
}

describe('id tables', () => {
  it('ground ids are unique, dense from 0 and cover every LEVEL_DESIGN §8.3 ground', () => {
    const values = Object.values(Ground);
    expect(new Set(values).size).toBe(values.length);
    expect([...values].sort((a, b) => a - b)).toEqual([...Array(GROUND_COUNT).keys()]);
    expect(Object.keys(Ground)).toEqual([
      'Void',
      'Road',
      'RoadOneWayE',
      'RoadOneWayW',
      'RoadOneWayN',
      'RoadOneWayS',
      'Pavement',
      'Cobbles',
      'Alley',
      'Grass',
      'Yard',
      'Apron',
      'Water',
      'Sand',
    ]);
    expect(Ground.Void).toBe(0);
  });

  it('surface ids are unique and dense from 0, with the M3 hazard surfaces reserved', () => {
    const values = Object.values(Surface);
    expect([...values].sort((a, b) => a - b)).toEqual([...Array(SURFACE_COUNT).keys()]);
    expect(Object.keys(Surface)).toEqual(['Asphalt', 'Pavement', 'Grass', 'Puddle', 'WetLeaves', 'Oil']);
  });

  it('maps every ground to a surface with the §8.3 grip rules', () => {
    expect(GROUND_SURFACE).toHaveLength(GROUND_COUNT);
    for (const g of Object.values(Ground)) expect(GROUND_SURFACE[g]).toBeLessThan(SURFACE_COUNT);
    expect(surfaceOfGround(Ground.Road)).toBe(Surface.Asphalt);
    for (const g of [Ground.RoadOneWayE, Ground.RoadOneWayW, Ground.RoadOneWayN, Ground.RoadOneWayS]) {
      expect(surfaceOfGround(g)).toBe(Surface.Asphalt);
    }
    expect(surfaceOfGround(Ground.Pavement)).toBe(Surface.Pavement);
    expect(surfaceOfGround(Ground.Cobbles)).toBe(Surface.Asphalt);
    expect(surfaceOfGround(Ground.Apron)).toBe(Surface.Asphalt);
    expect(surfaceOfGround(Ground.Yard)).toBe(Surface.Pavement);
    expect(surfaceOfGround(Ground.Grass)).toBe(Surface.Grass);
    expect(() => surfaceOfGround(GROUND_COUNT)).toThrow(/unknown ground id/);
  });

  it('collide bits are distinct single bits', () => {
    const bits = Object.values(COLLIDE);
    expect(Object.keys(COLLIDE)).toEqual([
      'SOLID',
      'KERB_EDGE_N',
      'KERB_EDGE_E',
      'KERB_EDGE_S',
      'KERB_EDGE_W',
    ]);
    for (const bit of bits) expect(bit & (bit - 1)).toBe(0);
    expect(bits.reduce((a, b) => a | b, 0)).toBe(COLLIDE_ALL_BITS);
    expect(bits.reduce((a, b) => a + b, 0)).toBe(COLLIDE_ALL_BITS);
  });

  it('resolves roof/wall layer values through the header string tables', () => {
    const roofIds = ['roof.slate', 'roof.felt'];
    expect(resolveStyle(roofIds, 0)).toBeNull();
    expect(resolveStyle(roofIds, 1)).toBe('roof.slate');
    expect(resolveStyle(roofIds, 2)).toBe('roof.felt');
    expect(() => resolveStyle(roofIds, 3)).toThrow(/not in a 2-entry table/);
  });

  it('sizes the gutter layer at 8 × 8 grime cells per tile', () => {
    expect(GUTTER_CELLS_PER_TILE).toBe(8);
    expect(layerLength('gutter', 64, 48)).toBe(512 * 384);
    expect(layerLength('ground', 64, 48)).toBe(64 * 48);
  });
});

describe('base64', () => {
  it('matches the RFC 4648 §10 test vectors', () => {
    const vectors: [string, string][] = [
      ['', ''],
      ['f', 'Zg=='],
      ['fo', 'Zm8='],
      ['foo', 'Zm9v'],
      ['foob', 'Zm9vYg=='],
      ['fooba', 'Zm9vYmE='],
      ['foobar', 'Zm9vYmFy'],
    ];
    for (const [plain, encoded] of vectors) {
      const bytes = new TextEncoder().encode(plain);
      expect(encodeBase64(bytes)).toBe(encoded);
      expect(decodeBase64(encoded)).toEqual(bytes);
    }
  });

  it("agrees with Node's Buffer on random arrays of every length up to 300 and on a gutter-sized layer", () => {
    const rng = sfc32(32);
    for (const length of [...Array(301).keys(), 512 * 384]) {
      const bytes = new Uint8Array(length);
      for (let i = 0; i < length; i += 1) bytes[i] = nextU32(rng) & 255;
      const encoded = encodeBase64(bytes);
      expect(encoded).toBe(Buffer.from(bytes).toString('base64'));
      expect(decodeBase64(encoded)).toEqual(bytes);
    }
  });

  it('rejects malformed input', () => {
    expect(() => decodeBase64('Zm9')).toThrow(/multiple of 4/);
    expect(() => decodeBase64('Zm9v\n')).toThrow();
    expect(() => decodeBase64('Zm-v')).toThrow(/invalid character/);
    expect(() => decodeBase64('Z===')).toThrow(/invalid character/);
    expect(() => decodeBase64('Zm=v')).toThrow(/invalid character/);
    expect(() => decodeBase64('Zh==')).toThrow(/non-zero bits/);
    expect(() => decodeBase64('Zm9=')).toThrow(/non-zero bits/);
    expect(() => decodeBase64('Zm9vé===')).toThrow();
  });
});

describe('encodeLevel / decodeLevel', () => {
  it('round-trips every layer and list exactly', () => {
    const level = handBuiltLevel();
    const decoded = decodeLevel(encodeLevel(level));
    expect(decoded).toEqual(level);
    for (const name of LAYER_NAMES) {
      expect(decoded.layers[name]).toBeInstanceOf(Uint8Array);
      expect(decoded.layers[name]).toEqual(level.layers[name]);
    }
    expect(decoded.player.heading).toBe((3 * Math.PI) / 2);
    expect(decoded.props[1]?.rot).toBe(Math.PI / 2);
  });

  it('re-encodes a decoded level byte-identically, from text or from parsed JSON', () => {
    const text = encodeLevel(handBuiltLevel());
    expect(encodeLevel(decodeLevel(text))).toBe(text);
    expect(encodeLevel(decodeLevel(JSON.parse(text)))).toBe(text);
    expect(encodeLevel(handBuiltLevel())).toBe(text);
  });

  it('writes the canonical key order, the format tag and version, and a trailing newline', () => {
    const text = encodeLevel(handBuiltLevel());
    const parsed: unknown = JSON.parse(text);
    expect(typeof parsed === 'object' && parsed !== null).toBe(true);
    const root = parsed as Record<string, unknown>;
    expect(Object.keys(root)).toEqual(TOP_LEVEL_KEYS);
    expect(Object.keys(root.layers as object)).toEqual([...LAYER_NAMES]);
    expect(root.format).toBe(LEVEL_FORMAT);
    expect(root.version).toBe(LEVEL_VERSION);
    expect(text.endsWith('}\n')).toBe(true);
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it('encodes opaque spawn and schedule entries in one canonical key order', () => {
    const a = handBuiltLevel();
    const b = handBuiltLevel();
    b.spawns = {
      litter: [{ table: { 'litter.crisp_packet': 3 } }],
      npc: [{ anchor: 'doris_home', id: 'npc.old_woman' }],
    };
    b.schedules = [{ route: ['doris_home', 'shop'], at: 12, npc: 'npc.old_woman' }];
    expect(encodeLevel(b)).toBe(encodeLevel(a));
  });

  it('pins the exact text layout of a tiny level', () => {
    const level = createBlankLevel('district.tiny', 2, 1);
    level.layers.ground.set([Ground.Road, Ground.Pavement]);
    level.layers.surface.set([Surface.Asphalt, Surface.Pavement]);
    level.solids = [[0, 0, 1, 1]];
    level.props = [{ id: 'prop.bollard', x: 3, y: 1, rot: 0 }];
    level.player = { x: 1, y: 1, heading: 0 };
    const gutter = encodeBase64(new Uint8Array(16 * 8));
    expect(encodeLevel(level)).toBe(
      [
        '{',
        '  "format": "ssp.level",',
        '  "version": 1,',
        '  "id": "district.tiny",',
        '  "size": [2,1],',
        '  "roofIds": [],',
        '  "wallIds": [],',
        '  "layers": {',
        '    "ground": "AQY=",',
        '    "autotile": "//8=",',
        '    "surface": "AAE=",',
        '    "storeys": "AAA=",',
        '    "roof": "AAA=",',
        '    "wall": "AAA=",',
        '    "collide": "AAA=",',
        '    "route": "AAA=",',
        '    "grimeDensity": "AAA=",',
        `    "gutter": "${gutter}"`,
        '  },',
        '  "solids": [',
        '    [0,0,1,1]',
        '  ],',
        '  "props": [',
        '    {"id":"prop.bollard","x":3,"y":1,"rot":0}',
        '  ],',
        '  "sites": [],',
        '  "frontages": [],',
        '  "lanes": {',
        '    "nodes": [],',
        '    "edges": []',
        '  },',
        '  "nav": {',
        '    "nodes": [],',
        '    "edges": []',
        '  },',
        '  "spawns": {},',
        '  "schedules": [],',
        '  "weather": "clear",',
        '  "timerS": 240,',
        '  "player": {',
        '    "x": 1,',
        '    "y": 1,',
        '    "heading": 0',
        '  }',
        '}',
        '',
      ].join('\n'),
    );
  });

  it('starts a blank level empty: void ground, no autotile, nothing solid, campaign timer', () => {
    const level = createBlankLevel('district.blank', 3, 2);
    expect(level.layers.ground.every((v) => v === Ground.Void)).toBe(true);
    expect(level.layers.autotile.every((v) => v === AUTOTILE_NONE)).toBe(true);
    expect(level.layers.gutter).toHaveLength(24 * 16);
    expect(level.timerS).toBe(240);
    expect(() => createBlankLevel('district.bad', 0, 2)).toThrow(/invalid size/);
  });

  it('refuses to encode a malformed level', () => {
    const shortLayer = handBuiltLevel();
    shortLayer.layers.route = new Uint8Array(3);
    expect(() => encodeLevel(shortLayer)).toThrow(/layer route has 3 bytes, expected 24/);

    const badRoof = handBuiltLevel();
    badRoof.layers.roof[0] = 3;
    expect(() => encodeLevel(badRoof)).toThrow(/roof has 3 at tile \(0, 0\)/);

    const nan = handBuiltLevel();
    nan.player.x = Number.NaN;
    expect(() => encodeLevel(nan)).toThrow(/player\.x is not a finite number/);

    const fractionalRect = handBuiltLevel();
    fractionalRect.solids = [[0, 0, 1.5, 1]];
    expect(() => encodeLevel(fractionalRect)).toThrow(/integer tile coordinates/);

    const tooManyStyles = handBuiltLevel();
    tooManyStyles.roofIds = Array.from({ length: MAX_STYLES + 1 }, (_, i) => `roof.style_${i}`);
    expect(() => encodeLevel(tooManyStyles)).toThrow(/roofIds has 256 entries/);
  });

  it('rejects malformed compiled JSON with a message naming the field', () => {
    const text = encodeLevel(handBuiltLevel());
    const edit = (change: (root: Record<string, unknown>) => void): Record<string, unknown> => {
      const root = JSON.parse(text) as Record<string, unknown>;
      change(root);
      return root;
    };
    const layers = (root: Record<string, unknown>): Record<string, unknown> =>
      root.layers as Record<string, unknown>;

    expect(() => decodeLevel('{')).toThrow(/not valid JSON/);
    expect(() => decodeLevel(edit((r) => (r.format = 'other')))).toThrow(/format must be "ssp.level"/);
    expect(() => decodeLevel(edit((r) => (r.version = 2)))).toThrow(/version must be 1/);
    expect(() => decodeLevel(edit((r) => (r.size = [6])))).toThrow(/size must have 2 entries/);
    expect(() => decodeLevel(edit((r) => (layers(r).ground = 'AAA=')))).toThrow(
      /layers\.ground has 2 bytes, expected 24/,
    );
    expect(() => decodeLevel(edit((r) => (layers(r).ground = '!!!!')))).toThrow(
      /layers\.ground: base64: invalid/,
    );
    expect(() =>
      decodeLevel(edit((r) => (layers(r).ground = encodeBase64(new Uint8Array(24).fill(GROUND_COUNT))))),
    ).toThrow(/layers\.ground has 14 at tile \(0, 0\); not a Ground id/);
    expect(() =>
      decodeLevel(edit((r) => (layers(r).autotile = encodeBase64(new Uint8Array(24).fill(47))))),
    ).toThrow(/autotile has 47/);
    expect(() => decodeLevel(edit((r) => (r.wallIds = ['facade.brick_terrace'])))).toThrow(
      /wall has 2 at tile \(2, 0\)/,
    );
    expect(() =>
      decodeLevel(edit((r) => (layers(r).collide = encodeBase64(new Uint8Array(24).fill(1 << 5))))),
    ).toThrow(/unknown collide bits/);
    expect(() => decodeLevel(edit((r) => (r.solids = [[0, 0, 1]])))).toThrow(
      /solids\[0\] must have 4 entries/,
    );
    expect(() => decodeLevel(edit((r) => (r.props = [{ id: 'prop.bench', x: '1', y: 0, rot: 0 }])))).toThrow(
      /props\[0\]\.x must be a finite number/,
    );
    expect(() =>
      decodeLevel(
        edit((r) => (r.frontages = [{ id: 'fr_0_0', pledge: true, rect: [0, 0, 1, 1], face: 'up' }])),
      ),
    ).toThrow(/frontages\[0\]\.face must be one of n, e, s, w/);
    expect(() => decodeLevel(edit((r) => (r.weather = 'fog')))).toThrow(/weather must be one of/);
    expect(() => decodeLevel(edit((r) => delete r.player))).toThrow(/player must be an object/);
  });
});

describe('mergeSolids', () => {
  const grid = (rows: string[]): { collide: Uint8Array; w: number; h: number } => {
    const w = rows[0]?.length ?? 0;
    const collide = new Uint8Array(w * rows.length);
    rows.forEach((row, y) => {
      for (let x = 0; x < w; x += 1) {
        const c = row.charAt(x);
        collide[y * w + x] =
          c === '#' ? COLLIDE.SOLID : c === 'k' ? COLLIDE.KERB_EDGE_N | COLLIDE.KERB_EDGE_W : 0;
      }
    });
    return { collide, w, h: rows.length };
  };

  it('merges a terrace into one rect with no internal edges', () => {
    const { collide, w, h } = grid(['......', '######', '######', '......']);
    expect(mergeSolids(collide, w, h)).toEqual([[0, 1, 6, 3]]);
  });

  it('merges a vertical wall into one tall rect', () => {
    const { collide, w, h } = grid(['.#.', '.#.', '.#.', '.#.']);
    expect(mergeSolids(collide, w, h)).toEqual([[1, 0, 2, 4]]);
  });

  it('splits an L shape greedily in row-major order, x1/y1 exclusive', () => {
    const { collide, w, h } = grid(['###.', '#...', '#..#']);
    expect(mergeSolids(collide, w, h)).toEqual([
      [0, 0, 3, 1],
      [0, 1, 1, 3],
      [3, 2, 4, 3],
    ]);
  });

  it('ignores kerb-edge bits and returns nothing for an empty grid', () => {
    const { collide, w, h } = grid(['kk.', '.k.']);
    expect(mergeSolids(collide, w, h)).toEqual([]);
    expect(mergeSolids(new Uint8Array(0), 0, 0)).toEqual([]);
  });

  it('gives the same rects on every run', () => {
    const { collide, w, h } = grid(['##.##', '##.##', '.....', '#####']);
    const first = mergeSolids(collide, w, h);
    expect(mergeSolids(collide, w, h)).toEqual(first);
    expect(first).toEqual([
      [0, 0, 2, 2],
      [3, 0, 5, 2],
      [0, 3, 5, 4],
    ]);
  });

  it('rejects a collide layer that does not match the size', () => {
    expect(() => mergeSolids(new Uint8Array(5), 2, 3)).toThrow(/collide has 5 cells, expected 2×3 = 6/);
  });
});

describe('purity and Node type stripping', () => {
  it('map.ts and base64.ts import only from src/sim', () => {
    for (const file of ['src/sim/map.ts', 'src/sim/base64.ts']) {
      const source = readFileSync(`${REPO_ROOT}${file}`, 'utf8');
      const specifiers = [...source.matchAll(/^import\b[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1] ?? '');
      for (const specifier of specifiers) expect(specifier).toMatch(/^\.\/[\w]+\.ts$/);
    }
  });

  it('a tool imports map.ts on plain Node type stripping and round-trips a level', () => {
    const result = spawnSync(process.execPath, ['tools/check-type-strip.ts'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('map.ts solids=[[0,0,3,1]] roundTrip=true');
  });
});
