// Actor-hit properties (SSP-082; ENTITY_CATALOG §3.2, TECHNICAL_DESIGN §9.4).
//
//   1. The closing-speed rule, over random poses, velocities and yaw rates of Bessie and random actor circles
//      touching her body: a touch is a hit exactly when her velocity at the contact point toward the actor (a
//      test-side rigid-body oracle: the rear-axle velocity plus yaw × the lever arm from the rear axle, along the
//      closest-point direction) is at least streetLife.actorHit.minClosingSpeedMps, and a bump otherwise; a hit
//      records exactly one Offence.Hit penalty fact with the kind's entities.json pts and complaints and one
//      EV.NpcHit, a bump neither.
//   2. Contact episodes, over random straight drives through a crowd of people: no actor is hit while FALLEN or
//      within 1.5 s (90 ticks) of its last touch, so hits on one actor are at least 90 ticks apart; every hit is
//      one EV.NpcHit and one applied penalty with its kind's points.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createObb, refreshObbAxes } from '../../src/sim/collision/obb.ts';
import { obbVsCircle } from '../../src/sim/collision/sat.ts';
import { Offence } from '../../src/sim/complaints.ts';
import { NPC_IDS, type NpcId } from '../../src/sim/entities.ts';
import { countEvents, EV } from '../../src/sim/eventQueue.ts';
import { cos, sin } from '../../src/sim/fmath.ts';
import { createInputFrame } from '../../src/sim/inputFrame.ts';
import { Stimulus } from '../../src/sim/npc/behaviour.ts';
import { stepActorContacts } from '../../src/sim/npc/reactions.ts';
import { addNpcAt, NPC_FLAG, NpcOrigin, npcHandle, resolveNpcHandle } from '../../src/sim/npc/store.ts';
import { DEFAULT_ENTITIES, DEFAULT_TUNING } from '../../src/sim/tuning.ts';
import { createWorld, type World } from '../../src/sim/world.ts';
import { endlessShiftTuning } from '../support/endlessShift.ts';
import { assertProperty } from '../support/fcCheck.ts';
import { npcTown } from '../support/npcTown.ts';

const BODY = DEFAULT_TUNING.vehicle.sweeper.body;
const HW = BODY.widthM / 2;
const HL = BODY.lengthM / 2;
const REAR_M = BODY.rearAxleOffsetM;
const MIN_CLOSING = DEFAULT_TUNING.streetLife.actorHit.minClosingSpeedMps;
const PEOPLE: readonly NpcId[] = [
  'npc.shopper',
  'npc.old_woman',
  'npc.old_man_frame',
  'npc.dog_walker',
  'npc.litterbug',
  'npc.businessman',
  'npc.mum_pushchair',
  'npc.postie',
  'npc.market_trader',
];
const LEVEL = npcTown(48, {}).level;
/** The meter never reaches SACKED here, so a World with many hits keeps running. */
const NO_SACK = endlessShiftTuning((raw) => {
  raw.complaints.meter.sackedAt = 1_000_000;
});

/**
 * A double uniform in [min, max] (or [min, max) when `maxExcluded`), on a 2^20 grid: fc.double is uniform over
 * bit patterns, so it mostly draws values near 0.
 */
function uniform(min: number, max: number, maxExcluded = false): fc.Arbitrary<number> {
  const steps = 1 << 20;
  return fc
    .integer({ min: 0, max: maxExcluded ? steps - 1 : steps })
    .map((k) => min + ((max - min) * k) / steps);
}

function addPerson(world: World, id: NpcId, x: number, y: number, radiusM: number): number {
  const kind = NPC_IDS.indexOf(id);
  const i = addNpcAt(world.npc, kind, NpcOrigin.Ambient, x, y);
  world.npc.radius[i] = radiusM;
  world.npc.walkMps[i] = world.npcAi.spawner.speedByKind[kind] as number;
  world.npc.state[i] = world.npcAi.behaviours[kind]?.initial ?? 0;
  return i;
}

/**
 * The oracle: Bessie's closing speed toward a circle whose centre is (lx, ly) in her body frame (x right, y
 * forward from her centre), outside her box, of radius r. null when the centre is inside the box or on its outline.
 */
