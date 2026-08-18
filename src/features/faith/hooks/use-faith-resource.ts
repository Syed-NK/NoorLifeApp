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
 *
 * ── A `null` key means "not yet", and it is not the same as an empty one ────
 * Some requests cannot be described until something else has settled: the reader cannot ask for a
 * surah until it knows which translation edition to ask for alongside it. Without a way to say so,
 * the caller has to invent a placeholder key, fetch against it, and then fetch *again* when the real
 * key arrives — which is exactly the double verse request that made this option necessary.
 *
 * `null` holds the hook in `loading`, runs nothing, and starts the request on the render where a
 * real key appears. The screen shows the skeleton it already has for that state.
 */

export type FaithResourceState<T> =
  { readonly status: 'loading' } | { readonly status: 'settled'; readonly result: FaithResult<T> };

export type UseFaithResource<T> = FaithResourceState<T> & {
  /** Re-runs the request. Wire this to every error and offline retry. */
  readonly reload: () => void;
  /**
   * True while a request is in flight *behind content that is already on screen*.
   *
   * ── The defect this exists to name ──────────────────────────────────────────
   * `status` used to be the only signal, and it went back to `loading` on every `reload()`. The
   * screen renders `loading` as a skeleton, so pressing refresh on a fully-drawn Qur'an catalogue
   * replaced 114 rows with grey blocks, and a background revalidation could not be expressed at all
   * without doing the same. Answering a request the user can still see the answer to should not
   * take the answer away.
   *
   * So a re-run of a request that has already settled keeps `status: 'settled'` with the previous
   * result, and raises this flag instead. `FaithResourceView` draws a small non-blocking indication
   * from it. It is never true on a first load — there is nothing to keep — and never true across a
   * change of *which* resource is being requested, for which see the note on `key` below.
   */
  readonly refreshing: boolean;
};

type Settled<T> = { readonly key: string; readonly result: FaithResult<T> };

/** Sentinel for a request that cannot be described yet. Contains `#`, so no real key collides. */
const PENDING_KEY = '#pending';

/**
 * Whether a settled result is one worth keeping on screen while it is re-requested.
 *
 * Only `ok` and `stale` carry data. Holding an `error`, `offline` or `empty` state visible through a
 * retry would be the opposite of what retry is for: the user pressed it precisely to stop looking at
 * that, and a spinner beside an unchanged error reads as a control that did nothing.
 */
function isShowable<T>(result: FaithResult<T>): boolean {
  return result.kind === 'ok' || result.kind === 'stale';
}

export function useFaithResource<T>(
  key: string | null,
  load: () => Promise<FaithResult<T>>,
): UseFaithResource<T> {
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<Settled<T> | null>(null);

  /**
   * A key no settled result can ever carry, so a `null` key renders as loading by the same
   * comparison every other not-yet-answered request uses. No extra branch in the return.
   */
  const requestKey = key === null ? PENDING_KEY : `${key}#${attempt}`;

  useEffect(() => {
    if (requestKey === PENDING_KEY) {
      return;
    }
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
    /**
     * A request is outstanding. Whether that means "show a skeleton" depends on whether there is
     * anything to keep, and on whether keeping it would be a lie.
     *
     * `baseKey` is the request without its attempt counter, so a `reload()` matches and a change of
     * subject does not. That distinction is the safety property: retaining across attempts shows the
     * same catalogue while the same catalogue is refetched, whereas retaining across base keys would
     * show Al-Baqarah's verses under Al-Kahf's header for as long as the new page took to arrive.
     * A different resource genuinely has no content yet, and a skeleton is the honest state for it.
     */
    const baseKey = key === null ? PENDING_KEY : key;
    const previousBaseKey = settled?.key.slice(0, settled.key.lastIndexOf('#'));
    if (
      settled !== null &&
      requestKey !== PENDING_KEY &&
      previousBaseKey === baseKey &&
      isShowable(settled.result)
    ) {
      return { status: 'settled', result: settled.result, reload, refreshing: true };
    }
    return { status: 'loading', reload, refreshing: false };
  }
  return { status: 'settled', result: settled.result, reload, refreshing: false };
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
    // An applied result came from a write this screen just performed, so nothing is outstanding.
    return { status: 'settled', result: override.result, reload, refreshing: false, apply };
  }
  return { ...base, reload, apply };
}
