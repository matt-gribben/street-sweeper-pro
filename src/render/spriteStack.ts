// Sprite stacks (TECHNICAL_DESIGN §12.5, ART_BIBLE §4.1, §6.4): tall thin props drawn as horizontal slice quads
// at increasing REAL heights in the items batch. Nobody authors their lean: a slice at height h is magnified by
// H / (H − h) about the camera axis like a roof at that height, so the perspective camera leans the stack away
// from the screen centre in step with the buildings, and with the camera straight over the prop every slice
// lands on the same pixel (no wobbling stack, ART_BIBLE §15.2). Flat actors never lean.
//
// A slice's real depth also orders it: anything about 0.4 m or more up is nearer the camera than every flat
// layer's depth offset (worldMaterial.ts; the lowest lamp slice is at 0.6 m), so slices draw over flat actors,
// higher slices over lower ones, and walls and roofs in front of a slice still hide it. The depth layer passed
// with each slice only breaks a tie with flat sprites at height 0.
//
// SSP-020 (M0 spike): `prop.lamp_post`, 4 slices rendered in Blender (assets-src/blender/props/lamp_post.py),
// is the only stack. Slice counts per prop and which slices cast drop shadows are recorded in ROADMAP §8
// (D-02 input) and ART_BIBLE §6.4 / §8.6.
import type { AssetId, FrameId } from '../gen/assets.ts';
import { type DropShadowBatch, type SpriteBatch, SpriteFlag } from './spriteBatch.ts';
import { DepthLayer } from './worldMaterial.ts';

/** One slice of a stack. */
export type StackSlice = {
  readonly frame: FrameId;
  /**
   * Height of the slice quad above the ground, metres: the TOP of the band the slice was rendered from, where
   * its caps are. Keep these equal to the band tops in the prop's Blender script (unit-tested).
   */
  readonly heightM: number;
  /** Whether this slice casts the +2, +2 drop shadow at its own height (ART_BIBLE §6.4). */
  readonly castsShadow: boolean;
  /**
   * This slice is the lamp head that writes the light mask (ART_BIBLE §8.6, §13): it is drawn with
   * `SpriteFlag.Lit`, so the night remap never darkens it (SSP-021).
   */
  readonly lightsAtNight: boolean;
};

/** A prop drawn as a sprite stack: its slices, from the ground upward. */
export type SpriteStack = {
  readonly asset: AssetId;
  readonly slices: readonly StackSlice[];
};

/** Depth layer of stack slices in the items batch (only a tie-breaker; slices sort by real height). */
export const STACK_LAYER = DepthLayer.Litter;

/**
 * `prop.lamp_post`: 4 slices, bands 0–0.6 m (plinth), 0.6–2.4 m (lower post), 2.4–3.6 m (upper post and
 * crossbar) and 3.6–4.4 m (lantern), drawn at the band tops. The tops have an even tenths digit, so
 * H − top = 31.5 m − top has an odd one: for a camera centred on the post, a pixel centre half a pixel off the
 * axis then never maps exactly onto a texel edge ((2p + 1) / 2 × (H − top) / H is never a whole number; the
 * nearest is 1/210 texel away), so no centred slice texel depends on how a GPU rounds a tie. Only the plinth and
 * the lantern cast drop shadows (SSP-020).
 */
export const LAMP_POST_STACK: SpriteStack = {
  asset: 'prop.lamp_post',
  slices: [
    { frame: 'prop.lamp_post:slice:-:0', heightM: 0.6, castsShadow: true, lightsAtNight: false },
    { frame: 'prop.lamp_post:slice:-:1', heightM: 2.4, castsShadow: false, lightsAtNight: false },
    { frame: 'prop.lamp_post:slice:-:2', heightM: 3.6, castsShadow: false, lightsAtNight: false },
    { frame: 'prop.lamp_post:slice:-:3', heightM: 4.4, castsShadow: true, lightsAtNight: true },
  ],
};

