// SSP-046: the drive-only ShiftScene, driven without WebGL. It loads compiled Puddle Lane and the world and actors
// atlases, creates a seeded World with Bessie at the depot start facing north, steps it once per loop tick from
// real input devices (keyboard and gamepad through src/input/actions.ts), draws the interpolated pose and points
// the follow camera at it, records the input log in dev builds, and binds `__ssp.step(n)` / `__ssp.state()` to
// the World (exactly n ticks, exactly one render, JSON-safe SimSnapshot).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Group } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import type { SceneContext } from '../../src/app/Game.ts';
import { createLoop, type LoopClock } from '../../src/app/loop.ts';
import { SCENE_IDS, SceneManager } from '../../src/app/SceneManager.ts';
import {
  installTestHooks,
  isShiftTestState,
  type SspTestApi,
  type TestHookTarget,
} from '../../src/debug/testHooks.ts';
import { Actions } from '../../src/input/actions.ts';
import { GamepadDevice } from '../../src/input/gamepad.ts';
import { KeyboardDevice } from '../../src/input/keyboard.ts';
import type { Renderer } from '../../src/render/Renderer.ts';
import { type AtlasName, loadAtlas, type RgbaImage } from '../../src/render/spriteAtlas.ts';
import {
  DEFAULT_DISTRICT,
  districtLevelName,
  ShiftScene,
  type ShiftSceneOptions,
} from '../../src/scenes/ShiftScene.ts';
import { DEG_TO_RAD, DT_S, SHIFT_TICKS } from '../../src/sim/constants.ts';
import { createInputFrame, PRESSED } from '../../src/sim/inputFrame.ts';
import { decodeLevel, type Level } from '../../src/sim/map.ts';
import { readInput } from '../../src/sim/replay.ts';
import { DEFAULT_TUNING, loadTuning, type Tuning, tuningSourceCopy } from '../../src/sim/tuning.ts';
import { fakePad, keyEvent, padSource, setTrigger } from '../support/fakeInput.ts';
import { decodePng } from '../support/png.ts';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel: string): string => readFileSync(`${REPO_ROOT}${rel}`, 'utf8');
const LEVEL_JSON = read('public/assets/levels/puddle_lane.json');

/** Serves compiled levels from the checkout (`/assets/levels/<name>.json` under base `/`). */
const checkoutLevels = async (url: string): Promise<string> => read(`public/${url.replace(/^\//, '')}`);

const atlasFiles = new Map<AtlasName, { json: unknown; image: RgbaImage }>();

beforeAll(() => {
  for (const name of ['world', 'actors'] as const) {
    atlasFiles.set(name, {
      json: JSON.parse(read(`public/assets/atlas/${name}.json`)),
      image: decodePng(readFileSync(`${REPO_ROOT}public/assets/atlas/${name}.png`)),
    });
  }
});

let level: Level;
beforeAll(() => {
  level = decodeLevel(LEVEL_JSON);
});

/** A SceneContext over a fake renderer: records follow-camera calls and moves the rig's snapped y with them. */
function context() {
  const follows: [x: number, y: number, speed: number][] = [];
  const loaded: AtlasName[] = [];
  const rig = { snappedZ: 0 };
  let released = 0;
  const ctx: SceneContext = {
    renderer: { rig } as unknown as Renderer,
    root: new Group(),
    loadAtlas: async (name) => {
      loaded.push(name);
      const files = atlasFiles.get(name);
      if (files === undefined) throw new Error(`test serves no '${name}' atlas`);
      return loadAtlas(name, { fetchJson: async () => files.json, fetchImage: async () => files.image });
    },
    pinCamera: () => {
      throw new Error('ShiftScene never pins the camera');
    },
    followCamera: (x, y, speed) => {
      follows.push([x, y, speed]);
      rig.snappedZ = y;
    },
    releaseCamera: () => {
      released += 1;
    },
  };
  return { ctx, follows, loaded, released: () => released };
}

function scene(options: ShiftSceneOptions = {}) {
  const c = context();
  return { ...c, scene: new ShiftScene(c.ctx, { levelSource: checkoutLevels, ...options }) };
}

