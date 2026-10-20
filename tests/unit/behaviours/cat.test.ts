// npc.cat (SSP-087; ENTITY_CATALOG §7.2, TECHNICAL_DESIGN §11.3, ART_BIBLE §10.2, LEVEL_DESIGN §9.4): perches on
// `w` walls and parked car roofs, darts across the road at 6.0 m/s when Bessie comes within 6–10 m (40%, rolled
// once per approach), grooms mid-road, bolts at the horn or with Bessie within 4 m of it grooming, and when hit
// (−300, 1 complaint) leaps onto her roof (16 ticks), rides it for exactly 180 ticks parented to her pose, hops
// off and perches again. Worlds are the compiled cat street of tests/support/catTown.ts.
import { describe, expect, it } from 'vitest';
import { TILE_M } from '../../../src/sim/constants.ts';
import { countEvents, EV } from '../../../src/sim/eventQueue.ts';
import { cos, sin } from '../../../src/sim/fmath.ts';
import { createInputFrame, type InputFrame, PRESSED, STEER_MAX } from '../../../src/sim/inputFrame.ts';
import { CAT, catBehaviour, LEAP_TICKS } from '../../../src/sim/npc/behaviours/cat.ts';
import {
  CAT_GROOM_STATE,
  CAT_TILE,
  catTargetPos,
  claimCatPerch,
  NO_TARGET,
  releaseCatPerch,
  TILE_TARGET,
} from '../../../src/sim/npc/catPerches.ts';
import { updateZebraOccupancy } from '../../../src/sim/npc/steering.ts';
import {
  addNpcAt,
  NPC_FLAG,
  NpcOrigin,
  npcHandle,
  resolveNpcHandle,
  setNpcState,
} from '../../../src/sim/npc/store.ts';
import { DEFAULT_ENTITIES, DEFAULT_TUNING } from '../../../src/sim/tuning.ts';
import { createWorld, type World } from '../../../src/sim/world.ts';
import {
  addCat,
  CAT_KIND,
  CAT_STREET,
  catWorld,
  compileCatTown,
  putBessie,
  roofPerchAt,
  tileCentre,
  wallPerchAt,
} from '../../support/catTown.ts';
import { pavementWorld } from '../../support/pedestrianRig.ts';

const RULES = DEFAULT_ENTITIES.npcs['npc.cat'].rules;
const BODY = DEFAULT_TUNING.vehicle.sweeper.body;
const neutral: InputFrame = createInputFrame();
/** A groom idle timer long enough that a test never sees the cat go grooming. */
const NO_GROOM = 1_000_000;

function honk(): InputFrame {
  const f = createInputFrame();
  f.pressed = PRESSED.HORN;
  return f;
}

/** Index of the cat with `handle` (it never moves index in these tests, but stay honest). */
function at(world: World, handle: number): number {
  const i = resolveNpcHandle(world.npc, handle);
  if (i < 0) throw new Error('cat gone');
  return i;
}

/**
 * The cat street with its wall perches listed, compiled once: the level compiler is slow, and the bolt test below
 * builds a world per mid-road spot (over 200), which timed out under the full suite when each one recompiled.
 * createWorld only reads the Level, so sharing it is safe.
 */
const STREET_LEVEL = compileCatTown(CAT_STREET, { perches: { count: 1, on: ['walls'] } });

/** The cat street with its wall perches listed and the spawner told its one cat is already placed. */
function street(seed: number): World {
  const world = createWorld(STREET_LEVEL, seed, DEFAULT_TUNING);
  world.npcAi.spawner.perchPending = 0;
  return world;
}

/** A cat on the north wall at column `col` (tile row 1), with its groom timer pushed out of the way. */
function northWallCat(world: World, col: number): number {
  const i = addCat(world, wallPerchAt(world, col, 1));
  world.npc.timerA[i] = NO_GROOM;
  return npcHandle(world.npc, i);
}

