import { useCallback, useEffect, useRef, useState } from 'react';

import { useActiveLocationRevision } from '../data/location/active-location';
import { hasData } from '../data/faith-result';
import {
  isUserSelectedLocation,
  type LocationRefresh,
  type PrayerLocationMode,
} from '../data/prayer-times.repository';
import { useFaithRepositories } from '../di/faith-repository-context';

/**
 * Refreshing the active location — as an operation that belongs to **one authority**.
 *
 * ── The defect this shape exists to make unrepresentable ────────────────────
 * This hook used to be a device-refresh hook that every screen called unconditionally, and the only
 * thing standing between a saved city and the GPS was a guard buried inside the repository. Two
 * consequences followed from that, and both were reported from the device.
 *
 * **The screen could not tell the modes apart.** It rendered one circular control labelled "Gets a
 * new position from this device" whatever the active authority was, because the hook handed it a
 * `refresh()` that existed in every mode. A person who had deliberately chosen Dubai from the
 * catalogue was still offered a GPS button on their own choice.
 *
 * **A device verdict could land on somebody else's location.** The old hook wrote its outcome with
 * `setState` and nothing else: no record of which location the attempt had begun under. Open Prayer
 * Times in device mode, let the acquisition run, choose Dubai while it is still in flight, and the
 * acquisition's eventual timeout wrote `stale` — so "Could not get a new position just now. Showing
 * the last one." rendered underneath a city nobody had asked the device about. The mount effect
 * re-ran on the revision change and did nothing, because the old attempt still held `inFlight`.
 *
 * ── What replaces it ────────────────────────────────────────────────────────
 * A discriminated union in which `refreshDevice` **exists only on the device variant**. City and
 * coordinates authority do not carry the function, so a screen cannot call it there by mistake, by
 * refactor, or by a copied line — it is a type error rather than a review comment. That is the
 * "difficult or impossible" the correction asks for, expressed where the compiler can enforce it.
 *
 * And every device verdict is stamped with the revision its attempt began under. The render filters
 * on that stamp, so a verdict from a superseded location is not merely ignored on arrival — it has
 * no revision under which it could ever be drawn.
 *
 * ── Why a failed device refresh is still not an error ───────────────────────
 * The stored location is correct and the screen is showing real times for it. A refresh that could
 * not get a fix means "this may be out of date", not "this is wrong" — so the state is `stale`, the
 * screen keeps rendering, and it says so. Blanking a working screen because a cold GPS timed out
 * would be the worse outcome.
 */

/** How a device acquisition ended. Only ever meaningful under `device` authority. */
export type DeviceRefreshState =
  /** Nothing has been attempted under the current location revision. */
  | { readonly kind: 'idle' }
  /** A live fix is in flight. The screen keeps rendering the stored location meanwhile. */
  | { readonly kind: 'refreshing' }
  /** A fix arrived and replaced the stored location. */
  | { readonly kind: 'updated'; readonly movedMetres: number; readonly materialChange: boolean }
  /** A fix arrived and was not good enough to replace what is stored. */
  | { readonly kind: 'kept'; readonly reason: NonNullable<LocationRefresh['rejectedReason']> }
  /** No fix could be acquired. What is displayed is the last accepted one. */
  | { readonly kind: 'stale'; readonly reason: 'permission' | 'timeout' | 'unavailable' };

/**
 * The refresh capability the active authority actually has.
 *
 * ── Why the three variants carry different members ──────────────────────────
 * Because they can do different things, and a shape that gave all three the same members would be
 * describing a capability two of them do not have. `user-selected` has no `refreshDevice` because a
 * city is not refreshable — it is the answer, not an estimate of one — and no `state` because there
 * is no device outcome to report. `unresolved` is the honest first render: the stored mode has not
 * been read yet, and offering a GPS control that may have to be withdrawn a frame later is worse
 * than offering nothing for a frame.
 */
