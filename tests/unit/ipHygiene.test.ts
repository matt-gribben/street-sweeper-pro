// IP hygiene scan (CLAUDE.md hard rule 7). Fails if an AI prompt, the style preamble, src/data/*.json or
// an asset ID contains a term from the shared denylist, tools/ipDenylist.json. The list is only ever read
// from that file (no inline copy); the self-tests below use fixture strings, not a second list.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  collectScanTargets,
  compileTerm,
  DENYLIST_PATH,
  findBlockedTerms,
  loadDenylist,
  manifestIds,
  NEVER_SCANNED,
  parseDenylist,
  SCAN_ROOTS,
} from './ipHygieneScan.ts';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DENYLIST = loadDenylist(REPO_ROOT);
const COMPILED = DENYLIST.map(compileTerm);

function blocked(text: string): string[] {
  return findBlockedTerms(text, COMPILED).map((hit) => hit.term);
}

describe('ipHygiene denylist file', () => {
  it('is loaded from tools/ipDenylist.json and holds the terms CLAUDE.md names', () => {
    const terms = DENYLIST.map((entry) => entry.term.toLowerCase());
    expect(terms).toEqual(expect.arrayContaining(['gta', 'grand theft auto', 'paperboy']));
  });

  it('matches short acronyms as whole words', () => {
    const acronyms = DENYLIST.filter((entry) => /^[A-Z0-9]{1,4}$/.test(entry.term));
    expect(acronyms.length).toBeGreaterThan(0);
    for (const entry of acronyms) expect(entry.match, entry.term).toBe('word');
  });

  it('lives outside every scanned path, so the scan never flags its own list', () => {
    expect(DENYLIST_PATH.startsWith(`${SCAN_ROOTS.aiDir}/`)).toBe(false);
    expect(DENYLIST_PATH.startsWith(`${SCAN_ROOTS.dataDir}/`)).toBe(false);
    expect([SCAN_ROOTS.preamble, SCAN_ROOTS.manifest]).not.toContain(DENYLIST_PATH);
    const labels = collectScanTargets(REPO_ROOT).targets.map((t) => t.label);
    expect(labels).not.toContain(DENYLIST_PATH);
  });

  it('rejects malformed lists', () => {
    expect(() => parseDenylist({ format: 'ssp.ip_denylist', terms: [] })).toThrow(/empty/);
    expect(() => parseDenylist({ terms: [{ term: 'x', match: 'word' }] })).toThrow(/format/);
    expect(() =>
      parseDenylist({ format: 'ssp.ip_denylist', terms: [{ term: 'x', match: 'fuzzy' }] }),
    ).toThrow(/terms\[0\]/);
    expect(() =>
      parseDenylist({ format: 'ssp.ip_denylist', terms: [{ term: '--', match: 'word' }] }),
    ).toThrow(/terms\[0\]/);
  });
});

describe('ipHygiene matcher self-tests (in-memory fixtures)', () => {
  it.each(['gta', 'GTA', 'Gta', 'in the style of GTA.', 'prop.gta_sign', 'gta-like overhead view'])(
    'blocks the acronym in %j',
    (text) => {
      expect(blocked(text)).toContain('GTA');
    },
  );

  it.each([
    'Grand Theft Auto',
    'grand theft auto',
    'GRAND THEFT AUTO',
    'gRaNd ThEfT aUtO',
    'grand_theft_auto',
    'GrandTheftAuto',
    'grand-theft-auto',
    'like Grand\nTheft Auto',
  ])('blocks the full name in %j', (text) => {
    expect(blocked(text)).toContain('Grand Theft Auto');
  });

  it.each(['paperboy', 'PAPERBOY', 'PaperBoy', 'paperboys'])('blocks the third named term in %j', (text) => {
    expect(blocked(text)).toContain('Paperboy');
  });

  it.each(['agta', 'gtax', 'agtab', 'a2gta', 'gta9'])(
    'does not match the acronym inside the word %j',
    (text) => {
      expect(blocked(text)).not.toContain('GTA');
    },
  );

  it('passes a clean prompt', () => {
    const prompt = [
      'Overhead view, chunky pixel art, 1 px dark outline, flat Kerbside-32 colours.',
      'A cheerful elderly British woman in a purple coat and lilac headscarf pulling a red tartan',
      'shopping trolley. 4x2 key-pose sheet on a magenta background. No text, no logos, no brands.',
      'Litter: drink can, banana skin, crisp packet, dog walkers on Coke Street at dusk.',
    ].join('\n');
    expect(findBlockedTerms(prompt, COMPILED)).toEqual([]);
  });

  it('reports the line and matched text of each hit', () => {
    expect(findBlockedTerms('clean line\nsecond line mentions Gta here', COMPILED)).toEqual([
      { term: 'GTA', line: 2, excerpt: 'Gta' },
    ]);
  });
});

