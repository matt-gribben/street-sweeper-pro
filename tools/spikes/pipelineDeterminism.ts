// Pipeline-determinism measurement for SSP-025 (ROADMAP §8 D-11 and D-12). Measurement only: it is not part of
// `npm run assets`, `npm test` or CI, and it adds no dependency. Run from the repo root on Node 24:
//
//   node tools/spikes/pipelineDeterminism.ts [--runs 3]
//       This machine (the dev Mac, a Linux box or an ubuntu-latest runner). Needs uv (the forge venv is synced
//       on first use) and ffmpeg: $FFMPEG, else /opt/homebrew/bin/ffmpeg, else `ffmpeg` on PATH.
//   node tools/spikes/pipelineDeterminism.ts --docker [--runs 3]
//       The same measurement inside an emulated linux/amd64 ubuntu:24.04 container (docker / OrbStack). The
//       container downloads uv 0.12.23, Python 3.13.15, Node 24.21.0 and a linux64 ffmpeg 9.0 build for itself;
//       nothing is installed on the host or added to the repo. Results are copied back to build/tmp/determinism/.
//
// What it measures, per machine:
//   D-12  `forge build --no-cache` twice into separate roots (same-machine byte identity), the SHA-256 of every
//         generated output, and `forge verify` (bytes) plus `forge verify --pixels` against the committed outputs.
//         The committed outputs are built on the dev Mac, so on Linux those two exit codes ARE the D-12 answer:
//         bytes pass = byte identity; bytes fail but --pixels pass = encoder-only drift; both fail = pixel drift.
//   D-11  Encodes fixed WAVs to OGG (libopus) and M4A (native AAC) `--runs` times with `-bitexact -map_metadata -1`,
//         both with the minimal flags of the SSP-025 verification commands and with the exact AUDIO_DESIGN §11.3
//         SFX and music invocations, and checks every run is byte-identical. Inputs: build/tmp/test.wav from the
//         lavfi sine source (the issue's command) plus two WAVs synthesised here with integer-only arithmetic,
//         so their bytes are identical on every platform by construction.
//
// Writes build/tmp/determinism/<platform>-<arch>/report.txt (versions, timings, verdicts) and hashes.txt (only
// lines that should match across machines). Compare two machines with
//   diff build/tmp/determinism/darwin-arm64/hashes.txt build/tmp/determinism/linux-x64/hashes.txt
// Exits non-zero when a same-machine check fails (build or encode not reproducible) or `verify --pixels` fails;
// a failing byte-mode verify is a measurement result, not an error.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { arch, platform, release } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const tag = `${platform()}-${arch()}`;
const outDir = join(repoRoot, 'build', 'tmp', 'determinism', tag);

const UV = process.env.UV ?? 'uv';
const FORGE = ['run', '--project', 'tools/forge', 'python', '-m', 'forge'];

// Container recipe for --docker. ubuntu-latest is x86_64, so the container must be linux/amd64 (emulated on
// Apple Silicon); an arm64 container would load different Pillow wheels and prove nothing about CI.
const DOCKER_IMAGE = 'ubuntu:24.04';
const NODE_VERSION = 'v24.21.0';
const UV_VERSION = '0.12.23';
const PYTHON_VERSION = '3.13.15';
// BtbN publishes rolling builds of the release/9.0 branch; there is no pinned 9.0.2 linux64 static build
// (johnvansickle.com stops at 7.0.2, Ubuntu 24.04 apt ships 6.1). The report records the exact version line.
const LINUX_FFMPEG_URL =
  'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n9.0-latest-linux64-gpl-9.0.tar.xz';

interface RunResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly seconds: number;
}

function run(cmd: string, args: readonly string[], cwd = repoRoot): RunResult {
  const t0 = performance.now();
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const seconds = (performance.now() - t0) / 1000;
  if (r.error) throw new Error(`${cmd} ${args.join(' ')}: ${r.error.message}`);
  return { status: r.status ?? 1, stdout: r.stdout, stderr: r.stderr, seconds };
}

function mustRun(cmd: string, args: readonly string[], cwd = repoRoot): RunResult {
  const r = run(cmd, args, cwd);
  if (r.status !== 0) {
    process.stderr.write(r.stdout + r.stderr);
    throw new Error(`${cmd} ${args.join(' ')} exited ${r.status}`);
  }
  return r;
}

