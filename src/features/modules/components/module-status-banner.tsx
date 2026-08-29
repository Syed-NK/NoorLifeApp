import { StyleSheet, View } from 'react-native';

import { AppIcon, PressableScale } from '@ds/components';
import type { IconName } from '@shared/models/icon';
import { minimumHitSlop, minimumTouchTargetSize } from '@shared/utils/a11y';

import { useStatusInkBorder } from '../module-surfaces';
import { moduleLayout, moduleNeutrals } from '../module-tokens';
import { useModuleMetrics } from '../use-module-metrics';
import { ModuleText } from './module-text';

export type ModuleStatusTone = 'info' | 'success' | 'warning' | 'error';

const TONE: Readonly<
  Record<
    ModuleStatusTone,
    {
      readonly color: string;
      readonly surface: string;
      readonly icon: IconName;
      readonly prefix: string;
    }
  >
> = {
  info: {
    color: moduleNeutrals.info,
    surface: moduleNeutrals.infoSurface,
    icon: 'info',
    prefix: 'Information',
  },
  success: {
    color: moduleNeutrals.success,
    surface: moduleNeutrals.successSurface,
    icon: 'check-circle',
    prefix: 'Success',
  },
  warning: {
    color: moduleNeutrals.warning,
    surface: moduleNeutrals.warningSurface,
    icon: 'warning',
    prefix: 'Warning',
  },
  error: {
    color: moduleNeutrals.error,
    surface: moduleNeutrals.errorSurface,
    icon: 'error',
    prefix: 'Error',
  },
};

export type ModuleStatusBannerProps = {
  readonly tone: ModuleStatusTone;
  readonly message: string;
  /** Optional inline action, e.g. "Retry". */
  readonly actionLabel?: string;
  readonly onAction?: () => void;
  /** Shows a dismiss control when provided. */
  readonly onDismiss?: () => void;
  readonly testID?: string;
};

/**
 * A transient message at the top of a module screen.
 *
 * Three things make it accessible rather than merely coloured:
 *
 *   • a tone icon, so the four tones differ by shape as well as by hue
 *   • `accessibilityLiveRegion="polite"`, so a screen reader announces the message
 *     when it appears instead of the user discovering it by chance
 *   • the tone spoken as a word — the label reads "Error, couldn't load…", because a
 *     red left border communicates nothing to someone listening
 *
 * `polite` rather than `assertive` on purpose: it waits for the current utterance to
 * finish. An assertive banner interrupts mid-word, which is more disorienting than
 * the half-second wait.
 */
export function ModuleStatusBanner({
  tone,
  message,
  actionLabel,
  onAction,
  onDismiss,
  testID,
}: ModuleStatusBannerProps) {
  const { dp } = useModuleMetrics();
  const spec = TONE[tone];
  /*
    On an opted-in module the banner draws its semantic ink as a full border — issue #91.

    Finance's `pageSurface` `#FFF3E6` and `warningSurface` `#FFF6E6` are 1.02:1 apart: the same
    colour to any eye. A banner there cannot be identified by its fill, so the fill stays and the
    ink carries the edge — #86 asserts that ink clears the 3:1 non-text bar on every module page.

    Neutral pages are untouched. Their fills are already distinguishable, and bordering them would
    change seven modules' appearance for no reason. Outside a module provider this is `false`.
  */
  const inkBorder = useStatusInkBorder();

  return (
    <View
      style={[
        styles.root,
        {
          backgroundColor: spec.surface,
          borderRadius: dp(moduleLayout.radiusSmall),
          borderLeftColor: spec.color,
          ...(inkBorder ? { borderWidth: 1, borderColor: spec.color } : null),
          paddingVertical: dp(9),
          paddingHorizontal: dp(10),
          columnGap: dp(8),
        },
      ]}
      accessible
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      accessibilityLabel={`${spec.prefix}. ${message}`}
      testID={testID}
    >
      <AppIcon name={spec.icon} size={dp(16)} color={spec.color} />

      <ModuleText token="banner" numberOfLines={4} style={styles.message}>
        {message}
      </ModuleText>

      {actionLabel === undefined || onAction === undefined ? null : (
        <PressableScale
          onPress={onAction}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          hitSlop={minimumHitSlop(dp(22))}
          style={{
            minWidth: minimumTouchTargetSize(),
            minHeight: minimumTouchTargetSize(),
            alignItems: 'center',
            justifyContent: 'center',
          }}
          testID={`${testID ?? 'module-banner'}-action`}
        >
          <ModuleText token="sectionAction" color={spec.color} numberOfLines={1}>
            {actionLabel}
          </ModuleText>
        </PressableScale>
      )}

      {onDismiss === undefined ? null : (
        <PressableScale
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel="Dismiss message"
          hitSlop={minimumHitSlop(dp(18))}
          style={{
            minWidth: minimumTouchTargetSize(),
            minHeight: minimumTouchTargetSize(),
            alignItems: 'center',
            justifyContent: 'center',
          }}
          testID={`${testID ?? 'module-banner'}-dismiss`}
        >
          <AppIcon name="close" size={dp(15)} color={moduleNeutrals.textSecondary} />
        </PressableScale>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'center',
    borderLeftWidth: 3,
  },
  message: {
    flex: 1,
    minWidth: 0,
  },
});
