// Doris, npc.old_woman (SSP-083; ENTITY_CATALOG §6.3, TECHNICAL_DESIGN §11.2): she never yields but to hi-vis,
// glares when Bessie blocks her path within 4 m and walks on after 60 clear ticks, shakes her fist for 90 ticks
// when honked at mid-glare and then walks at 0.4 m/s, chases at 1.2 m/s when sprayed and whacks a Bessie in reach
// for 2 HP every 60 ticks, gives up beyond 8 m, and a hit costs −500, 2 complaints and 6 spilled shopping. Also
// the Spray stimulus delivery from the spray cone (npc/reactions.ts).
//
// Worlds are the open district of tests/support/npcTown.ts (48 × 48 tiles, a nav node every 8 m at 1 + 8k m,
// no population), with Bessie at (48, 48) facing north unless a test moves her.
import { describe, expect, it } from 'vitest';
import { LITTER_IDS, NPC_IDS, type NpcId } from '../../../src/sim/entities.ts';
import { countEvents, EV, ShiftEndReason } from '../../../src/sim/eventQueue.ts';
import { BUTTON, createInputFrame, type InputFrame, PRESSED } from '../../../src/sim/inputFrame.ts';
import { Stimulus } from '../../../src/sim/npc/behaviour.ts';
import { DORIS, oldWomanBehaviour } from '../../../src/sim/npc/behaviours/oldWoman.ts';
import {
  ANGRY_TICKS,
  FALLEN_TICKS,
  GET_UP_TICKS,
  PED,
  YIELD_MIN_TICKS,
} from '../../../src/sim/npc/behaviours/pedestrian.ts';
import { setLedBeacon, startHiVis } from '../../../src/sim/npc/reactions.ts';
import { BEHAVIOUR_REGISTRY } from '../../../src/sim/npc/registry.ts';
import { NavState, requestNavPath } from '../../../src/sim/npc/steering.ts';
import { pushStimulus } from '../../../src/sim/npc/stimuli.ts';
import {
  addNpcAt,
  NPC_FLAG,
  NpcOrigin,
  npcHandle,
  resolveNpcHandle,
  setNpcState,
  updateNpcCell,
} from '../../../src/sim/npc/store.ts';
import { DEFAULT_ENTITIES, DEFAULT_TUNING } from '../../../src/sim/tuning.ts';
import { createWorld, type World } from '../../../src/sim/world.ts';
import { npcTown } from '../../support/npcTown.ts';

const BODY = DEFAULT_TUNING.vehicle.sweeper.body;
const HALF_L = BODY.lengthM / 2;
const HALF_W = BODY.widthM / 2;
const HUMAN_R = DEFAULT_TUNING.streetLife.npcRadius.humanM;
const DORIS_KIND = NPC_IDS.indexOf('npc.old_woman');
const RULES = DEFAULT_ENTITIES.npcs['npc.old_woman'].rules;
const MAX_HP = DEFAULT_TUNING.vehicle.sweeper.health.maxHp;
const SHOPPING = LITTER_IDS.indexOf('litter.spilled_shopping');
/** The npcTown nav node at grid column c, row r (48 tiles: 12 per side). */
const SIDE = 12;
const node = (c: number, r: number): number => r * SIDE + c;

const neutral = createInputFrame();

function honk(): InputFrame {
  const f = createInputFrame();
  f.pressed = PRESSED.HORN;
  return f;
}

function spray(): InputFrame {
  const f = createInputFrame();
  f.buttons = BUTTON.SPRAY;
  return f;
}

function townWorld(seed = 83): World {
  return createWorld(npcTown(48, {}).level, seed, DEFAULT_TUNING);
}

/** Add a person of `id` at (x, y) as the spawner would; returns its handle. */
function addPerson(world: World, id: NpcId, x: number, y: number): number {
  const kind = NPC_IDS.indexOf(id);
  const i = addNpcAt(world.npc, kind, NpcOrigin.Named, x, y);
  if (i < 0) throw new Error('store full');
  world.npc.radius[i] = HUMAN_R;
  world.npc.walkMps[i] = world.npcAi.spawner.speedByKind[kind] as number;
  setNpcState(world.npc, i, world.npcAi.behaviours[kind]?.initial ?? 0);
  return npcHandle(world.npc, i);
}

