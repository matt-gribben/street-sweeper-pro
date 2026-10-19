// The Council Complaints rules (SSP-108; ROADMAP M3 exit "Complaints"; GDD §11.2–§11.3, ENTITY_CATALOG §3.3): one
// test per rule of the M3 exit, each through the full World.step on a minimal fixture.
//   Horn spam: more than 3 honks in 5 s is 1 complaint, so 4 honks in 300 ticks give 1 (3 give none).
//   Blocking traffic over 10 s is 1 complaint: a car held 601 ticks gives 1 (600 give none).
//   Running an occupied zebra is −200 and 1 complaint.
//   5 complaints is SACKED: the shift ends on the tick the 5th lands, with reason Sacked.
// The rules are checked against tuning.json as well as against the ROADMAP's numbers, so a tuning change shows up
// here as a design change. The details of each rule (the re-arm, the Caught! exemption, the block states, the
// frozen sim) are tested where they are built: complaints.test.ts, traffic.test.ts, zebraOffence.test.ts and
// endStates.test.ts. The per-offence table is penalties.test.ts.
import { describe, expect, it } from 'vitest';
import { Offence } from '../../src/sim/complaints.ts';
import { NPC_IDS } from '../../src/sim/entities.ts';
import { countEvents, EV, ShiftEndReason } from '../../src/sim/eventQueue.ts';
import { createInputFrame, type InputFrame, PRESSED } from '../../src/sim/inputFrame.ts';
import { createBlankLevel, Ground, type Level } from '../../src/sim/map.ts';
import { stationaryPedestrianBehaviour } from '../../src/sim/npc/behaviours/pedestrian.ts';
import { addNpcAt, NpcOrigin, setNpcState } from '../../src/sim/npc/store.ts';
import { ShiftPhase } from '../../src/sim/shift.ts';
import { DEFAULT_TUNING } from '../../src/sim/tuning.ts';
import { createWorld, type World } from '../../src/sim/world.ts';
import { endlessShiftTuning } from '../support/endlessShift.ts';
import { npcTown } from '../support/npcTown.ts';
import { compileTown } from '../support/steeringTown.ts';
import { compileTrafficTown, ONE_WAY_STREET } from '../support/trafficTown.ts';

const RULES = DEFAULT_TUNING.complaints;
const NEUTRAL = createInputFrame();
const HONK: InputFrame = { ...createInputFrame(), pressed: PRESSED.HORN };

/** A 40 × 40 tile road, Bessie in the middle facing north: nothing to hit, nothing to block. */
function openLevel(): Level {
  const level = createBlankLevel('test.complaint_rules', 40, 40);
  level.layers.ground.fill(Ground.Road);
  level.player = { x: 40, y: 40, heading: 0 };
  return level;
}

/** Step `world` `ticks` times, honking on the ticks listed; returns the Noise complaints filed, by tick. */
function honkOn(world: World, honkTicks: readonly number[], ticks: number): number[] {
  const at = new Set(honkTicks);
  const noise: number[] = [];
  for (let t = 0; t < ticks; t++) {
    world.step(at.has(t) ? HONK : NEUTRAL);
    for (let k = 0; k < world.events.count; k++) {
      if (world.events.type[k] === EV.Complaint && world.events.c[k] === Offence.Noise) noise.push(t);
    }
  }
  return noise;
}

describe('horn spam: more than 3 honks in 5 s = 1 complaint', () => {
  it('reads tuning.json: more than 3 honks in a 300-tick window, 1 complaint', () => {
    expect([RULES.hornSpam.maxHonks, RULES.hornSpam.windowS * 60, RULES.hornSpam.complaints]).toEqual([
      3, 300, 1,
    ]);
  });

  it('4 honks within 300 ticks give exactly 1 complaint, on the 4th honk; 3 give none', () => {
    const four = createWorld(openLevel(), 1, DEFAULT_TUNING);
    expect(honkOn(four, [0, 100, 200, 299], 400)).toEqual([299]);
    expect(four.complaints.count).toBe(1);
    const three = createWorld(openLevel(), 1, DEFAULT_TUNING);
    expect(honkOn(three, [0, 100, 200], 400)).toEqual([]);
    expect(three.complaints.count).toBe(0);
    // The 4th honk 300 ticks after the 1st is outside its window: 3 in any 300 ticks, no complaint.
    const spread = createWorld(openLevel(), 1, DEFAULT_TUNING);
    expect(honkOn(spread, [0, 100, 200, 300], 400)).toEqual([]);
  });
});

