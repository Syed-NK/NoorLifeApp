import { normalizeEmail } from '@services/account/account-security.service';
import { isValidEmail } from '@services/auth/mock-auth-service';

/**
 * Whether the Change Email field currently holds something worth sending.
 *
 * ── Why this is a function and not four booleans in the screen ──────────────
 * The device pass found "Send Confirmation" enabled over an empty field. The button's enabled state
 * and the submit handler's guard were two separate readings of the same question, and only one of
 * them had been written. One function answers it once, and both the `disabled` prop and the handler
 * call it — so a state that cannot be submitted also cannot be pressed, and the two can no longer
 * drift apart.
 *
 * ── The four answers, and why "unchanged" is one of them ────────────────────
 * Requesting a change to the address already on the account is not a harmless no-op. GoTrue would
 * accept it, email a confirmation to a mailbox the user is already using, and leave them looking at
 * a pending state for something that was never going to move. It is refused here rather than sent.
 *
 * Comparison is on the normalized forms of both sides: surrounding whitespace is dropped and case is
 * folded, because `  Ahmed@Example.COM ` and `ahmed@example.com` reach the same mailbox and every
 * identity provider this application talks to treats them as one address. Neither the stored address
 * nor the user's draft is mutated — `normalizeEmail` returns a new string, and the value sent to the
 * service is the normalized *draft*, never a rewritten current address.
 */

/**
 * What the field holds.
 *
 * `empty` covers whitespace-only input as well as no input: `'   '` is not an address, and telling
 * a user their three spaces are "invalid" is less useful than telling them the field is empty.
 */
export type EmailDraftState = 'empty' | 'invalid' | 'unchanged' | 'valid';

export type EmailDraftEvaluation = {
  readonly state: EmailDraftState;
  /** The draft as the service would send it. Only meaningful when `state` is `valid`. */
  readonly normalized: string;
  /** True only for `valid`. The single thing both the button and the handler read. */
  readonly canSubmit: boolean;
};

export function evaluateEmailDraft(
  draft: string,
  currentEmail: string | null,
): EmailDraftEvaluation {
  const normalized = normalizeEmail(draft);

  const state: EmailDraftState =
    normalized.length === 0
      ? 'empty'
      : !isValidEmail(normalized)
        ? 'invalid'
        : currentEmail !== null && normalized === normalizeEmail(currentEmail)
          ? 'unchanged'
          : 'valid';

  return { state, normalized, canSubmit: state === 'valid' };
}
