// npc.postie (SSP-085; ENTITY_CATALOG §6.1–§6.2, LEVEL_DESIGN §7.10): he walks the frontage round door to door
// and stops at each door for 3 s (entities.json rules.doorStopS: 180 ticks), facing the facade, then walks on;
// the round (npc/doorRound.ts) works along one side of a street before crossing it. A hit costs −250 and 1
// complaint.
//
// The round runs on the compiled steering town (tests/support/steeringTown.ts: a terrace along each side of a
// road with a zebra and a dropped-kerb crossing), on an endless shift whose awareness radius is shrunk to 1 cm so
// Bessie (parked at the east end) never makes him yield; the hit on the open district of npcTown.ts.
import { describe, expect, it } from 'vitest';
import { TILE_M } from '../../../src/sim/constants.ts';
import { NPC_IDS } from '../../../src/sim/entities.ts';
import { createInputFrame } from '../../../src/sim/inputFrame.ts';
import { PED } from '../../../src/sim/npc/behaviours/pedestrian.ts';
import {
  DOOR_CROWD_M,
  doorStopTicks,
  nextRoundStop,
  postieBehaviour,
} from '../../../src/sim/npc/behaviours/postie.ts';
import { NavState } from '../../../src/sim/npc/steering.ts';
import { addNpcAt, NpcOrigin, setNpcState } from '../../../src/sim/npc/store.ts';
import { DEFAULT_ENTITIES, DEFAULT_TUNING } from '../../../src/sim/tuning.ts';
import { createWorld, type World } from '../../../src/sim/world.ts';
import { endlessShiftTuning } from '../../support/endlessShift.ts';
import { npcTown } from '../../support/npcTown.ts';
import { compileTown } from '../../support/steeringTown.ts';

const TOWN = compileTown();
const POSTIE = NPC_IDS.indexOf('npc.postie');
const neutral = createInputFrame();
const QUIET = endlessShiftTuning((raw) => {
  raw.streetLife.awareness.radiusM = 0.01;
});

function townWorld(): World {
  const world = createWorld(TOWN, 85, QUIET);
  world.vehicle.xM = 75;
  world.vehicle.yM = 7;
  return world;
}

/** Add the postie at (x, y) as the spawner would. */
function addPostie(world: World, x: number, y: number): number {
  const i = addNpcAt(world.npc, POSTIE, NpcOrigin.Ambient, x, y);
  world.npc.radius[i] = world.npcAi.spawner.radiusByKind[POSTIE] as number;
  world.npc.walkMps[i] = world.npcAi.spawner.speedByKind[POSTIE] as number;
  setNpcState(world.npc, i, postieBehaviour.initial);
  return i;
}

type Stop = { start: number; ticks: number; node: number; x: number; y: number; heading: number };

/**
 * Step `world` `ticks` times, recording each of NPC `i`'s Idle episodes (door stops); he stands still through
 * each one, within `driftM` (the separation from a neighbour may nudge and turn him; with none he holds his
 * heading too).
 */
function recordStops(world: World, i: number, ticks: number, driftM = 1e-9): Stop[] {
  const stops: Stop[] = [];
  let open: Stop | null = null;
  for (let t = 0; t < ticks; t++) {
    world.step(neutral);
    const npc = world.npc;
    if (npc.state[i] === PED.Idle) {
      if (open === null) {
        open = {
          start: t,
          ticks: 0,
          node: npc.goalNode[i] as number,
          x: npc.x[i] as number,
          y: npc.y[i] as number,
          heading: npc.heading[i] as number,
        };
        stops.push(open);
      }
      open.ticks++;
      // He stands still for the whole stop, facing the same way.
      expect(
        Math.hypot((npc.x[i] as number) - open.x, (npc.y[i] as number) - open.y),
        `tick ${t}`,
      ).toBeLessThanOrEqual(driftM);
      if (driftM < 1e-6) expect(npc.heading[i]).toBe(open.heading);
    } else {
      open = null;
      expect([PED.Walk, PED.Cross], `tick ${t}`).toContain(npc.state[i]);
    }
  }
  return stops;
}

