// SSP-067: the items instance batch (TECHNICAL_DESIGN §12.5, §12.7; ART_BIBLE §7.1, §10.2). Litter frame selection
// (rot 0..3 → h00/h08/h16/h24, the 12-tick wobble while IN_SUCTION, idle otherwise), the brush overlay's spin by
// RPM (3 ticks per frame at 100%, scaled by 1/RPM, frozen on frame 0 below 10%), culling through the litter
// spatial hash with the camera rect plus 4 m, render interpolation, stains drawn from the `world` atlas through
// the per-instance atlas selector, the level's hydrant/skip/depot-bay markers, the mask-keeping material, and
// the update path's no-allocation rules (source scan and heap delta). Built on the committed atlases, no WebGL.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FRAME, type FrameId } from '../../src/gen/assets.ts';
import {
  advanceBrushSpin,
  BRUSH_SPIN_FRAME_COUNT,
  BRUSH_SPIN_MIN_RPM,
  BRUSH_TICKS_PER_FRAME_FULL_RPM,
  brushSpinFrameAt,
  createBrushSpin,
} from '../../src/render/brushSpin.ts';
import {
  cameraGroundRect,
  createCameraRig,
  groundPxPerMetre,
  pinCameraRig,
} from '../../src/render/camera.ts';
import {
  HYDRANT_FRAME,
  ITEMS_CULL_MARGIN_M,
  ITEMS_RENDER_ORDER,
  ItemsBatch,
  LITTER_FRAMES,
  LITTER_ROT_DIRS,
  LitterAnim,
  levelItemMarkers,
  litterAnim,
  litterFrame,
  STAIN_FRAMES,
  stainFrame,
  WOBBLE_TICKS_PER_FRAME,
} from '../../src/render/itemsBatch.ts';
import { type AtlasName, loadAtlas, type SpriteAtlas } from '../../src/render/spriteAtlas.ts';
import { INSTANCE_STRIDE } from '../../src/render/spriteBatch.ts';
import { RT_HEIGHT_PX, rtWidthPx } from '../../src/render/upscale.ts';
import { DepthLayer } from '../../src/render/worldMaterial.ts';
import type { Aabb } from '../../src/sim/collision/obb.ts';
import { LITTER_IDS, STAIN_IDS } from '../../src/sim/entities.ts';
import {
  addLitter,
  createLitterField,
  type LitterField,
  LitterFlag,
  queryLitter,
  queryLitterView,
} from '../../src/sim/litter.ts';
import { createBlankLevel, decodeLevel, type Level } from '../../src/sim/map.ts';
import { addStain, createStainStore, type StainStore } from '../../src/sim/stains.ts';
import { DEFAULT_ENTITIES, DEFAULT_TUNING } from '../../src/sim/tuning.ts';
import { createWorld } from '../../src/sim/world.ts';
import { assertHeapDeltaWithinThresholds, measureHeapDelta } from '../support/heapDelta.ts';
import { decodePng } from '../support/png.ts';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PUDDLE_LANE: Level = decodeLevel(
  readFileSync(`${REPO_ROOT}public/assets/levels/puddle_lane.json`, 'utf8'),
);
/** Frames run before measuring the update path's heap, so it is JIT-optimised (as spriteBatch.test.ts). */
const RENDER_WARMUP_FRAMES = 20_000;

// Instance layout (spriteBatch.ts): offset 0..2, rotation 3, frameRect 4..7, pivot 8..9, swap 10, flags 11,
// layer 12, sortBias 13, atlas 14.
const O_X = 0;
const O_Y = 2;
const O_ROTATION = 3;
const O_RECT = 4;
const O_LAYER = 12;
const O_ATLAS = 14;

