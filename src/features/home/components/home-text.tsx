import { Text, type StyleProp, type TextProps, type TextStyle } from 'react-native';

import { fontFamilies, neutralColors, type FontWeightToken } from '@ds/tokens';
import { LOCKED_TYPE, type LockedTypeToken } from '../main-home-metrics';
import { useMetrics } from '../main-home-metrics-context';

/** Weight per locked type token, from lock §5–§13. */
const WEIGHTS: Readonly<Record<LockedTypeToken, FontWeightToken>> = {
  greeting: 'regular',
  name: 'semiBold',
  badge: 'semiBold',
  heroEyebrow: 'medium',
  // 600, never 700+. The correction is explicit that the heading previously read too bold
  // against the reference, and Poppins Bold is what caused it.
  heroHeadline: 'semiBold',
  heroButton: 'semiBold',
  tileLabel: 'medium',
  sectionTitle: 'semiBold',
  viewAll: 'medium',
  time: 'regular',
  activity: 'medium',
  summaryTitle: 'semiBold',
  summaryValue: 'semiBold',
  progressValue: 'semiBold',
  progressSupport: 'regular',
  aiTitle: 'semiBold',
  aiBody: 'regular',
  quickActionLabel: 'medium',
  navLabel: 'medium',
};

/**
 * Per-token letter spacing, where the pack specifies one.
 *
 * Only the hero heading needs it: −0.25 dp tightens the three lines without touching the
 * weight, which is what keeps the heading looking lighter than the previous bold version.
 */
const LETTER_SPACING: Partial<Record<LockedTypeToken, number>> = {
  heroHeadline: -0.25,
};

export type HomeTextProps = Omit<TextProps, 'style'> & {
  readonly token: LockedTypeToken;
  readonly color?: string;
  readonly style?: StyleProp<TextStyle>;
  readonly children?: React.ReactNode;
};

/**
 * Whether Main Home's locked text honours the OS font-scale setting.
 *
 * ── Deliberately `false`, and this needs revisiting before production ───────
 * The pack asks for `allowFontScaling={false}` on the locked visual components so an
 * emulator's accessibility settings cannot distort the pixel comparison against
 * `00-main-home-exact-reference.png`. That is a *validation* concession, not a product
 * decision, and it conflicts with NOORLIFE_UI_DESIGN_SPEC.md §8 ("Dynamic text scaling
 * without clipping").
 *
 * The whole screen is a fixed-height, no-scroll compact layout, so honouring a 1.3×
 * scale here would overflow several cards rather than reflow them — the two requirements
 * genuinely cannot both hold at these dimensions.
 *
 * Before release, either flip this to `true` and let the layout fall back to its
 * `ScrollView` branch under large font scales, or supply a scaled type ramp. Every other
 * screen in the app already scales normally through `AppText`; this constant confines the
 * exception to Main Home.
 */
const ALLOW_FONT_SCALING = false;

/**
 * Text primitive for Main Home only.
 *
 * Renders the type ramp fixed by the implementation pack, which does not map onto the
 * §2.4 global scale — see main-home-metrics.ts for why that override is scoped to this
 * screen. Everywhere else in the app continues to use `AppText`.
 *
 * `fontFamily` carries the weight rather than `fontWeight`: Poppins faces are registered
 * per weight, and a numeric `fontWeight` does not reliably select a registered face on
 * Android — it synthesises a fake bold instead, which is exactly how the hero heading
 * previously read heavier than the reference.
 */
export function HomeText({ token, color, style, children, ...rest }: HomeTextProps) {
  const { fs } = useMetrics();
  const [size, lineHeight] = LOCKED_TYPE[token];

  return (
    <Text
      {...rest}
      allowFontScaling={ALLOW_FONT_SCALING}
      style={[
        {
          fontFamily: fontFamilies[WEIGHTS[token]],
          fontSize: fs(size),
          lineHeight: fs(lineHeight),
          color: color ?? neutralColors.textPrimary,
        },
        LETTER_SPACING[token] === undefined ? null : { letterSpacing: LETTER_SPACING[token] },
        style,
      ]}
    >
      {children}
    </Text>
  );
}
