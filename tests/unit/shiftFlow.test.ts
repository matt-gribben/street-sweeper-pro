// SSP-071: the shift flow (src/app/shiftFlow.ts) with the real ShiftIntroScene, ShiftScene and TallyScene over a
// SceneManager, the event bus and the keyboard + gamepad Actions, without WebGL: intro card → Space → a complete
// shift → EV.ShiftEnd → the numbers-only tally (matching the World's final SimSnapshot) → Try Again (same seed, the
// intro skipped, tick 0, no level fetch) → tally → Back to Briefing. Both menus answer the keyboard and the pad.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Group } from 'three';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Assets } from '../../src/app/assetRegistry.ts';
import { EventBus } from '../../src/app/events.ts';
import type { SceneContext } from '../../src/app/Game.ts';
import { SceneManager } from '../../src/app/SceneManager.ts';
import { ShiftFlow } from '../../src/app/shiftFlow.ts';
import { Actions } from '../../src/input/actions.ts';
import { GamepadDevice, PAD_BUTTON } from '../../src/input/gamepad.ts';
import { KeyboardDevice } from '../../src/input/keyboard.ts';
import type { Renderer } from '../../src/render/Renderer.ts';
import { ShiftIntroScene } from '../../src/scenes/ShiftIntroScene.ts';
import { DEFAULT_DISTRICT, ShiftScene } from '../../src/scenes/ShiftScene.ts';
import { TALLY_INPUT_LOCK_TICKS, TallyScene } from '../../src/scenes/TallyScene.ts';
import { DT_S, SHIFT_TICKS } from '../../src/sim/constants.ts';
import { EV } from '../../src/sim/eventQueue.ts';
import type { SimSnapshot } from '../../src/sim/snapshot.ts';
import { IntroStatus } from '../../src/ui/introCard.ts';
import { TallyButton } from '../../src/ui/tallyPage.ts';
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
function harness(levelGate: Promise<void> = Promise.resolve()) {
  const keyboard = new KeyboardDevice(DT_S);
  const pad = fakePad();
  const pads = padSource(pad);
  const actions = new Actions([keyboard, new GamepadDevice(pads.source)]);
  actions.beginFrame(); // the pad's first poll sets its edge baseline
  const scenes = new SceneManager();
  const history: string[] = [];
  scenes.onEntered = (scene) => history.push(scene.id);
  const bus = new EventBus();
  const ends: number[] = [];
  bus.on(EV.ShiftEnd, (event) => ends.push(event.reason));
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
    },
    menu: actions,
    district: DEFAULT_DISTRICT,
    seed: 7,
    recordInputs: false,
    onError: (error) => errors.push(error),
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
    topIs,
    finishShift,
    levelFetches,
    errors,
    ctx,
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
