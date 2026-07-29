import { StyleSheet, type TextStyle } from 'react-native';

import { fontFamilies, neutralColors, textScale, type TextVariant } from '@ds/tokens';

/**
 * Reusable typography styles, one per §2.4 type-scale step.
 *
 * `fontFamily` carries the weight rather than `fontWeight`, because on Android a
 * numeric `fontWeight` does not reliably select a registered face — it synthesises
 * a fake bold instead. Both are set so web and iOS also report the right weight
 * to assistive technology.
 */

function buildVariant(variant: TextVariant): TextStyle {
  const { size, lineHeight, weight } = textScale[variant];
  return {
    fontFamily: fontFamilies[weight],
    fontSize: size,
    lineHeight,
    color: neutralColors.textPrimary,
  };
}

export const textStyles = StyleSheet.create({
  display: buildVariant('display'),
  heroTitle: buildVariant('heroTitle'),
  screenTitle: buildVariant('screenTitle'),
  sectionTitle: buildVariant('sectionTitle'),
  cardTitle: buildVariant('cardTitle'),
  body: buildVariant('body'),
  bodyMedium: buildVariant('bodyMedium'),
  label: buildVariant('label'),
  caption: buildVariant('caption'),
  dataLarge: buildVariant('dataLarge'),
}) satisfies Record<TextVariant, TextStyle>;

/**
 * Default maximum font-scale multiplier per variant.
 *
 * Body-level text is intentionally unclamped (`undefined`) so users who need
 * large text get it. Only text inside fixed geometry is clamped, and never below
 * 1.3× — see tokens/sizes.ts for the rationale.
 */
export const variantFontScaleClamp: Readonly<Record<TextVariant, number | undefined>> = {
  display: 1.4,
  heroTitle: 1.6,
  screenTitle: 1.6,
  sectionTitle: undefined,
  cardTitle: undefined,
  body: undefined,
  bodyMedium: undefined,
  label: 1.3,
  caption: 1.3,
  dataLarge: 1.4,
};