/** Put perched cat `i` back on `perch`, sitting, as if nothing had happened (the roll test's reset). */
function resetToPerch(world: World, i: number, perch: number): void {
  const c = world.npcAi.cat;
  const npc = world.npc;
  const h = npcHandle(npc, i);
  const held = npc.timerB[i] as number;
  if (held >= 0) releaseCatPerch(c, held, h);
  claimCatPerch(c, perch, h);
  npc.timerB[i] = perch;
  catTargetPos(c, perch);
  npc.x[i] = c.px[0] as number;
  npc.y[i] = c.py[0] as number;
  npc.speed[i] = 0;
  setNpcState(npc, i, CAT.Perch);
  npc.timerA[i] = NO_GROOM;
}

/** The map character under (x, y) metres on the cat street. */
function charAt(x: number, y: number): string {
  return CAT_STREET[Math.floor(y / TILE_M)]?.[Math.floor(x / TILE_M)] ?? '?';
}

describe('npc.cat data and wiring', () => {
  it('reads its numbers from entities.json and is the registry cat, a jaywalker', () => {
    expect([RULES.dartMinM, RULES.dartMaxM, RULES.dartChance, RULES.rideS]).toEqual([6, 10, 0.4, 3]);
    expect(RULES.boltNearM).toBe(4);
    expect(DEFAULT_ENTITIES.npcs['npc.cat'].speedMps).toBe(6);
    expect(DEFAULT_ENTITIES.npcs['npc.cat'].hit).toEqual({ pts: -300, complaints: 1, drops: [] });
    expect(DEFAULT_TUNING.streetLife.npcRadius.catM).toBe(0.2);
    expect(LEAP_TICKS).toBe(16);
    expect(CAT_GROOM_STATE).toBe(CAT.Groom);
    const world = catWorld(1);
    expect(world.npcAi.behaviours[CAT_KIND]).toBe(catBehaviour);
    expect(catBehaviour.jaywalks).toBe(true);
    expect(catBehaviour.initial).toBe(CAT.Perch);
    const p = world.npcAi.cat.params;
    expect(p.rideTicks).toBe(180);
    expect(p.groomTicks).toBe(RULES.groomS * 60);
    expect([p.groomIdleMinTicks, p.groomIdleMaxTicks]).toEqual([
      RULES.groomIdleMinS * 60,
      RULES.groomIdleMaxS * 60,
    ]);
  });

  it('classes the street: walls are perches, every parked car roof is one, the lanes give mid-road spots', () => {
    const world = catWorld(1);
    const c = world.npcAi.cat;
    // No perch spec: walls are not listed, car roofs are perches.
    expect(c.wallCount).toBe(0);
    expect(c.roofCount).toBe(10);
    const listed = catWorld(1, { perches: { count: 1, on: ['walls'] } }).npcAi.cat;
    expect(listed.wallCount).toBe(60);
    expect(listed.roofCount).toBe(0);
    const tileOf = (tx: number, ty: number): number => c.tile[ty * c.widthTiles + tx] as number;
    expect(tileOf(0, 0)).toBe(CAT_TILE.NO_GO);
    expect(tileOf(15, 1)).toBe(CAT_TILE.OFF);
    expect(tileOf(15, 2)).toBe(CAT_TILE.OFF);
    expect(tileOf(15, 4)).toBe(CAT_TILE.LANE);
    expect(tileOf(25, 5)).toBe(CAT_TILE.BAY);
    expect(c.spotCount).toBeGreaterThan(100);
    for (const t of c.spotTile) expect(c.tile[t]).toBe(CAT_TILE.LANE);
  });
});

