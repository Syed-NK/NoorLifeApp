import { useCallback, useEffect, useState } from 'react';

import {
  defaultFaithPreferences,
  readFaithPreferences,
  writeFaithPreferences,
  type FaithPreferences,
} from '../storage/faith-preferences';

/**
 * The user's Faith preferences, with a write-through update.
 *
 * Starts from `defaultFaithPreferences` rather than null so a screen never has to guard
 * against "preferences not loaded yet" — the defaults are valid preferences, and the
 * stored values replace them a tick later. That avoids a flash of empty selects on every
 * screen that reads a translation id.
 */

export type UseFaithPreferences = {
  readonly preferences: FaithPreferences;
  readonly ready: boolean;
  readonly update: (patch: Partial<FaithPreferences>) => Promise<void>;
};

export function useFaithPreferences(): UseFaithPreferences {
  const [preferences, setPreferences] = useState<FaithPreferences>(defaultFaithPreferences);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    void readFaithPreferences().then((stored) => {
      if (active) {
        setPreferences(stored);
        setReady(true);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const update = useCallback(async (patch: Partial<FaithPreferences>) => {
    const next = await writeFaithPreferences(patch);
    setPreferences(next);
  }, []);

  return { preferences, ready, update };
}
