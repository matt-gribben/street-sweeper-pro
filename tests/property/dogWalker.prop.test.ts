// Dog walker properties (SSP-086; ENTITY_CATALOG §3.2, TECHNICAL_DESIGN §9.4).
//
//   1. The Tangle test, segmentOverlapsObb, against a test-side separating-axis oracle over random boxes and
//      segments (the box's two axes and the segment's normal): they agree away from touching, and the reported
//      crossing point lies on the segment and inside the box.
//   2. Over random straight drives at a dog walker and its dog (walking, or held: the walker idling and the dog
//      sitting), across or along its lead: the lead never stretches past 5 m; LEAD_CROSSED
//      after each tick is the oracle's overlap of Bessie's body (after phase 3) with the lead as it stood when the
//      walker ticked; every Lead Tangle is on a tick that flag rose, never two in one crossing episode; and the
//      score is exactly −150 per Tangle and −300 per hit.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createObb, type Obb, refreshObbAxes } from '../../src/sim/collision/obb.ts';
import { NPC_IDS } from '../../src/sim/entities.ts';
import { countEvents, EV } from '../../src/sim/eventQueue.ts';
import { cos, sin } from '../../src/sim/fmath.ts';
import { createInputFrame } from '../../src/sim/inputFrame.ts';
import { DOG, segmentOverlapsObb } from '../../src/sim/npc/behaviours/dogWalker.ts';
import { enterPedestrianState, PED } from '../../src/sim/npc/behaviours/pedestrian.ts';
import {
  addNpcAt,
  NPC_FLAG,
  NpcOrigin,
  npcHandle,
  resolveNpcHandle,
  setNpcState,
} from '../../src/sim/npc/store.ts';
import { DEFAULT_ENTITIES, DEFAULT_TUNING } from '../../src/sim/tuning.ts';
import { createWorld, type World } from '../../src/sim/world.ts';
import { endlessShiftTuning } from '../support/endlessShift.ts';
import { assertProperty } from '../support/fcCheck.ts';
import { npcTown } from '../support/npcTown.ts';

const BODY = DEFAULT_TUNING.vehicle.sweeper.body;
const KIND = NPC_IDS.indexOf('npc.dog_walker');
const RULES = DEFAULT_ENTITIES.npcs['npc.dog_walker'].rules;
const HIT_PTS = DEFAULT_ENTITIES.npcs['npc.dog_walker'].hit?.pts ?? 0;
const LEVEL = npcTown(48, {}).level;
const NO_SACK = endlessShiftTuning((raw) => {
  raw.complaints.meter.sackedAt = 1_000_000;
});

/** A double uniform in [min, max] on a 2^20 grid (fc.double favours values near 0). */
function uniform(min: number, max: number): fc.Arbitrary<number> {
  const steps = 1 << 20;
  return fc.integer({ min: 0, max: steps }).map((k) => min + ((max - min) * k) / steps);
}

/**
 * The oracle: the signed separation of segment (ax, ay)–(bx, by) from `obb` on the separating axes (the box's
 * right and forward axes and the segment's normal): > 0 means apart by that much on some axis, ≤ 0 overlapping.
 */
function separation(obb: Obb, ax: number, ay: number, bx: number, by: number): number {
  const corners: [number, number][] = [];
  for (const [u, v] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ] as const) {
    corners.push([
      obb.cx + obb.rightX * u * obb.halfWidthM + obb.forwardX * v * obb.halfLengthM,
      obb.cy + obb.rightY * u * obb.halfWidthM + obb.forwardY * v * obb.halfLengthM,
    ]);
  }
  const axes: [number, number][] = [
    [obb.rightX, obb.rightY],
    [obb.forwardX, obb.forwardY],
  ];
  const len = Math.hypot(bx - ax, by - ay);
  if (len > 1e-12) axes.push([-(by - ay) / len, (bx - ax) / len]);
  let worst = Number.NEGATIVE_INFINITY;
  for (const [nx, ny] of axes) {
    const box = corners.map(([x, y]) => x * nx + y * ny);
    const s0 = ax * nx + ay * ny;
    const s1 = bx * nx + by * ny;
    const gap = Math.max(Math.min(s0, s1) - Math.max(...box), Math.min(...box) - Math.max(s0, s1));
    worst = Math.max(worst, gap);
  }
  return worst;
}

