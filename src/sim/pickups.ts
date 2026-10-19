// Power-ups (GDD §12.7, ENTITY_CATALOG §12, LEVEL_DESIGN §9.6; SSP-096): the pickup store, the shift-start
// spawner, collection by Bessie's body and the six `pwr.*` effects with their timers.
//
// Store. Pickup i lives in slot i of every array, 0 <= i < count (capacity 16, TECHNICAL_DESIGN §7.1); removal
// is swap-remove. A pickup is a kind (POWERUP_IDS index) at a point on the ground, a circle of PICKUP_RADIUS_M
// (the 12 × 12 px visible icon, ART_BIBLE §8.5: 0.75 m across at 16 px per metre).
//
// Spawning (spawnPickups, at shift setup; LEVEL_DESIGN §9.6). The compiled `spawns.pickups` gives `count`
// (1–3 in a shift, L040), the weighted `table` (sorted by id) and the fixed `at` points (metres). Pickup j, for
// j = 0 .. count − 1 in order, draws its kind from the table by weight (one nextFloat), and sits at `at[j]` when
// there is one, else on a pavement tile drawn from the candidates (one nextInt; a tile is used at most once).
// A candidate is a Ground.Pavement tile that is not SOLID, whose centre is not within PICKUP_RADIUS_M of a
// static prop's footprint (tuning.json propFootprints) and that holds no fixed `at` pickup; candidates are
// listed row-major, and a drawn tile is swap-removed from the list. Every draw is on the dedicated `pickups`
// stream (sfc32(seed ^ hash32('pickups')), TECHNICAL_DESIGN §7.3, decided in SSP-096), so placing power-ups
// never reshuffles the litter, grime, hazards or NPCs. A fixed point that is not on a pavement tile, more pickups
// than PICKUP_CAPACITY or fewer candidate tiles than random pickups is an authoring error: spawnPickups throws
// (the level compiler's L040 catches the first two).
//
// Collection (stepPickups, phase 4 after the knockable bodies, against Bessie's pose after phase 3). Every pickup
// whose circle overlaps Bessie's body OBB (tuning.json body.widthM × lengthM) is collected, whatever the brush
// state, in store order: EV.PowerUp (entity = its index before the swap-remove; a, b its centre; c its kind),
// then its effect, then it is swap-removed.
//
// Effects (entities.json `effect`, by kind; the numbers in ENTITY_CATALOG §12):
//   chainTimerMul    pwr.flask_of_tea: setComboTimerMultiplier(mul): every chain refresh is round(120 × 2) = 240
//                    ticks while it runs (combo.ts); back to ×1 when it ends.
//   topSpeedMul      pwr.bacon_butty: VehicleParams.topSpeedMult = mul (1.3): both top speeds (brush down 6.0 →
//                    7.8, transit 11.0 → 14.3 m/s). The clean-pickup speed and the fling ramp are untouched.
//   pedestriansYield pwr.hi_vis: npc/reactions.ts startHiVis (SSP-082's hook), which pushes HiVis to every NPC
//                    each tick while it runs; it keeps its own end tick (hiVisUntilTick), from the same
//                    entities.json durationS, so the two always agree.
//   superSuction     pwr.super_suction: brush.suctionMult = suctionMul (pull 3.0 → 6.0 m/s × RPM) and
//                    brush.flingThresholdMps = 6.0 (no fling up to the brush-down top speed); back to 1 and null.
//   repairHp         pwr.wrench: HP + hp (25), capped at health.maxHp (100). Instant.
//   addWater         pwr.water_can: tank + units (50), capped at water.tankUnits (water.ts addWater). Instant.
// A timed effect runs for round(durationS × 60) ticks from the tick it is collected: its modifier is set at the
// end of phase 4 of the pickup tick T and reset at the start of stepPickups on tick T + duration, so phases 5–9
// see it on ticks T .. T + duration − 1 and phase 2 on ticks T + 1 .. T + duration (each `duration` ticks).
// Collecting a power-up whose own effect is running restarts its timer from the new tick (untilTick = tick +
// duration); nothing stacks (the multiplier is set, never multiplied). Different power-ups run side by side.
// `startTick` records when each timed kind last started, so the HUD shows the most recent one (hudModel.ts).
//
// Hot path: stepPickups allocates nothing and passes no doubles across calls (the circle and OBB are scratch
// objects). setComboTimerMultiplier, startHiVis and addWater run only on a pickup tick. Setup (createPickups,
// spawnPickups) may allocate.

