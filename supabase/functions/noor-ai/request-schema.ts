import {
  ACCEPTED_REQUEST_FIELDS,
  CONTRACT_VERSION,
  type ErrorCode,
  MAX_BODY_BYTES,
  MAX_MESSAGE_CODE_POINTS,
} from './contract.ts';

/**
 * §C.2 and §C.3, as an explicit runtime parser.
 *
 * ── TypeScript is not runtime validation ────────────────────────────────────
 * Everything arriving here is untrusted, "including the parts that look structural (`surface`,
 * `locale`)" (§B.3). A `type ValidRequest = { … }` and a cast would compile and check nothing at all,
 * which is the single most common way a "validated" endpoint ends up unvalidated. So every field is
 * checked by executing code against the parsed JSON, and the resulting type is produced only by a
 * function that did the checking.
 *
 * ── The order is part of the contract ───────────────────────────────────────
 * §C.3: "the cheap rejections come first so a hostile caller cannot make the server do work". Byte cap
 * before parsing, parse, unknown fields, trim, empty, length, control characters — in that order,
 * because each step's cost is higher than the last and each step's rejection is cheaper than the work
 * it prevents.
 *
 * ── Truncation is never a fallback ──────────────────────────────────────────
 * §C.3: "A message over the limit is refused, not silently cut — answering half a question is worse
 * than declining the whole one." Nothing in this file shortens anything.
 */

export type ParsedRequest = {
  readonly contractVersion: typeof CONTRACT_VERSION;
  /** Trimmed, length-checked, control-character-free. The only text that reaches the provider. */
  readonly message: string;
  /** Code points, for the log's `message_length`. Metadata, never content (§H.3). */
  readonly messageCodePoints: number;
  readonly surface: string | undefined;
  readonly locale: string | undefined;
};

export type ParseFailure = {
  readonly code: Extract<ErrorCode, 'invalid_request' | 'unsupported_contract_version'>;
  /** A field **name** only. §C.6: "The field's **value** is never echoed and never logged". */
  readonly field: string;
};

export type ParseResult =
  | { readonly ok: true; readonly request: ParsedRequest }
  | { readonly ok: false; readonly failure: ParseFailure };

/**
 * The shape a field name must have before it is allowed into a response or a log line.
 *
 * §C.6 requires the offending field's **name** in `error.field`, and that is the one piece of
 * caller-chosen content this contract puts in a response. A name is not a value, but it is still
 * attacker-controlled: `{"<script>…2000 characters…": 1}` is a legal JSON key, and echoing it back
 * would turn §C.6's helpfulness into exactly what §C.6 exists to prevent — "echoing
 * attacker-controlled content back is how an error message becomes a payload".
 *
 * So a name that does not look like an identifier a NoorLife client would plausibly send is reported
 * as `body` instead. A real client bug still gets a useful name; a probe gets nothing back.
 */
const SAFE_FIELD_NAME = /^[A-Za-z0-9_.-]{1,64}$/;

function safeFieldName(name: string): string {
  return SAFE_FIELD_NAME.test(name) ? name : 'body';
}

/**
 * The characters stripped from both ends of `message` (§C.3.4).
 *
 * Unicode whitespace via `\s` with the `u` flag, plus the two families `\s` does not cover and that
 * §C.3.4 names explicitly:
 *
 *   • **Zero-width** — U+200B…U+200D, U+2060, U+FEFF. Invisible, so a "non-empty" message could be
 *     composed entirely of them and still bill a provider call for nothing.
 *   • **Bidirectional controls** — U+200E, U+200F, U+202A…U+202E, U+2066…U+2069. These reorder how a
 *     string *displays* without changing what it contains, which is a log-reader and prompt-boundary
 *     attack rather than a formatting choice. This app is RTL-capable, so they are plausible input and
 *     must be handled deliberately rather than incidentally.
 */
const TRIMMABLE = '\\s\\u200b-\\u200f\\u202a-\\u202e\\u2060\\u2066-\\u2069\\ufeff';
const LEADING_TRIM = new RegExp(`^[${TRIMMABLE}]+`, 'u');
const TRAILING_TRIM = new RegExp(`[${TRIMMABLE}]+$`, 'u');

/** Tab, line feed and carriage return — the three §C.3.7 permits. */
const PERMITTED_CONTROLS = new Set([0x09, 0x0a, 0x0d]);

/**
 * Whether the string holds a C0 or C1 control character other than `\n`, `\r` or `\t` (§C.3.7).
 *
 * §C.3.7's reasoning, kept because it justifies rejecting rather than stripping: "They exist in a help
 * question only to confuse a log reader or a prompt boundary." A NUL or an ESC in a question about
 * prayer reminders is not a typo.
 *
 * Written as a code-point scan rather than a character class, because a regex spelling this would be a
 * regex containing control characters — the thing `no-control-regex` exists to flag, and the thing a
 * reviewer cannot check by eye. The ranges are C0 (U+0000–U+001F) and C1 (U+007F–U+009F).
 */
export function hasForbiddenControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (PERMITTED_CONTROLS.has(code)) {
      continue;
    }
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) {
      return true;
    }
  }
  return false;
}

export function trimMessage(value: string): string {
  return value.replace(LEADING_TRIM, '').replace(TRAILING_TRIM, '');
}

/** §C.3.6 — code points, not UTF-16 units and not bytes. */
export function countCodePoints(value: string): number {
  return [...value].length;
}

function invalid(field: string): ParseResult {
  return { ok: false, failure: { code: 'invalid_request', field: safeFieldName(field) } };
}