function idx(world: World, h: number): number {
  const i = resolveNpcHandle(world.npc, h);
  if (i < 0) throw new Error('stale handle');
  return i;
}

function place(world: World, h: number, x: number, y: number): void {
  const i = idx(world, h);
  world.npc.x[i] = x;
  world.npc.y[i] = y;
  updateNpcCell(world.npc, i);
}

/** Bessie's body centre at (x, y), facing `headingRad`, at rest (or rolling at `speedMps`). */
function putBessie(world: World, x: number, y: number, speedMps = 0, headingRad = 0): void {
  const v = world.vehicle;
  v.xM = x;
  v.yM = y;
  v.headingRad = headingRad;
  v.vLongMps = speedMps;
  v.vLatMps = 0;
  v.yawRateRadPerS = 0;
  v.steerRad = 0;
}

/** Bessie well out of everyone's way (and beyond the 8 m give-up distance), at rest. */
function bessieAway(world: World): void {
  putBessie(world, 88, 88);
}

const state = (world: World, h: number): number => world.npc.state[idx(world, h)] as number;

/**
 * Doris walking south along the x = 49 nav column from node (6, 5) at y = 41 towards node (6, 7) at y = 57, with
 * Bessie away; after `warm` ticks she is between the nodes, heading for (49, 49).
 */
function walkingDoris(warm = 30): { world: World; doris: number } {
  const world = townWorld();
  bessieAway(world);
  const doris = addPerson(world, 'npc.old_woman', 49, 41);
  expect(requestNavPath(world, idx(world, doris), node(6, 7))).toBe(true);
  for (let t = 0; t < warm; t++) world.step(neutral);
  expect(state(world, doris)).toBe(DORIS.Walk);
  expect(world.npc.navState[idx(world, doris)]).toBe(NavState.Walking);
  expect(world.npc.y[idx(world, doris)]).toBeGreaterThan(41.05);
  return { world, doris };
}

/** Park Bessie on Doris's path (x = 49) with her north edge `gapM` south of Doris's centre. */
function blockPath(world: World, doris: number, gapM: number): void {
  const y = world.npc.y[idx(world, doris)] as number;
  putBessie(world, 49, y + gapM + HALF_L);
}

/** A glaring Doris: walkingDoris, then Bessie stopped 3 m ahead on her path for one tick. */
function glaringDoris(): { world: World; doris: number } {
  const r = walkingDoris();
  blockPath(r.world, r.doris, 3);
  r.world.step(neutral);
  expect(state(r.world, r.doris)).toBe(DORIS.Glare);
  return r;
}

describe('Doris is registered (TECHNICAL_DESIGN §11.1)', () => {
  it('old_woman maps to her own module, which does not jaywalk and starts walking', () => {
    expect(BEHAVIOUR_REGISTRY.old_woman).toBe(oldWomanBehaviour);
    expect(townWorld().npcAi.behaviours[DORIS_KIND]).toBe(oldWomanBehaviour);
    expect(oldWomanBehaviour.jaywalks).toBe(false);
    expect(oldWomanBehaviour.initial).toBe(DORIS.Walk);
    expect(DEFAULT_ENTITIES.npcs['npc.old_woman'].yields).toBe(false);
    // Her rules (entities.json), as the tests below use them.
    expect(RULES).toEqual({
      chaseSpeedMps: 1.2,
      handbagHitHp: 2,
      whackEveryS: 1.0,
      chaseGiveUpM: 8,
      hornSlowSpeedMps: 0.4,
      glareM: 4,
      glareClearS: 1.0,
      fistShakeS: 1.5,
      hornSlowS: 10,
      handbagReachM: 0.6,
    });
  });
});

