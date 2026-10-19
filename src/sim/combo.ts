// The combo chain (GDD §10.2, TECHNICAL_DESIGN §5.2 phase 9; SSP-063): the chain count, the 2.0 s chain timer,
// the multiplier tiers and EV.ComboTier. scoring.ts drives it from phase 9; nothing else writes it.
//
// Chain. Every pickup (a litter item collected or a stain sprayed clean) adds 1 to the chain and refreshes the
// chain timer to `refreshTicks` (tuning.json combo.chainS × 60 = 120). The multiplier is read AFTER the
// increment: the pickup that makes the chain 10 already scores ×2 (GDD §10.4: the drink can at chain 10 is
// 15 × 2 = 30). Multipliers come from tuning.json combo.tiers (chain 0–9 ×1; 10 ×2, 25 ×3, 50 ×4, 100 ×5).
//
// Timer (stepComboTimer, the first thing phase 9 does each tick, before this tick's pickups). While the chain
// is above 0 and the timer is not frozen, the timer loses one tick; when it reaches 0 the chain expires to 0
// and the multiplier drops to ×1. A pickup on tick T therefore leaves the timer at 120 at the end of tick T,
// and with no further pickup the chain expires on tick T + 120, exactly 120 ticks (2.0 s) after the last
// pickup; a pickup on tick T + 119 still extends it, one on tick T + 120 starts a new chain at 1. Integer
// ticks only, never accumulated seconds (TECHNICAL_DESIGN §5.1).
//
// Freeze (GDD §20 Q4, decided in SSP-062). The timer does not count down while a dump drains: phase 9 passes
// shift.ts's isShiftDraining, read before phase 10 runs, so the freeze covers phase 9 of the ticks after
// EV.DumpStart up to and including the EV.DumpEnd tick (the drain's own ticks). Pickups during a drain still
// count and still refresh the timer.
//
// Timer multiplier (the pwr.flask_of_tea hook, M3, SSP-096): setComboTimerMultiplier(combo, 2) makes every
// later refresh 240 ticks (4.0 s); 1 restores 120. It changes refreshes only, not the timer already running.
//
// Penalties (resetCombo): any penalty sets the chain and the timer to 0 and the multiplier to ×1 (GDD §10.2,
// §11.1). Grime and style bonuses never touch the chain (GDD §9.1, §10.3).
//
// EV.ComboTier fires on every change of multiplier, up or down: a = the new multiplier, b = the previous one,
// c = the chain after the change; entity −1. A rise (a > b) is a tier reached: the HUD popup ("TIDY!" ...,
// SSP-070) and sfx.combo_tier (M5) play only on rises; a drop (expiry or penalty) lets the music state machine
// (SSP-177) fade the drums out. Several pickups in one tick that cross a threshold emit one event at the pickup
// that crosses it.
//
// Hot path: every function here except createCombo and setComboTuning allocates nothing and takes or returns
// only small integers and booleans (TECHNICAL_DESIGN §17).

import { SIM_HZ } from './constants.ts';
import { EV, type EventQueue, emitEvent } from './eventQueue.ts';
import type { Tuning } from './tuning.ts';

/** The combo state. Create with createCombo; only the sim writes it. */
export type Combo = {
  /** Pickups in the current chain (0 when there is no chain). */
  chain: number;
  /** The multiplier for `chain`: 1 below the first tier. */
  multiplier: number;
  /** Ticks left before the chain expires; 0 when chain is 0. */
  timerTicks: number;
  /** The longest chain this shift (the Mercury tally's "best chain", GDD §15). */
  bestChain: number;
  /** The base refresh, combo.chainS × 60 ticks (120). */
  baseTicks: number;
  /** The timer multiplier hook (pwr.flask_of_tea, M3): 1 normally. */
  timerMul: number;
  /** What a pickup sets the timer to: round(baseTicks × timerMul). */
  refreshTicks: number;
  /** Tier thresholds and multipliers, ascending (tuning.json combo.tiers). Replaced by setComboTuning. */
  tierMinChain: Int32Array;
  tierMultiplier: Int32Array;
};

/** What render, audio and UI may see: the same object, typed read-only. */
export type ComboView = {
  readonly chain: number;
  readonly multiplier: number;
  readonly timerTicks: number;
  readonly bestChain: number;
  readonly refreshTicks: number;
};

function ticksOf(seconds: number): number {
  return Math.round(seconds * SIM_HZ) | 0;
}

