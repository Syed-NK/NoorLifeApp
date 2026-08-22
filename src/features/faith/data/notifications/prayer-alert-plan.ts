import { type DailyPrayerTimes, type PrayerKey } from '../prayer-times.repository';
import {
  alertSettingsFingerprint,
  isObligatory,
  NOTIFIABLE_TIMES,
  settingsFor,
  weekdayOfCalendarDate,
  type PrayerAlertSettings,
} from './prayer-alert-preferences';

/**
 * Turning calculated prayer times into the list of alerts that should be pending.
 *
 * ── This module calculates nothing ──────────────────────────────────────────
 * That is its most important property. Every instant here arrives inside a `DailyPrayerTimes` the
 * repository produced — the same object the Prayer screen renders — and is passed through
 * untouched. There is no `adhan` import, no timezone arithmetic and no date construction from parts.
 *
 * The reason is the failure it prevents. A notification layer that recomputed prayer times would be
 * a second implementation of the one calculation in this app that must not have two: it would drift
 * at a DST boundary, or under a changed madhab, or at a pole, and the symptom would be an alert that
 * fires at a time the screen never showed. Passing the instants through means the alert and the row
 * are the *same value* — a test can assert string equality, and it does.
 *
 * The one exception, and it is arithmetic rather than calculation: a pre-reminder is the prayer's own
 * instant minus a whole number of minutes. That is a subtraction from a value the repository
 * produced, not a second derivation of it, so a changed method moves the pre-reminder by exactly as
 * much as it moves the prayer.
 *
 * ── Sunrise is admitted, and is never called a prayer ───────────────────────
 * This changed. The plan used to walk `OBLIGATORY_PRAYERS` so that a sunrise alert was structurally
 * impossible; it now walks `NOTIFIABLE_TIMES`, because a reminder that the night's window is closing
 * is a reasonable thing to want. What is still structurally impossible is *announcing* sunrise as a
 * prayer or playing a call to prayer for it: the content is chosen by `isObligatory`, not by a
 * string, and `canEverPlayFullAdhan` refuses sunrise outright.
 */

/**
 * How many days ahead to keep scheduled.
 *
 * Seven. Long enough that a week offline is still covered, short enough that a reboot which dropped
 * the alarms is repaired at the next foreground rather than days later. The count of alerts this
 * produces is bounded separately — see `MAX_PENDING_ALERTS`, which is the constraint that actually
 * binds now that there are twelve possible alerts a day rather than five.
 */
export const SCHEDULE_HORIZON_DAYS = 7;

/**
 * The most alerts NoorLife will hold pending at once.
 *
 * ── Why a count as well as a horizon ───────────────────────────────────────
 * **iOS allows an app 64 pending local notifications.** Anything beyond that is silently dropped —
 * no error, no warning, and the ones lost are the *later* ones, so the failure is invisible for a
 * week and then a prayer is missed.
 *
 * The old plan could not reach the limit: five prayers over seven days is 35. This one can. Six
 * notifiable times, each with a pre-reminder, over seven days is 84 — comfortably over. So the
 * horizon is now a ceiling rather than a promise, and the plan is truncated chronologically to this
 * many, keeping the *soonest* alerts, which are the ones that matter first.
 *
 * 56 rather than 64, leaving eight for the test notification and for whatever a future build adds
 * without having to revisit this number under pressure. When the plan is truncated the status says
 * so and the screen reports the date coverage actually reaches, so a user is never told they are
 * covered for a week when they are covered for four days.
 */
export const MAX_PENDING_ALERTS = 56;

/**
 * Which kind of alert an entry is.
 *
 * Part of the identity rather than a flag on it, because the two are cancelled and replaced
 * independently: turning a pre-reminder off must not disturb the alert at the time itself.
 */
export type PrayerAlertType = 'time' | 'pre';

/**
 * One alert that should be pending.
 *
 * `key` is the stable identity — a local calendar date, a time, and which kind of alert — under
 * which the platform's identifier is stored. It is what makes reconciliation possible without
 * re-deriving anything: the app can ask "is `2026-08-14:fajr:time` still pending" rather than trying
 * to match on a timestamp that may have shifted by a minute under a changed method.
 */
export type PlannedAlert = {
  readonly key: string;
  /** The calendar day **at the prayer location**, `YYYY-MM-DD`. */
  readonly calendarDate: string;
  readonly prayer: PrayerKey;
  readonly label: string;
  readonly type: PrayerAlertType;
  /** For a `pre` alert, how many minutes before. `0` for a `time` alert. */
  readonly minutesBefore: number;
  /**
   * The instant this alert fires.
   *
   * For a `time` alert this is the repository's own string, byte for byte. For a `pre` alert it is
   * that instant minus `minutesBefore`, as an ISO string.
   */
  readonly at: string;
  /** Whether the alert should make no sound. Follows the time's own sound choice. */
  readonly silent: boolean;
};

