// The near-miss bonus and dust coughing (SSP-095; GDD §8.6, §10.2, §10.3; ENTITY_CATALOG §3.4; TECHNICAL_DESIGN
// §10.4, §11.1): near-miss passes (0.5 m, above 3 m/s, no contact, one award per pass, the 1.5 m re-arm), the
// unmultiplied +25 that leaves the chain alone, dust clouds from the gutter brushes over `%` yard ground (one per
// brush every 7 ticks, 30-tick life, none while spraying) and the −10 cough every 120 ticks in range, which resets
// the chain and files no complaint.
//
// Worlds are the open district of tests/support/npcTown.ts (48 × 48 tiles of road, no population), with Bessie at
// its centre (48, 48) facing north (forward = −y, right = +x). Pedestrians are added by hand and run the generic
// pedestrian (the registry's default for the person kinds still without a module), pinned in place by the test
// before every tick so the geometry is exact.
import { describe, expect, it } from 'vitest';
import { addComboPickup, setComboTimerMultiplier } from '../../src/sim/combo.ts';
import { Offence } from '../../src/sim/complaints.ts';
import { createDirt, createDust, DUST_CLOUD_CAPACITY, dustCloudSlot, stepDust } from '../../src/sim/dirt.ts';
import { NPC_IDS, type NpcId } from '../../src/sim/entities.ts';
import { countEvents, createEventQueue, EV, resetEvents } from '../../src/sim/eventQueue.ts';
import { BUTTON, createInputFrame, type InputFrame, PRESSED } from '../../src/sim/inputFrame.ts';
import { Ground } from '../../src/sim/map.ts';
import {
  enterPedestrianState,
  FALLEN_TICKS,
  PED,
  pedestrianBehaviour,
} from '../../src/sim/npc/behaviours/pedestrian.ts';
import { NearMissState } from '../../src/sim/npc/reactions.ts';
import {
  addNpcAt,
  NpcOrigin,
  npcHandle,
  removeNpc,
  resolveNpcHandle,
  setNpcState,
  updateNpcCell,
} from '../../src/sim/npc/store.ts';
import { DEFAULT_TUNING, type Tuning } from '../../src/sim/tuning.ts';
import { createWorld, type World } from '../../src/sim/world.ts';
import { assertHeapDeltaWithinThresholds, measureHeapDelta, requireGc } from '../support/heapDelta.ts';
import { npcTown } from '../support/npcTown.ts';

const BODY = DEFAULT_TUNING.vehicle.sweeper.body;
const HALF_W = BODY.widthM / 2;
const HALF_L = BODY.lengthM / 2;
const HUMAN_R = DEFAULT_TUNING.streetLife.npcRadius.humanM;
const BRUSH = DEFAULT_TUNING.sweeping.gutterBrush;
const NEAR_MISS = DEFAULT_TUNING.streetLife.nearMiss;
const DUST = DEFAULT_TUNING.streetLife.dust;
/** Bessie's start: the town centre. */
const CX = 48;
const CY = 48;

const neutral = createInputFrame();

function frame(buttons: number, pressed: number): InputFrame {
  const f = createInputFrame();
  f.buttons = buttons;
  f.pressed = pressed;
  return f;
}

/** The open test district; `yard` makes every tile within 6 m of Bessie's start dusty `%` yard ground. */
function townWorld(yard: boolean, tuning: Tuning = DEFAULT_TUNING): World {
  const { level } = npcTown(48, {});
  if (yard) {
    const [w] = level.size;
    for (let ty = 21; ty < 27; ty++)
      for (let tx = 21; tx < 27; tx++) level.layers.ground[ty * w + tx] = Ground.Yard;
  }
  const world = createWorld(level, 95, tuning);
  // The person kinds the tests use run the generic pedestrian, whatever module they get later.
  for (const id of ['npc.postie', 'npc.shopper'] as const)
    world.npcAi.behaviours[NPC_IDS.indexOf(id)] = pedestrianBehaviour;
  return world;
}

