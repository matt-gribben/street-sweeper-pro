// The dog walker and the dog on its lead (SSP-086; ENTITY_CATALOG §3.2, §6.1–§6.2; TECHNICAL_DESIGN §9.4;
// LEVEL_DESIGN §9.1): the 5 m lead, the Lead Tangle (−150, 1 C, once per crossing episode, the walker startles
// and the dog barks), the walker's animal hit shared with the dog, the dog mess every 40–60 s on pavement or
// grass only, the named route, the walker and dog retiring together, and the renderer's lead endpoints.
//
// Worlds: the open district of tests/support/npcTown.ts (all road ground, a nav node every 8 m, so every tile
// is standable for the NPCs and nothing is pavement) for the contact tests, and the compiled steering town of
// tests/support/steeringTown.ts (terraces, pavements both sides of a road, a zebra and a dropped kerb) for the
// walks, the mess and the lead length.
import { describe, expect, it } from 'vitest';
import { BrushState } from '../../../src/sim/brush.ts';
import { createObb, refreshObbAxes } from '../../../src/sim/collision/obb.ts';
import { Offence } from '../../../src/sim/complaints.ts';
import { TILE_M } from '../../../src/sim/constants.ts';
import { LITTER_IDS, NPC_IDS } from '../../../src/sim/entities.ts';
import { countEvents, EV } from '../../../src/sim/eventQueue.ts';
import { createInputFrame, type InputFrame, PRESSED } from '../../../src/sim/inputFrame.ts';
import { Ground, type Level, type NpcSpawn } from '../../../src/sim/map.ts';
import {
  DOG,
  DOG_BARK_TICKS,
  DOG_SIT_TICKS,
  dogWalkerBehaviour,
  leadDog,
  leadEnds,
  segmentOverlapsObb,
} from '../../../src/sim/npc/behaviours/dogWalker.ts';
import { enterPedestrianState, PED, STARTLE_TICKS } from '../../../src/sim/npc/behaviours/pedestrian.ts';
import { BEHAVIOUR_REGISTRY } from '../../../src/sim/npc/registry.ts';
import {
  addNpcAt,
  NO_NPC_HANDLE,
  NPC_FLAG,
  NpcOrigin,
  npcHandle,
  resolveNpcHandle,
  setNpcState,
  updateNpcCell,
  viewNpcStore,
} from '../../../src/sim/npc/store.ts';
import { DEFAULT_ENTITIES, DEFAULT_TUNING } from '../../../src/sim/tuning.ts';
import { createWorld, type World } from '../../../src/sim/world.ts';
import { endlessShiftTuning } from '../../support/endlessShift.ts';
import { npcTown } from '../../support/npcTown.ts';
import { compileTown } from '../../support/steeringTown.ts';

const KIND = NPC_IDS.indexOf('npc.dog_walker');
const RULES = DEFAULT_ENTITIES.npcs['npc.dog_walker'].rules;
const HIT = DEFAULT_ENTITIES.npcs['npc.dog_walker'].hit;
const DOG_MESS = LITTER_IDS.indexOf('litter.dog_mess');
const BODY = DEFAULT_TUNING.vehicle.sweeper.body;
const HALF_L = BODY.lengthM / 2;
const R = DEFAULT_TUNING.streetLife.npcRadius;
const MESS_MIN_TICKS = RULES.messEveryMinS * 60;
const MESS_MAX_TICKS = RULES.messEveryMaxS * 60;
const neutral = createInputFrame();
/** A run that never reaches SACKED, so a test can keep hitting and tangling. */
const NO_SACK = endlessShiftTuning((raw) => {
  raw.complaints.meter.sackedAt = 1_000_000;
});

type Pair = { walker: number; dog: number };

/** Add a dog walker at (wx, wy) and its dog at (dx, dy), linked both ways, as the spawner does. Returns handles. */
function addPair(world: World, wx: number, wy: number, dx: number, dy: number): Pair {
  const npc = world.npc;
  const w = addNpcAt(npc, KIND, NpcOrigin.Named, wx, wy);
  npc.radius[w] = R.humanM;
  npc.walkMps[w] = DEFAULT_ENTITIES.npcs['npc.dog_walker'].speedMps;
  setNpcState(npc, w, PED.Walk);
  const d = addNpcAt(npc, KIND, NpcOrigin.Companion, dx, dy);
  npc.radius[d] = R.dogM;
  npc.walkMps[d] = DEFAULT_ENTITIES.npcs['npc.dog_walker'].speedMps;
  setNpcState(npc, d, PED.Walk);
  npc.link[w] = npcHandle(npc, d);
  npc.link[d] = npcHandle(npc, w);
  return { walker: npcHandle(npc, w), dog: npcHandle(npc, d) };
}

