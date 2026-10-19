// The asset zoo's layout (SSP-298; TECHNICAL_DESIGN §6.2, ART_BIBLE §15.1): a pure function from the generated frame
// table to where each frame sits on a 480×270 page. ZooScene (src/scenes/ZooScene.ts) draws the result at 1:1; this
// module has no WebGL, DOM or three.js, so the placement rules are unit-tested on their own (tests/unit/zooLayout.test.ts).
//
// Coverage (M3, minimal): frames of the `actors` and `items` atlases only. The world, ui and fx atlases, swap-slot
// rows and the final layout are SSP-118 (M4), which builds on this function rather than replacing it.
//
// Page: three ground bands side by side, each 160 px wide and the full 270 px tall, west to east: 02 asphalt,
// 05 slab, 22 grass (ART_BIBLE §15.1's readability bands). Cells are packed in shelves that run across the whole
// page: left to right through the asphalt band, on into the slab and grass bands, then a new shelf below (as tall
// as its tallest cell); a new page starts when a shelf would pass the bottom. A cell is never split between bands,
// so every sprite sits wholly on one ground, and a full shelf crosses all three.
//
// Cell: the frame's top-left at the cell's (x, y) and the cell `ZOO_GAP_PX` wider and taller than the frame, so the
// +2, +2 drop shadow and 2 px of clear ground stay inside it; cells never overlap and all lie inside 480×270.
// Every page opens with the scale reference, Bessie `veh.sweeper:body:h00:0`, top-left on the asphalt band.
//
// Views:
//   default          one representative frame per asset, assets sorted by ID: the asset's first state (`idle`
//                    or `body` when it has one, else the first in code-point order), its first direction in
//                    canonical order (`s` for actors with 8 directions, `h00` for 32 headings, `-` for none) and
//                    frame 0; paged with `page=<n>` when it overflows.
//   asset=<id>       every frame of that asset: one shelf per state (in the same state order), frames left to
//                    right by direction (`s sw w nw n ne e se`, then `h00`..`h31`) and frame number, wrapping onto
//                    further shelves, bands and pages as needed.
//   An unknown asset (or one with no actors or items frames) yields the default view plus an error naming it; a
//   page past the last yields page 0 plus an error. ZooScene logs the errors with console.error.
//
// Animation: each cell cycles within its (asset, state, direction) group at 10 fps on the 60 Hz tick: the frame
// shown is `cycle[(cycleIndex + floor(tick / 6)) mod cycle.length]` (zooCellFrame). At tick 0 every cell shows the
// frame it was laid out for, so the asset view always shows every frame exactly once.
//
// Shadows: every zoo sprite casts the +2, +2 drop shadow (ART_BIBLE §6.4) except `veh.sweeper_brush` (its discs run
// on the road, §6.4) and `site.depot_bay` (bay paint on the ground, not an object).
import { FRAME, type FrameId } from '../gen/assets.ts';

/** The page the layout fills, in internal pixels: the 480×270 base frame (W = 480). */
export const ZOO_PAGE_W_PX = 480;
export const ZOO_PAGE_H_PX = 270;

/** The atlases the M3 zoo covers. */
export const ZOO_ATLASES: readonly string[] = ['actors', 'items'];

/** The ground bands, west to east: Kerbside-32 names (02 asphalt, 05 slab, 22 grass). */
export const ZOO_BANDS = ['asphalt', 'slab', 'grass'] as const;
export type ZooBand = (typeof ZOO_BANDS)[number];

/** Width of each ground band (three fill the 480 px page). */
export const ZOO_BAND_W_PX = ZOO_PAGE_W_PX / ZOO_BANDS.length;

/** Clear ground between a band's west edge (and the page top) and its first cell. */
export const ZOO_MARGIN_PX = 2;

/** Extra width and height of a cell over its frame: the 2 px drop-shadow offset plus 2 px of clear ground. */
export const ZOO_GAP_PX = 4;

/** Ticks each animation frame shows: 10 fps at the 60 Hz tick (ASSET_PIPELINE §11.3). */
export const ZOO_TICKS_PER_FRAME = 6;

/** The scale reference on every page: Bessie's body at heading h00 (ART_BIBLE §15.1). */
export const ZOO_SCALE_FRAME = 'veh.sweeper:body:h00:0' satisfies FrameId;

