// The M3 spawn specs of a level (SSP-077; LEVEL_DESIGN §4.3, §8.4, §9.3–§9.6, §10.3–§10.4, TECHNICAL_DESIGN
// §15.2): the guards for level.json → npcs, traffic, hazards, knockables and events, the entity membership and
// milestone checks over every spawn list (L005, L007), and the compile step that resolves anchors to graph
// nodes, bakes the hazard candidate tiles, estimates the NPC and vehicle peaks and the dynamic litter, and runs
// L050, L073, L080 and L081. Pure: no fs. Runs once per compile, so it may allocate.
//
// The compiler (compile-level.ts) calls the guards with the parsed level.json, before the map is read, and
// compileSpawnSpecs once the map, lane graph and nav graph exist. Both report SpecProblems, which the compiler
// turns into file:row:col diagnostics; neither stops at the first problem, so a level with two errors reports
// both (an invalid spec is dropped and the rest of the level still compiles far enough to be checked).
//
// Rules (as built, SSP-077; LEVEL_DESIGN §8.4, §9 and §10.3 mirror them):
// - **Entity references** (L005, L007): every id a spawn list names must be a canonical entity of the expected
//   class in entities.json (L005), allowed in the district by its `districts` (L005), and delivered no later
//   than the district's milestone (Mon–Tue M3, Wed–Sun and the Depot Yard M6; L007). A district id outside
//   entities.json (the test fixtures) skips the membership and milestone checks.
// - **Anchors** (L080): an anchor reference is a digit of level.json → anchors or one of its names. It must be
//   defined there and placed on the map. People's anchors resolve to the nav graph node of the anchor (its
//   first node, in nav.anchors order); vehicles' to the lane node nearest the anchor's first tile, which must
//   be within LANE_ANCHOR_MAX_M. A nav route must stay in one connected part of the nav graph, leg by leg (and
//   back to the start for a loop); a lane route must be drivable along the directed lane graph, leg by leg,
//   without leaving the map.
// - **Hazards** (L073): the candidate tiles of each random rule (HAZARD_RULE in src/sim/map.ts) and every
//   placed hazard keep off the §9.3 exclusions: within HAZARD_START_CLEAR_TILES (Chebyshev) of `@`, a zebra or
//   school crossing, a depot bay or skip, a hydrant's tile and the 8 round it, and (beyond §9.3, because the
//   hazard would be hidden or meaningless there) a parking bay, a prop tile, a speed bump and any tile Bessie
//   cannot drive on. A random request needs at least `count` candidate tiles.
// - **Peaks** (L050; the method is LEVEL_DESIGN §10.4): see estimatePeaks.
// - **L081** (warning): the last `at` of any event later than LATE_EVENT_S elapsed.
import { TILE_M } from '../../src/sim/constants.ts';
import {
  COLLIDE,
  EVENT_ANCHOR_PARAMS,
  EVENT_TYPES,
  type EventType,
  Ground,
  HAZARD_RULE,
  HAZARD_RULES,
  type HazardRule,
  type HazardSpawn,
  hazardRuleBit,
  type JsonValue,
  type KnockableSpawn,
  type Level,
  type LevelProp,
  type NpcSpawn,
  PERCH_SURFACES,
  type PerchSurface,
  type PointM,
  type PopulationWindow,
  type ScheduledEvent,
  type TrafficSpawn,
  type WeightEntry,
} from '../../src/sim/map.ts';
import {
  DEFAULT_ENTITIES,
  DISTRICT_IDS,
  type DistrictId,
  type Entities,
  MILESTONES,
  type Milestone,
} from '../../src/sim/tuning.ts';
import type { ResolvedMap } from './compile-level.ts';
import type { Mode } from './schema.ts';
import { isRoadCell } from './tileLayers.ts';

// ---------------------------------------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------------------------------------

/** L050: most NPCs alive at once, flock birds included (LEVEL_DESIGN §9.4, TECHNICAL_DESIGN §17). */
export const NPC_BUDGET = 80;
/** L050: most vehicles at once, moving + parked (LEVEL_DESIGN §9.5). */
export const VEHICLE_BUDGET = 30;
/** L081: districts schedule their last event at or before this many seconds elapsed (LEVEL_DESIGN §4.1). */
export const LATE_EVENT_S = 200;
/** §9.3: no hazard within this many tiles (Chebyshev) of `@`. */
export const HAZARD_START_CLEAR_TILES = 3;
/** §9.3 near_parking: within this many tiles (Chebyshev) of a parking bay or a unit's yard. */
export const NEAR_PARKING_TILES = 2;
/** L080: a vehicle anchor must lie within this distance of a lane node (3 tiles). */
export const LANE_ANCHOR_MAX_M = 6;

/** The milestone that delivers each district (LEVEL_DESIGN §10.3 L007): Mon–Tue M3, the rest M6. */
export const DISTRICT_MILESTONE: { readonly [d in DistrictId]: Milestone } = {
  'district.puddle_lane': 'M3',
  'district.high_street': 'M3',
  'district.gasworks': 'M6',
  'district.conker_hill': 'M6',
  'district.promenade': 'M6',
  'district.kebab_mile': 'M6',
  'district.civic_quarter': 'M6',
  'district.depot_yard': 'M6',
};

/** The vehicle behaviour that drives on pavements, following the nav graph (SSP-091). */
const PAVEMENT_BEHAVIOUR = 'mobility_scooter';
/** The vehicle behaviour of parked cars. */
const PARKED_BEHAVIOUR = 'parked';
/** NPC behaviours that move as flocks (LEVEL_DESIGN §9.4). */
const FLOCK_BEHAVIOURS: readonly string[] = ['pigeon', 'seagull'];
/** The NPC behaviour whose every walker brings a dog (an NPC of its own; LEVEL_DESIGN §10.4). */
const DOG_WALKER_BEHAVIOUR = 'dog_walker';

// ---------------------------------------------------------------------------------------------------------
// The entity table (injectable, so tests can check L007 with an entity the real data does not have)
// ---------------------------------------------------------------------------------------------------------

/** What the spawn checks read of one entities.json entity. */
export type EntityInfo = {
  /** entities.json `class`: litter, stain, npc, veh, prop, haz, site, pwr or collect. */
  readonly class: string;
  readonly districts: readonly string[];
  readonly milestone: string;
  /** NPC and vehicle behaviour module key. */
  readonly behaviour?: string;
  /** Props: `knockable` or `solid`. */
  readonly collision?: string;
  /** Collectibles: `lostProperty` or `goldenCrisp`. */
  readonly kind?: string;
  /** Behaviour numbers (NPCs): the dynamic litter estimate reads the drop intervals. */
  readonly rules?: { readonly [key: string]: number };
  /** Knockables: litter items spilled on the first knock. */
  readonly spills?: number;
};

/** Every entity the checks may reference, by id. */
export type EntityTable = { readonly [id: string]: EntityInfo };

/** Flatten a validated Entities object into an EntityTable. */
export function entityTableOf(entities: Entities): EntityTable {
  const table: { [id: string]: EntityInfo } = {};
  const add = (id: string, info: EntityInfo): void => {
    table[id] = info;
  };
  const base = (e: { districts: readonly string[]; milestone: string }) => ({
    districts: e.districts,
    milestone: e.milestone,
  });
  for (const e of Object.values(entities.litter)) add(e.id, { class: 'litter', ...base(e) });
  for (const e of Object.values(entities.stains)) add(e.id, { class: 'stain', ...base(e) });
  for (const e of Object.values(entities.npcs))
    add(e.id, { class: 'npc', ...base(e), behaviour: e.behaviour, rules: e.rules });
  for (const e of Object.values(entities.vehicles))
    add(e.id, { class: 'veh', ...base(e), behaviour: e.behaviour });
  for (const e of Object.values(entities.knockables))
    add(e.id, { class: 'prop', ...base(e), collision: 'knockable', spills: e.knock.spills });
  for (const e of Object.values(entities.staticProps))
    add(e.id, { class: 'prop', ...base(e), collision: 'solid' });
  for (const e of Object.values(entities.hazards)) add(e.id, { class: 'haz', ...base(e) });
  for (const e of Object.values(entities.sites)) add(e.id, { class: 'site', ...base(e) });
  for (const e of Object.values(entities.powerups)) add(e.id, { class: 'pwr', ...base(e) });
  for (const e of Object.values(entities.collectibles))
    add(e.id, { class: 'collect', ...base(e), kind: e.kind });
  return table;
}

/** The table of src/data/entities.json. */
export const DEFAULT_ENTITY_TABLE: EntityTable = entityTableOf(DEFAULT_ENTITIES);

