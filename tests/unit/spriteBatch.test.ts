// Sprite batches (SSP-018; TECHNICAL_DESIGN §4, §12.5): heading -> frame mapping, the in-layer sortBias, the
// per-instance buffer contract (frameRect and pivot from FRAME, one needsUpdate per frame, no per-frame
// allocation) and the spike's frame-counter-driven heading cycle.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FRAME, type FrameId } from '../../src/gen/assets.ts';
import {
  BESSIE_BODY_FRAMES,
  BESSIE_BRUSH_FRAMES,
  bessieBodyFrame,
  bessieBrushFrame,
  HEADING_COUNT,
  HEADING_IDS,
  headingId,
  headingIndex,
} from '../../src/render/headings.ts';
import {
  createSpikeActors,
  FRAMES_PER_BRUSH_SPIN,
  FRAMES_PER_HEADING,
  SPIKE_BESSIE_M,
  SPIKE_PEDESTRIAN_FRAME,
  SPIKE_PEDESTRIAN_M,
  spikeBodyFrame,
  spikeBrushFrame,
  spikeHeading,
  spikeHeadingRad,
} from '../../src/render/spikeActors.ts';
import { loadAtlas, type RgbaImage, type SpriteAtlas } from '../../src/render/spriteAtlas.ts';
import {
  DROP_SHADOW_OFFSET_PX,
  DropShadowBatch,
  INSTANCE_STRIDE,
  SORT_BIAS_MAX,
  SORT_SPAN_M,
  SpriteBatch,
  SpriteFlag,
  sortBias,
} from '../../src/render/spriteBatch.ts';
import { DepthLayer } from '../../src/render/worldMaterial.ts';
import { assertHeapDeltaWithinThresholds, measureHeapDelta } from '../support/heapDelta.ts';
import { decodePng } from '../support/png.ts';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DEG = Math.PI / 180;
/** Frames run before measuring the render path's heap, so it is JIT-optimised (see the heap test). */
const RENDER_WARMUP_FRAMES = 20_000;

async function loadActors(): Promise<SpriteAtlas> {
  return loadAtlas('actors', {
    fetchJson: async (url: string): Promise<unknown> =>
      JSON.parse(readFileSync(`${REPO_ROOT}public${url}`, 'utf8')),
    fetchImage: async (url: string): Promise<RgbaImage> =>
      decodePng(readFileSync(`${REPO_ROOT}public${url}`)),
  });
}

describe('heading -> frame (TECHNICAL_DESIGN §4)', () => {
  it.each([
    ['θ = 0', 0, 'h00'],
    ['θ = π/2 (east)', Math.PI / 2, 'h08'],
    ['θ = −11.25°', -11.25 * DEG, 'h31'],
    ['θ = 2π', 2 * Math.PI, 'h00'],
    ['θ = 5.6°', 5.6 * DEG, 'h00'],
    ['θ = 5.7°', 5.7 * DEG, 'h01'],
    ['θ = π (south)', Math.PI, 'h16'],
    ['θ = −π/2 (west)', -Math.PI / 2, 'h24'],
    ['θ = 4π + 11.25°', 4 * Math.PI + 11.25 * DEG, 'h01'],
  ])('%s -> %s', (_label, theta, expected) => {
    expect(headingId(theta)).toBe(expected);
    expect(HEADING_IDS[headingIndex(theta)]).toBe(expected);
  });

  it('returns a plain integer index in 0..31 for any angle, including −0 rounding', () => {
    for (let deg = -1080; deg <= 1080; deg += 0.7) {
      const index = headingIndex(deg * DEG);
      expect(Number.isInteger(index) && index >= 0 && index < HEADING_COUNT).toBe(true);
      expect(Object.is(index, -0)).toBe(false);
    }
    expect(Object.is(headingIndex(-0.1 * DEG), 0)).toBe(true);
  });

  it('builds 32 distinct body frames and 32 × 4 brush frames, all in FRAME, from the typed table', () => {
    expect(HEADING_IDS).toHaveLength(32);
    expect(HEADING_IDS.map((h, i) => h === `h${String(i).padStart(2, '0')}`).every(Boolean)).toBe(true);
    expect(new Set(BESSIE_BODY_FRAMES).size).toBe(32);
    expect(new Set(BESSIE_BRUSH_FRAMES.flat()).size).toBe(128);
    for (const frame of [...BESSIE_BODY_FRAMES, ...BESSIE_BRUSH_FRAMES.flat()]) {
      expect(FRAME[frame].atlas).toBe('actors');
    }
    expect(bessieBodyFrame(7)).toBe('veh.sweeper:body:h07:0');
    expect(bessieBrushFrame(31, 3)).toBe('veh.sweeper_brush:brush:h31:3');
    expect(() => bessieBodyFrame(32)).toThrow();
    expect(() => bessieBrushFrame(0, 4)).toThrow();
  });

  it('keeps the documented pivots: body centre for vehicles, feet for people', () => {
    for (const frame of BESSIE_BODY_FRAMES) expect([FRAME[frame].px, FRAME[frame].py]).toEqual([32, 32]);
    for (const frame of BESSIE_BRUSH_FRAMES.flat())
      expect([FRAME[frame].px, FRAME[frame].py]).toEqual([48, 48]);
    expect([FRAME[SPIKE_PEDESTRIAN_FRAME].px, FRAME[SPIKE_PEDESTRIAN_FRAME].py]).toEqual([12, 22]);
  });
});

