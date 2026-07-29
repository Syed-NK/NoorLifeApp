import { I18nManager } from 'react-native';

/**
 * RTL helpers (spec §8: "Support right-to-left layout for Arabic").
 *
 * NoorLife layouts are written with logical properties — `paddingStart`,
 * `marginEnd`, `flex-start` — which React Native already mirrors automatically
 * when RTL is active. These helpers cover the cases the layout engine cannot
 * mirror on its own:
 *
 *   • directional glyphs (a forward chevron must point left in RTL)
 *   • explicit transforms (a rotation is a numeric value, not a layout property)
 *
 * Nothing here reads a layout direction at module scope: `I18nManager.isRTL` is
 * read per call so a direction change during development reload is picked up.
 */

export function isRTL(): boolean {
  return I18nManager.isRTL;
}

/**
 * Returns the icon that visually points "forward" in the active direction.
 *
 * Use for chevrons, back arrows and any other glyph whose meaning is directional.
 */
export function forwardChevron(): 'chevron-forward' | 'chevron-back' {
  return isRTL() ? 'chevron-back' : 'chevron-forward';
}

export function backChevron(): 'chevron-forward' | 'chevron-back' {
  return isRTL() ? 'chevron-forward' : 'chevron-back';
}

/**
 * Mirrors a horizontal offset. Use when a value must be applied via `transform`
 * (which is never auto-mirrored) rather than via a logical layout property.
 */
export function mirrorX(value: number): number {
  return isRTL() ? -value : value;
}

/** `'row'` in LTR, `'row-reverse'` in RTL — for rows built with absolute children. */
export function directionalRow(): 'row' | 'row-reverse' {
  return isRTL() ? 'row-reverse' : 'row';
}
