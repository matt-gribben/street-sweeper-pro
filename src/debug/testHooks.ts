// Test hooks (TECHNICAL_DESIGN §18.5). Active ONLY with `?test=1`: this module ships in release builds (so
// Playwright tests the shipping bundle) but installs nothing without the flag. Never ship behaviour that
// depends on it (CLAUDE.md §5.1).
//
// URL parameters, all optional after `test=1`:
//   seed=<n>    run seed, an unsigned 32-bit integer (the shift's World is created with it; 0 when absent);
//   scene=<id>  boot straight into a scene: the shift flow's intro card (`shift_intro`, src/scenes/ShiftIntroScene.ts,
//               also the default without `scene`, SSP-071), a district shift with the intro skipped (`shift` for
//               Puddle Lane, or `district.puddle_lane`, src/scenes/ShiftScene.ts), `spike_city`, `lean_quadrants`, `scale_1440`, `scale_sheet`
//               (src/scenes/SpikeScene.ts), `level_preview` (src/scenes/LevelPreviewScene.ts), `text_sample`
//               (src/scenes/TextSampleScene.ts, SSP-069), `panel_sample` (src/scenes/PanelSampleScene.ts,
//               SSP-285) or `hud_sample` (src/scenes/HudSampleScene.ts, SSP-070); main.ts pushes it onto the
//               SceneManager;
//   tick=<n>    advance n ticks synchronously after load, before `ready` turns true;
//   freeze=1    the loop (src/app/loop.ts) keeps rendering but never steps;
//   night=1     the palette pass applies the night remap outside the light mask, and scenes draw their light
//               pools (SSP-021; `lean_quadrants` hangs one under each lamp post);
//   springs=1   keep the follow camera's look-ahead and speed-zoom springs on (SSP-047). Off by default so frames
//               never depend on timing; with test mode's fixed 1/60 s frames (and step(n) handing the spring n/60 s
//               of render time) the live camera is still deterministic.
// Malformed values throw at boot: a test must never run against a silently defaulted parameter.
//
// `window.__ssp`:
//   ready         true once BootScene has loaded the asset registry, the routed scene has joined the stack and
//                 the first complete frame is rendered (SSP-284); specs wait for it;
//   step(n)       advance n ticks synchronously (also while frozen), then render exactly once;
//   state()       a JSON-safe snapshot: in a shift, the World's SimSnapshot (src/sim/snapshot.ts: tick,
//                 bessie { x, y, heading, speed }, hp; since SSP-065 score, tidy, stars, hopper, water, combo,
//                 litter and grime counts and the frontages' clean %; since SSP-080 the live NPCs' ids,
//                 origins, positions, headings and states) plus the camera (focus x, y, height h,
//                 look-ahead offset leadX, leadY, pinned); in a scene without a sim, the loop's tick count plus
//                 the camera;
//   readFrame()   the raw W×270 palette-mapped RGBA frame, row 0 at the top (Renderer.readFrame);
//   setCamera()   pin the render camera at (x, y) sim metres and height h metres, springs off for good;
//   perf()        draw calls of the last rendered frame (all passes), frames rendered since boot, plus the
//                 frame timings recorded since the last perfReset(): rAF timestamp deltas and frame-callback CPU
//                 time (perfCounters.ts);
//   perfReset()   clears the recorded timings (start of a perf sampling window);
//   scene()       the active (top) scene's ID (`shift_intro`, `shift`, `tally`, `lean_quadrants`, …), or null while
//                 the stack is empty (SSP-071): SimSnapshot has no field for it;
//   sceneHistory() the IDs of every scene that joined the stack since boot, oldest first (SSP-071), so a spec can
//                 check a transition skipped a scene (Try Again never shows the intro card);
//   boot()        BootScene's state (SSP-284): 'loading', 'loaded' or 'failed', the error that failed the boot (its
//                 message, naming the asset, e.g. a 404 atlas) and how many times the palette LUT was built on this
//                 page (palettePass.ts lutBuildCount: exactly 1 after boot).
//
// step(n) runs n fixed 60 Hz loop ticks synchronously (loop.runTicks: input → scenes.fixedUpdate → event drain)
// and renders once (loop.renderNow). In a shift each loop tick is one World tick (ShiftScene.fixedUpdate calls
// world.step), so state().tick, the World's tick, advances by exactly n (SSP-046). In the spike scenes a tick
// advances the counter driving their actors (heading cycle, brush spin) and state() reports the loop's tick
// count. SimSnapshot grows with the sim: M2 added the sweeping state (SSP-065), M3 adds complaints (SSP-078).
//
// Timings are recorded once `ready` is true, one sample per requestAnimationFrame callback (the loop measures
// the callback's CPU time and main.ts records it, so performance.now() stays in src/app/loop.ts); they are
// read-only observations and never feed back into what is drawn. tests/e2e/perf.spec.ts reads them (SSP-023).
//
// Test mode also turns off what would make frames depend on timing (main.ts, src/app/Game.ts): the look-ahead and
// speed-zoom springs unless `springs=1`, wall-clock frame times (every frame is a fixed 1/60 s: one tick per
// frame) and the dev panel. The loop also holds (frozen) until `ready`. There is no audio before
// M5; M5's mixer must stay silent in test mode.