describe('sortBias (TECHNICAL_DESIGN §12.5)', () => {
  it('gives the actor with the larger y_sim the larger sortBias within a layer', () => {
    const camY = 3.25;
    const north = sortBias(1.0, camY);
    const south = sortBias(1.5, camY);
    expect(south).toBeGreaterThan(north);
    // The southern actor's clip-space depth offset is larger, so it is nearer and draws on top.
    const offset = (layer: number, bias: number): number => (layer * 8 + bias) * 1e-5;
    expect(offset(DepthLayer.Pedestrian, south)).toBeGreaterThan(offset(DepthLayer.Pedestrian, north));
  });

  it('is written per instance by the batch: the southern of two same-layer actors gets the larger bias', async () => {
    const batch = new SpriteBatch(await loadActors(), 2);
    batch.begin(-0.7);
    batch.add('npc.old_woman:idle:s:0', 3, 2.25, DepthLayer.Pedestrian); // south
    batch.add('npc.old_woman:idle:n:0', 3, 1.75, DepthLayer.Pedestrian); // north
    batch.end();
    const bias = batch.mesh.geometry.getAttribute('sortBias');
    const layer = batch.mesh.geometry.getAttribute('layer');
    expect(layer.getX(0)).toBe(layer.getX(1));
    expect(bias.getX(0)).toBeGreaterThan(bias.getX(1));
    expect(bias.getX(0)).toBeCloseTo(sortBias(2.25, -0.7), 6);
  });

  it('is monotonic, stays in [0, 1) and never reaches the next layer', () => {
    let previous = -1;
    for (let y = -40; y <= 40; y += 0.0625) {
      const bias = sortBias(y, 0);
      expect(bias).toBeGreaterThanOrEqual(previous);
      expect(bias >= 0 && bias < 1).toBe(true);
      previous = bias;
    }
    expect(sortBias(1e6, 0)).toBe(SORT_BIAS_MAX);
    expect(sortBias(-1e6, 0)).toBe(0);
  });

  it('depends only on y − camY and covers the whole visible frame without clamping', () => {
    expect(sortBias(12, 10)).toBeCloseTo(sortBias(2, 0), 12);
    // At the widest zoom (H = 37.8 m) the frame is ±10.2 m tall: strictly increasing across it.
    const halfFrameM = 37.8 * Math.tan(15 * DEG);
    expect(halfFrameM).toBeLessThan(SORT_SPAN_M / 2);
    expect(sortBias(halfFrameM, 0)).toBeLessThan(SORT_BIAS_MAX);
    expect(sortBias(-halfFrameM, 0)).toBeGreaterThan(0);
  });
});

