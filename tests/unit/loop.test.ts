// The fixed 60 Hz loop (SSP-043, TECHNICAL_DESIGN §5.1): the pure accumulator (`advance`), and the loop driven
// by a fake clock (no rAF): step counts at 30/60/144 Hz, the 0.25 s clamp, the 5-step cap and backlog drop,
// render interpolation, freeze mode with `__ssp.step(n)`, the visibility reset, and events reaching the bus
// once, in emission order, right after the tick that emitted them.
import { describe, expect, it } from 'vitest';
import { EventBus, type SimEvent } from '../../src/app/events.ts';
import {
  advance,
  clampFrameS,
  createAccumulator,
  createLoop,
  type LoopClock,
  type LoopTarget,
  MAX_FRAME_S,
} from '../../src/app/loop.ts';
import { type Scene, SceneManager } from '../../src/app/SceneManager.ts';
import { installTestHooks, type TestHookTarget } from '../../src/debug/testHooks.ts';
import { DT_S, MAX_STEPS_PER_FRAME } from '../../src/sim/constants.ts';
import {
  createEventQueue,
  EV,
  type EventType,
  pushEvent,
  resetEvents,
  sealEvents,
} from '../../src/sim/eventQueue.ts';
import { createInputFrame, type InputFrame } from '../../src/sim/inputFrame.ts';

/** Runs `frames` frames of `frameS` through advance() and returns the step count of each. */
function stepsPerFrame(frameS: number, frames: number): number[] {
  const acc = createAccumulator();
  const steps: number[] = [];
  for (let i = 0; i < frames; i++) steps.push(advance(acc, frameS));
  return steps;
}

