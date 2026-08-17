import {
  addNetworkStateListener,
  getNetworkStateAsync,
  type NetworkState,
  NetworkStateType,
} from 'expo-network';

import {
  type ConnectionKind,
  type ConnectivityPort,
  type ConnectivityState,
  OFFLINE_STATE,
  type Reachability,
} from './connectivity.port';

/**
 * The one place `expo-network` is imported.
 *
 * ── Everything here is interpretation, and that is the point ────────────────
 * `NetworkState` has three fields and **all three are optional**. A platform that answers `{}` is
 * legal, and every field being possibly-undefined is exactly the situation in which each call site
 * would invent its own reading. `readState` below is that reading, written once.
 *
 * The rule it implements is stated in `connectivity.port.ts` and is worth repeating where the
 * conversion actually happens: **a link is not the internet, and unknown is not online.** The only
 * way to reach `online` is for the platform to say `isInternetReachable === true` — not to omit it,
 * not to leave it undefined, and not to merely report a link.
 *
 * ── What is deliberately not imported ───────────────────────────────────────
 * `getIpAddressAsync` and `isAirplaneModeEnabledAsync` exist in this module and are not imported
 * here. An IP address is a personal identifier with no use in this feature, and airplane mode adds
 * nothing `reachability` does not already say. A scan asserts this file is the only importer of
 * `expo-network`, so a second call site cannot appear elsewhere and reach for either.
 */

/** Their enum → NoorLife's narrower closed set. Unrecognised links are `other`, never guessed at. */
function kindOf(type: NetworkStateType | undefined): ConnectionKind {
  switch (type) {
    case NetworkStateType.WIFI:
      return 'wifi';
    case NetworkStateType.CELLULAR:
      return 'cellular';
    case NetworkStateType.ETHERNET:
      return 'ethernet';
    case NetworkStateType.NONE:
      return 'none';
    case NetworkStateType.UNKNOWN:
    case undefined:
      return 'unknown';
    default:
      /* BLUETOOTH, WIMAX, VPN, OTHER. All answer NoorLife's two questions the same way. */
      return 'other';
  }
}

/**
 * One platform reading → one `ConnectivityState`.
 *
 * Exported so a test can drive the *conversion* with the shapes the platform actually produces —
 * including the empty object and the "connected but reachability withheld" case that a fake port
 * would otherwise let us skip past.
 */
export function readState(raw: NetworkState | null | undefined): ConnectivityState {
  if (raw === null || raw === undefined) {
    return OFFLINE_STATE;
  }
  const kind = kindOf(raw.type);
  /*
    `isConnected` is trusted only when the platform states it. A `type` of WIFI with `isConnected`
    absent is a partial answer, and treating it as a link would put the whole state one step closer
    to `online` on the strength of a field nobody set.
  */
  const isConnected = raw.isConnected === true && kind !== 'none';
  if (!isConnected) {
    return OFFLINE_STATE;
  }

  /*
    The single most important line in this file. `=== true` and nothing else: `undefined` is not
    reachable, and neither is `false`. A captive portal reports a link and withholds reachability,
    which is precisely `link-only`.
  */
  const reachability: Reachability = raw.isInternetReachable === true ? 'online' : 'link-only';

  return {
    isConnected: true,
    reachability,
    kind,
    isWifi: kind === 'wifi' && reachability === 'online',
    /* Cellular costs money; so may an unrecognised tether. Fail toward asking, not toward spending. */
    isMetered: kind === 'cellular' || kind === 'other' || kind === 'unknown',
  };
}

/**
 * The production connectivity boundary.
 *
 * ── Why the subscription is shared rather than one per caller ───────────────
 * Several screens and the orchestrator all want to know when connectivity returns. Registering a
 * native listener per interested component means N native subscriptions for one piece of device
 * state, N teardowns to get right, and — the real hazard — N independent "we are back online, start
 * a sync" reactions. The single-flight guard in the orchestrator is what makes that safe, but not
 * creating the stampede in the first place is better than surviving it.
 *
 * So one native listener is registered on the first subscriber and torn down on the last. Fan-out is
 * a plain `Set`, and an unsubscribe that has already run is a no-op — React invokes effect cleanups
 * twice in development, and a boundary that mis-counted on the second call would leak a native
 * listener in the environment nobody ships to.
 */
export function createExpoConnectivity(): ConnectivityPort {
  const listeners = new Set<(state: ConnectivityState) => void>();
  let native: { remove: () => void } | null = null;

  const fanOut = (raw: NetworkState): void => {
    const state = readState(raw);
    /*
      Iterated over a copy. A listener that unsubscribes itself while being notified would otherwise
      mutate the set mid-iteration, which is how the *next* listener silently stops being called.
    */
    for (const listener of [...listeners]) {
      try {
        listener(state);
      } catch {
        /*
          One subscriber throwing must not stop the others being told, and must not take down a
          native callback. Nothing about the error is captured — it belongs to the subscriber, and
          this module has no logger by design.
        */
      }
    }
  };

  return {
    currentOrUnknown: async () => {
      try {
        const state = await getNetworkStateAsync();
        /*
          `undefined` is what this resolves to where the native module is absent — a Jest run, or a
          platform that has not implemented it. It is not a reading, and reporting it as one is the
          fold this method exists to avoid.
        */
        return state === undefined || state === null ? null : readState(state);
      } catch {
        return null;
      }
    },

    current: async () => {
      try {
        const state = await getNetworkStateAsync();
        if (state === undefined || state === null) {
          return OFFLINE_STATE;
        }
        return readState(state);
      } catch {
        /*
          An unreadable platform answers offline rather than throwing. Every caller's failure mode
          for "offline" is to wait and retry, which is the correct behaviour when connectivity
          cannot be determined; a thrown error would instead surface as a crash in a screen effect.
        */
        return OFFLINE_STATE;
      }
    },

    subscribe: (listener) => {
      listeners.add(listener);
      if (native === null) {
        try {
          native = addNetworkStateListener(fanOut);
        } catch {
          /* No native listener is available. `current()` still works; changes simply are not pushed. */
          native = null;
        }
      }

      let released = false;
      return () => {
        if (released) {
          return;
        }
        released = true;
        listeners.delete(listener);
        if (listeners.size === 0 && native !== null) {
          try {
            native.remove();
          } catch {
            /* Already removed. Nothing to release. */
          }
          native = null;
        }
      };
    },
  };
}
