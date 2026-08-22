import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

import { seedPrayerLocation } from '@/test-support/faith-location-fixtures';
import { warmUpFirstMount } from '@/test-support/mock-latency-timers';

import { prayerJourneyMetrics } from '../components/prayer-journey-timeline';
import { createMockFaithRepositories } from '../data/mock';
import {
  createFakeNotificationPort,
  type FakeNotificationPort,
} from '../data/notifications/fake-notification.port';
import { NOTIFIABLE_TIMES } from '../data/notifications/prayer-alert-preferences';
import type { PrayerKey } from '../data/prayer-times.repository';
import { FaithRepositoryProvider } from '../di/faith-repository-context';
import { PrayerTimesScreen } from '../screens/prayer-times-screen';

/**
 * The notification control on the Prayer screen: what it draws, what it opens, and what it must not do.
 *
 * ── Why this is its own file rather than part of the sheet's ─────────────────
 * The sheet's suite renders a small component thirty times. This one renders the whole Prayer screen,
 * which resolves a location, calculates a day and derives a next prayer before it draws a row — and
 * mixing the two in one file put the screen renders behind thirty accumulated trees in a suite with
 * no act environment, where the screen then never resolved. Splitting them is the same separation the
 * rest of the module already uses, and it is what makes `findByTestId` safe here.
 *
 * ── The rule with the most to lose ──────────────────────────────────────────
 * Rendering the Prayer screen must ask the operating system for nothing and schedule nothing. A
 * notification permission is requested only after somebody switches a time on, and a schedule is
 * built only when a preference changes. Both are asserted against the port's own call log.
 */

warmUpFirstMount(() => renderPrayerScreen(createFakeNotificationPort({ permission: 'granted' })));

async function renderPrayerScreen(notifications: FakeNotificationPort) {
  await render(
    <FaithRepositoryProvider repositories={{ ...createMockFaithRepositories(), notifications }}>
      <PrayerTimesScreen />
    </FaithRepositoryProvider>,
  );
  return screen;
}

/** The screen, settled far enough that its rows exist. */
async function renderResolved(notifications: FakeNotificationPort) {
  const view = await renderPrayerScreen(notifications);
  await view.findByTestId('faith-prayer-journey');
  return view;
}

const sheetId = (time: PrayerKey) => `faith-prayer-alert-sheet-${time}`;

const settle = () => new Promise((resolve) => setTimeout(resolve, 5));
async function drain(turns = 10): Promise<void> {
  for (let turn = 0; turn < turns; turn += 1) {
    await settle();
  }
}

beforeEach(async () => {
  await AsyncStorage.clear();
  await seedPrayerLocation();
});

describe('every one of the six rows offers a notification control', () => {
  it('draws one per row, stating its setting in words', async () => {
    const view = await renderResolved(createFakeNotificationPort({ permission: 'granted' }));

    for (const time of NOTIFIABLE_TIMES) {
      const control = view.getByTestId(`faith-prayer-journey-${time}-notify`);
      expect(String(control.props.accessibilityLabel)).toMatch(/^Notification settings for /);
      /*
        The state in words as well as in colour. A tint alone is not a state anybody can rely on, and
        the label never says "alarm" — what this schedules is a notification, and whether the device
        delivers it at the exact minute is not knowable from here.
      */
      expect(control.props.accessibilityValue.text).toBe('Off');
      expect(String(control.props.accessibilityLabel)).not.toMatch(/alarm/i);
    }
  });

  it('does not collapse the row, so the control stays reachable', async () => {
    /*
      ── The release defect this pins ──────────────────────────────────────────
      On Android `accessible` means "this subtree is one node": the platform collapses everything
      inside and stops exposing the children. A row that stayed `accessible` with a button inside it
      would hide that button from TalkBack and from any accessibility-driven tap, while every Jest
      assertion carried on passing — which is exactly how six prayer switches once disappeared.

      So with a control present the row is not one node, and the utterance moves onto its summary.
      Verify on a device with `uiautomator dump`; this pins the props that make it possible.
    */
    const view = await renderResolved(createFakeNotificationPort({ permission: 'granted' }));

    for (const time of NOTIFIABLE_TIMES) {
      expect(view.getByTestId(`faith-prayer-journey-${time}`).props.accessible).toBe(false);
      const summary = view.getByTestId(`faith-prayer-journey-${time}-summary`);
      expect(summary.props.accessible).toBe(true);
      expect(String(summary.props.accessibilityLabel).length).toBeGreaterThan(0);
    }
  });

  it('opens that time’s sheet, and only that one', async () => {
    const view = await renderResolved(createFakeNotificationPort({ permission: 'granted' }));

    fireEvent.press(view.getByTestId('faith-prayer-journey-asr-notify'));
    await drain();

    expect(view.getByTestId(sheetId('asr'))).toBeTruthy();
    expect(view.queryByTestId(sheetId('fajr'))).toBeNull();
  });

  it('offers sunrise its own settings, and marks it as not a prayer', async () => {
    const view = await renderResolved(createFakeNotificationPort({ permission: 'granted' }));

    fireEvent.press(view.getByTestId('faith-prayer-journey-sunrise-notify'));
    await drain();

    expect(view.getByTestId(sheetId('sunrise'))).toBeTruthy();
    expect(String(view.getByTestId(`${sheetId('sunrise')}-subtitle`).props.children)).toMatch(
      /time marker, not a prayer/i,
    );
    /* And it can never be given a call to prayer, for a reason a licence will not change. */
    expect(
      String(view.getByTestId(`${sheetId('sunrise')}-full-adhan-reason`).props.children),
    ).toMatch(/time marker, not a prayer/i);
  });

  it('names the prayer from the repository, not from a string built in the view', async () => {
    const view = await renderResolved(createFakeNotificationPort({ permission: 'granted' }));

    fireEvent.press(view.getByTestId('faith-prayer-journey-maghrib-notify'));
    await drain();

    const rowLabel = String(view.getByTestId('faith-prayer-journey-maghrib-label').props.children);
    expect(String(view.getByTestId(`${sheetId('maghrib')}-title`).props.children)).toBe(
      `${rowLabel} notifications`,
    );
  });
});

