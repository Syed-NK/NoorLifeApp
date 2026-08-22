import {
  defaultAllAlertSettings,
  enableSettings,
  type AlertSoundChoice,
  type PrayerAlertSettings,
  type PreReminderMinutes,
} from '@features/faith/data/notifications/prayer-alert-preferences';
import type { PrayerKey } from '@features/faith/data/prayer-times.repository';

/**
 * Per-time notification settings for a test, without spelling out all six every time.
 *
 * ── Why a fixture rather than object literals in each suite ─────────────────
 * Because the settings type is what the scheduler reads, and a literal written by hand in a test can
 * omit a field the planner depends on — at which point the test is exercising a shape production can
 * never produce. Building from `defaultAllAlertSettings` and `enableSettings` means a fixture is
 * always the shape the app itself would have written, including the seven-day fill-in that enabling
 * applies.
 */

export type AlertFixtureOptions = {
  /** Times to switch on. Everything else stays off. */
  readonly on?: readonly PrayerKey[];
  /** Repeat days for the switched-on times. Defaults to all seven, as enabling does. */
  readonly days?: readonly number[];
  readonly preReminderMinutes?: PreReminderMinutes;
  readonly sound?: AlertSoundChoice;
};

export function alertSettingsFixture(
  options: AlertFixtureOptions = {},
): readonly PrayerAlertSettings[] {
  const on = options.on ?? [];
  return defaultAllAlertSettings().map((settings) => {
    if (!on.includes(settings.time)) {
      return settings;
    }
    const enabled = enableSettings(settings);
    return {
      ...enabled,
      repeatDays: options.days ?? enabled.repeatDays,
      preReminderMinutes: options.preReminderMinutes ?? enabled.preReminderMinutes,
      sound: options.sound ?? enabled.sound,
    };
  });
}

/** Shorthand for the common case: these times on, every day, no pre-reminder, system sound. */
export function alertsFor(...on: readonly PrayerKey[]): readonly PrayerAlertSettings[] {
  return alertSettingsFixture({ on });
}
