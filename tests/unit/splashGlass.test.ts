// Puddle splashes and broken glass (SSP-094; ENTITY_CATALOG §3.4, §4.2, §10; GDD §11.2): the splash of
// pedestrians within 1.5 m of a puddle crossing above 3 m/s (−50 each, a Startle, EV.Splash and EV.NpcSplash, every
// 3rd splash of the shift a complaint), the flung glass bottle that smashes into haz.broken_glass where it lands,
// the glass's −5 HP/s drain and the brush sweep that clears it for +20. The §17 heap check of the same rules is
// tests/unit/splashGlassAlloc.test.ts, in a file of its own so this file's other worlds do not shape V8's code.
//
// Splash worlds are the open district of tests/support/npcTown.ts (48 × 48 road tiles, no population), with Bessie
// at (48, 48) facing north and puddles added on her lane (column 24, x 48–50 m... and 46–48: her wheels span
// x 47.125–48.875, so a puddle on column 23 or 24 is under her). People are added by hand and held in place beside
// her each tick (a test standing in for their walk). Glass worlds are a hand-built east-west road.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Offence } from '../../src/sim/complaints.ts';
import { TILE_M } from '../../src/sim/constants.ts';
import { LITTER_IDS, NPC_IDS, type NpcId } from '../../src/sim/entities.ts';
import { countEvents, createEventQueue, EV, resetEvents } from '../../src/sim/eventQueue.ts';
import {
  addHazard,
  createHazardStore,
  HAZARD_CAPACITY,
  HazardFlag,
  hazardKindIndex,
  stepHazardContacts,
} from '../../src/sim/hazards.ts';
import { createHopper } from '../../src/sim/hopper.ts';
import { createInputFrame, type InputFrame, PRESSED } from '../../src/sim/inputFrame.ts';
import { addLitter, createLitterField, flingLitter, LitterFlag } from '../../src/sim/litter.ts';
import { createBlankLevel, decodeLevel, Ground, type Level, surfaceOfGround } from '../../src/sim/map.ts';
import { Stimulus } from '../../src/sim/npc/behaviour.ts';
import { PED } from '../../src/sim/npc/behaviours/pedestrian.ts';
import { SPLASH_ANIMAL_BEHAVIOURS } from '../../src/sim/npc/splash.ts';
import { addNpcAt, NpcOrigin, setNpcState, updateNpcCell } from '../../src/sim/npc/store.ts';
import { createStream, sfc32 } from '../../src/sim/rng.ts';
import { DEFAULT_ENTITIES, DEFAULT_TUNING } from '../../src/sim/tuning.ts';
import { createVehicleParams, createVehicleState } from '../../src/sim/vehicle.ts';
import { createWorld, stepWorld, type World } from '../../src/sim/world.ts';
import { endlessShiftTuning } from '../support/endlessShift.ts';
import { npcTown } from '../support/npcTown.ts';

const sweeper = DEFAULT_TUNING.vehicle.sweeper;
const BODY = sweeper.body;
const HUMAN_R = DEFAULT_TUNING.streetLife.npcRadius.humanM;
const SPLASH = DEFAULT_TUNING.streetLife.splash;
const PUDDLE = hazardKindIndex('haz.puddle');
const GLASS = hazardKindIndex('haz.broken_glass');
const POTHOLE = hazardKindIndex('haz.pothole');
const BOTTLE = LITTER_IDS.indexOf('litter.glass_bottle');
const CAN = LITTER_IDS.indexOf('litter.drink_can');
const GLASS_RULES = DEFAULT_ENTITIES.hazards['haz.broken_glass'].rules;
const EAST = Math.PI / 2;

const NEUTRAL = createInputFrame();

function frame(throttle: number, pressed = 0): InputFrame {
  const f = createInputFrame();
  f.throttle = throttle;
  f.pressed = pressed;
  return f;
}

// ---------------------------------------------------------------------------------------------------------
// Splash rigs
// ---------------------------------------------------------------------------------------------------------

/** The open town with Bessie at (48, 48) facing north and no population. */
function townWorld(seed = 94): World {
  return createWorld(npcTown(48, {}).level, seed, endlessShiftTuning());
}