function at(world: World, handle: number): number {
  const i = resolveNpcHandle(world.npc, handle);
  if (i < 0) throw new Error('stale handle');
  return i;
}

/** Hold the pair where it is: the walker idles and the dog sits for `ticks` (a test standing in for a pause). */
function freeze(world: World, p: Pair, ticks = 60_000): void {
  enterPedestrianState(world, at(world, p.walker), PED.Idle, ticks);
  const d = at(world, p.dog);
  setNpcState(world.npc, d, DOG.Sit);
  world.npc.stateLimit[d] = ticks;
}

function place(world: World, handle: number, x: number, y: number): void {
  const i = at(world, handle);
  world.npc.x[i] = x;
  world.npc.y[i] = y;
  updateNpcCell(world.npc, i);
}

/** Bessie teleported to (x, y) facing `heading`, at rest (a touch is then a bump, never a hit). */
function parkBessie(world: World, x: number, y: number, heading = 0): void {
  const v = world.vehicle;
  v.xM = x;
  v.yM = y;
  v.headingRad = heading;
  v.vLongMps = 0;
  v.vLatMps = 0;
  v.yawRateRadPerS = 0;
  v.steerRad = 0;
}

/** Bessie rolling straight ahead at `speedMps` from wherever she is. */
function rollBessie(world: World, speedMps: number): void {
  const v = world.vehicle;
  v.vLongMps = speedMps;
  v.vLatMps = 0;
  v.yawRateRadPerS = 0;
  v.steerRad = 0;
}

function leadLength(world: World, p: Pair): number {
  const w = at(world, p.walker);
  const d = at(world, p.dog);
  return Math.hypot(
    (world.npc.x[w] as number) - (world.npc.x[d] as number),
    (world.npc.y[w] as number) - (world.npc.y[d] as number),
  );
}

/** Every live walker–dog pair of the store, by handle. */
function pairsOf(world: World): Pair[] {
  const npc = world.npc;
  const out: Pair[] = [];
  for (let i = 0; i < npc.count; i++) {
    const d = leadDog(viewNpcStore(npc), i);
    if (d >= 0) out.push({ walker: npcHandle(npc, i), dog: npcHandle(npc, d) });
  }
  return out;
}

function dogMessItems(world: World): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const l = world.litter;
  for (let i = 0; i < l.count; i++) {
    if (l.kind[i] === DOG_MESS) out.push({ x: l.x[i] as number, y: l.y[i] as number });
  }
  return out;
}

function groundAt(level: Level, x: number, y: number): number {
  const tx = Math.floor(x / TILE_M);
  const ty = Math.floor(y / TILE_M);
  return level.layers.ground[ty * level.size[0] + tx] as number;
}

/** The nav node nearest (x, y). */
function nearestNode(level: Level, x: number, y: number): number {
  const nav = level.nav;
  let best = -1;
  let bestD = Number.POSITIVE_INFINITY;
  for (let n = 0; n < nav.nodeCount; n++) {
    const d = Math.hypot((nav.nodeX[n] as number) - x, (nav.nodeY[n] as number) - y);
    if (d < bestD) {
      best = n;
      bestD = d;
    }
  }
  return best;
}

/** The steering town with `npc` as its spawn spec (merged over an empty one). */
function steeringWorld(seed: number, npc: Partial<NpcSpawn>): World {
  const level = compileTown();
  level.npc = { population: [], mix: [], caps: [], named: [], perches: null, flocks: [], ...npc };
  return createWorld(level, seed, NO_SACK);
}

describe('the dog walker behaviour (SSP-086)', () => {
  it('is the registry entry for npc.dog_walker, starts walking and does not jaywalk', () => {
    expect(BEHAVIOUR_REGISTRY.dog_walker).toBe(dogWalkerBehaviour);
    expect(dogWalkerBehaviour.initial).toBe(PED.Walk);
    expect(dogWalkerBehaviour.jaywalks).toBe(false);
    // The dog's states come after the shared human ones, so `state` alone picks the animation.
    expect(Math.min(...Object.values(DOG))).toBeGreaterThan(Math.max(...Object.values(PED)));
  });
});