/**
 * The identity of one alert. The only place this string is formed.
 *
 * ── What is deliberately absent ────────────────────────────────────────────
 * No account, no coordinate, no method and no clock. The key is written into device storage and is
 * used to look up a platform identifier; it is not a place to accumulate a second copy of who or
 * where the user is. Account separation is the *storage key's* job — the schedule record lives under
 * the signed-in user's own namespace — so the alert key does not need to repeat it, and repeating it
 * would put a user id into a value that has no reason to hold one.
 */
export function plannedAlertKey(
  calendarDate: string,
  prayer: PrayerKey,
  type: PrayerAlertType,
): string {
  return `${calendarDate}:${prayer}:${type}`;
}

export type PlanInput = {
  /** Consecutive days from the repository, in order. Usually `SCHEDULE_HORIZON_DAYS` of them. */
  readonly days: readonly DailyPrayerTimes[];
  /** Per-time settings, already normalised. Every notifiable time is present. */
  readonly alerts: readonly PrayerAlertSettings[];
  /** Epoch milliseconds. Alerts at or before this are not scheduled. */
  readonly nowMs: number;
  /** The pending ceiling. Defaults to `MAX_PENDING_ALERTS`; a test may lower it. */
  readonly maxPending?: number;
};

export type PrayerAlertPlan = {
  readonly alerts: readonly PlannedAlert[];
  /**
   * Whether the ceiling cut the plan short.
   *
   * Reported rather than inferred from `alerts.length`, because a plan of exactly the ceiling may or
   * may not have been truncated and the screen must not guess.
   */
  readonly truncated: boolean;
  /** The last calendar date actually covered, or `null` when nothing is scheduled. */
  readonly coversThrough: string | null;
};

/**
 * The alerts that should be pending, in chronological order.
 *
 * ── Why past instants are dropped rather than scheduled and ignored ─────────
 * A platform handed a past date either fires immediately or refuses. The first is worse than it
 * sounds: reconciling on app resume would deliver "Dhuhr" at nine in the evening because the day's
 * Dhuhr was in the plan. Dropping them here is the only place that decision has to be made.
 *
 * ── Why duplicates are impossible rather than removed ───────────────────────
 * The output is keyed by `date:prayer:type` in a `Map`, so a repository that returned the same day
 * twice — which a horizon that straddles a DST transition can do — yields one entry, not two.
 *
 * ── Why the repeat day comes from the calendar date ─────────────────────────
 * `weekdayOfCalendarDate` reads the weekday of the *location's* own date string. Asking the device
 * for a weekday would put the reader's zone back into a decision about the prayer location's day,
 * which is the defect the whole Prayer path was corrected for. A date that cannot be read yields no
 * alert at all, because a repeat-day filter that guesses fires on a day the user switched off.
 */
export function planPrayerAlerts({
  days,
  alerts,
  nowMs,
  maxPending = MAX_PENDING_ALERTS,
}: PlanInput): PrayerAlertPlan {
  const byKey = new Map<string, PlannedAlert>();

  for (const day of days) {
    const weekday = weekdayOfCalendarDate(day.date);
    if (weekday === null) {
      continue;
    }

    for (const time of NOTIFIABLE_TIMES) {
      const settings = settingsFor(alerts, time);
      if (!settings.notify || !settings.repeatDays.includes(weekday)) {
        continue;
      }

      const entry = day.times.find((candidate) => candidate.key === time);
      if (entry === undefined) {
        // A time with no instant — a polar day where `adhan` reports none. Nothing to schedule.
        continue;
      }
      const at = Date.parse(entry.at);
      if (!Number.isFinite(at)) {
        continue;
      }

      const wanted: readonly { readonly type: PrayerAlertType; readonly minutes: number }[] = [
        { type: 'time', minutes: 0 },
        ...(settings.preReminderMinutes > 0
          ? [{ type: 'pre' as const, minutes: settings.preReminderMinutes }]
          : []),
      ];

      for (const { type, minutes } of wanted) {
        const instantMs = at - minutes * 60_000;
        if (instantMs <= nowMs) {
          continue;
        }
        const key = plannedAlertKey(day.date, time, type);
        if (byKey.has(key)) {
          continue;
        }
        byKey.set(key, {
          key,
          calendarDate: day.date,
          prayer: time,
          label: entry.label,
          type,
          minutesBefore: minutes,
          /*
            The `time` alert keeps the repository's own string untouched, so a test can assert it is
            byte-identical to the row the screen renders. Only the pre-reminder is constructed, and
            only ever by subtracting whole minutes from that same instant.
          */
          at: type === 'time' ? entry.at : new Date(instantMs).toISOString(),
          silent: settings.sound === 'silent',
        });
      }
    }
  }

  const ordered = [...byKey.values()].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const kept = ordered.slice(0, Math.max(0, maxPending));

  return {
    alerts: kept,
    truncated: kept.length < ordered.length,
    coversThrough:
      kept.length === 0
        ? null
        : kept.reduce(
            (latest, alert) => (alert.calendarDate > latest ? alert.calendarDate : latest),
            kept[0]!.calendarDate,
          ),
  };
}

