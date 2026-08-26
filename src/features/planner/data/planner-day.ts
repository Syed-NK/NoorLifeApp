import { localDateKey, offsetLocalDate } from './planner-task';

/**
 * What day it is, decided once.
 *
 * ── The defect this type exists to close ────────────────────────────────────
 * Planner derived "today" in five places and three different ways. Tasks, Calendar and Routines each
 * captured `new Date()` once per mount; Main Home's agenda captured it once per provider mount; the
 * Planner home read it on **every render**. A session held open across midnight left them stale
 * differently — the home rolled over to the new day while the calendar still highlighted yesterday,
 * and "Due today" counted a day the list beside it was not showing.
 *
 * Worse than any of them being wrong is that one logical operation could read two days: with the
 * clock read per call, `localDateKey(new Date())` and `offsetLocalDate(new Date(), 1)` on adjacent
 * lines can land either side of midnight, so "today" and "tomorrow" stop being consecutive.
 *
 * A `PlannerDay` is one instantaneous reading of the calendar. Every key inside it comes from a
 * single `Date`, so the set is internally consistent by construction — there is no arrangement of
 * clock ticks that can produce a snapshot whose `tomorrow` is not the day after its `today`.
 *
 * The value is a plain, comparable record rather than a `Date`, because everything downstream keys on
 * `YYYY-MM-DD` and a retained `Date` is an invitation to re-derive.
 */
export type PlannerDay = {
  /** Local `YYYY-MM-DD` at the instant this snapshot was taken. */
  readonly today: string;
  /** The day after `today`. Always consecutive with it — see above. */
  readonly tomorrow: string;
  /**
   * `Date.getTimezoneOffset()` at the same instant.
   *
   * Carried so a zone change is *detectable*. React Native emits no timezone event, so the only
   * honest way to notice one is to compare a recorded offset against a fresh reading at the next
   * boundary the app already has: a foreground, a midnight fire, or an account change. A zone can
   * move without the date key moving — 23:30 UTC+4 to 21:30 UTC+2 is the same calendar day — and a
   * snapshot that only compared `today` would treat that as no change and keep an offset that is now
   * wrong for scheduling the next midnight.
   */
  readonly zoneOffsetMinutes: number;
};

/** One reading of the calendar, from one `Date`. The only place a `PlannerDay` is made. */
export function plannerDayAt(now: Date): PlannerDay {
  return {
    today: localDateKey(now),
    tomorrow: offsetLocalDate(now, 1),
    zoneOffsetMinutes: now.getTimezoneOffset(),
  };
}

/** Whether two readings describe the same calendar day *in the same zone*. */
export function samePlannerDay(left: PlannerDay, right: PlannerDay): boolean {
  return left.today === right.today && left.zoneOffsetMinutes === right.zoneOffsetMinutes;
}

/**
 * Milliseconds from `now` until the start of the next local day.
 *
 * Built by moving to the next date at midday and then zeroing the time, rather than by adding
 * 24 hours: a day is not always 86,400,000 ms. Under a daylight-saving transition it is 23 or 25
 * hours, and the midday anchor is what keeps the date arithmetic clear of the shifted hour.
 *
 * Never returns zero or less. A timer armed for `0` would fire in the same millisecond it was set
 * and, if the clock had not yet crossed, re-arm for `0` again — a spin rather than a wait. The floor
 * of one millisecond turns the worst case into a single extra wake-up that observes no change.
 */
export function msUntilNextLocalMidnight(now: Date): number {
  const next = new Date(now.getTime());
  next.setHours(12, 0, 0, 0);
  next.setDate(next.getDate() + 1);
  next.setHours(0, 0, 0, 0);
  return Math.max(1, next.getTime() - now.getTime());
}
