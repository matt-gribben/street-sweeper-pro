// The compiled level (TECHNICAL_DESIGN §15.2): v1 types, the JSON codec, the id tables and the solid merge.
// Shared by the level compiler (tools/levels/compile-level.ts, on Node type stripping) and the sim, so the
// encoder and decoder can never disagree (§15.2, §2.1). Pure: no fs, DOM, three, Date or Math.random.
// Everything here runs once per compile or once per shift load, never per tick, so it may allocate.
//
// Units (TECHNICAL_DESIGN §15.2): grid layers, `size`, `solids` and every `rect` are in tiles (2 m);
// `props[].x/y` and `player.x/y` are sim metres; `props[].rot` and `player.heading` are radians (0 = north,
// clockwise, §4). level.json (LEVEL_DESIGN §8.4) authors tile coordinates; the compiler converts.
import { decodeBase64, encodeBase64 } from './base64.ts';
import { GRIME_CELL_M, SHIFT_S, TILE_M } from './constants.ts';

/** The compiled file's `format` tag. */
export const LEVEL_FORMAT = 'ssp.level';

/** The compiled schema version this module reads and writes. */
export const LEVEL_VERSION = 1;

// ---------------------------------------------------------------------------------------------------------
// Id tables
// ---------------------------------------------------------------------------------------------------------

/**
 * Ground tile type ids, the `ground` layer (LEVEL_DESIGN §8.3). Void is 0 so a zero-filled layer is empty
 * space. One-way roads carry their flow direction: RoadOneWayE is `>`, W `<`, N `^`, S `v`.
 * The values are written into compiled files: append new grounds, never renumber.
 */
export const Ground = {
  Void: 0,
  Road: 1,
  RoadOneWayE: 2,
  RoadOneWayW: 3,
  RoadOneWayN: 4,
  RoadOneWayS: 5,
  Pavement: 6,
  Cobbles: 7,
  Alley: 8,
  Grass: 9,
  Yard: 10,
  Apron: 11,
  Water: 12,
  Sand: 13,
} as const;
export type Ground = (typeof Ground)[keyof typeof Ground];

/** Number of ground ids; every value in a `ground` layer is below this. */
export const GROUND_COUNT = 14;

/**
 * Surface ids, the `surface` layer, read for grip and drag (GDD §7.3, TECHNICAL_DESIGN §8.2 step 7).
 * The compiler writes only Asphalt, Pavement and Grass. Puddle (wet), WetLeaves and Oil are reserved for the
 * M3 hazard overrides, which are applied at runtime from hazard entities, not baked into the layer.
 * The values are written into compiled files: append new surfaces, never renumber.
 */
export const Surface = {
  Asphalt: 0,
  Pavement: 1,
  Grass: 2,
  Puddle: 3,
  WetLeaves: 4,
  Oil: 5,
} as const;
export type Surface = (typeof Surface)[keyof typeof Surface];

/** Number of surface ids; every value in a `surface` layer is below this. */
export const SURFACE_COUNT = 6;

/**
 * Ground → surface, indexed by ground id (LEVEL_DESIGN §8.3). Cobbles and apron take asphalt grip; yard takes
 * pavement grip. Alley setts take pavement grip (proposal; SSP-034 records the decision in LEVEL_DESIGN
 * §8.3). Water, sand and void are solid, so their surface is never driven on: they read as asphalt, which is
 * also what the sim uses for points outside the map.
 */
export const GROUND_SURFACE: readonly Surface[] = [
  Surface.Asphalt, // Void
  Surface.Asphalt, // Road
  Surface.Asphalt, // RoadOneWayE
  Surface.Asphalt, // RoadOneWayW
  Surface.Asphalt, // RoadOneWayN
  Surface.Asphalt, // RoadOneWayS
  Surface.Pavement, // Pavement
  Surface.Asphalt, // Cobbles
  Surface.Pavement, // Alley
  Surface.Grass, // Grass
  Surface.Pavement, // Yard
  Surface.Asphalt, // Apron
  Surface.Asphalt, // Water
  Surface.Asphalt, // Sand
];

/** The surface a ground id compiles to. Throws on an unknown ground id. */
export function surfaceOfGround(ground: number): Surface {
  const surface = GROUND_SURFACE[ground];
  if (surface === undefined) throw new Error(`surfaceOfGround: unknown ground id ${ground}`);
  return surface;
}

