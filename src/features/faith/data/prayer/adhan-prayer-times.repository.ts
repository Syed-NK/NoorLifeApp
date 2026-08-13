import {
  CalculationMethod as AdhanMethod,
  Coordinates,
  Madhab,
  Prayer,
  PrayerTimes as AdhanPrayerTimes,
  type CalculationParameters,
} from 'adhan';

import { readFaithPreferences, writeFaithPreferences } from '../../storage/faith-preferences';
import { commitActivePrayerLocation, readStoredLocation } from '../../storage/faith-location';
import type { FaithResult } from '../faith-result';
import type { LocationPort } from '../location/location.port';
import { acceptLocationFix } from '../location/location-acceptance';
import { daysInGregorianMonth, locationCalendarDay } from '../calendar-day';
import {
  addCalendarDays,
  localDateForCalendarDay,
  timeZoneForCoordinate,
  toZonedOffsetIso,
} from './location-time-zone';
import type {
  AsrJuristicMethod,
  CalculationMethod,
  Coordinate,
  DailyPrayerTimes,
  LocationRefresh,
  NextPrayer,
  PrayerCalculationSettings,
  PrayerKey,
  PrayerLocation,
  PrayerNotificationPreference,
  PrayerTime,
  PrayerTimesRepository,
} from '../prayer-times.repository';

/**
 * Prayer times, calculated.
 *
 * ── What this replaced ──────────────────────────────────────────────────────
 * A fixture returning the design reference's times — 05:02, 12:35, 16:15, 20:44, 22:10 — for every
 * location and every date, to every user, forever. The Faith home rendered them as the user's own
 * day, and the Faith AI told them "your next prayer is Dhuhr at 12:35 PM".
 *
 * ── The calculation is `adhan`, and NoorLife stands behind the choice ───────
 * A pure-JavaScript implementation of the standard astronomical algorithms, MIT-licensed, no
 * dependencies, and the six conventions already named in `CalculationMethod` map onto its own
 * parameter sets one-for-one. Writing the solar-position maths in this repository was the
 * alternative and was rejected: unvalidated astronomy that *looks* authoritative is worse for prayer
 * times than obviously-sample data, which is exactly why the previous pass shipped a fixture rather
 * than a home-grown formula.
 *
 * What NoorLife owns is the *convention*, not the arithmetic. The user picks the calculation method
 * and the Asr school, both are stated on screen beside the times, and neither is chosen for them.
 *
 * ── There is no fallback location, in any branch ────────────────────────────
 * `resolveCurrentLocation` returns a `permission-required` result when there is no permission and no
 * stored place. It does not fall back to a city, a region, or the last coordinate anybody used. Every
 * other method takes a location as an argument, so none of them can invent one either.
 */

/**
 * NoorLife's calculation methods, mapped to `adhan`'s parameter sets.
 *
 * Every entry is a body that publishes a convention, which is the property that made the union
 * closed in the first place. `isna` maps to `NorthAmerica`, which is `adhan`'s name for the same
 * 15°/15° convention ISNA publishes.
 */
const METHOD_PARAMETERS: Readonly<Record<CalculationMethod, () => CalculationParameters>> = {
  'muslim-world-league': () => AdhanMethod.MuslimWorldLeague(),
  'umm-al-qura': () => AdhanMethod.UmmAlQura(),
  egyptian: () => AdhanMethod.Egyptian(),
  karachi: () => AdhanMethod.Karachi(),
  isna: () => AdhanMethod.NorthAmerica(),
  'moonsighting-committee': () => AdhanMethod.MoonsightingCommittee(),
};

/** The six times NoorLife renders, in the order a day runs. Sunrise is a marker, not a prayer. */
const ORDER: readonly { readonly key: PrayerKey; readonly label: string }[] = [
  { key: 'fajr', label: 'Fajr' },
  { key: 'sunrise', label: 'Sunrise' },
  { key: 'dhuhr', label: 'Dhuhr' },
  { key: 'asr', label: 'Asr' },
  { key: 'maghrib', label: 'Maghrib' },
  { key: 'isha', label: 'Isha' },
];

