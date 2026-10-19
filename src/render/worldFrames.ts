// Frame lookups for the `world` atlas (SSP-045): ground tiles, kerb blobs, markings, facades and roofs are named
// by compiled level data at runtime (ground ids, autotile indices, roofIds/wallIds strings), so their frame IDs
// cannot all be compile-time literals. Every lookup here goes through the generated FRAME table and throws,
// naming the missing frame, rather than drawing nothing: a level that names an asset the atlas lacks fails at
// load (and in tests/unit/levelCity.test.ts), never silently.
import { FRAME, type FrameId } from '../gen/assets.ts';
import type { AtlasRect } from './cityMesh.ts';

/** The atlas every city frame must live in. */
export const CITY_ATLAS = 'world';

/** True when `id` names a generated frame. */
export function isFrameId(id: string): id is FrameId {
  return Object.hasOwn(FRAME, id);
}

/** The frame `<asset>:<state>:-:<n>`; throws when the generated table has no such frame. */
export function worldFrame(asset: string, state: string, n: number): FrameId {
  const id = `${asset}:${state}:-:${n}`;
  if (!isFrameId(id)) throw new Error(`missing frame ${id} (not in src/gen/assets.ts)`);
  if (FRAME[id].atlas !== CITY_ATLAS)
    throw new Error(`frame ${id} is in atlas '${FRAME[id].atlas}', not '${CITY_ATLAS}'`);
  return id;
}

/** Every variant frame `<asset>:<state>:-:0..n−1` (contiguous from 0); throws when there is none. */
export function worldFrameVariants(asset: string, state: string): FrameId[] {
  const frames: FrameId[] = [worldFrame(asset, state, 0)];
  for (let n = 1; isFrameId(`${asset}:${state}:-:${n}`); n++) frames.push(worldFrame(asset, state, n));
  return frames;
}

/** A frame's atlas rectangle (the interior cell, never the 1 px extrusion around it). */
export function frameRect(id: FrameId): AtlasRect {
  const frame = FRAME[id];
  return { x: frame.x, y: frame.y, w: frame.w, h: frame.h };
}
