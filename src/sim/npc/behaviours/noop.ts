// The no-op default behaviour (SSP-080): an NPC that stands where it spawned and ignores every stimulus.
// Every behaviour key maps to it until its own module lands (SSP-083 to SSP-088); tests use it as the inert
// baseline. SSP-081's jaywalking twin, the stand-in for the two M3 jaywalkers, went once both had their own
// modules (the businessman in SSP-084, the cat in SSP-087).
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
