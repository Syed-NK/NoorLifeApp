import AsyncStorage from '@react-native-async-storage/async-storage';

import { alertSettingsFixture, alertsFor } from '@/test-support/prayer-alert-fixtures';

import { createFakeNotificationPort } from '../data/notifications/fake-notification.port';
import {
  MAX_PENDING_ALERTS,
  planPrayerAlerts,
  plannedAlertKey,
  prayerAlertContent,
  scheduleFingerprint,
  SCHEDULE_CONTRACT_VERSION,
  SCHEDULE_HORIZON_DAYS,
} from '../data/notifications/prayer-alert-plan';
import {
  ALERT_SOUND_CHOICES,
  alertSoundLabel,
  canEverPlayFullAdhan,
  defaultAllAlertSettings,
  enableSettings,
  EVERY_DAY,
  isObligatory,
  NOTIFIABLE_TIMES,
  normaliseAllAlertSettings,
  normaliseRepeatDays,
  PRE_REMINDER_CHOICES,
  preReminderLabel,
  repeatDaysLabel,
  weekdayOfCalendarDate,
  WEEKDAYS,
} from '../data/notifications/prayer-alert-preferences';
import {
  fullAdhanAvailability,
  prayerAlertChannelId,
  prayerAlertSoundLabel,
  PRAYER_ALERT_SILENT_CHANNEL_ID,
} from '../data/notifications/prayer-alert-sound';
import {
  channelIdFor,
  prayerAlertChannel,
  prayerAlertSilentChannel,
  reconcilePrayerAlerts,
} from '../data/notifications/prayer-notifications.service';
import { migratePrayerAlerts, readFaithPreferences } from '../storage/faith-preferences';
import { setActiveFaithScope } from '../storage/faith-user-scope';
import type {
  DailyPrayerTimes,
  PrayerCalculationSettings,
  PrayerKey,
  PrayerLocation,
  PrayerTimesRepository,
} from '../data/prayer-times.repository';

/**
 * Per-time prayer notification settings: repeat days, pre-reminders, sound, and sunrise.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── What this file is for ──────────────────────────────────────────────────
 * `prayer-notifications.test.ts` covers the scheduler's own contract — atomic replacement, rollback,
 * reconciliation, the fingerprint. This file covers what was added around it: six notifiable times
 * instead of five, a day-of-week filter, a pre-reminder, a sound choice, and a ceiling on how many
 * alerts may be pending at once.
 *
 * ── Everything here is deterministic ───────────────────────────────────────
 * No clock is read. The fixture's seven days are 13–19 August 2026, which happen to be Thursday
 * through Wednesday — every weekday exactly once — so a repeat-day assertion can name a day and
 * check the date it lands on rather than counting.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const MAKKAH: PrayerLocation = {
  coordinate: { latitude: 21.4225, longitude: 39.8262 },
  label: 'Makkah, Saudi Arabia',
  timeZone: 'Asia/Riyadh',
  mode: 'device',
  resolvedAt: '2026-08-13T00:00:00.000Z',
};

const SETTINGS: PrayerCalculationSettings = {
  method: 'muslim-world-league',
  asr: 'standard',
  offsetsMinutes: {},
};

/** 13 August 2026 is a Thursday, so `dayFor(0..6)` is Thu, Fri, Sat, Sun, Mon, Tue, Wed. */
const WEEKDAY_OF_DAY_INDEX = [4, 5, 6, 0, 1, 2, 3] as const;

function dayFor(dayIndex: number): DailyPrayerTimes {
  const date = new Date(Date.UTC(2026, 7, 13 + dayIndex));
  const iso = date.toISOString().slice(0, 10);
  const at = (hour: number, minute: number): string =>
    `${iso}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+03:00`;
  return {
    date: iso,
    hijriDate: '28 Safar 1448 AH',
    location: MAKKAH,
    settings: SETTINGS,
    times: [
      { key: 'fajr', label: 'Fajr', at: at(4, 45) },
      { key: 'sunrise', label: 'Sunrise', at: at(6, 23) },
      { key: 'dhuhr', label: 'Dhuhr', at: at(12, 14) },
      { key: 'asr', label: 'Asr', at: at(15, 40) },
      { key: 'maghrib', label: 'Maghrib', at: at(18, 55) },
      { key: 'isha', label: 'Isha', at: at(20, 25) },
    ],
  };
}

const WEEK = Array.from({ length: SCHEDULE_HORIZON_DAYS }, (_unused, index) => dayFor(index));
/** Before the first day's Fajr, so nothing in the horizon has passed. */
const BEFORE_ANY = Date.parse('2026-08-13T00:30:00+03:00');

