import { View } from 'react-native';

import { useEntryAuthMetrics } from '@features/entry-auth/use-entry-auth-metrics';
import { subscriptionColors } from '@features/subscription/subscription-tokens';

export type ProfileSkeletonBarProps = {
  /** Baseline dp. Matched to the line height of the text it stands in for. */
  readonly height: number;
  readonly width: number | `${number}%`;
  readonly testID?: string;
};

/**
 * A placeholder for one line of text that has not arrived yet.
 *
 * ── Why a static bar rather than a shimmer ──────────────────────────────────
 * A shimmer is an animation, and this phase introduces no animation that Reduce Motion would then
 * have to switch off. A flat tinted bar carries the same information — "something belongs here and
 * it is on its way" — at no motion cost.
 *
 * It is hidden from assistive technology: the card that owns it carries a single "loading" label,
 * which is one announcement instead of three meaningless ones.
 */
export function ProfileSkeletonBar({ height, width, testID }: ProfileSkeletonBarProps) {
  const { dp } = useEntryAuthMetrics();

  return (
    <View
      style={{
        height: dp(height),
        width: typeof width === 'number' ? dp(width) : width,
        borderRadius: dp(4),
        backgroundColor: subscriptionColors.surfaceMuted,
      }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID={testID}
    />
  );
}
