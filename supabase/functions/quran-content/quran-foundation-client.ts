import type {
  CatalogueOutcome,
  Clock,
  QuranQuery,
  QuranUpstream,
  TokenSource,
  TranslationAttribution,
  UpstreamMalformedReason,
  UpstreamOutcome,
  UpstreamResult,
} from './ports.ts';
import {
  CANONICAL_SYNC_FILTER,
  MAX_SYNC_CURSOR_LENGTH,
  SYNC_RESOURCES,
  type SyncResourceGroup,
} from './contract.ts';
import { createTokenStore } from './token-store.ts';

/**
 * The Quran Foundation Content API adapter — the one module that reaches the vendor's content host.
 *
 * ── Documentation this file is written against ───────────────────────────────
 * Every path, parameter and response field below was read from the official OpenAPI document
 * published at `github.com/quran/qf-api-docs` (`openAPI/content/v4.json`) and the quickstart at
 * `api-docs.quran.foundation/docs/quickstart/`, on 2026-08-10. What each fixed:
 *
 *   • The production server entry — `https://apis.quran.foundation/content/api/v4` — which is where
 *     the origin and the prefix constants below come from, rather than from a guess about how the
 *     quickstart's `GET /content/api/v4/chapters` decomposes.
 *   • `securitySchemes`: two `apiKey`-in-header schemes, `x-auth-token` and `x-client-id`. Both are
 *     required on every content request; there is no `Authorization` header on this hop.
 *   • `GET /chapters`, `GET /chapters/{id}` (id bounded 1–114), `GET /verses/by_chapter/{n}`,
 *     `GET /verses/by_key/{verse_key}`, `GET /translations/{resource_id}/by_chapter/{n}`,
 *     `GET /recitations/{resource_id}/by_chapter/{n}`, `GET /resources/translations` and
 *     `GET /resources/recitations` — the eight routes this function is allowed to reach.
 *   • The `translation` component requires only `resource_id` and `text`. `resource_name` is
 *     **optional**, and the live API omits it — which is why attribution is resolved from
 *     `/resources/translations` rather than from the entry. See `resolveTranslationSource`.
 *   • `fields` on the verse routes: "Use `fields=text_uthmani,text_indopak` to include Arabic text."
 *     The Arabic is **not** returned by default, which is why every verse route below asks for it
 *     explicitly.
 *   • `per_page`: "maximum: 50", "you can get maximum 50 records", default 10.
 *   • The `pagination` object: `per_page`, `current_page`, `next_page` (nullable), `total_pages`,
 *     `total_records`.
 *
 * ── Approved scope, and what is therefore absent ─────────────────────────────
 * Content only. There is no `/search` route in the table below, no OAuth user endpoint, no bookmark,
 * no note, no reading session, no tafsir and no Content Sync call — and there is no code path that
 * could construct one, because `ROUTES` is a total function over a closed union and nothing else in
 * this file builds a path.
 *
 * ── The credentials ──────────────────────────────────────────────────────────
 * The client secret never appears here at all: it is handed to `token-store.ts`, which is the only
 * module that writes it anywhere. The client id is held in one closure variable and written to one
 * header. Neither is logged — there is no logger in this module — and no thrown message can carry
 * either, because this module throws nothing.
 *
 * ── One retry, and it is structural ──────────────────────────────────────────
 * `read` calls `attempt` exactly twice in the worst case: once with whatever token is cached, and —
 * only if the vendor answered `401` or `403` — once more with a token freshly exchanged for the
 * purpose. A second `401` is terminal. There is no loop in this file, no recursion, and no counter
 * that could be raised, so "at most one retry" is a property of the shape of the function rather than
 * a bound something enforces.
 */

/**
 * The fixed production origin. Not configurable, by construction.
 *
 * Same reasoning as the OAuth origin: anything able to set an environment variable on this function
 * could otherwise point content requests — which carry the access token and the client id — at a host
 * of its choosing. The pre-production host is named nowhere in this repository.
 */
export const QF_API_ORIGIN = 'https://apis.quran.foundation';

/** The versioned content prefix, from the OpenAPI document's production server entry. */
export const QF_CONTENT_PREFIX = '/content/api/v4';

/**
 * The prefix Quran Foundation's Content Sync documentation uses in its **relative** examples.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The defect this constant fixes ──────────────────────────────────────────
 * The Content Sync tutorial and the `resources-sync` / `resources-snapshot` reference pages write the
 * URLs a response carries in exactly this form:
 *
 *     /api/v4/resources/sync?cursor=...
 *     /api/v4/resources/snapshots/recitations/3
 *
 * They are **root-relative**, and they omit the `/content` mount point that the production server
 * entry carries. A root-relative reference ignores the path of whatever base it is resolved against,
 * so resolving one against `https://apis.quran.foundation/content/api/v4/` produced
 * `https://apis.quran.foundation/api/v4/resources/sync` — right host, wrong path — and
 * `approvedSyncUrl` then refused it.
 *
 * The consequence was not a refused URL; it was a refused **page**. `normalizeSync` requires a usable
 * cursor whenever `has_more` is true, so a bootstrap run answered `502 upstream_unavailable` behind an
 * `upstream_outcome: ok` and a `normalize_reason: shape`. Refusing was the correct behaviour for a
 * page whose continuation could not be read — advancing a sync token over undelivered mutations loses
 * them permanently — so the fault was entirely in what counted as readable.
 *
 * ── Why this is a second accepted prefix rather than a looser check ─────────
 * The alternative is to compare only the tail of the path, or to resolve against the origin root and
 * accept whatever comes back. Both would accept `/content/api/v4/../../anything/resources/sync` and
 * every other path that happens to end the right way. This is an exact second literal, matched in
 * full, and only for a reference that carries no scheme and no authority of its own — so the set of
 * accepted addresses grows by exactly the one form the vendor documents.
 * ═══════════════════════════════════════════════════════════════════════════
 */