/** Add a person of `id` at (x, y) as the spawner would: its radius, walking speed and first state. */
function addPerson(
  world: World,
  id: NpcId,
  x: number,
  y: number,
  origin: number = NpcOrigin.Ambient,
): number {
  const kind = NPC_IDS.indexOf(id);
  const i = addNpcAt(world.npc, kind, origin, x, y);
  if (i < 0) throw new Error('store full');
  world.npc.radius[i] = HUMAN_R;
  world.npc.walkMps[i] = world.npcAi.spawner.speedByKind[kind] as number;
  setNpcState(world.npc, i, world.npcAi.behaviours[kind]?.initial ?? 0);
  return i;
}

/** Hold NPC `i` at Bessie's centre plus (dx, dy) metres (between ticks). */
function holdBeside(world: World, i: number, dx: number, dy: number): void {
  world.npc.x[i] = world.vehicle.xM + dx;
  world.npc.y[i] = world.vehicle.yM + dy;
  updateNpcCell(world.npc, i);
}

/** Bessie rolling straight on at `speedMps` (written before each tick, so the test holds her speed). */
function holdSpeed(world: World, speedMps: number): void {
  const v = world.vehicle;
  v.vLongMps = speedMps;
  v.vLatMps = 0;
  v.yawRateRadPerS = 0;
  v.steerRad = 0;
}

/** x offset from Bessie's centre that leaves `gapM` between her side and a person's circle. */
function sideOffset(gapM: number): number {
  return BODY.widthM / 2 + gapM + HUMAN_R;
}

type SplashRun = { splashes: number; npcSplashes: number; complaintsByNpcSplash: number[]; ticks: number };

/**
 * Drive north at `speedMps` until Bessie's centre is north of `stopY`, holding the people of `held` at their
 * offsets every tick. Counts EV.Splash and EV.NpcSplash and records each NpcSplash's complaints.
 */
function crossNorth(
  world: World,
  speedMps: number,
  stopY: number,
  held: readonly { i: number; dx: number; dy: number }[],
): SplashRun {
  const run: SplashRun = { splashes: 0, npcSplashes: 0, complaintsByNpcSplash: [], ticks: 0 };
  while (world.vehicle.yM > stopY && run.ticks < 3000) {
    holdSpeed(world, speedMps);
    for (const h of held) holdBeside(world, h.i, h.dx, h.dy);
    stepWorld(world, NEUTRAL);
    run.ticks++;
    const ev = world.events;
    for (let e = 0; e < ev.count; e++) {
      if (ev.type[e] === EV.Splash) run.splashes++;
      if (ev.type[e] === EV.NpcSplash) {
        run.npcSplashes++;
        run.complaintsByNpcSplash.push(ev.c[e] as number);
      }
    }
  }
  return run;
}

