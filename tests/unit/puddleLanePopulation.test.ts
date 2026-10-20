// Puddle Lane's M3 street life (SSP-104; LEVEL_DESIGN §5.1, §4.5, §9): the authored npcs, traffic, hazards,
// knockables and power-up compile to the §5.1 peaks, the first 10–15 s from `@` stay hazard-free, and a seed-1
// shift with Bessie parked in the depot brings in the postie on tick 600, Doris on tick 4,200 and the dog walker
// (with his dog) on tick 7,200, each at their anchor, as the test hooks' state() shows them (snapshotWorld), and
// Doris walks her authored route: home, the zebra, the corner shop, the zebra, home.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TILE_M } from '../../src/sim/constants.ts';
import { HAZARD_IDS, KNOCKABLE_IDS, NPC_IDS } from '../../src/sim/entities.ts';
import { createInputFrame } from '../../src/sim/inputFrame.ts';
import { decodeLevel, HAZARD_RULE } from '../../src/sim/map.ts';
import { NpcOrigin } from '../../src/sim/npc/store.ts';
import { snapshotWorld } from '../../src/sim/snapshot.ts';
import { DEFAULT_TUNING } from '../../src/sim/tuning.ts';
import { createWorld, type World } from '../../src/sim/world.ts';
import { compileLevel, readManifestIds } from '../../tools/levels/compile-level.ts';
import { KERB_BLOB_PATH, readKerbBlob } from '../../tools/levels/kerbBlob.ts';
import { pathSteps } from '../../tools/levels/layoutChecks.ts';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel: string): string => readFileSync(join(REPO_ROOT, rel), 'utf8');

const RESULT = compileLevel({
  name: 'puddle_lane',
  mapText: read('assets-src/levels/puddle_lane.map.txt'),
  levelText: read('assets-src/levels/puddle_lane.level.json'),
  knownAssetIds: readManifestIds(join(REPO_ROOT, 'assets-src/manifest.json')),
  kerbBlob: readKerbBlob(join(REPO_ROOT, KERB_BLOB_PATH)),
});
const OUT = (() => {
  if (RESULT.output === null) throw new Error('puddle_lane does not compile');
  return RESULT.output;
})();
/** The committed compiled level, as the game loads it. */
const LEVEL = decodeLevel(read('public/assets/levels/puddle_lane.json'));
const W = LEVEL.size[0];
const tileOf = (xM: number, yM: number): number => Math.floor(yM / TILE_M) * W + Math.floor(xM / TILE_M);

/** The nav node of anchor `char` (LEVEL_DESIGN §8.2 rule 5; nav.anchors). */
function anchorNode(char: string): number {
  const a = LEVEL.nav.anchors.find((n) => n.char === char);
  if (a === undefined) throw new Error(`no anchor ${char}`);
  return a.node;
}

/**
 * The rollout (LEVEL_DESIGN §4.1, §12): the first 10–15 s from `@`. Brush down Bessie tops out at 6.0 m/s
 * (tuning.json vehicle.sweeper.topSpeedBrushDownMps), so 15 s covers 90 m of road from the depot: Mangle
 * Street and Soapsud Terrace to Gutter Row.
 */
const ROLLOUT_M = 15 * DEFAULT_TUNING.vehicle.sweeper.drive.topSpeedBrushDownMps;

