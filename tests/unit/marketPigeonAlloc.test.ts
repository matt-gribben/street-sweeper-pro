// The SSP-088 systems allocate nothing per tick (TECHNICAL_DESIGN §17): the §17 heap-delta check
// (tests/support/heapDelta.ts: 600 warm-up ticks, forced GC, 3,600 ticks, forced GC; retained and pre-final-GC
// growth each ≤ 32,768 B) over the open 192 m district of tests/support/npcTown.ts with four market stalls and
// their traders, a market close every 10 s (of an endless shift) piling chip wrappers, and two pigeon flocks.
// Every 20 s the harness sends Bessie at flock 0 from 6 m south at 6 m/s (a scatter, and its Pigeon Scatter
// when she gets through), and 10 s later drops a chip wrapper 7 m from flock 1 with Bessie 40 m away (a gather);
// it empties the LitterField every 10 s so the piles land instead of being refused at the cap. Between those,
// Bessie circles (and runs into the stalls: her HP is kept topped up so she is never TOWED).
//
// A focused rig rather than a fifth case of npcAlloc.test.ts: that rig's pre-final-GC figure already sits near
// the 32 KB threshold and moves by tens of KB with the `npc` stream's sequence (21–28 KB over three seeds before
// SSP-088), so it cannot isolate these systems. Runs in the Vitest unit project, whose forks pool has --expose-gc.
import { describe, expect, it } from 'vitest';
import { LITTER_IDS } from '../../src/sim/entities.ts';
import { createInputFrame, THROTTLE_MAX } from '../../src/sim/inputFrame.ts';
import { addLitterAt, clearLitterField } from '../../src/sim/litter.ts';
import { NpcOrigin } from '../../src/sim/npc/store.ts';
import { createWorld, stepWorld, type World } from '../../src/sim/world.ts';
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
import { npcTown } from '../support/npcTown.ts';

const TILES = 96;
const SIZE_M = TILES * 2;
/** As npcAlloc.test.ts: long enough for V8 to optimise every path, the once-in-10-s ones included. */
const PREWARM_TICKS = 150_000;
const CHIP_KIND = LITTER_IDS.indexOf('litter.chip_wrapper');
const CHIP_AT = new Float64Array(2);

function rig(): { world: World; step: (t: number) => void } {
  const { level } = npcTown(TILES, {
    flocks: [
      {
        id: 'npc.pigeon',
        count: 2,
        size: [6, 10],
        points: [
          [48, 66],
          [144, 66],
          [144, 128],
          [48, 128],
        ],
      },
    ],
  });
  for (const c of [20, 21, 22, 23])
    level.props.push({ id: 'prop.market_stall', x: c * 2 + 1, y: 61, rot: 0 });
  level.schedules = [
    { type: 'market', atS: [], untilS: null, trigger: null, params: {} },
    {
      type: 'market_close',
      atS: Array.from({ length: 300 }, (_, k) => 5 + k * 10),
      untilS: null,
      trigger: null,
      params: { buildS: 5, itemsPerPitch: 4, table: { 'litter.chip_wrapper': 1 } },
    },
  ];
  const world = createWorld(level, 0x88, endlessShiftTuning());
  const v = world.vehicle;
  const input = createInputFrame();
  input.steer = 50;
  const step = (t: number): void => {
    const npc = world.npc;
    if (t % 600 === 0) clearLitterField(world.litter);
    if (t % 1200 === 300 || t % 1200 === 900) {
      const run = t % 1200 === 300;
      for (let i = 0; i < npc.count; i++) {
        if (npc.origin[i] !== NpcOrigin.Flock || npc.group[i] !== (run ? 0 : 1)) continue;
        const x = npc.x[i] as number;
        const y = npc.y[i] as number;
        v.vLatMps = 0;
        v.yawRateRadPerS = 0;
        if (run) {
          v.xM = x;
          v.yM = y + 6;
          v.headingRad = 0;
          v.vLongMps = 6;
        } else {
          // Towards the middle of the map: scattered flocks end up against its edges.
          const dx = SIZE_M / 2 - x;
          const dy = SIZE_M / 2 - y;
          const d = Math.hypot(dx, dy);
          CHIP_AT[0] = x + (dx / d) * 7;
          CHIP_AT[1] = y + (dy / d) * 7;
          addLitterAt(world.litter, CHIP_KIND, CHIP_AT, 0);
          v.xM = x > SIZE_M / 2 ? x - 40 : x + 40;
          v.yM = Math.min(Math.max(y, 30), SIZE_M - 30);
          v.vLongMps = 0;
        }
        break;
      }
    }
    v.hp = 100;
    input.throttle = v.vLongMps < 5 ? THROTTLE_MAX : 0;
    stepWorld(world, input);
  };
  return { world, step };
}

const sum = (a: Int32Array): number => a.reduce((s, x) => s + x, 0);

describe('SSP-088 heap-delta check (TECHNICAL_DESIGN §17)', () => {
  it('market traders, closing piles and pigeon flocks scattering and gathering allocate nothing per tick', {
    timeout: 120_000,
  }, () => {
    requireGc();
    const { world, step } = rig();
    for (let t = 0; t < PREWARM_TICKS; t++) step(t);
    const fl = world.npcAi.flocks;
    const before = {
      scatters: sum(fl.scatters),
      gathers: sum(fl.gathers),
      bonuses: fl.bonuses,
      items: world.shiftEvents.itemsSpawned,
    };
    const delta = measureHeapDelta((t) => step(PREWARM_TICKS + t));
    const after = {
      scatters: sum(fl.scatters) - before.scatters,
      gathers: sum(fl.gathers) - before.gathers,
      bonuses: fl.bonuses - before.bonuses,
      items: world.shiftEvents.itemsSpawned - before.items,
    };
    console.log(
      `marketPigeonAlloc: ${HEAP_MEASURED_TICKS} ticks after ${PREWARM_TICKS} + ${HEAP_WARMUP_TICKS} warm-up: ` +
        `retained ${delta.retainedBytes} B (≤ ${HEAP_RETAINED_THRESHOLD_BYTES}), pre-final-GC ${delta.preGcBytes} B ` +
        `(≤ ${HEAP_PRE_GC_THRESHOLD_BYTES}); pile items +${after.items}, scatters +${after.scatters}, Pigeon ` +
        `Scatters +${after.bonuses}, gathers +${after.gathers}`,
    );
    // The window ran the work under test.
    let traders = 0;
    for (let i = 0; i < world.npc.count; i++) if (world.npc.origin[i] === NpcOrigin.Market) traders++;
    expect(traders).toBe(4);
    expect(after.items).toBeGreaterThan(0);
    expect(after.scatters).toBeGreaterThan(0);
    expect(after.bonuses).toBeGreaterThan(0);
    expect(after.gathers).toBeGreaterThan(0);
    assertHeapDeltaWithinThresholds(delta);
  });
});
