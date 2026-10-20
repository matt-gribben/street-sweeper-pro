// The items instance batch of a shift (TECHNICAL_DESIGN §12.5, §12.7 draw #5; ART_BIBLE §7.1, §10.2; SSP-067):
// every visible litter item, the stains, the power-up pickups (SSP-096) and the level's static flat markers
// (hydrants, skips, depot bays) as ONE instanced draw of the `items` atlas, which also samples the `world` atlas
// for the stain decals.
//
// Frames, all from the typed FRAME table:
//   litter   `litter.<name>:idle:<dir>:0`, dir = h00 | h08 | h16 | h24 from the store's `rot` 0..3 (a frame
//            choice: the quad is never rotated, so the 1 px outline stays on the art's light side). While the
//            item is IN_SUCTION it wobbles instead: `litter.<name>:wobble:<dir>:0|1`, 12 ticks per frame on the
//            World tick (ART_BIBLE §10.2; wind and gusts join in M6). Drawn at its interpolated position
//            (prevX/prevY → x/y by the render alpha); a flung item draws at its arc position, still flat at
//            y = 0. Depth layer 3.
//   stains   `stain.<kind>:v:-:n` from the `world` atlas through the batch's secondary-atlas selector (the issue's
//            open question, decided in SSP-067: one draw, no new atlas, no city-mesh rebuild when a stain is
//            cleaned). The variant n is a stateless hash of the stain's position in 1/16 m texels (cellHash,
//            salt VariantSalt.Stain), a presentation choice the sim does not hold (stains.ts). Depth layer 2.
//   pickups  `pwr.<name>:bob:-:0|1` (SSP-096), the 2-frame bob at 24 ticks per frame on the World tick (ART_BIBLE
//            §10.2: 400 ms), the same phase for every pickup; each frame carries its own 1 px ground halo ring
//            (16 under the icon at rest, 07 under the raised icon, §8.5), so the halo alternates with the bob.
//            Centred on the pickup (pivot (8, 8)); pickups never move, so there is no interpolation. Depth layer
//            3, after the litter so a pickup reads over an item lying on the same spot.
//   hazards  (SSP-103) every hazard decal `haz.<kind>:v:-:n` from the `world` atlas, centred on its footprint, on
//            the decal layer 2 like the stains: the variant n is a stateless hash of its tile (cellHash, salt
//            VariantSalt.Hazard); haz.broken_glass instead cycles its two glint frames v 0, 1 every
//            GLASS_GLINT_TICKS_PER_FRAME World ticks (ART_BIBLE §8.7, SSP-101: one decal, two glints). The map's
//            speed bumps are skipped: the ground layer draws a `haz.speed_bump` site's tiles across the road
//            (groundLayer.ts), so only a bump placed off a site would draw here.
//   knock-   (SSP-103) every knockable (bodies.ts) at its interpolated pose, its heading drawn as the nearest quarter
//   ables    turn (a quad rotation is pixel-exact; a spinning bin turns in 90° steps): the flats
//            (`prop.shopping_trolley`, `prop.recycling_box`: `flat:-:0`) on layer 3 and the stacks (`prop.wheelie_bin`,
//            `prop.traffic_cone`, `prop.a_board`: spriteStack.ts KNOCKABLE stacks, 4 slices) at their slice heights.
//            They stand up off the ground, so they are flagged SpriteFlag.Upright: masked like actors, never
//            darkened by a shadow (their own included). Their drop shadows (the flat's frame, or the lowest and
//            highest slices at their heights, ART_BIBLE §6.4) go into the shift's drop-shadow batch when one is
//            passed.
//   markers  from the compiled level, built once: `prop.hydrant:flat:-:0` at each `prop.hydrant` prop (its rot in
//            quarter turns), `site.skip:flat:-:0` (layer 3) and `site.depot_bay:flat:-:0` (the bay markings,
//            layer 2) centred on their site rect, quarter-turned when the rect is the frame's footprint turned
//            on its side. A site rect that fits neither way is a build-time error.
//
// Culling: the litter is found by querying the LitterField's 4 m spatial hash (queryLitterView, read-only) with
// the camera's ground rect plus ITEMS_CULL_MARGIN_M (4 m); stains (at most 256, no hash: stains.ts), the pickups
// (at most 16) and the few markers are tested against the same rect. Only visible instances are written; the instance buffer is sized to
// capacity once and published with one needsUpdate per frame.
//
// Shadows: the batch is made with `receiveShadows`, so its texels keep the shadow mask under them: building and
// drop shadows (drawn before it: render order 4, after Bessie's shadow 2) fall across litter, stains and bays as
// across the ground they lie on.
//
// Render-only: reads the World's views and never writes them. update() creates no objects, arrays or closures:
// frame IDs come from tables built at load, the hit list and the cull rect are preallocated (the per-frame region
// is scanned for `new` and literals and heap-measured in tests/unit/itemsBatch.test.ts).
import { FRAME, type FrameId } from '../gen/assets.ts';
import type { BodyStoreView } from '../sim/bodies.ts';
import { BODY_CAPACITY } from '../sim/bodies.ts';
import type { Aabb } from '../sim/collision/obb.ts';
import { PX_PER_M, TILE_M } from '../sim/constants.ts';
import { HAZARD_ENTITY_IDS, KNOCKABLE_IDS, LITTER_IDS, POWERUP_IDS, STAIN_IDS } from '../sim/entities.ts';
import { HAZARD_CAPACITY, type HazardStoreView } from '../sim/hazards.ts';
import {
  LITTER_CAPACITY,
  LITTER_ROTATIONS,
  type LitterFieldView,
  LitterFlag,
  queryLitterView,
} from '../sim/litter.ts';
import type { Level, LevelSite } from '../sim/map.ts';
import { PICKUP_CAPACITY, type PickupsView } from '../sim/pickups.ts';
import { STAIN_CAPACITY, type StainStoreView } from '../sim/stains.ts';
import { HYDRANT_PROP_ID } from '../sim/water.ts';
import { cellHash, VariantSalt } from './cityMesh.ts';
import type { SpriteAtlas } from './spriteAtlas.ts';
import { type DropShadowBatch, SpriteBatch, SpriteFlag } from './spriteBatch.ts';
import {
  A_BOARD_STACK,
  type SpriteStack,
  STACK_LAYER,
  TRAFFIC_CONE_STACK,
  WHEELIE_BIN_STACK,
} from './spriteStack.ts';
import { worldFrameVariants } from './worldFrames.ts';
import { DepthLayer } from './worldMaterial.ts';

