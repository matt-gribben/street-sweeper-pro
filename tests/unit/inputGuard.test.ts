// M0 input-count guards for the audio and level tools (SSP-006 decision (a), ASSET_PIPELINE §5.2).
// The helper is tested against temporary source trees; the three real tools are then spawned on plain Node
// type stripping and must agree with whatever sources the repo actually holds.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  EXIT_NOT_IMPLEMENTED,
  EXIT_USAGE,
  type InputGuardIo,
  type InputGuardSpec,
  listSources,
  parseGuardArgs,
  runInputGuard,
} from '../../tools/inputGuard.ts';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

const LEVELS: InputGuardSpec = {
  tool: 'compile-level',
  sourceDir: 'assets-src/levels',
  suffix: '.map.txt',
  notImplementedUntil: 'M1',
};

const tempRoots: string[] = [];

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'ssp-input-guard-'));
  tempRoots.push(root);
  return root;
}

function touch(root: string, relPath: string): void {
  const full = join(root, relPath);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, '');
}

function capture(): { lines: string[]; errors: string[]; io: InputGuardIo } {
  const lines: string[] = [];
  const errors: string[] = [];
  return { lines, errors, io: { log: (l) => lines.push(l), error: (l) => errors.push(l) } };
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('parseGuardArgs', () => {
  it('accepts no arguments', () => {
    expect(parseGuardArgs([])).toEqual({ outDir: null });
  });

  it('accepts --out <dir> and --out=<dir>', () => {
    expect(parseGuardArgs(['--out', 'build/tmp/verify'])).toEqual({ outDir: 'build/tmp/verify' });
    expect(parseGuardArgs(['--out=build/tmp/verify'])).toEqual({ outDir: 'build/tmp/verify' });
  });

  it.each([[['--out']], [['--out=']], [['--out', '--verbose']], [['--bogus']], [['levels.map.txt']]])(
    'rejects %j',
    (argv) => {
      expect(parseGuardArgs(argv)).toHaveProperty('error');
    },
  );
});

describe('listSources', () => {
  it('treats a missing source directory as zero sources', () => {
    expect(listSources(tempRoot(), LEVELS)).toEqual([]);
  });

  it('matches the suffix only, skips dotfiles and subdirectories, and sorts', () => {
    const root = tempRoot();
    touch(root, 'assets-src/levels/puddle_lane.map.txt');
    touch(root, 'assets-src/levels/kebab_mile.map.txt');
    touch(root, 'assets-src/levels/puddle_lane.level.json');
    touch(root, 'assets-src/levels/.hidden.map.txt');
    touch(root, 'assets-src/levels/nested/deep.map.txt');
    mkdirSync(join(root, 'assets-src/levels/dir.map.txt'));
    expect(listSources(root, LEVELS)).toEqual([
      join(root, 'assets-src/levels/kebab_mile.map.txt'),
      join(root, 'assets-src/levels/puddle_lane.map.txt'),
    ]);
  });
});

describe('runInputGuard', () => {
  it('logs "0 sources" and exits 0 when there is nothing to render', () => {
    const root = tempRoot();
    mkdirSync(join(root, 'assets-src/levels'), { recursive: true });
    const out = capture();
    expect(runInputGuard(LEVELS, root, ['--out', 'build/tmp/verify'], out.io)).toBe(0);
    expect(out.lines.join('\n')).toContain('0 sources; nothing to render');
    expect(out.errors).toEqual([]);
  });

  it('exits non-zero with "not implemented until M1" when a source exists', () => {
    const root = tempRoot();
    touch(root, 'assets-src/levels/dummy.map.txt');
    const out = capture();
    expect(runInputGuard(LEVELS, root, [], out.io)).toBe(EXIT_NOT_IMPLEMENTED);
    const stderr = out.errors.join('\n');
    expect(stderr).toContain('not implemented until M1');
    expect(stderr).toContain('assets-src/levels/dummy.map.txt');
    expect(out.lines).toEqual([]);
  });

  it('exits with the usage status on a bad argument, before looking at sources', () => {
    const out = capture();
    expect(runInputGuard(LEVELS, tempRoot(), ['--bogus'], out.io)).toBe(EXIT_USAGE);
    expect(out.errors.join('\n')).toContain('unrecognised argument: --bogus');
  });
});

describe('the real tools on Node type stripping', () => {
  const tools = [
    { script: 'tools/audio/render-sfx.ts', dir: 'assets-src/audio/sfx', suffix: '.json', until: 'M5' },
    {
      script: 'tools/audio/render-music.ts',
      dir: 'assets-src/audio/music',
      suffix: '.song.json',
      until: 'M5',
    },
    { script: 'tools/levels/compile-level.ts', dir: 'assets-src/levels', suffix: '.map.txt', until: 'M1' },
  ] as const;

  it.each(tools)('$script agrees with the sources in the repo', ({ script, dir, suffix, until }) => {
    const spec: InputGuardSpec = { tool: script, sourceDir: dir, suffix, notImplementedUntil: until };
    const sourceCount = listSources(REPO_ROOT, spec).length;
    const result = spawnSync(process.execPath, [script, '--out', 'build/tmp/verify'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    expect(result.error).toBeUndefined();
    if (sourceCount === 0) {
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain('0 sources; nothing to render');
    } else {
      expect(result.status).toBe(EXIT_NOT_IMPLEMENTED);
      expect(result.stderr).toContain(`not implemented until ${until}`);
    }
  });
});