/** Test mode: every frame lasts this long, in seconds (Game.ts gives it to the loop): one tick per frame. */
export const TEST_RENDER_STEP_S = 1 / 60;

/** Largest `seed`: sfc32 seeds are unsigned 32-bit integers. */
export const MAX_SEED = 0xffff_ffff;

import type { SimSnapshot } from '../sim/snapshot.ts';
import { createPerfCounters, type PerfSamples } from './perfCounters.ts';

/** Parsed `?test=1` parameters. */
export type TestParams = {
  /** `seed=<n>`, or null when absent. */
  readonly seed: number | null;
  /** `scene=<id>`, or null when absent (boot the default world). */
  readonly scene: string | null;
  /** `tick=<n>`: ticks to advance after load (0 when absent). */
  readonly tick: number;
  /** `freeze=1`: render but never step. */
  readonly freeze: boolean;
  /** `night=1`: night remap outside the light mask, light pools drawn (SSP-021). */
  readonly night: boolean;
  /** `springs=1`: the follow camera's look-ahead and speed-zoom springs stay on (SSP-047). */
  readonly springs: boolean;
};

/** Camera part of {@link TestState}: focus in sim metres, height in metres, look-ahead offset in metres. */
export type TestCamera = {
  /** Focus (unsnapped), sim metres: the followed subject plus the look-ahead offset. */
  readonly x: number;
  readonly y: number;
  readonly h: number;
  /** Look-ahead offset of the focus from the subject, sim metres (0 with the springs off or pinned). */
  readonly leadX: number;
  readonly leadY: number;
  /** True once setCamera() pinned it (springs off). */
  readonly pinned: boolean;
};

/** state() in a scene without a sim (the spike scenes, level_preview). */
export type SceneTestState = {
  /** Loop ticks run so far (src/app/loop.ts). */
  readonly tick: number;
  readonly camera: TestCamera;
};

/** state() in a shift: the World's SimSnapshot (tick is the World's tick) plus the camera. */
export type ShiftTestState = SimSnapshot & { readonly camera: TestCamera };

/** What `__ssp.state()` returns: JSON-safe, so it crosses `page.evaluate`. */
export type TestState = SceneTestState | ShiftTestState;

/** True when `state` came from a shift (it carries the SimSnapshot fields). */
export function isShiftTestState(state: TestState): state is ShiftTestState {
  return 'bessie' in state;
}

/** What `__ssp.perf()` returns: JSON-safe, so it crosses `page.evaluate`. */
export type TestPerf = PerfSamples & {
  /** Draw calls of the last rendered frame over every pass (`renderer.info.render.calls`, §12.7). */
  readonly drawCalls: number;
  /** Frames rendered since boot (Renderer.renderCount): step(n) adds exactly 1. */
  readonly renders: number;
};

/** Where BootScene is (`__ssp.boot()`, SSP-284). JSON-safe. */
export type TestBoot = {
  readonly status: 'idle' | 'loading' | 'loaded' | 'failed';
  /** The message of the error that failed the boot (or its hand-off), or null. */
  readonly error: string | null;
  /** buildLut calls on this page (palettePass.ts lutBuildCount). */
  readonly lutBuilds: number;
};

/** The `window.__ssp` object. */
export type SspTestApi = {
  readonly ready: boolean;
  step(n: number): void;
  state(): TestState;
  readFrame(): Uint8Array;
  setCamera(x: number, y: number, h: number): void;
  perf(): TestPerf;
  perfReset(): void;
  /** The active (top) scene's ID, or null while the stack is empty. */
  scene(): string | null;
  /** IDs of the scenes that joined the stack since boot, oldest first. */
  sceneHistory(): string[];
  /** BootScene's state, error and the page's LUT build count (SSP-284). */
  boot(): TestBoot;
};

/** What the hooks drive: implemented by main.ts over the Game's loop and renderer. */
export type TestHookHost = {
  /** The loop's tick count. */
  tick(): number;
  /** The shift's SimSnapshot, or null when the scene has no World. */
  snapshot(): SimSnapshot | null;
  /** Runs `n` loop ticks synchronously without drawing. */
  advance(n: number): void;
  /** Draws one complete frame now, from the current tick and camera. */
  render(): void;
  /** The last rendered frame (Renderer.readFrame). */
  readFrame(): Uint8Array;
  /** Pins the camera at (x, y) sim metres and height h metres; the loop stops updating it. */
  pinCamera(x: number, y: number, h: number): void;
  camera(): TestCamera;
  /** Draw calls of the last rendered frame, all passes (Renderer.drawCalls). */
  drawCalls(): number;
  /** Frames rendered since boot (Renderer.renderCount). */
  renders(): number;
  /** The top scene's ID (SceneManager.top), or null. */
  sceneId(): string | null;
  /** IDs of the scenes that joined the stack since boot, oldest first. */
  sceneHistory(): readonly string[];
  /** BootScene's state (BootScene.status / error) and the LUT build count. */
  boot(): TestBoot;
};

