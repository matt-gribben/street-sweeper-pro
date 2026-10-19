// Scripted sim input for test mode (TECHNICAL_DESIGN §18.5, SSP-073): `__ssp.loadInputs(inputs, ticks)` hands a
// replay's input log to the Game, and from then on every tick's InputFrame comes from that log instead of the
// keyboard and gamepad. It is how tests/e2e/smoke.spec.ts drives a canned route in the shipping bundle without
// real key events in wall-clock time (slower and flakier).
//
// The log is indexed by the World's tick, exactly as a replay is (`runReplay`: frame t feeds World tick t), so a
// log loaded at World tick 0 replays the file's run bit for bit; past the log's end, and while no World runs (the
// intro card, the tally), the frame is neutral. The live devices are still polled and sampled every tick, so
// their latched edges never pile up, but their frame is dropped. Menu scenes read their edges from the devices
// directly (actions.takeMenuEdges), never from the InputFrame, so they keep working with a log loaded.
//
// Created only in test mode (Game.ts); it never exists in a normal run. sampleForTick() allocates nothing.
import type { TickInputSource } from '../app/Game.ts';
import { createInputFrame, type InputFrame } from '../sim/inputFrame.ts';
import { type InputLog, readInput } from '../sim/replay.ts';

/** The World tick the next sampled frame feeds, or null when no World is running. */
export type SimTickSource = () => number | null;

/** A TickInputSource that replays a loaded input log by World tick, and passes the live input through before. */
export class ScriptedInput implements TickInputSource {
  private readonly live: TickInputSource;
  private readonly simTick: SimTickSource;
  private log: InputLog | null = null;
  /** The frame returned while a log is loaded, rewritten every tick. */
  private readonly frame: InputFrame = createInputFrame();

  constructor(live: TickInputSource, simTick: SimTickSource) {
    this.live = live;
    this.simTick = simTick;
  }

  /** True once a log is loaded: the live devices no longer reach the sim. */
  get scripted(): boolean {
    return this.log !== null;
  }

  /** Ticks in the loaded log (0 when none is loaded). */
  get ticks(): number {
    return this.log?.length ?? 0;
  }

  /** Replays `log` from the next tick on, replacing any log loaded before. */
  load(log: InputLog): void {
    this.log = log;
  }

  beginFrame(): void {
    this.live.beginFrame?.();
  }

  sampleForTick(): Readonly<InputFrame> {
    const liveFrame = this.live.sampleForTick();
    const log = this.log;
    if (log === null) return liveFrame;
    const frame = this.frame;
    const tick = this.simTick();
    if (tick !== null && tick >= 0 && tick < log.length) {
      readInput(log, tick, frame);
    } else {
      frame.throttle = 0;
      frame.brake = 0;
      frame.steer = 0;
      frame.buttons = 0;
      frame.pressed = 0;
    }
    return frame;
  }
}
