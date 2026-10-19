// Hard rule 3 guard for the renderer (SSP-016) and the UI (SSP-069): no raw colour literal in src/render or src/ui.
// The equivalent of `grep -rnE '#[0-9a-fA-F]{6}|0x[0-9a-fA-F]{6}' src/render src/ui`, which must match only the
// #0f0e12 letterbox in upscale.ts (the one CSS exception, Kerbside-32 index 00). UI colours are palette indices.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SCANNED_DIRS = [join(REPO_ROOT, 'src', 'render'), join(REPO_ROOT, 'src', 'ui')];
const HEX_COLOUR = /#[0-9a-fA-F]{6}|0x[0-9a-fA-F]{6}/;

function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => (entry.isDirectory() ? listFiles(join(dir, entry.name)) : [join(dir, entry.name)]))
    .sort();
}

describe('no hex colour literals in src/render and src/ui', () => {
  it('matches only the letterbox constant in upscale.ts', () => {
    const hits: string[] = [];
    for (const file of SCANNED_DIRS.flatMap(listFiles)) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line) => {
          if (HEX_COLOUR.test(line)) hits.push(`${relative(REPO_ROOT, file)}: ${line.trim()}`);
        });
    }
    expect(hits).toEqual(["src/render/upscale.ts: export const LETTERBOX_CSS = '#0f0e12';"]);
  });
});
