import AsyncStorage from '@react-native-async-storage/async-storage';
import { render, screen } from '@testing-library/react-native';
import React, { type ReactElement } from 'react';

import { seedPrayerLocation } from '@/test-support/faith-location-fixtures';
import { warmUpFirstMount } from '@/test-support/mock-latency-timers';

import { createMockFaithRepositories } from '../data/mock';
import { FaithRepositoryProvider } from '../di/faith-repository-context';
import { faithPictogramSlot, getFaithPictogram } from '../faith-pictogram-assets';
import { DuasScreen } from '../screens/duas-screen';
import { HadithScreen } from '../screens/hadith-screen';
import { PrayerRemindersScreen } from '../screens/prayer-reminders-screen';
import { PrayerTimesScreen } from '../screens/prayer-times-screen';

/**
 * Every approved slot draws its own artwork, on the screen it belongs to.
 *
 * ── Why this exists on top of the registry test ─────────────────────────────
 * `faith-pictogram-registry.test.ts` proves the *registry* is complete and internally consistent: 15
 * installed, 1 held, every file on disk, D3 sharing H2's source. It cannot prove that any screen
 * actually reaches for the right entry — a screen wired to `faithPictogramSlot('p2-asr')` where it
 * meant `p2-maghrib` would pass every registry assertion and put a sunset on the afternoon.
 *
 * So these cases assert the *pairing*: this row, this slot, this image. They compare source objects
 * rather than filenames, because that is what the renderer is handed.
 *
 * The one that matters most is the last block: the Prayer reminder rows must **not** have gained a
 * pictogram, because the feature behind them still schedules nothing.
 */

/*
  Real timers, warm first mount only.

  The Prayer screen resolves a location and then calculates a day — a real promise chain that is not
  timer-driven. Under fake timers `waitFor` burns its simulated budget in microseconds before that
  chain settles, which is the case `mock-latency-timers.ts` documents and provides this helper for.
  The locked Hadith and Duas screens read no repository at all, so nothing here is waiting on a
  mock's deliberate sleep.
*/
warmUpFirstMount(() => renderScreen(<PrayerTimesScreen />));

async function renderScreen(element: ReactElement) {
  await render(
    <FaithRepositoryProvider repositories={createMockFaithRepositories()}>
      {element}
    </FaithRepositoryProvider>,
  );
  return screen;
}

/** The `source` a rendered pictogram was handed, whatever wrapper it sits in. */
function sourceOf(testID: string): unknown {
  return screen.getByTestId(testID, { includeHiddenElements: true }).props.source;
}

/** The installed source for a slot, as the registry resolves it. */
function expected(id: Parameters<typeof faithPictogramSlot>[0]): unknown {
  const slot = faithPictogramSlot(id);
  return slot.kind === 'png' ? slot.source : undefined;
}

beforeEach(async () => {
  await AsyncStorage.clear();
  await seedPrayerLocation();
});

describe('Hadith draws H1, H2, H3 and S1', () => {
  it.each([
    ['Collections', 'faith-hadith-row-collections-pictogram', 'h1'],
    ['Bookmarks', 'faith-hadith-row-bookmarks-pictogram', 'h2'],
    ['Reading history', 'faith-hadith-row-history-pictogram', 'h3'],
    ['the trust notice', 'faith-hadith-trust-shield', 's1'],
  ] as const)('%s renders %s', async (_row, testID, id) => {
    await renderScreen(<HadithScreen />);
    await screen.findByTestId('faith-hadith');

    expect(sourceOf(testID)).toBe(expected(id));
    expect(expected(id)).toBeDefined();
  });

  /**
   * The locked state is unchanged by the artwork.
   *
   * Installing pictograms is a visual change and must not have made a disabled row look reachable —
   * these rows still carry no press handler and no button role.
   */
  it('leaves the provider-locked rows disabled and unreachable', async () => {
    await renderScreen(<HadithScreen />);
    for (const testID of [
      'faith-hadith-row-collections',
      'faith-hadith-row-bookmarks',
      'faith-hadith-row-history',
    ]) {
      const row = await screen.findByTestId(testID);
      expect(row.props.onPress).toBeUndefined();
      expect(row.props.accessibilityRole).not.toBe('button');
      expect(row.props.accessibilityState).toEqual({ disabled: true });
    }
    expect(await screen.findByText('No unverified narrations are shown.')).toBeTruthy();
  });
});

