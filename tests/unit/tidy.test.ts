// Tidy %, per-frontage clean % and Clean Sweep (SSP-064; GDD §9.2, §9.3, §12.1; TECHNICAL_DESIGN §10.3):
// the formula against hand-computed fixtures (the 9,000 / 4,500 / 130 / 65 acceptance case), per-frontage
// counters on a hand-built map with overlapping zones (litter counted where it spawned, the empty-zone and
// one-share rules, pledges at ≥ 90%), Clean Sweep +100 exactly once, the stars helper at its boundaries, the
// zone tally against a brute-force recount on Puddle Lane with the real stepDirt erase, and zero allocation.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GRIME_CELL_M, TILE_M } from '../../src/sim/constants.ts';
import { createDirt, type Dirt, initGrime, stepDirt } from '../../src/sim/dirt.ts';
import {
  addLitter,
  collectLitter,
  createLitterField,
  type LitterField,
  removeLitter,
  spawnInitialLitter,
  updateLitterCell,
} from '../../src/sim/litter.ts';
import {
  createBlankLevel,
  decodeLevel,
  type Frontage,
  GUTTER_CELLS_PER_TILE,
  type Level,
} from '../../src/sim/map.ts';
import { createScoring } from '../../src/sim/scoring.ts';
import {
  createTidy,
  initTidy,
  isFrontageSpotless,
  setTidyTuning,
  starsForTidy,
  stepTidy,
  TIDY_PPM,
  type Tidy,
  tidyFraction,
  tidyPpm,
  viewTidy,
} from '../../src/sim/tidy.ts';
import { DEFAULT_ENTITIES, DEFAULT_TUNING, loadTuning } from '../../src/sim/tuning.ts';
import { createVehicleState } from '../../src/sim/vehicle.ts';
import { createZoneTally, takeChangedZones, tallyGrimeCleaned } from '../../src/sim/zoneTally.ts';
import { assertHeapDeltaWithinThresholds, measureHeapDelta } from '../support/heapDelta.ts';

const REPO_ROOT = new URL('../../', import.meta.url).pathname;
const W = DEFAULT_TUNING.tidy;
const STARS = DEFAULT_TUNING.stars;

describe('Tidy % formula (GDD §9.2)', () => {
  it('9,000 initial cells, 4,500 cleaned, 130 spawned, 65 collected → exactly 0.5', () => {
    expect(tidyFraction(W, 4500, 9000, 65, 130)).toBe(0.5);
    expect(tidyPpm(W, 4500, 9000, 65, 130)).toBe(500_000);
  });

  it('matches hand-computed values', () => {
    // 0.6 × 9,000/9,000 + 0.4 × 0/130 = 0.6
    expect(tidyFraction(W, 9000, 9000, 0, 130)).toBe(0.6);
    // 0.6 × 0 + 0.4 × 1 = 0.4
    expect(tidyFraction(W, 0, 9000, 130, 130)).toBe(0.4);
    // 0.6 × 6,300/9,000 + 0.4 × 104/130 = 0.42 + 0.32 = 0.74
    expect(tidyFraction(W, 6300, 9000, 104, 130)).toBe(0.74);
    // 0.6 × 1 + 0.4 × 0.5 = 0.8 exactly (a 2★ boundary), whatever the last bit of the double sum
    expect(tidyFraction(W, 9000, 9000, 65, 130)).toBe(0.8);
    // 0.6 × 1/3 + 0.4 × 2/7 = 0.2 + 0.1142857… = 0.314286 (to the ppm)
    expect(tidyFraction(W, 3000, 9000, 2, 7)).toBe(0.314286);
    expect(tidyFraction(W, 9000, 9000, 130, 130)).toBe(1);
    expect(tidyFraction(W, 0, 9000, 0, 130)).toBe(0);
  });

  it('leaves out an empty share and gives the other its whole weight; nothing at all is 100%', () => {
    expect(tidyFraction(W, 45, 50, 0, 0)).toBe(0.9);
    expect(tidyFraction(W, 0, 0, 3, 4)).toBe(0.75);
    expect(tidyFraction(W, 0, 0, 0, 0)).toBe(1);
  });

  it('reads the global counters through stepTidy, with the would-be stars', () => {
    const level = createBlankLevel('formula', 4, 4);
    const tidy = createTidy(level, DEFAULT_TUNING);
    const scoring = createScoring(DEFAULT_TUNING, DEFAULT_ENTITIES);
    stepTidy(
      tidy,
      { initialCells: 9000, cleanedCells: 4500 },
      { litterSpawned: 130, litterCollected: 65 },
      scoring,
    );
    expect(tidy.tidy).toBe(0.5);
    expect(tidy.tidyPpm).toBe(500_000);
    expect(tidy.stars).toBe(0);
    stepTidy(
      tidy,
      { initialCells: 9000, cleanedCells: 9000 },
      { litterSpawned: 130, litterCollected: 65 },
      scoring,
    );
    expect(tidy.tidy).toBe(0.8);
    expect(tidy.stars).toBe(2);
    expect(scoring.score).toBe(0);
  });
});

