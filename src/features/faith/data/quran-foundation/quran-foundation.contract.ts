import type { ContentSource } from '../faith-result';
import type { ReciterId, TranslationId } from '../quran-content.repository';

/**
 * The Quran Foundation Content API adapter — the client half of the contract.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * APPROVED. Quran Foundation granted **production Content API access** on
 * 2026-08-10. Search, the OAuth user APIs, bookmarks, notes and every other
 * user-feature endpoint are **not approved** and are not implemented.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── This file still contains no network code, and that is still the point ───
 * Everything below is types and configuration. There is no `fetch`, no base URL, no client id, no
 * client secret and no fallback to an unofficial Qur'an API — the last of which is worth stating
 * even now that access is approved, because it is the tempting shortcut whenever the approved source
 * is unreachable, and it would mean shipping scripture from an unvetted source.
 *
 * ── Why the adapter is server-bound ─────────────────────────────────────────
 * An Expo bundle is readable by anyone who unzips the APK. `EXPO_PUBLIC_*` values are inlined at
 * bundle time and are equally readable. A Quran Foundation client secret therefore cannot live in
 * this app under any configuration, and neither can a token minted from one.
 *
 * The shape that ships:
 *
 *     Expo app ──► NoorLife edge function ──► Quran Foundation Content API
 *                  (holds the credential,      (never contacted by the
 *                   enforces the allow-list,    device directly)
 *                   normalises errors)
 *
 * `QuranContentEndpoint` below describes the *edge function's* interface — the thing the device is
 * allowed to know about. The credential, the vendor hostnames and the token exchange are all
 * properties of the server and are deliberately absent from these types: there is nowhere in this
 * contract to put a secret, which is a stronger guarantee than a convention not to.
 */

// ─────────────────────────────────────────────────────────────────────────────
// The approval, recorded where the code that depends on it can see it
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What was approved, when, and what was not.
 *
 * Written as data rather than as prose in a README so the scope is something a test can assert and a
 * future change has to edit deliberately. `README.md` in this directory carries the narrative; this
 * is the machine-checkable version of it.
 */
