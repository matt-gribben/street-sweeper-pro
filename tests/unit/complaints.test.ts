// Council Complaints, the horn and the penalty pipeline (src/sim/complaints.ts, src/sim/penalties.ts, SSP-078;
// GDD §10.2, §11; ENTITY_CATALOG §3.3; TECHNICAL_DESIGN §5.2): EV.Horn on the HORN edge's own tick with the 8 m
// radius (12 m with the two-tone horn), the horn-spam sliding window (3 honks none, 4 within 300 ticks one,
// spaced honks none, 8 quick honks two by the re-arm rule; 5 with the two-tone horn), a Caught! honk flagged in
// phase 7 not counting, a penalty fact resetting the chain in its own tick with its points subtracted once,
// EV.Complaint per complaint, the meter never decreasing and capped at 5, the dog-mess splat through the log,
// the police-witness no-op, the snapshot, and the fact validation. The heap check runs in simAlloc.test.ts.
import { describe, expect, it } from 'vitest';
import tuningJson from '../../src/data/tuning.json' with { type: 'json' };
import {
  applyPenalties,
  createComplaints,
  fileComplaints,
  markHornCaught,
  Offence,
  policeWitnessComplaints,
  setComplaintsTuning,
  setTwoToneHorn,
  stepHornInput,
  stepHornSpam,
} from '../../src/sim/complaints.ts';
import { createEventQueue, EV, type ReadonlyEventQueue, resetEvents } from '../../src/sim/eventQueue.ts';
import { createInputFrame, type InputFrame, PRESSED } from '../../src/sim/inputFrame.ts';
import { createBlankLevel, Ground, type Level } from '../../src/sim/map.ts';
import { createPenaltyLog, PENALTIES_PER_TICK, pushPenalty } from '../../src/sim/penalties.ts';
import { createScoring } from '../../src/sim/scoring.ts';
import { ShiftPhase } from '../../src/sim/shift.ts';
import { snapshotWorld } from '../../src/sim/snapshot.ts';
import { DEFAULT_ENTITIES, DEFAULT_TUNING, loadTuning } from '../../src/sim/tuning.ts';
import { createWorld, Phase, type World } from '../../src/sim/world.ts';

/** A 32 × 32 asphalt level; Bessie parked mid-map, so nothing but the test's own facts happens. */
function openLevel(): Level {
  const level = createBlankLevel('test.complaints', 32, 32);
  level.layers.ground.fill(Ground.Road);
  level.player = { x: 30.5, y: 31.25, heading: 0 };
  return level;
}

const NEUTRAL: InputFrame = createInputFrame();
const HORN: InputFrame = { ...createInputFrame(), pressed: PRESSED.HORN };

/** Events of `type` in the sealed queue, as [a, b, c]. */
function eventsOf(q: ReadonlyEventQueue, type: number): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < q.count; i++) if (q.type[i] === type) out.push([q.a[i] ?? 0, q.b[i] ?? 0, q.c[i] ?? 0]);
  return out;
}

/** Steps `world` to absolute tick `untilTick` (exclusive), honking on every tick in `honkTicks`. */
function run(world: World, honkTicks: readonly number[], untilTick: number): { complaintEvents: number } {
  const honks = new Set(honkTicks);
  let complaintEvents = 0;
  while (world.tick < untilTick) {
    world.step(honks.has(world.tick) ? HORN : NEUTRAL);
    complaintEvents += eventsOf(world.events, EV.Complaint).length;
  }
  return { complaintEvents };
}

