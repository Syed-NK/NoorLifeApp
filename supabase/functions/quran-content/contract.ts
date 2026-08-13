/**
 * The `quran-content` wire contract, as types and constants.
 *
 * ── Why this is a module and not a comment in the handler ────────────────────
 * The shapes below are what the mobile adapter programs against. A response shape that lives inside
 * the control flow that produces it is a shape nobody can review without reading the control flow,
 * and `src/features/faith/data/quran-foundation/` mirrors these names deliberately so a reviewer can
 * diff the two sides.
 *
 * ── The scope this contract is allowed to express ────────────────────────────
 * Quran Foundation approved **Content API access only**, on 2026-08-10. Search APIs, the OAuth user
 * APIs, bookmarks, notes and every other user-feature endpoint are **not approved**, and none of them
 * is expressible here: `QuranOperation` is a closed union of eight content reads, `OPERATIONS` is a
 * closed table, and there is no field anywhere in this file that can carry a path, a host, a query
 * string or an upstream URL. That is the structural half of "no arbitrary proxying" — the other half
 * is `request-schema.ts`, which refuses anything not in the table.
 *
 * ── What may never appear in a response body ─────────────────────────────────
 * No upstream status line, no upstream error body, no `x-auth-token`, no client id, no client secret
 * and no access token. `ERROR_MESSAGES` is a constant table chosen before any failure happened, which
 * is the only way to guarantee that in every branch rather than in the branches somebody remembered.
 */

/** NoorLife's own contract version. Not the `/functions/v1/` platform path prefix. */
export const CONTRACT_VERSION = 1;

/** `OPTIONS` is answered for CORS preflight; everything else is `405`. */
export const ALLOWED_METHODS = 'POST, OPTIONS';

/**
 * The request body cap.
 *
 * Generous by an order of magnitude relative to anything this contract can express — the largest
 * legal body is an operation name, a surah number, two integers and a resource id — because the cap
 * exists to stop an unbounded read, not to police a schema the parser already closes.
 */
export const MAX_BODY_BYTES = 2048;

/** The whole request schema. Any other property is rejected by name. */
export const ACCEPTED_REQUEST_FIELDS = [
  'contract_version',
  'operation',
  'surah',
  'verse',
  'translation_id',
  'recitation_id',
  'page',
  'per_page',
] as const;

/**
 * The eight approved operations.
 *
 * Each maps to exactly one upstream Content API route in `quran-foundation-client.ts`. The names are
 * NoorLife's, not the vendor's, so the client speaks a vocabulary this repository owns and an
 * upstream path change is a one-line diff in one server module rather than a client release.
 *
 * Deliberately absent, and each for a stated reason:
 *
 *   • **Search.** `GET /search` exists upstream. NoorLife's Content API approval does not cover it,
 *     so it is not in this union and cannot be requested.
 *   • **Tafsir.** Content-scoped and available, but no NoorLife screen renders one, and an operation
 *     nothing calls is an operation nobody reviews.
 *   • **Content Sync.** It exists to maintain a long-lived local copy, which the developer terms
 *     permit only under their sync obligations and which this integration deliberately does not do.
 *
 * `list_verse_recitations` is the one addition since the table was first written. It was reviewed
 * and added when verse-level recitation playback was approved: it is Content-scoped, it is the only
 * operation whose response carries a **URL the device will fetch directly**, and
 * `AUDIO_HOST_ALLOWLIST` below is the control that makes that safe.
 */
export type QuranOperation =
  | 'list_chapters'
  | 'get_chapter'
  | 'list_verses'
  | 'list_verse_translations'
  | 'get_verse'
  | 'list_translation_resources'
  | 'list_recitation_resources'
  | 'list_verse_recitations';

export const QURAN_OPERATIONS: readonly QuranOperation[] = [
  'list_chapters',
  'get_chapter',
  'list_verses',
  'list_verse_translations',
  'get_verse',
  'list_translation_resources',
  'list_recitation_resources',
  'list_verse_recitations',
];

