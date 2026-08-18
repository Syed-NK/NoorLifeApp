import { useEffect } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';

import { useModule } from '../module-context';
import { useModuleMetrics } from '../use-module-metrics';
import { ModuleSkeletonGroup } from './module-skeleton';

export type ModuleLoadingStateProps = {
  /** Placeholder rows below the card block. */
  readonly rows?: number;
  /** Overrides the module's own announcement. */
  readonly announcement?: string;
  readonly testID?: string;
};

/**
 * The module is fetching.
 *
 * Skeletons rather than a spinner: a placeholder in the shape of the content tells
 * the user what is arriving, and it does not imply measurable progress the way a
 * progress bar does.
 *
 * ── Why the announcement is imperative rather than a live region ────────────
 * The skeletons are hidden from accessibility, so a screen-reader user would
 * otherwise be told nothing at all while the screen sits empty. `announceForAccessibility`
 * speaks the module's `stateCopy.loading` line once on mount. A live region would not
 * work here, because there is no text node inside the state to announce.
 */
export function ModuleLoadingState({ rows, announcement, testID }: ModuleLoadingStateProps) {
  const { stateCopy } = useModule();
  const { dp } = useModuleMetrics();
  const message = announcement ?? stateCopy.loading;

  useEffect(() => {
    AccessibilityInfo.announceForAccessibility(message);
  }, [message]);

  return (
    <View
      style={[styles.root, { paddingTop: dp(4) }]}
      accessibilityRole="progressbar"
      accessibilityLabel={message}
      // Busy, with no determinate value — there is no honest percentage to report.
      accessibilityState={{ busy: true }}
      testID={testID ?? 'module-loading-state'}
    >
      <ModuleSkeletonGroup rows={rows} testID={`${testID ?? 'module-loading-state'}-skeletons`} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignSelf: 'stretch',
  },
});