/** A fake rAF clock (as in loop.test.ts). */
function fakeClock(): LoopClock & { runFrame(nowMs: number): void } {
  let pending: ((nowMs: number) => void) | null = null;
  let now = 0;
  return {
    now: () => now,
    requestFrame(callback) {
      pending = callback;
      return 1;
    },
    cancelFrame() {
      pending = null;
    },
    runFrame(nowMs: number) {
      const callback = pending;
      if (callback === null) throw new Error('no frame requested');
      pending = null;
      now = nowMs;
      callback(nowMs);
    },
  };
}

/**
 * The browser wiring of main.ts and Game.ts without WebGL: keyboard + gamepad through Actions, the fixed-step
 * loop in test mode (1/60 s frames, frozen until ready), the SceneManager, and the `__ssp` hooks bound like
 * main.ts binds them. `renders` counts frames drawn (Renderer.renderCount).
 */
async function browserLike(search: string, options: ShiftSceneOptions = {}) {
  const keyboard = new KeyboardDevice(DT_S);
  const pads = padSource(null);
  const actions = new Actions([keyboard, new GamepadDevice(pads.source)]);
  const scenes = new SceneManager();
  const clock = fakeClock();
  let renders = 0;
  const loop = createLoop(
    {
      beginFrame: () => actions.beginFrame(),
      sampleForTick: () => actions.sampleForTick(),
      fixedUpdate: (frame) => scenes.fixedUpdate(frame),
      drainEvents: () => {},
      render: (alpha) => {
        scenes.render(alpha);
        renders += 1;
      },
    },
    { clock, fixedFrameS: DT_S, frozen: true },
  );
  const s = scene(options);
  const target: TestHookTarget = {};
  const hooks = installTestHooks(target, search, {
    tick: () => loop.ticks,
    snapshot: () => s.scene.snapshot(),
    advance: (n) => loop.runTicks(n),
    render: () => loop.renderNow(),
    readFrame: () => new Uint8Array(4),
    pinCamera: () => {},
    camera: () => ({ x: 0, y: 0, h: 31.5, pinned: false }),
    drawCalls: () => 6,
    renders: () => renders,
  });
  if (hooks === null) throw new Error('hooks not installed');
  loop.start();
  await scenes.push(s.scene, {
    seed: hooks.params.seed ?? 0,
    district: hooks.params.scene ?? DEFAULT_DISTRICT,
  });
  // main.ts: advance `tick=<n>`, report ready, then apply `freeze`.
  hooks.api.step(hooks.params.tick);
  hooks.markReady();
  loop.setFrozen(hooks.params.freeze);
  const api = target.__ssp as SspTestApi;
  let nowMs = 0;
  return {
    ...s,
    api,
    loop,
    keyboard,
    pads,
    renders: () => renders,
    /** Runs `n` display frames of 1/60 s (one tick each unless frozen). */
    frames(n: number): void {
      for (let i = 0; i < n; i++) {
        nowMs += 1000 / 60;
        clock.runFrame(nowMs);
      }
    },
  };
}