describe('puddle splash (ENTITY_CATALOG §3.4, §10)', () => {
  it('crossing a puddle at 3.5 m/s with 2 pedestrians within 1.5 m costs −100 and startles both', () => {
    const world = townWorld();
    addHazard(world.hazards, PUDDLE, 23, 21, 25, 22); // y 42–44 m, across her lane
    const left = addPerson(world, 'npc.shopper', 0, 0);
    const right = addPerson(world, 'npc.postie', 0, 0);
    const held = [
      { i: left, dx: -sideOffset(1.0), dy: 0 },
      { i: right, dx: sideOffset(1.4), dy: 0 },
    ];
    const startled: number[] = [];
    let splashTick = -1;
    let ticks = 0;
    while (world.vehicle.yM > 36 && ticks < 600) {
      holdSpeed(world, 3.5);
      for (const h of held) holdBeside(world, h.i, h.dx, h.dy);
      stepWorld(world, NEUTRAL);
      ticks++;
      if (countEvents(world.events, EV.NpcSplash) > 0) {
        splashTick = ticks;
        expect(countEvents(world.events, EV.NpcSplash)).toBe(2);
        // The Splash stimulus was delivered this tick: both are in their startle.
        startled.push(world.npc.state[left] as number, world.npc.state[right] as number);
        expect(world.scoring.penaltyPts).toBe(2 * SPLASH.pts);
        expect(world.scoring.combo.chain).toBe(0);
      }
    }
    expect(splashTick).toBeGreaterThan(0);
    expect(startled).toEqual([PED.Startle, PED.Startle]);
    expect(SPLASH.pts).toBe(-50);
    expect(world.scoring.penaltyPts).toBe(-100);
    expect(world.scoring.score).toBe(-100);
    expect(world.complaints.count).toBe(0);
    expect(world.npcAi.splash.splashes).toBe(2);
    expect(world.npcAi.splash.crossingSplashes).toBe(1);
    expect(world.npcAi.splash.episode).toBe(1);
    expect(world.npcAi.splash.wet).toBe(false);
    // Nobody was touched: the splash is not a hit.
    expect(world.npcAi.reactions.hits + world.npcAi.reactions.bumps).toBe(0);
  });

  it('at 2.9 m/s the same crossing costs nothing and splashes no one', () => {
    const world = townWorld();
    addHazard(world.hazards, PUDDLE, 23, 21, 25, 22);
    const left = addPerson(world, 'npc.shopper', 0, 0);
    const right = addPerson(world, 'npc.postie', 0, 0);
    const run = crossNorth(world, 2.9, 36, [
      { i: left, dx: -sideOffset(1.0), dy: 0 },
      { i: right, dx: sideOffset(1.4), dy: 0 },
    ]);
    expect(run.splashes).toBe(0);
    expect(run.npcSplashes).toBe(0);
    expect(world.scoring.penaltyPts).toBe(0);
    expect(world.npc.state[left]).not.toBe(PED.Startle);
    expect(world.npc.state[right]).not.toBe(PED.Startle);
    // She was in the puddle: the crossing counted, it was just too slow.
    expect(world.npcAi.splash.episode).toBe(1);
  });

  it('splashes nobody further than 1.5 m from her body, and no one twice in one crossing', () => {
    const world = townWorld();
    addHazard(world.hazards, PUDDLE, 23, 21, 25, 22);
    const near = addPerson(world, 'npc.shopper', 0, 0);
    const far = addPerson(world, 'npc.shopper', 0, 0);
    // A person level with her front bumper, 1.5 m ahead of it (the gap is exactly the radius: splashed).
    const ahead = addPerson(world, 'npc.postie', 0, 0);
    const run = crossNorth(world, 3.5, 36, [
      { i: near, dx: sideOffset(1.5) - 1e-9, dy: 0 },
      { i: far, dx: -sideOffset(1.5) - 0.01, dy: 0 },
      { i: ahead, dx: 0, dy: -(BODY.lengthM / 2 + 1.5 + HUMAN_R) + 1e-9 },
    ]);
    expect(run.npcSplashes).toBe(2);
    expect(world.npc.splashEpisode[near]).toBe(1);
    expect(world.npc.splashEpisode[ahead]).toBe(1);
    expect(world.npc.splashEpisode[far]).toBe(0);
    expect(world.scoring.penaltyPts).toBe(-100);
  });

  it('the 3rd counted splash in a shift adds exactly 1 complaint, and the 6th adds another', () => {
    const world = townWorld();
    // Six separate puddles up her lane, 6 m apart: six crossings.
    for (let k = 0; k < 6; k++) addHazard(world.hazards, PUDDLE, 23, 21 - 3 * k, 25, 22 - 3 * k);
    const ped = addPerson(world, 'npc.shopper', 0, 0);
    const complaintsAfter: number[] = [];
    let ticks = 0;
    while (world.vehicle.yM > 2 * TILE_M + 4 && ticks < 3000) {
      holdSpeed(world, 3.5);
      holdBeside(world, ped, sideOffset(0.8), 0);
      stepWorld(world, NEUTRAL);
      ticks++;
      if (countEvents(world.events, EV.NpcSplash) > 0) complaintsAfter.push(world.complaints.count);
    }
    expect(world.npcAi.splash.episode).toBe(6);
    expect(complaintsAfter).toEqual([0, 0, 1, 1, 1, 2]);
    expect(SPLASH.complaintEvery).toBe(3);
    expect(world.npcAi.splash.splashes).toBe(6);
    expect(world.npcAi.splash.complaints).toBe(2);
    expect(world.complaints.count).toBe(2);
    expect(world.scoring.penaltyPts).toBe(6 * SPLASH.pts);
  });

  it('counts splashed pedestrians across crossings: 3 at once file the complaint on the 3rd', () => {
    const world = townWorld();
    addHazard(world.hazards, PUDDLE, 23, 21, 25, 22);
    const a = addPerson(world, 'npc.shopper', 0, 0);
    const b = addPerson(world, 'npc.shopper', 0, 0);
    const c = addPerson(world, 'npc.postie', 0, 0);
    const run = crossNorth(world, 4, 36, [
      { i: a, dx: sideOffset(0.5), dy: 0 },
      { i: b, dx: -sideOffset(0.5), dy: 0 },
      { i: c, dx: sideOffset(0.5), dy: 1.5 },
    ]);
    expect(run.complaintsByNpcSplash.sort()).toEqual([0, 0, 1]);
    expect(world.complaints.count).toBe(1);
    expect(world.scoring.penaltyPts).toBe(-150);
  });

  it('two touching puddles are one crossing; EV.Splash fires once per puddle, at its centre', () => {
    const world = townWorld();
    addHazard(world.hazards, PUDDLE, 23, 21, 25, 22);
    addHazard(world.hazards, PUDDLE, 23, 20, 25, 21);
    const ped = addPerson(world, 'npc.shopper', 0, 0);
    const where: [number, number, number][] = [];
    let ticks = 0;
    let npcSplashes = 0;
    while (world.vehicle.yM > 34 && ticks < 600) {
      holdSpeed(world, 3.5);
      holdBeside(world, ped, sideOffset(1), 0);
      stepWorld(world, NEUTRAL);
      ticks++;
      const ev = world.events;
      for (let e = 0; e < ev.count; e++) {
        if (ev.type[e] === EV.Splash)
          where.push([ev.entity[e] as number, ev.a[e] as number, ev.b[e] as number]);
        if (ev.type[e] === EV.NpcSplash) npcSplashes++;
      }
    }
    expect(where).toEqual([
      [0, 48, 43],
      [1, 48, 41],
    ]);
    expect(world.npcAi.splash.episode).toBe(1);
    expect(npcSplashes).toBe(1);
    // Off the puddles, the episode marks are cleared.
    expect(world.hazards.flags[0]).toBe(0);
    expect(world.hazards.flags[1]).toBe(0);
  });

  it('splashes once she speeds up above 3 m/s mid-puddle, and again on a later crossing of the same puddle', () => {
    const world = townWorld();
    addHazard(world.hazards, PUDDLE, 23, 21, 25, 22);
    const ped = addPerson(world, 'npc.shopper', 0, 0);
    let first = -1;
    let ticks = 0;
    while (world.vehicle.yM > 36 && ticks < 900) {
      const inPuddle = (world.hazards.flags[0] as number) & HazardFlag.Contact;
      holdSpeed(world, inPuddle !== 0 && world.vehicle.yM < 44 ? 3.2 : 2.0);
      holdBeside(world, ped, sideOffset(1), 0);
      stepWorld(world, NEUTRAL);
      ticks++;
      if (countEvents(world.events, EV.NpcSplash) > 0 && first < 0) first = ticks;
    }
    expect(first).toBeGreaterThan(0);
    expect(world.npcAi.splash.splashes).toBe(1);
    // Back to the start and through again: a new crossing splashes the same pedestrian again.
    const v = world.vehicle;
    v.xM = 48;
    v.yM = 48;
    v.prevXM = 48;
    v.prevYM = 48;
    stepWorld(world, NEUTRAL);
    crossNorth(world, 3.5, 36, [{ i: ped, dx: sideOffset(1), dy: 0 }]);
    expect(world.npcAi.splash.episode).toBe(2);
    expect(world.npcAi.splash.splashes).toBe(2);
    expect(world.npcAi.splash.crossingSplashes).toBe(2);
  });

  it('records each splash as an Offence.Splash penalty fact at the pedestrian, through the pipeline', () => {
    const world = townWorld();
    addHazard(world.hazards, PUDDLE, 23, 21, 25, 22);
    const ped = addPerson(world, 'npc.shopper', 0, 0);
    const reasons: number[] = [];
    let ticks = 0;
    // Watch phase 9's input: the penalty log as phase 8 leaves it.
    world.phaseTrace = (phase, w) => {
      if (phase !== 9) return;
      for (let k = 0; k < w.penalties.count; k++) reasons.push(world.penalties.reason[k] as number);
    };
    while (world.vehicle.yM > 36 && ticks < 600) {
      holdSpeed(world, 3.5);
      holdBeside(world, ped, sideOffset(1), 0);
      stepWorld(world, NEUTRAL);
      ticks++;
    }
    expect(reasons).toEqual([Offence.Splash]);
    expect(world.penalties.applied).toBe(1);
  });

  it('never splashes animals or a dog walker’s dog; Doris pays the −50 but does not startle', () => {
    expect(SPLASH_ANIMAL_BEHAVIOURS).toEqual(['cat', 'pigeon']);
    const world = townWorld();
    addHazard(world.hazards, PUDDLE, 23, 21, 25, 22);
    const cat = addPerson(world, 'npc.cat', 0, 0);
    const pigeon = addPerson(world, 'npc.pigeon', 0, 0, NpcOrigin.Flock);
    const dog = addPerson(world, 'npc.dog_walker', 0, 0, NpcOrigin.Companion);
    const doris = addPerson(world, 'npc.old_woman', 0, 0, NpcOrigin.Named);
    const dorisState = world.npc.state[doris] as number;
    const run = crossNorth(world, 3.5, 36, [
      { i: cat, dx: sideOffset(0.5), dy: 0 },
      { i: pigeon, dx: -sideOffset(0.5), dy: 0 },
      { i: dog, dx: sideOffset(0.5), dy: 1.2 },
      { i: doris, dx: -sideOffset(0.5), dy: 1.2 },
    ]);
    expect(run.npcSplashes).toBe(1);
    expect(world.npc.splashEpisode[doris]).toBe(1);
    expect(world.npc.splashEpisode[cat]).toBe(0);
    expect(world.npc.splashEpisode[pigeon]).toBe(0);
    expect(world.npc.splashEpisode[dog]).toBe(0);
    expect(world.scoring.penaltyPts).toBe(-50);
    // She never startles. (She may glare: since SSP-086 the dog's own module draws differently from the NPC
    // stream, so her wander target, and whether Bessie ends up in her path, moved at the SSP-094 merge.)
    expect(world.npc.state[doris]).not.toBe(PED.Startle);
    // Behaviour level: a Splash stimulus leaves her state alone.
    const doris2 = addPerson(world, 'npc.old_woman', 52, 48, NpcOrigin.Named);
    const before = world.npc.state[doris2] as number;
    expect(before).toBe(dorisState);
    world.npcAi.behaviours[world.npc.kind[doris2] as number]?.onStimulus(world, doris2, Stimulus.Splash, 0);
    expect(world.npc.state[doris2]).toBe(before);
  });

  it('the generic pedestrian startles on a Splash stimulus (behaviour level)', () => {
    const world = townWorld();
    const ped = addPerson(world, 'npc.shopper', 52, 48);
    expect(world.npc.state[ped]).toBe(PED.Walk);
    world.npcAi.behaviours[world.npc.kind[ped] as number]?.onStimulus(world, ped, Stimulus.Splash, 0);
    expect(world.npc.state[ped]).toBe(PED.Startle);
  });
});

