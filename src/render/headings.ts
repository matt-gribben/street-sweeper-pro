// Vehicle headings -> sprite frames (TECHNICAL_DESIGN §4, ART_BIBLE §4.5). Heading θ is in radians, 0 = north
// (screen up), increasing clockwise; the 32 rendered headings h00..h31 step 11.25° clockwise from north, the
// same convention as the Blender rig. Frame IDs are built from the typed HEADING_IDS table with `as const`
// template literals, so every ID below is checked against the generated FrameId union at compile time: a
// missing heading frame is a type error, not a runtime miss.
import type { FrameId } from '../gen/assets.ts';

/** Number of rendered vehicle headings. */
export const HEADING_COUNT = 32;

/** Angle between neighbouring headings: 2π / 32 rad (11.25°). */
export const HEADING_STEP_RAD = (2 * Math.PI) / HEADING_COUNT;

/** The heading direction IDs in index order: HEADING_IDS[i] is `h` + two-digit i. */
export const HEADING_IDS = [
  'h00',
  'h01',
  'h02',
  'h03',
  'h04',
  'h05',
  'h06',
  'h07',
  'h08',
  'h09',
  'h10',
  'h11',
  'h12',
  'h13',
  'h14',
  'h15',
  'h16',
  'h17',
  'h18',
  'h19',
  'h20',
  'h21',
  'h22',
  'h23',
  'h24',
  'h25',
  'h26',
  'h27',
  'h28',
  'h29',
  'h30',
  'h31',
] as const;
export type HeadingId = (typeof HEADING_IDS)[number];

/**
 * Heading index 0..31 for θ radians: `((round(θ / (2π/32)) % 32) + 32) % 32` (TECHNICAL_DESIGN §4).
 * Any finite θ is accepted (negative or beyond 2π wraps). No hysteresis yet (ART_BIBLE §4.5, proposed).
 */
export function headingIndex(headingRad: number): number {
  // `| 0` folds Math.round's −0 into 0 so the result is always a plain integer index.
  return (((Math.round(headingRad / HEADING_STEP_RAD) % HEADING_COUNT) + HEADING_COUNT) % HEADING_COUNT) | 0;
}

/** Heading direction ID (h00..h31) for θ radians. */
export function headingId(headingRad: number): HeadingId {
  return HEADING_IDS[headingIndex(headingRad)] ?? 'h00';
}

/** Bessie's body frame per heading index. */
export const BESSIE_BODY_FRAMES = HEADING_IDS.map(
  (h) => `veh.sweeper:body:${h}:0` as const,
) satisfies readonly FrameId[];

/** Spin frames of the brush overlay (ART_BIBLE §8.1: 4 frames, 22.5° of bristle rotation each). */
export const BRUSH_SPIN_FRAMES = 4;

/** Bessie's brush-overlay frames: BESSIE_BRUSH_FRAMES[heading][spin]. */
export const BESSIE_BRUSH_FRAMES = HEADING_IDS.map(
  (h) =>
    [
      `veh.sweeper_brush:brush:${h}:0`,
      `veh.sweeper_brush:brush:${h}:1`,
      `veh.sweeper_brush:brush:${h}:2`,
      `veh.sweeper_brush:brush:${h}:3`,
    ] as const,
) satisfies readonly (readonly FrameId[])[];

/** Bessie's body frame at heading index 0..31 (throws outside that range). */
export function bessieBodyFrame(heading: number): FrameId {
  const frame = BESSIE_BODY_FRAMES[heading];
  if (frame === undefined) throw new Error(`heading index ${heading} is not 0..${HEADING_COUNT - 1}`);
  return frame;
}

/** Bessie's brush-overlay frame at heading index 0..31 and spin frame 0..3 (throws outside those ranges). */
export function bessieBrushFrame(heading: number, spin: number): FrameId {
  const frame = BESSIE_BRUSH_FRAMES[heading]?.[spin];
  if (frame === undefined) throw new Error(`brush frame (heading ${heading}, spin ${spin}) does not exist`);
  return frame;
}
