// The World: owner of all mutable shift state and of the canonical tick order (TECHNICAL_DESIGN §5.2, §7.1,
// SSP-035). `world.step(input)` (or stepWorld(world, input)) runs the 11 phases below, in this order, every tick. The order is
// canonical: changing it changes replay hashes and must be called out in the commit (§5.2).
//
//   1 Input             copy the InputFrame into the sim; hand it to the replay recorder (SSP-038); once the
//                       shift is over, replace it with the knock-off brake (gateShiftInput, shift.ts)
//   2 Vehicle (+hopper) brush state machine (the BRUSH edge, lower/raise and spin timers; brush.ts) → surface
//                       sample → stepVehicle (handling scaled by the hopper fill, top speed by the brush state)
//                       → EV.ReverseBeeper → kerb crossing (§8.2 steps 1–9)
//   3 Static collision  Bessie vs merged solids, map boundary and props: SAT/MTV, restitution, damage, EV.Impact
//                       (collision/resolveStatic.ts over collision/grid.ts, SSP-036)
//   4 Bodies            empty until M3
//   5 Brush/litter/water empty until M2 (SSP-065)
//   6 Dirt              empty until M2 (SSP-065)
//   7 NPC               empty until M3 (SSP-080)
//   8 Traffic           empty until M3 (SSP-089)
//   9 Scoring/combo/complaints empty until M2 (SSP-065)
//  10 Shift timer       shift.ts (SSP-062): TOWED, the rollout start, the dump FSM (hopper drain, depot water
//                       refill, EV.DumpStart/DumpEnd), the 240 s countdown, the knock-off and EV.ShiftEnd
//  11 Emit events       seal the EventQueue
//
// The EventQueue is reset before phase 1, so every tick starts with it empty. Renderers, audio and UI read
// the World only through WorldView (read-only types over the same objects; nothing is copied) and never write
// it (CLAUDE.md hard rule 2). The sim never reads the render camera (§7.4).
//
// Hot path: stepWorld allocates nothing. Scratch objects live on the World, created once by createWorld.

import { type Brush, type BrushView, createBrush, stepBrushState } from './brush.ts';
import { createStaticGrid, type StaticGrid } from './collision/grid.ts';
import {
  createStaticResolver,
  type ReadonlyContactLog,
  resolveStatic,
  type StaticResolver,
} from './collision/resolveStatic.ts';
import {
  createEventQueue,
  EV,
  type EventQueue,
  emitEvent,
  type ReadonlyEventQueue,
  resetEvents,
  sealEvents,
} from './eventQueue.ts';
import { cos, sin } from './fmath.ts';
import { createHopper, type Hopper, type HopperView, setHopperCapacity } from './hopper.ts';
import { createInputFrame, type InputFrame } from './inputFrame.ts';
import { createKerbCrossings, findKerbCrossings, type KerbCrossings } from './kerb.ts';
import type { Level } from './map.ts';
import {
  createShift,
  gateShiftInput,
  type Shift,
  type ShiftOptions,
  type ShiftView,
  setShiftTuning,
  stepShift,
} from './shift.ts';
import { createSurfaceTable, type SurfaceTable, sampleSurface } from './surface.ts';
import { type SweeperTuning, type Tuning, tuningsEqual } from './tuning.ts';
import {
  createVehicleParams,
  createVehicleState,
  stepVehicle,
  type VehicleParams,
  type VehicleState,
  type VehicleSurface,
} from './vehicle.ts';

/** The 11 tick phases, numbered as in TECHNICAL_DESIGN §5.2. */
export const Phase = {
  Input: 1,
  Vehicle: 2,
  StaticCollision: 3,
  Bodies: 4,
  BrushLitter: 5,
  Dirt: 6,
  Npc: 7,
  Traffic: 8,
  Scoring: 9,
  ShiftTimer: 10,
  EmitEvents: 11,
} as const;
export type Phase = (typeof Phase)[keyof typeof Phase];

