// Sprite stacks (SSP-020; TECHNICAL_DESIGN §12.5, ART_BIBLE §4.1, §6.4, §15.2): the prop.lamp_post slice table
// against FRAME and its Blender bands, the per-instance heights the items batch receives, and the projection
// facts the spike checks: slices of a centred stack land on one pixel (no wobble), and off-centre stacks lean
// away from the screen centre in step with the buildings.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type InstancedMesh, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { FRAME } from '../../src/gen/assets.ts';
import { createCameraRig, pinCameraRig, SWEEP_HEIGHT_M } from '../../src/render/camera.ts';
import { loadAtlas, type RgbaImage, type SpriteAtlas } from '../../src/render/spriteAtlas.ts';
import { DropShadowBatch, INSTANCE_STRIDE, SpriteBatch, SpriteFlag } from '../../src/render/spriteBatch.ts';
import {
  addSpriteStack,
  LAMP_POST_STACK,
  STACK_LAYER,
  stackShadowCount,
  stackSliceCount,
} from '../../src/render/spriteStack.ts';
import { INTERNAL_HEIGHT_PX } from '../../src/render/upscale.ts';
import { DepthLayer } from '../../src/render/worldMaterial.ts';
import { LEAN_QUADRANTS } from '../../src/scenes/LeanQuadrantsScene.ts';
import { decodePng } from '../support/png.ts';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const W = 480;

async function load(name: 'actors' | 'items'): Promise<SpriteAtlas> {
  return loadAtlas(name, {
    fetchJson: async (url: string): Promise<unknown> =>
      JSON.parse(readFileSync(`${REPO_ROOT}public${url}`, 'utf8')),
    fetchImage: async (url: string): Promise<RgbaImage> =>
      decodePng(readFileSync(`${REPO_ROOT}public${url}`)),
  });
}

/** `SLICES = [(z0, z1), …]` from the lamp post's Blender script. */
function blenderBands(): [number, number][] {
  const text = readFileSync(`${REPO_ROOT}assets-src/blender/props/lamp_post.py`, 'utf8');
  const m = /^SLICES = \[(.*)\]$/m.exec(text);
  if (m === null) throw new Error('lamp_post.py has no one-line SLICES = [...] assignment');
  return [...(m[1] ?? '').matchAll(/\(\s*([\d.]+)\s*,\s*([\d.]+)\s*\)/g)].map((b) => [
    Number(b[1]),
    Number(b[2]),
  ]);
}

/** Internal pixel (fractional, top-left origin) of a world point for a camera pinned over (cx, cy). */
function projector(cx: number, cy: number): (xM: number, heightM: number, yM: number) => [number, number] {
  const rig = createCameraRig(W);
  pinCameraRig(rig, cx, cy, SWEEP_HEIGHT_M);
  return (xM, heightM, yM) => {
    const p = new Vector3(xM, heightM, yM).project(rig.camera);
    return [((p.x + 1) / 2) * (W + 2) - 1, ((1 - p.y) / 2) * (INTERNAL_HEIGHT_PX + 2) - 1];
  };
}

/** The sprite shader's anchor: the pivot snapped to the 1/16 m grid. */
const snap = (m: number): number => Math.floor(m * 16 + 0.5) / 16;

