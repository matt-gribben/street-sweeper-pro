// Level compiler: assets-src/levels/<name>.map.txt + <name>.level.json → public/assets/levels/<name>.json
// (LEVEL_DESIGN §8, §10; TECHNICAL_DESIGN §15). SSP-033 builds the core: map parse, legend and overrides,
// ground inheritance, building columns, surface and route layers, props/sites/anchors/start, the M1 checks
// (L000–L006, L010, L013) and the v1 encoding through src/sim/map.ts. SSP-034 adds the kerb blob autotile,
// collide bits, road markings and merged solids (tileLayers.ts, with the shared table read by kerbBlob.ts)
// and L014/L015/L020–L022 (layoutChecks.ts); M2/M3/M6 add frontages, spawns, graphs and budgets.
//
// Run: node tools/levels/compile-level.ts [--out <dir>] [--src <dir>] [--manifest <file>]
//   --out <dir>       output ROOT; levels go to <dir>/public/assets/levels/ (forge verify passes build/tmp/verify)
//   --src <dir>       directory of map/level pairs (default assets-src/levels)
//   --manifest <file> asset manifest for the roof and facade id check (default assets-src/manifest.json)
// Relative paths resolve against the working directory. Exit status: 0 ok, 1 a level has errors, 2 usage.
// The kerb blob table is always assets-src/procedural/tiles/kerb_blob.json (KERB_BLOB_PATH).
//
// Runs on plain Node 24 type stripping (no tsx): erasable syntax only, explicit `.ts` imports, Node built-ins
// and src/sim/** only (never three or src/render). Output is byte-deterministic: no timestamps, fixed order.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHIFT_S, TILE_M } from '../../src/sim/constants.ts';
import {
  AMBIENCE_ID_PATTERN,
  COLLIDE,
  createBlankLevel,
  encodeLevel,
  Ground,
  type Level,
  type LevelProp,
  type LevelSite,
  MAX_STOREYS,
  MUSIC_ID_PATTERN,
  mergeSolids,
  surfaceOfGround,
  type TileRect,
  type Weather,
} from '../../src/sim/map.ts';
import { KERB_BLOB_PATH, type KerbBlob, readKerbBlob } from './kerbBlob.ts';
import { checkLayout, type LayoutCode } from './layoutChecks.ts';
import type { Building, BuildingUse, Day, GroundName, LegendEntry, Mode, TimeOfDay } from './schema.ts';
import { computeTileLayers, isRoadGround } from './tileLayers.ts';

export { isRoadGround };

// ---------------------------------------------------------------------------------------------------------
// Legend (LEVEL_DESIGN §8.3)
// ---------------------------------------------------------------------------------------------------------

/** What a ground name compiles to: its Ground id, whether Bessie may drive on it and whether it is route area. */
export type GroundInfo = { readonly id: Ground; readonly drivable: boolean; readonly route: boolean };

/**
 * Ground name → id, drivable and route-area columns (LEVEL_DESIGN §8.3). Alley (`;`) is drivable and route
 * area only where it is at least 2 tiles wide (§7.3); the compiler applies that per cell.
 */
export const GROUNDS: { readonly [name in GroundName]: GroundInfo } = {
  void: { id: Ground.Void, drivable: false, route: false },
  road: { id: Ground.Road, drivable: true, route: true },
  road_one_way_e: { id: Ground.RoadOneWayE, drivable: true, route: true },
  road_one_way_w: { id: Ground.RoadOneWayW, drivable: true, route: true },
  road_one_way_n: { id: Ground.RoadOneWayN, drivable: true, route: true },
  road_one_way_s: { id: Ground.RoadOneWayS, drivable: true, route: true },
  pavement: { id: Ground.Pavement, drivable: true, route: true },
  cobbles: { id: Ground.Cobbles, drivable: true, route: true },
  alley: { id: Ground.Alley, drivable: true, route: true },
  grass: { id: Ground.Grass, drivable: true, route: false },
  yard: { id: Ground.Yard, drivable: true, route: true },
  apron: { id: Ground.Apron, drivable: true, route: false },
  water: { id: Ground.Water, drivable: false, route: false },
  sand: { id: Ground.Sand, drivable: false, route: false },
};

const GROUND_NAMES = Object.keys(GROUNDS) as GroundName[];

/** Ground ids indexed by id: drivable / route columns (Alley conditional, see GROUNDS). */
const GROUND_DRIVABLE: readonly boolean[] = idTable((g) => g.drivable);
const GROUND_ROUTE: readonly boolean[] = idTable((g) => g.route);

function idTable(pick: (g: GroundInfo) => boolean): boolean[] {
  const out: boolean[] = [];
  for (const name of GROUND_NAMES) out[GROUNDS[name].id] = pick(GROUNDS[name]);
  return out;
}

/**
 * Compiler-internal markers a default legend entry may carry beyond the authorable LegendEntry fields:
 * `dropped_kerb` (no kerb edge or kerb tile, SSP-034) and `parking_bay` (the PARKING_BAY marking, SSP-034;
 * parked-car spawns in M3, SSP-077). Levels cannot author them.
 */
export type LegendMark = 'dropped_kerb' | 'parking_bay';

/** A resolved legend entry: the authorable fields plus an optional compiler marker. */
export type LegendDef = LegendEntry & { readonly mark?: LegendMark };

/**
 * The built-in legend (LEVEL_DESIGN §8.3). `A`–`Z` (buildings), `0`–`9` (anchors) and `@` (start) are not
 * entries: they come from level.json and may not be redefined. An entry without `ground` inherits it.
 */
