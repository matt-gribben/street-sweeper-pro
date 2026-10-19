// ShiftIntroScene, placeholder (TECHNICAL_DESIGN §6.2, §6.3; GDD §15.1, §15.4; SSP-071): the card before a shift.
// Text only (src/ui/introCard.ts): the district name, a one-line briefing placeholder and 'Press Space to start'.
// It is the first scene of the shift flow (src/app/shiftFlow.ts) and what `npm run dev` boots into.
//
//   enter()             loads the `ui` atlas and the font (uiScreen.ts), then starts loading the compiled level
//                       (levelLoader.ts) without waiting for it, so the card is on screen while the level loads
//                       (§6.3). With options.level (Back to Briefing, or a level loaded before) there is nothing
//                       to load. Menu edges latched before the card showed are dropped.
//   fixedUpdate()       takes the tick's menu edges (actions.ts takeMenuEdges: Space / Enter, pad A / Start).
//                       MENU_SELECT starts the shift: onStart(level) once the level is in. A press while it is
//                       still loading is kept, and the shift starts the moment the level arrives. The sim
//                       InputFrame is ignored: menu input never reaches a sim (§13.1).
//   render()            draws the card, re-laid out only when the width or the prompt changes.
//
// Big Pam's portrait and the real card art are M4 (SSP-157); the music stems' background decode is M5.
import type { SceneContext } from '../app/Game.ts';
import { type LevelSource, loadLevel } from '../app/levelLoader.ts';
import type { Scene, SceneParams } from '../app/SceneManager.ts';
import { ACTION, type MenuInputSource } from '../input/actions.ts';
import { INTERNAL_HEIGHT_PX } from '../render/upscale.ts';
import type { InputFrame } from '../sim/inputFrame.ts';
import type { Level } from '../sim/map.ts';
import type { FontJsonSource } from '../ui/bitmapText.ts';
import { IntroStatus, introCardLayout } from '../ui/introCard.ts';
import { type UiItem, uiItemStrings } from '../ui/uiItems.ts';
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
  /** Fetches the font metrics (default: the browser's fetch). Tests inject a file reader. */
  readonly fontSource?: FontJsonSource;
};

/** The intro card. */
export class ShiftIntroScene implements Scene {
  readonly id = 'shift_intro';
  readonly blocksUpdateBelow = false;
  readonly simEvents = null;
  readonly district: string;
  private readonly context: SceneContext;
  private readonly menu: MenuInputSource;
  private readonly onStart: (level: Level) => void;
  private readonly levelSource: LevelSource | undefined;
  private readonly fontSource: FontJsonSource | undefined;
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

  constructor(context: SceneContext, options: ShiftIntroOptions) {
    districtLevelName(options.district); // throws for anything but `district.<snake_name>`
    this.context = context;
    this.district = options.district;
    this.menu = options.menu;
    this.onStart = options.onStart;
    this.loaded = options.level ?? null;
    this.levelSource = options.levelSource;
    this.fontSource = options.fontSource;
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
    this.screen = await UiScreen.load(this.context, 'shift_intro', this.fontSource);
    this.menu.takeMenuEdges();
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
    const edges = this.menu.takeMenuEdges();
    if ((edges & ACTION.MENU_SELECT) !== 0 && !this.failed) {
      this.startRequested = true;
      this.maybeStart();
    }
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
    if (width !== this.laidOutWidth || status !== this.laidOutStatus) {
      this.items = introCardLayout(screen.font, width, INTERNAL_HEIGHT_PX, this.district, status);
      this.laidOutWidth = width;
      this.laidOutStatus = status;
    }
    return this.items;
  }
}