describe('prop.lamp_post stack table', () => {
  it('has 4 slices, k = 0 at the ground, each a 32 x 32 items frame pivoting on the cell centre', () => {
    expect(LAMP_POST_STACK.asset).toBe('prop.lamp_post');
    expect(stackSliceCount(LAMP_POST_STACK)).toBe(4);
    LAMP_POST_STACK.slices.forEach((slice, k) => {
      expect(slice.frame).toBe(`prop.lamp_post:slice:-:${k}`);
      const f = FRAME[slice.frame];
      expect([f.atlas, f.w, f.h, f.px, f.py]).toEqual(['items', 32, 32, 16, 16]);
    });
    const lampFrames = Object.keys(FRAME).filter((id) => id.startsWith('prop.lamp_post:'));
    expect(lampFrames).toHaveLength(4);
  });

  it('draws each slice at the top of its Blender band, bands contiguous from the ground', () => {
    const bands = blenderBands();
    expect(bands).toHaveLength(LAMP_POST_STACK.slices.length);
    expect(bands[0]?.[0]).toBe(0);
    bands.forEach(([z0, z1], k) => {
      expect(z1).toBeGreaterThan(z0);
      if (k > 0) expect(z0).toBe(bands[k - 1]?.[1]);
      expect(LAMP_POST_STACK.slices[k]?.heightM).toBe(z1);
    });
  });

  it('keeps every slice height on an even tenth, so a centred slice never puts a pixel centre on a texel edge', () => {
    for (const slice of LAMP_POST_STACK.slices) {
      const tenths = Math.round(slice.heightM * 10);
      expect(Math.abs(slice.heightM * 10 - tenths)).toBeLessThan(1e-9);
      expect(tenths % 2).toBe(0);
      // Pixel centres p + 0.5 px off the axis map to texel offsets (p + 0.5) (H − h) / H: never whole.
      const ratio = (SWEEP_HEIGHT_M - slice.heightM) / SWEEP_HEIGHT_M;
      for (let p = 0; p < 32; p++) {
        const t = (p + 0.5) * ratio;
        expect(Math.abs(t - Math.round(t))).toBeGreaterThan(1e-3);
      }
    }
  });

  it('casts drop shadows from the plinth and the lantern only, and marks the lantern as the night light', () => {
    expect(LAMP_POST_STACK.slices.map((s) => s.castsShadow)).toEqual([true, false, false, true]);
    expect(stackShadowCount(LAMP_POST_STACK)).toBe(2);
    expect(LAMP_POST_STACK.slices.map((s) => s.lightsAtNight)).toEqual([false, false, false, true]);
  });
});

describe('addSpriteStack', () => {
  it('writes the slices to the items batch at their real heights and the shadow slices to the drop-shadow batch', async () => {
    const items = await load('items');
    const sprites = new SpriteBatch(items, 4);
    const shadows = new DropShadowBatch([await load('actors'), items], 2);
    sprites.begin(0);
    shadows.begin(0);
    addSpriteStack(LAMP_POST_STACK, 4, -6.5, sprites, shadows);
    sprites.end();
    shadows.end();
    expect(sprites.mesh.count).toBe(4);
    expect(shadows.mesh.count).toBe(2);

    const read = (mesh: InstancedMesh, name: string, i: number, c: number): number =>
      mesh.geometry.getAttribute(name).getComponent(i, c);
    LAMP_POST_STACK.slices.forEach((slice, i) => {
      expect([0, 1, 2].map((c) => read(sprites.mesh, 'offset', i, c))).toEqual([
        4,
        Math.fround(slice.heightM),
        -6.5,
      ]);
      expect(read(sprites.mesh, 'layer', i, 0)).toBe(STACK_LAYER);
      expect(read(sprites.mesh, 'rotation', i, 0)).toBe(0);
      // The lantern is the night light (ART_BIBLE §8.6): it alone writes the light mask (SSP-021).
      expect(read(sprites.mesh, 'flags', i, 0)).toBe(slice.lightsAtNight ? SpriteFlag.Lit : 0);
    });
    expect([0, 1, 2, 3].map((i) => read(sprites.mesh, 'flags', i, 0))).toEqual([0, 0, 0, SpriteFlag.Lit]);
    const shadowHeights = [0, 1].map((i) => read(shadows.mesh, 'offset', i, 1));
    expect(shadowHeights).toEqual([Math.fround(0.6), Math.fround(4.4)]);
    expect([0, 1].map((i) => read(shadows.mesh, 'atlas', i, 0))).toEqual([1, 1]);
    expect([0, 1].map((i) => read(shadows.mesh, 'layer', i, 0))).toEqual([
      DepthLayer.DropShadow,
      DepthLayer.DropShadow,
    ]);
  });

  it('skips shadows when given none, and refuses a batch of the wrong atlas', async () => {
    const items = new SpriteBatch(await load('items'), 4);
    items.begin(0);
    addSpriteStack(LAMP_POST_STACK, 0, 0, items, null);
    expect(items.count).toBe(4);
    const actors = new SpriteBatch(await load('actors'), 4);
    actors.begin(0);
    expect(() => addSpriteStack(LAMP_POST_STACK, 0, 0, actors, null)).toThrow(/atlas 'items'/);
  });

  it('keeps flat sprites at height 0 and rejects a negative height', async () => {
    const items = new SpriteBatch(await load('items'), 2);
    items.begin(0);
    items.add('prop.lamp_post:slice:-:0', 1, 2, DepthLayer.Litter);
    expect(items.mesh.geometry.getAttribute('offset').getComponent(0, 1)).toBe(0);
    expect(() => items.addAtHeight('prop.lamp_post:slice:-:0', 0, 0, -0.1, STACK_LAYER)).toThrow(RangeError);
    expect(INSTANCE_STRIDE).toBe(16);
  });
});

