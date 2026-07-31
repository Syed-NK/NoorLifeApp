import {
  FREE_ENTITLEMENT,
  PLAN_CAPABILITIES,
  type Entitlement,
  type FamilySeatUsage,
} from '../domain/entitlement';
import { fallbackPrice } from '../domain/pricing';
import { PLAN_OFFERS, findOfferByProductId, type ProductId } from '../domain/products';
import type {
  PricedOffer,
  PurchaseAdapter,
  PurchaseResult,
  RestoreResult,
} from './purchase-adapter';

/**
 * The development purchase adapter.
 *
 * ── What this is and is not ─────────────────────────────────────────────────
 * It is a deterministic stand-in so the seventeen subscription screens can be built, driven and
 * screenshotted before store credentials exist. It grants entitlement in memory.
 *
 * It is **not** a purchase. `canTransact` is false and `provider` is `development_mock`, so no
 * screen can mistake its output for a real transaction, and `MockModeBadge` states plainly on
 * screen that purchases are simulated. Nothing here contacts Apple or Google.
 *
 * ── Why deterministic and not random ────────────────────────────────────────
 * Every outcome is reachable by explicit instruction — `setNextPurchaseOutcome` — rather than by
 * chance. A flaky paywall is untestable, and a screenshot run that sometimes shows "declined" is
 * useless as a design reference.
 */

/** Days in a monthly and yearly period, for computing renewal dates the UI can display. */
const MONTH_DAYS = 30;
const YEAR_DAYS = 365;
const TRIAL_DAYS = 7;

