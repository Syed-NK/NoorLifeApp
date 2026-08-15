import { useCallback, useSyncExternalStore } from 'react';

import {
  getFaithPreferencesSnapshot,
  hydrateFaithPreferences,
  subscribeToFaithPreferences,
  updateFaithPreferences,
  type FaithPreferencesPatch,
} from '../state/faith-preferences-store';
import type { FaithPreferences } from '../storage/faith-preferences';

/**
 * The user's Faith preferences, read from the module's one shared store.
 *
 * ── What this hook no longer does ───────────────────────────────────────────
 * Hold state. It used to own a `useState` and an effect that read storage, which meant every call
 * site had a private copy that no other call site could update — see the note at the top of
 * `faith-preferences-store.ts` for the switch that was pressed and stayed off because of it. All this
 * does now is subscribe to the store and expose its update path.
 *
 * ── Why it can be called anywhere ───────────────────────────────────────────
 * `FaithPreferencesProvider` mounts at the Faith boundary and is what makes hydration happen once for
 * the module, but this hook does not require it: hydration is memoised in the store, so a consumer
 * mounted outside the Faith stack — or in a test that renders one screen — starts it harmlessly and
 * every other consumer joins the same read.
 */

export type UseFaithPreferences = {
  readonly preferences: FaithPreferences;
  readonly ready: boolean;
  /**
   * Set when the last write did not reach the device. `null` in the normal case.
   *
   * Surfaced rather than swallowed: a preference that silently failed to save is one the user will
   * find changed back after a restart, with no way to know why.
   */
  readonly persistenceError: string | null;
  /**
   * Applies a patch, or a function of the current preferences.
   *
   * Pass a function whenever the next value depends on the current one. Every mutation is serialised
   * by the store, so a functional updater is guaranteed to see the result of the update before it —
   * which a captured `preferences` from this render is not.
   *
   * Resolves with the merged preferences, so a caller that needs the result — to derive what to
   * reschedule from, say — reads it from the write rather than from a render that has not happened
   * yet.
   */
  readonly update: (patch: FaithPreferencesPatch) => Promise<FaithPreferences>;
};

export function useFaithPreferences(): UseFaithPreferences {
  /*
    `useSyncExternalStore` rather than a context value: it is the API that guarantees every subscriber
    sees the same snapshot in the same commit, including under concurrent rendering, where a context
    holding a mutable ref can tear.
  */
  const snapshot = useSyncExternalStore(
    subscribeToFaithPreferences,
    getFaithPreferencesSnapshot,
    /* Server/static render: the same snapshot. There is no storage to read on that path. */
    getFaithPreferencesSnapshot,
  );

  /*
    Idempotent and memoised in the store. Called during render rather than in an effect so the first
    paint after mount already has the read in flight — an effect would delay it by a frame on the
    screens that gate a fetch on `ready`.
  */
  void hydrateFaithPreferences();

  /* Stable for the life of the process: the store is a singleton, so there is nothing to close over. */
  const update = useCallback((patch: FaithPreferencesPatch) => updateFaithPreferences(patch), []);

  return {
    preferences: snapshot.preferences,
    ready: snapshot.ready,
    persistenceError: snapshot.persistenceError,
    update,
  };
}