describe('perch placement (LEVEL_DESIGN §9.4)', () => {
  it('puts cats only on w tiles or parked car roof points, one per perch; 4 on walls and roofs are 2 and 2', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const world = catWorld(seed, { perches: { count: 4, on: ['walls', 'carRoofs'] } });
      world.step(neutral);
      const npc = world.npc;
      expect(npc.count).toBe(4);
      expect(world.npcAi.spawner.perchPending).toBe(0);
      let walls = 0;
      let roofs = 0;
      const groups = new Set<number>();
      for (let i = 0; i < npc.count; i++) {
        expect(npc.kind[i]).toBe(CAT_KIND);
        expect(npc.origin[i]).toBe(NpcOrigin.Perch);
        expect(npc.state[i]).toBe(CAT.Perch);
        const x = npc.x[i] as number;
        const y = npc.y[i] as number;
        groups.add(npc.timerB[i] as number);
        let car = -1;
        for (let v = 0; v < world.vehicles.parkedCount; v++) {
          if (world.vehicles.x[v] === x && world.vehicles.y[v] === y) car = v;
        }
        if (car >= 0) {
          roofs++;
          expect(world.vehicles.roofPerch[car]).toBe(npcHandle(npc, i));
        } else {
          expect(charAt(x, y), `seed ${seed} cat ${i} at (${x}, ${y})`).toBe('w');
          expect([x % TILE_M, y % TILE_M]).toEqual([1, 1]);
          expect(world.npcAi.spawner.perchUsed[npc.timerB[i] as number]).toBe(1);
          walls++;
        }
      }
      expect([walls, roofs]).toEqual([2, 2]);
      expect(groups.size).toBe(4);
    }
  });

  it('places on one surface when only that one is listed, never on screen', () => {
    for (const on of [['walls'], ['carRoofs']] as const) {
      const world = catWorld(9, { perches: { count: 3, on: [...on] } });
      world.step(neutral);
      const npc = world.npc;
      expect(npc.count).toBe(3);
      for (let i = 0; i < npc.count; i++) {
        const isWall = charAt(npc.x[i] as number, npc.y[i] as number) === 'w';
        expect(isWall).toBe(on[0] === 'walls');
        const view = world.viewRect;
        const x = npc.x[i] as number;
        const y = npc.y[i] as number;
        expect(x < view.minX || x > view.maxX || y < view.minY || y > view.maxY).toBe(true);
      }
    }
  });

  it('places a road cat grooming on a mid-road spot', () => {
    const world = catWorld(3, { perches: { count: 2, on: ['road'] } });
    world.step(neutral);
    const npc = world.npc;
    expect(npc.count).toBe(2);
    const c = world.npcAi.cat;
    for (let i = 0; i < npc.count; i++) {
      expect(npc.state[i]).toBe(CAT.Groom);
      const t =
        Math.floor((npc.y[i] as number) / TILE_M) * c.widthTiles + Math.floor((npc.x[i] as number) / TILE_M);
      expect([...c.spotTile]).toContain(t);
      expect(npc.timerB[i]).toBe(TILE_TARGET - t);
    }
  });
});

