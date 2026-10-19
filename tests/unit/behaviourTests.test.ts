// The meta-test for ROADMAP M3's exit "Behaviours: one unit test file per behaviour" (SSP-108): each of the 11
// Mon–Tue NPC behaviours has its own test file in tests/unit/behaviours/, named after its module
// (src/sim/npc/behaviours/<camelCase>.ts), and the file is non-empty and holds tests. The list is written out
// here and also checked against entities.ts NPC_BEHAVIOURS, so a behaviour added later needs a test file too.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { NPC_BEHAVIOURS } from '../../src/sim/entities.ts';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const BEHAVIOUR_TESTS = `${REPO_ROOT}tests/unit/behaviours/`;
const BEHAVIOUR_MODULES = `${REPO_ROOT}src/sim/npc/behaviours/`;

/** The behaviour test files the M3 exit expects (SSP-108 scope), by module name. */
const EXPECTED = [
  'shopper',
  'oldWoman',
  'oldManFrame',
  'mumPushchair',
  'postie',
  'dogWalker',
  'businessman',
  'litterbug',
  'marketTrader',
  'cat',
  'pigeon',
] as const;

/** `old_man_frame` → `oldManFrame`: the module file name of an entities.json behaviour key. */
function camelCase(key: string): string {
  return key.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());
}

describe('one unit test file per NPC behaviour (ROADMAP M3)', () => {
  it('expects exactly the behaviours of entities.json, 11 of them', () => {
    expect(EXPECTED).toHaveLength(11);
    expect([...EXPECTED].sort()).toEqual(NPC_BEHAVIOURS.map(camelCase).sort());
  });

  it.each(EXPECTED)('tests/unit/behaviours/%s.test.ts exists, is non-empty and holds tests', (name) => {
    const path = `${BEHAVIOUR_TESTS}${name}.test.ts`;
    expect(existsSync(path), path).toBe(true);
    expect(statSync(path).size).toBeGreaterThan(0);
    const text = readFileSync(path, 'utf8');
    expect(text).toMatch(/\bit(\.each\([^)]*\))?\(/);
    // It tests the module of the same name.
    expect(existsSync(`${BEHAVIOUR_MODULES}${name}.ts`)).toBe(true);
  });
});