/**
 * Bits of the `collide` layer (TECHNICAL_DESIGN §9.1). SOLID cells block Bessie and are merged into
 * `solids`. A KERB_EDGE bit marks a raised kerb on that edge of the cell (road ↔ pavement); both cells either
 * side of the edge carry the bit for their own direction. Dropped kerbs carry none.
 */
export const COLLIDE = {
  SOLID: 1 << 0,
  KERB_EDGE_N: 1 << 1,
  KERB_EDGE_E: 1 << 2,
  KERB_EDGE_S: 1 << 3,
  KERB_EDGE_W: 1 << 4,
} as const;
export type CollideBit = (typeof COLLIDE)[keyof typeof COLLIDE];

/** Every defined collide bit; a `collide` value with any other bit set is rejected. */
export const COLLIDE_ALL_BITS =
  COLLIDE.SOLID | COLLIDE.KERB_EDGE_N | COLLIDE.KERB_EDGE_E | COLLIDE.KERB_EDGE_S | COLLIDE.KERB_EDGE_W;

/** `autotile` value for a cell with no kerb blob tile (TECHNICAL_DESIGN §15.2). */
export const AUTOTILE_NONE = 255;

/** Number of kerb blob tiles; real autotile indices are 0..46. */
export const AUTOTILE_COUNT = 47;

/** Tallest building column in storeys (landmarks only; ordinary buildings stop at 6, LEVEL_DESIGN §8.4). */
export const MAX_STOREYS = 8;

/**
 * `roof`/`wall` layer value for a cell with no building. A non-zero value n names the asset id
 * `roofIds[n − 1]` (or `wallIds[n − 1]`) from the compiled header, so a file holds at most 255 styles of each.
 */
export const STYLE_NONE = 0;

/** Most roof (or facade) styles one compiled level can name: a Uint8 layer minus STYLE_NONE. */
export const MAX_STYLES = 255;

/** Grime cells per tile edge: 2 m / 0.25 m = 8. The `gutter` layer is (w·8) × (h·8). */
export const GUTTER_CELLS_PER_TILE = TILE_M / GRIME_CELL_M;

/**
 * The asset id (`roof.*` or `facade.*`) a roof/wall layer value names, or null for STYLE_NONE.
 * Throws if the value is past the end of the table.
 */
export function resolveStyle(table: readonly string[], value: number): string | null {
  if (value === STYLE_NONE) return null;
  const id = table[value - 1];
  if (id === undefined)
    throw new Error(`resolveStyle: style value ${value} is not in a ${table.length}-entry table`);
  return id;
}

// ---------------------------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------------------------

/** A tile rectangle `[x0, y0, x1, y1]`: x0/y0 inclusive, x1/y1 exclusive, so a single cell is [x, y, x+1, y+1]. */
export type TileRect = [x0: number, y0: number, x1: number, y1: number];

/** The decoded grid layers, row-major (index = y·w + x). All are w·h long except `gutter`. */
export type LevelLayers = {
  /** Ground id per tile (Ground). */
  ground: Uint8Array;
  /** Kerb blob index 0..46, or AUTOTILE_NONE. */
  autotile: Uint8Array;
  /** Surface id per tile (Surface). */
  surface: Uint8Array;
  /** Building height in storeys, 0 = none, 1..MAX_STOREYS. */
  storeys: Uint8Array;
  /** Roof style: STYLE_NONE or a 1-based index into `roofIds`. */
  roof: Uint8Array;
  /** Facade style: STYLE_NONE or a 1-based index into `wallIds`. */
  wall: Uint8Array;
  /** COLLIDE bits. */
  collide: Uint8Array;
  /** 1 = counts toward Tidy %. */
  route: Uint8Array;
  /** Baked grime density per tile (M2, SSP-054). */
  grimeDensity: Uint8Array;
  /** Gutter mask, one byte per grime cell: (w·8)·(h·8) long (M2, SSP-054). */
  gutter: Uint8Array;
};

/** The layer names in their canonical (encoded) order. */
export const LAYER_NAMES = [
  'ground',
  'autotile',
  'surface',
  'storeys',
  'roof',
  'wall',
  'collide',
  'route',
  'grimeDensity',
  'gutter',
] as const satisfies readonly (keyof LevelLayers)[];
export type LayerName = (typeof LAYER_NAMES)[number];