export const QF_DOCUMENTED_PREFIX = '/api/v4';

/**
 * Whether a URL the vendor put in a response body is one NoorLife would have built itself.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Content Sync is the first part of this integration where the **response** contains URLs that a
 * naive client would follow: `next_page_url` for pagination and `snapshot_url` for a rebuild. The
 * vendor’s own guidance is to follow `next_page_url` rather than build the cursor, which is exactly
 * the shape of instruction that turns a response body into a request target.
 *
 * NoorLife does not follow either one. It **validates** them and then throws the address away:
 *
 *   • from `next_page_url` it lifts the `cursor` parameter and rebuilds the request from its own
 *     constants, so pagination is preserved exactly without a URL ever being followed;
 *   • from `snapshot_url` it takes only the fact that a snapshot is required, and builds the
 *     snapshot path from the permission table.
 *
 * The check below therefore guards against a *malformed or hostile feed*, not against NoorLife’s
 * own routing: a page whose `next_page_url` points somewhere unexpected is refused rather than
 * silently treated as the end of the run, because silently ending a sync run early would leave a
 * token advanced past mutations that were never applied.
 *
 * Absolute and relative forms are both accepted, because the vendor documents relative paths and
 * returns absolute ones. A relative form resolves against the fixed origin, so it has nowhere to
 * escape to; an absolute form is compared against the same origin and prefix.
 *
 * ── The three approved forms, and nothing else ───────────────────────────────
 * Exactly three spellings of one address are accepted, and every one of them names the same path on
 * the same fixed origin:
 *
 *   1. the vendor's documented root-relative form, `/api/v4{suffix}`, which omits the `/content`
 *      mount point — see `QF_DOCUMENTED_PREFIX` for the failure this cost;
 *   2. a base-relative form with no leading slash, e.g. `resources/sync?cursor=…`, which resolves
 *      inside `/content/api/v4/` and is what the existing tests already covered;
 *   3. the exact absolute form, `https://apis.quran.foundation/content/api/v4{suffix}`.
 *
 * A reference that declares its own scheme is held to (3) alone: it has said where it wants to go, so
 * it must have said the whole approved address. Only a reference with no scheme and no authority —
 * one that has *no* opinion about the host — may be read under (1) or (2), because for those the host
 * comes from this module's own constant and not from the response.
 * ═══════════════════════════════════════════════════════════════════════════
 */
function approvedSyncUrl(raw: unknown, suffix: string): URL | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_SYNC_URL_LENGTH) {
    return null;
  }
  /**
   * Two rejections that happen before parsing, because parsing is where they would be laundered.
   *
   * A leading `//` is a protocol-relative reference: it names a **host**, not a path, so it can never
   * be one of the relative forms above however harmless the rest of it looks. And a backslash is
   * rewritten to a forward slash by the URL parser for special schemes, which makes `/\evil.example/x`
   * a host and not a path — refusing the character outright is cheaper than reasoning about which
   * position it occupies, and no address the vendor documents contains one.
   */
  if (raw.startsWith('//') || raw.includes('\\')) {
    return null;
  }
  /** Whether the reference names its own scheme, and is therefore held to the absolute form alone. */
  const declaresScheme = /^[A-Za-z][A-Za-z0-9+.-]*:/.test(raw);

  let parsed: URL;
  try {
    parsed = new URL(raw, `${QF_API_ORIGIN}${QF_CONTENT_PREFIX}/`);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || parsed.origin !== QF_API_ORIGIN) {
    return null;
  }
  if (parsed.username !== '' || parsed.password !== '') {
    return null;
  }
  if (parsed.pathname === `${QF_CONTENT_PREFIX}${suffix}`) {
    return parsed;
  }
  /*
    The documented root-relative form, accepted only for a reference that named no scheme of its own.
    `pathname` is the parser's normalised output, so `..` segments have already been resolved and
    cannot leave a path that matches this literal in full.
  */
  return !declaresScheme && parsed.pathname === `${QF_DOCUMENTED_PREFIX}${suffix}` ? parsed : null;
}

/** A vendor URL is bounded before it is parsed; an unbounded string is a memory risk, not a route. */
const MAX_SYNC_URL_LENGTH = 2048;

/**
 * The cursor inside a `next_page_url`, or `null` when the URL is not one NoorLife recognises.
 *
 * Returning the cursor rather than the URL is the whole point: the client receives a value it
 * cannot turn into a request, and the next page is built from this module’s constants.
 */
export function cursorFromNextPageUrl(raw: unknown): string | null {
  const url = approvedSyncUrl(raw, '/resources/sync');
  if (url === null) {
    return null;
  }
  const cursor = url.searchParams.get('cursor');
  return cursor === null || cursor.length === 0 || cursor.length > MAX_SYNC_CURSOR_LENGTH
    ? null
    : cursor;
}

