import { modulePalettes, type ModuleId } from '@ds/tokens';

/**
 * Per-module tile treatment for the Main Home grid.
 *
 * Locked by the compact-layout correction: each tile carries a very light shade of its own
 * module colour rather than being plain white, with a 0.75 dp border in the module colour
 * at ~12–16% opacity — no dark grey outline.
 *
 * The tint values are given explicitly by the correction. They are lighter than the
 * existing `soft` palette entries in NOORLIFE_UI_DESIGN_SPEC.md §2.3 (for example Faith
 * `#ECF8F2` here versus `#E9F6F1` there), so they are recorded here rather than folded
 * into the global palette — they belong to this one surface.
 */
export const MODULE_TILE_TINT: Readonly<Record<Exclude<ModuleId, 'main'>, string>> = {
  'noor-ai': '#F1EEFF',
  faith: '#ECF8F2',
  health: '#EDF8FE',
  planner: '#F1F0FF',
  finance: '#FFF5E8',
  learning: '#F3EFFF',
  family: '#FFF0F4',
  goals: '#ECF9F7',
};

/** Border alpha, inside the specified 12–16% band. */
const BORDER_ALPHA = 0.14;

/**
 * Tile border colour: the module primary at 14% opacity.
 *
 * Derived from the palette rather than hard-coded, so a palette change carries through and
 * the border can never drift away from its module's hue.
 */
export function moduleTileBorder(moduleId: Exclude<ModuleId, 'main'>): string {
  const hex = modulePalettes[moduleId].primary;
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${BORDER_ALPHA})`;
}
