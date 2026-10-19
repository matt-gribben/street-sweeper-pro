// The shift's end states (src/sim/shift.ts phase 10, src/sim/world.ts; GDD §11.3, LEVEL_DESIGN §4.1; SSP-079):
// SACKED on the tick the complaints meter reaches 5, TOWED on the tick HP reaches 0, SACKED first on a tick that
// does both, neither once the knock-off has settled the shift as TIME UP; the World frozen from the end on; and
// the tally's figures: TOWED keeps floor(0.5 × score), SACKED and TOWED award no stars.
import { describe, expect, it } from 'vitest';
import tuningJson from '../../src/data/tuning.json' with { type: 'json' };
import { EV, type EventType, ShiftEndReason } from '../../src/sim/eventQueue.ts';
import { createInputFrame, type InputFrame, PRESSED, THROTTLE_MAX } from '../../src/sim/inputFrame.ts';
import { createBlankLevel, Ground, type Level } from '../../src/sim/map.ts';
import { absorbTick, createStateHasher, stateHash } from '../../src/sim/replay.ts';
import {
  finalShiftScore,
  finalShiftStars,
  isShiftEnded,
  isShiftFailed,
  ShiftPhase,
} from '../../src/sim/shift.ts';
import { snapshotWorld } from '../../src/sim/snapshot.ts';
import { DEFAULT_TUNING, loadTuning, type Tuning } from '../../src/sim/tuning.ts';
import { createWorld, type World } from '../../src/sim/world.ts';

const SACKED_AT = DEFAULT_TUNING.complaints.meter.sackedAt;
const ROLLOUT_TICKS = 180;

/** A 40 × 40 tile asphalt level, Bessie in the middle facing north. */
function openLevel(): Level {
  const level = createBlankLevel('test.end_states', 40, 40);
  level.layers.ground.fill(Ground.Road);
  level.player = { x: 40, y: 40, heading: 0 };
  return level;
}

function frame(fields: Partial<InputFrame> = {}): InputFrame {
  return { ...createInputFrame(), ...fields };
}

const NEUTRAL = frame();
const HONK = frame({ pressed: PRESSED.HORN });
const FULL_THROTTLE = frame({ throttle: THROTTLE_MAX });

function count(world: World, type: EventType): number {
  let n = 0;
  for (let i = 0; i < world.events.count; i += 1) if (world.events.type[i] === type) n += 1;
  return n;
}

/** The ShiftEnd reason of this tick's queue, or 0 if none fired. */
function shiftEndThisTick(world: World): number {
  for (let i = 0; i < world.events.count; i += 1) {
    if (world.events.type[i] === EV.ShiftEnd) return world.events.a[i] as number;
  }
  return 0;
}

/** The whole hashed sim state (replay.ts absorbTick, mask included) as one number, from a fresh hasher. */
function stateOf(world: World): number {
  const hasher = createStateHasher(world.seed);
  absorbTick(hasher, world);
  return stateHash(hasher);
}

function tuningWith(edit: (raw: typeof tuningJson) => void): Tuning {
  const raw = structuredClone(tuningJson);
  edit(raw);
  return loadTuning(raw);
}

/**
 * Honk every `everyTicks` ticks (the HORN edge on the first tick of each period) until the shift ends or
 * `maxTicks` pass. Returns the ticks stepped.
 */
function hornSpam(world: World, everyTicks: number, maxTicks: number, between = NEUTRAL): number {
  for (let t = 0; t < maxTicks; t += 1) {
    world.step(t % everyTicks === 0 ? HONK : between);
    if (isShiftEnded(world.shift)) return t + 1;
  }
  return maxTicks;
}

