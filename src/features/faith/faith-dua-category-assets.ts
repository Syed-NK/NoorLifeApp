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
 * `faith-duas-grid-responsive.test.tsx` asserts that by scanning the module.
 *
 * ── Where the eleven come from ─────────────────────────────────────────────
 * Four are artwork this app already shipped, reused because the subject is exactly the same:
 *
 *   • `essential-duas` and `continue` — the open Qur'an on a carved wooden rehal, from the Faith
 *     submenu. The design brief names the Continue asset as "the approved open-Qur'an asset", and
 *     this is it. Both slots take the *same literal path* so Metro bundles it once and both hand the
 *     renderer the same source object — reuse a test can prove rather than two files that happen to
 *     look alike today.
 *   • `adhkar` — the emerald prayer beads with gold separators and a tassel, from the Faith submenu.
 *   • `my-quran-selections` — the open cream book with an emerald and gold ribbon bookmark, the H2
 *     pictogram.
 *
 * The other seven were commissioned for this grid and are installed under `faith/duas/`. Each is a
 * 1254×1254 RGBA PNG on a transparent field, rendered with `contain` so the square canvas keeps its
 * aspect ratio inside whatever box the card gives it — see `FaithPictogram`, which never stretches
 * and never crops.
 *
 * ── `awaiting-artwork` is kept, with nothing in it ─────────────────────────
 * The variant stays even though no slot uses it. It is what makes a *future* subject — an eleventh
 * card, a re-cut icon — describable as "known, named, not yet drawn" rather than silently absent,
 * and `duaCategoryAssetGaps()` is what a build asks instead of somebody eyeballing a screenshot.
 * Its fallback was always development scaffolding: a thin vector where the design calls for a
 * dimensional raster, never an emoji, a platform glyph or a crop out of the mock.
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
   * be acted on rather than a description somebody has to translate into filenames. Currently unused
   * — every slot is installed — and deliberately retained; see the module note.
   */
  | {
      readonly status: 'awaiting-artwork';
      readonly developmentFallback: FaithPictogramSlot;
    };

export type DuaCategoryIconEntry = {
  readonly id: DuaCategoryIconId;
  /** Where the artwork lives, relative to `assets/images/modules/faith/`. */
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
 * ── Why the card icon is 40 dp and not 44 ──────────────────────────────────
 * 44 was the first reading of the mock's optical size, and on device it cost the title the width it
 * needed: a half-column card at 411 dp leaves the label about 97 dp beside a 44 dp icon, and
 * "Remembrances" does not fit in that, so React Native broke it mid-word. Measured on the emulator,
 * at the reference width, so every device would have shown it.
 *
 * 40 dp with an 8 dp gap returns 9 dp to the label, which is enough at the default text size. Larger
 * text sizes are handled by the grid dropping to one column rather than by shrinking either the icon
 * or the words — see `duaGridColumns`.
 *
 * The value lives here rather than in the screen so the asset brief and the layout cannot drift.
 */
export const duaCategoryIcons: readonly DuaCategoryIconEntry[] = [
  {
    id: 'daily-remembrances',
    file: 'duas/dc1-daily-remembrances.png',
    subject: 'Golden sunrise behind an emerald mosque',
    renderedAtDp: 40,
    asset: {
      status: 'installed',
      source:
        require('@assets/images/modules/faith/duas/dc1-daily-remembrances.png') as ImageSourcePropType,
    },
  },
  {
    id: 'morning-evening',
    file: 'duas/dc2-morning-evening.png',
    subject: 'Sunrise and crescent over a mosque',
    renderedAtDp: 40,
    asset: {
      status: 'installed',
      source:
        require('@assets/images/modules/faith/duas/dc2-morning-evening.png') as ImageSourcePropType,
    },
  },
  {
    id: 'food-drink',
    file: 'duas/dc3-food-drink.png',
    subject: 'Ivory bowl and cup with emerald and gold decoration',
    renderedAtDp: 40,
    asset: {
      status: 'installed',
      source:
        require('@assets/images/modules/faith/duas/dc3-food-drink.png') as ImageSourcePropType,
    },
  },
  {
    id: 'travel',
    file: 'duas/dc4-travel.png',
    subject: 'Emerald suitcase with gold hardware',
    renderedAtDp: 40,
    asset: {
      status: 'installed',
      source: require('@assets/images/modules/faith/duas/dc4-travel.png') as ImageSourcePropType,
    },
  },
  {
    id: 'home-family',
    file: 'duas/dc5-home-family.png',
    subject: 'Ivory-and-emerald home with a gold heart',
    renderedAtDp: 40,
    asset: {
      status: 'installed',
      source:
        require('@assets/images/modules/faith/duas/dc5-home-family.png') as ImageSourcePropType,
    },
  },
  {
    id: 'joy-distress',
    file: 'duas/dc6-joy-distress.png',
    subject: 'Cupped hands holding a small gold heart of light',
    renderedAtDp: 40,
    asset: {
      status: 'installed',
      source:
        require('@assets/images/modules/faith/duas/dc6-joy-distress.png') as ImageSourcePropType,
    },
  },
  {
    id: 'essential-duas',
    /* Reused, exact: the open Qur'an on a carved wooden rehal the Faith submenu already ships. */
    file: 'submenu/01-quran.png',
    subject: 'Open Qur’an on a carved wooden rehal',
    renderedAtDp: 40,
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
    renderedAtDp: 40,
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
    renderedAtDp: 40,
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
    renderedAtDp: 40,
    asset: {
      status: 'installed',
      source:
        require('@assets/images/modules/faith/duas/dc7-favourites.png') as ImageSourcePropType,
    },
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
 * **Empty.** Every slot is installed, which is the only state in which this screen can honestly be
 * called visually complete. Kept as a function rather than deleted because that is the question a
 * build should be able to ask when an eleventh card is added.
 */
export function duaCategoryAssetGaps(): readonly {
  readonly file: string;
  readonly subject: string;
}[] {
  return duaCategoryIcons
    .filter((entry) => entry.asset.status === 'awaiting-artwork')
    .map((entry) => ({ file: entry.file, subject: entry.subject }));
}