export const DEFAULT_LEGEND: { readonly [char: string]: LegendDef } = {
  // Ground.
  '#': { ground: 'road' },
  '>': { ground: 'road_one_way_e' },
  '<': { ground: 'road_one_way_w' },
  '^': { ground: 'road_one_way_n' },
  v: { ground: 'road_one_way_s' },
  '.': { ground: 'pavement' },
  ':': { ground: 'cobbles' },
  ';': { ground: 'alley' },
  ',': { ground: 'grass' },
  '%': { ground: 'yard' },
  '+': { ground: 'apron' },
  '~': { ground: 'water' },
  _: { ground: 'sand' },
  ' ': { ground: 'void' },
  // Road features (ground = road).
  z: { ground: 'road', site: 'site.zebra' },
  k: { ground: 'road', site: 'site.school_crossing' },
  b: { ground: 'road', site: 'site.bus_stop' },
  p: { ground: 'road', mark: 'parking_bay' },
  '=': { ground: 'road', haz: 'haz.speed_bump' },
  // Props (ground inherited).
  l: { prop: 'prop.lamp_post' },
  h: { prop: 'prop.hydrant' },
  n: { prop: 'prop.bench' },
  t: { prop: 'prop.tree' },
  i: { prop: 'prop.litter_bin' },
  u: { prop: 'prop.bus_shelter' },
  f: { prop: 'prop.phone_box' },
  q: { prop: 'prop.post_box' },
  '!': { prop: 'prop.bollard' },
  g: { prop: 'prop.planter' },
  m: { prop: 'prop.market_stall' },
  // Walls and hedges (solid, ground inherited).
  w: { solid: true },
  e: { solid: true },
  r: { solid: true },
  // Sites and markers.
  d: { ground: 'pavement', mark: 'dropped_kerb' },
  s: { site: 'site.skip' },
  $: { site: 'site.depot_bay' },
};

/** The start character: exactly one, inside `depot.rect` (L003). */
export const START_CHAR = '@';

const isBuildingChar = (c: string): boolean => c.length === 1 && c >= 'A' && c <= 'Z';
const isAnchorChar = (c: string): boolean => c.length === 1 && c >= '0' && c <= '9';
const isReservedChar = (c: string): boolean => isBuildingChar(c) || isAnchorChar(c) || c === START_CHAR;

/** A plain ground character: it fixes ground and nothing else. Only these feed ground inheritance. */
function isPlainGround(def: LegendDef): boolean {
  return (
    def.ground !== undefined &&
    def.prop === undefined &&
    def.site === undefined &&
    def.haz === undefined &&
    def.solid !== true &&
    def.mark === undefined
  );
}

// ---------------------------------------------------------------------------------------------------------
// Diagnostics (LEVEL_DESIGN §10.3)
// ---------------------------------------------------------------------------------------------------------

/**
 * A validation code. L000 (this compiler) is a level file pair or level.json that does not match schema.ts;
 * the rest are LEVEL_DESIGN §10.3. L005 covers only the music/ambience shape until entities.json (M2).
 * L014, L015 and L020–L022 are the layout checks (layoutChecks.ts, SSP-034).
 */
export type LevelCode =
  | 'L000'
  | 'L001'
  | 'L002'
  | 'L003'
  | 'L004'
  | 'L005'
  | 'L006'
  | 'L010'
  | 'L013'
  | LayoutCode;

export type Diagnostic = {
  /** File basename, e.g. `puddle_lane.map.txt`. */
  file: string;
  /** 1-based row (line). */
  row: number;
  /** 1-based column. */
  col: number;
  code: LevelCode;
  severity: 'error' | 'warning';
  message: string;
};

/** `puddle_lane.map.txt:8:23 L013 isolated road tile` (LEVEL_DESIGN §10.3). */
export function formatDiagnostic(d: Diagnostic): string {
  return `${d.file}:${d.row}:${d.col} ${d.code} ${d.message}`;
}

function compareDiagnostics(a: Diagnostic, b: Diagnostic): number {
  if (a.file !== b.file) return a.file < b.file ? -1 : 1;
  if (a.row !== b.row) return a.row - b.row;
  if (a.col !== b.col) return a.col - b.col;
  return a.code < b.code ? -1 : a.code > b.code ? 1 : 0;
}

/** 1-based row and column of a UTF-16 offset in `text`. */
function lineCol(text: string, offset: number): { row: number; col: number } {
  let row = 1;
  let lineStart = 0;
  const end = Math.min(Math.max(offset, 0), text.length);
  for (let i = 0; i < end; i += 1) {
    if (text.charCodeAt(i) === 10) {
      row += 1;
      lineStart = i + 1;
    }
  }
  return { row, col: end - lineStart + 1 };
}

/**
 * Where the key at `path` sits in a JSON text: each segment's quoted key is searched for after the previous
 * one, so nested keys resolve inside their parents. Used only for messages; falls back to the deepest key
 * found (or 1:1).
 */
