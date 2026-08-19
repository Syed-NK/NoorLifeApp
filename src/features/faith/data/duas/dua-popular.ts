import { reviewedDuasForCategory, type ReviewedDua } from './reviewed-dua';

/**
 * The **Popular Duas** section's data contract.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The section is built and does not render, and both halves matter ───────
 * Built, because a future manifest update has to be sufficient to populate it — a section that
 * required a screen redesign the day content arrived would mean the content waited on engineering
 * rather than on review. Not rendered, because there is nothing to rank: `popularDuas` returns
 * entries whose *reviewer* gave them a rank, and no reviewer has ranked anything.
 *
 * ── Why the type signature is the enforcement ──────────────────────────────
 * This takes `ReviewedDua[]`. It cannot be handed a `QuranSelection`, so a user's own saved verse
 * cannot be described as popular by this code — not by a mistake, not by a later refactor, and not by
 * somebody reaching for the nearest list when the section looked empty. Calling a private choice
 * "popular" would attribute a claim about what other people do to something only one person ever
 * touched, and the strongest available guard against it is that the function will not accept one.
 *
 * ── Rank comes from the review record, never from behaviour ────────────────
 * Not from open counts, not from Tasbih use, not from recency. Those would make "popular" a
 * measurement NoorLife took, which is a different claim from the one the word makes on a religious
 * surface — and it would require usage measurement this app does not collect, and must not begin
 * collecting in order to rank supplications. The rank is an editorial judgement recorded inside
 * `review` — see `ReviewedDuaReview.popularRank` for why it lives there and not beside it.
 *
 * ── An unranked entry is not rank zero ─────────────────────────────────────
 * It is absent from this section and present in the full results below it. There is no fallback
 * ordering, no "top few by whatever we have", and no filling the row out to a pleasing count.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * How many ranked entries the section draws.
 *
 * A bound rather than none: the section is a shortcut to a handful of entries above a full list, and a
 * horizontal row of thirty is neither a shortcut nor reachable at a large text size. Anything past the
 * bound is not hidden — it is in the results section immediately below, in its ordinary place.
 *
 * `popularOverflowCount` exists so the screen can say how many were not drawn rather than truncating
 * silently, which is the same rule the rest of this module follows about caps.
 */
export const MAX_POPULAR_DUAS = 6;

/**
 * The ranked entries for one category, in the reviewer's order.
 *
 * Ties break on `id`, which is arbitrary but *stable*: two entries given the same rank would otherwise
 * change places between renders depending on manifest order, and a section that reorders itself under
 * the reader is a section nobody can point at.
 */
export function popularDuas(
  categoryId: string,
  reviewed: readonly ReviewedDua[],
): readonly ReviewedDua[] {
  return reviewedDuasForCategory(categoryId, reviewed)
    .filter((dua) => dua.review.popularRank !== null)
    .sort((a, b) => {
      const rankA = a.review.popularRank ?? 0;
      const rankB = b.review.popularRank ?? 0;
      return rankA === rankB ? a.id.localeCompare(b.id) : rankA - rankB;
    })
    .slice(0, MAX_POPULAR_DUAS);
}

/** How many ranked entries the bound left out, so the screen can say so instead of hiding them. */
export function popularOverflowCount(categoryId: string, reviewed: readonly ReviewedDua[]): number {
  const ranked = reviewedDuasForCategory(categoryId, reviewed).filter(
    (dua) => dua.review.popularRank !== null,
  ).length;
  return Math.max(0, ranked - MAX_POPULAR_DUAS);
}

/**
 * Whether the section renders at all.
 *
 * A separate predicate rather than `popularDuas(...).length > 0` at each call site, so "when is Popular
 * shown?" has one answer. Today it is always `false`, and the screen below it renders normally — an
 * absent section is not an error state and gets no placeholder, no skeleton and no "coming soon".
 */
export function showPopularSection(categoryId: string, reviewed: readonly ReviewedDua[]): boolean {
  return popularDuas(categoryId, reviewed).length > 0;
}

/** How the Popular row lays itself out. */
export type PopularSectionLayout = 'horizontal' | 'stacked';

/**
 * Whether the Popular section may scroll horizontally, or must stack.
 *
 * ── Why a large text size ends the carousel ────────────────────────────────
 * A horizontal row trades visibility for compactness: some cards are off-screen, and the user is
 * expected to notice and swipe. That trade is fine while three cards are partly visible, because the
 * cut-off third is its own affordance. At a large text size the cards grow and the viewport does not,
 * so the same row shows one and a sliver — and a section that looks like a single card while holding six
 * has hidden five of them with nothing on screen saying so.
 *
 * Stacking shows every entry with no hidden state and no gesture to discover. It costs vertical space,
 * which is the resource this module has consistently chosen to spend: the layout gives way and the type
 * does not — the same rule `duaGridColumns` applies to the grid.
 *
 * `stackTwoColumns` is consulted first so this section collapses no later than every other side-by-side
 * pair in the app, rather than at a threshold chosen here. The text-scale term is what catches the case
 * that rule cannot see: a wide screen with large type, where the columns are fine and the cards are not.
 *
 * Placed beside the ranking rather than inside the component so it can be asserted directly, which is
 * the only way it *can* be asserted while the section has nothing to draw.
 */
export function popularSectionLayout(input: {
  readonly stackTwoColumns: boolean;
  /** The OS text scale, as `useModuleMetrics` reports it. */
  readonly fontScale: number;
}): PopularSectionLayout {
  return input.stackTwoColumns || input.fontScale > 1.2 ? 'stacked' : 'horizontal';
}
