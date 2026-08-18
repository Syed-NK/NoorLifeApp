import type { FaithResult } from './faith-result';
import type { PrayerKey } from './prayer-times.repository';

/**
 * The user's own worship record.
 *
 * ── This is the one Faith repository that holds personal data ───────────────
 * Everything else in this module serves *content* — the same verses for everybody.
 * This one records what a particular person did, which makes it the only Faith
 * repository whose Supabase implementation needs row-level security. The proposed
 * schema and RLS policy are written up in `docs/FAITH_DATA_MODEL.md`; no table is
 * created in this phase.
 *
 * ── On tone ─────────────────────────────────────────────────────────────────
 * A missed prayer is recorded as `missed`, not `failed`, and the repository exposes no
 * streak-breaking or shaming derivation. The Goals module's policy — "progress reporting
 * stays factual and never shames a missed day" — applies here with more force, because
 * this is worship.
 */

export type WorshipEntryStatus = 'completed' | 'current' | 'upcoming' | 'missed';

/** What kind of act an entry records. */
export type WorshipKind = 'prayer' | 'adhkar' | 'quran' | 'fasting' | 'charity' | 'custom';

export type WorshipEntry = {
  readonly key: string;
  readonly label: string;
  readonly kind: WorshipKind;
  /** The obligatory prayer this entry tracks, when `kind` is `prayer`. */
  readonly prayer?: PrayerKey;
  /**
   * A scheduled time, or a short description of the act.
   *
   * ── Optional, because "I don't know when" is a real answer ──────────────────
   * It used to be a required string, and the seed satisfied it by hard-coding `5:02 AM`,
   * `12:35 PM`, `4:15 PM`, `8:44 PM`, `10:10 PM` — the same five times the deleted prayer-times
   * fixture returned for every location on every date. The result was a Faith home whose hero
   * showed a calculated next prayer and whose worship card, directly beneath it, showed those
   * five constants: one screen stating two different things about the same day.
   *
   * A prayer's clock time is not the worship record's to know. It belongs to the prayer-times
   * calculation, which needs a location, and a location can be absent. So this is optional, and
   * an entry whose time cannot be calculated carries none — the row renders its label and its
   * tick state, and says nothing about when.
   */
  readonly detail?: string;
  readonly status: WorshipEntryStatus;
  /** ISO timestamp of when it was marked, or null if not marked. */
  readonly completedAt: string | null;
};

export type WorshipDay = {
  /** ISO date, `YYYY-MM-DD`. */
  readonly date: string;
  readonly entries: readonly WorshipEntry[];
  /** Completed count over total trackable, for the day's progress. */
  readonly completed: number;
  readonly total: number;
};

/** A factual weekly rollup. No streak pressure, no comparison to other users. */
export type WorshipSummary = {
  readonly from: string;
  readonly to: string;
  readonly completed: number;
  readonly total: number;
  /** Per-prayer completion counts, for the honest breakdown. */
  readonly byPrayer: Readonly<Partial<Record<PrayerKey, number>>>;
};

export type WorshipRepository = {
  getDay(date: string): Promise<FaithResult<WorshipDay>>;

  /**
   * Marks one entry.
   *
   * Returns the whole updated day rather than void, so the caller re-renders from the
   * repository's truth instead of guessing what changed locally and drifting from it.
   */
  setEntryStatus(
    date: string,
    entryKey: string,
    status: WorshipEntryStatus,
  ): Promise<FaithResult<WorshipDay>>;

  getSummary(from: string, to: string): Promise<FaithResult<WorshipSummary>>;

  /** Adds a user-defined act. Custom entries are the only ones the user can create. */
  addCustomEntry(date: string, label: string): Promise<FaithResult<WorshipDay>>;

  removeCustomEntry(date: string, entryKey: string): Promise<FaithResult<WorshipDay>>;
};