const atlasCache = new Map<AtlasName, Promise<SpriteAtlas>>();
function atlas(name: AtlasName): Promise<SpriteAtlas> {
  let loaded = atlasCache.get(name);
  if (loaded === undefined) {
    loaded = loadAtlas(name, {
      fetchJson: async () => JSON.parse(readFileSync(`${REPO_ROOT}public/assets/atlas/${name}.json`, 'utf8')),
      fetchImage: async () => decodePng(readFileSync(`${REPO_ROOT}public/assets/atlas/${name}.png`)),
    });
    atlasCache.set(name, loaded);
  }
  return loaded;
}

async function newBatch(level: Level, litterCapacity = 64, stainCapacity = 16): Promise<ItemsBatch> {
  return new ItemsBatch(await atlas('items'), await atlas('world'), level, { litterCapacity, stainCapacity });
}

type Instance = { x: number; y: number; turns: number; layer: number; atlas: number; rect: number[] };

function instances(batch: ItemsBatch): Instance[] {
  const d = batch.batch.instanceData;
  const out: Instance[] = [];
  for (let i = 0; i < batch.batch.count; i++) {
    const o = i * INSTANCE_STRIDE;
    out.push({
      x: d[o + O_X] as number,
      y: d[o + O_Y] as number,
      turns: d[o + O_ROTATION] as number,
      layer: d[o + O_LAYER] as number,
      atlas: d[o + O_ATLAS] as number,
      rect: Array.from(d.subarray(o + O_RECT, o + O_RECT + 4)),
    });
  }
  return out;
}

function rectOf(frame: FrameId): number[] {
  const f = FRAME[frame];
  return [f.x, f.y, f.w, f.h];
}

function box(minX: number, minY: number, maxX: number, maxY: number): Aabb {
  return { minX, minY, maxX, maxY };
}

const kindOf = (id: (typeof LITTER_IDS)[number]): number => LITTER_IDS.indexOf(id);
const CRISP = kindOf('litter.crisp_packet');
const DOG_MESS = kindOf('litter.dog_mess');

describe('litter frame selection (ART_BIBLE §10.2, LEVEL_DESIGN §9.1)', () => {
  it('maps rot 0..3 to h00/h08/h16/h24, idle while not in suction', () => {
    expect(LITTER_ROT_DIRS).toEqual(['h00', 'h08', 'h16', 'h24']);
    for (let kind = 0; kind < LITTER_IDS.length; kind++) {
      const id = LITTER_IDS[kind];
      for (let rot = 0; rot < 4; rot++) {
        for (const tick of [0, 11, 12, 25, 600]) {
          expect(litterFrame(kind, rot, 0, tick)).toBe(`${id}:idle:${LITTER_ROT_DIRS[rot]}:0`);
          // Other flags (flung, pinned, brush contact) do not animate.
          const other = LitterFlag.Flung | LitterFlag.Pinned | LitterFlag.BrushContact;
          expect(litterFrame(kind, rot, other, tick)).toBe(`${id}:idle:${LITTER_ROT_DIRS[rot]}:0`);
        }
      }
    }
  });

  it('alternates wobble frames 0 and 1 every 12 ticks while IN_SUCTION', () => {
    expect(WOBBLE_TICKS_PER_FRAME).toBe(12);
    const seen: number[] = [];
    for (let tick = 0; tick < 60; tick++) seen.push(litterAnim(LitterFlag.InSuction, tick));
    const expected = Array.from({ length: 60 }, (_, t) =>
      Math.floor(t / 12) % 2 === 0 ? LitterAnim.Wobble0 : LitterAnim.Wobble1,
    );
    expect(seen).toEqual(expected);
    expect(litterFrame(CRISP, 1, LitterFlag.InSuction, 0)).toBe('litter.crisp_packet:wobble:h08:0');
    expect(litterFrame(CRISP, 1, LitterFlag.InSuction, 11)).toBe('litter.crisp_packet:wobble:h08:0');
    expect(litterFrame(CRISP, 1, LitterFlag.InSuction, 12)).toBe('litter.crisp_packet:wobble:h08:1');
    expect(litterFrame(CRISP, 1, LitterFlag.InSuction, 23)).toBe('litter.crisp_packet:wobble:h08:1');
    expect(litterFrame(CRISP, 1, LitterFlag.InSuction, 24)).toBe('litter.crisp_packet:wobble:h08:0');
    expect(litterFrame(CRISP, 3, LitterFlag.InSuction | LitterFlag.BrushContact, 36)).toBe(
      'litter.crisp_packet:wobble:h24:1',
    );
    // Leaving the zone returns to idle at once.
    expect(litterFrame(CRISP, 3, 0, 36)).toBe('litter.crisp_packet:idle:h24:0');
  });

  it('has 15 × 4 × 3 distinct frames, all 16×16 with a centre pivot in the items atlas', () => {
    const all = LITTER_FRAMES.flat(2);
    expect(LITTER_FRAMES).toHaveLength(LITTER_IDS.length);
    expect(new Set(all).size).toBe(LITTER_IDS.length * 4 * 3);
    for (const frame of all) {
      const f = FRAME[frame];
      expect([f.atlas, f.w, f.h, f.px, f.py]).toEqual(['items', 16, 16, 8, 8]);
    }
    expect(() => litterFrame(LITTER_IDS.length, 0, 0, 0)).toThrow(/litter kind/);
  });
});