/** Margin around the camera's ground rect inside which items are drawn (TECHNICAL_DESIGN §12.5). */
export const ITEMS_CULL_MARGIN_M = 4;

/** Ticks per wobble frame while an item is in the suction zone (ART_BIBLE §10.2: 200 ms). */
export const WOBBLE_TICKS_PER_FRAME = 12;

/** Ticks per bob frame of a pickup (ART_BIBLE §10.2: 400 ms). */
export const PICKUP_BOB_TICKS_PER_FRAME = 24;

/** Every power-up's two bob frames: POWERUP_FRAMES[kind][n], kind the POWERUP_IDS index, n 0 or 1. */
export const POWERUP_FRAMES = POWERUP_IDS.map(
  (id) => [`${id}:bob:-:0`, `${id}:bob:-:1`] as const,
) satisfies readonly (readonly FrameId[])[];

/** The bob frame (0: icon down, ring 16; 1: icon up, ring 07) every pickup shows at World tick `tick`. */
export function pickupBob(tick: number): number {
  return Math.floor(tick / PICKUP_BOB_TICKS_PER_FRAME) & 1;
}

/** The frame of a pickup of kind `kind` (POWERUP_IDS index) at World tick `tick`. */
export function pickupFrame(kind: number, tick: number): FrameId {
  const frame = POWERUP_FRAMES[kind]?.[pickupBob(tick)];
  if (frame === undefined) return rejectPowerUpKind(kind);
  return frame;
}

/** Render order of the items draw: after the city (0), building shadows (1), Bessie's shadow (2) and sprites (3). */
export const ITEMS_RENDER_ORDER = 4;

/** The direction ID each litter `rot` 0..3 draws (LEVEL_DESIGN §9.1: code rotations of 0°, 90°, 180°, 270°). */
export const LITTER_ROT_DIRS = ['h00', 'h08', 'h16', 'h24'] as const;

/** Which of a litter item's three frames is drawn: idle, or wobble frame 0 or 1. */
export const LitterAnim = { Idle: 0, Wobble0: 1, Wobble1: 2 } as const;
export type LitterAnim = (typeof LitterAnim)[keyof typeof LitterAnim];

