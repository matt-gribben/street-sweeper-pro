// A fast-check runner that always states how to reproduce a failure (SSP-037). `fc.assert` already mentions
// the seed and path, but buried in a long report; this puts them on the first line of the thrown error,
// with the command that replays exactly the failing case.
//
// Reproduce a failure with the two environment variables the message prints:
//   SSP_FC_SEED=<seed> SSP_FC_PATH=<path> npx vitest run --project property <file> -t "<test name>"
// With SSP_FC_PATH set, fast-check replays only that counterexample (it needs the seed too). Without the
// variables the run uses the fixed seed the test passes in, so CI is deterministic.
import fc from 'fast-check';

/** The seed and path to use: the environment overrides (for reproducing a failure), else the fixed seed. */
export function reproParams(seed: number): { seed: number; path?: string } {
  const envSeed = process.env.SSP_FC_SEED;
  const envPath = process.env.SSP_FC_PATH;
  const out: { seed: number; path?: string } = { seed };
  if (envSeed !== undefined && envSeed !== '') {
    const parsed = Number(envSeed);
    if (!Number.isInteger(parsed)) throw new Error(`SSP_FC_SEED must be an integer, got ${envSeed}`);
    out.seed = parsed;
  }
  if (envPath !== undefined && envPath !== '') out.path = envPath;
  return out;
}

/** The first line of a failure report: the seed and path, and the command that replays them. */
export function reproLine(seed: number, path: string | null): string {
  const p = path ?? '';
  return (
    `fast-check failure: seed=${seed} path="${p}" ` +
    `(reproduce: SSP_FC_SEED=${seed} SSP_FC_PATH=${p} npx vitest run --project property <file> -t "<test>")`
  );
}

/**
 * Run a synchronous property with `params` (seed fixed by the caller, overridable through SSP_FC_SEED and
 * SSP_FC_PATH) and throw on failure with the seed and counterexample path first, then fast-check's report.
 */
export function assertProperty<Ts>(property: fc.IProperty<Ts>, params: fc.Parameters<Ts>): void {
  const seed = params.seed;
  if (seed === undefined) throw new Error('assertProperty: pass a fixed seed');
  const details = fc.check(property, { ...params, ...reproParams(seed) });
  if (!details.failed) return;
  const cause = details.errorInstance;
  const reason = cause instanceof Error ? cause.message : String(cause);
  const report = fc.defaultReportMessage(details) ?? '';
  throw new Error(`${reproLine(details.seed, details.counterexamplePath)}\nreason: ${reason}\n${report}`, {
    cause,
  });
}
