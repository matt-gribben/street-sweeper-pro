// Input-count guard shared by the M0 audio and level tools (SSP-006 decision (a), ASSET_PIPELINE §5.2).
//
// `npm run assets` must succeed in M0, so tools/audio/render-sfx.ts, tools/audio/render-music.ts and
// tools/levels/compile-level.ts exist before their real implementations. Each one enumerates its sources:
// with none it logs "0 sources; nothing to render" and exits 0; with any source present it exits non-zero
// with "not implemented until <milestone>". It never passes silently when there is work to do.
//
// Runs on plain Node 24 type stripping (no tsx), so it uses only erasable syntax and Node built-ins.
import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

/** Exit status when sources exist but the tool is not implemented yet (matches the forge's EXIT_NOT_IMPLEMENTED). */
export const EXIT_NOT_IMPLEMENTED = 3;

/** Exit status for a command-line usage error (matches argparse in the forge). */
export const EXIT_USAGE = 2;

export interface InputGuardSpec {
  /** Tool name used as the log prefix, e.g. `render-sfx`. */
  readonly tool: string;
  /** Source directory relative to the repo root, e.g. `assets-src/audio/sfx`. Not searched recursively. */
  readonly sourceDir: string;
  /** File-name suffix that marks a source, e.g. `.json` or `.map.txt`. */
  readonly suffix: string;
  /** Milestone that delivers the real tool, e.g. `M5`. */
  readonly notImplementedUntil: string;
}

export interface InputGuardIo {
  readonly log: (line: string) => void;
  readonly error: (line: string) => void;
}

export interface ParsedGuardArgs {
  /** Value of `--out <dir>` (the output root `forge verify` points the tool at), or null if not given. */
  readonly outDir: string | null;
}

/** Parses the guard's command line. Accepts `--out <dir>` and `--out=<dir>`; anything else is an error. */
export function parseGuardArgs(argv: readonly string[]): ParsedGuardArgs | { readonly error: string } {
  let outDir: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === '--out') {
      const value = argv[i + 1];
      if (value === undefined || value.length === 0 || value.startsWith('--')) {
        return { error: '--out requires a directory argument' };
      }
      outDir = value;
      i++;
    } else if (arg.startsWith('--out=')) {
      const value = arg.slice('--out='.length);
      if (value.length === 0) return { error: '--out requires a directory argument' };
      outDir = value;
    } else {
      return { error: `unrecognised argument: ${arg}` };
    }
  }
  return { outDir };
}

/**
 * Lists the sources the guard would have to process: files directly inside `rootDir/spec.sourceDir` whose
 * names end in `spec.suffix`, skipping dotfiles, sorted by code unit so output is deterministic.
 * A missing source directory counts as zero sources.
 */
export function listSources(rootDir: string, spec: InputGuardSpec): string[] {
  const dir = join(rootDir, spec.sourceDir);
  let names: string[];
  try {
    names = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && !entry.name.startsWith('.') && entry.name.endsWith(spec.suffix))
      .map((entry) => entry.name);
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') return [];
    throw err;
  }
  names.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return names.map((name) => join(dir, name));
}

/** Runs the guard and returns the process exit status. Never throws for a usage error. */
export function runInputGuard(
  spec: InputGuardSpec,
  rootDir: string,
  argv: readonly string[],
  io: InputGuardIo = { log: console.log, error: console.error },
): number {
  const parsed = parseGuardArgs(argv);
  if ('error' in parsed) {
    io.error(`${spec.tool}: ${parsed.error}`);
    io.error(`usage: node <tool>.ts [--out <dir>]`);
    return EXIT_USAGE;
  }

  const sources = listSources(rootDir, spec);
  const pattern = `${spec.sourceDir}/*${spec.suffix}`;
  if (sources.length === 0) {
    const out = parsed.outDir === null ? '' : ` (--out ${parsed.outDir})`;
    io.log(`${spec.tool}: 0 sources; nothing to render [${pattern}]${out}`);
    return 0;
  }

  io.error(`${spec.tool}: ${sources.length} source(s) found [${pattern}]:`);
  for (const source of sources) io.error(`  ${relative(rootDir, source)}`);
  io.error(`${spec.tool}: not implemented until ${spec.notImplementedUntil}`);
  return EXIT_NOT_IMPLEMENTED;
}