describe('the lead (ENTITY_CATALOG §6.2: the dog up to 5 m ahead)', () => {
  it('never lets the dog get more than 5.0 m from the walker over 3,600 ticks, while Bessie sweeps the pavements, honks and knocks them over', {
    timeout: 120_000,
  }, () => {
    expect(RULES.leadMaxM).toBe(5);
    for (const seed of [1, 2, 3]) {
      const level = compileTown();
      const named = [
        { x: 6, y: 15 },
        { x: 40, y: 3 },
        { x: 70, y: 17 },
      ].map(({ x, y }) => ({
        id: 'npc.dog_walker',
        count: 1,
        spawnAtS: 0,
        anchor: nearestNode(level, x, y),
        route: [nearestNode(level, x, y)],
        loop: true,
      }));
      // A looping route along the south pavement and across the road at the dropped kerb, for one more walker.
      const route = [
        nearestNode(level, 10, 13),
        nearestNode(level, 44, 13),
        nearestNode(level, 45, 3),
        nearestNode(level, 70, 3),
        nearestNode(level, 60, 17),
      ];
      named.push({
        id: 'npc.dog_walker',
        count: 1,
        spawnAtS: 0,
        anchor: route[0] as number,
        route,
        loop: true,
      });
      const world = steeringWorld(seed, { named });
      let maxLead = 0;
      let sawFar = 0;
      let tangles = 0;
      const honk: InputFrame = createInputFrame();
      honk.pressed = PRESSED.HORN;
      for (let t = 0; t < 3600; t++) {
        // Bessie runs back and forth at 4 m/s along the south pavement (clear of its props), then the road.
        const pass = Math.floor(t / 1140);
        const along = ((t % 1140) / 1140) * 76;
        const east = pass % 2 === 0;
        const laneY = [11, 15, 7][pass % 3] as number;
        parkBessie(world, east ? 2 + along : 78 - along, laneY, east ? Math.PI / 2 : -Math.PI / 2);
        rollBessie(world, 4);
        world.step(t % 180 === 0 ? honk : neutral);
        tangles += countEvents(world.events, EV.LeadTangle);
        const pairs = pairsOf(world);
        expect(pairs).toHaveLength(4);
        for (const p of pairs) {
          const len = leadLength(world, p);
          maxLead = Math.max(maxLead, len);
          if (len > 2.5) sawFar++;
          expect(len, `seed ${seed} tick ${t}`).toBeLessThanOrEqual(5);
        }
      }
      // The run went the distance (no TOWED or SACKED), the dogs did roam out on the lead (it was not slack all
      // run), and Bessie met the walkers (hits, bumps or Tangles).
      expect(world.shift.endReason).toBe(0);
      expect(sawFar).toBeGreaterThan(1000);
      expect(maxLead).toBeGreaterThan(3);
      const r = world.npcAi.reactions;
      expect(tangles + r.hits + r.bumps).toBeGreaterThan(0);
    }
  });

  it('holds a dog put more than 5 m away from getting farther, and lets it close the gap', () => {
    const world = createWorld(npcTown(48, {}).level, 7, DEFAULT_TUNING);
    parkBessie(world, 80, 80);
    const p = addPair(world, 20, 20, 27, 20);
    let last = leadLength(world, p);
    for (let t = 0; t < 600; t++) {
      world.step(neutral);
      const len = leadLength(world, p);
      expect(len).toBeLessThanOrEqual(Math.max(last, 5) + 1e-9);
      last = len;
    }
    expect(last).toBeLessThanOrEqual(5);
  });
});