import { createObb, type Obb, refreshObbAxes } from './collision/obb.ts';
import { type Circle, type Contact, createCircle, createContact, obbVsCircleShape } from './collision/sat.ts';
import { setComboTimerMultiplier } from './combo.ts';
import { SIM_HZ, TILE_M } from './constants.ts';
import { type Entities, POWERUP_IDS, type PowerupId } from './entities.ts';
import { EV, emitEvent } from './eventQueue.ts';
import { cos, sin, sqrt } from './fmath.ts';
import { COLLIDE, Ground, type Level } from './map.ts';
import { startHiVis } from './npc/reactions.ts';
import { createStream, nextFloat, nextInt } from './rng.ts';
import type { PropFootprint, PropFootprints } from './tuning.ts';
import { addWater } from './water.ts';
import type { World } from './world.ts';

/** Pickup store capacity (TECHNICAL_DESIGN §7.1). */
export const PICKUP_CAPACITY = 16;

/** A pickup's collection radius, m: half its 12 px visible icon at 16 px per metre (ART_BIBLE §8.5). */
export const PICKUP_RADIUS_M = 0.375;

/** What a power-up does (entities.json `effect.kind`) as a small integer. Hashed: append, never renumber. */
export const PowerUpEffect = {
  ChainTimerMul: 0,
  TopSpeedMul: 1,
  PedestriansYield: 2,
  SuperSuction: 3,
  RepairHp: 4,
  AddWater: 5,
} as const;
export type PowerUpEffect = (typeof PowerUpEffect)[keyof typeof PowerUpEffect];

const EFFECT_CODE = {
  chainTimerMul: PowerUpEffect.ChainTimerMul,
  topSpeedMul: PowerUpEffect.TopSpeedMul,
  pedestriansYield: PowerUpEffect.PedestriansYield,
  superSuction: PowerUpEffect.SuperSuction,
  repairHp: PowerUpEffect.RepairHp,
  addWater: PowerUpEffect.AddWater,
} as const;

/** Per-kind tables, indexed by POWERUP_IDS index. Built once from entities.json. */
export type PowerUpKinds = {
  /** PowerUpEffect of each kind. */
  readonly effect: Uint8Array;
  /** A timed effect's length in ticks (round(durationS × 60)); 0 for an instant one. */
  readonly durationTicks: Int32Array;
  /** The multiplier (chainTimerMul, topSpeedMul `mul`; superSuction `suctionMul`), or 0. */
  readonly mul: Float64Array;
  /** superSuction's fling threshold, m/s, or 0. */
  readonly flingThresholdMps: Float64Array;
  /** The instant amount: repairHp `hp`, addWater `units`, or 0. */
  readonly amount: Float64Array;
};

