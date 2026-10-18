// Replay project meta-test (TECHNICAL_DESIGN §18.3, SSP-006 decision (b)). Run with `npm run test:replay`.
//
// M0 has no sim, so there is no replay runner yet (SSP-038, M1). This test loads every
// tests/replay/replays/*.json, logs the count and asserts the directory exists, so the Vitest replay project
// is real and never needs --passWithNoTests. A replay committed before the runner exists fails loudly
// instead of passing silently.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPLAYS_DIR = fileURLToPath(new URL('./replays/', import.meta.url));

function listReplayFiles(): string[] {
  if (!existsSync(REPLAYS_DIR)) return [];
  return readdirSync(REPLAYS_DIR)
    .filter((name) => name.endsWith('.json'))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

const replayFiles = listReplayFiles();
const replays = replayFiles.map((name) => ({
  name,
  data: JSON.parse(readFileSync(join(REPLAYS_DIR, name), 'utf8')) as unknown,
}));

describe('replay corpus', () => {
  it('has a tests/replay/replays directory and reports its replay count', () => {
    expect(existsSync(REPLAYS_DIR), `missing ${REPLAYS_DIR}`).toBe(true);
    expect(statSync(REPLAYS_DIR).isDirectory()).toBe(true);
    console.log(`replays: ${replays.length} file(s) in tests/replay/replays/`);
    expect(replays.length).toBe(replayFiles.length);
  });

  for (const replay of replays) {
    it(`runs ${replay.name}`, () => {
      expect.fail(
        `${replay.name}: replay runner not implemented until M1 (SSP-038); a replay cannot be checked yet`,
      );
    });
  }
});
