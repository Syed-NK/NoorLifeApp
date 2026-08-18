import AsyncStorage from '@react-native-async-storage/async-storage';
import { render, screen } from '@testing-library/react-native';
import React from 'react';
import { useWindowDimensions } from 'react-native';

import { warmUpFirstMount } from '@/test-support/mock-latency-timers';
import { ModuleHomeScreen } from '@features/modules/screens/module-home-screen';

import { formattedHijriForCalendarDay } from '../data/calendar-day';
import { hasData } from '../data/faith-result';
import { createHijriCalendarRepository } from '../data/hijri/hijri-calendar.repository';
import { resetActiveLocationRevisionForTest } from '../data/location/active-location';
import type { LocationPort } from '../data/location/location.port';
import { createAdhanPrayerTimesRepository } from '../data/prayer/adhan-prayer-times.repository';
import { formatPrayerClock } from '../data/prayer/prayer-clock';
import type {
  NextPrayer,
  PrayerCalculationSettings,
  PrayerTimesRepository,
} from '../data/prayer-times.repository';
import { createMockFaithRepositories } from '../data/mock';
import { FaithRepositoryProvider } from '../di/faith-repository-context';
import { PrayerTimesScreen } from '../screens/prayer-times-screen';
import {
  commitActivePrayerLocation,
  resetLocationOperationsForTest,
  resetPrayerLocationSnapshotForTest,
} from '../storage/faith-location';

/*
  Faked so the responsive case can drive the hero at the tightest supported combination. Every other
  case uses the baseline below.
*/
jest.mock('react-native/Libraries/Utilities/useWindowDimensions');
const mockedDimensions = useWindowDimensions as unknown as jest.Mock;

/** The Pixel baseline. Set at module scope because the warm-up mount runs before `beforeEach`. */
const BASELINE_VIEWPORT = { width: 393, height: 852, scale: 3, fontScale: 1 };
mockedDimensions.mockReturnValue(BASELINE_VIEWPORT);

/**
 * "Fajr at 4:31 AM" beside "Fajr 4:30 AM", and why both are right.
 *
 * ── The report this closes ──────────────────────────────────────────────────
 * The two figures came from two intentionally different sources: the timeline renders the location's
 * *current* day, and the next-prayer card renders `getNextPrayer`, which after Isha correctly rolls
 * over to tomorrow's Fajr. Consecutive days' Fajr differ — in Dubai on 13/14 August 2026 by exactly
 * one minute — so the screen showed a one-minute contradiction with no nearby explanation. It was
 * never a rounding, formatting or caching fault: `formatPrayerClock` reads `HH:MM` straight out of
 * the stamped string and is the only prayer-clock formatter in the app.
 *
 * These cases lock in the numbers that make the contradiction real, so a future change cannot make
 * the test vacuous by choosing a date where the two days happen to agree.
 *
 * ── Everything here uses an injected clock ──────────────────────────────────
 * `now` is passed to the repository. Nothing reads the real time, so the after-Isha and before-Isha
 * cases are facts about the fixture rather than about when the suite happens to run.
 */

const DUBAI = { latitude: 25.07725, longitude: 55.30927 };

const SETTINGS: PrayerCalculationSettings = {
  method: 'muslim-world-league',
  asr: 'standard',
  offsetsMinutes: {},
};

/** 23:02 in Dubai on 13 August 2026 — after Isha (20:12), so the next prayer is tomorrow's Fajr. */
const AFTER_ISHA = new Date('2026-08-13T19:02:00.000Z');
/** 09:00 in Dubai on the same day — Dhuhr is still ahead. */
const BEFORE_ISHA = new Date('2026-08-13T05:00:00.000Z');

