/**
 * NoorLife locked border-radius tokens.
 *
 * Source of truth: docs/NOORLIFE_UI_DESIGN_SPEC.md §2.5.
 */

export const radius = {
  /** Button and input radius. */
  control: 12,
  /** Standard card radius. */
  card: 18,
  /** Hero-card radius. */
  hero: 24,
  /** Fully rounded pill / circle. */
  pill: 999,
} as const;

export type RadiusToken = keyof typeof radius;
