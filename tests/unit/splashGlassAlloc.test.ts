// Puddle splashes and broken glass allocate nothing per tick (TECHNICAL_DESIGN §17; SSP-094): a World with
// puddles and broken glass across the open town of tests/support/npcTown.ts runs the §17 heap-delta check
// (tests/support/heapDelta.ts) while Bessie circles with the brush down, so every lap crosses puddles fast
// (EV.Splash), splashes the two pedestrians held 3.3 m ahead of and behind her centre (EV.NpcSplash, penalty
// facts, Splash stimuli, the every-3rd complaint), drives over glass (the HP drain) and sweeps it up
// (EV.GlassSwept); the harness lays fresh glass ahead of her every 32 ticks.
//
// The two pedestrians are Doris (npc.old_woman, Named, so the spawner never retires them): 1.375 m from her
// bumpers, inside the 1.5 m splash reach and outside the actor-contact query box at every heading. People
// beside her fall inside that box, whose SAT and a startled pedestrian's flee steering box a sqrt result: those
// allocations predate SSP-094 and are not what this check measures. Doris has no startle.
//
// A file of its own: run after the other splash and glass tests, which use every NPC kind, V8 optimises the
// tick differently and the check measures that (the same reason replay heap checks run in a child process).
// Runs in the Vitest unit project, whose forks pool starts workers with `--expose-gc`.
import { expect, it } from 'vitest';
import { TILE_M } from '../../src/sim/constants.ts';
import { NPC_IDS } from '../../src/sim/entities.ts';
import { countEvents, EV } from '../../src/sim/eventQueue.ts';
import { addHazard, HAZARD_CAPACITY, hazardAtTile, hazardKindIndex } from '../../src/sim/hazards.ts';
import { createInputFrame, PRESSED } from '../../src/sim/inputFrame.ts';
import { addNpcAt, NpcOrigin, setNpcState, updateNpcCell } from '../../src/sim/npc/store.ts';
import { DEFAULT_TUNING } from '../../src/sim/tuning.ts';
import { createWorld, stepWorld } from '../../src/sim/world.ts';
import { endlessShiftTuning } from '../support/endlessShift.ts';
import { assertHeapDeltaWithinThresholds, measureHeapDelta } from '../support/heapDelta.ts';
import { npcTown } from '../support/npcTown.ts';

const PUDDLE = hazardKindIndex('haz.puddle');
const GLASS = hazardKindIndex('haz.broken_glass');
const DORIS = NPC_IDS.indexOf('npc.old_woman');

it('stepWorld over puddles with pedestrians and over glass with the brush down allocates nothing', () => {
  const world = createWorld(npcTown(48, {}).level, 7, endlessShiftTuning());
  for (let row = 6; row < 44; row += 4) {
    for (let col = 6; col < 44; col += 4) {
      addHazard(world.hazards, (row + col) % 8 === 0 ? PUDDLE : GLASS, col, row, col + 1, row + 1);
    }
  }
  const peds: number[] = [];
  for (const y of [44.7, 51.3]) {
    const i = addNpcAt(world.npc, DORIS, NpcOrigin.Named, 48, y);
    world.npc.radius[i] = DEFAULT_TUNING.streetLife.npcRadius.humanM;
    world.npc.walkMps[i] = world.npcAi.spawner.speedByKind[DORIS] as number;
    setNpcState(world.npc, i, world.npcAi.behaviours[DORIS]?.initial ?? 0);
    peds.push(i);
  }
  world.vehicle.hp = 1e9;
  const lower = createInputFrame();
  lower.pressed = PRESSED.BRUSH;
  stepWorld(world, lower);
  const circle = createInputFrame();
  circle.throttle = 160;
  circle.steer = 60;
  // Forward offsets as a typed array: the step must not pass doubles to calls (V8 boxes them), or the harness
  // itself would allocate.
  const ahead = Float64Array.of(3.3, -3.3);
  const npc = world.npc;
  const v = world.vehicle;
  const step = (t: number): void => {
    for (let k = 0; k < 2; k++) {
      const i = peds[k] as number;
      // forward = (sin θ, −cos θ) (src/sim/coords.ts).
      npc.x[i] = v.xM + Math.sin(v.headingRad) * (ahead[k] as number);
      npc.y[i] = v.yM - Math.cos(v.headingRad) * (ahead[k] as number);
      updateNpcCell(npc, i);
    }
    // Keep the meter off SACKED, and lay glass ahead of her every 32 ticks so every lap sweeps some.
    world.complaints.count = 0;
    if ((t & 31) === 0 && world.hazards.count < HAZARD_CAPACITY) {
      const col = Math.floor((v.xM + Math.sin(v.headingRad) * 2.6) / TILE_M) | 0;
      const row = Math.floor((v.yM - Math.cos(v.headingRad) * 2.6) / TILE_M) | 0;
      if (hazardAtTile(world.hazards, col, row) < 0)
        addHazard(world.hazards, GLASS, col, row, col + 1, row + 1);
    }
    stepWorld(world, circle);
  };
  // Pre-warm until V8 has optimised the whole tick (see tests/unit/world.test.ts).
  for (let t = 0; t < 30_000; t++) step(t);
  let splashes = 0;
  let crossings = 0;
  let swept = 0;
  for (let t = 0; t < 3600; t++) {
    step(t);
    splashes += countEvents(world.events, EV.NpcSplash);
    crossings += countEvents(world.events, EV.Splash);
    swept += countEvents(world.events, EV.GlassSwept);
  }
  expect(splashes).toBeGreaterThan(5);
  expect(crossings).toBeGreaterThan(5);
  expect(swept).toBeGreaterThan(5);
  expect(world.npc.count).toBe(2);
  expect(world.npcAi.reactions.hits).toBe(0);
  const delta = measureHeapDelta((t) => step(t));
  assertHeapDeltaWithinThresholds(delta);
});
