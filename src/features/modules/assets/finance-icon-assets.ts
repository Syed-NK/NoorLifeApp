import type { RasterIconSource } from '@ds/components/app-icon';
import type { IconName } from '@shared/models/icon';

/**
 * Finance's commissioned coloured pictograms — issue #68, the first batch on #66's primitive.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Static `require` only ───────────────────────────────────────────────────
 * Metro resolves `require` at build time. A template string, a variable lookup or a dynamic import
 * silently resolves to nothing in a release bundle, which is exactly how an icon-font fallback gets
 * reintroduced by accident — `faith-pictogram-assets.ts` records the same rule for the assets that
 * already ship. Every path below is a literal.
 *
 * ── Keyed by icon name, scoped to this module ──────────────────────────────
 * The key is an `IconName`, so a slot cannot be invented: it has to be a semantic name the registry
 * already uses. The *scoping* is what matters, and it is not optional — four of the icon names
 * Finance uses are shared with other modules:
 *
 *   `add-circle`  family, finance, goals, planner
 *   `home`        finance, health
 *   `target`      finance, goals
 *   `robot`       seven modules
 *
 * A lookup by icon name alone would put Finance's wallet on Planner's add button and Finance's
 * artwork on Health's overview. So this table is consulted only for Finance, through
 * `module-raster-icons.ts`, and every future batch gets its own.
 *
 * ── Delivery exports, not the masters ──────────────────────────────────────
 * These are 256×256 exports derived from preserved 1254×1254 commissioned masters, mechanically
 * resampled with no artwork regenerated: cropped to their visible bounds, uniformly rescaled with an
 * alpha-aware area average, recentred on a transparent canvas, and with all four corner pixels
 * normalised to transparent black. That last step was necessary from the start — the Track and
 * Transactions masters each carried one bottom-left pixel at alpha 1/255, which the repository's
 * raster contract correctly rejected. The installed bytes are therefore *not* byte-identical to the
 * masters and should not be described as such.
 *
 * 256 is the delivery standard, and this batch is the reason there is one. It first shipped at 512,
 * which no rule then in force could see was wrong; #70 added the canvas, optical-box, safety-margin
 * and centring rules, and re-exported these five from the masters to satisfy them. The largest well
 * they land in is a 40 dp feature pictogram, so 256 is ample, and the batch went from 1.51 MB to
 * 0.31 MB on the way.
 * ═══════════════════════════════════════════════════════════════════════════
 */
export const financeIconAssets: Partial<Record<IconName, RasterIconSource>> = {
  /** Quick action "Add expense" → `/finance/transactions`. Shared icon name; Finance-scoped here. */
  'add-circle': require('../../../../assets/images/modules/finance/pictograms/finance-add-circle.png'),
  /** Quick action "Budgets" and the "Budgets" feature tile — one concept, two surfaces. */
  budgets: require('../../../../assets/images/modules/finance/pictograms/finance-budgets.png'),
  /** Feature tile "Spending" → `/finance/transactions`. */
  transactions: require('../../../../assets/images/modules/finance/pictograms/finance-transactions.png'),
  /**
   * Feature tile "Overview" → `/finance`.
   *
   * The wallet, not the house. `home` is the icon name the registry gives Finance's Overview, and a
   * house in a Finance grid reads as somebody else's icon; the commissioned wallet is what the
   * surface actually means. Scoped, so Health's Overview keeps its glyph.
   */
  home: require('../../../../assets/images/modules/finance/pictograms/finance-money.png'),
  /**
   * Feature tile "Savings" → `/finance/goals` — issue #106.
   *
   * The coin pouch, not a dartboard. `target` is the icon name the registry gives Finance's Savings
   * tile, and it is also **Goals'** primary tile icon: a bullseye here would read as Goals' mark
   * wearing Finance's colours, and Finance's pouch on a Goals tile would be worse still. Scoped
   * through `module-raster-icons.ts`, so Goals keeps its glyph and this stays the one surface that
   * resolves it.
   *
   * Delivered at 256 from a preserved 1254 × 1254 master held outside the repository. Measured
   * 78.1% optical box, 28 px minimum margin, 0.00 px off centre — inside #70's contract on every
   * axis rather than at its edge, and softer and less busy than this module's first batch, which is
   * the direction #104 fixed for new Finance artwork.
   */
  target: require('../../../../assets/images/modules/finance/pictograms/finance-goals.png'),
};

/**
 * `finance-track` is installed and deliberately unassigned.
 *
 * It depicts tracking and progress. The `track` icon name belongs to **Health**, where it is itself
 * marked unavailable, and Finance has no surface that means "track" — its nearest tiles are
 * "Spending" and "Savings", which have their own artwork and their own meanings.
 *
 * So it is left out rather than forced onto a tile it does not describe. Naming it here, as a
 * constant a test asserts against, is what keeps that a recorded decision instead of an oversight
 * somebody re-litigates from the file listing.
 */
export const FINANCE_UNASSIGNED_ASSETS: readonly string[] = ['finance-track.png'];

/** Every file this batch installed, for the on-disk audit. */
export const FINANCE_ASSET_FILES: readonly string[] = [
  'finance-add-circle.png',
  'finance-budgets.png',
  'finance-goals.png',
  'finance-money.png',
  'finance-track.png',
  'finance-transactions.png',
];

/**
 * Receipts artwork exists, passes the contract, and is **not** installed here — issue #106.
 *
 * The delivery file was validated in the same pass as this one and reported no violations: 256²
 * RGBA, 78.1% optical box, 28 px margins, 0.50 px off centre, no metadata. It is nevertheless held
 * outside the repository, and this note is the reason it is not an oversight.
 *
 * Finance's Receipts capability is `available: false`. #104's rule is that an unavailable surface
 * draws its neutral glyph, and `moduleRasterIcon` refuses artwork for one by construction — so an
 * installed Receipts asset would resolve nowhere, fail the manifest's own no-orphan rule, and sit in
 * the bundle as a file nothing renders. The alternative, flipping the tile to available so the
 * artwork has somewhere to go, would promise a feature that does not exist.
 *
 * **#101 is the sole gate.** When Receipts is built and the capability becomes available, the asset
 * is installed in the same pass — not before.
 */
export const FINANCE_HELD_ASSETS: readonly string[] = ['finance-receipts.png'];