/** A static prop placed by the map. x/y in metres; rot in radians. */
export type LevelProp = { id: string; x: number; y: number; rot: number };

/** A site (skip, depot bay, zebra, ...) and the tiles it covers. */
export type LevelSite = { id: string; rect: TileRect };

/** Compass face of a frontage. */
export type Face = 'n' | 'e' | 's' | 'w';

/** A frontage (LEVEL_DESIGN §7.10): `fr_<x>_<y>`, whether it is pledged, its tiles and its facing. */
export type Frontage = { id: string; pledge: boolean; rect: TileRect; face: Face };

/** A JSON value, for the lists whose entry shape a later milestone defines (spawns, schedules). */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/** Traffic lane graph (M3, SSP-076). Nodes `[x, y]`; edges `[from, to, speedLimit, flags]`. */
export type LaneGraph = {
  nodes: [x: number, y: number][];
  edges: [from: number, to: number, speedLimit: number, flags: number][];
};

/** Pavement nav graph (M3, SSP-076). Nodes `[x, y]`; edges `[from, to, flags]`. */
export type NavGraph = {
  nodes: [x: number, y: number][];
  edges: [from: number, to: number, flags: number][];
};

/** Compiled weather. `inherit` (the Depot Yard) takes the weather of the day it is played on. */
export type Weather = 'clear' | 'rain' | 'wind' | 'gusts' | 'inherit';

/** Bessie's start pose: x/y in metres, heading in radians (0 = north, clockwise). */
export type PlayerStart = { x: number; y: number; heading: number };

/** A decoded compiled level: the JSON header and lists as-is, the grid layers as typed arrays. */
export type Level = {
  id: string;
  /** [w, h] in tiles. */
  size: [w: number, h: number];
  /** Roof asset ids (`roof.*`) named by the `roof` layer (value n → roofIds[n − 1]). */
  roofIds: string[];
  /** Facade asset ids (`facade.*`) named by the `wall` layer (value n → wallIds[n − 1]). */
  wallIds: string[];
  layers: LevelLayers;
  /** Merged SOLID rectangles in tiles (mergeSolids). */
  solids: TileRect[];
  props: LevelProp[];
  sites: LevelSite[];
  frontages: Frontage[];
  lanes: LaneGraph;
  nav: NavGraph;
  /** Spawn tables by kind (litter, npc, traffic, pickups); entry shape defined in M3 (SSP-077). */
  spawns: { [kind: string]: JsonValue[] };
  /** NPC schedules; entry shape defined in M3. */
  schedules: JsonValue[];
  weather: Weather;
  timerS: number;
  player: PlayerStart;
};

const WEATHERS: readonly Weather[] = ['clear', 'rain', 'wind', 'gusts', 'inherit'];
const FACES: readonly Face[] = ['n', 'e', 's', 'w'];

/** Expected byte length of a layer for a w × h tile map. */
export function layerLength(name: LayerName, w: number, h: number): number {
  return name === 'gutter' ? w * GUTTER_CELLS_PER_TILE * (h * GUTTER_CELLS_PER_TILE) : w * h;
}

/**
 * A level of the given size with empty layers (void ground, no autotile, nothing solid), no styles, empty
 * lists, clear weather, the campaign timer and Bessie at the origin facing north. The compiler fills it in;
 * tests build worlds from it directly.
 */
export function createBlankLevel(id: string, w: number, h: number): Level {
  assertSize(w, h, 'createBlankLevel');
  const layer = (name: LayerName): Uint8Array => new Uint8Array(layerLength(name, w, h));
  return {
    id,
    size: [w, h],
    roofIds: [],
    wallIds: [],
    layers: {
      ground: layer('ground'),
      autotile: layer('autotile').fill(AUTOTILE_NONE),
      surface: layer('surface'),
      storeys: layer('storeys'),
      roof: layer('roof'),
      wall: layer('wall'),
      collide: layer('collide'),
      route: layer('route'),
      grimeDensity: layer('grimeDensity'),
      gutter: layer('gutter'),
    },
    solids: [],
    props: [],
    sites: [],
    frontages: [],
    lanes: { nodes: [], edges: [] },
    nav: { nodes: [], edges: [] },
    spawns: {},
    schedules: [],
    weather: 'clear',
    timerS: SHIFT_S,
    player: { x: 0, y: 0, heading: 0 },
  };
}