// ---------------------------------------------------------------------------------------------------------
// Broken glass
// ---------------------------------------------------------------------------------------------------------

/** A w × h asphalt road with Bessie at (x, y) facing `heading` (east by default). Row 3 is her lane. */
function roadLevel(w = 40, h = 7, x = 10, y = 7, heading = EAST): Level {
  const level = createBlankLevel('test.glass_road', w, h);
  for (let i = 0; i < w * h; i++) {
    level.layers.ground[i] = Ground.Road;
    level.layers.surface[i] = surfaceOfGround(Ground.Road);
  }
  level.player = { x, y, heading };
  return level;
}

/** Fling litter item `i` of `world` from Bessie's pose and step until it lands (the 0.5 s arc). */
function flingAndLand(world: World, i: number): { x: number; y: number; smashes: number } {
  const rng = createStream(9, 'brush');
  expect(flingLitter(world.litter, i, world.vehicle, rng)).toBe(true);
  const x = world.litter.arcX1[i] as number;
  const y = world.litter.arcY1[i] as number;
  let smashes = 0;
  for (let t = 0; t < 40; t++) {
    stepWorld(world, NEUTRAL);
    smashes += countEvents(world.events, EV.GlassSmash);
  }
  return { x, y, smashes };
}

describe('broken glass from a flung bottle (ENTITY_CATALOG §4.2, §10)', () => {
  it('glass bottles appear from Tuesday: not in Monday’s Puddle Lane, in the High Street', () => {
    const districts = DEFAULT_ENTITIES.litter['litter.glass_bottle'].districts;
    expect(districts).not.toContain('district.puddle_lane');
    expect(districts).toContain('district.high_street');
    const puddleLane = decodeLevel(
      readFileSync(
        fileURLToPath(new URL('../../public/assets/levels/puddle_lane.json', import.meta.url)),
        'utf8',
      ),
    );
    expect(puddleLane.litter?.table.map((e) => e.id)).not.toContain('litter.glass_bottle');
  });

  it('a flung glass bottle creates one haz.broken_glass at its landing point', () => {
    const world = createWorld(roadLevel(), 3, DEFAULT_TUNING);
    const i = addLitter(world.litter, BOTTLE, 13.5, 6.6, 0);
    let smash: [number, number, number, number] | null = null;
    const rng = createStream(9, 'brush');
    flingLitter(world.litter, i, world.vehicle, rng);
    const landX = world.litter.arcX1[i] as number;
    const landY = world.litter.arcY1[i] as number;
    for (let t = 0; t < 40; t++) {
      stepWorld(world, NEUTRAL);
      const ev = world.events;
      for (let e = 0; e < ev.count; e++) {
        if (ev.type[e] !== EV.GlassSmash) continue;
        expect(smash).toBeNull();
        smash = [ev.entity[e] as number, ev.a[e] as number, ev.b[e] as number, ev.c[e] as number];
      }
    }
    expect(world.hazards.count).toBe(1);
    expect(world.hazards.kind[0]).toBe(GLASS);
    expect([
      world.hazards.col0[0],
      world.hazards.row0[0],
      world.hazards.col1[0],
      world.hazards.row1[0],
    ]).toEqual([
      Math.floor(landX / TILE_M),
      Math.floor(landY / TILE_M),
      Math.floor(landX / TILE_M) + 1,
      Math.floor(landY / TILE_M) + 1,
    ]);
    expect(smash).toEqual([0, landX, landY, 1]);
    // The bottle is gone (it smashed), still counted as spawned, never collected.
    expect(world.litter.count).toBe(0);
    expect(world.litter.litterSpawned).toBe(1);
    expect(world.litter.litterCollected).toBe(0);
    expect(world.hazards.glassSmashed).toBe(1);
    expect(world.hazards.hazardsSpawned).toBe(1);
  });

  it('the brush flings a bottle hit at the brush-down top speed and it lands as glass', () => {
    const world = createWorld(roadLevel(60), 4, DEFAULT_TUNING);
    // Lower the brush and get up to speed first, then meet the bottle.
    stepWorld(world, frame(255, PRESSED.BRUSH));
    let flings = 0;
    let t = 0;
    while (world.vehicle.xM < 30 && t < 900) {
      stepWorld(world, frame(255));
      t++;
    }
    expect(world.vehicle.vLongMps).toBeGreaterThan(5.95);
    addLitter(world.litter, BOTTLE, world.vehicle.xM + 2.2, 7, 0);
    for (let k = 0; k < 90; k++) {
      stepWorld(world, frame(255));
      flings += countEvents(world.events, EV.Fling);
    }
    expect(flings).toBe(1);
    expect(world.hazards.count).toBe(1);
    expect(world.hazards.kind[0]).toBe(GLASS);
    expect(world.hazards.glassSmashed).toBe(1);
    expect(world.litter.count).toBe(0);
  });

  it('only a kind with a flung rule smashes: a flung can lands as litter', () => {
    const world = createWorld(roadLevel(), 3, DEFAULT_TUNING);
    const i = addLitter(world.litter, CAN, 13.5, 6.6, 0);
    const r = flingAndLand(world, i);
    expect(r.smashes).toBe(0);
    expect(world.hazards.count).toBe(0);
    expect(world.litter.count).toBe(1);
    expect(world.litter.flags[0] as number).toBe(0);
  });

  it('a bottle landing on broken glass smashes into it without adding another hazard', () => {
    const world = createWorld(roadLevel(), 3, DEFAULT_TUNING);
    const i = addLitter(world.litter, BOTTLE, 13.5, 6.6, 0);
    const rng = createStream(9, 'brush');
    flingLitter(world.litter, i, world.vehicle, rng);
    const col = Math.floor((world.litter.arcX1[i] as number) / TILE_M);
    const row = Math.floor((world.litter.arcY1[i] as number) / TILE_M);
    addHazard(world.hazards, GLASS, col, row, col + 1, row + 1);
    let created = -1;
    for (let t = 0; t < 40; t++) {
      stepWorld(world, NEUTRAL);
      for (let e = 0; e < world.events.count; e++) {
        if (world.events.type[e] === EV.GlassSmash) created = world.events.c[e] as number;
      }
    }
    expect(created).toBe(0);
    expect(world.hazards.count).toBe(1);
    expect(world.litter.count).toBe(0);
    expect(world.hazards.glassSmashed).toBe(1);
  });

  it('lands whole on a tile another hazard covers, and with the store at its 64 cap', () => {
    // Another hazard's tile.
    const a = createWorld(roadLevel(), 3, DEFAULT_TUNING);
    const i = addLitter(a.litter, BOTTLE, 13.5, 6.6, 0);
    flingLitter(a.litter, i, a.vehicle, createStream(9, 'brush'));
    const col = Math.floor((a.litter.arcX1[i] as number) / TILE_M);
    const row = Math.floor((a.litter.arcY1[i] as number) / TILE_M);
    addHazard(a.hazards, PUDDLE, col, row, col + 1, row + 1);
    for (let t = 0; t < 40; t++) stepWorld(a, NEUTRAL);
    expect(a.hazards.count).toBe(1);
    expect(a.litter.count).toBe(1);
    expect(a.litter.kind[0]).toBe(BOTTLE);
    expect(((a.litter.flags[0] as number) & LitterFlag.Flung) === 0).toBe(true);

    // A full store: dynamic hazards respect the 64 cap (TECHNICAL_DESIGN §7.1).
    const b = createWorld(roadLevel(40, 20, 10, 7), 3, DEFAULT_TUNING);
    for (let k = 0; b.hazards.count < HAZARD_CAPACITY; k++) {
      addHazard(b.hazards, POTHOLE, k % 40, 8 + Math.floor(k / 40), (k % 40) + 1, 9 + Math.floor(k / 40));
    }
    const j = addLitter(b.litter, BOTTLE, 13.5, 6.6, 0);
    const r = flingAndLand(b, j);
    expect(r.smashes).toBe(0);
    expect(b.hazards.count).toBe(HAZARD_CAPACITY);
    expect(b.litter.count).toBe(1);
  });
});

