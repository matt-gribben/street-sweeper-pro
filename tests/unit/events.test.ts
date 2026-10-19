// The typed event bus (SSP-043, TECHNICAL_DESIGN §7.2): decoding every EV type, dispatch order (emission
// order; a type's listeners before the onAny listeners), exactly-once per sealed tick, unsubscription during
// dispatch, and the errors for an unsealed queue or an event the bus cannot decode.
import { describe, expect, it } from 'vitest';
import { EventBus, type SimEvent } from '../../src/app/events.ts';
import { LITTER_IDS, STAIN_IDS } from '../../src/sim/entities.ts';
import {
  createEventQueue,
  EV,
  type EventQueue,
  pushEvent,
  type ReadonlyEventQueue,
  resetEvents,
  ShiftEndReason,
  sealEvents,
} from '../../src/sim/eventQueue.ts';

/** A sealed queue for `tick` holding `events` ([type, entity, a, b, c]). */
function sealedQueue(
  tick: number,
  events: readonly (readonly [number, number, number, number, number])[],
  queue: EventQueue = createEventQueue(),
): EventQueue {
  resetEvents(queue, tick);
  for (const [type, entity, a, b, c] of events) {
    pushEvent(queue, type as (typeof EV)[keyof typeof EV], entity, a, b, c);
  }
  sealEvents(queue);
  return queue;
}

/** A plain copy of an event (the bus reuses its payload objects). */
function copy(event: SimEvent): SimEvent {
  return { ...event };
}

