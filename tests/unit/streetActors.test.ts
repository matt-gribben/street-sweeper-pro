// SSP-103: the street's actors (TECHNICAL_DESIGN §12.5, §12.7; ART_BIBLE §4.5, §5.6, §6.4, §8.3, §10.2). State to
// frame (actorFrames.ts): the fall, startle, angry, idle and per-kind timings, the distance-driven walk, the
// directions and their hysteresis; the actors batch instances StreetActors writes (streetActors.ts): frames, layers,
// interpolation, the riding and perched cats, flying pigeons, the per-instance swap rows, culling through the
// spatial hashes, north-to-south order, the dog lead's runs; and the per-frame path's no-allocation rules. Built on
// the committed actors atlas, no WebGL.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { FRAME, type FrameId } from '../../src/gen/assets.ts';
import {
  ACTOR_DIRS,
  ACTOR_SETS,
  ActorAnim,
  ActorRig,
  actorDirId,
  actorDirIndex,
  actorFrame,
  birdDirIndex,
  DOG_SET,
  frameFor,
  HUMAN_IDS,
  poseCode,
  VEHICLE_FRAMES,
  vehicleHeadingIndex,
  walkFrameAt,
} from '../../src/render/actorFrames.ts';
import { createBessieSprite } from '../../src/render/bessieSprite.ts';
import { cameraGroundRect, createCameraRig, pinCameraRig } from '../../src/render/camera.ts';
import { headingIndex } from '../../src/render/headings.ts';
import { createPose, type Pose } from '../../src/render/interpolate.ts';
import { loadAtlas, type SpriteAtlas } from '../../src/render/spriteAtlas.ts';
import { INSTANCE_STRIDE, SpriteFlag } from '../../src/render/spriteBatch.ts';
import {
  actorPhase,
  actorRenderSeed,
  ELEVATED_SHADOW_LIFT_PX,
  LEAD_COLOUR,
  LEAD_RUN_BUDGET,
  leadRuns,
  STREET_CULL_MARGIN_M,
  StreetActors,
  streetSpriteCapacity,
  WALKER_DOG_COAT_SLOT,
} from '../../src/render/streetActors.ts';
import { DepthLayer } from '../../src/render/worldMaterial.ts';
import type { Aabb } from '../../src/sim/collision/obb.ts';
import { PX_PER_M } from '../../src/sim/constants.ts';
import { NPC_IDS, VEHICLE_IDS } from '../../src/sim/entities.ts';
import { createInputFrame } from '../../src/sim/inputFrame.ts';
import { createBlankLevel, decodeLevel, type Level } from '../../src/sim/map.ts';
import { CAT } from '../../src/sim/npc/behaviours/cat.ts';
import { DOG } from '../../src/sim/npc/behaviours/dogWalker.ts';
import { LITTERBUG } from '../../src/sim/npc/behaviours/litterbug.ts';
import { DORIS } from '../../src/sim/npc/behaviours/oldWoman.ts';
import { PED } from '../../src/sim/npc/behaviours/pedestrian.ts';
import { PIGEON } from '../../src/sim/npc/behaviours/pigeon.ts';
import {
  addNpcAt,
  createNpcStore,
  NPC_FLAG,
  NpcOrigin,
  type NpcStore,
  npcHandle,
  updateNpcCell,
} from '../../src/sim/npc/store.ts';
import { DEFAULT_ENTITIES, DEFAULT_TUNING } from '../../src/sim/tuning.ts';
import {
  addVehicle,
  createVehicleStore,
  rebuildVehicleGrid,
  VEHICLE_FLAG,
  type VehicleStore,
} from '../../src/sim/vehicleStore.ts';
import { createWorld } from '../../src/sim/world.ts';
import { assertHeapDeltaWithinThresholds, measureHeapDelta } from '../support/heapDelta.ts';
import { decodePng } from '../support/png.ts';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const RENDER_WARMUP_FRAMES = 20_000;

// Instance layout (spriteBatch.ts): offset 0..2, rotation 3, frameRect 4..7, pivot 8..9, swap 10, flags 11,
// layer 12, sortBias 13, atlas 14, shadowLift 15.
const O_X = 0;
const O_Y = 2;
const O_RECT = 4;
const O_SWAP = 10;
const O_FLAGS = 11;
const O_LAYER = 12;
const O_LIFT = 15;

const kindOf = (id: (typeof NPC_IDS)[number]): number => NPC_IDS.indexOf(id);
const vehicleKind = (id: (typeof VEHICLE_IDS)[number]): number => VEHICLE_IDS.indexOf(id);

let actors: SpriteAtlas;
beforeAll(async () => {
  actors = await loadAtlas('actors', {
    fetchJson: async (url) =>
      JSON.parse(readFileSync(`${REPO_ROOT}public/${url.replace(/^\//, '')}`, 'utf8')),
    fetchImage: async (url) => decodePng(readFileSync(`${REPO_ROOT}public/${url.replace(/^\//, '')}`)),
  });
});

