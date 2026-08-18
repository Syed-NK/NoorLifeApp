import {
  ACCEPTED_REQUEST_FIELDS,
  CONTRACT_VERSION,
  type ErrorCode,
  MAX_AYAH,
  MAX_BODY_BYTES,
  MAX_PAGE,
  MAX_PER_PAGE,
  MAX_RESOURCE_ID,
  MAX_SURAH,
  MAX_SYNC_CURSOR_LENGTH,
  MAX_SYNC_PER_PAGE,
  MAX_SYNC_TOKEN_LENGTH,
  MIN_AYAH,
  MIN_PAGE,
  MIN_PER_PAGE,
  MIN_RESOURCE_ID,
  MIN_SURAH,
  QURAN_OPERATIONS,
  type QuranOperation,
  SYNC_RESOURCE_GROUPS,
  type SyncResourceGroup,
} from './contract.ts';
import type { QuranQuery } from './ports.ts';

/**
 * The inbound schema — the boundary where an untrusted body becomes a `QuranQuery`.
 *
 * ── Every check is executable code, deliberately ─────────────────────────────
 * A `type RequestBody = { … }` and a cast would compile and check nothing, which is the standard way
 * a "validated" boundary ends up unvalidated. Nothing below is a cast: every field is read as
 * `unknown`, tested, and copied into a new object built key by key.
 *
 * ── Closed by name, then closed by operation ─────────────────────────────────
 * Two independent gates, and both matter. `ACCEPTED_REQUEST_FIELDS` rejects any property this
 * contract does not name, so a client cannot smuggle a `path`, a `url`, a `host`, a `token` or a
 * `user_id` into the body at all. Then each operation declares exactly which of the accepted fields
 * it takes, and a field that is meaningless for the requested operation is a `400` rather than
 * something silently ignored — because a parameter that is accepted and discarded is a parameter a
 * future edit can start honouring without anybody noticing.
 *
 * ── What a rejection is allowed to say ───────────────────────────────────────
 * A field **name**, and only when it matches a conservative identifier shape. The name of a field
 * this schema declares is a NoorLife constant; the name of an unrecognised one is attacker-controlled
 * text, and `safeFieldName` is what stops it reaching a log line or a response body. No value is ever
 * echoed — not the operation string, not a surah number, not the body.
 */

/** Conservative: lowercase, digits and underscores, bounded. Anything else is reported as unnamed. */
const SAFE_FIELD = /^[a-z][a-z0-9_]{0,31}$/;

function safeFieldName(name: string): string | undefined {
  return SAFE_FIELD.test(name) ? name : undefined;
}

/**
 * An opaque vendor value: a string, absent, or refused.
 *
 * `null` means the caller did not send one, which is meaningful for both fields — no token is a
 * bootstrap, no cursor is the first page. A refusal is kept **distinct from absence** so that a
 * malformed token cannot silently become a bootstrap and re-download the whole resource.
 *
 * The character class is the check. NoorLife cannot validate the content of a vendor token, so it
 * validates that the value could not turn into anything other than a query parameter: unreserved
 * and sub-delimiter characters only, no whitespace, no quotes, no slash.
 */
const OPAQUE_VALUE = /^[A-Za-z0-9._~:@!$*+,;=%-]+$/;

function readOpaque(value: unknown, limit: number): string | null | 'invalid' {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'string' || value.length === 0 || value.length > limit) {
    return 'invalid';
  }
  return OPAQUE_VALUE.test(value) ? value : 'invalid';
}

/** A sync page size, defaulted to the vendor ceiling and never above it. */
function readSyncPerPage(value: unknown): number | null {
  if (value === undefined) {
    return MAX_SYNC_PER_PAGE;
  }
  return boundedInteger(value, 1, MAX_SYNC_PER_PAGE);
}

function isSyncResourceGroup(value: string): value is SyncResourceGroup {
  return (SYNC_RESOURCE_GROUPS as readonly string[]).includes(value);
}

export type ReadOutcome =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly reason: 'too-large' | 'unreadable' };

/**
 * Reads the body under a byte cap, and enforces the cap twice.
 *
 * A declared `Content-Length` over the cap is refused without reading a byte; a body that exceeds it
 * while streaming is cancelled mid-read. The second check is what catches a header that lied, which
 * is the only reason to have the first one at all — it saves the read in the honest case.
 */
