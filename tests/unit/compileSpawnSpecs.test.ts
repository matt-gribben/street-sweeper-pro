// SSP-077: the M3 spawn specs in the level compiler (LEVEL_DESIGN §4.3, §8.4, §9.3–§9.6, §10.3–§10.4;
// TECHNICAL_DESIGN §15.2): the npcs, traffic, hazards, knockables and events guards, L005/L007 over every
// spawn list (with an injected entity table), anchors and routes (L080), the hazard candidate tiles and L073,
// the NPC and vehicle peaks and dynamic litter (L050), the L081 warning, the compiled spawns and schedules,
// the par report, and reporting more than one error. The failing fixtures with their exact file:row:col
// messages are in compileLevel.test.ts (l005_pigeon, l050_npcs, l080_anchor; l040_powerups since SSP-055).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, expectTypeOf, it } from 'vitest';
import { TILE_M } from '../../src/sim/constants.ts';
import {
  COLLIDE,
  decodeLevel,
  type EventType,
  encodeLevel,
  HAZARD_RULE,
  type HazardRule,
  type Level,
} from '../../src/sim/map.ts';
import {
  type CompileResult,
  compileLevel,
  formatDiagnostic,
  readManifestIds,
} from '../../tools/levels/compile-level.ts';
import { KERB_BLOB_PATH, readKerbBlob } from '../../tools/levels/kerbBlob.ts';
import { formatParReport, groupDigits } from '../../tools/levels/parReport.ts';
import type { HazardRuleName, EventType as SchemaEventType } from '../../tools/levels/schema.ts';
import {
  type CheckedSpecs,
  DEFAULT_ENTITY_TABLE,
  DISTRICT_MILESTONE,
  type EntityTable,
  entityProblem,
  estimateDynamicLitter,
  estimatePeaks,
  HAZARD_START_CLEAR_TILES,
  LATE_EVENT_S,
  NPC_BUDGET,
  type SpecContext,
  VEHICLE_BUDGET,
} from '../../tools/levels/spawnSpecs.ts';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const FIXTURES = 'tests/fixtures/levels';
const MANIFEST = `${FIXTURES}/manifest.json`;
const KNOWN = readManifestIds(join(REPO_ROOT, MANIFEST));
const BLOB = readKerbBlob(join(REPO_ROOT, KERB_BLOB_PATH));

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ssp-spawn-specs-'));
  tempDirs.push(dir);
  return dir;
}