function sha256(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

function sha256File(path: string): string {
  return sha256(readFileSync(path));
}

/** Every file under `root`, as sorted `/`-separated paths relative to `root`. */
function listFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(relative(root, p).split('\\').join('/'));
    }
  };
  walk(root);
  return out.sort();
}

/** `sha256  path` lines for every file under `root`, in sorted path order. */
function hashTree(root: string): string[] {
  return listFiles(root).map((p) => `${sha256File(join(root, p))}  ${p}`);
}

function firstLine(text: string): string {
  return text.split('\n')[0]?.trim() ?? '';
}

function fmtSeconds(s: number): string {
  return `${s.toFixed(2)} s`;
}

// ---------------------------------------------------------------------------------------------------------------
// Fixed WAV inputs

/**
 * A 16-bit mono PCM WAV with the fixed 44-byte header AUDIO_DESIGN §11.4 plans for tools/audio/wav.ts: a
 * triangle chirp (220 Hz rising) plus a gated xorshift32 noise burst in the second half. Integer arithmetic only,
 * so the bytes are the same on every platform and every Node version.
 */
function synthWav(sampleRate: number, seconds: number): Buffer {
  const n = sampleRate * seconds;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(n * 2, 40);
  let phase = 0;
  let step = Math.floor((2 ** 32 * 220) / sampleRate);
  const stepInc = Math.max(1, Math.floor(step / n));
  let x = 0x9e3779b9;
  for (let i = 0; i < n; i++) {
    phase = (phase + step) >>> 0;
    step += stepInc;
    const tri = phase < 0x80000000 ? phase : 0x100000000 - phase; // 0 .. 2^31
    let s = Math.floor(tri / 0x20000) - 8192; // ±8192
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    if (i >= n >> 1) s += (x >>> 20) - 2048; // ±2048 noise burst
    const fadeIn = Math.min(i, 441);
    const fadeOut = Math.min(n - 1 - i, 441);
    s = Math.trunc((s * Math.min(fadeIn, fadeOut)) / 441);
    buf.writeInt16LE(s, 44 + i * 2);
  }
  return buf;
}

interface EncodeProfile {
  readonly name: string;
  readonly ext: 'ogg' | 'm4a';
  readonly input: 'test44' | 'synth44' | 'synth48';
  readonly args: readonly string[];
}

const BITEXACT = ['-bitexact', '-map_metadata', '-1'];

const PROFILES: readonly EncodeProfile[] = [
  // The SSP-025 verification commands, verbatim apart from the output name.
  { name: 'issue-opus', ext: 'ogg', input: 'test44', args: ['-c:a', 'libopus', ...BITEXACT] },
  { name: 'issue-aac', ext: 'm4a', input: 'test44', args: ['-c:a', 'aac', ...BITEXACT] },
  // AUDIO_DESIGN §11.3: SFX (44.1 kHz) and music stems (48 kHz), exact flags.
  {
    name: 'sfx-opus-64k',
    ext: 'ogg',
    input: 'synth44',
    args: ['-c:a', 'libopus', '-b:a', '64k', '-vbr', 'on', '-application', 'audio', '-ac', '1', ...BITEXACT],
  },
  {
    name: 'sfx-aac-96k',
    ext: 'm4a',
    input: 'synth44',
    args: [
      '-c:a',
      'aac',
      '-profile:a',
      'aac_low',
      '-b:a',
      '96k',
      '-ac',
      '1',
      '-movflags',
      '+faststart',
      ...BITEXACT,
    ],
  },
  {
    name: 'music-opus-96k',
    ext: 'ogg',
    input: 'synth48',
    args: ['-c:a', 'libopus', '-b:a', '96k', '-vbr', 'on', '-application', 'audio', '-ac', '1', ...BITEXACT],
  },
  {
    name: 'music-aac-128k',
    ext: 'm4a',
    input: 'synth48',
    args: [
      '-c:a',
      'aac',
      '-profile:a',
      'aac_low',
      '-b:a',
      '128k',
      '-ac',
      '1',
      '-movflags',
      '+faststart',
      ...BITEXACT,
    ],
  },
];

function findFfmpeg(): string {
  if (process.env.FFMPEG) return process.env.FFMPEG;
  if (existsSync('/opt/homebrew/bin/ffmpeg')) return '/opt/homebrew/bin/ffmpeg';
  return 'ffmpeg';
}

// ---------------------------------------------------------------------------------------------------------------
// Local measurement