describe('SACKED (GDD §11.3: the complaints meter reaches 5)', () => {
  it('ends the shift on the tick the 5th complaint lands, with reason Sacked, once', () => {
    const world = createWorld(openLevel(), 7, DEFAULT_TUNING);
    // Let the timer start (on tick 180, the rollout fallback), then honk every 15 ticks: the re-arm rule (SSP-078) makes 4 honks one Noise
    // complaint, so the 20th honk files the 5th.
    for (let t = 0; t <= ROLLOUT_TICKS; t += 1) world.step(NEUTRAL);
    expect(world.shift.phase).toBe(ShiftPhase.Running);
    let ends = 0;
    let complaintsBefore = 0;
    let honks = 0;
    for (let t = 0; t < 20 * 15; t += 1) {
      const honk = t % 15 === 0;
      if (honk) honks += 1;
      complaintsBefore = world.complaints.count;
      world.step(honk ? HONK : NEUTRAL);
      ends += count(world, EV.ShiftEnd);
      if (world.complaints.count < SACKED_AT) {
        expect(world.shift.phase, `honk ${honks}`).toBe(ShiftPhase.Running);
        continue;
      }
      // This is the tick of the 5th complaint: it ends the shift.
      expect(honks).toBe(20);
      expect(complaintsBefore).toBe(SACKED_AT - 1);
      expect(count(world, EV.Complaint)).toBe(1);
      expect(shiftEndThisTick(world)).toBe(ShiftEndReason.Sacked);
      expect(world.shift.phase).toBe(ShiftPhase.Ended);
      expect(world.shift.endReason).toBe(ShiftEndReason.Sacked);
      expect(world.shift.endTick).toBe(world.tick - 1);
      break;
    }
    expect(ends).toBe(1);
    expect(isShiftFailed(world.shift)).toBe(true);
    expect(snapshotWorld(world).shift).toMatchObject({ phase: 'ended', endReason: 'sacked' });
  });

  it('freezes the sim: further step() calls change no state and emit no event', () => {
    const world = createWorld(openLevel(), 7, DEFAULT_TUNING);
    // Drive off (so Bessie is moving when the shift ends) with the brush down, honking every 10 ticks.
    world.step(frame({ pressed: PRESSED.BRUSH }));
    hornSpam(world, 10, 600, FULL_THROTTLE);
    expect(world.shift.endReason).toBe(ShiftEndReason.Sacked);
    expect(Math.abs(world.vehicle.vLongMps)).toBeGreaterThan(1);
    const endSnapshot = snapshotWorld(world);
    const endTick = world.tick;
    const honksAtEnd = world.complaints.honks;

    // Throttle, steer, brush, spray, horn: nothing reaches the sim any more.
    const inputs = [
      FULL_THROTTLE,
      HONK,
      frame({ throttle: THROTTLE_MAX, steer: 127, buttons: 0xff, pressed: 0xff }),
      NEUTRAL,
    ];
    world.step(NEUTRAL);
    expect(world.events.count).toBe(0);
    const frozen = stateOf(world);
    for (let t = 0; t < 600; t += 1) {
      world.step(inputs[t % inputs.length] as InputFrame);
      expect(world.events.count).toBe(0);
    }
    expect(world.tick).toBe(endTick);
    expect(stateOf(world)).toBe(frozen);
    expect(snapshotWorld(world)).toEqual(endSnapshot);
    expect(world.complaints.count).toBe(SACKED_AT);
    expect(world.complaints.honks).toBe(honksAtEnd);
  });

  it('applies in the rollout too, before the timer starts', () => {
    const world = createWorld(openLevel(), 7, DEFAULT_TUNING);
    // A honk edge every tick: 4 ticks a complaint, so the 20th tick files the 5th, inside the 180-tick rollout.
    const ticks = hornSpam(world, 1, 100);
    expect(ticks).toBe(20);
    expect(world.shift.timerStartTick).toBe(-1);
    expect(world.shift.endReason).toBe(ShiftEndReason.Sacked);
    expect(world.shift.endTick).toBe(19);
  });

  it('keeps the score and awards no stars, even with the stars earned', () => {
    const world = createWorld(openLevel(), 7, DEFAULT_TUNING);
    world.scoring.score = 12_345;
    hornSpam(world, 1, 100);
    expect(world.shift.endReason).toBe(ShiftEndReason.Sacked);
    // An open level with no grime or litter is spotless: 100% Tidy, 3 would-be stars.
    expect(world.tidy.tidy).toBeGreaterThanOrEqual(0.92);
    expect(world.tidy.stars).toBe(3);
    expect(finalShiftScore(world.shift, world.scoring.score)).toBe(12_345);
    expect(finalShiftStars(world.shift, world.tidy.stars)).toBe(0);
    expect(snapshotWorld(world).shift).toMatchObject({ finalScore: 12_345, finalStars: 0 });
  });

  it('follows tuning.json complaints.meter.sackedAt', () => {
    const world = createWorld(
      openLevel(),
      7,
      tuningWith((raw) => {
        raw.complaints.meter.sackedAt = 2;
      }),
    );
    expect(hornSpam(world, 1, 100)).toBe(8);
    expect(world.complaints.count).toBe(2);
    expect(world.shift.endReason).toBe(ShiftEndReason.Sacked);
  });
});