function repository(): PrayerTimesRepository {
  let call = 0;
  return {
    resolveCurrentLocation: async () => ({ kind: 'ok', data: MAKKAH }),
    refreshDeviceLocation: async () => ({ kind: 'error', code: 'unavailable' }),
    previewLocation: () => MAKKAH,
    saveCoordinateLocation: async () => ({ kind: 'ok', data: MAKKAH }),
    switchToDeviceLocation: async () => ({ kind: 'error', code: 'unavailable' }),
    getActiveLocationMode: async () => 'device',
    locationCalendarDay: () => '2026-08-13',
    searchCities: async () => ({ kind: 'no-results', query: '' }),
    previewCity: async () => ({ kind: 'error', code: 'unavailable' }),
    saveCityLocation: async () => ({ kind: 'error', code: 'unavailable' }),
    getDailyTimes: async () => {
      const day = dayFor(call);
      call += 1;
      return { kind: 'ok', data: day };
    },
    getMonthlyTimes: async () => ({ kind: 'ok', data: [] }),
    getNextPrayer: async () => ({ kind: 'error', code: 'unavailable' }),
  };
}

/*
  The stored schedule is real storage, and it is what reconciliation compares against. Without
  this, one case’s schedule is the next case’s stale record: the fingerprint matches, the
  identifiers do not, and reconciliation correctly rebuilds — which looks like a duplication bug
  in whichever case happens to run second.
*/
beforeEach(async () => {
  await AsyncStorage.clear();
});

const plan = (input: Parameters<typeof planPrayerAlerts>[0]) => planPrayerAlerts(input);
const alertsOf = (input: Parameters<typeof planPrayerAlerts>[0]) => planPrayerAlerts(input).alerts;

// ─────────────────────────────────────────────────────────────────────────────
// The six times, and the one that is not a prayer
// ─────────────────────────────────────────────────────────────────────────────

