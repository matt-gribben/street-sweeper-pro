// The fx_puddle drive (SSP-102), planned in Node for the Playwright specs: compiled Puddle Lane with FX_PUDDLE placed
// (src/scenes/FxPuddleScene.ts withFxPuddle, the same level the scene builds), and an input log holding full throttle,
// brush up, from the depot start north up Mangle Street. runReplay finds the tick whose EV.Splash is the placed
// puddle's, so a spec can step the page to just after it (the sim is f(seed, level, inputs) in Node and Chromium).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EventBus } from '../../src/app/events.ts';
import { FX_INSTANCE_STRIDE, FxParticles, fxRenderSeed } from '../../src/render/fx.ts';
import { FX_PUDDLE, withFxPuddle } from '../../src/scenes/FxPuddleScene.ts';
import { EV } from '../../src/sim/eventQueue.ts';
import { createInputFrame } from '../../src/sim/inputFrame.ts';
import { decodeLevel, type Level } from '../../src/sim/map.ts';
import { appendInput, createInputLog, encodeInputs, type InputLog, runReplay } from '../../src/sim/replay.ts';
import { DEFAULT_TUNING } from '../../src/sim/tuning.ts';

/** Ticks of throttle in the log: enough to reach the puddle 18 m north of the start and drive on past it. */
export const FX_PUDDLE_DRIVE_TICKS = 300;

export type FxPuddlePlan = {
  readonly level: Level;
  readonly log: InputLog;
  /** The log as `__ssp.loadInputs` takes it. */
  readonly inputs: string;
  /** The tick that emitted the placed puddle's EV.Splash. */
  readonly splashTick: number;
  /** |vLong| on that tick (the event's speedMps), m/s. */
  readonly splashSpeedMps: number;
};

/** Plans the fx_puddle drive on `seed`; throws if the drive never splashes the placed puddle. */
export function planFxPuddle(seed: number): FxPuddlePlan {
  const compiled = readFileSync(
    fileURLToPath(new URL('../../public/assets/levels/puddle_lane.json', import.meta.url)),
    'utf8',
  );
  const level = withFxPuddle(decodeLevel(compiled));
  const log = createInputLog(FX_PUDDLE_DRIVE_TICKS);
  const frame = createInputFrame();
  frame.throttle = 255;
  for (let t = 0; t < FX_PUDDLE_DRIVE_TICKS; t++) appendInput(log, t, frame);
  let splashTick = -1;
  let splashSpeedMps = 0;
  runReplay(level, DEFAULT_TUNING, seed, log, FX_PUDDLE_DRIVE_TICKS, (world) => {
    const events = world.events;
    for (let i = 0; i < events.count; i++) {
      if (events.type[i] !== EV.Splash) continue;
      if (events.a[i] === FX_PUDDLE.x && events.b[i] === FX_PUDDLE.y && splashTick < 0) {
        splashTick = events.tick;
        splashSpeedMps = events.c[i] as number;
      }
    }
  });
  if (splashTick < 0) throw new Error(`fx_puddle: seed ${seed}'s drive never splashed the placed puddle`);
  return { level, log, inputs: encodeInputs(log), splashTick, splashSpeedMps };
}

/** One particle the fx draws, as ShiftScene would draw it: sim metres, size px, palette index. */
export type PredictedParticle = {
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly colour: number;
};

/**
 * The particles ShiftScene draws after `ticks` ticks of the plan at render `alpha`, worked out in Node: the same
 * FxParticles (render seed fxRenderSeed(seed), the tuning's front axle and half width, the level's frontages) fed
 * as the scene feeds it (each tick: Clean Sweep flags, then the tick's events through an EventBus, Bessie read at
 * drain time), then update(ticks, alpha). Also returns Bessie's pose after the last tick.
 */
export function predictFx(
  plan: FxPuddlePlan,
  seed: number,
  ticks: number,
  alpha: number,
): { particles: PredictedParticle[]; bessie: { x: number; y: number; headingRad: number } } {
  const body = DEFAULT_TUNING.vehicle.sweeper.body;
  const fx = new FxParticles({
    seed: fxRenderSeed(seed),
    frontAxleM: body.frontAxleOffsetM,
    halfWidthM: body.widthM / 2,
    frontages: plan.level.frontages,
  });
  const bus = new EventBus();
  let attached = false;
  const run = runReplay(plan.level, DEFAULT_TUNING, seed, plan.log, ticks, (world) => {
    if (!attached) {
      fx.attach(bus, world.vehicle);
      attached = true;
    }
    fx.trackCleanSweeps(world.tidy.cleanSwept, world.tick - 1);
    bus.drain(world.events);
  });
  const n = fx.update(run.world.tick, alpha);
  const d = fx.instanceData;
  const particles: PredictedParticle[] = [];
  for (let k = 0; k < n; k++) {
    const o = k * FX_INSTANCE_STRIDE;
    particles.push({
      x: d[o] as number,
      y: d[o + 1] as number,
      size: d[o + 2] as number,
      colour: d[o + 3] as number,
    });
  }
  fx.dispose();
  const v = run.world.vehicle;
  return { particles, bessie: { x: v.xM, y: v.yM, headingRad: v.headingRad } };
}