describe('never yields but to hi-vis (ENTITY_CATALOG §3.4, §6.3)', () => {
  it('never enters Yield under BeaconYield or awareness, with or without upg.led_beacon; does under HiVis', () => {
    const world = townWorld();
    // 4 m east of Bessie (inside the 6 m radius) and, below, 8 m east (inside the LED beacon's 10 m).
    const near = addPerson(world, 'npc.old_woman', 52, 48);
    const far = addPerson(world, 'npc.old_woman', 56, 48);
    for (let t = 0; t < 120; t++) {
      if (t === 60) setLedBeacon(world.npcAi.reactions, world.tuning, true);
      place(world, near, 52, 48);
      place(world, far, 56, 48);
      world.step(neutral);
      for (const h of [near, far]) {
        const i = idx(world, h);
        if (h === near || t >= 60)
          expect((world.npc.flags[i] as number) & NPC_FLAG.AWARE).toBe(NPC_FLAG.AWARE);
        expect(world.npc.state[i]).not.toBe(DORIS.Yield);
        expect((world.npc.flags[i] as number) & NPC_FLAG.YIELDING).toBe(0);
      }
    }
    // pwr.hi_vis: she parts, grudgingly, while Bessie is inside the awareness radius (10 m with the beacon).
    startHiVis(world);
    place(world, near, 52, 48);
    place(world, far, 56, 48);
    world.step(neutral);
    for (const h of [near, far]) {
      const i = idx(world, h);
      expect(world.npc.state[i]).toBe(DORIS.Yield);
      expect((world.npc.flags[i] as number) & NPC_FLAG.YIELDING).toBe(NPC_FLAG.YIELDING);
    }
    // For its 12 s, and then she walks on (after the minimum yield).
    const until = world.npcAi.reactions.hiVisUntilTick;
    while (world.tick < until) {
      place(world, near, 52, 48);
      world.step(neutral);
      expect(state(world, near)).toBe(DORIS.Yield);
    }
    for (let t = 0; t < YIELD_MIN_TICKS + 1; t++) {
      place(world, near, 52, 48);
      world.step(neutral);
    }
    expect(state(world, near)).not.toBe(DORIS.Yield);
  });

  it('hi-vis parts her out of a glare and out of a chase too', () => {
    const g = glaringDoris();
    startHiVis(g.world);
    g.world.step(neutral);
    expect(state(g.world, g.doris)).toBe(DORIS.Yield);
    const c = sprayedDoris();
    expect(state(c.world, c.doris)).toBe(DORIS.Chase);
    startHiVis(c.world);
    c.world.step(neutral);
    expect(state(c.world, c.doris)).toBe(DORIS.Yield);
    // She parts at her own walking speed, not the chase speed.
    expect(c.world.npc.walkMps[idx(c.world, c.doris)]).toBe(0.6);
  });
});