describe('all six of the day’s times are notifiable, and only five are prayers', () => {
  it('offers every time the day has, in the order the day runs', () => {
    expect(NOTIFIABLE_TIMES).toEqual(['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha']);
  });

  it('treats sunrise as a marker rather than a prayer', () => {
    expect(isObligatory('sunrise')).toBe(false);
    for (const time of NOTIFIABLE_TIMES.filter((entry) => entry !== 'sunrise')) {
      expect(isObligatory(time)).toBe(true);
    }
  });

  it.each(NOTIFIABLE_TIMES)('%s can never play a full adhān unless it is a prayer', (time) => {
    /*
      Two different reasons, and the type keeps them apart: sunrise is refused permanently, while the
      five are refused only until a licensed recording exists.
    */
    expect(canEverPlayFullAdhan(time)).toBe(isObligatory(time));
  });

  it('has no licensed adhān, so no time can play one today', () => {
    const adhan = fullAdhanAvailability();
    expect(adhan.available).toBe(false);
    expect(adhan.reason).toMatch(/no licensed adh/i);
  });

  it('never lets a sound label call a system chime an adhān', () => {
    for (const choice of ALERT_SOUND_CHOICES) {
      expect(alertSoundLabel(choice)).not.toMatch(/adh[aā]n|azan/i);
    }
    expect(prayerAlertSoundLabel()).not.toMatch(/adh[aā]n|azan/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Defaults
// ─────────────────────────────────────────────────────────────────────────────

describe('nothing is on until the user switches it on', () => {
  it('defaults every time to off, with no days, no pre-reminder and the system sound', () => {
    const defaults = defaultAllAlertSettings();
    expect(defaults).toHaveLength(6);
    for (const settings of defaults) {
      expect(settings.notify).toBe(false);
      expect(settings.repeatDays).toEqual([]);
      expect(settings.preReminderMinutes).toBe(0);
      expect(settings.sound).toBe('system-default');
    }
  });

  it('fills in all seven days only when a time is enabled', () => {
    const [fajr] = defaultAllAlertSettings();
    expect(fajr?.repeatDays).toEqual([]);
    expect(enableSettings(fajr!).repeatDays).toEqual(EVERY_DAY);
  });

  it('keeps the days a user chose when they switch a time back on', () => {
    // Switching off is pausing something you want back the way you had it.
    const chosen = { ...enableSettings(defaultAllAlertSettings()[0]!), repeatDays: [5] };
    const off = { ...chosen, notify: false };
    expect(enableSettings(off).repeatDays).toEqual([5]);
  });

  it('schedules nothing at all from the defaults', () => {
    expect(alertsOf({ days: WEEK, alerts: defaultAllAlertSettings(), nowMs: BEFORE_ANY })).toEqual(
      [],
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Repeat days
// ─────────────────────────────────────────────────────────────────────────────

describe('repeat days decide which calendar days get an alert', () => {
  it('reads a weekday from the location’s own calendar date, not from a device clock', () => {
    for (const [index, weekday] of WEEKDAY_OF_DAY_INDEX.entries()) {
      expect(weekdayOfCalendarDate(dayFor(index).date)).toBe(weekday);
    }
  });

  it('refuses a date it cannot read rather than guessing one', () => {
    for (const bad of ['', 'tomorrow', '2026-8-13', '20260813', '2026-13-01', '2026-02-30']) {
      expect(weekdayOfCalendarDate(bad)).toBeNull();
    }
  });

  it.each(WEEKDAYS)('schedules only on $name when only $name is selected', (day) => {
    const alerts = alertsOf({
      days: WEEK,
      alerts: alertSettingsFixture({ on: ['fajr'], days: [day.index] }),
      nowMs: BEFORE_ANY,
    });

    // Exactly one day of the seven matches, because the fixture week covers each weekday once.
    expect(alerts).toHaveLength(1);
    expect(weekdayOfCalendarDate(alerts[0]!.calendarDate)).toBe(day.index);
  });

  it('schedules all seven when every day is selected', () => {
    const alerts = alertsOf({ days: WEEK, alerts: alertsFor('fajr'), nowMs: BEFORE_ANY });
    expect(alerts).toHaveLength(7);
    expect(new Set(alerts.map((alert) => weekdayOfCalendarDate(alert.calendarDate))).size).toBe(7);
  });

  it('schedules nothing when a time is on but no day is selected', () => {
    /*
      Preserved rather than reinterpreted. "On, but no days" is a strange thing to mean, and guessing
      that the user meant every day would deliver notifications they switched off one at a time.
    */
    const alerts = alertsOf({
      days: WEEK,
      alerts: alertSettingsFixture({ on: ['fajr'], days: [] }),
      nowMs: BEFORE_ANY,
    });
    expect(alerts).toEqual([]);
  });

  it('normalises a stored day list rather than trusting it', () => {
    expect(normaliseRepeatDays([3, 3, 1, 1, 0])).toEqual([0, 1, 3]);
    expect(normaliseRepeatDays([7, -1, 1.5, '2', null, undefined, NaN])).toEqual([]);
    expect(normaliseRepeatDays('every day')).toEqual([]);
  });

  it('summarises a selection in words', () => {
    expect(repeatDaysLabel(EVERY_DAY)).toBe('Every day');
    expect(repeatDaysLabel([])).toBe('No days');
    expect(repeatDaysLabel([1, 5])).toBe('Mon, Fri');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Pre-reminders
// ─────────────────────────────────────────────────────────────────────────────

describe('the pre-reminder is a second alert at a subtracted instant', () => {
  it('offers exactly None, 5, 10, 15 and 30 minutes', () => {
    expect(PRE_REMINDER_CHOICES).toEqual([0, 5, 10, 15, 30]);
    expect(preReminderLabel(0)).toBe('None');
    expect(PRE_REMINDER_CHOICES.filter((minutes) => minutes > 0).map(preReminderLabel)).toEqual([
      '5 minutes',
      '10 minutes',
      '15 minutes',
      '30 minutes',
    ]);
  });

  it('adds nothing when the choice is None', () => {
    const alerts = alertsOf({
      days: [dayFor(0)],
      alerts: alertSettingsFixture({ on: ['fajr'], preReminderMinutes: 0 }),
      nowMs: BEFORE_ANY,
    });
    expect(alerts.map((alert) => alert.type)).toEqual(['time']);
  });

  it.each(PRE_REMINDER_CHOICES.filter((minutes) => minutes > 0))(
    'fires exactly %s minutes before the prayer',
    (minutes) => {
      const alerts = alertsOf({
        days: [dayFor(0)],
        alerts: alertSettingsFixture({ on: ['fajr'], preReminderMinutes: minutes }),
        nowMs: BEFORE_ANY,
      });

      const atTime = alerts.find((alert) => alert.type === 'time');
      const before = alerts.find((alert) => alert.type === 'pre');
      expect(atTime).toBeDefined();
      expect(before).toBeDefined();
      /*
        Subtracted from the repository's own instant, so a changed calculation method moves the
        pre-reminder by exactly as much as it moves the prayer. Asserted in milliseconds rather than
        by re-deriving a wall clock, which would be this test writing the production arithmetic twice.
      */
      expect(Date.parse(atTime!.at) - Date.parse(before!.at)).toBe(minutes * 60_000);
      expect(before!.minutesBefore).toBe(minutes);
      expect(prayerAlertContent(before!).body).toBe(`Fajr begins in ${minutes} minutes.`);
    },
  );

  it('drops a pre-reminder that has already passed while keeping the prayer', () => {
    // Two minutes before Fajr: the ten-minute heads-up is behind us, the prayer is not.
    const justBeforeFajr = Date.parse('2026-08-13T04:43:00+03:00');
    const alerts = alertsOf({
      days: [dayFor(0)],
      alerts: alertSettingsFixture({ on: ['fajr'], preReminderMinutes: 10 }),
      nowMs: justBeforeFajr,
    });
    expect(alerts.map((alert) => alert.type)).toEqual(['time']);
  });

  it('gives the two alerts distinct identities so one can be cancelled without the other', () => {
    const alerts = alertsOf({
      days: [dayFor(0)],
      alerts: alertSettingsFixture({ on: ['fajr'], preReminderMinutes: 15 }),
      nowMs: BEFORE_ANY,
    });

    expect(alerts.map((alert) => alert.key)).toEqual([
      plannedAlertKey('2026-08-13', 'fajr', 'pre'),
      plannedAlertKey('2026-08-13', 'fajr', 'time'),
    ]);
    expect(new Set(alerts.map((alert) => alert.key)).size).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The pending ceiling
// ─────────────────────────────────────────────────────────────────────────────

describe('the pending count is bounded, and says when it was cut short', () => {
  /*
    ── Why a ceiling exists at all ─────────────────────────────────────────────
    iOS allows an app 64 pending local notifications and silently drops the rest — the *later* ones,
    so the loss is invisible for days and then a prayer is missed. Five prayers over seven days was
    35 and could never reach it. Six times with pre-reminders over seven days is 84, and can.
  */
  it('keeps the ceiling below the platform limit with room to spare', () => {
    expect(MAX_PENDING_ALERTS).toBeLessThan(64);
    expect(MAX_PENDING_ALERTS).toBeGreaterThanOrEqual(7 * 6);
  });

  it('would exceed the ceiling if it were not applied', () => {
    // The unbounded shape, stated so the ceiling is not protecting against a hypothetical.
    const everything = alertSettingsFixture({ on: NOTIFIABLE_TIMES, preReminderMinutes: 10 });
    const uncapped = plan({
      days: WEEK,
      alerts: everything,
      nowMs: BEFORE_ANY,
      maxPending: 1000,
    });
    expect(uncapped.alerts).toHaveLength(6 * 2 * 7);
    expect(uncapped.alerts.length).toBeGreaterThan(64);
    expect(uncapped.truncated).toBe(false);
  });

  it('keeps the soonest alerts and reports the truncation', () => {
    const everything = alertSettingsFixture({ on: NOTIFIABLE_TIMES, preReminderMinutes: 10 });
    const capped = plan({ days: WEEK, alerts: everything, nowMs: BEFORE_ANY });

    expect(capped.alerts).toHaveLength(MAX_PENDING_ALERTS);
    expect(capped.truncated).toBe(true);

    // Chronological, and the ones kept are the earliest — never a sample from across the week.
    const instants = capped.alerts.map((alert) => Date.parse(alert.at));
    expect(instants).toEqual([...instants].sort((a, b) => a - b));

    const uncapped = plan({ days: WEEK, alerts: everything, nowMs: BEFORE_ANY, maxPending: 1000 });
    expect(capped.alerts.map((alert) => alert.key)).toEqual(
      uncapped.alerts.slice(0, MAX_PENDING_ALERTS).map((alert) => alert.key),
    );
  });

  it('reports the date coverage actually reaches, which is not always the horizon', () => {
    const everything = alertSettingsFixture({ on: NOTIFIABLE_TIMES, preReminderMinutes: 10 });
    const capped = plan({ days: WEEK, alerts: everything, nowMs: BEFORE_ANY });
    const full = plan({ days: WEEK, alerts: alertsFor('fajr'), nowMs: BEFORE_ANY });

    /*
      The whole reason `coversThrough` is reported rather than inferred: a screen saying "the next 7
      days" would be wrong for the first of these and right for the second.
    */
    expect(capped.coversThrough).not.toBeNull();
    expect(capped.coversThrough! < WEEK[6]!.date).toBe(true);
    expect(full.coversThrough).toBe(WEEK[6]!.date);
    expect(full.truncated).toBe(false);
  });

  it('reports no coverage when nothing is planned', () => {
    const empty = plan({ days: WEEK, alerts: defaultAllAlertSettings(), nowMs: BEFORE_ANY });
    expect(empty.coversThrough).toBeNull();
    expect(empty.truncated).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Sound, and the channel it implies
// ─────────────────────────────────────────────────────────────────────────────

describe('a silent alert goes to its own Android channel', () => {
  /*
    ── Why this cannot be a flag on the notification ───────────────────────────
    On Android a notification's sound belongs to its *channel*, and a channel's sound is fixed when
    it is created. `NotificationCompat.Builder.setSound()` — which is what a per-notification sound
    reaches — has been ignored since API 26. So "Silent" is a second channel or it is a lie.
  */
  it('routes by the choice, and the two channels are different', () => {
    expect(channelIdFor(false)).toBe(prayerAlertChannel().id);
    expect(channelIdFor(true)).toBe(PRAYER_ALERT_SILENT_CHANNEL_ID);
    expect(channelIdFor(true)).not.toBe(channelIdFor(false));
  });

  it('marks the silent channel silent, and the ordinary one not', () => {
    /*
      `silent` is distinct from `soundFile === null`: a null file means "the platform's default
      sound", and silence means "no sound". The port sends an explicit `sound: null` only for the
      former, and one keystroke apart is the difference between a prayer alert and no prayer alert.
    */
    expect(prayerAlertSilentChannel().silent).toBe(true);
    expect(prayerAlertSilentChannel().soundFile).toBeNull();
    expect(prayerAlertChannel().silent).toBe(false);
    expect(prayerAlertChannel().soundFile).toBeNull();
  });

  it('keeps the ordinary channel at high importance and the silent one lower', () => {
    // A heads-up banner that makes no sound is a strange thing to ask for; `high` is what makes one.
    expect(prayerAlertChannel().importance).toBe('high');
    expect(prayerAlertSilentChannel().importance).toBe('default');
  });

  it('still versions the ordinary channel id by its sound', () => {
    expect(prayerAlertChannelId({ kind: 'platform-default' })).toBe('prayer-alerts-v1-default');
    expect(prayerAlertChannelId({ kind: 'bundled-azan', file: 'x.wav', label: 'X' })).not.toBe(
      prayerAlertChannelId({ kind: 'platform-default' }),
    );
  });

  it('marks each planned alert silent according to its own time’s choice', () => {
    const alerts = alertsOf({
      days: [dayFor(0)],
      alerts: [
        ...alertSettingsFixture({ on: ['fajr'], sound: 'silent' }).filter(
          (entry) => entry.time === 'fajr',
        ),
        ...alertSettingsFixture({ on: ['dhuhr'], sound: 'system-default' }).filter(
          (entry) => entry.time !== 'fajr',
        ),
      ],
      nowMs: BEFORE_ANY,
    });

    expect(alerts.find((alert) => alert.prayer === 'fajr')?.silent).toBe(true);
    expect(alerts.find((alert) => alert.prayer === 'dhuhr')?.silent).toBe(false);
  });

  it('creates the silent channel only when something asks for silence', async () => {
    const quiet = createFakeNotificationPort({ permission: 'granted' });
    await reconcilePrayerAlerts(
      { prayerTimes: repository(), notifications: quiet, now: () => new Date(BEFORE_ANY) },
      {
        masterEnabled: true,
        alerts: alertSettingsFixture({ on: ['fajr'], sound: 'silent' }),
        settings: SETTINGS,
      },
    );
    expect(quiet.channels().map((channel) => channel.id)).toContain(PRAYER_ALERT_SILENT_CHANNEL_ID);

    const loud = createFakeNotificationPort({ permission: 'granted' });
    await reconcilePrayerAlerts(
      { prayerTimes: repository(), notifications: loud, now: () => new Date(BEFORE_ANY) },
      { masterEnabled: true, alerts: alertsFor('fajr'), settings: SETTINGS },
    );
    /*
      A user who never chooses Silent must not find a second "Prayer alerts (silent)" category in
      their system settings — an Android channel cannot be withdrawn quietly once they have seen it.
    */
    expect(loud.channels().map((channel) => channel.id)).not.toContain(
      PRAYER_ALERT_SILENT_CHANNEL_ID,
    );
  });

  it('sends every silent alert to the silent channel and marks the request silent', async () => {
    const notifications = createFakeNotificationPort({ permission: 'granted' });
    await reconcilePrayerAlerts(
      { prayerTimes: repository(), notifications, now: () => new Date(BEFORE_ANY) },
      {
        masterEnabled: true,
        alerts: alertSettingsFixture({ on: ['fajr'], sound: 'silent' }),
        settings: SETTINGS,
      },
    );

    expect(notifications.requests()).not.toHaveLength(0);
    for (const request of notifications.requests()) {
      expect(request.channelId).toBe(PRAYER_ALERT_SILENT_CHANNEL_ID);
      // Inert on Android, decisive on iOS, and sent on both so the request states what it wants.
      expect(request.silent).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Notification content
// ─────────────────────────────────────────────────────────────────────────────

describe('what a notification says, and what it must never carry', () => {
  it('names the prayer and states the time has come, with no clock', () => {
    const [alert] = alertsOf({ days: [dayFor(0)], alerts: alertsFor('dhuhr'), nowMs: BEFORE_ANY });
    expect(prayerAlertContent(alert!)).toEqual({
      title: 'Dhuhr prayer time',
      body: 'It is time for Dhuhr.',
    });
  });

  it('never prints a wall clock, a place or a coordinate in the words', () => {
    /*
      The clock used to be in the title. It is gone: a notification is readable from a lock screen by
      whoever is holding the phone, and a prayer time is a good enough clue to a city to be worth not
      printing. It is also simply truer — a time that may be a minute stale is a claim.
    */
    const everything = alertSettingsFixture({ on: NOTIFIABLE_TIMES, preReminderMinutes: 15 });
    for (const alert of alertsOf({ days: WEEK, alerts: everything, nowMs: BEFORE_ANY })) {
      const { title, body } = prayerAlertContent(alert);
      const text = `${title} ${body}`;
      expect(text).not.toMatch(/\d{1,2}:\d{2}/);
      expect(text).not.toMatch(/Makkah|Riyadh|Saudi/i);
      expect(text).not.toMatch(/-?\d+\.\d{3,}/);
      expect(text).not.toMatch(/muslim-world-league|umm-al-qura|hanafi|standard/i);
    }
  });

  it('carries only the prayer, the date and the kind in the payload', async () => {
    const notifications = createFakeNotificationPort({ permission: 'granted' });
    await reconcilePrayerAlerts(
      { prayerTimes: repository(), notifications, now: () => new Date(BEFORE_ANY) },
      {
        masterEnabled: true,
        alerts: alertSettingsFixture({ on: ['fajr'], preReminderMinutes: 10 }),
        settings: SETTINGS,
      },
    );

    expect(notifications.requests()).not.toHaveLength(0);
    for (const request of notifications.requests()) {
      expect(Object.keys(request.data).sort()).toEqual(['date', 'kind', 'prayer']);
      /* No account, no coordinate, no zone, no method — a payload is readable by anything. */
      expect(JSON.stringify(request.data)).not.toMatch(/21\.4|39\.8|Riyadh|Makkah|user|account/i);
    }
    /* Both kinds appear, and nothing else does. A set, because there are seven days of each. */
    expect(new Set(notifications.requests().map((request) => request.data.kind))).toEqual(
      new Set(['prayer-alert', 'prayer-pre-alert']),
    );
  });

  it('keeps the account out of the identifier keys as well', () => {
    /*
      Separation of accounts is the *storage key's* job — the schedule record lives under the
      signed-in user's own namespace. Repeating it in the alert key would put a user id into a value
      that has no reason to hold one.
    */
    const key = plannedAlertKey('2026-08-13', 'fajr', 'time');
    expect(key).toBe('2026-08-13:fajr:time');
    expect(key).not.toMatch(/user|account|@|[0-9a-f]{8}-/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The fingerprint, extended
// ─────────────────────────────────────────────────────────────────────────────

describe('a changed choice reschedules rather than waiting for the horizon to age', () => {
  const base = {
    latitude: 21.4225,
    longitude: 39.8262,
    timeZone: 'Asia/Riyadh',
    offsetMinutes: 180,
    method: 'muslim-world-league',
    asr: 'standard',
    offsetsMinutes: {},
    alerts: alertsFor('fajr', 'dhuhr', 'asr', 'maghrib', 'isha'),
    horizonDays: SCHEDULE_HORIZON_DAYS,
    maxPending: MAX_PENDING_ALERTS,
  };

  it.each([
    ['a repeat day removed', alertSettingsFixture({ on: ['fajr'], days: [1, 2, 3, 4, 5, 6] })],
    ['a pre-reminder chosen', alertSettingsFixture({ on: ['fajr'], preReminderMinutes: 10 })],
    ['a different pre-reminder', alertSettingsFixture({ on: ['fajr'], preReminderMinutes: 30 })],
    ['a sound changed to silent', alertSettingsFixture({ on: ['fajr'], sound: 'silent' })],
    ['sunrise switched on', alertsFor('fajr', 'sunrise')],
  ])('changes on %s', (_name, alerts) => {
    const one = scheduleFingerprint({ ...base, alerts: alertsFor('fajr') });
    expect(scheduleFingerprint({ ...base, alerts })).not.toBe(one);
  });

  it('is unchanged when nothing about the choices moved', () => {
    expect(scheduleFingerprint({ ...base, alerts: alertsFor('fajr') })).toBe(
      scheduleFingerprint({ ...base, alerts: alertsFor('fajr') }),
    );
  });

  it('carries a contract version, so an upgrade cannot trust old identifiers', () => {
    /*
      Bumped to 2 by this work: the identifier keys gained a type segment, the bodies lost their
      clock, and a silent alert goes to a different channel. An install holding version 1 keys can no
      longer interpret them, so it must reschedule rather than reconcile against them.
    */
    expect(SCHEDULE_CONTRACT_VERSION).toBe(2);
    expect(scheduleFingerprint(base).startsWith(`v${SCHEDULE_CONTRACT_VERSION}|`)).toBe(true);
  });

  it('includes the ceiling, so lowering it reschedules', () => {
    expect(scheduleFingerprint({ ...base, maxPending: 20 })).not.toBe(scheduleFingerprint(base));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Corrupt and missing data
// ─────────────────────────────────────────────────────────────────────────────

describe('corrupt settings fail closed', () => {
  it.each([
    ['not an array', 'every day'],
    ['a null', null],
    ['an array of nulls', [null, null]],
    ['entries with no time', [{ notify: true, repeatDays: [0] }]],
    ['a time this build does not know', [{ time: 'tahajjud', notify: true, repeatDays: [0] }]],
  ])('turns %s into six switched-off times', (_name, stored) => {
    const normalised = normaliseAllAlertSettings(stored);
    expect(normalised.map((entry) => entry.time)).toEqual(NOTIFIABLE_TIMES);
    expect(normalised.every((entry) => !entry.notify)).toBe(true);
    expect(alertsOf({ days: WEEK, alerts: normalised, nowMs: BEFORE_ANY })).toEqual([]);
  });

  it('repairs a readable entry rather than discarding it', () => {
    const normalised = normaliseAllAlertSettings([
      { time: 'fajr', notify: true, repeatDays: [9, 1, 1], preReminderMinutes: 7, sound: 'brass' },
    ]);
    const fajr = normalised.find((entry) => entry.time === 'fajr');
    expect(fajr?.notify).toBe(true);
    /* The choices that could not be honoured fall back; the one that could is kept. */
    expect(fajr?.repeatDays).toEqual([1]);
    expect(fajr?.preReminderMinutes).toBe(0);
    expect(fajr?.sound).toBe('system-default');
  });

  it('keeps one entry per time when storage holds a time twice', () => {
    const normalised = normaliseAllAlertSettings([
      { time: 'fajr', notify: true, repeatDays: [0] },
      { time: 'fajr', notify: false, repeatDays: [] },
    ]);
    expect(normalised.filter((entry) => entry.time === 'fajr')).toHaveLength(1);
    expect(normalised).toHaveLength(6);
  });

  it('schedules nothing from a day the repository could not date', () => {
    const undated: DailyPrayerTimes = { ...dayFor(0), date: 'not-a-date' };
    expect(alertsOf({ days: [undated], alerts: alertsFor('fajr'), nowMs: BEFORE_ANY })).toEqual([]);
  });

  it('skips a time the day does not contain, without dropping the rest', () => {
    // A polar day where `adhan` reports no Fajr at all.
    const partial: DailyPrayerTimes = {
      ...dayFor(0),
      times: dayFor(0).times.filter((time) => time.key !== 'fajr'),
    };
    const alerts = alertsOf({
      days: [partial],
      alerts: alertsFor('fajr', 'dhuhr'),
      nowMs: BEFORE_ANY,
    });
    expect(alerts.map((alert) => alert.prayer)).toEqual(['dhuhr']);
  });

  it('skips an instant that will not parse', () => {
    const broken: DailyPrayerTimes = {
      ...dayFor(0),
      times: dayFor(0).times.map((time) =>
        time.key === 'fajr' ? { ...time, at: 'whenever' } : time,
      ),
    };
    const alerts = alertsOf({
      days: [broken],
      alerts: alertsFor('fajr', 'dhuhr'),
      nowMs: BEFORE_ANY,
    });
    expect(alerts.map((alert) => alert.prayer)).toEqual(['dhuhr']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Migration from the field
// ─────────────────────────────────────────────────────────────────────────────

describe('the stored preference migrates without inventing a notification', () => {
  it('carries which prayers were on, and gives them every day', () => {
    /*
      A user whose Fajr was on was being alerted every day, so every day is what preserving their
      state means. Anything narrower would silently reduce what they had.
    */
    const migrated = migratePrayerAlerts(undefined, [
      { prayer: 'fajr', enabled: true, minutesBefore: 10 },
      { prayer: 'asr', enabled: false, minutesBefore: 10 },
    ]);

    const fajr = migrated.find((entry) => entry.time === 'fajr');
    expect(fajr?.notify).toBe(true);
    expect(fajr?.repeatDays).toEqual(EVERY_DAY);
    expect(migrated.find((entry) => entry.time === 'asr')?.notify).toBe(false);
  });

  it('refuses to turn the old dead `minutesBefore` into a real pre-reminder', () => {
    /*
      ── The point of the whole migration ──────────────────────────────────────
      `minutesBefore` defaulted to 10, was stored on every install, and was read by nothing — no
      pre-reminder was ever scheduled from it. Carrying it into a field that now works would start
      delivering a second notification ten minutes before every prayer to people who never asked for
      one, on upgrade, with no interaction. So it is dropped, and the pre-reminder starts at None.
    */
    const migrated = migratePrayerAlerts(undefined, [
      { prayer: 'fajr', enabled: true, minutesBefore: 10 },
      { prayer: 'dhuhr', enabled: true, minutesBefore: 30 },
    ]);
    expect(migrated.every((entry) => entry.preReminderMinutes === 0)).toBe(true);
  });

  it('adds sunrise, switched off, to a blob written before it existed', () => {
    const migrated = migratePrayerAlerts(undefined, [
      { prayer: 'fajr', enabled: true, minutesBefore: 0 },
    ]);
    const sunrise = migrated.find((entry) => entry.time === 'sunrise');
    expect(sunrise).toBeDefined();
    expect(sunrise?.notify).toBe(false);
    expect(sunrise?.repeatDays).toEqual([]);
  });

  it('prefers a current array over the legacy one', () => {
    const migrated = migratePrayerAlerts(
      [{ time: 'isha', notify: true, repeatDays: [2], preReminderMinutes: 15, sound: 'silent' }],
      [{ prayer: 'fajr', enabled: true, minutesBefore: 10 }],
    );
    expect(migrated.find((entry) => entry.time === 'isha')).toEqual({
      time: 'isha',
      notify: true,
      repeatDays: [2],
      preReminderMinutes: 15,
      sound: 'silent',
      /*
        The stored record predates modes and carries no `mode` key, so it reads as the default —
        which is exactly the behaviour it already had. That is what makes the upgrade inaudible:
        this record keeps its silent notification and gains nothing it did not ask for (#178).
      */
      mode: 'notification-only',
    });
    expect(migrated.find((entry) => entry.time === 'fajr')?.notify).toBe(false);
  });

  it('falls back to everything off when neither shape is readable', () => {
    for (const stored of [undefined, null, 'nonsense', 42]) {
      const migrated = migratePrayerAlerts(undefined, stored);
      expect(migrated).toHaveLength(6);
      expect(migrated.every((entry) => !entry.notify)).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Master switch and permission
// ─────────────────────────────────────────────────────────────────────────────

describe('the master switch and the OS permission are separate gates', () => {
  it('cancels everything and schedules nothing while the master is off', async () => {
    const notifications = createFakeNotificationPort({ permission: 'granted' });
    const status = await reconcilePrayerAlerts(
      { prayerTimes: repository(), notifications, now: () => new Date(BEFORE_ANY) },
      { masterEnabled: false, alerts: alertsFor(...NOTIFIABLE_TIMES), settings: SETTINGS },
    );

    expect(notifications.pending()).toEqual([]);
    expect(status.schedule.kind).toBe('none');
    /* The per-time choices are untouched: the status still reports which times are switched on. */
    expect(status.enabledPrayers).toEqual(NOTIFIABLE_TIMES);
  });

  it('schedules nothing without permission and keeps every choice', async () => {
    const notifications = createFakeNotificationPort({ permission: 'denied' });
    const status = await reconcilePrayerAlerts(
      { prayerTimes: repository(), notifications, now: () => new Date(BEFORE_ANY) },
      {
        masterEnabled: true,
        alerts: alertSettingsFixture({ on: ['fajr'], preReminderMinutes: 10 }),
        settings: SETTINGS,
      },
    );

    expect(notifications.pending()).toEqual([]);
    expect(notifications.calls()).not.toContain('requestPermission');
    expect(status.permission).toBe('denied');
    expect(status.enabledPrayers).toEqual(['fajr']);
  });

  it('never prompts as part of reconciling, whatever the settings say', async () => {
    const notifications = createFakeNotificationPort({ permission: 'undetermined' });
    await reconcilePrayerAlerts(
      { prayerTimes: repository(), notifications, now: () => new Date(BEFORE_ANY) },
      {
        masterEnabled: true,
        alerts: alertSettingsFixture({ on: NOTIFIABLE_TIMES, preReminderMinutes: 10 }),
        settings: SETTINGS,
      },
    );
    expect(notifications.calls()).not.toContain('requestPermission');
  });

  it('reports the coverage it achieved once it has scheduled', async () => {
    const notifications = createFakeNotificationPort({ permission: 'granted' });
    const status = await reconcilePrayerAlerts(
      { prayerTimes: repository(), notifications, now: () => new Date(BEFORE_ANY) },
      { masterEnabled: true, alerts: alertsFor('fajr'), settings: SETTINGS },
    );

    expect(status.schedule.kind).toBe('scheduled');
    if (status.schedule.kind === 'scheduled') {
      expect(status.schedule.count).toBe(SCHEDULE_HORIZON_DAYS);
      expect(status.schedule.truncated).toBe(false);
      expect(status.schedule.coversThrough).toBe(WEEK[6]!.date);
    }
  });

  it('reports truncation up to the screen when the ceiling bites', async () => {
    const notifications = createFakeNotificationPort({ permission: 'granted' });
    const status = await reconcilePrayerAlerts(
      { prayerTimes: repository(), notifications, now: () => new Date(BEFORE_ANY) },
      {
        masterEnabled: true,
        alerts: alertSettingsFixture({ on: NOTIFIABLE_TIMES, preReminderMinutes: 10 }),
        settings: SETTINGS,
      },
    );

    if (status.schedule.kind === 'scheduled') {
      expect(status.schedule.count).toBe(MAX_PENDING_ALERTS);
      expect(status.schedule.truncated).toBe(true);
    } else {
      throw new Error(`expected a schedule, got ${status.schedule.kind}`);
    }
  });

  it('creates nothing at all when nobody is signed in', async () => {
    /*
      ── Why this is safe rather than merely untested ─────────────────────────
      The schedule record and the preferences are both account-scoped, and with no signed-in owner
      `resolveFaithAddress` returns null: reads fall back to defaults and writes are dropped. The
      preference that gates everything — the master switch — defaults to **off**, so reconciliation
      takes the cancel-everything branch and schedules nothing.

      That ordering matters. If the master defaulted to on, a signed-out reconcile would schedule a
      full set, fail to record it, and schedule another full set on the next foreground — with
      nothing able to cancel the previous one, because the record is unreachable.
    */
    const notifications = createFakeNotificationPort({ permission: 'granted' });
    setActiveFaithScope(null);

    const preferences = await readFaithPreferences();
    expect(preferences.prayerNotificationsEnabled).toBe(false);

    const status = await reconcilePrayerAlerts(
      { prayerTimes: repository(), notifications, now: () => new Date(BEFORE_ANY) },
      {
        masterEnabled: preferences.prayerNotificationsEnabled,
        alerts: preferences.prayerAlerts,
        settings: SETTINGS,
      },
    );

    expect(notifications.pending()).toEqual([]);
    expect(status.schedule.kind).toBe('none');
    expect(status.enabledPrayers).toEqual([]);
  });

  it('creates no duplicates when the same settings are reconciled twice', async () => {
    const notifications = createFakeNotificationPort({ permission: 'granted' });
    const preferences = {
      masterEnabled: true,
      alerts: alertSettingsFixture({ on: ['fajr', 'sunrise'], preReminderMinutes: 5 }),
      settings: SETTINGS,
    };

    await reconcilePrayerAlerts(
      { prayerTimes: repository(), notifications, now: () => new Date(BEFORE_ANY) },
      preferences,
    );
    const first = notifications.pending().map((entry) => entry.identifier);

    await reconcilePrayerAlerts(
      { prayerTimes: repository(), notifications, now: () => new Date(BEFORE_ANY) },
      preferences,
    );

    expect(notifications.pending().map((entry) => entry.identifier)).toEqual(first);
    expect(new Set(first).size).toBe(first.length);
  });
});

/** Kept so the compiler proves the fixture list and the domain list cannot drift apart. */
const _everyTimeIsAPrayerKey: readonly PrayerKey[] = NOTIFIABLE_TIMES;
void _everyTimeIsAPrayerKey;
