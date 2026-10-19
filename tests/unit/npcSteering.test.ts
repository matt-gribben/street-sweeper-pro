// The NPC steering core (SSP-081, TECHNICAL_DESIGN §11.1): deterministic shortest paths on the compiled nav
// graph, path following with the zebra kerb wait and occupancy, separation, sidestepping Bessie's predicted
// path, and the jaywalk flag. Worlds run on the compiled steering town (tests/support/steeringTown.ts): a road
// across the map with a zebra at column 10 and a dropped-kerb crossing at column 22.
import { describe, expect, it } from 'vitest';
import { TILE_M } from '../../src/sim/constants.ts';
import { sqrt } from '../../src/sim/fmath.ts';
import { createInputFrame } from '../../src/sim/inputFrame.ts';
import {
  buildNavGraph,
  createBlankLevel,
  type Level,
  NAV_FLAG,
  NAV_FLAG_CROSSING,
} from '../../src/sim/map.ts';
import type { Behaviour } from '../../src/sim/npc/behaviour.ts';
import {
  beginSteer,
  clearNavPath,
  findNavPath,
  moveNpc,
  NavState,
  navEdgeBetween,
  requestNavPath,
  STEER_TILE,
  steerArrive,
  steerFlee,
  steerSeek,
  steerSeparate,
  steerSidestep,
  walkNpc,
} from '../../src/sim/npc/steering.ts';
import { addNpcAt, NPC_PATH_NODES, NpcOrigin, removeNpc } from '../../src/sim/npc/store.ts';
import { DEFAULT_TUNING } from '../../src/sim/tuning.ts';
import { createWorld, type World } from '../../src/sim/world.ts';
import { compileTown } from '../support/steeringTown.ts';

const TOWN = compileTown();
const neutral = createInputFrame();

function townWorld(level: Level = TOWN, seed = 81): World {
  return createWorld(level, seed, DEFAULT_TUNING);
}

/** The nav node on tile (tx, ty) of the world's level. */
function nodeAt(world: World, tx: number, ty: number): number {
  const n = world.npcAi.steering.tileNode[ty * world.level.size[0] + tx] as number;
  if (n < 0) throw new Error(`no nav node on tile (${tx}, ${ty})`);
  return n;
}

/** Add a human-sized walker (kind 0, 1.3 m/s, r 0.3 m) at (x, y). */
function addWalker(world: World, x: number, y: number, walkMps = 1.3): number {
  const i = addNpcAt(world.npc, 0, NpcOrigin.Ambient, x, y);
  world.npc.radius[i] = DEFAULT_TUNING.streetLife.npcRadius.humanM;
  world.npc.walkMps[i] = walkMps;
  return i;
}

function onRoad(world: World, x: number, y: number): boolean {
  const st = world.npcAi.steering;
  const t = Math.floor(y / TILE_M) * st.widthTiles + Math.floor(x / TILE_M);
  return ((st.tileFlags[t] as number) & STEER_TILE.ROAD) !== 0;
}

/** A walker behaviour: follow the nav path (no sidestep). */
const pathWalker: Behaviour = {
  initial: 0,
  jaywalks: false,
  tick(w, i) {
    walkNpc(w, i, false);
  },
  onStimulus() {},
};

/** Independent float Dijkstra over the nav graph (the reference shortest distance). */
function dijkstraM(level: Level, from: number, to: number): number {
  const nav = level.nav;
  const dist = new Float64Array(nav.nodeCount).fill(Number.POSITIVE_INFINITY);
  const done = new Uint8Array(nav.nodeCount);
  dist[from] = 0;
  for (;;) {
    let u = -1;
    for (let n = 0; n < nav.nodeCount; n++) {
      if (done[n] === 0 && (u < 0 || (dist[n] as number) < (dist[u] as number))) u = n;
    }
    if (u < 0 || !Number.isFinite(dist[u] as number)) return Number.POSITIVE_INFINITY;
    if (u === to) return dist[u] as number;
    done[u] = 1;
    for (let k = nav.adjStart[u] as number; k < (nav.adjStart[u + 1] as number); k++) {
      const m = nav.adjNode[k] as number;
      const dx = (nav.nodeX[m] as number) - (nav.nodeX[u] as number);
      const dy = (nav.nodeY[m] as number) - (nav.nodeY[u] as number);
      const d = (dist[u] as number) + Math.hypot(dx, dy);
      if (d < (dist[m] as number)) dist[m] = d;
    }
  }
}

