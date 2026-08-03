import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import 'react-native-url-polyfill/auto';

import '@services/auth/web-crypto';

/**
 * The Supabase client.
 *
 * Follows the official Expo/React Native quickstart: the URL polyfill is imported for its side effect
 * before the client is created, because `supabase-js` builds request URLs with the WHATWG `URL` API
 * and Hermes does not ship a complete one.
 *
 * ── WebCrypto, for the same reason and with higher stakes ────────────────────
 * `@services/auth/web-crypto` is imported for its side effect immediately after, and before
 * `createClient`. Hermes ships no `crypto.subtle`, and `supabase-js` responds to its absence by
 * silently downgrading PKCE to `code_challenge_method=plain` — where the challenge *is* the verifier
 * and PKCE protects nothing. Every email confirmation and recovery link in this project is a PKCE
 * flow, so the globals have to be in place before the client that will use them exists. See that
 * file for the audited SDK code and `describePkceChallengeMethod` for the self-report.
 *
 * ── Keys ────────────────────────────────────────────────────────────────────
 * Only the publishable (anon) key is read. It is designed to ship in clients and is safe there
 * *because* Row Level Security governs every table. The service-role key bypasses RLS entirely and
 * must never appear in this application, in an `EXPO_PUBLIC_*` variable, or in the repository —
 * anything prefixed `EXPO_PUBLIC_` is inlined into the JavaScript bundle at build time and is
 * readable by anyone with the APK.
 *
 * ── Session storage ─────────────────────────────────────────────────────────
 * AsyncStorage is what the official guide specifies, and `supabase-js` needs a synchronous-ish
 * key/value store it can enumerate. Note that this is a deliberate, documented exception to the
 * project's usual rule of keeping tokens out of AsyncStorage: the Supabase SDK owns this storage and
 * we do not hand-roll token persistence around it. See session-storage.ts, which continues to keep
 * everything *we* write out of plain storage.
 */

/**
 * Normalizes the project URL to its origin.
 *
 * `supabase-js` appends its own paths — `/auth/v1/...`, `/rest/v1/...` — to whatever it is given, so a
 * base URL that already carries a path silently doubles it. Copying the REST endpoint out of the
 * dashboard instead of the project URL is an easy mistake and produced exactly that: every auth call
 * became `/rest/v1/auth/v1/signup` and returned a 404 whose message ("Invalid path specified in
 * request URL") looks nothing like a configuration problem. Trimming to the origin makes the mistake
 * harmless instead of mystifying.
 */
function normalizeProjectUrl(raw: string | undefined): string | undefined {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return undefined;
  }
  try {
    return new URL(raw.trim()).origin;
  } catch {
    // Not a URL at all. Left as-is so the configuration check below rejects it.
    return raw.trim();
  }
}

const rawUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseUrl = normalizeProjectUrl(rawUrl);
const supabasePublishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

/**
 * True when the URL carried a path that had to be trimmed.
 *
 * Surfaced so a misconfigured `.env` is visible in development rather than only implied by the
 * requests that would have failed.
 */
export const projectUrlWasTrimmed =
  typeof rawUrl === 'string' && supabaseUrl !== undefined && rawUrl.trim() !== supabaseUrl;

/**
 * Whether Supabase is configured in this build.
 *
 * Exported so the UI can disable provider actions and show an honest message instead of failing at
 * the first request. Without it a missing `.env` would surface as an opaque network error.
 */
/**
 * Whether the value is a usable project origin.
 *
 * Must be an origin with no path — a path is what caused every auth call to 404. `https` is required
 * for a hosted project, but plain `http` is allowed for a loopback host because that is exactly what
 * `supabase start` serves on (`http://localhost:54321`); rejecting it would break local development.
 */
function isUsableOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.pathname !== '/' && url.pathname !== '') {
      return false;
    }
    const loopback =
      url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
    return url.protocol === 'https:' || (url.protocol === 'http:' && loopback);
  } catch {
    return false;
  }
}

export const isSupabaseConfigured =
  typeof supabaseUrl === 'string' &&
  isUsableOrigin(supabaseUrl) &&
  typeof supabasePublishableKey === 'string' &&
  supabasePublishableKey.length > 0;

if (__DEV__ && !isSupabaseConfigured && typeof rawUrl === 'string' && rawUrl.length > 0) {
  // Development only, and only the shape — never the key.
  console.warn(
    `[supabase] EXPO_PUBLIC_SUPABASE_URL does not look like a project origin. Expected https://<ref>.supabase.co, got a value with pathname "${(() => {
      try {
        return new URL(rawUrl).pathname;
      } catch {
        return '<unparseable>';
      }
    })()}".`,
  );
}

if (__DEV__ && projectUrlWasTrimmed) {
  console.warn(
    '[supabase] EXPO_PUBLIC_SUPABASE_URL carried a path and was trimmed to its origin. Set it to the project URL, not the REST endpoint.',
  );
}

/**
 * Creates the client, or `null` when the environment is not configured.
 *
 * Returning null rather than throwing keeps the app buildable and launchable with no `.env`, which is
 * what lets the twelve screens be reviewed before a project exists. Every service function checks it
 * and reports a configuration error.
 */
function createSupabaseClient(): SupabaseClient | null {
  if (!isSupabaseConfigured) {
    return null;
  }
  return createClient(supabaseUrl as string, supabasePublishableKey as string, {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      /**
       * Off on native, on for web.
       *
       * Native has no address bar for Supabase to read a callback fragment out of; the deep-link
       * handler passes the code to `exchangeCodeForSession` explicitly. Leaving detection on for
       * native is the documented cause of sessions being silently dropped on cold start.
       */
      detectSessionInUrl: Platform.OS === 'web',
      flowType: 'pkce',
    },
  });
}

export const supabase = createSupabaseClient();

/** The client, or a thrown configuration error. For call sites that cannot proceed without one. */
export function requireSupabase(): SupabaseClient {
  if (supabase === null) {
    throw new Error(
      'Supabase is not configured. Copy .env.example to .env and set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY.',
    );
  }
  return supabase;
}
