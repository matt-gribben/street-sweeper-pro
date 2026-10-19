// The canonical tick order (TECHNICAL_DESIGN §5.2) as the systems are actually called (SSP-065; SSP-080 phase 7; SSP-081 zebra occupancy; SSP-089 phase 8). The phase
// trace in tests/unit/world.test.ts proves the eleven phase slots run in order; this file wraps every system
// function World.step calls, records each call, and checks the full per-tick sequence, so a system that moved
// to another phase (or swapped places inside one) fails here. SSP-078 adds the horn (phase 1) and the honk window
// and penalty facts (phase 9, before scoring); SSP-092 the knockable bodies (phase 4, between static collision
// and brush/litter), SSP-096 the power-ups right after them (stepPickups). SSP-089 fills phase 8 with stepTraffic, run on a compiled town with traffic so phase 8 does
// real work (spawns, car following, a car queued behind Bessie, its honks and the Road Rage fact that phase 9
// then files). Changing this order changes replay hashes and must be called out in the commit (§5.2).
//
// vi.mock replaces each module for everything that imports it in this test file's module graph (world.ts
// included); every wrapper forwards to the real function, so the World runs exactly as in the game.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { BrushState } from '../../src/sim/brush.ts';
import { BUTTON, createInputFrame, PRESSED } from '../../src/sim/inputFrame.ts';
import { decodeLevel } from '../../src/sim/map.ts';
import { DEFAULT_TUNING } from '../../src/sim/tuning.ts';
import { createWorld } from '../../src/sim/world.ts';
import { compileTrafficTown, ONE_WAY_STREET } from '../support/trafficTown.ts';

const calls = vi.hoisted(() => ({ log: [] as string[], on: false }));

/** `mod` with the named functions wrapped to record their calls while recording is on. */
function wrap<T extends Record<string, unknown>>(mod: T, names: readonly string[]): T {
  const out: Record<string, unknown> = { ...mod };
  for (const name of names) {
    const fn = mod[name];
    if (typeof fn !== 'function') throw new Error(`tickOrder: ${name} is not a function`);
    out[name] = (...args: unknown[]): unknown => {
      if (calls.on) calls.log.push(name);
      return (fn as (...a: unknown[]) => unknown)(...args);
    };
  }
  return out as T;
}

vi.mock('../../src/sim/eventQueue.ts', async (importOriginal) =>
  wrap(await importOriginal(), ['resetEvents', 'sealEvents']),
);
vi.mock('../../src/sim/shift.ts', async (importOriginal) =>
  wrap(await importOriginal(), ['gateShiftInput', 'stepShift']),
);
vi.mock('../../src/sim/brush.ts', async (importOriginal) =>
  wrap(await importOriginal(), ['stepBrushState', 'stepBrushLitter']),
);
vi.mock('../../src/sim/surface.ts', async (importOriginal) =>
  wrap(await importOriginal(), ['sampleSurface']),
);
vi.mock('../../src/sim/vehicle.ts', async (importOriginal) => wrap(await importOriginal(), ['stepVehicle']));
vi.mock('../../src/sim/kerb.ts', async (importOriginal) =>
  wrap(await importOriginal(), ['findKerbCrossings']),
);
vi.mock('../../src/sim/hazards.ts', async (importOriginal) =>
  wrap(await importOriginal(), ['stepHazardContacts', 'stepBrushUpLeaves']),
);
vi.mock('../../src/sim/collision/resolveStatic.ts', async (importOriginal) =>
  wrap(await importOriginal(), ['resolveStatic']),
);
vi.mock('../../src/sim/bodies.ts', async (importOriginal) => wrap(await importOriginal(), ['stepBodies']));
vi.mock('../../src/sim/pickups.ts', async (importOriginal) => wrap(await importOriginal(), ['stepPickups']));
vi.mock('../../src/sim/litter.ts', async (importOriginal) =>
  wrap(await importOriginal(), ['beginLitterTick', 'stepLitter']),
);
vi.mock('../../src/sim/stains.ts', async (importOriginal) =>
  wrap(await importOriginal(), ['stepBrushUpSplats']),
);
vi.mock('../../src/sim/water.ts', async (importOriginal) =>
  wrap(await importOriginal(), ['stepWater', 'cleanStainsInCone']),
);
vi.mock('../../src/sim/dirt.ts', async (importOriginal) => wrap(await importOriginal(), ['stepDirt']));
vi.mock('../../src/sim/npc/store.ts', async (importOriginal) =>
  wrap(await importOriginal(), ['beginNpcTick']),
);
vi.mock('../../src/sim/viewRect.ts', async (importOriginal) =>
  wrap(await importOriginal(), ['updateViewRect']),
);
vi.mock('../../src/sim/npc/spawner.ts', async (importOriginal) =>
  wrap(await importOriginal(), ['stepNpcSpawner']),
);
vi.mock('../../src/sim/npc/stimuli.ts', async (importOriginal) =>
  wrap(await importOriginal(), ['deliverStimuli']),
);
vi.mock('../../src/sim/npc/perception.ts', async (importOriginal) =>
  wrap(await importOriginal(), ['perceiveNpcs']),
);
vi.mock('../../src/sim/npc/npcAi.ts', async (importOriginal) =>
  wrap(await importOriginal(), ['tickNpcBehaviours']),
);
vi.mock('../../src/sim/npc/steering.ts', async (importOriginal) =>
  wrap(await importOriginal(), ['updateZebraOccupancy']),
);
vi.mock('../../src/sim/traffic.ts', async (importOriginal) => wrap(await importOriginal(), ['stepTraffic']));
vi.mock('../../src/sim/scoring.ts', async (importOriginal) => wrap(await importOriginal(), ['stepScoring']));
vi.mock('../../src/sim/tidy.ts', async (importOriginal) => wrap(await importOriginal(), ['stepTidy']));
vi.mock('../../src/sim/complaints.ts', async (importOriginal) =>
  wrap(await importOriginal(), ['stepHornInput', 'stepHornSpam', 'applyPenalties']),
);

