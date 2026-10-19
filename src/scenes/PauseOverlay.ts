// PauseOverlay (GDD §15.1, §15.4, §16.3, §17.2; TECHNICAL_DESIGN §6.1, §6.2; SSP-287): pushed over the ShiftScene on
// the Pause action (Esc / P, pad Start) or when the tab is hidden, through ShiftScene.requestPause(reason) and the
// shift flow (src/app/shiftFlow.ts). `blocksUpdateBelow` is true, so the ShiftScene keeps rendering but never steps
// (it also refuses to step from the moment it asked for the pause, before this scene has joined the stack).
//
//   enter()        takes the `ui` atlas and the font from the asset registry (uiScreen.ts, drawn over the HUD with
//                  a higher renderOrder), drops menu edges, clicks and Pause presses latched before it showed,
//                  turns the renderer's pause dim on (the palette pass takes every world pixel one step down the
//                  shadow ramp; the HUD and this overlay, UI pixels, are unchanged) and emits PauseOpened.
//   fixedUpdate()  one tick of input on the page shown. Back (Esc, Backspace, pad B) goes back: on the main page it
//                  resumes, on the Controls page it returns to the main page. Otherwise the Pause action (P, pad
//                  Start; Esc counts as Back) resumes from either page. Otherwise the menu (menus.ts) takes the tick:
//                  W/↑, S/↓, the D-pad and the left stick move the focus, Space / Enter / pad A select, a click picks
//                  the button under the pointer. Resume, Restart Shift and Retire close the overlay: from then on all
//                  input is ignored and the chosen button stays Pressed while the flow switches scenes.
//   render()       draws the page, re-laid out only when the width, the page, the menu's state or (Controls) the
//                  active device changes.
//   exit()         releases the UI batch, turns the dim off and emits PauseClosed with how it closed.
//
// The main page's entries are data (src/ui/pausePage.ts PAUSE_ENTRIES), each with a visibility predicate over
// PauseConditions: Settings and Finish Sweep stay hidden (and unfocusable) until SSP-235 and SSP-196. Controls is a
// read-only page of the current bindings for the active device (glyphs.ts). The sim InputFrame is ignored: menu
// input and the Pause action never reach a sim (§13.1), so pausing is never part of a replay.
//
// Draw calls: the UI batch (1), on top of the shift's 8: 9 of the 10 allowed (TECHNICAL_DESIGN §12.7).
import { type PauseEventSink, PauseExit, type PauseReason } from '../app/events.ts';
import type { SceneContext } from '../app/Game.ts';
import type { Scene, SceneParams } from '../app/SceneManager.ts';
import { ACTION, type MenuInputSource } from '../input/actions.ts';
import { INTERNAL_HEIGHT_PX } from '../render/upscale.ts';
import type { InputFrame } from '../sim/inputFrame.ts';
import type { GlyphDevice, GlyphTable } from '../ui/glyphs.ts';
import { MENU_COMMAND, Menu, type MenuItem } from '../ui/menus.ts';
import type { ButtonState } from '../ui/panels.ts';
import {
  CONTROLS_BACK_LABEL,
  controlsBackRect,
  controlsPageLayout,
  M3_PAUSE_CONDITIONS,
  PAUSE_ENTRIES,
  type PauseConditions,
  PauseEntry,
  pauseButtonRects,
  pauseMainLayout,
} from '../ui/pausePage.ts';
import { type UiItem, uiItemStrings } from '../ui/uiItems.ts';
import { MenuController } from './menuController.ts';
import { UiScreen } from './uiScreen.ts';

/** The overlay's UI batch renderOrder: above the HUD's (0), so its quads draw over the HUD. */
export const PAUSE_UI_ORDER = 1;

/** The overlay's pages. */
export const PausePage = { Main: 0, Controls: 1 } as const;
export type PausePage = (typeof PausePage)[keyof typeof PausePage];

export type PauseOverlayOptions = {
  /** Why the game paused (reported in PauseOpened). */
  readonly reason: PauseReason;
  /** Where the overlay reads its menu input and the Pause action (Actions in the browser). */
  readonly menu: MenuInputSource;
  /** The bindings the Controls page lists (glyphBindings.ts DEFAULT_GLYPHS until SSP-236). */
  readonly glyphs: GlyphTable;
  /** What the entries' visibility depends on (default: M3, Settings and Finish Sweep hidden). */
  readonly conditions?: PauseConditions;
  /** Resume: the flow pops the overlay and lets the shift step again. Called once. */
  readonly onResume: () => void;
  /** Restart Shift: the same district and seed, straight into a fresh ShiftScene (SSP-071's Try Again path). */
  readonly onRestart: () => void;
  /** Retire: back to the intro card, standing in for the Week Map until SSP-191. */
  readonly onRetire: () => void;
};

/** The pause overlay. */
export class PauseOverlay implements Scene {
  readonly id = 'pause';
  readonly blocksUpdateBelow = true;
  readonly simEvents = null;
  readonly reason: PauseReason;
  readonly conditions: PauseConditions;
  private readonly context: SceneContext;
  private readonly source: MenuInputSource;
  private readonly glyphs: GlyphTable;
  private readonly input: MenuController;
  private readonly options: PauseOverlayOptions;
  private mainMenu: Menu;
  private controlsMenu: Menu;
  private shown: PausePage = PausePage.Main;
  private closedBy: PauseExit | null = null;
  private screen: UiScreen | null = null;
  private dimSet = false;
  private items: readonly UiItem[] = [];
  /** Width, page, menu state and device the items were laid out for (width −1: never). */
  private laidOut = { width: -1, page: -1, key: -1, device: '' };

