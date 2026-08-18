import * as SecureStore from 'expo-secure-store';

/**
 * A token-free record that this device has previously held a real session for a specific user.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── What this is, and the thing it is emphatically not ─────────────────────
 * It is **local-device access**: proof that somebody signed in on this phone, kept so the app can
 * open its own shell and its own local data while the network is unreachable. It is not authorisation
 * to call anything. There is no token here, so nothing derived from it can be sent anywhere — and
 * that is a property of the schema rather than a rule somebody has to remember.
 *
 * Supabase already owns the real session and its refresh, in its own storage, and this module does
 * not read, copy, replay or repair that storage. Holding a second credential would double the
 * surface that leaks if the device is compromised, for no gain: the only question this record has to
 * answer is *whose* local data may be opened, and an id answers it.
 *
 * ── Why SecureStore and not AsyncStorage ───────────────────────────────────
 * AsyncStorage is a plain SQLite file readable by anyone with the device unlocked or a backup of it.
 * A flag there saying "this user is signed in" is a flag anybody can write, which would make it a
 * forgeable authentication decision — exactly what locked decision 3 forbids. SecureStore is backed
 * by the Android Keystore, so the record is bound to this app on this device.
 *
 * That still does not make it a credential. An attacker who forged one would get the app shell and
 * whatever is already on the disk; they would get no token, no server access, and no ability to read
 * anything the device does not already hold.
 *
 * ── The tradeoff, stated plainly ───────────────────────────────────────────
 * **A revocation cannot be learned while the device has no network.** If the account holder signs out
 * everywhere, or the session is revoked, this device keeps local access to already-downloaded content
 * until it next reaches Supabase and gets a definitive answer. That window is unavoidable for any
 * offline capability, and it is bounded in the two ways that matter: the receipt grants no server
 * access at all, and the very first definitive answer after connectivity returns deletes it.
 *
 * An explicit sign-out on *this* device deletes it immediately and synchronously, before offline
 * access can be granted again.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * The record's schema version.
 *
 * Read strictly. A record written by a future build is **deleted**, not migrated and not tolerated:
 * this thing gates access to a user's own data, and a partially-understood record is precisely the
 * kind of input that should fail closed.
 */
export const OFFLINE_RECEIPT_VERSION = 1;

/** The Keystore-backed key. One record, replaced whole, never merged. */
const RECEIPT_KEY = 'noorlife.auth.offline-receipt';

export type OfflineReceipt = {
  readonly version: number;
  /**
   * The Supabase user id.
   *
   * The whole point of the record: it is what partitions local Faith data, so a second account
   * signing in on the same device cannot be shown the first account's bookmarks or notes. An opaque
   * uuid, not an email — it identifies without describing.
   */
  readonly userId: string;
  /**
   * The least the shell needs to render without lying.
   *
   * A display name and an optional avatar, because Main Home greets the user by name and Profile
   * draws an identity card. Without them the offline shell would either render "Friend" over a
   * signed-in session or block on a profile read it cannot perform.
   *
   * ── `email` was here, and has been removed ───────────────────────────────
   * It was carried so the Profile identity row would not show a blank line offline. That
   * justification did not survive checking: **the row already has a designed absent state** —
   * `profileCopy.unknownEmail` and `privacySecurityCopy.email.emailUnknown` — so the field bought
   * nothing the UI could not already say honestly.
   *
   * What it cost was real. An email address is the one value in this record that *describes* the
   * person rather than merely identifying them: it is the handle their other accounts use, it is
   * legible to anyone who reads the store, and unlike an opaque uuid it is useful to an attacker on
   * its own. Keystore-backed or not, holding it here meant a second copy of a personal identifier
   * living outside Supabase for the sake of one line of UI that had a fallback. `FORBIDDEN_FIELDS`
   * now refuses it on write, so it cannot return by accident.
   */
  readonly displayName: string;
  readonly avatarUrl: string | null;
  /**
   * Whether onboarding was complete at the last online adoption.
   *
   * Cached so an offline launch routes to Home rather than re-running onboarding for somebody who
   * finished it months ago. Not an entitlement and not a permission — a routing fact.
   */
  readonly hasCompletedOnboarding: boolean;
  /** Epoch ms of the last **successful online** session validation. Never advanced offline. */
  readonly validatedAt: number;
  /** Epoch ms this record was written or last refreshed. */
  readonly updatedAt: number;
};

/**
 * What the shell may render from a receipt.
 *
 * Deliberately not the receipt itself: callers get identity and nothing that looks like a session, so
 * no call site can drift into treating the record as authorisation.
 */
export type OfflineIdentity = {
  readonly userId: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly hasCompletedOnboarding: boolean;
  readonly validatedAt: number;
};

function isReceipt(value: unknown): value is OfflineReceipt {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const nullableString = (input: unknown): boolean =>
    input === null || (typeof input === 'string' && input.length > 0);

  return (
    record.version === OFFLINE_RECEIPT_VERSION &&
    typeof record.userId === 'string' &&
    record.userId.length > 0 &&
    typeof record.displayName === 'string' &&
    record.displayName.length > 0 &&
    nullableString(record.avatarUrl) &&
    /*
      A v1 record written by the previous build carries `email`. It is not merely ignored on read —
      it is **rejected**, which deletes the record and re-derives it from the next online session
      without the field. Tolerating it would leave the address sitting in the Keystore indefinitely
      on every device that had already upgraded, which is the removal not actually happening.
    */
    !('email' in record) &&
    typeof record.hasCompletedOnboarding === 'boolean' &&
    typeof record.validatedAt === 'number' &&
    Number.isFinite(record.validatedAt) &&
    typeof record.updatedAt === 'number' &&
    Number.isFinite(record.updatedAt)
  );
}