/** The pickups on the street and the power-up timers (see the header). */
export type Pickups = {
  readonly capacity: number;
  /** Live pickups, 0..capacity. */
  count: number;
  /** POWERUP_IDS index of each pickup. */
  readonly kind: Uint8Array;
  /** Centre, sim metres. */
  readonly x: Float64Array;
  readonly y: Float64Array;
  /** Pickups spawned and collected this shift. */
  spawned: number;
  collected: number;
  readonly kinds: PowerUpKinds;
  /**
   * Per POWERUP_IDS index: a timed effect runs while tick < untilTick (0 = not running). Instant kinds stay 0.
   * pwr.hi_vis's mirrors npc/reactions.ts hiVisUntilTick (set together, from the same durationS).
   */
  readonly untilTick: Int32Array;
  /** Per POWERUP_IDS index: the tick a timed effect last started, or −1. */
  readonly startTick: Int32Array;
  /** Collection scratch: Bessie's body OBB, the pickup circle and the contact. */
  readonly obb: Obb;
  readonly circle: Circle;
  readonly contact: Contact;
};

/** What render, audio and UI may read. */
export type PickupsView = {
  readonly capacity: number;
  readonly count: number;
  readonly kind: ArrayLike<number>;
  readonly x: ArrayLike<number>;
  readonly y: ArrayLike<number>;
  readonly spawned: number;
  readonly collected: number;
  readonly kinds: {
    readonly effect: ArrayLike<number>;
    readonly durationTicks: ArrayLike<number>;
  };
  readonly untilTick: ArrayLike<number>;
  readonly startTick: ArrayLike<number>;
};

/** Per-kind tables from entities.json. Setup only. */
function buildKinds(entities: Entities): PowerUpKinds {
  const n = POWERUP_IDS.length;
  const kinds: PowerUpKinds = {
    effect: new Uint8Array(n),
    durationTicks: new Int32Array(n),
    mul: new Float64Array(n),
    flingThresholdMps: new Float64Array(n),
    amount: new Float64Array(n),
  };
  for (let k = 0; k < n; k += 1) {
    const e = entities.powerups[POWERUP_IDS[k] as PowerupId].effect;
    kinds.effect[k] = EFFECT_CODE[e.kind];
    switch (e.kind) {
      case 'chainTimerMul':
      case 'topSpeedMul':
        kinds.mul[k] = e.mul;
        kinds.durationTicks[k] = Math.round(e.durationS * SIM_HZ);
        break;
      case 'pedestriansYield':
        kinds.durationTicks[k] = Math.round(e.durationS * SIM_HZ);
        break;
      case 'superSuction':
        kinds.mul[k] = e.suctionMul;
        kinds.flingThresholdMps[k] = e.flingThresholdMps;
        kinds.durationTicks[k] = Math.round(e.durationS * SIM_HZ);
        break;
      case 'repairHp':
        kinds.amount[k] = e.hp;
        break;
      case 'addWater':
        kinds.amount[k] = e.units;
        break;
    }
  }
  return kinds;
}

/** An empty pickup store with every timer off. Setup only. */
export function createPickups(entities: Entities, capacity: number = PICKUP_CAPACITY): Pickups {
  const n = POWERUP_IDS.length;
  return {
    capacity,
    count: 0,
    kind: new Uint8Array(capacity),
    x: new Float64Array(capacity),
    y: new Float64Array(capacity),
    spawned: 0,
    collected: 0,
    kinds: buildKinds(entities),
    untilTick: new Int32Array(n),
    startTick: new Int32Array(n).fill(-1),
    obb: createObb(),
    circle: createCircle(),
    contact: createContact(),
  };
}

/** The read-only view of `pickups`. No copy: it is the same object. */
export function viewPickups(pickups: Pickups): PickupsView {
  return pickups;
}

/** Add a pickup of kind `kind` (POWERUP_IDS index) at (xM, yM). Throws when the store is full. Setup and tests. */
export function addPickup(pickups: Pickups, kind: number, xM: number, yM: number): number {
  if (pickups.count >= pickups.capacity) {
    throw new Error(`pickups: the store is full (${pickups.capacity}); a level places at most 3 power-ups`);
  }
  if (!(kind >= 0 && kind < POWERUP_IDS.length)) throw new RangeError(`pickups: unknown kind ${kind}`);
  const i = pickups.count;
  pickups.kind[i] = kind;
  pickups.x[i] = xM;
  pickups.y[i] = yM;
  pickups.count = i + 1;
  pickups.spawned += 1;
  return i;
}