describe('Glare (TECHNICAL_DESIGN §11.2)', () => {
  it('with Bessie stopped 3 m ahead on her path she stops and glares at her; 60 clear ticks later she walks on', () => {
    const { world, doris } = glaringDoris();
    // She stops where she is, facing Bessie (south: heading π), and stays glaring while Bessie stays put.
    const i0 = idx(world, doris);
    const x0 = world.npc.x[i0] as number;
    const y0 = world.npc.y[i0] as number;
    for (let t = 0; t < 300; t++) {
      world.step(neutral);
      expect(state(world, doris)).toBe(DORIS.Glare);
    }
    const i = idx(world, doris);
    expect(Math.abs(Math.abs(world.npc.heading[i] as number) - Math.PI)).toBeLessThan(0.05);
    expect(world.npc.speed[i]).toBe(0);
    // Decelerating from 0.6 m/s at 4 m/s² carries her a few centimetres at most.
    expect(Math.hypot((world.npc.x[i] as number) - x0, (world.npc.y[i] as number) - y0)).toBeLessThan(0.06);
    // Bessie drives off: 59 clear ticks still glaring, the 60th walks on.
    bessieAway(world);
    for (let t = 0; t < 59; t++) {
      world.step(neutral);
      expect(state(world, doris)).toBe(DORIS.Glare);
    }
    world.step(neutral);
    expect(state(world, doris)).toBe(DORIS.Walk);
    expect(world.npc.walkMps[idx(world, doris)]).toBe(0.6);
    // And she walks on along her path, south.
    const yBefore = world.npc.y[idx(world, doris)] as number;
    for (let t = 0; t < 60; t++) world.step(neutral);
    expect(world.npc.y[idx(world, doris)] as number).toBeGreaterThan(yBefore + 0.4);
  });

  it('one blocked tick restarts the 60-tick clear count', () => {
    const { world, doris } = glaringDoris();
    bessieAway(world);
    for (let t = 0; t < 40; t++) world.step(neutral);
    expect(state(world, doris)).toBe(DORIS.Glare);
    blockPath(world, doris, 3);
    world.step(neutral);
    bessieAway(world);
    for (let t = 0; t < 59; t++) {
      world.step(neutral);
      expect(state(world, doris)).toBe(DORIS.Glare);
    }
    world.step(neutral);
    expect(state(world, doris)).toBe(DORIS.Walk);
  });

  it('glares within 4 m ahead only: not at 4.5 m, not beside her path, not behind her', () => {
    for (const [gap, glares] of [
      [3.9, true],
      [4.5, false],
    ] as const) {
      const { world, doris } = walkingDoris();
      blockPath(world, doris, gap);
      world.step(neutral);
      expect(state(world, doris), `gap ${gap}`).toBe(glares ? DORIS.Glare : DORIS.Walk);
    }
    // Beside her path: Bessie 3 m ahead but 2.5 m to the side (her body edge 1.6 m clear of Doris's line).
    const side = walkingDoris();
    const y = side.world.npc.y[idx(side.world, side.doris)] as number;
    putBessie(side.world, 49 + HALF_W + HUMAN_R + 1.5, y + 3 + HALF_L);
    side.world.step(neutral);
    expect(state(side.world, side.doris)).toBe(DORIS.Walk);
    // Behind her: Bessie 2 m north of her while she walks south.
    const behind = walkingDoris();
    const yb = behind.world.npc.y[idx(behind.world, behind.doris)] as number;
    putBessie(behind.world, 49, yb - 2 - HALF_L);
    behind.world.step(neutral);
    expect(state(behind.world, behind.doris)).toBe(DORIS.Walk);
  });
});

