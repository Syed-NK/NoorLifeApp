import type { ImageSourcePropType } from 'react-native';

import type { FaithPictogramSlot } from './components/faith-locked-library';
import type { DuaCategoryId } from './data/duas/dua-categories';

/**
 * The eleven dimensional icons the Duas category grid draws, as one registry.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Static `require` only, and why it is not a style preference ────────────
 * Metro resolves `require` at build time. A template string, a variable lookup or a dynamic import
 * silently resolves to nothing in a release bundle — which is exactly how a screen ends up drawing
 * an icon-font fallback that nobody chose, on the one build nobody re-checks. Every path below is a
 * literal, the same rule `faith-pictogram-assets.ts` and `faith-submenu-assets.ts` already record.
 *
 * A consequence worth stating plainly: **nothing here can be fetched.** There is no URL, no `uri`
 * source and no remote host anywhere in this file, so the grid cannot download an image, and
 * `faith-duas-category-grid.test.tsx` asserts that by scanning the module.
 *
 * ── Reuse first, and only where it is exact ────────────────────────────────
 * Four slots are filled by artwork this app already ships and approved for the same subject:
 *
 *   • `essential-duas` and `continue` — the open Qur'an on a carved wooden rehal, from the Faith
 *     submenu. The design brief names the Continue asset as "the approved open-Qur'an asset", and
 *     this is it. Both slots take the *same literal path* so Metro bundles it once and both hand the
 *     renderer the same source object — reuse a test can prove rather than two files that happen to
 *     look alike today.
 *   • `adhkar` — the emerald prayer beads with gold separators and a tassel, from the Faith submenu.
 *   • `my-quran-selections` — the open cream book with an emerald and gold ribbon bookmark, the H2
 *     pictogram. Matches the required subject exactly; the approved mock draws the same idea with a
 *     rehal beneath it, which is a difference in composition rather than in subject, and is recorded
 *     in the handoff rather than papered over.
 *
 * ── The seven that are missing, and what must not happen to them ───────────
 * Seven subjects have no approved artwork. Each is `awaiting-artwork`, carries the exact filename it
 * is waiting for, and renders a restrained NoorLife vector in the meantime.
 *
 * That fallback is **development scaffolding, not a shipping decision**. It is a thin vector where
 * the design calls for a dimensional raster, and a screen drawing seven of them has not matched the
 * locked design however correct its layout is. `duaCategoryAssetGaps()` exists so a build can be
 * asked the question directly instead of somebody eyeballing a screenshot.
 *
 * What the fallback is deliberately not: an emoji, a platform glyph, or a crop out of the mock. All
 * three would look finished at a glance and be wrong — an emoji renders differently on every OS and
 * font, and a crop of a design mock is a raster nobody can re-render at another size.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** Every icon the grid needs. The ten cards, plus the Continue card's own. */
export type DuaCategoryIconId = DuaCategoryId | 'continue';

export type DuaCategoryAsset =
  /** Approved artwork, bundled and rendered. */
  | { readonly status: 'installed'; readonly source: ImageSourcePropType }
  /**
   * No approved artwork exists for this subject.
   *
   * Carries the exact filename the asset pipeline should deliver, so the handoff is a list that can
   * be acted on rather than a description somebody has to translate into filenames.
   */
  | {
      readonly status: 'awaiting-artwork';
      readonly developmentFallback: FaithPictogramSlot;
    };

export type DuaCategoryIconEntry = {
  readonly id: DuaCategoryIconId;
  /** Where the artwork lives, or must be delivered to, relative to `assets/images/modules/faith/`. */
  readonly file: string;
  /** The approved subject, in the words of the design brief. Never paraphrased loosely. */
  readonly subject: string;
  /** The dp box the icon renders in, so the acceptance pass has a number to measure against. */
  readonly renderedAtDp: number;
  readonly asset: DuaCategoryAsset;
};

/**
 * The registry, in grid order with Continue last.
 *
 * `renderedAtDp` is 44 for the grid cards and 40 for Continue, matching the approved mock's optical
 * sizes. The value is here rather than in the screen so the asset brief and the layout cannot drift.
 */
