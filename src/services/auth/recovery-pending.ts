import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

/**
 * The marker that says "this session came from a password recovery and is not finished yet".
 *
 * ── The condition this exists for ───────────────────────────────────────────
 * A successful recovery exchange establishes a **real authenticated session** before the user has
 * set a new password. That is Supabase's design, not a defect — `updateUser({ password })` needs an
 * authenticated caller. But it means that between the exchange and the password update there is a
 * window in which the account is signed in, and the only thing standing between the user and Main
 * Home was a recovery grant held in memory.
 *
 * Memory does not survive Android killing the process. Force-close the app in that window, or let
 * the system reclaim it, and the next launch found a perfectly good session with no grant beside it
 * — so startup routed to Main Home and the recovery was silently abandoned half-done. The user
 * reached the application without ever completing the reset they started.
 *
 * This marker closes that window by outliving the process.
 *
 * ── Why persisting this is not the thing the code says never to persist ─────
 * `auth-callback-provider.tsx` and `set-new-password-screen.tsx` both state that the recovery grant
 * must never be written to storage, because a persisted grant would become a standing permission to
 * rotate the account's password. That reasoning is still correct and this marker does not weaken it,
 * because **this is not a grant**. The distinction is the whole design:
 *
 * - A *grant* is permissive: holding one lets you do something you otherwise could not.
 * - This marker is **restrictive**: holding one *stops* you reaching destinations you otherwise
 *   could. On its own it authorises nothing at all.
 *
 * The authority to change the password is, and remains, the live Supabase session — which is
 * exactly what an attacker with the device would already have. Adding the marker cannot widen that:
 * every path it can take ends in either the password screen or a sign-out. Removing the marker is
 * what would widen it, by letting the same session wander into Main Home instead.
 *
 * ── What is in it, and what may never be ────────────────────────────────────
 * The authenticated user id, two timestamps, and a journey version. Nothing else, ever: not the
 * authorization code, not the PKCE verifier, not a password, not an access or refresh token, not a
 * callback URL, not an email-link value. Two guards in `__tests__/recovery-pending.test.ts` keep it
 * that way — an exact key-set assertion on what is written, and a scan of this file as text.
 *
 * The user id is not a secret: it is already in the session this marker describes, and it is there
 * so that a marker can be *refused* when it does not match the session actually present.
 */

/**
 * The shape version of the marker.
 *
 * Written into every record and required to match on read. An unrecognised version is treated as
 * corrupt and fails closed rather than being migrated in place: a marker is a security-relevant
 * routing input with a lifetime measured in minutes, so the cost of discarding one is that the user
 * requests a new link, and the cost of misreading one is reaching Home mid-recovery.
 */
export const RECOVERY_JOURNEY_VERSION = 1;

/**
 * How long a pending recovery stays resumable. One hour.
 *
 * Matched to the Supabase access token's own default lifetime, because past that point the session
 * the marker describes cannot perform the password update anyway — so a longer window would only
 * hold a user out of the application for a recovery that can no longer be completed. Shorter would
 * be worse: a user who opens the link, is interrupted, and comes back twenty minutes later has done
 * nothing wrong, and forcing a new email for that is a papercut, not a safeguard.
 */
export const RECOVERY_PENDING_TTL_MS = 60 * 60 * 1000;

export type RecoveryPendingMarker = {
  /** The account the recovery session belongs to. Checked against the live session on every read. */
  readonly userId: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly version: number;
};

/**
 * What a read found.
 *
 * `corrupt` and `expired` are kept apart even though both end in a sign-out, because they call for
 * different things to be said to the user: an expired recovery needs a new link, whereas a corrupt
 * marker is not the user's doing and only needs them back at Sign In.
 */
export type RecoveryPendingRead =
  | { readonly status: 'none' }
  | { readonly status: 'valid'; readonly marker: RecoveryPendingMarker }
  | { readonly status: 'expired' }
  | { readonly status: 'corrupt' };

const STORE_KEY = 'noorlife.auth.recoveryPending';