describe('horn: FistShake, then a slower walk (ENTITY_CATALOG §6.3)', () => {
  it('a horn during Glare: FistShake for exactly 90 ticks, standing; then she walks at 0.4 m/s for 600 ticks', () => {
    const { world, doris } = glaringDoris();
    world.step(honk());
    expect(countEvents(world.events, EV.Horn)).toBe(1);
    expect(state(world, doris)).toBe(DORIS.FistShake);
    // EV.FistShake (SSP-288, her "Hmph!" bubble): once, at her, with the 90-tick shake.
    expect(countEvents(world.events, EV.FistShake)).toBe(1);
    const q = world.events;
    for (let k = 0; k < q.count; k++) {
      if (q.type[k] !== EV.FistShake) continue;
      const i = idx(world, doris);
      expect([q.entity[k], q.a[k], q.b[k], q.c[k]]).toEqual([i, world.npc.x[i], world.npc.y[i], 90]);
    }
    // Bessie drives off straight after the honk, so nothing sends her back into a glare.
    bessieAway(world);
    const i0 = idx(world, doris);
    const x0 = world.npc.x[i0] as number;
    const y0 = world.npc.y[i0] as number;
    let shaking = 1;
    while (state(world, doris) === DORIS.FistShake && shaking < 200) {
      world.step(neutral);
      if (state(world, doris) === DORIS.FistShake) shaking += 1;
      const i = idx(world, doris);
      expect([world.npc.x[i], world.npc.y[i]]).toEqual([x0, y0]);
    }
    expect(shaking).toBe(90);
    expect(state(world, doris)).toBe(DORIS.SlowWalk);
    expect(world.npc.walkMps[idx(world, doris)]).toBe(0.4);
    // Up to speed, she walks at exactly 0.4 m/s (her path runs on south past y = 49).
    let slow = 1;
    let fastest = 0;
    while (state(world, doris) === DORIS.SlowWalk && slow < 1000) {
      const i = idx(world, doris);
      const y = world.npc.y[i] as number;
      world.step(neutral);
      const j = idx(world, doris);
      if (state(world, doris) === DORIS.SlowWalk) {
        slow += 1;
        fastest = Math.max(fastest, world.npc.speed[j] as number);
        expect(world.npc.speed[j] as number).toBeLessThanOrEqual(0.4 + 1e-12);
        expect(((world.npc.y[j] as number) - y) * 60).toBeLessThanOrEqual(0.4 + 1e-9);
      }
    }
    expect(fastest).toBeCloseTo(0.4, 12);
    expect(slow).toBe(RULES.hornSlowS * 60);
    expect(state(world, doris)).toBe(DORIS.Walk);
    expect(world.npc.walkMps[idx(world, doris)]).toBe(0.6);
  });

  it('a horn while she walks leaves her walking (no startle: she is never hurried)', () => {
    const { world, doris } = walkingDoris();
    // Bessie 5 m to her side: inside the horn's 8 m, not in her path.
    const y = world.npc.y[idx(world, doris)] as number;
    putBessie(world, 49 + 5, y);
    world.step(honk());
    expect(state(world, doris)).toBe(DORIS.Walk);
    expect(world.npc.walkMps[idx(world, doris)]).toBe(0.6);
  });

  it('Bessie in her path again during the slower walk sends her back to Glare, where a second horn shakes her fist again', () => {
    const { world, doris } = glaringDoris();
    world.step(honk());
    // Bessie stays in the way: after the fist shake, SlowWalk sees her and glares at once.
    let shakes = 0;
    for (let t = 0; t < 89; t++) {
      world.step(neutral);
      shakes += countEvents(world.events, EV.FistShake);
    }
    expect(state(world, doris)).toBe(DORIS.FistShake);
    world.step(neutral);
    expect(state(world, doris)).toBe(DORIS.SlowWalk);
    world.step(neutral);
    expect(state(world, doris)).toBe(DORIS.Glare);
    world.step(honk());
    expect(state(world, doris)).toBe(DORIS.FistShake);
    // Only a new fist shake is reported, never the ticks of one.
    expect(shakes).toBe(0);
    expect(countEvents(world.events, EV.FistShake)).toBe(1);
  });

  it('Bump and NearMiss leave her as she is', () => {
    const { world, doris } = walkingDoris();
    const q = world.npcAi.stimuli;
    pushStimulus(q, Stimulus.Bump, doris);
    pushStimulus(q, Stimulus.NearMiss, doris);
    world.step(neutral);
    expect(state(world, doris)).toBe(DORIS.Walk);
    expect(world.npc.state[idx(world, doris)]).not.toBe(PED.Startle);
  });
});

/** Doris 2.4 m ahead of the bumper of a stationary Bessie at (48, 48) facing north, sprayed for one tick. */
function sprayedDoris(): { world: World; doris: number } {
  const world = townWorld();
  // The cone: apex at the bumper (y = 46.375), 2.6 m long towards y = 43.775.
  const doris = addPerson(world, 'npc.old_woman', 48, 48 - HALF_L - 2.4);
  world.step(spray());
  expect(world.water.spraying).toBe(true);
  return { world, doris };
}