// ---------------------------------------------------------------------------------------------------------
// Solid merge
// ---------------------------------------------------------------------------------------------------------

/**
 * Merge the SOLID cells of a collide layer into rectangles (TECHNICAL_DESIGN §9.1). Greedy maximal
 * rectangles in fixed row-major order: at the first unclaimed SOLID cell, grow right as far as unclaimed
 * SOLID cells go, then grow down while the whole span of the next row is unclaimed SOLID; claim and emit.
 * The rects cover exactly the SOLID cells, never overlap, and are `[x0, y0, x1, y1]` in tiles with x1/y1
 * exclusive (TileRect). The same grid always gives the same list in the same order.
 */
export function mergeSolids(collide: Uint8Array, w: number, h: number): TileRect[] {
  assertSize(w, h, 'mergeSolids', true);
  if (collide.length !== w * h) {
    throw new Error(`mergeSolids: collide has ${collide.length} cells, expected ${w}×${h} = ${w * h}`);
  }
  const claimed = new Uint8Array(w * h);
  const free = (i: number): boolean => ((collide[i] ?? 0) & COLLIDE.SOLID) !== 0 && claimed[i] === 0;
  const rects: TileRect[] = [];
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (!free(y * w + x)) continue;
      let x1 = x + 1;
      while (x1 < w && free(y * w + x1)) x1 += 1;
      let y1 = y + 1;
      while (y1 < h) {
        let rowFree = true;
        for (let cx = x; cx < x1; cx += 1) {
          if (!free(y1 * w + cx)) {
            rowFree = false;
            break;
          }
        }
        if (!rowFree) break;
        y1 += 1;
      }
      for (let cy = y; cy < y1; cy += 1) claimed.fill(1, cy * w + x, cy * w + x1);
      rects.push([x, y, x1, y1]);
    }
  }
  return rects;
}

// ---------------------------------------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------------------------------------

function assertSize(w: number, h: number, where: string, allowEmpty = false): void {
  const min = allowEmpty ? 0 : 1;
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < min || h < min || w > 4096 || h > 4096) {
    throw new Error(`${where}: invalid size ${w}×${h}`);
  }
}

/** Throw unless every byte satisfies `ok`; names the first offending tile. */
function checkLayer(
  where: string,
  name: LayerName,
  bytes: Uint8Array,
  w: number,
  ok: (v: number) => boolean,
  rule: string,
): void {
  for (let i = 0; i < bytes.length; i += 1) {
    const v = bytes[i] ?? 0;
    if (!ok(v))
      throw new Error(`${where}: layers.${name} has ${v} at tile (${i % w}, ${Math.floor(i / w)}); ${rule}`);
  }
}

/** Range-check the id layers: known ground/surface ids, autotile 0..46 or 255, styles inside their tables. */
function checkLayerValues(
  where: string,
  layers: LevelLayers,
  w: number,
  roofCount: number,
  wallCount: number,
): void {
  checkLayer(where, 'ground', layers.ground, w, (v) => v < GROUND_COUNT, 'not a Ground id');
  checkLayer(
    where,
    'autotile',
    layers.autotile,
    w,
    (v) => v < AUTOTILE_COUNT || v === AUTOTILE_NONE,
    'not 0..46 or 255',
  );
  checkLayer(where, 'surface', layers.surface, w, (v) => v < SURFACE_COUNT, 'not a Surface id');
  checkLayer(where, 'storeys', layers.storeys, w, (v) => v <= MAX_STOREYS, `over ${MAX_STOREYS} storeys`);
  checkLayer(where, 'roof', layers.roof, w, (v) => v <= roofCount, 'past the end of roofIds');
  checkLayer(where, 'wall', layers.wall, w, (v) => v <= wallCount, 'past the end of wallIds');
  checkLayer(
    where,
    'collide',
    layers.collide,
    w,
    (v) => (v & ~COLLIDE_ALL_BITS) === 0,
    'unknown collide bits',
  );
  checkLayer(where, 'route', layers.route, w, (v) => v <= 1, 'route must be 0 or 1');
}

function finite(value: number, path: string): number {
  if (!Number.isFinite(value)) throw new Error(`encodeLevel: ${path} is not a finite number (${value})`);
  return value;
}

