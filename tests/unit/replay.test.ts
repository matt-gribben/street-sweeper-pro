// Replay format, input log and quantised state hash (src/sim/replay.ts; TECHNICAL_DESIGN §18.3, SSP-038), plus
// the runner's invariant geometry (tests/support/solidOverlap.ts, replayCheck.ts).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { encodeBase64 } from '../../src/sim/base64.ts';
import { addBody } from '../../src/sim/bodies.ts';
import { EV, pushEvent, ShiftEndReason } from '../../src/sim/eventQueue.ts';
import { addHazard } from '../../src/sim/hazards.ts';
import { DumpSite } from '../../src/sim/hopper.ts';
import {
  BRAKE_MAX,
  BUTTON,
  createInputFrame,
  type InputFrame,
  PRESSED,
  STEER_MAX,
  THROTTLE_MAX,
} from '../../src/sim/inputFrame.ts';
import { addLitter } from '../../src/sim/litter.ts';
import { createBlankLevel, decodeLevel } from '../../src/sim/map.ts';
import { Stimulus } from '../../src/sim/npc/behaviour.ts';
import { pushStimulus } from '../../src/sim/npc/stimuli.ts';
import { addNpcAt, NO_NPC_HANDLE, NPC_PATH_NODES, NpcOrigin, removeNpc } from '../../src/sim/npc/store.ts';
import {
  absorbTick,
  appendInput,
  attachInputLog,
  CHECKPOINT_INTERVAL_TICKS,
  checkpointTicks,
  clearInputLog,
  compareCheckpoints,
  createInputLog,
  createStateHasher,
  decodeInputBytes,
  decodeInputs,
  encodeInputBytes,
  encodeInputs,
  fnv1a32Bytes,
  fnv1a32Int32s,
  hashHex,
  type InputLog,
  inputLogsEqual,
  loadReplay,
  quantise,
  REPLAY_TICKS,
  type ReplayFile,
  readInput,
  recordReplay,
  runReplay,
  serialiseReplay,
  stateHash,
} from '../../src/sim/replay.ts';
import { nextInt, nextU32, sfc32 } from '../../src/sim/rng.ts';
import { addStain } from '../../src/sim/stains.ts';
import { DEFAULT_TUNING } from '../../src/sim/tuning.ts';
import type { VehicleState } from '../../src/sim/vehicle.ts';
import { addVehicle, VEHICLE_PLAN_EDGES } from '../../src/sim/vehicleStore.ts';
import { createWorld, type World } from '../../src/sim/world.ts';
import { syntheticInputLog, syntheticLevel } from '../replay/synthetic.ts';
import { createInvariantMonitor, invariantFailures } from '../support/replayCheck.ts';
import { obbBoundaryPenetrationM, obbRectPenetrationM, solidOverlapM } from '../support/solidOverlap.ts';

/**
 * A random 3,600-tick log: piecewise-constant controls held 1–90 ticks (so single-tick changes occur), the
 * full value ranges, one-tick pressed edges, and occasional large bitfields to exercise multi-byte varints.
 */
function randomLog(seed: number, ticks: number): InputLog {
  const rng = sfc32(seed);
  const log = createInputLog(ticks);
  const frame = createInputFrame();
  let hold = 0;
  for (let t = 0; t < ticks; t++) {
    if (hold === 0) {
      frame.throttle = nextInt(rng, THROTTLE_MAX + 1);
      frame.brake = nextInt(rng, 4) === 0 ? BRAKE_MAX : nextInt(rng, BRAKE_MAX + 1);
      frame.steer = nextInt(rng, 2 * STEER_MAX + 1) - STEER_MAX;
      frame.buttons = nextInt(rng, 20) === 0 ? 0x7fffffff - nextInt(rng, 1000) : nextInt(rng, 4);
      hold = 1 + nextInt(rng, 90);
    }
    frame.pressed = nextInt(rng, 25) === 0 ? 1 + nextInt(rng, 15) : 0;
    appendInput(log, t, frame);
    hold -= 1;
  }
  return log;
}

function logOf(frames: readonly (readonly [number, number, number, number, number])[]): InputLog {
  const log = createInputLog(frames.length);
  frames.forEach(([throttle, brake, steer, buttons, pressed], t) => {
    appendInput(log, t, { throttle, brake, steer, buttons, pressed });
  });
  return log;
}

describe('input log', () => {
  it('appends frames in tick order and reads them back', () => {
    const log = createInputLog(3);
    appendInput(log, 0, { throttle: 1, brake: 2, steer: -3, buttons: 4, pressed: 5 });
    appendInput(log, 1, { throttle: 255, brake: 255, steer: 127, buttons: 0, pressed: 0 });
    const out = createInputFrame();
    readInput(log, 0, out);
    expect(out).toEqual({ throttle: 1, brake: 2, steer: -3, buttons: 4, pressed: 5 });
    readInput(log, 1, out);
    expect(out).toEqual({ throttle: 255, brake: 255, steer: 127, buttons: 0, pressed: 0 });
    expect(log.length).toBe(2);
    clearInputLog(log);
    expect(log.length).toBe(0);
  });

  it('rejects a gap, a full log and values outside the InputFrame contract', () => {
    const ok = { throttle: 0, brake: 0, steer: 0, buttons: 0, pressed: 0 };
    const log = createInputLog(1);
    expect(() => appendInput(log, 1, ok)).toThrow(/expected tick 0 but got tick 1/);
    appendInput(log, 0, ok);
    expect(() => appendInput(log, 1, ok)).toThrow(/input log is full/);
    const fresh = (): InputLog => createInputLog(1);
    expect(() => appendInput(fresh(), 0, { ...ok, throttle: 256 })).toThrow(/throttle = 256/);
    expect(() => appendInput(fresh(), 0, { ...ok, brake: -1 })).toThrow(/brake = -1/);
    expect(() => appendInput(fresh(), 0, { ...ok, steer: -128 })).toThrow(/steer = -128/);
    expect(() => appendInput(fresh(), 0, { ...ok, steer: 0.5 })).toThrow(/steer = 0.5/);
    expect(() => appendInput(fresh(), 0, { ...ok, buttons: -1 })).toThrow(/buttons/);
    expect(() => appendInput(fresh(), 0, { ...ok, pressed: Number.NaN })).toThrow(/pressed/);
    expect(() => createInputLog(-1)).toThrow(/capacity/);
  });

  it("records exactly what the World's phase 1 saw through attachInputLog", () => {
    const level = syntheticLevel();
    const world = createWorld(level, 1, DEFAULT_TUNING);
    const recorded = createInputLog(REPLAY_TICKS);
    attachInputLog(world, recorded);
    const script = syntheticInputLog();
    const frame = createInputFrame();
    for (let t = 0; t < REPLAY_TICKS; t++) {
      readInput(script, t, frame);
      world.step(frame);
    }
    expect(recorded.length).toBe(REPLAY_TICKS);
    expect(inputLogsEqual(recorded, script)).toBe(true);
    expect(() => attachInputLog(world, createInputLog(1))).toThrow(/at shift start/);
  });
});

