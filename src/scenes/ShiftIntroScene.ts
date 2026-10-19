// ShiftIntroScene, placeholder (TECHNICAL_DESIGN §6.2, §6.3; GDD §15.1, §15.4; SSP-071): the card before a shift.
// Text only (src/ui/introCard.ts): the district name, a one-line briefing placeholder and 'Press Space to start'.
// It is the first scene of the shift flow (src/app/shiftFlow.ts) and what `npm run dev` boots into.
//
//   enter()             takes the `ui` atlas and the font from the asset registry (uiScreen.ts, BootScene,
//                       SSP-284), then starts loading the compiled level
//                       (levelLoader.ts) without waiting for it, so the card is on screen while the level loads
//                       (§6.3). With options.level (Back to Briefing, or a level loaded before) there is nothing
//                       to load. Menu edges latched before the card showed are dropped.
//   fixedUpdate()       feeds the tick's menu input to the card's one-item Menu (src/ui/menus.ts, SSP-286, via
//                       menuController.ts): Space / Enter, pad A / Start, or a click anywhere on the card (on
//                       release; the item's hit rect is the whole panel) selects it, which starts the shift:
//                       onStart(level) once the level is in. A press while it is still loading is kept, and the
//                       shift starts the moment the level arrives. The item is disabled once the level has failed.
//                       Back does nothing yet (no Title to go back to). UiSelect goes to the scene context's bus.
//                       The sim InputFrame is ignored: menu input never reaches a sim (§13.1).
//   render()            draws the card, re-laid out only when the width, the prompt or the active input device
//                       changes: the prompt names the select control of the device used last (glyphs.ts:
//                       'Press Space to start', 'Press A to start').
//
// Big Pam's portrait and the real card art are M4 (SSP-157); the music stems' background decode is M5.
import type { SceneContext } from '../app/Game.ts';
import { DEFAULT_GLYPHS } from '../app/glyphBindings.ts';
import { type LevelSource, loadLevel } from '../app/levelLoader.ts';
import type { Scene, SceneParams } from '../app/SceneManager.ts';
import type { InputDeviceKind, MenuInputSource } from '../input/actions.ts';
import { INTERNAL_HEIGHT_PX } from '../render/upscale.ts';
import type { InputFrame } from '../sim/inputFrame.ts';
import type { Level } from '../sim/map.ts';
import { glyphLabel } from '../ui/glyphs.ts';
import { IntroStatus, introCardLayout } from '../ui/introCard.ts';
import { Menu } from '../ui/menus.ts';
import { type UiItem, uiItemStrings } from '../ui/uiItems.ts';
import { MenuController } from './menuController.ts';
import { districtLevelName } from './ShiftScene.ts';
import { UiScreen } from './uiScreen.ts';

export type ShiftIntroOptions = {
  /** The district the card briefs (`district.<name>`). */
  readonly district: string;
  /** Where the card reads Space / Enter / pad A (Actions in the browser). */
  readonly menu: MenuInputSource;
  /** Called once, with the loaded level, when the player starts the shift. */
  readonly onStart: (level: Level) => void;
  /** The level, already loaded: nothing to fetch. */
  readonly level?: Level;
  /** Fetches the compiled level JSON (default: the browser's fetch). Tests inject a file reader. */
  readonly levelSource?: LevelSource;
};

/** The intro card. */
export class ShiftIntroScene implements Scene {
  readonly id = 'shift_intro';
  readonly blocksUpdateBelow = false;
  readonly simEvents = null;
  readonly district: string;
  /** The card as a one-item menu (select: start the shift). */
  readonly menu: Menu;
  private readonly context: SceneContext;
  private readonly input: MenuController;
  private readonly onStart: (level: Level) => void;
  private readonly levelSource: LevelSource | undefined;
  private loaded: Level | null;
  private failed = false;
  private screen: UiScreen | null = null;
  /** Select was pressed (while the level loads, the start waits for it). */
  private startRequested = false;
  private started = false;
  private exited = false;
  private items: readonly UiItem[] = [];
  private laidOutWidth = -1;
  private laidOutStatus: IntroStatus | -1 = -1;
  private laidOutDevice: InputDeviceKind | null = null;

  constructor(context: SceneContext, options: ShiftIntroOptions) {
    districtLevelName(options.district); // throws for anything but `district.<snake_name>`
    this.context = context;
    this.district = options.district;
    this.input = new MenuController(context, options.menu);
    this.menu = new Menu({
      id: 'shift_intro',
      items: [
        {
          label: 'START',
          enabled: () => !this.failed,
          onSelect: () => {
            this.startRequested = true;
            this.maybeStart();
          },
        },
      ],
      events: context.events,
    });
    this.onStart = options.onStart;
    this.loaded = options.level ?? null;
    this.levelSource = options.levelSource;
  }

  /** The level once it has loaded (null while loading, or if it failed). */
  get level(): Level | null {
    return this.loaded;
  }

  /** What the prompt line says now. */
  get status(): IntroStatus {
    if (this.failed) return IntroStatus.Failed;
    return this.loaded === null ? IntroStatus.Loading : IntroStatus.Ready;
  }

  /** True once onStart has been called. */
  get hasStarted(): boolean {
    return this.started;
  }

  /** The strings the card shows now, top to bottom (the layout is built on first use). */
  get text(): string[] {
    return uiItemStrings(this.layout());
  }

  async enter(_params: SceneParams): Promise<void> {
    this.screen = UiScreen.open(this.context, 'shift_intro');
    this.input.reset();
    if (this.loaded !== null) return;
    const name = districtLevelName(this.district);
    loadLevel(name, this.levelSource)
      .then((level) => {
        if (level.id !== this.district) {
          throw new Error(`ShiftIntroScene: ${name}.json holds '${level.id}', not '${this.district}'`);
        }
        this.loaded = level;
        this.maybeStart();
      })
      .catch((error: unknown) => {
        this.failed = true;
        console.error('Street Sweeper Pro: the intro card could not load its level', error);
      });
  }

  exit(): void {
    this.exited = true;
    this.screen?.dispose();
    this.screen = null;
  }

  fixedUpdate(_input: Readonly<InputFrame>): void {
    if (this.startRequested) {
      this.input.update(null); // asked already: the rest is waiting for the level
      return;
    }
    this.layout(); // the hit rect follows the current width before any click is tested
    this.input.update(this.menu);
  }

  render(_alpha: number): void {
    this.screen?.draw(this.layout());
  }

  /** Calls onStart once the player has asked and the level is in (never after exit). */
  private maybeStart(): void {
    const level = this.loaded;
    if (!this.startRequested || this.started || this.exited || level === null) return;
    this.started = true;
    this.onStart(level);
  }

  private layout(): readonly UiItem[] {
    const screen = this.screen;
    if (screen === null) return this.items;
    const width = this.context.renderer.rig.internalWidth;
    const status = this.status;
    const device = this.input.activeDevice;
    if (width !== this.laidOutWidth || status !== this.laidOutStatus || device !== this.laidOutDevice) {
      const glyph = glyphLabel(DEFAULT_GLYPHS, 'menuSelect', device);
      this.items = introCardLayout(screen.font, width, INTERNAL_HEIGHT_PX, this.district, status, glyph);
      const panel = this.items[0];
      this.menu.setRects([
        panel?.kind === 'panel' ? { x: panel.x, y: panel.y, w: panel.w, h: panel.h } : null,
      ]);
      this.laidOutWidth = width;
      this.laidOutStatus = status;
      this.laidOutDevice = device;
    }
    return this.items;
  }
}
