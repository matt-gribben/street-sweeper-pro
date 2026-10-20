// Traffic (TECHNICAL_DESIGN §11.4, ENTITY_CATALOG §8.2–§8.3, LEVEL_DESIGN §9.5; SSP-089): tick phase 8. Moving
// vehicles live in the vehicle store (vehicleStore.ts) and follow the compiled lane graph (map.ts LaneGraph).
// Units are metres, seconds and radians; heading 0 = north, forward = (sin h, −cos h), clockwise.
//
// Each tick (stepTraffic), in order:
//   1. Bessie's body OBB corners (tuning.json vehicle.sweeper.body) and every vehicle's corners are refreshed.
//   2. The bus schedule: a scheduled bus falls due at streetLife.traffic.firstBusS and every busEveryS after it
//      (one waiting at most: a bus that cannot enter yet is the next one, so buses never bunch at the portal).
//   3. Every vehicle drives, in index order (driveVehicle, below).
//   4. Vehicles that have left the map through an exit portal and are off world.viewRect are despawned.
//   5. At most one vehicle spawns at an entry portal (a due bus first), off world.viewRect.
//   6. The spatial lookup is rebuilt (rebuildVehicleGrid), for collision (SSP-090) and render culling (SSP-103).
//
// Following the lane graph. A vehicle holds a plan of lane edges (vehicleStore.ts `plan`): the edge under its
// rear bumper, then the ones it will drive, topped up to LOOKAHEAD_M (plus its length) ahead of its front. A
// scheduled bus takes them from the bus route (entry portal → busRoute anchors → the nearest exit portal,
// shortest paths computed at shift start); every other vehicle chooses at each node uniformly among the edges
// leaving it, on the `traffic` stream, never a U-turn while another way exists. `along` is the centre's distance
// along the polyline from plan[0]'s `from` node. The centre sits on the lane polyline and the body points along
// the chord between the path points half a length behind and ahead of it (so it turns smoothly through junction
// connectors without swinging its tail out).
//
// Speed. Each tick a vehicle's target speed is the least of: the speed limit of the edge it is on; for each edge
// ahead, the speed from which it can still brake to that edge's limit at its start; and the stops below. Its
// speed then rises towards the target by at most accelMps2 × dt and falls to it at once (traffic is kinematic).
// Braking follows TECHNICAL_DESIGN §11.4's constant-deceleration rule with b = followDecelMps2 (3.0 m/s²):
//   - behind an obstacle (Bessie, or another vehicle, projected onto the plan): with `gap` the free distance from
//     the front bumper to the nearest part of the obstacle inside the vehicle's corridor (its path from its
//     centre, half its width + CORRIDOR_MARGIN_M either side; quadRectMinU per edge), vMax = sqrt(2b · max(0, gap − followGapM)), and never more than
//     the vehicle can cover in one tick without closing inside followGapM, so it stops with gap ≥ followGapM;
//   - at a stop line (front bumper on the line): vMax = sqrt(2b · d) for d the distance to it, capped the same
//     way (and 0 within STOP_SNAP_M). Stop lines: an OCCUPIED zebra (world.zebras.occupancy, SSP-081; the line is the `from` node of the
//     first ZEBRA edge, LEVEL_DESIGN §7.5), a school crossing while schoolCrossingStop says so (a hook; never
//     until SSP-213's lollipop lady), a junction box another vehicle holds (below), a bus's own bus stop (below)
//     and the end of a lane with no way on. A vehicle whose front is already more than STOP_COMMIT_M past a
//     line carries on.
//
// Junction boxes. The edges flagged JUNCTION or ROUNDABOUT form boxes (one per junction or mini-roundabout). A
// vehicle reserves the next box on its plan once its front is within its braking distance + RESERVE_M of the
// entry, with room to leave it (a yellow box: never behind a standing obstacle that would leave it inside), and
// only for a connector that conflicts with no holder's (connectors conflict when they merge or pass within
// CONFLICT_GAP_M; a roundabout ring admits one vehicle at a time), up to BOX_SLOTS holders. Otherwise the entry,
// ENTRY_SETBACK_M short of the entry node, is a stop line. The first vehicle a holder turns away claims the box,
// and no one may take it on a connector that conflicts with the claim, so a turn across a busy stream is never
// starved. A vehicle releases the box once it is no longer on its plan and its body has left the box's rect. On
// a box's connectors a vehicle ignores the noses of vehicles waiting at its entries (only holders drive in), so
// vehicles from conflicting arms never meet inside a junction. Give-way priority is not modelled: among the
// vehicles asking on the same tick, store order decides. A 7.25 m bus turning through a 3-tile junction can
// still sweep the queue on the next arm (buses run on main roads).
//
// Buses (ENTITY_CATALOG §8.2): a bus (behaviour `bus`) stops with its front at the last node of each run of
// BUS_STOP edges on its plan and dwells there entities.json veh.bus rules.stopDwellS (5 s = 300 ticks), then
// goes on; it never stops at the same stop twice in a row (`servedStop`).
//
// The state machine (ENTITY_CATALOG §8.3): Cruise → Queue (held below blockedBelowMps by something ahead:
// Bessie, a vehicle, a stop line) → Honk (held by Bessie for honkAfterBlockedS, 3 s) → RoadRage (held by Bessie
// for more than complaints.roadRage.afterBlockedS, 10 s) → Cruise once the path clears; a bus at its stop is in
// Dwell. Only the head of a queue (the vehicle Bessie herself holds) keeps the block timer, so a queue is one
// timer: `blockTicks` counts the ticks of the current block from 1; on blockTicks 180, 360 and 540 it emits
// EV.CarHorn (honk 1, 2, 3: AUDIO_DESIGN §5.5's rising honks at 3, 6 and 9 s) and on blockTicks 601 it records
// one Road Rage penalty fact (complaints.roadRage.complaints, at Bessie's position; phase 9 files it). The
// block ends, and the timer resets, once Bessie has not held it for clearAfterS; a block that has filed its
// complaint files no other, however long it lasts. Car honks are not Bessie's horn: they never touch the horn
// window (complaints.ts) and are never delivered to the NPCs as a Horn stimulus.
//
// Spawning (LEVEL_DESIGN §9.5): only at entry portals (PORTAL_IN edges), with the whole body outside the map
// (front bumper on the portal node) and its OBB off world.viewRect, and only where the road ahead is clear of
// Bessie and every vehicle for followGapM plus its braking distance from the speed limit, at which it enters.
// The moving target is the compiled `spawns.traffic.moving` (⌈densityPerKm × lane-km⌉; scheduled buses come on
// top), never more than capacity − parked (30 − parked); kinds by `mix` weight, the portal uniformly among the
// ones the kind fits, on the `traffic` stream. Despawning only once a vehicle has driven past its exit portal
// (EXITING) and its OBB is off world.viewRect.
//
// Bessie (SSP-090, TECHNICAL_DESIGN §9.4). Traffic is kinematic and stops: phase 3 resolves Bessie against
// every vehicle as against static geometry, and here a vehicle whose move this tick would overlap her body
// (the candidate pose at along + v·dt, cornersOverlap) does not move: its speed is 0 and it is held by Bessie
// (Blocker.Bessie, gap 0), so a vehicle she pins from the side queues and honks like one she blocks ahead.
// Parked cars (parked.ts) are in the store too: they never drive, and moving vehicles follow them like any
// other vehicle in their corridor (the compiled lanes swing clear of the parking bays, laneGraph.ts).
//
// The kerb gap check (TECHNICAL_DESIGN §11.1): trafficCrossingClear is the steering hook SSP-081 left
// (createWorld installs it). A pedestrian at the kerb of a crossing waits while any moving vehicle's body is on
// the crossing, or while one is coming: at a zebra, closer than it can stop in plus ZEBRA_REACTION_S of travel
// (a standing vehicle never holds a zebra: it waits for the occupancy); at any other crossing, closer than
// crossingGapS of travel plus followGapM.
//
// The special kinds (SSP-091, ENTITY_CATALOG §8.2; numbers in entities.json rules, for owner review):
//   - Taxi (behaviour `taxi`): it drives a seeded fareStopMinM..fareStopMaxM (30–90 m, one `traffic` draw at
//     spawn and after each fare) and then stops abruptly for a fare, braking at fareStopDecelMps2 (6 m/s², twice
//     the car-following 3.0 m/s²: the rear-end trap for a sweeper following it) to a standstill in its lane, where it
//     stands fareStopDwellS (3 s) in TrafficState.FareStop before driving on. It only starts a stop where it holds no
//     junction box and the road from its rear to where it would stop is a plain lane (no junction, roundabout,
//     zebra, school crossing, bus stop, give-way, portal or turn-around edge); otherwise it keeps looking. Taxis
//     behind it queue as behind any vehicle; Bessie behind it is not blocking it, so no block timer runs.
//   - White van (behaviour `van_white`): a moving one drives like a car; a parked one stands half on the
//     pavement (parked.ts).
//   - Bicycle (behaviour `bicycle`, collision `actor`): it rides at its own entities.json speed (8 m/s, faster
//     than the 7 m/s residential limit) whatever the road class, except on a junction box's edges, where the
//     box's lower limit holds (bikeEdgeSpeed). It **filters**: with traffic (or Bessie) slower than
//     filterBelowMps (5 m/s) within FILTER_LOOK_M ahead in its lane, it moves sideways at filterLateralMps
//     (1.5 m/s) to filterOffsetM (1.5 m) right of its lane, between the lanes, and rides past; it merges back
//     once the lane beside it is clear for followGapM either side of its body. It never moves sideways into a
//     body (the body at the new offset must touch no vehicle and not Bessie), and its corridor is taken at its
//     offset, so it follows whatever is in it. Filtering is allowed only on `edgeFilter` edges (setup,
//     filterEdges): straight lane edges at least FILTER_BOX_CLEAR_M from any junction box, with the kerb (or the
//     oncoming lane, which must be at least filterOffsetM + the bike's half width + the widest lane kind's half
//     width away) clear of the bike at its offset and no parking bay under it, and every edge within
//     FILTER_BUFFER_M before and after the same; a filtering bike stops (Blocker.Merge) MERGE_SETBACK_M short of
//     the first edge that is not, until it can merge. Between a filtering bike and any vehicle the corridors take
//     no CORRIDOR_MARGIN_M (the edges there are straight, so a body never leaves its corridor), which is what lets
//     a bike pass a queued bus or meet an oncoming one on a 3-tile two-way road (lanes 3 m apart).
//   - Mobility scooter (behaviour `mobility_scooter`, collision `actor`; VEHICLE_FLAG.PAVEMENT): a vehicle-store
//     vehicle (it counts in the 30) that follows the pavement nav graph instead of the lane graph, at its
//     entities.json speed (1.5 m/s). `spawns.traffic.pavement` sets how many of each are out at once: one spawns
//     at most every PAVEMENT_SPAWN_EVERY_TICKS ticks, at a nav node off world.viewRect within NPC_DESPAWN_M
//     (40 m) of Bessie (uniform on the `traffic` stream), and one beyond NPC_DESPAWN_M and off the view leaves on
//     the same beat, as the ambient NPCs are recycled (npc/spawner.ts). It wanders: at each node it takes a usable
//     edge uniformly, never straight back unless there is no other. A usable edge (`navEdgeOk`,
//     initPavementTraffic) is not a crossing (it stays on the pavement) and its swept body is clear of the static
//     world (props, buildings, parked cars, a van half on the pavement). It stops PAVEMENT_GAP_M short of a
//     pedestrian ahead (Blocker.Pedestrian), and does not move into Bessie or another vehicle; held for
//     rules.turnRoundS (3 s) it turns round on its edge.
//   - Actor hits (stepActorVehicles, first in the phase, ENTITY_CATALOG §3.2): Bessie's body is not resolved
//     against an actor in phase 3 (resolveStatic skips them); here, when her OBB overlaps a bicycle's or a mobility
//     scooter's, a contact episode starts unless its ignore window is open or it is Fallen (the NPC rule of
//     npc/reactions.ts): her closing speed toward it (her velocity at its centre, along the separating axis from
//     her to it) at or above streetLife.actorHit.minClosingSpeedMps (1.0 m/s) is a hit: the entities.json `hit`
//     penalty fact (Offence.Hit: bicycle −250 and 1 complaint, mobility scooter −500 and 2; phase 9 files it and
//     resets the chain), EV.VehicleHit, and the rider falls: TrafficState.Fallen for the pedestrian fall and get-up
//     (97 ticks), then Angry, shaking a fist (54 ticks), standing still, then on. Slower, it is a bump: nothing but
//     the count. Either way the window opens for actorHit.ignoreContactS and refills while she overlaps it.
//
// Hot path: everything except createTraffic and setTrafficTuning allocates nothing, and no double crosses a
// call: positions and results go through the `sc` scratch array and the store's columns, the tuning numbers the
// tick needs are copied into `params`, and per-tick code calls no Math builtin on a cold path (TECHNICAL_DESIGN
// §17, traps 1, a and b; tests/unit/trafficAlloc.test.ts).

import { queryStatic, type StaticGrid, staticContact } from './collision/grid.ts';
import type { Aabb } from './collision/obb.ts';
import { createAabb, createObb, type Obb, obbAabb, refreshObbAxes } from './collision/obb.ts';
import { type Contact, createContact, obbVsObb } from './collision/sat.ts';
import { Offence } from './complaints.ts';
import { DT_S, SIM_HZ, TILE_M } from './constants.ts';
import { type Entities, VEHICLE_IDS } from './entities.ts';
import { EV, emitEvent } from './eventQueue.ts';
import { atan2, cos, sin, sqrt, sqrtAt } from './fmath.ts';
import { Ground, LANE_FLAG, type LaneGraph, type Level, NAV_FLAG, NAV_FLAG_CROSSING } from './map.ts';
import { ANGRY_TICKS, FALLEN_TICKS, GET_UP_TICKS } from './npc/behaviours/pedestrian.ts';
import { NPC_DESPAWN_M } from './npc/spawner.ts';
import type { CrossingGapCheck, Zebras } from './npc/steering.ts';
import { NPC_FLAG, queryNpcs } from './npc/store.ts';
import { pushPenalty } from './penalties.ts';
import { createStream, nextInt, type Sfc32 } from './rng.ts';
import type { Tuning } from './tuning.ts';
import {
  addVehicle,
  Blocker,
  rebuildVehicleGrid,
  removeVehicle,
  updateVehicleCorners,
  VEHICLE_CORNER_DOUBLES,
  VEHICLE_FLAG,
  VEHICLE_PLAN_EDGES,
  type VehicleStore,
} from './vehicleStore.ts';
import type { ViewRect } from './viewRect.ts';
import type { World } from './world.ts';

/** A traffic vehicle's state (vehicleStore.ts `state`; ENTITY_CATALOG §8.3). Hashed: append, never renumber. */
export const TrafficState = {
  /** Following the lane graph at (or towards) the speed limit. */
  Cruise: 0,
  /** Held below blockedBelowMps by something ahead: Bessie, a vehicle, a stop line. */
  Queue: 1,
  /** Held by Bessie for honkAfterBlockedS or more: honking. */
  Honk: 2,
  /** Held by Bessie for more than complaints.roadRage.afterBlockedS: the complaint is filed. */
  RoadRage: 3,
  /** A bus standing at its bus stop. */
  Dwell: 4,
  /** A taxi braking hard for a fare, then standing while the fare gets in (SSP-091). */
  FareStop: 5,
  /** An actor (bicycle, mobility scooter) Bessie hit: falling over and getting up (SSP-091). */
  Fallen: 6,
  /** An actor back on its feet, shaking a fist before it rides on (SSP-091). */
  Angry: 7,
} as const;
export type TrafficState = (typeof TrafficState)[keyof typeof TrafficState];

/** How far ahead of its front bumper a vehicle plans and looks, metres (braking from 9 m/s takes 13.5 m). */
export const LOOKAHEAD_M = 40;
/** Extra width of a vehicle's corridor on each side of its body, metres. */
export const CORRIDOR_MARGIN_M = 0.1;
/** A vehicle whose front is more than this past a stop line carries on through it, metres. */
export const STOP_COMMIT_M = 0.5;
/** A vehicle reserves a junction box within its braking distance plus this of the entry, metres. */
export const RESERVE_M = 3;
/**
 * A vehicle waiting to enter a junction box stops this far short of the box's entry node, metres: clear of the
 * bodies turning through the box (a bus's sweeps the corner of a 3-tile junction).
 */
export const ENTRY_SETBACK_M = 1.5;
/** A junction box's rect is its nodes' bounding box grown by this, metres (half a lane). */
const BOX_MARGIN_M = 1;
/** Vehicles that may hold one junction box at once, on connectors that do not conflict. */
export const BOX_SLOTS = 4;
/**
 * Two junction connectors conflict when they share their `to` node (a merge) or pass within this of each other,
 * metres: two bus half widths plus a margin, so no two bodies on non-conflicting connectors can meet.
 */
export const CONFLICT_GAP_M = 2.6;
/** Numerical slack: a following vehicle stops this far outside followGapM, metres. */
const GAP_EPS_M = 1e-6;
/** Closer than this to where it must stop, a vehicle stands still, metres. */
const STOP_SNAP_M = 1e-9;
/** A bus whose front is within this of its stop has arrived, metres. */
const ARRIVE_EPS_M = 1e-9;
/** The zebra kerb check's reaction allowance: a moving vehicle this many seconds away is too close. */
const ZEBRA_REACTION_S = 1;
/** The kerb check's crossing corridor reaches this far either side of the crossing's line, metres. */
export const CROSSING_HALF_WIDTH_M = 1;
/** A bicycle looks this far ahead in its lane for slow traffic to filter past, metres (SSP-091). */
export const FILTER_LOOK_M = 20;
/** No filtering on a lane edge with an end within this of a junction box's rect, metres. */
export const FILTER_BOX_CLEAR_M = 4;
/** …nor on one within this of such an edge along its lane (the longest body, a 7.25 m bus, and a margin), metres. */
export const FILTER_BUFFER_M = 8;
/** The kerb (or bay) must be this far beyond a filtering bike's body, metres. */
export const FILTER_KERB_MARGIN_M = 0.05;
/** A filtering bicycle stops this far short of the first edge it may not filter on, metres. */
export const MERGE_SETBACK_M = 0.5;
/** A pavement vehicle tries one spawn and one retirement every this many ticks (the NPC spawner's beat). */
export const PAVEMENT_SPAWN_EVERY_TICKS = 60;
/** A pavement vehicle stops this far short of a pedestrian ahead, metres. */
export const PAVEMENT_GAP_M = 0.3;
/** A pedestrian within this of a pavement vehicle's sides (beyond its radius) is in its way, metres. */
const PAVEMENT_SIDE_M = 0.05;
/** A pavement vehicle looks this far ahead of its front for pedestrians, metres. */
const PAVEMENT_LOOK_M = 3;

