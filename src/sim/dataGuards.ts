// Small shared helpers for the hand-written JSON guards in src/sim/tuning.ts and src/sim/entities.ts
// (CLAUDE.md §5.1: no zod, no `any`). Load-time code only: nothing here runs on the tick path.

/** True for a plain JSON object (not null, not an array). */
export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A short description of a JSON value for error messages: 'null', 'an array', 'string "x"', 'number 3'. */
export function describeValue(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  if (typeof value === 'string') return `string ${JSON.stringify(value)}`;
  return `${typeof value} ${String(value)}`;
}
