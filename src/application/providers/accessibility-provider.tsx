import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import {
  readBooleanPreference,
  writeBooleanPreference,
  type PreferenceRead,
} from '@services/preferences/device-preferences';
import { MotionPreferenceContext } from '@shared/accessibility/motion-preference';
import { useSystemReducedMotion } from '@shared/utils/a11y';

/**
 * The application's accessibility preferences, loaded once and shared.
 *
 * ── Why this is a provider and not a hook per screen ────────────────────────
 * Two requirements force it. A preference changed on `/profile/preferences` has to take effect
 * *without a restart*, which means the dialogs, sheets and transitions elsewhere in the app must
 * be re-rendered by the same change — that is a shared value, not a local one. And the preference
 * has to be readable by an animation that has never heard of Profile, which is what
 * `MotionPreferenceContext` is for: this provider fills it, `useReducedMotion` reads it, and no
 * component imports a storage service to find out whether it may animate.
 *
 * ── Why the load state is exposed ───────────────────────────────────────────
 * Device storage can fail. The Preferences screen has to be able to say "we could not load your
 * settings" and offer a retry rather than rendering an off switch that is really an unknown one,
 * so `status` distinguishes loading, loaded and unavailable. `saveStatus` does the same for the
 * write: a switch that flipped but did not persist says so.
 *
 * ── What is deliberately not here ───────────────────────────────────────────
 * Text size. It follows the operating system's font scale, which React Native already applies to
 * every `Text` in the app; an in-app slider would multiply against it and produce a size neither
 * setting asked for. The Preferences screen therefore explains the system setting and offers a way
 * to it — there is nothing to store.
 */

export type AccessibilityStatus = 'loading' | 'ready' | 'unavailable';

export type AccessibilityPreferences = {
  /** The user's NoorLife choice. False until storage has been read. */
  readonly preferReduceMotion: boolean;
  /** The operating system's setting, which overrides the preference when enabled. */
  readonly systemReduceMotion: boolean;
  /** What animations actually do — `systemReduceMotion || preferReduceMotion`. */
  readonly reduceMotion: boolean;
  readonly status: AccessibilityStatus;
  /** Set when the last write failed, so the screen can say the change did not persist. */
  readonly saveFailed: boolean;
};

export type AccessibilityActions = {
  setPreferReduceMotion(value: boolean): Promise<void>;
  /** Re-reads storage after a failure. */
  retry(): Promise<void>;
};

const StateContext = createContext<AccessibilityPreferences | null>(null);
const ActionsContext = createContext<AccessibilityActions | null>(null);

export function AccessibilityProvider({ children }: { readonly children: React.ReactNode }) {
  const systemReduceMotion = useSystemReducedMotion();

  const [preferReduceMotion, setPreference] = useState(false);
  const [status, setStatus] = useState<AccessibilityStatus>('loading');
  const [saveFailed, setSaveFailed] = useState(false);
  /** Bumped by `retry`. Re-running the load is a new effect run, not a call into one. */
  const [loadAttempt, setLoadAttempt] = useState(0);

  /**
   * Reading storage is subscribing to an external system, so the read is *started* by the effect
   * and the state is set from its callback — never synchronously in the effect body, which is
   * what `react-hooks/set-state-in-effect` correctly forbids and what `useSystemReducedMotion`
   * already avoids the same way.
   */
  useEffect(() => {
    let active = true;

    readBooleanPreference('reduceMotion', false)
      .then((result: PreferenceRead<boolean>) => {
        if (!active) {
          return;
        }
        if (result.status === 'unavailable') {
          // Motion is left on rather than guessed off: a failed read is not a user asking for
          // less motion, and the system setting is still respected whatever storage did.
          setStatus('unavailable');
          return;
        }
        setPreference(result.value);
        setStatus('ready');
      })
      .catch(() => {
        if (active) {
          setStatus('unavailable');
        }
      });

    return () => {
      active = false;
    };
  }, [loadAttempt]);

  const setPreferReduceMotion = useCallback(async (value: boolean) => {
    // Applied immediately, then persisted. The switch must not wait on storage to move, and a
    // failed write is reported rather than silently reverting a change the user can see.
    setPreference(value);
    setSaveFailed(false);
    const result = await writeBooleanPreference('reduceMotion', value);
    if (result.status === 'unavailable') {
      setSaveFailed(true);
    }
  }, []);

  const retry = useCallback(async () => {
    setStatus('loading');
    setSaveFailed(false);
    // Re-runs the load effect above rather than duplicating its body here.
    setLoadAttempt((attempt) => attempt + 1);
    return Promise.resolve();
  }, []);

  const state = useMemo<AccessibilityPreferences>(
    () => ({
      preferReduceMotion,
      systemReduceMotion,
      reduceMotion: systemReduceMotion || preferReduceMotion,
      status,
      saveFailed,
    }),
    [preferReduceMotion, systemReduceMotion, status, saveFailed],
  );

  const actions = useMemo<AccessibilityActions>(
    () => ({ setPreferReduceMotion, retry }),
    [setPreferReduceMotion, retry],
  );

  // The shared seam every animation reads, filled from the same state the Preferences screen
  // edits — which is what makes a change apply across the app without a restart.
  const motion = useMemo(() => ({ preferReduceMotion }), [preferReduceMotion]);

  return (
    <MotionPreferenceContext.Provider value={motion}>
      <StateContext.Provider value={state}>
        <ActionsContext.Provider value={actions}>{children}</ActionsContext.Provider>
      </StateContext.Provider>
    </MotionPreferenceContext.Provider>
  );
}

export function useAccessibilityPreferences(): AccessibilityPreferences {
  const value = useContext(StateContext);
  if (value === null) {
    throw new Error('useAccessibilityPreferences must be used inside an AccessibilityProvider.');
  }
  return value;
}

export function useAccessibilityActions(): AccessibilityActions {
  const value = useContext(ActionsContext);
  if (value === null) {
    throw new Error('useAccessibilityActions must be used inside an AccessibilityProvider.');
  }
  return value;
}
