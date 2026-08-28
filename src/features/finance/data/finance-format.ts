import { financeSeparators, groupDigits } from './finance-locale';
import {
  FINANCE_CURRENCIES,
  MAX_MINOR_UNITS,
  minorUnitDigits,
  type FinanceCurrency,
} from './finance-money';

/**
 * **Typed text to minor units, and back, without ever touching a float** — issue #93.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Why parsing is string work, not arithmetic ─────────────────────────────
 * The obvious implementation is `Math.round(parseFloat(text) * 100)`, and it is wrong in a way that
 * only shows up on some inputs. `parseFloat('1.005') * 100` is `100.49999999999999`, which rounds to
 * `100` — a cent short, silently, on a number the user typed exactly. `0.1 + 0.2` is the famous
 * case; `1.005` is the one that reaches a ledger.
 *
 * So the decimal point is never crossed by arithmetic. The text is split on its separator, the
 * fraction is padded or rejected against the currency's own exponent, and the two halves are
 * concatenated into a single integer string that `Number` can hold exactly. There is no `parseFloat`
 * and no `* 100` anywhere in this file, and a test asserts that from the source as well as from the
 * results.
 *
 * ── Why over-precision is refused, not rounded ─────────────────────────────
 * `12.345` in a 2-digit currency is not 12.34 and not 12.35 — it is an amount the user has not
 * finished deciding. Rounding it silently picks one for them and loses the difference; refusing it
 * says so. Currencies with 0 minor digits refuse *any* fraction, which is the JPY case a `× 100`
 * assumption gets wrong in the other direction.
 *
 * ── Formatting is deliberately minimal here ────────────────────────────────
 * Grouping separators, locale-aware decimal marks and negative presentation are #96's scope. What
 * this file guarantees today is that the digits are right and the code is shown — a number that is
 * correct and plainly formatted, rather than one that is prettily wrong.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export type AmountParse =
  | { readonly kind: 'ok'; readonly minor: number }
  | {
      readonly kind: 'invalid';
      readonly reason: 'empty' | 'malformed' | 'too-precise' | 'not-positive' | 'too-large';
    };

/** Digits, one optional separator, digits. Nothing else — no sign, no spaces, no grouping. */
const AMOUNT_PATTERN = /^(\d*)(?:[.,](\d*))?$/;

/**
 * Parses what the user typed into an exact integer count of minor units.
 *
 * Accepts `.` or `,` as the separator, because a keyboard offers whichever the device prefers and
 * the user should not have to know which one this field wanted.
 */
export function parseAmountToMinor(text: string, currency: FinanceCurrency): AmountParse {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return { kind: 'invalid', reason: 'empty' };
  }

  const match = AMOUNT_PATTERN.exec(trimmed);
  if (match === null) {
    return { kind: 'invalid', reason: 'malformed' };
  }

  const whole = match[1] ?? '';
  const fraction = match[2] ?? '';
  if (whole.length === 0 && fraction.length === 0) {
    return { kind: 'invalid', reason: 'malformed' };
  }

  const digits = minorUnitDigits(currency);
  if (fraction.length > digits) {
    /*
      Refused rather than rounded. `12.345` in a 2-digit currency is not 12.34 and not 12.35; picking
      one silently loses the difference and does it without telling anybody.
    */
    return { kind: 'invalid', reason: 'too-precise' };
  }

  /*
    One integer string, built by concatenation. The decimal point is never crossed by arithmetic, so
    there is no representation error to round away.
  */
  const combined = `${whole === '' ? '0' : whole}${fraction.padEnd(digits, '0')}`;
  if (combined.length > 16) {
    /* Longer than any safe integer, before `Number` gets a chance to lose precision. */
    return { kind: 'invalid', reason: 'too-large' };
  }

  const minor = Number(combined);
  if (!Number.isSafeInteger(minor)) {
    return { kind: 'invalid', reason: 'too-large' };
  }
  if (minor <= 0) {
    return { kind: 'invalid', reason: 'not-positive' };
  }
  if (minor > MAX_MINOR_UNITS) {
    return { kind: 'invalid', reason: 'too-large' };
  }
  return { kind: 'ok', minor };
}

/**
 * Renders minor units back as text, exactly.
 *
 * Integer division and a padded remainder — again no float, so a round trip through
 * `parseAmountToMinor` returns the same integer it started from.
 */
export function formatMinor(minor: number, currency: FinanceCurrency): string {
  const { sign, whole, fraction } = splitMinor(minor, currency);
  return fraction === '' ? `${sign}${whole}` : `${sign}${whole}.${fraction}`;
}

