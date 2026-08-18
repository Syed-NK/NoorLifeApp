/**
 * The device's connectivity, as a port — and the single boundary the feature may ask about it.
 *
 * ── Why a port rather than importing `expo-network` where it is needed ──────
 * The same three reasons `location.port.ts` gives, plus one that is specific to this module.
 *
 * **The states that matter are unreachable from a test otherwise.** "Connected to a Wi-Fi network
 * that has no route to the internet" is the exact state a captive portal produces, and it is the one
 * a download manager must not treat as online. A fake implementing this interface reaches it; the
 * real module in a Jest environment does not.
 *
 * **It keeps one interpretation of `isInternetReachable` in one place.** The platform reports three
 * things — is there a link, does that link reach the internet, and what kind of link is it — and all
 * three are *optional* on `expo-network`'s `NetworkState`. Interpreting a missing field is a decision,
 * and a decision taken independently at each call site is a decision that will differ between them.
 *
 * **It bounds what the app can ask for.** `expo-network` also exposes `getIpAddressAsync` and
 * `isAirplaneModeEnabledAsync`. Neither appears on this port, so neither is reachable from the
 * feature — an IP address is a personal identifier NoorLife has no use for, and there is no method
 * here through which one could be obtained, logged or sent anywhere.
 *
 * ── The one rule everything else follows from ───────────────────────────────
 * **A link is not the internet, and unknown is not online.** `isConnected: true` with
 * `isInternetReachable` absent or false is `link-only` below, never `online`. Erring the other way
 * would mean a download manager starting a multi-hundred-megabyte transfer into a captive portal and
 * a sync transaction "completing" against a router's login page — and the second of those would
 * advance a sync token over mutations that were never delivered.
 *
 * ── What may never be read, and therefore never logged ──────────────────────
 * There is no IP address, no SSID, no network name, no carrier, no BSSID and no signal strength on
 * any type in this file. `ConnectionKind` is a closed set of link *categories*; the most specific
 * thing NoorLife can know is "this is a Wi-Fi link", which is exactly what a Wi-Fi-only preference
 * needs and nothing more.
 */

/**
 * What kind of link is active, from a closed set.
 *
 * Narrower than `expo-network`'s enum on purpose. `BLUETOOTH`, `WIMAX`, `VPN` and `OTHER` all
 * collapse into `other`, because NoorLife has exactly two questions — "is this Wi-Fi?" for the
 * download preference, and "is this metered?" for the cellular warning — and a tethering link over
 * Bluetooth answers both the same way an unknown link does.
 */
export type ConnectionKind = 'none' | 'wifi' | 'cellular' | 'ethernet' | 'other' | 'unknown';

/**
 * Whether the device can actually reach anything.
 *
 * Three states rather than a boolean, and the middle one is the reason this type exists:
 *
 *   • `online` — there is a link **and** the platform confirms it reaches the internet. The only
 *     state in which a sync transaction may run.
 *   • `link-only` — there is a link, and reachability is false or the platform will not say. A
 *     captive portal, a Wi-Fi network still authenticating, or a platform that reports nothing.
 *     Treated as *not usable*, never as "probably fine".
 *   • `offline` — no link at all.
 *
 * `link-only` is deliberately not called `unknown`: the uncertainty is about the internet, not about
 * the link, and naming it after what is actually known stops it being read as "we have no idea" and
 * quietly rounded up.
 */
export type Reachability = 'online' | 'link-only' | 'offline';

