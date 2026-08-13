import { formatPrayerClock } from '../prayer/prayer-clock';
import {
  OBLIGATORY_PRAYERS,
  type DailyPrayerTimes,
  type PrayerKey,
} from '../prayer-times.repository';

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
 * ── Sunrise is excluded here, structurally ──────────────────────────────────
 * Not filtered out at the end, but never admitted: the plan is built by walking
 * `OBLIGATORY_PRAYERS`, which is the domain's own list of the five, rather than by walking the day's
 * six times and skipping one. There is no code path that could add a sunrise alert.
 */

/**
 * How many days ahead to keep scheduled.
 *
 * Seven. iOS caps an app at 64 pending local notifications; five prayers over seven days is 35,
 * which leaves room for the test notification and for a future per-prayer pre-alert without
 * approaching the limit. Android has no comparable cap but does have to survive a reboot, and a
 * shorter horizon means a longer gap before the next reconciliation refills it.
 */
export const SCHEDULE_HORIZON_DAYS = 7;

/**
 * One alert that should be pending.
 *
 * `key` is the stable identity — a local calendar date and a prayer — under which the platform's
 * identifier is stored. It is what makes reconciliation possible without re-deriving anything: the
 * app can ask "is `2026-08-14:fajr` still pending" rather than trying to match on a timestamp that
 * may have shifted by a minute under a changed method.
 */
export type PlannedAlert = {
  readonly key: string;
  /** The calendar day **at the prayer location**, `YYYY-MM-DD`. */
  readonly calendarDate: string;
  readonly prayer: PrayerKey;
  readonly label: string;
  /** The instant, exactly as the repository stamped it and the screen displays it. */
  readonly at: string;
  /** The wall clock at the location, for the notification body. */
  readonly clock: string;
};

/** The identity of one alert. The only place this string is formed. */
export function plannedAlertKey(calendarDate: string, prayer: PrayerKey): string {
  return `${calendarDate}:${prayer}`;
}

export type PlanInput = {
  /** Consecutive days from the repository, in order. Usually `SCHEDULE_HORIZON_DAYS` of them. */
  readonly days: readonly DailyPrayerTimes[];
  /** Which of the five the user has switched on. Sunrise can never appear here — it is not offered. */
  readonly enabled: readonly PrayerKey[];
  /** Epoch milliseconds. Alerts at or before this are not scheduled. */
  readonly nowMs: number;
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
 * The output is keyed by `date:prayer` in a `Map`, so a repository that returned the same day twice
 * — which a horizon that straddles a DST transition can do — yields one entry, not two.
 */
export function planPrayerAlerts({ days, enabled, nowMs }: PlanInput): readonly PlannedAlert[] {
  const wanted = new Set(enabled.filter((key) => OBLIGATORY_PRAYERS.includes(key)));
  if (wanted.size === 0) {
    return [];
  }

  const byKey = new Map<string, PlannedAlert>();

  for (const day of days) {
    for (const prayer of OBLIGATORY_PRAYERS) {
      if (!wanted.has(prayer)) {
        continue;
      }
      const time = day.times.find((entry) => entry.key === prayer);
      if (time === undefined) {
        // A prayer with no time — a polar day where `adhan` reports none. Nothing to schedule.
        continue;
      }
      const at = Date.parse(time.at);
      if (!Number.isFinite(at) || at <= nowMs) {
        continue;
      }
      const key = plannedAlertKey(day.date, prayer);
      if (byKey.has(key)) {
        continue;
      }
      byKey.set(key, {
        key,
        calendarDate: day.date,
        prayer,
        label: time.label,
        at: time.at,
        clock: formatPrayerClock(time.at),
      });
    }
  }

  return [...byKey.values()].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

/**
 * What the user sees when an alert fires.
 *
 * Deliberately plain. It names the prayer and its time and says nothing else — no encouragement, no
 * scripture, and nothing that would be wrong if the notification arrived late.
 */
export function prayerAlertContent(alert: PlannedAlert): {
  readonly title: string;
  readonly body: string;
} {
  return {
    title: `${alert.label} — ${alert.clock}`,
    body: `It is time for ${alert.label}.`,
  };
}

/**
 * The inputs that, taken together, decide what should be scheduled.
 *
 * ── Why a fingerprint rather than comparing plans ───────────────────────────
 * Reconciliation runs on every launch and every foreground. Rebuilding the plan is cheap; deciding
 * whether it *changed* by comparing 35 entries is not the question anyway — the question is whether
 * any **input** changed, because a plan that looks identical after a method change would still be
 * one minute wrong.
 *
 * The coordinate is rounded to three decimals (~110 m) so that GPS jitter under the material-change
 * threshold does not trigger a reschedule, while a real move does. The zone is included separately
 * because two coordinates can share a zone and a DST transition changes the offset without moving
 * anything — so the current offset goes in too.
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
  readonly enabled: readonly PrayerKey[];
  readonly horizonDays: number;
}): string {
  const adjustments = OBLIGATORY_PRAYERS.map(
    (key) => `${key}=${input.offsetsMinutes[key] ?? 0}`,
  ).join(',');
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
    [...input.enabled].sort().join('+'),
    `h${input.horizonDays}`,
  ].join('|');
}

/**
 * The scheduling contract's version.
 *
 * Part of the fingerprint, so an application upgrade that changes what a schedule *means* forces a
 * full reschedule instead of leaving identifiers created under the old rules pending.
 */
export const SCHEDULE_CONTRACT_VERSION = 1;
