import AsyncStorage from '@react-native-async-storage/async-storage';
import { seedPrayerLocation } from '@/test-support/faith-location-fixtures';
import { seedTranslationPreference } from '@/test-support/faith-preferences-fixtures';
import { render, screen } from '@testing-library/react-native';
import { installMockLatencyTimers } from '@/test-support/mock-latency-timers';

import React, { type ReactElement } from 'react';

import type { FaithRepositories } from '../data';
import type { FaithResult } from '../data/faith-result';
import { createMockFaithRepositories } from '../data/mock';
import { FaithRepositoryProvider } from '../di/faith-repository-context';
import { BookmarksScreen } from '../screens/bookmarks-screen';
import { DuasScreen } from '../screens/duas-screen';
import { HadithScreen } from '../screens/hadith-screen';
import { MoreScreen } from '../screens/more-screen';
import { MosquesScreen } from '../screens/mosques-screen';
import { QiblaScreen } from '../screens/qibla-screen';
import { PrayerTimesScreen } from '../screens/prayer-times-screen';
import { QuranScreen } from '../screens/quran-screen';
import { SearchScreen } from '../screens/search-screen';
import { TasbihScreen } from '../screens/tasbih-screen';
import { WorshipScreen } from '../screens/worship-screen';
import { FaithAiScreen } from '../screens/faith-ai-screen';
import { CalendarScreen, EventsScreen } from '../screens/calendar-screens';
import { DailyAyahScreen } from '../screens/daily-ayah-screen';
import { ReaderScreen } from '../screens/reader-screen';
import { PreferencesScreen } from '../screens/preferences-screen';

// Two costs this removes: the 280 ms every Faith mock repository sleeps on each read, and the
// one-off compile cost of the first mount, warmed up in `beforeAll` so no test is charged for it.
// Quran is the warm-up because it is the heaviest of the seventeen.
installMockLatencyTimers(() => withRepositories(<QuranScreen key="warm-up" />));

/**
 * Every Faith screen renders, and the injected repository is the one it reads.
 *
 * ── What "repository contract swapping" means concretely ────────────────────
 * The suite below overrides one repository at a time and asserts the screen shows the
 * override's answer. If a screen imported a concrete mock instead of resolving through
 * the DI context, these would still pass against the default fixtures — so each case
 * asserts a value the *default* mock never produces.
 */

/**
 * Storage is cleared between cases.
 *
 * The tasbih counter and the worship checklist genuinely persist — that is the feature —
 * so without this a count left by one test is the starting state of the next, and the
 * interaction assertions become order-dependent.
 */
beforeEach(async () => {
  await AsyncStorage.clear();
  // A chosen translation is a precondition of these cases, not their subject.
  await seedTranslationPreference();
  /*
    So is a resolved location. Every location-scoped date derives from one now, and without it the
    Calendar and Events screens render their location-required state rather than the repository
    answer these cases are about.
  */
  await seedPrayerLocation();
});

/**
 * Renders a screen against the **fixtures**, plus any overrides the case supplies.
 *
 * `screen` rather than the render result: this project's RNTL setup binds queries to the
 * module-level screen object, and reaching for the return value gets an object whose query methods
 * are not attached.
 *
 * The mock set is passed explicitly rather than relied on as the provider's default. Since Quran
 * Foundation access was approved that default is environment-dependent: a build with
 * `EXPO_PUBLIC_SUPABASE_URL` set gets the approved adapter, and `EXPO_PUBLIC_*` values are inlined
 * at transform time — so whether a developer happens to have a `.env` would otherwise decide which
 * repository these cases exercise. Naming the fixtures makes every one of them say what it means.
 */
async function withRepositories(element: ReactElement, repositories?: Partial<FaithRepositories>) {
  await render(
    <FaithRepositoryProvider repositories={{ ...createMockFaithRepositories(), ...repositories }}>
      {element}
    </FaithRepositoryProvider>,
  );
  return screen;
}