/**
 * SecureStore where available, AsyncStorage otherwise — the split `session-storage.ts` establishes.
 *
 * The marker holds no secret, so the fallback weakens nothing. Falling back rather than failing is
 * deliberate and load-bearing here: if a device without a keystore could not store the marker, the
 * containment this module exists to provide would silently not apply on exactly that device.
 */
async function readRaw(): Promise<string | null> {
  try {
    if (await SecureStore.isAvailableAsync()) {
      return await SecureStore.getItemAsync(STORE_KEY);
    }
  } catch {
    // Fall through to plain storage rather than losing containment.
  }
  try {
    return await AsyncStorage.getItem(STORE_KEY);
  } catch {
    return null;
  }
}

/**
 * Writes to both stores, and reports whether either accepted it.
 *
 * Both, not one: `readRaw` prefers SecureStore, so a marker left behind in AsyncStorage by an
 * earlier write on a device whose keystore has since become available would be shadowed rather than
 * cleared. Writing the same value to both keeps the two from disagreeing, which matters most for
 * the clearing path — a marker that survives in the shadowed store would contain a user forever.
 */
async function writeRaw(value: string | null): Promise<boolean> {
  let stored = false;
  try {
    if (await SecureStore.isAvailableAsync()) {
      if (value === null) {
        await SecureStore.deleteItemAsync(STORE_KEY);
      } else {
        await SecureStore.setItemAsync(STORE_KEY, value);
      }
      stored = true;
    }
  } catch {
    // Fall through; AsyncStorage may still succeed.
  }
  try {
    if (value === null) {
      await AsyncStorage.removeItem(STORE_KEY);
    } else {
      await AsyncStorage.setItem(STORE_KEY, value);
    }
    stored = true;
  } catch {
    // Reported through the return value rather than thrown. See `writeRecoveryPending`.
  }
  return stored;
}

/** Whether a parsed value is a marker this module wrote, at the version it writes. */
function isMarker(value: unknown): value is RecoveryPendingMarker {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.userId === 'string' &&
    candidate.userId.length > 0 &&
    typeof candidate.createdAt === 'number' &&
    Number.isFinite(candidate.createdAt) &&
    typeof candidate.expiresAt === 'number' &&
    Number.isFinite(candidate.expiresAt) &&
    candidate.version === RECOVERY_JOURNEY_VERSION
  );
}

/**
 * Records that a recovery exchange has succeeded and its password update has not.
 *
 * Returns whether the marker was actually stored. The caller must treat `false` as a failure to
 * contain the session and not proceed into the password form — see the call site in
 * `auth-callback-screen.tsx`. Silently continuing would leave exactly the gap this module closes.
 */
export async function writeRecoveryPending(
  userId: string,
  now: number = Date.now(),
): Promise<boolean> {
  const marker: RecoveryPendingMarker = {
    userId,
    createdAt: now,
    expiresAt: now + RECOVERY_PENDING_TTL_MS,
    version: RECOVERY_JOURNEY_VERSION,
  };
  return writeRaw(JSON.stringify(marker));
}

/**
 * Reads the marker, classifying anything it cannot vouch for as `corrupt`.
 *
 * Every failure mode collapses into a status the router must handle explicitly. There is
 * deliberately no path that returns `none` for a value that exists but could not be understood:
 * `none` means "no recovery is in progress" and is the one answer that lets startup proceed
 * normally, so it is never used as a fallback for "we could not tell".
 */
export async function readRecoveryPending(now: number = Date.now()): Promise<RecoveryPendingRead> {
  const raw = await readRaw();
  if (raw === null) {
    return { status: 'none' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: 'corrupt' };
  }
  if (!isMarker(parsed)) {
    return { status: 'corrupt' };
  }
  if (parsed.expiresAt <= now) {
    return { status: 'expired' };
  }
  return { status: 'valid', marker: parsed };
}

/** Removes the marker from both stores. Safe to call when there is none. */
export async function clearRecoveryPending(): Promise<void> {
  await writeRaw(null);
}
