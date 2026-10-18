// Sim purity scan (CLAUDE.md hard rule 1, TECHNICAL_DESIGN §18.1). Scans every .ts file under src/sim/
// and fails on three/DOM/package imports, imports from outside src/sim and src/data (except
// `import type` from src/gen/assets.ts), and on Math.random, Date or performance. The scanner itself is
// self-tested on fixture strings below, so a broken scanner cannot make the real scan pass.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { blankComments, type PurityRule, scanSimSource, scanSimTree } from './simPurityScan.ts';

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
    ['tuning JSON from src/data', "import tuning from '../data/tuning.json' with { type: 'json' };"],
    ['identifiers that merely contain the words', 'const updatedAt = 0; const performanceScore = 1;'],
    ['Math functions other than random', 'const y = Math.sin(1) + Math.randomish;'],
    [
      'the words in comments',
      '// no Date, performance or Math.random here\n/* nor three */ export const A = 1;',
    ],
    ['a division that looks like a regex start', 'const half = total / 2; const q = (a) / b / c;'],
  ])('passes %s', (_name, source) => {
    expect(scanSimSource(FIXTURE_FILE, source)).toEqual([]);
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
});

describe('simPurity: src/sim in this repo', () => {
  it('scans at least src/sim/constants.ts and finds no violations', () => {
    const scan = scanSimTree(REPO_ROOT);
    expect(scan.files).toContain('src/sim/constants.ts');
    expect(scan.violations).toEqual([]);
  });
});