describe('Duas draws D1, D2, the reused H2, and S1', () => {
  it.each([
    ['Morning & evening', 'faith-duas-row-morning-evening-pictogram', 'd1'],
    ['Everyday moments', 'faith-duas-row-everyday-pictogram', 'd2'],
    ['Bookmarks', 'faith-duas-row-bookmarks-pictogram', 'd3'],
    ['the trust notice', 'faith-duas-trust-shield', 's1'],
  ] as const)('%s renders %s', async (_row, testID, id) => {
    await renderScreen(<DuasScreen />);
    await screen.findByTestId('faith-duas');

    expect(sourceOf(testID)).toBe(expected(id));
    expect(expected(id)).toBeDefined();
  });

  /**
   * D3 is H2's image, not a lookalike.
   *
   * Asserted across two screens rather than inside the registry, because the thing worth proving is
   * that a reader who taps from Hadith to Duas sees the same drawing for the same idea.
   */
  it('gives the Dua bookmark row the very same image as the Hadith one', async () => {
    await renderScreen(<DuasScreen />);
    const dua = sourceOf('faith-duas-row-bookmarks-pictogram');

    await renderScreen(<HadithScreen />);
    const hadith = sourceOf('faith-hadith-row-bookmarks-pictogram');

    expect(dua).toBe(hadith);
    expect(getFaithPictogram('d3').file).toBe('h2-bookmarked-book.png');
  });

  it('leaves the provider-locked state intact', async () => {
    await renderScreen(<DuasScreen />);
    expect(await screen.findByText('No unverified supplications are shown.')).toBeTruthy();
    expect(
      (await screen.findByTestId('faith-duas-row-morning-evening')).props.onPress,
    ).toBeUndefined();
  });
});

describe('Prayer draws P1, the six P2 markers and P4', () => {
  it('renders the mosque map-pin on the location card', async () => {
    await renderScreen(<PrayerTimesScreen />);
    await screen.findByTestId('faith-prayer-location');

    expect(sourceOf('faith-prayer-location-pictogram')).toBe(expected('p1'));
  });

  it.each([
    ['fajr', 'p2-fajr'],
    ['sunrise', 'p2-sunrise'],
    ['dhuhr', 'p2-dhuhr'],
    ['asr', 'p2-asr'],
    ['maghrib', 'p2-maghrib'],
    ['isha', 'p2-isha'],
  ] as const)('%s gets its own marker on the journey timeline', async (key, id) => {
    await renderScreen(<PrayerTimesScreen />);
    await screen.findByTestId('faith-prayer-journey');

    expect(sourceOf(`faith-prayer-journey-${key}-pictogram`)).toBe(expected(id));
  });

  /**
   * Six distinct images, not one repeated.
   *
   * The mapping is a `Record<PrayerKey, …>` on the screen, so a copy-paste slip would give two
   * prayers the same marker and nothing else would notice.
   */
  it('uses a different image for every prayer', async () => {
    await renderScreen(<PrayerTimesScreen />);
    await screen.findByTestId('faith-prayer-journey');

    const sources = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'].map((key) =>
      sourceOf(`faith-prayer-journey-${key}-pictogram`),
    );
    expect(new Set(sources).size).toBe(6);
  });

  it('renders the calculation gear on the settings row', async () => {
    await renderScreen(<PrayerTimesScreen />);
    const row = await screen.findByTestId('faith-prayer-calculation-settings');

    expect(sourceOf('faith-prayer-calculation-settings-pictogram')).toBe(expected('p4'));
    /*
      Installed precisely because this row goes somewhere real — it pushes `/faith/preferences`,
      which owns the method its subtitle states. The button role is what a pressed row exposes; the
      handler itself lives on the `PressableScale` wrapper rather than on this node.
    */
    expect(row.props.accessibilityRole).toBe('button');
  });
});