export function locateJsonKey(text: string, path: readonly string[]): { row: number; col: number } {
  let from = 0;
  let found = -1;
  for (const key of path) {
    const re = new RegExp(`${escapeRegExp(JSON.stringify(key))}\\s*:`, 'g');
    re.lastIndex = from;
    const m = re.exec(text);
    if (m === null) break;
    found = m.index;
    from = m.index + m[0].length;
  }
  return found < 0 ? { row: 1, col: 1 } : lineCol(text, found);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------------------------------------
// level.json guards (schema.ts)
// ---------------------------------------------------------------------------------------------------------

type JsonObject = { [key: string]: unknown };

const isObject = (v: unknown): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

const DAYS: readonly (Day | 'any')[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun', 'any'];
const MODES: readonly Mode[] = ['shift', 'skip_run'];
const TIMES_OF_DAY: readonly TimeOfDay[] = [
  'dawn',
  'morning',
  'late_morning',
  'afternoon',
  'golden_hour',
  'night',
  'inherit',
];
const WEATHERS: readonly Weather[] = ['clear', 'rain', 'wind', 'gusts', 'inherit'];
const USES: readonly BuildingUse[] = ['house', 'shop', 'pub', 'takeaway', 'civic', 'unit', 'depot', 'none'];

/** Every top-level level.json field (schema.ts LevelFile). An unknown field is L000. */
const LEVEL_FIELDS: readonly string[] = [
  'schema',
  'id',
  'name',
  'day',
  'mode',
  'map',
  'size',
  'timer',
  'seed',
  'timeOfDay',
  'weather',
  'music',
  'ambience',
  'start',
  'depot',
  'legend',
  'buildings',
  'anchors',
  'junctions',
  'frontageWidth',
  'pledges',
  'litter',
  'grime',
  'stains',
  'hazards',
  'knockables',
  'powerups',
  'collectibles',
  'npcs',
  'traffic',
  'events',
  'skipRun',
  'par',
];
const LEGEND_FIELDS: readonly string[] = ['ground', 'prop', 'site', 'haz', 'solid', 'darkOk'];
const BUILDING_FIELDS: readonly string[] = [
  'storeys',
  'roof',
  'wall',
  'use',
  'landmark',
  'roofkit',
  'frontageWidth',
];

/** Timer each mode must use (L006): 240 s shifts, 45 s Skip Run (LEVEL_DESIGN §10.3, GDD). */
export const MODE_TIMER_S: { readonly [mode in Mode]: number } = { shift: SHIFT_S, skip_run: 45 };

/** Storey limits (L004): 1..6, or 1..MAX_STOREYS (8) with `landmark: true`. */
export const MAX_STOREYS_ORDINARY = 6;

/** The level.json fields the M1 compiler consumes, after the guards. */
type CheckedLevel = {
  id: string;
  mode: Mode;
  size: [number, number];
  timer: number;
  weather: Weather;
  music?: string;
  ambience?: string;
  headingIndex: number;
  /** [x, y, w, h] in tiles. */
  depot: [number, number, number, number];
  legend: { [char: string]: LegendDef };
  buildings: { [letter: string]: Building };
  anchors: { [digit: string]: string };
};

class Reporter {
  readonly diagnostics: Diagnostic[] = [];
  readonly file: string;
  readonly text: string;
  constructor(file: string, text: string) {
    this.file = file;
    this.text = text;
  }
  at(row: number, col: number, code: LevelCode, message: string): void {
    this.diagnostics.push({ file: this.file, row, col, code, severity: 'error', message });
  }
  key(path: readonly string[], code: LevelCode, message: string): void {
    const { row, col } = locateJsonKey(this.text, path);
    this.at(row, col, code, message);
  }
}

function parseJsonText(r: Reporter): unknown {
  try {
    return JSON.parse(r.text);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    let row = 1;
    let col = 1;
    const lc = /line (\d+) column (\d+)/.exec(msg);
    const pos = /position (\d+)/.exec(msg);
    if (lc !== null) {
      row = Number(lc[1]);
      col = Number(lc[2]);
    } else if (pos !== null) {
      ({ row, col } = lineCol(r.text, Number(pos[1])));
    }
    r.at(row, col, 'L000', `not valid JSON (${msg})`);
    return undefined;
  }
}

function checkLegend(r: Reporter, value: unknown): { [char: string]: LegendDef } {
  const legend: { [char: string]: LegendDef } = { ...DEFAULT_LEGEND };
  if (value === undefined) return legend;
  if (!isObject(value)) {
    r.key(['legend'], 'L000', 'legend must be an object');
    return legend;
  }
  for (const char of Object.keys(value)) {
    const path = ['legend', char];
    const code = char.length === 1 ? char.charCodeAt(0) : -1;
    if (code < 0x20 || code > 0x7e) {
      r.key(path, 'L002', `legend key ${JSON.stringify(char)} must be one printable ASCII character`);
      continue;
    }
    if (isReservedChar(char)) {
      r.key(path, 'L002', `legend may not redefine ${JSON.stringify(char)} (A–Z, 0–9 and @ are reserved)`);
      continue;
    }
    const entry = value[char];
    if (!isObject(entry)) {
      r.key(path, 'L000', `legend ${JSON.stringify(char)} must be an object`);
      continue;
    }
    const def: { -readonly [K in keyof LegendDef]: LegendDef[K] } = {};
    let ok = true;
    for (const field of Object.keys(entry)) {
      const v = entry[field];
      const where = `legend ${JSON.stringify(char)} ${field}`;
      if (!LEGEND_FIELDS.includes(field)) {
        r.key([...path, field], 'L000', `${where} is not a legend field (${LEGEND_FIELDS.join(', ')})`);
        ok = false;
      } else if (field === 'ground') {
        const g = GROUND_NAMES.find((n) => n === v);
        if (g === undefined) {
          r.key([...path, field], 'L000', `${where} must be one of ${GROUND_NAMES.join(', ')}`);
          ok = false;
        } else def.ground = g;
      } else if (field === 'prop' || field === 'site' || field === 'haz') {
        const prefix = `${field}.`;
        if (typeof v !== 'string' || !/^[a-z]+\.[a-z0-9_]+$/.test(v) || !v.startsWith(prefix)) {
          r.key([...path, field], 'L000', `${where} must be a ${prefix}* id`);
          ok = false;
        } else if (field === 'prop') def.prop = v as `prop.${string}`;
        else if (field === 'site') def.site = v as `site.${string}`;
        else def.haz = v as `haz.${string}`;
      } else if (typeof v !== 'boolean') {
        r.key([...path, field], 'L000', `${where} must be a boolean`);
        ok = false;
      } else if (field === 'solid') def.solid = v;
      else def.darkOk = v;
    }
    // An invalid entry still defines the character (as an empty entry), so the map does not also report
    // every use of it as L002; the L000 above already fails the level.
    legend[char] = ok ? def : {};
  }
  return legend;
}

function checkBuildings(r: Reporter, value: unknown, known: ReadonlySet<string>): { [k: string]: Building } {
  const out: { [k: string]: Building } = {};
  if (!isObject(value)) {
    r.key(['buildings'], 'L000', 'buildings must be an object keyed "A".."Z"');
    return out;
  }
  for (const letter of Object.keys(value)) {
    const path = ['buildings', letter];
    if (!isBuildingChar(letter)) {
      r.key(path, 'L000', `building key ${JSON.stringify(letter)} must be one letter A–Z`);
      continue;
    }
    const b = value[letter];
    if (!isObject(b)) {
      r.key(path, 'L000', `building ${letter} must be an object`);
      continue;
    }
    let ok = true;
    for (const field of Object.keys(b)) {
      if (!BUILDING_FIELDS.includes(field)) {
        r.key([...path, field], 'L000', `building ${letter} ${field} is not a building field`);
        ok = false;
      }
    }
    const landmark = b.landmark;
    if (landmark !== undefined && typeof landmark !== 'boolean') {
      r.key([...path, 'landmark'], 'L000', `building ${letter} landmark must be a boolean`);
      ok = false;
    }
    const maxStoreys = landmark === true ? MAX_STOREYS : MAX_STOREYS_ORDINARY;
    if (!isInt(b.storeys) || b.storeys < 1 || b.storeys > maxStoreys) {
      const rule = landmark === true ? `1–${MAX_STOREYS} for a landmark` : `1–${MAX_STOREYS_ORDINARY}`;
      r.key(
        b.storeys === undefined ? path : [...path, 'storeys'],
        'L004',
        `building ${letter} storeys ${JSON.stringify(b.storeys ?? null)} is outside ${rule}`,
      );
      ok = false;
    }
    for (const [field, prefix] of [
      ['roof', 'roof.'],
      ['wall', 'facade.'],
    ] as const) {
      const id = b[field];
      if (typeof id !== 'string' || !id.startsWith(prefix)) {
        r.key(
          id === undefined ? path : [...path, field],
          'L000',
          `building ${letter} ${field} must be a ${prefix}* id`,
        );
        ok = false;
      } else if (!known.has(id)) {
        r.key(
          [...path, field],
          'L004',
          `building ${letter} ${field} ${id} is not in assets-src/manifest.json`,
        );
        ok = false;
      }
    }
    if (typeof b.use !== 'string' || !USES.some((u) => u === b.use)) {
      r.key(
        b.use === undefined ? path : [...path, 'use'],
        'L000',
        `building ${letter} use must be one of ${USES.join(', ')}`,
      );
      ok = false;
    }
    if (
      b.roofkit !== undefined &&
      !(Array.isArray(b.roofkit) && b.roofkit.every((k) => typeof k === 'string'))
    ) {
      r.key([...path, 'roofkit'], 'L000', `building ${letter} roofkit must be an array of strings`);
      ok = false;
    }
    if (b.frontageWidth !== undefined && !(isInt(b.frontageWidth) && b.frontageWidth >= 1)) {
      r.key(
        [...path, 'frontageWidth'],
        'L000',
        `building ${letter} frontageWidth must be a positive integer`,
      );
      ok = false;
    }
    // Defined even when invalid, so the map does not also report its cells as L002; the error above already
    // fails the level before any building is used.
    if (ok || isObject(b)) out[letter] = b as unknown as Building;
  }
  return out;
}

function checkAnchors(r: Reporter, value: unknown): { [digit: string]: string } {
  const out: { [digit: string]: string } = {};
  if (value === undefined) return out;
  if (!isObject(value)) {
    r.key(['anchors'], 'L000', 'anchors must be an object keyed "0".."9"');
    return out;
  }
  for (const digit of Object.keys(value)) {
    const name = value[digit];
    if (!isAnchorChar(digit))
      r.key(['anchors', digit], 'L000', `anchor key ${JSON.stringify(digit)} must be one digit 0–9`);
    else if (typeof name !== 'string' || !/^[a-z0-9_]+$/.test(name))
      r.key(['anchors', digit], 'L000', `anchor ${digit} name must be a snake_case string`);
    else out[digit] = name;
  }
  return out;
}

/** Guard a parsed level.json against schema.ts; null when a field the map checks need is unusable. */
function checkLevelFile(
  r: Reporter,
  root: unknown,
  name: string,
  known: ReadonlySet<string>,
): CheckedLevel | null {
  if (!isObject(root)) {
    r.at(1, 1, 'L000', 'level.json must be an object');
    return null;
  }
  const bad = (field: string, message: string, code: LevelCode = 'L000'): void =>
    root[field] === undefined
      ? r.at(1, 1, code, `missing field ${field}: ${message}`)
      : r.key([field], code, `${field} ${message}`);

  for (const field of Object.keys(root)) {
    if (!LEVEL_FIELDS.includes(field))
      r.key([field], 'L000', `${field} is not a level.json field (schema.ts)`);
  }
  if (root.schema !== 1) bad('schema', 'must be 1');
  const id = root.id;
  if (typeof id !== 'string' || !/^district\.[a-z0-9_]+$/.test(id))
    bad('id', 'must be a district.<snake_name> id');
  if (typeof root.name !== 'string' || root.name.length === 0) bad('name', 'must be a non-empty string');
  if (!DAYS.some((d) => d === root.day)) bad('day', `must be one of ${DAYS.join(', ')}`);
  const mode = MODES.find((m) => m === root.mode);
  if (mode === undefined) bad('mode', `must be one of ${MODES.join(', ')}`);
  const mapName = `${name}.map.txt`;
  if (root.map !== mapName) bad('map', `must be ${JSON.stringify(mapName)} (the pair's own map)`);
  const size = root.size;
  const sizeOk =
    Array.isArray(size) && size.length === 2 && size.every((n) => isInt(n) && n >= 1 && n <= 4096);
  if (!sizeOk) bad('size', 'must be [w, h], integers 1..4096');
  const timer = root.timer;
  if (typeof timer !== 'number' || !Number.isFinite(timer)) bad('timer', 'must be a number');
  else if (mode !== undefined && timer !== MODE_TIMER_S[mode])
    bad('timer', `is ${timer}; a ${mode} level must use ${MODE_TIMER_S[mode]}`, 'L006');
  if (!isInt(root.seed) || root.seed < 0 || root.seed > 0xffff_ffff) bad('seed', 'must be a uint32');
  if (!TIMES_OF_DAY.some((t) => t === root.timeOfDay))
    bad('timeOfDay', `must be one of ${TIMES_OF_DAY.join(', ')}`);
  const weather = WEATHERS.find((w) => w === root.weather);
  if (weather === undefined) bad('weather', `must be one of ${WEATHERS.join(', ')}`);

  const audio: { music?: string; ambience?: string } = {};
  for (const [field, pattern] of [
    ['music', MUSIC_ID_PATTERN],
    ['ambience', AMBIENCE_ID_PATTERN],
  ] as const) {
    const v = root[field];
    if (v === undefined) continue;
    if (typeof v !== 'string' || !pattern.test(v))
      r.key([field], 'L005', `${field} ${JSON.stringify(v)} is not a canonical id (must match ${pattern})`);
    else audio[field] = v;
  }

  const start = root.start;
  const heading = isObject(start) ? start.heading : undefined;
  const headingOk = isInt(heading) && heading >= 0 && heading <= 31;
  if (!headingOk) bad('start', 'must be { heading: 0..31 }');

  const depot = root.depot;
  const rect = isObject(depot) ? depot.rect : undefined;
  let depotRect: [number, number, number, number] | null = null;
  if (Array.isArray(rect) && rect.length === 4 && rect.every(isInt)) {
    const [x = 0, y = 0, w = 0, h = 0] = rect;
    if (w < 1 || h < 1 || x < 0 || y < 0 || (sizeOk && (x + w > size[0] || y + h > size[1]))) {
      bad('depot', `rect [${rect.join(', ')}] must have w, h ≥ 1 and lie inside the map`);
    } else depotRect = [x, y, w, h];
  } else bad('depot', 'must be { rect: [x, y, w, h] } in tiles');

  const legend = checkLegend(r, root.legend);
  const buildings = checkBuildings(r, root.buildings, known);
  const anchors = checkAnchors(r, root.anchors);

  if (
    root.pledges !== undefined &&
    !(Array.isArray(root.pledges) && root.pledges.every((p) => typeof p === 'string'))
  )
    bad('pledges', 'must be an array of frontage ids');
  for (const field of ['litter', 'grime'] as const) {
    if (root[field] !== undefined && !isObject(root[field])) bad(field, 'must be an object');
  }

  if (typeof id !== 'string' || mode === undefined || !sizeOk || timer === undefined || weather === undefined)
    return null;
  if (!headingOk || depotRect === null) return null;
  return {
    id,
    mode,
    size: [size[0], size[1]],
    timer: typeof timer === 'number' ? timer : SHIFT_S,
    weather,
    ...audio,
    headingIndex: heading,
    depot: depotRect,
    legend,
    buildings,
    anchors,
  };
}

// ---------------------------------------------------------------------------------------------------------
// Map parse (L001, L002)
// ---------------------------------------------------------------------------------------------------------

/** Split and check map text (LEVEL_DESIGN §8.2). Returns the rows, or null after reporting L001. */
function parseMapText(r: Reporter, w: number, h: number): string[] | null {
  const text = r.text;
  const before = r.diagnostics.length;
  const endsWithNewline = text.endsWith('\n');
  const body = endsWithNewline ? text.slice(0, -1) : text;
  const rows = body.length === 0 && endsWithNewline ? [''] : body.split('\n');
  for (let y = 0; y < rows.length; y += 1) {
    const row = rows[y] ?? '';
    let col = 0;
    for (const ch of row) {
      col += 1;
      const code = ch.codePointAt(0) ?? 0;
      if (code === 9) r.at(y + 1, col, 'L001', 'tab character (maps use one ASCII character per tile)');
      else if (code === 13) r.at(y + 1, col, 'L001', 'CR character (use LF line endings)');
      else if (code > 0x7e)
        r.at(y + 1, col, 'L001', `non-ASCII character U+${code.toString(16).toUpperCase().padStart(4, '0')}`);
      else if (code < 0x20)
        r.at(y + 1, col, 'L001', `control character 0x${code.toString(16).padStart(2, '0')}`);
    }
    const trimmed = row.replace(/[ \t]+$/, '');
    if (trimmed.length !== row.length) r.at(y + 1, trimmed.length + 1, 'L001', 'trailing whitespace');
  }
  if (!endsWithNewline) {
    const last = rows[rows.length - 1] ?? '';
    r.at(rows.length, last.length + 1, 'L001', 'missing final newline');
  }
  if (rows.length !== h) {
    const row = Math.min(rows.length, h) + 1;
    r.at(row, 1, 'L001', `map has ${rows.length} rows; level.json size says ${h}`);
  }
  for (let y = 0; y < Math.min(rows.length, h); y += 1) {
    const len = (rows[y] ?? '').length;
    if (len !== w)
      r.at(y + 1, Math.min(len, w) + 1, 'L001', `row has ${len} columns; level.json size says ${w}`);
  }
  return r.diagnostics.length === before ? rows : null;
}

// ---------------------------------------------------------------------------------------------------------
// Resolve (ground inheritance, drivability, buildings)
// ---------------------------------------------------------------------------------------------------------

/** One placed building: orthogonally connected cells of the same letter (LEVEL_DESIGN §8.2 rule 4). */
export type BuildingInstance = {
  letter: string;
  /** Tiles covered. */
  cells: number;
  /** Bounding box in tiles, x1/y1 exclusive. */
  bounds: TileRect;
  storeys: number;
  roof: string;
  wall: string;
  use: BuildingUse;
};

/** An anchor digit placed on the map. Not written to the compiled JSON in M1 (M3 tags nav nodes, SSP-076). */
export type AnchorPoint = { char: string; name: string; tile: [x: number, y: number] };

/** The resolved map, kept for the compiler stages SSP-034 and later milestones add. Row-major, w·h. */
export type ResolvedMap = {
  w: number;
  h: number;
  rows: string[];
  /** Legend entry per cell, or null for building, anchor and start cells. */
  defs: (LegendDef | null)[];
  /** Resolved Ground id per cell (buildings are Void). */
  ground: Uint8Array;
  /** 1 = Bessie may drive here (L010). */
  drivable: Uint8Array;
  /** 1 = a solid legend cell (wall, hedge, railing) or a building cell. */
  solid: Uint8Array;
  /** Index into `buildings`, or −1. */
  building: Int16Array;
};

/**
 * Ground of a cell whose legend entry does not fix one (props, sites, solids, anchors, start): the most
 * common ground among its orthogonal neighbours that are plain ground characters (LEVEL_DESIGN §8.3). Ties
 * go to pavement; a tie without pavement goes to the lowest Ground id; no plain-ground neighbour means
 * pavement.
 */
export function inheritGround(neighbourGrounds: readonly number[]): number {
  const counts = new Map<number, number>();
  for (const g of neighbourGrounds) counts.set(g, (counts.get(g) ?? 0) + 1);
  let best: number = Ground.Pavement;
  let bestCount = 0;
  for (const [g, n] of [...counts.entries()].sort((a, b) => a[0] - b[0])) {
    if (n > bestCount) {
      best = g;
      bestCount = n;
    }
  }
  if (bestCount > 0 && (counts.get(Ground.Pavement) ?? 0) === bestCount) return Ground.Pavement;
  return best;
}

const NEIGHBOURS: readonly [number, number][] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

function resolveMap(
  rows: string[],
  w: number,
  h: number,
  lvl: CheckedLevel,
): { map: ResolvedMap; buildings: BuildingInstance[] } {
  const n = w * h;
  const charAt = (x: number, y: number): string => (rows[y] ?? '')[x] ?? ' ';
  const defs: (LegendDef | null)[] = new Array<LegendDef | null>(n).fill(null);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const c = charAt(x, y);
      defs[y * w + x] = isReservedChar(c) ? null : (lvl.legend[c] ?? null);
    }
  }
  const ground = new Uint8Array(n);
  const solid = new Uint8Array(n);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      const def = defs[i] ?? null;
      if (isBuildingChar(charAt(x, y))) {
        ground[i] = Ground.Void;
        solid[i] = 1;
        continue;
      }
      if (def?.solid === true) solid[i] = 1;
      if (def?.ground !== undefined) {
        ground[i] = GROUNDS[def.ground].id;
        continue;
      }
      const around: number[] = [];
      for (const [dx, dy] of NEIGHBOURS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const nd = defs[ny * w + nx] ?? null;
        if (nd !== null && nd.ground !== undefined && isPlainGround(nd)) around.push(GROUNDS[nd.ground].id);
      }
      ground[i] = inheritGround(around);
    }
  }
  // Alleys are drivable only where at least 2 wide: the cell lies in some 2×2 block of non-solid alley.
  const alleyOpen = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < w && y < h && ground[y * w + x] === Ground.Alley && solid[y * w + x] === 0;
  const drivable = new Uint8Array(n);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      const g = ground[i] ?? 0;
      if (solid[i] === 1 || GROUND_DRIVABLE[g] !== true) continue;
      if (g === Ground.Alley) {
        let wide = false;
        for (const [ox, oy] of [
          [0, 0],
          [-1, 0],
          [0, -1],
          [-1, -1],
        ] as const) {
          const bx = x + ox;
          const by = y + oy;
          if (
            alleyOpen(bx, by) &&
            alleyOpen(bx + 1, by) &&
            alleyOpen(bx, by + 1) &&
            alleyOpen(bx + 1, by + 1)
          ) {
            wide = true;
            break;
          }
        }
        if (!wide) continue;
      }
      drivable[i] = 1;
    }
  }
  // Buildings: flood-fill same-letter components in row-major discovery order.
  const building = new Int16Array(n).fill(-1);
  const buildings: BuildingInstance[] = [];
  const stack: number[] = [];
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const letter = charAt(x, y);
      if (!isBuildingChar(letter) || building[y * w + x] !== -1) continue;
      const def = lvl.buildings[letter];
      if (def === undefined) continue;
      const index = buildings.length;
      let cells = 0;
      let [x0, y0, x1, y1] = [x, y, x + 1, y + 1];
      building[y * w + x] = index;
      stack.push(y * w + x);
      while (stack.length > 0) {
        const i = stack.pop() ?? 0;
        const cx = i % w;
        const cy = (i - cx) / w;
        cells += 1;
        x0 = Math.min(x0, cx);
        y0 = Math.min(y0, cy);
        x1 = Math.max(x1, cx + 1);
        y1 = Math.max(y1, cy + 1);
        for (const [dx, dy] of NEIGHBOURS) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = ny * w + nx;
          if (building[j] === -1 && charAt(nx, ny) === letter) {
            building[j] = index;
            stack.push(j);
          }
        }
      }
      buildings.push({
        letter,
        cells,
        bounds: [x0, y0, x1, y1],
        storeys: def.storeys,
        roof: def.roof,
        wall: def.wall,
        use: def.use,
      });
    }
  }
  return { map: { w, h, rows, defs, ground, drivable, solid, building }, buildings };
}

