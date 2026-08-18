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
import { OBLIGATORY_PRAYERS } from '../data/prayer-times.repository';
import { FaithRepositoryProvider } from '../di/faith-repository-context';
import { PrayerRemindersScreen } from '../screens/prayer-reminders-screen';
import { faithAddress } from '@/test-support/faith-storage-address';

/**
 * The prayer reminders screen: reachable switches, one shared preference, and copy that is true.
 *
 * ── The three defects these cases were written against ──────────────────────
 *   1. **The master switch was not a switch.** `FaithRow` wrapped its body in `<View accessible>`,
 *      which on Android collapses the whole subtree into one `android.view.ViewGroup` — so the
 *      child `Switch` vanished from the accessibility hierarchy and could not be reached or
 *      activated. Jest never saw it, because `fireEvent` calls the prop directly and never goes near
 *      the platform's view tree. The prop-level assertion below is therefore a *proxy*: it pins the
 *      one prop that caused the collapse, and `uiautomator dump` on a release build is what proves
 *      the fix.
 *   2. **`useFaithPreferences` gave every call site its own state.** The screen held one copy and
 *      `usePrayerNotifications` — mounted by that same screen — held another, so the write went to a
 *      copy the switch was not reading and the switch stayed where it was.
 *   3. **The copy claimed a schedule that did not exist.** The master row said "Alerts are scheduled
 *      at each prayer time" whenever the *preference* was on, regardless of permission, location, or
 *      whether the platform held a single pending request.
 */

warmUpFirstMount(() => renderReminders(createFakeNotificationPort({ permission: 'granted' })));

async function seedPreferences(patch: Record<string, unknown>): Promise<void> {
  await seedPrayerLocation();
  await AsyncStorage.setItem(
    faithAddress('preferences'),
    JSON.stringify({
      prayerNotificationsEnabled: false,
      prayerNotifications: OBLIGATORY_PRAYERS.map((prayer) => ({
        prayer,
        enabled: false,
        minutesBefore: 0,
      })),
      calculationMethod: 'muslim-world-league',
      asrMethod: 'standard',
      ...patch,
    }),
  );
}

async function renderReminders(notifications: FakeNotificationPort) {
  await render(
    <FaithRepositoryProvider repositories={{ ...createMockFaithRepositories(), notifications }}>
      <PrayerRemindersScreen />
    </FaithRepositoryProvider>,
  );
  return screen;
}

/**
 * One macrotask turn.
 *
 * Every path here is storage → reconcile → platform, all promise-chained, and this project has no
 * act environment — so the loop is advanced by hand after each `fireEvent` and queried synchronously.
 * A `findBy*` mid-flight corrupts React for the rest of the file.
 */
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));
async function drain(turns = 30): Promise<void> {
  for (let turn = 0; turn < turns; turn += 1) {
    await settle();
  }
}

beforeEach(async () => {
  await AsyncStorage.clear();
  await seedPreferences({});
});

// ─────────────────────────────────────────────────────────────────────────────
// Accessibility and touch hierarchy
// ─────────────────────────────────────────────────────────────────────────────