/** The frame whose rect a written instance carries (instances are matched by rect). */
function frameAt(data: Float32Array, k: number): FrameId {
  const o = k * INSTANCE_STRIDE;
  const hit = (Object.keys(FRAME) as FrameId[]).find((id) => {
    const f = FRAME[id];
    return (
      f.atlas === 'actors' &&
      f.x === data[o + O_RECT] &&
      f.y === data[o + O_RECT + 1] &&
      f.w === data[o + O_RECT + 2] &&
      f.h === data[o + O_RECT + 3]
    );
  });
  if (hit === undefined) throw new Error(`instance ${k} matches no actors frame`);
  return hit;
}

/** A 40×40-tile blank level, stores on it, a street renderer and Bessie's batches sized for them. */
function rig(): {
  npc: NpcStore;
  vehicles: VehicleStore;
  street: StreetActors;
  draw: (alpha?: number, camera?: Aabb, bessie?: Pose) => void;
  bessie: ReturnType<typeof createBessieSprite>;
} {
  const level: Level = createBlankLevel('district.test_street', 40, 40);
  const npc = createNpcStore(level);
  const vehicles = createVehicleStore(level, DEFAULT_ENTITIES);
  const street = new StreetActors(actors, { seed: 7 });
  const capacity = streetSpriteCapacity();
  const bessie = createBessieSprite(actors, 40, { extraSprites: capacity, extraShadows: capacity });
  const pose = createPose();
  pose.xM = 70;
  pose.yM = 70;
  const view: Aabb = { minX: 0, minY: 0, maxX: 80, maxY: 80 };
  const draw = (alpha = 1, camera: Aabb = view, at: Pose = pose): void => {
    rebuildVehicleGrid(vehicles);
    bessie.sprites.begin(40);
    bessie.shadows.begin(40);
    street.update(npc, vehicles, alpha, camera, at, bessie.sprites, bessie.shadows);
    bessie.sprites.end();
    bessie.shadows.end();
  };
  return { npc, vehicles, street, draw, bessie };
}

/** Adds an NPC of `id` at (x, y) facing `headingRad`, in `state` for `stateTicks`. */
function addNpc(
  npc: NpcStore,
  id: (typeof NPC_IDS)[number],
  x: number,
  y: number,
  headingRad = Math.PI,
  state = 1,
  stateTicks = 1,
  origin: number = NpcOrigin.Ambient,
): number {
  const i = addNpcAt(npc, kindOf(id), origin, x, y);
  npc.heading[i] = headingRad;
  npc.state[i] = state;
  npc.stateTicks[i] = stateTicks;
  return i;
}