function applyTuning(combo: Combo, tuning: Tuning): void {
  const c = tuning.combo;
  const base = ticksOf(c.chainS);
  if (!(base >= 1)) throw new Error(`combo: combo.chainS must be at least one tick, got ${c.chainS}`);
  const n = c.tiers.length;
  const minChain = new Int32Array(n);
  const multiplier = new Int32Array(n);
  for (let i = 0; i < n; i += 1) {
    const tier = c.tiers[i];
    if (tier === undefined) throw new Error(`combo: tier ${i} is missing`);
    minChain[i] = tier.minChain;
    multiplier[i] = tier.multiplier;
  }
  combo.baseTicks = base;
  combo.refreshTicks = Math.max(1, Math.round(base * combo.timerMul)) | 0;
  combo.tierMinChain = minChain;
  combo.tierMultiplier = multiplier;
  combo.multiplier = comboMultiplierFor(combo, combo.chain);
}

/** A fresh combo (chain 0, ×1) on `tuning`'s chain timer and tiers. Setup only: allocates. */
export function createCombo(tuning: Tuning): Combo {
  const combo: Combo = {
    chain: 0,
    multiplier: 1,
    timerTicks: 0,
    bestChain: 0,
    baseTicks: 0,
    // Fractional first so the field starts as a double (TECHNICAL_DESIGN §17, deprecated maps).
    timerMul: 0.5,
    refreshTicks: 0,
    tierMinChain: new Int32Array(0),
    tierMultiplier: new Int32Array(0),
  };
  combo.timerMul = 1;
  applyTuning(combo, tuning);
  return combo;
}

/** The read-only view of `combo`. No copy: it is the same object. */
export function viewCombo(combo: Combo): ComboView {
  return combo;
}

/** Hand the combo a new tuning between ticks (the dev panel). The running chain and timer are kept. */
export function setComboTuning(combo: Combo, tuning: Tuning): void {
  applyTuning(combo, tuning);
}

/** The multiplier a chain of `chain` pickups earns on `combo`'s tiers (1 below the first tier). */
export function comboMultiplierFor(combo: Combo, chain: number): number {
  const minChain = combo.tierMinChain;
  for (let i = minChain.length - 1; i >= 0; i -= 1) {
    if (chain >= (minChain[i] as number)) return combo.tierMultiplier[i] as number;
  }
  return 1;
}

/**
 * The pwr.flask_of_tea hook (M3): later pickups refresh the timer to round(base × `mul`) ticks (2 → 240).
 * The timer already running is left as it is. Not per tick.
 */
export function setComboTimerMultiplier(combo: Combo, mul: number): void {
  if (!(Number.isFinite(mul) && mul > 0)) {
    throw new Error(`setComboTimerMultiplier: the multiplier must be a positive number, got ${mul}`);
  }
  combo.timerMul = mul;
  combo.refreshTicks = Math.max(1, Math.round(combo.baseTicks * mul)) | 0;
}

/** The chain timer's remaining fraction, 0..1 (the HUD's shrinking bar, GDD §10.2). */
export function comboTimerFraction(combo: ComboView): number {
  return combo.timerTicks / combo.refreshTicks;
}

/** Set the multiplier for the current chain and emit EV.ComboTier if it changed (see the header). */
function settleTier(combo: Combo, events: EventQueue): void {
  const next = comboMultiplierFor(combo, combo.chain);
  const prev = combo.multiplier;
  if (next === prev) return;
  combo.multiplier = next;
  const i = emitEvent(events, EV.ComboTier, -1);
  events.a[i] = next;
  events.b[i] = prev;
  events.c[i] = combo.chain;
}

/**
 * One pickup: chain + 1, the timer refreshed, the tier settled (EV.ComboTier on a change). Returns the
 * multiplier the pickup scores at, which already includes this pickup (GDD §10.4).
 */
export function addComboPickup(combo: Combo, events: EventQueue): number {
  const chain = combo.chain + 1;
  combo.chain = chain;
  combo.timerTicks = combo.refreshTicks;
  if (chain > combo.bestChain) combo.bestChain = chain;
  settleTier(combo, events);
  return combo.multiplier;
}

/** A penalty: chain, timer and multiplier back to 0, 0 and ×1 (EV.ComboTier if the multiplier was above 1). */
export function resetCombo(combo: Combo, events: EventQueue): void {
  combo.chain = 0;
  combo.timerTicks = 0;
  settleTier(combo, events);
}

/**
 * Phase 9, before this tick's pickups: unless `frozen` (a dump drains), a running chain loses one timer tick
 * and expires to 0 when the timer reaches 0 (EV.ComboTier if the multiplier was above 1).
 */
export function stepComboTimer(combo: Combo, frozen: boolean, events: EventQueue): void {
  if (frozen || combo.chain === 0) return;
  const t = combo.timerTicks - 1;
  combo.timerTicks = t;
  if (t > 0) return;
  combo.chain = 0;
  combo.timerTicks = 0;
  settleTier(combo, events);
}
