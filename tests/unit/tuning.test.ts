// src/data/tuning.json and its loader src/sim/tuning.ts (SSP-029). The JSON is the source of truth for
// Bessie's handling and GDD §7 mirrors it (CLAUDE.md §2): the tables below quote GDD §7.1, §7.3 and §7.4, and
// the mirror tests read the §7.3 and §7.4 tables out of docs/GDD.md so the two cannot drift apart silently.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import tuningJson from '../../src/data/tuning.json' with { type: 'json' };
import { DEG_TO_RAD, SHIFT_S } from '../../src/sim/constants.ts';
import {
  DEFAULT_TUNING,
  loadTuning,
  STATIC_PROP_IDS,
  tuningSourceCopy,
  tuningsEqual,
} from '../../src/sim/tuning.ts';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const sweeper = DEFAULT_TUNING.vehicle.sweeper;
const raw = tuningJson.vehicle.sweeper;

type Json = Record<string, unknown>;

function isJson(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A deep copy of the committed JSON with one edit applied at `path` (dotted, from the root). */
function edited(path: string, edit: (parent: Json, key: string) => void): unknown {
  const copy: unknown = structuredClone(tuningJson);
  const parts = path.split('.');
  const key = parts.pop() ?? '';
  let parent: unknown = copy;
  for (const part of parts) {
    if (!isJson(parent)) throw new Error(`fixture path ${path} does not exist`);
    parent = parent[part];
  }
  if (!isJson(parent) || !Object.hasOwn(parent, key)) throw new Error(`fixture path ${path} does not exist`);
  edit(parent, key);
  return copy;
}

const without = (path: string): unknown =>
  edited(path, (parent, key) => {
    delete parent[key];
  });
const replaced = (path: string, value: unknown): unknown =>
  edited(path, (parent, key) => {
    parent[key] = value;
  });
/** A deep copy with the object at `path` changed in place by `edit`. */
const editedObject = (path: string, edit: (obj: Json) => void): unknown =>
  edited(path, (parent, key) => {
    const obj = parent[key];
    if (!isJson(obj)) throw new Error(`fixture path ${path} is not an object`);
    edit(obj);
  });

describe('tuning.json mirrors GDD §7 exactly', () => {
  // [JSON path under vehicle.sweeper, GDD value, where the GDD states it]
  it.each([
    ['body.widthM', 1.75, '§7.1 body 1.75 × 3.25 m'],
    ['body.lengthM', 3.25, '§7.1 body 1.75 × 3.25 m'],
    ['body.wheelbaseM', 2.4, '§7.1 wheelbase 2.4 m'],
    ['mass.emptyKg', 4200, '§7.1 mass 4,200 kg empty'],
    ['mass.fullHopperExtraKg', 1500, '§7.1 plus up to 1,500 kg at a full hopper'],
    ['drive.accelMps2', 2.4, '§7.1 engine acceleration 2.4 m/s²'],
    ['drive.brakeMps2', 6.0, '§7.1 brake deceleration 6.0 m/s²'],
    ['drive.topSpeedBrushDownMps', 6.0, '§7.1 top speed, brush down'],
    ['drive.topSpeedTransitMps', 11.0, '§7.1 top speed, brush up (transit)'],
    ['reverse.maxSpeedMps', 2.5, '§7.1 reverse max 2.5 m/s'],
    ['reverse.accelMps2', 1.5, '§7.1 reverse accel 1.5 m/s²'],
    ['reverse.engageBelowMps', 0.2, '§6.2 standstill < 0.2 m/s (proposed)'],
    ['reverse.engageHoldS', 0.25, '§6.2 0.25 s hold (proposed)'],
    ['fullHopper.accelMul', 0.7, '§7.1 / §7.4 accel ×0.70'],
    ['fullHopper.topSpeedMul', 0.9, '§7.1 / §7.4 top speed ×0.90'],
    ['fullHopper.steerRateMul', 0.85, '§7.1 / §7.4 steer rate ×0.85'],
    ['steering.maxSteerDeg', 34, '§7.1 max 34°'],
    ['steering.steerFalloffMps', 8, '§7.1 scaled by 1/(1 + v/8)'],
    ['steering.steerRateDegPerS', 120, '§7.1 steer rate 120°/s'],
    ['steering.returnRateDegPerS', 180, '§7.1 return 180°/s'],
    ['drag.rollingMps2', 0.3, '§7.1 rolling 0.3 m/s²'],
    ['drag.quadraticPerM', 0.012, '§7.1 quadratic 0.012·v²'],
    ['drag.grassRollingMul', 2.5, '§7.1 / §7.3 grass drag ×2.5'],
    ['lateralGripPerS.asphalt', 9.0, '§7.1 / §7.3 asphalt 9.0'],
    ['lateralGripPerS.pavement', 8.0, '§7.1 / §7.3 pavement 8.0'],
    ['lateralGripPerS.grass', 5.0, '§7.1 / §7.3 grass 5.0'],
    ['lateralGripPerS.wet', 4.0, '§7.1 / §7.3 wet / puddle 4.0'],
    ['lateralGripPerS.wetLeaves', 3.0, '§7.1 / §7.3 wet leaves 3.0'],
    ['lateralGripPerS.oil', 1.2, '§7.1 / §7.3 oil 1.2'],
    ['lateralGripPerS.rainAsphalt', 6.0, '§7.3 rain: all roads drop to 6.0'],
    ['kerb.speedKeepMul', 0.7, '§7.1 kerb crossing 30% speed loss'],
    ['collision.restitution', 0.2, '§7.1 restitution 0.2'],
    ['collision.damageHpPerMps', 4, '§7.1 4 HP per m/s'],
    ['collision.damageThresholdMps', 2, '§7.1 above 2 m/s'],
    ['health.maxHp', 100, '§7.1 100 HP'],
    ['health.dentedBelowHp', 40, '§7.2 dented variant below 40 HP'],
    ['brush.raiseLowerS', 0.5, '§7.1 raise/lower 0.5 s'],
    ['brush.spinUpS', 0.6, '§7.1 RPM spin-up 0.6 s'],
    ['brush.collectMinRpm', 0.8, '§7.1 collects only at RPM ≥ 80%'],
    ['brush.cleanPickupMaxMps', 4.0, '§7.1 clean-pickup speed ≤ 4.0 m/s'],
    ['brush.flingCertainMps', 6.0, '§7.1 fling probability reaches 1 at 6.0 m/s'],
  ])('vehicle.sweeper.%s = %d (GDD %s)', (path, expected) => {
    const [group = '', key = ''] = path.split('.');
    const groupValue: unknown = (raw as Json)[group];
    expect(isJson(groupValue) ? groupValue[key] : undefined).toBe(expected);
  });

  it('passes the empty-hopper numbers through the loader unchanged (except degrees → radians)', () => {
    expect(sweeper.body).toEqual(raw.body);
    expect(sweeper.drive).toEqual(raw.drive);
    expect(sweeper.lateralGripPerS).toEqual(raw.lateralGripPerS);
    expect(sweeper.fullHopper).toEqual(raw.fullHopper);
    expect(sweeper.brush).toEqual(raw.brush);
  });

  it('matches every row of the GDD §7.3 grip table', () => {
    const gdd = readFileSync(`${REPO_ROOT}docs/GDD.md`, 'utf8');
    const section = gdd.slice(gdd.indexOf('### 7.3 Surfaces and terrain'), gdd.indexOf('### 7.4'));
    const rows = new Map<string, number>();
    for (const m of section.matchAll(
      /^\| ([A-Za-z /]+?)(?: \(`haz\.\w+`\))? \| (\d+(?:\.\d+)?) \|(.*)\|$/gm,
    )) {
      rows.set(m[1] ?? '', Number(m[2]));
      const rain = /all roads drop to \*\*(\d+(?:\.\d+)?)\*\*/.exec(m[3] ?? '');
      if (rain) rows.set('rain', Number(rain[1]));
    }
    expect(Object.fromEntries(rows)).toEqual({
      Asphalt: sweeper.lateralGripPerS.asphalt,
      Pavement: sweeper.lateralGripPerS.pavement,
      Grass: sweeper.lateralGripPerS.grass,
      'Wet / puddle': sweeper.lateralGripPerS.wet,
      'Wet leaves': sweeper.lateralGripPerS.wetLeaves,
      Oil: sweeper.lateralGripPerS.oil,
      rain: sweeper.lateralGripPerS.rainAsphalt,
    });
  });

  it('reproduces the GDD §7.4 fill table from the full-hopper multipliers', () => {
    const gdd = readFileSync(`${REPO_ROOT}docs/GDD.md`, 'utf8');
    const section = gdd.slice(gdd.indexOf('### 7.4 Load'), gdd.indexOf('### 7.5'));
    const rowRe = /^\| (\d+)%[^|]*\| ([\d.]+) m\/s² \| ([\d.]+) \/ ([\d.]+) m\/s \| ([\d.]+)°\/s \|$/gm;
    const rows = [...section.matchAll(rowRe)];
    expect(rows.map((m) => m[1])).toEqual(['0', '50', '80', '100']);
    const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
    // A table value written with d decimals must be within half a unit of its last place.
    const near = (actual: number, written: string): void => {
      const decimals = written.split('.')[1]?.length ?? 0;
      expect(Math.abs(actual - Number(written))).toBeLessThanOrEqual(0.5 * 10 ** -decimals + 1e-12);
    };
    const { drive, fullHopper } = raw;
    for (const m of rows) {
      const f = Number(m[1]) / 100;
      near(drive.accelMps2 * lerp(1, fullHopper.accelMul, f), m[2] ?? '');
      near(drive.topSpeedBrushDownMps * lerp(1, fullHopper.topSpeedMul, f), m[3] ?? '');
      near(drive.topSpeedTransitMps * lerp(1, fullHopper.topSpeedMul, f), m[4] ?? '');
      near(raw.steering.steerRateDegPerS * lerp(1, fullHopper.steerRateMul, f), m[5] ?? '');
    }
  });
});

describe('loadTuning', () => {
  it('accepts the committed file', () => {
    expect(() => loadTuning(tuningJson)).not.toThrow();
    expect(loadTuning(structuredClone(tuningJson))).toEqual(DEFAULT_TUNING);
  });

  it('converts steering degrees to radians once, at load', () => {
    expect(sweeper.steering).toEqual({
      maxSteerRad: 34 * DEG_TO_RAD,
      steerFalloffMps: 8,
      steerRateRadPerS: 120 * DEG_TO_RAD,
      returnRateRadPerS: 180 * DEG_TO_RAD,
    });
    expect(DEG_TO_RAD).toBe(Math.PI / 180);
    expect(sweeper.steering.returnRateRadPerS).toBeCloseTo(Math.PI, 15);
    expect(Object.keys(sweeper.steering).some((k) => k.endsWith('Deg') || k.includes('DegPer'))).toBe(false);
  });

  it('returns a new object on every call, so callers can hand on an edited copy', () => {
    const a = loadTuning(tuningJson);
    const b = loadTuning(tuningJson);
    expect(a).not.toBe(b);
    expect(a.vehicle).not.toBe(b.vehicle);
    expect(a.vehicle.sweeper).not.toBe(b.vehicle.sweeper);
    expect(a.vehicle.sweeper.drive).not.toBe(b.vehicle.sweeper.drive);
    expect(a.vehicle.sweeper.provisional).not.toBe(b.vehicle.sweeper.provisional);
    expect(a.vehicle.sweeper.drive).not.toBe(DEFAULT_TUNING.vehicle.sweeper.drive);

    // Editing one copy (as the dev panel will) leaves the others and the source JSON alone.
    const edit: { topSpeedTransitMps: number } = a.vehicle.sweeper.drive as { topSpeedTransitMps: number };
    edit.topSpeedTransitMps = 99;
    expect(b.vehicle.sweeper.drive.topSpeedTransitMps).toBe(11);
    expect(DEFAULT_TUNING.vehicle.sweeper.drive.topSpeedTransitMps).toBe(11);
    expect(tuningJson.vehicle.sweeper.drive.topSpeedTransitMps).toBe(11);
  });

  it('loads an edited raw copy with the edited value', () => {
    const tuned = loadTuning(replaced('vehicle.sweeper.drive.topSpeedTransitMps', 12.5));
    expect(tuned.vehicle.sweeper.drive.topSpeedTransitMps).toBe(12.5);
    expect(DEFAULT_TUNING.vehicle.sweeper.drive.topSpeedTransitMps).toBe(11);
  });

  it('lists the provisional wheel geometry awaiting lead confirmation', () => {
    expect(sweeper.provisional).toEqual([
      'body.wheelTrackM',
      'body.frontAxleOffsetM',
      'body.rearAxleOffsetM',
    ]);
    expect(sweeper.body.wheelTrackM).toBe(1.75);
    expect(sweeper.body.frontAxleOffsetM).toBe(1.2);
    expect(sweeper.body.rearAxleOffsetM).toBe(-1.2);
    expect(sweeper.body.frontAxleOffsetM - sweeper.body.rearAxleOffsetM).toBeCloseTo(
      sweeper.body.wheelbaseM,
      12,
    );
  });

  describe('rejects malformed data with an error naming the JSON path', () => {
    it('a fixture with a missing key', () => {
      expect(() => loadTuning(without('vehicle.sweeper.drive.brakeMps2'))).toThrow(
        'tuning: vehicle.sweeper.drive.brakeMps2 is missing',
      );
      expect(() => loadTuning(without('vehicle.sweeper.lateralGripPerS'))).toThrow(
        'tuning: vehicle.sweeper.lateralGripPerS is missing',
      );
      expect(() => loadTuning(without('vehicle.sweeper.provisional'))).toThrow(
        'tuning: vehicle.sweeper.provisional is missing',
      );
      expect(() => loadTuning(without('vehicle.sweeper'))).toThrow('tuning: vehicle.sweeper is missing');
    });

    it('a fixture with a string where a number is expected', () => {
      expect(() => loadTuning(replaced('vehicle.sweeper.drive.accelMps2', '2.4'))).toThrow(
        'tuning: vehicle.sweeper.drive.accelMps2 must be a finite number, got string "2.4"',
      );
      expect(() => loadTuning(replaced('vehicle.sweeper.steering.maxSteerDeg', '34'))).toThrow(
        /vehicle\.sweeper\.steering\.maxSteerDeg must be a finite number/,
      );
    });

    it.each([
      ['null', null],
      ['a boolean', true],
      ['NaN', Number.NaN],
      ['Infinity', Number.POSITIVE_INFINITY],
      ['an object', { value: 6 }],
    ])('a number replaced by %s', (_name, value) => {
      expect(() => loadTuning(replaced('vehicle.sweeper.drive.brakeMps2', value))).toThrow(
        /vehicle\.sweeper\.drive\.brakeMps2 must be a finite number/,
      );
    });

    it.each([
      ['root', null, /tuning: root must be an object, got null/],
      ['root', [], /tuning: root must be an object, got an array/],
      ['root', 'tuning', /tuning: root must be an object/],
    ])('a non-object %s', (_name, value, message) => {
      expect(() => loadTuning(value)).toThrow(message);
    });

    it('a group that is not an object', () => {
      expect(() => loadTuning(replaced('vehicle.sweeper.body', [1.75, 3.25]))).toThrow(
        'tuning: vehicle.sweeper.body must be an object, got an array',
      );
    });

    it('unknown keys (typos never load silently)', () => {
      const typo = editedObject('vehicle.sweeper.drive', (group) => {
        group.accelMps = 2.4;
      });
      expect(() => loadTuning(typo)).toThrow('tuning: vehicle.sweeper.drive has unknown key "accelMps"');
      const extraBlock = editedObject('vehicle', (group) => {
        group.hatchback = {};
      });
      expect(() => loadTuning(extraBlock)).toThrow('tuning: vehicle has unknown key "hatchback"');
    });

    it.each([
      ['drive.accelMps2', 0, 'must be > 0'],
      ['drive.brakeMps2', -6, 'must be > 0'],
      ['drag.rollingMps2', -0.1, 'must be >= 0'],
      ['body.rearAxleOffsetM', 1.2, 'must be < 0'],
      ['fullHopper.accelMul', 1.3, 'must be in (0, 1]'],
      ['fullHopper.topSpeedMul', 0, 'must be in (0, 1]'],
      ['kerb.speedKeepMul', 1.5, 'must be in (0, 1]'],
      ['collision.restitution', 1.2, 'must be in [0, 1]'],
      ['brush.collectMinRpm', -0.1, 'must be in [0, 1]'],
    ])('out-of-range %s = %d', (path, value, message) => {
      expect(() => loadTuning(replaced(`vehicle.sweeper.${path}`, value))).toThrow(
        `tuning: vehicle.sweeper.${path} ${message}`,
      );
    });

    it('inconsistent wheel geometry', () => {
      expect(() => loadTuning(replaced('vehicle.sweeper.body.frontAxleOffsetM', 1.0))).toThrow(
        /vehicle\.sweeper\.body axle offsets span 2\.2 m but wheelbaseM is 2\.4 m/,
      );
      const outsideBody = editedObject('vehicle.sweeper.body', (group) => {
        group.frontAxleOffsetM = 2.0;
        group.rearAxleOffsetM = -0.4;
      });
      expect(() => loadTuning(outsideBody)).toThrow(/axle offsets must lie within the body length/);
    });

    it('cross-field speed and health relations', () => {
      expect(() => loadTuning(replaced('vehicle.sweeper.drive.topSpeedBrushDownMps', 12))).toThrow(
        /topSpeedBrushDownMps must not exceed topSpeedTransitMps/,
      );
      expect(() => loadTuning(replaced('vehicle.sweeper.brush.flingCertainMps', 4))).toThrow(
        /cleanPickupMaxMps must be below flingCertainMps/,
      );
      expect(() => loadTuning(replaced('vehicle.sweeper.health.dentedBelowHp', 120))).toThrow(
        /dentedBelowHp must not exceed maxHp/,
      );
    });

    it.each([
      ['not an array', 'body.wheelTrackM', /provisional must be an array of strings/],
      ['a non-string entry', [7], /provisional\[0\] must be a string, got number 7/],
      ['an unknown group', ['chassis.wheelTrackM'], /provisional\[0\] names no numeric value/],
      ['an unknown key', ['body.trackM'], /provisional\[0\] names no numeric value/],
      ['a nested path', ['body.wheelTrackM.x'], /provisional\[0\] names no numeric value/],
      ['a non-numeric target', ['provisional.x'], /provisional\[0\] names no numeric value/],
      ['a repeat', ['body.wheelTrackM', 'body.wheelTrackM'], /provisional\[1\] repeats "body\.wheelTrackM"/],
    ])('a provisional list with %s', (_name, value, message) => {
      expect(() => loadTuning(replaced('vehicle.sweeper.provisional', value))).toThrow(message);
    });
  });
});

describe('propFootprints (SSP-036, provisional until M4)', () => {
  const footprints = DEFAULT_TUNING.propFootprints;

  /** A copy of the committed JSON with propFootprints.shapes edited by `edit`. */
  function withShapes(edit: (shapes: Json) => void): unknown {
    const copy = structuredClone(tuningJson) as Json;
    const fp = copy.propFootprints;
    if (!isJson(fp) || !isJson(fp.shapes)) throw new Error('propFootprints.shapes missing from the fixture');
    edit(fp.shapes);
    return copy;
  }

  it('is flagged provisional and holds exactly the twelve static props of TECHNICAL_DESIGN §9.1', () => {
    expect(footprints.provisional).toBe(true);
    expect(Object.keys(footprints.shapes)).toEqual([...STATIC_PROP_IDS]);
    expect(STATIC_PROP_IDS).toEqual([
      'prop.lamp_post',
      'prop.bollard',
      'prop.bench',
      'prop.bus_shelter',
      'prop.phone_box',
      'prop.post_box',
      'prop.hydrant',
      'prop.tree',
      'prop.planter',
      'prop.market_stall',
      'prop.litter_bin',
      'prop.roadworks_barrier',
    ]);
  });

  it('lists every static prop that ENTITY_CATALOG §9.2 names', () => {
    const catalog = readFileSync(`${REPO_ROOT}docs/ENTITY_CATALOG.md`, 'utf8');
    const section = catalog.slice(catalog.indexOf('### 9.2 Static props'), catalog.indexOf('## 10.'));
    const ids = [...section.matchAll(/^\| `(prop\.[a-z_]+)` \|/gm)].map((m) => m[1]);
    expect(ids).toEqual([...STATIC_PROP_IDS]);
  });

  it('gives the bollard a 0.3 m-diameter circle (TECHNICAL_DESIGN §9.5) and every footprint fits a 2 m tile', () => {
    expect(footprints.shapes['prop.bollard']).toEqual({ shape: 'circle', radiusM: 0.15 });
    for (const id of STATIC_PROP_IDS) {
      const fp = footprints.shapes[id];
      if (fp.shape === 'circle') expect(fp.radiusM, id).toBeLessThanOrEqual(1);
      else {
        expect(fp.widthM, id).toBeLessThanOrEqual(2);
        expect(fp.lengthM, id).toBeLessThanOrEqual(2);
      }
    }
  });

  it.each([
    [
      'a missing prop',
      (s: Json) => {
        delete s['prop.tree'];
      },
      'tuning: propFootprints.shapes.prop.tree is missing',
    ],
    [
      'an unknown prop',
      (s: Json) => {
        s['prop.wheelie_bin'] = { shape: 'circle', radiusM: 0.4 };
      },
      'tuning: propFootprints.shapes has unknown key "prop.wheelie_bin"',
    ],
    [
      'an unknown shape',
      (s: Json) => {
        s['prop.bench'] = { shape: 'capsule', radiusM: 0.4 };
      },
      'tuning: propFootprints.shapes.prop.bench.shape must be "circle" or "box", got string "capsule"',
    ],
    [
      'a zero radius',
      (s: Json) => {
        s['prop.bollard'] = { shape: 'circle', radiusM: 0 };
      },
      'tuning: propFootprints.shapes.prop.bollard.radiusM must be > 0, got 0',
    ],
    [
      'a box missing its length',
      (s: Json) => {
        s['prop.bench'] = { shape: 'box', widthM: 1.8 };
      },
      'tuning: propFootprints.shapes.prop.bench.lengthM is missing',
    ],
    [
      'a circle with a box key',
      (s: Json) => {
        s['prop.hydrant'] = { shape: 'circle', radiusM: 0.2, widthM: 1 };
      },
      'tuning: propFootprints.shapes.prop.hydrant has unknown key "widthM"',
    ],
    [
      'a non-object footprint',
      (s: Json) => {
        s['prop.tree'] = 0.25;
      },
      'tuning: propFootprints.shapes.prop.tree must be an object, got number 0.25',
    ],
  ])('rejects %s, naming the JSON path', (_name, edit, message) => {
    expect(() => loadTuning(withShapes(edit))).toThrow(message);
  });

  it('requires the provisional flag to be a boolean and the block itself to exist', () => {
    const copy = structuredClone(tuningJson) as Json;
    const fp = copy.propFootprints;
    if (isJson(fp)) fp.provisional = 'yes';
    expect(() => loadTuning(copy)).toThrow(
      'tuning: propFootprints.provisional must be a boolean, got string "yes"',
    );
    expect(() => loadTuning(without('propFootprints'))).toThrow('tuning: root.propFootprints is missing');
  });

  it('returns fresh footprint objects on every load', () => {
    const a = loadTuning(tuningJson);
    expect(a.propFootprints).not.toBe(DEFAULT_TUNING.propFootprints);
    expect(a.propFootprints.shapes['prop.bench']).not.toBe(
      DEFAULT_TUNING.propFootprints.shapes['prop.bench'],
    );
    expect(a.propFootprints).toEqual(DEFAULT_TUNING.propFootprints);
  });
});

describe('tuningSourceCopy and tuningsEqual (SSP-048 dev panel)', () => {
  it('copies the committed JSON deeply: equal values, no shared objects', () => {
    const a = tuningSourceCopy();
    expect(a).toEqual(tuningJson);
    expect(a).not.toBe(tuningJson);
    const b = tuningSourceCopy() as typeof tuningJson;
    b.vehicle.sweeper.drive.topSpeedTransitMps = 99;
    expect(tuningJson.vehicle.sweeper.drive.topSpeedTransitMps).toBe(11);
    expect(tuningSourceCopy()).toEqual(tuningJson);
  });

  it('a copy loads to a Tuning equal to DEFAULT_TUNING; one edited value makes it differ', () => {
    expect(tuningsEqual(loadTuning(tuningSourceCopy()), DEFAULT_TUNING)).toBe(true);
    const raw = tuningSourceCopy() as typeof tuningJson;
    raw.vehicle.sweeper.steering.maxSteerDeg = 35;
    expect(tuningsEqual(loadTuning(raw), DEFAULT_TUNING)).toBe(false);
    raw.vehicle.sweeper.steering.maxSteerDeg = 34;
    expect(tuningsEqual(loadTuning(raw), DEFAULT_TUNING)).toBe(true);
  });

  it('compares plain data structurally', () => {
    expect(tuningsEqual({ a: [1, 2, { b: 'x' }] }, { a: [1, 2, { b: 'x' }] })).toBe(true);
    expect(tuningsEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(tuningsEqual({ a: 1, b: undefined }, { a: 1, c: undefined })).toBe(false);
    expect(tuningsEqual([1, 2], { 0: 1, 1: 2 })).toBe(false);
    expect(tuningsEqual([1, 2], [1, 2, 3])).toBe(false);
    expect(tuningsEqual(0, -0)).toBe(false);
    expect(tuningsEqual(null, {})).toBe(false);
    expect(tuningsEqual('1', 1)).toBe(false);
    expect(tuningsEqual(true, true)).toBe(true);
  });
});

describe('M2 sweeping-core sections (SSP-053) mirror GDD §8–§12 and TECHNICAL_DESIGN §10', () => {
  // [JSON path from the root, value, where the docs state it]
  it.each([
    ['sweeping.gutterBrush.radiusM', 0.45, 'GDD §8.1 two circles, r = 0.45 m'],
    ['sweeping.gutterBrush.centreXM', 0.85, 'GDD §8.1 at (±0.85, +1.75)'],
    ['sweeping.gutterBrush.centreYM', 1.75, 'GDD §8.1 at (±0.85, +1.75)'],
    ['sweeping.suction.minXM', -1.3, 'TD §10.1 x ∈ [−1.3, 1.3]'],
    ['sweeping.suction.maxXM', 1.3, 'TD §10.1 x ∈ [−1.3, 1.3]'],
    ['sweeping.suction.minYM', 1.6, 'TD §10.1 y ∈ [+1.6, +2.8]'],
    ['sweeping.suction.maxYM', 2.8, 'TD §10.1 y ∈ [+1.6, +2.8]'],
    ['sweeping.suction.pullMps', 3.0, 'TD §10.1 3.0 m/s × rpm × suctionMult'],
    ['sweeping.inlet.centreXM', 0, 'TD §10.1 inlet centred at (0, +1.2)'],
    ['sweeping.inlet.centreYM', 1.2, 'TD §10.1 inlet centred at (0, +1.2)'],
    ['sweeping.inlet.widthM', 1.0, 'GDD §8.1 inlet 1.0 × 0.4 m'],
    ['sweeping.inlet.depthM', 0.4, 'GDD §8.1 inlet 1.0 × 0.4 m'],
    ['sweeping.grimeFootprint.minXM', -1.3, 'TD §10.1 x ∈ [−1.3, 1.3]'],
    ['sweeping.grimeFootprint.maxXM', 1.3, 'TD §10.1 x ∈ [−1.3, 1.3]'],
    ['sweeping.grimeFootprint.minYM', 1.3, 'TD §10.1 y ∈ [+1.3, +2.2]'],
    ['sweeping.grimeFootprint.maxYM', 2.2, 'TD §10.1 y ∈ [+1.3, +2.2]'],
    ['sweeping.kerbHugger.maxKerbDistanceM', 0.2, 'GDD §8.1 within 0.2 m of a kerb edge'],
    ['sweeping.fling.minDistanceM', 1.5, 'GDD §8.1 knocked sideways 1.5 to 3 m'],
    ['sweeping.fling.maxDistanceM', 3.0, 'GDD §8.1 knocked sideways 1.5 to 3 m'],
    ['sweeping.fling.arcDurationS', 0.5, 'GDD §8.1 the arc lasts 0.5 s'],
    ['hopper.capacityLu', 100, 'GDD §8.4 base capacity 100 LU'],
    ['hopper.warnFraction', 0.8, 'GDD §8.4 HUD warns at 80%'],
    ['water.tankUnits', 100, 'GDD §8.5 tank 100 units'],
    ['water.sprayUnitsPerS', 6, 'GDD §8.5 uses 6 units/s'],
    ['water.sprayConeLengthM', 2.6, 'GDD §8.5 over a 2.6 m cone ahead'],
    ['water.hydrantRefillUnitsPerS', 25, 'GDD §8.5 hydrant 25 units/s'],
    ['dumping.depotBay.holdS', 1.0, 'GDD §8.7 hold Dump 1.0 s'],
    ['dumping.depotBay.drainS', 2.0, 'GDD §8.7 depot drain 2.0 s'],
    ['dumping.depotBay.maxSpeedMps', 0.5, 'GDD §8.7 stop inside (< 0.5 m/s)'],
    ['dumping.skip.holdS', 1.0, 'GDD §8.7 hold Dump 1.0 s'],
    ['dumping.skip.drainS', 3.0, 'GDD §8.7 skip drain 3.0 s'],
    ['combo.chainS', 2.0, 'GDD §10.2 2.0 s chain timer'],
    ['scoring.grimeCellPts', 1, 'GDD §9.1 1 pt per cell'],
    ['scoring.gutterGrimeCellPts', 2, 'GDD §9.1 2 pts for gutter grime'],
    ['scoring.kerbHuggerPts', 50, 'GDD §10.3 Kerb Hugger +50'],
    ['scoring.kerbHuggerEveryS', 3, 'GDD §10.3 per 3 s of continuous kerb contact'],
    ['scoring.cleanSweepPts', 100, 'GDD §10.3 Clean Sweep +100'],
    ['shift.durationS', 240, 'LEVEL_DESIGN §4.1 timer starts at 240'],
    ['shift.rolloutS', 3, 'LEVEL_DESIGN §4.1 3 s rollout'],
    ['tidy.grimeWeight', 0.6, 'GDD §9.2 0.6 × grime'],
    ['tidy.litterWeight', 0.4, 'GDD §9.2 0.4 × litter'],
  ])('%s = %d (%s)', (path, expected) => {
    let value: unknown = tuningJson;
    for (const part of path.split('.')) value = isJson(value) ? value[part] : undefined;
    expect(value).toBe(expected);
  });

  it('matches the GDD §10.2 combo tier table', () => {
    const gdd = readFileSync(`${REPO_ROOT}docs/GDD.md`, 'utf8');
    const section = gdd.slice(gdd.indexOf('### 10.2 Combo chain'), gdd.indexOf('### 10.3'));
    const tiers = [...section.matchAll(/^\| (\d+)(?:–\d+|\+) \| ×(\d+) \|/gm)]
      .map((m) => ({ minChain: Number(m[1]), multiplier: Number(m[2]) }))
      .filter((tier) => tier.multiplier > 1);
    expect(tiers).toEqual(DEFAULT_TUNING.combo.tiers);
    expect(DEFAULT_TUNING.combo.tiers.map((t) => t.minChain)).toEqual([10, 25, 50, 100]);
  });

  it('matches the GDD §12.1 star thresholds', () => {
    const gdd = readFileSync(`${REPO_ROOT}docs/GDD.md`, 'utf8');
    const section = gdd.slice(gdd.indexOf('### 12.1 Stars'), gdd.indexOf('### 12.2'));
    const thresholds = [...section.matchAll(/^\| (\d)★ \| Tidy % ≥ \*\*(\d+)\*\* \|$/gm)].map(
      (m) => Number(m[2]) / 100,
    );
    const { stars } = DEFAULT_TUNING;
    expect(thresholds).toEqual([stars.star1MinTidy, stars.star2MinTidy, stars.star3MinTidy]);
  });

  it('keeps the shift length equal to constants.ts SHIFT_S until SSP-062 reads it from tuning', () => {
    expect(DEFAULT_TUNING.shift.durationS).toBe(SHIFT_S);
  });

  it('does not repeat the values M1 put under vehicle.sweeper', () => {
    const sections = JSON.stringify({ ...tuningJson, vehicle: undefined, propFootprints: undefined });
    for (const key of ['raiseLowerS', 'spinUpS', 'collectMinRpm', 'cleanPickupMaxMps', 'flingCertainMps']) {
      expect(sections).not.toContain(key);
    }
    for (const key of ['fullHopperExtraKg', 'accelMul', 'topSpeedMul', 'steerRateMul']) {
      expect(sections).not.toContain(key);
    }
  });

  it('loads the sections unchanged, with a fresh combo tier list per call', () => {
    expect(DEFAULT_TUNING.sweeping).toEqual(tuningJson.sweeping);
    expect(DEFAULT_TUNING.dumping).toEqual(tuningJson.dumping);
    expect(DEFAULT_TUNING.combo).toEqual(tuningJson.combo);
    expect(loadTuning(tuningJson).combo.tiers).not.toBe(loadTuning(tuningJson).combo.tiers);
  });

  describe('rejects malformed data with an error naming the JSON path', () => {
    it.each([
      'sweeping',
      'sweeping.suction',
      'sweeping.suction.pullMps',
      'sweeping.inlet.centreXM',
      'hopper.capacityLu',
      'water.sprayUnitsPerS',
      'dumping.depotBay.maxSpeedMps',
      'dumping.skip',
      'combo.tiers',
      'scoring.cleanSweepPts',
      'shift.rolloutS',
      'stars.star3MinTidy',
      'tidy',
    ])('a missing %s', (path) => {
      // Top-level keys are reported under `root.`, like root.propFootprints.
      const reported = path.includes('.') ? path : `root.${path}`;
      expect(() => loadTuning(without(path))).toThrow(`tuning: ${reported} is missing`);
    });

    it.each([
      ['hopper.warnFraction', 1.2, 'must be in (0, 1]'],
      ['water.tankUnits', 0, 'must be > 0'],
      ['sweeping.gutterBrush.centreXM', -0.85, 'must be > 0'],
      ['sweeping.suction.minXM', '−1.3', 'must be a finite number, got string "−1.3"'],
      ['scoring.grimeCellPts', 1.5, 'must be an integer >= 1, got 1.5'],
      ['shift.rolloutS', -1, 'must be >= 0'],
      ['tidy.litterWeight', 1.4, 'must be in [0, 1]'],
    ])('out-of-range %s = %s', (path, value, message) => {
      expect(() => loadTuning(replaced(path, value))).toThrow(`tuning: ${path} ${message}`);
    });

    it('cross-field relations', () => {
      expect(() => loadTuning(replaced('sweeping.suction.maxYM', 1.5))).toThrow(
        'tuning: sweeping.suction minYM (1.6) must be below maxYM (1.5)',
      );
      expect(() => loadTuning(replaced('sweeping.grimeFootprint.minXM', 1.3))).toThrow(
        'tuning: sweeping.grimeFootprint minXM (1.3) must be below maxXM (1.3)',
      );
      expect(() => loadTuning(replaced('sweeping.fling.minDistanceM', 4))).toThrow(
        /minDistanceM must not exceed maxDistanceM/,
      );
      expect(() => loadTuning(replaced('scoring.gutterGrimeCellPts', 1))).not.toThrow();
      expect(() => loadTuning(replaced('scoring.grimeCellPts', 3))).toThrow(
        /gutterGrimeCellPts must not be below grimeCellPts/,
      );
      expect(() => loadTuning(replaced('stars.star2MinTidy', 0.95))).toThrow(/thresholds must ascend/);
      expect(() => loadTuning(replaced('tidy.grimeWeight', 0.5))).toThrow(
        /grimeWeight \+ litterWeight must be 1, got 0\.9/,
      );
      expect(() => loadTuning(replaced('shift.rolloutS', 240))).toThrow(/rolloutS must be below durationS/);
      expect(() => loadTuning(replaced('shift.durationS', 240.005))).toThrow(
        'tuning: shift.durationS must be a whole number of 60 Hz ticks, got 240.005',
      );
    });

    it.each([
      ['not an array', { minChain: 10, multiplier: 2 }, /combo\.tiers must be a non-empty array/],
      ['empty', [], /combo\.tiers must be a non-empty array/],
      [
        'a non-ascending chain',
        [
          { minChain: 10, multiplier: 2 },
          { minChain: 10, multiplier: 3 },
        ],
        /combo\.tiers\[1\] minChain must be above 10/,
      ],
      [
        'a non-ascending multiplier',
        [
          { minChain: 10, multiplier: 2 },
          { minChain: 25, multiplier: 2 },
        ],
        /combo\.tiers\[1\] multiplier must be above 2/,
      ],
      ['a ×1 tier', [{ minChain: 5, multiplier: 1 }], /combo\.tiers\[0\] multiplier must be above 1/],
      [
        'a tier with an unknown key',
        [{ minChain: 10, multiplier: 2, popup: 'TIDY!' }],
        /unknown key "popup"/,
      ],
    ])('combo tiers %s', (_name, value, message) => {
      expect(() => loadTuning(replaced('combo.tiers', value))).toThrow(message);
    });
  });
});

describe('M3 street-life sections (SSP-075) mirror ENTITY_CATALOG §3, GDD §11 and TECHNICAL_DESIGN §9.4', () => {
  const docs: Record<string, string> = {
    catalog: readFileSync(`${REPO_ROOT}docs/ENTITY_CATALOG.md`, 'utf8'),
    gdd: readFileSync(`${REPO_ROOT}docs/GDD.md`, 'utf8'),
    td: readFileSync(`${REPO_ROOT}docs/TECHNICAL_DESIGN.md`, 'utf8'),
  };
  /** A doc number: U+2212 minus read as a sign. */
  const num = (text: string): number => Number(text.replaceAll('−', '-'));

  // [JSON path from the root, value, doc, regex whose capture `group` states the value]
  it.each([
    ['streetLife.awareness.radiusM', 6, 'catalog', /\((\d+) m, or (\d+) m with upg\.led_beacon\)/, 1],
    [
      'streetLife.awareness.ledBeaconRadiusM',
      10,
      'catalog',
      /\((\d+) m, or (\d+) m with upg\.led_beacon\)/,
      2,
    ],
    ['streetLife.horn.radiusM', 8, 'catalog', /\((\d+) m, or (\d+) m with upg\.two_tone_horn\)/, 1],
    ['streetLife.horn.twoToneRadiusM', 12, 'catalog', /\((\d+) m, or (\d+) m with upg\.two_tone_horn\)/, 2],
    ['streetLife.nearMiss.maxGapM', 0.5, 'catalog', /within (\d+\.\d+) m of a pedestrian at more than/, 1],
    ['streetLife.nearMiss.minSpeedMps', 3, 'catalog', /at more than (\d+) m\/s without contact/, 1],
    ['streetLife.nearMiss.pts', 25, 'catalog', /without contact = \*\*\+(\d+)\*\*/, 1],
    ['streetLife.dust.radiusM', 3, 'catalog', /within (\d+) m of a dust cloud/, 1],
    ['streetLife.dust.pts', -10, 'catalog', /(−\d+) pts per pedestrian per (\d+) s/, 1],
    ['streetLife.dust.everyS', 2, 'catalog', /(−\d+) pts per pedestrian per (\d+) s/, 2],
    ['streetLife.splash.minSpeedMps', 3, 'catalog', /above (\d+) m\/s through `haz\.puddle`/, 1],
    ['streetLife.splash.radiusM', 1.5, 'catalog', /pedestrians within (\d+\.\d+) m: (−\d+) each/, 1],
    ['streetLife.splash.pts', -50, 'catalog', /pedestrians within (\d+\.\d+) m: (−\d+) each/, 2],
    ['streetLife.splash.complaintEvery', 3, 'catalog', /Every (\d)rd splash = 1 complaint/, 1],
    [
      'streetLife.actorHit.minClosingSpeedMps',
      1.0,
      'catalog',
      /closing speed toward the actor is ≥ (\d+\.\d+) m\/s/,
      1,
    ],
    ['streetLife.actorHit.ignoreContactS', 1.5, 'td', /contact is ignored for (\d+\.\d+) s/, 1],
    [
      'streetLife.npcRadius.humanM',
      0.3,
      'td',
      /human r = (\d+\.\d+) m, cat (\d+\.\d+) m, dog (\d+\.\d+) m/,
      1,
    ],
    ['streetLife.npcRadius.catM', 0.2, 'td', /human r = (\d+\.\d+) m, cat (\d+\.\d+) m, dog (\d+\.\d+) m/, 2],
    [
      'streetLife.npcRadius.dogM',
      0.25,
      'td',
      /human r = (\d+\.\d+) m, cat (\d+\.\d+) m, dog (\d+\.\d+) m/,
      3,
    ],
    ['streetLife.traffic.honkAfterBlockedS', 3, 'catalog', /Honks after (\d+) s blocked/, 1],
    ['complaints.meter.sackedAt', 5, 'catalog', /Reaching (\d+) = \*\*SACKED!\*\*/, 1],
    ['complaints.hornSpam.maxHonks', 3, 'catalog', /more than (\d+) honks in (\d+) s = (\d+) complaint/, 1],
    ['complaints.hornSpam.windowS', 5, 'catalog', /more than (\d+) honks in (\d+) s = (\d+) complaint/, 2],
    ['complaints.hornSpam.complaints', 1, 'catalog', /more than (\d+) honks in (\d+) s = (\d+) complaint/, 3],
    [
      'complaints.hornSpam.twoToneMaxHonks',
      5,
      'catalog',
      /The threshold becomes (\d+) with `upg\.two_tone_horn`/,
      1,
    ],
    [
      'complaints.roadRage.afterBlockedS',
      10,
      'catalog',
      /Blocking traffic\*\* for more than (\d+) s = (\d+) complaint/,
      1,
    ],
    [
      'complaints.roadRage.complaints',
      1,
      'catalog',
      /Blocking traffic\*\* for more than (\d+) s = (\d+) complaint/,
      2,
    ],
    ['complaints.zebra.pts', -200, 'catalog', /Running an occupied zebra\*\* = (−\d+) \+ (\d+) complaint/, 1],
    [
      'complaints.zebra.complaints',
      1,
      'catalog',
      /Running an occupied zebra\*\* = (−\d+) \+ (\d+) complaint/,
      2,
    ],
    [
      'complaints.policeWitness.radiusM',
      15,
      'catalog',
      /within \*\*(\d+) m\*\* of a `veh\.police` adds \*\*\+(\d+) extra/,
      1,
    ],
    [
      'complaints.policeWitness.extraComplaints',
      1,
      'catalog',
      /within \*\*(\d+) m\*\* of a `veh\.police` adds \*\*\+(\d+) extra/,
      2,
    ],
    ['endStates.towedScoreKeep', 0.5, 'gdd', /keeps \*\*(\d+)% of the score\*\*/, 1],
  ] as const)('%s = %d (%s)', (path, expected, doc, pattern, group) => {
    let value: unknown = tuningJson;
    for (const part of path.split('.')) value = isJson(value) ? value[part] : undefined;
    expect(value).toBe(expected);
    const stated = pattern.exec(docs[doc] ?? '')?.[group];
    expect(stated, `${doc} states ${path}`).toBeDefined();
    const docValue = path === 'endStates.towedScoreKeep' ? num(stated ?? '') / 100 : num(stated ?? '');
    expect(docValue).toBe(expected);
  });

  it('loads the sections unchanged as typed groups', () => {
    expect(DEFAULT_TUNING.streetLife).toEqual(tuningJson.streetLife);
    expect(DEFAULT_TUNING.complaints).toEqual(tuningJson.complaints);
    expect(DEFAULT_TUNING.endStates).toEqual(tuningJson.endStates);
    const horn: number = DEFAULT_TUNING.streetLife.horn.radiusM;
    expect(horn).toBe(8);
  });

  it('does not repeat the grip values: hazards name a lateralGripPerS surface instead', () => {
    const sections = JSON.stringify({
      streetLife: tuningJson.streetLife,
      complaints: tuningJson.complaints,
      endStates: tuningJson.endStates,
    });
    for (const key of ['grip', 'wet', 'oil', 'wetLeaves']) expect(sections).not.toContain(`"${key}"`);
  });

  describe('rejects malformed data with an error naming the JSON path', () => {
    it.each([
      'streetLife.horn.radiusM',
      'streetLife.npcRadius',
      'complaints.hornSpam.windowS',
      'complaints.meter.sackedAt',
      'endStates.towedScoreKeep',
    ])('a missing %s', (path) => {
      expect(() => loadTuning(without(path))).toThrow(`tuning: ${path} is missing`);
    });

    it.each(['streetLife', 'complaints', 'endStates'])('a missing top-level %s', (key) => {
      expect(() => loadTuning(without(key))).toThrow(`tuning: root.${key} is missing`);
    });

    it.each([
      ['streetLife.dust.pts', 10, 'must be a negative integer, got 10'],
      ['complaints.zebra.pts', -200.5, 'must be a negative integer, got -200.5'],
      ['streetLife.nearMiss.pts', -25, 'must be an integer >= 1, got -25'],
      ['complaints.meter.sackedAt', 0, 'must be an integer >= 1, got 0'],
      ['endStates.towedScoreKeep', 1.5, 'must be in (0, 1]'],
      ['streetLife.actorHit.minClosingSpeedMps', 0, 'must be > 0'],
    ])('out-of-range %s = %s', (path, value, message) => {
      expect(() => loadTuning(replaced(path, value))).toThrow(`tuning: ${path} ${message}`);
    });

    it('an upgraded value below its base value', () => {
      expect(() => loadTuning(replaced('streetLife.horn.twoToneRadiusM', 6))).toThrow(
        'tuning: streetLife.horn twoToneRadiusM (6) must not be below the base value (8)',
      );
      expect(() => loadTuning(replaced('streetLife.awareness.ledBeaconRadiusM', 5))).toThrow(
        /ledBeaconRadiusM \(5\) must not be below the base value \(6\)/,
      );
      expect(() => loadTuning(replaced('complaints.hornSpam.twoToneMaxHonks', 2))).toThrow(
        /twoToneMaxHonks \(2\) must not be below the base value \(3\)/,
      );
    });

    it('an unknown key in a street-life group', () => {
      expect(() =>
        loadTuning(
          editedObject('streetLife.horn', (o) => {
            o.volumeDb = 90;
          }),
        ),
      ).toThrow('tuning: streetLife.horn has unknown key "volumeDb"');
    });
  });
});

describe('tuning.json under Node type stripping', () => {
  it('loads through src/sim/tuning.ts in plain node (tools/check-type-strip.ts, no tsx)', () => {
    const out = execFileSync(process.execPath, ['tools/check-type-strip.ts'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    expect(out).toContain('tuning.vehicle.sweeper.drive.topSpeedTransitMps=11\n');
    expect(out).toContain(`tuning.vehicle.sweeper.steering.maxSteerRad=${34 * DEG_TO_RAD}\n`);
    expect(out).toContain('entities.litter=15 entities.stains=5 litter.bin_bag.lu=8\n');
  });
});