describe('sprite-stack projection (ART_BIBLE §4.1, §15.2)', () => {
  it('stacks every slice on the same pixel when the camera is centred over the post (no wobble)', () => {
    const positions: [number, number][] = [
      ...LEAN_QUADRANTS.map((q) => [q.lampPostM[0], q.lampPostM[1]] as [number, number]),
      [0, 0],
      [-3.25, 7.5],
    ];
    for (const [x, y] of positions) {
      const project = projector(x, y);
      const [x0, y0] = project(snap(x), 0, snap(y));
      for (const slice of LAMP_POST_STACK.slices) {
        const [sx, sy] = project(snap(x), slice.heightM, snap(y));
        expect(Math.abs(sx - x0)).toBeLessThan(1e-6);
        expect(Math.abs(sy - y0)).toBeLessThan(1e-6);
        // The magnified 32 px cell stays centred on that pixel: its corners are symmetric about it.
        const [ax, ay] = project(snap(x) - 1, slice.heightM, snap(y) - 1);
        const [bx, by] = project(snap(x) + 1, slice.heightM, snap(y) + 1);
        expect(Math.abs(ax + bx - 2 * x0)).toBeLessThan(1e-6);
        expect(Math.abs(ay + by - 2 * y0)).toBeLessThan(1e-6);
      }
    }
  });

  it('leans each lean_quadrants lamp post outward from the screen centre, like its quadrant`s buildings', () => {
    const project = projector(0, 0);
    const [cx, cy] = project(0, 0, 0);
    for (const q of LEAN_QUADRANTS) {
      const [x, y] = q.lampPostM;
      const [bx, by] = project(snap(x), 0, snap(y));
      // The radial direction from the screen centre through the post's foot.
      const rx = bx - cx;
      const ry = by - cy;
      const r = Math.hypot(rx, ry);
      let previous = 0;
      for (const slice of LAMP_POST_STACK.slices) {
        const [sx, sy] = project(snap(x), slice.heightM, snap(y));
        const dx = sx - bx;
        const dy = sy - by;
        const lean = Math.hypot(dx, dy);
        // Outward along the radial (parallel, same sense), growing with height: r h / (H − h).
        expect((dx * rx + dy * ry) / (lean * r)).toBeGreaterThan(1 - 1e-9);
        expect(lean).toBeGreaterThan(previous);
        expect(lean).toBeCloseTo((r * slice.heightM) / (SWEEP_HEIGHT_M - slice.heightM), 6);
        previous = lean;
        // Same screen quadrant sense as a roof corner of that quadrant's buildings.
        expect(Math.sign(dx)).toBe(q.name.endsWith('e') ? 1 : -1);
        expect(Math.sign(dy)).toBe(q.name.startsWith('n') ? -1 : 1);
      }
    }
  });
});
