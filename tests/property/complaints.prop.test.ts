// The complaints meter and the penalty pipeline under arbitrary play (SSP-078; GDD §10.2, §11). For any
// sequence of ticks, each with or without a honk (some flagged Caught! in phase 7) and with any handful of
// penalty facts (0..3 complaints, −500..0 pts), run through phase 9 as the World runs it (stepHornSpam →
// applyPenalties → stepScoring), after every tick:
//
//   - the meter never decreases and never exceeds its cap (5);
//   - each tick emits exactly as many EV.Complaint events as the meter rose;
//   - the score moves by exactly the tick's facts' points (nothing else scores here), once;
//   - a tick with any fact (a Noise one included) ends with chain 0;
//   - Noise offences match a reference model of the window: the uncaught honks of the last 300 ticks, cleared
//     when it holds more than 3.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  applyPenalties,
  createComplaints,
  markHornCaught,
  Offence,
  stepHornInput,
  stepHornSpam,
} from '../../src/sim/complaints.ts';
import { countEvents, createEventQueue, EV, resetEvents, sealEvents } from '../../src/sim/eventQueue.ts';
import { createInputFrame, PRESSED } from '../../src/sim/inputFrame.ts';
import { createPenaltyLog, pushPenalty } from '../../src/sim/penalties.ts';
import { createScoring, stepScoring } from '../../src/sim/scoring.ts';
import { DEFAULT_ENTITIES, DEFAULT_TUNING } from '../../src/sim/tuning.ts';
import { assertProperty } from '../support/fcCheck.ts';

const OFFENCES = Object.values(Offence);

const tickArb = fc.record({
  /** Ticks skipped before this one (so honks can be close together or far apart). */
  gap: fc.oneof(fc.constant(0), fc.integer({ min: 0, max: 40 }), fc.integer({ min: 250, max: 400 })),
  honk: fc.boolean(),
  caught: fc.boolean(),
  facts: fc.array(
    fc.record({
      reason: fc.constantFrom(...OFFENCES),
      pts: fc.integer({ min: -500, max: 0 }),
      complaints: fc.integer({ min: 0, max: 3 }),
    }),
    { maxLength: 3 },
  ),
  /** A chain running into the tick, as pickups would have left it. */
  chain: fc.integer({ min: 0, max: 60 }),
});

describe('complaints meter and penalty pipeline (property)', () => {
  it('holds its invariants for any honks and penalty facts', () => {
    assertProperty(
      fc.property(fc.array(tickArb, { maxLength: 80 }), (ticks) => {
        const c = createComplaints(DEFAULT_TUNING);
        const log = createPenaltyLog();
        const scoring = createScoring(DEFAULT_TUNING, DEFAULT_ENTITIES);
        const q = createEventQueue();
        const dirt = { tickCleanedCells: 0, tickCleanedGutterCells: 0, kerbContact: false };
        const at = { xM: 1, yM: 2 };
        const horn = { ...createInputFrame(), pressed: PRESSED.HORN };
        const none = createInputFrame();
        // Reference window model.
        let window: number[] = [];
        let noise = 0;
        let t = 0;
        for (const step of ticks) {
          t += step.gap;
          resetEvents(q, t);
          stepHornInput(c, step.honk ? horn : none, at, q);
          if (step.honk && step.caught) markHornCaught(c);
          for (const f of step.facts) pushPenalty(log, f.reason, f.pts, f.complaints);
          scoring.combo.chain = step.chain;
          scoring.combo.timerTicks = step.chain > 0 ? 100 : 0;
          const before = { count: c.count, score: scoring.score };
          stepHornSpam(c, log, at, t);
          applyPenalties(c, log, scoring, q);
          stepScoring(scoring, q, dirt, false);
          sealEvents(q);

          let noiseThisTick = false;
          if (step.honk && !step.caught) {
            window = window.filter((h) => t - h < 300);
            window.push(t);
            if (window.length > 3) {
              window = [];
              noise += 1;
              noiseThisTick = true;
            }
          }
          expect(c.noiseOffences).toBe(noise);
          expect(c.count).toBeGreaterThanOrEqual(before.count);
          expect(c.count).toBeLessThanOrEqual(5);
          expect(countEvents(q, EV.Complaint)).toBe(c.count - before.count);
          const pts = step.facts.reduce((sum, f) => sum + f.pts, 0);
          expect(scoring.score - before.score).toBe(pts);
          if (step.facts.length > 0 || noiseThisTick) expect(scoring.combo.chain).toBe(0);
          expect(log.count).toBe(0);
          t += 1;
        }
      }),
      { seed: 78, numRuns: 300 },
    );
  });
});