export type ActiveLocationRefresh =
  /** The stored mode has not been read yet. Nothing is offered and nothing is attempted. */
  | { readonly authority: 'unresolved' }
  /**
   * A city or a typed coordinate. **No device capability of any kind.**
   *
   * The mode is carried so a screen can be specific about what the user chose without going back to
   * storage for it.
   */
  | { readonly authority: 'user-selected'; readonly mode: 'city' | 'coordinates' }
  /** A device fix, which may be re-acquired. */
  | {
      readonly authority: 'device';
      readonly state: DeviceRefreshState;
      /** Acquires a new position now. Safe to call while one is in flight — it is ignored. */
      readonly refreshDevice: () => Promise<void>;
    };

/** A device verdict, stamped with the location revision the attempt began under. */
type StampedVerdict = {
  readonly revision: number;
  readonly state: DeviceRefreshState;
};

const IDLE: DeviceRefreshState = { kind: 'idle' };

/**
 * @param onMaterialChange
 *   Called only when an accepted device fix moved far enough to invalidate everything derived from
 *   the old coordinate. This is where the prayer times, the Hijri date, the countdown, the next
 *   prayer and the notification schedule are recalculated — together, from the same newly stored
 *   location, so the screen never shows a new place beside an old day's times. Never called for a
 *   city or a coordinate: those publish a revision of their own at the mutation boundary, and every
 *   location-derived resource key already carries it.
 * @param refreshOnMount
 *   True on the Prayer screen, which is the surface the brief requires to refresh on entry. Honoured
 *   **only under device authority** — under city or coordinates it is inert, because there is
 *   nothing to acquire and asking would cost a permission prompt for an answer the user has already
 *   given.
 */
