import { useCallback } from 'react';

import { hasData, type FaithResult } from '../data/faith-result';
import { formatPrayerClock, formatTimeUntil } from '../data/prayer/prayer-clock';
import type { LocationToday, Observance } from '../data/faith-calendar.repository';
import type { NextPrayer, PrayerLocation } from '../data/prayer-times.repository';
import { useActiveLocationRevision } from '../data/location/active-location';
import { useFaithRepositories } from '../di/faith-repository-context';
import { useFaithPreferences } from './use-faith-preferences';
import { useFaithResource, type UseFaithResource } from './use-faith-resource';

/**
 * The Faith home's data, assembled from the repositories that actually have it.
 *
 * ── What this replaced ──────────────────────────────────────────────────────
 * A module-level constant called `faithHomeFixture`, which hard-coded the next prayer
 * ("Dhuhr 12:35 PM"), the Gregorian date ("May 19, 2025"), the Hijri date, five prayer times, a
 * Ramadan countdown ("In 296 days"), a verse of the Qur'an in Arabic, and a line of guidance
 * captioned "Source: Sahih Bukhari". Every one of those was rendered to every user on every day as
 * though it were their own state, and the last was an unverified narration attributed to a real
 * collection.
 *
 * ── Why each fact is its own resource ───────────────────────────────────────
 * The prayer strip, the Hijri date, the next observance and the reading position come from four
 * different places with four different failure modes: one needs a location permission, two are pure
 * arithmetic, and one is device storage. Combining them into a single result would mean a denied
 * location permission blanking the calendar cards, which have no permission to be denied.
 *
 * So each section on the home screen renders its own state, and one of them failing leaves the rest
 * of the screen standing. That is also why nothing here throws: a Faith home that cannot render
 * because the clock could not be resolved is worse than one that says it does not know where you
 * are.
 */

/** The hero's live content, or the reason there is none. */
export type NextPrayerView = {
  readonly prayer: NextPrayer;
  readonly location: PrayerLocation;
  /**
   * Today at that same location — the whole record, not just the formatted Hijri date.
   *
   * It carries the zone, the provenance and the staleness flag alongside the date, so a surface that
   * renders it can say where it came from, and the development provenance audit can report it
   * without a second lookup. It was `hijri: HijriDate` and the extra fields had nowhere to live.
   */
  readonly today: LocationToday;
};

export type UseFaithHome = {
  /** Next prayer, the resolved place, and today's Hijri date. */
  readonly nextPrayer: UseFaithResource<NextPrayerView>;
  /** The soonest observance ahead. Calculated, and labelled as such wherever it renders. */
  readonly upcoming: UseFaithResource<Observance>;
};

export function useFaithHome(): UseFaithHome {
  const { prayerTimes, calendar } = useFaithRepositories();
  const { preferences } = useFaithPreferences();

  const { calculationMethod, asrMethod } = preferences;

  /*
    ── The same revision Prayer Times keys on ───────────────────────────────
    Faith Home and Prayer Times have always read the *same* stored location; what they lacked was a
    shared reason to re-read it. Keying both on the revision is what makes a location saved on the
    Prayer location screen reach the home hero and Today's Worship in the same commit, instead of
    leaving the home showing Mountain View's times under a Dubai label.
  */
  const locationRevision = useActiveLocationRevision();

  const nextPrayer = useFaithResource(
    `faith.home.next-prayer.${locationRevision}.${calculationMethod}.${asrMethod}`,
    useCallback(async (): Promise<FaithResult<NextPrayerView>> => {
      const location = await prayerTimes.resolveCurrentLocation();
      if (!hasData(location)) {
        /**
         * Passed straight through, including `permission-required`.
         *
         * That case is the reason this cannot be flattened into an error: a user who has not granted
         * location has not hit a failure, they have made a choice, and the hero renders a "set your
         * location" affordance rather than a retry button for something that will not retry.
         */
        return location;
      }

      /**
       * Both derived from **one** resolved location, in one resource.
       *
       * This is the atomicity requirement expressed as code rather than as a convention. The hero's
       * next prayer and the Hijri date beside it used to come from two independent lookups —
       * `getNextPrayer(location)` here and a `calendar.getToday()` that resolved its own day from
       * the device — so the two could name different days, and around midnight they did.
       *
       * `location.data` is a single object resolved once above. Passing it to both means there is no
       * window in which one has a location and the other does not, and no second resolution to race
       * the first: either both surfaces render from this location or the whole resource reports why
       * neither can.
       */
      const [prayer, today] = await Promise.all([
        prayerTimes.getNextPrayer(location.data, {
          method: calculationMethod,
          asr: asrMethod,
          offsetsMinutes: {},
        }),
        calendar.getLocationToday(location.data),
      ]);

      if (!hasData(prayer)) {
        return prayer;
      }
      if (!hasData(today)) {
        return today;
      }

      return {
        kind: 'ok',
        data: { prayer: prayer.data, location: location.data, today: today.data },
      };
    }, [prayerTimes, calendar, calculationMethod, asrMethod]),
  );

  /**
   * The soonest observance, which is a countdown and therefore needs a today.
   *
   * ── Why it resolves its own location rather than reusing the hero's ─────────
   * It is a separate resource with its own lifecycle, by the design stated at the top of this file:
   * one section failing must leave the others standing. Sharing the hero's resolved location would
   * couple the two, so instead it resolves one itself and passes `permission-required` straight
   * through — the card then renders a "set your location" state rather than a day count measured
   * from somewhere the user is not.
   *
   * Both resolutions read the same stored location, so they agree; and unlike the hero's date, an
   * observance countdown has no partner value on screen it could contradict.
   */
  const upcoming = useFaithResource(
    `faith.home.upcoming.${locationRevision}`,
    useCallback(async (): Promise<FaithResult<Observance>> => {
      const location = await prayerTimes.resolveCurrentLocation();
      return hasData(location) ? calendar.getNextObservance(location.data) : location;
    }, [prayerTimes, calendar]),
  );

  return { nextPrayer, upcoming };
}

/**
 * Re-exported so the many call sites that already import them from this module keep working.
 *
 * Both implementations live in `data/prayer/prayer-clock` to break an import cycle — see that file.
 * `formatTimeUntil` moved there when Main Home and the Prayer screen needed it too: a countdown
 * formatter inside a hook module cannot be reached from a data layer, and two copies of it would
 * drift into Main Home and Faith disagreeing about the same prayer.
 */
export { formatPrayerClock, formatTimeUntil };
