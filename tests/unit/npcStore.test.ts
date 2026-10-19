// The NPC store (SSP-080, TECHNICAL_DESIGN §7.1): fixed capacity, swap-remove with generation-checked handles,
// and the 4 m spatial hash kept consistent through adds, moves and removals.
import { describe, expect, it } from 'vitest';
import { createAabb } from '../../src/sim/collision/obb.ts';
import { createBlankLevel } from '../../src/sim/map.ts';
import {
  addNpcAt,
  beginNpcTick,
  createNpcStore,
  NO_NPC_HANDLE,
  NPC_CAPACITY,
  NpcOrigin,
  type NpcStore,
  npcCellIndex,
  npcHandle,
  queryNpcs,
  removeNpc,
  resolveNpcHandle,
  setNpcState,
  updateNpcCell,
} from '../../src/sim/npc/store.ts';
import { nextFloat, nextInt, sfc32 } from '../../src/sim/rng.ts';

const level = createBlankLevel('test.npc_store', 40, 30); // 80 × 60 m: 20 × 15 hash cells

/** Every live NPC is in exactly the cell its position names, and every list entry is live. */
function expectHashConsistent(store: NpcStore): void {
  const seen = new Set<number>();
  for (let cell = 0; cell < store.cellHead.length; cell++) {
    let prev = -1;
    for (let i = store.cellHead[cell] as number; i >= 0; i = store.cellNext[i] as number) {
      expect(i).toBeLessThan(store.count);
      expect(store.cellOf[i]).toBe(cell);
      expect(store.cellPrev[i]).toBe(prev);
      expect(seen.has(i)).toBe(false);
      seen.add(i);
      prev = i;
    }
  }
  expect(seen.size).toBe(store.count);
  for (let i = 0; i < store.count; i++) expect(store.cellOf[i]).toBe(npcCellIndex(store, i));
}