/** Swap-remove pickup `i`. */
function removePickup(pickups: Pickups, i: number): void {
  const last = pickups.count - 1;
  if (i !== last) {
    pickups.kind[i] = pickups.kind[last] as number;
    pickups.x[i] = pickups.x[last] as number;
    pickups.y[i] = pickups.y[last] as number;
  }
  pickups.count = last;
}

/**
 * Mark (1) in `out` every tile whose centre is within `pad` metres of a static prop's solid footprint (the prop's
 * `rot` honoured): each prop visits only the tiles its padded bounding circle reaches. Setup only.
 */
function markPropTiles(level: Level, footprints: PropFootprints, pad: number, out: Uint8Array): void {
  const shapes: { readonly [id: string]: PropFootprint | undefined } = footprints.shapes;
  const [w, h] = level.size;
  for (const prop of level.props) {
    if (!Object.hasOwn(shapes, prop.id)) continue;
    const fp = shapes[prop.id];
    if (fp === undefined) continue;
    const reach =
      (fp.shape === 'circle' ? fp.radiusM : sqrt(fp.widthM * fp.widthM + fp.lengthM * fp.lengthM) / 2) + pad;
    const c = cos(prop.rot);
    const s = sin(prop.rot);
    const tx0 = Math.max(0, Math.floor((prop.x - reach) / TILE_M - 0.5));
    const tx1 = Math.min(w - 1, Math.ceil((prop.x + reach) / TILE_M - 0.5));
    const ty0 = Math.max(0, Math.floor((prop.y - reach) / TILE_M - 0.5));
    const ty1 = Math.min(h - 1, Math.ceil((prop.y + reach) / TILE_M - 0.5));
    for (let ty = ty0; ty <= ty1; ty += 1) {
      for (let tx = tx0; tx <= tx1; tx += 1) {
        const dx = (tx + 0.5) * TILE_M - prop.x;
        const dy = (ty + 0.5) * TILE_M - prop.y;
        let near: boolean;
        if (fp.shape === 'circle') {
          const r = fp.radiusM + pad;
          near = dx * dx + dy * dy <= r * r;
        } else {
          // Box: local +x is the prop's right axis (cos θ, sin θ), local +y its forward axis (sin θ, −cos θ).
          const lx = dx * c + dy * s;
          const ly = dx * s - dy * c;
          near = Math.abs(lx) <= fp.widthM / 2 + pad && Math.abs(ly) <= fp.lengthM / 2 + pad;
        }
        if (near) out[ty * w + tx] = 1;
      }
    }
  }
}

/** The tile index of point (xM, yM), or −1 outside the map. */
function tileOf(level: Level, xM: number, yM: number): number {
  const [w, h] = level.size;
  const tx = Math.floor(xM / TILE_M);
  const ty = Math.floor(yM / TILE_M);
  if (tx < 0 || ty < 0 || tx >= w || ty >= h) return -1;
  return ty * w + tx;
}

/** True when tile `t` is open pavement (Ground.Pavement, not SOLID). */
function isPavementTile(level: Level, t: number): boolean {
  return (
    t >= 0 &&
    level.layers.ground[t] === Ground.Pavement &&
    ((level.layers.collide[t] as number) & COLLIDE.SOLID) === 0
  );
}

/**
 * Shift setup: place the level's power-ups (spawns.pickups) into `pickups` on the `pickups` stream of `seed`
 * (see the header). A level without the spec spawns none. Setup only: allocates.
 */