describe('spray: Chase and the handbag (ENTITY_CATALOG §6.3)', () => {
  it('spray leads to Chase at 1.2 m/s', () => {
    const { world, doris } = sprayedDoris();
    expect(state(world, doris)).toBe(DORIS.Chase);
    expect(world.npc.walkMps[idx(world, doris)]).toBe(1.2);
    // Bessie backs off to 7 m (inside the 8 m give-up distance): Doris comes after her at 1.2 m/s, no faster.
    const i = idx(world, doris);
    putBessie(world, 48, (world.npc.y[i] as number) + 7);
    let fastest = 0;
    for (let t = 0; t < 60; t++) {
      const y = world.npc.y[idx(world, doris)] as number;
      world.step(neutral);
      const j = idx(world, doris);
      expect(state(world, doris)).toBe(DORIS.Chase);
      fastest = Math.max(fastest, world.npc.speed[j] as number);
      expect(((world.npc.y[j] as number) - y) * 60).toBeLessThanOrEqual(1.2 + 1e-9);
    }
    expect(fastest).toBeCloseTo(1.2, 12);
  });

  it('a stationary Bessie in reach loses 2 HP every 60 ticks, from the first tick in reach, with EV.HandbagWhack', () => {
    const { world, doris } = sprayedDoris();
    expect(world.vehicle.hp).toBe(MAX_HP);
    const whackTicks: number[] = [];
    const hp: number[] = [];
    for (let t = 0; t < 500; t++) {
      world.step(neutral);
      const n = countEvents(world.events, EV.HandbagWhack);
      if (n > 0) {
        expect(n).toBe(1);
        whackTicks.push(world.tick);
        const e = world.events;
        for (let k = 0; k < e.count; k++) {
          if (e.type[k] !== EV.HandbagWhack) continue;
          const i = idx(world, doris);
          expect(e.entity[k]).toBe(i);
          expect([e.a[k], e.b[k], e.c[k]]).toEqual([world.npc.x[i], world.npc.y[i], 2]);
        }
      }
      hp.push(world.vehicle.hp);
      expect(state(world, doris)).toBe(DORIS.Chase);
    }
    expect(whackTicks.length).toBeGreaterThanOrEqual(6);
    for (let k = 1; k < whackTicks.length; k++) {
      expect((whackTicks[k] as number) - (whackTicks[k - 1] as number)).toBe(60);
    }
    expect(world.vehicle.hp).toBe(MAX_HP - 2 * whackTicks.length);
    // HP only ever drops by 2, on a whack tick.
    for (let k = 1; k < hp.length; k++) expect([0, 2]).toContain((hp[k - 1] as number) - (hp[k] as number));
    // She stands in reach: her centre within 0.6 m of Bessie's body, never touching it (no bump, no hit).
    const i = idx(world, doris);
    const gap = 48 - HALF_L - (world.npc.y[i] as number);
    expect(gap).toBeGreaterThan(HUMAN_R);
    expect(gap).toBeLessThanOrEqual(RULES.handbagReachM);
    expect(world.npcAi.reactions.bumps + world.npcAi.reactions.hits).toBe(0);
  });

  it('whacks clamp at 0 HP and end the shift TOWED', () => {
    const { world, doris } = sprayedDoris();
    world.vehicle.hp = 3;
    let lost = 0;
    let ended = -1;
    for (let t = 0; t < 400 && ended < 0; t++) {
      world.step(neutral);
      const e = world.events;
      for (let k = 0; k < e.count; k++) {
        if (e.type[k] === EV.HandbagWhack) lost += e.c[k] as number;
        if (e.type[k] === EV.ShiftEnd) ended = e.a[k] as number;
      }
    }
    expect(state(world, doris)).toBe(DORIS.Chase);
    expect(world.vehicle.hp).toBe(0);
    expect(lost).toBe(3);
    expect(ended).toBe(ShiftEndReason.Towed);
  });

  it('Bessie more than 8 m away returns her to Walk at her own speed; at 7.9 m she keeps chasing', () => {
    const { world, doris } = sprayedDoris();
    const i = idx(world, doris);
    const x = world.npc.x[i] as number;
    const y = world.npc.y[i] as number;
    putBessie(world, x, y + 7.9);
    place(world, doris, x, y);
    world.step(neutral);
    expect(state(world, doris)).toBe(DORIS.Chase);
    putBessie(world, x, y + 8.1);
    place(world, doris, x, y);
    world.step(neutral);
    expect(state(world, doris)).toBe(DORIS.Walk);
    expect(world.npc.walkMps[idx(world, doris)]).toBe(0.6);
    // She has dropped the chase for good: a fresh path, no more whacks.
    for (let t = 0; t < 120; t++) world.step(neutral);
    expect(world.vehicle.hp).toBe(MAX_HP);
  });

  it('cannot catch a Bessie reversing away at 2 m/s: no whack, and she gives up', () => {
    const { world, doris } = sprayedDoris();
    let gaveUp = false;
    for (let t = 0; t < 600 && !gaveUp; t++) {
      world.vehicle.vLongMps = -2;
      world.vehicle.vLatMps = 0;
      world.vehicle.yawRateRadPerS = 0;
      world.step(neutral);
      gaveUp = state(world, doris) === DORIS.Walk;
    }
    expect(gaveUp).toBe(true);
    expect(countEvents(world.events, EV.HandbagWhack)).toBe(0);
    expect(world.vehicle.hp).toBe(MAX_HP);
  });

  it('spray from Glare starts a chase too; outside the cone, or while she shakes her fist, it does nothing', () => {
    // Bessie faces north with the glaring Doris ahead of her bumper: 2 m is inside the 2.6 m cone, 3 m beyond it.
    const g = glaringDoris();
    blockPath(g.world, g.doris, 2);
    g.world.step(spray());
    expect(state(g.world, g.doris)).toBe(DORIS.Chase);
    const out = glaringDoris();
    out.world.step(spray());
    expect(state(out.world, out.doris)).toBe(DORIS.Glare);
    const shaking = glaringDoris();
    shaking.world.step(honk());
    blockPath(shaking.world, shaking.doris, 2);
    shaking.world.step(spray());
    expect(state(shaking.world, shaking.doris)).toBe(DORIS.FistShake);
  });
});

