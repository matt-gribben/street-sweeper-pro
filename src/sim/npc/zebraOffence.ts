// Running an occupied zebra (GDD §11.2, ENTITY_CATALOG §3.3, §11; LEVEL_DESIGN §7.5; SSP-085): Bessie must wait
// at an occupied site.zebra. Driving onto one costs tuning.json complaints.zebra (−200 and 1 complaint), on top
// of any hit on the person crossing (reactions.ts files that separately, the same tick if she hits them).
//
// Phase 7, last (stepZebras): updateZebraOccupancy (steering.ts, SSP-081) recounts the NPCs whose centre is on
// each zebra after the behaviours, then stepZebraOffences tests Bessie's body OBB (tuning.json body.widthM ×
// lengthM at her pose after phase 3) against each zebra's rect:
//   - while the OBB overlaps the rect she is on it (zebras.bessieOn); the tick she has fully left it ends the
//     entry episode and re-arms the zebra;
//   - an offence is the tick an episode starts (the OBB overlaps a rect it did not overlap on the tick before)
//     while the zebra's occupancy is above 0. So each entry costs at most once, however long she stays on the
//     stripes or how many people cross, and a zebra that is empty as she drives onto it costs nothing even if
//     someone steps out while she is on it (they walked out in front of her; SSP-089's gap check makes them
//     wait for traffic). Decided in SSP-085 from the issue's rule ("one offence per entry episode").
//   - the offence is a penalty fact through the one penalty API (pushPenalty(Offence.Zebra, pts, complaints);
//     phase 9 takes the points, resets the chain and files the complaint, EV.Complaint with reason Zebra) at
//     the person on the zebra nearest Bessie, so the complaint's popup and its `ped_oi` (AUDIO_DESIGN §5.5)
//     come from the one she drove at.
// Occupancy counts every NPC on the stripes (SSP-081), so a cat or a pigeon on a zebra makes it occupied too.
//
// One phase-7 call (stepZebras), not two: like stepReactions, it keeps World.step's inlining as it was (the
// §17 heap check of m1_drive_puddle_lane is sensitive to it).
//
// Hot path: allocation-free; positions cross calls only through typed arrays and the Obb/Aabb scratch.
import { refreshObbAxes } from '../collision/obb.ts';
import { obbVsRectMasked, RECT_OPEN_ALL } from '../collision/sat.ts';
import { Offence } from '../complaints.ts';
import { pushPenalty } from '../penalties.ts';
import type { World } from '../world.ts';
import { updateZebraOccupancy } from './steering.ts';
import { NPC_FLAG } from './store.ts';

/** Phase 7, after the behaviours: the zebras' occupancy, then the occupied-zebra offence (see the header). */
export function stepZebras(w: World): void {
  updateZebraOccupancy(w);
  stepZebraOffences(w);
}

/** The occupied-zebra offence check against this tick's occupancy (see the header). Allocation-free. */
export function stepZebraOffences(w: World): void {
  const z = w.zebras;
  if (z.count === 0) return;
  const v = w.vehicle;
  const body = w.tuning.vehicle.sweeper.body;
  const obb = z.obb;
  obb.cx = v.xM;
  obb.cy = v.yM;
  obb.headingRad = v.headingRad;
  obb.halfWidthM = body.widthM * 0.5;
  obb.halfLengthM = body.lengthM * 0.5;
  refreshObbAxes(obb);
  const rect = z.rect;
  for (let k = 0; k < z.count; k += 1) {
    rect.minX = z.minX[k] as number;
    rect.minY = z.minY[k] as number;
    rect.maxX = z.maxX[k] as number;
    rect.maxY = z.maxY[k] as number;
    if (!obbVsRectMasked(obb, rect, RECT_OPEN_ALL, z.contact)) {
      z.bessieOn[k] = 0;
      continue;
    }
    if (z.bessieOn[k] === 1) continue;
    z.bessieOn[k] = 1;
    if ((z.occupancy[k] as number) > 0) runZebra(w, k);
  }
}

/** Bessie drove onto occupied zebra `k`: the penalty fact, at the person on it nearest her. */
function runZebra(w: World, k: number): void {
  const z = w.zebras;
  const zebra = w.tuning.complaints.zebra;
  z.offences += 1;
  const log = w.penalties;
  const p = pushPenalty(log, Offence.Zebra, zebra.pts, zebra.complaints);
  const npc = w.npc;
  const v = w.vehicle;
  const minX = z.minX[k] as number;
  const minY = z.minY[k] as number;
  const maxX = z.maxX[k] as number;
  const maxY = z.maxY[k] as number;
  log.x[p] = v.xM;
  log.y[p] = v.yM;
  let bestD2 = Number.POSITIVE_INFINITY;
  for (let i = 0; i < npc.count; i += 1) {
    if (((npc.flags[i] as number) & NPC_FLAG.GHOST) !== 0) continue;
    const x = npc.x[i] as number;
    const y = npc.y[i] as number;
    if (!(x >= minX && x < maxX && y >= minY && y < maxY)) continue;
    const dx = x - v.xM;
    const dy = y - v.yM;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) {
      bestD2 = d2;
      log.x[p] = x;
      log.y[p] = y;
    }
  }
}
