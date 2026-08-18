import {
  evaluatePasswordDraft,
  type PasswordDraftInput,
  type PasswordDraftState,
} from '../password-change-validation';

/**
 * The Change Password evaluator, on its own.
 *
 * ── Why this is a unit test and not only a screen test ──────────────────────
 * The screen test proves the button follows this function. This proves the function is right,
 * including the combinations no realistic sequence of presses would produce — a social identity
 * with a valid password typed, a dead session mid-submission — which is exactly where a
 * hand-written boolean chain goes wrong.
 */

const READY: PasswordDraftInput = {
  password: '',
  confirm: '',
  sessionReady: true,
  canManagePassword: true,
  submitting: false,
};

function evaluate(overrides: Partial<PasswordDraftInput> = {}) {
  return evaluatePasswordDraft({ ...READY, ...overrides });
}

const STRONG = 'NoorLife2026!';

describe('content', () => {
  it.each([
    ['both fields empty is "empty"', { password: '', confirm: '' }, 'empty'],
    ['a whitespace-only password is "empty"', { password: '     ', confirm: '     ' }, 'empty'],
    ['a tab-and-newline password is "empty"', { password: '\t\n ', confirm: '\t\n ' }, 'empty'],
    ['a password below the policy is "weak"', { password: 'abc', confirm: 'abc' }, 'weak'],
    ['no confirmation is "confirm-empty"', { password: STRONG, confirm: '' }, 'confirm-empty'],
    [
      'a whitespace-only confirmation is "confirm-empty"',
      { password: STRONG, confirm: '   ' },
      'confirm-empty',
    ],
    [
      'a differing confirmation is "mismatch"',
      { password: STRONG, confirm: 'NoorLife2027!' },
      'mismatch',
    ],
    [
      'a case-only difference is "mismatch"',
      { password: STRONG, confirm: 'noorlife2026!' },
      'mismatch',
    ],
    ['a matching strong pair is "valid"', { password: STRONG, confirm: STRONG }, 'valid'],
  ] as const)('%s', (_label, input, expected: PasswordDraftState) => {
    expect(evaluate(input).state).toBe(expected);
  });

  it('permits only the valid state to submit', () => {
    expect(evaluate({ password: STRONG, confirm: STRONG }).canSubmit).toBe(true);
    for (const input of [
      { password: '', confirm: '' },
      { password: 'abc', confirm: 'abc' },
      { password: STRONG, confirm: '' },
      { password: STRONG, confirm: 'other-one-2026!' },
    ]) {
      expect(evaluate(input).canSubmit).toBe(false);
    }
  });

  it('answers the password field completely before the confirmation', () => {
    // A weak password with an empty confirmation is reported as weak: sending the user forward to
    // confirm a value that cannot be accepted would waste the trip.
    expect(evaluate({ password: 'abc', confirm: '' }).state).toBe('weak');
    expect(evaluate({ password: 'abc', confirm: '' }).field).toBe('password');
  });

  it('does not treat a passphrase with surrounding spaces as empty', () => {
    // Trimming for the emptiness test must not become trimming the credential: leading and trailing
    // spaces are legitimate characters, and removing them would set a password the user cannot type.
    const padded = `  ${STRONG}  `;
    expect(evaluate({ password: padded, confirm: padded }).state).toBe('valid');
  });
});

describe('capability', () => {
  it('refuses a social identity whatever is typed', () => {
    const result = evaluate({
      password: STRONG,
      confirm: STRONG,
      canManagePassword: false,
    });
    expect(result.state).toBe('provider-unsupported');
    expect(result.canSubmit).toBe(false);
  });

  it('refuses an unconfirmed session whatever is typed', () => {
    const result = evaluate({ password: STRONG, confirm: STRONG, sessionReady: false });
    expect(result.state).toBe('session-unavailable');
    expect(result.canSubmit).toBe(false);
  });

  it('refuses while a request is already open', () => {
    const result = evaluate({ password: STRONG, confirm: STRONG, submitting: true });
    expect(result.state).toBe('submitting');
    expect(result.canSubmit).toBe(false);
  });

  it('puts capability ahead of content, so no field is blamed for it', () => {
    for (const overrides of [
      { canManagePassword: false },
      { sessionReady: false },
      { submitting: true },
    ]) {
      const result = evaluate({ password: '', confirm: '', ...overrides });
      expect(result.isFieldProblem).toBe(false);
      expect(result.field).toBeNull();
    }
  });

  it('reports a provider limitation ahead of a dead session', () => {
    // Both are true for a signed-out social account. The provider explanation is the one that stays
    // true after signing in again, so it is the one shown.
    expect(evaluate({ canManagePassword: false, sessionReady: false }).state).toBe(
      'provider-unsupported',
    );
  });
});

describe('what the evaluation carries', () => {
  it('names the field for every problem the user can fix, and no other', () => {
    expect(evaluate({ password: '', confirm: '' }).field).toBe('password');
    expect(evaluate({ password: 'abc', confirm: 'abc' }).field).toBe('password');
    expect(evaluate({ password: STRONG, confirm: '' }).field).toBe('confirm');
    expect(evaluate({ password: STRONG, confirm: 'zzz' }).field).toBe('confirm');
    expect(evaluate({ password: STRONG, confirm: STRONG }).field).toBeNull();
  });

  it('cannot carry the password, by shape', () => {
    const result = evaluate({ password: STRONG, confirm: STRONG });
    expect(Object.keys(result).sort()).toEqual(['canSubmit', 'field', 'isFieldProblem', 'state']);
    expect(JSON.stringify(result)).not.toContain(STRONG);
  });

  it('logs nothing, for any input', () => {
    const spies = (['log', 'warn', 'error', 'info', 'debug'] as const).map((level) =>
      jest.spyOn(console, level).mockImplementation(() => undefined),
    );

    for (const input of [
      { password: '', confirm: '' },
      { password: 'abc', confirm: 'abc' },
      { password: STRONG, confirm: STRONG },
      { password: STRONG, confirm: STRONG, canManagePassword: false },
      { password: STRONG, confirm: STRONG, sessionReady: false },
    ]) {
      evaluate(input);
    }

    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  });
});