describe('EventBus', () => {
  it('decodes every M1, M2 and M3 event type into its typed payload', () => {
    const bus = new EventBus();
    const seen: SimEvent[] = [];
    bus.onAny((e) => seen.push(copy(e)));
    const queue = sealedQueue(42, [
      [EV.Impact, -1, 1.5, -2.25, 4.75],
      [EV.KerbJolt, -1, 3, 4, 2.5],
      [EV.ReverseBeeper, -1, 7, 8, 0],
      [EV.ShiftEnd, -1, ShiftEndReason.Towed, 0, 0],
      [EV.HopperFull, -1, 12.5, 30.25, 100],
      [EV.LitterCollected, 17, 40.5, 12.25, LITTER_IDS.indexOf('litter.bin_bag')],
      [EV.Fling, 3, 41, 13, LITTER_IDS.indexOf('litter.drink_can')],
      [EV.StainCleaned, STAIN_IDS.indexOf('stain.milkshake'), 20.5, 6.75, 20],
      [EV.HazardJolt, 4, 22.5, 7.25, 2],
      [EV.HazardStop, 9, 61, 7, 5.5],
    ]);
    expect(bus.drain(queue)).toBe(10);
    expect(seen).toEqual([
      { type: EV.Impact, tick: 42, entity: -1, x: 1.5, y: -2.25, speedMps: 4.75 },
      { type: EV.KerbJolt, tick: 42, entity: -1, x: 3, y: 4, speedMps: 2.5 },
      { type: EV.ReverseBeeper, tick: 42, entity: -1, x: 7, y: 8 },
      { type: EV.ShiftEnd, tick: 42, entity: -1, reason: ShiftEndReason.Towed },
      { type: EV.HopperFull, tick: 42, entity: -1, x: 12.5, y: 30.25, capacityLU: 100 },
      { type: EV.LitterCollected, tick: 42, entity: 17, x: 40.5, y: 12.25, kind: 'litter.bin_bag' },
      { type: EV.Fling, tick: 42, entity: 3, x: 41, y: 13, kind: 'litter.drink_can' },
      {
        type: EV.StainCleaned,
        tick: 42,
        entity: STAIN_IDS.indexOf('stain.milkshake'),
        x: 20.5,
        y: 6.75,
        kind: 'stain.milkshake',
        pts: 20,
      },
      { type: EV.HazardJolt, tick: 42, entity: 4, x: 22.5, y: 7.25, spilledLU: 2 },
      { type: EV.HazardStop, tick: 42, entity: 9, x: 61, y: 7, speedMps: 5.5 },
    ]);
  });

  it('gives typed listeners only their type, strongly typed', () => {
    const bus = new EventBus();
    const impacts: number[] = [];
    const jolts: number[] = [];
    bus.on(EV.Impact, (e) => impacts.push(e.speedMps));
    bus.on(EV.KerbJolt, (e) => jolts.push(e.x));
    bus.drain(
      sealedQueue(0, [
        [EV.KerbJolt, -1, 10, 0, 1],
        [EV.Impact, -1, 0, 0, 3],
        [EV.KerbJolt, -1, 11, 0, 1],
        [EV.ReverseBeeper, -1, 0, 0, 0],
      ]),
    );
    expect(impacts).toEqual([3]);
    expect(jolts).toEqual([10, 11]);
  });

  it('dispatches in emission order: per event, the type listeners (in subscription order), then onAny', () => {
    const bus = new EventBus();
    const log: string[] = [];
    bus.onAny((e) => log.push(`any ${e.type}`));
    bus.on(EV.Impact, () => log.push('impact A'));
    bus.on(EV.Impact, () => log.push('impact B'));
    bus.on(EV.KerbJolt, () => log.push('jolt'));
    bus.drain(
      sealedQueue(5, [
        [EV.KerbJolt, -1, 0, 0, 0],
        [EV.Impact, -1, 0, 0, 0],
        [EV.KerbJolt, -1, 0, 0, 0],
      ]),
    );
    expect(log).toEqual(['jolt', 'any 2', 'impact A', 'impact B', 'any 1', 'jolt', 'any 2']);
  });

  it('dispatches a sealed tick once, however often it is drained, and the next tick again', () => {
    const bus = new EventBus();
    const ticks: number[] = [];
    bus.onAny((e) => ticks.push(e.tick));
    const queue = sealedQueue(7, [[EV.Impact, -1, 0, 0, 1]]);
    expect(bus.drain(queue)).toBe(1);
    expect(bus.drain(queue)).toBe(0);
    sealedQueue(8, [[EV.Impact, -1, 0, 0, 1]], queue);
    expect(bus.drain(queue)).toBe(1);
    // A different queue (a restarted World) at the same tick number is a different tick.
    expect(bus.drain(sealedQueue(8, [[EV.Impact, -1, 0, 0, 1]]))).toBe(1);
    expect(ticks).toEqual([7, 8, 8]);
  });

  it('dispatches nothing for an empty tick', () => {
    const bus = new EventBus();
    let calls = 0;
    bus.onAny(() => {
      calls += 1;
    });
    expect(bus.drain(sealedQueue(0, []))).toBe(0);
    expect(calls).toBe(0);
  });

  it('lets a listener unsubscribe itself or subscribe another mid-dispatch, effective from the next event', () => {
    const bus = new EventBus();
    const log: string[] = [];
    const off = bus.on(EV.Impact, () => {
      log.push('once');
      off();
      bus.on(EV.Impact, () => log.push('late'));
    });
    bus.on(EV.Impact, () => log.push('always'));
    bus.drain(
      sealedQueue(0, [
        [EV.Impact, -1, 0, 0, 0],
        [EV.Impact, -1, 0, 0, 0],
      ]),
    );
    expect(log).toEqual(['once', 'always', 'always', 'late']);
    off(); // a second call does nothing
    const offAny = bus.onAny(() => log.push('any'));
    offAny();
    offAny();
    bus.drain(sealedQueue(1, [[EV.Impact, -1, 0, 0, 0]]));
    expect(log.slice(4)).toEqual(['always', 'late']);
  });

  it('refuses an unsealed queue (a drain in the middle of World.step)', () => {
    const bus = new EventBus();
    const queue = createEventQueue();
    resetEvents(queue, 3);
    pushEvent(queue, EV.Impact, -1, 0, 0, 0);
    expect(() => bus.drain(queue)).toThrow(/not sealed/);
  });

  it('throws on an event type it cannot decode, an unknown ShiftEnd reason and an unknown litter kind', () => {
    const bus = new EventBus();
    const unknown: ReadonlyEventQueue = {
      count: 1,
      sealed: true,
      tick: 9,
      type: [99],
      entity: [-1],
      a: [0],
      b: [0],
      c: [0],
    };
    expect(() => bus.drain(unknown)).toThrow(/type 99/);
    expect(() => bus.drain(sealedQueue(10, [[EV.ShiftEnd, -1, 77, 0, 0]]))).toThrow(/unknown reason 77/);
    expect(() => bus.drain(sealedQueue(11, [[EV.LitterCollected, 0, 0, 0, 200]]))).toThrow(/litter kind 200/);
    expect(() => bus.drain(sealedQueue(12, [[EV.Fling, 0, 0, 0, 1.5]]))).toThrow(/litter kind 1.5/);
    expect(() => bus.drain(sealedQueue(13, [[EV.StainCleaned, 5, 0, 0, 10]]))).toThrow(/stain kind 5/);
    expect(() => bus.drain(sealedQueue(14, [[EV.StainCleaned, -1, 0, 0, 10]]))).toThrow(/stain kind -1/);
  });

  it('decodes every EV id the sim defines (a new EV type must be wired into the bus)', () => {
    const bus = new EventBus();
    const types: number[] = [];
    bus.onAny((e) => types.push(e.type));
    const all = Object.values(EV);
    bus.drain(
      sealedQueue(
        0,
        all.map(
          (type) =>
            [
              type,
              // StainCleaned carries the stain kind (a STAIN_IDS index) in `entity`.
              type === EV.StainCleaned ? 0 : -1,
              type === EV.ShiftEnd ? ShiftEndReason.Towed : 0,
              0,
              0,
            ] as const,
        ),
      ),
    );
    expect(types).toEqual(all);
  });
});
