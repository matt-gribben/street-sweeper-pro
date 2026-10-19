// src/data/entities.json, its loader (src/sim/entities.ts via src/sim/tuning.ts) and its mirror in
// docs/ENTITY_CATALOG.md (SSP-053, SSP-075). Since SSP-053 the JSON is the source of truth for entity IDs and
// numbers, and ENTITY_CATALOG.md mirrors it (CLAUDE.md §2). This test parses the catalog's §4.1 litter table,
// §5 stain table, the §6.1/§7.1 NPC, §8.2 vehicle, §9 prop, §10 hazard, §11 site and §12 power-up tables, the
// behaviour numbers in the §6–§8 prose and the §13 pickup rows, and diffs IDs, names, points, LU, speeds,
// penalties, complaints, masses, spray times, SFX and districts against the JSON, so editing either side alone
// fails here. It checks the M3 set against the ROADMAP M3 entity-scope table (SSP-075), proves every `sprite`
// is a real AssetId (the sim may import src/gen/assets.ts for types only; the M3 placeholder sprites of
// SSP-097 to SSP-101 are listed as pending until they land) and every `sfx` is in the canonical §1.4 list.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import entitiesJson from '../../src/data/entities.json' with { type: 'json' };
import { type AssetId, FRAME } from '../../src/gen/assets.ts';
import {
  COLLECTIBLE_IDS,
  DEFAULT_ENTITIES,
  DEFAULT_TUNING,
  DISTRICT_IDS,
  type DistrictId,
  ENTITY_IDS,
  type Entities,
  HAZARD_ENTITY_IDS,
  HAZARD_IDS,
  type Hit,
  KNOCKABLE_IDS,
  LITTER_IDS,
  loadEntities,
  NPC_IDS,
  type NpcId,
  POWERUP_IDS,
  SFX_IDS,
  SITE_IDS,
  STAIN_IDS,
  STATIC_PROP_IDS,
  type Tuning,
  VEHICLE_IDS,
  type VehicleId,
} from '../../src/sim/tuning.ts';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const CATALOG = readFileSync(`${REPO_ROOT}docs/ENTITY_CATALOG.md`, 'utf8');
const GEN_ASSETS = readFileSync(`${REPO_ROOT}src/gen/assets.ts`, 'utf8');
const ROADMAP = readFileSync(`${REPO_ROOT}docs/ROADMAP.md`, 'utf8');

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
 * "All except Yard" is the seven shift districts, "Any" and "All" are all eight (ENTITY_CATALOG §15), a parenthetical
 * is a note, and a "heavy on …" segment is a density hint. Anything else unrecognised throws.
 */
