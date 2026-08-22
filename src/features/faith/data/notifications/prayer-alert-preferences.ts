import { OBLIGATORY_PRAYERS, type PrayerKey } from '../prayer-times.repository';

/**
 * What the user has chosen for each of the day's six times.
 *
 * ── Why this is a domain module and not a screen's state ────────────────────
 * Three things need the same answers and must not each decide for themselves: the sheet that edits
 * them, the planner that turns them into alerts, and the migration that reads them back out of
 * storage. A repeat day the sheet believes is Sunday and the planner believes is Monday is a
 * notification at the wrong time, and nothing about either file would look wrong on its own.
 *
 * So the options, the defaults, the validation and the weekday arithmetic all live here, and every
 * one of them is exported for the tests that pin them.
 *
 * ── Sunrise is present, and is not a prayer ─────────────────────────────────
 * The five obligatory prayers and sunrise are all *notifiable*, because a reminder that the night's
 * prayer window is closing is a reasonable thing to want. What sunrise is not is a prayer: it may
 * never be announced as one, and it may never play a call to prayer. That distinction is enforced
 * here — `isNotifiable` admits it, `canPlayFullAdhan` refuses it — rather than by remembering to
 * filter it at each call site, which is how `OBLIGATORY_PRAYERS` came to exist in the first place.
 */

/**
 * Every time the user may be reminded about, in the order the day runs.
 *
 * Deliberately *not* `OBLIGATORY_PRAYERS`: that list is the domain's five, and the planner still
 * uses it to decide what may be called a prayer. This one is what may be switched on.
 */
export const NOTIFIABLE_TIMES: readonly PrayerKey[] = [
  'fajr',
  'sunrise',
  'dhuhr',
  'asr',
  'maghrib',
  'isha',
];

export function isNotifiable(time: PrayerKey): boolean {
  return NOTIFIABLE_TIMES.includes(time);
}

/** Whether this time is one of the five. Sunrise is the only member of the day that is not. */
export function isObligatory(time: PrayerKey): boolean {
  return OBLIGATORY_PRAYERS.includes(time);
}

/**
 * Whether a full call to prayer could ever be played for this time.
 *
 * Two separate reasons it is `false` today, and they must not be conflated:
 *
 *   - **Sunrise: never.** Not a technical limitation and not waiting on an asset. Sunrise is a clock
 *     reading; announcing it with an adhān would be announcing a prayer that does not exist.
 *   - **The five: not yet.** No licensed recording exists — see `fullAdhanAvailability` in
 *     `prayer-alert-sound.ts` and `docs/PRAYER_ALERT_AUDIO_REQUIREMENTS.md`.
 *
 * This function answers only the first. The second is the sound module's business, because it turns
 * on an asset and a licence rather than on which time of day it is.
 */
export function canEverPlayFullAdhan(time: PrayerKey): boolean {
  return isObligatory(time);
}

/**
 * Minutes before the time itself that a heads-up may be sent.
 *
 * `0` is "none" rather than "at the time", because there is already an alert at the time and a
 * second one zero minutes before it would be a duplicate. The planner reads 0 as "no pre-reminder".
 */
export const PRE_REMINDER_CHOICES = [0, 5, 10, 15, 30] as const;
export type PreReminderMinutes = (typeof PRE_REMINDER_CHOICES)[number];

export function isPreReminderChoice(value: unknown): value is PreReminderMinutes {
  return typeof value === 'number' && (PRE_REMINDER_CHOICES as readonly number[]).includes(value);
}

/** What the sheet calls each choice. Derived from the number so the two cannot disagree. */
export function preReminderLabel(minutes: PreReminderMinutes): string {
  return minutes === 0 ? 'None' : `${minutes} minutes`;
}

/**
 * The sound a prayer alert makes.
 *
 * Two members, and both are honest on both platforms — which is the whole reason there are only two.
 * A named adhān is absent rather than disabled here: the type is what the planner and the channel
 * derive from, and a member nothing can construct would be a third state every switch statement had
 * to handle for no user-visible gain. Full-adhān readiness is reported separately, by
 * `fullAdhanAvailability`.
 */
export const ALERT_SOUND_CHOICES = ['system-default', 'silent'] as const;
export type AlertSoundChoice = (typeof ALERT_SOUND_CHOICES)[number];

export function isAlertSoundChoice(value: unknown): value is AlertSoundChoice {
  return typeof value === 'string' && (ALERT_SOUND_CHOICES as readonly string[]).includes(value);
}

