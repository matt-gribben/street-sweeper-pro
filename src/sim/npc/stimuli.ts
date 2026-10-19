// The stimulus queue (TECHNICAL_DESIGN §11.1, SSP-080): stimuli are pushed by the sim, never polled. Any
// phase pushes one with pushStimulus and writes its position and radius into the returned slot (the
// emitEvent pattern: no doubles cross the call); phase 7 delivers every queued stimulus, in push order, to
// the behaviours' onStimulus and empties the queue. A stimulus pushed after phase 7's delivery (by traffic in
// phase 8, say) waits for the next tick's.
//
// Addressing. `target` is an NPC handle (store.ts) or NO_NPC_HANDLE:
// - a handle: delivered to that NPC only, if it is still live (a stale handle delivers nothing);
// - NO_NPC_HANDLE with radiusM ≥ 0: to every live NPC whose centre is within radiusM of (x, y), in index order;
// - NO_NPC_HANDLE with radiusM < 0 (STIMULUS_EVERYONE): to every live NPC, in index order (HiVis).
//
// Hot path: pushStimulus and deliverStimuli allocate nothing.

import type { World } from '../world.ts';
import type { Behaviour, Stimulus } from './behaviour.ts';
import { NO_NPC_HANDLE, resolveNpcHandle } from './store.ts';

/** Stimuli the queue holds at once. Overflowing it is a sim bug and throws. */
export const STIMULUS_CAPACITY = 256;
/** radiusM for a stimulus addressed to every live NPC. */
export const STIMULUS_EVERYONE = -1;

export type StimulusQueue = {
  readonly capacity: number;
  /** Queued stimuli, at slots 0..count−1. */
  count: number;
  /** Stimulus type. */
  readonly type: Uint8Array;
  /** NPC handle, or NO_NPC_HANDLE for an area or everyone. */
  readonly target: Int32Array;
  /** Where it came from, metres. */
  readonly x: Float64Array;
  readonly y: Float64Array;
  /** Reach in metres for an area stimulus; STIMULUS_EVERYONE for all. */
  readonly radiusM: Float64Array;
  /** Stimuli delivered this shift (one per NPC reached). */
  delivered: number;
};

/** An empty queue. Setup only. */
export function createStimulusQueue(capacity: number = STIMULUS_CAPACITY): StimulusQueue {
  return {
    capacity,
    count: 0,
    type: new Uint8Array(capacity),
    target: new Int32Array(capacity).fill(NO_NPC_HANDLE),
    x: new Float64Array(capacity),
    y: new Float64Array(capacity),
    radiusM: new Float64Array(capacity).fill(STIMULUS_EVERYONE),
    delivered: 0,
  };
}

/**
 * Queue a stimulus of `type` for `target` (an NPC handle, or NO_NPC_HANDLE) and return its slot. The slot
 * starts at (0, 0) with radiusM STIMULUS_EVERYONE; the caller writes x, y and radiusM into it. Throws when the
 * queue is full.
 */
export function pushStimulus(queue: StimulusQueue, type: Stimulus, target: number): number {
  const k = queue.count;
  if (k >= queue.capacity) {
    throw new Error(`pushStimulus: the queue holds ${queue.capacity} stimuli; a tick pushed more`);
  }
  queue.count = k + 1;
  queue.type[k] = type;
  queue.target[k] = target;
  queue.x[k] = 0;
  queue.y[k] = 0;
  queue.radiusM[k] = STIMULUS_EVERYONE;
  return k;
}

/**
 * Phase 7: deliver every stimulus queued in `w.npcAi.stimuli`, in push order, to `onStimulus` of each NPC it
 * reaches (see the file comment), then empty the queue. A stimulus pushed during delivery is delivered in the
 * same pass; the queue capacity bounds the cascade.
 */
export function deliverStimuli(w: World): void {
  const queue = w.npcAi.stimuli;
  const store = w.npc;
  const behaviours = w.npcAi.behaviours;
  for (let k = 0; k < queue.count; k += 1) {
    const s = queue.type[k] as Stimulus;
    const target = queue.target[k] as number;
    if (target !== NO_NPC_HANDLE) {
      const i = resolveNpcHandle(store, target);
      if (i >= 0) {
        queue.delivered += 1;
        (behaviours[store.kind[i] as number] as Behaviour).onStimulus(w, i, s, k);
      }
      continue;
    }
    const r = queue.radiusM[k] as number;
    const sx = queue.x[k] as number;
    const sy = queue.y[k] as number;
    for (let i = 0; i < store.count; i += 1) {
      if (r >= 0) {
        const dx = (store.x[i] as number) - sx;
        const dy = (store.y[i] as number) - sy;
        if (dx * dx + dy * dy > r * r) continue;
      }
      queue.delivered += 1;
      (behaviours[store.kind[i] as number] as Behaviour).onStimulus(w, i, s, k);
    }
  }
  queue.count = 0;
}