describe('RLE + base64 encoding', () => {
  it('reproduces a random 3,600-tick input log exactly (encode → decode → encode)', () => {
    for (const seed of [1, 2, 0xdecade]) {
      const log = randomLog(seed, REPLAY_TICKS);
      const text = encodeInputs(log);
      const decoded = decodeInputs(text, REPLAY_TICKS);
      expect(decoded.length).toBe(REPLAY_TICKS);
      expect(inputLogsEqual(decoded, log)).toBe(true);
      expect(Array.from(decoded.steer)).toEqual(Array.from(log.steer));
      expect(encodeInputs(decoded)).toBe(text);
    }
  });

  it('stores only changes: a neutral log is empty, a held frame is one entry', () => {
    expect(encodeInputs(createInputLogOfNeutral(600))).toBe('');
    expect(inputLogsEqual(decodeInputs('', 600), createInputLogOfNeutral(600))).toBe(true);
    const held = logOf([
      [0, 0, 0, 0, 0],
      [200, 0, -5, 1, 0],
      [200, 0, -5, 1, 0],
      [200, 0, -5, 1, PRESSED.BRUSH],
      [200, 0, -5, 1, 0],
    ]);
    // [tickDelta, throttle, brake, steer (int8), buttons, pressed] per change.
    expect(Array.from(encodeInputBytes(held))).toEqual([
      1, 200, 0, 251, 1, 0, 2, 200, 0, 251, 1, 1, 1, 200, 0, 251, 1, 0,
    ]);
    expect(inputLogsEqual(decodeInputBytes(encodeInputBytes(held), 5), held)).toBe(true);
    // A change on tick 0 has tickDelta 0.
    expect(Array.from(encodeInputBytes(logOf([[1, 0, 0, 0, 0]])))).toEqual([0, 1, 0, 0, 0, 0]);
  });

  it('is strict when decoding', () => {
    const bytes = (b: number[]): string => encodeBase64(Uint8Array.from(b));
    expect(() => decodeInputs(bytes([0, 1, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0]), 10)).toThrow(/tickDelta 0/);
    expect(() => decodeInputs(bytes([10, 1, 0, 0, 0, 0]), 10)).toThrow(/past the replay's 10 ticks/);
    expect(() => decodeInputs(bytes([0, 1, 0]), 10)).toThrow(/middle of an entry/);
    expect(() => decodeInputs(bytes([3, 0, 0, 0, 0, 0]), 10)).toThrow(/does not change the input/);
    expect(() => decodeInputs(bytes([0, 0, 0, 128, 0, 0]), 10)).toThrow(/steer -128/);
    expect(() => decodeInputs(bytes([0, 0, 0, 0, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01, 0]), 10)).toThrow(
      /varint/,
    );
    expect(() => decodeInputs('@@@@', 10)).toThrow(/base64/);
  });
});

function createInputLogOfNeutral(ticks: number): InputLog {
  const log = createInputLog(ticks);
  const frame = createInputFrame();
  for (let t = 0; t < ticks; t++) appendInput(log, t, frame);
  return log;
}

describe('quantisation (1e-4)', () => {
  it('puts 1.00004 and 1.00006 in different quanta, 1.00004 and 1.000041 in the same', () => {
    expect(quantise(1.00004)).not.toBe(quantise(1.00006));
    expect(quantise(1.00004)).toBe(quantise(1.000041));
    expect(quantise(1.00004)).toBe(10000);
    expect(quantise(1.00006)).toBe(10001);
  });

  it('writes Math.round(v * 1e4) as an Int32: −0 and NaN hash as 0, Int32 wrap beyond ±214,748 m', () => {
    expect(Object.is(quantise(-0.00001), 0)).toBe(true);
    expect(quantise(Number.NaN)).toBe(0);
    expect(quantise(-1.00004)).toBe(-10000);
    expect(quantise(-1.00006)).toBe(-10001);
    expect(quantise(-12.3456)).toBe(-123456);
    expect(quantise(214748.3648)).toBe(-2147483648);
  });
});

describe('state hash', () => {
  it('is FNV-1a 32-bit (known answers) over little-endian Int32s, printed as 8 lowercase hex chars', () => {
    const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));
    expect(fnv1a32Bytes([])).toBe(0x811c9dc5);
    expect(fnv1a32Bytes(ascii('a'))).toBe(0xe40c292c);
    expect(fnv1a32Bytes(ascii('foobar'))).toBe(0xbf9cf968);
    expect(fnv1a32Int32s([0x64636261])).toBe(fnv1a32Bytes(ascii('abcd')));
    expect(fnv1a32Int32s([-1])).toBe(fnv1a32Bytes([255, 255, 255, 255]));
    expect(hashHex(0x0000beef)).toBe('0000beef');
    expect(hashHex(0xffffffff)).toBe('ffffffff');
  });

  function handSetWorld(): World {
    const level = createBlankLevel('test.hash', 4, 4);
    level.player = { x: 3.25, y: 4.5, heading: 0.75 };
    // One frontage over two tiles, so the Tidy's per-frontage fields are in the stream (SSP-065).
    level.frontages = [
      {
        id: 'frontage.hash',
        pledge: true,
        rect: [0, 0, 2, 1],
        face: 'n',
        cells: [
          [0, 0],
          [1, 0],
        ],
      },
    ];
    // A zebra, so the SSP-081 occupancy words are in the stream.
    level.sites = [{ id: 'site.zebra', rect: [2, 0, 3, 4] }];
    const world = createWorld(level, 1234, DEFAULT_TUNING);
    world.tick = 7;
    Object.assign(world.input, { throttle: 200, brake: 0, steer: -40, buttons: 1, pressed: 2 });
    world.vehicle.vLongMps = 4.56789;
    world.vehicle.steerRad = -0.123;
    world.events.sealed = false;
    pushEvent(world.events, EV.KerbJolt, -1, 3.5, 4.25, 4.56789);
    addHazard(world.hazards, 2, 1, 1, 2, 3); // haz.pothole over tiles (1, 1)–(1, 2)
    world.hazards.flags[0] = 1;
    addLitter(world.litter, 3, 5.125, 2.75, 2);
    addStain(world.stains, 1, 2.5, 6.25);
    world.dirt.mask[100] = 70;
    // An NPC and a queued stimulus, so the SSP-080 NPC section has a record of each (SSP-080).
    const n = addNpcAt(world.npc, 2, NpcOrigin.Ambient, 1.25, 2.5);
    world.npc.radius[n] = 0.3;
    world.npc.heading[n] = 0.5;
    world.npc.seenDistM[n] = 3.125;
    // Its steering columns and a two-node path segment (SSP-081).
    world.npc.walkMps[n] = 1.3;
    world.npc.goalNode[n] = 3;
    world.npc.pathLen[n] = 2;
    world.npc.pathAt[n] = 1;
    world.npc.path[n * NPC_PATH_NODES] = 5;
    world.npc.path[n * NPC_PATH_NODES + 1] = 3;
    world.npc.crossEdge[n] = 7;
    world.npc.navState[n] = 3;
    world.npc.navTicks[n] = 9;
    // Its reaction columns and a running hi-vis with one hit and two bumps (SSP-082).
    world.npc.contactIgnore[n] = 42;
    world.npc.stateLimit[n] = 30;
    // Its behaviour timers (SSP-083).
    world.npc.timerA[n] = 600;
    world.npc.timerB[n] = 17;
    // A splashed NPC in a running puddle crossing, and broken glass smashed and swept (SSP-094).
    world.npc.splashEpisode[n] = 2;
    world.npcAi.splash.wet = true;
    world.npcAi.splash.episode = 2;
    world.npcAi.splash.splashes = 4;
    world.npcAi.splash.crossingSplashes = 3;
    world.npcAi.splash.complaints = 1;
    world.hazards.glassSmashed = 2;
    world.hazards.glassSwept = 1;
    world.npcAi.reactions.hiVisUntilTick = 700;
    world.npcAi.reactions.hits = 1;
    world.npcAi.reactions.bumps = 2;
    world.zebras.occupancy[0] = 1;
    const k = pushStimulus(world.npcAi.stimuli, Stimulus.Horn, NO_NPC_HANDLE);
    world.npcAi.stimuli.x[k] = 3.25;
    world.npcAi.stimuli.y[k] = 4.5;
    world.npcAi.stimuli.radiusM[k] = 8;
    // Two complaints and one honk in the horn-spam window, so the complaints section's ring is in the stream
    // (SSP-078).
    world.complaints.count = 2;
    world.complaints.honks = 1;
    world.complaints.honkTicks[0] = 3;
    world.complaints.honkCount = 1;
    // A knocked, sliding, spinning cone, so the SSP-092 bodies section has a record (SSP-092).
    const b = addBody(world.bodies, 1, 5.5, 3.25, 0.25);
    world.bodies.flags[b] = 3;
    world.bodies.rearmTicks[b] = 12;
    world.bodies.vx[b] = 1.5;
    world.bodies.vy[b] = -0.75;
    world.bodies.omega[b] = 2.125;
    world.bodies.knocks = 1;
    world.bodies.bodiesKnocked = 1;
    // A vehicle with a two-edge plan, held by Bessie mid-block, so the SSP-089 traffic section has a record.
    const v = addVehicle(world.vehicles, 1, 0);
    world.vehicles.x[v] = 2.125;
    world.vehicles.y[v] = 6.75;
    world.vehicles.heading[v] = 1.5;
    world.vehicles.speed[v] = 0.25;
    world.vehicles.along[v] = 0.625;
    world.vehicles.planLen[v] = 2;
    world.vehicles.plan[v * VEHICLE_PLAN_EDGES] = 4;
    world.vehicles.plan[v * VEHICLE_PLAN_EDGES + 1] = 9;
    world.vehicles.blocker[v] = 1;
    world.vehicles.gapM[v] = 2.5;
    world.vehicles.blockTicks[v] = 200;
    world.vehicles.honks[v] = 1;
    world.traffic.carHorns = 1;
    return world;
  }

  function hashOf(world: World): number {
    const hasher = createStateHasher(world.seed);
    absorbTick(hasher, world);
    return stateHash(hasher);
  }

  it('absorbs the traffic state (SSP-089): the vehicle columns, its plan and the traffic counters', () => {
    const base = hashOf(handSetWorld());
    const edits: [string, (w: World) => void][] = [
      ['x', (w) => (w.vehicles.x[0] = 2.25)],
      ['heading', (w) => (w.vehicles.heading[0] = 1.25)],
      ['speed', (w) => (w.vehicles.speed[0] = 0.5)],
      ['along', (w) => (w.vehicles.along[0] = 0.75)],
      ['state', (w) => (w.vehicles.state[0] = 2)],
      ['plan[1]', (w) => (w.vehicles.plan[1] = 10)],
      ['planLen', (w) => (w.vehicles.planLen[0] = 1)],
      ['blocker', (w) => (w.vehicles.blocker[0] = 2)],
      ['blockTicks', (w) => (w.vehicles.blockTicks[0] = 201)],
      ['rageFiled', (w) => (w.vehicles.rageFiled[0] = 1)],
      ['dwellLeft', (w) => (w.vehicles.dwellLeft[0] = 3)],
      ['carHorns', (w) => (w.traffic.carHorns = 2)],
      ['busesDue', (w) => (w.traffic.busesDue = 1)],
      ['traffic.rng', (w) => (w.traffic.rng.counter += 1)],
    ];
    for (const [name, edit] of edits) {
      const w = handSetWorld();
      edit(w);
      expect(hashOf(w), name).not.toBe(base);
    }
    // The corners are derived from the pose and not hashed.
    const derived = handSetWorld();
    derived.vehicles.corners[0] = 99;
    expect(hashOf(derived)).toBe(base);
  });

  it('absorbs the steering state (SSP-081): every column, the held path nodes and the zebra occupancy', () => {
    const base = hashOf(handSetWorld());
    const edits: [string, (w: World) => void][] = [
      ['walkMps', (w) => (w.npc.walkMps[0] = 1.4)],
      ['goalNode', (w) => (w.npc.goalNode[0] = 4)],
      ['pathLen', (w) => (w.npc.pathLen[0] = 1)],
      ['pathAt', (w) => (w.npc.pathAt[0] = 0)],
      ['path[1]', (w) => (w.npc.path[1] = 6)],
      ['crossEdge', (w) => (w.npc.crossEdge[0] = -1)],
      ['navState', (w) => (w.npc.navState[0] = 1)],
      ['navTicks', (w) => (w.npc.navTicks[0] = 10)],
      ['zebras.occupancy', (w) => (w.zebras.occupancy[0] = 0)],
    ];
    for (const [name, edit] of edits) {
      const w = handSetWorld();
      edit(w);
      expect(hashOf(w), name).not.toBe(base);
    }
    // A node past pathLen is not held, so it is not hashed.
    const w = handSetWorld();
    w.npc.path[2] = 9;
    expect(hashOf(w)).toBe(base);
  });

  it('absorbs the reaction state (SSP-082): the per-NPC contact window, state limit and (SSP-083) behaviour timers, and the shared rules', () => {
    const base = hashOf(handSetWorld());
    const edits: [string, (w: World) => void][] = [
      ['contactIgnore', (w) => (w.npc.contactIgnore[0] = 41)],
      ['stateLimit', (w) => (w.npc.stateLimit[0] = 54)],
      ['timerA', (w) => (w.npc.timerA[0] = 599)],
      ['timerB', (w) => (w.npc.timerB[0] = 16)],
      ['awarenessRadiusM', (w) => (w.npcAi.reactions.awarenessRadiusM = 10)],
      ['ledBeacon', (w) => (w.npcAi.reactions.ledBeacon = true)],
      ['minClosingSpeedMps', (w) => (w.npcAi.reactions.minClosingSpeedMps = 1.5)],
      ['ignoreTicks', (w) => (w.npcAi.reactions.ignoreTicks = 91)],
      ['hiVisUntilTick', (w) => (w.npcAi.reactions.hiVisUntilTick = 701)],
      ['hits', (w) => (w.npcAi.reactions.hits = 2)],
      ['bumps', (w) => (w.npcAi.reactions.bumps = 3)],
    ];
    for (const [name, edit] of edits) {
      const w = handSetWorld();
      edit(w);
      expect(hashOf(w), name).not.toBe(base);
    }
  });

  it('absorbs broken glass and the puddle splashes (SSP-094): the counters, the crossing and each NPC’s', () => {
    const base = hashOf(handSetWorld());
    const edits: [string, (w: World) => void][] = [
      ['splashEpisode', (w) => (w.npc.splashEpisode[0] = 1)],
      ['splash.wet', (w) => (w.npcAi.splash.wet = false)],
      ['splash.episode', (w) => (w.npcAi.splash.episode = 3)],
      ['splash.splashes', (w) => (w.npcAi.splash.splashes = 5)],
      ['splash.crossingSplashes', (w) => (w.npcAi.splash.crossingSplashes = 4)],
      ['splash.complaints', (w) => (w.npcAi.splash.complaints = 2)],
      ['hazards.glassSmashed', (w) => (w.hazards.glassSmashed = 3)],
      ['hazards.glassSwept', (w) => (w.hazards.glassSwept = 2)],
    ];
    for (const [name, edit] of edits) {
      const w = handSetWorld();
      edit(w);
      expect(hashOf(w), name).not.toBe(base);
    }
  });

  it('keeps its canonical byte layout (golden value for a hand-set World)', () => {
    // Changing the field order, the quantum or the header changes this value: that is a replay format change
    // (bump REPLAY_VERSION and re-record every replay).
    expect(hashHex(hashOf(handSetWorld()))).toBe(GOLDEN_HAND_SET_HASH);
  });

  it('covers every VehicleState field, the input, the tick, the events and the hazard and litter stores', () => {
    const base = hashOf(handSetWorld());
    const vehicleKeys = Object.keys(handSetWorld().vehicle) as (keyof VehicleState)[];
    expect(vehicleKeys.length).toBe(20);
    for (const key of vehicleKeys) {
      const world = handSetWorld();
      const v = world.vehicle as Record<keyof VehicleState, number | boolean>;
      const value = v[key];
      // Integer fields move by 1, floats by 10 quanta.
      const integer = key === 'gear' || key === 'reverseHoldTicks';
      v[key] = typeof value === 'boolean' ? !value : (value as number) + (integer ? 1 : 0.001);
      expect(hashOf(world), `vehicle.${key}`).not.toBe(base);
    }
    for (const key of ['throttle', 'brake', 'steer', 'buttons', 'pressed'] as const) {
      const world = handSetWorld();
      world.input[key] += 1;
      expect(hashOf(world), `input.${key}`).not.toBe(base);
    }
    const ticked = handSetWorld();
    ticked.tick += 1;
    expect(hashOf(ticked)).not.toBe(base);
    const moreEvents = handSetWorld();
    pushEvent(moreEvents.events, EV.ReverseBeeper, -1, 0, 0, 0);
    expect(hashOf(moreEvents)).not.toBe(base);
    const movedEvent = handSetWorld();
    movedEvent.events.c[0] = 4.5;
    expect(hashOf(movedEvent)).not.toBe(base);
    const hazardMutations: ((w: World) => void)[] = [
      (w) => addHazard(w.hazards, 0, 0, 0, 1, 1),
      (w) => {
        w.hazards.kind[0] = 1;
      },
      (w) => {
        w.hazards.col0[0] = 0;
      },
      (w) => {
        w.hazards.row0[0] = 0;
      },
      (w) => {
        w.hazards.col1[0] = 3;
      },
      (w) => {
        w.hazards.row1[0] = 4;
      },
      (w) => {
        w.hazards.flags[0] = 0;
      },
      (w) => {
        w.hazards.hazardsSpawned += 1;
      },
    ];
    const litterMutations: ((w: World) => void)[] = [
      (w) => addLitter(w.litter, 0, 1, 1, 0),
      (w) => {
        w.litter.x[0] = 5.126;
      },
      (w) => {
        w.litter.y[0] = 2.751;
      },
      (w) => {
        w.litter.kind[0] = 4;
      },
      (w) => {
        w.litter.flags[0] = 1;
      },
      (w) => {
        w.litter.rot[0] = 3;
      },
      (w) => {
        w.litter.litterSpawned += 1;
      },
      (w) => {
        w.litter.litterCollected += 1;
      },
    ];
    for (const [i, mutate] of [...hazardMutations, ...litterMutations].entries()) {
      const world = handSetWorld();
      mutate(world);
      expect(hashOf(world), `store mutation ${i}`).not.toBe(base);
    }
    const otherSeed = handSetWorld();
    const hasher = createStateHasher(1235);
    absorbTick(hasher, otherSeed);
    expect(stateHash(hasher)).not.toBe(base);
  });

  it('covers the M2 state: litter, brush, hopper, water, stains, grime, scoring, Tidy and shift (SSP-065)', () => {
    const base = hashOf(handSetWorld());
    const mutations: [string, (w: World) => void][] = [
      // The rest of the litter store.
      [
        'litter.prevX',
        (w) => {
          w.litter.prevX[0] = 5.126;
        },
      ],
      [
        'litter.prevY',
        (w) => {
          w.litter.prevY[0] = 2.751;
        },
      ],
      [
        'litter.vx',
        (w) => {
          w.litter.vx[0] = 0.001;
        },
      ],
      [
        'litter.vy',
        (w) => {
          w.litter.vy[0] = -0.001;
        },
      ],
      [
        'litter.arcT',
        (w) => {
          w.litter.arcT[0] = 1;
        },
      ],
      [
        'litter.arcDur',
        (w) => {
          w.litter.arcDur[0] = 30;
        },
      ],
      [
        'litter.arcX0',
        (w) => {
          w.litter.arcX0[0] = 5.126;
        },
      ],
      [
        'litter.arcY0',
        (w) => {
          w.litter.arcY0[0] = 2.751;
        },
      ],
      [
        'litter.arcX1',
        (w) => {
          w.litter.arcX1[0] = 5.126;
        },
      ],
      [
        'litter.arcY1',
        (w) => {
          w.litter.arcY1[0] = 2.751;
        },
      ],
      [
        'litter.driftTicks',
        (w) => {
          w.litter.driftTicks[0] = 1;
        },
      ],
      [
        'litter.spawnTile',
        (w) => {
          w.litter.spawnTile[0] = 0;
        },
      ],
      // Brush and the RNG streams.
      [
        'brush.state',
        (w) => {
          w.brush.state = 1;
        },
      ],
      [
        'brush.posTicks',
        (w) => {
          w.brush.posTicks = 1;
        },
      ],
      [
        'brush.rpmTicks',
        (w) => {
          w.brush.rpmTicks = 0.5;
        },
      ],
      [
        'brush.suctionMult',
        (w) => {
          w.brush.suctionMult = 1.25;
        },
      ],
      [
        'brush.flingThresholdMps',
        (w) => {
          w.brush.flingThresholdMps = 6;
        },
      ],
      [
        'brush.anyFlagged',
        (w) => {
          w.brush.anyFlagged = true;
        },
      ],
      ['brush.rng', (w) => void nextU32(w.brush.rng)],
      ['eventsRng', (w) => void nextU32(w.eventsRng)],
      // Hopper.
      [
        'hopper.full',
        (w) => {
          w.hopper.full = true;
        },
      ],
      [
        'hopper.luDumpedTotal',
        (w) => {
          w.hopper.luDumpedTotal = 0.5;
        },
      ],
      [
        'hopper.luDumpedDepot',
        (w) => {
          w.hopper.luDumpedDepot = 0.5;
        },
      ],
      [
        'hopper.drainSite',
        (w) => {
          w.hopper.drainSite = 1;
        },
      ],
      [
        'hopper.drainStartLU',
        (w) => {
          w.hopper.drainStartLU = 10;
        },
      ],
      [
        'hopper.drainTicks',
        (w) => {
          w.hopper.drainTicks = 120;
        },
      ],
      [
        'hopper.drainTicksDone',
        (w) => {
          w.hopper.drainTicksDone = 1;
        },
      ],
      [
        'hopper.drainScheduledLU',
        (w) => {
          w.hopper.drainScheduledLU = 0.25;
        },
      ],
      // Water.
      [
        'water.sprayHeld',
        (w) => {
          w.water.sprayHeld = true;
        },
      ],
      [
        'water.spraying',
        (w) => {
          w.water.spraying = true;
        },
      ],
      [
        'water.refilling',
        (w) => {
          w.water.refilling = true;
        },
      ],
      [
        'water.coneApexX',
        (w) => {
          w.water.coneApexX = 1.5;
        },
      ],
      [
        'water.coneApexY',
        (w) => {
          w.water.coneApexY = 1.5;
        },
      ],
      // Stains.
      ['stains: one more', (w) => void addStain(w.stains, 0, 1, 1)],
      [
        'stains.x',
        (w) => {
          w.stains.x[0] = 2.501;
        },
      ],
      [
        'stains.y',
        (w) => {
          w.stains.y[0] = 6.251;
        },
      ],
      [
        'stains.kind',
        (w) => {
          w.stains.kind[0] = 2;
        },
      ],
      [
        'stains.cleanTicks',
        (w) => {
          w.stains.cleanTicks[0] = 1;
        },
      ],
      [
        'stains.stainsSpawned',
        (w) => {
          w.stains.stainsSpawned += 1;
        },
      ],
      [
        'stains.stainsCleaned',
        (w) => {
          w.stains.stainsCleaned += 1;
        },
      ],
      // Grime counters, the dirty rectangle and the mask.
      [
        'dirt.initialCells',
        (w) => {
          w.dirt.initialCells += 1;
        },
      ],
      [
        'dirt.initialGutterCells',
        (w) => {
          w.dirt.initialGutterCells += 1;
        },
      ],
      [
        'dirt.cleanedCells',
        (w) => {
          w.dirt.cleanedCells += 1;
        },
      ],
      [
        'dirt.cleanedGutterCells',
        (w) => {
          w.dirt.cleanedGutterCells += 1;
        },
      ],
      [
        'dirt.tickCleanedCells',
        (w) => {
          w.dirt.tickCleanedCells += 1;
        },
      ],
      [
        'dirt.tickCleanedGutterCells',
        (w) => {
          w.dirt.tickCleanedGutterCells += 1;
        },
      ],
      [
        'dirt.kerbContact',
        (w) => {
          w.dirt.kerbContact = true;
        },
      ],
      [
        'dirt.kerbContactLeft',
        (w) => {
          w.dirt.kerbContactLeft = true;
        },
      ],
      [
        'dirt.kerbContactRight',
        (w) => {
          w.dirt.kerbContactRight = true;
        },
      ],
      [
        'dirt.dirtyMinX',
        (w) => {
          w.dirt.dirtyMinX = 3;
        },
      ],
      [
        'dirt.dirtyMinY',
        (w) => {
          w.dirt.dirtyMinY = 3;
        },
      ],
      [
        'dirt.dirtyMaxX',
        (w) => {
          w.dirt.dirtyMaxX = 3;
        },
      ],
      [
        'dirt.dirtyMaxY',
        (w) => {
          w.dirt.dirtyMaxY = 3;
        },
      ],
      [
        'dirt.mask (a cell outside any dirty rect)',
        (w) => {
          w.dirt.mask[1000] = 1;
        },
      ],
      // Scoring and combo.
      [
        'scoring.score',
        (w) => {
          w.scoring.score += 1;
        },
      ],
      [
        'scoring.itemPts',
        (w) => {
          w.scoring.itemPts += 1;
        },
      ],
      [
        'scoring.stainPts',
        (w) => {
          w.scoring.stainPts += 1;
        },
      ],
      [
        'scoring.grimePts',
        (w) => {
          w.scoring.grimePts += 1;
        },
      ],
      [
        'scoring.bonusPts',
        (w) => {
          w.scoring.bonusPts += 1;
        },
      ],
      [
        'scoring.penaltyPts',
        (w) => {
          w.scoring.penaltyPts -= 1;
        },
      ],
      [
        'scoring.kerbContactTicks',
        (w) => {
          w.scoring.kerbContactTicks += 1;
        },
      ],
      [
        'scoring.kerbHuggerAwards',
        (w) => {
          w.scoring.kerbHuggerAwards += 1;
        },
      ],
      [
        'scoring.pendingPenalties',
        (w) => {
          w.scoring.pendingPenalties += 1;
        },
      ],
      [
        'scoring.pendingPenaltyPts',
        (w) => {
          w.scoring.pendingPenaltyPts -= 20;
        },
      ],
      [
        'combo.chain',
        (w) => {
          w.scoring.combo.chain += 1;
        },
      ],
      [
        'combo.multiplier',
        (w) => {
          w.scoring.combo.multiplier += 1;
        },
      ],
      [
        'combo.timerTicks',
        (w) => {
          w.scoring.combo.timerTicks += 1;
        },
      ],
      [
        'combo.bestChain',
        (w) => {
          w.scoring.combo.bestChain += 1;
        },
      ],
      [
        'combo.refreshTicks',
        (w) => {
          w.scoring.combo.refreshTicks += 1;
        },
      ],
      // Tidy and the frontage tally.
      [
        'tidy.tidyPpm',
        (w) => {
          w.tidy.tidyPpm += 1;
        },
      ],
      [
        'tidy.stars',
        (w) => {
          w.tidy.stars += 1;
        },
      ],
      [
        'tidy.cleanSweeps',
        (w) => {
          w.tidy.cleanSweeps += 1;
        },
      ],
      [
        'tidy.pledgesMet',
        (w) => {
          w.tidy.pledgesMet += 1;
        },
      ],
      [
        'tidy.frontageCleanPpm',
        (w) => {
          w.tidy.frontageCleanPpm[0] = 1;
        },
      ],
      [
        'tidy.cleanSwept',
        (w) => {
          w.tidy.cleanSwept[0] = 1;
        },
      ],
      [
        'tidy.pledgeMet',
        (w) => {
          w.tidy.pledgeMet[0] = 1 - (w.tidy.pledgeMet[0] as number);
        },
      ],
      [
        'zones.grimeInitial',
        (w) => {
          w.tidy.zones.grimeInitial[0] = 9;
        },
      ],
      [
        'zones.grimeCleaned',
        (w) => {
          w.tidy.zones.grimeCleaned[0] = 9;
        },
      ],
      [
        'zones.litterSpawned',
        (w) => {
          w.tidy.zones.litterSpawned[0] = 9;
        },
      ],
      [
        'zones.litterCollected',
        (w) => {
          w.tidy.zones.litterCollected[0] = 9;
        },
      ],
      // Shift.
      [
        'shift.phase',
        (w) => {
          w.shift.phase = 1;
        },
      ],
      [
        'shift.ticksRun',
        (w) => {
          w.shift.ticksRun += 1;
        },
      ],
      [
        'shift.timerStartTick',
        (w) => {
          w.shift.timerStartTick = 3;
        },
      ],
      [
        'shift.ticksRemaining',
        (w) => {
          w.shift.ticksRemaining -= 1;
        },
      ],
      [
        'shift.knockOffTick',
        (w) => {
          w.shift.knockOffTick = 3;
        },
      ],
      [
        'shift.endReason',
        (w) => {
          w.shift.endReason = 2;
        },
      ],
      [
        'shift.endTick',
        (w) => {
          w.shift.endTick = 3;
        },
      ],
      [
        'shift.dumpState',
        (w) => {
          w.shift.dumpState = 1;
        },
      ],
      [
        'shift.dumpSite',
        (w) => {
          w.shift.dumpSite = 0;
        },
      ],
      [
        'shift.holdTicks',
        (w) => {
          w.shift.holdTicks = 1;
        },
      ],
      [
        'shift.drainLuDumpedAtStart',
        (w) => {
          w.shift.drainLuDumpedAtStart = 0.5;
        },
      ],
      [
        'shift.dumpNeedsRelease',
        (w) => {
          w.shift.dumpNeedsRelease = true;
        },
      ],
      [
        'shift.dumpsCompleted',
        (w) => {
          w.shift.dumpsCompleted += 1;
        },
      ],
    ];
    for (const [name, mutate] of mutations) {
      const world = handSetWorld();
      mutate(world);
      expect(hashOf(world), name).not.toBe(base);
    }
  });

  it('covers the NPC state: the store, its handles, the npc stream, the stimuli and the spawner (SSP-080)', () => {
    const base = hashOf(handSetWorld());
    const f64 = [
      'x',
      'y',
      'prevX',
      'prevY',
      'heading',
      'speed',
      'radius',
      'seenDistM',
      'pathGapM',
      'pathEtaS',
    ];
    const ints = ['kind', 'state', 'stateTicks', 'targetNode', 'swap', 'flags', 'origin', 'group', 'link'];
    const mutations: [string, (w: World) => void][] = [
      ...f64.map((key): [string, (w: World) => void] => [
        `npc.${key}`,
        (w) => {
          const col = (w.npc as unknown as Record<string, Float64Array>)[key] as Float64Array;
          col[0] = (col[0] as number) + 0.001;
        },
      ]),
      ...ints.map((key): [string, (w: World) => void] => [
        `npc.${key}`,
        (w) => {
          const col = (w.npc as unknown as Record<string, Int32Array>)[key] as Int32Array;
          col[0] = (col[0] as number) + 1;
        },
      ]),
      [
        'npc.perceivedTick',
        (w) => {
          w.npc.perceivedTick[0] = 3;
        },
      ],
      ['npc.count', (w) => addNpcAt(w.npc, 0, NpcOrigin.Ambient, 1, 1)],
      [
        'npc removal (generations, free slots)',
        (w) => {
          removeNpc(w.npc, 0);
          addNpcAt(w.npc, 2, NpcOrigin.Ambient, 1.25, 2.5);
          w.npc.radius[0] = 0.3;
          w.npc.heading[0] = 0.5;
          w.npc.seenDistM[0] = 3.125;
          w.npc.perceivedTick[0] = -1;
          w.npc.npcsAdded -= 1;
          w.npc.npcsRemoved -= 1;
        },
      ],
      [
        'npc.npcsAdded',
        (w) => {
          w.npc.npcsAdded += 1;
        },
      ],
      [
        'npc.npcsRemoved',
        (w) => {
          w.npc.npcsRemoved += 1;
        },
      ],
      [
        'npcAi.rng',
        (w) => {
          nextU32(w.npcAi.rng);
        },
      ],
      ['stimuli.count', (w) => pushStimulus(w.npcAi.stimuli, Stimulus.Hit, 0)],
      [
        'stimuli.type',
        (w) => {
          w.npcAi.stimuli.type[0] = Stimulus.Spray;
        },
      ],
      [
        'stimuli.target',
        (w) => {
          w.npcAi.stimuli.target[0] = 0;
        },
      ],
      [
        'stimuli.x',
        (w) => {
          w.npcAi.stimuli.x[0] = 3.251;
        },
      ],
      [
        'stimuli.y',
        (w) => {
          w.npcAi.stimuli.y[0] = 4.501;
        },
      ],
      [
        'stimuli.radiusM',
        (w) => {
          w.npcAi.stimuli.radiusM[0] = 12;
        },
      ],
      [
        'stimuli.delivered',
        (w) => {
          w.npcAi.stimuli.delivered += 1;
        },
      ],
      ...(['perchPending', 'flocksPlaced', 'ambientSpawned', 'ambientRetired', 'ambientCount'] as const).map(
        (key): [string, (w: World) => void] => [
          `spawner.${key}`,
          (w) => {
            w.npcAi.spawner[key] += 1;
          },
        ],
      ),
    ];
    for (const [name, mutate] of mutations) {
      const world = handSetWorld();
      mutate(world);
      expect(hashOf(world), name).not.toBe(base);
    }
  });

  it('covers the M3 complaints meter, the horn window and the penalty log (SSP-078)', () => {
    const base = hashOf(handSetWorld());
    const mutations: [string, (w: World) => void][] = [
      [
        'complaints.count',
        (w) => {
          w.complaints.count += 1;
        },
      ],
      [
        'complaints.max',
        (w) => {
          w.complaints.max += 1;
        },
      ],
      [
        'complaints.twoToneHorn',
        (w) => {
          w.complaints.twoToneHorn = true;
        },
      ],
      [
        'complaints.hornRadiusM',
        (w) => {
          w.complaints.hornRadiusM += 0.001;
        },
      ],
      [
        'complaints.maxHonks',
        (w) => {
          w.complaints.maxHonks += 1;
        },
      ],
      [
        'complaints.windowTicks',
        (w) => {
          w.complaints.windowTicks += 1;
        },
      ],
      [
        'complaints.noiseComplaints',
        (w) => {
          w.complaints.noiseComplaints += 1;
        },
      ],
      [
        'complaints.hornThisTick',
        (w) => {
          w.complaints.hornThisTick = true;
        },
      ],
      [
        'complaints.hornCaught',
        (w) => {
          w.complaints.hornCaught = true;
        },
      ],
      [
        'complaints.honks',
        (w) => {
          w.complaints.honks += 1;
        },
      ],
      [
        'complaints.honksCaught',
        (w) => {
          w.complaints.honksCaught += 1;
        },
      ],
      [
        'complaints.noiseOffences',
        (w) => {
          w.complaints.noiseOffences += 1;
        },
      ],
      [
        'complaints.honkCount',
        (w) => {
          w.complaints.honkCount += 1;
        },
      ],
      [
        'complaints.honkTicks (in the window)',
        (w) => {
          w.complaints.honkTicks[0] = 4;
        },
      ],
      [
        'penalties.count',
        (w) => {
          w.penalties.count += 1;
        },
      ],
      [
        'penalties.applied',
        (w) => {
          w.penalties.applied += 1;
        },
      ],
    ];
    for (const [name, mutate] of mutations) {
      const world = handSetWorld();
      mutate(world);
      expect(hashOf(world), name).not.toBe(base);
    }
    // A honk tick outside the window (beyond honkCount) is not state: it never changes the hash.
    const stale = handSetWorld();
    stale.complaints.honkTicks[3] = 99;
    expect(hashOf(stale)).toBe(base);
  });

  it('covers the knockable bodies (SSP-092)', () => {
    const base = hashOf(handSetWorld());
    const mutations: [string, (w: World) => void][] = [
      [
        'bodies.count (a second body)',
        (w) => {
          addBody(w.bodies, 0, 1.5, 1.5, 0);
        },
      ],
      [
        'bodies.knocks',
        (w) => {
          w.bodies.knocks += 1;
        },
      ],
      [
        'bodies.bodiesKnocked',
        (w) => {
          w.bodies.bodiesKnocked += 1;
        },
      ],
      [
        'bodies.itemsSpilled',
        (w) => {
          w.bodies.itemsSpilled += 1;
        },
      ],
      [
        'bodies.penaltyPts',
        (w) => {
          w.bodies.penaltyPts -= 25;
        },
      ],
    ];
    const columns = [
      'kind',
      'flags',
      'rearmTicks',
      'x',
      'y',
      'heading',
      'prevX',
      'prevY',
      'prevHeading',
      'vx',
      'vy',
      'omega',
    ] as const;
    for (const column of columns) {
      mutations.push([
        `bodies.${column}[0]`,
        (w) => {
          const arr = w.bodies[column];
          const integer = column === 'kind' || column === 'flags' || column === 'rearmTicks';
          arr[0] = (arr[0] as number) + (integer ? 1 : 0.001);
        },
      ]);
    }
    for (const [name, mutate] of mutations) {
      const world = handSetWorld();
      mutate(world);
      expect(hashOf(world), name).not.toBe(base);
    }
    // This tick's pushes are scratch, zero between ticks: not hashed.
    const scratch = handSetWorld();
    scratch.bodies.pushX[0] = 0.5;
    expect(hashOf(scratch)).toBe(base);
  });

  it('absorbs the whole grime mask once per hasher, then the dirty rectangle every tick', () => {
    const world = handSetWorld();
    // An empty dirty rectangle: only the first absorb sees a change outside it.
    world.dirt.dirtyMinX = world.dirt.maskW;
    world.dirt.dirtyMaxX = -1;
    const once = (w: World): { first: number; second: number } => {
      const hasher = createStateHasher(w.seed);
      absorbTick(hasher, w);
      const first = stateHash(hasher);
      absorbTick(hasher, w);
      return { first, second: stateHash(hasher) };
    };
    const a = once(world);
    world.dirt.mask[1000] = 9;
    const b = once(world);
    expect(b.first).not.toBe(a.first);
    // Inside the dirty rectangle a change is seen on every tick.
    const inRect = handSetWorld();
    inRect.dirt.dirtyMinX = 0;
    inRect.dirt.dirtyMinY = 0;
    inRect.dirt.dirtyMaxX = 3;
    inRect.dirt.dirtyMaxY = 3;
    const hasher = createStateHasher(inRect.seed);
    absorbTick(hasher, inRect);
    const twin = createStateHasher(inRect.seed);
    absorbTick(twin, inRect);
    inRect.dirt.mask[0] = 5; // cell (0, 0), inside the rect
    absorbTick(hasher, inRect);
    inRect.dirt.mask[0] = 0;
    absorbTick(twin, inRect);
    expect(stateHash(hasher)).not.toBe(stateHash(twin));
  });

  it('ignores differences below the 1e-4 quantum', () => {
    const base = hashOf(handSetWorld());
    const world = handSetWorld();
    world.vehicle.vLongMps += 1e-6; // 4.56789 → 4.567891: same quantum (45679)
    world.events.a[0] = 3.50001;
    expect(hashOf(world)).toBe(base);
  });

  it('is stable: the same replay gives the same checkpoints in one process', () => {
    const level = syntheticLevel();
    const log = syntheticInputLog();
    const a = runReplay(level, DEFAULT_TUNING, 42, log, REPLAY_TICKS);
    const b = runReplay(level, DEFAULT_TUNING, 42, log, REPLAY_TICKS);
    expect(a.checkpoints).toEqual(b.checkpoints);
    expect(Object.keys(a.checkpoints)).toEqual(['600', '1200', '1800', '2400', '3000', '3600']);
    expect(a.finalHash).toBe(a.checkpoints['3600']);
    expect(new Set(Object.values(a.checkpoints)).size).toBe(6);
  });

  it('changes every checkpoint from the tick where one input changes, and none before', () => {
    const level = syntheticLevel();
    const base = runReplay(level, DEFAULT_TUNING, 42, syntheticInputLog(), REPLAY_TICKS).checkpoints;
    for (const [tick, field, delta] of [
      [1000, 'steer', 1],
      [2399, 'throttle', -1],
      [0, 'pressed', PRESSED.HORN], // no effect on the vehicle in M1: the hashed input still diverges
    ] as const) {
      const log = syntheticInputLog();
      log[field][tick] = (log[field][tick] as number) + delta;
      const changed = runReplay(level, DEFAULT_TUNING, 42, log, REPLAY_TICKS).checkpoints;
      for (const cp of checkpointTicks(REPLAY_TICKS)) {
        const key = String(cp);
        if (cp <= tick) expect(changed[key], `${field}@${tick} cp ${key}`).toBe(base[key]);
        else expect(changed[key], `${field}@${tick} cp ${key}`).not.toBe(base[key]);
      }
    }
  });
});

