// Heap-threshold measurement for SSP-292 (evidence for the TECHNICAL_DESIGN §17 zero-allocation thresholds).
// Not part of `npm test` (tests/unit/heapDelta.test.ts is the gate). Run on the dev Mac with
//   node tools/spikes/heapThreshold.ts [--runs 20]
//
// For each synthetic variant (clean, transient, retained; tests/support/syntheticTicks.ts) it starts `--runs`
// fresh `node --expose-gc` processes. Each process runs tests/support/heapDelta.ts once (600-tick warm-up,
// gc, 3,600 ticks, read heap, gc, read heap) and reports both deltas. The parent prints the min / median / max
// bytes per variant and how many runs pass the thresholds in heapDelta.ts. Exits non-zero unless every clean
// run passes and every transient and retained run fails.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  HEAP_PRE_GC_THRESHOLD_BYTES,
  HEAP_RETAINED_THRESHOLD_BYTES,
  type HeapDelta,
  heapDeltaFailure,
  measureHeapDelta,
} from '../../tests/support/heapDelta.ts';
import { createSyntheticTick, SyntheticVariant } from '../../tests/support/syntheticTicks.ts';

const VARIANTS = [SyntheticVariant.Clean, SyntheticVariant.Transient, SyntheticVariant.Retained] as const;

function isVariant(value: string | undefined): value is SyntheticVariant {
  return VARIANTS.some((v) => v === value);
}

function runChild(variant: SyntheticVariant): void {
  const delta = measureHeapDelta(createSyntheticTick(variant));
  process.stdout.write(`${JSON.stringify(delta)}\n`);
}

function isHeapDelta(value: unknown): value is HeapDelta {
  if (typeof value !== 'object' || value === null) return false;
  return (
    'retainedBytes' in value &&
    typeof value.retainedBytes === 'number' &&
    'preGcBytes' in value &&
    typeof value.preGcBytes === 'number' &&
    'ticks' in value &&
    typeof value.ticks === 'number' &&
    'warmupTicks' in value &&
    typeof value.warmupTicks === 'number'
  );
}

function stats(values: readonly number[]): { min: number; median: number; max: number } {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const median =
    sorted.length % 2 === 1 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
  return { min: sorted[0] ?? 0, median, max: sorted[sorted.length - 1] ?? 0 };
}

function runParent(runs: number): number {
  const self = fileURLToPath(import.meta.url);
  const report: Record<string, unknown> = {
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    runsPerVariant: runs,
    thresholds: { retainedBytes: HEAP_RETAINED_THRESHOLD_BYTES, preGcBytes: HEAP_PRE_GC_THRESHOLD_BYTES },
  };
  let ok = true;
  for (const variant of VARIANTS) {
    const deltas: HeapDelta[] = [];
    for (let run = 0; run < runs; run++) {
      const child = spawnSync(process.execPath, ['--expose-gc', self, '--child', variant], {
        encoding: 'utf8',
      });
      if (child.status !== 0) {
        process.stderr.write(child.stderr);
        throw new Error(`child for ${variant} exited ${child.status}`);
      }
      const parsed: unknown = JSON.parse(child.stdout.trim());
      if (!isHeapDelta(parsed)) throw new Error(`child for ${variant} printed no heap delta`);
      deltas.push(parsed);
    }
    const passes = deltas.filter((d) => heapDeltaFailure(d) === null).length;
    const expectedPasses = variant === SyntheticVariant.Clean ? runs : 0;
    if (passes !== expectedPasses) ok = false;
    report[variant] = {
      retainedBytes: stats(deltas.map((d) => d.retainedBytes)),
      preGcBytes: stats(deltas.map((d) => d.preGcBytes)),
      passes,
      fails: runs - passes,
      raw: deltas.map((d) => `${d.retainedBytes}/${d.preGcBytes}`).join(' '),
    };
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return ok ? 0 : 1;
}

const args = process.argv.slice(2);
if (args[0] === '--child') {
  const variant = args[1];
  if (!isVariant(variant)) throw new Error(`unknown variant ${String(variant)}`);
  runChild(variant);
} else {
  const runsAt = args.indexOf('--runs');
  const runs = runsAt >= 0 ? Number(args[runsAt + 1]) : 20;
  if (!Number.isInteger(runs) || runs < 1) throw new Error('--runs must be a positive integer');
  process.exitCode = runParent(runs);
}
