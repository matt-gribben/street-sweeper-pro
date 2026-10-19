// SSP-048: the F1 dev panel's pure parts (src/debug/devPanel.ts): the tuning field list and validated edits, the
// changed-value list behind Copy tuning JSON, the readouts, Save replay's tuning-diverged guard and the replay
// file it writes (accepted by the replay runner), plus the static checks that keep the panel out of release
// builds. The DOM half is checked in the browser (`npm run dev`, F1); ShiftScene's live tuning is in
// shiftScene.test.ts.
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import tuningJson from '../../src/data/tuning.json' with { type: 'json' };
import {
  buildReplay,
  changedTuningPaths,
  DEV_PANEL_ID,
  editTuning,
  listTuningFields,
  type ReplaySource,
  readTuningValue,
  replayVerdict,
  shiftReadout,
  surfaceName,
  type TuningField,
  tuningJsonText,
} from '../../src/debug/devPanel.ts';
import { DEG_TO_RAD } from '../../src/sim/constants.ts';
import { createInputFrame, PRESSED } from '../../src/sim/inputFrame.ts';
import { decodeLevel, Surface } from '../../src/sim/map.ts';
import {
  appendInput,
  compareCheckpoints,
  createInputLog,
  loadReplay,
  REPLAY_TICKS,
  runReplay,
} from '../../src/sim/replay.ts';
import {
  DEFAULT_TUNING,
  loadTuning,
  type Tuning,
  tuningSourceCopy,
  tuningsEqual,
} from '../../src/sim/tuning.ts';
import { createWorld, viewWorld, type World } from '../../src/sim/world.ts';
import { assertHeapDeltaWithinThresholds } from '../support/heapDelta.ts';
import { measureReplayHeapInChild } from '../support/replayCheck.ts';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const LEVEL_PATH = join(REPO_ROOT, 'public/assets/levels/puddle_lane.json');
const level = decodeLevel(readFileSync(LEVEL_PATH, 'utf8'));

function field(path: string): TuningField {
  const found = listTuningFields(tuningSourceCopy()).find((f) => f.path === path);
  if (found === undefined) throw new Error(`no field ${path}`);
  return found;
}

/** A recorded shift without the scene: a World with the input log on its phase-1 hook, like ShiftScene's. */
function recordedShift(ticks: number, flags: { committed?: boolean; logMatches?: boolean } = {}) {
  const world: World = createWorld(level, 7, DEFAULT_TUNING);
  const log = createInputLog();
  world.recordInput = (tick, input) => {
    if (log.length < log.capacity) appendInput(log, tick, input);
  };
  const input = createInputFrame();
  for (let t = 0; t < ticks; t++) {
    input.throttle = t < 200 ? 255 : 0;
    input.brake = t >= 200 ? 255 : 0;
    input.steer = t > 60 && t < 120 ? 90 : 0;
    input.pressed = t === 10 ? PRESSED.BRUSH : 0;
    world.step(input);
  }
  const source: ReplaySource & { tuning: Tuning } = {
    worldView: viewWorld(world),
    district: level.id,
    inputLog: log,
    tuningIsCommitted: flags.committed ?? true,
    logMatchesCommittedTuning: flags.logMatches ?? true,
    tuning: DEFAULT_TUNING,
  };
  return { world, log, source };
}