describe('stain frames', () => {
  it('picks a stable variant of the stain kind from its position, in the world atlas', () => {
    expect(STAIN_FRAMES.map((v) => v.length)).toEqual([3, 2, 2, 3, 2]); // gum, milkshake, oil, chalk art, splat
    for (let kind = 0; kind < STAIN_IDS.length; kind++) {
      const used = new Set<FrameId>();
      for (let i = 0; i < 64; i++) {
        const frame = stainFrame(kind, 3.1 + i * 0.37, 7.9 + i * 0.53);
        expect(frame.startsWith(`${STAIN_IDS[kind]}:v:-:`)).toBe(true);
        expect(FRAME[frame].atlas).toBe('world');
        expect(stainFrame(kind, 3.1 + i * 0.37, 7.9 + i * 0.53)).toBe(frame);
        used.add(frame);
      }
      // Every variant turns up over a spread of positions.
      expect(used.size).toBe(STAIN_FRAMES[kind]?.length);
    }
    expect(() => stainFrame(STAIN_IDS.length, 0, 0)).toThrow(/stain kind/);
  });
});

describe('brush overlay spin (ART_BIBLE §10.2)', () => {
  function frames(rpm: number, ticks: number): number[] {
    const spin = createBrushSpin();
    const out = [advanceBrushSpin(spin, rpm, 0)];
    for (let t = 1; t <= ticks; t++) out.push(advanceBrushSpin(spin, rpm, 1));
    return out;
  }

  it('shows each of the 4 frames for 3 ticks at 100% RPM', () => {
    expect([BRUSH_SPIN_FRAME_COUNT, BRUSH_TICKS_PER_FRAME_FULL_RPM, BRUSH_SPIN_MIN_RPM]).toEqual([4, 3, 0.1]);
    expect(frames(1, 14)).toEqual([0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 0, 0, 0]);
  });

  it('scales the frame time by 1/RPM: 6 ticks at 50%, 9 at 1/3 (no rounding slip), 30 at 10%', () => {
    expect(frames(0.5, 25)).toEqual(Array.from({ length: 26 }, (_, t) => Math.floor(t / 6) % 4));
    expect(frames(1 / 3, 37)).toEqual(Array.from({ length: 38 }, (_, t) => Math.floor(t / 9) % 4));
    expect(frames(12 / 36, 37)).toEqual(Array.from({ length: 38 }, (_, t) => Math.floor(t / 9) % 4));
    expect(frames(0.1, 121)).toEqual(Array.from({ length: 122 }, (_, t) => Math.floor(t / 30) % 4));
  });

  it('is frozen on frame 0 below 10% RPM, and settles there when the brush spins down', () => {
    expect(frames(0.099, 600).every((f) => f === 0)).toBe(true);
    expect(frames(0, 600).every((f) => f === 0)).toBe(true);
    const spin = createBrushSpin();
    advanceBrushSpin(spin, 1, 7);
    expect(spin.frame).toBe(2);
    expect(advanceBrushSpin(spin, 0.05, 1)).toBe(0);
    // Spinning up again starts from frame 0.
    expect(advanceBrushSpin(spin, 1, 2)).toBe(0);
    expect(advanceBrushSpin(spin, 1, 1)).toBe(1);
  });

  it('advances by the sim ticks between frames (brushSpinFrameAt), not per render', () => {
    const spin = createBrushSpin();
    expect(brushSpinFrameAt(spin, 100, 1)).toBe(0); // first frame: records the tick
    expect(brushSpinFrameAt(spin, 100, 1)).toBe(0); // a second render of the same tick
    expect(brushSpinFrameAt(spin, 103, 1)).toBe(1);
    expect(brushSpinFrameAt(spin, 109, 1)).toBe(3);
    expect(brushSpinFrameAt(spin, 115, 0.5)).toBe(0); // 6 ticks at 50% = one frame
    expect(brushSpinFrameAt(spin, 10, 1)).toBe(0); // an earlier tick (a new shift) restarts
  });
});