describe('the M3 spawn specs (SSP-104, LEVEL_DESIGN §5.1)', () => {
  it('compile with no diagnostics to the §5.1 peaks: NPCs ≤ 22 of 80, vehicles ≤ 21 of 30', () => {
    expect(RESULT.diagnostics).toEqual([]);
    expect(OUT.text).toBe(read('public/assets/levels/puddle_lane.json'));
    expect(OUT.report.peakNpc).toBeLessThanOrEqual(22);
    expect(OUT.report.peakVehicles).toBeLessThanOrEqual(21);
    // 12 ambient (shoppers 9, mums 2, the old man 1) + Doris, the postie, the dog walker and his dog + 4 cats.
    expect(OUT.report.peakNpc).toBe(20);
  });

  it('caps the ambient mix at §5.1’s peaks and names Doris, the postie and the dog walker', () => {
    const npc = LEVEL.npc;
    if (npc === null) throw new Error('no npc spec');
    expect(Object.fromEntries(npc.caps.map((c) => [c.id, c.cap]))).toEqual({
      'npc.mum_pushchair': 2,
      'npc.old_man_frame': 1,
      'npc.shopper': 9,
    });
    expect(npc.mix.map((m) => m.id).sort()).toEqual([
      'npc.mum_pushchair',
      'npc.old_man_frame',
      'npc.shopper',
    ]);
    expect(npc.named.map((n) => [n.id, n.spawnAtS, n.anchor])).toEqual([
      ['npc.postie', 10, anchorNode('3')],
      ['npc.old_woman', 70, anchorNode('1')],
      ['npc.dog_walker', 120, anchorNode('4')],
    ]);
    const doris = npc.named[1];
    expect(doris?.route).toEqual(['1', '2', '3', '2', '1'].map(anchorNode));
    expect(doris?.loop).toBe(false);
    const walker = npc.named[2];
    expect(walker?.route).toEqual(['4', '5', '6', '7'].map(anchorNode));
    expect(walker?.loop).toBe(true);
    expect(npc.perches).toMatchObject({ id: 'npc.cat', count: 4, on: ['walls', 'carRoofs'] });
    // The population windows cover the whole shift.
    expect(npc.population.at(-1)?.toS).toBe(240);
  });

  it('runs 6 moving cars in the §5.1 mix, 7 parked (60% of 11 bays) and one mobility scooter', () => {
    const t = LEVEL.traffic;
    if (t === null) throw new Error('no traffic spec');
    expect(t.moving).toBe(6);
    expect(Object.fromEntries(t.mix.map((m) => [m.id, m.weight]))).toEqual({
      'veh.hatchback': 55,
      'veh.saloon': 30,
      'veh.van_white': 15,
    });
    expect(t.parkedBays).toBe(11);
    expect(t.parkedFill).toBe(0.6);
    expect(t.parked).toBe(7);
    expect(t.pavement).toEqual([{ id: 'veh.mobility_scooter', count: 1 }]);
    expect(t.moving + t.parked + 1).toBe(OUT.report.peakVehicles);
  });

  it('places 8 puddles on kerbside low points and the flask of tea on the Pump Green path', () => {
    const hz = LEVEL.hazards;
    if (hz === null) throw new Error('no hazard spec');
    expect(hz.random).toEqual([]);
    expect(hz.place).toHaveLength(8);
    for (const p of hz.place) {
      expect(p.id).toBe('haz.puddle');
      const bits = hz.candidates[tileOf(p.x, p.y)] ?? 0;
      expect(bits & HAZARD_RULE.KERBSIDE_LOW_POINTS, `${p.x}, ${p.y}`).not.toBe(0);
    }
    expect(LEVEL.pickups).toEqual({
      count: 1,
      table: [{ id: 'pwr.flask_of_tea', weight: 1 }],
      at: [[61, 23]],
    });
  });

  it('keeps the first 15 s from @ free of hazards and knockables (LEVEL_DESIGN §4.1, §12)', () => {
    const start = tileOf(LEVEL.player.x, LEVEL.player.y);
    const dist = pathSteps(OUT.map, [start]);
    const world = createWorld(LEVEL, 1, DEFAULT_TUNING);
    const hazards = world.hazards;
    expect(hazards.count).toBe(3 + 8);
    for (let i = 0; i < hazards.count; i++) {
      const id = HAZARD_IDS[hazards.kind[i] as number];
      const d = (dist[tileOf(hazards.x[i] as number, hazards.y[i] as number)] ?? -1) * TILE_M;
      expect(d, `${id} at ${hazards.x[i]}, ${hazards.y[i]}`).toBeGreaterThan(ROLLOUT_M);
    }
    const bodies = world.bodies;
    expect(bodies.count).toBe(6);
    const kinds = new Set<string>();
    for (let i = 0; i < bodies.count; i++) {
      kinds.add(KNOCKABLE_IDS[bodies.kind[i] as number] ?? '?');
      // A knockable stands on the pavement: its nearest road tile is past the rollout too.
      const t = tileOf(bodies.x[i] as number, bodies.y[i] as number);
      const near = [t - 1, t + 1, t - W, t + W].map((n) => dist[n] ?? -1).filter((n) => n >= 0);
      expect(Math.min(...near) * TILE_M, `knockable ${i}`).toBeGreaterThan(ROLLOUT_M);
    }
    // Monday allows only bins and recycling boxes (L005): no cones, A-boards or trolleys.
    expect([...kinds].sort()).toEqual(['prop.recycling_box', 'prop.wheelie_bin']);
  });
});

