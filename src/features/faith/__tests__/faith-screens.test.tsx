import AsyncStorage from '@react-native-async-storage/async-storage';
import { render, screen } from '@testing-library/react-native';
import { installMockLatencyTimers } from '@/test-support/mock-latency-timers';

import React, { type ReactElement } from 'react';

import type { FaithRepositories } from '../data';
import type { FaithResult } from '../data/faith-result';
import { FaithRepositoryProvider } from '../di/faith-repository-context';
import { BookmarksScreen } from '../screens/bookmarks-screen';
import { DuasScreen } from '../screens/duas-screen';
import { HadithScreen } from '../screens/hadith-screen';
import { MoreScreen } from '../screens/more-screen';
import { MosquesScreen, QiblaScreen } from '../screens/location-screens';
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
});

/**
 * Renders inside the DI provider and returns the shared `screen` queries.
 *
 * `screen` rather than the render result: this project's RNTL setup binds queries to the
 * module-level screen object, and reaching for the return value gets an object whose
 * query methods are not attached.
 */
async function withRepositories(element: ReactElement, repositories?: Partial<FaithRepositories>) {
  await render(
    <FaithRepositoryProvider repositories={repositories}>{element}</FaithRepositoryProvider>,
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
      },
    });

    expect(await view.findByText(/Injected Surah/)).toBeTruthy();
  });

  it('renders the offline state when a repository reports offline', async () => {
    const view = await withRepositories(<HadithScreen />, {
      hadith: {
        listCollections: async () => ({ kind: 'offline' }),
        listByCollection: async () => ({ kind: 'offline' }),
        getHadith: async () => ({ kind: 'offline' }),
        search: async () => ({ kind: 'offline' }),
        getDailyHadith: async () => ({ kind: 'offline' }),
      },
    });

    expect(await view.findByTestId('faith-hadith-collections-offline')).toBeTruthy();
  });

  it('renders the error state with a retry when a repository fails', async () => {
    const view = await withRepositories(<CalendarScreen />, {
      calendar: {
        getToday: async () => ({ kind: 'error', code: 'unavailable' }),
        getMonth: async () => ({ kind: 'error', code: 'unavailable' }),
        getNextObservance: async () => ({ kind: 'error', code: 'unavailable' }),
        listUpcomingObservances: async () => ({ kind: 'error', code: 'unavailable' }),
        convertGregorian: async () => ({ kind: 'error', code: 'unavailable' }),
      },
    });

    expect(await view.findByTestId('faith-calendar-today-error')).toBeTruthy();
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
        searchLocations: async () => ({ kind: 'no-results', query: '' }),
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
        getToday: async () => ({ kind: 'empty' }),
        getMonth: async () => ({ kind: 'empty' }),
        getNextObservance: async () => ({ kind: 'empty' }),
        listUpcomingObservances: async () => ({ kind: 'empty' }),
        convertGregorian: async () => ({ kind: 'empty' }),
      },
    });

    expect(await view.findByTestId('faith-events-body-empty')).toBeTruthy();
  });
});
