/**
 * NoorLife design tokens — the single entry point.
 *
 * Every colour, size, spacing value, radius, shadow and duration used in the
 * application must resolve through this module or through a ModuleTheme.
 *
 * Locked by docs/NOORLIFE_UI_DESIGN_SPEC.md §2 and §7. Additions are permitted
 * only when technically necessary and must be documented at the point of
 * definition.
 */

import { colors } from './colors';
import { motion } from './motion';
import { radius } from './radius';
import { shadows } from './shadows';
import { sizes } from './sizes';
import { layout, spacing } from './spacing';
import { typography } from './typography';

export {
  colors,
  modulePalettes,
  navigationColors,
  neutralColors,
  onHeroColors,
  semanticColors,
  type ModuleId,
  type ModulePalette,
  type NeutralColorToken,
  type SemanticColorToken,
} from './colors';

export {
  fontFamilies,
  fontWeights,
  minimumBodyFontSize,
  textScale,
  typography,
  type FontWeightToken,
  type TextVariant,
} from './typography';

export { layout, spacing, spacingScale, type LayoutToken, type SpacingToken } from './spacing';

export { radius, type RadiusToken } from './radius';

export {
  shadowAI,
  shadowCard,
  shadowRaised,
  shadowSpecification,
  shadows,
  type ShadowToken,
} from './shadows';

export {
  motion,
  motionDuration,
  motionEasing,
  pressScale,
  type MotionDurationToken,
} from './motion';

export {
  elementSize,
  iconSize,
  maxFontSizeMultiplier,
  sizes,
  touchTarget,
  type ElementSizeToken,
  type IconSizeToken,
} from './sizes';

/** Aggregated token object, exposed to components through DesignSystemProvider. */
export const tokens = {
  colors,
  typography,
  spacing,
  layout,
  radius,
  shadows,
  motion,
  sizes,
} as const;

export type Tokens = typeof tokens;
