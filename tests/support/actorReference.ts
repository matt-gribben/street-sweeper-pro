// A CPU reference for the street's actors (SSP-103): runs the same seeded World in Node, writes the shift's actors
// batch exactly as ShiftScene does (Bessie, then StreetActors) for a camera pinned at (camX, camY) and the sweep
// height, and composites the batch's instances into a palette-index image of the internal frame: what the GPU
// frame must show wherever an actor is drawn and nothing nearer (a wall, a roof, a raised slice, the HUD) covers
// it. Flat layers at H = 31.5 m draw 1:1, so ground pixel p lies on frame column W/2 + p − camX·16 (rows alike).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DataTexture, RedFormat, UnsignedByteType } from 'three';
import { type BessieSprite, createBessieSprite } from '../../src/render/bessieSprite.ts';
import { brushSpinFrameAt, createBrushSpin } from '../../src/render/brushSpin.ts';
import { cameraGroundRect, createCameraRig, pinCameraRig } from '../../src/render/camera.ts';
import { createPose, interpolatePose } from '../../src/render/interpolate.ts';
import {
  indexAtlasPixels,
  type SpriteAtlas,
  swapTableData,
  validateAtlasJson,
} from '../../src/render/spriteAtlas.ts';
import { INSTANCE_STRIDE, SpriteFlag } from '../../src/render/spriteBatch.ts';
import { StreetActors, streetSpriteCapacity } from '../../src/render/streetActors.ts';
import { INTERNAL_HEIGHT_PX } from '../../src/render/upscale.ts';
import { PX_PER_M } from '../../src/sim/constants.ts';
import { createInputFrame } from '../../src/sim/inputFrame.ts';
import { decodeLevel, type Level } from '../../src/sim/map.ts';
import { DEFAULT_TUNING } from '../../src/sim/tuning.ts';
import { createWorld, type World } from '../../src/sim/world.ts';
import { decodePng } from './png.ts';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** Compiled Puddle Lane. */
export function puddleLaneLevel(): Level {
  return decodeLevel(readFileSync(`${REPO_ROOT}public/assets/levels/puddle_lane.json`, 'utf8'));
}

/**
 * The committed actors atlas, indexed and validated as loadAtlas does it (built here because loadAtlas's URL
 * default reads Vite's import.meta.env, which Playwright's Node side has not got).
 */
export function actorsAtlas(): SpriteAtlas {
  const json: unknown = JSON.parse(readFileSync(`${REPO_ROOT}public/assets/atlas/actors.json`, 'utf8'));
  const image = decodePng(readFileSync(`${REPO_ROOT}public/assets/atlas/actors.png`));
  const indices = indexAtlasPixels('actors', image);
  validateAtlasJson('actors', json, image.width, image.height);
  const swaps = swapTableData('actors', (json as { swaps?: unknown }).swaps);
  return {
    name: 'actors',
    width: image.width,
    height: image.height,
    indices,
    texture: new DataTexture(indices, image.width, image.height, RedFormat, UnsignedByteType),
    swaps,
    swapTexture: new DataTexture(swaps, 32, 8, RedFormat, UnsignedByteType),
  };
}

/** `level` run `ticks` World ticks from `seed` with no input (the `tick=<n>` test hook's run). */
export function idleWorld(level: Level, seed: number, ticks: number): World {
  const world = createWorld(level, seed >>> 0, DEFAULT_TUNING);
  const input = createInputFrame();
  for (let t = 0; t < ticks; t++) world.step(input);
  return world;
}

/** The actors batch of one frame, as ShiftScene writes it. */
export type ActorFrame = {
  readonly bessie: BessieSprite;
  readonly street: StreetActors;
  /** Instance data (INSTANCE_STRIDE floats each) and count of the actors batch. */
  readonly data: Float32Array;
  readonly count: number;
};

