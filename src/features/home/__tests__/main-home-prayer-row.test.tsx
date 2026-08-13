import AsyncStorage from '@react-native-async-storage/async-storage';
import { render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

import { AppProviders } from '@application/providers/app-providers';
import { formattedHijriForCalendarDay } from '@features/faith/data/calendar-day';
import type { LocationPort } from '@features/faith/data/location/location.port';
import { createAdhanPrayerTimesRepository } from '@features/faith/data/prayer/adhan-prayer-times.repository';
import { formatPrayerClock } from '@features/faith/data/prayer/prayer-clock';
import type { PrayerLocation } from '@features/faith/data/prayer-times.repository';
import { readFaithPreferences } from '@features/faith/storage/faith-preferences';
import { installMockLatencyTimers } from '@/test-support/mock-latency-timers';

import { MainHomeScreen } from '../screens/main-home-screen';

/**
 * Main Home and Faith state the same next prayer, because they share one calculation.
 *
 * ── The defect this locks out ───────────────────────────────────────────────
 * Main Home rendered `12:35 PM · Dhuhr Prayer` from `src/mocks/main-home.ts` — the value the deleted
 * prayer-times fixture returned — while the Faith module, one tap away, calculated 1:14 PM for the same
 * coordinate on the same day. One app, two claims about the same prayer, both reachable within seconds
 * of each other. The fixture outlived the repository it came from because Main Home's timeline is a
 * design-locked composition and nobody re-read its data.
 *
 * ── Why agreement is asserted rather than a time ────────────────────────────
 * Pinning a literal is what created the defect. These cases assert the *relationship*: for a given
 * location, date, method and madhab, the string Main Home shows is the string the shared repository
 * produces. That stays true when the calculation is corrected and when the user changes convention, and
 * it holds in whatever zone the machine running the suite is set to — but it fails the moment a second
 * formatter or a second calculation appears.
 *
 * ── Why the real screen, inside the real providers ──────────────────────────
 * Mounting the row alone was tried and needs `MainHomeMetricsProvider`, the entitlement context and the
 * upgrade-sheet host — at which point the harness is a reimplementation of the screen and can diverge
 * from it. This renders `/home` as the device builds it, so what is asserted is what a user sees.
 */

installMockLatencyTimers(() => renderMainHome());

/** Mountain View. Chosen because it is not this machine's zone, so a device-zone slip would show. */
const MOUNTAIN_VIEW = { latitude: 37.3861, longitude: -122.0839 };

async function renderMainHome() {
  return render(
    <AppProviders>
      <MainHomeScreen simulateFailure={false} />
    </AppProviders>,
  );
}

/** A port that resolves nothing, so only a *stored* location can reach the calculation. */
function deniedPort(): LocationPort {
  return {
    getPermission: async () => 'denied',
    requestPermission: async () => 'denied',
    // Nothing cached: these suites exercise the authoritative path only.
    getLastKnownPosition: async () => null,
    getCurrentPosition: async () => ({ failure: 'permission-denied' }),
    describe: async () => null,
    search: async () => [],
    hasCompass: async () => false,
    watchHeading: async () => () => undefined,
  };
}

async function seedStoredLocation() {
  await AsyncStorage.setItem(
    'noorlife.faith.location',
    JSON.stringify({
      coordinate: MOUNTAIN_VIEW,
      label: 'Mountain View, United States',
      manual: true,
      resolvedAt: '2026-08-12T00:00:00.000Z',
    }),
  );
}

/**
 * The next prayer as the shared repository computes it, with the user's own stored preferences.
 *
 * These are the same inputs `useFaithHome` passes, which is the point: if Main Home ever grew its own
 * settings plumbing or its own formatter, the expectation and the screen would part company.
 */
async function expectedNextPrayer(): Promise<{ readonly label: string; readonly at: string }> {
  const repository = createAdhanPrayerTimesRepository({
    location: deniedPort(),
    hijriFor: formattedHijriForCalendarDay,
  });
  const location = await repository.resolveCurrentLocation();
  expect(location.kind).toBe('ok');
  const preferences = await readFaithPreferences();
  const next = await repository.getNextPrayer((location as { data: PrayerLocation }).data, {
    method: preferences.calculationMethod,
    asr: preferences.asrMethod,
    offsetsMinutes: {},
  });
  expect(next.kind).toBe('ok');
  return (next as { data: { prayer: { label: string; at: string } } }).data.prayer;
}

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('the Main Home prayer row', () => {
  it('shows the same next prayer the shared repository calculates', async () => {
    await seedStoredLocation();
    const expected = await expectedNextPrayer();

    await renderMainHome();
    await screen.findByTestId('main-home-hero');

    await waitFor(() => {
      expect(screen.getByText(`${expected.label} Prayer`)).toBeTruthy();
    });
    expect(screen.getByText(formatPrayerClock(expected.at))).toBeTruthy();
  });

  it('shows a location-local time, not a device-local one', async () => {
    await seedStoredLocation();
    const expected = await expectedNextPrayer();

    /*
      Mountain View is UTC-7 or -8; this suite runs elsewhere. A row that had gone through
      `new Date(iso).getHours()` would print the device's hour, which this comparison rejects.
    */
    expect(expected.at).toMatch(/-0[78]:00$/);

    await renderMainHome();
    await screen.findByTestId('main-home-hero');
    await waitFor(() => {
      expect(screen.getByText(formatPrayerClock(expected.at))).toBeTruthy();
    });
  });

  it('never renders the fabricated fixture value', async () => {
    await seedStoredLocation();
    await renderMainHome();
    await screen.findByTestId('main-home-hero');

    await waitFor(() => {
      expect(screen.getByTestId('timeline-row-next-prayer')).toBeTruthy();
    });
    /*
      The fabricated *time* is the guarantee. The prayer *name* is not: "Dhuhr Prayer" is the correct
      row for the part of the day when Dhuhr is genuinely next, so asserting its absence made this case
      pass or fail depending on the clock — it passed when written at 00:30 PDT (Fajr next) and failed
      later the same day at 04:50 PDT (Dhuhr next). A test that depends on the hour is worse than no
      test, so it asserts the literal that could only come from the deleted fixture.
    */
    expect(screen.queryByText('12:35 PM')).toBeNull();
  });
});

describe('when there is no location', () => {
  it('asks for one instead of stating a time', async () => {
    // Storage is cleared, so nothing can resolve and nothing may be invented.
    await renderMainHome();
    await screen.findByTestId('main-home-hero');

    await waitFor(() => {
      expect(screen.getByText('Set your location to see prayer times')).toBeTruthy();
    });
  });

  it('keeps the row present, so the locked section does not change height', async () => {
    await renderMainHome();
    await screen.findByTestId('main-home-hero');
    await waitFor(() => {
      expect(screen.getByTestId('timeline-row-next-prayer')).toBeTruthy();
    });
  });

  it('spells the instruction without a leading empty time for a screen reader', async () => {
    await renderMainHome();
    await screen.findByTestId('main-home-hero');
    await waitFor(() => {
      // The label is the title alone: an empty time is filtered rather than read as a pause or a dash.
      expect(screen.getByLabelText('Set your location to see prayer times')).toBeTruthy();
    });
  });
});
