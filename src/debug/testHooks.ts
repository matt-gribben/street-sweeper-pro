// Test hooks (TECHNICAL_DESIGN §18.5). Active ONLY with `?test=1`: this module ships in release builds (so
// Playwright tests the shipping bundle) but installs nothing without the flag. Never ship behaviour that
// depends on it (CLAUDE.md §5.1).
//
// URL parameters, all optional after `test=1`:
//   seed=<n>    run seed, an unsigned 32-bit integer (no sim reads it until M1);
//   scene=<id>  boot straight into a scene (`lean_quadrants`, `scale_1440`; main.ts dispatches);
//   tick=<n>    advance n ticks synchronously after load, before `ready` turns true;
//   freeze=1    the loop keeps rendering but never steps;
//   night=1     the palette pass applies the night remap outside the light mask, and scenes draw their light
//               pools (SSP-021; `lean_quadrants` hangs one under each lamp post).
// Malformed values throw at boot: a test must never run against a silently defaulted parameter.
//
// `window.__ssp`:
//   ready         true once assets are loaded and the first complete frame is rendered; specs wait for it;
//   step(n)       advance n ticks, then render once;
//   state()       a JSON-safe snapshot;
//   readFrame()   the raw W×270 palette-mapped RGBA frame, row 0 at the top (Renderer.readFrame);
//   setCamera()   pin the render camera at (x, y) sim metres and height h metres, springs off for good;
//   perf()        draw calls of the last rendered frame (all passes) plus the frame timings recorded since
//                 the last perfReset(): rAF timestamp deltas and frame-callback CPU time (perfCounters.ts);
//   perfReset()   clears the recorded timings (start of a perf sampling window).
//
// M0 STUBS: there is no sim yet, so a "tick" is one render frame (the counter that drives the spike actors'
// heading cycle and brush spin, at a fixed 1/60 s render step). step(n) advances that counter and renders
// once, and state() returns only { tick, camera }. SSP-046 binds step() and state() to the World in M1:
// step(n) then runs n fixed sim ticks and state() returns the full SimSnapshot (score, tidy, hopper, hp,
// tick, positions).
//
// Timings are recorded by main.ts once `ready` is true, one sample per requestAnimationFrame callback; they are
// read-only observations and never feed back into what is drawn. tests/e2e/perf.spec.ts reads them (SSP-023).
//
// Test mode also turns off what would make frames depend on timing (main.ts): the speed-zoom spring (and
// look-ahead, from M1) unless a scene opts in, wall-clock frame times (a fixed 1/60 s render step instead) and
// the dev panel. There is no audio before M5; M5's mixer must stay silent in test mode.

/** Fixed render step in test mode, in seconds (one "tick" in M0). */
export const TEST_RENDER_STEP_S = 1 / 60;

/** Largest `seed`: sfc32 seeds are unsigned 32-bit integers. */
export const MAX_SEED = 0xffff_ffff;

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
};

/** Camera part of {@link TestState}: focus in sim metres, height in metres. */
export type TestCamera = {
  readonly x: number;
  readonly y: number;
  readonly h: number;
  /** True once setCamera() pinned it (springs off). */
  readonly pinned: boolean;
};

/** M0 stub of the SimSnapshot that state() returns (SSP-046 replaces it with the World's snapshot). */
export type TestState = {
  /** Ticks stepped so far: render frames in M0. */
  readonly tick: number;
  readonly camera: TestCamera;
};

/** What `__ssp.perf()` returns: JSON-safe, so it crosses `page.evaluate`. */
export type TestPerf = PerfSamples & {
  /** Draw calls of the last rendered frame over every pass (`renderer.info.render.calls`, §12.7). */
  readonly drawCalls: number;
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
};

/** What the hooks drive: implemented by main.ts over the renderer and its frame loop. */
export type TestHookHost = {
  /** The tick counter (the render-frame counter in M0). */
  tick(): number;
  /** Advances `n` ticks (fixed render steps) without drawing. */
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
 * value, or none, means test mode is off); throws on a malformed seed, scene, tick, freeze or night.
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
      const camera = host.camera();
      return {
        tick: host.tick(),
        camera: { x: camera.x, y: camera.y, h: camera.h, pinned: camera.pinned },
      };
    },
    readFrame(): Uint8Array {
      return host.readFrame();
    },
    setCamera(x: number, y: number, h: number): void {
      host.pinCamera(x, y, h);
      host.render();
    },
    perf(): TestPerf {
      return { drawCalls: host.drawCalls(), ...counters.samples() };
    },
    perfReset(): void {
      counters.reset();
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
