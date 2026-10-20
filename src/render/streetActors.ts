// The street's actors in the shift's actors draw (TECHNICAL_DESIGN §12.5, §12.7; ART_BIBLE §4.5, §5.6, §6.4, §8.3,
// §10.2; SSP-103): every visible NPC (people, the walkers' dogs, cats and pigeons) and every visible vehicle (moving
// traffic and parked cars), the cat riding Bessie's roof and the dog walkers' leads, written into the actors
// SpriteBatch and the DropShadowBatch Bessie already draws with (bessieSprite.ts), so the whole street costs no draw
// call beyond Bessie's two.
//
// Per instance:
//   NPCs      frame from actorFrames.ts (state, stateTicks, speed and the drawn position; the direction with
//             10° hysteresis, kept per NPC handle), at the position interpolated from prevX/prevY by the render
//             alpha; depth layer 5 (pedestrians, animals). Exceptions: a cat that is ON_ROOF (leaping onto
//             Bessie, riding, hopping off) or perched (Perch on a wall or a parked car's roof, `timerB` a perch
//             index) draws on layer 9 (CatRoof), over the car it sits on and over Bessie, and casts its drop shadow
//             at +3, +3 (ART_BIBLE §8.3's elevated offset); while it rides (RideRoof) its pose is Bessie's drawn
//             pose with the seat's local offset (0 right, entities.json rules.seatForwardM ahead of her centre)
//             and her heading, so it never slides about her roof between ticks. A flying pigeon draws on layer 9
//             too (it is in the air) and casts no shadow (ART_BIBLE §6.4).
//   Vehicles  `veh.<kind>:body:hNN:0` (parked kinds draw their `_parked` asset at the heading they were parked at),
//             the heading interpolated along the shortest arc (prevHeading → heading) with 2° hysteresis, kept per
//             vehicle `uid`; depth layer 6 (traffic).
//   Swaps     the per-instance swap row (ART_BIBLE §5.6; the tables stay identity until SSP-114 fills them in M4):
//             a shopper's outfit is its NpcStore.swap; a hatchback's or saloon's paint (moving or parked) is its
//             VehicleStore.paint slot; the walker's dog wears WALKER_DOG_COAT_SLOT; every other character and
//             vehicle (unique characters, cats, pigeons, taxis, vans, buses, bicycles, scooters) uses slot 0.
//   Leads     each dog walker's lead (ART_BIBLE §8.3): a 1 px line in 18 postbox_red from the walker's hand (the
//             centroid of the 18 pixels of the walker's drawn frame: the lead's handle) to the dog's collar (the
//             18 pixels of the dog's frame), rasterised with Bresenham on the 1/16 m pixel grid and written as
//             axis-aligned runs (horizontal runs for a mostly horizontal lead, vertical otherwise) of
//             SpriteFlag.Solid rectangles in the actors batch on layer 5, each with its +2, +2 drop shadow in the
//             shadow batch (decided here: thin quads in the existing batches, no new draw call). A lead is drawn
//             when its walker or its dog is in view, at most LEAD_RUN_BUDGET runs a frame in all.
//   Shadows   every actor's drop shadow is its frame at +2, +2 (ART_BIBLE §6.4) in the shadow batch.
//
// Order: vehicles, then the leads, then the NPCs, each layer's instances added north to south (an insertion sort of
// the frame's hits by drawn y), so pairs too close for the sort bias to separate still overlap correctly.
//
// Culling (TECHNICAL_DESIGN §12.5): the NPC store's 4 m spatial hash (queryNpcs) and the vehicle store's 8 m lookup
// (queryVehicles, the buckets traffic rebuilt at the end of phase 8) are queried with the camera's ground rect
// plus STREET_CULL_MARGIN_M (4 m); a vehicle whose centre is farther outside than its largest half diagonal is
// dropped.
//
// Render-only: reads the views and writes nothing to them. The per-frame path allocates nothing: positions and
// headings go through the typed scratch columns below (no metre double crosses a call), frame IDs come from the
// typed tables of actorFrames.ts, the lead anchors from a Map of typed pairs built at construction (the per-frame
// region is scanned for `new` and literals and heap-measured in tests/unit/streetActors.test.ts).
import { FRAME, type FrameId } from '../gen/assets.ts';
import type { Aabb } from '../sim/collision/obb.ts';
import { PX_PER_M } from '../sim/constants.ts';
import { NPC_IDS, VEHICLE_IDS } from '../sim/entities.ts';
import { CAT } from '../sim/npc/behaviours/cat.ts';
import { PIGEON } from '../sim/npc/behaviours/pigeon.ts';
import {
  NPC_CAPACITY,
  NPC_FLAG,
  NPC_HANDLE_SLOT_BITS,
  NpcOrigin,
  type NpcStoreView,
  queryNpcs,
  resolveNpcHandle,
} from '../sim/npc/store.ts';
import { hash32 } from '../sim/rng.ts';
import { DEFAULT_ENTITIES } from '../sim/tuning.ts';
import {
  PAINTED_KINDS,
  queryVehicles,
  VEHICLE_CAPACITY,
  type VehicleStoreView,
} from '../sim/vehicleStore.ts';
import {
  ACTOR_SETS,
  type ActorSet,
  actorDirFrom,
  actorFrame,
  birdDirFrom,
  DOG_SET,
  frameFor,
  vehicleFrame,
  vehicleHeadingFrom,
  WALK_MIN_MPS,
  walkFrameOf,
} from './actorFrames.ts';
import { cellHash, VariantSalt } from './cityMesh.ts';
import type { Pose } from './interpolate.ts';
import type { SpriteAtlas } from './spriteAtlas.ts';
import type { DropShadowBatch, SpriteBatch } from './spriteBatch.ts';
import { DepthLayer } from './worldMaterial.ts';

