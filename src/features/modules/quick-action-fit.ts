import { textWidthEm } from './hero-copy-fit';

/**
 * How many columns the quick-action row may use before its labels stop fitting — issue #52.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The defect ─────────────────────────────────────────────────────────────
 * The row lays its tiles out as one flex row, so the column count is however many actions the
 * module registered — three, for every module that renders it. Each tile spends 40 dp of its width
 * on chrome (two 8 dp paddings, a 26 dp icon well and a 6 dp gap), which at 320 dp leaves **52.7 dp**
 * for text. The label is `numberOfLines={2}` and, unlike the hero headline, sets no
 * `maxFontSizeMultiplier`, so at OS text size 1.5 it renders at 13.5 dp.
 *
 * At that size "Memories" is 67.2 dp as a single word. A word wider than its line has nowhere to
 * break, so Android split it — `Memor / ies` — and "Ask Family AI" needed a third line it was not
 * allowed, so it ellipsised to `Ask / Famil…`. Measured on the emulator at 320 dp and scale 1.5.
 *
 * The audit found the same failure well beyond the reported cell: at OS scale 1.5 every tested width
 * splits or clips something, 411 dp included. Only scale 1.0 is clean everywhere.
 *
 * ── The rule ───────────────────────────────────────────────────────────────
 * One shared predicate, evaluated per row from the labels that row was actually given: use the most
 * columns the row can have while **every** label renders unsplit inside the line clamp. Three
 * columns are kept wherever they work — which is every module at OS scale 1.0 — and the row falls to
 * two, or to one, only where the copy genuinely does not fit. The tiles stay equal-width and in
 * source order; the grid simply wraps onto another line, which is why the row is allowed to grow
 * vertically.
 *
 * Reducing columns is the only lever that can work. More lines cannot help "Memories": it is one
 * word, and no line count makes a word narrower than itself. Shrinking type is excluded by the
 * issue, and shortening the label would be fitting the product to the layout rather than the other
 * way round.
 *
 * ── Why the measurement is exact ───────────────────────────────────────────
 * Advance widths come from `hero-copy-fit.ts`, whose tables are generated from the committed Poppins
 * TTFs and drift-checked against them. `quickAction` resolves to Poppins **Medium**, which is
 * already one of the three faces there, so nothing is duplicated here.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * Slack a column must have beyond the narrowest box its labels can use, in dp.
 *
 * ── Absolute, because what it covers is absolute ────────────────────────────
 * The thing this guards against is layout rounding. React Native resolves a fractional tile width to
 * whole physical pixels, which is at most 0.31 dp on the densest screen here (540 dpi) and 0.18 dp on
 * the phone — a fixed quantity, not a percentage of anything. A proportional margin would reserve
 * four times as much on a wide tile as on a narrow one, in the opposite direction to where the risk
 * actually is.
 *
 * ── Why 1 dp, measured ─────────────────────────────────────────────────────
 * The model was first written without the card's 1 dp border, and the device caught it: a 384 dp tile
 * was predicted at 110.7 dp and measured at 108.4. With the border in the chrome the prediction is
 * within 0.3 dp of the device, so the only unknown left is rounding.
 *
 * 1 dp is about three times the worst rounding, and it is the smallest value that reaches a plateau:
 * across every registered action, three widths and three text sizes, it lifts the worst *true* slack
 * from 0.73 dp to **1.73 dp**, and raising it to 1.5 or 2 dp buys no further slack and no different
 * decision. Every production row's column count is identical at 0, 0.5, 1, 1.5 and 2 dp — the one
 * decision that moves is Faith at 320 dp and text size 1.5, a row that is registered but never
 * rendered through this component, and it moves in the safe direction.
 */
export const quickActionRoundingAllowanceDp = 1;

