import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  activeLocationRevision,
  resetActiveLocationRevisionForTest,
} from '../data/location/active-location';
import { alertsFor } from '@/test-support/prayer-alert-fixtures';
import { formattedHijriForCalendarDay, locationDayFor } from '../data/calendar-day';
import { hasData } from '../data/faith-result';
import { createHijriCalendarRepository } from '../data/hijri/hijri-calendar.repository';
import { createFakeNotificationPort } from '../data/notifications/fake-notification.port';
import { reconcilePrayerAlerts } from '../data/notifications/prayer-notifications.service';
import { createAdhanPrayerTimesRepository } from '../data/prayer/adhan-prayer-times.repository';
import { qiblaBearing } from '../data/qibla/qibla';
import type { LocationPort } from '../data/location/location.port';
import type {
  CityChoice,
  PrayerCalculationSettings,
  PrayerLocation,
  PrayerTimesRepository,
} from '../data/prayer-times.repository';
import {
  commitActivePrayerLocation,
  readStoredLocation,
  resetPrayerLocationSnapshotForTest,
} from '../storage/faith-location';

/**
 * One save, one revision, and **every** location-derived surface moving together.
 *
 * ── Why this is an integration test and not nine unit tests ─────────────────
 * `faith-location-revision-propagation.test.ts` already proves, by source scan, that every
 * location-derived `useFaithResource` keys on the revision. That is the right shape for an invariant
 * — it catches a tenth resource added next month — and it is *structural*: it proves the keys change,
 * not that the values behind them are recomputed from the new place.
 *
 * The failure it cannot see is the one where every key moves and something downstream still answers
 * from the old coordinate: a cached bearing, a day derived from a stale zone, a notification schedule
 * built from the location as it was before the write landed. Each of those passes a per-hook test,
 * because each hook is individually correct. What is wrong is the *composition*.
 *
 * So this file performs the real transition once — a device fix in Mountain View, then Dubai chosen
 * from the bundled GeoNames catalogue — and then interrogates every surface that derives from a
 * location, through the same repositories the screens use, asserting each one now answers for Dubai
 * and that nothing anywhere still answers for Mountain View.
 *
 * ── Why Mountain View → Dubai specifically ─────────────────────────────────
 * They differ in every dimension the module can get wrong: twelve hours of longitude, opposite
 * hemispheres of the Qibla bearing, `America/Los_Angeles` against `Asia/Dubai`, and an offset gap
 * wide enough that at the chosen instant the two are on *different calendar days*. A pair of nearby
 * cities would let a stale value pass as a rounding difference.
 */

const MOUNTAIN_VIEW = { latitude: 37.3861, longitude: -122.0839 };
/** GeoNames' own record for Dubai — the centroid, not the round pair a person would type. */
const DUBAI_CITY: CityChoice = {
  geonamesId: 292223,
  name: 'Dubai',
  region: 'Dubai',
  countryCode: 'AE',
  countryName: 'United Arab Emirates',
  coordinate: { latitude: 25.07725, longitude: 55.30927 },
};

const SETTINGS: PrayerCalculationSettings = {
  method: 'muslim-world-league',
  asr: 'standard',
  offsetsMinutes: {},
};

/**
 * 2026-08-13, 20:30 UTC.
 *
 * Chosen because the two locations are on different calendar days at that instant: 13:30 on the 13th
 * in Mountain View, 00:30 on the **14th** in Dubai. A day derived from the old zone is therefore not
 * merely a different number — it is a different date, which no rounding could produce.
 */
const NOW = new Date('2026-08-13T20:30:00.000Z');

/**
 * A device with no location at all.
 *
 * Deliberately barren: every location in this file arrives through the storage boundary or through a
 * city save, so a port that could supply a fix would give the repository a second way to answer and
 * make "which location is in force" ambiguous — the exact question under test.
 */
function deadLocationPort(): LocationPort {
  return {
    getPermission: async () => 'denied',
    requestPermission: async () => 'denied',
    getLastKnownPosition: async () => null,
    getCurrentPosition: async () => ({ failure: 'permission-denied' as const }),
    describe: async () => null,
    search: async () => [],
    hasCompass: async () => false,
    watchHeading: async () => () => undefined,
  };
}

function repositories(): {
  readonly prayerTimes: PrayerTimesRepository;
  readonly calendar: ReturnType<typeof createHijriCalendarRepository>;
} {
  return {
    prayerTimes: createAdhanPrayerTimesRepository({
      location: deadLocationPort(),
      hijriFor: formattedHijriForCalendarDay,
      now: () => NOW,
    }),
    calendar: createHijriCalendarRepository(),
  };
}

