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
