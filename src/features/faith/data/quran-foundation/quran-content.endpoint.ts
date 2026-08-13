import { isSupabaseConfigured, supabase } from '@/lib/supabase';

import {
  QURAN_CONTENT_CLIENT_TIMEOUT_MS,
  QURAN_CONTENT_CONTRACT_VERSION,
  QURAN_CONTENT_FUNCTION_NAME,
  type QuranContentEndpoint,
  type QuranContentPayload,
  type QuranContentRequest,
  type QuranContentRequestBody,
  type QuranEndpointFailure,
  type QuranEndpointOutcome,
  type WireChapter,
  type WireEdition,
  type WirePagination,
  type WireRecitation,
  type WireReciter,
  type WireSource,
  type WireTranslation,
  type WireVerse,
} from './quran-foundation.contract';

/**
 * The `quran-content` edge-function adapter.
 *
 * ── What this owns ──────────────────────────────────────────────────────────
 * Exactly one thing: turning a `QuranContentRequest` into one authenticated invocation of NoorLife's
 * own `quran-content` function, and turning whatever comes back — a validated payload, NoorLife's
 * error envelope, Supabase's platform error, or nothing at all — into one of the small closed set of
 * states in `quran-foundation.contract.ts`. It builds no UI, holds no cache, and knows nothing about
 * surahs beyond the numbers it is handed.
 *
 * ── Presentation never sees the client, and never sees a response ───────────
 * The Supabase client is imported here and nowhere near a screen, which is the boundary
 * `noor-ai.service.ts` already keeps. Stronger than that: no Supabase object — not the client, not
 * the session, not the invocation result, not a `FunctionsHttpError` and not the `Response` it
 * carries — is reachable from a returned value. Every payload is constructed field by field from
 * validated primitives, so there is no reference for a screen to follow.
 *
 * ── What is never logged ────────────────────────────────────────────────────
 * This module contains no logging at all. An access token, a platform error body and a verse of
 * scripture are each enough to matter on its own, and there is no safe mobile structured-log
 * convention in this repository to opt into. The classification is *returned* to the caller, not
 * printed. A source scan asserts the absence.
 *
 * ── One invocation, and no automatic retry ──────────────────────────────────
 * The server already performs the one retry that can help — a fresh Quran Foundation token after an
 * upstream `401` — and it is the only party that can see the deadline. A second invocation from here
 * would be a second full request against a vendor whose rate limits NoorLife shares across every
 * user. There is exactly one `invoke` call site in this file and a test counts it.
 */

/** The `FunctionsResponse` fields this adapter reads. Deliberately not the SDK's own type. */
type InvocationOutcome = {
  readonly data: unknown;
  readonly error: unknown;
};

/**
 * The narrow view of `supabase.functions` this adapter needs.
 *
 * Declared structurally so the seam a test replaces is the seam production uses, rather than a
 * parallel one. Nothing here widens what the SDK offers.
 */
type FunctionInvoker = {
  invoke(
    functionName: string,
    options: {
      readonly body: QuranContentRequestBody;
      readonly headers: Readonly<Record<string, string>>;
      readonly timeout: number;
    },
  ): Promise<InvocationOutcome>;
};

function failed(failure: QuranEndpointFailure): QuranEndpointOutcome<never> {
  return { kind: 'failed', failure };
}

/** A plain JSON object, narrowed. Arrays and `null` are not the object the contract describes. */
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Response validation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Every field is checked by executing code.
 *
 * A `type Payload = { … }` and a cast would compile and check nothing, which is the standard way a
 * "validated" boundary ends up unvalidated. The server's own `normalize.ts` makes the same point
 * about the vendor's responses; this one is untrusted for the same reason and more so, because the
 * device cannot see who generated it.
 *
 * Everything below is **allow-list copy, not filtering**: each object is rebuilt key by key, so a
 * field this contract does not name cannot reach a screen even if a response carries it, and cannot
 * start reaching one because somebody widened a type.
 */