describe('NpcStore', () => {
  it('holds NPC_CAPACITY (80) NPCs and refuses the 81st without changing anything', () => {
    expect(NPC_CAPACITY).toBe(80);
    const store = createNpcStore(level);
    expect(store.capacity).toBe(80);
    for (let k = 0; k < 80; k++) expect(addNpcAt(store, k % 11, NpcOrigin.Ambient, 1 + k, 2)).toBe(k);
    expect(store.count).toBe(80);
    expect(addNpcAt(store, 0, NpcOrigin.Ambient, 5, 5)).toBe(-1);
    expect(store.count).toBe(80);
    expect(store.npcsAdded).toBe(80);
    expect(store.freeCount).toBe(0);
    expect(() => createNpcStore(level, 129)).toThrow(/capacity must be 1\.\.128/);
  });

  it('starts an NPC at rest in state 0 with no target, link or perception', () => {
    const store = createNpcStore(level);
    const i = addNpcAt(store, 3, NpcOrigin.Named, 10.5, 20.25);
    expect(i).toBe(0);
    expect(store.kind[i]).toBe(3);
    expect(store.origin[i]).toBe(NpcOrigin.Named);
    expect([store.x[i], store.y[i], store.prevX[i], store.prevY[i]]).toEqual([10.5, 20.25, 10.5, 20.25]);
    expect([store.state[i], store.stateTicks[i], store.heading[i], store.speed[i]]).toEqual([0, 0, 0, 0]);
    expect(store.targetNode[i]).toBe(-1);
    expect(store.link[i]).toBe(NO_NPC_HANDLE);
    expect(store.group[i]).toBe(-1);
    expect(store.perceivedTick[i]).toBe(-1);
    setNpcState(store, i, 4);
    store.stateTicks[i] = 9;
    setNpcState(store, i, 2);
    expect([store.state[i], store.stateTicks[i]]).toEqual([2, 0]);
  });

  it('swap-removing an NPC invalidates its old handle and reuses its slot; the moved NPC keeps its handle', () => {
    const store = createNpcStore(level);
    const a = addNpcAt(store, 1, NpcOrigin.Ambient, 4, 4);
    const b = addNpcAt(store, 2, NpcOrigin.Ambient, 8, 8);
    const c = addNpcAt(store, 3, NpcOrigin.Ambient, 12, 12);
    const ha = npcHandle(store, a);
    const hb = npcHandle(store, b);
    const hc = npcHandle(store, c);
    expect(new Set([ha, hb, hc]).size).toBe(3);
    store.link[c] = hb;
    expect(resolveNpcHandle(store, hb)).toBe(b);

    removeNpc(store, b);
    // b's handle no longer resolves: the generation check fails.
    expect(resolveNpcHandle(store, hb)).toBe(-1);
    expect(store.count).toBe(2);
    // c (the last live NPC) moved into b's index and still resolves through its own handle, with its fields.
    expect(resolveNpcHandle(store, hc)).toBe(b);
    expect(store.kind[b]).toBe(3);
    expect(store.x[b]).toBe(12);
    expect(store.link[b]).toBe(hb);
    expect(resolveNpcHandle(store, store.link[b] as number)).toBe(-1);
    expect(resolveNpcHandle(store, ha)).toBe(a);

    // The freed handle slot is the next one used, under a new generation: the old handle stays dead.
    const d = addNpcAt(store, 4, NpcOrigin.Ambient, 16, 16);
    expect(d).toBe(2); // the freed index (count) is reused
    const hd = npcHandle(store, d);
    expect(store.handleSlot[d]).toBe(hb & 127); // the same handle slot…
    expect(hd).not.toBe(hb); // …with a new generation
    expect(resolveNpcHandle(store, hd)).toBe(d);
    expect(resolveNpcHandle(store, hb)).toBe(-1);
    expect(resolveNpcHandle(store, NO_NPC_HANDLE)).toBe(-1);
    expect(store.npcsRemoved).toBe(1);
    expectHashConsistent(store);
  });

  it('removing the last NPC frees it without moving anything', () => {
    const store = createNpcStore(level);
    addNpcAt(store, 0, NpcOrigin.Ambient, 1, 1);
    const last = addNpcAt(store, 0, NpcOrigin.Ambient, 3, 3);
    const h0 = npcHandle(store, 0);
    const h1 = npcHandle(store, last);
    removeNpc(store, last);
    expect(resolveNpcHandle(store, h1)).toBe(-1);
    expect(resolveNpcHandle(store, h0)).toBe(0);
    expect(() => removeNpc(store, 1)).toThrow(/not live/);
    expectHashConsistent(store);
  });

  it('keeps every handle and the spatial hash right through random adds, moves and removes', () => {
    const store = createNpcStore(level);
    const rng = sfc32(80);
    const live = new Map<number, number>(); // handle → x position tag
    for (let step = 0; step < 4000; step++) {
      const roll = nextInt(rng, 10);
      if (roll < 4 && store.count < store.capacity) {
        const x = nextFloat(rng) * 90 - 5; // some off the map: clamped into an edge cell
        const y = nextFloat(rng) * 70 - 5;
        const i = addNpcAt(store, nextInt(rng, 11), NpcOrigin.Ambient, x, y);
        live.set(npcHandle(store, i), x);
      } else if (roll < 7 && store.count > 0) {
        const i = nextInt(rng, store.count);
        live.delete(npcHandle(store, i));
        removeNpc(store, i);
      } else if (store.count > 0) {
        const i = nextInt(rng, store.count);
        store.y[i] = nextFloat(rng) * 60;
        updateNpcCell(store, i);
      }
      if (step % 50 === 0) expectHashConsistent(store);
    }
    expect(live.size).toBe(store.count);
    for (const [h, x] of live) {
      const i = resolveNpcHandle(store, h);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(store.x[i]).toBe(x);
    }
    expectHashConsistent(store);
  });

  it('queryNpcs finds exactly the NPCs inside a box, visiting only its cells', () => {
    const store = createNpcStore(level);
    const rng = sfc32(7);
    for (let k = 0; k < 80; k++)
      addNpcAt(store, 0, NpcOrigin.Ambient, nextFloat(rng) * 80, nextFloat(rng) * 60);
    const box = createAabb();
    const out = new Int32Array(store.capacity);
    for (const [minX, minY, maxX, maxY] of [
      [10, 10, 30, 22],
      [0, 0, 80, 60],
      [41.5, 3, 42, 59],
      [5, 5, 4, 6], // empty
    ] as const) {
      box.minX = minX;
      box.minY = minY;
      box.maxX = maxX;
      box.maxY = maxY;
      const n = queryNpcs(store, box, out);
      const got = [...out.subarray(0, n)].sort((a, b) => a - b);
      const want: number[] = [];
      for (let i = 0; i < store.count; i++) {
        const x = store.x[i] as number;
        const y = store.y[i] as number;
        if (x >= minX && x <= maxX && y >= minY && y <= maxY) want.push(i);
      }
      expect(got).toEqual(want);
    }
  });

  it('beginNpcTick copies positions into prevX/prevY', () => {
    const store = createNpcStore(level);
    const i = addNpcAt(store, 0, NpcOrigin.Ambient, 2, 3);
    store.x[i] = 2.5;
    store.y[i] = 3.5;
    beginNpcTick(store);
    expect([store.prevX[i], store.prevY[i]]).toEqual([2.5, 3.5]);
  });
});
