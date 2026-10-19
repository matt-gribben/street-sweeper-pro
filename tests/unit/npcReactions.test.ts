// The shared pedestrian reaction model (SSP-082; ENTITY_CATALOG §3.2, §3.4; TECHNICAL_DESIGN §9.4, §11.1; ART_BIBLE
// §10.2): Bessie-vs-actor contact with the 1.0 m/s closing-speed rule, contact episodes and the 1.5 s ignore
// window, the hit penalty through the penalty pipeline, EV.NpcHit and the hit drops; the Horn, HiVis and
// BeaconYield stimuli; and the generic pedestrian's states and tick-exact timings.
//
// Worlds are the open district of tests/support/npcTown.ts (48 × 48 tiles, a nav grid every 8 m, no population, so
// the spawner adds nobody), with Bessie at its centre (48, 48) facing north. People are added by hand with the
// registry's behaviours (the generic pedestrian for every person kind).
import { describe, expect, it } from 'vitest';
import { createObb, refreshObbAxes } from '../../src/sim/collision/obb.ts';
import { obbVsCircle } from '../../src/sim/collision/sat.ts';
import { addComboPickup } from '../../src/sim/combo.ts';
import { Offence } from '../../src/sim/complaints.ts';
import { DT_S } from '../../src/sim/constants.ts';
import { LITTER_IDS, NPC_IDS, type NpcId } from '../../src/sim/entities.ts';
import { countEvents, EV } from '../../src/sim/eventQueue.ts';
import { createInputFrame, type InputFrame, PRESSED } from '../../src/sim/inputFrame.ts';
import { Stimulus } from '../../src/sim/npc/behaviour.ts';
import {
  ANGRY_TICKS,
  FALLEN_TICKS,
  GET_UP_TICKS,
  PED,
  STARTLE_HOP_TICKS,
  STARTLE_TICKS,
  YIELD_MIN_TICKS,
} from '../../src/sim/npc/behaviours/pedestrian.ts';
import { DROP_MAX_M, isHiVisActive, setLedBeacon, startHiVis } from '../../src/sim/npc/reactions.ts';
import { pushStimulus } from '../../src/sim/npc/stimuli.ts';
import {
  addNpcAt,
  NPC_FLAG,
  NpcOrigin,
  npcHandle,
  resolveNpcHandle,
  setNpcState,
  updateNpcCell,
} from '../../src/sim/npc/store.ts';
import { DEFAULT_ENTITIES, DEFAULT_TUNING } from '../../src/sim/tuning.ts';
import { createWorld, type World } from '../../src/sim/world.ts';
import { npcTown } from '../support/npcTown.ts';

const BODY = DEFAULT_TUNING.vehicle.sweeper.body;
const HALF_L = BODY.lengthM / 2;
const HUMAN_R = DEFAULT_TUNING.streetLife.npcRadius.humanM;
const SHOPPING = LITTER_IDS.indexOf('litter.spilled_shopping');

function kindOf(id: NpcId): number {
  return NPC_IDS.indexOf(id);
}

/** The open test district with Bessie at (48, 48) facing north and no population. */
function townWorld(seed = 82): World {
  return createWorld(npcTown(48, {}).level, seed, DEFAULT_TUNING);
}

/** Add a person of `id` at (x, y) as the spawner would: its radius, walking speed and behaviour's first state. */
function addPerson(world: World, id: NpcId, x: number, y: number): number {
  const kind = kindOf(id);
  const i = addNpcAt(world.npc, kind, NpcOrigin.Ambient, x, y);
  if (i < 0) throw new Error('store full');
  world.npc.radius[i] = HUMAN_R;
  world.npc.walkMps[i] = world.npcAi.spawner.speedByKind[kind] as number;
  setNpcState(world.npc, i, world.npcAi.behaviours[kind]?.initial ?? 0);
  return i;
}

