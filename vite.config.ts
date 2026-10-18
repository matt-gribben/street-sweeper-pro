// Vite configuration (TECHNICAL_DESIGN §20.2). vitest.config.ts extends this file, so both share `define`.
import { execFileSync } from 'node:child_process';
import { defineConfig } from 'vite';
import pkg from './package.json' with { type: 'json' };

/** Fallback for __SSP_COMMIT__ when git is unavailable (e.g. a source tarball or no git on PATH). */
export const UNKNOWN_COMMIT = 'unknown';

/** Short git SHA of HEAD at config time, or UNKNOWN_COMMIT if git fails for any reason. */
export function readShortCommit(): string {
  try {
    const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return sha.length > 0 ? sha : UNKNOWN_COMMIT;
  } catch {
    return UNKNOWN_COMMIT;
  }
}

/** Build-time constants, typed in src/globals.d.ts. Values are JSON-encoded as `define` requires. */
export const sspDefine = {
  __SSP_VERSION__: JSON.stringify(pkg.version),
  __SSP_COMMIT__: JSON.stringify(readShortCommit()),
};

// Vite requires a default export from its config file; this is the only sanctioned exception to
// the named-exports rule, together with vitest.config.ts.
export default defineConfig({
  base: './',
  define: sspDefine,
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
