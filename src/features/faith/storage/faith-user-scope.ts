/**
 * Whose Faith data a read or a write belongs to.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The exposure this module exists to close ───────────────────────────────
 * Every user-authored Faith key used to be a fixed string — `noorlife.faith.bookmarks`,
 * `noorlife.faith.quran.notes`, and eleven more. A fixed string cannot tell two accounts apart, so
 * signing out and signing in as somebody else on the same device handed the second account the
 * first account's bookmarks, notes, reading progress, tasbih history, saved location and
 * preferences. It was reachable online, today, with no offline feature involved at all.
 *
 * The repair is to make the *address* carry the owner. A key that no account can name is a key no
 * account can read, and that is a property of the address rather than a check somebody has to
 * remember to write.
 *
 * ── Why the derivation is injective and not a hash ─────────────────────────
 * A hash is shorter and looks more private, and it is the wrong tool here. Two user ids that hash
 * to the same digest would silently *share a namespace* — which is precisely the defect being
 * fixed, reintroduced in a form that no test would catch because the collision depends on ids
 * nobody has yet. An encoding cannot do that: distinct inputs give distinct outputs, always, and
 * the proof is that the encoding is reversible.
 *
 * Nothing is lost in privacy terms. The user id is already at rest on this device inside the
 * Supabase session row in the same SQLite database; encoding it into a key beside that row
 * discloses nothing new. What matters is that it is an opaque uuid rather than an email or a name —
 * it identifies without describing — and that it never reaches a log.
 *
 * ── Why the escape is fixed-width ──────────────────────────────────────────
 * `_` followed by exactly four hex digits, always. A variable-width escape (`_5f` for one byte,
 * `_1f600` for another) is ambiguous at the boundary between an escape and the literal characters
 * after it, and an ambiguous encoding is not injective. Fixed width removes the question.
 *
 * The output alphabet is `[A-Za-z0-9-_]`, which deliberately **excludes `.`** — the segment
 * separator. So no encoded id can ever grow a segment, and
 * `noorlife.faith.user.v1.<id>.quran.notes` can only ever parse one way. For an ordinary Supabase
 * uuid the encoding is the identity function: `[0-9a-f-]` all pass through untouched.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * The versioned namespace every user-scoped Faith address sits under.
 *
 * Versioned because the *partitioning scheme* may need to change — a different derivation, an
 * additional segment — and a v2 must be able to coexist with v1 records long enough to migrate
 * them. Bumping it strands the old data rather than corrupting it, which is the right failure.
 */
export const FAITH_USER_NAMESPACE = 'noorlife.faith.user.v1';

/** The prefix the unscoped keys share, stripped to leave the domain part of an address. */
const FAITH_NAMESPACE_PREFIX = 'noorlife.faith.';

/**
 * A resolved owner for Faith data.
 *
 * A branded object rather than a bare string so a caller cannot pass a raw user id where an encoded
 * one is expected — the two are different things and mixing them would produce an address that
 * looks right and partitions nothing.
 */
export type FaithUserScope = {
  readonly encodedUserId: string;
};

/** Characters that survive the encoding unchanged. `_` is excluded: it is the escape introducer. */
function isSafeCharacter(character: string): boolean {
  return /^[A-Za-z0-9-]$/.test(character);
}

/**
 * The injective encoding.
 *
 * Exported because the migration, the tests and the source scan all have to agree on exactly one
 * derivation — a second implementation anywhere is a second partitioning scheme.
 */
export function encodeFaithUserId(userId: string): string {
  let encoded = '';
  for (const character of userId) {
    if (isSafeCharacter(character)) {
      encoded += character;
      continue;
    }
    /*
      Code *points*, not code units, so an emoji or any astral character encodes as one escape rather
      than a surrogate pair that a future decoder could re-pair differently. Padded to four hex
      digits minimum; anything above U+FFFF is longer and still unambiguous because the escape is
      terminated by the next safe character or the end of input — which cannot happen, since every
      subsequent character is either safe or introduces its own `_`.
    */
    const codePoint = character.codePointAt(0) ?? 0;
    encoded += `_${codePoint.toString(16).padStart(4, '0')}`;
  }
  return encoded;
}

/**
 * A scope for a user id, or `null` when there is no usable id.
 *
 * `null` for blank input rather than a scope over the empty string. An empty encoded id would
 * produce `noorlife.faith.user.v1..bookmarks` — a real, writable address shared by every caller who
 * ever passes a blank id, which is a shared namespace wearing a scoped costume.
 */
