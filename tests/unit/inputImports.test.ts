// Import rule for src/input (TECHNICAL_DESIGN §2.1, SSP-044): input code may import other src/input modules
// and, from the sim, only src/sim/inputFrame.ts (the InputFrame type and its bit and range constants). No
// packages (three), no event bus, no render/audio/ui/app code. The scanner is self-tested on fixtures first.
import { readFileSync } from 'node:fs';
import { posix, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { blankComments, listTsFiles } from './simPurityScan.ts';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const INPUT_DIR = 'src/input';
const ALLOWED_SIM_MODULE = 'src/sim/inputFrame.ts';

const STATIC_IMPORT_RE =
  /\b(?:import|export)\b\s*(?:type\b\s*)?(?:[\w$*{}\s,]*?\s*\bfrom\s*)?(['"])([^'"\n]*)\1/g;
const DYNAMIC_RE = /\bimport\s*\(|\brequire\s*\(/g;

/** Returns one message per import in `source` (a file under src/input) that breaks the rule. */
function scanInputSource(file: string, source: string): string[] {
  const code = blankComments(source);
  const problems: string[] = [];
  for (const match of code.matchAll(STATIC_IMPORT_RE)) {
    const specifier = match[2] ?? '';
    if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
      problems.push(`${file}: imports package '${specifier}'`);
      continue;
    }
    const resolved = posix.normalize(posix.join(posix.dirname(file), specifier));
    if (resolved.startsWith(`${INPUT_DIR}/`) || resolved === ALLOWED_SIM_MODULE) continue;
    problems.push(
      `${file}: imports '${specifier}' (${resolved}); src/input may import only ${ALLOWED_SIM_MODULE}`,
    );
  }
  for (const match of code.matchAll(DYNAMIC_RE))
    problems.push(`${file}: dynamic import or require (${match[0]})`);
  return problems;
}

describe('src/input import scanner self-tests', () => {
  const file = 'src/input/fixture.ts';

  it.each([
    ["import { Vector3 } from 'three';"],
    ["import type { EventBus } from '../app/events.ts';"],
    ["import { EV } from '../sim/eventQueue.ts';"],
    ["import { DT_S } from '../sim/constants.ts';"],
    ["import { draw } from '../render/Renderer.ts';"],
    ["export * from '../ui/hud.ts';"],
    ["import { x } from './../sim/../app/Game.ts';"],
    ["const m = await import('./keyboard.ts');"],
  ])('flags %s', (source) => {
    expect(scanInputSource(file, source)).not.toEqual([]);
  });

  it.each([
    ["import type { InputFrame } from '../sim/inputFrame.ts';"],
    ["import { BUTTON, PRESSED } from '../sim/inputFrame.ts';"],
    ["import { ACTION } from './actions.ts';"],
    ["// import { Vector3 } from 'three';"],
  ])('accepts %s', (source) => {
    expect(scanInputSource(file, source)).toEqual([]);
  });
});

describe('src/input', () => {
  it('imports only src/input/** and src/sim/inputFrame.ts', () => {
    const files = listTsFiles(`${REPO_ROOT}${INPUT_DIR}`);
    const names = files.map((f) => posix.basename(f.replaceAll('\\', '/'))).sort();
    expect(names).toEqual(expect.arrayContaining(['actions.ts', 'gamepad.ts', 'keyboard.ts']));
    const problems = files.flatMap((full) => {
      const rel = relative(REPO_ROOT, full).split(sep).join('/');
      return scanInputSource(rel, readFileSync(full, 'utf8'));
    });
    expect(problems).toEqual([]);
  });
});
