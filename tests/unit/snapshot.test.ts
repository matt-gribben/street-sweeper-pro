// SSP-046: the JSON-safe SimSnapshot that `__ssp.state()` returns in a shift (TECHNICAL_DESIGN §18.5); SSP-065
// adds the M2 sweeping state (score, Tidy %, stars, hopper, water, combo, litter and grime counts, frontages).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BUTTON, createInputFrame, PRESSED } from '../../src/sim/inputFrame.ts';
import { decodeLevel } from '../../src/sim/map.ts';
import { snapshotWorld } from '../../src/sim/snapshot.ts';
import { DEFAULT_TUNING } from '../../src/sim/tuning.ts';
import { createWorld } from '../../src/sim/world.ts';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const puddleLane = () =>
  decodeLevel(readFileSync(`${REPO_ROOT}public/assets/levels/puddle_lane.json`, 'utf8'));

describe('snapshotWorld', () => {
  it('reports tick, Bessie x/y/heading/speed and hp straight from the World', () => {
    const level = puddleLane();
    const world = createWorld(level, 1, DEFAULT_TUNING);
    expect(snapshotWorld(world)).toMatchObject({
      tick: 0,
      bessie: { x: level.player.x, y: level.player.y, heading: level.player.heading, speed: 0 },
      hp: DEFAULT_TUNING.vehicle.sweeper.health.maxHp,
    });
    const input = createInputFrame();
    input.throttle = 255;
    for (let i = 0; i < 30; i++) world.step(input);
    const snap = snapshotWorld(world);
    expect(snap.tick).toBe(30);
    expect(snap.bessie.x).toBe(world.vehicle.xM);
    expect(snap.bessie.y).toBe(world.vehicle.yM);
    expect(snap.bessie.y).toBeLessThan(level.player.y);
    expect(snap.bessie.heading).toBe(world.vehicle.headingRad);
    expect(snap.bessie.speed).toBe(world.vehicle.vLongMps);
    expect(snap.bessie.speed).toBeGreaterThan(0);
    expect(snap.hp).toBe(world.vehicle.hp);
  });

  it('is JSON-safe: a JSON round trip deep-equals it', () => {
    const world = createWorld(puddleLane(), 7, DEFAULT_TUNING);
    const input = createInputFrame();
    input.throttle = 200;
    input.steer = -90;
    for (let i = 0; i < 90; i++) world.step(input);
    const snap = snapshotWorld(world);
    expect(JSON.parse(JSON.stringify(snap))).toEqual(snap);
    expect(Object.keys(snap)).toEqual([
      'tick',
      'bessie',
      'hp',
      'score',
      'tidy',
      'stars',
      'hopper',
      'water',
      'combo',
      'litter',
      'grime',
      'frontages',
    ]);
    expect(Object.keys(snap.bessie)).toEqual(['x', 'y', 'heading', 'speed']);
    expect(Object.keys(snap.hopper)).toEqual(['lu', 'capacityLu', 'full']);
    expect(Object.keys(snap.water)).toEqual(['units', 'capacity']);
    expect(Object.keys(snap.combo)).toEqual(['chain', 'multiplier', 'timerTicks', 'bestChain']);
    expect(Object.keys(snap.litter)).toEqual(['spawned', 'collected']);
    expect(Object.keys(snap.grime)).toEqual(['initial', 'cleaned']);
    expect(Object.keys(snap.frontages[0] ?? {})).toEqual(['id', 'clean', 'cleanSwept']);
  });

  it('reports the M2 sweeping state at shift start: full tank, empty hopper, no chain (SSP-065)', () => {
    const level = puddleLane();
    const world = createWorld(level, 1, DEFAULT_TUNING);
    const snap = snapshotWorld(world);
    expect(snap.score).toBe(0);
    expect(snap.tidy).toBe(0);
    expect(snap.stars).toBe(0);
    expect(snap.hopper).toEqual({ lu: 0, capacityLu: DEFAULT_TUNING.hopper.capacityLu, full: false });
    expect(snap.water).toEqual({
      units: DEFAULT_TUNING.water.tankUnits,
      capacity: DEFAULT_TUNING.water.tankUnits,
    });
    expect(snap.combo).toEqual({ chain: 0, multiplier: 1, timerTicks: 0, bestChain: 0 });
    expect(snap.litter).toEqual({ spawned: world.litter.litterSpawned, collected: 0 });
    expect(snap.litter.spawned).toBe(130);
    expect(snap.grime).toEqual({ initial: 9000, cleaned: 0 });
    expect(snap.frontages.map((f) => f.id)).toEqual(level.frontages.map((f) => f.id));
    expect(snap.frontages.every((f) => f.clean >= 0 && f.clean <= 1 && !f.cleanSwept)).toBe(true);
  });

  it('follows the sweeping state as it changes: score, Tidy %, hopper, water, combo, counts', () => {
    const world = createWorld(puddleLane(), 3, DEFAULT_TUNING);
    // Lower the brush and spray for a second (the tank drains through the World), then set the rest of the
    // state the snapshot reads directly and check each field is read straight through.
    const input = createInputFrame();
    input.pressed = PRESSED.BRUSH;
    world.step(input);
    input.pressed = 0;
    input.buttons = BUTTON.SPRAY;
    for (let i = 0; i < 60; i++) world.step(input);
    const snap = snapshotWorld(world);
    expect(snap.water.units).toBe(world.vehicle.water);
    expect(snap.water.units).toBeLessThan(DEFAULT_TUNING.water.tankUnits); // 60 ticks of spray
    world.vehicle.hopperLU = 42.5;
    world.scoring.score = 321;
    world.scoring.combo.chain = 12;
    world.scoring.combo.multiplier = 2;
    world.scoring.combo.timerTicks = 77;
    world.scoring.combo.bestChain = 15;
    world.tidy.tidy = 0.4375;
    world.tidy.stars = 1;
    world.litter.litterCollected = 5;
    world.dirt.cleanedCells = 1234;
    const set = snapshotWorld(world);
    expect(set.hopper.lu).toBe(42.5);
    expect(set.score).toBe(321);
    expect(set.combo).toEqual({ chain: 12, multiplier: 2, timerTicks: 77, bestChain: 15 });
    expect(set.tidy).toBe(0.4375);
    expect(set.stars).toBe(1);
    expect(set.litter.collected).toBe(5);
    expect(set.grime.cleaned).toBe(1234);
    expect(JSON.parse(JSON.stringify(set))).toEqual(set);
  });

  it('folds −0 into 0 (JSON writes −0 as 0) and throws on a non-finite field', () => {
    const world = createWorld(puddleLane(), 1, DEFAULT_TUNING);
    world.vehicle.vLongMps = -0;
    const snap = snapshotWorld(world);
    expect(Object.is(snap.bessie.speed, 0)).toBe(true);
    expect(JSON.parse(JSON.stringify(snap))).toEqual(snap);
    world.vehicle.headingRad = Number.NaN;
    expect(() => snapshotWorld(world)).toThrow(/bessie\.heading is NaN/);
    world.vehicle.headingRad = 0;
    world.vehicle.hp = Number.POSITIVE_INFINITY;
    expect(() => snapshotWorld(world)).toThrow(/hp is Infinity/);
  });
});
