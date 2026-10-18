// SFX renderer: assets-src/audio/sfx/*.json → WAV sprites, encodes and sfx.json (AUDIO_DESIGN §6).
// Run: node tools/audio/render-sfx.ts [--out <dir>]   (via `npm run audio`; `forge verify` passes --out)
//
// M0 input-count guard (SSP-006 decision (a)): exits 0 with "0 sources" when there is nothing to render and
// non-zero with "not implemented until M5" as soon as a source exists. The real renderer lands in SSP-161.
import { fileURLToPath } from 'node:url';
import { runInputGuard } from '../inputGuard.ts';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

process.exitCode = runInputGuard(
  { tool: 'render-sfx', sourceDir: 'assets-src/audio/sfx', suffix: '.json', notImplementedUntil: 'M5' },
  repoRoot,
  process.argv.slice(2),
);
