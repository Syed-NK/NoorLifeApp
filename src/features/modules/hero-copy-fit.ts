/**
 * Does a hero's approved copy fit its column, or must the copy take the whole card?
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The defect this answers ────────────────────────────────────────────────
 * Issue #50 in two halves. The first let the headline wrap to three lines and the card grow, which
 * removed the ellipsis. That exposed the second: a word wider than the line it sits on has nowhere
 * to break, so Android splits it between letters. "manageable" is 6.611 em, 158.7 dp at the
 * `heroDisplay` token, against a copy column of 130.9 dp at 320 dp and 159.7 dp at the reference
 * width — measured on a phone as "manageabl / e" at font scale 1.0 and "today man / ageable" at 1.3.
 *
 * Then measuring the call to action found the same shape of defect in the other direction. The pill
 * carries its label on one line by design, and the label plus its padding, gap and chevron is wider
 * than the column for three of the five heroes at every tested width once the OS text size passes
 * 1.0: "Add your first goal" became "Add your first g…". A single-line label has nowhere to go, so
 * the column is what has to give.
 *
 * ── The rule ───────────────────────────────────────────────────────────────
 * One shared, deterministic predicate over the registry, evaluated per card from that card's own
 * approved copy, with two conditions and one outcome. Where the headline's widest word **or** the
 * complete single-line action label does not clear the copy column with headroom, the card enters a
 * constrained presentation: the decorative artwork is omitted and the copy takes the available card
 * width. Nothing else changes — same tokens, palette, radius, spacing, `minHeight`, the approved
 * strings exactly as registered, the label still on one line, and no shrinking, hyphenation or word
 * splitting.
 *
 * Artwork is decorative and copy is not, so at constrained widths the copy wins. This mirrors
 * `shouldStackTwoColumn`, which is the same shape of decision — a pure predicate over measured width
 * and OS text size, asserted directly rather than inferred from a rendered tree.
 *
 * ── Why the widths are measured rather than estimated ──────────────────────
 * Because both answers are decided in the third significant figure. A character-count estimate put
 * "manageable" within a dp of the column edge, and a screenshot cannot do better. These advances are
 * read from the two faces `ModuleText` actually resolves — `Poppins_600SemiBold.ttf` for
 * `heroDisplay` and `Poppins_500Medium.ttf` for `cardAction` — so the arithmetic is the type the
 * device renders. `__tests__/hero-copy-fit.test.ts` regenerates both tables from those files, and
 * checks that those are still the faces and tokens in use, so a font swap or a token change fails
 * rather than silently invalidating every decision below.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** The three faces the shared hero sets type in: display, action/eyebrow, and body. */
export type HeroFace = 'semiBold' | 'medium' | 'regular';

/**
 * Advance width of each character, in 1/1000 em, per face.
 *
 * Generated from the committed TTFs (`unitsPerEm` 1000, so these are the raw `hmtx` advances).
 * Kerning is deliberately not modelled: Poppins carries its pair adjustments in GPOS, and ignoring
 * them overstates a string's width very slightly — the safe direction for a rule that decides
 * whether something will fit.
 */
