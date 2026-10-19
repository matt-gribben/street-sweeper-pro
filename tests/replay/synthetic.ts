// The built-in synthetic replay (SSP-038). It runs on every `npm run test:replay` alongside the committed
// files, so the replay project never has zero tests (Vitest fails such a run) and the runner, the hash and the
// heap check are exercised even before the first real replay exists (SSP-049).
//
// The level is hand-built (no compiler, no public/assets file): a 48 × 48 tile town of 4 × 4 road squares
// separated by 2-tile pavement and grass strips with raised kerbs on every road edge, plus a solid block in
// each corner that the route keeps clear of. The input script is a fixed, readable list of segments
// (accelerate, toggle the brush, circle, brake into reverse, reverse, drive out, horn, spray) repeated until
// the replay's 3,600 ticks are filled. Its hashes are not committed: they are compared run against run.
import { BUTTON, PRESSED } from '../../src/sim/inputFrame.ts';
import {
  COLLIDE,
  createBlankLevel,
  Ground,
  type Level,
  mergeSolids,
  Surface,
  surfaceOfGround,
} from '../../src/sim/map.ts';
import { appendInput, createInputLog, type InputLog, REPLAY_TICKS } from '../../src/sim/replay.ts';

export const SYNTHETIC_DISTRICT = 'district.synthetic_town';
export const SYNTHETIC_SEED = 0x5eed;
const N = 48;

function paint(level: Level, col: number, row: number, ground: Ground): void {
  level.layers.ground[row * N + col] = ground;
  level.layers.surface[row * N + col] = surfaceOfGround(ground);
}

function orCollide(level: Level, col: number, row: number, bits: number): void {
  const collide = level.layers.collide;
  collide[row * N + col] = (collide[row * N + col] ?? 0) | bits;
}

/** The synthetic town level (48 × 48 tiles, 96 × 96 m). Bessie starts at (22, 22) m heading 0.4 rad; the
 * route drifts south-east and stays at least 9 m inside the map and clear of the corner blocks. */
export function syntheticLevel(): Level {
  const level = createBlankLevel('district.synthetic_town', N, N);
  for (let row = 0; row < N; row++) {
    for (let col = 0; col < N; col++) {
      const block = col % 6 >= 4 || row % 6 >= 4;
      const grass = block && (col + row) % 12 < 2;
      paint(level, col, row, !block ? Ground.Road : grass ? Ground.Grass : Ground.Pavement);
    }
  }
  const surface = level.layers.surface;
  for (let row = 0; row < N; row++) {
    for (let col = 0; col < N; col++) {
      const asphalt = surface[row * N + col] === Surface.Asphalt;
      if (col + 1 < N && asphalt !== (surface[row * N + col + 1] === Surface.Asphalt)) {
        orCollide(level, col, row, COLLIDE.KERB_EDGE_E);
        orCollide(level, col + 1, row, COLLIDE.KERB_EDGE_W);
      }
      if (row + 1 < N && asphalt !== (surface[(row + 1) * N + col] === Surface.Asphalt)) {
        orCollide(level, col, row, COLLIDE.KERB_EDGE_S);
        orCollide(level, col, row + 1, COLLIDE.KERB_EDGE_N);
      }
    }
  }
  // A 3 × 3 tile solid block in each corner, well away from the route.
  for (const [c0, r0] of [
    [1, 1],
    [N - 4, 1],
    [1, N - 4],
    [N - 4, N - 4],
  ] as const) {
    for (let row = r0; row < r0 + 3; row++)
      for (let col = c0; col < c0 + 3; col++) orCollide(level, col, row, COLLIDE.SOLID);
  }
  level.solids = mergeSolids(level.layers.collide, N, N);
  level.player = { x: 22, y: 22, heading: 0.4 };
  return level;
}

/** One script segment: hold these controls for `ticks` ticks; `pressed` reaches only the segment's first tick. */
type Segment = readonly [
  ticks: number,
  throttle: number,
  brake: number,
  steer: number,
  buttons: number,
  pressed: number,
];

/** One 720-tick lap of the script (12 s); five laps fill the 3,600-tick replay. */
const LAP: readonly Segment[] = [
  [60, 220, 0, 0, 0, PRESSED.BRUSH], // brush down, accelerate
  [240, 150, 0, 70, 0, 0], // circle right
  [30, 0, 0, 0, 0, PRESSED.HORN],
  [100, 0, 255, -20, 0, 0], // brake to a stop and hold: REV engages, then reverse
  [80, 140, 0, -60, 0, PRESSED.BRUSH], // throttle: brake out of reverse, back to FWD, brush up
  [150, 255, 0, -45, BUTTON.SPRAY, 0], // circle left at transit speed, spraying
  [60, 0, 120, 10, 0, 0], // brake
];

/** The synthetic replay's input log: LAP repeated for REPLAY_TICKS ticks. */
export function syntheticInputLog(ticks: number = REPLAY_TICKS): InputLog {
  const log = createInputLog(ticks);
  const frame = { throttle: 0, brake: 0, steer: 0, buttons: 0, pressed: 0 };
  let tick = 0;
  while (tick < ticks) {
    for (const [len, throttle, brake, steer, buttons, pressed] of LAP) {
      for (let i = 0; i < len && tick < ticks; i++, tick++) {
        frame.throttle = throttle;
        frame.brake = brake;
        frame.steer = steer;
        frame.buttons = buttons;
        frame.pressed = i === 0 ? pressed : 0;
        appendInput(log, tick, frame);
      }
    }
  }
  return log;
}