/**
 * Every litter frame the batch draws: LITTER_FRAMES[kind][rot][anim], kind the LITTER_IDS index, rot 0..3 and
 * anim a LitterAnim. Typed against FrameId, so a missing sprite is a compile error.
 */
export const LITTER_FRAMES = LITTER_IDS.map((id) =>
  LITTER_ROT_DIRS.map(
    (dir) => [`${id}:idle:${dir}:0`, `${id}:wobble:${dir}:0`, `${id}:wobble:${dir}:1`] as const,
  ),
) satisfies readonly (readonly (readonly FrameId[])[])[];

/** World ticks per glint frame of haz.broken_glass (chosen in SSP-103: the pickups' 400 ms). */
export const GLASS_GLINT_TICKS_PER_FRAME = 24;

/** Every hazard kind's decal frames: HAZARD_FRAMES[kind][n], kind the HAZARD_ENTITY_IDS index (`world` atlas). */
export const HAZARD_FRAMES: readonly (readonly FrameId[])[] = HAZARD_ENTITY_IDS.map((id) =>
  worldFrameVariants(id, 'v'),
);

const GLASS_KIND = HAZARD_ENTITY_IDS.indexOf('haz.broken_glass');
const BUMP_KIND = HAZARD_ENTITY_IDS.indexOf('haz.speed_bump');

/**
 * The decal frame of a hazard of kind `kind` (HAZARD_ENTITY_IDS index) whose footprint starts at tile (col, row),
 * at World tick `tick`: haz.broken_glass cycles its glint frames, every other kind shows its tile's hashed variant.
 */
export function hazardFrame(kind: number, col: number, row: number, tick: number): FrameId {
  const variants = HAZARD_FRAMES[kind];
  if (variants === undefined) return rejectHazardKind(kind);
  if (kind === GLASS_KIND) return variants[Math.floor(tick / GLASS_GLINT_TICKS_PER_FRAME) & 1] as FrameId;
  return variants[cellHash(col | 0, row | 0, VariantSalt.Hazard) % variants.length] as FrameId;
}

/** How a knockable is drawn: one flat frame, or a sprite stack. */
export type KnockableLook = { readonly flat: FrameId | null; readonly stack: SpriteStack | null };

/** The look of each knockable (ART_BIBLE §8.6: SSP-101 placeholders). */
const KNOCKABLE_LOOK_BY_ID: { readonly [K in (typeof KNOCKABLE_IDS)[number]]: KnockableLook } = {
  'prop.wheelie_bin': { flat: null, stack: WHEELIE_BIN_STACK },
  'prop.traffic_cone': { flat: null, stack: TRAFFIC_CONE_STACK },
  'prop.a_board': { flat: null, stack: A_BOARD_STACK },
  'prop.shopping_trolley': { flat: 'prop.shopping_trolley:flat:-:0', stack: null },
  'prop.recycling_box': { flat: 'prop.recycling_box:flat:-:0', stack: null },
};

/** Every knockable's look, by KNOCKABLE_IDS index (ART_BIBLE §8.6: SSP-101 placeholders). */
export const KNOCKABLE_LOOKS: readonly KnockableLook[] = KNOCKABLE_IDS.map((id) => KNOCKABLE_LOOK_BY_ID[id]);

/** The most slices any knockable stack has (its instance budget per body). */
export const KNOCKABLE_MAX_SLICES = Math.max(1, ...KNOCKABLE_LOOKS.map((l) => l.stack?.slices.length ?? 1));

/** Slice heights per knockable kind (typed, so no height crosses a call as a fresh double). */
const KNOCKABLE_SLICE_HEIGHTS = KNOCKABLE_LOOKS.map((l) =>
  Float64Array.from(l.stack?.slices ?? [], (slice) => slice.heightM),
);

/** The quarter turns 0..3 nearest to a heading of `rad` radians (clockwise from north). */
export function knockableQuarterTurns(rad: number): number {
  return ((Math.round(rad / (Math.PI / 2)) % 4) + 4) % 4;
}

/** Every stain kind's variant frames: STAIN_FRAMES[kind][n], kind the STAIN_IDS index (`world` atlas). */
export const STAIN_FRAMES: readonly (readonly FrameId[])[] = STAIN_IDS.map((id) =>
  worldFrameVariants(id, 'v'),
);

/** The hydrant's flat placeholder frame (ART_BIBLE §8; SSP-052). */
export const HYDRANT_FRAME = 'prop.hydrant:flat:-:0' satisfies FrameId;