function readSource(value: unknown): WireSource | null {
  const source = asRecord(value);
  const name = nonEmptyString(source?.name);
  if (source === null || name === null || source.verified !== true) {
    /**
     * `verified: true` is required rather than defaulted.
     *
     * The badge on every Faith screen reads that flag, and content arriving without it is content
     * this build cannot honestly describe. Defaulting it either way would be the client deciding
     * something only the source can say.
     */
    return null;
  }
  const edition = nonEmptyString(source.edition);
  const attribution = nonEmptyString(source.attribution);
  return {
    name,
    ...(edition === null ? {} : { edition }),
    ...(attribution === null ? {} : { attribution }),
    verified: true,
  };
}

function readChapter(value: unknown): WireChapter | null {
  const chapter = asRecord(value);
  if (chapter === null) {
    return null;
  }
  const number = positiveInteger(chapter.number);
  const name = nonEmptyString(chapter.name);
  const arabicName = nonEmptyString(chapter.arabicName);
  const meaning = nonEmptyString(chapter.meaning);
  const ayahCount = positiveInteger(chapter.ayahCount);
  const revelation = chapter.revelation;
  if (
    number === null ||
    number > 114 ||
    name === null ||
    arabicName === null ||
    meaning === null ||
    ayahCount === null ||
    (revelation !== 'meccan' && revelation !== 'medinan')
  ) {
    return null;
  }
  return { number, name, arabicName, meaning, ayahCount, revelation };
}

function readVerse(value: unknown): WireVerse | null {
  const verse = asRecord(value);
  if (verse === null) {
    return null;
  }
  const surah = positiveInteger(verse.surah);
  const ayah = positiveInteger(verse.ayah);
  const arabic = verse.arabic;
  if (surah === null || surah > 114 || ayah === null || typeof arabic !== 'string') {
    return null;
  }
  if (arabic.length === 0) {
    // An ayah rendered as blank is a claim that the ayah is blank.
    return null;
  }
  /**
   * The Arabic is copied and nothing else.
   *
   * No `.normalize()`, no `.trim()`, no `.replace()`. This is the last boundary the text crosses
   * before it reaches a screen, and it is the one where a well-meaning tidy-up would be invisible.
   */
  return { surah, ayah, arabic };
}

function readTranslation(value: unknown): WireTranslation | null {
  const translation = asRecord(value);
  if (translation === null) {
    return null;
  }
  const surah = positiveInteger(translation.surah);
  const ayah = positiveInteger(translation.ayah);
  const translationId = nonEmptyString(translation.translationId);
  const text = nonEmptyString(translation.text);
  if (surah === null || ayah === null || translationId === null || text === null) {
    return null;
  }
  return { surah, ayah, translationId, text };
}

function readPagination(value: unknown): WirePagination | null {
  const pagination = asRecord(value);
  if (pagination === null) {
    return null;
  }
  const next = pagination.nextCursor;
  if (next !== null && (typeof next !== 'string' || next.length === 0)) {
    return null;
  }
  const total = pagination.total;
  if (total !== undefined && (typeof total !== 'number' || !Number.isInteger(total) || total < 0)) {
    return null;
  }
  return { nextCursor: next, ...(total === undefined ? {} : { total }) };
}

function readEdition(value: unknown): WireEdition | null {
  const edition = asRecord(value);
  const id = nonEmptyString(edition?.id);
  const language = nonEmptyString(edition?.language);
  const name = nonEmptyString(edition?.name);
  const translator = nonEmptyString(edition?.translator);
  if (id === null || language === null || name === null || translator === null) {
    return null;
  }
  return { id, language, name, translator };
}

