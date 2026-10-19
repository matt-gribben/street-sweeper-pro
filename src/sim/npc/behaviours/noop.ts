// The no-op default behaviour (SSP-080): an NPC that stands where it spawned and ignores every stimulus.
// Every behaviour key maps to it until its own module lands (SSP-083 to SSP-088); tests use it as the inert
// baseline. SSP-081 adds its jaywalking twin, which the registry gives the two M3 jaywalkers (the cat and the
// businessman) until their modules land, so the jaywalk flag is already where steering reads it.
import type { Behaviour } from '../behaviour.ts';

/** The no-op behaviour's one state. */
export const NOOP = { Idle: 0 } as const;
export type NoopState = (typeof NOOP)[keyof typeof NOOP];

export const noopBehaviour: Behaviour = {
  initial: NOOP.Idle,
  jaywalks: false,
  tick(): void {
    // Stands still.
  },
  onStimulus(): void {
    // Ignores everything.
  },
};

/** The no-op behaviour of a kind that jaywalks (TECHNICAL_DESIGN §11.1): stands still, ignores everything. */
export const noopJaywalkBehaviour: Behaviour = {
  initial: NOOP.Idle,
  jaywalks: true,
  tick(): void {
    // Stands still.
  },
  onStimulus(): void {
    // Ignores everything.
  },
};