/** The flat frame and depth layer of each site that draws a marker; every other site is ground (§9.1). */
export const SITE_MARKERS = {
  'site.depot_bay': { frame: 'site.depot_bay:flat:-:0', layer: DepthLayer.Decal },
  'site.skip': { frame: 'site.skip:flat:-:0', layer: DepthLayer.Litter },
} as const satisfies Record<string, { frame: FrameId; layer: DepthLayer }>;

/**
 * The animation frame of a litter item with LitterFlag bits `flags` at World tick `tick`: wobble frames 0 and 1
 * alternating every WOBBLE_TICKS_PER_FRAME ticks while it is IN_SUCTION, idle otherwise.
 */
export function litterAnim(flags: number, tick: number): LitterAnim {
  if ((flags & LitterFlag.InSuction) === 0) return LitterAnim.Idle;
  return (Math.floor(tick / WOBBLE_TICKS_PER_FRAME) & 1) === 0 ? LitterAnim.Wobble0 : LitterAnim.Wobble1;
}

/** The frame of a litter item of kind `kind` (LITTER_IDS index) and rotation `rot` 0..3, at tick `tick`. */
export function litterFrame(kind: number, rot: number, flags: number, tick: number): FrameId {
  const frame = LITTER_FRAMES[kind]?.[rot & 3]?.[litterAnim(flags, tick)];
  if (frame === undefined) return rejectLitterKind(kind);
  return frame;
}

/** The variant frame of a stain of kind `kind` (STAIN_IDS index) at (xM, yM): a hash of its 1/16 m texel. */
export function stainFrame(kind: number, xM: number, yM: number): FrameId {
  return stainTexelFrame(kind, Math.floor(xM * PX_PER_M) | 0, Math.floor(yM * PX_PER_M) | 0);
}

/** stainFrame of stain `i` of a store: the texel is computed here, so no metre double crosses a call. */
function stainFrameOf(stains: StainStoreView, i: number): FrameId {
  const tx = Math.floor((stains.x[i] as number) * PX_PER_M) | 0;
  const ty = Math.floor((stains.y[i] as number) * PX_PER_M) | 0;
  return stainTexelFrame(stains.kind[i] as number, tx, ty);
}

/** The variant frame of a stain of kind `kind` whose position falls in 1/16 m texel (tx, ty). */
function stainTexelFrame(kind: number, tx: number, ty: number): FrameId {
  const variants = STAIN_FRAMES[kind];
  if (variants === undefined) return rejectStainKind(kind);
  return variants[cellHash(tx, ty, VariantSalt.Stain) % variants.length] as FrameId;
}

/** A static marker as built from the level: frame, centre in sim metres, depth layer and quarter turns. */
export type ItemMarker = {
  readonly frame: FrameId;
  readonly xM: number;
  readonly yM: number;
  readonly layer: DepthLayer;
  readonly quarterTurns: number;
};

/** Quarter turns 0..3 nearest to `rad` radians (clockwise from north). */
function quarterTurnsOf(rad: number): number {
  return ((Math.round(rad / (Math.PI / 2)) % 4) + 4) % 4;
}

/** A site's marker centred on its tile rect, turned a quarter when the rect is the footprint on its side. */
function siteMarker(site: LevelSite, frame: FrameId, layer: DepthLayer): ItemMarker {
  const [x0, y0, x1, y1] = site.rect;
  const wPx = (x1 - x0) * TILE_M * PX_PER_M;
  const hPx = (y1 - y0) * TILE_M * PX_PER_M;
  const f = FRAME[frame];
  let quarterTurns: number;
  if (wPx === f.w && hPx === f.h) quarterTurns = 0;
  else if (wPx === f.h && hPx === f.w) quarterTurns = 1;
  else {
    throw new Error(
      `${site.id} at [${site.rect.join(', ')}] is ${wPx}×${hPx} px, but ${frame} is ${f.w}×${f.h} px`,
    );
  }
  return { frame, xM: ((x0 + x1) * TILE_M) / 2, yM: ((y0 + y1) * TILE_M) / 2, layer, quarterTurns };
}