/**
 * Whether a `snapshot_url` names a snapshot of a resource NoorLife holds permission for.
 *
 * Both halves matter. A URL on the right host but for `translations:20` is refused, because the
 * permission is per resource and a snapshot NoorLife may not hold is not made acceptable by
 * arriving over an approved channel.
 */
export function isApprovedSnapshotUrl(raw: unknown, group: SyncResourceGroup): boolean {
  return approvedSyncUrl(raw, `/resources/snapshots/${group}/${SYNC_RESOURCES[group]}`) !== null;
}

/**
 * The response body cap.
 *
 * Fifty verses with a translation is a few tens of kilobytes, so a megabyte is generous by an order
 * of magnitude. It is not a policy about content size — it is a bound on an unbounded read, which is
 * a memory risk against Supabase's function limit and the failure mode of a proxy returning an HTML
 * error page or a stream that never terminates.
 *
 * ── Unchanged, and that is the point ────────────────────────────────────────
 * Two live diagnostic runs later this number is exactly what it always was. It is the bound for every
 * ordinary Content API operation and for `/resources/sync`, whose pages are bounded by
 * `MAX_SYNC_PER_PAGE` and come nowhere near it. Only one route was ever the problem, and only that one
 * route has its own bound — see `MAX_SNAPSHOT_RESPONSE_BYTES`. Widening this constant would have
 * relaxed the memory bound on eight routes to fix a fault on the ninth.
 */
export const MAX_RESPONSE_BYTES = 1_048_576;

/**
 * The read bound for `get_content_snapshot`, and for nothing else.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Eight mebibytes, and where the number came from ─────────────────────────
 * Measured, not estimated. Two authenticated diagnostic runs against the deployed function reported
 * the size of each approved snapshot as a doubling band:
 *
 *   • `recitations:3`   — `over_4_to_8_mib`
 *   • `translations:85` — `over_2_to_4_mib`
 *
 * Eight mebibytes is the upper bound of the larger observed band. It is therefore the **smallest**
 * limit that admits both measured snapshots, and it is that exact figure rather than that figure plus
 * a safety margin: a margin would be an unmeasured number bolted onto a measured one, which is how the
 * estimate this investigation twice refused to make gets in through the back door. If a future
 * snapshot outgrows it, the honest answer is another measurement and another deliberate change — not
 * headroom nobody costed.
 *
 * ── What this does not do ───────────────────────────────────────────────────
 * It does not defer the bound, drain past it, or treat it as advisory. A snapshot response is read up
 * to this many bytes and refused the moment it passes them, on exactly the same terms
 * `MAX_RESPONSE_BYTES` refuses an ordinary route — same `streamed_too_large`, same cancellation, same
 * generic `502`. The only difference between the two routes is the number.
 *
 * Retention is bounded by the same figure, so the worst case this function will hold is one snapshot
 * of eight mebibytes rather than an unbounded read. The request budget still applies on top: the
 * upstream `AbortSignal` remains the outer limit whatever the byte bound says.
 * ═══════════════════════════════════════════════════════════════════════════
 */
export const MAX_SNAPSHOT_RESPONSE_BYTES = 8_388_608;

/**
 * The largest `Retry-After` this adapter will pass on.
 *
 * The value reaches the client, which shows the user how long to wait. An unbounded number from a
 * third party therefore decides what NoorLife tells its users, so it is validated as delta-seconds
 * and capped. Beyond the cap the honest answer is "no usable hint" rather than a number nobody
 * checked. The HTTP-date form is not honoured: parsing it means trusting a third party's clock
 * against ours, for a value that is only ever advice.
 */
export const MAX_RETRY_AFTER_SECONDS = 300;

/**
 * The response language for names and catalogue entries.
 *
 * A fixed value rather than a request parameter, and that is a scope decision rather than an
 * oversight: the app's interface is English, so a caller-chosen language would be a caller-controlled
 * string on the wire for a UI that cannot render the result. It affects **only** translated names —
 * chapter meanings and author names — and touches no scripture and no translation text.
 */
const RESPONSE_LANGUAGE = 'en';

/**
 * Word-by-word data, refused explicitly rather than left to the default.
 *
 * The default is already `false`, and it is sent anyway because word-level data includes
 * transliteration — and transliteration arriving alongside scripture is precisely the payload that
 * must never be able to stand in for it. Asking for it not to be sent means it cannot be present to
 * be confused, and the request records that intent where a reviewer sees it.
 */
const WORDS = 'false';

/**
 * The verse fields requested.
 *
 * `text_uthmani` and nothing else. Not `text_imlaei`, not `text_indopak`, not `text_uthmani_simple`,
 * and not the `code_v1`/`code_v2` glyph fields: one Arabic field means there is exactly one string
 * that can be rendered as scripture, which is the same guarantee `AyahText.arabic` gives in the
 * domain model — "there is no second field a transform could write into".
 */
const VERSE_FIELDS = 'text_uthmani';

/**
 * The optional translation fields this function depends on, named rather than assumed.
 *
 * The vendor's `translation` component requires only `resource_id` and `text`; everything else is
 * optional and is **omitted by default**. `verse_key` is in that optional set, and it is the field
 * that binds a translation to its ayah — so not asking for it produced a `200` full of rows the
 * normaliser could not place, and a `502` for the user. See `routeFor` for the full account.
 *
 * Exported so a test can assert the exact string reaches the wire rather than re-deriving it, which
 * would let the two drift apart and quietly reintroduce the defect.
 */
