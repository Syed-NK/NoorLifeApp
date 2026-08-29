import { textWidthEm } from './hero-copy-fit';

/**
 * How many columns a summary card's metrics may share — issue #125.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The defect this replaces ───────────────────────────────────────────────
 * `ModuleSummaryCard` gave every metric `flex: 1` in a fixed row, so three metrics each got exactly
 * a third of the card whatever they contained. A count fits that. A formatted amount does not: at
 * the OS text size 1.5, Finance rendered `129.35…` and `0.00 P…` on a phone and `64.20 …` on a
 * wider emulator — the emulator truncating a **shorter** amount than the phone, which is the tell
 * that the third, not the screen, was the constraint.
 *
 * A summary that hides digits or the currency code is worse than one that is taller, so the layout
 * gives way instead of the number.
 *
 * ── Why this measures the content ──────────────────────────────────────────
 * `shouldStackTwoColumn` answers a similar question with a fixed threshold, and says why: the
 * strings it guards are observance names and prayer labels, which change with the day, so a
 * content-measuring rule there would make the same device stack on one date and not the next.
 *
 * A money value is the opposite case. `0 JPY` and `-1,234,567.890 KWD` differ by a factor of four in
 * width, they are decided by the user's own ledger rather than by the calendar, and no threshold can
 * be right for both. So this rule measures, using the same `hmtx` advance tables the hero fit rule
 * already trusts in production — whose error against two devices was bounded under 0.67%.
 *
 * The result is still deterministic: the same values at the same width and text size always give the
 * same column count, on every device, with no rendered pixel consulted.
 *
 * ── What it deliberately does not do ───────────────────────────────────────
 * It does not shorten, round, abbreviate or re-format anything, and it cannot: it receives the
 * finished strings and answers only with a number of columns. Every fidelity guarantee in #96 —
 * exact minor units, the ISO code, one sign, no compact notation — is upstream of this file and
 * untouched by it.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * The rendering margin a column keeps over its widest value.
 *
 * The same 1.02 the hero copy rule uses, and for the same reason: the advance tables predict the
 * boundary at exactly 1.0, two device observations bracketed the model's error under 0.67%, and
 * three times that error is the margin. It buys room for a device whose shaping differs slightly
 * from the tables — not room for a value that merely "almost fits".
 */
export const summaryColumnHeadroom = 1.02;

/** One metric, reduced to the two strings that decide how wide its column has to be. */
export type SummaryItemFit = {
  readonly value: string;
  readonly unit?: string;
};

export type SummaryFitInput = {
  readonly items: readonly SummaryItemFit[];
  /** Width the metrics share: the card's own width less its padding. */
  readonly availableWidth: number;
  /** Horizontal gap between two columns, at the current layout scale. */
  readonly columnGap: number;
  /** Gap between a value and its unit, at the current layout scale. */
  readonly valueGap: number;
  /** Layout-scaled `fontSize` of the value and the unit, before the OS text size. */
  readonly valueFontSize: number;
  readonly unitFontSize: number;
  /** The OS text size, and the cap the value's own `maxFontSizeMultiplier` puts on it. */
  readonly fontScale: number;
  readonly valueMaxMultiplier: number;
};

/**
 * Rendered width of one metric's value row, in dp.
 *
 * The unit sits beside the value on the same baseline, so it and its gap are part of the same
 * requirement — a column wide enough for `129.35` and too narrow for `129.35 PKR` is the defect.
 */
function valueRowWidth(item: SummaryItemFit, input: SummaryFitInput): number {
  const multiplier = Math.min(input.fontScale, input.valueMaxMultiplier);
  const value = textWidthEm(item.value, 'semiBold') * input.valueFontSize * multiplier;
  if (item.unit === undefined) return value;
  /*
    The unit carries no `maxFontSizeMultiplier`, so it grows with the full OS text size. Using the
    value's cap for both would understate exactly the case this rule exists for.
  */
  const unit = textWidthEm(item.unit, 'medium') * input.unitFontSize * input.fontScale;
  return value + input.valueGap + unit;
}

/**
 * How many columns the metrics may share before a value would have to be cut.
 *
 * Tries the compact arrangement first and steps down — `n` columns, then two, then one — so a card
 * whose values all fit keeps exactly the layout it has today. The step to two produces the
 * "two-plus-one" shape for three metrics, because the row wraps rather than re-balancing.
 *
 * One is the floor and is always returned rather than zero: a single column gets the whole card, and
 * if a value is still too wide for that it wraps, which is why the component no longer limits it to
 * one line. There is no arrangement in which a digit is dropped.
 */
export function summaryColumns(input: SummaryFitInput): number {
  const count = input.items.length;
  if (count <= 1) return 1;

  const widest = Math.max(...input.items.map((item) => valueRowWidth(item, input)));

  // Descending, deduplicated: the full row, then a pair, then a stack.
  const candidates = [...new Set([count, 2, 1])].filter((columns) => columns <= count);

  for (const columns of candidates) {
    const columnWidth = (input.availableWidth - input.columnGap * (columns - 1)) / columns;
    if (columnWidth >= widest * summaryColumnHeadroom) return columns;
  }
  return 1;
}