describe('tuning fields', () => {
  it('lists every numeric vehicle.sweeper value of tuning.json in JSON order, not the provisional list', () => {
    const fields = listTuningFields(tuningJson);
    const sweeper: Record<string, unknown> = tuningJson.vehicle.sweeper;
    const expected = Object.entries(sweeper).flatMap(([group, values]) =>
      typeof values === 'object' && values !== null && !Array.isArray(values)
        ? Object.keys(values).map((key) => `${group}.${key}`)
        : [],
    );
    expect(fields.map((f) => f.path)).toEqual(expected);
    expect(fields.length).toBe(45);
    expect(fields.map((f) => f.path)).toContain('steering.maxSteerDeg');
    expect(fields.map((f) => f.path)).toContain('drive.topSpeedTransitMps');
    expect(fields.some((f) => f.group === 'provisional')).toBe(false);
    expect(readTuningValue(tuningJson, field('drive.topSpeedTransitMps'))).toBe(11);
  });

  it('applies a valid edit to a fresh copy and validates it (degrees become radians)', () => {
    const raw = tuningSourceCopy();
    const edit = editTuning(raw, field('steering.maxSteerDeg'), 40);
    if (!edit.ok) throw new Error(edit.error);
    expect(edit.tuning.vehicle.sweeper.steering.maxSteerRad).toBeCloseTo(40 * DEG_TO_RAD, 15);
    expect(readTuningValue(edit.raw, field('steering.maxSteerDeg'))).toBe(40);
    // The copy it started from, and the committed tuning, are untouched.
    expect(readTuningValue(raw, field('steering.maxSteerDeg'))).toBe(34);
    expect(DEFAULT_TUNING.vehicle.sweeper.steering.maxSteerRad).toBeCloseTo(34 * DEG_TO_RAD, 15);
    expect(changedTuningPaths(edit.raw, tuningJson)).toEqual(['steering.maxSteerDeg']);
  });

  it('refuses what loadTuning rejects, with its message, and changes nothing', () => {
    const raw = tuningSourceCopy();
    const negative = editTuning(raw, field('drive.topSpeedTransitMps'), -1);
    expect(negative).toEqual({
      ok: false,
      error: 'tuning: vehicle.sweeper.drive.topSpeedTransitMps must be > 0, got -1',
    });
    const nan = editTuning(raw, field('drive.accelMps2'), Number.NaN);
    expect(nan.ok).toBe(false);
    // Brush-down top speed may not exceed transit (a cross-field check).
    const tooFast = editTuning(raw, field('drive.topSpeedBrushDownMps'), 12);
    expect(tooFast.ok).toBe(false);
    if (!tooFast.ok) expect(tooFast.error).toMatch(/topSpeedBrushDownMps must not exceed topSpeedTransitMps/);
    expect(editTuning(raw, { group: 'drive', key: 'warpFactor', path: 'drive.warpFactor' }, 9).ok).toBe(
      false,
    );
    expect(changedTuningPaths(raw, tuningJson)).toEqual([]);
  });

  it('round-trips: editing back to the committed value gives a Tuning equal to DEFAULT_TUNING', () => {
    const up = editTuning(tuningSourceCopy(), field('drive.topSpeedTransitMps'), 14);
    if (!up.ok) throw new Error(up.error);
    expect(tuningsEqual(up.tuning, DEFAULT_TUNING)).toBe(false);
    const back = editTuning(up.raw, field('drive.topSpeedTransitMps'), 11);
    if (!back.ok) throw new Error(back.error);
    expect(tuningsEqual(back.tuning, DEFAULT_TUNING)).toBe(true);
    expect(changedTuningPaths(back.raw, tuningJson)).toEqual([]);
  });

  it('Copy tuning JSON gives a whole tuning.json that loadTuning accepts', () => {
    const edit = editTuning(tuningSourceCopy(), field('steering.steerRateDegPerS'), 150);
    if (!edit.ok) throw new Error(edit.error);
    const text = tuningJsonText(edit.raw);
    expect(text.endsWith('}\n')).toBe(true);
    const pasted: unknown = JSON.parse(text);
    expect(tuningsEqual(loadTuning(pasted), edit.tuning)).toBe(true);
    expect(changedTuningPaths(pasted, tuningJson)).toEqual(['steering.steerRateDegPerS']);
  });
});

describe('readouts', () => {
  it('names the surfaces', () => {
    expect(surfaceName(Surface.Asphalt)).toBe('asphalt');
    expect(surfaceName(Surface.Pavement)).toBe('pavement');
    expect(surfaceName(Surface.Grass)).toBe('grass');
    expect(surfaceName(Surface.WetLeaves)).toBe('wetLeaves');
    expect(surfaceName(99)).toBe('surface 99');
  });

  it('shows speed (m/s and mph), top speed against the limit, steer angle in degrees and the surface', () => {
    const { world, source } = recordedShift(90);
    const v = world.vehicle;
    const text = shiftReadout(source, 5.5);
    const lines = text.split('\n');
    expect(lines[0]).toBe(`tick 90  FWD  brush down  hp ${v.hp.toFixed(1)}`);
    expect(lines[1]).toBe(`speed ${v.vLongMps.toFixed(2)} m/s  ${(v.vLongMps / 0.44704).toFixed(1)} mph`);
    // Brush down: the limit is the brush-down top speed.
    expect(lines[2]).toBe('top 5.50 m/s  (limit 6.00)');
    expect(lines[3]).toMatch(new RegExp(`^steer ${((v.steerRad * 180) / Math.PI).toFixed(1)}° `));
    expect(v.steerRad).toBeGreaterThan(0);
    // The depot start is on the yard apron's asphalt or pavement; either way a named surface.
    expect(lines[4]).toMatch(/^surface (asphalt|pavement|grass) {2}grip k \d+\.\d\d\/s {2}roll ×\d\.\d\d$/);
    expect(lines[5]).toBe('log 90/14400  tuning tuning.json');
    const edited = { ...source, tuningIsCommitted: false, logMatchesCommittedTuning: false };
    expect(shiftReadout(edited, 0).split('\n')[5]).toBe('log 90/14400  tuning EDITED  (log diverged)');
    expect(shiftReadout({ ...source, worldView: null }, 0)).toBe('shift loading…');
  });
});