/** The live named NPCs of `kind` (store indices). */
function namedOf(world: World, id: string): number[] {
  const kind = NPC_IDS.indexOf(id as (typeof NPC_IDS)[number]);
  const out: number[] = [];
  for (let i = 0; i < world.npc.count; i++) {
    if (world.npc.kind[i] === kind && world.npc.origin[i] === NpcOrigin.Named) out.push(i);
  }
  return out;
}

describe('a seed-1 Puddle Lane shift (SSP-104 acceptance: the named spawns, state())', () => {
  // Bessie stays parked in the depot; the shift's timer starts itself on tick 180 (LEVEL_DESIGN §4.1).
  const world = createWorld(LEVEL, 1, DEFAULT_TUNING);
  const neutral = createInputFrame();
  /** The tick (world.tick before the step) on which each named NPC first appeared. */
  const firstTick = new Map<string, number>();
  const firstAt = new Map<string, { x: number; y: number }>();
  const dorisGoals: number[] = [];
  let peakNpc = 0;
  let peakVehicles = 0;
  let dogWithWalker = false;
  for (let t = 0; t < 13_800; t++) {
    const tick = world.tick;
    world.step(neutral);
    peakNpc = Math.max(peakNpc, world.npc.count);
    peakVehicles = Math.max(peakVehicles, world.vehicles.count);
    for (const id of ['npc.postie', 'npc.old_woman', 'npc.dog_walker']) {
      if (firstTick.has(id) || namedOf(world, id).length === 0) continue;
      firstTick.set(id, tick);
      // What window.__ssp.state() reports (src/debug/testHooks.ts returns snapshotWorld in a shift).
      const s = snapshotWorld(world).npcs.find((n) => n.id === id && n.origin === 'named');
      if (s !== undefined) firstAt.set(id, { x: s.x, y: s.y });
      if (id === 'npc.dog_walker') {
        dogWithWalker = snapshotWorld(world).npcs.some((n) => n.id === id && n.origin === 'companion');
      }
    }
    const doris = namedOf(world, 'npc.old_woman')[0];
    if (doris !== undefined) {
      const g = world.npc.goalNode[doris] as number;
      if (g >= 0 && dorisGoals.at(-1) !== g) dorisGoals.push(g);
    }
  }

  it('brings the postie in on tick 600 at the corner shop door (anchor 3), on his round from 10 s', () => {
    expect(firstTick.get('npc.postie')).toBe(600);
    const n = anchorNode('3');
    expect(firstAt.get('npc.postie')).toEqual({ x: LEVEL.nav.nodeX[n], y: LEVEL.nav.nodeY[n] });
  });

  it('brings Doris in on tick 4,200 at her front door (anchor 1)', () => {
    expect(firstTick.get('npc.old_woman')).toBe(4200);
    const n = anchorNode('1');
    expect(firstAt.get('npc.old_woman')).toEqual({ x: LEVEL.nav.nodeX[n], y: LEVEL.nav.nodeY[n] });
  });

  it('brings the dog walker and his dog in on tick 7,200 at Pump Green (anchor 4)', () => {
    expect(firstTick.get('npc.dog_walker')).toBe(7200);
    const n = anchorNode('4');
    expect(firstAt.get('npc.dog_walker')).toEqual({ x: LEVEL.nav.nodeX[n], y: LEVEL.nav.nodeY[n] });
    expect(dogWithWalker).toBe(true);
  });

  it('walks Doris to the zebra and the corner shop and back home, then lets her potter', () => {
    const route = ['1', '2', '3', '2', '1'].map(anchorNode);
    expect(dorisGoals.slice(0, route.length)).toEqual(route);
  });

  it('stays within the compiled peaks', () => {
    expect(peakNpc).toBeLessThanOrEqual(OUT.report.peakNpc);
    expect(peakVehicles).toBeLessThanOrEqual(OUT.report.peakVehicles);
  });
});
