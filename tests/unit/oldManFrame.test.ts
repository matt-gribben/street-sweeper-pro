// npc.old_man_frame (SSP-085; ENTITY_CATALOG §6.1–§6.2, §11): he crosses roads only at zebras (every path he
// plans uses a ZEBRA edge to get across, never the dropped kerb, however much shorter), a 6 m two-lane zebra
// takes him 15 s (900 ticks) at 0.4 m/s, and a hit costs −500 and 2 complaints.
//
// Paths and the crossing run on the compiled steering town (tests/support/steeringTown.ts: a 3-tile road across
// the map, rows 2–4, with a 1-tile zebra at column 10 and a dropped-kerb crossing at column 22); the hit on the
// open district of tests/support/npcTown.ts, as in npcReactions.test.ts.
import { describe, expect, it } from 'vitest';
import { TILE_M } from '../../src/sim/constants.ts';
import { NPC_IDS } from '../../src/sim/entities.ts';
import { createInputFrame } from '../../src/sim/inputFrame.ts';
import { NAV_FLAG, NAV_FLAG_CROSSING } from '../../src/sim/map.ts';
import { OLD_MAN_NAV_AVOID, oldManFrameBehaviour } from '../../src/sim/npc/behaviours/oldManFrame.ts';
import { PED } from '../../src/sim/npc/behaviours/pedestrian.ts';
import { findNavPath, NavState, navEdgeBetween, requestNavPath } from '../../src/sim/npc/steering.ts';
import { addNpcAt, NPC_PATH_NODES, NpcOrigin, setNpcState } from '../../src/sim/npc/store.ts';
import { DEFAULT_ENTITIES, DEFAULT_TUNING } from '../../src/sim/tuning.ts';
import { createWorld, type World } from '../../src/sim/world.ts';
import { npcTown } from '../support/npcTown.ts';
import { compileTown } from '../support/steeringTown.ts';

const TOWN = compileTown();
const OLD_MAN = NPC_IDS.indexOf('npc.old_man_frame');
const neutral = createInputFrame();

/** The steering town with Bessie parked at its east end (x 75 m), well outside his awareness radius. */
function townWorld(seed = 85): World {
  const world = createWorld(TOWN, seed, DEFAULT_TUNING);
  world.vehicle.xM = 75;
  world.vehicle.yM = 7;
  return world;
}

function nodeAt(world: World, tx: number, ty: number): number {
  const n = world.npcAi.steering.tileNode[ty * world.level.size[0] + tx] as number;
  if (n < 0) throw new Error(`no nav node on tile (${tx}, ${ty})`);
  return n;
}

/** Add the old man at (x, y) as the spawner would: his radius, his 0.4 m/s and his behaviour's first state. */
function addOldMan(world: World, x: number, y: number): number {
  const i = addNpcAt(world.npc, OLD_MAN, NpcOrigin.Ambient, x, y);
  world.npc.radius[i] = world.npcAi.spawner.radiusByKind[OLD_MAN] as number;
  world.npc.walkMps[i] = world.npcAi.spawner.speedByKind[OLD_MAN] as number;
  setNpcState(world.npc, i, oldManFrameBehaviour.initial);
  return i;
}

/** The crossing-edge flags along `path[0..len)`, one entry per crossing edge it uses. */
function crossingsOf(world: World, path: Int32Array, len: number): number[] {
  const nav = world.level.nav;
  const out: number[] = [];
  for (let k = 1; k < len; k++) {
    const e = navEdgeBetween(nav, path[k - 1] as number, path[k] as number);
    expect(e, `path step ${k}`).toBeGreaterThanOrEqual(0);
    const f = (nav.edgeFlags[e] as number) & NAV_FLAG_CROSSING;
    if (f !== 0) out.push(f);
  }
  return out;
}