describe('the dart (once per approach, 40%)', () => {
  it('over 10,000 seeded approaches darts 40% ± 2% of the time', () => {
    const world = street(2024);
    const h = northWallCat(world, 15);
    const home = world.npc.timerB[at(world, h)] as number;
    let darts = 0;
    const N = 10_000;
    const [cx, cy] = tileCentre(15, 1);
    for (let k = 0; k < N; k++) {
      const i = at(world, h);
      // Away beyond 10 m (re-arms), then into the band at 8 m: one roll.
      putBessie(world, cx + 11, cy);
      catBehaviour.tick(world, i);
      putBessie(world, cx + 8, cy);
      catBehaviour.tick(world, i);
      if (world.npc.state[i] === CAT.Dart) darts++;
      resetToPerch(world, i, home);
    }
    expect(darts / N).toBeGreaterThanOrEqual(0.38);
    expect(darts / N).toBeLessThanOrEqual(0.42);
  });

  it('staying inside the band never re-rolls; only going beyond 10 m re-arms it', () => {
    // Find an approach whose roll fails, then wander about inside 10 m: no draw, no dart.
    const world = street(77);
    const h = northWallCat(world, 15);
    const [cx] = tileCentre(15, 1);
    const rng = world.npcAi.rng;
    let i = at(world, h);
    const home = world.npc.timerB[i] as number;
    for (let tries = 0; tries < 50; tries++) {
      putBessie(world, cx + 12, 9);
      world.step(neutral);
      putBessie(world, cx + 7, 9);
      world.step(neutral);
      i = at(world, h);
      if (world.npc.state[i] === CAT.Perch) break;
      resetToPerch(world, i, home);
    }
    expect(world.npc.state[i]).toBe(CAT.Perch);
    expect((world.npc.flags[i] as number) & NPC_FLAG.DODGED).toBe(NPC_FLAG.DODGED);
    const counter = rng.counter;
    // 600 ticks between 6 and 10 m (and dips to 5 m, inside the band's inner edge): never another roll.
    for (let t = 0; t < 600; t++) {
      const dip = t % 200 === 100;
      putBessie(world, dip ? cx : cx + 5 + (t % 40) * 0.05, dip ? 8 : 9);
      world.step(neutral);
      i = at(world, h);
      expect(world.npc.state[i]).toBe(CAT.Perch);
    }
    expect(rng.counter).toBe(counter);
    // Exactly 10 m (8 along, 6 across) is still inside: no re-arm.
    putBessie(world, cx + 7, 9);
    world.step(neutral);
    putBessie(world, cx + 8, 9);
    world.step(neutral);
    putBessie(world, cx + 7, 9);
    world.step(neutral);
    expect(rng.counter).toBe(counter);
    expect(world.npc.state[at(world, h)]).toBe(CAT.Perch);
    // Beyond 10 m re-arms; the next tick in the band rolls once.
    putBessie(world, cx + 8.5, 9);
    world.step(neutral);
    expect((world.npc.flags[at(world, h)] as number) & NPC_FLAG.DODGED).toBe(0);
    putBessie(world, cx + 7, 9);
    world.step(neutral);
    expect(rng.counter).toBe(counter + 1);
  });

  it('darts across the road at 6.0 m/s and perches on the far side', () => {
    const world = street(5);
    const h = northWallCat(world, 15);
    const home = world.npc.timerB[at(world, h)] as number;
    const [cx] = tileCentre(15, 1);
    // Approach until it darts.
    let i = at(world, h);
    for (let tries = 0; tries < 50 && world.npc.state[i] !== CAT.Dart; tries++) {
      resetToPerch(world, i, home);
      putBessie(world, cx + 12, 9);
      world.step(neutral);
      putBessie(world, cx + 7, 9);
      world.step(neutral);
      i = at(world, h);
    }
    expect(world.npc.state[i]).toBe(CAT.Dart);
    // Its target is the south wall straight across (column 15, row 7); its own wall is free again.
    const far = wallPerchAt(world, 15, 7);
    expect(world.npc.timerB[i]).toBe(far);
    expect(world.npcAi.spawner.perchUsed[home]).toBe(0);
    expect(world.npcAi.spawner.perchUsed[far]).toBe(1);
    // Bessie well away (beyond 10 m, nowhere near its path) while it runs.
    putBessie(world, cx + 30, 9);
    let ticks = 0;
    let prevY = world.npc.y[i] as number;
    while (world.npc.state[i] === CAT.Dart && ticks < 400) {
      world.step(neutral);
      i = at(world, h);
      const y = world.npc.y[i] as number;
      if (world.npc.state[i] === CAT.Dart) {
        expect(y - prevY).toBeCloseTo(6 / 60, 12);
        expect(world.npc.speed[i]).toBe(6);
        expect(world.npc.x[i]).toBe(cx);
        expect(world.npc.heading[i]).toBeCloseTo(Math.PI, 6);
      }
      prevY = y;
      ticks++;
    }
    expect(world.npc.state[i]).toBe(CAT.Perch);
    expect([world.npc.x[i], world.npc.y[i]]).toEqual(tileCentre(15, 7));
    expect(world.npc.timerB[i]).toBe(far);
    // 12 m at 6 m/s: 2 s.
    expect(ticks).toBeGreaterThanOrEqual(118);
    expect(ticks).toBeLessThanOrEqual(121);
  });

  it('a cat on a parked car roof darts across to the far pavement, freeing the roof', () => {
    const world = catWorld(6, { perches: { count: 1, on: ['carRoofs'] } });
    world.npcAi.spawner.perchPending = 0;
    const roof = roofPerchAt(world, 21, 5);
    const i0 = addCat(world, roof);
    world.npc.timerA[i0] = NO_GROOM;
    const h = npcHandle(world.npc, i0);
    let i = at(world, h);
    const sx = world.npc.x[i] as number;
    for (let tries = 0; tries < 50 && world.npc.state[i] !== CAT.Dart; tries++) {
      putBessie(world, sx + 20, 9);
      world.step(neutral);
      putBessie(world, sx + 7.5, 7);
      world.step(neutral);
      i = at(world, h);
      if (world.npc.state[i] !== CAT.Dart) resetToPerch(world, i, roof);
    }
    expect(world.npc.state[i]).toBe(CAT.Dart);
    // The far side of the bay row at column 21 is the north pavement (row 2; no wall at column 21).
    const t = TILE_TARGET - (world.npc.timerB[i] as number);
    expect([t % 100, Math.floor(t / 100)]).toEqual([Math.floor(sx / TILE_M), 2]);
    expect(world.vehicles.roofPerch[roof - world.npcAi.cat.wallCount]).toBe(-1);
  });
});

