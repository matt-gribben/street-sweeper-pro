// SSP-071: the shift flow (src/app/shiftFlow.ts) with the real ShiftIntroScene, ShiftScene and TallyScene over a
// SceneManager, the event bus and the keyboard + gamepad Actions, without WebGL: intro card → Space → a complete
// shift → EV.ShiftEnd → the numbers-only tally (matching the World's final SimSnapshot) → Try Again (same seed, the
// intro skipped, tick 0, no level fetch) → tally → Back to Briefing. Both menus answer the keyboard, the pad and
// (SSP-286) mouse clicks, mapped from client pixels through the real upscale transform of a 1920×1080 window.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Group } from 'three';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Assets } from '../../src/app/assetRegistry.ts';
import { EventBus, PAUSE_EV } from '../../src/app/events.ts';
import type { SceneContext } from '../../src/app/Game.ts';
import { SceneManager } from '../../src/app/SceneManager.ts';
import { ShiftFlow } from '../../src/app/shiftFlow.ts';
import { Actions, POINTER_PHASE } from '../../src/input/actions.ts';
import { GamepadDevice, PAD_BUTTON } from '../../src/input/gamepad.ts';
import { KeyboardDevice } from '../../src/input/keyboard.ts';
import { PointerDevice } from '../../src/input/pointer.ts';
import type { Renderer } from '../../src/render/Renderer.ts';
import { clientToInternalPx, computeViewportLayout, INTERNAL_HEIGHT_PX } from '../../src/render/upscale.ts';
import { PauseOverlay, PausePage } from '../../src/scenes/PauseOverlay.ts';
import { ShiftIntroScene } from '../../src/scenes/ShiftIntroScene.ts';
import { DEFAULT_DISTRICT, ShiftScene } from '../../src/scenes/ShiftScene.ts';
import { TALLY_INPUT_LOCK_TICKS, TallyScene } from '../../src/scenes/TallyScene.ts';
import { DT_S, SHIFT_TICKS } from '../../src/sim/constants.ts';
import { EV } from '../../src/sim/eventQueue.ts';
import { PRESSED } from '../../src/sim/inputFrame.ts';
import { runReplay } from '../../src/sim/replay.ts';
import { type SimSnapshot, snapshotWorld } from '../../src/sim/snapshot.ts';
import { DEFAULT_TUNING } from '../../src/sim/tuning.ts';
import { IntroStatus } from '../../src/ui/introCard.ts';
import { MENU_COMMAND } from '../../src/ui/menus.ts';
import { PauseEntry, pauseButtonRects } from '../../src/ui/pausePage.ts';
import { TallyButton, tallyButtonRects } from '../../src/ui/tallyPage.ts';
import { TutorialMemory } from '../../src/ui/tutorialMemory.ts';
import { checkoutAssets } from '../support/checkoutAssets.ts';
import { fakePad, keyEvent, padSource, setButton } from '../support/fakeInput.ts';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel: string): string => readFileSync(`${REPO_ROOT}${rel}`, 'utf8');

/** The asset registry BootScene would have loaded (SSP-284): every scene of the flow takes its atlases here. */
let assets: Assets;
beforeAll(async () => {
  assets = await checkoutAssets();
});

