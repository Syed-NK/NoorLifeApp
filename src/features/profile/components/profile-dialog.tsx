import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EntryAuthText } from '@features/entry-auth/components/entry-auth-text';
import { useEntryAuthMetrics } from '@features/entry-auth/use-entry-auth-metrics';
import { subscriptionColors } from '@features/subscription/subscription-tokens';
import { useReducedMotion } from '@shared/utils/a11y';

import { PROFILE_LAYOUT } from '../profile-metrics';

export type ProfileDialogProps = {
  readonly visible: boolean;
  readonly title: string;
  readonly body: string;
  /** Fires on the scrim, the hardware back button and any explicit cancel. Never navigates. */
  readonly onRequestClose: () => void;
  /** The action stack. Supplied by the caller so a destructive dialog can style its own confirm. */
  readonly children: React.ReactNode;
  readonly testID: string;
};

/**
 * A centred confirmation dialog, shared by the two things Profile Home has to ask.
 *
 * ── Why not `Alert.alert` ───────────────────────────────────────────────────
 * The platform alert cannot carry the app's type ramp or its destructive colour, renders
 * differently on each OS, and is invisible to the component tests that have to prove "cancel
 * preserves the session". A rendered dialog is styleable, testable and identical on both
 * platforms — and the app already presents its upgrade explanation as a rendered modal rather than
 * an alert, so this is the existing convention rather than a new one.
 *
 * ── Not a trap ──────────────────────────────────────────────────────────────
 * The scrim dismisses, the hardware back button dismisses, and the cancel action is a full-width
 * control of the same height as the confirm. Nothing here disguises the way out.
 *
 * ── Reduce Motion ───────────────────────────────────────────────────────────
 * The only animation this phase introduces is the dialog's fade, and it is dropped entirely when
 * the OS asks for reduced motion.
 */
export function ProfileDialog({
  visible,
  title,
  body,
  onRequestClose,
  children,
  testID,
}: ProfileDialogProps) {
  const { dp } = useEntryAuthMetrics();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();

  return (
    <Modal
      visible={visible}
      transparent
      animationType={reduceMotion ? 'none' : 'fade'}
      onRequestClose={onRequestClose}
      testID={testID}
    >
      <Pressable
        style={styles.scrim}
        onPress={onRequestClose}
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
        testID={`${testID}-scrim`}
      />

      <View
        style={[
          styles.centre,
          {
            paddingHorizontal: dp(PROFILE_LAYOUT.pagePadding + 8),
            paddingTop: insets.top,
            paddingBottom: insets.bottom,
          },
        ]}
        pointerEvents="box-none"
      >
        <View
          style={[
            styles.panel,
            {
              padding: dp(18),
              borderRadius: dp(PROFILE_LAYOUT.cardRadius + 4),
              rowGap: dp(8),
            },
          ]}
          accessibilityViewIsModal
          testID={`${testID}-panel`}
        >
          <EntryAuthText
            token="titleCompact"
            align="center"
            accessibilityRole="header"
            color={subscriptionColors.textPrimary}
          >
            {title}
          </EntryAuthText>
          <EntryAuthText
            token="body"
            align="center"
            color={subscriptionColors.textSecondary}
            testID={`${testID}-body`}
          >
            {body}
          </EntryAuthText>
          <View style={{ rowGap: dp(8), marginTop: dp(4) }}>{children}</View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    // Navy at 45%, matching the upgrade sheet — the page behind stays readable rather than black.
    backgroundColor: 'rgba(20, 38, 95, 0.45)',
  },
  centre: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  panel: {
    width: '100%',
    maxWidth: 361,
    backgroundColor: subscriptionColors.pageBackground,
  },
});