describe('the switches are independently reachable', () => {
  it('does not merge the master switch into its row', async () => {
    const view = await renderReminders(createFakeNotificationPort({ permission: 'granted' }));
    await drain();

    const row = view.getByTestId('faith-prayer-notifications-master-row');
    /*
      ── The prop that caused the release blocker ──────────────────────────
      `accessible` on the row means "this subtree is one node" to Android, which is what turned the
      child Switch into an unreachable `android.view.ViewGroup`. It must be explicitly false.
    */
    expect(row.props.accessible).toBe(false);

    /* The label did not disappear with it — it moved onto the row's own text group. */
    const text = view.getByTestId('faith-prayer-notifications-master-row-text');
    expect(text.props.accessible).toBe(true);
    expect(String(text.props.accessibilityLabel)).toContain('Enable prayer notifications');
  });

  it('gives the master switch its own name, value and hint', async () => {
    const view = await renderReminders(createFakeNotificationPort({ permission: 'granted' }));
    await drain();

    const master = view.getByTestId('faith-prayer-notifications-master');
    expect(master.props.accessibilityLabel).toBe('Enable prayer notifications');
    expect(String(master.props.accessibilityHint)).toContain('prayer reminders');
    /* The value is the switch's own state, which is what a screen reader announces. */
    expect(master.props.value).toBe(false);
  });

  it('keeps every per-prayer switch independently reachable', async () => {
    const view = await renderReminders(createFakeNotificationPort({ permission: 'granted' }));
    await drain();

    for (const prayer of OBLIGATORY_PRAYERS) {
      expect(view.getByTestId(`faith-prayer-reminder-row-${prayer}`).props.accessible).toBe(false);
      const control = view.getByTestId(`faith-prayer-reminder-${prayer}`);
      expect(String(control.props.accessibilityLabel)).toContain('alert');
      expect(control.props.accessibilityHint).toBeDefined();
    }
  });

  it('invokes onValueChange when the switch itself is toggled', async () => {
    const notifications = createFakeNotificationPort({ permission: 'granted' });
    const view = await renderReminders(notifications);
    await drain();

    fireEvent(view.getByTestId('faith-prayer-notifications-master'), 'valueChange', true);
    await drain();

    /*
      The switch, read back from the shared store. Under the per-call-site state this replaces, the
      write landed on `usePrayerNotifications`'s copy and this assertion failed while the value sat
      correctly in storage — the exact device symptom.
    */
    expect(view.getByTestId('faith-prayer-notifications-master').props.value).toBe(true);
  });

  it('has no second handler on the row that could double-toggle', async () => {
    const view = await renderReminders(createFakeNotificationPort({ permission: 'granted' }));
    await drain();

    /* One control, one handler. A pressable row plus a switch is how a toggle lands back where it started. */
    expect(view.getByTestId('faith-prayer-notifications-master-row').props.onPress).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scheduling semantics
// ─────────────────────────────────────────────────────────────────────────────

describe('the screen reports what is scheduled, not what is preferred', () => {
  it('offers the five obligatory prayers and never sunrise', async () => {
    const view = await renderReminders(createFakeNotificationPort({ permission: 'granted' }));
    await drain();

    expect(OBLIGATORY_PRAYERS).toEqual(['fajr', 'dhuhr', 'asr', 'maghrib', 'isha']);
    for (const prayer of OBLIGATORY_PRAYERS) {
      expect(view.getByTestId(`faith-prayer-reminder-${prayer}`)).toBeTruthy();
    }
    /* Structurally absent: the rows are built from the domain's own list of the five. */
    expect(view.queryByTestId('faith-prayer-reminder-sunrise')).toBeNull();
  });

  it('does not claim a schedule when permission alone is granted', async () => {
    /*
      The preference is on and permission is granted, but nothing has been scheduled because no
      prayer is selected. The old copy said "Alerts are scheduled at each prayer time" here.
    */
    await seedPreferences({ prayerNotificationsEnabled: true });
    const view = await renderReminders(createFakeNotificationPort({ permission: 'granted' }));
    await drain();

    expect(view.getByTestId('faith-prayer-notification-freshness')).toBeTruthy();
    const status = view.getByTestId('faith-prayer-notification-freshness');
    expect(String(status.props.accessibilityLabel)).toContain('None pending');

    const row = view.getByTestId('faith-prayer-notifications-master-row-text');
    expect(String(row.props.accessibilityLabel)).not.toContain('scheduled at each prayer');
  });

  it('does not claim a schedule when the device refuses permission', async () => {
    await seedPreferences({
      prayerNotificationsEnabled: true,
      prayerNotifications: OBLIGATORY_PRAYERS.map((prayer) => ({
        prayer,
        enabled: true,
        minutesBefore: 0,
      })),
    });
    const view = await renderReminders(createFakeNotificationPort({ permission: 'denied' }));
    await drain();

    const permission = view.getByTestId('faith-prayer-notification-permission');
    expect(String(permission.props.accessibilityLabel)).toContain('Not allowed');

    const master = view.getByTestId('faith-prayer-notifications-master-row-text');
    /* The switch stays on — the preference is preserved — and the claim does not follow it. */
    expect(String(master.props.accessibilityLabel)).toMatch(/nothing could be scheduled|Selected/);
    expect(String(master.props.accessibilityLabel)).not.toContain('pending on this device');
  });

  it('states the pending count only once matching requests exist', async () => {
    await seedPreferences({
      prayerNotificationsEnabled: true,
      prayerNotifications: OBLIGATORY_PRAYERS.map((prayer) => ({
        prayer,
        enabled: true,
        minutesBefore: 0,
      })),
    });
    const notifications = createFakeNotificationPort({ permission: 'granted' });
    const view = await renderReminders(notifications);
    await drain(30);

    const pending = notifications.pending().length;
    expect(pending).toBeGreaterThan(0);

    /* The number on screen is the platform's own count, not a count of switches. */
    const line = view.getByTestId('faith-prayer-notification-freshness');
    expect(String(line.props.accessibilityLabel)).toContain(`${pending} pending`);
  });

  it('never says delivery is confirmed', async () => {
    const view = await renderReminders(createFakeNotificationPort({ permission: 'granted' }));
    await drain();

    const delivery = view.getByTestId('faith-prayer-notification-delivery');
    expect(String(delivery.props.accessibilityLabel)).toContain('Cannot be confirmed');
  });

  it('clears every pending request when the master switch goes off', async () => {
    await seedPreferences({
      prayerNotificationsEnabled: true,
      prayerNotifications: OBLIGATORY_PRAYERS.map((prayer) => ({
        prayer,
        enabled: true,
        minutesBefore: 0,
      })),
    });
    const notifications = createFakeNotificationPort({ permission: 'granted' });
    const view = await renderReminders(notifications);
    await drain(30);
    expect(notifications.pending().length).toBeGreaterThan(0);

    fireEvent(view.getByTestId('faith-prayer-notifications-master'), 'valueChange', false);
    await drain(30);

    /* Leaving alerts behind after the user turned them off is the one failure that wakes somebody. */
    expect(notifications.pending()).toHaveLength(0);
  });

  it('cancels one prayer without disturbing the others', async () => {
    await seedPreferences({
      prayerNotificationsEnabled: true,
      prayerNotifications: OBLIGATORY_PRAYERS.map((prayer) => ({
        prayer,
        enabled: true,
        minutesBefore: 0,
      })),
    });
    const notifications = createFakeNotificationPort({ permission: 'granted' });
    const view = await renderReminders(notifications);
    await drain(30);
    const before = notifications.pending().length;

    fireEvent(view.getByTestId('faith-prayer-reminder-fajr'), 'valueChange', false);
    await drain(30);

    const after = notifications.pending();
    expect(after.length).toBeGreaterThan(0);
    expect(after.length).toBeLessThan(before);
    /* And the switch the user did not touch is still on. */
    expect(view.getByTestId('faith-prayer-reminder-asr').props.value).toBe(true);
  });

  it('does not duplicate requests when reconciliation runs twice on the same inputs', async () => {
    await seedPreferences({
      prayerNotificationsEnabled: true,
      prayerNotifications: [{ prayer: 'fajr', enabled: true, minutesBefore: 0 }],
    });
    const notifications = createFakeNotificationPort({ permission: 'granted' });
    const view = await renderReminders(notifications);
    await drain(30);
    const first = notifications.pending().length;

    fireEvent.press(view.getByTestId('faith-prayer-notifications-refresh'));
    await drain(30);

    /* Same inputs, same identifiers still pending: the cheap path does no platform work at all. */
    expect(notifications.pending()).toHaveLength(first);
  });
});