export async function readBody(
  body: ReadableStream<Uint8Array> | null,
  contentLength: string | null,
): Promise<ReadOutcome> {
  if (contentLength !== null) {
    const declared = contentLength.trim();
    if (/^[0-9]+$/.test(declared) && Number(declared) > MAX_BODY_BYTES) {
      return { ok: false, reason: 'too-large' };
    }
  }
  if (body === null) {
    return { ok: true, text: '' };
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
      if (total > MAX_BODY_BYTES) {
        await reader.cancel();
        return { ok: false, reason: 'too-large' };
      }
      chunks.push(value);
    }
  } catch {
    // A truncated or aborted body. Nothing about the failure is captured.
    return { ok: false, reason: 'unreadable' };
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, text: new TextDecoder().decode(merged) };
}

export type ParseFailure = {
  readonly code: ErrorCode;
  readonly field?: string;
};

export type ParseOutcome =
  | { readonly ok: true; readonly query: QuranQuery; readonly operation: QuranOperation }
  | { readonly ok: false; readonly failure: ParseFailure };

function fail(code: ErrorCode, field?: string): ParseOutcome {
  return { ok: false, failure: field === undefined ? { code } : { code, field } };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/**
 * An integer in a closed range, or `null`.
 *
 * `Number.isInteger` rather than a truthiness check, because `1.0` is an integer, `1.5` is not, and
 * `"1"` is a string a client sent when it meant a number — which this contract refuses rather than
 * coerces. Silent coercion is how `per_page: "999999"` becomes a request nobody bounded.
 */
function boundedInteger(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
    ? value
    : null;
}

function isOperation(value: unknown): value is QuranOperation {
  return typeof value === 'string' && (QURAN_OPERATIONS as readonly string[]).includes(value);
}

/**
 * Which of the accepted fields each operation actually takes.
 *
 * Written as data so the "no meaningless parameter" rule is one table rather than seven `if`
 * statements, and so a new operation cannot be added without deciding — visibly, in a diff — what it
 * accepts. `contract_version` and `operation` are on every row by definition and are omitted here.
 */
const OPERATION_FIELDS: Readonly<Record<QuranOperation, readonly string[]>> = {
  list_chapters: [],
  get_chapter: ['surah'],
  list_verses: ['surah', 'page', 'per_page'],
  list_verse_translations: ['surah', 'translation_id', 'page', 'per_page'],
  get_verse: ['surah', 'verse', 'translation_id'],
  list_translation_resources: [],
  list_recitation_resources: [],
  list_verse_recitations: ['surah', 'recitation_id', 'page', 'per_page'],
  sync_content_resources: ['sync_token', 'cursor', 'per_page'],
  get_content_snapshot: ['resource_group'],
};

/**
 * The optional fields, per operation.
 *
 * Everything paginated may omit `page` and `per_page` and take the server's defaults, and `get_verse`
 * may omit `translation_id` to ask for scripture alone. Everything else in `OPERATION_FIELDS` is
 * required, so a `list_verse_translations` without a `translation_id` is a `400` rather than a
 * request answered against an edition nobody chose — the same "no implicit default translation" rule
 * the domain contract states, enforced on the server where it cannot be bypassed.
 */
const OPTIONAL_FIELDS: Readonly<Record<QuranOperation, readonly string[]>> = {
  list_chapters: [],
  get_chapter: [],
  list_verses: ['page', 'per_page'],
  list_verse_translations: ['page', 'per_page'],
  get_verse: ['translation_id'],
  list_translation_resources: [],
  list_recitation_resources: [],
  list_verse_recitations: ['page', 'per_page'],
  /*
    All three are optional, and each absence means something specific: no `sync_token` is a
    bootstrap, no `cursor` is the first page of a run, no `per_page` takes the server default.
    None of them is a resource selector — there is no field a client could send to widen scope.
  */
  sync_content_resources: ['sync_token', 'cursor', 'per_page'],
  get_content_snapshot: [],
};

/** Server-side defaults for the two paging fields. Modest, and well inside the vendor's ceiling. */
export const DEFAULT_PAGE = 1;
export const DEFAULT_PER_PAGE = 20;

export function parseRequestBody(payload: unknown): ParseOutcome {
  const body = asRecord(payload);
  if (body === null) {
    return fail('invalid_request', 'body');
  }

  // ── Closed by name ────────────────────────────────────────────────────────
  for (const key of Object.keys(body)) {
    if (!(ACCEPTED_REQUEST_FIELDS as readonly string[]).includes(key)) {
      return fail('invalid_request', safeFieldName(key));
    }
  }

  if (body.contract_version !== CONTRACT_VERSION) {
    /**
     * A distinct code, because the remedy is distinct: every other `400` is fixed by correcting the
     * request, and this one is fixed by updating the app. Checked before the operation so a build
     * from the future is told it is out of step rather than told its operation is unknown.
     */
    return fail('unsupported_contract_version', 'contract_version');
  }

  const operation = body.operation;
  if (!isOperation(operation)) {
    /**
     * The allow-list, and the only gate a request has to pass to reach an upstream route at all.
     *
     * The rejected value is **not** echoed. A client that sent `../../search` learns that the
     * operation was refused and nothing else — repeating an attacker's string back to them in a
     * response body is how a reflection turns into something worse.
     */
    return fail('invalid_request', 'operation');
  }

  // ── Closed by operation ───────────────────────────────────────────────────
  const permitted = OPERATION_FIELDS[operation];
  const optional = OPTIONAL_FIELDS[operation];
  for (const key of Object.keys(body)) {
    if (key === 'contract_version' || key === 'operation') {
      continue;
    }
    if (!permitted.includes(key)) {
      return fail('invalid_request', safeFieldName(key));
    }
  }
  for (const key of permitted) {
    if (!optional.includes(key) && body[key] === undefined) {
      return fail('invalid_request', key);
    }
  }

  switch (operation) {
    case 'list_chapters':
      return { ok: true, operation, query: { operation } };

    case 'list_translation_resources':
      return { ok: true, operation, query: { operation } };

    case 'list_recitation_resources':
      return { ok: true, operation, query: { operation } };

    /**
     * The one operation whose response carries a URL the device will fetch itself.
     *
     * Its inputs are bounded exactly like every other paginated read — a surah, a resource id and
     * two paging integers — so nothing a caller sends reaches a path segment as a string. The
     * *response* side is where this operation is unusual, and `normalizeRecitations` is the control
     * there: a URL that is not `https:` on an allow-listed host is dropped.
     */
    /**
     * A page of the synchronisation run for NoorLife’s two permitted resources.
     *
     * ── What a caller may influence, and what it may not ────────────────────
     * It may say *where in the run it is* — a checkpoint token, a page cursor, a page size. It may
     * not say *what is being synchronised*: this operation has no resource field at all, so the
     * canonical filter stays a server constant and widening the scope is a code change here rather
     * than a request from a device.
     *
     * Both opaque values are bounded and character-checked rather than parsed. NoorLife cannot tell
     * a good token from a bad one — only the vendor can — so what it checks is that the value could
     * not become anything but a query parameter.
     */
    case 'sync_content_resources': {
      const syncToken = readOpaque(body.sync_token, MAX_SYNC_TOKEN_LENGTH);
      if (syncToken === 'invalid') {
        return fail('invalid_request', 'sync_token');
      }
      const cursor = readOpaque(body.cursor, MAX_SYNC_CURSOR_LENGTH);
      if (cursor === 'invalid') {
        return fail('invalid_request', 'cursor');
      }
      const perPage = readSyncPerPage(body.per_page);
      if (perPage === null) {
        return fail('invalid_request', 'per_page');
      }
      return { ok: true, operation, query: { operation, syncToken, cursor, perPage } };
    }

    /**
     * A full snapshot of one permitted resource, for a create or an invalidation.
     *
     * The group is the only input, and it is matched against a closed list rather than passed
     * through — the resource id comes from `SYNC_RESOURCES` on the server. So a client that replays
     * a `resource_id` it saw in a mutation, or invents one, reaches nothing: there is no field for
     * it to travel in.
     */
    case 'get_content_snapshot': {
      const group = body.resource_group;
      if (typeof group !== 'string' || !isSyncResourceGroup(group)) {
        return fail('invalid_request', 'resource_group');
      }
      return { ok: true, operation, query: { operation, resourceGroup: group } };
    }

    case 'list_verse_recitations': {
      const surah = boundedInteger(body.surah, MIN_SURAH, MAX_SURAH);
      if (surah === null) {
        return fail('invalid_request', 'surah');
      }
      const recitationId = boundedInteger(body.recitation_id, MIN_RESOURCE_ID, MAX_RESOURCE_ID);
      if (recitationId === null) {
        return fail('invalid_request', 'recitation_id');
      }
      const paging = readPaging(body);
      if (paging.field !== undefined) {
        return fail('invalid_request', paging.field);
      }
      return {
        ok: true,
        operation,
        query: { operation, surah, recitationId, page: paging.page, perPage: paging.perPage },
      };
    }

    case 'get_chapter': {
      const surah = boundedInteger(body.surah, MIN_SURAH, MAX_SURAH);
      if (surah === null) {
        return fail('invalid_request', 'surah');
      }
      return { ok: true, operation, query: { operation, surah } };
    }

    case 'list_verses': {
      const surah = boundedInteger(body.surah, MIN_SURAH, MAX_SURAH);
      if (surah === null) {
        return fail('invalid_request', 'surah');
      }
      const paging = readPaging(body);
      if (paging.field !== undefined) {
        return fail('invalid_request', paging.field);
      }
      return {
        ok: true,
        operation,
        query: { operation, surah, page: paging.page, perPage: paging.perPage },
      };
    }

    case 'list_verse_translations': {
      const surah = boundedInteger(body.surah, MIN_SURAH, MAX_SURAH);
      if (surah === null) {
        return fail('invalid_request', 'surah');
      }
      const translationId = readTranslationId(body.translation_id);
      if (translationId === null) {
        return fail('invalid_request', 'translation_id');
      }
      const paging = readPaging(body);
      if (paging.field !== undefined) {
        return fail('invalid_request', paging.field);
      }
      return {
        ok: true,
        operation,
        query: {
          operation,
          surah,
          translationId,
          page: paging.page,
          perPage: paging.perPage,
        },
      };
    }

    case 'get_verse': {
      const surah = boundedInteger(body.surah, MIN_SURAH, MAX_SURAH);
      if (surah === null) {
        return fail('invalid_request', 'surah');
      }
      const ayah = boundedInteger(body.verse, MIN_AYAH, MAX_AYAH);
      if (ayah === null) {
        return fail('invalid_request', 'verse');
      }
      if (body.translation_id === undefined) {
        return { ok: true, operation, query: { operation, surah, ayah, translationId: null } };
      }
      const translationId = readTranslationId(body.translation_id);
      if (translationId === null) {
        return fail('invalid_request', 'translation_id');
      }
      return { ok: true, operation, query: { operation, surah, ayah, translationId } };
    }
  }
}

/**
 * A resource id — a bounded integer, and **only** an integer.
 *
 * ── The asymmetry that used to be here, and why it is gone ──────────────────
 * This function once accepted a digit *string* as well, on the reasoning that `TranslationId` is a
 * `string` in the app's domain model and the conversion may as well happen at the boundary where the
 * vendor's integer id space begins. `recitation_id`, added later, took the plain integer rule. The
 * two policies then disagreed, and a deployment answered `400 invalid_request` with
 * `error_field: recitation_id` and `upstream_attempts: 0` for every audio request the app made,
 * because it sent `"1"`.
 *
 * The repair could have gone either way. It goes this way — one rule, integers only — because a
 * server that coerces has a contract of "whatever the client happens to send", and the next
 * mismatch between the two sides is then silent instead of loud. The conversion belongs to the
 * client, at its own wire boundary, where `toWireResourceId` performs it explicitly and refuses a
 * value that is not an id **before** a request is made.
 *
 * Refused here, each for its own reason: a string in any form, a fraction, zero, a negative, an
 * unsafe integer, and anything outside the id space.
 */
function readTranslationId(value: unknown): number | null {
  return boundedInteger(value, MIN_RESOURCE_ID, MAX_RESOURCE_ID);
}

type Paging = { readonly page: number; readonly perPage: number; readonly field?: string };

/**
 * Paging, bounded on both fields.
 *
 * `per_page` is capped at the vendor's own documented maximum of 50 rather than at something larger
 * this function would then have to explain. A request above it is refused rather than clamped: a
 * client that asked for 500 verses and silently received 50 would page incorrectly for the rest of
 * the surah, which is a worse failure than being told the number was wrong.
 */
function readPaging(body: Record<string, unknown>): Paging {
  let page = DEFAULT_PAGE;
  if (body.page !== undefined) {
    const parsed = boundedInteger(body.page, MIN_PAGE, MAX_PAGE);
    if (parsed === null) {
      return { page: DEFAULT_PAGE, perPage: DEFAULT_PER_PAGE, field: 'page' };
    }
    page = parsed;
  }

  let perPage = DEFAULT_PER_PAGE;
  if (body.per_page !== undefined) {
    const parsed = boundedInteger(body.per_page, MIN_PER_PAGE, MAX_PER_PAGE);
    if (parsed === null) {
      return { page: DEFAULT_PAGE, perPage: DEFAULT_PER_PAGE, field: 'per_page' };
    }
    perPage = parsed;
  }

  return { page, perPage };
}