describe('camera ground rect', () => {
  it('covers the whole (W+2)×272 target at the camera height, centred on the snapped camera', () => {
    const rig = createCameraRig(480);
    pinCameraRig(rig, 40.03, 20.01, 31.5);
    const rect = cameraGroundRect(rig, 0, box(0, 0, 0, 0));
    const pxPerM = groundPxPerMetre(31.5);
    expect(rect.maxX - rect.minX).toBeCloseTo(rtWidthPx(480) / pxPerM, 9);
    expect(rect.maxY - rect.minY).toBeCloseTo(RT_HEIGHT_PX / pxPerM, 9);
    expect((rect.minX + rect.maxX) / 2).toBeCloseTo(rig.snappedX, 9);
    expect((rect.minY + rect.maxY) / 2).toBeCloseTo(rig.snappedZ, 9);
    const grown = cameraGroundRect(rig, 4, box(0, 0, 0, 0));
    expect(grown.minX).toBeCloseTo(rect.minX - 4, 9);
    expect(grown.maxY).toBeCloseTo(rect.maxY + 4, 9);
  });
});

describe('ItemsBatch culling (TECHNICAL_DESIGN §12.5)', () => {
  const level = createBlankLevel('district.test', 64, 64); // 128 m square
  const camera = box(40, 30, 70, 47); // a camera ground rect

  function litterAt(points: readonly (readonly [number, number])[]): LitterField {
    const field = createLitterField(level, DEFAULT_TUNING, DEFAULT_ENTITIES, 64);
    for (const [x, y] of points) expect(addLitter(field, CRISP, x, y, 0)).toBeGreaterThanOrEqual(0);
    return field;
  }

  it('writes only the litter inside the camera rect + 4 m (edges inclusive) to the instance buffer', async () => {
    const inside: [number, number][] = [
      [55, 38],
      [36, 26], // the grown rect's NW corner
      [74, 51], // its SE corner
      [36.01, 40],
      [73.99, 40],
      [55, 26.5],
      [55, 50.9],
    ];
    const outside: [number, number][] = [
      [35.99, 40],
      [74.01, 40],
      [55, 25.99],
      [55, 51.01],
      [10, 10],
      [120, 120],
      [0, 0],
    ];
    const field = litterAt([...outside.slice(0, 3), ...inside, ...outside.slice(3)]);
    const batch = await newBatch(level);
    batch.update(field, createStainStore(DEFAULT_ENTITIES, 16, 64), 0, 1, camera, 38.5);
    expect(batch.cullRect).toEqual(box(36, 26, 74, 51));
    expect(ITEMS_CULL_MARGIN_M).toBe(4);
    const drawn = instances(batch).map((i) => [i.x, i.y]);
    expect(drawn.sort()).toEqual(inside.map(([x, y]) => [Math.fround(x), Math.fround(y)]).sort());
    expect(batch.litterDrawn).toBe(inside.length);
    expect(batch.batch.count).toBe(inside.length);
    expect(batch.batch.mesh.count).toBe(inside.length);
    // The same items, in the same order, as the sim's own hash query, which the view query leaves untouched.
    const hits = new Int32Array(64);
    const before = field.lastQueryCells;
    const n = queryLitterView(field, batch.cullRect, hits);
    expect(field.lastQueryCells).toBe(before);
    const simHits = new Int32Array(64);
    expect(queryLitter(field, batch.cullRect, simHits)).toBe(n);
    expect(Array.from(simHits.subarray(0, n))).toEqual(Array.from(hits.subarray(0, n)));
  });

  it('follows the camera: a moved rect writes the other set, and nothing when no item is in view', async () => {
    const field = litterAt([
      [10, 10],
      [100, 100],
    ]);
    const batch = await newBatch(level);
    const stains = createStainStore(DEFAULT_ENTITIES, 16, 64);
    batch.update(field, stains, 0, 1, box(0, 0, 20, 20), 10);
    expect(instances(batch).map((i) => [i.x, i.y])).toEqual([[10, 10]]);
    batch.update(field, stains, 0, 1, box(90, 90, 110, 110), 100);
    expect(instances(batch).map((i) => [i.x, i.y])).toEqual([[100, 100]]);
    batch.update(field, stains, 0, 1, box(40, 40, 60, 60), 50);
    expect(batch.batch.count).toBe(0);
    expect(batch.batch.mesh.count).toBe(0);
  });

  it('culls stains with the same rect and draws them from the world atlas on the decal layer', async () => {
    const stains: StainStore = createStainStore(DEFAULT_ENTITIES, 16, 64);
    addStain(stains, 0, 50, 40); // gum, inside
    addStain(stains, 4, 73.5, 50.5); // splat, inside the margin
    addStain(stains, 2, 80, 40); // oil, outside
    const field = litterAt([[55, 38]]);
    const batch = await newBatch(level);
    batch.update(field, stains, 0, 1, camera, 38.5);
    const drawn = instances(batch);
    expect(batch.stainsDrawn).toBe(2);
    expect(drawn).toHaveLength(3);
    const [gum, splat, crisp] = drawn;
    expect(gum).toMatchObject({ x: 50, y: 40, layer: DepthLayer.Decal, atlas: 1 });
    expect(gum?.rect).toEqual(rectOf(stainFrame(0, 50, 40)));
    expect(splat).toMatchObject({ x: 73.5, y: 50.5, layer: DepthLayer.Decal, atlas: 1 });
    expect(crisp).toMatchObject({ x: 55, y: 38, layer: DepthLayer.Litter, atlas: 0 });
    expect(crisp?.rect).toEqual(rectOf('litter.crisp_packet:idle:h00:0'));
  });
});

