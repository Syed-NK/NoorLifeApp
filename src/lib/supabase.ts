import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import 'react-native-url-polyfill/auto';

/**
 * The Supabase client.
 *
 * Follows the official Expo/React Native quickstart: the URL polyfill is imported for its side effect
 * before the client is created, because `supabase-js` builds request URLs with the WHATWG `URL` API
 * and Hermes does not ship a complete one.
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

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabasePublishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

/**
 * Whether Supabase is configured in this build.
 *
 * Exported so the UI can disable provider actions and show an honest message instead of failing at
 * the first request. Without it a missing `.env` would surface as an opaque network error.
 */
export const isSupabaseConfigured =
  typeof supabaseUrl === 'string' &&
  supabaseUrl.length > 0 &&
  typeof supabasePublishableKey === 'string' &&
  supabasePublishableKey.length > 0;

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
