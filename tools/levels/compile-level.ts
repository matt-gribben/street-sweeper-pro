// Level compiler: assets-src/levels/<name>.map.txt + <name>.level.json → public/assets/levels/<name>.json
// (LEVEL_DESIGN §8, §10; TECHNICAL_DESIGN §15). SSP-033 builds the core: map parse, legend and overrides,
// ground inheritance, building columns, surface and route layers, props/sites/anchors/start, the M1 checks
// (L000–L006, L010) and the v1 encoding through src/sim/map.ts. SSP-034 adds the kerb blob autotile,
// collide bits, road markings and merged solids (tileLayers.ts, with the shared table read by kerbBlob.ts)
// and L014/L015/L020–L022 (layoutChecks.ts). SSP-054 adds the M2 spawn layers (spawnLayers.ts): the grime
// `gutter` cells and zone `grimeDensity`, the litter weight field (`spawns.litter`), the grime counts
// (`spawns.grime`), the LitterSpec/GrimeSpec guards and L050/L051. SSP-055 adds frontages (frontages.ts) and
// pledge resolution, one site per depot bay and skip, the depot.rect rules of L020, the frontageWidth,
// pledges, powerups and collectibles guards, and L030/L031 (pledges), L040 (power-ups) and L041
// (collectibles). SSP-076 adds the traffic lane graph and L011–L013 (laneGraph.ts), the pavement nav graph
// (navGraph.ts) and the level.json → junctions guard. SSP-077 adds the M3 spawn specs (spawnSpecs.ts): the
// npcs, traffic, hazards, knockables and events guards, `spawns.npc`/`traffic`/`pickups`/`hazards`/
// `knockables` and `schedules`, L005/L007 over every spawn list (with an injectable entity table), L050's NPC
// and vehicle peaks and dynamic litter, L073, L080, L081 and the par report (parReport.ts). M6 adds the rest.
//
// Run: node tools/levels/compile-level.ts [--out <dir>] [--src <dir>] [--manifest <file>]
//   --out <dir>       output ROOT; levels go to <dir>/public/assets/levels/ (forge verify passes build/tmp/verify)
//   --src <dir>       directory of map/level pairs (default assets-src/levels)
//   --manifest <file> asset manifest for the roof and facade id check (default assets-src/manifest.json)
// Relative paths resolve against the working directory. Exit status: 0 ok, 1 a level has errors, 2 usage.
// The kerb blob table is always assets-src/procedural/tiles/kerb_blob.json (KERB_BLOB_PATH). After compiling,
// the compiled levels are listed in the output root's public/assets/asset-hashes.json (syncLevelHashes, SSP-042).
//
// Runs on plain Node 24 type stripping (no tsx): erasable syntax only, explicit `.ts` imports, Node built-ins
// and src/sim/** only (never three or src/render). Output is byte-deterministic: no timestamps, fixed order.
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHIFT_S, TILE_M } from '../../src/sim/constants.ts';
import {
  AMBIENCE_ID_PATTERN,
  buildLaneGraph,
  buildNavGraph,
  COLLIDE,
  createBlankLevel,
  encodeLevel,
  Ground,
  type Level,
  type LevelProp,
  type LevelSite,
  type LitterTableEntry,
  MAX_STOREYS,
  MUSIC_ID_PATTERN,
  mergeSolids,
  surfaceOfGround,
  type TileRect,
  type Weather,
} from '../../src/sim/map.ts';
import {
  DEFAULT_ENTITIES,
  DEFAULT_TUNING,
  LITTER_IDS,
  type PropFootprint,
  STATIC_PROP_IDS,
} from '../../src/sim/tuning.ts';
import {
  computeStreets,
  DEFAULT_FRONTAGE_WIDTH,
  FRONTAGE_USES,
  type FrontageUse,
  frontageStreet,
  generateFrontages,
  isFrontageUse,
} from './frontages.ts';
import { KERB_BLOB_PATH, type KerbBlob, readKerbBlob } from './kerbBlob.ts';
import { computeLaneGraph, type JunctionSpec, type LaneCode, type Side } from './laneGraph.ts';
import { checkLayout, groups, type LayoutCode, pathSteps } from './layoutChecks.ts';
import { computeNavGraph } from './navGraph.ts';
import { formatParReport, type ParReport } from './parReport.ts';
import type { Building, BuildingUse, Day, GroundName, LegendEntry, Mode, TimeOfDay } from './schema.ts';
import {
  computeGrimeCells,
  computeGrimeDensity,
  computeLitterField,
  LITTER_REQUIRES,
  type Point,
  type ResolvedHotspot,
  type ResolvedZone,
  type SpawnContext,
} from './spawnLayers.ts';
import {
  type CheckedEvent,
  type CheckedHazards,
  type CheckedNpcs,
  type CheckedTraffic,
  checkEvents,
  checkHazards,
  checkKnockables,
  checkNpcs,
  checkTraffic,
  compileSpawnSpecs,
  DEFAULT_ENTITY_TABLE,
  type EntityTable,
  entityProblem,
  type SpawnCode,
  type SpecContext,
  type SpecProblem,
} from './spawnSpecs.ts';
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
 * the rest are LEVEL_DESIGN §10.3. L005 covers the music/ambience shape and, since SSP-054, the
 * `litter.table` ids (canonical litter ids in entities.json, allowed in a known district).
 * L011–L013 are the lane graph checks (laneGraph.ts, SSP-076). L014, L015 and L020–L022 are the layout checks
 * (layoutChecks.ts, SSP-034). L050 (the litter part) and
 * L051 are the SSP-054 budgets. L030/L031 (pledges), L040 (power-ups) and L041 (collectibles) are SSP-055;
 * L031 is a warning. SSP-077 adds L005 and L007 over every spawn list, L050's NPC and vehicle peaks, L073
 * (hazard placement), L080 (anchors and routes) and the L081 warning (spawnSpecs.ts).
 */
export type LevelCode =
  | 'L000'
  | 'L001'
  | 'L002'
  | 'L003'
  | 'L004'
  | 'L005'
  | 'L006'
  | 'L007'
  | 'L010'
  | 'L030'
  | 'L031'
  | 'L040'
  | 'L041'
  | 'L050'
  | 'L051'
  | SpawnCode
  | LaneCode
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

/** `puddle_lane.map.txt:8:23 L013 road tile not connected to the lane graph` (LEVEL_DESIGN §10.3). */
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
  const { found } = scanJsonPath(text, path);
  return found < 0 ? { row: 1, col: 1 } : lineCol(text, found);
}

/**
 * Where the JSON string `value` appears for the `nth` time (0 = first) after the key at `path` (e.g. one
 * pledge id inside `pledges`); falls back to the key's position.
 */