/** Put NPC `handle` at (x, y) between ticks (a test standing in for its own walk). */
function place(world: World, handle: number, x: number, y: number): number {
  const i = resolveNpcHandle(world.npc, handle);
  world.npc.x[i] = x;
  world.npc.y[i] = y;
  updateNpcCell(world.npc, i);
  return i;
}

/** Bessie at her start pose, rolling north at `speedMps` with no yaw and the wheel straight. */
function holdBessie(world: World, speedMps: number): void {
  const v = world.vehicle;
  v.vLongMps = speedMps;
  v.vLatMps = 0;
  v.yawRateRadPerS = 0;
  v.steerRad = 0;
}

/** True when Bessie's body OBB overlaps NPC `i`'s circle (test-side check). */
function overlaps(world: World, i: number): boolean {
  const v = world.vehicle;
  const obb = createObb();
  obb.cx = v.xM;
  obb.cy = v.yM;
  obb.headingRad = v.headingRad;
  obb.halfWidthM = BODY.widthM / 2;
  obb.halfLengthM = HALF_L;
  refreshObbAxes(obb);
  const c = { overlap: false, normalX: 0, normalY: 0, depthM: 0 };
  return obbVsCircle(
    obb,
    world.npc.x[i] as number,
    world.npc.y[i] as number,
    world.npc.radius[i] as number,
    c,
  );
}

const neutral = createInputFrame();

function honk(): InputFrame {
  const f = createInputFrame();
  f.pressed = PRESSED.HORN;
  return f;
}

/** Steps `world` once with `input`, returning how many events of `type` the tick emitted. */
function stepCounting(world: World, input: InputFrame, type: number): number {
  world.step(input);
  return countEvents(world.events, type as (typeof EV)[keyof typeof EV]);
}