/** The district's delivery milestone, or undefined for a district outside entities.json. */
export function districtMilestone(districtId: unknown): Milestone | undefined {
  const known = DISTRICT_IDS.find((d) => d === districtId);
  return known === undefined ? undefined : DISTRICT_MILESTONE[known];
}

/**
 * Why `id` may not appear in a spawn list of `districtId` (`where` names the list in the message), or null:
 * L005 when it is not a canonical entity of class `cls` or its districts exclude the district, L007 when its
 * milestone is later than the district's. A district outside entities.json checks only the id and class.
 */
export function entityProblem(
  table: EntityTable,
  id: string,
  cls: string,
  districtId: unknown,
  where: string,
): { code: 'L005' | 'L007'; message: string } | null {
  const info = Object.hasOwn(table, id) ? table[id] : undefined;
  if (info === undefined || info.class !== cls)
    return {
      code: 'L005',
      message: `${where} ${JSON.stringify(id)} is not a canonical ${cls}.* id in src/data/entities.json`,
    };
  const deliver = districtMilestone(districtId);
  if (deliver === undefined) return null;
  const district = String(districtId);
  if (!info.districts.includes(district))
    return {
      code: 'L005',
      message: `${where} ${id} is not allowed in ${district} (entities.json districts)`,
    };
  const order: readonly string[] = MILESTONES;
  const rank = (m: string): number => order.indexOf(m);
  if (rank(info.milestone) > rank(deliver))
    return {
      code: 'L007',
      message: `${where} ${id} has entities.json milestone ${info.milestone}, later than ${deliver}, the milestone that delivers ${district}`,
    };
  return null;
}

// ---------------------------------------------------------------------------------------------------------
// Problems and the guard context
// ---------------------------------------------------------------------------------------------------------

export type SpawnCode = 'L000' | 'L005' | 'L007' | 'L050' | 'L073' | 'L080' | 'L081';

/**
 * A spawn-spec finding. It is located at the level.json key `path`, or, with `value`, at that JSON string's
 * occurrence after the key (an id or anchor inside a list). `warning` findings print but never fail a level.
 */
export type SpecProblem = {
  path: readonly string[];
  value?: string;
  code: SpawnCode;
  message: string;
  warning?: boolean;
};

/** What the guards know before the map is read. */
export type SpecContext = {
  districtId: unknown;
  mode: Mode;
  /** The level's timer in seconds (240 for a shift). */
  timerS: number;
  /** [w, h] in tiles, or null when level.json → size is unusable. */
  size: readonly [number, number] | null;
  /** level.json → anchors (digit → name), after its guard. */
  anchors: { readonly [digit: string]: string };
  entities: EntityTable;
};

type JsonObject = { [key: string]: unknown };
const isObject = (v: unknown): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const byId = <T extends { id: string }>(a: T, b: T): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Collects problems for one guard run. */
class Problems {
  readonly list: SpecProblem[] = [];
  bad = false;
  add(path: readonly string[], code: SpawnCode, message: string, value?: string): void {
    this.list.push(value === undefined ? { path, code, message } : { path, value, code, message });
    if (code !== 'L081') this.bad = true;
  }
  warn(path: readonly string[], code: SpawnCode, message: string): void {
    this.list.push({ path, code, message, warning: true });
  }
}

/** Report every unknown key of `o`; returns whether there were none. */
function onlyKeys(
  p: Problems,
  o: JsonObject,
  allowed: readonly string[],
  path: readonly string[],
  where: string,
): boolean {
  let ok = true;
  for (const key of Object.keys(o)) {
    if (!allowed.includes(key)) {
      p.add([...path, key], 'L000', `${where}.${key} is not a field (${allowed.join(', ')})`);
      ok = false;
    }
  }
  return ok;
}

/** Check one entity id; returns whether it may be used. */
function entityOk(
  p: Problems,
  ctx: SpecContext,
  id: string,
  cls: string,
  where: string,
  path: readonly string[],
): boolean {
  const problem = entityProblem(ctx.entities, id, cls, ctx.districtId, where);
  if (problem === null) return true;
  p.add(path, problem.code, problem.message, id);
  return false;
}

/** `[x, y]` tile coordinates (finite numbers); with `size`, inside the map. */
function isXY(v: unknown, size: readonly [number, number] | null): v is [number, number] {
  if (!Array.isArray(v) || v.length !== 2 || !v.every(isNum)) return false;
  const [x = 0, y = 0] = v;
  return size === null || (x >= 0 && y >= 0 && x < size[0] && y < size[1]);
}

/**
 * A `Weights` table of entity ids → positive weights (sorted by id), every id checked as class `cls`; null
 * when the value is not an object. `filter` adds a class-specific rule (returns a message or null).
 */
function weightTable(
  p: Problems,
  ctx: SpecContext,
  value: unknown,
  cls: string,
  where: string,
  path: readonly string[],
  filter: (id: string) => string | null = () => null,
): WeightEntry[] | null {
  if (!isObject(value)) {
    p.add(path, 'L000', `${where} must be an object of ${cls}.* id → weight`);
    return null;
  }
  const out: WeightEntry[] = [];
  for (const id of Object.keys(value)) {
    const weight = value[id];
    if (!isNum(weight) || weight <= 0) {
      p.add([...path, id], 'L000', `${where} ${id} weight must be a positive number`);
      continue;
    }
    if (!entityOk(p, ctx, id, cls, where, path)) continue;
    const why = filter(id);
    if (why !== null) {
      p.add([...path, id], 'L000', `${where} ${id} ${why}`);
      continue;
    }
    out.push({ id, weight });
  }
  return out.sort(byId);
}

// ---------------------------------------------------------------------------------------------------------
// Anchor references
// ---------------------------------------------------------------------------------------------------------

/** An anchor reference after the guard: as written, and the anchor digit it names. */
export type AnchorRef = { ref: string; char: string };

/** Resolve an anchor reference (a digit of level.json → anchors or one of its names), or report L080. */
function anchorRef(
  p: Problems,
  ctx: SpecContext,
  value: unknown,
  where: string,
  path: readonly string[],
): AnchorRef | null {
  if (typeof value !== 'string' || value.length === 0) {
    p.add(path, 'L000', `${where} must be an anchor (a digit or a name from anchors)`);
    return null;
  }
  if (Object.hasOwn(ctx.anchors, value)) return { ref: value, char: value };
  const digit = Object.keys(ctx.anchors)
    .sort()
    .find((d) => ctx.anchors[d] === value);
  if (digit !== undefined) return { ref: value, char: digit };
  p.add(
    path,
    'L080',
    `${where} names anchor ${JSON.stringify(value)}, which level.json anchors does not define`,
    value,
  );
  return null;
}

/** A non-empty list of anchor references; null when any is unusable (each is reported). */
function anchorList(
  p: Problems,
  ctx: SpecContext,
  value: unknown,
  where: string,
  path: readonly string[],
  minLength: number,
): AnchorRef[] | null {
  if (!Array.isArray(value) || value.length < minLength) {
    p.add(path, 'L000', `${where} must be an array of at least ${minLength} anchor(s)`);
    return null;
  }
  const refs = value.map((v: unknown) => anchorRef(p, ctx, v, where, path));
  return refs.every((r): r is AnchorRef => r !== null) ? refs : null;
}

// ---------------------------------------------------------------------------------------------------------
// Guards (schema.ts NpcSpec, TrafficSpec, hazards, knockables, EventSpec)
// ---------------------------------------------------------------------------------------------------------

export type CheckedNamed = {
  id: string;
  count: number;
  spawnAtS: number;
  anchor: AnchorRef;
  route: AnchorRef[];
  loop: boolean;
};

export type CheckedNpcs = {
  population: PopulationWindow[];
  mix: WeightEntry[];
  caps: { id: string; cap: number }[];
  named: CheckedNamed[];
  perches: { id: string; count: number; on: PerchSurface[] } | null;
  flocks: { id: string; count: number; size: [number, number]; near: string }[];
};