  constructor(context: SceneContext, options: PauseOverlayOptions) {
    this.context = context;
    this.options = options;
    this.reason = options.reason;
    this.source = options.menu;
    this.glyphs = options.glyphs;
    this.conditions = options.conditions ?? M3_PAUSE_CONDITIONS;
    this.input = new MenuController(context, options.menu);
    this.mainMenu = this.createMainMenu(PauseEntry.Resume);
    this.controlsMenu = this.createControlsMenu();
  }

  /** The page shown. */
  get page(): PausePage {
    return this.shown;
  }

  /** The menu of the page shown (main: PauseEntry order; Controls: its Back button). */
  get menu(): Menu {
    return this.shown === PausePage.Main ? this.mainMenu : this.controlsMenu;
  }

  /** How the overlay closed (Resume, Restart Shift, Retire), or null while it waits for the player. */
  get choice(): PauseExit | null {
    return this.closedBy;
  }

  /** The device the Controls page lists bindings for: the one the player used last. */
  get device(): GlyphDevice {
    return this.source.activeDevice;
  }

  /** The strings the page shows now, top to bottom. */
  get text(): string[] {
    return uiItemStrings(this.layout());
  }

  async enter(_params: SceneParams): Promise<void> {
    this.screen = UiScreen.open(this.context, 'pause', PAUSE_UI_ORDER);
    this.input.reset();
    this.source.takeSceneEdges(ACTION.PAUSE);
    this.context.renderer.dim = true;
    this.dimSet = true;
    this.events().emitPauseOpened(this.reason);
  }

  exit(): void {
    this.screen?.dispose();
    this.screen = null;
    if (this.dimSet) {
      this.context.renderer.dim = false;
      this.dimSet = false;
      this.events().emitPauseClosed(this.closedBy ?? PauseExit.Resume);
    }
  }

  fixedUpdate(_input: Readonly<InputFrame>): void {
    const commands = this.input.takeCommands();
    const pause = this.source.takeSceneEdges(ACTION.PAUSE) !== 0;
    if (this.closedBy !== null) {
      this.input.dispatch(null, 0);
      return;
    }
    // Rects follow the current width and page before any click is hit-tested.
    this.layout();
    const menu = this.menu;
    if ((commands & MENU_COMMAND.Back) !== 0) {
      this.input.dispatch(menu, MENU_COMMAND.Back);
    } else if (pause) {
      this.input.dispatch(null, 0);
      this.close(PauseExit.Resume);
    } else {
      this.input.dispatch(menu, commands);
    }
  }

  render(_alpha: number): void {
    this.screen?.draw(this.layout());
  }

  private events(): PauseEventSink {
    return this.context.events;
  }

  private close(exit: PauseExit): void {
    if (this.closedBy !== null) return;
    this.closedBy = exit;
    if (exit === PauseExit.Resume) this.options.onResume();
    else if (exit === PauseExit.Restart) this.options.onRestart();
    else this.options.onRetire();
  }

  private showPage(page: PausePage): void {
    if (page === PausePage.Controls) this.controlsMenu = this.createControlsMenu();
    else this.mainMenu = this.createMainMenu(PauseEntry.Controls);
    this.shown = page;
  }

  private createMainMenu(focus: PauseEntry): Menu {
    const conditions = this.conditions;
    const unavailable = (what: string) => (): void => {
      throw new Error(`PauseOverlay: ${what} is hidden until its scene or mode exists`);
    };
    const actions: { readonly [E in PauseEntry]: () => void } = {
      [PauseEntry.Resume]: () => this.close(PauseExit.Resume),
      [PauseEntry.RestartShift]: () => this.close(PauseExit.Restart),
      [PauseEntry.Settings]: unavailable('Settings (SSP-235)'),
      [PauseEntry.Controls]: () => this.showPage(PausePage.Controls),
      [PauseEntry.Retire]: () => this.close(PauseExit.Retire),
      [PauseEntry.FinishSweep]: unavailable('Finish Sweep (SSP-196)'),
    };
    const items: MenuItem[] = PAUSE_ENTRIES.map((spec) => ({
      label: spec.label,
      onSelect: actions[spec.entry],
      visible: () => spec.visible(conditions),
    }));
    return new Menu({
      id: 'pause',
      items,
      events: this.context.events,
      focus,
      onBack: () => this.close(PauseExit.Resume),
    });
  }

  private createControlsMenu(): Menu {
    const back = (): void => this.showPage(PausePage.Main);
    return new Menu({
      id: 'pause_controls',
      items: [{ label: CONTROLS_BACK_LABEL, onSelect: back }],
      events: this.context.events,
      onBack: back,
    });
  }

  private layout(): readonly UiItem[] {
    const screen = this.screen;
    if (screen === null) return this.items;
    const width = this.context.renderer.rig.internalWidth;
    const page = this.shown;
    const menu = this.menu;
    const key = menu.stateKey();
    const device = page === PausePage.Controls ? this.device : '';
    const last = this.laidOut;
    if (width !== last.width || page !== last.page || key !== last.key || device !== last.device) {
      const font = screen.font;
      if (page === PausePage.Main) {
        menu.setRects(pauseButtonRects(font, width, INTERNAL_HEIGHT_PX, this.conditions));
        const states: ButtonState[] = menu.items.map((_item, i) => menu.buttonState(i));
        this.items = pauseMainLayout(font, width, INTERNAL_HEIGHT_PX, this.conditions, states);
      } else {
        menu.setRects([controlsBackRect(font, this.glyphs, width, INTERNAL_HEIGHT_PX)]);
        this.items = controlsPageLayout(
          font,
          this.glyphs,
          this.device,
          width,
          INTERNAL_HEIGHT_PX,
          menu.buttonState(0),
        );
      }
      this.laidOut = { width, page, key, device };
    }
    return this.items;
  }
}