// ─────────────────────────────────────────────────────────────────────────────
// Audio
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The hosts a recitation URL may point at.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * This is the most security-sensitive constant in the function, and it is worth being explicit
 * about why it exists at all.
 *
 * Every other operation returns *data* — text, numbers, names. This one returns a **URL that the
 * mobile app will then fetch itself**, because audio is streamed by the platform player and cannot
 * realistically be proxied through an edge function. That inverts the usual guarantee: instead of
 * the server being the only thing that talks to a third party, the server is now telling the client
 * where to go.
 *
 * Without a check, a compromised or simply changed upstream response could point NoorLife's users at
 * any host on the internet, and the function would forward it with its own authority behind it. The
 * allow-list is what keeps "no arbitrary upstream proxying" true on this path: a URL that is not
 * `https:` on one of these hosts is **dropped**, not rewritten and not passed through.
 *
 * Adding a host here is a security review, not a configuration change.
 * ═══════════════════════════════════════════════════════════════════════════
 */
export const AUDIO_HOST_ALLOWLIST: readonly string[] = [
  'verses.quran.foundation',
  'audio.qurancdn.com',
  'download.quranicaudio.com',
];

/**
 * The base a relative audio path is resolved against.
 *
 * The vendor returns `url` as a path fragment for some reciters and as an absolute URL for others.
 * Resolving the relative form against a *fixed literal* — rather than against anything in the
 * response — means a relative path cannot escape the allow-list, and an absolute one is checked
 * against it directly.
 */
export const AUDIO_BASE_URL = 'https://verses.quran.foundation/';

// ─────────────────────────────────────────────────────────────────────────────
// Input bounds
// ─────────────────────────────────────────────────────────────────────────────

export const MIN_SURAH = 1;
export const MAX_SURAH = 114;

/**
 * The longest surah is Al-Baqarah at 286 ayat, and that is the bound rather than a round number.
 *
 * A bound the data cannot exceed is a bound that rejects a nonsense request without ever rejecting a
 * real one. Per-surah ayah counts are not checked here — the upstream answers `404` for `2:300`, and
 * duplicating 114 counts in this file would be a second copy of the Qur'an's structure to keep right.
 */
export const MIN_AYAH = 1;
export const MAX_AYAH = 286;

export const MIN_PAGE = 1;

/**
 * The upstream refuses a `page` beyond its own `total_pages`, so this is a sanity bound rather than a
 * correctness one. It is small enough that no legitimate paging sequence reaches it: at the minimum
 * page size of one verse, 286 pages covers the longest surah.
 */
export const MAX_PAGE = 500;

/** The vendor's own documented ceiling: "you can get maximum 50 records". */
export const MIN_PER_PAGE = 1;
export const MAX_PER_PAGE = 50;

/**
 * A translation resource id, as bounds rather than as an allow-list of specific editions.
 *
 * The Content scope approves the catalogue, and the catalogue is what `list_translation_resources`
 * returns — so pinning a hand-written set of ids here would mean the function refused editions its own
 * catalogue call had just advertised. What is checked is that the value is a resource id at all: a
 * positive integer inside a range the vendor's id space fits comfortably within.
 */
export const MIN_RESOURCE_ID = 1;
export const MAX_RESOURCE_ID = 1_000_000;

// ─────────────────────────────────────────────────────────────────────────────
// Response shapes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Where a piece of content came from, as it crosses the wire.
 *
 * Mirrors `ContentSource` in `src/features/faith/data/faith-result.ts`. It is **required** on every
 * payload below that carries scripture or a translation, because provenance that is optional is
 * provenance that gets dropped by the first caller in a hurry — and unattributed scripture is the one
 * thing this integration exists to prevent.
 */
