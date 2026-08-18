import { neutralColors } from '@ds/tokens';

/**
 * The locked treatment shared by every Main Home surface.
 *
 * Kept out of the components so the reopened design-locked files hard-code no colour of their own —
 * the rule every reopened file is held to. Kept out of `module-tile-theme.ts` because that file is
 * still locked byte-for-byte and this is new surface, not a change to the approved tints.
 */

/**
 * The scrim over a locked tile.
 *
 * The page's own canvas at 55%, not grey and not opacity on the tile. Reducing the tile's opacity
 * would fade its label with it; a scrim desaturates the coloured surface while the label keeps its
 * contrast.
 *
 * ── It must be drawn *beneath* the tile's content ───────────────────────────
 * That was the whole intent above, and for one release it was not what happened: the scrim was the
 * last child, so it washed over the label as well and took it from 15:1 to **2.68:1** — the "labels
 * are slightly too faded" defect the device pass found. The alpha is unchanged; only the z-order is.
 */
export const MODULE_LOCK_SCRIM = 'rgba(247, 248, 250, 0.55)';

/**
 * The padlock itself.
 *
 * The canvas system's secondary ink rather than black: a black padlock on a pale tint reads as an
 * error state, and a locked module is an invitation, not a fault. It measures 4.97:1 on the white card
 * surfaces and 4.55–4.66:1 on the scrimmed module tints, so it clears the 3:1 floor for a meaningful
 * indicator on every surface it is drawn on — asserted, not assumed, in
 * `main-home-lock-contrast.test.ts`. That margin is what let the tile's near-white backing disc go.
 */
export const MODULE_LOCK_INK = neutralColors.textSecondary;

/**
 * Visible padlock height, in unscaled baseline dp.
 *
 * ── Why nothing is dimmed any more ──────────────────────────────────────────
 * The locked states used to multiply labels by 0.85 and indicators by 0.5. Measured against what
 * actually rendered, the indicators landed at 1.6–2.1:1 and several accent labels below 4.5:1 — and
 * the palette's own accents (finance at 2.64:1, health at 2.90:1 on white) leave no alpha headroom
 * to spend. So the dimming is gone: a locked label, icon, dot and tab render at exactly the colour
 * their unlocked counterpart does, and this padlock is what says "locked".
 *
 * That is also the stronger accessibility position. The state is now carried by a shape and by the
 * "…, Premium feature" in every accessible name, never by colour — which is the rule, not a
 * preference. The device pass reported these glyphs as too small to recognise at 7–8 dp of ink;
 * 12 dp is inside the 12–14 dp the correction asks for.
 */
export const LOCK_GLYPH = 12;

/**
 * The smaller padlock, for the 22 dp "Today at a Glance" heading.
 *
 * One dp shy of the rest so it sits beside 10 dp text without crowding the 22 dp row. Still within
 * the recognisable range, and it replaces a 12 dp chevron so the heading's width does not move.
 */
export const LOCK_GLYPH_COMPACT = 11;
