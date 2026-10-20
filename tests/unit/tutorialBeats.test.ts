// SSP-290: Puddle Lane's 13 tutorial_beat events (GDD §16.2, LEVEL_DESIGN §4.4, §8.4) and their compiler rules.
// The compiled beats, rendered with the default keyboard bindings, must equal the GDD §16.2 'Pam says' column with
// its markup removed (the GDD is the single owner of the text); the compiler rejects an unknown trigger, a trigger
// used twice and a beat outside Puddle Lane with named errors, and compiles the level byte-identically twice.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_GLYPHS } from '../../src/app/glyphBindings.ts';
import { decodeLevel, TUTORIAL_TRIGGERS } from '../../src/sim/map.ts';
import { DEFAULT_TUNING } from '../../src/sim/tuning.ts';
import { barkPlainText, parseBark } from '../../src/ui/radio.ts';
import { TUTORIAL_LESSONS, tutorialBeats } from '../../src/ui/tutorial.ts';
import { compileLevel, formatDiagnostic, readManifestIds } from '../../tools/levels/compile-level.ts';
import { KERB_BLOB_PATH, readKerbBlob } from '../../tools/levels/kerbBlob.ts';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel: string): string => readFileSync(join(REPO_ROOT, rel), 'utf8');
const MAP_TEXT = read('assets-src/levels/puddle_lane.map.txt');
const LEVEL_TEXT = read('assets-src/levels/puddle_lane.level.json');
const KNOWN = readManifestIds(join(REPO_ROOT, 'assets-src/manifest.json'));
const BLOB = readKerbBlob(join(REPO_ROOT, KERB_BLOB_PATH));
const COMPILED = decodeLevel(read('public/assets/levels/puddle_lane.json'));

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ssp-tutorial-'));
  tempDirs.push(dir);
  return dir;
}

/** Puddle Lane with its level.json events replaced. */
function compileWithEvents(events: unknown[]) {
  const doc = { ...JSON.parse(LEVEL_TEXT), events };
  return compileLevel({
    name: 'puddle_lane',
    mapText: MAP_TEXT,
    levelText: `${JSON.stringify(doc, null, 2)}\n`,
    knownAssetIds: KNOWN,
    kerbBlob: BLOB,
  });
}

/** The GDD §16.2 table: each row's number, trigger cell and 'Pam says' quote with the markdown markup removed. */
function gddBeats(): { n: number; trigger: string; text: string }[] {
  const gdd = read('docs/GDD.md');
  const start = gdd.indexOf('### 16.2 ');
  const end = gdd.indexOf('\n### ', start + 1);
  const rows: { n: number; trigger: string; text: string }[] = [];
  for (const line of gdd.slice(start, end).split('\n')) {
    const cells = line.split('|').map((c) => c.trim());
    const n = Number(cells[1]);
    if (!/^\d+$/.test(cells[1] ?? '')) continue;
    const quote = /^"(.*)"/.exec(cells[3] ?? '');
    if (quote === null) throw new Error(`GDD §16.2 row ${n} has no quoted bark`);
    rows.push({
      n,
      trigger: cells[2] ?? '',
      text: (quote[1] ?? '').replaceAll('**', '').replaceAll('*', ''),
    });
  }
  return rows;
}

