import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { EntryAuthText } from '@features/entry-auth/components/entry-auth-text';
import { PrimaryButton } from '@features/entry-auth/components/primary-button';
import { SecondaryButton } from '@features/entry-auth/components/secondary-button';
import { useEntryAuthMetrics } from '@features/entry-auth/use-entry-auth-metrics';

import { subscriptionColors, subscriptionLayout } from '../subscription-tokens';

/**
 * Loading, error and banner presentations shared by every subscription screen.
 *
 * Grouped because they are the same obligation seen three ways: the brief requires loading to be
 * announced, errors to be announced, and every screen to have a defined state for offline, slow
 * network and store failure. One file means one place to check that each announces itself.
 */

export type SubscriptionLoadingStateProps = {
  readonly message: string;
  readonly testID?: string;
};

/**
 * A centred spinner with its status announced.
 *
 * `accessibilityLiveRegion="polite"` plus `role="progressbar"` is what makes a screen reader say
 * something when this appears. A silent spinner is invisible to a non-sighted user, who then has
 * no way to tell a loading screen from an empty one.
 */
export function SubscriptionLoadingState({ message, testID }: SubscriptionLoadingStateProps) {
  const { dp } = useEntryAuthMetrics();

  return (
    <View
      style={[styles.centred, { rowGap: dp(10), paddingVertical: dp(28) }]}
      accessibilityRole="progressbar"
      accessibilityLiveRegion="polite"
      accessibilityLabel={message}
      testID={testID}
    >
      <ActivityIndicator color={subscriptionColors.accent} />
      <EntryAuthText token="body" color={subscriptionColors.textSecondary} align="center">
        {message}
      </EntryAuthText>
    </View>
  );
}

export type SubscriptionErrorStateProps = {
  readonly title: string;
  readonly body: string;
  readonly actionLabel?: string;
  readonly onAction?: () => void;
  readonly secondaryLabel?: string;
  readonly onSecondary?: () => void;
  readonly testID?: string;
};

/**
 * An error with a way out.
 *
 * Always offers an action, and never blames the user. Announced as an alert so it is not silently
 * swapped in beneath a screen reader's focus.
 */
export function SubscriptionErrorState({
  title,
  body,
  actionLabel,
  onAction,
  secondaryLabel,
  onSecondary,
  testID,
}: SubscriptionErrorStateProps) {
  const { dp } = useEntryAuthMetrics();

  return (
    <View
      style={[styles.centred, { rowGap: dp(8), paddingVertical: dp(20) }]}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      testID={testID}
    >
      <EntryAuthText
        token="titleCompact"
        align="center"
        accessibilityRole="header"
        color={subscriptionColors.textPrimary}
      >
        {title}
      </EntryAuthText>
      <EntryAuthText token="body" align="center" color={subscriptionColors.textSecondary}>
        {body}
      </EntryAuthText>
      <View style={[styles.actions, { rowGap: dp(8), marginTop: dp(6) }]}>
        {actionLabel === undefined || onAction === undefined ? null : (
          <PrimaryButton
            label={actionLabel}
            onPress={onAction}
            testID={`${testID ?? 'error'}-action`}
          />
        )}
        {secondaryLabel === undefined || onSecondary === undefined ? null : (
          <SecondaryButton
            label={secondaryLabel}
            onPress={onSecondary}
            testID={`${testID ?? 'error'}-secondary`}
          />
        )}
      </View>
    </View>
  );
}

export type SubscriptionStateBannerTone = 'info' | 'success' | 'warning' | 'error';

export type SubscriptionStateBannerProps = {
  readonly tone: SubscriptionStateBannerTone;
  readonly message: string;
  readonly testID?: string;
};

const BANNER_TONES: Record<
  SubscriptionStateBannerTone,
  { readonly fill: string; readonly text: string }
> = {
  info: { fill: subscriptionColors.accentSurface, text: subscriptionColors.accent },
  success: { fill: subscriptionColors.successSurface, text: subscriptionColors.success },
  warning: { fill: subscriptionColors.warningSurface, text: subscriptionColors.warning },
  error: { fill: subscriptionColors.errorSurface, text: subscriptionColors.error },
};

/**
 * An inline status strip — grace period, cancelled-but-active, purchase cancelled.
 *
 * A tinted surface with a darker label rather than a saturated fill, so the message keeps its
 * contrast and does not read as a pressable control.
 */
export function SubscriptionStateBanner({ tone, message, testID }: SubscriptionStateBannerProps) {
  const { dp } = useEntryAuthMetrics();
  const palette = BANNER_TONES[tone];

  return (
    <View
      style={[
        styles.banner,
        {
          padding: dp(10),
          borderRadius: dp(subscriptionLayout.cardRadius),
          backgroundColor: palette.fill,
        },
      ]}
      accessibilityLiveRegion="polite"
      accessibilityRole={tone === 'error' ? 'alert' : 'text'}
      testID={testID}
    >
      <EntryAuthText token="caption" color={palette.text}>
        {message}
      </EntryAuthText>
    </View>
  );
}

const styles = StyleSheet.create({
  centred: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  actions: {
    width: '100%',
  },
  banner: {
    width: '100%',
  },
});
