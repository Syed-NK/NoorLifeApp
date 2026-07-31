import { PRODUCT_IDS, type ProductId } from './products';

/**
 * Price presentation.
 *
 * ── Why a fallback exists at all ────────────────────────────────────────────
 * The store is the authority on price: it localises currency, applies regional pricing and
 * handles tax. Until a store product resolves, the app still has to render a plan card, and a
 * blank price is worse than an honest approximate one.
 *
 * So every price has two forms. `LocalizedPrice.source` records which one is on screen, and the
 * UI is required to mark a fallback as approximate — because showing AED 19.99 to a user in
 * India as though it were their price would be a lie the store would then contradict at checkout.
 */
export type PriceSource = 'store' | 'fallback';

export type LocalizedPrice = {
  /** Ready to display, currency included, e.g. "AED 19.99". */
  readonly formatted: string;
  readonly currencyCode: string;
  readonly amount: number;
  readonly source: PriceSource;
};

/**
 * Design fallback prices, in AED.
 *
 * These are the approved figures for the initial design. They are **not** global prices, and
 * nothing may treat them as the amount a user will be charged.
 */
const FALLBACK_AED: Readonly<Record<ProductId, number>> = {
  [PRODUCT_IDS.singleMonthly]: 19.99,
  [PRODUCT_IDS.singleYearly]: 189.99,
  [PRODUCT_IDS.familyMonthly]: 39.99,
  [PRODUCT_IDS.familyYearly]: 379.99,
};

const FALLBACK_CURRENCY = 'AED';

export function fallbackPrice(productId: ProductId): LocalizedPrice {
  const amount = FALLBACK_AED[productId];
  return {
    amount,
    currencyCode: FALLBACK_CURRENCY,
    formatted: formatAmount(amount, FALLBACK_CURRENCY),
    source: 'fallback',
  };
}

/**
 * Formats without `Intl.NumberFormat`.
 *
 * Hermes ships a minimal ICU by default, so `Intl` currency formatting is not dependable across
 * the Android builds this app produces — it silently returns a different shape than on iOS. A
 * fixed two-decimal string with the code in front is predictable on both, and store-supplied
 * prices arrive pre-formatted by the store anyway, which is the path that matters in production.
 */
function formatAmount(amount: number, currencyCode: string): string {
  return `${currencyCode} ${amount.toFixed(2)}`;
}

/** Builds a store-sourced price from whatever the adapter reports. */
export function storePrice(
  formatted: string,
  amount: number,
  currencyCode: string,
): LocalizedPrice {
  return { formatted, amount, currencyCode, source: 'store' };
}

/**
 * Yearly saving against twelve monthly payments, as a whole percent.
 *
 * Computed from the two prices rather than hardcoded as "20%", so a store price change cannot
 * leave a stale savings badge claiming a discount that no longer exists. Returns null when the
 * currencies differ or the yearly price is not actually cheaper — either way there is no honest
 * single percentage to show.
 */
export function yearlySavingPercent(
  monthly: LocalizedPrice,
  yearly: LocalizedPrice,
): number | null {
  if (monthly.currencyCode !== yearly.currencyCode) {
    return null;
  }
  const twelveMonths = monthly.amount * 12;
  if (twelveMonths <= 0 || yearly.amount >= twelveMonths) {
    return null;
  }
  return Math.round(((twelveMonths - yearly.amount) / twelveMonths) * 100);
}

/** The yearly price expressed per month, for an honest like-for-like comparison. */
export function yearlyPerMonth(yearly: LocalizedPrice): LocalizedPrice {
  const amount = yearly.amount / 12;
  return {
    amount,
    currencyCode: yearly.currencyCode,
    formatted: formatAmount(amount, yearly.currencyCode),
    source: yearly.source,
  };
}

/** Formats an ISO date for renewal and expiry copy. Returns null when there is no date. */
export function formatRenewalDate(iso: string | null): string | null {
  if (iso === null) {
    return null;
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const months = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
}
