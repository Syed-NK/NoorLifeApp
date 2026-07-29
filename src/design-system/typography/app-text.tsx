import { Text, type StyleProp, type TextProps, type TextStyle } from 'react-native';

import type { TextVariant } from '@ds/tokens';
import { textStyles, variantFontScaleClamp } from './text-styles';

export type AppTextProps = Omit<TextProps, 'style'> & {
  /** §2.4 type-scale step. Defaults to `body`. */
  readonly variant?: TextVariant;
  /** Colour override. Must come from a token or a ModuleTheme, never a literal. */
  readonly color?: string;
  readonly style?: StyleProp<TextStyle>;
  readonly children?: React.ReactNode;
};

/**
 * The only text primitive in NoorLife.
 *
 * Every string rendered by the app goes through here so that the type scale,
 * font family and text-scaling clamps stay in one place. Components must not use
 * `<Text>` from react-native directly.
 *
 * Text scaling: `allowFontScaling` stays on and the per-variant clamp from
 * text-styles.ts is applied, so large-text users are served without titles
 * bursting out of fixed hero geometry (§8).
 */
export function AppText({
  variant = 'body',
  color,
  style,
  maxFontSizeMultiplier,
  children,
  ...rest
}: AppTextProps) {
  return (
    <Text
      {...rest}
      allowFontScaling
      maxFontSizeMultiplier={maxFontSizeMultiplier ?? variantFontScaleClamp[variant]}
      style={[textStyles[variant], color === undefined ? null : { color }, style]}
    >
      {children}
    </Text>
  );
}