/** Guard level.json → npcs (schema.ts NpcSpec); null when absent or invalid. */
export function checkNpcs(
  value: unknown,
  ctx: SpecContext,
  problems: SpecProblem[],
  nearOk: (near: unknown) => boolean,
): CheckedNpcs | null {
  if (value === undefined) return null;
  const p = new Problems();
  const done = <T>(out: T): T | null => {
    problems.push(...p.list);
    return p.bad ? null : out;
  };
  if (!isObject(value)) {
    p.add(['npcs'], 'L000', 'npcs must be an object');
    return done(null);
  }
  onlyKeys(p, value, ['population', 'mix', 'caps', 'named', 'perches', 'flocks'], ['npcs'], 'npcs');
  const at = (field: string): string[] => (value[field] === undefined ? ['npcs'] : ['npcs', field]);

  const population: PopulationWindow[] = [];
  if (!Array.isArray(value.population))
    p.add(at('population'), 'L000', 'npcs.population must be an array of { from, to, target }');
  else {
    let lastTo = 0;
    value.population.forEach((w: unknown, i) => {
      const where = `npcs.population[${i}]`;
      if (!isObject(w)) {
        p.add(['npcs', 'population'], 'L000', `${where} must be an object`);
        return;
      }
      if (!onlyKeys(p, w, ['from', 'to', 'target'], ['npcs', 'population'], where)) return;
      const { from, to, target } = w;
      if (!isNum(from) || !isNum(to) || from < 0 || to <= from || to > ctx.timerS) {
        p.add(
          ['npcs', 'population'],
          'L000',
          `${where} needs 0 ≤ from < to ≤ ${ctx.timerS} (elapsed seconds)`,
        );
        return;
      }
      if (from < lastTo) {
        p.add(
          ['npcs', 'population'],
          'L000',
          `${where} overlaps the window before it (windows ascend without overlapping)`,
        );
        return;
      }
      if (!isInt(target) || target < 0) {
        p.add(['npcs', 'population'], 'L000', `${where}.target must be a non-negative integer`);
        return;
      }
      lastTo = to;
      population.push({ fromS: from, toS: to, target });
    });
  }
  const mix = weightTable(p, ctx, value.mix, 'npc', 'npcs.mix', at('mix')) ?? [];
  if (population.some((w) => w.target > 0) && mix.length === 0 && !p.bad)
    p.add(at('mix'), 'L000', 'npcs.mix must name at least one npc.* id when a population target is above 0');

  const caps: { id: string; cap: number }[] = [];
  if (value.caps !== undefined) {
    if (!isObject(value.caps))
      p.add(['npcs', 'caps'], 'L000', 'npcs.caps must be an object of npc.* id → cap');
    else {
      for (const id of Object.keys(value.caps)) {
        const cap = value.caps[id];
        if (!isInt(cap) || cap < 0)
          p.add(['npcs', 'caps', id], 'L000', `npcs.caps ${id} must be a non-negative integer`);
        else if (!entityOk(p, ctx, id, 'npc', 'npcs.caps', ['npcs', 'caps'])) continue;
        else if (isObject(value.mix) && !Object.hasOwn(value.mix, id))
          p.add(
            ['npcs', 'caps', id],
            'L000',
            `npcs.caps ${id} is not in npcs.mix (caps limit the ambient mix)`,
          );
        else caps.push({ id, cap });
      }
      caps.sort(byId);
    }
  }

  const named: CheckedNamed[] = [];
  if (value.named !== undefined) {
    if (!Array.isArray(value.named)) p.add(['npcs', 'named'], 'L000', 'npcs.named must be an array');
    else
      value.named.forEach((n: unknown, i) => {
        const where = `npcs.named[${i}]`;
        const path = ['npcs', 'named'];
        if (!isObject(n)) {
          p.add(path, 'L000', `${where} must be an object`);
          return;
        }
        if (!onlyKeys(p, n, ['id', 'anchor', 'spawnAt', 'route', 'loop', 'count'], path, where)) return;
        const { id, spawnAt, loop, count } = n;
        if (typeof id !== 'string') {
          p.add(path, 'L000', `${where}.id must be an npc.* id`);
          return;
        }
        const idOk = entityOk(p, ctx, id, 'npc', `${where}.id`, path);
        if (!isNum(spawnAt) || spawnAt < 0 || spawnAt >= ctx.timerS) {
          p.add(path, 'L000', `${where}.spawnAt must be elapsed seconds 0 ≤ spawnAt < ${ctx.timerS}`);
          return;
        }
        if (loop !== undefined && typeof loop !== 'boolean') {
          p.add(path, 'L000', `${where}.loop must be a boolean`);
          return;
        }
        if (count !== undefined && (!isInt(count) || count < 1)) {
          p.add(path, 'L000', `${where}.count must be a positive integer`);
          return;
        }
        const anchor = anchorRef(p, ctx, n.anchor, `${where}.anchor`, path);
        const route = anchorList(p, ctx, n.route, `${where}.route`, path, 1);
        if (!idOk || anchor === null || route === null) return;
        named.push({ id, count: count ?? 1, spawnAtS: spawnAt, anchor, route, loop: loop === true });
      });
  }

  let perches: CheckedNpcs['perches'] = null;
  if (value.perches !== undefined) {
    const v = value.perches;
    const path = ['npcs', 'perches'];
    if (!isObject(v)) p.add(path, 'L000', 'npcs.perches must be an object');
    else if (onlyKeys(p, v, ['id', 'count', 'on'], path, 'npcs.perches')) {
      const on = Array.isArray(v.on) ? PERCH_SURFACES.filter((s) => (v.on as unknown[]).includes(s)) : [];
      if (v.id !== 'npc.cat') p.add(path, 'L000', 'npcs.perches.id must be npc.cat (only cats perch)');
      else if (!isInt(v.count) || v.count < 1)
        p.add(path, 'L000', 'npcs.perches.count must be a positive integer');
      else if (!Array.isArray(v.on) || v.on.length === 0 || on.length !== v.on.length)
        p.add(path, 'L000', `npcs.perches.on must list distinct surfaces from ${PERCH_SURFACES.join(', ')}`);
      else if (entityOk(p, ctx, v.id, 'npc', 'npcs.perches.id', path))
        perches = { id: v.id, count: v.count, on };
    }
  }

  const flocks: CheckedNpcs['flocks'] = [];
  if (value.flocks !== undefined) {
    if (!Array.isArray(value.flocks)) p.add(['npcs', 'flocks'], 'L000', 'npcs.flocks must be an array');
    else
      value.flocks.forEach((f: unknown, i) => {
        const where = `npcs.flocks[${i}]`;
        const path = ['npcs', 'flocks'];
        if (!isObject(f)) {
          p.add(path, 'L000', `${where} must be an object`);
          return;
        }
        if (!onlyKeys(p, f, ['id', 'count', 'size', 'near'], path, where)) return;
        const { id, count, size, near } = f;
        if (typeof id !== 'string') {
          p.add(path, 'L000', `${where}.id must be an npc.* id`);
          return;
        }
        if (!entityOk(p, ctx, id, 'npc', `${where}.id`, path)) return;
        if (!FLOCK_BEHAVIOURS.includes(ctx.entities[id]?.behaviour ?? '')) {
          p.add(path, 'L000', `${where}.id ${id} is not a flocking bird (pigeon or seagull)`, id);
          return;
        }
        if (!isInt(count) || count < 1) {
          p.add(path, 'L000', `${where}.count must be a positive integer`);
          return;
        }
        const sizeOk = Array.isArray(size) && size.length === 2 && size.every(isInt);
        const [min = 0, max = 0] = sizeOk ? size : [];
        if (!sizeOk || min < 1 || max < min) {
          p.add(path, 'L000', `${where}.size must be [min, max] birds with 1 ≤ min ≤ max`);
          return;
        }
        if (!nearOk(near) || typeof near !== 'string') {
          p.add(
            path,
            'L000',
            `${where}.near ${JSON.stringify(near ?? null)} must be prop.<id>, site.<id>, use:<building use> or an anchor name from anchors`,
          );
          return;
        }
        flocks.push({ id, count, size: [min, max], near });
      });
  }
  return done({ population, mix, caps, named, perches, flocks });
}

export type CheckedTraffic = {
  densityPerKm: number;
  mix: WeightEntry[];
  parkedFill: number;
  parkedMix: WeightEntry[];
  pavement: { id: string; count: number }[];
  /** Tile coordinates. */
  taxiRank: [number, number][];
  busRoute: AnchorRef[];
  busEveryS: number | null;
};