describe('SpriteBatch and DropShadowBatch instance buffers', () => {
  it('writes offset, rotation, frameRect and pivot from FRAME, swap, flags and depth per instance', async () => {
    const atlas = await loadActors();
    const batch = new SpriteBatch(atlas, 4);
    const frame: FrameId = 'veh.sweeper:body:h07:0';
    batch.begin(4.5); // y − camY = −8 m: sortBias 0.25
    batch.add(frame, -12, -3.5, DepthLayer.Bessie, 3, SpriteFlag.MirrorX, 5);
    batch.end();
    expect(batch.count).toBe(1);
    expect(batch.mesh.count).toBe(1);
    const attr = (name: string, size: number): number[] => {
      const a = batch.mesh.geometry.getAttribute(name);
      return Array.from({ length: size }, (_, c) => a.getComponent(0, c));
    };
    const f = FRAME[frame];
    expect(attr('offset', 3)).toEqual([-12, 0, -3.5]);
    expect(attr('rotation', 1)).toEqual([1]); // 5 quarter turns = 1
    expect(attr('frameRect', 4)).toEqual([f.x, f.y, f.w, f.h]);
    expect(attr('pivot', 2)).toEqual([32, 32]);
    expect(attr('swap', 1)).toEqual([3]);
    expect(attr('flags', 1)).toEqual([SpriteFlag.MirrorX]);
    expect(attr('layer', 1)).toEqual([DepthLayer.Bessie]);
    expect(attr('sortBias', 1)).toEqual([0.25]);
    expect(batch.mesh.geometry.getAttribute('offset').itemSize).toBe(3);
    expect(INSTANCE_STRIDE).toBe(16);
  });

  it('marks the interleaved buffer for upload exactly once per frame and resets on begin()', async () => {
    const atlas = await loadActors();
    const batch = new SpriteBatch(atlas, 3);
    const buffer = (batch.mesh.geometry.getAttribute('frameRect') as unknown as { data: { version: number } })
      .data;
    const before = buffer.version;
    batch.begin(0);
    batch.add('npc.old_woman:idle:s:0', 0, 0, DepthLayer.Pedestrian);
    batch.add('veh.sweeper:body:h00:0', 0, 0, DepthLayer.Bessie);
    batch.end();
    expect(buffer.version - before).toBe(1);
    batch.begin(0);
    batch.end();
    expect(batch.mesh.count).toBe(0);
    expect(buffer.version - before).toBe(2);
  });

  it('rejects a frame past capacity', async () => {
    const atlas = await loadActors();
    const batch = new SpriteBatch(atlas, 1);
    batch.begin(0);
    batch.add('veh.sweeper:body:h00:0', 0, 0, DepthLayer.Bessie);
    expect(() => batch.add('veh.sweeper:body:h01:0', 0, 0, DepthLayer.Bessie)).toThrow('capacity 1');
  });

  it('puts drop shadows on layer 4 with the caster atlas selector, offset +2,+2 px in the shader', async () => {
    const atlas = await loadActors();
    const shadows = new DropShadowBatch([atlas], 2);
    shadows.begin(-6); // y − camY = 8 m: sortBias 0.75
    shadows.add('npc.old_woman:idle:s:0', 1, 2);
    shadows.end();
    expect(shadows.mesh.geometry.getAttribute('sortBias').getX(0)).toBe(0.75);
    const layer = shadows.mesh.geometry.getAttribute('layer').getX(0);
    expect(layer).toBe(DepthLayer.DropShadow);
    expect(shadows.mesh.geometry.getAttribute('atlas').getX(0)).toBe(0);
    expect(DROP_SHADOW_OFFSET_PX).toBe(2);
    const material = shadows.mesh.material as unknown as { fragmentShader: string; vertexShader: string };
    expect(material.vertexShader).toContain('placeSprite(vec2(2.0))');
    expect(material.fragmentShader).toContain('outMask = vec4(1.0, 0.0, 0.0, 0.0)');
    expect(() => new DropShadowBatch([atlas, atlas, atlas], 1)).toThrow();
  });

  it('writes the light mask only for sprites flagged Lit (lamp heads, SSP-021)', async () => {
    const atlas = await loadActors();
    const batch = new SpriteBatch(atlas, 2);
    batch.begin(0);
    batch.addAtHeight('veh.sweeper:body:h00:0', 0, 0, 1, DepthLayer.Bessie, SpriteFlag.Lit);
    batch.addAtHeight('veh.sweeper:body:h00:0', 0, 0, 1, DepthLayer.Bessie);
    batch.end();
    const flags = batch.mesh.geometry.getAttribute('flags');
    expect([flags.getX(0), flags.getX(1)]).toEqual([SpriteFlag.Lit, 0]);
    expect(SpriteFlag.Lit & SpriteFlag.MirrorX).toBe(0);
    const material = batch.mesh.material as unknown as { fragmentShader: string; vertexShader: string };
    expect(material.vertexShader).toContain(`(int(flags) & ${SpriteFlag.Lit}) != 0 ? 1.0 : 0.0`);
    // R (shadow) is never written by a sprite; G (light) only when lit.
    expect(material.fragmentShader).toContain('outMask = vec4(0.0, vLit, 0.0, 0.0)');
  });

  it('runs a spike frame (6 instances over two batches) with no per-frame allocation', async () => {
    const atlas = await loadActors();
    const spike = createSpikeActors(atlas);
    // Measured at steady state: before the JIT optimises the render path, V8 boxes intermediate doubles
    // (measured during SSP-018: up to ~0.8 MB over 3,600 frames after the sim's 600-tick warm-up, 256 B after
    // 20,000). A camera y that is a fresh float every call would be boxed at the call boundary by V8 itself, so
    // the camera stays at a fixed, non-integer y and the biases are still computed per frame.
    const delta = measureHeapDelta((tick) => spike.update(tick, 3.25), { warmupTicks: RENDER_WARMUP_FRAMES });
    assertHeapDeltaWithinThresholds(delta);
    expect(spike.sprites.count).toBe(3);
    expect(spike.shadows.count).toBe(2);
  });
});

