import type { DhikrCategory } from '../dhikr/quran-dhikr-catalogue';

/**
 * The Duas library's ten categories — the closed set, in the approved order.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Two taxonomies, deliberately not merged ────────────────────────────────
 * There are two ways of grouping content in this feature and they answer different questions.
 *
 * **`DhikrCategory`** (in `quran-dhikr-catalogue.ts`) is the *reviewed* taxonomy: the six buckets a
 * qualified reviewer files an approved reference under. It is part of the review record and changing
 * it changes what a reviewer's sign-off meant.
 *
 * **`DuaCategoryId`** (here) is the *presentation* taxonomy: the ten cards on the locked grid. It is
 * NoorLife's own navigation and carries no religious claim — a card is a place to look, not an
 * assertion that anything is in it.
 *
 * Collapsing them would mean either that the grid could only ever show six cards, or that adding a
 * card to the navigation silently redefined a category a reviewer had already signed against. So
 * they stay separate and `reviewedCategories` below states the correspondence explicitly.
 *
 * ── Four cards currently have no reviewed counterpart, and that is a fact ───
 * Food & Drink, Travel, Home & Family and Joy & Distress map to **no** `DhikrCategory`, because the
 * reviewed taxonomy has no bucket for them. That is not an oversight to be papered over with a
 * plausible-looking mapping: filing a travel dua under `protection` would be an editorial religious
 * decision, made by a developer, invisibly. Those cards are discoverable, show a dash, and say
 * plainly that reviewed content is not available — which is true now and stays true until a reviewer
 * supplies both the entries and the bucket to file them under.
 *
 * ── Categories are never inferred ──────────────────────────────────────────
 * Nothing here reads Arabic or a translation to decide where something belongs. A category comes
 * from the reviewed record or from the user's own action, and from nowhere else — see
 * `personalKind` for the two cards that hold the user's own data.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** The ten cards. Closed, so a typo is a compile error and the order below is the only order. */
export type DuaCategoryId =
  | 'daily-remembrances'
  | 'morning-evening'
  | 'food-drink'
  | 'travel'
  | 'home-family'
  | 'joy-distress'
  | 'essential-duas'
  | 'adhkar'
  | 'my-quran-selections'
  | 'favourites';

/**
 * What a card is backed by.
 *
 * The distinction is the one this whole module is built around: a reviewed card can only ever hold
 * something a named reviewer approved, and a personal card holds what the user chose. They are
 * never the same list and a card is never both.
 */
export type DuaCategoryKind =
  /** Backed by the reviewed manifest. Empty until a reviewer approves an entry. */
  | 'reviewed'
  /** Backed by the user's own Quran selections. Fully working today. */
  | 'personal';

export type DuaCategory = {
  readonly id: DuaCategoryId;
  /** The card's label, exactly as the approved design draws it. */
  readonly label: string;
  readonly kind: DuaCategoryKind;
  /**
   * Which reviewed buckets feed this card. Empty for a card the reviewed taxonomy cannot yet fill,
   * and empty for the two personal cards, which the manifest has nothing to do with.
   */
  readonly reviewedCategories: readonly DhikrCategory[];
  /**
   * What the card is, for a screen reader, beyond its label.
   *
   * Required rather than optional: every card needs a spoken description that says what opening it
   * would show, and an optional field is one somebody forgets on the card that needed it most.
   */
  readonly description: string;
};

/**
 * The ten cards in the approved order, reading left to right then down.
 *
 * The order is part of the locked design and is asserted in `faith-duas-category-grid.test.tsx`
 * rather than left to the reader of this array.
 */
export const DUA_CATEGORIES: readonly DuaCategory[] = [
  {
    id: 'daily-remembrances',
    label: 'Daily Remembrances',
    kind: 'reviewed',
    reviewedCategories: ['quranic-remembrance'],
    description: 'Reviewed remembrances for every day',
  },
  {
    id: 'morning-evening',
    label: 'Morning & Evening',
    kind: 'reviewed',
    reviewedCategories: ['morning-evening'],
    description: 'Reviewed remembrances for the start and end of the day',
  },
  {
    id: 'food-drink',
    label: 'Food & Drink',
    kind: 'reviewed',
    /* No reviewed bucket exists for this subject yet. See the module note. */
    reviewedCategories: [],
    description: 'Reviewed supplications for eating and drinking',
  },
  {
    id: 'travel',
    label: 'Travel',
    kind: 'reviewed',
    reviewedCategories: [],
    description: 'Reviewed supplications for journeys',
  },
  {
    id: 'home-family',
    label: 'Home & Family',
    kind: 'reviewed',
    reviewedCategories: [],
    description: 'Reviewed supplications for the home and family',
  },
  {
    id: 'joy-distress',
    label: 'Joy & Distress',
    kind: 'reviewed',
    reviewedCategories: [],
    description: 'Reviewed supplications for times of joy and of difficulty',
  },
  {
    id: 'essential-duas',
    label: 'Essential Duas',
    kind: 'reviewed',
    reviewedCategories: ['after-prayer', 'praise', 'forgiveness'],
    description: 'Reviewed supplications for prayer, praise and seeking forgiveness',
  },
  {
    id: 'adhkar',
    label: 'Adhkar',
    kind: 'reviewed',
    reviewedCategories: ['protection'],
    description: 'Reviewed remembrances for protection',
  },
  {
    id: 'my-quran-selections',
    label: 'My Quran Selections',
    kind: 'personal',
    reviewedCategories: [],
    description: 'Verses of the Qur’an you chose and kept',
  },
  {
    id: 'favourites',
    label: 'Favorites',
    kind: 'personal',
    reviewedCategories: [],
    description: 'The selections you starred',
  },
];