describe('the horn (phase 1)', () => {
  it('emits EV.Horn on the tick whose frame carries the HORN edge, at Bessie, with radius 8 m', () => {
    const world = createWorld(openLevel(), 1, DEFAULT_TUNING);
    world.step(NEUTRAL);
    expect(eventsOf(world.events, EV.Horn)).toEqual([]);
    const tick = world.tick;
    const { xM, yM } = world.vehicle;
    world.step(HORN);
    expect(world.events.tick).toBe(tick);
    expect(eventsOf(world.events, EV.Horn)).toEqual([[xM, yM, 8]]);
    expect(DEFAULT_TUNING.streetLife.horn.radiusM).toBe(8);
    // Consumed: the next tick (no edge) has no horn.
    world.step(NEUTRAL);
    expect(eventsOf(world.events, EV.Horn)).toEqual([]);
    expect(world.complaints.honks).toBe(1);
  });

  it('holding the button is one honk: only the pressed edge sounds it', () => {
    const world = createWorld(openLevel(), 1, DEFAULT_TUNING);
    // `pressed` carries edges only; a held horn has no `buttons` bit, so only the first frame honks.
    world.step(HORN);
    for (let i = 0; i < 30; i++) world.step(NEUTRAL);
    expect(world.complaints.honks).toBe(1);
  });

  it('with upg.two_tone_horn (the modifier hook) the radius is 12 m and the spam threshold 5', () => {
    const world = createWorld(openLevel(), 1, DEFAULT_TUNING);
    setTwoToneHorn(world.complaints, DEFAULT_TUNING, true);
    world.step(HORN);
    expect(eventsOf(world.events, EV.Horn)[0]?.[2]).toBe(12);
    // Five quick honks: none (5 is not more than 5); the sixth: one.
    const w5 = createWorld(openLevel(), 1, DEFAULT_TUNING);
    setTwoToneHorn(w5.complaints, DEFAULT_TUNING, true);
    run(w5, [0, 10, 20, 30, 40], 60);
    expect(w5.complaints.count).toBe(0);
    run(w5, [60], 61);
    expect(w5.complaints.count).toBe(1);
    // Back to stock.
    setTwoToneHorn(w5.complaints, DEFAULT_TUNING, false);
    expect(w5.complaints.hornRadiusM).toBe(8);
    expect(w5.complaints.maxHonks).toBe(3);
  });

  it('a shift that is over sounds no horn (the knock-off gate clears the edge first)', () => {
    const world = createWorld(openLevel(), 1, DEFAULT_TUNING);
    world.shift.phase = ShiftPhase.Ended;
    world.step(HORN);
    expect(eventsOf(world.events, EV.Horn)).toEqual([]);
    expect(world.complaints.honks).toBe(0);
  });
});

describe('horn spam (phase 9): more than 3 honks in any 300 ticks is 1 Noise complaint', () => {
  it('3 honks add none; the 4th within 300 ticks adds exactly 1', () => {
    const world = createWorld(openLevel(), 1, DEFAULT_TUNING);
    run(world, [10, 100, 200], 400);
    expect(world.complaints.count).toBe(0);
    const w4 = createWorld(openLevel(), 1, DEFAULT_TUNING);
    const { complaintEvents } = run(w4, [10, 100, 200, 309], 400);
    expect(w4.complaints.count).toBe(1);
    expect(complaintEvents).toBe(1);
    expect(w4.complaints.noiseOffences).toBe(1);
  });

  it('the window is 300 ticks: honks at t and t + 299 share it, t and t + 300 do not', () => {
    const inside = createWorld(openLevel(), 1, DEFAULT_TUNING);
    run(inside, [5, 6, 7, 304], 400);
    expect(inside.complaints.count).toBe(1);
    const outside = createWorld(openLevel(), 1, DEFAULT_TUNING);
    run(outside, [5, 6, 7, 305], 400);
    expect(outside.complaints.count).toBe(0);
  });

  it('honks spaced more than 300 ticks apart add none, however many', () => {
    const world = createWorld(openLevel(), 1, DEFAULT_TUNING);
    const honks = Array.from({ length: 20 }, (_, i) => 1 + i * 301);
    run(world, honks, 20 * 301 + 10);
    expect(world.complaints.honks).toBe(20);
    expect(world.complaints.count).toBe(0);
  });

  it('8 honks in quick succession add exactly 2 (a complaint clears the window: the re-arm rule)', () => {
    const world = createWorld(openLevel(), 1, DEFAULT_TUNING);
    const { complaintEvents } = run(world, [0, 8, 16, 24, 32, 40, 48, 56], 120);
    expect(world.complaints.count).toBe(2);
    expect(complaintEvents).toBe(2);
    // 7 would be only 1: the window restarted empty after the 4th.
    const seven = createWorld(openLevel(), 1, DEFAULT_TUNING);
    run(seven, [0, 8, 16, 24, 32, 40, 48], 120);
    expect(seven.complaints.count).toBe(1);
  });

  it('the Noise complaint lands on the 4th honk’s own tick, at Bessie, with reason Noise', () => {
    const world = createWorld(openLevel(), 1, DEFAULT_TUNING);
    run(world, [0, 1, 2], 3);
    expect(world.complaints.count).toBe(0);
    world.step(HORN);
    expect(eventsOf(world.events, EV.Horn)).toHaveLength(1);
    expect(eventsOf(world.events, EV.Complaint)).toEqual([
      [world.vehicle.xM, world.vehicle.yM, Offence.Noise],
    ]);
    expect(world.complaints.count).toBe(1);
  });

  it('a honk flagged Caught! in phase 7 is not counted toward horn spam', () => {
    // Four honks, the second landing a litterbug's Caught!: only three count, so no complaint.
    const caughtTick = 10;
    const world = createWorld(openLevel(), 1, DEFAULT_TUNING);
    const flagged: number[] = [];
    world.phaseTrace = (phase, view) => {
      // The litterbug behaviour (phase 7) is the only writer of this flag; the test stands in for it.
      if (phase === Phase.Npc && view.tick === caughtTick) {
        if (markHornCaught((view as World).complaints)) flagged.push(view.tick);
      }
    };
    run(world, [0, caughtTick, 20, 30], 60);
    expect(flagged).toEqual([caughtTick]);
    expect(world.complaints.honks).toBe(4);
    expect(world.complaints.honksCaught).toBe(1);
    expect(world.complaints.count).toBe(0);
    // A fifth honk makes four counted: one complaint.
    run(world, [60], 61);
    expect(world.complaints.count).toBe(1);
  });

  it('markHornCaught does nothing on a tick without a honk', () => {
    const c = createComplaints(DEFAULT_TUNING);
    expect(markHornCaught(c)).toBe(false);
    expect(c.hornCaught).toBe(false);
    expect(c.honksCaught).toBe(0);
  });

  it('works at module level: phase 1 marks, phase 9 counts and records one Noise fact', () => {
    const c = createComplaints(DEFAULT_TUNING);
    const log = createPenaltyLog();
    const q = createEventQueue();
    const at = { xM: 3, yM: 4 };
    for (let t = 0; t < 4; t++) {
      resetEvents(q, t);
      stepHornInput(c, HORN, at, q);
      stepHornSpam(c, log, at, t);
    }
    expect(c.honks).toBe(4);
    expect(log.count).toBe(1);
    expect([log.reason[0], log.pts[0], log.complaints[0], log.x[0], log.y[0]]).toEqual([
      Offence.Noise,
      0,
      DEFAULT_TUNING.complaints.hornSpam.complaints,
      3,
      4,
    ]);
    expect(c.honkCount).toBe(0);
  });
});

