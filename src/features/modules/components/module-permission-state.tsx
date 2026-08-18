import { StyleSheet, View } from 'react-native';

import type { ModulePermission } from '../module-definition';
import { moduleLayout, moduleNeutrals } from '../module-tokens';
import { useModuleMetrics } from '../use-module-metrics';
import { ModuleStateView } from './module-state-view';
import { ModuleText } from './module-text';

export type ModulePermissionStateProps = {
  readonly permission: ModulePermission;
  /** Opens the OS prompt. */
  readonly onGrant: () => void;
  /**
   * Continues without the permission.
   *
   * Required whenever `permission.required` is false — which is every permission in
   * the registry today. A module that works without a permission must let the user
   * say no and carry on, or the prompt is coercive rather than a choice.
   */
  readonly onSkip?: () => void;
  readonly testID?: string;
};

/**
 * A permission the module needs, explained before the OS prompt appears.
 *
 * The OS dialog gives one line and two buttons; it cannot say *why*. Showing the
 * reason first is what makes the difference between a user who grants knowingly and
 * one who denies on reflex — and a denial is usually permanent, because Android will
 * not ask twice.
 *
 * The rationale is rendered verbatim from the registry, where it is a required field.
 * If a module cannot say what a permission unlocks, that is a sign it should not be
 * asking for it.
 */
export function ModulePermissionState({
  permission,
  onGrant,
  onSkip,
  testID,
}: ModulePermissionStateProps) {
  const { dp } = useModuleMetrics();

  return (
    <ModuleStateView
      icon="lock"
      title={permission.title}
      body={permission.rationale}
      primaryAction={{ label: 'Allow access', onPress: onGrant }}
      secondaryAction={
        // A required permission has no "not now" — but nothing in the registry is
        // required, so in practice the skip is always offered.
        permission.required || onSkip === undefined
          ? undefined
          : { label: 'Not now', onPress: onSkip }
      }
      announcement={`${permission.title}. ${permission.rationale}. NoorLife will ask your device for permission.`}
      testID={testID ?? 'module-permission-state'}
    >
      <View
        style={[
          styles.note,
          {
            borderRadius: dp(moduleLayout.radiusSmall),
            paddingHorizontal: dp(10),
            paddingVertical: dp(7),
            marginTop: dp(2),
          },
        ]}
      >
        <ModuleText token="caption" align="center" numberOfLines={3}>
          {permission.required
            ? 'This module needs this permission to work.'
            : 'You can change this later in Settings.'}
        </ModuleText>
      </View>
    </ModuleStateView>
  );
}

const styles = StyleSheet.create({
  note: {
    backgroundColor: moduleNeutrals.surfaceMuted,
    maxWidth: 280,
  },
});
