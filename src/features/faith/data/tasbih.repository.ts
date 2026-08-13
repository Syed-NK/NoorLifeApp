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

/** A dhikr phrase the counter can be set to. */
export type DhikrPreset = {
  readonly id: string;
  /** Immutable Arabic. */
  readonly arabic: string;
  readonly transliteration: string;
  readonly translation: string;
  /** Traditional target, e.g. 33 or 100. */
  readonly target: number;
};

export type TasbihSession = {
  readonly presetId: string;
  readonly count: number;
  /** How many times the target has been completed in this session. */
  readonly rounds: number;
  readonly target: number;
  readonly startedAt: string;
  readonly updatedAt: string;
};

/** A completed round, kept so the user can see what they did today. */
export type TasbihHistoryEntry = {
  readonly presetId: string;
  readonly count: number;
  readonly rounds: number;
  readonly completedAt: string;
};

export type TasbihRepository = {
  listPresets(): Promise<FaithResult<readonly DhikrPreset[]>>;

  /** The in-progress session, or an `empty` result when there is none. */
  getSession(): Promise<FaithResult<TasbihSession>>;

  /** Starts or switches the active preset, archiving any in-progress count. */
  startSession(presetId: string): Promise<FaithResult<TasbihSession>>;

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
   * ── Why the target is a session value and not only a preset value ───────────
   * Each dhikr carries a traditional target — 33 after prayer, 100 for others — and those are the
   * defaults. But a target is also a personal intention: somebody may set out to say a phrase five
   * hundred times, and a counter that could only ever count to its preset's number would be
   * counting the tradition rather than what the user actually resolved to do.
   *
   * Choosing a preset resets the target to that preset's traditional value, which is the behaviour
   * somebody switching dhikr expects. Changing it afterwards is theirs.
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
