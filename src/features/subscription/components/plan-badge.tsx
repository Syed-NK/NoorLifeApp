import { StyleSheet, View } from 'react-native';

import { EntryAuthText } from '@features/entry-auth/components/entry-auth-text';
import { useEntryAuthMetrics } from '@features/entry-auth/use-entry-auth-metrics';

import { subscriptionColors, subscriptionLayout } from '../subscription-tokens';

export type PlanBadgeTone = 'accent' | 'neutral' | 'success' | 'warning' | 'error';

export type PlanBadgeProps = {
  readonly label: string;
  readonly tone?: PlanBadgeTone;
  /**
   * Longer text for a screen reader, where the visible label is an abbreviation.
   *
   * A savings badge reading "Save 20%" is clear visually but benefits from
   * "Save 20% compared with monthly billing" when read aloud out of context.
   */
  readonly accessibilityLabel?: string;
  readonly testID?: string;
};

const TONES: Record<PlanBadgeTone, { readonly fill: string; readonly text: string }> = {
  accent: { fill: subscriptionColors.accentSurface, text: subscriptionColors.accent },
  neutral: { fill: subscriptionColors.surfaceMuted, text: subscriptionColors.textSecondary },
  success: { fill: subscriptionColors.successSurface, text: subscriptionColors.success },
  warning: { fill: subscriptionColors.warningSurface, text: subscriptionColors.warning },
  error: { fill: subscriptionColors.errorSurface, text: subscriptionColors.error },
};

/**
 * A small pill: "Save 20%", "Always included", "Best value", a status word.
 *
 * Every tone is a tinted surface with a matching darker label rather than a saturated fill with
 * white text. At this size a filled pill reads as a button, and these are not pressable.
 */
export function PlanBadge({ label, tone = 'accent', accessibilityLabel, testID }: PlanBadgeProps) {
  const { dp } = useEntryAuthMetrics();
  const palette = TONES[tone];

  return (
    <View
      style={[
        styles.pill,
        {
          paddingHorizontal: dp(7),
          paddingVertical: dp(3),
          borderRadius: subscriptionLayout.toggleRadius,
          backgroundColor: palette.fill,
        },
      ]}
      testID={testID}
    >
      <EntryAuthText
        token="caption"
        color={palette.text}
        accessibilityLabel={accessibilityLabel}
        // Badges are decorative-adjacent but carry real meaning, so they stay in the
        // accessibility tree with their own text rather than being hidden.
      >
        {label}
      </EntryAuthText>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'flex-start',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
