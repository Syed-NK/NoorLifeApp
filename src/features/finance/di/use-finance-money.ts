import { useLocalization } from '@application/providers/localization-provider';

import {
  formatAmount,
  formatMinor,
  parseAmountToMinor,
  type AmountParse,
} from '../data/finance-format';
import type { FinanceCurrency } from '../data/finance-money';

/**
 * **The money contract every Finance surface uses** — issue #96.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Why a bound object rather than three imports ───────────────────────────
 * The currency and the locale are the two things every monetary rendering needs and the two a screen
 * is most likely to get subtly wrong: the wrong currency formats the right number with the wrong
 * exponent, and a forgotten locale silently pins the display to English while the rest of the app
 * moves. Binding both once per screen removes both mistakes from the call sites and leaves a single
 * place to assert they were bound from the right sources.
 *
 * `parse` sits beside `amount` deliberately. Reading and writing money are one contract seen from
 * two directions — a screen that formats with one exponent and parses with another is the exact
 * defect this issue closes — so they are handed out together rather than drifting apart.
 *
 * ── Why this is two functions and not one hook ─────────────────────────────
 * Every Finance screen returns early while the ledger is loading, faulted, or has no currency yet,
 * and only *after* those returns is the currency known to be non-null. A single hook taking the
 * narrowed currency would therefore be called conditionally, which React forbids — and the ways
 * around it are worse than the split: a `?? 'AED'` default is the "invalid currency falls back to
 * AED" defect this issue exists to prevent, and a nullable return puts a `!` at every call site.
 *
 * So the *hook* reads the locale unconditionally at the top of the component, and the *pure*
 * function binds it to the currency once that is known. The binding being pure is also what lets a
 * test state a locale and a currency directly, with no renderer involved.
 *
 * ── Where each half comes from ─────────────────────────────────────────────
 * The **currency** is the ledger's, passed in by a caller that has already narrowed it. It is never
 * read from the locale, the device or a symbol (#92).
 *
 * The **locale** is `LocalizationProvider`'s — the app's one authority on which locale is active,
 * which already owns direction and script for the same reason. No Finance surface reads
 * `I18nManager` or a device locale of its own, so when that provider changes, every amount
 * re-renders together rather than a screen at a time.
 *
 * ── What the locale may not touch ──────────────────────────────────────────
 * Presentation, and nothing else: not the stored integer, the selected currency, the minor-unit
 * exponent, a month key, an account id or a repository address. `finance-locale.ts` narrows it
 * further still — of the whole of a locale, money borrows two separator characters.
 * ═══════════════════════════════════════════════════════════════════════════
 */
export type FinanceMoney = {
  /** For display: grouped, in the locale's marks, signed, with the ISO code. */
  readonly amount: (minor: number) => string;
  /**
   * For seeding an editable field: plain digits and a `.`, no grouping.
   *
   * Deliberately not the display form. Grouping separators are exactly what the parser refuses as
   * malformed, so seeding an input with a formatted amount would hand the user a value their own
   * screen rejects the moment they saved it unedited.
   */
  readonly plain: (minor: number) => string;
  /** The same parser everywhere, already carrying this ledger's exponent. */
  readonly parse: (text: string) => AmountParse;
  /** The active locale, for a surface that must pass it to a pure copy module. */
  readonly locale: string;
};

/** The app's active locale. The only place a Finance surface may learn it. */
export function useFinanceLocale(): string {
  return useLocalization().locale;
}

/** Binds a ledger currency and an active locale into the one money contract. */
export function financeMoney(currency: FinanceCurrency, locale: string): FinanceMoney {
  return {
    amount: (minor: number) => formatAmount(minor, currency, locale),
    plain: (minor: number) => formatMinor(minor, currency),
    parse: (text: string) => parseAmountToMinor(text, currency),
    locale,
  };
}