/** One tick, as TECHNICAL_DESIGN §5.2 orders it: `phase n` marks the phase trace, the rest are system calls. */
const ONE_TICK = [
  'resetEvents',
  'phase 1',
  'gateShiftInput',
  'stepHornInput',
  'phase 2',
  'stepBrushState',
  'sampleSurface',
  'stepVehicle',
  'findKerbCrossings', // front axle
  'findKerbCrossings', // rear axle
  'stepHazardContacts',
  'phase 3',
  'resolveStatic',
  'phase 4',
  'stepBodies',
  'stepPickups',
  'phase 5',
  'beginLitterTick',
  'stepBrushLitter',
  'stepBrushUpLeaves',
  'stepBrushUpSplats',
  'stepLitter',
  'stepWater',
  'phase 6',
  'stepDirt',
  'cleanStainsInCone',
  'phase 7',
  'beginNpcTick',
  'updateViewRect',
  'stepNpcSpawner',
  'deliverStimuli',
  'perceiveNpcs',
  'tickNpcBehaviours',
  'updateZebraOccupancy',
  'phase 8',
  'stepTraffic',
  'phase 9',
  'stepHornSpam',
  'applyPenalties',
  'stepScoring',
  'stepTidy',
  'phase 10',
  'stepShift',
  'phase 11',
  'sealEvents',
];