export const quranFoundationApproval = {
  /** The date production Content API access was granted. */
  approvedOn: '2026-08-10',
  /** The single approved scope, and the value the server requests. */
  scope: 'content',
  /**
   * The APIs that remain unapproved. Each is a capability NoorLife must not build against, and the
   * one with a visible product consequence is `search` — see `searchTranslations`.
   */
  unapproved: ['search', 'oauth-user-apis', 'bookmarks', 'notes', 'reading-sessions'],
  /** Credentials live in the Supabase function environment and nowhere else. */
  credentialLocation: 'supabase-function-secrets',
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Cache policy
// ─────────────────────────────────────────────────────────────────────────────

/**
 * How long a cached response may be served.
 *
 * The one-week ceiling is a **licence term**, not a tuning parameter: the Quran Foundation developer
 * terms forbid caching or storing QF content "longer than 1 week". So it is a constant rather than a
 * configurable field, `validateCachePolicy` rejects anything above it, and the edge function clamps
 * the age it declares to the same number — a test pins the two values to each other, because a client
 * and a server disagreeing about a licence term is the kind of drift nobody notices.
 *
 * Qur'an text does not change, but a cache without an expiry is a cache nobody can correct: if an
 * edition is withdrawn or a translation revised, a week is the longest a stale copy may persist.
 */
export const MAX_CACHE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type QuranCachePolicy = {
  /** Arabic scripture. Immutable content, so the full week is appropriate. */
  readonly scriptureMaxAgeMs: number;
  /** Translations. Revisable by their publishers, so a shorter window. */
  readonly translationMaxAgeMs: number;
  /** Edition and reciter lists. Change when the vendor adds one. */
  readonly catalogueMaxAgeMs: number;
};

export const defaultQuranCachePolicy: QuranCachePolicy = {
  scriptureMaxAgeMs: MAX_CACHE_AGE_MS,
  translationMaxAgeMs: 24 * 60 * 60 * 1000,
  catalogueMaxAgeMs: 24 * 60 * 60 * 1000,
};

/** Throws if any window exceeds the one-week ceiling. Asserted by test. */
export function validateCachePolicy(policy: QuranCachePolicy): QuranCachePolicy {
  for (const [name, value] of Object.entries(policy)) {
    if (value > MAX_CACHE_AGE_MS) {
      throw new RangeError(
        `Cache policy "${name}" is ${value}ms, above the ${MAX_CACHE_AGE_MS}ms (one week) maximum.`,
      );
    }
    if (value <= 0) {
      throw new RangeError(`Cache policy "${name}" must be positive, received ${value}.`);
    }
  }
  return policy;
}

/**
 * How many responses the in-memory cache may hold.
 *
 * Small on purpose. The cache exists to stop the reader re-fetching the page the user just scrolled
 * past, not to accumulate a copy of the Qur'an — and the developer terms forbid exactly that
 * accumulation. A bounded store that evicts the least recently used entry cannot grow into a mirror
 * however long the app runs.
 */
export const MAX_CACHE_ENTRIES = 48;

// ─────────────────────────────────────────────────────────────────────────────
// The edge function's wire contract, mirrored
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The Supabase function this adapter invokes. A **name**, not an address.
 *
 * Everything about where the function lives — the project origin, the `/functions/v1/` prefix — is
 * the shared Supabase client's business, which is what makes "no vendor endpoint is called from
 * mobile source" true by construction rather than by inspection.
 */
export const QURAN_CONTENT_FUNCTION_NAME = 'quran-content';

/** Mirrors `CONTRACT_VERSION` in the function's own `contract.ts`. A test pins the two. */
export const QURAN_CONTENT_CONTRACT_VERSION = 1;

/**
 * The client deadline.
 *
 * Above the server's handler budget, so the server's honest `timeout` wins the race in every ordinary
 * case and this only fires for a connection that has genuinely stopped answering. A client that gave
 * up first would abandon a request the server is still completing.
 */
export const QURAN_CONTENT_CLIENT_TIMEOUT_MS = 25_000;

/** The vendor's documented page-size ceiling, mirrored so the client never asks for more. */
export const MAX_PAGE_SIZE = 50;
export const DEFAULT_PAGE_SIZE = 20;

/** The approved operations, mirrored from the function. A test pins the two lists. */
export const QURAN_CONTENT_OPERATIONS = [
  'list_chapters',
  'get_chapter',
  'list_verses',
  'list_verse_translations',
  'get_verse',
  'list_translation_resources',
  'list_recitation_resources',
  'list_verse_recitations',
] as const;

export type QuranContentOperation = (typeof QURAN_CONTENT_OPERATIONS)[number];

/**
 * A vendor resource id as it goes **on the wire**: a bounded positive integer, or `null`.
 *
 * ── Why the app holds a string and sends a number ───────────────────────────
 * `TranslationId` and `ReciterId` are `string` in the domain, and stay that way: an edition
 * identifier is a name rather than an arithmetic quantity, it is persisted in preferences, and it is
 * compared for equality and used as a key. Quran Foundation's ids are integers. Somewhere those two
 * facts have to meet, and this function is that place — **the last statement before a request is
 * built**, so nothing upstream of it has to know the vendor counts.
 *
 * ── Why the conversion is explicit rather than coerced ──────────────────────
 * A live deployment answered `400 invalid_request` with `error_field: recitation_id` and
 * `upstream_attempts: 0` because the app sent `"1"` where the function required `1`. The tempting
 * repair is to teach the server to accept both. That is the wrong direction: a server that coerces
 * is a server whose contract is "whatever the client happens to send", and the next mismatch is
 * silent rather than loud. The boundary converts; the server stays strict; a value that is not a
 * resource id never becomes a request.
 *
 * Rejected deliberately, each because it is a different way of not being an id: a non-decimal form
 * (`'0x1'`, `'1e3'`, `'٣'`), a fraction, zero, a negative, whitespace, a leading zero that would make
 * `'01'` and `'1'` two spellings of one edition, anything above the id space, and anything outside
 * the safe-integer range.
 */
export function toWireResourceId(value: string | number | undefined | null): number | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= MIN_RESOURCE_ID && value <= MAX_RESOURCE_ID
      ? value
      : null;
  }
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,6}$/.test(value)) {
    return null;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= MIN_RESOURCE_ID && parsed <= MAX_RESOURCE_ID
    ? parsed
    : null;
}

