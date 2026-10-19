// TallyScene, numbers only (TECHNICAL_DESIGN §6.2; GDD §11.3, §15.1, §15.3; SSP-071): the page after a shift.
// The shift flow (src/app/shiftFlow.ts) enters it on EV.ShiftEnd, after the knock-off coast or on SACKED or TOWED
// (SSP-079), with the SimSnapshot the shift ended in; src/ui/tallyPage.ts lays the figures out (the end reason,
// and the final score and stars of GDD §11.3).
//
//   enter()        loads the `ui` atlas and the font (uiScreen.ts) and resets its menu input (menuController.ts):
//                  menu edges and clicks latched during the shift are dropped (Space is the brush too, so a press
//                  made while driving must never pick a button), and a direction still held is ignored until
//                  released.
//   fixedUpdate()  ignores menu input for TALLY_INPUT_LOCK_TICKS (0.5 s, so a brush or horn press made as the
//                  shift ended cannot pick a button either), then feeds the tick's input to the buttons' Menu
//                  (src/ui/menus.ts, SSP-286): W/↑, S/↓, the D-pad and the left stick move the focus (wrapping, with
//                  hold-repeat), Space / Enter / pad A / Start pick the focused button, Esc / Backspace / pad B pick
//                  Back to Briefing, and a mouse click picks the button under the pointer (on release). Try Again
//                  is the default focus after every end, SACKED and TOWED included (GDD §11.3, §15.3): it
//                  restarts the same shift with the intro card skipped. The Menu is `once`: the first pick calls onRetry or onBack once
//                  and draws that button pressed; later input is ignored. UiMove / UiSelect / UiBack go to the
//                  scene context's bus. The sim InputFrame is ignored: menu input never reaches a sim (§13.1).
//   render()       draws the page, re-laid out only when the width or the menu's state changes.
//   snapshot()     the SimSnapshot the shift ended with: `__ssp.state()` returns it while the page shows.
//
// Back to Briefing stands in for 'quit' until a TitleScene exists (GDD §15.1).
import type { SceneContext } from '../app/Game.ts';
import type { Scene, SceneParams } from '../app/SceneManager.ts';
import type { MenuInputSource } from '../input/actions.ts';
import { INTERNAL_HEIGHT_PX } from '../render/upscale.ts';
import type { InputFrame } from '../sim/inputFrame.ts';
import type { SimSnapshot } from '../sim/snapshot.ts';
import type { FontJsonSource } from '../ui/bitmapText.ts';
import { districtDisplayName } from '../ui/introCard.ts';
import { Menu } from '../ui/menus.ts';
import type { ButtonState } from '../ui/panels.ts';
import {
  TALLY_BUTTON_LABELS,
  TallyButton,
  type TallyFigures,
  tallyButtonRects,
  tallyFigures,
  tallyPageLayout,
} from '../ui/tallyPage.ts';
import { type UiItem, uiItemStrings } from '../ui/uiItems.ts';
import { MenuController } from './menuController.ts';
import { UiScreen } from './uiScreen.ts';

/** Ticks after the page appears during which menu input is ignored (0.5 s, proposed in GDD §15.1). */
export const TALLY_INPUT_LOCK_TICKS = 30;

/** How a shift ended: what the tally shows and what Try Again replays. */
export type TallyResult = {
  /** `district.<name>`. */
  readonly district: string;
  /** The run seed: Try Again restarts with the same one. */
  readonly seed: number;
  /** The World's SimSnapshot on the tick EV.ShiftEnd fired (snapshot.shift.endReason is set). */
  readonly snapshot: SimSnapshot;
};

export type TallySceneOptions = {
  readonly result: TallyResult;
  /** Where the page reads its menu input (Actions in the browser). */
  readonly menu: MenuInputSource;
  /** Try Again: called once. */
  readonly onRetry: () => void;
  /** Back to Briefing: called once. */
  readonly onBack: () => void;
  /** Fetches the font metrics (default: the browser's fetch). Tests inject a file reader. */
  readonly fontSource?: FontJsonSource;
};

/** The numbers-only tally page. */
export class TallyScene implements Scene {
  readonly id = 'tally';
  readonly blocksUpdateBelow = false;
  readonly simEvents = null;
  readonly result: TallyResult;
  readonly figures: TallyFigures;
  /** The buttons (TallyButton order). */
  readonly menu: Menu;
  private readonly context: SceneContext;
  private readonly input: MenuController;
  private readonly fontSource: FontJsonSource | undefined;
  private screen: UiScreen | null = null;
  private lockTicks = TALLY_INPUT_LOCK_TICKS;
  private items: readonly UiItem[] = [];
  /** Width and menu state the items were laid out for (width −1: never). */
  private laidOut = { width: -1, key: -1 };

  constructor(context: SceneContext, options: TallySceneOptions) {
    this.context = context;
    this.result = options.result;
    this.figures = tallyFigures(options.result.snapshot, districtDisplayName(options.result.district));
    this.input = new MenuController(context, options.menu);
    const onRetry = options.onRetry;
    const onBack = options.onBack;
    this.menu = new Menu({
      id: 'tally',
      items: [
        { label: TALLY_BUTTON_LABELS[TallyButton.TryAgain] ?? '', onSelect: () => onRetry() },
        { label: TALLY_BUTTON_LABELS[TallyButton.BackToBriefing] ?? '', onSelect: () => onBack() },
      ],
      events: context.events,
      focus: TallyButton.TryAgain,
      backItem: TallyButton.BackToBriefing,
      once: true,
    });
    this.fontSource = options.fontSource;
  }

  /** The focused button. */
  get focus(): TallyButton {
    return this.menu.focus === TallyButton.BackToBriefing ? TallyButton.BackToBriefing : TallyButton.TryAgain;
  }

  /** The button picked, or null while the page waits for the player. */
  get choice(): TallyButton | null {
    if (!this.menu.finished) return null;
    return this.menu.selected === TallyButton.BackToBriefing
      ? TallyButton.BackToBriefing
      : TallyButton.TryAgain;
  }

  /** The strings the page shows now, top to bottom (the layout is built on first use). */
  get text(): string[] {
    return uiItemStrings(this.layout());
  }

  /** The SimSnapshot the shift ended with (`__ssp.state()` while the page shows). */
  snapshot(): SimSnapshot {
    return this.result.snapshot;
  }

  async enter(_params: SceneParams): Promise<void> {
    this.screen = await UiScreen.load(this.context, 'tally', this.fontSource);
    this.input.reset();
  }

  exit(): void {
    this.screen?.dispose();
    this.screen = null;
  }

  fixedUpdate(_input: Readonly<InputFrame>): void {
    if (this.lockTicks > 0) {
      this.lockTicks -= 1;
      this.input.update(null);
      return;
    }
    // Rects follow the current width before any click is hit-tested.
    this.layout();
    this.input.update(this.menu);
  }

  render(_alpha: number): void {
    this.screen?.draw(this.layout());
  }

  private layout(): readonly UiItem[] {
    const screen = this.screen;
    if (screen === null) return this.items;
    const width = this.context.renderer.rig.internalWidth;
    const menu = this.menu;
    const key = menu.stateKey();
    const last = this.laidOut;
    if (width !== last.width || key !== last.key) {
      menu.setRects(tallyButtonRects(screen.font, width, INTERNAL_HEIGHT_PX));
      const states: ButtonState[] = menu.items.map((_item, i) => menu.buttonState(i));
      this.items = tallyPageLayout(screen.font, width, INTERNAL_HEIGHT_PX, this.figures, states);
      this.laidOut = { width, key };
    }
    return this.items;
  }
}
