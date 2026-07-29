/**
 * NoorLife locked motion tokens.
 *
 * Source of truth: docs/NOORLIFE_UI_DESIGN_SPEC.md §7.
 *
 * Reduced-motion system settings must be respected (see shared/utils/a11y.ts).
 * Continuous decorative animation behind text is forbidden.
 */

export const motionDuration = {
  /** Standard screen transition. */
  standard: 200,
  /** Modal and bottom-sheet presentation. */
  modal: 240,
  /** Button press feedback. */
  press: 100,
  /** Progress bar / ring fill. Specified range is 400–600 ms. */
  progressMin: 400,
  progressMax: 600,
} as const;

export type MotionDurationToken = keyof typeof motionDuration;

export const motionEasing = {
  /** §7: standard transition is ease-out. */
  standard: 'ease-out',
} as const;

/** §7: button press scales to 0.98. */
export const pressScale = 0.98;

export const motion = {
  duration: motionDuration,
  easing: motionEasing,
  pressScale,
} as const;