describe('state to frame (actorFrames.ts)', () => {
  it('frameFor(Fallen, stateTicks 7) is fall frame 1; at stateTicks 20 the held frame 2', () => {
    expect(frameFor(ActorRig.Pedestrian, PED.Fallen, 7)).toBe(poseCode(ActorAnim.Fall, 1));
    expect(frameFor(ActorRig.Pedestrian, PED.Fallen, 20)).toBe(poseCode(ActorAnim.Fall, 2));
    // 3 × 5 ticks, then frame 2 held to the end of the 87-tick fall.
    const frames = Array.from(
      { length: 87 },
      (_, t) => frameFor(ActorRig.Pedestrian, PED.Fallen, t + 1) % 16,
    );
    expect(frames.slice(0, 15)).toEqual([0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2]);
    expect(new Set(frames.slice(10))).toEqual(new Set([2]));
    // Getting up plays frames 1, 0 at 5 ticks.
    const getUp = Array.from({ length: 10 }, (_, t) => frameFor(ActorRig.Pedestrian, PED.GetUp, t + 1));
    expect(getUp).toEqual([
      ...Array(5).fill(poseCode(ActorAnim.Fall, 1)),
      ...Array(5).fill(poseCode(ActorAnim.Fall, 0)),
    ]);
  });

  it('startle hops on frame 0 for 4 ticks then holds frame 1; angry alternates every 9 ticks', () => {
    const startle = Array.from({ length: 8 }, (_, t) => frameFor(ActorRig.Pedestrian, PED.Startle, t + 1));
    expect(startle).toEqual([
      ...Array(4).fill(poseCode(ActorAnim.Startle, 0)),
      ...Array(4).fill(poseCode(ActorAnim.Startle, 1)),
    ]);
    const angry = Array.from({ length: 54 }, (_, t) => frameFor(ActorRig.Pedestrian, PED.Angry, t + 1) % 16);
    expect(angry.slice(0, 19)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0]);
    expect(Math.floor(frameFor(ActorRig.Pedestrian, PED.Angry, 1) / 16)).toBe(ActorAnim.Angry);
  });

  it('idle frames last 36 ticks, offset by the phase; walking states at rest play idle', () => {
    const idle = (t: number, phase: number): number =>
      frameFor(ActorRig.Pedestrian, PED.Idle, t, false, 0, phase);
    expect(idle(1, 0)).toBe(poseCode(ActorAnim.Idle, 0));
    expect(idle(36, 0)).toBe(poseCode(ActorAnim.Idle, 0));
    expect(idle(37, 0)).toBe(poseCode(ActorAnim.Idle, 1));
    expect(idle(73, 0)).toBe(poseCode(ActorAnim.Idle, 0));
    expect(idle(1, 36)).toBe(poseCode(ActorAnim.Idle, 1));
    expect(frameFor(ActorRig.Pedestrian, PED.Yield, 1)).toBe(poseCode(ActorAnim.Idle, 0));
    expect(frameFor(ActorRig.Pedestrian, PED.Walk, 9, true, 3)).toBe(poseCode(ActorAnim.Walk, 3));
    expect(frameFor(ActorRig.Pedestrian, PED.Cross, 9, true, 2)).toBe(poseCode(ActorAnim.Walk, 2));
    expect(frameFor(ActorRig.Pedestrian, PED.Walk, 9, false, 3)).toBe(poseCode(ActorAnim.Idle, 0));
  });

  it('maps the kinds’ own states: Doris, the litterbug, the dog, the cat and the pigeon', () => {
    expect(frameFor(ActorRig.Doris, DORIS.Glare, 50, false, 0, 40)).toBe(poseCode(ActorAnim.Idle, 0));
    expect(frameFor(ActorRig.Doris, DORIS.FistShake, 10)).toBe(poseCode(ActorAnim.Angry, 1));
    expect(frameFor(ActorRig.Doris, DORIS.Chase, 3, true, 1)).toBe(poseCode(ActorAnim.Walk, 1));
    expect(frameFor(ActorRig.Doris, DORIS.SlowWalk, 3, true, 2)).toBe(poseCode(ActorAnim.Walk, 2));
    expect(frameFor(ActorRig.Litterbug, LITTERBUG.Slink, 3, true, 1)).toBe(poseCode(ActorAnim.Walk, 1));
    expect(frameFor(ActorRig.Dog, DOG.Roam, 3, true, 2)).toBe(poseCode(ActorAnim.Walk, 2));
    expect(frameFor(ActorRig.Dog, DOG.Roam, 3, false, 2)).toBe(poseCode(ActorAnim.Sit, 0));
    expect(frameFor(ActorRig.Dog, DOG.Sit, 31)).toBe(poseCode(ActorAnim.Sit, 1));
    expect(frameFor(ActorRig.Dog, DOG.Bark, 7)).toBe(poseCode(ActorAnim.Bark, 1));
    expect(frameFor(ActorRig.Cat, CAT.Perch, 90)).toBe(poseCode(ActorAnim.Sit, 0));
    expect(frameFor(ActorRig.Cat, CAT.Perch, 91)).toBe(poseCode(ActorAnim.Sit, 1));
    expect(frameFor(ActorRig.Cat, CAT.Perch, 103)).toBe(poseCode(ActorAnim.Sit, 0));
    expect(frameFor(ActorRig.Cat, CAT.Dart, 4, true)).toBe(poseCode(ActorAnim.Dart, 1));
    expect(frameFor(ActorRig.Cat, CAT.Bolt, 1, true)).toBe(poseCode(ActorAnim.Dart, 0));
    expect(frameFor(ActorRig.Cat, CAT.Groom, 1, true, 3)).toBe(poseCode(ActorAnim.Walk, 3));
    expect(frameFor(ActorRig.Cat, CAT.Groom, 1, false, 3)).toBe(poseCode(ActorAnim.Sit, 0));
    const leap = Array.from({ length: 16 }, (_, t) => frameFor(ActorRig.Cat, CAT.LeapOnRoof, t + 1) % 16);
    expect(leap).toEqual([0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2]);
    expect(frameFor(ActorRig.Cat, CAT.RideRoof, 50)).toBe(poseCode(ActorAnim.Sit, 0));
    expect(frameFor(ActorRig.Cat, CAT.HopOff, 5)).toBe(poseCode(ActorAnim.Leap, 1));
    expect(frameFor(ActorRig.Cat, CAT.HopOff, 17, true)).toBe(poseCode(ActorAnim.Dart, 0));
    expect(frameFor(ActorRig.Pigeon, PIGEON.Fly, 5)).toBe(poseCode(ActorAnim.Fly, 1));
    expect(frameFor(ActorRig.Pigeon, PIGEON.Fly, 13)).toBe(poseCode(ActorAnim.Fly, 0));
    // Peck: frame 0 held 12 + phase mod 19 ticks, then frame 1 for 6.
    const peck = Array.from(
      { length: 18 },
      (_, t) => frameFor(ActorRig.Pigeon, PIGEON.Peck, t + 1, false, 0, 0) % 16,
    );
    expect(peck).toEqual([...Array(12).fill(0), ...Array(6).fill(1)]);
  });

  it('walk frames advance once per stride along the walking axis, whatever the speed', () => {
    expect(walkFrameAt(0, 0.3)).toBe(0);
    expect(walkFrameAt(0.299, 0.3)).toBe(0);
    expect(walkFrameAt(0.3, 0.3)).toBe(1);
    expect(walkFrameAt(1.2, 0.3)).toBe(0);
    expect(walkFrameAt(-0.01, 0.3)).toBe(3);
    const strides = Object.fromEntries(ACTOR_SETS.map((s) => [s.asset, s.strideM]));
    expect(strides).toMatchObject({
      'npc.shopper': 0.3,
      'npc.old_woman': 0.18,
      'npc.old_man_frame': 0.15,
      'npc.cat': 0.12,
      'npc.dog_loose': 0.35,
    });
  });

  it('heading 90° is dir e for actors and h08 for vehicles', () => {
    expect(actorDirId(Math.PI / 2)).toBe('e');
    expect(ACTOR_DIRS[actorDirIndex(Math.PI / 2)]).toBe('e');
    expect(vehicleHeadingIndex(Math.PI / 2)).toBe(8);
    expect(headingIndex(Math.PI / 2)).toBe(8);
    expect(VEHICLE_FRAMES[vehicleKind('veh.hatchback')]?.[8]).toBe('veh.hatchback:body:h08:0');
    expect(actorDirId(0)).toBe('n');
    expect(actorDirId(Math.PI)).toBe('s');
    expect(actorDirId(-Math.PI / 2)).toBe('w');
    expect(actorDirId((5 * Math.PI) / 4)).toBe('sw');
    expect(birdDirIndex(Math.PI / 2)).toBe(1); // e
    expect(birdDirIndex(Math.PI * 0.74)).toBe(1);
    expect(birdDirIndex(Math.PI * 0.76)).toBe(2); // s
  });

  it('keeps the drawn direction within 10° past a sector edge, and a vehicle heading within 2°', () => {
    const deg = Math.PI / 180;
    expect(actorDirIndex(30 * deg)).toBe(1); // nearest: ne
    expect(actorDirIndex(30 * deg, 0)).toBe(0); // 30° is within 22.5° + 10° of n
    expect(actorDirIndex(33 * deg, 0)).toBe(1);
    expect(actorDirIndex(-30 * deg, 0)).toBe(0);
    expect(actorDirIndex(200 * deg, 0)).toBe(4); // far from n: nearest
    const step = 360 / 32;
    expect(vehicleHeadingIndex((step / 2 + 1.5) * deg, 0)).toBe(0);
    expect(vehicleHeadingIndex((step / 2 + 2.5) * deg, 0)).toBe(1);
    expect(vehicleHeadingIndex((step / 2 + 1.5) * deg, -1)).toBe(1);
  });

  it('every set draws its own asset’s frames, all in the actors atlas', () => {
    expect(ACTOR_SETS.map((s) => s.asset)).toEqual([...HUMAN_IDS, 'npc.cat', 'npc.pigeon', 'npc.dog_loose']);
    expect(ACTOR_SETS[DOG_SET]?.asset).toBe('npc.dog_loose');
    for (const set of ACTOR_SETS) {
      for (const anim of set.anims) {
        if (anim === null) continue;
        expect(anim).toHaveLength(set.dirs);
        for (const frames of anim)
          for (const f of frames) {
            expect(f.startsWith(`${set.asset}:`)).toBe(true);
            expect(FRAME[f].atlas).toBe('actors');
          }
      }
    }
    expect(actorFrame(ACTOR_SETS[0] as (typeof ACTOR_SETS)[number], poseCode(ActorAnim.Fall, 2), 2)).toBe(
      'npc.shopper:fall:e:2',
    );
    expect(() =>
      actorFrame(ACTOR_SETS[0] as (typeof ACTOR_SETS)[number], poseCode(ActorAnim.Sit, 0), 0),
    ).toThrow(/no frame/);
  });
});