describe('ShiftScene', () => {
  it("is the 'shift' scene", () => {
    expect(SCENE_IDS).toContain('shift');
    expect(scene().scene.id).toBe('shift');
    expect(districtLevelName('district.puddle_lane')).toBe('puddle_lane');
    expect(() => districtLevelName('puddle_lane')).toThrow(/not a district ID/);
  });

  it('loads Puddle Lane, puts Bessie at the depot start facing north and points the camera at her', async () => {
    const { scene: shift, ctx, follows, loaded } = scene();
    expect(shift.snapshot()).toBeNull();
    expect(shift.simEvents).toBeNull();
    await shift.enter({ seed: 1, district: 'district.puddle_lane' });
    expect(loaded.sort()).toEqual(['actors', 'world']);
    expect(shift.district).toBe('district.puddle_lane');
    const world = shift.worldView;
    if (world === null) throw new Error('no world');
    expect(world.seed).toBe(1);
    expect(world.level.id).toBe('district.puddle_lane');
    expect(shift.simEvents).toBe(world.events);
    // The depot start: the level's player start, heading 0 = north.
    expect(level.player.heading).toBe(0);
    expect(shift.snapshot()).toEqual({
      tick: 0,
      bessie: { x: level.player.x, y: level.player.y, heading: 0, speed: 0 },
      hp: 100,
    });
    expect(ctx.root.children.map((g) => g.name)).toEqual(['levelCity', 'bessieSprite']);
    expect(follows).toEqual([[level.player.x, level.player.y, 0]]);
    expect(shift.inputLog).toBeNull();

    shift.render(0);
    expect(shift.bessieSprite?.bodyFrame).toBe('veh.sweeper:body:h00:0');
    expect(shift.bessieSprite?.brushFrame).toBeNull();
    expect(shift.renderCount).toBe(1);
  });

  it('steps the World once per fixedUpdate and draws the pose lerped by alpha', async () => {
    const { scene: shift, follows } = scene();
    await shift.enter({ seed: 1, district: DEFAULT_DISTRICT });
    const input = createInputFrame();
    input.throttle = 255;
    for (let i = 0; i < 60; i++) shift.fixedUpdate(input);
    const v = shift.worldView?.vehicle;
    if (v === undefined) throw new Error('no world');
    expect(shift.snapshot()?.tick).toBe(60);
    expect(v.yM).toBeLessThan(v.prevYM);
    for (const alpha of [0, 0.25, 0.5, 1]) {
      shift.render(alpha);
      const [x, y] = follows[follows.length - 1] ?? [Number.NaN, Number.NaN];
      expect(x).toBeCloseTo(v.prevXM + (v.xM - v.prevXM) * alpha, 12);
      expect(y).toBeCloseTo(v.prevYM + (v.yM - v.prevYM) * alpha, 12);
    }
  });

  it('draws the brush overlay once the brush is down', async () => {
    const { scene: shift } = scene();
    await shift.enter({ seed: 1, district: DEFAULT_DISTRICT });
    const input = createInputFrame();
    input.pressed = PRESSED.BRUSH;
    shift.fixedUpdate(input);
    shift.render(1);
    expect(shift.worldView?.vehicle.brushDown).toBe(true);
    expect(shift.bessieSprite?.brushFrame).toBe('veh.sweeper_brush:brush:h00:0');
    expect(shift.bessieSprite?.sprites.count).toBe(2);
  });

  it('draws the dented body while hp is below health.dentedBelowHp', async () => {
    const sweeper = DEFAULT_TUNING.vehicle.sweeper;
    // A Bessie that starts at 30 HP: maxHp sets the starting hp (createVehicleState).
    const tuning: Tuning = {
      ...DEFAULT_TUNING,
      vehicle: {
        ...DEFAULT_TUNING.vehicle,
        sweeper: { ...sweeper, health: { maxHp: 30, dentedBelowHp: 40 } },
      },
    };
    const { scene: shift } = scene({ tuning });
    await shift.enter({ seed: 1, district: DEFAULT_DISTRICT });
    shift.render(0);
    expect(shift.snapshot()?.hp).toBe(30);
    expect(shift.bessieSprite?.bodyFrame).toBe('veh.sweeper:dented:h00:0');
  });

  it('records the input log through the replay hook when asked, and stops at a full shift', async () => {
    const { scene: shift } = scene({ recordInputs: true });
    await shift.enter({ seed: 1, district: DEFAULT_DISTRICT });
    const log = shift.inputLog;
    if (log === null) throw new Error('no log');
    const input = createInputFrame();
    input.throttle = 128;
    input.steer = -40;
    for (let i = 0; i < 10; i++) shift.fixedUpdate(input);
    expect(log.length).toBe(10);
    const out = createInputFrame();
    readInput(log, 9, out);
    expect(out).toEqual({ ...createInputFrame(), throttle: 128, steer: -40 });
    input.throttle = 0;
    input.steer = 0;
    for (let i = 10; i < SHIFT_TICKS + 30; i++) shift.fixedUpdate(input);
    expect(log.length).toBe(SHIFT_TICKS);
    expect(shift.snapshot()?.tick).toBe(SHIFT_TICKS + 30);
  });

  it('releases the world pass, the camera and the World on exit', async () => {
    const { scene: shift, ctx, released } = scene({ recordInputs: true });
    await shift.enter({ seed: 1, district: DEFAULT_DISTRICT });
    shift.exit();
    expect(ctx.root.children).toEqual([]);
    expect(released()).toBe(1);
    expect(shift.snapshot()).toBeNull();
    expect(shift.worldView).toBeNull();
    expect(shift.simEvents).toBeNull();
    // A frame or tick after exit is a no-op.
    shift.fixedUpdate(createInputFrame());
    shift.render(0.5);
  });

  it('refuses to enter without a district, with a malformed one, or when the file holds another district', async () => {
    const a = scene();
    await expect(a.scene.enter({ seed: 1 })).rejects.toThrow(/without a district/);
    await expect(a.scene.enter({ seed: 1, district: 'puddle_lane' })).rejects.toThrow(/not a district ID/);
    const b = context();
    const wrong = new ShiftScene(b.ctx, { levelSource: async () => LEVEL_JSON });
    await expect(wrong.enter({ seed: 1, district: 'district.kebab_mile' })).rejects.toThrow(
      /kebab_mile\.json holds 'district\.puddle_lane'/,
    );
    expect(b.ctx.root.children).toEqual([]);
    expect(b.follows).toEqual([]);
  });
});