function measure(runs: number): number {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const report: string[] = [];
  const hashes: string[] = [];
  const failures: string[] = [];
  const say = (line = ''): void => {
    report.push(line);
    process.stdout.write(`${line}\n`);
  };

  // Platform and versions.
  const ffmpeg = findFfmpeg();
  const py = mustRun(UV, [
    'run',
    '--project',
    'tools/forge',
    'python',
    '-c',
    [
      'import platform, sys, zlib, numpy, PIL',
      'from PIL import features',
      'print("python", sys.version.split()[0], platform.platform(), platform.machine())',
      'print("numpy", numpy.__version__)',
      'print("pillow", PIL.__version__, "zlib", features.version("zlib"))',
      'print("python zlib", zlib.ZLIB_RUNTIME_VERSION)',
    ].join('\n'),
  ]);
  say(`# SSP-025 pipeline determinism: ${tag}`);
  say(`os        ${platform()} ${release()} ${arch()}`);
  say(`node      ${process.version}`);
  say(`uv        ${firstLine(mustRun(UV, ['--version']).stdout)}`);
  for (const line of py.stdout.trim().split('\n')) say(`          ${line}`);
  say(`ffmpeg    ${ffmpeg}: ${firstLine(mustRun(ffmpeg, ['-hide_banner', '-version']).stdout)}`);
  say(`runs      ${runs}`);
  say();

  // D-12 (1): two cold builds into separate roots.
  say('## D-12 forge build --no-cache, twice');
  const roots = ['a', 'b'].map((n) => join(outDir, 'forge', n));
  const trees: string[][] = [];
  for (const root of roots) {
    const rel = relative(repoRoot, root);
    const r = mustRun(UV, [...FORGE, 'build', '--no-cache', '--out', rel]);
    say(`build --no-cache --out ${rel}: ${fmtSeconds(r.seconds)}`);
    trees.push(hashTree(root));
  }
  const [treeA = [], treeB = []] = trees;
  const sameBuild = treeA.join('\n') === treeB.join('\n');
  say(`same-machine byte identity (${treeA.length} files): ${sameBuild ? 'IDENTICAL' : 'DIFFERENT'}`);
  if (!sameBuild) failures.push('forge build is not byte-identical between two runs on this machine');
  const frames = treeA.filter((l) => l.includes('  frames/'));
  const outputs = treeA.filter((l) => !l.includes('  frames/'));
  hashes.push(`${sha256(`${frames.join('\n')}\n`)}  forge frames/ tree digest (${frames.length} files)`);
  for (const l of outputs) hashes.push(`${l.slice(0, 64)}  forge ${l.slice(66)}`);
  writeFileSync(join(outDir, 'forge-tree.sha256'), `${treeA.join('\n')}\n`);
  for (const l of outputs) say(`  ${l}`);
  say(`  ${hashes[0] ?? ''}`);
  say('  (full listing: forge-tree.sha256)');
  say();

  // D-12 (2): verify against the committed outputs (built on the dev Mac).
  say('## D-12 forge verify against the committed outputs');
  for (const mode of [[], ['--pixels']] as const) {
    const r = run(UV, [...FORGE, 'verify', ...mode]);
    const label = mode.length ? 'verify --pixels' : 'verify (bytes)';
    say(`${label}: exit ${r.status} (${fmtSeconds(r.seconds)})`);
    for (const line of (r.stdout + r.stderr).split('\n')) {
      if (line.startsWith('forge verify:')) say(`  ${line}`);
    }
    hashes.push(`${r.status === 0 ? 'pass' : 'FAIL'}  forge ${label}`);
    if (mode.length && r.status !== 0)
      failures.push('forge verify --pixels fails against the committed outputs');
  }
  say();

  // D-11: encoder determinism.
  say(`## D-11 ffmpeg encodes, ${runs} runs each`);
  const audioDir = join(outDir, 'audio');
  mkdirSync(audioDir, { recursive: true });
  const testWav = join(repoRoot, 'build', 'tmp', 'test.wav');
  mustRun(ffmpeg, [
    '-hide_banner',
    '-nostdin',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=2',
    '-c:a',
    'pcm_s16le',
    '-bitexact',
    testWav,
  ]);
  const inputs: Record<EncodeProfile['input'], string> = {
    test44: testWav,
    synth44: join(audioDir, 'synth44.wav'),
    synth48: join(audioDir, 'synth48.wav'),
  };
  writeFileSync(inputs.synth44, synthWav(44100, 2));
  writeFileSync(inputs.synth48, synthWav(48000, 4));
  for (const [name, path] of Object.entries(inputs)) {
    const h = sha256File(path);
    say(`input ${name}: ${h}  ${relative(repoRoot, path)}`);
    hashes.push(`${h}  wav ${name}`);
  }
  for (const p of PROFILES) {
    const seen: string[] = [];
    for (let i = 1; i <= runs; i++) {
      const out = join(audioDir, `${p.name}.${i}.${p.ext}`);
      mustRun(ffmpeg, [
        '-hide_banner',
        '-nostdin',
        '-loglevel',
        'error',
        '-y',
        '-i',
        inputs[p.input],
        ...p.args,
        out,
      ]);
      seen.push(sha256File(out));
    }
    const stable = seen.every((h) => h === seen[0]);
    say(`${p.name} (${p.input}): ${stable ? 'STABLE' : 'UNSTABLE'}  ${seen.join(' ')}`);
    say(`  ffmpeg -i <${p.input}> ${p.args.join(' ')} out.${p.ext}`);
    hashes.push(`${seen[0] ?? ''}  ${p.ext} ${p.name}${stable ? '' : ' (UNSTABLE on this machine)'}`);
    if (!stable) failures.push(`${p.name} is not byte-stable between runs on this machine`);
  }
  say();
  say(
    failures.length
      ? `RESULT: ${failures.length} same-machine failure(s)`
      : 'RESULT: all same-machine checks pass',
  );
  for (const f of failures) say(`  - ${f}`);

  writeFileSync(join(outDir, 'report.txt'), `${report.join('\n')}\n`);
  writeFileSync(join(outDir, 'hashes.txt'), `# ${tag}\n${hashes.join('\n')}\n`);
  process.stdout.write(`\nwrote ${relative(repoRoot, outDir)}/report.txt and hashes.txt\n`);
  return failures.length ? 1 : 0;
}