const SCREENS: readonly (readonly [string, ReactElement, string])[] = [
  ['Quran', <QuranScreen key="q" />, 'faith-quran'],
  ['Reader', <ReaderScreen key="r" />, 'faith-reader'],
  ['Hadith', <HadithScreen key="h" />, 'faith-hadith'],
  ['Duas', <DuasScreen key="d" />, 'faith-duas'],
  ['Prayer times', <PrayerTimesScreen key="p" />, 'faith-prayer-times'],
  ['Qibla', <QiblaScreen key="qb" />, 'faith-qibla'],
  ['Tasbih', <TasbihScreen key="t" />, 'faith-tasbih'],
  ['Mosques', <MosquesScreen key="m" />, 'faith-mosques'],
  ['Calendar', <CalendarScreen key="c" />, 'faith-calendar'],
  ['Events', <EventsScreen key="e" />, 'faith-events'],
  ['Worship', <WorshipScreen key="w" />, 'faith-worship'],
  ['Daily Ayah', <DailyAyahScreen key="da" />, 'faith-daily-ayah'],
  ['Search', <SearchScreen key="s" />, 'faith-search'],
  ['Bookmarks', <BookmarksScreen key="b" />, 'faith-bookmarks'],
  ['Preferences', <PreferencesScreen key="pr" />, 'faith-preferences'],
  ['More', <MoreScreen key="mo" />, 'faith-more'],
  ['Faith AI', <FaithAiScreen key="ai" />, 'faith-ai'],
];

describe('every Faith screen mounts', () => {
  it.each(SCREENS)('%s renders its scaffold', async (_name, element, testID) => {
    const view = await withRepositories(element);
    expect(await view.findByTestId(testID)).toBeTruthy();
  });

  it.each(SCREENS)('%s renders the shared five-slot navigation', async (_n, element, testID) => {
    const view = await withRepositories(element);
    expect(await view.findByTestId(`${testID}-nav`)).toBeTruthy();
  });

  it.each(SCREENS)('%s renders a header with Back', async (_n, element, testID) => {
    const view = await withRepositories(element);
    expect(await view.findByTestId(`${testID}-header-back`)).toBeTruthy();
  });
});

