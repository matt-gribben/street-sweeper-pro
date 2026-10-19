// Traffic allocates nothing per tick (SSP-089; TECHNICAL_DESIGN §17): the §17 heap-delta check
// (tests/support/heapDelta.ts: 600 warm-up ticks, forced GC, 3,600 ticks, forced GC; retained and pre-final-GC
// growth each ≤ 32,768 B) over two compiled towns stepped side by side:
//   - the crossroads (tests/support/trafficTown.ts) at 40 vehicles per lane-km (14 moving, a bus in the mix),
//     with Bessie hopping between spots on and off its roads: portal spawns and despawns off the view rect,
//     lane choices at the junction, junction box slots and claims, car following and the spatial lookup;
//   - the one-way street with its scheduled bus (every 45 s), one car, the zebra held occupied half the time
//     and Bessie standing in the lane for 12 s of every 20: bus dwell at both stops, the zebra stop line,
//     the block timer's car honks (EV.CarHorn) and Road Rage penalty facts, and the kerb gap hook on both of
//     its crossings every tick.
// Runs in the Vitest unit project (--expose-gc); without it the check throws.
import { describe, expect, it } from 'vitest';
import { createInputFrame } from '../../src/sim/inputFrame.ts';
import { NAV_FLAG } from '../../src/sim/map.ts';
import { trafficCrossingClear } from '../../src/sim/traffic.ts';
import { createWorld, Phase, stepWorld, type World } from '../../src/sim/world.ts';
import { endlessShiftTuning } from '../support/endlessShift.ts';
import {
  assertHeapDeltaWithinThresholds,
  HEAP_MEASURED_TICKS,
  HEAP_PRE_GC_THRESHOLD_BYTES,
  HEAP_RETAINED_THRESHOLD_BYTES,
  HEAP_WARMUP_TICKS,
  measureHeapDelta,
  requireGc,
} from '../support/heapDelta.ts';
import { CROSSROADS, compileTrafficTown, ONE_WAY_STREET } from '../support/trafficTown.ts';

/** Long enough for V8 to optimise every traffic path, the rare ones (spawns, honks, dwells) included. */
const PREWARM_TICKS = 100_000;

const SPOTS: readonly (readonly [number, number])[] = [
  [61, 31],
  [40, 11],
  [6, 26],
  [40, 52],
  [74, 26],
  [10, 10],
];

function teleport(w: World, x: number, y: number, heading: number): void {
  const v = w.vehicle;
  v.xM = x;
  v.yM = y;
  v.prevXM = x;
  v.prevYM = y;
  v.headingRad = heading;
  v.prevHeadingRad = heading;
  v.vLongMps = 0;
  v.vLatMps = 0;
}

function trafficRig(): { cross: World; street: World; step: (t: number) => void; counts: () => number[] } {
  // Road Rage files a complaint every block; since SSP-079 a full meter (5) ends the shift SACKED and freezes the
  // World, so the meter's cap is raised out of reach and the street keeps honking for the whole window.
  const tuning = endlessShiftTuning((raw) => {
    raw.complaints.meter.sackedAt = 1_000_000_000;
  });
  const cross = createWorld(
    compileTrafficTown(CROSSROADS, {
      densityPerKm: 40,
      mix: { 'veh.hatchback': 2, 'veh.saloon': 1, 'veh.van_white': 1, 'veh.bus': 1 },
    }),
    0x89,
    tuning,
  );
  const street = createWorld(
    compileTrafficTown(ONE_WAY_STREET, {
      densityPerKm: 5,
      mix: { 'veh.hatchback': 1 },
      busRoute: ['1', '2'],
      busEveryS: 45,
    }),
    0x89,
    tuning,
  );
  const nav = street.level.nav;
  let zebraEdge = -1;
  let droppedEdge = -1;
  for (let e = 0; e < nav.edgeCount; e++) {
    if ((nav.edgeFlags[e] as number) & NAV_FLAG.ZEBRA) zebraEdge = e;
    if ((nav.edgeFlags[e] as number) & NAV_FLAG.DROPPED_KERB) droppedEdge = e;
  }
  let holdZebra = false;
  street.phaseTrace = (phase) => {
    if (phase === Phase.Traffic && holdZebra) street.zebras.occupancy[0] = 1;
  };
  const input = createInputFrame();
  let clearSeen = 0;
  let heldSeen = 0;
  const step = (t: number): void => {
    if (t % 300 === 0) {
      const spot = SPOTS[(t / 300) % SPOTS.length] as readonly [number, number];
      teleport(cross, spot[0], spot[1], 0);
    }
    const phase = t % 1200;
    if (phase === 0) teleport(street, 90, 7, Math.PI / 2);
    if (phase === 720) teleport(street, 90, 11, Math.PI / 2);
    holdZebra = t % 2400 < 1200;
    stepWorld(cross, input);
    stepWorld(street, input);
    if (trafficCrossingClear(street, 0, zebraEdge)) clearSeen++;
    else heldSeen++;
    if (trafficCrossingClear(street, 0, droppedEdge)) clearSeen++;
    else heldSeen++;
  };
  const counts = (): number[] => [
    cross.vehicles.vehiclesAdded,
    cross.vehicles.vehiclesRemoved,
    street.traffic.carHorns,
    street.traffic.roadRageOffences,
    street.traffic.busesSpawned,
    heldSeen,
    clearSeen,
  ];
  return { cross, street, step, counts };
}

describe('traffic heap-delta check (TECHNICAL_DESIGN §17, SSP-089)', () => {
  it('World.step allocates nothing per tick with traffic spawning, queuing, honking and dwelling', {
    timeout: 180_000,
  }, () => {
    requireGc();
    const { cross, step, counts } = trafficRig();
    for (let t = 0; t < PREWARM_TICKS; t++) step(t);
    const before = counts();
    const delta = measureHeapDelta((t) => step(PREWARM_TICKS + t));
    const after = counts();
    const d = after.map((v, k) => v - (before[k] as number));
    console.log(
      `trafficAlloc: ${HEAP_MEASURED_TICKS} ticks after ${PREWARM_TICKS} + ${HEAP_WARMUP_TICKS} warm-up: ` +
        `retained ${delta.retainedBytes} B (≤ ${HEAP_RETAINED_THRESHOLD_BYTES}), pre-final-GC ${delta.preGcBytes} B ` +
        `(≤ ${HEAP_PRE_GC_THRESHOLD_BYTES}); spawns ${d[0]}, despawns ${d[1]}, car honks ${d[2]}, ` +
        `Road Rage ${d[3]}, buses ${d[4]}, kerb checks held ${d[5]} / clear ${d[6]}`,
    );
    // The window ran the work under test.
    expect(cross.vehicles.count).toBeGreaterThan(5);
    expect(d[0]).toBeGreaterThan(10);
    expect(d[1]).toBeGreaterThan(10);
    expect(d[2]).toBeGreaterThan(3);
    expect(d[3]).toBeGreaterThan(0);
    expect(d[4]).toBeGreaterThan(0);
    expect(d[5]).toBeGreaterThan(50);
    expect(d[6]).toBeGreaterThan(50);
    assertHeapDeltaWithinThresholds(delta);
  });
});
