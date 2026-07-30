import { useModule } from '../module-context';
import { ModuleStateView } from './module-state-view';

export type ModuleErrorStateProps = {
  readonly title?: string;
  readonly body?: string;
  /** Retry handler. Always offered — an error the user cannot act on is a dead end. */
  readonly onRetry: () => void;
  readonly retryLabel?: string;
  /**
   * A short technical detail, shown only in development.
   *
   * Never a stack trace, a token, or a raw provider response in a release build:
   * the user gets the plain sentence, the developer gets the code.
   */
  readonly developerDetail?: string;
  readonly testID?: string;
};

/**
 * A request failed.
 *
 * The copy comes from the module's `stateCopy.error`, which is written to a rule:
 * say what failed, say it was our side, and say the user's data is safe. "Something
 * went wrong" fails all three, and it is what made a real signup error unreadable
 * earlier in this project.
 *
 * `onRetry` is required rather than optional, so an error state cannot be rendered
 * without a way out of it.
 */
export function ModuleErrorState({
  title,
  body,
  onRetry,
  retryLabel,
  developerDetail,
  testID,
}: ModuleErrorStateProps) {
  const { stateCopy } = useModule();

  const detail = __DEV__ && developerDetail !== undefined ? ` (${developerDetail})` : '';

  return (
    <ModuleStateView
      icon="error"
      title={title ?? stateCopy.error.title}
      body={`${body ?? stateCopy.error.body}${detail}`}
      primaryAction={{ label: retryLabel ?? stateCopy.error.action, onPress: onRetry }}
      testID={testID ?? 'module-error-state'}
    />
  );
}