/**
 * Fields that must never appear, whatever a future edit intends.
 *
 * Checked on write as well as declared in the type, because a type is erased at runtime and this is
 * the one record in the app whose whole safety argument is "it contains no credential". A caller that
 * spread a session into it would otherwise persist a token to the Keystore silently.
 */
const FORBIDDEN_FIELDS: readonly string[] = [
  /*
    Not a credential, and listed for a different reason than the rest: it is personal data the
    record no longer needs. See the note on `displayName` for why it was removed. Keeping it in this
    list is what makes the removal durable rather than a change somebody can undo by adding a field.
  */
  'email',
  'access_token',
  'accessToken',
  'refresh_token',
  'refreshToken',
  'provider_token',
  'providerToken',
  'providerRefreshToken',
  'password',
  'token',
  'jwt',
  'session',
  'apikey',
  'entitlements',
  'syncToken',
];

function containsForbiddenField(value: Record<string, unknown>): boolean {
  return Object.keys(value).some((key) => FORBIDDEN_FIELDS.includes(key));
}

/**
 * Writes or refreshes the receipt.
 *
 * ── Only ever called after a real online session was adopted ───────────────
 * That is the entire integrity argument. The record says "this device held a validated session for
 * this user at this time", and it may only be written at the moment that is true. Writing it from a
 * cached or offline path would make it a claim about nothing.
 *
 * Returns whether it was stored. A failure is reported rather than swallowed: a caller that believed
 * a receipt existed when it did not would promise offline access the next launch cannot deliver.
 */
export async function writeOfflineReceipt(input: {
  readonly userId: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly hasCompletedOnboarding: boolean;
  readonly now: number;
}): Promise<boolean> {
  /*
    ── Fields are named one at a time, never spread ─────────────────────────
    `{...input}` would be shorter and would carry whatever a future caller happened to pass —
    including a whole session object, which is the failure `FORBIDDEN_FIELDS` exists to catch. An
    explicit construction means a new field cannot arrive here without somebody typing it.
  */
  const receipt: OfflineReceipt = {
    version: OFFLINE_RECEIPT_VERSION,
    userId: input.userId,
    displayName: input.displayName,
    avatarUrl: input.avatarUrl,
    hasCompletedOnboarding: input.hasCompletedOnboarding,
    validatedAt: input.now,
    updatedAt: input.now,
  };

  /* Belt and braces: the type forbids these, and so does the runtime. */
  if (containsForbiddenField(receipt as unknown as Record<string, unknown>)) {
    return false;
  }
  /*
    And the input as well, not only the record built from it. A caller that spreads a session into
    the argument gets refused at the door rather than silently having the extra fields dropped —
    a dropped credential is a lucky escape, and the next edit may not be lucky.
  */
  if (containsForbiddenField(input as unknown as Record<string, unknown>)) {
    return false;
  }

  try {
    await SecureStore.setItemAsync(RECEIPT_KEY, JSON.stringify(receipt));
    return true;
  } catch {
    /*
      The Keystore can refuse — a device without a secure lock screen, a corrupted key. Offline access
      is a convenience; failing to record it costs the next offline launch and nothing else.
    */
    return false;
  }
}

/**
 * Reads the receipt, or `null`.
 *
 * ── Fails closed, and deletes what it refuses ──────────────────────────────
 * A record that does not parse, does not validate, or carries an unsupported version is removed
 * rather than left in place. Leaving it would mean re-reading and re-rejecting the same bad record on
 * every launch, and — worse — would leave something that looks like an access grant sitting in the
 * Keystore for a future, laxer reader to accept.
 */
export async function readOfflineReceipt(): Promise<OfflineIdentity | null> {
  let raw: string | null;
  try {
    raw = await SecureStore.getItemAsync(RECEIPT_KEY);
  } catch {
    /*
      A throw is 'could not read', not 'there is no receipt'. Nothing is deleted here: the record may
      be perfectly good and the Keystore merely busy, and destroying it would cost the *next* launch
      its offline access for a reason that may be transient. The next launch simply reads again.
    */
    return null;
  }
  if (raw === null) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    await clearOfflineReceipt();
    return null;
  }

  if (!isReceipt(parsed)) {
    await clearOfflineReceipt();
    return null;
  }

  return {
    userId: parsed.userId,
    displayName: parsed.displayName,
    avatarUrl: parsed.avatarUrl,
    hasCompletedOnboarding: parsed.hasCompletedOnboarding,
    validatedAt: parsed.validatedAt,
  };
}

/**
 * Deletes the receipt.
 *
 * Called on explicit sign-out, and on any **definitive** server verdict that the session is gone.
 * Never called for a retryable outage — that is the whole distinction this feature turns on.
 */
export async function clearOfflineReceipt(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(RECEIPT_KEY);
  } catch {
    /* Nothing to recover: the next read validates, and an unreadable record is refused anyway. */
  }
}

/** Exported for the tests and the source scan. Never referenced by a screen. */
export const OFFLINE_RECEIPT_KEY_FOR_TESTS = RECEIPT_KEY;