export const TRANSLATION_FIELDS = 'verse_key,resource_name,language_name';

type Route = {
  /** Built only from integers and literals. No caller string reaches a path segment. */
  readonly path: string;
  readonly query: Readonly<Record<string, string>>;
  /**
   * This route's own read bound, when it needs one. Absent means `MAX_RESPONSE_BYTES`.
   *
   * Set by exactly one entry in the table below and absent on all eight others, so the larger bound
   * is reachable from one route definition and no other. Putting it here rather than passing the
   * operation down to the reader keeps the route table the single place an operation's outbound
   * behaviour is decided, which is the same property that makes `routeFor` the only place a path is
   * built.
   */
  readonly maxResponseBytes?: number;
};

/**
 * The operation table — the whole of this function's reach, in one readable place.
 *
 * A total function over `QuranQuery`, so adding an operation to the union is a compile error here
 * until somebody writes the route for it, and removing one makes its route unreachable. Every path
 * segment is either a literal or an integer that `request-schema.ts` has already bounded: there is no
 * template in this file into which a caller-supplied string could be interpolated, which is what
 * makes path traversal and arbitrary proxying unexpressible rather than merely refused.
 */
export function routeFor(query: QuranQuery): Route {
  switch (query.operation) {
    case 'list_chapters':
      return { path: '/chapters', query: { language: RESPONSE_LANGUAGE } };

    case 'get_chapter':
      return { path: `/chapters/${query.surah}`, query: { language: RESPONSE_LANGUAGE } };

    case 'list_verses':
      return {
        path: `/verses/by_chapter/${query.surah}`,
        query: {
          language: RESPONSE_LANGUAGE,
          fields: VERSE_FIELDS,
          words: WORDS,
          page: String(query.page),
          per_page: String(query.perPage),
        },
      };

    case 'list_verse_translations':
      /**
       * Per-verse translations for one surah, with the optional fields asked for **explicitly**.
       *
       * ═══════════════════════════════════════════════════════════════════════
       * ── The defect this parameter fixes ─────────────────────────────────────
       * This route was requested with `page` and `per_page` only, and the vendor answered `200`
       * with rows carrying `resource_id` and `text` and **no `verse_key`**. `readTranslationEntry`
       * requires one — it is how a translation is bound to the ayah it belongs to — so every row
       * was refused and the whole page became `502 upstream_unavailable` behind an
       * `upstream_outcome: ok`.
       *
       * The deployed diagnostics named it exactly: `normalize_reason: verse_key`,
       * `catalogue_outcome: fetched_hit`, `upstream_attempts: 1`. The catalogue was fine, the
       * attribution was fine, the vendor was fine — the *request* was short a parameter.
       *
       * ── Why the fix is a request parameter and not a looser check ───────────
       * The obvious alternative is to stop requiring `verse_key` and take the ayah number from the
       * row's position in the array. That would be a guess wearing a citation's clothes: the page
       * offset would have to be trusted, a reordered or short page would silently misalign every
       * verse after it, and the reader would print somebody's translation of ayah 5 underneath the
       * Arabic of ayah 4. There is no error state for that — it just looks right.
       *
       * So the binding stays mandatory and the request supplies what it needs. `verse_key`
       * validation in `normalize.ts` is unchanged, and a key naming a different surah is still
       * refused.
       *
       * ── Why exactly these three, and nothing else ───────────────────────────
       *   • `verse_key`     - the ayah binding. The reason this parameter exists.
       *   • `resource_name` - the edition label. Optional upstream and usually absent, which is why
       *                       attribution resolves from the catalogue; asked for so it can be
       *                       cross-checked and used as a last resort when the vendor does send it.
       *   • `language_name` - the edition's language, as the contract's floor for this route.
       *
       * Nothing further. Every additional field is a larger response body to bound and read for no
       * screen that renders it — the same reasoning that keeps `fields=text_uthmani` alone on the
       * verse routes.
       * ═══════════════════════════════════════════════════════════════════════
       */
      return {
        path: `/translations/${query.translationId}/by_chapter/${query.surah}`,
        query: {
          fields: TRANSLATION_FIELDS,
          page: String(query.page),
          per_page: String(query.perPage),
        },
      };

    case 'get_verse':
      return {
        // `verse_key` is the vendor's `surah:ayah` form, built from two bounded integers.
        path: `/verses/by_key/${query.surah}:${query.ayah}`,
        query: {
          language: RESPONSE_LANGUAGE,
          fields: VERSE_FIELDS,
          words: WORDS,
          ...(query.translationId === null ? {} : { translations: String(query.translationId) }),
        },
      };

    case 'list_translation_resources':
      return { path: '/resources/translations', query: { language: RESPONSE_LANGUAGE } };

    case 'list_recitation_resources':
      return { path: '/resources/recitations', query: { language: RESPONSE_LANGUAGE } };

    case 'list_verse_recitations':
      /**
       * Per-verse recitation audio for one surah.
       *
       * By chapter rather than by ayah: the reader shows a page of verses at a time, and one request
       * per verse would be twenty round trips per page against a vendor whose rate limits NoorLife
       * shares across every user. Both path segments are integers `request-schema.ts` has already
       * bounded.
       */
      return {
        path: `/recitations/${query.recitationId}/by_chapter/${query.surah}`,
        query: { page: String(query.page), per_page: String(query.perPage) },
      };

    /**
     * One page of the change feed for NoorLife’s permitted resources.
     *
     * ── Every part of this request is a server value ────────────────────
     * The path is a literal. The filter is `CANONICAL_SYNC_FILTER`, derived from the permission
     * table. `bootstrap` is set from the *absence* of a token rather than from a client flag, so
     * a device cannot ask for a bootstrap it was not entitled to and cannot skip one it needs.
     * The only caller-supplied values are two opaque strings the vendor issued in the first
     * place, and `request-schema.ts` has already bounded and character-checked both.
     */
    case 'sync_content_resources':
      return {
        path: '/resources/sync',
        query: {
          resources: CANONICAL_SYNC_FILTER,
          per_page: String(query.perPage),
          ...(query.syncToken === null ? { bootstrap: 'true' } : { sync_token: query.syncToken }),
          ...(query.cursor === null ? {} : { cursor: query.cursor }),
        },
      };

    /**
     * The full contents of one permitted resource.
     *
     * Built from the group the client named and the id **this module looks up**, never from the
     * `snapshot_url` the vendor returned. The vendor’s URL is still validated — see
     * `isApprovedSnapshotUrl` — but it is used as a *signal that a snapshot is needed*, not as an
     * address to fetch. Following a URL out of a response body is the one thing an allow-list
     * cannot make safe in general, so this function does not do it at all.
     */
    case 'get_content_snapshot':
      return {
        path: `/resources/snapshots/${query.resourceGroup}/${SYNC_RESOURCES[query.resourceGroup]}`,
        query: {},
        /**
         * The **only** route with a bound of its own, and the same one for both permitted groups.
         *
         * A whole-resource snapshot is a different kind of response from a page of fifty verses, and
         * the measured sizes say so. Both groups get this figure because both were measured and the
         * larger of the two is what set it — a per-group bound would be two numbers to keep true
         * where one suffices, and the smaller group would gain nothing from a tighter one.
         *
         * Every other route keeps `MAX_RESPONSE_BYTES` as a hard stop, including `/resources/sync`.
         */
        maxResponseBytes: MAX_SNAPSHOT_RESPONSE_BYTES,
      };
  }
}

