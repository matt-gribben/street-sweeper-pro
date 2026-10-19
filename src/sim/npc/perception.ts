// Staggered NPC perception (TECHNICAL_DESIGN §11.1, SSP-080). Each NPC runs its perception query every
// PERCEPTION_EVERY_TICKS (4) ticks, on the ticks where `tick mod 4 == index mod 4`, so a quarter of the store
// is queried each tick (deterministic: it depends only on the tick and the NPC's index). The query reads
// Bessie's pose and ground velocity and her predicted path, the straight segment from her body centre along
// that velocity for PERCEPTION_PATH_S (1.5 s), and writes three numbers onto the NPC for its behaviour to
// read until its next query: `seenDistM` (to her body centre), `pathGapM` (the closest distance between the
// NPC and the predicted path) and `pathEtaS` (when she reaches that closest point, 0..1.5 s), plus
// `perceivedTick`. A swap-remove moves an NPC to another index, and so onto that index's phase.
//
// Hot path: perceiveNpcs allocates nothing.
import { cos, sin, sqrt } from '../fmath.ts';
import type { World } from '../world.ts';

/** Ticks between two perception queries of one NPC. */
export const PERCEPTION_EVERY_TICKS = 4;
/** How far ahead Bessie's path is predicted, seconds. */
export const PERCEPTION_PATH_S = 1.5;

/** Phase 7: run the perception query of every NPC whose index is on this tick's phase (index mod 4). */
export function perceiveNpcs(w: World): void {
  const npc = w.npc;
  const v = w.vehicle;
  const tick = w.tick;
  const h = v.headingRad;
  const s = sin(h);
  const c = cos(h);
  // Ground velocity = forward·vLong + right·vLat, forward = (sin h, −cos h), right = (cos h, sin h).
  const dx = (s * v.vLongMps + c * v.vLatMps) * PERCEPTION_PATH_S;
  const dy = (-c * v.vLongMps + s * v.vLatMps) * PERCEPTION_PATH_S;
  const len2 = dx * dx + dy * dy;
  const bx = v.xM;
  const by = v.yM;
  for (let i = tick % PERCEPTION_EVERY_TICKS; i < npc.count; i += PERCEPTION_EVERY_TICKS) {
    const px = (npc.x[i] as number) - bx;
    const py = (npc.y[i] as number) - by;
    let t = 0;
    if (len2 > 1e-12) {
      t = (px * dx + py * dy) / len2;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
    }
    const gx = px - t * dx;
    const gy = py - t * dy;
    npc.seenDistM[i] = sqrt(px * px + py * py);
    npc.pathGapM[i] = sqrt(gx * gx + gy * gy);
    npc.pathEtaS[i] = t * PERCEPTION_PATH_S;
    npc.perceivedTick[i] = tick;
  }
}
