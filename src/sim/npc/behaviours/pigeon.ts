// npc.pigeon, the pigeon flocks (ENTITY_CATALOG §7.1, §7.4, §3.2; GDD §10.3; LEVEL_DESIGN §9.4; TECHNICAL_DESIGN
// §9.4, §11.1; SSP-088). The spawner places each flock of the level's `spawns.npc.flocks` as `size` birds within
// ±1.5 m of a flock point (spawner.ts placeFlocks); every bird is its own NPC (so a flock of 12 is 12 of the 80)
// and carries its flock's number in the store's `group`. A flock acts as one: the first of its birds to tick on a
// tick (the lowest index; phase 7 ticks in index order) runs the flock's step for the tick, and every bird then
// does its own part (stand and peck, or fly to its landing spot).
//
// Birds (PIGEON, the store's `state`; the frames are ENTITY_CATALOG §7.1's peck ×2 and fly ×3):
//   Peck   on the ground, pecking, still (speed 0).
//   Fly    flying straight to its landing spot (store timerA, timerB: x, y in whole millimetres) at
//          entities.json rules.flyMps (8 m/s), heading along its line; on the tick it reaches the spot it lands
//          there (Peck). Nothing stops it: a ghost in the air crosses props, NPCs and buildings alike.
// Every bird is a ghost (NPC_FLAG.GHOST, set as it spawns; ENTITY_CATALOG §3.2): it has no entities.json `hit`,
// so Bessie's actor contact never touches it (no hit, no bump, no penalty, no complaint), steering's NPC
// separation and constraints let people walk through it, and it never counts as someone on a zebra. It ignores
// every stimulus (horn, spray, hi-vis, beacon).
//
// The flock (PigeonFlocks, one slot per flock number; FLOCK_MODE):
//   Ground   every bird pecking where it landed.
//   Scatter  (§7.4 "scatters at 4 m and lands 10 m away") on the first flock step that finds Bessie's body
//            outline within rules.scatterM (4 m, edge included) of any bird's centre (businessman.ts
//            gapToBessieM's measure: tuning.json body.widthM × lengthM round her pose), from Ground or Gather: every bird
//            takes off that tick for a spot rules.landM (10 m) away, all along one direction, so the flock keeps
//            its shape. The direction is away from Bessie (her body centre to the flock's centre; her heading if
//            they coincide), or the first of LAND_TURNS_DEG turned off it whose landing centre is on the map,
//            off every blocked tile and farther than scatterM + the flock's radius from her body (so the flock
//            never lands inside its own scatter range); with none, the one of those on the map and off blocked
//            tiles farthest from her, else straight away. A bird whose own spot would be off the map or on a
//            blocked tile lands on the flock's landing centre instead. The scatter ends (Ground) on the first
//            flock step with every bird landed; a Bessie still within 4 m then scatters it again.
//   Gather   (§7.4 "gathers around chips", §4.2: a chip wrapper attracts the flock) once a second (the flock
//            steps where tick mod 60 == flock mod 60), on the ground for at least GATHER_REST_TICKS since it
//            landed: the litter.chip_wrapper nearest the flock's centre within rules.gatherM (10 m), at rest
//            (not flung or pinned to the bumper), more than GATHER_MIN_M from the centre and farther than
//            scatterM + GATHER_CLEAR_M from Bessie's body, draws it: every bird flies to the wrapper plus its
//            offset from the flock's centre (onto the wrapper itself where that would be off the map or on a
//            blocked tile), so the flock pecks round the chips. No bonus. Gather ends (Ground) when all have landed.
// Pigeon Scatter (GDD §10.3 +25; ENTITY_CATALOG §7.4 "once per flock per scatter"). "Driving through a flock" is
// not defined in the docs; the reading proposed by SSP-088 (owner to review): Bessie's body OBB overlaps the
// flock's circle (the circle round its birds' centres as they took off, plus a bird's radius) on any flock step
// while that scatter runs, from the take-off tick through the landing tick. The first such tick emits
// EV.PigeonScatter (entity = the flock, a, b = the circle's centre, c = rules.scatterPts) and marks the scatter
// paid; phase 9 awards it through the bonus API (scoring.ts: never multiplied, the chain and its timer untouched).
// The circle stays where the flock was, so the bonus asks for a run at the flock: the birds leave at 8 m/s, and
// from 4 m off Bessie reaches the circle in the 1.25 s of the flight only above about 3 m/s.
//
// Numbers: scatterM, landM and scatterPts are the catalog's; flyMps (8 m/s, 10 m in 1.25 s) and gatherM (10 m)
// were proposed in SSP-088 (TBD (M3 tuning), owner to review), as were the constants below.
//
// Hot path: no allocation; positions cross calls only through typed arrays.

