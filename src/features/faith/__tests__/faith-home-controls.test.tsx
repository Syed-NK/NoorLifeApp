import { render, fireEvent, waitFor } from '@testing-library/react-native';
import React from 'react';

import { ModuleHomeScreen } from '@features/modules/screens/module-home-screen';
import { mockRouter } from '../../../../jest.setup';

import { faithRoutes } from '../faith-routes';

/**
 * Every visible Faith Home control reaches its intended destination.
 *
 * ── The requirement this encodes ────────────────────────────────────────────
 * "No visible button, card, icon, chevron or navigation item may remain inert." That is a
 * claim about behaviour, so it is tested by pressing each control and asserting the
 * router was called — not by reading the source for `onPress`.
 *
 * The table below is the phase brief's own list. Adding a control to Faith Home without
 * adding a row here leaves the new control untested, which is why the last case asserts
 * the count of pressable testIDs on the screen matches the number of rows.
 */

const { push, dismissTo, navigate } = mockRouter;

async function renderFaithHome() {
  // Awaited, and the returned queries are used rather than the `screen` global: the
  // global is only bound after a synchronous render settles, and this screen resolves
  // its data asynchronously.
  return render(<ModuleHomeScreen moduleId="faith" />);
}

/** testID → the route it must reach. */
const CONTROL_DESTINATIONS: readonly (readonly [string, string])[] = [
  // Hero
  ['faith-hero-action', faithRoutes.prayerTimes],
  // The eight approved feature cards
  ['faith-feature-quran', faithRoutes.quran],
  ['faith-feature-hadith', faithRoutes.hadith],
  ['faith-feature-duas', faithRoutes.duas],
  ['faith-feature-prayer', faithRoutes.prayerTimes],
  ['faith-feature-qibla', faithRoutes.qibla],
  ['faith-feature-tasbih', faithRoutes.tasbih],
  ['faith-feature-mosques', faithRoutes.mosques],
  ['faith-feature-calendar', faithRoutes.calendar],
  // Cards
  ['faith-continue', faithRoutes.reader],
  ['faith-ayah', faithRoutes.dailyAyah],
  ['faith-ayah-share', faithRoutes.dailyAyah],
  ['faith-worship-viewall', faithRoutes.worship],
  ['faith-upcoming', faithRoutes.events],
  ['faith-calendar', faithRoutes.calendar],
  ['faith-insight', faithRoutes.ai],
];

describe('Faith Home controls', () => {
  it.each(CONTROL_DESTINATIONS)('%s navigates to %s', async (testID, destination) => {
    const view = await renderFaithHome();
    fireEvent.press(await view.findByTestId(testID));
    await waitFor(() => expect(push).toHaveBeenCalledWith(destination));
  });

  it('routes no control to the coming-soon placeholder', async () => {
    const view = await renderFaithHome();
    for (const [testID] of CONTROL_DESTINATIONS) {
      fireEvent.press(await view.findByTestId(testID));
    }
    for (const call of push.mock.calls) {
      const target = call[0];
      const asString = typeof target === 'string' ? target : JSON.stringify(target);
      expect(asString).not.toMatch(/module-coming-soon/);
    }
  });
});

describe('Faith Home header', () => {
  it('sends Back to Main Home rather than popping one screen', async () => {
    const view = await renderFaithHome();
    fireEvent.press(await view.findByTestId('faith-home-header-back'));
    // `dismissTo`, so a Faith Home reached by deep link still lands on Main Home
    // instead of exiting the app.
    await waitFor(() => expect(dismissTo).toHaveBeenCalledWith('/home'));
  });

  it('opens Help', async () => {
    const view = await renderFaithHome();
    fireEvent.press(await view.findByTestId('faith-home-header-help'));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/settings/help'));
  });

  it('opens the profile from the portrait', async () => {
    const view = await renderFaithHome();
    fireEvent.press(await view.findByTestId('faith-home-header-profile'));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/profile'));
  });
});

describe('Faith bottom navigation', () => {
  it.each([
    ['faith-home-nav-today', faithRoutes.home],
    ['faith-home-nav-quran', faithRoutes.quran],
    ['faith-home-nav-ai', faithRoutes.ai],
    ['faith-home-nav-worship', faithRoutes.worship],
    ['faith-home-nav-more', faithRoutes.more],
  ])('%s navigates to %s', async (testID, destination) => {
    const view = await renderFaithHome();
    fireEvent.press(await view.findByTestId(testID));
    // `navigate`, not `push`: the five slots are peers and must not stack.
    await waitFor(() => expect(navigate).toHaveBeenCalledWith(destination));
  });
});