/** Guard level.json → traffic (schema.ts TrafficSpec or `{ none: true }`); null when absent, none or invalid. */
export function checkTraffic(
  value: unknown,
  ctx: SpecContext,
  problems: SpecProblem[],
): CheckedTraffic | null {
  if (value === undefined) return null;
  const p = new Problems();
  const done = <T>(out: T): T | null => {
    problems.push(...p.list);
    return p.bad ? null : out;
  };
  if (!isObject(value)) {
    p.add(['traffic'], 'L000', 'traffic must be an object (a TrafficSpec, or { "none": true })');
    return done(null);
  }
  if (Object.hasOwn(value, 'none')) {
    if (value.none !== true || Object.keys(value).length !== 1)
      p.add(['traffic', 'none'], 'L000', 'traffic.none must be true and stand alone ({ "none": true })');
    return done(null);
  }
  onlyKeys(
    p,
    value,
    ['densityPerKm', 'mix', 'parkedFill', 'parkedMix', 'pavement', 'taxiRank', 'busRoute', 'busEveryS'],
    ['traffic'],
    'traffic',
  );
  const at = (field: string): string[] => (value[field] === undefined ? ['traffic'] : ['traffic', field]);
  const behaviour = (id: string): string => ctx.entities[id]?.behaviour ?? '';
  const { densityPerKm, parkedFill, busEveryS } = value;
  if (!isNum(densityPerKm) || densityPerKm < 0)
    p.add(
      at('densityPerKm'),
      'L000',
      'traffic.densityPerKm must be a non-negative number (vehicles per lane-km)',
    );
  const mix =
    weightTable(p, ctx, value.mix, 'veh', 'traffic.mix', at('mix'), (id) =>
      behaviour(id) === PARKED_BEHAVIOUR
        ? 'is a parked car: list it in traffic.parkedMix'
        : behaviour(id) === PAVEMENT_BEHAVIOUR
          ? 'drives on pavements: list it in traffic.pavement with a count'
          : null,
    ) ?? [];
  if (isNum(densityPerKm) && densityPerKm > 0 && mix.length === 0 && !p.bad)
    p.add(at('mix'), 'L000', 'traffic.mix must name at least one vehicle when densityPerKm is above 0');
  if (!isNum(parkedFill) || parkedFill < 0 || parkedFill > 1)
    p.add(
      at('parkedFill'),
      'L000',
      'traffic.parkedFill must be a number 0..1 (share of parking bays filled)',
    );
  const parkedMix =
    weightTable(p, ctx, value.parkedMix, 'veh', 'traffic.parkedMix', at('parkedMix'), (id) =>
      behaviour(id) === PARKED_BEHAVIOUR ? null : 'is not a parked car (veh.*_parked)',
    ) ?? [];
  if (isNum(parkedFill) && parkedFill > 0 && parkedMix.length === 0 && !p.bad)
    p.add(
      at('parkedMix'),
      'L000',
      'traffic.parkedMix must name at least one parked car when parkedFill is above 0',
    );
  const pavement: { id: string; count: number }[] = [];
  if (value.pavement !== undefined) {
    const v = value.pavement;
    if (!isObject(v))
      p.add(['traffic', 'pavement'], 'L000', 'traffic.pavement must be an object of veh.* id → count');
    else {
      for (const id of Object.keys(v)) {
        const count = v[id];
        if (!isInt(count) || count < 1)
          p.add(
            ['traffic', 'pavement', id],
            'L000',
            `traffic.pavement ${id} must be a positive integer count`,
          );
        else if (!entityOk(p, ctx, id, 'veh', 'traffic.pavement', ['traffic', 'pavement'])) continue;
        else if (behaviour(id) !== PAVEMENT_BEHAVIOUR)
          p.add(['traffic', 'pavement', id], 'L000', `traffic.pavement ${id} does not drive on pavements`);
        else pavement.push({ id, count });
      }
      pavement.sort(byId);
    }
  }
  const taxiRank: [number, number][] = [];
  if (value.taxiRank !== undefined) {
    if (!Array.isArray(value.taxiRank) || !value.taxiRank.every((t) => isXY(t, ctx.size)))
      p.add(
        ['traffic', 'taxiRank'],
        'L000',
        'traffic.taxiRank must be an array of [x, y] tile positions inside the map',
      );
    else for (const t of value.taxiRank as [number, number][]) taxiRank.push([t[0], t[1]]);
  }
  let busRoute: AnchorRef[] = [];
  if (value.busRoute !== undefined)
    busRoute = anchorList(p, ctx, value.busRoute, 'traffic.busRoute', ['traffic', 'busRoute'], 2) ?? [];
  if ((value.busRoute === undefined) !== (busEveryS === undefined))
    p.add(
      at(busEveryS === undefined ? 'busRoute' : 'busEveryS'),
      'L000',
      'traffic.busRoute and traffic.busEveryS go together',
    );
  else if (busEveryS !== undefined && (!isNum(busEveryS) || busEveryS <= 0))
    p.add(['traffic', 'busEveryS'], 'L000', 'traffic.busEveryS must be a positive number of seconds');
  if (!isNum(densityPerKm) || !isNum(parkedFill)) return done(null);
  return done({
    densityPerKm,
    mix,
    parkedFill,
    parkedMix,
    pavement,
    taxiRank,
    busRoute,
    busEveryS: isNum(busEveryS) ? busEveryS : null,
  });
}

export type CheckedHazards = {
  /** `at` in tiles. */
  place: { id: string; at: [number, number] }[];
  random: { id: string; count: number; rule: HazardRule }[];
};

/** Guard level.json → hazards; null when absent or invalid. */
export function checkHazards(
  value: unknown,
  ctx: SpecContext,
  problems: SpecProblem[],
): CheckedHazards | null {
  if (value === undefined) return null;
  const p = new Problems();
  const done = <T>(out: T): T | null => {
    problems.push(...p.list);
    return p.bad ? null : out;
  };
  if (!isObject(value)) {
    p.add(['hazards'], 'L000', 'hazards must be an object of { place?, random? }');
    return done(null);
  }
  onlyKeys(p, value, ['place', 'random'], ['hazards'], 'hazards');
  const out: CheckedHazards = { place: [], random: [] };
  if (value.place !== undefined) {
    if (!Array.isArray(value.place)) p.add(['hazards', 'place'], 'L000', 'hazards.place must be an array');
    else
      value.place.forEach((h: unknown, i) => {
        const where = `hazards.place[${i}]`;
        const path = ['hazards', 'place'];
        if (!isObject(h)) {
          p.add(path, 'L000', `${where} must be an object`);
          return;
        }
        if (!onlyKeys(p, h, ['id', 'at'], path, where)) return;
        if (typeof h.id !== 'string') {
          p.add(path, 'L000', `${where}.id must be a haz.* id`);
          return;
        }
        if (!entityOk(p, ctx, h.id, 'haz', `${where}.id`, path)) return;
        if (!isXY(h.at, ctx.size)) {
          p.add(path, 'L000', `${where}.at must be [x, y] tile coordinates inside the map`);
          return;
        }
        out.place.push({ id: h.id, at: [h.at[0], h.at[1]] });
      });
  }
  if (value.random !== undefined) {
    if (!Array.isArray(value.random)) p.add(['hazards', 'random'], 'L000', 'hazards.random must be an array');
    else
      value.random.forEach((h: unknown, i) => {
        const where = `hazards.random[${i}]`;
        const path = ['hazards', 'random'];
        if (!isObject(h)) {
          p.add(path, 'L000', `${where} must be an object`);
          return;
        }
        if (!onlyKeys(p, h, ['id', 'count', 'rule'], path, where)) return;
        if (typeof h.id !== 'string') {
          p.add(path, 'L000', `${where}.id must be a haz.* id`);
          return;
        }
        if (!entityOk(p, ctx, h.id, 'haz', `${where}.id`, path)) return;
        if (!isInt(h.count) || h.count < 1) {
          p.add(path, 'L000', `${where}.count must be a positive integer`);
          return;
        }
        const rule = HAZARD_RULES.find((r) => r === h.rule);
        if (rule === undefined) {
          p.add(
            path,
            'L000',
            `${where}.rule ${JSON.stringify(h.rule ?? null)} must be one of ${HAZARD_RULES.join(', ')}`,
          );
          return;
        }
        out.random.push({ id: h.id, count: h.count, rule });
      });
  }
  return done(out);
}

/** Guard level.json → knockables; null when absent or invalid. Positions are tiles. */
export function checkKnockables(
  value: unknown,
  ctx: SpecContext,
  problems: SpecProblem[],
): { id: string; at: [number, number] }[] | null {
  if (value === undefined) return null;
  const p = new Problems();
  const out: { id: string; at: [number, number] }[] = [];
  if (!Array.isArray(value)) p.add(['knockables'], 'L000', 'knockables must be an array of { id, at }');
  else
    value.forEach((k: unknown, i) => {
      const where = `knockables[${i}]`;
      const path = ['knockables'];
      if (!isObject(k)) {
        p.add(path, 'L000', `${where} must be an object`);
        return;
      }
      if (!onlyKeys(p, k, ['id', 'at'], path, where)) return;
      if (typeof k.id !== 'string') {
        p.add(path, 'L000', `${where}.id must be a prop.* id`);
        return;
      }
      if (!entityOk(p, ctx, k.id, 'prop', `${where}.id`, path)) return;
      if (ctx.entities[k.id]?.collision !== 'knockable') {
        p.add(
          path,
          'L000',
          `${where}.id ${k.id} is a static prop, not a knockable (place it on the map)`,
          k.id,
        );
        return;
      }
      if (!isXY(k.at, ctx.size)) {
        p.add(path, 'L000', `${where}.at must be [x, y] tile coordinates inside the map`);
        return;
      }
      out.push({ id: k.id, at: [k.at[0], k.at[1]] });
    });
  problems.push(...p.list);
  return p.bad ? null : out;
}