describe('blocking traffic over 10 s = 1 complaint (Road Rage)', () => {
  it('reads tuning.json: after 10 s blocked, 1 complaint', () => {
    expect([RULES.roadRage.afterBlockedS * 60, RULES.roadRage.complaints]).toEqual([600, 1]);
  });

  it('a car held behind Bessie for 600 ticks files nothing; on block tick 601 it files exactly 1', () => {
    // One car on the one-way street meets Bessie standing in its lane at her start (61, 7).
    const level = compileTrafficTown(ONE_WAY_STREET, { densityPerKm: 5, mix: { 'veh.hatchback': 1 } });
    const world = createWorld(level, 1, endlessShiftTuning());
    const rage: number[] = [];
    let blockStart = -1;
    for (let guard = 0; guard < 20_000; guard++) {
      world.step(NEUTRAL);
      const s = world.vehicles;
      for (let i = 0; i < s.count && blockStart < 0; i++) if (s.blockTicks[i] === 1) blockStart = world.tick;
      for (let k = 0; k < world.events.count; k++) {
        if (world.events.type[k] === EV.Complaint && world.events.c[k] === Offence.RoadRage)
          rage.push(world.tick);
      }
      if (blockStart >= 0 && world.tick - blockStart + 1 === 600) {
        expect(rage).toEqual([]);
        expect(world.complaints.count).toBe(0);
      }
      if (blockStart >= 0 && world.tick - blockStart + 1 >= 601) break;
    }
    expect(blockStart).toBeGreaterThan(0);
    expect(rage.map((t) => t - blockStart + 1)).toEqual([601]);
    expect(world.complaints.count).toBe(1);
    expect(world.traffic.roadRageOffences).toBe(1);
  });
});

describe('running an occupied zebra = −200 + 1 complaint', () => {
  it('reads tuning.json: −200 and 1', () => {
    expect([RULES.zebra.pts, RULES.zebra.complaints]).toEqual([-200, 1]);
  });

  it('driving onto a zebra with someone on it costs −200 and files 1 complaint (reason Zebra)', () => {
    // The steering town's 1-tile zebra at x 20–22 m; a shopper standing on it at (21, 5), clear of her path.
    const world = createWorld(compileTown(), 85, DEFAULT_TUNING);
    const kind = NPC_IDS.indexOf('npc.shopper');
    world.npcAi.behaviours[kind] = stationaryPedestrianBehaviour;
    const i = addNpcAt(world.npc, kind, NpcOrigin.Ambient, 21, 5);
    world.npc.radius[i] = world.npcAi.spawner.radiusByKind[kind] as number;
    setNpcState(world.npc, i, stationaryPedestrianBehaviour.initial);
    const v = world.vehicle;
    v.xM = 14;
    v.yM = 7;
    v.headingRad = Math.PI / 2;
    const zebraComplaints: number[] = [];
    for (let t = 0; t < 150; t++) {
      v.vLongMps = 2;
      v.vLatMps = 0;
      v.yawRateRadPerS = 0;
      v.steerRad = 0;
      world.step(NEUTRAL);
      for (let k = 0; k < world.events.count; k++) {
        if (world.events.type[k] === EV.Complaint) zebraComplaints.push(world.events.c[k] as number);
      }
    }
    expect(world.zebras.offences).toBe(1);
    expect(world.scoring.penaltyPts).toBe(-200);
    expect(world.complaints.count).toBe(1);
    expect(zebraComplaints).toEqual([Offence.Zebra]);
    expect(world.npcAi.reactions.hits).toBe(0);
  });
});

describe('5 complaints = SACKED', () => {
  it('reads tuning.json: SACKED at 5', () => {
    expect(RULES.meter.sackedAt).toBe(5);
  });

  it('the 5th complaint, from any source, ends the shift with reason Sacked on its own tick; the 4th does not', () => {
    // Two complaints from a hit on Doris, then horn spam: 4 quick honks are one Noise complaint each time.
    const world = createWorld(npcTown(48, {}).level, 108, DEFAULT_TUNING);
    const doris = NPC_IDS.indexOf('npc.old_woman');
    const halfL = DEFAULT_TUNING.vehicle.sweeper.body.lengthM / 2;
    const i = addNpcAt(world.npc, doris, NpcOrigin.Ambient, 48, 48 - halfL - 0.3 + 0.02);
    world.npc.radius[i] = world.npcAi.spawner.radiusByKind[doris] as number;
    setNpcState(world.npc, i, world.npcAi.behaviours[doris]?.initial ?? 0);
    world.vehicle.vLongMps = 2;
    world.step(NEUTRAL);
    world.vehicle.vLongMps = 0;
    expect(world.complaints.count).toBe(2);
    let ends = 0;
    let fifthTick = -1;
    for (let t = 0; t < 12 * 10 && fifthTick < 0; t++) {
      const before = world.complaints.count;
      world.step(t % 10 === 0 ? HONK : NEUTRAL);
      ends += countEvents(world.events, EV.ShiftEnd);
      if (world.complaints.count < 5) {
        expect(world.shift.phase).not.toBe(ShiftPhase.Ended);
        continue;
      }
      fifthTick = world.tick - 1;
      expect(before).toBe(4);
      let reason = 0;
      for (let k = 0; k < world.events.count; k++) {
        if (world.events.type[k] === EV.ShiftEnd) reason = world.events.a[k] as number;
      }
      expect(reason).toBe(ShiftEndReason.Sacked);
    }
    expect(fifthTick).toBeGreaterThan(0);
    expect(ends).toBe(1);
    expect(world.shift.phase).toBe(ShiftPhase.Ended);
    expect(world.shift.endReason).toBe(ShiftEndReason.Sacked);
    expect(world.shift.endTick).toBe(fifthTick);
    expect(world.complaints.count).toBe(5);
  });
});