function pathLengthM(level: Level, path: Int32Array, len: number): number {
  let total = 0;
  for (let k = 1; k < len; k++) {
    const a = path[k - 1] as number;
    const b = path[k] as number;
    total += Math.hypot(
      (level.nav.nodeX[b] as number) - (level.nav.nodeX[a] as number),
      (level.nav.nodeY[b] as number) - (level.nav.nodeY[a] as number),
    );
  }
  return total;
}

describe('nav paths (findNavPath, requestNavPath)', () => {
  it('a path request between two nav nodes returns the same node sequence on repeated runs and in a fresh World', () => {
    const run = (world: World): number[] => {
      const out = new Int32Array(512);
      const from = nodeAt(world, 2, 1);
      const to = nodeAt(world, 35, 8);
      const len = findNavPath(world.npcAi.steering, world.level.nav, from, to, out, 0, out.length);
      expect(len).toBeGreaterThan(1);
      return [...out.subarray(0, len)];
    };
    const world = townWorld();
    const first = run(world);
    expect(run(world)).toEqual(first);
    expect(run(world)).toEqual(first);
    expect(run(townWorld(TOWN, 99))).toEqual(first);
    expect(run(townWorld(compileTown(), 81))).toEqual(first);
    // Every step is a nav edge, and exactly one is a crossing (the road splits the town in two).
    const nav = world.level.nav;
    let crossings = 0;
    for (let k = 1; k < first.length; k++) {
      const e = navEdgeBetween(nav, first[k - 1] as number, first[k] as number);
      expect(e).toBeGreaterThanOrEqual(0);
      if (((nav.edgeFlags[e] as number) & NAV_FLAG_CROSSING) !== 0) crossings++;
    }
    expect(crossings).toBe(1);
    // An NPC's request holds the same nodes (the first NPC_PATH_NODES of them).
    const i = addWalker(
      world,
      nav.nodeX[first[0] as number] as number,
      nav.nodeY[first[0] as number] as number,
    );
    expect(requestNavPath(world, i, first[first.length - 1] as number)).toBe(true);
    const held = [
      ...world.npc.path.subarray(i * NPC_PATH_NODES, i * NPC_PATH_NODES + (world.npc.pathLen[i] as number)),
    ];
    expect(held).toEqual(first.slice(0, NPC_PATH_NODES));
    expect(world.npc.navState[i]).toBe(NavState.Walking);
  });

  it('returns a shortest path (the length an independent Dijkstra finds) for many node pairs', () => {
    const world = townWorld();
    const nav = world.level.nav;
    const out = new Int32Array(nav.nodeCount);
    let pairs = 0;
    for (let a = 0; a < nav.nodeCount; a += 17) {
      for (let b = 5; b < nav.nodeCount; b += 23) {
        const len = findNavPath(world.npcAi.steering, nav, a, b, out, 0, out.length);
        expect(len).toBeGreaterThan(0);
        expect(out[0]).toBe(a);
        expect(out[len - 1]).toBe(b);
        expect(pathLengthM(world.level, out, len)).toBeCloseTo(dijkstraM(world.level, a, b), 2);
        pairs++;
      }
    }
    expect(pairs).toBeGreaterThan(100);
  });

  it('returns −1 for an unreachable node and writes only the first maxNodes nodes of a long path', () => {
    const level = createBlankLevel('test.nav_islands', 10, 4);
    level.nav = buildNavGraph(
      {
        nodes: [
          [1, 1],
          [3, 1],
          [5, 1],
          [15, 1],
        ],
        edges: [
          [0, 1, 0],
          [1, 2, 0],
        ],
        portals: [],
        doors: [],
        anchors: [],
      },
      10,
      4,
    );
    const world = createWorld(level, 1, DEFAULT_TUNING);
    const out = new Int32Array(4).fill(-7);
    expect(findNavPath(world.npcAi.steering, level.nav, 0, 3, out, 0, 4)).toBe(-1);
    expect([...out]).toEqual([-7, -7, -7, -7]);
    expect(findNavPath(world.npcAi.steering, level.nav, 0, 2, out, 1, 2)).toBe(3);
    expect([...out]).toEqual([-7, 0, 1, -7]);
    expect(findNavPath(world.npcAi.steering, level.nav, 2, 2, out, 0, 4)).toBe(1);
    expect(out[0]).toBe(2);
    const i = addWalker(world, 1, 1);
    expect(requestNavPath(world, i, 3)).toBe(false);
    expect(world.npc.navState[i]).toBe(NavState.NoPath);
    expect(world.npc.pathLen[i]).toBe(0);
  });

  it('swap-remove carries an NPC’s path with it', () => {
    const world = townWorld();
    const a = addWalker(world, 5, 3);
    const b = addWalker(world, 9, 3);
    expect(requestNavPath(world, b, nodeAt(world, 35, 8))).toBe(true);
    const before = [...world.npc.path.subarray(b * NPC_PATH_NODES, (b + 1) * NPC_PATH_NODES)];
    const len = world.npc.pathLen[b];
    removeNpc(world.npc, a);
    expect([...world.npc.path.subarray(a * NPC_PATH_NODES, (a + 1) * NPC_PATH_NODES)]).toEqual(before);
    expect(world.npc.pathLen[a]).toBe(len);
    expect(world.npc.goalNode[a]).toBe(nodeAt(world, 35, 8));
    expect(world.npc.walkMps[a]).toBe(1.3);
  });
});