const ADVANCE_PER_MILLE: Readonly<Record<HeroFace, Readonly<Record<string, number>>>> = {
  semiBold: {
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
  },
  medium: {
    ' ': 260,
    '!': 321,
    '"': 323,
    '#': 872,
    $: 650,
    '%': 794,
    '&': 761,
    "'": 172,
    '(': 492,
    ')': 492,
    '*': 504,
    '+': 714,
    ',': 225,
    '-': 585,
    '.': 241,
    '/': 514,
    '0': 641,
    '1': 350,
    '2': 577,
    '3': 594,
    '4': 647,
    '5': 639,
    '6': 642,
    '7': 560,
    '8': 638,
    '9': 635,
    ':': 245,
    ';': 304,
    '<': 612,
    '=': 774,
    '>': 590,
    '?': 538,
    '@': 1025,
    A: 697,
    B: 630,
    C: 773,
    D: 709,
    E: 524,
    F: 515,
    G: 773,
    H: 705,
    I: 264,
    J: 564,
    K: 633,
    L: 444,
    M: 882,
    N: 721,
    O: 784,
    P: 595,
    Q: 787,
    R: 632,
    S: 604,
    T: 564,
    U: 690,
    V: 694,
    W: 999,
    X: 660,
    Y: 605,
    Z: 558,
    '[': 485,
    '\\': 717,
    ']': 484,
    '^': 654,
    _: 798,
    '`': 254,
    a: 678,
    b: 678,
    c: 600,
    d: 678,
    e: 617,
    f: 332,
    g: 678,
    h: 649,
    i: 264,
    j: 264,
    k: 554,
    l: 264,
    m: 1039,
    n: 649,
    o: 638,
    p: 678,
    q: 678,
    r: 384,
    s: 534,
    t: 372,
    u: 649,
    v: 576,
    w: 825,
    x: 499,
    y: 582,
    z: 471,
    '{': 516,
    '|': 324,
    '}': 516,
    '~': 553,
    '‘': 242,
    '’': 242,
    '“': 422,
    '”': 422,
    '–': 708,
    '—': 924,
    '…': 638,
    '·': 244,
    '•': 462,
  },
  regular: {
    ' ': 267,
    '!': 298,
    '"': 292,
    '#': 840,
    $: 622,
    '%': 759,
    '&': 739,
    "'": 159,
    '(': 454,
    ')': 454,
    '*': 486,
    '+': 683,
    ',': 198,
    '-': 551,
    '.': 210,
    '/': 476,
    '0': 628,
    '1': 320,
    '2': 575,
    '3': 589,
    '4': 629,
    '5': 628,
    '6': 635,
    '7': 546,
    '8': 631,
    '9': 630,
    ':': 213,
    ';': 264,
    '<': 555,
    '=': 723,
    '>': 539,
    '?': 524,
    '@': 1013,
    A: 674,
    B: 613,
    C: 772,
    D: 707,
    E: 513,
    F: 504,
    G: 778,
    H: 692,
    I: 246,
    J: 530,
    K: 599,
    L: 432,
    M: 861,
    N: 703,
    O: 786,
    P: 579,
    Q: 788,
    R: 608,
    S: 587,
    T: 541,
    U: 675,
    V: 676,
    W: 976,
    X: 621,
    Y: 584,
    Z: 541,
    '[': 423,
    '\\': 658,
    ']': 423,
    '^': 629,
    _: 733,
    '`': 257,
    a: 676,
    b: 676,
    c: 607,
    d: 676,
    e: 620,
    f: 329,
    g: 676,
    h: 640,
    i: 246,
    j: 248,
    k: 515,
    l: 246,
    m: 1030,
    n: 640,
    o: 640,
    p: 676,
    q: 676,
    r: 373,
    s: 522,
    t: 364,
    u: 640,
    v: 561,
    w: 820,
    x: 479,
    y: 563,
    z: 455,
    '{': 462,
    '|': 291,
    '}': 462,
    '~': 519,
    '‘': 219,
    '’': 219,
    '“': 380,
    '”': 380,
    '–': 677,
    '—': 885,
    '…': 581,
    '·': 212,
    '•': 412,
  },
};

/**
 * Widest advance in each face, used for anything unmapped.
 *
 * An unmeasurable character must not silently become zero-width: that would make a string look
 * narrower than it is and keep a column that cannot hold it, which is the defect reintroduced by a
 * missing table entry.
 */
const FALLBACK_PER_MILLE: Readonly<Record<HeroFace, number>> = {
  semiBold: Math.max(...Object.values(ADVANCE_PER_MILLE.semiBold)),
  medium: Math.max(...Object.values(ADVANCE_PER_MILLE.medium)),
  regular: Math.max(...Object.values(ADVANCE_PER_MILLE.regular)),
};

/** Advance width of `text` in em, in one of the hero's faces. */
export function textWidthEm(text: string, face: HeroFace): number {
  const advances = ADVANCE_PER_MILLE[face];
  const fallback = FALLBACK_PER_MILLE[face];
  let total = 0;
  for (const character of text) {
    total += advances[character] ?? fallback;
  }
  return total / 1000;
}

/**
 * Advance width of the widest single word in `text`, in em, at the headline face.
 *
 * The widest *word* is what decides the headline, not the widest line: a line too long merely wraps,
 * and wrapping is already safe. Only a single word with nowhere to break forces a letter split.
 */
export function widestWordEm(text: string): number {
  const words = text.split(/\s+/).filter((word) => word !== '');
  return words.length === 0 ? 0 : Math.max(...words.map((word) => textWidthEm(word, 'semiBold')));
}

/**
 * How much wider than its widest word a copy column must be to keep the artwork beside it.
 *
 * ── Derived from the registry, and deliberately not near an edge ────────────
 * Headroom is `columnWidth / widestWordWidth`: above 1 the word fits, below 1 it is split between
 * letters. Measured across three widths and three OS text sizes, the five shared headlines fall into
 * two populations with nothing in between:
 *
 *   Planner ("manageable")                    0.907 … 1.015
 *   Finance, Learning, Family, Goals          1.539 … 2.135
 *
 * Planner straddles 1 by less than two percent — 0.998 at 384 dp and 1.007 at 411 dp, both confirmed
 * on hardware — so "does it exceed 1" is exactly the rounding edge a layout decision must not rest
 * on. 1.25 is the geometric centre of the empty band, so every decision clears its nearest boundary
 * by at least eleven percent and a ±10% perturbation of either the column or the word changes no
 * outcome.
 */