/**
 * Receives each tick's input in phase 1 (tick is the index of the tick being run, starting at 0). SSP-038's
 * replay recorder appends it to a preallocated log. Must not keep a reference to `input`: the World reuses it.
 */
export type InputRecorder = (tick: number, input: Readonly<InputFrame>) => void;

/** Called at the start of every phase with the phase number. For tests and the dev panel; null by default. */
export type PhaseTrace = (phase: Phase, world: WorldView) => void;

/** All mutable shift state. Create with createWorld; advance with stepWorld. */
export type World = {
  readonly level: Level;
  /** The tuning the World runs on. Replace it only through setWorldTuning, between ticks. */
  tuning: Tuning;
  /** The run seed (uint32). Subsystem RNG streams are derived from it as they arrive (§7.3). */
  readonly seed: number;
  /** Ticks completed since shift start. Integer; a 240 s shift is 14,400 ticks (§5.1). */
  tick: number;
  /** This tick's input, copied in phase 1. */
  readonly input: InputFrame;
  readonly vehicle: VehicleState;
  readonly vehicleParams: VehicleParams;
  /**
   * Bessie's hopper (hopper.ts, SSP-058): bulldozer state, drain and LU-dumped counters over
   * vehicle.hopperLU and vehicleParams.hopperCapacityLU. Dumping (phase 10, shift.ts, SSP-062) drains it;
   * brush collection (phase 5) adds to it once SSP-065 wires the brush in.
   */
  readonly hopper: Hopper;
  /**
   * Bessie's brush (brush.ts, SSP-059). Phase 2 runs its state machine (and so the brush-down top speed); its
   * litter step (gutter, suction, fling, inlet, bulldozer) joins phase 5 with the LitterField in SSP-065.
   */
  readonly brush: Brush;
  /** The surface sample phase 2 used this tick (average grip k and rolling-drag multiplier). */
  readonly surface: VehicleSurface;
  readonly events: EventQueue;
  /** The static collision world (merged solids, map boundary, props), built once from the level (§9.1). */
  readonly staticGrid: StaticGrid;
  /** Phase-3 scratch; its `log` lists this tick's contacts. */
  readonly staticResolver: StaticResolver;
  /**
   * The shift (shift.ts, SSP-062): timer, dump FSM and end of shift, run in phase 10. `shift.endReason` says why
   * the shift ended (0 while it runs); EV.ShiftEnd fires once, on that tick. The World keeps stepping after it
   * (the scene moves to the tally) with the input gated to the knock-off brake.
   */
  readonly shift: Shift;
  /** Phase-1 hook for the replay log (SSP-038). Null until a recorder is attached. */
  recordInput: InputRecorder | null;
  /** Optional phase-order trace. Null by default. */
  phaseTrace: PhaseTrace | null;
  readonly surfaceTable: SurfaceTable;
  readonly kerbScratch: KerbCrossings;
  /** `World.step(input)` (§5.2): the same as stepWorld(world, input). Bound once at creation. */
  readonly step: (input: Readonly<InputFrame>) => void;
};

/** What render, audio and UI may see: the same objects as World, typed read-only. */
export type WorldView = {
  readonly level: Level;
  readonly seed: number;
  readonly tick: number;
  readonly input: Readonly<InputFrame>;
  readonly vehicle: Readonly<VehicleState>;
  readonly hopper: HopperView;
  readonly brush: BrushView;
  readonly surface: Readonly<VehicleSurface>;
  readonly events: ReadonlyEventQueue;
  readonly staticGrid: StaticGrid;
  /** This tick's phase-3 contacts. */
  readonly staticResolver: { readonly log: ReadonlyContactLog };
  readonly shift: ShiftView;
};

