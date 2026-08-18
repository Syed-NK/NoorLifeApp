import { scorePassword } from '@services/auth/mock-auth-service';

/**
 * Whether Change Password currently holds something worth sending.
 *
 * ── Why this is one function and not a handful of booleans in the screen ─────
 * The device pass found "Update Password" drawn at full `#1677FF` fill over two empty fields. The
 * control had no `disabled` prop at all, and the only refusal lived inside `submit` — so the button
 * invited a press, took it, and answered with "Enter a new password." That is the wrong order for
 * an action that rotates a credential, and it is the same defect Change Email had before
 * `evaluateEmailDraft` replaced its two independent readings with one.
 *
 * So the button's `disabled` prop, the keyboard's Submit and the handler's guard all call *this*,
 * and a state that cannot be submitted also cannot be pressed. They can no longer drift apart,
 * because there is only one of them.
 *
 * ── Why the reasons are ordered rather than collected ───────────────────────
 * A user with two empty fields is told the field is empty, not that it is empty *and* mismatched
 * *and* weak. The first genuine obstacle is the only useful one, and reporting three at once reads
 * as three separate problems. The order below is the order a person fills the form in.
 *
 * ── What this never does ────────────────────────────────────────────────────
 * It does not log, does not store, and does not return the password. Both arguments are read and
 * the return value carries state words only — there is no field on `PasswordDraftEvaluation` that
 * could hold a credential, which is what makes "the evaluator cannot leak the password" a property
 * of the type rather than of a promise.
 */

/**
 * Why the form cannot be submitted, or `valid`.
 *
 * `empty` covers whitespace-only input for the same reason it does on Change Email: `'        '` is
 * not a password, and Supabase would reject it after a round trip that told the user nothing. It is
 * refused here, and it is refused as "empty" rather than "weak" because that is what it is.
 *
 * `session-unavailable` and `provider-unsupported` are not user mistakes at all — they are reasons
 * the request could not be made whatever was typed. They are distinguished so a screen reader is
 * told the truth about a greyed control instead of being pointed at the password field.
 */
export type PasswordDraftState =
  | 'empty'
  | 'confirm-empty'
  | 'weak'
  | 'mismatch'
  /** A request is already in flight. */
  | 'submitting'
  /** No usable session, so there is no account to change a password on. */
  | 'session-unavailable'
  /** A social identity: NoorLife holds no password for this account. */
  | 'provider-unsupported'
  | 'valid';

export type PasswordDraftEvaluation = {
  readonly state: PasswordDraftState;
  /** True only for `valid`. The single thing the button and the handler both read. */
  readonly canSubmit: boolean;
  /**
   * Whether the obstacle is something the user typed.
   *
   * False for `submitting`, `session-unavailable` and `provider-unsupported`, which no edit to
   * either field can clear. The screen uses it to decide whether an inline message under a field
   * would be honest — pointing at the password box when the session has expired would not be.
   */
  readonly isFieldProblem: boolean;
  /** Which field the message belongs under, when one does. */
  readonly field: 'password' | 'confirm' | null;
};

export type PasswordDraftInput = {
  readonly password: string;
  readonly confirm: string;
  /**
   * Whether a request could be made at all, independent of what is typed.
   *
   * False while the account summary has not loaded, when authentication is not `signed-in`, or when
   * a request is already open. A change requested against a session we cannot confirm is the one
   * that ends with an account the user cannot get back into, so the control stays disabled rather
   * than guessing.
   */
  readonly sessionReady: boolean;
  /** Supabase's `canManagePassword` — false for a Google or Apple identity. */
  readonly canManagePassword: boolean;
  readonly submitting: boolean;
};

const FIELD_OF: Readonly<Record<PasswordDraftState, 'password' | 'confirm' | null>> = {
  empty: 'password',
  'confirm-empty': 'confirm',
  weak: 'password',
  mismatch: 'confirm',
  submitting: null,
  'session-unavailable': null,
  'provider-unsupported': null,
  valid: null,
};

const FIELD_PROBLEMS: readonly PasswordDraftState[] = [
  'empty',
  'confirm-empty',
  'weak',
  'mismatch',
];

/**
 * Trims for the emptiness test only.
 *
 * The password itself is never trimmed on the way to Supabase — leading or trailing spaces are
 * legitimate characters in a passphrase, and silently removing them would set a password the user
 * cannot then type. So `'  a  '` is not empty, and what is sent is exactly what was entered.
 */
function isBlank(value: string): boolean {
  return value.trim().length === 0;
}

export function evaluatePasswordDraft(input: PasswordDraftInput): PasswordDraftEvaluation {
  const state = resolveState(input);
  return {
    state,
    canSubmit: state === 'valid',
    isFieldProblem: FIELD_PROBLEMS.includes(state),
    field: FIELD_OF[state],
  };
}

function resolveState(input: PasswordDraftInput): PasswordDraftState {
  // Capability before content: a social identity and a dead session are true whatever is typed, and
  // reporting "enter a new password" to either would be advice that cannot help.
  if (!input.canManagePassword) {
    return 'provider-unsupported';
  }
  if (!input.sessionReady) {
    return 'session-unavailable';
  }
  if (input.submitting) {
    return 'submitting';
  }

  /**
   * The password field is answered completely before the confirmation is looked at.
   *
   * That ordering is the form's own, top to bottom, and it is why `weak` comes before
   * `confirm-empty`: a user who has typed `abc` and not yet reached the second box is best told
   * their password is too short, not that they have failed to confirm a password they are going to
   * have to change anyway. Reporting the second field first sends them forward to re-type a value
   * that was never going to be accepted.
   */
  if (isBlank(input.password)) {
    return 'empty';
  }
  // Policy before comparison: two identical weak passwords are weak, not matched.
  if (scorePassword(input.password) === 'weak') {
    return 'weak';
  }
  if (isBlank(input.confirm)) {
    return 'confirm-empty';
  }
  if (input.password !== input.confirm) {
    return 'mismatch';
  }
  return 'valid';
}
