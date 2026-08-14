/**
 * The location prayer times and the Qibla are calculated for.
 *
 * ── This file is a re-export, and that is the point ─────────────────────────
 * It used to own the schema, the validation and the write. All three live in
 * `prayer-location-store.ts`, which is the single mutation boundary: one module owns validating a
 * candidate, resolving its timezone, deriving its provenance, writing the key, bumping the revision
 * and publishing.
 *
 * The names below are kept because a dozen call sites and several suites already import them.
 *
 * ── There is no default, and that has not changed ───────────────────────────
 * No fallback city, no country centroid, no "last known good" constant. A build where nobody has
 * granted location and nobody has chosen a place has **no location**, and every screen that needs one
 * says so and offers to resolve it. A prayer time computed for a city the user is not in is wrong by
 * up to hours, and it is wrong invisibly.
 */

export {
  beginLocationOperation,
  clearActivePrayerLocation as clearStoredLocation,
  commitActivePrayerLocation,
  isCurrentLocationOperation,
  isSavedV3,
  resetLocationOperationsForTest,
  retireLocationOperation,
  isUserSelectedLocation,
  migrateLegacyRecord,
  parseStoredPrayerLocation,
  PRAYER_LOCATION_SCHEMA_VERSION,
  readActivePrayerLocation as readStoredLocation,
  resetPrayerLocationSnapshotForTest,
  type CommitResult,
  type LabelProvenance,
  type LocationOperation,
  type PrayerLocationCandidate,
  type PrayerLocationMode,
  type SavedPrayerLocationV3,
  type SavedPrayerLocationV3 as StoredLocation,
  type StoredLocationParse,
} from './prayer-location-store';
