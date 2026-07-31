import { useCallback, useEffect, useState } from 'react';

import type { FaithResult } from '../data/faith-result';

/**
 * Loads one Faith resource, in the shape every Faith screen renders.
 *
 * ── Why loading is derived rather than assigned ─────────────────────────────
 * The obvious implementation sets `loading` at the top of the effect and the result at
 * the bottom. That calls setState synchronously inside an effect, which cascades a render
 * and which the React Compiler rejects — the same problem `useModuleOverview` solved in
 * the shared framework, solved the same way here for consistency.
 *
 * State holds the last settled result tagged with the request key it answered. Any render
 * whose key does not match is loading by definition, so changing the input or pressing
 * retry shows a skeleton on the very first render, before any effect has run.
 *
 * ── `key` is the caller's responsibility ────────────────────────────────────
 * It must change whenever the request should re-run and stay stable when it should not.
 * Passing an object or an inline arrow as `load` without a matching key change is the one
 * way to misuse this hook, so `load` is deliberately not in the dependency array — the
 * key is the single source of "is this the same request?".
 */

export type FaithResourceState<T> =
  { readonly status: 'loading' } | { readonly status: 'settled'; readonly result: FaithResult<T> };

export type UseFaithResource<T> = FaithResourceState<T> & {
  /** Re-runs the request. Wire this to every error and offline retry. */
  readonly reload: () => void;
};

type Settled<T> = { readonly key: string; readonly result: FaithResult<T> };

export function useFaithResource<T>(
  key: string,
  load: () => Promise<FaithResult<T>>,
): UseFaithResource<T> {
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<Settled<T> | null>(null);

  const requestKey = `${key}#${attempt}`;

  useEffect(() => {
    let active = true;

    load()
      .then((result) => {
        if (active) {
          setSettled({ key: requestKey, result });
        }
      })
      .catch((error: unknown) => {
        if (!active) {
          return;
        }
        if (__DEV__) {
          console.warn(`[faith:${key}] threw`, error);
        }
        // A thrown error is a bug in a repository, not a user-facing condition — but the
        // screen still has to render something, and `error` is the honest choice.
        setSettled({
          key: requestKey,
          result: { kind: 'error', code: 'unknown' },
        });
      });

    return () => {
      active = false;
    };
    // `load` is intentionally excluded — see the note above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);

  const reload = useCallback(() => {
    setAttempt((value) => value + 1);
  }, []);

  if (settled === null || settled.key !== requestKey) {
    return { status: 'loading', reload };
  }
  return { status: 'settled', result: settled.result, reload };
}

/**
 * A resource the caller can also write to.
 *
 * Used by the tasbih counter and the worship checklist, where a tap changes the data and
 * the repository returns the new state. `apply` replaces the settled result without a
 * refetch, so the screen updates from the repository's own answer rather than from an
 * optimistic guess.
 */
export type UseMutableFaithResource<T> = UseFaithResource<T> & {
  readonly apply: (result: FaithResult<T>) => void;
};

export function useMutableFaithResource<T>(
  key: string,
  load: () => Promise<FaithResult<T>>,
): UseMutableFaithResource<T> {
  const [override, setOverride] = useState<{
    readonly key: string;
    readonly result: FaithResult<T>;
  } | null>(null);
  const base = useFaithResource(key, load);

  const apply = useCallback(
    (result: FaithResult<T>) => {
      setOverride({ key, result });
    },
    [key],
  );

  const reload = useCallback(() => {
    setOverride(null);
    base.reload();
  }, [base]);

  if (override !== null && override.key === key) {
    return { status: 'settled', result: override.result, reload, apply };
  }
  return { ...base, reload, apply };
}