/** `Retry-After` as delta-seconds, validated and capped. `null` means "no usable hint". */
export function readRetryAfter(headers: Headers): number | null {
  const raw = headers.get('retry-after');
  if (raw === null) {
    return null;
  }
  const trimmed = raw.trim();
  if (!/^[0-9]{1,7}$/.test(trimmed)) {
    return null;
  }
  const seconds = Number(trimmed);
  return seconds >= 0 && seconds <= MAX_RETRY_AFTER_SECONDS ? seconds : null;
}

/** Releases a body this adapter will not read. Every non-200 path discards rather than inspects. */
async function discard(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Already consumed or already errored. Nothing to release and nothing to report.
  }
}

/**
 * A body this adapter was able to read, or the named branch that refused it.
 *
 * The refusal carries a `UpstreamMalformedReason` rather than `null`, which is the whole point: every
 * one of these situations used to arrive at the handler as the single word `malformed`, and they have
 * different remedies. Nothing about the body itself — not a byte count, not a prefix, not a content
 * type — travels with the reason; see `UpstreamMalformedReason`.
 */
type BoundedBody =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'refused'; readonly reason: UpstreamMalformedReason };

/**
 * Reads at most `limitBytes`, then stops — and says which bound or fault stopped it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── One bound, supplied by the route ────────────────────────────────────────
 * `limitBytes` is `MAX_RESPONSE_BYTES` for eight of the nine routes and
 * `MAX_SNAPSHOT_RESPONSE_BYTES` for `get_content_snapshot`. It is a **parameter** rather than a branch
 * so there is exactly one over-size code path in this function: whichever number arrives, the body is
 * read up to it, refused the instant it passes it, and the stream cancelled. There is no route on
 * which reading continues past its own bound, and no shape in this function for one.
 *
 * ── Retention is the bound, not a multiple of it ────────────────────────────
 * Chunks are retained only while `total` is within `limitBytes`, and the first chunk that carries the
 * total past it returns without being pushed. So the most this function will ever hold for a request
 * is one bound's worth of bytes plus the single chunk that overran — and that chunk is released with
 * the reader rather than merged.
 * ═══════════════════════════════════════════════════════════════════════════
 */
async function readBoundedBody(response: Response, limitBytes: number): Promise<BoundedBody> {
  const declared = response.headers.get('content-length');
  if (declared !== null && /^[0-9]+$/.test(declared.trim()) && Number(declared) > limitBytes) {
    // The vendor said up front that the body is larger than this route's bound. Nothing is read.
    await discard(response);
    return { kind: 'refused', reason: 'declared_too_large' };
  }
  const body = response.body;
  if (body === null) {
    return { kind: 'refused', reason: 'empty_body' };
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      total += value.byteLength;
      if (total > limitBytes) {
        /*
          Distinct from `declared_too_large` because the two say different things about the vendor: a
          chunked or `Content-Length`-less response that runs past the bound is what an oversized
          snapshot looks like, and a declared one is what a response that knows its own size looks
          like. Both live snapshots reported this one, which is why the snapshot bound exists.

          Fail-closed, and immediately: the reader is cancelled, the overrunning chunk is never
          retained, and nothing partial is parsed or returned.
        */
        await reader.cancel();
        return { kind: 'refused', reason: 'streamed_too_large' };
      }
      chunks.push(value);
    }
  } catch {
    /*
      A truncated or aborted body. Nothing about the failure is captured — the exception is not read,
      not described and not re-thrown. What was received cannot be parsed, which is the same statement
      `invalid_json` makes about an HTML error page.
    */
    return { kind: 'refused', reason: 'invalid_json' };
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder().decode(merged);
  return text === '' ? { kind: 'refused', reason: 'empty_body' } : { kind: 'text', text };
}

