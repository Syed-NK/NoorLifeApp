import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  faithStorageKeys,
  readJson,
  removeKey,
  writeChecked,
  type FaithStorageKeyName,
} from './faith-storage';
import {
  faithDomainKeyOf,
  getActiveFaithScope,
  scopedFaithAddress,
  type FaithUserScope,
} from './faith-user-scope';

/**
 * Faith data that was written before anybody knew whose it was.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The problem, stated so the solution is not obvious-looking-but-wrong ───
 * Every install that predates account partitioning has bookmarks, notes, a reading position, a
 * tasbih history and a saved location sitting at unscoped addresses. That data is real and somebody
 * made it. What no record anywhere on the device can tell us is **who**.
 *
 * The tempting migration is one line: move it into the namespace of whichever account signs in
 * next. On the overwhelming majority of phones that is exactly right, because there is only ever
 * one person. On a shared or resold phone it hands one person's private reading notes and home
 * city to another — silently, with no prompt and no way to notice. A migration that is right 99%
 * of the time and a privacy breach the rest is not a migration; it is a coin toss with somebody
 * else's data.
 *
 * ── So the data is moved out of reach first, and attributed only on request ─
 * Quarantine is a holding address that **no repository reads**. Moving legacy values there is
 * strictly protective: the moment it completes, no account can see them, including the one that
 * created them. Nothing is deleted, so nothing is lost while the question is open. The user is then
 * asked a neutral question — import, remove, or decide later — and only an explicit "import" moves
 * anything into an account.
 *
 * ── What the user is *not* shown ───────────────────────────────────────────
 * Not one bookmark, note, label or place name. Previewing the contents to help somebody decide
 * whether the data is theirs would disclose it to somebody who might not be its owner, which is the
 * exact harm being avoided — the preview *is* the breach. The prompt says how many kinds of data
 * were found and when, and that is deliberately all it can say.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** The bundle's schema version. A record from a future build is left alone, never guessed at. */
export const LEGACY_QUARANTINE_VERSION = 1;

/**
 * Where the bundle lives.
 *
 * Outside the owned-key registry on purpose: everything in that registry resolves through an owner,
 * and the defining property of this data is that it has none. Addressing it through
 * `resolveFaithAddress` would either partition unowned data by an arbitrary account or make it
 * unreachable while signed out — and the sweep has to run before anybody signs in.
 */
const QUARANTINE_KEY = 'noorlife.faith.legacy-quarantine.v1';

/**
 * The personal keys that existed at unscoped addresses before partitioning.
 *
 * Stated as its own list rather than reused from `USER_SCOPED_KEY_NAMES`, because the two answer
 * different questions and will diverge. That list is "what must be partitioned from now on" and
 * grows whenever a personal key is added; this one is "what a pre-partitioning install can actually
 * contain" and is **frozen** — a key introduced after this change has no legacy address to sweep,
 * and putting it here would make the migration look for something that cannot exist.
 */
export const LEGACY_PERSONAL_KEY_NAMES = [
  'tasbihSession',
  'tasbihHistory',
  'tasbihLabels',
  'worshipDays',
  'readingPosition',
  'readingLog',
  'location',
  'bookmarks',
  'notificationSchedule',
  'preferences',
  'quranNotes',
  'quranPlaylists',
  'dhikrUserState',
] as const satisfies readonly FaithStorageKeyName[];

/** The unscoped addresses those names occupied. */
const LEGACY_ADDRESSES: readonly string[] = LEGACY_PERSONAL_KEY_NAMES.map(
  (name) => faithStorageKeys[name],
);

export type LegacyQuarantine = {
  readonly version: number;
  /** Epoch ms the sweep captured these values. Shown to the user; nothing else is. */
  readonly capturedAt: number;
  /**
   * Domain key to raw stored string.
   *
   * Raw JSON text, not parsed values. Re-serialising would let a validator's opinion of a shape
   * silently rewrite data whose owner has not yet agreed to anything being done with it; the bytes
   * that were on the device are the bytes that get restored.
   */
  readonly entries: Readonly<Record<string, string>>;
};

/** What the prompt is allowed to know. Counts and a timestamp — never a value. */
export type LegacyQuarantineSummary = {
  readonly capturedAt: number;
  /** How many kinds of data were found. Not how many bookmarks, not which ones. */
  readonly categoryCount: number;
};

/** What an account decided. Absent means "not yet", which is also what "decide later" leaves. */
export type LegacyDecision = 'imported' | 'removed';

function isQuarantine(value: unknown): value is LegacyQuarantine {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (record.version !== LEGACY_QUARANTINE_VERSION) {
    return false;
  }
  if (typeof record.capturedAt !== 'number' || !Number.isFinite(record.capturedAt)) {
    return false;
  }
  const entries = record.entries;
  if (typeof entries !== 'object' || entries === null || Array.isArray(entries)) {
    return false;
  }
  return Object.values(entries as Record<string, unknown>).every(
    (entry) => typeof entry === 'string',
  );
}

