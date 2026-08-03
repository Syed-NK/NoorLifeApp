import {
  AUTH_CALLBACK_PARAMS,
  AUTH_CALLBACK_PATH,
  AUTH_CALLBACK_SCHEME,
  AUTH_CODE_PATTERN,
  AUTH_FLOW_ID_PATTERN,
  AUTH_CALLBACK_FLOWS,
  SUPABASE_TYPE_TO_FLOW,
  type AuthCallbackFlowName,
} from './auth-callback.config';
import type { AuthCallbackErrorCode, ParsedAuthCallback } from './auth-callback.contract';

/**
 * The trust boundary: is this deep link a NoorLife authentication callback, and is it usable?
 *
 * ── Why this is a pure function with no I/O and no logging ──────────────────
 * It is the first thing an untrusted, attacker-controllable string touches. Keeping it pure means the
 * whole decision can be exercised against hostile input in a unit test — a hundred malformed URLs in
 * milliseconds — rather than only through a screen that has to be mounted. It also means there is no
 * `console` call in the file at all, so the URL it was handed physically cannot escape from here.
 *
 * ── Why the URL is not parsed with `URL` or `Linking.parse` ─────────────────
 * `noorlifeapp://auth/callback` is not a hierarchical URL as far as the WHATWG parser is concerned:
 * for a non-special scheme it will happily read `auth` as the host and `/callback` as the path on one
 * input and produce a path-only result on another, depending on how many slashes were typed. Android
 * delivers `noorlifeapp://auth/callback`, `expo prebuild`'s own tooling and `Linking.createURL` can
 * produce `noorlifeapp:///auth/callback`, and an emailed link may arrive with a trailing slash. All
 * three are the same destination and all three must resolve identically, so the scheme, the
 * authority-and-path and the query are separated here explicitly and the segments are compared as
 * segments.
 *
 * `Linking.parse` is also avoided for a second reason: it is a native-backed module, and this
 * function needs to be callable from a pure test with no manifest.
 *
 * ── What is never in the return value ───────────────────────────────────────
 * The URL, the `error_description`, and anything not on the closed unions in
 * `auth-callback.contract.ts`. `code` and `flowId` appear only on the `callback` answer, which the
 * service consumes and does not forward.
 */

/** The four answers, as data, so the ordering of the checks below is inspectable. */
function rejected(code: AuthCallbackErrorCode): ParsedAuthCallback {
  return { kind: 'rejected', code };
}

/**
 * Splits a custom-scheme URL into scheme, path segments, query string and fragment.
 *
 * Returns null when the input is not a URL at all — no scheme separator, or an empty scheme.
 */
function dissect(
  url: string,
): { scheme: string; segments: readonly string[]; query: string; fragment: string } | null {
  const separator = url.indexOf('://');
  if (separator <= 0) {
    // Also catches `mailto:`-style opaque URLs and bare paths. Neither can be a callback: the
    // manifest only routes `<scheme>://` intents to this application.
    return null;
  }

  const scheme = url.slice(0, separator).toLowerCase();
  let remainder = url.slice(separator + 3);

  // The fragment is split off first, because a `?` inside a fragment is part of the fragment.
  const hash = remainder.indexOf('#');
  const fragment = hash === -1 ? '' : remainder.slice(hash + 1);
  if (hash !== -1) {
    remainder = remainder.slice(0, hash);
  }

  const question = remainder.indexOf('?');
  const query = question === -1 ? '' : remainder.slice(question + 1);
  if (question !== -1) {
    remainder = remainder.slice(0, question);
  }

  /**
   * Empty segments are dropped, which is what makes the slash count irrelevant.
   *
   * `//auth/callback` (from a triple-slashed URL, whose authority is empty) and `auth/callback` both
   * become `['auth', 'callback']`. A trailing slash contributes an empty segment and is likewise
   * dropped. `auth/callback/extra` keeps its third segment and is therefore not the callback path.
   */
  const segments = remainder.split('/').filter((segment) => segment.length > 0);

  return { scheme, segments, query, fragment };
}

/**
 * Reads a query string into a map, keeping only the *first* value for a repeated key and recording
 * that a repeat happened.
 *
 * A repeated `code` is the interesting case. Parameter-pollution attacks rely on two readers
 * disagreeing about which value wins, so this reader does not pick: a `code` that appears twice with
 * two different values is refused outright rather than resolved.
 */
function readParams(query: string): {
  values: ReadonlyMap<string, string>;
  conflicting: ReadonlySet<string>;
} {
  const values = new Map<string, string>();
  const conflicting = new Set<string>();

  for (const pair of query.split('&')) {
    if (pair.length === 0) {
      continue;
    }
    const equals = pair.indexOf('=');
    const rawKey = equals === -1 ? pair : pair.slice(0, equals);
    const rawValue = equals === -1 ? '' : pair.slice(equals + 1);

    const key = safeDecode(rawKey);
    const value = safeDecode(rawValue);
    if (key === null || value === null) {
      // A malformed escape is not something to guess at.
      conflicting.add(key ?? rawKey);
      continue;
    }

    const existing = values.get(key);
    if (existing === undefined) {
      values.set(key, value);
    } else if (existing !== value) {
      conflicting.add(key);
    }
  }

  return { values, conflicting };
}