describe('actor hits (ENTITY_CATALOG §3.2, TECHNICAL_DESIGN §9.4)', () => {
  it('Bessie at 2 m/s into a pedestrian: one hit with the entities.json pts and complaints, the chain reset; 60 more ticks of contact add nothing', () => {
    const world = townWorld();
    const combo = world.scoring.combo;
    // A 12-pickup chain going in (the queue is sealed between ticks; open it for the tier events).
    world.events.sealed = false;
    for (let k = 0; k < 12; k++) addComboPickup(combo, world.events);
    expect(combo.chain).toBe(12);
    expect(combo.multiplier).toBeGreaterThan(1);
    // A shopper 2 cm inside her front bumper on her centre line.
    const i = addPerson(world, 'npc.shopper', 48, 48 - HALF_L - HUMAN_R + 0.02);
    const h = npcHandle(world.npc, i);
    const hit = DEFAULT_ENTITIES.npcs['npc.shopper'].hit;
    expect(hit).not.toBeNull();
    holdBessie(world, 2);
    let npcHits = stepCounting(world, neutral, EV.NpcHit);
    expect(npcHits).toBe(1);
    const e = world.events;
    let ev = -1;
    for (let k = 0; k < e.count; k++) if (e.type[k] === EV.NpcHit) ev = k;
    expect(e.entity[ev]).toBe(i);
    expect(e.c[ev]).toBe(kindOf('npc.shopper'));
    expect([e.a[ev], e.b[ev]]).toEqual([world.npc.x[i], world.npc.y[i]]);
    expect(world.scoring.penaltyPts).toBe(hit?.pts);
    expect(world.complaints.count).toBe(hit?.complaints);
    expect(countEvents(world.events, EV.Complaint)).toBe(hit?.complaints);
    expect(combo.chain).toBe(0);
    expect(combo.multiplier).toBe(1);
    expect(world.penalties.applied).toBe(1);
    expect(world.npcAi.reactions.hits).toBe(1);
    expect(world.npc.state[i]).toBe(PED.Fallen);
    // She keeps rolling into (and over) the fallen shopper for 60 more ticks: still touching, no second hit.
    for (let t = 0; t < 60; t++) {
      holdBessie(world, 2);
      npcHits += stepCounting(world, neutral, EV.NpcHit);
    }
    const j = resolveNpcHandle(world.npc, h);
    expect(overlaps(world, j)).toBe(true);
    expect(npcHits).toBe(1);
    expect(world.scoring.penaltyPts).toBe(hit?.pts);
    expect(world.complaints.count).toBe(hit?.complaints);
    expect(world.penalties.applied).toBe(1);
    expect(world.npcAi.reactions.hits).toBe(1);
  });

  it('a pedestrian walking into a stationary Bessie (closing speed < 1.0 m/s) bumps off and startles, no penalty', () => {
    const world = townWorld();
    // A businessman (he ignores the awareness radius) walking south at 1.4 m/s into her front from 2 m out.
    const i = addPerson(world, 'npc.businessman', 48, 48 - HALF_L - HUMAN_R - 2);
    const h = npcHandle(world.npc, i);
    let y = world.npc.y[i] as number;
    let bumpTick = -1;
    for (let t = 0; t < 120 && bumpTick < 0; t++) {
      y += 1.4 * DT_S;
      place(world, h, 48, y);
      holdBessie(world, 0);
      world.step(neutral);
      if (world.npcAi.reactions.bumps > 0) bumpTick = t;
    }
    expect(bumpTick).toBeGreaterThan(0);
    const j = resolveNpcHandle(world.npc, h);
    expect(world.npc.state[j]).toBe(PED.Startle);
    expect(world.npc.stateTicks[j]).toBe(1);
    expect(world.npc.stateLimit[j]).toBe(STARTLE_TICKS);
    expect(world.npcAi.reactions.hits).toBe(0);
    expect(world.npcAi.reactions.bumps).toBe(1);
    expect(world.scoring.penaltyPts).toBe(0);
    expect(world.complaints.count).toBe(0);
    expect(world.penalties.applied).toBe(0);
    expect(countEvents(world.events, EV.NpcHit)).toBe(0);
  });

  it('a hit runs Fallen (87 ticks) → GetUp (10) → Angry (54) → Walk, tick-exact, FALLEN through Fallen and GetUp', () => {
    expect([FALLEN_TICKS, GET_UP_TICKS, ANGRY_TICKS]).toEqual([87, 10, 54]);
    const world = townWorld();
    const i = addPerson(world, 'npc.shopper', 48, 48 - HALF_L - HUMAN_R + 0.02);
    const h = npcHandle(world.npc, i);
    holdBessie(world, 2);
    world.step(neutral);
    expect(world.npcAi.reactions.hits).toBe(1);
    // She drives off: teleport her 15 m away (beyond the awareness radius, inside the despawn distance), at rest.
    world.vehicle.xM = 63;
    const states: number[] = [world.npc.state[resolveNpcHandle(world.npc, h)] as number];
    const fallen: boolean[] = [];
    for (let t = 0; t < 160; t++) {
      holdBessie(world, 0);
      const j = resolveNpcHandle(world.npc, h);
      fallen.push(((world.npc.flags[j] as number) & NPC_FLAG.FALLEN) !== 0);
      world.step(neutral);
      states.push(world.npc.state[j] as number);
    }
    // Run lengths of the states observed after each tick, from the hit tick on.
    const runs: [number, number][] = [];
    for (const s of states) {
      const last = runs[runs.length - 1];
      if (last !== undefined && last[0] === s) last[1] += 1;
      else runs.push([s, 1]);
    }
    expect(runs.slice(0, 3)).toEqual([
      [PED.Fallen, 87],
      [PED.GetUp, 10],
      [PED.Angry, 54],
    ]);
    expect(runs[3]?.[0]).toBe(PED.Walk);
    // FALLEN is set while it lies down and gets up (ticks 1..97 here), and clear while it shakes its fist.
    expect(fallen.slice(0, 97).every((f) => f)).toBe(true);
    expect(fallen.slice(97, 97 + 54).some((f) => f)).toBe(false);
    expect(world.npcAi.reactions.hits).toBe(1);
  });

  it('a fallen actor is never hit again, and a touch less than 1.5 s after the last starts no new episode', () => {
    const world = townWorld();
    // A stationary market trader in her way: Bessie stopped in contact bumps him; touches resume later.
    const i = addPerson(world, 'npc.market_trader', 48, 48 - HALF_L - HUMAN_R + 0.02);
    const h = npcHandle(world.npc, i);
    holdBessie(world, 0);
    world.step(neutral);
    expect(world.npcAi.reactions.bumps).toBe(1);
    const touchY = world.npc.y[i] as number;
    // Away for 60 ticks, then back: the window (90 ticks from the last touch) is still open.
    for (let t = 0; t < 60; t++) {
      place(world, h, 48, touchY - 3);
      holdBessie(world, 0);
      world.step(neutral);
    }
    place(world, h, 48, touchY);
    holdBessie(world, 0);
    world.step(neutral);
    expect(world.npcAi.reactions.bumps).toBe(1);
    // Away for 89 ticks: the next touch is 90 ticks after the last one, a new episode.
    for (let t = 0; t < 89; t++) {
      place(world, h, 48, touchY - 3);
      holdBessie(world, 0);
      world.step(neutral);
    }
    place(world, h, 48, touchY);
    holdBessie(world, 0);
    world.step(neutral);
    expect(world.npcAi.reactions.bumps).toBe(2);
    // Knocked over, then struck again at speed while still FALLEN (after the window): no second hit.
    for (let t = 0; t < 90; t++) {
      place(world, h, 48, touchY - 3);
      holdBessie(world, 0);
      world.step(neutral);
    }
    place(world, h, 48, touchY);
    holdBessie(world, 3);
    world.step(neutral);
    expect(world.npcAi.reactions.hits).toBe(1);
    const fallenAt = world.tick;
    while (world.tick < fallenAt + 60) {
      const j = resolveNpcHandle(world.npc, h);
      expect(world.npc.state[j]).toBe(PED.Fallen);
      // Every 15 ticks it is pulled clear and Bessie rams it again from 2 cm away.
      if ((world.tick - fallenAt) % 15 === 0) {
        world.vehicle.xM = 48;
        world.vehicle.yM = 48;
        world.vehicle.headingRad = 0;
        place(world, h, 48, 48 - HALF_L - HUMAN_R + 0.02);
      }
      holdBessie(world, 3);
      world.step(neutral);
    }
    expect(world.npcAi.reactions.hits).toBe(1);
    expect(world.penalties.applied).toBe(1);
  });

  it('closing speed is Bessie’s own: a pedestrian she reverses into at 2 m/s is hit, one she pulls away from is not', () => {
    const world = townWorld();
    // Just inside her rear bumper while she reverses (south, +y) at 2 m/s.
    addPerson(world, 'npc.postie', 48, 48 + HALF_L + HUMAN_R - 0.02);
    holdBessie(world, -2);
    world.step(neutral);
    expect(world.npcAi.reactions.hits).toBe(1);
    const other = townWorld();
    // 20 cm inside her rear bumper while she drives forward (away from it) at 3 m/s: a bump, no hit.
    addPerson(other, 'npc.postie', 48, 48 + HALF_L + HUMAN_R - 0.2);
    holdBessie(other, 3);
    other.step(neutral);
    expect(other.npcAi.reactions.hits).toBe(0);
    expect(other.npcAi.reactions.bumps).toBe(1);
  });
});

