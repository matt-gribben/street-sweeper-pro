// level.json schema (LEVEL_DESIGN §8.4), type-only so it is erasable on Node type stripping and reusable by
// the runtime loader. The compiler (tools/levels/compile-level.ts) checks a parsed file against these types
// with hand-written guards (CLAUDE.md §5.1: no schema library) and reports a mismatch as L000.
//
// Schema decisions (SSP-033):
// - `pledges`, `litter` and `grime` are OPTIONAL here although §8.4 lists them as required. Nothing reads
//   them before M2 (frontages, litter spawns and grime baking: SSP-054/SSP-055), and requiring them now would
//   force M1 levels to carry placeholder data. M2 makes them required for `mode: "shift"` and adds L030/L051.
//   (SSP-033 open question 2.)
// - The map size is checked against `size` here, not against src/data/districts.json (TECHNICAL_DESIGN
//   §15.1), because no M1 task creates districts.json. (SSP-033 open question 1.)
// - The compiler validates only the fields M1 consumes (identity, mode, map, size, timer, seed, timeOfDay,
//   weather, music, ambience, start, depot, legend, buildings, anchors). The spawn-side fields (`junctions`,
//   `frontageWidth`, `stains`, `hazards`, `knockables`, `powerups`, `collectibles`, `npcs`, `traffic`,
//   `events`, `skipRun`, `par`) are typed for authors but passed over unchecked until the tasks that consume
//   them (M2 SSP-054/055, M3 SSP-076/077, M6 SSP-190) add their guards.
// - `legend` keys are single printable ASCII characters. A level may add or override entries but never
//   redefine `A`–`Z`, `0`–`9` or `@` (§8.3). A legend entry without `ground` inherits its ground (§8.3).
// - `start.heading` is an integer heading index 0..31 (h00 = north, clockwise); the compiler converts it to
//   radians. `depot.rect` is `[x, y, w, h]` in tiles, unlike the compiled `[x0, y0, x1, y1]` rects.

export type Day = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
export type XY = [number, number];
/** Canonical ID → weight. */
export type Weights = Record<string, number>;

export type Mode = 'shift' | 'skip_run';
export type TimeOfDay =
  | 'dawn'
  | 'morning'
  | 'late_morning'
  | 'afternoon'
  | 'golden_hour'
  | 'night'
  | 'inherit';
export type LevelWeather = 'clear' | 'rain' | 'wind' | 'gusts' | 'inherit';

/**
 * Ground names a legend entry may use, one per Ground id in src/sim/map.ts (`void` is the space character).
 * One-way roads carry their flow direction (`>` east, `<` west, `^` north, `v` south).
 */
export type GroundName =
  | 'void'
  | 'road'
  | 'road_one_way_e'
  | 'road_one_way_w'
  | 'road_one_way_n'
  | 'road_one_way_s'
  | 'pavement'
  | 'cobbles'
  | 'alley'
  | 'grass'
  | 'yard'
  | 'apron'
  | 'water'
  | 'sand';

export interface LegendEntry {
  /** Fixed ground; omitted = inherited from the orthogonal plain-ground neighbours (§8.3). */
  ground?: GroundName;
  prop?: `prop.${string}`;
  site?: `site.${string}`;
  haz?: `haz.${string}`;
  /** Solid cell (wall, hedge, railing). The SOLID collide bit itself is written by SSP-034. */
  solid?: boolean;
  /** Night levels: exempt from the lamp-pool rule (L072, M6). */
  darkOk?: boolean;
}

export type BuildingUse = 'house' | 'shop' | 'pub' | 'takeaway' | 'civic' | 'unit' | 'depot' | 'none';

export interface Building {
  /** 1..6; up to 8 only with `landmark: true` (L004). */
  storeys: number;
  /** Roof asset id; must exist in assets-src/manifest.json (L004). */
  roof: `roof.${string}`;
  /** Facade set asset id; must exist in assets-src/manifest.json (L004). */
  wall: `facade.${string}`;
  use: BuildingUse;
  landmark?: boolean;
  /** Roof furniture kinds, laid out by a seeded forge script (M4). */
  roofkit?: string[];
  /** Overrides the per-use frontage width (M2). */
  frontageWidth?: number;
}