describe('Lead Tangle (ENTITY_CATALOG §3.2, §6.2; GDD §10)', () => {
  it('costs −150 and 1 C once per crossing episode; the walker startles and the dog barks; a new crossing after leaving the lead costs again', () => {
    expect([RULES.tanglePts, RULES.tangleComplaints]).toEqual([-150, 1]);
    const world = createWorld(npcTown(48, {}).level, 86, NO_SACK);
    parkBessie(world, 48, 47);
    const p = addPair(world, 46, 40, 50, 40);
    freeze(world, p);
    let tangles = 0;
    let tangleTick = -1;
    let y = 47;
    // North over the lead, with a wiggle back and forth while her body is still across it.
    const ys: number[] = [];
    // Her body spans y ± 1.625, so it is across the lead (y = 40) while 38.375 ≤ y ≤ 41.625.
    for (let k = 0; k < 140; k++) ys.push(47 - k * 0.05); // to 40.05
    for (let k = 0; k < 20; k++) ys.push(40.05 + k * 0.05); // back to 41.0, still across it
    for (let k = 0; k < 200; k++) ys.push(41 - k * 0.05); // on north to 31.05, clear of it
    for (const [t, ny] of ys.entries()) {
      y = ny;
      parkBessie(world, 48, y);
      world.step(neutral);
      const n = countEvents(world.events, EV.LeadTangle);
      if (n > 0) tangleTick = t;
      tangles += n;
      const w = at(world, p.walker);
      const d = at(world, p.dog);
      const crossed = ((world.npc.flags[w] as number) & NPC_FLAG.LEAD_CROSSED) !== 0;
      // LEAD_CROSSED follows the overlap of her body with the lead (from walker to dog, both near y = 40).
      const top = y - HALF_L;
      const bottom = y + HALF_L;
      const leadY = ((world.npc.y[w] as number) + (world.npc.y[d] as number)) / 2;
      if (Math.abs(leadY - top) > 0.2 && Math.abs(leadY - bottom) > 0.2) {
        expect(crossed, `tick ${t}`).toBe(leadY >= top && leadY <= bottom);
      }
      if (t === tangleTick) {
        // The tick it happens: the penalty, one complaint, EV.LeadTangle at the crossing, the walker spins.
        expect(world.scoring.penaltyPts).toBe(-150);
        expect(world.complaints.count).toBe(1);
        const e = world.events;
        let c = -1;
        let lt = -1;
        for (let k = 0; k < e.count; k++) {
          if (e.type[k] === EV.Complaint) c = k;
          if (e.type[k] === EV.LeadTangle) lt = k;
        }
        expect(e.c[c]).toBe(Offence.Tangle);
        expect(e.entity[lt]).toBe(w);
        expect(e.c[lt]).toBe(d);
        expect(e.a[lt]).toBeCloseTo(48, 1);
        expect(e.b[lt]).toBeCloseTo(40, 1);
        expect(world.npc.state[w]).toBe(PED.Startle);
        expect(world.npc.stateLimit[w]).toBe(STARTLE_TICKS);
        expect(world.npc.state[d]).toBe(DOG.Sit);
      }
      if (tangleTick >= 0 && t === tangleTick + 1) {
        // The dog hears it the next tick and barks.
        expect(world.npc.state[d]).toBe(DOG.Bark);
        expect(world.npc.stateLimit[d]).toBe(DOG_BARK_TICKS);
      }
    }
    expect(tangles).toBe(1);
    expect(world.scoring.penaltyPts).toBe(-150);
    expect(world.complaints.count).toBe(1);
    // No hit: the Tangle is a penalty of its own (the startled walker may bump into her side, which is free).
    expect(world.npcAi.reactions.hits).toBe(0);
    // Put the pair back across her way and drive back south over the lead: a second Tangle.
    place(world, p.walker, 46, 40);
    place(world, p.dog, 50, 40);
    freeze(world, p);
    for (let k = 0; k < 340; k++) {
      parkBessie(world, 48, 31 + k * 0.05, Math.PI);
      world.step(neutral);
      tangles += countEvents(world.events, EV.LeadTangle);
    }
    expect(tangles).toBe(2);
    expect(world.scoring.penaltyPts).toBe(-300);
    expect(world.complaints.count).toBe(2);
  });

  it('is part of a hit: a walker hit costs −300 and 1 C, and driving on over the lead and the dog adds nothing', () => {
    expect([HIT?.pts, HIT?.complaints]).toEqual([-300, 1]);
    const world = createWorld(npcTown(48, {}).level, 86, NO_SACK);
    parkBessie(world, 48, 48);
    // The walker on her centre line ahead, the dog 3 m beyond it: she hits the walker, crosses the lead, then the
    // dog.
    const p = addPair(world, 48, 48 - HALF_L - R.humanM - 1, 48, 48 - HALF_L - R.humanM - 4);
    freeze(world, p);
    let npcHits = 0;
    let tangles = 0;
    let dogTouched = false;
    let walkerFell = false;
    for (let t = 0; t < 220; t++) {
      rollBessie(world, 3);
      world.step(neutral);
      if (((world.npc.flags[at(world, p.walker)] as number) & NPC_FLAG.FALLEN) !== 0) walkerFell = true;
      npcHits += countEvents(world.events, EV.NpcHit);
      tangles += countEvents(world.events, EV.LeadTangle);
      const d = at(world, p.dog);
      if (Math.abs((world.npc.y[d] as number) - world.vehicle.yM) < HALF_L) dogTouched = true;
    }
    expect(dogTouched).toBe(true);
    expect(world.vehicle.yM).toBeLessThan((world.npc.y[at(world, p.dog)] as number) - HALF_L - 1);
    expect(npcHits).toBe(1);
    expect(tangles).toBe(0);
    expect(world.scoring.penaltyPts).toBe(-300);
    expect(world.complaints.count).toBe(1);
    expect(world.penalties.applied).toBe(1);
    expect(world.npcAi.reactions.hits).toBe(1);
    // The walker went down; the dog was not hit on its own.
    expect(walkerFell).toBe(true);
  });

  it('the dog first: hitting the dog is the walker’s animal hit (−300, 1 C), and the walker in the same episode adds nothing', () => {
    const world = createWorld(npcTown(48, {}).level, 86, NO_SACK);
    parkBessie(world, 48, 48);
    const p = addPair(world, 48, 48 - HALF_L - R.dogM - 4, 48, 48 - HALF_L - R.dogM - 1);
    freeze(world, p);
    let npcHits = 0;
    let firstHit = -1;
    for (let t = 0; t < 220; t++) {
      rollBessie(world, 3);
      world.step(neutral);
      const n = countEvents(world.events, EV.NpcHit);
      if (n > 0 && firstHit < 0) {
        firstHit = t;
        const e = world.events;
        for (let k = 0; k < e.count; k++) {
          if (e.type[k] !== EV.NpcHit) continue;
          expect(e.entity[k]).toBe(at(world, p.dog));
          expect(e.c[k]).toBe(KIND);
        }
      }
      if (firstHit >= 0 && t === firstHit + 1) expect(world.npc.state[at(world, p.dog)]).toBe(DOG.Bark);
      npcHits += n;
    }
    expect(world.vehicle.yM).toBeLessThan((world.npc.y[at(world, p.walker)] as number) - HALF_L - 1);
    expect(npcHits).toBe(1);
    expect(world.scoring.penaltyPts).toBe(-300);
    expect(world.complaints.count).toBe(1);
    // The walker was not knocked over: the touch was part of the dog's episode.
    expect(((world.npc.flags[at(world, p.walker)] as number) & NPC_FLAG.FALLEN) !== 0).toBe(false);
  });

  it('the Tangle test is OBB against segment: inside, crossing, touching an edge, parallel and outside', () => {
    const obb = createObb();
    obb.cx = 10;
    obb.cy = 10;
    obb.headingRad = Math.PI / 6;
    obb.halfWidthM = 0.875;
    obb.halfLengthM = 1.625;
    refreshObbAxes(obb);
    const xs = new Float64Array(2);
    const ys = new Float64Array(2);
    const out = new Float64Array(2);
    const seg = (ax: number, ay: number, bx: number, by: number): boolean => {
      xs[0] = ax;
      ys[0] = ay;
      xs[1] = bx;
      ys[1] = by;
      return segmentOverlapsObb(obb, xs, ys, 0, 1, out);
    };
    // Through the middle: the crossing point is the centre.
    expect(seg(5, 10, 15, 10)).toBe(true);
    expect(out[0]).toBeCloseTo(10, 9);
    expect(out[1]).toBeCloseTo(10, 9);
    // Wholly inside.
    expect(seg(9.9, 10, 10.1, 10.1)).toBe(true);
    // Far away, and pointing at it but stopping short.
    expect(seg(20, 20, 25, 20)).toBe(false);
    expect(seg(0, 10, 7, 10)).toBe(false);
    // A local frame check against the box corners: just inside and just outside its right edge.
    const rx = obb.rightX;
    const ry = obb.rightY;
    const fx = obb.forwardX;
    const fy = obb.forwardY;
    const edge = (u: number, a: number, b: number): boolean =>
      seg(10 + rx * u + fx * a, 10 + ry * u + fy * a, 10 + rx * u + fx * b, 10 + ry * u + fy * b);
    expect(edge(0.874, -5, 5)).toBe(true);
    expect(edge(0.876, -5, 5)).toBe(false);
  });
});