export const heroCopyColumnHeadroom = 1.25;

/**
 * How much wider than its complete pill a copy column must be to keep the artwork beside it.
 *
 * ── A narrower band, and why the threshold sits at the top of it ────────────
 * The action labels do not separate as cleanly as the headlines, because label width and OS text
 * size together form very nearly a continuum. The one real gap in the measured headrooms is
 * 0.987 → 1.147, and 1.1 is inside it: eleven percent clear of the widest overflowing pill and four
 * percent clear of the narrowest fitting one.
 *
 * It sits at the top of the band rather than the middle on purpose, because the two ways of being
 * wrong are not equally bad. Keeping the column when the pill does not fit clips an approved label —
 * the defect. Widening when it would have fitted costs a decorative image, which is the approved
 * fallback. Putting the threshold at 1.1 buys a guarantee out of that asymmetry: a hero that keeps
 * its column has a pill that fits *even if this arithmetic understated the width by a tenth*. That
 * is the property `__tests__/hero-copy-fit.test.ts` asserts, rather than the weaker claim that the
 * decision set never moves.
 */
export const heroActionColumnHeadroom = 1.1;

export type HeroCopyFitInput = {
  /** The approved headline this card will render. */
  readonly headline: string;
  /** The approved action label, or `''` when this card renders no action. */
  readonly actionLabel: string;
  /** Width available for text inside the 52% copy column, at the current scale. */
  readonly columnWidth: number;
  /** Resolved `heroDisplay` font size at the current layout scale. */
  readonly headlineFontSize: number;
  /** Resolved `cardAction` font size at the current layout scale. */
  readonly actionFontSize: number;
  /** The pill's own width around its label: both paddings, the gap and the chevron, already scaled. */
  readonly actionChromeWidth: number;
  /** The OS text-size setting. */
  readonly fontScale: number;
};

/**
 * The OS scale as the headline applies it.
 *
 * The headline caps its own multiplier at 1.1, so its text stops growing there however large the
 * setting is — and a setting below 1 cannot earn a card a narrower column, for the same reason
 * `shouldStackTwoColumn` clamps at 1: the approved layout is the default one.
 */
function headlineScale(fontScale: number): number {
  return Math.min(Math.max(fontScale, 1), 1.1);
}

/**
 * The OS scale as the action label applies it.
 *
 * Uncapped, unlike the headline: the label sets no `maxFontSizeMultiplier`, so it grows with the
 * setting without limit. That difference is the whole reason the pill overflows a column the
 * headline fits, and flattening the two would hide it.
 */
function actionScale(fontScale: number): number {
  return Math.max(fontScale, 1);
}

/** Whether the headline's widest word needs more than the column can safely give it. */
export function headlineOverflowsColumn({
  headline,
  columnWidth,
  headlineFontSize,
  fontScale,
}: Pick<HeroCopyFitInput, 'headline' | 'columnWidth' | 'headlineFontSize' | 'fontScale'>): boolean {
  const required = widestWordEm(headline) * headlineFontSize * headlineScale(fontScale);
  return columnWidth < required * heroCopyColumnHeadroom;
}

/** Whether the complete single-line pill needs more than the column can safely give it. */
export function actionOverflowsColumn({
  actionLabel,
  columnWidth,
  actionFontSize,
  actionChromeWidth,
  fontScale,
}: Pick<
  HeroCopyFitInput,
  'actionLabel' | 'columnWidth' | 'actionFontSize' | 'actionChromeWidth' | 'fontScale'
>): boolean {
  // No action, nothing to fit. Section screens and Health's suppressed action both take this path.
  if (actionLabel === '') {
    return false;
  }
  const label = textWidthEm(actionLabel, 'medium') * actionFontSize * actionScale(fontScale);
  return columnWidth < (label + actionChromeWidth) * heroActionColumnHeadroom;
}

/**
 * Whether this hero must give its copy the whole card instead of the 52% column.
 *
 * Either condition is sufficient, and neither is necessary — the headline overflows on Planner at
 * every width, and the pill overflows on Finance, Learning and Goals from OS scale 1.15 upward, so
 * in practice both branches carry real cells.
 *
 * Pure and exported so the rule can be asserted directly rather than read out of a rendered tree.
 */
export function shouldWidenHeroCopy(input: HeroCopyFitInput): boolean {
  return headlineOverflowsColumn(input) || actionOverflowsColumn(input);
}
