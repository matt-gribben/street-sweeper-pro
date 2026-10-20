// npc.mum_pushchair (SSP-085; ENTITY_CATALOG §6.1–§6.2): wide and slow. The pushchair widens her footprint, a
// circle of entities.json rules.footprintRadiusM (0.55 m) instead of the 0.3 m human one, and every path that
// touches an NPC reads it: the spawner's radius, Bessie's actor contact, separation and the steering
// constraints. A hit costs −500 and 2 complaints.
//
// Contact and the hit run on the open district of tests/support/npcTown.ts (Bessie at (48, 48) facing north);
// walking on the compiled steering town (tests/support/steeringTown.ts), whose north pavement is 1 tile wide
// with a lamp post, a litter bin and a hydrant on it.
import { describe, expect, it } from 'vitest';
import { TILE_M } from '../../../src/sim/constants.ts';
import { NPC_IDS, type NpcId } from '../../../src/sim/entities.ts';
import { createInputFrame } from '../../../src/sim/inputFrame.ts';
import { mumPushchairBehaviour } from '../../../src/sim/npc/behaviours/mumPushchair.ts';
import { PED } from '../../../src/sim/npc/behaviours/pedestrian.ts';
import { largestNpcRadiusM, npcKindRadiusM } from '../../../src/sim/npc/footprint.ts';
import {
  beginSteer,
  desiredVelocity,
  NavState,
  requestNavPath,
  steerSeparate,
} from '../../../src/sim/npc/steering.ts';
import { addNpcAt, NpcOrigin, setNpcState } from '../../../src/sim/npc/store.ts';
import { DEFAULT_ENTITIES, DEFAULT_TUNING } from '../../../src/sim/tuning.ts';
import { createWorld, type World } from '../../../src/sim/world.ts';
import { npcTown } from '../../support/npcTown.ts';
import { compileTown } from '../../support/steeringTown.ts';

const MUM = NPC_IDS.indexOf('npc.mum_pushchair');
const HUMAN_R = DEFAULT_TUNING.streetLife.npcRadius.humanM;
const BODY = DEFAULT_TUNING.vehicle.sweeper.body;
const neutral = createInputFrame();

/** Add a person of `id` at (x, y) as the spawner would: its kind's radius and speed, its first state. */
function addPerson(world: World, id: NpcId, x: number, y: number): number {
  const kind = NPC_IDS.indexOf(id);
  const i = addNpcAt(world.npc, kind, NpcOrigin.Ambient, x, y);
  world.npc.radius[i] = world.npcAi.spawner.radiusByKind[kind] as number;
  world.npc.walkMps[i] = world.npcAi.spawner.speedByKind[kind] as number;
  setNpcState(world.npc, i, world.npcAi.behaviours[kind]?.initial ?? 0);
  return i;
}

/** The open district, Bessie at (48, 48) facing north and rolling north at 2 m/s. */
function rollingWorld(): World {
  const world = createWorld(npcTown(48, {}).level, 85, DEFAULT_TUNING);
  const v = world.vehicle;
  v.vLongMps = 2;
  v.vLatMps = 0;
  v.yawRateRadPerS = 0;
  return world;
}

