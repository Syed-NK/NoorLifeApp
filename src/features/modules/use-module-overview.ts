import { useCallback, useEffect, useState } from 'react';

import { mockModuleRepositoryProvider } from './services/mock-module-repository';
import type {
  ModuleDataResult,
  ModuleOverview,
  ModuleRepositoryProvider,
} from './services/module-data.contract';
import type { FrameworkModuleId } from './module-tokens';

export type ModuleOverviewState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly overview: ModuleOverview }
  | { readonly status: 'empty' }
  | { readonly status: 'offline' }
  | { readonly status: 'failed'; readonly detail?: string };

export type UseModuleOverview = ModuleOverviewState & {
  /** Re-runs the request. Wired to every error and offline state's retry. */
  readonly reload: () => void;
};

/** A settled result, tagged with the request it answered. */
type Settled = { readonly key: string; readonly state: ModuleOverviewState };

/**
 * Loads a module home's data.
 *
 * The five states map one-to-one onto the five state components, which is the point: a
 * module screen is a `switch` over this value, so it cannot render content and a
 * skeleton at once, or forget the offline case.
 *
 * ── Why the result is tagged with a key ─────────────────────────────────────
 * The obvious shape — `setState({status:'loading'})` at the top of the effect, then
 * `setState(result)` when it resolves — calls setState synchronously inside an effect,
 * which cascades an extra render and which the React Compiler rejects outright.
 *
 * So loading is *derived* rather than assigned: state holds the last settled result
 * together with the request key it belongs to, and any render whose key does not match
 * is loading by definition. Changing module or pressing retry changes the key, so the
 * screen shows a skeleton on the very first render after that change with no effect
 * having run yet — which is both correct and one render cheaper. The only setState left
 * is inside the promise callback, which is asynchronous and therefore fine.
 *
 * `provider` is injectable so the Module Gallery can mount these screens against each
 * scenario, and so tests need no network stub.
 */
export function useModuleOverview(
  moduleId: FrameworkModuleId,
  provider: ModuleRepositoryProvider = mockModuleRepositoryProvider,
): UseModuleOverview {
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<Settled | null>(null);

  const key = `${moduleId}#${attempt}`;

  useEffect(() => {
    // Guards against a resolved request from a previous module writing into this one's
    // state after a fast navigation.
    let active = true;

    provider(moduleId)
      .getOverview()
      .then((result: ModuleDataResult<ModuleOverview>) => {
        if (!active) {
          return;
        }
        setSettled({ key, state: toState(moduleId, result) });
      })
      .catch((error: unknown) => {
        if (!active) {
          return;
        }
        if (__DEV__) {
          console.warn(`[module:${moduleId}] overview threw`, error);
        }
        setSettled({ key, state: { status: 'failed' } });
      });

    return () => {
      active = false;
    };
  }, [key, moduleId, provider]);

  const reload = useCallback(() => {
    setAttempt((value) => value + 1);
  }, []);

  // A result from a previous key is stale, so this render is still loading.
  const state: ModuleOverviewState =
    settled !== null && settled.key === key ? settled.state : { status: 'loading' };

  return { ...state, reload };
}

/** Maps a repository result onto the screen state. */
function toState(
  moduleId: FrameworkModuleId,
  result: ModuleDataResult<ModuleOverview>,
): ModuleOverviewState {
  switch (result.kind) {
    case 'ok':
      return { status: 'ready', overview: result.data };
    case 'empty':
      return { status: 'empty' };
    case 'offline':
      return { status: 'offline' };
    case 'error':
      if (__DEV__) {
        // Code and detail only. The contract forbids provider messages here, so nothing
        // sensitive can reach this branch.
        console.warn(`[module:${moduleId}] overview failed`, result.code, result.detail ?? '');
      }
      return { status: 'failed', detail: result.code };
  }
}
