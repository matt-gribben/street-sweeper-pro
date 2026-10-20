// npc.cat properties (SSP-087; ENTITY_CATALOG §7.2, TECHNICAL_DESIGN §11.3). Over random seeds, random drives of
// Bessie along the cat street (tests/support/catTown.ts: throttle, steering, the horn) with the level's placed cats
// (walls, car roofs, grooming spots), a few more on the walls by her start and grooming mid-road in her way, and
// now and then one sat grooming just beyond her front bumper (so hits, rides and hops run too), after every tick,
// for every cat:
//   1. it is on the map and never on a building (a NO_GO tile), whatever it does (it runs in straight lines and
//      hops walls and parked cars, but never crosses a building);
//   2. ON_ROOF is set exactly while it leaps onto, rides or leaps off Bessie's roof;
//   3. perch occupancy matches the cats: a wall perch is taken exactly when one cat sits on it or runs to it, a
//      parked car's roof holds exactly the handle of the cat that does; no two cats share a perch;
//   4. a cat sitting on a perch is exactly on it, and a cat off the roof moves at most its bolt speed a tick;
//   5. every hit on a cat (EV.NpcHit with its kind) puts it into LeapOnRoof that tick;
//   6. a bolt never runs towards Bessie: on its first Bolt tick a cat's step has no component towards her
//      (displacement · (Bessie − cat) ≤ 0; SSP-087 review).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { TILE_M } from '../../src/sim/constants.ts';
import { EV } from '../../src/sim/eventQueue.ts';
import { createInputFrame, PRESSED } from '../../src/sim/inputFrame.ts';
import { CAT, LEAP_TICKS } from '../../src/sim/npc/behaviours/cat.ts';
import { CAT_TILE, catTargetPos, TILE_TARGET } from '../../src/sim/npc/catPerches.ts';
import { NPC_FLAG, npcHandle } from '../../src/sim/npc/store.ts';
import { DEFAULT_ENTITIES } from '../../src/sim/tuning.ts';
import { createWorld, type World } from '../../src/sim/world.ts';
import { addCat, CAT_KIND, compileCatTown, tileCentre } from '../support/catTown.ts';
import { endlessShiftTuning } from '../support/endlessShift.ts';
import { assertProperty } from '../support/fcCheck.ts';

const SEED = 0x0ca7;
const LEVEL = compileCatTown(undefined, { perches: { count: 6, on: ['walls', 'carRoofs', 'road'] } });
/** An endless shift the meter never ends, so a World with many hits keeps running. */
const TUNING = endlessShiftTuning((raw) => {
  raw.complaints.meter.sackedAt = 1_000_000;
});
const BOLT_STEP_M = DEFAULT_ENTITIES.npcs['npc.cat'].rules.boltSpeedMps / 60 + 1e-9;

type Leg = { throttle: number; steer: number; brake: boolean; honk: boolean; ambush: boolean; ticks: number };
type Spec = { seed: number; groomers: number[]; walls: number[]; legs: Leg[] };

const legArb: fc.Arbitrary<Leg> = fc.record({
  throttle: fc.integer({ min: 60, max: 255 }),
  steer: fc.integer({ min: -16, max: 16 }),
  brake: fc.integer({ min: 0, max: 4 }).map((k) => k === 0),
  honk: fc.boolean(),
  ambush: fc.integer({ min: 0, max: 2 }).map((k) => k === 0),
  ticks: fc.integer({ min: 20, max: 160 }),
});
const specArb: fc.Arbitrary<Spec> = fc.record({
  seed: fc.integer({ min: 0, max: 0xffffffff }),
  // Columns east of Bessie's start (column 50) on her row (4) where a cat sits grooming in her way.
  groomers: fc.uniqueArray(fc.integer({ min: 53, max: 90 }), { minLength: 0, maxLength: 4 }),
  // Garden-wall tiles near her start (columns 40–49; rows 1 and 7 as 0–9 and 10–19) where a cat perches.
  walls: fc.uniqueArray(fc.integer({ min: 0, max: 19 }), { minLength: 0, maxLength: 4 }),
  legs: fc.array(legArb, { minLength: 4, maxLength: 12 }),
});

function isCat(w: World, i: number): boolean {
  return w.npc.kind[i] === CAT_KIND;
}