export function buildParameters(
  method: CalculationMethod,
  asr: AsrJuristicMethod,
): CalculationParameters {
  const parameters = METHOD_PARAMETERS[method]();
  parameters.madhab = asr === 'hanafi' ? Madhab.Hanafi : Madhab.Shafi;
  return parameters;
}

/** Applies a per-prayer manual offset, for aligning with a local mosque. */
function shifted(date: Date, minutes: number | undefined): Date {
  return minutes === undefined || minutes === 0
    ? date
    : new Date(date.getTime() + minutes * 60_000);
}

/**
 * The times for one day at one coordinate, as the domain's shape.
 *
 * ── Every timestamp is stamped in the *location's* zone ─────────────────────
 * `location.timeZone` is the IANA zone of the coordinate, resolved offline by
 * `timeZoneForCoordinate`. Formatting through it is what makes a traveller's screen show the prayer
 * times of the place they are asking about rather than those instants translated into the zone their
 * phone happens to be set to. `data/prayer/location-time-zone.ts` records the defect this replaced.
 *
 * ── Why a whole day is dropped when the zone cannot be resolved ─────────────
 * `null`, which every caller turns into an error rather than a list. The alternative was to fall back
 * to the device's zone, and that is precisely the bug: a plausible time in the wrong zone is
 * indistinguishable from a correct one, so it gets acted on. An error is visible.
 *
 * ── Why the Hijri date arrives as a function and not as a string ────────────
 * It used to be a string, and every caller passed the same one: `hijriToday()`, the Hijri date of
 * **today** on the **device**, regardless of which `date` was being computed. That was two defects
 * wearing one parameter. A monthly run stamped thirty days with one Hijri date, and a daily run
 * stamped the location's day with the device's.
 *
 * Taking `hijriFor` instead makes both impossible to express: the only day in scope here is `date`,
 * so the only Hijri date derivable is that day's. The parameter no longer *can* disagree with the
 * times beside it.
 */
export function computeDailyTimes(
  location: PrayerLocation,
  date: string,
  settings: PrayerCalculationSettings,
  hijriFor: (calendarDay: string) => string,
): DailyPrayerTimes | null {
  const day = localDateForCalendarDay(date);
  if (day === null) {
    return null;
  }

  const times = new AdhanPrayerTimes(
    new Coordinates(location.coordinate.latitude, location.coordinate.longitude),
    day,
    buildParameters(settings.method, settings.asr),
  );

  const resolved: PrayerTime[] = [];
  for (const { key, label } of ORDER) {
    const raw = times[key];
    if (!(raw instanceof Date) || Number.isNaN(raw.getTime())) {
      /**
       * A prayer with no time is possible and is not a bug.
       *
       * Above the polar circles there are days with no true sunrise or sunset, and `adhan` reports
       * an invalid date rather than inventing one. Omitting the entry is the honest rendering — the
       * screen shows the prayers that have a time and says nothing about the ones that do not.
       */
      continue;
    }
    const at = toZonedOffsetIso(shifted(raw, settings.offsetsMinutes[key]), location.timeZone);
    if (at === null) {
      // The zone stopped resolving mid-loop, which means the platform cannot format any of them.
      return null;
    }
    resolved.push({ key, label, at });
  }

  // `date` and nothing else: the Hijri date of the day these times belong to.
  return { date, hijriDate: hijriFor(date), location, settings, times: resolved };
}

export type AdhanRepositoryConfig = {
  readonly location: LocationPort;
  /**
   * The Hijri date for a **calendar day**, injected so this file holds no calendar of its own.
   *
   * Takes `YYYY-MM-DD` rather than a `Date`, and the difference is the whole of the correction. A
   * `Date` has to be read through *some* zone to yield a calendar day, and the reading that was
   * happening was the device's — so the field whose job was to say "the Hijri date here" said "the
   * Hijri date where the phone is". A calendar day has already crossed that boundary, once, at
   * `locationCalendarDay`, and carries no zone left to misread.
   */
  readonly hijriFor: (calendarDay: string) => string;
  readonly now?: () => Date;
};

