// SSP-046: the drive-only ShiftScene, driven without WebGL. It loads compiled Puddle Lane and the world, actors and
// items atlases (the items batch: litter, stains and the level's markers, SSP-067), creates a seeded World with Bessie at the depot start facing north, steps it once per loop tick from
// real input devices (keyboard and gamepad through src/input/actions.ts), draws the interpolated pose and points
// the follow camera at it, records the input log in dev builds, and binds `__ssp.step(n)` / `__ssp.state()` to
// the World (exactly n ticks, exactly one render, JSON-safe SimSnapshot).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Group } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Assets } from '../../src/app/assetRegistry.ts';
import { EventBus } from '../../src/app/events.ts';
import type { SceneContext } from '../../src/app/Game.ts';
import { createLoop, type LoopClock } from '../../src/app/loop.ts';
import { SCENE_IDS, SceneManager } from '../../src/app/SceneManager.ts';
import { ScriptedInput } from '../../src/debug/scriptedInput.ts';
import {
  installTestHooks,
  isShiftTestState,
  type SspTestApi,
  type TestHookTarget,
} from '../../src/debug/testHooks.ts';
import { Actions } from '../../src/input/actions.ts';
import { GamepadDevice } from '../../src/input/gamepad.ts';
import { KeyboardDevice } from '../../src/input/keyboard.ts';
import { createDirtyRect, mergeDirtyRect, type TextureRegionUploader } from '../../src/render/groundLayer.ts';
import type { Renderer } from '../../src/render/Renderer.ts';
import { FX_PUDDLE, FxPuddleScene } from '../../src/scenes/FxPuddleScene.ts';
import {
  DEFAULT_DISTRICT,
  districtLevelName,
  ShiftScene,
  type ShiftSceneOptions,
} from '../../src/scenes/ShiftScene.ts';
import { DEG_TO_RAD, DT_S, SHIFT_TICKS } from '../../src/sim/constants.ts';
import { EV } from '../../src/sim/eventQueue.ts';
import { createInputFrame, PRESSED } from '../../src/sim/inputFrame.ts';
import { decodeLevel, type Level } from '../../src/sim/map.ts';
import { loadReplay, readInput, runReplay } from '../../src/sim/replay.ts';
import { snapshotWorld } from '../../src/sim/snapshot.ts';
import { DEFAULT_TUNING, loadTuning, type Tuning, tuningSourceCopy } from '../../src/sim/tuning.ts';
import { checkoutAssets, recordingAssets } from '../support/checkoutAssets.ts';
import { fakePad, keyEvent, padSource, setTrigger } from '../support/fakeInput.ts';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel: string): string => readFileSync(`${REPO_ROOT}${rel}`, 'utf8');
const LEVEL_JSON = read('public/assets/levels/puddle_lane.json');

/** Serves compiled levels from the checkout (`/assets/levels/<name>.json` under base `/`). */
const checkoutLevels = async (url: string): Promise<string> => read(`public/${url.replace(/^\//, '')}`);

/** What a ShiftScene takes from the registry, sorted: four atlases and the HUD font, nothing loaded itself. */
const REGISTRY_LOOKUPS = ['atlas:actors', 'atlas:items', 'atlas:ui', 'atlas:world', 'font:kerbside5x7'];

/** The asset registry BootScene would have loaded (SSP-284): the scene takes its atlases and font here. */
let assets: Assets;
beforeAll(async () => {
  assets = await checkoutAssets();
});

let level: Level;
beforeAll(() => {
  level = decodeLevel(LEVEL_JSON);
});

/**
 * A SceneContext over a fake renderer: records follow-camera calls and moves the rig's snapped position with them
 * (at the sweep height, 480 px wide, so the items batch can take its cull rect from it).
 */