function checkTick(w: World, prevX: Float64Array, prevY: Float64Array, prevHandle: Int32Array): void {
  const npc = w.npc;
  const c = w.npcAi.cat;
  const wallHolders = new Int32Array(c.wallCount);
  const roofHolder = new Int32Array(c.roofCount).fill(-1);
  for (let i = 0; i < npc.count; i++) {
    if (!isCat(w, i)) continue;
    const x = npc.x[i] as number;
    const y = npc.y[i] as number;
    const s = npc.state[i] as number;
    const st = npc.stateTicks[i] as number;
    // 1. On the map, never on a building.
    const tx = Math.floor(x / TILE_M);
    const ty = Math.floor(y / TILE_M);
    expect(tx >= 0 && ty >= 0 && tx < c.widthTiles && ty < c.heightTiles, `cat at (${x}, ${y})`).toBe(true);
    expect(c.tile[ty * c.widthTiles + tx], `cat in state ${s} at (${x}, ${y})`).not.toBe(CAT_TILE.NO_GO);
    // 2. ON_ROOF exactly through the leap, the ride and the hop's leap.
    const onRoof = ((npc.flags[i] as number) & NPC_FLAG.ON_ROOF) !== 0;
    const roofState = s === CAT.LeapOnRoof || s === CAT.RideRoof || (s === CAT.HopOff && st <= LEAP_TICKS);
    expect(onRoof, `state ${s} tick ${st}`).toBe(roofState);
    // 3. Who holds what (a grooming cat's timerB is its spot until it heads back, timerA 0).
    const t = npc.timerB[i] as number;
    const holds =
      t >= 0 &&
      !(s === CAT.LeapOnRoof || s === CAT.RideRoof) &&
      !(s === CAT.Groom && (npc.timerA[i] as number) > 0);
    if (holds) {
      if (t < c.wallCount) wallHolders[t] = (wallHolders[t] as number) + 1;
      else {
        expect(roofHolder[t - c.wallCount], `roof ${t - c.wallCount} shared`).toBe(-1);
        roofHolder[t - c.wallCount] = npcHandle(npc, i);
      }
    }
    // 4. A perched cat is on its perch; off the roof a cat runs no faster than it bolts.
    if (s === CAT.Perch && t >= 0) {
      catTargetPos(c, t);
      expect([x, y]).toEqual([c.px[0], c.py[0]]);
    }
    if (s === CAT.Perch)
      expect(t === -1 || t >= 0, `perched cat with tile target ${TILE_TARGET - t}`).toBe(true);
    if (!onRoof && !(s === CAT.HopOff && st === LEAP_TICKS + 1) && prevHandle[i] === npcHandle(npc, i)) {
      expect(Math.hypot(x - (prevX[i] as number), y - (prevY[i] as number))).toBeLessThanOrEqual(BOLT_STEP_M);
    }
    // 6. A bolt's first step is away from Bessie or square to her.
    if (s === CAT.Bolt && st === 1 && prevHandle[i] === npcHandle(npc, i)) {
      const px = prevX[i] as number;
      const py = prevY[i] as number;
      const towards = (x - px) * (w.vehicle.xM - px) + (y - py) * (w.vehicle.yM - py);
      expect(towards, `bolt from (${px}, ${py}) to (${x}, ${y})`).toBeLessThanOrEqual(1e-9);
    }
  }
  for (let p = 0; p < c.wallCount; p++) {
    expect(wallHolders[p] as number, `wall ${p} holders`).toBeLessThanOrEqual(1);
    expect(w.npcAi.spawner.perchUsed[p], `wall ${p} occupancy`).toBe(wallHolders[p]);
  }
  for (let v = 0; v < c.roofCount; v++) expect(w.vehicles.roofPerch[v], `roof ${v}`).toBe(roofHolder[v]);
  // 5. Every hit on a cat starts its leap.
  const e = w.events;
  for (let k = 0; k < e.count; k++) {
    if (e.type[k] !== EV.NpcHit || e.c[k] !== CAT_KIND) continue;
    expect(npc.state[e.entity[k] as number]).toBe(CAT.LeapOnRoof);
  }
}

