import { Pressable, StyleSheet, View } from 'react-native';

import { EntryAuthText } from '@features/entry-auth/components/entry-auth-text';
import { useEntryAuthMetrics } from '@features/entry-auth/use-entry-auth-metrics';
import { PlanBadge } from '@features/subscription/components/plan-badge';
import { subscriptionColors, subscriptionLayout } from '@features/subscription/subscription-tokens';

import { profileCopy } from '../profile-copy';

export type ProfileSectionProps = {
  readonly title: string;
  readonly children: React.ReactNode;
  readonly testID?: string;
};

/** A titled white card holding a group of rows. */
export function ProfileSection({ title, children, testID }: ProfileSectionProps) {
  const { dp } = useEntryAuthMetrics();

  return (
    <View style={{ rowGap: dp(6) }} testID={testID}>
      <EntryAuthText token="caption" color={subscriptionColors.textSecondary}>
        {title.toUpperCase()}
      </EntryAuthText>
      <View style={[styles.card, { borderRadius: dp(subscriptionLayout.cardRadius) }]}>
        {children}
      </View>
    </View>
  );
}

export type ProfileRowProps = {
  readonly label: string;
  /** Trailing value, for rows that state a fact rather than navigate. */
  readonly value?: string;
  readonly onPress?: () => void;
  /**
   * Marks a row whose destination does not exist yet.
   *
   * ── Why this hides the row in production ────────────────────────────────────
   * The brief forbids nonfunctional settings in production, and a row that opens nothing is
   * exactly that. Rather than trusting each call site to remember, a `comingLater` row renders
   * **only** in development, where it is visibly labelled. In a production build it is absent
   * entirely — a missing row is honest, a dead one is not.
   */
  readonly comingLater?: boolean;
  readonly destructive?: boolean;
  readonly testID?: string;
};

export function ProfileRow({
  label,
  value,
  onPress,
  comingLater = false,
  destructive = false,
  testID,
}: ProfileRowProps) {
  const { dp } = useEntryAuthMetrics();

  // Absent in production. See the note on `comingLater`.
  if (comingLater && !__DEV__) {
    return null;
  }

  const labelColor = destructive ? subscriptionColors.error : subscriptionColors.textPrimary;
  const interactive = onPress !== undefined && !comingLater;

  const content = (
    <View style={[styles.row, { paddingHorizontal: dp(12), columnGap: dp(10) }]}>
      <EntryAuthText token="body" color={labelColor} style={styles.label}>
        {label}
      </EntryAuthText>

      {comingLater ? (
        <PlanBadge
          label={profileCopy.comingLater}
          tone="neutral"
          testID={`${testID ?? 'row'}-later`}
        />
      ) : value !== undefined ? (
        <EntryAuthText token="caption" color={subscriptionColors.textSecondary}>
          {value}
        </EntryAuthText>
      ) : interactive ? (
        // A chevron drawn from two borders — these screens do not substitute icon-font glyphs.
        <View
          style={{
            width: dp(8),
            height: dp(8),
            borderRightWidth: 2,
            borderTopWidth: 2,
            borderColor: subscriptionColors.textSecondary,
            transform: [{ rotate: '45deg' }],
          }}
        />
      ) : null}
    </View>
  );

  if (!interactive) {
    return (
      <View
        style={{ minHeight: dp(subscriptionLayout.minTouchTarget), justifyContent: 'center' }}
        testID={testID}
      >
        {content}
      </View>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      // 44 dp minimum, enforced here rather than per row so no call site can undercut it.
      style={{ minHeight: dp(subscriptionLayout.minTouchTarget), justifyContent: 'center' }}
      testID={testID}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    borderWidth: 1,
    borderColor: subscriptionColors.border,
    backgroundColor: subscriptionColors.surface,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  label: {
    flexShrink: 1,
  },
});