/** The browser wiring of main.ts without WebGL, ticked by hand. */
function harness(
  levelGate: Promise<void> = Promise.resolve(),
  recordInputs = false,
  tutorial: TutorialMemory | null = null,
) {
  const keyboard = new KeyboardDevice(DT_S);
  const pad = fakePad();
  const pads = padSource(pad);
  const pointer = new PointerDevice();
  const actions = new Actions([keyboard, new GamepadDevice(pads.source)], pointer);
  actions.beginFrame(); // the pad's first poll sets its edge baseline
  const layout = computeViewportLayout(1920, 1080, 1);
  const scenes = new SceneManager();
  const history: string[] = [];
  scenes.onEntered = (scene) => history.push(scene.id);
  const bus = new EventBus();
  const ends: number[] = [];
  bus.on(EV.ShiftEnd, (event) => ends.push(event.reason));
  let hiddenListeners: (() => void)[] = [];
  const ctx: SceneContext = {
    // The rig at the sweep height (the items batch takes its cull rect from it) and a no-op grime uploader.
    renderer: {
      rig: { snappedX: 0, snappedZ: 0, height: { value: 31.5, velocity: 0 }, internalWidth: 480 },
      webgl: { copyTextureToTexture: () => {} },
    } as unknown as Renderer,
    root: new Group(),
    ui: new Group(),
    events: bus,
    assets,
    pinCamera: () => {},
    followCamera: () => {},
    releaseCamera: () => {},
    clientToInternal: (x, y, out) => clientToInternalPx(layout, x, y, out),
    onHidden: (listener) => {
      hiddenListeners.push(listener);
      return () => {
        hiddenListeners = hiddenListeners.filter((l) => l !== listener);
      };
    },
  };
  /** `visibilitychange` → hidden, as Game.handleVisibility reports it. */
  const hide = (): void => {
    for (const listener of [...hiddenListeners]) listener();
  };
  const levelFetches: string[] = [];
  const levelSource = async (url: string): Promise<string> => {
    levelFetches.push(url);
    await levelGate;
    return read(`public/${url.replace(/^\//, '')}`);
  };
  const errors: unknown[] = [];
  const flow = new ShiftFlow({
    scenes,
    events: bus,
    factory: {
      intro: (options) => new ShiftIntroScene(ctx, { ...options, levelSource }),
      shift: (options) => new ShiftScene(ctx, { ...options, levelSource }),
      tally: (options) => new TallyScene(ctx, options),
      pause: (options) => new PauseOverlay(ctx, options),
    },
    menu: actions,
    district: DEFAULT_DISTRICT,
    seed: 7,
    recordInputs,
    onError: (error) => errors.push(error),
    tutorial,
  });
  /** One display frame: poll, `n` ticks (input → scenes → event drain), render. */
  const frame = (n = 1): void => {
    actions.beginFrame();
    for (let i = 0; i < n; i++) {
      scenes.fixedUpdate(actions.sampleForTick());
      scenes.drainEvents(bus);
    }
    scenes.render(0);
  };
  const tap = (code: string): void => {
    keyboard.handleKeyDown(keyEvent(code));
    keyboard.handleKeyUp(keyEvent(code));
  };
  const press = (button: number): void => {
    setButton(pad, button, true);
    actions.beginFrame();
    setButton(pad, button, false);
  };
  /** A mouse click (press and release) at internal pixel (x, y), sent in client pixels as the browser would. */
  const click = (x: number, y: number): void => {
    const event = {
      clientX: (layout.canvasDeviceLeft + (x + 0.5) * layout.scale) / layout.devicePixelRatio,
      clientY: (layout.canvasDeviceTop + (y + 0.5) * layout.scale) / layout.devicePixelRatio,
      button: 0,
      isPrimary: true,
    };
    pointer.handle(POINTER_PHASE.Down, event);
    pointer.handle(POINTER_PHASE.Up, event);
  };
  const topIs = async (id: string): Promise<void> => {
    await vi.waitFor(() => expect(scenes.top?.id).toBe(id), { timeout: 5000, interval: 2 });
  };
  /** Ticks the running shift until it has ended, then waits for the tally. */
  const finishShift = async (): Promise<{ shift: ShiftScene; tally: TallyScene; end: SimSnapshot }> => {
    const shift = scenes.top;
    if (!(shift instanceof ShiftScene)) throw new Error(`top is ${shift?.id}, not the shift`);
    let ticks = 0;
    while (!shift.ended) {
      frame(60);
      ticks += 60;
      if (ticks > SHIFT_TICKS + 1200) throw new Error('the shift never ended');
    }
    const end = shift.snapshot();
    if (end === null) throw new Error('no snapshot');
    await topIs('tally');
    const tally = scenes.top;
    if (!(tally instanceof TallyScene)) throw new Error('not the tally');
    expect(shift.snapshot()).toBeNull(); // the tally replaced it: it exited
    return { shift, tally, end };
  };
  return {
    keyboard,
    pad,
    actions,
    scenes,
    history,
    ends,
    flow,
    frame,
    tap,
    press,
    click,
    topIs,
    finishShift,
    levelFetches,
    errors,
    ctx,
    hide,
    hiddenListeners: () => hiddenListeners.length,
  };
}