import type { Aabb } from '../../collision/obb.ts';
import { SIM_HZ, TILE_M } from '../../constants.ts';
import { type Entities, LITTER_IDS, NPC_IDS } from '../../entities.ts';
import { EV, emitEvent } from '../../eventQueue.ts';
import { atan2, cos, sin, sqrt } from '../../fmath.ts';
import { LITTER_CAPACITY, LitterFlag, queryLitter } from '../../litter.ts';
import type { Level } from '../../map.ts';
import type { World } from '../../world.ts';
import type { Behaviour } from '../behaviour.ts';
import { STEER_TILE } from '../steering.ts';
import { NPC_FLAG, NpcOrigin, setNpcState, updateNpcCell } from '../store.ts';

/** A bird's states. Hashed (store `state`): append, never renumber. */
export const PIGEON = { Peck: 0, Fly: 1 } as const;
export type PigeonState = (typeof PIGEON)[keyof typeof PIGEON];

/** A flock's modes (PigeonFlocks.mode). Hashed: append, never renumber. */
export const FLOCK_MODE = { Ground: 0, Scatter: 1, Gather: 2 } as const;
export type FlockMode = (typeof FLOCK_MODE)[keyof typeof FLOCK_MODE];

/** Ticks between two looks for chips by one flock (once a second, staggered by flock number). */
export const GATHER_EVERY_TICKS = SIM_HZ;
/** A flock stays on the ground at least this long after landing before it gathers: 3 s. */
export const GATHER_REST_TICKS = 3 * SIM_HZ;
/** A wrapper this close to the flock's centre is already being pecked, metres. */
export const GATHER_MIN_M = 1;
/** A wrapper draws the flock only if it lies farther than scatterM + this from Bessie's body, metres. */
export const GATHER_CLEAR_M = 2;
/** A landing spot keeps this far inside the map edge, metres. */
export const LAND_EDGE_M = 0.5;
/** The scatter directions tried, as turns off straight away from Bessie, degrees, in order. */
export const LAND_TURNS_DEG: readonly number[] = [0, 30, -30, 60, -60, 90, -90, 120, -120, 150, -150, 180];
const TURNS = LAND_TURNS_DEG.length;
const TURN_COS = Float64Array.from(LAND_TURNS_DEG, (d) => cos((d * Math.PI) / 180));
const TURN_SIN = Float64Array.from(LAND_TURNS_DEG, (d) => sin((d * Math.PI) / 180));

