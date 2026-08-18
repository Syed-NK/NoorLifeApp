import type { ImageSourcePropType } from 'react-native';

/**
 * **The six bead materials: what they are called, what they look like, and which one works.**
 *
 * ── Two different questions, kept apart on purpose ──────────────────────────
 * A material has a **thumbnail** — the 256 px bead photograph in the selector row — and a **stage
 * plate**, the full close-up the counting screen is drawn over. As of the V4 pack all six have both,
 * so every swatch is functional and selecting one replaces the whole stage.
 *
 * The two stay separate anyway. They were separate when only walnut had a plate, and keeping them so
 * is what let the screen be honest about it rather than tinting walnut green and calling it jade —
 * the arrangement to fall back to if a seventh material is ever specified ahead of its artwork.
 *
 * ── Why the id is not a filename ────────────────────────────────────────────
 * A stored preference outlives the file it points at. Persisting an asset path would break the
 * moment artwork is re-exported, and it leaks a build detail into user data. The id is a stable
 * word; resolving it to an asset happens here, each time.
 *
 * ── Why the paths are literal ───────────────────────────────────────────────
 * Metro resolves `require` at bundle time and cannot follow a computed path, so
 * `require(\`…-${id}.png\`)` silently bundles nothing. Every path is written out, and the map is a
 * complete `Record`, which makes a missing variant a compile error rather than a blank swatch.
 */

/**
 * The six, in the order the approved design shows them.
 *
 * Order is part of the design rather than incidental — the selected material is found by position as
 * much as by appearance, so it must not be re-sorted by availability or alphabetically.
 *
 * The ids match the approved manifest exactly. `figured-brown` was briefly called `figured-stone`
 * here while the artwork was still a specification; the manifest is the authority and nothing had
 * persisted the old spelling, because no material could be selected until now.
 */
export const TASBIH_MATERIALS = [
  { id: 'walnut', label: 'Walnut' },
  { id: 'green-jade', label: 'Green jade' },
  { id: 'black-onyx', label: 'Black onyx' },
  { id: 'white-jade', label: 'White jade' },
  { id: 'sandalwood', label: 'Sandalwood' },
  { id: 'figured-brown', label: 'Figured brown' },
] as const;

export type TasbihMaterialId = (typeof TASBIH_MATERIALS)[number]['id'];

/** Walnut is the design's default, the one the locked mock shows selected, and the one that works. */
export const DEFAULT_TASBIH_MATERIAL_ID: TasbihMaterialId = 'walnut';

/** The 256 × 256 selector thumbnails. All six are approved production artwork. */
const THUMBNAILS: Record<TasbihMaterialId, ImageSourcePropType> = {
  walnut:
    require('@assets/images/modules/faith/tasbih/tasbih-material-walnut.png') as ImageSourcePropType,
  'green-jade':
    require('@assets/images/modules/faith/tasbih/tasbih-material-green-jade.png') as ImageSourcePropType,
  'black-onyx':
    require('@assets/images/modules/faith/tasbih/tasbih-material-black-onyx.png') as ImageSourcePropType,
  'white-jade':
    require('@assets/images/modules/faith/tasbih/tasbih-material-white-jade.png') as ImageSourcePropType,
  sandalwood:
    require('@assets/images/modules/faith/tasbih/tasbih-material-sandalwood.png') as ImageSourcePropType,
  'figured-brown':
    require('@assets/images/modules/faith/tasbih/tasbih-material-figured-brown.png') as ImageSourcePropType,
};

/**
 * The full stage plate for each material — the V4 "full tail" pack.
 *
 * ── What changed, and why every earlier plate is gone ───────────────────────
 * The first plate was 852 × 1846, a portrait phone shape, and `cover` inside a near-square stage cut
 * away the gold terminal and most of the right-hand beads. The second was 1254 × 1254 and fixed the
 * crop but still only existed for walnut. These six are 1254 × 1254 each and carry the complete
 * terminal, braided loop and tassel *inside* the canvas, so the artwork is rendered with `contain`
 * and never cropped at all.
 *
 * A complete `Record` this time, not a `Partial`: every material has a plate, so a missing one is a
 * compile error rather than a silent fallback to walnut.
 */
const STAGE_PLATES: Record<TasbihMaterialId, ImageSourcePropType> = {
  walnut:
    require('@assets/images/modules/faith/tasbih/tasbih-stage-walnut.png') as ImageSourcePropType,
  'green-jade':
    require('@assets/images/modules/faith/tasbih/tasbih-stage-green-jade.png') as ImageSourcePropType,
  'black-onyx':
    require('@assets/images/modules/faith/tasbih/tasbih-stage-black-onyx.png') as ImageSourcePropType,
  'white-jade':
    require('@assets/images/modules/faith/tasbih/tasbih-stage-white-jade.png') as ImageSourcePropType,
  sandalwood:
    require('@assets/images/modules/faith/tasbih/tasbih-stage-sandalwood.png') as ImageSourcePropType,
  'figured-brown':
    require('@assets/images/modules/faith/tasbih/tasbih-stage-figured-brown.png') as ImageSourcePropType,
};

/**
 * The plates are square, and so is the stage.
 *
 * Exactly 1, from the manifest. The stage is sized by this rather than by a height so the whole
 * plate lands inside it at every width — with `contain` and a matching aspect there is no crop and
 * no letterbox, which is the only arrangement that keeps the tassel on screen.
 */
export const STAGE_ASPECT_RATIO = 1;

export function materialThumbnail(id: TasbihMaterialId): ImageSourcePropType {
  return THUMBNAILS[id];
}

/** The stage artwork for a material. Every material has its own; nothing substitutes for another. */
export function stagePlate(id: TasbihMaterialId): ImageSourcePropType {
  return STAGE_PLATES[id];
}

/**
 * Every material is selectable now that all six plates exist.
 *
 * Kept as a function rather than deleted: it is the single place that would answer the question
 * again if a seventh material were specified before its artwork arrived, and the tests assert
 * through it rather than assuming.
 */
export function isMaterialAvailable(id: TasbihMaterialId): boolean {
  return STAGE_PLATES[id] !== undefined;
}

export function availableMaterials(): readonly TasbihMaterialId[] {
  return TASBIH_MATERIALS.map((material) => material.id).filter(isMaterialAvailable);
}

export function isTasbihMaterialId(value: unknown): value is TasbihMaterialId {
  return TASBIH_MATERIALS.some((material) => material.id === value);
}

export function materialLabel(id: TasbihMaterialId): string {
  return TASBIH_MATERIALS.find((material) => material.id === id)?.label ?? id;
}