describe('ShiftFlow', () => {
  it('runs intro → Space → a complete shift → tally → Try Again (same seed, intro skipped) → Back to Briefing', async () => {
    const h = harness();
    await h.flow.startAtIntro();
    expect(h.scenes.ids()).toEqual(['shift_intro']);
    const intro = h.scenes.top;
    if (!(intro instanceof ShiftIntroScene)) throw new Error('not the intro');
    // The card shows while the level loads (§6.3), then asks for Space.
    await vi.waitFor(() => expect(intro.status).toBe(IntroStatus.Ready));
    h.frame();
    expect(intro.text).toEqual([
      'PUDDLE LANE',
      'Clear the litter and the grime before knock-off, love.',
      'Press Space to start',
    ]);
    expect(h.ctx.ui.children).toHaveLength(1);
    expect(h.levelFetches).toEqual(['/assets/levels/puddle_lane.json']);

    // Any key but a menu select leaves the card up.
    h.tap('KeyA');
    h.tap('KeyW');
    h.frame(5);
    expect(intro.hasStarted).toBe(false);
    h.tap('Space');
    h.frame();
    expect(intro.hasStarted).toBe(true);
    await h.topIs('shift');
    const first = h.scenes.top as ShiftScene;
    // The intro released its UI batch: the UI pass holds only the shift's HUD (SSP-070).
    expect(h.ctx.ui.children).toEqual([first.uiBatch?.mesh]);
    expect(first.level).toBe(intro.level);
    expect(h.levelFetches).toHaveLength(1); // the shift took the preloaded level
    const start = first.snapshot();
    expect(start?.tick).toBe(0);
    expect(first.worldView?.seed).toBe(7);

    // Drive a little with the brush down, then let the timer run out.
    h.tap('Space');
    h.keyboard.handleKeyDown(keyEvent('KeyW'));
    h.frame(90);
    h.keyboard.handleKeyUp(keyEvent('KeyW'));
    const { tally, end } = await h.finishShift();
    expect(h.ends).toEqual([2]); // one EV.ShiftEnd, TIME_UP
    expect(end.grime.cleaned).toBeGreaterThan(0); // the brush went down and swept
    expect(end.shift).toMatchObject({ phase: 'ended', endReason: 'time_up' });
    expect(tally.snapshot()).toEqual(end);
    expect(tally.result).toEqual({ district: DEFAULT_DISTRICT, seed: 7, snapshot: end });
    h.frame();
    expect(tally.text).toEqual([
      'TIME UP!',
      'PUDDLE LANE',
      'TIDY',
      `${(Math.round(end.tidy * 1000) / 10).toFixed(1)}%`,
      'ITEMS COLLECTED',
      `${end.litter.collected} / ${end.litter.spawned}`,
      'GRIME CLEANED',
      `${end.grime.cleaned.toLocaleString('en-GB')} / ${end.grime.initial.toLocaleString('en-GB')}`,
      'SCORE',
      end.score.toLocaleString('en-GB'),
      'STARS',
      '★',
      '★',
      '★',
      'TRY AGAIN',
      'BACK TO BRIEFING',
    ]);
    expect(tally.focus).toBe(TallyButton.TryAgain);

    // Input is ignored for the first half second, then Enter picks Try Again.
    h.tap('Enter');
    h.frame(TALLY_INPUT_LOCK_TICKS);
    expect(tally.choice).toBeNull();
    h.tap('Enter');
    h.frame();
    expect(tally.choice).toBe(TallyButton.TryAgain);
    await h.topIs('shift');
    const second = h.scenes.top as ShiftScene;
    expect(second).not.toBe(first);
    expect(second.worldView?.seed).toBe(7);
    expect(second.snapshot()).toEqual(start); // the same seed's World, back at tick 0
    expect(h.levelFetches).toHaveLength(1);
    expect(h.history).toEqual(['shift_intro', 'shift', 'tally', 'shift']);

    // Second tally: S moves the focus down (and wraps), Space picks Back to Briefing.
    const again = await h.finishShift();
    expect(again.tally.snapshot().shift.endReason).toBe('time_up');
    h.frame(TALLY_INPUT_LOCK_TICKS);
    h.tap('KeyS');
    h.frame();
    expect(again.tally.focus).toBe(TallyButton.BackToBriefing);
    h.tap('KeyS');
    h.frame();
    expect(again.tally.focus).toBe(TallyButton.TryAgain);
    h.tap('ArrowUp');
    h.frame();
    expect(again.tally.focus).toBe(TallyButton.BackToBriefing);
    h.tap('Space');
    h.frame();
    await h.topIs('shift_intro');
    const back = h.scenes.top as ShiftIntroScene;
    expect(back).not.toBe(intro);
    expect(back.status).toBe(IntroStatus.Ready); // the flow kept the level: nothing to load
    expect(h.levelFetches).toHaveLength(1);
    expect(h.history).toEqual(['shift_intro', 'shift', 'tally', 'shift', 'tally', 'shift_intro']);
    expect(h.errors).toEqual([]);
  }, 60_000);

  it('answers the standard gamepad: Start on the card, D-pad and B on the tally', async () => {
    const h = harness();
    await h.flow.startAtIntro();
    const intro = h.scenes.top as ShiftIntroScene;
    await vi.waitFor(() => expect(intro.status).toBe(IntroStatus.Ready));
    h.press(PAD_BUTTON.START);
    h.frame();
    await h.topIs('shift');
    const { tally } = await h.finishShift();
    h.frame(TALLY_INPUT_LOCK_TICKS);
    h.press(PAD_BUTTON.DPAD_DOWN);
    h.frame();
    expect(tally.focus).toBe(TallyButton.BackToBriefing);
    h.press(PAD_BUTTON.DPAD_UP);
    h.frame();
    expect(tally.focus).toBe(TallyButton.TryAgain);
    h.press(PAD_BUTTON.EAST); // B: back
    h.frame();
    expect(tally.choice).toBe(TallyButton.BackToBriefing);
    await h.topIs('shift_intro');
    const card = h.scenes.top as ShiftIntroScene;
    h.press(PAD_BUTTON.SOUTH); // A: start
    h.frame();
    expect(card.hasStarted).toBe(true);
    await h.topIs('shift');
    expect(h.errors).toEqual([]);
  }, 60_000);

  it('answers the mouse (SSP-286): a click on the card starts, a click on a tally button picks it', async () => {
    const h = harness();
    await h.flow.startAtIntro();
    const intro = h.scenes.top as ShiftIntroScene;
    await vi.waitFor(() => expect(intro.status).toBe(IntroStatus.Ready));
    h.frame();
    h.click(5, 5); // the letterbox-free frame, but off the card: nothing
    h.frame();
    expect(intro.hasStarted).toBe(false);
    h.click(240, 135); // the middle of the card
    h.frame();
    expect(intro.hasStarted).toBe(true);
    await h.topIs('shift');
    const { tally } = await h.finishShift();
    const rects = tallyButtonRects(assets.font('kerbside5x7'), 480, INTERNAL_HEIGHT_PX);
    const back = rects[TallyButton.BackToBriefing];
    if (back === undefined) throw new Error('no rect');
    h.click(back.x + 10, back.y + 8); // during the 0.5 s lock: ignored
    h.frame();
    h.frame(TALLY_INPUT_LOCK_TICKS);
    expect(tally.choice).toBeNull();
    h.click(back.x + (back.w >> 1), back.y + (back.h >> 1));
    h.frame();
    expect(tally.choice).toBe(TallyButton.BackToBriefing);
    await h.topIs('shift_intro');
    expect(h.history).toEqual(['shift_intro', 'shift', 'tally', 'shift_intro']);
    expect(h.errors).toEqual([]);
  }, 60_000);

  it("names the active device's select control on the card: Space, then A once the pad is used", async () => {
    const h = harness();
    await h.flow.startAtIntro();
    const intro = h.scenes.top as ShiftIntroScene;
    await vi.waitFor(() => expect(intro.status).toBe(IntroStatus.Ready));
    h.frame();
    expect(intro.text[2]).toBe('Press Space to start');
    h.press(PAD_BUTTON.DPAD_DOWN); // pad input that does not start the shift
    h.frame();
    expect(intro.text[2]).toBe('Press A to start');
    h.keyboard.handleKeyDown(keyEvent('KeyH'));
    h.frame();
    expect(intro.text[2]).toBe('Press Space to start');
    expect(intro.hasStarted).toBe(false);
  });

  it('starts when Space was pressed before the level had loaded', async () => {
    let release = (): void => {};
    const h = harness(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    await h.flow.startAtIntro();
    const intro = h.scenes.top as ShiftIntroScene;
    expect(intro.status).toBe(IntroStatus.Loading);
    h.frame();
    expect(intro.text[2]).toBe('Loading...');
    h.tap('Space');
    h.frame();
    expect(intro.hasStarted).toBe(false);
    release();
    await h.topIs('shift');
    expect(intro.hasStarted).toBe(true);
  });

  it('drops menu presses made before a menu scene showed', async () => {
    const h = harness();
    h.tap('Space'); // pressed during boot
    await h.flow.startAtIntro();
    const intro = h.scenes.top as ShiftIntroScene;
    await vi.waitFor(() => expect(intro.status).toBe(IntroStatus.Ready));
    h.frame(10);
    expect(intro.hasStarted).toBe(false);
  });

  it('boots straight into a shift with the intro skipped, and still ends on the tally', async () => {
    const h = harness();
    await h.flow.startAtShift();
    expect(h.scenes.ids()).toEqual(['shift']);
    await h.finishShift();
    h.frame(TALLY_INPUT_LOCK_TICKS + 1);
    h.tap('Enter');
    h.frame();
    await h.topIs('shift');
    expect(h.levelFetches).toHaveLength(1); // Try Again reuses the level the shift loaded
    expect(h.history).toEqual(['shift', 'tally', 'shift']);
  }, 60_000);

  it("carries the dev panel's tuning edits into the next shift", async () => {
    const h = harness();
    await h.flow.startAtShift();
    const dev = h.flow.devShift;
    expect(dev.tuningIsCommitted).toBe(true);
    expect(dev.district).toBe(DEFAULT_DISTRICT);
    const sweeper = dev.tuning.vehicle.sweeper;
    const edited = {
      ...dev.tuning,
      vehicle: {
        ...dev.tuning.vehicle,
        sweeper: { ...sweeper, drive: { ...sweeper.drive, topSpeedTransitMps: 9 } },
      },
    };
    dev.setTuning(edited);
    expect(h.flow.shift?.tuning).toBe(edited);
    expect(dev.tuningIsCommitted).toBe(false);
    await h.finishShift();
    h.frame(TALLY_INPUT_LOCK_TICKS + 1);
    h.tap('Enter');
    h.frame();
    await h.topIs('shift');
    expect(h.flow.shift?.tuning).toBe(edited);
    expect(dev.worldView?.tick).toBe(0);
  }, 60_000);
});

describe('the tutorial in the shift flow (SSP-290)', () => {
  it('hands every shift the same TutorialMemory: a beat learned before Restart Shift stays learned', async () => {
    const memory = new TutorialMemory();
    const h = harness(Promise.resolve(), false, memory);
    await h.flow.startAtShift();
    const first = h.scenes.top as ShiftScene;
    expect(first.tutorialState()).toMatchObject({ current: { n: 1 }, fired: [1] });
    // W and D: throttle and steering used, so beat 1 (drive) is learned and dismissed.
    h.keyboard.handleKeyDown(keyEvent('KeyW'));
    h.keyboard.handleKeyDown(keyEvent('KeyD'));
    h.frame(20);
    h.keyboard.handleKeyUp(keyEvent('KeyW'));
    h.keyboard.handleKeyUp(keyEvent('KeyD'));
    expect(memory.learned()).toContain('drive');
    expect(first.tutorialState()?.current?.n).not.toBe(1);
    h.tap('KeyP');
    h.frame();
    await h.topIs('pause');
    h.tap('KeyS');
    h.frame();
    h.tap('Enter');
    h.frame();
    await vi.waitFor(() => expect(h.scenes.ids()).toEqual(['shift']));
    const fresh = h.scenes.top as ShiftScene;
    expect(fresh).not.toBe(first);
    expect(fresh.tutorialState()).toMatchObject({ current: null, fired: [] });
  });

  it('runs no tutorial without a memory (`?test=1&tips=0`)', async () => {
    const h = harness();
    await h.flow.startAtShift();
    expect((h.scenes.top as ShiftScene).tutorial).toBeNull();
  });
});

describe('PauseOverlay in the shift flow (SSP-287)', () => {
  /** A running shift (the intro skipped) with the pause events recorded. */
  async function running(recordInputs = false) {
    const h = harness(Promise.resolve(), recordInputs);
    const pauses: string[] = [];
    h.ctx.events.onPause(PAUSE_EV.PauseOpened, (e) => pauses.push(`opened:${e.reason}`));
    h.ctx.events.onPause(PAUSE_EV.PauseClosed, (e) => pauses.push(`closed:${e.exit}`));
    await h.flow.startAtShift();
    const shift = h.scenes.top;
    if (!(shift instanceof ShiftScene)) throw new Error('not the shift');
    return { ...h, shift, pauses };
  }

  type Running = Awaited<ReturnType<typeof running>>;

  /** The overlay once it has joined the stack. */
  async function overlayOf(h: Running): Promise<PauseOverlay> {
    await h.topIs('pause');
    const top = h.scenes.top;
    if (!(top instanceof PauseOverlay)) throw new Error('not the overlay');
    return top;
  }

  const dim = (h: Running): boolean => h.ctx.renderer.dim === true;

  it('P opens the overlay over the frozen shift and closes it; the World resumes from the same tick', async () => {
    const h = await running();
    h.keyboard.handleKeyDown(keyEvent('KeyW'));
    h.frame(60);
    const before = h.shift.snapshot();
    expect(before?.tick).toBe(60);
    h.tap('KeyP');
    h.frame();
    expect(h.shift.paused).toBe(true);
    const overlay = await overlayOf(h);
    expect(h.scenes.ids()).toEqual(['shift', 'pause']);
    expect(overlay.blocksUpdateBelow).toBe(true);
    expect(overlay.reason).toBe('player');
    expect(dim(h)).toBe(true);
    expect(h.pauses).toEqual(['opened:player']);
    // The overlay's UI batch draws over the HUD's.
    const meshes = h.ctx.ui.children;
    expect(meshes).toHaveLength(2);
    expect(meshes[1]?.renderOrder).toBeGreaterThan(meshes[0]?.renderOrder ?? 0);
    // 120 frames, W still held: nothing in the World moves.
    for (let i = 0; i < 120; i++) h.frame();
    expect(h.shift.snapshot()).toEqual(before);
    expect(h.shift.snapshot()?.shift.ticksRemaining).toBe(before?.shift.ticksRemaining);
    expect(overlay.text).toEqual(['PAUSED', 'RESUME', 'RESTART SHIFT', 'CONTROLS', 'RETIRE']);
    h.tap('KeyP');
    h.frame();
    expect(overlay.choice).toBe('resume');
    expect(h.scenes.ids()).toEqual(['shift']);
    expect(h.shift.paused).toBe(false);
    expect(dim(h)).toBe(false);
    expect(h.pauses).toEqual(['opened:player', 'closed:resume']);
    expect(h.ctx.ui.children).toHaveLength(1);
    h.frame();
    expect(h.shift.snapshot()?.tick).toBe(61);
    h.keyboard.handleKeyUp(keyEvent('KeyW'));
    expect(h.errors).toEqual([]);
  });

  it('the pad Start button (index 9) opens and closes the overlay', async () => {
    const h = await running();
    h.frame(10);
    expect(PAD_BUTTON.START).toBe(9);
    h.press(PAD_BUTTON.START);
    h.frame();
    const overlay = await overlayOf(h);
    h.frame(30);
    expect(h.shift.snapshot()?.tick).toBe(10);
    h.press(PAD_BUTTON.DPAD_DOWN);
    h.frame();
    expect(overlay.menu.focus).toBe(PauseEntry.RestartShift);
    // Start is also a menu select: it must resume, never pick the focused entry.
    h.press(PAD_BUTTON.START);
    h.frame();
    expect(overlay.choice).toBe('resume');
    expect(h.scenes.ids()).toEqual(['shift']);
    h.frame(5);
    expect(h.shift.snapshot()?.tick).toBe(15);
    expect(h.history).toEqual(['shift', 'pause']);
  });

  it('Esc pauses and Esc resumes; pad B (back) resumes too', async () => {
    const h = await running();
    h.frame(3);
    h.tap('Escape');
    h.frame();
    const overlay = await overlayOf(h);
    h.frame(2);
    h.tap('Escape');
    h.frame();
    expect(overlay.choice).toBe('resume');
    expect(h.scenes.ids()).toEqual(['shift']);
    h.tap('Escape');
    h.frame();
    const again = await overlayOf(h);
    expect(again).not.toBe(overlay);
    h.frame();
    h.press(PAD_BUTTON.EAST);
    h.frame();
    expect(again.choice).toBe('resume');
    expect(h.shift.snapshot()?.tick).toBe(3);
    expect(h.pauses).toEqual(['opened:player', 'closed:resume', 'opened:player', 'closed:resume']);
  });

  it('the PAUSE edge never reaches the World: the recorded input log replays the paused run exactly', async () => {
    const h = await running(true);
    const log = h.shift.inputLog;
    if (log === null) throw new Error('no log');
    h.tap('Space'); // brush down
    h.keyboard.handleKeyDown(keyEvent('KeyW'));
    h.frame(40);
    h.tap('KeyP');
    h.frame(5);
    await overlayOf(h);
    h.frame(50);
    h.tap('KeyP');
    h.frame(30);
    h.keyboard.handleKeyUp(keyEvent('KeyW'));
    h.tap('KeyH');
    h.frame();
    h.press(PAD_BUTTON.START);
    h.frame();
    await overlayOf(h);
    h.frame(20);
    h.press(PAD_BUTTON.START);
    h.frame(30);
    const world = h.shift.worldView;
    if (world === null) throw new Error('no world');
    // Only the ticks the World stepped are logged (40 + 29 + 1 + 29: each resume tick is the overlay's), and no frame
    // carries a scene-layer bit.
    expect(world.tick).toBe(99);
    expect(log.length).toBe(99);
    let pressedAny = 0;
    for (let t = 0; t < log.length; t++) {
      const pressed = log.pressed[t] ?? 0;
      expect(pressed & ~(PRESSED.BRUSH | PRESSED.HORN)).toBe(0);
      pressedAny |= pressed;
    }
    expect(pressedAny).toBe(PRESSED.BRUSH | PRESSED.HORN);
    const level = h.shift.level;
    if (level === null) throw new Error('no level');
    const replayed = runReplay(level, DEFAULT_TUNING, 7, log, log.length);
    expect(snapshotWorld(replayed.world)).toEqual(h.shift.snapshot());
  });

  it('Restart Shift restarts the same seed at tick 0 with the intro skipped', async () => {
    const h = await running();
    h.keyboard.handleKeyDown(keyEvent('KeyW'));
    h.frame(30);
    h.keyboard.handleKeyUp(keyEvent('KeyW'));
    const start = harness();
    await start.flow.startAtShift();
    const startState = (start.scenes.top as ShiftScene).snapshot();
    h.tap('KeyP');
    h.frame();
    const overlay = await overlayOf(h);
    h.tap('KeyS');
    h.frame();
    expect(overlay.menu.focus).toBe(PauseEntry.RestartShift);
    h.tap('Enter');
    h.frame();
    expect(overlay.choice).toBe('restart');
    await vi.waitFor(() => expect(h.scenes.ids()).toEqual(['shift']));
    const fresh = h.scenes.top as ShiftScene;
    expect(fresh).not.toBe(h.shift);
    expect(fresh.snapshot()?.tick).toBe(0);
    expect(fresh.snapshot()).toEqual(startState);
    expect(fresh.worldView?.seed).toBe(7);
    expect(fresh.paused).toBe(false);
    expect(h.shift.snapshot()).toBeNull(); // the old shift exited
    expect(h.history).toEqual(['shift', 'pause', 'shift']);
    expect(h.levelFetches).toHaveLength(1); // the level was kept
    expect(dim(h)).toBe(false);
    expect(h.pauses).toEqual(['opened:player', 'closed:restart']);
    expect(h.ctx.ui.children).toEqual([fresh.uiBatch?.mesh]);
    h.frame(5);
    expect(fresh.snapshot()?.tick).toBe(5);
    expect(h.hiddenListeners()).toBe(1); // only the fresh shift listens for visibilitychange
  });

  it('Retire (a mouse click) returns to the intro card, the Week Map stand-in', async () => {
    const h = await running();
    h.tap('Escape');
    h.frame();
    const overlay = await overlayOf(h);
    const rects = pauseButtonRects(assets.font('kerbside5x7'), 480, INTERNAL_HEIGHT_PX, overlay.conditions);
    const retire = rects[PauseEntry.Retire];
    if (retire === null || retire === undefined) throw new Error('no Retire rect');
    h.frame();
    h.click(retire.x + (retire.w >> 1), retire.y + (retire.h >> 1));
    h.frame();
    expect(overlay.choice).toBe('retire');
    await h.topIs('shift_intro');
    expect(h.scenes.ids()).toEqual(['shift_intro']);
    expect(h.history).toEqual(['shift', 'pause', 'shift_intro']);
    expect(h.pauses).toEqual(['opened:player', 'closed:retire']);
    expect(dim(h)).toBe(false);
    expect(h.hiddenListeners()).toBe(0);
  });

  it('visibilitychange → hidden opens the overlay, which stays open until the player resumes', async () => {
    const h = await running();
    h.frame(12);
    h.hide();
    expect(h.shift.paused).toBe(true);
    const overlay = await overlayOf(h);
    expect(overlay.reason).toBe('hidden');
    h.hide(); // hidden again while paused: nothing new
    h.frame(60);
    expect(h.scenes.ids()).toEqual(['shift', 'pause']);
    expect(h.shift.snapshot()?.tick).toBe(12);
    h.tap('Enter'); // Resume is the default focus
    h.frame();
    expect(overlay.choice).toBe('resume');
    h.frame();
    expect(h.shift.snapshot()?.tick).toBe(13);
    expect(h.pauses).toEqual(['opened:hidden', 'closed:resume']);
  });

  it('refuses a pause once the shift has ended, and the tally ignores the Pause key', async () => {
    const h = await running();
    const { shift } = await h.finishShift();
    expect(shift.requestPause('player')).toBe(false);
    h.hide();
    h.tap('KeyP');
    h.frame(5);
    expect(h.scenes.ids()).toEqual(['tally']);
    expect(h.pauses).toEqual([]);
  }, 60_000);

  it('the Controls page lists the bindings for the active device; Back returns, Pause resumes', async () => {
    const h = await running();
    h.tap('KeyP');
    h.frame();
    const overlay = await overlayOf(h);
    h.tap('KeyS');
    h.frame();
    h.tap('KeyS');
    h.frame();
    expect(overlay.menu.focus).toBe(PauseEntry.Controls); // Settings is hidden: skipped
    h.tap('Space');
    h.frame();
    expect(overlay.page).toBe(PausePage.Controls);
    h.frame();
    expect(overlay.text).toContain('KEYBOARD');
    expect(overlay.text).toContain('Left Shift');
    h.press(PAD_BUTTON.DPAD_DOWN); // the pad is now the active device
    h.frame();
    expect(overlay.text).toContain('GAMEPAD');
    expect(overlay.text).toContain('Start');
    h.tap('Escape'); // Esc is Back here: to the main page, not out of the pause
    h.frame();
    expect(overlay.page).toBe(PausePage.Main);
    expect(overlay.choice).toBeNull();
    expect(overlay.menu.focus).toBe(PauseEntry.Controls);
    h.tap('Enter');
    h.frame();
    expect(overlay.page).toBe(PausePage.Controls);
    h.tap('KeyP'); // the Pause key resumes from any page
    h.frame();
    expect(overlay.choice).toBe('resume');
    expect(h.scenes.ids()).toEqual(['shift']);
  });

  it('hidden entries (Settings, Finish Sweep) are not shown and never take the focus', async () => {
    const h = await running();
    h.tap('KeyP');
    h.frame();
    const overlay = await overlayOf(h);
    const menu = overlay.menu;
    expect(menu.isVisible(PauseEntry.Settings)).toBe(false);
    expect(menu.isVisible(PauseEntry.FinishSweep)).toBe(false);
    const seen = new Set<number>([menu.focus]);
    for (let i = 0; i < 12; i++) {
      menu.command(MENU_COMMAND.Down);
      seen.add(menu.focus);
    }
    for (let i = 0; i < 12; i++) {
      menu.command(MENU_COMMAND.Up);
      seen.add(menu.focus);
    }
    expect([...seen].sort()).toEqual([
      PauseEntry.Resume,
      PauseEntry.RestartShift,
      PauseEntry.Controls,
      PauseEntry.Retire,
    ]);
    expect(overlay.text).not.toContain('SETTINGS');
    expect(overlay.text).not.toContain('FINISH SWEEP');
  });
});