export interface LitterSpec {
  initial: number;
  table: Weights;
  gutterBias: number;
  minSpacingM: number;
  hotspots?: { near: string; radius: number; mult: number }[];
}

export interface GrimeSpec {
  cells: number;
  gutterShare: number;
  zones: { rect?: [number, number, number, number]; near?: string; radius?: number; density: number }[];
  speckle: number;
}

export interface NpcSpec {
  population: { from: number; to: number; target: number }[];
  mix: Weights;
  caps?: Record<string, number>;
  named?: {
    id: `npc.${string}`;
    anchor: string;
    spawnAt: number;
    route: string[];
    loop?: boolean;
    count?: number;
  }[];
  perches?: { id: 'npc.cat'; count: number; on: ('walls' | 'carRoofs' | 'road')[] };
  flocks?: { id: 'npc.pigeon' | 'npc.seagull'; count: number; size: [number, number]; near: string }[];
}

export interface TrafficSpec {
  densityPerKm: number;
  mix: Weights;
  parkedFill: number;
  parkedMix: Weights;
  taxiRank?: XY[];
  busRoute?: string[];
  busEveryS?: number;
}

export interface EventSpec {
  type: string;
  at?: number | number[];
  untilS?: number;
  trigger?: string;
  [param: string]: unknown;
}

export interface SkipRunSpec {
  bays: Record<string, XY>;
  variants: Partial<
    Record<Day, { gates: { at: XY; pass: 'left' | 'right' }[]; cones: XY[]; bays: string[] }>
  >;
}

export interface LevelFile {
  schema: 1;
  id: `district.${string}`;
  /** British English, as shown in game. */
  name: string;
  day: Day | 'any';
  mode: Mode;
  /** The map file's name, e.g. "puddle_lane.map.txt"; must be the pair's own map. */
  map: string;
  /** [w, h] in tiles; the map must be exactly this size (L001). */
  size: [number, number];
  /** 240 for shifts, 45 for the Skip Run (L006). */
  timer: number;
  /** Campaign seed (uint32). */
  seed: number;
  timeOfDay: TimeOfDay;
  weather: LevelWeather;
  /** Shape-checked (`^mus\.[a-z0-9_]+$`, L005); copied to the compiled header. */
  music?: `mus.${string}`;
  /** Shape-checked (`^amb\.[a-z0-9_]+$`, L005); copied to the compiled header. */
  ambience?: `amb.${string}`;
  /** Heading index 0..31, h00 = north. */
  start: { heading: number };
  /** [x, y, w, h] in tiles; must contain the `@` (L003). */
  depot: { rect: [number, number, number, number] };
  legend?: Record<string, LegendEntry>;
  /** Keys "A".."Z". */
  buildings: Record<string, Building>;
  /** Digit → anchor name, e.g. "1" → "doris_home". */
  anchors?: Record<string, string>;
  junctions?: { at: XY; major: ('n' | 'e' | 's' | 'w')[] }[];
  frontageWidth?: Partial<Record<BuildingUse, number>>;
  /** Optional until M2 (see the decisions above). */
  pledges?: string[];
  /** Optional until M2 (see the decisions above). */
  litter?: LitterSpec;
  /** Optional until M2 (see the decisions above). */
  grime?: GrimeSpec;
  stains?: { count: number; table: Weights; near?: string[] };
  hazards?: {
    place?: { id: `haz.${string}`; at: XY }[];
    random?: { id: `haz.${string}`; count: number; rule: string }[];
  };
  knockables?: { id: `prop.${string}`; at: XY }[];
  powerups?: { count: 1 | 2 | 3; table: Weights; at?: XY[] };
  collectibles?: { lostProperty: { id: `collect.${string}`; at: XY }; goldenCrisp: { at: XY } };
  npcs?: NpcSpec;
  traffic?: TrafficSpec | { none: true };
  events?: EventSpec[];
  skipRun?: SkipRunSpec;
  par?: { loadout: string[]; star1: number; star2: number; star3: number; perfectMin: number };
}