describe('hit drops (ENTITY_CATALOG §6.1, §17 Q7)', () => {
  function knockOver(id: NpcId, seed = 82): { world: World; before: number; i: number } {
    const world = townWorld(seed);
    const i = addPerson(world, id, 48, 48 - HALF_L - HUMAN_R + 0.02);
    const before = world.litter.litterSpawned;
    holdBessie(world, 2);
    world.step(neutral);
    expect(world.npcAi.reactions.hits).toBe(1);
    return { world, before, i };
  }

  it('knocking Doris over spawns exactly 6 litter.spilled_shopping, 0 pts and 1 LU each, counted in litter spawned', () => {
    const { world, before, i } = knockOver('npc.old_woman');
    expect(DEFAULT_ENTITIES.npcs['npc.old_woman'].hit?.drops).toEqual([
      { litter: 'litter.spilled_shopping', count: 6 },
    ]);
    const lf = world.litter;
    expect(lf.litterSpawned - before).toBe(6);
    expect(lf.count).toBe(6);
    const dx = world.npc.x[i] as number;
    const dy = world.npc.y[i] as number;
    for (let k = 0; k < lf.count; k++) {
      expect(lf.kind[k]).toBe(SHOPPING);
      expect(Math.hypot((lf.x[k] as number) - dx, (lf.y[k] as number) - dy)).toBeLessThanOrEqual(DROP_MAX_M);
    }
    expect(world.scoring.litterPts[SHOPPING]).toBe(0);
    expect(lf.kinds.lu[SHOPPING]).toBe(1);
    // Doris's own hit: −500 and 2 complaints.
    expect(world.scoring.penaltyPts).toBe(-500);
    expect(world.complaints.count).toBe(2);
  });

  it('knocking a shopper over spawns none', () => {
    const { world, before } = knockOver('npc.shopper');
    expect(world.litter.litterSpawned - before).toBe(0);
    expect(world.litter.count).toBe(0);
  });

  it('places the drops from the npc stream: the same run puts them in the same places', () => {
    const a = knockOver('npc.old_woman', 5).world.litter;
    const b = knockOver('npc.old_woman', 5).world.litter;
    expect(Array.from(a.x.subarray(0, a.count))).toEqual(Array.from(b.x.subarray(0, b.count)));
    expect(Array.from(a.y.subarray(0, a.count))).toEqual(Array.from(b.y.subarray(0, b.count)));
    expect(Array.from(a.rot.subarray(0, a.count))).toEqual(Array.from(b.rot.subarray(0, b.count)));
  });
});