/** Everything the app derives from the active location, gathered in one pass. */
async function derivedSnapshot(repos: ReturnType<typeof repositories>) {
  const resolved = await repos.prayerTimes.resolveCurrentLocation();
  if (!hasData(resolved)) {
    throw new Error(`Expected a resolved location, got ${resolved.kind}.`);
  }
  const location: PrayerLocation = resolved.data;

  const day = repos.prayerTimes.locationCalendarDay(location);
  if (day === null) {
    throw new Error('Expected a calendar day at the location.');
  }

  const times = await repos.prayerTimes.getDailyTimes(location, day, SETTINGS);
  const next = await repos.prayerTimes.getNextPrayer(location, SETTINGS);
  const today = await repos.calendar.getLocationToday(location);
  const observances = await repos.calendar.listUpcomingObservances(location, 3);

  return {
    location,
    timeZone: location.timeZone,
    mode: location.mode,
    day,
    hijriDay: locationDayFor(location, NOW),
    fajr: hasData(times)
      ? (times.data.times.find((time) => time.key === 'fajr')?.at ?? null)
      : null,
    allTimes: hasData(times) ? times.data.times.map((time) => time.at) : [],
    nextPrayerAt: hasData(next) ? next.data.prayer.at : null,
    /** The Qibla bearing is a pure function of the coordinate — the Qibla screen's whole output. */
    qibla: qiblaBearing(location.coordinate),
    calendarToday: hasData(today) ? today.data : null,
    observanceCount: hasData(observances) ? observances.data.length : 0,
  };
}

/** The next calendar day, as `YYYY-MM-DD`. Plain arithmetic — no zone to misread. */
function addDay(day: string): string | null {
  const parsed = Date.parse(`${day}T00:00:00.000Z`);
  return Number.isFinite(parsed) ? new Date(parsed + 86_400_000).toISOString().slice(0, 10) : null;
}

beforeEach(async () => {
  await AsyncStorage.clear();
  resetPrayerLocationSnapshotForTest();
  resetActiveLocationRevisionForTest();
});

