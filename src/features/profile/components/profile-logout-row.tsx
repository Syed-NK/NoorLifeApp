import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppIcon } from '@ds/components';
import { EntryAuthText } from '@features/entry-auth/components/entry-auth-text';
import { SecondaryButton } from '@features/entry-auth/components/secondary-button';
import { useEntryAuthMetrics } from '@features/entry-auth/use-entry-auth-metrics';
import { subscriptionColors } from '@features/subscription/subscription-tokens';

import { profileCopy } from '../profile-copy';
import { PROFILE_LAYOUT } from '../profile-metrics';
import { ProfileDialog } from './profile-dialog';

export type ProfileLogoutRowProps = {
  /**
   * Runs the real sign-out and navigates on success.
   *
   * Only ever called after an explicit confirmation. A rejection is surfaced rather than swallowed:
   * a failed sign-out leaves the session live, and a screen that navigated away regardless would be
   * showing a signed-out interface over a signed-in account.
   */
  readonly onConfirm: () => Promise<void>;
  readonly testID?: string;
};

/**
 * Log Out, and the question that has to come first.
 *
 * ── Why the confirmation lives in this component ────────────────────────────
 * The row and its dialog are one behaviour: there is no state of the world in which the row should
 * exist without the confirmation, and holding the flag here means no screen can mount the row and
 * forget to wire the question. `onConfirm` is only reached from the dialog's destructive button —
 * cancelling, tapping the scrim and the hardware back button all close it and touch nothing, so
 * the session survives every path except the deliberate one.
 *
 * ── Destructive, and not only in red ────────────────────────────────────────
 * The label is the error colour, and it also *says* "Log Out"; the dialog then names the
 * consequence in words. Colour is never the only carrier — the rule this file shares with every
 * status indicator in the app.
 *
 * Delete Account is deliberately absent. It belongs to Privacy & Security, not to a summary.
 */
export function ProfileLogoutRow({ onConfirm, testID = 'profile-log-out' }: ProfileLogoutRowProps) {
  const { dp } = useEntryAuthMetrics();
  const [confirming, setConfirming] = useState(false);
  const [failed, setFailed] = useState(false);

  const cancel = useCallback(() => setConfirming(false), []);
  const confirm = useCallback(() => {
    setConfirming(false);
    void onConfirm().catch(() => setFailed(true));
  }, [onConfirm]);

  return (
    <View>
      <Pressable
        onPress={() => setConfirming(true)}
        accessible
        accessibilityRole="button"
        accessibilityLabel={profileCopy.logout.label}
        accessibilityHint={profileCopy.logout.hint}
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
          {profileCopy.logout.label}
        </EntryAuthText>
        <AppIcon
          name="chevron-forward"
          size={dp(PROFILE_LAYOUT.logout.chevron)}
          color={subscriptionColors.error}
        />
      </Pressable>

      {/* Mounted only while it is being asked, the same rule the upgrade-sheet host follows: a
          modal that is permanently mounted with `visible={false}` is a component tree, a set of
          accessibility subscriptions and a render pass that exist for nothing. */}
      {confirming ? (
        <ProfileDialog
          visible={confirming}
          title={profileCopy.logout.confirmTitle}
          body={profileCopy.logout.confirmBody}
          onRequestClose={cancel}
          testID={`${testID}-confirm`}
        >
          <Pressable
            onPress={confirm}
            accessible
            accessibilityRole="button"
            accessibilityLabel={profileCopy.logout.confirm}
            style={[
              styles.destructive,
              {
                minHeight: dp(PROFILE_LAYOUT.minTouchTarget),
                borderRadius: dp(12),
              },
            ]}
            testID={`${testID}-confirm-accept`}
          >
            <EntryAuthText token="button" color={subscriptionColors.error}>
              {profileCopy.logout.confirm}
            </EntryAuthText>
          </Pressable>

          <SecondaryButton
            label={profileCopy.logout.cancel}
            onPress={cancel}
            testID={`${testID}-confirm-cancel`}
          />
        </ProfileDialog>
      ) : null}

      {failed ? (
        <ProfileDialog
          visible={failed}
          title={profileCopy.logout.failedTitle}
          body={profileCopy.logout.failedBody}
          onRequestClose={() => setFailed(false)}
          testID={`${testID}-failed`}
        >
          <SecondaryButton
            label={profileCopy.logout.failedDismiss}
            onPress={() => setFailed(false)}
            testID={`${testID}-failed-dismiss`}
          />
        </ProfileDialog>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: PROFILE_LAYOUT.cardBorder,
    borderColor: subscriptionColors.border,
    backgroundColor: subscriptionColors.surface,
  },
  destructive: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: subscriptionColors.error,
    backgroundColor: subscriptionColors.errorSurface,
  },
});
