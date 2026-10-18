// npm scripts, Playwright projects and CI wiring (SSP-006; TECHNICAL_DESIGN §19, §20.1; ASSET_PIPELINE §5.2).
// Keeps package.json in step with the command tables in the docs and guards the "gpu never runs in CI" rule.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import pkg from '../../package.json' with { type: 'json' };
import playwrightConfig, { SWIFTSHADER_ARGS } from '../../playwright.config.ts';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const scripts: Record<string, string> = pkg.scripts;

function readRepoFile(relPath: string): string {
  return readFileSync(`${REPO_ROOT}${relPath}`, 'utf8');
}

/** Every script in the TECHNICAL_DESIGN §20.1 table (which defers the asset rows to ASSET_PIPELINE §5.2). */
const TECHNICAL_DESIGN_SCRIPTS = [
  'dev',
  'build',
  'preview',
  'typecheck',
  'lint',
  'format',
  'test',
  'test:replay',
  'test:visual',
  'test:visual:update',
  'test:e2e',
  'assets',
  'assets:verify',
  'assets:lint',
  'assets:sheets',
  'assets:ingest',
  'assets:blender',
  'gen:ai',
  'audio',
  'levels',
  'ci',
] as const;

const DOCS_WITH_COMMANDS = [
  'README.md',
  'CLAUDE.md',
  'docs/TECHNICAL_DESIGN.md',
  'docs/ASSET_PIPELINE.md',
  'docs/AUDIO_DESIGN.md',
  'docs/LEVEL_DESIGN.md',
  'docs/ROADMAP.md',
] as const;

/** The jsonc block under ASSET_PIPELINE "### 5.2 `package.json` scripts", parsed. */
function assetPipelineScripts(): Record<string, string> {
  const doc = readRepoFile('docs/ASSET_PIPELINE.md');
  const section = doc.slice(doc.indexOf('### 5.2 `package.json` scripts'));
  const match = /```jsonc\n([\s\S]*?)\n```/.exec(section);
  if (match === null || match[1] === undefined) throw new Error('ASSET_PIPELINE §5.2 jsonc block not found');
  const parsed: unknown = JSON.parse(match[1]);
  if (typeof parsed !== 'object' || parsed === null || !('scripts' in parsed)) {
    throw new Error('ASSET_PIPELINE §5.2 block has no "scripts" object');
  }
  return parsed.scripts as Record<string, string>;
}

function runnerScriptNames(): string[] {
  return ['test', 'test:replay', 'test:visual', 'test:visual:update', 'test:e2e', 'ci'];
}

describe('package.json scripts', () => {
  it.each(TECHNICAL_DESIGN_SCRIPTS)('defines "%s"', (name) => {
    expect(scripts[name], `missing npm script "${name}"`).toBeTypeOf('string');
  });

  it('defines every `npm run <script>` the docs mention', () => {
    const missing = new Set<string>();
    for (const doc of DOCS_WITH_COMMANDS) {
      for (const m of readRepoFile(doc).matchAll(/npm run ([a-z][a-z0-9:-]*[a-z0-9])/g)) {
        const name = m[1] as string;
        if (scripts[name] === undefined) missing.add(`${name} (${doc})`);
      }
    }
    expect([...missing]).toEqual([]);
  });

  it('matches the asset scripts in ASSET_PIPELINE §5.2 exactly', () => {
    for (const [name, command] of Object.entries(assetPipelineScripts())) {
      expect(scripts[name], name).toBe(command);
    }
  });

  it('runs the documented Vitest projects', () => {
    expect(scripts.test).toBe('vitest run --project unit --project property');
    expect(scripts['test:replay']).toBe('vitest run --project replay');
  });

  it('never hides an empty suite behind a pass-with-no-tests flag', () => {
    for (const name of runnerScriptNames()) {
      expect(scripts[name], name).not.toMatch(/pass-?with-?no-?tests/i);
    }
  });

  it('runs Playwright e2e through the ci project only, never gpu', () => {
    expect(scripts['test:e2e']).toBe('playwright test --project=ci');
    expect(scripts['test:visual']).toBe('playwright test --project=visual');
    expect(scripts['test:visual:update']).toContain('--project=visual');
    expect(scripts['test:visual:update']).toContain('--update-snapshots');
    for (const [name, command] of Object.entries(scripts)) {
      expect(command, name).not.toMatch(/project[= ]gpu/);
    }
  });

  it('makes `npm run ci` cover both CI jobs plus assets:verify and assets:lint (local parity)', () => {
    const steps = (scripts.ci ?? '').split('&&').map((s) => s.trim());
    expect(steps).toEqual([
      'npm run typecheck',
      'npm run lint',
      'npm test',
      'npm run test:replay',
      'npm run assets:verify',
      'npm run assets:lint',
      'npm run test:visual',
      'npm run test:e2e',
    ]);
  });
});