/** Add a person of `id` at (x, y) as the spawner would and return its handle. */
function addPerson(world: World, id: NpcId, x: number, y: number): number {
  const kind = NPC_IDS.indexOf(id);
  const i = addNpcAt(world.npc, kind, NpcOrigin.Ambient, x, y);
  if (i < 0) throw new Error('store full');
  world.npc.radius[i] = id === 'npc.cat' ? DEFAULT_TUNING.streetLife.npcRadius.catM : HUMAN_R;
  world.npc.walkMps[i] = world.npcAi.spawner.speedByKind[kind] as number;
  setNpcState(world.npc, i, world.npcAi.behaviours[kind]?.initial ?? 0);
  return npcHandle(world.npc, i);
}

/** Pin NPC `handle` at (x, y) between ticks (the test standing in for its own walk). */
function place(world: World, handle: number, x: number, y: number): number {
  const i = resolveNpcHandle(world.npc, handle);
  world.npc.x[i] = x;
  world.npc.y[i] = y;
  updateNpcCell(world.npc, i);
  return i;
}

/** Bessie rolling north at `speedMps`, wheel straight, no yaw. */
function holdBessie(world: World, speedMps: number): void {
  const v = world.vehicle;
  v.vLongMps = speedMps;
  v.vLatMps = 0;
  v.yawRateRadPerS = 0;
  v.steerRad = 0;
  v.headingRad = 0;
}

/** A 12-pickup chain (×2) going in. The queue is sealed between ticks; open it for the tier events. */
function buildChain(world: World): void {
  world.events.sealed = false;
  for (let k = 0; k < 12; k++) addComboPickup(world.scoring.combo, world.events);
  world.events.sealed = true;
}

type Pass = { nearMisses: number; hits: number; awardTick: number; stateAfterAward: number; world: World };

/**
 * Bessie rolls north at `speedMps` past a postie standing `gapM` (circle to body side; negative overlaps) to her
 * right, 5 m ahead of her centre, for 160 ticks (she clears him by more than 1.5 m well before the end).
 */
function sidePass(gapM: number, speedMps: number): Pass {
  const world = townWorld(false);
  const px = CX + HALF_W + HUMAN_R + gapM;
  const py = CY - 5;
  const h = addPerson(world, 'npc.postie', px, py);
  let nearMisses = 0;
  let hits = 0;
  let awardTick = -1;
  let stateAfterAward = -1;
  for (let t = 0; t < 160; t++) {
    holdBessie(world, speedMps);
    const i = place(world, h, px, py);
    world.step(neutral);
    const n = countEvents(world.events, EV.NearMiss);
    hits += countEvents(world.events, EV.NpcHit);
    if (n > 0) {
      awardTick = t;
      stateAfterAward = world.npc.state[i] as number;
    }
    nearMisses += n;
  }
  return { nearMisses, hits, awardTick, stateAfterAward, world };
}