export function createAdhanPrayerTimesRepository(
  config: AdhanRepositoryConfig,
): PrayerTimesRepository {
  const now = config.now ?? (() => new Date());

  /**
   * A coordinate as the domain's shape, carrying **its own** zone.
   *
   * ── What this used to do ────────────────────────────────────────────────────
   * `timeZone: deviceTimeZone()`. The field whose entire purpose is to say where the times belong
   * was filled in with where the phone was, so it agreed with reality only for a user who had not
   * travelled and had not chosen a location manually. Everything downstream then formatted through
   * it and inherited the error.
   *
   * Returns `null` rather than substituting a zone when the coordinate cannot be resolved to one.
   * Callers turn that into an error; none of them falls back to the device.
   */
  const toPrayerLocation = (
    coordinate: Coordinate,
    label: string | null,
    manual: boolean,
    /*
      When the fix behind this location was taken. Carried through rather than re-stamped, so a
      location read back from storage reports the age it actually has — anything derived from it,
      the Hijri date in particular, has to be able to see that.
    */
    resolvedAt: string | null,
  ): PrayerLocation | null => {
    const timeZone = timeZoneForCoordinate(coordinate);
    if (timeZone === null) {
      return null;
    }
    return {
      coordinate,
      label: label ?? `${coordinate.latitude.toFixed(3)}, ${coordinate.longitude.toFixed(3)}`,
      timeZone,
      manual,
      resolvedAt,
    };
  };

  /**
   * Today's calendar day **at the location**.
   *
   * ── Why this is not `isoDay(now())` ────────────────────────────────────────
   * It was, and that was the third of the three timezone defects. Between midnight in the location's
   * zone and midnight in the device's, the two disagree by a day — so a traveller could be shown
   * yesterday's or tomorrow's times, and `getNextPrayer` could search a day that had already ended.
   * The user asks "what are the prayer times where I am", and the day that question is about is the
   * one at the location.
   *
   * It is exported on the repository now, as `locationCalendarDay`. It was private, which is how the
   * fourth instance of the defect happened: `getNextPrayer` used it, and the Prayer screen — which
   * could not reach it — passed `todayIsoDate()` instead, so the day's *times* were computed for the
   * device's calendar day while the next prayer was computed for the location's.
   */
  const todayAt = (location: PrayerLocation): string | null =>
    locationCalendarDay(now(), location.timeZone);

  return {
    locationCalendarDay(location: PrayerLocation): string | null {
      return todayAt(location);
    },

    /**
     * Where the user is, or why NoorLife cannot say.
     *
     * ── The order of preference, and what is absent from it ─────────────────
     * A stored location wins, because it is either the last real device fix or a place the user
     * deliberately chose, and re-waking the GPS on every screen would cost seconds for a coordinate
     * that has moved by metres. Failing that, a device fix — but only when permission is already
     * granted, because this method is called on render and a prompt raised from a render is a prompt
     * the user did not ask for.
     *
     * Failing both, `permission-required`. **Not** a city, not a region, not a default.
     */
    async resolveCurrentLocation(): Promise<FaithResult<PrayerLocation>> {
      const stored = await readStoredLocation();
      if (stored !== null) {
        const resolved = toPrayerLocation(
          stored.coordinate,
          stored.label,
          stored.mode === 'manual',
          stored.resolvedAt,
        );
        /*
          A stored coordinate whose zone will not resolve is unusable rather than approximately
          usable. `unavailable` rather than `not-found`: the place is known, the platform's clock
          rules for it are not.
        */
        return resolved === null
          ? { kind: 'error', code: 'unavailable' }
          : { kind: 'ok', data: resolved };
      }

      const permission = await config.location.getPermission();
      if (permission !== 'granted') {
        return {
          kind: 'permission-required',
          permission: 'location',
          rationale:
            permission === 'services-disabled'
              ? 'Location services are switched off on this device. NoorLife needs them to calculate prayer times and the Qibla direction for where you are.'
              : 'NoorLife uses your location to calculate prayer times and the direction of the Qibla. Your location stays on this device.',
        };
      }

      const fix = await config.location.getCurrentPosition();
      if ('failure' in fix) {
        return fix.failure === 'permission-denied' || fix.failure === 'services-disabled'
          ? {
              kind: 'permission-required',
              permission: 'location',
              rationale:
                'NoorLife needs location access to calculate prayer times and the Qibla direction for where you are.',
            }
          : { kind: 'error', code: fix.failure === 'timed-out' ? 'timeout' : 'unavailable' };
      }

      const label = await config.location.describe(fix.coordinate);
      const resolvedAt = now().toISOString();
      const resolved = toPrayerLocation(fix.coordinate, label, false, resolvedAt);
      if (resolved === null) {
        // Nothing is stored: a coordinate with no resolvable zone would be a stored fix that fails
        // this same way on every future launch.
        return { kind: 'error', code: 'unavailable' };
      }

      /*
        Caller 1 of the mutation boundary: the first device resolution, when nothing is stored yet.
        The same stamp the returned location carries, so the two cannot drift apart.
      */
      await commitActivePrayerLocation({
        mode: 'device',
        coordinate: fix.coordinate,
        label,
        resolvedAt,
        accuracyMetres: fix.accuracyMetres,
      });

      return { kind: 'ok', data: resolved };
    },

    /** The zone a typed coordinate resolves to, resolved without writing anything. */
    previewLocation(coordinate: Coordinate): PrayerLocation | null {
      // No label: a preview shows the *zone*, which is the thing a coordinate determines.
      return toPrayerLocation(coordinate, null, true, null);
    },

    async activeLocationMode(): Promise<'device' | 'manual' | null> {
      const stored = await readStoredLocation();
      return stored === null ? null : stored.mode;
    },

    async saveManualLocation(input: {
      readonly label: string;
      readonly coordinate: Coordinate;
    }): Promise<FaithResult<PrayerLocation>> {
      const label = input.label.trim();
      /*
        The zone is resolved before anything is written. A coordinate with no resolvable zone is
        rejected here rather than stored — a stored location that cannot produce a wall clock fails
        on every launch afterwards, and the failure looks like a bug in prayer times rather than in
        the place.
      */
      const resolved = toPrayerLocation(
        input.coordinate,
        label.length === 0 ? null : label,
        true,
        now().toISOString(),
      );
      if (resolved === null) {
        return { kind: 'error', code: 'unavailable' };
      }

      /*
        Caller 2: the manual save. The boundary owns the revision bump, so this no longer publishes
        anything itself — a screen that both wrote and published could publish before the bytes land.
      */
      const committed = await commitActivePrayerLocation({
        mode: 'manual',
        coordinate: input.coordinate,
        label: label.length === 0 ? null : label,
        resolvedAt: resolved.resolvedAt ?? now().toISOString(),
      });
      if (committed.kind === 'rejected') {
        return { kind: 'error', code: 'unavailable' };
      }
      return { kind: 'ok', data: resolved };
    },

    async switchToDeviceLocation(): Promise<FaithResult<PrayerLocation>> {
      const permission = await config.location.getPermission();
      if (permission !== 'granted') {
        return {
          kind: 'permission-required',
          permission: 'location',
          rationale:
            permission === 'services-disabled'
              ? 'Location services are switched off on this device. NoorLife needs them to use your device location.'
              : 'NoorLife uses your location to calculate prayer times for where you are. Your location stays on this device.',
        };
      }

      const fix = await config.location.getCurrentPosition();
      if ('failure' in fix) {
        // Nothing is written. The saved manual location remains active and remains selected.
        return { kind: 'error', code: fix.failure === 'timed-out' ? 'timeout' : 'unavailable' };
      }

      const label = await config.location.describe(fix.coordinate);
      const resolvedAt = now().toISOString();
      const resolved = toPrayerLocation(fix.coordinate, label, false, resolvedAt);
      if (resolved === null) {
        return { kind: 'error', code: 'unavailable' };
      }

      // Caller 3: switching back to device mode, only once a complete valid snapshot exists.
      const committed = await commitActivePrayerLocation({
        mode: 'device',
        coordinate: fix.coordinate,
        label,
        resolvedAt,
        accuracyMetres: fix.accuracyMetres,
      });
      if (committed.kind === 'rejected') {
        return { kind: 'error', code: 'unavailable' };
      }
      return { kind: 'ok', data: resolved };
    },

    /**
     * A live fix, judged against what is already stored.
     *
     * ── The order of work, and why it is this order ─────────────────────────
     * Permission first, because asking the platform for a position without it is a guaranteed
     * failure with a misleading error. Then the fix — `getCurrentPosition`, never the cache, because
     * that is the whole point of a refresh. Then the *decision*, before any of the expensive work:
     * the reverse geocode and the storage write only happen for a fix that was accepted, which is
     * what keeps geocoding rare rather than once per screen entry.
     *
     * A rejected fix is not an error. The stored location is still correct and still returned; the
     * outcome simply says it was kept and why.
     */
    async refreshCurrentLocation(): Promise<FaithResult<LocationRefresh>> {
      /*
        ── Manual mode is not refreshable, and saying so is the point ───────────
        A saved coordinate is the user's decision. Waking the GPS to "check" it and then either
        discarding the answer or — worse — overwriting Dubai with a stale Mountain View fix are both
        wrong. So the automatic path returns the saved location unchanged, and the screen renders it
        without a device-fix warning, because no device fix was required or attempted.
      */
      const current = await readStoredLocation();
      if (current !== null && current.mode === 'manual') {
        const kept = toPrayerLocation(current.coordinate, current.label, true, current.resolvedAt);
        return kept === null
          ? { kind: 'error', code: 'unavailable' }
          : {
              kind: 'ok',
              data: {
                location: kept,
                accepted: false,
                materialChange: false,
                movedMetres: 0,
                rejectedReason: null,
                mode: 'manual',
              },
            };
      }

      const permission = await config.location.getPermission();
      if (permission !== 'granted') {
        return {
          kind: 'permission-required',
          permission: 'location',
          rationale:
            permission === 'services-disabled'
              ? 'Location services are switched off on this device. NoorLife needs them to calculate prayer times for where you are.'
              : 'NoorLife uses your location to calculate prayer times and the direction of the Qibla. Your location stays on this device.',
        };
      }

      const fix = await config.location.getCurrentPosition();
      if ('failure' in fix) {
        return fix.failure === 'permission-denied' || fix.failure === 'services-disabled'
          ? {
              kind: 'permission-required',
              permission: 'location',
              rationale:
                'NoorLife needs location access to calculate prayer times for where you are.',
            }
          : { kind: 'error', code: fix.failure === 'timed-out' ? 'timeout' : 'unavailable' };
      }

      const stored = await readStoredLocation();
      const existing =
        stored === null
          ? null
          : {
              coordinate: stored.coordinate,
              accuracyMetres: stored.mode === 'device' ? stored.accuracyMetres : null,
              ageMs: Math.max(0, now().getTime() - Date.parse(stored.resolvedAt)),
            };

      const decision = acceptLocationFix(existing, fix);

      if (decision.kind === 'rejected') {
        if (stored === null) {
          // Nothing to fall back to: a rejected first fix leaves the app with no location at all,
          // which is an error rather than a quiet "kept the old one".
          return { kind: 'error', code: 'unavailable' };
        }
        const kept = toPrayerLocation(
          stored.coordinate,
          stored.label,
          stored.mode === 'manual',
          stored.resolvedAt,
        );
        return kept === null
          ? { kind: 'error', code: 'unavailable' }
          : {
              kind: 'ok',
              data: {
                location: kept,
                accepted: false,
                materialChange: false,
                movedMetres: 0,
                rejectedReason: decision.reason,
                mode: 'device',
              },
            };
      }

      /*
        Re-geocoded only on a material move. Below that threshold the place name cannot have changed
        — five kilometres is the same locality by construction — so the previous label is reused and
        the geocoder is not called. That is the rule that keeps reverse-geocoding rare.
      */
      const label = decision.materialChange
        ? await config.location.describe(fix.coordinate)
        : (stored?.label ?? null);

      const resolvedAt = now().toISOString();
      const resolved = toPrayerLocation(fix.coordinate, label, false, resolvedAt);
      if (resolved === null) {
        // A coordinate whose zone will not resolve is unusable. The stored location is untouched.
        return { kind: 'error', code: 'unavailable' };
      }

      /*
        Caller 4: an accepted automatic refresh. The boundary suppresses the write and the revision
        entirely when the snapshot is equivalent, which is what stops a stationary device
        rescheduling notifications every time a screen opens.
      */
      await commitActivePrayerLocation({
        mode: 'device',
        coordinate: fix.coordinate,
        label,
        resolvedAt,
        accuracyMetres: fix.accuracyMetres,
      });

      return {
        kind: 'ok',
        data: {
          location: resolved,
          accepted: true,
          materialChange: decision.materialChange,
          movedMetres: decision.movedMetres,
          rejectedReason: null,
          mode: 'device',
        },
      };
    },

    async searchLocations(query: string): Promise<FaithResult<readonly PrayerLocation[]>> {
      const trimmed = query.trim();
      if (trimmed.length < 2) {
        return { kind: 'no-results', query: trimmed };
      }
      const results = await config.location.search(trimmed);
      if (results.length === 0) {
        return { kind: 'no-results', query: trimmed };
      }
      /*
        A search result whose zone will not resolve is dropped rather than listed. Offering a city
        NoorLife cannot compute a wall clock for would be a row that fails once selected.
      */
      const resolved = results
        /* `null` age: a search result describes a place, not a fix, until the user selects it. */
        .map((result) => toPrayerLocation(result.coordinate, result.label, true, null))
        .filter((place): place is PrayerLocation => place !== null);

      return resolved.length === 0
        ? { kind: 'no-results', query: trimmed }
        : { kind: 'ok', data: resolved };
    },

    async getDailyTimes(
      location: PrayerLocation,
      date: string,
      settings: PrayerCalculationSettings,
    ): Promise<FaithResult<DailyPrayerTimes>> {
      const computed = computeDailyTimes(location, date, settings, config.hijriFor);
      if (computed === null) {
        return { kind: 'error', code: 'not-found', detail: 'Expected an ISO date, YYYY-MM-DD.' };
      }
      // A day on which no prayer resolved is polar, not broken — and `empty` is what it is.
      return computed.times.length === 0 ? { kind: 'empty' } : { kind: 'ok', data: computed };
    },

    async getMonthlyTimes(
      location: PrayerLocation,
      month: string,
      settings: PrayerCalculationSettings,
    ): Promise<FaithResult<readonly DailyPrayerTimes[]>> {
      const match = /^(\d{4})-(\d{2})$/.exec(month);
      if (match === null) {
        return { kind: 'error', code: 'not-found', detail: 'Expected a month, YYYY-MM.' };
      }
      const year = Number(match[1]);
      const monthIndex = Number(match[2]) - 1;
      if (monthIndex < 0 || monthIndex > 11) {
        return { kind: 'error', code: 'not-found' };
      }

      /*
        Month length by Julian-day arithmetic rather than by `new Date(year, month, 0).getDate()`.
        That trick materialises device-local midnight and reads it back with a device-local getter,
        and in a zone whose clock skips midnight it can resolve forward into the next day — giving a
        30-day month 31 entries. See `daysInGregorianMonth`.
      */
      const days = daysInGregorianMonth(year, monthIndex + 1);
      const results: DailyPrayerTimes[] = [];
      for (let day = 1; day <= days; day += 1) {
        const date = `${match[1]}-${match[2]}-${String(day).padStart(2, '0')}`;
        /*
          ── Each day converts its own date ────────────────────────────────────
          This loop used to pass `hijriToday()`, so all thirty entries carried the same Hijri date —
          today's — and a month view showed one Hijri day repeated beside thirty different Gregorian
          ones. `config.hijriFor` is now applied per day inside `computeDailyTimes`, from `date`, so
          the thirty are thirty and they advance in step with the Gregorian column beside them.
        */
        const computed = computeDailyTimes(location, date, settings, config.hijriFor);
        if (computed !== null && computed.times.length > 0) {
          results.push(computed);
        }
      }
      return results.length === 0 ? { kind: 'empty' } : { kind: 'ok', data: results };
    },

    /**
     * Which prayer is next, and how long until it.
     *
     * ── Why tomorrow's Fajr is computed rather than wrapping to today's ─────
     * After Isha there is no prayer left today, and the next one is tomorrow's Fajr — at tomorrow's
     * time, which is not today's. Reusing today's Fajr would be wrong by a minute or two in the
     * middle of the year and by far more at the solstices, and it would report a negative duration.
     */
    async getNextPrayer(
      location: PrayerLocation,
      settings: PrayerCalculationSettings,
    ): Promise<FaithResult<NextPrayer>> {
      const current = now();
      const day = todayAt(location);
      if (day === null) {
        return { kind: 'error', code: 'unavailable' };
      }
      const today = computeDailyTimes(location, day, settings, config.hijriFor);
      if (today === null) {
        return { kind: 'error', code: 'unavailable' };
      }

      /**
       * Compared as **instants**, which is the one comparison that is zone-independent.
       *
       * `new Date(time.at)` parses the offset the string carries, so the epoch milliseconds it yields
       * are the true instant regardless of which zone stamped it and which zone the device is in.
       * That is why the offset is written into `at` rather than dropped — a bare wall clock could
       * only be compared against another wall clock in the same zone, and here there are two.
       */
      const upcoming = today.times
        .filter((time) => time.key !== 'sunrise')
        .find((time) => new Date(time.at).getTime() > current.getTime());

      if (upcoming !== undefined) {
        return {
          kind: 'ok',
          data: { prayer: upcoming, minutesUntil: minutesBetween(current, upcoming.at) },
        };
      }

      /*
        Tomorrow *at the location*, stepped on the calendar day rather than by adding 86,400,000 ms.
        Adding a fixed day of milliseconds lands an hour early or late across a DST transition, which
        on the transition weekend could repeat or skip a day.
      */
      const nextDay = addCalendarDays(day, 1);
      if (nextDay === null) {
        return { kind: 'error', code: 'unavailable' };
      }
      // `nextDay`, so tomorrow's entry carries tomorrow's Hijri date rather than today's.
      const tomorrow = computeDailyTimes(location, nextDay, settings, config.hijriFor);
      const fajr = tomorrow?.times.find((time) => time.key === 'fajr');
      if (fajr === undefined) {
        // Polar summer: no Fajr tomorrow either. Honest, and not an error.
        return { kind: 'empty' };
      }
      return { kind: 'ok', data: { prayer: fajr, minutesUntil: minutesBetween(current, fajr.at) } };
    },

    async readNotificationPreferences(): Promise<
      FaithResult<readonly PrayerNotificationPreference[]>
    > {
      return { kind: 'ok', data: (await readFaithPreferences()).prayerNotifications };
    },

    async writeNotificationPreferences(
      preferences: readonly PrayerNotificationPreference[],
    ): Promise<FaithResult<readonly PrayerNotificationPreference[]>> {
      const saved = await writeFaithPreferences({ prayerNotifications: preferences });
      return { kind: 'ok', data: saved.prayerNotifications };
    },
  };
}

/**
 * Whole minutes from `from` until `iso`, never negative.
 *
 * `isoDay`, which used to sit here, is gone: it read the *device's* calendar day, and every caller
 * now asks `todayAt(location)` for the day at the place instead.
 */
function minutesBetween(from: Date, iso: string): number {
  return Math.max(0, Math.round((new Date(iso).getTime() - from.getTime()) / 60_000));
}

/** Re-exported so a caller can name the prayer set without importing `adhan`. */
export { Prayer as AdhanPrayer };