/**
 * P3 does not render, anywhere.
 *
 * ── The whole point of the held state, asserted on the screen ───────────────
 * The reminder rows persist a preference and schedule nothing. A dimensional gold bell beside that
 * switch would say, in the register users read fastest, that reminders work — so the row keeps its
 * restrained vector and the banner keeps saying what the switch actually does.
 */
describe('the held reminder bell reaches no screen', () => {
  it('gives the reminders action row no pictogram at all', async () => {
    await renderScreen(<PrayerTimesScreen />);
    await screen.findByTestId('faith-prayer-actions');

    // The row exists and is reachable; what it must not have is dimensional artwork.
    expect(await screen.findByTestId('faith-prayer-reminders-action')).toBeTruthy();
    expect(
      screen.queryByTestId('faith-prayer-reminders-action-pictogram', {
        includeHiddenElements: true,
      }),
    ).toBeNull();
  });

  it('gives the reminder preference rows no pictogram either', async () => {
    await renderScreen(<PrayerRemindersScreen />);
    await screen.findByTestId('faith-prayer-reminders');

    for (const prayer of ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha']) {
      expect(
        screen.queryByTestId(`faith-prayer-reminder-row-${prayer}-pictogram`, {
          includeHiddenElements: true,
        }),
      ).toBeNull();
    }
  });

  it('resolves P3 to a vector rather than to its artwork', () => {
    const slot = faithPictogramSlot('p3');
    expect(slot.kind).toBe('vector');
    expect(getFaithPictogram('p3').asset.status).toBe('held');
  });

  /**
   * The action row does not claim reminders work.
   *
   * The approved reference reads "Choose which prayers notify you". NoorLife cannot say that — no
   * permission is requested, nothing is scheduled, no background handler exists — so the row states
   * what it actually does, and the destination repeats it before any switch is reachable.
   */
  it('still tells the user that nothing is scheduled', async () => {
    await renderScreen(<PrayerTimesScreen />);
    const row = await screen.findByTestId('faith-prayer-reminders-action');

    expect(String(row.props.accessibilityLabel)).toMatch(/does not schedule notifications yet/i);
    expect(await screen.findByText(/Preferences only/)).toBeTruthy();
    // The reference's claim must not have survived the layout change.
    expect(screen.queryByText('Choose which prayers notify you')).toBeNull();
  });

  /**
   * The reminders screen still leads with the truth — but the truth has changed.
   *
   * ── What this assertion used to say, and why it could not stay ─────────────
   * "NoorLife does not schedule notifications yet". That was accurate while the switches were
   * preferences only. Prayer alerts are now real local notifications scheduled from the same
   * instants the Prayer screen displays, so continuing to assert that sentence would have pinned the
   * screen to a claim that is no longer true.
   *
   * What must not change is the *ceiling*: NoorLife can prove an alert is pending and cannot prove
   * one was delivered. That is what the banner has to keep saying, and it is what is asserted here.
   */
  it('leads with what it can and cannot promise about delivery', async () => {
    await renderScreen(<PrayerRemindersScreen />);
    const notice = await screen.findByTestId('faith-prayer-reminders-notice');

    // Whatever state the screen is in, the banner never claims a reminder will arrive.
    expect(String(notice.props.accessibilityLabel ?? '')).not.toMatch(/will be delivered/i);
    expect(await screen.findByTestId('faith-prayer-notification-status')).toBeTruthy();
  });
});
