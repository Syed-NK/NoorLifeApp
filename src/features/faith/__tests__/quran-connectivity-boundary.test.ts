import {
  canDownload,
  canSync,
  type ConnectivityState,
  OFFLINE_STATE,
} from '@features/faith/data/connectivity/connectivity.port';
import {
  createExpoConnectivity,
  readState,
} from '@features/faith/data/connectivity/expo-connectivity.port';
import {
  CELLULAR_ONLINE,
  createFakeConnectivity,
  WIFI_CAPTIVE,
  WIFI_ONLINE,
} from '@/test-support/fake-connectivity-port';

/**
 * The connectivity boundary — one adapter, and the interpretation it exists to make once.
 *
 * ── The single rule under test ──────────────────────────────────────────────
 * **A link is not the internet, and unknown is not online.** `expo-network` returns a `NetworkState`
 * whose three fields are *all optional*, so every one of these cases is a shape the platform can
 * legitimately produce and every one of them has to resolve to a decision. Most of what follows is
 * an attempt to get `online` out of a state that has not earned it.
 *
 * ── Why the real module is mocked rather than the port faked ────────────────
 * A fake port proves what the feature does with a state. It cannot prove that a captive portal
 * *produces* that state, and the conversion is where the mistake would be. So `readState` is driven
 * against raw platform shapes, and the port's own behaviour — shared native listener, teardown,
 * no leaks — is driven through the real `createExpoConnectivity`.
 */

const listeners: ((event: unknown) => void)[] = [];
const mockRemove = jest.fn();
const mockGetNetworkState = jest.fn();
const mockAddListener = jest.fn((listener: (event: unknown) => void) => {
  listeners.push(listener);
  return { remove: mockRemove };
});

jest.mock('expo-network', () => ({
  getNetworkStateAsync: (...args: unknown[]) => mockGetNetworkState(...args),
  addNetworkStateListener: (listener: (event: unknown) => void) => mockAddListener(listener),
  NetworkStateType: {
    NONE: 'NONE',
    UNKNOWN: 'UNKNOWN',
    CELLULAR: 'CELLULAR',
    WIFI: 'WIFI',
    BLUETOOTH: 'BLUETOOTH',
    ETHERNET: 'ETHERNET',
    WIMAX: 'WIMAX',
    VPN: 'VPN',
    OTHER: 'OTHER',
  },
}));

beforeEach(() => {
  listeners.length = 0;
  mockRemove.mockClear();
  mockAddListener.mockClear();
  mockGetNetworkState.mockReset();
});

// ─────────────────────────────────────────────────────────────────────────────
// The interpretation: what the platform says → what NoorLife decides
// ─────────────────────────────────────────────────────────────────────────────

