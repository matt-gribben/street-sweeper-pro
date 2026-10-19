// The shift flow (TECHNICAL_DESIGN §6.2, GDD §15.1, SSP-071): the part of the scene flow that exists before
// Boot, Title, Week Map and Workshop (M4-M6). It owns which scene comes next and drives the SceneManager:
//
//   ShiftIntroScene --Space--> ShiftScene --EV.ShiftEnd--> TallyScene --Try Again--> ShiftScene (same seed,
//                       ^         |    ^                             \--Back to Briefing--> ShiftIntroScene
//                       |   Pause |    | Resume
//                       |         v    |
//                       +-Retire- PauseOverlay --Restart Shift--> ShiftScene (same seed, intro skipped)
//
// - The intro card preloads the compiled level (§6.3); the flow keeps it, so Try Again and Back to Briefing fetch
//   no level (Try Again's new ShiftScene loads only its atlases, well inside GDD §11.3's 3 s).
// - EV.ShiftEnd arrives on the bus after the knock-off coast (TIME UP) or on TOWED. The ShiftScene stops stepping
//   its World on that tick, so the snapshot the flow takes there is the state the tally shows, and what
//   `__ssp.state()` keeps returning while the ShiftScene is still on screen and once the tally is up.
// - Try Again replaces the tally with a fresh ShiftScene on the same district and seed: the intro is skipped and
//   the World starts again at tick 0. Back to Briefing replaces it with a fresh intro card (standing in for 'quit'
//   until a TitleScene exists, GDD §15.1).
// - Pause (SSP-287): every ShiftScene the flow builds reads the Pause action from the menu source and asks the flow
//   (onPause) to open the PauseOverlay, which the flow pushes over it (the only push). Resume pops the overlay and
//   lets the shift step again. Restart Shift is Try Again's path: a fresh ShiftScene on the same district and seed,
//   intro skipped, tick 0. Retire is Back to Briefing's: the intro card, standing in for the Week Map until SSP-191
//   (and for TitleScene from SSP-157). The flow refuses a pause while a transition runs or when the shift is not the
//   top scene.
// - Every other transition replaces the whole stack (SceneManager.replaceAll: the overlay and the shift under it go
//   together; on a stack of one it is a plain replace, and a push onto an empty stack at boot). A transition that
//   fails is reported through onError (main.ts logs it) and leaves the old scenes on screen.
//
// The flow also stands in for "the shift" for the dev panel (devShift): its tuning edits apply to the running
// shift and to every shift the flow creates after it, and its replay source is the current ShiftScene.
import type { DevShift } from '../debug/devPanel.ts';
import type { MenuInputSource } from '../input/actions.ts';
import type { PauseOverlayOptions } from '../scenes/PauseOverlay.ts';
import type { ShiftIntroOptions } from '../scenes/ShiftIntroScene.ts';
import type { ShiftScene, ShiftSceneOptions } from '../scenes/ShiftScene.ts';
import type { TallyResult, TallySceneOptions } from '../scenes/TallyScene.ts';
import { EV } from '../sim/eventQueue.ts';
import type { Level } from '../sim/map.ts';
import { DEFAULT_TUNING, type Tuning, tuningsEqual } from '../sim/tuning.ts';
import type { EventBus, PauseReason } from './events.ts';
import { DEFAULT_GLYPHS } from './glyphBindings.ts';
import type { Scene, SceneManager } from './SceneManager.ts';

/** Builds the flow's scenes (main.ts passes the real ones; unit tests pass fakes over the same options). */
export type ShiftFlowFactory = {
  intro(options: ShiftIntroOptions): Scene;
  shift(options: ShiftSceneOptions): ShiftScene;
  tally(options: TallySceneOptions): Scene;
  pause(options: PauseOverlayOptions): Scene;
};

export type ShiftFlowOptions = {
  readonly scenes: SceneManager;
  readonly events: EventBus;
  readonly factory: ShiftFlowFactory;
  readonly menu: MenuInputSource;
  /** The district every shift of the flow plays (`district.<name>`). */
  readonly district: string;
  /** The run seed: every shift of the flow, Try Again included, uses it. */
  readonly seed: number;
  /** Record each shift's input log (dev builds, for the dev panel's Save replay). */
  readonly recordInputs: boolean;
  /** A failed transition (a level or atlas that did not load). */
  readonly onError: (error: unknown) => void;
};