/** One anchor-valued event param after the guard (EVENT_ANCHOR_PARAMS). */
export type AnchorParam = { param: string; graph: 'lane' | 'nav'; refs: AnchorRef[]; list: boolean };

export type CheckedEvent = {
  type: EventType;
  /** Ascending elapsed seconds; [] when the event has no `at`. */
  atS: number[];
  untilS: number | null;
  trigger: string | null;
  /** Every other field, as authored. */
  params: { [key: string]: JsonValue };
  anchorParams: AnchorParam[];
  /** Index in level.json → events. */
  index: number;
};

/** Event params that name one entity, and the class they must be. */
const EVENT_ENTITY_PARAMS: { readonly [param: string]: string } = { npc: 'npc', vehicle: 'veh' };
/** Event params that are `Weights` tables of entity ids (the class comes from each id's prefix). */
const EVENT_TABLE_PARAMS: readonly string[] = ['table', 'mix'];

function jsonValue(v: unknown): JsonValue {
  if (v === null || typeof v === 'boolean' || typeof v === 'string' || typeof v === 'number') return v;
  if (Array.isArray(v)) return v.map(jsonValue);
  const out: { [key: string]: JsonValue } = {};
  if (isObject(v)) for (const key of Object.keys(v)) out[key] = jsonValue(v[key]);
  return out;
}

/**
 * Guard level.json → events (schema.ts EventSpec): the envelope (a catalogue `type`, `at` as elapsed seconds
 * within the shift, `untilS` after it, `trigger` a string), the entity ids and anchors in the params (L005,
 * L007, L080), the params the M3 tooling reads (tutorial_beat `trigger` and `text`, population_wave `npc`,
 * `delta`, `at` and `untilS`, market_close `itemsPerPitch`), and L081. The other params of the M6 event types
 * are checked by SSP-190. Invalid events are dropped (the level fails); the rest are returned in order.
 */
export function checkEvents(value: unknown, ctx: SpecContext, problems: SpecProblem[]): CheckedEvent[] {
  if (value === undefined) return [];
  const p = new Problems();
  const out: CheckedEvent[] = [];
  if (!Array.isArray(value)) {
    p.add(['events'], 'L000', 'events must be an array of { type, at?, untilS?, trigger?, ... }');
    problems.push(...p.list);
    return out;
  }
  const last = { s: -1, type: '' };
  value.forEach((e: unknown, index) => {
    const where = `events[${index}]`;
    const path = ['events'];
    if (!isObject(e)) {
      p.add(path, 'L000', `${where} must be an object`);
      return;
    }
    const type = EVENT_TYPES.find((t) => t === e.type);
    if (type === undefined) {
      p.add(
        path,
        'L000',
        `${where}.type ${JSON.stringify(e.type ?? null)} must be one of ${EVENT_TYPES.join(', ')}`,
      );
      return;
    }
    const label = `${where} (${type})`;
    let ok = true;
    const bad = (code: SpawnCode, message: string, value?: string): void => {
      p.add(path, code, `${label} ${message}`, value);
      ok = false;
    };
    const atList = e.at === undefined ? [] : Array.isArray(e.at) ? e.at : [e.at];
    if (e.at !== undefined && (atList.length === 0 || !atList.every(isNum)))
      bad('L000', 'at must be elapsed seconds or a non-empty array of them');
    const atS = atList.filter(isNum);
    if (atS.some((s, i) => s < 0 || s >= ctx.timerS || (i > 0 && s < (atS[i - 1] ?? 0))))
      bad('L000', `at must ascend within the shift (0 ≤ at < ${ctx.timerS})`);
    const { untilS, trigger } = e;
    if (untilS !== undefined && (!isNum(untilS) || untilS <= (atS[0] ?? 0) || untilS > ctx.timerS))
      bad('L000', `untilS must be after at and at most ${ctx.timerS}`);
    if (trigger !== undefined && (typeof trigger !== 'string' || trigger.length === 0))
      bad('L000', 'trigger must be a non-empty string');
    const params: { [key: string]: JsonValue } = {};
    for (const key of Object.keys(e))
      if (!['type', 'at', 'untilS', 'trigger'].includes(key)) params[key] = jsonValue(e[key]);

    // Entity params (L005, L007).
    for (const [param, cls] of Object.entries(EVENT_ENTITY_PARAMS)) {
      const id = e[param];
      if (id === undefined) continue;
      if (typeof id !== 'string') bad('L000', `${param} must be a ${cls}.* id`);
      else if (!entityOk(p, ctx, id, cls, `${where}.${param}`, path)) ok = false;
    }
    for (const param of EVENT_TABLE_PARAMS) {
      const table = e[param];
      if (table === undefined) continue;
      if (!isObject(table)) {
        bad('L000', `${param} must be an object of id → weight`);
        continue;
      }
      for (const id of Object.keys(table)) {
        const cls = id.slice(0, Math.max(0, id.indexOf('.')));
        if (!isNum(table[id]) || (table[id] as number) <= 0)
          bad('L000', `${param} ${id} weight must be a positive number`);
        else if (!entityOk(p, ctx, id, cls.length > 0 ? cls : '(none)', `${where}.${param}`, path))
          ok = false;
      }
    }
    // Anchor params (L080).
    const anchorParams: AnchorParam[] = [];
    for (const [param, graph] of Object.entries(EVENT_ANCHOR_PARAMS[type] ?? {})) {
      const v = e[param];
      if (v === undefined) continue;
      const list = param !== 'anchor';
      const refs = list
        ? anchorList(p, ctx, v, `${where}.${param}`, path, 1)
        : [anchorRef(p, ctx, v, `${where}.${param}`, path)];
      if (refs === null || refs.some((r) => r === null)) ok = false;
      else anchorParams.push({ param, graph, refs: refs.filter((r): r is AnchorRef => r !== null), list });
    }
    // The params the M3 tooling reads.
    if (type === 'tutorial_beat') {
      if (typeof trigger !== 'string') bad('L000', 'needs a trigger (the sim event that shows it)');
      if (typeof e.text !== 'string' || e.text.length === 0) bad('L000', 'needs a non-empty text');
    }
    if (type === 'population_wave') {
      if (typeof e.npc !== 'string') bad('L000', 'needs npc (the npc.* id whose cap changes)');
      if (!isInt(e.delta) || e.delta === 0) bad('L000', 'needs delta, a non-zero integer');
      if (atS.length !== 1 || !isNum(untilS)) bad('L000', 'needs one at and an untilS');
    }
    if (
      type === 'market_close' &&
      e.itemsPerPitch !== undefined &&
      (!isInt(e.itemsPerPitch) || e.itemsPerPitch < 0)
    )
      bad('L000', 'itemsPerPitch must be a non-negative integer');
    if (!ok) return;
    const lastAt = atS[atS.length - 1];
    if (lastAt !== undefined && lastAt >= last.s) {
      last.s = lastAt;
      last.type = type;
    }
    out.push({
      type,
      atS,
      untilS: isNum(untilS) ? untilS : null,
      trigger: typeof trigger === 'string' ? trigger : null,
      params,
      anchorParams,
      index,
    });
  });
  if (last.s > LATE_EVENT_S)
    p.warn(
      ['events'],
      'L081',
      `last scheduled event (${last.type}) is at ${last.s} s elapsed; districts schedule their last event at or before ${LATE_EVENT_S} s`,
    );
  problems.push(...p.list);
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// Compile (after the map, lane graph and nav graph exist)
// ---------------------------------------------------------------------------------------------------------

/** The guarded specs of one level (null or empty when level.json has none). */
export type CheckedSpecs = {
  npcs: CheckedNpcs | null;
  traffic: CheckedTraffic | null;
  hazards: CheckedHazards | null;
  knockables: { id: string; at: [number, number] }[] | null;
  events: CheckedEvent[];
};

/** What compileSpawnSpecs needs besides the specs. */
export type SpawnWorld = {
  map: ResolvedMap;
  /** The level being compiled: its collide layer, props, lanes and nav graph are read. */
  level: Level;
  /** The `@` tile. */
  start: readonly [number, number];
  /** Each anchor digit's tiles, in row-major order. */
  anchorTiles: { readonly [digit: string]: readonly (readonly [number, number])[] };
  /** Building use per building index (map.building). */
  buildingUse: readonly string[];
  /** The source points (metres) of a `near` reference. */
  resolveNear: (near: string) => readonly (readonly [number, number])[];
};

/** The NPC and vehicle peaks (LEVEL_DESIGN §10.4) with their parts, for L050 and the par report. */
export type Peaks = {
  npc: number;
  npcParts: { ambient: number; named: number; dogs: number; cats: number; flocks: number; traders: number };
  vehicles: number;
  vehicleParts: { moving: number; parked: number; pavement: number };
};

export type SpawnCompileResult = {
  npc: NpcSpawn | null;
  traffic: TrafficSpawn | null;
  hazards: HazardSpawn | null;
  knockables: KnockableSpawn[] | null;
  schedules: ScheduledEvent[];
  peaks: Peaks;
  /** Expected dynamic litter items (LEVEL_DESIGN §10.4), for L050 and the par report. */
  dynamicLitter: number;
  problems: SpecProblem[];
};

const KERB_EDGES = COLLIDE.KERB_EDGE_N | COLLIDE.KERB_EDGE_E | COLLIDE.KERB_EDGE_S | COLLIDE.KERB_EDGE_W;

/** Ceil of a non-negative product, quantised to 1e-6 first so a float product like 5.999999999 rounds to 6. */
function ceilQ(x: number): number {
  return Math.ceil(Math.round(x * 1e6) / 1e6);
}

/** Why a tile may not hold a hazard (LEVEL_DESIGN §9.3), or null when it may. */
function hazardExclusion(world: SpawnWorld, i: number, nearHydrant: Uint8Array): string | null {
  const { map, start } = world;
  const x = i % map.w;
  const y = (i - x) / map.w;
  const def = map.defs[i] ?? null;
  if (map.drivable[i] !== 1) return 'is not on a tile Bessie can drive on';
  if (Math.max(Math.abs(x - start[0]), Math.abs(y - start[1])) <= HAZARD_START_CLEAR_TILES)
    return `is within ${HAZARD_START_CLEAR_TILES} tiles of @`;
  if (def?.site === 'site.zebra' || def?.site === 'site.school_crossing') return `is on a ${def.site}`;
  if (def?.site === 'site.depot_bay' || def?.site === 'site.skip') return `is on a ${def.site}`;
  if (def?.mark === 'parking_bay') return 'is on a parking bay (a parked car stands there)';
  if (nearHydrant[i] === 1) return 'is on or next to a hydrant';
  if (def?.prop !== undefined) return `is on the ${def.prop} tile`;
  if (def?.haz !== undefined) return `is on a ${def.haz} tile`;
  return null;
}

/** HAZARD_RULE candidate bits per tile, the §9.3 exclusions applied (the module header has the rules). */
export function hazardCandidates(world: SpawnWorld): { candidates: Uint8Array; nearHydrant: Uint8Array } {
  const { map, level } = world;
  const { w, h } = map;
  const n = w * h;
  const prop = (i: number): string | undefined => map.defs[i]?.prop;
  const bay = (i: number): boolean => map.defs[i]?.mark === 'parking_bay';
  const nearHydrant = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) {
    if (prop(i) !== 'prop.hydrant') continue;
    const x = i % w;
    const y = (i - x) / w;
    for (let dy = -1; dy <= 1; dy += 1)
      for (let dx = -1; dx <= 1; dx += 1) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < w && ny < h) nearHydrant[ny * w + nx] = 1;
      }
  }
  // Wheel tracks: the tiles under lane nodes.
  const lane = new Uint8Array(n);
  for (let k = 0; k < level.lanes.nodeCount; k += 1) {
    const tx = Math.min(w - 1, Math.floor((level.lanes.nodeX[k] ?? 0) / TILE_M));
    const ty = Math.min(h - 1, Math.floor((level.lanes.nodeY[k] ?? 0) / TILE_M));
    lane[ty * w + tx] = 1;
  }
  // Parking sources: bay cells, and yard cells beside a unit building.
  const parkingSource: number[] = [];
  for (let i = 0; i < n; i += 1) {
    if (bay(i)) {
      parkingSource.push(i);
      continue;
    }
    if (map.ground[i] !== Ground.Yard || map.solid[i] === 1) continue;
    const x = i % w;
    const y = (i - x) / w;
    const besideUnit = [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ].some(([dx = 0, dy = 0]) => {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) return false;
      return world.buildingUse[map.building[ny * w + nx] ?? -1] === 'unit';
    });
    if (besideUnit) parkingSource.push(i);
  }
  const nearParking = new Uint8Array(n);
  for (const s of parkingSource) {
    const x = s % w;
    const y = (s - x) / w;
    for (let dy = -NEAR_PARKING_TILES; dy <= NEAR_PARKING_TILES; dy += 1)
      for (let dx = -NEAR_PARKING_TILES; dx <= NEAR_PARKING_TILES; dx += 1) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < w && ny < h) nearParking[ny * w + nx] = 1;
      }
  }
  const collide = level.layers.collide;
  const candidates = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) {
    if (hazardExclusion(world, i, nearHydrant) !== null) continue;
    const road = isRoadCell(map, i);
    let bits = 0;
    if (road && ((collide[i] ?? 0) & KERB_EDGES) !== 0) bits |= HAZARD_RULE.KERBSIDE_LOW_POINTS;
    if (road && lane[i] === 1) bits |= HAZARD_RULE.CARRIAGEWAY;
    if ((road || map.ground[i] === Ground.Yard) && nearParking[i] === 1) bits |= HAZARD_RULE.NEAR_PARKING;
    candidates[i] = bits;
  }
  return { candidates, nearHydrant };
}