describe('the Tangle test (OBB against the lead segment)', () => {
  it('agrees with the separating-axis oracle, and its crossing point is on the segment and in the box', () => {
    const obb = createObb();
    const xs = new Float64Array(2);
    const ys = new Float64Array(2);
    const out = new Float64Array(2);
    let overlaps = 0;
    assertProperty(
      fc.property(
        uniform(-Math.PI, Math.PI),
        uniform(0.3, 2),
        uniform(0.3, 3),
        uniform(-6, 6),
        uniform(-6, 6),
        uniform(-6, 6),
        uniform(-6, 6),
        (heading, hw, hl, ax, ay, bx, by) => {
          obb.cx = 1.5;
          obb.cy = -0.5;
          obb.headingRad = heading;
          obb.halfWidthM = hw;
          obb.halfLengthM = hl;
          refreshObbAxes(obb);
          const sep = separation(obb, ax, ay, bx, by);
          fc.pre(Math.abs(sep) > 1e-7);
          xs[0] = ax;
          ys[0] = ay;
          xs[1] = bx;
          ys[1] = by;
          const hit = segmentOverlapsObb(obb, xs, ys, 0, 1, out);
          expect(hit).toBe(sep < 0);
          if (!hit) return;
          overlaps++;
          const px = (out[0] as number) - obb.cx;
          const py = (out[1] as number) - obb.cy;
          expect(Math.abs(px * obb.rightX + py * obb.rightY)).toBeLessThanOrEqual(hw + 1e-9);
          expect(Math.abs(px * obb.forwardX + py * obb.forwardY)).toBeLessThanOrEqual(hl + 1e-9);
          // On the segment: collinear with it and between its ends.
          const sx = bx - ax;
          const sy = by - ay;
          const qx = (out[0] as number) - ax;
          const qy = (out[1] as number) - ay;
          expect(Math.abs(qx * sy - qy * sx)).toBeLessThanOrEqual(1e-9 * (1 + sx * sx + sy * sy));
          const t = (qx * sx + qy * sy) / Math.max(1e-12, sx * sx + sy * sy);
          expect(t).toBeGreaterThanOrEqual(-1e-9);
          expect(t).toBeLessThanOrEqual(1 + 1e-9);
        },
      ),
      { seed: 0x5586, numRuns: 4000 },
    );
    expect(overlaps).toBeGreaterThan(400);
  });
});

function addPair(world: World, wx: number, wy: number, dx: number, dy: number): [number, number] {
  const npc = world.npc;
  const w = addNpcAt(npc, KIND, NpcOrigin.Named, wx, wy);
  npc.radius[w] = DEFAULT_TUNING.streetLife.npcRadius.humanM;
  npc.walkMps[w] = 1.2;
  setNpcState(npc, w, PED.Walk);
  const d = addNpcAt(npc, KIND, NpcOrigin.Companion, dx, dy);
  npc.radius[d] = DEFAULT_TUNING.streetLife.npcRadius.dogM;
  npc.walkMps[d] = 1.2;
  setNpcState(npc, d, PED.Walk);
  npc.link[w] = npcHandle(npc, d);
  npc.link[d] = npcHandle(npc, w);
  return [npcHandle(npc, w), npcHandle(npc, d)];
}

