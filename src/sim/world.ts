// The World: owner of all mutable shift state and of the canonical tick order (TECHNICAL_DESIGN §5.2, §7.1,
// SSP-035). `world.step(input)` (or stepWorld(world, input)) runs the 11 phases below, in this order, every tick. The order is
// canonical: changing it changes replay hashes and must be called out in the commit (§5.2).
//
//   1 Input             copy the InputFrame into the sim; hand it to the replay recorder (SSP-038); once the
//                       shift is over, replace it with the knock-off brake (gateShiftInput, shift.ts); consume
//                       the HORN edge into EV.Horn (stepHornInput, complaints.ts, SSP-078)
//   2 Vehicle (+hopper) brush state machine (the BRUSH edge, lower/raise and spin timers; brush.ts) → surface
//                       sample, hazard grip overrides included → stepVehicle (handling scaled by the hopper
//                       fill, top speed by the brush state) → EV.ReverseBeeper → kerb crossing → hazard
//                       contacts: jolts, LU spills, the open-manhole hard stop (§8.2 steps 1–10; hazards.ts)
//   3 Static collision  Bessie vs merged solids, map boundary and props: SAT/MTV, restitution, damage, EV.Impact
//                       (collision/resolveStatic.ts over collision/grid.ts, SSP-036)
//   4 Bodies            empty until M3
//   5 Brush/litter/water beginLitterTick → stepBrushLitter (gutter, suction, fling, inlet, bulldozer; brush.ts)
//                       → the brush-up rules: stepBrushUpLeaves (hazards.ts) then stepBrushUpSplats (stains.ts)
//                       → stepLitter (arcs, pushes, drift; litter.ts) → stepWater (hydrant refill, spray;
//                       water.ts) (SSP-065)
//   6 Dirt              stepDirt (grime footprint erase, Kerb Hugger; dirt.ts) → cleanStainsInCone (water.ts);
//                       dust is M3 (SSP-065)
//   7 NPC               beginNpcTick (prev positions) → updateViewRect (world.viewRect from Bessie's pose) →
//                       stepNpcSpawner (named arrivals; once a second cats, flocks and the ambient population)
//                       → deliverStimuli → perceiveNpcs (index mod 4 == tick mod 4) → tickNpcBehaviours
//                       (npc/, SSP-080; the behaviours steer with npc/steering.ts, SSP-081); the litterbug's
//                       Caught! flags the tick's honk here (markHornCaught, complaints.ts, SSP-078) →
//                       updateZebraOccupancy (world.zebras, SSP-081)
//   8 Traffic           empty until M3 (SSP-089)
//   9 Scoring/combo/complaints stepHornSpam → applyPenalties (complaints.ts, SSP-078: the honk window, then
//                       the tick's penalty facts: points, complaints, EV.Complaint) → stepScoring (scoring.ts,
//                       combo.ts: pickups, then the penalties' points and the chain reset) → stepTidy (tidy.ts)
//  10 Shift timer       shift.ts (SSP-062): TOWED, the rollout start, the dump FSM (hopper drain, depot water
//                       refill, EV.DumpStart/DumpEnd), the 240 s countdown, the knock-off and EV.ShiftEnd
//  11 Emit events       seal the EventQueue
//
// Shift setup (createWorld, SSP-065): every store is allocated once, at its §7.1 capacity (litter 2,000, stains
// 256, hazards 64, NPCs 80, penalty facts 64 per tick), then the shift starts: the initial litter is spawned
// (spawnInitialLitter), the hazards (spawnHazards, with the oil slicks' paired stains), the grime is laid
// (initGrime), the frontage tally is counted and attached (initTidy), the tank is filled (refillWater), the
// hopper is empty and the complaints meter is at 0; the stain store's penalty hook records into the penalty log.
//
// The EventQueue is reset before phase 1, so every tick starts with it empty. Renderers, audio and UI read
// the World only through WorldView (read-only types over the same objects; nothing is copied) and never write
// it (CLAUDE.md hard rule 2). The sim never reads the render camera (§7.4).
//
// Hot path: stepWorld allocates nothing. Scratch objects live on the World, created once by createWorld.

