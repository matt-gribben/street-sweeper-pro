// Small compiled districts for the steering tests (SSP-081): ASCII maps run through the real level compiler
// (tools/levels/compile-level.ts), so the nav graph, its crossing edges, the zebra sites, the props and the
// collide layer are exactly what a shipped level would carry. The layout codes (depot bays, hydrants, dead
// ends) are skipped as in compileLanes.test.ts; the lane codes stay on, so every map has a legal road.
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeLevel, type Level } from '../../src/sim/map.ts';
import { compileLevel, formatDiagnostic } from '../../tools/levels/compile-level.ts';
import { KERB_BLOB_PATH, readKerbBlob } from '../../tools/levels/kerbBlob.ts';
import type { LayoutCode } from '../../tools/levels/layoutChecks.ts';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const KERB_BLOB = readKerbBlob(join(REPO_ROOT, KERB_BLOB_PATH));
const KNOWN = new Set(['roof.slate', 'roof.felt', 'facade.terrace_brick', 'facade.corner_shop']);
const LAYOUT_CODES: readonly LayoutCode[] = ['L014', 'L015', 'L020', 'L021', 'L022'];
const BUILDING = { storeys: 2, roof: 'roof.slate', wall: 'facade.terrace_brick', use: 'house' };

/**
 * The steering test town, 40 × 11 tiles (80 × 22 m): a terrace (row 0), a 1-tile pavement with a lamp post, a
 * litter bin, a hydrant and a dropped kerb (row 1), a 3-tile two-way road across the map (rows 2–4) with a
 * 1-tile zebra at column 10 and Bessie's start, then a wide pavement (rows 5–9) with the other dropped kerb
 * (column 22), a bench, a lamp post, a tree and a low wall, and a second terrace with a gap (row 10).
 * Crossings: the zebra (column 10) and the dropped kerb (column 22).
 */
export const STEERING_TOWN: readonly string[] = [
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  '......l.......i.......d.......h.........',
  '##########z#############################',
  '##########z#############################',
  '##########z####@########################',
  '......................d.................',
  '...........n..............l.............',
  '........................................',
  '....wwww..........t.....................',
  '........................................',
  'BBBBBBBBBBBB....BBBBBBBBBBBBBBBBBBBBBBBB',
];

/** The level.json text for `rows` (a shift district; buildings A–E are terraces). */
export function townLevelText(rows: readonly string[]): string {
  const w = rows[0]?.length ?? 0;
  const used = new Set(rows.join(''));
  const buildings: Record<string, unknown> = {};
  for (const letter of ['A', 'B', 'C', 'D', 'E']) if (used.has(letter)) buildings[letter] = BUILDING;
  const level = {
    schema: 1,
    id: 'district.steering',
    name: 'Steering Test',
    day: 'mon',
    mode: 'shift',
    map: 'steering.map.txt',
    size: [w, rows.length],
    timer: 240,
    seed: 3,
    timeOfDay: 'morning',
    weather: 'clear',
    start: { heading: 8 },
    depot: { rect: [0, 0, w, rows.length] },
    buildings,
  };
  return `${JSON.stringify(level, null, 2)}\n`;
}

/** Compile `rows` and decode the result, as the game loads it. Throws with the diagnostics on an error. */
export function compileTown(rows: readonly string[] = STEERING_TOWN): Level {
  const result = compileLevel({
    name: 'steering',
    mapText: rows.map((r) => `${r}\n`).join(''),
    levelText: townLevelText(rows),
    knownAssetIds: KNOWN,
    kerbBlob: KERB_BLOB,
    skipCodes: LAYOUT_CODES,
  });
  if (result.output === null) {
    throw new Error(`compileTown: ${result.diagnostics.map(formatDiagnostic).join('\n')}`);
  }
  return decodeLevel(result.output.text);
}