/** Every flock's shared state, one slot per flock number, plus the pigeons' numbers. Create with createPigeonFlocks. */
export type PigeonFlocks = {
  /** Flock slots: every flock the level's flock specs can place (spawner flocksPlaced numbers them 0..). */
  readonly count: number;
  /** FLOCK_MODE per flock. */
  readonly mode: Uint8Array;
  /** The tick the flock's step last ran (−1 before its first). */
  readonly stepTick: Int32Array;
  /** The tick its last flight landed (the gather rest counts from it). */
  readonly landedTick: Int32Array;
  /** The flock's circle: its centre (the birds' mean, updated every step) and, from a take-off, its radius. */
  readonly circleX: Float64Array;
  readonly circleY: Float64Array;
  readonly circleR: Float64Array;
  /** 1 once the running scatter has paid its Pigeon Scatter. */
  readonly bonusPaid: Uint8Array;
  /** Scatters and gathers per flock this shift. */
  readonly scatters: Int32Array;
  readonly gathers: Int32Array;
  /** Pigeon Scatter bonuses this shift. */
  bonuses: number;
  /** entities.json npc.pigeon rules, metres, m per tick and points. */
  readonly scatterM: number;
  readonly landM: number;
  readonly flyMps: number;
  readonly flyStepM: number;
  readonly gatherM: number;
  readonly scatterPts: number;
  /** NPC_IDS index of npc.pigeon, LITTER_IDS index of litter.chip_wrapper. */
  readonly pigeonKind: number;
  readonly chipKind: number;
  /** Scratch: a gap to Bessie's body (gapToBessieAt), the landing spots, a litter query box and its results. */
  readonly gap: Float64Array;
  readonly landX: Float64Array;
  readonly landY: Float64Array;
  readonly box: Aabb;
  readonly found: Int32Array;
};

/** The flock table for a shift on `level` (one slot per flock its specs can place). Setup only. */
export function createPigeonFlocks(level: Level, entities: Entities): PigeonFlocks {
  let count = 0;
  for (const f of level.npc?.flocks ?? []) count += f.count;
  const rules = entities.npcs['npc.pigeon'].rules;
  const n = Math.max(1, count);
  return {
    count,
    mode: new Uint8Array(n),
    stepTick: new Int32Array(n).fill(-1),
    // Flocks are placed after shift start, so one can gather on its first look.
    landedTick: new Int32Array(n).fill(-GATHER_REST_TICKS),
    circleX: new Float64Array(n),
    circleY: new Float64Array(n),
    circleR: new Float64Array(n),
    bonusPaid: new Uint8Array(n),
    scatters: new Int32Array(n),
    gathers: new Int32Array(n),
    bonuses: 0,
    scatterM: rules.scatterM,
    landM: rules.landM,
    flyMps: rules.flyMps,
    flyStepM: rules.flyMps / SIM_HZ,
    gatherM: rules.gatherM,
    scatterPts: rules.scatterPts,
    pigeonKind: NPC_IDS.indexOf('npc.pigeon'),
    chipKind: LITTER_IDS.indexOf('litter.chip_wrapper'),
    gap: new Float64Array(1),
    landX: new Float64Array(2),
    landY: new Float64Array(2),
    // Fractional values first so the fields start as doubles (TECHNICAL_DESIGN §17, deprecated maps).
    box: { minX: 0.5, minY: 0.5, maxX: 0.5, maxY: 0.5 },
    found: new Int32Array(LITTER_CAPACITY),
  };
}

/**
 * Write into fl.gap[0] the distance from (xs[j], ys[j]) to the outline of Bessie's body (0 inside it), metres:
 * businessman.ts gapToBessieM for any point. Written to a typed array rather than returned, so a call V8 does not
 * inline boxes no double (TECHNICAL_DESIGN §17, trap 1).
 */
function gapToBessieAt(w: World, xs: Float64Array, ys: Float64Array, j: number): void {
  const v = w.vehicle;
  const body = w.tuning.vehicle.sweeper.body;
  const dx = (xs[j] as number) - v.xM;
  const dy = (ys[j] as number) - v.yM;
  const s = sin(v.headingRad);
  const c = cos(v.headingRad);
  let along = dx * s - dy * c;
  let across = dx * c + dy * s;
  if (along < 0) along = -along;
  if (across < 0) across = -across;
  along -= body.lengthM * 0.5;
  across -= body.widthM * 0.5;
  if (along < 0) along = 0;
  if (across < 0) across = 0;
  w.npcAi.flocks.gap[0] = sqrt(along * along + across * across);
}

