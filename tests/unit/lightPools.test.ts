// Light pools (SSP-021; TECHNICAL_DESIGN §12.6, ART_BIBLE §13): hard-edged stepped circles of G = 1 in the
// mask, one quad per lamp in one mesh. The membership rule is pure and shared with the shader; the mesh is a
// mask-only MAX-blended draw on the fx depth layer.
import { CustomBlending, MaxEquation, type ShaderMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import {
  createLightPools,
  inLightPool,
  LIGHT_POOL_RADIUS_M,
  lightPoolAnchorPx,
  lightPoolGeometryData,
  lightPoolPixelCount,
} from '../../src/render/lightPools.ts';
import { DepthLayer } from '../../src/render/worldMaterial.ts';
import { PX_PER_M } from '../../src/sim/constants.ts';

const R_PX = LIGHT_POOL_RADIUS_M * PX_PER_M;

describe('light pool shape', () => {
  it('is 5 m in radius (80 px): a pool 10 m across, as LEVEL_DESIGN assumes (D-05)', () => {
    expect(LIGHT_POOL_RADIUS_M).toBe(5);
    expect(R_PX).toBe(80);
  });

  it('is a stepped circle, 4-fold symmetric about its anchor corner, with no pixel exactly on the edge', () => {
    let pixels = 0;
    for (let gy = -R_PX - 2; gy <= R_PX + 1; gy++) {
      for (let gx = -R_PX - 2; gx <= R_PX + 1; gx++) {
        const inside = inLightPool(gx, gy, 0, 0, R_PX);
        // Mirror images about the corner (0, 0): pixel g mirrors to −1 − g.
        expect(inLightPool(-1 - gx, gy, 0, 0, R_PX)).toBe(inside);
        expect(inLightPool(gx, -1 - gy, 0, 0, R_PX)).toBe(inside);
        expect(inLightPool(gy, gx, 0, 0, R_PX)).toBe(inside);
        const d2 = (gx + 0.5) ** 2 + (gy + 0.5) ** 2;
        expect(d2).not.toBe(R_PX * R_PX);
        if (inside) pixels++;
      }
    }
    expect(pixels).toBe(lightPoolPixelCount(R_PX));
    // Within 0.5% of π r².
    expect(Math.abs(pixels / (Math.PI * R_PX * R_PX) - 1)).toBeLessThan(0.005);
  });

  it('has hard edges: membership never depends on anything but the pixel and the anchor', () => {
    // A row through the centre: inside exactly for the 2 × 80 pixels around the anchor.
    const row = Array.from({ length: 200 }, (_, i) => inLightPool(i - 100, 0, 0, 0, R_PX));
    expect(row.filter(Boolean)).toHaveLength(2 * R_PX);
    expect(row.indexOf(true)).toBe(100 - R_PX);
    expect(inLightPool(5 + 3, 7, 5, 0, R_PX)).toBe(inLightPool(3, 7, 0, 0, R_PX));
  });

  it('snaps the anchor to the 1/16 m grid like a sprite pivot', () => {
    expect(lightPoolAnchorPx(4)).toBe(64);
    expect(lightPoolAnchorPx(-6.5)).toBe(-104);
    expect(lightPoolAnchorPx(0.03)).toBe(0);
    expect(lightPoolAnchorPx(0.032)).toBe(1);
  });
});

describe('light pool geometry and material', () => {
  it('builds one upward-facing quad per pool, 1 px larger than the circle, carrying its anchor', () => {
    const { positions, anchors } = lightPoolGeometryData([
      [4, -6.5],
      [-4, 6.5],
    ]);
    expect(positions).toHaveLength(2 * 6 * 3);
    expect(anchors).toHaveLength(2 * 6 * 2);
    const xs = [0, 1, 2, 3, 4, 5].map((v) => positions[v * 3] ?? Number.NaN);
    const ys = [0, 1, 2, 3, 4, 5].map((v) => positions[v * 3 + 1] ?? Number.NaN);
    const zs = [0, 1, 2, 3, 4, 5].map((v) => positions[v * 3 + 2] ?? Number.NaN);
    expect(Math.min(...xs)).toBeCloseTo((64 - 81) / 16, 6);
    expect(Math.max(...xs)).toBeCloseTo((64 + 81) / 16, 6);
    expect(Math.min(...zs)).toBeCloseTo((-104 - 81) / 16, 6);
    expect(ys.every((y) => y === 0)).toBe(true);
    expect([anchors[0], anchors[1], anchors[12], anchors[13]]).toEqual([64, -104, -64, 104]);
    // Both triangles face +Y: (b − a) × (c − a) has a positive y component.
    for (let t = 0; t < 2; t++) {
      const v = (k: number, c: number): number => positions[(t * 3 + k) * 3 + c] ?? Number.NaN;
      const up = (v(1, 2) - v(0, 2)) * (v(2, 0) - v(0, 0)) - (v(1, 0) - v(0, 0)) * (v(2, 2) - v(0, 2));
      expect(up).toBeGreaterThan(0);
    }
  });

  it('is one mask-only mesh: MAX blend, depth-tested, no depth write, G = 1, on the fx layer', () => {
    const mesh = createLightPools([
      [4, -6.5],
      [-4, -6.5],
    ]);
    expect(mesh.name).toBe('lightPools');
    expect(mesh.frustumCulled).toBe(false);
    expect(mesh.children).toHaveLength(0);
    const material = mesh.material as ShaderMaterial;
    expect(material.blending).toBe(CustomBlending);
    expect(material.blendEquation).toBe(MaxEquation);
    expect(material.depthTest).toBe(true);
    expect(material.depthWrite).toBe(false);
    expect(material.uniforms.uRadiusPx?.value).toBe(80);
    expect(material.fragmentShader).toContain('outColour = vec4(0.0)');
    expect(material.fragmentShader).toContain('outMask = vec4(0.0, 1.0, 0.0, 0.0)');
    expect(material.fragmentShader).toContain('floor(vGroundPx) + 0.5 - vAnchorPx');
    expect(material.vertexShader).toContain(`${DepthLayer.Fx}.0, 0.0)`);
  });
});