// ---------------------------------------------------------------------------------------------------------
// Compile one pair
// ---------------------------------------------------------------------------------------------------------

export type CompileInput = {
  /** Pair name: the file stem, e.g. `puddle_lane`. The output is `<name>.json`. */
  name: string;
  mapText: string;
  levelText: string;
  /** Asset ids from assets-src/manifest.json (the roof and facade id check, L004). */
  knownAssetIds: ReadonlySet<string>;
  /** The kerb blob table (readKerbBlob(KERB_BLOB_PATH)); the compiler never holds its own copy. */
  kerbBlob: KerbBlob;
  /**
   * Layout codes not to check. Only unit tests set it, to compile tiny maps that exercise other rules
   * without two depot bays and a hydrant; the CLI always checks everything.
   */
  skipCodes?: readonly LayoutCode[];
};

export type CompileOutput = {
  level: Level;
  /** The compiled JSON text (encodeLevel). */
  text: string;
  buildings: BuildingInstance[];
  anchors: AnchorPoint[];
  map: ResolvedMap;
};

export type CompileResult = {
  /** Every diagnostic, sorted by file, row, column and code. */
  diagnostics: Diagnostic[];
  /** Present only when there are no errors. */
  output: CompileOutput | null;
};

/** Compile one map/level.json pair. Pure: no fs; the same input always gives the same result. */
export function compileLevel(input: CompileInput): CompileResult {
  const mapFile = `${input.name}.map.txt`;
  const levelFile = `${input.name}.level.json`;
  const mr = new Reporter(mapFile, input.mapText);
  const lr = new Reporter(levelFile, input.levelText);
  const finish = (output: CompileOutput | null): CompileResult => {
    const diagnostics = [...mr.diagnostics, ...lr.diagnostics].sort(compareDiagnostics);
    return { diagnostics, output: diagnostics.some((d) => d.severity === 'error') ? null : output };
  };

  const root = parseJsonText(lr);
  if (root === undefined) return finish(null);
  const lvl = checkLevelFile(lr, root, input.name, input.knownAssetIds);
  if (lvl === null) return finish(null);
  const [w, h] = lvl.size;

  const rows = parseMapText(mr, w, h);
  if (rows === null) return finish(null);

  // L002: every character must be known. L003: exactly one @, inside depot.rect.
  const starts: [number, number][] = [];
  for (let y = 0; y < h; y += 1) {
    const row: string = rows[y] ?? '';
    for (let x = 0; x < w; x += 1) {
      const c = row[x] ?? ' ';
      if (c === START_CHAR) starts.push([x, y]);
      else if (isBuildingChar(c)) {
        if (lvl.buildings[c] === undefined)
          mr.at(y + 1, x + 1, 'L002', `unknown character ${JSON.stringify(c)}: not in level.json buildings`);
      } else if (isAnchorChar(c)) {
        if (lvl.anchors[c] === undefined)
          mr.at(y + 1, x + 1, 'L002', `unknown character ${JSON.stringify(c)}: not in level.json anchors`);
      } else if (lvl.legend[c] === undefined) {
        mr.at(y + 1, x + 1, 'L002', `unknown character ${JSON.stringify(c)}: not in the legend`);
      }
    }
  }
  const [dx, dy, dw, dh] = lvl.depot;
  if (starts.length === 0) mr.at(1, 1, 'L003', `no ${START_CHAR} start in the map (exactly one is required)`);
  for (const [i, [x, y]] of starts.entries()) {
    if (i > 0) mr.at(y + 1, x + 1, 'L003', `more than one ${START_CHAR} (${starts.length} found)`);
    else if (x < dx || y < dy || x >= dx + dw || y >= dy + dh)
      mr.at(y + 1, x + 1, 'L003', `${START_CHAR} lies outside depot.rect [${lvl.depot.join(', ')}]`);
  }
  if (mr.diagnostics.length > 0 || lr.diagnostics.length > 0) return finish(null);
  const [sx, sy] = starts[0] ?? [0, 0];

  const { map, buildings } = resolveMap(rows, w, h, lvl);

  // L010: the drivable area is one connected region reachable from @.
  const reached = new Uint8Array(w * h);
  const flood = (seed: number, mark: Uint8Array): number => {
    const queue = [seed];
    mark[seed] = 1;
    let count = 0;
    for (let head = 0; head < queue.length; head += 1) {
      const i = queue[head] ?? 0;
      count += 1;
      const cx = i % w;
      const cy = (i - cx) / w;
      for (const [ddx, ddy] of NEIGHBOURS) {
        const nx = cx + ddx;
        const ny = cy + ddy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (mark[j] === 0 && map.drivable[j] === 1) {
          mark[j] = 1;
          queue.push(j);
        }
      }
    }
    return count;
  };
  const startIndex = sy * w + sx;
  if (map.drivable[startIndex] === 1) flood(startIndex, reached);
  else mr.at(sy + 1, sx + 1, 'L010', `${START_CHAR} is not on a drivable tile`);
  for (let i = 0; i < w * h; i += 1) {
    if (map.drivable[i] !== 1 || reached[i] === 1) continue;
    const size = flood(i, reached);
    const x = i % w;
    const y = (i - x) / w;
    mr.at(y + 1, x + 1, 'L010', `drivable area of ${size} tile(s) not reachable from ${START_CHAR}`);
  }

  // L013: a road tile with no orthogonal road neighbour.
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (!isRoadGround(map.ground[y * w + x] ?? 0)) continue;
      const linked = NEIGHBOURS.some(([ddx, ddy]) => {
        const nx = x + ddx;
        const ny = y + ddy;
        return nx >= 0 && ny >= 0 && nx < w && ny < h && isRoadGround(map.ground[ny * w + nx] ?? 0);
      });
      if (!linked) mr.at(y + 1, x + 1, 'L013', 'isolated road tile');
    }
  }
  if (mr.diagnostics.length > 0) return finish(null);

  // Layout checks (L014, L015, L020–L022) over the route mask.
  const route = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i += 1)
    route[i] = map.drivable[i] === 1 && GROUND_ROUTE[map.ground[i] ?? 0] === true ? 1 : 0;
  const skip = new Set<LevelCode>(input.skipCodes ?? []);
  for (const f of checkLayout(map, route, lvl.mode)) {
    if (!skip.has(f.code)) mr.at(f.y + 1, f.x + 1, f.code, f.message);
  }
  if (mr.diagnostics.length > 0) return finish(null);

  // Layers.
  const level = createBlankLevel(lvl.id, w, h);
  const L = level.layers;
  const roofIds = [...new Set(buildings.map((b) => b.roof))].sort();
  const wallIds = [...new Set(buildings.map((b) => b.wall))].sort();
  level.roofIds = roofIds;
  level.wallIds = wallIds;
  for (let i = 0; i < w * h; i += 1) {
    const g = map.ground[i] ?? 0;
    L.ground[i] = g;
    L.surface[i] = surfaceOfGround(g);
    L.route[i] = route[i] ?? 0;
    const b = buildings[map.building[i] ?? -1];
    if (b !== undefined) {
      L.storeys[i] = b.storeys;
      L.roof[i] = roofIds.indexOf(b.roof) + 1;
      L.wall[i] = wallIds.indexOf(b.wall) + 1;
    }
  }
  // Kerb blob autotile, collide bits and road markings (SSP-034); SOLID cells merged into rects.
  const tiles = computeTileLayers(map, input.kerbBlob);
  L.autotile.set(tiles.autotile);
  L.collide.set(tiles.collide);
  L.markings.set(tiles.markings);
  level.solids = mergeSolids(L.collide, w, h);
  // grimeDensity and gutter stay 0 until SSP-054; lanes/nav stay empty stubs until M3 (SSP-076).

  // Props: one per cell, at the tile centre in metres, rot 0, row-major.
  const props: LevelProp[] = [];
  const anchors: AnchorPoint[] = [];
  const siteMasks = new Map<string, Uint8Array>();
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      const c = rows[y]?.[x] ?? ' ';
      if (isAnchorChar(c)) anchors.push({ char: c, name: lvl.anchors[c] ?? '', tile: [x, y] });
      const def = map.defs[i] ?? null;
      if (def === null) continue;
      if (def.prop !== undefined)
        props.push({ id: def.prop, x: (x + 0.5) * TILE_M, y: (y + 0.5) * TILE_M, rot: 0 });
      // Map-placed hazards (`=` speed bumps) are static tile features, so they are written as sites.
      for (const id of [def.site, def.haz]) {
        if (id === undefined) continue;
        let mask = siteMasks.get(id);
        if (mask === undefined) {
          mask = new Uint8Array(w * h);
          siteMasks.set(id, mask);
        }
        mask[i] = COLLIDE.SOLID;
      }
    }
  }
  // Sites: each id's cells merged into maximal rectangles (the solid merge on a mask), sorted north-west first.
  const sites: LevelSite[] = [];
  for (const [id, mask] of siteMasks) {
    for (const rect of mergeSolids(mask, w, h)) sites.push({ id, rect });
  }
  sites.sort(
    (a, b) => a.rect[1] - b.rect[1] || a.rect[0] - b.rect[0] || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );

  level.props = props;
  level.sites = sites;
  level.weather = lvl.weather;
  level.timerS = lvl.timer;
  if (lvl.music !== undefined) level.music = lvl.music;
  if (lvl.ambience !== undefined) level.ambience = lvl.ambience;
  level.player = {
    x: (sx + 0.5) * TILE_M,
    y: (sy + 0.5) * TILE_M,
    heading: (lvl.headingIndex * Math.PI) / 16,
  };

  return finish({ level, text: encodeLevel(level), buildings, anchors, map });
}