describe('horn stimulus (ENTITY_CATALOG §3.4)', () => {
  /** One honk with a fresh `id` at `distM` east of Bessie (placed as the tick starts). Returns its state. */
  function honkAt(id: NpcId, distM: number, warmTicks = 0): { state: number; aware: boolean } {
    const world = townWorld();
    const i = addPerson(world, id, 48 + distM, 48);
    const h = npcHandle(world.npc, i);
    for (let t = 0; t < warmTicks; t++) {
      place(world, h, 48 + distM, 48);
      world.step(neutral);
    }
    const j = place(world, h, 48 + distM, 48);
    const aware = ((world.npc.flags[j] as number) & NPC_FLAG.AWARE) !== 0;
    world.step(honk());
    expect(countEvents(world.events, EV.Horn)).toBe(1);
    return { state: world.npc.state[j] as number, aware };
  }

  it('a horn 7.9 m away moves a wandering pedestrian to Startle; 8.5 m away it does not', () => {
    expect(DEFAULT_TUNING.streetLife.horn.radiusM).toBe(8);
    expect(honkAt('npc.shopper', 7.9)).toEqual({ state: PED.Startle, aware: false });
    expect(honkAt('npc.shopper', 8.5).state).toBe(PED.Walk);
  });

  it('a horn moves an Aware pedestrian to Startle, a yielding one included', () => {
    // The businessman, inside the awareness radius: Aware (the AWARE mark) but walking, since he never yields;
    // he is told only by the horn. (Doris has her own horn rule since SSP-083: behaviours/oldWoman.test.ts.)
    expect(honkAt('npc.businessman', 5, 3)).toEqual({ state: PED.Startle, aware: true });
    // A shopper in the radius has already started yielding; the horn startles him out of it.
    const world = townWorld();
    const i = addPerson(world, 'npc.shopper', 53, 48);
    world.step(neutral);
    expect(world.npc.state[i]).toBe(PED.Yield);
    world.step(honk());
    expect(world.npc.state[i]).toBe(PED.Startle);
  });

  it('a startle holds frame 0 for its 4-tick hop standing still, then sidesteps, and ends after 30 ticks', () => {
    const world = townWorld();
    const i = addPerson(world, 'npc.businessman', 55, 48);
    const h = npcHandle(world.npc, i);
    world.step(honk());
    expect(world.npc.state[i]).toBe(PED.Startle);
    const xs: number[] = [world.npc.x[i] as number];
    let startled = 1;
    for (let t = 0; t < 100; t++) {
      world.step(neutral);
      const j = resolveNpcHandle(world.npc, h);
      if (world.npc.state[j] !== PED.Startle) break;
      xs.push(world.npc.x[j] as number);
      startled += 1;
    }
    expect(startled).toBe(STARTLE_TICKS);
    // The hop: the first STARTLE_HOP_TICKS ticks stand (speed only decays, there was none).
    expect(xs.slice(0, STARTLE_HOP_TICKS).every((x) => x === xs[0])).toBe(true);
  });
});