// Indices into Traffic.sc, the per-call scratch.
/** pointAlong: in, the arc from the centre; out, the point and its edge's direction. */
const ARG = 0;
const PX = 1;
const PY = 2;
const DX = 3;
const DY = 4;
/** scanObstacle: out, the obstacle's arc from the centre. */
const HIT_ARC = 5;
/** scanObstacle: in, the corridor half width and the vehicle's half length. */
const HALF_W = 6;
const HALF_L = 7;
/** The corridor rect of one segment (lo ≤ u ≤ hi, |n| ≤ hw). */
const LIM_UHI = 8;
const LIM_ULO = 9;
const LIM_N = 10;
/** The path's bounding box (min x, min y, max x, max y). */
const BX0 = 11;
const BY0 = 12;
const BX1 = 13;
const BY1 = 14;
/** stopSpeed: in, the deceleration; out, the speed. */
const DECEL = 15;
const OUT = 16;
/** boxCorners: in, a box's centre, unit forward, half width and half length. */
const BOX_CX = 17;
const BOX_CY = 18;
const BOX_FX = 19;
const BOX_FY = 20;
const BOX_HW = 21;
const BOX_HL = 22;
/** scanObstacle: out, the plan edge the obstacle was found on. */
const HIT_EDGE = 23;
/** quadRectMinU: out, the least u. */
const HIT_U = 24;
/** cornerBounds: out, a box's bounding box. */
const CB_X0 = 25;
const CB_Y0 = 26;
const CB_X1 = 27;
const CB_Y1 = 28;
/** scanObstacle: in, the scanning vehicle's lateral offset (right of its lane, metres). */
const OFF_N = 29;
/** Pavement vehicles and actor contacts: a direction, a centre and a cap. */
const UX = 30;
const UY = 31;
const CAP = 32;
/** bodyAt: in, the lateral offset and how much to grow the half width and half length by. */
const LAT_ARG = 33;
const GROW_W = 34;
const GROW_L = 35;
/** driveVehicle's speed-limit braking: in, v² + 2bd; out (sqrtAt), its square root (SSP-106). */
const LIMIT_V = 36;
/** placeVehicle, bodyAt: in, the chord's squared length; out (sqrtAt), its length (SSP-106). */
const CHORD_LEN = 37;
const SCRATCH_DOUBLES = 38;

// Indices into Traffic.params: the tuning numbers the tick reads, copied off the tuning (TECHNICAL_DESIGN §17:
// tuning objects hold tagged numbers, so a tick reading them boxes).
const P_ACCEL = 0;
const P_DECEL = 1;
const P_GAP = 2;
const P_SLOW = 3;
const P_CROSS_GAP_S = 4;
const P_BESSIE_HW = 5;
const P_BESSIE_HL = 6;
/** SSP-091: the taxi's fare stop, the bicycle's filtering, the scooter's speed, the actor-hit closing speed. */
const P_FARE_MIN = 7;
const P_FARE_SPAN = 8;
const P_FARE_DECEL = 9;
const P_FILTER_OFF = 10;
const P_FILTER_BELOW = 11;
const P_FILTER_LAT = 12;
const P_MIN_CLOSING = 13;
const P_REAR_AXLE = 14;
const PARAM_DOUBLES = 15;

/** The mix draw's resolution: a kind is drawn as nextInt(rng, MIX_STEPS) over the weights (parked.ts too). */
export const MIX_STEPS = 1 << 20;

/** May vehicles drive over school crossing edge `edge` now? The SSP-213 hook; neverStopForSchoolCrossing until then. */
export type SchoolCrossingCheck = (w: World, edge: number) => boolean;

/** The school-crossing hook until SSP-213 (no lollipop lady yet): never a stop. */
export const neverStopForSchoolCrossing: SchoolCrossingCheck = () => false;

/** Phase 8's state beside the vehicle store. Create with createTraffic. */
export type Traffic = {
  /** The level has a traffic spec and a lane graph: spawning runs. */
  readonly active: boolean;
  /** The `traffic` stream, sfc32(seed ^ hash32('traffic')): kinds, portals and turns. */
  readonly rng: Sfc32;
  /** The compiled moving-vehicle target (spawns.traffic.moving). */
  readonly movingTarget: number;
  /** The mix: VEHICLE_IDS indices and weights. */
  readonly mixCount: number;
  readonly mixKind: Uint8Array;
  readonly mixWeight: Float64Array;
  readonly mixTotal: number;
  /** The PORTAL_IN edges, ascending. */
  readonly portalCount: number;
  readonly portalEdge: Int32Array;
  /** Per lane edge: length, unit direction, the zebra of its `to` node (world.zebras index, −1) and its box. */
  readonly edgeLen: Float64Array;
  readonly edgeDirX: Float64Array;
  readonly edgeDirY: Float64Array;
  readonly edgeZebra: Int16Array;
  readonly edgeBox: Int16Array;
  /**
   * Junction boxes: BOX_SLOTS holder slots per box (the holder's uid, −1 free, and the connector it holds the
   * box for), whether the box admits one vehicle at a time (a mini-roundabout ring), and the rect, metres.
   */
  readonly boxCount: number;
  readonly boxHolder: Int32Array;
  readonly boxHolderEdge: Int32Array;
  /**
   * Per box, the claim of the vehicle that has waited longest at its entry for a conflicting holder to leave
   * (its uid, −1 none, and its connector): no one else may take the box on a connector that conflicts with the
   * claim, so a turn across a busy stream is never starved.
   */
  readonly boxClaim: Int32Array;
  readonly boxClaimEdge: Int32Array;
  readonly boxExclusive: Uint8Array;
  /** Per lane edge, the junction connectors of its box it conflicts with (CSR: conflictStart, conflictEdge). */
  readonly conflictStart: Int32Array;
  readonly conflictEdge: Int32Array;
  readonly boxMinX: Float64Array;
  readonly boxMinY: Float64Array;
  readonly boxMaxX: Float64Array;
  readonly boxMaxY: Float64Array;
  /** Per VEHICLE_IDS index: 1 when the kind dwells at bus stops (behaviour `bus`). */
  readonly kindDwells: Uint8Array;
  /** Ticks a bus dwells at a stop (veh.bus rules.stopDwellS × 60). */
  readonly dwellTicks: number;
  /** VEHICLE_IDS index of veh.bus. */
  readonly busKind: number;
  /** The scheduled bus's whole route as lane edges (portal in … portal out); length 0 without one. */
  readonly busRoute: Int32Array;
  readonly busRouteLen: number;
  /** Ticks between scheduled buses (0 without a route) and the tick the next one falls due. */
  readonly busEveryTicks: number;
  nextBusTick: number;
  /** Scheduled buses due but not yet spawned, and spawned so far. */
  busesDue: number;
  busesSpawned: number;
  /** Car honks (EV.CarHorn) and Road Rage penalty facts this shift. */
  carHorns: number;
  roadRageOffences: number;
  /** Parked-car dents this shift (parked.ts, phase 3). */
  dents: number;
  /** Vehicle ticks held still because the move would have overlapped Bessie (the §9.4 stop, SSP-090). */
  contactStops: number;
  /** A parked car's dent contact episode ends after this many untouched ticks (streetLife.traffic.dentRearmS). */
  dentRearmTicks: number;
  /** The school-crossing stop hook (SSP-213). */
  schoolCrossingStop: SchoolCrossingCheck;
  /** VEHICLE_IDS index of veh.taxi and of veh.bicycle (SSP-091). */
  readonly taxiKind: number;
  readonly bicycleKind: number;
  /** Ticks a taxi stands at a fare stop (veh.taxi rules.fareStopDwellS × 60). */
  readonly fareDwellTicks: number;
  /** Per VEHICLE_IDS index: 1 for a pavement vehicle kind (behaviour `mobility_scooter`). */
  readonly kindPavement: Uint8Array;
  /** Per VEHICLE_IDS index: the entities.json fixed speed (m/s), 0 where the lane limit sets it. */
  readonly kindSpeedMps: Float64Array;
  /** Per VEHICLE_IDS index: a pavement kind's turn-round wait (rules.turnRoundS × 60), 0 otherwise. */
  readonly kindTurnTicks: Int32Array;
  /** An actor's fall and get-up, then its fist shake, ticks (the pedestrian's, npc/behaviours/pedestrian.ts). */
  readonly fallTicks: number;
  readonly angryTicks: number;
  /** The actor contact ignore window, ticks (streetLife.actorHit.ignoreContactS × 60). */
  actorIgnoreTicks: number;
  /** Per lane edge, a bicycle's speed limit: its own speed, or a junction box edge's lower limit. */
  readonly bikeEdgeSpeed: Float64Array;
  /** Per lane edge: 1 where a bicycle may ride filtering (filterEdges). */
  readonly edgeFilter: Uint8Array;
  /** The pavement vehicles out at once (spawns.traffic.pavement): kinds (VEHICLE_IDS) and counts. */
  readonly pavementKinds: number;
  readonly pavementKind: Uint8Array;
  readonly pavementWant: Uint16Array;
  /** Per nav edge: 1 where a pavement vehicle may drive it (initPavementTraffic); per nav node, its usable edges. */
  readonly navEdgeOk: Uint8Array;
  readonly navNodeWays: Uint16Array;
  /**
   * Per nav edge: its length, and the heading of a body driving it from edgeFrom to edgeTo and back (setup, so
   * the tick passes no double to a call: TECHNICAL_DESIGN §17 trap 1).
   */
  readonly navEdgeLen: Float64Array;
  readonly navHeadingFwd: Float64Array;
  readonly navHeadingBack: Float64Array;
  /** Fare stops, actor hits and actor bumps this shift (SSP-091). */
  fareStops: number;
  actorHits: number;
  actorBumps: number;
  /** NPC query results for the pavement vehicles' look ahead (the NPC store's capacity; initPavementTraffic). */
  npcFound: Int32Array;
  /** Scratch OBBs (pavement setup's swept body; an actor contact's Bessie and actor), a query box, a contact. */
  readonly obb: Obb;
  readonly obb2: Obb;
  readonly box: Aabb;
  readonly contact: Contact;
  /** The tuning numbers the tick reads (setTrafficTuning): acceleration, deceleration, gaps, Bessie's body. */
  readonly params: Float64Array;
  /** The block timer in ticks: the honk interval (3 s), Road Rage (more than 10 s), the clear (0.5 s). */
  honkTicks: number;
  rageTicks: number;
  clearTicks: number;
  /** Complaints a Road Rage block files (complaints.roadRage.complaints). */
  rageComplaints: number;
  /** Scratch: doubles, Bessie's corners, eligible portals, removals. */
  readonly sc: Float64Array;
  readonly bessieCorners: Float64Array;
  /** A spawn candidate's body and the clear road it needs ahead of it (obbCorners order). */
  readonly spawnCorners: Float64Array;
  readonly clearCorners: Float64Array;
  /** The kerb check's crossing corridor. */
  readonly crossCorners: Float64Array;
  /** An obstacle's corners in a corridor segment's (u, n) frame. */
  readonly quad: Float64Array;
  /** A vehicle's body at the end of its candidate move (the stop-before-Bessie check). */
  readonly moveCorners: Float64Array;
  readonly eligible: Int32Array;
  readonly doomed: Uint8Array;
};

/** What render, audio, UI and tests may see: the same object, typed read-only. */
export type TrafficView = {
  readonly active: boolean;
  readonly movingTarget: number;
  readonly boxCount: number;
  readonly boxHolder: Int32Array;
  readonly boxHolderEdge: Int32Array;
  readonly busRouteLen: number;
  readonly busesDue: number;
  readonly busesSpawned: number;
  readonly carHorns: number;
  readonly roadRageOffences: number;
  readonly dents: number;
  readonly contactStops: number;
  readonly fareStops: number;
  readonly actorHits: number;
  readonly actorBumps: number;
  readonly edgeFilter: Uint8Array;
  readonly navEdgeOk: Uint8Array;
};

// ---------------------------------------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------------------------------------

/** The lane edges of a shortest path (by length) from `from` to any node with `isGoal`, or null. Setup only. */
function shortestLanePath(
  lanes: LaneGraph,
  edgeLen: Float64Array,
  from: number,
  isGoal: (node: number) => boolean,
): number[] | null {
  const n = lanes.nodeCount;
  const dist = new Float64Array(n).fill(Number.POSITIVE_INFINITY);
  const via = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  dist[from] = 0;
  for (;;) {
    let u = -1;
    let best = Number.POSITIVE_INFINITY;
    for (let k = 0; k < n; k += 1) {
      if (done[k] === 0 && (dist[k] as number) < best) {
        best = dist[k] as number;
        u = k;
      }
    }
    if (u < 0) return null;
    if (u !== from && isGoal(u)) {
      const edges: number[] = [];
      for (let at = u; at !== from; ) {
        const e = via[at] as number;
        edges.push(e);
        at = lanes.edgeFrom[e] as number;
      }
      return edges.reverse();
    }
    done[u] = 1;
    for (let e = lanes.outStart[u] as number; e < (lanes.outStart[u + 1] as number); e += 1) {
      const v = lanes.edgeTo[e] as number;
      const d = best + (edgeLen[e] as number);
      if (d < (dist[v] as number)) {
        dist[v] = d;
        via[v] = e;
      }
    }
  }
}

/**
 * The scheduled bus's route as lane edges: from the entry portal nearest (by lane distance) to the first
 * anchor, through every anchor in order, to the nearest exit portal. Empty when any leg cannot be driven.
 */
function buildBusRoute(lanes: LaneGraph, edgeLen: Float64Array, anchors: readonly number[]): number[] {
  if (anchors.length === 0) return [];
  const first = anchors[0] as number;
  let best: number[] | null = null;
  for (let e = 0; e < lanes.edgeCount; e += 1) {
    if (((lanes.edgeFlags[e] as number) & LANE_FLAG.PORTAL_IN) === 0) continue;
    const portal = lanes.edgeFrom[e] as number;
    const leg = portal === first ? [] : shortestLanePath(lanes, edgeLen, portal, (n) => n === first);
    if (leg === null) continue;
    const len = leg.reduce((s, x) => s + (edgeLen[x] as number), 0);
    const bestLen =
      best === null ? Number.POSITIVE_INFINITY : best.reduce((s, x) => s + (edgeLen[x] as number), 0);
    if (len < bestLen) best = leg;
  }
  if (best === null || best.length === 0) return [];
  const route = [...best];
  for (let k = 1; k < anchors.length; k += 1) {
    const a = anchors[k - 1] as number;
    const b = anchors[k] as number;
    if (a === b) continue;
    const leg = shortestLanePath(lanes, edgeLen, a, (n) => n === b);
    if (leg === null) return [];
    route.push(...leg);
  }
  const exitNodes = new Set<number>();
  for (let e = 0; e < lanes.edgeCount; e += 1) {
    if (((lanes.edgeFlags[e] as number) & LANE_FLAG.PORTAL_OUT) !== 0)
      exitNodes.add(lanes.edgeTo[e] as number);
  }
  const last = anchors[anchors.length - 1] as number;
  const out = shortestLanePath(lanes, edgeLen, last, (n) => exitNodes.has(n));
  if (out === null) return [];
  route.push(...out);
  return route;
}

/** The junction boxes: union the nodes of every JUNCTION or ROUNDABOUT edge; one box per component. */
function buildBoxes(lanes: LaneGraph): { edgeBox: Int16Array; rects: number[][] } {
  const boxBits = LANE_FLAG.JUNCTION | LANE_FLAG.ROUNDABOUT;
  const parent = Int32Array.from({ length: lanes.nodeCount }, (_, k) => k);
  const find = (k: number): number => {
    let r = k;
    while (parent[r] !== r) r = parent[r] as number;
    return r;
  };
  for (let e = 0; e < lanes.edgeCount; e += 1) {
    if (((lanes.edgeFlags[e] as number) & boxBits) === 0) continue;
    const a = find(lanes.edgeFrom[e] as number);
    const b = find(lanes.edgeTo[e] as number);
    if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
  }
  const edgeBox = new Int16Array(lanes.edgeCount).fill(-1);
  const idOfRoot = new Map<number, number>();
  const rects: number[][] = [];
  for (let e = 0; e < lanes.edgeCount; e += 1) {
    if (((lanes.edgeFlags[e] as number) & boxBits) === 0) continue;
    const root = find(lanes.edgeFrom[e] as number);
    let id = idOfRoot.get(root);
    if (id === undefined) {
      id = rects.length;
      idOfRoot.set(root, id);
      rects.push([Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, -Infinity, -Infinity]);
    }
    edgeBox[e] = id;
    const r = rects[id] as number[];
    for (const node of [lanes.edgeFrom[e] as number, lanes.edgeTo[e] as number]) {
      const x = lanes.nodeX[node] as number;
      const y = lanes.nodeY[node] as number;
      r[0] = Math.min(r[0] as number, x);
      r[1] = Math.min(r[1] as number, y);
      r[2] = Math.max(r[2] as number, x);
      r[3] = Math.max(r[3] as number, y);
    }
  }
  if (rects.length > 0x7fff) throw new Error(`createTraffic: ${rects.length} junction boxes is too many`);
  return { edgeBox, rects };
}