describe('TOWED (GDD §11.3: Dignity reaches 0 HP)', () => {
  it('ends the shift with reason Towed; final score floor(0.5 × score); no stars even at Tidy ≥ 92%', () => {
    const world = createWorld(openLevel(), 7, DEFAULT_TUNING);
    for (let t = 0; t < 300; t += 1) world.step(FULL_THROTTLE);
    expect(world.shift.phase).toBe(ShiftPhase.Running);
    world.scoring.score = 12_345;
    world.vehicle.hp = 0;
    world.step(FULL_THROTTLE);
    expect(shiftEndThisTick(world)).toBe(ShiftEndReason.Towed);
    expect(world.shift.endReason).toBe(ShiftEndReason.Towed);
    expect(world.shift.endTick).toBe(300);
    expect(world.tidy.tidy).toBeGreaterThanOrEqual(0.92);
    expect(world.tidy.stars).toBe(3);
    expect(finalShiftScore(world.shift, world.scoring.score)).toBe(6172);
    expect(finalShiftStars(world.shift, world.tidy.stars)).toBe(0);
    expect(snapshotWorld(world).shift).toMatchObject({
      endReason: 'towed',
      finalScore: 6172,
      finalStars: 0,
    });
    // Frozen from here on as well.
    const snap = snapshotWorld(world);
    for (let t = 0; t < 120; t += 1) world.step(FULL_THROTTLE);
    expect(snapshotWorld(world)).toEqual(snap);
  });

  it('rounds half the score down to an integer (toward −∞ for a negative score), as integer arithmetic', () => {
    const world = createWorld(openLevel(), 7, DEFAULT_TUNING);
    world.vehicle.hp = -3;
    world.step(NEUTRAL);
    expect(world.shift.endReason).toBe(ShiftEndReason.Towed);
    const s = world.shift;
    expect(finalShiftScore(s, 0)).toBe(0);
    expect(finalShiftScore(s, 1)).toBe(0);
    expect(finalShiftScore(s, 2)).toBe(1);
    expect(finalShiftScore(s, 12_345)).toBe(6172);
    expect(finalShiftScore(s, 12_346)).toBe(6173);
    expect(finalShiftScore(s, -15)).toBe(-8);
    for (let score = -50; score <= 5000; score += 7) {
      expect(finalShiftScore(s, score)).toBe(Math.floor(score / 2));
    }
  });

  it('keeps towedScoreKeep of the score: 0.57 × 100 is 57, not the float product 56.99…', () => {
    const world = createWorld(
      openLevel(),
      7,
      tuningWith((raw) => {
        raw.endStates.towedScoreKeep = 0.57;
      }),
    );
    expect(0.57 * 100).toBeLessThan(57);
    world.vehicle.hp = 0;
    world.step(NEUTRAL);
    expect(finalShiftScore(world.shift, 100)).toBe(57);
    expect(finalShiftScore(world.shift, 1001)).toBe(570);
  });
});

describe('precedence and the settled knock-off', () => {
  it('SACKED wins a tick on which the 5th complaint lands and HP reaches 0', () => {
    const world = createWorld(openLevel(), 7, DEFAULT_TUNING);
    world.scoring.score = 999;
    // 19 honk ticks: 4 complaints and 3 honks in the window, so the next honk files the 5th.
    for (let t = 0; t < 19; t += 1) world.step(HONK);
    expect(world.complaints.count).toBe(SACKED_AT - 1);
    expect(isShiftEnded(world.shift)).toBe(false);
    world.vehicle.hp = 0;
    world.step(HONK);
    expect(world.complaints.count).toBe(SACKED_AT);
    expect(count(world, EV.ShiftEnd)).toBe(1);
    expect(shiftEndThisTick(world)).toBe(ShiftEndReason.Sacked);
    expect(world.shift.endReason).toBe(ShiftEndReason.Sacked);
    // SACKED's figures, not TOWED's: the whole score, no stars.
    expect(finalShiftScore(world.shift, world.scoring.score)).toBe(999);
    expect(finalShiftStars(world.shift, 3)).toBe(0);
  });

  it('HP 0 a tick before the 5th complaint is TOWED, and the frozen sim files no more complaints', () => {
    const world = createWorld(openLevel(), 7, DEFAULT_TUNING);
    for (let t = 0; t < 19; t += 1) world.step(HONK);
    world.vehicle.hp = 0;
    world.step(NEUTRAL);
    expect(world.shift.endReason).toBe(ShiftEndReason.Towed);
    world.step(HONK);
    expect(world.complaints.count).toBe(SACKED_AT - 1);
    expect(world.shift.endReason).toBe(ShiftEndReason.Towed);
  });

  it('once knocked off, a 5th complaint or HP 0 during the coast still ends TIME UP', () => {
    const world = createWorld(
      openLevel(),
      7,
      tuningWith((raw) => {
        raw.shift.durationS = 5;
      }),
    );
    // Full throttle from tick 0 (the timer's first tick) to the knock-off at the end of its 300th tick.
    let t = 0;
    while (world.shift.phase !== ShiftPhase.KnockOff) {
      world.step(FULL_THROTTLE);
      t += 1;
      expect(t).toBeLessThan(400);
    }
    expect(world.shift.knockOffTick).toBe(299);
    expect(Math.abs(world.vehicle.vLongMps)).toBeGreaterThan(1);
    world.complaints.count = SACKED_AT;
    world.vehicle.hp = 0;
    while (!isShiftEnded(world.shift)) {
      world.step(HONK);
      t += 1;
      expect(t).toBeLessThan(1000);
    }
    expect(world.shift.endReason).toBe(ShiftEndReason.TimeUp);
    expect(isShiftFailed(world.shift)).toBe(false);
    expect(finalShiftScore(world.shift, 4321)).toBe(4321);
    expect(finalShiftStars(world.shift, 2)).toBe(2);
  });
});