/**
 * What the sheet calls each sound.
 *
 * "System default" and "Silent", and neither is ever the word "Adhan" — a test asserts that, because
 * the one thing this label must never do is describe a system chime as a call to prayer.
 */
export function alertSoundLabel(choice: AlertSoundChoice): string {
  return choice === 'silent' ? 'Silent' : 'System default';
}

/**
 * Days of the week, Sunday first.
 *
 * ── Why the index is the JavaScript one, and why that is safe here ──────────
 * `0` is Sunday because that is what `Date.prototype.getUTCDay` returns, and the planner derives a
 * day's weekday from its `YYYY-MM-DD` calendar date **at the prayer location** by way of
 * `Date.UTC` — no device zone involved. Storing the same integers the arithmetic produces means
 * there is no mapping table to get wrong.
 *
 * The single-letter labels are for the seven-circle row; `name` is what a screen reader says, because
 * "T" is ambiguous and "S" is worse.
 */
export const WEEKDAYS: readonly {
  readonly index: number;
  readonly initial: string;
  readonly name: string;
}[] = [
  { index: 0, initial: 'S', name: 'Sunday' },
  { index: 1, initial: 'M', name: 'Monday' },
  { index: 2, initial: 'T', name: 'Tuesday' },
  { index: 3, initial: 'W', name: 'Wednesday' },
  { index: 4, initial: 'T', name: 'Thursday' },
  { index: 5, initial: 'F', name: 'Friday' },
  { index: 6, initial: 'S', name: 'Saturday' },
];

export const EVERY_DAY: readonly number[] = [0, 1, 2, 3, 4, 5, 6];

/**
 * The weekday of a calendar date, at the location that produced it.
 *
 * ── Why `Date.UTC` and a parsed string, rather than `new Date(iso).getDay()` ──
 * Because the date is already local to the prayer location — the repository produced it — and the
 * only thing left to do is read its weekday. Constructing a `Date` from the instant and asking the
 * *device* for the day is the defect this whole module was corrected for once already: a user in
 * Auckland reading a Makkah day would get the wrong answer for a third of every day.
 *
 * `Date.UTC` on the parsed parts is zone-free arithmetic on a calendar date, so it returns the
 * weekday of that date and nothing else. Returns `null` for anything that is not `YYYY-MM-DD`,
 * because a repeat-day filter that guesses is a notification on a day the user switched off.
 */
export function weekdayOfCalendarDate(calendarDate: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(calendarDate);
  if (match === null) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  const utc = new Date(Date.UTC(year, month - 1, day));
  /*
    A round-trip check, so 2026-02-30 is rejected rather than silently becoming 2 March. `Date.UTC`
    normalises overflow without complaint, and a date that normalised is not the date it claimed.
  */
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    return null;
  }
  return utc.getUTCDay();
}

/** How the sheet summarises a repeat-day selection. */
export function repeatDaysLabel(days: readonly number[]): string {
  const selected = normaliseRepeatDays(days);
  if (selected.length === 0) {
    return 'No days';
  }
  if (selected.length === 7) {
    return 'Every day';
  }
  return selected.map((day) => WEEKDAYS[day]?.name.slice(0, 3) ?? '').join(', ');
}

/** Sorted, de-duplicated, and free of anything that is not a weekday index. */
export function normaliseRepeatDays(days: unknown): readonly number[] {
  if (!Array.isArray(days)) {
    return [];
  }
  const kept = new Set<number>();
  for (const day of days) {
    if (typeof day === 'number' && Number.isInteger(day) && day >= 0 && day <= 6) {
      kept.add(day);
    }
  }
  return [...kept].sort((a, b) => a - b);
}

/**
 * One time's notification settings, as persisted.
 *
 * ── Why `notify` and `repeatDays` are both here, when either could imply the other ──
 * Because they answer different questions and the user changes them independently. Switching a
 * prayer off is pausing something you want back with the days you chose; clearing every day is
 * saying "not on any day", which is a stranger thing to mean and is preserved rather than
 * reinterpreted. The planner requires both — `notify` true *and* the day selected — so the two
 * cannot disagree about whether an alert fires.
 */
export type PrayerAlertSettings = {
  readonly time: PrayerKey;
  readonly notify: boolean;
  /** Weekday indices, Sunday `0`. Empty means no day, which schedules nothing. */
  readonly repeatDays: readonly number[];
  readonly preReminderMinutes: PreReminderMinutes;
  readonly sound: AlertSoundChoice;
};