describe('repository swapping', () => {
  it('reads the injected Quran repository, not the default fixtures', async () => {
    const view = await withRepositories(<QuranScreen />, {
      quran: {
        // Provenance is a property of the repository now, so an injected one declares its own.
        source: { name: 'Injected source', verified: false },
        listSurahs: async () => ({
          kind: 'ok',
          data: [
            {
              number: 1 as never,
              name: 'Injected Surah',
              arabicName: 'اختبار',
              meaning: 'A test double',
              ayahCount: 3,
              revelation: 'meccan',
            },
          ],
        }),
        getSurah: async () => ({ kind: 'error', code: 'not-found' }),
        listAyahs: async () => ({ kind: 'empty' }),
        listTranslations: async () => ({ kind: 'empty' }),
        getAyahOfTheDay: async () => ({ kind: 'error', code: 'not-found' }),
        searchTranslations: async () => ({ kind: 'no-results', query: '' }),
        availableTranslations: async () => ({ kind: 'ok', data: [] }),
        availableReciters: async () => ({ kind: 'ok', data: [] }),
        listRecitations: async () => ({ kind: 'empty' }),
      },
    });

    expect(await view.findByText(/Injected Surah/)).toBeTruthy();
  });

  /**
   * ── Why this drives the Qur'an screen and not Hadith ────────────────────────
   * It used to inject an offline `hadith` repository and assert
   * `faith-hadith-collections-offline`. Hadith is a locked state now and reads no repository at all,
   * so that assertion was testing the framework's offline rendering through a screen that can no
   * longer reach it.
   *
   * Daily Ayah is the replacement rather than the Qur'an screen, which was tried first and does not
   * work here: its surah list renders from the persisted startup snapshot, so an offline repository
   * produces a warm catalogue rather than an offline state — correct behaviour, and the opposite of
   * what this test needs to observe. Daily Ayah asks for one ayah with no snapshot behind it. What
   * is under test is `FaithResourceView`'s offline branch, not which screen hosts it.
   */
  it('renders the offline state when a repository reports offline', async () => {
    const view = await withRepositories(<DailyAyahScreen />, {
      quran: {
        source: { name: 'Injected source', verified: false },
        listSurahs: async () => ({ kind: 'offline' }),
        getSurah: async () => ({ kind: 'offline' }),
        listAyahs: async () => ({ kind: 'offline' }),
        listTranslations: async () => ({ kind: 'offline' }),
        getAyahOfTheDay: async () => ({ kind: 'offline' }),
        searchTranslations: async () => ({ kind: 'offline' }),
        availableTranslations: async () => ({ kind: 'offline' }),
        availableReciters: async () => ({ kind: 'offline' }),
        listRecitations: async () => ({ kind: 'offline' }),
      },
    });

    expect(await view.findByTestId('faith-daily-ayah-body-offline')).toBeTruthy();
  });

  /**
   * The locked screens read no repository, and say why rather than showing a skeleton.
   *
   * Mosques still uses the generic `FaithProviderLockedState`; Hadith and Duas now render the
   * approved locked *library* composition instead — a status card, three disabled preview rows and
   * a trust notice — so they are asserted against that structure rather than the generic testID.
   * Their copy and disabled semantics are covered in `faith-locked-libraries.test.tsx`.
   */
  it('Mosques renders the generic locked state with no provider configured', async () => {
    const view = await withRepositories(<MosquesScreen />);
    expect(await view.findByTestId('faith-mosques-locked')).toBeTruthy();
  });

  it.each([
    ['Hadith', <HadithScreen key="hadith" />, 'faith-hadith'],
    ['Duas', <DuasScreen key="duas" />, 'faith-duas'],
  ])('%s renders the approved locked library with no provider configured', async (_n, el, id) => {
    const view = await withRepositories(el);
    expect(await view.findByTestId(`${id}-status`)).toBeTruthy();
    expect(await view.findByTestId(`${id}-preview`)).toBeTruthy();
    expect(await view.findByTestId(`${id}-trust`)).toBeTruthy();
  });

  it('renders the error state with a retry when a repository fails', async () => {
    const view = await withRepositories(<CalendarScreen />, {
      calendar: {
        getLocationToday: async () => ({ kind: 'error', code: 'unavailable' }),
        getMonth: async () => ({ kind: 'error', code: 'unavailable' }),
        getNextObservance: async () => ({ kind: 'error', code: 'unavailable' }),
        listUpcomingObservances: async () => ({ kind: 'error', code: 'unavailable' }),
        convertGregorian: async () => ({ kind: 'error', code: 'unavailable' }),
      },
    });

    /**
     * The upcoming-observances resource, not the month.
     *
     * This asserted `faith-calendar-today-error`, whose card was removed when the grid gained a
     * selected-day card that already defaults to today — the screen was stating the same date twice
     * in one viewport. The month resource cannot stand in for it here: its request is keyed on
     * today's Hijri month, so a `getToday` that errors leaves the month with nothing to ask for and
     * it never reaches an error of its own. The observances list asks unconditionally, so it is the
     * resource that actually surfaces a failing calendar repository.
     */
    expect(await view.findByTestId('faith-calendar-upcoming-error')).toBeTruthy();
  });

  it('renders the permission state when location is refused', async () => {
    const permissionRequired: FaithResult<never> = {
      kind: 'permission-required',
      permission: 'location',
      rationale: 'Qibla needs to know where you are.',
    };

    const view = await withRepositories(<QiblaScreen />, {
      prayerTimes: {
        resolveCurrentLocation: async () => permissionRequired,
        refreshDeviceLocation: async () => permissionRequired,
        previewLocation: () => null,
        saveCoordinateLocation: async () => permissionRequired,
        switchToDeviceLocation: async () => permissionRequired,
        getActiveLocationMode: async () => null,
        // No location, so no location day. The screen never gets far enough to ask.
        locationCalendarDay: () => null,
        searchCities: async () => ({ kind: 'no-results', query: '' }),
        previewCity: async () => ({ kind: 'error', code: 'unavailable' }),
        saveCityLocation: async () => ({ kind: 'error', code: 'unavailable' }),
        getDailyTimes: async () => permissionRequired,
        getMonthlyTimes: async () => permissionRequired,
        getNextPrayer: async () => permissionRequired,
        readNotificationPreferences: async () => ({ kind: 'ok', data: [] }),
        writeNotificationPreferences: async () => ({ kind: 'ok', data: [] }),
      },
    });

    expect(await view.findByTestId('faith-qibla-body-permission')).toBeTruthy();
  });

  it('renders the empty state when a repository has nothing', async () => {
    const view = await withRepositories(<EventsScreen />, {
      calendar: {
        getLocationToday: async () => ({ kind: 'empty' }),
        getMonth: async () => ({ kind: 'empty' }),
        getNextObservance: async () => ({ kind: 'empty' }),
        listUpcomingObservances: async () => ({ kind: 'empty' }),
        convertGregorian: async () => ({ kind: 'empty' }),
      },
    });

    expect(await view.findByTestId('faith-events-body-empty')).toBeTruthy();
  });
});
