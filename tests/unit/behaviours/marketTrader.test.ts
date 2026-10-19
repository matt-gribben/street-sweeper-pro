// npc.market_trader and the Tuesday market events (SSP-088; ENTITY_CATALOG §6.1–§6.2, §3.4; LEVEL_DESIGN §4.3,
// §4.5, §7.6): a trader mans each pitch of the `market` event (on the tile in front of its stall, facing the
// aisle) and never moves, hi-vis, horn, bumps and hits included; a hit costs −250 and 1 complaint; the
// `market_close` at 180 s builds itemsPerPitch items per pitch over buildS seconds on the `events` stream, every
// one counted in litter spawned.
import { describe, expect, it } from 'vitest';
import { LITTER_IDS } from '../../../src/sim/entities.ts';
import { countEvents, EV } from '../../../src/sim/eventQueue.ts';
import { addLitter } from '../../../src/sim/litter.ts';
import type { JsonValue, ScheduledEvent } from '../../../src/sim/map.ts';
import { litterFieldLength } from '../../../src/sim/map.ts';
import { MARKET_TRADER, marketTraderBehaviour } from '../../../src/sim/npc/behaviours/marketTrader.ts';
import { ANGRY_TICKS, FALLEN_TICKS, GET_UP_TICKS, PED } from '../../../src/sim/npc/behaviours/pedestrian.ts';
import { startHiVis } from '../../../src/sim/npc/reactions.ts';
import { NPC_CAPACITY, NPC_FLAG, NpcOrigin } from '../../../src/sim/npc/store.ts';
import {
  createShiftEvents,
  MARKET_CLOSE_DEFAULT_BUILD_S,
  MARKET_CLOSE_DEFAULT_ITEMS,
  PILE_REACH_TILES,
  shiftElapsedTicks,
} from '../../../src/sim/shift.ts';
import { DEFAULT_ENTITIES, DEFAULT_TUNING } from '../../../src/sim/tuning.ts';
import { createWorld, type World } from '../../../src/sim/world.ts';
import { npcTown } from '../../support/npcTown.ts';
import {
  HALF_L,
  HUMAN_R,
  holdBessie,
  honk,
  kindOf,
  neutral,
  TOWN_TILES,
} from '../../support/pedestrianRig.ts';

const TRADER = DEFAULT_ENTITIES.npcs['npc.market_trader'];
/** A row of four stalls, tiles (20..23, 30): stall centres x 41, 43, 45, 47 at y 61. */
const STALL_ROW = 30;
const STALL_COLS = [20, 21, 22, 23];
/** A district table with small litter and the kinds a market pile never drops by default. */
const TABLE = [
  { id: 'litter.crisp_packet', weight: 30 },
  { id: 'litter.chip_wrapper', weight: 20 },
  { id: 'litter.drink_can', weight: 15 },
  { id: 'litter.leaf_pile', weight: 8 },
  { id: 'litter.bin_bag', weight: 5 },
];
const SMALL = new Set(['litter.crisp_packet', 'litter.chip_wrapper', 'litter.drink_can']);

function event(
  type: ScheduledEvent['type'],
  atS: number[],
  params: { [k: string]: JsonValue },
): ScheduledEvent {
  return { type, atS, untilS: null, trigger: null, params };
}

type MarketOptions = {
  /** The market event's `at` (none: open from shift start); null for no market event. */
  marketAt?: number[] | null;
  marketParams?: { [k: string]: JsonValue };
  /** The market_close params (null: no close). */
  close?: { [k: string]: JsonValue } | null;
  closeAt?: number[];
  /** Extra props (tile col, row, id). */
  extraProps?: [number, number, string][];
};

/** The open test district (48 × 48 tiles) with the stall row, the district table and the given events. */
function marketWorld(seed: number, o: MarketOptions = {}): World {
  const { level } = npcTown(TOWN_TILES, {});
  for (const c of STALL_COLS)
    level.props.push({ id: 'prop.market_stall', x: (c + 0.5) * 2, y: (STALL_ROW + 0.5) * 2, rot: 0 });
  for (const [c, r, id] of o.extraProps ?? [])
    level.props.push({ id, x: (c + 0.5) * 2, y: (r + 0.5) * 2, rot: 0 });
  const n = litterFieldLength(TOWN_TILES, TOWN_TILES);
  level.litter = {
    initial: 0,
    minSpacingM: 0.5,
    table: [...TABLE].sort((a, b) => (a.id < b.id ? -1 : 1)).map((e) => ({ ...e, requires: 0 })),
    places: new Uint8Array(n),
    weights: new Uint16Array(n),
  };
  const schedules: ScheduledEvent[] = [];
  if (o.marketAt !== null) schedules.push(event('market', o.marketAt ?? [], o.marketParams ?? {}));
  if (o.close !== null)
    schedules.push(event('market_close', o.closeAt ?? [180], o.close ?? { buildS: 20, itemsPerPitch: 3 }));
  level.schedules = schedules;
  return createWorld(level, seed, DEFAULT_TUNING);
}

