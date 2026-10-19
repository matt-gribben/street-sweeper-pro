// The special traffic kinds allocate nothing per tick (SSP-091; TECHNICAL_DESIGN §17): the §17 heap-delta check
// (tests/support/heapDelta.ts) over the long street (tests/support/trafficTown.ts) with taxis, bicycles and cars
// in its lanes, two mobility scooters on its pavements and four stationary market traders in their way. Every
// 2 s Bessie is teleported: to stand in the eastbound lane (a queue builds behind her, the bicycles filter past
// it, taxis brake hard for fares), or nose-on to a bicycle's or scooter's flank driving at it at 2 m/s (actor
// hits: the penalty fact, EV.VehicleHit, the fall), or onto the pavement in a scooter's way (it stops, then turns
// round). Covers stepActorVehicles, the fare stop, stepBikeLateral and its scans, drivePavementVehicle with
// pedestrianCap and pickNavNext, and the pavement spawns and retirements. Runs in the Vitest unit project
// (--expose-gc); without it the check throws.
import { describe, expect, it } from 'vitest';
import { NPC_IDS, VEHICLE_IDS } from '../../src/sim/entities.ts';
import { createInputFrame } from '../../src/sim/inputFrame.ts';
import { addNpcAt, NpcOrigin } from '../../src/sim/npc/store.ts';
import { VEHICLE_FLAG } from '../../src/sim/vehicleStore.ts';
import { createWorld, stepWorld, type World } from '../../src/sim/world.ts';
import { endlessShiftTuning } from '../support/endlessShift.ts';
import {
  assertHeapDeltaWithinThresholds,
  HEAP_MEASURED_TICKS,
  HEAP_WARMUP_TICKS,
  measureHeapDelta,
  requireGc,
} from '../support/heapDelta.ts';
import { compileTrafficTown, LONG_STREET } from '../support/trafficTown.ts';

/** Long enough for V8 to optimise every path, the rare ones (hits, fares, turn-rounds, spawns) included. */
const PREWARM_TICKS = 100_000;

const BICYCLE = (VEHICLE_IDS as readonly string[]).indexOf('veh.bicycle');

function teleport(w: World, x: number, y: number, heading: number, vLongMps: number): void {
  const v = w.vehicle;
  v.xM = x;
  v.yM = y;
  v.prevXM = x;
  v.prevYM = y;
  v.headingRad = heading;
  v.prevHeadingRad = heading;
  v.vLongMps = vLongMps;
  v.vLatMps = 0;
  v.yawRateRadPerS = 0;
}

function specialRig(): { world: World; step: (t: number) => void; counts: () => number[] } {
  const tuning = endlessShiftTuning((raw) => {
    raw.complaints.meter.sackedAt = 1_000_000_000;
    raw.vehicle.sweeper.health.maxHp = 1_000_000_000;
  });
  const world = createWorld(
    compileTrafficTown(LONG_STREET, {
      densityPerKm: 20,
      mix: { 'veh.hatchback': 1, 'veh.taxi': 2, 'veh.bicycle': 2 },
      pavement: { 'veh.mobility_scooter': 2 },
    }),
    0x91,
    tuning,
  );
  world.vehicle.hp = 1_000_000_000;
  const trader = (NPC_IDS as readonly string[]).indexOf('npc.market_trader');
  for (const [x, y] of [
    [61, 3],
    [121, 3],
    [81, 11],
    [141, 11],
  ] as const) {
    const n = addNpcAt(world.npc, trader, NpcOrigin.Named, x, y);
    world.npc.radius[n] = world.npcAi.spawner.radiusByKind[trader] as number;
  }
  const input = createInputFrame();
  let filteringTicks = 0;
  let pavementTicks = 0;
  const step = (t: number): void => {
    const s = world.vehicles;
    if (t % 120 === 0) {
      const k = (t / 120) % 3;
      if (k === 0) teleport(world, 100, 5.5, Math.PI / 2, 0);
      else if (k === 1) {
        // Nose-on to an actor's road-side flank, driving at it.
        let a = -1;
        for (let i = 0; i < s.count; i++) {
          const actor = s.kind[i] === BICYCLE || ((s.flags[i] as number) & VEHICLE_FLAG.PAVEMENT) !== 0;
          if (actor && (s.x[i] as number) > 8 && (s.x[i] as number) < 172) a = i;
        }
        if (a >= 0) {
          const h = s.heading[a] as number;
          const side = (7 - (s.y[a] as number)) * Math.sin(h) >= 0 ? 1 : -1;
          const off = (s.halfWidth[a] as number) + 1.625 + 0.05;
          teleport(
            world,
            (s.x[a] as number) + Math.cos(h) * side * off,
            (s.y[a] as number) + Math.sin(h) * side * off,
            h - (side * Math.PI) / 2,
            2,
          );
        }
      } else {
        teleport(world, 40 + ((t / 120) % 10) * 10, 3, Math.PI / 2, 0);
      }
    }
    stepWorld(world, input);
    for (let i = 0; i < s.count; i++) {
      if ((s.lateral[i] as number) > 0) filteringTicks++;
      if (((s.flags[i] as number) & VEHICLE_FLAG.PAVEMENT) !== 0) pavementTicks++;
    }
  };
  const counts = (): number[] => [
    world.traffic.fareStops,
    world.traffic.actorHits,
    filteringTicks,
    pavementTicks,
    world.vehicles.vehiclesAdded,
  ];
  return { world, step, counts };
}

describe('special traffic kinds heap-delta check (TECHNICAL_DESIGN §17, SSP-091)', () => {
  it('World.step allocates nothing per tick with fare stops, filtering, pavement vehicles and actor hits', {
    timeout: 180_000,
  }, () => {
    requireGc();
    const { step, counts } = specialRig();
    for (let t = 0; t < PREWARM_TICKS; t++) step(t);
    const before = counts();
    const delta = measureHeapDelta((t) => step(PREWARM_TICKS + t));
    const after = counts();
    const d = after.map((v, k) => v - (before[k] as number));
    console.log(
      `specialAlloc: ${HEAP_MEASURED_TICKS} ticks after ${PREWARM_TICKS} + ${HEAP_WARMUP_TICKS} warm-up: ` +
        `retained ${delta.retainedBytes} B, pre-final-GC ${delta.preGcBytes} B; fare stops ${d[0]}, actor hits ` +
        `${d[1]}, filtering ticks ${d[2]}, pavement vehicle ticks ${d[3]}, spawns ${d[4]}`,
    );
    // The window ran the work under test.
    expect(d[0]).toBeGreaterThan(0);
    expect(d[1]).toBeGreaterThan(3);
    expect(d[2]).toBeGreaterThan(100);
    expect(d[3]).toBeGreaterThan(1000);
    expect(d[4]).toBeGreaterThan(3);
    assertHeapDeltaWithinThresholds(delta);
  });
});
