// Puddle splashes (ENTITY_CATALOG §3.4, §10; GDD §11.2; SSP-094): Bessie driving through haz.puddle above
// streetLife.splash.minSpeedMps (3 m/s) splashes the pedestrians near her. Phase 7, last step of stepReactions
// (npc/reactions.ts), after the actor contacts and before deliverStimuli, so a splashed pedestrian startles on the
// same tick.
//
// Crossings. The hazard store (hazards.ts, phase 2) keeps every puddle's crossing episode in HazardFlag.Contact:
// from the first tick her wheel rectangle overlaps it to the first tick it does not. Every tick, in store order:
//   - each puddle in contact whose episode has not splashed yet and with |vLong| above minSpeedMps emits
//     EV.Splash (entity = its store index, at its footprint centre, c = |vLong|) and is marked
//     HazardFlag.Splashed; phase 2 clears the mark with Contact. So EV.Splash (sfx.splash, fx.splash) fires once
//     per puddle crossed fast, on the first tick the crossing is above 3 m/s.
//   - Bessie is "in a puddle" while any puddle is in contact. A *crossing* runs from the tick she goes from no
//     puddle to some puddle to the tick she is in none: `episode` counts them (the first is 1), so a puddle two
//     tiles long, or two puddles touching, are one crossing.
// Pedestrians. On every tick of a crossing with |vLong| above minSpeedMps, each pedestrian within radiusM
// (1.5 m) of Bessie's body is splashed once per crossing: the gap between her body OBB (tuning body.widthM ×
// lengthM) and its circle, centre distance to the box minus its radius, is at most radiusM (the near miss's gap
// measure, §3.4). A pedestrian is a person kind (not the cat or pigeon behaviours) of origin Ambient or Named
// (not a dog walker's dog, a perch cat or a flock bird), not FALLEN (lying down after a hit) or ON_ROOF. Its
// `splashEpisode` column remembers the crossing that splashed it. A splash, in NPC query order (deterministic):
//   - counts toward `splashes`, the shift's splashed-pedestrian count. Every complaintEvery-th (3rd, 6th, …)
//     splash of the shift files 1 complaint: "every 3rd splash" read as every 3rd splashed pedestrian across
//     the shift, whatever the crossing (proposed in SSP-094, owner to review);
//   - records the penalty fact (Offence.Splash, splash.pts −50, 0 or 1 complaints) at the pedestrian, so phase 9
//     takes the points and resets the chain;
//   - emits EV.NpcSplash (entity = its index, its centre, c = the complaints filed);
//   - pushes a Splash stimulus for it: the generic pedestrian startles (Doris has no startle and walks on).
// Splashing npc.inspector for 2 complaints is M6 (SSP-214).
//
// Hot path: stepPuddleSplash allocates nothing and passes no doubles across calls. With no hazards on the level
// it returns before any double arithmetic (see npc/reactions.ts on the World heap check).
import { type Aabb, createAabb, createObb, type Obb, obbAabb, refreshObbAxes } from '../collision/obb.ts';
import { Offence } from '../complaints.ts';
import { type Entities, HAZARD_ENTITY_IDS, NPC_IDS } from '../entities.ts';
import { EV, emitEvent } from '../eventQueue.ts';
import { HazardFlag } from '../hazards.ts';
import { pushPenalty } from '../penalties.ts';
import type { Tuning } from '../tuning.ts';
import type { World } from '../world.ts';
import { Stimulus } from './behaviour.ts';
import { pushStimulus } from './stimuli.ts';
import { NPC_FLAG, NpcOrigin, npcHandle, queryNpcs } from './store.ts';

/** The NPC behaviours that are animals, not pedestrians: never splashed (ENTITY_CATALOG §7). */
export const SPLASH_ANIMAL_BEHAVIOURS: readonly string[] = ['cat', 'pigeon'];

/** The splash rules' state for one shift. Create with createPuddleSplash; only the sim writes it. */
export type PuddleSplash = {
  /** streetLife.splash, copied as plain fields. */
  minSpeedMps: number;
  radiusM: number;
  pts: number;
  complaintEvery: number;
  /** The haz.puddle kind (HAZARD_ENTITY_IDS index). */
  readonly puddleKind: number;
  /** Per NPC kind (NPC_IDS index): 1 for a person kind, 0 for an animal. */
  readonly isPerson: Uint8Array;
  /** Bessie was in a puddle at the end of the last splash step. */
  wet: boolean;
  /** Puddle crossings this shift; the current one while `wet` (0 before the first). */
  episode: number;
  /** Pedestrians splashed this shift: the count every complaintEvery-th of which files a complaint. */
  splashes: number;
  /** EV.Splash events this shift (puddles crossed above minSpeedMps). */
  crossingSplashes: number;
  /** Complaints the splashes filed this shift. */
  complaints: number;
  /** Scratch: Bessie's body, its AABB grown by the reach, and the NPC query output. */
  readonly obb: Obb;
  readonly box: Aabb;
  readonly found: Int32Array;
};

/** What render, audio and UI may see: the same object, typed read-only. */
export type PuddleSplashView = {
  readonly wet: boolean;
  readonly episode: number;
  readonly splashes: number;
  readonly crossingSplashes: number;
  readonly complaints: number;
};

function applyTuning(s: PuddleSplash, tuning: Tuning): void {
  const t = tuning.streetLife.splash;
  s.minSpeedMps = t.minSpeedMps;
  s.radiusM = t.radiusM;
  s.pts = t.pts;
  s.complaintEvery = t.complaintEvery;
}

