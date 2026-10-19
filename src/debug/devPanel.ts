// F1 dev panel (TECHNICAL_DESIGN §18.3, §20.2; ROADMAP M1, R-07; SSP-048). Dev builds only: main.ts imports this
// module dynamically behind `import.meta.env.DEV` (and never in test mode), so release builds tree-shake it away;
// `npm run build && ! grep -r 'ssp-dev-panel' dist/` checks that the marker below never ships. Plain DOM, no
// tweakpane (ROADMAP §7). A DOM overlay costs no WebGL draw call.
//
// It is the R-07 handling-tuning loop's tool:
//   - live tuning: a number input per vehicle.sweeper value of tuning.json. The panel edits a copy of the
//     parsed JSON (tuningSourceCopy), validates it with loadTuning and hands the result to the shift through
//     ShiftScene.setTuning, which reaches the World at its parameter boundary (setWorldTuning) between ticks;
//     the panel never writes sim state (CLAUDE.md hard rule 2). A value loadTuning rejects is shown, not applied;
//   - readouts, every frame: speed (m/s and mph, GDD §7.2), the top speed reached since the last tuning change
//     against the current limit, steer angle and the lock available at this speed (degrees), and the surface
//     under Bessie's body centre with the wheels' average grip;
//   - Save replay: downloads the shift's whole recorded input log as a replay file (replay.ts recordReplay, hashed
//     on the committed tuning.json, which is what `npm run test:replay` runs). A replay reproduces only under one
//     tuning, so when any recorded tick ran on edited tuning (or the tuning is edited now), or fewer than 3,600
//     ticks are recorded (see replayVerdict), the first click refuses and explains; a second click saves anyway.
//     Reload the page for a clean recording;
//   - Copy tuning JSON: the edited tuning.json text, to paste into src/data/tuning.json with GDD §7 updated in
//     the same commit (R-07). Nothing is persisted automatically;
//   - the M0 camera controls (speed zoom and night switches, the spike scenes' pan speed) and the renderer
//     status line, which tools/spikes/* read (`draw calls N` in the panel's one <pre>; night is checkbox 2).
//
// F1 is a scene-layer action (src/input/actions.ts): it never reaches the sim. The Game calls the panel's
// frame() after every drawn frame with that frame's scene-layer edges.
import type { DriveSettings } from '../app/Game.ts';
import { ACTION } from '../input/actions.ts';
import type { ShiftScene } from '../scenes/ShiftScene.ts';
import { Surface } from '../sim/map.ts';
import { REPLAY_TICKS, recordReplay, serialiseReplay } from '../sim/replay.ts';
import { surfaceAt } from '../sim/surface.ts';
import { DEFAULT_TUNING, loadTuning, type Tuning, tuningSourceCopy, tuningsEqual } from '../sim/tuning.ts';
import { Gear } from '../sim/vehicle.ts';

/** The panel's element id: the marker string the release-bundle check greps for. */
export const DEV_PANEL_ID = 'ssp-dev-panel';

/** International mile (1,609.344 m) per hour, in m/s: a unit definition, not a design number. */
const MPS_PER_MPH = 1609.344 / 3600;

const RAD_TO_DEG = 180 / Math.PI;

/** M0 spike scenes' camera pan slider range (Game.drive.speedMps). */
const MAX_PAN_SPEED_MPS = 12;

/** Groups shown unfolded: where max steer and the top speeds live. */
const OPEN_GROUPS = ['drive', 'steering'];

// ---------------------------------------------------------------------------------------------------------
// Pure helpers (unit-tested in tests/unit/devPanel.test.ts)
// ---------------------------------------------------------------------------------------------------------

/** One editable number: `path` is relative to vehicle.sweeper, e.g. 'steering.maxSteerDeg'. */
export type TuningField = { readonly group: string; readonly key: string; readonly path: string };

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** vehicle.sweeper of a raw tuning copy; throws if the copy has no such object. */
function sweeperOf(raw: unknown): JsonObject {
  const sweeper = isObject(raw) && isObject(raw.vehicle) ? raw.vehicle.sweeper : undefined;
  if (!isObject(sweeper)) throw new Error('dev panel: tuning has no vehicle.sweeper object');
  return sweeper;
}

