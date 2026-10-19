// A tuning whose shift never runs out inside a test (shift.ts, SSP-062). Since SSP-062 a World's 240 s timer
// knocks off at tick 14,400 + its rollout and from then on ignores the driver's input, so a test that steps a
// World longer than that (the heap-delta checks pre-warm V8 for 30,000 ticks) builds it on this tuning instead.
// It is built the way DEFAULT_TUNING is (loadTuning over a tuning.json copy), so every object keeps its shape.
import tuningJson from '../../src/data/tuning.json' with { type: 'json' };
import { loadTuning, type Tuning } from '../../src/sim/tuning.ts';

/** Timer length of endlessShiftTuning: 100,000 s (6,000,000 ticks). */
export const ENDLESS_SHIFT_S = 100_000;

/** tuning.json with shift.durationS = ENDLESS_SHIFT_S, optionally edited further by `edit`. */
export function endlessShiftTuning(edit?: (raw: typeof tuningJson) => void): Tuning {
  const raw = structuredClone(tuningJson);
  raw.shift.durationS = ENDLESS_SHIFT_S;
  edit?.(raw);
  return loadTuning(raw);
}
