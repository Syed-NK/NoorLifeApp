import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { AppProviders } from '@application/providers/app-providers';
import { installMockLatencyTimers } from '@/test-support/mock-latency-timers';

import {
  AccountSecurityError,
  type AccountSecurityPort,
  type AccountSecuritySummary,
} from '@services/account/account-security.contract';

import { mockRouter } from '../../../../jest.setup';
import { privacySecurityCopy } from '../privacy-security-copy';
import { ChangePasswordScreen } from '../screens/change-password-screen';

// Two costs this removes: the simulated latency the mock data sources sleep through on every
// mount, and the one-off compile cost of the first mount, warmed up in `beforeAll` so that no
// individual test is charged for it.
installMockLatencyTimers(() => renderScreen(fakePort()));

/**
 * Change Password — validation, single submission, the backend's reauthentication flow, and what
 * never leaves the screen.
 *
 * ── Why every state here is injected ────────────────────────────────────────
 * A genuine test account's password must not be changed to produce these results, and the
 * reauthentication path is unreachable without a session more than 24 hours old. Both constraints
 * point the same way: drive the port, assert the screen.
 */

const EMAIL_SUMMARY: AccountSecuritySummary = {
  provider: 'email',
  email: 'ahmed@example.com',
  emailVerification: 'verified',
  lastSignInAt: null,
  canManagePassword: true,
  pendingEmail: null,
};

type Fake = AccountSecurityPort & {
  readonly updates: jest.Mock;
  readonly codes: jest.Mock;
};

function fakePort(
  options: {
    readonly summary?: Partial<AccountSecuritySummary>;
    readonly updateFails?: AccountSecurityError;
    /** Fails the first call only, so the reauthentication retry can succeed. */
    readonly updateFailsOnce?: AccountSecurityError;
  } = {},
): Fake {
  let attempts = 0;
  const updates = jest.fn(async () => {
    attempts += 1;
    // Resolving on a later tick is what lets the "exactly once" test press twice while the first
    // request is genuinely still open.
    await Promise.resolve();
    if (options.updateFails !== undefined) {
      throw options.updateFails;
    }
    if (options.updateFailsOnce !== undefined && attempts === 1) {
      throw options.updateFailsOnce;
    }
  });
  const codes = jest.fn(() => Promise.resolve());

  return {
    readSummary: () => Promise.resolve({ ...EMAIL_SUMMARY, ...options.summary }),
    sendReauthenticationCode: codes,
    updatePassword: updates,
    requestEmailChange: () =>
      Promise.resolve({ status: 'pending' as const, requestedEmail: 'x@example.com' }),
    signOutThisDevice: () => Promise.resolve(),
    signOutEverywhere: () => Promise.resolve({ status: 'signed-out-everywhere' as const }),
    updates,
    codes,
  };
}

async function renderScreen(port: AccountSecurityPort, testID = 'change-password-form') {
  const view = await render(
    <AppProviders>
      <ChangePasswordScreen port={port} />
    </AppProviders>,
  );
  await waitFor(() => expect(screen.getByTestId(testID)).toBeTruthy());
  return view;
}

describe('an email and password account', () => {
  it('shows the real supported form', async () => {
    await renderScreen(fakePort());

    expect(screen.getByTestId('change-password-new')).toBeTruthy();
    expect(screen.getByTestId('change-password-confirm')).toBeTruthy();
    expect(screen.getByTestId('change-password-submit')).toBeTruthy();
  });

  it('masks both fields by default and offers a reveal on each', async () => {
    await renderScreen(fakePort());

    expect(screen.getByTestId('change-password-new').props.secureTextEntry).toBe(true);
    expect(screen.getByTestId('change-password-confirm').props.secureTextEntry).toBe(true);

    await fireEvent.press(screen.getByTestId('change-password-new-reveal'));
    expect(screen.getByTestId('change-password-new').props.secureTextEntry).toBe(false);
    // Revealing one does not reveal the other.
    expect(screen.getByTestId('change-password-confirm').props.secureTextEntry).toBe(true);
  });

  it('declares password-manager hints so autofill can offer to save', async () => {
    await renderScreen(fakePort());

    for (const testID of ['change-password-new', 'change-password-confirm']) {
      expect(screen.getByTestId(testID).props.autoComplete).toBe('new-password');
      expect(screen.getByTestId(testID).props.textContentType).toBe('newPassword');
    }
  });

  it('does not show a reauthentication step until the backend asks for one', async () => {
    await renderScreen(fakePort());

    expect(screen.queryByTestId('change-password-reauth')).toBeNull();
  });
});

