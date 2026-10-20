// Import rule for src/ui (TECHNICAL_DESIGN §2.1, SSP-069): UI code may import other src/ui modules,
// src/render/spriteBatch.ts (the UI pass batch), src/gen/assets.ts (frame IDs), src/sim/** (read-only state and
// types) and src/app/events.ts. No packages (three.js comes only through spriteBatch.ts), no other render module,
// no audio, input, scenes, debug or other app code. The scanner is self-tested on fixtures first.
import { readFileSync } from 'node:fs';
import { posix, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { blankComments, listTsFiles } from './simPurityScan.ts';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const UI_DIR = 'src/ui';
const ALLOWED_MODULES = ['src/render/spriteBatch.ts', 'src/gen/assets.ts', 'src/app/events.ts'];
const ALLOWED_TREES = [`${UI_DIR}/`, 'src/sim/'];

const STATIC_IMPORT_RE =
  /\b(?:import|export)\b\s*(?:type\b\s*)?(?:[\w$*{}\s,]*?\s*\bfrom\s*)?(['"])([^'"\n]*)\1/g;
const DYNAMIC_RE = /\bimport\s*\(|\brequire\s*\(/g;

/** Returns one message per import in `source` (a file under src/ui) that breaks the rule. */
function scanUiSource(file: string, source: string): string[] {
  const code = blankComments(source);
  const problems: string[] = [];
  for (const match of code.matchAll(STATIC_IMPORT_RE)) {
    const specifier = match[2] ?? '';
    if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
      problems.push(`${file}: imports package '${specifier}'`);
      continue;
    }
    const resolved = posix.normalize(posix.join(posix.dirname(file), specifier));
    if (ALLOWED_MODULES.includes(resolved) || ALLOWED_TREES.some((tree) => resolved.startsWith(tree)))
      continue;
    problems.push(`${file}: imports '${specifier}' (${resolved}); see TECHNICAL_DESIGN §2.1`);
  }
  for (const match of code.matchAll(DYNAMIC_RE))
    problems.push(`${file}: dynamic import or require (${match[0]})`);
  return problems;
}

describe('src/ui import scanner self-tests', () => {
  const file = 'src/ui/fixture.ts';

  it.each([
    ["import { Vector3 } from 'three';"],
    ["import { Renderer } from '../render/Renderer.ts';"],
    ["import { KERBSIDE32 } from '../render/palettePass.ts';"],
    ["import { Game } from '../app/Game.ts';"],
    ["import { ShiftScene } from '../scenes/ShiftScene.ts';"],
    ["import { keys } from '../input/keyboard.ts';"],
    ["const m = await import('./hud.ts');"],
  ])('flags %s', (source) => {
    expect(scanUiSource(file, source)).not.toEqual([]);
  });

  it.each([
    ["import { UiSpriteBatch } from '../render/spriteBatch.ts';"],
    ["import { FRAME, type FrameId } from '../gen/assets.ts';"],
    ["import type { EventBus } from '../app/events.ts';"],
    ["import type { WorldView } from '../sim/world.ts';"],
    ["import { BitmapFont } from './bitmapText.ts';"],
    ["// import { Vector3 } from 'three';"],
  ])('accepts %s', (source) => {
    expect(scanUiSource(file, source)).toEqual([]);
  });
});

describe('src/ui', () => {
  it('imports only what TECHNICAL_DESIGN §2.1 allows', () => {
    const files = listTsFiles(`${REPO_ROOT}${UI_DIR}`);
    const names = files.map((f) => posix.basename(f.replaceAll('\\', '/'))).sort();
    expect(names).toEqual(expect.arrayContaining(['bitmapText.ts', 'panels.ts']));
    const problems = files.flatMap((full) => {
      const rel = relative(REPO_ROOT, full).split(sep).join('/');
      return scanUiSource(rel, readFileSync(full, 'utf8'));
    });
    expect(problems).toEqual([]);
  });
});

// SSP-288's grep check: nothing under src/ui imports the render camera (the composition root injects the projection)
// or writes sim state through the World and its stores (TECHNICAL_DESIGN §2.1, CLAUDE.md hard rule 2). The mutation
// scan flags assignments, compound assignments and ++/-- whose target is reached through a sim-state name.
const CAMERA_IMPORT_RE = /\bfrom\s*(['"])[^'"\n]*render\/camera(?:\.ts)?\1/;
const SIM_WRITE_RE =
  /\b(?:world|view|sim|npc|vehicles|vehicle|scoring|litter|stains|complaints|penalties)\.[\w$.]+(?:\[[^\]\n]*\])?\s*(?:[-+*/%&|^]?=(?!=)|\+\+|--)/;

/** One message per line of `source` that imports camera.ts or writes sim state. */
function scanUiWrites(file: string, source: string): string[] {
  const code = blankComments(source);
  const problems: string[] = [];
  code.split('\n').forEach((line, n) => {
    if (CAMERA_IMPORT_RE.test(line)) problems.push(`${file}:${n + 1}: imports render/camera.ts`);
    if (SIM_WRITE_RE.test(line)) problems.push(`${file}:${n + 1}: writes sim state: ${line.trim()}`);
  });
  return problems;
}

describe('src/ui never imports render/camera.ts or writes sim state (SSP-288)', () => {
  it.each([
    ["import { groundPxPerMetre } from '../render/camera.ts';"],
    ['world.vehicle.hp = 0;'],
    ['view.npc.x[i] += 1;'],
    ['world.tick++;'],
    ['npc.state[i] = 3;'],
  ])('self-test: flags %s', (source) => {
    expect(scanUiWrites('src/ui/fixture.ts', source)).not.toEqual([]);
  });

  it.each([
    ['const x = world.npc.x[i] ?? 0;'],
    ['if (view.tick === 3) return;'],
    ['bubbles.xM[s] = px + (npc.x[i] - px) * alpha;'],
    ['// world.tick = 0'],
  ])('self-test: accepts %s', (source) => {
    expect(scanUiWrites('src/ui/fixture.ts', source)).toEqual([]);
  });

  it('holds for every file under src/ui', () => {
    const files = listTsFiles(`${REPO_ROOT}${UI_DIR}`);
    expect(files.map((f) => posix.basename(f.replaceAll('\\', '/')))).toContain('popups.ts');
    const problems = files.flatMap((full) => {
      const rel = relative(REPO_ROOT, full).split(sep).join('/');
      return scanUiWrites(rel, readFileSync(full, 'utf8'));
    });
    expect(problems).toEqual([]);
  });
});