describe('path following and the zebra', () => {
  /** A walker at the north kerb of the zebra (tile (10, 1)) with a path to tile (10, 7) across it. */
  function zebraRig(): { world: World; i: number } {
    const world = townWorld();
    world.npcAi.behaviours.fill(pathWalker);
    const from = nodeAt(world, 10, 1);
    const i = addWalker(world, world.level.nav.nodeX[from] as number, world.level.nav.nodeY[from] as number);
    expect(requestNavPath(world, i, nodeAt(world, 10, 7))).toBe(true);
    return { world, i };
  }

  it('while an NPC is on a zebra its occupancy is > 0, and it returns to 0 after the NPC leaves', () => {
    const { world, i } = zebraRig();
    const z = world.zebras;
    expect(z.count).toBe(1);
    expect([z.minX[0], z.minY[0], z.maxX[0], z.maxY[0]]).toEqual([20, 4, 22, 10]);
    const nav = world.level.nav;
    const crossing = navEdgeBetween(nav, nodeAt(world, 10, 1), nodeAt(world, 10, 5));
    expect(world.npcAi.steering.edgeZebra[crossing]).toBe(0);
    let occupiedTicks = 0;
    let waited = 0;
    let left = -1;
    for (let t = 0; t < 1200; t++) {
      world.step(neutral);
      const x = world.npc.x[i] as number;
      const y = world.npc.y[i] as number;
      const on = x >= 20 && x < 22 && y >= 4 && y < 10;
      expect(z.occupancy[0], `tick ${t}`).toBe(on ? 1 : 0);
      if (on) occupiedTicks++;
      if (world.npc.navState[i] === NavState.KerbWait) waited++;
      if (on) expect(world.npc.crossEdge[i]).toBe(crossing);
      if (occupiedTicks > 0 && !on && left < 0) left = t;
    }
    // Waited kerbLookS at the kerb, crossed 6 m of zebra (≈ 4.6 s at 1.3 m/s), then arrived on the far side.
    expect(waited).toBeGreaterThanOrEqual(
      Math.round(DEFAULT_TUNING.streetLife.npcSteering.kerbLookS * 60) - 1,
    );
    expect(occupiedTicks).toBeGreaterThan(200);
    expect(left).toBeGreaterThan(0);
    expect(world.npc.navState[i]).toBe(NavState.Arrived);
    expect(world.npc.crossEdge[i]).toBe(-1);
    expect(z.occupancy[0]).toBe(0);
  });

  it('counts every NPC on the zebra, and none once the NPC is removed', () => {
    const world = townWorld();
    addWalker(world, 20.5, 6);
    addWalker(world, 21.5, 8);
    addWalker(world, 25, 6); // on the road, beside the zebra
    world.step(neutral);
    expect(world.zebras.occupancy[0]).toBe(2);
    removeNpc(world.npc, 0);
    world.step(neutral);
    expect(world.zebras.occupancy[0]).toBe(1);
  });

  it('waits at the kerb while the gap check says no, and steps out when it says clear', () => {
    const { world, i } = zebraRig();
    let clear = false;
    let calls = 0;
    world.npcAi.steering.crossingClear = (_w, j, edge) => {
      calls++;
      expect(j).toBe(i);
      expect((world.level.nav.edgeFlags[edge] as number) & NAV_FLAG.ZEBRA).toBe(NAV_FLAG.ZEBRA);
      return clear;
    };
    for (let t = 0; t < 300; t++) world.step(neutral);
    expect(world.npc.navState[i]).toBe(NavState.KerbWait);
    expect(world.npc.y[i]).toBeLessThan(4);
    expect(world.zebras.occupancy[0]).toBe(0);
    expect(calls).toBeGreaterThan(200);
    clear = true;
    for (let t = 0; t < 120; t++) world.step(neutral);
    expect(world.npc.navState[i]).toBe(NavState.Crossing);
    expect(world.zebras.occupancy[0]).toBe(1);
  });

  it('walks a long path across the road at a crossing and arrives, never on the road off the crossing', () => {
    const world = townWorld();
    world.npcAi.behaviours.fill(pathWalker);
    const nav = world.level.nav;
    const from = nodeAt(world, 2, 1);
    const goal = nodeAt(world, 35, 8);
    const i = addWalker(world, nav.nodeX[from] as number, nav.nodeY[from] as number);
    expect(requestNavPath(world, i, goal)).toBe(true);
    const states = new Set<number>();
    // About 70 m of path at 1.3 m/s, the kerb wait and two props to walk round.
    for (let t = 0; t < 90 * 60 && world.npc.navState[i] !== NavState.Arrived; t++) {
      world.step(neutral);
      states.add(world.npc.navState[i] as number);
      if (onRoad(world, world.npc.x[i] as number, world.npc.y[i] as number)) {
        expect(world.npc.navState[i]).toBe(NavState.Crossing);
      }
    }
    expect(world.npc.navState[i]).toBe(NavState.Arrived);
    expect([...states].sort()).toEqual([
      NavState.Walking,
      NavState.KerbWait,
      NavState.Crossing,
      NavState.Arrived,
    ]);
    const d = Math.hypot(
      (world.npc.x[i] as number) - (nav.nodeX[goal] as number),
      (world.npc.y[i] as number) - (nav.nodeY[goal] as number),
    );
    expect(d).toBeLessThanOrEqual(DEFAULT_TUNING.streetLife.npcSteering.arriveRadiusM + 1e-9);
    expect(world.npc.targetNode[i]).toBe(goal);
  });
});

