import { commitActivePrayerLocation } from '@features/faith/storage/faith-location';

/**
 * Seeds a resolved prayer location, for suites testing something other than location resolution.
 *
 * ── Why this became necessary ───────────────────────────────────────────────
 * Every location-scoped date in the Faith module now derives from a `PrayerLocation`, and the ones
 * that cannot derive one report an explicit unresolved state rather than substituting the device's
 * calendar day. That is the correction, and it has a cost for tests: a suite mounting the Calendar
 * screen against the default fixtures gets a denied location port, so the screen renders its
 * "location needed" state and never reaches the month grid the suite is actually about.
 *
 * Seeding a stored location is the honest way through. It exercises the real path — the repository
 * reads storage, resolves the coordinate to an IANA zone offline, and derives the day from it — so
 * a suite using this is testing the production derivation rather than stubbing past it.
 *
 * ── Why storage rather than a repository stub ───────────────────────────────
 * A stubbed `resolveCurrentLocation` would hand back a `PrayerLocation` nobody had validated,
 * including a `timeZone` string that `timeZoneForCoordinate` never produced. Writing the coordinate
 * and letting the repository resolve it keeps the zone honest, which matters because the zone is
 * the thing every one of these dates turns on.
 */

/** Makkah. A coordinate whose IANA zone (`Asia/Riyadh`) has no DST, so no case turns on a transition. */
export const TEST_LOCATION_COORDINATE = { latitude: 21.4225, longitude: 39.8262 } as const;

/**
 * Writes a freshly-resolved location to storage.
 *
 * `resolvedAt` is stamped at call time so the fix is never near `LOCATION_DAY_MAX_AGE_MS`. A suite
 * that wants to exercise staleness should write its own stamp rather than adjusting this.
 */
export async function seedPrayerLocation(): Promise<void> {
  /*
    Through the same mutation boundary the app uses, so a seeded fixture is a record the production
    validator accepts — not a hand-built object that could drift from the schema it is standing in for.
  */
  await commitActivePrayerLocation({
    mode: 'device',
    coordinate: TEST_LOCATION_COORDINATE,
    label: 'Makkah, Saudi Arabia',
    resolvedAt: new Date().toISOString(),
    accuracyMetres: null,
  });
}