describe('npc.old_man_frame crosses only at zebras', () => {
  it('has the registry behaviour, his entities.json speed and yields, and avoids every non-zebra crossing', () => {
    const world = townWorld();
    expect(world.npcAi.behaviours[OLD_MAN]).toBe(oldManFrameBehaviour);
    expect(oldManFrameBehaviour.jaywalks).toBe(false);
    expect(OLD_MAN_NAV_AVOID & NAV_FLAG.ZEBRA).toBe(0);
    expect(OLD_MAN_NAV_AVOID & NAV_FLAG.DROPPED_KERB).not.toBe(0);
    expect(OLD_MAN_NAV_AVOID & NAV_FLAG.SCHOOL_CROSSING).not.toBe(0);
    expect(DEFAULT_ENTITIES.npcs['npc.old_man_frame'].speedMps).toBe(0.4);
    expect(world.npcAi.spawner.speedByKind[OLD_MAN]).toBe(0.4);
    expect(world.npcAi.reactions.yields[OLD_MAN]).toBe(1);
  });

  it('every route between nodes on opposite sides of the road uses a zebra edge and never the dropped kerb', () => {
    const world = townWorld();
    const st = world.npcAi.steering;
    const nav = world.level.nav;
    const north: number[] = [];
    const south: number[] = [];
    for (let n = 0; n < nav.nodeCount; n++) {
      const ty = Math.floor((nav.nodeY[n] as number) / TILE_M);
      if (ty === 1) north.push(n);
      else if (ty >= 5) south.push(n);
    }
    expect(north.length).toBeGreaterThan(30);
    expect(south.length).toBeGreaterThan(100);
    const out = new Int32Array(nav.nodeCount);
    let pairs = 0;
    let shorterByKerb = 0;
    for (const a of north) {
      for (let s = 0; s < south.length; s += 7) {
        const b = south[s] as number;
        for (const [from, to] of [
          [a, b],
          [b, a],
        ] as const) {
          const len = findNavPath(st, nav, from, to, out, 0, out.length, OLD_MAN_NAV_AVOID);
          expect(len, `${from} → ${to}`).toBeGreaterThan(1);
          const crossings = crossingsOf(world, out, len);
          expect(crossings.length, `${from} → ${to}`).toBeGreaterThan(0);
          for (const f of crossings) expect(f, `${from} → ${to}`).toBe(NAV_FLAG.ZEBRA);
          const free = findNavPath(st, nav, from, to, out, 0, out.length);
          if (crossingsOf(world, out, free).includes(NAV_FLAG.DROPPED_KERB)) shorterByKerb++;
          pairs++;
        }
      }
    }
    expect(pairs).toBeGreaterThan(1000);
    // The test means something: for many of the pairs the shortest path for anyone else is the dropped kerb.
    expect(shorterByKerb).toBeGreaterThan(pairs / 4);
  });

  it('his own path requests (and every re-planned segment) cross at the zebra, even beside the dropped kerb', () => {
    const world = townWorld();
    const nav = world.level.nav;
    const from = nodeAt(world, 22, 1); // the dropped kerb's north end
    const goal = nodeAt(world, 22, 7); // straight across it, 6 m of road away
    const i = addOldMan(world, nav.nodeX[from] as number, nav.nodeY[from] as number);
    expect(requestNavPath(world, i, goal)).toBe(true);
    const seg = world.npc.path.subarray(
      i * NPC_PATH_NODES,
      i * NPC_PATH_NODES + (world.npc.pathLen[i] as number),
    );
    expect(crossingsOf(world, seg, seg.length)).toEqual([NAV_FLAG.ZEBRA]);
    // Walk him there (about 24 + 6 + 24 m at 0.4 m/s, plus the kerb look): he is only ever on the road on the
    // zebra column, and arrives.
    let onRoad = 0;
    for (let t = 0; t < 60 * 200 && world.npc.navState[i] !== NavState.Arrived; t++) {
      world.step(neutral);
      const tx = Math.floor((world.npc.x[i] as number) / TILE_M);
      const ty = Math.floor((world.npc.y[i] as number) / TILE_M);
      if (ty >= 2 && ty <= 4) {
        onRoad++;
        expect(tx, `tick ${t}`).toBe(10);
      }
    }
    expect(world.npc.navState[i]).toBe(NavState.Arrived);
    expect(world.npc.goalNode[i]).toBe(goal);
    expect(onRoad).toBeGreaterThan(800);
  });

  it('crossing the 6 m zebra takes him 900 ± 30 ticks (15 s at 0.4 m/s), in Cross, with the zebra occupied', () => {
    const world = townWorld();
    const nav = world.level.nav;
    const from = nodeAt(world, 10, 1);
    const i = addOldMan(world, nav.nodeX[from] as number, nav.nodeY[from] as number);
    expect(requestNavPath(world, i, nodeAt(world, 10, 7))).toBe(true);
    const z = world.zebras;
    expect([z.minY[0], z.maxY[0]]).toEqual([4, 10]); // 6 m of zebra across the two-lane road
    let occupied = 0;
    let first = -1;
    let last = -1;
    let arrived = -1;
    for (let t = 0; t < 2400; t++) {
      world.step(neutral);
      if (arrived < 0 && world.npc.navState[i] === NavState.Arrived) arrived = t;
      if ((z.occupancy[0] as number) > 0) {
        occupied++;
        if (first < 0) first = t;
        last = t;
        expect(world.npc.state[i], `tick ${t}`).toBe(PED.Cross);
      }
    }
    expect(occupied).toBe(last - first + 1); // one unbroken crossing
    expect(Math.abs(occupied - 900)).toBeLessThanOrEqual(30);
    // Then on to his goal on the far pavement (where the generic machine idles and wanders on).
    expect(arrived).toBeGreaterThan(last);
  });

  it('a hit costs −500 and 2 complaints (entities.json hit), through the penalty pipeline', () => {
    const world = createWorld(npcTown(48, {}).level, 85, DEFAULT_TUNING);
    const body = DEFAULT_TUNING.vehicle.sweeper.body;
    const r = world.npcAi.spawner.radiusByKind[OLD_MAN] as number;
    // 2 cm inside her front bumper on her centre line, Bessie rolling north at 2 m/s.
    const i = addOldMan(world, 48, 48 - body.lengthM / 2 - r + 0.02);
    const v = world.vehicle;
    v.vLongMps = 2;
    v.vLatMps = 0;
    v.yawRateRadPerS = 0;
    world.step(neutral);
    const hit = DEFAULT_ENTITIES.npcs['npc.old_man_frame'].hit;
    expect(hit?.pts).toBe(-500);
    expect(hit?.complaints).toBe(2);
    expect(world.npcAi.reactions.hits).toBe(1);
    expect(world.scoring.penaltyPts).toBe(-500);
    expect(world.complaints.count).toBe(2);
    expect(world.npc.state[i]).toBe(PED.Fallen);
  });
});