// ---------------------------------------------------------------------------------------------------------
// Files and CLI
// ---------------------------------------------------------------------------------------------------------

const MAP_SUFFIX = '.map.txt';
const LEVEL_SUFFIX = '.level.json';

/** Output directory under an output root. */
export const LEVELS_OUT_DIR = 'public/assets/levels';

/** Pair names found in a source directory, sorted by code unit, plus any file missing its partner. */
export function listLevelPairs(srcDir: string): { names: string[]; orphans: string[] } {
  let files: string[];
  try {
    files = readdirSync(srcDir, { withFileTypes: true })
      .filter((e) => e.isFile() && !e.name.startsWith('.'))
      .map((e) => e.name);
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') return { names: [], orphans: [] };
    throw err;
  }
  const maps = new Set(
    files.filter((f) => f.endsWith(MAP_SUFFIX)).map((f) => f.slice(0, -MAP_SUFFIX.length)),
  );
  const levels = new Set(
    files.filter((f) => f.endsWith(LEVEL_SUFFIX)).map((f) => f.slice(0, -LEVEL_SUFFIX.length)),
  );
  const byCode = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  const names = [...maps].filter((n) => levels.has(n)).sort(byCode);
  const orphans = [
    ...[...maps].filter((n) => !levels.has(n)).map((n) => n + MAP_SUFFIX),
    ...[...levels].filter((n) => !maps.has(n)).map((n) => n + LEVEL_SUFFIX),
  ].sort(byCode);
  return { names, orphans };
}