/** A copy of a JSON value with every object's keys sorted, so opaque lists encode in one canonical order. */
function canonicalJson(value: JsonValue, path: string): JsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') return finite(value, path);
  if (Array.isArray(value)) return value.map((item, i) => canonicalJson(item, `${path}[${i}]`));
  const out: { [key: string]: JsonValue } = {};
  for (const key of Object.keys(value).sort()) {
    const item = value[key];
    if (item !== undefined) out[key] = canonicalJson(item, `${path}.${key}`);
  }
  return out;
}

function rectOut(rect: TileRect, path: string): TileRect {
  if (rect.length !== 4 || !rect.every(Number.isInteger)) {
    throw new Error(`encodeLevel: ${path} must be four integer tile coordinates`);
  }
  return [rect[0], rect[1], rect[2], rect[3]];
}

/** Whether a formatted value would contain nested containers (arrays/objects) at its top level. */
function hasContainers(value: JsonValue[] | { [key: string]: JsonValue }): boolean {
  const items = Array.isArray(value) ? value : Object.values(value);
  return items.some((item) => item !== null && typeof item === 'object');
}

/**
 * Deterministic JSON layout: objects that are not inside an array put one key per line; arrays of containers
 * that are not inside an array put one entry per line; everything else (scalars, arrays of scalars and any
 * container inside an array) is written compactly. Key order is the insertion order of the input.
 */
function formatJson(value: JsonValue, indent: string, insideArray: boolean): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (insideArray) return JSON.stringify(value);
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    if (value.length === 0 || !hasContainers(value)) return JSON.stringify(value);
    return `[\n${value.map((item) => inner + formatJson(item, inner, true)).join(',\n')}\n${indent}]`;
  }
  const keys = Object.keys(value);
  if (keys.length === 0) return '{}';
  const lines = keys.map(
    (key) => `${inner}${JSON.stringify(key)}: ${formatJson(value[key] ?? null, inner, false)}`,
  );
  return `{\n${lines.join(',\n')}\n${indent}}`;
}

/**
 * Encode a level as compiled JSON text (TECHNICAL_DESIGN §15.2): keys in the canonical order, layers as
 * base64 Uint8, a trailing newline, no timestamps. The output depends only on the level's contents, so
 * re-encoding a decoded level is byte-identical. Throws on a malformed level (wrong layer length, a style
 * table over 255 entries, a non-finite number).
 */
export function encodeLevel(level: Level): string {
  const [w, h] = level.size;
  assertSize(w, h, 'encodeLevel');
  for (const [name, table] of [
    ['roofIds', level.roofIds],
    ['wallIds', level.wallIds],
  ] as const) {
    if (table.length > MAX_STYLES)
      throw new Error(`encodeLevel: ${name} has ${table.length} entries (max ${MAX_STYLES})`);
  }
  const layers: { [key: string]: JsonValue } = {};
  for (const name of LAYER_NAMES) {
    const bytes = level.layers[name];
    const expected = layerLength(name, w, h);
    if (bytes.length !== expected) {
      throw new Error(`encodeLevel: layer ${name} has ${bytes.length} bytes, expected ${expected}`);
    }
    layers[name] = encodeBase64(bytes);
  }
  checkLayerValues('encodeLevel', level.layers, w, level.roofIds.length, level.wallIds.length);
  const spawns: { [key: string]: JsonValue } = {};
  for (const kind of Object.keys(level.spawns).sort()) {
    spawns[kind] = canonicalJson(level.spawns[kind] ?? [], `spawns.${kind}`);
  }
  const doc: JsonValue = {
    format: LEVEL_FORMAT,
    version: LEVEL_VERSION,
    id: level.id,
    size: [w, h],
    roofIds: [...level.roofIds],
    wallIds: [...level.wallIds],
    layers,
    solids: level.solids.map((r, i) => rectOut(r, `solids[${i}]`)),
    props: level.props.map((p, i) => ({
      id: p.id,
      x: finite(p.x, `props[${i}].x`),
      y: finite(p.y, `props[${i}].y`),
      rot: finite(p.rot, `props[${i}].rot`),
    })),
    sites: level.sites.map((s, i) => ({ id: s.id, rect: rectOut(s.rect, `sites[${i}].rect`) })),
    frontages: level.frontages.map((f, i) => ({
      id: f.id,
      pledge: f.pledge,
      rect: rectOut(f.rect, `frontages[${i}].rect`),
      face: f.face,
    })),
    lanes: {
      nodes: level.lanes.nodes.map((n, i) => [
        finite(n[0], `lanes.nodes[${i}]`),
        finite(n[1], `lanes.nodes[${i}]`),
      ]),
      edges: level.lanes.edges.map((e, i) => e.map((v) => finite(v, `lanes.edges[${i}]`))),
    },
    nav: {
      nodes: level.nav.nodes.map((n, i) => [
        finite(n[0], `nav.nodes[${i}]`),
        finite(n[1], `nav.nodes[${i}]`),
      ]),
      edges: level.nav.edges.map((e, i) => e.map((v) => finite(v, `nav.edges[${i}]`))),
    },
    spawns,
    schedules: canonicalJson(level.schedules, 'schedules'),
    weather: level.weather,
    timerS: finite(level.timerS, 'timerS'),
    player: {
      x: finite(level.player.x, 'player.x'),
      y: finite(level.player.y, 'player.y'),
      heading: finite(level.player.heading, 'player.heading'),
    },
  };
  return `${formatJson(doc, '', false)}\n`;
}