describe('near miss (GDD §10.3, ENTITY_CATALOG §3.4)', () => {
  it('passing a pedestrian at 0.4 m and 3.5 m/s awards +25 once and startles them', () => {
    const p = sidePass(0.4, 3.5);
    expect(p.nearMisses).toBe(1);
    expect(p.hits).toBe(0);
    expect(p.world.scoring.bonusPts).toBe(NEAR_MISS.pts);
    expect(p.world.scoring.score).toBe(25);
    expect(p.world.scoring.penaltyPts).toBe(0);
    expect(p.world.npcAi.reactions.nearMisses).toBe(1);
    // The pedestrian took the NearMiss stimulus on the award tick: the startle's first tick.
    expect(p.stateAfterAward).toBe(PED.Startle);
    // Awarded on the tick after the gap stopped shrinking: Bessie is alongside him by then.
    const front = CY - HALF_L - 3.5 * (1 / 60) * (p.awardTick + 1);
    expect(front).toBeLessThan(CY - 5);
  });

  it('at 0.6 m, or at 2.9 m/s, there is no award', () => {
    expect(sidePass(0.6, 3.5).nearMisses).toBe(0);
    expect(sidePass(0.6, 3.5).world.scoring.score).toBe(0);
    expect(sidePass(0.4, 2.9).nearMisses).toBe(0);
    expect(sidePass(0.4, 2.9).world.scoring.score).toBe(0);
    // The edge cases on the right side of each line still award.
    expect(sidePass(0.5 - 1e-6, 3.5).nearMisses).toBe(1);
    expect(sidePass(0.4, 3.05).nearMisses).toBe(1);
  });

  it('a contact gives a hit, not a near miss', () => {
    // Head on, 0.5 m right of her centre line: the front bumper hits him at 3.5 m/s.
    const world = townWorld(false);
    const px = CX + 0.5;
    const py = CY - 5;
    const h = addPerson(world, 'npc.postie', px, py);
    let nearMisses = 0;
    let hits = 0;
    for (let t = 0; t < 160; t++) {
      holdBessie(world, 3.5);
      place(world, h, px, py);
      world.step(neutral);
      nearMisses += countEvents(world.events, EV.NearMiss);
      hits += countEvents(world.events, EV.NpcHit);
    }
    expect(hits).toBe(1);
    expect(nearMisses).toBe(0);
    expect(world.scoring.bonusPts).toBe(0);
    // A graze of her front corner (5 cm of overlap) is a contact too: one episode, no near miss.
    const graze = sidePass(-0.05, 3.5);
    expect(graze.hits + graze.world.npcAi.reactions.bumps).toBe(1);
    expect(graze.nearMisses).toBe(0);
    expect(graze.world.scoring.bonusPts).toBe(0);
  });

  it('is not multiplied and does not change the chain length or its timer', () => {
    const world = townWorld(false);
    const combo = world.scoring.combo;
    const px = CX + HALF_W + HUMAN_R + 0.4;
    const py = CY - 5;
    const h = addPerson(world, 'npc.postie', px, py);
    buildChain(world);
    expect(combo.chain).toBe(12);
    expect(combo.multiplier).toBe(2);
    let awarded = false;
    for (let t = 0; t < 110 && !awarded; t++) {
      holdBessie(world, 3.5);
      place(world, h, px, py);
      const chainBefore = combo.chain;
      const timerBefore = combo.timerTicks;
      const scoreBefore = world.scoring.score;
      world.step(neutral);
      if (countEvents(world.events, EV.NearMiss) > 0) {
        awarded = true;
        expect(world.scoring.score - scoreBefore).toBe(25); // ×1, not ×2
        expect(combo.chain).toBe(chainBefore);
        expect(combo.multiplier).toBe(2);
        // The timer only ran down: the bonus did not refresh it.
        expect(combo.timerTicks).toBe(timerBefore - 1);
        expect(countEvents(world.events, EV.ComboTier)).toBe(0);
      }
    }
    expect(awarded).toBe(true);
  });

  it('awards once per pass: a pass re-arms only after the gap exceeds 1.5 m', () => {
    const world = townWorld(false);
    const h = addPerson(world, 'npc.postie', CX + 5, CY);
    const i0 = resolveNpcHandle(world.npc, h);
    // Gaps to her right side, one per tick, alongside her centre (Bessie rolls on at 3.5 m/s; he keeps pace).
    const gaps = [2, 0.6, 0.45, 0.4, 0.4, 0.42, 1.4, 0.4, 0.3, 0.2, 1.4, 1.6, 0.45, 0.4, 0.42, 1.0];
    const awards: number[] = [];
    const states: number[] = [];
    for (let t = 0; t < gaps.length; t++) {
      holdBessie(world, 3.5);
      const gap = gaps[t] as number;
      place(world, h, world.vehicle.xM + HALF_W + HUMAN_R + gap, world.vehicle.yM);
      world.step(neutral);
      if (countEvents(world.events, EV.NearMiss) > 0) awards.push(t);
      states.push(world.npc.nearMiss[i0] as number);
    }
    // First pass: closest 0.4 at t 3, the gap stops shrinking at t 4. Within 1.5 m nothing re-arms (t 6..10),
    // however close it comes; 1.6 m at t 11 re-arms, and the second pass (closest 0.4 at t 13) awards at t 14.
    expect(awards).toEqual([4, 14]);
    expect(states[0]).toBe(NearMissState.Armed);
    expect(states[2]).toBe(NearMissState.PassingFast);
    expect(states[4]).toBe(NearMissState.Spent);
    expect(states[9]).toBe(NearMissState.Spent);
    expect(states[11]).toBe(NearMissState.Armed);
    expect(states[13]).toBe(NearMissState.PassingFast);
    expect(states[14]).toBe(NearMissState.Spent);
    expect(world.scoring.bonusPts).toBe(50);
  });

  it('only pedestrians count: a cat passed at 0.2 m earns nothing, nor does a fallen pedestrian', () => {
    const world = townWorld(false);
    const cat = addPerson(world, 'npc.cat', CX + 5, CY);
    for (let t = 0; t < 6; t++) {
      holdBessie(world, 3.5);
      const gap = [2, 0.4, 0.2, 0.3, 0.6, 2][t] as number;
      place(world, cat, world.vehicle.xM + HALF_W + 0.2 + gap, world.vehicle.yM);
      world.step(neutral);
      expect(countEvents(world.events, EV.NearMiss)).toBe(0);
    }
    expect(world.npcAi.reactions.nearMisses).toBe(0);
    // A pedestrian lying on the pavement (FALLEN) is passed at 0.4 m: contact ignores him, and so does the bonus.
    const fallen = townWorld(false);
    const h = addPerson(fallen, 'npc.postie', CX + 5, CY);
    enterPedestrianState(fallen, resolveNpcHandle(fallen.npc, h), PED.Fallen, FALLEN_TICKS);
    for (let t = 0; t < 6; t++) {
      holdBessie(fallen, 3.5);
      const gap = [2, 0.6, 0.45, 0.4, 0.42, 2][t] as number;
      place(fallen, h, fallen.vehicle.xM + HALF_W + HUMAN_R + gap, fallen.vehicle.yM);
      fallen.step(neutral);
      expect(countEvents(fallen.events, EV.NearMiss)).toBe(0);
    }
    expect(fallen.npc.state[resolveNpcHandle(fallen.npc, h)]).toBe(PED.Fallen);
    expect(fallen.npcAi.reactions.nearMisses).toBe(0);
  });
});