describe('dog mess (ENTITY_CATALOG §5.2, §6.2; LEVEL_DESIGN §9.1)', () => {
  it('drops the first litter.dog_mess 2,400–3,600 ticks after the walker spawns, and every 40–60 s after, always on pavement or grass', {
    timeout: 120_000,
  }, () => {
    const firsts: number[] = [];
    for (const seed of [11, 12, 13, 14, 15, 16]) {
      const level = compileTown();
      const anchor = nearestNode(level, 20 + seed * 4, 15);
      const world = steeringWorld(seed, {
        named: [{ id: 'npc.dog_walker', count: 1, spawnAtS: 2, anchor, route: [anchor], loop: true }],
      });
      // Bessie parked at the east end of the road, out of everyone's way.
      parkBessie(world, 77, 7);
      const spawnTick = 120;
      let seen = 0;
      const dropTicks: number[] = [];
      let due = -1;
      const dues: number[] = [];
      for (let t = 0; t < spawnTick + 4 * MESS_MAX_TICKS; t++) {
        parkBessie(world, 77, 7);
        world.step(neutral);
        const pairs = pairsOf(world);
        if (t < spawnTick) {
          expect(pairs).toHaveLength(0);
          continue;
        }
        expect(pairs).toHaveLength(1);
        const d = at(world, (pairs[0] as Pair).dog);
        const nd = world.npc.dueTick[d] as number;
        if (nd !== due) {
          dues.push(nd);
          due = nd;
        }
        const items = dogMessItems(world);
        if (items.length > seen) {
          expect(items.length).toBe(seen + 1);
          dropTicks.push(t);
          const m = items[items.length - 1] as { x: number; y: number };
          expect([Ground.Pavement, Ground.Grass]).toContain(groundAt(world.level, m.x, m.y));
          // It lands under the dog, which sits for a second.
          expect(m.x).toBe(world.npc.x[d]);
          expect(m.y).toBe(world.npc.y[d]);
          expect(world.npc.state[d]).toBe(DOG.Sit);
          expect(world.npc.stateLimit[d]).toBe(DOG_SIT_TICKS);
          seen = items.length;
        }
      }
      // The first due tick is drawn on the spawn tick; each drop draws the next, 40–60 s on.
      expect(dues[0] as number).toBeGreaterThanOrEqual(spawnTick + MESS_MIN_TICKS);
      expect(dues[0] as number).toBeLessThanOrEqual(spawnTick + MESS_MAX_TICKS);
      expect(dropTicks.length).toBeGreaterThanOrEqual(3);
      for (const [k, tick] of dropTicks.entries()) {
        const dueK = dues[k] as number;
        // Never early; late only when deferred (off pavement or sitting/barking when it fell due).
        expect(tick).toBeGreaterThanOrEqual(dueK);
        expect(dues[k + 1] as number).toBeGreaterThanOrEqual(tick + MESS_MIN_TICKS);
        expect(dues[k + 1] as number).toBeLessThanOrEqual(tick + MESS_MAX_TICKS);
      }
      firsts.push((dropTicks[0] as number) - spawnTick);
      // The mess counts toward litter spawned (Tidy %).
      expect(world.litter.litterSpawned).toBe(dropTicks.length);
    }
    // Most first drops land on their due tick (the walkers spend most of their time on the pavements).
    expect(firsts.filter((f) => f >= MESS_MIN_TICKS && f <= MESS_MAX_TICKS).length).toBeGreaterThanOrEqual(4);
  });

  it('waits while the dog is off pavement and grass (the road), and drops as soon as it is on one', () => {
    const level = npcTown(48, {}).level;
    expect(level.layers.ground.every((g) => g === Ground.Road)).toBe(true);
    const world = createWorld(level, 21, DEFAULT_TUNING);
    parkBessie(world, 90, 90);
    const p = addPair(world, 20, 20, 21, 20);
    world.step(neutral);
    const due = world.npc.dueTick[at(world, p.dog)] as number;
    expect(due - (world.tick - 1)).toBeGreaterThanOrEqual(MESS_MIN_TICKS);
    expect(due - (world.tick - 1)).toBeLessThanOrEqual(MESS_MAX_TICKS);
    for (let t = 0; t < MESS_MAX_TICKS + 600; t++) world.step(neutral);
    expect(world.tick).toBeGreaterThan(due);
    expect(dogMessItems(world)).toHaveLength(0);
    // Turn the ground under the pair into pavement: the overdue mess drops on the dog's next tick.
    const d = at(world, p.dog);
    const tx = Math.floor((world.npc.x[d] as number) / TILE_M);
    const ty = Math.floor((world.npc.y[d] as number) / TILE_M);
    for (let yy = ty - 2; yy <= ty + 2; yy++)
      for (let xx = tx - 2; xx <= tx + 2; xx++)
        level.layers.ground[yy * level.size[0] + xx] = Ground.Pavement;
    const dropTick = world.tick;
    world.step(neutral);
    const items = dogMessItems(world);
    expect(items).toHaveLength(1);
    expect(world.npc.state[at(world, p.dog)]).toBe(DOG.Sit);
    expect(world.npc.dueTick[at(world, p.dog)] as number).toBeGreaterThanOrEqual(dropTick + MESS_MIN_TICKS);
  });

  it('brushing up over it makes stain.splat (−20), the existing M2 rule', () => {
    expect(DEFAULT_ENTITIES.litter['litter.dog_mess'].rules.brushUp).toEqual({
      effect: 'stain',
      stain: 'stain.splat',
      pts: -20,
    });
    const level = npcTown(48, {}).level;
    level.layers.ground.fill(Ground.Pavement);
    const world = createWorld(level, 23, DEFAULT_TUNING);
    parkBessie(world, 90, 90);
    const p = addPair(world, 20, 20, 21, 20);
    for (let t = 0; t <= MESS_MAX_TICKS + 1 && dogMessItems(world).length === 0; t++) {
      parkBessie(world, 90, 90);
      world.step(neutral);
    }
    const [mess] = dogMessItems(world);
    expect(mess).toBeDefined();
    const m = mess as { x: number; y: number };
    // Move the pair off and park Bessie, brush up, over the mess.
    place(world, p.walker, 40, 40);
    place(world, p.dog, 41, 40);
    expect(world.brush.state).toBe(BrushState.Raised);
    parkBessie(world, m.x, m.y);
    world.step(neutral);
    expect(dogMessItems(world)).toHaveLength(0);
    expect(world.stains.count).toBe(1);
    expect(world.scoring.penaltyPts).toBe(-20);
  });
});

