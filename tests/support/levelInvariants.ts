// Structural invariants of a compiled level's derived tile layers (SSP-034): collide SOLID / KERB_EDGE bits,
// the kerb blob autotile, the markings and the merged solids. Shared by the unit and property tests; each
// returns human-readable violations (empty = all hold).
import { AUTOTILE_NONE, COLLIDE, type Level, MARKING, type TileRect } from '../../src/sim/map.ts';
import type { ResolvedMap } from '../../tools/levels/compile-level.ts';
import type { KerbBlob } from '../../tools/levels/kerbBlob.ts';
import { isRaisedKerbCell, isRoadCell } from '../../tools/levels/tileLayers.ts';

const SIDES = [
  { dx: 0, dy: -1, own: COLLIDE.KERB_EDGE_N, facing: COLLIDE.KERB_EDGE_S, dir: 'n' },
  { dx: 1, dy: 0, own: COLLIDE.KERB_EDGE_E, facing: COLLIDE.KERB_EDGE_W, dir: 'e' },
  { dx: 0, dy: 1, own: COLLIDE.KERB_EDGE_S, facing: COLLIDE.KERB_EDGE_N, dir: 's' },
  { dx: -1, dy: 0, own: COLLIDE.KERB_EDGE_W, facing: COLLIDE.KERB_EDGE_E, dir: 'w' },
] as const;

/** Rasterise rects; returns per-cell cover counts. */
export function rasterise(rects: readonly TileRect[], w: number, h: number): Uint8Array {
  const cover = new Uint8Array(w * h);
  for (const [x0, y0, x1, y1] of rects) {
    for (let y = y0; y < y1; y += 1)
      for (let x = x0; x < x1; x += 1) cover[y * w + x] = (cover[y * w + x] ?? 0) + 1;
  }
  return cover;
}

/** Every violation of the solids / collide / autotile / markings invariants. */
export function tileLayerViolations(level: Level, map: ResolvedMap, blob: KerbBlob): string[] {
  const [w, h] = level.size;
  const { collide, autotile, markings } = level.layers;
  const out: string[] = [];
  const cover = rasterise(level.solids, w, h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      const c = collide[i] ?? 0;
      const at = `(${x}, ${y})`;
      const solid = (c & COLLIDE.SOLID) !== 0;
      if (solid !== (map.drivable[i] === 0))
        out.push(`${at}: SOLID ${solid} but drivable ${map.drivable[i]}`);
      if ((cover[i] ?? 0) !== (solid ? 1 : 0)) out.push(`${at}: covered ${cover[i]} time(s) by solids`);
      for (const s of SIDES) {
        if ((c & s.own) === 0) continue;
        const nx = x + s.dx;
        const ny = y + s.dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) {
          out.push(`${at}: kerb edge ${s.dir} off the map`);
          continue;
        }
        const j = ny * w + nx;
        if (((collide[j] ?? 0) & s.facing) === 0) out.push(`${at}: kerb edge ${s.dir} not mirrored`);
        const pair =
          (isRoadCell(map, i) && isRaisedKerbCell(map, j)) ||
          (isRaisedKerbCell(map, i) && isRoadCell(map, j));
        if (!pair) out.push(`${at}: kerb edge ${s.dir} is not between a road and a raised kerb`);
      }
      // Every road ↔ raised-kerb edge has its bit.
      if (isRoadCell(map, i)) {
        for (const s of SIDES) {
          const nx = x + s.dx;
          const ny = y + s.dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          if (isRaisedKerbCell(map, ny * w + nx) && (c & s.own) === 0)
            out.push(`${at}: missing kerb edge ${s.dir}`);
        }
      }
      const a = autotile[i] ?? AUTOTILE_NONE;
      let roadNear = false;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (
            (dx !== 0 || dy !== 0) &&
            nx >= 0 &&
            ny >= 0 &&
            nx < w &&
            ny < h &&
            isRoadCell(map, ny * w + nx)
          )
            roadNear = true;
        }
      }
      const wantTile = isRaisedKerbCell(map, i) && roadNear;
      if ((a !== AUTOTILE_NONE) !== wantTile)
        out.push(`${at}: autotile ${a}, expected ${wantTile ? 'a tile' : 'none'}`);
      if (a !== AUTOTILE_NONE) {
        const mask = blob.masks[a] ?? 255;
        for (const s of SIDES) {
          const kerb = (mask & blob.bits[s.dir]) === 0;
          if (kerb !== ((c & s.own) !== 0))
            out.push(`${at}: autotile ${a} ${s.dir} edge disagrees with collide`);
        }
      }
      const m = markings[i] ?? 0;
      if (m !== 0 && !isRoadCell(map, i)) out.push(`${at}: markings ${m} off the road`);
      if ((m & MARKING.DOUBLE_YELLOW) !== 0 && (c & ~COLLIDE.SOLID) === 0)
        out.push(`${at}: double yellow without a kerb edge`);
      if (((m & MARKING.PARKING_BAY) !== 0) !== (map.defs[i]?.mark === 'parking_bay'))
        out.push(`${at}: PARKING_BAY ${m & MARKING.PARKING_BAY} disagrees with the map`);
    }
  }
  return out;
}