/**
 * What the user sees when an alert fires.
 *
 * ── Deliberately plain, and deliberately without a clock ───────────────────
 * It names the time and says what is happening, and nothing else — no encouragement, no scripture,
 * and nothing that would be wrong if the notification arrived late. The wall clock used to be in the
 * title; it is gone. A notification is readable from a lock screen by anyone holding the phone, and a
 * prayer time is a good enough clue to a city to be worth not printing. "It is time for Fajr" is
 * also simply truer than a time that may be a minute stale.
 *
 * ── Sunrise says what it is ────────────────────────────────────────────────
 * `isObligatory` decides, not the label, so sunrise is never announced as a prayer time and never
 * says "it is time for" anything. It is a clock reading, and its notification reads like one.
 */
export function prayerAlertContent(alert: PlannedAlert): {
  readonly title: string;
  readonly body: string;
} {
  const prayer = isObligatory(alert.prayer);

  if (alert.type === 'pre') {
    const minutes = `${alert.minutesBefore} minutes`;
    return prayer
      ? { title: `${alert.label} soon`, body: `${alert.label} begins in ${minutes}.` }
      : { title: `${alert.label} soon`, body: `${alert.label} is in ${minutes}.` };
  }

  return prayer
    ? { title: `${alert.label} prayer time`, body: `It is time for ${alert.label}.` }
    : { title: `${alert.label}`, body: `${alert.label} is now.` };
}

/**
 * The inputs that, taken together, decide what should be scheduled.
 *
 * ── Why a fingerprint rather than comparing plans ───────────────────────────
 * Reconciliation runs on every launch and every foreground. Rebuilding the plan is cheap; deciding
 * whether it *changed* by comparing dozens of entries is not the question anyway — the question is
 * whether any **input** changed, because a plan that looks identical after a method change would
 * still be one minute wrong.
 *
 * The coordinate is rounded to three decimals (~110 m) so that GPS jitter under the material-change
 * threshold does not trigger a reschedule, while a real move does. The zone is included separately
 * because two coordinates can share a zone and a DST transition changes the offset without moving
 * anything — so the current offset goes in too.
 *
 * Every per-time choice is in it as well, by way of `alertSettingsFingerprint`: a repeat day removed
 * or a pre-reminder changed reschedules immediately rather than waiting for the horizon to age.
 */
export function scheduleFingerprint(input: {
  readonly latitude: number;
  readonly longitude: number;
  readonly timeZone: string;
  /** The location's UTC offset right now, in minutes. Changes across a DST transition. */
  readonly offsetMinutes: number;
  readonly method: string;
  readonly asr: string;
  readonly offsetsMinutes: Readonly<Partial<Record<PrayerKey, number>>>;
  readonly alerts: readonly PrayerAlertSettings[];
  readonly horizonDays: number;
  readonly maxPending: number;
}): string {
  const adjustments = NOTIFIABLE_TIMES.map(
    (key) => `${key}=${input.offsetsMinutes[key] ?? 0}`,
  ).join(',');
  const choices = NOTIFIABLE_TIMES.map((time) =>
    alertSettingsFingerprint(settingsFor(input.alerts, time)),
  ).join(';');
  return [
    /*
      The contract version. Bumped when the *meaning* of a schedule changes — a different horizon
      shape, a different body, a new channel — so an upgraded app reschedules rather than trusting
      identifiers written under rules it no longer follows.
    */
    `v${SCHEDULE_CONTRACT_VERSION}`,
    input.latitude.toFixed(3),
    input.longitude.toFixed(3),
    input.timeZone,
    `off${input.offsetMinutes}`,
    input.method,
    input.asr,
    adjustments,
    choices,
    `h${input.horizonDays}`,
    `m${input.maxPending}`,
  ].join('|');
}

/**
 * The scheduling contract's version.
 *
 * **2.** Bumped from 1 because the meaning of a schedule changed in three ways at once: the
 * identifier keys gained a type segment, the notification bodies lost their clock, and a silent
 * alert now goes to a different Android channel. An install upgrading from a build that wrote
 * version 1 identifiers therefore reschedules from scratch instead of trusting keys it can no longer
 * interpret — which is the whole reason the version is part of the fingerprint.
 */
export const SCHEDULE_CONTRACT_VERSION = 2;