describe('broken glass HP drain (−5 HP/s)', () => {
  it('driving on broken glass for 60 ticks costs 5 HP ± 0.01', () => {
    expect(GLASS_RULES.hpPerS).toBe(5);
    const world = createWorld(roadLevel(), 3, DEFAULT_TUNING);
    // A 3-tile strip of glass in her lane, x 14–20 m; she starts with her wheels on its first tile.
    for (let col = 7; col < 10; col++) addHazard(world.hazards, GLASS, col, 3, col + 1, 4);
    world.vehicle.xM = 14.5;
    world.vehicle.prevXM = 14.5;
    stepWorld(world, NEUTRAL);
    expect(((world.hazards.flags[0] as number) & HazardFlag.Contact) !== 0).toBe(true);
    const before = world.vehicle.hp;
    for (let t = 0; t < 60; t++) {
      holdSpeed(world, 1.0);
      stepWorld(world, NEUTRAL);
      let on = false;
      for (let h = 0; h < world.hazards.count; h++) {
        if (((world.hazards.flags[h] as number) & HazardFlag.Contact) !== 0) on = true;
      }
      expect(on).toBe(true);
    }
    expect(before - world.vehicle.hp).toBeCloseTo(5, 2);
    expect(Math.abs(before - world.vehicle.hp - 5)).toBeLessThanOrEqual(0.01);
  });

  it('drains once a tick however many glass tiles are under her, and never below 0 HP', () => {
    const level = roadLevel();
    const store = createHazardStore(level, DEFAULT_ENTITIES, sfc32(1));
    addHazard(store, GLASS, 4, 3, 5, 4);
    addHazard(store, GLASS, 5, 3, 6, 4);
    const v = createVehicleState(sweeper, 10, 7, EAST);
    const params = createVehicleParams(sweeper, DEFAULT_TUNING.hopper.capacityLu);
    const hopper = createHopper(v, params, DEFAULT_TUNING.hopper);
    const litter = createLitterField(level, DEFAULT_TUNING, DEFAULT_ENTITIES);
    const events = createEventQueue();
    resetEvents(events, 0);
    const hp0 = v.hp;
    for (let t = 0; t < 12; t++) stepHazardContacts(store, v, sweeper, hopper, litter, events);
    expect(hp0 - v.hp).toBeCloseTo(1, 12); // 12 ticks × 5/60
    expect(events.count).toBe(0);
    v.hp = 0.05;
    stepHazardContacts(store, v, sweeper, hopper, litter, events);
    expect(v.hp).toBe(0);
  });

  it('a long stand on glass ends the shift TOWED', () => {
    const world = createWorld(roadLevel(), 3, DEFAULT_TUNING);
    addHazard(world.hazards, GLASS, 4, 3, 6, 4);
    world.vehicle.hp = 0.5;
    for (let t = 0; t < 10; t++) stepWorld(world, NEUTRAL);
    expect(world.vehicle.hp).toBe(0);
    expect(world.shift.endReason).not.toBe(0);
  });
});