/**
 * Pinned by 'keeps its canonical byte layout'. SSP-093 appended the hazard store and the LitterField to the
 * hashed state (and a hazard and an item to the hand-set World): c80faedc → 648c18d0. SSP-065 appended the
 * rest of the litter store and the M2 state (brush, hopper, water, stains, grime mask, scoring, Tidy, shift),
 * and gave the hand-set World a frontage, a stain and a grime cell: 648c18d0 → ada67916. SSP-080 appended the
 * NPC state (store, handles, npc stream, stimuli, spawner) and gave it an NPC and a Horn: ada67916 → 0449a66a.
 * SSP-078 appended the complaints meter, the horn window and the penalty log, and gave the hand-set World two
 * complaints and a honk in the window: 0449a66a → b25f1a0a (2cab5426 on its branch, before SSP-080 merged).
 * SSP-081 appended the steering columns, the path segment and the zebra occupancy, and gave the NPC a path and
 * the level a zebra: b25f1a0a → 196fee33 (b52f12bf on its branch, before SSP-078 merged).
 * SSP-092 appended the knockable bodies and gave the hand-set World a knocked, sliding, spinning cone:
 * 196fee33 → bd46e7bd (e1d53cac on its branch, before SSP-081 merged).
 * SSP-082 appended the reaction model (the shared rules' state, then each NPC's contact window and state limit)
 * and gave the NPC a contact window and a state limit, and the World a hi-vis, a hit and two bumps: bd46e7bd →
 * b31a23d9 (f20bff33 on its branch, before SSP-092 merged).
 * SSP-089 appended the vehicle store and the traffic state, and gave the hand-set World a vehicle held by Bessie
 * with a two-edge plan: b31a23d9 → 68d953a7 (fc7651f5 on its branch, before SSP-092 and SSP-082 merged).
 * SSP-083 appended each NPC's behaviour timers (timerA, timerB) after its state limit, and gave the NPC both:
 * 68d953a7 → 424363e8 (5ed1888a on its branch, before SSP-089 merged).
 * SSP-094 appended broken glass and the puddle splashes (the hazard store's glassSmashed and glassSwept, the
 * splash crossing and counters, then each NPC's splashEpisode), and gave the hand-set World a splashed NPC in a
 * running crossing and some smashed and swept glass: 424363e8 → 4f2347ac.
 */