function readReciter(value: unknown): WireReciter | null {
  const reciter = asRecord(value);
  const id = nonEmptyString(reciter?.id);
  const name = nonEmptyString(reciter?.name);
  if (id === null || name === null) {
    return null;
  }
  const style = nonEmptyString(reciter?.style);
  return { id, name, ...(style === null ? {} : { style }) };
}

/** Maps a list, failing the whole list if any entry fails. Partial scripture is not scripture. */
function readAll<T>(value: unknown, read: (entry: unknown) => T | null): readonly T[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const mapped: T[] = [];
  for (const entry of value) {
    const item = read(entry);
    if (item === null) {
      return null;
    }
    mapped.push(item);
  }
  return mapped;
}

/**
 * Validates the payload against the operation that asked for it.
 *
 * The operation is checked rather than trusted, so a response for a different read cannot be
 * rendered as the answer to this one.
 */
function readPayload(
  operation: QuranContentRequest['operation'],
  value: unknown,
): QuranContentPayload | null {
  const payload = asRecord(value);
  if (payload === null || payload.operation !== operation) {
    return null;
  }

  switch (operation) {
    case 'list_chapters': {
      const chapters = readAll(payload.chapters, readChapter);
      return chapters === null || chapters.length === 0 ? null : { operation, chapters };
    }

    case 'get_chapter': {
      const chapter = readChapter(payload.chapter);
      return chapter === null ? null : { operation, chapter };
    }

    case 'list_verses': {
      const verses = readAll(payload.verses, readVerse);
      const pagination = readPagination(payload.pagination);
      const source = readSource(payload.source);
      return verses === null || pagination === null || source === null
        ? null
        : { operation, verses, pagination, source };
    }

    case 'list_verse_translations': {
      const translations = readAll(payload.translations, readTranslation);
      const pagination = readPagination(payload.pagination);
      const source = readSource(payload.source);
      return translations === null || pagination === null || source === null
        ? null
        : { operation, translations, pagination, source };
    }

    case 'get_verse': {
      const verse = readVerse(payload.verse);
      const source = readSource(payload.source);
      if (verse === null || source === null) {
        return null;
      }
      if (payload.translation === undefined) {
        return { operation, verse, source };
      }
      const translation = readTranslation(payload.translation);
      const translationSource = readSource(payload.translationSource);
      /**
       * A translation without its own source is refused rather than shown unattributed. The two
       * travel as separate fields with separate provenance precisely so this check is possible.
       */
      return translation === null || translationSource === null
        ? null
        : { operation, verse, source, translation, translationSource };
    }

    case 'list_translation_resources': {
      const editions = readAll(payload.editions, readEdition);
      return editions === null ? null : { operation, editions };
    }

    case 'list_recitation_resources': {
      const reciters = readAll(payload.reciters, readReciter);
      return reciters === null ? null : { operation, reciters };
    }

    case 'list_verse_recitations': {
      /**
       * Mapped rather than `readAll`, which is the one place this file relaxes "partial is not
       * valid" — and the relaxation is deliberate.
       *
       * Everywhere else a single bad entry fails the whole list, because a page of scripture missing
       * a verse is a false statement about the text. A page of *audio* missing a verse is a play
       * control that is not offered for that verse, which is exactly what the reader should show
       * when a URL did not survive validation. Failing the whole page would take audio away from
       * nineteen verses because the twentieth had a bad URL.
       */
      if (!Array.isArray(payload.recitations)) {
        return null;
      }
      const pagination = readPagination(payload.pagination);
      if (pagination === null) {
        return null;
      }
      const recitations = payload.recitations
        .map(readRecitation)
        .filter((entry): entry is WireRecitation => entry !== null);
      return { operation, recitations, pagination };
    }
  }
}