/** The vendor's resource id space, mirrored from the function so both sides bound it alike. */
export const MIN_RESOURCE_ID = 1;
export const MAX_RESOURCE_ID = 1_000_000;

/**
 * The request body, as a closed union.
 *
 * ── There is no field here that could name an address ───────────────────────
 * Every member is an operation name plus integers. The device cannot ask the edge function to fetch
 * an arbitrary URL, because there is no property in this type to put one in — and the function
 * refuses unknown fields by name regardless.
 *
 * The two resource ids are `number` here and `string` in the domain. That is the whole of the
 * conversion policy, expressed in the type: a `TranslationId` cannot be assigned to this union
 * without passing through `toWireResourceId`.
 */
export type QuranContentRequest =
  | { readonly operation: 'list_chapters' }
  | { readonly operation: 'get_chapter'; readonly surah: number }
  | {
      readonly operation: 'list_verses';
      readonly surah: number;
      readonly page?: number;
      readonly per_page?: number;
    }
  | {
      readonly operation: 'list_verse_translations';
      readonly surah: number;
      readonly translation_id: number;
      readonly page?: number;
      readonly per_page?: number;
    }
  | {
      readonly operation: 'get_verse';
      readonly surah: number;
      readonly verse: number;
      readonly translation_id?: number;
    }
  | { readonly operation: 'list_translation_resources' }
  | { readonly operation: 'list_recitation_resources' }
  | {
      readonly operation: 'list_verse_recitations';
      readonly surah: number;
      readonly recitation_id: number;
      readonly page?: number;
      readonly per_page?: number;
    };

/** The body as it goes on the wire: the request above, plus the version the server checks. */
export type QuranContentRequestBody = QuranContentRequest & {
  readonly contract_version: typeof QURAN_CONTENT_CONTRACT_VERSION;
};

/**
 * Why a call to the edge function did not produce content.
 *
 * A closed set of **states**, never a message. The server already refuses to forward a Quran
 * Foundation error body, and this type is the client-side half of the same rule: there is no member
 * here carrying free text, so nothing an upstream said can reach a screen even if a future edit tried
 * to pass it along.
 */
export type QuranEndpointFailure =
  /** No Supabase project is configured in this build. Retrying cannot help. */
  | 'not-configured'
  /** No signed-in session, or the gateway refused the token. */
  | 'authentication-required'
  /** The device could not reach the network at all. */
  | 'offline'
  /** The request ran out of time, on either side of the boundary. */
  | 'timed-out'
  /** Quran Foundation is rate-limiting NoorLife. Not the user's doing. */
  | 'rate-limited'
  /** The vendor has no such chapter, verse or edition. */
  | 'not-found'
  /** The service or the vendor is failing. */
  | 'unavailable'
  /** A response NoorLife could not validate. Never rendered. */
  | 'invalid-response';

export type QuranEndpointOutcome<T> =
  | {
      readonly kind: 'ok';
      readonly data: T;
      /** How long this response may be cached, as the **server** decided. Bounded by the licence. */
      readonly cacheMaxAgeMs: number;
    }
  | { readonly kind: 'failed'; readonly failure: QuranEndpointFailure };

// ─────────────────────────────────────────────────────────────────────────────
// Validated payload shapes
// ─────────────────────────────────────────────────────────────────────────────

/** Provenance as it crosses the wire. Mirrors `ContentSource` minus the client's own defaults. */
export type WireSource = {
  readonly name: string;
  readonly edition?: string;
  readonly attribution?: string;
  readonly verified: true;
};

export type WireChapter = {
  readonly number: number;
  readonly name: string;
  readonly arabicName: string;
  readonly meaning: string;
  readonly ayahCount: number;
  readonly revelation: 'meccan' | 'medinan';
};

