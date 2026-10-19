// Near-miss property (SSP-095; GDD §10.3, ENTITY_CATALOG §3.4, TECHNICAL_DESIGN §11.1): over random straight passes
// of a standing pedestrian (any heading, either side, gaps from overlapping to 1.2 m, speeds 1.5 to 8 m/s), the
// sim awards a near miss exactly when a test-side oracle says so: no tick of the pass had contact (the circle
// overlapping Bessie's body box, by the collision module's own test), the smallest gap between the circle and the
// box was at most 0.5 m, and Bessie was above 3 m/s on the tick that gap was first reached. Never more than once
// per pass, never with a hit, and always +25 unmultiplied.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createObb, refreshObbAxes } from '../../src/sim/collision/obb.ts';
import { createContact, obbVsCircle } from '../../src/sim/collision/sat.ts';
import { NPC_IDS } from '../../src/sim/entities.ts';
import { countEvents, EV } from '../../src/sim/eventQueue.ts';
import { createInputFrame } from '../../src/sim/inputFrame.ts';
import { pedestrianBehaviour } from '../../src/sim/npc/behaviours/pedestrian.ts';
import {
  addNpcAt,
  NpcOrigin,
  npcHandle,
  resolveNpcHandle,
  setNpcState,
  updateNpcCell,
} from '../../src/sim/npc/store.ts';
import { DEFAULT_TUNING } from '../../src/sim/tuning.ts';
import { createWorld } from '../../src/sim/world.ts';
import { assertProperty } from '../support/fcCheck.ts';
import { npcTown } from '../support/npcTown.ts';

const BODY = DEFAULT_TUNING.vehicle.sweeper.body;
const HALF_W = BODY.widthM / 2;
const HALF_L = BODY.lengthM / 2;
const R = DEFAULT_TUNING.streetLife.npcRadius.humanM;
const NM = DEFAULT_TUNING.streetLife.nearMiss;
const POSTIE = NPC_IDS.indexOf('npc.postie');
const neutral = createInputFrame();

/** The gap from a circle at (px, py) to the body box of a pose (negative inside), test-side. */
function gapToBody(cx: number, cy: number, heading: number, px: number, py: number): number {
  const dx = px - cx;
  const dy = py - cy;
  const lx = Math.abs(dx * Math.cos(heading) + dy * Math.sin(heading)) - HALF_W;
  const ly = Math.abs(dx * Math.sin(heading) - dy * Math.cos(heading)) - HALF_L;
  return Math.hypot(Math.max(lx, 0), Math.max(ly, 0)) - R;
}

/** A double uniform over [min, max] (fc.double favours the bounds and special values). */
function uniform(min: number, max: number): fc.Arbitrary<number> {
  return fc.integer({ min: 0, max: 1_000_000 }).map((k) => min + ((max - min) * k) / 1_000_000);
}

describe('near miss property', () => {
  it('awards exactly the passes the oracle names: no contact, closest gap ≤ 0.5 m, above 3 m/s there', () => {
    let awarded = 0;
    let contacts = 0;
    let quiet = 0;
    assertProperty(
      fc.property(
        uniform(-Math.PI, Math.PI),
        uniform(-0.25, 1.2),
        uniform(1.5, 8),
        fc.boolean(),
        uniform(-1, 1),
        (heading, gap, speed, left, aheadJitter) => {
          // Keep clear of the rules' exact boundaries, where one ulp decides.
          fc.pre(Math.abs(gap - NM.maxGapM) > 1e-6 && Math.abs(speed - NM.minSpeedMps) > 0.02);
          const world = createWorld(npcTown(48, {}).level, 951, DEFAULT_TUNING);
          world.npcAi.behaviours[POSTIE] = pedestrianBehaviour;
          const v = world.vehicle;
          v.headingRad = heading;
          const fx = Math.sin(heading);
          const fy = -Math.cos(heading);
          const rx = Math.cos(heading);
          const ry = Math.sin(heading);
          const side = (left ? -1 : 1) * (HALF_W + R + gap);
          const ahead = 6 + aheadJitter;
          const px = v.xM + fx * ahead + rx * side;
          const py = v.yM + fy * ahead + ry * side;
          const i0 = addNpcAt(world.npc, POSTIE, NpcOrigin.Ambient, px, py);
          world.npc.radius[i0] = R;
          setNpcState(world.npc, i0, pedestrianBehaviour.initial);
          const h = npcHandle(world.npc, i0);
          const obb = createObb();
          obb.halfWidthM = HALF_W;
          obb.halfLengthM = HALF_L;
          const contact = createContact();
          const ticks = Math.ceil(((ahead + HALF_L + 3) / speed) * 60) + 10;
          let touched = false;
          let minGap = Number.POSITIVE_INFINITY;
          let fastAtMin = false;
          let nearMisses = 0;
          let hits = 0;
          for (let t = 0; t < ticks; t++) {
            v.vLongMps = speed;
            v.vLatMps = 0;
            v.yawRateRadPerS = 0;
            v.steerRad = 0;
            const i = resolveNpcHandle(world.npc, h);
            world.npc.x[i] = px;
            world.npc.y[i] = py;
            updateNpcCell(world.npc, i);
            world.step(neutral);
            nearMisses += countEvents(world.events, EV.NearMiss);
            hits += countEvents(world.events, EV.NpcHit);
            // The oracle, on the pose phase 7 saw (phase 2 integrated it; nothing later moves her here).
            obb.cx = v.xM;
            obb.cy = v.yM;
            obb.headingRad = v.headingRad;
            refreshObbAxes(obb);
            if (obbVsCircle(obb, px, py, R, contact)) touched = true;
            const g = gapToBody(v.xM, v.yM, v.headingRad, px, py);
            if (g < minGap) {
              minGap = g;
              fastAtMin = v.vLongMps * v.vLongMps + v.vLatMps * v.vLatMps > NM.minSpeedMps * NM.minSpeedMps;
            }
          }
          // The pass is over: she is beyond the re-arm gap again.
          expect(gapToBody(v.xM, v.yM, v.headingRad, px, py)).toBeGreaterThan(NM.rearmGapM);
          fc.pre(Math.abs(minGap - NM.maxGapM) > 1e-6);
          const expected = !touched && minGap <= NM.maxGapM && fastAtMin ? 1 : 0;
          expect(nearMisses).toBe(expected);
          expect(world.scoring.bonusPts).toBe(expected * NM.pts);
          if (hits > 0) expect(nearMisses).toBe(0);
          if (expected === 1) awarded += 1;
          else if (touched) contacts += 1;
          else quiet += 1;
        },
      ),
      { seed: 9_095, numRuns: 300 },
    );
    // Coverage floors: the generator produced awards, contacts and quiet passes.
    expect(awarded).toBeGreaterThan(30);
    expect(contacts).toBeGreaterThan(20);
    expect(quiet).toBeGreaterThan(30);
  }, 120_000);
});
