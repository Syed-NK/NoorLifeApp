import { Platform, type ViewStyle } from 'react-native';

/**
 * NoorLife locked shadow tokens.
 *
 * Source of truth: docs/NOORLIFE_UI_DESIGN_SPEC.md §2.5:
 *
 *   --shadow-card:   0 4px 16px rgba(23, 32, 51, 0.07)
 *   --shadow-raised: 0 10px 28px rgba(23, 32, 51, 0.12)
 *   --shadow-ai:     0 6px 20px rgba(101, 86, 200, 0.22)
 *
 * The specified values are CSS. They are preserved verbatim in
 * `shadowSpecification` (and asserted by the token tests), then mapped to each
 * platform's native shadow model.
 *
 * Specification note on the mapping (technically necessary, no value invented):
 * React Native's `shadowRadius` is half of a CSS blur radius, so blur/2 is used.
 * Android additionally needs `elevation` to draw a shadow at all; the elevation
 * values are the standard Material steps closest to each specified blur, and
 * `shadowColor` carries the exact specified colour on Android 9+.
 *
 * §2.5 also forbids heavy glassmorphism — these three tokens are the only
 * permitted depth treatments.
 */

/** The literal CSS from the specification, kept for traceability and tests. */
export const shadowSpecification = {
  card: { offsetY: 4, blur: 16, color: 'rgba(23, 32, 51, 0.07)' },
  raised: { offsetY: 10, blur: 28, color: 'rgba(23, 32, 51, 0.12)' },
  ai: { offsetY: 6, blur: 20, color: 'rgba(101, 86, 200, 0.22)' },
} as const;

export type ShadowToken = keyof typeof shadowSpecification;

type ShadowInput = {
  readonly offsetY: number;
  readonly blur: number;
  /** Opaque base colour; opacity is supplied separately for the native models. */
  readonly baseColor: string;
  readonly opacity: number;
  readonly androidElevation: number;
};

function createShadow({
  offsetY,
  blur,
  baseColor,
  opacity,
  androidElevation,
}: ShadowInput): ViewStyle {
  return Platform.select<ViewStyle>({
    ios: {
      shadowColor: baseColor,
      shadowOffset: { width: 0, height: offsetY },
      shadowOpacity: opacity,
      shadowRadius: blur / 2,
    },
    android: {
      elevation: androidElevation,
      shadowColor: baseColor,
    },
    default: {
      boxShadow: `0 ${offsetY}px ${blur}px rgba(0, 0, 0, ${opacity})`,
    },
  }) as ViewStyle;
}

/** `--shadow-card` — resting cards and navigation surfaces. */
export const shadowCard: ViewStyle = createShadow({
  offsetY: 4,
  blur: 16,
  baseColor: '#172033',
  opacity: 0.07,
  androidElevation: 2,
});

/** `--shadow-raised` — hero cards, sheets and floating surfaces. */
export const shadowRaised: ViewStyle = createShadow({
  offsetY: 10,
  blur: 28,
  baseColor: '#172033',
  opacity: 0.12,
  androidElevation: 8,
});

/** `--shadow-ai` — the robot-head AI control only. */
export const shadowAI: ViewStyle = createShadow({
  offsetY: 6,
  blur: 20,
  baseColor: '#6556C8',
  opacity: 0.22,
  androidElevation: 6,
});

export const shadows = {
  card: shadowCard,
  raised: shadowRaised,
  ai: shadowAI,
} as const;
