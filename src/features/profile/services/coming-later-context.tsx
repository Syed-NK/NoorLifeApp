import { createContext, useCallback, useContext, useMemo, useState } from 'react';

/**
 * One honest answer for a destination that does not exist yet, requested from anywhere on Profile.
 *
 * ── Why a controller rather than a marker per row ───────────────────────────
 * The previous Profile screen solved this by *hiding* unbuilt rows in production. That worked while
 * the screen was a long list of optional settings; it does not work now, because the compact menu
 * has exactly five rows and every one of them must be present whether or not its detail screen has
 * been built. A hidden row would leave a four-row menu in production and a five-row menu in
 * development — two different screens, one of which nobody reviews.
 *
 * So the row stays, and the tap gets a real answer. Holding that answer in one controller means the
 * rules about scrims, back handling and Reduce Motion are written once. `ComingLaterSheet` is the
 * only presentation; nothing renders its own.
 *
 * ── Duplicate sheets are impossible by construction ─────────────────────────
 * The request is a single slot, not a stack: a second `showComingLater` while one is open replaces
 * its contents rather than mounting a second modal.
 */

export type ComingLaterRequest = {
  /** What the user tapped, named exactly as the row names it, e.g. "Preferences". */
  readonly feature: string;
  /** The route this will occupy once built. Never shown; recorded for diagnostics. */
  readonly intendedRoute: string;
};

export type ComingLaterState = {
  readonly request: ComingLaterRequest | null;
  readonly isVisible: boolean;
};

export type ComingLaterActions = {
  showComingLater(request: ComingLaterRequest): void;
  dismiss(): void;
};

const StateContext = createContext<ComingLaterState | null>(null);
const ActionsContext = createContext<ComingLaterActions | null>(null);

export function ComingLaterProvider({ children }: { readonly children: React.ReactNode }) {
  const [request, setRequest] = useState<ComingLaterRequest | null>(null);

  const showComingLater = useCallback((next: ComingLaterRequest) => {
    setRequest(next);
  }, []);

  const dismiss = useCallback(() => {
    setRequest(null);
  }, []);

  const state = useMemo<ComingLaterState>(
    () => ({ request, isVisible: request !== null }),
    [request],
  );
  const actions = useMemo<ComingLaterActions>(
    () => ({ showComingLater, dismiss }),
    [showComingLater, dismiss],
  );

  return (
    <StateContext.Provider value={state}>
      <ActionsContext.Provider value={actions}>{children}</ActionsContext.Provider>
    </StateContext.Provider>
  );
}

export function useComingLater(): ComingLaterState {
  const value = useContext(StateContext);
  if (value === null) {
    throw new Error('useComingLater must be used inside a ComingLaterProvider.');
  }
  return value;
}

export function useComingLaterActions(): ComingLaterActions {
  const value = useContext(ActionsContext);
  if (value === null) {
    throw new Error('useComingLaterActions must be used inside a ComingLaterProvider.');
  }
  return value;
}
