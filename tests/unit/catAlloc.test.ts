// The cat allocates nothing per tick (SSP-087; TECHNICAL_DESIGN §17): the §17 heap-delta check
// (tests/support/heapDelta.ts: warm-up, forced GC, 3,600 ticks, forced GC; retained and pre-final-GC growth each
// ≤ 32,768 B) over the cat street (tests/support/catTown.ts) with its 6 placed cats (walls, car roofs, grooming
// spots) and 4 more grooming in Bessie's way, while she drives up and down the street, honks every 2 s (bolts)
// and the harness hits a cat every 3 s (leaps, roof rides, hop-offs and the runs back to cover). The cats' groom
// idle timer is cut to 8–12 s and the groom to 2 s (an edited entities.json), so they go grooming inside the window
// too: every state of behaviours/cat.ts and every search of npc/catPerches.ts runs in it. Runs in the unit
// project, whose forks pool has --expose-gc.
import { describe, expect, it } from 'vitest';
import entitiesJson from '../../src/data/entities.json' with { type: 'json' };
import { loadEntities } from '../../src/sim/entities.ts';
import { createInputFrame, PRESSED, THROTTLE_MAX } from '../../src/sim/inputFrame.ts';
import { Stimulus } from '../../src/sim/npc/behaviour.ts';
import { CAT } from '../../src/sim/npc/behaviours/cat.ts';
import { TILE_TARGET } from '../../src/sim/npc/catPerches.ts';
import { pushStimulus } from '../../src/sim/npc/stimuli.ts';
import { npcHandle } from '../../src/sim/npc/store.ts';
import { createWorld, stepWorld, type World } from '../../src/sim/world.ts';
import { addCat, CAT_KIND, compileCatTown, tileCentre } from '../support/catTown.ts';
import { endlessShiftTuning } from '../support/endlessShift.ts';
import {
  assertHeapDeltaWithinThresholds,
  HEAP_MEASURED_TICKS,
  HEAP_WARMUP_TICKS,
  measureHeapDelta,
  requireGc,
} from '../support/heapDelta.ts';

const PREWARM_TICKS = 60_000;

function rig(): { world: World; step: (t: number) => void; seen: Uint32Array } {
  const raw = structuredClone(entitiesJson) as unknown as Record<string, { rules: Record<string, number> }>;
  const rules = (raw['npc.cat'] as { rules: Record<string, number> }).rules;
  rules.groomIdleMinS = 8;
  rules.groomIdleMaxS = 12;
  rules.groomS = 2;
  const level = compileCatTown(undefined, { perches: { count: 6, on: ['walls', 'carRoofs', 'road'] } });
  const world = createWorld(
    level,
    0x87,
    endlessShiftTuning((t) => {
      t.complaints.meter.sackedAt = 1_000_000_000;
    }),
    {},
    loadEntities(raw),
  );
  const c = world.npcAi.cat;
  for (const col of [56, 64, 72, 80]) {
    const [x, y] = tileCentre(col, 4);
    const i = addCat(world, -1, x, y);
    world.npc.state[i] = CAT.Groom;
    world.npc.timerB[i] = TILE_TARGET - (4 * c.widthTiles + col);
    world.npc.timerA[i] = c.params.groomTicks;
  }
  const input = createInputFrame();
  const v = world.vehicle;
  const q = world.npcAi.stimuli;
  // Ticks seen in each cat state (CAT ids 0..6).
  const seen = new Uint32Array(7);
  const step = (t: number): void => {
    // Up the street and back: put her about at one end every 12 s (her previous pose too, so it is no drive).
    if (t % 720 === 0) {
      const east = (t / 720) % 2 === 0;
      v.headingRad = east ? Math.PI / 2 : -Math.PI / 2;
      v.prevHeadingRad = v.headingRad;
      v.xM = east ? 20 : 180;
      v.yM = 9;
      v.prevXM = v.xM;
      v.prevYM = v.yM;
      v.vLongMps = 0;
      v.vLatMps = 0;
      v.yawRateRadPerS = 0;
    }
    v.hp = 100;
    input.throttle = v.vLongMps < 9 ? THROTTLE_MAX : 0;
    input.pressed = t % 120 === 0 ? PRESSED.HORN : 0;
    if (t % 180 === 45) {
      const npc = world.npc;
      for (let k = 0; k < npc.count; k++) {
        const j = ((t / 180 + k) % npc.count) | 0;
        if (npc.kind[j] !== CAT_KIND) continue;
        pushStimulus(q, Stimulus.Hit, npcHandle(npc, j));
        break;
      }
    }
    stepWorld(world, input);
    const npc = world.npc;
    for (let i = 0; i < npc.count; i++) {
      const s = npc.state[i] as number;
      seen[s] = (seen[s] as number) + 1;
    }
  };
  return { world, step, seen };
}

describe('npc.cat heap-delta check (TECHNICAL_DESIGN §17, SSP-087)', () => {
  it('World.step allocates nothing per tick with cats perching, darting, grooming, bolting and riding the roof', {
    timeout: 120_000,
  }, () => {
    requireGc();
    const { step, seen } = rig();
    for (let t = 0; t < PREWARM_TICKS; t++) step(t);
    const before = Uint32Array.from(seen);
    const delta = measureHeapDelta((t) => step(PREWARM_TICKS + t));
    const window = Array.from(seen, (n, s) => n - (before[s] as number));
    console.log(
      `catAlloc: ${HEAP_MEASURED_TICKS} ticks after ${PREWARM_TICKS} + ${HEAP_WARMUP_TICKS} warm-up: retained ` +
        `${delta.retainedBytes} B, pre-final-GC ${delta.preGcBytes} B; cat-ticks by state (Perch, Dart, Groom, ` +
        `Bolt, LeapOnRoof, RideRoof, HopOff) ${window.join(', ')}`,
    );
    // Every state ran inside the window.
    for (let s = 0; s < 7; s++) expect(window[s], `state ${s}`).toBeGreaterThan(0);
    assertHeapDeltaWithinThresholds(delta);
  });
});