function parseDistricts(cell: string, codes: Map<string, string>): string[] {
  const members = new Set<string>();
  for (const rawSegment of cell.replaceAll('**', '').split(';')) {
    const segment = rawSegment.replace(/\([^)]*\)/g, '').trim();
    if (segment === '' || segment.startsWith('heavy on ')) continue;
    if (segment === 'All except Yard') {
      for (const d of SHIFT_DISTRICTS) members.add(d);
    } else if (segment === 'Any' || segment === 'All') {
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

/**
 * Every difference between the catalog text `md` and the loaded `entities`, as readable strings: the M2
 * litter, stain and pickup tables here, then the M3 tables (m3Mismatches, which covers §12's power-ups).
 */
function catalogMismatches(md: string, entities: Entities, tuning: Tuning = DEFAULT_TUNING): string[] {
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
  out.push(...m3Mismatches(md, entities, tuning));
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// M3 catalog parsing (SSP-075): §6.1 people, §7.1 animals, §8.2 vehicles, §9 props, §10 hazards, §11 sites,
// §12 power-ups, and the behaviour numbers in §6.2–§7.4.
// ---------------------------------------------------------------------------------------------------------

/** A catalog number: bold dropped, U+2212 minus read as a sign. */
const num = (text: string): number => Number(text.replaceAll('**', '').replaceAll('−', '-').trim());

/** The first signed number in `text`, or NaN. */
function firstNumber(text: string): number {
  const m = /−?\d+(?:\.\d+)?/.exec(text.replaceAll('**', ''));
  return m ? num(m[0]) : Number.NaN;
}

/** The distinct backticked SFX IDs of a cell, sorted. */
const sfxSet = (cell: string): string[] =>
  [...new Set([...cell.matchAll(/`([a-z_]+)`/g)].map((m) => m[1] ?? ''))].sort();

type CatalogHit = { pts: number; complaints: number; drops: Record<string, number> };

/**
 * The penalties a cell names, keyed 'hit' (the default) or 'tangle': "−500, 2 C, drops 6 `litter.x`",
 * "Tangle −150, 1 C; hit −300, 1 C", "Actor hit: **−250, 1 C**".
 */
function parsePenalties(cell: string): Map<string, CatalogHit> {
  const out = new Map<string, CatalogHit>();
  for (const segment of cell.replaceAll('**', '').split(';')) {
    const m = /(−\d+), (\d+) C/.exec(segment);
    if (!m) continue;
    const label = /^\s*([A-Za-z]+) −/.exec(segment)?.[1]?.toLowerCase();
    const drops: Record<string, number> = {};
    for (const d of segment.matchAll(/drops (\d+) `(litter\.[a-z_]+)`/g)) drops[d[2] ?? ''] = Number(d[1]);
    out.set(label === 'tangle' ? 'tangle' : 'hit', { pts: num(m[1] ?? ''), complaints: Number(m[2]), drops });
  }
  return out;
}

/** The JSON-side hit in the catalog's shape. */
const hitOf = (hit: Hit | null): CatalogHit | null =>
  hit === null
    ? null
    : {
        pts: hit.pts,
        complaints: hit.complaints,
        drops: Object.fromEntries(hit.drops.map((d) => [d.litter, d.count])),
      };

/** An entity's rules as a plain record (each ID's rule type is a distinct generic instance). */
const rulesOf = (e: { readonly rules: object }): Readonly<Record<string, number>> =>
  e.rules as Readonly<Record<string, number>>;

/** `obj` with its keys sorted, so key order never makes two equal objects differ. */
const sorted = (obj: object): Record<string, unknown> =>
  Object.fromEntries(Object.entries(obj).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

/**
 * Behaviour numbers stated in the catalog prose, as [id, rules key, section heading, row ID or null for the
 * whole section, regex, capture group]. Each must equal the JSON rules value.
 */
const RULE_MIRRORS: readonly (readonly [string, string, string, string | null, RegExp, number])[] = [
  ['npc.shopper', 'sidestepM', '### 6.2 Behaviours', 'npc.shopper', /sidesteps at (\d+) m/, 1],
  ['npc.old_woman', 'handbagHitHp', '### 6.3 Doris (`npc.old_woman`)', null, /\((\d+) HP per hit\)/, 1],
  ['npc.old_woman', 'whackEveryS', '### 6.3 Doris (`npc.old_woman`)', null, /whacks every (\d+\.\d+) s/, 1],
  ['npc.old_woman', 'chaseGiveUpM', '### 6.3 Doris (`npc.old_woman`)', null, /gives up at (\d+) m/, 1],
  [
    'npc.old_woman',
    'hornSlowSpeedMps',
    '### 6.3 Doris (`npc.old_woman`)',
    null,
    /reduced speed is (\d+\.\d+) m\/s/,
    1,
  ],
  ['npc.old_woman', 'glareM', '### 6.3 Doris (`npc.old_woman`)', null, /within (\d+) m ahead on her path/, 1],
  ['npc.old_woman', 'glareClearS', '### 6.3 Doris (`npc.old_woman`)', null, /clear for (\d+\.\d+) s/, 1],
  [
    'npc.old_woman',
    'fistShakeS',
    '### 6.3 Doris (`npc.old_woman`)',
    null,
    /shakes her fist for (\d+\.\d+) s/,
    1,
  ],
  ['npc.old_woman', 'hornSlowS', '### 6.3 Doris (`npc.old_woman`)', null, /stays slowed for (\d+) s/, 1],
  [
    'npc.old_woman',
    'handbagReachM',
    '### 6.3 Doris (`npc.old_woman`)',
    null,
    /within (\d+\.\d+) m of her centre/,
    1,
  ],
  ['npc.dog_walker', 'leadMaxM', '### 6.2 Behaviours', 'npc.dog_walker', /up to (\d+) m ahead/, 1],
  [
    'npc.dog_walker',
    'messEveryMinS',
    '### 6.2 Behaviours',
    'npc.dog_walker',
    /every \*\*(\d+)–(\d+) s\*\*/,
    1,
  ],
  [
    'npc.dog_walker',
    'messEveryMaxS',
    '### 6.2 Behaviours',
    'npc.dog_walker',
    /every \*\*(\d+)–(\d+) s\*\*/,
    2,
  ],
  ['npc.litterbug', 'dropEveryMinS', '### 6.2 Behaviours', 'npc.litterbug', /item every (\d+)–(\d+) s/, 1],
  ['npc.litterbug', 'dropEveryMaxS', '### 6.2 Behaviours', 'npc.litterbug', /item every (\d+)–(\d+) s/, 2],
  [
    'npc.litterbug',
    'caughtRadiusM',
    '### 6.2 Behaviours',
    'npc.litterbug',
    /Honk within (\d+) m → "Caught!"/,
    1,
  ],
  ['npc.litterbug', 'caughtPts', '### 6.2 Behaviours', 'npc.litterbug', /"Caught!" \+(\d+)/, 1],
  ['npc.businessman', 'noticeM', '### 6.2 Behaviours', 'npc.businessman', /until (\d+) m/, 1],
  ['npc.postie', 'doorStopS', '### 6.2 Behaviours', 'npc.postie', /stops at doors for (\d+) s/, 1],
  [
    'npc.mum_pushchair',
    'footprintRadiusM',
    '### 6.2 Behaviours',
    'npc.mum_pushchair',
    /footprint is a circle of radius (\d+\.\d+) m/,
    1,
  ],
  [
    'npc.cat',
    'dartMinM',
    '### 7.2 Cat (`npc.cat`)',
    null,
    /when you're (\d+)–(\d+) m away \((\d+)% chance/,
    1,
  ],
  [
    'npc.cat',
    'dartMaxM',
    '### 7.2 Cat (`npc.cat`)',
    null,
    /when you're (\d+)–(\d+) m away \((\d+)% chance/,
    2,
  ],
  ['npc.cat', 'rideS', '### 7.2 Cat (`npc.cat`)', null, /rides (\d+) s, hops off/, 1],
  ['npc.pigeon', 'flockMin', '### 7.4 Pigeon (`npc.pigeon`)', null, /flocks of \*\*(\d+)–(\d+)\*\*/, 1],
  ['npc.pigeon', 'flockMax', '### 7.4 Pigeon (`npc.pigeon`)', null, /flocks of \*\*(\d+)–(\d+)\*\*/, 2],
  [
    'npc.pigeon',
    'scatterM',
    '### 7.4 Pigeon (`npc.pigeon`)',
    null,
    /Scatters at (\d+) m and lands (\d+) m/,
    1,
  ],
  ['npc.pigeon', 'landM', '### 7.4 Pigeon (`npc.pigeon`)', null, /Scatters at (\d+) m and lands (\d+) m/, 2],
  ['npc.pigeon', 'flyMps', '### 7.4 Pigeon (`npc.pigeon`)', null, /speed `rules.flyMps` (\d+) m\/s/, 1],
  ['npc.pigeon', 'gatherM', '### 7.4 Pigeon (`npc.pigeon`)', null, /gather reach `rules.gatherM` (\d+) m/, 1],
  ['veh.bus', 'stopDwellS', '### 8.2 Behaviour, collision and districts', 'veh.bus', /for (\d+) s/, 1],
];

/** A §12 Effect cell as the JSON `effect` it describes (durationS undefined for "instant"). */
function catalogPowerupEffect(text: string, durationS: number | undefined): Record<string, unknown> {
  const tea = /Combo chain timer ×(\d+)/.exec(text);
  if (tea) return { kind: 'chainTimerMul', mul: num(tea[1] ?? ''), durationS };
  const butty = /Top speeds \+(\d+)%/.exec(text);
  if (butty) return { kind: 'topSpeedMul', mul: 1 + num(butty[1] ?? '') / 100, durationS };
  if (/pedestrians yield/.test(text)) return { kind: 'pedestriansYield', durationS };
  const suction = /Suction zone ×(\d+) and the fling threshold rises to (\d+\.\d+) m\/s/.exec(text);
  if (suction) {
    return {
      kind: 'superSuction',
      suctionMul: num(suction[1] ?? ''),
      flingThresholdMps: num(suction[2] ?? ''),
      durationS,
    };
  }
  const wrench = /Repair \+(\d+) HP/.exec(text);
  if (wrench) return { kind: 'repairHp', hp: num(wrench[1] ?? '') };
  const water = /Water \+(\d+)/.exec(text);
  if (water) return { kind: 'addWater', units: num(water[1] ?? '') };
  return { unparsed: text };
}

/** Every difference between the catalog's M3 tables and prose (`md`) and the loaded M3 entities. */
function m3Mismatches(md: string, entities: Entities, tuning: Tuning): string[] {
  const out: string[] = [];
  const check = (what: string, catalog: unknown, json: unknown): void => {
    if (JSON.stringify(catalog) !== JSON.stringify(json)) {
      out.push(`${what}: catalog ${JSON.stringify(catalog)} vs entities.json ${JSON.stringify(json)}`);
    }
  };
  const codes = districtCodes(md);

  // §6.1: | ID | Name | Speed | Hit penalty | Hit SFX | Districts | Milestone |
  // §7.1: | ID | Name | Cell | Frames | Speed | Hit / interaction | SFX | Districts | Milestone |
  type NpcRow = { speed: string; penalty: string; sfx: string; districts: string; milestone: string };
  const npcRows = new Map<string, NpcRow>();
  for (const [id, [, speed = '', penalty = '', sfx = '', districts = '', milestone = '']] of idRows(
    section(md, '### 6.1 Stats'),
    'npc.',
  )) {
    npcRows.set(id, { speed, penalty, sfx, districts, milestone });
  }
  for (const [id, [, , , speed = '', penalty = '', sfx = '', districts = '', milestone = '']] of idRows(
    section(md, '### 7.1 Stats and sprites'),
    'npc.',
  )) {
    npcRows.set(id, { speed, penalty, sfx, districts, milestone });
  }
  const m3Npcs = [...npcRows].filter(([, row]) => row.milestone === 'M3').map(([id]) => id);
  check('§6.1/§7.1 M3 npc IDs', m3Npcs, [...NPC_IDS]);
  for (const id of NPC_IDS) {
    const row = npcRows.get(id);
    if (row === undefined) continue;
    const e = entities.npcs[id];
    const rules = rulesOf(e);
    check(`${id} speed`, row.speed.trim() === '—' ? 0 : firstNumber(row.speed), e.speedMps);
    const chase = /chase (\d+(?:\.\d+)?)/.exec(row.speed)?.[1];
    check(`${id} chase speed`, chase === undefined ? undefined : num(chase), rules.chaseSpeedMps);
    const penalties = parsePenalties(row.penalty);
    check(`${id} hit`, penalties.get('hit') ?? null, hitOf(e.hit));
    const tangle = penalties.get('tangle');
    check(
      `${id} tangle`,
      tangle === undefined ? undefined : [tangle.pts, tangle.complaints],
      rules.tanglePts === undefined ? undefined : [rules.tanglePts, rules.tangleComplaints],
    );
    const scatter = /\+(\d+) "Pigeon Scatter"/.exec(row.penalty.replaceAll('**', ''))?.[1];
    check(`${id} scatter pts`, scatter === undefined ? undefined : num(scatter), rules.scatterPts);
    check(`${id} sfx`, sfxSet(row.sfx), [...new Set(Object.values(e.sfx))].sort());
    check(`${id} districts`, parseDistricts(row.districts, codes), e.districts);
    check(`${id} milestone`, row.milestone, e.milestone);
  }

  // §8.2: | ID | Name | Behaviour | Collision / penalty | SFX | Districts |
  const vehSection = section(md, '### 8.2 Behaviour, collision and districts');
  const vehRows = idRows(vehSection, 'veh.');
  for (const id of VEHICLE_IDS) {
    if (id.endsWith('_parked')) continue;
    const row = vehRows.get(id);
    if (row === undefined) {
      out.push(`${id}: no §8.2 row`);
      continue;
    }
    const [, behaviour = '', collision = '', sfx = '', districts = ''] = row;
    const e = entities.vehicles[id];
    const kind = /^\*{0,2}Actor hit/.test(collision)
      ? 'actor'
      : /^Solid/.test(collision)
        ? 'solid'
        : collision;
    check(`${id} collision`, kind, e.collision);
    check(
      `${id} hit`,
      kind === 'actor' ? (parsePenalties(collision).get('hit') ?? null) : null,
      hitOf(e.hit),
    );
    const speed = /(\d+(?:\.\d+)?) m\/s/.exec(behaviour)?.[1];
    check(`${id} speed`, speed === undefined ? null : num(speed), e.speedMps);
    check(`${id} sfx`, sfxSet(sfx), [...new Set(Object.values(e.sfx))].sort());
    check(`${id} districts`, parseDistricts(districts, codes), e.districts);
  }
  // | `veh.<type>_parked` | Parked variants | Behaviour | Collision | SFX | Districts |, plus the variants note.
  const parkedRow = (/^\| `veh\.<type>_parked` \|(.*)\|$/m.exec(vehSection)?.[1] ?? '')
    .split('|')
    .map((c) => c.trim());
  const [, , parkedCollision = '', parkedSfx = '', parkedDistricts = ''] = parkedRow;
  const dent = /costs (−\d+) and (\d+) HP/.exec(parkedCollision.replaceAll('**', ''));
  const variants = /\*\*Parked variants\*\* exist for ([^(]*)\(/.exec(vehSection)?.[1] ?? '';
  for (const id of VEHICLE_IDS) {
    if (!id.endsWith('_parked')) continue;
    const e = entities.vehicles[id];
    const rules = rulesOf(e);
    check(
      `${id} listed as a parked variant`,
      true,
      variants.includes(`\`${id.slice(4, -'_parked'.length)}\``),
    );
    check(`${id} collision`, /^Solid/.test(parkedCollision) ? 'solid' : parkedCollision, e.collision);
    check(`${id} hit`, null, hitOf(e.hit));
    check(`${id} dent`, [num(dent?.[1] ?? ''), Number(dent?.[2])], [rules.dentPts, rules.dentHp]);
    check(`${id} sfx`, sfxSet(parkedSfx), [...new Set(Object.values(e.sfx))].sort());
    check(`${id} districts`, parseDistricts(parkedDistricts, codes), e.districts);
  }

  // §9.1: | ID | Name | Mass | Penalty | Spills | Technique | Render | SFX | Districts |
  const knockRows = idRows(section(md, '### 9.1 Knockable props'), 'prop.');
  check('§9.1 knockable IDs', [...knockRows.keys()], [...KNOCKABLE_IDS]);
  for (const id of KNOCKABLE_IDS) {
    const row = knockRows.get(id);
    if (row === undefined) continue;
    const [, mass = '', penalty = '', spills = '', , , sfx = '', districts = ''] = row;
    const e = entities.knockables[id];
    check(`${id} massKg`, firstNumber(mass), e.massKg);
    check(`${id} knock pts`, penalty === 'none' ? 0 : firstNumber(penalty), e.knock.pts);
    check(`${id} spills`, spills === '—' ? 0 : firstNumber(spills), e.knock.spills);
    check(`${id} sfx`, sfxSet(sfx), [e.sfx.knock]);
    check(`${id} districts`, parseDistricts(districts, codes), e.districts);
  }

  // §9.2: | ID | Name | Technique | Render | Notes | Districts |
  const staticRows = idRows(section(md, '### 9.2 Static props'), 'prop.');
  check('§9.2 static prop IDs', [...staticRows.keys()], [...STATIC_PROP_IDS]);
  for (const id of STATIC_PROP_IDS) {
    const districts = staticRows.get(id)?.[4];
    if (districts === undefined) continue;
    check(`${id} districts`, parseDistricts(districts, codes), entities.staticProps[id].districts);
  }

  // §10: | ID | Name | Effect | Score | SFX | Districts |
  const hazRows = idRows(section(md, '## 10. Hazards (`haz.*`)'), 'haz.');
  check(
    '§10 hazard IDs with entries',
    [...hazRows.keys()].filter((id) => id !== 'haz.wind_gust'),
    [...HAZARD_ENTITY_IDS],
  );
  const grip = tuning.vehicle.sweeper.lateralGripPerS;
  for (const id of HAZARD_ENTITY_IDS) {
    const row = hazRows.get(id);
    if (row === undefined) continue;
    const [, effectCell = '', score = '', sfx = '', districts = ''] = row;
    const e = entities.hazards[id];
    const text = effectCell.replaceAll('**', '');
    const kind = /hard stop/.test(text)
      ? 'hardStop'
      : /HP\/s/.test(text)
        ? 'drain'
        : /grip/i.test(text)
          ? 'grip'
          : /jolt/i.test(text)
            ? 'jolt'
            : text;
    check(`${id} effect`, kind, e.effect);
    const gripValue = /[Gg]rip (\d+\.\d+)/.exec(text)?.[1];
    check(
      `${id} grip`,
      gripValue === undefined ? null : num(gripValue),
      e.surface === null ? null : grip[e.surface],
    );
    const rules: Record<string, number> = {};
    const hp = /−(\d+) HP(?!\/s)/.exec(text)?.[1];
    if (hp !== undefined) rules.hpLoss = num(hp);
    const drain = /−(\d+) HP\/s/.exec(text)?.[1];
    if (drain !== undefined) rules.hpPerS = num(drain);
    const spill = /spills (\d+) LU/.exec(text)?.[1];
    if (spill !== undefined) rules.spillLu = num(spill);
    const above = /Above (\d+) m\/s/.exec(text)?.[1];
    if (kind === 'jolt' && above !== undefined) rules.minSpeedMps = num(above);
    const sweep = /Sweep for \+(\d+)/.exec(score.replaceAll('**', ''))?.[1];
    if (sweep !== undefined) rules.sweepPts = num(sweep);
    check(`${id} rules`, sorted(rules), sorted(e.rules));
    check(`${id} sfx`, sfx === '—' ? [] : sfxSet(sfx), [...new Set(Object.values(e.sfx))].sort());
    check(`${id} districts`, parseDistricts(districts, codes), e.districts);
  }
  // The puddle's splash rule is shared tuning; the oil slick's +30 is the stain.oil award (§5).
  const splash =
    /Above (\d+) m\/s it splashes pedestrians within (\d+(?:\.\d+)?) m: (−\d+) each\. Every (\d)rd splash = 1 complaint/.exec(
      (hazRows.get('haz.puddle')?.[1] ?? '').replaceAll('**', ''),
    );
  check(
    'haz.puddle splash (tuning.json streetLife.splash)',
    splash ? [num(splash[1] ?? ''), num(splash[2] ?? ''), num(splash[3] ?? ''), num(splash[4] ?? '')] : null,
    [
      tuning.streetLife.splash.minSpeedMps,
      tuning.streetLife.splash.radiusM,
      tuning.streetLife.splash.pts,
      tuning.streetLife.splash.complaintEvery,
    ],
  );
  check(
    'haz.oil_slick spray award (stain.oil pts)',
    firstNumber(hazRows.get('haz.oil_slick')?.[2] ?? ''),
    entities.stains['stain.oil'].rules.pairedHazard === 'haz.oil_slick'
      ? entities.stains['stain.oil'].pts
      : null,
  );

  // §11: | ID | Purpose | Rules | Visual | Districts |
  const siteRows = idRows(section(md, '## 11. Sites (`site.*`)'), 'site.');
  for (const id of SITE_IDS) {
    const districts = siteRows.get(id)?.[3];
    check(`${id} districts`, districts === undefined ? undefined : parseDistricts(districts, codes), [
      ...entities.sites[id].districts,
    ]);
  }

  // §12: | ID | Name | Effect | Duration | Numbers in practice |
  const pwrRows = idRows(section(md, '## 12. Power-ups (`pwr.*`)'), 'pwr.');
  check('§12 power-up IDs', [...pwrRows.keys()], [...POWERUP_IDS]);
  for (const id of POWERUP_IDS) {
    const row = pwrRows.get(id);
    if (row === undefined) continue;
    const [name = '', effectCell = '', duration = ''] = row;
    const e = entities.powerups[id];
    const text = effectCell.replaceAll('**', '');
    const durationS = duration === 'instant' ? undefined : plainNumber(duration);
    const effect = catalogPowerupEffect(text, durationS);
    check(`${id} name`, name, e.name);
    check(`${id} effect`, sorted(effect), sorted(e.effect));
    check(`${id} districts`, SHIFT_DISTRICTS, e.districts);
  }

  // Behaviour numbers stated in prose.
  for (const [id, key, heading, rowId, pattern, group] of RULE_MIRRORS) {
    const text = section(md, heading);
    const scope =
      rowId === null ? text : (idRows(text, `${rowId.split('.')[0]}.`).get(rowId) ?? []).join(' | ');
    const value = pattern.exec(scope)?.[group];
    const entity = id.startsWith('npc.') ? entities.npcs[id as NpcId] : entities.vehicles[id as VehicleId];
    check(`${id} rules.${key}`, value === undefined ? undefined : num(value), rulesOf(entity)[key]);
  }
  const catChance = /when you're \d+–\d+ m away \((\d+)% chance/.exec(
    section(md, '### 7.2 Cat (`npc.cat`)'),
  )?.[1];
  check('npc.cat rules.dartChance', num(catChance ?? '') / 100, entities.npcs['npc.cat'].rules.dartChance);

  // §3.4: the "Who yields" list names exactly the NPCs with yields: true.
  const yielders = /\*\*Who yields\*\*[^:]*: (.*?) yield inside/.exec(
    section(md, '### 3.4 Generic pedestrian reaction model'),
  );
  check(
    '§3.4 yielding NPCs',
    [...(yielders?.[1] ?? '').matchAll(/`(npc\.[a-z_]+)`/g)].map((m) => m[1]).sort(),
    NPC_IDS.filter((id) => entities.npcs[id].yields).sort(),
  );
  return out;
}

/**
 * The ROADMAP M3 entity-scope table as IDs. Parentheticals that are notes (the walker's dog, haz.wind_gust)
 * are dropped; one that is a plain ID list (the knockables) is kept. "`_parked` variants of a, b and c",
 * "all statics" (ENTITY_CATALOG §9.2) and "All six `pwr.*`" (§2) are expanded.
 */
function roadmapM3Ids(roadmap: string, md: string): string[] {
  const text = section(roadmap, '### M3 Living Street');
  const table = text.slice(text.indexOf('**Mon–Tue entity scope**'), text.indexOf('**Deliverables.**'));
  const ids: string[] = [];
  for (const line of table.split('\n')) {
    const row = /^\| ([A-Za-z-]+) \| (.*) \|$/.exec(line);
    if (!row || row[1] === 'Kind') continue;
    const cell = (row[2] ?? '').replace(/\(([^)]*)\)/g, (_all, inner: string) =>
      /^(`[a-z]+\.[a-z0-9_]+`(, )?)+$/.test(inner) ? inner : '',
    );
    for (const m of cell.matchAll(/`([a-z]+\.[a-z0-9_]+)`/g)) ids.push(m[1] ?? '');
    const parked = /`_parked` variants of ([a-z_, ]+)/.exec(cell)?.[1];
    if (parked !== undefined) {
      for (const name of parked.trim().split(/, | and /)) ids.push(`veh.${name}_parked`);
    }
    if (/all statics/.test(cell)) ids.push(...idRows(section(md, '### 9.2 Static props'), 'prop.').keys());
    if (/All six `pwr\.\*`/.test(cell)) {
      const index = /^\| `pwr` \| 6 \| (.*) \|$/m.exec(section(md, '## 2. ID index'))?.[1] ?? '';
      for (const m of index.matchAll(/`([a-z_]+)`/g)) ids.push(`pwr.${m[1]}`);
    }
  }
  return ids;
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
  it('holds the 15 litter and 5 stain IDs, the frozen M3 set and the two Puddle Lane collectibles, in order', () => {
    expect(Object.keys(entitiesJson)).toEqual([...ENTITY_IDS]);
    expect(LITTER_IDS).toHaveLength(15);
    expect(STAIN_IDS).toHaveLength(5);
    expect(ENTITY_IDS).toHaveLength(15 + 5 + 56 + 2);
    expect([...COLLECTIBLE_IDS]).toEqual(['collect.false_teeth', 'collect.golden_crisp']);
  });

  it('lists exactly the catalog §2 IDs it holds', () => {
    const index = section(CATALOG, '## 2. ID index');
    const listed = (cls: string): string[] => {
      // `npc` has two rows, "(people)" and "(animals)".
      const rows = [
        ...index.matchAll(new RegExp(`^\\| \`${cls}\`(?: \\(\\w+\\))? \\| \\d+ \\| (.*) \\|$`, 'gm')),
      ];
      return rows.flatMap((row) => [...(row[1] ?? '').matchAll(/`([a-z_]+)`/g)].map((m) => `${cls}.${m[1]}`));
    };
    expect(listed('litter')).toEqual([...LITTER_IDS]);
    expect(listed('stain')).toEqual([...STAIN_IDS]);
    expect(listed('pwr')).toEqual([...POWERUP_IDS]);
    expect(listed('npc')).toEqual(expect.arrayContaining([...NPC_IDS]));
    expect(listed('haz')).toEqual([...HAZARD_IDS]);
    expect(listed('site')).toEqual(expect.arrayContaining([...SITE_IDS]));
    expect(listed('prop')).toEqual([...KNOCKABLE_IDS, ...STATIC_PROP_IDS]);
    expect(listed('collect')).toEqual(expect.arrayContaining([...COLLECTIBLE_IDS]));
  });

  it('agrees with every §4.1, §5, §6–§13 value it mirrors', () => {
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

describe('the frozen Mon–Tue (M3) entity set (SSP-075)', () => {
  const m3Ids = ENTITY_IDS.filter((id) => !/^(litter|stain|collect)\./.test(id));

  it('holds every ID of the ROADMAP M3 entity-scope table, with milestone M3, and no other new ID', () => {
    const roadmapIds = roadmapM3Ids(ROADMAP, CATALOG);
    expect(roadmapIds).toHaveLength(56);
    expect(new Set(roadmapIds).size).toBe(roadmapIds.length);
    expect([...roadmapIds].sort()).toEqual([...m3Ids].sort());
    expect(roadmapIds).not.toContain('npc.dog_loose');
    expect(roadmapIds).not.toContain('haz.wind_gust');
    const raw = entitiesJson as Record<string, Json>;
    for (const id of roadmapIds) expect(raw[id]?.milestone, id).toBe('M3');
  });

  it('counts 11 NPCs, 11 vehicles, 17 props, 7 hazards, 4 sites and 6 power-ups', () => {
    expect([
      NPC_IDS.length,
      VEHICLE_IDS.length,
      KNOCKABLE_IDS.length + STATIC_PROP_IDS.length,
      HAZARD_ENTITY_IDS.length,
      SITE_IDS.length,
      POWERUP_IDS.length,
    ]).toEqual([11, 11, 17, 7, 4, 6]);
    expect(HAZARD_ENTITY_IDS).toEqual(HAZARD_IDS.filter((id) => id !== 'haz.wind_gust'));
  });

  it('agrees with every §6–§12 value it mirrors: speeds, penalties, complaints, LU, masses, rules', () => {
    expect(m3Mismatches(CATALOG, DEFAULT_ENTITIES, DEFAULT_TUNING)).toEqual([]);
  });

  it.each([
    [
      'a speed',
      'npc.shopper',
      (e: Json) => (e.speed = 1.5),
      /^npc\.shopper speed: catalog 1\.3 vs entities\.json 1\.5$/,
    ],
    ['a hit pts', 'npc.postie', (e: Json) => ((e.hit as Json).pts = -300), /^npc\.postie hit: /],
    [
      'a complaint count',
      'npc.old_woman',
      (e: Json) => ((e.hit as Json).complaints = 3),
      /^npc\.old_woman hit: /,
    ],
    [
      'a drop count',
      'npc.old_woman',
      (e: Json) => ((e.hit as Json).drops = { 'litter.spilled_shopping': 4 }),
      /^npc\.old_woman hit: /,
    ],
    [
      'a tangle penalty',
      'npc.dog_walker',
      (e: Json) => ((e.rules as Json).tanglePts = -100),
      /^npc\.dog_walker tangle: /,
    ],
    [
      'a chase speed',
      'npc.old_woman',
      (e: Json) => ((e.rules as Json).chaseSpeedMps = 1.4),
      /^npc\.old_woman chase speed: /,
    ],
    [
      'a Doris tuning value',
      'npc.old_woman',
      (e: Json) => ((e.rules as Json).chaseGiveUpM = 10),
      /^npc\.old_woman rules\.chaseGiveUpM: /,
    ],
    [
      'a cat dart chance',
      'npc.cat',
      (e: Json) => ((e.rules as Json).dartChance = 0.5),
      /^npc\.cat rules\.dartChance: /,
    ],
    ['a vehicle speed', 'veh.mobility_scooter', (e: Json) => (e.speed = 2), /^veh\.mobility_scooter speed: /],
    ['a vehicle hit', 'veh.bicycle', (e: Json) => ((e.hit as Json).complaints = 2), /^veh\.bicycle hit: /],
    [
      'a dent penalty',
      'veh.taxi_parked',
      (e: Json) => ((e.rules as Json).dentHp = 8),
      /^veh\.taxi_parked dent: /,
    ],
    [
      'a bus dwell',
      'veh.bus',
      (e: Json) => ((e.rules as Json).stopDwellS = 8),
      /^veh\.bus rules\.stopDwellS: /,
    ],
    ['a mass', 'prop.a_board', (e: Json) => (e.massKg = 9), /^prop\.a_board massKg: /],
    [
      'a knock penalty',
      'prop.wheelie_bin',
      (e: Json) => ((e.knock as Json).pts = -75),
      /^prop\.wheelie_bin knock pts: /,
    ],
    [
      'a spill count',
      'prop.recycling_box',
      (e: Json) => ((e.knock as Json).spills = 3),
      /^prop\.recycling_box spills: /,
    ],
    [
      'a hazard LU spill',
      'haz.pothole',
      (e: Json) => ((e.rules as Json).spillLu = 3),
      /^haz\.pothole rules: /,
    ],
    [
      'a hazard HP drain',
      'haz.broken_glass',
      (e: Json) => ((e.rules as Json).hpPerS = 4),
      /^haz\.broken_glass rules: /,
    ],
    ['a grip surface', 'haz.wet_leaves', (e: Json) => (e.surface = 'oil'), /^haz\.wet_leaves grip: /],
    [
      'a power-up number',
      'pwr.bacon_butty',
      (e: Json) => ((e.effect as Json).mul = 1.5),
      /^pwr\.bacon_butty effect: /,
    ],
    [
      'a power-up duration',
      'pwr.hi_vis',
      (e: Json) => ((e.effect as Json).durationS = 10),
      /^pwr\.hi_vis effect: /,
    ],
    [
      'a district',
      'veh.taxi',
      (e: Json) => (e.districts = ['district.high_street']),
      /^veh\.taxi districts: /,
    ],
  ])('fails when %s in the JSON changes without the catalog', (_name, id, edit, message) => {
    const mismatches = m3Mismatches(CATALOG, loadEntities(editedEntity(id, edit)), DEFAULT_TUNING);
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0]).toMatch(message);
  });

  it.each([
    [
      'a speed',
      '| `npc.shopper` | Shopper (8 outfit swaps) | 1.3 |',
      '| `npc.shopper` | Shopper (8 outfit swaps) | 1.4 |',
      /^npc\.shopper speed: /,
    ],
    [
      'a penalty',
      '| 0.4 | −500, 2 C | `ped_oi` | Mon, Tue, Sun |',
      '| 0.4 | −450, 2 C | `ped_oi` | Mon, Tue, Sun |',
      /^npc\.old_man_frame hit: /,
    ],
    ['a complaint count', '| 1.1 | −500, 2 C |', '| 1.1 | −500, 1 C |', /^npc\.mum_pushchair hit: /],
    ['a hazard LU', 'the jolt spills 3 LU', 'the jolt spills 4 LU', /^haz\.speed_bump rules: /],
    ['a mass', '| 30 kg | −50 | 4 items |', '| 25 kg | −50 | 4 items |', /^prop\.wheelie_bin massKg: /],
    ['a Doris value', 'gives up at 8 m', 'gives up at 9 m', /^npc\.old_woman rules\.chaseGiveUpM: /],
    [
      'the M3 marker of an M6 row',
      '| `ped_oi` | Thu, **Fri**, Sun | M6 |',
      '| `ped_oi` | Thu, **Fri**, Sun | M3 |',
      /^§6\.1\/§7\.1 M3 npc IDs: /,
    ],
  ])('fails when %s in the catalog changes without the JSON', (_name, from, to, message) => {
    const edited = CATALOG.replace(from, to);
    expect(edited).not.toBe(CATALOG);
    const mismatches = m3Mismatches(edited, DEFAULT_ENTITIES, DEFAULT_TUNING);
    expect(mismatches.length).toBeGreaterThanOrEqual(1);
    expect(mismatches[0]).toMatch(message);
  });

  it('leaves no value marked TBD (M3 tuning) and marks the values chosen in M3', () => {
    expect(CATALOG).not.toContain('TBD (M3 tuning)');
    const knock = idRows(section(CATALOG, '### 9.1 Knockable props'), 'prop.');
    const chosen = KNOCKABLE_IDS.filter((id) => knock.get(id)?.[1]?.includes('chosen in M3 tuning'));
    expect(chosen).toEqual(['prop.a_board', 'prop.shopping_trolley', 'prop.recycling_box']);
    for (const id of chosen) expect(DEFAULT_ENTITIES.knockables[id].massKg).toBeGreaterThan(0);
    const doris = section(CATALOG, '### 6.3 Doris (`npc.old_woman`)');
    expect(doris.match(/chosen in M3 tuning, SSP-075/g)).toHaveLength(2);
    // SSP-083 chose the slowed duration and the handbag reach.
    expect(doris.match(/chosen in M3 tuning by SSP-083/g)).toHaveLength(2);
    expect(DEFAULT_ENTITIES.npcs['npc.old_woman'].rules).toMatchObject({
      hornSlowSpeedMps: 0.4,
      whackEveryS: 1.0,
      chaseGiveUpM: 8,
      hornSlowS: 10,
      handbagReachM: 0.6,
    });
  });

  it('marks §17 Q2, Q3, Q4 and Q7 resolved to their defaults, and the JSON follows them', () => {
    const questions = section(CATALOG, '## 17. Open questions');
    for (const q of [2, 3, 4, 7]) {
      expect(
        new RegExp(`^\\| ${q} \\| .*\\*\\*Resolved \\(M3, SSP-075\\): the default\\.\\*\\*`, 'm').test(
          questions,
        ),
        `Q${q}`,
      ).toBe(true);
    }
    // Q2: hits need a closing speed of 1.0 m/s.
    expect(DEFAULT_TUNING.streetLife.actorHit.minClosingSpeedMps).toBe(1.0);
    // Q3: moving traffic costs HP only; Q4: a parked dent is a flat 5 HP.
    for (const id of VEHICLE_IDS) {
      const v = DEFAULT_ENTITIES.vehicles[id];
      expect(v.hit === null, id).toBe(v.collision === 'solid');
    }
    expect(DEFAULT_ENTITIES.vehicles['veh.hatchback_parked'].rules).toEqual({ dentPts: -100, dentHp: 5 });
    // Q7: only Doris drops anything.
    const droppers = NPC_IDS.filter((id) => (DEFAULT_ENTITIES.npcs[id].hit?.drops.length ?? 0) > 0);
    expect(droppers).toEqual(['npc.old_woman']);
    expect(DEFAULT_ENTITIES.npcs['npc.old_woman'].hit?.drops).toEqual([
      { litter: 'litter.spilled_shopping', count: 6 },
    ]);
  });

  it('gives grip hazards a tuning.json surface and every other hazard none', () => {
    const { hazards } = DEFAULT_ENTITIES;
    expect(HAZARD_ENTITY_IDS.map((id) => hazards[id].surface)).toEqual([
      'oil',
      'wet',
      null,
      null,
      'wetLeaves',
      null,
      null,
    ]);
    expect(HAZARD_ENTITY_IDS.filter((id) => hazards[id].effect === 'grip')).toEqual([
      'haz.oil_slick',
      'haz.puddle',
      'haz.wet_leaves',
    ]);
    const grip = DEFAULT_TUNING.vehicle.sweeper.lateralGripPerS;
    expect([grip.oil, grip.wet, grip.wetLeaves]).toEqual([1.2, 4.0, 3.0]);
  });

  it('draws the four sites with tiles, facades and props (sprite null)', () => {
    for (const id of SITE_IDS) expect(DEFAULT_ENTITIES.sites[id].sprite, id).toBeNull();
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

/**
 * M3 sprites whose placeholders land in parallel with SSP-075 (ENTITY_CATALOG §15), each with the issue that
 * adds it. A listed sprite may already resolve; every sprite NOT listed must resolve now. SSP-103 adds the
 * full resolution test once all five placeholder issues have landed, and empties this list.
 */
const PENDING_PLACEHOLDER_SPRITES: Readonly<Record<string, string>> = {
  'npc.cat': 'SSP-099',
  'npc.pigeon': 'SSP-099',
  'veh.hatchback': 'SSP-100',
  'veh.saloon': 'SSP-100',
  'veh.taxi': 'SSP-100',
  'veh.van_white': 'SSP-100',
  'veh.bus': 'SSP-100',
  'veh.bicycle': 'SSP-100',
  'veh.mobility_scooter': 'SSP-100',
  'veh.hatchback_parked': 'SSP-100',
  'veh.saloon_parked': 'SSP-100',
  'veh.taxi_parked': 'SSP-100',
  'veh.van_white_parked': 'SSP-100',
  'prop.wheelie_bin': 'SSP-101',
  'prop.traffic_cone': 'SSP-101',
  'prop.a_board': 'SSP-101',
  'prop.shopping_trolley': 'SSP-101',
  'prop.recycling_box': 'SSP-101',
  'prop.bollard': 'SSP-101',
  'prop.bench': 'SSP-101',
  'prop.bus_shelter': 'SSP-101',
  'prop.phone_box': 'SSP-101',
  'prop.post_box': 'SSP-101',
  'prop.tree': 'SSP-101',
  'prop.planter': 'SSP-101',
  'prop.market_stall': 'SSP-101',
  'prop.litter_bin': 'SSP-101',
  'prop.roadworks_barrier': 'SSP-101',
  'haz.oil_slick': 'SSP-101',
  'haz.puddle': 'SSP-101',
  'haz.pothole': 'SSP-101',
  'haz.wet_leaves': 'SSP-101',
  'haz.broken_glass': 'SSP-101',
  'haz.open_manhole': 'SSP-101',
  'pwr.bacon_butty': 'SSP-101',
  'pwr.hi_vis': 'SSP-101',
  'pwr.super_suction': 'SSP-101',
  'pwr.wrench': 'SSP-101',
  'pwr.water_can': 'SSP-101',
};

describe('entities.json references', () => {
  const assetIds = new Set(
    (/^export type AssetId = (.*);$/m.exec(GEN_ASSETS)?.[1] ?? '')
      .split('|')
      .map((s) => s.trim().replaceAll('"', '')),
  );
  const rawEntries = Object.entries(entitiesJson as Record<string, Json>);

  it('every sprite is an AssetId in src/gen/assets.ts with at least one frame (pending M3 placeholders aside)', () => {
    expect(assetIds.size).toBeGreaterThan(20);
    const frameIds = Object.keys(FRAME);
    let resolved = 0;
    for (const [id, entry] of rawEntries) {
      const sprite = entry.sprite;
      if (entry.class === 'site') {
        // Sites are drawn by tiles, facades and props (ENTITY_CATALOG §11, §15).
        expect(sprite, id).toBeNull();
        continue;
      }
      expect(typeof sprite, id).toBe('string');
      const hasFrames =
        assetIds.has(String(sprite)) && frameIds.some((f) => f.startsWith(`${String(sprite)}:`));
      if (Object.hasOwn(PENDING_PLACEHOLDER_SPRITES, String(sprite)) && !hasFrames) continue;
      expect(assetIds.has(String(sprite)), `${id}.sprite ${String(sprite)}`).toBe(true);
      expect(hasFrames, `${id}.sprite has frames`).toBe(true);
      resolved += 1;
    }
    // Everything SSP-053 shipped, plus the M3 sprites that already had placeholders, resolves today.
    expect(resolved).toBeGreaterThanOrEqual(rawEntries.length - SITE_IDS.length - 47);
    // And at the type level: the loaded sprite is an AssetId.
    const sprite: AssetId = DEFAULT_ENTITIES.litter['litter.banana_skin'].sprite;
    expect(sprite).toBe('litter.banana_skin');
  });

  it('lists as pending only M3 sprites, each against the placeholder issue that adds it', () => {
    const pending = Object.keys(PENDING_PLACEHOLDER_SPRITES);
    expect(pending).toHaveLength(39);
    const raw = entitiesJson as Record<string, Json>;
    for (const sprite of pending) {
      const owners = Object.entries(raw).filter(([, entry]) => entry.sprite === sprite);
      expect(owners.length, sprite).toBe(1);
      expect(owners[0]?.[1].milestone, sprite).toBe('M3');
      expect(PENDING_PLACEHOLDER_SPRITES[sprite]).toMatch(/^SSP-(097|098|099|100|101)$/);
    }
    // The M3 sprites that already had placeholders before SSP-075, or whose issue has landed, are not pending.
    for (const sprite of [
      'npc.old_woman',
      'npc.shopper',
      'npc.old_man_frame',
      'npc.dog_walker',
      'npc.mum_pushchair',
      'npc.postie',
      'npc.litterbug',
      'npc.businessman',
      'npc.market_trader',
      'prop.lamp_post',
      'prop.hydrant',
      'haz.speed_bump',
      'pwr.flask_of_tea',
    ]) {
      expect(pending).not.toContain(sprite);
    }
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
    expect(checked).toBe(57);
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
    [
      'an NPC rules value (Doris whack interval)',
      'npc.old_woman',
      (e: Json) => delete (e.rules as Json).whackEveryS,
      /entities: npc\.old_woman\.rules\.whackEveryS is missing/,
    ],
    [
      'a hit complaint count',
      'npc.cat',
      (e: Json) => delete (e.hit as Json).complaints,
      /entities: npc\.cat\.hit\.complaints is missing/,
    ],
    [
      'a vehicle rules value',
      'veh.van_white_parked',
      (e: Json) => delete (e.rules as Json).dentHp,
      /entities: veh\.van_white_parked\.rules\.dentHp is missing/,
    ],
    [
      'a knock field',
      'prop.recycling_box',
      (e: Json) => delete (e.knock as Json).spills,
      /entities: prop\.recycling_box\.knock\.spills is missing/,
    ],
    [
      'a hazard rules value',
      'haz.speed_bump',
      (e: Json) => delete (e.rules as Json).minSpeedMps,
      /entities: haz\.speed_bump\.rules\.minSpeedMps is missing/,
    ],
    [
      'a power-up effect number',
      'pwr.super_suction',
      (e: Json) => delete (e.effect as Json).flingThresholdMps,
      /entities: pwr\.super_suction\.effect\.flingThresholdMps is missing/,
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
      /flask_of_tea\.effect\.kind must be one of "chainTimerMul", "topSpeedMul", /,
    ],
    [
      "a power-up effect with another kind's numbers",
      'pwr.wrench',
      (e: Json) => (e.effect = { kind: 'repairHp', hp: 25, durationS: 5 }),
      /wrench\.effect has unknown key "durationS"/,
    ],
    [
      'an unknown NPC rules key',
      'npc.shopper',
      (e: Json) => ((e.rules as Json).fleeM = 3),
      /npc\.shopper\.rules has unknown key "fleeM"/,
    ],
    [
      'an unknown NPC behaviour',
      'npc.postie',
      (e: Json) => (e.behaviour = 'jogger'),
      /npc\.postie\.behaviour must be one of "shopper", /,
    ],
    [
      'a non-boolean yields',
      'npc.shopper',
      (e: Json) => (e.yields = 'yes'),
      /npc\.shopper\.yields must be a boolean/,
    ],
    [
      'a positive hit penalty',
      'npc.shopper',
      (e: Json) => ((e.hit as Json).pts = 250),
      /npc\.shopper\.hit\.pts must be a negative integer/,
    ],
    [
      'a drop of a non-litter ID',
      'npc.old_woman',
      (e: Json) => ((e.hit as Json).drops = { 'pwr.wrench': 1 }),
      /npc\.old_woman\.hit\.drops has unknown key "pwr\.wrench"/,
    ],
    [
      'a probability above 1',
      'npc.cat',
      (e: Json) => ((e.rules as Json).dartChance = 1.4),
      /npc\.cat\.rules\.dartChance must be in \(0, 1\]/,
    ],
    [
      'an inverted range',
      'npc.pigeon',
      (e: Json) => ((e.rules as Json).flockMin = 14),
      /npc\.pigeon\.rules flockMin \(14\) must not exceed flockMax \(12\)/,
    ],
    [
      'an unknown sfx use',
      'npc.cat',
      (e: Json) => (e.sfx = { purr: 'cat_yowl' }),
      /npc\.cat\.sfx has unknown key "purr"/,
    ],
    [
      'a pigeon with a hit penalty that is not an object',
      'npc.pigeon',
      (e: Json) => (e.hit = 25),
      /npc\.pigeon\.hit must be an object, got number 25/,
    ],
    [
      'a solid vehicle with a hit penalty',
      'veh.bus',
      (e: Json) => (e.hit = { pts: -250, complaints: 1, drops: {} }),
      /veh\.bus\.hit must be null for a solid vehicle/,
    ],
    [
      'an actor vehicle without a hit penalty',
      'veh.bicycle',
      (e: Json) => (e.hit = null),
      /veh\.bicycle\.hit must be a penalty for an actor/,
    ],
    [
      'a zero vehicle speed',
      'veh.mobility_scooter',
      (e: Json) => (e.speed = 0),
      /mobility_scooter\.speed must be > 0/,
    ],
    [
      'a knockable that pays out',
      'prop.a_board',
      (e: Json) => ((e.knock as Json).pts = 25),
      /prop\.a_board\.knock\.pts must be an integer <= 0/,
    ],
    [
      'a static prop marked knockable',
      'prop.bench',
      (e: Json) => (e.collision = 'knockable'),
      /prop\.bench\.collision must be "solid"/,
    ],
    [
      'a grip hazard without a surface',
      'haz.puddle',
      (e: Json) => (e.surface = null),
      /haz\.puddle\.surface must be one of "wet", "oil", "wetLeaves"/,
    ],
    [
      'a jolt hazard with a surface',
      'haz.pothole',
      (e: Json) => (e.surface = 'wet'),
      /haz\.pothole\.surface must be null for effect "jolt"/,
    ],
    [
      'a site with a sprite',
      'site.zebra',
      (e: Json) => (e.sprite = 'tile.zebra'),
      /site\.zebra\.sprite must be null/,
    ],
  ])('throws on %s', (_name, id, edit, message) => {
    expect(() => loadEntities(editedEntity(id, edit))).toThrow(message);
  });
});
