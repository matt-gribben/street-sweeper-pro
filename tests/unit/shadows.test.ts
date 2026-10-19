// SSP-017: building shadow polygons (ART_BIBLE §6.4, TECHNICAL_DESIGN §12.4): SE projection of 0.84 × h, one
// mask-only mesh at y = 0 on depth layer 1, MAX-blended and depth-tested; plus the spike city's draw count.
import { MaxEquation, Mesh, type ShaderMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { type CityBox, mergeBoxes } from '../../src/render/cityMesh.ts';
import { parseCityGrid } from '../../src/render/placeholderCity.ts';
import {
  buildShadowPolygons,
  createBuildingShadows,
  SHADOW_DIRECTION,
  SHADOW_LENGTH_PER_HEIGHT,
  type ShadowPolygon,
  shadowGeometryPositions,
  shadowOffsetM,
  shadowPolygon,
} from '../../src/render/shadows.ts';
import { createSpikeCity, SPIKE_CITY_ORIGIN_M, SPIKE_CITY_ROWS } from '../../src/render/spikeCity.ts';

const box = (x0M: number, y0M: number, x1M: number, y1M: number, storeys: number): CityBox => ({
  x0M,
  y0M,
  x1M,
  y1M,
  storeys,
  heightM: storeys * 2.5,
});

/** Vertex k of a polygon as [x, y]. */
const at = (p: ShadowPolygon, k: number): [number, number] => [
  p.outline[2 * k] ?? NaN,
  p.outline[2 * k + 1] ?? NaN,
];

/** Shoelace area with screen orientation: positive when counter-clockwise on screen (x east, y south). */
function screenArea(p: ShadowPolygon): number {
  const n = p.outline.length / 2;
  let sum = 0;
  for (let k = 0; k < n; k++) {
    const [x0, y0] = at(p, k);
    const [x1, y1] = at(p, (k + 1) % n);
    sum += x0 * y1 - x1 * y0;
  }
  // With y pointing south the usual shoelace sign flips.
  return -sum / 2;
}

describe('shadow polygons', () => {
  it('uses length 0.84 × h toward the south-east unit vector (+x, +y_sim)', () => {
    expect(SHADOW_LENGTH_PER_HEIGHT).toBe(0.84);
    expect(SHADOW_DIRECTION[0]).toBeCloseTo(Math.SQRT1_2, 15);
    expect(SHADOW_DIRECTION[1]).toBeCloseTo(Math.SQRT1_2, 15);
    expect(Math.hypot(...SHADOW_DIRECTION)).toBeCloseTo(1, 15);
    for (const h of [2.5, 7.5, 15]) {
      const [ox, oy] = shadowOffsetM(h);
      expect(Math.hypot(ox, oy)).toBeCloseTo(0.84 * h, 12);
      expect(ox).toBeGreaterThan(0);
      expect(oy).toBeCloseTo(ox, 12);
    }
  });

  it("offsets the far edge by 0.84 × h along the SE unit vector from the footprint's SW, SE and NE corners", () => {
    const b = box(-8, -4, -2, -2, 6); // the spike's 6-storey block, h = 15 m
    const p = shadowPolygon(b);
    const o = (0.84 * 15) / Math.SQRT2; // 8.9095 m per axis
    expect(p.offsetXM).toBeCloseTo(o, 12);
    expect(p.offsetYM).toBeCloseTo(o, 12);
    expect(p.outline.length).toBe(12);
    // Near edge: the footprint's NW, SW (west side) and NE corners.
    expect(at(p, 0)).toEqual([-8, -4]);
    expect(at(p, 1)).toEqual([-8, -2]);
    expect(at(p, 5)).toEqual([-2, -4]);
    // Far edge: SW, SE and NE moved by (o, o).
    const far = [at(p, 2), at(p, 3), at(p, 4)];
    const expected = [
      [-8 + o, -2 + o],
      [-2 + o, -2 + o],
      [-2 + o, -4 + o],
    ];
    far.forEach(([x, y], k) => {
      expect(x).toBeCloseTo(expected[k]?.[0] ?? NaN, 12);
      expect(y).toBeCloseTo(expected[k]?.[1] ?? NaN, 12);
    });
  });

  it('is the footprint swept SE: area w·d + o·(w + d), counter-clockwise on screen', () => {
    for (const b of [box(0, 0, 2, 2, 1), box(4, -6, 10, -2, 3), box(-8, -4, -2, -2, 6)]) {
      const p = shadowPolygon(b);
      const w = b.x1M - b.x0M;
      const d = b.y1M - b.y0M;
      expect(screenArea(p)).toBeCloseTo(w * d + p.offsetXM * d + p.offsetYM * w, 9);
    }
  });

  it('builds one polygon per merged box', () => {
    const boxes = mergeBoxes(parseCityGrid(SPIKE_CITY_ROWS, ...SPIKE_CITY_ORIGIN_M));
    const polygons = buildShadowPolygons(boxes);
    expect(polygons).toHaveLength(boxes.length);
    polygons.forEach((p, i) => {
      const [ox, oy] = shadowOffsetM(boxes[i]?.heightM ?? NaN);
      expect([p.offsetXM, p.offsetYM]).toEqual([ox, oy]);
    });
  });
});

describe('shadow geometry', () => {
  it('lies flat at y = 0, faces up, and covers exactly the polygon area', () => {
    const polygons = [shadowPolygon(box(0, 0, 4, 2, 3)), shadowPolygon(box(10, 10, 12, 16, 6))];
    const positions = shadowGeometryPositions(polygons);
    expect(positions.length % 9).toBe(0);
    let area = 0;
    for (let t = 0; t < positions.length / 9; t++) {
      const v = (k: number, c: number): number => positions[t * 9 + k * 3 + c] ?? NaN;
      for (let k = 0; k < 3; k++) expect(v(k, 1)).toBe(0);
      // y component of (b − a) × (c − a) in render space (x, y, z): positive means the triangle faces +Y.
      const up = (v(1, 2) - v(0, 2)) * (v(2, 0) - v(0, 0)) - (v(1, 0) - v(0, 0)) * (v(2, 2) - v(0, 2));
      expect(up).toBeGreaterThan(0);
      area += up / 2;
    }
    const expected = polygons.reduce((sum, p) => sum + screenArea(p), 0);
    expect(area).toBeCloseTo(expected, 4);
  });

  it('is one mask-only mesh: MAX blend, depth-tested, no depth write, frustum culling off', () => {
    const mesh = createBuildingShadows([box(0, 0, 2, 2, 1)]);
    expect(mesh).toBeInstanceOf(Mesh);
    expect(mesh.frustumCulled).toBe(false);
    const material = mesh.material as ShaderMaterial;
    expect(material.blendEquation).toBe(MaxEquation);
    expect(material.blendEquationAlpha).toBe(MaxEquation);
    expect(material.depthTest).toBe(true);
    expect(material.depthWrite).toBe(false);
    expect(material.vertexShader).toContain('applyDepthLayer');
    expect(material.vertexShader).toContain('1.0, 0.0)'); // depth layer 1 (DepthLayer.BuildingShadow)
    expect(material.fragmentShader).toContain('outColour = vec4(0.0)');
    expect(material.fragmentShader).toContain('outMask = vec4(1.0, 0.0, 0.0, 0.0)');
  });
});

describe('spike city', () => {
  it('is exactly two meshes: the city, then the building shadows', () => {
    const group = createSpikeCity();
    const meshes: Mesh[] = [];
    group.traverse((o) => {
      if (o instanceof Mesh) meshes.push(o);
    });
    expect(meshes.map((m) => m.name)).toEqual(['cityMesh', 'buildingShadows']);
    const [city, shadows] = meshes as [Mesh, Mesh];
    expect(city.renderOrder).toBeLessThan(shadows.renderOrder);
  });
});