/** Assets drawn without a drop shadow (see the header). */
export const ZOO_NO_SHADOW_ASSETS: readonly string[] = ['veh.sweeper_brush', 'site.depot_bay'];

/** States that come first (the representative state of an asset that has one). */
const PREFERRED_STATES: readonly string[] = ['idle', 'body'];

/** The eight actor directions in ART_BIBLE order. */
const ACTOR_DIRS: readonly string[] = ['s', 'sw', 'w', 'nw', 'n', 'ne', 'e', 'se'];

const HEADING_DIR = /^h(\d\d)$/;
const FRAME_NUMBER = /^\d+$/;

/** What the layout needs of a frame: its atlas and size. FRAME's entries qualify. */
export type ZooFrameInfo = { readonly atlas: string; readonly w: number; readonly h: number };

/** One placed frame. */
export type ZooCell<F extends string = FrameId> = {
  /** `scale` for the Bessie reference that opens every page, `frame` for the frames under review. */
  readonly role: 'scale' | 'frame';
  readonly asset: string;
  readonly state: string;
  readonly dir: string;
  /** The frame this cell was laid out for (shown at tick 0). */
  readonly frame: F;
  /** Its (asset, state, direction) group in frame-number order: what the cell cycles through. */
  readonly cycle: readonly F[];
  /** Index of `frame` in `cycle`. */
  readonly cycleIndex: number;
  readonly atlas: string;
  /** Cell rect in page pixels (y down); the frame's top-left is at (x, y). Includes the ZOO_GAP_PX gap. */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** The ground band the cell lies on (0 asphalt, 1 slab, 2 grass). */
  readonly band: number;
  readonly castsShadow: boolean;
};

export type ZooLayoutOptions = {
  /** `page=<n>`: the page to show (default 0). */
  readonly page?: number;
  /** `asset=<id>`: show every frame of this asset; null or absent for the default view. */
  readonly asset?: string | null;
};

export type ZooLayout<F extends string = FrameId> = {
  readonly view: 'default' | 'asset';
  /** The asset shown in the asset view, or null. */
  readonly asset: string | null;
  /** The page shown. */
  readonly page: number;
  readonly pageCount: number;
  /** The shown page's cells, in placement order (the scale reference first). */
  readonly cells: readonly ZooCell<F>[];
  /** Problems with the options (an unknown asset, a page out of range), each naming the value. */
  readonly errors: readonly string[];
};

type ParsedFrame<F extends string> = {
  readonly id: F;
  readonly asset: string;
  readonly state: string;
  readonly dir: string;
  readonly n: number;
};

/** One (asset, state, direction) group: frames in frame-number order. */
type FrameGroup<F extends string> = {
  readonly asset: string;
  readonly state: string;
  readonly dir: string;
  readonly frames: readonly F[];
};

/** Code-point order (never locale order: the layout must be identical everywhere). */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function parseFrameId<F extends string>(id: F): ParsedFrame<F> {
  const parts = id.split(':');
  const [asset, state, dir, n] = parts;
  if (
    parts.length !== 4 ||
    asset === undefined ||
    state === undefined ||
    dir === undefined ||
    n === undefined ||
    asset === '' ||
    state === '' ||
    dir === '' ||
    !FRAME_NUMBER.test(n)
  ) {
    throw new Error(`zoo: frame ID '${id}' is not <asset>:<state>:<dir>:<n>`);
  }
  return { id, asset, state, dir, n: Number(n) };
}

/** Rank of a direction: `-` first, then the actor directions, then the headings, then anything else. */
function dirRank(dir: string): number {
  if (dir === '-') return 0;
  const actor = ACTOR_DIRS.indexOf(dir);
  if (actor >= 0) return 1 + actor;
  const heading = HEADING_DIR.exec(dir);
  if (heading !== null) return 100 + Number(heading[1]);
  return 1000;
}

function compareDirs(a: string, b: string): number {
  return dirRank(a) - dirRank(b) || compareText(a, b);
}

function stateRank(state: string): number {
  const preferred = PREFERRED_STATES.indexOf(state);
  return preferred >= 0 ? preferred : PREFERRED_STATES.length;
}