/**
 * The disabled contract.
 *
 * ── Why these assert the control, not the message ───────────────────────────
 * The device pass found Update Password at full fill over two empty fields: the refusal existed
 * only inside the handler, so the button invited a press and answered with a validation message.
 * These tests therefore assert the *state of the control* first — a state that cannot be submitted
 * must also not be pressable — and the explanatory message second. Asserting only the message is
 * what let the earlier version pass while the button was still live.
 */
describe('the Update Password control', () => {
  const submit = () => screen.getByTestId('change-password-submit');
  const isDisabled = () => submit().props.accessibilityState.disabled === true;

  async function fill(password: string, confirm = password) {
    await fireEvent.changeText(screen.getByTestId('change-password-new'), password);
    await fireEvent.changeText(screen.getByTestId('change-password-confirm'), confirm);
  }

  it('is disabled over two empty fields', async () => {
    await renderScreen(fakePort());
    expect(isDisabled()).toBe(true);
  });

  it('is disabled with a password but no confirmation', async () => {
    await renderScreen(fakePort());
    await fireEvent.changeText(screen.getByTestId('change-password-new'), 'NoorLife2026!');
    expect(isDisabled()).toBe(true);
  });

  it('is disabled for whitespace-only input in either field', async () => {
    await renderScreen(fakePort());

    await fill('      ');
    expect(isDisabled()).toBe(true);

    await fill('NoorLife2026!', '     ');
    expect(isDisabled()).toBe(true);
  });

  it('is disabled for a password below the shared strength policy', async () => {
    await renderScreen(fakePort());
    // The same `scorePassword` minimum Sign Up and New Password already enforce.
    await fill('abc');
    expect(isDisabled()).toBe(true);
  });

  it('is disabled when the confirmation does not match', async () => {
    await renderScreen(fakePort());
    await fill('NoorLife2026!', 'NoorLife2027!');
    expect(isDisabled()).toBe(true);
  });

  it('is enabled only once the form is genuinely submittable', async () => {
    await renderScreen(fakePort());
    await fill('NoorLife2026!');
    expect(isDisabled()).toBe(false);
  });

  it('never resizes between its enabled and disabled states', async () => {
    await renderScreen(fakePort());
    const disabledStyle = submit().props.style;
    await fill('NoorLife2026!');
    const enabledStyle = submit().props.style;

    const geometry = (style: unknown) => {
      const flat = (Array.isArray(style) ? style : [style]).filter(
        (entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null,
      );
      const merged = Object.assign({}, ...flat) as Record<string, unknown>;
      return {
        height: merged.height,
        borderRadius: merged.borderRadius,
        paddingHorizontal: merged.paddingHorizontal,
      };
    };
    expect(geometry(enabledStyle)).toEqual(geometry(disabledStyle));
  });

  it('tells a screen reader what would enable it, not what pressing it would do', async () => {
    await renderScreen(fakePort());

    expect(submit().props.accessibilityHint).toBe(
      privacySecurityCopy.password.submitDisabledHints.empty,
    );

    await fill('NoorLife2026!', 'NoorLife2027!');
    expect(submit().props.accessibilityHint).toBe(
      privacySecurityCopy.password.submitDisabledHints.mismatch,
    );

    await fill('NoorLife2026!');
    expect(submit().props.accessibilityHint).toBe(privacySecurityCopy.password.submitHint);
  });
});

describe('validation', () => {
  it('makes no service call from a press in any invalid state', async () => {
    const port = fakePort();
    await renderScreen(port);

    for (const [password, confirm] of [
      ['', ''],
      ['   ', '   '],
      ['abc', 'abc'],
      ['NoorLife2026!', 'NoorLife2027!'],
      ['NoorLife2026!', ''],
    ]) {
      await fireEvent.changeText(screen.getByTestId('change-password-new'), password as string);
      await fireEvent.changeText(screen.getByTestId('change-password-confirm'), confirm as string);
      await fireEvent.press(screen.getByTestId('change-password-submit'));
    }

    expect(port.updates).not.toHaveBeenCalled();
  });

  it('says nothing under an untouched field', async () => {
    await renderScreen(fakePort());

    expect(screen.queryByTestId('change-password-new-error')).toBeNull();
    expect(screen.queryByTestId('change-password-confirm-error')).toBeNull();
  });

  it('explains an empty password once the field has been left', async () => {
    await renderScreen(fakePort());

    await fireEvent(screen.getByTestId('change-password-new'), 'blur');

    expect(screen.getByTestId('change-password-new-error')).toHaveTextContent(
      privacySecurityCopy.password.errors.empty,
    );
  });

  it('explains a weak password under the password field, not the confirmation', async () => {
    await renderScreen(fakePort());

    await fireEvent.changeText(screen.getByTestId('change-password-new'), 'abc');
    await fireEvent(screen.getByTestId('change-password-new'), 'blur');

    expect(screen.getByTestId('change-password-new-error')).toHaveTextContent(
      privacySecurityCopy.password.errors.weak,
    );
    expect(screen.queryByTestId('change-password-confirm-error')).toBeNull();
  });

  it('explains a missing confirmation as its own state', async () => {
    await renderScreen(fakePort());

    await fireEvent.changeText(screen.getByTestId('change-password-new'), 'NoorLife2026!');
    await fireEvent(screen.getByTestId('change-password-confirm'), 'blur');

    expect(screen.getByTestId('change-password-confirm-error')).toHaveTextContent(
      privacySecurityCopy.password.errors.confirmEmpty,
    );
  });

  it('explains a mismatch under the confirmation field', async () => {
    await renderScreen(fakePort());

    await fireEvent.changeText(screen.getByTestId('change-password-new'), 'NoorLife2026!');
    await fireEvent.changeText(screen.getByTestId('change-password-confirm'), 'NoorLife2027!');
    await fireEvent(screen.getByTestId('change-password-confirm'), 'blur');

    expect(screen.getByTestId('change-password-confirm-error')).toHaveTextContent(
      privacySecurityCopy.password.errors.mismatch,
    );
  });

  it('explains a refusal on a submit attempt even with no blur', async () => {
    await renderScreen(fakePort());

    // The button is disabled, so this arrives the way a keyboard "Done" does.
    await fireEvent(screen.getByTestId('change-password-confirm'), 'submitEditing');

    expect(screen.getByTestId('change-password-new-error')).toHaveTextContent(
      privacySecurityCopy.password.errors.empty,
    );
  });
});

describe("the keyboard's own Submit", () => {
  it('sends a valid form, exactly as the button does', async () => {
    const port = fakePort();
    await renderScreen(port);

    await fireEvent.changeText(screen.getByTestId('change-password-new'), 'NoorLife2026!');
    await fireEvent.changeText(screen.getByTestId('change-password-confirm'), 'NoorLife2026!');
    await fireEvent(screen.getByTestId('change-password-confirm'), 'submitEditing');

    await waitFor(() => expect(port.updates).toHaveBeenCalledTimes(1));
  });

  it('is refused by the same evaluator when the form is not submittable', async () => {
    const port = fakePort();
    await renderScreen(port);

    await fireEvent.changeText(screen.getByTestId('change-password-new'), 'NoorLife2026!');
    await fireEvent.changeText(screen.getByTestId('change-password-confirm'), 'NoorLife2027!');
    await fireEvent(screen.getByTestId('change-password-confirm'), 'submitEditing');

    expect(port.updates).not.toHaveBeenCalled();
  });
});

describe('submission', () => {
  async function fillValid() {
    await fireEvent.changeText(screen.getByTestId('change-password-new'), 'NoorLife2026!');
    await fireEvent.changeText(screen.getByTestId('change-password-confirm'), 'NoorLife2026!');
  }

  it('calls the service exactly once, however many times the button is pressed', async () => {
    const port = fakePort();
    await renderScreen(port);
    await fillValid();

    // Three presses in the same tick, deliberately unawaited: that is what a double tap actually
    // is, and it is the case the `busy` guard exists to swallow. Awaiting each press would let the
    // first request finish and clear the fields, so the later presses would be rejected by
    // validation instead — the right count for the wrong reason.
    const submit = screen.getByTestId('change-password-submit');
    await act(async () => {
      fireEvent.press(submit);
      fireEvent.press(submit);
      fireEvent.press(submit);
    });

    await waitFor(() => expect(port.updates).toHaveBeenCalledTimes(1));
  });

  it('sends the typed password and no other credential', async () => {
    const port = fakePort();
    await renderScreen(port);
    await fillValid();

    await fireEvent.press(screen.getByTestId('change-password-submit'));

    await waitFor(() => expect(port.updates).toHaveBeenCalledTimes(1));
    expect(port.updates).toHaveBeenCalledWith({ newPassword: 'NoorLife2026!' });
  });

  it('confirms success and clears the fields', async () => {
    const port = fakePort();
    await renderScreen(port);
    await fillValid();

    await fireEvent.press(screen.getByTestId('change-password-submit'));

    await waitFor(() => expect(screen.getByTestId('change-password-success')).toBeTruthy());
    expect(screen.getByTestId('change-password-new').props.value).toBe('');
    expect(screen.getByTestId('change-password-confirm').props.value).toBe('');
  });

  it('returns safely to Privacy & Security after a success', async () => {
    const port = fakePort();
    await renderScreen(port);
    await fillValid();
    await fireEvent.press(screen.getByTestId('change-password-submit'));
    await waitFor(() => expect(screen.getByTestId('change-password-success')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('change-password-success-back'));
    expect(mockRouter.dismissTo).toHaveBeenCalledWith('/profile/privacy-security');
  });

  it('keeps the entered password on a recoverable failure so the user retries rather than retypes', async () => {
    const port = fakePort({ updateFails: new AccountSecurityError('offline') });
    await renderScreen(port);
    await fillValid();

    await fireEvent.press(screen.getByTestId('change-password-submit'));

    await waitFor(() => expect(screen.getByTestId('change-password-error')).toBeTruthy());
    expect(screen.getByTestId('change-password-error')).toHaveTextContent(
      privacySecurityCopy.errors.offline,
    );
    expect(screen.getByTestId('change-password-new').props.value).toBe('NoorLife2026!');
    expect(screen.queryByTestId('change-password-success')).toBeNull();
  });

  it('clears the password when the session has expired, since it can no longer be used', async () => {
    const port = fakePort({ updateFails: new AccountSecurityError('session-expired') });
    await renderScreen(port);
    await fillValid();

    await fireEvent.press(screen.getByTestId('change-password-submit'));

    await waitFor(() => expect(screen.getByTestId('change-password-error')).toBeTruthy());
    expect(screen.getByTestId('change-password-new').props.value).toBe('');
  });

  it.each([
    ['same-password', privacySecurityCopy.errors['same-password']],
    ['weak-password', privacySecurityCopy.errors['weak-password']],
    ['rate-limited', privacySecurityCopy.errors['rate-limited']],
  ] as const)('renders the mapped message for %s and never a raw one', async (code, message) => {
    const port = fakePort({ updateFails: new AccountSecurityError(code) });
    await renderScreen(port);
    await fillValid();

    await fireEvent.press(screen.getByTestId('change-password-submit'));

    await waitFor(() => expect(screen.getByTestId('change-password-error')).toBeTruthy());
    expect(screen.getByTestId('change-password-error')).toHaveTextContent(message);
  });
});

describe('reauthentication', () => {
  it('reveals the confirmation step only after the backend requires it', async () => {
    const port = fakePort({
      updateFailsOnce: new AccountSecurityError('reauthentication-required'),
    });
    await renderScreen(port);

    expect(screen.queryByTestId('change-password-reauth')).toBeNull();

    await fireEvent.changeText(screen.getByTestId('change-password-new'), 'NoorLife2026!');
    await fireEvent.changeText(screen.getByTestId('change-password-confirm'), 'NoorLife2026!');
    await fireEvent.press(screen.getByTestId('change-password-submit'));

    await waitFor(() => expect(screen.getByTestId('change-password-reauth')).toBeTruthy());
    expect(screen.getByTestId('change-password-error')).toHaveTextContent(
      privacySecurityCopy.errors['reauthentication-required'],
    );
  });

  it('uses the supported Supabase flow rather than verifying anything locally', async () => {
    const port = fakePort({
      updateFailsOnce: new AccountSecurityError('reauthentication-required'),
    });
    await renderScreen(port);

    await fireEvent.changeText(screen.getByTestId('change-password-new'), 'NoorLife2026!');
    await fireEvent.changeText(screen.getByTestId('change-password-confirm'), 'NoorLife2026!');
    await fireEvent.press(screen.getByTestId('change-password-submit'));
    await waitFor(() => expect(screen.getByTestId('change-password-reauth')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('change-password-reauth-send'));
    await waitFor(() => expect(port.codes).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('change-password-reauth-sent')).toBeTruthy();
  });

  it('will not resubmit without the emailed code', async () => {
    const port = fakePort({
      updateFailsOnce: new AccountSecurityError('reauthentication-required'),
    });
    await renderScreen(port);

    await fireEvent.changeText(screen.getByTestId('change-password-new'), 'NoorLife2026!');
    await fireEvent.changeText(screen.getByTestId('change-password-confirm'), 'NoorLife2026!');
    await fireEvent.press(screen.getByTestId('change-password-submit'));
    await waitFor(() => expect(screen.getByTestId('change-password-reauth')).toBeTruthy());
    expect(port.updates).toHaveBeenCalledTimes(1);

    await fireEvent.press(screen.getByTestId('change-password-submit'));
    // Still one: the missing nonce is caught before a second pointless request.
    expect(port.updates).toHaveBeenCalledTimes(1);
  });

  it('passes the emailed nonce through to the update call', async () => {
    const port = fakePort({
      updateFailsOnce: new AccountSecurityError('reauthentication-required'),
    });
    await renderScreen(port);

    await fireEvent.changeText(screen.getByTestId('change-password-new'), 'NoorLife2026!');
    await fireEvent.changeText(screen.getByTestId('change-password-confirm'), 'NoorLife2026!');
    await fireEvent.press(screen.getByTestId('change-password-submit'));
    await waitFor(() => expect(screen.getByTestId('change-password-reauth')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('change-password-reauth-send'));
    await waitFor(() => expect(screen.getByTestId('change-password-reauth-code')).toBeTruthy());

    await fireEvent.changeText(screen.getByTestId('change-password-reauth-code'), '123456');
    await fireEvent.press(screen.getByTestId('change-password-submit'));

    await waitFor(() => expect(port.updates).toHaveBeenCalledTimes(2));
    expect(port.updates).toHaveBeenLastCalledWith({
      newPassword: 'NoorLife2026!',
      nonce: '123456',
    });
    await waitFor(() => expect(screen.getByTestId('change-password-success')).toBeTruthy());
  });
});

describe('a social account', () => {
  it('shows the provider explanation and no form at all', async () => {
    const port = fakePort({
      summary: { provider: 'google', canManagePassword: false },
    });
    await renderScreen(port, 'change-password-provider-managed');

    expect(
      screen.getByText(privacySecurityCopy.password.providerManagedTitle('Google')),
    ).toBeTruthy();
    // Not a disabled form — no form.
    expect(screen.queryByTestId('change-password-new')).toBeNull();
    expect(screen.queryByTestId('change-password-submit')).toBeNull();
  });

  it('invents no provider management URL', async () => {
    const port = fakePort({ summary: { provider: 'apple', canManagePassword: false } });
    await renderScreen(port, 'change-password-provider-managed');

    const page = JSON.stringify(screen.toJSON());
    expect(page).not.toMatch(/https?:\/\/(accounts\.google|appleid\.apple)/);
  });
});

describe('what the screen never does with a password', () => {
  it('logs nothing at all during a full submission', async () => {
    const spies = {
      log: jest.spyOn(console, 'log').mockImplementation(() => undefined),
      warn: jest.spyOn(console, 'warn').mockImplementation(() => undefined),
      error: jest.spyOn(console, 'error').mockImplementation(() => undefined),
      info: jest.spyOn(console, 'info').mockImplementation(() => undefined),
      debug: jest.spyOn(console, 'debug').mockImplementation(() => undefined),
    };
    const port = fakePort();
    await renderScreen(port);

    await fireEvent.changeText(screen.getByTestId('change-password-new'), 'NoorLife2026!');
    await fireEvent.changeText(screen.getByTestId('change-password-confirm'), 'NoorLife2026!');
    await fireEvent.press(screen.getByTestId('change-password-submit'));
    await waitFor(() => expect(screen.getByTestId('change-password-success')).toBeTruthy());

    for (const spy of Object.values(spies)) {
      const emitted = spy.mock.calls.flat().map(String).join(' ');
      expect(emitted).not.toContain('NoorLife2026!');
      spy.mockRestore();
    }
  });

  it('never renders the password as plain text outside the masked field', async () => {
    await renderScreen(fakePort());

    await fireEvent.changeText(screen.getByTestId('change-password-new'), 'NoorLife2026!');

    // The value lives on the secure input and nowhere else — no echo in a banner, a hint or a
    // status line.
    const matches = screen.queryAllByText('NoorLife2026!');
    expect(matches).toHaveLength(0);
  });
});