describe('grooming and bolting', () => {
  /** A cat sitting grooming on the mid-road spot of tile (tx, 3), as the spawner places a road cat. */
  function groomingCat(world: World, tx: number): number {
    const c = world.npcAi.cat;
    const t = 3 * c.widthTiles + tx;
    const s = [...c.spotTile].indexOf(t);
    expect(s).toBeGreaterThanOrEqual(0);
    const [x, y] = tileCentre(tx, 3);
    const i = addCat(world, TILE_TARGET - s, x, y);
    expect(world.npc.state[i]).toBe(CAT.Groom);
    return npcHandle(world.npc, i);
  }

  it('goes grooming on its idle timer: walks out at 1.0 m/s, grooms for 10 s, walks back and perches', () => {
    const world = street(11);
    const h = northWallCat(world, 15);
    const home = world.npc.timerB[at(world, h)] as number;
    putBessie(world, 140, 9);
    world.npc.timerA[at(world, h)] = 1;
    world.step(neutral);
    let i = at(world, h);
    expect(world.npc.state[i]).toBe(CAT.Groom);
    expect(world.npcAi.spawner.perchUsed[home]).toBe(0);
    const spot = world.npc.timerB[i] as number;
    expect(spot).toBeLessThanOrEqual(TILE_TARGET);
    const c = world.npcAi.cat;
    expect(c.tile[TILE_TARGET - spot]).toBe(CAT_TILE.LANE);
    catTargetPos(c, spot);
    expect(Math.hypot((c.px[0] as number) - 31, (c.py[0] as number) - 3)).toBeLessThanOrEqual(
      RULES.groomReachM,
    );
    expect(world.npc.speed[i]).toBe(RULES.walkSpeedMps);
    let walked = 1;
    let sat = 0;
    for (let t = 0; t < 3000 && world.npc.state[i] === CAT.Groom; t++) {
      world.step(neutral);
      i = at(world, h);
      if (world.npc.state[i] !== CAT.Groom) break;
      if (world.npc.speed[i] === 0) sat++;
      else walked++;
    }
    expect(world.npc.state[i]).toBe(CAT.Perch);
    // 600 ticks grooming, plus the tick it arrives and the tick it gets up (both standing still).
    expect(sat).toBeGreaterThanOrEqual(RULES.groomS * 60);
    expect(sat).toBeLessThanOrEqual(RULES.groomS * 60 + 2);
    expect(walked).toBeGreaterThan(0);
    // Back on the nearest free wall perch, holding it.
    const back = world.npc.timerB[i] as number;
    expect(back).toBeGreaterThanOrEqual(0);
    expect(back).toBeLessThan(c.wallCount);
    expect(world.npcAi.spawner.perchUsed[back]).toBe(1);
    catTargetPos(c, back);
    expect([world.npc.x[i], world.npc.y[i]]).toEqual([c.px[0], c.py[0]]);
  });

  it('a horn while grooming or perched enters Bolt', () => {
    for (const grooming of [true, false]) {
      const world = street(12);
      const h = grooming ? groomingCat(world, 30) : northWallCat(world, 15);
      // Bessie inside the 8 m horn radius, beyond the 4 m bolt distance (and, for the perched cat, nearer than the
      // 6 m dart band, so the approach rolls nothing).
      const i0 = at(world, h);
      if (grooming) putBessie(world, (world.npc.x[i0] as number) + 7, 9);
      else putBessie(world, (world.npc.x[i0] as number) + 2, 7.5);
      world.step(neutral);
      expect(world.npc.state[at(world, h)]).toBe(grooming ? CAT.Groom : CAT.Perch);
      world.step(honk());
      const i = at(world, h);
      expect(world.npc.state[i]).toBe(CAT.Bolt);
      expect(world.npc.timerB[i]).not.toBe(NO_TARGET);
    }
  });

  it('Bessie within 4 m of a grooming cat (and no farther) sends it bolting to cover away from her at 7 m/s', () => {
    for (const [gap, bolts] of [
      [4.1, false],
      [3.9, true],
    ] as const) {
      const world = street(13);
      const h = groomingCat(world, 30);
      const i0 = at(world, h);
      const x0 = world.npc.x[i0] as number;
      const y0 = world.npc.y[i0] as number;
      putBessie(world, x0 + gap, y0);
      world.step(neutral);
      const i = at(world, h);
      expect(world.npc.state[i]).toBe(bolts ? CAT.Bolt : CAT.Groom);
      if (!bolts) continue;
      expect(world.npc.speed[i]).toBe(RULES.boltSpeedMps);
      const target = world.npc.timerB[i] as number;
      const c = world.npcAi.cat;
      catTargetPos(c, target);
      // Cover farther from Bessie than the cat was.
      const bx = x0 + gap;
      expect(Math.hypot((c.px[0] as number) - bx, (c.py[0] as number) - y0)).toBeGreaterThan(gap);
      putBessie(world, x0 + 40, y0);
      let t = 0;
      while (world.npc.state[at(world, h)] === CAT.Bolt && t < 600) {
        world.step(neutral);
        t++;
      }
      expect(world.npc.state[at(world, h)]).toBe(CAT.Perch);
    }
  });

  it('a bolt never runs towards Bessie, even with a free perch on her far side within reach', {
    timeout: 60_000,
  }, () => {
    // SSP-087 review: a grooming cat on tile (37, 3) with Bessie 3.9 m east used to bolt to the wall perch at
    // (81, 3), past her; the mirror case (tile (51, 3), Bessie 3.9 m west) to (99, 3). Every mid-road spot on the
    // street, Bessie 3.9 m east and west: the bolt's target and its first step have no component towards her.
    const c0 = street(1).npcAi.cat;
    const cases: [number, number, number][] = [
      [37, 3, 3.9],
      [51, 3, -3.9],
    ];
    for (let s = 0; s < c0.spotCount; s += 1) {
      const t = c0.spotTile[s] as number;
      const tx = t % c0.widthTiles;
      const ty = Math.floor(t / c0.widthTiles);
      cases.push([tx, ty, 3.9], [tx, ty, -3.9]);
    }
    let bolted = 0;
    for (const [tx, ty, gap] of cases) {
      const world = street(13);
      const c = world.npcAi.cat;
      const s = [...c.spotTile].indexOf(ty * c.widthTiles + tx);
      const [x0, y0] = tileCentre(tx, ty);
      const h = npcHandle(world.npc, addCat(world, TILE_TARGET - s, x0, y0));
      const bx = x0 + gap;
      const by = y0;
      putBessie(world, bx, by);
      world.step(neutral);
      const i = at(world, h);
      expect(world.npc.state[i]).toBe(CAT.Bolt);
      bolted += 1;
      const target = world.npc.timerB[i] as number;
      const label = `tile (${tx}, ${ty}), Bessie ${gap} m east of the cat`;
      if (catTargetPos(c, target)) {
        const towards = ((c.px[0] as number) - x0) * (bx - x0) + ((c.py[0] as number) - y0) * (by - y0);
        expect(towards, label).toBeLessThanOrEqual(0);
      }
      const step =
        ((world.npc.x[i] as number) - x0) * (bx - x0) + ((world.npc.y[i] as number) - y0) * (by - y0);
      expect(step, label).toBeLessThanOrEqual(0);
    }
    expect(bolted).toBeGreaterThan(2);
  });
});