describe('ItemsBatch frames and interpolation', () => {
  const level = createBlankLevel('district.test', 32, 32);
  const camera = box(0, 0, 64, 64);

  it('draws each item at prev + (x − prev) · alpha with its rotation and wobble frame', async () => {
    const field = createLitterField(level, DEFAULT_TUNING, DEFAULT_ENTITIES, 8);
    for (let rot = 0; rot < 4; rot++) addLitter(field, DOG_MESS, 10 + rot * 4, 10, rot);
    field.prevX[0] = 9;
    field.prevY[0] = 11;
    field.flags[1] = LitterFlag.InSuction;
    // A flung item draws at its arc position (its x/y), flat on the ground like any other.
    field.flags[2] = LitterFlag.Flung;
    const batch = await newBatch(level, 8, 4);
    const stains = createStainStore(DEFAULT_ENTITIES, 4, 8);
    batch.update(field, stains, 12, 0.25, camera, 10);
    const drawn = instances(batch);
    expect(drawn.map((i) => [i.x, i.y])).toEqual([
      [9.25, 10.75],
      [14, 10],
      [18, 10],
      [22, 10],
    ]);
    expect(drawn.map((i) => i.rect)).toEqual([
      rectOf('litter.dog_mess:idle:h00:0'),
      rectOf('litter.dog_mess:wobble:h08:1'),
      rectOf('litter.dog_mess:idle:h16:0'),
      rectOf('litter.dog_mess:idle:h24:0'),
    ]);
    // Rotation is a frame choice, never a quad rotation; every item is on the litter layer.
    expect(drawn.every((i) => i.turns === 0 && i.layer === DepthLayer.Litter && i.atlas === 0)).toBe(true);
    // alpha is clamped to [0, 1].
    batch.update(field, stains, 0, 3, camera, 10);
    expect(instances(batch)[0]).toMatchObject({ x: 10, y: 10 });
    batch.update(field, stains, 0, -1, camera, 10);
    expect(instances(batch)[0]).toMatchObject({ x: 9, y: 11 });
  });
});