describe('ipHygiene scan plan', () => {
  const temps: string[] = [];
  afterEach(() => {
    for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('records every missing root as skipped instead of dropping it silently', () => {
    const root = mkdtempSync(join(tmpdir(), 'ssp-ip-hygiene-'));
    temps.push(root);
    const plan = collectScanTargets(root);
    expect(plan.targets).toEqual([]);
    expect(plan.skipped).toHaveLength(4);
  });

  it('scans nested prompts, the preamble, src/data/*.json and manifest ids', () => {
    const root = mkdtempSync(join(tmpdir(), 'ssp-ip-hygiene-'));
    temps.push(root);
    mkdirSync(join(root, 'assets-src', 'ai', 'litter.sheet_01', 'nested'), { recursive: true });
    mkdirSync(join(root, 'src', 'data'), { recursive: true });
    writeFileSync(join(root, 'assets-src', 'ai', 'litter.sheet_01', 'prompt.md'), 'a');
    writeFileSync(join(root, 'assets-src', 'ai', 'litter.sheet_01', 'nested', 'prompt.md'), 'b');
    writeFileSync(join(root, 'assets-src', 'ai', '_style_preamble.md'), 'c');
    writeFileSync(join(root, 'src', 'data', 'tuning.json'), '{}');
    writeFileSync(join(root, 'assets-src', 'manifest.json'), '{"assets":[{"id":"npc.old_woman"}]}');
    const plan = collectScanTargets(root);
    expect(plan.skipped).toEqual([]);
    expect(plan.targets.map((t) => t.label)).toEqual([
      'assets-src/ai/litter.sheet_01/nested/prompt.md',
      'assets-src/ai/litter.sheet_01/prompt.md',
      'asset id litter.sheet_01 (assets-src/ai/litter.sheet_01/)',
      'assets-src/ai/_style_preamble.md',
      'src/data/tuning.json',
      'asset id npc.old_woman (assets-src/manifest.json)',
    ]);
  });

  it('fails loudly on a malformed manifest', () => {
    expect(() => manifestIds({ entries: [] })).toThrow(/assets/);
    expect(() => manifestIds({ assets: [{ name: 'x' }] })).toThrow(/assets\[0\]\.id/);
  });
});

describe('ipHygiene: this repo', () => {
  it('finds no blocked term in prompts, the preamble, src/data/*.json or asset IDs', () => {
    const { targets, skipped } = collectScanTargets(REPO_ROOT);
    if (skipped.length > 0) {
      console.warn(`ipHygiene: skipped ${skipped.length} missing path(s): ${skipped.join('; ')}`);
    }
    console.info(`ipHygiene: scanned ${targets.length} target(s) against ${DENYLIST.length} terms`);

    // Never pass vacuously: the SSP-001 retro prompts exist, so something must have been scanned.
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) {
      for (const excluded of NEVER_SCANNED) expect(target.label.startsWith(excluded)).toBe(false);
    }

    const hits = targets.flatMap((target) =>
      findBlockedTerms(target.text, COMPILED).map(
        (hit) => `${target.label}:${hit.line} '${hit.excerpt}' (${hit.term})`,
      ),
    );
    expect(hits).toEqual([]);
  });
});
