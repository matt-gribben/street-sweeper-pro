// Running an occupied zebra (SSP-085; GDD §11.2, ENTITY_CATALOG §3.3, §11): Bessie's body OBB entering a
// site.zebra while its occupancy is above 0 costs tuning.json complaints.zebra (−200 and 1 complaint), once per
// entry episode (re-armed when her OBB has fully left the zebra); an empty zebra costs nothing; a hit on the
// person crossing adds its own penalty on top.
//
// Worlds run on the compiled steering town (tests/support/steeringTown.ts): a two-lane road (rows 2–4, y 4–10 m)
// with a 1-tile zebra at column 10 (x 20–22 m). Bessie is put on the westbound lane's centre line at x 14 m,
// facing east, and driven at a held speed across the zebra.
import { describe, expect, it } from 'vitest';
import { Offence } from '../../src/sim/complaints.ts';
import { NPC_IDS, type NpcId } from '../../src/sim/entities.ts';
import { EV } from '../../src/sim/eventQueue.ts';
import { createInputFrame } from '../../src/sim/inputFrame.ts';
import { PED, stationaryPedestrianBehaviour } from '../../src/sim/npc/behaviours/pedestrian.ts';
import { addNpcAt, NpcOrigin, setNpcState, updateNpcCell } from '../../src/sim/npc/store.ts';
import { DEFAULT_TUNING } from '../../src/sim/tuning.ts';
import { createWorld, type World } from '../../src/sim/world.ts';
import { compileTown } from '../support/steeringTown.ts';

const TOWN = compileTown();
const ZEBRA = DEFAULT_TUNING.complaints.zebra;
const neutral = createInputFrame();
const LANE_Y = 7;

function townWorld(): World {
  const world = createWorld(TOWN, 85, DEFAULT_TUNING);
  placeBessie(world, 14);
  return world;
}

/** Bessie at (x, LANE_Y) facing east, at rest. */
function placeBessie(world: World, x: number): void {
  const v = world.vehicle;
  v.xM = x;
  v.yM = LANE_Y;
  v.headingRad = Math.PI / 2;
  v.vLongMps = 0;
  v.vLatMps = 0;
  v.yawRateRadPerS = 0;
  v.steerRad = 0;
}

/** Add a person of `id` at (x, y), standing still (the stationary pedestrian holds it on the zebra). */
function addStander(world: World, id: NpcId, x: number, y: number): number {
  const kind = NPC_IDS.indexOf(id);
  const i = addNpcAt(world.npc, kind, NpcOrigin.Ambient, x, y);
  world.npc.radius[i] = world.npcAi.spawner.radiusByKind[kind] as number;
  world.npc.walkMps[i] = world.npcAi.spawner.speedByKind[kind] as number;
  // Stand them still whatever their kind: the stationary pedestrian never walks (it still falls when hit).
  world.npcAi.behaviours[kind] = stationaryPedestrianBehaviour;
  setNpcState(world.npc, i, PED.Idle);
  return i;
}

type Tally = { zebraComplaints: number; hitComplaints: number; zebraAt: [number, number][] };

/** Step `ticks` ticks with Bessie held at `speedMps` east, tallying EV.Complaint by reason. */
function drive(world: World, ticks: number, speedMps: number, tally: Tally): void {
  for (let t = 0; t < ticks; t++) {
    const v = world.vehicle;
    v.vLongMps = speedMps;
    v.vLatMps = 0;
    v.yawRateRadPerS = 0;
    v.headingRad = Math.PI / 2;
    world.step(neutral);
    const e = world.events;
    for (let k = 0; k < e.count; k++) {
      if (e.type[k] !== EV.Complaint) continue;
      if (e.c[k] === Offence.Zebra) {
        tally.zebraComplaints++;
        tally.zebraAt.push([e.a[k] as number, e.b[k] as number]);
      } else if (e.c[k] === Offence.Hit) tally.hitComplaints++;
    }
  }
}