function port(): LocationPort {
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

function repositoryAt(now: Date): PrayerTimesRepository {
  return createAdhanPrayerTimesRepository({
    location: port(),
    hijriFor: formattedHijriForCalendarDay,
    now: () => now,
  });
}

async function seedDubai(): Promise<void> {
  await commitActivePrayerLocation({
    mode: 'city',
    coordinate: DUBAI,
    label: 'Dubai, United Arab Emirates',
    geonamesId: 292223,
    countryCode: 'AE',
    admin1: 'Dubai',
    resolvedAt: '2026-08-13T12:00:00.000Z',
  });
}

async function nextAt(now: Date): Promise<NextPrayer> {
  const repository = repositoryAt(now);
  const location = await repository.resolveCurrentLocation();
  if (!hasData(location)) {
    throw new Error(`Expected a location, got ${location.kind}.`);
  }
  const next = await repository.getNextPrayer(location.data, SETTINGS);
  if (!hasData(next)) {
    throw new Error(`Expected a next prayer, got ${next.kind}.`);
  }
  return next.data;
}

async function todaysFajrClock(now: Date): Promise<string> {
  const repository = repositoryAt(now);
  const location = await repository.resolveCurrentLocation();
  if (!hasData(location)) {
    throw new Error('Expected a location.');
  }
  const day = repository.locationCalendarDay(location.data);
  if (day === null) {
    throw new Error('Expected a calendar day.');
  }
  const times = await repository.getDailyTimes(location.data, day, SETTINGS);
  if (!hasData(times)) {
    throw new Error('Expected today’s times.');
  }
  const fajr = times.data.times.find((time) => time.key === 'fajr');
  if (fajr === undefined) {
    throw new Error('Expected a Fajr time.');
  }
  return formatPrayerClock(fajr.at);
}

beforeEach(async () => {
  await AsyncStorage.clear();
  resetPrayerLocationSnapshotForTest();
  resetLocationOperationsForTest();
  resetActiveLocationRevisionForTest();
  await seedDubai();
  resetActiveLocationRevisionForTest();
  mockedDimensions.mockReturnValue(BASELINE_VIEWPORT);
});

describe('the domain says which day the next prayer belongs to', () => {
  it('reports tomorrow after Isha, with the exact one-minute difference intact', async () => {
    const next = await nextAt(AFTER_ISHA);

    expect(next.dayRelation).toBe('tomorrow');
    expect(next.prayer.key).toBe('fajr');
    expect(formatPrayerClock(next.prayer.at)).toBe('4:31 AM');
    // The instant is on the *next* location-day, which is what makes it a different Fajr.
    expect(next.prayer.at.startsWith('2026-08-14')).toBe(true);

    // And today's Fajr — the timeline's figure — is genuinely a different minute.
    expect(await todaysFajrClock(AFTER_ISHA)).toBe('4:30 AM');
  });

  it('reports today before Isha, and matches the timeline row it names', async () => {
    const next = await nextAt(BEFORE_ISHA);

    expect(next.dayRelation).toBe('today');
    expect(next.prayer.at.startsWith('2026-08-13')).toBe(true);

    // The row it corresponds to on today's timeline carries the identical instant.
    const repository = repositoryAt(BEFORE_ISHA);
    const location = await repository.resolveCurrentLocation();
    if (!hasData(location)) throw new Error('Expected a location.');
    const day = repository.locationCalendarDay(location.data);
    if (day === null) throw new Error('Expected a day.');
    const times = await repository.getDailyTimes(location.data, day, SETTINGS);
    if (!hasData(times)) throw new Error('Expected times.');

    expect(times.data.times.some((time) => time.at === next.prayer.at)).toBe(true);
  });

  /*
    The two days' Fajr must be allowed to differ. A test that asserted they matched would be asserting
    the defect, and one written on a date where they coincide would pass without testing anything.
  */
  it('does not force consecutive days to agree', async () => {
    const tomorrowsFajr = formatPrayerClock((await nextAt(AFTER_ISHA)).prayer.at);
    expect(tomorrowsFajr).not.toBe(await todaysFajrClock(AFTER_ISHA));
  });
});

describe('the relation is the location’s, not the device’s', () => {
  /*
    ── Why this case exists ──────────────────────────────────────────────────
    At 19:02 UTC the device is on 13 August and so is Dubai — but at 21:00 UTC the device is still on
    the 13th while Dubai has already turned over to the 14th. A relation derived from a device date
    would call the small hours of Dubai's 14th "tomorrow" when they are today, and would then label
    the card wrongly for every traveller east of the device's zone.
  */
  it('treats the location’s own midnight as the boundary', async () => {
    // 00:30 on 14 August in Dubai; 20:30 on the 13th in UTC, and earlier still further west.
    const justAfterLocalMidnight = new Date('2026-08-13T20:30:00.000Z');
    const next = await nextAt(justAfterLocalMidnight);

    // Dubai's day is now the 14th, so the 14th's Fajr is *today's* — not tomorrow's.
    expect(next.dayRelation).toBe('today');
    expect(next.prayer.at.startsWith('2026-08-14')).toBe(true);
    expect(formatPrayerClock(next.prayer.at)).toBe('4:31 AM');
  });

  it('rolls over on the location’s clock even when the device day has not changed', async () => {
    // 23:59 in Dubai on the 13th. Device UTC is still 19:59 on the 13th.
    const lateOnTheThirteenth = new Date('2026-08-13T19:59:00.000Z');
    const next = await nextAt(lateOnTheThirteenth);
    expect(next.dayRelation).toBe('tomorrow');

    // One minute later at the location, the same instant is "today" — the boundary is the location's.
    const justPastMidnight = new Date('2026-08-13T20:01:00.000Z');
    expect((await nextAt(justPastMidnight)).dayRelation).toBe('today');
  });
});

describe('the Prayer Times card says it', () => {
  warmUpFirstMount(async () => {
    render(
      <FaithRepositoryProvider repositories={createMockFaithRepositories()}>
        <PrayerTimesScreen />
      </FaithRepositoryProvider>,
    );
    await drain();
    return screen;
  });

  async function renderAt(now: Date) {
    const base = createMockFaithRepositories();
    const repositories = {
      ...base,
      prayerTimes: repositoryAt(now),
      calendar: createHijriCalendarRepository(() => now),
    };
    render(
      <FaithRepositoryProvider repositories={repositories}>
        <PrayerTimesScreen />
      </FaithRepositoryProvider>,
    );
    await drain();
    return screen;
  }

  it('qualifies the green card itself, not only a distant footnote', async () => {
    await renderAt(AFTER_ISHA);

    const eyebrow = screen.getByTestId('faith-prayer-next-eyebrow');
    expect(String(eyebrow.props.children)).toBe('Next prayer tomorrow');

    // The qualifier is inside the card the contradiction is on.
    const card = screen.getByTestId('faith-prayer-next');
    expect(String(card.props.accessibilityLabel)).toMatch(/^Next prayer tomorrow\./);
    expect(String(card.props.accessibilityLabel)).toContain('Fajr at 4:31 AM');

    // And the timeline still shows today's Fajr, unrelabelled.
    expect(
      String(screen.getByTestId('faith-prayer-journey-fajr').props.accessibilityLabel),
    ).toContain('4:30 AM');
  });

  it('says nothing about tomorrow when the next prayer is today', async () => {
    await renderAt(BEFORE_ISHA);

    expect(String(screen.getByTestId('faith-prayer-next-eyebrow').props.children)).toBe(
      'Next prayer',
    );
    expect(String(screen.getByTestId('faith-prayer-next').props.accessibilityLabel)).not.toMatch(
      /tomorrow/i,
    );
  });
});

describe('the Faith Home hero says it too', () => {
  /*
    ── The gap this closes ───────────────────────────────────────────────────
    Prayer Times at least had a footnote at the foot of the timeline. Faith Home had nothing: the
    hero read "Fajr 4:31 AM" and the worship card immediately beside it read "Fajr Prayer 4:30 AM",
    with no qualifier anywhere on the screen. It is the sharper of the two, because the two figures
    are adjacent rather than a screen apart.
  */
  async function renderHomeAt(now: Date) {
    const base = createMockFaithRepositories();
    const repositories = {
      ...base,
      prayerTimes: repositoryAt(now),
      calendar: createHijriCalendarRepository(() => now),
    };
    render(
      <FaithRepositoryProvider repositories={repositories}>
        <ModuleHomeScreen moduleId="faith" />
      </FaithRepositoryProvider>,
    );
    await drain();
    return screen;
  }

  it('qualifies the hero when the next prayer is tomorrow', async () => {
    await renderHomeAt(AFTER_ISHA);
    expect(String(screen.getByTestId('faith-hero-prayer').props.children)).toBe(
      'Fajr 4:31 AM tomorrow',
    );
  });

  it('leaves the hero unqualified when the next prayer is today', async () => {
    await renderHomeAt(BEFORE_ISHA);
    const headline = String(screen.getByTestId('faith-hero-prayer').props.children);
    expect(headline).not.toMatch(/tomorrow/i);
    expect(headline).toMatch(/^\w+ \d{1,2}:\d{2} (AM|PM)$/);
  });

  /*
    The hero's headline is a locked line: it shrinks to `titleMinScale` and then wraps to two lines
    before it truncates. The qualifier must not push it past that at the tightest supported
    combination, so this renders the real thing at 320 dp and font scale 1.5 and asserts the copy
    survives whole — the failure mode being an ellipsised "Fajr 4:31 AM tomo…".
  */
  it('keeps the qualified headline intact at 320 dp and font scale 1.5', async () => {
    mockedDimensions.mockReturnValue({ width: 320, height: 800, scale: 3, fontScale: 1.5 });
    await renderHomeAt(AFTER_ISHA);

    const headline = screen.getByTestId('faith-hero-prayer');
    expect(String(headline.props.children)).toBe('Fajr 4:31 AM tomorrow');
    // Shrink-then-wrap is what gives it room; two lines is the component's declared limit.
    expect(headline.props.numberOfLines).toBe(2);
    expect(headline.props.adjustsFontSizeToFit).toBe(true);
  });
});

/** Advances the loop without touching the clock. See `prayer-location-modes` for why not `findBy*`. */
async function drain(passes = 8): Promise<void> {
  for (let pass = 0; pass < passes; pass += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}