describe('sweeping broken glass (+20)', () => {
  it('sweeping the glass awards +20 once and removes the hazard', () => {
    expect(GLASS_RULES.sweepPts).toBe(20);
    const world = createWorld(roadLevel(), 3, DEFAULT_TUNING);
    addHazard(world.hazards, GLASS, 10, 3, 11, 4); // x 20–22 m, in her lane
    // Lower the brush standing still, then roll into the glass.
    stepWorld(world, frame(0, PRESSED.BRUSH));
    for (let t = 0; t < 120; t++) stepWorld(world, NEUTRAL);
    const hp = world.vehicle.hp;
    let swept: [number, number, number, number][] = [];
    let chainAtSweep = -1;
    for (let t = 0; t < 600 && world.vehicle.xM < 30; t++) {
      stepWorld(world, frame(120));
      const ev = world.events;
      for (let e = 0; e < ev.count; e++) {
        if (ev.type[e] === EV.GlassSwept) {
          swept = [
            ...swept,
            [ev.entity[e] as number, ev.a[e] as number, ev.b[e] as number, ev.c[e] as number],
          ];
          chainAtSweep = world.scoring.combo.chain;
        }
      }
    }
    expect(world.vehicle.xM).toBeGreaterThan(29);
    expect(swept).toEqual([[GLASS, 21, 7, 20]]);
    expect(world.hazards.count).toBe(0);
    expect(world.hazards.glassSwept).toBe(1);
    // A pickup: +20 × the ×1 multiplier, the chain started; no LU, no Tidy litter counted.
    expect(world.scoring.itemPts).toBe(20);
    expect(chainAtSweep).toBe(1);
    expect(world.vehicle.hopperLU).toBe(0);
    expect(world.litter.litterCollected).toBe(0);
    // Head-on with the brush down, the zone took it before her wheels reached the tile.
    expect(world.vehicle.hp).toBe(hp);
  });

  it('with the brush raised she drives over the glass, loses HP and the glass stays', () => {
    const world = createWorld(roadLevel(), 3, DEFAULT_TUNING);
    addHazard(world.hazards, GLASS, 10, 3, 11, 4);
    const hp = world.vehicle.hp;
    for (let t = 0; t < 600 && world.vehicle.xM < 30; t++) stepWorld(world, frame(120));
    expect(world.hazards.count).toBe(1);
    expect(world.hazards.glassSwept).toBe(0);
    expect(world.scoring.itemPts).toBe(0);
    expect(world.vehicle.hp).toBeLessThan(hp);
  });

  it('the swept glass multiplies with the combo like a litter pickup', () => {
    const world = createWorld(roadLevel(60), 3, DEFAULT_TUNING);
    for (let k = 0; k < 9; k++) addLitter(world.litter, CAN, 16 + k * 0.6, 7, 0);
    addHazard(world.hazards, GLASS, 11, 3, 12, 4); // x 22–24 m, just after the cans (the chain lasts 2 s)
    stepWorld(world, frame(0, PRESSED.BRUSH));
    for (let t = 0; t < 120; t++) stepWorld(world, NEUTRAL);
    let mulAtSweep = 0;
    let chainAtSweep = 0;
    for (let t = 0; t < 900 && world.vehicle.xM < 40; t++) {
      stepWorld(world, frame(100));
      if (countEvents(world.events, EV.GlassSwept) > 0) {
        mulAtSweep = world.scoring.combo.multiplier;
        chainAtSweep = world.scoring.combo.chain;
      }
    }
    expect(world.litter.litterCollected).toBe(9);
    expect(chainAtSweep).toBe(10);
    expect(mulAtSweep).toBe(2); // the 10th pickup reaches ×2 (GDD §10.2)
    const canPts = DEFAULT_ENTITIES.litter['litter.drink_can'].pts;
    expect(world.scoring.itemPts).toBe(9 * canPts + 20 * 2);
  });
});
