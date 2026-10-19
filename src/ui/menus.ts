// Menus (GDD §6.1, §15.1; ART_BIBLE §12.3; SSP-286): the shared menu model every screen navigates with. A Menu is
// a vertical list of items (a label, optional enabled and visible predicates, and onSelect), a focus, a back
// handler, and the on-screen rect of each item for the mouse. It knows nothing about devices: the scene layer
// (src/scenes/menuController.ts) turns the tick's keyboard and pad commands (src/input/menuInput.ts, with
// hold-repeat) into command() calls, and the canvas pointer samples, mapped to internal pixels, into
// pointerDown() / pointerUp() calls.
//
//   Up / Down   move the focus to the previous / next item that is visible and enabled, wrapping at the ends.
//               Up and Down in the same tick cancel out. A move that cannot change the focus (one reachable item)
//               does nothing.
//   Select      selects the focused item (if it is reachable): it is drawn Pressed and its onSelect runs.
//   Back        with `backItem`, selects that item as if it had been focused (the tally's Esc picks Back to
//               Briefing); otherwise calls `onBack`; with neither, does nothing.
//   Mouse       a press on a reachable item focuses it and arms it (drawn Pressed while held); the release over
//               the same item selects it. A release elsewhere, or a cancel, disarms. Hover does nothing (GDD
//               §15.1: no hover-only information). Selecting on release is what SSP-262's taps reuse.
//   `once`      after the first Select or Back the menu ignores all input and keeps the chosen item Pressed (the
//               next scene is loading).
//
// Events (src/app/events.ts UI_EV): each action that does something emits exactly one event: UiMove for a
// keyboard/pad focus change, UiSelect for a selection (keyboard, pad or mouse), UiBack for Back. A mouse press that
// moves the focus emits nothing (the click is one action, reported once as UiSelect). Events are emitted before the
// item's callback runs. Audio maps them to sfx.ui_move / ui_select / ui_back in M5.
//
// Drawing: buttonState(i) gives each item's panels.ts ButtonState (Disabled, Pressed, Focus or Normal) and
// buttonItems() the laid-out buttons as UiItems, drawn through Panels.drawButton (uiItems.ts drawUiItems). A
// screen that draws its item some other way (the intro card's prompt line) still uses the model and the rects.
//
// Off the per-tick path nothing here is hot: commands come a few times a second. The predicates run on every
// navigation and every state query, so they must be cheap and must not change state.
import { UI_EV, type UiEventSink } from '../app/events.ts';
import { ButtonState, type UiRect } from './panels.ts';
import type { UiItem } from './uiItems.ts';

/** One menu entry. */
export type MenuItem = {
  readonly label: string;
  /** Runs once per selection. */
  readonly onSelect: () => void;
  /** False greys the item out (ButtonState.Disabled) and the focus skips it. Default: enabled. */
  readonly enabled?: () => boolean;
  /** False hides the item: the focus skips it, it is not drawn and not hit. Default: visible. */
  readonly visible?: () => boolean;
};

/** Navigation commands, as bits (several may arrive in one tick). */
export const MENU_COMMAND = { Up: 1, Down: 2, Select: 4, Back: 8 } as const;

export type MenuOptions = {
  /** Reported as `menu` in every UI event (`tally`, `shift_intro`, ...). */
  readonly id: string;
  readonly items: readonly MenuItem[];
  /** Where UiMove / UiSelect / UiBack go (the scene context's EventBus), or null. */
  readonly events: UiEventSink | null;
  /** The item focused first (the first reachable one at or after it). Default 0. */
  readonly focus?: number;
  /** Back selects this item (focused and drawn Pressed; the event is UiBack). Takes precedence over onBack. */
  readonly backItem?: number;
  /** Back calls this (when there is no backItem). */
  readonly onBack?: () => void;
  /** Ignore all input after the first Select or Back. */
  readonly once?: boolean;
};

/** No item (focus, selection or armed item). */
export const NO_ITEM = -1;

/** Items Menu.stateKey() tells apart exactly (3^16 · 2^18 stays below 2^53). */
export const MENU_KEY_MAX_ITEMS = 16;