function oracleClosing(
  lx: number,
  ly: number,
  r: number,
  vLong: number,
  vLat: number,
  yaw: number,
): number | null {
  const qx = Math.min(HW, Math.max(-HW, lx));
  const qy = Math.min(HL, Math.max(-HL, ly));
  const dx = lx - qx;
  const dy = ly - qy;
  const d = Math.hypot(dx, dy);
  // On (or within a micron of) the outline the direction is ill-conditioned; the caller skips those.
  if (d < 1e-6) return null;
  // Body frame: direction to the actor, and the contact point on her side of the circle.
  const ux = dx / d;
  const uy = dy / d;
  const px = lx - ux * r;
  const py = ly - uy * r;
  // Lever from the rear axle (at y = REAR_M in this frame). A positive yaw turns her clockwise on screen, which in
  // this right-handed-forward frame moves a point ahead of the pivot to the right: v = yaw × (ly, −lx).
  const ax = px;
  const ay = py - REAR_M;
  const vx = vLat + yaw * ay;
  const vy = vLong - yaw * ax;
  return vx * ux + vy * uy;
}

describe('the actor-hit closing-speed rule (ENTITY_CATALOG §3.2)', () => {
  it('a touch is a hit exactly when her contact-point velocity toward the actor is ≥ 1.0 m/s', () => {
    let hits = 0;
    let bumps = 0;
    assertProperty(
      fc.property(
        uniform(-Math.PI, Math.PI),
        uniform(-8, 8),
        uniform(-1.5, 1.5),
        uniform(-1.5, 1.5),
        uniform(0, 1, true),
        uniform(-0.2, 0.4),
        fc.constantFrom(...PEOPLE),
        fc.constantFrom(0.3, 0.25, 0.2),
        (heading, vLong, vLat, yaw, t, d, id, r) => {
          // A circle centre `d` beyond a point `t` of the way round her body outline (front, right, back, left;
          // body frame, x right, y forward): from just inside the box to just beyond touching.
          const u = t * 4 * (HW + HL);
          const front = 2 * HW;
          const right = front + 2 * HL;
          const back = right + 2 * HW;
          let lx: number;
          let ly: number;
          if (u < front) {
            lx = -HW + u;
            ly = HL + d;
          } else if (u < right) {
            lx = HW + d;
            ly = HL - (u - front);
          } else if (u < back) {
            lx = HW - (u - right);
            ly = -HL - d;
          } else {
            lx = -HW - d;
            ly = -HL + (u - back);
          }
          const world = createWorld(LEVEL, 3, NO_SACK);
          const v = world.vehicle;
          v.headingRad = heading;
          v.vLongMps = vLong;
          v.vLatMps = vLat;
          v.yawRateRadPerS = yaw;
          const s = sin(heading);
          const c = cos(heading);
          // Body frame → world: right = (c, s), forward = (s, −c).
          const x = v.xM + c * lx + s * ly;
          const y = v.yM + s * lx - c * ly;
          const obb = createObb();
          obb.cx = v.xM;
          obb.cy = v.yM;
          obb.headingRad = heading;
          obb.halfWidthM = HW;
          obb.halfLengthM = HL;
          refreshObbAxes(obb);
          const contact = { overlap: false, normalX: 0, normalY: 0, depthM: 0 };
          const touching = obbVsCircle(obb, x, y, r, contact);
          const closing = oracleClosing(lx, ly, r, vLong, vLat, yaw);
          if (closing !== null && Math.abs(closing - MIN_CLOSING) < 1e-6) return;
          const i = addPerson(world, id, x, y, r);
          world.events.sealed = false;
          stepActorContacts(world);
          const r0 = world.npcAi.reactions;
          const hit = DEFAULT_ENTITIES.npcs[id].hit;
          expect(r0.hits + r0.bumps).toBe(touching ? 1 : 0);
          if (touching && closing !== null) expect(r0.hits).toBe(closing >= MIN_CLOSING ? 1 : 0);
          expect(world.penalties.count).toBe(r0.hits);
          expect(countEvents(world.events, EV.NpcHit)).toBe(r0.hits);
          if (r0.hits === 1) {
            expect(world.penalties.reason[0]).toBe(Offence.Hit);
            expect(world.penalties.pts[0]).toBe(hit?.pts);
            expect(world.penalties.complaints[0]).toBe(hit?.complaints);
          }
          const q = world.npcAi.stimuli;
          let hitStim = 0;
          let bumpStim = 0;
          for (let k = 0; k < q.count; k++) {
            if (q.target[k] !== npcHandle(world.npc, i)) continue;
            if (q.type[k] === Stimulus.Hit) hitStim++;
            if (q.type[k] === Stimulus.Bump) bumpStim++;
          }
          expect([hitStim, bumpStim]).toEqual([r0.hits, r0.bumps]);
          if (touching) expect(world.npc.contactIgnore[i]).toBe(90);
          hits += r0.hits;
          bumps += r0.bumps;
        },
      ),
      { seed: 0x5582, numRuns: 3000 },
    );
    console.log(`actorHits: ${hits} hits, ${bumps} bumps in 3000 cases`);
    // Coverage: both outcomes occur often.
    expect(hits).toBeGreaterThan(300);
    expect(bumps).toBeGreaterThan(300);
  });
});

