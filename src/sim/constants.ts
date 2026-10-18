// Unit conversions and fixed-timestep constants (TECHNICAL_DESIGN §3.2, §4, §5.1 and §17).
// Pure data: no three, DOM, Date, performance or Math.random (CLAUDE.md hard rule 1). Gameplay numbers do
// not belong here: they live in src/data/tuning.json and src/data/entities.json (§3.2 rule 4).

/** Simulation rate in ticks per second, independent of the display refresh rate. */
export const SIM_HZ = 60;

/** Duration of one simulation tick in seconds. */
export const DT_S = 1 / SIM_HZ;

/** Maximum simulation steps run per rendered frame; below 12 fps the game slows down instead of spiralling. */
export const MAX_STEPS_PER_FRAME = 5;

/** Unit conversion: internal pixels per metre (TECHNICAL_DESIGN §3.2, §4). Only src/render converts to pixels. */
export const PX_PER_M = 16;

/** Edge of one map tile in metres: one ASCII map character (TECHNICAL_DESIGN §4, LEVEL_DESIGN). */
export const TILE_M = 2;

/** Edge of one grime-mask cell in metres (TECHNICAL_DESIGN §4, §10.3). */
export const GRIME_CELL_M = 0.25;

/** Length of a campaign shift in seconds (GDD §5, LEVEL_DESIGN §4.1). */
export const SHIFT_S = 240;

/**
 * Length of a campaign shift in ticks: 240 s × 60 Hz = 14,400 (TECHNICAL_DESIGN §5.1). The sim's timer is an
 * integer `ticksRemaining`, never a float. The +60 s timer assist is applied at runtime on top of this.
 */
export const SHIFT_TICKS = SHIFT_S * SIM_HZ;