describe('spike actors (render-frame counter)', () => {
  it('cycles h00 -> h31 clockwise, FRAMES_PER_HEADING frames each, and wraps', () => {
    const seen: FrameId[] = [];
    for (let k = 0; k < 32; k++) seen.push(spikeBodyFrame(k * FRAMES_PER_HEADING));
    expect(seen).toEqual([...BESSIE_BODY_FRAMES]);
    expect(spikeBodyFrame(FRAMES_PER_HEADING - 1)).toBe('veh.sweeper:body:h00:0');
    expect(spikeBodyFrame(32 * FRAMES_PER_HEADING)).toBe('veh.sweeper:body:h00:0');
  });

  it('derives the integer heading exactly as headingIndex(θ) would from the cycled angle', () => {
    for (let frame = 0; frame < 3 * 32 * FRAMES_PER_HEADING; frame++) {
      expect(spikeHeading(frame)).toBe(headingIndex(spikeHeadingRad(frame)));
    }
  });

  it('spins the brush through its 4 frames at the body heading', () => {
    const spins = [0, 1, 2, 3, 4].map((n) =>
      spikeBrushFrame(4 * FRAMES_PER_HEADING + n * FRAMES_PER_BRUSH_SPIN),
    );
    expect(spins).toEqual([
      'veh.sweeper_brush:brush:h04:0',
      'veh.sweeper_brush:brush:h04:1',
      'veh.sweeper_brush:brush:h04:2',
      'veh.sweeper_brush:brush:h04:3',
      'veh.sweeper_brush:brush:h04:0',
    ]);
  });

  it('is a pure function of the frame counter: the same counter writes the same instances', async () => {
    const atlas = await loadActors();
    const spike = createSpikeActors(atlas);
    const snapshot = (): number[] => {
      const a = spike.sprites.mesh.geometry.getAttribute('frameRect');
      return Array.from({ length: 3 * 4 }, (_, i) => a.getComponent(Math.floor(i / 4), i % 4));
    };
    spike.update(123, 0);
    const first = snapshot();
    spike.update(400, 0);
    spike.update(123, 0);
    expect(snapshot()).toEqual(first);
  });

  it('places the pedestrian beside Bessie, out of reach of the brush discs (2.4 m)', () => {
    const dx = SPIKE_PEDESTRIAN_M[0] - SPIKE_BESSIE_M[0];
    const dy = SPIKE_PEDESTRIAN_M[1] - SPIKE_BESSIE_M[1];
    expect(Math.hypot(dx, dy)).toBeGreaterThan(2.4 + 1);
    expect(Math.hypot(dx, dy)).toBeLessThan(6);
  });
});