/** Every numeric value of vehicle.sweeper in JSON order (the `provisional` list is not a number). */
export function listTuningFields(raw: unknown): TuningField[] {
  const fields: TuningField[] = [];
  for (const [group, values] of Object.entries(sweeperOf(raw))) {
    if (!isObject(values)) continue;
    for (const [key, value] of Object.entries(values)) {
      if (typeof value === 'number') fields.push({ group, key, path: `${group}.${key}` });
    }
  }
  return fields;
}

/** The value of `field` in a raw tuning copy (NaN if it is not a number). */
export function readTuningValue(raw: unknown, field: TuningField): number {
  const group = sweeperOf(raw)[field.group];
  const value = isObject(group) ? group[field.key] : undefined;
  return typeof value === 'number' ? value : Number.NaN;
}

/** Result of one edit: the new raw copy and its validated Tuning, or loadTuning's error message. */
export type TuningEdit =
  | { readonly ok: true; readonly raw: unknown; readonly tuning: Tuning }
  | { readonly ok: false; readonly error: string };

/** A fresh raw copy with `field` set to `value`, validated by loadTuning. `raw` itself is left alone. */
export function editTuning(raw: unknown, field: TuningField, value: number): TuningEdit {
  const copy: unknown = JSON.parse(JSON.stringify(raw));
  const group = sweeperOf(copy)[field.group];
  if (!isObject(group) || typeof group[field.key] !== 'number') {
    return { ok: false, error: `no tuning value vehicle.sweeper.${field.path}` };
  }
  group[field.key] = value;
  try {
    return { ok: true, raw: copy, tuning: loadTuning(copy) };
  } catch (error: unknown) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Paths (relative to vehicle.sweeper) whose values in `raw` differ from `committed`, in JSON order. */
export function changedTuningPaths(raw: unknown, committed: unknown): string[] {
  return listTuningFields(committed)
    .filter((field) => !Object.is(readTuningValue(raw, field), readTuningValue(committed, field)))
    .map((field) => field.path);
}

/** The text Copy tuning JSON puts on the clipboard: a whole tuning.json (run `npm run format` after pasting). */
export function tuningJsonText(raw: unknown): string {
  return `${JSON.stringify(raw, null, 2)}\n`;
}

/** Lower-case name of a Surface id ('asphalt', 'pavement', 'grass', …). */
export function surfaceName(id: number): string {
  for (const [name, value] of Object.entries(Surface)) {
    if (value === id) return name.charAt(0).toLowerCase() + name.slice(1);
  }
  return `surface ${id}`;
}

/** What Save replay needs from the shift (ShiftScene satisfies it). */
export type ReplaySource = Pick<
  ShiftScene,
  'worldView' | 'district' | 'inputLog' | 'tuningIsCommitted' | 'logMatchesCommittedTuning'
>;

/**
 * The shift the panel edits and saves: a ShiftScene, or the shift flow's stand-in for whichever ShiftScene is
 * running (src/app/shiftFlow.ts devShift, SSP-071), so tuning edits carry over into Try Again.
 */
export type DevShift = ReplaySource & Pick<ShiftScene, 'tuning' | 'setTuning'>;

/**
 * Save replay's verdict: 'ok'; 'empty' (nothing to save); or 'refused', with the reasons, when the file would
 * not be a faithful corpus replay. A refused save goes ahead only on a second click.
 */
export type ReplayVerdict =
  | { readonly kind: 'ok' }
  | { readonly kind: 'empty'; readonly message: string }
  | { readonly kind: 'refused'; readonly reasons: readonly string[]; readonly message: string };

/**
 * The guard (SSP-048) on this shift's log. Refused when:
 *   - the tuning differs from tuning.json, now or during any recorded tick: the replay is hashed on the committed
 *     tuning.json (what `npm run test:replay` runs), so it would not reproduce the drive as played;
 *   - fewer than REPLAY_TICKS (3,600, the standard length) ticks are recorded: the runner's heap check cycles a
 *     short replay through a fresh World every `ticks` ticks across its 4,200-tick window, and those World
 *     switches allocate past its threshold (a 390-tick file allocated 3.5 MB pre-final-GC), so test:replay
 *     would fail a short file even though its hashes match.
 */
export function replayVerdict(shift: ReplaySource): ReplayVerdict {
  const log = shift.inputLog;
  if (shift.worldView === null || shift.district === null || log === null || log.length === 0) {
    return { kind: 'empty', message: 'Save replay: nothing recorded yet (dev builds record from tick 0).' };
  }
  const reasons: string[] = [];
  if (!shift.logMatchesCommittedTuning) {
    reasons.push(
      'recorded ticks ran on edited tuning, so the replay (hashed on tuning.json) would not reproduce this drive',
    );
  } else if (!shift.tuningIsCommitted) {
    reasons.push('the tuning is edited now (replays are hashed on tuning.json)');
  }
  if (log.length < REPLAY_TICKS) {
    reasons.push(
      `only ${log.length} of the ${REPLAY_TICKS} ticks a replay needs are recorded (keep driving)`,
    );
  }
  if (reasons.length === 0) return { kind: 'ok' };
  return {
    kind: 'refused',
    reasons,
    message:
      `Save replay REFUSED: ${reasons.join('; ')}. For a clean recording: Reset tuning, reload and drive at ` +
      'least 60 s. Click again to save anyway.',
  };
}

/** A replay file of the shift's whole input log, hashed on the committed tuning.json, and its file name. */
export function buildReplay(shift: ReplaySource): { readonly fileName: string; readonly text: string } {
  const world = shift.worldView;
  const log = shift.inputLog;
  const district = shift.district;
  if (world === null || log === null || district === null || log.length === 0) {
    throw new Error('dev panel: no recorded shift to save');
  }
  const file = recordReplay(world.level, DEFAULT_TUNING, district, world.seed, log);
  const name = district.slice('district.'.length);
  return { fileName: `${name}_seed${file.seed}_${file.ticks}t.json`, text: serialiseReplay(file) };
}

/** The shift readout lines: tick, speed, top speed, steer, surface, HP, recording state. */
export function shiftReadout(shift: ReplaySource & Pick<ShiftScene, 'tuning'>, topSpeedMps: number): string {
  const world = shift.worldView;
  if (world === null) return 'shift loading…';
  const v = world.vehicle;
  const t = shift.tuning.vehicle.sweeper;
  const limit = v.brushDown ? t.drive.topSpeedBrushDownMps : t.drive.topSpeedTransitMps;
  const lockRad = t.steering.maxSteerRad / (1 + Math.abs(v.vLongMps) / t.steering.steerFalloffMps);
  const log = shift.inputLog;
  const recording =
    log === null
      ? 'not recording'
      : `log ${log.length}/${log.capacity}${log.length === log.capacity ? ' (full)' : ''}`;
  return [
    `tick ${world.tick}  ${v.gear === Gear.Rev ? 'REV' : 'FWD'}  brush ${v.brushDown ? 'down' : 'up'}  hp ${v.hp.toFixed(1)}`,
    `speed ${v.vLongMps.toFixed(2)} m/s  ${(v.vLongMps / MPS_PER_MPH).toFixed(1)} mph`,
    `top ${topSpeedMps.toFixed(2)} m/s  (limit ${limit.toFixed(2)})`,
    `steer ${(v.steerRad * RAD_TO_DEG).toFixed(1)}°  (lock ${(lockRad * RAD_TO_DEG).toFixed(1)}° at this speed)`,
    `surface ${surfaceName(surfaceAt(world.level, v.xM, v.yM))}  grip k ${world.surface.gripPerS.toFixed(2)}/s  roll ×${world.surface.rollMult.toFixed(2)}`,
    `${recording}  tuning ${shift.tuningIsCommitted ? 'tuning.json' : 'EDITED'}${shift.logMatchesCommittedTuning ? '' : '  (log diverged)'}`,
  ].join('\n');
}

// ---------------------------------------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------------------------------------

/** What main.ts hands the panel. */
export type DevPanelHost = {
  /** Camera settings the M0 controls edit in place (Game.drive). */
  readonly drive: DriveSettings;
  /** The shift (the flow's stand-in, SSP-071), or null in the spike scenes (no tuning or replay section then). */
  readonly shift: DevShift | null;
  /** Renderer and scene status lines (camera, `draw calls N`, spike actors). */
  status(): string;
};

/** The mounted panel: main.ts calls frame() from Game.afterFrame. */
export type DevPanel = {
  /** Once per drawn frame: toggles on the F1 edge in `sceneActions`, refreshes the readouts while open. */
  frame(sceneActions: number): void;
  readonly element: HTMLElement;
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== '') node.textContent = text;
  return node;
}