/** A vertical menu: model, navigation, hit-testing and button states. */
export class Menu {
  readonly id: string;
  readonly items: readonly MenuItem[];
  private readonly events: UiEventSink | null;
  private readonly backItem: number;
  private readonly onBack: (() => void) | null;
  private readonly once: boolean;
  private focusIndex: number;
  private selectedIndex = NO_ITEM;
  private armedIndex = NO_ITEM;
  private done = false;
  private rects: readonly (UiRect | null)[] = [];

  constructor(options: MenuOptions) {
    const items = options.items;
    if (items.length === 0) throw new RangeError(`menu '${options.id}' has no items`);
    const start = options.focus ?? 0;
    if (!Number.isInteger(start) || start < 0 || start >= items.length) {
      throw new RangeError(`menu '${options.id}': focus ${start} is not an item`);
    }
    const backItem = options.backItem ?? NO_ITEM;
    if (backItem !== NO_ITEM && (!Number.isInteger(backItem) || backItem < 0 || backItem >= items.length)) {
      throw new RangeError(`menu '${options.id}': backItem ${backItem} is not an item`);
    }
    this.id = options.id;
    this.items = items;
    this.events = options.events;
    this.backItem = backItem;
    this.onBack = options.onBack ?? null;
    this.once = options.once ?? false;
    this.focusIndex = start;
    if (!this.isReachable(start)) {
      const next = this.nextReachable(start, 1);
      if (next !== NO_ITEM) this.focusIndex = next;
    }
  }

  /** The focused item. */
  get focus(): number {
    return this.focusIndex;
  }

  /** The item selected last (drawn Pressed), or NO_ITEM. A move clears it (unless the menu is `once`). */
  get selected(): number {
    return this.selectedIndex;
  }

  /** The item a mouse press is holding (drawn Pressed until the release), or NO_ITEM. */
  get armed(): number {
    return this.armedIndex;
  }

  /** True once a `once` menu has made its choice: it ignores all input from then on. */
  get finished(): boolean {
    return this.done;
  }

  isVisible(i: number): boolean {
    const item = this.items[i];
    return item !== undefined && (item.visible?.() ?? true);
  }

  isEnabled(i: number): boolean {
    const item = this.items[i];
    return item !== undefined && (item.enabled?.() ?? true);
  }

  /** Visible and enabled: the focus can land on it and it can be selected. */
  isReachable(i: number): boolean {
    return this.isVisible(i) && this.isEnabled(i);
  }

  /** Applies one tick's MENU_COMMAND bits: the move first, then Select, else Back. */
  command(bits: number): void {
    const up = (bits & MENU_COMMAND.Up) !== 0;
    const down = (bits & MENU_COMMAND.Down) !== 0;
    if (up !== down) this.move(down ? 1 : -1);
    if ((bits & MENU_COMMAND.Select) !== 0) this.select();
    else if ((bits & MENU_COMMAND.Back) !== 0) this.back();
  }

  /** Moves the focus to the next (1) or previous (−1) reachable item, wrapping. True (and UiMove) if it moved. */
  move(step: 1 | -1): boolean {
    if (this.done) return false;
    const next = this.nextReachable(this.focusIndex, step);
    if (next === NO_ITEM || next === this.focusIndex) return false;
    this.focusIndex = next;
    this.selectedIndex = NO_ITEM;
    this.armedIndex = NO_ITEM;
    this.events?.emitUi(UI_EV.UiMove, this.id, next);
    return true;
  }

  /** Selects the focused item if it is reachable. True (UiSelect, then its onSelect) if it did. */
  select(): boolean {
    if (this.done) return false;
    const i = this.focusIndex;
    const item = this.items[i];
    if (item === undefined || !this.isReachable(i)) return false;
    this.choose(i);
    this.events?.emitUi(UI_EV.UiSelect, this.id, i);
    item.onSelect();
    return true;
  }

  /** Goes back (backItem, else onBack). True (UiBack, then the handler) if there was something to do. */
  back(): boolean {
    if (this.done) return false;
    const backItem = this.backItem;
    if (backItem !== NO_ITEM) {
      const item = this.items[backItem];
      if (item === undefined || !this.isReachable(backItem)) return false;
      this.focusIndex = backItem;
      this.choose(backItem);
      this.events?.emitUi(UI_EV.UiBack, this.id, backItem);
      item.onSelect();
      return true;
    }
    const onBack = this.onBack;
    if (onBack === null) return false;
    this.armedIndex = NO_ITEM;
    if (this.once) this.done = true;
    this.events?.emitUi(UI_EV.UiBack, this.id, this.focusIndex);
    onBack();
    return true;
  }

