// SSP-046: the JSON-safe SimSnapshot that `__ssp.state()` returns in a shift (TECHNICAL_DESIGN §18.5).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createInputFrame } from '../../src/sim/inputFrame.ts';
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
    expect(snapshotWorld(world)).toEqual({
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
    expect(Object.keys(snap)).toEqual(['tick', 'bessie', 'hp']);
    expect(Object.keys(snap.bessie)).toEqual(['x', 'y', 'heading', 'speed']);
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
