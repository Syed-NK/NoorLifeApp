/**
 * Does the hero's approved headline fit its copy column, or must the copy take the whole card?
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The defect this answers ────────────────────────────────────────────────
 * Issue #50's first commit let the headline wrap to three lines and the card grow, which removed the
 * ellipsis. It could not remove the *other* half: "manageable" is 6.611 em wide on its own, which is
 * 158.7 dp at the `heroDisplay` token, and the 52% copy column is 130.9 dp at 320 dp and 159.7 dp at
 * the reference width. A word wider than its line has nowhere to break, so Android split it between
 * letters — "manageabl / e" at font scale 1.0 and "today man / ageable" at 1.3, measured on a phone.
 *
 * A complete string is not a readable one. Hyphenation was tried on a device and is worse: it made
 * Android give the word a line of its own and ellipsise it again.
 *
 * ── The rule ───────────────────────────────────────────────────────────────
 * One shared, deterministic predicate over the registry, evaluated per card with that card's own
 * approved headline. Where the headline's widest word does not clear the copy column with headroom,
 * the card enters a constrained presentation: the decorative artwork is omitted and the copy takes
 * the available card width. Nothing else changes — same tokens, palette, radius, spacing, `minHeight`,
 * same approved strings, no shrinking, no hyphenation, no word splitting.
 *
 * Artwork is decorative and copy is not, so at constrained widths the copy wins. This mirrors
 * `shouldStackTwoColumn`, which is the same shape of decision — a pure predicate over measured width
 * and OS text size, asserted directly rather than inferred from a rendered tree.
 *
 * ── Why the width is measured rather than estimated ────────────────────────
 * Because the answer is decided in the third significant figure. Estimating from a character count
 * put "manageable" within a dp of the column edge, and a screenshot cannot do better. These advances
 * are read from `assets/fonts/Poppins_600SemiBold.ttf` — the face `ModuleText` resolves for
 * `heroDisplay` — so the arithmetic is the font the device actually renders.
 * `__tests__/hero-copy-fit.test.ts` regenerates the table from that file and fails if the two drift.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * Advance width of each character in Poppins SemiBold, in 1/1000 em.
 *
 * Generated from `assets/fonts/Poppins_600SemiBold.ttf` (`unitsPerEm` 1000, so these are the raw
 * `hmtx` advances). Kerning is deliberately not modelled: Poppins carries its pair adjustments in
 * GPOS, and ignoring them overstates a word's width very slightly — the safe direction for a rule
 * that decides whether a word will fit.
 */
const ADVANCE_PER_MILLE: Readonly<Record<string, number>> = {
  ' ': 238,
  '!': 354,
  '"': 364,
  '#': 887,
  $: 654,
  '%': 829,
  '&': 778,
  "'": 195,
  '(': 485,
  ')': 485,
  '*': 518,
  '+': 674,
  ',': 254,
  '-': 583,
  '.': 260,
  '/': 486,
  '0': 646,
  '1': 362,
  '2': 574,
  '3': 599,
  '4': 661,
  '5': 644,
  '6': 640,
  '7': 548,
  '8': 643,
  '9': 626,
  ':': 263,
  ';': 324,
  '<': 584,
  '=': 738,
  '>': 567,
  '?': 538,
  '@': 1051,
  A: 716,
  B: 643,
  C: 768,
  D: 717,
  E: 532,
  F: 530,
  G: 768,
  H: 717,
  I: 278,
  J: 570,
  K: 663,
  L: 459,
  M: 899,
  N: 735,
  O: 785,
  P: 608,
  Q: 787,
  R: 641,
  S: 609,
  T: 577,
  U: 697,
  V: 711,
  W: 1024,
  X: 686,
  Y: 636,
  Z: 576,
  '[': 497,
  '\\': 756,
  ']': 496,
  '^': 680,
  _: 790,
  '`': 271,
  a: 678,
  b: 678,
  c: 602,
  d: 678,
  e: 617,
  f: 345,
  g: 678,
  h: 661,
  i: 278,
  j: 278,
  k: 584,
  l: 278,
  m: 1048,
  n: 661,
  o: 638,
  p: 678,
  q: 678,
  r: 404,
  s: 545,
  t: 388,
  u: 661,
  v: 599,
  w: 844,
  x: 540,
  y: 605,
  z: 483,
  '{': 508,
  '|': 309,
  '}': 508,
  '~': 592,
  '‘': 275,
  '’': 275,
  '“': 477,
  '”': 477,
  '–': 702,
  '—': 927,
  '…': 695,
  '·': 270,
  '•': 480,
};

