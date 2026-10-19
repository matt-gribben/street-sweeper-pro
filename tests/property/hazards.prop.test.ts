// Hazard properties (SSP-093; LEVEL_DESIGN §9.3, ENTITY_CATALOG §10, TECHNICAL_DESIGN §8.2 step 10).
//
//   1. Spawning, over seeds: no randomly placed hazard lies within 3 tiles (Chebyshev) of `@`, on a zebra or
//      school crossing, in a depot bay or on/next to a hydrant; random hazards never share a tile; the layout
//      is f(seed). The level is the compiled spawn_specs fixture (zebra, hydrant, depot bays, parking bays),
//      asking for puddles, potholes and oil on all three random rules.
//   2. Driving, over seeds, start states and input scripts across a street of potholes, speed bumps, open
//      manholes and grip hazards: after every tick hopper LU stays in [0, capacity], HP in [0, maxHp], and LU
//      is conserved (hopper LU + the LU of the spilled litter on the street = the starting LU). Since SSP-065
//      a lowered brush can collect a spilled item back: its LU returns to the hopper, less any excess lost when
//      that fills it (GDD §8.4), so with collections the sum may only fall short of the start.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { LITTER_IDS, type LitterId } from '../../src/sim/entities.ts';
import { countEvents, EV } from '../../src/sim/eventQueue.ts';
import { addHazard, createHazardStore, hazardKindIndex, spawnHazards } from '../../src/sim/hazards.ts';
import { createInputFrame, PRESSED } from '../../src/sim/inputFrame.ts';
import { createBlankLevel, decodeLevel, Ground, type Level, surfaceOfGround } from '../../src/sim/map.ts';
import { sfc32 } from '../../src/sim/rng.ts';
import { DEFAULT_ENTITIES, DEFAULT_TUNING } from '../../src/sim/tuning.ts';
import { createWorld, stepWorld } from '../../src/sim/world.ts';
import { compileLevel, readManifestIds } from '../../tools/levels/compile-level.ts';
import { KERB_BLOB_PATH, readKerbBlob } from '../../tools/levels/kerbBlob.ts';
import { assertProperty } from '../support/fcCheck.ts';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const FIXTURES = 'tests/fixtures/levels';

/** The spawn_specs fixture with random puddles, potholes and oil on every rule, compiled and decoded. */
function compiledFixture(): Level {
  const text = (ext: string): string =>
    readFileSync(join(REPO_ROOT, FIXTURES, 'spawn_specs', `spawn_specs.${ext}`), 'utf8');
  const doc = JSON.parse(text('level.json')) as Record<string, unknown>;
  doc.hazards = {
    place: [{ id: 'haz.pothole', at: [30.5, 3.5] }],
    random: [
      { id: 'haz.puddle', count: 6, rule: 'kerbside_low_points' },
      { id: 'haz.pothole', count: 4, rule: 'carriageway' },
      { id: 'haz.oil_slick', count: 3, rule: 'near_parking' },
    ],
  };
  const result = compileLevel({
    name: 'spawn_specs',
    mapText: text('map.txt'),
    levelText: `${JSON.stringify(doc, null, 2)}\n`,
    knownAssetIds: readManifestIds(join(REPO_ROOT, FIXTURES, 'manifest.json')),
    kerbBlob: readKerbBlob(join(REPO_ROOT, KERB_BLOB_PATH)),
  });
  const errors = result.diagnostics.filter((d) => d.severity === 'error');
  if (result.output === null || errors.length > 0) {
    throw new Error(`spawn_specs did not compile: ${errors.map((d) => d.message).join('; ')}`);
  }
  return decodeLevel(result.output.text);
}

describe('hazard spawning over seeds (LEVEL_DESIGN §9.3)', () => {
  const level = compiledFixture();
  const [w, h] = level.size;
  const start = [Math.floor(level.player.x / 2), Math.floor(level.player.y / 2)] as const;
  const inSites = (ids: readonly string[], col: number, row: number): boolean =>
    level.sites.some(
      (s) => ids.includes(s.id) && col >= s.rect[0] && col < s.rect[2] && row >= s.rect[1] && row < s.rect[3],
    );
  const hydrants = level.props
    .filter((p) => p.id === 'prop.hydrant')
    .map((p) => [Math.floor(p.x / 2), Math.floor(p.y / 2)] as const);
  const fixed =
    level.sites.filter((s) => s.id === 'haz.speed_bump').length + (level.hazards?.place.length ?? 0);

  it('the fixture has every exclusion the property checks', () => {
    expect(hydrants.length).toBeGreaterThan(0);
    expect(level.sites.some((s) => s.id === 'site.zebra')).toBe(true);
    expect(level.sites.some((s) => s.id === 'site.depot_bay')).toBe(true);
    expect(level.hazards?.random.length).toBe(3);
  });

  it('never places a random hazard within 3 tiles of @, on a zebra, in a depot bay or next to a hydrant', () => {
    assertProperty(
      fc.property(fc.integer({ min: 0, max: 0xffffffff }), (seed) => {
        const store = createHazardStore(level, DEFAULT_ENTITIES, sfc32(1));
        const n = spawnHazards(store, level, seed);
        expect(n).toBe(fixed + 6 + 4 + 3);
        const tiles = new Set<number>();
        for (let i = fixed; i < store.count; i++) {
          const col = store.col0[i] as number;
          const row = store.row0[i] as number;
          expect(store.col1[i]).toBe(col + 1);
          expect(store.row1[i]).toBe(row + 1);
          expect(col >= 0 && col < w && row >= 0 && row < h).toBe(true);
          expect(Math.max(Math.abs(col - start[0]), Math.abs(row - start[1]))).toBeGreaterThan(3);
          expect(inSites(['site.zebra', 'site.school_crossing'], col, row)).toBe(false);
          expect(inSites(['site.depot_bay', 'site.skip'], col, row)).toBe(false);
          for (const [hx, hy] of hydrants) {
            expect(Math.max(Math.abs(col - hx), Math.abs(row - hy))).toBeGreaterThan(1);
          }
          const t = row * w + col;
          expect(tiles.has(t)).toBe(false);
          tiles.add(t);
        }
        // f(seed): a second spawn with the same seed is identical.
        const again = createHazardStore(level, DEFAULT_ENTITIES, sfc32(2));
        spawnHazards(again, level, seed);
        expect(Array.from(again.col0.subarray(0, again.count))).toEqual(
          Array.from(store.col0.subarray(0, store.count)),
        );
        expect(Array.from(again.row0.subarray(0, again.count))).toEqual(
          Array.from(store.row0.subarray(0, store.count)),
        );
      }),
      { seed: 0x5ea093, numRuns: 200 },
    );
  });
});