async function readQuarantine(): Promise<LegacyQuarantine | null> {
  try {
    const raw = await AsyncStorage.getItem(QUARANTINE_KEY);
    if (raw === null) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    return isQuarantine(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Serialises everything in this module onto one chain.
 *
 * ── Why a chain and not a boolean guard ────────────────────────────────────
 * The sweep, an import and a removal all read the bundle and then write based on what they read.
 * Two of them interleaved could have an import read a bundle that a removal is about to delete, and
 * write half of it into an account. A `isRunning` flag would make the second caller *skip*, which
 * is worse — it would report "done" for work that never happened. Queuing makes the second caller
 * wait and then see the finished state.
 */
let chain: Promise<unknown> = Promise.resolve();

function serialise<T>(operation: () => Promise<T>): Promise<T> {
  const next = chain.then(operation, operation);
  /* Swallow on the chain only; the returned promise still rejects for the caller. */
  chain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

/**
 * Moves any unscoped personal data into quarantine.
 *
 * ── Crash-safety, step by step ─────────────────────────────────────────────
 * The bundle is written **before** the originals are removed, in one `setItem` — a single SQLite
 * row write, so it either happened or it did not. A crash in the window between leaves both copies
 * present, which is the safe direction: nothing has been lost, and the next run finds an existing
 * bundle and sweeps the leftovers away.
 *
 * That is also why an existing bundle is never overwritten. It was captured by a complete
 * `multiGet` of every legacy address, so anything still sitting at one of those addresses is
 * already inside it. Re-capturing could only overwrite a bundle the user has been asked about with
 * a subset of itself.
 *
 * Idempotent, and safe to call on every launch.
 */
export function sweepLegacyFaithData(now: number): Promise<'captured' | 'swept' | 'nothing'> {
  return serialise(async () => {
    const existing = await readQuarantine();

    let present: readonly (readonly [string, string | null])[];
    try {
      present = await AsyncStorage.multiGet([...LEGACY_ADDRESSES]);
    } catch {
      return 'nothing';
    }
    const found = present.filter(
      (pair): pair is readonly [string, string] => typeof pair[1] === 'string',
    );

    if (existing !== null) {
      /* Already captured. Anything left at a legacy address is a duplicate of what is in there. */
      if (found.length > 0) {
        await AsyncStorage.multiRemove(found.map(([address]) => address)).catch(() => undefined);
        return 'swept';
      }
      return 'nothing';
    }

    if (found.length === 0) {
      return 'nothing';
    }

    const entries: Record<string, string> = {};
    for (const [address, value] of found) {
      entries[faithDomainKeyOf(address)] = value;
    }
    const bundle: LegacyQuarantine = {
      version: LEGACY_QUARANTINE_VERSION,
      capturedAt: now,
      entries,
    };

    try {
      await AsyncStorage.setItem(QUARANTINE_KEY, JSON.stringify(bundle));
    } catch {
      /*
        The capture failed, so the originals stay exactly where they are. Leaving them unscoped is
        not a regression — it is the state the device was already in — and removing them without a
        durable copy would be the one outcome that actually destroys data.
      */
      return 'nothing';
    }

    await AsyncStorage.multiRemove(found.map(([address]) => address)).catch(() => undefined);
    return 'captured';
  });
}

/** Counts and a timestamp, or `null`. The only read any UI is permitted. */
export async function readLegacyQuarantineSummary(): Promise<LegacyQuarantineSummary | null> {
  const bundle = await readQuarantine();
  if (bundle === null) {
    return null;
  }
  return {
    capturedAt: bundle.capturedAt,
    categoryCount: Object.keys(bundle.entries).length,
  };
}

/** What the current account decided, or `null` for "not yet". */
export async function readLegacyDecision(): Promise<LegacyDecision | null> {
  return await readJson<LegacyDecision | null>(
    faithStorageKeys.legacyDecision,
    null,
    (value): value is LegacyDecision | null => value === 'imported' || value === 'removed',
  );
}

/**
 * Whether the signed-in account still owes an answer.
 *
 * False with no owner: the question is asked *of an account*, and there is nobody to ask. It is
 * also false once answered, which is what makes the prompt one-time.
 */
export async function hasPendingLegacyChoice(): Promise<boolean> {
  if (getActiveFaithScope() === null) {
    return false;
  }
  if ((await readLegacyQuarantineSummary()) === null) {
    return false;
  }
  return (await readLegacyDecision()) === null;
}

export type ImportOutcome =
  | { readonly kind: 'imported'; readonly categoryCount: number; readonly skipped: number }
  | { readonly kind: 'nothing-to-import' }
  | { readonly kind: 'no-owner' }
  /** Written, but the read-back disagreed. The quarantine is **kept**, untouched. */
  | { readonly kind: 'validation-failed' };

function addressesFor(scope: FaithUserScope, bundle: LegacyQuarantine): [string, string][] {
  return Object.entries(bundle.entries).map(([domainKey, value]) => [
    scopedFaithAddress(scope, domainKey),
    value,
  ]);
}

/**
 * Moves the quarantine into the signed-in account, after that account explicitly asked.
 *
 * ── The order, and why the delete is last ──────────────────────────────────
 * Write into the account, **read every address back and compare**, and only then delete the
 * bundle. Deleting first — or deleting on the strength of a `setItem` that resolved — would trust a
 * write nobody has confirmed, and a storage layer that quietly dropped one value would leave the
 * user with neither the imported copy nor the quarantined original. Keeping the bundle until the
 * new copy is proven readable means a failure costs a retry rather than the data.
 *
 * ── Why an occupied address is skipped rather than overwritten ─────────────
 * This account may already have its own bookmarks. Legacy data is of *unknown* origin and this
 * account's own data is not — so when the two collide, the known owner wins. Overwriting would let
 * an import destroy data the user definitely authored in order to install data they merely agreed
 * to adopt.
 */
export function importLegacyQuarantine(): Promise<ImportOutcome> {
  return serialise(async () => {
    const scope = getActiveFaithScope();
    if (scope === null) {
      return { kind: 'no-owner' } as const;
    }
    const bundle = await readQuarantine();
    if (bundle === null) {
      await writeChecked(faithStorageKeys.legacyDecision, 'imported');
      return { kind: 'nothing-to-import' } as const;
    }

    const candidates = addressesFor(scope, bundle);
    if (candidates.length === 0) {
      await AsyncStorage.removeItem(QUARANTINE_KEY).catch(() => undefined);
      await writeChecked(faithStorageKeys.legacyDecision, 'imported');
      return { kind: 'nothing-to-import' } as const;
    }

    let occupied: readonly (readonly [string, string | null])[];
    try {
      occupied = await AsyncStorage.multiGet(candidates.map(([address]) => address));
    } catch {
      return { kind: 'validation-failed' } as const;
    }
    const taken = new Set(
      occupied.filter((pair) => typeof pair[1] === 'string').map((pair) => pair[0]),
    );
    const writable = candidates.filter(([address]) => !taken.has(address));

    try {
      if (writable.length > 0) {
        await AsyncStorage.multiSet(writable);
      }
    } catch {
      return { kind: 'validation-failed' } as const;
    }

    /* Read back what was just written. A resolved write is a claim; this is the evidence. */
    let readBack: readonly (readonly [string, string | null])[];
    try {
      readBack = await AsyncStorage.multiGet(writable.map(([address]) => address));
    } catch {
      return { kind: 'validation-failed' } as const;
    }
    const stored = new Map(readBack.map(([address, value]) => [address, value]));
    const allPresent = writable.every(([address, value]) => stored.get(address) === value);
    if (!allPresent) {
      return { kind: 'validation-failed' } as const;
    }

    await AsyncStorage.removeItem(QUARANTINE_KEY).catch(() => undefined);
    await writeChecked(faithStorageKeys.legacyDecision, 'imported');
    return {
      kind: 'imported',
      categoryCount: writable.length,
      skipped: taken.size,
    } as const;
  });
}

/**
 * Deletes the quarantine permanently, after the user confirmed they want it gone.
 *
 * Irreversible, which is why the calling screen confirms first rather than treating this as an
 * undoable action. There is no second copy anywhere: the sweep moved the values here.
 */
export function removeLegacyQuarantine(): Promise<boolean> {
  return serialise(async () => {
    try {
      await AsyncStorage.removeItem(QUARANTINE_KEY);
    } catch {
      return false;
    }
    await writeChecked(faithStorageKeys.legacyDecision, 'removed');
    return true;
  });
}

/**
 * Records "decide later" without touching the bundle.
 *
 * Deliberately writes **nothing**. Persisting a "later" would make it an answer, and the prompt
 * would never return; leaving the decision key absent is what brings the question back next time
 * this account opens Faith. The bundle stays quarantined and invisible in the meantime.
 */
export async function deferLegacyDecision(): Promise<void> {
  await removeKey(faithStorageKeys.legacyDecision);
}

/** Test-only: the raw address, so a fixture can plant or inspect a bundle. */
export const LEGACY_QUARANTINE_KEY_FOR_TESTS = QUARANTINE_KEY;

/** Test-only: drains the queue so a case cannot observe a previous case's in-flight work. */
export async function drainLegacyQuarantineQueueForTest(): Promise<void> {
  await chain;
}