describe('Save replay', () => {
  it('refuses an empty recording', () => {
    const { source } = recordedShift(0);
    expect(replayVerdict(source).kind).toBe('empty');
    expect(replayVerdict({ ...source, inputLog: null }).kind).toBe('empty');
    expect(() => buildReplay(source)).toThrow(/no recorded shift/);
  });

  it('refuses when recorded ticks ran on edited tuning, or the tuning is edited now', () => {
    const { source } = recordedShift(REPLAY_TICKS);
    expect(replayVerdict(source)).toEqual({ kind: 'ok' });
    const now = replayVerdict({ ...source, tuningIsCommitted: false });
    expect(now.kind).toBe('refused');
    if (now.kind === 'refused') {
      expect(now.reasons).toEqual(['the tuning is edited now (replays are hashed on tuning.json)']);
      expect(now.message).toMatch(/^Save replay REFUSED: the tuning is edited now/);
      expect(now.message).toMatch(/Click again to save anyway\.$/);
    }
    const past = replayVerdict({ ...source, logMatchesCommittedTuning: false });
    expect(past.kind).toBe('refused');
    if (past.kind === 'refused') expect(past.reasons[0]).toMatch(/^recorded ticks ran on edited tuning/);
  });

  it('refuses fewer than the 3,600 ticks the replay runner needs', () => {
    const { source } = recordedShift(REPLAY_TICKS - 1);
    const verdict = replayVerdict(source);
    expect(verdict.kind).toBe('refused');
    if (verdict.kind === 'refused') {
      expect(verdict.reasons).toEqual([
        'only 3599 of the 3600 ticks a replay needs are recorded (keep driving)',
      ]);
    }
    const both = replayVerdict({ ...source, tuningIsCommitted: false });
    expect(both.kind === 'refused' ? both.reasons.length : 0).toBe(2);
  });

  it('writes a replay file of the whole log that the replay runner accepts: hashes, and the heap check', () => {
    const ticks = REPLAY_TICKS + 250;
    const { world, source } = recordedShift(ticks);
    expect(replayVerdict(source)).toEqual({ kind: 'ok' });
    const { fileName, text } = buildReplay(source);
    expect(fileName).toBe(`puddle_lane_seed7_${ticks}t.json`);
    const { file, log } = loadReplay(text);
    expect(file.district).toBe('district.puddle_lane');
    expect(file.seed).toBe(7);
    expect(file.ticks).toBe(ticks);
    expect(Object.keys(file.checkpoints)).toEqual([
      '600',
      '1200',
      '1800',
      '2400',
      '3000',
      '3600',
      String(ticks),
    ]);
    expect(file.invariants).toEqual({});
    // What `npm run test:replay` does with a file in tests/replay/replays/: run on tuning.json, compare.
    const run = runReplay(level, DEFAULT_TUNING, file.seed, log, file.ticks);
    expect(compareCheckpoints(file.checkpoints, run.checkpoints, file.ticks)).toBeNull();
    // The headless run ends exactly where the live World did.
    expect(run.world.vehicle).toEqual(world.vehicle);
    // And the runner's §17 heap check, in a fresh process as tests/replay/replay.test.ts runs it.
    const dir = mkdtempSync(join(tmpdir(), 'ssp-devpanel-'));
    try {
      const replayPath = join(dir, fileName);
      writeFileSync(replayPath, text);
      const delta = measureReplayHeapInChild({ kind: 'file', replayPath, levelPath: LEVEL_PATH });
      assertHeapDeltaWithinThresholds(delta);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});

describe('release builds', () => {
  const srcFiles = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? srcFiles(join(dir, e.name)) : [join(dir, e.name)],
    );

  it('keeps the ssp-dev-panel marker in devPanel.ts alone', () => {
    expect(DEV_PANEL_ID).toBe('ssp-dev-panel');
    const hits = srcFiles(join(REPO_ROOT, 'src'))
      .filter((file) => readFileSync(file, 'utf8').includes(DEV_PANEL_ID))
      .map((file) => relative(REPO_ROOT, file));
    expect(hits).toEqual(['src/debug/devPanel.ts']);
  });

  it('imports devPanel.ts only dynamically, inside an import.meta.env.DEV block of main.ts', () => {
    for (const file of srcFiles(join(REPO_ROOT, 'src'))) {
      const text = readFileSync(file, 'utf8');
      // Type-only imports are erased; nothing may import the module's values statically.
      expect(text, relative(REPO_ROOT, file)).not.toMatch(/^import (?!type)[^;]*devPanel\.ts/m);
    }
    const main = readFileSync(join(REPO_ROOT, 'src/main.ts'), 'utf8');
    expect(main).toMatch(
      /if \(import\.meta\.env\.DEV && !testMode\) \{\n\s+void import\('\.\/debug\/devPanel\.ts'\)/,
    );
  });
});