/** Connected component of every nav node (two-way edges), smallest node index as the label. */
function navComponents(level: Level): Int32Array {
  const g = level.nav;
  const comp = new Int32Array(g.nodeCount).fill(-1);
  for (let s = 0; s < g.nodeCount; s += 1) {
    if (comp[s] !== -1) continue;
    comp[s] = s;
    const stack = [s];
    while (stack.length > 0) {
      const v = stack.pop() ?? 0;
      for (let k = g.adjStart[v] ?? 0; k < (g.adjStart[v + 1] ?? 0); k += 1) {
        const u = g.adjNode[k] ?? 0;
        if (comp[u] === -1) {
          comp[u] = s;
          stack.push(u);
        }
      }
    }
  }
  return comp;
}

/**
 * Multi-source reachability along the directed lane edges: for every lane node, the source it is first reached
 * from (breadth-first, sources in the given order; a source reaches itself), or −1.
 */
function laneReach(level: Level, sources: readonly number[]): Int32Array {
  const g = level.lanes;
  const from = new Int32Array(g.nodeCount).fill(-1);
  const queue: number[] = [];
  for (const src of sources) {
    if (from[src] !== -1) continue;
    from[src] = src;
    queue.push(src);
  }
  for (let head = 0; head < queue.length; head += 1) {
    const v = queue[head] ?? 0;
    for (let e = g.outStart[v] ?? 0; e < (g.outStart[v + 1] ?? 0); e += 1) {
      const u = g.edgeTo[e] ?? 0;
      if (from[u] === -1) {
        from[u] = from[v] ?? -1;
        queue.push(u);
      }
    }
  }
  return from;
}

/** Total length of the lane graph's directed edges, in whole metres. */
function laneMetres(level: Level): number {
  const g = level.lanes;
  let m = 0;
  for (let e = 0; e < g.edgeCount; e += 1) {
    const a = g.edgeFrom[e] ?? 0;
    const b = g.edgeTo[e] ?? 0;
    m += Math.hypot((g.nodeX[b] ?? 0) - (g.nodeX[a] ?? 0), (g.nodeY[b] ?? 0) - (g.nodeY[a] ?? 0));
  }
  return Math.round(m);
}

/** Mean of a min/max interval rule pair (seconds), or 0 when the entity has no such rules. */
function meanInterval(info: EntityInfo | undefined): number {
  const r = info?.rules;
  if (r === undefined) return 0;
  const pairs: readonly [string, string][] = [
    ['messEveryMinS', 'messEveryMaxS'],
    ['dropEveryMinS', 'dropEveryMaxS'],
  ];
  for (const [lo, hi] of pairs) {
    const a = r[lo];
    const b = r[hi];
    if (a !== undefined && b !== undefined && a + b > 0) return (a + b) / 2;
  }
  return 0;
}

/**
 * Compile the guarded specs against the map (the module header has the rules): resolve anchors (L080), bake
 * the hazard candidates and check placements (L073), place perches and flocks, convert positions to metres,
 * estimate the peaks and the dynamic litter, and run the L050 NPC and vehicle budgets.
 */
