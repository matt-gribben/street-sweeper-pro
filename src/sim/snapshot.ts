// SimSnapshot (TECHNICAL_DESIGN §18.5, SSP-046): the JSON-safe summary of a World that `window.__ssp.state()`
// returns in a shift scene, so Playwright specs and scripted checks can read the sim across `page.evaluate`.
//
// JSON-safe means `JSON.parse(JSON.stringify(s))` deep-equals `s`: plain objects of finite numbers only (no
// typed arrays, no undefined, no NaN or ±Infinity, and no −0, which JSON writes as 0). snapshotWorld folds −0
// into 0 and throws on a non-finite value, which would be a sim bug rather than something to paper over.
//
// Fields by milestone (each issue extends this type and §18.5 together):
//   M1 (SSP-046)  tick, bessie { x, y, heading, speed }, hp;
//   M2 (SSP-065)  score, tidy, hopper;
//   M3 (SSP-078)  complaints.
//
// Load-time / test-time code: it allocates a fresh object per call and is never called per tick.
import type { WorldView } from './world.ts';

/** Bessie's part of a SimSnapshot: body centre and heading straight from the sim (not interpolated). */
export type SimBessieSnapshot = {
  /** Body centre, sim metres east of the map's NW corner. */
  readonly x: number;
  /** Body centre, sim metres south of the map's NW corner. */
  readonly y: number;
  /** Heading in radians, 0 = north, clockwise; not wrapped (the sim never wraps it, §8.1). */
  readonly heading: number;
  /** Longitudinal speed vLong in m/s: along the heading, negative while reversing. */
  readonly speed: number;
};

/** What `__ssp.state()` reports about the sim from M1. */
export type SimSnapshot = {
  /** Ticks completed since shift start (World.tick). */
  readonly tick: number;
  readonly bessie: SimBessieSnapshot;
  /** Bessie's Dignity, 0..health.maxHp. */
  readonly hp: number;
};

/** `value` as a JSON-safe number: −0 becomes 0; NaN and ±Infinity throw, naming `field`. */
function jsonNumber(value: number, field: string): number {
  if (!Number.isFinite(value)) throw new Error(`SimSnapshot: ${field} is ${value}, not a finite number`);
  return value + 0;
}

/** A JSON-safe snapshot of `world` as it stands after its last tick. */
export function snapshotWorld(world: WorldView): SimSnapshot {
  const v = world.vehicle;
  return {
    tick: jsonNumber(world.tick, 'tick'),
    bessie: {
      x: jsonNumber(v.xM, 'bessie.x'),
      y: jsonNumber(v.yM, 'bessie.y'),
      heading: jsonNumber(v.headingRad, 'bessie.heading'),
      speed: jsonNumber(v.vLongMps, 'bessie.speed'),
    },
    hp: jsonNumber(v.hp, 'hp'),
  };
}
