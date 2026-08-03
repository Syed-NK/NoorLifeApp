/**
 * The one declaration of NoorLife's authentication callback.
 *
 * ── Why every part of it is data, in one file ────────────────────────────────
 * The callback URL has to match a Supabase Dashboard allow-list entry **exactly**, and it is read by
 * four different things: the parser that decides whether an incoming deep link is trusted, the three
 * email actions that ask Supabase to redirect there, the setup checklist, and the ADB commands used
 * to verify all of it on a device. A string typed at four call sites is a string that will be four
 * strings after the next edit, and the failure mode is a link that lands nowhere with nothing in the
 * app looking wrong.
 *
 * `auth-callback-source-scan.test.ts` asserts that no other file in `src` spells the scheme or the
 * path, so a fifth copy fails a test rather than shipping.
 *
 * ── Why this is built from constants rather than from `Linking.createURL` ────
 * `makeRedirectUri`/`createURL` resolve against the execution environment: a development build gives
 * `noorlifeapp://…`, Expo Go gives `exp://<lan-ip>:8081/--/…`, and web gives an `https` origin. Only
 * the first can be allow-listed honestly — a LAN address changes with the network, and allow-listing
 * a wildcard `exp://` entry would widen what Supabase is willing to redirect to for the sake of a
 * client this project does not use. NoorLife requires a development build (`expo-dev-client`), so the
 * scheme is known at authoring time and is written down.
 *
 * That decision is also what makes the value testable without a native manifest, which is why the
 * previous lazily-memoized `makeRedirectUri()` existed at all.
 *
 * ── Nothing here is a secret ────────────────────────────────────────────────
 * A callback URL is public by construction — it travels in an email and through a browser. There is
 * no key, token or project reference in this file.
 */

/**
 * The application's custom scheme, as declared in `app.json`.
 *
 * Lower-case, and compared case-insensitively by the parser: Android lower-cases the scheme of an
 * incoming intent, iOS does not always, and a callback that worked on one platform and not the other
 * would be a bug nobody could reproduce.
 *
 * `exp+noorlifeapp` — which `expo prebuild` also writes into the manifest — is deliberately **not**
 * here. Expo Go is not a supported target for authentication callbacks, and treating its scheme as
 * trusted would mean accepting a session-establishing link from a development client that any app on
 * the device can also claim.
 */
export const AUTH_CALLBACK_SCHEME = 'noorlifeapp';

/**
 * The single approved path, with no leading or trailing slash.
 *
 * One path rather than one per flow. A per-flow path (`auth/callback/recovery`, say) would put the
 * flow's identity on the untrusted side of the boundary — the URL — when the authoritative answer
 * comes from the exchange. See `auth-callback.contract.ts` on what counts as authority.
 */
export const AUTH_CALLBACK_PATH = 'auth/callback';

/**
 * The canonical callback URL. This exact string is what Supabase must be configured to allow.
 *
 * `noorlifeapp://auth/callback`
 */
export const AUTH_CALLBACK_URL = `${AUTH_CALLBACK_SCHEME}://${AUTH_CALLBACK_PATH}`;

/**
 * The Supabase parameter names this contract reads off a callback.
 *
 * Named here rather than inline so the set is inspectable, and so `sb_flow_id` in particular is
 * recorded as *Supabase's* name and not ours — it is written by
 * `GoTrueClient._maybeAppendFlowIdToRedirect`, whose constant is
 * `PKCE_FLOW_ID_PARAM = 'sb_flow_id'` in `@supabase/auth-js@2.111.0`.
 */
export const AUTH_CALLBACK_PARAMS = {
  /** The single-use PKCE authorization code. */
  code: 'code',
  /** Supabase's own PKCE flow identifier, appended by the SDK to a recovery redirect. */
  flowId: 'sb_flow_id',
  /** The flow the link claims to be. A hint, cross-checked and never trusted alone. */
  type: 'type',
  error: 'error',
  errorCode: 'error_code',
  /**
   * Read only to know that it exists.
   *
   * Its *value* is a server-authored sentence that has historically carried addresses and
   * identifiers, so it is never logged, rendered, stored or attached to an error. The parser records
   * a boolean and discards the string.
   */
  errorDescription: 'error_description',
} as const;