describe('the penalty pipeline (phase 9)', () => {
  /** A World with a running ×2 chain (12 pickups, 100 ticks left) and a known score. */
  function chainedWorld(): World {
    const world = createWorld(openLevel(), 1, DEFAULT_TUNING);
    world.step(NEUTRAL);
    const combo = world.scoring.combo;
    combo.chain = 12;
    combo.bestChain = 12;
    combo.multiplier = 2;
    combo.timerTicks = 100;
    world.scoring.score = 1_000;
    world.scoring.itemPts = 1_000;
    return world;
  }

  /** Records `facts` (reason, pts, complaints, x, y) in phase `phase` of the World's next tick. */
  function onNextTick(
    world: World,
    phase: Phase,
    facts: readonly (readonly [Offence, number, number, number, number])[],
  ): void {
    const tick = world.tick;
    world.phaseTrace = (p, view) => {
      if (p !== phase || view.tick !== tick) return;
      for (const [reason, pts, complaints, x, y] of facts) {
        const i = pushPenalty(world.penalties, reason, pts, complaints);
        world.penalties.x[i] = x;
        world.penalties.y[i] = y;
      }
    };
  }

  it('any penalty fact resets the chain to 0 in the same tick and its pts are subtracted exactly once', () => {
    const world = chainedWorld();
    onNextTick(world, Phase.Npc, [[Offence.Hit, -250, 1, 12.5, 7.25]]);
    world.step(NEUTRAL);
    expect(world.scoring.combo.chain).toBe(0);
    expect(world.scoring.combo.multiplier).toBe(1);
    expect(world.scoring.combo.timerTicks).toBe(0);
    expect(world.scoring.score).toBe(750);
    expect(world.scoring.penaltyPts).toBe(-250);
    expect(eventsOf(world.events, EV.ComboTier)).toEqual([[1, 2, 0]]);
    expect(eventsOf(world.events, EV.Complaint)).toEqual([[12.5, 7.25, Offence.Hit]]);
    expect(world.complaints.count).toBe(1);
    expect(world.penalties.count).toBe(0);
    expect(world.penalties.applied).toBe(1);
    // Never again: later ticks leave the score alone.
    for (let i = 0; i < 120; i++) world.step(NEUTRAL);
    expect(world.scoring.score).toBe(750);
    expect(world.scoring.penaltyPts).toBe(-250);
    expect(world.complaints.count).toBe(1);
  });

  it('a complaint-only fact (0 pts) resets the chain too; so does a points-only one', () => {
    for (const fact of [
      [Offence.RoadRage, 0, 1, 1, 1],
      [Offence.Knock, -50, 0, 1, 1],
    ] as const) {
      const world = chainedWorld();
      onNextTick(world, Phase.Traffic, [fact]);
      world.step(NEUTRAL);
      expect(world.scoring.combo.chain, `offence ${fact[0]}`).toBe(0);
      expect(world.scoring.score).toBe(1_000 + fact[1]);
      expect(world.complaints.count).toBe(fact[2]);
      expect(eventsOf(world.events, EV.Complaint)).toHaveLength(fact[2]);
    }
  });

  it('several facts in one tick: each subtracted once, complaints in order, one chain reset', () => {
    const world = chainedWorld();
    onNextTick(world, Phase.Bodies, [
      [Offence.Hit, -500, 2, 1, 2],
      [Offence.Splash, -50, 1, 3, 4],
      [Offence.Dust, -10, 0, 5, 6],
    ]);
    world.step(NEUTRAL);
    expect(world.scoring.score).toBe(1_000 - 560);
    expect(world.scoring.penaltyPts).toBe(-560);
    expect(eventsOf(world.events, EV.Complaint)).toEqual([
      [1, 2, Offence.Hit],
      [1, 2, Offence.Hit],
      [3, 4, Offence.Splash],
    ]);
    expect(eventsOf(world.events, EV.ComboTier)).toHaveLength(1);
    expect(world.complaints.count).toBe(3);
  });

  it('a pickup in the same tick still scores at the old multiplier, then the chain resets', () => {
    // Phase 9 order: horn spam, the facts' points recorded, then stepScoring's pickups, then the penalties.
    const world = chainedWorld();
    onNextTick(world, Phase.Npc, [[Offence.Hit, -250, 1, 0, 0]]);
    const tick = world.tick;
    const trace = world.phaseTrace;
    world.phaseTrace = (p, view) => {
      trace?.(p, view);
      if (p === Phase.Npc && view.tick === tick) {
        // A stain sprayed clean this tick (as phase 6 would have emitted it): 10 pts × 2.
        const i = world.events.count;
        world.events.type[i] = EV.StainCleaned;
        world.events.entity[i] = 0;
        world.events.c[i] = 10;
        world.events.count = i + 1;
      }
    };
    world.step(NEUTRAL);
    expect(world.scoring.stainPts).toBe(20);
    expect(world.scoring.score).toBe(1_000 + 20 - 250);
    expect(world.scoring.combo.chain).toBe(0);
  });

  it('the brush-up dog-mess splat (−20) is a Splat fact through the log: points, chain reset, no complaint', () => {
    const world = chainedWorld();
    const tick = world.tick;
    world.phaseTrace = (p, view) => {
      if (p === Phase.BrushLitter && view.tick === tick) world.stains.onPenalty?.(-20, 4.5, 6.5);
    };
    let recorded = -1;
    const before = world.phaseTrace;
    world.phaseTrace = (p, view) => {
      before(p, view);
      if (p === Phase.Scoring && view.tick === tick) recorded = world.penalties.reason[0] ?? -1;
    };
    world.step(NEUTRAL);
    expect(recorded).toBe(Offence.Splat);
    expect(world.scoring.score).toBe(980);
    expect(world.scoring.combo.chain).toBe(0);
    expect(world.complaints.count).toBe(0);
  });

  it('the complaint count never decreases during a shift and is capped at 5', () => {
    const world = createWorld(openLevel(), 1, DEFAULT_TUNING);
    let last = 0;
    let events = 0;
    for (let t = 0; t < 600; t++) {
      // Every 7th tick a 2-complaint hit, every 11th a 1-complaint splash, and a honk every 5th tick.
      const facts: [Offence, number, number, number, number][] = [];
      if (t % 7 === 3) facts.push([Offence.Hit, -500, 2, 1, 1]);
      if (t % 11 === 5) facts.push([Offence.Splash, -50, 1, 2, 2]);
      onNextTick(world, Phase.Npc, facts);
      world.step(t % 5 === 0 ? HORN : NEUTRAL);
      events += eventsOf(world.events, EV.Complaint).length;
      expect(world.complaints.count).toBeGreaterThanOrEqual(last);
      expect(world.complaints.count).toBeLessThanOrEqual(5);
      last = world.complaints.count;
    }
    expect(world.complaints.count).toBe(5);
    // Only the complaints that landed were announced.
    expect(events).toBe(5);
    expect(DEFAULT_TUNING.complaints.meter.sackedAt).toBe(5);
  });

  it('fileComplaints reports how many landed under the cap', () => {
    const c = createComplaints(DEFAULT_TUNING);
    const q = createEventQueue();
    resetEvents(q, 0);
    const at = { x: [1], y: [2] };
    expect(fileComplaints(c, q, 3, Offence.Hit, at, 0)).toBe(3);
    expect(fileComplaints(c, q, 3, Offence.Hit, at, 0)).toBe(2);
    expect(fileComplaints(c, q, 1, Offence.Hit, at, 0)).toBe(0);
    expect(c.count).toBe(5);
    expect(q.count).toBe(5);
  });

  it('the police-witness hook takes the penalty position and adds nothing until veh.police exists (M6)', () => {
    const c = createComplaints(DEFAULT_TUNING);
    const log = createPenaltyLog();
    const i = pushPenalty(log, Offence.Hit, -250, 1);
    log.x[i] = 10;
    log.y[i] = 20;
    expect(policeWitnessComplaints(c, log, i)).toBe(0);
    const scoring = createScoring(DEFAULT_TUNING, DEFAULT_ENTITIES);
    const q = createEventQueue();
    resetEvents(q, 0);
    applyPenalties(c, log, scoring, q);
    expect(c.count).toBe(1);
    expect(scoring.pendingPenaltyPts).toBe(-250);
    expect(scoring.pendingPenalties).toBe(1);
  });
});

