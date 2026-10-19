// TallyScene, numbers only (TECHNICAL_DESIGN §6.2; GDD §11.3, §15.1, §15.3; SSP-071): the page after a shift.
// The shift flow (src/app/shiftFlow.ts) enters it on EV.ShiftEnd, after the knock-off coast or on TOWED, with the
// SimSnapshot the shift ended in; src/ui/tallyPage.ts lays the figures out.
//
//   enter()        loads the `ui` atlas and the font (uiScreen.ts) and drops the menu edges latched during the
//                  shift (Space is the brush too, so a press made while driving must never pick a button).
//   fixedUpdate()  ignores menu input for TALLY_INPUT_LOCK_TICKS (0.5 s, so a brush or horn press made as the
//                  shift ended cannot pick a button either), then takes the tick's menu edges: W/↑, S/↓, D-pad and
//                  left stick move the focus (wrapping), Space / Enter / pad A / Start pick the focused button,
//                  Esc / Backspace / pad B pick Back to Briefing. Try Again is the default focus (GDD §15.3).
//                  The first pick calls onRetry or onBack once and draws that button pressed; later input is
//                  ignored. The sim InputFrame is ignored: menu input never reaches a sim (§13.1).
//   render()       draws the page, re-laid out only when the width, the focus or the pressed state changes.
//   snapshot()     the SimSnapshot the shift ended with: `__ssp.state()` returns it while the page shows.
//
// Back to Briefing stands in for 'quit' until a TitleScene exists (GDD §15.1). Mouse selection is SSP-286.
import type { SceneContext } from '../app/Game.ts';
import type { Scene, SceneParams } from '../app/SceneManager.ts';
import { ACTION, type MenuInputSource } from '../input/actions.ts';
import { INTERNAL_HEIGHT_PX } from '../render/upscale.ts';
import type { InputFrame } from '../sim/inputFrame.ts';
import type { SimSnapshot } from '../sim/snapshot.ts';
import type { FontJsonSource } from '../ui/bitmapText.ts';
import { districtDisplayName } from '../ui/introCard.ts';
import {
  stepTallyFocus,
  TallyButton,
  type TallyFigures,
  tallyFigures,
  tallyPageLayout,
} from '../ui/tallyPage.ts';
import { type UiItem, uiItemStrings } from '../ui/uiItems.ts';
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
  private readonly context: SceneContext;
  private readonly menu: MenuInputSource;
  private readonly onRetry: () => void;
  private readonly onBack: () => void;
  private readonly fontSource: FontJsonSource | undefined;
  private screen: UiScreen | null = null;
  private lockTicks = TALLY_INPUT_LOCK_TICKS;
  private focused: TallyButton = TallyButton.TryAgain;
  private chosen: TallyButton | null = null;
  private items: readonly UiItem[] = [];
  /** Width, focus and pressed state the items were laid out for (width −1: never). */
  private laidOut = { width: -1, focus: -1, pressed: false };

  constructor(context: SceneContext, options: TallySceneOptions) {
    this.context = context;
    this.result = options.result;
    this.figures = tallyFigures(options.result.snapshot, districtDisplayName(options.result.district));
    this.menu = options.menu;
    this.onRetry = options.onRetry;
    this.onBack = options.onBack;
    this.fontSource = options.fontSource;
  }

  /** The focused button. */
  get focus(): TallyButton {
    return this.focused;
  }

  /** The button picked, or null while the page waits for the player. */
  get choice(): TallyButton | null {
    return this.chosen;
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
    this.menu.takeMenuEdges();
  }

  exit(): void {
    this.screen?.dispose();
    this.screen = null;
  }

  fixedUpdate(_input: Readonly<InputFrame>): void {
    const edges = this.menu.takeMenuEdges();
    if (this.lockTicks > 0) {
      this.lockTicks -= 1;
      return;
    }
    if (this.chosen !== null) return;
    this.focused = stepTallyFocus(
      this.focused,
      (edges & ACTION.MENU_UP) !== 0,
      (edges & ACTION.MENU_DOWN) !== 0,
    );
    if ((edges & ACTION.MENU_SELECT) !== 0) this.choose(this.focused);
    else if ((edges & ACTION.MENU_BACK) !== 0) this.choose(TallyButton.BackToBriefing);
  }

  render(_alpha: number): void {
    this.screen?.draw(this.layout());
  }

  private choose(button: TallyButton): void {
    this.focused = button;
    this.chosen = button;
    if (button === TallyButton.TryAgain) this.onRetry();
    else this.onBack();
  }

  private layout(): readonly UiItem[] {
    const screen = this.screen;
    if (screen === null) return this.items;
    const width = this.context.renderer.rig.internalWidth;
    const pressed = this.chosen !== null;
    const last = this.laidOut;
    if (width !== last.width || this.focused !== last.focus || pressed !== last.pressed) {
      this.items = tallyPageLayout(
        screen.font,
        width,
        INTERNAL_HEIGHT_PX,
        this.figures,
        this.focused,
        pressed,
      );
      this.laidOut = { width, focus: this.focused, pressed };
    }
    return this.items;
  }
}
