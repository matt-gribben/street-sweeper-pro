// Zero allocation while emitting past capacity and drawing (SSP-102; TECHNICAL_DESIGN §17 procedure,
// tests/support/heapDelta.ts). Each tick drains a sealed queue holding both brushes' dust clouds, a splash and a
// power-up through the real EventBus into a 64-slot pool, so the pool is full and recycling its oldest particles
// throughout, then draws the frame. A file of its own, like panelsHeap.test.ts: Vitest runs each file in a fresh
// process, so the JIT sees only the bus's payload objects (fx.test.ts's literals would make the emitters
// polymorphic).
import { expect, it } from 'vitest';
import { EventBus } from '../../src/app/events.ts';
import { FxParticles } from '../../src/render/fx.ts';
import { POWERUP_IDS } from '../../src/sim/entities.ts';
import { createEventQueue, EV, emitEvent, resetEvents, sealEvents } from '../../src/sim/eventQueue.ts';
import { assertHeapDeltaWithinThresholds, measureHeapDelta } from '../support/heapDelta.ts';

/** Frames run before measuring, so the emitters and the draw path are optimised (as in panelsHeap.test.ts). */
const WARMUP_FRAMES = 20_000;

it('allocates nothing per tick: four events emitted past capacity through the bus, then the frame drawn', () => {
  const capacity = 64;
  const fx = new FxParticles({ capacity, seed: 7 });
  const bus = new EventBus();
  const bessie = { xM: 10.25, yM: 20.5, headingRad: 0.3 };
  fx.attach(bus, bessie);
  const queue = createEventQueue();
  const swept = new Uint8Array(0);
  const flask = POWERUP_IDS.indexOf('pwr.flask_of_tea');
  const delta = measureHeapDelta(
    (tick) => {
      bessie.headingRad = (tick % 628) * 0.01;
      bessie.yM = 20.5 - (tick % 100) * 0.1;
      resetEvents(queue, tick);
      let i = emitEvent(queue, EV.DustCloud, -1);
      queue.a[i] = bessie.xM + 0.85;
      queue.b[i] = bessie.yM - 1.75;
      queue.c[i] = 1;
      i = emitEvent(queue, EV.DustCloud, -1);
      queue.a[i] = bessie.xM - 0.85;
      queue.b[i] = bessie.yM - 1.75;
      queue.c[i] = -1;
      i = emitEvent(queue, EV.Splash, 0);
      queue.a[i] = bessie.xM;
      queue.b[i] = bessie.yM - 2.2;
      queue.c[i] = 3.5 + (tick % 7) * 0.5;
      i = emitEvent(queue, EV.PowerUp, 0);
      queue.a[i] = bessie.xM + 3.5;
      queue.b[i] = bessie.yM;
      queue.c[i] = flask;
      sealEvents(queue);
      bus.drain(queue);
      fx.trackCleanSweeps(swept, tick);
      fx.update(tick + 1, 0.25);
    },
    { warmupTicks: WARMUP_FRAMES },
  );
  assertHeapDeltaWithinThresholds(delta);
  // Each tick spawned 2 × 3 dust + 11..15 droplets + 6 sparkle particles into 64 slots.
  expect(fx.spawned).toBeGreaterThan(capacity * 1000);
  expect(fx.drawn).toBeGreaterThan(capacity / 2);
});
