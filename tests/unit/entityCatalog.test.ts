// src/data/entities.json, its loader (src/sim/entities.ts via src/sim/tuning.ts) and its mirror in
// docs/ENTITY_CATALOG.md (SSP-053). Since SSP-053 the JSON is the source of truth for entity IDs and numbers,
// and ENTITY_CATALOG.md mirrors it (CLAUDE.md §2). This test parses the catalog's §4.1 litter table, §5 stain
// table and the §12/§13 pickup rows, and diffs IDs, names, points, LU, spray times, pickup SFX and districts
// against the JSON, so editing either side alone fails here. It also proves every `sprite` is a real AssetId
// (the sim may import src/gen/assets.ts for types only) and every `sfx` is in the canonical §1.4 list.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import entitiesJson from '../../src/data/entities.json' with { type: 'json' };
import { type AssetId, FRAME } from '../../src/gen/assets.ts';
import {
  COLLECTIBLE_IDS,
  DEFAULT_ENTITIES,
  DISTRICT_IDS,
  type DistrictId,
  ENTITY_IDS,
  type Entities,
  HAZARD_IDS,
  LITTER_IDS,
  loadEntities,
  POWERUP_IDS,
  SFX_IDS,
  STAIN_IDS,
} from '../../src/sim/tuning.ts';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const CATALOG = readFileSync(`${REPO_ROOT}docs/ENTITY_CATALOG.md`, 'utf8');
const GEN_ASSETS = readFileSync(`${REPO_ROOT}src/gen/assets.ts`, 'utf8');

type Json = Record<string, unknown>;

function isJson(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------------------------------------
// Catalog parsing
// ---------------------------------------------------------------------------------------------------------

/** The text of the section that starts at `heading` and ends at the next heading of the same or higher level. */
function section(md: string, heading: string): string {
  const start = md.indexOf(`\n${heading}`);
  if (start < 0) throw new Error(`ENTITY_CATALOG has no heading ${JSON.stringify(heading)}`);
  const level = heading.indexOf(' ');
  const rest = md.slice(start + heading.length + 1);
  const next = rest.search(new RegExp(`\\n#{1,${level}} `));
  return next < 0 ? rest : rest.slice(0, next);
}

/** Table rows of `text` whose first cell is a backticked ID with `prefix`, as trimmed cells (ID unquoted). */
function idRows(text: string, prefix: string): Map<string, string[]> {
  const rows = new Map<string, string[]>();
  for (const line of text.split('\n')) {
    const m = new RegExp(`^\\| \`(${prefix.replace('.', '\\.')}[a-z0-9_]+)\` \\|(.*)\\|$`).exec(line);
    if (!m) continue;
    const id = m[1] ?? '';
    if (rows.has(id)) throw new Error(`ENTITY_CATALOG lists ${id} twice`);
    rows.set(
      id,
      (m[2] ?? '').split('|').map((cell) => cell.trim()),
    );
  }
  return rows;
}

/** §1.2: short district code → district ID. */
function districtCodes(md: string): Map<string, string> {
  const codes = new Map<string, string>();
  for (const m of section(md, '### 1.2 District codes').matchAll(
    /^\| \*\*(\w+)\*\* \| `(district\.\w+)` \|/gm,
  )) {
    codes.set(m[1] ?? '', m[2] ?? '');
  }
  return codes;
}

/** §1.4: the canonical SFX IDs, in order. */
function catalogSfx(md: string): string[] {
  const text = section(md, '### 1.4 SFX notation');
  const paragraph = text.split('\n').find((line) => line.startsWith('SFX are written')) ?? '';
  return [...paragraph.slice(paragraph.indexOf(':')).matchAll(/`([a-z_]+)`/g)].map((m) => m[1] ?? '');
}

const SHIFT_DISTRICTS: readonly DistrictId[] = DISTRICT_IDS.filter((d) => d !== 'district.depot_yard');

/**
 * A Districts cell as a membership list in week order. Bold marks signature districts and is dropped;
 * "All except Yard" is the seven shift districts, "Any" is all eight (ENTITY_CATALOG §1.2), a parenthetical
 * is a note, and a "heavy on …" segment is a density hint. Anything else unrecognised throws.
 */
function parseDistricts(cell: string, codes: Map<string, string>): string[] {
  const members = new Set<string>();
  for (const rawSegment of cell.replaceAll('**', '').split(';')) {
    const segment = rawSegment.replace(/\([^)]*\)/g, '').trim();
    if (segment === '' || segment.startsWith('heavy on ')) continue;
    if (segment === 'All except Yard') {
      for (const d of SHIFT_DISTRICTS) members.add(d);
    } else if (segment === 'Any') {
      for (const d of DISTRICT_IDS) members.add(d);
    } else {
      for (const code of segment.split(',').map((c) => c.trim())) {
        const id = codes.get(code);
        if (id === undefined) throw new Error(`unknown district code ${JSON.stringify(code)} in "${cell}"`);
        members.add(id);
      }
    }
  }
  return DISTRICT_IDS.filter((d) => members.has(d));
}

