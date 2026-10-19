// The compiled level (TECHNICAL_DESIGN §15.2): v1 types, the JSON codec, the id tables and the solid merge.
// Shared by the level compiler (tools/levels/compile-level.ts, on Node type stripping) and the sim, so the
// encoder and decoder can never disagree (§15.2, §2.1). Pure: no fs, DOM, three, Date or Math.random.
// Everything here runs once per compile or once per shift load, never per tick, so it may allocate.
//
// Units (TECHNICAL_DESIGN §15.2): grid layers, `size`, `solids` and every `rect` are in tiles (2 m);
// `props[].x/y` and `player.x/y` are sim metres; `props[].rot` and `player.heading` are radians (0 = north,
// clockwise, §4). level.json (LEVEL_DESIGN §8.4) authors tile coordinates; the compiler converts.
import { decodeBase64, decodeBase64Uint16, encodeBase64, encodeBase64Uint16 } from './base64.ts';
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
 * pavement grip. Alley setts take pavement grip, 8.0 (decided in SSP-034, recorded in LEVEL_DESIGN §8.3).
 * Water, sand and void are solid, so their surface is never driven on: they read as asphalt, which is also
 * what the sim uses for points outside the map.
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

/**
 * Bits of the `markings` layer (TECHNICAL_DESIGN §15.2; the representation decided in SSP-034): the road
 * markings the compiler derives from the map (LEVEL_DESIGN §7.1) and the procedural tile set draws. Sites
 * already carry zebras, school crossings, bus boxes and depot bays, so they are not repeated here.
 * - PARKING_BAY: a `p` cell (bay outline; parked-car candidates in M3).
 * - DOUBLE_YELLOW: a road cell with a raised kerb edge, drawn along each KERB_EDGE side of its `collide`
 *   value; not on bays, sites or speed bumps.
 * - CENTRE_NS / CENTRE_EW: a two-way road's centre line runs through the middle of the cell (odd widths).
 * - CENTRE_E_EDGE / CENTRE_S_EDGE: it runs along the cell's east / south edge (even widths).
 * Bits 6–7 are free for the give-way lines and one-way arrows that need the M3 lane graph (SSP-076).
 * The values are written into compiled files: append new bits, never renumber.
 */
export const MARKING = {
  PARKING_BAY: 1 << 0,
  DOUBLE_YELLOW: 1 << 1,
  CENTRE_NS: 1 << 2,
  CENTRE_EW: 1 << 3,
  CENTRE_E_EDGE: 1 << 4,
  CENTRE_S_EDGE: 1 << 5,
} as const;
export type MarkingBit = (typeof MARKING)[keyof typeof MARKING];

/** Every defined marking bit; a `markings` value with any other bit set is rejected. */
export const MARKING_ALL_BITS =
  MARKING.PARKING_BAY |
  MARKING.DOUBLE_YELLOW |
  MARKING.CENTRE_NS |
  MARKING.CENTRE_EW |
  MARKING.CENTRE_E_EDGE |
  MARKING.CENTRE_S_EDGE;

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
 * Bits of the `gutter` layer, one byte per 0.25 m grime cell (SSP-054; TECHNICAL_DESIGN §10.3 and §15.2,
 * LEVEL_DESIGN §9.2). The compiler bakes them; dirt.ts reads them at shift start.
 * - OPEN: grime may spawn in this cell: it lies on a route-area tile, not on a `site.skip` tile and not under
 *   any part of a solid prop's footprint. Every other cell (off route, grass, aprons, footways, under props)
 *   is 0 and never grimy.
 * - GUTTER: the cell is in the gutter band, the 2 grime cells (0.5 m, 8 px) on the road side of a raised kerb
 *   edge. Always set together with OPEN.
 * The values are written into compiled files: append new bits, never renumber.
 */
export const GRIME_CELL = {
  OPEN: 1 << 0,
  GUTTER: 1 << 1,
} as const;
export type GrimeCellBit = (typeof GRIME_CELL)[keyof typeof GRIME_CELL];

/** Every defined grime cell bit; a `gutter` value with any other bit set is rejected. */
export const GRIME_CELL_ALL_BITS = GRIME_CELL.OPEN | GRIME_CELL.GUTTER;

/** Edge of one litter spawn sub-cell in metres (LEVEL_DESIGN §9.1): a tile split into 4×4. */
export const LITTER_CELL_M = 0.5;

/** Litter sub-cells per tile edge: 2 m / 0.5 m = 4. The litter fields are (w·4) × (h·4). */
export const LITTER_CELLS_PER_TILE = TILE_M / LITTER_CELL_M;

/**
 * Bits of the compiled litter `places` field, one byte per 0.5 m sub-cell (SSP-054, LEVEL_DESIGN §9.1). They
 * describe the sub-cell; a litter table entry's `requires` names the bits a sub-cell must all have for that
 * type to spawn there (leaf piles near trees, bin bags near kerbs, dog mess on pavements).
 * - GUTTER: a road sub-cell within 1 tile (2 m) of a raised kerb edge (the base weight 3.0 and `gutterBias`).
 * - PAVEMENT: on pavement ground (slabs, including dropped kerbs).
 * - NEAR_TREE: within 4 m of a `prop.tree`.
 * - NEAR_KERB: within 2 tiles (4 m) of a raised kerb edge.
 * The values are written into compiled files: append new bits, never renumber.
 */
export const LITTER_PLACE = {
  GUTTER: 1 << 0,
  PAVEMENT: 1 << 1,
  NEAR_TREE: 1 << 2,
  NEAR_KERB: 1 << 3,
} as const;
export type LitterPlaceBit = (typeof LITTER_PLACE)[keyof typeof LITTER_PLACE];

/** Every defined litter place bit; a `places` value or `requires` mask with any other bit is rejected. */
export const LITTER_PLACE_ALL_BITS =
  LITTER_PLACE.GUTTER | LITTER_PLACE.PAVEMENT | LITTER_PLACE.NEAR_TREE | LITTER_PLACE.NEAR_KERB;

/** Largest compiled litter weight: the heaviest sub-cell of a level is scaled to this (Uint16). */
export const LITTER_WEIGHT_MAX = 65535;

/**
 * Bits of a traffic lane edge's `flags` (SSP-076; TECHNICAL_DESIGN §11.4 and §15.2, LEVEL_DESIGN §7.1–§7.5).
 * A stop flag (ZEBRA, SCHOOL_CROSSING, BUS_STOP, GIVE_WAY) means the edge's `to` node lies on that feature
 * (or, for GIVE_WAY, past the give-way line into a junction): along a path, the `from` node of the first
 * flagged edge is where a vehicle stops.
 * - ZEBRA / SCHOOL_CROSSING / BUS_STOP: the lane tiles at the `to` node include a `site.zebra`,
 *   `site.school_crossing` or `site.bus_stop` tile.
 * - GIVE_WAY: a connector from a minor arm into a junction, or an entry onto a mini-roundabout.
 * - PORTAL_IN: the `from` node is an entry portal on the map edge (traffic spawns there).
 * - PORTAL_OUT: the `to` node is an exit portal on the map edge (traffic despawns there).
 * - JUNCTION: a connector through a junction box, from one arm's lane to another's.
 * - ROUNDABOUT: an edge of a mini-roundabout's clockwise ring, or a connector onto or off it.
 * - U_TURN: a turn-around at a dead end (or a junction with a single arm), from one lane into the other.
 * The values are written into compiled files: append new bits, never renumber.
 */
export const LANE_FLAG = {
  ZEBRA: 1 << 0,
  SCHOOL_CROSSING: 1 << 1,
  BUS_STOP: 1 << 2,
  GIVE_WAY: 1 << 3,
  PORTAL_IN: 1 << 4,
  PORTAL_OUT: 1 << 5,
  JUNCTION: 1 << 6,
  ROUNDABOUT: 1 << 7,
  U_TURN: 1 << 8,
} as const;
export type LaneFlagBit = (typeof LANE_FLAG)[keyof typeof LANE_FLAG];

/** Every defined lane edge flag; an edge with any other bit set is rejected. */
export const LANE_FLAG_ALL_BITS = (1 << 9) - 1;

/**
 * Bits of a pavement nav edge's `flags` (SSP-076; TECHNICAL_DESIGN §11.1, LEVEL_DESIGN §7.2–§7.5). An edge
 * with any of them is a road crossing; every other nav edge joins two walkable tiles and never crosses a road.
 * Behaviours that jaywalk ignore the crossing edges and leave the graph instead.
 * - ZEBRA: the crossing runs over `site.zebra` tiles only.
 * - SCHOOL_CROSSING: over `site.school_crossing` tiles only.
 * - DROPPED_KERB: from or to a dropped kerb `d`, over any road tiles.
 * The values are written into compiled files: append new bits, never renumber.
 */
export const NAV_FLAG = {
  ZEBRA: 1 << 0,
  SCHOOL_CROSSING: 1 << 1,
  DROPPED_KERB: 1 << 2,
} as const;
export type NavFlagBit = (typeof NAV_FLAG)[keyof typeof NAV_FLAG];

/** The nav flags that mark a road-crossing edge. */
export const NAV_FLAG_CROSSING = NAV_FLAG.ZEBRA | NAV_FLAG.SCHOOL_CROSSING | NAV_FLAG.DROPPED_KERB;

/** Every defined nav edge flag; an edge with any other bit set is rejected. */
export const NAV_FLAG_ALL_BITS = NAV_FLAG_CROSSING;

/**
 * The named random-hazard placement rules (LEVEL_DESIGN §9.3; SSP-077), in HAZARD_RULE bit order: bit n of a
 * `spawns.hazards.candidates` tile is HAZARD_RULES[n]. Append new rules, never renumber.
 */