describe('the walker’s route and the pair’s life (LEVEL_DESIGN §9.4)', () => {
  it('a named walker walks its route node by node and round again, with the dog along', {
    timeout: 120_000,
  }, () => {
    const level = compileTown();
    // A loop round the south pavement: along by the kerb, down to the terrace, back, and up again.
    const route = [
      nearestNode(level, 3, 11),
      nearestNode(level, 33, 11),
      nearestNode(level, 33, 19),
      nearestNode(level, 3, 19),
    ];
    const world = steeringWorld(5, {
      named: [{ id: 'npc.dog_walker', count: 1, spawnAtS: 0, anchor: route[0] as number, route, loop: true }],
    });
    const visits: number[] = [];
    for (let t = 0; t < 60 * 140; t++) {
      parkBessie(world, 77, 7);
      world.step(neutral);
      const pairs = pairsOf(world);
      expect(pairs).toHaveLength(1);
      const p = pairs[0] as Pair;
      expect(leadLength(world, p)).toBeLessThanOrEqual(5);
      const w = at(world, p.walker);
      const goal = world.npc.goalNode[w] as number;
      if (goal >= 0 && visits[visits.length - 1] !== goal) visits.push(goal);
    }
    // 76 m a lap at 1.2 m/s: about 63 s, so over two laps in 140 s.
    expect(visits.length).toBeGreaterThanOrEqual(7);
    for (const [k, g] of visits.entries()) expect(g).toBe(route[k % route.length]);
  });

  it('retiring the walker removes the dog with it, and the dog’s old handle fails its generation check', () => {
    const { level } = npcTown(48, {
      population: [{ fromS: 0, toS: 2, target: 1 }],
      mix: [{ id: 'npc.dog_walker', weight: 1 }],
    });
    const world = createWorld(level, 9, DEFAULT_TUNING);
    let pair: Pair | null = null;
    // Past the population window (2 s), so nobody spawns in its place.
    for (let t = 0; t < 130; t++) {
      world.step(neutral);
      pair = pairsOf(world)[0] ?? null;
    }
    expect(pair).not.toBeNull();
    const p = pair as Pair;
    expect(world.npc.count).toBe(2);
    expect(world.npc.origin[at(world, p.dog)]).toBe(NpcOrigin.Companion);
    // Bessie drives off to the far corner: the pair is past the despawn distance and off the view; the target is 0.
    const w0 = at(world, p.walker);
    const farX = (world.npc.x[w0] as number) < 48 ? 95 : 1;
    const farY = (world.npc.y[w0] as number) < 48 ? 95 : 1;
    for (let t = 0; t < 300 && world.npc.count > 0; t++) {
      parkBessie(world, farX, farY);
      world.step(neutral);
    }
    expect(world.npc.count).toBe(0);
    expect(resolveNpcHandle(world.npc, p.walker)).toBe(-1);
    expect(resolveNpcHandle(world.npc, p.dog)).toBe(-1);
    // The freed slots are reused under new generations; the old handles still name nothing.
    const fresh = addPair(world, 10, 10, 11, 10);
    expect([fresh.walker & 127, fresh.dog & 127].sort()).toEqual([p.walker & 127, p.dog & 127].sort());
    expect(resolveNpcHandle(world.npc, p.dog)).toBe(-1);
    expect(resolveNpcHandle(world.npc, p.walker)).toBe(-1);
    expect(resolveNpcHandle(world.npc, fresh.dog)).toBeGreaterThanOrEqual(0);
  });

  it('gives the renderer the lead’s endpoints (walker centre to dog centre), and nothing for anyone else', () => {
    const world = createWorld(npcTown(48, {}).level, 3, DEFAULT_TUNING);
    const p = addPair(world, 20, 20, 23, 21);
    const shopper = addNpcAt(world.npc, NPC_IDS.indexOf('npc.shopper'), NpcOrigin.Ambient, 30, 30);
    const view = viewNpcStore(world.npc);
    const out = new Float64Array(4);
    expect(leadEnds(view, at(world, p.walker), out)).toBe(true);
    expect([...out]).toEqual([20, 20, 23, 21]);
    expect(leadDog(view, at(world, p.walker))).toBe(at(world, p.dog));
    expect(leadDog(view, at(world, p.dog))).toBe(-1);
    expect(leadDog(view, shopper)).toBe(-1);
    out.fill(7);
    expect(leadEnds(view, shopper, out)).toBe(false);
    expect([...out]).toEqual([7, 7, 7, 7]);
    // A walker whose dog is gone has no lead.
    world.npc.link[at(world, p.walker)] = NO_NPC_HANDLE;
    expect(leadDog(view, at(world, p.walker))).toBe(-1);
  });

  it('the dog trots ahead of a walking walker, faster than it', () => {
    const level = compileTown();
    const route = [nearestNode(level, 3, 15), nearestNode(level, 70, 15)];
    const world = steeringWorld(31, {
      named: [{ id: 'npc.dog_walker', count: 1, spawnAtS: 0, anchor: route[0] as number, route, loop: true }],
    });
    let ahead = 0;
    let n = 0;
    parkBessie(world, 77, 7);
    world.step(neutral);
    const p = pairsOf(world)[0] as Pair;
    for (let t = 0; t < 2400; t++) {
      parkBessie(world, 77, 7);
      world.step(neutral);
      const w = at(world, p.walker);
      const d = at(world, p.dog);
      if (world.npc.state[w] !== PED.Walk || (world.npc.speed[w] as number) < 1) continue;
      const h = world.npc.heading[w] as number;
      const dx = (world.npc.x[d] as number) - (world.npc.x[w] as number);
      const dy = (world.npc.y[d] as number) - (world.npc.y[w] as number);
      // Along the walker's forward axis (sin h, −cos h).
      if (dx * Math.sin(h) - dy * Math.cos(h) > 1) ahead++;
      n++;
    }
    expect(n).toBeGreaterThan(1200);
    expect(ahead / n).toBeGreaterThan(0.6);
  });
});
