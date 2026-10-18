// IP hygiene scanner (CLAUDE.md hard rule 7). Reads the ONE shared trademark denylist,
// tools/ipDenylist.json (also read by the forge gen-ai wrapper, SSP-012), and finds blocked terms in
// prompts, the style preamble, src/data/*.json and asset IDs. Never scans docs/** (internal docs may name
// inspirations) or assets-src/_probe/. Kept pure where possible so ipHygiene.test.ts can self-test it.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/** Repo-relative path of the shared denylist. Must stay outside every scanned path. */
export const DENYLIST_PATH = 'tools/ipDenylist.json';

/** Repo-relative scan roots. Kept in one place so the test can prove the denylist is not under one. */
export const SCAN_ROOTS = {
  aiDir: 'assets-src/ai',
  preamble: 'assets-src/ai/_style_preamble.md',
  dataDir: 'src/data',
  manifest: 'assets-src/manifest.json',
} as const;

/** Paths that must never be scanned. */
export const NEVER_SCANNED = ['docs/', 'assets-src/_probe/'] as const;

export type MatchMode = 'word' | 'substring';
export type DenylistTerm = { term: string; match: MatchMode };
export type CompiledTerm = DenylistTerm & { pattern: RegExp };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validate the parsed denylist JSON. Throws on any malformed entry or an empty list. */
export function parseDenylist(json: unknown): DenylistTerm[] {
  if (!isRecord(json) || json.format !== 'ssp.ip_denylist' || !Array.isArray(json.terms)) {
    throw new Error(`${DENYLIST_PATH}: expected { "format": "ssp.ip_denylist", "terms": [...] }`);
  }
  const terms = json.terms.map((entry: unknown, k: number): DenylistTerm => {
    if (
      !isRecord(entry) ||
      typeof entry.term !== 'string' ||
      !/[a-z0-9]/i.test(entry.term) ||
      (entry.match !== 'word' && entry.match !== 'substring')
    ) {
      throw new Error(
        `${DENYLIST_PATH}: terms[${k}] must be { "term": "<text>", "match": "word"|"substring" }`,
      );
    }
    return { term: entry.term, match: entry.match };
  });
  if (terms.length === 0) throw new Error(`${DENYLIST_PATH}: the term list is empty`);
  return terms;
}

export function loadDenylist(repoRoot: string): DenylistTerm[] {
  return parseDenylist(JSON.parse(readFileSync(join(repoRoot, DENYLIST_PATH), 'utf8')));
}

/**
 * Compile one term per the "matching" rules in the denylist file: case-insensitive; each run of
 * non-alphanumerics inside the term matches zero or more non-alphanumerics in the text; 'word' terms
 * must not touch a letter or digit on either side.
 */
export function compileTerm(entry: DenylistTerm): CompiledTerm {
  const parts = entry.term
    .split(/[^a-z0-9]+/i)
    .filter((part) => part.length > 0)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const body = parts.join('[^a-z0-9]*');
  const source = entry.match === 'word' ? `(?<![a-z0-9])${body}(?![a-z0-9])` : body;
  return { ...entry, pattern: new RegExp(source, 'gi') };
}

export type TermHit = { term: string; line: number; excerpt: string };

/** Every blocked-term hit in `text`, in order of appearance. */
export function findBlockedTerms(text: string, compiled: readonly CompiledTerm[]): TermHit[] {
  const hits: { index: number; hit: TermHit }[] = [];
  for (const entry of compiled) {
    for (const m of text.matchAll(entry.pattern)) {
      const line = text.slice(0, m.index).split('\n').length;
      hits.push({ index: m.index, hit: { term: entry.term, line, excerpt: m[0] } });
    }
  }
  return hits.sort((a, b) => a.index - b.index).map((h) => h.hit);
}

export type ScanTarget = { label: string; text: string };
export type ScanPlan = { targets: ScanTarget[]; skipped: string[] };

function isDir(path: string): boolean {
  return existsSync(path) && statSync(path).isDirectory();
}

function findFilesNamed(dir: string, name: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...findFilesNamed(full, name));
    else if (entry.isFile() && entry.name === name) found.push(full);
  }
  return found.sort();
}

/** Asset IDs from the manifest (`{ "assets": [{ "id": ... }] }`, ASSET_PIPELINE §6.1). Throws if malformed. */
export function manifestIds(json: unknown): string[] {
  if (!isRecord(json) || !Array.isArray(json.assets)) {
    throw new Error(`${SCAN_ROOTS.manifest}: expected { "assets": [...] }`);
  }
  return json.assets.map((entry: unknown, k: number) => {
    if (!isRecord(entry) || typeof entry.id !== 'string') {
      throw new Error(`${SCAN_ROOTS.manifest}: assets[${k}].id must be a string`);
    }
    return entry.id;
  });
}

/**
 * Collect everything the hygiene test scans. A missing root is recorded in `skipped` (and logged by the
 * test), never dropped silently. Labels are repo-relative so failures point at the file.
 */
export function collectScanTargets(repoRoot: string): ScanPlan {
  const targets: ScanTarget[] = [];
  const skipped: string[] = [];
  const rel = (abs: string): string => relative(repoRoot, abs).split(sep).join('/');

  const aiDir = join(repoRoot, SCAN_ROOTS.aiDir);
  if (isDir(aiDir)) {
    const prompts = findFilesNamed(aiDir, 'prompt.md');
    if (prompts.length === 0) skipped.push(`${SCAN_ROOTS.aiDir}/**/prompt.md (none found)`);
    for (const abs of prompts) targets.push({ label: rel(abs), text: readFileSync(abs, 'utf8') });
    // The AI folder names are asset IDs (CLAUDE.md §5.4), so they are scanned even before the manifest exists.
    for (const entry of readdirSync(aiDir, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.name.startsWith('_')) {
        targets.push({
          label: `asset id ${entry.name} (${SCAN_ROOTS.aiDir}/${entry.name}/)`,
          text: entry.name,
        });
      }
    }
  } else {
    skipped.push(`${SCAN_ROOTS.aiDir}/**/prompt.md (no ${SCAN_ROOTS.aiDir}/)`);
  }

  const preamble = join(repoRoot, SCAN_ROOTS.preamble);
  if (existsSync(preamble))
    targets.push({ label: SCAN_ROOTS.preamble, text: readFileSync(preamble, 'utf8') });
  else skipped.push(SCAN_ROOTS.preamble);

  const dataDir = join(repoRoot, SCAN_ROOTS.dataDir);
  if (isDir(dataDir)) {
    const jsonFiles = readdirSync(dataDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => entry.name)
      .sort();
    if (jsonFiles.length === 0) skipped.push(`${SCAN_ROOTS.dataDir}/*.json (none found)`);
    for (const name of jsonFiles) {
      targets.push({
        label: `${SCAN_ROOTS.dataDir}/${name}`,
        text: readFileSync(join(dataDir, name), 'utf8'),
      });
    }
  } else {
    skipped.push(`${SCAN_ROOTS.dataDir}/*.json (no ${SCAN_ROOTS.dataDir}/)`);
  }

  const manifest = join(repoRoot, SCAN_ROOTS.manifest);
  if (existsSync(manifest)) {
    for (const id of manifestIds(JSON.parse(readFileSync(manifest, 'utf8')))) {
      targets.push({ label: `asset id ${id} (${SCAN_ROOTS.manifest})`, text: id });
    }
  } else {
    skipped.push(`${SCAN_ROOTS.manifest} ids`);
  }

  return { targets, skipped };
}