/** True when (xs[j], ys[j]) is at least LAND_EDGE_M inside the map and not on a blocked tile. */
function landable(w: World, xs: Float64Array, ys: Float64Array, j: number): boolean {
  const st = w.npcAi.steering;
  const x = xs[j] as number;
  const y = ys[j] as number;
  if (!(x >= LAND_EDGE_M && y >= LAND_EDGE_M)) return false;
  if (!(x <= st.widthTiles * TILE_M - LAND_EDGE_M && y <= st.heightTiles * TILE_M - LAND_EDGE_M))
    return false;
  const tx = Math.floor(x / TILE_M);
  const ty = Math.floor(y / TILE_M);
  return ((st.tileFlags[ty * st.widthTiles + tx] as number) & STEER_TILE.BLOCKED) === 0;
}

/** Is NPC `i` a bird of flock `f` and kind `kind`? */
function inFlock(w: World, i: number, f: number, kind: number): boolean {
  const npc = w.npc;
  return (
    (npc.kind[i] as number) === kind &&
    (npc.group[i] as number) === f &&
    (npc.origin[i] as number) === NpcOrigin.Flock
  );
}

/** Send bird `i` flying to the spot (fl.landX[1], fl.landY[1]), or to fl.landX[0], landY[0] if that is not landable. */
function takeOff(w: World, i: number): void {
  const npc = w.npc;
  const fl = w.npcAi.flocks;
  const k = landable(w, fl.landX, fl.landY, 1) ? 1 : 0;
  const tx = Math.round((fl.landX[k] as number) * 1000);
  const ty = Math.round((fl.landY[k] as number) * 1000);
  npc.timerA[i] = tx;
  npc.timerB[i] = ty;
  const dx = tx / 1000 - (npc.x[i] as number);
  const dy = ty / 1000 - (npc.y[i] as number);
  if (dx * dx + dy * dy > 1e-12) npc.heading[i] = atan2(dx, -dy);
  setNpcState(npc, i, PIGEON.Fly);
  npc.speed[i] = fl.flyMps;
}

/**
 * Scatter flock `f` (see the header): its circle's radius round the centre the step wrote, the landing
 * direction, and every bird into the air.
 */
function startScatter(w: World, f: number, kind: number): void {
  const npc = w.npc;
  const fl = w.npcAi.flocks;
  const v = w.vehicle;
  const cx = fl.circleX[f] as number;
  const cy = fl.circleY[f] as number;
  let r2 = 0;
  let birdR = 0;
  for (let i = 0; i < npc.count; i += 1) {
    if (!inFlock(w, i, f, kind)) continue;
    const dx = (npc.x[i] as number) - cx;
    const dy = (npc.y[i] as number) - cy;
    const d2 = dx * dx + dy * dy;
    if (d2 > r2) r2 = d2;
    const r = npc.radius[i] as number;
    if (r > birdR) birdR = r;
  }
  const radius = sqrt(r2) + birdR;
  fl.circleR[f] = radius;
  // Away from Bessie: her body centre to the flock's centre, or her heading when they coincide.
  let ux = cx - v.xM;
  let uy = cy - v.yM;
  const len = sqrt(ux * ux + uy * uy);
  if (len > 1e-6) {
    ux /= len;
    uy /= len;
  } else {
    ux = sin(v.headingRad);
    uy = -cos(v.headingRad);
  }
  const land = fl.landM;
  const clear = fl.scatterM + radius;
  let pick = -1;
  let best = -1;
  let bestGap = -1;
  for (let t = 0; t < TURNS; t += 1) {
    const c = TURN_COS[t] as number;
    const s = TURN_SIN[t] as number;
    fl.landX[0] = cx + (ux * c - uy * s) * land;
    fl.landY[0] = cy + (ux * s + uy * c) * land;
    if (!landable(w, fl.landX, fl.landY, 0)) continue;
    gapToBessieAt(w, fl.landX, fl.landY, 0);
    const gap = fl.gap[0] as number;
    if (gap > clear) {
      pick = t;
      break;
    }
    if (gap > bestGap) {
      bestGap = gap;
      best = t;
    }
  }
  if (pick < 0) pick = best < 0 ? 0 : best;
  const c = TURN_COS[pick] as number;
  const s = TURN_SIN[pick] as number;
  const mx = (ux * c - uy * s) * land;
  const my = (ux * s + uy * c) * land;
  fl.landX[0] = cx + mx;
  fl.landY[0] = cy + my;
  for (let i = 0; i < npc.count; i += 1) {
    if (!inFlock(w, i, f, kind)) continue;
    fl.landX[1] = (npc.x[i] as number) + mx;
    fl.landY[1] = (npc.y[i] as number) + my;
    takeOff(w, i);
  }
  fl.mode[f] = FLOCK_MODE.Scatter;
  fl.bonusPaid[f] = 0;
  fl.scatters[f] = (fl.scatters[f] as number) + 1;
}

