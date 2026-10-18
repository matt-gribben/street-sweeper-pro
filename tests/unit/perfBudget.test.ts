// D-08 (SSP-023): the p99 frame-time budget lives in tests/e2e/perf.spec.ts and is mirrored in
// TECHNICAL_DESIGN §17 and ROADMAP §8; the bundle size is mirrored in ADR 0001 §4.4. The spec is a Playwright
// file (importing it would register Playwright tests), so its constants are read from the source text.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (relPath: string): string => readFileSync(`${REPO_ROOT}${relPath}`, 'utf8');

const spec = read('tests/e2e/perf.spec.ts');

function specConstant(name: string): number {
  const match = new RegExp(`^const ${name} = ([0-9_.]+);$`, 'm').exec(spec);
  if (match === null || match[1] === undefined) throw new Error(`perf.spec.ts: const ${name} not found`);
  return Number(match[1].replaceAll('_', ''));
}

/** The markdown table row whose first cell starts with `firstCell`. */
function tableRow(doc: string, firstCell: string): string {
  const row = doc.split('\n').find((line) => line.startsWith(`| ${firstCell}`));
  if (row === undefined) throw new Error(`no table row starting "| ${firstCell}"`);
  return row;
}

const budgetMs = specConstant('P99_FRAME_TIME_BUDGET_MS');
const baselineMs = specConstant('BASELINE_P99_MS');
const headroom = specConstant('M6_HEADROOM_FACTOR');

describe('D-08 p99 frame-time budget', () => {
  it('is the baseline p99 times the M6 headroom factor', () => {
    expect(budgetMs).toBeCloseTo(baselineMs * headroom, 9);
    expect(headroom).toBeGreaterThan(1);
  });

  it('keeps the draw-call budget at 10 (TECHNICAL_DESIGN §12.7)', () => {
    expect(specConstant('DRAW_CALL_BUDGET')).toBe(10);
  });

  it('is mirrored in TECHNICAL_DESIGN §17 with the baseline and headroom', () => {
    const row = tableRow(read('docs/TECHNICAL_DESIGN.md'), 'p99 frame time');
    expect(row).toContain(`**${budgetMs} ms**`);
    expect(row).toContain(`**${baselineMs} ms**`);
    expect(row).toContain(`headroom **${headroom}**`);
    expect(row).not.toContain('TBD');
  });

  it('re-defers the sim-step number in TECHNICAL_DESIGN §17 to a named milestone', () => {
    const row = tableRow(read('docs/TECHNICAL_DESIGN.md'), 'Sim step time');
    expect(row).toMatch(/re-deferred to M\d/);
    expect(row).not.toContain('TBD (M0 spike)');
  });

  it('is recorded in ROADMAP §8 D-08 with the baseline, sample count and headroom', () => {
    const row = tableRow(read('docs/ROADMAP.md'), '**D-08**');
    const td = read('docs/TECHNICAL_DESIGN.md');
    expect(row).toContain(`**p99 frame time ≤ ${budgetMs} ms**`);
    expect(row).toContain(`baseline p99 **${baselineMs} ms**`);
    expect(row).toContain(`headroom **${headroom}**`);
    expect(row).toMatch(/re-deferred to M\d/);
    const frames = /\*\*([0-9,]+) frames\*\*/.exec(row)?.[1];
    expect(frames, 'D-08 evidence must give the sample count').toBeDefined();
    expect(td).toContain(`**${frames} frames**`);
    expect(row).not.toContain('TBD (M0 spike)');
  });

  it('records the bundle size (JS gzip and dist total) in D-08 and ADR 0001 §4.4', () => {
    const roadmap = tableRow(read('docs/ROADMAP.md'), '**D-08**');
    const adr = tableRow(read('docs/adr/0001-tech-stack.md'), 'Production bundle size');
    const gzip = /\*\*([0-9,]+) B gzip\*\*/.exec(roadmap)?.[1];
    const total = /`dist\/` total \*\*([0-9,]+) B\*\*/.exec(roadmap)?.[1];
    expect(gzip).toBeDefined();
    expect(total).toBeDefined();
    expect(adr).toContain(`${gzip} B gzip`);
    expect(adr).toContain(`total ${total} B`);
    expect(adr).toContain(`${budgetMs} ms`);
    expect(adr).not.toContain('TBD');
  });
});