/** A cat sitting grooming 5 cm beyond Bessie's front bumper on her centreline, when that is on a lane tile. */
function ambush(w: World): void {
  const v = w.vehicle;
  const c = w.npcAi.cat;
  const ahead = 3.25 / 2 + 0.2 + 0.05;
  const x = v.xM + Math.sin(v.headingRad) * ahead;
  const y = v.yM - Math.cos(v.headingRad) * ahead;
  const tx = Math.floor(x / TILE_M);
  const ty = Math.floor(y / TILE_M);
  if (tx < 0 || ty < 0 || tx >= c.widthTiles || ty >= c.heightTiles) return;
  if (c.tile[ty * c.widthTiles + tx] !== CAT_TILE.LANE) return;
  const i = addCat(w, -1, x, y);
  w.npc.state[i] = CAT.Groom;
  w.npc.timerB[i] = TILE_TARGET - (ty * c.widthTiles + tx);
  w.npc.timerA[i] = c.params.groomTicks;
}

function run(spec: Spec): { hits: number; rides: number; darts: number; bolts: number } {
  const w = createWorld(LEVEL, spec.seed, TUNING);
  const c = w.npcAi.cat;
  for (const col of spec.groomers) {
    // Grooming on her row (not a spot of the lane graph's, so set by hand: Groom, sitting, at its tile).
    const [x, y] = tileCentre(col, 4);
    const i = addCat(w, -1, x, y);
    w.npc.state[i] = CAT.Groom;
    w.npc.timerB[i] = TILE_TARGET - (4 * c.widthTiles + col);
    w.npc.timerA[i] = c.params.groomTicks;
  }
  for (const k of spec.walls) {
    const tx = 40 + (k % 10);
    const ty = k < 10 ? 1 : 7;
    const p = c.tileWall[ty * c.widthTiles + tx] as number;
    if (w.npcAi.spawner.perchUsed[p] === 0) addCat(w, p);
  }
  const prevX = new Float64Array(w.npc.capacity);
  const prevY = new Float64Array(w.npc.capacity);
  const prevHandle = new Int32Array(w.npc.capacity).fill(-1);
  const input = createInputFrame();
  const seen = { hits: 0, rides: 0, darts: 0, bolts: 0 };
  for (const leg of spec.legs) {
    if (leg.ambush) ambush(w);
    for (let t = 0; t < leg.ticks; t++) {
      input.throttle = leg.brake ? 0 : leg.throttle;
      input.brake = leg.brake ? 255 : 0;
      input.steer = leg.steer;
      input.pressed = leg.honk && t === 0 ? PRESSED.HORN : 0;
      for (let i = 0; i < w.npc.count; i++) {
        prevX[i] = w.npc.x[i] as number;
        prevY[i] = w.npc.y[i] as number;
        prevHandle[i] = npcHandle(w.npc, i);
      }
      w.step(input);
      checkTick(w, prevX, prevY, prevHandle);
      for (let i = 0; i < w.npc.count; i++) {
        if (!isCat(w, i) || w.npc.stateTicks[i] !== 1) continue;
        const s = w.npc.state[i];
        if (s === CAT.LeapOnRoof) seen.hits++;
        else if (s === CAT.RideRoof) seen.rides++;
        else if (s === CAT.Dart) seen.darts++;
        else if (s === CAT.Bolt) seen.bolts++;
      }
    }
  }
  return seen;
}

describe('npc.cat properties (SSP-087)', () => {
  it('cats stay off buildings, keep their perches straight and ride the roof only after a hit', {
    timeout: 240_000,
  }, () => {
    const total = { hits: 0, rides: 0, darts: 0, bolts: 0 };
    assertProperty(
      fc.property(specArb, (spec) => {
        const seen = run(spec);
        total.hits += seen.hits;
        total.rides += seen.rides;
        total.darts += seen.darts;
        total.bolts += seen.bolts;
      }),
      { seed: SEED, numRuns: 40 },
    );
    console.log(
      `cat.prop: ${total.hits} hits, ${total.rides} roof rides, ${total.darts} darts, ${total.bolts} bolts`,
    );
    // The runs exercised the machine, not only perched cats.
    expect(total.hits).toBeGreaterThan(0);
    expect(total.rides).toBeGreaterThan(0);
    expect(total.bolts).toBeGreaterThan(0);
  });
});
