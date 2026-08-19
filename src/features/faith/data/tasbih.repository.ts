import type { FaithResult } from './faith-result';

/**
 * The tasbih (dhikr) counter.
 *
 * ── Why the counter is a repository and not component state ─────────────────
 * A count the user has been building for ten minutes must survive a backgrounded app,
 * a rotation and a navigation away. Holding it in `useState` loses it to any of those,
 * which for this particular feature is not a minor bug — it discards an act of worship
 * the user was in the middle of.
 *
 * So the counter is persisted, and the persistence sits behind this interface for the
 * same reason as the rest: today it is AsyncStorage, later it may be a synced Supabase
 * row, and no screen should have to change for that.
 *
 * ── Why `reset` is separate from `setCount` ─────────────────────────────────
 * Reset is destructive and the UI confirms it. Giving it its own method means the
 * confirmation requirement is visible in the interface rather than being a convention
 * the next caller might not know about.
 */

/** The bounds a round length may take. Below one is not a round; above this is not a session. */
export const MIN_TASBIH_TARGET = 1;
export const MAX_TASBIH_TARGET = 1000;

/**
 * A label the counter can be set to — **the user's own words, and only ever theirs.**
 *
 * ── What this replaced ──────────────────────────────────────────────────────
 * `DhikrPreset`, which carried `arabic`, `transliteration` and `translation` for five phrases
 * NoorLife shipped built in. An audit for verified Arabic, verified translation, recorded provenance
 * and a compatible redistribution licence found **none of the four** for any of them, so all five
 * were removed rather than flag-gated. See `data/tasbih/local-tasbih.repository.ts` and
 * `docs/FAITH_TASBIH_CONTENT_AUDIT.md`.
 *
 * ── What a label may and may not claim ──────────────────────────────────────
 * There is no `arabic`, no `translation`, no `reference` and no `verified` field here, so
 * "NoorLife stands behind this text" is not a state this type can express. A label is a private note
 * somebody wrote to remind themselves what they are counting.
 */
export type CounterLabel = {
  readonly id: string;
  /** The user's own text, or the neutral default. Rendered as written, credited to nobody. */
  readonly name: string;
  /** The round length this counter starts at. A number, carrying no religious claim. */
  readonly target: number;
};

export type TasbihSession = {
  readonly counterId: string;
  readonly count: number;
  /** How many times the target has been completed in this session. */
  readonly rounds: number;
  readonly target: number;
  readonly startedAt: string;
  readonly updatedAt: string;
};

/** A completed round, kept so the user can see what they did today. */
export type TasbihHistoryEntry = {
  readonly counterId: string;
  readonly count: number;
  readonly rounds: number;
  readonly completedAt: string;
};

export type TasbihRepository = {
  /** Every counter the user has, the neutral default first. Never religious content. */
  listLabels(): Promise<FaithResult<readonly CounterLabel[]>>;

  /** Creates a private label from the user's own text. Trimmed, length-bounded, on-device only. */
  createLabel(name: string): Promise<FaithResult<CounterLabel>>;

  /**
   * Renames a private label in place, keeping its id.
   *
   * The id is preserved deliberately: the active session and the archived history both reference
   * it, so re-creating the label under a new id would orphan the count the user is part-way
   * through. Renaming a counter is editing a note to yourself, not starting a different one.
   */
  renameLabel(id: string, name: string): Promise<FaithResult<CounterLabel>>;

  /** Removes a label. The neutral default cannot be removed, so a counter always exists. */
  deleteLabel(id: string): Promise<FaithResult<readonly CounterLabel[]>>;

  /** The in-progress session, or an `empty` result when there is none. */
  getSession(): Promise<FaithResult<TasbihSession>>;

  /**
   * Makes a counter the active one, **resuming** whatever it was left at.
   *
   * ── Why this suspends rather than archives ──────────────────────────────────
   * It used to archive the in-progress count and start the new counter from zero, which meant
   * switching counters *ended* the one you were on. That was defensible while every counter was a
   * private label and stops being defensible the moment a counter is a Quran selection: somebody a
   * hundred repetitions into one selection, tapping another to see what it says, would have silently
   * discarded the hundred.
   *
   * So each counter keeps its own count, round and target, and switching moves between them.
   * `reset` is the only thing that ends a count, and it ends exactly one.
   *
   * `target` is used only when this counter has neither a stored session nor a label to take one
   * from — which is the case for a Quran selection the user has just sent to Tasbih. A counter that
   * already exists keeps its own target, because the target is the user's stated intention and not
   * something a caller should be able to overwrite by re-selecting.
   */
  startSession(
    counterId: string,
    options?: { readonly target?: number },
  ): Promise<FaithResult<TasbihSession>>;

  /**
   * Discards one counter's counting state, without touching any other.
   *
   * Called when the thing being counted is deleted — a personal label, or a saved Quran selection
   * the user removed. Deliberately narrow: it takes an id, it affects that id, and there is no
   * variant that clears everything, because "remove this selection" must never be able to become
   * "reset the counter you were part-way through".
   *
   * The archived history is not touched. What somebody counted, they counted, and the record of it
   * outlives the label that was attached at the time.
   */
  forgetCounter(counterId: string): Promise<void>;

  /**
   * Adds one.
   *
   * Returns the new session so the caller renders the persisted value rather than an
   * optimistic local guess that could diverge if a write fails.
   */
  increment(): Promise<FaithResult<TasbihSession>>;

  /** Undoes a mis-tap. Never goes below zero. */
  decrement(): Promise<FaithResult<TasbihSession>>;

  /**
   * Changes the round length for the active session.
   *
   * ── Why the target belongs to the session and not to the counter ────────────
   * A target is a personal intention. Somebody may set out to repeat something five hundred times,
   * and a counter that could only ever count to the number its label was created with would be
   * counting NoorLife's default rather than what the user actually resolved to do.
   *
   * This paragraph used to say each dhikr "carries a traditional target — 33 after prayer, 100 for
   * others". NoorLife has no source for that and states no such thing anywhere a user can see it;
   * a repetition count is a religious instruction and is not one this app authors. A counter's
   * starting target is a round number it happens to begin at, and the user changes it.
   *
   * Once set, the target survives a switch away and back — see `startSession`, which resumes rather
   * than restarts.
   *
   * The count is **not** reset by a change of target: the taps already made were real. A target
   * lowered below the current count completes the round on the next tap rather than discarding it.
   *
   * ── A delta rather than an absolute value ───────────────────────────────────
   * `adjustTarget(+1)` rather than `setTarget(34)`, and the difference matters at the speed people
   * actually press a stepper. An absolute setter is computed from the *rendered* target, so five
   * quick presses all read the same starting value and all write the same result — the user presses
   * five times and the number moves once. Applying a delta to whatever is stored makes each press
   * count, which is the same reason `increment` does not take a count.
   */
  adjustTarget(delta: number): Promise<FaithResult<TasbihSession>>;

  /** Destructive. The caller must have confirmed with the user first. */
  reset(): Promise<FaithResult<TasbihSession>>;

  getHistory(limit?: number): Promise<FaithResult<readonly TasbihHistoryEntry[]>>;
};