  /** Each item's on-screen rect in internal pixels, by item index (null: not on screen). Set on every relayout. */
  setRects(rects: readonly (UiRect | null)[]): void {
    this.rects = rects;
  }

  /** The visible item whose rect contains internal pixel (x, y), or NO_ITEM. */
  itemAt(xPx: number, yPx: number): number {
    const rects = this.rects;
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      if (r === null || r === undefined || !this.isVisible(i)) continue;
      if (xPx >= r.x && xPx < r.x + r.w && yPx >= r.y && yPx < r.y + r.h) return i;
    }
    return NO_ITEM;
  }

  /** A mouse press at internal pixel (x, y): focuses and arms the reachable item there. True if there was one. */
  pointerDown(xPx: number, yPx: number): boolean {
    if (this.done) return false;
    const i = this.itemAt(xPx, yPx);
    if (i === NO_ITEM || !this.isReachable(i)) {
      this.armedIndex = NO_ITEM;
      return false;
    }
    if (i !== this.focusIndex) this.selectedIndex = NO_ITEM;
    this.focusIndex = i;
    this.armedIndex = i;
    return true;
  }

  /** A mouse release at internal pixel (x, y): selects the armed item if the release is over it. */
  pointerUp(xPx: number, yPx: number): boolean {
    if (this.done) return false;
    const armed = this.armedIndex;
    this.armedIndex = NO_ITEM;
    if (armed === NO_ITEM || this.itemAt(xPx, yPx) !== armed) return false;
    this.focusIndex = armed;
    return this.select();
  }

  /** The press was cancelled (or released off the frame): nothing is armed. */
  pointerCancel(): void {
    this.armedIndex = NO_ITEM;
  }

  /** How item `i` draws (ART_BIBLE §12.3): Disabled, Pressed (selected or armed), Focus or Normal. */
  buttonState(i: number): ButtonState {
    if (!this.isEnabled(i)) return ButtonState.Disabled;
    if (i === this.selectedIndex || i === this.armedIndex) return ButtonState.Pressed;
    if (i === this.focusIndex) return ButtonState.Focus;
    return ButtonState.Normal;
  }

  /** Every visible item that has a rect, as a button UiItem in its current state (drawn by drawUiItems). */
  buttonItems(): UiItem[] {
    const out: UiItem[] = [];
    const rects = this.rects;
    for (let i = 0; i < this.items.length; i++) {
      const rect = rects[i];
      const item = this.items[i];
      if (rect === null || rect === undefined || item === undefined || !this.isVisible(i)) continue;
      out.push({ kind: 'button', state: this.buttonState(i), rect, label: item.label });
    }
    return out;
  }

  /**
   * A number that changes whenever anything buttonState() or buttonItems() depend on changes (focus, selection,
   * armed item, each item's visible and enabled state), so a screen relayouts only then. Allocates nothing. Exact
   * for menus of up to MENU_KEY_MAX_ITEMS items.
   */
  stateKey(): number {
    let flags = 0;
    for (let i = 0; i < this.items.length && i < MENU_KEY_MAX_ITEMS; i++) {
      flags = flags * 3 + (this.isVisible(i) ? (this.isEnabled(i) ? 2 : 1) : 0);
    }
    return (
      this.focusIndex + 1 + 64 * (this.selectedIndex + 1) + 4096 * (this.armedIndex + 1) + 262_144 * flags
    );
  }

  private choose(i: number): void {
    this.selectedIndex = i;
    this.armedIndex = NO_ITEM;
    if (this.once) this.done = true;
  }

  /** The first reachable item after `from` going `step`, wrapping (may be `from` itself), or NO_ITEM. */
  private nextReachable(from: number, step: 1 | -1): number {
    const n = this.items.length;
    for (let k = 1; k <= n; k++) {
      const i = (((from + step * k) % n) + n) % n;
      if (this.isReachable(i)) return i;
    }
    return NO_ITEM;
  }
}