export function spawnPickups(pickups: Pickups, level: Level, seed: number, footprints: PropFootprints): void {
  const spec = level.pickups;
  if (spec === null || spec.count === 0) return;
  if (spec.count > pickups.capacity - pickups.count) {
    throw new Error(
      `pickups: ${level.id} asks for ${spec.count} power-ups; the store holds ${pickups.capacity}`,
    );
  }
  const ids: number[] = [];
  const weights: number[] = [];
  let total = 0;
  for (const entry of spec.table) {
    const k = POWERUP_IDS.indexOf(entry.id as PowerupId);
    if (k < 0)
      throw new Error(`pickups: ${level.id} powerups.table names ${entry.id}, which is not a pwr id`);
    if (!(entry.weight > 0))
      throw new Error(`pickups: ${level.id} powerups.table ${entry.id} weight ${entry.weight}`);
    ids.push(k);
    weights.push(entry.weight);
    total += entry.weight;
  }
  if (ids.length === 0) throw new Error(`pickups: ${level.id} powerups.table is empty`);

  const fixed = spec.at.length < spec.count ? spec.at.length : spec.count;
  const [w, h] = level.size;
  // 1 = not a candidate: a fixed pickup's tile, or a tile next to a prop's footprint.
  const blocked = new Uint8Array(w * h);
  for (let j = 0; j < fixed; j += 1) {
    const [x, y] = spec.at[j] as [number, number];
    const t = tileOf(level, x, y);
    if (!isPavementTile(level, t)) {
      throw new Error(
        `pickups: ${level.id} powerups.at[${j}] (${x}, ${y}) m is not on an open pavement tile`,
      );
    }
    blocked[t] = 1;
  }
  const candidates: number[] = [];
  if (spec.count > fixed) {
    markPropTiles(level, footprints, PICKUP_RADIUS_M, blocked);
    for (let t = 0; t < w * h; t += 1) {
      if (blocked[t] === 0 && isPavementTile(level, t)) candidates.push(t);
    }
    if (candidates.length < spec.count - fixed) {
      throw new Error(
        `pickups: ${level.id} has ${candidates.length} free pavement tile(s) for ${spec.count - fixed} power-up(s)`,
      );
    }
  }

  const rng = createStream(seed >>> 0, 'pickups');
  for (let j = 0; j < spec.count; j += 1) {
    // The kind: one nextFloat over the table's weights (sorted by id at compile time).
    let r = nextFloat(rng) * total;
    let kind = ids[ids.length - 1] as number;
    for (let e = 0; e < ids.length; e += 1) {
      r -= weights[e] as number;
      if (r < 0) {
        kind = ids[e] as number;
        break;
      }
    }
    if (j < fixed) {
      const [x, y] = spec.at[j] as [number, number];
      addPickup(pickups, kind, x, y);
      continue;
    }
    const pick = nextInt(rng, candidates.length);
    const t = candidates[pick] as number;
    candidates[pick] = candidates[candidates.length - 1] as number;
    candidates.pop();
    addPickup(pickups, kind, ((t % w) + 0.5) * TILE_M, (Math.floor(t / w) + 0.5) * TILE_M);
  }
}

/**
 * Apply power-up `kind` (POWERUP_IDS index) to `w` on its current tick, as collecting one does (see the header):
 * a timed effect sets its modifier and (re)starts its timer, an instant one applies its capped amount. Exported
 * for tests; stepPickups is the only sim caller. Allocation-free.
 */
export function applyPowerUp(w: World, kind: number): void {
  const p = w.pickups;
  const kinds = p.kinds;
  const effect = kinds.effect[kind] as number;
  const v = w.vehicle;
  switch (effect) {
    case PowerUpEffect.ChainTimerMul:
      setComboTimerMultiplier(w.scoring.combo, kinds.mul[kind] as number);
      break;
    case PowerUpEffect.TopSpeedMul:
      w.vehicleParams.topSpeedMult = kinds.mul[kind] as number;
      break;
    case PowerUpEffect.PedestriansYield:
      startHiVis(w);
      break;
    case PowerUpEffect.SuperSuction:
      w.brush.suctionMult = kinds.mul[kind] as number;
      w.brush.flingThresholdMps = kinds.flingThresholdMps[kind] as number;
      break;
    case PowerUpEffect.RepairHp: {
      const maxHp = w.tuning.vehicle.sweeper.health.maxHp;
      const hp = v.hp + (kinds.amount[kind] as number);
      v.hp = hp > maxHp ? maxHp : hp;
      return;
    }
    case PowerUpEffect.AddWater:
      addWater(w.water, kinds.amount[kind] as number);
      return;
  }
  p.untilTick[kind] = w.tick + (kinds.durationTicks[kind] as number);
  p.startTick[kind] = w.tick;
}