/** Every live market trader's index, in pitch order. */
function traders(world: World): number[] {
  const out: number[] = [];
  const npc = world.npc;
  for (let i = 0; i < npc.count; i++) if (npc.origin[i] === NpcOrigin.Market) out.push(i);
  return out.sort((a, b) => (npc.group[a] as number) - (npc.group[b] as number));
}

function step(world: World, speedMps = 0, input = neutral): void {
  holdBessie(world, speedMps);
  world.step(input);
}

describe('npc.market_trader at his pitch (ENTITY_CATALOG §6.2, LEVEL_DESIGN §4.3, §7.6)', () => {
  it('reads its numbers from entities.json and is in the registry', () => {
    expect(TRADER.speedMps).toBe(0);
    expect(TRADER.yields).toBe(false);
    expect(TRADER.hit).toEqual({ pts: -250, complaints: 1, drops: [] });
    const world = marketWorld(88);
    expect(world.npcAi.behaviours[kindOf('npc.market_trader')]).toBe(marketTraderBehaviour);
    expect(marketTraderBehaviour.initial).toBe(MARKET_TRADER.Idle);
  });

  it('a market with no at opens at shift start: one trader per pitch, on the tile in front, facing the aisle', () => {
    const world = marketWorld(88);
    const ev = world.shiftEvents;
    expect(ev.marketOpen).toBe(true);
    expect(ev.pitchCount).toBe(4);
    expect(ev.tradersPending).toBe(4);
    step(world);
    const t = traders(world);
    expect(t).toHaveLength(4);
    expect(ev.tradersPending).toBe(0);
    t.forEach((i, p) => {
      // The stalls stand side by side, so east and west are taken; south and north tie at 3 open tiles and
      // south (tried first) wins: the trader on tile (col, 31), facing south.
      expect(world.npc.kind[i]).toBe(kindOf('npc.market_trader'));
      expect(world.npc.group[i]).toBe(p);
      expect(world.npc.x[i]).toBe((STALL_COLS[p] as number) * 2 + 1);
      expect(world.npc.y[i]).toBe((STALL_ROW + 1) * 2 + 1);
      expect(world.npc.heading[i]).toBe(Math.PI);
      expect(world.npc.state[i]).toBe(PED.Idle);
      expect(world.npc.radius[i]).toBe(HUMAN_R);
    });
  });

  it('a stall with its back to a wall of props faces its open side', () => {
    // Planters along the south of the row (row 31): the traders stand north of their stalls, facing north.
    const world = marketWorld(88, { extraProps: STALL_COLS.map((c) => [c, STALL_ROW + 1, 'prop.planter']) });
    step(world);
    for (const i of traders(world)) {
      expect(world.npc.y[i]).toBe((STALL_ROW - 1) * 2 + 1);
      expect(world.npc.heading[i]).toBe(0);
    }
  });

  it('a market at 30 s opens then: no traders before, all of them on the next tick after', () => {
    const world = marketWorld(88, { marketAt: [30], close: null });
    expect(world.shiftEvents.marketOpen).toBe(false);
    let opened = -1;
    for (let t = 0; t < 2400 && opened < 0; t++) {
      step(world);
      if (world.shiftEvents.marketOpen) opened = shiftElapsedTicks(world.shift);
      else expect(traders(world)).toHaveLength(0);
    }
    expect(opened).toBe(30 * 60);
    expect(traders(world)).toHaveLength(0);
    step(world);
    expect(traders(world)).toHaveLength(4);
  });

  it('the market pitches param mans only the listed stalls; a pitch that is no stall is refused', () => {
    const world = marketWorld(88, {
      marketParams: {
        pitches: [
          [22, STALL_ROW],
          [20, STALL_ROW],
        ],
      },
    });
    step(world);
    const t = traders(world);
    expect(t.map((i) => world.npc.x[i])).toEqual([45, 41]);
    const { level } = npcTown(TOWN_TILES, {});
    level.props.push({ id: 'prop.market_stall', x: 41, y: 61, rot: 0 });
    level.schedules = [event('market', [], { pitches: [[5, 5]] })];
    expect(() => createWorld(level, 1, DEFAULT_TUNING)).toThrow(/not the tile of a prop.market_stall/);
  });

  it('never moves: not under hi-vis, not for the horn, not when Bessie bumps or hits him', () => {
    const world = marketWorld(88);
    step(world);
    const t = traders(world);
    const home = t.map((i) => [world.npc.x[i], world.npc.y[i]]);
    // Bessie parked in the aisle 4 m south of trader 1, inside the awareness radius, under hi-vis, honking.
    const target = t[1] as number;
    const tx = world.npc.x[target] as number;
    const ty = world.npc.y[target] as number;
    world.vehicle.xM = tx;
    world.vehicle.yM = ty + 4;
    world.vehicle.headingRad = 0;
    startHiVis(world);
    const check = (): void => {
      t.forEach((i, k) => {
        expect([world.npc.x[i], world.npc.y[i]]).toEqual(home[k]);
        expect((world.npc.flags[i] as number) & (NPC_FLAG.HI_VIS | NPC_FLAG.YIELDING)).toBe(0);
      });
    };
    for (let k = 0; k < 120; k++) {
      step(world, 0, k % 40 === 0 ? honk() : neutral);
      check();
    }
    // A bump (0.5 m/s, below the 1 m/s hit speed), then, once the contact window has passed, a hit.
    world.vehicle.yM = ty + HALF_L + HUMAN_R + 0.2;
    for (let k = 0; k < 60; k++) {
      step(world, 0.5);
      check();
    }
    expect(world.npcAi.reactions.bumps).toBeGreaterThan(0);
    expect(world.npcAi.reactions.hits).toBe(0);
    world.vehicle.yM = ty + 6;
    for (let k = 0; k < 120; k++) step(world, 0);
    world.vehicle.yM = ty + HALF_L + HUMAN_R + 0.3;
    for (let k = 0; k < 300; k++) {
      step(world, k < 20 ? 3 : 0);
      check();
    }
    expect(world.npcAi.reactions.hits).toBe(1);
  });

  it('a hit costs −250 and 1 complaint; he falls, gets up and shakes his fist where he stands, then faces his aisle', () => {
    const world = marketWorld(88);
    step(world);
    const i = traders(world)[2] as number;
    const tx = world.npc.x[i] as number;
    const ty = world.npc.y[i] as number;
    // Bessie in the aisle, nose 0.3 m short of him, driving north into him at 3 m/s.
    world.vehicle.xM = tx;
    world.vehicle.yM = ty + HALF_L + HUMAN_R + 0.3;
    world.vehicle.headingRad = 0;
    let hitTick = -1;
    for (let k = 0; k < 30 && hitTick < 0; k++) {
      step(world, 3);
      if (countEvents(world.events, EV.NpcHit) > 0) hitTick = world.tick;
    }
    expect(hitTick).toBeGreaterThan(0);
    expect(world.scoring.penaltyPts).toBe(-250);
    expect(world.scoring.score).toBe(-250);
    expect(world.complaints.count).toBe(1);
    expect(world.npc.state[i]).toBe(PED.Fallen);
    // Back her off and watch him get up where he fell.
    world.vehicle.yM = ty + 8;
    const states: number[] = [];
    for (let k = 0; k < FALLEN_TICKS + GET_UP_TICKS + ANGRY_TICKS + 5; k++) {
      step(world);
      states.push(world.npc.state[i] as number);
      expect([world.npc.x[i], world.npc.y[i]]).toEqual([tx, ty]);
    }
    expect(states).toContain(PED.GetUp);
    expect(states).toContain(PED.Angry);
    expect(world.npc.state[i]).toBe(PED.Idle);
    expect(world.npc.heading[i]).toBe(Math.PI);
    // One hit, one penalty, one complaint.
    expect(world.npcAi.reactions.hits).toBe(1);
    expect(world.complaints.count).toBe(1);
  });

  it('the traders take their place in the 80: ambient spawns leave room for the pitches still to open', () => {
    const { level } = npcTown(TOWN_TILES, {
      population: [{ fromS: 0, toS: 1000, target: 200 }],
      mix: [{ id: 'npc.shopper', weight: 1 }],
    });
    for (const c of STALL_COLS)
      level.props.push({ id: 'prop.market_stall', x: (c + 0.5) * 2, y: 61, rot: 0 });
    level.schedules = [event('market', [60], {})];
    const world = createWorld(level, 5, DEFAULT_TUNING);
    let maxAmbient = 0;
    let full = 0;
    for (let t = 0; t < 4800; t++) {
      step(world, 0, t === 0 ? neutralThrottle() : neutral);
      let ambient = 0;
      for (let i = 0; i < world.npc.count; i++) if (world.npc.origin[i] === NpcOrigin.Ambient) ambient++;
      maxAmbient = Math.max(maxAmbient, ambient);
      expect(world.npc.count).toBeLessThanOrEqual(NPC_CAPACITY);
      if (world.npc.count === NPC_CAPACITY) full++;
    }
    // The street filled to 76 before the market opened at 60 s, with room kept for the four traders, who then
    // took it: the store full, never over.
    expect(traders(world)).toHaveLength(4);
    expect(maxAmbient).toBe(NPC_CAPACITY - 4);
    expect(full).toBeGreaterThan(0);
  });
});