/** Every asset id in a manifest file (`{ assets: [{ id }] }`). Throws on an unreadable or malformed file. */
export function readManifestIds(path: string): Set<string> {
  const doc: unknown = JSON.parse(readFileSync(path, 'utf8'));
  const assets = isObject(doc) ? doc.assets : undefined;
  if (!Array.isArray(assets)) throw new Error(`${path}: expected { "assets": [...] }`);
  const ids = new Set<string>();
  for (const a of assets) if (isObject(a) && typeof a.id === 'string') ids.add(a.id);
  return ids;
}

export type CliArgs = { outDir: string | null; srcDir: string | null; manifest: string | null };

/** Parses `--out`, `--src` and `--manifest` (each as `--x v` or `--x=v`); anything else is an error. */
export function parseArgs(argv: readonly string[]): CliArgs | { error: string } {
  const out: { -readonly [K in keyof CliArgs]: CliArgs[K] } = { outDir: null, srcDir: null, manifest: null };
  const flags = { '--out': 'outDir', '--src': 'srcDir', '--manifest': 'manifest' } as const;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    const eq = arg.indexOf('=');
    const flag = eq < 0 ? arg : arg.slice(0, eq);
    const key = flag === '--out' || flag === '--src' || flag === '--manifest' ? flags[flag] : undefined;
    if (key === undefined) return { error: `unrecognised argument: ${arg}` };
    let value: string | undefined;
    if (eq >= 0) value = arg.slice(eq + 1);
    else {
      value = argv[i + 1];
      i += 1;
    }
    if (value === undefined || value.length === 0 || value.startsWith('--'))
      return { error: `${flag} requires a path argument` };
    out[key] = value;
  }
  return out;
}