/** Reset the timed effect of `kind` (its timer has run out). */
function endPowerUp(w: World, kind: number): void {
  const p = w.pickups;
  switch (p.kinds.effect[kind] as number) {
    case PowerUpEffect.ChainTimerMul:
      setComboTimerMultiplier(w.scoring.combo, 1);
      break;
    case PowerUpEffect.TopSpeedMul:
      w.vehicleParams.topSpeedMult = 1;
      break;
    case PowerUpEffect.SuperSuction:
      w.brush.suctionMult = 1;
      w.brush.flingThresholdMps = null;
      break;
    // pwr.hi_vis ends by itself in npc/reactions.ts (tick >= hiVisUntilTick).
  }
  p.untilTick[kind] = 0;
}

/**
 * Phase 4, after stepBodies: end the timed effects whose time is up, then collect every pickup Bessie's body OBB
 * overlaps (EV.PowerUp, the effect, swap-remove). See the header. Allocation-free.
 */
export function stepPickups(w: World): void {
  const p = w.pickups;
  const tick = w.tick;
  const until = p.untilTick;
  for (let k = 0; k < until.length; k += 1) {
    const u = until[k] as number;
    if (u > 0 && tick >= u) endPowerUp(w, k);
  }
  if (p.count === 0) return;
  const v = w.vehicle;
  const body = w.tuning.vehicle.sweeper.body;
  const obb = p.obb;
  obb.cx = v.xM;
  obb.cy = v.yM;
  obb.headingRad = v.headingRad;
  obb.halfWidthM = body.widthM * 0.5;
  obb.halfLengthM = body.lengthM * 0.5;
  refreshObbAxes(obb);
  const circle = p.circle;
  circle.radiusM = PICKUP_RADIUS_M;
  const events = w.events;
  let i = 0;
  while (i < p.count) {
    circle.x = p.x[i] as number;
    circle.y = p.y[i] as number;
    if (!obbVsCircleShape(obb, circle, p.contact)) {
      i += 1;
      continue;
    }
    const kind = p.kind[i] as number;
    const e = emitEvent(events, EV.PowerUp, i);
    events.a[e] = p.x[i] as number;
    events.b[e] = p.y[i] as number;
    events.c[e] = kind;
    applyPowerUp(w, kind);
    p.collected += 1;
    // Swap-remove: slot i now holds the last pickup, which is tested next without advancing.
    removePickup(p, i);
  }
}

/** Ticks left of timed power-up `kind`'s effect at World tick `tick` (0 when it is not running). */
export function powerUpTicksLeft(p: PickupsView, kind: number, tick: number): number {
  const u = p.untilTick[kind] as number;
  return u > tick ? u - tick : 0;
}

/**
 * The timed power-up the HUD shows at `tick`: of those running, the one started last (ties to the lower
 * POWERUP_IDS index); −1 when none runs.
 */
export function shownPowerUp(p: PickupsView, tick: number): number {
  let best = -1;
  let bestStart = -1;
  for (let k = 0; k < p.untilTick.length; k += 1) {
    if ((p.untilTick[k] as number) <= tick) continue;
    const s = p.startTick[k] as number;
    if (s > bestStart) {
      best = k;
      bestStart = s;
    }
  }
  return best;
}