import { type Brush, type BrushView, createBrush, stepBrushLitter, stepBrushState } from './brush.ts';
import { createStaticGrid, type StaticGrid } from './collision/grid.ts';
import {
  createStaticResolver,
  type ReadonlyContactLog,
  resolveStatic,
  type StaticResolver,
} from './collision/resolveStatic.ts';
import {
  applyPenalties,
  type Complaints,
  type ComplaintsView,
  createComplaints,
  Offence,
  setComplaintsTuning,
  stepHornInput,
  stepHornSpam,
} from './complaints.ts';
import { createDirt, type Dirt, type DirtView, initGrime, setDirtTuning, stepDirt } from './dirt.ts';
import type { Entities } from './entities.ts';
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
import {
  createHazardStore,
  type HazardStore,
  type HazardStoreView,
  spawnHazards,
  stepBrushUpLeaves,
  stepHazardContacts,
} from './hazards.ts';
import { createHopper, type Hopper, type HopperView, setHopperCapacity } from './hopper.ts';
import { createInputFrame, type InputFrame } from './inputFrame.ts';
import { createKerbCrossings, findKerbCrossings, type KerbCrossings } from './kerb.ts';
import {
  beginLitterTick,
  createLitterField,
  type LitterField,
  type LitterFieldView,
  spawnInitialLitter,
  stepLitter,
} from './litter.ts';
import type { Level } from './map.ts';
import { createNpcAi, type NpcAi, tickNpcBehaviours } from './npc/npcAi.ts';
import { perceiveNpcs } from './npc/perception.ts';
import { setNpcSpawnerTuning, stepNpcSpawner } from './npc/spawner.ts';
import {
  createZebras,
  setSteeringTuning,
  updateZebraOccupancy,
  type Zebras,
  type ZebrasView,
} from './npc/steering.ts';
import { deliverStimuli } from './npc/stimuli.ts';
import { beginNpcTick, createNpcStore, type NpcStore, type NpcStoreView } from './npc/store.ts';
import { createPenaltyHook, createPenaltyLog, type PenaltyLog, type PenaltyLogView } from './penalties.ts';
import { createStream, type Sfc32 } from './rng.ts';
import { createScoring, type Scoring, type ScoringView, setScoringTuning, stepScoring } from './scoring.ts';
import {
  createShift,
  gateShiftInput,
  isShiftDraining,
  type Shift,
  type ShiftOptions,
  type ShiftView,
  setShiftTuning,
  stepShift,
} from './shift.ts';
import { createStainStore, type StainStore, type StainStoreView, stepBrushUpSplats } from './stains.ts';
import { createSurfaceTable, type SurfaceTable, sampleSurface } from './surface.ts';
import { createTidy, initTidy, setTidyTuning, stepTidy, type Tidy, type TidyView } from './tidy.ts';
import { DEFAULT_ENTITIES, type SweeperTuning, type Tuning, tuningsEqual } from './tuning.ts';
import {
  createVehicleParams,
  createVehicleState,
  stepVehicle,
  type VehicleParams,
  type VehicleState,
  type VehicleSurface,
} from './vehicle.ts';
import { createViewRect, updateViewRect, type ViewRect } from './viewRect.ts';
import {
  cleanStainsInCone,
  createWater,
  refillWater,
  setWaterTuning,
  stepWater,
  type Water,
  type WaterView,
} from './water.ts';

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
   * vehicle.hopperLU and vehicleParams.hopperCapacityLU. Empty at shift start. Brush collection (phase 5) adds
   * to it, hazard jolts (phase 2) spill from it and dumping (phase 10, shift.ts, SSP-062) drains it.
   */
  readonly hopper: Hopper;
  /**
   * Bessie's brush (brush.ts, SSP-059). Phase 2 runs its state machine (and so the brush-down top speed); phase 5
   * runs its litter step (gutter, suction, fling, inlet, bulldozer) against the LitterField (SSP-065).
   */
  readonly brush: Brush;
  /**
   * The LitterField (litter.ts), capacity 2,000: the shift's initial litter (spawnInitialLitter at shift start)
   * plus dynamic litter (hazard spills, SSP-093). Phase 5 moves and collects it.
   */
  readonly litter: LitterField;
  /**
   * The stain store (stains.ts, SSP-061), capacity 256: the oil slicks' paired stains at shift start, and the
   * dog-mess splats phase 5 makes. Phase 6 sprays stains clean.
   */
  readonly stains: StainStore;
  /**
   * Bessie's water system (water.ts, SSP-061) over vehicle.water: full at shift start; phase 5 runs the hydrant
   * refill and the spray, phase 6 the cone's stain cleaning; the shift's depot dump refills it.
   */
  readonly water: Water;
  /** The grime mask and its counters (dirt.ts, SSP-060): laid at shift start, erased in phase 6. */
  readonly dirt: Dirt;
  /** Score, combo chain and their parts (scoring.ts, combo.ts, SSP-063), stepped in phase 9. */
  readonly scoring: Scoring;
  /** Tidy %, stars and the frontages' clean % and Clean Sweeps (tidy.ts, SSP-064), stepped in phase 9. */
  readonly tidy: Tidy;
  /**
   * This tick's penalty facts (penalties.ts, SSP-078): the one penalty API. Phases 2–8 push facts
   * (pushPenalty(world.penalties, reason, pts, complaints), then the position into the slot); phase 9 consumes
   * them, so it is empty between ticks.
   */
  readonly penalties: PenaltyLog;
  /** The Council Complaints meter and the horn window (complaints.ts, SSP-078): phases 1, 7 and 9. */
  readonly complaints: Complaints;
  /**
   * The hazard store (hazards.ts, SSP-093), spawned at shift start from the level's speed bumps and compiled
   * `hazards` spec. Phase 2 reads its grip overrides and applies its jolts and hard stop.
   */
  readonly hazards: HazardStore;
  /**
   * The `events` stream, sfc32(seed ^ hash32('events')): dynamic litter (LEVEL_DESIGN §9.1 rule 7), so far
   * the hazard spills. Later event systems draw from this same object.
   */
  readonly eventsRng: Sfc32;
  /**
   * The NPC store (npc/store.ts, SSP-080), capacity 80: people, the dog walkers' dogs, cats and flock birds.
   * Phase 7's spawner fills and empties it; the behaviours move them.
   */
  readonly npc: NpcStore;
  /**
   * Phase 7's other state (npc/npcAi.ts): the `npc` stream, the stimulus queue, the behaviours, the spawner and
   * the steering core.
   */
  readonly npcAi: NpcAi;
  /**
   * Per-zebra occupancy (npc/steering.ts, SSP-081): every site.zebra and how many NPCs stand on it, counted at
   * the end of phase 7. A zebra is OCCUPIED while its count is above 0 (traffic, SSP-089; the penalty, SSP-085).
   */
  readonly zebras: Zebras;
  /**
   * The deterministic stand-in for the view (viewRect.ts, TECHNICAL_DESIGN §7.4): Bessie plus her look-ahead,
   * ±28 × ±14.2 m, margin included. Updated at the start of phase 7 from her pose after phase 3; spawning and
   * despawning test shapes against it.
   */
  readonly viewRect: ViewRect;
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
  readonly litter: LitterFieldView;
  readonly stains: StainStoreView;
  readonly water: WaterView;
  readonly dirt: DirtView;
  readonly scoring: ScoringView;
  readonly tidy: TidyView;
  readonly penalties: PenaltyLogView;
  readonly complaints: ComplaintsView;
  readonly hazards: HazardStoreView;
  readonly npc: NpcStoreView;
  readonly zebras: ZebrasView;
  readonly viewRect: Readonly<ViewRect>;
  readonly surface: Readonly<VehicleSurface>;
  readonly events: ReadonlyEventQueue;
  readonly staticGrid: StaticGrid;
  /** This tick's phase-3 contacts. */
  readonly staticResolver: { readonly log: ReadonlyContactLog };
  readonly shift: ShiftView;
};

