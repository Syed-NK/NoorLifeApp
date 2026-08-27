/**
 * **Money, as integers, in a currency the user chose** — issue #92.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Why minor units and never a float ──────────────────────────────────────
 * `0.1 + 0.2 !== 0.3` in every IEEE-754 language, and a ledger is exactly the place that
 * accumulates. Amounts are therefore stored as a positive integer count of the currency's smallest
 * unit — fils, cents, none at all — and the decimal point is a display concern that only appears at
 * the edge. Nothing in this module ever holds a fractional amount.
 *
 * ── Why the currency is chosen, never detected ─────────────────────────────
 * A device locale, a SIM, a timezone and a store region are all *guesses about where somebody is*,
 * and none of them is a statement about which currency their money is in. Someone in Dubai may
 * budget in GBP; a traveller's SIM says nothing about their bank. Inferring it would silently label
 * every amount they enter, and the label is not recoverable afterwards — 100 is 100 whether it meant
 * dirhams or pence.
 *
 * So there is no default, no fallback and no inference path in this file. A ledger without a
 * currency is *unconfigured*, which is a state the rest of the module handles, not an error to be
 * papered over.
 *
 * ── Why the code list is an allow-list ─────────────────────────────────────
 * Accepting any three uppercase letters would admit `XYZ`, and a stored amount under a code nothing
 * can interpret is worse than a refused one: it looks valid. Each entry carries its minor-unit
 * exponent, because that is the number every later conversion depends on and the one a `× 100`
 * assumption gets wrong — JPY has none, BHD, KWD and OMR have three, and three of those are
 * plausible for this audience.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * The currencies a ledger may be denominated in, with each one's minor-unit exponent.
 *
 * Deliberately a reviewed list rather than the whole of ISO 4217: every entry here is one somebody
 * decided to support, and adding one is a decision with a formatting consequence (#96). The three
 * exponent classes are all represented, so the boundary cases have real coverage rather than
 * theoretical.
 */
export const FINANCE_CURRENCIES = {
  AED: 2,
  SAR: 2,
  QAR: 2,
  EGP: 2,
  PKR: 2,
  INR: 2,
  MYR: 2,
  IDR: 2,
  TRY: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
  CAD: 2,
  AUD: 2,
  ZAR: 2,
  NGN: 2,
  /** Zero minor digits — a `× 100` assumption inflates these a hundredfold. */
  JPY: 0,
  KRW: 0,
  /** Three minor digits — a `× 100` assumption divides these by ten. */
  BHD: 3,
  KWD: 3,
  OMR: 3,
  TND: 3,
} as const;

export type FinanceCurrency = keyof typeof FINANCE_CURRENCIES;

/**
 * The largest amount a single transaction may hold, in minor units.
 *
 * `Number.MAX_SAFE_INTEGER` is 9,007,199,254,740,991, and arithmetic above it silently stops being
 * exact. A ledger sums its transactions, so the per-record ceiling has to leave room for **the whole
 * ledger at once**: this value times `MAX_FINANCE_TRANSACTIONS` is 5 × 10^15, inside the safe range
 * with room to spare, and a test asserts that product rather than trusting the arithmetic here.
 *
 * That constraint is what set the number, and it is worth recording why. An earlier draft used
 * 9 × 10^12 — a figure that reads like a sensible ceiling and whose full-ledger sum is 4.5 × 10^16,
 * five times past the point where addition stops being exact. The bound is not "a large number"; it
 * is the largest one whose total can still be added correctly.
 *
 * In a 2-digit currency it is 10 billion major units. A user who needs more than that is not the
 * user this module is for, and refusing the entry is better than storing a number the app cannot
 * add up.
 */
export const MAX_MINOR_UNITS = 1_000_000_000_000;

/** Whether a value is a currency this ledger supports. Fail-closed: unknown codes are refused. */
export function isFinanceCurrency(value: unknown): value is FinanceCurrency {
  return (
    typeof value === 'string' && Object.prototype.hasOwnProperty.call(FINANCE_CURRENCIES, value)
  );
}

/** How many digits follow the decimal point when this currency is written out. */
export function minorUnitDigits(currency: FinanceCurrency): number {
  return FINANCE_CURRENCIES[currency];
}

/**
 * Whether a value is a storable amount.
 *
 * Positive, integral and bounded. Zero is refused as well as negative: a transaction of nothing is
 * not a record, it is a mistake, and admitting it would put a row in a list that means nothing.
 *
 * Direction — expense or income — is carried by the transaction, never by the sign of the amount.
 * A signed amount invites two representations of the same fact and a `Math.abs` somewhere that
 * forgets which one it has.
 */
export function isStorableMinorAmount(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= MAX_MINOR_UNITS
  );
}
