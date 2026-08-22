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
import {
  canEverPlayFullAdhan,
  NOTIFIABLE_TIMES,
} from '../data/notifications/prayer-alert-preferences';
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

  it('keeps every per-time switch independently reachable', async () => {
    const view = await renderReminders(createFakeNotificationPort({ permission: 'granted' }));
    await drain();

    /*
      All six now, sunrise included. The row is not `accessible`, so its switch stays an
      independent node — the release defect where six switches vanished from the Android
      accessibility tree while every Jest assertion passed. Verify on device with `uiautomator
      dump`; this only pins the props that make it possible.
    */
    for (const time of NOTIFIABLE_TIMES) {
      expect(view.getByTestId(`faith-prayer-reminder-row-${time}`).props.accessible).toBe(false);
      const control = view.getByTestId(`faith-prayer-reminder-${time}`);
      expect(String(control.props.accessibilityLabel)).toContain('Notify me for');
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
  it('offers all six times, and marks the one that is not a prayer', async () => {
    const view = await renderReminders(createFakeNotificationPort({ permission: 'granted' }));
    await drain();

    /*
      ── What changed ──────────────────────────────────────────────────────
      Sunrise used to have no row at all: the list was built from `OBLIGATORY_PRAYERS`, so it was
      structurally absent. It is now offered as an ordinary reminder, and what keeps it honest is
      no longer its absence but the two things asserted below — the row says it is a time marker,
      and the domain still refuses it a call to prayer.
    */
    expect(OBLIGATORY_PRAYERS).toEqual(['fajr', 'dhuhr', 'asr', 'maghrib', 'isha']);
    for (const time of NOTIFIABLE_TIMES) {
      expect(view.getByTestId(`faith-prayer-reminder-${time}`)).toBeTruthy();
    }
    expect(view.getByTestId('faith-prayer-reminder-sunrise')).toBeTruthy();

    /*
      Asserted on the rendered text rather than the row's `accessibilityLabel`: a row with an
      interactive trailing control is deliberately not `accessible`, so the utterance lives on its
      text column. The visible words are what a sighted reader gets and what a screen reader reads
      from that column, so this is the stronger of the two assertions anyway.
    */
    expect(view.getByText(/time marker, not a prayer/)).toBeTruthy();
    expect(canEverPlayFullAdhan('sunrise')).toBe(false);
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

// ─────────────────────────────────────────────────────────────────────────────
// Permission is asked for once, and only by an explicit switch
// ─────────────────────────────────────────────────────────────────────────────

describe('the OS is asked only when a person switches something on', () => {
  it('asks for nothing while the screen merely renders', async () => {
    const notifications = createFakeNotificationPort({ permission: 'undetermined' });
    await renderReminders(notifications);
    await drain(30);

    expect(notifications.calls()).not.toContain('requestPermission');
    expect(notifications.pending()).toEqual([]);
  });

  it('asks when a time is switched on, and creates the channel first', async () => {
    /*
      The order is the point. On Android 13+ the system permission dialog lists the app's channels,
      so a prompt raised before the channel exists describes nothing — and the channel created
      afterwards takes whatever importance the OS defaulted to rather than the one asked for.
    */
    await seedPreferences({ prayerNotificationsEnabled: true });
    const notifications = createFakeNotificationPort({ permission: 'undetermined' });
    const view = await renderReminders(notifications);
    await drain(30);

    fireEvent(view.getByTestId('faith-prayer-reminder-fajr'), 'valueChange', true);
    await drain(30);

    const calls = notifications.calls();
    const channel = calls.findIndex((call) => call.startsWith('ensureChannel:'));
    const prompt = calls.indexOf('requestPermission');
    expect(channel).toBeGreaterThanOrEqual(0);
    expect(prompt).toBeGreaterThan(channel);
  });

  it('does not ask again when a second time is switched on', async () => {
    await seedPreferences({ prayerNotificationsEnabled: true });
    const notifications = createFakeNotificationPort({ permission: 'granted' });
    const view = await renderReminders(notifications);
    await drain(30);

    fireEvent(view.getByTestId('faith-prayer-reminder-fajr'), 'valueChange', true);
    await drain(30);
    fireEvent(view.getByTestId('faith-prayer-reminder-asr'), 'valueChange', true);
    await drain(30);

    /* Already granted: there is nothing to ask, and asking anyway is how an app gets muted. */
    expect(notifications.calls().filter((call) => call === 'requestPermission')).toEqual([]);
  });

  it('never asks when a time is switched off', async () => {
    await seedPreferences({
      prayerNotificationsEnabled: true,
      prayerAlerts: [
        {
          time: 'fajr',
          notify: true,
          repeatDays: [0, 1, 2, 3, 4, 5, 6],
          preReminderMinutes: 0,
          sound: 'system-default',
        },
      ],
    });
    const notifications = createFakeNotificationPort({ permission: 'undetermined' });
    const view = await renderReminders(notifications);
    await drain(30);

    fireEvent(view.getByTestId('faith-prayer-reminder-fajr'), 'valueChange', false);
    await drain(30);

    expect(notifications.calls()).not.toContain('requestPermission');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The per-time sheet, from the reminders screen
// ─────────────────────────────────────────────────────────────────────────────

describe('each row opens its own settings, and the choices survive a restart', () => {
  it('opens the sheet for the row that was pressed', async () => {
    const view = await renderReminders(createFakeNotificationPort({ permission: 'granted' }));
    await drain(30);

    fireEvent.press(view.getByTestId('faith-prayer-reminder-open-isha'));
    await drain(10);

    expect(view.getByTestId('faith-prayer-alert-sheet-isha')).toBeTruthy();
    expect(view.queryByTestId('faith-prayer-alert-sheet-fajr')).toBeNull();
  });

  it('keeps a repeat-day and pre-reminder choice across a remount', async () => {
    /*
      The force-stop case, as far as Jest can reach it: the store is reset and re-hydrated from
      storage, which is what a relaunch does. What is asserted is that the *stored* choice is what
      comes back — not the default the screen would show if the write had not landed.
    */
    await seedPreferences({
      prayerNotificationsEnabled: true,
      prayerAlerts: [
        { time: 'asr', notify: true, repeatDays: [1, 3], preReminderMinutes: 15, sound: 'silent' },
      ],
    });

    const view = await renderReminders(createFakeNotificationPort({ permission: 'granted' }));
    await drain(30);

    fireEvent.press(view.getByTestId('faith-prayer-reminder-open-asr'));
    await drain(10);

    const sheet = 'faith-prayer-alert-sheet-asr';
    expect(view.getByTestId(`${sheet}-notify`).props.value).toBe(true);
    expect(String(view.getByTestId(`${sheet}-repeat-summary`).props.children)).toBe('Mon, Wed');
    expect(view.getByTestId(`${sheet}-pre-15`).props.accessibilityState.selected).toBe(true);
    expect(view.getByTestId(`${sheet}-sound-silent`).props.accessibilityState.selected).toBe(true);
  });

  it('reports the full adhān as unavailable wherever the sheet is opened from', async () => {
    const view = await renderReminders(createFakeNotificationPort({ permission: 'granted' }));
    await drain(30);

    fireEvent.press(view.getByTestId('faith-prayer-reminder-open-fajr'));
    await drain(10);

    const control = view.getByTestId('faith-prayer-alert-sheet-fajr-full-adhan');
    expect(control.props.disabled).toBe(true);
    expect(control.props.value).toBe(false);
  });

  it('says on the screen itself that no adhān is available', async () => {
    const view = await renderReminders(createFakeNotificationPort({ permission: 'granted' }));
    await drain(30);

    /* Stated rather than omitted: somebody looking for the feature should learn it is absent here. */
    const line = view.getByTestId('faith-prayer-notification-full-adhan');
    expect(String(line.props.accessibilityLabel)).toMatch(/full adh/i);
    expect(String(line.props.accessibilityLabel)).toMatch(/not available|no licensed/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The settings button is a real, reachable control
// ─────────────────────────────────────────────────────────────────────────────

describe('each row opens its settings from its own button', () => {
  /*
    ── Why a button and not the row ──────────────────────────────────────────
    The row used to pass `onPress` alongside `trailingInteractive`, and `FaithRow` ignores `onPress`
    in that combination — deliberately, because a row press that also drove the switch beside it
    would put two handlers on one gesture. So nothing opened: `uiautomator` reported the row as
    `clickable=false` on the device while a Jest case asserting the press passed, because
    `fireEvent.press` calls the prop directly and never reaches the platform tree.

    `FaithRowProps` is now a union that makes the pair a compile error. The press lives on its own
    button, which is a separate node with its own label and hint — two actions, no shared gesture.
  */
  it('gives every time its own settings button, labelled and hinted', async () => {
    const view = await renderReminders(createFakeNotificationPort({ permission: 'granted' }));
    await drain();

    for (const time of NOTIFIABLE_TIMES) {
      const button = view.getByTestId(`faith-prayer-reminder-open-${time}`);
      expect(String(button.props.accessibilityLabel)).toMatch(/^Notification settings for /);
      expect(String(button.props.accessibilityHint)).toMatch(/days, pre-reminder and sound/i);
      /* Its own role, distinct from the switch's. */
      expect(button.props.accessibilityRole).toBe('button');
      /* Small by design, expanded to the minimum — the row's height must not grow. */
      expect(button.props.hitSlop).toBeDefined();
    }
  });

  it('keeps the switch and the button as two separate controls', async () => {
    const view = await renderReminders(createFakeNotificationPort({ permission: 'granted' }));
    await drain();

    const switchNode = view.getByTestId('faith-prayer-reminder-fajr');
    const button = view.getByTestId('faith-prayer-reminder-open-fajr');
    expect(switchNode).not.toBe(button);
    /* The row itself carries no press, which is what the type now enforces. */
    expect(view.getByTestId('faith-prayer-reminder-row-fajr').props.onPress).toBeUndefined();
  });

  it('opens the sheet for the button that was pressed, and only that one', async () => {
    const view = await renderReminders(createFakeNotificationPort({ permission: 'granted' }));
    await drain();

    fireEvent.press(view.getByTestId('faith-prayer-reminder-open-maghrib'));
    await drain(10);

    expect(view.getByTestId('faith-prayer-alert-sheet-maghrib')).toBeTruthy();
    expect(view.queryByTestId('faith-prayer-alert-sheet-fajr')).toBeNull();
  });
});