const GOLDEN_HAND_SET_HASH = '4f2347ac';

describe('state hash over a sweeping run on Puddle Lane (SSP-065)', () => {
  const level = decodeLevel(
    readFileSync(
      fileURLToPath(new URL('../../public/assets/levels/puddle_lane.json', import.meta.url)),
      'utf8',
    ),
  );

  /** Lower the brush, then drive north up Mangle Street from the depot, spraying every other second. */
  function frameAt(t: number, out: InputFrame): InputFrame {
    out.throttle = t < 30 ? 0 : 200;
    out.brake = 0;
    out.steer = 0;
    out.pressed = t === 0 ? PRESSED.BRUSH : 0;
    out.buttons = ((t / 60) | 0) % 2 === 1 ? BUTTON.SPRAY : 0;
    return out;
  }

  /** Run 600 ticks on seed 1001, calling `between` after each tick (before the hash absorbs the next). */
  function run(between: (world: World, t: number) => void): { hashes: number[]; world: World } {
    const world = createWorld(level, 1001, DEFAULT_TUNING);
    const hasher = createStateHasher(world.seed);
    const frame = createInputFrame();
    const hashes: number[] = [];
    for (let t = 0; t < 600; t++) {
      world.step(frameAt(t, frame));
      between(world, t);
      absorbTick(hasher, world);
      hashes.push(stateHash(hasher));
    }
    return { hashes, world };
  }

  it('gives identical hashes for the same seed and inputs, with litter, grime and scoring all moving', () => {
    const a = run(() => {});
    const b = run(() => {});
    expect(b.hashes).toEqual(a.hashes);
    // The run exercised the M2 state, so the hash covers something.
    expect(a.world.litter.count).toBeGreaterThan(100);
    expect(a.world.dirt.cleanedCells).toBeGreaterThan(0);
    expect(a.world.scoring.score).toBeGreaterThan(0);
    expect(a.world.vehicle.water).toBeLessThan(DEFAULT_TUNING.water.tankUnits);
  });

  it('changes from the tick one litter item is moved by 1e-3 m, and not before', () => {
    const a = run(() => {});
    const far = a.world.litter.count - 1; // an item nowhere near Bessie: only the hash can notice the move
    const moved = run((world, t) => {
      if (t === 299) world.litter.x[far] = (world.litter.x[far] as number) + 1e-3;
    });
    expect(moved.hashes.slice(0, 299)).toEqual(a.hashes.slice(0, 299));
    for (let t = 299; t < 600; t++) expect(moved.hashes[t], `tick ${t}`).not.toBe(a.hashes[t]);
  });
});