/**
 * A time's settings before the user has touched it.
 *
 * Everything off, no days, no pre-reminder, system sound. **The days are empty rather than all
 * seven**, and the difference is the brief's: seven days is what enabling a prayer means, so it is
 * applied by `enableSettings` at the moment of enabling. Defaulting to seven here would give every
 * switched-off prayer a full week of days it never asked for, and a future build that read
 * `repeatDays` without checking `notify` would schedule them.
 */
export function defaultAlertSettings(time: PrayerKey): PrayerAlertSettings {
  return {
    time,
    notify: false,
    repeatDays: [],
    preReminderMinutes: 0,
    sound: 'system-default',
  };
}

/** Every time's settings, all off. The value a fresh install holds. */
export function defaultAllAlertSettings(): readonly PrayerAlertSettings[] {
  return NOTIFIABLE_TIMES.map((time) => defaultAlertSettings(time));
}

/**
 * Turning a time on.
 *
 * The repeat days become all seven **here** — the one place enabling happens — because that is the
 * brief's rule: "repeat days default to all seven only after the user enables a prayer". A user who
 * had chosen particular days before switching off keeps them; only an empty selection is filled in,
 * since an empty one is what a never-enabled time holds.
 */
export function enableSettings(settings: PrayerAlertSettings): PrayerAlertSettings {
  return {
    ...settings,
    notify: true,
    repeatDays: settings.repeatDays.length === 0 ? EVERY_DAY : settings.repeatDays,
  };
}

/**
 * Whatever storage held, as valid settings — or `null` if it was not settings at all.
 *
 * ── Why an unreadable entry is dropped rather than repaired ─────────────────
 * A missing `sound` can be defaulted; a missing `time` cannot, because there is nothing to attach
 * the entry to. Returning `null` lets `normaliseAllAlertSettings` fill the gap from the defaults,
 * which is the fail-closed direction: an entry nobody can read becomes a time that is switched off,
 * never a time that is switched on for days nobody chose.
 */
export function normaliseAlertSettings(value: unknown): PrayerAlertSettings | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const time = record.time;
  if (typeof time !== 'string' || !isNotifiable(time as PrayerKey)) {
    return null;
  }
  const base = defaultAlertSettings(time as PrayerKey);
  return {
    time: base.time,
    notify: record.notify === true,
    repeatDays: normaliseRepeatDays(record.repeatDays),
    preReminderMinutes: isPreReminderChoice(record.preReminderMinutes)
      ? record.preReminderMinutes
      : base.preReminderMinutes,
    sound: isAlertSoundChoice(record.sound) ? record.sound : base.sound,
  };
}

/**
 * The full set, in the day's order, with every time present exactly once.
 *
 * ── Why the shape is rebuilt rather than filtered ───────────────────────────
 * The stored array is user-writable storage: it can be missing a time, hold a time twice, hold a
 * time this build does not know, or be something other than an array. Walking `NOTIFIABLE_TIMES`
 * and taking the first readable entry for each makes every one of those cases produce the same
 * well-formed six, so nothing downstream has to ask whether Asr is in there.
 */
export function normaliseAllAlertSettings(value: unknown): readonly PrayerAlertSettings[] {
  const entries = Array.isArray(value) ? value : [];
  const readable = entries
    .map((entry) => normaliseAlertSettings(entry))
    .filter((entry): entry is PrayerAlertSettings => entry !== null);

  return NOTIFIABLE_TIMES.map(
    (time) => readable.find((entry) => entry.time === time) ?? defaultAlertSettings(time),
  );
}

/** The settings for one time, from a set that has been normalised. */
export function settingsFor(
  all: readonly PrayerAlertSettings[],
  time: PrayerKey,
): PrayerAlertSettings {
  return all.find((entry) => entry.time === time) ?? defaultAlertSettings(time);
}

/**
 * A stable, private fingerprint of one time's settings.
 *
 * Part of the schedule fingerprint, so changing a repeat day or a pre-reminder reschedules rather
 * than waiting for the horizon to age out. Contains no account, coordinate or clock — it is entirely
 * derived from choices the user made.
 */
export function alertSettingsFingerprint(settings: PrayerAlertSettings): string {
  return [
    settings.time,
    settings.notify ? 'on' : 'off',
    settings.repeatDays.join(''),
    `p${settings.preReminderMinutes}`,
    settings.sound,
  ].join(':');
}