function runCli(args: readonly string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, ['tools/levels/compile-level.ts', ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  expect(result.error).toBeUndefined();
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

const fixtureText = (name: string, ext: 'map.txt' | 'level.json'): string =>
  readFileSync(join(REPO_ROOT, FIXTURES, name, `${name}.${ext}`), 'utf8');
const BASE: Record<string, unknown> = JSON.parse(fixtureText('spawn_specs', 'level.json'));
const ROWS = fixtureText('spawn_specs', 'map.txt').trimEnd().split('\n');

/** The rows with `s` written at (x, y). */
function edit(rows: readonly string[], x: number, y: number, s: string): string[] {
  const out = [...rows];
  const row = out[y] ?? '';
  out[y] = row.slice(0, x) + s + row.slice(x + s.length);
  return out;
}

/**
 * Compile the spawn_specs fixture (every check on) with level.json fields replaced; an `undefined` field is
 * removed. The level is named `spawn_specs`, so messages read `spawn_specs.level.json:…`.
 */
function compileFixture(
  overrides: Record<string, unknown> = {},
  rows: readonly string[] = ROWS,
  entities?: EntityTable,
): CompileResult {
  const doc = { ...BASE, ...overrides };
  return compileLevel({
    name: 'spawn_specs',
    mapText: rows.map((r) => `${r}\n`).join(''),
    levelText: `${JSON.stringify(doc, null, 2)}\n`,
    knownAssetIds: KNOWN,
    kerbBlob: BLOB,
    ...(entities === undefined ? {} : { entities }),
  });
}

const messages = (result: CompileResult): string[] => result.diagnostics.map(formatDiagnostic);

function ok(result: CompileResult): NonNullable<CompileResult['output']> {
  expect(messages(result)).toEqual([]);
  if (result.output === null) throw new Error('expected a compiled level');
  return result.output;
}

/**
 * Just the code and message of every diagnostic, sorted by text: the compiler sorts them by position, which
 * the fixture tests pin; here the content is what is checked.
 */
const codes = (result: CompileResult): string[] =>
  result.diagnostics.map((d) => `${d.code} ${d.message}`).sort();
/** `codes` for an expected list: the same sort. */
const sorted = (list: readonly string[]): string[] => [...list].sort();

/** The specs and fields of a Puddle Lane level with nothing but its M2 content (no M3 street life). */
const PUDDLE: Record<string, unknown> = {
  id: 'district.puddle_lane',
  npcs: undefined,
  traffic: undefined,
  hazards: undefined,
  knockables: undefined,
  events: undefined,
};

const nodeOfAnchor = (level: Level, char: string): number =>
  level.nav.anchors.find((a) => a.char === char)?.node ?? -1;

describe('schema.ts (type-only) and src/sim/map.ts', () => {
  it('name the same event types and hazard rules', () => {
    expectTypeOf<SchemaEventType>().toEqualTypeOf<EventType>();
    expectTypeOf<HazardRuleName>().toEqualTypeOf<HazardRule>();
  });
});

describe('entity references (L005, L007)', () => {
  it('fails an entity whose milestone is later than the district’s (injected table, L007)', () => {
    const table: EntityTable = {
      ...DEFAULT_ENTITY_TABLE,
      'npc.test_m6': {
        class: 'npc',
        districts: ['district.puddle_lane'],
        milestone: 'M6',
        behaviour: 'shopper',
      },
    };
    const npcs = { population: [{ from: 0, to: 240, target: 4 }], mix: { 'npc.test_m6': 1 } };
    expect(codes(compileFixture({ ...PUDDLE, npcs }, ROWS, table))).toEqual([
      'L007 npcs.mix npc.test_m6 has entities.json milestone M6, later than M3, the milestone that delivers district.puddle_lane',
    ]);
    // The same entity delivered in M3 is fine, and the default table does not know it (L005).
    const m3: EntityTable = {
      ...table,
      'npc.test_m6': { ...table['npc.test_m6'], milestone: 'M3' } as never,
    };
    ok(compileFixture({ ...PUDDLE, npcs }, ROWS, m3));
    expect(codes(compileFixture({ ...PUDDLE, npcs }))).toEqual([
      'L005 npcs.mix "npc.test_m6" is not a canonical npc.* id in src/data/entities.json',
    ]);
  });

  it('checks the milestone against the district’s delivery milestone (Mon–Tue M3, the rest M6)', () => {
    const table: EntityTable = {
      'npc.late': { class: 'npc', districts: ['district.gasworks', 'district.puddle_lane'], milestone: 'M6' },
      'npc.later': { class: 'npc', districts: ['district.gasworks'], milestone: 'M7' },
    };
    expect(DISTRICT_MILESTONE['district.high_street']).toBe('M3');
    expect(DISTRICT_MILESTONE['district.depot_yard']).toBe('M6');
    expect(entityProblem(table, 'npc.late', 'npc', 'district.gasworks', 'w')).toBeNull();
    expect(entityProblem(table, 'npc.late', 'npc', 'district.puddle_lane', 'w')?.code).toBe('L007');
    expect(entityProblem(table, 'npc.later', 'npc', 'district.gasworks', 'w')?.code).toBe('L007');
    expect(entityProblem(table, 'npc.later', 'npc', 'district.high_street', 'w')?.message).toBe(
      'w npc.later is not allowed in district.high_street (entities.json districts)',
    );
    // A district outside entities.json (a fixture) checks only the id and class.
    expect(entityProblem(table, 'npc.later', 'npc', 'district.fixture_x', 'w')).toBeNull();
    expect(entityProblem(table, 'npc.late', 'veh', 'district.fixture_x', 'w')?.code).toBe('L005');
  });

  it('fails ids outside the district, of the wrong class or not canonical, in every spawn list (L005)', () => {
    expect(
      codes(
        compileFixture({
          ...PUDDLE,
          npcs: {
            population: [{ from: 0, to: 240, target: 2 }],
            mix: { 'npc.shopper': 1, 'veh.hatchback': 1 },
            flocks: [{ id: 'npc.seagull', count: 1, size: [2, 3], near: 'prop.litter_bin' }],
          },
          traffic: {
            densityPerKm: 1,
            mix: { 'veh.bus': 1 },
            parkedFill: 0,
            parkedMix: {},
          },
          hazards: { random: [{ id: 'haz.pothole', count: 1, rule: 'carriageway' }] },
          knockables: [{ id: 'prop.traffic_cone', at: [3.5, 5.5] }],
          events: [{ type: 'population_wave', at: 60, untilS: 90, npc: 'npc.litterbug', delta: 1 }],
        }),
      ),
    ).toEqual(
      sorted([
        'L005 npcs.mix "veh.hatchback" is not a canonical npc.* id in src/data/entities.json',
        'L005 npcs.flocks[0].id "npc.seagull" is not a canonical npc.* id in src/data/entities.json',
        'L005 traffic.mix veh.bus is not allowed in district.puddle_lane (entities.json districts)',
        'L005 hazards.random[0].id haz.pothole is not allowed in district.puddle_lane (entities.json districts)',
        'L005 knockables[0].id prop.traffic_cone is not allowed in district.puddle_lane (entities.json districts)',
        'L005 events[0].npc npc.litterbug is not allowed in district.puddle_lane (entities.json districts)',
      ]),
    );
  });

  it('keeps the M2 lists on the table: litter, power-ups and Lost Property (L005, L007)', () => {
    const table: EntityTable = {
      ...DEFAULT_ENTITY_TABLE,
      'pwr.flask_of_tea': { ...DEFAULT_ENTITY_TABLE['pwr.flask_of_tea'], milestone: 'M9' } as never,
    };
    expect(codes(compileFixture(PUDDLE, ROWS, table))).toEqual([
      'L007 powerups.table pwr.flask_of_tea has entities.json milestone M9, later than M3, the milestone that delivers district.puddle_lane',
    ]);
  });
});

describe('npcs', () => {
  it('compiles population, mix, caps, named NPCs on nav nodes, perches on walls and flocks', () => {
    const { level } = ok(compileFixture());
    const npc = level.npc;
    if (npc === null) throw new Error('no npc spec');
    expect(npc.population).toEqual([
      { fromS: 0, toS: 120, target: 6 },
      { fromS: 120, toS: 240, target: 10 },
    ]);
    expect(npc.mix.map((m) => m.id)).toEqual(['npc.dog_walker', 'npc.postie', 'npc.shopper']);
    expect(npc.caps).toEqual([
      { id: 'npc.dog_walker', cap: 1 },
      { id: 'npc.postie', cap: 1 },
      { id: 'npc.shopper', cap: 6 },
    ]);
    const [doris] = npc.named;
    expect(doris?.anchor).toBe(nodeOfAnchor(level, '1'));
    expect(doris?.route).toEqual(['1', '2', '4', '2', '1'].map((c) => nodeOfAnchor(level, c)));
    expect(doris).toMatchObject({ id: 'npc.old_woman', count: 1, spawnAtS: 70, loop: false });
    // The three `w` tiles of row 22, at their centres in metres.
    expect(npc.perches).toEqual({
      id: 'npc.cat',
      count: 2,
      on: ['walls', 'carRoofs'],
      walls: [12, 13, 14].map((x) => [(x + 0.5) * TILE_M, 22.5 * TILE_M]),
    });
    // The flock's `near: prop.litter_bin` resolves to every litter bin on the map (one, at (32, 1)).
    const bins = level.props.filter((p) => p.id === 'prop.litter_bin').map((p) => [p.x, p.y]);
    expect(bins).toEqual([[65, 3]]);
    expect(npc.flocks).toEqual([{ id: 'npc.pigeon', count: 1, size: [6, 8], points: bins }]);
  });

  it('fails a route that leaves the nav graph, an anchor not on the map, and a loop that cannot close (L080)', () => {
    // Without the zebra the north pavement (anchors 1 and 2) is cut off from the rest; the north–south road at
    // x 18–20 already parts the west of rows 5–12 (anchor 4) from the east (anchor 3), with no crossing.
    let rows = ROWS;
    for (const y of [2, 3, 4]) rows = edit(rows, 8, y, '##');
    const npcs = {
      population: [],
      mix: {},
      named: [
        { id: 'npc.old_woman', anchor: '1', spawnAt: 70, route: ['1', '2', '4'] },
        { id: 'npc.dog_walker', anchor: '4', spawnAt: 120, route: ['4', '3', 'west_door'], loop: true },
      ],
    };
    expect(codes(compileFixture({ npcs, events: undefined }, rows))).toEqual(
      sorted([
        'L080 npcs.named[0] (npc.old_woman) route leg 2 → 4 leaves the nav graph: no pavement path joins them',
        'L080 npcs.named[1] (npc.dog_walker) route leg 4 → 3 leaves the nav graph: no pavement path joins them',
        'L080 npcs.named[1] (npc.dog_walker) route leg 3 → west_door leaves the nav graph: no pavement path joins them',
        // The loop's way back to its start.
        'L080 npcs.named[1] (npc.dog_walker) route leg west_door → 4 leaves the nav graph: no pavement path joins them',
      ]),
    );
    // A loop within one part of the graph closes.
    const loop = [
      { id: 'npc.dog_walker', anchor: '4', spawnAt: 120, route: ['4', 'back_lane', '4'], loop: true },
    ];
    ok(compileFixture({ npcs: { ...npcs, named: loop }, events: undefined }, rows));
    // Anchors by name resolve like digits; one defined but never placed fails once the map is read.
    const named = [{ id: 'npc.old_woman', anchor: 'west_door', spawnAt: 0, route: ['back_lane', '8'] }];
    expect(
      codes(
        compileFixture({ anchors: { ...(BASE.anchors as object), 8: 'nowhere' }, npcs: { ...npcs, named } }),
      ),
    ).toEqual([
      'L080 npcs.named[0] (npc.old_woman) route names anchor 8 (nowhere), which is not on the map or has no pavement near it',
    ]);
  });

  it('checks the shape: windows, caps, named fields, perches and flocks (L000)', () => {
    const npcs = (over: Record<string, unknown>): Record<string, unknown> => ({
      npcs: { population: [{ from: 0, to: 240, target: 2 }], mix: { 'npc.shopper': 1 }, ...over },
    });
    expect(
      codes(
        compileFixture(
          npcs({
            population: [
              { from: 0, to: 120, target: 2 },
              { from: 100, to: 240, target: 3 },
              { from: 200, to: 300, target: 3 },
              { from: 0, to: 10, target: -1 },
            ],
          }),
        ),
      ),
    ).toEqual(
      sorted([
        'L000 npcs.population[1] overlaps the window before it (windows ascend without overlapping)',
        'L000 npcs.population[2] needs 0 ≤ from < to ≤ 240 (elapsed seconds)',
        'L000 npcs.population[3] overlaps the window before it (windows ascend without overlapping)',
      ]),
    );
    expect(codes(compileFixture(npcs({ caps: { 'npc.postie': 1, 'npc.shopper': -1 } })))).toEqual(
      sorted([
        'L000 npcs.caps npc.postie is not in npcs.mix (caps limit the ambient mix)',
        'L000 npcs.caps npc.shopper must be a non-negative integer',
      ]),
    );
    expect(
      codes(
        compileFixture(
          npcs({ named: [{ id: 'npc.old_woman', anchor: '1', spawnAt: 240, route: ['1'] }], mix: {} }),
        ),
      ),
    ).toEqual(
      sorted([
        'L000 npcs.named[0].spawnAt must be elapsed seconds 0 ≤ spawnAt < 240',
        'L000 npcs.mix must name at least one npc.* id when a population target is above 0',
      ]),
    );
    expect(codes(compileFixture(npcs({ perches: { id: 'npc.shopper', count: 1, on: ['walls'] } })))).toEqual([
      'L000 npcs.perches.id must be npc.cat (only cats perch)',
    ]);
    expect(
      codes(compileFixture(npcs({ perches: { id: 'npc.cat', count: 1, on: ['walls', 'walls'] } }))),
    ).toEqual(['L000 npcs.perches.on must list distinct surfaces from walls, carRoofs, road']);
    // Walls only, on a map with none: nowhere to perch.
    expect(
      codes(
        compileFixture(
          npcs({ perches: { id: 'npc.cat', count: 1, on: ['walls'] } }),
          edit(ROWS, 12, 22, 'EEE'),
        ),
      ),
    ).toEqual(['L000 npcs.perches has nowhere to perch on walls: no w walls, parked cars or lanes there']);
    expect(
      codes(
        compileFixture(npcs({ flocks: [{ id: 'npc.shopper', count: 1, size: [3, 2], near: 'prop.bench' }] })),
      ),
    ).toEqual(['L000 npcs.flocks[0].id npc.shopper is not a flocking bird (pigeon or seagull)']);
    expect(
      codes(
        compileFixture(npcs({ flocks: [{ id: 'npc.pigeon', count: 1, size: [3, 4], near: 'prop.bench' }] })),
      ),
    ).toEqual(['L000 npcs.flocks[0].near prop.bench matches nothing on the map']);
    expect(codes(compileFixture(npcs({ colour: 'red' })))).toEqual([
      'L000 npcs.colour is not a field (population, mix, caps, named, perches, flocks)',
    ]);
  });
});

describe('traffic', () => {
  it('compiles the moving and parked targets from the lane graph, pavement vehicles, the rank and the bus route', () => {
    const { level } = ok(compileFixture());
    const t = level.traffic;
    if (t === null) throw new Error('no traffic spec');
    let laneM = 0;
    const g = level.lanes;
    for (let e = 0; e < g.edgeCount; e += 1) {
      const a = g.edgeFrom[e] ?? 0;
      const b = g.edgeTo[e] ?? 0;
      laneM += Math.hypot((g.nodeX[b] ?? 0) - (g.nodeX[a] ?? 0), (g.nodeY[b] ?? 0) - (g.nodeY[a] ?? 0));
    }
    expect(t.laneKm).toBe(Math.round(laneM) / 1000);
    expect(t.moving).toBe(Math.ceil(4 * t.laneKm));
    // Six `p` cells, half filled: 3 parked cars.
    expect(t.parkedBays).toBe(6);
    expect(t.parked).toBe(3);
    expect(t.pavement).toEqual([{ id: 'veh.mobility_scooter', count: 1 }]);
    expect(t.taxiRank).toEqual([[61, 29]]);
    expect(t.busEveryS).toBe(45);
    // One lane node per anchor, each within 6 m of its anchor tile.
    expect(t.busRoute).toHaveLength(2);
    const anchorTiles = { 0: [1, 1], 1: [33, 5] } as const;
    t.busRoute.forEach((node, i) => {
      const [tx, ty] = anchorTiles[i as 0 | 1];
      const d = Math.hypot(
        (g.nodeX[node] ?? 0) - (tx + 0.5) * TILE_M,
        (g.nodeY[node] ?? 0) - (ty + 0.5) * TILE_M,
      );
      expect(d).toBeLessThanOrEqual(6);
    });
  });

  it('fails a bus route leg no lane can drive (a one-way street), and an anchor far from every lane (L080)', () => {
    let rows = ROWS;
    for (const y of [2, 3, 4]) rows = edit(rows, 0, y, (rows[y] ?? '').replace(/#/g, '>'));
    const traffic = { ...(BASE.traffic as object), busRoute: ['3', '1'] };
    expect(codes(compileFixture({ traffic }, rows))).toEqual([
      'L080 traffic.busRoute leg 3 → 1 leaves the lane graph: no lane leads from one to the other',
    ]);
    const far = edit(ROWS, 8, 19, '5');
    expect(
      codes(
        compileFixture(
          {
            anchors: { ...(BASE.anchors as object), 5: 'yard' },
            traffic: { ...(BASE.traffic as object), busRoute: ['1', '5'] },
          },
          far,
        ),
      ),
    ).toEqual([
      'L080 traffic.busRoute names anchor 5, more than 6 m from any traffic lane, so the route leaves the lane graph',
    ]);
  });

  it('keeps parked cars out of mix, pavement vehicles in pavement, and checks the rest (L000)', () => {
    const traffic = (over: Record<string, unknown>): Record<string, unknown> => ({
      traffic: { densityPerKm: 2, mix: { 'veh.hatchback': 1 }, parkedFill: 0, parkedMix: {}, ...over },
    });
    expect(
      codes(
        compileFixture(
          traffic({ mix: { 'veh.saloon_parked': 1, 'veh.mobility_scooter': 1, 'veh.saloon': 1 } }),
        ),
      ),
    ).toEqual(
      sorted([
        'L000 traffic.mix veh.saloon_parked is a parked car: list it in traffic.parkedMix',
        'L000 traffic.mix veh.mobility_scooter drives on pavements: list it in traffic.pavement with a count',
      ]),
    );
    expect(codes(compileFixture(traffic({ parkedFill: 0.5, parkedMix: { 'veh.hatchback': 1 } })))).toEqual([
      'L000 traffic.parkedMix veh.hatchback is not a parked car (veh.*_parked)',
    ]);
    expect(codes(compileFixture(traffic({ parkedFill: 0.5, parkedMix: {} })))).toEqual([
      'L000 traffic.parkedMix must name at least one parked car when parkedFill is above 0',
    ]);
    expect(
      codes(compileFixture(traffic({ pavement: { 'veh.bicycle': 1, 'veh.mobility_scooter': 0 } }))),
    ).toEqual(
      sorted([
        'L000 traffic.pavement veh.bicycle does not drive on pavements',
        'L000 traffic.pavement veh.mobility_scooter must be a positive integer count',
      ]),
    );
    expect(codes(compileFixture(traffic({ busRoute: ['1', '3'] })))).toEqual([
      'L000 traffic.busRoute and traffic.busEveryS go together',
    ]);
    expect(codes(compileFixture(traffic({ taxiRank: [[3.5, 5.5]] })))).toEqual([
      'L000 traffic.taxiRank[0] [3.5, 5.5] is not on a road tile',
    ]);
    expect(codes(compileFixture({ traffic: { none: true, densityPerKm: 1 } }))).toEqual([
      'L000 traffic.none must be true and stand alone ({ "none": true })',
    ]);
    // { none: true } compiles with no traffic spec (and so no parked-car perches).
    const none = ok(compileFixture({ traffic: { none: true } }));
    expect(none.level.traffic).toBeNull();
    expect(none.level.lanes.nodeCount).toBe(0);
  });
});

describe('hazards (LEVEL_DESIGN §9.3, L073)', () => {
  const { level, map } = ok(compileFixture());
  const hz = level.hazards;
  const [w, h] = level.size;
  const bits = (x: number, y: number): number => hz?.candidates[y * w + x] ?? 0;

  it('compiles placements in metres, random requests and a w·h candidate layer', () => {
    expect(hz?.place).toEqual([{ id: 'haz.pothole', x: 61, y: 7 }]);
    expect(hz?.random).toEqual([{ id: 'haz.puddle', count: 3, rule: 'kerbside_low_points' }]);
    expect(hz?.candidates).toHaveLength(w * h);
  });

  it('marks the gutter, the wheel tracks and the tiles near bays, and nothing the exclusions forbid', () => {
    const laneTile = new Set<number>();
    for (let k = 0; k < level.lanes.nodeCount; k += 1)
      laneTile.add(
        Math.floor((level.lanes.nodeY[k] ?? 0) / TILE_M) * w +
          Math.floor((level.lanes.nodeX[k] ?? 0) / TILE_M),
      );
    const kerb = COLLIDE.KERB_EDGE_N | COLLIDE.KERB_EDGE_E | COLLIDE.KERB_EDGE_S | COLLIDE.KERB_EDGE_W;
    const start = [7, 21];
    let kerbside = 0;
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const i = y * w + x;
        const b = bits(x, y);
        const c = ROWS[y]?.[x] ?? ' ';
        if (b === 0) continue;
        expect(map.drivable[i]).toBe(1);
        expect(Math.max(Math.abs(x - (start[0] ?? 0)), Math.abs(y - (start[1] ?? 0)))).toBeGreaterThan(
          HAZARD_START_CLEAR_TILES,
        );
        expect('zp$sh'.includes(c)).toBe(false);
        if (b & HAZARD_RULE.KERBSIDE_LOW_POINTS) {
          kerbside += 1;
          expect((level.layers.collide[i] ?? 0) & kerb).not.toBe(0);
        }
        if (b & HAZARD_RULE.CARRIAGEWAY) expect(laneTile.has(i)).toBe(true);
      }
    }
    expect(kerbside).toBeGreaterThan(20);
    // The hydrant at (4, 1) clears the 3×3 round it; the zebra at x 8–9 and the bays get nothing.
    for (let y = 0; y <= 2; y += 1) for (let x = 3; x <= 5; x += 1) expect(bits(x, y)).toBe(0);
    for (const y of [2, 3, 4]) expect(bits(8, y) | bits(9, y)).toBe(0);
    for (let x = 24; x < 30; x += 1) expect(bits(x, 4)).toBe(0);
    // Near parking: road within 2 tiles of a bay, never beyond.
    expect(bits(22, 2) & HAZARD_RULE.NEAR_PARKING).not.toBe(0);
    expect(bits(31, 3) & HAZARD_RULE.NEAR_PARKING).not.toBe(0);
    expect(bits(21, 3) & HAZARD_RULE.NEAR_PARKING).toBe(0);
    expect(bits(33, 2) & HAZARD_RULE.NEAR_PARKING).toBe(0);
  });

  it('fails a placed hazard on an excluded tile and a random request with too few candidates (L073)', () => {
    const place = [
      { id: 'haz.pothole', at: [8.5, 3.5] },
      { id: 'haz.pothole', at: [4.5, 2.5] },
      { id: 'haz.pothole', at: [7.5, 18.5] },
      { id: 'haz.puddle', at: [26.5, 4.5] },
      { id: 'haz.puddle', at: [10.5, 8.5] },
    ];
    expect(
      codes(
        compileFixture({
          hazards: { place, random: [{ id: 'haz.puddle', count: 999, rule: 'near_parking' }] },
        }),
      ),
    ).toEqual(
      sorted([
        'L073 hazards.place[0] haz.pothole at [8.5, 3.5] is on a site.zebra (LEVEL_DESIGN §9.3)',
        'L073 hazards.place[1] haz.pothole at [4.5, 2.5] is on or next to a hydrant (LEVEL_DESIGN §9.3)',
        `L073 hazards.place[2] haz.pothole at [7.5, 18.5] is within ${HAZARD_START_CLEAR_TILES} tiles of @ (LEVEL_DESIGN §9.3)`,
        'L073 hazards.place[3] haz.puddle at [26.5, 4.5] is on a parking bay (a parked car stands there) (LEVEL_DESIGN §9.3)',
        'L073 hazards.place[4] haz.puddle at [10.5, 8.5] is not on a tile Bessie can drive on (LEVEL_DESIGN §9.3)',
        `L073 hazards.random[0] asks for 999 haz.puddle on near_parking, but only ${countBits(HAZARD_RULE.NEAR_PARKING)} tile(s) qualify (LEVEL_DESIGN §9.3)`,
      ]),
    );
    expect(
      codes(compileFixture({ hazards: { random: [{ id: 'haz.puddle', count: 1, rule: 'drains' }] } })),
    ).toEqual([
      'L000 hazards.random[0].rule "drains" must be one of kerbside_low_points, carriageway, near_parking',
    ]);
  });

  function countBits(bit: number): number {
    let n = 0;
    for (const v of hz?.candidates ?? []) if (v & bit) n += 1;
    return n;
  }
});

describe('knockables', () => {
  it('compiles each at its position in metres and refuses static props and solid tiles', () => {
    const { level } = ok(compileFixture());
    expect(level.knockables).toEqual([
      { id: 'prop.wheelie_bin', x: 51, y: 11 },
      { id: 'prop.recycling_box', x: 7, y: 11 },
    ]);
    expect(
      codes(
        compileFixture({
          knockables: [
            { id: 'prop.bench', at: [3.5, 5.5] },
            { id: 'prop.wheelie_bin', at: [3.5, 8.5] },
            { id: 'prop.wheelie_bin', at: [3.5, 40] },
          ],
        }),
      ),
    ).toEqual(
      sorted([
        'L000 knockables[0].id prop.bench is a static prop, not a knockable (place it on the map)',
        'L000 knockables[2].at must be [x, y] tile coordinates inside the map',
      ]),
    );
    expect(codes(compileFixture({ knockables: [{ id: 'prop.wheelie_bin', at: [3.5, 8.5] }] }))).toEqual([
      'L000 knockables[0] prop.wheelie_bin at [3.5, 8.5] is inside a building, wall or hedge',
    ]);
  });
});

describe('events and schedules', () => {
  it('compiles every event in level.json order, anchors as graph nodes, params with keys sorted', () => {
    const { level, text } = ok(compileFixture());
    expect(level.schedules).toEqual([
      { type: 'dawn', atS: [0], untilS: null, trigger: null, params: { durationS: 20 } },
      {
        type: 'tutorial_beat',
        atS: [],
        untilS: null,
        trigger: 'shift_start',
        params: { text: 'Morning, rookie.' },
      },
      {
        type: 'inspection',
        atS: [60],
        untilS: null,
        trigger: null,
        params: { route: [nodeOfAnchor(level, '2'), nodeOfAnchor(level, '4')], speed: 1 },
      },
      {
        type: 'population_wave',
        atS: [90],
        untilS: 150,
        trigger: null,
        params: { delta: 2, npc: 'npc.shopper' },
      },
    ]);
    expect(text).toContain(
      '{"type":"population_wave","atS":[90],"untilS":150,"trigger":null,"params":{"delta":2,"npc":"npc.shopper"}}',
    );
    // A vehicle anchor (vehicle_stop) becomes a lane node.
    const events = [
      { type: 'vehicle_stop', at: [55, 165], vehicle: 'veh.hatchback', anchor: '3', stopS: 20 },
    ];
    const stop = ok(compileFixture({ events })).level;
    const node = stop.schedules[0]?.params.anchor;
    expect(typeof node).toBe('number');
    expect(stop.schedules[0]?.atS).toEqual([55, 165]);
    const d = Math.hypot(
      (stop.lanes.nodeX[node as number] ?? 0) - 67,
      (stop.lanes.nodeY[node as number] ?? 0) - 11,
    );
    expect(d).toBeLessThanOrEqual(6);
  });

  it('checks the envelope and the params the M3 tooling reads (L000, L005, L080)', () => {
    expect(
      codes(
        compileFixture({
          events: [
            { type: 'fireworks', at: 10 },
            { type: 'dawn', at: 240 },
            { type: 'gust', at: [95, 40] },
            { type: 'rival_cameo', at: 110, untilS: 100, route: ['1', '3'] },
            { type: 'tutorial_beat', trigger: 'shift_start' },
            { type: 'population_wave', at: 60, npc: 'npc.shopper' },
            { type: 'school_out', at: 75, anchor: '7', mix: { 'npc.unicorn': 1 } },
          ],
        }),
      ),
    ).toEqual(
      sorted([
        'L000 events[0].type "fireworks" must be one of dawn, tutorial_beat, market, market_close, bin_round, rain, leaf_fall, school_out, gust, vehicle_stop, rival_cameo, kicking_out, crossing_patrol, parade, inspection, population_wave',
        'L000 events[1] (dawn) at must ascend within the shift (0 ≤ at < 240)',
        'L000 events[2] (gust) at must ascend within the shift (0 ≤ at < 240)',
        'L000 events[3] (rival_cameo) untilS must be after at and at most 240',
        'L000 events[4] (tutorial_beat) needs a non-empty text',
        'L000 events[5] (population_wave) needs delta, a non-zero integer',
        'L000 events[5] (population_wave) needs one at and an untilS',
        'L005 events[6].mix "npc.unicorn" is not a canonical npc.* id in src/data/entities.json',
        'L080 events[6].anchor names anchor "7", which level.json anchors does not define',
      ]),
    );
  });

  it('warns (L081) when the last event is after 200 s, and still compiles', () => {
    const result = compileFixture({ events: [{ type: 'gust', at: [40, 205] }] });
    expect(result.output).not.toBeNull();
    expect(codes(result)).toEqual([
      `L081 last scheduled event (gust) is at 205 s elapsed; districts schedule their last event at or before ${LATE_EVENT_S} s`,
    ]);
    expect(result.diagnostics[0]?.severity).toBe('warning');
    expect(result.output?.report.warnings).toEqual(['L081']);
    expect(codes(compileFixture({ events: [{ type: 'gust', at: [40, 200] }] }))).toEqual([]);
  });
});

describe('peaks, dynamic litter and L050 (LEVEL_DESIGN §10.4)', () => {
  const ctx = (entities: EntityTable = DEFAULT_ENTITY_TABLE): SpecContext => ({
    districtId: 'district.puddle_lane',
    mode: 'shift',
    timerS: 240,
    size: [64, 48],
    anchors: {},
    entities,
  });
  const anchor = { ref: '1', char: '1' };
  /** LEVEL_DESIGN §8.5's Puddle Lane NPCs: 13 capped ambient, Doris, a dog walker and his dog, 4 cats. */
  const puddle: CheckedSpecs = {
    npcs: {
      population: [
        { fromS: 0, toS: 60, target: 12 },
        { fromS: 60, toS: 180, target: 18 },
        { fromS: 180, toS: 240, target: 14 },
      ],
      mix: [
        { id: 'npc.mum_pushchair', weight: 15 },
        { id: 'npc.old_man_frame', weight: 5 },
        { id: 'npc.postie', weight: 10 },
        { id: 'npc.shopper', weight: 70 },
      ],
      caps: [
        { id: 'npc.mum_pushchair', cap: 2 },
        { id: 'npc.old_man_frame', cap: 1 },
        { id: 'npc.postie', cap: 1 },
        { id: 'npc.shopper', cap: 9 },
      ],
      named: [
        { id: 'npc.old_woman', count: 1, spawnAtS: 70, anchor, route: [anchor], loop: false },
        { id: 'npc.dog_walker', count: 1, spawnAtS: 120, anchor, route: [anchor], loop: true },
      ],
      perches: { id: 'npc.cat', count: 4, on: ['walls', 'carRoofs'] },
      flocks: [],
    },
    traffic: null,
    hazards: null,
    knockables: null,
    events: [],
  };

  it('counts capped ambient NPCs, named NPCs, dogs and cats: §8.5 Puddle Lane peaks at 20', () => {
    const peaks = estimatePeaks(puddle, null, 0, ctx());
    expect(peaks.npcParts).toEqual({ ambient: 13, named: 2, dogs: 1, cats: 4, flocks: 0, traders: 0 });
    expect(peaks.npc).toBe(20);
    expect(peaks.vehicles).toBe(0);
  });

  it('uses the raw target when a mix id is uncapped, adds waves, flocks at their largest and market traders', () => {
    const npcs = puddle.npcs;
    if (npcs === null) throw new Error('unreachable');
    const specs: CheckedSpecs = {
      ...puddle,
      npcs: {
        ...npcs,
        caps: npcs.caps.slice(1),
        flocks: [{ id: 'npc.pigeon', count: 2, size: [6, 10], near: 'prop.bench' }],
      },
      events: [
        {
          type: 'population_wave',
          atS: [120],
          untilS: 180,
          trigger: null,
          params: { npc: 'npc.shopper', delta: 8 },
          anchorParams: [],
          index: 0,
        },
        { type: 'market', atS: [], untilS: null, trigger: null, params: {}, anchorParams: [], index: 1 },
      ],
    };
    const peaks = estimatePeaks(specs, null, 12, ctx());
    // Window 60–180 s: 18 + 8; 20 flock birds; 12 stalls.
    expect(peaks.npcParts).toEqual({ ambient: 26, named: 2, dogs: 1, cats: 4, flocks: 20, traders: 12 });
    expect(peaks.npc).toBe(65);
  });

  it('adds moving, parked and pavement vehicles', () => {
    const traffic = {
      densityPerKm: 4,
      laneKm: 1.5,
      moving: 6,
      mix: [],
      parkedFill: 0.6,
      parkedBays: 24,
      parked: 15,
      parkedMix: [],
      pavement: [{ id: 'veh.mobility_scooter', count: 1 }],
      taxiRank: [],
      busRoute: [],
      busEveryS: null,
    };
    const peaks = estimatePeaks(puddle, traffic, 0, ctx());
    expect(peaks.vehicleParts).toEqual({ moving: 6, parked: 15, pavement: 1 });
    expect(peaks.vehicles).toBe(22);
  });

  it('estimates dynamic litter from droppers, knockable spills and market close piles', () => {
    // The dog walker from 120 s: (240 − 120) / 50 s = 2 messes. Doris drops only when hit.
    expect(estimateDynamicLitter(puddle, 13, 0, ctx())).toBe(2);
    const specs: CheckedSpecs = {
      ...puddle,
      knockables: [
        { id: 'prop.wheelie_bin', at: [1, 1] },
        { id: 'prop.recycling_box', at: [2, 1] },
      ],
      events: [
        {
          type: 'market_close',
          atS: [180],
          untilS: null,
          trigger: null,
          params: { itemsPerPitch: 3 },
          anchorParams: [],
          index: 0,
        },
      ],
    };
    // + 4 + 2 spilled, + 3 × 12 stalls.
    expect(estimateDynamicLitter(specs, 13, 12, ctx())).toBe(2 + 6 + 36);
    // Ambient litterbugs at their cap drop every 4 s (mean of 3–5 s) all shift: 2 × 60.
    const bugs: CheckedSpecs = {
      ...puddle,
      npcs: {
        ...(puddle.npcs as NonNullable<CheckedSpecs['npcs']>),
        named: [],
        mix: [{ id: 'npc.litterbug', weight: 1 }],
        caps: [{ id: 'npc.litterbug', cap: 2 }],
      },
    };
    expect(estimateDynamicLitter(bugs, 13, 0, ctx())).toBe(120);
  });

  it('fails L050 for peak vehicles over 30 and counts the dynamic litter into the litter budget', () => {
    const traffic = { ...(BASE.traffic as object), densityPerKm: 100 };
    const result = compileFixture({ traffic });
    expect(codes(result)).toEqual([
      expect.stringMatching(
        /^L050 peak vehicles 44 is over the budget of 30 \(moving 40, parked 3, pavement 1\)$/,
      ),
    ]);
    // spawn_specs expects 10 dynamic items: the ambient dog walker's 4 messes and 6 spilled by the knockables.
    expect(ok(compileFixture()).report.dynamicLitter).toBe(10);
    const litter = { initial: 991, table: { 'litter.crisp_packet': 1 }, gutterBias: 0.5 };
    expect(codes(compileFixture({ litter }))).toEqual([
      'L050 litter.initial 991 + expected dynamic litter 10 = 1001 is over the budget of 1000',
    ]);
    ok(compileFixture({ litter: { ...litter, initial: 990 } }));
    expect(NPC_BUDGET).toBe(80);
    expect(VEHICLE_BUDGET).toBe(30);
  });
});

describe('the par report', () => {
  it('prints the peak NPC and peak vehicle lines (and groups digits without the locale)', () => {
    const { report } = ok(compileFixture());
    const lines = formatParReport(report);
    expect(lines).toContain('  peak NPC 22/80   peak vehicles 6/30');
    expect(lines[0]).toBe('district.fixture_spawn_specs  40x23  seed 1');
    expect(lines.at(-1)).toBe('  warnings: none');
    expect([groupDigits(0), groupDigits(999), groupDigits(1264), groupDigits(1234567)]).toEqual([
      '0',
      '999',
      '1,264',
      '1,234,567',
    ]);
  });
});

describe('the CLI', () => {
  it('compiles the spawn_specs fixture byte-identically twice, round-trips it and prints the par report', () => {
    const outA = tempDir();
    const outB = tempDir();
    const args = ['--src', `${FIXTURES}/spawn_specs`, '--manifest', MANIFEST];
    const a = runCli([...args, '--out', outA]);
    expect(a.status, a.stderr).toBe(0);
    expect(a.stdout).toContain('  peak NPC 22/80   peak vehicles 6/30\n');
    const b = runCli([...args, '--out', outB]);
    expect(b.status, b.stderr).toBe(0);
    const file = (root: string): string => join(root, 'public/assets/levels/spawn_specs.json');
    const hash = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex');
    expect(hash(file(outA))).toBe(hash(file(outB)));
    const text = readFileSync(file(outA), 'utf8');
    const decoded = decodeLevel(text);
    expect(encodeLevel(decoded)).toBe(text);
    expect(Object.keys(JSON.parse(text).spawns)).toEqual([
      'hazards',
      'knockables',
      'npc',
      'pickups',
      'traffic',
    ]);
  });

  it('reports both errors of a level with two (a guard L005 and an L080 found on the map)', () => {
    const r = runCli(['--src', `${FIXTURES}/two_errors`, '--manifest', MANIFEST, '--out', tempDir()]);
    expect(r.status).toBe(1);
    expect(r.stderr.trimEnd().split('\n')).toEqual([
      'two_errors.level.json:39:24 L005 npcs.flocks[0].id npc.pigeon is not allowed in district.puddle_lane (entities.json districts)',
      'two_errors.level.json:46:23 L080 traffic.busRoute names anchor 5 (bus_stand), which is not on the map',
    ]);
  });

  it('prints L081 as a warning and still compiles the l081_late fixture', () => {
    const out = tempDir();
    const r = runCli(['--src', `${FIXTURES}/l081_late`, '--manifest', MANIFEST, '--out', out]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).toBe('');
    expect(r.stdout).toContain(
      'l081_late.level.json:35:3 L081 last scheduled event (market_close) is at 210 s elapsed; districts schedule their last event at or before 200 s',
    );
    expect(r.stdout).toContain('  warnings: L081');
    expect(r.stdout).toContain('1 compiled, 0 failed');
  });
});