/** Lower the brush and run until it collects, Bessie standing still. Returns the ticks it took. */
function lowerBrush(world: World): number {
  world.step(frame(0, PRESSED.BRUSH));
  let t = 1;
  while (!world.brush.collecting) {
    world.step(neutral);
    t += 1;
    if (t > 600) throw new Error('the brush never started collecting');
  }
  return t;
}

describe('dust clouds (GDD §8.6, ART_BIBLE §11)', () => {
  it('each brush over yard ground puffs a cloud on its first collecting tick and every 7th tick after', () => {
    const world = townWorld(true);
    world.step(frame(0, PRESSED.BRUSH));
    let first = -1;
    const puffTicks: number[] = [];
    for (let t = 1; t < 200; t++) {
      world.step(neutral);
      const n = countEvents(world.events, EV.DustCloud);
      if (world.brush.collecting && first < 0) first = t;
      if (n > 0) {
        expect(n).toBe(2);
        puffTicks.push(t);
      }
    }
    expect(first).toBeGreaterThan(0);
    expect(puffTicks[0]).toBe(first);
    for (let k = 1; k < puffTicks.length; k++)
      expect((puffTicks[k] as number) - (puffTicks[k - 1] as number)).toBe(7);
    // Both brush centres, right first, in the events of a puff tick.
    world.step(neutral);
    while (countEvents(world.events, EV.DustCloud) === 0) world.step(neutral);
    const e = world.events;
    const seen: number[][] = [];
    for (let k = 0; k < e.count; k++) {
      if (e.type[k] === EV.DustCloud) seen.push([e.a[k] as number, e.b[k] as number, e.c[k] as number]);
    }
    expect(seen.length).toBe(2);
    expect(seen[0]?.[0]).toBeCloseTo(CX + BRUSH.centreXM, 9);
    expect(seen[0]?.[1]).toBeCloseTo(CY - BRUSH.centreYM, 9);
    expect(seen[0]?.[2]).toBe(1);
    expect(seen[1]?.[0]).toBeCloseTo(CX - BRUSH.centreXM, 9);
    expect(seen[1]?.[2]).toBe(-1);
    // 30-tick life, a puff every 7 ticks: at most ceil(30 / 7) = 5 clouds per brush alive.
    expect(world.dust.count).toBeLessThanOrEqual(10);
    expect(world.dust.count).toBeGreaterThanOrEqual(8);
  });

  it('brushing a dusty tile while spraying emits no dust cloud', () => {
    const world = townWorld(true);
    lowerBrush(world);
    // The first collecting tick has puffed; spray from now on.
    const before = world.dust.cloudsEmitted;
    expect(before).toBe(2);
    const spray = frame(BUTTON.SPRAY, 0);
    for (let t = 0; t < 120; t++) {
      world.step(spray);
      expect(world.water.spraying).toBe(true);
      expect(countEvents(world.events, EV.DustCloud)).toBe(0);
    }
    expect(world.dust.cloudsEmitted).toBe(before);
    // The old clouds died out 30 ticks after they rose.
    expect(world.dust.count).toBe(0);
    // Stop spraying: puffing resumes at once (the brushes' waits ran out while sprayed).
    world.step(neutral);
    expect(countEvents(world.events, EV.DustCloud)).toBe(2);
  });

  it('no dust off yard ground, with the brush up, or brush down but not yet collecting', () => {
    const road = townWorld(false);
    expect(road.dust.dustyTiles).toBe(0);
    lowerBrush(road);
    for (let t = 0; t < 60; t++) road.step(neutral);
    expect(road.dust.cloudsEmitted).toBe(0);
    const yard = townWorld(true);
    for (let t = 0; t < 60; t++) yard.step(neutral);
    expect(yard.dust.cloudsEmitted).toBe(0);
  });

  it('a cloud lives 30 ticks: born on T, live through T + 29, gone on T + 30', () => {
    const level = npcTown(8, {}).level;
    level.layers.ground.fill(Ground.Yard);
    const dust = createDust(level, DEFAULT_TUNING);
    // A real Dirt with the pose stepDirt would leave (a stand-in object would make stepDust's loads polymorphic
    // for the rest of this file's process, and the heap check below would measure that).
    const dirt = createDirt(level, DEFAULT_TUNING);
    dirt.poseX = 8;
    dirt.poseY = 8;
    dirt.poseC = 1;
    dirt.poseS = 0;
    const events = createEventQueue();
    resetEvents(events, 0);
    stepDust(dust, dirt, true, false, 100, events);
    expect(dust.count).toBe(2);
    expect(countEvents(events, EV.DustCloud)).toBe(2);
    for (let t = 101; t <= 129; t++) {
      resetEvents(events, t);
      stepDust(dust, dirt, false, false, t, events);
      expect(dust.count).toBe(2);
    }
    resetEvents(events, 130);
    stepDust(dust, dirt, false, false, 130, events);
    expect(dust.count).toBe(0);
    // A full ring drops its oldest cloud: a 1-cloud ring keeps only the newest.
    const tiny = createDust(
      level,
      {
        ...DEFAULT_TUNING,
        streetLife: { ...DEFAULT_TUNING.streetLife, dust: { ...DUST, cloudLifeTicks: 7 } },
      },
      2,
    );
    resetEvents(events, 0);
    stepDust(tiny, dirt, true, false, 0, events);
    expect(tiny.count).toBe(2);
    const slot = dustCloudSlot(tiny, 1);
    expect(tiny.x[slot]).toBeCloseTo(8 - BRUSH.centreXM, 9);
  });

  it('refuses a tuning that would keep more clouds alive than the ring holds', () => {
    const level = npcTown(8, {}).level;
    const t: Tuning = {
      ...DEFAULT_TUNING,
      streetLife: { ...DEFAULT_TUNING.streetLife, dust: { ...DUST, cloudEveryTicks: 1, cloudLifeTicks: 33 } },
    };
    expect(() => createDust(level, t)).toThrow(/keeps 66 clouds alive; the ring holds 64/);
    expect(DUST_CLOUD_CAPACITY).toBe(64);
  });
});