export function locateJsonString(
  text: string,
  path: readonly string[],
  value: string,
  nth = 0,
): { row: number; col: number } {
  const { found, after } = scanJsonPath(text, path);
  const needle = JSON.stringify(value);
  let at = text.indexOf(needle, after);
  for (let k = 0; k < nth && at >= 0; k += 1) at = text.indexOf(needle, at + needle.length);
  if (at >= 0) return lineCol(text, at);
  return found < 0 ? { row: 1, col: 1 } : lineCol(text, found);
}

/** Offset of the deepest key of `path` found in order (−1 if none) and the offset just past its colon. */
function scanJsonPath(text: string, path: readonly string[]): { found: number; after: number } {
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
  return { found, after: from };
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

/** L050: `litter.initial` + expected dynamic litter may not exceed this (LEVEL_DESIGN §9.1 rule 7, §10.3). */
export const LITTER_BUDGET = 1000;

/** `litter.minSpacingM` when level.json leaves it out (LEVEL_DESIGN §8.4, §9.1). */
export const DEFAULT_LITTER_SPACING_M = 0.5;

/** Most a `grime.speckle` may be (LEVEL_DESIGN §8.4: background density 0..0.1). */
export const MAX_SPECKLE = 0.1;

/** A litter hotspot after the guards; `near` is resolved to points once the map is known. */
type CheckedHotspot = { near: string; radius: number; mult: number };

/** level.json → litter after the guards (schema.ts LitterSpec), the table sorted by id. */
type CheckedLitter = {
  initial: number;
  table: { id: string; weight: number }[];
  gutterBias: number;
  minSpacingM: number;
  hotspots: CheckedHotspot[];
};

/** A grime zone after the guards: a tile rect `[x, y, w, h]`, or a `near` reference and radius in tiles. */
type CheckedZone =
  | { rect: [number, number, number, number]; density: number }
  | { near: string; radius: number; density: number };

/** level.json → grime after the guards (schema.ts GrimeSpec). */
type CheckedGrime = { cells: number; gutterShare: number; zones: CheckedZone[]; speckle: number };

/** L030: pledges a shift level lists (LEVEL_DESIGN §7.10, §10.3). */
export const MIN_PLEDGES = 8;
export const MAX_PLEDGES = 20;
/** L040: power-ups a shift level places (LEVEL_DESIGN §9.6, §10.3). */
export const MIN_POWERUPS = 1;
export const MAX_POWERUPS = 3;

/** level.json → powerups after the guards (schema.ts LevelFile.powerups). */
type CheckedPowerups = { count: number; table: { id: string; weight: number }[]; at: [number, number][] };

/** One collectible placement after the guards: `at` in tiles (0.5 = tile centre). */
type CheckedPlacement = { at: [number, number] };

/** level.json → collectibles after the guards; a missing entry is null (L041 reports it). */
type CheckedCollectibles = {
  lostProperty: (CheckedPlacement & { id: string }) | null;
  goldenCrisp: CheckedPlacement | null;
};

/** The level.json fields the compiler consumes, after the guards. */
type CheckedLevel = {
  id: string;
  /** The display name (level.json `name`), copied to the compiled level for the HUD (SSP-299). */
  name: string;
  mode: Mode;
  seed: number;
  /**
   * Errors in the fields the map stages need (identity, size, depot, legend, buildings, anchors). Any of them
   * stops the compile before the map is read; an error in a spawn spec does not, so every problem is reported.
   */
  coreErrors: number;
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
  litter: CheckedLitter | null;
  grime: CheckedGrime | null;
  /** level.json → frontageWidth: per-use overrides of DEFAULT_FRONTAGE_WIDTH. */
  frontageWidth: { [use in FrontageUse]?: number };
  /** level.json → pledges, or null when absent (optional until SSP-056; see schema.ts). */
  pledges: string[] | null;
  powerups: CheckedPowerups | null;
  collectibles: CheckedCollectibles | null;
  /** level.json → junctions (SSP-076): give-way overrides and mini-roundabouts; [] when absent. */
  junctions: JunctionSpec[];
  /**
   * level.json → traffic is `{ none: true }` (the Depot Yard): the level has no traffic, so it compiles an
   * empty lane graph and skips L011–L013 (LEVEL_DESIGN §7.1: narrow roads are one-way or carry no traffic).
   * The rest of TrafficSpec is guarded by SSP-077.
   */
  noTraffic: boolean;
  /** The M3 spawn specs (SSP-077), after their guards; null (or empty) when absent or invalid. */
  npcs: CheckedNpcs | null;
  traffic: CheckedTraffic | null;
  hazards: CheckedHazards | null;
  knockables: { id: string; at: [number, number] }[] | null;
  events: CheckedEvent[];
  /** What the spawn guards knew (compileSpawnSpecs reuses it). */
  specContext: SpecContext;
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
  /** A warning (L031): printed, but it never fails the level. */
  warnKey(path: readonly string[], code: LevelCode, message: string): void {
    const { row, col } = locateJsonKey(this.text, path);
    this.diagnostics.push({ file: this.file, row, col, code, severity: 'warning', message });
  }
  /** An error at the `nth` occurrence (0 = first) of the string `value` inside the value of `path`. */
  string(path: readonly string[], value: string, code: LevelCode, message: string, nth = 0): void {
    const { row, col } = locateJsonString(this.text, path, value, nth);
    this.at(row, col, code, message);
  }
  /** Number of errors (warnings excluded). */
  get errors(): number {
    return this.diagnostics.filter((d) => d.severity === 'error').length;
  }
  /** Report spawn-spec findings (spawnSpecs.ts), each at its key or at its string value after the key. */
  spec(problems: readonly SpecProblem[]): void {
    for (const q of problems) {
      if (q.warning === true) this.warnKey(q.path, q.code, q.message);
      else if (q.value !== undefined) this.string(q.path, q.value, q.code, q.message);
      else this.key(q.path, q.code, q.message);
    }
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

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Whether `near` is a reference the spawn layers can resolve: `prop.<id>`, `site.<id>`, `use:<building use>`
 * or the name of an anchor in level.json → anchors.
 */
function nearOk(near: unknown, anchorNames: ReadonlySet<string>): near is string {
  if (typeof near !== 'string') return false;
  if (/^(prop|site)\.[a-z0-9_]+$/.test(near)) return true;
  if (near.startsWith('use:')) return USES.some((u) => `use:${u}` === near);
  return anchorNames.has(near);
}

const NEAR_RULE = 'must be prop.<id>, site.<id>, use:<building use> or an anchor name from anchors';

/** Report every unknown key of an object at `path`; returns whether there were none. */
function onlyKeys(
  r: Reporter,
  o: JsonObject,
  allowed: readonly string[],
  path: readonly string[],
  where: string,
): boolean {
  let ok = true;
  for (const key of Object.keys(o)) {
    if (!allowed.includes(key)) {
      r.key([...path, key], 'L000', `${where}.${key} is not a field (${allowed.join(', ')})`);
      ok = false;
    }
  }
  return ok;
}

/** Guard level.json → litter (schema.ts LitterSpec) and its L005 ids; null when absent or invalid. */
function checkLitter(
  r: Reporter,
  value: unknown,
  districtId: unknown,
  anchorNames: ReadonlySet<string>,
  table: EntityTable,
): CheckedLitter | null {
  if (value === undefined) return null;
  if (!isObject(value)) {
    r.key(['litter'], 'L000', 'litter must be an object');
    return null;
  }
  let ok = onlyKeys(
    r,
    value,
    ['initial', 'table', 'gutterBias', 'minSpacingM', 'hotspots'],
    ['litter'],
    'litter',
  );
  const at = (field: string): readonly string[] =>
    value[field] === undefined ? ['litter'] : ['litter', field];
  const { initial, table: litterTable, gutterBias, minSpacingM, hotspots } = value;
  if (!isInt(initial) || initial < 0) {
    r.key(at('initial'), 'L000', 'litter.initial must be a non-negative integer');
    ok = false;
  }
  const entries: { id: string; weight: number }[] = [];
  if (!isObject(litterTable)) {
    r.key(at('table'), 'L000', 'litter.table must be an object of litter.* id → weight');
    ok = false;
  } else {
    for (const id of Object.keys(litterTable)) {
      const weight = litterTable[id];
      if (!isNum(weight) || weight <= 0) {
        r.key(['litter', 'table', id], 'L000', `litter.table ${id} weight must be a positive number`);
        ok = false;
      } else if (table[id]?.class !== 'litter') {
        r.key(
          ['litter', 'table', id],
          'L005',
          `litter.table ${JSON.stringify(id)} is not a litter id in src/data/entities.json`,
        );
        ok = false;
      } else {
        const problem = entityProblem(table, id, 'litter', districtId, 'litter.table');
        if (problem !== null) {
          r.key(['litter', 'table', id], problem.code, problem.message);
          ok = false;
        } else entries.push({ id, weight });
      }
    }
    if (ok && isInt(initial) && initial > 0 && entries.length === 0) {
      r.key(
        ['litter', 'table'],
        'L000',
        'litter.table must name at least one litter type when litter.initial > 0',
      );
      ok = false;
    }
  }
  if (!isNum(gutterBias) || gutterBias < 0 || gutterBias > 1) {
    r.key(at('gutterBias'), 'L000', 'litter.gutterBias must be a number 0..1');
    ok = false;
  }
  if (minSpacingM !== undefined && (!isNum(minSpacingM) || minSpacingM <= 0)) {
    r.key(['litter', 'minSpacingM'], 'L000', 'litter.minSpacingM must be a positive number of metres');
    ok = false;
  }
  const checkedHotspots: CheckedHotspot[] = [];
  if (hotspots !== undefined) {
    if (!Array.isArray(hotspots)) {
      r.key(['litter', 'hotspots'], 'L000', 'litter.hotspots must be an array');
      ok = false;
    } else {
      hotspots.forEach((hs: unknown, i) => {
        const where = `litter.hotspots[${i}]`;
        const path = ['litter', 'hotspots'];
        if (!isObject(hs)) {
          r.key(path, 'L000', `${where} must be an object`);
          ok = false;
          return;
        }
        if (!onlyKeys(r, hs, ['near', 'radius', 'mult'], path, where)) ok = false;
        if (!nearOk(hs.near, anchorNames)) {
          r.key(path, 'L000', `${where}.near ${JSON.stringify(hs.near ?? null)} ${NEAR_RULE}`);
          ok = false;
        } else if (!isNum(hs.radius) || hs.radius <= 0) {
          r.key(path, 'L000', `${where}.radius must be a positive number of tiles`);
          ok = false;
        } else if (!isNum(hs.mult) || hs.mult <= 0) {
          r.key(path, 'L000', `${where}.mult must be a positive number`);
          ok = false;
        } else checkedHotspots.push({ near: hs.near, radius: hs.radius, mult: hs.mult });
      });
    }
  }
  if (!ok || !isInt(initial) || !isNum(gutterBias)) return null;
  entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return {
    initial,
    table: entries,
    gutterBias,
    minSpacingM: isNum(minSpacingM) ? minSpacingM : DEFAULT_LITTER_SPACING_M,
    hotspots: checkedHotspots,
  };
}

/** Guard level.json → grime (schema.ts GrimeSpec); null when absent or invalid. */
function checkGrime(
  r: Reporter,
  value: unknown,
  size: readonly [number, number] | null,
  anchorNames: ReadonlySet<string>,
): CheckedGrime | null {
  if (value === undefined) return null;
  if (!isObject(value)) {
    r.key(['grime'], 'L000', 'grime must be an object');
    return null;
  }
  let ok = onlyKeys(r, value, ['cells', 'gutterShare', 'zones', 'speckle'], ['grime'], 'grime');
  const at = (field: string): readonly string[] =>
    value[field] === undefined ? ['grime'] : ['grime', field];
  const { cells, gutterShare, zones, speckle } = value;
  if (!isInt(cells) || cells < 0) {
    r.key(at('cells'), 'L000', 'grime.cells must be a non-negative integer');
    ok = false;
  }
  if (!isNum(gutterShare) || gutterShare < 0 || gutterShare > 1) {
    r.key(at('gutterShare'), 'L000', 'grime.gutterShare must be a number 0..1');
    ok = false;
  }
  if (!isNum(speckle) || speckle < 0 || speckle > MAX_SPECKLE) {
    r.key(at('speckle'), 'L000', `grime.speckle must be a number 0..${MAX_SPECKLE}`);
    ok = false;
  }
  const checkedZones: CheckedZone[] = [];
  if (!Array.isArray(zones)) {
    r.key(at('zones'), 'L000', 'grime.zones must be an array');
    ok = false;
  } else {
    zones.forEach((zone: unknown, i) => {
      const where = `grime.zones[${i}]`;
      const path = ['grime', 'zones'];
      if (!isObject(zone)) {
        r.key(path, 'L000', `${where} must be an object`);
        ok = false;
        return;
      }
      if (!onlyKeys(r, zone, ['rect', 'near', 'radius', 'density'], path, where)) ok = false;
      const { rect, near, radius, density } = zone;
      if (!isNum(density) || density < 0 || density > 1) {
        r.key(path, 'L000', `${where}.density must be a number 0..1`);
        ok = false;
        return;
      }
      if ((rect === undefined) === (near === undefined)) {
        r.key(path, 'L000', `${where} must have exactly one of rect or near`);
        ok = false;
      } else if (rect !== undefined) {
        const valid = Array.isArray(rect) && rect.length === 4 && rect.every(isInt);
        const [x = 0, y = 0, w = 0, h = 0] = valid ? rect : [];
        if (
          !valid ||
          w < 1 ||
          h < 1 ||
          x < 0 ||
          y < 0 ||
          (size !== null && (x + w > size[0] || y + h > size[1]))
        ) {
          r.key(path, 'L000', `${where}.rect must be [x, y, w, h] in tiles with w, h ≥ 1, inside the map`);
          ok = false;
        } else if (radius !== undefined) {
          r.key(path, 'L000', `${where}.radius goes with near, not rect`);
          ok = false;
        } else checkedZones.push({ rect: [x, y, w, h], density });
      } else if (!nearOk(near, anchorNames)) {
        r.key(path, 'L000', `${where}.near ${JSON.stringify(near)} ${NEAR_RULE}`);
        ok = false;
      } else if (!isNum(radius) || radius <= 0) {
        r.key(path, 'L000', `${where}.radius must be a positive number of tiles`);
        ok = false;
      } else checkedZones.push({ near, radius, density });
    });
  }
  if (!ok || !isInt(cells) || !isNum(gutterShare) || !isNum(speckle)) return null;
  return { cells, gutterShare, zones: checkedZones, speckle };
}

/** Guard level.json → frontageWidth: an object of frontage use → positive integer tiles. */
function checkFrontageWidth(r: Reporter, value: unknown): { [use in FrontageUse]?: number } {
  const out: { [use in FrontageUse]?: number } = {};
  if (value === undefined) return out;
  if (!isObject(value)) {
    r.key(['frontageWidth'], 'L000', 'frontageWidth must be an object of building use → tiles');
    return out;
  }
  for (const use of Object.keys(value)) {
    const width = value[use];
    if (!isFrontageUse(use))
      r.key(
        ['frontageWidth', use],
        'L000',
        `frontageWidth ${JSON.stringify(use)} must be a use that gets frontages (${FRONTAGE_USES.join(', ')})`,
      );
    else if (!isInt(width) || width < 1)
      r.key(['frontageWidth', use], 'L000', `frontageWidth ${use} must be a positive integer`);
    else out[use] = width;
  }
  return out;
}

/** `[x, y]` tile coordinates (finite numbers); with `size`, inside the map. */
function isXY(v: unknown, size: readonly [number, number] | null): v is [number, number] {
  if (!Array.isArray(v) || v.length !== 2 || !v.every(isNum)) return false;
  const [x = 0, y = 0] = v;
  return size === null || (x >= 0 && y >= 0 && x < size[0] && y < size[1]);
}

/** Guard level.json → powerups (schema.ts) and its L005 ids; the caller checks L040. */
function checkPowerups(
  r: Reporter,
  value: unknown,
  districtId: unknown,
  size: readonly [number, number] | null,
  entities: EntityTable,
): CheckedPowerups | null {
  if (value === undefined) return null;
  if (!isObject(value)) {
    r.key(['powerups'], 'L000', 'powerups must be an object');
    return null;
  }
  let ok = onlyKeys(r, value, ['count', 'table', 'at'], ['powerups'], 'powerups');
  const { count, table, at } = value;
  if (!isInt(count)) {
    r.key(
      count === undefined ? ['powerups'] : ['powerups', 'count'],
      'L000',
      'powerups.count must be an integer',
    );
    ok = false;
  }
  const entries: { id: string; weight: number }[] = [];
  if (!isObject(table) || Object.keys(table).length === 0) {
    r.key(
      table === undefined ? ['powerups'] : ['powerups', 'table'],
      'L000',
      'powerups.table must be an object of pwr.* id → weight with at least one entry',
    );
    ok = false;
  } else {
    for (const id of Object.keys(table)) {
      const weight = table[id];
      const path = ['powerups', 'table', id];
      const problem = entityProblem(entities, id, 'pwr', districtId, 'powerups.table');
      if (!isNum(weight) || weight <= 0) {
        r.key(path, 'L000', `powerups.table ${id} weight must be a positive number`);
        ok = false;
      } else if (entities[id]?.class !== 'pwr') {
        r.key(path, 'L005', `powerups.table ${JSON.stringify(id)} is not a pwr id in src/data/entities.json`);
        ok = false;
      } else if (problem !== null) {
        r.key(path, problem.code, problem.message);
        ok = false;
      } else entries.push({ id, weight });
    }
  }
  const placed: [number, number][] = [];
  if (at !== undefined) {
    if (!Array.isArray(at) || !at.every((p) => isXY(p, size))) {
      r.key(
        ['powerups', 'at'],
        'L000',
        'powerups.at must be an array of [x, y] tile positions inside the map',
      );
      ok = false;
    } else for (const p of at as [number, number][]) placed.push([p[0], p[1]]);
  }
  if (!ok || !isInt(count)) return null;
  entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { count, table: entries, at: placed };
}

/** Guard level.json → collectibles (schema.ts) and the Lost Property id (L005). Missing entries stay null. */
function checkCollectibles(
  r: Reporter,
  value: unknown,
  districtId: unknown,
  entities: EntityTable,
): CheckedCollectibles | null {
  if (value === undefined) return null;
  if (!isObject(value)) {
    r.key(['collectibles'], 'L000', 'collectibles must be an object');
    return null;
  }
  let ok = onlyKeys(r, value, ['lostProperty', 'goldenCrisp'], ['collectibles'], 'collectibles');
  const out: CheckedCollectibles = { lostProperty: null, goldenCrisp: null };
  for (const kind of ['lostProperty', 'goldenCrisp'] as const) {
    const entry: unknown = value[kind];
    const path = ['collectibles', kind];
    if (entry === undefined) continue;
    if (!isObject(entry)) {
      r.key(path, 'L000', `collectibles.${kind} must be an object`);
      ok = false;
      continue;
    }
    const fields = kind === 'lostProperty' ? ['id', 'at'] : ['at'];
    if (!onlyKeys(r, entry, fields, path, `collectibles.${kind}`)) ok = false;
    if (!isXY(entry.at, null)) {
      r.key(
        entry.at === undefined ? path : [...path, 'at'],
        'L000',
        `collectibles.${kind}.at must be [x, y] in tiles`,
      );
      ok = false;
      continue;
    }
    const at: [number, number] = [entry.at[0], entry.at[1]];
    if (kind === 'goldenCrisp') {
      out.goldenCrisp = { at };
      continue;
    }
    const id = entry.id;
    if (typeof id !== 'string' || !/^collect\.[a-z0-9_]+$/.test(id)) {
      r.key(
        id === undefined ? path : [...path, 'id'],
        'L000',
        'collectibles.lostProperty.id must be a collect.* id',
      );
      ok = false;
    } else if (entities[id]?.class !== 'collect' || entities[id]?.kind !== 'lostProperty') {
      r.key(
        [...path, 'id'],
        'L005',
        `collectibles.lostProperty.id ${id} is not a lostProperty collectible in src/data/entities.json`,
      );
      ok = false;
    } else {
      const problem = entityProblem(entities, id, 'collect', districtId, 'collectibles.lostProperty.id');
      if (problem !== null) {
        r.key([...path, 'id'], problem.code, problem.message);
        ok = false;
      } else out.lostProperty = { id, at };
    }
  }
  return ok ? out : null;
}

const SIDES: readonly Side[] = ['n', 'e', 's', 'w'];

/**
 * Guard level.json → junctions (schema.ts, SSP-076): each entry is `{ at: [x, y] }` in tiles inside the map,
 * with `major` (distinct sides n/e/s/w) and/or `roundabout: true`. Whether `at` names a junction is checked
 * against the lane graph later.
 */
function checkJunctions(r: Reporter, value: unknown, size: readonly [number, number] | null): JunctionSpec[] {
  const out: JunctionSpec[] = [];
  if (value === undefined) return out;
  if (!Array.isArray(value)) {
    r.key(['junctions'], 'L000', 'junctions must be an array of { at, major?, roundabout? }');
    return out;
  }
  value.forEach((entry: unknown, i) => {
    const where = `junctions[${i}]`;
    const path = ['junctions'];
    if (!isObject(entry)) {
      r.key(path, 'L000', `${where} must be an object`);
      return;
    }
    let ok = onlyKeys(r, entry, ['at', 'major', 'roundabout'], path, where);
    const { at, major, roundabout } = entry;
    if (!isXY(at, size)) {
      r.key(path, 'L000', `${where}.at must be [x, y] tile coordinates inside the map`);
      ok = false;
    }
    let sides: Side[] | null = null;
    if (major !== undefined) {
      const list = Array.isArray(major) ? major : [];
      sides = SIDES.filter((side) => list.includes(side));
      if (!Array.isArray(major) || sides.length !== major.length || major.length === 0) {
        r.key(path, 'L000', `${where}.major must list distinct sides from n, e, s, w`);
        ok = false;
      }
    }
    if (roundabout !== undefined && typeof roundabout !== 'boolean') {
      r.key(path, 'L000', `${where}.roundabout must be a boolean`);
      ok = false;
    }
    if (major === undefined && roundabout !== true) {
      r.key(path, 'L000', `${where} must set major or roundabout: true`);
      ok = false;
    }
    if (ok && isXY(at, size)) out.push({ at: [at[0], at[1]], major: sides, roundabout: roundabout === true });
  });
  return out;
}

/** Guard a parsed level.json against schema.ts; null when a field the map checks need is unusable. */
function checkLevelFile(
  r: Reporter,
  root: unknown,
  name: string,
  known: ReadonlySet<string>,
  entities: EntityTable,
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
  const coreErrors = r.errors;

  let pledges: string[] | null = null;
  if (root.pledges !== undefined) {
    if (Array.isArray(root.pledges) && root.pledges.every((p) => typeof p === 'string')) {
      pledges = root.pledges;
      // L030 (count): a shift level lists 8..20 pledges. The ids are resolved against the frontages later.
      if (mode === 'shift' && (pledges.length < MIN_PLEDGES || pledges.length > MAX_PLEDGES))
        r.key(
          ['pledges'],
          'L030',
          `pledges lists ${pledges.length} frontage(s); a shift level needs ${MIN_PLEDGES}–${MAX_PLEDGES}`,
        );
    } else bad('pledges', 'must be an array of frontage ids');
  }
  const anchorNames = new Set(Object.values(anchors));
  const mapSize: [number, number] | null = sizeOk ? [size[0], size[1]] : null;
  const litter = checkLitter(r, root.litter, id, anchorNames, entities);
  const grime = checkGrime(r, root.grime, mapSize, anchorNames);
  const frontageWidth = checkFrontageWidth(r, root.frontageWidth);
  const powerups = checkPowerups(r, root.powerups, id, mapSize, entities);
  // L040: a shift level places 1..3 power-ups.
  if (
    powerups !== null &&
    mode === 'shift' &&
    (powerups.count < MIN_POWERUPS || powerups.count > MAX_POWERUPS)
  )
    r.key(
      ['powerups', 'count'],
      'L040',
      `powerups.count ${powerups.count} is outside ${MIN_POWERUPS}–${MAX_POWERUPS}`,
    );
  const collectibles = checkCollectibles(r, root.collectibles, id, entities);
  const junctions = checkJunctions(r, root.junctions, mapSize);
  // The M3 spawn specs (SSP-077).
  const specContext: SpecContext = {
    districtId: id,
    mode: mode ?? 'shift',
    timerS: typeof timer === 'number' && Number.isFinite(timer) && timer > 0 ? timer : SHIFT_S,
    size: mapSize,
    anchors,
    entities,
  };
  const problems: SpecProblem[] = [];
  const npcs = checkNpcs(root.npcs, specContext, problems, (near) => nearOk(near, anchorNames));
  const traffic = checkTraffic(root.traffic, specContext, problems);
  const hazards = checkHazards(root.hazards, specContext, problems);
  const knockables = checkKnockables(root.knockables, specContext, problems);
  const events = checkEvents(root.events, specContext, problems);
  r.spec(problems);

  if (typeof id !== 'string' || mode === undefined || !sizeOk || timer === undefined || weather === undefined)
    return null;
  if (!headingOk || depotRect === null) return null;
  return {
    id,
    name: typeof root.name === 'string' ? root.name : '',
    mode,
    seed: isInt(root.seed) ? root.seed : 0,
    coreErrors,
    size: [size[0], size[1]],
    timer: typeof timer === 'number' ? timer : SHIFT_S,
    weather,
    ...audio,
    headingIndex: heading,
    depot: depotRect,
    legend,
    buildings,
    anchors,
    litter,
    grime,
    frontageWidth,
    pledges,
    powerups,
    collectibles,
    junctions,
    noTraffic: isObject(root.traffic) && root.traffic.none === true,
    npcs,
    traffic,
    hazards,
    knockables,
    events,
    specContext,
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

/** An anchor digit placed on the map. Written as a nav graph anchor tag (`nav.anchors`, SSP-076). */
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
   * Layout and lane codes not to check. Only unit tests set it, to compile tiny maps that exercise other rules
   * without two depot bays, a hydrant or a legal road network; the CLI always checks everything.
   */
  skipCodes?: readonly (LayoutCode | LaneCode)[];
  /**
   * The entities spawn lists are checked against (L005, L007). Defaults to src/data/entities.json; unit tests
   * inject a table with an entity the real data does not have (SSP-077).
   */
  entities?: EntityTable;
};

export type CompileOutput = {
  level: Level;
  /** The compiled JSON text (encodeLevel). */
  text: string;
  buildings: BuildingInstance[];
  anchors: AnchorPoint[];
  map: ResolvedMap;
  /** The par report's numbers (LEVEL_DESIGN §10.4). */
  report: ParReport;
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
  const lvl = checkLevelFile(
    lr,
    root,
    input.name,
    input.knownAssetIds,
    input.entities ?? DEFAULT_ENTITY_TABLE,
  );
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
  // A spawn-spec error does not stop here, so it is reported together with any later map or spawn problem.
  if (mr.errors > 0 || lvl.coreErrors > 0) return finish(null);
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

  if (mr.diagnostics.length > 0) return finish(null);

  // The traffic lane graph and L011–L013 (SSP-076). An L011 road shape makes L012 meaningless, so it is
  // reported only on a map whose roads are well formed (laneGraph.ts).
  const skip = new Set<LevelCode>(input.skipCodes ?? []);
  const lanes = lvl.noTraffic
    ? { lists: { nodes: [], edges: [], bays: [] }, findings: [], junctionProblems: [] }
    : computeLaneGraph(map, DEFAULT_TUNING.streetLife.laneSpeed, lvl.junctions);
  for (const f of lanes.findings) if (!skip.has(f.code)) mr.at(f.y + 1, f.x + 1, f.code, f.message);
  for (const p of lanes.junctionProblems) lr.key(['junctions'], 'L000', p.message);
  if (mr.errors > 0 || lanes.junctionProblems.length > 0) return finish(null);

  // Layout checks (L014, L015, L020–L022) over the route mask.
  const route = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i += 1)
    route[i] = map.drivable[i] === 1 && GROUND_ROUTE[map.ground[i] ?? 0] === true ? 1 : 0;
  for (const f of checkLayout(map, route, lvl.mode, lvl.depot)) {
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
  level.lanes = buildLaneGraph(lanes.lists, w, h, 'compileLevel');
  // grimeDensity, gutter and the litter field are the spawn layers below (SSP-054); the nav graph follows the
  // frontages, whose doors it tags (SSP-076).

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
  // Depot bays and skips are one site per 4-connected group instead (SSP-055), the same unit L020 counts and
  // L022 checks; layoutChecks has already required each group to be a filled rectangle (L020).
  const sites: LevelSite[] = [];
  for (const [id, mask] of siteMasks) {
    if (id === 'site.depot_bay' || id === 'site.skip') {
      for (const cells of groups(map, (i) => mask[i] !== 0)) sites.push({ id, rect: cellBounds(cells, w) });
    } else for (const rect of mergeSolids(mask, w, h)) sites.push({ id, rect });
  }
  sites.sort(
    (a, b) => a.rect[1] - b.rect[1] || a.rect[0] - b.rect[0] || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );

  if (lvl.name.length > 0) level.name = lvl.name;
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

  // Spawn layers (SSP-054): grime cells, zone density, the litter field, and the L050/L051 budgets.
  const skipTiles = siteMasks.get('site.skip') ?? new Uint8Array(w * h);
  const ctx: SpawnContext = {
    map,
    route,
    collide: L.collide,
    skip: skipTiles.map((v) => (v !== 0 ? 1 : 0)),
    props,
    footprintOf: propFootprint,
  };
  const grimeCells = computeGrimeCells(ctx);
  L.gutter.set(grimeCells.cells);
  const resolveNear = (near: string): Point[] => nearPoints(near, map, buildings, props, anchors);
  if (lvl.grime !== null) {
    const g = lvl.grime;
    const zones = g.zones.map(
      (z): ResolvedZone =>
        'rect' in z
          ? { rect: z.rect, density: z.density }
          : { points: resolveNear(z.near), radius: z.radius, density: z.density },
    );
    L.grimeDensity.set(computeGrimeDensity(ctx, zones));
    const gutterCells = Math.round(g.cells * g.gutterShare);
    const where = ['grime', 'cells'];
    if (g.cells > grimeCells.open)
      lr.key(
        where,
        'L051',
        `grime.cells ${g.cells} exceeds the ${grimeCells.open} route-area grime cells available`,
      );
    if (gutterCells > grimeCells.gutter)
      lr.key(
        ['grime', 'gutterShare'],
        'L051',
        `grime.gutterShare ${g.gutterShare} asks for ${gutterCells} gutter cells; the gutter band has ${grimeCells.gutter}`,
      );
    const otherOpen = grimeCells.open - grimeCells.gutter;
    if (g.cells <= grimeCells.open && g.cells - gutterCells > otherOpen)
      lr.key(
        where,
        'L051',
        `grime.cells ${g.cells} leaves ${g.cells - gutterCells} non-gutter cells; only ${otherOpen} are available`,
      );
    level.grime = { cells: g.cells, gutterCells: Math.min(gutterCells, g.cells), speckle: g.speckle };
  }
  if (lvl.litter !== null) {
    const spec = lvl.litter;
    const table: LitterTableEntry[] = spec.table.map((e) => ({
      id: e.id,
      weight: e.weight,
      requires: LITTER_REQUIRES[e.id] ?? 0,
    }));
    const hotspots = spec.hotspots.map(
      (hs): ResolvedHotspot => ({ points: resolveNear(hs.near), radius: hs.radius, mult: hs.mult }),
    );
    const field = computeLitterField(ctx, table, spec.gutterBias, hotspots);
    level.litter = {
      initial: spec.initial,
      minSpacingM: spec.minSpacingM,
      table,
      places: field.places,
      weights: field.weights,
    };
  }

  // Frontages and pledges (SSP-055, LEVEL_DESIGN §7.10), then L030 ids, L031 and L041.
  const widths = buildings.map((b) => {
    if (!isFrontageUse(b.use)) return 0;
    return (
      lvl.buildings[b.letter]?.frontageWidth ?? lvl.frontageWidth[b.use] ?? DEFAULT_FRONTAGE_WIDTH[b.use]
    );
  });
  const frontages = generateFrontages(map, widths);
  const pledged = new Set<string>();
  if (lvl.pledges !== null) {
    const known = new Set(frontages.map((f) => f.id));
    for (const id of lvl.pledges) {
      if (pledged.has(id)) lr.string(['pledges'], id, 'L030', `pledge ${id} is listed more than once`, 1);
      else if (!known.has(id))
        lr.string(['pledges'], id, 'L030', `pledge ${id} is not a generated frontage (fr_<x>_<y>)`);
      pledged.add(id);
    }
    if (lvl.mode === 'shift') checkPledgeSpread(lr, map, frontages, pledged);
  }
  level.frontages = frontages.map((f) => ({
    id: f.id,
    pledge: pledged.has(f.id),
    rect: f.rect,
    face: f.face,
    cells: f.cells.map((i): [number, number] => [i % w, Math.floor(i / w)]),
  }));
  if (lvl.collectibles !== null) checkCollectiblePlacement(lr, lvl.collectibles, map, props, lvl.mode);
  // The pavement nav graph (SSP-076), with portal, door and anchor tags.
  level.nav = buildNavGraph(computeNavGraph(map, frontages, anchors), w, h, 'compileLevel');

  // The M3 spawn specs (SSP-077): power-ups, NPCs, traffic, hazards, knockables and schedules, the L050 peaks and
  // budgets, L073 and L080.
  if (lvl.powerups !== null)
    level.pickups = {
      count: lvl.powerups.count,
      table: lvl.powerups.table,
      at: lvl.powerups.at.map(([x, y]): [number, number] => [x * TILE_M, y * TILE_M]),
    };
  const anchorTiles: { [digit: string]: [number, number][] } = {};
  for (const a of anchors) {
    const tiles = anchorTiles[a.char] ?? [];
    tiles.push(a.tile);
    anchorTiles[a.char] = tiles;
  }
  const spawned = compileSpawnSpecs(
    {
      npcs: lvl.npcs,
      traffic: lvl.traffic,
      hazards: lvl.hazards,
      knockables: lvl.knockables,
      events: lvl.events,
    },
    {
      map,
      level,
      start: [sx, sy],
      anchorTiles,
      buildingUse: buildings.map((b) => b.use),
      resolveNear,
    },
    lvl.specContext,
  );
  lr.spec(spawned.problems);
  level.npc = spawned.npc;
  level.traffic = spawned.traffic;
  level.hazards = spawned.hazards;
  level.knockables = spawned.knockables;
  level.schedules = spawned.schedules;
  // L050's litter part: the initial litter plus the expected dynamic litter of the NPC and event specs.
  if (lvl.litter !== null) {
    const total = lvl.litter.initial + spawned.dynamicLitter;
    if (total > LITTER_BUDGET)
      lr.key(
        ['litter', 'initial'],
        'L050',
        `litter.initial ${lvl.litter.initial} + expected dynamic litter ${spawned.dynamicLitter} = ${total} is over the budget of ${LITTER_BUDGET}`,
      );
  }

  // A budget or content error (L030, L041, L050, L051, L073, L080, a spawn guard) fails the level before it is
  // encoded.
  if (lr.errors > 0) return finish(null);
  const report = parReportOf(level, lvl, map, route, spawned, frontages.length, pledged.size);
  report.warnings = [...mr.diagnostics, ...lr.diagnostics]
    .filter((d) => d.severity === 'warning')
    .map((d) => d.code);
  return finish({ level, text: encodeLevel(level), buildings, anchors, map, report });
}

/**
 * The par report's numbers (LEVEL_DESIGN §10.4) for a compiled level. Path distances are BFS steps over the
 * drivable tiles (layoutChecks.ts pathSteps), 2 m each, from the dump sites (depot bays and skips) and the water
 * sources (hydrants and depot bays) to the farthest reachable route tile. LU is the litter table's mean `lu`
 * (weighted) × (initial + dynamic) items.
 */
function parReportOf(
  level: Level,
  lvl: CheckedLevel,
  map: ResolvedMap,
  route: Uint8Array,
  spawned: ReturnType<typeof compileSpawnSpecs>,
  frontages: number,
  pledges: number,
): ParReport {
  const { w, h } = map;
  const bays: number[] = [];
  const skips: number[] = [];
  const hydrants: number[] = [];
  let routeTiles = 0;
  for (let i = 0; i < w * h; i += 1) {
    const def = map.defs[i] ?? null;
    if (def?.site === 'site.depot_bay') bays.push(i);
    if (def?.site === 'site.skip') skips.push(i);
    if (def?.prop === 'prop.hydrant') hydrants.push(i);
    routeTiles += route[i] ?? 0;
  }
  const farthest = (sources: readonly number[]): number | null => {
    if (sources.length === 0) return null;
    const dist = pathSteps(map, sources);
    let worst = -1;
    for (let i = 0; i < w * h; i += 1) if (route[i] === 1) worst = Math.max(worst, dist[i] ?? -1);
    return worst < 0 ? null : worst * TILE_M;
  };
  const isBay = (c: number): boolean => map.defs[c]?.site === 'site.depot_bay';
  const isSkip = (c: number): boolean => map.defs[c]?.site === 'site.skip';
  let lu: number | null = null;
  if (level.litter !== null && level.litter.table.length > 0) {
    let weight = 0;
    let sum = 0;
    for (const e of level.litter.table) {
      weight += e.weight;
      sum += e.weight * luOf(e.id);
    }
    lu = weight > 0 ? Math.round((sum / weight) * (level.litter.initial + spawned.dynamicLitter)) : null;
  }
  return {
    id: level.id,
    size: level.size,
    seed: lvl.seed,
    routeTiles,
    grimeCells: level.grime?.cells ?? null,
    gutterCells: level.grime?.gutterCells ?? null,
    litter: level.litter?.initial ?? null,
    dynamicLitter: spawned.dynamicLitter,
    litterLu: lu,
    depotBays: groups(map, isBay).length,
    skips: groups(map, isSkip).length,
    hydrants: hydrants.length,
    maxDumpM: farthest([...bays, ...skips]),
    maxWaterM: farthest([...hydrants, ...bays]),
    frontages,
    pledges,
    peakNpc: spawned.peaks.npc,
    peakVehicles: spawned.peaks.vehicles,
    warnings: [],
  };
}

/** The `lu` of a litter id in src/data/entities.json, or 0 for any other id. */
function luOf(id: string): number {
  const known = LITTER_IDS.find((l) => l === id);
  return known === undefined ? 0 : DEFAULT_ENTITIES.litter[known].lu;
}

/** Bounding box `[x0, y0, x1, y1]` (x1/y1 exclusive) of tile indices in a w-wide grid. */
function cellBounds(cells: readonly number[], w: number): TileRect {
  let [x0, y0, x1, y1] = [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 0, 0];
  for (const i of cells) {
    const x = i % w;
    const y = (i - x) / w;
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x + 1);
    y1 = Math.max(y1, y + 1);
  }
  return [x0, y0, x1, y1];
}

/**
 * L031 (warning, shift levels): more than a third of the pledges on one street (frontages.ts computeStreets).
 * Pledges on no street (no gutter tile) and unknown ids are not counted on any street; the share is of every
 * distinct listed pledge.
 */
function checkPledgeSpread(
  lr: Reporter,
  map: ResolvedMap,
  frontages: readonly ReturnType<typeof generateFrontages>[number][],
  pledged: ReadonlySet<string>,
): void {
  if (pledged.size === 0) return;
  const { street, first } = computeStreets(map);
  const byStreet = new Map<number, string[]>();
  for (const f of frontages) {
    if (!pledged.has(f.id)) continue;
    const s = frontageStreet(street, f.gutter);
    if (s < 0) continue;
    const list = byStreet.get(s) ?? [];
    list.push(f.id);
    byStreet.set(s, list);
  }
  for (const [s, ids] of [...byStreet.entries()].sort((a, b) => a[0] - b[0])) {
    if (ids.length * 3 <= pledged.size) continue;
    const tile = first[s] ?? 0;
    const x = tile % map.w;
    const y = (tile - x) / map.w;
    lr.warnKey(
      ['pledges'],
      'L031',
      `${ids.length} of ${pledged.size} pledges (${ids.join(', ')}) are on the street that starts at map row ${y + 1}, column ${x + 1}; no street should hold more than a third`,
    );
  }
}

/**
 * L041 (shift levels): Lost Property and the Golden Crisp must both be placed, on a tile Bessie's body can
 * reach (drivable, so connected to @ by L010, and not inside a solid prop's footprint), and never in a footway
 * (a 1-tile alley). Positions are tiles; the point itself is tested (0.5 = tile centre).
 */
function checkCollectiblePlacement(
  lr: Reporter,
  c: CheckedCollectibles,
  map: ResolvedMap,
  props: readonly LevelProp[],
  mode: Mode,
): void {
  if (mode !== 'shift') return;
  const entries = [
    ['lostProperty', 'Lost Property', c.lostProperty?.at ?? null],
    ['goldenCrisp', 'Golden Crisp', c.goldenCrisp?.at ?? null],
  ] as const;
  for (const [kind, label, at] of entries) {
    const path = ['collectibles', kind];
    if (at === null) {
      lr.key(['collectibles'], 'L041', `collectibles.${kind} is missing: a shift level places the ${label}`);
      continue;
    }
    const why = collectibleProblem(at, map, props);
    if (why !== null) lr.key(path, 'L041', `${label} at [${at[0]}, ${at[1]}] ${why}`);
  }
}

/** Why Bessie's body cannot pick up a collectible at tile position `at`, or null when she can. */
export function collectibleProblem(
  at: readonly [number, number],
  map: ResolvedMap,
  props: readonly LevelProp[],
): string | null {
  const [x, y] = at;
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return 'is outside the map';
  const i = ty * map.w + tx;
  const footway =
    map.ground[i] === Ground.Alley && map.drivable[i] === 0 && map.solid[i] === 0 && map.building[i] === -1;
  if (footway) return 'is in a footway (a 1-tile alley Bessie cannot enter)';
  if (map.drivable[i] !== 1) return 'is not on a drivable tile, so Bessie cannot reach it';
  const px = x * TILE_M;
  const py = y * TILE_M;
  for (const prop of props) {
    const fp = propFootprint(prop.id);
    if (fp === undefined) continue;
    const inside =
      fp.shape === 'circle'
        ? (px - prop.x) ** 2 + (py - prop.y) ** 2 <= fp.radiusM ** 2
        : Math.abs(px - prop.x) <= fp.widthM / 2 && Math.abs(py - prop.y) <= fp.lengthM / 2;
    if (inside) return `is inside the footprint of the ${prop.id}, so Bessie cannot reach it`;
  }
  return null;
}

/** The solid footprint of a static prop (tuning.json → propFootprints), or undefined for any other id. */
function propFootprint(id: string): PropFootprint | undefined {
  const known = STATIC_PROP_IDS.find((p) => p === id);
  return known === undefined ? undefined : DEFAULT_TUNING.propFootprints.shapes[known];
}

/**
 * The source points (metres) of a `near` reference (nearOk): each `prop.<id>` position, each `site.<id>` cell
 * centre, each cell centre of a building with that `use:`, or the anchor's tile centre. Row-major order.
 */
export function nearPoints(
  near: string,
  map: ResolvedMap,
  buildings: readonly BuildingInstance[],
  props: readonly LevelProp[],
  anchors: readonly AnchorPoint[],
): Point[] {
  const centre = (i: number): Point => [((i % map.w) + 0.5) * TILE_M, (Math.floor(i / map.w) + 0.5) * TILE_M];
  if (near.startsWith('prop.')) return props.filter((p) => p.id === near).map((p): Point => [p.x, p.y]);
  const out: Point[] = [];
  if (near.startsWith('site.')) {
    for (let i = 0; i < map.w * map.h; i += 1) {
      const def = map.defs[i] ?? null;
      if (def !== null && (def.site === near || def.haz === near)) out.push(centre(i));
    }
    return out;
  }
  if (near.startsWith('use:')) {
    const use = near.slice(4);
    for (let i = 0; i < map.w * map.h; i += 1) {
      const b = buildings[map.building[i] ?? -1];
      if (b !== undefined && b.use === use) out.push(centre(i));
    }
    return out;
  }
  for (const a of anchors) if (a.name === near) out.push(centre(a.tile[1] * map.w + a.tile[0]));
  return out;
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
    for (const line of formatParReport(result.output.report)) io.log(line);
    compiled += 1;
  }
  const listed = syncLevelHashes(outRoot);
  if (listed !== null)
    io.log(`compile-level: ${listed} level(s) listed in ${shown(join(outRoot, HASHES_JSON))}`);
  io.log(`compile-level: ${compiled} compiled, ${failed} failed`);
  return failed > 0 ? 1 : 0;
}

/** The generated-file hash listing under an output root (written by `forge build`, ASSET_PIPELINE §9.3). */
export const HASHES_JSON = 'public/assets/asset-hashes.json';

/**
 * List every compiled level in the root's asset-hashes.json, so `forge verify` sees them as listed generated
 * files (SSP-042). `forge build` writes the file first with its own outputs, and `npm run assets` runs this
 * compiler after it, so the entries under `public/assets/levels/` are replaced by the SHA-256 of every
 * `*.json` file there now; every other entry is kept. The format matches the forge's (keys sorted, two-space
 * indent, final newline). The file is rewritten only when its bytes change. Returns the number of levels
 * listed, or null when the root has no hash listing (a fixture `--out` root), which is then left alone.
 */
export function syncLevelHashes(outRoot: string): number | null {
  const hashesPath = join(outRoot, HASHES_JSON);
  let before: string;
  try {
    before = readFileSync(hashesPath, 'utf8');
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') return null;
    throw err;
  }
  const doc: unknown = JSON.parse(before);
  if (!isObject(doc)) throw new Error(`${hashesPath}: expected an object of path → sha256`);
  const prefix = `${LEVELS_OUT_DIR}/`;
  const entries: [string, unknown][] = Object.entries(doc).filter(([k]) => !k.startsWith(prefix));
  let levels: string[] = [];
  try {
    levels = readdirSync(join(outRoot, LEVELS_OUT_DIR), { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.json'))
      .map((e) => e.name);
  } catch (err) {
    if (!(err instanceof Error && 'code' in err && err.code === 'ENOENT')) throw err;
  }
  for (const name of levels) {
    const bytes = readFileSync(join(outRoot, LEVELS_OUT_DIR, name));
    entries.push([prefix + name, createHash('sha256').update(bytes).digest('hex')]);
  }
  entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const after = `${JSON.stringify(Object.fromEntries(entries), null, 2)}\n`;
  if (after !== before) writeFileSync(hashesPath, after);
  return levels.length;
}

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly && basename(process.argv[1] ?? '') === 'compile-level.ts') {
  process.exitCode = runCompileLevel(process.argv.slice(2), repoRoot);
}
