// The no-op default behaviour (SSP-080): an NPC that stands where it spawned and ignores every stimulus.
// Every behaviour key maps to it until its own module lands (SSP-083 to SSP-088); tests use it as the inert
// baseline.
import type { Behaviour } from '../behaviour.ts';

/** The no-op behaviour's one state. */
export const NOOP = { Idle: 0 } as const;
export type NoopState = (typeof NOOP)[keyof typeof NOOP];

export const noopBehaviour: Behaviour = {
  initial: NOOP.Idle,
  tick(): void {
    // Stands still.
  },
  onStimulus(): void {
    // Ignores everything.
  },
};
