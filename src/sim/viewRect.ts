// world.viewRect (TECHNICAL_DESIGN §7.4, SSP-080): the sim's deterministic stand-in for "what the player can
// see". The sim never reads the render camera, so rules such as "never spawn on screen" (LEVEL_DESIGN §9.4,
// §9.5) test against this rect instead. It is Bessie's body centre plus the camera's look-ahead target, taken
// from sim state (her ground velocity × VIEW_LOOK_AHEAD_S, capped at VIEW_LOOK_AHEAD_MAX_M: the target
// render/camera.ts springs towards, §12.2), expanded by ±VIEW_HALF_WIDTH_M × ±VIEW_HALF_HEIGHT_M. Those half
// extents are the widest view (W = 640 at H = 37.8 m: ±24.0 × ±10.13 m) plus the 4 m margin of LEVEL_DESIGN
// §9.4, already included: nothing adds another margin. tests/unit/viewRect.test.ts ties these numbers to the
// camera's constants.
//
// Spawn and despawn test the entity's whole shape against the rect (circleTouchesViewRect for NPC circles).
//
// Hot path: updateViewRect and circleTouchesViewRect allocate nothing and take no doubles as arguments
// (TECHNICAL_DESIGN §17, trap 1): positions and radii are read from typed arrays by index.
import { cos, sin, sqrt } from './fmath.ts';
import type { VehicleState } from './vehicle.ts';

/** Half width of the rect, metres: the widest view's 24.0 m plus the 4 m margin. */
export const VIEW_HALF_WIDTH_M = 28;
/** Half height of the rect, metres: the widest view's 10.13 m, taken as 10.2, plus the 4 m margin. */
export const VIEW_HALF_HEIGHT_M = 14.2;
/** Look-ahead lead time, seconds (render/camera.ts LOOK_AHEAD_TIME_S). */
export const VIEW_LOOK_AHEAD_S = 0.75;
/** Look-ahead cap, metres (render/camera.ts LOOK_AHEAD_MAX_M). */
export const VIEW_LOOK_AHEAD_MAX_M = 3.0;

/**
 * The rect in sim metres (min = NW corner) and the focus it is centred on (Bessie plus the look-ahead). The
 * focus comes first so the object does not share its leading keys, and so its hidden-class transitions, with
 * the integer-initialised Aabb boxes (TECHNICAL_DESIGN §17, trap 2).
 */
export type ViewRect = {
  focusX: number;
  focusY: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

/**
 * A view rect for a sweeper at `v`. Setup only. The fields start as fractional doubles, so the object's hidden
 * class holds doubles from the start (TECHNICAL_DESIGN §17, the deprecated-map trap).
 */
export function createViewRect(v: Readonly<VehicleState>): ViewRect {
  const rect: ViewRect = { focusX: 0.5, focusY: 0.5, minX: 0.5, minY: 0.5, maxX: 0.5, maxY: 0.5 };
  updateViewRect(rect, v);
  return rect;
}

/**
 * Recentre `rect` on the sweeper `v`: focus = body centre + ground velocity × VIEW_LOOK_AHEAD_S, the offset
 * capped at VIEW_LOOK_AHEAD_MAX_M; the rect is the focus ± the half extents. A parked sweeper is centred.
 */
export function updateViewRect(rect: ViewRect, v: Readonly<VehicleState>): void {
  const h = v.headingRad;
  // Ground velocity = forward·vLong + right·vLat, forward = (sin h, −cos h), right = (cos h, sin h).
  const s = sin(h);
  const c = cos(h);
  const ox = (s * v.vLongMps + c * v.vLatMps) * VIEW_LOOK_AHEAD_S;
  const oy = (-c * v.vLongMps + s * v.vLatMps) * VIEW_LOOK_AHEAD_S;
  // sqrt runs every tick, not only past the cap: a call site that runs on a small share of the calls is not
  // inlined, and then its double argument and result box (TECHNICAL_DESIGN §17, the M2 tick's trap b).
  const len = sqrt(ox * ox + oy * oy);
  const k = len > VIEW_LOOK_AHEAD_MAX_M ? VIEW_LOOK_AHEAD_MAX_M / len : 1;
  const fx = v.xM + ox * k;
  const fy = v.yM + oy * k;
  rect.focusX = fx;
  rect.focusY = fy;
  rect.minX = fx - VIEW_HALF_WIDTH_M;
  rect.maxX = fx + VIEW_HALF_WIDTH_M;
  rect.minY = fy - VIEW_HALF_HEIGHT_M;
  rect.maxY = fy + VIEW_HALF_HEIGHT_M;
}

/**
 * True when the circle at (xs[i], ys[i]) with radius rs[r] touches or overlaps `rect` (its closest point to
 * the centre is within the radius, boundary included): such an entity may be on screen, so it must not spawn
 * or despawn.
 */
export function circleTouchesViewRect(
  rect: Readonly<ViewRect>,
  xs: Float64Array,
  ys: Float64Array,
  i: number,
  rs: Float64Array,
  r: number,
): boolean {
  const x = xs[i] as number;
  const y = ys[i] as number;
  const radius = rs[r] as number;
  let dx = 0;
  if (x < rect.minX) dx = rect.minX - x;
  else if (x > rect.maxX) dx = x - rect.maxX;
  let dy = 0;
  if (y < rect.minY) dy = rect.minY - y;
  else if (y > rect.maxY) dy = y - rect.maxY;
  return dx * dx + dy * dy <= radius * radius;
}
