import type { ImageSourcePropType } from 'react-native';

import type { Href } from 'expo-router';

import { faithRoutes } from './faith-routes';

/**
 * The eight approved Faith submenu pictograms.
 *
 * ── Static requires only ────────────────────────────────────────────────────
 * Metro resolves `require` at build time, so every path below is a literal. There is no
 * template string, no lookup by variable, and no dynamic import — a dynamic path would
 * silently resolve to nothing in a release bundle, which is exactly how an icon-font
 * fallback gets introduced by accident.
 *
 * ── No fallback, deliberately ───────────────────────────────────────────────
 * `source` is non-optional. A tile cannot be declared without its PNG, so there is no
 * code path that reaches an MCI glyph, an emoji, or a coloured square. The previous build
 * drew these eight from the icon font; the approved set replaces that entirely.
 *
 * ── Rendering rules these assets carry ──────────────────────────────────────
 * They are full-colour transparent PNGs. They are rendered with `resizeMode="contain"`,
 * never tinted, never given a background, and never nested inside a second circular or
 * square icon well — the tile's own surface is the only container. `FaithFeatureGrid`
 * enforces that; these are the assets it reads.
 *
 * Only the eight numbered finals are bundled. The sprite sheet and the chroma-key working
 * files stay in the design pack and are asserted absent from `assets/` by test.
 */

export type FaithSubmenuKey =
  'quran' | 'hadith' | 'duas' | 'prayer' | 'qibla' | 'tasbih' | 'mosques' | 'calendar';

export type FaithSubmenuEntry = {
  readonly key: FaithSubmenuKey;
  /** Tile label, in the approved reference's wording. */
  readonly label: string;
  readonly source: ImageSourcePropType;
  readonly href: Href;
  /** Spoken label. More specific than the visible one where the word is ambiguous. */
  readonly accessibilityLabel: string;
};

/**
 * The eight tiles, in the approved two-row order.
 *
 * Row 1: Quran · Hadith · Duas · Prayer
 * Row 2: Qibla · Tasbih · Mosques · Calendar
 *
 * The array order *is* the render order — the grid maps it directly and wraps at four —
 * so this list is the single place the layout order is expressed.
 */
export const faithSubmenu: readonly FaithSubmenuEntry[] = [
  {
    key: 'quran',
    label: 'Quran',
    source: require('@assets/images/modules/faith/submenu/01-quran.png') as ImageSourcePropType,
    href: faithRoutes.quran,
    accessibilityLabel: 'Qur’an',
  },
  {
    key: 'hadith',
    label: 'Hadith',
    source: require('@assets/images/modules/faith/submenu/02-hadith.png') as ImageSourcePropType,
    href: faithRoutes.hadith,
    accessibilityLabel: 'Hadith collections',
  },
  {
    key: 'duas',
    label: 'Duas',
    source: require('@assets/images/modules/faith/submenu/03-duas.png') as ImageSourcePropType,
    href: faithRoutes.duas,
    accessibilityLabel: 'Duas, supplications',
  },
  {
    key: 'prayer',
    label: 'Prayer',
    source: require('@assets/images/modules/faith/submenu/04-prayer.png') as ImageSourcePropType,
    href: faithRoutes.prayerTimes,
    accessibilityLabel: 'Prayer times',
  },
  {
    key: 'qibla',
    label: 'Qibla',
    source: require('@assets/images/modules/faith/submenu/05-qibla.png') as ImageSourcePropType,
    href: faithRoutes.qibla,
    accessibilityLabel: 'Qibla direction',
  },
  {
    key: 'tasbih',
    label: 'Tasbih',
    source: require('@assets/images/modules/faith/submenu/06-tasbih.png') as ImageSourcePropType,
    href: faithRoutes.tasbih,
    accessibilityLabel: 'Tasbih counter',
  },
  {
    key: 'mosques',
    label: 'Mosques',
    source: require('@assets/images/modules/faith/submenu/07-mosques.png') as ImageSourcePropType,
    href: faithRoutes.mosques,
    accessibilityLabel: 'Nearby mosques',
  },
  {
    key: 'calendar',
    label: 'Calendar',
    source: require('@assets/images/modules/faith/submenu/08-calendar.png') as ImageSourcePropType,
    href: faithRoutes.calendar,
    accessibilityLabel: 'Islamic calendar',
  },
];

/** Resolves one entry. Throws rather than returning a fallback — see the note above. */
export function getFaithSubmenuEntry(key: FaithSubmenuKey): FaithSubmenuEntry {
  const entry = faithSubmenu.find((item) => item.key === key);
  if (entry === undefined) {
    throw new Error(`No Faith submenu entry for "${key}".`);
  }
  return entry;
}
