// How deep Bessie's body overlaps static geometry: the replay invariant `maxSolidOverlapM` (TECHNICAL_DESIGN
// §18.3, SSP-038). Test-side geometry, independent of the sim's collision code (SSP-036), so the invariant
// checks the resolver rather than reusing it.
//
// Bessie's body is the OBB body.widthM × body.lengthM centred on (xM, yM), turned by headingRad (0 = north,
// clockwise; forward (sin h, −cos h), right (cos h, sin h)). The static geometry is the level's merged SOLID
// rects (tiles → metres) plus everything outside the map, which SSP-036 treats as solid. The depth against a
// rect is the SAT minimum-penetration overlap (0 when any axis separates them); the depth against the
// boundary is how far the OBB reaches past the furthest map edge. Props join when their footprints exist
// (SSP-036 adds them to tuning.json); M1's invariant covers rects and the boundary only.
import { TILE_M } from '../../src/sim/constants.ts';
import type { Level } from '../../src/sim/map.ts';

/** A body pose and size, in metres and radians. */
export type BodyBox = {
  readonly xM: number;
  readonly yM: number;
  readonly headingRad: number;
  readonly widthM: number;
  readonly lengthM: number;
};

/** SAT penetration depth (m) of the OBB into the axis-aligned rect [x0, x1] × [y0, y1] (metres); 0 if apart. */
export function obbRectPenetrationM(body: BodyBox, x0: number, y0: number, x1: number, y1: number): number {
  const rx = Math.cos(body.headingRad);
  const ry = Math.sin(body.headingRad);
  const fx = ry;
  const fy = -rx;
  const hw = body.widthM / 2;
  const hl = body.lengthM / 2;
  const ex = (x1 - x0) / 2;
  const ey = (y1 - y0) / 2;
  const dx = body.xM - (x0 + x1) / 2;
  const dy = body.yM - (y0 + y1) / 2;
  const axes: readonly (readonly [number, number])[] = [
    [1, 0],
    [0, 1],
    [rx, ry],
    [fx, fy],
  ];
  let depth = Number.POSITIVE_INFINITY;
  for (const [nx, ny] of axes) {
    const rBody = hw * Math.abs(rx * nx + ry * ny) + hl * Math.abs(fx * nx + fy * ny);
    const rRect = ex * Math.abs(nx) + ey * Math.abs(ny);
    const overlap = rBody + rRect - Math.abs(dx * nx + dy * ny);
    if (overlap <= 0) return 0;
    if (overlap < depth) depth = overlap;
  }
  return depth;
}

/** How far (m) the OBB reaches outside the map rectangle [0, widthM] × [0, heightM]; 0 when inside. */
export function obbBoundaryPenetrationM(body: BodyBox, mapWidthM: number, mapHeightM: number): number {
  const rx = Math.cos(body.headingRad);
  const ry = Math.sin(body.headingRad);
  const hw = body.widthM / 2;
  const hl = body.lengthM / 2;
  // Half-extents of the OBB along world x and y (right is (rx, ry), forward is (ry, −rx)).
  const extX = hw * Math.abs(rx) + hl * Math.abs(ry);
  const extY = hw * Math.abs(ry) + hl * Math.abs(rx);
  return Math.max(0, extX - body.xM, body.xM + extX - mapWidthM, extY - body.yM, body.yM + extY - mapHeightM);
}

/** The deepest overlap (m) of the OBB with any merged solid rect of `level` or with the map boundary. */
export function solidOverlapM(level: Level, body: BodyBox): number {
  let deepest = obbBoundaryPenetrationM(body, level.size[0] * TILE_M, level.size[1] * TILE_M);
  for (const [tx0, ty0, tx1, ty1] of level.solids) {
    const d = obbRectPenetrationM(body, tx0 * TILE_M, ty0 * TILE_M, tx1 * TILE_M, ty1 * TILE_M);
    if (d > deepest) deepest = d;
  }
  return deepest;
}

/**
 * SAT penetration depth (m) of two OBBs (0 when any of their four edge normals separates them): the vehicle
 * overlap of the SSP-090 collision property, test-side and independent of src/sim/collision.
 */
export function obbObbPenetrationM(a: BodyBox, b: BodyBox): number {
  const axesOf = (box: BodyBox): [number, number][] => {
    const rx = Math.cos(box.headingRad);
    const ry = Math.sin(box.headingRad);
    return [
      [rx, ry],
      [ry, -rx],
    ];
  };
  const half = (box: BodyBox, nx: number, ny: number): number => {
    const rx = Math.cos(box.headingRad);
    const ry = Math.sin(box.headingRad);
    return (box.widthM / 2) * Math.abs(rx * nx + ry * ny) + (box.lengthM / 2) * Math.abs(ry * nx - rx * ny);
  };
  const dx = b.xM - a.xM;
  const dy = b.yM - a.yM;
  let depth = Number.POSITIVE_INFINITY;
  for (const [nx, ny] of [...axesOf(a), ...axesOf(b)]) {
    const overlap = half(a, nx, ny) + half(b, nx, ny) - Math.abs(dx * nx + dy * ny);
    if (overlap <= 0) return 0;
    if (overlap < depth) depth = overlap;
  }
  return depth;
}
