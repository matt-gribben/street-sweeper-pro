// The fixed 60 Hz loop (TECHNICAL_DESIGN §5.1, SSP-043): a fixed-timestep simulation behind a variable-rate
// renderer. Each display frame adds its (clamped) frame time to an accumulator and runs whole ticks of DT_S out
// of it, at most MAX_STEPS_PER_FRAME per frame; each tick is
//
//   input = sampleForTick()  →  fixedUpdate(input)  →  drainEvents()
//
// (actions.sampleForTick, scenes.fixedUpdate, events.drain in §5.1). The frame starts with beginFrame() (the
// gamepad poll, SSP-044) and ends with
// render(acc / DT_S, frameS). 60, 120 and 144 Hz displays all run 60 ticks per second. Below 12 fps the cap
// drops the backlog (acc is cut to DT_S), so the game slows down instead of spiralling.
//
// This is the only module outside src/debug that reads performance.now() (tests/unit/performanceNow.test.ts).
// The clock and requestAnimationFrame are injected (LoopClock), and the accumulator maths is the pure
// `advance(acc, frameS)`, so unit tests drive the loop with synthetic frame times and no rAF.
//
// Test mode (src/debug/testHooks.ts): `fixedFrameS` makes every display frame exactly that long whatever the
// clock says (1/60 s: one tick per frame, so frames are reproducible), and `frozen` (`freeze=1`, and until
// `ready`) keeps rendering but never steps; `runTicks(n)` + `renderNow()` are what `__ssp.step(n)` calls.
//
// Hidden tabs: browsers stop rAF while a tab is hidden; handleVisibilityChange(false) on resume resets the
// accumulator and the frame clock, so a long absence never turns into a burst of ticks. (The ShiftScene's
// PauseOverlay on hide is SSP-287.)
//
// Allocation: frame() creates no objects, arrays or closures (the callback is bound once and the accumulator is
// one object). V8 may still box a double passed to a callback it does not inline; the zero-allocation rule
// binds src/sim (CLAUDE.md §5.1), and the per-tick work of the SceneManager and the bus stays allocation-free
// once optimised.

import { DT_S, MAX_STEPS_PER_FRAME } from '../sim/constants.ts';
import type { InputFrame } from '../sim/inputFrame.ts';

/** Longest frame time the accumulator accepts, in seconds: the clamp after tab switches and breakpoints. */
export const MAX_FRAME_S = 0.25;

/** The fixed-timestep accumulator: simulated time not yet run as ticks, in seconds. */
export type Accumulator = { accS: number };

/** A new, empty accumulator. */
export function createAccumulator(): Accumulator {
  return { accS: 0 };
}

/**
 * A display frame's duration as the accumulator takes it, in seconds: clamped to [0, MAX_FRAME_S]. Negative
 * and non-finite values (a rAF timestamp from before the clock read that started the loop) count as 0.
 */
export function clampFrameS(frameS: number): number {
  if (!(frameS > 0)) return 0;
  return frameS > MAX_FRAME_S ? MAX_FRAME_S : frameS;
}

/**
 * Adds one display frame of `frameS` seconds (clamped by clampFrameS) to `acc` and returns how many ticks to
 * run now: whole DT_S steps, at most MAX_STEPS_PER_FRAME. If the cap was hit with more than one tick still
 * owed, the backlog is dropped (acc = DT_S): the game slows down instead of spiralling. Afterwards
 * 0 ≤ acc.accS ≤ DT_S, and acc.accS / DT_S is the render interpolation alpha.
 */
export function advance(acc: Accumulator, frameS: number): number {
  acc.accS += clampFrameS(frameS);
  let steps = 0;
  while (acc.accS >= DT_S && steps < MAX_STEPS_PER_FRAME) {
    acc.accS -= DT_S;
    steps += 1;
  }
  if (steps === MAX_STEPS_PER_FRAME && acc.accS > DT_S) acc.accS = DT_S;
  return steps;
}

/** The time source and frame scheduler. The browser's is browserClock(); unit tests pass a fake. */
export type LoopClock = {
  /** Milliseconds on the rAF timestamp clock (performance.now()). */
  now(): number;
  /** Schedules `callback` for the next display frame (requestAnimationFrame); returns a handle. */
  requestFrame(callback: (nowMs: number) => void): number;
  /** Cancels a scheduled frame (cancelAnimationFrame). */
  cancelFrame(handle: number): void;
};

/** The browser clock: performance.now() and requestAnimationFrame. */
export function browserClock(): LoopClock {
  return {
    now: () => performance.now(),
    requestFrame: (callback) => requestAnimationFrame(callback),
    cancelFrame: (handle) => cancelAnimationFrame(handle),
  };
}