describe('static markers from the compiled level', () => {
  it('places Puddle Lane hydrants, the skip and both depot bays on their props and sites', () => {
    const markers = levelItemMarkers(PUDDLE_LANE);
    expect(markers).toEqual([
      { frame: HYDRANT_FRAME, xM: 77, yM: 7, layer: DepthLayer.Litter, quarterTurns: 0 },
      { frame: HYDRANT_FRAME, xM: 51, yM: 15, layer: DepthLayer.Litter, quarterTurns: 0 },
      // site.skip [38, 31, 40, 32]: 4 × 2 m centred at (78, 63).
      { frame: 'site.skip:flat:-:0', xM: 78, yM: 63, layer: DepthLayer.Litter, quarterTurns: 0 },
      // site.depot_bay [6, 42, 8, 45] and [9, 42, 11, 45]: 4 × 6 m bays, road markings on the decal layer.
      { frame: 'site.depot_bay:flat:-:0', xM: 14, yM: 87, layer: DepthLayer.Decal, quarterTurns: 0 },
      { frame: 'site.depot_bay:flat:-:0', xM: 20, yM: 87, layer: DepthLayer.Decal, quarterTurns: 0 },
    ]);
  });

  it('quarter-turns a site rect laid on its side and refuses one that fits neither way', () => {
    const level = createBlankLevel('district.test', 32, 32);
    level.props.push({ id: 'prop.hydrant', x: 3, y: 4, rot: Math.PI / 2 });
    level.props.push({ id: 'prop.bench', x: 5, y: 5, rot: 0 });
    level.sites.push({ id: 'site.skip', rect: [2, 2, 3, 4] }); // 1 × 2 tiles: the skip turned north–south
    level.sites.push({ id: 'site.zebra', rect: [5, 5, 7, 6] }); // ground, no marker
    expect(levelItemMarkers(level)).toEqual([
      { frame: HYDRANT_FRAME, xM: 3, yM: 4, layer: DepthLayer.Litter, quarterTurns: 1 },
      { frame: 'site.skip:flat:-:0', xM: 5, yM: 6, layer: DepthLayer.Litter, quarterTurns: 1 },
    ]);
    level.sites.push({ id: 'site.depot_bay', rect: [10, 10, 13, 13] });
    expect(() => levelItemMarkers(level)).toThrow(
      /site.depot_bay .* is 96×96 px, but site.depot_bay:flat:-:0 is 64×96/,
    );
  });

  it('draws the markers in view with their frames, turns and layers', async () => {
    const batch = await newBatch(PUDDLE_LANE, 4, 4);
    const field = createLitterField(PUDDLE_LANE, DEFAULT_TUNING, DEFAULT_ENTITIES, 4);
    const stains = createStainStore(DEFAULT_ENTITIES, 4, 4);
    batch.update(field, stains, 0, 1, box(-8, 80, 22, 97), 89); // the depot start's view
    expect(batch.markersDrawn).toBe(2);
    expect(instances(batch)).toEqual([
      { x: 14, y: 87, turns: 0, layer: DepthLayer.Decal, atlas: 0, rect: rectOf('site.depot_bay:flat:-:0') },
      { x: 20, y: 87, turns: 0, layer: DepthLayer.Decal, atlas: 0, rect: rectOf('site.depot_bay:flat:-:0') },
    ]);
    batch.update(field, stains, 0, 1, box(36, 2, 92, 20), 11); // both hydrants
    expect(instances(batch).map((i) => [i.x, i.y, i.layer])).toEqual([
      [77, 7, DepthLayer.Litter],
      [51, 15, DepthLayer.Litter],
    ]);
    expect(instances(batch)[0]?.rect).toEqual(rectOf(HYDRANT_FRAME));
  });
});

