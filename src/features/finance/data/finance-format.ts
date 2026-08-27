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
  const digits = minorUnitDigits(currency);
  if (digits === 0) {
    return String(minor);
  }
  const scale = 10 ** digits;
  const whole = Math.trunc(minor / scale);
  const fraction = String(minor % scale).padStart(digits, '0');
  return `${whole}.${fraction}`;
}

/**
 * The amount as a user reads it, with its currency code.
 *
 * The code, not a symbol: `$` is ambiguous across four supported currencies and a symbol chosen by
 * locale would contradict the ledger's own currency — the inference this module exists to refuse.
 * Grouping and locale marks are #96.
 */
export function formatAmount(minor: number, currency: FinanceCurrency): string {
  return `${formatMinor(minor, currency)} ${currency}`;
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