/**
 * One attempt's outcome, plus the one case the caller may act on and whether anything was sent.
 *
 * `upstream-401` exists only inside this module and is never returned from `read`. It is the single
 * condition a retry can help — the token we presented was not accepted — and giving it a name that
 * cannot escape is what stops any other failure from being read as permission to try again.
 *
 * `issued` is what keeps the reported attempt count honest. An attempt that fails at the *token*
 * step — a refused credential, an unreachable authorization server — never reaches the content host,
 * so counting it as a content request would put a number in the operational log that means something
 * other than what the field says it means. It is the same distinction `unconfigured` draws for the
 * whole request, applied one level down.
 */
type Attempt = {
  readonly outcome: UpstreamOutcome | { readonly kind: 'upstream-401' };
  /** True only when a request actually left the process toward the content host. */
  readonly issued: boolean;
};

export type QuranFoundationClientConfig = {
  /** `QF_CLIENT_ID`, read from the environment by the entry point and handed here. */
  readonly clientId: string | undefined;
  /** `QF_CLIENT_SECRET`. Passed straight to the token store; this module never writes it anywhere. */
  readonly clientSecret: string | undefined;
  /** The bounded wall clock for one token exchange. */
  readonly tokenTimeoutMs: number;
  readonly clock: Clock;
  /** Injected so a test can drive both hops without a network. Defaults to global `fetch`. */
  readonly fetchImpl?: typeof fetch;
};

/**
 * An upstream that can only report that no credential is configured.
 *
 * Returned when either secret is absent, **before any transport is constructed**, so a deployment
 * without credentials makes zero outbound requests rather than one that fails. This is the fail-closed
 * path the whole integration rests on: the handler turns it into `503`, the client turns that into an
 * honest configuration state, and at no point does anything serve scripture from somewhere else.
 */
export const unconfiguredUpstream: QuranUpstream = {
  // deno-lint-ignore require-await
  read: async () => ({ kind: 'unconfigured', attempts: 0, tokenRenewed: false }),
};