describe('separation, sidestep and jaywalking', () => {
  it('two NPCs seeking the same point keep centre separation ≥ 0.6 m (2 × 0.3 m) after settling', () => {
    const world = townWorld();
    const point = { x: new Float64Array([66]), y: new Float64Array([15]) };
    world.npcAi.behaviours.fill({
      initial: 0,
      jaywalks: false,
      tick(w, i) {
        beginSteer(w);
        steerArrive(w, i, point.x, point.y, 0);
        steerSeparate(w, i);
        moveNpc(w, i);
      },
      onStimulus() {},
    });
    const a = addWalker(world, 62, 13);
    const b = addWalker(world, 70, 17);
    let minSettled = Number.POSITIVE_INFINITY;
    for (let t = 0; t < 900; t++) {
      world.step(neutral);
      const d = Math.hypot(
        (world.npc.x[a] as number) - (world.npc.x[b] as number),
        (world.npc.y[a] as number) - (world.npc.y[b] as number),
      );
      if (t >= 600) minSettled = Math.min(minSettled, d);
    }
    expect(minSettled).toBeGreaterThanOrEqual(0.6);
    // Both got there: each within a body width of the point.
    for (const i of [a, b]) {
      expect(Math.hypot((world.npc.x[i] as number) - 66, (world.npc.y[i] as number) - 15)).toBeLessThan(1);
    }
  });

  it('an NPC standing in Bessie’s predicted path 1.5 s ahead moves laterally away from it', () => {
    for (const startY of [15, 15.4, 14.7]) {
      const world = townWorld();
      const v = world.vehicle;
      v.xM = 54; // 6 m behind the NPC, heading east at 4 m/s: the NPC is 1.5 s ahead
      v.yM = 15;
      v.headingRad = Math.PI / 2;
      v.vLongMps = 4;
      v.vLatMps = 0;
      const i = addWalker(world, 60, startY);
      let sidestepped = 0;
      for (let t = 0; t < 120; t++) {
        beginSteer(world);
        if (steerSidestep(world, i)) sidestepped++;
        moveNpc(world, i);
      }
      const x = world.npc.x[i] as number;
      const y = world.npc.y[i] as number;
      expect(sidestepped, `y ${startY}`).toBeGreaterThan(10);
      // Clear of her path (half width 0.875 + 0.3 + sidestepClearM 0.5), on the side it started (north on the line).
      const clear = 0.875 + 0.3 + DEFAULT_TUNING.streetLife.npcSteering.sidestepClearM;
      expect(Math.abs(y - 15), `y ${startY}`).toBeGreaterThanOrEqual(clear - 0.05);
      expect(Math.sign(y - 15), `y ${startY}`).toBe(startY > 15 ? 1 : -1);
      expect(Math.abs(x - 60), `y ${startY}`).toBeLessThan(0.25);
      expect(steerSidestep(world, i)).toBe(false);
    }
  });

  it('does not sidestep a Bessie at rest, or one moving away', () => {
    const world = townWorld();
    const v = world.vehicle;
    v.xM = 54;
    v.yM = 15;
    v.headingRad = -Math.PI / 2; // west, away from the NPC
    v.vLongMps = 4;
    const i = addWalker(world, 60, 15);
    expect(steerSidestep(world, i)).toBe(false);
    v.vLongMps = 0;
    v.headingRad = Math.PI / 2;
    expect(steerSidestep(world, i)).toBe(false);
  });

  it('a jaywalk-flagged NPC may cross a road away from crossings; an unflagged one may not', () => {
    const target = { x: new Float64Array([69]), y: new Float64Array([15]) };
    const seeker = (jaywalks: boolean): Behaviour => ({
      initial: 0,
      jaywalks,
      tick(w, i) {
        beginSteer(w);
        steerSeek(w, i, target.x, target.y, 0);
        moveNpc(w, i);
      },
      onStimulus() {},
    });
    for (const jaywalks of [true, false]) {
      const world = townWorld();
      world.npcAi.behaviours.fill(seeker(jaywalks));
      const i = addWalker(world, 69, 3); // tile (34, 1): the north pavement, 12 columns from the dropped kerb
      let roadTicks = 0;
      for (let t = 0; t < 900; t++) {
        world.step(neutral);
        if (onRoad(world, world.npc.x[i] as number, world.npc.y[i] as number)) roadTicks++;
      }
      const y = world.npc.y[i] as number;
      if (jaywalks) {
        expect(roadTicks).toBeGreaterThan(100);
        expect(y).toBeGreaterThan(10); // on the south pavement
        expect(Math.hypot((world.npc.x[i] as number) - 69, y - 15)).toBeLessThan(0.5);
      } else {
        expect(roadTicks).toBe(0);
        expect(y).toBeLessThan(4); // still on the north pavement, pressed against the kerb
        expect(y).toBeGreaterThan(3.5);
      }
    }
  });

  it('flees a point at its walking speed, and stops at the edge of what it may stand on', () => {
    const world = townWorld();
    const threat = { x: new Float64Array([60]), y: new Float64Array([16]) };
    const i = addWalker(world, 60, 15); // 1 m north of the threat, on the wide south pavement
    let maxSpeed = 0;
    for (let t = 0; t < 240; t++) {
      beginSteer(world);
      steerFlee(world, i, threat.x, threat.y, 0);
      moveNpc(world, i);
      maxSpeed = Math.max(maxSpeed, world.npc.speed[i] as number);
    }
    // Ran north, away from it, at no more than 1.3 m/s, and stopped against the kerb: never onto the road.
    expect(maxSpeed).toBeCloseTo(1.3, 6);
    expect(world.npc.x[i]).toBeCloseTo(60, 6);
    expect(world.npc.y[i]).toBeGreaterThanOrEqual(10);
    expect(world.npc.y[i]).toBeLessThan(10.05);
  });

  it('clearNavPath drops the path; a cleared NPC on a crossing keeps its corridor until a new path', () => {
    const world = townWorld();
    world.npcAi.behaviours.fill(pathWalker);
    const nav = world.level.nav;
    const from = nodeAt(world, 10, 1);
    const i = addWalker(world, nav.nodeX[from] as number, nav.nodeY[from] as number);
    expect(requestNavPath(world, i, nodeAt(world, 10, 7))).toBe(true);
    for (let t = 0; t < 200 && !onRoad(world, world.npc.x[i] as number, world.npc.y[i] as number); t++) {
      world.step(neutral);
    }
    expect(world.npc.navState[i]).toBe(NavState.Crossing);
    const crossing = world.npc.crossEdge[i] as number;
    clearNavPath(world, i);
    expect(world.npc.navState[i]).toBe(NavState.Idle);
    expect(world.npc.pathLen[i]).toBe(0);
    expect(world.npc.goalNode[i]).toBe(-1);
    expect(world.npc.crossEdge[i]).toBe(crossing);
    // A new path leads off the crossing from its nearer end (the north kerb, just left), still crossing.
    expect(requestNavPath(world, i, nodeAt(world, 2, 1))).toBe(true);
    expect(world.npc.navState[i]).toBe(NavState.Crossing);
    expect(world.npc.targetNode[i]).toBe(from);
    for (let t = 0; t < 300; t++) {
      world.step(neutral);
      if (onRoad(world, world.npc.x[i] as number, world.npc.y[i] as number)) {
        expect(world.npc.crossEdge[i]).toBe(crossing);
      }
    }
    expect(world.npc.crossEdge[i]).toBe(-1);
    expect(world.npc.y[i]).toBeLessThan(4);
  });

  it('walks round a prop standing on its path instead of stopping at it', () => {
    // The lamp post at (13, 3) stands on the 1-tile north pavement, on the node of tile (6, 1).
    const world = townWorld();
    world.npcAi.behaviours.fill(pathWalker);
    const nav = world.level.nav;
    const from = nodeAt(world, 3, 1);
    const goal = nodeAt(world, 9, 1);
    expect(world.npcAi.steering.nodeArriveM[nodeAt(world, 6, 1)]).toBeGreaterThan(0.5);
    const i = addWalker(world, nav.nodeX[from] as number, nav.nodeY[from] as number);
    expect(requestNavPath(world, i, goal)).toBe(true);
    for (let t = 0; t < 900 && world.npc.navState[i] !== NavState.Arrived; t++) {
      world.step(neutral);
      const dx = (world.npc.x[i] as number) - 13;
      const dy = (world.npc.y[i] as number) - 3;
      expect(sqrt(dx * dx + dy * dy)).toBeGreaterThanOrEqual(0.5 - 1e-4); // lamp 0.2 + walker 0.3
      expect(world.npc.y[i]).toBeLessThan(4);
    }
    expect(world.npc.navState[i]).toBe(NavState.Arrived);
  });
});