/**
 * A World for one shift on `level`, seeded with `seed` (an integer, taken as uint32), using `tuning`. The
 * tuning is passed in, never imported, so the dev panel can supply an edited copy (§8). `shift` holds the
 * shift start parameters (ShiftOptions: `firstPlay`, default false); the shift starts in its rollout.
 * `entities` is the validated entities.json; it defaults to the committed file (DEFAULT_ENTITIES), which no
 * caller edits. Bessie spawns at the level's player start (body centre, heading), stationary, with an empty
 * hopper and a full tank. Shift setup (SSP-065), in this order: the initial litter (spawnInitialLitter on the
 * `litter` stream), the hazards (spawnHazards: speed bumps, placed, random on the `hazards` stream, each oil
 * slick with its paired stain), the grime (initGrime on the `grime` stream), the frontage tally (initTidy),
 * the full tank (refillWater). Each step draws on its own stream, so the order changes no layout; it matters
 * only in that initTidy must follow the litter and the grime. The event queue starts empty and sealed.
 */
export function createWorld(
  level: Level,
  seed: number,
  tuning: Tuning,
  shift: ShiftOptions = {},
  entities: Entities = DEFAULT_ENTITIES,
): World {
  if (!Number.isInteger(seed)) throw new Error(`createWorld: seed must be an integer, got ${seed}`);
  const sweeper = tuning.vehicle.sweeper;
  const { x, y, heading } = level.player;
  const vehicle = createVehicleState(sweeper, x, y, heading);
  const vehicleParams = createVehicleParams(sweeper, tuning.hopper.capacityLu);
  // A new VehicleState has an empty hopper (hopperLU 0): the shift starts empty.
  const hopper = createHopper(vehicle, vehicleParams, tuning.hopper);
  const litter = createLitterField(level, tuning, entities);
  const stains = createStainStore(entities, undefined, litter.capacity);
  const eventsRng = createStream(seed >>> 0, 'events');
  const hazards = createHazardStore(level, entities, eventsRng, undefined, litter.capacity);
  const dirt = createDirt(level, tuning);
  const scoring = createScoring(tuning, entities);
  const tidy = createTidy(level, tuning);
  const water = createWater(vehicle, tuning, level);
  // Shift setup (see above).
  spawnInitialLitter(litter, level, seed >>> 0);
  spawnHazards(hazards, level, seed >>> 0, stains);
  initGrime(dirt, level, seed >>> 0);
  initTidy(tidy, dirt, litter);
  refillWater(water);
  const penalties = createPenaltyLog();
  stains.onPenalty = createPenaltyHook(penalties, Offence.Splat);
  // NPCs spawn from the first tick's phase 7 on (the spawner never places one at shift setup).
  const npc = createNpcStore(level);
  const staticGrid = createStaticGrid(level, tuning.propFootprints);
  const zebras = createZebras(level);
  const npcAi = createNpcAi(level, seed >>> 0, tuning, entities, staticGrid, zebras, npc.capacity);
  const world: World = {
    level,
    tuning,
    seed: seed >>> 0,
    tick: 0,
    input: createInputFrame(),
    vehicle,
    vehicleParams,
    hopper,
    brush: createBrush(tuning, seed >>> 0, litter.capacity),
    litter,
    stains,
    water,
    dirt,
    scoring,
    tidy,
    penalties,
    complaints: createComplaints(tuning),
    hazards,
    eventsRng,
    npc,
    npcAi,
    zebras,
    viewRect: createViewRect(vehicle),
    surface: { gripPerS: sweeper.lateralGripPerS.asphalt, rollMult: 1 },
    events: createEventQueue(),
    staticGrid,
    staticResolver: createStaticResolver(),
    shift: createShift(level, vehicle, hopper, water, tuning, shift),
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
 * recomputed without an event) and warnFraction; the tank is clamped to the new water.tankUnits (the shift's
 * depot refill reads the same Water), the Dirt, scoring, combo and Tidy re-read their numbers (running totals,
 * the chain and Clean Sweeps are kept; every % is recomputed). The static grid was built from `propFootprints` at creation, so a tuning whose
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
  setWaterTuning(world.water, tuning);
  setShiftTuning(world.shift, tuning);
  world.litter.flingTuning = tuning.sweeping.fling;
  setDirtTuning(world.dirt, tuning);
  setScoringTuning(world.scoring, tuning);
  setTidyTuning(world.tidy, tuning, world.dirt, world.litter);
  setNpcSpawnerTuning(world, tuning, world.npcAi.entities);
  setComplaintsTuning(world.complaints, tuning);
  setSteeringTuning(world.npcAi.steering, world.level, world.staticGrid, tuning);
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
 * what the player pressed, and every later phase sees the gated frame. Last, the gated frame's HORN edge is
 * consumed: EV.Horn at Bessie's pose as the tick starts, and the honk is marked for phase 9's spam window
 * (complaints.ts stepHornInput, SSP-078).
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
  stepHornInput(world.complaints, own, world.vehicle, world.events);
}

