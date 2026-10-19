// The test-mode scripted input (SSP-073; TECHNICAL_DESIGN §18.5): `__ssp.loadInputs` replays a replay's input log by
// World tick through it. Before a log is loaded it is the live source; with one loaded, World tick t gets the log's
// frame t, neutral past the log's end and while no World runs, and the live source is still polled and sampled.
import { describe, expect, it } from 'vitest';
import type { TickInputSource } from '../../src/app/Game.ts';
import { ScriptedInput } from '../../src/debug/scriptedInput.ts';
import { createInputFrame, type InputFrame } from '../../src/sim/inputFrame.ts';
import { appendInput, createInputLog, type InputLog } from '../../src/sim/replay.ts';

/** A live source that returns full right lock and counts its calls. */
function liveSource(): TickInputSource & { begins: number; samples: number } {
  const frame: InputFrame = { throttle: 7, brake: 0, steer: 127, buttons: 0, pressed: 1 };
  const source = {
    begins: 0,
    samples: 0,
    beginFrame(): void {
      source.begins += 1;
    },
    sampleForTick(): Readonly<InputFrame> {
      source.samples += 1;
      return frame;
    },
  };
  return source;
}

/** A log whose frame t has throttle t + 1 and steer −t. */
function rampLog(ticks: number): InputLog {
  const log = createInputLog(ticks);
  for (let t = 0; t < ticks; t++) {
    appendInput(log, t, { throttle: t + 1, brake: 0, steer: -t, buttons: t % 2, pressed: 0 });
  }
  return log;
}

describe('ScriptedInput', () => {
  it('passes the live source through until a log is loaded', () => {
    const live = liveSource();
    const scripted = new ScriptedInput(live, () => 0);
    expect(scripted.scripted).toBe(false);
    expect(scripted.ticks).toBe(0);
    scripted.beginFrame();
    expect(live.begins).toBe(1);
    expect(scripted.sampleForTick()).toEqual({ throttle: 7, brake: 0, steer: 127, buttons: 0, pressed: 1 });
    expect(live.samples).toBe(1);
  });

  it('feeds World tick t the log frame t, whatever the live source says', () => {
    const live = liveSource();
    let tick: number | null = 0;
    const scripted = new ScriptedInput(live, () => tick);
    scripted.load(rampLog(5));
    expect(scripted.scripted).toBe(true);
    expect(scripted.ticks).toBe(5);
    const seen: InputFrame[] = [];
    for (const t of [0, 1, 2, 4, 3]) {
      tick = t;
      seen.push({ ...scripted.sampleForTick() });
    }
    expect(seen.map((f) => f.throttle)).toEqual([1, 2, 3, 5, 4]);
    expect(seen.map((f) => f.steer)).toEqual([0, -1, -2, -4, -3]);
    expect(seen.map((f) => f.buttons)).toEqual([0, 1, 0, 0, 1]);
    // The live devices are still sampled every tick (their edges are taken, not left latched).
    expect(live.samples).toBe(5);
    scripted.beginFrame();
    expect(live.begins).toBe(1);
  });

  it('is neutral past the end of the log and while no World runs', () => {
    let tick: number | null = 5;
    const scripted = new ScriptedInput(liveSource(), () => tick);
    scripted.load(rampLog(5));
    expect(scripted.sampleForTick()).toEqual(createInputFrame());
    tick = 3;
    expect(scripted.sampleForTick().throttle).toBe(4);
    tick = null;
    expect(scripted.sampleForTick()).toEqual(createInputFrame());
  });

  it('replaces a loaded log with the next one', () => {
    const scripted = new ScriptedInput(liveSource(), () => 0);
    scripted.load(rampLog(3));
    scripted.load(createInputLog(0));
    expect(scripted.ticks).toBe(0);
    expect(scripted.sampleForTick()).toEqual(createInputFrame());
  });
});
