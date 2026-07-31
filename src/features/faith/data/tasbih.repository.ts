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

  /** Destructive. The caller must have confirmed with the user first. */
  reset(): Promise<FaithResult<TasbihSession>>;

  getHistory(limit?: number): Promise<FaithResult<readonly TasbihHistoryEntry[]>>;
};
