// Sim purity scan (CLAUDE.md hard rule 1, TECHNICAL_DESIGN §18.1). Scans every .ts file under src/sim/
// and fails on three/DOM/package imports, imports from outside src/sim and src/data (except
// `import type` from src/gen/assets.ts), on Math.random, Date or performance, and on direct calls to
// Math.sin/cos/tan/atan2/exp/sqrt/hypot anywhere but src/sim/fmath.ts (§7.4). The scanner itself is
// self-tested on fixture strings below, so a broken scanner cannot make the real scan pass.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  blankComments,
  DATA_GATEWAY_FILE,
  FMATH_FILE,
  FMATH_FUNCTIONS,
  type PurityRule,
  scanSimSource,
  scanSimTree,
} from './simPurityScan.ts';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const FIXTURE_FILE = 'src/sim/fixture.ts';

function rulesFor(source: string, file = FIXTURE_FILE): PurityRule[] {
  return scanSimSource(file, source).map((v) => v.rule);
}

describe('simPurity scanner self-tests (in-memory fixtures)', () => {
  it.each([
    ['Math.random()', 'const r = Math.random();'],
    ['performance.now()', 'const t = performance.now();'],
    ['new Date()', 'const d = new Date();'],
    ['Date.now()', 'const ms = Date.now();'],
    ['Math.random passed by reference', 'const pick = Math.random;'],
    ['Date inside a string', "const s = 'Date';"],
  ])('flags %s', (_name, source) => {
    expect(rulesFor(source)).toContain('forbidden-token');
  });

  it.each([
    ['default import of three', "import x from 'three';", 'three-import'],
    ['namespace import of three', "import * as THREE from 'three';", 'three-import'],
    ['type-only import of three', "import type { Vector3 } from 'three';", 'three-import'],
    [
      'three addon',
      "import { OrbitControls } from 'three/addons/controls/OrbitControls.js';",
      'three-import',
    ],
    ['side-effect import of three', "import 'three';", 'three-import'],
    ['re-export from three', "export { Vector3 } from 'three';", 'three-import'],
    ['src/render', "import { a } from '../render/x.ts';", 'outside-sim-import'],
    ['src/app', "import { emit } from '../app/events.ts';", 'outside-sim-import'],
    ['src/audio', "import { play } from '../audio/sfx.ts';", 'outside-sim-import'],
    ['src/ui', "import { hud } from '../ui/hud.ts';", 'outside-sim-import'],
    ['src/input', "import type { Keys } from '../input/keyboard.ts';", 'outside-sim-import'],
    ['src/debug', "import { hooks } from '../debug/testHooks.ts';", 'outside-sim-import'],
    [
      'escaping src/sim via a deep path',
      "import { x } from './npc/../../render/x.ts';",
      'outside-sim-import',
    ],
    [
      'a value import from src/gen/assets.ts',
      "import { FRAME } from '../gen/assets.ts';",
      'gen-value-import',
    ],
    [
      'inline type modifiers from src/gen/assets.ts (kept as a runtime import under verbatimModuleSyntax)',
      "import { type FrameId } from '../gen/assets.ts';",
      'gen-value-import',
    ],
    ['a Node built-in', "import { readFileSync } from 'node:fs';", 'package-import'],
    ['a DOM-facing package', "import { createApp } from 'vite';", 'package-import'],
    ['an absolute path', "import { x } from '/src/render/x.ts';", 'package-import'],
    ['dynamic import()', "const m = await import('./vehicle.ts');", 'dynamic-import'],
    ['require()', "const fs = require('node:fs');", 'require'],
    ['import.meta', 'const dev = import.meta.env.DEV;', 'import-meta'],
  ])('flags %s', (_name, source, rule) => {
    expect(rulesFor(source)).toContain(rule);
  });

  it('flags multi-line import lists', () => {
    const source = "import {\n  WebGLRenderer,\n  Scene,\n} from 'three';\n";
    expect(scanSimSource(FIXTURE_FILE, source)).toEqual([
      expect.objectContaining({ line: 1, rule: 'three-import' }),
    ]);
  });

  it('flags code that follows a string containing comment markers', () => {
    expect(rulesFor("const url = 'http://example'; const r = Math.random();")).toContain('forbidden-token');
    expect(rulesFor('const s = "/* not a comment"; const t = Date.now(); // */')).toContain(
      'forbidden-token',
    );
  });

  it('flags code inside template literal expressions and after regex literals', () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the fixture is TS source text that must contain a template placeholder.
    expect(rulesFor('const s = `seed ${Math.random()}`;')).toContain('forbidden-token');
    // Code after a template literal with a nested object in its placeholder is still scanned.
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the fixture is TS source text that must contain a template placeholder.
    expect(rulesFor('const s = `a ${ { b: 1 }.b } // c`; const t = Date.now();')).toContain(
      'forbidden-token',
    );
    expect(rulesFor('const re = /[/*]/; const t = performance.now(); // */')).toContain('forbidden-token');
  });

  it('reports the line of each violation', () => {
    const source = "export const A = 1;\n\nimport x from 'three';\nconst t = Date.now();\n";
    expect(scanSimSource(FIXTURE_FILE, source).map((v) => [v.line, v.rule])).toEqual([
      [3, 'three-import'],
      [4, 'forbidden-token'],
    ]);
  });

  it.each([
    ['a type-only import from src/gen/assets.ts', "import type { FrameId } from '../gen/assets.ts';"],
    ['a type-only re-export from src/gen/assets.ts', "export type { FrameId } from '../gen/assets.ts';"],
    ['a sibling sim module', "import { sfc32 } from './rng.ts';"],
    ['a nested sim module', "import { sat } from './collision/sat.ts';"],
    ['identifiers that merely contain the words', 'const updatedAt = 0; const performanceScore = 1;'],
    [
      'exact Math functions and look-alike names',
      'const y = Math.floor(1.5) + Math.abs(-1) + Math.randomish + Math.sinh2 + Math.expo + mySin(1);',
    ],
    ['fmath calls', "import { sin, sqrt } from './fmath.ts'; const y = sin(1) + sqrt(2);"],
    [
      'the words in comments',
      '// no Date, performance or Math.random here\n/* nor three */ export const A = 1;',
    ],
    ['a division that looks like a regex start', 'const half = total / 2; const q = (a) / b / c;'],
  ])('passes %s', (_name, source) => {
    expect(scanSimSource(FIXTURE_FILE, source)).toEqual([]);
  });

  it.each([
    ['Math.sin()', 'const y = Math.sin(1);'],
    ['Math.cos()', 'const y = Math.cos(1);'],
    ['Math.tan()', 'const y = Math.tan(1);'],
    ['Math.atan2()', 'const y = Math.atan2(1, 2);'],
    ['Math.exp()', 'const y = Math.exp(1);'],
    ['Math.sqrt()', 'const y = Math.sqrt(2);'],
    ['Math.hypot()', 'const y = Math.hypot(3, 4);'],
    ['Math.sqrt passed by reference', 'const root = Math.sqrt;'],
    ['whitespace around the dot', 'const y = Math . exp(1);'],
    ['bracket access', "const y = Math['atan2'](1, 2);"],
  ])('flags %s outside fmath.ts', (_name, source) => {
    expect(rulesFor(source)).toEqual(['raw-transcendental']);
    expect(rulesFor(source, 'src/sim/npc/steering.ts')).toEqual(['raw-transcendental']);
  });

  it('lets src/sim/fmath.ts, and only that file, call the transcendentals on Math', () => {
    const source = 'export function sin(x: number): number {\n  return Math.sin(x);\n}\n';
    expect(rulesFor(source, FMATH_FILE)).toEqual([]);
    expect(rulesFor(source, 'src/sim/fmath2.ts')).toEqual(['raw-transcendental']);
    expect(rulesFor(source, 'src/sim/npc/fmath.ts')).toEqual(['raw-transcendental']);
    // The exemption covers only the transcendentals: fmath.ts is still held to every other rule.
    expect(rulesFor('const r = Math.random();', FMATH_FILE)).toEqual(['forbidden-token']);
  });

  it('covers exactly the fmath functions named in TECHNICAL_DESIGN §7.4 plus tan', () => {
    expect([...FMATH_FUNCTIONS]).toEqual(['sin', 'cos', 'tan', 'atan2', 'exp', 'sqrt', 'hypot']);
  });

  it('resolves imports relative to nested files', () => {
    expect(
      rulesFor("import type { FrameId } from '../../gen/assets.ts';", 'src/sim/npc/steering.ts'),
    ).toEqual([]);
    expect(rulesFor("import { DT_S } from '../constants.ts';", 'src/sim/npc/steering.ts')).toEqual([]);
    expect(rulesFor("import { a } from '../render/x.ts';", 'src/sim/npc/steering.ts')).toEqual([]);
    expect(rulesFor("import { a } from '../../render/x.ts';", 'src/sim/npc/steering.ts')).toEqual([
      'outside-sim-import',
    ]);
  });

  it('lets only src/sim/tuning.ts import src/data/ (TECHNICAL_DESIGN §2.1)', () => {
    const source = "import tuningJson from '../data/tuning.json' with { type: 'json' };";
    expect(rulesFor(source, DATA_GATEWAY_FILE)).toEqual([]);
    expect(rulesFor(source, 'src/sim/vehicle.ts')).toEqual(['data-import-outside-tuning']);
    expect(rulesFor(source)).toEqual(['data-import-outside-tuning']);
    expect(
      rulesFor("import e from '../../data/entities.json' with { type: 'json' };", 'src/sim/npc/steering.ts'),
    ).toEqual(['data-import-outside-tuning']);
    // Type-only imports of the JSON count too: other sim files take their numbers through the Tuning type.
    expect(rulesFor("import type t from '../data/tuning.json';", 'src/sim/world.ts')).toEqual([
      'data-import-outside-tuning',
    ]);
  });

  it('blanks comments without changing length or line structure', () => {
    const source = "const a = 1; // Date\n/* performance\n */ const b = '//keep';";
    const blanked = blankComments(source);
    expect(blanked).toHaveLength(source.length);
    expect(blanked.split('\n')).toHaveLength(source.split('\n').length);
    expect(blanked).not.toMatch(/Date|performance/);
    expect(blanked).toContain("'//keep'");
  });
});

