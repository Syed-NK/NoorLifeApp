import { ScrollView, StyleSheet, View } from 'react-native';

import { AuthHeader } from '@features/entry-auth/components/auth-header';
import { AuthScaffold } from '@features/entry-auth/components/auth-scaffold';
import { EntryAuthText } from '@features/entry-auth/components/entry-auth-text';
import { useEntryAuthMetrics } from '@features/entry-auth/use-entry-auth-metrics';

import { mockModeCopy } from '../subscription-copy';
import { subscriptionColors, subscriptionLayout } from '../subscription-tokens';

/**
 * The shell every subscription and family screen is built on.
 *
 * Wraps the entry flow's `AuthScaffold`, so these screens inherit the soft-mint page, the safe
 * areas, the 16 dp side padding and the 393 dp capped content column *from the same code* the
 * approved auth screens use — rather than from a second implementation that has to be kept
 * looking the same.
 *
 * ── Scrolling ───────────────────────────────────────────────────────────────
 * Content scrolls vertically; the footer does not. The brief allows vertical scrolling on
 * detailed screens but requires the plan selector, price, CTA, Continue with Free and Restore
 * Purchases to stay discoverable — so the primary actions belong in `footer`, pinned, while the
 * feature lists and legal copy scroll above them.
 *
 * Horizontal scrolling never happens: the column is capped, not wide.
 */
export type SubscriptionScreenScaffoldProps = {
  readonly title: string;
  readonly subtitle?: string;
  readonly onBack?: () => void;
  readonly children: React.ReactNode;
  /** Pinned below the scroll area. The place for the CTA stack. */
  readonly footer?: React.ReactNode;
  /**
   * Whether purchases are simulated.
   *
   * Renders a plain, unmissable badge. It is passed in rather than read from context so a screen
   * cannot forget the prop and silently hide it — a missing badge on a build that cannot take
   * money is the failure mode worth guarding.
   */
  readonly isMockMode?: boolean;
  readonly scrollable?: boolean;
  readonly testID?: string;
};

export function SubscriptionScreenScaffold({
  title,
  subtitle,
  onBack,
  children,
  footer,
  isMockMode = false,
  scrollable = true,
  testID,
}: SubscriptionScreenScaffoldProps) {
  const { dp } = useEntryAuthMetrics();

  const body = (
    <View style={{ gap: dp(subscriptionLayout.cardGap) }}>
      {/* The heading is the screen's first meaningful element, so focus lands on it after
          navigation rather than on a back button. */}
      <AuthHeader
        onBack={onBack}
        title={title}
        subtitle={subtitle}
        testID={`${testID ?? 'subscription'}-header`}
      />
      {isMockMode ? <MockModeBadge testID={testID} /> : null}
      {children}
    </View>
  );

  return (
    <AuthScaffold testID={testID} footer={footer}>
      {scrollable ? (
        <ScrollView
          style={styles.fill}
          contentContainerStyle={{ paddingBottom: dp(20) }}
          showsVerticalScrollIndicator={false}
          testID={`${testID ?? 'subscription'}-scroll`}
        >
          {body}
        </ScrollView>
      ) : (
        body
      )}
    </AuthScaffold>
  );
}

/**
 * States plainly that no real purchase can happen.
 *
 * Not a subtle corner ribbon: the brief requires mock mode to be clearly labelled in development
 * and never shown in production, and the honest presentation of "this cannot take your money" is
 * a full-width line the user cannot miss.
 */
export function MockModeBadge({ testID }: { readonly testID?: string }) {
  const { dp } = useEntryAuthMetrics();

  return (
    <View
      style={[
        styles.badge,
        {
          paddingVertical: dp(7),
          paddingHorizontal: dp(10),
          borderRadius: dp(8),
          backgroundColor: subscriptionColors.warningSurface,
        },
      ]}
      accessibilityRole="alert"
      testID={`${testID ?? 'subscription'}-mock-badge`}
    >
      <EntryAuthText token="caption" color={subscriptionColors.warning} align="center">
        {mockModeCopy.badge}
      </EntryAuthText>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  badge: {
    width: '100%',
  },
});