/** A yard world with the brush collecting and clouds already puffing, and a postie pinned `distM` east of the right brush. */
function dustWorld(
  distM: number,
  id: NpcId = 'npc.postie',
): { world: World; h: number; px: number; py: number } {
  const world = townWorld(true);
  lowerBrush(world);
  for (let t = 0; t < 10; t++) world.step(neutral);
  const px = CX + BRUSH.centreXM + distM;
  const py = CY - BRUSH.centreYM;
  const h = addPerson(world, id, px, py);
  return { world, h, px, py };
}

describe('dust coughing (GDD §8.6, §10.2, ENTITY_CATALOG §3.4)', () => {
  it('a pedestrian standing 2.5 m from continuously emitted dust for 240 ticks costs exactly −20, resets the chain and files no complaint', () => {
    const { world, h, px, py } = dustWorld(2.5);
    const combo = world.scoring.combo;
    // A 4 s chain timer, so only the cough can end it within the test.
    setComboTimerMultiplier(combo, 2);
    buildChain(world);
    expect(combo.chain).toBe(12);
    const scoreBefore = world.scoring.score;
    const coughTicks: number[] = [];
    for (let t = 1; t <= 240; t++) {
      const i = place(world, h, px, py);
      world.step(neutral);
      const n = countEvents(world.events, EV.Cough);
      if (n > 0) {
        coughTicks.push(t);
        expect(n).toBe(1);
        expect(combo.chain).toBe(0);
        // The cough plays the startle frames.
        expect(world.npc.state[i]).toBe(PED.Startle);
        const e = world.events;
        for (let k = 0; k < e.count; k++) {
          if (e.type[k] !== EV.Cough) continue;
          expect(e.entity[k]).toBe(i);
          expect(e.c[k]).toBe(NPC_IDS.indexOf('npc.postie'));
        }
      } else if (t < 120) {
        expect(combo.chain).toBe(12);
      }
    }
    expect(coughTicks).toEqual([120, 240]);
    expect(world.scoring.score - scoreBefore).toBe(-20);
    expect(world.scoring.penaltyPts).toBe(-20);
    expect(world.complaints.count).toBe(0);
    expect(world.npcAi.reactions.coughs).toBe(2);
    expect(world.penalties.applied).toBe(2);
  });

  it('records each cough as an Offence.Dust fact of −10 with no complaint', () => {
    const { world, h, px, py } = dustWorld(2.5);
    for (let t = 1; t < 120; t++) {
      place(world, h, px, py);
      world.step(neutral);
    }
    // Watch phase 9 receive the fact.
    let seen: { reason: number; pts: number; complaints: number; x: number; y: number } | null = null;
    world.phaseTrace = (phase, view) => {
      if (phase !== 9 || view.penalties.count === 0) return;
      seen = {
        reason: world.penalties.reason[0] as number,
        pts: world.penalties.pts[0] as number,
        complaints: world.penalties.complaints[0] as number,
        x: world.penalties.x[0] as number,
        y: world.penalties.y[0] as number,
      };
    };
    place(world, h, px, py);
    world.step(neutral);
    expect(seen).toEqual({ reason: Offence.Dust, pts: DUST.pts, complaints: 0, x: px, y: py });
    expect(countEvents(world.events, EV.Complaint)).toBe(0);
  });

  it('leaving the range restarts the count; beyond 3 m nobody coughs', () => {
    const { world, h, px, py } = dustWorld(2.5);
    let coughs = 0;
    for (let t = 1; t <= 100; t++) {
      place(world, h, px, py);
      world.step(neutral);
      coughs += countEvents(world.events, EV.Cough);
    }
    // One tick 4 m away from every cloud.
    place(world, h, px + 1.5, py);
    world.step(neutral);
    const i = resolveNpcHandle(world.npc, h);
    expect(world.npc.dustTicks[i]).toBe(0);
    for (let t = 1; t <= 119; t++) {
      place(world, h, px, py);
      world.step(neutral);
      coughs += countEvents(world.events, EV.Cough);
    }
    expect(coughs).toBe(0);
    place(world, h, px, py);
    world.step(neutral);
    expect(countEvents(world.events, EV.Cough)).toBe(1);

    const far = dustWorld(3.05);
    for (let t = 1; t <= 300; t++) {
      place(far.world, far.h, far.px, far.py);
      far.world.step(neutral);
    }
    expect(far.world.npcAi.reactions.coughs).toBe(0);
    expect(far.world.scoring.penaltyPts).toBe(0);
  });

  it('spraying stops the dust, so nobody coughs once the clouds have gone', () => {
    const { world, h, px, py } = dustWorld(2.5);
    const spray = frame(BUTTON.SPRAY, 0);
    for (let t = 1; t <= 240; t++) {
      place(world, h, px, py);
      world.step(spray);
    }
    expect(world.npcAi.reactions.coughs).toBe(0);
    expect(world.scoring.penaltyPts).toBe(0);
  });

  it('Doris coughs (−10) without startling; a cat in the dust does not cough', () => {
    const { world, h, px, py } = dustWorld(2.5, 'npc.old_woman');
    const cat = addPerson(world, 'npc.cat', px, py + 1);
    let doris = -1;
    for (let t = 1; t <= 120; t++) {
      doris = place(world, h, px, py);
      place(world, cat, px, py + 1);
      world.step(neutral);
    }
    expect(world.npcAi.reactions.coughs).toBe(1);
    expect(world.scoring.penaltyPts).toBe(-10);
    expect(world.npc.state[doris]).not.toBe(PED.Startle);
  });
});