describe('Spray delivery from the cone (npc/reactions.ts, SSP-083)', () => {
  it('reaches every NPC whose centre is in the cone, edges included, and nobody outside it', () => {
    const world = townWorld();
    const apexY = 48 - HALF_L;
    const len = DEFAULT_TUNING.water.sprayConeLengthM;
    const half = DEFAULT_TUNING.water.sprayConeEndWidthM / 2;
    const inside = [
      addPerson(world, 'npc.shopper', 48, apexY - 0.01),
      addPerson(world, 'npc.shopper', 48 + half - 0.01, apexY - len + 0.001),
    ];
    const outside = [
      addPerson(world, 'npc.shopper', 48, apexY - len - 0.05),
      addPerson(world, 'npc.shopper', 48 + half * 0.5 + 0.2, apexY - len * 0.5),
      addPerson(world, 'npc.shopper', 48, apexY + 0.5),
    ];
    const seen = new Set<number>();
    const base = world.npcAi.behaviours[NPC_IDS.indexOf('npc.shopper')];
    if (base === undefined) throw new Error('no shopper behaviour');
    world.npcAi.behaviours[NPC_IDS.indexOf('npc.shopper')] = {
      initial: base.initial,
      jaywalks: false,
      tick(): void {
        // Stand still.
      },
      onStimulus(w: World, i: number, s: Stimulus): void {
        if (s === Stimulus.Spray) seen.add(npcHandle(w.npc, i));
      },
    };
    world.step(neutral);
    expect(seen.size).toBe(0);
    world.step(spray());
    expect([...seen].sort()).toEqual([...inside].sort());
    for (const h of outside) expect(seen.has(h)).toBe(false);
    // An empty tank sprays nothing, so nobody is told.
    seen.clear();
    world.vehicle.water = 0;
    world.step(spray());
    expect(world.water.spraying).toBe(false);
    expect(seen.size).toBe(0);
  });

  it('the generic pedestrian startles when sprayed', () => {
    const world = townWorld();
    const h = addPerson(world, 'npc.postie', 48, 48 - HALF_L - 1);
    world.step(spray());
    expect(state(world, h)).toBe(PED.Startle);
  });
});