function isoInDays(days: number, from: Date): string {
  const date = new Date(from.getTime());
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

export type MockAdapterOptions = {
  /** Entitlement the adapter starts from. Defaults to free. */
  readonly initialEntitlement?: Entitlement;
  /** Seat usage reported for a family plan. */
  readonly initialSeatUsage?: FamilySeatUsage;
  /**
   * Whether this user is eligible for the introductory trial.
   *
   * Defaults to true, representing a first-time subscriber. Set false to exercise the
   * not-eligible presentation, which must show no trial language at all.
   */
  readonly trialEligible?: boolean;
  /**
   * Fixed "now", so renewal dates and screenshots are reproducible.
   *
   * Without this the same screen renders a different date every run, which makes a visual
   * reference impossible to compare.
   */
  readonly now?: Date;
  /** Whether the store is reachable. False drives the store-unavailable states. */
  readonly storeAvailable?: boolean;
  /** False drives the offline states. */
  readonly online?: boolean;
  /** Entitlement the mock will find when Restore Purchases runs. Null means nothing to restore. */
  readonly restorableEntitlement?: Entitlement | null;
};

export class MockPurchaseAdapter implements PurchaseAdapter {
  readonly id = 'mock' as const;
  /**
   * Always false.
   *
   * This is the flag every screen consults before offering a real purchase, and it is the
   * structural guarantee behind "do not activate live billing until store products exist".
   */
  readonly canTransact = false;

  private entitlement: Entitlement;
  private seatUsage: FamilySeatUsage;
  private readonly trialEligible: boolean;
  private readonly now: Date;
  private storeAvailable: boolean;
  private online: boolean;
  private readonly restorable: Entitlement | null;
  private nextPurchaseOutcome: PurchaseResult['outcome'] | null = null;

  constructor(options: MockAdapterOptions = {}) {
    this.entitlement = options.initialEntitlement ?? FREE_ENTITLEMENT;
    this.seatUsage = options.initialSeatUsage ?? { used: 1, limit: 6, pendingInvitations: 0 };
    this.trialEligible = options.trialEligible ?? true;
    this.now = options.now ?? new Date('2026-08-01T09:00:00.000Z');
    this.storeAvailable = options.storeAvailable ?? true;
    this.online = options.online ?? true;
    this.restorable = options.restorableEntitlement ?? null;
  }

  /** Forces the next `purchase` call to end a particular way, for tests and screenshots. */
  setNextPurchaseOutcome(outcome: PurchaseResult['outcome'] | null): void {
    this.nextPurchaseOutcome = outcome;
  }

  setStoreAvailable(available: boolean): void {
    this.storeAvailable = available;
  }

  setOnline(online: boolean): void {
    this.online = online;
  }

  setSeatUsage(usage: FamilySeatUsage): void {
    this.seatUsage = usage;
  }

  getSeatUsage(): FamilySeatUsage {
    return this.seatUsage;
  }

  async getOffers(): Promise<readonly PricedOffer[]> {
    // Fallback prices throughout: a mock has no store to localise against, and claiming a
    // store-sourced price would defeat the point of tracking `source`.
    return PLAN_OFFERS.map((offer) => ({
      ...offer,
      price: fallbackPrice(offer.productId),
      trialEligibleForUser: offer.trialEligibleByDesign && this.trialEligible,
    }));
  }

  async getEntitlement(): Promise<Entitlement> {
    return this.entitlement;
  }

  async purchase(productId: ProductId): Promise<PurchaseResult> {
    if (!this.online) {
      return { outcome: 'offline', message: 'You appear to be offline.' };
    }
    if (!this.storeAvailable) {
      return { outcome: 'store_unavailable', message: 'The store is not responding right now.' };
    }

    const forced = this.nextPurchaseOutcome;
    if (forced !== null) {
      this.nextPurchaseOutcome = null;
      if (forced !== 'purchased') {
        return { outcome: forced, message: describeOutcome(forced) };
      }
    }

    const offer = findOfferByProductId(productId);
    if (offer === undefined) {
      // A product id with no offer is a configuration bug, not a user-facing failure.
      return { outcome: 'error', message: 'That plan is not available.' };
    }

    if (
      this.entitlement.plan === offer.plan &&
      this.entitlement.billingPeriod === offer.billingPeriod
    ) {
      return { outcome: 'already_owned', message: 'You are already subscribed to this plan.' };
    }

    const periodDays = offer.billingPeriod === 'yearly' ? YEAR_DAYS : MONTH_DAYS;
    const eligibleForTrial = offer.trialEligibleByDesign && this.trialEligible;

    this.entitlement = {
      plan: offer.plan,
      billingPeriod: offer.billingPeriod,
      // A trial is a distinct status, so the UI can say "free trial" only when one is running.
      status: eligibleForTrial ? 'trialing' : 'active',
      provider: 'development_mock',
      currentPeriodEnd: isoInDays(eligibleForTrial ? TRIAL_DAYS : periodDays, this.now),
      trialEnd: eligibleForTrial ? isoInDays(TRIAL_DAYS, this.now) : null,
      cancelAtPeriodEnd: false,
      isFamilyOrganizer: offer.plan === 'premium_family',
      capabilities: PLAN_CAPABILITIES[offer.plan],
    };

    // A new family plan starts with the organizer occupying seat one of six.
    if (offer.plan === 'premium_family') {
      this.seatUsage = { used: 1, limit: 6, pendingInvitations: 0 };
    }

    return { outcome: 'purchased', entitlement: this.entitlement };
  }

  async restore(): Promise<RestoreResult> {
    if (!this.online) {
      return { outcome: 'offline', message: 'You appear to be offline.' };
    }
    if (!this.storeAvailable) {
      return { outcome: 'store_unavailable', message: 'The store is not responding right now.' };
    }
    if (this.restorable === null) {
      return { outcome: 'nothing_to_restore' };
    }
    this.entitlement = this.restorable;
    return { outcome: 'restored', entitlement: this.restorable };
  }

  async openManagement(): Promise<boolean> {
    // There is no store to open. Returning false is what stops the Manage screen from claiming
    // otherwise.
    return false;
  }
}

function describeOutcome(outcome: PurchaseResult['outcome']): string {
  switch (outcome) {
    case 'cancelled':
      return 'Purchase cancelled.';
    case 'pending':
      return 'Your purchase is pending approval.';
    case 'declined':
      return 'The payment was declined by the store.';
    case 'already_owned':
      return 'You are already subscribed to this plan.';
    case 'store_unavailable':
      return 'The store is not responding right now.';
    case 'offline':
      return 'You appear to be offline.';
    case 'purchased':
      return 'Purchase complete.';
    case 'error':
      return 'Something went wrong. Please try again.';
  }
}