describe('awareness, BeaconYield and HiVis (ENTITY_CATALOG §3.4, §12)', () => {
  it('a yielding type yields inside the awareness radius (6 m, 10 m with upg.led_beacon), then walks on', () => {
    const world = townWorld();
    const near = addPerson(world, 'npc.shopper', 53.5, 48);
    const far = addPerson(world, 'npc.shopper', 48, 56);
    const hNear = npcHandle(world.npc, near);
    const hFar = npcHandle(world.npc, far);
    world.step(neutral);
    expect(world.npc.state[near]).toBe(PED.Yield);
    expect((world.npc.flags[near] as number) & NPC_FLAG.YIELDING).toBe(NPC_FLAG.YIELDING);
    expect(world.npc.state[far]).not.toBe(PED.Yield);
    // Fit the LED beacon: 10 m reaches the far one.
    setLedBeacon(world.npcAi.reactions, world.tuning, true);
    expect(world.npcAi.reactions.awarenessRadiusM).toBe(10);
    place(world, hFar, 48, 56);
    world.step(neutral);
    expect(world.npc.state[resolveNpcHandle(world.npc, hFar)]).toBe(PED.Yield);
    // Bessie leaves (teleported 15 m east, beyond both radii): after the 30-tick minimum yield they walk on.
    world.vehicle.xM = 70;
    for (let t = 0; t < YIELD_MIN_TICKS + 1; t++) world.step(neutral);
    expect(world.npc.state[resolveNpcHandle(world.npc, hNear)]).not.toBe(PED.Yield);
    expect(world.npc.state[resolveNpcHandle(world.npc, hFar)]).not.toBe(PED.Yield);
  });

  it('Doris and the businessman never yield to the awareness radius', () => {
    const world = townWorld();
    const doris = npcHandle(world.npc, addPerson(world, 'npc.old_woman', 52, 48));
    const biz = npcHandle(world.npc, addPerson(world, 'npc.businessman', 44, 48));
    for (let t = 0; t < 60; t++) {
      place(world, doris, 52, 48);
      place(world, biz, 44, 48);
      world.step(neutral);
      for (const h of [doris, biz]) {
        const j = resolveNpcHandle(world.npc, h);
        expect(world.npc.state[j]).not.toBe(PED.Yield);
        expect((world.npc.flags[j] as number) & NPC_FLAG.AWARE).toBe(NPC_FLAG.AWARE);
      }
    }
  });

  it('under HiVis a non-yielding type yields; a stationary type does not move', () => {
    const world = townWorld();
    const doris = npcHandle(world.npc, addPerson(world, 'npc.old_woman', 52, 48));
    const biz = npcHandle(world.npc, addPerson(world, 'npc.businessman', 44, 48));
    const trader = npcHandle(world.npc, addPerson(world, 'npc.market_trader', 48, 52.5));
    world.step(neutral);
    expect(world.npc.state[resolveNpcHandle(world.npc, doris)]).not.toBe(PED.Yield);
    expect(isHiVisActive(world)).toBe(false);
    startHiVis(world);
    expect(isHiVisActive(world)).toBe(true);
    const tx = world.npc.x[resolveNpcHandle(world.npc, trader)];
    const ty = world.npc.y[resolveNpcHandle(world.npc, trader)];
    place(world, doris, 52, 48);
    place(world, biz, 44, 48);
    world.step(neutral);
    for (const h of [doris, biz]) {
      const j = resolveNpcHandle(world.npc, h);
      expect(world.npc.state[j]).toBe(PED.Yield);
      expect((world.npc.flags[j] as number) & NPC_FLAG.HI_VIS).toBe(NPC_FLAG.HI_VIS);
    }
    for (let t = 0; t < 120; t++) {
      world.step(neutral);
      const j = resolveNpcHandle(world.npc, trader);
      expect(world.npc.state[j]).toBe(PED.Idle);
      expect([world.npc.x[j], world.npc.y[j]]).toEqual([tx, ty]);
      expect((world.npc.flags[j] as number) & NPC_FLAG.HI_VIS).toBe(0);
    }
  });

  it('HiVis lasts 12 s (720 ticks), and a pickup during it restarts the 12 s', () => {
    const world = townWorld();
    startHiVis(world);
    const start = world.tick;
    while (world.tick < start + 600) world.step(neutral);
    expect(isHiVisActive(world)).toBe(true);
    startHiVis(world);
    const again = world.tick;
    while (world.tick < again + 719) world.step(neutral);
    expect(isHiVisActive(world)).toBe(true);
    world.step(neutral);
    expect(isHiVisActive(world)).toBe(false);
  });
});