describe('hit: the leap, the roof ride and the hop off', () => {
  /** A darting cat 2 cm inside Bessie's front bumper as she drives east at 5 m/s along the road. */
  function dartIntoBessie(seed: number): { world: World; h: number } {
    const world = street(seed);
    const h = northWallCat(world, 15);
    let i = at(world, h);
    const far = wallPerchAt(world, 15, 7);
    releaseCatPerch(world.npcAi.cat, world.npc.timerB[i] as number, h);
    claimCatPerch(world.npcAi.cat, far, h);
    world.npc.timerB[i] = far;
    setNpcState(world.npc, i, CAT.Dart);
    putBessie(world, 31 - BODY.lengthM / 2 - 0.2, 9, Math.PI / 2);
    world.npc.x[i] = 31 + 0.0;
    world.npc.y[i] = 9;
    world.npc.flags[i] = (world.npc.flags[i] as number) | NPC_FLAG.DODGED;
    i = at(world, h);
    world.vehicle.vLongMps = 5;
    return { world, h };
  }

  it('a hit during Dart costs −300 and 1 C, leaps for 16 ticks, rides exactly 180 parented to Bessie, then hops off and perches', () => {
    const { world, h } = dartIntoBessie(21);
    const throttle = createInputFrame();
    throttle.throttle = 0;
    let hitTick = -1;
    for (let t = 0; t < 10 && hitTick < 0; t++) {
      world.step(throttle);
      if (countEvents(world.events, EV.NpcHit) > 0) hitTick = world.tick;
    }
    expect(hitTick).toBeGreaterThan(0);
    let i = at(world, h);
    expect(world.npc.state[i]).toBe(CAT.LeapOnRoof);
    expect(world.scoring.penaltyPts).toBe(-300);
    expect(world.complaints.count).toBe(1);
    expect(world.npcAi.reactions.hits).toBe(1);
    // Its dart target is free again.
    expect(world.npcAi.spawner.perchUsed[wallPerchAt(world, 15, 7)]).toBe(0);
    // Turn while she drives on, so "follows Bessie" covers her heading too.
    const drive = createInputFrame();
    drive.throttle = 40;
    drive.steer = Math.round(STEER_MAX / 3);
    const states: number[] = [CAT.LeapOnRoof];
    const f = RULES.seatForwardM;
    for (let t = 0; t < LEAP_TICKS + 180 + LEAP_TICKS + 2; t++) {
      world.step(drive);
      i = at(world, h);
      const s = world.npc.state[i] as number;
      states.push(s);
      const v = world.vehicle;
      if (s === CAT.LeapOnRoof || s === CAT.RideRoof) {
        expect((world.npc.flags[i] as number) & NPC_FLAG.ON_ROOF).toBe(NPC_FLAG.ON_ROOF);
      }
      if (s === CAT.RideRoof || (s === CAT.LeapOnRoof && (world.npc.stateTicks[i] as number) > 10)) {
        expect(world.npc.x[i]).toBeCloseTo(v.xM + sin(v.headingRad) * f, 9);
        expect(world.npc.y[i]).toBeCloseTo(v.yM - cos(v.headingRad) * f, 9);
        expect(world.npc.heading[i]).toBe(v.headingRad);
      }
    }
    const count = (s: number): number => states.filter((x) => x === s).length;
    expect(count(CAT.LeapOnRoof)).toBe(LEAP_TICKS);
    expect(count(CAT.RideRoof)).toBe(180);
    // In order: leap, ride, then hop off.
    expect(states.indexOf(CAT.RideRoof)).toBe(LEAP_TICKS);
    expect(states.indexOf(CAT.HopOff)).toBe(LEAP_TICKS + 180);
    // Bessie actually moved and turned during the ride.
    expect(world.vehicle.headingRad).not.toBeCloseTo(Math.PI / 2, 2);
    // Hop off: off the roof after its 16 leap ticks, then back to a perch, with no second hit.
    i = at(world, h);
    expect([CAT.HopOff, CAT.Perch]).toContain(world.npc.state[i]);
    expect((world.npc.flags[i] as number) & NPC_FLAG.ON_ROOF).toBe(0);
    const stop = createInputFrame();
    stop.brake = 255;
    for (let t = 0; t < 900 && world.npc.state[at(world, h)] !== CAT.Perch; t++) world.step(stop);
    i = at(world, h);
    expect(world.npc.state[i]).toBe(CAT.Perch);
    expect(world.npcAi.reactions.hits).toBe(1);
    expect(world.scoring.penaltyPts).toBe(-300);
    expect(world.complaints.count).toBe(1);
    // It sits on a perch it holds, or off the road.
    const held = world.npc.timerB[i] as number;
    const c = world.npcAi.cat;
    if (held >= 0) {
      catTargetPos(c, held);
      expect([world.npc.x[i], world.npc.y[i]]).toEqual([c.px[0], c.py[0]]);
    } else {
      const tile =
        Math.floor((world.npc.y[i] as number) / TILE_M) * c.widthTiles +
        Math.floor((world.npc.x[i] as number) / TILE_M);
      expect(c.tile[tile]).toBe(CAT_TILE.OFF);
    }
  });

  it('a hit while grooming leaps onto the roof too', () => {
    const world = street(22);
    const c = world.npcAi.cat;
    const s = [...c.spotTile].indexOf(3 * c.widthTiles + 30);
    const [x, y] = tileCentre(30, 3);
    const i0 = addCat(world, TILE_TARGET - s, x, y);
    const h = npcHandle(world.npc, i0);
    expect(world.npc.state[i0]).toBe(CAT.Groom);
    // Bessie closing fast from the west on the cat's line: too fast for the 4 m bolt to save it.
    putBessie(world, x - BODY.lengthM / 2 - 0.1, y, Math.PI / 2);
    world.vehicle.vLongMps = 8;
    let hit = false;
    for (let k = 0; k < 10 && !hit; k++) {
      world.step(neutral);
      hit = countEvents(world.events, EV.NpcHit) > 0;
    }
    expect(hit).toBe(true);
    expect(world.npc.state[at(world, h)]).toBe(CAT.LeapOnRoof);
    expect(world.scoring.penaltyPts).toBe(-300);
  });

  it('a cat riding the roof is on no zebra and in nobody’s way', () => {
    const world = pavementWorld(31);
    const i = addNpcAt(world.npc, CAT_KIND, NpcOrigin.Ambient, 21, 6);
    world.npc.radius[i] = 0.2;
    updateZebraOccupancy(world);
    expect(world.zebras.occupancy[0]).toBe(1);
    world.npc.flags[i] = (world.npc.flags[i] as number) | NPC_FLAG.ON_ROOF;
    updateZebraOccupancy(world);
    expect(world.zebras.occupancy[0]).toBe(0);
  });
});