function context() {
  const follows: [x: number, y: number, vx: number, vy: number, speed: number][] = [];
  /** What the scene took from the registry (`atlas:<name>`, `font:<name>`). */
  const loaded: string[] = [];
  const rig = { snappedX: 0, snappedZ: 0, height: { value: 31.5, velocity: 0 }, internalWidth: 480 };
  // The grime uploads (SSP-066): copyTextureToTexture regions, as [minX, minY, maxX, maxY) cells.
  const uploads: [number, number, number, number][] = [];
  const webgl: TextureRegionUploader = {
    copyTextureToTexture: (_src, _dst, region) => {
      if (region === null) throw new Error('no region');
      uploads.push([region.min.x, region.min.y, region.max.x, region.max.y]);
    },
  };
  let released = 0;
  const ctx: SceneContext = {
    renderer: { rig, webgl } as unknown as Renderer,
    root: new Group(),
    ui: new Group(),
    events: new EventBus(),
    assets: recordingAssets(assets, loaded),
    pinCamera: () => {
      throw new Error('ShiftScene never pins the camera');
    },
    followCamera: (x, y, vx, vy, speed) => {
      follows.push([x, y, vx, vy, speed]);
      rig.snappedX = x;
      rig.snappedZ = y;
    },
    releaseCamera: () => {
      released += 1;
    },
    clientToInternal: () => false,
    onHidden: () => () => {},
  };
  return { ctx, follows, loaded, uploads, released: () => released };
}