/** Margin round the camera's ground rect inside which actors are drawn (TECHNICAL_DESIGN §12.5). */
export const STREET_CULL_MARGIN_M = 4;

/** The lead's colour: 18 postbox_red (ART_BIBLE §8.3). */
export const LEAD_COLOUR = 18;

/** Lead runs (Solid rectangles) drawn per frame at most, all leads together; a lead that does not fit is skipped. */
export const LEAD_RUN_BUDGET = 512;

/**
 * The walker's dog's swap slot (ART_BIBLE §5.6: dogs take slots 0–2 of the skin/coat column, 12/11 → 13/08 in
 * slot 2). Decided in SSP-103: the walker's dog wears the brown coat of slot 2, so it never reads as the loose
 * dog (slot 0) once SSP-114 fills the tables; identity until then.
 */
export const WALKER_DOG_COAT_SLOT = 2;

/** Extra drop-shadow pixels of an elevated cat: +3, +3 instead of +2, +2 (ART_BIBLE §8.3, proposed there). */
export const ELEVATED_SHADOW_LIFT_PX = 1;

/** Actor instances the shift's actors batch needs beside Bessie's two: every NPC, every vehicle and the leads. */
export function streetSpriteCapacity(npcCapacity = NPC_CAPACITY, vehicleCapacity = VEHICLE_CAPACITY): number {
  return npcCapacity + vehicleCapacity + LEAD_RUN_BUDGET;
}

/** The actors' animation-phase stream name (TECHNICAL_DESIGN §7.3): render-side, never a sim stream. */
export const ACTORS_RENDER_STREAM = 'render.actors';

/** The seed of the actors' animation phases for a run seed: runSeed ^ hash32('render.actors'), uint32. */
export function actorRenderSeed(runSeed: number): number {
  return (runSeed ^ hash32(ACTORS_RENDER_STREAM)) >>> 0;
}

/** An NPC's animation phase, 0..65535: a stateless hash of its handle and the render seed (ART_BIBLE §10.1). */
export function actorPhase(handle: number, seed: number): number {
  return cellHash(handle | 0, seed | 0, VariantSalt.Actor) & 0xffff;
}

/**
 * Writes the axis-aligned runs of the 1 px Bresenham line from pixel (x0, y0) to (x1, y1), both ends included,
 * into `out` as (x, y, w, h) quadruples and returns how many runs: horizontal runs (h = 1) for a line at least as
 * wide as it is tall, vertical (w = 1) otherwise. At most max(|dx|, |dy|) + 1 runs; returns −1 (writing nothing
 * more) if `out` is too short. Integers only.
 */