/**
 * `decodeURIComponent`, without the throw.
 *
 * A percent escape that is not valid UTF-8 makes it throw, and an exception thrown out of a URL
 * parser tends to be caught somewhere that then logs the URL. Null means "unreadable" and is handled
 * as data.
 */
function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return null;
  }
}

/**
 * How a URL's path segments relate to the approved callback path.
 *
 * `elsewhere` is the only answer that means "not our business". The other three are all *aimed* at
 * the callback and differ only in how they miss.
 */
type PathRelevance =
  /** Exactly `auth/callback`, at any slash count. */
  | 'exact'
  /** Ends in `auth/callback` with something before it, i.e. an authority we do not own. */
  | 'host-prefixed'
  /** Starts with `auth` but is not the callback path. */
  | 'wrong-path'
  /** Not addressed to the callback at all. */
  | 'elsewhere';

function classifyPath(segments: readonly string[]): PathRelevance {
  const expected = AUTH_CALLBACK_PATH.split('/');
  const lower = segments.map((segment) => segment.toLowerCase());

  const matchesAt = (offset: number): boolean =>
    expected.every((part, index) => lower[offset + index] === part);

  if (lower.length === expected.length && matchesAt(0)) {
    return 'exact';
  }
  if (lower.length > expected.length && matchesAt(lower.length - expected.length)) {
    return 'host-prefixed';
  }
  if (lower[0] === expected[0]) {
    return 'wrong-path';
  }
  return 'elsewhere';
}

/** Whether the fragment carries implicit-flow tokens. See §2.6 of the phase contract. */
function hasFragmentTokens(fragment: string): boolean {
  return /(^|&)(access_token|refresh_token|provider_token)=/.test(fragment);
}

/**
 * Maps a declared `type` onto a flow, or reports that it cannot be.
 *
 * `undefined` means the link declared nothing, which is the ordinary case for a PKCE signup
 * confirmation and is not a fault. An unrecognised or disabled value is `unsupported-flow` — never
 * silently mapped to a default, because a `type` we do not recognise is a link we did not send.
 */
function resolveDeclaredFlow(
  raw: string | undefined,
): { flow: AuthCallbackFlowName | null } | { error: 'unsupported-flow' } {
  if (raw === undefined || raw.length === 0) {
    return { flow: null };
  }
  const flow = SUPABASE_TYPE_TO_FLOW[raw.toLowerCase()];
  if (flow === undefined) {
    return { error: 'unsupported-flow' };
  }
  if (!AUTH_CALLBACK_FLOWS[flow].enabled) {
    // `oauth` today. Declared so a later phase has one switch, refused until it is thrown.
    return { error: 'unsupported-flow' };
  }
  return { flow };
}

/**
 * GoTrue's error vocabulary, mapped to our codes.
 *
 * Matched on `error_code` first, because it is the stable machine-readable field. `error` alone is
 * coarse (`access_denied` covers expiry, reuse and refusal alike), so it decides only when there is
 * nothing better. `error_description` is never consulted — its text is a server-authored sentence,
 * and a substring test against it is both fragile and an invitation to keep the string around.
 */
function mapCallbackError(errorCode: string | undefined, error: string | undefined): AuthCallbackErrorCode {
  switch ((errorCode ?? '').toLowerCase()) {
    case 'otp_expired':
    case 'token_expired':
      return 'link-expired';
    case 'flow_state_expired':
      return 'link-expired';
    case 'flow_state_not_found':
    case 'validation_failed':
      return 'link-already-used';
    case 'bad_oauth_state':
    case 'bad_code_verifier':
      return 'link-already-used';
    case 'provider_disabled':
    case 'signup_disabled':
    case 'email_provider_disabled':
      return 'unsupported-flow';
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit':
      return 'server-error';
    default:
      break;
  }

  switch ((error ?? '').toLowerCase()) {
    case 'access_denied':
      // Ambiguous by design on GoTrue's side. "Expired" is the honest reading for an emailed link and
      // the recovery advice — request a new one — is the same for every branch it collapses.
      return 'link-expired';
    case 'server_error':
    case 'temporarily_unavailable':
      return 'server-error';
    case 'unauthorized_client':
    case 'unsupported_response_type':
      return 'invalid-link';
    default:
      return 'invalid-link';
  }
}

/**
 * The whole decision.
 *
 * The order is deliberate: cheapest and most decisive first, so a hostile URL is refused before
 * anything expensive is done with it, and so the *reason* reported is the outermost thing that is
 * wrong. A `javascript:` URL is `untrusted-scheme`, not `unsupported-path`.
 */
