/**
 * The location prayer times and the Qibla are calculated for.
 *
 * ── This file is now a re-export, and that is the point ─────────────────────
 * It used to own the schema, the validation and the write. All three moved to
 * `prayer-location-store.ts`, which is the single mutation boundary: one module owns validating a
 * candidate, resolving its timezone, writing the key, bumping the revision and publishing.
 *
 * The names below are kept because a dozen call sites and several suites already import them, and
 * renaming those in the same pass as changing the schema would make one change unreviewable as two.
 *
 * ── There is no default, and that has not changed ───────────────────────────
 * No fallback city, no country centroid, no "last known good" constant. A build where nobody has
 * granted location and nobody has chosen a place has **no location**, and every screen that needs
 * one says so and offers to resolve it. A prayer time computed for a city the user is not in is
 * wrong by up to hours, and it is wrong invisibly.
 */

import type { SavedPrayerLocationV2 } from './prayer-location-store';

export {
  clearActivePrayerLocation as clearStoredLocation,
  commitActivePrayerLocation,
  migrateLegacyRecord,
  PRAYER_LOCATION_SCHEMA_VERSION,
  readActivePrayerLocation as readStoredLocation,
  resetPrayerLocationSnapshotForTest,
  type CommitResult,
  type PrayerLocationCandidate,
  type PrayerLocationMode,
  type SavedPrayerLocationV2,
  type SavedPrayerLocationV2 as StoredLocation,
} from './prayer-location-store';

/**
 * The mode in force.
 *
 * A function rather than a bare field read, because it used to have to reconcile `manual` against
 * `mode`. It no longer does — `mode` is the discriminant and the only mode field — so this is now a
 * one-line accessor kept for its call sites.
 */
export function locationModeOf(location: SavedPrayerLocationV2): 'device' | 'manual' {
  return location.mode;
}