describe('reading a platform state', () => {
  it('requires the platform to confirm reachability before reporting online', () => {
    const state = readState({
      type: 'WIFI',
      isConnected: true,
      isInternetReachable: true,
    } as never);
    expect(state.reachability).toBe('online');
    expect(state.isWifi).toBe(true);
    expect(state.isMetered).toBe(false);
  });

  it('treats a link with unconfirmed reachability as link-only, never online', () => {
    /*
      The captive-portal case, and the reason the three-state `Reachability` exists. A boolean would
      have to round this either up or down; rounding it up starts a multi-hundred-megabyte transfer
      into a router's login page, and completes a sync transaction against it.
    */
    for (const raw of [
      { type: 'WIFI', isConnected: true },
      { type: 'WIFI', isConnected: true, isInternetReachable: false },
      { type: 'CELLULAR', isConnected: true, isInternetReachable: undefined },
    ]) {
      const state = readState(raw as never);
      expect(state.reachability).toBe('link-only');
      expect(state.isConnected).toBe(true);
      expect(state.isWifi).toBe(false);
      expect(canSync(state)).toBe(false);
    }
  });

  it('treats an unreadable or empty platform answer as offline, not as unknown-but-probably-fine', () => {
    for (const raw of [null, undefined, {}, { type: 'NONE', isConnected: true }]) {
      expect(readState(raw as never)).toEqual(OFFLINE_STATE);
    }
  });

  it('does not accept a link the platform declined to confirm', () => {
    /* `type: WIFI` with `isConnected` absent is a partial answer, not a link. */
    const state = readState({ type: 'WIFI', isInternetReachable: true } as never);
    expect(state).toEqual(OFFLINE_STATE);
  });

  it('narrows every exotic link kind to other, and treats unknown links as metered', () => {
    for (const type of ['BLUETOOTH', 'WIMAX', 'VPN', 'OTHER']) {
      const state = readState({ type, isConnected: true, isInternetReachable: true } as never);
      expect(state.kind).toBe('other');
      expect(state.isMetered).toBe(true);
      expect(state.isWifi).toBe(false);
    }
    const unknown = readState({
      type: 'UNKNOWN',
      isConnected: true,
      isInternetReachable: true,
    } as never);
    expect(unknown.kind).toBe('unknown');
    expect(unknown.isMetered).toBe(true);
  });

  it('reports ethernet as reachable and unmetered but never as Wi-Fi', () => {
    const state = readState({
      type: 'ETHERNET',
      isConnected: true,
      isInternetReachable: true,
    } as never);
    expect(state.kind).toBe('ethernet');
    expect(state.isMetered).toBe(false);
    expect(state.isWifi).toBe(false);
    expect(canSync(state)).toBe(true);
    expect(canDownload(state, true)).toBe(false);
  });

  it('carries no identifying network detail of any kind', () => {
    /*
      There is no SSID, BSSID, IP address, carrier or signal strength on `ConnectivityState`, and no
      method on the port through which one could be fetched. Asserted as the serialised shape, so a
      future field carrying one fails here.
    */
    const state = readState({
      type: 'WIFI',
      isConnected: true,
      isInternetReachable: true,
    } as never);
    expect(Object.keys(state).sort()).toEqual([
      'isConnected',
      'isMetered',
      'isWifi',
      'kind',
      'reachability',
    ]);
    const serialised = JSON.stringify(state);
    for (const forbidden of ['ssid', 'bssid', 'ip', 'address', 'carrier', 'mac']) {
      expect(serialised.toLowerCase()).not.toContain(forbidden);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The two policy questions the feature actually asks
// ─────────────────────────────────────────────────────────────────────────────

describe('what each connection permits', () => {
  it('lets a sync run on any confirmed-reachable link, including cellular', () => {
    expect(canSync(WIFI_ONLINE)).toBe(true);
    expect(canSync(CELLULAR_ONLINE)).toBe(true);
    expect(canSync(WIFI_CAPTIVE)).toBe(false);
    expect(canSync(OFFLINE_STATE)).toBe(false);
  });

  it('holds a Wi-Fi-only download to confirmed Wi-Fi', () => {
    expect(canDownload(WIFI_ONLINE, true)).toBe(true);
    expect(canDownload(CELLULAR_ONLINE, true)).toBe(false);
    /* A Wi-Fi link that reaches nothing must wait rather than fail per file. */
    expect(canDownload(WIFI_CAPTIVE, true)).toBe(false);
  });

  it('lets a download run on cellular only when the preference is off', () => {
    expect(canDownload(CELLULAR_ONLINE, false)).toBe(true);
    expect(canDownload(WIFI_CAPTIVE, false)).toBe(false);
    expect(canDownload(OFFLINE_STATE, false)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The port: one native listener however many subscribers, and a clean teardown
// ─────────────────────────────────────────────────────────────────────────────

describe('the production port', () => {
  it('registers exactly one native listener for any number of subscribers', () => {
    const port = createExpoConnectivity();
    const a = port.subscribe(() => {});
    const b = port.subscribe(() => {});
    const c = port.subscribe(() => {});

    expect(mockAddListener).toHaveBeenCalledTimes(1);

    a();
    b();
    expect(mockRemove).not.toHaveBeenCalled();
    c();
    expect(mockRemove).toHaveBeenCalledTimes(1);
  });

  it('fans one platform change out to every subscriber', () => {
    const port = createExpoConnectivity();
    const seen: ConnectivityState[] = [];
    const release = [port.subscribe((s) => seen.push(s)), port.subscribe((s) => seen.push(s))];

    listeners[0]?.({ type: 'WIFI', isConnected: true, isInternetReachable: true });

    expect(seen).toHaveLength(2);
    expect(seen[0]?.isWifi).toBe(true);
    release.forEach((fn) => fn());
  });

  it('survives a second unsubscribe without leaking or double-removing', () => {
    /*
      React invokes effect cleanups twice in development. A boundary that mis-counted on the second
      call would leak a native listener in the environment nobody ships to — the worst place for it.
    */
    const port = createExpoConnectivity();
    const release = port.subscribe(() => {});
    release();
    release();
    expect(mockRemove).toHaveBeenCalledTimes(1);

    /* And it can be resubscribed afterwards, registering a fresh native listener. */
    const again = port.subscribe(() => {});
    expect(mockAddListener).toHaveBeenCalledTimes(2);
    again();
  });

  it('keeps notifying the rest when one subscriber throws', () => {
    const port = createExpoConnectivity();
    const seen: ConnectivityState[] = [];
    port.subscribe(() => {
      throw new Error('a screen effect blew up');
    });
    port.subscribe((s) => seen.push(s));

    expect(() =>
      listeners[0]?.({ type: 'CELLULAR', isConnected: true, isInternetReachable: true }),
    ).not.toThrow();
    expect(seen).toHaveLength(1);
    expect(seen[0]?.kind).toBe('cellular');
  });

  it('does not invoke a new subscriber with a synthetic first event', () => {
    /*
      "I was told" and "I asked" must stay distinguishable. A subscriber that received a synthetic
      change on mount would run a sync transaction every time a screen mounted.
    */
    const port = createExpoConnectivity();
    const seen: ConnectivityState[] = [];
    const release = port.subscribe((s) => seen.push(s));
    expect(seen).toHaveLength(0);
    release();
  });

  it('answers offline rather than throwing when the platform cannot be read', async () => {
    mockGetNetworkState.mockRejectedValueOnce(new Error('no native module'));
    const port = createExpoConnectivity();
    await expect(port.current()).resolves.toEqual(OFFLINE_STATE);
  });

  it('reads the platform on demand', async () => {
    mockGetNetworkState.mockResolvedValueOnce({
      type: 'WIFI',
      isConnected: true,
      isInternetReachable: true,
    });
    const port = createExpoConnectivity();
    await expect(port.current()).resolves.toEqual(WIFI_ONLINE);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The fake, which every other suite depends on being faithful
// ─────────────────────────────────────────────────────────────────────────────

describe('the test double', () => {
  it('recomputes derived fields so an impossible state cannot be asserted against', () => {
    const fake = createFakeConnectivity();
    fake.set({ kind: 'wifi', reachability: 'link-only', isWifi: true });
    return fake.current().then((state) => {
      expect(state.isWifi).toBe(false);
      expect(state.isConnected).toBe(true);
    });
  });

  it('counts subscribers so an absent teardown is provable', () => {
    const fake = createFakeConnectivity();
    const release = fake.subscribe(() => {});
    expect(fake.subscriberCount()).toBe(1);
    release();
    release();
    expect(fake.subscriberCount()).toBe(0);
  });
});