/** Pay flock `f`'s Pigeon Scatter if Bessie's body overlaps its circle and the scatter has not paid yet. */
function checkScatterBonus(w: World, f: number): void {
  const fl = w.npcAi.flocks;
  if ((fl.bonusPaid[f] as number) !== 0) return;
  gapToBessieAt(w, fl.circleX, fl.circleY, f);
  if ((fl.gap[0] as number) > (fl.circleR[f] as number)) return;
  fl.bonusPaid[f] = 1;
  fl.bonuses += 1;
  const e = emitEvent(w.events, EV.PigeonScatter, f);
  w.events.a[e] = fl.circleX[f] as number;
  w.events.b[e] = fl.circleY[f] as number;
  w.events.c[e] = fl.scatterPts;
}

/** Once a second on the ground: fly to the nearest chip wrapper in reach, if there is one (see the header). */
function maybeGather(w: World, f: number, kind: number): void {
  const fl = w.npcAi.flocks;
  const tick = w.tick;
  if (tick - (fl.landedTick[f] as number) < GATHER_REST_TICKS) return;
  if (tick % GATHER_EVERY_TICKS !== f % GATHER_EVERY_TICKS) return;
  const cx = fl.circleX[f] as number;
  const cy = fl.circleY[f] as number;
  const reach = fl.gatherM;
  const box = fl.box;
  box.minX = cx - reach;
  box.minY = cy - reach;
  box.maxX = cx + reach;
  box.maxY = cy + reach;
  const litter = w.litter;
  const n = queryLitter(litter, box, fl.found);
  const clear = fl.scatterM + GATHER_CLEAR_M;
  let item = -1;
  let bestD2 = reach * reach;
  for (let k = 0; k < n; k += 1) {
    const j = fl.found[k] as number;
    if ((litter.kind[j] as number) !== fl.chipKind) continue;
    if (((litter.flags[j] as number) & (LitterFlag.Flung | LitterFlag.Pinned)) !== 0) continue;
    const dx = (litter.x[j] as number) - cx;
    const dy = (litter.y[j] as number) - cy;
    const d2 = dx * dx + dy * dy;
    if (d2 > bestD2 || d2 <= GATHER_MIN_M * GATHER_MIN_M) continue;
    if (d2 === bestD2 && item >= 0) continue;
    gapToBessieAt(w, litter.x, litter.y, j);
    if ((fl.gap[0] as number) <= clear) continue;
    item = j;
    bestD2 = d2;
  }
  if (item < 0) return;
  const npc = w.npc;
  const ix = litter.x[item] as number;
  const iy = litter.y[item] as number;
  fl.landX[0] = ix;
  fl.landY[0] = iy;
  for (let i = 0; i < npc.count; i += 1) {
    if (!inFlock(w, i, f, kind)) continue;
    fl.landX[1] = ix + (npc.x[i] as number) - cx;
    fl.landY[1] = iy + (npc.y[i] as number) - cy;
    takeOff(w, i);
  }
  fl.mode[f] = FLOCK_MODE.Gather;
  fl.gathers[f] = (fl.gathers[f] as number) + 1;
}

