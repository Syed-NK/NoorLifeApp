import { Text, type TextProps, type TextStyle } from 'react-native';

import { fontFamilies } from '@ds/tokens';

import { entryAuthColors } from '../entry-auth-tokens';
import type { EntryAuthTypeToken } from '../entry-auth-tokens';
import { useEntryAuthMetrics } from '../use-entry-auth-metrics';

/** Which Poppins face each token uses. Headings are SemiBold and never heavier. */
const FACE: Record<EntryAuthTypeToken, keyof typeof fontFamilies> = {
  title: 'semiBold',
  titleCompact: 'semiBold',
  subtitle: 'regular',
  label: 'medium',
  body: 'regular',
  button: 'semiBold',
  caption: 'regular',
  otp: 'semiBold',
};

export type EntryAuthTextProps = TextProps & {
  readonly token: EntryAuthTypeToken;
  /** Defaults per token: headings primary, supporting copy secondary. */
  readonly color?: string;
  readonly align?: TextStyle['textAlign'];
};

/**
 * Text for every entry/authentication screen.
 *
 * Resolves face, size, line height and colour from one token, so no screen sets a `fontFamily`
 * or a raw size. That is what keeps "headings are Poppins SemiBold, never ExtraBold" a
 * property of the system rather than a thing to check at each call site.
 *
 * `allowFontScaling` is left at its default of true throughout: accessibility requires that
 * authentication forms respect the OS text size, and the phase prompt calls out disabling it as
 * a defect. Where a control's geometry cannot absorb unlimited growth, the call site caps the
 * multiplier instead of switching scaling off.
 */
export function EntryAuthText({ token, color, align, style, ...rest }: EntryAuthTextProps) {
  const { type } = useEntryAuthMetrics();
  const { fontSize, lineHeight } = type(token);

  const defaultColor =
    token === 'subtitle' || token === 'caption' || token === 'label'
      ? entryAuthColors.textSecondary
      : entryAuthColors.textPrimary;

  return (
    <Text
      style={[
        {
          fontFamily: fontFamilies[FACE[token]],
          fontSize,
          lineHeight,
          color: color ?? defaultColor,
          textAlign: align,
        },
        style,
      ]}
      {...rest}
    />
  );
}