describe('checkpoints', () => {
  it('fall every 600 ticks plus the final tick', () => {
    expect(CHECKPOINT_INTERVAL_TICKS).toBe(600);
    expect(checkpointTicks(3600)).toEqual([600, 1200, 1800, 2400, 3000, 3600]);
    expect(checkpointTicks(1000)).toEqual([600, 1000]);
    expect(checkpointTicks(600)).toEqual([600]);
    expect(checkpointTicks(5)).toEqual([5]);
  });

  it('compare to null when equal and name the first divergence otherwise', () => {
    const a = { '600': 'aaaaaaaa', '1200': 'bbbbbbbb', '1800': 'cccccccc' };
    expect(compareCheckpoints(a, { ...a }, 1800)).toBeNull();
    const msg = compareCheckpoints(a, { ...a, '1200': '12345678', '1800': '87654321' }, 1800);
    expect(msg).toBe(
      'first diverging checkpoint at tick 1200 (the runs diverged in ticks 601..1200); 2 of 3 checkpoints differ: ' +
        '1200: expected bbbbbbbb, got 12345678; 1800: expected cccccccc, got 87654321',
    );
    expect(compareCheckpoints(a, { ...a, '600': '00000000' }, 1800)).toMatch(/ticks 1\.\.600/);
    expect(compareCheckpoints({}, a, 1800)).toMatch(/600: expected \(none\), got aaaaaaaa/);
  });
});

