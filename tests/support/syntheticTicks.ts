// Synthetic stand-in ticks for the heap-delta spike (SSP-292, TECHNICAL_DESIGN §17).
//
// M0 has no sim, so these ticks imitate its hot path: struct-of-arrays Float64Array stores sized to the §17
// capacities (2,000 litter, 80 NPCs, 30 vehicles), integrated with plain arithmetic each tick. The clean tick
// allocates nothing. The two bad variants add exactly one small `{ x, y }` object per tick:
//   - transient: the object is written to a module-level sink and overwritten next tick, so it escapes (V8's
//     escape analysis cannot remove it) and becomes garbage one tick later, like a helper that returns a
//     fresh vector;
//   - retained: the object is pushed into a module-level array and never released, like a growing cache.
// Not sim code: it lives under tests/ and is used by tests/unit/heapDelta.test.ts and
// tools/spikes/heapThreshold.ts.
import { DT_S } from '../../src/sim/constants.ts';

/** Store capacities from TECHNICAL_DESIGN §17. */
export const SYNTHETIC_CAPACITY = { litter: 2000, npcs: 80, vehicles: 30 } as const;

/** Side of the square synthetic world in metres; bodies bounce off its edges. */
const WORLD_SIZE_M = 256;

type BodyStore = {
  readonly count: number;
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly vx: Float64Array;
  readonly vy: Float64Array;
};

export type SyntheticWorld = {
  readonly litter: BodyStore;
  readonly npcs: BodyStore;
  readonly vehicles: BodyStore;
};

/** Small deterministic LCG for the initial layout (no Math.random, so every run starts identically). */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function createStore(count: number, maxSpeedMps: number, seed: number): BodyStore {
  const next = lcg(seed);
  const store: BodyStore = {
    count,
    x: new Float64Array(count),
    y: new Float64Array(count),
    vx: new Float64Array(count),
    vy: new Float64Array(count),
  };
  for (let i = 0; i < count; i++) {
    store.x[i] = next() * WORLD_SIZE_M;
    store.y[i] = next() * WORLD_SIZE_M;
    store.vx[i] = (next() * 2 - 1) * maxSpeedMps;
    store.vy[i] = (next() * 2 - 1) * maxSpeedMps;
  }
  return store;
}

export function createSyntheticWorld(): SyntheticWorld {
  return {
    litter: createStore(SYNTHETIC_CAPACITY.litter, 0.5, 1),
    npcs: createStore(SYNTHETIC_CAPACITY.npcs, 1.4, 2),
    vehicles: createStore(SYNTHETIC_CAPACITY.vehicles, 11, 3),
  };
}

/** Integrates one store for one tick: damped velocity, position step, bounce at the world edges. */
function integrate(store: BodyStore, damping: number): void {
  const { count, x, y, vx, vy } = store;
  for (let i = 0; i < count; i++) {
    let px = (x[i] ?? 0) + (vx[i] ?? 0) * DT_S;
    let py = (y[i] ?? 0) + (vy[i] ?? 0) * DT_S;
    let qx = (vx[i] ?? 0) * damping;
    let qy = (vy[i] ?? 0) * damping;
    if (px < 0 || px > WORLD_SIZE_M) {
      qx = -qx;
      px = px < 0 ? -px : 2 * WORLD_SIZE_M - px;
    }
    if (py < 0 || py > WORLD_SIZE_M) {
      qy = -qy;
      py = py < 0 ? -py : 2 * WORLD_SIZE_M - py;
    }
    x[i] = px;
    y[i] = py;
    vx[i] = qx;
    vy[i] = qy;
  }
}

/** The allocation-free synthetic tick: reads and writes every store, allocates nothing. */
export function stepSyntheticWorld(world: SyntheticWorld): void {
  integrate(world.litter, 0.9995);
  integrate(world.npcs, 1);
  integrate(world.vehicles, 0.999);
}

export type SmallObject = { x: number; y: number };

/** Transient sink: holds only the latest tick's object; the previous one becomes garbage. */
let transientSink: SmallObject | null = null;

/** Retained sink: every object pushed here stays reachable until resetSyntheticSinks(). */
const retainedSink: SmallObject[] = [];

export function retainedSinkLength(): number {
  return retainedSink.length;
}

export function transientSinkValue(): SmallObject | null {
  return transientSink;
}

/** Releases everything the bad variants stored, so later measurements start clean. */
export function resetSyntheticSinks(): void {
  transientSink = null;
  retainedSink.length = 0;
}

export const SyntheticVariant = { Clean: 'clean', Transient: 'transient', Retained: 'retained' } as const;
export type SyntheticVariant = (typeof SyntheticVariant)[keyof typeof SyntheticVariant];

/**
 * Builds a fresh world and returns the step function for `variant`. The closure is created once here, never
 * per tick.
 */
export function createSyntheticTick(variant: SyntheticVariant): (tick: number) => void {
  const world = createSyntheticWorld();
  const litter = world.litter;
  switch (variant) {
    case SyntheticVariant.Clean:
      return () => {
        stepSyntheticWorld(world);
      };
    case SyntheticVariant.Transient:
      return (tick) => {
        stepSyntheticWorld(world);
        const i = tick % litter.count;
        transientSink = { x: litter.x[i] ?? 0, y: litter.y[i] ?? 0 };
      };
    case SyntheticVariant.Retained:
      return (tick) => {
        stepSyntheticWorld(world);
        const i = tick % litter.count;
        retainedSink.push({ x: litter.x[i] ?? 0, y: litter.y[i] ?? 0 });
      };
  }
}