const newTally = (): Tally => ({ zebraComplaints: 0, hitComplaints: 0, zebraAt: [] });

describe('running an occupied zebra', () => {
  it('the tuning is −200 and 1 complaint (GDD §11.2)', () => {
    expect([ZEBRA.pts, ZEBRA.complaints]).toEqual([-200, 1]);
  });

  it('entering an occupied zebra costs −200 and 1 complaint exactly once per entry', () => {
    const world = townWorld();
    // Someone on the zebra's north lane, clear of her path along y 7 (her body spans y 6.1–7.9).
    const i = addStander(world, 'npc.shopper', 21, 5);
    const z = world.zebras;
    const tally = newTally();
    // 2.5 s at 2 m/s: her nose (1.6 m ahead of her centre) reaches the zebra (x 20) at about 2.2 s.
    drive(world, 150, 2, tally);
    expect(z.occupancy[0]).toBe(1);
    expect(z.bessieOn[0]).toBe(1);
    expect(z.offences).toBe(1);
    expect(world.scoring.penaltyPts).toBe(-200);
    expect(world.complaints.count).toBe(1);
    expect(tally.zebraComplaints).toBe(1);
    // Filed at the person on the zebra (the ped_oi comes from them).
    expect(tally.zebraAt).toEqual([[world.npc.x[i], world.npc.y[i]]]);
    // Sitting on the stripes for 2 s more, then rolling on across: still the one offence.
    drive(world, 120, 0, tally);
    drive(world, 240, 2, tally);
    expect(z.bessieOn[0]).toBe(0); // fully off it now (x > 22 + her half length)
    expect(world.vehicle.xM).toBeGreaterThan(22 + DEFAULT_TUNING.vehicle.sweeper.body.lengthM / 2);
    expect(z.offences).toBe(1);
    expect(world.scoring.penaltyPts).toBe(-200);
    expect(world.complaints.count).toBe(1);
    // Back round and in again: a second entry, a second offence.
    placeBessie(world, 14);
    drive(world, 150, 2, tally);
    expect(z.offences).toBe(2);
    expect(world.scoring.penaltyPts).toBe(-400);
    expect(world.complaints.count).toBe(2);
    expect(tally.zebraComplaints).toBe(2);
    expect(world.npcAi.reactions.hits).toBe(0);
  });

  it('an unoccupied zebra costs nothing, and someone stepping on while she is already on it costs nothing', () => {
    const world = townWorld();
    const z = world.zebras;
    const tally = newTally();
    drive(world, 150, 2, tally);
    expect(z.bessieOn[0]).toBe(1);
    expect(z.occupancy[0]).toBe(0);
    // A shopper steps onto the zebra while she is on it: not her running it (they walked out in front of her).
    const i = addStander(world, 'npc.shopper', 21, 5);
    updateNpcCell(world.npc, i);
    drive(world, 240, 2, tally);
    expect(z.occupancy[0]).toBe(1);
    expect(z.bessieOn[0]).toBe(0);
    expect(z.offences).toBe(0);
    expect(world.scoring.penaltyPts).toBe(0);
    expect(world.complaints.count).toBe(0);
    expect(tally.zebraComplaints).toBe(0);
  });

  it('a hit on the person crossing adds its own penalty on top: −200 + 1 C for the zebra, −500 + 2 C for the old man', () => {
    const world = townWorld();
    const i = addStander(world, 'npc.old_man_frame', 21, LANE_Y);
    const tally = newTally();
    drive(world, 180, 3, tally);
    expect(world.zebras.offences).toBe(1);
    expect(world.npcAi.reactions.hits).toBe(1);
    expect(world.npc.state[i]).toBe(PED.Fallen);
    expect(world.scoring.penaltyPts).toBe(-700);
    expect(world.complaints.count).toBe(3);
    expect(tally.zebraComplaints).toBe(1);
    expect(tally.hitComplaints).toBe(2);
    expect(world.penalties.applied).toBe(2);
  });
});
