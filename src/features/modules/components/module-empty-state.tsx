import { useModule } from '../module-context';
import { ModuleStateView } from './module-state-view';

export type ModuleEmptyStateProps = {
  /** Overrides the registry copy, for a sub-screen with a narrower emptiness. */
  readonly title?: string;
  readonly body?: string;
  readonly actionLabel?: string;
  /** Omit to render the state without a call to action. */
  readonly onAction?: () => void;
  readonly testID?: string;
};

/**
 * Nothing recorded yet.
 *
 * Copy defaults to the module's `stateCopy.empty`, which every module supplies. That
 * is deliberate: a generic "No data" tells the user nothing about what to do, and the
 * useful sentence differs per module ("Log one thing today" vs "Invite a family
 * member"). Making it part of the module definition means a new module cannot ship
 * without having thought about its empty state.
 */
export function ModuleEmptyState({
  title,
  body,
  actionLabel,
  onAction,
  testID,
}: ModuleEmptyStateProps) {
  const { stateCopy } = useModule();

  return (
    <ModuleStateView
      icon="sparkle"
      title={title ?? stateCopy.empty.title}
      body={body ?? stateCopy.empty.body}
      primaryAction={
        onAction === undefined
          ? undefined
          : { label: actionLabel ?? stateCopy.empty.action, onPress: onAction }
      }
      testID={testID ?? 'module-empty-state'}
    />
  );
}
