// Vitest configuration (TECHNICAL_DESIGN §18). Extends vite.config.ts so tests see the same `define`
// constants (__SSP_VERSION__, __SSP_COMMIT__) as the app build.
import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.ts';

/**
 * Runs a project's test files in child processes started with `node --expose-gc`, so `globalThis.gc` exists
 * for the zero-allocation heap-delta check (TECHNICAL_DESIGN §17, tests/support/heapDelta.ts). Vitest 5.0.5
 * takes `execArgv` at the top level of a project's `test` options (the old `poolOptions.forks.execArgv` is
 * gone); `pool: 'forks'` is the default and is pinned here because the flag needs a child process.
 * The unit and replay projects carry it, so `npm test`, `npm run test:replay` and CI run the heap tests.
 */
export const GC_EXPOSED = { pool: 'forks', execArgv: ['--expose-gc'] } as const;

/**
 * `npm run test:replay -- --update` (or `-u`) re-records replay checkpoint hashes (TECHNICAL_DESIGN §18.3,
 * SSP-038). Vitest forwards the flag to its own CLI, and test workers cannot read the main process's argv, so
 * the config reads it here and hands it to the replay project through `provide`; the runner reads it with
 * `inject('replayUpdate')`. It is false unless the flag is passed explicitly: a plain run never writes files.
 */
export const REPLAY_UPDATE: boolean = process.argv.includes('--update') || process.argv.includes('-u');

declare module 'vitest' {
  export interface ProvidedContext {
    /** True only when `--update` / `-u` was passed: the replay runner rewrites checkpoint hashes. */
    replayUpdate: boolean;
  }
}

// Vitest requires a default export from its config file (see the note in vite.config.ts).
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      projects: [
        {
          extends: true,
          test: {
            name: 'unit',
            // One test file per NPC behaviour lives in tests/unit/behaviours/ (ROADMAP M3, SSP-083).
            include: ['tests/unit/*.test.ts', 'tests/unit/behaviours/*.test.ts'],
            pool: GC_EXPOSED.pool,
            execArgv: [...GC_EXPOSED.execArgv],
          },
        },
        {
          extends: true,
          test: { name: 'property', include: ['tests/property/*.prop.test.ts'] },
        },
        {
          extends: true,
          test: {
            name: 'replay',
            include: ['tests/replay/**/*.test.ts'],
            pool: GC_EXPOSED.pool,
            execArgv: [...GC_EXPOSED.execArgv],
            provide: { replayUpdate: REPLAY_UPDATE },
          },
        },
      ],
    },
  }),
);