describe('penalty facts (penalties.ts)', () => {
  it('rejects malformed facts and a 65th fact in one tick', () => {
    const log = createPenaltyLog();
    expect(() => pushPenalty(log, Offence.Hit, 5, 1)).toThrow(/0 or below/);
    expect(() => pushPenalty(log, Offence.Hit, -1.5, 1)).toThrow(/0 or below/);
    expect(() => pushPenalty(log, Offence.Hit, -10, -1)).toThrow(/complaints/);
    expect(() => pushPenalty(log, 0 as Offence, -10, 0)).toThrow(/reason 0/);
    for (let i = 0; i < PENALTIES_PER_TICK; i++) pushPenalty(log, Offence.Dust, -10, 0);
    expect(() => pushPenalty(log, Offence.Dust, -10, 0)).toThrow(/holds 64/);
  });

  it('Offence codes are distinct, start at 1 and fit a byte', () => {
    const codes = Object.values(Offence);
    expect(new Set(codes).size).toBe(codes.length);
    expect(Math.min(...codes)).toBe(1);
    expect(Math.max(...codes)).toBeLessThan(256);
  });
});

describe('tuning and the snapshot', () => {
  it('reads tuning.json: cap 5, window 300 ticks, threshold 3, Noise = 1 complaint', () => {
    const c = createComplaints(DEFAULT_TUNING);
    expect([c.max, c.windowTicks, c.maxHonks, c.noiseComplaints, c.hornRadiusM]).toEqual([5, 300, 3, 1, 8]);
    expect(c.honkTicks.length).toBe(DEFAULT_TUNING.complaints.hornSpam.twoToneMaxHonks + 1);
  });

  it('setComplaintsTuning keeps the count (clamped to a smaller cap) and the window', () => {
    const c = createComplaints(DEFAULT_TUNING);
    const log = createPenaltyLog();
    const q = createEventQueue();
    for (let t = 0; t < 2; t++) {
      resetEvents(q, t);
      stepHornInput(c, HORN, { xM: 0, yM: 0 }, q);
      stepHornSpam(c, log, { xM: 0, yM: 0 }, t);
    }
    c.count = 4;
    const raw = structuredClone(tuningJson);
    raw.complaints.meter.sackedAt = 3;
    setComplaintsTuning(c, loadTuning(raw));
    expect(c.count).toBe(3);
    expect(c.max).toBe(3);
    expect(c.honkCount).toBe(2);
  });

  it('state() reports the meter as `complaints`', () => {
    const world = createWorld(openLevel(), 1, DEFAULT_TUNING);
    expect(snapshotWorld(world).complaints).toBe(0);
    run(world, [0, 1, 2, 3], 10);
    expect(snapshotWorld(world).complaints).toBe(1);
  });
});