describe('replay file', () => {
  const level = syntheticLevel();
  const file = recordReplay(level, DEFAULT_TUNING, 'district.synthetic_town', 99, syntheticInputLog(), {
    hpMin: 100,
    maxSolidOverlapM: 0.001,
    minEvents: { KerbJolt: 1, ReverseBeeper: 1, Impact: 0 },
  });

  it('records a complete file and serialises it with a fixed key order', () => {
    expect(file.format).toBe('ssp.replay');
    expect(file.version).toBe(1);
    expect(file.ticks).toBe(3600);
    expect(Object.keys(file.checkpoints)).toEqual(['600', '1200', '1800', '2400', '3000', '3600']);
    const text = serialiseReplay(file);
    expect(text.endsWith('}\n')).toBe(true);
    expect(Object.keys(JSON.parse(text))).toEqual([
      'format',
      'version',
      'district',
      'seed',
      'ticks',
      'inputs',
      'checkpoints',
      'invariants',
    ]);
    const loaded = loadReplay(text);
    expect(loaded.file).toEqual(file);
    expect(serialiseReplay(loaded.file)).toBe(text);
    expect(inputLogsEqual(loaded.log, syntheticInputLog())).toBe(true);
  });

  it('accepts a file whose checkpoints are not recorded yet', () => {
    const loaded = loadReplay({ ...file, checkpoints: {} });
    expect(loaded.file.checkpoints).toEqual({});
  });

  it('rejects malformed files with a message naming the problem', () => {
    const bad = (patch: Partial<Record<keyof ReplayFile | 'extra', unknown>>): (() => void) => {
      return () => loadReplay({ ...file, ...patch });
    };
    expect(() => loadReplay('{')).toThrow(/not valid JSON/);
    expect(bad({ format: 'ssp.level' })).toThrow(/format must be "ssp.replay"/);
    expect(bad({ version: 2 })).toThrow(/version must be 1/);
    expect(bad({ extra: 1 })).toThrow(/unknown key "extra"/);
    expect(bad({ district: 'puddle_lane' })).toThrow(/district must match/);
    expect(bad({ seed: -1 })).toThrow(/seed must be a uint32/);
    expect(bad({ ticks: 0 })).toThrow(/ticks must be an integer/);
    expect(bad({ inputs: 3 })).toThrow(/inputs must be a base64 string/);
    expect(bad({ checkpoints: { '600': 'aaaaaaaa' } })).toThrow(/checkpoints\.1200 is missing/);
    expect(bad({ checkpoints: { ...file.checkpoints, '601': 'aaaaaaaa' } })).toThrow(/unknown key "601"/);
    expect(bad({ checkpoints: { ...file.checkpoints, '600': 'AAAAAAAA' } })).toThrow(/8 lowercase hex/);
    expect(bad({ invariants: { hpMax: 1 } })).toThrow(/unknown key "hpMax"/);
    expect(bad({ invariants: { minEvents: { Honk: 1 } } })).toThrow(/unknown key "Honk"/);
    expect(bad({ invariants: { minEvents: { Impact: 0.5 } } })).toThrow(
      /minEvents.Impact must be a non-negative integer/,
    );
    expect(bad({ invariants: { maxSolidOverlapM: -1 } })).toThrow(/maxSolidOverlapM must be a finite number/);
  });

  it('parses every documented invariant key', () => {
    const loaded = loadReplay({
      ...file,
      invariants: {
        minScore: 1,
        minLitterCollected: 20,
        hpMin: 50,
        maxSolidOverlapM: 0.001,
        minEvents: { Impact: 1, KerbJolt: 1, ReverseBeeper: 1, ShiftEnd: 0 },
        shiftEnded: 'TimeUp',
        minLuDumped: 10.5,
        minDumpsCompleted: 1,
        emptyAfterDump: true,
      },
    });
    expect(loaded.file.invariants.minEvents).toEqual({
      Impact: 1,
      KerbJolt: 1,
      ReverseBeeper: 1,
      ShiftEnd: 0,
    });
    expect(loaded.file.invariants.shiftEnded).toBe('TimeUp');
    expect(loaded.file.invariants.minLuDumped).toBe(10.5);
    expect(loaded.file.invariants.minDumpsCompleted).toBe(1);
    expect(loaded.file.invariants.emptyAfterDump).toBe(true);
    // Serialised in the fixed key order, after the M1 keys, whatever order they were given in.
    const text = serialiseReplay({
      ...file,
      invariants: { emptyAfterDump: true, shiftEnded: 'Towed', minScore: 1, minDumpsCompleted: 2 },
    });
    expect(Object.keys(JSON.parse(text).invariants)).toEqual([
      'minScore',
      'shiftEnded',
      'minDumpsCompleted',
      'emptyAfterDump',
    ]);
    expect(loadReplay(text).file.invariants.shiftEnded).toBe('Towed');
  });

  it('rejects malformed SSP-072 invariants (shift end reason, LU dumped, dumps completed, empty after dump)', () => {
    const bad = (invariants: Record<string, unknown>): (() => void) => {
      return () => loadReplay({ ...file, invariants });
    };
    expect(bad({ shiftEnded: 'Fired' })).toThrow(
      /invariants\.shiftEnded must be one of "Towed", "TimeUp", "Sacked"/,
    );
    expect(loadReplay({ ...file, invariants: { shiftEnded: 'Sacked' } }).file.invariants.shiftEnded).toBe(
      'Sacked',
    );
    expect(bad({ shiftEnded: true })).toThrow(/invariants\.shiftEnded must be one of/);
    expect(bad({ minLuDumped: -1 })).toThrow(/invariants\.minLuDumped must be a finite number ≥ 0/);
    expect(bad({ minDumpsCompleted: 0.5 })).toThrow(
      /invariants\.minDumpsCompleted must be a non-negative integer/,
    );
    expect(bad({ emptyAfterDump: false })).toThrow(/invariants\.emptyAfterDump must be true/);
  });
});

