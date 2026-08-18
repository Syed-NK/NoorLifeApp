import { render, fireEvent, screen, waitFor } from '@testing-library/react-native';
import React, { type ReactElement } from 'react';

import {
  MAIN_HOME,
  moduleChildParent,
  moduleHomeParent,
  moduleHomeRoutes,
  resolveBackDestination,
} from '@application/navigation/module-navigation';
import { globalRoutes } from '@application/navigation/routes';
import { FRAMEWORK_MODULE_IDS } from '@features/modules/module-tokens';
import { ModuleHomeScreen } from '@features/modules/screens/module-home-screen';
import { installMockLatencyTimers } from '@/test-support/mock-latency-timers';

import { mockRouter } from '../../../../jest.setup';

import { FaithRepositoryProvider } from '../di/faith-repository-context';
import { faithRoutes } from '../faith-routes';
import { BookmarksScreen } from '../screens/bookmarks-screen';
import { CalendarScreen, EventsScreen } from '../screens/calendar-screens';
import { DailyAyahScreen } from '../screens/daily-ayah-screen';
import { DuasScreen } from '../screens/duas-screen';
import { FaithAiScreen } from '../screens/faith-ai-screen';
import { HadithScreen } from '../screens/hadith-screen';
import { MoreScreen } from '../screens/more-screen';
import { MosquesScreen } from '../screens/mosques-screen';
import { QiblaScreen } from '../screens/qibla-screen';
import { PrayerTimesScreen } from '../screens/prayer-times-screen';
import { PreferencesScreen } from '../screens/preferences-screen';
import { QuranScreen } from '../screens/quran-screen';
import { ReaderScreen } from '../screens/reader-screen';
import { SearchScreen } from '../screens/search-screen';
import { TasbihScreen } from '../screens/tasbih-screen';
import { WorshipScreen } from '../screens/worship-screen';

// Two costs this removes: the simulated latency the mock data sources sleep through on every
// mount, and the one-off compile cost of the first mount, warmed up in `beforeAll` so that no
// individual test is charged for it.
installMockLatencyTimers(() => renderIn(<ModuleHomeScreen moduleId="faith" />));

/**
 * The navigation hierarchy, asserted at every level.
 *
 * Main Home → Faith Home → Faith child. A child's visible back arrow goes to Faith Home,
 * never to Main Home; Faith Home's goes to Main Home. These are pressed for real and the
 * router call is asserted, because the requirement is about behaviour rather than about
 * which helper a screen happens to import.
 */

const { dismissTo, push } = mockRouter;

async function renderIn(element: ReactElement) {
  await render(<FaithRepositoryProvider>{element}</FaithRepositoryProvider>);
  return screen;
}

describe('the parent map', () => {
  it('sends a module home up to Main Home', () => {
    expect(moduleHomeParent()).toBe(globalRoutes.home);
    expect(MAIN_HOME).toBe(globalRoutes.home);
  });

  it('sends a child up to its own module home, for every module', () => {
    for (const moduleId of FRAMEWORK_MODULE_IDS) {
      const parent = moduleChildParent(moduleId);
      expect(parent).toBe(moduleHomeRoutes[moduleId]);
      // The defect this replaces: a child returning straight to Main Home.
      expect(parent).not.toBe(globalRoutes.home);
    }
  });

  it('covers every framework module, so a new one cannot be forgotten', () => {
    for (const moduleId of FRAMEWORK_MODULE_IDS) {
      expect(moduleHomeRoutes[moduleId]).toBeDefined();
    }
  });

  it('resolves home and child differently for the same module', () => {
    expect(resolveBackDestination('faith', true)).toBe(globalRoutes.home);
    expect(resolveBackDestination('faith', false)).toBe(faithRoutes.home);
  });
});

describe('Faith Home', () => {
  it('back arrow returns to Main Home', async () => {
    const view = await renderIn(<ModuleHomeScreen moduleId="faith" />);
    fireEvent.press(await view.findByTestId('faith-home-header-back'));
    await waitFor(() => expect(dismissTo).toHaveBeenCalledWith(globalRoutes.home));
  });
});

/** Every Faith child screen, with the testID prefix its scaffold renders. */
const CHILDREN: readonly (readonly [string, ReactElement, string])[] = [
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

describe('every Faith child returns to Faith Home', () => {
  it.each(CHILDREN)('%s back arrow goes to /faith', async (_name, element, testID) => {
    const view = await renderIn(element);
    fireEvent.press(await view.findByTestId(`${testID}-header-back`));
    await waitFor(() => expect(dismissTo).toHaveBeenCalledWith(faithRoutes.home));
  });

  it.each(CHILDREN)('%s back arrow never goes to Main Home', async (_n, element, testID) => {
    const view = await renderIn(element);
    fireEvent.press(await view.findByTestId(`${testID}-header-back`));
    await waitFor(() => expect(dismissTo).toHaveBeenCalled());
    expect(dismissTo).not.toHaveBeenCalledWith(globalRoutes.home);
    expect(push).not.toHaveBeenCalledWith(globalRoutes.home);
  });
});

describe('a deep-linked child still returns to Faith Home', () => {
  it('uses dismissTo, which replaces when the parent is absent from the stack', async () => {
    // A cold deep link has no history below it. `back()` would exit the app and
    // `replace()` would duplicate the parent when it *is* present; `dismissTo` handles
    // both, so asserting it is called with the parent is the whole guarantee.
    const view = await renderIn(<TasbihScreen />);
    fireEvent.press(await view.findByTestId('faith-tasbih-header-back'));

    await waitFor(() => expect(dismissTo).toHaveBeenCalledWith(faithRoutes.home));
    // Never a raw history pop, which is what breaks on a cold link.
    expect(mockRouter.back).not.toHaveBeenCalled();
  });
});

describe('Faith bottom navigation', () => {
  it.each([
    ['today', faithRoutes.home],
    ['quran', faithRoutes.quran],
    ['ai', faithRoutes.ai],
    ['worship', faithRoutes.worship],
    ['more', faithRoutes.more],
  ])('%s slot navigates to %s', async (slot, destination) => {
    const view = await renderIn(<ModuleHomeScreen moduleId="faith" />);
    fireEvent.press(await view.findByTestId(`faith-home-nav-${slot}`));
    // `navigate`, not `push` — peers must not stack.
    await waitFor(() => expect(mockRouter.navigate).toHaveBeenCalledWith(destination));
  });

  it('does not push, so tapping between tabs cannot grow the stack', async () => {
    const view = await renderIn(<ModuleHomeScreen moduleId="faith" />);
    fireEvent.press(await view.findByTestId('faith-home-nav-quran'));
    await waitFor(() => expect(mockRouter.navigate).toHaveBeenCalled());
    expect(push).not.toHaveBeenCalledWith(faithRoutes.quran);
  });
});

describe('header control order', () => {
  it.each(CHILDREN)('%s renders Back, then title, then Help and Profile', async (_n, el, id) => {
    const view = await renderIn(el);
    expect(await view.findByTestId(`${id}-header-back`)).toBeTruthy();
    expect(await view.findByTestId(`${id}-header-title`)).toBeTruthy();
    expect(await view.findByTestId(`${id}-header-help`)).toBeTruthy();
    expect(await view.findByTestId(`${id}-header-profile`)).toBeTruthy();
  });
});
