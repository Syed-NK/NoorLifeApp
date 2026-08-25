import type { RasterIconSource } from '@ds/components/app-icon';
import type { IconName } from '@shared/models/icon';

import { financeIconAssets } from './assets/finance-icon-assets';
import type { FrameworkModuleId } from './module-tokens';

/**
 * Which module has commissioned artwork for which icon — issue #68.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Why the lookup is per module and not per icon ──────────────────────────
 * Four of the icon names Finance uses are shared: `add-circle` with Family, Goals and Planner;
 * `home` with Health; `target` with Goals; `robot` with six other modules. A lookup keyed on the
 * icon name alone would put Finance's wallet on Planner's add button, which is a worse defect than
 * the flat glyph it replaced — wrong artwork reads as a bug, a flat glyph reads as unfinished.
 *
 * So artwork is addressed by the pair. A module with no table gets glyphs everywhere, which is every
 * module except Finance today.
 *
 * ── Why unavailable items never get artwork ────────────────────────────────
 * An unavailable feature tile signals itself partly by tinting its icon to `textTertiary`, and
 * commissioned raster artwork cannot be tinted — #66's primitive makes that a compile error, because
 * tinting a pictogram destroys the thing it was commissioned for.
 *
 * Rather than let a disabled tile render a full-colour icon and rely on the surrounding opacity to
 * carry the state, this refuses artwork for anything unavailable. The disabled affordance then stays
 * exactly what it was, by construction rather than by remembering — and a future batch cannot break
 * it by adding a row to its own table.
 * ═══════════════════════════════════════════════════════════════════════════
 */
const MODULE_RASTER_ICONS: Partial<
  Record<FrameworkModuleId, Partial<Record<IconName, RasterIconSource>>>
> = {
  finance: financeIconAssets,
};

/**
 * The commissioned artwork for this module's icon, or `null` to use the glyph.
 *
 * @param available Whether the surface rendering it is usable. `false` returns `null` — see above.
 */
export function moduleRasterIcon(
  /**
   * The module asking. Typed as a plain string because that is what `useModule()` exposes; an
   * unrecognised value is simply absent from the table and gets the glyph, which is the same safe
   * outcome as a module with no artwork.
   */
  moduleId: string,
  icon: IconName,
  available = true,
): RasterIconSource | null {
  if (!available) {
    return null;
  }
  return MODULE_RASTER_ICONS[moduleId as FrameworkModuleId]?.[icon] ?? null;
}

/** Which modules have any commissioned artwork, for the batch audit. */
export function modulesWithRasterIcons(): readonly FrameworkModuleId[] {
  return Object.keys(MODULE_RASTER_ICONS) as FrameworkModuleId[];
}

/** The icon names a module has artwork for, for the mapping audit. */
export function rasterIconNamesFor(moduleId: FrameworkModuleId): readonly IconName[] {
  return Object.keys(MODULE_RASTER_ICONS[moduleId] ?? {}) as IconName[];
}
