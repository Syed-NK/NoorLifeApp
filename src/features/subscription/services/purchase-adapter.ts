import type { Entitlement } from '../domain/entitlement';
import type { LocalizedPrice } from '../domain/pricing';
import type { PlanOffer, ProductId } from '../domain/products';

/**
 * The store boundary.
 *
 * Everything platform-specific lives behind this interface: StoreKit, Google Play Billing, or a
 * RevenueCat SDK that wraps both. Screens never see it — they talk to the entitlement service,
 * which talks to one adapter.
 *
 * The consequence worth stating: swapping the mock for RevenueCat is a new file implementing this
 * interface plus one line where the adapter is chosen. No screen changes.
 */

/**
 * How a purchase attempt ended.
 *
 * `cancelled` is a first-class outcome, not an error. A user backing out of the platform sheet
 * has done nothing wrong, and the brief is explicit that it must return them safely to the plan
 * screen — so it cannot travel as a thrown exception that some caller renders as "Something went
 * wrong".
 *
 * `pending` covers deferred payment methods, which Google Play genuinely has: the purchase is not
 * complete and entitlement must not be granted, but nothing has failed either.
 */
export type PurchaseOutcome =
  | 'purchased'
  | 'cancelled'
  | 'pending'
  | 'declined'
  | 'already_owned'
  | 'store_unavailable'
  | 'offline'
  | 'error';

export type PurchaseResult = {
  readonly outcome: PurchaseOutcome;
  /** The resulting entitlement. Present only on `purchased`. */
  readonly entitlement?: Entitlement;
  /** Plain-language detail for the UI. Never a raw store error string. */
  readonly message?: string;
};

export type RestoreOutcome =
  'restored' | 'nothing_to_restore' | 'store_unavailable' | 'offline' | 'error';

export type RestoreResult = {
  readonly outcome: RestoreOutcome;
  readonly entitlement?: Entitlement;
  readonly message?: string;
};

/** A plan offer with its resolved price attached. */
export type PricedOffer = PlanOffer & {
  readonly price: LocalizedPrice;
  /**
   * Whether *this user* is eligible for the introductory trial, as the store reports it.
   *
   * Distinct from `trialEligibleByDesign`, which only says the offer has a trial configured. A
   * returning subscriber is not eligible even on a yearly offer, and the brief forbids showing a
   * fake eligibility state — so the UI must read this, never the design flag.
   */
  readonly trialEligibleForUser: boolean;
};

export type PurchaseAdapter = {
  /** Stable id for diagnostics and for labelling mock mode in development. */
  readonly id: 'mock' | 'revenuecat' | 'storekit' | 'play-billing';
  /** False when the adapter cannot transact — no store credentials, no products configured. */
  readonly canTransact: boolean;

  /** Offers with store prices where available, design fallbacks otherwise. */
  getOffers(): Promise<readonly PricedOffer[]>;

  /** The current entitlement as the store and backend understand it. */
  getEntitlement(): Promise<Entitlement>;

  /**
   * Opens the platform purchase sheet.
   *
   * Implementations must resolve, never reject, for the outcomes above — a cancellation is a
   * result, not a thrown error.
   */
  purchase(productId: ProductId): Promise<PurchaseResult>;

  restore(): Promise<RestoreResult>;

  /**
   * Hands off to the store's own subscription management.
   *
   * Returns false when there is nowhere to go, so the caller can avoid claiming NoorLife can
   * cancel a subscription it cannot reach.
   */
  openManagement(): Promise<boolean>;
};