export type ConnectivityState = {
  /** Whether a network link exists at all. `false` implies `reachability: 'offline'`. */
  readonly isConnected: boolean;
  readonly reachability: Reachability;
  readonly kind: ConnectionKind;
  /**
   * Whether the active link is confirmed Wi-Fi **and** confirmed to reach the internet.
   *
   * Both halves, in one field, because a Wi-Fi-only download must not start on a Wi-Fi link that
   * cannot reach anything — the transfer would fail per file and burn the retry budget. A caller
   * that wants "is this Wi-Fi regardless" reads `kind`.
   */
  readonly isWifi: boolean;
  /**
   * Whether starting a large transfer here may cost the user money.
   *
   * `true` for cellular. Deliberately `true` for `unknown` and `other` as well: an unrecognised link
   * that turns out to be a phone's tether is the case where guessing wrong has a bill attached, so
   * the unknown case fails toward asking the user rather than toward spending their data.
   */
  readonly isMetered: boolean;
};

/** Nothing is reachable, and nothing is claimed. The state every reader starts from. */
export const OFFLINE_STATE: ConnectivityState = {
  isConnected: false,
  reachability: 'offline',
  kind: 'none',
  isMetered: false,
  isWifi: false,
};

/**
 * The connectivity boundary.
 *
 * `subscribe` returns its own unsubscribe rather than taking a token, so a caller cannot detach the
 * wrong listener, and an effect's cleanup is the returned function itself. Implementations must make
 * a second call to the returned function harmless: React double-invokes cleanups in development, and
 * a boundary that threw on the second call would fail only in the environment nobody ships.
 */
export type ConnectivityPort = {
  /** The state now. Never throws; an unreadable platform answers `OFFLINE_STATE`. */
  readonly current: () => Promise<ConnectivityState>;
  /**
   * The state now, or `null` when the platform did not actually answer.
   *
   * ═══════════════════════════════════════════════════════════════════════════
   * ── Why this exists beside `current` ───────────────────────────────────────
   * `current` folds "the platform reported no link" and "the platform could not be read" into the
   * same `OFFLINE_STATE`. For every caller that has one — a download deciding whether to wait, a sync
   * deciding whether to run — that fold is correct: both answers mean *do not proceed yet*, and
   * erring toward waiting is free.
   *
   * It is exactly wrong for a caller whose two branches are not both cheap. The authentication launch
   * uses connectivity to decide whether to **skip** contacting Supabase; reading an unanswered
   * platform as "definitely offline" makes it skip the refresh on a device that is perfectly online,
   * which strands the user on a receipt they did not need — and in a Jest environment, where
   * `getNetworkStateAsync` resolves `undefined`, it silently signed out every test that rendered the
   * real provider.
   *
   * That is the same defect the session resolution was built to remove, one layer down: an absence of
   * information wearing the costume of a verdict. So the honest reading is available to callers that
   * need it, and `current` keeps its convenient fold for the ones that do not.
   * ═══════════════════════════════════════════════════════════════════════════
   */
  readonly currentOrUnknown: () => Promise<ConnectivityState | null>;
  /**
   * Watches for changes. Returns the unsubscribe.
   *
   * The listener is **not** invoked with the current state on subscribe. Callers that need a value
   * immediately call `current()`, so "I was told" and "I asked" stay distinguishable — a subscriber
   * that treated a synthetic first event as a change would run a sync transaction on every mount.
   */
  readonly subscribe: (listener: (state: ConnectivityState) => void) => () => void;
};

/**
 * Whether a Content Sync check may run over this connection.
 *
 * Any confirmed-reachable link, of any kind. A sync page and a snapshot are bounded by the Edge
 * Function at 1 MiB and 8 MiB, and the licence condition is a *check obligation* — deferring it
 * because the user happens to be on cellular would trade a compliance duty for a few megabytes.
 */
export function canSync(state: ConnectivityState): boolean {
  return state.reachability === 'online';
}

/**
 * Whether a bulk audio download may run over this connection, given the user's preference.
 *
 * Wi-Fi-only means **confirmed** Wi-Fi: `isWifi` already requires reachability, so a Wi-Fi link
 * behind a captive portal answers `false` here and the download waits rather than failing per file.
 */
export function canDownload(state: ConnectivityState, wifiOnly: boolean): boolean {
  return wifiOnly ? state.isWifi : state.reachability === 'online';
}