describe('playwright.config.ts', () => {
  const projects = playwrightConfig.projects ?? [];
  const project = (name: string) => {
    const found = projects.find((p) => p.name === name);
    if (found === undefined) throw new Error(`no Playwright project "${name}"`);
    return found;
  };
  const argsOf = (name: string): readonly string[] => project(name).use?.launchOptions?.args ?? [];

  it('defines exactly the visual, ci and gpu projects, all Chromium', () => {
    expect(projects.map((p) => p.name)).toEqual(['visual', 'ci', 'gpu']);
    for (const p of projects) expect(p.use?.browserName, p.name).toBe('chromium');
  });

  it('runs visual headless on SwiftShader at 1920x1080 from tests/visual', () => {
    const visual = project('visual');
    expect(visual.testDir).toBe('tests/visual');
    expect(visual.use?.headless).toBe(true);
    expect(visual.use?.viewport).toEqual({ width: 1920, height: 1080 });
    expect(visual.use?.deviceScaleFactor).toBe(1);
    expect(argsOf('visual')).toEqual([...SWIFTSHADER_ARGS]);
  });

  it('runs ci on the same SwiftShader flags from tests/e2e', () => {
    expect(project('ci').testDir).toBe('tests/e2e');
    expect(project('ci').use?.headless).toBe(true);
    expect(argsOf('ci')).toEqual([...SWIFTSHADER_ARGS]);
  });

  it('runs gpu headed with no SwiftShader flag', () => {
    expect(project('gpu').testDir).toBe('tests/e2e');
    expect(project('gpu').use?.headless).toBe(false);
    expect(argsOf('gpu').join(' ')).not.toMatch(/swiftshader/i);
  });

  it('serves the production build through vite preview on 4173', () => {
    const server = playwrightConfig.webServer;
    expect(Array.isArray(server)).toBe(false);
    expect(server && !Array.isArray(server) ? server.command : undefined).toBe(
      'npm run build && npx vite preview --port 4173 --strictPort',
    );
  });
});

describe('.github/workflows/ci.yml', () => {
  const workflow = readRepoFile('.github/workflows/ci.yml');

  it('has the checks (ubuntu-latest) and visual (macos-latest) jobs', () => {
    expect(workflow).toMatch(/^ {2}checks:\n(?: {4}.*\n)*? {4}runs-on: ubuntu-latest$/m);
    expect(workflow).toMatch(/^ {2}visual:\n(?: {4}.*\n)*? {4}runs-on: macos-latest$/m);
  });

  it('runs the checks steps in order', () => {
    const order = [
      'actions/checkout@',
      'actions/setup-node@',
      'node-version: 24.21.0',
      'cache: npm',
      'run: npm ci',
      'run: npm run typecheck',
      'run: npm run lint',
      'run: npm test',
      'run: npm run test:replay',
    ];
    const checks = workflow.slice(workflow.indexOf('\n  checks:'), workflow.indexOf('\n  visual:'));
    let at = -1;
    for (const needle of order) {
      const next = checks.indexOf(needle, at + 1);
      expect(next, `checks job: "${needle}" missing or out of order`).toBeGreaterThan(at);
      at = next;
    }
  });

  it('runs the visual steps in order and uploads artefacts on failure', () => {
    const order = [
      'actions/checkout@',
      'actions/setup-node@',
      'run: npm ci',
      `key: playwright-\${{ runner.os }}-\${{ runner.arch }}-${pkg.devDependencies['@playwright/test']}`,
      'run: npx playwright install chromium',
      'run: npm run test:visual',
      'run: npm run test:e2e',
      'if: failure()',
      'actions/upload-artifact@',
      'test-results/',
      'playwright-report/',
    ];
    const visual = workflow.slice(workflow.indexOf('\n  visual:'));
    let at = -1;
    for (const needle of order) {
      const next = visual.indexOf(needle, at + 1);
      expect(next, `visual job: "${needle}" missing or out of order`).toBeGreaterThan(at);
      at = next;
    }
  });

  it('never invokes the gpu project', () => {
    expect(workflow).not.toMatch(/gpu/i);
  });
});