// ---------------------------------------------------------------------------------------------------------
// Decoding (hand-written guards: CLAUDE.md §5.1, no schema library)
// ---------------------------------------------------------------------------------------------------------

type JsonObject = { [key: string]: unknown };

function fail(path: string, message: string): never {
  throw new Error(`decodeLevel: ${path} ${message}`);
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function obj(value: unknown, path: string): JsonObject {
  if (!isObject(value)) fail(path, 'must be an object');
  return value;
}

function arr(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, 'must be an array');
  return value;
}

function str(value: unknown, path: string): string {
  if (typeof value !== 'string') fail(path, 'must be a string');
  return value;
}

function num(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(path, 'must be a finite number');
  return value;
}

function int(value: unknown, path: string): number {
  const n = num(value, path);
  if (!Number.isInteger(n)) fail(path, 'must be an integer');
  return n;
}

function bool(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') fail(path, 'must be a boolean');
  return value;
}

function tuple(
  value: unknown,
  length: number,
  path: string,
  item: (v: unknown, p: string) => number,
): number[] {
  const list = arr(value, path);
  if (list.length !== length) fail(path, `must have ${length} entries`);
  return list.map((v, i) => item(v, `${path}[${i}]`));
}

function rectIn(value: unknown, path: string): TileRect {
  const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = tuple(value, 4, path, int);
  return [x0, y0, x1, y1];
}

function xyIn(value: unknown, path: string): [number, number] {
  const [x = 0, y = 0] = tuple(value, 2, path, num);
  return [x, y];
}

function jsonIn(value: unknown, path: string): JsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') return num(value, path);
  if (Array.isArray(value)) return value.map((item, i) => jsonIn(item, `${path}[${i}]`));
  const o = obj(value, path);
  const out: { [key: string]: JsonValue } = {};
  for (const key of Object.keys(o)) out[key] = jsonIn(o[key], `${path}.${key}`);
  return out;
}

function oneOf<T extends string>(value: unknown, options: readonly T[], path: string): T {
  const s = str(value, path);
  const found = options.find((option) => option === s);
  if (found === undefined) fail(path, `must be one of ${options.join(', ')} (got ${JSON.stringify(s)})`);
  return found;
}

function stylesIn(value: unknown, path: string): string[] {
  const list = arr(value, path).map((v, i) => str(v, `${path}[${i}]`));
  if (list.length > MAX_STYLES) fail(path, `has ${list.length} entries (max ${MAX_STYLES})`);
  return list;
}

/**
 * Decode compiled level JSON (the text, or the value `JSON.parse`/`fetch().json()` returned) into typed
 * arrays. Validates the format tag, version, every field's type, every layer's length and the value range
 * of the id layers, and throws a descriptive error on the first problem.
 */
