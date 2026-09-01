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
 * Main Home honours the OS font-scale setting — issue #141.
 *
 * ── It did not, and that was the last §8 exception in the app ─────────────
 * The pack asked for `allowFontScaling={false}` on the locked visual components so an emulator's
 * accessibility settings could not disturb the pixel comparison against
 * `00-main-home-exact-reference.png`. That was a *validation* concession recorded as needing a
 * product decision before release, and the cost was measurable: at font scale 1.5 every text node on
 * the app's primary screen reported byte-identical `uiautomator` bounds to 1.0. A user who had asked
 * for larger text got none of it, on the one screen they see first.
 *
 * ── Why turning it on is not enough on its own ─────────────────────────────
 * The old note said the two requirements could not both hold, and it was right about the layout as it
 * was: three section roots carried a fixed `height`, so growing text would have overflowed *inside*
 * a card that could not grow, and the screen's own `ScrollView` fallback would never have seen it —
 * the column's total height would not have changed. Those three roots now carry `minHeight`, and
 * `main-home-screen.tsx` decides whether to scroll from the column's **measured** height rather than
 * from a constant. Growth therefore reaches the fallback that already existed.
 *
 * ── What is deliberately not done here ─────────────────────────────────────
 * No clamp. `AppText` caps a few variants whose geometry cannot absorb growth, and doing that here
 * would re-introduce the same defect in a milder form — the point is that the OS setting is honoured,
 * and the screen scrolls when it must. The locked type ramp in `main-home-metrics.ts` is untouched:
 * this changes whether the ramp scales, never what the ramp says.
 */
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
      allowFontScaling
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