/** One category by id, or `undefined` for a value that is not one. Used by the category route. */
export function duaCategoryById(id: string): DuaCategory | undefined {
  return DUA_CATEGORIES.find((category) => category.id === id);
}

/**
 * What a card shows where a count would go.
 *
 * ── Why a dash and not a zero ──────────────────────────────────────────────
 * "0" is a measurement, and it reads as one: it says NoorLife looked, counted, and found none. For a
 * reviewed category the truth is different and weaker — no reviewer has been engaged, so nothing has
 * been counted at all, and printing a zero would dress an absent process as a completed one.
 *
 * A personal card genuinely can be counted, because the user's own selections are right there, so it
 * shows its number. Zero of those is a real zero and is allowed to say so.
 */
export function categoryCountLabel(
  category: DuaCategory,
  personalCount: number,
  reviewedCount: number,
): string {
  if (category.kind === 'personal') {
    return String(personalCount);
  }
  return reviewedCount === 0 ? '–' : String(reviewedCount);
}

/**
 * The longest unbreakable word any category label contains.
 *
 * ── Why the rule measures a *word* and not the label ───────────────────────
 * A label is allowed to wrap: "Morning &" / "Evening" is exactly what the approved design draws. A
 * *word* is not — React Native, given a word wider than its line, breaks it mid-word, and
 * "Daily Remembr / ances" appeared on device at 393 dp with a 1.3 text scale. So the question the
 * layout has to answer is not "does the label fit?" but "does its longest word fit?", and that is a
 * different and much smaller number.
 *
 * Derived from `DUA_CATEGORIES` rather than written down, so a future card cannot add a longer word
 * and leave the threshold describing the old set.
 */
export const LONGEST_CATEGORY_WORD = DUA_CATEGORIES.reduce((longest, category) => {
  const word = category.label.split(/\s+/).reduce((a, b) => (b.length > a.length ? b : a), '');
  return word.length > longest.length ? word : longest;
}, '');

/**
 * A rough advance width for a run of text, in rendered dp.
 *
 * ── Why an approximation, and where the number came from ───────────────────
 * Measuring the real glyphs would need a layout pass, which means the grid would have to render
 * wrong once and correct itself — a visible reflow on every open. Measured text also changes with
 * whatever font the OS resolves, so the same device could stack on one launch and not the next.
 *
 * `0.625` is **calibrated from two device measurements**, not taken from a font metric. Both were
 * read off the emulator with `uiautomator`, on the two sizes that bracket the decision. Note that
 * the half-column and the chrome are identical at both — `moduleScale` clamps at 1, so a 411 dp
 * screen and a 393 dp one lay out the same. The only thing that changes is the rendered label:
 *
 *   411 dp @ 1.0  →  label 12.5 dp in a 106 dp box, "Remembrances" whole  ⇒  k must be ≤ 0.707
 *   393 dp @ 1.3  →  label 16.25 dp in the same box, "Remembrances" split ⇒  k must be >  0.544
 *
 * 0.625 sits between them with room on both sides — about 12 dp of slack at 411 and 16 dp of margin
 * at 393 — rather than on either edge, where a font substitution or a rounding change would flip the
 * layout. A tighter value would be more "accurate" and would make the grid fragile, which is the
 * wrong trade for a rule whose only job is to keep a word intact.
 *
 * `fontSize` is the **rendered** size: the caller multiplies the type token by the OS font scale,
 * because `useModuleMetrics().type()` deliberately does not — React Native applies that scale itself
 * at render, and a hook that also applied it would scale text twice.
 */
function approximateTextWidth(word: string, fontSize: number): number {
  return word.length * fontSize * 0.625;
}

/**
 * How many columns the category grid may use.
 *
 * ── The rule, and why it is not `shouldStackTwoColumn` alone ───────────────
 * `shouldStackTwoColumn` is the app-wide two-column rule and it is applied first, so this grid never
 * keeps two columns where any other pair in the app would stack. What it cannot know is that these
 * particular cards carry a 12-character word beside a 40 dp icon, and that is the constraint that
 * actually binds here: at 393 dp with a 1.3 scale the half-column clears the shared threshold and
 * still cannot hold "Remembrances".
 *
 * So the shared rule decides the floor and this adds the label test on top. The result at the three
 * acceptance sizes: two columns at 411 dp / 1.0, one column at 393 dp / 1.3, one column at
 * 320 dp / 1.5 — which is the stated preference, a stacked card over a split word.
 *
 * Nothing here shrinks type. The layout gives way; the words do not.
 */
export function duaGridColumns(input: {
  /** The measured half-column width in dp, from `useModuleMetrics`. */
  readonly halfColumnWidth: number;
  /** The app-wide two-column verdict, already computed. */
  readonly stackTwoColumns: boolean;
  /**
   * The rendered label size in dp — the type token **multiplied by the OS font scale**.
   *
   * Spelled out because getting it wrong is silent: `type('body').fontSize` alone is the unscaled
   * value, and passing it made this rule keep two columns at 393 dp / 1.3 while the device was
   * visibly splitting "Remembrances" in half.
   */
  readonly labelFontSize: number;
  /** The icon box, its gap and the card's two paddings — everything the label does not get. */
  readonly labelChromeWidth: number;
}): 1 | 2 {
  if (input.stackTwoColumns) {
    return 1;
  }
  const available = input.halfColumnWidth - input.labelChromeWidth;
  return approximateTextWidth(LONGEST_CATEGORY_WORD, input.labelFontSize) <= available ? 2 : 1;
}