describe('stars helper (GDD §12.1)', () => {
  it('returns 0/1/2/3 at 0.599/0.60/0.80/0.92', () => {
    expect(starsForTidy(0.599, STARS)).toBe(0);
    expect(starsForTidy(0.6, STARS)).toBe(1);
    expect(starsForTidy(0.8, STARS)).toBe(2);
    expect(starsForTidy(0.92, STARS)).toBe(3);
  });

  it('covers the bands and is not fooled by the last bit of a double', () => {
    expect(starsForTidy(0, STARS)).toBe(0);
    expect(starsForTidy(0.5999994, STARS)).toBe(0);
    expect(starsForTidy(0.79, STARS)).toBe(1);
    expect(starsForTidy(0.919999, STARS)).toBe(2);
    expect(starsForTidy(1, STARS)).toBe(3);
    // 0.6 × 0.8 + 0.4 × 0.8 is 0.8000000000000002 or 0.7999999999999999 depending on order; both are 2★.
    expect(starsForTidy(0.7999999999999999, STARS)).toBe(2);
    expect(starsForTidy(0.6 * (2 / 3) + 0.4 * 0.5, STARS)).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------------------
// A hand-built map
// ---------------------------------------------------------------------------------------------------------

/** An 8 × 4 tile blank level with four frontages (A and B share tile (1, 1); C is empty; D is a pledge). */
function fixtureLevel(): Level {
  const level = createBlankLevel('frontages', 8, 4);
  const fr = (id: string, pledge: boolean, cells: [number, number][]): Frontage => ({
    id,
    pledge,
    rect: [0, 0, 8, 4],
    face: 's',
    cells,
  });
  level.frontages = [
    fr('fr_a', false, [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ]),
    fr('fr_b', false, [
      [1, 1],
      [2, 1],
      [1, 2],
      [2, 2],
    ]),
    fr('fr_c', false, [[6, 0]]),
    fr('fr_d', true, [
      [4, 0],
      [4, 1],
    ]),
  ];
  return level;
}

const A = 0;
const B = 1;
const C = 2;
const D = 3;

/** Lay `n` grime cells in tile (tx, ty), row-major from its first cell, and count them in initialCells. */
function lay(dirt: Dirt, tx: number, ty: number, n: number): void {
  for (let k = 0; k < n; k += 1) {
    const cx = tx * GUTTER_CELLS_PER_TILE + (k % GUTTER_CELLS_PER_TILE);
    const cy = ty * GUTTER_CELLS_PER_TILE + Math.floor(k / GUTTER_CELLS_PER_TILE);
    dirt.mask[cy * dirt.maskW + cx] = 100;
  }
  dirt.initialCells += n;
}

/** Clean the first `n` grimy cells of tile (tx, ty) the way stepDirt does (mask, counters, zone tally). */
function clean(dirt: Dirt, tx: number, ty: number, n: number): void {
  let left = n;
  for (let cy = ty * GUTTER_CELLS_PER_TILE; cy < (ty + 1) * GUTTER_CELLS_PER_TILE && left > 0; cy += 1) {
    for (let cx = tx * GUTTER_CELLS_PER_TILE; cx < (tx + 1) * GUTTER_CELLS_PER_TILE && left > 0; cx += 1) {
      const i = cy * dirt.maskW + cx;
      if (dirt.mask[i] === 0) continue;
      dirt.mask[i] = 0;
      dirt.cleanedCells += 1;
      if (dirt.zones !== null) tallyGrimeCleaned(dirt.zones, ty * dirt.tilesW + tx);
      left -= 1;
    }
  }
  expect(left).toBe(0);
}

/** Add an item of kind 0 at the centre of tile (tx, ty). */
function drop(field: LitterField, tx: number, ty: number): number {
  return addLitter(field, 0, (tx + 0.5) * TILE_M, (ty + 0.5) * TILE_M, 0);
}

/** The live item spawned at tile (tx, ty)'s centre. */
function itemAt(field: LitterField, tx: number, ty: number): number {
  for (let i = 0; i < field.count; i += 1) {
    if (field.x[i] === (tx + 0.5) * TILE_M && field.y[i] === (ty + 0.5) * TILE_M) return i;
  }
  throw new Error(`no item at tile (${tx}, ${ty})`);
}

type Fixture = {
  level: Level;
  dirt: Dirt;
  field: LitterField;
  tidy: Tidy;
  scoring: ReturnType<typeof createScoring>;
};

/**
 * The fixture at shift start. Grime: (0, 0) 10, (1, 1) 20 (shared by A and B), (2, 2) 6, (4, 0) 50, (7, 3) 14
 * outside every zone: 100 cells. Litter: (0, 1), (1, 0), (1, 1) shared, (2, 1), and two at (7, 3): 6 items.
 * So A has 30 cells and 3 items, B 26 cells and 2 items, C nothing, D 50 cells and no litter.
 */
function fixture(): Fixture {
  const level = fixtureLevel();
  const dirt = createDirt(level, DEFAULT_TUNING);
  lay(dirt, 0, 0, 10);
  lay(dirt, 1, 1, 20);
  lay(dirt, 2, 2, 6);
  lay(dirt, 4, 0, 50);
  lay(dirt, 7, 3, 14);
  const field = createLitterField(level, DEFAULT_TUNING, DEFAULT_ENTITIES);
  drop(field, 0, 1);
  drop(field, 1, 0);
  drop(field, 1, 1);
  drop(field, 2, 1);
  addLitter(field, 0, 7.5 * TILE_M, 3.25 * TILE_M, 0);
  addLitter(field, 0, 7.5 * TILE_M, 3.75 * TILE_M, 0);
  const tidy = createTidy(level, DEFAULT_TUNING);
  initTidy(tidy, dirt, field);
  return { level, dirt, field, tidy, scoring: createScoring(DEFAULT_TUNING, DEFAULT_ENTITIES) };
}

function step(f: Fixture): void {
  stepTidy(f.tidy, f.dirt, f.field, f.scoring);
}

describe('per-frontage clean % (GDD §9.3, LEVEL_DESIGN §7.10)', () => {
  it('counts each zone’s grime and spawned litter at shift start, shared tiles in both zones', () => {
    const { tidy } = fixture();
    const z = tidy.zones;
    expect([...z.grimeInitial]).toEqual([30, 26, 0, 50]);
    expect([...z.litterSpawned]).toEqual([3, 2, 0, 0]);
    expect([...z.grimeCleaned]).toEqual([0, 0, 0, 0]);
    expect([...z.litterCollected]).toEqual([0, 0, 0, 0]);
    expect([...tidy.frontageClean]).toEqual([0, 0, 1, 0]);
    expect(tidy.frontageIds).toEqual(['fr_a', 'fr_b', 'fr_c', 'fr_d']);
    expect(tidy.tidy).toBe(0);
    expect(tidy.stars).toBe(0);
  });

  it('matches hand-computed values as cells are cleaned and litter collected', () => {
    const f = fixture();
    const { dirt, field, tidy } = f;
    clean(dirt, 0, 0, 10); // A 10/30
    clean(dirt, 1, 1, 5); // A 15/30, B 5/26
    clean(dirt, 4, 0, 45); // D 45/50
    // The shared item is flung across the map before it is collected: it still counts where it spawned.
    const shared = itemAt(field, 1, 1);
    field.x[shared] = 7.25 * TILE_M;
    field.y[shared] = 3.5 * TILE_M;
    updateLitterCell(field, shared);
    expect(collectLitter(field, shared)).toBe(true);
    step(f);
    // A: 0.6 × 15/30 + 0.4 × 1/3 = 0.3 + 0.133333 = 0.433333
    expect(tidy.frontageClean[A]).toBe(0.433333);
    // B: 0.6 × 5/26 + 0.4 × 1/2 = 0.115385 + 0.2 = 0.315385
    expect(tidy.frontageClean[B]).toBe(0.315385);
    // C: empty, 100%
    expect(tidy.frontageClean[C]).toBe(1);
    // D: grime only, 45/50 = 0.9: a good pledge
    expect(tidy.frontageClean[D]).toBe(0.9);
    expect([...tidy.pledgeMet]).toEqual([0, 0, 0, 1]);
    expect(tidy.pledgesMet).toBe(1);
    // Global: 0.6 × 60/100 + 0.4 × 1/6 = 0.36 + 0.066667 = 0.426667
    expect(tidy.tidy).toBe(0.426667);
    expect(tidy.cleanSweeps).toBe(0);
    expect(f.scoring.score).toBe(0);

    // Collect one of A's items where it lies: A 0.3 + 0.4 × 2/3 = 0.566667.
    expect(collectLitter(field, itemAt(field, 0, 1))).toBe(true);
    step(f);
    expect(tidy.frontageClean[A]).toBe(0.566667);
    expect(tidy.frontageClean[B]).toBe(0.315385);
    // Litter spawned in D (dynamic) gives it a litter share: 0.6 × 0.9 + 0.4 × 0 = 0.54, no longer good.
    drop(field, 4, 1);
    step(f);
    expect(tidy.frontageClean[D]).toBe(0.54);
    expect(tidy.pledgesMet).toBe(0);
  });

  it('only recomputes the frontages whose counters moved', () => {
    const f = fixture();
    clean(f.dirt, 0, 0, 1);
    expect(f.tidy.zones.changedCount).toBe(1);
    expect(f.tidy.zones.changedList[0]).toBe(A);
    step(f);
    expect(f.tidy.zones.changedCount).toBe(0);
    expect(takeChangedZones(f.tidy.zones)).toBe(0);
  });

  it('keeps items outside every zone and off the map out of every zone', () => {
    const f = fixture();
    const before = [...f.tidy.zones.litterSpawned];
    addLitter(f.field, 0, -3, 2, 0);
    addLitter(f.field, 0, 7.9 * TILE_M, 0.5, 0);
    step(f);
    expect([...f.tidy.zones.litterSpawned]).toEqual(before);
    expect(f.field.spawnTile[f.field.count - 2]).toBe(-1);
    expect(f.field.spawnTile[f.field.count - 1]).toBe(7);
  });
});

describe('Clean Sweep (GDD §9.3)', () => {
  it('awards +100 once when a frontage reaches 100%, even if more litter later spawns in it', () => {
    const f = fixture();
    const { dirt, field, tidy, scoring } = f;
    clean(dirt, 0, 0, 10);
    clean(dirt, 1, 1, 20);
    for (const [tx, ty] of [
      [0, 1],
      [1, 0],
    ] as const) {
      collectLitter(field, itemAt(field, tx, ty));
    }
    step(f);
    expect(tidy.frontageClean[A]).toBeLessThan(1); // the shared item is still out
    expect(tidy.cleanSweeps).toBe(0);
    collectLitter(field, itemAt(field, 1, 1));
    step(f);
    expect(tidy.frontageClean[A]).toBe(1);
    expect(isFrontageSpotless(viewTidy(tidy), A)).toBe(true);
    expect(tidy.cleanSwept[A]).toBe(1);
    expect(tidy.cleanSweeps).toBe(1);
    expect(scoring.bonusPts).toBe(100);
    expect(scoring.score).toBe(100);
    // Not multiplied and no chain effect.
    expect(scoring.combo.chain).toBe(0);
    expect(scoring.itemPts).toBe(0);

    // More litter spawns in A: its % falls; collecting it brings A back to 100% without a second award.
    drop(field, 0, 0);
    step(f);
    expect(tidy.frontageClean[A]).toBe(0.9); // 0.6 × 30/30 + 0.4 × 3/4
    collectLitter(field, itemAt(field, 0, 0));
    step(f);
    expect(tidy.frontageClean[A]).toBe(1);
    for (let t = 0; t < 10; t += 1) step(f);
    expect(tidy.cleanSweeps).toBe(1);
    expect(scoring.bonusPts).toBe(100);
  });

  it('awards each of two overlapping frontages completed on the same tick', () => {
    const f = fixture();
    const { dirt, field, tidy, scoring } = f;
    clean(dirt, 0, 0, 10);
    clean(dirt, 2, 2, 6);
    for (const [tx, ty] of [
      [0, 1],
      [1, 0],
      [2, 1],
    ] as const) {
      collectLitter(field, itemAt(field, tx, ty));
    }
    step(f);
    expect(tidy.cleanSweeps).toBe(0);
    // The shared tile finishes both A and B.
    clean(dirt, 1, 1, 20);
    collectLitter(field, itemAt(field, 1, 1));
    step(f);
    expect([...tidy.cleanSwept]).toEqual([1, 1, 0, 0]);
    expect(scoring.bonusPts).toBe(200);
  });

  it('never awards an empty frontage, and needs the exact counts (not a rounded 100%)', () => {
    const f = fixture();
    step(f);
    expect(f.tidy.frontageClean[C]).toBe(1);
    expect(f.tidy.cleanSwept[C]).toBe(0);
    expect(isFrontageSpotless(viewTidy(f.tidy), C)).toBe(false);
    // 1,999,999 of 2,000,000 cells rounds to 100% but is not spotless.
    const z = f.tidy.zones;
    z.grimeInitial[D] = 2_000_000;
    z.grimeCleaned[D] = 1_999_998;
    tallyGrimeCleaned(z, 4); // tile (4, 0)
    step(f);
    expect(tidyPpm(f.tidy, 1_999_999, 2_000_000, 0, 0)).toBe(TIDY_PPM);
    expect(f.tidy.frontageClean[D]).toBe(1);
    expect(f.tidy.cleanSwept[D]).toBe(0);
    expect(f.scoring.bonusPts).toBe(0);
  });

  it('a removed (not collected) item keeps its frontage below 100%', () => {
    const f = fixture();
    const { dirt, field, tidy } = f;
    clean(dirt, 2, 2, 6);
    clean(dirt, 1, 1, 20);
    collectLitter(field, itemAt(field, 1, 1));
    removeLitter(field, itemAt(field, 2, 1)); // a splat or a leaf pile driven through
    step(f);
    expect(tidy.frontageClean[B]).toBe(0.8);
    expect(tidy.cleanSwept[B]).toBe(0);
  });

  it('starts every shift with no Clean Sweeps (initTidy resets)', () => {
    const f = fixture();
    clean(f.dirt, 4, 0, 50);
    step(f);
    expect(f.tidy.cleanSwept[D]).toBe(1);
    const fresh = fixture();
    expect(fresh.tidy.cleanSweeps).toBe(0);
    expect([...fresh.tidy.cleanSwept]).toEqual([0, 0, 0, 0]);
  });

  it('uses scoring.cleanSweepPts and the tuned thresholds (setTidyTuning)', () => {
    const f = fixture();
    const raw = JSON.parse(readFileSync(`${REPO_ROOT}src/data/tuning.json`, 'utf8')) as {
      scoring: { cleanSweepPts: number };
      tidy: { frontageGoodMinClean: number };
    };
    raw.scoring.cleanSweepPts = 150;
    raw.tidy.frontageGoodMinClean = 0.5;
    setTidyTuning(f.tidy, loadTuning(raw), f.dirt, f.field);
    clean(f.dirt, 4, 0, 25);
    step(f);
    expect(f.tidy.pledgeMet[D]).toBe(1);
    clean(f.dirt, 4, 0, 25);
    step(f);
    expect(f.scoring.bonusPts).toBe(150);
  });
});

describe('zone tally', () => {
  it('builds the tile → zones map, deduplicating and rejecting off-map tiles', () => {
    const t = createZoneTally(3, 2, [
      [
        [0, 0],
        [0, 0],
        [2, 1],
      ],
      [[2, 1]],
    ]);
    expect([...t.zoneTiles]).toEqual([2, 1]);
    expect([...t.tileStart]).toEqual([0, 1, 1, 1, 1, 1, 3]);
    expect([...t.zoneList]).toEqual([0, 0, 1]);
    expect(() => createZoneTally(3, 2, [[[3, 0]]])).toThrow(/outside the 3 × 2 map/);
  });

  it('refuses to start mid-shift', () => {
    const f = fixture();
    collectLitter(f.field, 0);
    expect(() => initTidy(f.tidy, f.dirt, f.field)).toThrow(/shift start/);
  });
});

describe('Puddle Lane with the real erase (TECHNICAL_DESIGN §10.3)', () => {
  const level = decodeLevel(readFileSync(`${REPO_ROOT}public/assets/levels/puddle_lane.json`, 'utf8'));

  /** Brute force: per frontage, grimy cells of its tiles in `mask` and live/collected item counts. */
  function grimeIn(mask: Uint8Array, maskW: number, cells: readonly (readonly [number, number])[]): number {
    let n = 0;
    for (const [tx, ty] of cells) {
      for (let cy = ty * 8; cy < ty * 8 + 8; cy += 1) {
        for (let cx = tx * 8; cx < tx * 8 + 8; cx += 1) if (mask[cy * maskW + cx] !== 0) n += 1;
      }
    }
    return n;
  }

  it('keeps every frontage counter equal to a recount while Bessie sweeps a street', () => {
    const dirt = createDirt(level, DEFAULT_TUNING);
    initGrime(dirt, level, 1001);
    const field = createLitterField(level, DEFAULT_TUNING, DEFAULT_ENTITIES);
    spawnInitialLitter(field, level, 1001);
    const tidy = createTidy(level, DEFAULT_TUNING);
    initTidy(tidy, dirt, field);
    const scoring = createScoring(DEFAULT_TUNING, DEFAULT_ENTITIES);
    const initial = dirt.mask.slice();
    let sumInitial = 0;
    for (let z = 0; z < tidy.frontageCount; z += 1) {
      const cells = level.frontages[z]?.cells ?? [];
      expect(tidy.zones.grimeInitial[z]).toBe(grimeIn(initial, dirt.maskW, cells));
      sumInitial += tidy.zones.grimeInitial[z] as number;
    }
    expect(sumInitial).toBeGreaterThan(0);
    expect(tidy.zones.litterSpawned.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
    expect(tidy.tidy).toBe(0);

    // Sweep every row of the map east and west, a pass per 2 m, collecting litter under the footprint.
    const pose = createVehicleState(DEFAULT_TUNING.vehicle.sweeper, 0, 0, Math.PI / 2);
    let last = 0;
    for (let y = 1; y < level.size[1] * TILE_M; y += 2) {
      for (let x = 0; x < level.size[0] * TILE_M; x += 0.1) {
        pose.xM = x;
        pose.yM = y;
        stepDirt(dirt, pose, true);
        for (let i = field.count - 1; i >= 0; i -= 1) {
          const dx = (field.x[i] as number) - (x + 1.75);
          const dy = (field.y[i] as number) - y;
          if (dx * dx + dy * dy < 1) collectLitter(field, i);
        }
        stepTidy(tidy, dirt, field, scoring);
        expect(tidy.tidy).toBeGreaterThanOrEqual(last);
        last = tidy.tidy;
      }
    }
    expect(dirt.cleanedCells).toBeGreaterThan(0);
    for (let z = 0; z < tidy.frontageCount; z += 1) {
      const cells = level.frontages[z]?.cells ?? [];
      const initialZ = tidy.zones.grimeInitial[z] as number;
      expect(tidy.zones.grimeCleaned[z]).toBe(initialZ - grimeIn(dirt.mask, dirt.maskW, cells));
    }
    expect(tidy.tidy).toBe(
      tidyFraction(W, dirt.cleanedCells, dirt.initialCells, field.litterCollected, field.litterSpawned),
    );
    expect(scoring.bonusPts).toBe(tidy.cleanSweeps * DEFAULT_TUNING.scoring.cleanSweepPts);
    for (let z = 0; z < tidy.frontageCount; z += 1) {
      expect(tidy.cleanSwept[z] === 1).toBe(isFrontageSpotless(tidy, z));
    }
    // Some frontage should have been swept spotless by a full-map sweep.
    expect(tidy.cleanSweeps).toBeGreaterThan(0);
    expect(GRIME_CELL_M).toBe(TILE_M / GUTTER_CELLS_PER_TILE);
  });
});

describe('zero allocation', () => {
  it('stepDirt with zones attached, collectLitter and stepTidy allocate nothing per tick', () => {
    const level = decodeLevel(readFileSync(`${REPO_ROOT}public/assets/levels/puddle_lane.json`, 'utf8'));
    const dirt = createDirt(level, DEFAULT_TUNING);
    const field = createLitterField(level, DEFAULT_TUNING, DEFAULT_ENTITIES);
    const tidy = createTidy(level, DEFAULT_TUNING);
    const scoring = createScoring(DEFAULT_TUNING, DEFAULT_ENTITIES);
    const pose = createVehicleState(DEFAULT_TUNING.vehicle.sweeper, 0, 0, Math.PI / 2);
    const rows = level.size[1] * TILE_M;
    const cols = level.size[0] * TILE_M;
    initGrime(dirt, level, 1001);
    spawnInitialLitter(field, level, 1001);
    initTidy(tidy, dirt, field);
    const tick = (t: number): void => {
      // A raster sweep of the map, 0.1 m a tick, 2 m between rows (laps after ~5 minutes).
      const lap = t % 60_000;
      pose.xM = (lap * 0.1) % cols;
      pose.yM = (1 + 2 * Math.floor((lap * 0.1) / cols)) % rows;
      stepDirt(dirt, pose, true);
      if (t % 7 === 0) {
        // Dynamic litter on integer metres (no boxed double arguments), collected at once or later.
        addLitter(field, 0, (t % 120) + 4, (t % 90) + 4, 0);
        collectLitter(field, field.count - 1 - (t % 3));
      }
      stepTidy(tidy, dirt, field, scoring);
    };
    measureHeapDelta(tick, { warmupTicks: 20_000 });
    const result = measureHeapDelta(tick);
    assertHeapDeltaWithinThresholds(result);
    expect(tidy.tidy).toBeGreaterThan(0);
  });
});
