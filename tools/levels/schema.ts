// level.json schema (LEVEL_DESIGN §8.4), type-only so it is erasable on Node type stripping and reusable by
// the runtime loader. The compiler (tools/levels/compile-level.ts) checks a parsed file against these types
// with hand-written guards (CLAUDE.md §5.1: no schema library) and reports a mismatch as L000.
//
// Schema decisions (SSP-033):
// - `pledges`, `litter` and `grime` are OPTIONAL here although §8.4 lists them as required. Nothing read
//   them before M2, and requiring them would have forced M1 levels to carry placeholder data (SSP-033 open
//   question 2). SSP-054 validates `litter` and `grime` fully when present (L000, L005 litter ids, L050,
//   L051) and bakes them, but still leaves them optional: Puddle Lane gets its values in SSP-056, which is
//   the first point at which a shift level could be required to carry them. A level without them compiles
//   with no `spawns.litter`/`spawns.grime` (its grime cells are still baked). SSP-055 does the same for
//   `pledges`, `powerups` and `collectibles`: checked when present (L000, L005, L030, L031, L040, L041) and
//   left optional until SSP-056 authors them for Puddle Lane. Frontages are generated on every level.
// - The map size is checked against `size` here, not against src/data/districts.json (TECHNICAL_DESIGN
//   §15.1), because no M1 task creates districts.json. (SSP-033 open question 1.)
// - The compiler validates only the fields M1 consumes (identity, mode, map, size, timer, seed, timeOfDay,
//   weather, music, ambience, start, depot, legend, buildings, anchors), plus `litter` and `grime` since
//   SSP-054, `frontageWidth`, `pledges`, `powerups` and `collectibles` since SSP-055 and `junctions` since
//   SSP-076. The other spawn-side fields (`stains`, `hazards`, `knockables`, `npcs`, `traffic`, `events`,
//   `skipRun`, `par`) are typed for authors but passed over unchecked until the tasks that consume them
//   (M3 SSP-077, M6 SSP-190) add their guards.
// - `junctions` (SSP-076): `major` became optional and `roundabout` was added, because LEVEL_DESIGN §7.4's
//   mini-roundabout has no map character. An entry names the junction whose cells include its `at` tile and
//   sets its major sides (give-way on the others), marks it a mini-roundabout, or both; it must do one.
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

/**
 * A `near` reference (litter hotspots, grime zones; SSP-054): `prop.<id>` (every such prop), `site.<id>` (every
 * cell of that site), `use:<BuildingUse>` (every cell of a building with that use) or an anchor name from
 * `anchors`. Anything else is L000.
 */
export type NearRef = string;

/** level.json → litter (LEVEL_DESIGN §8.4, §9.1). Checked and baked by SSP-054. */
export interface LitterSpec {
  /** Items at shift start; with the expected dynamic litter at most 1,000 (L050). */
  initial: number;
  /** `litter.*` id → weight > 0; ids must be in entities.json and allowed in the district (L005). */
  table: Weights;
  /** 0..1: the share of the litter weight the road gutter (road within 1 tile of a raised kerb) holds. */
  gutterBias: number;
  /** Metres between items; default 0.5. */
  minSpacingM?: number;
  /** Weight multipliers: `radius` in tiles (> 0), `mult` > 0. */
  hotspots?: { near: NearRef; radius: number; mult: number }[];
}

/** level.json → grime (LEVEL_DESIGN §8.4, §9.2). Checked and baked by SSP-054. */
export interface GrimeSpec {
  /** Exact initial grime cell count; at most the OPEN grime cells (L051). */
  cells: number;
  /** 0..1: round(cells × gutterShare) of them are gutter-band cells (L051 if the band is too small). */
  gutterShare: number;
  /** Exactly one of `rect` ([x, y, w, h] in tiles) or `near` + `radius` (tiles); density 0..1. */
  zones: { rect?: [number, number, number, number]; near?: NearRef; radius?: number; density: number }[];
  /** Background noise amplitude 0..0.1, added by dirt.ts at shift start. */
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
  /** Give-way overrides and mini-roundabouts (SSP-076): `at` is any tile of the junction; set major and/or roundabout. */
  junctions?: { at: XY; major?: ('n' | 'e' | 's' | 'w')[]; roundabout?: boolean }[];
  /** Per-use frontage widths in tiles; only the uses that get frontages (house … unit), positive integers. */
  frontageWidth?: Partial<Record<BuildingUse, number>>;
  /** Frontage ids `fr_<x>_<y>`: 8..20 on a shift level, each a generated frontage (L030). Optional (above). */
  pledges?: string[];
  /** Optional (see the decisions above). */
  litter?: LitterSpec;
  /** Optional (see the decisions above). */
  grime?: GrimeSpec;
  stains?: { count: number; table: Weights; near?: string[] };
  hazards?: {
    place?: { id: `haz.${string}`; at: XY }[];
    random?: { id: `haz.${string}`; count: number; rule: string }[];
  };
  knockables?: { id: `prop.${string}`; at: XY }[];
  /** 1..3 on a shift level (L040); `pwr.*` ids allowed in the district (L005); `at` inside the map. */
  powerups?: { count: 1 | 2 | 3; table: Weights; at?: XY[] };
  /** Shift levels place both, on tiles Bessie's body can reach and not in a footway (L041). */
  collectibles?: { lostProperty: { id: `collect.${string}`; at: XY }; goldenCrisp: { at: XY } };
  npcs?: NpcSpec;
  traffic?: TrafficSpec | { none: true };
  events?: EventSpec[];
  skipRun?: SkipRunSpec;
  par?: { loadout: string[]; star1: number; star2: number; star3: number; perfectMin: number };
}