describe('simPurity tree scan guards', () => {
  const temps: string[] = [];
  afterEach(() => {
    for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
  const makeTemp = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'ssp-sim-purity-'));
    temps.push(dir);
    return dir;
  };

  it('fails when src/sim is an empty directory', () => {
    const root = makeTemp();
    mkdirSync(join(root, 'src', 'sim'), { recursive: true });
    expect(() => scanSimTree(root)).toThrow(/no \.ts files/);
  });

  it('fails when src/sim holds no .ts files', () => {
    const root = makeTemp();
    mkdirSync(join(root, 'src', 'sim'), { recursive: true });
    writeFileSync(join(root, 'src', 'sim', 'notes.md'), 'not code');
    expect(() => scanSimTree(root)).toThrow(/no \.ts files/);
  });

  it('fails when src/sim is missing or unreadable', () => {
    expect(() => scanSimTree(makeTemp())).toThrow(/cannot read src\/sim/);
  });

  it('finds violations in nested files on disk', () => {
    const root = makeTemp();
    mkdirSync(join(root, 'src', 'sim', 'npc'), { recursive: true });
    writeFileSync(join(root, 'src', 'sim', 'ok.ts'), 'export const A = 1;\n');
    writeFileSync(join(root, 'src', 'sim', 'npc', 'bad.ts'), 'export const R = Math.random();\n');
    const scan = scanSimTree(root);
    expect(scan.files).toEqual(['src/sim/npc/bad.ts', 'src/sim/ok.ts']);
    expect(scan.violations).toEqual([
      expect.objectContaining({ file: 'src/sim/npc/bad.ts', line: 1, rule: 'forbidden-token' }),
    ]);
  });

  it('flags raw transcendentals on disk everywhere except src/sim/fmath.ts', () => {
    const root = makeTemp();
    mkdirSync(join(root, 'src', 'sim'), { recursive: true });
    writeFileSync(join(root, 'src', 'sim', 'fmath.ts'), 'export const s = (x: number) => Math.sin(x);\n');
    writeFileSync(join(root, 'src', 'sim', 'vehicle.ts'), 'export const t = (x: number) => Math.tan(x);\n');
    const scan = scanSimTree(root);
    expect(scan.violations).toEqual([
      expect.objectContaining({ file: 'src/sim/vehicle.ts', line: 1, rule: 'raw-transcendental' }),
    ]);
  });
});

describe('simPurity: src/sim in this repo', () => {
  it('scans the sim foundation files and finds no violations', () => {
    const scan = scanSimTree(REPO_ROOT);
    expect(scan.files).toEqual(
      expect.arrayContaining([
        'src/sim/constants.ts',
        'src/sim/coords.ts',
        FMATH_FILE,
        'src/sim/inputFrame.ts',
        'src/sim/rng.ts',
        DATA_GATEWAY_FILE,
      ]),
    );
    expect(scan.violations).toEqual([]);
  });
});