export function compileSpawnSpecs(
  specs: CheckedSpecs,
  world: SpawnWorld,
  ctx: SpecContext,
): SpawnCompileResult {
  const p = new Problems();
  const { map, level } = world;
  const { w, h } = map;
  const navComp = navComponents(level);

  /** The nav node of an anchor digit, or −1 (reported) when the anchor is not on the map. */
  const navNode = (ref: AnchorRef, where: string, path: readonly string[]): number => {
    const a = level.nav.anchors.find((x) => x.char === ref.char);
    if (a !== undefined) return a.node;
    p.add(
      path,
      'L080',
      `${where} names anchor ${ref.char} (${ctx.anchors[ref.char] ?? '?'}), which is not on the map or has no pavement near it`,
      ref.ref,
    );
    return -1;
  };
  /**
   * The lane nodes within LANE_ANCHOR_MAX_M of an anchor digit's first tile (both directions of a two-way road
   * usually qualify), nearest first (ties to the lower index), or null (reported) when there are none.
   */
  const laneCandidates = (ref: AnchorRef, where: string, path: readonly string[]): number[] | null => {
    const tile = world.anchorTiles[ref.char]?.[0];
    if (tile === undefined) {
      p.add(
        path,
        'L080',
        `${where} names anchor ${ref.char} (${ctx.anchors[ref.char] ?? '?'}), which is not on the map`,
        ref.ref,
      );
      return null;
    }
    const cx = (tile[0] + 0.5) * TILE_M;
    const cy = (tile[1] + 0.5) * TILE_M;
    const near: { node: number; d: number }[] = [];
    for (let k = 0; k < level.lanes.nodeCount; k += 1) {
      const d = ((level.lanes.nodeX[k] ?? 0) - cx) ** 2 + ((level.lanes.nodeY[k] ?? 0) - cy) ** 2;
      if (d <= LANE_ANCHOR_MAX_M ** 2) near.push({ node: k, d });
    }
    if (near.length === 0) {
      p.add(
        path,
        'L080',
        `${where} names anchor ${ref.char}, more than ${LANE_ANCHOR_MAX_M} m from any traffic lane, so the route leaves the lane graph`,
        ref.ref,
      );
      return null;
    }
    return near.sort((a, b) => a.d - b.d || a.node - b.node).map((c) => c.node);
  };
  /**
   * Resolve a vehicle route to one lane node per anchor such that each leg can be driven along the directed
   * lane graph (L080 at the first leg that cannot); −1 for every anchor when it fails.
   */
  const laneRoute = (refs: readonly AnchorRef[], where: string, path: readonly string[]): number[] => {
    const failed = refs.map(() => -1);
    const cands = refs.map((r) => laneCandidates(r, where, path));
    if (cands.some((c) => c === null)) return failed;
    let layer = cands[0] ?? [];
    const preds: Map<number, number>[] = [new Map()];
    for (let i = 1; i < refs.length; i += 1) {
      const reach = laneReach(level, layer);
      const next = (cands[i] ?? []).filter((c) => (reach[c] ?? -1) >= 0);
      if (next.length === 0) {
        p.add(
          path,
          'L080',
          `${where} leg ${refs[i - 1]?.ref} → ${refs[i]?.ref} leaves the lane graph: no lane leads from one to the other`,
          refs[i]?.ref,
        );
        return failed;
      }
      preds.push(new Map(next.map((c) => [c, reach[c] ?? -1])));
      layer = next;
    }
    const nodes = [...failed];
    nodes[refs.length - 1] = layer[0] ?? -1;
    for (let i = refs.length - 1; i > 0; i -= 1) nodes[i - 1] = preds[i]?.get(nodes[i] ?? -1) ?? -1;
    return nodes;
  };
  /** Check a resolved nav route leg by leg (L080); `nodes` may hold −1 for anchors already reported. */
  const checkNavRoute = (
    refs: readonly AnchorRef[],
    nodes: readonly number[],
    loop: boolean,
    where: string,
    path: readonly string[],
  ): void => {
    const legs = loop && nodes.length > 1 ? nodes.length : nodes.length - 1;
    for (let i = 0; i < legs; i += 1) {
      const j = (i + 1) % nodes.length;
      const a = nodes[i] ?? -1;
      const b = nodes[j] ?? -1;
      if (a < 0 || b < 0 || navComp[a] === navComp[b]) continue;
      p.add(
        path,
        'L080',
        `${where} leg ${refs[i]?.ref} → ${refs[j]?.ref} leaves the nav graph: no pavement path joins them`,
        refs[j]?.ref,
      );
    }
  };

  // Traffic first: perches on car roofs and the vehicle peak need it.
  let traffic: TrafficSpawn | null = null;
  if (specs.traffic !== null) {
    const t = specs.traffic;
    const laneM = laneMetres(level);
    let parkedBays = 0;
    for (const b of level.lanes.bays) parkedBays += (b.rect[2] - b.rect[0]) * (b.rect[3] - b.rect[1]);
    const busRoute =
      t.busRoute.length === 0 ? [] : laneRoute(t.busRoute, 'traffic.busRoute', ['traffic', 'busRoute']);
    t.taxiRank.forEach(([x, y], i) => {
      const tile = Math.floor(y) * w + Math.floor(x);
      if (!isRoadCell(map, tile))
        p.add(['traffic', 'taxiRank'], 'L000', `traffic.taxiRank[${i}] [${x}, ${y}] is not on a road tile`);
    });
    traffic = {
      densityPerKm: t.densityPerKm,
      laneKm: laneM / 1000,
      moving: ceilQ((t.densityPerKm * laneM) / 1000),
      mix: t.mix,
      parkedFill: t.parkedFill,
      parkedBays,
      parked: ceilQ(parkedBays * t.parkedFill),
      parkedMix: t.parkedMix,
      pavement: t.pavement,
      taxiRank: t.taxiRank.map(([x, y]): PointM => [x * TILE_M, y * TILE_M]),
      busRoute: busRoute.map((n) => Math.max(n, 0)),
      busEveryS: t.busEveryS,
    };
  }

  // NPCs.
  let npc: NpcSpawn | null = null;
  if (specs.npcs !== null) {
    const s = specs.npcs;
    const named = s.named.map((n, i) => {
      const where = `npcs.named[${i}] (${n.id})`;
      const path = ['npcs', 'named'];
      const anchor = navNode(n.anchor, `${where} anchor`, path);
      const route = n.route.map((r) => navNode(r, `${where} route`, path));
      // From the anchor along the route, and back to the route's start for a loop.
      const back = n.loop && n.route.length > 1;
      checkNavRoute(
        [n.anchor, ...n.route, ...(back ? n.route.slice(0, 1) : [])],
        [anchor, ...route, ...(back ? route.slice(0, 1) : [])],
        false,
        `${where} route`,
        path,
      );
      return {
        id: n.id,
        count: n.count,
        spawnAtS: n.spawnAtS,
        anchor: Math.max(anchor, 0),
        route: route.map((r) => Math.max(r, 0)),
        loop: n.loop,
      };
    });
    let perches: NpcSpawn['perches'] = null;
    if (s.perches !== null) {
      const walls: PointM[] = [];
      if (s.perches.on.includes('walls'))
        for (let y = 0; y < h; y += 1)
          for (let x = 0; x < w; x += 1)
            if (map.rows[y]?.[x] === 'w') walls.push([(x + 0.5) * TILE_M, (y + 0.5) * TILE_M]);
      const available =
        (s.perches.on.includes('walls') && walls.length > 0) ||
        (s.perches.on.includes('carRoofs') && traffic !== null && traffic.parked > 0) ||
        (s.perches.on.includes('road') && level.lanes.nodeCount > 0);
      if (!available)
        p.add(
          ['npcs', 'perches'],
          'L000',
          `npcs.perches has nowhere to perch on ${s.perches.on.join(', ')}: no w walls, parked cars or lanes there`,
        );
      perches = { id: s.perches.id, count: s.perches.count, on: s.perches.on, walls };
    }
    const flocks = s.flocks.map((f, i) => {
      const points = world.resolveNear(f.near).map(([x, y]): PointM => [x, y]);
      if (points.length === 0)
        p.add(['npcs', 'flocks'], 'L000', `npcs.flocks[${i}].near ${f.near} matches nothing on the map`);
      return { id: f.id, count: f.count, size: f.size, points };
    });
    npc = { population: s.population, mix: s.mix, caps: s.caps, named, perches, flocks };
  }

  // Hazards.
  let hazards: HazardSpawn | null = null;
  if (specs.hazards !== null) {
    const { candidates, nearHydrant } = hazardCandidates(world);
    specs.hazards.place.forEach((hz, i) => {
      const tile = Math.floor(hz.at[1]) * w + Math.floor(hz.at[0]);
      const why = hazardExclusion(world, tile, nearHydrant);
      if (why !== null)
        p.add(
          ['hazards', 'place'],
          'L073',
          `hazards.place[${i}] ${hz.id} at [${hz.at[0]}, ${hz.at[1]}] ${why} (LEVEL_DESIGN §9.3)`,
          hz.id,
        );
    });
    specs.hazards.random.forEach((hz, i) => {
      const bit = hazardRuleBit(hz.rule);
      let count = 0;
      for (let t = 0; t < candidates.length; t += 1) if (((candidates[t] ?? 0) & bit) !== 0) count += 1;
      if (count < hz.count)
        p.add(
          ['hazards', 'random'],
          'L073',
          `hazards.random[${i}] asks for ${hz.count} ${hz.id} on ${hz.rule}, but only ${count} tile(s) qualify (LEVEL_DESIGN §9.3)`,
          hz.id,
        );
    });
    hazards = {
      place: specs.hazards.place.map((hz) => ({ id: hz.id, x: hz.at[0] * TILE_M, y: hz.at[1] * TILE_M })),
      random: specs.hazards.random,
      candidates,
    };
  }

  // Knockables.
  let knockables: KnockableSpawn[] | null = null;
  if (specs.knockables !== null) {
    knockables = specs.knockables.map((k, i) => {
      const tile = Math.floor(k.at[1]) * w + Math.floor(k.at[0]);
      if (map.solid[tile] === 1 || map.building[tile] !== -1)
        p.add(
          ['knockables'],
          'L000',
          `knockables[${i}] ${k.id} at [${k.at[0]}, ${k.at[1]}] is inside a building, wall or hedge`,
          k.id,
        );
      return { id: k.id, x: k.at[0] * TILE_M, y: k.at[1] * TILE_M };
    });
  }

  // Schedules: anchor params become graph nodes.
  const schedules: ScheduledEvent[] = specs.events.map((e) => {
    const params: { [key: string]: JsonValue } = { ...e.params };
    for (const a of e.anchorParams) {
      const where = `events[${e.index}] (${e.type}) ${a.param}`;
      let nodes: number[];
      if (a.graph === 'lane') nodes = laneRoute(a.refs, where, ['events']);
      else {
        nodes = a.refs.map((r) => navNode(r, where, ['events']));
        if (a.list) checkNavRoute(a.refs, nodes, false, where, ['events']);
      }
      const safe = nodes.map((n) => Math.max(n, 0));
      params[a.param] = a.list ? safe : (safe[0] ?? 0);
    }
    return { type: e.type, atS: e.atS, untilS: e.untilS, trigger: e.trigger, params };
  });

  const stalls = level.props.filter((pr: LevelProp) => pr.id === 'prop.market_stall').length;
  const peaks = estimatePeaks(specs, traffic, stalls, ctx);
  if (peaks.npc > NPC_BUDGET) {
    const q = peaks.npcParts;
    p.add(
      ['npcs'],
      'L050',
      `peak NPCs ${peaks.npc} is over the budget of ${NPC_BUDGET} (ambient ${q.ambient}, named ${q.named}, dogs ${q.dogs}, cats ${q.cats}, flock birds ${q.flocks}, market traders ${q.traders})`,
    );
  }
  if (peaks.vehicles > VEHICLE_BUDGET) {
    const q = peaks.vehicleParts;
    p.add(
      ['traffic'],
      'L050',
      `peak vehicles ${peaks.vehicles} is over the budget of ${VEHICLE_BUDGET} (moving ${q.moving}, parked ${q.parked}, pavement ${q.pavement})`,
    );
  }
  return {
    npc,
    traffic,
    hazards,
    knockables,
    schedules,
    peaks,
    dynamicLitter: estimateDynamicLitter(specs, peaks.npcParts.ambient, stalls, ctx),
    problems: p.list,
  };
}