export type QuickActionFitInput = {
  /** The labels this row will render, in source order. */
  readonly labels: readonly string[];
  /** Width available to the row, at the current layout scale. */
  readonly contentWidth: number;
  /** Gap between tiles, already scaled. */
  readonly columnGap: number;
  /** Everything a tile spends on its own chrome: both paddings, the icon well and the inner gap. */
  readonly tileChromeWidth: number;
  /** Resolved `quickAction` font size at the current layout scale. */
  readonly fontSize: number;
  /** The OS text-size setting. */
  readonly fontScale: number;
  /** Lines the label is allowed to take. */
  readonly maxLines: number;
};

/**
 * The OS scale as the label applies it.
 *
 * Uncapped: the label sets no `maxFontSizeMultiplier`, so it grows with the setting without limit,
 * and that is the whole reason a row that fits at 1.0 does not fit at 1.3. Clamped below at 1 for
 * the same reason `shouldStackTwoColumn` is — text smaller than default is not a reason to change
 * shape.
 */
function appliedScale(fontScale: number): number {
  return Math.max(fontScale, 1);
}

/** Width available for label text in one tile, at a given column count. */
export function quickActionTextBox(
  input: Pick<QuickActionFitInput, 'contentWidth' | 'columnGap' | 'tileChromeWidth'>,
  columns: number,
): number {
  const tile = (input.contentWidth - input.columnGap * (columns - 1)) / columns;
  return tile - input.tileChromeWidth;
}

/**
 * Whether one label renders inside `box` without splitting a word or exceeding the clamp.
 *
 * Greedy word wrapping, which is what the platform does. A word wider than the box is reported as
 * *not* fitting rather than as a line of its own, because that is precisely the case where Android
 * breaks between letters.
 */
export function quickActionLabelFits(
  label: string,
  box: number,
  fontSize: number,
  maxLines: number,
): boolean {
  const words = label.split(/\s+/).filter((word) => word !== '');
  if (words.length === 0) {
    return true;
  }
  const space = textWidthEm(' ', 'medium') * fontSize;
  if (words.some((word) => textWidthEm(word, 'medium') * fontSize > box)) {
    return false;
  }
  let lines = 1;
  let used = 0;
  for (const word of words) {
    const width = textWidthEm(word, 'medium') * fontSize;
    if (used === 0) {
      used = width;
      continue;
    }
    if (used + space + width <= box) {
      used += space + width;
    } else {
      lines += 1;
      used = width;
    }
  }
  return lines <= maxLines;
}

/**
 * The narrowest box in which a label still renders unsplit inside the clamp.
 *
 * Bisected rather than derived in closed form: the minimal box for a given line count is a
 * line-breaking optimum, and bisection over a monotone predicate gets it exactly enough — to a
 * thousandth of a dp — without a second wrapping implementation to keep in step with the first.
 */
export function quickActionMinimumBox(label: string, fontSize: number, maxLines: number): number {
  let low = 0;
  let high = textWidthEm(label, 'medium') * fontSize + 1;
  for (let step = 0; step < 60; step += 1) {
    const mid = (low + high) / 2;
    if (quickActionLabelFits(label, mid, fontSize, maxLines)) {
      high = mid;
    } else {
      low = mid;
    }
  }
  return high;
}

/**
 * How many columns this row may use.
 *
 * The most it can have while every label clears its box with headroom, never more than one column
 * per action and never fewer than one. Pure and exported so the rule can be asserted directly
 * rather than inferred from a rendered tree — the same shape as `shouldStackTwoColumn` and
 * `shouldWidenHeroCopy`.
 */
export function quickActionColumns(input: QuickActionFitInput): number {
  const { labels, fontSize, fontScale, maxLines } = input;
  if (labels.length === 0) {
    return 1;
  }
  const rendered = fontSize * appliedScale(fontScale);
  const required = Math.max(
    ...labels.map((label) => quickActionMinimumBox(label, rendered, maxLines)),
  );
  for (let columns = labels.length; columns > 1; columns -= 1) {
    if (quickActionTextBox(input, columns) - quickActionRoundingAllowanceDp >= required) {
      return columns;
    }
  }
  return 1;
}