/**
 * A World for one shift on `level`, seeded with `seed` (an integer, taken as uint32), using `tuning`. The
 * tuning is passed in, never imported, so the dev panel can supply an edited copy (§8). Bessie spawns at the
 * level's player start (body centre, heading), stationary. The event queue starts empty and sealed. `shift`
 * holds the shift start parameters (ShiftOptions: `firstPlay`, default false); the shift starts in its
 * rollout.
 */
export function createWorld(level: Level, seed: number, tuning: Tuning, shift: ShiftOptions = {}): World {
  if (!Number.isInteger(seed)) throw new Error(`createWorld: seed must be an integer, got ${seed}`);
  const sweeper = tuning.vehicle.sweeper;
  const { x, y, heading } = level.player;
  const vehicle = createVehicleState(sweeper, x, y, heading);
  const vehicleParams = createVehicleParams(sweeper, tuning.hopper.capacityLu);
  const hopper = createHopper(vehicle, vehicleParams, tuning.hopper);
  const world: World = {
    level,
    tuning,
    seed: seed >>> 0,
    tick: 0,
    input: createInputFrame(),
    vehicle,
    vehicleParams,
    hopper,
    brush: createBrush(tuning, seed >>> 0),
    surface: { gripPerS: sweeper.lateralGripPerS.asphalt, rollMult: 1 },
    events: createEventQueue(),
    staticGrid: createStaticGrid(level, tuning.propFootprints),
    staticResolver: createStaticResolver(),
    shift: createShift(level, vehicle, hopper, { vehicle, tuning: tuning.water }, tuning, shift),
    recordInput: null,
    phaseTrace: null,
    surfaceTable: createSurfaceTable(sweeper),
    kerbScratch: createKerbCrossings(),
    step(input: Readonly<InputFrame>): void {
      stepWorld(world, input);
    },
  };
  return world;
}

/** The read-only view of `world` for render, audio and UI. No copy: it is the same object. */
export function viewWorld(world: World): WorldView {
  return world;
}

/**
 * Hand the World a new tuning between ticks (the dev panel's live tuning, SSP-048): the parameter boundary of
 * CLAUDE.md hard rule 2, so the panel never writes sim state itself. Every phase reads its handling numbers
 * through `world.tuning` and `world.vehicleParams.tuning` each tick, and the per-surface table is refilled in
 * place, so the next tick runs on the new values. Bessie's pose, speed and gear carry on; her HP is clamped to
 * the new health.maxHp, and the hopper takes the new hopper.capacityLu (its LU clamped to it, `full`
 * recomputed without an event) and warnFraction. The static grid was built from `propFootprints` at creation, so a tuning whose
 * footprints differ needs a new World: this throws instead of half-applying it.
 *
 * A replay is `f(seed, district, inputs)` under one tuning, so ticks run after a change no longer reproduce
 * against tuning.json; ShiftScene tracks that for Save replay. Allocates (the surface table); never per tick.
 */
export function setWorldTuning(world: World, tuning: Tuning): void {
  if (!tuningsEqual(tuning.propFootprints, world.tuning.propFootprints)) {
    throw new Error('setWorldTuning: propFootprints differ; the static grid needs a new World (createWorld)');
  }
  const sweeper = tuning.vehicle.sweeper;
  const table = createSurfaceTable(sweeper);
  world.tuning = tuning;
  world.vehicleParams.tuning = sweeper;
  world.surfaceTable.gripPerSById.set(table.gripPerSById);
  world.surfaceTable.rollMultById.set(table.rollMultById);
  if (world.vehicle.hp > sweeper.health.maxHp) world.vehicle.hp = sweeper.health.maxHp;
  world.hopper.tuning = tuning.hopper;
  setHopperCapacity(world.hopper, tuning.hopper.capacityLu);
  world.brush.tuning = tuning;
  setShiftTuning(world.shift, tuning);
}

