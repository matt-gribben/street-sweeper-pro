// Vitest configuration (TECHNICAL_DESIGN §18). Extends vite.config.ts so tests see the same `define`
// constants (__SSP_VERSION__, __SSP_COMMIT__) as the app build.
import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.ts';

// Vitest requires a default export from its config file (see the note in vite.config.ts).
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      projects: [
        {
          extends: true,
          test: { name: 'unit', include: ['tests/unit/*.test.ts'] },
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