/** The level's static flat markers, in level order: hydrants (props) first, then the skip and bay sites. */
export function levelItemMarkers(level: Level): ItemMarker[] {
  const markers: ItemMarker[] = [];
  for (const prop of level.props) {
    if (prop.id !== HYDRANT_PROP_ID) continue;
    markers.push({
      frame: HYDRANT_FRAME,
      xM: prop.x,
      yM: prop.y,
      layer: DepthLayer.Litter,
      quarterTurns: quarterTurnsOf(prop.rot),
    });
  }
  for (const site of level.sites) {
    if (!Object.hasOwn(SITE_MARKERS, site.id)) continue;
    const spec = SITE_MARKERS[site.id as keyof typeof SITE_MARKERS];
    markers.push(siteMarker(site, spec.frame, spec.layer));
  }
  return markers;
}

/** Construction sizes (default: the game's store capacities). */
export type ItemsBatchOptions = {
  readonly litterCapacity?: number;
  readonly stainCapacity?: number;
  readonly pickupCapacity?: number;
  readonly hazardCapacity?: number;
  readonly bodyCapacity?: number;
};

/** Drop shadows the items batch may add per frame for `bodyCapacity` knockables (two per stack, one per flat). */
export function itemsShadowCapacity(bodyCapacity = BODY_CAPACITY): number {
  return bodyCapacity * 2;
}

/** The shift's items draw. Add `mesh` to the world pass and call update() once per rendered frame. */
export class ItemsBatch {
  readonly batch: SpriteBatch;
  readonly markers: readonly ItemMarker[];
  /** Instances written by the last update(), per kind. */
  litterDrawn = 0;
  stainsDrawn = 0;
  markersDrawn = 0;
  pickupsDrawn = 0;
  hazardsDrawn = 0;
  knockablesDrawn = 0;
  private readonly hits: Int32Array;
  /** The cull rect of the last update(): the camera's ground rect plus ITEMS_CULL_MARGIN_M. */
  readonly cullRect: Aabb = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  private readonly markerFrames: readonly FrameId[];
  private readonly markerX: Float64Array;
  private readonly markerY: Float64Array;
  private readonly markerLayer: Uint8Array;
  private readonly markerTurns: Uint8Array;
  /** The interpolated position of the litter item being written (addFrom reads it, slot 0). */
  private readonly drawX = new Float64Array(1);
  private readonly drawY = new Float64Array(1);
  /** 1 on every tile of a `haz.speed_bump` site (the ground layer draws those bumps), by row-major tile. */
  private readonly bumpTile: Uint8Array;
  private readonly levelW: number;

  /** `items` and `world` are the loaded atlases of those names; `level` gives the static markers. */
  constructor(items: SpriteAtlas, world: SpriteAtlas, level: Level, options: ItemsBatchOptions = {}) {
    if (items.name !== 'items') throw new Error(`the items batch needs the items atlas, got '${items.name}'`);
    if (world.name !== 'world') throw new Error(`the items batch needs the world atlas, got '${world.name}'`);
    if (LITTER_ROTATIONS !== LITTER_ROT_DIRS.length) throw new Error('litter rotations and frames disagree');
    const litterCapacity = options.litterCapacity ?? LITTER_CAPACITY;
    const stainCapacity = options.stainCapacity ?? STAIN_CAPACITY;
    const pickupCapacity = options.pickupCapacity ?? PICKUP_CAPACITY;
    const hazardCapacity = options.hazardCapacity ?? HAZARD_CAPACITY;
    const bodyCapacity = options.bodyCapacity ?? BODY_CAPACITY;
    this.levelW = level.size[0];
    this.bumpTile = new Uint8Array(level.size[0] * level.size[1]);
    for (const site of level.sites) {
      if (site.id !== 'haz.speed_bump') continue;
      const [x0, y0, x1, y1] = site.rect;
      for (let r = y0; r < y1; r += 1)
        for (let c = x0; c < x1; c += 1) this.bumpTile[r * this.levelW + c] = 1;
    }
    const markers = levelItemMarkers(level);
    this.markers = markers;
    this.markerFrames = markers.map((m) => m.frame);
    this.markerX = Float64Array.from(markers, (m) => m.xM);
    this.markerY = Float64Array.from(markers, (m) => m.yM);
    this.markerLayer = Uint8Array.from(markers, (m) => m.layer);
    this.markerTurns = Uint8Array.from(markers, (m) => m.quarterTurns);
    this.hits = new Int32Array(litterCapacity);
    const streetCapacity = hazardCapacity + bodyCapacity * KNOCKABLE_MAX_SLICES;
    const capacity = litterCapacity + stainCapacity + pickupCapacity + markers.length + streetCapacity;
    this.batch = new SpriteBatch(items, capacity, {
      secondaryAtlas: world,
      receiveShadows: true,
    });
    this.batch.mesh.name = 'items';
    this.batch.mesh.renderOrder = ITEMS_RENDER_ORDER;
  }