/** A frame with a touch of throttle, so the timer starts on the first tick (shift.ts rollout rule). */
function neutralThrottle(): typeof neutral {
  return { ...neutral, throttle: 1 };
}

describe('market_close: the closing pile (LEVEL_DESIGN §4.3, §4.5)', () => {
  /** Run `world` with Bessie parked until elapsed reaches `elapsedTicks` (the tick it does included). */
  function runTo(world: World, elapsedTicks: number): void {
    while (shiftElapsedTicks(world.shift) < elapsedTicks) step(world);
  }

  it('at 180 s builds itemsPerPitch items per pitch over buildS, round by round, all counted in litter spawned', () => {
    const world = marketWorld(88, { close: { buildS: 20, itemsPerPitch: 3 } });
    const ev = world.shiftEvents;
    runTo(world, 180 * 60 - 1);
    expect(world.litter.litterSpawned).toBe(0);
    expect(ev.closeActive).toBe(-1);
    // Rounds of 4 (one per pitch) on elapsed 10800, 11200 and 11600: 0, 1/3 and 2/3 of the 1,200-tick build.
    const added = new Map<number, number>();
    while (shiftElapsedTicks(world.shift) < (180 + 25) * 60) {
      const before = world.litter.litterSpawned;
      step(world);
      const d = world.litter.litterSpawned - before;
      if (d > 0) added.set(shiftElapsedTicks(world.shift), d);
    }
    expect([...added]).toEqual([
      [10800, 4],
      [11200, 4],
      [11600, 4],
    ]);
    expect(world.litter.litterSpawned).toBe(4 * 3);
    expect(world.litter.count).toBe(12);
    expect(ev.itemsSpawned).toBe(12);
    expect(ev.itemsRefused).toBe(0);
    expect(ev.closeActive).toBe(-1);
    expect(ev.closeNext).toBe(1);
    // Every item lies round the stalls (within PILE_REACH_TILES of one), on no stall's and no trader's tile, and
    // is of the district's small-litter kinds (the default table).
    const stallTiles = new Set(STALL_COLS.map((c) => STALL_ROW * TOWN_TILES + c));
    const traderTiles = new Set(STALL_COLS.map((c) => (STALL_ROW + 1) * TOWN_TILES + c));
    for (let k = 0; k < world.litter.count; k++) {
      const col = Math.floor((world.litter.x[k] as number) / 2);
      const row = Math.floor((world.litter.y[k] as number) / 2);
      expect(STALL_COLS.some((c) => Math.abs(col - c) <= PILE_REACH_TILES)).toBe(true);
      expect(Math.abs(row - STALL_ROW)).toBeLessThanOrEqual(PILE_REACH_TILES);
      expect(stallTiles.has(row * TOWN_TILES + col)).toBe(false);
      expect(traderTiles.has(row * TOWN_TILES + col)).toBe(false);
      expect(SMALL.has(LITTER_IDS[world.litter.kind[k] as number] as string)).toBe(true);
    }
    // The traders are still at their pitches.
    expect(traders(world)).toHaveLength(4);
  });

  it('is deterministic per seed and draws on the events stream', () => {
    const a = marketWorld(7, { close: { buildS: 0, itemsPerPitch: 5 }, closeAt: [1] });
    const b = marketWorld(7, { close: { buildS: 0, itemsPerPitch: 5 }, closeAt: [1] });
    const c = marketWorld(8, { close: { buildS: 0, itemsPerPitch: 5 }, closeAt: [1] });
    for (const w of [a, b, c]) runTo(w, 61);
    expect(a.litter.litterSpawned).toBe(20);
    const pos = (w: World): number[] => [...w.litter.x.subarray(0, w.litter.count)];
    expect(pos(a)).toEqual(pos(b));
    expect(pos(a)).not.toEqual(pos(c));
    expect(a.eventsRng.counter).toBe(b.eventsRng.counter);
    // buildS 0: all five rounds on the close's own tick.
    expect(a.shiftEvents.closeActive).toBe(-1);
  });

  it('uses its own table when it names one, and the defaults when it names nothing', () => {
    const world = marketWorld(9, {
      close: { buildS: 1, itemsPerPitch: 2, table: { 'litter.pizza_box': 1 } },
      closeAt: [2],
    });
    runTo(world, 4 * 60);
    expect(world.litter.litterSpawned).toBe(8);
    for (let k = 0; k < world.litter.count; k++)
      expect(LITTER_IDS[world.litter.kind[k] as number]).toBe('litter.pizza_box');
    const d = marketWorld(9, { close: {} });
    expect(d.shiftEvents.closeItems[0]).toBe(MARKET_CLOSE_DEFAULT_ITEMS);
    expect(d.shiftEvents.closeBuildTicks[0]).toBe(MARKET_CLOSE_DEFAULT_BUILD_S * 60);
  });

  it('piles at every stall without a market event, and two closes run one after the other', () => {
    const world = marketWorld(10, {
      marketAt: null,
      close: { buildS: 10, itemsPerPitch: 2 },
      closeAt: [5, 8],
    });
    expect(world.shiftEvents.hasMarket).toBe(false);
    expect(world.shiftEvents.closeCount).toBe(2);
    runTo(world, 30 * 60);
    expect(traders(world)).toHaveLength(0);
    expect(world.litter.litterSpawned).toBe(2 * 2 * 4);
    // The second, due at 8 s while the first builds until 10 s (its last round at 5 + 5 s), starts as it ends.
    expect(world.shiftEvents.closeNext).toBe(2);
  });

  it('respects the 2,000-item cap: a full field takes nothing, and the refusals are counted', () => {
    const world = marketWorld(11, { close: { buildS: 0, itemsPerPitch: 3 }, closeAt: [1] });
    const lf = world.litter;
    for (let k = 0; lf.count < lf.capacity; k++)
      addLitter(lf, 0, 4 + (k % 40) * 0.5, 4 + Math.floor(k / 40) * 0.5, 0);
    const spawned = lf.litterSpawned;
    runTo(world, 120);
    expect(lf.litterSpawned).toBe(spawned);
    expect(world.shiftEvents.itemsRefused).toBe(12);
  });

  it('createShiftEvents refuses a stall with no free side and a close with no at', () => {
    const { level } = npcTown(TOWN_TILES, {});
    level.props.push({ id: 'prop.market_stall', x: 41, y: 61, rot: 0 });
    for (const [c, r] of [
      [20, 29],
      [20, 31],
      [19, 30],
      [21, 30],
    ] as const)
      level.props.push({ id: 'prop.planter', x: c * 2 + 1, y: r * 2 + 1, rot: 0 });
    level.schedules = [event('market', [], {})];
    const spill = createWorld(npcTown(TOWN_TILES, {}).level, 1, DEFAULT_TUNING).hazards.spill;
    expect(() => createShiftEvents(level, spill)).toThrow(/no free tile in front/);
    const open = npcTown(TOWN_TILES, {}).level;
    open.props.push({ id: 'prop.market_stall', x: 41, y: 61, rot: 0 });
    open.schedules = [event('market_close', [], {})];
    expect(() => createShiftEvents(open, spill)).toThrow(/needs an at/);
    open.schedules = [event('market', [], {}), event('market', [], {})];
    expect(() => createShiftEvents(open, spill)).toThrow(/at most one market/);
  });
});