export function useActiveLocationRefresh(
  onMaterialChange: () => void,
  refreshOnMount = true,
): ActiveLocationRefresh {
  const { prayerTimes } = useFaithRepositories();
  /*
    ── Every piece of state here is keyed on the revision ─────────────────────
    Saving a location on another screen returns here by popping the navigation stack, so this screen
    is never unmounted and this hook keeps whatever it last concluded. Stamping the conclusions and
    filtering on the stamp is what stops one authority's verdict being drawn beside another's place.
  */
  const revision = useActiveLocationRevision();

  const [storedMode, setStoredMode] = useState<{
    readonly revision: number;
    readonly mode: PrayerLocationMode | null;
  } | null>(null);
  const [verdict, setVerdict] = useState<StampedVerdict | null>(null);

  /*
    Guards against overlapping requests. A ref rather than state: two taps on the refresh control in
    the same tick would both read a stale render and both wake the GPS.
  */
  const inFlight = useRef(false);
  /*
    Monotonic within the process. Only the newest attempt may write, which covers the case the
    revision stamp cannot: two device attempts under the *same* revision, where the older one
    finishing last would otherwise overwrite the newer one's verdict.
  */
  const attempt = useRef(0);
  /*
    The callback is read through a ref so that changing it — which it does on every render of the
    screen that owns it — cannot restart the mount effect and fire a second position request.
  */
  const onMaterial = useRef(onMaterialChange);
  /*
    Assigned in an effect rather than during render. Writing a ref in the render body is a side
    effect in a function React may call more than once per commit, and this effect is declared
    *before* the ones that read it, so the callback is current by the time it can be reached.
  */
  useEffect(() => {
    onMaterial.current = onMaterialChange;
  }, [onMaterialChange]);

  /**
   * The active mode, re-read whenever the location changes.
   *
   * ── Why this is asked rather than inferred ──────────────────────────────
   * The alternative was to infer the authority from whatever the last device refresh returned, which
   * is only available *after* a device refresh — so a screen entered in city mode would have had to
   * make the very call the mode forbids in order to discover that it was forbidden. Asking storage
   * is one read, it happens before anything is attempted, and it is the same record every other
   * surface derives from.
   */
  useEffect(() => {
    let active = true;
    void prayerTimes
      .getActiveLocationMode()
      .then((mode) => {
        if (active) {
          setStoredMode({ revision, mode });
        }
      })
      .catch(() => {
        // Storage could not be read. `null` renders as unresolved, which offers nothing — the
        // honest state for "we do not know which authority is in force".
        if (active) {
          setStoredMode({ revision, mode: null });
        }
      });
    return () => {
      active = false;
    };
  }, [prayerTimes, revision]);

  /**
   * Records a device verdict, if this attempt still has the right to.
   *
   * Two independent gates, and both are needed. `attempt` rejects an older acquisition under the
   * same location; the revision stamp travels with the value so a verdict from a superseded location
   * cannot be drawn even if it does get stored.
   */
  const commit = useCallback((id: number, revision: number, state: DeviceRefreshState) => {
    if (id !== attempt.current) {
      return;
    }
    setVerdict({ revision, state });
  }, []);

  const refreshDevice = useCallback(async () => {
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    attempt.current += 1;
    const id = attempt.current;
    /*
      Yields once before touching state. This is called from an effect body on screen entry, and
      setting state synchronously inside one cascades a render — see `react-hooks/set-state-in-effect`.
      The position request that follows is asynchronous anyway, so the yield costs a microtask.
    */
    await Promise.resolve();
    commit(id, revision, { kind: 'refreshing' });

    try {
      const result = await prayerTimes.refreshDeviceLocation();

      if (!hasData(result)) {
        /*
          Every non-data outcome collapses to one of three things the screen can say. `timeout` is
          kept distinct from the rest because it is the one a user can act on by waiting or stepping
          outside; the others are indistinguishable to them.
        */
        commit(id, revision, {
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
        The user chose a place while this acquisition was in flight, and the repository returned
        theirs rather than the fix this call obtained. There is no device outcome to report: nothing
        was replaced and nothing failed. Recording `idle` rather than a warning is what stops a
        device attempt leaving commentary on somebody else's city — and the revision has moved on by
        now anyway, so this verdict will never render.
      */
      if (isUserSelectedLocation({ mode })) {
        commit(id, revision, IDLE);
        return;
      }
      if (!accepted && rejectedReason !== null) {
        commit(id, revision, { kind: 'kept', reason: rejectedReason });
        return;
      }

      commit(id, revision, { kind: 'updated', movedMetres, materialChange });
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
    /*
      ── The revision is captured, not read from a ref ─────────────────────────
      `revision` is a dependency, so a new callback exists for every location — and the one
      an attempt runs through is therefore stamped with the location that was active when it was
      created. A closure held from an earlier revision stamps that earlier revision, which is exactly
      right: that is the location the attempt belongs to, and a verdict for it can no longer render.
      Reading a ref during render, which is what this replaced, is a rules-of-React violation for the
      same reason it looked convenient.
    */
  }, [prayerTimes, commit, revision]);

  /*
    The mode as it applies to *this* revision. A record stamped with an older revision is a fact
    about a location that is no longer active, so it is discarded rather than rendered — which is
    what keeps a device control from surviving for a frame after a city has been saved.
  */
  const mode = storedMode !== null && storedMode.revision === revision ? storedMode.mode : null;
  const isDevice = mode === 'device';

  /*
    Once per revision, and only under device authority. `mountedFor` is a ref rather than an effect
    dependency because the effect also re-runs when the mode *resolves*, and a dependency-only guard
    would fire a second acquisition the moment it did.
  */
  const mountedFor = useRef<number | null>(null);
  useEffect(() => {
    if (!refreshOnMount || !isDevice || mountedFor.current === revision) {
      return;
    }
    mountedFor.current = revision;
    void refreshDevice();
  }, [refreshOnMount, isDevice, revision, refreshDevice]);

  if (mode === null) {
    return { authority: 'unresolved' };
  }
  if (mode === 'city' || mode === 'coordinates') {
    return { authority: 'user-selected', mode };
  }
  /*
    The verdict is only drawn when it belongs to the revision being rendered. This single comparison
    is what the reported defect turned on: a `stale` written by an acquisition that began under the
    previous location can no longer reach the screen, because the screen only ever reads the verdict
    stamped with the location it is currently showing.
  */
  return {
    authority: 'device',
    state: verdict !== null && verdict.revision === revision ? verdict.state : IDLE,
    refreshDevice,
  };
}