describe('saving a city moves every location-derived surface, in one commit', () => {
  it('publishes exactly one revision and recomputes everything from Dubai', async () => {
    const repos = repositories();

    // ── 1. A device-mode location, committed through the real boundary ──────
    await commitActivePrayerLocation({
      mode: 'device',
      coordinate: MOUNTAIN_VIEW,
      label: 'Mountain View, United States',
      resolvedAt: NOW.toISOString(),
      accuracyMetres: 15,
    });
    resetActiveLocationRevisionForTest();

    const before = await derivedSnapshot(repos);
    expect(before.mode).toBe('device');
    expect(before.timeZone).toBe('America/Los_Angeles');
    expect(before.day).toBe('2026-08-13');

    // ── 2. Dubai, selected from the bundled catalogue ───────────────────────
    const saved = await repos.prayerTimes.saveCityLocation(DUBAI_CITY);
    expect(saved.kind).toBe('ok');

    // ── 3. Exactly one revision for one logical change ──────────────────────
    expect(activeLocationRevision()).toBe(1);

    const after = await derivedSnapshot(repos);

    // ── 5. The timezone is Dubai's ──────────────────────────────────────────
    expect(after.timeZone).toBe('Asia/Dubai');
    expect(after.mode).toBe('city');

    // ── 4. Every location-derived value moved ───────────────────────────────
    expect(after.day).not.toBe(before.day);
    // Different calendar days, not merely different times — see the note on `NOW`.
    expect(after.day).toBe('2026-08-14');
    expect(after.fajr).not.toBe(before.fajr);
    expect(after.nextPrayerAt).not.toBe(before.nextPrayerAt);
    expect(after.qibla).not.toBeCloseTo(before.qibla, 1);
    expect(after.calendarToday).not.toEqual(before.calendarToday);

    // The Hijri "today" is derived from the location's day, so it moved with it.
    expect(after.hijriDay.status).toBe('resolved');
    if (after.hijriDay.status === 'resolved' && before.hijriDay.status === 'resolved') {
      expect(after.hijriDay.value.timeZone).toBe('Asia/Dubai');
      expect(after.hijriDay.value.day).not.toBe(before.hijriDay.value.day);
      // A city the user selected is their own claim about where they are, not a device fix.
      expect(after.hijriDay.value.provenance).toBe('user-selected');
    }

    // ── 6. No old-location calculation survives ─────────────────────────────
    /*
      Every stamped instant carries its zone's offset, so a time still computed for Mountain View
      would be stamped `-07:00`. Asserting on the offset catches a stale value that happens to look
      plausible, which a comparison against the previous *strings* alone would not.
    */
    expect(after.allTimes.length).toBeGreaterThan(0);
    for (const at of after.allTimes) {
      expect(at).toContain('+04:00');
      expect(at).not.toContain('-07:00');
      expect(before.allTimes).not.toContain(at);
    }

    const stored = await readStoredLocation();
    expect(stored?.mode).toBe('city');
    expect(stored?.coordinate).toEqual(DUBAI_CITY.coordinate);
    expect(stored?.timezone).toBe('Asia/Dubai');
    // Nothing of the previous place is left in the record — not the label, not the accuracy.
    expect(JSON.stringify(stored)).not.toMatch(/Mountain View/);
    expect(stored).not.toHaveProperty('accuracyMetres');
  });

  /*
    ── 7. Reconciliation consumes the committed snapshot ─────────────────────
    The reconciler resolves the location itself rather than being handed one, which is what makes
    this assertable: if it ran against anything other than what is in storage at that moment, the
    alerts it creates would carry Mountain View's instants. Comparing the scheduled instants against
    the times the *repository* produces for Dubai is a comparison between the alarm and the screen,
    which is the property that actually matters to a user.
  */
  it('schedules prayer alerts from the committed Dubai snapshot, not the previous location', async () => {
    const repos = repositories();
    await commitActivePrayerLocation({
      mode: 'device',
      coordinate: MOUNTAIN_VIEW,
      label: 'Mountain View, United States',
      resolvedAt: NOW.toISOString(),
      accuracyMetres: 15,
    });

    const notifications = createFakeNotificationPort({ permission: 'granted' });
    const saved = await repos.prayerTimes.saveCityLocation(DUBAI_CITY);
    expect(saved.kind).toBe('ok');

    // Exactly as the screen does it: reconcile *after* the save has resolved.
    const status = await reconcilePrayerAlerts(
      { prayerTimes: repos.prayerTimes, notifications, now: () => NOW },
      {
        masterEnabled: true,
        alerts: alertsFor('fajr', 'dhuhr', 'asr', 'maghrib', 'isha'),
        settings: SETTINGS,
      },
    );

    expect(status.schedule.kind).toBe('scheduled');

    const pending = notifications.pending();
    expect(pending.length).toBeGreaterThan(0);

    for (const alert of pending) {
      expect(alert.at).not.toBeNull();
    }

    /*
      And the instants are the repository's own. Every scheduled alert must be a time the Prayer
      screen would print for Dubai on one of the days in the horizon — not merely a plausible time in
      the right zone, but the *same* instant, so an alarm and the screen cannot disagree by a minute.
    */
    const resolved = await repos.prayerTimes.resolveCurrentLocation();
    expect(hasData(resolved)).toBe(true);
    if (!hasData(resolved)) return;

    const screenInstants = new Set<string>();
    let day = repos.prayerTimes.locationCalendarDay(resolved.data);
    for (let offset = 0; offset < 8 && day !== null; offset += 1) {
      const times = await repos.prayerTimes.getDailyTimes(resolved.data, day, SETTINGS);
      if (hasData(times)) {
        for (const time of times.data.times) {
          screenInstants.add(new Date(time.at).toISOString());
        }
      }
      day = addDay(day);
    }

    for (const alert of pending) {
      expect(screenInstants).toContain(new Date(String(alert.at)).toISOString());
    }

    /*
      And the same set built for Mountain View shares nothing with what was scheduled. The port
      normalises every stamp to UTC, so an offset check would prove nothing here — comparing
      *instants* is what distinguishes "the right time in Dubai" from "the old time relabelled".
    */
    const mountainView: PrayerLocation = {
      coordinate: MOUNTAIN_VIEW,
      label: 'Mountain View, United States',
      timeZone: 'America/Los_Angeles',
      mode: 'device',
      resolvedAt: NOW.toISOString(),
    };
    const staleInstants = new Set<string>();
    let staleDay = repos.prayerTimes.locationCalendarDay(mountainView);
    for (let offset = 0; offset < 8 && staleDay !== null; offset += 1) {
      const times = await repos.prayerTimes.getDailyTimes(mountainView, staleDay, SETTINGS);
      if (hasData(times)) {
        for (const time of times.data.times) {
          staleInstants.add(new Date(time.at).toISOString());
        }
      }
      staleDay = addDay(staleDay);
    }

    for (const alert of pending) {
      expect(staleInstants).not.toContain(new Date(String(alert.at)).toISOString());
    }
  });

  it('leaves every surface on the previous location when a save is refused', async () => {
    const repos = repositories();
    await commitActivePrayerLocation({
      mode: 'device',
      coordinate: MOUNTAIN_VIEW,
      label: 'Mountain View, United States',
      resolvedAt: NOW.toISOString(),
      accuracyMetres: 15,
    });
    resetActiveLocationRevisionForTest();

    const before = await derivedSnapshot(repos);

    // A city the catalogue does not contain. Nothing may be written, and nothing may be published.
    const refused = await repos.prayerTimes.saveCityLocation({
      ...DUBAI_CITY,
      geonamesId: 999_999_999,
    });
    expect(refused.kind).toBe('error');
    expect(activeLocationRevision()).toBe(0);

    const after = await derivedSnapshot(repos);
    expect(after.timeZone).toBe(before.timeZone);
    expect(after.day).toBe(before.day);
    expect(after.fajr).toBe(before.fajr);
    expect(after.qibla).toBe(before.qibla);
  });
});