const plainName = (cell: string): string => cell.replace(/\s*\([^)]*\)/g, '').trim();
const plainNumber = (cell: string): number => Number(cell.replaceAll('**', '').replace(/\s*s$/, ''));

/** Every difference between the catalog text `md` and the loaded `entities`, as readable strings. */
function catalogMismatches(md: string, entities: Entities): string[] {
  const out: string[] = [];
  const check = (what: string, catalog: unknown, json: unknown): void => {
    if (JSON.stringify(catalog) !== JSON.stringify(json)) {
      out.push(`${what}: catalog ${JSON.stringify(catalog)} vs entities.json ${JSON.stringify(json)}`);
    }
  };
  const codes = districtCodes(md);

  // §4.1: | ID | Name | Pts | LU | Technique | Pickup SFX | Districts |
  const litterRows = idRows(section(md, '### 4.1 Stats'), 'litter.');
  check('§4.1 litter IDs', [...litterRows.keys()], [...LITTER_IDS]);
  for (const id of LITTER_IDS) {
    const row = litterRows.get(id);
    if (row === undefined) continue;
    const [name = '', pts = '', lu = '', , sfx = '', districts = ''] = row;
    const e = entities.litter[id];
    check(`${id} name`, plainName(name), e.name);
    check(`${id} pts`, plainNumber(pts), e.pts);
    check(`${id} lu`, plainNumber(lu), e.lu);
    check(`${id} pickup sfx`, sfx.replaceAll('`', ''), e.sfx.pickup);
    check(`${id} districts`, parseDistricts(districts, codes), e.districts);
  }

  // §5: | ID | Name | Pts | Spray | Districts | Notes |
  const stainRows = idRows(section(md, '## 5. Stains (`stain.*`)'), 'stain.');
  check('§5 stain IDs', [...stainRows.keys()], [...STAIN_IDS]);
  for (const id of STAIN_IDS) {
    const row = stainRows.get(id);
    if (row === undefined) continue;
    const [name = '', pts = '', spray = '', districts = ''] = row;
    const e = entities.stains[id];
    check(`${id} name`, plainName(name), e.name);
    check(`${id} pts`, plainNumber(pts), e.pts);
    check(`${id} sprayS`, plainNumber(spray), e.sprayS);
    check(`${id} districts`, parseDistricts(districts, codes), e.districts);
  }

  // §12: | ID | Name | Effect | Duration | Numbers in practice |
  const flask = idRows(section(md, '## 12. Power-ups (`pwr.*`)'), 'pwr.').get('pwr.flask_of_tea') ?? [];
  const tea = entities.powerups['pwr.flask_of_tea'];
  check('pwr.flask_of_tea name', flask[0], tea.name);
  check('pwr.flask_of_tea chain timer ×', Number(/×(\d+)/.exec(flask[1] ?? '')?.[1]), tea.effect.mul);
  check('pwr.flask_of_tea durationS', plainNumber(flask[2] ?? ''), tea.effect.durationS);

  // §13.1: Lost Property is "+250 pts"; the Mon row is | Mon | `collect.false_teeth` | False teeth | owner |.
  const lost = section(md, '### 13.1 Lost Property (one per district)');
  const teeth = entities.collectibles['collect.false_teeth'];
  check('collect.false_teeth pts', Number(/\*\*\+(\d+) pts/.exec(lost)?.[1]), teeth.pts);
  check(
    'collect.false_teeth name',
    /`collect\.false_teeth` \| ([^|]+) \|/.exec(lost)?.[1]?.trim(),
    teeth.name,
  );
  check(
    'collect.false_teeth districts',
    [codes.get(/^\| (\w+) \| `collect\.false_teeth`/m.exec(lost)?.[1] ?? '')],
    [...teeth.districts],
  );

  // §13.2: | `collect.golden_crisp` | rule | **+500 pts.** … |
  const golden =
    idRows(section(md, '### 13.2 Golden Crisp Packet'), 'collect.').get('collect.golden_crisp') ?? [];
  check(
    'collect.golden_crisp pts',
    Number(/\+(\d+) pts/.exec(golden[1] ?? '')?.[1]),
    entities.collectibles['collect.golden_crisp'].pts,
  );
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------------------

/** A deep copy of the committed JSON with `edit` applied to its root object. */
function editedJson(edit: (root: Json) => void): unknown {
  const copy: unknown = structuredClone(entitiesJson);
  if (!isJson(copy)) throw new Error('entities.json is not an object');
  edit(copy);
  return copy;
}

/** A deep copy of the committed JSON with `edit` applied to the entity `id`. */
function editedEntity(id: string, edit: (entity: Json) => void): unknown {
  return editedJson((root) => {
    const entity = root[id];
    if (!isJson(entity)) throw new Error(`no entity ${id}`);
    edit(entity);
  });
}

// ---------------------------------------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------------------------------------

describe('entities.json mirrors ENTITY_CATALOG', () => {
  it('holds the 15 litter and 5 stain IDs plus the three Puddle Lane pickups, and nothing else', () => {
    expect(Object.keys(entitiesJson)).toEqual([...ENTITY_IDS]);
    expect(LITTER_IDS).toHaveLength(15);
    expect(STAIN_IDS).toHaveLength(5);
    expect([...POWERUP_IDS, ...COLLECTIBLE_IDS]).toEqual([
      'pwr.flask_of_tea',
      'collect.false_teeth',
      'collect.golden_crisp',
    ]);
  });

  it('lists exactly the catalog §2 litter and stain IDs', () => {
    const index = section(CATALOG, '## 2. ID index');
    const listed = (cls: string): string[] => {
      const row = new RegExp(`^\\| \`${cls}\` \\| \\d+ \\| (.*) \\|$`, 'm').exec(index)?.[1] ?? '';
      return [...row.matchAll(/`([a-z_]+)`/g)].map((m) => `${cls}.${m[1]}`);
    };
    expect(listed('litter')).toEqual([...LITTER_IDS]);
    expect(listed('stain')).toEqual([...STAIN_IDS]);
    expect(listed('pwr')).toContain('pwr.flask_of_tea');
    expect(listed('collect')).toEqual(expect.arrayContaining([...COLLECTIBLE_IDS]));
  });

  it('agrees with every §4.1, §5, §12 and §13 value it mirrors', () => {
    expect(catalogMismatches(CATALOG, DEFAULT_ENTITIES)).toEqual([]);
  });

  it('fails when a catalog pts or LU value is edited without the JSON', () => {
    const ptsEdited = CATALOG.replace(
      '| `litter.crisp_packet` | Crisp packet | 10 | 1 |',
      '| `litter.crisp_packet` | Crisp packet | 12 | 1 |',
    );
    expect(ptsEdited).not.toBe(CATALOG);
    expect(catalogMismatches(ptsEdited, DEFAULT_ENTITIES)).toEqual([
      'litter.crisp_packet pts: catalog 12 vs entities.json 10',
    ]);
    const luEdited = CATALOG.replace(
      '| `litter.bin_bag` | Bin bag | 50 | 8 |',
      '| `litter.bin_bag` | Bin bag | 50 | 6 |',
    );
    expect(luEdited).not.toBe(CATALOG);
    expect(catalogMismatches(luEdited, DEFAULT_ENTITIES)).toEqual([
      'litter.bin_bag lu: catalog 6 vs entities.json 8',
    ]);
    const sprayEdited = CATALOG.replace(
      '| `stain.oil` | Oil stain | 30 | 2.0 s |',
      '| `stain.oil` | Oil stain | 30 | 2.5 s |',
    );
    expect(sprayEdited).not.toBe(CATALOG);
    expect(catalogMismatches(sprayEdited, DEFAULT_ENTITIES)).toEqual([
      'stain.oil sprayS: catalog 2.5 vs entities.json 2',
    ]);
    const dropped = CATALOG.replace(/^\| `litter\.lolly_stick` .*\n/m, '');
    expect(catalogMismatches(dropped, DEFAULT_ENTITIES)[0]).toMatch(/^§4\.1 litter IDs: /);
  });

  it('fails when a JSON pts or LU value is edited without the catalog', () => {
    const json = editedEntity('litter.dog_mess', (e) => {
      e.pts = 45;
      e.lu = 2;
    });
    expect(catalogMismatches(CATALOG, loadEntities(json))).toEqual([
      'litter.dog_mess pts: catalog 40 vs entities.json 45',
      'litter.dog_mess lu: catalog 1 vs entities.json 2',
    ]);
    const stain = editedEntity('stain.gum', (e) => {
      e.pts = 15;
    });
    expect(catalogMismatches(CATALOG, loadEntities(stain))).toEqual([
      'stain.gum pts: catalog 10 vs entities.json 15',
    ]);
  });

  it('maps district codes as §1.2 says: "All except Yard" is seven, "Any" is all eight', () => {
    const codes = districtCodes(CATALOG);
    expect([...codes.values()]).toEqual([...DISTRICT_IDS]);
    expect(parseDistricts('All except Yard; heavy on **Fri**', codes)).toEqual(SHIFT_DISTRICTS);
    expect(parseDistricts('Tue, **Fri**, Sat, Sun; Any (seagull theft)', codes)).toEqual([...DISTRICT_IDS]);
    expect(parseDistricts('**Fri**, Sun (ice cream van)', codes)).toEqual([
      'district.promenade',
      'district.civic_quarter',
    ]);
    expect(() => parseDistricts('Mon, Funday', codes)).toThrow(/unknown district code "Funday"/);
  });

  it('gives every litter and stain milestone M2 and the pickups M3 (LEVEL_DESIGN L007: Mon–Tue are M3)', () => {
    for (const id of LITTER_IDS) expect(DEFAULT_ENTITIES.litter[id].milestone).toBe('M2');
    for (const id of STAIN_IDS) expect(DEFAULT_ENTITIES.stains[id].milestone).toBe('M2');
    expect(DEFAULT_ENTITIES.powerups['pwr.flask_of_tea'].milestone).toBe('M3');
    for (const id of COLLECTIBLE_IDS) expect(DEFAULT_ENTITIES.collectibles[id].milestone).toBe('M3');
  });

  it('puts the Puddle Lane pickups in Puddle Lane, and the flask and Golden Crisp in every shift district', () => {
    const tea = DEFAULT_ENTITIES.powerups['pwr.flask_of_tea'];
    const teeth = DEFAULT_ENTITIES.collectibles['collect.false_teeth'];
    const golden = DEFAULT_ENTITIES.collectibles['collect.golden_crisp'];
    expect(tea.districts).toEqual(SHIFT_DISTRICTS);
    expect(golden.districts).toEqual(SHIFT_DISTRICTS);
    expect(teeth.districts).toEqual(['district.puddle_lane']);
    expect(teeth.kind).toBe('lostProperty');
    expect(golden.kind).toBe('goldenCrisp');
    expect(tea.effect).toEqual({ kind: 'chainTimerMul', mul: 2, durationS: 15 });
  });
});

describe('entities.json rules mirror ENTITY_CATALOG §4.2 and §5', () => {
  const behaviours = idRows(section(CATALOG, '### 4.2 Behaviours and brush-up rules'), 'litter.');
  const stainNotes = idRows(section(CATALOG, '## 5. Stains (`stain.*`)'), 'stain.');
  const behaviour = (id: string): string => (behaviours.get(id) ?? [])[0] ?? '';

  it('gives a brush-up rule to exactly the items whose §4.2 row describes one', () => {
    const described = LITTER_IDS.filter((id) => /brush[ -]up/i.test(behaviour(id)));
    const ruled = LITTER_IDS.filter((id) => DEFAULT_ENTITIES.litter[id].rules.brushUp !== undefined);
    expect(ruled).toEqual(described);
    expect(ruled).toEqual(['litter.banana_skin', 'litter.leaf_pile', 'litter.dog_mess']);
  });

  it('encodes the banana spin-out, wet leaves and dog-mess splat', () => {
    const { litter } = DEFAULT_ENTITIES;
    expect(behaviour('litter.banana_skin')).toContain('180° spin-out');
    expect(litter['litter.banana_skin'].rules).toEqual({ brushUp: { effect: 'spinOut', turnRad: Math.PI } });
    expect(behaviour('litter.leaf_pile')).toContain('`haz.wet_leaves`');
    expect(litter['litter.leaf_pile'].rules).toEqual({
      brushUp: { effect: 'hazard', hazard: 'haz.wet_leaves' },
    });
    expect(behaviour('litter.dog_mess')).toMatch(/creates `stain\.splat` and costs −20/);
    expect(litter['litter.dog_mess'].rules).toEqual({
      brushUp: { effect: 'stain', stain: 'stain.splat', pts: -20 },
    });
  });

  it('encodes the bin-bag burst, the glass-bottle smash and the gust drift', () => {
    const { litter } = DEFAULT_ENTITIES;
    expect(behaviour('litter.bin_bag')).toMatch(/Hit above 4 m\/s, it bursts into 6 small items/);
    expect(litter['litter.bin_bag'].rules).toEqual({ burst: { minSpeedMps: 4, items: 6 } });
    expect(behaviour('litter.glass_bottle')).toMatch(/If flung, it smashes into `haz\.broken_glass`/);
    expect(litter['litter.glass_bottle'].rules).toEqual({
      flung: { effect: 'hazard', hazard: 'haz.broken_glass' },
    });
    for (const id of ['litter.crisp_packet', 'litter.newspaper'] as const) {
      expect(behaviour(id)).toMatch(/1\.5 m\/s/);
      expect(litter[id].rules).toEqual({ drift: { speedMps: 1.5, durationS: 4 } });
    }
    expect(behaviour('litter.crisp_packet')).toMatch(/for 4 s/);
    const ruled = LITTER_IDS.filter((id) => Object.keys(litter[id].rules).length > 0);
    expect(ruled).toEqual([
      'litter.crisp_packet',
      'litter.glass_bottle',
      'litter.newspaper',
      'litter.banana_skin',
      'litter.leaf_pile',
      'litter.dog_mess',
      'litter.bin_bag',
    ]);
  });

  it('encodes the oil stain pairing and the chalk-art penalty from the §5 notes', () => {
    const { stains } = DEFAULT_ENTITIES;
    expect(stainNotes.get('stain.oil')?.[4]).toContain('`haz.oil_slick`');
    expect(stains['stain.oil'].rules).toEqual({ pairedHazard: 'haz.oil_slick' });
    expect(stainNotes.get('stain.chalk_art')?.[4]).toContain('−100 + 1 complaint');
    expect(stains['stain.chalk_art'].rules).toEqual({ cleanWhileOwnerPresent: { pts: -100, complaints: 1 } });
    for (const id of ['stain.gum', 'stain.milkshake', 'stain.splat'] as const)
      expect(stains[id].rules).toEqual({});
  });

  it('adopts the proposed spray times (splat = gum) and no longer marks them TBD', () => {
    const { stains } = DEFAULT_ENTITIES;
    expect(STAIN_IDS.map((id) => stains[id].sprayS)).toEqual([1.0, 1.5, 2.0, 2.0, 1.0]);
    expect(stains['stain.splat'].sprayS).toBe(stains['stain.gum'].sprayS);
    expect(section(CATALOG, '## 5. Stains (`stain.*`)')).not.toMatch(/TBD/);
    const q10 = /^\| 10 \| (.*)$/m.exec(section(CATALOG, '## 17. Open questions'))?.[1] ?? '';
    expect(q10).not.toMatch(/Missing values:[^|]*stain spray time/);
  });

  it('names only canonical hazard IDs', () => {
    expect(HAZARD_IDS).toEqual(
      [
        ...(/^\| `haz` \| 8 \| (.*) \|$/m.exec(section(CATALOG, '## 2. ID index'))?.[1] ?? '').matchAll(
          /`([a-z_]+)`/g,
        ),
      ].map((m) => `haz.${m[1]}`),
    );
  });
});

describe('entities.json references', () => {
  const assetIds = new Set(
    (/^export type AssetId = (.*);$/m.exec(GEN_ASSETS)?.[1] ?? '')
      .split('|')
      .map((s) => s.trim().replaceAll('"', '')),
  );
  const rawEntries = Object.entries(entitiesJson as Record<string, Json>);

  it('every sprite is an AssetId in src/gen/assets.ts with at least one frame', () => {
    expect(assetIds.size).toBeGreaterThan(20);
    const frameIds = Object.keys(FRAME);
    for (const [id, entry] of rawEntries) {
      const sprite = entry.sprite;
      expect(typeof sprite, id).toBe('string');
      expect(assetIds.has(String(sprite)), `${id}.sprite ${String(sprite)}`).toBe(true);
      expect(
        frameIds.some((f) => f.startsWith(`${String(sprite)}:`)),
        `${id}.sprite has frames`,
      ).toBe(true);
    }
    // And at the type level: the loaded sprite is an AssetId.
    const sprite: AssetId = DEFAULT_ENTITIES.litter['litter.banana_skin'].sprite;
    expect(sprite).toBe('litter.banana_skin');
  });

  it('every sfx value is in the canonical SFX list of ENTITY_CATALOG §1.4 (audio sources arrive in M5)', () => {
    const canonical = catalogSfx(CATALOG);
    expect(canonical).toHaveLength(32);
    expect([...SFX_IDS]).toEqual(canonical);
    let checked = 0;
    for (const [id, entry] of rawEntries) {
      if (!Object.hasOwn(entry, 'sfx')) continue;
      const sfx = entry.sfx;
      expect(isJson(sfx), id).toBe(true);
      for (const [use, value] of Object.entries(isJson(sfx) ? sfx : {})) {
        expect(canonical, `${id}.sfx.${use}`).toContain(value);
        checked += 1;
      }
    }
    expect(checked).toBe(18);
  });

  it('every district is a canonical district ID listed in week order', () => {
    for (const [id, entry] of rawEntries) {
      const districts = entry.districts;
      expect(Array.isArray(districts), id).toBe(true);
      const list = Array.isArray(districts) ? districts.map(String) : [];
      expect(list, id).toEqual(DISTRICT_IDS.filter((d) => list.includes(d)));
    }
  });
});

describe('loadEntities', () => {
  it('accepts the committed file and builds a fresh object on every call', () => {
    expect(loadEntities(structuredClone(entitiesJson))).toEqual(DEFAULT_ENTITIES);
    const a = loadEntities(entitiesJson);
    const b = loadEntities(entitiesJson);
    expect(a).not.toBe(b);
    expect(a.litter['litter.bin_bag']).not.toBe(b.litter['litter.bin_bag']);
    expect(a.litter['litter.bin_bag'].districts).not.toBe(b.litter['litter.bin_bag'].districts);
  });

  // Every required field of every entity: removing it must throw a descriptive error, never default.
  const requiredFields = Object.entries(entitiesJson as Record<string, Json>).flatMap(([id, entry]) =>
    Object.keys(entry).map((field) => [id, field] as const),
  );
  it.each(requiredFields)('throws a descriptive error when %s.%s is removed', (id, field) => {
    const copy = editedEntity(id, (e) => {
      delete e[field];
    });
    expect(() => loadEntities(copy)).toThrow(`entities: ${id}.${field} is missing`);
  });

  it.each([
    [
      'a nested sfx field',
      'litter.pizza_box',
      (e: Json) => delete (e.sfx as Json).pickup,
      /pizza_box\.sfx\.pickup is missing/,
    ],
    [
      'a burst field',
      'litter.bin_bag',
      (e: Json) => delete ((e.rules as Json).burst as Json).items,
      /bin_bag\.rules\.burst\.items is missing/,
    ],
    [
      'a power-up effect field',
      'pwr.flask_of_tea',
      (e: Json) => delete (e.effect as Json).durationS,
      /flask_of_tea\.effect\.durationS is missing/,
    ],
  ])('throws on a missing %s', (_name, id, edit, message) => {
    expect(() => loadEntities(editedEntity(id, edit))).toThrow(message);
  });

  it('throws when a whole entity is missing, or an extra ID appears', () => {
    const missing = editedJson((root) => {
      delete root['stain.gum'];
    });
    expect(() => loadEntities(missing)).toThrow('entities: stain.gum is missing');
    const extra = editedJson((root) => {
      root['litter.traffic_cone'] = {};
    });
    expect(() => loadEntities(extra)).toThrow('entities: root has unknown key "litter.traffic_cone"');
  });

  it.each([
    ['root', null, /entities: root must be an object, got null/],
    ['root', [], /entities: root must be an object, got an array/],
  ])('throws on a non-object %s', (_name, value, message) => {
    expect(() => loadEntities(value)).toThrow(message);
  });

  it.each([
    [
      'an unknown field',
      'litter.drink_can',
      (e: Json) => (e.weightKg = 0.1),
      /drink_can has unknown key "weightKg"/,
    ],
    [
      'a wrong class',
      'litter.drink_can',
      (e: Json) => (e.class = 'stain'),
      /drink_can\.class must be "litter", got string "stain"/,
    ],
    [
      'a string number',
      'litter.drink_can',
      (e: Json) => (e.pts = '15'),
      /drink_can\.pts must be a finite number, got string "15"/,
    ],
    ['negative points', 'stain.gum', (e: Json) => (e.pts = -10), /stain\.gum\.pts must be an integer >= 0/],
    ['zero LU', 'litter.newspaper', (e: Json) => (e.lu = 0), /newspaper\.lu must be > 0/],
    ['zero spray time', 'stain.oil', (e: Json) => (e.sprayS = 0), /stain\.oil\.sprayS must be > 0/],
    [
      'a non-canonical SFX',
      'litter.drink_can',
      (e: Json) => (e.sfx = { pickup: 'pickup_can' }),
      /drink_can\.sfx\.pickup must be a canonical SFX ID/,
    ],
    [
      'an unknown district',
      'litter.drink_can',
      (e: Json) => (e.districts = ['district.atlantis']),
      /drink_can\.districts\[0\] must be a canonical district ID/,
    ],
    [
      'districts out of week order',
      'litter.pizza_box',
      (e: Json) => (e.districts = ['district.kebab_mile', 'district.high_street']),
      /pizza_box\.districts\[1\] "district\.high_street" repeats or is out of week order/,
    ],
    [
      'empty districts',
      'litter.pizza_box',
      (e: Json) => (e.districts = []),
      /pizza_box\.districts must be a non-empty array/,
    ],
    [
      'an unknown milestone',
      'stain.gum',
      (e: Json) => (e.milestone = 'M10'),
      /stain\.gum\.milestone must be a milestone/,
    ],
    [
      'a malformed sprite',
      'stain.gum',
      (e: Json) => (e.sprite = 'Stain Gum'),
      /stain\.gum\.sprite must look like an asset ID/,
    ],
    [
      'an unknown rule',
      'litter.drink_can',
      (e: Json) => (e.rules = { explode: true }),
      /drink_can\.rules has unknown key "explode"/,
    ],
    [
      'an unknown brush-up effect',
      'litter.banana_skin',
      (e: Json) => (e.rules = { brushUp: { effect: 'teleport' } }),
      /banana_skin\.rules\.brushUp\.effect must be "spinOut", "hazard" or "stain"/,
    ],
    [
      'a non-canonical hazard',
      'litter.leaf_pile',
      (e: Json) => (e.rules = { brushUp: { effect: 'hazard', hazard: 'haz.mud' } }),
      /leaf_pile\.rules\.brushUp\.hazard must be a canonical haz\.\* ID/,
    ],
    [
      'a positive splat penalty',
      'litter.dog_mess',
      (e: Json) => (e.rules = { brushUp: { effect: 'stain', stain: 'stain.splat', pts: 20 } }),
      /dog_mess\.rules\.brushUp\.pts must be a negative integer/,
    ],
    [
      'a fractional burst count',
      'litter.bin_bag',
      (e: Json) => (e.rules = { burst: { minSpeedMps: 4, items: 6.5 } }),
      /bin_bag\.rules\.burst\.items must be an integer >= 1/,
    ],
    [
      'an unknown collectible kind',
      'collect.golden_crisp',
      (e: Json) => (e.kind = 'treasure'),
      /golden_crisp\.kind must be "lostProperty" or "goldenCrisp"/,
    ],
    [
      'an unknown power-up effect',
      'pwr.flask_of_tea',
      (e: Json) => (e.effect = { kind: 'speed', mul: 2, durationS: 15 }),
      /flask_of_tea\.effect\.kind must be "chainTimerMul"/,
    ],
  ])('throws on %s', (_name, id, edit, message) => {
    expect(() => loadEntities(editedEntity(id, edit))).toThrow(message);
  });
});
