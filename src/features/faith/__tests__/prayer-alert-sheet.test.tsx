import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

import { ModuleProvider } from '@features/modules/module-context';
import { seedPrayerLocation } from '@/test-support/faith-location-fixtures';
import { alertSettingsFixture } from '@/test-support/prayer-alert-fixtures';

import { PrayerAlertSheet, exactnessText, fullAdhanReason } from '../components/prayer-alert-sheet';
import {
  NOTIFIABLE_TIMES,
  PRE_REMINDER_CHOICES,
  WEEKDAYS,
  type PrayerAlertSettings,
} from '../data/notifications/prayer-alert-preferences';
import { fullAdhanAvailability } from '../data/notifications/prayer-alert-sound';
import type { PrayerKey } from '../data/prayer-times.repository';

/**
 * The per-prayer notification sheet, and the control on the Prayer screen that opens it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The three claims this file exists to prevent ───────────────────────────
 *   1. **That NoorLife plays a call to prayer.** It does not: no licensed recording exists. The row
 *      is present and disabled, and it says why — and for sunrise it gives a *different* reason,
 *      because sunrise will still not be a prayer after a recording is licensed.
 *   2. **That an alert is an alarm, or exact.** Android 12+ gates exact scheduling behind a
 *      permission whose runtime grant is unreadable from JavaScript. The sheet says so.
 *   3. **That opening a settings surface asks the OS for anything.** Nothing here prompts; the
 *      Prayer screen is rendered below and the port is asserted never to have been asked.
 *
 * ── Why the sheet takes props rather than the hook ─────────────────────────
 * So that permission-denied, exactness-unknown and master-off can be *rendered* rather than
 * arranged. Every one of those is a state a device will not produce on demand, and each has copy
 * that must be right.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const FAJR = alertSettingsFixture({ on: ['fajr'], preReminderMinutes: 10 }).find(
  (entry) => entry.time === 'fajr',
)!;
const FAJR_OFF = alertSettingsFixture({}).find((entry) => entry.time === 'fajr')!;
const SUNRISE = alertSettingsFixture({ on: ['sunrise'] }).find(
  (entry) => entry.time === 'sunrise',
)!;

type Handlers = {
  notify: jest.Mock;
  days: jest.Mock;
  pre: jest.Mock;
  sound: jest.Mock;
  mode: jest.Mock;
  settings: jest.Mock;
  close: jest.Mock;
};

function handlers(): Handlers {
  return {
    notify: jest.fn(),
    days: jest.fn(),
    pre: jest.fn(),
    sound: jest.fn(),
    mode: jest.fn(),
    settings: jest.fn(),
    close: jest.fn(),
  };
}

async function renderSheet(
  options: {
    readonly time?: PrayerKey;
    readonly label?: string;
    readonly settings?: PrayerAlertSettings;
    readonly masterEnabled?: boolean;
    readonly permission?: 'granted' | 'denied' | 'undetermined';
    readonly exactAlarms?: 'not-required' | 'available' | 'unavailable' | 'unknown';
    readonly on?: Handlers;
  } = {},
) {
  const on = options.on ?? handlers();
  await render(
    <ModuleProvider moduleId="faith">
      <PrayerAlertSheet
        time={options.time ?? 'fajr'}
        label={options.label ?? 'Fajr'}
        settings={options.settings ?? FAJR}
        masterEnabled={options.masterEnabled ?? true}
        permission={options.permission ?? 'granted'}
        exactAlarms={options.exactAlarms ?? 'unknown'}
        onSetNotify={on.notify}
        onSetRepeatDays={on.days}
        onSetPreReminder={on.pre}
        onSetSound={on.sound}
        onSetMode={on.mode}
        onOpenSystemSettings={on.settings}
        onClose={on.close}
      />
    </ModuleProvider>,
  );
  return on;
}

const id = (time: PrayerKey, suffix: string) => `faith-prayer-alert-sheet-${time}${suffix}`;

beforeEach(async () => {
  await AsyncStorage.clear();
  await seedPrayerLocation();
});

// ─────────────────────────────────────────────────────────────────────────────
// The full adhān row
// ─────────────────────────────────────────────────────────────────────────────

describe('the mode selector explains each absence rather than hiding it', () => {
  /*
    ── Why these read pills rather than a switch ──────────────────────────────
    The single "Full adhān" switch became a four-mode selector for #178, so the assertions moved
    from `props.value` to the radio's selected/disabled state. The *intent* is unchanged and is the
    reason this suite exists: an audio mode must be visibly present, unselectable, and accompanied by
    a reason that says which kind of no it is.
  */
  it('offers Notification only as the selected, enabled mode', async () => {
    await renderSheet();

    const notificationOnly = screen.getByTestId(id('fajr', '-mode-notification-only'));
    expect(notificationOnly.props.accessibilityState).toMatchObject({
      selected: true,
      disabled: false,
    });
  });

  it('shows both audio modes disabled, with the licensing reason', async () => {
    await renderSheet();

    for (const mode of ['short-adhan', 'full-adhan']) {
      const pill = screen.getByTestId(id('fajr', `-mode-${mode}`));
      expect(pill.props.accessibilityState).toMatchObject({ selected: false, disabled: true });
    }
    /* Short adhān waits only on a licence, so that is what it says. */
    expect(
      String(screen.getByTestId(id('fajr', '-mode-short-adhan-reason')).props.children),
    ).toMatch(/no licensed adh/i);
  });

  it('gives full adhān a platform reason, not a licensing one', async () => {
    await renderSheet();

    /*
      The distinction #178 turns on. Full adhān is not merely unlicensed — on iOS it cannot be
      honoured through a notification at all, and on Android this build has no mechanism for it. That
      reason must survive #42 closing, so it must not mention a licence.
    */
    const reason = String(screen.getByTestId(id('fajr', '-mode-full-adhan-reason')).props.children);
    expect(reason).not.toMatch(/no licensed adh/i);
    expect(reason).toMatch(/background on Android yet|cannot play a full adh/i);
  });

  it('gives sunrise a reason that will still be true after a licence', async () => {
    await renderSheet({ time: 'sunrise', label: 'Sunrise', settings: SUNRISE });

    for (const mode of ['short-adhan', 'full-adhan']) {
      const reason = String(
        screen.getByTestId(id('sunrise', `-mode-${mode}-reason`)).props.children,
      );
      expect(reason).toMatch(/time marker, not a prayer/i);
      expect(reason).not.toMatch(/not available yet|licensed/i);
      expect(
        screen.getByTestId(id('sunrise', `-mode-${mode}`)).props.accessibilityState,
      ).toMatchObject({ disabled: true });
    }
  });

  it('separates the two reasons at the source', () => {
    const unavailable = fullAdhanAvailability().reason;
    expect(fullAdhanReason('fajr', unavailable)).toBe(unavailable);
    expect(fullAdhanReason('sunrise', unavailable)).not.toBe(unavailable);
  });

  it('never offers an audio mode as selectable, at any time of day', async () => {
    for (const time of NOTIFIABLE_TIMES) {
      await renderSheet({ time, label: time, settings: alertSettingsFixture({ on: [time] })[0] });
      for (const mode of ['short-adhan', 'full-adhan']) {
        expect(
          screen.getByTestId(id(time, `-mode-${mode}`)).props.accessibilityState,
        ).toMatchObject({ selected: false, disabled: true });
      }
    }
  });

  it('does not call the setter when a disabled audio mode is pressed', async () => {
    const on = await renderSheet();

    await fireEvent.press(screen.getByTestId(id('fajr', '-mode-full-adhan')));

    /* A disabled Pressable fires nothing, which is what keeps an unplayable mode out of storage. */
    expect(on.mode).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Notify, days, pre-reminder, sound
// ─────────────────────────────────────────────────────────────────────────────

describe('every control reports what is stored and reports a change once', () => {
  it('shows the notify switch in the stored position', async () => {
    await renderSheet({ settings: FAJR });
    expect(screen.getByTestId(id('fajr', '-notify')).props.value).toBe(true);

    await renderSheet({ settings: FAJR_OFF });
    expect(screen.getByTestId(id('fajr', '-notify')).props.value).toBe(false);
  });

  it('reports a notify change without changing anything itself', async () => {
    const on = await renderSheet({ settings: FAJR_OFF });
    await fireEvent(screen.getByTestId(id('fajr', '-notify')), 'valueChange', true);

    expect(on.notify).toHaveBeenCalledTimes(1);
    expect(on.notify).toHaveBeenCalledWith(true);
    /* A sheet that also wrote would be a second commit point disagreeing with the store. */
    expect(on.days).not.toHaveBeenCalled();
  });

  it('draws all seven days, named for a screen reader', async () => {
    await renderSheet();

    expect(WEEKDAYS).toHaveLength(7);
    for (const day of WEEKDAYS) {
      const control = screen.getByTestId(id('fajr', `-day-${day.index}`));
      /* The full name: "T" is ambiguous spoken aloud and "S" is worse. */
      expect(control.props.accessibilityLabel).toBe(day.name);
      expect(control.props.accessibilityState.checked).toBe(true);
    }
  });

  it('removes a selected day and keeps the rest', async () => {
    const on = await renderSheet({ settings: FAJR });
    await fireEvent.press(screen.getByTestId(id('fajr', '-day-3')));

    expect(on.days).toHaveBeenCalledTimes(1);
    expect(on.days).toHaveBeenCalledWith([0, 1, 2, 4, 5, 6]);
  });

  it('adds an unselected day in sorted order', async () => {
    const only = { ...FAJR, repeatDays: [1, 5] };
    const on = await renderSheet({ settings: only });
    await fireEvent.press(screen.getByTestId(id('fajr', '-day-3')));

    expect(on.days).toHaveBeenCalledWith([1, 3, 5]);
  });

  it('shows the selection in words as well as in circles', async () => {
    await renderSheet({ settings: FAJR });
    expect(String(screen.getByTestId(id('fajr', '-repeat-summary')).props.children)).toBe(
      'Every day',
    );

    await renderSheet({ settings: { ...FAJR, repeatDays: [1, 5] } });
    expect(String(screen.getByTestId(id('fajr', '-repeat-summary')).props.children)).toBe(
      'Mon, Fri',
    );
  });

  it.each(PRE_REMINDER_CHOICES)('offers %s minutes and reports it once', async (minutes) => {
    const on = await renderSheet({ settings: { ...FAJR, preReminderMinutes: 0 } });
    const control = screen.getByTestId(id('fajr', `-pre-${minutes}`));
    await fireEvent.press(control);

    expect(on.pre).toHaveBeenCalledTimes(1);
    expect(on.pre).toHaveBeenCalledWith(minutes);
  });

  it('marks the stored pre-reminder as the selected one', async () => {
    await renderSheet({ settings: { ...FAJR, preReminderMinutes: 15 } });
    expect(screen.getByTestId(id('fajr', '-pre-15')).props.accessibilityState.selected).toBe(true);
    for (const other of PRE_REMINDER_CHOICES.filter((minutes) => minutes !== 15)) {
      expect(
        screen.getByTestId(id('fajr', `-pre-${other}`)).props.accessibilityState.selected,
      ).toBe(false);
    }
  });

  it('offers exactly two sounds and reports the choice', async () => {
    const on = await renderSheet({ settings: FAJR });
    expect(screen.getByTestId(id('fajr', '-sound-system-default'))).toBeTruthy();
    expect(screen.getByTestId(id('fajr', '-sound-silent'))).toBeTruthy();

    await fireEvent.press(screen.getByTestId(id('fajr', '-sound-silent')));
    expect(on.sound).toHaveBeenCalledWith('silent');
  });

  it('warns that a silent choice creates its own system category', async () => {
    /*
      Named because the user will meet it: on Android, silence is a second channel, and finding an
      unexplained extra "Prayer alerts (silent)" category is worse than being told.
    */
    await renderSheet({ settings: { ...FAJR, sound: 'silent' } });
    expect(String(screen.getByTestId(id('fajr', '-sound-note')).props.children)).toMatch(
      /own category in your system notification settings/i,
    );
  });

  it('disables the choices while the time is switched off, and keeps them stored', async () => {
    /*
      Not hidden: a switched-off time keeps the days and the pre-reminder the user chose, so they are
      shown as they are and cannot be edited into something that does nothing.
    */
    await renderSheet({ settings: { ...FAJR_OFF, repeatDays: [2], preReminderMinutes: 30 } });

    expect(screen.getByTestId(id('fajr', '-day-2')).props.accessibilityState.disabled).toBe(true);
    expect(screen.getByTestId(id('fajr', '-pre-30')).props.accessibilityState.disabled).toBe(true);
    expect(screen.getByTestId(id('fajr', '-pre-30')).props.accessibilityState.selected).toBe(true);
    /* The notify switch itself stays live — that is how the rest becomes editable again. */
    expect(screen.getByTestId(id('fajr', '-notify')).props.disabled).toBeFalsy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Honest states
// ─────────────────────────────────────────────────────────────────────────────

describe('the sheet states what it cannot promise', () => {
  it('says the device is refusing, and offers the one action that helps', async () => {
    const on = await renderSheet({ permission: 'denied' });

    const notice = screen.getByTestId(id('fajr', '-permission'));
    expect(notice).toBeTruthy();
    await fireEvent.press(screen.getByTestId(id('fajr', '-permission-action')));
    expect(on.settings).toHaveBeenCalledTimes(1);
  });

  it('says NoorLife has not asked yet, without asking', async () => {
    const on = await renderSheet({ permission: 'undetermined' });
    expect(
      String(screen.getByTestId(id('fajr', '-permission')).props.children).length,
    ).toBeGreaterThan(0);
    /* No action button: the way to be asked is to switch a time on, not to press a notice. */
    expect(screen.queryByTestId(id('fajr', '-permission-action'))).toBeNull();
    expect(on.settings).not.toHaveBeenCalled();
  });

  it('says nothing about permission when it has been granted', async () => {
    await renderSheet({ permission: 'granted' });
    expect(screen.queryByTestId(id('fajr', '-permission'))).toBeNull();
  });

  it('says the master switch is off, and that the choices are kept', async () => {
    await renderSheet({ masterEnabled: false });
    expect(screen.getByTestId(id('fajr', '-master-off'))).toBeTruthy();

    await renderSheet({ masterEnabled: true });
    expect(screen.queryByTestId(id('fajr', '-master-off'))).toBeNull();
  });

  it('says when a switched-on time has no day selected', async () => {
    await renderSheet({ settings: { ...FAJR, repeatDays: [] } });
    expect(screen.getByTestId(id('fajr', '-no-days'))).toBeTruthy();
    /* Read as text: the notice wraps its sentence in a child, so the wrapper holds elements. */
    expect(screen.getByText(/nothing is scheduled for this time/i)).toBeTruthy();

    await renderSheet({ settings: FAJR });
    expect(screen.queryByTestId(id('fajr', '-no-days'))).toBeNull();
  });

  it('never claims exactness it cannot confirm, and never says "alarm"', async () => {
    for (const capability of ['unknown', 'unavailable', 'available', 'not-required'] as const) {
      await renderSheet({ exactAlarms: capability });
      const text = String(screen.getByTestId(id('fajr', '-exactness')).props.children);
      expect(text).toBe(exactnessText(capability));
      expect(text).not.toMatch(/\balarm\b/i);
      if (capability === 'unknown') {
        expect(text).toMatch(/cannot be confirmed/i);
      }
    }
  });

  it('says delivery cannot be confirmed at all', async () => {
    await renderSheet();
    expect(String(screen.getByTestId(id('fajr', '-battery')).props.children)).toMatch(
      /cannot confirm a notification was delivered/i,
    );
  });

  it('never uses the word alarm anywhere a user can read it', async () => {
    await renderSheet({ permission: 'denied', masterEnabled: false, exactAlarms: 'unavailable' });
    for (const suffix of [
      '-title',
      '-subtitle',
      '-exactness',
      '-battery',
      '-sound-note',
      /* The mode reasons replaced the single full-adhān caption for #178. */
      '-mode-short-adhan-reason',
      '-mode-full-adhan-reason',
    ]) {
      expect(String(screen.getByTestId(id('fajr', suffix)).props.children)).not.toMatch(/\balarm/i);
    }
  });

  it('names the prayer it is about, and marks a marker as one', async () => {
    await renderSheet({ time: 'maghrib', label: 'Maghrib', settings: FAJR });
    expect(String(screen.getByTestId(id('maghrib', '-title')).props.children)).toBe(
      'Maghrib notifications',
    );

    await renderSheet({ time: 'sunrise', label: 'Sunrise', settings: SUNRISE });
    expect(String(screen.getByTestId(id('sunrise', '-subtitle')).props.children)).toMatch(
      /time marker, not a prayer/i,
    );
  });

  it('closes from the scrim and from the close control', async () => {
    const on = await renderSheet();
    await fireEvent.press(screen.getByTestId(id('fajr', '-close')));
    await fireEvent.press(screen.getByTestId(id('fajr', '-scrim')));
    expect(on.close).toHaveBeenCalledTimes(2);
  });
});