/**
 * The flows this application handles, and what each one is.
 *
 * `oauth` is declared and deliberately not enabled. It has nothing to wire today: `signInWithGoogle`
 * consumes its own callback in-process through `WebBrowser.openAuthSessionAsync`, which resolves with
 * the return URL, so the deep-link listener is never involved. Naming it here gives a later phase one
 * place to turn it on; until then the parser refuses it, which is what keeps production Google and
 * Apple OAuth off as instructed.
 */
export const AUTH_CALLBACK_FLOWS = {
  signup: { enabled: true },
  recovery: { enabled: true },
  'email-change': { enabled: true },
  oauth: { enabled: false },
} as const;

export type AuthCallbackFlowName = keyof typeof AUTH_CALLBACK_FLOWS;

/**
 * Supabase's `type` values, mapped onto our flow names.
 *
 * `magiclink` and `invite` are accepted as *link shapes* Supabase can legitimately produce and
 * mapped onto `signup`, because both end the same way — a confirmed session that the startup machine
 * then routes. They are not separate product flows in NoorLife and are not given separate screens.
 *
 * Anything not listed is rejected rather than mapped to a default. A `type` we do not recognise is a
 * link we did not send.
 */
export const SUPABASE_TYPE_TO_FLOW: Readonly<Record<string, AuthCallbackFlowName>> = {
  signup: 'signup',
  magiclink: 'signup',
  invite: 'signup',
  recovery: 'recovery',
  email_change: 'email-change',
};

/**
 * The shape a PKCE authorization code may take.
 *
 * GoTrue issues a UUID for PKCE flows, and the unreserved base64url set covers that plus any
 * future token-shaped value. The bounds matter as much as the character class: a two-character
 * "code" is not one, and a 4 KB one is somebody probing. Deliberately excludes `%`, `/`, `+`, `=`,
 * whitespace and control characters, so nothing that arrives here can be a smuggled URL or a
 * re-encoded payload.
 */
export const AUTH_CODE_PATTERN = /^[A-Za-z0-9._~-]{20,512}$/;

/**
 * Supabase's own flow-id shape, copied from `@supabase/auth-js`'s `PKCE_FLOW_ID_PATTERN`.
 *
 * Matched here as well as there because the value is used to build a storage key inside the SDK. A
 * malformed one is dropped rather than forwarded — the SDK would discard it anyway, and passing an
 * invalid explicit flow id makes its lookup fail fast instead of falling back.
 */
export const AUTH_FLOW_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * The exact entries Supabase's **Authentication → URL Configuration → Redirect URLs** must contain.
 *
 * The second is not redundant. `supabase-js` appends `sb_flow_id=<id>` to the redirect it sends for a
 * PKCE password recovery, Supabase matches redirect URLs by glob, and a bare entry does not match a
 * URL carrying a query string. Without it a recovery email falls back to the project's Site URL and
 * never reaches the application.
 *
 * This code cannot configure the remote project and does not try. The list is exported so the setup
 * checklist and a test can both read the same values.
 */
export const REQUIRED_SUPABASE_REDIRECT_URLS: readonly string[] = [
  AUTH_CALLBACK_URL,
  `${AUTH_CALLBACK_URL}?**`,
];

/**
 * The redirect handed to `signUp`, `resetPasswordForEmail` and the email-change `updateUser`.
 *
 * A function rather than the bare constant so the three call sites read as asking for something
 * rather than pasting something, and so a future need to vary it — a per-flow path, a build-time
 * override — has one place to land.
 */
export function authCallbackRedirectUrl(): string {
  return AUTH_CALLBACK_URL;
}