/**
 * Phase 2 (§8.2): run the brush state machine (the BRUSH pressed edge and the lower/raise and spin timers, which
 * set vehicle.brushDown and so the top speed; the hopper's full flag moves it between Collecting and
 * Bulldozing), sample the surface under the wheels at the pose the tick starts from (hazard grip overrides
 * first, SSP-093), integrate the vehicle (steps 1–8, with step 1 scaling the handling by the hopper's fill
 * fraction through hopperFillFraction), turn the reverse-engage flag into EV.ReverseBeeper, apply kerb
 * crossings (step 9), then the hazard contacts at the integrated pose (step 10: pothole and speed-bump jolts
 * with their HP and LU spills, the open manhole's hard stop; hazards.ts). Apart from those spills, the hopper
 * changes only in phases 5 (collection) and 10 (dump drain), so this phase sees last tick's fill.
 */
function phaseVehicle(world: World): void {
  const v = world.vehicle;
  const sweeper = world.tuning.vehicle.sweeper;
  stepBrushState(world.brush, v, world.input, world.hopper.full);
  sampleSurface(world.level, world.surfaceTable, sweeper, v, world.surface, world.hazards.surfaceOverride);
  stepVehicle(v, world.input, world.surface, world.vehicleParams);
  if (v.reverseEngaged) {
    const e = emitEvent(world.events, EV.ReverseBeeper, -1);
    world.events.a[e] = v.xM;
    world.events.b[e] = v.yM;
  }
  applyKerbCrossings(world, sweeper);
  stepHazardContacts(world.hazards, v, sweeper, world.hopper, world.litter, world.events);
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
// without touching stepWorld; phases 4 and 8 intentionally do nothing until M3.

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
 * Phase 5 (SSP-065): brush, litter and water, against Bessie's pose after phase 3.
 *   1. beginLitterTick: prevX/prevY for render interpolation, before anything moves litter this tick.
 *   2. stepBrushLitter (brush.ts): while the brush collects, the fling roll, the bulldozer at a full hopper,
 *      inlet collection (EV.LitterCollected, addToHopper, maybe EV.HopperFull) and the gutter and suction
 *      pushes; otherwise it clears the brush flags it left.
 *   3. The brush-up rules, only while the brush is Raised: leaf piles driven through become haz.wet_leaves
 *      (stepBrushUpLeaves, hazards.ts, SSP-093), then dog mess becomes stain.splat with its −20 through
 *      scoring's penalty hook (stepBrushUpSplats, stains.ts).
 *   4. stepLitter: fling arcs, this tick's pushes and drift.
 *   5. stepWater: the hydrant refill, then the spray (it touches no litter, so its place in the phase changes
 *      nothing but the order of its reads).
 */
function phaseBrushLitter(world: World): void {
  const sweeper = world.tuning.vehicle.sweeper;
  const litter = world.litter;
  beginLitterTick(litter);
  stepBrushLitter(world.brush, litter, world.vehicle, world.hopper, world.events);
  stepBrushUpLeaves(world.hazards, litter, world.brush, world.vehicle, sweeper);
  stepBrushUpSplats(world.stains, litter, world.brush, world.vehicle, sweeper);
  stepLitter(litter);
  stepWater(world.water, world.input);
}

/**
 * Phase 6 (SSP-065): dirt. stepDirt erases the grime under the footprint (and, for a brush hugging a kerb, the
 * gutter grime under it) while the brush collects (isBrushCollecting, as phase 5 recorded it in brush.collecting), and records the tick's cleaned cells, Kerb Hugger contact
 * and dirty rectangle; then cleanStainsInCone gives every stain in this tick's spray cone one tick of spray
 * (EV.StainCleaned when one comes clean). Dust is M3.
 */
function phaseDirt(world: World): void {
  // brush.collecting is isBrushCollecting as phase 5's brush step found it; nothing between changes it (the
  // step may switch Collecting to Bulldozing, which still collects).
  stepDirt(world.dirt, world.vehicle, world.brush.collecting);
  cleanStainsInCone(world.water, world.stains, world.events);
}

/**
 * Phase 7 (SSP-080; npc/npcAi.ts has the detail): NPC AI against Bessie's pose after phase 3.
 *   1. beginNpcTick: prevX/prevY for render interpolation, before anything moves an NPC this tick.
 *   2. updateViewRect: world.viewRect from Bessie's pose and velocity.
 *   3. stepNpcSpawner: named NPCs due; on every 60th tick the cats and flocks still to place and the ambient
 *      population (at most 2 spawns or retirements), all off the view rect except named arrivals.
 *   4. deliverStimuli: the queued Horn, Spray, Hit, NearMiss, HiVis and BeaconYield stimuli, in push order.
 *   5. perceiveNpcs: the perception query of every NPC with index mod 4 == tick mod 4.
 *   6. tickNpcBehaviours: each NPC's behaviour tick, in index order (behaviours steer with npc/steering.ts).
 *   7. updateZebraOccupancy: how many NPCs stand on each zebra (world.zebras), for phases 8 and 9.
 * The litterbug behaviour flags a honk that lands its Caught! with markHornCaught (complaints.ts, SSP-078), so
 * phase 9 does not count it toward horn spam; SSP-082 delivers EV.Horn to the NPCs.
 */
function phaseNpc(world: World): void {
  beginNpcTick(world.npc);
  updateViewRect(world.viewRect, world.vehicle);
  stepNpcSpawner(world);
  deliverStimuli(world);
  perceiveNpcs(world);
  tickNpcBehaviours(world);
  updateZebraOccupancy(world);
}

/** Phase 8: traffic. SSP-089. */
function phaseTraffic(_world: World): void {
  // Filled by SSP-089.
}

/**
 * Phase 9 (SSP-065, SSP-078): complaints, scoring and combo, then Tidy %. stepHornSpam counts this tick's honk
 * (unless phase 7 flagged it Caught!) and may record a Noise fact; applyPenalties consumes the tick's penalty
 * facts in order (their points to scoring's penalty API, their complaints to the meter with EV.Complaint each,
 * the police-witness hook); stepScoring reads this tick's facts (the chain timer, frozen while a dump drains;
 * EV.LitterCollected and EV.StainCleaned in emission order; the Dirt's cleaned cells and Kerb Hugger contact),
 * then applies the penalties' points and resets the chain after the pickups; stepTidy recomputes the frontages
 * whose counters moved, awards Clean Sweeps through the bonus API and updates Tidy % and the stars. The drain
 * state is read before phase 10 runs.
 */
function phaseScoring(world: World): void {
  stepHornSpam(world.complaints, world.penalties, world.vehicle, world.tick);
  applyPenalties(world.complaints, world.penalties, world.scoring, world.events);
  stepScoring(world.scoring, world.events, world.dirt, isShiftDraining(world.shift));
  stepTidy(world.tidy, world.dirt, world.litter, world.scoring);
}

/**
 * Phase 10 (shift.ts, SSP-062): TOWED (the first tick that ends with HP at 0, §9.2 step 6), the timer's rollout
 * start, the dump FSM (depot bays and skips: hopper drain, depot water refill, EV.DumpStart/EV.DumpEnd), the
 * countdown and the knock-off, ending in EV.ShiftEnd (TOWED or TIME_UP) once. SACKED is SSP-079 (M3).
 */
function phaseShiftTimer(world: World): void {
  stepShift(world.shift, world.input, world.events);
}
