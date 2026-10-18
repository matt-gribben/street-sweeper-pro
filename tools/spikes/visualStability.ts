// D-09 golden-stability loop (SSP-022, ROADMAP §8). Not part of `npm test`: it needs Playwright's Chromium
// (`npx playwright install chromium`). Run with `node tools/spikes/visualStability.ts [--runs N]` (default 10).
//
// Runs `npx playwright test tests/visual --project=visual` N times as SEPARATE processes (a fresh Playwright
// process, browser and page each time; each invocation also rebuilds the bundle through the config's
// webServer unless a server is already listening on the preview port), and collects the
// `[visual] <scene> <W>x<H> sha256=<hex>` line every visual spec logs (tests/support/visualGolden.ts): the SHA-256
// of the readFrame() RGBA buffer for lean_quadrants and of the page screenshot's RGBA pixels for scale_1440.
// Passes only if every invocation exits 0 (so every spec matched its golden at pixelmatch threshold 0) and each
// scene logged exactly one hash per run, identical across all N runs. Stops at the first failing run, like
// `for i in $(seq 1 10); do npx playwright test tests/visual --project=visual || break; done`.
//
// Prints one line per run and a JSON report, which it also writes to build/spikes/visual-stability/report.json
// together with the SHA-256 of each committed golden file.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT_DIR = 'build/spikes/visual-stability';
const GOLDEN_DIR = 'tests/visual/__goldens__';
const HASH_LINE = /^\[visual\] (\S+) (\d+x\d+) sha256=([0-9a-f]{64})$/gm;

function parseRuns(argv: readonly string[]): number {
  const i = argv.indexOf('--runs');
  if (i < 0) return 10;
  const value = Number(argv[i + 1]);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`--runs must be a positive integer`);
  return value;
}

const runs = parseRuns(process.argv.slice(2));
mkdirSync(OUT_DIR, { recursive: true });

type RunResult = { run: number; exitCode: number | null; seconds: number; hashes: Record<string, string> };
const results: RunResult[] = [];
const failures: string[] = [];

for (let run = 1; run <= runs; run++) {
  const started = Date.now();
  const child = spawnSync('npx', ['playwright', 'test', 'tests/visual', '--project=visual'], {
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 64 * 1024 * 1024,
  });
  const output = `${child.stdout ?? ''}${child.stderr ?? ''}`;
  const logPath = join(OUT_DIR, `run_${String(run).padStart(2, '0')}.log`);
  writeFileSync(logPath, output);
  const hashes: Record<string, string> = {};
  for (const match of output.matchAll(HASH_LINE)) {
    const key = `${match[1]} ${match[2]}`;
    if (key in hashes) failures.push(`run ${run}: ${key} logged more than one hash`);
    hashes[key] = match[3] ?? '';
  }
  const result: RunResult = {
    run,
    exitCode: child.status,
    seconds: Math.round((Date.now() - started) / 100) / 10,
    hashes,
  };
  results.push(result);
  console.log(
    `run ${String(run).padStart(2)}: exit ${child.status} in ${result.seconds}s  ` +
      Object.entries(hashes)
        .map(([key, sha]) => `${key} ${sha}`)
        .join('  '),
  );
  if (child.status !== 0) {
    failures.push(`run ${run}: playwright exited ${child.status} (log: ${logPath})`);
    break;
  }
}

const scenes = [...new Set(results.flatMap((r) => Object.keys(r.hashes)))].sort();
const distinct: Record<string, string[]> = {};
for (const scene of scenes) {
  const seen = results.map((r) => r.hashes[scene]);
  if (seen.some((sha) => sha === undefined)) failures.push(`${scene}: missing from at least one run`);
  distinct[scene] = [...new Set(seen.filter((sha): sha is string => sha !== undefined))];
  if ((distinct[scene]?.length ?? 0) !== 1)
    failures.push(`${scene}: ${distinct[scene]?.length} distinct hashes`);
}
if (scenes.length < 2)
  failures.push(`expected hashes for both visual scenes, got ${scenes.join(', ') || 'none'}`);

const goldens: Record<string, string> = {};
for (const file of readdirSync(GOLDEN_DIR).sort()) {
  goldens[file] = createHash('sha256')
    .update(readFileSync(join(GOLDEN_DIR, file)))
    .digest('hex');
}

const report = {
  runsRequested: runs,
  runsCompleted: results.length,
  allPassed: failures.length === 0,
  distinctHashes: distinct,
  goldenFileSha256: goldens,
  runs: results,
  failures,
};
const json = JSON.stringify(report, null, 2);
writeFileSync(join(OUT_DIR, 'report.json'), `${json}\n`);
console.log(json);
if (failures.length > 0) process.exit(1);