export const duaCategoryIcons: readonly DuaCategoryIconEntry[] = [
  {
    id: 'daily-remembrances',
    file: 'duas/dc1-daily-remembrances.png',
    subject: 'Golden sunrise behind an emerald mosque',
    renderedAtDp: 44,
    asset: {
      status: 'awaiting-artwork',
      developmentFallback: { kind: 'vector', icon: 'crescent' },
    },
  },
  {
    id: 'morning-evening',
    file: 'duas/dc2-morning-evening.png',
    subject: 'Sunrise and crescent over a mosque',
    renderedAtDp: 44,
    asset: { status: 'awaiting-artwork', developmentFallback: { kind: 'vector', icon: 'mosque' } },
  },
  {
    id: 'food-drink',
    file: 'duas/dc3-food-drink.png',
    subject: 'Ivory bowl and cup with emerald and gold decoration',
    renderedAtDp: 44,
    asset: { status: 'awaiting-artwork', developmentFallback: { kind: 'vector', icon: 'meal' } },
  },
  {
    id: 'travel',
    file: 'duas/dc4-travel.png',
    subject: 'Emerald suitcase with gold hardware',
    renderedAtDp: 44,
    asset: { status: 'awaiting-artwork', developmentFallback: { kind: 'vector', icon: 'walk' } },
  },
  {
    id: 'home-family',
    file: 'duas/dc5-home-family.png',
    subject: 'Ivory-and-emerald home with a gold heart',
    renderedAtDp: 44,
    asset: { status: 'awaiting-artwork', developmentFallback: { kind: 'vector', icon: 'home' } },
  },
  {
    id: 'joy-distress',
    file: 'duas/dc6-joy-distress.png',
    subject: 'Cupped hands holding a small gold heart of light',
    renderedAtDp: 44,
    asset: {
      status: 'awaiting-artwork',
      developmentFallback: { kind: 'vector', icon: 'wellness' },
    },
  },
  {
    id: 'essential-duas',
    /* Reused, exact: the open Qur'an on a carved wooden rehal the Faith submenu already ships. */
    file: 'submenu/01-quran.png',
    subject: 'Open Qur’an on a carved wooden rehal',
    renderedAtDp: 44,
    asset: {
      status: 'installed',
      source: require('@assets/images/modules/faith/submenu/01-quran.png') as ImageSourcePropType,
    },
  },
  {
    id: 'adhkar',
    /* Reused, exact: emerald beads, gold separators, gold tassel. */
    file: 'submenu/06-tasbih.png',
    subject: 'Emerald prayer beads with a gold separator and tassel',
    renderedAtDp: 44,
    asset: {
      status: 'installed',
      source: require('@assets/images/modules/faith/submenu/06-tasbih.png') as ImageSourcePropType,
    },
  },
  {
    id: 'my-quran-selections',
    /* Reused: H2, the open cream book with an emerald and gold ribbon bookmark. */
    file: 'pictograms/h2-bookmarked-book.png',
    subject: 'Open Qur’an with an emerald bookmark',
    renderedAtDp: 44,
    asset: {
      status: 'installed',
      source:
        require('@assets/images/modules/faith/pictograms/h2-bookmarked-book.png') as ImageSourcePropType,
    },
  },
  {
    id: 'favourites',
    file: 'duas/dc7-favourites.png',
    subject: 'Dimensional gold star in an ivory medallion',
    renderedAtDp: 44,
    asset: { status: 'awaiting-artwork', developmentFallback: { kind: 'vector', icon: 'star' } },
  },
  {
    id: 'continue',
    /*
      The same literal path as `essential-duas`, so Metro bundles one copy and both slots resolve to
      one source object. The brief names this slot "the approved open-Qur'an asset"; this is it.
    */
    file: 'submenu/01-quran.png',
    subject: 'Open Qur’an on a carved wooden rehal — the same image as Essential Duas',
    renderedAtDp: 40,
    asset: {
      status: 'installed',
      source: require('@assets/images/modules/faith/submenu/01-quran.png') as ImageSourcePropType,
    },
  },
];

/** One entry by id. Total, because the id type is closed and the registry covers all of it. */
export function duaCategoryIcon(id: DuaCategoryIconId): DuaCategoryIconEntry {
  const entry = duaCategoryIcons.find((item) => item.id === id);
  if (entry === undefined) {
    /* Unreachable while the registry covers the closed id type, and asserted by its own test. */
    throw new Error(`No Duas category icon registered for "${id}".`);
  }
  return entry;
}

/** The renderable slot for an id: the artwork where it exists, the scaffold where it does not. */
export function duaCategoryIconSlot(id: DuaCategoryIconId): FaithPictogramSlot {
  const { asset } = duaCategoryIcon(id);
  return asset.status === 'installed'
    ? { kind: 'png', source: asset.source }
    : asset.developmentFallback;
}

/**
 * The exact files still owed, for the asset handoff.
 *
 * Returned rather than logged, so a test can assert the count and a report can list the filenames
 * without anybody transcribing them. An empty result is the only state in which this screen can
 * honestly be called visually complete.
 */
export function duaCategoryAssetGaps(): readonly {
  readonly file: string;
  readonly subject: string;
}[] {
  return duaCategoryIcons
    .filter((entry) => entry.asset.status === 'awaiting-artwork')
    .map((entry) => ({ file: entry.file, subject: entry.subject }));
}