describe('contact episodes over drives through a crowd (TECHNICAL_DESIGN §9.4)', () => {
  it('never hits a FALLEN actor or one touched in the last 90 ticks; every hit is one event and one penalty', () => {
    let totalHits = 0;
    let crowdSize = 0;
    assertProperty(
      fc.property(
        uniform(-Math.PI, Math.PI),
        uniform(0.5, 8),
        fc.array(
          fc.record({
            id: fc.constantFrom(...PEOPLE),
            ahead: uniform(2, 24),
            side: uniform(-1.5, 1.5),
          }),
          { minLength: 1, maxLength: 8 },
        ),
        (heading, speed, crowd) => {
          const world = createWorld(LEVEL, 11, NO_SACK);
          const v = world.vehicle;
          v.headingRad = heading;
          const s = sin(heading);
          const c = cos(heading);
          const handles: number[] = [];
          const kinds: NpcId[] = [];
          for (const p of crowd) {
            const x = v.xM + c * p.side + s * p.ahead;
            const y = v.yM + s * p.side - c * p.ahead;
            const i = addPerson(world, p.id, x, y, DEFAULT_TUNING.streetLife.npcRadius.humanM);
            handles.push(npcHandle(world.npc, i));
            kinds.push(p.id);
          }
          const lastHit = handles.map(() => -1_000);
          const input = createInputFrame();
          let hits = 0;
          let pts = 0;
          for (let t = 0; t < 360; t++) {
            v.vLongMps = speed;
            v.vLatMps = 0;
            v.yawRateRadPerS = 0;
            v.steerRad = 0;
            const before = handles.map((h) => {
              const i = resolveNpcHandle(world.npc, h);
              return {
                fallen: i >= 0 && ((world.npc.flags[i] as number) & NPC_FLAG.FALLEN) !== 0,
                ignore: i >= 0 ? (world.npc.contactIgnore[i] as number) : 0,
              };
            });
            const applied = world.penalties.applied;
            world.step(input);
            const e = world.events;
            for (let k = 0; k < e.count; k++) {
              if (e.type[k] !== EV.NpcHit) continue;
              const h = npcHandle(world.npc, e.entity[k] as number);
              const n = handles.indexOf(h);
              expect(n).toBeGreaterThanOrEqual(0);
              const b = before[n] as { fallen: boolean; ignore: number };
              expect(b.fallen).toBe(false);
              // The window counts down once at the start of the contact pass: it must have been about to close.
              expect(b.ignore).toBeLessThanOrEqual(1);
              expect(world.tick - (lastHit[n] as number)).toBeGreaterThanOrEqual(90);
              lastHit[n] = world.tick;
              hits++;
              pts += DEFAULT_ENTITIES.npcs[kinds[n] as NpcId].hit?.pts ?? 0;
            }
            expect(world.penalties.applied - applied).toBe(countEvents(e, EV.NpcHit));
          }
          expect(world.npcAi.reactions.hits).toBe(hits);
          crowdSize += crowd.length;
          expect(world.scoring.penaltyPts).toBe(pts);
          totalHits += hits;
        },
      ),
      { seed: 0x5583, numRuns: 150 },
    );
    console.log(`actorHits: ${totalHits} hits on ${crowdSize} people over 150 drives`);
    expect(totalHits).toBeGreaterThan(100);
  });
});
