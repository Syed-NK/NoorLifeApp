import type { FinanceChange } from './finance-comparison';
import { formatAmount } from './finance-format';
import { formatMonth, type FinanceMonth } from './finance-month';
import type { FinanceCurrency } from './finance-money';

/**
 * **The words the comparison is stated in** — issue #102.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Why the copy is a pure module and not strings in the screen ────────────
 * "Not judgemental" is a property of *sentences*, and a property no rendering test can check
 * thoroughly if the sentences are assembled inline among the views. Here they are one function over
 * one derived value, so the whole vocabulary is enumerable — and a test can assert that no
 * comparison, in any state, produces "better", "worse", "overspending", "on track" or a forecast.
 *
 * ── The direction is a word, and the glyph is decoration ───────────────────
 * Every phrase names its direction — "more", "less", "higher", "lower", "the same" — before any
 * glyph or colour is involved. That is #93's rule for the signed net, applied again: two hues alone
 * leave a colour-blind reader unable to tell an increase from a decrease, and a greyscale screenshot
 * unable to say anything at all. The glyph accompanies the word; it never replaces it, and the
 * screen gives it no colour of its own.
 *
 * ── No percentage is written where none exists ─────────────────────────────
 * `percent` is `null` for a zero baseline, and the sentence stands complete without it. There is no
 * branch that formats `percentTenths` without checking it first, so "+∞%", "NaN%" and the invented
 * "+100%" have nowhere to come from.
 *
 * ── Tenths are formatted by string arithmetic ──────────────────────────────
 * `abs / 10` in a template literal is a float, and this module goes to some trouble elsewhere never
 * to hold one. The whole part and the tenth are separated by integer division and concatenated,
 * which is `finance-format.ts`'s approach for the same reason and gives the same guarantee.
 *
 * A movement that rounds to less than a tenth of a percent is said as "under 0.1%", not as "0%". A
 * zero percentage beside a non-zero amount reads as a contradiction, and the user would be right to
 * distrust the figure next to it.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** What a change is *about* — chosen per figure, so the sentences read naturally. */
export type ComparisonSubject = {
  /** The thing being compared, lower case, for absence sentences. "spending", "income". */
  readonly noun: string;
  /** The word for an increase. "more" for a magnitude, "higher" for the signed net. */
  readonly up: string;
  /** The word for a decrease. */
  readonly down: string;
};

export const SPENDING_SUBJECT: ComparisonSubject = { noun: 'spending', up: 'more', down: 'less' };
export const INCOME_SUBJECT: ComparisonSubject = { noun: 'income', up: 'more', down: 'less' };
/** The net is signed, so it moves up and down rather than being more or less of something. */
export const NET_SUBJECT: ComparisonSubject = { noun: 'net', up: 'higher', down: 'lower' };

export type ComparisonPhrasing = {
  /** Accompanies the wording. Never the only carrier of direction, and never coloured. */
  readonly glyph: string;
  /** The whole statement, absolute figure included. Complete on its own. */
  readonly sentence: string;
  /** The percentage clause, or `null` when no percentage is defined. */
  readonly percent: string | null;
};

/** Tenths of a percent as text, by integer arithmetic. `125` becomes `12.5%`, `120` becomes `12%`. */
export function formatPercentTenths(tenths: number): string {
  const magnitude = Math.abs(tenths);
  const whole = Math.trunc(magnitude / 10);
  const tenth = magnitude % 10;
  return tenth === 0 ? `${whole}%` : `${whole}.${tenth}%`;
}

/**
 * The percentage clause, or `null`.
 *
 * `null` in, `null` out — the absence travels rather than being replaced somewhere downstream.
 */
export function percentClause(change: FinanceChange, subject: ComparisonSubject): string | null {
  const { percentTenths, differenceMinor } = change;
  if (percentTenths === null) {
    return null;
  }
  if (differenceMinor === 0) {
    return null;
  }
  const word = differenceMinor > 0 ? subject.up : subject.down;
  if (percentTenths === 0) {
    /* Rounded below a tenth, but the amount really did move. Saying "0%" beside it reads as a lie. */
    return `under 0.1% ${word}`;
  }
  return `${formatPercentTenths(percentTenths)} ${word}`;
}

/**
 * A change, stated plainly.
 *
 * One sentence per trend, and the trends are exhaustive — a state this does not describe is a
 * compile error, not a blank line on somebody's screen.
 */
export function describeChange(
  change: FinanceChange,
  subject: ComparisonSubject,
  currency: FinanceCurrency,
  previous: FinanceMonth,
): ComparisonPhrasing {
  const previousName = formatMonth(previous);
  const amount = formatAmount(Math.abs(change.differenceMinor), currency);
  const percent = percentClause(change, subject);

  switch (change.trend) {
    case 'no-activity':
      return { glyph: '=', sentence: `No ${subject.noun} in either month`, percent: null };
    case 'new-activity':
      /*
        The case that makes most comparison features lie. There is no previous figure to be a
        percentage of, so the sentence carries the absolute amount and stops.
      */
      return {
        glyph: '+',
        sentence: `New ${subject.noun} activity this month — ${formatAmount(change.currentMinor, currency)}, with none in ${previousName}`,
        percent: null,
      };
    case 'ceased-activity':
      return {
        glyph: '↓',
        sentence: `No ${subject.noun} this month — ${amount} ${subject.down} than ${previousName}`,
        percent,
      };
    case 'unchanged':
      return { glyph: '=', sentence: `The same as ${previousName}`, percent: null };
    case 'increase':
      return { glyph: '↑', sentence: `${amount} ${subject.up} than ${previousName}`, percent };
    case 'decrease':
      return { glyph: '↓', sentence: `${amount} ${subject.down} than ${previousName}`, percent };
  }
}

/**
 * The same statement without the month name, for a list inside a heading that already names both.
 *
 * A separate function rather than a flag on `describeChange`, so both forms are enumerable by the
 * test that proves no comparison anywhere produces a judgement — a variant hidden behind a boolean
 * is a variant that gets forgotten.
 */
export function describeMovement(
  change: FinanceChange,
  subject: ComparisonSubject,
  currency: FinanceCurrency,
): ComparisonPhrasing {
  const amount = formatAmount(Math.abs(change.differenceMinor), currency);
  const percent = percentClause(change, subject);

  switch (change.trend) {
    case 'no-activity':
      return { glyph: '=', sentence: `No ${subject.noun} in either month`, percent: null };
    case 'new-activity':
      return {
        glyph: '+',
        sentence: `New — ${formatAmount(change.currentMinor, currency)}, none last month`,
        percent: null,
      };
    case 'ceased-activity':
      return { glyph: '↓', sentence: `Nothing this month — ${amount} ${subject.down}`, percent };
    case 'unchanged':
      return { glyph: '=', sentence: 'The same', percent: null };
    case 'increase':
      return { glyph: '↑', sentence: `${amount} ${subject.up}`, percent };
    case 'decrease':
      return { glyph: '↓', sentence: `${amount} ${subject.down}`, percent };
  }
}

/**
 * The whole phrasing as one line, for a screen reader.
 *
 * Assembled here rather than at the call site so the announcement and the visible text cannot drift
 * apart — and so the percentage is omitted from the announcement in exactly the states where it is
 * omitted from the screen.
 */
export function announceChange(label: string, phrasing: ComparisonPhrasing): string {
  return phrasing.percent === null
    ? `${label}: ${phrasing.sentence}`
    : `${label}: ${phrasing.sentence}, ${phrasing.percent}`;
}