/** The distance between segments p0–p1 and q0–q1 (setup only). */
function segmentDistance(
  p0x: number,
  p0y: number,
  p1x: number,
  p1y: number,
  q0x: number,
  q0y: number,
  q1x: number,
  q1y: number,
): number {
  const cross = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number =>
    (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d1 = cross(q0x, q0y, q1x, q1y, p0x, p0y);
  const d2 = cross(q0x, q0y, q1x, q1y, p1x, p1y);
  const d3 = cross(p0x, p0y, p1x, p1y, q0x, q0y);
  const d4 = cross(p0x, p0y, p1x, p1y, q1x, q1y);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0;
  const toSeg = (x: number, y: number, ax: number, ay: number, bx: number, by: number): number => {
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy;
    let u = l2 > 0 ? ((x - ax) * dx + (y - ay) * dy) / l2 : 0;
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    const ex = ax + dx * u - x;
    const ey = ay + dy * u - y;
    return sqrt(ex * ex + ey * ey);
  };
  return Math.min(
    toSeg(p0x, p0y, q0x, q0y, q1x, q1y),
    toSeg(p1x, p1y, q0x, q0y, q1x, q1y),
    toSeg(q0x, q0y, p0x, p0y, p1x, p1y),
    toSeg(q1x, q1y, p0x, p0y, p1x, p1y),
  );
}

/**
 * Which junction connectors conflict (setup only). Within a box, two connectors from different lanes conflict
 * when they end at the same node or pass within CONFLICT_GAP_M of each other; connectors leaving the same lane
 * never do (their vehicles are in one queue, so car following keeps them apart). A box with a ROUNDABOUT edge
 * is exclusive: its ring is one shared road.
 */
function buildConflicts(
  lanes: LaneGraph,
  edgeBox: Int16Array,
  boxCount: number,
): { boxExclusive: Uint8Array; conflictStart: Int32Array; conflictEdge: Int32Array } {
  const boxExclusive = new Uint8Array(boxCount);
  const byBox: number[][] = Array.from({ length: boxCount }, () => []);
  for (let e = 0; e < lanes.edgeCount; e += 1) {
    const box = edgeBox[e] as number;
    if (box < 0) continue;
    byBox[box]?.push(e);
    if (((lanes.edgeFlags[e] as number) & LANE_FLAG.ROUNDABOUT) !== 0) boxExclusive[box] = 1;
  }
  const lists: number[][] = Array.from({ length: lanes.edgeCount }, () => []);
  const x = (n: number): number => lanes.nodeX[n] as number;
  const y = (n: number): number => lanes.nodeY[n] as number;
  for (const edges of byBox) {
    for (const a of edges) {
      for (const b of edges) {
        if (a === b) continue;
        const af = lanes.edgeFrom[a] as number;
        const at = lanes.edgeTo[a] as number;
        const bf = lanes.edgeFrom[b] as number;
        const bt = lanes.edgeTo[b] as number;
        if (af === bf) continue;
        if (
          at === bt ||
          segmentDistance(x(af), y(af), x(at), y(at), x(bf), y(bf), x(bt), y(bt)) < CONFLICT_GAP_M
        ) {
          lists[a]?.push(b);
        }
      }
    }
  }
  const conflictStart = new Int32Array(lanes.edgeCount + 1);
  for (let e = 0; e < lanes.edgeCount; e += 1) {
    conflictStart[e + 1] = (conflictStart[e] as number) + (lists[e]?.length ?? 0);
  }
  return { boxExclusive, conflictStart, conflictEdge: Int32Array.from(lists.flat()) };
}

/**
 * The lane edges a bicycle may ride filtering on (SSP-091; the header has the rule), setup only: a raw pass (not
 * a junction, roundabout, turn-around, give-way or portal edge; both ends clear of every junction box's rect by
 * FILTER_BOX_CLEAR_M; at the ends and the middle, the point `reach` right of the lane on a road tile outside every
 * parking bay, and every lane edge running the other way at least `spacing` away), then every edge whose lane
 * is raw for FILTER_BUFFER_M before and after it, through nodes with a single way in and out.
 */
function filterEdges(
  level: Level,
  edgeLen: Float64Array,
  dirX: Float64Array,
  dirY: Float64Array,
  boxRects: readonly (readonly number[])[],
  reach: number,
  spacing: number,
): Uint8Array {
  const lanes = level.lanes;
  const n = lanes.edgeCount;
  const raw = new Uint8Array(n);
  const [w, h] = level.size;
  const ground = level.layers.ground;
  const banned =
    LANE_FLAG.JUNCTION |
    LANE_FLAG.ROUNDABOUT |
    LANE_FLAG.U_TURN |
    LANE_FLAG.PORTAL_IN |
    LANE_FLAG.PORTAL_OUT |
    LANE_FLAG.GIVE_WAY;
  const roadAt = (x: number, y: number): boolean => {
    const tx = Math.floor(x / TILE_M);
    const ty = Math.floor(y / TILE_M);
    if (tx < 0 || ty < 0 || tx >= w || ty >= h) return false;
    const g = ground[ty * w + tx] as number;
    if (g < Ground.Road || g > Ground.RoadOneWayS) return false;
    for (const bay of lanes.bays) {
      const [x0, y0, x1, y1] = bay.rect;
      if (tx >= x0 && tx < x1 && ty >= y0 && ty < y1) return false;
    }
    return true;
  };
  const clear = BOX_MARGIN_M + FILTER_BOX_CLEAR_M;
  const nearBox = (x: number, y: number): boolean =>
    boxRects.some(
      (r) =>
        x >= (r[0] as number) - clear &&
        x <= (r[2] as number) + clear &&
        y >= (r[1] as number) - clear &&
        y <= (r[3] as number) + clear,
    );
  for (let e = 0; e < n; e += 1) {
    const len = edgeLen[e] as number;
    if (((lanes.edgeFlags[e] as number) & banned) !== 0 || !(len > 0)) continue;
    const a = lanes.edgeFrom[e] as number;
    const ax = lanes.nodeX[a] as number;
    const ay = lanes.nodeY[a] as number;
    const dx = dirX[e] as number;
    const dy = dirY[e] as number;
    // right = (−forward.y, forward.x).
    const rx = -dy;
    const ry = dx;
    let ok = !nearBox(ax, ay) && !nearBox(ax + dx * len, ay + dy * len);
    for (let q = 0; ok && q <= 2; q += 1) {
      const px = ax + dx * len * q * 0.5;
      const py = ay + dy * len * q * 0.5;
      if (!roadAt(px + rx * reach, py + ry * reach)) ok = false;
      for (let f = 0; ok && f < n; f += 1) {
        if (f === e || dx * (dirX[f] as number) + dy * (dirY[f] as number) > -0.99) continue;
        const b = lanes.edgeFrom[f] as number;
        const ox = px - (lanes.nodeX[b] as number);
        const oy = py - (lanes.nodeY[b] as number);
        const u = ox * (dirX[f] as number) + oy * (dirY[f] as number);
        if (u < -0.01 || u > (edgeLen[f] as number) + 0.01) continue;
        const d = ox * (dirY[f] as number) - oy * (dirX[f] as number);
        if ((d < 0 ? -d : d) < spacing) ok = false;
      }
    }
    raw[e] = ok ? 1 : 0;
  }
  // The single way into each node (inCount 1), and the single way out (outStart).
  const inOnly = new Int32Array(lanes.nodeCount).fill(-1);
  const inCount = new Int32Array(lanes.nodeCount);
  for (let e = 0; e < n; e += 1) {
    const to = lanes.edgeTo[e] as number;
    inCount[to] = (inCount[to] as number) + 1;
    inOnly[to] = e;
  }
  const out = new Uint8Array(n);
  for (let e = 0; e < n; e += 1) {
    if (raw[e] !== 1) continue;
    let ok = true;
    // Back along the lane.
    for (let at = lanes.edgeFrom[e] as number, d = 0; ok && d < FILTER_BUFFER_M; ) {
      if (inCount[at] !== 1) ok = false;
      else {
        const p = inOnly[at] as number;
        if (raw[p] !== 1) ok = false;
        d += edgeLen[p] as number;
        at = lanes.edgeFrom[p] as number;
      }
    }
    // On along it.
    for (let at = lanes.edgeTo[e] as number, d = 0; ok && d < FILTER_BUFFER_M; ) {
      const s0 = lanes.outStart[at] as number;
      if ((lanes.outStart[at + 1] as number) - s0 !== 1) ok = false;
      else {
        if (raw[s0] !== 1) ok = false;
        d += edgeLen[s0] as number;
        at = lanes.edgeTo[s0] as number;
      }
    }
    out[e] = ok ? 1 : 0;
  }
  return out;
}

/**
 * Phase 8's state for `level` on run `seed`: the edge tables, the junction boxes, the zebra of every ZEBRA edge
 * (`zebras`, world.zebras), the mix, the portals and the bus route and schedule. Inactive (no spawning) when the
 * level has no traffic spec. Setup only.
 */
export function createTraffic(
  level: Level,
  seed: number,
  tuning: Tuning,
  entities: Entities,
  zebras: Zebras,
): Traffic {
  const lanes = level.lanes;
  const spec = level.traffic;
  const where = `createTraffic(${level.id})`;
  const kindOf = (id: string): number => {
    const k = (VEHICLE_IDS as readonly string[]).indexOf(id);
    if (k < 0) throw new Error(`${where}: ${id} is not a vehicle kind of entities.json (VEHICLE_IDS)`);
    return k;
  };
  const edgeLen = new Float64Array(lanes.edgeCount);
  const edgeDirX = new Float64Array(lanes.edgeCount);
  const edgeDirY = new Float64Array(lanes.edgeCount);
  const edgeZebra = new Int16Array(lanes.edgeCount).fill(-1);
  for (let e = 0; e < lanes.edgeCount; e += 1) {
    const a = lanes.edgeFrom[e] as number;
    const b = lanes.edgeTo[e] as number;
    const dx = (lanes.nodeX[b] as number) - (lanes.nodeX[a] as number);
    const dy = (lanes.nodeY[b] as number) - (lanes.nodeY[a] as number);
    const len = sqrt(dx * dx + dy * dy);
    edgeLen[e] = len;
    edgeDirX[e] = len > 0 ? dx / len : 0;
    edgeDirY[e] = len > 0 ? dy / len : -1;
    if (((lanes.edgeFlags[e] as number) & LANE_FLAG.ZEBRA) !== 0) {
      const x = lanes.nodeX[b] as number;
      const y = lanes.nodeY[b] as number;
      for (let z = 0; z < zebras.count; z += 1) {
        if (
          x >= (zebras.minX[z] as number) &&
          x < (zebras.maxX[z] as number) &&
          y >= (zebras.minY[z] as number) &&
          y < (zebras.maxY[z] as number)
        ) {
          edgeZebra[e] = z;
          break;
        }
      }
    }
  }
  const { edgeBox, rects } = buildBoxes(lanes);
  const { boxExclusive, conflictStart, conflictEdge } = buildConflicts(lanes, edgeBox, rects.length);
  const portals: number[] = [];
  for (let e = 0; e < lanes.edgeCount; e += 1) {
    if (((lanes.edgeFlags[e] as number) & LANE_FLAG.PORTAL_IN) !== 0) portals.push(e);
  }
  const mix = spec?.mix ?? [];
  const mixWeight = Float64Array.from(mix, (m) => m.weight);
  let mixTotal = 0;
  for (const m of mix) mixTotal += m.weight;
  const busRoute =
    spec !== null && spec.busEveryS !== null ? buildBusRoute(lanes, edgeLen, spec.busRoute) : [];
  if (
    busRoute.length > 0 &&
    ((lanes.edgeFlags[busRoute[0] as number] as number) & LANE_FLAG.PORTAL_IN) === 0
  ) {
    throw new Error(`${where}: the bus route does not start on an entry portal edge`);
  }
  const busEveryTicks =
    busRoute.length > 0 && spec?.busEveryS != null ? Math.round(spec.busEveryS * SIM_HZ) : 0;
  const bus = entities.vehicles['veh.bus'];
  // The special kinds (SSP-091).
  const taxi = entities.vehicles['veh.taxi'];
  const bike = entities.vehicles['veh.bicycle'];
  const kindPavement = Uint8Array.from(VEHICLE_IDS, (id) =>
    entities.vehicles[id].behaviour === 'mobility_scooter' ? 1 : 0,
  );
  const kindSpeedMps = Float64Array.from(VEHICLE_IDS, (id) => entities.vehicles[id].speedMps ?? 0);
  const kindTurnTicks = Int32Array.from(VEHICLE_IDS, (id) => {
    const rules: Readonly<Record<string, number>> = entities.vehicles[id].rules;
    return Object.hasOwn(rules, 'turnRoundS')
      ? Math.max(1, Math.round((rules.turnRoundS as number) * SIM_HZ))
      : 0;
  });
  let widestHalfW = 0;
  for (const id of VEHICLE_IDS) {
    const e = entities.vehicles[id];
    if (e.behaviour === 'parked' || e.behaviour === 'mobility_scooter') continue;
    widestHalfW = Math.max(widestHalfW, e.body.widthM / 2);
  }
  const bikeSpeed = bike.speedMps;
  const bikeEdgeSpeed = Float64Array.from(lanes.edgeSpeedMps, (lim, e) => {
    if (bikeSpeed === null) return lim;
    const box = ((lanes.edgeFlags[e] as number) & (LANE_FLAG.JUNCTION | LANE_FLAG.ROUNDABOUT)) !== 0;
    return box && lim < bikeSpeed ? lim : bikeSpeed;
  });
  const bikeHalfW = bike.body.widthM / 2;
  const filterOff = bike.rules.filterOffsetM;
  const edgeFilter = filterEdges(
    level,
    edgeLen,
    edgeDirX,
    edgeDirY,
    rects,
    filterOff + bikeHalfW + FILTER_KERB_MARGIN_M,
    filterOff + bikeHalfW + widestHalfW,
  );
  const pavement = spec?.pavement ?? [];
  const nav = level.nav;
  const navEdgeLen = new Float64Array(nav.edgeCount);
  const navHeadingFwd = new Float64Array(nav.edgeCount);
  const navHeadingBack = new Float64Array(nav.edgeCount);
  for (let e = 0; e < nav.edgeCount; e += 1) {
    const a = nav.edgeFrom[e] as number;
    const b = nav.edgeTo[e] as number;
    const dx = (nav.nodeX[b] as number) - (nav.nodeX[a] as number);
    const dy = (nav.nodeY[b] as number) - (nav.nodeY[a] as number);
    navEdgeLen[e] = sqrt(dx * dx + dy * dy);
    navHeadingFwd[e] = atan2(dx, -dy);
    navHeadingBack[e] = atan2(-dx, dy);
  }
  const traffic: Traffic = {
    active: spec !== null && lanes.edgeCount > 0,
    rng: createStream(seed >>> 0, 'traffic'),
    movingTarget: spec?.moving ?? 0,
    mixCount: mix.length,
    mixKind: Uint8Array.from(mix, (m) => kindOf(m.id)),
    mixWeight,
    mixTotal,
    portalCount: portals.length,
    portalEdge: Int32Array.from(portals),
    edgeLen,
    edgeDirX,
    edgeDirY,
    edgeZebra,
    edgeBox,
    boxCount: rects.length,
    boxHolder: new Int32Array(rects.length * BOX_SLOTS).fill(-1),
    boxHolderEdge: new Int32Array(rects.length * BOX_SLOTS).fill(-1),
    boxClaim: new Int32Array(rects.length).fill(-1),
    boxClaimEdge: new Int32Array(rects.length).fill(-1),
    boxExclusive,
    conflictStart,
    conflictEdge,
    boxMinX: Float64Array.from(rects, (r) => (r[0] as number) - BOX_MARGIN_M),
    boxMinY: Float64Array.from(rects, (r) => (r[1] as number) - BOX_MARGIN_M),
    boxMaxX: Float64Array.from(rects, (r) => (r[2] as number) + BOX_MARGIN_M),
    boxMaxY: Float64Array.from(rects, (r) => (r[3] as number) + BOX_MARGIN_M),
    kindDwells: Uint8Array.from(VEHICLE_IDS, (id) => (entities.vehicles[id].behaviour === 'bus' ? 1 : 0)),
    dwellTicks: Math.round(bus.rules.stopDwellS * SIM_HZ),
    busKind: kindOf('veh.bus'),
    busRoute: Int32Array.from(busRoute),
    busRouteLen: busRoute.length,
    busEveryTicks,
    nextBusTick: busEveryTicks > 0 ? Math.round(tuning.streetLife.traffic.firstBusS * SIM_HZ) : 0,
    busesDue: 0,
    busesSpawned: 0,
    carHorns: 0,
    roadRageOffences: 0,
    dents: 0,
    contactStops: 0,
    dentRearmTicks: 1,
    schoolCrossingStop: neverStopForSchoolCrossing,
    taxiKind: kindOf('veh.taxi'),
    bicycleKind: kindOf('veh.bicycle'),
    fareDwellTicks: Math.max(1, Math.round(taxi.rules.fareStopDwellS * SIM_HZ)),
    kindPavement,
    kindSpeedMps,
    kindTurnTicks,
    fallTicks: FALLEN_TICKS + GET_UP_TICKS,
    angryTicks: ANGRY_TICKS,
    actorIgnoreTicks: 1,
    bikeEdgeSpeed,
    edgeFilter,
    pavementKinds: pavement.length,
    pavementKind: Uint8Array.from(pavement, (p) => kindOf(p.id)),
    pavementWant: Uint16Array.from(pavement, (p) => p.count),
    navEdgeOk: new Uint8Array(level.nav.edgeCount),
    navNodeWays: new Uint16Array(level.nav.nodeCount),
    navEdgeLen,
    navHeadingFwd,
    navHeadingBack,
    fareStops: 0,
    actorHits: 0,
    actorBumps: 0,
    npcFound: new Int32Array(1),
    obb: createObb(),
    obb2: createObb(),
    box: createAabb(),
    contact: createContact(),
    params: new Float64Array(PARAM_DOUBLES),
    honkTicks: 1,
    rageTicks: 1,
    clearTicks: 1,
    rageComplaints: 1,
    sc: new Float64Array(SCRATCH_DOUBLES),
    bessieCorners: new Float64Array(VEHICLE_CORNER_DOUBLES),
    spawnCorners: new Float64Array(VEHICLE_CORNER_DOUBLES),
    clearCorners: new Float64Array(VEHICLE_CORNER_DOUBLES),
    crossCorners: new Float64Array(VEHICLE_CORNER_DOUBLES),
    quad: new Float64Array(8),
    moveCorners: new Float64Array(VEHICLE_CORNER_DOUBLES),
    eligible: new Int32Array(Math.max(1, portals.length)),
    doomed: new Uint8Array(256),
  };
  const prm = traffic.params;
  prm[P_FARE_MIN] = taxi.rules.fareStopMinM;
  prm[P_FARE_SPAN] = taxi.rules.fareStopMaxM - taxi.rules.fareStopMinM;
  prm[P_FARE_DECEL] = taxi.rules.fareStopDecelMps2;
  prm[P_FILTER_OFF] = filterOff;
  prm[P_FILTER_BELOW] = bike.rules.filterBelowMps;
  prm[P_FILTER_LAT] = bike.rules.filterLateralMps;
  setTrafficTuning(traffic, tuning);
  return traffic;
}

/**
 * The pavement vehicles' half of the setup (SSP-091), once the static grid and the NPC store exist (createWorld):
 * which nav edges a pavement vehicle may drive (`navEdgeOk`: not a crossing, and the body of the largest
 * pavement kind swept along it, its half length past each end, clear of every static shape), each node's usable
 * edges, and the NPC query buffer. Without pavement kinds in the level, nothing is usable. Setup only.
 */
export function initPavementTraffic(
  t: Traffic,
  level: Level,
  grid: StaticGrid,
  store: VehicleStore,
  npcCapacity: number,
): void {
  t.npcFound = new Int32Array(Math.max(1, npcCapacity));
  if (t.pavementKinds === 0) return;
  const nav = level.nav;
  let hw = 0;
  let hl = 0;
  for (let k = 0; k < t.pavementKinds; k += 1) {
    const kind = t.pavementKind[k] as number;
    hw = Math.max(hw, store.kindHalfWidth[kind] as number);
    hl = Math.max(hl, store.kindHalfLength[kind] as number);
  }
  const obb = t.obb;
  for (let e = 0; e < nav.edgeCount; e += 1) {
    if (((nav.edgeFlags[e] as number) & NAV_FLAG_CROSSING) !== 0) continue;
    const a = nav.edgeFrom[e] as number;
    const b = nav.edgeTo[e] as number;
    const ax = nav.nodeX[a] as number;
    const ay = nav.nodeY[a] as number;
    const dx = (nav.nodeX[b] as number) - ax;
    const dy = (nav.nodeY[b] as number) - ay;
    const len = t.navEdgeLen[e] as number;
    if (!(len > 0)) continue;
    obb.cx = ax + dx / 2;
    obb.cy = ay + dy / 2;
    obb.headingRad = t.navHeadingFwd[e] as number;
    obb.halfWidthM = hw;
    obb.halfLengthM = len / 2 + hl;
    refreshObbAxes(obb);
    obbAabb(obb, t.box);
    const m = queryStatic(grid, t.box);
    let clear = true;
    for (let k = 0; clear && k < m; k += 1) {
      if (staticContact(grid, grid.candidates[k] as number, obb, t.box, t.contact)) clear = false;
    }
    if (!clear) continue;
    t.navEdgeOk[e] = 1;
    t.navNodeWays[a] = (t.navNodeWays[a] as number) + 1;
    t.navNodeWays[b] = (t.navNodeWays[b] as number) + 1;
  }
}

/**
 * Copy the numbers the tick reads off `tuning` (streetLife.traffic, complaints.roadRage, Bessie's body) onto
 * `t`: at creation and whenever the World's tuning changes (setWorldTuning). The bus schedule keeps its
 * creation-time first bus. Never per tick.
 */
export function setTrafficTuning(t: Traffic, tuning: Tuning): void {
  const tr = tuning.streetLife.traffic;
  const body = tuning.vehicle.sweeper.body;
  t.params[P_ACCEL] = tr.accelMps2;
  t.params[P_DECEL] = tr.followDecelMps2;
  t.params[P_GAP] = tr.followGapM;
  t.params[P_SLOW] = tr.blockedBelowMps;
  t.params[P_CROSS_GAP_S] = tr.crossingGapS;
  t.params[P_BESSIE_HW] = body.widthM / 2;
  t.params[P_BESSIE_HL] = body.lengthM / 2;
  t.honkTicks = Math.max(1, Math.round(tr.honkAfterBlockedS * SIM_HZ));
  t.rageTicks = Math.max(1, Math.round(tuning.complaints.roadRage.afterBlockedS * SIM_HZ));
  t.clearTicks = Math.max(1, Math.round(tr.clearAfterS * SIM_HZ));
  t.rageComplaints = tuning.complaints.roadRage.complaints;
  t.dentRearmTicks = Math.max(1, Math.round(tr.dentRearmS * SIM_HZ));
  const hit = tuning.streetLife.actorHit;
  t.params[P_MIN_CLOSING] = hit.minClosingSpeedMps;
  t.params[P_REAR_AXLE] = body.rearAxleOffsetM;
  t.actorIgnoreTicks = Math.min(255, Math.max(1, Math.round(hit.ignoreContactS * SIM_HZ)));
}

/** The read-only view of `t`. No copy: it is the same object. */
export function viewTraffic(t: Traffic): TrafficView {
  return t;
}

// ---------------------------------------------------------------------------------------------------------
// Geometry helpers (scratch in, scratch out)
// ---------------------------------------------------------------------------------------------------------

/**
 * The point at arc sc[ARG] from vehicle i's centre along its plan (extrapolated along the first edge before its
 * start and along the last edge past its end) into sc[PX], sc[PY], and that edge's direction into sc[DX], sc[DY].
 */
function pointAlong(t: Traffic, store: VehicleStore, lanes: LaneGraph, i: number): void {
  const sc = t.sc;
  const base = i * VEHICLE_PLAN_EDGES;
  const n = store.planLen[i] as number;
  let a = (store.along[i] as number) + (sc[ARG] as number);
  for (let k = 0; k < n; k += 1) {
    const e = store.plan[base + k] as number;
    const len = t.edgeLen[e] as number;
    if (a <= len || k === n - 1) {
      const from = lanes.edgeFrom[e] as number;
      const dx = t.edgeDirX[e] as number;
      const dy = t.edgeDirY[e] as number;
      sc[PX] = (lanes.nodeX[from] as number) + dx * a;
      sc[PY] = (lanes.nodeY[from] as number) + dy * a;
      sc[DX] = dx;
      sc[DY] = dy;
      return;
    }
    a -= len;
  }
}

/**
 * The least u of the quadrilateral whose corners (u, n) are in t.quad[0..8) (in order round it) clipped to
 * the rect sc[LIM_ULO] ≤ u ≤ sc[LIM_UHI], |n| ≤ sc[LIM_N]: both are convex, so it is the least u among the
 * quad's corners inside the rect, the rect's corners inside the quad and the crossings of their edges. Writes
 * it into sc[HIT_U] and returns 1, or returns 0 when they do not meet. Allocation-free.
 */
function quadRectMinU(t: Traffic): number {
  const sc = t.sc;
  const q = t.quad;
  const lo = sc[LIM_ULO] as number;
  const hi = sc[LIM_UHI] as number;
  const hw = sc[LIM_N] as number;
  let best = Number.POSITIVE_INFINITY;
  // The quad's orientation (sign of its area), for the point-in-quad tests.
  const u0 = q[0] as number;
  const n0 = q[1] as number;
  const area =
    ((q[2] as number) - u0) * ((q[5] as number) - n0) - ((q[3] as number) - n0) * ((q[4] as number) - u0);
  const orient = area < 0 ? -1 : 1;
  // The rect's two low corners inside the quad: then lo is reached.
  let inLoA = true;
  let inLoB = true;
  for (let c = 0; c < 4; c += 1) {
    const pu = q[2 * c] as number;
    const pn = q[2 * c + 1] as number;
    const k = c === 3 ? 0 : c + 1;
    const qu = q[2 * k] as number;
    const qn = q[2 * k + 1] as number;
    // A corner inside the rect.
    if (pu >= lo && pu <= hi && pn >= -hw && pn <= hw && pu < best) best = pu;
    // Is (lo, ±hw) on the inner side of edge p→q?
    const eu = qu - pu;
    const en = qn - pn;
    if (orient * (eu * (hw - pn) - en * (lo - pu)) < 0) inLoA = false;
    if (orient * (eu * (-hw - pn) - en * (lo - pu)) < 0) inLoB = false;
    // The edge crossing n = ±hw within [lo, hi].
    if (en !== 0) {
      for (let side = 0; side < 2; side += 1) {
        const nn = side === 0 ? hw : -hw;
        const f = (nn - pn) / en;
        if (f >= 0 && f <= 1) {
          const u = pu + eu * f;
          if (u >= lo && u <= hi && u < best) best = u;
        }
      }
    }
    // The edge crossing u = lo within |n| ≤ hw.
    if (eu !== 0) {
      const f = (lo - pu) / eu;
      if (f >= 0 && f <= 1) {
        const n = pn + en * f;
        if (n >= -hw && n <= hw && lo < best) best = lo;
      }
    }
  }
  if ((inLoA || inLoB) && lo < best) best = lo;
  if (!(best < Number.POSITIVE_INFINITY)) {
    // The rect's high corners inside the quad (a quad that swallows the far end of the rect only).
    let inHiA = true;
    let inHiB = true;
    for (let c = 0; c < 4; c += 1) {
      const pu = q[2 * c] as number;
      const pn = q[2 * c + 1] as number;
      const k = c === 3 ? 0 : c + 1;
      const eu = (q[2 * k] as number) - pu;
      const en = (q[2 * k + 1] as number) - pn;
      if (orient * (eu * (hw - pn) - en * (hi - pu)) < 0) inHiA = false;
      if (orient * (eu * (-hw - pn) - en * (hi - pu)) < 0) inHiB = false;
    }
    if (inHiA || inHiB) best = hi;
  }
  if (!(best < Number.POSITIVE_INFINITY)) return 0;
  sc[HIT_U] = best;
  return 1;
}

/**
 * The first point, along vehicle i's plan within LOOKAHEAD_M of its front, where the box with corners
 * `corners[off .. off + 8)` enters its corridor (half width sc[HALF_W], from its centre forward, centred
 * sc[OFF_N] metres right of the lane: a filtering bicycle's offset, 0 for everyone else). Returns 1 and
 * writes its arc from the centre into sc[HIT_ARC] and the plan edge into sc[HIT_EDGE], or returns 0.
 */
function scanObstacle(
  t: Traffic,
  store: VehicleStore,
  lanes: LaneGraph,
  i: number,
  corners: Float64Array,
  off: number,
): number {
  const sc = t.sc;
  const hw = sc[HALF_W] as number;
  const hl = sc[HALF_L] as number;
  const base = i * VEHICLE_PLAN_EDGES;
  const n = store.planLen[i] as number;
  const along = store.along[i] as number;
  const exits = isExitPlan(t, store, lanes, i);
  const a = t.quad;
  const latOff = sc[OFF_N] as number;
  let start = -along;
  sc[LIM_N] = hw;
  for (let k = 0; k < n; k += 1) {
    const e = store.plan[base + k] as number;
    const len = t.edgeLen[e] as number;
    // From the centre forward: plan[0] is the edge under the rear, so the centre may be past its end and past
    // the start of the next.
    const lo = k === 0 ? along : start < 0 ? -start : 0;
    let hi = len;
    if (k === n - 1 && exits) hi = lo + LOOKAHEAD_M + 2 * hl;
    if (start + lo - hl > LOOKAHEAD_M) return 0;
    if (hi <= lo) {
      start += len;
      continue;
    }
    const from = lanes.edgeFrom[e] as number;
    const fx = lanes.nodeX[from] as number;
    const fy = lanes.nodeY[from] as number;
    const dx = t.edgeDirX[e] as number;
    const dy = t.edgeDirY[e] as number;
    // Corners into (u along the edge, n to its left-hand normal).
    let allHi = true;
    let allLo = true;
    let allL = true;
    let allR = true;
    for (let c = 0; c < 4; c += 1) {
      const px = (corners[off + 2 * c] as number) - fx;
      const py = (corners[off + 2 * c + 1] as number) - fy;
      const u = px * dx + py * dy;
      // n to the left of the corridor's centre line, which is `off` right of the lane (a filtering bicycle).
      const v = py * dx - px * dy + latOff;
      a[2 * c] = u;
      a[2 * c + 1] = v;
      if (u <= hi) allHi = false;
      if (u >= lo) allLo = false;
      if (v <= hw) allL = false;
      if (v >= -hw) allR = false;
    }
    if (!(allHi || allLo || allL || allR)) {
      sc[LIM_UHI] = hi;
      sc[LIM_ULO] = lo;
      if (quadRectMinU(t) === 1) {
        sc[HIT_ARC] = start + (sc[HIT_U] as number);
        sc[HIT_EDGE] = e;
        return 1;
      }
    }
    start += len;
  }
  return 0;
}

/** Vehicle i's plan ends at an exit portal (its last edge is PORTAL_OUT). */
function isExitPlan(t: Traffic, store: VehicleStore, lanes: LaneGraph, i: number): boolean {
  const n = store.planLen[i] as number;
  if (n === 0) return false;
  const last = store.plan[i * VEHICLE_PLAN_EDGES + n - 1] as number;
  return ((lanes.edgeFlags[last] as number) & LANE_FLAG.PORTAL_OUT) !== 0 && t.edgeLen.length > 0;
}

/** The bounding box of the corners `c[off .. off + 8)` into sc[CB_X0..CB_Y1] (comparisons only, no calls). */
function cornerBounds(sc: Float64Array, c: Float64Array, off: number): void {
  let x0 = c[off] as number;
  let x1 = x0;
  let y0 = c[off + 1] as number;
  let y1 = y0;
  for (let k = 1; k < 4; k += 1) {
    const x = c[off + 2 * k] as number;
    const y = c[off + 2 * k + 1] as number;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  sc[CB_X0] = x0;
  sc[CB_Y0] = y0;
  sc[CB_X1] = x1;
  sc[CB_Y1] = y1;
}

/**
 * True when the box with corners `c[off .. off + 8)` (obbCorners order) touches or overlaps `rect` (boundary
 * included): a vehicle that may be on screen must not spawn or despawn. Separating axes: world x and y, then
 * the box's own right and forward axes.
 */
export function cornersTouchViewRect(c: Float64Array, off: number, rect: Readonly<ViewRect>): boolean {
  const x0 = c[off] as number;
  const y0 = c[off + 1] as number;
  const x1 = c[off + 2] as number;
  const y1 = c[off + 3] as number;
  const x2 = c[off + 4] as number;
  const y2 = c[off + 5] as number;
  const x3 = c[off + 6] as number;
  const y3 = c[off + 7] as number;
  // World x and y (comparisons only: a cold call to Math.min/max would box its arguments, §17).
  if (x0 < rect.minX && x1 < rect.minX && x2 < rect.minX && x3 < rect.minX) return false;
  if (x0 > rect.maxX && x1 > rect.maxX && x2 > rect.maxX && x3 > rect.maxX) return false;
  if (y0 < rect.minY && y1 < rect.minY && y2 < rect.minY && y3 < rect.minY) return false;
  if (y0 > rect.maxY && y1 > rect.maxY && y2 > rect.maxY && y3 > rect.maxY) return false;
  const cx = (x0 + x2) * 0.5;
  const cy = (y0 + y2) * 0.5;
  // The rect's corners relative to the centre.
  const ax = rect.minX - cx;
  const bx = rect.maxX - cx;
  const ay = rect.minY - cy;
  const by = rect.maxY - cy;
  // right·hw = (front-right − front-left) / 2: the box spans ±|right·hw|² on it.
  const rx = (x0 - x3) * 0.5;
  const ry = (y0 - y3) * 0.5;
  const re = rx * rx + ry * ry;
  const r0 = ax * rx + ay * ry;
  const r1 = bx * rx + ay * ry;
  const r2 = ax * rx + by * ry;
  const r3 = bx * rx + by * ry;
  if (r0 > re && r1 > re && r2 > re && r3 > re) return false;
  if (r0 < -re && r1 < -re && r2 < -re && r3 < -re) return false;
  // forward·hl = (front-right − back-right) / 2.
  const fx = (x0 - x1) * 0.5;
  const fy = (y0 - y1) * 0.5;
  const fe = fx * fx + fy * fy;
  const f0 = ax * fx + ay * fy;
  const f1 = bx * fx + ay * fy;
  const f2 = ax * fx + by * fy;
  const f3 = bx * fx + by * fy;
  if (f0 > fe && f1 > fe && f2 > fe && f3 > fe) return false;
  return !(f0 < -fe && f1 < -fe && f2 < -fe && f3 < -fe);
}

// ---------------------------------------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------------------------------------

/**
 * Top vehicle i's plan up to LOOKAHEAD_M (plus a body length) ahead of its front: a route bus from the bus
 * route, everyone else by a uniform choice at each node among the edges leaving it, never a U-turn while there
 * is another way (one choice draws nothing). Stops at an exit portal or a node with no way on.
 */
function fillPlan(w: World, i: number): void {
  const store = w.vehicles;
  const t = w.traffic;
  const lanes = w.level.lanes;
  const base = i * VEHICLE_PLAN_EDGES;
  let n = store.planLen[i] as number;
  if (n === 0) return;
  let ahead = (t.edgeLen[store.plan[base] as number] as number) - (store.along[i] as number);
  for (let k = 1; k < n; k += 1) ahead += t.edgeLen[store.plan[base + k] as number] as number;
  const want = LOOKAHEAD_M + 3 * (store.halfLength[i] as number);
  while (n < VEHICLE_PLAN_EDGES && ahead < want) {
    const last = store.plan[base + n - 1] as number;
    if (((lanes.edgeFlags[last] as number) & LANE_FLAG.PORTAL_OUT) !== 0) break;
    let next = -1;
    const at = store.routeAt[i] as number;
    if (at >= 0) {
      if (at >= t.busRouteLen) break;
      next = t.busRoute[at] as number;
      store.routeAt[i] = at + 1;
    } else {
      const node = lanes.edgeTo[last] as number;
      const s0 = lanes.outStart[node] as number;
      const s1 = lanes.outStart[node + 1] as number;
      if (s1 <= s0) break;
      let ways = 0;
      for (let e = s0; e < s1; e += 1)
        if (((lanes.edgeFlags[e] as number) & LANE_FLAG.U_TURN) === 0) ways += 1;
      if (ways === 0) {
        next = s1 - s0 === 1 ? s0 : s0 + nextInt(t.rng, s1 - s0);
      } else {
        let pick = ways === 1 ? 0 : nextInt(t.rng, ways);
        for (let e = s0; e < s1; e += 1) {
          if (((lanes.edgeFlags[e] as number) & LANE_FLAG.U_TURN) !== 0) continue;
          if (pick === 0) {
            next = e;
            break;
          }
          pick -= 1;
        }
      }
    }
    store.plan[base + n] = next;
    n += 1;
    ahead += t.edgeLen[next] as number;
  }
  store.planLen[i] = n;
}

/** Vehicle i's plan has run into a node with no way on (not an exit portal, not a full plan). */
function planDeadEnds(w: World, i: number): boolean {
  const store = w.vehicles;
  const lanes = w.level.lanes;
  const n = store.planLen[i] as number;
  if (n === 0 || n >= VEHICLE_PLAN_EDGES) return false;
  const last = store.plan[i * VEHICLE_PLAN_EDGES + n - 1] as number;
  if (((lanes.edgeFlags[last] as number) & LANE_FLAG.PORTAL_OUT) !== 0) return false;
  const at = store.routeAt[i] as number;
  if (at >= 0) return at >= w.traffic.busRouteLen;
  const node = lanes.edgeTo[last] as number;
  return (lanes.outStart[node + 1] as number) <= (lanes.outStart[node] as number);
}

/**
 * Place vehicle i on its plan: the centre at `along` on the path, heading along the chord from the path point
 * half a length behind it to the one half a length ahead (so the body turns through a junction connector
 * with its ends near the path rather than swinging its tail out; on a straight lane it is the lane's heading).
 */
function placeVehicle(t: Traffic, store: VehicleStore, lanes: LaneGraph, i: number): void {
  const sc = t.sc;
  const hl = store.halfLength[i] as number;
  sc[ARG] = -hl;
  pointAlong(t, store, lanes, i);
  const rx = sc[PX] as number;
  const ry = sc[PY] as number;
  const ex = sc[DX] as number;
  const ey = sc[DY] as number;
  sc[ARG] = hl;
  pointAlong(t, store, lanes, i);
  const qx = sc[PX] as number;
  const qy = sc[PY] as number;
  let fx = qx - rx;
  let fy = qy - ry;
  if (fx * fx + fy * fy < 1e-12) {
    fx = ex;
    fy = ey;
  }
  sc[ARG] = 0;
  pointAlong(t, store, lanes, i);
  // A filtering bicycle rides `lateral` right of the lane: right = (−forward.y, forward.x).
  const lat = store.lateral[i] as number;
  sc[CHORD_LEN] = fx * fx + fy * fy;
  sqrtAt(sc, CHORD_LEN);
  const fl = sc[CHORD_LEN] as number;
  store.x[i] = (sc[PX] as number) - (fy / fl) * lat;
  store.y[i] = (sc[PY] as number) + (fx / fl) * lat;
  store.heading[i] = atan2(fx, -fy);
  updateVehicleCorners(store, i);
}

/**
 * Would vehicle i's body, moved sc[ARG] metres on along its plan, overlap Bessie's (t.bessieCorners)? The
 * candidate pose is placeVehicle's at along + sc[ARG] (the plan is not changed). Allocation-free.
 */
function moveHitsBessie(t: Traffic, store: VehicleStore, lanes: LaneGraph, i: number): boolean {
  const sc = t.sc;
  sc[LAT_ARG] = store.lateral[i] as number;
  sc[GROW_W] = 0;
  sc[GROW_L] = 0;
  bodyAt(t, store, lanes, i, t.moveCorners);
  return cornersOverlap(t.moveCorners, 0, t.bessieCorners, 0);
}

/**
 * Vehicle i's body moved sc[ARG] metres on along its plan, sc[LAT_ARG] metres right of its lane and grown by
 * sc[GROW_W] and sc[GROW_L] (half extents), as corners into `out`: placeVehicle's pose (the plan is not
 * changed). Allocation-free.
 */
function bodyAt(t: Traffic, store: VehicleStore, lanes: LaneGraph, i: number, out: Float64Array): void {
  const sc = t.sc;
  const lat = sc[LAT_ARG] as number;
  const growW = sc[GROW_W] as number;
  const growL = sc[GROW_L] as number;
  const along = store.along[i] as number;
  store.along[i] = along + (sc[ARG] as number);
  const hl = store.halfLength[i] as number;
  sc[ARG] = -hl;
  pointAlong(t, store, lanes, i);
  const rx = sc[PX] as number;
  const ry = sc[PY] as number;
  const ex = sc[DX] as number;
  const ey = sc[DY] as number;
  sc[ARG] = hl;
  pointAlong(t, store, lanes, i);
  let fx = (sc[PX] as number) - rx;
  let fy = (sc[PY] as number) - ry;
  if (fx * fx + fy * fy < 1e-12) {
    fx = ex;
    fy = ey;
  }
  sc[ARG] = 0;
  pointAlong(t, store, lanes, i);
  store.along[i] = along;
  // The body: unit forward from the chord, right = (−fy, fx) (forward (sin h, −cos h), right (cos h, sin h)).
  sc[CHORD_LEN] = fx * fx + fy * fy;
  sqrtAt(sc, CHORD_LEN);
  const fl = sc[CHORD_LEN] as number;
  const ux = fx / fl;
  const uy = fy / fl;
  sc[BOX_CX] = (sc[PX] as number) - uy * lat;
  sc[BOX_CY] = (sc[PY] as number) + ux * lat;
  sc[BOX_FX] = ux;
  sc[BOX_FY] = uy;
  sc[BOX_HW] = (store.halfWidth[i] as number) + growW;
  sc[BOX_HL] = hl + growL;
  boxCorners(sc, out);
}

// ---------------------------------------------------------------------------------------------------------
// Junction boxes
// ---------------------------------------------------------------------------------------------------------

function holdsBox(store: VehicleStore, i: number, box: number): boolean {
  return store.box0[i] === box || store.box1[i] === box;
}

/** Connector `a` conflicts with connector `b` (both in one box). */
function conflicts(t: Traffic, a: number, b: number): boolean {
  for (let k = t.conflictStart[a] as number; k < (t.conflictStart[a + 1] as number); k += 1) {
    if (t.conflictEdge[k] === b) return true;
  }
  return false;
}

/**
 * Give vehicle i a slot of box `box` for connector `edge` (the box's first edge on its plan): only while no
 * holder's connector conflicts with it (an exclusive box: while it has no holder), no other vehicle's claim
 * conflicts with it, a slot is free and i has a free box. A vehicle turned away by a holder claims the box if
 * no one has. Returns whether i holds the box now.
 */
function takeBox(t: Traffic, store: VehicleStore, i: number, box: number, edge: number): boolean {
  const base = box * BOX_SLOTS;
  const uid = store.uid[i] as number;
  const exclusive = t.boxExclusive[box] === 1;
  const claim = t.boxClaim[box] as number;
  if (claim >= 0 && claim !== uid && (exclusive || conflicts(t, edge, t.boxClaimEdge[box] as number)))
    return false;
  let free = -1;
  for (let k = 0; k < BOX_SLOTS; k += 1) {
    if ((t.boxHolder[base + k] as number) < 0) {
      if (free < 0) free = k;
      continue;
    }
    if (exclusive || conflicts(t, edge, t.boxHolderEdge[base + k] as number)) {
      if (claim < 0) {
        t.boxClaim[box] = uid;
        t.boxClaimEdge[box] = edge;
      }
      return false;
    }
  }
  if (free < 0) return false;
  if ((store.box0[i] as number) < 0) store.box0[i] = box;
  else if ((store.box1[i] as number) < 0) store.box1[i] = box;
  else return false;
  t.boxHolder[base + free] = uid;
  t.boxHolderEdge[base + free] = edge;
  if (claim === uid) {
    t.boxClaim[box] = -1;
    t.boxClaimEdge[box] = -1;
  }
  return true;
}

/** Free vehicle i's slot of box `box`. */
function freeBoxSlot(t: Traffic, store: VehicleStore, i: number, box: number): void {
  const base = box * BOX_SLOTS;
  const uid = store.uid[i] as number;
  for (let k = 0; k < BOX_SLOTS; k += 1) {
    if (t.boxHolder[base + k] === uid) {
      t.boxHolder[base + k] = -1;
      t.boxHolderEdge[base + k] = -1;
    }
  }
}

/** Vehicle i still needs box `box`: it is on its plan within the look-ahead, or its body overlaps the box's rect. */
function stillNeedsBox(t: Traffic, store: VehicleStore, i: number, box: number): boolean {
  const base = i * VEHICLE_PLAN_EDGES;
  const n = store.planLen[i] as number;
  let start = -(store.along[i] as number);
  for (let k = 0; k < n; k += 1) {
    const e = store.plan[base + k] as number;
    if (start - (store.halfLength[i] as number) > LOOKAHEAD_M) break;
    if (t.edgeBox[e] === box) return true;
    start += t.edgeLen[e] as number;
  }
  const sc = t.sc;
  cornerBounds(sc, store.corners, i * VEHICLE_CORNER_DOUBLES);
  return !(
    (sc[CB_X1] as number) < (t.boxMinX[box] as number) ||
    (sc[CB_X0] as number) > (t.boxMaxX[box] as number) ||
    (sc[CB_Y1] as number) < (t.boxMinY[box] as number) ||
    (sc[CB_Y0] as number) > (t.boxMaxY[box] as number)
  );
}

/** Release the boxes vehicle i no longer needs. */
function releaseBoxes(t: Traffic, store: VehicleStore, i: number): void {
  const b0 = store.box0[i] as number;
  if (b0 >= 0 && !stillNeedsBox(t, store, i, b0)) {
    freeBoxSlot(t, store, i, b0);
    store.box0[i] = -1;
  }
  const b1 = store.box1[i] as number;
  if (b1 >= 0 && !stillNeedsBox(t, store, i, b1)) {
    freeBoxSlot(t, store, i, b1);
    store.box1[i] = -1;
  }
}

// ---------------------------------------------------------------------------------------------------------
// The tick
// ---------------------------------------------------------------------------------------------------------

/** Bessie's body OBB corners into t.bessieCorners. */
function updateBessieCorners(w: World): void {
  const v = w.vehicle;
  const h = v.headingRad;
  const s = sin(h);
  const c = cos(h);
  const hw = w.traffic.params[P_BESSIE_HW] as number;
  const hl = w.traffic.params[P_BESSIE_HL] as number;
  const rx = c * hw;
  const ry = s * hw;
  const fx = s * hl;
  const fy = -c * hl;
  const k = w.traffic.bessieCorners;
  k[0] = v.xM + rx + fx;
  k[1] = v.yM + ry + fy;
  k[2] = v.xM + rx - fx;
  k[3] = v.yM + ry - fy;
  k[4] = v.xM - rx - fx;
  k[5] = v.yM - ry - fy;
  k[6] = v.xM - rx + fx;
  k[7] = v.yM - ry + fy;
}

/**
 * The fastest a vehicle may go and still stop within d = sc[ARG] metres (0 at or behind it) braking at
 * b = sc[DECEL]: sqrt(2bd), and at most d / dt, so one tick never carries it past; 0 within STOP_SNAP_M of
 * it (the float noise of a stop). Into sc[OUT].
 */
function stopSpeed(sc: Float64Array): void {
  const d = sc[ARG] as number;
  if (!(d > STOP_SNAP_M)) {
    sc[OUT] = 0;
    return;
  }
  // Through sqrtAt: stopSpeed runs several times per vehicle per tick, and an un-inlined sqrt boxed (SSP-106).
  sc[OUT] = 2 * (sc[DECEL] as number) * d;
  sqrtAt(sc, OUT);
  const v = sc[OUT] as number;
  const step = d / DT_S;
  sc[OUT] = v < step ? v : step;
}

/**
 * Phase 8 (see the header): bus schedule, every vehicle's drive, despawns, at most one spawn, the spatial
 * lookup. Allocation-free.
 */
export function stepTraffic(w: World): void {
  const t = w.traffic;
  const store = w.vehicles;
  updateBessieCorners(w);
  for (let i = 0; i < store.count; i += 1) updateVehicleCorners(store, i);
  stepActorVehicles(w);
  if (t.busEveryTicks > 0) {
    while (w.tick >= t.nextBusTick) {
      // A bus still waiting to enter is the one now due: they never bunch up at the portal.
      if (t.busesDue < 1) t.busesDue += 1;
      t.nextBusTick += t.busEveryTicks;
    }
  }
  for (let i = 0; i < store.count; i += 1) {
    t.doomed[i] = 0;
    driveVehicle(w, i);
  }
  // Despawns, highest index first, so a swap-remove never moves a vehicle still to be checked.
  for (let i = store.count - 1; i >= 0; i -= 1) {
    if (t.doomed[i] === 1) despawnVehicle(t, store, i);
  }
  if (t.active && !spawnTraffic(w)) spawnPavement(w);
  rebuildVehicleGrid(store);
}

/** Free vehicle i's boxes and swap-remove it. */
function despawnVehicle(t: Traffic, store: VehicleStore, i: number): void {
  const b0 = store.box0[i] as number;
  if (b0 >= 0) freeBoxSlot(t, store, i, b0);
  const b1 = store.box1[i] as number;
  if (b1 >= 0) freeBoxSlot(t, store, i, b1);
  const uid = store.uid[i] as number;
  for (let box = 0; box < t.boxCount; box += 1) {
    if (t.boxClaim[box] === uid) {
      t.boxClaim[box] = -1;
      t.boxClaimEdge[box] = -1;
    }
  }
  const last = store.count - 1;
  t.doomed[i] = t.doomed[last] as number;
  removeVehicle(store, i);
}

/** One vehicle's tick: obstacles, target speed, the state machine, the move, its pose, boxes and the exit. */
function driveVehicle(w: World, i: number): void {
  const store = w.vehicles;
  const t = w.traffic;
  const lanes = w.level.lanes;
  const sc = t.sc;
  const params = t.params;
  store.prevX[i] = store.x[i] as number;
  store.prevY[i] = store.y[i] as number;
  store.prevHeading[i] = store.heading[i] as number;
  const flags = store.flags[i] as number;
  if ((flags & VEHICLE_FLAG.PARKED) !== 0) return;
  // An actor Bessie knocked over (SSP-091): falling, getting up, shaking a fist.
  if (stepFallenActor(t, store, i)) return;
  if ((flags & VEHICLE_FLAG.PAVEMENT) !== 0) {
    drivePavementVehicle(w, i);
    return;
  }
  let prevState = store.state[i] as number;
  // A bus at its stop.
  if (prevState === TrafficState.Dwell) {
    const left = store.dwellLeft[i] as number;
    if (left > 0) {
      store.dwellLeft[i] = left - 1;
      store.speed[i] = 0;
      store.blocker[i] = Blocker.BusStop;
      store.blockerIndex[i] = -1;
      store.gapM[i] = 0;
      store.stateTicks[i] = (store.stateTicks[i] as number) + 1;
      return;
    }
  }
  const kind = store.kind[i] as number;
  const isTaxi = kind === t.taxiKind;
  const isBike = kind === t.bicycleKind;
  // A taxi standing at a fare stop (SSP-091); once the fare is in, it draws the distance to its next one.
  if (prevState === TrafficState.FareStop && (store.speed[i] as number) === 0) {
    const left = store.dwellLeft[i] as number;
    if (left > 0) {
      store.dwellLeft[i] = left - 1;
      store.blocker[i] = Blocker.FareStop;
      store.blockerIndex[i] = -1;
      store.gapM[i] = 0;
      store.stateTicks[i] = (store.stateTicks[i] as number) + 1;
      return;
    }
    drawFare(t, store, i);
    prevState = TrafficState.Cruise;
  }
  fillPlan(w, i);
  // A bicycle's sideways move (filtering, SSP-091), before its corridor is taken at its new offset.
  if (isBike) stepBikeLateral(w, i);
  const base = i * VEHICLE_PLAN_EDGES;
  const n = store.planLen[i] as number;
  const b = params[P_DECEL] as number;
  const G = params[P_GAP] as number;
  const slow = params[P_SLOW] as number;
  const v0 = store.speed[i] as number;
  const hl = store.halfLength[i] as number;
  const along = store.along[i] as number;
  const brakeDist = (v0 * v0) / (2 * b);
  sc[DECEL] = b;
  // A bicycle rides at its own speed whatever the road class (bikeEdgeSpeed).
  const limits = isBike ? t.bikeEdgeSpeed : lanes.edgeSpeedMps;
  let target = limits[store.plan[base] as number] as number;
  let bind: number = Blocker.None;
  let bindIndex = -1;
  let bindGap = -1;
  // 1. Obstacles in the corridor: Bessie, then every other vehicle (index order). `near*` is the nearest one.
  pathBox(w, i);
  // The corridor sits at a filtering bicycle's offset, with no margin between it and anyone (the header).
  const hwI = store.halfWidth[i] as number;
  const latI = store.lateral[i] as number;
  sc[HALF_W] = latI !== 0 ? hwI : hwI + CORRIDOR_MARGIN_M;
  sc[HALF_L] = hl;
  sc[OFF_N] = latI;
  let nearGap = Number.POSITIVE_INFINITY;
  let nearBlocker: number = Blocker.None;
  let nearIndex = -1;
  let nearMoving = false;
  if (
    boxTouchesCorners(sc, t.bessieCorners, 0) &&
    scanObstacle(t, store, lanes, i, t.bessieCorners, 0) === 1
  ) {
    const gap = (sc[HIT_ARC] as number) - hl;
    sc[ARG] = gap - G - GAP_EPS_M;
    stopSpeed(sc);
    const vs = sc[OUT] as number;
    if (vs < target) {
      target = vs;
      bind = Blocker.Bessie;
      bindGap = gap;
    }
    nearGap = gap;
    nearBlocker = Blocker.Bessie;
    const vb = w.vehicle.vLongMps;
    nearMoving = vb >= slow || -vb >= slow;
  }
  for (let j = 0; j < store.count; j += 1) {
    if (j === i) continue;
    const off = j * VEHICLE_CORNER_DOUBLES;
    sc[HALF_W] = latI !== 0 || (store.lateral[j] as number) !== 0 ? hwI : hwI + CORRIDOR_MARGIN_M;
    if (!boxTouchesCorners(sc, store.corners, off)) continue;
    if (scanObstacle(t, store, lanes, i, store.corners, off) === 0) continue;
    // On a junction box's connectors a vehicle ignores the noses of the others waiting at the box's entries
    // (only holders drive into a box; a waiting nose would otherwise hold up the box it waits for), but not
    // the box's holders: one ahead on its own connector is followed as anywhere else.
    const hitBox = t.edgeBox[sc[HIT_EDGE] as number] as number;
    if (hitBox >= 0 && !holdsBox(store, j, hitBox)) continue;
    const gap = (sc[HIT_ARC] as number) - hl;
    sc[ARG] = gap - G - GAP_EPS_M;
    stopSpeed(sc);
    const vs = sc[OUT] as number;
    if (vs < target) {
      target = vs;
      bind = Blocker.Vehicle;
      bindIndex = j;
      bindGap = gap;
    }
    if (gap < nearGap) {
      nearGap = gap;
      nearBlocker = Blocker.Vehicle;
      nearIndex = j;
      nearMoving = (store.speed[j] as number) >= slow;
    }
  }
  // 2. The plan ahead: speed limits, stop lines, junction boxes and a bus's stop.
  let dwellNode = -1;
  let dwellD = 0;
  const dwells = t.kindDwells[kind] === 1;
  let mergeSeen = false;
  let start = -along;
  for (let k = 0; k < n; k += 1) {
    const e = store.plan[base + k] as number;
    const len = t.edgeLen[e] as number;
    const ef = lanes.edgeFlags[e] as number;
    const d = start - hl;
    if (d > LOOKAHEAD_M) break;
    if (k >= 1) {
      const prev = store.plan[base + k - 1] as number;
      const pf = lanes.edgeFlags[prev] as number;
      // Brake in time for this edge's speed limit.
      const lim = limits[e] as number;
      sc[LIMIT_V] = lim * lim + 2 * b * (d > 0 ? d : 0);
      sqrtAt(sc, LIMIT_V);
      const vl = sc[LIMIT_V] as number;
      if (vl < target) {
        target = vl;
        bind = Blocker.None;
        bindIndex = -1;
      }
      if (d >= -STOP_COMMIT_M) {
        // An occupied zebra: stop at the line (the `from` node of its first ZEBRA edge).
        const z = t.edgeZebra[e] as number;
        if (
          (ef & LANE_FLAG.ZEBRA) !== 0 &&
          z >= 0 &&
          !((pf & LANE_FLAG.ZEBRA) !== 0 && t.edgeZebra[prev] === z) &&
          (w.zebras.occupancy[z] as number) > 0
        ) {
          sc[ARG] = d;
          stopSpeed(sc);
          const vs = sc[OUT] as number;
          if (vs < target) {
            target = vs;
            bind = Blocker.Crossing;
            bindIndex = -1;
            bindGap = d;
          }
        }
        // A filtering bicycle merges back before the first edge it may not filter on (SSP-091).
        if (latI > 0 && !mergeSeen && t.edgeFilter[e] === 0) {
          mergeSeen = true;
          sc[ARG] = d - MERGE_SETBACK_M;
          stopSpeed(sc);
          const vs = sc[OUT] as number;
          if (vs < target) {
            target = vs;
            bind = Blocker.Merge;
            bindIndex = -1;
            bindGap = d - MERGE_SETBACK_M;
          }
        }
        if (
          (ef & LANE_FLAG.SCHOOL_CROSSING) !== 0 &&
          (pf & LANE_FLAG.SCHOOL_CROSSING) === 0 &&
          t.schoolCrossingStop(w, e)
        ) {
          sc[ARG] = d;
          stopSpeed(sc);
          const vs = sc[OUT] as number;
          if (vs < target) {
            target = vs;
            bind = Blocker.Crossing;
            bindIndex = -1;
            bindGap = d;
          }
        }
        // A junction box: reserve it in time, and only with room to leave it (a yellow box: never enter it
        // behind a standing obstacle that would leave you inside); otherwise stop at its entry.
        const box = t.edgeBox[e] as number;
        if (box >= 0 && t.edgeBox[prev] !== box && !holdsBox(store, i, box)) {
          let runEnd = start + len;
          for (let m = k + 1; m < n && t.edgeBox[store.plan[base + m] as number] === box; m += 1) {
            runEnd += t.edgeLen[store.plan[base + m] as number] as number;
          }
          const room = nearGap > runEnd + hl + G || (nearMoving && nearGap > d);
          const near = d <= brakeDist + RESERVE_M;
          if (!(near && room && takeBox(t, store, i, box, e))) {
            sc[ARG] = d - ENTRY_SETBACK_M;
            stopSpeed(sc);
            const vs = sc[OUT] as number;
            if (vs < target) {
              target = vs;
              // Held back by what stands beyond the box (Bessie in it: she is the one blocking), or the box.
              bind = near && !room ? nearBlocker : Blocker.Junction;
              bindIndex = near && !room ? nearIndex : -1;
              bindGap = d;
            }
          }
        }
      }
    }
    // A bus's stop: the last node of a run of BUS_STOP edges it has not just served.
    if (
      dwells &&
      dwellNode < 0 &&
      (ef & LANE_FLAG.BUS_STOP) !== 0 &&
      (k === 0 ||
        ((lanes.edgeFlags[store.plan[base + k - 1] as number] as number) & LANE_FLAG.BUS_STOP) === 0)
    ) {
      let m = k;
      let end = start + len;
      while (
        m + 1 < n &&
        ((lanes.edgeFlags[store.plan[base + m + 1] as number] as number) & LANE_FLAG.BUS_STOP) !== 0
      ) {
        m += 1;
        end += t.edgeLen[store.plan[base + m] as number] as number;
      }
      const node = lanes.edgeTo[store.plan[base + m] as number] as number;
      const dd = end - hl;
      if (node !== (store.servedStop[i] as number) && dd >= -ARRIVE_EPS_M) {
        dwellNode = node;
        dwellD = dd > 0 ? dd : 0;
        sc[ARG] = dwellD;
        stopSpeed(sc);
        const vs = sc[OUT] as number;
        if (vs < target) {
          target = vs;
          bind = Blocker.BusStop;
          bindIndex = -1;
          bindGap = dwellD;
        }
      }
    }
    start += len;
  }
  if (planDeadEnds(w, i)) {
    sc[ARG] = start - hl;
    stopSpeed(sc);
    const vs = sc[OUT] as number;
    if (vs < target) {
      target = vs;
      bind = Blocker.LaneEnd;
      bindIndex = -1;
      bindGap = start - hl;
    }
  }
  // A taxi's fare stop (SSP-091): once its fare distance has run out, on a plain lane, it brakes at
  // fareStopDecelMps2 to a standstill whatever else lets it go faster.
  let fare = false;
  if (isTaxi) {
    fare = prevState === TrafficState.FareStop || ((store.fareLeftM[i] as number) <= 0 && fareStopFits(w, i));
    if (fare) {
      if (prevState !== TrafficState.FareStop) t.fareStops += 1;
      const hard = params[P_FARE_DECEL] as number;
      let vh = v0 - hard * DT_S;
      if (vh < 0) vh = 0;
      if (vh < target) {
        target = vh;
        bind = Blocker.FareStop;
        bindIndex = -1;
        bindGap = (v0 * v0) / (2 * hard);
      }
    }
  }
  // 3. Speed: up by at most accelMps2 · dt, down to the target at once (traffic is kinematic).
  let v = v0 + (params[P_ACCEL] as number) * DT_S;
  if (v > target) v = target;
  if (v < 0) v = 0;
  // Traffic is kinematic and stops (§9.4, SSP-090): never move into Bessie's body.
  if (v > 0) {
    sc[ARG] = v * DT_S;
    if (moveHitsBessie(t, store, lanes, i)) {
      t.contactStops += 1;
      v = 0;
      target = 0;
      bind = Blocker.Bessie;
      bindIndex = -1;
      bindGap = 0;
    }
  }
  const held = bind !== Blocker.None && target < slow;
  store.blocker[i] = held ? bind : Blocker.None;
  store.blockerIndex[i] = held ? bindIndex : -1;
  store.gapM[i] = held ? bindGap : -1;
  // 4. The state machine (ENTITY_CATALOG §8.3) and the block timer of a queue Bessie heads.
  let state: number = fare ? TrafficState.FareStop : held ? TrafficState.Queue : TrafficState.Cruise;
  if (held && bind === Blocker.Bessie && !fare) {
    const honkTicks = t.honkTicks;
    const rageTicks = t.rageTicks;
    const ticks = (store.blockTicks[i] as number) + 1;
    store.blockTicks[i] = ticks;
    store.clearTicks[i] = 0;
    if (ticks % honkTicks === 0 && ticks <= rageTicks) {
      const honk = (store.honks[i] as number) + 1;
      store.honks[i] = honk;
      t.carHorns += 1;
      const ev = emitEvent(w.events, EV.CarHorn, i);
      w.events.a[ev] = store.x[i] as number;
      w.events.b[ev] = store.y[i] as number;
      w.events.c[ev] = honk;
    }
    if (ticks > rageTicks && store.rageFiled[i] === 0) {
      store.rageFiled[i] = 1;
      t.roadRageOffences += 1;
      const p = pushPenalty(w.penalties, Offence.RoadRage, 0, t.rageComplaints);
      w.penalties.x[p] = w.vehicle.xM;
      w.penalties.y[p] = w.vehicle.yM;
    }
    state =
      ticks > rageTicks ? TrafficState.RoadRage : ticks >= honkTicks ? TrafficState.Honk : TrafficState.Queue;
  } else if ((store.blockTicks[i] as number) > 0) {
    // Not held by Bessie this tick: the block ends once she has not held it for clearAfterS.
    const clear = (store.clearTicks[i] as number) + 1;
    if (clear >= t.clearTicks) {
      store.blockTicks[i] = 0;
      store.clearTicks[i] = 0;
      store.honks[i] = 0;
      store.rageFiled[i] = 0;
    } else {
      store.clearTicks[i] = clear;
    }
  }
  // 5. The move along the plan.
  const step = v * DT_S;
  let s = along + step;
  let len0 = t.edgeLen[store.plan[base] as number] as number;
  let planLen = n;
  // plan[0] is the edge under the rear bumper: an edge leaves the plan once the rear has left it.
  while (planLen > 1 && s - hl >= len0) {
    s -= len0;
    store.plan.copyWithin(base, base + 1, base + planLen);
    planLen -= 1;
    len0 = t.edgeLen[store.plan[base] as number] as number;
  }
  store.planLen[i] = planLen;
  store.along[i] = s;
  store.speed[i] = v;
  if (isTaxi) {
    // Standing for the fare from the tick it comes to rest; otherwise the fare distance runs down.
    if (fare) {
      if (v === 0) store.dwellLeft[i] = t.fareDwellTicks;
    } else store.fareLeftM[i] = (store.fareLeftM[i] as number) - step;
  }
  fillPlan(w, i);
  // A bus reaching its stop.
  if (dwellNode >= 0 && step >= dwellD - ARRIVE_EPS_M) {
    state = TrafficState.Dwell;
    store.dwellLeft[i] = t.dwellTicks;
    store.servedStop[i] = dwellNode;
    store.speed[i] = 0;
    store.blocker[i] = Blocker.BusStop;
    store.blockerIndex[i] = -1;
    store.gapM[i] = 0;
  }
  store.stateTicks[i] = state === (store.state[i] as number) ? (store.stateTicks[i] as number) + 1 : 1;
  store.state[i] = state;
  placeVehicle(t, store, lanes, i);
  releaseBoxes(t, store, i);
  // Past the exit portal: drive on off the map, and leave once off the view rect.
  const e0 = store.plan[base] as number;
  if (
    (store.planLen[i] as number) === 1 &&
    ((lanes.edgeFlags[e0] as number) & LANE_FLAG.PORTAL_OUT) !== 0 &&
    s >= (t.edgeLen[e0] as number)
  ) {
    store.flags[i] = flags | VEHICLE_FLAG.EXITING;
    if (!cornersTouchViewRect(store.corners, i * VEHICLE_CORNER_DOUBLES, w.viewRect)) t.doomed[i] = 1;
  }
}

/**
 * Vehicle i's path box into sc[BX0..BY1]: its centre and every plan node within the look-ahead, and past an exit
 * portal the straight run beyond it.
 */
function pathBox(w: World, i: number): void {
  const store = w.vehicles;
  const t = w.traffic;
  const lanes = w.level.lanes;
  const sc = t.sc;
  const base = i * VEHICLE_PLAN_EDGES;
  const n = store.planLen[i] as number;
  const hl = store.halfLength[i] as number;
  sc[BX0] = store.x[i] as number;
  sc[BY0] = store.y[i] as number;
  sc[BX1] = store.x[i] as number;
  sc[BY1] = store.y[i] as number;
  let start = -(store.along[i] as number);
  for (let k = 0; k < n; k += 1) {
    const e = store.plan[base + k] as number;
    if (start - hl > LOOKAHEAD_M) break;
    growBox(sc, lanes, lanes.edgeTo[e] as number);
    start += t.edgeLen[e] as number;
  }
  if (isExitPlan(t, store, lanes, i)) {
    const last = store.plan[base + n - 1] as number;
    const to = lanes.edgeTo[last] as number;
    const fx = (lanes.nodeX[to] as number) + (t.edgeDirX[last] as number) * LOOKAHEAD_M;
    const fy = (lanes.nodeY[to] as number) + (t.edgeDirY[last] as number) * LOOKAHEAD_M;
    if (fx < (sc[BX0] as number)) sc[BX0] = fx;
    if (fy < (sc[BY0] as number)) sc[BY0] = fy;
    if (fx > (sc[BX1] as number)) sc[BX1] = fx;
    if (fy > (sc[BY1] as number)) sc[BY1] = fy;
  }
}

/** Grow the path box in sc[BX0..BY1] to take in lane node `node`. */
function growBox(sc: Float64Array, lanes: LaneGraph, node: number): void {
  const x = lanes.nodeX[node] as number;
  const y = lanes.nodeY[node] as number;
  if (x < (sc[BX0] as number)) sc[BX0] = x;
  if (y < (sc[BY0] as number)) sc[BY0] = y;
  if (x > (sc[BX1] as number)) sc[BX1] = x;
  if (y > (sc[BY1] as number)) sc[BY1] = y;
}

/** The corners' bounding box comes within the corridor half width of the path box. */
function boxTouchesCorners(sc: Float64Array, c: Float64Array, off: number): boolean {
  const m = (sc[HALF_W] as number) + 0.01;
  const x0 = (sc[BX0] as number) - m;
  const y0 = (sc[BY0] as number) - m;
  const x1 = (sc[BX1] as number) + m;
  const y1 = (sc[BY1] as number) + m;
  cornerBounds(sc, c, off);
  return !(
    (sc[CB_X1] as number) < x0 ||
    (sc[CB_X0] as number) > x1 ||
    (sc[CB_Y1] as number) < y0 ||
    (sc[CB_Y0] as number) > y1
  );
}

/**
 * The box centred on (sc[BOX_CX], sc[BOX_CY]) with unit forward (sc[BOX_FX], sc[BOX_FY]), half width
 * sc[BOX_HW] and half length sc[BOX_HL], as corners in obbCorners order (front-right, back-right, back-left,
 * front-left) into `out`.
 */
function boxCorners(sc: Float64Array, out: Float64Array): void {
  const cx = sc[BOX_CX] as number;
  const cy = sc[BOX_CY] as number;
  const fx = (sc[BOX_FX] as number) * (sc[BOX_HL] as number);
  const fy = (sc[BOX_FY] as number) * (sc[BOX_HL] as number);
  // right = (−forward.y, forward.x) (forward = (sin h, −cos h), right = (cos h, sin h)).
  const rx = -(sc[BOX_FY] as number) * (sc[BOX_HW] as number);
  const ry = (sc[BOX_FX] as number) * (sc[BOX_HW] as number);
  out[0] = cx + rx + fx;
  out[1] = cy + ry + fy;
  out[2] = cx + rx - fx;
  out[3] = cy + ry - fy;
  out[4] = cx - rx - fx;
  out[5] = cy - ry - fy;
  out[6] = cx - rx + fx;
  out[7] = cy - ry + fy;
}

/** Box `axes` (corners at axesOff) separates boxes a and b on one of its two edge normals. */
function separatesOnAxes(
  axes: Float64Array,
  axesOff: number,
  a: Float64Array,
  aOff: number,
  b: Float64Array,
  bOff: number,
): boolean {
  for (let k = 0; k < 2; k += 1) {
    // Edge 0→1 (the forward axis), then edge 0→3 (the right axis).
    const q = k === 0 ? 2 : 6;
    const ax = (axes[axesOff] as number) - (axes[axesOff + q] as number);
    const ay = (axes[axesOff + 1] as number) - (axes[axesOff + q + 1] as number);
    let aMin = Number.POSITIVE_INFINITY;
    let aMax = Number.NEGATIVE_INFINITY;
    let bMin = Number.POSITIVE_INFINITY;
    let bMax = Number.NEGATIVE_INFINITY;
    for (let c = 0; c < 4; c += 1) {
      const pa = (a[aOff + 2 * c] as number) * ax + (a[aOff + 2 * c + 1] as number) * ay;
      if (pa < aMin) aMin = pa;
      if (pa > aMax) aMax = pa;
      const pb = (b[bOff + 2 * c] as number) * ax + (b[bOff + 2 * c + 1] as number) * ay;
      if (pb < bMin) bMin = pb;
      if (pb > bMax) bMax = pb;
    }
    if (aMax < bMin || bMax < aMin) return true;
  }
  return false;
}

/**
 * True when boxes a (corners at aOff) and b (at bOff), each four corners in obbCorners order, touch or overlap
 * (separating axes: the edge normals of both). Allocation-free.
 */
export function cornersOverlap(a: Float64Array, aOff: number, b: Float64Array, bOff: number): boolean {
  return !(separatesOnAxes(a, aOff, a, aOff, b, bOff) || separatesOnAxes(b, bOff, a, aOff, b, bOff));
}

// ---------------------------------------------------------------------------------------------------------
// The special kinds (SSP-091): taxi fares, bicycle filtering, pavement vehicles, actor hits
// ---------------------------------------------------------------------------------------------------------

/** The lane flags a taxi never makes a fare stop on: junctions, crossings, bus stops, give-ways, portals, turns. */
const FARE_BANNED_FLAGS =
  LANE_FLAG.ZEBRA |
  LANE_FLAG.SCHOOL_CROSSING |
  LANE_FLAG.BUS_STOP |
  LANE_FLAG.GIVE_WAY |
  LANE_FLAG.PORTAL_IN |
  LANE_FLAG.PORTAL_OUT |
  LANE_FLAG.JUNCTION |
  LANE_FLAG.ROUNDABOUT |
  LANE_FLAG.U_TURN;

/** A taxi's distance to its next fare stop: fareStopMinM plus a uniform share of the span (one `traffic` draw). */
function drawFare(t: Traffic, store: VehicleStore, i: number): void {
  const u = nextInt(t.rng, MIX_STEPS) / MIX_STEPS;
  store.fareLeftM[i] = (t.params[P_FARE_MIN] as number) + u * (t.params[P_FARE_SPAN] as number);
}

/**
 * May taxi i start a fare stop now? Not while it is leaving the map or holds a junction box, and only where every
 * plan edge from its rear bumper to its car-following braking distance + RESERVE_M past its front (beyond where
 * its hard stop leaves it, and beyond any box it could still reserve) is a plain lane (no FARE_BANNED_FLAGS).
 */
function fareStopFits(w: World, i: number): boolean {
  const store = w.vehicles;
  const t = w.traffic;
  const lanes = w.level.lanes;
  if (((store.flags[i] as number) & VEHICLE_FLAG.EXITING) !== 0) return false;
  if ((store.box0[i] as number) >= 0 || (store.box1[i] as number) >= 0) return false;
  const v = store.speed[i] as number;
  const hl = store.halfLength[i] as number;
  // As far as it could still reserve a junction box from (its car-following braking distance + RESERVE_M), which
  // is further than its hard stop: so it never stands at a fare holding a box.
  const reach = hl + (v * v) / (2 * (t.params[P_DECEL] as number)) + RESERVE_M;
  const base = i * VEHICLE_PLAN_EDGES;
  const n = store.planLen[i] as number;
  let start = -(store.along[i] as number);
  for (let k = 0; k < n; k += 1) {
    const e = store.plan[base + k] as number;
    const len = t.edgeLen[e] as number;
    if (start > reach) break;
    if (start + len >= -hl && ((lanes.edgeFlags[e] as number) & FARE_BANNED_FLAGS) !== 0) return false;
    start += len;
  }
  return start >= reach;
}

/**
 * An actor Bessie knocked over (TrafficState.Fallen, then Angry): it stands still through the pedestrian's fall
 * and get-up (t.fallTicks), then its fist shake (t.angryTicks), then rides on (Cruise). True when vehicle i was
 * in either state (its tick is done).
 */
function stepFallenActor(t: Traffic, store: VehicleStore, i: number): boolean {
  const st = store.state[i] as number;
  if (st !== TrafficState.Fallen && st !== TrafficState.Angry) return false;
  const ticks = (store.stateTicks[i] as number) + 1;
  store.speed[i] = 0;
  store.blocker[i] = Blocker.None;
  store.blockerIndex[i] = -1;
  store.gapM[i] = -1;
  if (st === TrafficState.Fallen && ticks > t.fallTicks) {
    store.state[i] = TrafficState.Angry;
    store.stateTicks[i] = 1;
  } else if (st === TrafficState.Angry && ticks > t.angryTicks) {
    store.state[i] = TrafficState.Cruise;
    store.stateTicks[i] = 1;
  } else {
    store.stateTicks[i] = ticks;
  }
  return true;
}

/**
 * Bessie against the actor vehicles (the header; npc/reactions.ts's rule for pedestrians): each actor's window
 * counts down; an actor her body OBB overlaps refills it and, unless the window was open or it is Fallen, starts
 * a contact episode: her closing speed toward it (her velocity at its centre, along the separating axis from her
 * to it) at or above streetLife.actorHit.minClosingSpeedMps is a hit, slower a bump. Allocation-free.
 */
function stepActorVehicles(w: World): void {
  const t = w.traffic;
  const store = w.vehicles;
  if (store.count === store.parkedCount) return;
  for (let i = 0; i < store.count; i += 1) {
    const left = store.contactIgnore[i] as number;
    if (left > 0) store.contactIgnore[i] = left - 1;
  }
  const v = w.vehicle;
  const params = t.params;
  for (let i = 0; i < store.count; i += 1) {
    if (store.kindActor[store.kind[i] as number] !== 1) continue;
    if (!cornersOverlap(t.bessieCorners, 0, store.corners, i * VEHICLE_CORNER_DOUBLES)) continue;
    const inEpisode = (store.contactIgnore[i] as number) > 0 || store.state[i] === TrafficState.Fallen;
    store.contactIgnore[i] = t.actorIgnoreTicks;
    if (inEpisode) continue;
    // The separating axis: the MTV pushes Bessie out of the actor, so it points from the actor to her.
    const a = t.obb;
    a.cx = v.xM;
    a.cy = v.yM;
    a.headingRad = v.headingRad;
    a.halfWidthM = params[P_BESSIE_HW] as number;
    a.halfLengthM = params[P_BESSIE_HL] as number;
    refreshObbAxes(a);
    const b = t.obb2;
    b.cx = store.x[i] as number;
    b.cy = store.y[i] as number;
    b.headingRad = store.heading[i] as number;
    b.halfWidthM = store.halfWidth[i] as number;
    b.halfLengthM = store.halfLength[i] as number;
    refreshObbAxes(b);
    obbVsObb(a, b, t.contact);
    const ux = -t.contact.normalX;
    const uy = -t.contact.normalY;
    // Her velocity at the actor's centre: the rear-axle velocity (forward·vLong + right·vLat) plus yaw × the
    // lever arm from the rear axle (vehicle.ts integrates her pose there), as npc/reactions.ts takes it.
    const s = sin(v.headingRad);
    const c = cos(v.headingRad);
    const rear = params[P_REAR_AXLE] as number;
    const lx = (store.x[i] as number) - (v.xM + s * rear);
    const ly = (store.y[i] as number) - (v.yM - c * rear);
    const yaw = v.yawRateRadPerS;
    const px = s * v.vLongMps + c * v.vLatMps - yaw * ly;
    const py = -c * v.vLongMps + s * v.vLatMps + yaw * lx;
    if (px * ux + py * uy >= (params[P_MIN_CLOSING] as number)) hitActorVehicle(w, i);
    else t.actorBumps += 1;
  }
}

/** A hit on actor vehicle i: the penalty fact, EV.VehicleHit, and its rider falls over (TrafficState.Fallen). */
function hitActorVehicle(w: World, i: number): void {
  const t = w.traffic;
  const store = w.vehicles;
  const kind = store.kind[i] as number;
  t.actorHits += 1;
  const p = pushPenalty(
    w.penalties,
    Offence.Hit,
    store.kindHitPts[kind] as number,
    store.kindHitComplaints[kind] as number,
  );
  w.penalties.x[p] = store.x[i] as number;
  w.penalties.y[p] = store.y[i] as number;
  const e = emitEvent(w.events, EV.VehicleHit, i);
  w.events.a[e] = store.x[i] as number;
  w.events.b[e] = store.y[i] as number;
  w.events.c[e] = kind;
  store.state[i] = TrafficState.Fallen;
  store.stateTicks[i] = 0;
  store.speed[i] = 0;
}

/** Every plan edge bicycle i's body (and MERGE_SETBACK_M ahead of it) is on may be filtered on (edgeFilter). */
function bikeMayFilterHere(t: Traffic, store: VehicleStore, i: number): boolean {
  const base = i * VEHICLE_PLAN_EDGES;
  const n = store.planLen[i] as number;
  const hl = store.halfLength[i] as number;
  let start = -(store.along[i] as number);
  for (let k = 0; k < n; k += 1) {
    const e = store.plan[base + k] as number;
    const len = t.edgeLen[e] as number;
    if (start > hl + MERGE_SETBACK_M) break;
    if (start + len >= -hl && t.edgeFilter[e] === 0) return false;
    start += len;
  }
  return true;
}

/**
 * Is there something slower than filterBelowMps within FILTER_LOOK_M ahead of bicycle i in its lane (its corridor
 * at offset 0, with the margin): Bessie or a vehicle, the nearest one deciding?
 */
function slowAheadInLane(w: World, i: number): boolean {
  const t = w.traffic;
  const store = w.vehicles;
  const lanes = w.level.lanes;
  const sc = t.sc;
  const hl = store.halfLength[i] as number;
  pathBox(w, i);
  sc[HALF_W] = (store.halfWidth[i] as number) + CORRIDOR_MARGIN_M;
  sc[HALF_L] = hl;
  sc[OFF_N] = 0;
  let nearGap = Number.POSITIVE_INFINITY;
  let nearSpeed = 0;
  if (
    boxTouchesCorners(sc, t.bessieCorners, 0) &&
    scanObstacle(t, store, lanes, i, t.bessieCorners, 0) === 1
  ) {
    nearGap = (sc[HIT_ARC] as number) - hl;
    const vb = w.vehicle.vLongMps;
    nearSpeed = vb < 0 ? -vb : vb;
  }
  for (let j = 0; j < store.count; j += 1) {
    if (j === i) continue;
    const off = j * VEHICLE_CORNER_DOUBLES;
    if (!boxTouchesCorners(sc, store.corners, off)) continue;
    if (scanObstacle(t, store, lanes, i, store.corners, off) === 0) continue;
    const gap = (sc[HIT_ARC] as number) - hl;
    if (gap < nearGap) {
      nearGap = gap;
      nearSpeed = store.speed[j] as number;
    }
  }
  return nearGap <= FILTER_LOOK_M && nearSpeed < (t.params[P_FILTER_BELOW] as number);
}

/**
 * May bicycle i rejoin its lane here: is its body back at offset 0, grown by CORRIDOR_MARGIN_M either side and
 * followGapM front and back, clear of Bessie and every other vehicle?
 */
function mergeClear(w: World, i: number): boolean {
  const t = w.traffic;
  const store = w.vehicles;
  const sc = t.sc;
  sc[ARG] = 0;
  sc[LAT_ARG] = 0;
  sc[GROW_W] = CORRIDOR_MARGIN_M;
  sc[GROW_L] = t.params[P_GAP] as number;
  bodyAt(t, store, w.level.lanes, i, t.moveCorners);
  if (cornersOverlap(t.moveCorners, 0, t.bessieCorners, 0)) return false;
  for (let j = 0; j < store.count; j += 1) {
    if (j !== i && cornersOverlap(t.moveCorners, 0, store.corners, j * VEHICLE_CORNER_DOUBLES)) return false;
  }
  return true;
}

/**
 * Bicycle i's sideways move this tick (the header): towards filterOffsetM while it may filter here and something
 * slow is ahead in its lane; back towards its lane once the lane beside it is clear (held at its offset while it
 * is not); at most filterLateralMps × dt, and only to a pose that touches no vehicle and not Bessie.
 */
function stepBikeLateral(w: World, i: number): void {
  const t = w.traffic;
  const store = w.vehicles;
  const lanes = w.level.lanes;
  const sc = t.sc;
  const lat = store.lateral[i] as number;
  let want = 0;
  if (bikeMayFilterHere(t, store, i) && slowAheadInLane(w, i)) want = t.params[P_FILTER_OFF] as number;
  else if (lat > 0 && !mergeClear(w, i)) want = lat;
  if (want === lat) return;
  const step = (t.params[P_FILTER_LAT] as number) * DT_S;
  let next = want > lat ? lat + step : lat - step;
  if (want > lat ? next > want : next < want) next = want;
  sc[ARG] = 0;
  sc[LAT_ARG] = next;
  sc[GROW_W] = 0;
  sc[GROW_L] = 0;
  bodyAt(t, store, lanes, i, t.moveCorners);
  if (cornersOverlap(t.moveCorners, 0, t.bessieCorners, 0)) return;
  for (let j = 0; j < store.count; j += 1) {
    if (j !== i && cornersOverlap(t.moveCorners, 0, store.corners, j * VEHICLE_CORNER_DOUBLES)) return;
  }
  store.lateral[i] = next;
  placeVehicle(t, store, lanes, i);
}

/** The nav edge joining nodes `a` and `b` (they are neighbours), from `a`'s adjacency list. */
function navEdgeOf(nav: Level['nav'], a: number, b: number): number {
  const s1 = nav.adjStart[a + 1] as number;
  for (let k = nav.adjStart[a] as number; k < s1; k += 1)
    if (nav.adjNode[k] === b) return nav.adjEdge[k] as number;
  return 0;
}

/**
 * The nav node a pavement vehicle arriving at `node` from `came` drives to next: uniformly among the other
 * usable edges' far nodes (one `traffic` draw when there are several), else back to `came` if that edge is
 * usable, else −1 (it stops).
 */
function pickNavNext(t: Traffic, nav: Level['nav'], node: number, came: number): number {
  const s0 = nav.adjStart[node] as number;
  const s1 = nav.adjStart[node + 1] as number;
  let ways = 0;
  for (let k = s0; k < s1; k += 1) {
    if (t.navEdgeOk[nav.adjEdge[k] as number] === 1 && nav.adjNode[k] !== came) ways += 1;
  }
  if (ways === 0) {
    for (let k = s0; k < s1; k += 1) {
      if (nav.adjNode[k] === came && t.navEdgeOk[nav.adjEdge[k] as number] === 1) return came;
    }
    return -1;
  }
  let pick = ways === 1 ? 0 : nextInt(t.rng, ways);
  for (let k = s0; k < s1; k += 1) {
    if (t.navEdgeOk[nav.adjEdge[k] as number] !== 1 || nav.adjNode[k] === came) continue;
    if (pick === 0) return nav.adjNode[k] as number;
    pick -= 1;
  }
  return -1;
}

/**
 * The speed cap from the pedestrians ahead of pavement vehicle i, travelling along (sc[UX], sc[UY]), into sc[CAP]
 * (which holds the cap so far): for every person (an NPC with a `hit`, not on a roof) whose circle is within
 * PAVEMENT_SIDE_M of its sides and ahead of its centre, the speed that still stops PAVEMENT_GAP_M short of it.
 */
function pedestrianCap(w: World, i: number): void {
  const t = w.traffic;
  const store = w.vehicles;
  const npc = w.npc;
  const sc = t.sc;
  if (npc.count === 0) return;
  const ux = sc[UX] as number;
  const uy = sc[UY] as number;
  const x = store.x[i] as number;
  const y = store.y[i] as number;
  const hw = store.halfWidth[i] as number;
  const hl = store.halfLength[i] as number;
  const reach = hl + PAVEMENT_LOOK_M;
  const ex = x + ux * reach;
  const ey = y + uy * reach;
  const m = hw + 1;
  const box = t.box;
  box.minX = (x < ex ? x : ex) - m;
  box.minY = (y < ey ? y : ey) - m;
  box.maxX = (x > ex ? x : ex) + m;
  box.maxY = (y > ey ? y : ey) + m;
  const n = queryNpcs(npc, box, t.npcFound);
  const hasHit = w.npcAi.reactions.hasHit;
  let cap = sc[CAP] as number;
  for (let k = 0; k < n; k += 1) {
    const j = t.npcFound[k] as number;
    if (((npc.flags[j] as number) & NPC_FLAG.ON_ROOF) !== 0 || hasHit[npc.kind[j] as number] !== 1) continue;
    const rx = (npc.x[j] as number) - x;
    const ry = (npc.y[j] as number) - y;
    const u = rx * ux + ry * uy;
    if (!(u > 0)) continue;
    const across = ry * ux - rx * uy;
    const r = npc.radius[j] as number;
    if ((across < 0 ? -across : across) > hw + r + PAVEMENT_SIDE_M) continue;
    sc[ARG] = u - hl - r - PAVEMENT_GAP_M;
    stopSpeed(sc);
    const vs = sc[OUT] as number;
    if (vs < cap) cap = vs;
  }
  sc[CAP] = cap;
}

/**
 * A pavement vehicle's tick (the header): its speed (kindSpeedMps, capped by the pedestrians ahead), the move
 * along its nav edges (a new edge at each node, pickNavNext), not taken when the body where it would end the
 * tick touches Bessie or another vehicle (turning at a node included), turned round after kindTurnTicks held,
 * its pose, and its retirement beyond NPC_DESPAWN_M off the view.
 */
function drivePavementVehicle(w: World, i: number): void {
  const t = w.traffic;
  const store = w.vehicles;
  const nav = w.level.nav;
  const sc = t.sc;
  const params = t.params;
  const kind = store.kind[i] as number;
  const from0 = store.navFrom[i] as number;
  const to0 = store.navTo[i] as number;
  const along0 = store.along[i] as number;
  let from = from0;
  let to = to0;
  let edge = navEdgeOf(nav, from, to);
  let fx = nav.nodeX[from] as number;
  let fy = nav.nodeY[from] as number;
  let len = t.navEdgeLen[edge] as number;
  let ux = ((nav.nodeX[to] as number) - fx) / len;
  let uy = ((nav.nodeY[to] as number) - fy) / len;
  const v0 = store.speed[i] as number;
  const slow = params[P_SLOW] as number;
  sc[DECEL] = params[P_DECEL] as number;
  let target = t.kindSpeedMps[kind] as number;
  let bind: number = Blocker.None;
  let bindIndex = -1;
  sc[UX] = ux;
  sc[UY] = uy;
  sc[CAP] = target;
  pedestrianCap(w, i);
  if ((sc[CAP] as number) < target) {
    target = sc[CAP] as number;
    bind = Blocker.Pedestrian;
  }
  let v = v0 + (params[P_ACCEL] as number) * DT_S;
  if (v > target) v = target;
  if (v < 0) v = 0;
  // The move, node by node.
  let along = along0 + v * DT_S;
  while (along >= len) {
    const next = pickNavNext(t, nav, to, from);
    if (next < 0) {
      along = len;
      v = 0;
      break;
    }
    along -= len;
    from = to;
    to = next;
    edge = navEdgeOf(nav, from, to);
    fx = nav.nodeX[from] as number;
    fy = nav.nodeY[from] as number;
    len = t.navEdgeLen[edge] as number;
    ux = ((nav.nodeX[to] as number) - fx) / len;
    uy = ((nav.nodeY[to] as number) - fy) / len;
  }
  if (v > 0) {
    // Never into Bessie or another vehicle: the body where the move ends must touch neither.
    sc[BOX_CX] = fx + ux * along;
    sc[BOX_CY] = fy + uy * along;
    sc[BOX_FX] = ux;
    sc[BOX_FY] = uy;
    sc[BOX_HW] = store.halfWidth[i] as number;
    sc[BOX_HL] = store.halfLength[i] as number;
    boxCorners(sc, t.moveCorners);
    let hit: number = Blocker.None;
    if (cornersOverlap(t.moveCorners, 0, t.bessieCorners, 0)) {
      t.contactStops += 1;
      hit = Blocker.Bessie;
    } else {
      for (let j = 0; j < store.count; j += 1) {
        if (j === i || !cornersOverlap(t.moveCorners, 0, store.corners, j * VEHICLE_CORNER_DOUBLES)) continue;
        hit = Blocker.Vehicle;
        bindIndex = j;
        break;
      }
    }
    if (hit !== Blocker.None) {
      // Stay where it was.
      v = 0;
      bind = hit;
      from = from0;
      to = to0;
      along = along0;
      edge = navEdgeOf(nav, from, to);
      fx = nav.nodeX[from] as number;
      fy = nav.nodeY[from] as number;
      len = t.navEdgeLen[edge] as number;
      ux = ((nav.nodeX[to] as number) - fx) / len;
      uy = ((nav.nodeY[to] as number) - fy) / len;
    }
  }
  const held = bind !== Blocker.None && v < slow;
  if (held) {
    const waited = (store.blockTicks[i] as number) + 1;
    if (waited >= (t.kindTurnTicks[kind] as number)) {
      // Held up too long: turn round on the edge (the same footprint, facing the other way).
      const k = from;
      from = to;
      to = k;
      fx = nav.nodeX[from] as number;
      fy = nav.nodeY[from] as number;
      ux = -ux;
      uy = -uy;
      along = len - along;
      store.blockTicks[i] = 0;
    } else {
      store.blockTicks[i] = waited;
    }
  } else {
    store.blockTicks[i] = 0;
  }
  store.navFrom[i] = from;
  store.navTo[i] = to;
  store.along[i] = along;
  store.speed[i] = v;
  store.x[i] = fx + ux * along;
  store.y[i] = fy + uy * along;
  store.heading[i] = (
    (nav.edgeFrom[edge] as number) === from ? t.navHeadingFwd[edge] : t.navHeadingBack[edge]
  ) as number;
  updateVehicleCorners(store, i);
  store.blocker[i] = held ? bind : Blocker.None;
  store.blockerIndex[i] = held ? bindIndex : -1;
  store.gapM[i] = held ? 0 : -1;
  const state = held ? TrafficState.Queue : TrafficState.Cruise;
  store.stateTicks[i] = state === (store.state[i] as number) ? (store.stateTicks[i] as number) + 1 : 1;
  store.state[i] = state;
  // Retire one left behind, beyond NPC_DESPAWN_M of Bessie and off the view, on the spawner's beat.
  if (w.tick % PAVEMENT_SPAWN_EVERY_TICKS === 0) {
    const ox = (store.x[i] as number) - w.vehicle.xM;
    const oy = (store.y[i] as number) - w.vehicle.yM;
    if (
      ox * ox + oy * oy > NPC_DESPAWN_M * NPC_DESPAWN_M &&
      !cornersTouchViewRect(store.corners, i * VEHICLE_CORNER_DOUBLES, w.viewRect)
    ) {
      t.doomed[i] = 1;
    }
  }
}

/**
 * The pavement vehicles' spawn (the header), on ticks that are a multiple of PAVEMENT_SPAWN_EVERY_TICKS and only
 * with room in the store: for the first pavement kind with fewer out than spawns.traffic.pavement wants, one at a
 * nav node with a usable edge whose circle (the body's half diagonal) does not touch world.viewRect, within
 * NPC_DESPAWN_M of Bessie, drawn uniformly, heading along one of its usable edges (uniform), at rest. No eligible
 * node, or a body that would touch Bessie or a vehicle there, and nothing spawns this beat.
 */
function spawnPavement(w: World): void {
  const t = w.traffic;
  const store = w.vehicles;
  if (t.pavementKinds === 0 || w.tick % PAVEMENT_SPAWN_EVERY_TICKS !== 0) return;
  if (store.count >= store.capacity) return;
  const nav = w.level.nav;
  const rect = w.viewRect;
  const bx = w.vehicle.xM;
  const by = w.vehicle.yM;
  const far = NPC_DESPAWN_M * NPC_DESPAWN_M;
  for (let p = 0; p < t.pavementKinds; p += 1) {
    const kind = t.pavementKind[p] as number;
    let live = 0;
    for (let j = 0; j < store.count; j += 1) if (store.kind[j] === kind) live += 1;
    if (live >= (t.pavementWant[p] as number)) continue;
    const hw = store.kindHalfWidth[kind] as number;
    const hl = store.kindHalfLength[kind] as number;
    const r2 = hw * hw + hl * hl;
    let count = 0;
    for (let pass = 0; pass < 2; pass += 1) {
      let pick = pass === 0 ? -1 : count === 1 ? 0 : nextInt(t.rng, count);
      if (pass === 1 && count === 0) return;
      for (let node = 0; node < nav.nodeCount; node += 1) {
        if ((t.navNodeWays[node] as number) === 0) continue;
        const x = nav.nodeX[node] as number;
        const y = nav.nodeY[node] as number;
        const ox = x - bx;
        const oy = y - by;
        if (ox * ox + oy * oy > far) continue;
        const cx = x < rect.minX ? rect.minX : x > rect.maxX ? rect.maxX : x;
        const cy = y < rect.minY ? rect.minY : y > rect.maxY ? rect.maxY : y;
        if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= r2) continue;
        if (pass === 0) {
          count += 1;
          continue;
        }
        if (pick > 0) {
          pick -= 1;
          continue;
        }
        spawnPavementAt(w, kind, node);
        return;
      }
    }
    return;
  }
}

/** Add a pavement vehicle of `kind` at nav node `node`, along one of its usable edges (spawnPavement). */
function spawnPavementAt(w: World, kind: number, node: number): void {
  const t = w.traffic;
  const store = w.vehicles;
  const nav = w.level.nav;
  const sc = t.sc;
  const ways = t.navNodeWays[node] as number;
  let pick = ways === 1 ? 0 : nextInt(t.rng, ways);
  let to = -1;
  for (let k = nav.adjStart[node] as number; k < (nav.adjStart[node + 1] as number); k += 1) {
    if (t.navEdgeOk[nav.adjEdge[k] as number] !== 1) continue;
    if (pick === 0) {
      to = nav.adjNode[k] as number;
      break;
    }
    pick -= 1;
  }
  if (to < 0) return;
  const edge = navEdgeOf(nav, node, to);
  const x = nav.nodeX[node] as number;
  const y = nav.nodeY[node] as number;
  const len = t.navEdgeLen[edge] as number;
  sc[BOX_CX] = x;
  sc[BOX_CY] = y;
  sc[BOX_FX] = ((nav.nodeX[to] as number) - x) / len;
  sc[BOX_FY] = ((nav.nodeY[to] as number) - y) / len;
  sc[BOX_HW] = store.kindHalfWidth[kind] as number;
  sc[BOX_HL] = store.kindHalfLength[kind] as number;
  boxCorners(sc, t.spawnCorners);
  if (cornersOverlap(t.spawnCorners, 0, t.bessieCorners, 0)) return;
  for (let j = 0; j < store.count; j += 1) {
    if (cornersOverlap(t.spawnCorners, 0, store.corners, j * VEHICLE_CORNER_DOUBLES)) return;
  }
  const i = addVehicle(store, kind, VEHICLE_FLAG.PAVEMENT);
  store.navFrom[i] = node;
  store.navTo[i] = to;
  store.along[i] = 0;
  store.speed[i] = 0;
  store.x[i] = x;
  store.y[i] = y;
  store.heading[i] = (
    (nav.edgeFrom[edge] as number) === node ? t.navHeadingFwd[edge] : t.navHeadingBack[edge]
  ) as number;
  store.prevX[i] = x;
  store.prevY[i] = y;
  store.prevHeading[i] = store.heading[i] as number;
  updateVehicleCorners(store, i);
}

// ---------------------------------------------------------------------------------------------------------
// Spawning
// ---------------------------------------------------------------------------------------------------------

/**
 * Could a vehicle of `kind` enter at entry portal edge `edge` now? Its body (front bumper on the portal node,
 * so wholly outside the map) must be off world.viewRect, and the road ahead of it clear of Bessie and every
 * vehicle for followGapM plus its braking distance from the edge's speed limit.
 */
function spawnFits(w: World, kind: number, edge: number): boolean {
  const t = w.traffic;
  const store = w.vehicles;
  const lanes = w.level.lanes;
  const sc = t.sc;
  const node = lanes.edgeFrom[edge] as number;
  const fx = t.edgeDirX[edge] as number;
  const fy = t.edgeDirY[edge] as number;
  const hl = store.kindHalfLength[kind] as number;
  const hw = store.kindHalfWidth[kind] as number;
  const limits = kind === t.bicycleKind ? t.bikeEdgeSpeed : lanes.edgeSpeedMps;
  const cx = (lanes.nodeX[node] as number) - fx * hl;
  const cy = (lanes.nodeY[node] as number) - fy * hl;
  sc[BOX_FX] = fx;
  sc[BOX_FY] = fy;
  sc[BOX_CX] = cx;
  sc[BOX_CY] = cy;
  sc[BOX_HW] = hw;
  sc[BOX_HL] = hl;
  boxCorners(sc, t.spawnCorners);
  if (cornersTouchViewRect(t.spawnCorners, 0, w.viewRect)) return false;
  const lim = limits[edge] as number;
  const clear = (t.params[P_GAP] as number) + (lim * lim) / (2 * (t.params[P_DECEL] as number));
  sc[BOX_CX] = cx + fx * clear * 0.5;
  sc[BOX_CY] = cy + fy * clear * 0.5;
  sc[BOX_HW] = hw + CORRIDOR_MARGIN_M;
  sc[BOX_HL] = hl + clear * 0.5;
  boxCorners(sc, t.clearCorners);
  if (cornersOverlap(t.clearCorners, 0, t.bessieCorners, 0)) return false;
  for (let j = 0; j < store.count; j += 1) {
    if (cornersOverlap(t.clearCorners, 0, store.corners, j * VEHICLE_CORNER_DOUBLES)) return false;
  }
  return true;
}

/** Add a vehicle of `kind` at entry portal edge `edge` (spawnFits said yes) at the edge's speed limit. */
function spawnAt(w: World, kind: number, edge: number, flags: number): number {
  const store = w.vehicles;
  const t = w.traffic;
  const lanes = w.level.lanes;
  const i = addVehicle(store, kind, flags);
  store.plan[i * VEHICLE_PLAN_EDGES] = edge;
  store.planLen[i] = 1;
  store.along[i] = -(store.halfLength[i] as number);
  store.speed[i] = (kind === t.bicycleKind ? t.bikeEdgeSpeed : lanes.edgeSpeedMps)[edge] as number;
  if ((flags & VEHICLE_FLAG.BUS_ROUTE) !== 0) store.routeAt[i] = 1;
  if (kind === t.taxiKind) drawFare(t, store, i);
  fillPlan(w, i);
  placeVehicle(t, store, lanes, i);
  store.prevX[i] = store.x[i] as number;
  store.prevY[i] = store.y[i] as number;
  store.prevHeading[i] = store.heading[i] as number;
  return i;
}

/**
 * Spawn a lane vehicle of `kind` (a VEHICLE_IDS index, not a parked or pavement kind) at entry portal edge `edge`
 * now, if the store has room and it fits there (spawnFits: off world.viewRect, the road ahead clear): its store
 * index, or −1. For scripted arrivals and tests (SSP-091); the ambient traffic is spawnTraffic's.
 */
export function spawnLaneVehicle(w: World, kind: number, edge: number): number {
  const store = w.vehicles;
  if (store.count >= store.capacity || w.traffic.kindPavement[kind] === 1) return -1;
  if (((w.level.lanes.edgeFlags[edge] as number) & LANE_FLAG.PORTAL_IN) === 0) return -1;
  if (!spawnFits(w, kind, edge)) return -1;
  const i = spawnAt(w, kind, edge, 0);
  updateVehicleCorners(store, i);
  rebuildVehicleGrid(store);
  return i;
}

/**
 * At most one spawn a tick: a scheduled bus that is due (at its route's entry portal), else, while the ambient
 * moving count is under spawns.traffic.moving, one vehicle of a kind drawn by `mix` weight at an entry portal
 * drawn uniformly among those it fits (spawnFits). Never past capacity − parked moving vehicles (the pavement
 * vehicles count in those, not in the ambient lane count). Returns whether a vehicle spawned.
 */
function spawnTraffic(w: World): boolean {
  const t = w.traffic;
  const store = w.vehicles;
  const moving = store.count - store.parkedCount;
  if (moving >= store.capacity - store.parkedCount) return false;
  if (t.busesDue > 0) {
    const edge = t.busRoute[0] as number;
    if (spawnFits(w, t.busKind, edge)) {
      spawnAt(w, t.busKind, edge, VEHICLE_FLAG.BUS_ROUTE);
      t.busesDue -= 1;
      t.busesSpawned += 1;
      return true;
    }
  }
  let notAmbient = 0;
  for (let j = 0; j < store.count; j += 1) {
    if (((store.flags[j] as number) & (VEHICLE_FLAG.BUS_ROUTE | VEHICLE_FLAG.PAVEMENT)) !== 0)
      notAmbient += 1;
  }
  if (moving - notAmbient >= t.movingTarget || t.mixCount === 0 || !(t.mixTotal > 0) || t.portalCount === 0) {
    return false;
  }
  let r = ((nextInt(t.rng, MIX_STEPS) + 0.5) / MIX_STEPS) * t.mixTotal;
  let kind = t.mixKind[t.mixCount - 1] as number;
  for (let m = 0; m < t.mixCount; m += 1) {
    r -= t.mixWeight[m] as number;
    if (r < 0) {
      kind = t.mixKind[m] as number;
      break;
    }
  }
  let eligible = 0;
  for (let p = 0; p < t.portalCount; p += 1) {
    const e = t.portalEdge[p] as number;
    if (spawnFits(w, kind, e)) {
      t.eligible[eligible] = e;
      eligible += 1;
    }
  }
  if (eligible === 0) return false;
  spawnAt(w, kind, t.eligible[eligible === 1 ? 0 : nextInt(t.rng, eligible)] as number, 0);
  return true;
}

// ---------------------------------------------------------------------------------------------------------
// The kerb gap check (phase 7)
// ---------------------------------------------------------------------------------------------------------

/**
 * The SSP-081 kerb gap hook (npc/steering.ts CrossingGapCheck), installed by createWorld: may the pedestrian
 * waiting at a kerb of crossing nav edge `edge` step out? Not while any moving vehicle's body is on the
 * crossing's corridor (its segment, CROSSING_HALF_WIDTH_M either side), nor while one is coming that would
 * reach it too soon: at a zebra, a moving vehicle closer than its braking distance plus ZEBRA_REACTION_S of
 * travel (a standing one never holds a zebra: it waits for the occupancy); at any other crossing, closer than
 * crossingGapS of travel plus followGapM. Allocation-free.
 */
export const trafficCrossingClear: CrossingGapCheck = (w, _i, edge) => {
  const store = w.vehicles;
  if (store.count === store.parkedCount) return true;
  const t = w.traffic;
  const nav = w.level.nav;
  const lanes = w.level.lanes;
  const sc = t.sc;
  const a = nav.edgeFrom[edge] as number;
  const b = nav.edgeTo[edge] as number;
  const x0 = nav.nodeX[a] as number;
  const y0 = nav.nodeY[a] as number;
  const dx = (nav.nodeX[b] as number) - x0;
  const dy = (nav.nodeY[b] as number) - y0;
  const len = sqrt(dx * dx + dy * dy);
  if (!(len > 0)) return true;
  sc[BOX_FX] = dx / len;
  sc[BOX_FY] = dy / len;
  sc[BOX_CX] = x0 + dx * 0.5;
  sc[BOX_CY] = y0 + dy * 0.5;
  sc[BOX_HW] = CROSSING_HALF_WIDTH_M;
  sc[BOX_HL] = len * 0.5;
  boxCorners(sc, t.crossCorners);
  const zebra = ((nav.edgeFlags[edge] as number) & NAV_FLAG.ZEBRA) !== 0;
  const mx = sc[BOX_CX] as number;
  const my = sc[BOX_CY] as number;
  const decel = t.params[P_DECEL] as number;
  const gap = t.params[P_GAP] as number;
  const gapS = t.params[P_CROSS_GAP_S] as number;
  for (let j = 0; j < store.count; j += 1) {
    if (((store.flags[j] as number) & (VEHICLE_FLAG.PARKED | VEHICLE_FLAG.PAVEMENT)) !== 0) continue;
    if (cornersOverlap(store.corners, j * VEHICLE_CORNER_DOUBLES, t.crossCorners, 0)) return false;
    const hl = store.halfLength[j] as number;
    const ox = (store.x[j] as number) - mx;
    const oy = (store.y[j] as number) - my;
    const reach = LOOKAHEAD_M + hl + len;
    if (ox * ox + oy * oy > reach * reach) continue;
    sc[HALF_W] = (store.halfWidth[j] as number) + CORRIDOR_MARGIN_M;
    sc[HALF_L] = hl;
    sc[OFF_N] = store.lateral[j] as number;
    if (scanObstacle(t, store, lanes, j, t.crossCorners, 0) === 0) continue;
    const d = (sc[HIT_ARC] as number) - hl;
    const v = store.speed[j] as number;
    if (zebra) {
      if (v > 0 && d < (v * v) / (2 * decel) + v * ZEBRA_REACTION_S) return false;
    } else if (d < v * gapS + gap) {
      return false;
    }
  }
  return true;
};