/** Writes the actors batch of `world` at render `alpha` for a camera pinned at (camX, camY, heightM). */
export function actorFrame(
  world: World,
  atlas: SpriteAtlas,
  camX: number,
  camY: number,
  heightM: number,
  widthPx: number,
  alpha: number,
): ActorFrame {
  const rig = createCameraRig(widthPx);
  pinCameraRig(rig, camX, camY, heightM);
  const capacity = streetSpriteCapacity(world.npc.capacity, world.vehicles.capacity);
  const bessie = createBessieSprite(atlas, DEFAULT_TUNING.vehicle.sweeper.health.dentedBelowHp, {
    extraSprites: capacity,
    extraShadows: capacity,
  });
  const street = new StreetActors(atlas, {
    npcCapacity: world.npc.capacity,
    vehicleCapacity: world.vehicles.capacity,
    seed: world.seed,
  });
  const pose = createPose();
  interpolatePose(world.vehicle, alpha, pose);
  const rect = cameraGroundRect(rig, 0, { minX: 0, minY: 0, maxX: 0, maxY: 0 });
  const spin = brushSpinFrameAt(createBrushSpin(), world.tick, world.vehicle.rpm);
  bessie.begin(rig.snappedZ);
  bessie.add(pose, world.vehicle.hp, world.vehicle.brushDown, spin);
  street.update(world.npc, world.vehicles, alpha, rect, pose, bessie.sprites, bessie.shadows);
  bessie.end();
  return { bessie, street, data: bessie.sprites.instanceData, count: bessie.sprites.count };
}

/** Palette index per frame pixel (−1 where no actor is drawn), row-major W × INTERNAL_HEIGHT_PX. */
export type IndexImage = { readonly width: number; readonly height: number; readonly index: Int16Array };

/**
 * Composites `frame`'s instances (painter's order: depth layer × 8 + sort bias, later instances winning ties, as
 * the depth test LessEqual does) into an index image for a camera whose snapped focus is (camX, camY) metres at
 * the sweep height. Only unrotated, unmirrored frames and Solid rectangles (all the street draws) are handled.
 */
export function compositeActors(
  frame: ActorFrame,
  atlas: SpriteAtlas,
  camX: number,
  camY: number,
  widthPx: number,
): IndexImage {
  const height = INTERNAL_HEIGHT_PX;
  const index = new Int16Array(widthPx * height).fill(-1);
  const d = frame.data;
  const order = Array.from({ length: frame.count }, (_, k) => k);
  const key = (k: number): number =>
    (d[k * INSTANCE_STRIDE + 12] as number) * 8 + (d[k * INSTANCE_STRIDE + 13] as number);
  order.sort((a, b) => key(a) - key(b) || a - b);
  const camPxX = Math.round(camX * PX_PER_M);
  const camPxY = Math.round(camY * PX_PER_M);
  for (const k of order) {
    const o = k * INSTANCE_STRIDE;
    const ax = Math.floor((d[o] as number) * PX_PER_M + 0.5);
    const ay = Math.floor((d[o + 2] as number) * PX_PER_M + 0.5);
    const rx = d[o + 4] as number;
    const ry = d[o + 5] as number;
    const rw = d[o + 6] as number;
    const rh = d[o + 7] as number;
    const pivX = d[o + 8] as number;
    const pivY = d[o + 9] as number;
    const flags = d[o + 11] as number;
    if ((d[o + 3] as number) !== 0 || (flags & SpriteFlag.MirrorX) !== 0) {
      throw new Error(`instance ${k} is rotated or mirrored: the reference does not draw it`);
    }
    const solid = (flags & SpriteFlag.Solid) !== 0;
    const swapRow = Math.min(7, Math.max(0, d[o + 10] as number));
    for (let ty = 0; ty < rh; ty++) {
      for (let tx = 0; tx < rw; tx++) {
        const raw = solid ? rx : (atlas.indices[(ry + ty) * atlas.width + rx + tx] as number);
        if (raw === 255) continue;
        const value = atlas.swaps[swapRow * 32 + raw] as number;
        const sx = widthPx / 2 + ax + tx - pivX - camPxX;
        const sy = height / 2 + ay + ty - pivY - camPxY;
        if (sx < 0 || sy < 0 || sx >= widthPx || sy >= height) continue;
        index[sy * widthPx + sx] = value;
      }
    }
  }
  return { width: widthPx, height, index };
}
