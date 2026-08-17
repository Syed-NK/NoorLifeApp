import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

import type { AuthCallbackFlowName } from './auth-callback.config';

/**
 * NoorLife's own record of "this device asked for that email link".
 *
 * ── Why this exists at all ──────────────────────────────────────────────────
 * Supabase's `sb_flow_id` answers a different question. It is reserved by `@supabase/auth-js`, it
 * names a *PKCE verifier slot*, and the SDK both writes and reads it — see
 * `auth-callback.config.ts` on why we must never mint one ourselves. What it cannot tell us is which
 * NoorLife flow the user started, because the SDK generates it after our call site has run and never
 * hands it back.
 *
 * `nl_rid` is ours. It is minted before the email is requested, travels in `redirectTo` beside (never
 * instead of) `sb_flow_id`, and comes back on the callback. Matching it against a record this device
 * wrote is what makes "this callback belongs to a request we made" a checked statement rather than an
 * assumption about a URL.
 *
 * ── Why it is persisted, and what that costs ────────────────────────────────
 * An emailed link is opened minutes later, often after the app has been backgrounded, killed by
 * Android, or the device restarted. A memory-only record would be gone by then and every genuine
 * recovery would be refused — so the record outlives the process on purpose.
 *
 * The honest limitation: this record lives in app storage. **Uninstalling the app, clearing its data,
 * or a fresh install invalidates every outstanding link**, because the record and Supabase's PKCE
 * verifier both go with it. The user has to request a new email. That is a real cost and it is not
 * worked around — the alternative is accepting a callback we cannot tie to a request.
 *
 * ── What is in the record, and what may never be ────────────────────────────
 * An opaque random id, the flow it was minted for, and two timestamps. Nothing else, ever: not the
 * authorization code, not the PKCE verifier, not an access or refresh token, not the callback URL,
 * not the emailed link's token, not `error_description`. Two guards in
 * `__tests__/pending-auth-flow.test.ts` keep it that way: one asserts the stored record's key set
 * exactly, and one reads this file as text so a forbidden term cannot be introduced behind a branch
 * the runtime tests do not take. The id is not a secret — it travels in an email — so its value is
 * that it is *unguessable and single-use*, not that it is hidden.
 */

/** One hour. Comfortably longer than a user takes to open an email, shorter than the link's own life. */
export const PENDING_FLOW_TTL_MS = 60 * 60 * 1000;

/**
 * A ceiling on stored records.
 *
 * Storage adapters cannot enumerate keys, so the records live in one list. Without a bound, a user
 * who repeatedly requests links would grow it without limit. Oldest-first eviction mirrors the SDK's
 * own bounded verifier ring, so a record cannot outlive the verifier it is paired with.
 */
export const MAX_PENDING_FLOWS = 8;

/** The flows an email link can be minted for. `oauth` never gets one — it has no email leg. */
export type PendingFlowName = Exclude<AuthCallbackFlowName, 'oauth'>;

export type PendingAuthFlow = {
  readonly id: string;
  readonly flow: PendingFlowName;
  readonly createdAt: number;
  readonly expiresAt: number;
};

/**
 * The shape `nl_rid` may take: 32 lower-case hex characters.
 *
 * Narrower than Supabase's own flow-id pattern on purpose. This value is minted here and nowhere
 * else, so there is no reason to accept anything we would not have written — and a tight class means
 * a value that arrives on a URL cannot smuggle a separator, an escape or a path.
 */
export const NL_RID_PATTERN = /^[0-9a-f]{32}$/;

const STORE_KEY = 'noorlife.auth.pendingFlows';

/**
 * Where the list lives.
 *
 * SecureStore when the device has it, AsyncStorage otherwise. The record holds no secret, so the
 * fallback does not weaken anything — but a device with a keystore should not be storing
 * security-relevant state in plain files when it does not have to, and `session-storage.ts` already
 * establishes that split as this project's rule.
 *
 * Falling back rather than failing is deliberate: a device without a configured keystore must still
 * be able to complete a password recovery, and refusing to store the record would refuse every link.
 */