/** Advance the world by one tick (DT_S) under `input`, running the 11 phases of §5.2 in order. */
export function stepWorld(world: World, input: Readonly<InputFrame>): void {
  resetEvents(world.events, world.tick);
  const trace = world.phaseTrace;

  if (trace !== null) trace(Phase.Input, world);
  phaseInput(world, input);

  if (trace !== null) trace(Phase.Vehicle, world);
  phaseVehicle(world);

  if (trace !== null) trace(Phase.StaticCollision, world);
  phaseStaticCollision(world);

  if (trace !== null) trace(Phase.Bodies, world);
  phaseBodies(world);

  if (trace !== null) trace(Phase.BrushLitter, world);
  phaseBrushLitter(world);

  if (trace !== null) trace(Phase.Dirt, world);
  phaseDirt(world);

  if (trace !== null) trace(Phase.Npc, world);
  phaseNpc(world);

  if (trace !== null) trace(Phase.Traffic, world);
  phaseTraffic(world);

  if (trace !== null) trace(Phase.Scoring, world);
  phaseScoring(world);

  if (trace !== null) trace(Phase.ShiftTimer, world);
  phaseShiftTimer(world);

  if (trace !== null) trace(Phase.EmitEvents, world);
  sealEvents(world.events);

  world.tick += 1;
}

// ---------------------------------------------------------------------------------------------------------
// Phases
// ---------------------------------------------------------------------------------------------------------

/**
 * Phase 1: copy the frame field by field (the caller may reuse its object) and hand it to the recorder. Then,
 * once the shift is over (knock-off or ended), replace it with the knock-off brake (shift.ts): the log keeps
 * what the player pressed, and every later phase sees the gated frame.
 */
function phaseInput(world: World, input: Readonly<InputFrame>): void {
  const own = world.input;
  own.throttle = input.throttle;
  own.brake = input.brake;
  own.steer = input.steer;
  own.buttons = input.buttons;
  own.pressed = input.pressed;
  const recorder = world.recordInput;
  if (recorder !== null) recorder(world.tick, own);
  gateShiftInput(world.shift, own);
}

/**
 * Phase 2 (§8.2): run the brush state machine (the BRUSH pressed edge and the lower/raise and spin timers, which
 * set vehicle.brushDown and so the top speed; the hopper's full flag moves it between Collecting and
 * Bulldozing), sample the surface under the wheels at the pose the tick starts from, integrate the vehicle
 * (steps 1–8, with step 1 scaling the handling by the hopper's fill fraction through hopperFillFraction), turn
 * the reverse-engage flag into EV.ReverseBeeper, then apply kerb crossings (step 9). The hopper changes only
 * in phases 5 (collection) and 10 (dump drain), so this phase sees last tick's fill.
 */
function phaseVehicle(world: World): void {
  const v = world.vehicle;
  const sweeper = world.tuning.vehicle.sweeper;
  stepBrushState(world.brush, v, world.input, world.hopper.full);
  sampleSurface(world.level, world.surfaceTable, sweeper, v, world.surface);
  stepVehicle(v, world.input, world.surface, world.vehicleParams);
  if (v.reverseEngaged) {
    const e = emitEvent(world.events, EV.ReverseBeeper, -1);
    world.events.a[e] = v.xM;
    world.events.b[e] = v.yM;
  }
  applyKerbCrossings(world, sweeper);
}

/**
 * §8.2 step 9. Each axle midpoint's segment runs from the pose at the start of the tick (prevXM/prevYM/
 * prevHeadingRad, which stepVehicle copied) to the integrated pose. Every raised-kerb edge the front axle
 * crosses keeps kerb.speedKeepMul of vLong (a 30% loss) and emits EV.KerbJolt; every one the rear axle crosses
 * emits EV.KerbJolt only. Front crossings are applied before rear ones, each in crossing order.
 */
