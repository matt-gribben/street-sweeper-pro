// Fixed-timestep simulation constants (TECHNICAL_DESIGN §5.1 and §17).
// Pure data: no three, DOM, Date, performance or Math.random (CLAUDE.md hard rule 1).

/** Simulation rate in ticks per second, independent of the display refresh rate. */
export const SIM_HZ = 60;

/** Duration of one simulation tick in seconds. */
export const DT_S = 1 / SIM_HZ;

/** Maximum simulation steps run per rendered frame; below 12 fps the game slows down instead of spiralling. */
export const MAX_STEPS_PER_FRAME = 5;

/** Unit conversion: internal pixels per metre (TECHNICAL_DESIGN §3.2, §4). Only src/render converts to pixels. */
export const PX_PER_M = 16;