describe('replay invariants', () => {
  const body = { widthM: 1.75, lengthM: 3.25 };

  it('measures OBB penetration into a rect along the minimum axis (SAT)', () => {
    // Facing north (length along y), centre 0.5 m inside the rect's west edge: overlap 0.5 + 0.875.
    expect(obbRectPenetrationM({ ...body, xM: 10.5, yM: 5, headingRad: 0 }, 10, 0, 20, 10)).toBeCloseTo(
      1.375,
      12,
    );
    // Clear of it.
    expect(obbRectPenetrationM({ ...body, xM: 9, yM: 5, headingRad: 0 }, 10, 0, 20, 10)).toBe(0);
    // Facing east (length along x): the half-length now reaches 1.625 m.
    expect(
      obbRectPenetrationM({ ...body, xM: 8.5, yM: 5, headingRad: Math.PI / 2 }, 10, 0, 20, 10),
    ).toBeCloseTo(0.125, 12);
    // Nose-first into the rect's corner at 45°: the forward axis separates least (1.625 − √2 m), while the
    // OBB's own AABB would overlap 0.77 m.
    expect(
      obbRectPenetrationM({ ...body, xM: 9, yM: 11, headingRad: Math.PI / 4 }, 10, 0, 20, 10),
    ).toBeCloseTo(1.625 - Math.SQRT2, 12);
  });

  it('measures how far the OBB reaches outside the map', () => {
    expect(obbBoundaryPenetrationM({ ...body, xM: 5, yM: 5, headingRad: 0 }, 96, 96)).toBe(0);
    expect(obbBoundaryPenetrationM({ ...body, xM: 0.5, yM: 5, headingRad: 0 }, 96, 96)).toBeCloseTo(
      0.375,
      12,
    );
    expect(obbBoundaryPenetrationM({ ...body, xM: 50, yM: 95, headingRad: 0 }, 96, 96)).toBeCloseTo(
      0.625,
      12,
    );
    const level = syntheticLevel();
    expect(solidOverlapM(level, { ...body, xM: 8.5, yM: 6, headingRad: 0 })).toBeCloseTo(0.375, 12);
    expect(solidOverlapM(level, { ...body, xM: 48, yM: 48, headingRad: 1 })).toBe(0);
  });

  it('turns a run into invariant failures', () => {
    const level = syntheticLevel();
    const monitor = createInvariantMonitor(level, DEFAULT_TUNING);
    runReplay(level, DEFAULT_TUNING, 1, syntheticInputLog(), REPLAY_TICKS, monitor.observe);
    expect(monitor.ticks).toBe(REPLAY_TICKS);
    expect(monitor.minHp).toBe(100);
    expect(monitor.maxSolidOverlapM).toBe(0);
    expect(monitor.eventCounts[EV.KerbJolt]).toBeGreaterThan(10);
    expect(monitor.eventCounts[EV.ReverseBeeper]).toBeGreaterThan(1);
    expect(
      invariantFailures({ hpMin: 100, maxSolidOverlapM: 0.001, minEvents: { KerbJolt: 1 } }, monitor),
    ).toEqual([]);
    expect(invariantFailures({ hpMin: 101, minEvents: { Impact: 1, ShiftEnd: 0 } }, monitor)).toEqual([
      'hpMin: HP fell to 100, below 101',
      'minEvents.Impact: 0 event(s) over the replay, expected at least 1',
    ]);
    monitor.maxSolidOverlapM = 0.25;
    monitor.maxSolidOverlapTick = 77;
    expect(invariantFailures({ maxSolidOverlapM: 0.001 }, monitor)).toEqual([
      'maxSolidOverlapM: Bessie overlapped solid geometry by 0.2500 m at tick 77 (limit 0.001 m)',
    ]);
  });

  it('records the shift end and every completed dump, and checks the SSP-072 invariants', () => {
    const level = syntheticLevel();
    const monitor = createInvariantMonitor(level, DEFAULT_TUNING);
    const world = createWorld(level, 1, DEFAULT_TUNING);
    const tank = world.water.tuning.tankUnits;
    // Nothing has happened yet: every SSP-072 invariant fails with a readable reason.
    monitor.observe(world);
    const all = { shiftEnded: 'TimeUp', minLuDumped: 5, minDumpsCompleted: 1, emptyAfterDump: true } as const;
    expect(invariantFailures(all, monitor)).toEqual([
      'shiftEnded: the shift never ended (no ShiftEnd event), expected TimeUp',
      'minLuDumped: 0 LU dumped over the replay, expected at least 5',
      'minDumpsCompleted: 0 dump(s) completed over the replay, expected at least 1',
    ]);
    const tickWith = (fill: () => void): void => {
      world.tick += 1;
      world.events.count = 0;
      world.events.sealed = false;
      fill();
      monitor.observe(world);
    };
    // A completed depot dump that leaves LU behind and the tank short, then a clean skip dump; a dump cut short
    // (c = 0) is not counted.
    world.vehicle.hopperLU = 2;
    world.vehicle.water = tank - 10;
    world.hopper.luDumpedTotal = 6;
    tickWith(() => pushEvent(world.events, EV.DumpEnd, 0, DumpSite.Depot, 6, 1));
    world.vehicle.hopperLU = 0;
    tickWith(() => pushEvent(world.events, EV.DumpEnd, 1, DumpSite.Skip, 3, 1));
    tickWith(() => pushEvent(world.events, EV.DumpEnd, 1, DumpSite.Skip, 1, 0));
    expect(monitor.dumpsCompleted).toBe(2);
    expect(monitor.finalLuDumped).toBe(6);
    expect(
      invariantFailures({ minLuDumped: 6, minDumpsCompleted: 2, emptyAfterDump: true }, monitor),
    ).toEqual([
      `emptyAfterDump: the depot dump completed at tick 1 left 2 LU in the hopper and the tank at ${tank - 10} of ${tank}`,
    ]);
    expect(invariantFailures({ minDumpsCompleted: 3 }, monitor)).toEqual([
      'minDumpsCompleted: 2 dump(s) completed over the replay, expected at least 3',
    ]);
    // The shift ends TOWED: the wrong reason for a TimeUp replay; a second ShiftEnd is reported as such.
    tickWith(() => pushEvent(world.events, EV.ShiftEnd, -1, ShiftEndReason.Towed, 0, 0));
    expect(monitor.shiftEndTick).toBe(4);
    expect(invariantFailures({ shiftEnded: 'Towed' }, monitor)).toEqual([]);
    expect(invariantFailures({ shiftEnded: 'TimeUp' }, monitor)).toEqual([
      'shiftEnded: the shift ended at tick 4 with Towed, expected TimeUp',
    ]);
    tickWith(() => pushEvent(world.events, EV.ShiftEnd, -1, ShiftEndReason.TimeUp, 0, 0));
    expect(invariantFailures({ shiftEnded: 'Towed' }, monitor)).toEqual([
      'shiftEnded: 2 ShiftEnd events, expected exactly one (Towed)',
    ]);
  });
});
