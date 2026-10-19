// src/data/tuning.json and its loader src/sim/tuning.ts (SSP-029). The JSON is the source of truth for
// Bessie's handling and GDD §7 mirrors it (CLAUDE.md §2): the tables below quote GDD §7.1, §7.3 and §7.4, and
// the mirror tests read the §7.3 and §7.4 tables out of docs/GDD.md so the two cannot drift apart silently.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import tuningJson from '../../src/data/tuning.json' with { type: 'json' };
import { DEG_TO_RAD } from '../../src/sim/constants.ts';
import { DEFAULT_TUNING, loadTuning, STATIC_PROP_IDS } from '../../src/sim/tuning.ts';

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
    const rowRe = /^\| (\d+)%[^|]*\| ([\d.]+) m\/s² \| ([\d.]+) \/ ([\d.]+) m\/s \| (\d+)°\/s \|$/gm;
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

describe('tuning.json under Node type stripping', () => {
  it('loads through src/sim/tuning.ts in plain node (tools/check-type-strip.ts, no tsx)', () => {
    const out = execFileSync(process.execPath, ['tools/check-type-strip.ts'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    expect(out).toContain('tuning.vehicle.sweeper.drive.topSpeedTransitMps=11\n');
    expect(out).toContain(`tuning.vehicle.sweeper.steering.maxSteerRad=${34 * DEG_TO_RAD}\n`);
  });
});