describe('drives at a dog walker (TECHNICAL_DESIGN §9.4)', () => {
  it('keeps the lead within 5 m, flags exactly the ticks her body is across it, and tangles once per crossing', {
    // 200 drives of 300 ticks: a few seconds, more on a loaded machine.
    timeout: 120_000,
  }, () => {
    const obb = createObb();
    let totalTangles = 0;
    let totalHits = 0;
    assertProperty(
      fc.property(
        uniform(-Math.PI, Math.PI),
        uniform(0.5, 8),
        uniform(3, 14),
        uniform(-2, 2),
        uniform(0, 4.9),
        uniform(-1.2, 1.2),
        fc.boolean(),
        fc.boolean(),
        (heading, speed, ahead, side, leadM, skew, flip, still) => {
          const world = createWorld(LEVEL, 13, NO_SACK);
          const v = world.vehicle;
          v.headingRad = heading;
          const s = sin(heading);
          const c = cos(heading);
          // The lead's middle `ahead` of her and `side` to her right, at `skew` from straight across her path
          // (the walker on the left or, flipped, on the right).
          const mx = v.xM + c * side + s * ahead;
          const my = v.yM + s * side - c * ahead;
          const dir = heading + Math.PI / 2 + skew + (flip ? Math.PI : 0);
          const hx = (Math.sin(dir) * leadM) / 2;
          const hy = (-Math.cos(dir) * leadM) / 2;
          const [hw, hd] = addPair(world, mx - hx, my - hy, mx + hx, my + hy);
          if (still) {
            // Half the drives: the walker idles and the dog sits (it still yields, startles and falls).
            enterPedestrianState(world, resolveNpcHandle(world.npc, hw), PED.Idle, 60_000);
            const d = resolveNpcHandle(world.npc, hd);
            setNpcState(world.npc, d, DOG.Sit);
            world.npc.stateLimit[d] = 60_000;
          }
          const input = createInputFrame();
          let tangles = 0;
          let hits = 0;
          let wasCrossed = false;
          for (let t = 0; t < 300; t++) {
            v.vLongMps = speed;
            v.vLatMps = 0;
            v.yawRateRadPerS = 0;
            v.steerRad = 0;
            const w0 = resolveNpcHandle(world.npc, hw);
            const d0 = resolveNpcHandle(world.npc, hd);
            const ax = world.npc.x[w0] as number;
            const ay = world.npc.y[w0] as number;
            const bx = world.npc.x[d0] as number;
            const by = world.npc.y[d0] as number;
            world.step(input);
            const w = resolveNpcHandle(world.npc, hw);
            const d = resolveNpcHandle(world.npc, hd);
            const lead = Math.hypot(
              (world.npc.x[w] as number) - (world.npc.x[d] as number),
              (world.npc.y[w] as number) - (world.npc.y[d] as number),
            );
            expect(lead).toBeLessThanOrEqual(RULES.leadMaxM);
            const crossed = ((world.npc.flags[w] as number) & NPC_FLAG.LEAD_CROSSED) !== 0;
            // The walker ticks before its dog (it was added first), so the lead it tested is where both stood.
            obb.cx = v.xM;
            obb.cy = v.yM;
            obb.headingRad = v.headingRad;
            obb.halfWidthM = BODY.widthM / 2;
            obb.halfLengthM = BODY.lengthM / 2;
            refreshObbAxes(obb);
            const sep = separation(obb, ax, ay, bx, by);
            if (Math.abs(sep) > 1e-7) expect(crossed, `tick ${t}`).toBe(sep < 0);
            const n = countEvents(world.events, EV.LeadTangle);
            expect(n).toBeLessThanOrEqual(1);
            if (n === 1) {
              expect(wasCrossed).toBe(false);
              expect(crossed).toBe(true);
            }
            tangles += n;
            hits += countEvents(world.events, EV.NpcHit);
            wasCrossed = crossed;
          }
          expect(world.scoring.penaltyPts - (RULES.tanglePts * tangles + HIT_PTS * hits)).toBe(0);
          totalTangles += tangles;
          totalHits += hits;
        },
      ),
      { seed: 0x5587, numRuns: 200 },
    );
    console.log(`dogWalker: ${totalTangles} tangles and ${totalHits} hits over 200 drives`);
    expect(totalTangles).toBeGreaterThan(15);
    expect(totalHits).toBeGreaterThan(20);
  });
});
