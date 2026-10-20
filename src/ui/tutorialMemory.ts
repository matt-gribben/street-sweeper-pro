// The tutorial's learned set (GDD §16.1, SSP-290): which of Pam's tutorial lessons the player has learned, so a
// learned beat never fires again. One TutorialMemory lives for the whole session (main.ts makes it and the shift
// flow hands it to every ShiftScene), so a beat learned in one shift stays learned on Try Again or Restart Shift.
//
// Save data is M6: until then nothing persists it and every new session is a first play. SSP-186 persists it to
// the save's `tutorial.learned` (TECHNICAL_DESIGN §16) through this interface: load(learned) seeds it from the save
// at boot, learned() reads it back for the next save write (never mid-shift). Ids are the lesson ids of
// src/ui/tutorial.ts TUTORIAL_LESSONS ('drive', 'brush', 'fling', ...); an id this build does not know is kept, so
// a save written by a later build loses nothing.

/** The learned lesson ids, in the order they were learned. */
export class TutorialMemory {
  private readonly order: string[] = [];
  private readonly set = new Set<string>();

  /** A memory holding `learned` (empty by default: a first play). */
  constructor(learned: readonly string[] = []) {
    this.load(learned);
  }

  /** Replaces the learned set with `learned` (duplicates and empty ids are dropped). */
  load(learned: readonly string[]): void {
    this.order.length = 0;
    this.set.clear();
    for (const id of learned) this.learn(id);
  }

  /** A copy of the learned ids, in the order they were learned. */
  learned(): string[] {
    return [...this.order];
  }

  /** True once `id` is learned. */
  has(id: string): boolean {
    return this.set.has(id);
  }

  /** Marks `id` learned; true when it was not learned before. */
  learn(id: string): boolean {
    if (typeof id !== 'string' || id.length === 0 || this.set.has(id)) return false;
    this.set.add(id);
    this.order.push(id);
    return true;
  }
}
