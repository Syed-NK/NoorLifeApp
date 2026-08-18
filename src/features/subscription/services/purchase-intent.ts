import type { ProductId } from '../domain/products';
import type { PeriodParam } from '../subscription-routes';

/**
 * The pending purchase intent.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * The processing screen used to start a purchase because it *mounted*. That made
 * `noorlifeapp://subscription/processing?plan=premium_family&period=yearly` a working deep link that
 * granted an entitlement with no user confirmation anywhere in the flow — found while capturing
 * Phase 5 screenshots, where the sweep silently bought a plan and unlocked every paid module.
 *
 * With the mock adapter that cost nothing. With a real store adapter behind the same screen it is a
 * charge triggered by a URL, which is why this is a guard and not a tidy-up.
 *
 * ── The shape of the guard ──────────────────────────────────────────────────
 * Confirmation — the only screen with an explicit "Confirm and Continue" action — records an intent
 * carrying the product and a one-time nonce, and passes that nonce in the route. Processing consumes
 * it by nonce. Consumption clears it, so:
 *
 *   • a deep link with no nonce, or a stale or forged one, finds nothing and is redirected;
 *   • re-entering processing after a completed purchase finds nothing and cannot repeat it;
 *   • cancelling or going back clears it explicitly.
 *
 * In-memory only, and deliberately so: an intent must not survive a process restart. A persisted
 * intent would be a purchase waiting to fire on next launch.
 */
export type PendingPurchaseIntent = {
  readonly productId: ProductId;
  readonly plan: 'premium_single' | 'premium_family';
  readonly period: PeriodParam;
  /** One-time value tying a processing screen to the confirmation that authorised it. */
  readonly nonce: string;
};

let pending: PendingPurchaseIntent | null = null;
let counter = 0;

/**
 * Mints a nonce.
 *
 * Uniqueness within the process is all that is required — this is not a security token against a
 * remote attacker, it is a handshake between two screens in one app. The counter guarantees no
 * collision even if two intents are created in the same millisecond.
 */
function createNonce(): string {
  counter += 1;
  return `intent-${counter}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Records an authorised purchase, replacing any earlier one.
 *
 * Replacing rather than queueing: a user who backs out and reconfirms a different plan must not
 * leave a stale intent for the first one lying around.
 */
export function createPendingIntent(
  productId: ProductId,
  plan: 'premium_single' | 'premium_family',
  period: PeriodParam,
): PendingPurchaseIntent {
  pending = { productId, plan, period, nonce: createNonce() };
  return pending;
}

/**
 * Takes the intent matching `nonce`, clearing it.
 *
 * Returns null when there is nothing pending or the nonce does not match — both of which mean the
 * caller arrived without confirming, and must not be allowed to purchase.
 */
export function consumePendingIntent(nonce: string | undefined): PendingPurchaseIntent | null {
  if (pending === null || nonce === undefined || pending.nonce !== nonce) {
    return null;
  }
  const intent = pending;
  // Cleared before returning, so even a caller that somehow runs twice gets one purchase.
  pending = null;
  return intent;
}

/** Discards any pending intent. Called on cancel, on back, and after a terminal outcome. */
export function clearPendingIntent(): void {
  pending = null;
}

/** Whether an intent is outstanding. For tests and diagnostics; never a purchase authorisation. */
export function hasPendingIntent(): boolean {
  return pending !== null;
}