/** Flock `f`'s step for this tick, run by its first bird to tick (see the header). */
function stepFlock(w: World, f: number, kind: number): void {
  const npc = w.npc;
  const fl = w.npcAi.flocks;
  let n = 0;
  let sx = 0;
  let sy = 0;
  let flying = 0;
  let minGap = Number.POSITIVE_INFINITY;
  for (let i = 0; i < npc.count; i += 1) {
    if (!inFlock(w, i, f, kind)) continue;
    n += 1;
    sx += npc.x[i] as number;
    sy += npc.y[i] as number;
    if ((npc.state[i] as number) === PIGEON.Fly) flying += 1;
    gapToBessieAt(w, npc.x, npc.y, i);
    const gap = fl.gap[0] as number;
    if (gap < minGap) minGap = gap;
  }
  if (n === 0) return;
  let mode = fl.mode[f] as number;
  if (mode === FLOCK_MODE.Scatter) {
    if (flying > 0) {
      // The circle stays where the flock took off.
      checkScatterBonus(w, f);
      return;
    }
    mode = FLOCK_MODE.Ground;
    fl.mode[f] = mode;
    fl.landedTick[f] = w.tick;
  }
  fl.circleX[f] = sx / n;
  fl.circleY[f] = sy / n;
  if (minGap <= fl.scatterM) {
    startScatter(w, f, kind);
    checkScatterBonus(w, f);
    return;
  }
  if (mode === FLOCK_MODE.Gather) {
    if (flying > 0) return;
    fl.mode[f] = FLOCK_MODE.Ground;
    fl.landedTick[f] = w.tick;
    return;
  }
  maybeGather(w, f, kind);
}

/** One tick of flight for bird `i`: straight at its landing spot, landing on the tick it gets there. */
function fly(w: World, i: number): void {
  const npc = w.npc;
  const tx = (npc.timerA[i] as number) / 1000;
  const ty = (npc.timerB[i] as number) / 1000;
  const dx = tx - (npc.x[i] as number);
  const dy = ty - (npc.y[i] as number);
  const d = sqrt(dx * dx + dy * dy);
  const step = w.npcAi.flocks.flyStepM;
  if (d <= step) {
    npc.x[i] = tx;
    npc.y[i] = ty;
    npc.speed[i] = 0;
    setNpcState(npc, i, PIGEON.Peck);
  } else {
    npc.x[i] = (npc.x[i] as number) + (dx / d) * step;
    npc.y[i] = (npc.y[i] as number) + (dy / d) * step;
  }
  updateNpcCell(npc, i);
}

/** A bird's tick: its flock's step first if no bird of the flock has run it this tick, then its own part. */
function tickPigeon(w: World, i: number): void {
  const npc = w.npc;
  const fl = w.npcAi.flocks;
  const f = npc.group[i] as number;
  if ((npc.origin[i] as number) === NpcOrigin.Flock && f >= 0 && f < fl.count) {
    if ((fl.stepTick[f] as number) !== w.tick) {
      fl.stepTick[f] = w.tick;
      stepFlock(w, f, npc.kind[i] as number);
    }
  }
  if ((npc.state[i] as number) === PIGEON.Fly) fly(w, i);
  else npc.speed[i] = 0;
}

export const pigeonBehaviour: Behaviour = {
  initial: PIGEON.Peck,
  jaywalks: true,
  tick: tickPigeon,
  onStimulus(): void {
    // Horn, spray, hi-vis and the beacon mean nothing to a pigeon; only Bessie's approach scatters it.
  },
  onSpawn(w: World, i: number): void {
    const npc = w.npc;
    npc.flags[i] = (npc.flags[i] as number) | NPC_FLAG.GHOST;
    // Facing one of its 4 directions (S, W, N, E: ENTITY_CATALOG §7.1), picked by its handle slot rather than a
    // draw, so placing a flock leaves the `npc` stream as it was.
    npc.heading[i] = ((npc.handleSlot[i] as number) & 3) * (Math.PI / 2);
    npc.speed[i] = 0;
  },
};