export function leadRuns(x0: number, y0: number, x1: number, y1: number, out: Int32Array): number {
  const dx = x1 > x0 ? x1 - x0 : x0 - x1;
  const dy = y1 > y0 ? y1 - y0 : y0 - y1;
  const sx = x1 >= x0 ? 1 : -1;
  const sy = y1 >= y0 ? 1 : -1;
  const horizontal = dx >= dy;
  let err = dx - dy;
  let x = x0;
  let y = y0;
  let startX = x0;
  let startY = y0;
  let prevX = x0;
  let prevY = y0;
  let n = 0;
  for (;;) {
    const sameRun = horizontal ? y === startY : x === startX;
    if (!sameRun) {
      if ((n + 1) * 4 > out.length) return -1;
      writeRun(out, n, startX, startY, prevX, prevY);
      n += 1;
      startX = x;
      startY = y;
    }
    prevX = x;
    prevY = y;
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
  if ((n + 1) * 4 > out.length) return -1;
  writeRun(out, n, startX, startY, prevX, prevY);
  return n + 1;
}

/** Run k of `out`: the rectangle spanning pixels (ax, ay) and (bx, by), on one row or one column. */
function writeRun(out: Int32Array, k: number, ax: number, ay: number, bx: number, by: number): void {
  const o = k * 4;
  out[o] = ax < bx ? ax : bx;
  out[o + 1] = ay < by ? ay : by;
  out[o + 2] = (ax < bx ? bx - ax : ax - bx) + 1;
  out[o + 3] = (ay < by ? by - ay : ay - by) + 1;
}

/**
 * Lead anchor offsets of every frame of `set` from the atlas: the rounded centroid of its LEAD_COLOUR pixels,
 * relative to the frame's pivot, in pixels ([dx, dy]); a frame with none anchors `fallbackDy` above its pivot.
 */
function leadAnchors(
  atlas: SpriteAtlas,
  set: ActorSet,
  fallbackDy: number,
  out: Map<FrameId, Int16Array>,
): void {
  for (const anim of set.anims) {
    if (anim === null) continue;
    for (const dirFrames of anim) {
      for (const frame of dirFrames) {
        const f = FRAME[frame];
        let sx = 0;
        let sy = 0;
        let n = 0;
        for (let ty = 0; ty < f.h; ty += 1) {
          for (let tx = 0; tx < f.w; tx += 1) {
            if (atlas.indices[(f.y + ty) * atlas.width + f.x + tx] === LEAD_COLOUR) {
              sx += tx;
              sy += ty;
              n += 1;
            }
          }
        }
        const pair = new Int16Array(2);
        if (n > 0) {
          pair[0] = Math.round(sx / n) - f.px;
          pair[1] = Math.round(sy / n) - f.py;
        } else {
          pair[1] = fallbackDy;
        }
        out.set(frame, pair);
      }
    }
  }
}

/** Construction options (default: the game's store capacities and tables). */
export type StreetActorsOptions = {
  readonly npcCapacity?: number;
  readonly vehicleCapacity?: number;
  /** The run seed (actorRenderSeed is applied here). Default 0. */
  readonly seed?: number;
  /** The riding cat's seat, metres ahead of Bessie's body centre (entities.json npc.cat rules.seatForwardM). */
  readonly catSeatForwardM?: number;
};

/** The street's NPCs, vehicles and leads. Call update() once per rendered frame inside Bessie's begin/end. */
export class StreetActors {
  /** Instances written by the last update(). */
  npcsDrawn = 0;
  vehiclesDrawn = 0;
  leadsDrawn = 0;
  leadRunsDrawn = 0;
  /** The cull rect of the last update(): the camera's ground rect plus STREET_CULL_MARGIN_M. */
  readonly cullRect: Aabb = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  /**
   * The sprite-batch instance each NPC (by store index) and each vehicle was written to by the last update(), or
   * −1 when it was not drawn (tests read the instance data through it).
   */
  readonly npcInstance: Int32Array;
  readonly vehicleInstance: Int32Array;
  /** The frame each NPC and vehicle was drawn with by the last update() (by store index; stale when not drawn). */
  readonly npcFrame: FrameId[];
  readonly vehicleFrame: FrameId[];

  private readonly seed: number;
  private readonly seatForwardM: Float64Array;
  private readonly painted: Uint8Array;
  private readonly shopperKind: number;
  private readonly walkerKind: number;
  private readonly catKind: number;
  private readonly pigeonKind: number;
  private readonly leadAnchor = new Map<FrameId, Int16Array>();
  // NPC scratch, by store index.
  private readonly npcHits: Int32Array;
  private readonly npcX: Float64Array;
  private readonly npcY: Float64Array;
  private readonly npcHead: Float64Array;
  private readonly npcLayer: Uint8Array;
  private readonly npcSwap: Uint8Array;
  private readonly npcLift: Int8Array;
  private readonly npcShadow: Uint8Array;
  /** The frame counter value when NPC i was last prepared / hit. */
  private readonly npcStamp: Int32Array;
  private readonly npcHitStamp: Int32Array;
  // Direction memory, by handle slot: the handle it was kept for and the direction drawn.
  private readonly dirHandle: Int32Array;
  private readonly dirMem: Int8Array;
  // Vehicle scratch, by store index.
  private readonly vehHits: Int32Array;
  private readonly vehX: Float64Array;
  private readonly vehY: Float64Array;
  private readonly vehHead: Float64Array;
  private readonly vehUid: Int32Array;
  private readonly vehMem: Int8Array;
  private readonly runs = new Int32Array(LEAD_RUN_BUDGET * 4);
  private readonly bessieHead = new Float64Array(1);
  private frameNo = 0;
  /** Lead runs drawn so far this frame (LEAD_RUN_BUDGET caps them). */
  private leadRunsCounter = 0;

  /** `actors` is the loaded actors atlas (the lead anchors are read from its index data). */
  constructor(actors: SpriteAtlas, options: StreetActorsOptions = {}) {
    if (actors.name !== 'actors')
      throw new Error(`street actors need the actors atlas, got '${actors.name}'`);
    for (let k = 0; k < NPC_IDS.length; k += 1) {
      if (ACTOR_SETS[k]?.asset !== NPC_IDS[k]) throw new Error(`actor set ${k} is not ${NPC_IDS[k]}`);
    }
    const npcCap = options.npcCapacity ?? NPC_CAPACITY;
    const vehCap = options.vehicleCapacity ?? VEHICLE_CAPACITY;
    if (npcCap > 1 << NPC_HANDLE_SLOT_BITS) throw new Error(`street actors: NPC capacity ${npcCap}`);
    this.seed = actorRenderSeed(options.seed ?? 0);
    this.seatForwardM = Float64Array.of(
      options.catSeatForwardM ?? DEFAULT_ENTITIES.npcs['npc.cat'].rules.seatForwardM,
    );
    this.painted = Uint8Array.from(VEHICLE_IDS, (id) => (PAINTED_KINDS.includes(id) ? 1 : 0));
    this.shopperKind = NPC_IDS.indexOf('npc.shopper');
    this.walkerKind = NPC_IDS.indexOf('npc.dog_walker');
    this.catKind = NPC_IDS.indexOf('npc.cat');
    this.pigeonKind = NPC_IDS.indexOf('npc.pigeon');
    leadAnchors(actors, ACTOR_SETS[this.walkerKind] as ActorSet, -10, this.leadAnchor);
    leadAnchors(actors, ACTOR_SETS[DOG_SET] as ActorSet, -8, this.leadAnchor);
    this.npcHits = new Int32Array(npcCap);
    this.npcX = new Float64Array(npcCap);
    this.npcY = new Float64Array(npcCap);
    this.npcHead = new Float64Array(npcCap);
    this.npcLayer = new Uint8Array(npcCap);
    this.npcSwap = new Uint8Array(npcCap);
    this.npcLift = new Int8Array(npcCap);
    this.npcShadow = new Uint8Array(npcCap);
    this.npcStamp = new Int32Array(npcCap).fill(-1);
    this.npcHitStamp = new Int32Array(npcCap).fill(-1);
    this.npcInstance = new Int32Array(npcCap).fill(-1);
    this.npcFrame = new Array<FrameId>(npcCap).fill('npc.shopper:idle:s:0');
    this.dirHandle = new Int32Array(npcCap).fill(-1);
    this.dirMem = new Int8Array(npcCap).fill(-1);
    this.vehHits = new Int32Array(vehCap);
    this.vehX = new Float64Array(vehCap);
    this.vehY = new Float64Array(vehCap);
    this.vehHead = new Float64Array(vehCap);
    this.vehUid = new Int32Array(vehCap).fill(-1);
    this.vehMem = new Int8Array(vehCap).fill(-1);
    this.vehicleInstance = new Int32Array(vehCap).fill(-1);
    this.vehicleFrame = new Array<FrameId>(vehCap).fill('veh.hatchback:body:h00:0');
  }

  /** The lead anchor [dx, dy] px of a dog walker's or dog's frame (relative to its pivot), or undefined. */
  leadAnchorOf(frame: FrameId): Readonly<Int16Array> | undefined {
    return this.leadAnchor.get(frame);
  }

  // per-frame draw path: begin
  /**
   * Writes this frame's street actors into `sprites` (the actors batch) and `shadows` (the drop-shadow batch),
   * both already begun with the camera's sim y: the NPCs and vehicles inside `camera` (the camera's ground rect,
   * no margin) grown by STREET_CULL_MARGIN_M, at the render `alpha` (clamped to 0..1), and the leads; a riding cat
   * sits on `bessie` (her drawn pose).
   */
  update(
    npc: NpcStoreView,
    vehicles: VehicleStoreView,
    alpha: number,
    camera: Readonly<Aabb>,
    bessie: Readonly<Pose>,
    sprites: SpriteBatch,
    shadows: DropShadowBatch,
  ): void {
    const rect = this.cullRect;
    rect.minX = camera.minX - STREET_CULL_MARGIN_M;
    rect.minY = camera.minY - STREET_CULL_MARGIN_M;
    rect.maxX = camera.maxX + STREET_CULL_MARGIN_M;
    rect.maxY = camera.maxY + STREET_CULL_MARGIN_M;
    const t = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
    this.frameNo += 1;
    this.bessieHead[0] = bessie.headingRad;
    this.drawVehicles(vehicles, t, sprites, shadows);
    this.drawNpcs(npc, t, bessie, sprites, shadows);
  }

  private drawVehicles(
    vehicles: VehicleStoreView,
    t: number,
    sprites: SpriteBatch,
    shadows: DropShadowBatch,
  ): void {
    const rect = this.cullRect;
    const hits = this.vehHits;
    const inst = this.vehicleInstance;
    inst.fill(-1);
    const found = queryVehicles(vehicles, rect, hits);
    const r = vehicles.maxHalfDiagonalM;
    const xs = this.vehX;
    const ys = this.vehY;
    const hs = this.vehHead;
    let n = 0;
    for (let k = 0; k < found; k += 1) {
      const i = hits[k] as number;
      const px = vehicles.prevX[i] as number;
      const py = vehicles.prevY[i] as number;
      const x = px + ((vehicles.x[i] as number) - px) * t;
      const y = py + ((vehicles.y[i] as number) - py) * t;
      if (x < rect.minX - r || x > rect.maxX + r || y < rect.minY - r || y > rect.maxY + r) continue;
      xs[i] = x;
      ys[i] = y;
      const from = vehicles.prevHeading[i] as number;
      const d = (vehicles.heading[i] as number) - from;
      hs[i] = from + (d - 2 * Math.PI * Math.floor((d + Math.PI) / (2 * Math.PI))) * t;
      hits[n] = i;
      n += 1;
    }
    sortByY(hits, n, ys);
    for (let k = 0; k < n; k += 1) {
      const i = hits[k] as number;
      const uid = vehicles.uid[i] as number;
      const prev = this.vehUid[i] === uid ? (this.vehMem[i] as number) : -1;
      const heading = vehicleHeadingFrom(hs, i, prev);
      this.vehUid[i] = uid;
      this.vehMem[i] = heading;
      const kind = vehicles.kind[i] as number;
      const frame = vehicleFrame(kind, heading);
      const swap = this.painted[kind] === 1 ? (vehicles.paint[i] as number) : 0;
      inst[i] = sprites.count;
      this.vehicleFrame[i] = frame;
      sprites.addFrom(frame, xs, ys, i, DepthLayer.Traffic, swap);
      shadows.addFrom(frame, xs, ys, i);
    }
    this.vehiclesDrawn = n;
  }

  private drawNpcs(
    npc: NpcStoreView,
    t: number,
    bessie: Readonly<Pose>,
    sprites: SpriteBatch,
    shadows: DropShadowBatch,
  ): void {
    const hits = this.npcHits;
    const inst = this.npcInstance;
    inst.fill(-1);
    const n = queryNpcs(npc, this.cullRect, hits);
    const frameNo = this.frameNo;
    for (let k = 0; k < n; k += 1) {
      const i = hits[k] as number;
      this.prepareNpc(npc, i, t, bessie);
      this.npcHitStamp[i] = frameNo;
    }
    sortByY(hits, n, this.npcY);
    // Leads first: a walker or its dog in view draws the lead once (from the walker when both are).
    this.leadRunsCounter = 0;
    let leads = 0;
    let runs = 0;
    for (let k = 0; k < n; k += 1) {
      const i = hits[k] as number;
      if ((npc.kind[i] as number) !== this.walkerKind) continue;
      const other = resolveNpcHandle(npc, npc.link[i] as number);
      if (other < 0) continue;
      const isDog = (npc.origin[i] as number) === NpcOrigin.Companion;
      if (isDog && this.npcHitStamp[other] === frameNo) continue;
      if (this.npcStamp[other] !== frameNo) this.prepareNpc(npc, other, t, bessie);
      const walker = isDog ? other : i;
      const dog = isDog ? i : other;
      const drawn = this.drawLead(walker, dog, sprites, shadows);
      if (drawn > 0) {
        leads += 1;
        runs += drawn;
      }
    }
    for (let k = 0; k < n; k += 1) {
      const i = hits[k] as number;
      const frame = this.npcFrame[i] as FrameId;
      inst[i] = sprites.count;
      sprites.addFrom(
        frame,
        this.npcX,
        this.npcY,
        i,
        this.npcLayer[i] as DepthLayer,
        this.npcSwap[i] as number,
      );
      if (this.npcShadow[i] === 1) {
        shadows.addFrom(frame, this.npcX, this.npcY, i, 0, 0, this.npcLift[i] as number);
      }
    }
    this.npcsDrawn = n;
    this.leadsDrawn = leads;
    this.leadRunsDrawn = runs;
  }

  /** Fills NPC i's drawn position, heading, frame, layer, swap and shadow for this frame. */
  private prepareNpc(npc: NpcStoreView, i: number, t: number, bessie: Readonly<Pose>): void {
    this.npcStamp[i] = this.frameNo;
    const kind = npc.kind[i] as number;
    const origin = npc.origin[i] as number;
    const state = npc.state[i] as number;
    const flags = npc.flags[i] as number;
    const xs = this.npcX;
    const ys = this.npcY;
    const hs = this.npcHead;
    const isCat = kind === this.catKind;
    const riding = isCat && state === CAT.RideRoof;
    if (riding) {
      // On the seat: Bessie's drawn pose plus the seat's local offset, her heading.
      const f = this.seatForwardM[0] as number;
      const h = this.bessieHead[0] as number;
      xs[i] = bessie.xM + Math.sin(h) * f;
      ys[i] = bessie.yM - Math.cos(h) * f;
      hs[i] = h;
    } else {
      const px = npc.prevX[i] as number;
      const py = npc.prevY[i] as number;
      xs[i] = px + ((npc.x[i] as number) - px) * t;
      ys[i] = py + ((npc.y[i] as number) - py) * t;
      hs[i] = npc.heading[i] as number;
    }
    const setIndex = kind === this.walkerKind && origin === NpcOrigin.Companion ? DOG_SET : kind;
    const set = ACTOR_SETS[setIndex] as ActorSet;
    const slot = npc.handleSlot[i] as number;
    const handle = ((npc.slotGen[slot] as number) << NPC_HANDLE_SLOT_BITS) | slot;
    let dir: number;
    if (set.dirs === 4) dir = birdDirFrom(hs, i);
    else {
      const prev = this.dirHandle[slot] === handle ? (this.dirMem[slot] as number) : -1;
      dir = actorDirFrom(hs, i, prev);
      this.dirHandle[slot] = handle;
      this.dirMem[slot] = dir;
    }
    const walk = walkFrameOf(xs, ys, i, dir, setIndex);
    const moving = (npc.speed[i] as number) >= WALK_MIN_MPS;
    const pose = frameFor(
      set.rig,
      state,
      npc.stateTicks[i] as number,
      moving,
      walk,
      actorPhase(handle, this.seed),
    );
    this.npcFrame[i] = actorFrame(set, pose, dir);
    let layer: number = DepthLayer.Pedestrian;
    let lift = 0;
    let shadow = 1;
    if (
      isCat &&
      ((flags & NPC_FLAG.ON_ROOF) !== 0 || (state === CAT.Perch && (npc.timerB[i] as number) >= 0))
    ) {
      layer = DepthLayer.CatRoof;
      lift = ELEVATED_SHADOW_LIFT_PX;
    } else if (kind === this.pigeonKind && state === PIGEON.Fly) {
      layer = DepthLayer.CatRoof;
      shadow = 0;
    }
    this.npcLayer[i] = layer;
    this.npcLift[i] = lift;
    this.npcShadow[i] = shadow;
    let swap = 0;
    if (setIndex === DOG_SET) swap = WALKER_DOG_COAT_SLOT;
    else if (kind === this.shopperKind) swap = npc.swap[i] as number;
    this.npcSwap[i] = swap;
  }

  /** Draws the lead from walker w's hand to dog d's collar; returns the runs drawn (0 when it did not fit). */
  private drawLead(w: number, d: number, sprites: SpriteBatch, shadows: DropShadowBatch): number {
    const hand = this.leadAnchor.get(this.npcFrame[w] as FrameId);
    const collar = this.leadAnchor.get(this.npcFrame[d] as FrameId);
    // The anchors are pivots snapped as the vertex shader snaps them (floor(m × 16 + 0.5)).
    const x0 = (Math.floor((this.npcX[w] as number) * PX_PER_M + 0.5) | 0) + (hand?.[0] ?? 0);
    const y0 = (Math.floor((this.npcY[w] as number) * PX_PER_M + 0.5) | 0) + (hand?.[1] ?? 0);
    const x1 = (Math.floor((this.npcX[d] as number) * PX_PER_M + 0.5) | 0) + (collar?.[0] ?? 0);
    const y1 = (Math.floor((this.npcY[d] as number) * PX_PER_M + 0.5) | 0) + (collar?.[1] ?? 0);
    const room = sprites.free < shadows.free ? sprites.free : shadows.free;
    const budget = LEAD_RUN_BUDGET - this.leadRunsCounter;
    const n = leadRuns(x0, y0, x1, y1, this.runs);
    if (n < 0 || n > room || n > budget) return 0;
    const r = this.runs;
    for (let k = 0; k < n; k += 1) {
      const o = k * 4;
      const rx = r[o] as number;
      const ry = r[o + 1] as number;
      const rw = r[o + 2] as number;
      const rh = r[o + 3] as number;
      sprites.addSolid(LEAD_COLOUR, rx, ry, rw, rh, DepthLayer.Pedestrian);
      shadows.addSolid(rx, ry, rw, rh);
    }
    this.leadRunsCounter += n;
    return n;
  }
  // per-frame draw path: end
}

/** Insertion sort of hits[0..n) by keys[hit], ascending and stable (north to south). Allocation-free. */
function sortByY(hits: Int32Array, n: number, keys: Float64Array): void {
  for (let a = 1; a < n; a += 1) {
    const h = hits[a] as number;
    const key = keys[h] as number;
    let b = a - 1;
    while (b >= 0 && (keys[hits[b] as number] as number) > key) {
      hits[b + 1] = hits[b] as number;
      b -= 1;
    }
    hits[b + 1] = h;
  }
}