function applyKerbCrossings(world: World, sweeper: SweeperTuning): void {
  const v = world.vehicle;
  const collide = world.level.layers.collide;
  const w = world.level.size[0];
  const h = world.level.size[1];
  const scratch = world.kerbScratch;
  const events = world.events;
  const fx0 = sin(v.prevHeadingRad);
  const fy0 = -cos(v.prevHeadingRad);
  const fx1 = sin(v.headingRad);
  const fy1 = -cos(v.headingRad);

  const front = sweeper.body.frontAxleOffsetM;
  scratch.x0M = v.prevXM + fx0 * front;
  scratch.y0M = v.prevYM + fy0 * front;
  scratch.x1M = v.xM + fx1 * front;
  scratch.y1M = v.yM + fy1 * front;
  let n = findKerbCrossings(collide, w, h, scratch);
  for (let i = 0; i < n; i += 1) {
    emitKerbJolt(events, scratch, i, v);
    v.vLongMps *= sweeper.kerb.speedKeepMul;
  }

  const rear = sweeper.body.rearAxleOffsetM;
  scratch.x0M = v.prevXM + fx0 * rear;
  scratch.y0M = v.prevYM + fy0 * rear;
  scratch.x1M = v.xM + fx1 * rear;
  scratch.y1M = v.yM + fy1 * rear;
  n = findKerbCrossings(collide, w, h, scratch);
  for (let i = 0; i < n; i += 1) emitKerbJolt(events, scratch, i, v);
}

/**
 * EV.KerbJolt at crossing `i` of `scratch`, carrying |vLong| before any loss. Takes the vehicle, not the speed,
 * so no double crosses a call boundary (see eventQueue.ts). Reads are in range (i < count).
 */
function emitKerbJolt(events: EventQueue, scratch: KerbCrossings, i: number, v: VehicleState): void {
  const e = emitEvent(events, EV.KerbJolt, -1);
  events.a[e] = scratch.xM[i] as number;
  events.b[e] = scratch.yM[i] as number;
  events.c[e] = Math.abs(v.vLongMps);
}

// Phases 3–10 are ordered call sites. Each takes the World so the systems that fill them (named below) slot in
// without touching stepWorld; until then they intentionally do nothing.

/**
 * Phase 3 (§9.2): resolve Bessie against the static grid (merged solids, map boundary, props) with SAT/MTV,
 * restitution and impact damage, emitting EV.Impact per approaching contact. See collision/resolveStatic.ts.
 */
function phaseStaticCollision(world: World): void {
  resolveStatic(world.staticGrid, world.staticResolver, world.vehicle, world.vehicleParams, world.events);
}

/** Phase 4: knockable bodies (bins, cones, A-boards, trolleys, recycling boxes). M3. */
function phaseBodies(_world: World): void {
  // Filled in M3.
}

/**
 * Phase 5: brush, litter and water. SSP-065 wires in beginLitterTick → stepBrushLitter (brush.ts) → stepLitter
 * (litter.ts), and water.ts.
 */
function phaseBrushLitter(_world: World): void {
  // Filled by SSP-065.
}

/** Phase 6: dirt (grime footprint erase, stain cleaning, dust). SSP-065. */
function phaseDirt(_world: World): void {
  // Filled by SSP-065.
}

/** Phase 7: NPC AI. SSP-080. */
function phaseNpc(_world: World): void {
  // Filled by SSP-080.
}

/** Phase 8: traffic. SSP-089. */
function phaseTraffic(_world: World): void {
  // Filled by SSP-089.
}

/** Phase 9: scoring, combo and complaints, consuming this tick's events. SSP-065. */
function phaseScoring(_world: World): void {
  // Filled by SSP-065.
}

/**
 * Phase 10 (shift.ts, SSP-062): TOWED (the first tick that ends with HP at 0, §9.2 step 6), the timer's rollout
 * start, the dump FSM (depot bays and skips: hopper drain, depot water refill, EV.DumpStart/EV.DumpEnd), the
 * countdown and the knock-off, ending in EV.ShiftEnd (TOWED or TIME_UP) once. SACKED is SSP-079 (M3).
 */
function phaseShiftTimer(world: World): void {
  stepShift(world.shift, world.input, world.events);
}
