import { NOOR_AI_MAX_MESSAGE_CODE_POINTS } from '@services/ai/noor-ai.contract';

/**
 * Whether what the user has typed can be sent, and why not when it cannot.
 *
 * ── Why the composer decides this at all ────────────────────────────────────
 * The adapter already refuses the same four cases before it invokes anything, so nothing here is
 * load-bearing for safety. What it is for is the control: a Send button that is enabled over an
 * empty box, accepts the press and then answers "that could not be sent" has invited a mistake and
 * then explained it. `change-email-screen.tsx` learned this on device and fixed it the same way —
 * one function read twice, once to decide whether the button is enabled and once inside the
 * handler, so a keyboard Submit, a stale closure and a double press are all refused by the same
 * code rather than by three approximations of it.
 *
 * ── Why the rules are mirrored rather than imported ─────────────────────────
 * `buildRequestBody` is private to `noor-ai.service.ts` and must stay that way: it is the function
 * that decides what goes on the wire, and exporting it so a screen could call it would make the
 * request shape a shared surface. The four rules are therefore restated here, and
 * `noor-ai-ui-source-scan.test.ts` reads both files as text and asserts the trimmable character
 * class and the code-point limit are identical — the same mirror-plus-parity-test technique
 * `noor-ai-adapter-guards.test.ts` uses between the client and the Edge Function, and for the same
 * reason: a drift becomes a failing test rather than a silently rejected question.
 *
 * ── Which direction a drift would break ─────────────────────────────────────
 * Stated plainly, because it decides how much this matters. If this copy were ever *more*
 * permissive than the adapter, a question the adapter refuses would reach it and come back as
 * `invalid-request`, which the screen renders as "please rewrite it" — correct, if wasteful. If it
 * were *stricter*, a legitimate question would be blocked by a disabled button with no way to find
 * out why. The second is the real defect, which is why the parity assertion is exact rather than
 * one-sided.
 */

/**
 * §C.3.4's trimmable set: Unicode whitespace, plus the two families `\s` does not cover.
 *
 * Zero-width characters would let a "non-empty" question be composed entirely of invisible ones;
 * bidirectional controls reorder how a string displays without changing what it contains. This app
 * is RTL-capable, so both are plausible input rather than exotic ones.
 *
 * Kept byte-identical to `TRIMMABLE` in `src/services/ai/noor-ai.service.ts`, asserted by test.
 */
const TRIMMABLE = '\\s\\u200b-\\u200f\\u202a-\\u202e\\u2060\\u2066-\\u2069\\ufeff';
const LEADING_TRIM = new RegExp(`^[${TRIMMABLE}]+`, 'u');
const TRAILING_TRIM = new RegExp(`[${TRIMMABLE}]+$`, 'u');

/** Tab, line feed and carriage return — the three §C.3.7 permits. */
const PERMITTED_CONTROLS = new Set([0x09, 0x0a, 0x0d]);

/** §C.3.6 — code points, not UTF-16 units and not bytes, so Arabic is not penalised. */
function countCodePoints(value: string): number {
  return [...value].length;
}

/**
 * A C0 or C1 control other than `\n`, `\r` or `\t`.
 *
 * A code-point scan rather than a character class, because a regex spelling this would be a regex
 * containing control characters — the thing `no-control-regex` exists to flag, and the thing a
 * reviewer cannot check by eye.
 */
function hasForbiddenControlCharacter(value: string): boolean {
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

/** The trimmed question, exactly as the adapter would trim it. */
export function trimNoorAIMessage(value: string): string {
  return value.replace(LEADING_TRIM, '').replace(TRAILING_TRIM, '');
}

/**
 * Why a draft cannot be sent.
 *
 * `empty` is separated from `blank` on purpose: an untouched composer must not greet the user with
 * a validation message, and only the two states can tell "nothing typed yet" from "typed, but it
 * amounts to nothing".
 */
export type NoorAIDraftProblem = 'empty' | 'blank' | 'too-long' | 'unsupported-characters';

export type NoorAIDraftEvaluation =
  | { readonly canSubmit: true; readonly message: string }
  | { readonly canSubmit: false; readonly problem: NoorAIDraftProblem };

/** The maximum, re-exported so the composer and its tests read one value. */
export const NOOR_AI_DRAFT_MAX_CODE_POINTS = NOOR_AI_MAX_MESSAGE_CODE_POINTS;

/**
 * Evaluates a draft against the adapter's four local rules.
 *
 * Deliberately structural only. It does not and must not decide what the question is *about* —
 * §K.3.5: "The client cannot determine what a question is about", and a keyword filter here would
 * be trivially evaded, would refuse legitimate questions, and would invite a reader to believe a
 * semantic control exists on the device when it does not. The server owns subject and refusal.
 */
export function evaluateNoorAIDraft(draft: string): NoorAIDraftEvaluation {
  if (draft.length === 0) {
    return { canSubmit: false, problem: 'empty' };
  }

  const message = trimNoorAIMessage(draft);
  if (message.length === 0) {
    return { canSubmit: false, problem: 'blank' };
  }
  if (countCodePoints(message) > NOOR_AI_DRAFT_MAX_CODE_POINTS) {
    return { canSubmit: false, problem: 'too-long' };
  }
  if (hasForbiddenControlCharacter(message)) {
    return { canSubmit: false, problem: 'unsupported-characters' };
  }

  return { canSubmit: true, message };
}
