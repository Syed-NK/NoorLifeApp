/**
 * **What a locale is allowed to decide about money** — issue #96.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The one sentence this file implements ──────────────────────────────────
 * #96: "Formatting follows the device locale for grouping and decimal separators; the **currency
 * itself never does** — it is the ledger's, chosen once, per #92. A user reading in `de-DE` with a
 * `AED` ledger sees `1.234,56 AED`, not euros."
 *
 * So a locale may choose **two characters** and nothing else. It does not choose the currency, the
 * exponent, the digits, the stored integer or the ISO code. Keeping that list to two is what stops
 * "locale-aware formatting" from quietly becoming "locale-aware money".
 *
 * ── Why the numeral system is deliberately not locale's to choose ──────────
 * `Intl.NumberFormat('ar').format(1234.5)` is `١٬٢٣٤٫٥` — Arabic-Indic digits. That is a legitimate
 * rendering of the number, and it is the wrong one here: the amount sits beside a Latin ISO code
 * (`AED`), it is compared against figures elsewhere in the app that are Latin, and the app ships
 * English copy. A half-transliterated amount is harder to read than either consistent form.
 *
 * So the digits are always Western and always built by this module from the stored integer. Only the
 * *separators* are borrowed. That is a decision, recorded here rather than discovered later from a
 * screenshot.
 *
 * ── Why `Intl` is probed rather than trusted ───────────────────────────────
 * `subscription/domain/pricing.ts` records, from this project's own Android builds, that "Hermes
 * ships a minimal ICU by default, so `Intl` currency formatting is not dependable across the Android
 * builds this app produces". `shared/utils/format.ts` claims the opposite in its header. One of the
 * two is wrong on any given build, and money is not the place to find out.
 *
 * This module therefore never asks `Intl` to format money. It asks it one narrow question — *which
 * two characters does this locale separate numbers with* — validates the answer, and falls back to a
 * fixed, version-controlled pair if anything about it is unusable. A minimal-ICU build that returns
 * the root locale's separators produces `1,234.56 AED`, which is correct English formatting of the
 * right amount, rather than a wrong amount or a crash.
 *
 * ── Grouping is three digits, and that is checked against the supported set ──
 * The app's authoritative locale boundary is `LocalizationProvider`, whose `SupportedLocale` is
 * `'en' | 'ar'`. Both group by three. A locale that groups otherwise — `hi-IN` groups 2,2,3 — would
 * be rendered with three-digit groups by this module, so adding one to `SupportedLocale` means
 * revisiting this file. That limitation is stated rather than hidden, and a test pins the supported
 * set so the two cannot drift apart silently.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** The two characters a locale is permitted to choose. */
export type FinanceSeparators = {
  /** Between groups of three integer digits. */
  readonly group: string;
  /** Between the integer part and the minor units. */
  readonly decimal: string;
};

/**
 * The fallback, used when `Intl` is absent, throws, or answers with something unusable.
 *
 * Deterministic and version-controlled, so two devices that both fall back agree. English
 * separators, because the app's copy is English and its default locale is `en` — a fallback that
 * differed from the default locale would make the failure mode look like a feature.
 */
export const FALLBACK_SEPARATORS: FinanceSeparators = { group: ',', decimal: '.' };

/** How many integer digits sit in one group. Three for every locale this app supports. */
export const FINANCE_GROUP_SIZE = 3;

/**
 * A separator is usable when it is exactly one character and not a digit.
 *
 * A minimal ICU can answer with an empty string or omit the part entirely; a digit would corrupt the
 * number itself. Both are refused in favour of the fallback rather than rendered.
 */
function usable(candidate: string | undefined): candidate is string {
  return typeof candidate === 'string' && candidate.length === 1 && !/\d/.test(candidate);
}

/**
 * The separators this locale writes numbers with.
 *
 * Probed with a number chosen to force both parts to exist: `11111.1` has four group boundaries in
 * a three-digit scheme and a fraction, so a formatter that produces either part at all produces it
 * here. Never throws — every failure resolves to `FALLBACK_SEPARATORS`.
 */
export function financeSeparators(locale: string): FinanceSeparators {
  try {
    const formatter = new Intl.NumberFormat(locale, {
      useGrouping: true,
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });
    /* `formatToParts` is the only shape that names the characters rather than embedding them. */
    if (typeof formatter.formatToParts !== 'function') {
      return FALLBACK_SEPARATORS;
    }
    const parts = formatter.formatToParts(11111.1);
    const group = parts.find((part) => part.type === 'group')?.value;
    const decimal = parts.find((part) => part.type === 'decimal')?.value;
    if (!usable(group) || !usable(decimal) || group === decimal) {
      /*
        `group === decimal` is incoherent — the same character cannot mean both — and rendering it
        would produce an amount nobody could read back. Refused rather than shown.
      */
      return FALLBACK_SEPARATORS;
    }
    return { group, decimal };
  } catch {
    return FALLBACK_SEPARATORS;
  }
}

/**
 * Groups a run of Western digits from the right.
 *
 * Takes and returns a string. The integer part of a ledger amount can be eleven digits at #92's
 * bound, and every arithmetic route to grouping — repeated division, `toLocaleString` on a number —
 * either loses exactness or hands the value to a float. Slicing a string does neither.
 */
export function groupDigits(digits: string, separator: string): string {
  if (separator === '' || digits.length <= FINANCE_GROUP_SIZE) {
    return digits;
  }
  const head = digits.length % FINANCE_GROUP_SIZE;
  const groups: string[] = [];
  if (head > 0) {
    groups.push(digits.slice(0, head));
  }
  for (let index = head; index < digits.length; index += FINANCE_GROUP_SIZE) {
    groups.push(digits.slice(index, index + FINANCE_GROUP_SIZE));
  }
  return groups.join(separator);
}