/**
 * The knockable props' stacks (SSP-103; the SSP-101 placeholder grids, 4 slices each per STYLE.md v1 §8). The
 * grids carry no band heights, so the slices are drawn at the tops of four bands of a top height chosen near the
 * STYLE.md §8 nominal (wheelie bin 1.1 m → 1.0 m, cone 0.75 m → 0.8 m, A-board 0.9 m → 0.8 m), on even tenths like
 * the lamp post's (see LAMP_POST_STACK on texel ties). Only the lowest and highest slices cast (ART_BIBLE §6.4).
 * SSP-148 (M4) renders the final props and fixes the bands with their scripts.
 */
export const WHEELIE_BIN_STACK: SpriteStack = {
  asset: 'prop.wheelie_bin',
  slices: [
    { frame: 'prop.wheelie_bin:slice:-:0', heightM: 0.2, castsShadow: true, lightsAtNight: false },
    { frame: 'prop.wheelie_bin:slice:-:1', heightM: 0.4, castsShadow: false, lightsAtNight: false },
    { frame: 'prop.wheelie_bin:slice:-:2', heightM: 0.8, castsShadow: false, lightsAtNight: false },
    { frame: 'prop.wheelie_bin:slice:-:3', heightM: 1.0, castsShadow: true, lightsAtNight: false },
  ],
};

/** `prop.traffic_cone`: see WHEELIE_BIN_STACK. */
export const TRAFFIC_CONE_STACK: SpriteStack = {
  asset: 'prop.traffic_cone',
  slices: [
    { frame: 'prop.traffic_cone:slice:-:0', heightM: 0.2, castsShadow: true, lightsAtNight: false },
    { frame: 'prop.traffic_cone:slice:-:1', heightM: 0.4, castsShadow: false, lightsAtNight: false },
    { frame: 'prop.traffic_cone:slice:-:2', heightM: 0.6, castsShadow: false, lightsAtNight: false },
    { frame: 'prop.traffic_cone:slice:-:3', heightM: 0.8, castsShadow: true, lightsAtNight: false },
  ],
};

/** `prop.a_board`: see WHEELIE_BIN_STACK. */
export const A_BOARD_STACK: SpriteStack = {
  asset: 'prop.a_board',
  slices: [
    { frame: 'prop.a_board:slice:-:0', heightM: 0.2, castsShadow: true, lightsAtNight: false },
    { frame: 'prop.a_board:slice:-:1', heightM: 0.4, castsShadow: false, lightsAtNight: false },
    { frame: 'prop.a_board:slice:-:2', heightM: 0.6, castsShadow: false, lightsAtNight: false },
    { frame: 'prop.a_board:slice:-:3', heightM: 0.8, castsShadow: true, lightsAtNight: false },
  ],
};

/** Slices `stack` adds to the items batch. */
export function stackSliceCount(stack: SpriteStack): number {
  return stack.slices.length;
}

/** Drop shadows `stack` adds to the drop-shadow batch. */
export function stackShadowCount(stack: SpriteStack): number {
  let n = 0;
  for (const slice of stack.slices) if (slice.castsShadow) n++;
  return n;
}

/**
 * Adds every slice of `stack` standing at sim (xM, yM) to `sprites` (the items batch), bottom slice first (a
 * `lightsAtNight` slice flagged `Lit`), and the drop shadows of its shadow-casting slices to `shadows` (pass null
 * to skip shadows). Allocates nothing.
 */
export function addSpriteStack(
  stack: SpriteStack,
  xM: number,
  yM: number,
  sprites: SpriteBatch,
  shadows: DropShadowBatch | null,
): void {
  const slices = stack.slices;
  for (let i = 0; i < slices.length; i++) {
    const slice = slices[i];
    if (slice === undefined) continue;
    sprites.addAtHeight(
      slice.frame,
      xM,
      yM,
      slice.heightM,
      STACK_LAYER,
      slice.lightsAtNight ? SpriteFlag.Lit : 0,
    );
    if (shadows !== null && slice.castsShadow) shadows.addAtHeight(slice.frame, xM, yM, slice.heightM);
  }
}