describe('the actors batch instances (StreetActors)', () => {
  it('walk frames advance once per 0.30 m travelled for an adult shopper, at 0.6 and 1.4 m/s alike', () => {
    for (const speed of [0.6, 1.4]) {
      const { npc, street, draw } = rig();
      const i = addNpc(npc, 'npc.shopper', 5, 20, Math.PI / 2, PED.Walk, 1);
      npc.speed[i] = speed;
      const seen: { x: number; frame: FrameId }[] = [];
      for (let tick = 0; tick < 300; tick++) {
        npc.prevX[i] = npc.x[i] as number;
        npc.x[i] = (npc.x[i] as number) + speed / 60;
        npc.stateTicks[i] = tick + 1;
        updateNpcCell(npc, i);
        draw(1);
        seen.push({ x: npc.x[i] as number, frame: street.npcFrame[i] as FrameId });
      }
      // The frame is the walk frame of floor(x / 0.30 m) on the east axis: one change per 0.30 m.
      for (const s of seen) expect(s.frame).toBe(`npc.shopper:walk:e:${Math.floor(s.x / 0.3) % 4}`);
      const changes = seen.filter((s, k) => k > 0 && s.frame !== seen[k - 1]?.frame).length;
      const travelled = (seen.at(-1)?.x ?? 0) - 5;
      expect(Math.abs(changes - travelled / 0.3)).toBeLessThanOrEqual(1);
    }
  });

  it('draws people on layer 5 at the interpolated position, each kind’s own frames, facing its heading', () => {
    const { npc, street, draw, bessie } = rig();
    const i = addNpc(npc, 'npc.old_woman', 10, 10, Math.PI / 2, PED.Fallen, 7);
    npc.prevX[i] = 9;
    draw(0.25);
    expect(street.npcFrame[i]).toBe('npc.old_woman:fall:e:1');
    const k = street.npcInstance[i] as number;
    const d = bessie.sprites.instanceData;
    expect(d[k * INSTANCE_STRIDE + O_X]).toBeCloseTo(9.25, 5);
    expect(d[k * INSTANCE_STRIDE + O_Y]).toBeCloseTo(10, 5);
    expect(d[k * INSTANCE_STRIDE + O_LAYER]).toBe(DepthLayer.Pedestrian);
    expect(frameAt(d, k)).toBe('npc.old_woman:fall:e:1');
    expect(street.npcsDrawn).toBe(1);
    // Its drop shadow: the same frame, +2, +2 (no lift).
    expect(bessie.shadows.count).toBe(1);
  });

  it('a shopper’s swap is its NpcStore.swap, a hatchback’s or saloon’s its paint slot, unique characters slot 0', () => {
    const { npc, vehicles, street, draw, bessie } = rig();
    const shopper = addNpc(npc, 'npc.shopper', 10, 10);
    npc.swap[shopper] = 5;
    const doris = addNpc(npc, 'npc.old_woman', 12, 10);
    npc.swap[doris] = 3; // a stray value: unique characters always draw slot 0
    const postie = addNpc(npc, 'npc.postie', 14, 10);
    const walker = addNpc(npc, 'npc.dog_walker', 16, 10);
    const dog = addNpc(npc, 'npc.dog_walker', 16, 12, Math.PI, DOG.Roam, 1, NpcOrigin.Companion);
    npc.link[walker] = npcHandle(npc, dog);
    npc.link[dog] = npcHandle(npc, walker);
    const cat = addNpc(npc, 'npc.cat', 18, 10, Math.PI, CAT.Perch);
    npc.timerB[cat] = -1;
    const vehicle = (id: (typeof VEHICLE_IDS)[number], x: number, paint: number, parked: boolean): number => {
      const v = addVehicle(vehicles, vehicleKind(id), parked ? VEHICLE_FLAG.PARKED : 0);
      vehicles.x[v] = x;
      vehicles.y[v] = 30;
      vehicles.prevX[v] = x;
      vehicles.prevY[v] = 30;
      vehicles.paint[v] = paint;
      return v;
    };
    const hatch = vehicle('veh.hatchback', 10, 3, false);
    const saloon = vehicle('veh.saloon', 20, 6, false);
    const parkedHatch = vehicle('veh.hatchback_parked', 30, 4, true);
    const parkedSaloon = vehicle('veh.saloon_parked', 40, 7, true);
    const taxi = vehicle('veh.taxi', 50, 2, false);
    draw();
    const d = bessie.sprites.instanceData;
    const swapOfNpc = (i: number): number =>
      d[(street.npcInstance[i] as number) * INSTANCE_STRIDE + O_SWAP] as number;
    const swapOfVehicle = (i: number): number =>
      d[(street.vehicleInstance[i] as number) * INSTANCE_STRIDE + O_SWAP] as number;
    expect(swapOfNpc(shopper)).toBe(npc.swap[shopper]);
    expect(swapOfNpc(shopper)).toBe(5);
    expect(swapOfNpc(doris)).toBe(0);
    expect(swapOfNpc(postie)).toBe(0);
    expect(swapOfNpc(walker)).toBe(0);
    expect(swapOfNpc(cat)).toBe(0);
    expect(swapOfNpc(dog)).toBe(WALKER_DOG_COAT_SLOT);
    expect(street.npcFrame[dog]).toMatch(/^npc\.dog_loose:/);
    expect(swapOfVehicle(hatch)).toBe(vehicles.paint[hatch]);
    expect(swapOfVehicle(hatch)).toBe(3);
    expect(swapOfVehicle(saloon)).toBe(6);
    expect(swapOfVehicle(parkedHatch)).toBe(4);
    expect(swapOfVehicle(parkedSaloon)).toBe(7);
    expect(swapOfVehicle(taxi)).toBe(0);
    expect(street.vehicleFrame[parkedSaloon]).toBe('veh.saloon_parked:body:h00:0');
  });

  it('draws vehicles on layer 6 at the shortest-arc interpolated heading, h08 when facing east', () => {
    const { vehicles, street, draw, bessie } = rig();
    const v = addVehicle(vehicles, vehicleKind('veh.hatchback'), 0);
    vehicles.x[v] = 20;
    vehicles.y[v] = 20;
    vehicles.prevX[v] = 19;
    vehicles.prevY[v] = 20;
    vehicles.heading[v] = Math.PI / 2;
    vehicles.prevHeading[v] = Math.PI / 2;
    draw(0.5);
    expect(street.vehicleFrame[v]).toBe('veh.hatchback:body:h08:0');
    const k = street.vehicleInstance[v] as number;
    const d = bessie.sprites.instanceData;
    expect(d[k * INSTANCE_STRIDE + O_X]).toBeCloseTo(19.5, 5);
    expect(d[k * INSTANCE_STRIDE + O_LAYER]).toBe(DepthLayer.Traffic);
    // Across the ±π seam: from 175° to −175° turns 10° through south, never the long way.
    vehicles.prevHeading[v] = (175 * Math.PI) / 180;
    vehicles.heading[v] = (-175 * Math.PI) / 180;
    draw(0.5);
    expect(street.vehicleFrame[v]).toBe('veh.hatchback:body:h16:0');
  });

  it('the riding cat sits on Bessie’s roof on layer 9, the perched cat over its car, a flying pigeon casts no shadow', () => {
    const { npc, street, draw, bessie } = rig();
    const rider = addNpc(npc, 'npc.cat', 30, 30, 0, CAT.RideRoof, 20);
    npc.flags[rider] = NPC_FLAG.ON_ROOF;
    const perched = addNpc(npc, 'npc.cat', 10, 30, Math.PI, CAT.Perch, 5);
    npc.timerB[perched] = 2;
    const pavement = addNpc(npc, 'npc.cat', 14, 30, Math.PI, CAT.Perch, 5);
    npc.timerB[pavement] = -1;
    const pigeon = addNpc(npc, 'npc.pigeon', 20, 20, Math.PI / 2, PIGEON.Fly, 1);
    const pose = createPose();
    pose.xM = 30.2;
    pose.yM = 30.1;
    pose.headingRad = Math.PI / 2; // facing east: the seat is 0.5 m east of her centre
    draw(1, { minX: 0, minY: 0, maxX: 80, maxY: 80 }, pose);
    const d = bessie.sprites.instanceData;
    const at = (i: number, o: number): number =>
      d[(street.npcInstance[i] as number) * INSTANCE_STRIDE + o] as number;
    expect(at(rider, O_LAYER)).toBe(DepthLayer.CatRoof);
    expect(at(rider, O_X)).toBeCloseTo(30.7, 5);
    expect(at(rider, O_Y)).toBeCloseTo(30.1, 5);
    expect(street.npcFrame[rider]).toBe('npc.cat:sit:e:0');
    expect(at(perched, O_LAYER)).toBe(DepthLayer.CatRoof);
    expect(at(pavement, O_LAYER)).toBe(DepthLayer.Pedestrian);
    expect(at(pigeon, O_LAYER)).toBe(DepthLayer.CatRoof);
    expect(street.npcFrame[pigeon]).toBe('npc.pigeon:fly:e:0');
    // Shadows: three cats (two lifted to +3, +3), no pigeon.
    const s = bessie.shadows.instanceData;
    const lifts = Array.from({ length: bessie.shadows.count }, (_, k) => s[k * INSTANCE_STRIDE + O_LIFT]);
    expect(lifts.sort()).toEqual([0, ELEVATED_SHADOW_LIFT_PX, ELEVATED_SHADOW_LIFT_PX]);
  });

  it('culls through the spatial hashes with the camera rect plus 4 m, and adds each layer north to south', () => {
    const { npc, vehicles, street, draw, bessie } = rig();
    const camera: Aabb = { minX: 20, minY: 20, maxX: 40, maxY: 30 };
    addNpc(npc, 'npc.shopper', 30, 29);
    addNpc(npc, 'npc.shopper', 30, 21);
    addNpc(npc, 'npc.shopper', 30, 25);
    addNpc(npc, 'npc.shopper', 30 + 0, 30 + STREET_CULL_MARGIN_M - 0.1); // inside the margin
    const far = addNpc(npc, 'npc.shopper', 30, 30 + STREET_CULL_MARGIN_M + 0.1);
    const v = addVehicle(vehicles, vehicleKind('veh.saloon'), 0);
    vehicles.x[v] = 70;
    vehicles.y[v] = 70;
    vehicles.prevX[v] = 70;
    vehicles.prevY[v] = 70;
    draw(1, camera);
    expect(street.npcsDrawn).toBe(4);
    expect(street.npcInstance[far]).toBe(-1);
    expect(street.vehiclesDrawn).toBe(0);
    expect(street.vehicleInstance[v]).toBe(-1);
    const d = bessie.sprites.instanceData;
    const ys = Array.from({ length: bessie.sprites.count }, (_, k) => d[k * INSTANCE_STRIDE + O_Y] as number);
    expect(ys).toEqual([...ys].sort((a, b) => a - b));
  });

  it('draws the dog lead from the walker’s hand to the dog’s collar as 1 px runs in 18, each with a shadow', () => {
    const { npc, street, draw, bessie } = rig();
    const walker = addNpc(npc, 'npc.dog_walker', 20, 20, Math.PI, PED.Idle, 1);
    const dog = addNpc(npc, 'npc.dog_walker', 21, 23, Math.PI, DOG.Sit, 1, NpcOrigin.Companion);
    npc.link[walker] = npcHandle(npc, dog);
    npc.link[dog] = npcHandle(npc, walker);
    draw();
    expect(street.leadsDrawn).toBe(1);
    const runs = street.leadRunsDrawn;
    expect(runs).toBeGreaterThan(0);
    const d = bessie.sprites.instanceData;
    const solid: { x: number; y: number; w: number; h: number }[] = [];
    for (let k = 0; k < bessie.sprites.count; k++) {
      const o = k * INSTANCE_STRIDE;
      if (((d[o + O_FLAGS] as number) & SpriteFlag.Solid) === 0) continue;
      expect(d[o + O_RECT]).toBe(LEAD_COLOUR);
      expect(d[o + O_LAYER]).toBe(DepthLayer.Pedestrian);
      solid.push({
        x: Math.round((d[o + O_X] as number) * PX_PER_M),
        y: Math.round((d[o + O_Y] as number) * PX_PER_M),
        w: d[o + O_RECT + 2] as number,
        h: d[o + O_RECT + 3] as number,
      });
    }
    expect(solid).toHaveLength(runs);
    // The runs cover the hand pixel and the collar pixel (pivot + anchor of the drawn frames).
    const hand = street.leadAnchorOf(street.npcFrame[walker] as FrameId);
    const collar = street.leadAnchorOf(street.npcFrame[dog] as FrameId);
    expect(hand).toBeDefined();
    expect(collar).toBeDefined();
    const hx = 20 * PX_PER_M + (hand?.[0] ?? 0);
    const hy = 20 * PX_PER_M + (hand?.[1] ?? 0);
    const cx = 21 * PX_PER_M + (collar?.[0] ?? 0);
    const cy = 23 * PX_PER_M + (collar?.[1] ?? 0);
    const covers = (x: number, y: number): boolean =>
      solid.some((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
    expect(covers(hx, hy)).toBe(true);
    expect(covers(cx, cy)).toBe(true);
    // Mostly vertical lead: vertical runs; each run has its shadow (plus the two actors' own).
    expect(solid.every((r) => r.w === 1)).toBe(true);
    expect(bessie.shadows.count).toBe(runs + 2);
    // The anchors are the 18 pixels of the frames (the handle and the collar), not the fallback.
    const handPx = FRAME[street.npcFrame[walker] as FrameId];
    expect(
      actors.indices[
        (handPx.y + handPx.py + (hand?.[1] ?? 0)) * actors.width + handPx.x + handPx.px + (hand?.[0] ?? 0)
      ],
    ).toBe(LEAD_COLOUR);
    const collarPx = FRAME[street.npcFrame[dog] as FrameId];
    expect(
      actors.indices[
        (collarPx.y + collarPx.py + (collar?.[1] ?? 0)) * actors.width +
          collarPx.x +
          collarPx.px +
          (collar?.[0] ?? 0)
      ],
    ).toBe(LEAD_COLOUR);
    // With only the dog in view the lead still draws (once).
    draw(1, { minX: 18, minY: 22.5, maxX: 24, maxY: 30 });
    expect(street.leadsDrawn).toBe(1);
  });

  it('leadRuns writes the Bresenham line as axis-aligned runs, both ends included', () => {
    const out = new Int32Array(4 * 64);
    const pixels = (n: number): Set<string> => {
      const set = new Set<string>();
      for (let k = 0; k < n; k++) {
        const [x, y, w, h] = [out[k * 4], out[k * 4 + 1], out[k * 4 + 2], out[k * 4 + 3]] as number[];
        for (let a = 0; a < (w as number); a++)
          for (let b = 0; b < (h as number); b++) set.add(`${(x as number) + a},${(y as number) + b}`);
      }
      return set;
    };
    expect(leadRuns(0, 0, 0, 0, out)).toBe(1);
    expect(Array.from(out.subarray(0, 4))).toEqual([0, 0, 1, 1]);
    expect(leadRuns(0, 0, 9, 0, out)).toBe(1);
    expect(Array.from(out.subarray(0, 4))).toEqual([0, 0, 10, 1]);
    expect(leadRuns(5, 5, 5, -4, out)).toBe(1);
    expect(Array.from(out.subarray(0, 4))).toEqual([5, -4, 1, 10]);
    // A shallow line: 3 rows, 11 pixels, contiguous runs.
    const n = leadRuns(0, 0, 10, 2, out);
    expect(n).toBe(3);
    expect(pixels(n).size).toBe(11);
    expect(pixels(n)).toContain('0,0');
    expect(pixels(n)).toContain('10,2');
    // A diagonal is one pixel per run; too short an output refuses.
    expect(leadRuns(0, 0, 7, -7, out)).toBe(8);
    expect(leadRuns(0, 0, 100, 100, new Int32Array(8))).toBe(-1);
    expect(LEAD_RUN_BUDGET).toBeGreaterThanOrEqual(4 * 81);
  });

  it('phases are a stateless hash of the handle and the render seed', () => {
    expect(actorRenderSeed(1)).not.toBe(1);
    expect(actorPhase(5, actorRenderSeed(1))).toBe(actorPhase(5, actorRenderSeed(1)));
    const phases = new Set(Array.from({ length: 64 }, (_, h) => actorPhase(h, actorRenderSeed(1))));
    expect(phases.size).toBeGreaterThan(60);
  });
});

describe('update path allocates nothing', () => {
  const NEW_RE = /\bnew\s+[A-Za-z_$]/;
  const ARRAY_LITERAL_RE = /(?:[=(,?:]|\breturn)\s*\[/;
  const OBJECT_LITERAL_RE = /(?:[=(,?:]|\breturn)\s*\{/;
  const regions = (file: string): string[] => {
    const source = readFileSync(`${REPO_ROOT}${file}`, 'utf8');
    return source
      .split('// per-frame draw path: begin')
      .slice(1)
      .map((part) => part.slice(0, part.indexOf('// per-frame draw path: end')));
  };

  it('src/render/streetActors.ts: no `new`, array or object literals in the per-frame region', () => {
    const found = regions('src/render/streetActors.ts');
    expect(found.length).toBeGreaterThan(0);
    for (const region of found) {
      const lines = region
        .split('\n')
        .filter(
          (l) => !l.trim().startsWith('*') && !l.trim().startsWith('//') && !l.trim().startsWith('/**'),
        );
      expect(lines.filter((l) => NEW_RE.test(l))).toEqual([]);
      expect(lines.filter((l) => ARRAY_LITERAL_RE.test(l))).toEqual([]);
      expect(lines.filter((l) => OBJECT_LITERAL_RE.test(l))).toEqual([]);
    }
  });

  it('a populated Puddle Lane frame (NPCs, traffic, parked cars, the dog lead) keeps the heap flat', () => {
    const level = decodeLevel(readFileSync(`${REPO_ROOT}public/assets/levels/puddle_lane.json`, 'utf8'));
    const world = createWorld(level, 1, DEFAULT_TUNING);
    const input = createInputFrame();
    for (let t = 0; t < 7800; t++) world.step(input);
    const street = new StreetActors(actors, { seed: 1 });
    const capacity = streetSpriteCapacity();
    const bessie = createBessieSprite(actors, 40, { extraSprites: capacity, extraShadows: capacity });
    const camRig = createCameraRig(480);
    pinCameraRig(camRig, 70, 20, 37.8);
    const camera = cameraGroundRect(camRig, 0, { minX: 0, minY: 0, maxX: 0, maxY: 0 });
    const pose = createPose();
    const frame = (): void => {
      bessie.begin(camRig.snappedZ);
      bessie.add(pose, 100, false, 0);
      street.update(world.npc, world.vehicles, 0.5, camera, pose, bessie.sprites, bessie.shadows);
      bessie.end();
    };
    frame();
    expect(street.npcsDrawn).toBeGreaterThan(2);
    expect(street.vehiclesDrawn).toBeGreaterThan(2);
    expect(street.leadsDrawn).toBe(1);
    const delta = measureHeapDelta(() => frame(), { warmupTicks: RENDER_WARMUP_FRAMES });
    assertHeapDeltaWithinThresholds(delta);
  });
});
