import AsyncStorage from '@react-native-async-storage/async-storage';
import { render, fireEvent, screen } from '@testing-library/react-native';
import React from 'react';

import { seedPrayerLocation } from '@/test-support/faith-location-fixtures';
import { warmUpFirstMount } from '@/test-support/mock-latency-timers';

import { createMockFaithRepositories } from '../data/mock';
import {
  createFakeNotificationPort,
  type FakeNotificationPort,
} from '../data/notifications/fake-notification.port';
import { FaithRepositoryProvider } from '../di/faith-repository-context';
import { PreferencesScreen } from '../screens/preferences-screen';
import { faithAddress } from '@/test-support/faith-storage-address';

/**
 * Changing how prayer times are calculated must rebuild the alerts that were derived from them.
 *
 * ── The gap this covers ─────────────────────────────────────────────────────
 * The location change already reconciled — the Prayer location screen calls `refreshSchedule` after
 * its save. The *calculation* inputs did not. Method and Asr convention are the other two things
 * that decide when every prayer is, and switching from Muslim World League to Umm al-Qura moved the
 * times on screen while leaving the already-scheduled notifications alone.
 *
 * The schedule was not permanently wrong — `scheduleFingerprint` covers the method and the Asr
 * convention, so the next reconciliation notices the mismatch. But the next reconciliation is the
 * reminder screen mounting or the app returning to the foreground, and neither is guaranteed to
 * happen before the next Fajr. In between, alarms fire at instants no screen in the app agrees with,
 * and there is no state a user could observe that would tell them so.
 *
 * ── Why this asserts on the port rather than on the fingerprint ─────────────
 * The fingerprint is the mechanism; "the alerts were rebuilt" is the property. Asserting that the
 * platform was actually asked to schedule something keeps the test true if the mechanism is ever
 * replaced, and false if the reconciliation is quietly removed — which is the direction that matters.
 */

warmUpFirstMount(() => renderPreferences(createFakeNotificationPort({ permission: 'granted' })));

/** Master switch on, Fajr enabled — the smallest state in which alerts exist to be rebuilt. */
async function seedEnabledAlerts(): Promise<void> {
  await seedPrayerLocation();
  await AsyncStorage.setItem(
    faithAddress('preferences'),
    JSON.stringify({
      prayerNotificationsEnabled: true,
      prayerNotifications: [{ prayer: 'fajr', enabled: true, minutesBefore: 0 }],
      calculationMethod: 'muslim-world-league',
      asrMethod: 'standard',
    }),
  );
}

async function renderPreferences(notifications: FakeNotificationPort) {
  await render(
    <FaithRepositoryProvider repositories={{ ...createMockFaithRepositories(), notifications }}>
      <PreferencesScreen />
    </FaithRepositoryProvider>,
  );
  return screen;
}

/** One macrotask turn. The save path is storage → reconcile → platform, all promise-chained. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(async () => {
  await AsyncStorage.clear();
  await seedEnabledAlerts();
});

describe('changing a calculation input reschedules the alerts derived from it', () => {
  it('asks the platform to schedule after the calculation method changes', async () => {
    const notifications = createFakeNotificationPort({ permission: 'granted' });
    const view = await renderPreferences(notifications);

    /*
      No reconciliation on mount — this screen passes `false`, so anything in the call log after
      this point was caused by the press rather than by the screen appearing.
    */
    expect(notifications.calls().filter((call) => call.startsWith('schedule'))).toHaveLength(0);

    fireEvent.press(await view.findByTestId('faith-preference-method-umm-al-qura'));
    for (let turn = 0; turn < 8; turn += 1) {
      await settle();
    }

    expect(notifications.calls().some((call) => call.startsWith('schedule'))).toBe(true);
  });

  it('does not reschedule for a preference that cannot move a prayer time', async () => {
    /*
      The complement, and the reason the reconciliation is conditional rather than unconditional.
      Choosing a translation changes no instant, and rebuilding 35 alarms for it would spend a
      prayer-time calculation per day of the horizon on a preference the schedule cannot see.
    */
    const notifications = createFakeNotificationPort({ permission: 'granted' });
    const view = await renderPreferences(notifications);

    fireEvent.press(await view.findByTestId('faith-preferences-translation-row'));
    for (let turn = 0; turn < 8; turn += 1) {
      await settle();
    }

    expect(notifications.calls().filter((call) => call.startsWith('schedule'))).toHaveLength(0);
  });
});