function sum(values: readonly number[]): number {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

describe('advance (the accumulator)', () => {
  it('gives 2 steps per frame for 1/30 s frames', () => {
    const acc = createAccumulator();
    for (let i = 0; i < 300; i++) {
      expect(advance(acc, 1 / 30)).toBe(2);
      expect(acc.accS).toBeLessThan(DT_S);
    }
  });

  it('gives 1 step per frame for 1/60 s frames', () => {
    expect(stepsPerFrame(1 / 60, 600)).toEqual(new Array(600).fill(1));
  });

  it('averages 60 steps per simulated second for 1/144 s frames over 10 s', () => {
    const steps = stepsPerFrame(1 / 144, 1440);
    // Each 144 Hz frame runs 0 or 1 tick: the sim never runs ahead of the display by more than one tick.
    expect(steps.every((s) => s === 0 || s === 1)).toBe(true);
    const total = sum(steps);
    // 10 s of frames owe exactly 600 ticks; floating-point rounding may leave the last one in the accumulator.
    expect(total).toBeGreaterThanOrEqual(599);
    expect(total).toBeLessThanOrEqual(600);
    expect(total / 10).toBeCloseTo(60, 0);
    // And every whole second on its own runs 60 ± 1 ticks.
    for (let s = 0; s < 10; s++) {
      const second = sum(steps.slice(s * 144, (s + 1) * 144));
      expect(Math.abs(second - 60)).toBeLessThanOrEqual(1);
    }
  });

  it('averages 60 steps per second at 120 Hz too', () => {
    const total = sum(stepsPerFrame(1 / 120, 1200));
    expect(total).toBeGreaterThanOrEqual(599);
    expect(total).toBeLessThanOrEqual(600);
  });

  it('clamps a 1 s frame to 0.25 s, runs at most 5 steps and leaves acc <= DT', () => {
    expect(clampFrameS(1)).toBe(MAX_FRAME_S);
    expect(MAX_FRAME_S).toBe(0.25);
    const acc = createAccumulator();
    expect(advance(acc, 1)).toBe(MAX_STEPS_PER_FRAME);
    expect(MAX_STEPS_PER_FRAME).toBe(5);
    expect(acc.accS).toBeLessThanOrEqual(DT_S);
    // The clamp alone would leave 0.25 − 5/60 s (10 ticks) owed: the backlog drop cut it to one tick.
    expect(acc.accS).toBe(DT_S);
  });

  it('caps steps at 5 and drops the backlog instead of spiralling (slow motion below 12 fps)', () => {
    const acc = createAccumulator();
    // 8 fps: 7.5 ticks owed per frame, 5 run; the rest is dropped every frame, so the backlog never grows.
    for (let i = 0; i < 100; i++) {
      expect(advance(acc, 1 / 8)).toBe(5);
      expect(acc.accS).toBeLessThanOrEqual(DT_S);
    }
    // At exactly 12 fps the cap is just enough: 5 ticks per frame keeps real time.
    expect(sum(stepsPerFrame(1 / 12, 120))).toBeGreaterThanOrEqual(599);
  });

  it('keeps a partial tick for the next frame and exposes it as the render alpha', () => {
    const acc = createAccumulator();
    expect(advance(acc, 1.5 * DT_S)).toBe(1);
    expect(acc.accS / DT_S).toBeCloseTo(0.5, 12);
    expect(advance(acc, 0.5 * DT_S)).toBe(1);
    expect(acc.accS).toBeCloseTo(0, 12);
  });

  it('treats negative, zero and non-finite frame times as no time', () => {
    const acc = createAccumulator();
    for (const ft of [-1, -0.001, 0, Number.NaN, Number.NEGATIVE_INFINITY]) {
      expect(advance(acc, ft)).toBe(0);
      expect(acc.accS).toBe(0);
    }
    expect(clampFrameS(Number.POSITIVE_INFINITY)).toBe(MAX_FRAME_S);
  });
});

/** A fake clock: frames run only when the test calls `runFrame(nowMs)`. */
function fakeClock(): LoopClock & {
  nowMs: number;
  pending: ((nowMs: number) => void) | null;
  runFrame(nowMs: number): void;
} {
  const clock = {
    nowMs: 0,
    pending: null as ((nowMs: number) => void) | null,
    now: () => clock.nowMs,
    requestFrame(callback: (nowMs: number) => void): number {
      clock.pending = callback;
      return 1;
    },
    cancelFrame(): void {
      clock.pending = null;
    },
    runFrame(nowMs: number): void {
      const callback = clock.pending;
      if (callback === null) throw new Error('no frame requested');
      clock.pending = null;
      clock.nowMs = nowMs;
      callback(nowMs);
    },
  };
  return clock;
}

/** A target that logs ticks and renders. */
function recordingTarget(): LoopTarget & {
  log: string[];
  ticks: number;
  renders: number;
  alphas: number[];
  renderS: number[];
} {
  const input = createInputFrame();
  const target = {
    log: [] as string[],
    ticks: 0,
    renders: 0,
    alphas: [] as number[],
    renderS: [] as number[],
    sampleForTick: () => {
      target.log.push('input');
      return input;
    },
    fixedUpdate: () => {
      target.ticks += 1;
      target.log.push('update');
    },
    drainEvents: () => {
      target.log.push('drain');
    },
    render: (alpha: number, frameS: number) => {
      target.renders += 1;
      target.alphas.push(alpha);
      target.renderS.push(frameS);
      target.log.push('render');
    },
  };
  return target;
}

/** Runs `frames` display frames at `hz` from t = 0 and returns the ticks run. */
function runAtHz(hz: number, frames: number): { ticks: number; renders: number } {
  const clock = fakeClock();
  const target = recordingTarget();
  const loop = createLoop(target, { clock });
  loop.start();
  for (let i = 1; i <= frames; i++) clock.runFrame((i * 1000) / hz);
  return { ticks: target.ticks, renders: target.renders };
}

describe('createLoop with an injected clock', () => {
  it('runs 60 ticks per second on 30, 60, 120 and 144 Hz displays, rendering once per frame', () => {
    for (const hz of [30, 60, 120, 144]) {
      const { ticks, renders } = runAtHz(hz, hz * 10);
      expect(renders, `${hz} Hz renders`).toBe(hz * 10);
      expect(ticks, `${hz} Hz ticks over 10 s`).toBeGreaterThanOrEqual(599);
      expect(ticks, `${hz} Hz ticks over 10 s`).toBeLessThanOrEqual(600);
    }
  });

  it('runs each tick as input, update, drain, and renders once after the steps', () => {
    const clock = fakeClock();
    const target = recordingTarget();
    const loop = createLoop(target, { clock });
    loop.start();
    clock.runFrame(1000 / 30 + 0.001);
    expect(target.log).toEqual(['input', 'update', 'drain', 'input', 'update', 'drain', 'render']);
    expect(loop.ticks).toBe(2);
  });

  it('calls beginFrame once at the start of every frame, before its ticks, frozen or not (SSP-044)', () => {
    const clock = fakeClock();
    const target = recordingTarget();
    const loop = createLoop({ ...target, beginFrame: () => target.log.push('begin') }, { clock });
    loop.start();
    clock.runFrame(1000 / 30 + 0.001);
    clock.runFrame(1000 / 30 + 0.002); // no tick owed
    expect(target.log).toEqual([
      'begin',
      'input',
      'update',
      'drain',
      'input',
      'update',
      'drain',
      'render',
      'begin',
      'render',
    ]);
    target.log.length = 0;
    loop.setFrozen(true);
    clock.runFrame(1000);
    loop.runTicks(2); // __ssp.step(n) runs ticks without a frame: no poll
    expect(target.log).toEqual(['begin', 'render', 'input', 'update', 'drain', 'input', 'update', 'drain']);
  });

  it('clamps a 1 s hitch to 5 ticks and passes the clamped frame time to render', () => {
    const clock = fakeClock();
    const target = recordingTarget();
    const loop = createLoop(target, { clock });
    loop.start();
    clock.runFrame(1000);
    expect(target.ticks).toBe(5);
    expect(loop.accS).toBeLessThanOrEqual(DT_S);
    expect(target.renderS).toEqual([MAX_FRAME_S]);
    expect(target.alphas[0]).toBeLessThanOrEqual(1);
  });

  it('hands render the interpolation alpha acc / DT', () => {
    const clock = fakeClock();
    const target = recordingTarget();
    const loop = createLoop(target, { clock });
    loop.start();
    clock.runFrame(1.25 * DT_S * 1000);
    expect(target.ticks).toBe(1);
    expect(target.alphas[0]).toBeCloseTo(0.25, 9);
  });

  it('stops requesting frames after stop() and restarts its clock on start()', () => {
    const clock = fakeClock();
    const target = recordingTarget();
    const loop = createLoop(target, { clock });
    loop.start();
    expect(loop.running).toBe(true);
    clock.runFrame(DT_S * 1000 + 0.001);
    loop.stop();
    expect(clock.pending).toBeNull();
    expect(loop.running).toBe(false);
    clock.nowMs = 60_000;
    loop.start();
    clock.runFrame(60_000 + DT_S * 1000 + 0.001);
    expect(target.ticks).toBe(2);
  });

  it('with fixedFrameS (test mode) runs exactly one tick per frame whatever the timestamps say', () => {
    const clock = fakeClock();
    const target = recordingTarget();
    const loop = createLoop(target, { clock, fixedFrameS: DT_S });
    loop.start();
    const stamps = [3, 5, 400, 401, 2000, 2001, 9000];
    for (const ms of stamps) clock.runFrame(ms);
    expect(target.ticks).toBe(stamps.length);
    expect(target.alphas.every((a) => a === 0)).toBe(true);
    expect(target.renderS.every((s) => s === DT_S)).toBe(true);
  });

  it('resets the accumulator when the tab becomes visible again', () => {
    const clock = fakeClock();
    const target = recordingTarget();
    const loop = createLoop(target, { clock });
    loop.start();
    clock.runFrame(DT_S * 1000 * 1.5);
    expect(target.ticks).toBe(1);
    expect(loop.accS).toBeGreaterThan(0);
    // Hidden for 30 s: rAF stops. On resume the backlog is discarded and the frame clock restarts from now.
    loop.handleVisibilityChange(true);
    clock.nowMs = 30_000;
    loop.handleVisibilityChange(false);
    expect(loop.accS).toBe(0);
    clock.runFrame(30_000 + DT_S * 1000);
    expect(target.ticks).toBe(2);
  });

  it('a rAF timestamp from before the start counts as no time', () => {
    const clock = fakeClock();
    clock.nowMs = 1000;
    const target = recordingTarget();
    const loop = createLoop(target, { clock });
    loop.start();
    clock.runFrame(995);
    expect(target.ticks).toBe(0);
    expect(target.renders).toBe(1);
  });

  it('reports each frame timing with the CPU time of the callback', () => {
    const clock = fakeClock();
    const timings: [number, number][] = [];
    const target = recordingTarget();
    const render = target.render;
    target.render = (alpha, frameS) => {
      clock.nowMs += 2; // the frame's work takes 2 ms on the fake clock
      render(alpha, frameS);
    };
    const loop = createLoop(target, {
      clock,
      onFrameTimed: (nowMs, workMs) => timings.push([nowMs, workMs]),
    });
    loop.start();
    clock.runFrame(16);
    clock.runFrame(33);
    expect(timings).toEqual([
      [16, 2],
      [33, 2],
    ]);
  });

  it('rejects a negative or fractional runTicks count', () => {
    const loop = createLoop(recordingTarget(), { clock: fakeClock() });
    expect(() => loop.runTicks(-1)).toThrow(RangeError);
    expect(() => loop.runTicks(1.5)).toThrow(RangeError);
  });
});

describe('freeze mode', () => {
  it('renders every frame but never steps until runTicks(n) runs exactly n ticks', () => {
    const clock = fakeClock();
    const target = recordingTarget();
    const loop = createLoop(target, { clock, frozen: true });
    loop.start();
    for (let i = 1; i <= 120; i++) clock.runFrame(i * 50); // 20 Hz frames: 3 ticks each if not frozen
    expect(target.renders).toBe(120);
    expect(target.ticks).toBe(0);
    expect(target.renderS.every((s) => s === 0)).toBe(true);

    loop.runTicks(7);
    expect(target.ticks).toBe(7);
    expect(target.renders).toBe(120);
    loop.renderNow();
    expect(target.renders).toBe(121);
    // The render after runTicks gets the render time those ticks covered; the next frame gets none.
    expect(target.renderS[120]).toBeCloseTo(7 * DT_S, 12);
    clock.runFrame(10_000);
    expect(target.ticks).toBe(7);
    expect(target.renderS[121]).toBe(0);
  });

  it('drives window.__ssp.step(n): exactly n ticks, then one render', () => {
    const clock = fakeClock();
    const target = recordingTarget();
    const loop = createLoop(target, { clock, fixedFrameS: DT_S, frozen: true });
    const window: TestHookTarget = {};
    const hooks = installTestHooks(window, '?test=1&freeze=1', {
      tick: () => loop.ticks,
      advance: (n) => loop.runTicks(n),
      render: () => loop.renderNow(),
      readFrame: () => new Uint8Array(4),
      pinCamera: () => {},
      camera: () => ({ x: 0, y: 0, h: 31.5, leadX: 0, leadY: 0, pinned: false }),
      drawCalls: () => 0,
      snapshot: () => null,
      renders: () => 0,
      sceneId: () => null,
      sceneHistory: () => [],
    });
    expect(hooks?.params.freeze).toBe(true);
    loop.start();
    clock.runFrame(16);
    clock.runFrame(33);
    expect(target.ticks).toBe(0);
    const api = window.__ssp;
    if (api === undefined) throw new Error('hooks not installed');
    target.log.length = 0;
    api.step(3);
    expect(target.ticks).toBe(3);
    expect(api.state().tick).toBe(3);
    expect(target.log).toEqual([...new Array(3).fill(['input', 'update', 'drain']).flat(), 'render']);
    clock.runFrame(50);
    expect(target.ticks).toBe(3);
  });

  it('unfreezing restarts the clock: the frozen time is not owed as ticks', () => {
    const clock = fakeClock();
    const target = recordingTarget();
    const loop = createLoop(target, { clock, frozen: true });
    loop.start();
    clock.runFrame(5000);
    clock.nowMs = 5000;
    loop.setFrozen(false);
    expect(loop.frozen).toBe(false);
    clock.runFrame(5000 + DT_S * 1000);
    expect(target.ticks).toBe(1);
  });
});

/**
 * A scene with a sim-like EventQueue: each tick emits the event types in `script(tick)` (payload a = tick,
 * b = index within the tick). Logs its ticks and renders to `log`, unless `log` is null.
 */
class EmittingScene implements Scene {
  readonly id = 'shift';
  readonly blocksUpdateBelow = false;
  readonly simEvents = createEventQueue();
  private readonly script: (tick: number) => readonly EventType[];
  private readonly log: string[] | null;
  private tick = 0;
  constructor(script: (tick: number) => readonly EventType[], log: string[] | null) {
    this.script = script;
    this.log = log;
  }
  async enter(): Promise<void> {}
  exit(): void {}
  fixedUpdate(_input: Readonly<InputFrame>): void {
    const queue = this.simEvents;
    resetEvents(queue, this.tick);
    this.log?.push(`tick ${this.tick}`);
    const types = this.script(this.tick);
    for (let i = 0; i < types.length; i++) pushEvent(queue, types[i] ?? EV.Impact, -1, this.tick, i, 0);
    sealEvents(queue);
    this.tick += 1;
  }
  render(): void {
    this.log?.push('render');
  }
}

/** An overlay that freezes everything under it (the PauseOverlay shape, SSP-287). */
class BlockingOverlay implements Scene {
  readonly id = 'pause';
  readonly blocksUpdateBelow = true;
  readonly simEvents = null;
  async enter(): Promise<void> {}
  exit(): void {}
  fixedUpdate(): void {}
  render(): void {}
}

function describeEvent(e: SimEvent): string {
  return `ev ${e.type}@${e.tick}`;
}

describe('events through the loop', () => {
  it('reach subscribers once, in emission order, right after the tick that emitted them', async () => {
    const log: string[] = [];
    const scenes = new SceneManager();
    const bus = new EventBus();
    const script = (tick: number): readonly EventType[] =>
      tick === 0 ? [EV.KerbJolt, EV.Impact, EV.KerbJolt] : tick === 1 ? [] : [EV.ReverseBeeper, EV.Impact];
    await scenes.push(new EmittingScene(script, log), { seed: 1 });
    bus.onAny((e) => log.push(describeEvent(e)));
    bus.on(EV.Impact, (e) => log.push(`impact ${e.tick} #${e.y}`));

    const clock = fakeClock();
    const input = createInputFrame();
    const loop = createLoop(
      {
        sampleForTick: () => input,
        fixedUpdate: (frame) => scenes.fixedUpdate(frame),
        drainEvents: () => scenes.drainEvents(bus),
        render: (alpha) => scenes.render(alpha),
      },
      { clock },
    );
    loop.start();
    clock.runFrame(2 * DT_S * 1000 + 0.001); // ticks 0 and 1
    clock.runFrame(3 * DT_S * 1000 + 0.001); // tick 2
    clock.runFrame(3 * DT_S * 1000 + 0.002); // no tick: nothing re-dispatched
    expect(log).toEqual([
      'tick 0',
      'ev 2@0',
      'impact 0 #1',
      'ev 1@0',
      'ev 2@0',
      'tick 1',
      'render',
      'tick 2',
      'ev 3@2',
      'impact 2 #1',
      'ev 1@2',
      'render',
      'render',
    ]);

    // Under a blocking overlay the scene neither ticks nor has its last tick drained again.
    await scenes.push(new BlockingOverlay(), { seed: 1 });
    log.length = 0;
    clock.runFrame(5 * DT_S * 1000 + 0.002);
    expect(log).toEqual(['render']);
  });
});