// ---------------------------------------------------------------------------------------------------------------
// --docker: the same measurement in an emulated linux/amd64 container

function measureInDocker(runs: number): number {
  const results = join(repoRoot, 'build', 'tmp', 'determinism');
  mkdirSync(results, { recursive: true });
  const script = [
    'set -euo pipefail',
    'export DEBIAN_FRONTEND=noninteractive',
    'apt-get update -qq',
    'apt-get install -y -qq --no-install-recommends ca-certificates curl xz-utils >/dev/null',
    `curl -LsSf https://astral.sh/uv/${UV_VERSION}/install.sh | env UV_INSTALL_DIR=/usr/local/bin UV_NO_MODIFY_PATH=1 sh`,
    `curl -LsSf https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-linux-x64.tar.xz | tar -xJ -C /opt`,
    `export PATH=/opt/node-${NODE_VERSION}-linux-x64/bin:$PATH`,
    `mkdir -p /opt/ffmpeg && curl -LsSf ${LINUX_FFMPEG_URL} | tar -xJ -C /opt/ffmpeg --strip-components=1`,
    'mkdir /work',
    'tar -C /src --exclude=./node_modules --exclude=./tools/forge/.venv --exclude=./build --exclude=./.git -cf - . | tar -C /work -xf -',
    'cd /work',
    `export UV_PYTHON=${PYTHON_VERSION}`,
    'uv sync --project tools/forge --frozen',
    'status=0',
    `FFMPEG=/opt/ffmpeg/bin/ffmpeg node tools/spikes/pipelineDeterminism.ts --runs ${runs} || status=$?`,
    'cp -R build/tmp/determinism/. /results/',
    'exit $status',
  ].join('\n');
  const r = spawnSync(
    'docker',
    [
      'run',
      '--rm',
      '--platform',
      'linux/amd64',
      '-v',
      `${repoRoot}:/src:ro`,
      '-v',
      `${results}:/results`,
      DOCKER_IMAGE,
      'bash',
      '-c',
      script,
    ],
    { stdio: 'inherit' },
  );
  if (r.error) throw new Error(`docker: ${r.error.message}`);
  return r.status ?? 1;
}

const args = process.argv.slice(2);
const runsAt = args.indexOf('--runs');
const runs = runsAt >= 0 ? Number(args[runsAt + 1]) : 3;
if (!Number.isInteger(runs) || runs < 2) throw new Error('--runs must be an integer >= 2');
process.exitCode = args.includes('--docker') ? measureInDocker(runs) : measure(runs);
