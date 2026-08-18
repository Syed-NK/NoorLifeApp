import {
  faithStorageKeys,
  hasString,
  isRecord,
  readJson,
  removeKey,
  writeJson,
} from './faith-storage';

/**
 * The prayer alerts NoorLife believes are pending, and what they were built from.
 *
 * ── Why anything is stored at all, given the platform has a pending list ────
 * Because the platform's list cannot answer the two questions reconciliation actually asks.
 *
 * "Is `2026-08-14:fajr` still scheduled?" — the platform returns identifiers and trigger dates, not
 * meanings. Matching a pending alert back to a prayer by comparing timestamps fails the moment the
 * calculation method changes and every instant shifts by a minute.
 *
 * "Are these still the *right* alerts?" — the platform cannot know. A schedule built at a coordinate
 * the user has since left is perfectly valid as far as the OS is concerned and completely wrong. The
 * fingerprint is what turns that into a comparison.
 *
 * ── What is deliberately not written here ───────────────────────────────────
 * No coordinate, no place name, no prayer times and no method — only identifiers, the calendar dates
 * and prayers they belong to, and an opaque fingerprint. A notification schedule is not a place to
 * accumulate a second copy of the user's location.
 */

export type StoredPrayerSchedule = {
  /**
   * The fingerprint of the inputs this schedule was built from.
   *
   * Opaque here on purpose: this module stores and compares it, and `prayer-alert-plan.ts` decides
   * what goes into it. Splitting it that way means adding an input to the fingerprint needs no
   * change to storage or its migration.
   */
  readonly fingerprint: string;
  /** When the schedule was prepared, so a screen can say how fresh it is. */
  readonly preparedAt: string;
  /**
   * Platform identifiers, keyed by `YYYY-MM-DD:prayer`.
   *
   * A map rather than a list because every operation on it is a lookup by that key: is this one
   * pending, which ones are now obsolete, which identifier do I cancel for Asr on Thursday.
   */
  readonly identifiers: Readonly<Record<string, string>>;
};

const EMPTY: StoredPrayerSchedule = { fingerprint: '', preparedAt: '', identifiers: {} };

function isStoredSchedule(value: unknown): value is StoredPrayerSchedule {
  if (!isRecord(value) || !hasString(value, 'fingerprint') || !hasString(value, 'preparedAt')) {
    return false;
  }
  const { identifiers } = value;
  if (!isRecord(identifiers)) {
    return false;
  }
  // Every entry must be a string identifier. A malformed map is discarded whole rather than
  // partially trusted — a half-read schedule would cancel some alerts and orphan others.
  return Object.values(identifiers).every((entry) => typeof entry === 'string');
}

/** The stored schedule, or an empty one when nothing has been scheduled on this install. */
export async function readStoredSchedule(): Promise<StoredPrayerSchedule> {
  return readJson<StoredPrayerSchedule>(
    faithStorageKeys.notificationSchedule,
    EMPTY,
    isStoredSchedule,
  );
}

export async function writeStoredSchedule(
  schedule: StoredPrayerSchedule,
): Promise<StoredPrayerSchedule> {
  await writeJson(faithStorageKeys.notificationSchedule, schedule);
  return schedule;
}

/** Forgets the schedule. Used after cancelling everything, and by the Faith data reset. */
export async function clearStoredSchedule(): Promise<void> {
  await removeKey(faithStorageKeys.notificationSchedule);
}