/**
 * One recitation entry, with its URL checked for scheme.
 *
 * ── What is checked here, and what is deliberately not ──────────────────────
 * The **scheme**, by prefix: `https://` and nothing else, so an `http:`, `data:` or `file:` URL
 * cannot reach the platform player even if one somehow survived the server.
 *
 * The **host** is not checked here, and that is a decision rather than an oversight. The server's
 * allow-list is the control, and mirroring it would mean putting Quran Foundation's audio hostnames
 * into the mobile bundle — which an APK exposes to anyone who unzips it, and which
 * `quran-foundation-contract.test.ts` forbids outright for exactly that reason. A redundant check
 * against a response that already arrived over an authenticated channel from NoorLife's own edge
 * function is not worth surrendering an invariant that is enforced by a source scan.
 *
 * The check is a prefix comparison rather than `new URL(...)` for the same reason: constructing a URL
 * in Faith mobile source is itself scanned for, because URL construction is the first half of making
 * a request.
 */
function readRecitation(value: unknown): WireRecitation | null {
  const entry = asRecord(value);
  const surah = positiveInteger(entry?.surah);
  const ayah = positiveInteger(entry?.ayah);
  const url = nonEmptyString(entry?.url);
  if (surah === null || ayah === null || url === null) {
    return null;
  }
  if (!url.startsWith('https://')) {
    return null;
  }

  const duration = positiveInteger(entry?.durationSeconds);
  return {
    surah,
    ayah,
    url,
    ...(duration === null ? {} : { durationSeconds: duration }),
  };
}

/**
 * Validates a 2xx body and returns the payload plus the server's cache instruction.
 *
 * `cache_max_age_ms` is read from the response rather than decided here, because the Quran Foundation
 * developer terms bind NoorLife as a whole and a client-side constant is a constant a client release
 * can change. A missing or nonsensical value becomes zero, which the cache reads as "do not store" —
 * failing toward re-fetching, where the cost is a request rather than a stale copy nobody can correct.
 */
function parseSuccessBody(
  operation: QuranContentRequest['operation'],
  data: unknown,
): QuranEndpointOutcome<QuranContentPayload> {
  const body = asRecord(data);
  if (body === null || body.contract_version !== QURAN_CONTENT_CONTRACT_VERSION) {
    return failed('invalid-response');
  }
  if (typeof body.request_id !== 'string' || body.request_id.length === 0) {
    // Guaranteed on every response the handler produces, and a 2xx can only come from the handler.
    // Validated and then dropped: it is not carried onto any returned value.
    return failed('invalid-response');
  }
  if (body.outcome !== 'ok') {
    return failed('invalid-response');
  }

  const payload = readPayload(operation, body.data);
  if (payload === null) {
    return failed('invalid-response');
  }

  const declared = body.cache_max_age_ms;
  const cacheMaxAgeMs =
    typeof declared === 'number' && Number.isFinite(declared) && declared > 0 ? declared : 0;

  return { kind: 'ok', data: payload, cacheMaxAgeMs };
}

// ─────────────────────────────────────────────────────────────────────────────
// Failure classification
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The server's closed error set, mapped to the client-facing states.
 *
 * Reached only when the response carried NoorLife's envelope, so the `code` is NoorLife's own word
 * and not a platform or vendor one. The client programs against this set and only against it.
 *
 * Two mappings are worth their justification:
 *
 *   • `unsupported_contract_version` joins `invalid-response` rather than getting a state of its own.
 *     It means this build is out of date, which the user fixes by updating — but as a *result* it is
 *     still "this app and this server disagree", and inventing a state for a condition no shipped
 *     build can currently produce would be inventing copy.
 *   • `service_unavailable` is **not** mapped to `not-configured`, even though a missing vendor
 *     credential is one of the things that produces it. The server deliberately does not tell the
 *     client which of its own faults occurred, and a client that guessed would tell users "this build
 *     is misconfigured" for an ordinary outage.
 */