export function createQuranFoundationClient(config: QuranFoundationClientConfig): QuranUpstream {
  const clientId = config.clientId ?? '';
  const clientSecret = config.clientSecret ?? '';
  if (clientId === '' || clientSecret === '') {
    return unconfiguredUpstream;
  }

  const call = config.fetchImpl ?? fetch;
  const tokens: TokenSource = createTokenStore({
    clientId,
    clientSecret,
    timeoutMs: config.tokenTimeoutMs,
    clock: config.clock,
    ...(config.fetchImpl === undefined ? {} : { fetchImpl: config.fetchImpl }),
  });

  const attempt = async (
    route: Route,
    forceRenew: boolean,
    signal: AbortSignal,
  ): Promise<Attempt> => {
    const token = await tokens.get({ forceRenew }, signal);
    if (token.kind === 'refused') {
      // A freshly presented credential was rejected by the authorization server. Retrying the
      // content request cannot help, and neither can exchanging again with the same credential.
      return { outcome: { kind: 'unauthorized' }, issued: false };
    }
    if (token.kind === 'unavailable') {
      // The exchange failed in transport or returned nothing usable. Nothing left this process
      // toward the content host, and the honest report is that the vendor is unreachable.
      return { outcome: { kind: 'transient' }, issued: false };
    }

    const search = new URLSearchParams(route.query).toString();
    const url = `${QF_API_ORIGIN}${QF_CONTENT_PREFIX}${route.path}${
      search === '' ? '' : `?${search}`
    }`;

    let response: Response;
    try {
      response = await call(url, {
        method: 'GET',
        headers: {
          // The two schemes the OpenAPI document declares, and the only headers this hop carries
          // beyond `accept`. The caller's own `Authorization` is never forwarded: this request
          // authenticates as NoorLife, not as the signed-in user, and the vendor is told nothing
          // about who asked.
          'x-auth-token': token.accessToken,
          'x-client-id': clientId,
          'accept': 'application/json',
        },
        signal,
        /**
         * A redirect is a failure, not a second request. Following one would replay the access token
         * and the client id to whatever host the redirect named.
         */
        redirect: 'error',
      });
    } catch {
      /**
       * A reset, a DNS failure, a refused redirect, or the handler's abort. Nothing about the error
       * is captured — an exception raised by a request carrying a credential is an exception that can
       * be made of that request.
       */
      return {
        outcome: signal.aborted ? { kind: 'timeout' } : { kind: 'transient' },
        issued: true,
      };
    }

    // From here on a request was issued and answered, whatever the answer turned out to be.
    if (response.status === 200) {
      const body = await readBoundedBody(response, route.maxResponseBytes ?? MAX_RESPONSE_BYTES);
      if (body.kind === 'refused') {
        return { outcome: { kind: 'malformed', reason: body.reason }, issued: true };
      }
      try {
        return { outcome: { kind: 'ok', body: JSON.parse(body.text) }, issued: true };
      } catch {
        // Not JSON at all — an HTML error page from a proxy, or a truncated body.
        return { outcome: { kind: 'malformed', reason: 'invalid_json' }, issued: true };
      }
    }

    if (response.status === 401 || response.status === 403) {
      await discard(response);
      // The one retryable condition. Never returned from `read`.
      return { outcome: { kind: 'upstream-401' }, issued: true };
    }

    if (response.status === 429) {
      const retryAfterSeconds = readRetryAfter(response.headers);
      await discard(response);
      return { outcome: { kind: 'rate-limited', retryAfterSeconds }, issued: true };
    }

    if (response.status === 404) {
      await discard(response);
      return { outcome: { kind: 'not-found' }, issued: true };
    }

    await discard(response);

    switch (response.status) {
      case 408:
      case 500:
      case 502:
      case 503:
      case 504:
        return { outcome: { kind: 'transient' }, issued: true };

      default:
        /**
         * `400`, `422`, a `3xx` that `redirect: 'error'` did not already refuse, and anything else.
         * All of them mean this request and the vendor's contract disagree, which sends whoever
         * investigates toward the request shape rather than toward vendor availability.
         *
         * `contract_status` says exactly that and no more. **Which** status arrived is a fact about
         * the vendor's response, and none of those cross this boundary — the body has already been
         * discarded unread two statements above.
         */
        return { outcome: { kind: 'malformed', reason: 'contract_status' }, issued: true };
    }
  };

  /**
   * The translation catalogue, cached for a day, held per isolate.
   *
   * ── Why attribution needs a second read at all ──────────────────────────────
   * Quran Foundation makes the per-entry `resource_name` optional and the live API omits it on the
   * routes NoorLife uses, so a translation arrives with a resource id, a verse key and text — and
   * nothing that says who translated it. The response-level `meta.translation_name` /
   * `meta.author_name` pair is required by the specification, but only on `/quran/translations/{id}`,
   * which is not one of the seven approved operations here.
   *
   * `/resources/translations` **is** one, it is the vendor's own catalogue, and it carries `name` and
   * `author_name` for every edition. Keyed by the exact id the caller asked for, it is a stronger
   * source of attribution than a label repeated on each row: one lookup, one answer, and nothing
   * inferred from the rows themselves.
   *
   * ── What the day-long cache is bounded by ───────────────────────────────────
   * The same window the function already declares for catalogue responses, so a correction reaches
   * users on the same schedule either way. It holds ids, titles and translator names — no scripture,
   * no translation text — and it is in memory, so it dies with the isolate.
   */
  const CATALOGUE_TTL_MS = 24 * 60 * 60 * 1000;
  let catalogue: {
    readonly at: number;
    readonly editions: ReadonlyMap<number, TranslationAttribution>;
  } | null = null;

  /** One read of a fixed route, with the single permitted retry. Shared by content and catalogue. */
  const readRoute = async (
    route: Route,
    signal: AbortSignal,
  ): Promise<
    { readonly outcome: UpstreamOutcome; readonly attempts: number; readonly tokenRenewed: boolean }
  > => {
    const first = await attempt(route, false, signal);
    if (first.outcome.kind !== 'upstream-401') {
      return {
        outcome: first.outcome,
        attempts: first.issued ? 1 : 0,
        tokenRenewed: false,
      };
    }

    /**
     * The single permitted retry.
     *
     * The token we held was not accepted — most often because it expired between being written into
     * the header and being read by the vendor, which the renewal skew makes rare but cannot make
     * impossible. `forceRenew` drops the cached token and exchanges once; if the freshly minted one
     * is refused too, the credential or the approved scope is wrong and no number of further
     * attempts changes that.
     */
    const second = await attempt(route, true, signal);
    const outcome: UpstreamOutcome = second.outcome.kind === 'upstream-401'
      ? { kind: 'unauthorized' }
      : second.outcome;
    /**
     * `tokenRenewed` is true whichever way the second attempt went, because the renewal itself
     * happened: a fresh token was exchanged for, and that is the fact an operator watching for a
     * rising renewal rate needs. `attempts` counts only the requests that actually reached the
     * content host, so a retry that could not get a token reports one, not two.
     */
    return { outcome, attempts: 1 + (second.issued ? 1 : 0), tokenRenewed: true };
  };

  /**
   * The attribution for one edition, or `null`.
   *
   * `null` is returned rather than an approximation whenever the catalogue cannot be reached, does
   * not list the id, or lists it without both a name and an author. The normaliser then falls back
   * to whatever the response itself carries, and fails closed if that is nothing — which is the
   * behaviour the whole hierarchy exists to end at.
   *
   * A stale-but-present catalogue is preferred to no catalogue when a refresh fails: an edition's
   * translator does not change, and refusing to name one because a refresh timed out would be
   * pedantry at the user's expense.
   */
  const attributionFor = async (
    resourceId: number,
    signal: AbortSignal,
  ): Promise<
    {
      readonly attribution: TranslationAttribution | null;
      readonly fetched: boolean;
      readonly outcome: CatalogueOutcome;
    }
  > => {
    const now = config.clock.now();
    const cached = catalogue;
    if (cached !== null && now - cached.at < CATALOGUE_TTL_MS && now >= cached.at) {
      const hit = cached.editions.get(resourceId) ?? null;
      return {
        attribution: hit,
        fetched: false,
        outcome: hit === null ? 'cached_miss' : 'cached_hit',
      };
    }

    const result = await readRoute(routeFor({ operation: 'list_translation_resources' }), signal);
    if (result.outcome.kind !== 'ok') {
      /**
       * The catalogue read failed on its own account.
       *
       * ── Reported distinctly because this is what the `502`s were ────────────
       * Any earlier copy is preferred to none — an edition's translator does not change, and refusing
       * to name one because a refresh timed out would be pedantry at the user's expense. But on a
       * **cold isolate** there is no earlier copy, `attribution` is `null`, and `normalizeTranslations`
       * then refuses a page that was in every other respect perfectly good.
       *
       * Until this value existed, that outcome logged as `catalogue_fetched: true` — the same thing a
       * completely successful lookup logs — which is why the failure survived investigation.
       */
      return {
        attribution: cached?.editions.get(resourceId) ?? null,
        fetched: true,
        outcome: 'unreachable',
      };
    }
    const editions = readCatalogue(result.outcome.body);
    if (editions === null) {
      return {
        attribution: cached?.editions.get(resourceId) ?? null,
        fetched: true,
        outcome: 'unreadable',
      };
    }
    catalogue = { at: now, editions };
    const found = editions.get(resourceId) ?? null;
    return {
      attribution: found,
      fetched: true,
      outcome: found === null ? 'fetched_miss' : 'fetched_hit',
    };
  };

  /** The id whose attribution this operation needs, or `null` when it needs none. */
  const editionOf = (query: QuranQuery): number | null => {
    if (query.operation === 'list_verse_translations') {
      return query.translationId;
    }
    if (query.operation === 'get_verse') {
      return query.translationId;
    }
    return null;
  };

  return {
    read: async (query, signal): Promise<UpstreamResult> => {
      const route = routeFor(query);
      const edition = editionOf(query);

      /**
       * ═══════════════════════════════════════════════════════════════════════
       * The catalogue lookup is started **beside** the content read, not after it.
       *
       * ── What the sequential version actually did ────────────────────────────
       * `read` used to await the content response, then — only for a translation-bearing operation,
       * and only on a cold isolate — issue a *second* upstream read for the catalogue, on the same
       * `AbortSignal` and inside the same 15-second budget the content read had already been
       * spending. So the catalogue got whatever was left of the deadline.
       *
       * That produced exactly the reported symptom. A warm isolate answered from the cached
       * catalogue and returned `200`. A cold isolate had to fetch, and when the content read had been
       * slow the catalogue read was aborted by the shared timer — `attribution` came back `null`,
       * `normalizeTranslations` refused the page for having nobody to credit, and the handler
       * answered `502 upstream_unavailable` while faithfully logging `upstream_outcome: ok`. Same
       * surah, same edition, same user: `200` or `502` depending on which isolate answered and how
       * the first read happened to be running. Intermittent, and invisible in the log.
       *
       * Concurrent, both reads get the whole budget. The token store already shares a single
       * in-flight exchange, so two concurrent first-requests on a cold isolate cost one token
       * exchange, not two.
       *
       * ── The cost, stated plainly ────────────────────────────────────────────
       * The catalogue is now fetched even when the content read fails, which the sequential version
       * avoided. That is one extra vendor request, at most once per isolate per day, on requests that
       * were failing anyway — and it buys the catalogue a full deadline instead of a leftover one.
       * It is the right side of the trade for a lookup whose failure costs the user their
       * translation.
       * ═══════════════════════════════════════════════════════════════════════
       */
      const pendingAttribution = edition === null ? null : attributionFor(edition, signal);
      const content = await readRoute(route, signal);

      if (pendingAttribution === null) {
        return {
          ...content.outcome,
          attempts: content.attempts,
          tokenRenewed: content.tokenRenewed,
        };
      }

      const resolved = await pendingAttribution;
      return {
        ...content.outcome,
        attempts: content.attempts,
        tokenRenewed: content.tokenRenewed,
        catalogueFetched: resolved.fetched,
        catalogueOutcome: resolved.outcome,
        ...(resolved.attribution === null ? {} : { attribution: resolved.attribution }),
      };
    },
  };
}

/**
 * The catalogue body → an id-keyed map of attributions.
 *
 * Entries missing a name or an author are **left out** rather than half-included: an edition this
 * function cannot fully attribute is one the normaliser must not be told it can. `null` means the
 * body was not a catalogue at all, which is different from a catalogue containing nothing usable.
 */
function readCatalogue(body: unknown): ReadonlyMap<number, TranslationAttribution> | null {
  const translations = asRecord(body)?.translations;
  if (!Array.isArray(translations)) {
    return null;
  }
  const editions = new Map<number, TranslationAttribution>();
  for (const entry of translations) {
    const resource = asRecord(entry);
    const id = resource?.id;
    const title = resource?.name;
    const translator = resource?.author_name;
    if (
      typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1 ||
      typeof title !== 'string' || title.length === 0 ||
      typeof translator !== 'string' || translator.length === 0
    ) {
      continue;
    }
    editions.set(id, { title, translator });
  }
  return editions;
}

/** A JSON object, narrowed. Arrays and `null` are not the object the catalogue describes. */
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