function compareStates(a: string, b: string): number {
  return stateRank(a) - stateRank(b) || compareText(a, b);
}

/** Groups the zoo's frames by asset, then state, then direction, each level in zoo order. */
function groupFrames<F extends string>(
  frameIds: readonly F[],
  table: Readonly<Record<F, ZooFrameInfo>>,
): Map<string, FrameGroup<F>[]> {
  const parsed: ParsedFrame<F>[] = [];
  const seen = new Set<string>();
  for (const id of frameIds) {
    const info = table[id];
    if (info === undefined) throw new Error(`zoo: frame '${id}' is not in the frame table`);
    if (!ZOO_ATLASES.includes(info.atlas)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    parsed.push(parseFrameId(id));
  }
  parsed.sort(
    (a, b) =>
      compareText(a.asset, b.asset) ||
      compareStates(a.state, b.state) ||
      compareDirs(a.dir, b.dir) ||
      a.n - b.n,
  );
  const byAsset = new Map<string, FrameGroup<F>[]>();
  let current: { asset: string; state: string; dir: string; frames: F[] } | null = null;
  for (const frame of parsed) {
    if (
      current === null ||
      current.asset !== frame.asset ||
      current.state !== frame.state ||
      current.dir !== frame.dir
    ) {
      current = { asset: frame.asset, state: frame.state, dir: frame.dir, frames: [] };
      const groups = byAsset.get(frame.asset) ?? [];
      groups.push(current);
      byAsset.set(frame.asset, groups);
    }
    current.frames.push(frame.id);
  }
  return byAsset;
}

/** What to place: a group's frame at `cycleIndex`, optionally starting a new shelf. */
type Placement<F extends string> = {
  readonly role: 'scale' | 'frame';
  readonly group: FrameGroup<F>;
  readonly cycleIndex: number;
  readonly newShelf: boolean;
};

/** Packs cells into bands and pages (see the header). */
function pack<F extends string>(
  placements: readonly Placement<F>[],
  scale: FrameGroup<F>,
  table: Readonly<Record<F, ZooFrameInfo>>,
): ZooCell<F>[][] {
  const pages: ZooCell<F>[][] = [];
  let cells: ZooCell<F>[] = [];
  let band = 0;
  let x = 0;
  let y = 0;
  let shelfH = 0;
  const bandStart = (b: number): number => b * ZOO_BAND_W_PX + ZOO_MARGIN_PX;
  const newShelf = (): void => {
    if (shelfH === 0) return;
    y += shelfH;
    band = 0;
    x = bandStart(0);
    shelfH = 0;
  };
  const place = (p: Placement<F>): void => {
    const frames = p.group.frames;
    let w = 0;
    let h = 0;
    for (const f of frames) {
      w = Math.max(w, table[f].w);
      h = Math.max(h, table[f].h);
    }
    w += ZOO_GAP_PX;
    h += ZOO_GAP_PX;
    const frame = frames[p.cycleIndex];
    if (frame === undefined) throw new Error(`zoo: ${p.group.asset} has no frame ${p.cycleIndex}`);
    if (w > ZOO_BAND_W_PX - ZOO_MARGIN_PX || h > ZOO_PAGE_H_PX - ZOO_MARGIN_PX) {
      throw new Error(`zoo: frame '${frame}' (${w - ZOO_GAP_PX}x${h - ZOO_GAP_PX}) does not fit a band`);
    }
    if (p.newShelf) newShelf();
    // Terminates: a cell that passed the size check fits at the start of any band, and on a fresh shelf of a
    // fresh page (below or beside the scale reference).
    for (;;) {
      if (x + w > (band + 1) * ZOO_BAND_W_PX) {
        if (band + 1 < ZOO_BANDS.length) {
          band += 1;
          x = bandStart(band);
        } else {
          newShelf();
        }
        continue;
      }
      if (y + h <= ZOO_PAGE_H_PX) break;
      pages.push(cells);
      openPage();
    }
    cells.push({
      role: p.role,
      asset: p.group.asset,
      state: p.group.state,
      dir: p.group.dir,
      frame,
      cycle: frames,
      cycleIndex: p.cycleIndex,
      atlas: table[frame].atlas,
      x,
      y,
      w,
      h,
      band,
      castsShadow: !ZOO_NO_SHADOW_ASSETS.includes(p.group.asset),
    });
    x += w;
    shelfH = Math.max(shelfH, h);
  };
  const openPage = (): void => {
    cells = [];
    band = 0;
    x = bandStart(0);
    y = ZOO_MARGIN_PX;
    shelfH = 0;
    place({ role: 'scale', group: scale, cycleIndex: 0, newShelf: false });
  };
  openPage();
  for (const p of placements) place(p);
  pages.push(cells);
  return pages;
}

/** The scale reference's group: Bessie h00 on its own (it never animates). */
function scaleGroup<F extends string>(table: Readonly<Record<F, ZooFrameInfo>>): FrameGroup<F> {
  const id = ZOO_SCALE_FRAME as F;
  if (table[id] === undefined)
    throw new Error(`zoo: the scale reference '${ZOO_SCALE_FRAME}' is not in the table`);
  const parsed = parseFrameId(id);
  return { asset: parsed.asset, state: parsed.state, dir: parsed.dir, frames: [id] };
}

/** Every page of a view: the default view for `asset` null, else that asset's (which must have frames). */
export function zooPagesOf<F extends string>(
  frameIds: readonly F[],
  asset: string | null,
  table: Readonly<Record<F, ZooFrameInfo>>,
): ZooCell<F>[][] {
  const byAsset = groupFrames(frameIds, table);
  const placements: Placement<F>[] = [];
  if (asset === null) {
    const assets = [...byAsset.keys()].sort(compareText);
    for (const id of assets) {
      const first = byAsset.get(id)?.[0];
      if (first !== undefined)
        placements.push({ role: 'frame', group: first, cycleIndex: 0, newShelf: false });
    }
  } else {
    const groups = byAsset.get(asset);
    if (groups === undefined) throw new Error(`zoo: asset '${asset}' has no actors or items frames`);
    let state: string | null = null;
    for (const group of groups) {
      for (let i = 0; i < group.frames.length; i++) {
        placements.push({ role: 'frame', group, cycleIndex: i, newShelf: group.state !== state });
        state = group.state;
      }
    }
  }
  return pack(placements, scaleGroup(table), table);
}

/** The asset IDs the zoo can show (`asset=<id>`): every asset with actors or items frames, sorted. */
export function zooAssetsOf<F extends string>(
  frameIds: readonly F[],
  table: Readonly<Record<F, ZooFrameInfo>>,
): string[] {
  return [...groupFrames(frameIds, table).keys()].sort(compareText);
}

/** {@link zooLayout} over any frame table (tests pass synthetic tables). */
export function zooLayoutOf<F extends string>(
  frameIds: readonly F[],
  options: ZooLayoutOptions,
  table: Readonly<Record<F, ZooFrameInfo>>,
): ZooLayout<F> {
  const errors: string[] = [];
  let asset = options.asset ?? null;
  if (asset !== null && !zooAssetsOf(frameIds, table).includes(asset)) {
    errors.push(
      `zoo: unknown asset '${asset}' (no actors or items frames in FRAME); showing the default view`,
    );
    asset = null;
  }
  const pages = zooPagesOf(frameIds, asset, table);
  let page = options.page ?? 0;
  if (!Number.isInteger(page) || page < 0 || page >= pages.length) {
    errors.push(`zoo: page ${page} is out of range (0..${pages.length - 1}); showing page 0`);
    page = 0;
  }
  return {
    view: asset === null ? 'default' : 'asset',
    asset,
    page,
    pageCount: pages.length,
    cells: pages[page] ?? [],
    errors,
  };
}

/** The zoo layout of the generated frame table's frames `frameIds` (ZooScene passes every FRAME key). */
export function zooLayout(frameIds: readonly FrameId[], options: ZooLayoutOptions): ZooLayout {
  return zooLayoutOf(frameIds, options, FRAME);
}

/** The frame a cell shows at `tick`: its cycle advanced one frame every ZOO_TICKS_PER_FRAME ticks. */
export function zooCellFrame<F extends string>(cell: ZooCell<F>, tick: number): F {
  const cycle = cell.cycle;
  const step = Math.floor(tick / ZOO_TICKS_PER_FRAME);
  return cycle[(cell.cycleIndex + step) % cycle.length] ?? cell.frame;
}