describe('npc.postie: the frontage round', () => {
  it('has the registry behaviour, 1.2 m/s and a 3 s (180-tick) door stop from entities.json', () => {
    const world = townWorld();
    expect(world.npcAi.behaviours[POSTIE]).toBe(postieBehaviour);
    expect(world.npcAi.spawner.speedByKind[POSTIE]).toBe(1.2);
    expect(DEFAULT_ENTITIES.npcs['npc.postie'].rules.doorStopS).toBe(3);
    expect(doorStopTicks(world)).toBe(180);
  });

  it('the round holds every door once and works along each side of the street before crossing it', () => {
    const world = townWorld();
    const round = world.npcAi.doorRound;
    const nav = world.level.nav;
    const doors = [...new Set(nav.doors.map((d) => d.node))];
    expect(doors.length).toBeGreaterThan(15);
    expect(round.count).toBe(doors.length);
    expect([...round.node].sort((a, b) => a - b)).toEqual([...doors].sort((a, b) => a - b));
    for (let k = 0; k < round.count; k++) expect(round.roundAt[round.node[k] as number]).toBe(k);
    // North doors are on the pavement in front of the north terrace (row 1), south ones on the wide pavement
    // in front of the south terrace; going round the loop he changes side twice (once across, once back).
    const side = (k: number): number =>
      (nav.nodeY[round.node[k] as number] as number) < 11 * TILE_M * 0.5 ? 0 : 1;
    let changes = 0;
    for (let k = 0; k < round.count; k++) if (side(k) !== side((k + 1) % round.count)) changes++;
    expect(changes).toBe(2);
    // Each stop faces the facade of its (first) frontage: a south-facing front is looked at facing north (0),
    // a north-facing one facing south (π), an east-facing one facing west (−π/2), a west-facing one east.
    const look = { n: Math.PI, e: -Math.PI / 2, s: 0, w: Math.PI / 2 } as const;
    const faceOf = new Map(world.level.frontages.map((f) => [f.id, f.face]));
    for (let k = 0; k < round.count; k++) {
      const door = nav.doors.find((d) => d.node === round.node[k]);
      const face = faceOf.get(door?.frontage ?? '');
      expect(face).toBeDefined();
      expect(round.faceRad[k]).toBe(look[face ?? 'n']);
      if (side(k) === 0) expect(face).toBe('s');
    }
  });

  it('stops 180 ticks at each door of the round, in order, facing the facade, then walks on to the next', () => {
    const world = townWorld();
    const round = world.npcAi.doorRound;
    const nav = world.level.nav;
    const i = addPostie(world, 3, 3); // tile (1, 1), the north pavement's west end
    const first = nextRoundStop(world, i);
    // A full loop of the round and back to where he started: about 2 × 76 m of frontage and a crossing at
    // 1.2 m/s plus 3 s a door.
    const stops = recordStops(world, i, 60 * 60 * 6);
    expect(stops.length).toBeGreaterThan(round.count + 1);
    for (let s = 0; s < round.count + 1; s++) {
      const stop = stops[s] as Stop;
      const k = (first + s) % round.count;
      const node = round.node[k] as number;
      expect(stop.node, `stop ${s}`).toBe(node);
      expect(stop.ticks, `stop ${s}`).toBe(180);
      // At the door (within its arrive radius), facing the facade.
      const d = Math.hypot(stop.x - (nav.nodeX[node] as number), stop.y - (nav.nodeY[node] as number));
      expect(d, `stop ${s}`).toBeLessThanOrEqual(world.npcAi.steering.nodeArriveM[node] as number);
      expect(stop.heading, `stop ${s}`).toBe(round.faceRad[k]);
      // Then he walks: the next stop starts after a walk of at least a tick.
      const next = stops[s + 1] as Stop;
      expect(next.start, `stop ${s}`).toBeGreaterThan(stop.start + stop.ticks);
    }
  });

  it('a door taken by someone standing on it: he makes his stop beside it and moves on', () => {
    const world = townWorld();
    const round = world.npcAi.doorRound;
    const nav = world.level.nav;
    const i = addPostie(world, 3, 3);
    const k = nextRoundStop(world, i);
    const door = round.node[(k + 1) % round.count] as number;
    // A stationary market trader planted on his second door.
    const trader = NPC_IDS.indexOf('npc.market_trader');
    const j = addNpcAt(
      world.npc,
      trader,
      NpcOrigin.Ambient,
      nav.nodeX[door] as number,
      nav.nodeY[door] as number,
    );
    world.npc.radius[j] = DEFAULT_TUNING.streetLife.npcRadius.humanM;
    setNpcState(world.npc, j, PED.Idle);
    const stops = recordStops(world, i, 60 * 40, 0.5);
    expect(stops.length).toBeGreaterThanOrEqual(3);
    const taken = stops[1] as Stop;
    expect(taken.node).toBe(door);
    expect(taken.ticks).toBe(180);
    const d = Math.hypot(taken.x - (nav.nodeX[door] as number), taken.y - (nav.nodeY[door] as number));
    expect(d).toBeLessThanOrEqual(DOOR_CROWD_M);
    expect((stops[2] as Stop).node).toBe(round.node[(k + 2) % round.count]);
  });

  it('after a fall and the fist-shake he goes back to his round', () => {
    const world = townWorld();
    const round = world.npcAi.doorRound;
    const i = addPostie(world, 3, 3);
    // Past his first stop and 1 s on his way to the next door.
    for (
      let t = 0;
      t < 60 * 20 && !(world.npc.state[i] === PED.Walk && (world.npc.stateTicks[i] as number) > 60);
      t++
    )
      world.step(neutral);
    expect(world.npc.state[i]).toBe(PED.Walk);
    const goal = world.npc.goalNode[i] as number;
    expect(round.roundAt[goal]).toBeGreaterThanOrEqual(0);
    world.npc.state[i] = PED.Fallen;
    world.npc.stateTicks[i] = 0;
    world.npc.stateLimit[i] = 87;
    for (let t = 0; t < 87 + 10 + 54 + 1; t++) world.step(neutral);
    expect([PED.Walk, PED.Idle]).toContain(world.npc.state[i]);
    let reached = false;
    for (let t = 0; t < 60 * 20 && !reached; t++) {
      world.step(neutral);
      reached = world.npc.state[i] === PED.Idle && world.npc.navState[i] === NavState.Arrived;
    }
    expect(reached).toBe(true);
    expect(world.npc.goalNode[i]).toBe(goal);
  });

  it('a hit costs −250 and 1 complaint (entities.json hit)', () => {
    const world = createWorld(npcTown(48, {}).level, 85, DEFAULT_TUNING);
    const body = DEFAULT_TUNING.vehicle.sweeper.body;
    const r = DEFAULT_TUNING.streetLife.npcRadius.humanM;
    const i = addPostie(world, 48, 48 - body.lengthM / 2 - r + 0.02);
    const v = world.vehicle;
    v.vLongMps = 2;
    v.vLatMps = 0;
    v.yawRateRadPerS = 0;
    world.step(neutral);
    const hit = DEFAULT_ENTITIES.npcs['npc.postie'].hit;
    expect([hit?.pts, hit?.complaints]).toEqual([-250, 1]);
    expect(world.npcAi.reactions.hits).toBe(1);
    expect(world.scoring.penaltyPts).toBe(-250);
    expect(world.complaints.count).toBe(1);
    expect(world.npc.state[i]).toBe(PED.Fallen);
  });
});