export function parseAuthCallback(url: unknown): ParsedAuthCallback {
  if (typeof url !== 'string' || url.length === 0) {
    return { kind: 'unrelated' };
  }
  // A ceiling before any parsing. Nothing legitimate is this long, and it bounds the work an
  // attacker can ask this function to do.
  if (url.length > 4096) {
    return rejected('invalid-link');
  }

  const parts = dissect(url.trim());
  if (parts === null) {
    return { kind: 'unrelated' };
  }

  /**
   * Relevance is decided before trust, and that order matters.
   *
   * Asking "is this addressed to the callback?" first is what lets ordinary deep linking stay
   * ordinary. `noorlifeapp://faith/quran` is somebody navigating, not a hostile callback, and
   * answering it with an authentication error would put an error state over whatever screen the user
   * was on. Only once a URL is aimed at `auth/callback` does the scheme become a *rejection* rather
   * than a shrug.
   */
  const relevance = classifyPath(parts.segments);
  if (relevance === 'elsewhere') {
    return { kind: 'unrelated' };
  }

  if (parts.scheme !== AUTH_CALLBACK_SCHEME) {
    /**
     * Aimed at the callback, on a scheme this contract does not trust — `exp+noorlifeapp` included.
     *
     * Expo Go's scheme is refused for the reason recorded in `auth-callback.config.ts`: treating it
     * as trusted would mean accepting a session-establishing link from a development client that any
     * app on the device can also claim.
     */
    return rejected('untrusted-scheme');
  }

  if (relevance === 'host-prefixed') {
    // `noorlifeapp://evil.example.com/auth/callback` — the right path with something occupying the
    // authority slot. Named for what is wrong rather than described as a path depth.
    return rejected('untrusted-host');
  }
  if (relevance === 'wrong-path') {
    // `auth/callback/extra`, `auth/callback/../x`, `auth/verify`. Right prefix, wrong destination.
    return rejected('unsupported-path');
  }

  // The path is ours from here on, so everything below is a callback that is either usable or refused.

  if (hasFragmentTokens(parts.fragment)) {
    /**
     * Implicit-flow tokens, refused.
     *
     * `flowType: 'pkce'` means every link this application asks for carries a code, so tokens in a
     * fragment can only come from a customised email template or a hand-built URL. Accepting them
     * would mean handing an access and refresh token straight from an untrusted input into
     * `setSession` — the highest-value thing a deep link could smuggle, for a flow we never request.
     * There is no `setSession` path in the callback service at all.
     */
    return rejected('invalid-link');
  }

  const { values, conflicting } = readParams(parts.query);

  const declared = resolveDeclaredFlow(values.get(AUTH_CALLBACK_PARAMS.type));
  if ('error' in declared) {
    return rejected(declared.error);
  }

  const error = values.get(AUTH_CALLBACK_PARAMS.error);
  const errorCode = values.get(AUTH_CALLBACK_PARAMS.errorCode);
  if (error !== undefined || errorCode !== undefined) {
    /**
     * A server-reported failure, before the code check.
     *
     * An expired recovery link arrives with an `error` and no `code`, and it is a normal outcome the
     * user has to be told about — reporting it as `missing-code` would describe our own check rather
     * than what happened. The description's *presence* is recorded; its text is dropped here and
     * never travels.
     */
    return {
      kind: 'error',
      code: mapCallbackError(errorCode, error),
      declaredFlow: declared.flow,
      hadDescription: values.has(AUTH_CALLBACK_PARAMS.errorDescription),
    };
  }

  if (conflicting.has(AUTH_CALLBACK_PARAMS.code)) {
    // Two different `code` values in one URL. Picking either would be picking, so neither is used.
    return rejected('malformed-code');
  }

  const code = values.get(AUTH_CALLBACK_PARAMS.code);
  if (code === undefined || code.length === 0) {
    return rejected('missing-code');
  }
  if (!AUTH_CODE_PATTERN.test(code)) {
    return rejected('malformed-code');
  }

  /**
   * The flow id is dropped when malformed rather than rejecting the whole callback.
   *
   * It is an optimisation, not a credential: without it `supabase-js` reads the legacy fixed key,
   * which still holds the most recently started flow's verifier. Refusing an otherwise-valid link
   * because Supabase appended something we could not parse would fail a legitimate recovery.
   */
  const rawFlowId = values.get(AUTH_CALLBACK_PARAMS.flowId);
  const flowId =
    rawFlowId !== undefined &&
    !conflicting.has(AUTH_CALLBACK_PARAMS.flowId) &&
    AUTH_FLOW_ID_PATTERN.test(rawFlowId)
      ? rawFlowId
      : null;

  return { kind: 'callback', code, flowId, declaredFlow: declared.flow };
}

/**
 * Whether a URL is addressed to the callback at all, whatever it carries.
 *
 * Used by the deep-link listener to decide whether a URL is any of its business, before the more
 * expensive question of whether it is *usable*. Sharing `parseAuthCallback` rather than
 * re-implementing the path test is what stops the listener and the parser disagreeing about what a
 * callback is.
 */
export function isAuthCallbackUrl(url: unknown): boolean {
  const parsed = parseAuthCallback(url);
  return parsed.kind !== 'unrelated';
}