export function faithScopeFor(userId: string | null | undefined): FaithUserScope | null {
  if (typeof userId !== 'string') {
    return null;
  }
  const trimmed = userId.trim();
  if (trimmed.length === 0) {
    return null;
  }
  return { encodedUserId: encodeFaithUserId(trimmed) };
}

/**
 * The address a domain key resolves to for one owner.
 *
 * `domainKey` is the part after `noorlife.faith.` — `bookmarks`, `quran.notes`, `tasbih.session`.
 * Taking the domain rather than the whole legacy key keeps the two schemes from being concatenated
 * into `…user.v1.<id>.noorlife.faith.bookmarks` by a caller that passed the wrong thing.
 */
export function scopedFaithAddress(scope: FaithUserScope, domainKey: string): string {
  return `${FAITH_USER_NAMESPACE}.${scope.encodedUserId}.${domainKey}`;
}

/** Strips the shared prefix off a legacy key, leaving the domain part. */
export function faithDomainKeyOf(key: string): string {
  return key.startsWith(FAITH_NAMESPACE_PREFIX) ? key.slice(FAITH_NAMESPACE_PREFIX.length) : key;
}

// ── The active scope ────────────────────────────────────────────────────────

/**
 * The owner the storage boundary is currently resolving addresses for.
 *
 * ── Why this is module state and not a React context ───────────────────────
 * The consumers are not components. `faith-storage.ts` exposes four free functions that fifteen
 * storage modules and a dozen hooks call directly, several of them outside render — a notification
 * reconciler, a background sweep, a repository constructed once at module load. Threading a context
 * value through all of them would mean rewriting every one of those call sites into a hook, which
 * is a far larger and less reviewable change than the exposure warrants.
 *
 * What matters for the locked requirement is *where the id comes from*, and it comes from exactly
 * one place: `FaithScopeProvider` reads the authenticated session and sets this. **No repository
 * asks Supabase anything, and no screen constructs a key.** The scan in
 * `faith-account-isolation.test.ts` enforces both.
 *
 * ── Why `null` is inert rather than a fallback ─────────────────────────────
 * With no signed-in user there is no correct namespace to read or write. Falling back to the
 * unscoped keys would restore the exposure exactly; falling back to a shared "anonymous" namespace
 * would quietly accumulate data that the next signed-in user either inherits (the same exposure) or
 * never sees (silent data loss). So an unscoped read returns the caller's own fallback and an
 * unscoped write is dropped — the app renders defaults, and nothing personal is written anywhere a
 * later account could find it.
 */
let activeScope: FaithUserScope | null = null;

/**
 * Increments whenever the owner changes.
 *
 * In-process caches key off this. A cached value read under user A is not merely stale after a
 * switch to user B — it is *the wrong user's data*, and the difference matters enough that the
 * caches are told rather than left to expire.
 */
let scopeRevision = 0;

const scopeListeners = new Set<() => void>();

export function getActiveFaithScope(): FaithUserScope | null {
  return activeScope;
}

export function faithScopeRevision(): number {
  return scopeRevision;
}

/**
 * Sets the owner, and wakes everything that cached anything under the previous one.
 *
 * Idempotent: setting the same owner twice publishes nothing, so a provider re-render cannot
 * invalidate a cache or trigger a reconciliation for an account that has not changed.
 */
export function setActiveFaithScope(userId: string | null): void {
  const next = faithScopeFor(userId);
  if (next?.encodedUserId === activeScope?.encodedUserId) {
    return;
  }
  activeScope = next;
  scopeRevision += 1;
  /*
    Copied before iterating: a listener is entitled to unsubscribe itself in response, and mutating
    the set mid-iteration would skip whichever listener happened to follow it.
  */
  for (const listener of [...scopeListeners]) {
    listener();
  }
}

/** Subscribes to owner changes. Returns the unsubscribe. */
export function subscribeToFaithScope(listener: () => void): () => void {
  scopeListeners.add(listener);
  return () => {
    scopeListeners.delete(listener);
  };
}

/**
 * Returns to "nobody is signed in".
 *
 * Test-only, and named so. Production has no reason to forget an owner without setting another —
 * sign-out calls `setActiveFaithScope(null)`, which is a scope change and publishes one.
 *
 * ── The listeners are deliberately **not** cleared ─────────────────────────
 * They are registered at module import, beside the caches they protect — `prayer-location-store.ts`
 * subscribes so the previous account's home city cannot survive a switch. Clearing them here would
 * silently disarm that protection for every test that ran afterwards in the same worker, and the
 * suite proving the protection works would still pass because it registers its own.
 */
export function resetFaithScopeForTest(): void {
  setActiveFaithScope(null);
}