/** The splash state for a shift on `tuning` and `entities`, for an NPC store of `capacity`. Setup only. */
export function createPuddleSplash(tuning: Tuning, entities: Entities, capacity: number): PuddleSplash {
  const isPerson = new Uint8Array(NPC_IDS.length);
  for (let k = 0; k < NPC_IDS.length; k += 1) {
    const behaviour = entities.npcs[NPC_IDS[k] as (typeof NPC_IDS)[number]].behaviour;
    isPerson[k] = SPLASH_ANIMAL_BEHAVIOURS.includes(behaviour) ? 0 : 1;
  }
  const s: PuddleSplash = {
    // Fractional first so the fields start as doubles (TECHNICAL_DESIGN §17, deprecated maps).
    minSpeedMps: 0.5,
    radiusM: 0.5,
    pts: 0,
    complaintEvery: 1,
    puddleKind: HAZARD_ENTITY_IDS.indexOf('haz.puddle'),
    isPerson,
    wet: false,
    episode: 0,
    splashes: 0,
    crossingSplashes: 0,
    complaints: 0,
    obb: createObb(),
    box: createAabb(),
    found: new Int32Array(capacity),
  };
  applyTuning(s, tuning);
  return s;
}

/** Hand the splash rules a new tuning between ticks (setWorldTuning). The counters and the crossing stay. */
export function setPuddleSplashTuning(s: PuddleSplash, tuning: Tuning): void {
  applyTuning(s, tuning);
}

/** Phase 7 (see the header): EV.Splash per puddle crossed fast, then the pedestrians within reach. */
export function stepPuddleSplash(w: World): void {
  const s = w.npcAi.splash;
  const hz = w.hazards;
  if (hz.count === 0) {
    s.wet = false;
    return;
  }
  const v = w.vehicle;
  const speed = v.vLongMps < 0 ? -v.vLongMps : v.vLongMps;
  const fast = speed > s.minSpeedMps;
  const puddle = s.puddleKind;
  let wet = false;
  for (let h = 0; h < hz.count; h += 1) {
    if ((hz.kind[h] as number) !== puddle) continue;
    const flags = hz.flags[h] as number;
    if ((flags & HazardFlag.Contact) === 0) continue;
    wet = true;
    if (!fast || (flags & HazardFlag.Splashed) !== 0) continue;
    hz.flags[h] = flags | HazardFlag.Splashed;
    s.crossingSplashes += 1;
    const e = emitEvent(w.events, EV.Splash, h);
    w.events.a[e] = hz.x[h] as number;
    w.events.b[e] = hz.y[h] as number;
    w.events.c[e] = speed;
  }
  if (wet && !s.wet) s.episode += 1;
  s.wet = wet;
  if (!wet || !fast) return;

  const npc = w.npc;
  if (npc.count === 0) return;
  const body = w.tuning.vehicle.sweeper.body;
  const obb = s.obb;
  obb.cx = v.xM;
  obb.cy = v.yM;
  obb.headingRad = v.headingRad;
  obb.halfWidthM = body.widthM * 0.5;
  obb.halfLengthM = body.lengthM * 0.5;
  refreshObbAxes(obb);
  const box = s.box;
  obbAabb(obb, box);
  const reach = s.radiusM + w.npcAi.steering.maxRadiusM;
  box.minX -= reach;
  box.minY -= reach;
  box.maxX += reach;
  box.maxY += reach;
  const n = queryNpcs(npc, box, s.found);
  const episode = s.episode;
  const skip = NPC_FLAG.FALLEN | NPC_FLAG.ON_ROOF;
  const hw = obb.halfWidthM;
  const hl = obb.halfLengthM;
  for (let k = 0; k < n; k += 1) {
    const i = s.found[k] as number;
    if ((npc.splashEpisode[i] as number) === episode) continue;
    if (s.isPerson[npc.kind[i] as number] !== 1) continue;
    const origin = npc.origin[i] as number;
    if (origin !== NpcOrigin.Ambient && origin !== NpcOrigin.Named) continue;
    if (((npc.flags[i] as number) & skip) !== 0) continue;
    const x = npc.x[i] as number;
    const y = npc.y[i] as number;
    const dx = x - obb.cx;
    const dy = y - obb.cy;
    const lx = dx * obb.rightX + dy * obb.rightY;
    const ly = dx * obb.forwardX + dy * obb.forwardY;
    const ax = lx < 0 ? -lx : lx;
    const ay = ly < 0 ? -ly : ly;
    const ex = ax > hw ? ax - hw : 0;
    const ey = ay > hl ? ay - hl : 0;
    const limit = s.radiusM + (npc.radius[i] as number);
    if (ex * ex + ey * ey > limit * limit) continue;

    npc.splashEpisode[i] = episode;
    const count = s.splashes + 1;
    s.splashes = count;
    const complaints = count % s.complaintEvery === 0 ? 1 : 0;
    s.complaints += complaints;
    const p = pushPenalty(w.penalties, Offence.Splash, s.pts, complaints);
    w.penalties.x[p] = x;
    w.penalties.y[p] = y;
    const e = emitEvent(w.events, EV.NpcSplash, i);
    w.events.a[e] = x;
    w.events.b[e] = y;
    w.events.c[e] = complaints;
    const q = w.npcAi.stimuli;
    const st = pushStimulus(q, Stimulus.Splash, npcHandle(npc, i));
    q.x[st] = v.xM;
    q.y[st] = v.yM;
    q.radiusM[st] = 0;
  }
}