describe('the items draw', () => {
  it('is one mesh after the shadows, sampling items and world, keeping the shadow mask under its texels', async () => {
    const batch = await newBatch(PUDDLE_LANE);
    expect(batch.mesh.name).toBe('items');
    expect(batch.mesh.renderOrder).toBe(ITEMS_RENDER_ORDER);
    expect(ITEMS_RENDER_ORDER).toBeGreaterThan(2); // after Bessie's drop shadow (2) and the building shadows (1)
    expect(batch.mesh.frustumCulled).toBe(false);
    expect(batch.batch.receiveShadows).toBe(true);
    expect(batch.batch.secondaryAtlas?.name).toBe('world');
    // Capacity: every litter slot, every stain slot and the 5 Puddle Lane markers.
    expect(batch.batch.capacity).toBe(64 + 16 + 5);
    const material = batch.mesh.material as unknown as {
      fragmentShader: string;
      blendSrc: number;
      blendDst: number;
      blendSrcAlpha: number;
      blendDstAlpha: number;
      uniforms: Record<string, { value: unknown }>;
    };
    // The mask's alpha carries the write: 0 keeps the shadow, a Lit sprite writes (0, 1).
    expect(material.fragmentShader).toContain('outMask = vec4(0.0, vLit, 0.0, vLit)');
    expect(material.fragmentShader).toContain(
      'vAtlas == 0 ? indexAt(uAtlas, texel) : indexAt(uAtlas1, texel)',
    );
    expect(material.uniforms.uAtlas?.value).toBe((await atlas('items')).texture);
    expect(material.uniforms.uAtlas1?.value).toBe((await atlas('world')).texture);
    expect(material.uniforms.uSwap1?.value).toBe((await atlas('world')).swapTexture);
    expect(() => batch.batch.add('npc.old_woman:idle:s:0', 0, 0, DepthLayer.Litter)).toThrow(
      /atlas 'actors', not 'items' or 'world'/,
    );
    batch.dispose();
  });

  it('refuses the wrong atlases', async () => {
    await expect(newBatch(PUDDLE_LANE)).resolves.toBeInstanceOf(ItemsBatch);
    expect(() => new ItemsBatch(PUDDLE_LANE_ATLAS_STUB, PUDDLE_LANE_ATLAS_STUB, PUDDLE_LANE)).toThrow(
      /items atlas/,
    );
  });
});

/** A stand-in with the wrong name: the constructor rejects it before reading anything else. */
const PUDDLE_LANE_ATLAS_STUB = { name: 'actors' } as unknown as SpriteAtlas;