function checkbox(label: string, checked: boolean, onChange: (checked: boolean) => void): HTMLLabelElement {
  const box = el('input');
  box.type = 'checkbox';
  box.checked = checked;
  box.addEventListener('change', () => {
    onChange(box.checked);
    box.blur(); // hand the keyboard back to driving (Space is the brush)
  });
  const wrap = el('label');
  wrap.append(box, ` ${label}`);
  wrap.style.display = 'block';
  return wrap;
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', label);
  b.type = 'button';
  b.style.marginRight = '4px';
  b.addEventListener('click', () => {
    onClick();
    b.blur(); // so Space (the brush) never re-clicks it
  });
  return b;
}

/** Mounts the panel (hidden until F1) on document.body. */
export function mountDevPanel(host: DevPanelHost): DevPanel {
  const panel = el('div');
  panel.id = DEV_PANEL_ID;
  // System colours via color-scheme: no raw colour values, and none of this ships (CLAUDE.md hard rule 3).
  panel.style.cssText =
    'position:fixed;top:8px;left:8px;z-index:10;display:none;padding:6px 8px;font:12px/1.4 monospace;' +
    'color-scheme:dark;background:Canvas;color:CanvasText;opacity:0.92;max-height:calc(100vh - 32px);' +
    'overflow:auto;max-width:440px';

  // M0 camera controls: zoom is checkbox 1 and night checkbox 2 (tools/spikes/swiftShaderPalettePass.ts).
  const drive = host.drive;
  const pan = el('input');
  pan.type = 'range';
  pan.min = '0';
  pan.max = String(MAX_PAN_SPEED_MPS);
  pan.step = '0.1';
  pan.value = String(drive.speedMps);
  const panValue = el('span', ` ${drive.speedMps.toFixed(1)} m/s`);
  pan.addEventListener('input', () => {
    drive.speedMps = Number(pan.value);
    panValue.textContent = ` ${drive.speedMps.toFixed(1)} m/s`;
  });
  pan.addEventListener('change', () => pan.blur());
  const panLabel = el('label');
  panLabel.append('spike pan ', pan, panValue);
  panLabel.style.display = host.shift === null ? 'block' : 'none';
  panel.append(
    panLabel,
    checkbox('speed zoom (D-01)', drive.zoomEnabled, (on) => {
      drive.zoomEnabled = on;
    }),
    checkbox('night remap', drive.night, (on) => {
      drive.night = on;
    }),
  );

  const status = el('pre');
  status.style.margin = '4px 0';
  const message = el('div');
  message.style.whiteSpace = 'pre-wrap';
  panel.append(status);

  let topSpeedMps = 0;
  const shift = host.shift;
  if (shift !== null) {
    const committed = tuningSourceCopy();
    let raw = tuningSourceCopy();
    let saveAnyway = false;
    const inputs = new Map<string, { input: HTMLInputElement; label: HTMLElement; field: TuningField }>();

    const say = (text: string): void => {
      message.textContent = text;
    };
    const markChanges = (): void => {
      const changed = new Set(changedTuningPaths(raw, committed));
      for (const { input, label, field } of inputs.values()) {
        input.value = String(readTuningValue(raw, field));
        input.style.outline = '';
        label.style.fontWeight = changed.has(field.path) ? 'bold' : 'normal';
        label.textContent = `${changed.has(field.path) ? '*' : ' '}${field.key}`;
      }
    };
    const apply = (next: unknown, tuning: Tuning): void => {
      shift.setTuning(tuning);
      raw = next;
      topSpeedMps = 0;
      saveAnyway = false;
      save.textContent = 'Save replay';
      markChanges();
    };

    const save = button('Save replay', () => {
      const verdict = replayVerdict(shift);
      if (verdict.kind === 'empty') return say(verdict.message);
      if (verdict.kind === 'refused' && !saveAnyway) {
        saveAnyway = true;
        save.textContent = 'Save anyway';
        return say(verdict.message);
      }
      const { fileName, text } = buildReplay(shift);
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const link = el('a');
      link.href = url;
      link.download = fileName;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      saveAnyway = false;
      save.textContent = 'Save replay';
      say(
        verdict.kind === 'refused'
          ? `Saved ${fileName} ANYWAY, despite: ${verdict.reasons.join('; ')}.`
          : `Saved ${fileName}. Put it in tests/replay/replays/ and run npm run test:replay.`,
      );
    });
    const copy = button('Copy tuning JSON', () => {
      const text = tuningJsonText(raw);
      const changed = changedTuningPaths(raw, committed);
      const done = `Copied tuning.json (${changed.length} changed: ${changed.join(', ') || 'none'}). Paste into src/data/tuning.json, update GDD §7 in the same commit.`;
      navigator.clipboard.writeText(text).then(
        () => say(done),
        () => {
          console.info(text);
          say('Clipboard unavailable: the tuning JSON is in the console.');
        },
      );
    });
    const reset = button('Reset tuning', () => {
      const fresh = tuningSourceCopy();
      apply(fresh, loadTuning(fresh));
      say('Tuning reset to tuning.json (reload the page for a clean replay recording).');
    });
    const resetTop = button('Reset top', () => {
      topSpeedMps = 0;
    });
    const actions = el('div');
    actions.append(save, copy, reset, resetTop);
    panel.append(actions, message);

    // One <details> per group; a number input per value, applied on change (Enter, blur or the spinner).
    for (const field of listTuningFields(raw)) {
      let group = panel.querySelector<HTMLDetailsElement>(`details[data-group="${field.group}"]`);
      if (group === null) {
        group = el('details');
        group.dataset.group = field.group;
        group.open = OPEN_GROUPS.includes(field.group);
        group.append(el('summary', field.group));
        panel.append(group);
      }
      const input = el('input');
      input.type = 'number';
      input.step = 'any';
      input.style.width = '7em';
      input.dataset.path = field.path;
      input.addEventListener('change', () => {
        // valueAsNumber is NaN for an empty or malformed field, which loadTuning rejects.
        const edit = editTuning(raw, field, input.valueAsNumber);
        if (!edit.ok) {
          input.style.outline = '2px solid Mark';
          return say(`Not applied: ${edit.error}`);
        }
        apply(edit.raw, edit.tuning);
        say(
          tuningsEqual(edit.tuning, DEFAULT_TUNING)
            ? 'Tuning matches tuning.json again.'
            : `Applied ${field.path} = ${input.value}.`,
        );
      });
      const label = el('span');
      label.style.display = 'inline-block';
      label.style.width = '15em';
      label.style.whiteSpace = 'pre';
      const row = el('label');
      row.style.display = 'block';
      row.append(label, input);
      group.append(row);
      inputs.set(field.path, { input, label, field });
    }
    markChanges();

    // Typing in a number field must not drive Bessie: keep its keys from the window's keyboard device (F1
    // still toggles; Enter or Esc hands the keyboard back). Only keydowns are held back, so a key already down
    // still sees its keyup and never sticks. Buttons and checkboxes give up focus once used.
    panel.addEventListener('keydown', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement) || target.type !== 'number' || event.code === 'F1') return;
      event.stopPropagation();
      if (event.key === 'Enter' || event.key === 'Escape') target.blur();
    });
  }
  document.body.append(panel);

  return {
    element: panel,
    frame(sceneActions: number): void {
      if ((sceneActions & ACTION.DEV_PANEL) !== 0) {
        panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
      }
      const view = shift?.worldView ?? null;
      if (view !== null) topSpeedMps = Math.max(topSpeedMps, Math.abs(view.vehicle.vLongMps));
      if (panel.style.display === 'none') return;
      status.textContent =
        shift === null ? host.status() : `${host.status()}\n${shiftReadout(shift, topSpeedMps)}`;
    },
  };
}
