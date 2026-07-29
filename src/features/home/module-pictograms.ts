import type { ImageSourcePropType } from 'react-native';

import type { ModuleId } from '@ds/tokens';

/**
 * The approved PNG module pictograms — **normalized** variants.
 *
 * Locked by PNG_PICTOGRAM_IMPLEMENTATION_LOCK.md and the grid-spacing correction.
 *
 * These point at `assets/images/pictograms/normalized/`, produced from the cleaned
 * originals (which remain in the parent directory, untouched, as the source of record).
 * Each normalized file is cropped to its visible bounds, rescaled and recentred on a
 * transparent 256 × 256 canvas.
 *
 * ── Why the canvas occupancy is not uniform ─────────────────────────────────
 * Every cleaned original already had a bounding box at ~85% of its canvas, so the
 * perceived-size differences were never about padding — they came from fill density
 * *inside* that box: health 78% of its bbox is opaque, planner 62%, noor-ai 56%,
 * finance 49%, goals 47%, learning 46%, faith 41%, family 36%. A thin figure reads small
 * even when its bounding box is large.
 *
 * The correction asks for ratios against Health (Noor AI +20%, Faith +14%, Finance +14%,
 * Learning +10%, Family +6.5%, Planner/Goals equal). Holding Health at 85% and enlarging
 * Noor AI by 20% would need 102% of the canvas, so the ratios are achieved by bringing the
 * dense icons down instead: the largest lands at 85% and every icon keeps ≥19 px of
 * transparent safety margin. All eight then render at one shared 48 dp Image size with
 * equal visual weight and no per-module size overrides.
 *
 * These are static `require` calls on purpose: React Native's asset pipeline resolves
 * image references at bundle time, so a computed path would fail to bundle.
 *
 * Rules enforced at the call site in module-grid.tsx:
 *   • one shared 48 dp Image with `resizeMode="contain"`
 *   • no coloured or white square behind the PNG, and no `tintColor`
 *   • never substituted with MaterialCommunityIcons, Lucide, SVG, emoji or a glyph
 */
export const modulePictograms = {
  ai: require('@assets/images/pictograms/normalized/noor-ai.png') as ImageSourcePropType,
  faith: require('@assets/images/pictograms/normalized/faith.png') as ImageSourcePropType,
  health: require('@assets/images/pictograms/normalized/health.png') as ImageSourcePropType,
  planner: require('@assets/images/pictograms/normalized/planner.png') as ImageSourcePropType,
  finance: require('@assets/images/pictograms/normalized/finance.png') as ImageSourcePropType,
  learning: require('@assets/images/pictograms/normalized/learning.png') as ImageSourcePropType,
  family: require('@assets/images/pictograms/normalized/family.png') as ImageSourcePropType,
  goals: require('@assets/images/pictograms/normalized/goals.png') as ImageSourcePropType,
} as const;

export type PictogramKey = keyof typeof modulePictograms;

/**
 * Maps a module id to its pictogram key.
 *
 * The registry uses `ai` where the module registry uses `noor-ai`; this is the single
 * place that difference is reconciled.
 */
const MODULE_TO_PICTOGRAM: Readonly<Record<Exclude<ModuleId, 'main'>, PictogramKey>> = {
  'noor-ai': 'ai',
  faith: 'faith',
  health: 'health',
  planner: 'planner',
  finance: 'finance',
  learning: 'learning',
  family: 'family',
  goals: 'goals',
};

/**
 * Resolves a module's pictogram.
 *
 * Throws rather than falling back to an icon: a missing asset must be reported, never
 * silently substituted.
 */
export function getModulePictogram(moduleId: Exclude<ModuleId, 'main'>): ImageSourcePropType {
  const key = MODULE_TO_PICTOGRAM[moduleId];
  const source = modulePictograms[key];
  if (source === undefined) {
    throw new Error(
      `Missing module pictogram for "${moduleId}". Expected assets/images/pictograms/normalized/${key === 'ai' ? 'noor-ai' : key}.png`,
    );
  }
  return source;
}

/** The signed-in user's avatar. Project-local, never a remote URL. */
export const profileAvatar =
  require('@assets/images/profile/ahmed-profile.png') as ImageSourcePropType;