/**
 * Validates an already-parsed JSON value against §C.2.
 *
 * Split from the byte-level reading so the schema rules are testable without constructing a stream,
 * and so `readBody` below owns exactly one concern: not buffering past the cap.
 */
export function parseRequestBody(value: unknown): ParseResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    // A top-level array or scalar is not the object §C.2 describes. Reported against `body` rather
    // than a field name, because there are no fields to name.
    return invalid('body');
  }

  const body = value as Record<string, unknown>;

  /**
   * §C.6 — unknown fields are rejected, not ignored.
   *
   * "Ignoring is forgiving at exactly the wrong moment: a client that sends
   * `{"model": "...", "system": "..."}` and gets a `200` has been told its override worked. It must be
   * told it did not." This single loop is what makes every row of §C.6's table hold — `user_id`,
   * `model`, `system`, `instructions`, `tools`, `scope`, `granted_modules`, `temperature`, `store`,
   * `stream`, `previous_response_id`, `history`, `debug` — without naming any of them, because the
   * check is an allow-list of four and everything else is "everything else".
   *
   * Insertion order, so the reported name is deterministic when a caller sends several.
   */
  for (const key of Object.keys(body)) {
    if (!(ACCEPTED_REQUEST_FIELDS as readonly string[]).includes(key)) {
      return invalid(key);
    }
  }

  if (!('contract_version' in body)) {
    return invalid('contract_version');
  }
  /**
   * §C.2 — "Must equal `1`. Any other value → `unsupported_contract_version`. Not a range, not a
   * string, not coerced." `Number.isInteger` rejects `1.5` and `NaN`; the strict comparison rejects
   * `"1"` and `true` without JavaScript quietly agreeing with them.
   */
  if (!Number.isInteger(body.contract_version) || body.contract_version !== CONTRACT_VERSION) {
    return {
      ok: false,
      failure: { code: 'unsupported_contract_version', field: 'contract_version' },
    };
  }

  if (typeof body.message !== 'string') {
    return invalid('message');
  }

  // §C.3.4 → §C.3.5 → §C.3.6 → §C.3.7, in that order.
  const message = trimMessage(body.message);
  if (message.length === 0) {
    /**
     * §C.3.5 — a whitespace-only message is the same case as an empty one, "deliberately: silently
     * answering '' would send a billable request containing nothing".
     */
    return invalid('message');
  }
  const messageCodePoints = countCodePoints(message);
  if (messageCodePoints > MAX_MESSAGE_CODE_POINTS) {
    return invalid('message');
  }
  if (hasForbiddenControlCharacter(message)) {
    return invalid('message');
  }

  /**
   * §C.2 types `surface` and `locale` as strings. A wrong *type* is rejected; a wrong *value* is
   * discarded and defaulted by `allow-lists.ts`. See the note there for why the two differ.
   */
  if ('surface' in body && typeof body.surface !== 'string') {
    return invalid('surface');
  }
  if ('locale' in body && typeof body.locale !== 'string') {
    return invalid('locale');
  }

  return {
    ok: true,
    request: {
      contractVersion: CONTRACT_VERSION,
      message,
      messageCodePoints,
      surface: typeof body.surface === 'string' ? body.surface : undefined,
      locale: typeof body.locale === 'string' ? body.locale : undefined,
    },
  };
}

export type BodyReadResult =
  /** UTF-8 text within the cap. Not yet JSON — the caller parses. */
  | { readonly ok: true; readonly text: string }
  /** §C.3.1 — over `MAX_BODY_BYTES`. */
  | { readonly ok: false; readonly reason: 'too-large' }
  /** Not decodable as UTF-8, or the stream failed. §C.3.2's `invalid_request`, `field: "body"`. */
  | { readonly ok: false; readonly reason: 'unreadable' };

/**
 * Reads the body, refusing to buffer past the cap (§C.3.1).
 *
 * Two checks, and the second is the one that matters. `Content-Length` is consulted first because it
 * is free, but it is a **claim by the caller**: a request can under-declare it, or omit it entirely
 * under chunked encoding. So the read loop also counts bytes as they arrive and stops the moment the
 * running total exceeds the cap — "The body is never fully buffered past the cap." The reader is
 * cancelled rather than drained, so an attacker streaming megabytes pays for the connection and
 * NoorLife pays for 8 KiB.
 *
 * §C.3.1's sizing rationale, recorded because the number looks arbitrary otherwise: 1000 code points
 * at UTF-8's four-byte worst case is 4000 bytes, so 8 KiB is generous for the envelope and still far
 * below anything worth attacking with.
 */
export async function readBody(
  body: ReadableStream<Uint8Array> | null,
  declaredLength: string | null,
  cap: number = MAX_BODY_BYTES,
): Promise<BodyReadResult> {
  if (declaredLength !== null) {
    const declared = Number(declaredLength);
    if (Number.isFinite(declared) && declared > cap) {
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
      if (total > cap) {
        await reader.cancel();
        return { ok: false, reason: 'too-large' };
      }
      chunks.push(value);
    }
  } catch {
    // A broken stream. No detail is captured: §H.3 forbids logging the raw request body, and an
    // exception raised by a body read is made of the body.
    try {
      await reader.cancel();
    } catch {
      // Cancelling an already-errored reader is not itself a failure worth reporting.
    }
    return { ok: false, reason: 'unreadable' };
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    // `fatal` so invalid UTF-8 is a rejection rather than a string full of replacement characters
    // that would then be measured, sent upstream and billed.
    return { ok: true, text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) };
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
}
