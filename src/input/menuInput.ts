// The menu input sampler (GDD §6.1, TECHNICAL_DESIGN §13.1, SSP-286): one tick of menu commands from the keyboard
// and the standard gamepad, separate from the sim InputFrame. A menu scene owns one, calls reset() from enter()
// and sample() once per tick from fixedUpdate().
//
// sample() returns ACTION.MENU_* bits: the rising edges latched since the last tick (Actions.takeMenuEdges()), plus
// hold-repeat for MENU_UP and MENU_DOWN. A direction held on any device (W/↑, S/↓, the D-pad or the left stick past
// MENU_STICK_THRESHOLD) steps once on its press, again MENU_REPEAT_DELAY_TICKS later, then every
// MENU_REPEAT_INTERVAL_TICKS while it stays held (0.40 s, then every 0.15 s at 60 Hz: GDD §6.1). Browser key
// repeat never counts (keyboard.ts), so the keyboard repeats at the same rate as the pad. Select and Back never
// repeat: one press, one command.
//
// reset() drops what is latched and ignores any direction held at that moment until it is released, so a key or
// stick held over a scene change (S braking as the shift ends) never scrolls the next menu.
//
// Counted in ticks, not seconds, because menus step with the fixed 60 Hz loop like everything else (src/input may
// not import the sim's DT_S; TECHNICAL_DESIGN §2.1). Allocates nothing.

import { ACTION, type MenuInputSource } from './actions.ts';

/** Ticks from a direction's first step to its first repeat: 0.40 s at 60 Hz (GDD §6.1). */
export const MENU_REPEAT_DELAY_TICKS = 24;

/** Ticks between repeats while the direction stays held: 0.15 s at 60 Hz (GDD §6.1). */
export const MENU_REPEAT_INTERVAL_TICKS = 9;

/** Hold-repeat state of one direction. */
type Repeat = {
  readonly bit: number;
  /** Ticks to the next repeat while held; 0 when no press has started one. */
  countdown: number;
  /** Held when reset() ran: ignored until released (or pressed afresh). */
  suppressed: boolean;
};

/** Menu commands per tick, with hold-repeat. */
export class MenuInputSampler {
  private readonly source: MenuInputSource;
  private readonly up: Repeat = { bit: ACTION.MENU_UP, countdown: 0, suppressed: false };
  private readonly down: Repeat = { bit: ACTION.MENU_DOWN, countdown: 0, suppressed: false };

  constructor(source: MenuInputSource) {
    this.source = source;
  }

  /** The source the sampler reads (its active device and pointer queue are read through it too). */
  get input(): MenuInputSource {
    return this.source;
  }

  /** Drops latched edges and ignores the directions held now until they are released. */
  reset(): void {
    this.source.takeMenuEdges();
    const held = this.source.menuHeld;
    resetRepeat(this.up, held);
    resetRepeat(this.down, held);
  }

  /** This tick's MENU_* command bits: edges plus hold-repeat steps. Call once per tick. */
  sample(): number {
    const edges = this.source.takeMenuEdges();
    const held = this.source.menuHeld;
    let out = edges & (ACTION.MENU_SELECT | ACTION.MENU_BACK);
    out |= stepRepeat(this.up, edges, held);
    out |= stepRepeat(this.down, edges, held);
    return out;
  }
}

function resetRepeat(repeat: Repeat, held: number): void {
  repeat.countdown = 0;
  repeat.suppressed = (held & repeat.bit) !== 0;
}

/** One tick of one direction: its bit when it steps this tick, else 0. */
function stepRepeat(repeat: Repeat, edges: number, held: number): number {
  const bit = repeat.bit;
  const pressed = (edges & bit) !== 0;
  const holding = (held & bit) !== 0;
  if (repeat.suppressed) {
    if (!pressed) {
      if (!holding) repeat.suppressed = false;
      return 0;
    }
    repeat.suppressed = false; // released and pressed again between two ticks
  }
  if (pressed) {
    repeat.countdown = MENU_REPEAT_DELAY_TICKS;
    return bit;
  }
  if (!holding) {
    repeat.countdown = 0;
    return 0;
  }
  if (repeat.countdown === 0) {
    // Held with no press seen (the press was taken elsewhere): start the delay now.
    repeat.countdown = MENU_REPEAT_DELAY_TICKS;
    return 0;
  }
  repeat.countdown -= 1;
  if (repeat.countdown > 0) return 0;
  repeat.countdown = MENU_REPEAT_INTERVAL_TICKS;
  return bit;
}
