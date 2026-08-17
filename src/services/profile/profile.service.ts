import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { AuthError } from '@services/auth/auth-service.contract';
import { toAuthErrorCode } from '@services/auth/auth.service';
import type { AuthProviderId } from '@shared/models/user';
import { assertRemoteAccess } from '@services/network/remote-access';

/**
 * The profile-record service: everything that *writes* to `public.profiles`, plus the one session
 * fact the account screens display.
 *
 * ── Why this is not in `auth.service.ts` ────────────────────────────────────
 * That file is design-locked and out of scope for feature work — `protected-files.test.ts` asserts
 * it byte-for-byte against the branch point. Editing it to add a name write would have been the
 * exact change the lock exists to catch. The separation turns out to be the better architecture
 * anyway: authentication owns sessions and credentials, and this owns the profile row.
 *
 * ── What it reuses rather than reimplements ─────────────────────────────────
 * `toAuthErrorCode` is imported from the authentication service and is the *only* thing taken from
 * it. Error classification is subtle — a JWT message also contains the word "expired" — and a second
 * copy of that logic would be a second place for it to be subtly wrong. Screens therefore render
 * the same closed `AuthErrorCode` union here as they do everywhere else, through the same locked
 * copy, and never a raw Postgres message.
 *
 * ── Presentation never sees the client ──────────────────────────────────────
 * The Supabase client is imported here and nowhere near a screen. A test asserts that neither
 * Profile detail screen imports it, directly or transitively through a component.
 */

function requireClient() {
  if (!isSupabaseConfigured || supabase === null) {
    throw new AuthError(
      'not-configured',
      'Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY.',
    );
  }
  return supabase;
}

/** Re-throws as the closed union the UI renders. Never surfaces the original message. */
function fail(error: unknown): never {
  throw new AuthError(toAuthErrorCode(error));
}

/**
 * Readers that want to know when the durable profile row has been written.
 *
 * ── Why a notification rather than a returned value ─────────────────────────
 * `public.profiles` is read by more than one mounted component at a time — Profile Home's identity
 * card reads it, and so does Personal Information. When one of them writes the row, the other is
 * still on the navigation stack holding the value it read minutes ago, and nothing about a promise
 * resolving in the writer reaches the reader. A stale name on Profile Home after a successful save
 * is exactly the "must reflect the new name without an app restart" requirement failing.
 *
 * So the write announces itself and every reader re-reads the row. Re-reading, rather than being
 * handed the new string, is the honest version: what the readers then show is what the database
 * actually holds, not what the writer believes it sent.
 */
const profileChangeListeners = new Set<() => void>();

export function subscribeToProfileChanges(listener: () => void): () => void {
  profileChangeListeners.add(listener);
  return () => {
    profileChangeListeners.delete(listener);
  };
}

/** What a successful name write resolved to — the value as it was stored, already trimmed. */
export type ProfileNameUpdate = {
  readonly fullName: string;
};

/**
 * Writes `profiles.full_name` for the caller's own row.
 *
 * ── Scope ───────────────────────────────────────────────────────────────────
 * The name, and nothing else. It deliberately does not touch the authenticated email — that is an
 * `auth.users` change with its own confirmation flow, and writing an address into `profiles` would
 * be a display-only edit dressed up as an account change. Avatars are absent for a simpler reason:
 * there is no storage-bucket contract yet, so there is nothing honest to write.
 *
 * RLS makes the `eq` filter a convenience rather than the security boundary — another user's row is
 * invisible to this session whatever filter is passed.
 */
export async function updateFullName(userId: string, fullName: string): Promise<ProfileNameUpdate> {
  /*
    First statement, before the client is even requested. A profile write is the clearest case for
    refusing early: offline it can only fail, and the user would have watched a spinner and then
    been told something vague while their edit sat unsaved on screen.
  */
  assertRemoteAccess('Updating your profile');
  const client = requireClient();
  const trimmed = fullName.trim();
  if (trimmed.length === 0) {
    // The screen validates before calling; this is the same invariant restated where the write
    // happens, so no future caller can blank a name by accident.
    throw new AuthError('server-error', 'A profile name must not be empty.');
  }

  const { error } = await client.from('profiles').update({ full_name: trimmed }).eq('id', userId);
  if (error !== null) {
    fail(error);
  }

  for (const listener of profileChangeListeners) {
    listener();
  }
  return { fullName: trimmed };
}

/**
 * Which method established the current session, as the identity provider itself reports it.
 *
 * ── Why it resolves to null so readily ──────────────────────────────────────
 * Supabase records this in `app_metadata.provider`. Anything that is not one of the three methods
 * this app implements — and anything missing, unreadable or unconfigured — resolves to null, and the
 * screen then omits the row entirely. Telling a Google user they signed in with Email would be an
 * invented claim about their own credentials, and "Email" is exactly the plausible default a
 * careless implementation would fall back to.
 *
 * Reads the cached session rather than the network: no round trip, and no failure mode beyond "not
 * known", which is already a state the caller handles.
 */
export async function getAuthProviderId(): Promise<AuthProviderId | null> {
  if (!isSupabaseConfigured || supabase === null) {
    return null;
  }
  const { data, error } = await supabase.auth.getSession();
  if (error !== null) {
    return null;
  }
  const appMetadata = data.session?.user.app_metadata as Record<string, unknown> | undefined;
  switch (appMetadata?.['provider']) {
    case 'email':
      return 'email';
    case 'google':
      return 'google';
    case 'apple':
      return 'apple';
    default:
      return null;
  }
}