/** Drives intro → shift → tally → shift for one district and seed. */
export class ShiftFlow {
  private readonly options: ShiftFlowOptions;
  private level: Level | null = null;
  private current: ShiftScene | null = null;
  private tuning: Tuning = DEFAULT_TUNING;
  private readonly devHandle: DevShift;

  constructor(options: ShiftFlowOptions) {
    this.options = options;
    options.events.on(EV.ShiftEnd, () => this.shiftEnded());
    const flow = this;
    this.devHandle = {
      get worldView() {
        return flow.current?.worldView ?? null;
      },
      get district() {
        return flow.current?.district ?? null;
      },
      get inputLog() {
        return flow.current?.inputLog ?? null;
      },
      get tuningIsCommitted() {
        return flow.current?.tuningIsCommitted ?? tuningsEqual(flow.tuning, DEFAULT_TUNING);
      },
      get logMatchesCommittedTuning() {
        return flow.current?.logMatchesCommittedTuning ?? true;
      },
      get tuning() {
        return flow.tuning;
      },
      setTuning(tuning: Tuning): void {
        flow.current?.setTuning(tuning);
        flow.tuning = tuning;
      },
    };
  }

  /** The ShiftScene of the current (or last) run, or null before the first one starts. */
  get shift(): ShiftScene | null {
    return this.current;
  }

  /** The shift as the dev panel sees it: the current ShiftScene's log and tuning, across retries. */
  get devShift(): DevShift {
    return this.devHandle;
  }

  /** Boots the flow at the intro card. */
  startAtIntro(): Promise<void> {
    return this.go(this.introScene());
  }

  /** Boots the flow straight into a shift (the intro skipped: `?test=1&scene=district.<name>`). */
  startAtShift(): Promise<void> {
    return this.go(this.shiftScene());
  }

  private introScene(): Scene {
    const { factory, district, menu } = this.options;
    const level = this.level;
    return factory.intro({
      district,
      menu,
      ...(level === null ? {} : { level }),
      onStart: (loaded) => {
        this.level = loaded;
        this.transition(this.shiftScene());
      },
    });
  }

  private shiftScene(): ShiftScene {
    const { factory, recordInputs, menu } = this.options;
    const level = this.level;
    const scene = factory.shift({
      tuning: this.tuning,
      recordInputs,
      pauseInput: menu,
      onPause: (reason) => this.openPause(scene, reason),
      ...(level === null ? {} : { level }),
    });
    this.current = scene;
    return scene;
  }

  /** ShiftScene.requestPause accepted: push the overlay over `shift`. False (no pause) if it cannot be pushed now. */
  private openPause(shift: ShiftScene, reason: PauseReason): boolean {
    const { scenes, factory, menu, district, seed, onError } = this.options;
    if (scenes.busy || scenes.top !== shift) return false;
    const overlay = factory.pause({
      reason,
      menu,
      glyphs: DEFAULT_GLYPHS,
      onResume: () => {
        if (scenes.top === overlay) scenes.pop();
        shift.resume();
      },
      onRestart: () => {
        this.level = shift.level ?? this.level;
        this.transition(this.shiftScene());
      },
      onRetire: () => {
        this.level = shift.level ?? this.level;
        this.transition(this.introScene());
      },
    });
    scenes.push(overlay, { seed, district }).catch((error: unknown) => {
      shift.resume();
      onError(error);
    });
    return true;
  }

  /** EV.ShiftEnd: snapshot the ended World and bring up the tally. */
  private shiftEnded(): void {
    const shift = this.current;
    if (shift === null || this.options.scenes.top !== shift) return;
    const snapshot = shift.snapshot();
    if (snapshot === null) return;
    this.level = shift.level ?? this.level;
    const { factory, menu, district, seed } = this.options;
    const result: TallyResult = { district, seed, snapshot };
    this.transition(
      factory.tally({
        result,
        menu,
        onRetry: () => this.transition(this.shiftScene()),
        onBack: () => this.transition(this.introScene()),
      }),
    );
  }

  private transition(scene: Scene): void {
    this.go(scene).catch(this.options.onError);
  }

  private go(scene: Scene): Promise<void> {
    const { scenes, district, seed } = this.options;
    const params = { seed, district };
    return scenes.size === 0 ? scenes.push(scene, params) : scenes.replaceAll(scene, params);
  }
}
