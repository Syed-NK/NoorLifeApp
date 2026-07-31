import { Image } from 'expo-image';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EntryAuthText } from '@features/entry-auth/components/entry-auth-text';
import { PrimaryButton } from '@features/entry-auth/components/primary-button';
import { SecondaryButton } from '@features/entry-auth/components/secondary-button';
import { useEntryAuthMetrics } from '@features/entry-auth/use-entry-auth-metrics';
import { getModulePictogram } from '@features/home/module-pictograms';
import type { FrameworkModuleId } from '@features/modules/module-tokens';

import { isPremiumModule } from '../domain/entitlement';
import { lockedModuleCopy } from '../subscription-copy';
import { subscriptionColors, subscriptionLayout } from '../subscription-tokens';

export type LockedModuleSheetProps = {
  readonly visible: boolean;
  readonly moduleId: FrameworkModuleId;
  readonly moduleName: string;
  readonly onViewPlans: () => void;
  readonly onNotNow: () => void;
  /** Offered where it makes sense — never on Faith, which is never locked. */
  readonly onContinueToFaith?: () => void;
  readonly testID?: string;
};

/**
 * The sheet a free user meets when they open a paid module.
 *
 * ── It refuses to render for Faith ──────────────────────────────────────────
 * `isPremiumModule` is checked here, not only by the caller. Faith must never be presented as a
 * paid feature, and a component that *cannot* show a Faith paywall is a stronger guarantee than a
 * convention that callers must remember. A test asserts nothing renders for Faith.
 *
 * ── Not a dark pattern ──────────────────────────────────────────────────────
 * "Not now" is a full-width button of the same height as "View plans", the scrim is dismissible
 * by tapping outside, and the hardware back button closes it. Nothing here traps the user or
 * disguises the way out — and the module's real PNG identifies what was asked for, so the sheet
 * is honest about the context it interrupted.
 */
export function LockedModuleSheet({
  visible,
  moduleId,
  moduleName,
  onViewPlans,
  onNotNow,
  onContinueToFaith,
  testID,
}: LockedModuleSheetProps) {
  const { dp } = useEntryAuthMetrics();
  const insets = useSafeAreaInsets();

  // Faith is never gated. Guarding here as well as at the call site is deliberate.
  if (!isPremiumModule(moduleId)) {
    return null;
  }

  const valueStatement =
    lockedModuleCopy.valueStatements[moduleId as keyof typeof lockedModuleCopy.valueStatements];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      // Android's back button must dismiss, not trap.
      onRequestClose={onNotNow}
      testID={testID}
    >
      {/* Tapping the scrim dismisses. The scrim is a button to assistive tech for the same reason. */}
      <Pressable
        style={styles.scrim}
        onPress={onNotNow}
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
        testID={`${testID ?? 'locked-sheet'}-scrim`}
      />

      <View style={styles.sheetWrap} pointerEvents="box-none">
        <View
          style={[
            styles.sheet,
            {
              padding: dp(18),
              paddingBottom: insets.bottom + dp(18),
              borderTopLeftRadius: dp(22),
              borderTopRightRadius: dp(22),
              rowGap: dp(10),
              backgroundColor: subscriptionColors.pageBackground,
            },
          ]}
          accessibilityViewIsModal
          testID={`${testID ?? 'locked-sheet'}-panel`}
        >
          <Image
            source={getModulePictogram(moduleId)}
            style={{
              width: dp(subscriptionLayout.sheetPictogram),
              height: dp(subscriptionLayout.sheetPictogram),
              alignSelf: 'center',
            }}
            contentFit="contain"
            accessible
            accessibilityRole="image"
            accessibilityLabel={moduleName}
            testID={`${testID ?? 'locked-sheet'}-pictogram`}
          />

          <EntryAuthText
            token="titleCompact"
            align="center"
            accessibilityRole="header"
            color={subscriptionColors.textPrimary}
          >
            {lockedModuleCopy.heading(moduleName)}
          </EntryAuthText>

          <EntryAuthText token="body" align="center" color={subscriptionColors.textSecondary}>
            {valueStatement}
          </EntryAuthText>

          <View style={{ rowGap: dp(8), marginTop: dp(4) }}>
            <PrimaryButton
              label={lockedModuleCopy.viewPlans}
              onPress={onViewPlans}
              testID={`${testID ?? 'locked-sheet'}-view-plans`}
            />
            <SecondaryButton
              label={lockedModuleCopy.notNow}
              onPress={onNotNow}
              testID={`${testID ?? 'locked-sheet'}-not-now`}
            />
            {onContinueToFaith === undefined ? null : (
              <Pressable
                onPress={onContinueToFaith}
                accessibilityRole="button"
                style={{
                  minHeight: dp(subscriptionLayout.minTouchTarget),
                  justifyContent: 'center',
                }}
                testID={`${testID ?? 'locked-sheet'}-faith`}
              >
                <EntryAuthText token="label" align="center" color={subscriptionColors.accent}>
                  {lockedModuleCopy.continueToFaith}
                </EntryAuthText>
              </Pressable>
            )}
          </View>
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
    // Navy at 45%, so the sheet reads as raised without the page behind it going black.
    backgroundColor: 'rgba(20, 38, 95, 0.45)',
  },
  sheetWrap: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    width: '100%',
  },
});
