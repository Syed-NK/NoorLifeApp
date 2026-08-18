import { Pressable, StyleSheet } from 'react-native';

import { EntryAuthText } from '@features/entry-auth/components/entry-auth-text';
import { useEntryAuthMetrics } from '@features/entry-auth/use-entry-auth-metrics';

import { welcomeCopy } from '../subscription-copy';
import { subscriptionColors, subscriptionLayout } from '../subscription-tokens';

export type RestorePurchasesButtonProps = {
  readonly onPress: () => void;
  readonly busy?: boolean;
  readonly testID?: string;
};

/**
 * Restore Purchases, as a text action.
 *
 * ── Why it is always visible ─────────────────────────────────────────────────
 * Both stores require a restore path to be reachable, and the brief lists it as non-negotiable.
 * It is a low-emphasis text control rather than a third button so it does not compete with the
 * purchase CTA and Continue with Free — but it is never hidden behind a menu, and never omitted
 * from a screen that sells something.
 *
 * The full 44 dp touch target is honoured through `minHeight` rather than padding, so the label
 * stays visually tight against the legal copy beneath it.
 */
export function RestorePurchasesButton({
  onPress,
  busy = false,
  testID,
}: RestorePurchasesButtonProps) {
  const { dp } = useEntryAuthMetrics();

  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityState={{ busy, disabled: busy }}
      accessibilityHint="Checks your store account for a previous NoorLife subscription"
      style={[styles.target, { minHeight: dp(subscriptionLayout.minTouchTarget) }]}
      testID={testID ?? 'restore-purchases'}
    >
      <EntryAuthText
        token="label"
        align="center"
        color={busy ? subscriptionColors.disabled : subscriptionColors.accent}
      >
        {welcomeCopy.restore}
      </EntryAuthText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  target: {
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
});
