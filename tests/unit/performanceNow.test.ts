// performance.now() is read only by the loop (TECHNICAL_DESIGN §5.1, SSP-043): src/app/loop.ts is the one
// module outside src/debug that may touch `performance`, so frame timing has one owner and nothing else can
// make behaviour depend on wall-clock time. (src/sim bans `performance` outright: simPurity.test.ts.)
import { readFileSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { blankComments, listTsFiles } from './simPurityScan.ts';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** The files allowed to read the clock: the loop, and everything under src/debug. */
const ALLOWED_FILE = 'src/app/loop.ts';
const ALLOWED_PREFIX = 'src/debug/';

/**
 * Any use of the `performance` global (performance.now(), performance['now'], window.performance, a stored
 * reference). Hyphenated words such as WebGL's `'high-performance'` power preference are not the global.
 */
const PERFORMANCE_RE = /(?<![\w$-])performance(?![\w$-])/g;

/** Lines (1-based) of `source` that use `performance` in code, comments ignored. */
function performanceLines(source: string): number[] {
  const code = blankComments(source);
  const lines: number[] = [];
  for (const match of code.matchAll(PERFORMANCE_RE)) {
    lines.push(code.slice(0, match.index).split('\n').length);
  }
  return lines;
}

describe('performance.now() ownership', () => {
  it('the matcher sees code uses and ignores comments', () => {
    expect(performanceLines('const t = performance.now();')).toEqual([1]);
    expect(performanceLines('// performance.now()\nconst p = performance;\n')).toEqual([2]);
    expect(performanceLines('/* performance */ const x = 1;')).toEqual([]);
    expect(performanceLines("const t = window.performance['now']();")).toEqual([1]);
    expect(performanceLines("new WebGLRenderer({ powerPreference: 'high-performance' });")).toEqual([]);
  });

  it('appears in src only in src/app/loop.ts and src/debug', () => {
    const files = listTsFiles(join(REPO_ROOT, 'src'));
    expect(files.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    let loopUses = 0;
    for (const absolute of files) {
      const file = relative(REPO_ROOT, absolute).split(sep).join(posix.sep);
      const lines = performanceLines(readFileSync(absolute, 'utf8'));
      if (file === ALLOWED_FILE) loopUses += lines.length;
      else if (!file.startsWith(ALLOWED_PREFIX)) for (const line of lines) offenders.push(`${file}:${line}`);
    }
    expect(offenders).toEqual([]);
    // The loop is the owner: if it stopped reading the clock, this test would be checking nothing.
    expect(loopUses).toBeGreaterThan(0);
  });
});