export type WireVerse = {
  readonly surah: number;
  readonly ayah: number;
  /** Uthmani script. Copied from the response and never transformed. */
  readonly arabic: string;
};

export type WireTranslation = {
  readonly surah: number;
  readonly ayah: number;
  readonly translationId: TranslationId;
  readonly text: string;
};

export type WirePagination = {
  readonly nextCursor: string | null;
  readonly total?: number;
};

export type WireEdition = {
  readonly id: TranslationId;
  readonly language: string;
  readonly name: string;
  readonly translator: string;
};

export type WireReciter = {
  readonly id: ReciterId;
  readonly name: string;
  readonly style?: string;
};

/**
 * One verse's recitation audio, as it crosses the wire.
 *
 * ── There is no text field here, and there never may be ─────────────────────
 * This is *Arabic recitation*. The approved API provides no translated narration, and NoorLife must
 * not present recitation as one — so this shape offers nowhere to put a transcript or a translated
 * caption. The verse key says which ayah is being recited; the reader already holds that ayah's text
 * and its attributed translation as separate objects.
 *
 * ── The URL is checked on the server, and the host list stays there ─────────
 * This is the only field in the whole contract that the device will *fetch*. The edge function
 * validates it is `https:` on an allow-listed Quran Foundation audio host and drops anything else.
 *
 * That allow-list is deliberately **not** mirrored here, unlike every other part of this contract.
 * The mobile bundle may contain no vendor hostname — an APK is readable by anyone who unzips it, and
 * a device that knew the vendor's addresses would be one configuration mistake away from calling
 * them directly. Copying the audio hosts into this file to re-check them would have traded a real,
 * enforced invariant for a redundant check against a response that already crossed an authenticated
 * channel from NoorLife's own server.
 *
 * What the client *does* check is the part that needs no hostname: the scheme. See
 * `quran-content.endpoint.ts`.
 */
export type WireRecitation = {
  readonly surah: number;
  readonly ayah: number;
  readonly url: string;
  readonly durationSeconds?: number;
};

export type QuranContentPayload =
  | { readonly operation: 'list_chapters'; readonly chapters: readonly WireChapter[] }
  | { readonly operation: 'get_chapter'; readonly chapter: WireChapter }
  | {
      readonly operation: 'list_verses';
      readonly verses: readonly WireVerse[];
      readonly pagination: WirePagination;
      readonly source: WireSource;
    }
  | {
      readonly operation: 'list_verse_translations';
      readonly translations: readonly WireTranslation[];
      readonly pagination: WirePagination;
      readonly source: WireSource;
    }
  | {
      readonly operation: 'get_verse';
      readonly verse: WireVerse;
      readonly source: WireSource;
      readonly translation?: WireTranslation;
      readonly translationSource?: WireSource;
    }
  | { readonly operation: 'list_translation_resources'; readonly editions: readonly WireEdition[] }
  | { readonly operation: 'list_recitation_resources'; readonly reciters: readonly WireReciter[] }
  | {
      readonly operation: 'list_verse_recitations';
      readonly recitations: readonly WireRecitation[];
      readonly pagination: WirePagination;
    };

/**
 * The one thing the device may do with the edge function.
 *
 * A single method taking a closed request and returning a closed outcome. No URL, no headers, no
 * status, no `Response` — a screen that somehow reached this port could still not learn anything
 * about the vendor.
 */
export type QuranContentEndpoint = {
  request(body: QuranContentRequest): Promise<QuranEndpointOutcome<QuranContentPayload>>;
};

// ─────────────────────────────────────────────────────────────────────────────
// Client configuration and provenance
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Configuration the device is permitted to hold.
 *
 * Note what is *not* here: no API key, no client id, no client secret, no vendor hostname. There is
 * nowhere in this type to put a secret.
 */
