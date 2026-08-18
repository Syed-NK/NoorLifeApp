import { useModule } from '../module-context';
import { ModuleStateView } from './module-state-view';

export type ModuleOfflineStateProps = {
  readonly title?: string;
  readonly body?: string;
  /** Offered when reconnecting is worth retrying manually. */
  readonly onRetry?: () => void;
  readonly testID?: string;
};

/**
 * No connection.
 *
 * Distinct from the error state on purpose. An error means something broke; offline
 * means the app is working and the network is not, and the useful information is
 * *what still works*. Each module's `stateCopy.offline` therefore says so — Health
 * can still log entries, Family cannot add a shared plan. Presenting both situations
 * with one "Something went wrong" screen would lose that.
 */
export function ModuleOfflineState({ title, body, onRetry, testID }: ModuleOfflineStateProps) {
  const { stateCopy } = useModule();

  return (
    <ModuleStateView
      icon="offline"
      title={title ?? stateCopy.offline.title}
      body={body ?? stateCopy.offline.body}
      primaryAction={onRetry === undefined ? undefined : { label: 'Try again', onPress: onRetry }}
      testID={testID ?? 'module-offline-state'}
    />
  );
}