export type CliIo = { log: (line: string) => void; error: (line: string) => void };

/** Runs the compiler over every pair and returns the exit status (0 ok, 1 errors, 2 usage). */
export function runCompileLevel(
  argv: readonly string[],
  repoRoot: string,
  cwd: string = process.cwd(),
  io: CliIo = { log: console.log, error: console.error },
): number {
  const args = parseArgs(argv);
  if ('error' in args) {
    io.error(`compile-level: ${args.error}`);
    io.error('usage: node tools/levels/compile-level.ts [--out <dir>] [--src <dir>] [--manifest <file>]');
    return 2;
  }
  const srcDir = args.srcDir === null ? join(repoRoot, 'assets-src/levels') : resolve(cwd, args.srcDir);
  const outRoot = args.outDir === null ? repoRoot : resolve(cwd, args.outDir);
  const manifestPath =
    args.manifest === null ? join(repoRoot, 'assets-src/manifest.json') : resolve(cwd, args.manifest);
  const shown = (p: string): string => relative(cwd, p) || '.';

  const { names, orphans } = listLevelPairs(srcDir);
  let failed = 0;
  for (const orphan of orphans) {
    const partner = orphan.endsWith(MAP_SUFFIX)
      ? orphan.slice(0, -MAP_SUFFIX.length) + LEVEL_SUFFIX
      : orphan.slice(0, -LEVEL_SUFFIX.length) + MAP_SUFFIX;
    io.error(
      formatDiagnostic({
        file: orphan,
        row: 1,
        col: 1,
        code: 'L000',
        severity: 'error',
        message: `no matching ${partner}`,
      }),
    );
    failed += 1;
  }
  if (names.length === 0) {
    if (failed > 0) return 1;
    io.log(`compile-level: 0 sources; nothing to compile [${shown(srcDir)}/*${MAP_SUFFIX}]`);
    return 0;
  }

  let known: Set<string>;
  try {
    known = readManifestIds(manifestPath);
  } catch (error) {
    io.error(`compile-level: cannot read manifest ${shown(manifestPath)}: ${String(error)}`);
    return 1;
  }
  const kerbBlobPath = join(repoRoot, KERB_BLOB_PATH);
  let kerbBlob: KerbBlob;
  try {
    kerbBlob = readKerbBlob(kerbBlobPath);
  } catch (error) {
    io.error(`compile-level: cannot read the kerb blob table ${shown(kerbBlobPath)}: ${String(error)}`);
    return 1;
  }

  const outDir = join(outRoot, LEVELS_OUT_DIR);
  let compiled = 0;
  for (const name of names) {
    const result = compileLevel({
      name,
      mapText: readFileSync(join(srcDir, name + MAP_SUFFIX), 'utf8'),
      levelText: readFileSync(join(srcDir, name + LEVEL_SUFFIX), 'utf8'),
      knownAssetIds: known,
      kerbBlob,
    });
    for (const d of result.diagnostics) (d.severity === 'error' ? io.error : io.log)(formatDiagnostic(d));
    if (result.output === null) {
      failed += 1;
      continue;
    }
    mkdirSync(outDir, { recursive: true });
    const target = join(outDir, `${name}.json`);
    writeFileSync(target, result.output.text);
    const { level } = result.output;
    io.log(`compile-level: ${level.id} ${level.size[0]}x${level.size[1]} → ${shown(target)}`);
    compiled += 1;
  }
  io.log(`compile-level: ${compiled} compiled, ${failed} failed`);
  return failed > 0 ? 1 : 0;
}

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly && basename(process.argv[1] ?? '') === 'compile-level.ts') {
  process.exitCode = runCompileLevel(process.argv.slice(2), repoRoot);
}