/**
 * Widest advance among the characters the approved copy actually uses, used for anything unmapped.
 *
 * An unmeasurable character must not silently become zero-width, because that would make a headline
 * look narrower than it is and keep a column that cannot hold it.
 */
const FALLBACK_PER_MILLE = Math.max(...Object.values(ADVANCE_PER_MILLE));

/** Advance width of `text` in em, at the `heroDisplay` face. */
export function textWidthEm(text: string): number {
  let total = 0;
  for (const character of text) {
    total += ADVANCE_PER_MILLE[character] ?? FALLBACK_PER_MILLE;
  }
  return total / 1000;
}

/**
 * Advance width of the widest single word in `text`, in em.
 *
 * The widest *word* is what decides this, not the widest line: a line too long merely wraps, and
 * wrapping is what the first commit already made safe. Only a single word with nowhere to break
 * forces Android to split between letters.
 */
export function widestWordEm(text: string): number {
  const words = text.split(/\s+/).filter((word) => word !== '');
  return words.length === 0 ? 0 : Math.max(...words.map(textWidthEm));
}

/**
 * How much wider than its widest word a copy column must be to keep the artwork beside it.
 *
 * ── Derived from the registry, and deliberately not near an edge ────────────
 * Headroom is `columnWidth / widestWordWidth`: above 1 the word fits, below 1 it is split between
 * letters. Measured across the three tested widths and the three tested OS text sizes, the eight
 * registered module-home headlines fall into two populations with nothing in between:
 *
 *   Planner ("manageable")                    0.907 … 1.015
 *   Finance, Learning, Family, Goals          1.539 … 2.135
 *
 * Planner straddles 1 by less than two percent — 0.998 at 384 dp and 1.007 at 411 dp, both confirmed
 * on a phone and an emulator respectively — so "does it exceed 1" is exactly the rounding edge a
 * layout decision must not rest on. 1.25 is the geometric centre of the empty band between the two
 * populations, so every decision clears its nearest boundary by at least eleven percent and a ±10%
 * perturbation of either the column or the word changes no outcome. That is asserted, not asserted
 * to be true: see the perturbation cases in `__tests__/hero-copy-fit.test.ts`.
 */
export const heroCopyColumnHeadroom = 1.25;

export type HeroCopyFitInput = {
  /** The approved headline this card will render. */
  readonly headline: string;
  /** Width available for text inside the 52% copy column, at the current scale. */
  readonly columnWidth: number;
  /** Resolved `heroDisplay` font size at the current layout scale. */
  readonly fontSize: number;
  /** The OS text-size setting. */
  readonly fontScale: number;
};

/**
 * Whether this hero must give its copy the whole card instead of the 52% column.
 *
 * Pure and exported so the rule can be asserted directly rather than read out of a rendered tree.
 */
export function shouldWidenHeroCopy({
  headline,
  columnWidth,
  fontSize,
  fontScale,
}: HeroCopyFitInput): boolean {
  /*
    The headline caps its own multiplier at 1.1, so text stops growing there however large the OS
    setting is — and a setting below 1 cannot earn a card a narrower column, for the same reason
    `shouldStackTwoColumn` clamps at 1: the approved layout is the default one.
  */
  const effectiveScale = Math.min(Math.max(fontScale, 1), 1.1);
  const required = widestWordEm(headline) * fontSize * effectiveScale;
  return columnWidth < required * heroCopyColumnHeadroom;
}