describe('npc.mum_pushchair: the widened footprint', () => {
  it('is a 0.55 m circle from entities.json, wider than the 0.3 m pedestrian circle, and spawns with it', () => {
    const r = DEFAULT_ENTITIES.npcs['npc.mum_pushchair'].rules.footprintRadiusM;
    expect(r).toBe(0.55);
    expect(r).toBeGreaterThan(HUMAN_R);
    expect(npcKindRadiusM(DEFAULT_TUNING, DEFAULT_ENTITIES, MUM)).toBe(r);
    expect(npcKindRadiusM(DEFAULT_TUNING, DEFAULT_ENTITIES, NPC_IDS.indexOf('npc.shopper'))).toBe(HUMAN_R);
    expect(largestNpcRadiusM(DEFAULT_TUNING, DEFAULT_ENTITIES)).toBe(r);
    // Two named mums at the home anchor at 1 s: the spawner gives them her radius and 1.1 m/s.
    const town = npcTown(48, {});
    town.level.npc = {
      ...(town.level.npc ?? { population: [], mix: [], caps: [], perches: null, flocks: [] }),
      named: [{ id: 'npc.mum_pushchair', count: 2, spawnAtS: 1, anchor: town.home, route: [], loop: false }],
    };
    const world = createWorld(town.level, 85, DEFAULT_TUNING);
    expect(world.npcAi.behaviours[MUM]).toBe(mumPushchairBehaviour);
    expect(world.npcAi.steering.maxRadiusM).toBe(r);
    for (let t = 0; t < 61; t++) world.step(neutral);
    expect(world.npc.count).toBe(2);
    for (let i = 0; i < 2; i++) {
      expect(world.npc.kind[i]).toBe(MUM);
      expect(world.npc.radius[i]).toBe(r);
      expect(world.npc.walkMps[i]).toBe(1.1);
    }
  });

  it('Bessie touches her where she would miss a 0.3 m pedestrian, and it is a hit', () => {
    // Off her front-right corner: 0.354 m from it, outside a 0.3 m circle and inside a 0.55 m one.
    const x = 48 + BODY.widthM / 2 + 0.25;
    const y = 48 - BODY.lengthM / 2 - 0.25;
    const shopperWorld = rollingWorld();
    addPerson(shopperWorld, 'npc.shopper', x, y);
    shopperWorld.step(neutral);
    expect(shopperWorld.npcAi.reactions.hits + shopperWorld.npcAi.reactions.bumps).toBe(0);
    expect(shopperWorld.scoring.penaltyPts).toBe(0);
    const world = rollingWorld();
    const i = addPerson(world, 'npc.mum_pushchair', x, y);
    world.step(neutral);
    expect(world.npcAi.reactions.hits).toBe(1);
    expect(world.npc.state[i]).toBe(PED.Fallen);
  });

  it('a hit costs −500 and 2 complaints (entities.json hit)', () => {
    const world = rollingWorld();
    const r = DEFAULT_ENTITIES.npcs['npc.mum_pushchair'].rules.footprintRadiusM;
    addPerson(world, 'npc.mum_pushchair', 48, 48 - BODY.lengthM / 2 - r + 0.02);
    world.step(neutral);
    const hit = DEFAULT_ENTITIES.npcs['npc.mum_pushchair'].hit;
    expect([hit?.pts, hit?.complaints]).toEqual([-500, 2]);
    expect(world.npcAi.reactions.hits).toBe(1);
    expect(world.scoring.penaltyPts).toBe(-500);
    expect(world.complaints.count).toBe(2);
    expect(world.penalties.applied).toBe(1);
  });

  it('separation keeps the others clear of her footprint: a shopper 1 m away is pushed off her, not off a shopper', () => {
    const world = createWorld(compileTown(), 85, DEFAULT_TUNING);
    world.vehicle.xM = 75;
    world.vehicle.yM = 7;
    const s = addPerson(world, 'npc.shopper', 30, 14);
    const m = addPerson(world, 'npc.mum_pushchair', 31, 14);
    beginSteer(world);
    steerSeparate(world, s);
    const pushOffMum = desiredVelocity(world)[0] as number;
    expect(pushOffMum).toBeLessThan(0); // away from her, west
    world.npc.kind[m] = NPC_IDS.indexOf('npc.shopper');
    world.npc.radius[m] = HUMAN_R;
    beginSteer(world);
    steerSeparate(world, s);
    expect(desiredVelocity(world)[0]).toBe(0); // 1 m is outside two humans' separation range (0.9 m)
  });

  it('no other NPC ever ends a move inside her footprint while they walk through each other', () => {
    const world = createWorld(compileTown(), 85, DEFAULT_TUNING);
    world.vehicle.xM = 75;
    world.vehicle.yM = 7;
    const st = world.npcAi.steering;
    const at = (tx: number, ty: number): number => st.tileNode[ty * st.widthTiles + tx] as number;
    const nav = world.level.nav;
    // Head-on along the wide pavement's row 7: the mum east, two shoppers west.
    const m = addPerson(
      world,
      'npc.mum_pushchair',
      nav.nodeX[at(4, 7)] as number,
      nav.nodeY[at(4, 7)] as number,
    );
    const a = addPerson(world, 'npc.shopper', nav.nodeX[at(16, 7)] as number, nav.nodeY[at(16, 7)] as number);
    const b = addPerson(world, 'npc.shopper', nav.nodeX[at(17, 7)] as number, nav.nodeY[at(17, 7)] as number);
    expect(requestNavPath(world, m, at(18, 7))).toBe(true);
    expect(requestNavPath(world, a, at(2, 7))).toBe(true);
    expect(requestNavPath(world, b, at(3, 7))).toBe(true);
    const r = world.npc.radius[m] as number;
    let closest = Number.POSITIVE_INFINITY;
    for (let t = 0; t < 1800; t++) {
      world.step(neutral);
      for (const o of [a, b]) {
        const d = Math.hypot(
          (world.npc.x[o] as number) - (world.npc.x[m] as number),
          (world.npc.y[o] as number) - (world.npc.y[m] as number),
        );
        closest = Math.min(closest, d);
        expect(d, `tick ${t}`).toBeGreaterThanOrEqual(r + HUMAN_R - 1e-6);
      }
    }
    // They met (and passed): the closest approach was a touch of her footprint, not of a human circle.
    expect(closest).toBeLessThan(r + HUMAN_R + 0.5);
    expect(world.npc.x[m] as number).toBeGreaterThan(nav.nodeX[at(17, 7)] as number);
    expect(world.npc.x[a] as number).toBeLessThan(nav.nodeX[at(4, 7)] as number);
  });

  it('on a 1-tile pavement she edges round the lamp post and the litter bin and arrives', () => {
    const world = createWorld(compileTown(), 85, DEFAULT_TUNING);
    world.vehicle.xM = 75;
    world.vehicle.yM = 7;
    const st = world.npcAi.steering;
    const nav = world.level.nav;
    const at = (tx: number): number => st.tileNode[1 * st.widthTiles + tx] as number;
    // Row 1: a lamp post at column 6 and a litter bin at column 14 (STEERING_TOWN).
    const m = addPerson(world, 'npc.mum_pushchair', nav.nodeX[at(2)] as number, nav.nodeY[at(2)] as number);
    expect(requestNavPath(world, m, at(18))).toBe(true);
    let arrivedAt = -1;
    for (let t = 0; t < 60 * 40 && arrivedAt < 0; t++) {
      world.step(neutral);
      // Her centre stays on the pavement (row 1) all the way.
      expect(Math.floor((world.npc.y[m] as number) / TILE_M), `tick ${t}`).toBe(1);
      if (world.npc.navState[m] === NavState.Arrived) arrivedAt = t;
    }
    // 32 m at 1.1 m/s is 29 s; she makes it in well under 40 s.
    expect(arrivedAt).toBeGreaterThan(0);
  });
});