export const HAZARD_RULES = ['kerbside_low_points', 'carriageway', 'near_parking'] as const;
export type HazardRule = (typeof HAZARD_RULES)[number];

/**
 * Bits of the `spawns.hazards.candidates` tile layer (SSP-077): a tile where a random hazard of that rule may
 * be placed at shift start. The compiler has already removed every tile the exclusions forbid (LEVEL_DESIGN
 * §9.3: within 3 tiles of `@`, a zebra or school crossing, a depot bay or skip, a hydrant or the 8 tiles round
 * it; and a parking bay, a prop or speed-bump tile, or a tile Bessie cannot drive on).
 * - KERBSIDE_LOW_POINTS: a road tile with a raised kerb edge: the gutter, where puddles collect.
 * - CARRIAGEWAY: a road tile under a traffic lane node: the wheel tracks, where potholes are.
 * - NEAR_PARKING: a road or yard tile (not a bay) within 2 tiles of a parking bay or of a unit's yard.
 */
export const HAZARD_RULE = {
  KERBSIDE_LOW_POINTS: 1 << 0,
  CARRIAGEWAY: 1 << 1,
  NEAR_PARKING: 1 << 2,
} as const;

/** Every defined hazard candidate bit. */
export const HAZARD_RULE_ALL_BITS = (1 << HAZARD_RULES.length) - 1;

/** The candidate bit of a named hazard rule. */
export function hazardRuleBit(rule: HazardRule): number {
  return 1 << HAZARD_RULES.indexOf(rule);
}

/** Where a level's cats may perch (LEVEL_DESIGN §9.4; level.json → npcs.perches.on), in canonical order. */
export const PERCH_SURFACES = ['walls', 'carRoofs', 'road'] as const;
export type PerchSurface = (typeof PERCH_SURFACES)[number];

/** The event types of LEVEL_DESIGN §4.3, in catalogue order (level.json → events[].type; SSP-077). */
export const EVENT_TYPES = [
  'dawn',
  'tutorial_beat',
  'market',
  'market_close',
  'bin_round',
  'rain',
  'leaf_fall',
  'school_out',
  'gust',
  'vehicle_stop',
  'rival_cameo',
  'kicking_out',
  'crossing_patrol',
  'parade',
  'inspection',
  'population_wave',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/**
 * The event params that name anchors (LEVEL_DESIGN §4.3) and the graph each one's actor moves on: `lane` for
 * vehicles (the bin lorry, Sid's sweeper, the ice cream van, the parade's road closure) and `nav` for people.
 * `anchor` is one anchor; `route` and `anchors` are lists. The compiler resolves each anchor to a node of that
 * graph (L080 when it cannot), so a compiled schedule holds node indices where level.json held anchors.
 */
export const EVENT_ANCHOR_PARAMS: {
  readonly [T in EventType]?: { readonly [param: string]: 'lane' | 'nav' };
} = {
  bin_round: { route: 'lane' },
  school_out: { anchor: 'nav' },
  vehicle_stop: { anchor: 'lane' },
  rival_cameo: { route: 'lane' },
  kicking_out: { anchors: 'nav' },
  parade: { route: 'lane' },
  inspection: { route: 'nav' },
};

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
  /** MARKING bits (road markings derived by the compiler). */
  markings: Uint8Array;
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
  /**
   * Zone grime density per tile, 0..255 = 0..1 (SSP-054): the highest `grime.zones` density covering a route
   * tile, 0 off route. dirt.ts adds the seeded speckle noise (LEVEL_DESIGN §9.2).
   */
  grimeDensity: Uint8Array;
  /** GRIME_CELL bits (OPEN, GUTTER), one byte per grime cell: (w·8)·(h·8) long (SSP-054). */
  gutter: Uint8Array;
};