describe('rendering the Prayer screen asks the platform for nothing', () => {
  it('requests no permission and creates no schedule', async () => {
    const notifications = createFakeNotificationPort({ permission: 'undetermined' });
    await renderResolved(notifications);
    await drain();

    expect(notifications.calls()).not.toContain('requestPermission');
    expect(notifications.calls().filter((call) => call.startsWith('schedule'))).toEqual([]);
    expect(notifications.calls().filter((call) => call.startsWith('cancel'))).toEqual([]);
    expect(notifications.pending()).toEqual([]);
    expect(notifications.requests()).toEqual([]);
  });

  it('creates no Android channel either, until something needs one', async () => {
    /*
      The channel is created immediately before the permission prompt, because on Android 13+ the
      system dialog lists the app's channels. Neither happens from merely looking at prayer times.
    */
    const notifications = createFakeNotificationPort({ permission: 'undetermined' });
    await renderResolved(notifications);
    await drain();

    expect(notifications.channels()).toEqual([]);
  });

  it('still asks nothing when a sheet is opened', async () => {
    const notifications = createFakeNotificationPort({ permission: 'undetermined' });
    const view = await renderResolved(notifications);

    fireEvent.press(view.getByTestId('faith-prayer-journey-fajr-notify'));
    await drain();

    /*
      Opening it reads the delivery state — `getPermission` and `exactAlarmCapability`, neither of
      which prompts — so the sheet can be honest about permission and timing without paying for a
      reconciliation. Nothing is scheduled and nothing is requested.
    */
    expect(notifications.calls()).not.toContain('requestPermission');
    expect(notifications.calls().filter((call) => call.startsWith('schedule'))).toEqual([]);
    expect(view.getByTestId(sheetId('fajr'))).toBeTruthy();
  });

  it('reports permission honestly in the sheet it opened', async () => {
    const notifications = createFakeNotificationPort({ permission: 'denied' });
    const view = await renderResolved(notifications);

    fireEvent.press(view.getByTestId('faith-prayer-journey-fajr-notify'));
    await drain();

    /*
      The reason `refreshDelivery` exists: the Prayer screen never reconciles on mount, so without a
      cheap read the sheet would tell a user whose permission is denied that NoorLife has not asked.
    */
    expect(view.getByTestId(`${sheetId('fajr')}-permission`)).toBeTruthy();
    expect(view.getByTestId(`${sheetId('fajr')}-permission-action`)).toBeTruthy();
  });
});

describe('the timeline’s measurements did not move', () => {
  it('keeps its row pitch, disc, padding and row count', () => {
    /*
      The Prayer dashboard is required to fit one viewport and six rows are its largest term, so a
      control added to a row must not grow it. The bell is 36 dp drawn, with `minimumHitSlop` taking
      the touchable area to the 44 dp minimum — inside the existing 48 dp row.
    */
    expect(prayerJourneyMetrics.rowMinHeightDp).toBe(48);
    expect(prayerJourneyMetrics.discDp).toBe(38);
    expect(prayerJourneyMetrics.cardPaddingDp).toBe(10);
    expect(prayerJourneyMetrics.headingMarginDp).toBe(4);
    expect(prayerJourneyMetrics.rows).toBe(6);
  });

  it('keeps the card height the dashboard fit was calculated from', () => {
    // The reference's 330–365 dp band, which the fit calculation depends on.
    expect(prayerJourneyMetrics.heightDp).toBeGreaterThan(330);
    expect(prayerJourneyMetrics.heightDp).toBeLessThan(366);
  });
});
