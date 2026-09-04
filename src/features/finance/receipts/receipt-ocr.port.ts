/**
 * **The seam between Finance and on-device text recognition** — issue #101.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Why Finance may not import the recogniser directly ─────────────────────
 * Exactly one file in this repository imports the recogniser — `device-receipt-ocr.ts`, the adapter
 * beside this one, which loads this project's own `modules/noorlife-text-recognition`. Everything
 * else — the review screen, the parser, the ledger — talks to this type.
 *
 * The recogniser it names has changed once already: `@react-native-ml-kit/text-recognition` was
 * removed because it declared all five OCR scripts on both platforms with no way to narrow them.
 * That the swap touched one file and no caller is the seam doing its job.
 *
 * That is not tidiness. The vendor SDK returns blocks, lines, elements, corner points, bounding
 * frames and recognised-language guesses for every word on a receipt, and a screen holding that
 * object is one careless prop away from putting a merchant name into a log line, a crash report or a
 * ledger field. Narrowing the type at the seam is what makes the leak impossible rather than
 * discouraged: there is nothing to leak, because nothing downstream ever receives it.
 *
 * ── What the port deliberately does not return ─────────────────────────────
 * No geometry, no per-word confidence, no language list, no vendor result object. Confidence in
 * particular is left out on purpose — a number beside a suggestion invites a screen to *act* on it,
 * and the product rule here is that OCR is a suggestion the user edits, never an authority that
 * decides. A field the user must confirm anyway is not improved by a score.
 *
 * ── Lines, and why they are ephemeral ──────────────────────────────────────
 * The one thing that survives the seam is the recognised lines, because the parser needs text to
 * find a total and a date in. They live in workflow state for the length of one review and are never
 * written anywhere. The single path by which any of this text can reach storage is the user pressing
 * the explicit "use this as the note" control on the review screen — see `finance-receipts-screen`.
 *
 * ── The outcomes are four, and none of them is an exception ────────────────
 * Recognised, empty, failed, aborted. "Empty" is a real answer about a real photograph — a blurred
 * or blank image recognises nothing, and that is not an error to retry, it is a result to tell the
 * user about. Modelling it as a distinct outcome is what stops the screen showing "something went
 * wrong" for a picture of a wall.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** How many lines a receipt may contribute. Beyond this the extra lines are dropped, not truncated. */
export const MAX_RECEIPT_LINES = 200;

/** How long one line may be. A receipt line is short; anything longer is noise or a bad decode. */
export const MAX_RECEIPT_LINE_LENGTH = 200;

export type ReceiptOcrFailure =
  /** The recogniser is not present in this build, or would not start. */
  | 'unavailable'
  /** The recogniser ran and could not read the file it was handed. */
  | 'unreadable'
  /** The caller withdrew the request — a replaced image, a cancelled draft, an unmounted screen. */
  | 'aborted';

export type ReceiptOcrOutcome =
  | { readonly kind: 'recognised'; readonly lines: readonly string[] }
  | { readonly kind: 'empty' }
  | { readonly kind: 'failed'; readonly reason: ReceiptOcrFailure };

export type ReceiptOcrRequest = {
  /**
   * A `file://` URI the app itself owns.
   *
   * Local by contract. The port has no network of any kind and nothing behind it fetches: handing it
   * an `https://` URI is a caller error, and the adapter refuses it rather than quietly downloading
   * a receipt from somewhere.
   */
  readonly uri: string;
  /** Withdrawing the request. An aborted recognition resolves `failed: 'aborted'`, never rejects. */
  readonly signal?: AbortSignal;
};

export type ReceiptOcrPort = {
  recognise(request: ReceiptOcrRequest): Promise<ReceiptOcrOutcome>;
};

/** Whether a URI is one the port will accept: a local file this device can open. */
export function isLocalImageUri(uri: unknown): uri is string {
  return typeof uri === 'string' && /^file:\/\/\//.test(uri.trim());
}

/**
 * Turns whatever the native side produced into the port's line list, or `null` if it is not usable.
 *
 * Written as a total function over `unknown` because a native module's result is not a promise the
 * type system can keep. A malformed payload — a number where the text was, a missing field, a
 * `null` — is a *failure*, not a crash and not an empty receipt, and separating those three is the
 * whole reason this is a named function with its own tests rather than a cast at the call site.
 */
export function normaliseRecognisedText(value: unknown): readonly string[] | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const text = (value as { text?: unknown }).text;
  if (typeof text !== 'string') {
    return null;
  }
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line.length <= MAX_RECEIPT_LINE_LENGTH)
    .slice(0, MAX_RECEIPT_LINES);
}