export type WireSource = {
  /** Always identifies Quran Foundation for live content. */
  readonly name: string;
  /** The edition or resource this text came from, where one applies. */
  readonly edition?: string;
  /** Translator attribution. Required in practice for every translation. */
  readonly attribution?: string;
  /** True only for content served by the approved, licensed source. */
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
  /**
   * Uthmani script, exactly as the upstream sent it.
   *
   * No normalisation, no NFC/NFD pass, no whitespace collapse, no diacritic handling, no
   * transliteration. `normalize.ts` copies this string and does nothing else to it, and
   * `tests/normalize_test.ts` asserts byte equality against fixtures carrying every superscript alif,
   * small waw, madda and pause mark that a naive "clean-up" would have altered.
   */
  readonly arabic: string;
};

export type WireTranslation = {
  readonly surah: number;
  readonly ayah: number;
  readonly translationId: string;
  readonly text: string;
};

export type WirePagination = {
  /** Decimal page number, or `null` at the end. Opaque to the client. */
  readonly nextCursor: string | null;
  readonly total?: number;
};

export type WireEdition = {
  readonly id: string;
  readonly language: string;
  readonly name: string;
  readonly translator: string;
};

export type WireReciter = {
  readonly id: string;
  readonly name: string;
  readonly style?: string;
};

/**
 * The success payload, discriminated by operation.
 *
 * One union rather than seven response types so the client has one parser with one exhaustive switch,
 * and so a new operation is a compile error at every call site rather than an `undefined` at runtime.
 */
export type QuranPayload =
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
    /** Present only when a `translation_id` was requested and the upstream returned one. */
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
 * One verse's recitation audio.
 *
 * ── There is no `text` field here, and there never may be ───────────────────
 * This is *Arabic recitation*. It is not a translation, it is not narration of a translation, and
 * the approved API provides no such thing. A field carrying a transcript or a translated caption
 * would invite a screen to label recitation as something it is not, so the shape offers nowhere to
 * put one — the verse key identifies which ayah is being recited, and the reader already holds that
 * ayah's text and its attributed translation separately.
 */
export type WireRecitation = {
  readonly surah: number;
  readonly ayah: number;
  /** Absolute `https:` URL on an allow-listed host. Validated, never forwarded unchecked. */
  readonly url: string;
  /** Duration in seconds where the upstream reported one. */
  readonly durationSeconds?: number;
};

export type SuccessResponseBody = {
  readonly contract_version: typeof CONTRACT_VERSION;
  readonly request_id: string;
  readonly outcome: 'ok';
  readonly data: QuranPayload;
  /**
   * How long the client may serve this response from its own cache, in milliseconds.
   *
   * The server decides rather than the client, because the developer terms bind NoorLife as a whole
   * and a client-side constant is a constant a client release can change. `MAX_CACHE_AGE_MS` is the
   * ceiling and `responses.ts` clamps to it, so a value above one week is unexpressible.
   */
  readonly cache_max_age_ms: number;
};

/** The closed error set. The client programs against this and only against this. */
export type ErrorCode =
  | 'invalid_request'
  | 'unsupported_contract_version'
  | 'unauthenticated'
  | 'not_found'
  | 'method_not_allowed'
  | 'unsupported_media_type'
  | 'payload_too_large'
  | 'rate_limited'
  | 'timeout'
  | 'upstream_unavailable'
  | 'service_unavailable'
  | 'internal_error';

export type ErrorResponseBody = {
  readonly contract_version: typeof CONTRACT_VERSION;
  readonly request_id: string;
  readonly error: {
    readonly code: ErrorCode;
    readonly message: string;
    /** Present only for `invalid_request`, and a field **name** only — never a value. */
    readonly field?: string;
    /** Present for `rate_limited` when the upstream supplied a usable hint. */
    readonly retry_after_seconds?: number;
  };
};

export type QuranResponseBody = SuccessResponseBody | ErrorResponseBody;

/**
 * The HTTP status each code answers with.
 *
 * `504` for `timeout` is deliberately distinct from `502` for `upstream_unavailable`: "we waited and
 * gave up" and "the vendor failed" need different operational responses, and collapsing them would
 * make a latency problem look like an outage.
 */