/** Positive population_wave deltas active during [fromS, toS). */
function waveDelta(events: readonly CheckedEvent[], fromS: number, toS: number, timer: number): number {
  let sum = 0;
  for (const e of events) {
    if (e.type !== 'population_wave') continue;
    const delta = e.params.delta;
    const at = e.atS[0] ?? 0;
    const until = e.untilS ?? timer;
    if (typeof delta === 'number' && delta > 0 && at < toS && until > fromS) sum += delta;
  }
  return sum;
}

/**
 * The NPC and vehicle peaks (LEVEL_DESIGN §10.4). NPCs: the most ambient NPCs of any population window (its
 * target, bounded by the sum of the caps when every mix id has a cap, plus the positive population_wave deltas
 * active in it), plus every named NPC (`count` each), one dog per dog walker (named, and ambient up to the
 * walker's cap), the perched cats, every flock at its largest size, and one market trader per market stall
 * when a `market` event runs. Vehicles: the moving target (densityPerKm × lane-km, rounded up), the parked cars
 * (parking bays × parkedFill, rounded up) and the pavement vehicles.
 */
export function estimatePeaks(
  specs: CheckedSpecs,
  traffic: TrafficSpawn | null,
  stalls: number,
  ctx: SpecContext,
): Peaks {
  const s = specs.npcs;
  let ambient = 0;
  let named = 0;
  let dogs = 0;
  let cats = 0;
  let flocks = 0;
  if (s !== null) {
    const capOf = new Map(s.caps.map((c) => [c.id, c.cap]));
    const allCapped = s.mix.length > 0 && s.mix.every((m) => capOf.has(m.id));
    const capSum = s.mix.reduce((sum, m) => sum + (capOf.get(m.id) ?? 0), 0);
    for (const win of s.population) {
      const base = allCapped ? Math.min(win.target, capSum) : win.target;
      ambient = Math.max(ambient, base + waveDelta(specs.events, win.fromS, win.toS, ctx.timerS));
    }
    const isWalker = (id: string): boolean => ctx.entities[id]?.behaviour === DOG_WALKER_BEHAVIOUR;
    for (const n of s.named) {
      named += n.count;
      if (isWalker(n.id)) dogs += n.count;
    }
    for (const m of s.mix) if (isWalker(m.id)) dogs += Math.min(capOf.get(m.id) ?? ambient, ambient);
    cats = s.perches?.count ?? 0;
    for (const f of s.flocks) flocks += f.count * f.size[1];
  }
  const traders = specs.events.some((e) => e.type === 'market') ? stalls : 0;
  const moving = traffic?.moving ?? 0;
  const parked = traffic?.parked ?? 0;
  const pavement = traffic?.pavement.reduce((sum, v) => sum + v.count, 0) ?? 0;
  return {
    npc: ambient + named + dogs + cats + flocks + traders,
    npcParts: { ambient, named, dogs, cats, flocks, traders },
    vehicles: moving + parked + pavement,
    vehicleParts: { moving, parked, pavement },
  };
}

/**
 * Expected dynamic litter (LEVEL_DESIGN §10.4), a budget estimate that leans high: every NPC type that drops
 * litter on a timer (entities.json rules messEveryMinS/MaxS or dropEveryMinS/MaxS) drops one item per mean
 * interval while it is out (named NPCs from spawnAt, ambient ones at their peak count for the whole shift,
 * population_wave extras for the wave), every knockable spills once, and each market_close builds
 * itemsPerPitch items per market stall. M6 event litter (parade, leaf_fall, bin_round, vehicle_stop) is
 * SSP-190's; Doris's spilled shopping only comes from a penalty, so it is not expected.
 */
export function estimateDynamicLitter(
  specs: CheckedSpecs,
  ambientPeak: number,
  stalls: number,
  ctx: SpecContext,
): number {
  let items = 0;
  const timer = ctx.timerS;
  const s = specs.npcs;
  if (s !== null) {
    const capOf = new Map(s.caps.map((c) => [c.id, c.cap]));
    for (const n of s.named) {
      const every = meanInterval(ctx.entities[n.id]);
      if (every > 0) items += n.count * Math.floor((timer - n.spawnAtS) / every);
    }
    for (const m of s.mix) {
      const every = meanInterval(ctx.entities[m.id]);
      if (every > 0)
        items += Math.min(capOf.get(m.id) ?? ambientPeak, ambientPeak) * Math.floor(timer / every);
    }
  }
  for (const e of specs.events) {
    if (e.type === 'population_wave') {
      const id = e.params.npc;
      const delta = e.params.delta;
      const every = typeof id === 'string' ? meanInterval(ctx.entities[id]) : 0;
      if (every > 0 && typeof delta === 'number' && delta > 0)
        items += delta * Math.floor(((e.untilS ?? timer) - (e.atS[0] ?? 0)) / every);
    }
    if (e.type === 'market_close') {
      const per = e.params.itemsPerPitch;
      if (typeof per === 'number') items += per * stalls * Math.max(1, e.atS.length);
    }
  }
  for (const k of specs.knockables ?? []) items += ctx.entities[k.id]?.spills ?? 0;
  return items;
}