function fromServerErrorCode(code: string): QuranEndpointFailure {
  switch (code) {
    case 'unauthenticated':
      return 'authentication-required';
    case 'not_found':
      return 'not-found';
    case 'rate_limited':
      return 'rate-limited';
    case 'timeout':
      return 'timed-out';
    case 'upstream_unavailable':
    case 'service_unavailable':
      return 'unavailable';
    case 'invalid_request':
    case 'unsupported_contract_version':
    case 'method_not_allowed':
    case 'unsupported_media_type':
    case 'payload_too_large':
    case 'internal_error':
      /**
       * Every one of these means this build sent something the server would not accept, or the server
       * failed in a way the user cannot act on. None is worth its own screen state, and a request the
       * app itself constructed being rejected is a NoorLife defect rather than a user-facing
       * condition — so it lands on the state that renders as a generic failure.
       */
      return 'invalid-response';
    default:
      // A code this build does not know. Not guessed at, and not rendered.
      return 'unavailable';
  }
}

/**
 * The gateway rule — mapping on HTTP status alone, because there is nothing else to trust.
 *
 * The platform's own `code` is not reliably typed, and the hosted documentation and the local runtime
 * disagree about it, so nothing here reads a platform `code` or `message`.
 */
function fromGatewayStatus(status: number): QuranEndpointFailure {
  if (status === 401) {
    return 'authentication-required';
  }
  if (status === 408 || status === 504) {
    return 'timed-out';
  }
  if (status === 429) {
    return 'rate-limited';
  }
  if (status === 404 || status === 546 || status >= 500) {
    // With the adapter always naming a deployed function, a `404` means the deployment is not
    // reachable. That is service unavailability, not a bad request, and not the user's doing.
    return 'unavailable';
  }
  if (status === 400 || status === 413 || status === 415) {
    return 'invalid-response';
  }
  return 'unavailable';
}

/**
 * Reads the body of a non-2xx response and classifies it, without letting any of it escape.
 *
 * The producer is decided by **shape, not status**: a body carrying a string `request_id` and an
 * `error.code` string is NoorLife's envelope and is mapped on the code; anything else — the
 * platform's shape, an HTML error page, an empty body, a stream that fails mid-read — is mapped on
 * the status alone.
 *
 * Nothing read here is returned, stored, concatenated or re-thrown. The body is consumed inside this
 * function and only a state word leaves it.
 */
async function classifyErrorResponse(response: Response): Promise<QuranEndpointFailure> {
  const status = typeof response.status === 'number' ? response.status : 0;

  let body: Record<string, unknown> | null = null;
  try {
    body = asRecord(await response.json());
  } catch {
    // Unparseable, already consumed, or not JSON at all. No detail is captured: an exception raised
    // by reading an error body is made of the error body.
    body = null;
  }

  if (body !== null && typeof body.request_id === 'string' && body.request_id.length > 0) {
    const error = asRecord(body.error);
    if (error !== null && typeof error.code === 'string') {
      return fromServerErrorCode(error.code);
    }
  }

  return fromGatewayStatus(status);
}

/** The `Response` a `FunctionsHttpError` carries, when it carries one. */
function responseOf(error: unknown): Response | null {
  if (typeof error !== 'object' || error === null || !('context' in error)) {
    return null;
  }
  const context = (error as { context: unknown }).context;
  return typeof context === 'object' &&
    context !== null &&
    'status' in context &&
    typeof (context as { json?: unknown }).json === 'function'
    ? (context as Response)
    : null;
}

/** Whether the thrown value is an abort, in either of the two spellings a runtime may use. */
function isAbortLike(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as { name?: unknown; code?: unknown };
  return candidate.name === 'AbortError' || candidate.code === 20;
}

/**
 * The two transport failures this application already recognises by message.
 *
 * `account-security.service.ts` and `noor-ai.service.ts` both match exactly these two strings for
 * their offline state, because React Native's `fetch` reports one and the web's the other, and
 * neither carries a status or a code to match on instead. Reusing the same pair keeps one definition
 * of "offline" in the app rather than three that can disagree.
 */
