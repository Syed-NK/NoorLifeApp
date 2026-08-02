import { Pressable, StyleSheet } from 'react-native';

import { AppIcon } from '@ds/components';
import { EntryAuthText } from '@features/entry-auth/components/entry-auth-text';
import { useEntryAuthMetrics } from '@features/entry-auth/use-entry-auth-metrics';
import { subscriptionColors } from '@features/subscription/subscription-tokens';

import { PROFILE_LAYOUT } from '../profile-metrics';

export type ProfileDestructiveRowProps = {
  readonly label: string;
  readonly accessibilityHint: string;
  readonly onPress: () => void;
  readonly testID: string;
};

/**
 * A row whose action would be irreversible, drawn as one.
 *
 * ── Why it is a component rather than the logout row reused ─────────────────
 * `ProfileLogoutRow` owns its own confirmation dialog and its own copy, which is correct for the
 * one thing it does and wrong for anything else. This is the presentation alone: the caller
 * decides what pressing it asks, which is what lets Delete Account raise an *informational*
 * blocking sheet rather than a confirm/cancel pair for an action that cannot happen yet.
 *
 * ── Not red alone ───────────────────────────────────────────────────────────
 * The label is the error colour and the label also reads "Delete Account", and the sheet it opens
 * names the consequence in words. Colour never carries the meaning by itself — the same rule every
 * status surface in this feature follows.
 *
 * The row is `PROFILE_LAYOUT.logout.height` — 48 dp, above the 44 dp minimum — so the target is
 * the row itself rather than a hit-slop approximation of one.
 */
export function ProfileDestructiveRow({
  label,
  accessibilityHint,
  onPress,
  testID,
}: ProfileDestructiveRowProps) {
  const { dp } = useEntryAuthMetrics();

  return (
    <Pressable
      onPress={onPress}
      accessible
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      style={[
        styles.row,
        {
          minHeight: dp(PROFILE_LAYOUT.logout.height),
          paddingHorizontal: dp(PROFILE_LAYOUT.logout.paddingHorizontal),
          borderRadius: dp(PROFILE_LAYOUT.cardRadius),
        },
      ]}
      testID={testID}
    >
      <EntryAuthText token="body" color={subscriptionColors.error}>
        {label}
      </EntryAuthText>
      <AppIcon
        name="chevron-forward"
        size={dp(PROFILE_LAYOUT.logout.chevron)}
        color={subscriptionColors.error}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: PROFILE_LAYOUT.cardBorder,
    borderColor: subscriptionColors.error,
    backgroundColor: subscriptionColors.surface,
  },
});