function scene(options: ShiftSceneOptions = {}) {
  const c = context();
  return {
    ...c,
    scene: new ShiftScene(c.ctx, { levelSource: checkoutLevels, ...options }),
  };
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
  // Game.ts in test mode: every tick samples through the scripted input, by the top ShiftScene's World tick.
  const scripted = new ScriptedInput(actions, () => {
    const top = scenes.top;
    return top instanceof ShiftScene ? top.worldTick : null;
  });
  const loop = createLoop(
    {
      beginFrame: () => scripted.beginFrame(),
      sampleForTick: () => scripted.sampleForTick(),
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
    camera: () => ({ x: 0, y: 0, h: 31.5, leadX: 0, leadY: 0, pinned: false }),
    drawCalls: () => 6,
    renders: () => renders,
    sceneId: () => scenes.top?.id ?? null,
    sceneHistory: () => scenes.ids(),
    sceneStack: () => scenes.ids(),
    boot: () => ({ status: 'loaded', error: null, lutBuilds: 1 }),
    loadInputs: (log) => scripted.load(log),
    injectEvent: () => {},
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
    scripted,
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
    expect(loaded.sort()).toEqual(REGISTRY_LOOKUPS);
    expect(shift.district).toBe('district.puddle_lane');
    const world = shift.worldView;
    if (world === null) throw new Error('no world');
    expect(world.seed).toBe(1);
    expect(world.level.id).toBe('district.puddle_lane');
    expect(shift.simEvents).toBe(world.events);
    // The depot start: the level's player start, heading 0 = north.
    expect(level.player.heading).toBe(0);
    expect(shift.snapshot()).toMatchObject({
      tick: 0,
      bessie: { x: level.player.x, y: level.player.y, heading: 0, speed: 0 },
      hp: 100,
      // Shift setup (SSP-065): Puddle Lane's 130 items and 9,000 grime cells, an empty hopper, a full tank.
      score: 0,
      tidy: 0,
      hopper: { lu: 0, capacityLu: 100, full: false },
      water: { units: 100, capacity: 100 },
      combo: { chain: 0, multiplier: 1, timerTicks: 0, bestChain: 0 },
      litter: { spawned: 130, collected: 0 },
      grime: { initial: 9000, cleaned: 0 },
    });
    expect(ctx.root.children.map((g) => g.name)).toEqual(['levelCity', 'bessieSprite', 'items', 'fx']);
    expect(follows).toEqual([[level.player.x, level.player.y, 0, 0, 0]]);
    expect(shift.inputLog).toBeNull();

    shift.render(0);
    expect(shift.bessieSprite?.bodyFrame).toBe('veh.sweeper:body:h00:0');
    expect(shift.bessieSprite?.brushFrame).toBeNull();
    expect(shift.renderCount).toBe(1);
    // The items batch (SSP-067): the depot start's view holds both depot bays and no litter (Puddle Lane's
    // nearest spawned item is beyond the camera rect plus 4 m).
    const items = shift.itemsBatch;
    expect(items?.markersDrawn).toBe(2);
    expect(items?.batch.count).toBe(
      (items?.markersDrawn ?? 0) +
        (items?.litterDrawn ?? 0) +
        (items?.pickupsDrawn ?? 0) +
        (items?.hazardsDrawn ?? 0) +
        (items?.knockablesDrawn ?? 0),
    );
    // The street (SSP-103) shares Bessie's actors batch: her body plus every NPC, vehicle and lead run drawn.
    const street = shift.streetActors;
    expect(street).not.toBeNull();
    expect(shift.bessieSprite?.sprites.count).toBe(
      1 + (street?.npcsDrawn ?? 0) + (street?.vehiclesDrawn ?? 0) + (street?.leadRunsDrawn ?? 0),
    );
    // At tick 0 the depot view holds parked cars only (no NPC is out yet), each drawn with its drop shadow.
    expect(street?.npcsDrawn).toBe(0);
    expect(shift.bessieSprite?.shadows.count).toBe(1 + (street?.vehiclesDrawn ?? 0));
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

  it('requestPause (SSP-287) stops the World at once and freezes the drawn frame until resume()', async () => {
    const reasons: string[] = [];
    let accept = true;
    const { scene: shift, follows } = scene({
      onPause: (reason) => {
        reasons.push(reason);
        return accept;
      },
    });
    expect(shift.requestPause('player')).toBe(false); // not entered yet
    await shift.enter({ seed: 1, district: DEFAULT_DISTRICT });
    const input = createInputFrame();
    input.throttle = 255;
    for (let i = 0; i < 30; i++) shift.fixedUpdate(input);
    shift.render(0.25);
    const drawn = follows.length;
    const pose = Array.from(shift.bessieSprite?.sprites.instanceData ?? []);
    // Refused by the flow: the shift keeps running.
    accept = false;
    expect(shift.requestPause('player')).toBe(false);
    expect(shift.paused).toBe(false);
    accept = true;
    expect(shift.requestPause('hidden')).toBe(true);
    expect(shift.requestPause('player')).toBe(false); // already paused
    expect(reasons).toEqual(['player', 'hidden']);
    for (let i = 0; i < 10; i++) shift.fixedUpdate(input);
    expect(shift.snapshot()?.tick).toBe(30);
    // Any alpha while paused draws the last running frame: same pose, the camera left alone.
    shift.render(0.9);
    expect(follows.length).toBe(drawn);
    expect(Array.from(shift.bessieSprite?.sprites.instanceData ?? [])).toEqual(pose);
    expect(pose.some((v) => v !== 0)).toBe(true);
    shift.resume();
    shift.fixedUpdate(input);
    expect(shift.snapshot()?.tick).toBe(31);
    shift.render(0.5);
    expect(follows.length).toBe(drawn + 1);
  });

  it("feeds the follow camera Bessie's real velocity and vLong (look-ahead and speed zoom, SSP-047)", async () => {
    const { scene: shift, follows } = scene();
    await shift.enter({ seed: 1, district: DEFAULT_DISTRICT });
    const input = createInputFrame();
    input.throttle = 255;
    for (let i = 0; i < 60; i++) shift.fixedUpdate(input);
    input.steer = 127;
    for (let i = 0; i < 20; i++) shift.fixedUpdate(input);
    const v = shift.worldView?.vehicle;
    if (v === undefined) throw new Error('no world');
    expect(v.vLongMps).toBeGreaterThan(1);
    expect(v.headingRad).toBeGreaterThan(0.05);
    shift.render(1);
    const [x, y, vx, vy, speed] = follows[follows.length - 1] ?? [];
    expect(x).toBe(v.xM);
    expect(y).toBe(v.yM);
    // Ground velocity = forward·vLong + right·vLat at the drawn heading (0 = north, clockwise).
    const s = Math.sin(v.headingRad);
    const c = Math.cos(v.headingRad);
    expect(vx).toBeCloseTo(s * v.vLongMps + c * v.vLatMps, 12);
    expect(vy).toBeCloseTo(-c * v.vLongMps + s * v.vLatMps, 12);
    // Heading north-east-ish: east (+x) and north (−y) components.
    expect(vx).toBeGreaterThan(0);
    expect(vy).toBeLessThan(0);
    expect(speed).toBe(v.vLongMps);
    // The scene never writes the World: rendering again changes nothing in the snapshot.
    const before = shift.snapshot();
    shift.render(0.5);
    expect(shift.snapshot()).toEqual(before);
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

  it('draws grime from the World mask and uploads the union of each frame’s dirty rects once (SSP-066)', async () => {
    const { scene: shift, uploads } = scene();
    await shift.enter({ seed: 1, district: DEFAULT_DISTRICT });
    const grime = shift.levelCity?.grime;
    const world = shift.worldView;
    if (grime === undefined || grime === null || world === null) throw new Error('no grime');
    expect(grime.texture.image.data).toBe(world.dirt.mask);
    const input = createInputFrame();
    input.pressed = PRESSED.BRUSH;
    shift.fixedUpdate(input);
    input.pressed = 0;
    input.throttle = 255;
    let uploadsExpected = 0;
    for (let frame = 0; frame < 200; frame++) {
      const union = createDirtyRect();
      for (let t = 0; t < 1 + (frame % 2); t++) {
        shift.fixedUpdate(input);
        const d = world.dirt;
        mergeDirtyRect(union, d.dirtyMinX, d.dirtyMinY, d.dirtyMaxX, d.dirtyMaxY);
      }
      const before = uploads.length;
      shift.render(1);
      if (union.maxX < union.minX) {
        expect(uploads.length).toBe(before);
        continue;
      }
      uploadsExpected++;
      expect(uploads.length).toBe(before + 1);
      expect(uploads[uploads.length - 1]).toEqual([union.minX, union.minY, union.maxX + 1, union.maxY + 1]);
    }
    expect(world.dirt.cleanedCells).toBeGreaterThan(0);
    expect(uploadsExpected).toBeGreaterThan(10);
    expect(uploads).toHaveLength(uploadsExpected);
    shift.exit();
    expect(shift.levelCity).toBeNull();
  });

  it("spins the brush overlay by the World's RPM: frozen on frame 0 below 10%, 3 ticks per frame at 100%", async () => {
    const { scene: shift } = scene();
    await shift.enter({ seed: 1, district: DEFAULT_DISTRICT });
    const input = createInputFrame();
    input.pressed = PRESSED.BRUSH;
    shift.fixedUpdate(input);
    input.pressed = 0;
    const spins: { rpm: number; frame: string | null }[] = [];
    for (let t = 0; t < 120; t++) {
      shift.fixedUpdate(input);
      shift.render(1);
      spins.push({ rpm: shift.worldView?.vehicle.rpm ?? -1, frame: shift.bessieSprite?.brushFrame ?? null });
    }
    const spinOf = (frame: string | null): number => Number(frame?.split(':')[3]);
    // Lowering and spinning up: frame 0 until the RPM reaches 10%.
    for (const s of spins) if (s.rpm < 0.1) expect(spinOf(s.frame)).toBe(0);
    // At full RPM the frame advances every 3 ticks, cycling 0..3.
    const full = spins.filter((s) => s.rpm === 1).map((s) => spinOf(s.frame));
    expect(full.length).toBeGreaterThan(24);
    const changes = full.slice(1).filter((f, i) => f !== full[i]).length;
    expect(changes).toBeGreaterThanOrEqual(Math.floor(full.length / 3) - 1);
    expect(changes).toBeLessThanOrEqual(Math.ceil(full.length / 3) + 1);
    expect(new Set(full)).toEqual(new Set([0, 1, 2, 3]));
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
    // Bessie is at rest when the timer runs out (tick 14,399), so the shift ends on that tick (SSP-062).
    expect(shift.snapshot()?.shift).toMatchObject({
      phase: 'ended',
      endReason: 'time_up',
      endTick: SHIFT_TICKS - 1,
    });
  });

  it('stops stepping the World once the shift has ended, so the tally sees the final state (SSP-071)', async () => {
    const { scene: shift } = scene();
    await shift.enter({ seed: 1, district: DEFAULT_DISTRICT });
    const input = createInputFrame();
    input.throttle = 255;
    let ticks = 0;
    while (!shift.ended) {
      shift.fixedUpdate(input);
      ticks += 1;
      if (ticks > SHIFT_TICKS + 1200) throw new Error('the shift never ended');
    }
    const end = shift.snapshot();
    expect(end?.shift.phase).toBe('ended');
    expect(end?.tick).toBe((end?.shift.endTick ?? -2) + 1);
    for (let i = 0; i < 120; i++) shift.fixedUpdate(input);
    expect(shift.snapshot()).toEqual(end);
    expect(shift.level?.id).toBe(DEFAULT_DISTRICT);
  });

  it('enters with a preloaded level without fetching it (SSP-071)', async () => {
    const c = context();
    const shift = new ShiftScene(c.ctx, {
      level,
      levelSource: async () => {
        throw new Error('fetched the level');
      },
    });
    await shift.enter({ seed: 4, district: DEFAULT_DISTRICT });
    expect(shift.level).toBe(level);
    expect(c.loaded.sort()).toEqual(REGISTRY_LOOKUPS);
    const other = new ShiftScene(context().ctx, { level });
    await expect(other.enter({ seed: 4, district: 'district.high_street' })).rejects.toThrow(
      /holds 'district.puddle_lane'/,
    );
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
    expect(Object.keys(state).sort()).toEqual([
      'bessie',
      'camera',
      'combo',
      'complaints',
      'frontages',
      'grime',
      'hopper',
      'hp',
      'litter',
      'npcs',
      'pickups',
      'powerUps',
      'score',
      'shift',
      'stars',
      'tick',
      'tidy',
      'water',
    ]);
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

  it('loadInputs(inputs, ticks) replays a replay file by World tick, ignoring the live devices (SSP-073)', async () => {
    const { file, log } = loadReplay(read('tests/replay/replays/m2_full_shift_puddle_lane.json'));
    expect(file.district).toBe('district.puddle_lane');
    const page = await browserLike(`?test=1&scene=district.puddle_lane&seed=${file.seed}&freeze=1`);
    expect(page.scripted.scripted).toBe(false);
    page.api.loadInputs(file.inputs, file.ticks);
    expect(page.scripted.scripted).toBe(true);
    expect(page.scripted.ticks).toBe(file.ticks);
    // Live keys reach nothing while a log is loaded (full right lock and reverse would wreck the route).
    page.keyboard.handleKeyDown(keyEvent('KeyS'));
    page.keyboard.handleKeyDown(keyEvent('KeyD'));
    page.api.step(300);
    page.api.step(300);
    const state = page.api.state();
    if (!isShiftTestState(state)) throw new Error('not a shift');
    // The same 600 ticks run headlessly, as `npm run test:replay` runs them.
    const headless = runReplay(level, DEFAULT_TUNING, file.seed, log, 600);
    const { camera: _camera, ...sim } = state;
    expect(sim).toEqual(snapshotWorld(headless.world));
    expect(state.bessie.y).toBeLessThan(level.player.y - 10); // north up Mangle Street
  });

  it('loadInputs feeds neutral frames past the log and before a World runs, and rejects a bad log', async () => {
    const page = await browserLike('?test=1&scene=district.puddle_lane&seed=1001&freeze=1');
    const api = page.api;
    expect(() => api.loadInputs('', 0)).toThrow(/ticks must be an integer/);
    expect(() => api.loadInputs('', 1.5)).toThrow(/ticks must be an integer/);
    expect(() => api.loadInputs(42 as unknown as string, 10)).toThrow(/base64 string/);
    expect(() => api.loadInputs('!!!!', 10)).toThrow();
    expect(page.scripted.scripted).toBe(false);
    // A neutral log: W held on the keyboard never moves her.
    api.loadInputs('', 60);
    page.keyboard.handleKeyDown(keyEvent('KeyW'));
    api.step(120);
    const state = api.state();
    if (!isShiftTestState(state)) throw new Error('not a shift');
    expect(state.tick).toBe(120);
    expect(state.bessie.speed).toBe(0);
    expect(state.bessie.y).toBe(level.player.y);
  });
});

describe('ShiftScene fx (SSP-102)', () => {
  /** Steps `shift` once with `input` and drains its tick into the scene's bus, as the loop does after each tick. */
  function tick(shift: ShiftScene, ctx: SceneContext, input = createInputFrame()): void {
    shift.fixedUpdate(input);
    const events = shift.simEvents;
    if (events !== null) ctx.events.drain(events);
  }

  it('adds the fx draw to the world pass, draws nothing while no effect runs, and releases it on exit', async () => {
    const { scene: shift, ctx } = scene();
    await shift.enter({ seed: 1, district: DEFAULT_DISTRICT });
    const fx = shift.fxParticles;
    if (fx === null) throw new Error('no fx');
    expect(ctx.root.children).toContain(fx.mesh);
    for (let i = 0; i < 30; i++) tick(shift, ctx);
    shift.render(0.5);
    expect(fx.spawned).toBe(0);
    expect(fx.mesh.count).toBe(0);
    shift.exit();
    expect(shift.fxParticles).toBeNull();
    expect(ctx.root.children).not.toContain(fx.mesh);
  });

  it('fx_puddle: a fast crossing of the placed puddle splashes, and no droplet is ever in front of Bessie', async () => {
    const c = context();
    const shift = new FxPuddleScene(c.ctx, checkoutLevels);
    await shift.enter({ seed: 1 });
    expect(shift.district).toBe(DEFAULT_DISTRICT);
    const world = shift.worldView;
    if (world === null) throw new Error('no world');
    const fx = shift.fxParticles;
    if (fx === null) throw new Error('no fx');
    const splashes: { tick: number; x: number; y: number; speedMps: number }[] = [];
    c.ctx.events.on(EV.Splash, (e) => splashes.push({ tick: e.tick, x: e.x, y: e.y, speedMps: e.speedMps }));
    const input = createInputFrame();
    input.throttle = 255;
    for (let i = 0; i < 400 && splashes.length === 0; i++) tick(shift, c.ctx, input);
    expect(splashes).toHaveLength(1);
    const splash = splashes[0];
    if (splash === undefined) throw new Error('no splash');
    expect([splash.x, splash.y]).toEqual([FX_PUDDLE.x, FX_PUDDLE.y]);
    expect(splash.speedMps).toBeGreaterThan(3);
    expect(fx.spawned).toBeGreaterThanOrEqual(10);
    // Keep driving north and look at every frame until the last droplet has gone: none ahead of her front bumper.
    const halfLength = DEFAULT_TUNING.vehicle.sweeper.body.lengthM / 2;
    let framesWithDroplets = 0;
    for (let i = 0; i < 40; i++) {
      for (const alpha of [0, 0.5]) {
        shift.render(alpha);
        const v = world.vehicle;
        const x = v.prevXM + (v.xM - v.prevXM) * alpha;
        const y = v.prevYM + (v.yM - v.prevYM) * alpha;
        const fwdX = Math.sin(v.headingRad);
        const fwdY = -Math.cos(v.headingRad);
        const data = fx.instanceData;
        if (fx.drawn > 0) framesWithDroplets++;
        for (let k = 0; k < fx.drawn; k++) {
          const px = data[k * 4] as number;
          const py = data[k * 4 + 1] as number;
          const ahead = (px - x) * fwdX + (py - y) * fwdY;
          expect(ahead, `droplet ${k} on frame ${i}`).toBeLessThan(halfLength);
          // Around the puddle: within 3 m of its centre.
          expect(Math.hypot(px - splash.x, py - splash.y)).toBeLessThan(3);
        }
      }
      tick(shift, c.ctx, input);
    }
    expect(framesWithDroplets).toBeGreaterThan(10);
    expect(fx.drawn).toBe(0);
    expect(fx.mesh.count).toBe(0);
    shift.exit();
  });
});