describe('store and tuning', () => {
  it('a new NPC starts armed with no dust time; swap-remove carries both columns', () => {
    const world = townWorld(false);
    const store = world.npc;
    const a = addPerson(world, 'npc.postie', 10, 10);
    const b = addPerson(world, 'npc.postie', 20, 10);
    const ib = resolveNpcHandle(store, b);
    expect([store.nearMiss[ib], store.nearMissD2[ib], store.dustTicks[ib]]).toEqual([
      NearMissState.Armed,
      0,
      0,
    ]);
    store.nearMiss[ib] = NearMissState.PassingFast;
    store.nearMissD2[ib] = 0.75;
    store.dustTicks[ib] = 77;
    removeNpc(store, resolveNpcHandle(store, a));
    const moved = resolveNpcHandle(store, b);
    expect(moved).toBe(0);
    expect([store.nearMiss[moved], store.nearMissD2[moved], store.dustTicks[moved]]).toEqual([
      NearMissState.PassingFast,
      0.75,
      77,
    ]);
    const c = resolveNpcHandle(store, addPerson(world, 'npc.postie', 30, 10));
    expect([store.nearMiss[c], store.nearMissD2[c], store.dustTicks[c]]).toEqual([NearMissState.Armed, 0, 0]);
  });

  it('refuses a re-arm gap below the near-miss gap', () => {
    const t: Tuning = {
      ...DEFAULT_TUNING,
      streetLife: { ...DEFAULT_TUNING.streetLife, nearMiss: { ...NEAR_MISS, rearmGapM: 0.4 } },
    };
    expect(() => townWorld(false, t)).toThrow(/rearmGapM \(0\.4 m\) must be at least maxGapM \(0\.5 m\)/);
  });
});