  get mesh(): SpriteBatch['mesh'] {
    return this.batch.mesh;
  }

  // per-frame draw path: begin
  /**
   * Writes this frame's instances: every stain, marker, litter item and pickup inside `camera` (the camera's
   * ground rect, cameraGroundRect with no margin) grown by ITEMS_CULL_MARGIN_M. `tick` is the World tick (wobble,
   * bob), `alpha` the render alpha (litter interpolation, clamped to 0..1) and `camYSimM` the camera's sim y.
   * `hazards` and `bodies` (SSP-103) add the hazard decals and the knockables, whose drop shadows go into
   * `shadows` (the shift's drop-shadow batch, already begun) when it is given.
   */
  update(
    litter: LitterFieldView,
    stains: StainStoreView,
    pickups: PickupsView,
    tick: number,
    alpha: number,
    camera: Readonly<Aabb>,
    camYSimM: number,
    hazards: HazardStoreView | null = null,
    bodies: BodyStoreView | null = null,
    shadows: DropShadowBatch | null = null,
  ): void {
    const rect = this.cullRect;
    rect.minX = camera.minX - ITEMS_CULL_MARGIN_M;
    rect.minY = camera.minY - ITEMS_CULL_MARGIN_M;
    rect.maxX = camera.maxX + ITEMS_CULL_MARGIN_M;
    rect.maxY = camera.maxY + ITEMS_CULL_MARGIN_M;
    const batch = this.batch;
    batch.begin(camYSimM);

    // Positions stay in typed arrays and are compared in place: no metre double is passed to a call (V8 boxes
    // one when it does not inline the callee), so the frame allocates nothing.
    let stainsDrawn = 0;
    const sx = stains.x;
    const sy = stains.y;
    for (let i = 0; i < stains.count; i += 1) {
      const x = sx[i] as number;
      const y = sy[i] as number;
      if (x < rect.minX || x > rect.maxX || y < rect.minY || y > rect.maxY) continue;
      batch.addFrom(stainFrameOf(stains, i), sx, sy, i, DepthLayer.Decal);
      stainsDrawn += 1;
    }

    let hazardsDrawn = 0;
    if (hazards !== null) {
      const hx = hazards.x;
      const hy = hazards.y;
      for (let i = 0; i < hazards.count; i += 1) {
        const x = hx[i] as number;
        const y = hy[i] as number;
        if (x < rect.minX || x > rect.maxX || y < rect.minY || y > rect.maxY) continue;
        const kind = hazards.kind[i] as number;
        const col = hazards.col0[i] as number;
        const row = hazards.row0[i] as number;
        if (kind === BUMP_KIND && this.bumpTile[row * this.levelW + col] === 1) continue;
        batch.addFrom(hazardFrame(kind, col, row, tick), hx, hy, i, DepthLayer.Decal);
        hazardsDrawn += 1;
      }
    }

    let markersDrawn = 0;
    const mx = this.markerX;
    const my = this.markerY;
    for (let i = 0; i < this.markerFrames.length; i += 1) {
      const x = mx[i] as number;
      const y = my[i] as number;
      if (x < rect.minX || x > rect.maxX || y < rect.minY || y > rect.maxY) continue;
      const layer = this.markerLayer[i] as DepthLayer;
      batch.addFrom(this.markerFrames[i] as FrameId, mx, my, i, layer, 0, 0, this.markerTurns[i] as number);
      markersDrawn += 1;
    }

    const t = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
    const hits = this.hits;
    const drawX = this.drawX;
    const drawY = this.drawY;
    const n = queryLitterView(litter, rect, hits);
    for (let k = 0; k < n; k += 1) {
      const i = hits[k] as number;
      const px = litter.prevX[i] as number;
      const py = litter.prevY[i] as number;
      drawX[0] = px + ((litter.x[i] as number) - px) * t;
      drawY[0] = py + ((litter.y[i] as number) - py) * t;
      const kind = litter.kind[i] as number;
      const frame = litterFrame(kind, litter.rot[i] as number, litter.flags[i] as number, tick);
      batch.addFrom(frame, drawX, drawY, 0, DepthLayer.Litter);
    }

    let knockablesDrawn = 0;
    if (bodies !== null) {
      for (let i = 0; i < bodies.count; i += 1) {
        const px = bodies.prevX[i] as number;
        const py = bodies.prevY[i] as number;
        const x = px + ((bodies.x[i] as number) - px) * t;
        const y = py + ((bodies.y[i] as number) - py) * t;
        if (x < rect.minX || x > rect.maxX || y < rect.minY || y > rect.maxY) continue;
        drawX[0] = x;
        drawY[0] = y;
        const from = bodies.prevHeading[i] as number;
        const d = (bodies.heading[i] as number) - from;
        const h = from + (d - 2 * Math.PI * Math.floor((d + Math.PI) / (2 * Math.PI))) * t;
        const turns = ((Math.round(h / (Math.PI / 2)) % 4) + 4) % 4;
        const kind = bodies.kind[i] as number;
        const look = KNOCKABLE_LOOKS[kind] ?? rejectKnockableKind(kind);
        const flat = look.flat;
        if (flat !== null) {
          batch.addFrom(flat, drawX, drawY, 0, DepthLayer.Litter, 0, SpriteFlag.Upright, turns);
          shadows?.addFrom(flat, drawX, drawY, 0, 0, turns);
        } else if (look.stack !== null) {
          const slices = look.stack.slices;
          const heights = KNOCKABLE_SLICE_HEIGHTS[kind] as Float64Array;
          for (let k = 0; k < slices.length; k += 1) {
            const slice = slices[k];
            if (slice === undefined) continue;
            batch.addSliceFrom(
              slice.frame,
              drawX,
              drawY,
              0,
              heights,
              k,
              STACK_LAYER,
              SpriteFlag.Upright,
              turns,
            );
            if (slice.castsShadow) shadows?.addSliceFrom(slice.frame, drawX, drawY, 0, heights, k, turns);
          }
        }
        knockablesDrawn += 1;
      }
    }

    let pickupsDrawn = 0;
    const kx = pickups.x;
    const ky = pickups.y;
    for (let i = 0; i < pickups.count; i += 1) {
      const x = kx[i] as number;
      const y = ky[i] as number;
      if (x < rect.minX || x > rect.maxX || y < rect.minY || y > rect.maxY) continue;
      drawX[0] = x;
      drawY[0] = y;
      batch.addFrom(pickupFrame(pickups.kind[i] as number, tick), drawX, drawY, 0, DepthLayer.Litter);
      pickupsDrawn += 1;
    }

    batch.end();
    this.stainsDrawn = stainsDrawn;
    this.markersDrawn = markersDrawn;
    this.litterDrawn = n;
    this.pickupsDrawn = pickupsDrawn;
    this.hazardsDrawn = hazardsDrawn;
    this.knockablesDrawn = knockablesDrawn;
  }
  // per-frame draw path: end