describe('World.step system call order (TECHNICAL_DESIGN §5.2, SSP-065, SSP-078, SSP-092)', () => {
  it('runs phase 4 (knockable bodies, SSP-092) after phase 3 (static collision) and before phase 5 (brush/litter)', () => {
    const at = (name: string): number => ONE_TICK.indexOf(name);
    expect(at('phase 3')).toBeLessThan(at('resolveStatic'));
    expect(at('resolveStatic')).toBeLessThan(at('phase 4'));
    expect(at('phase 4')).toBeLessThan(at('stepBodies'));
    expect(at('stepBodies')).toBeLessThan(at('phase 5'));
    // SSP-096: the power-ups are collected after the bodies, before phase 5 (so super suction counts this tick).
    expect(at('stepBodies')).toBeLessThan(at('stepPickups'));
    expect(at('stepPickups')).toBeLessThan(at('phase 5'));
    expect(at('phase 5')).toBeLessThan(at('beginLitterTick'));
  });

  it('runs phase 7 (NPC AI, SSP-080) after phase 6 (dirt) and before phase 8 (traffic)', () => {
    const at = (name: string): number => ONE_TICK.indexOf(name);
    const npcSystems = [
      'beginNpcTick',
      'updateViewRect',
      'stepNpcSpawner',
      'deliverStimuli',
      'perceiveNpcs',
      'tickNpcBehaviours',
      'updateZebraOccupancy',
    ];
    expect(at('phase 6')).toBeLessThan(at('phase 7'));
    expect(at('cleanStainsInCone')).toBeLessThan(at('phase 7')); // the last dirt system
    for (const name of npcSystems) {
      expect(at(name), name).toBeGreaterThan(at('phase 7'));
      expect(at(name), name).toBeLessThan(at('phase 8'));
    }
  });

  it('runs phase 8 (traffic, SSP-089) after phase 7 (NPC AI) and before phase 9 (scoring and complaints)', () => {
    const at = (name: string): number => ONE_TICK.indexOf(name);
    expect(at('phase 7')).toBeLessThan(at('phase 8'));
    expect(at('updateZebraOccupancy')).toBeLessThan(at('phase 8')); // the last NPC system
    expect(at('stepTraffic')).toBeGreaterThan(at('phase 8'));
    expect(at('stepTraffic')).toBeLessThan(at('phase 9'));
    expect(at('phase 9')).toBeLessThan(at('stepHornSpam'));
    expect(at('phase 8')).toBeLessThan(at('phase 9'));
  });

  it('calls stepTraffic once per tick between phases 8 and 9 while traffic queues behind Bessie', () => {
    const level = compileTrafficTown(ONE_WAY_STREET, { densityPerKm: 5, mix: { 'veh.hatchback': 1 } });
    const world = createWorld(level, 89, DEFAULT_TUNING);
    world.phaseTrace = (phase) => {
      if (calls.on) calls.log.push(`phase ${phase}`);
    };
    const input = createInputFrame();
    calls.on = true;
    const ticks = 1500;
    for (let t = 0; t < ticks; t++) world.step(input);
    calls.on = false;
    const perTick: string[] = [];
    for (const name of calls.log) {
      if (name === 'phase 8' || name === 'stepTraffic' || name === 'phase 9') perTick.push(name);
    }
    const expected: string[] = [];
    for (let t = 0; t < ticks; t++) expected.push('phase 8', 'stepTraffic', 'phase 9');
    expect(perTick).toEqual(expected);
    calls.log.length = 0;
    // Phase 8 did its work: a car came in at the portal and queued behind Bessie, honked, and phase 9 filed
    // its Road Rage complaint.
    expect(world.vehicles.count).toBe(1);
    expect(world.traffic.carHorns).toBe(3);
    expect(world.complaints.count).toBe(1);
  });

  it('calls every system of phases 1–11 in the documented order, every tick', () => {
    const level = decodeLevel(
      readFileSync(
        fileURLToPath(new URL('../../public/assets/levels/puddle_lane.json', import.meta.url)),
        'utf8',
      ),
    );
    // A wheelie bin 6 m up Bessie's heading from the depot, so phase 4 knocks something during the run.
    const { x, y, heading } = level.player;
    level.knockables = [
      { id: 'prop.wheelie_bin', x: x + Math.sin(heading) * 6, y: y - Math.cos(heading) * 6 },
    ];
    const world = createWorld(level, 1001, DEFAULT_TUNING);
    world.phaseTrace = (phase) => {
      if (calls.on) calls.log.push(`phase ${phase}`);
    };
    const input = createInputFrame();
    // A sweeping run: lower the brush, drive, spray every other second, raise it again; honk now and then.
    calls.on = true;
    const ticks = 240;
    let collectingTicks = 0;
    for (let t = 0; t < ticks; t++) {
      input.pressed = (t === 0 || t === 200 ? PRESSED.BRUSH : 0) | (t % 50 === 7 ? PRESSED.HORN : 0);
      input.throttle = 180;
      input.buttons = ((t / 60) | 0) % 2 === 1 ? BUTTON.SPRAY : 0;
      world.step(input);
      if (world.brush.collecting) collectingTicks += 1;
    }
    calls.on = false;
    const expected: string[] = [];
    for (let t = 0; t < ticks; t++) expected.push(...ONE_TICK);
    expect(calls.log).toEqual(expected);
    // The run went through the collecting and raised states and sprayed, so the systems did real work.
    expect(collectingTicks).toBeGreaterThan(100);
    expect(world.brush.state).not.toBe(BrushState.Collecting); // raised again at tick 200
    expect(world.vehicle.water).toBeLessThan(DEFAULT_TUNING.water.tankUnits);
    expect(world.complaints.honks).toBe(5);
    expect(world.bodies.bodiesKnocked).toBe(1);
  });
});
