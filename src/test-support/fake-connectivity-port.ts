import {
  type ConnectionKind,
  type ConnectivityPort,
  type ConnectivityState,
  OFFLINE_STATE,
  type Reachability,
} from '@features/faith/data/connectivity/connectivity.port';

/**
 * A connectivity boundary a test drives directly.
 *
 * ── Why this exists rather than mocking `expo-network` ──────────────────────
 * The states that matter are transitions, not values: "offline for a week, then Wi-Fi returns" is
 * what the retention rule and the download queue are actually specified against, and a module mock
 * returning a fixed object cannot express it. `set()` pushes a change to every live subscriber the
 * way the platform would.
 *
 * `subscriberCount` is the other half. Several claims in this feature are about things that must
 * **not** happen — one native listener however many screens mount, no leak when a screen unmounts,
 * no second sync transaction — and the only way to assert an absence is to hold the thing that would
 * have done it and count.
 */

export type FakeConnectivity = ConnectivityPort & {
  /** Pushes a new state to every subscriber, as a platform change event would. */
  readonly set: (next: Partial<ConnectivityState>) => void;
  /** How many listeners are currently attached. Zero after a correct teardown. */
  readonly subscriberCount: () => number;
  /** How many times `current()` was awaited. Proves a caller asked rather than assumed. */
  readonly reads: () => number;
};

/** Wi-Fi, reachable. The ordinary happy state, spelled out so tests do not each rebuild it. */
export const WIFI_ONLINE: ConnectivityState = {
  isConnected: true,
  reachability: 'online',
  kind: 'wifi',
  isWifi: true,
  isMetered: false,
};

/** Cellular, reachable. Sync may run; a Wi-Fi-only download may not. */
export const CELLULAR_ONLINE: ConnectivityState = {
  isConnected: true,
  reachability: 'online',
  kind: 'cellular',
  isWifi: false,
  isMetered: true,
};

/**
 * A Wi-Fi link that reaches nothing — a captive portal.
 *
 * The state the whole `link-only` distinction exists for: `isConnected` is true and `isWifi` is
 * false, so neither a sync nor a Wi-Fi-only download may start.
 */
export const WIFI_CAPTIVE: ConnectivityState = {
  isConnected: true,
  reachability: 'link-only',
  kind: 'wifi',
  isWifi: false,
  isMetered: false,
};

export function createFakeConnectivity(
  initial: ConnectivityState = OFFLINE_STATE,
): FakeConnectivity {
  const listeners = new Set<(state: ConnectivityState) => void>();
  let state = initial;
  let reads = 0;

  return {
    current: async () => {
      reads += 1;
      return await Promise.resolve(state);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      let released = false;
      return () => {
        if (released) {
          return;
        }
        released = true;
        listeners.delete(listener);
      };
    },
    set: (next) => {
      const merged: ConnectivityState = { ...state, ...next };
      /*
        Derived fields are recomputed rather than taken from the caller, so a test cannot accidentally
        assert against an impossible state — Wi-Fi that is somehow both `link-only` and `isWifi`.
      */
      const kind: ConnectionKind = merged.kind;
      const reachability: Reachability = merged.reachability;
      state = {
        ...merged,
        isConnected: reachability !== 'offline',
        isWifi: kind === 'wifi' && reachability === 'online',
        isMetered: kind === 'cellular' || kind === 'other' || kind === 'unknown',
      };
      for (const listener of [...listeners]) {
        listener(state);
      }
    },
    subscriberCount: () => listeners.size,
    reads: () => reads,
  };
}