describe('update path allocates nothing', () => {
  const NEW_RE = /\bnew\s+[A-Za-z_$]/;
  const ARRAY_LITERAL_RE = /(?:[=(,?:]|\breturn)\s*\[/;
  const OBJECT_LITERAL_RE = /(?:[=(,?:]|\breturn)\s*\{/;
  const regions = (file: string): string[] => {
    const source = readFileSync(`${REPO_ROOT}${file}`, 'utf8');
    const parts = source.split('// per-frame draw path: begin').slice(1);
    return parts.map((part) => {
      const end = part.indexOf('// per-frame draw path: end');
      if (end < 0) throw new Error(`${file}: unterminated per-frame region`);
      return part.slice(0, end);
    });
  };

  it.each([['src/render/itemsBatch.ts'], ['src/render/spriteBatch.ts']])(
    '%s: no `new`, array or object literals in the per-frame region',
    (file) => {
      const found = regions(file);
      expect(found.length, 'marked regions').toBeGreaterThan(0);
      for (const region of found) {
        const lines = region
          .split('\n')
          .filter(
            (l) => !l.trim().startsWith('*') && !l.trim().startsWith('//') && !l.trim().startsWith('/**'),
          );
        expect(lines.filter((l) => NEW_RE.test(l))).toEqual([]);
        expect(lines.filter((l) => ARRAY_LITERAL_RE.test(l))).toEqual([]);
        expect(lines.filter((l) => OBJECT_LITERAL_RE.test(l))).toEqual([]);
      }
    },
  );

  it('the scanner flags what it should', () => {
    expect(OBJECT_LITERAL_RE.test('const r = { minX: 0 };')).toBe(true);
    expect(OBJECT_LITERAL_RE.test('f({ a: 1 });')).toBe(true);
    expect(OBJECT_LITERAL_RE.test('return { x };')).toBe(true);
    expect(OBJECT_LITERAL_RE.test('  ): void {')).toBe(false);
    expect(OBJECT_LITERAL_RE.test('    if (!inside(rect, x, y)) continue;')).toBe(false);
    expect(ARRAY_LITERAL_RE.test('const xs = [1, 2];')).toBe(true);
  });

  it('a Puddle Lane frame with litter, stains, markers and wobble keeps the heap flat', async () => {
    const world = createWorld(PUDDLE_LANE, 1, DEFAULT_TUNING);
    // Stains in view, and a third of the visible litter in suction so the wobble frames are drawn too.
    addStain(world.stains, 0, 50, 13);
    addStain(world.stains, 4, 56, 12);
    for (let i = 0; i < world.litter.count; i += 3) world.litter.flags[i] = LitterFlag.InSuction;
    const batch = new ItemsBatch(await atlas('items'), await atlas('world'), PUDDLE_LANE, {
      litterCapacity: world.litter.capacity,
      stainCapacity: world.stains.capacity,
    });
    const rig = createCameraRig(480);
    pinCameraRig(rig, 64, 11, 37.8);
    const camera = cameraGroundRect(rig, 0, box(0, 0, 0, 0));
    const camY = rig.snappedZ;
    batch.update(world.litter, world.stains, 0, 0.5, camera, camY);
    expect(batch.litterDrawn).toBeGreaterThan(10);
    expect(batch.stainsDrawn).toBe(2);
    expect(batch.markersDrawn).toBe(2); // both hydrants
    // Every rotation is on screen in this view (the e2e frame of the same view is the visual evidence).
    const rots = new Set<number>();
    const hits = new Int32Array(world.litter.capacity);
    const n = queryLitterView(world.litter, batch.cullRect, hits);
    for (let k = 0; k < n; k++) rots.add(world.litter.rot[hits[k] as number] as number);
    expect([...rots].sort()).toEqual([0, 1, 2, 3]);
    // The tick is a small integer (no boxing), the alpha a fixed fraction, as in the spriteBatch heap test.
    const delta = measureHeapDelta(
      (tick) => batch.update(world.litter, world.stains, tick, 0.5, camera, camY),
      {
        warmupTicks: RENDER_WARMUP_FRAMES,
      },
    );
    assertHeapDeltaWithinThresholds(delta);
  });
});