/** What the loop drives. Game.ts implements it over the input, the SceneManager, the event bus and the renderer. */
export type LoopTarget = {
  /**
   * Called at the start of every display frame, before its ticks and also while frozen (actions.beginFrame:
   * the gamepad poll and the frame's scene-layer actions, §13.2). Optional.
   */
  beginFrame?(): void;
  /** One InputFrame per tick, edges latched (actions.sampleForTick, TECHNICAL_DESIGN §13.1). */
  sampleForTick(): Readonly<InputFrame>;
  /** Runs one tick (scenes.fixedUpdate: the ShiftScene steps its World). */
  fixedUpdate(input: Readonly<InputFrame>): void;
  /** Dispatches the events the tick just emitted (events.drain on the sim's sealed EventQueue). */
  drainEvents(): void;
  /**
   * Draws one display frame. `alpha` (acc / DT_S, in [0, 1]) interpolates between the last two ticks; `frameS`
   * is the render time that passed since the previous render (clamped; 0 while frozen), for render-only
   * springs such as the camera's.
   */
  render(alpha: number, frameS: number): void;
};

export type LoopOptions = {
  /** Defaults to browserClock(). */
  readonly clock?: LoopClock;
  /** Test mode: every display frame lasts exactly this many seconds, whatever the clock says. Default null. */
  readonly fixedFrameS?: number | null;
  /** Start frozen: frames render but never step (`freeze=1`). Default false. */
  readonly frozen?: boolean;
  /**
   * Called at the end of every frame with the rAF timestamp and the frame callback's CPU time in ms (steps,
   * render submission). Test mode feeds `__ssp.perf()` with it (SSP-023). Default null: the clock is then read
   * only when the loop starts or resumes.
   */
  readonly onFrameTimed?: ((nowMs: number, workMs: number) => void) | null;
};

/** A running (or stopped) fixed-timestep loop. */
export type Loop = {
  /** Starts requesting frames; the accumulator and frame clock start from now. No-op if already running. */
  start(): void;
  /** Stops requesting frames. */
  stop(): void;
  /** One display frame at rAF timestamp `nowMs`. The scheduler calls it; tests call it directly. */
  frame(nowMs: number): void;
  /** Runs `n` ticks synchronously, outside the frame clock (`__ssp.step(n)`, `tick=<n>`). Does not render. */
  runTicks(n: number): void;
  /** Renders now with the current alpha; the render time passed is what runTicks advanced since the last render. */
  renderNow(): void;
  /** Freezes or unfreezes stepping. Unfreezing restarts the accumulator and frame clock from now. */
  setFrozen(frozen: boolean): void;
  /** Wire to `visibilitychange`: on resume (hidden false) the accumulator and frame clock restart from now. */
  handleVisibilityChange(hidden: boolean): void;
  readonly frozen: boolean;
  readonly running: boolean;
  /** Ticks run since the loop was created (frames and runTicks). */
  readonly ticks: number;
  /** Simulated time owed to the next frame, in seconds (0 ≤ accS ≤ DT_S between frames). */
  readonly accS: number;
};

/** Creates a loop over `target`. Call start() to begin. */
export function createLoop(target: LoopTarget, options: LoopOptions = {}): Loop {
  const clock = options.clock ?? browserClock();
  const fixedFrameS = options.fixedFrameS ?? null;
  const onFrameTimed = options.onFrameTimed ?? null;
  const acc = createAccumulator();
  let frozen = options.frozen ?? false;
  let running = false;
  let handle = 0;
  let lastMs = 0;
  let ticks = 0;
  /** Render time run by runTicks() since the last render, handed to the next render. */
  let pendingRenderS = 0;

  function restartClock(): void {
    acc.accS = 0;
    lastMs = clock.now();
  }

  function tick(): void {
    const input = target.sampleForTick();
    target.fixedUpdate(input);
    target.drainEvents();
    ticks += 1;
  }

  function frame(nowMs: number): void {
    const workStartMs = onFrameTimed === null ? 0 : clock.now();
    const rawS = fixedFrameS ?? (nowMs - lastMs) / 1000;
    lastMs = nowMs;
    target.beginFrame?.();
    let frameS = 0;
    if (!frozen) {
      frameS = clampFrameS(rawS);
      const steps = advance(acc, frameS);
      for (let i = 0; i < steps; i += 1) tick();
    }
    const renderS = frameS + pendingRenderS;
    pendingRenderS = 0;
    target.render(acc.accS / DT_S, renderS);
    if (onFrameTimed !== null) onFrameTimed(nowMs, clock.now() - workStartMs);
    if (running) handle = clock.requestFrame(frame);
  }

  return {
    start(): void {
      if (running) return;
      running = true;
      restartClock();
      handle = clock.requestFrame(frame);
    },
    stop(): void {
      if (!running) return;
      running = false;
      clock.cancelFrame(handle);
    },
    frame,
    runTicks(n: number): void {
      if (!Number.isSafeInteger(n) || n < 0) {
        throw new RangeError(`loop.runTicks(n): n must be a non-negative integer, got ${n}`);
      }
      for (let i = 0; i < n; i += 1) tick();
      pendingRenderS += n * DT_S;
    },
    renderNow(): void {
      const renderS = pendingRenderS;
      pendingRenderS = 0;
      target.render(acc.accS / DT_S, renderS);
    },
    setFrozen(on: boolean): void {
      if (frozen === on) return;
      frozen = on;
      if (!on) restartClock();
    },
    handleVisibilityChange(hidden: boolean): void {
      if (!hidden) restartClock();
    },
    get frozen(): boolean {
      return frozen;
    },
    get running(): boolean {
      return running;
    },
    get ticks(): number {
      return ticks;
    },
    get accS(): number {
      return acc.accS;
    },
  };
}