/** An object that can carry `__ssp`: the browser's `window`, or a plain object in unit tests. */
export type TestHookTarget = { __ssp?: SspTestApi };

/** Installed hooks: the parameters, the API placed on the target, and the loop's readiness switch. */
export type TestHooks = {
  readonly params: TestParams;
  readonly api: SspTestApi;
  /** Call once assets are loaded and a complete frame has been rendered. */
  markReady(): void;
  /** Records one frame's timings for perf(): rAF timestamp delta and frame-callback CPU time, in ms. */
  recordFrame(frameMs: number, workMs: number): void;
};

declare global {
  interface Window {
    /** Test hooks, present only with `?test=1`. */
    __ssp?: SspTestApi;
  }
}

/** Scene IDs are snake_case, optionally class-prefixed like district IDs (`district.puddle_lane`). */
const SCENE_ID = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)?$/;
const DIGITS = /^\d+$/;

function parseCount(name: string, raw: string, max: number): number {
  const value = Number(raw);
  if (!DIGITS.test(raw) || !Number.isSafeInteger(value) || value > max) {
    throw new Error(`?test=1: ${name}=${raw} must be an integer in 0..${max}`);
  }
  return value;
}

/** A `0`/`1` switch parameter: false when absent; throws on any other value. */
function parseSwitch(name: string, raw: string | null): boolean {
  if (raw === null) return false;
  if (raw !== '0' && raw !== '1') throw new Error(`?test=1: ${name}=${raw} must be 0 or 1`);
  return raw === '1';
}

/**
 * Parses the test parameters from a `location.search` string. Returns null unless `test=1` is present (any other
 * value, or none, means test mode is off); throws on a malformed seed, scene, tick, freeze, night or springs.
 */
export function readTestParams(search: string): TestParams | null {
  const query = new URLSearchParams(search);
  if (query.get('test') !== '1') return null;

  const seedRaw = query.get('seed');
  const sceneRaw = query.get('scene');
  const tickRaw = query.get('tick');

  if (sceneRaw !== null && !SCENE_ID.test(sceneRaw)) {
    throw new Error(`?test=1: scene=${sceneRaw} is not a scene ID`);
  }
  return {
    seed: seedRaw === null ? null : parseCount('seed', seedRaw, MAX_SEED),
    scene: sceneRaw,
    tick: tickRaw === null ? 0 : parseCount('tick', tickRaw, Number.MAX_SAFE_INTEGER),
    freeze: parseSwitch('freeze', query.get('freeze')),
    night: parseSwitch('night', query.get('night')),
    springs: parseSwitch('springs', query.get('springs')),
  };
}

/**
 * Installs `target.__ssp` when `search` carries `test=1` and returns the hooks; otherwise does nothing at all
 * (the target is not touched) and returns null.
 */
export function installTestHooks(
  target: TestHookTarget,
  search: string,
  host: TestHookHost,
): TestHooks | null {
  const params = readTestParams(search);
  if (params === null) return null;

  let ready = false;
  const counters = createPerfCounters();
  const api: SspTestApi = {
    get ready(): boolean {
      return ready;
    },
    step(n: number): void {
      if (!Number.isSafeInteger(n) || n < 0) {
        throw new RangeError(`__ssp.step(n): n must be a non-negative integer, got ${n}`);
      }
      host.advance(n);
      host.render();
    },
    state(): TestState {
      const c = host.camera();
      const camera: TestCamera = {
        x: c.x,
        y: c.y,
        h: c.h,
        leadX: c.leadX + 0,
        leadY: c.leadY + 0,
        pinned: c.pinned,
      };
      const sim = host.snapshot();
      if (sim !== null) return { ...sim, camera };
      return { tick: host.tick(), camera };
    },
    readFrame(): Uint8Array {
      return host.readFrame();
    },
    setCamera(x: number, y: number, h: number): void {
      host.pinCamera(x, y, h);
      host.render();
    },
    perf(): TestPerf {
      return { drawCalls: host.drawCalls(), renders: host.renders(), ...counters.samples() };
    },
    perfReset(): void {
      counters.reset();
    },
    scene(): string | null {
      return host.sceneId();
    },
    sceneHistory(): string[] {
      return [...host.sceneHistory()];
    },
    boot(): TestBoot {
      const b = host.boot();
      return { status: b.status, error: b.error, lutBuilds: b.lutBuilds };
    },
  };
  target.__ssp = api;
  return {
    params,
    api,
    markReady(): void {
      ready = true;
    },
    recordFrame(frameMs: number, workMs: number): void {
      counters.record(frameMs, workMs);
    },
  };
}