/** A 40 × 20 road with a row of hazards Bessie can drive over in every direction. */
function hazardStreet(): Level {
  const level = createBlankLevel('test.hazard_street', 40, 20);
  for (let i = 0; i < 40 * 20; i++) {
    level.layers.ground[i] = Ground.Road;
    level.layers.surface[i] = surfaceOfGround(Ground.Road);
  }
  level.player = { x: 40, y: 20, heading: Math.PI / 2 };
  return level;
}

describe('HP and hopper LU stay in range while driving over hazards', () => {
  const POTHOLE = hazardKindIndex('haz.pothole');
  const BUMP = hazardKindIndex('haz.speed_bump');
  const MANHOLE = hazardKindIndex('haz.open_manhole');
  const PUDDLE = hazardKindIndex('haz.puddle');
  const OIL = hazardKindIndex('haz.oil_slick');
  const maxHp = DEFAULT_TUNING.vehicle.sweeper.health.maxHp;
  const capacity = DEFAULT_TUNING.hopper.capacityLu;

  const segmentArb = fc.record({
    ticks: fc.integer({ min: 1, max: 120 }),
    throttle: fc.integer({ min: 80, max: 255 }),
    brake: fc.constantFrom(0, 0, 0, 255),
    steer: fc.integer({ min: -60, max: 60 }),
    brush: fc.boolean(),
  });

  it('keeps 0 ≤ hopper LU ≤ capacity, 0 ≤ HP ≤ maxHp and conserves LU', () => {
    // Over all runs, so the property is known to have exercised jolts, spills and hard stops.
    let jolts = 0;
    let stops = 0;
    let spills = 0;
    assertProperty(
      fc.property(
        fc.integer({ min: 0, max: 0xffffffff }),
        fc.integer({ min: 0, max: capacity * 2 }).map((half) => half / 2),
        fc.integer({ min: 1, max: maxHp }),
        fc.array(segmentArb, { minLength: 1, maxLength: 12 }),
        (seed, startLu, startHp, segments) => {
          const world = createWorld(hazardStreet(), seed, DEFAULT_TUNING);
          // A grid of hazards over the middle of the street: potholes, bumps, manholes, puddles, oil.
          const kinds = [POTHOLE, BUMP, MANHOLE, PUDDLE, OIL, POTHOLE];
          let k = 0;
          for (let row = 5; row < 16; row += 2) {
            for (let col = 22; col < 39; col += 2) {
              addHazard(world.hazards, kinds[k % kinds.length] as number, col, row, col + 1, row + 1);
              k++;
            }
          }
          world.vehicle.hopperLU = startLu;
          world.hopper.full = startLu >= capacity;
          world.vehicle.hp = startHp;
          const input = createInputFrame();
          let collected = 0;
          for (const seg of segments) {
            input.throttle = seg.throttle;
            input.brake = seg.brake;
            input.steer = seg.steer;
            for (let t = 0; t < seg.ticks; t++) {
              input.pressed = t === 0 && seg.brush ? PRESSED.BRUSH : 0;
              stepWorld(world, input);
              jolts += countEvents(world.events, EV.HazardJolt);
              stops += countEvents(world.events, EV.HazardStop);
              collected += countEvents(world.events, EV.LitterCollected);
              const lu = world.vehicle.hopperLU;
              expect(lu).toBeGreaterThanOrEqual(0);
              expect(lu).toBeLessThanOrEqual(capacity);
              expect(world.vehicle.hp).toBeGreaterThanOrEqual(0);
              expect(world.vehicle.hp).toBeLessThanOrEqual(maxHp);
            }
          }
          let spilled = 0;
          for (let i = 0; i < world.litter.count; i++) {
            spilled += DEFAULT_ENTITIES.litter[LITTER_IDS[world.litter.kind[i] as number] as LitterId].lu;
          }
          if (collected === 0) expect(world.vehicle.hopperLU + spilled).toBe(startLu);
          else expect(world.vehicle.hopperLU + spilled).toBeLessThanOrEqual(startLu);
          if (spilled > 0) spills++;
          expect(world.litter.litterCollected).toBe(collected);
          expect(world.litter.litterSpawned).toBe(world.litter.count + collected);
        },
      ),
      { seed: 0x093093, numRuns: 150 },
    );
    expect(jolts).toBeGreaterThan(50);
    expect(stops).toBeGreaterThan(20);
    expect(spills).toBeGreaterThan(20);
  });
});