/** The layer names in their canonical (encoded) order. */
export const LAYER_NAMES = [
  'ground',
  'autotile',
  'markings',
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

/**
 * A frontage (LEVEL_DESIGN §7.10; compiled by SSP-055): `fr_<x>_<y>`, whether it is pledged, its zone and the
 * way its facade faces. `cells` are the zone's tiles (pavement up to 3 deep plus the gutter road tile), sorted
 * row-major and unique; `rect` is their bounding box. A zone is not always a rectangle (pavement depth varies
 * at corners and junction mouths), so the cells are the zone and the rect only bounds it (TECHNICAL_DESIGN
 * §15.2).
 */
export type Frontage = {
  id: string;
  pledge: boolean;
  rect: TileRect;
  face: Face;
  cells: [x: number, y: number][];
};

/** A JSON value, for the lists whose entry shape a later milestone defines (spawns, schedules). */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/**
 * A run of parking bays (`p` cells) beside one traffic lane (SSP-076): the cells as a tile rect (x1/y1
 * exclusive, like every rect) and the heading in radians (0 = north, clockwise) of the lane beside it, which
 * is the way a car parked there faces. The run is cut into 2-tile bays, one car each (parkingBays.ts, SSP-090).
 */
export type ParkingBay = { rect: TileRect; heading: number };

/** A frontage's door point on the nav graph (SSP-076): the node in front of the facade's centre. */
export type NavDoor = { frontage: string; node: number };

/** An anchor digit's nav node (SSP-076): the node on the anchor's tile, or the nearest one. */
export type NavAnchor = { char: string; name: string; node: number };

/**
 * The traffic lane graph as compiled JSON lists (SSP-076): what the compiler builds and the file holds.
 * Nodes are `[x, y]` in metres; edges are directed `[from, to, speedLimitMps, flags]` (LANE_FLAG), sorted
 * by (from, to) with no repeats.
 */
export type LaneGraphLists = {
  nodes: readonly (readonly [x: number, y: number])[];
  edges: readonly (readonly [from: number, to: number, speedLimitMps: number, flags: number])[];
  bays: readonly ParkingBay[];
};

/**
 * The pavement nav graph as compiled JSON lists (SSP-076). Nodes are `[x, y]` in metres (walkable tile
 * centres, row-major). Edges `[from, to, flags]` (NAV_FLAG) are two-way: each is listed once with from < to,
 * sorted by (from, to). `portals` are the nodes on the map edge (ascending), `doors` one per frontage that has
 * a door point (frontage order) and `anchors` one per anchor tile (sorted by char, then node).
 */
export type NavGraphLists = {
  nodes: readonly (readonly [x: number, y: number])[];
  edges: readonly (readonly [from: number, to: number, flags: number])[];
  portals: readonly number[];
  doors: readonly NavDoor[];
  anchors: readonly NavAnchor[];
};

/**
 * The decoded traffic lane graph (M3, SSP-076): typed arrays built once per shift load, so traffic.ts walks it
 * without allocating. Edges are sorted by `from`, so the edges leaving node n are `outStart[n]` up to (not
 * including) `outStart[n + 1]` (CSR offsets).
 */
export type LaneGraph = {
  readonly nodeCount: number;
  /** Node positions in metres. */
  readonly nodeX: Float64Array;
  readonly nodeY: Float64Array;
  readonly edgeCount: number;
  readonly edgeFrom: Uint32Array;
  readonly edgeTo: Uint32Array;
  /** The edge's speed limit in m/s (tuning.json → streetLife.laneSpeed, baked by the compiler). */
  readonly edgeSpeedMps: Float64Array;
  /** LANE_FLAG bits. */
  readonly edgeFlags: Uint16Array;
  /** nodeCount + 1 offsets into the edge arrays. */
  readonly outStart: Uint32Array;
  readonly bays: readonly ParkingBay[];
};

/**
 * The decoded pavement nav graph (M3, SSP-076). Edges are two-way; the adjacency lists hold each edge from
 * both ends: node n's neighbours are `adjNode[k]` over `adjEdge[k]` for k from `adjStart[n]` up to (not
 * including) `adjStart[n + 1]`, in edge order (CSR offsets).
 */
export type NavGraph = {
  readonly nodeCount: number;
  /** Node positions in metres. */
  readonly nodeX: Float64Array;
  readonly nodeY: Float64Array;
  readonly edgeCount: number;
  /** Edge endpoints, edgeFrom < edgeTo. */
  readonly edgeFrom: Uint32Array;
  readonly edgeTo: Uint32Array;
  /** NAV_FLAG bits. */
  readonly edgeFlags: Uint8Array;
  /** nodeCount + 1 offsets into adjEdge/adjNode. */
  readonly adjStart: Uint32Array;
  readonly adjEdge: Uint32Array;
  readonly adjNode: Uint32Array;
  /** Map-edge nodes, ascending. */
  readonly portals: Uint32Array;
  readonly doors: readonly NavDoor[];
  readonly anchors: readonly NavAnchor[];
};

/** One compiled litter type: its id, its `litter.table` weight and the LITTER_PLACE bits it requires. */
export type LitterTableEntry = { id: string; weight: number; requires: number };

/**
 * The compiled litter spawn field (`spawns.litter`, SSP-054; LEVEL_DESIGN §9.1). The compiler emits weights,
 * not placements: litter.ts samples them at shift start with the seed's `litter` stream. `places` and
 * `weights` are row-major over (w·4) × (h·4) sub-cells of 0.5 m. A weight is relative (the heaviest sub-cell
 * is LITTER_WEIGHT_MAX); 0 means litter never spawns there (off route, under a prop, or no table type allowed).
 */
export type LitterSpawn = {
  /** Items placed at shift start (`litter.initial`). */
  initial: number;
  /** Minimum distance between items in metres (`litter.minSpacingM`, default 0.5). */
  minSpacingM: number;
  /** The type table, sorted by id. */
  table: LitterTableEntry[];
  /** LITTER_PLACE bits per sub-cell. */
  places: Uint8Array;
  /** Relative spawn weight per sub-cell, 0..LITTER_WEIGHT_MAX. */
  weights: Uint16Array;
};

/**
 * The compiled grime selection (`spawns.grime`, SSP-054; LEVEL_DESIGN §9.2): dirt.ts takes exactly `cells`
 * OPEN grime cells, `gutterCells` of them from the GUTTER band and the rest from the other OPEN cells, each
 * part by (score desc, index asc).
 */
export type GrimeSpawn = {
  /** Exact initial grime cell count (`grime.cells`). */
  cells: number;
  /** How many of them are gutter cells: round(cells × gutterShare). */
  gutterCells: number;
  /** Background noise amplitude 0..0.1 (`grime.speckle`). */
  speckle: number;
};

/** A canonical id and its relative weight (a level.json `Weights` table, compiled sorted by id). */
export type WeightEntry = { id: string; weight: number };

/** A position in metres (sim coordinates). */
export type PointM = [x: number, y: number];

/** An ambient population window (SSP-077): from `fromS` up to `toS` elapsed seconds the target is `target`. */
export type PopulationWindow = { fromS: number; toS: number; target: number };

/**
 * A named NPC (SSP-077; LEVEL_DESIGN §9.4): `count` of `id` spawn at nav node `anchor` at `spawnAtS` elapsed
 * seconds and walk the nav nodes of `route` in order (round again when `loop`). Named NPCs never despawn.
 */
export type NamedNpc = {
  id: string;
  count: number;
  spawnAtS: number;
  anchor: number;
  route: number[];
  loop: boolean;
};

/**
 * The cats' perches (SSP-077): `count` cats on the listed surfaces. `walls` are the centres (metres) of every
 * `w` wall tile, listed when `on` includes walls; parked-car roofs and road grooming spots are found at
 * runtime from the parked cars (SSP-090) and the lane graph.
 */
export type NpcPerches = { id: string; count: number; on: PerchSurface[]; walls: PointM[] };

/** A bird flock spec (SSP-077): `count` flocks of `size[0]`..`size[1]` birds near one of `points` (metres). */
export type NpcFlock = { id: string; count: number; size: [min: number, max: number]; points: PointM[] };

/**
 * The compiled NPC spawn spec (`spawns.npc`, SSP-077; LEVEL_DESIGN §9.4). The spawner (SSP-080) runs it with
 * the `npc` stream: `mix` (sorted by id) picks ambient types within `caps` (sorted by id) towards the current
 * `population` window's target (windows ascend and never overlap).
 */
export type NpcSpawn = {
  population: PopulationWindow[];
  mix: WeightEntry[];
  caps: { id: string; cap: number }[];
  named: NamedNpc[];
  perches: NpcPerches | null;
  flocks: NpcFlock[];
};

/**
 * The compiled traffic spawn spec (`spawns.traffic`, SSP-077; LEVEL_DESIGN §9.5). `laneKm` is the length of
 * the compiled lane graph (every directed edge, km) and `moving` = ceil(densityPerKm × laneKm), the moving
 * vehicles traffic.ts (SSP-089) aims for, drawn from `mix`. `parkedBays` counts the bays (2-tile car slots,
 * parkingBays.ts) of `lanes.bays` and `parked` = ceil(parkedBays × parkedFill), the cars parked.ts places at shift
 * start from `parkedMix` (SSP-090). `pavement`
 * vehicles (the mobility scooter) follow the nav graph instead, `count` of each at once (SSP-091). `taxiRank`
 * positions are metres; `busRoute` lists lane nodes, one per anchor; `busEveryS` is null without a bus route.
 */
export type TrafficSpawn = {
  densityPerKm: number;
  laneKm: number;
  moving: number;
  mix: WeightEntry[];
  parkedFill: number;
  parkedBays: number;
  parked: number;
  parkedMix: WeightEntry[];
  pavement: { id: string; count: number }[];
  taxiRank: PointM[];
  busRoute: number[];
  busEveryS: number | null;
};

/** The compiled power-up spec (`spawns.pickups`, SSP-077; LEVEL_DESIGN §9.6): positions in metres. */
export type PickupSpawn = { count: number; table: WeightEntry[]; at: PointM[] };

/** A hazard placed by level.json → hazards.place (metres). */
export type PlacedHazard = { id: string; x: number; y: number };

/** A random hazard: `count` of `id` on tiles whose candidate bit for `rule` is set. */
export type RandomHazard = { id: string; count: number; rule: HazardRule };

/**
 * The compiled hazard spec (`spawns.hazards`, SSP-077; LEVEL_DESIGN §9.3): the fixed placements, the random
 * requests in level.json order, and `candidates`, HAZARD_RULE bits per tile (w·h, row-major), which the
 * hazard spawner (SSP-093) samples with the `hazards` stream.
 */
export type HazardSpawn = { place: PlacedHazard[]; random: RandomHazard[]; candidates: Uint8Array };

/** A knockable prop placed by level.json → knockables (`spawns.knockables`, SSP-077), in metres. */
export type KnockableSpawn = { id: string; x: number; y: number };

/**
 * A compiled level.json event (`schedules`, SSP-077; LEVEL_DESIGN §4.3), in level.json order. `atS` lists the
 * elapsed seconds it fires at, ascending ([] for an event on a `trigger` or for the whole shift); `untilS` and
 * `trigger` are null when absent. `params` holds every other field, keys sorted, with the EVENT_ANCHOR_PARAMS
 * anchors replaced by node indices of their graph.
 */
export type ScheduledEvent = {
  type: EventType;
  atS: number[];
  untilS: number | null;
  trigger: string | null;
  params: { [key: string]: JsonValue };
};

/** Spawn kinds with a typed field on Level; `Level.spawns` may not use these names. */
export const TYPED_SPAWN_KINDS: readonly string[] = [
  'grime',
  'hazards',
  'knockables',
  'litter',
  'npc',
  'pickups',
  'traffic',
];

/** Compiled weather. `inherit` (the Depot Yard) takes the weather of the day it is played on. */
export type Weather = 'clear' | 'rain' | 'wind' | 'gusts' | 'inherit';

/**
 * Shape of the optional audio theme ids a level names (LEVEL_DESIGN §8.4, AUDIO_DESIGN): `music` is a
 * `mus.*` song and `ambience` an `amb.*` bed. Only the shape is checked until music.json/amb.json exist (M5).
 */
export const MUSIC_ID_PATTERN = /^mus\.[a-z0-9_]+$/;
export const AMBIENCE_ID_PATTERN = /^amb\.[a-z0-9_]+$/;

/** Bessie's start pose: x/y in metres, heading in radians (0 = north, clockwise). */
export type PlayerStart = { x: number; y: number; heading: number };

/** A decoded compiled level: the JSON header and lists as-is, the grid layers as typed arrays. */
export type Level = {
  id: string;
  /**
   * Display name (level.json `name`, e.g. 'Puddle Lane'; SSP-299: the HUD shows it upper-cased). Absent in a
   * level built in code (createBlankLevel), where the HUD falls back to the id.
   */
  name?: string;
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
  /**
   * Spawn lists of kinds a later milestone defines (opaque entries, keys sorted on encode). Every kind so far
   * has a typed field below, written under `spawns.<kind>` (TYPED_SPAWN_KINDS).
   */
  spawns: { [kind: string]: JsonValue[] };
  /** The litter weight field (`spawns.litter`), or null when level.json has no `litter`. */
  litter: LitterSpawn | null;
  /** The grime selection counts (`spawns.grime`), or null when level.json has no `grime`. */
  grime: GrimeSpawn | null;
  /** The NPC spawn spec (`spawns.npc`, SSP-077), or null when level.json has no `npcs`. */
  npc: NpcSpawn | null;
  /** The traffic spawn spec (`spawns.traffic`), or null without `traffic` or with `{ none: true }`. */
  traffic: TrafficSpawn | null;
  /** The power-up spec (`spawns.pickups`), or null when level.json has no `powerups`. */
  pickups: PickupSpawn | null;
  /** The hazard spec (`spawns.hazards`), or null when level.json has no `hazards`. */
  hazards: HazardSpawn | null;
  /** The knockable props (`spawns.knockables`), or null when level.json has no `knockables`. */
  knockables: KnockableSpawn[] | null;
  /** The level.json events, compiled (SSP-077). */
  schedules: ScheduledEvent[];
  weather: Weather;
  timerS: number;
  /** Level music (`mus.*`, MUSIC_ID_PATTERN); absent when the level names none (the Depot Yard, SSP-033). */
  music?: string;
  /** Ambience bed (`amb.*`, AMBIENCE_ID_PATTERN); absent when the level names none (SSP-033). */
  ambience?: string;
  player: PlayerStart;
};

const WEATHERS: readonly Weather[] = ['clear', 'rain', 'wind', 'gusts', 'inherit'];
const FACES: readonly Face[] = ['n', 'e', 's', 'w'];

/** Expected byte length of a layer for a w × h tile map. */
export function layerLength(name: LayerName, w: number, h: number): number {
  return name === 'gutter' ? w * GUTTER_CELLS_PER_TILE * (h * GUTTER_CELLS_PER_TILE) : w * h;
}

/** Length of the litter `places` and `weights` fields for a w × h tile map: (w·4)·(h·4). */
export function litterFieldLength(w: number, h: number): number {
  return w * LITTER_CELLS_PER_TILE * (h * LITTER_CELLS_PER_TILE);
}

/**
 * A level of the given size with empty layers (void ground, no autotile or markings, nothing solid), no
 * styles, empty lists, clear weather, the campaign timer and Bessie at the origin facing north. The compiler
 * fills it in; tests build worlds from it directly.
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
      markings: layer('markings'),
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
    lanes: buildLaneGraph({ nodes: [], edges: [], bays: [] }, w, h),
    nav: buildNavGraph({ nodes: [], edges: [], portals: [], doors: [], anchors: [] }, w, h),
    spawns: {},
    litter: null,
    grime: null,
    npc: null,
    traffic: null,
    pickups: null,
    hazards: null,
    knockables: null,
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
// Lane and nav graphs (SSP-076)
// ---------------------------------------------------------------------------------------------------------

/** Pattern of an anchor name (LEVEL_DESIGN §8.4: snake_case). */
const ANCHOR_NAME_PATTERN = /^[a-z0-9_]+$/;

/** Throw unless `[x, y]` is a finite position in metres inside the map (its edges included). */
function checkGraphNode(where: string, path: string, x: number, y: number, w: number, h: number): void {
  if (!Number.isFinite(x) || !Number.isFinite(y))
    throw new Error(`${where}: ${path} must be two finite numbers (metres)`);
  if (x < 0 || y < 0 || x > w * TILE_M || y > h * TILE_M)
    throw new Error(`${where}: ${path} (${x}, ${y}) lies outside the ${w * TILE_M}×${h * TILE_M} m map`);
}

/** Throw unless `node` indexes one of `count` nodes. */
function checkNodeRef(where: string, path: string, node: number, count: number): void {
  if (!Number.isInteger(node) || node < 0 || node >= count)
    throw new Error(`${where}: ${path} must be a node index 0..${count - 1} (got ${node})`);
}

/** Throw unless (from, to) pairs strictly ascend (sorted, no repeats). */
function checkEdgeOrder(
  where: string,
  path: string,
  prevFrom: number,
  prevTo: number,
  from: number,
  to: number,
) {
  if (from < prevFrom || (from === prevFrom && to <= prevTo))
    throw new Error(`${where}: ${path} must be sorted by (from, to) with no repeats`);
}

/**
 * Validate lane graph lists and build the typed LaneGraph with its CSR offsets (SSP-076). Throws, naming the
 * entry, on a node outside the map, an edge to an unknown node or to itself, unsorted or repeated edges, a
 * speed limit that is not positive, unknown flag bits, or a malformed bay. Load-time code: allocates.
 */
export function buildLaneGraph(
  lists: LaneGraphLists,
  w: number,
  h: number,
  where = 'buildLaneGraph',
): LaneGraph {
  const nodeCount = lists.nodes.length;
  const edgeCount = lists.edges.length;
  const nodeX = new Float64Array(nodeCount);
  const nodeY = new Float64Array(nodeCount);
  lists.nodes.forEach(([x, y], i) => {
    checkGraphNode(where, `lanes.nodes[${i}]`, x, y, w, h);
    nodeX[i] = x;
    nodeY[i] = y;
  });
  const edgeFrom = new Uint32Array(edgeCount);
  const edgeTo = new Uint32Array(edgeCount);
  const edgeSpeedMps = new Float64Array(edgeCount);
  const edgeFlags = new Uint16Array(edgeCount);
  const outStart = new Uint32Array(nodeCount + 1);
  let prevFrom = -1;
  let prevTo = -1;
  lists.edges.forEach(([from, to, speed, flags], i) => {
    const path = `lanes.edges[${i}]`;
    checkNodeRef(where, `${path} from`, from, nodeCount);
    checkNodeRef(where, `${path} to`, to, nodeCount);
    if (from === to) throw new Error(`${where}: ${path} joins node ${from} to itself`);
    checkEdgeOrder(where, path, prevFrom, prevTo, from, to);
    prevFrom = from;
    prevTo = to;
    if (!Number.isFinite(speed) || speed <= 0)
      throw new Error(`${where}: ${path} speed limit must be a positive number of m/s (got ${speed})`);
    if (!Number.isInteger(flags) || flags < 0 || (flags & ~LANE_FLAG_ALL_BITS) !== 0)
      throw new Error(`${where}: ${path} has unknown flag bits (${flags})`);
    edgeFrom[i] = from;
    edgeTo[i] = to;
    edgeSpeedMps[i] = speed;
    edgeFlags[i] = flags;
    outStart[from + 1] = (outStart[from + 1] ?? 0) + 1;
  });
  for (let n = 0; n < nodeCount; n += 1) outStart[n + 1] = (outStart[n + 1] ?? 0) + (outStart[n] ?? 0);
  const bays = lists.bays.map((bay, i): ParkingBay => {
    const path = `lanes.bays[${i}]`;
    const [x0, y0, x1, y1] = bay.rect;
    if (bay.rect.length !== 4 || !bay.rect.every(Number.isInteger) || x0 < 0 || y0 < 0 || x1 > w || y1 > h)
      throw new Error(`${where}: ${path}.rect must be four integer tile coordinates inside the map`);
    if (x1 <= x0 || y1 <= y0) throw new Error(`${where}: ${path}.rect must not be empty`);
    if (!Number.isFinite(bay.heading)) throw new Error(`${where}: ${path}.heading must be a finite number`);
    return { rect: [x0, y0, x1, y1], heading: bay.heading };
  });
  return { nodeCount, nodeX, nodeY, edgeCount, edgeFrom, edgeTo, edgeSpeedMps, edgeFlags, outStart, bays };
}

/**
 * Validate nav graph lists and build the typed NavGraph with its two-way CSR adjacency (SSP-076). Throws,
 * naming the entry, on a node outside the map, an edge not written from < to, unsorted or repeated edges,
 * unknown flag bits, or a portal, door or anchor that names an unknown node or is out of order.
 * Load-time code: allocates.
 */
export function buildNavGraph(lists: NavGraphLists, w: number, h: number, where = 'buildNavGraph'): NavGraph {
  const nodeCount = lists.nodes.length;
  const edgeCount = lists.edges.length;
  const nodeX = new Float64Array(nodeCount);
  const nodeY = new Float64Array(nodeCount);
  lists.nodes.forEach(([x, y], i) => {
    checkGraphNode(where, `nav.nodes[${i}]`, x, y, w, h);
    nodeX[i] = x;
    nodeY[i] = y;
  });
  const edgeFrom = new Uint32Array(edgeCount);
  const edgeTo = new Uint32Array(edgeCount);
  const edgeFlags = new Uint8Array(edgeCount);
  const adjStart = new Uint32Array(nodeCount + 1);
  let prevFrom = -1;
  let prevTo = -1;
  lists.edges.forEach(([from, to, flags], i) => {
    const path = `nav.edges[${i}]`;
    checkNodeRef(where, `${path} from`, from, nodeCount);
    checkNodeRef(where, `${path} to`, to, nodeCount);
    if (from >= to)
      throw new Error(`${where}: ${path} must be written once with from < to (got ${from}, ${to})`);
    checkEdgeOrder(where, path, prevFrom, prevTo, from, to);
    prevFrom = from;
    prevTo = to;
    if (!Number.isInteger(flags) || flags < 0 || (flags & ~NAV_FLAG_ALL_BITS) !== 0)
      throw new Error(`${where}: ${path} has unknown flag bits (${flags})`);
    edgeFrom[i] = from;
    edgeTo[i] = to;
    edgeFlags[i] = flags;
    adjStart[from + 1] = (adjStart[from + 1] ?? 0) + 1;
    adjStart[to + 1] = (adjStart[to + 1] ?? 0) + 1;
  });
  for (let n = 0; n < nodeCount; n += 1) adjStart[n + 1] = (adjStart[n + 1] ?? 0) + (adjStart[n] ?? 0);
  const adjEdge = new Uint32Array(edgeCount * 2);
  const adjNode = new Uint32Array(edgeCount * 2);
  const fill = adjStart.slice(0, nodeCount);
  for (let e = 0; e < edgeCount; e += 1) {
    const a = edgeFrom[e] ?? 0;
    const b = edgeTo[e] ?? 0;
    const ka = fill[a] ?? 0;
    adjEdge[ka] = e;
    adjNode[ka] = b;
    fill[a] = ka + 1;
    const kb = fill[b] ?? 0;
    adjEdge[kb] = e;
    adjNode[kb] = a;
    fill[b] = kb + 1;
  }
  const portals = new Uint32Array(lists.portals.length);
  lists.portals.forEach((node, i) => {
    checkNodeRef(where, `nav.portals[${i}]`, node, nodeCount);
    if (i > 0 && node <= (portals[i - 1] ?? 0))
      throw new Error(`${where}: nav.portals must ascend with no repeats`);
    portals[i] = node;
  });
  const doors = lists.doors.map((door, i): NavDoor => {
    if (typeof door.frontage !== 'string' || door.frontage.length === 0)
      throw new Error(`${where}: nav.doors[${i}].frontage must be a frontage id`);
    checkNodeRef(where, `nav.doors[${i}].node`, door.node, nodeCount);
    return { frontage: door.frontage, node: door.node };
  });
  let prevAnchor = '';
  const anchors = lists.anchors.map((anchor, i): NavAnchor => {
    const path = `nav.anchors[${i}]`;
    if (!/^[0-9]$/.test(anchor.char)) throw new Error(`${where}: ${path}.char must be one digit 0–9`);
    if (!ANCHOR_NAME_PATTERN.test(anchor.name)) throw new Error(`${where}: ${path}.name must be snake_case`);
    checkNodeRef(where, `${path}.node`, anchor.node, nodeCount);
    const key = `${anchor.char}:${String(anchor.node).padStart(10, '0')}`;
    if (i > 0 && key <= prevAnchor) throw new Error(`${where}: nav.anchors must be sorted by (char, node)`);
    prevAnchor = key;
    return { char: anchor.char, name: anchor.name, node: anchor.node };
  });
  return {
    nodeCount,
    nodeX,
    nodeY,
    edgeCount,
    edgeFrom,
    edgeTo,
    edgeFlags,
    adjStart,
    adjEdge,
    adjNode,
    portals,
    doors,
    anchors,
  };
}

/** The JSON lists of a typed lane graph (the inverse of buildLaneGraph). */
export function laneGraphLists(g: LaneGraph): LaneGraphLists {
  const nodes: [number, number][] = [];
  for (let n = 0; n < g.nodeCount; n += 1) nodes.push([g.nodeX[n] ?? 0, g.nodeY[n] ?? 0]);
  const edges: [number, number, number, number][] = [];
  for (let e = 0; e < g.edgeCount; e += 1)
    edges.push([g.edgeFrom[e] ?? 0, g.edgeTo[e] ?? 0, g.edgeSpeedMps[e] ?? 0, g.edgeFlags[e] ?? 0]);
  return { nodes, edges, bays: g.bays };
}

/** The JSON lists of a typed nav graph (the inverse of buildNavGraph). */
export function navGraphLists(g: NavGraph): NavGraphLists {
  const nodes: [number, number][] = [];
  for (let n = 0; n < g.nodeCount; n += 1) nodes.push([g.nodeX[n] ?? 0, g.nodeY[n] ?? 0]);
  const edges: [number, number, number][] = [];
  for (let e = 0; e < g.edgeCount; e += 1)
    edges.push([g.edgeFrom[e] ?? 0, g.edgeTo[e] ?? 0, g.edgeFlags[e] ?? 0]);
  return { nodes, edges, portals: [...g.portals], doors: g.doors, anchors: g.anchors };
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

/**
 * Range-check the id layers: known ground/surface ids, autotile 0..46 or 255, known marking and collide bits,
 * styles inside their tables.
 */
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
  checkLayer(
    where,
    'markings',
    layers.markings,
    w,
    (v) => (v & ~MARKING_ALL_BITS) === 0,
    'unknown marking bits',
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
  checkLayer(
    where,
    'gutter',
    layers.gutter,
    w * GUTTER_CELLS_PER_TILE,
    (v) => (v & ~GRIME_CELL_ALL_BITS) === 0 && ((v & GRIME_CELL.GUTTER) === 0 || (v & GRIME_CELL.OPEN) !== 0),
    'unknown grime cell bits or GUTTER without OPEN (the tile is a grime cell)',
  );
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

/**
 * A frontage zone's cells, checked: integer tiles inside the frontage rect, strictly row-major (so unique), and
 * at least one. Returns a copy.
 */
function zoneCells(
  where: string,
  cells: readonly (readonly [number, number])[],
  rect: TileRect,
  path: string,
): [number, number][] {
  if (cells.length === 0) throw new Error(`${where}: ${path} must list at least one tile`);
  const [x0, y0, x1, y1] = rect;
  let last = -1;
  return cells.map(([x, y], j) => {
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < x0 || y < y0 || x >= x1 || y >= y1)
      throw new Error(
        `${where}: ${path}[${j}] (${x}, ${y}) must be an integer tile inside the frontage rect`,
      );
    const order = (y - y0) * (x1 - x0) + (x - x0);
    if (order <= last) throw new Error(`${where}: ${path} must be sorted row-major with no repeats`);
    last = order;
    return [x, y];
  });
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

/** `{ [key]: id }` for a present audio id (shape-checked), `{}` for an absent one, so the key is omitted. */
/** A level's display name for encoding: a non-empty string (SSP-299). */
function displayName(name: string, key: string): string {
  if (typeof name !== 'string' || name.length === 0)
    throw new Error(`encodeLevel: ${key} must be a non-empty string`);
  return name;
}

function audioIdOut(id: string | undefined, key: string, pattern: RegExp): { [key: string]: JsonValue } {
  if (id === undefined) return {};
  if (!pattern.test(id))
    throw new Error(`encodeLevel: ${key} ${JSON.stringify(id)} does not match ${pattern}`);
  return { [key]: id };
}

function grimeOut(grime: GrimeSpawn, w: number, h: number): JsonValue {
  const { cells, gutterCells, speckle } = grime;
  const max = layerLength('gutter', w, h);
  if (!Number.isInteger(cells) || cells < 0 || cells > max)
    throw new Error(`encodeLevel: grime.cells must be an integer 0..${max} (got ${cells})`);
  if (!Number.isInteger(gutterCells) || gutterCells < 0 || gutterCells > cells)
    throw new Error(`encodeLevel: grime.gutterCells must be an integer 0..cells (got ${gutterCells})`);
  if (!(speckle >= 0 && speckle <= 1))
    throw new Error(`encodeLevel: grime.speckle must be 0..1 (got ${speckle})`);
  return { cells, gutterCells, speckle };
}

function litterOut(litter: LitterSpawn, w: number, h: number): JsonValue {
  const n = litterFieldLength(w, h);
  for (const [name, field] of [
    ['places', litter.places],
    ['weights', litter.weights],
  ] as const) {
    if (field.length !== n)
      throw new Error(`encodeLevel: litter.${name} has ${field.length} entries, expected ${n}`);
  }
  if (!Number.isInteger(litter.initial) || litter.initial < 0)
    throw new Error(`encodeLevel: litter.initial must be a non-negative integer (got ${litter.initial})`);
  if (!(litter.minSpacingM > 0) || !Number.isFinite(litter.minSpacingM))
    throw new Error(`encodeLevel: litter.minSpacingM must be a positive number (got ${litter.minSpacingM})`);
  for (let i = 0; i < n; i += 1) {
    if (((litter.places[i] ?? 0) & ~LITTER_PLACE_ALL_BITS) !== 0)
      throw new Error(`encodeLevel: litter.places[${i}] has unknown place bits`);
  }
  let previous = '';
  const table = litter.table.map((entry, i): JsonValue => {
    const path = `litter.table[${i}]`;
    if (i > 0 && !(entry.id > previous)) throw new Error(`encodeLevel: ${path} is not sorted by unique id`);
    previous = entry.id;
    if (!(entry.weight > 0) || !Number.isFinite(entry.weight))
      throw new Error(`encodeLevel: ${path}.weight must be a positive number`);
    if (!Number.isInteger(entry.requires) || (entry.requires & ~LITTER_PLACE_ALL_BITS) !== 0)
      throw new Error(`encodeLevel: ${path}.requires has unknown place bits`);
    return { id: entry.id, weight: entry.weight, requires: entry.requires };
  });
  return {
    initial: litter.initial,
    minSpacingM: litter.minSpacingM,
    table,
    places: encodeBase64(litter.places),
    weights: encodeBase64Uint16(litter.weights),
  };
}

// ---------------------------------------------------------------------------------------------------------
// M3 spawn specs and schedules (SSP-077): one semantic check shared by the encoder and the decoder
// ---------------------------------------------------------------------------------------------------------

/** What the M3 spawn checks need to know about the level: its size and graph node counts. */
type SpawnFrame = { w: number; h: number; laneNodes: number; navNodes: number };

function specFail(where: string, path: string, message: string): never {
  throw new Error(`${where}: ${path} ${message}`);
}

function checkId(where: string, path: string, id: string, prefix: string): void {
  if (typeof id !== 'string' || !new RegExp(`^${prefix}\\.[a-z0-9_]+$`).test(id))
    specFail(where, path, `must be a ${prefix}.* id (got ${JSON.stringify(id)})`);
}

function checkInt(where: string, path: string, n: number, min: number): void {
  if (!Number.isInteger(n) || n < min) specFail(where, path, `must be an integer ≥ ${min} (got ${n})`);
}

function checkSeconds(where: string, path: string, s: number): void {
  if (!Number.isFinite(s) || s < 0)
    specFail(where, path, `must be a non-negative number of seconds (got ${s})`);
}

function checkPointM(where: string, path: string, p: PointM, frame: SpawnFrame): void {
  if (p.length !== 2) specFail(where, path, 'must be [x, y] in metres');
  checkGraphNode(where, path, p[0], p[1], frame.w, frame.h);
}

/** Sorted by unique id, each id of `prefix`, each weight a positive finite number. */
function checkWeights(where: string, path: string, entries: readonly WeightEntry[], prefix: string): void {
  entries.forEach((e, i) => {
    checkId(where, `${path}[${i}].id`, e.id, prefix);
    if (i > 0 && !(e.id > (entries[i - 1]?.id ?? ''))) specFail(where, path, 'must be sorted by unique id');
    if (!Number.isFinite(e.weight) || e.weight <= 0)
      specFail(where, `${path}[${i}].weight`, `must be a positive number (got ${e.weight})`);
  });
}

function checkNpcSpawn(where: string, npc: NpcSpawn, frame: SpawnFrame): void {
  let lastTo = 0;
  npc.population.forEach((p, i) => {
    const path = `npc.population[${i}]`;
    checkSeconds(where, `${path}.fromS`, p.fromS);
    checkSeconds(where, `${path}.toS`, p.toS);
    if (p.toS <= p.fromS || p.fromS < lastTo)
      specFail(where, path, 'windows must ascend without overlapping (fromS < toS, fromS ≥ previous toS)');
    lastTo = p.toS;
    checkInt(where, `${path}.target`, p.target, 0);
  });
  checkWeights(where, 'npc.mix', npc.mix, 'npc');
  npc.caps.forEach((c, i) => {
    checkId(where, `npc.caps[${i}].id`, c.id, 'npc');
    if (i > 0 && !(c.id > (npc.caps[i - 1]?.id ?? '')))
      specFail(where, 'npc.caps', 'must be sorted by unique id');
    checkInt(where, `npc.caps[${i}].cap`, c.cap, 0);
  });
  npc.named.forEach((n, i) => {
    const path = `npc.named[${i}]`;
    checkId(where, `${path}.id`, n.id, 'npc');
    checkInt(where, `${path}.count`, n.count, 1);
    checkSeconds(where, `${path}.spawnAtS`, n.spawnAtS);
    checkNodeRef(where, `${path}.anchor`, n.anchor, frame.navNodes);
    if (n.route.length === 0) specFail(where, `${path}.route`, 'must list at least one node');
    n.route.forEach((node, j) => {
      checkNodeRef(where, `${path}.route[${j}]`, node, frame.navNodes);
    });
    if (typeof n.loop !== 'boolean') specFail(where, `${path}.loop`, 'must be a boolean');
  });
  if (npc.perches !== null) {
    const p = npc.perches;
    checkId(where, 'npc.perches.id', p.id, 'npc');
    checkInt(where, 'npc.perches.count', p.count, 1);
    const order = p.on.map((s) => PERCH_SURFACES.indexOf(s));
    if (p.on.length === 0 || order.some((o, i) => o < 0 || (i > 0 && o <= (order[i - 1] ?? -1))))
      specFail(
        where,
        'npc.perches.on',
        `must list surfaces from ${PERCH_SURFACES.join(', ')}, in that order`,
      );
    p.walls.forEach((pt, i) => {
      checkPointM(where, `npc.perches.walls[${i}]`, pt, frame);
    });
    if (p.walls.length > 0 && !p.on.includes('walls'))
      specFail(where, 'npc.perches.walls', 'must be empty unless on includes walls');
  }
  npc.flocks.forEach((f, i) => {
    const path = `npc.flocks[${i}]`;
    checkId(where, `${path}.id`, f.id, 'npc');
    checkInt(where, `${path}.count`, f.count, 1);
    if (f.size.length !== 2) specFail(where, `${path}.size`, 'must be [min, max]');
    checkInt(where, `${path}.size[0]`, f.size[0], 1);
    checkInt(where, `${path}.size[1]`, f.size[1], f.size[0]);
    if (f.points.length === 0) specFail(where, `${path}.points`, 'must list at least one point');
    f.points.forEach((pt, j) => {
      checkPointM(where, `${path}.points[${j}]`, pt, frame);
    });
  });
}

function checkTrafficSpawn(where: string, t: TrafficSpawn, frame: SpawnFrame): void {
  for (const [key, value] of [
    ['densityPerKm', t.densityPerKm],
    ['laneKm', t.laneKm],
  ] as const) {
    if (!Number.isFinite(value) || value < 0) specFail(where, `traffic.${key}`, `must be ≥ 0 (got ${value})`);
  }
  checkInt(where, 'traffic.moving', t.moving, 0);
  checkWeights(where, 'traffic.mix', t.mix, 'veh');
  if (!(t.parkedFill >= 0 && t.parkedFill <= 1))
    specFail(where, 'traffic.parkedFill', `must be 0..1 (got ${t.parkedFill})`);
  checkInt(where, 'traffic.parkedBays', t.parkedBays, 0);
  checkInt(where, 'traffic.parked', t.parked, 0);
  if (t.parked > t.parkedBays) specFail(where, 'traffic.parked', 'must not exceed parkedBays');
  checkWeights(where, 'traffic.parkedMix', t.parkedMix, 'veh');
  t.pavement.forEach((p, i) => {
    checkId(where, `traffic.pavement[${i}].id`, p.id, 'veh');
    if (i > 0 && !(p.id > (t.pavement[i - 1]?.id ?? '')))
      specFail(where, 'traffic.pavement', 'must be sorted by unique id');
    checkInt(where, `traffic.pavement[${i}].count`, p.count, 1);
  });
  t.taxiRank.forEach((pt, i) => {
    checkPointM(where, `traffic.taxiRank[${i}]`, pt, frame);
  });
  t.busRoute.forEach((node, i) => {
    checkNodeRef(where, `traffic.busRoute[${i}]`, node, frame.laneNodes);
  });
  if ((t.busRoute.length === 0) !== (t.busEveryS === null))
    specFail(where, 'traffic.busEveryS', 'must be set exactly when there is a bus route');
  if (t.busEveryS !== null && !(Number.isFinite(t.busEveryS) && t.busEveryS > 0))
    specFail(where, 'traffic.busEveryS', `must be a positive number of seconds (got ${t.busEveryS})`);
}

function checkPickupSpawn(where: string, p: PickupSpawn, frame: SpawnFrame): void {
  checkInt(where, 'pickups.count', p.count, 0);
  checkWeights(where, 'pickups.table', p.table, 'pwr');
  p.at.forEach((pt, i) => {
    checkPointM(where, `pickups.at[${i}]`, pt, frame);
  });
}

function checkHazardSpawn(where: string, hz: HazardSpawn, frame: SpawnFrame): void {
  hz.place.forEach((p, i) => {
    checkId(where, `hazards.place[${i}].id`, p.id, 'haz');
    checkPointM(where, `hazards.place[${i}]`, [p.x, p.y], frame);
  });
  hz.random.forEach((r, i) => {
    checkId(where, `hazards.random[${i}].id`, r.id, 'haz');
    checkInt(where, `hazards.random[${i}].count`, r.count, 1);
    if (!HAZARD_RULES.includes(r.rule))
      specFail(where, `hazards.random[${i}].rule`, `must be one of ${HAZARD_RULES.join(', ')}`);
  });
  if (hz.candidates.length !== frame.w * frame.h)
    specFail(
      where,
      'hazards.candidates',
      `has ${hz.candidates.length} entries, expected ${frame.w * frame.h}`,
    );
  for (let i = 0; i < hz.candidates.length; i += 1) {
    if (((hz.candidates[i] ?? 0) & ~HAZARD_RULE_ALL_BITS) !== 0)
      specFail(where, 'hazards.candidates', `has unknown rule bits at tile ${i}`);
  }
}

function checkKnockables(where: string, list: readonly KnockableSpawn[], frame: SpawnFrame): void {
  list.forEach((k, i) => {
    checkId(where, `knockables[${i}].id`, k.id, 'prop');
    checkPointM(where, `knockables[${i}]`, [k.x, k.y], frame);
  });
}

function checkSchedules(where: string, list: readonly ScheduledEvent[], frame: SpawnFrame): void {
  list.forEach((e, i) => {
    const path = `schedules[${i}]`;
    if (!EVENT_TYPES.includes(e.type))
      specFail(where, `${path}.type`, `must be one of ${EVENT_TYPES.join(', ')}`);
    e.atS.forEach((s, j) => {
      checkSeconds(where, `${path}.atS[${j}]`, s);
      if (j > 0 && s < (e.atS[j - 1] ?? 0)) specFail(where, `${path}.atS`, 'must ascend');
    });
    if (e.untilS !== null) checkSeconds(where, `${path}.untilS`, e.untilS);
    if (e.trigger !== null && (typeof e.trigger !== 'string' || e.trigger.length === 0))
      specFail(where, `${path}.trigger`, 'must be a non-empty string or null');
    for (const [param, graph] of Object.entries(EVENT_ANCHOR_PARAMS[e.type] ?? {})) {
      const value = e.params[param];
      if (value === undefined) continue;
      const count = graph === 'lane' ? frame.laneNodes : frame.navNodes;
      const nodes = Array.isArray(value) ? value : [value];
      nodes.forEach((node, j) => {
        if (typeof node !== 'number') specFail(where, `${path}.params.${param}`, 'must hold node indices');
        checkNodeRef(where, `${path}.params.${param}[${j}]`, node, count);
      });
    }
  });
}

/** Check every typed M3 spawn field and the schedules of a level (throws naming the field). */
function checkM3Spawns(where: string, level: Level): void {
  const frame: SpawnFrame = {
    w: level.size[0],
    h: level.size[1],
    laneNodes: level.lanes.nodeCount,
    navNodes: level.nav.nodeCount,
  };
  if (level.npc !== null) checkNpcSpawn(where, level.npc, frame);
  if (level.traffic !== null) checkTrafficSpawn(where, level.traffic, frame);
  if (level.pickups !== null) checkPickupSpawn(where, level.pickups, frame);
  if (level.hazards !== null) checkHazardSpawn(where, level.hazards, frame);
  if (level.knockables !== null) checkKnockables(where, level.knockables, frame);
  checkSchedules(where, level.schedules, frame);
}

const weightsOut = (list: readonly WeightEntry[]): JsonValue =>
  list.map((e) => ({ id: e.id, weight: e.weight }));
const pointsOut = (list: readonly PointM[]): JsonValue => list.map(([x, y]) => [x, y]);

function npcOut(npc: NpcSpawn): JsonValue {
  return {
    population: npc.population.map((p) => ({ fromS: p.fromS, toS: p.toS, target: p.target })),
    mix: weightsOut(npc.mix),
    caps: npc.caps.map((c) => ({ id: c.id, cap: c.cap })),
    named: npc.named.map((n) => ({
      id: n.id,
      count: n.count,
      spawnAtS: n.spawnAtS,
      anchor: n.anchor,
      route: [...n.route],
      loop: n.loop,
    })),
    perches:
      npc.perches === null
        ? null
        : {
            id: npc.perches.id,
            count: npc.perches.count,
            on: [...npc.perches.on],
            walls: pointsOut(npc.perches.walls),
          },
    flocks: npc.flocks.map((f) => ({
      id: f.id,
      count: f.count,
      size: [f.size[0], f.size[1]],
      points: pointsOut(f.points),
    })),
  };
}

function trafficOut(t: TrafficSpawn): JsonValue {
  return {
    densityPerKm: t.densityPerKm,
    laneKm: t.laneKm,
    moving: t.moving,
    mix: weightsOut(t.mix),
    parkedFill: t.parkedFill,
    parkedBays: t.parkedBays,
    parked: t.parked,
    parkedMix: weightsOut(t.parkedMix),
    pavement: t.pavement.map((p) => ({ id: p.id, count: p.count })),
    taxiRank: pointsOut(t.taxiRank),
    busRoute: [...t.busRoute],
    busEveryS: t.busEveryS,
  };
}

function scheduleOut(e: ScheduledEvent, i: number): JsonValue {
  return {
    type: e.type,
    atS: [...e.atS],
    untilS: e.untilS,
    trigger: e.trigger,
    params: canonicalJson(e.params, `schedules[${i}].params`),
  };
}

/** The `lanes` JSON (SSP-076), re-validated through buildLaneGraph so a mutated typed array cannot slip out. */
function lanesOut(g: LaneGraph, w: number, h: number): JsonValue {
  const lists = laneGraphLists(g);
  buildLaneGraph(lists, w, h, 'encodeLevel');
  return {
    nodes: lists.nodes.map(([x, y]) => [x, y]),
    edges: lists.edges.map(([from, to, speed, flags]) => [from, to, speed, flags]),
    bays: lists.bays.map((b) => ({ rect: [b.rect[0], b.rect[1], b.rect[2], b.rect[3]], heading: b.heading })),
  };
}

/** The `nav` JSON (SSP-076), re-validated through buildNavGraph. */
function navOut(g: NavGraph, w: number, h: number): JsonValue {
  const lists = navGraphLists(g);
  buildNavGraph(lists, w, h, 'encodeLevel');
  return {
    nodes: lists.nodes.map(([x, y]) => [x, y]),
    edges: lists.edges.map(([from, to, flags]) => [from, to, flags]),
    portals: [...lists.portals],
    doors: lists.doors.map((d) => ({ frontage: d.frontage, node: d.node })),
    anchors: lists.anchors.map((a) => ({ char: a.char, name: a.name, node: a.node })),
  };
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
  const spawnKinds: { [key: string]: JsonValue } = {};
  for (const kind of Object.keys(level.spawns)) {
    if (TYPED_SPAWN_KINDS.includes(kind))
      throw new Error(`encodeLevel: spawns.${kind} must be set through level.${kind}, not level.spawns`);
    spawnKinds[kind] = canonicalJson(level.spawns[kind] ?? [], `spawns.${kind}`);
  }
  if (level.grime !== null) spawnKinds.grime = grimeOut(level.grime, w, h);
  if (level.litter !== null) spawnKinds.litter = litterOut(level.litter, w, h);
  checkM3Spawns('encodeLevel', level);
  if (level.npc !== null) spawnKinds.npc = npcOut(level.npc);
  if (level.traffic !== null) spawnKinds.traffic = trafficOut(level.traffic);
  if (level.pickups !== null)
    spawnKinds.pickups = {
      count: level.pickups.count,
      table: weightsOut(level.pickups.table),
      at: pointsOut(level.pickups.at),
    };
  if (level.hazards !== null)
    spawnKinds.hazards = {
      place: level.hazards.place.map((p) => ({ id: p.id, x: p.x, y: p.y })),
      random: level.hazards.random.map((r) => ({ id: r.id, count: r.count, rule: r.rule })),
      candidates: encodeBase64(level.hazards.candidates),
    };
  if (level.knockables !== null)
    spawnKinds.knockables = level.knockables.map((k) => ({ id: k.id, x: k.x, y: k.y }));
  const spawns: { [key: string]: JsonValue } = {};
  for (const kind of Object.keys(spawnKinds).sort()) spawns[kind] = spawnKinds[kind] ?? null;
  const doc: JsonValue = {
    format: LEVEL_FORMAT,
    version: LEVEL_VERSION,
    id: level.id,
    ...(level.name === undefined ? {} : { name: displayName(level.name, 'name') }),
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
    frontages: level.frontages.map((f, i) => {
      const rect = rectOut(f.rect, `frontages[${i}].rect`);
      return {
        id: f.id,
        pledge: f.pledge,
        rect,
        face: f.face,
        cells: zoneCells('encodeLevel', f.cells, rect, `frontages[${i}].cells`),
      };
    }),
    lanes: lanesOut(level.lanes, w, h),
    nav: navOut(level.nav, w, h),
    spawns,
    schedules: level.schedules.map(scheduleOut),
    weather: level.weather,
    timerS: finite(level.timerS, 'timerS'),
    ...audioIdOut(level.music, 'music', MUSIC_ID_PATTERN),
    ...audioIdOut(level.ambience, 'ambience', AMBIENCE_ID_PATTERN),
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

/** A level's display name: a non-empty string (SSP-299). */
function nameIn(value: unknown, path: string): string {
  const name = str(value, path);
  if (name.length === 0) fail(path, 'must be a non-empty string');
  return name;
}

function audioIdIn(value: unknown, path: string, pattern: RegExp): string {
  const id = str(value, path);
  if (!pattern.test(id)) fail(path, `must match ${pattern} (got ${JSON.stringify(id)})`);
  return id;
}

function grimeIn(value: unknown, w: number, h: number): GrimeSpawn {
  const g = obj(value, 'spawns.grime');
  const cells = int(g.cells, 'spawns.grime.cells');
  const max = layerLength('gutter', w, h);
  if (cells < 0 || cells > max) fail('spawns.grime.cells', `must be 0..${max} (got ${cells})`);
  const gutterCells = int(g.gutterCells, 'spawns.grime.gutterCells');
  if (gutterCells < 0 || gutterCells > cells)
    fail('spawns.grime.gutterCells', `must be 0..cells (got ${gutterCells})`);
  const speckle = num(g.speckle, 'spawns.grime.speckle');
  if (speckle < 0 || speckle > 1) fail('spawns.grime.speckle', `must be 0..1 (got ${speckle})`);
  return { cells, gutterCells, speckle };
}

function litterIn(value: unknown, w: number, h: number): LitterSpawn {
  const l = obj(value, 'spawns.litter');
  const initial = int(l.initial, 'spawns.litter.initial');
  if (initial < 0) fail('spawns.litter.initial', 'must not be negative');
  const minSpacingM = num(l.minSpacingM, 'spawns.litter.minSpacingM');
  if (minSpacingM <= 0) fail('spawns.litter.minSpacingM', 'must be positive');
  let previous = '';
  const table = arr(l.table, 'spawns.litter.table').map((v, i): LitterTableEntry => {
    const path = `spawns.litter.table[${i}]`;
    const e = obj(v, path);
    const id = str(e.id, `${path}.id`);
    if (i > 0 && !(id > previous)) fail(`${path}.id`, 'must be sorted and unique');
    previous = id;
    const weight = num(e.weight, `${path}.weight`);
    if (weight <= 0) fail(`${path}.weight`, 'must be positive');
    const requires = int(e.requires, `${path}.requires`);
    if (requires < 0 || (requires & ~LITTER_PLACE_ALL_BITS) !== 0)
      fail(`${path}.requires`, 'has unknown place bits');
    return { id, weight, requires };
  });
  const n = litterFieldLength(w, h);
  let places: Uint8Array;
  let weights: Uint16Array;
  try {
    places = decodeBase64(str(l.places, 'spawns.litter.places'));
    weights = decodeBase64Uint16(str(l.weights, 'spawns.litter.weights'));
  } catch (error) {
    throw new Error(`decodeLevel: spawns.litter: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (places.length !== n) fail('spawns.litter.places', `has ${places.length} entries, expected ${n}`);
  if (weights.length !== n) fail('spawns.litter.weights', `has ${weights.length} entries, expected ${n}`);
  for (let i = 0; i < n; i += 1) {
    if (((places[i] ?? 0) & ~LITTER_PLACE_ALL_BITS) !== 0)
      fail('spawns.litter.places', `has unknown place bits at sub-cell ${i}`);
  }
  return { initial, minSpacingM, table, places, weights };
}

function weightsIn(value: unknown, path: string): WeightEntry[] {
  return arr(value, path).map((v, i) => {
    const e = obj(v, `${path}[${i}]`);
    return { id: str(e.id, `${path}[${i}].id`), weight: num(e.weight, `${path}[${i}].weight`) };
  });
}

function pointsIn(value: unknown, path: string): PointM[] {
  return arr(value, path).map((v, i) => xyIn(v, `${path}[${i}]`));
}

function nullable<T>(value: unknown, read: (v: unknown) => T): T | null {
  return value === null ? null : read(value);
}

function npcIn(value: unknown): NpcSpawn {
  const n = obj(value, 'spawns.npc');
  return {
    population: arr(n.population, 'spawns.npc.population').map((v, i) => {
      const p = obj(v, `spawns.npc.population[${i}]`);
      const path = `spawns.npc.population[${i}]`;
      return {
        fromS: num(p.fromS, `${path}.fromS`),
        toS: num(p.toS, `${path}.toS`),
        target: int(p.target, `${path}.target`),
      };
    }),
    mix: weightsIn(n.mix, 'spawns.npc.mix'),
    caps: arr(n.caps, 'spawns.npc.caps').map((v, i) => {
      const c = obj(v, `spawns.npc.caps[${i}]`);
      return { id: str(c.id, `spawns.npc.caps[${i}].id`), cap: int(c.cap, `spawns.npc.caps[${i}].cap`) };
    }),
    named: arr(n.named, 'spawns.npc.named').map((v, i): NamedNpc => {
      const path = `spawns.npc.named[${i}]`;
      const e = obj(v, path);
      return {
        id: str(e.id, `${path}.id`),
        count: int(e.count, `${path}.count`),
        spawnAtS: num(e.spawnAtS, `${path}.spawnAtS`),
        anchor: int(e.anchor, `${path}.anchor`),
        route: arr(e.route, `${path}.route`).map((r, j) => int(r, `${path}.route[${j}]`)),
        loop: bool(e.loop, `${path}.loop`),
      };
    }),
    perches: nullable(n.perches, (v): NpcPerches => {
      const p = obj(v, 'spawns.npc.perches');
      return {
        id: str(p.id, 'spawns.npc.perches.id'),
        count: int(p.count, 'spawns.npc.perches.count'),
        on: arr(p.on, 'spawns.npc.perches.on').map((s, i) =>
          oneOf(s, PERCH_SURFACES, `spawns.npc.perches.on[${i}]`),
        ),
        walls: pointsIn(p.walls, 'spawns.npc.perches.walls'),
      };
    }),
    flocks: arr(n.flocks, 'spawns.npc.flocks').map((v, i): NpcFlock => {
      const path = `spawns.npc.flocks[${i}]`;
      const f = obj(v, path);
      const [min = 0, max = 0] = tuple(f.size, 2, `${path}.size`, int);
      return {
        id: str(f.id, `${path}.id`),
        count: int(f.count, `${path}.count`),
        size: [min, max],
        points: pointsIn(f.points, `${path}.points`),
      };
    }),
  };
}

function trafficIn(value: unknown): TrafficSpawn {
  const t = obj(value, 'spawns.traffic');
  const p = 'spawns.traffic';
  return {
    densityPerKm: num(t.densityPerKm, `${p}.densityPerKm`),
    laneKm: num(t.laneKm, `${p}.laneKm`),
    moving: int(t.moving, `${p}.moving`),
    mix: weightsIn(t.mix, `${p}.mix`),
    parkedFill: num(t.parkedFill, `${p}.parkedFill`),
    parkedBays: int(t.parkedBays, `${p}.parkedBays`),
    parked: int(t.parked, `${p}.parked`),
    parkedMix: weightsIn(t.parkedMix, `${p}.parkedMix`),
    pavement: arr(t.pavement, `${p}.pavement`).map((v, i) => {
      const e = obj(v, `${p}.pavement[${i}]`);
      return { id: str(e.id, `${p}.pavement[${i}].id`), count: int(e.count, `${p}.pavement[${i}].count`) };
    }),
    taxiRank: pointsIn(t.taxiRank, `${p}.taxiRank`),
    busRoute: arr(t.busRoute, `${p}.busRoute`).map((v, i) => int(v, `${p}.busRoute[${i}]`)),
    busEveryS: nullable(t.busEveryS, (v) => num(v, `${p}.busEveryS`)),
  };
}

function pickupsIn(value: unknown): PickupSpawn {
  const p = obj(value, 'spawns.pickups');
  return {
    count: int(p.count, 'spawns.pickups.count'),
    table: weightsIn(p.table, 'spawns.pickups.table'),
    at: pointsIn(p.at, 'spawns.pickups.at'),
  };
}

function hazardsIn(value: unknown): HazardSpawn {
  const hz = obj(value, 'spawns.hazards');
  let candidates: Uint8Array;
  try {
    candidates = decodeBase64(str(hz.candidates, 'spawns.hazards.candidates'));
  } catch (error) {
    throw new Error(`decodeLevel: spawns.hazards: ${error instanceof Error ? error.message : String(error)}`);
  }
  return {
    place: arr(hz.place, 'spawns.hazards.place').map((v, i) => {
      const e = obj(v, `spawns.hazards.place[${i}]`);
      const path = `spawns.hazards.place[${i}]`;
      return { id: str(e.id, `${path}.id`), x: num(e.x, `${path}.x`), y: num(e.y, `${path}.y`) };
    }),
    random: arr(hz.random, 'spawns.hazards.random').map((v, i) => {
      const e = obj(v, `spawns.hazards.random[${i}]`);
      const path = `spawns.hazards.random[${i}]`;
      return {
        id: str(e.id, `${path}.id`),
        count: int(e.count, `${path}.count`),
        rule: oneOf(e.rule, HAZARD_RULES, `${path}.rule`),
      };
    }),
    candidates,
  };
}

function knockablesIn(value: unknown): KnockableSpawn[] {
  return arr(value, 'spawns.knockables').map((v, i) => {
    const path = `spawns.knockables[${i}]`;
    const e = obj(v, path);
    return { id: str(e.id, `${path}.id`), x: num(e.x, `${path}.x`), y: num(e.y, `${path}.y`) };
  });
}

function scheduleIn(value: unknown, i: number): ScheduledEvent {
  const path = `schedules[${i}]`;
  const e = obj(value, path);
  const params = jsonIn(obj(e.params, `${path}.params`), `${path}.params`);
  return {
    type: oneOf(e.type, EVENT_TYPES, `${path}.type`),
    atS: arr(e.atS, `${path}.atS`).map((v, j) => num(v, `${path}.atS[${j}]`)),
    untilS: nullable(e.untilS, (v) => num(v, `${path}.untilS`)),
    trigger: nullable(e.trigger, (v) => str(v, `${path}.trigger`)),
    params: isObject(params) ? params : {},
  };
}

/** Decode `lanes` (SSP-076) into the typed LaneGraph (buildLaneGraph checks the references and order). */
function lanesIn(value: unknown, w: number, h: number): LaneGraph {
  const lanes = obj(value, 'lanes');
  const lists: LaneGraphLists = {
    nodes: arr(lanes.nodes, 'lanes.nodes').map((n, i) => xyIn(n, `lanes.nodes[${i}]`)),
    edges: arr(lanes.edges, 'lanes.edges').map((e, i): [number, number, number, number] => {
      const [from = 0, to = 0, speedLimit = 0, flags = 0] = tuple(e, 4, `lanes.edges[${i}]`, num);
      return [from, to, speedLimit, flags];
    }),
    bays: arr(lanes.bays, 'lanes.bays').map((v, i): ParkingBay => {
      const b = obj(v, `lanes.bays[${i}]`);
      return {
        rect: rectIn(b.rect, `lanes.bays[${i}].rect`),
        heading: num(b.heading, `lanes.bays[${i}].heading`),
      };
    }),
  };
  return buildLaneGraph(lists, w, h, 'decodeLevel');
}

/** Decode `nav` (SSP-076) into the typed NavGraph (buildNavGraph checks the references and order). */
function navIn(value: unknown, w: number, h: number): NavGraph {
  const nav = obj(value, 'nav');
  const lists: NavGraphLists = {
    nodes: arr(nav.nodes, 'nav.nodes').map((n, i) => xyIn(n, `nav.nodes[${i}]`)),
    edges: arr(nav.edges, 'nav.edges').map((e, i): [number, number, number] => {
      const [from = 0, to = 0, flags = 0] = tuple(e, 3, `nav.edges[${i}]`, num);
      return [from, to, flags];
    }),
    portals: arr(nav.portals, 'nav.portals').map((v, i) => int(v, `nav.portals[${i}]`)),
    doors: arr(nav.doors, 'nav.doors').map((v, i): NavDoor => {
      const d = obj(v, `nav.doors[${i}]`);
      return {
        frontage: str(d.frontage, `nav.doors[${i}].frontage`),
        node: int(d.node, `nav.doors[${i}].node`),
      };
    }),
    anchors: arr(nav.anchors, 'nav.anchors').map((v, i): NavAnchor => {
      const a = obj(v, `nav.anchors[${i}]`);
      return {
        char: str(a.char, `nav.anchors[${i}].char`),
        name: str(a.name, `nav.anchors[${i}].name`),
        node: int(a.node, `nav.anchors[${i}].node`),
      };
    }),
  };
  return buildNavGraph(lists, w, h, 'decodeLevel');
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
    markings: layer('markings'),
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

  const spawnSrc = obj(root.spawns, 'spawns');
  const spawns: { [kind: string]: JsonValue[] } = {};
  for (const kind of Object.keys(spawnSrc)) {
    if (TYPED_SPAWN_KINDS.includes(kind)) continue;
    spawns[kind] = arr(spawnSrc[kind], `spawns.${kind}`).map((v, i) => jsonIn(v, `spawns.${kind}[${i}]`));
  }
  const grime = spawnSrc.grime === undefined ? null : grimeIn(spawnSrc.grime, w, h);
  const litter = spawnSrc.litter === undefined ? null : litterIn(spawnSrc.litter, w, h);
  const optional = <T>(kind: string, read: (v: unknown) => T): T | null =>
    spawnSrc[kind] === undefined ? null : read(spawnSrc[kind]);
  const player = obj(root.player, 'player');
  const audio: { music?: string; ambience?: string } = {};
  if (root.music !== undefined) audio.music = audioIdIn(root.music, 'music', MUSIC_ID_PATTERN);
  if (root.ambience !== undefined) audio.ambience = audioIdIn(root.ambience, 'ambience', AMBIENCE_ID_PATTERN);

  const level: Level = {
    id,
    ...(root.name === undefined ? {} : { name: nameIn(root.name, 'name') }),
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
      const rect = rectIn(f.rect, `frontages[${i}].rect`);
      const cells = arr(f.cells, `frontages[${i}].cells`).map((c, j): [number, number] => {
        const [x = 0, y = 0] = tuple(c, 2, `frontages[${i}].cells[${j}]`, int);
        return [x, y];
      });
      return {
        id: str(f.id, `frontages[${i}].id`),
        pledge: bool(f.pledge, `frontages[${i}].pledge`),
        rect,
        face: oneOf(f.face, FACES, `frontages[${i}].face`),
        cells: zoneCells('decodeLevel', cells, rect, `frontages[${i}].cells`),
      };
    }),
    lanes: lanesIn(root.lanes, w, h),
    nav: navIn(root.nav, w, h),
    spawns,
    litter,
    grime,
    npc: optional('npc', npcIn),
    traffic: optional('traffic', trafficIn),
    pickups: optional('pickups', pickupsIn),
    hazards: optional('hazards', hazardsIn),
    knockables: optional('knockables', knockablesIn),
    schedules: arr(root.schedules, 'schedules').map(scheduleIn),
    weather: oneOf(root.weather, WEATHERS, 'weather'),
    timerS: num(root.timerS, 'timerS'),
    ...audio,
    player: {
      x: num(player.x, 'player.x'),
      y: num(player.y, 'player.y'),
      heading: num(player.heading, 'player.heading'),
    },
  };
  checkM3Spawns('decodeLevel', level);
  return level;
}