async function readRaw(): Promise<string | null> {
  try {
    if (await SecureStore.isAvailableAsync()) {
      return await SecureStore.getItemAsync(STORE_KEY);
    }
  } catch {
    // Fall through to plain storage rather than losing the flow.
  }
  try {
    return await AsyncStorage.getItem(STORE_KEY);
  } catch {
    return null;
  }
}

async function writeRaw(value: string): Promise<void> {
  try {
    if (await SecureStore.isAvailableAsync()) {
      await SecureStore.setItemAsync(STORE_KEY, value);
      return;
    }
  } catch {
    // Fall through.
  }
  try {
    await AsyncStorage.setItem(STORE_KEY, value);
  } catch {
    // Non-fatal. The link will be refused as unknown, which is the safe direction to fail.
  }
}

/** Whether a parsed entry is a record this module wrote. Anything else is discarded, not repaired. */
function isRecord(value: unknown): value is PendingAuthFlow {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === 'string' &&
    NL_RID_PATTERN.test(candidate.id) &&
    (candidate.flow === 'signup' ||
      candidate.flow === 'recovery' ||
      candidate.flow === 'email-change') &&
    typeof candidate.createdAt === 'number' &&
    typeof candidate.expiresAt === 'number'
  );
}

async function readAll(now: number): Promise<PendingAuthFlow[]> {
  const raw = await readRaw();
  if (raw === null) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Corrupt storage is treated as empty. Repairing it would mean guessing at what it meant.
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  // Expired records are dropped on every read, so the list cannot accumulate dead entries and a
  // record can never be honoured past its TTL even if the clock moved.
  return parsed.filter(isRecord).filter((record) => record.expiresAt > now);
}

/** Mints an opaque, unguessable id. 16 bytes of CSPRNG output, hex encoded. */
export function newPendingFlowId(): string {
  const bytes = Crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Records that this device is about to ask for an email link, and returns the id to put in the
 * redirect.
 *
 * Written *before* the email is requested. If the request then fails the record simply expires
 * unused — the opposite order would let a link arrive before anything knew to expect it.
 */
export async function rememberPendingFlow(
  flow: PendingFlowName,
  now: number = Date.now(),
): Promise<string> {
  const id = newPendingFlowId();
  const existing = await readAll(now);
  const next = [...existing, { id, flow, createdAt: now, expiresAt: now + PENDING_FLOW_TTL_MS }];
  // Oldest first, so the newest request always survives eviction.
  await writeRaw(JSON.stringify(next.slice(-MAX_PENDING_FLOWS)));
  return id;
}

/** Why a callback's `nl_rid` was not honoured. Mirrors the closed union the callback layer speaks. */
export type PendingFlowLookup =
  | { readonly status: 'ok'; readonly flow: PendingFlowName }
  /** No record — never issued here, already consumed, or lost with the app's data. */
  | { readonly status: 'unknown' }
  /** Malformed. Never matched against storage at all. */
  | { readonly status: 'malformed' };

/**
 * Claims a record, exactly once.
 *
 * The record is deleted **before** the caller acts on it, which is what makes replay a storage fact
 * rather than a promise about call order: a second delivery of the same link finds nothing and is
 * refused as `unknown`. Expiry is folded into `unknown` on purpose — both mean "we cannot tie this
 * callback to a request", and the remedy the user is given is the same.
 */
export async function claimPendingFlow(
  id: unknown,
  now: number = Date.now(),
): Promise<PendingFlowLookup> {
  if (typeof id !== 'string' || !NL_RID_PATTERN.test(id)) {
    return { status: 'malformed' };
  }
  const records = await readAll(now);
  const match = records.find((record) => record.id === id);
  if (match === undefined) {
    return { status: 'unknown' };
  }
  await writeRaw(JSON.stringify(records.filter((record) => record.id !== id)));
  return { status: 'ok', flow: match.flow };
}

/** Drops every record. Used on sign-out and by tests; never leaves a link half-honoured. */
export async function clearPendingFlows(): Promise<void> {
  await writeRaw(JSON.stringify([]));
}