/** tuning.json with vehicle.sweeper.<group>.<key> set to `value`, validated (as the dev panel builds it). */
function tuned(group: 'drive' | 'steering', key: string, value: number): Tuning {
  const raw = tuningSourceCopy() as { vehicle: { sweeper: Record<string, Record<string, number>> } };
  const values = raw.vehicle.sweeper[group];
  if (values === undefined || !(key in values)) throw new Error(`no ${group}.${key}`);
  values[key] = value;
  return loadTuning(raw);
}

describe('ShiftScene live tuning (SSP-048 dev panel)', () => {
  it('changes top speed and max steer between ticks, without re-entering', async () => {
    const { scene: shift } = scene();
    await shift.enter({ seed: 1, district: DEFAULT_DISTRICT });
    const v = shift.worldView?.vehicle;
    if (v === undefined) throw new Error('no world');
    const input = createInputFrame();
    // Brush down (6.0 m/s cap by default), lowered to 4.0 m/s before the drive north up Mangle Street.
    input.pressed = PRESSED.BRUSH;
    shift.fixedUpdate(input);
    input.pressed = 0;
    shift.setTuning(tuned('drive', 'topSpeedBrushDownMps', 4));
    input.throttle = 255;
    let top = 0;
    for (let i = 0; i < 150; i++) {
      shift.fixedUpdate(input);
      top = Math.max(top, v.vLongMps);
    }
    expect(top).toBeGreaterThan(3.9);
    expect(top).toBeLessThanOrEqual(4);
    // Raised to 5.5 mid-drive: the next ticks accelerate past the old cap up to the new one.
    shift.setTuning(tuned('drive', 'topSpeedBrushDownMps', 5.5));
    for (let i = 0; i < 60; i++) {
      shift.fixedUpdate(input);
      top = Math.max(top, v.vLongMps);
    }
    expect(top).toBeGreaterThan(5.4);
    expect(top).toBeLessThanOrEqual(5.5);
    expect(shift.snapshot()?.hp).toBe(100); // a clear road: nothing hit
    // Stop, then full right lock at standstill settles at maxSteer: 34° by default, 20° once edited.
    input.throttle = 0;
    input.brake = 255;
    for (let i = 0; i < 90 && v.vLongMps > 0; i++) shift.fixedUpdate(input);
    input.brake = 0;
    input.steer = 127;
    for (let i = 0; i < 30; i++) shift.fixedUpdate(input);
    expect(v.vLongMps).toBe(0);
    expect(v.steerRad).toBeCloseTo(34 * DEG_TO_RAD, 12);
    shift.setTuning(tuned('steering', 'maxSteerDeg', 20));
    for (let i = 0; i < 30; i++) shift.fixedUpdate(input);
    expect(v.steerRad).toBeCloseTo(20 * DEG_TO_RAD, 12);
    expect(shift.tuning.vehicle.sweeper.steering.maxSteerRad).toBeCloseTo(20 * DEG_TO_RAD, 15);
  });

  it('tracks whether every recorded tick ran on the committed tuning.json', async () => {
    const { scene: shift } = scene({ recordInputs: true });
    await shift.enter({ seed: 1, district: DEFAULT_DISTRICT });
    const input = createInputFrame();
    for (let i = 0; i < 30; i++) shift.fixedUpdate(input);
    expect(shift.tuningIsCommitted).toBe(true);
    expect(shift.logMatchesCommittedTuning).toBe(true);
    // Edited and reverted before any tick ran on it: the log is still faithful.
    shift.setTuning(tuned('drive', 'accelMps2', 3));
    expect(shift.tuningIsCommitted).toBe(false);
    expect(shift.logMatchesCommittedTuning).toBe(true);
    shift.setTuning(loadTuning(tuningSourceCopy()));
    expect(shift.tuningIsCommitted).toBe(true);
    expect(shift.logMatchesCommittedTuning).toBe(true);
    // One recorded tick on edited tuning taints the log for good, even after reverting.
    shift.setTuning(tuned('drive', 'accelMps2', 3));
    shift.fixedUpdate(input);
    expect(shift.logMatchesCommittedTuning).toBe(false);
    shift.setTuning(tuned('drive', 'accelMps2', 3.5));
    shift.setTuning(loadTuning(tuningSourceCopy()));
    expect(shift.tuningIsCommitted).toBe(true);
    expect(shift.logMatchesCommittedTuning).toBe(false);
  });

  it('does not count ticks run after the log is full', async () => {
    const { scene: shift } = scene({ recordInputs: true });
    await shift.enter({ seed: 1, district: DEFAULT_DISTRICT });
    const input = createInputFrame();
    for (let i = 0; i < SHIFT_TICKS; i++) shift.fixedUpdate(input);
    shift.setTuning(tuned('drive', 'accelMps2', 3));
    for (let i = 0; i < 10; i++) shift.fixedUpdate(input);
    expect(shift.inputLog?.length).toBe(SHIFT_TICKS);
    expect(shift.tuningIsCommitted).toBe(false);
    expect(shift.logMatchesCommittedTuning).toBe(true);
  });

  it('starts diverged when constructed with an edited copy, and takes setTuning before enter', async () => {
    const edited = scene({ recordInputs: true, tuning: tuned('drive', 'accelMps2', 3) });
    expect(edited.scene.tuningIsCommitted).toBe(false);
    await edited.scene.enter({ seed: 1, district: DEFAULT_DISTRICT });
    expect(edited.scene.logMatchesCommittedTuning).toBe(true);
    edited.scene.fixedUpdate(createInputFrame());
    expect(edited.scene.logMatchesCommittedTuning).toBe(false);

    const early = scene({ recordInputs: true });
    const maxSteer = tuned('steering', 'maxSteerDeg', 25);
    early.scene.setTuning(maxSteer);
    await early.scene.enter({ seed: 1, district: DEFAULT_DISTRICT });
    expect(early.scene.tuning).toBe(maxSteer);
    expect(early.scene.tuningIsCommitted).toBe(false);
  });

  it('refuses a tuning whose prop footprints differ (the static grid needs a new World), changing nothing', async () => {
    const { scene: shift } = scene({ recordInputs: true });
    await shift.enter({ seed: 1, district: DEFAULT_DISTRICT });
    const raw = tuningSourceCopy() as { propFootprints: { shapes: Record<string, { radiusM?: number }> } };
    const bollard = raw.propFootprints.shapes['prop.bollard'];
    if (bollard === undefined) throw new Error('no bollard');
    bollard.radiusM = 0.5;
    expect(() => shift.setTuning(loadTuning(raw))).toThrow(/propFootprints differ/);
    expect(shift.tuning).toBe(DEFAULT_TUNING);
    expect(shift.tuningIsCommitted).toBe(true);
  });
});

