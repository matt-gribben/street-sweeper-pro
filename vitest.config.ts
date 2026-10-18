// Vitest configuration (TECHNICAL_DESIGN §18). Extends vite.config.ts so tests see the same `define`
// constants (__SSP_VERSION__, __SSP_COMMIT__) as the app build.
import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.ts';

/**
 * Runs a project's test files in child processes started with `node --expose-gc`, so `globalThis.gc` exists
 * for the zero-allocation heap-delta check (TECHNICAL_DESIGN §17, tests/support/heapDelta.ts). Vitest 5.0.5
 * takes `execArgv` at the top level of a project's `test` options (the old `poolOptions.forks.execArgv` is
 * gone); `pool: 'forks'` is the default and is pinned here because the flag needs a child process.
 * The unit project carries it, so `npm test` and CI's `checks` job run the heap tests.
 */
export const GC_EXPOSED = { pool: 'forks', execArgv: ['--expose-gc'] } as const;

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
            include: ['tests/unit/*.test.ts'],
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
          test: { name: 'replay', include: ['tests/replay/**/*.test.ts'] },
        },
      ],
    },
  }),
);