export const ERROR_STATUS: Readonly<Record<ErrorCode, number>> = {
  invalid_request: 400,
  unsupported_contract_version: 400,
  unauthenticated: 401,
  not_found: 404,
  method_not_allowed: 405,
  unsupported_media_type: 415,
  payload_too_large: 413,
  rate_limited: 429,
  timeout: 504,
  upstream_unavailable: 502,
  service_unavailable: 503,
  internal_error: 500,
};

/**
 * The user-facing copy for each code.
 *
 * Constants chosen by NoorLife before the failure happened. None of them contains an upstream
 * message, status line, header, stack trace or field value — the surest way to guarantee that a
 * vendor error body never reaches a user is for the user-facing text never to be derived from one.
 */
export const ERROR_MESSAGES: Readonly<Record<ErrorCode, string>> = {
  invalid_request: 'That request could not be read. Please try again.',
  unsupported_contract_version: 'This version of NoorLife is out of date. Please update the app.',
  unauthenticated: 'Please sign in again to continue.',
  not_found: 'That passage could not be found.',
  method_not_allowed: 'That request could not be read. Please try again.',
  unsupported_media_type: 'That request could not be read. Please try again.',
  payload_too_large: 'That request was too large. Please try again.',
  rate_limited: 'Qur’an content is busy right now. Please try again in a moment.',
  timeout: 'Qur’an content took too long to load. Please try again.',
  upstream_unavailable: 'Qur’an content is having trouble right now. Please try again.',
  service_unavailable: 'Qur’an content is unavailable right now. Please try again later.',
  internal_error: 'Something went wrong. Please try again.',
};

// ─────────────────────────────────────────────────────────────────────────────
// Cache policy
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The developer terms' ceiling, restated on the server where it is enforced.
 *
 * The terms forbid caching or storing QF content "longer than 1 week". It is a constant rather than a
 * configuration field because it is a licence term, not a tuning parameter, and `responses.ts` clamps
 * every declared age to it so a wrong number in the table below cannot produce an out-of-terms
 * response. `src/features/faith/data/quran-foundation/quran-foundation.contract.ts` carries the same
 * constant for the client's own enforcement, and a Jest test pins the two to the same value.
 */
export const MAX_CACHE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How long each operation's response may be cached, and why the numbers differ.
 *
 * Scripture gets the full week: the Uthmani text does not change, and a week is the longest a stale
 * copy may persist if an edition is ever withdrawn or corrected. Everything else gets a day, because
 * translations are revisable by their publishers and catalogues change whenever the vendor adds an
 * edition — and a day is short enough that a correction reaches users without a release.
 */
export const OPERATION_CACHE_MAX_AGE_MS: Readonly<Record<QuranOperation, number>> = {
  list_chapters: DAY_MS,
  get_chapter: DAY_MS,
  list_verses: MAX_CACHE_AGE_MS,
  list_verse_translations: DAY_MS,
  /**
   * The Daily Ayah carries a translation alongside the scripture, so it takes the shorter of the two
   * windows rather than the scripture window. A cache entry is only as fresh as its least fresh part.
   */
  get_verse: DAY_MS,
  list_translation_resources: DAY_MS,
  list_recitation_resources: DAY_MS,
  /**
   * A day, and shorter than the scripture window despite the recitation of a verse being as fixed as
   * its text.
   *
   * What is cached here is not audio, it is a set of **URLs**. A CDN path can be rotated, re-signed
   * or retired by the vendor at any time, and a week-old URL that now 404s is a play control that
   * fails for a user who has done nothing wrong. The recitation itself is immutable; the address it
   * lives at is not, and the cache window has to be sized for the thing actually being stored.
   */
  list_verse_recitations: DAY_MS,
};

/**
 * The name this integration attributes content to.
 *
 * One constant so every payload agrees, and so "source metadata identifies Quran Foundation" is a
 * fact a test can assert by equality rather than a convention spread across six construction sites.
 */
export const CONTENT_SOURCE_NAME = 'Quran Foundation Content API';

/** The scripture edition, named explicitly rather than left implied by the absence of a translation. */
export const SCRIPTURE_EDITION = 'Uthmani script (text_uthmani)';