  /** Releases the batch's GPU resources (not the shared atlas textures). */
  dispose(): void {
    this.batch.dispose();
  }
}

/** Throws for a litter kind outside LITTER_IDS (kept out of the per-frame path, which builds no objects). */
function rejectLitterKind(kind: number): never {
  throw new RangeError(`litter kind ${kind} is not 0..${LITTER_IDS.length - 1}`);
}

/** Throws for a power-up kind outside POWERUP_IDS (kept out of the per-frame path). */
function rejectPowerUpKind(kind: number): never {
  throw new RangeError(`power-up kind ${kind} is not 0..${POWERUP_IDS.length - 1}`);
}

/** Throws for a hazard kind outside HAZARD_ENTITY_IDS (kept out of the per-frame path). */
function rejectHazardKind(kind: number): never {
  throw new RangeError(`hazard kind ${kind} is not 0..${HAZARD_ENTITY_IDS.length - 1}`);
}

/** Throws for a knockable kind outside KNOCKABLE_IDS (kept out of the per-frame path). */
function rejectKnockableKind(kind: number): never {
  throw new RangeError(`knockable kind ${kind} is not 0..${KNOCKABLE_IDS.length - 1}`);
}

/** Throws for a stain kind outside STAIN_IDS (kept out of the per-frame path). */
function rejectStainKind(kind: number): never {
  throw new RangeError(`stain kind ${kind} is not 0..${STAIN_IDS.length - 1}`);
}
