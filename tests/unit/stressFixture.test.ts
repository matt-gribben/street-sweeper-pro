// The NPC budget's stress fixture (SSP-106; src/debug/stress.ts, TECHNICAL_DESIGN §17): compiled High Street with
// every store raised to its §7.1 capacity, and the director that keeps it there. These are the fixture's own checks
// (fast); the heap-delta check and the Node sim step time are tests/unit/stressAlloc.test.ts.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { STRESS_DISTRICT, STRESS_SHIFT_S, stressLevel } from '../../src/debug/stress.ts';
import { BODY_CAPACITY } from '../../src/sim/bodies.ts';
import { HAZARD_ENTITY_IDS, NPC_IDS } from '../../src/sim/entities.ts';
import { HAZARD_CAPACITY } from '../../src/sim/hazards.ts';
import { LITTER_CAPACITY } from '../../src/sim/litter.ts';
import { decodeLevel, encodeLevel } from '../../src/sim/map.ts';
import { NPC_CAPACITY, NPC_FLAG, NpcOrigin } from '../../src/sim/npc/store.ts';
import { snapshotWorld } from '../../src/sim/snapshot.ts';
import { VEHICLE_CAPACITY, VEHICLE_FLAG } from '../../src/sim/vehicleStore.ts';
import { stressFixtureLevel, stressRig } from '../support/stressWorld.ts';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const kindOf = (id: string): number => (NPC_IDS as readonly string[]).indexOf(id);

describe('stressLevel (SSP-106)', () => {
  const level = stressFixtureLevel();

  it('is High Street with every spawn spec raised to its store capacity', () => {
    expect(level.id).toBe(STRESS_DISTRICT);
    expect(level.timerS).toBe(STRESS_SHIFT_S);
    expect(level.litter?.initial).toBe(LITTER_CAPACITY);
    expect(level.knockables).toHaveLength(BODY_CAPACITY);
    expect(level.hazards?.place).toHaveLength(HAZARD_CAPACITY);
    expect(level.hazards?.random).toEqual([]);
    for (const h of level.hazards?.place ?? []) expect(HAZARD_ENTITY_IDS).toContain(h.id);
    expect(level.hazards?.place.some((h) => h.id === 'haz.open_manhole')).toBe(false);
    expect(level.npc?.population).toEqual([{ fromS: 0, toS: STRESS_SHIFT_S, target: NPC_CAPACITY }]);
    expect(level.npc?.mix.map((m) => m.id)).toEqual(
      expect.arrayContaining(['npc.old_woman', 'npc.dog_walker']),
    );
    expect(level.npc?.perches?.count).toBeGreaterThan(0);
    expect(level.npc?.flocks.length).toBeGreaterThan(0);
    expect(level.npc?.named.every((n) => n.spawnAtS === 0)).toBe(true);
    const traffic = level.traffic;
    expect(traffic?.parked).toBe(traffic?.parkedBays);
    expect((traffic?.parked ?? 0) + (traffic?.moving ?? 0)).toBe(VEHICLE_CAPACITY);
    expect(traffic?.pavement).toEqual([{ id: 'veh.mobility_scooter', count: 1 }]);
  });

  it('survives the browser scene’s encode and decode unchanged', () => {
    expect(decodeLevel(encodeLevel(level))).toEqual(level);
  });

  it('refuses any district but High Street', () => {
    const puddle = decodeLevel(readFileSync(`${REPO_ROOT}public/assets/levels/puddle_lane.json`, 'utf8'));
    expect(() => stressLevel(puddle)).toThrow(/district\.high_street/);
  });
});

describe('the stress World and its director (SSP-106)', () => {
  it('fills the litter, knockable, hazard and parked car stores at shift start', () => {
    const { world } = stressRig(1);
    expect(world.litter.count).toBe(LITTER_CAPACITY);
    expect(world.bodies.count).toBe(BODY_CAPACITY);
    expect(world.hazards.count).toBe(HAZARD_CAPACITY);
    expect(world.vehicles.parkedCount).toBe(world.level.traffic?.parked);
  });

  it('runs every store at capacity with the whole M3 cast on the street', () => {
    const { world, director, step } = stressRig(1);
    // The population fills at two a second; the moving traffic at one portal spawn a tick.
    for (let t = 0; t < 1200; t++) step();
    const npc = world.npc;
    let fullNpc = 0;
    let fullVehicles = 0;
    let roofTicks = 0;
    let minLitter = LITTER_CAPACITY;
    let minMoving = VEHICLE_CAPACITY;
    for (let t = 0; t < 1800; t++) {
      step();
      if (npc.count === NPC_CAPACITY) fullNpc++;
      if (world.vehicles.count === VEHICLE_CAPACITY) fullVehicles++;
      if (world.litter.count < minLitter) minLitter = world.litter.count;
      let moving = 0;
      for (let i = 0; i < world.vehicles.count; i++)
        if (((world.vehicles.flags[i] as number) & VEHICLE_FLAG.PARKED) === 0) moving++;
      if (moving < minMoving) minMoving = moving;
      for (let i = 0; i < npc.count; i++) {
        if (((npc.flags[i] as number) & NPC_FLAG.ON_ROOF) !== 0) {
          roofTicks++;
          break;
        }
      }
    }
    expect(fullNpc).toBeGreaterThan(1800 * 0.8);
    expect(fullVehicles).toBeGreaterThan(1800 * 0.8);
    expect(minMoving).toBeGreaterThan(0);
    // The director puts back one item a tick: the field never runs more than a few items short.
    expect(minLitter).toBeGreaterThanOrEqual(LITTER_CAPACITY - 10);
    expect(world.bodies.count).toBe(BODY_CAPACITY);
    expect(world.hazards.count).toBe(HAZARD_CAPACITY);
    expect(roofTicks).toBeGreaterThan(0);
    const count = (id: string, origin?: number): number => {
      let n = 0;
      for (let i = 0; i < npc.count; i++)
        if (npc.kind[i] === kindOf(id) && (origin === undefined || npc.origin[i] === origin)) n++;
      return n;
    };
    expect(count('npc.old_woman')).toBeGreaterThan(0);
    expect(count('npc.dog_walker', NpcOrigin.Companion)).toBeGreaterThan(0);
    expect(count('npc.pigeon')).toBeGreaterThanOrEqual(12);
    expect(count('npc.cat')).toBe(world.level.npc?.perches?.count);
    expect(count('npc.market_trader')).toBeGreaterThan(0);
    expect(director.dorisPlaced).toBeGreaterThan(0);
    expect(director.catsHit).toBeGreaterThan(0);
    expect(director.leadsPlaced).toBeGreaterThan(0);
    expect(director.peoplePlaced).toBeGreaterThan(0);
    // Never SACKED or TOWED: the shift runs on.
    expect(world.shift.endReason).toBe(0);
  });

  it('is deterministic: the same seed gives the same World', () => {
    const a = stressRig(7);
    const b = stressRig(7, decodeLevel(encodeLevel(stressFixtureLevel())));
    for (let t = 0; t < 900; t++) {
      a.step();
      b.step();
    }
    expect(snapshotWorld(b.world)).toEqual(snapshotWorld(a.world));
  });
});
