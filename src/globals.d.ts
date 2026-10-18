// Build-time constants injected by Vite `define` (vite.config.ts, shared with vitest.config.ts).
// `vite/client` types `import.meta.env` (DEV gates dev-only code such as src/debug/devPanel.ts).
/// <reference types="vite/client" />

/** The package.json version, e.g. "0.0.0". */
declare const __SSP_VERSION__: string;

/** Short git SHA of HEAD when the config was loaded, or "unknown" when git is unavailable. */
declare const __SSP_COMMIT__: string;