describe('__ssp hooks bound to the ShiftScene', () => {
  it('step(n) advances exactly n World ticks and renders exactly once, with freeze=1', async () => {
    const page = await browserLike('?test=1&scene=district.puddle_lane&freeze=1');
    expect(page.loop.frozen).toBe(true);
    page.frames(30); // frozen: frames render but never step
    expect(page.api.state().tick).toBe(0);
    for (const n of [600, 0, 1, 37]) {
      const tick = page.api.state().tick;
      const renders = page.renders();
      const posed = page.scene.renderCount;
      const perfRenders = page.api.perf().renders;
      page.api.step(n);
      expect(page.api.state().tick).toBe(tick + n);
      expect(page.renders() - renders).toBe(1);
      expect(page.scene.renderCount - posed).toBe(1);
      expect(page.api.perf().renders - perfRenders).toBe(1);
    }
    expect(page.api.state().tick).toBe(638);
  });

  it('state() is the JSON-safe SimSnapshot plus the camera', async () => {
    const page = await browserLike('?test=1&scene=district.puddle_lane&freeze=1');
    page.keyboard.handleKeyDown(keyEvent('KeyW'));
    page.keyboard.handleKeyDown(keyEvent('KeyD'));
    page.api.step(90);
    const state = page.api.state();
    expect(isShiftTestState(state)).toBe(true);
    if (!isShiftTestState(state)) return;
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
    expect(Object.keys(state).sort()).toEqual(['bessie', 'camera', 'hp', 'tick']);
    expect(Object.keys(state.bessie).sort()).toEqual(['heading', 'speed', 'x', 'y']);
    expect(state.tick).toBe(90);
    expect(state.bessie.speed).toBeGreaterThan(0);
    expect(state.bessie.heading).toBeGreaterThan(0); // steered right (clockwise)
  });

  it('tick=600 in the URL gives state().tick 600 at ready', async () => {
    const page = await browserLike('?test=1&scene=district.puddle_lane&tick=600');
    expect(page.api.ready).toBe(true);
    expect(page.api.state().tick).toBe(600);
    // Unfrozen after ready: every 1/60 s frame is one tick.
    page.frames(5);
    expect(page.api.state().tick).toBe(605);
  });

  it('is seeded from seed=<n>', async () => {
    const page = await browserLike('?test=1&scene=district.puddle_lane&seed=42&freeze=1');
    expect(page.scene.worldView?.seed).toBe(42);
  });

  it('drives north from the depot with the keyboard (W / ↑)', async () => {
    const page = await browserLike('?test=1&scene=district.puddle_lane');
    page.keyboard.handleKeyDown(keyEvent('ArrowUp'));
    page.frames(60);
    const state = page.api.state();
    if (!isShiftTestState(state)) throw new Error('not a shift');
    expect(state.tick).toBe(60);
    expect(state.bessie.speed).toBeGreaterThan(1);
    expect(state.bessie.y).toBeLessThan(level.player.y - 0.5);
    expect(state.bessie.x).toBeCloseTo(level.player.x, 6);
    expect(state.bessie.heading).toBe(0);
  });

  it('drives north from the depot with the gamepad (RT)', async () => {
    const page = await browserLike('?test=1&scene=district.puddle_lane');
    const pad = fakePad();
    page.pads.slots[0] = pad;
    page.frames(1); // the first poll of a new pad only sets its baseline
    setTrigger(pad, 7, 1);
    page.frames(60);
    const state = page.api.state();
    if (!isShiftTestState(state)) throw new Error('not a shift');
    expect(state.bessie.speed).toBeGreaterThan(1);
    expect(state.bessie.y).toBeLessThan(level.player.y - 0.5);
  });
});