describe('the 13 Puddle Lane tutorial beats (GDD §16.2)', () => {
  const beats = tutorialBeats(COMPILED);
  const context = {
    glyphs: DEFAULT_GLYPHS,
    device: 'keyboard',
    cleanSpeedMps: DEFAULT_TUNING.vehicle.sweeper.brush.cleanPickupMaxMps,
  } as const;

  it('compiles 13 tutorial_beat schedules, one per trigger, in GDD order', () => {
    expect(beats.map((b) => b.trigger)).toEqual([...TUTORIAL_TRIGGERS]);
    expect(beats.map((b) => b.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    for (const e of COMPILED.schedules.filter((s) => s.type === 'tutorial_beat')) {
      expect(e.atS).toEqual([]);
      expect(e.untilS).toBeNull();
      expect(Object.keys(e.params)).toEqual(['text']);
    }
    expect(gddBeats()).toHaveLength(13);
  });

  it("rendered with the default keyboard bindings, each beat is the GDD's 'Pam says' text without its markup", () => {
    const want = gddBeats().map((r) => r.text);
    const got = beats.map((b) => barkPlainText(parseBark(b.text), context));
    expect(got).toEqual(want);
    // The bolded keys and the speed come from tokens, never from literal text.
    expect(beats[0]?.text).toContain('{throttle} to go, {steer} to steer.');
    expect(beats[1]?.text).toContain('{brush}');
    expect(beats[2]?.text).toContain('{cleanSpeed}');
    expect(beats[7]?.text).toContain('{interact}');
  });

  it('beat 13 is the GDD trigger `timer_remaining<=60` by name', () => {
    expect(gddBeats()[12]?.trigger).toContain('`timer_remaining<=60`');
    expect(beats[12]?.trigger).toBe('timer_remaining<=60');
  });

  it('gives every beat a distinct lesson; beats 1, 2, 8 and 9 are action beats', () => {
    const lessons = beats.map((b) => b.lesson);
    expect(new Set(lessons).size).toBe(13);
    expect(lessons.slice(0, 2)).toEqual(['drive', 'brush']);
    const actions = beats.filter((b) => TUTORIAL_LESSONS[b.trigger].learnedBy !== 0).map((b) => b.n);
    expect(actions).toEqual([1, 2, 8, 9]);
  });

  it('the layer refuses a level whose beat has an unknown trigger or a bad token', () => {
    const schedule = (trigger: string, text: string) => ({
      schedules: [{ type: 'tutorial_beat' as const, atS: [], untilS: null, trigger, params: { text } }],
    });
    expect(() => tutorialBeats(schedule('moved_ten_metres', 'Hi.'))).toThrow(/moved_ten_metres/);
    expect(() => tutorialBeats(schedule('shift_start', 'Press {jump}.'))).toThrow(/unknown token \{jump\}/);
    expect(() => tutorialBeats(schedule('shift_start', ' '))).toThrow(/empty text/);
  });
});

describe('compile-level: tutorial_beat rules (SSP-290)', () => {
  const beat = (trigger: string, text = 'Hello, rookie.') => ({ type: 'tutorial_beat', trigger, text });
  const messages = (r: ReturnType<typeof compileWithEvents>): string[] =>
    r.diagnostics.map((d) => `${d.code} ${d.message}`);

  it('compiles the authored beats with no diagnostics', () => {
    const r = compileWithEvents(JSON.parse(LEVEL_TEXT).events);
    expect(r.diagnostics.map(formatDiagnostic)).toEqual([]);
  });

  it('rejects an unknown trigger, naming it and the known set', () => {
    const r = compileWithEvents([beat('shift_start'), beat('moved_ten_metres')]);
    expect(r.output).toBeNull();
    expect(messages(r)).toEqual([
      `L000 events[1] (tutorial_beat) trigger "moved_ten_metres" is not a tutorial trigger (one of ${TUTORIAL_TRIGGERS.join(', ')})`,
    ]);
  });

  it('rejects a trigger used twice, a missing trigger and an empty text', () => {
    const r = compileWithEvents([
      beat('first_pickup'),
      beat('first_pickup'),
      { type: 'tutorial_beat', text: 'No trigger.' },
      beat('chain_10', '  '),
    ]);
    expect(messages(r)).toEqual([
      'L000 events[1] (tutorial_beat) trigger "first_pickup" is already used by events[0]',
      'L000 events[2] (tutorial_beat) needs a trigger (the sim event that shows it)',
      'L000 events[3] (tutorial_beat) needs a non-empty text',
    ]);
  });

  it('`npm run levels` fails on an unknown trigger with the named error (exit 1)', () => {
    const src = tempDir();
    copyFileSync(join(REPO_ROOT, 'assets-src/levels/puddle_lane.map.txt'), join(src, 'puddle_lane.map.txt'));
    const doc = JSON.parse(LEVEL_TEXT);
    doc.events[1].trigger = 'moved_ten_metres';
    writeFileSync(join(src, 'puddle_lane.level.json'), `${JSON.stringify(doc, null, 2)}\n`);
    const r = spawnSync(
      process.execPath,
      ['tools/levels/compile-level.ts', '--src', src, '--out', tempDir()],
      {
        cwd: REPO_ROOT,
        encoding: 'utf8',
      },
    );
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(
      /^puddle_lane\.level\.json:\d+:\d+ L000 events\[1\] \(tutorial_beat\) trigger "moved_ten_metres" is not a tutorial trigger/m,
    );
  });

  it('`npm run levels` is deterministic: two compiles give the committed puddle_lane.json, byte for byte', () => {
    const hashes = [tempDir(), tempDir()].map((out) => {
      const r = spawnSync(process.execPath, ['tools/levels/compile-level.ts', '--out', out], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
      });
      expect(r.status, r.stderr).toBe(0);
      const text = readFileSync(join(out, 'public/assets/levels/puddle_lane.json'));
      return createHash('sha256').update(text).digest('hex');
    });
    const committed = createHash('sha256')
      .update(readFileSync(join(REPO_ROOT, 'public/assets/levels/puddle_lane.json')))
      .digest('hex');
    expect(hashes).toEqual([committed, committed]);
  });
});