describe('hit: knocked over (ENTITY_CATALOG §6.1, §6.3)', () => {
  it('a hit at ≥ 1.0 m/s closing speed costs −500 pts, 2 complaints and spawns 6 spilled shopping', () => {
    const world = townWorld();
    const doris = addPerson(world, 'npc.old_woman', 48, 48 - HALF_L - HUMAN_R + 0.02);
    const before = world.litter.litterSpawned;
    // Just over the 1.0 m/s closing speed after phase 2's rolling drag.
    putBessie(world, 48, 48, 1.05);
    world.step(neutral);
    expect(world.npcAi.reactions.hits).toBe(1);
    expect(countEvents(world.events, EV.NpcHit)).toBe(1);
    expect(world.scoring.penaltyPts).toBe(-500);
    expect(world.complaints.count).toBe(2);
    expect(world.litter.litterSpawned - before).toBe(6);
    let shopping = 0;
    for (let k = 0; k < world.litter.count; k++) if (world.litter.kind[k] === SHOPPING) shopping += 1;
    expect(shopping).toBe(6);
    expect(state(world, doris)).toBe(DORIS.Fallen);
  });

  it('below 1.0 m/s it is a bump: no penalty, and she does not startle', () => {
    const world = townWorld();
    const doris = addPerson(world, 'npc.old_woman', 48, 48 - HALF_L - HUMAN_R + 0.02);
    putBessie(world, 48, 48, 0.9);
    world.step(neutral);
    expect(world.npcAi.reactions.hits).toBe(0);
    expect(world.npcAi.reactions.bumps).toBe(1);
    expect(world.scoring.penaltyPts).toBe(0);
    expect(state(world, doris)).not.toBe(PED.Startle);
    expect(state(world, doris)).not.toBe(DORIS.Fallen);
  });

  it('Fallen 87 → GetUp 10 → Angry 54 → Walk at her own speed, from Walk, Glare, Chase or the slower walk', () => {
    expect([FALLEN_TICKS, GET_UP_TICKS, ANGRY_TICKS]).toEqual([87, 10, 54]);
    const starts: [string, () => { world: World; doris: number }][] = [
      ['walk', () => walkingDoris()],
      ['glare', () => glaringDoris()],
      ['chase', () => sprayedDoris()],
      [
        'slow walk',
        () => {
          const g = glaringDoris();
          g.world.step(honk());
          bessieAway(g.world);
          for (let t = 0; t < 120; t++) g.world.step(neutral);
          expect(state(g.world, g.doris)).toBe(DORIS.SlowWalk);
          return g;
        },
      ],
    ];
    for (const [label, start] of starts) {
      const { world, doris } = start();
      pushStimulus(world.npcAi.stimuli, Stimulus.Hit, doris);
      bessieAway(world);
      world.step(neutral);
      const states: number[] = [state(world, doris)];
      for (let t = 0; t < 160; t++) {
        world.step(neutral);
        states.push(state(world, doris));
      }
      const runs: [number, number][] = [];
      for (const s of states) {
        const last = runs[runs.length - 1];
        if (last !== undefined && last[0] === s) last[1] += 1;
        else runs.push([s, 1]);
      }
      expect(runs.slice(0, 3), label).toEqual([
        [DORIS.Fallen, 87],
        [DORIS.GetUp, 10],
        [DORIS.Angry, 54],
      ]);
      expect(runs[3]?.[0], label).toBe(DORIS.Walk);
      const i = idx(world, doris);
      expect(world.npc.walkMps[i], label).toBe(0.6);
      expect(world.npc.timerA[i], label).toBe(0);
    }
  });
});

describe('determinism', () => {
  it('two runs of the same glare, honk, chase and whack give the same Doris tick for tick', () => {
    const run = (): number[] => {
      const { world, doris } = glaringDoris();
      const out: number[] = [];
      for (let t = 0; t < 600; t++) {
        const input = t === 10 ? honk() : t === 200 || t === 201 ? spray() : neutral;
        if (t === 199) blockPath(world, doris, 1.5);
        world.step(input);
        const i = idx(world, doris);
        out.push(
          world.npc.state[i] as number,
          world.npc.x[i] as number,
          world.npc.y[i] as number,
          world.vehicle.hp,
        );
      }
      return out;
    };
    expect(run()).toEqual(run());
  });
});