export function decodeLevel(input: unknown): Level {
  let parsed: unknown = input;
  if (typeof input === 'string') {
    try {
      parsed = JSON.parse(input);
    } catch (error) {
      throw new Error(`decodeLevel: not valid JSON (${String(error)})`);
    }
  }
  const root = obj(parsed, '(root)');
  if (root.format !== LEVEL_FORMAT) fail('format', `must be ${JSON.stringify(LEVEL_FORMAT)}`);
  if (root.version !== LEVEL_VERSION)
    fail('version', `must be ${LEVEL_VERSION} (got ${String(root.version)})`);
  const id = str(root.id, 'id');
  const [w = 0, h = 0] = tuple(root.size, 2, 'size', int);
  if (w < 1 || h < 1 || w > 4096 || h > 4096) fail('size', `is out of range (${w}×${h})`);
  const roofIds = stylesIn(root.roofIds, 'roofIds');
  const wallIds = stylesIn(root.wallIds, 'wallIds');

  const layerSrc = obj(root.layers, 'layers');
  const layer = (name: LayerName): Uint8Array => {
    let bytes: Uint8Array;
    try {
      bytes = decodeBase64(str(layerSrc[name], `layers.${name}`));
    } catch (error) {
      throw new Error(
        `decodeLevel: layers.${name}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const expected = layerLength(name, w, h);
    if (bytes.length !== expected) fail(`layers.${name}`, `has ${bytes.length} bytes, expected ${expected}`);
    return bytes;
  };
  const layers: LevelLayers = {
    ground: layer('ground'),
    autotile: layer('autotile'),
    surface: layer('surface'),
    storeys: layer('storeys'),
    roof: layer('roof'),
    wall: layer('wall'),
    collide: layer('collide'),
    route: layer('route'),
    grimeDensity: layer('grimeDensity'),
    gutter: layer('gutter'),
  };
  checkLayerValues('decodeLevel', layers, w, roofIds.length, wallIds.length);

  const lanes = obj(root.lanes, 'lanes');
  const nav = obj(root.nav, 'nav');
  const spawnSrc = obj(root.spawns, 'spawns');
  const spawns: { [kind: string]: JsonValue[] } = {};
  for (const kind of Object.keys(spawnSrc)) {
    spawns[kind] = arr(spawnSrc[kind], `spawns.${kind}`).map((v, i) => jsonIn(v, `spawns.${kind}[${i}]`));
  }
  const player = obj(root.player, 'player');

  return {
    id,
    size: [w, h],
    roofIds,
    wallIds,
    layers,
    solids: arr(root.solids, 'solids').map((r, i) => rectIn(r, `solids[${i}]`)),
    props: arr(root.props, 'props').map((v, i) => {
      const p = obj(v, `props[${i}]`);
      return {
        id: str(p.id, `props[${i}].id`),
        x: num(p.x, `props[${i}].x`),
        y: num(p.y, `props[${i}].y`),
        rot: num(p.rot, `props[${i}].rot`),
      };
    }),
    sites: arr(root.sites, 'sites').map((v, i) => {
      const s = obj(v, `sites[${i}]`);
      return { id: str(s.id, `sites[${i}].id`), rect: rectIn(s.rect, `sites[${i}].rect`) };
    }),
    frontages: arr(root.frontages, 'frontages').map((v, i) => {
      const f = obj(v, `frontages[${i}]`);
      return {
        id: str(f.id, `frontages[${i}].id`),
        pledge: bool(f.pledge, `frontages[${i}].pledge`),
        rect: rectIn(f.rect, `frontages[${i}].rect`),
        face: oneOf(f.face, FACES, `frontages[${i}].face`),
      };
    }),
    lanes: {
      nodes: arr(lanes.nodes, 'lanes.nodes').map((n, i) => xyIn(n, `lanes.nodes[${i}]`)),
      edges: arr(lanes.edges, 'lanes.edges').map((e, i) => {
        const [from = 0, to = 0, speedLimit = 0, flags = 0] = tuple(e, 4, `lanes.edges[${i}]`, num);
        return [from, to, speedLimit, flags];
      }),
    },
    nav: {
      nodes: arr(nav.nodes, 'nav.nodes').map((n, i) => xyIn(n, `nav.nodes[${i}]`)),
      edges: arr(nav.edges, 'nav.edges').map((e, i) => {
        const [from = 0, to = 0, flags = 0] = tuple(e, 3, `nav.edges[${i}]`, num);
        return [from, to, flags];
      }),
    },
    spawns,
    schedules: arr(root.schedules, 'schedules').map((v, i) => jsonIn(v, `schedules[${i}]`)),
    weather: oneOf(root.weather, WEATHERS, 'weather'),
    timerS: num(root.timerS, 'timerS'),
    player: {
      x: num(player.x, 'player.x'),
      y: num(player.y, 'player.y'),
      heading: num(player.heading, 'player.heading'),
    },
  };
}