function isRecognisableNetworkFailure(value: unknown): boolean {
  const message =
    typeof value === 'object' && value !== null && 'message' in value
      ? String((value as { message: unknown }).message).toLowerCase()
      : '';
  return message.includes('network request failed') || message.includes('failed to fetch');
}

/**
 * Classifies whatever `invoke` reported instead of a body.
 *
 * ── Why unrecognised failures are not "offline" ─────────────────────────────
 * Classifying every invocation exception as "no internet" is a fabricated diagnosis, and a confident
 * wrong state is worse for a user than an honest generic one — it would also make the app serve a
 * stale cached ayah on the strength of a guess. So a failure with no evidence of its cause gets none
 * invented for it.
 */
function classifyThrown(error: unknown): QuranEndpointFailure {
  const cause =
    typeof error === 'object' && error !== null && 'context' in error
      ? (error as { context: unknown }).context
      : error;

  if (isAbortLike(error) || isAbortLike(cause)) {
    return 'timed-out';
  }
  if (isRecognisableNetworkFailure(error) || isRecognisableNetworkFailure(cause)) {
    return 'offline';
  }
  return 'unavailable';
}

// ─────────────────────────────────────────────────────────────────────────────
// The endpoint
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds the production endpoint.
 *
 * ── The order of operations is part of the guarantee ────────────────────────
 * Configuration, then session, then **one** invocation. Each of the first two can only return, never
 * invoke, which is what makes "an unauthenticated request results in zero invocations" a property of
 * the shape of this function rather than a claim about it.
 *
 * ── Authentication ──────────────────────────────────────────────────────────
 * The session comes from `supabase.auth.getSession()`, which is how every other service in this
 * application reads one, and the SDK owns whatever refresh that implies. No refresh is triggered
 * here, no sign-in is attempted, and a missing session is answered locally with
 * `authentication-required` rather than by invoking and letting the gateway say so.
 *
 * The access token is placed on `Authorization` explicitly, at invoke level: the publishable key must
 * be sent on the `apikey` header **only**, because if it also arrives as `Authorization: Bearer` the
 * platform tries to parse it as a JWT and rejects the request — and a correctly authenticated user
 * would then see a session error caused entirely by client header construction. Invoke-level headers
 * take priority over the client's, so this pins the header to the user's token whatever the SDK's own
 * auth state is. The token is read into a local, used once, and never logged, stored, returned or
 * attached to any result.
 */
export function createQuranContentEndpoint(): QuranContentEndpoint {
  return {
    async request(body: QuranContentRequest): Promise<QuranEndpointOutcome<QuranContentPayload>> {
      if (!isSupabaseConfigured || supabase === null) {
        return failed('not-configured');
      }
      const client = supabase;

      const { data: sessionData, error: sessionError } = await client.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      if (sessionError !== null || typeof accessToken !== 'string' || accessToken.length === 0) {
        return failed('authentication-required');
      }

      /**
       * The one invocation. There is no second call site in this file, and no loop around this one.
       *
       * The body is built by naming both keys rather than spreading a wider object: the server
       * rejects unknown fields by name, and the failure mode that guards against is a future change
       * widening a source object and a spread quietly carrying a new field onto the wire.
       */
      const { data, error } = await (client.functions as unknown as FunctionInvoker).invoke(
        QURAN_CONTENT_FUNCTION_NAME,
        {
          body: { contract_version: QURAN_CONTENT_CONTRACT_VERSION, ...body },
          headers: { Authorization: `Bearer ${accessToken}` },
          timeout: QURAN_CONTENT_CLIENT_TIMEOUT_MS,
        },
      );

      if (error !== null && error !== undefined) {
        const response = responseOf(error);
        if (response !== null) {
          return failed(await classifyErrorResponse(response));
        }
        return failed(classifyThrown(error));
      }

      return parseSuccessBody(body.operation, data);
    },
  };
}