export type QuranFoundationClientConfig = {
  readonly cachePolicy: QuranCachePolicy;
  /**
   * Whether the device may serve expired cache while offline.
   *
   * True is correct for scripture — showing a week-old ayah beats showing nothing — but the UI must
   * render it through the `stale` result so the user is told. It never extends the licence window:
   * an entry past `MAX_CACHE_AGE_MS` is dropped rather than served stale.
   */
  readonly serveStaleWhenOffline: boolean;
  /** Injected for tests. Production supplies the real endpoint. */
  readonly endpoint: QuranContentEndpoint;
  /** Injected so cache expiry is a value a test can control. */
  readonly now?: () => number;
  /**
   * Where the surah catalogue survives a restart, when this build has somewhere to put it.
   *
   * Optional, and absent in tests that do not care, because the repository is fully correct without
   * it — the store is a latency optimisation, never a source of truth. Its only effect is that a
   * catalogue already fetched once is drawn before the network is consulted; every failure mode,
   * including the store being unreadable, falls through to the request that would have happened
   * anyway.
   */
  readonly catalogueStore?: SurahCatalogueStore;
};

/**
 * The persistence seam for the 114-surah catalogue.
 *
 * Declared here as a port rather than imported, so the repository names no storage backend and
 * remains testable with a plain object. The implementation lives in
 * `storage/faith-quran-catalogue.ts`, which is also where the licence-ceiling argument for
 * persisting this one payload is written down.
 */
export type SurahCatalogueStore = {
  /** The stored catalogue, or `null` when there is none this build may serve. */
  read(): Promise<StoredCatalogueEntry | null>;
  /** Best-effort. A store that refuses a write costs a request next launch and nothing else. */
  write(chapters: readonly WireChapter[]): Promise<void>;
};

/**
 * A stored catalogue and when it was filed.
 *
 * ── Why the timestamp travels with it ───────────────────────────────────────
 * Two windows govern this entry and they mean different things. The **licence** ceiling — one week,
 * `MAX_CACHE_AGE_MS` — is a hard drop the store applies itself, so nothing past it is ever returned.
 * The server's **freshness** instruction for catalogues is a day, and past it the entry is still
 * perfectly servable; it is merely worth re-checking.
 *
 * Without the timestamp the repository cannot tell those apart, and the only options left are to
 * re-check on every single screen mount — which spends a request per tab switch and gives most of
 * the saved latency back — or never, which is a cache nobody can correct. `quran-cache` draws the
 * same distinction for the same reason, and its note explains why the shorter window is not the
 * interesting one.
 */
export type StoredCatalogueEntry = {
  readonly chapters: readonly WireChapter[];
  /** Epoch milliseconds. Inside the licence window by construction — the store enforces that. */
  readonly storedAt: number;
};

/**
 * The provenance of everything the approved adapter returns.
 *
 * `verified: true` is the whole difference from `MOCK_SOURCE`, and it is only correct because this
 * source is the approved one. Nothing else in the app may set that flag.
 */
export const QURAN_FOUNDATION_SOURCE: ContentSource = {
  name: 'Quran Foundation Content API',
  edition: 'Uthmani script',
  verified: true,
};

/**
 * The rules an implementation must satisfy, as machine-checkable assertions.
 *
 * Written as data so the test suite can assert them rather than trusting a comment. They survived the
 * move from "contract only" to a shipped implementation unchanged, which is the point of having
 * written them down before there was anything to check them against.
 */
export const quranFoundationInvariants = {
  /** Qur'anic Arabic is stored and rendered byte-for-byte as received. */
  scriptureIsImmutable: true,
  /** No machine translation, ever. Translations come from attributed editions only. */
  noAutomaticTranslation: true,
  /** No unofficial or community Qur'an API may be used as a fallback. */
  noUnofficialFallback: true,
  /** The device never holds a vendor credential. */
  credentialsAreServerSide: true,
  /** Every response carries its content source. */
  sourceMetadataRequired: true,
  /** Responses are paginated. */
  paginationRequired: true,
  /** No cached copy outlives one week. */
  maxCacheAgeMs: MAX_CACHE_AGE_MS,
  /** Production never falls back to sample scripture when the approved source is unavailable. */
  noMockFallbackInProduction: true,
  /** Search is not approved, and is reported as unsupported rather than faked. */
  searchIsUnsupported: true,
} as const;