describe('stimuli the shared rules push (TECHNICAL_DESIGN §11.1)', () => {
  it('a Hit stimulus fells a pedestrian from any state but Fallen and GetUp; Bump and NearMiss startle it', () => {
    const world = townWorld();
    const i = addPerson(world, 'npc.shopper', 20, 20);
    const q = world.npcAi.stimuli;
    pushStimulus(q, Stimulus.NearMiss, npcHandle(world.npc, i));
    world.step(neutral);
    expect(world.npc.state[i]).toBe(PED.Startle);
    pushStimulus(q, Stimulus.Hit, npcHandle(world.npc, i));
    world.step(neutral);
    expect(world.npc.state[i]).toBe(PED.Fallen);
    const fellAt = world.npc.stateTicks[i];
    pushStimulus(q, Stimulus.Hit, npcHandle(world.npc, i));
    pushStimulus(q, Stimulus.Bump, npcHandle(world.npc, i));
    world.step(neutral);
    expect(world.npc.state[i]).toBe(PED.Fallen);
    expect(world.npc.stateTicks[i]).toBe((fellAt as number) + 1);
  });

  it('records a hit as an Offence.Hit penalty fact at the actor (phase 9 applies it)', () => {
    const world = townWorld();
    const i = addPerson(world, 'npc.mum_pushchair', 48, 48 - HALF_L - HUMAN_R + 0.02);
    let seen: { reason: number; pts: number; complaints: number; x: number; y: number } | null = null;
    const log = world.penalties;
    world.phaseTrace = (phase) => {
      if (phase === 9 && log.count > 0) {
        seen = {
          reason: log.reason[0] as number,
          pts: log.pts[0] as number,
          complaints: log.complaints[0] as number,
          x: log.x[0] as number,
          y: log.y[0] as number,
        };
      }
    };
    holdBessie(world, 2);
    world.step(neutral);
    expect(seen).toEqual({
      reason: Offence.Hit,
      pts: -500,
      complaints: 2,
      x: world.npc.x[i],
      y: world.npc.y[i],
    });
  });
});
