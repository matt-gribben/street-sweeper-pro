// Level compiler: assets-src/levels/<district>.map.txt + .level.json → compiled level data (LEVEL_DESIGN).
// Run: node tools/levels/compile-level.ts [--out <dir>]   (via `npm run levels`; `forge verify` passes --out)
//
// M0 input-count guard (SSP-006 decision (a)): exits 0 with "0 sources" when there is nothing to compile and
// non-zero with "not implemented until M1" as soon as a map exists. The real compiler lands in SSP-033.
import { fileURLToPath } from 'node:url';
import { runInputGuard } from '../inputGuard.ts';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

process.exitCode = runInputGuard(
  { tool: 'compile-level', sourceDir: 'assets-src/levels', suffix: '.map.txt', notImplementedUntil: 'M1' },
  repoRoot,
  process.argv.slice(2),
);
