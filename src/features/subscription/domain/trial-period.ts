import type { Entitlement } from './entitlement';

/**
 * **One trial period, one renewal date, one place they come from.**
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The defect this exists for ─────────────────────────────────────────────
 * The purchase confirmation screen stated *"On 28 August 2026 it renews"* and the success screen that
 * followed it stated *"Your free trial runs until 8 August 2026"* — a date already three weeks in the
 * past at the moment it was shown. Two screens, one purchase, two different answers, one of them
 * impossible.
 *
 * Neither screen was wrong about its own arithmetic. They were reading **different clocks**. The
 * confirmation screen projected seven days from the device clock; the success screen read the
 * entitlement, whose dates the mock adapter computed from a hard-coded `now` of 1 August 2026 kept for
 * reproducible screenshots. Every purchase produced 8 August, for ever.
 *
 * That is fixed at its source — the adapter's default `now` is the real clock, and a fixed one stays
 * injectable for the tests and screenshots that actually want it. But the deeper cause was that the
 * same date was **computed independently in three places** (`sevenDaysFromNow`, `trialRenewalDate`,
 * and the entitlement) with the trial length written out a fourth time in copy. Three computations of
 * one fact will disagree eventually; the only durable fix is that there is one.
 *
 * ── Before and after a purchase are different questions ────────────────────
 * They are not the same value and this module does not pretend they are:
 *
 *   • **Before** a purchase nothing has been bought, so no provider has issued a date. The honest
 *     statement is a *projection*: "if you subscribe now, your trial ends on…". `projectedTrialEnd`
 *     is the single place that projection is made.
 *   • **After** a purchase the provider has issued real dates. Those are authoritative and nothing
 *     may recompute them — `authoritativeTrialEnd` and `authoritativeRenewal` read them, and the
 *     screens display what they return or nothing at all.
 *
 * A projection must never be shown as though it were the issued date, and an issued date must never
 * be replaced by a projection because it looked wrong.
 *
 * ── Nothing here invents a date ────────────────────────────────────────────
 * When the entitlement carries no trial end, these return `null` and the screens fall back to copy
 * that states no date. That is the whole point: a subscription surface that guesses a date is worse
 * than one that admits it does not have it, because the user plans around what it says.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * The introductory trial length, in days.
 *
 * The single definition. It was previously the adapter's own constant, a `+ 7` in two screens, and
 * the words "7 days" in copy — four places to change and three chances to miss one.
 */
export const TRIAL_DAYS = 7;

/** `7-day free trial`, built from the constant so a heading cannot outlive the length it names. */
export const trialLengthLabel = `${TRIAL_DAYS}-day`;

/**
 * The trial end a purchase made *now* would have — a projection, for pre-purchase screens only.
 *
 * Local-date arithmetic on purpose. `setDate` moves the local calendar day and leaves the wall-clock
 * time alone, so a user seven days before a DST transition still lands on the calendar day they would
 * expect. Adding milliseconds would drift by an hour across a transition and can shift the rendered
 * day for anyone near midnight.
 *
 * Takes `from` rather than reading the clock itself, so it is testable for a given instant and so a
 * caller cannot end up with two different "now"s inside one render.
 */
export function projectedTrialEnd(from: Date): string {
  const end = new Date(from.getTime());
  end.setDate(end.getDate() + TRIAL_DAYS);
  return end.toISOString();
}

/**
 * The trial end the provider issued, or `null`.
 *
 * Reads `trialEnd` — **not** `currentPeriodEnd`. The success screen used to render a sentence about
 * the trial from the period end, which happens to be the same value in the mock and is not the same
 * thing anywhere else: a period end is when billing recurs, a trial end is when the free part stops.
 * With a real provider the two diverge and the sentence would quietly become false.
 *
 * `null` unless the entitlement is actually in a trial. A `trialEnd` left on a lapsed or active
 * subscription is stale data, and reading it would announce a trial that is not running.
 */
export function authoritativeTrialEnd(entitlement: Entitlement): string | null {
  if (entitlement.status !== 'trialing') {
    return null;
  }
  return isUsableInstant(entitlement.trialEnd) ? entitlement.trialEnd : null;
}

/** The date billing next recurs, or `null`. The renewal question, answered from one field. */
export function authoritativeRenewal(entitlement: Entitlement): string | null {
  return isUsableInstant(entitlement.currentPeriodEnd) ? entitlement.currentPeriodEnd : null;
}

/**
 * Whether a trial end may be shown at all, given when the subscription was activated.
 *
 * A trial that ends before it started is not a date to render more carefully — it is a value that
 * cannot be true, and showing it tells the user their free period has already expired. The guard is
 * strict: equal instants are refused too, because a trial of zero length is not a trial.
 *
 * This is the assertion the original defect would have failed. It exists so that a future clock,
 * timezone or provider mistake surfaces as *missing* copy rather than as a confident lie.
 */
export function trialEndIsCredible(trialEnd: string | null, activatedAt: Date): boolean {
  if (!isUsableInstant(trialEnd)) {
    return false;
  }
  return new Date(trialEnd).getTime() > activatedAt.getTime();
}

/**
 * The trial end to display after a purchase, or `null` when there is nothing honest to show.
 *
 * One call for the screens, so the field choice and the credibility guard cannot be applied in one
 * place and forgotten in another.
 */
export function displayableTrialEnd(entitlement: Entitlement, at: Date): string | null {
  const trialEnd = authoritativeTrialEnd(entitlement);
  return trialEndIsCredible(trialEnd, at) ? trialEnd : null;
}

/** A parseable ISO instant, narrowed so callers get a `string` rather than `string | null`. */
function isUsableInstant(value: string | null): value is string {
  if (value === null) {
    return false;
  }
  return !Number.isNaN(new Date(value).getTime());
}
