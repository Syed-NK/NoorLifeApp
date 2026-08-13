import { useCallback, useEffect, useRef, useState } from 'react';

import { useActiveLocationRevision } from '../data/location/active-location';
import { hasData } from '../data/faith-result';
import { isUserSelectedLocation, type LocationRefresh } from '../data/prayer-times.repository';
import { useFaithRepositories } from '../di/faith-repository-context';

/**
 * Asking the platform for a fresh position, and saying honestly what came back.
 *
 * ── The two paths this hook keeps separate ──────────────────────────────────
 * A screen renders from the **stored** location the instant it mounts, because that is instant and
 * the coordinate behind it has usually moved by metres. Separately — and in parallel — it asks for a
 * live fix. Those are different operations with different failure modes, and collapsing them is how
 * a refresh control ends up handing back the fix it already had.
 *
 * ── Why a failed refresh is not an error state ──────────────────────────────
 * The stored location is still correct and the screen is still showing real prayer times for it. A
 * refresh that could not get a fix means "this may be out of date", not "this is wrong" — so the
 * state is `stale`, the screen keeps rendering, and it says so. Blanking a working screen because a
 * cold GPS timed out would be the worse outcome.
 */

export type LocationRefreshState =
  /** Nothing has been attempted since mount. */
  | { readonly kind: 'idle' }
  /** A live fix is in flight. The screen keeps rendering the stored location meanwhile. */
  | { readonly kind: 'refreshing' }
  /** A fix arrived and replaced the stored location. */
  | { readonly kind: 'updated'; readonly movedMetres: number; readonly materialChange: boolean }
  /**
   * A user-selected location — a city or typed coordinates. No device position was requested, so
   * none could fail.
   *
   * A distinct state rather than reusing `updated`, because the screen must be able to say nothing
   * at all here. "Could not get a new position" would be false — nothing was attempted.
   */
  | { readonly kind: 'user-selected' }
  /** A fix arrived and was not good enough to replace what is stored. */
  | { readonly kind: 'kept'; readonly reason: NonNullable<LocationRefresh['rejectedReason']> }
  /** No fix could be acquired. What is displayed is the last accepted one. */
  | { readonly kind: 'stale'; readonly reason: 'permission' | 'timeout' | 'unavailable' };

export type UseLocationRefresh = {
  readonly state: LocationRefreshState;
  /** Acquires a new position now. Safe to call while one is already in flight — it is ignored. */
  readonly refresh: () => Promise<void>;
};

/**
 * @param onMaterialChange
 *   Called only when an accepted fix moved far enough to invalidate everything derived from the old
 *   coordinate. This is where the prayer times, the Hijri date, the countdown, the next prayer and
 *   the notification schedule are recalculated — together, from the same newly stored location, so
 *   the screen never shows a new place beside an old day's times.
 * @param refreshOnMount
 *   True on the Prayer screen, which is the surface the brief requires to refresh on entry. False
 *   where a fix would cost battery for a screen that does not turn on the coordinate.
 */
export function useLocationRefresh(
  onMaterialChange: () => void,
  refreshOnMount = true,
): UseLocationRefresh {
  const { prayerTimes } = useFaithRepositories();
  const [state, setState] = useState<LocationRefreshState>({ kind: 'idle' });
  /*
    ── Why the revision is a dependency of the refresh effect ──────────────────
    Saving a location on another screen returns here by popping the navigation stack, so this screen
    is never unmounted and this hook keeps whatever verdict it reached on entry. On device it showed
    a saved Dubai underneath "Could not get a new position just now" — a warning about a device fix
    that manual mode never asks for. Re-running on a revision change re-evaluates against the *new*
    mode, and costs nothing: manual mode short-circuits before any permission or GPS call.
  */
  const locationRevision = useActiveLocationRevision();

  /*
    Guards against overlapping requests. A ref rather than state: two taps on the refresh control in
    the same tick would both read a stale `state` and both wake the GPS.
  */
  const inFlight = useRef(false);
  /*
    The callback is read through a ref so that changing it — which it does on every render of the
    screen that owns it — cannot restart the mount effect and fire a second position request.
  */
  const onMaterial = useRef(onMaterialChange);
  /*
    Assigned in an effect rather than during render. Writing a ref in the render body is a side
    effect in a function React may call more than once per commit, and this effect is declared
    *before* the one that refreshes on mount, so the callback is current by the time it can be read.
  */
  useEffect(() => {
    onMaterial.current = onMaterialChange;
  }, [onMaterialChange]);

  const refresh = useCallback(async () => {
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    /*
      Yields once before touching state. This is called from an effect body on screen entry, and
      setting state synchronously inside one cascades a render — see `react-hooks/set-state-in-effect`.
      The position request that follows is asynchronous anyway, so the yield costs a microtask.
    */
    await Promise.resolve();
    setState({ kind: 'refreshing' });

    try {
      const result = await prayerTimes.refreshDeviceLocation();

      if (!hasData(result)) {
        /*
          Every non-data outcome collapses to one of three things the screen can say. `timeout` is
          kept distinct from the rest because it is the one a user can act on by waiting or stepping
          outside; the others are indistinguishable to them.
        */
        setState({
          kind: 'stale',
          reason:
            result.kind === 'permission-required'
              ? 'permission'
              : result.kind === 'error' && result.code === 'timeout'
                ? 'timeout'
                : 'unavailable',
        });
        return;
      }

      const { accepted, materialChange, movedMetres, rejectedReason, mode } = result.data;
      /*
        The predicate, not `mode === 'coordinates'`. Both user-authority modes suppress the
        device-fix commentary for the same reason, and a literal comparison here would have left a
        saved city being described as a device fix that could not be refreshed.
      */
      if (isUserSelectedLocation({ mode })) {
        setState({ kind: 'user-selected' });
        return;
      }
      if (!accepted && rejectedReason !== null) {
        setState({ kind: 'kept', reason: rejectedReason });
        return;
      }

      setState({ kind: 'updated', movedMetres, materialChange });
      if (materialChange) {
        /*
          Storage has already been written by the repository, so every resource that re-reads it now
          sees the same new coordinate. That is what makes the update atomic in the way that matters:
          not that the two reloads happen in one instruction, but that they cannot read different
          locations.
        */
        onMaterial.current();
      }
    } finally {
      inFlight.current = false;
    }
  }, [prayerTimes]);

  useEffect(() => {
    if (refreshOnMount) {
      void refresh();
    }
    // `refresh` is stable for a given repository, so this runs once per screen entry — and again
    // whenever the active location changes underneath it.
  }, [refresh, refreshOnMount, locationRevision]);

  return { state, refresh };
}
