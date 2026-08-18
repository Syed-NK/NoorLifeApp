/**
 * Wall-clock formatting for a prayer time.
 *
 * ── Why this is its own module ──────────────────────────────────────────────
 * It used to live in `hooks/use-faith-home.ts`, which is where its first caller was. The worship
 * repository then needed it too, and importing a hook module from a repository closed a cycle:
 * `mock-worship.repository` → `use-faith-home` → `di/faith-repository-context` → `data/mock` →
 * `mock-worship.repository`. Metro resolved that to a partially-initialised module and every Faith
 * suite failed with `Cannot read properties of undefined`.
 *
 * A pure function with no imports cannot participate in a cycle, so it lives here and
 * `use-faith-home` re-exports it for the call sites that already found it there.
 */

/**
 * The wall-clock time out of an ISO-8601 timestamp that carries its own offset.
 *
 * ── Why the string is read rather than the `Date` ───────────────────────────
 * A prayer time is a fact about a *place*. `2026-08-10T12:35:00+01:00` means half past twelve where
 * the user is, and rendering it through the device's own zone would show a different number to
 * somebody whose phone is still set to the airport they flew from. Reading the hours and minutes out
 * of the string keeps the time in the frame it was calculated in.
 *
 * It also avoids `toLocaleTimeString`, whose behaviour depends on how much of ICU the Hermes build
 * on a given device shipped with.
 */
export function formatPrayerClock(iso: string): string {
  const match = /T(\d{2}):(\d{2})/.exec(iso);
  if (match === null) {
    return '';
  }
  const hours = Number(match[1]);
  const minutes = match[2] as string;
  const suffix = hours < 12 ? 'AM' : 'PM';
  const twelve = hours % 12 === 0 ? 12 : hours % 12;
  return `${twelve}:${minutes} ${suffix}`;
}

/**
 * Whole minutes from now until a stamped prayer instant. Never negative.
 *
 * ── Why this compares instants and not wall clocks ──────────────────────────
 * `iso` carries the *prayer location's* offset, and `now` is a device instant. `new Date(iso)` parses
 * that offset, so the subtraction is between two absolute instants and the answer is the same however
 * the device's zone is set. That is the property the whole timezone correction rests on, and it is why
 * this cannot be done by pulling calendar fields off either side: `getHours()` on a `Date` reads the
 * device's zone, and a countdown built that way is wrong by the offset difference for any traveller.
 *
 * DST needs no special handling here for the same reason. A transition changes what the wall clock
 * *says*, not how many minutes separate two instants, and the offset inside `iso` already reflects the
 * rule that applied on that date.
 *
 * ── Why it rounds up ────────────────────────────────────────────────────────
 * `Math.ceil`. With flooring, a prayer 90 seconds away reads "in 1 min" for a full minute and then
 * "now" — so the display sits on 1 while the true figure is 1.5. Ceiling means the number shown is
 * never *less* than the time remaining, which is the safer direction for something a user is timing
 * their wudu against. Exactly at the prayer instant it is 0.
 */
export function minutesUntilInstant(iso: string, now: Date = new Date()): number {
  const target = new Date(iso).getTime();
  if (Number.isNaN(target)) {
    return 0;
  }
  return Math.max(0, Math.ceil((target - now.getTime()) / 60_000));
}

/**
 * "in 2 hr 15 min", "in 14 min", "now". Never a negative duration.
 *
 * ── Why this lives here rather than in `use-faith-home` ─────────────────────
 * It was in that hook module, which is where its first caller was, and three surfaces need it now:
 * the Faith home hero, the Prayer times screen and Main Home's timeline. A hook module cannot be
 * imported from a repository or from Main Home's data layer without closing an import cycle — the
 * exact problem that moved `formatPrayerClock` into this file. `use-faith-home` re-exports it so the
 * call sites that already found it there keep working.
 *
 * One implementation is also the requirement: two countdown formatters drift, and the drift shows up
 * as Main Home and Faith disagreeing about the same prayer by a minute.
 */
export function formatTimeUntil(minutes: number): string {
  if (minutes <= 0) {
    return 'now';
  }
  if (minutes < 60) {
    return `in ${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `in ${hours} hr` : `in ${hours} hr ${rest} min`;
}

/** The countdown for a stamped instant, formatted. The pair above, in the order callers want them. */
export function formatCountdownTo(iso: string, now: Date = new Date()): string {
  return formatTimeUntil(minutesUntilInstant(iso, now));
}

/**
 * The same duration, split into the units it is made of: `['8 hr', '29 min']`, `['14 min']`, `['now']`.
 *
 * ── Why the parts rather than the sentence ──────────────────────────────────
 * The next-prayer card sets the countdown twice — once as a sentence in the text column and once
 * inside a ~76 dp progress ring, where a single line cannot hold "8 hr 29 min" at a readable size.
 * The ring stacks the parts on two lines instead. Deriving both from one function is what stops the
 * two renderings ever disagreeing about the same duration, which is the whole reason `formatTimeUntil`
 * was consolidated in the first place.
 *
 * Never more than two parts, so a caller can rely on the ring being at most two lines.
 */
export function formatDurationParts(minutes: number): readonly string[] {
  if (minutes <= 0) {
    return ['now'];
  }
  if (minutes < 60) {
    return [`${minutes} min`];
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? [`${hours} hr`] : [`${hours} hr`, `${rest} min`];
}

/**
 * "8 hr 29 min remaining", "14 min remaining", "now".
 *
 * The trailing form the approved next-prayer card uses, as against `formatTimeUntil`'s leading "in".
 * Both are the same number from the same arithmetic; only the sentence differs.
 */
export function formatRemaining(minutes: number): string {
  return minutes <= 0 ? 'now' : `${formatDurationParts(minutes).join(' ')} remaining`;
}
