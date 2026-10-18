// Music renderer: assets-src/audio/music/*.song.json → stems, encodes and music.json (AUDIO_DESIGN §8).
// Run: node tools/audio/render-music.ts [--out <dir>]   (via `npm run audio`; `forge verify` passes --out)
//
// M0 input-count guard (SSP-006 decision (a)): exits 0 with "0 sources" when there is nothing to render and
// non-zero with "not implemented until M5" as soon as a source exists. The real tracker lands in SSP-166/167.
import { fileURLToPath } from 'node:url';
import { runInputGuard } from '../inputGuard.ts';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

process.exitCode = runInputGuard(
  {
    tool: 'render-music',
    sourceDir: 'assets-src/audio/music',
    suffix: '.song.json',
    notImplementedUntil: 'M5',
  },
  repoRoot,
  process.argv.slice(2),
);