describe('hot path', () => {
  it('near misses, dust and coughs allocate nothing per tick (TECHNICAL_DESIGN §17 heap-delta check)', () => {
    requireGc();
    const { world, h, px, py } = dustWorld(2.5);
    const other = addPerson(world, 'npc.shopper', CX + 4, CY);
    let t = 0;
    const gaps = [2, 0.45, 0.4, 0.42, 1.6];
    const npc = world.npc;
    const step = (): void => {
      // A pinned cougher, and a pedestrian passed again and again at 0.4 m (written inline: a test helper taking
      // computed doubles would box them, and the check would measure the harness).
      place(world, h, px, py);
      const gap = gaps[t % 5] as number;
      const oi = resolveNpcHandle(npc, other);
      npc.x[oi] = world.vehicle.xM - HALF_W - HUMAN_R - gap;
      npc.y[oi] = world.vehicle.yM;
      updateNpcCell(npc, oi);
      world.vehicle.vLongMps = 3.5;
      world.vehicle.vLatMps = 0;
      world.vehicle.yawRateRadPerS = 0;
      world.vehicle.xM = CX;
      world.vehicle.yM = CY;
      world.vehicle.headingRad = 0;
      world.step(neutral);
      t += 1;
    };
    // Pre-warm with a discarded run (30,000 ticks and a measured window), as the combo and scoring checks do: the
    // first window after the warm-up still read V8 compiling the award, cough and startle paths (~136 KB on the
    // dev Mac; the next windows 14 KB, 4 KB, then 256 B), not the tick. A second discarded window (SSP-095
    // review): under heavy CPU contention (default-parallel `npm test` on a loaded machine) the second window
    // read 38-127 KB too, V8's background compilation landing late, and passed in every isolated run.
    measureHeapDelta(step, { warmupTicks: 30_000 });
    measureHeapDelta(step, { warmupTicks: 0 });
    const coughs0 = world.npcAi.reactions.coughs;
    const nearMisses0 = world.npcAi.reactions.nearMisses;
    const delta = measureHeapDelta(step);
    // The window ran the work under test: a cough every 120 ticks, a near miss every 5, two clouds every 7.
    expect(world.npcAi.reactions.coughs - coughs0).toBeGreaterThan(30);
    expect(world.npcAi.reactions.nearMisses - nearMisses0).toBeGreaterThan(500);
    expect(world.dust.cloudsEmitted).toBeGreaterThan(1000);
    assertHeapDeltaWithinThresholds(delta);
  }, 120_000);
});