/**
 * A stored amount split into the three pieces every rendering needs — issue #96.
 *
 * **String work, never arithmetic.** The obvious implementation divides by `10 ** digits` and takes
 * a remainder, and that is where the previous formatter broke: `Math.trunc(-5050 / 100)` is `-50`
 * and `-5050 % 100` is `-50`, so the amount rendered as `-50.-50` — a minus sign inside the
 * fraction, on a string nobody could read and no test had asked for. Every call site was passing
 * `Math.abs` to avoid it, which meant the bug was one forgotten `Math.abs` away from a user's screen
 * at all times.
 *
 * Padding the decimal string and slicing it has no sign to lose and no division to round: the digits
 * of the integer *are* the digits of the amount, and where the point falls is the currency's
 * exponent. It is exact for every value the ledger can hold, including the `10^12` bound.
 */
function splitMinor(
  minor: number,
  currency: FinanceCurrency,
): { readonly sign: string; readonly whole: string; readonly fraction: string } {
  const digits = minorUnitDigits(currency);
  const sign = minor < 0 ? MINUS : '';
  /* `Math.abs` on a safe integer is exact, and this is the only place the sign is ever removed. */
  const raw = String(Math.abs(minor));
  if (digits === 0) {
    return { sign, whole: raw, fraction: '' };
  }
  const padded = raw.padStart(digits + 1, '0');
  return {
    sign,
    whole: padded.slice(0, padded.length - digits),
    fraction: padded.slice(padded.length - digits),
  };
}

/**
 * The typographic minus, U+2212.
 *
 * The same character the signed comparison rows already prefix, so a negative produced *by the
 * formatter* and a sign applied *by a caller* are visually identical — which is what makes "one sign,
 * never two" something a test can state rather than a convention to remember.
 */
const MINUS = '−';

/**
 * The amount as a user reads it: grouped, in the locale's marks, with its currency code.
 *
 * ── The code, never a symbol ───────────────────────────────────────────────
 * `$` is ambiguous across four supported currencies, `¥` across two, and a symbol chosen by locale
 * would contradict the ledger's own currency — the inference #92 exists to refuse. `Intl`'s currency
 * style does exactly that: `en-US`/`JPY` renders `¥12`, and `ar-AE`/`AED` renders a right-to-left
 * marked `د.إ.‏`. Both are the right currency and the wrong contract, so this appends the ISO code
 * itself and asks `Intl` only which two characters separate the digits.
 *
 * ── Exactness is never handed to a float ───────────────────────────────────
 * The integer is split into digit strings and grouped as strings. `10^12` minor units — the ledger's
 * per-record bound — is `10,000,000,000.00`; taking it through a major-unit `number` would work
 * today and stop being exact the moment the bound moved, which is precisely the class of defect
 * #96 exists to close.
 *
 * The locale defaults to `en` so this stays callable from pure modules and tests; production
 * surfaces pass the app's authoritative locale through `useFinanceMoney`.
 */
export function formatAmount(
  minor: number,
  currency: FinanceCurrency,
  locale: string = 'en',
): string {
  const { sign, whole, fraction } = splitMinor(minor, currency);
  const { group, decimal } = financeSeparators(locale);
  const grouped = groupDigits(whole, group);
  const number = fraction === '' ? grouped : `${grouped}${decimal}${fraction}`;
  return `${sign}${number} ${currency}`;
}

/** Every supported currency with its display name, for the setup list. Searchable by both. */
export const FINANCE_CURRENCY_NAMES: Readonly<Record<FinanceCurrency, string>> = {
  AED: 'UAE Dirham',
  SAR: 'Saudi Riyal',
  QAR: 'Qatari Riyal',
  EGP: 'Egyptian Pound',
  PKR: 'Pakistani Rupee',
  INR: 'Indian Rupee',
  MYR: 'Malaysian Ringgit',
  IDR: 'Indonesian Rupiah',
  TRY: 'Turkish Lira',
  USD: 'US Dollar',
  EUR: 'Euro',
  GBP: 'Pound Sterling',
  CAD: 'Canadian Dollar',
  AUD: 'Australian Dollar',
  ZAR: 'South African Rand',
  NGN: 'Nigerian Naira',
  JPY: 'Japanese Yen',
  KRW: 'South Korean Won',
  BHD: 'Bahraini Dinar',
  KWD: 'Kuwaiti Dinar',
  OMR: 'Omani Rial',
  TND: 'Tunisian Dinar',
};

export type CurrencyOption = {
  readonly code: FinanceCurrency;
  readonly name: string;
};

/**
 * The currency list, filtered by a query over code and name.
 *
 * An app-owned registry rather than a runtime enumeration: `Intl.supportedValuesOf('currency')` is
 * not available on every Hermes build this app ships to, and a list that exists on one device and
 * not another is worse than a shorter one that is always there. It is also the same list the domain
 * validates against, so the picker cannot offer a code the repository would refuse.
 */
export function searchCurrencies(query: string): readonly CurrencyOption[] {
  const codes = Object.keys(FINANCE_CURRENCIES) as FinanceCurrency[];
  const all = codes.map((code) => ({ code, name: FINANCE_CURRENCY_NAMES[code] }));
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) {
    return all;
  }
  return all.filter(
    (option) =>
      option.code.toLowerCase().includes(needle) || option.name.toLowerCase().includes(needle),
  );
}
