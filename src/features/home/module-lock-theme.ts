import { neutralColors } from '@ds/tokens';

/**
 * The locked-tile treatment.
 *
 * Kept out of `module-grid.tsx` so that file hard-codes no colour of its own — the rule every
 * reopened design-locked file is held to. Kept out of `module-tile-theme.ts` because that file is
 * still locked byte-for-byte and this is new surface, not a change to the approved tints.
 */

/**
 * The scrim over a locked tile.
 *
 * The page's own canvas at 55%, not grey and not opacity on the tile. Reducing the tile's opacity
 * would fade its label with it; a scrim desaturates the coloured surface while the label keeps its
 * contrast, which is what "readable label, restrained desaturation" requires.
 */
export const MODULE_LOCK_SCRIM = 'rgba(247, 248, 250, 0.55)';

/** The badge disc. Near-white so the padlock reads against any module tint beneath it. */
export const MODULE_LOCK_BADGE_SURFACE = 'rgba(255, 255, 255, 0.92)';

/**
 * The padlock itself.
 *
 * The canvas system's secondary ink rather than black: a black padlock on a pale tint reads as an
 * error state, and a locked module is an invitation, not a fault.
 */
export const MODULE_LOCK_INK = neutralColors.textSecondary;
