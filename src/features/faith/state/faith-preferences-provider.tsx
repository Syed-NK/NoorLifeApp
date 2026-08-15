import { useEffect, type ReactNode } from 'react';

import { hydrateFaithPreferences } from './faith-preferences-store';

/**
 * Mounts the Faith preference store's hydration once, at the module boundary.
 *
 * ── Why this holds no state ─────────────────────────────────────────────────
 * The snapshot lives in `faith-preferences-store.ts` at module scope, not in a context value. This
 * component exists to give hydration a single, named place in the tree — the same place the
 * repository and audio providers occupy — so "when are preferences read?" has an answer you can point
 * at in `app/faith/_layout.tsx`, rather than being an implicit consequence of whichever screen
 * happened to mount first.
 *
 * It renders its children unconditionally and never blocks on the read. The store starts from valid
 * defaults and publishes the stored values a tick later, so gating the whole module on one
 * AsyncStorage round trip would buy a blank frame and nothing else.
 */
export function FaithPreferencesProvider({ children }: { readonly children: ReactNode }) {
  useEffect(() => {
    /*
      Memoised in the store, so this is a no-op when a consumer already started the read. It is here
      anyway: the boundary should not depend on a screen having asked first, and this is what makes
      the mount point real rather than decorative.
    */
    void hydrateFaithPreferences();
  }, []);

  return <>{children}</>;
}
